import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface RuntimeExport {
  types?: string;
  import: string;
  require: string;
}

interface PackageManifest {
  name: string;
  version: string;
  files?: string[];
  exports: Record<string, RuntimeExport>;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface PackedPackage {
  manifest: PackageManifest;
  tarballPath: string;
}

interface ConsumerPackageInput {
  manifest: Pick<PackageManifest, 'name'>;
  tarballPath: string;
}

const standardMetadataPattern = /^(?:readme|license|licence|notice|changelog)(?:\..+)?$/i;
const forbiddenIdentityPattern = /(?:faan|avsec|odc)/i;
const nonPortableDependencyPattern = /^(?:workspace|file|link):/;

export function assertSafeTarballEntries(
  manifest: Pick<PackageManifest, 'name' | 'files'>,
  entries: string[],
): void {
  const declaredPaths = (manifest.files ?? []).map((path) => posix.normalize(path.replace(/^\.\//, '')));

  for (const entry of entries) {
    if (!entry.startsWith('package/')) {
      throw new Error(`${manifest.name} tar entry is outside package/: ${entry}`);
    }

    const relativePath = posix.normalize(entry.slice('package/'.length));
    if (!relativePath || relativePath.endsWith('/')) {
      continue;
    }
    if (relativePath === '..' || relativePath.startsWith('../')) {
      throw new Error(`${manifest.name} tar entry escapes package/: ${entry}`);
    }
    if (/(^|\/)src(?:\/|$)/i.test(relativePath)) {
      throw new Error(`${manifest.name} tar entry contains src/: ${entry}`);
    }
    if (forbiddenIdentityPattern.test(relativePath)) {
      throw new Error(`${manifest.name} tar entry contains a FAAN identifier: ${entry}`);
    }
    if (/(^|\/)\.env(?:[./]|$)/i.test(relativePath)) {
      throw new Error(`${manifest.name} tar entry contains .env: ${entry}`);
    }

    const isStandardMetadata = relativePath === 'package.json' || standardMetadataPattern.test(relativePath);
    const isDeclared = declaredPaths.some(
      (declaredPath) => relativePath === declaredPath || relativePath.startsWith(`${declaredPath}/`),
    );
    if (!isStandardMetadata && !isDeclared) {
      throw new Error(`${manifest.name} tar entry is not declared by files: ${entry}`);
    }
  }
}

export function assertDeclaredExportFilesPresent(
  manifest: Pick<PackageManifest, 'name' | 'exports'>,
  entries: string[],
): void {
  const entrySet = new Set(entries);
  const missingFiles: string[] = [];

  for (const conditions of Object.values(manifest.exports)) {
    for (const target of [conditions.import, conditions.require, conditions.types]) {
      if (!target) {
        continue;
      }
      const archivePath = `package/${target.replace(/^\.\//, '')}`;
      if (!entrySet.has(archivePath)) {
        missingFiles.push(archivePath);
      }
    }
  }

  if (missingFiles.length > 0) {
    throw new Error(`${manifest.name} archive is missing declared exports:\n${missingFiles.join('\n')}`);
  }
}

export function runtimeSpecifiers(manifest: Pick<PackageManifest, 'name' | 'exports'>): string[] {
  return Object.entries(manifest.exports).map(([subpath, conditions]) => {
    if (!conditions.import || !conditions.require) {
      throw new Error(`${manifest.name} export ${subpath} must declare both import and require targets`);
    }
    return subpath === '.' ? manifest.name : `${manifest.name}/${subpath.replace(/^\.\//, '')}`;
  });
}

export function assertPublicVersionExports(
  manifest: Pick<PackageManifest, 'name' | 'version'>,
  specifier: string,
  moduleExports: Record<string, unknown>,
): void {
  for (const [exportName, exportedValue] of Object.entries(moduleExports)) {
    if (
      /version$/i.test(exportName) &&
      typeof exportedValue === 'string' &&
      exportedValue !== manifest.version
    ) {
      throw new Error(
        `${specifier} exports ${exportName}=${exportedValue}; expected ${manifest.name}@${manifest.version}`,
      );
    }
  }
}

export function createConsumerManifest(packages: ConsumerPackageInput[]) {
  const dependencies = Object.fromEntries(
    packages.map(({ manifest, tarballPath }) => [manifest.name, `file:${tarballPath}`]),
  );

  return {
    name: 'flowkit-pack-consumer',
    private: true,
    type: 'module',
    dependencies,
    overrides: { ...dependencies },
  };
}

function assertPortableDependencies(manifest: PackageManifest): void {
  const dependencyGroups = [
    manifest.dependencies ?? {},
    manifest.optionalDependencies ?? {},
    manifest.peerDependencies ?? {},
  ];

  for (const dependencies of dependencyGroups) {
    for (const [name, version] of Object.entries(dependencies)) {
      if (nonPortableDependencyPattern.test(version)) {
        throw new Error(`${manifest.name} packed dependency ${name} is not portable: ${version}`);
      }
    }
  }
}

async function runCommand(command: string, args: string[], cwd: string): Promise<string> {
  const process = Bun.spawn([command, ...args], {
    cwd,
    env: globalThis.process.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  if (exitCode !== 0) {
    const detail = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${exitCode}${detail ? `:\n${detail}` : ''}`);
  }

  return stdout;
}

async function readManifest(path: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(path, 'utf8')) as PackageManifest;
}

async function packPackage(packageDirectory: string, destination: string): Promise<PackedPackage> {
  const sourceManifest = await readManifest(join(packageDirectory, 'package.json'));
  const packageDestination = join(destination, sourceManifest.name.replace(/[^a-z0-9-]+/gi, '-'));
  await mkdir(packageDestination, { recursive: true });

  await runCommand(globalThis.process.execPath, ['pm', 'pack', '--destination', packageDestination], packageDirectory);
  const tarballs = (await readdir(packageDestination)).filter((path) => path.endsWith('.tgz'));
  if (tarballs.length !== 1) {
    throw new Error(`${sourceManifest.name} produced ${tarballs.length} tarballs instead of one`);
  }

  const tarballPath = join(packageDestination, tarballs[0]);
  const tarOutput = await runCommand('tar', ['-tzf', tarballPath], packageDirectory);
  const entries = tarOutput.split('\n').filter(Boolean);
  assertSafeTarballEntries(sourceManifest, entries);
  assertDeclaredExportFilesPresent(sourceManifest, entries);

  const packedManifestText = await runCommand(
    'tar',
    ['-xOf', tarballPath, 'package/package.json'],
    packageDirectory,
  );
  const packedManifest = JSON.parse(packedManifestText) as PackageManifest;
  if (packedManifest.name !== sourceManifest.name || packedManifest.version !== sourceManifest.version) {
    throw new Error(
      `${sourceManifest.name} packed identity changed to ${packedManifest.name}@${packedManifest.version}`,
    );
  }
  assertPortableDependencies(packedManifest);

  return { manifest: packedManifest, tarballPath };
}

async function installAndImportPackages(packages: PackedPackage[], consumerDirectory: string): Promise<void> {
  await mkdir(consumerDirectory, { recursive: true });
  await writeFile(
    join(consumerDirectory, 'package.json'),
    `${JSON.stringify(createConsumerManifest(packages), null, 2)}\n`,
  );

  await runCommand(globalThis.process.execPath, ['install', '--ignore-scripts'], consumerDirectory);

  const contracts = packages.flatMap(({ manifest }) =>
    runtimeSpecifiers(manifest).map((specifier) => ({
      manifest: { name: manifest.name, version: manifest.version },
      specifier,
    })),
  );
  const resultCollector =
    "const results = []; for (const contract of contracts) { const loaded = LOAD(contract.specifier); results.push({ ...contract, exports: Object.fromEntries(Object.entries(AWAIT loaded).filter(([name, value]) => /version$/i.test(name) && typeof value === 'string')) }); } console.log(JSON.stringify(results));";
  const esmCheck = `const contracts = ${JSON.stringify(contracts)}; ${resultCollector
    .replace('LOAD', 'import')
    .replace('AWAIT', 'await')}`;
  const commonJsCheck = `const contracts = ${JSON.stringify(contracts)}; ${resultCollector
    .replace('LOAD', 'require')
    .replace('AWAIT', '')}`;

  for (const [moduleMode, output] of [
    [
      'ESM',
      await runCommand('node', ['--input-type=module', '--eval', esmCheck], consumerDirectory),
    ],
    [
      'CommonJS',
      await runCommand('node', ['--input-type=commonjs', '--eval', commonJsCheck], consumerDirectory),
    ],
  ] as const) {
    const results = JSON.parse(output) as Array<{
      manifest: Pick<PackageManifest, 'name' | 'version'>;
      specifier: string;
      exports: Record<string, unknown>;
    }>;
    for (const result of results) {
      try {
        assertPublicVersionExports(result.manifest, result.specifier, result.exports);
      } catch (error) {
        throw new Error(`${moduleMode} version contract failed`, { cause: error });
      }
    }
  }
}

export async function runPackCheck(repositoryRoot: string): Promise<void> {
  const packageRoot = join(repositoryRoot, 'packages');
  const packageDirectories = (await readdir(packageRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => join(packageRoot, entry.name));
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'flowkit-pack-check-'));

  try {
    const packedPackages: PackedPackage[] = [];
    for (const packageDirectory of packageDirectories) {
      packedPackages.push(await packPackage(packageDirectory, join(temporaryRoot, 'tarballs')));
    }
    await installAndImportPackages(packedPackages, join(temporaryRoot, 'consumer'));
    console.log(`Checked ${packedPackages.length} packed packages in an isolated consumer`);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  await runPackCheck(repositoryRoot);
}
