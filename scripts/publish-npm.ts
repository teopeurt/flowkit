/**
 * Publish the FlowKit packages to npmjs.org.
 *
 * This runs after the GitHub Packages publish and has three jobs:
 *  1. derive the publish order from the packages' internal dependency graph;
 *  2. skip `<name>@<version>` when it already exists on npmjs.org, so a rerun
 *     after a partial failure resumes instead of failing on E403;
 *  3. publish the exact tarball that the release gates packed and tested.
 *
 * The registry cannot be selected reliably from `publishConfig.registry`
 * alone, so manifests must not pin one. Credentials arrive through a
 * short-lived userconfig file that references the NODE_AUTH_TOKEN environment
 * variable; the token itself is never written to a file, an argument, or a log.
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertPublishableManifest } from './check-publishable-manifests';

export const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CommandOptions {
  cwd?: string;
  env?: Record<string, string>;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options?: CommandOptions,
) => Promise<CommandResult>;

export type Logger = (line: string) => void;

export interface PublishablePackage {
  name: string;
  version: string;
  /** Package directory name under packages/ (for example "core"). */
  directory: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  publishConfig?: { registry?: string } & Record<string, unknown>;
}

export interface PublishReport {
  dryRun: boolean;
  published: string[];
  skipped: string[];
  failed?: string;
  /** Packages after the failure that were never attempted. */
  remaining: string[];
}

export interface PublishOptions {
  packagesRoot: string;
  /** Defaults to reading every directory under packagesRoot. */
  packages?: PublishablePackage[];
  token?: string;
  dryRun?: boolean;
  only?: string[];
  registry?: string;
  runner?: CommandRunner;
  logger?: Logger;
  /**
   * Directory containing the tarballs produced by the release candidate gate.
   * When set, these exact files are published instead of packing again.
   */
  candidateDir?: string;
  /** Base directory for the temporary userconfig and pack staging. */
  tempRoot?: string;
}

const versionSuffix = (version: string): string => `-${version}.tgz`;

/** npm pack / npm publish tarball name for a scoped package. */
export function tarballName(name: string, version: string): string {
  return `${name.replace(/^@/, '').replace('/', '-')}${versionSuffix(version)}`;
}

function internalDependencyNames(pkg: PublishablePackage): string[] {
  return [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ];
}

/**
 * Kahn topological sort with an alphabetical tie-break so the order is stable
 * across runs and across manifest directory order.
 */
export function orderPackagesForPublish(packages: PublishablePackage[]): PublishablePackage[] {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  if (byName.size !== packages.length) throw new Error('duplicate package names in publish set');

  const dependents = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const pkg of packages) indegree.set(pkg.name, 0);

  for (const pkg of packages) {
    for (const dependency of internalDependencyNames(pkg)) {
      if (!byName.has(dependency)) continue;
      indegree.set(pkg.name, (indegree.get(pkg.name) ?? 0) + 1);
      dependents.set(dependency, [...(dependents.get(dependency) ?? []), pkg.name]);
    }
  }

  const ready = packages
    .filter((pkg) => indegree.get(pkg.name) === 0)
    .map((pkg) => pkg.name)
    .sort((a, b) => a.localeCompare(b));
  const ordered: PublishablePackage[] = [];

  while (ready.length > 0) {
    const name = ready.shift() as string;
    ordered.push(byName.get(name) as PublishablePackage);
    for (const dependent of (dependents.get(name) ?? []).sort((a, b) => a.localeCompare(b))) {
      const next = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, next);
      if (next === 0) {
        ready.push(dependent);
        ready.sort((a, b) => a.localeCompare(b));
      }
    }
  }

  if (ordered.length !== packages.length) {
    const cyclic = packages
      .filter((pkg) => (indegree.get(pkg.name) ?? 0) > 0)
      .map((pkg) => pkg.name)
      .sort();
    throw new Error(`internal dependency cycle between packages: ${cyclic.join(', ')}`);
  }

  return ordered;
}

export function buildRegistryCheckArgs(name: string, version: string, registry: string): string[] {
  return ['view', `${name}@${version}`, 'version', '--registry', registry];
}

export interface PublishArgsOptions {
  registry: string;
  userconfig: string;
  dryRun: boolean;
}

export function buildPublishArgs(tarballPath: string, options: PublishArgsOptions): string[] {
  return [
    'publish',
    tarballPath,
    '--access',
    'public',
    '--provenance',
    '--registry',
    options.registry,
    '--userconfig',
    options.userconfig,
    ...(options.dryRun ? ['--dry-run'] : []),
  ];
}

/**
 * `npm view` exits 1 for a missing package or version. Anything else (auth,
 * network, rate limit) must fail the run rather than be treated as "new".
 */
export function interpretRegistryCheck(result: CommandResult): 'published' | 'missing' {
  if (result.code === 0) {
    if (result.stdout.trim().length > 0) return 'published';
    throw new Error('cannot determine publish state: registry check returned no version');
  }

  const output = `${result.stderr}\n${result.stdout}`;
  if (/E404|404 Not Found/.test(output)) return 'missing';
  throw new Error(
    `cannot determine publish state: registry check failed:\n${output.trim()}`,
  );
}

export const defaultCommandRunner: CommandRunner = async (command, args, options = {}) => {
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...process.env, ...(options.env ?? {}) })) {
    if (value !== undefined) environment[key] = value;
  }
  const child = Bun.spawn([command, ...args], {
    cwd: options.cwd,
    env: environment,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
};

export async function readPackages(packagesRoot: string): Promise<PublishablePackage[]> {
  const directories = (await readdir(packagesRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  return Promise.all(
    directories.map(async (directory) => {
      const manifest = (await Bun.file(join(packagesRoot, directory, 'package.json')).json()) as {
        name: string;
        version: string;
        dependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
        publishConfig?: PublishablePackage['publishConfig'];
      };
      return {
        name: manifest.name,
        version: manifest.version,
        directory,
        dependencies: manifest.dependencies,
        peerDependencies: manifest.peerDependencies,
        optionalDependencies: manifest.optionalDependencies,
        publishConfig: manifest.publishConfig,
      } satisfies PublishablePackage;
    }),
  );
}

function userconfigContents(registry: string): string {
  const host = new URL(registry).host;
  return [
    `registry=${registry.replace(/\/$/, '')}/`,
    `//${host}/:_authToken=\${NODE_AUTH_TOKEN}`,
    '',
  ].join('\n');
}

function asArguments(packages: PublishablePackage[]): string[] {
  return packages.map((pkg) => `${pkg.name}@${pkg.version}`);
}

async function resolveTarball(options: {
  pkg: PublishablePackage;
  packagesRoot: string;
  candidateDir?: string;
  stagingDir: string;
  runner: CommandRunner;
}): Promise<string> {
  const { pkg, packagesRoot, candidateDir, stagingDir, runner } = options;

  if (candidateDir) {
    const candidate = join(candidateDir, tarballName(pkg.name, pkg.version));
    if (!existsSync(candidate)) {
      throw new Error(
        `tested candidate tarball is missing for ${pkg.name}@${pkg.version}: ${candidate}. ` +
          'Run the release candidate gate first, or unset FLOWKIT_CANDIDATE_TARBALL_DIR to pack locally.',
      );
    }
    return candidate;
  }

  const destination = join(stagingDir, pkg.directory);
  await mkdir(destination, { recursive: true });
  const packed = await runner(
    'npm',
    ['pack', '--json', '--pack-destination', destination],
    { cwd: join(packagesRoot, pkg.directory) },
  );
  if (packed.code !== 0) {
    throw new Error(`npm pack failed for ${pkg.name}:\n${packed.stderr || packed.stdout}`);
  }

  let filename: string | undefined;
  try {
    const parsed = JSON.parse(packed.stdout) as Record<string, { filename?: string }>;
    filename = Object.values(parsed)[0]?.filename;
  } catch {
    throw new Error(`npm pack produced unreadable JSON for ${pkg.name}: ${packed.stdout.trim()}`);
  }
  if (!filename) throw new Error(`npm pack did not report a tarball filename for ${pkg.name}`);
  return join(destination, basename(filename));
}

export async function publishPackages(options: PublishOptions): Promise<PublishReport> {
  const {
    packagesRoot,
    registry = DEFAULT_REGISTRY,
    dryRun = false,
    runner = defaultCommandRunner,
    logger = console.log,
    candidateDir,
  } = options;

  const token = options.token ?? process.env.NODE_AUTH_TOKEN ?? '';
  if (!token && !dryRun) {
    throw new Error(
      'NODE_AUTH_TOKEN is required to publish to npmjs.org. Add a granular automation token ' +
        'with publish rights on @teopeurt/* as the repository secret NPM_TOKEN ' +
        '(see .changeset/README.md). Refusing to publish without credentials.',
    );
  }

  const packages = options.packages ?? (await readPackages(packagesRoot));
  const ordered = orderPackagesForPublish(packages);
  const versions = new Map(packages.map((pkg) => [pkg.name, pkg.version]));

  for (const pkg of packages) {
    const pinned = pkg.publishConfig?.registry;
    if (pinned && pinned !== registry) {
      throw new Error(
        `${pkg.name} pins publishConfig.registry=${pinned}, which conflicts with ${registry}. ` +
          'Remove publishConfig.registry from the manifest; select the registry per publish command instead.',
      );
    }
  }

  let scope = ordered;
  if (options.only && options.only.length > 0) {
    const known = new Set(ordered.map((pkg) => pkg.name));
    const unknown = options.only.filter((name) => !known.has(name));
    if (unknown.length > 0) {
      throw new Error(`unknown package in --only: ${unknown.join(', ')}`);
    }
    const selected = new Set(options.only);
    scope = ordered.filter((pkg) => selected.has(pkg.name));
  }

  const base = options.tempRoot ?? process.env.RUNNER_TEMP ?? tmpdir();
  const temporaryRoot = await mkdtemp(join(base, 'flowkit-npm-publish-'));
  const userconfig = join(temporaryRoot, '.npmrc');
  await writeFile(userconfig, userconfigContents(registry), { mode: 0o600 });

  const report: PublishReport = {
    dryRun,
    published: [],
    skipped: [],
    failed: undefined,
    remaining: [],
  };
  const childEnvironment = token ? { NODE_AUTH_TOKEN: token } : {};

  try {
    logger(
      `${dryRun ? 'dry-run: publishing' : 'publishing'} ${scope.length} package(s) to ${registry}`,
    );
    logger(`order: ${asArguments(scope).join(', ')}`);

    for (const [index, pkg] of scope.entries()) {
      const reference = `${pkg.name}@${pkg.version}`;
      let tarball = '';

      try {
        const check = await runner('npm', buildRegistryCheckArgs(pkg.name, pkg.version, registry), {
          env: childEnvironment,
        });
        if (interpretRegistryCheck(check) === 'published') {
          report.skipped.push(reference);
          logger(`skipping ${reference}: already published on ${registry}`);
          continue;
        }

        tarball = await resolveTarball({
          pkg,
          packagesRoot,
          candidateDir,
          stagingDir: temporaryRoot,
          runner,
        });
        const packedManifest = await runner('tar', ['-xOf', tarball, 'package/package.json']);
        if (packedManifest.code !== 0) {
          throw new Error(`could not read ${tarball}:\n${packedManifest.stderr}`);
        }
        const manifest = JSON.parse(packedManifest.stdout) as PublishablePackage;
        if (manifest.name !== pkg.name || manifest.version !== pkg.version) {
          throw new Error(
            `tarball ${tarball} contains ${manifest.name}@${manifest.version}, expected ${reference}`,
          );
        }
        // The 1.1.0 incident: a `workspace:` range must never leave the repo.
        assertPublishableManifest(
          manifest as unknown as { name: string; version: string; [key: string]: unknown },
          versions,
        );
      } catch (error) {
        report.failed = reference;
        report.remaining = asArguments(scope.slice(index + 1));
        logger(`failed ${reference}: ${(error as Error).message}`);
        break;
      }

      const result = await runner(
        'npm',
        buildPublishArgs(tarball, { registry, userconfig, dryRun }),
        { cwd: join(packagesRoot, pkg.directory), env: childEnvironment },
      );

      if (result.code !== 0) {
        report.failed = reference;
        report.remaining = asArguments(scope.slice(index + 1));
        logger(`failed ${reference}: ${(result.stderr || result.stdout).trim()}`);
        break;
      }

      report.published.push(reference);
      logger(`${dryRun ? 'dry-run: ' : ''}published ${reference} from ${tarball}`);
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }

  logger(`published: ${report.published.length > 0 ? report.published.join(', ') : '(none)'}`);
  logger(`skipped: ${report.skipped.length > 0 ? report.skipped.join(', ') : '(none)'}`);
  if (report.failed) logger(`failed: ${report.failed}`);
  logger(`not attempted: ${report.remaining.length > 0 ? report.remaining.join(', ') : '(none)'}`);

  return report;
}

export interface CliOptions {
  dryRun: boolean;
  only: string[];
}

export function parseArguments(argv: string[]): CliOptions {
  const options: CliOptions = { dryRun: false, only: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (argument === '--only') {
      const value = argv[index + 1];
      if (!value) throw new Error('--only requires a package name');
      options.only.push(...value.split(',').map((name) => name.trim()).filter(Boolean));
      index += 1;
      continue;
    }
    if (argument.startsWith('--only=')) {
      options.only.push(
        ...argument.slice('--only='.length).split(',').map((name) => name.trim()).filter(Boolean),
      );
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }
  return options;
}

async function main(): Promise<void> {
  const cli = parseArguments(Bun.argv.slice(2));
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const report = await publishPackages({
    packagesRoot: join(repositoryRoot, 'packages'),
    dryRun: cli.dryRun,
    only: cli.only,
    candidateDir: process.env.FLOWKIT_CANDIDATE_TARBALL_DIR,
  });
  if (report.failed) process.exitCode = 1;
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(`publish:npm: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
