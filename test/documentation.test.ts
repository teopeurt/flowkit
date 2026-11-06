import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '..');
const temporaryDirectories: string[] = [];
const tokenPattern = /gh[pousr]_[A-Za-z0-9_]{20,}/;

async function readDocumentation(path: string): Promise<string> {
  return readFile(join(repositoryRoot, path), 'utf8');
}

async function documentationPaths(): Promise<string[]> {
  const packageDirectories = await readdir(join(repositoryRoot, 'packages'), { withFileTypes: true });
  const docs = [...new Bun.Glob('docs/**/*.md').scanSync({ cwd: repositoryRoot })];
  return [
    'README.md',
    'CONTRIBUTING.md',
    'SECURITY.md',
    '.npmrc.example',
    ...docs,
    ...packageDirectories.filter((entry) => entry.isDirectory()).map((entry) => `packages/${entry.name}/README.md`),
  ];
}

function typescriptQuickstarts(markdown: string): string[] {
  return [...markdown.matchAll(/```(?:ts|typescript)\s*\n([\s\S]*?)```/g)].map((match) => match[1]);
}

async function run(command: string[], cwd: string): Promise<void> {
  const process = Bun.spawn(command, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) throw new Error(`${command.join(' ')} failed:\n${stdout}${stderr}`);
}

async function packLocalPackages(destination: string): Promise<Array<{ name: string; tarball: string }>> {
  await run(['bun', 'run', 'build'], repositoryRoot);
  const directories = (await readdir(join(repositoryRoot, 'packages'), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return Promise.all(directories.map(async (directory) => {
    const packageDirectory = join(repositoryRoot, 'packages', directory);
    const manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8')) as { name: string };
    const packageDestination = join(destination, directory);
    await mkdir(packageDestination, { recursive: true });
    await run(['bun', 'pm', 'pack', '--destination', packageDestination], packageDirectory);
    const tarballs = (await readdir(packageDestination)).filter((path) => path.endsWith('.tgz'));
    if (tarballs.length !== 1) throw new Error(`${manifest.name} produced ${tarballs.length} tarballs`);
    return { name: manifest.name, tarball: join(packageDestination, tarballs[0]) };
  }));
}

afterAll(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('public documentation contract', () => {
  test('ships Apache-2.0 licensing and private registry setup without tokens', async () => {
    const [license, npmrc, ...documents] = await Promise.all([
      readDocumentation('LICENSE'),
      readDocumentation('.npmrc.example'),
      ...(await documentationPaths()).map(readDocumentation),
    ]);

    expect(license).toContain('Apache License');
    expect(license).toContain('Version 2.0, January 2004');
    expect(npmrc).toContain('@teopeurt:registry=https://npm.pkg.github.com');
    expect(npmrc).toContain('${GITHUB_PACKAGES_TOKEN}');
    for (const document of documents) expect(document).not.toMatch(tokenPattern);
  });

  test('names every published package in the root README', async () => {
    const rootReadme = await readDocumentation('README.md');
    const packageDirectories = await readdir(join(repositoryRoot, 'packages'), { withFileTypes: true });
    const packageNames = await Promise.all(packageDirectories.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const manifest = JSON.parse(await readFile(join(repositoryRoot, 'packages', entry.name, 'package.json'), 'utf8')) as { name: string };
      return manifest.name;
    }));

    for (const name of packageNames) expect(rootReadme).toContain(name);
  });

  test('gives Yarn Berry its npmScopes registry configuration', async () => {
    const rootReadme = await readDocumentation('README.md');
    expect(rootReadme).toContain('Yarn Berry');
    expect(rootReadme).toContain('npmScopes:');
    expect(rootReadme).toContain('naakwu:');
    expect(rootReadme).toContain('npmRegistryServer: "https://npm.pkg.github.com"');
    expect(rootReadme).toContain('npmAuthToken: "${GITHUB_PACKAGES_TOKEN}"');
  });

  test('documents every declared internal package dependency', async () => {
    const documentation = await Promise.all(['docs/package-contracts.md', 'docs/architecture.md'].map(readDocumentation));
    const renderedGraph = documentation.join('\n');
    const packageDirectories = await readdir(join(repositoryRoot, 'packages'), { withFileTypes: true });
    for (const entry of packageDirectories.filter((candidate) => candidate.isDirectory())) {
      const manifest = JSON.parse(await readFile(join(repositoryRoot, 'packages', entry.name, 'package.json'), 'utf8')) as {
        name: string;
        dependencies?: Record<string, string>;
      };
      for (const dependency of Object.keys(manifest.dependencies ?? {}).filter((name) => name.startsWith('@teopeurt/flowkit-'))) {
        expect(renderedGraph).toContain(`${dependency} → ${manifest.name}`);
      }
    }
  });

  test('compiles every TypeScript quickstart against locally packed package declarations', async () => {
    const quickstarts = (await Promise.all((await documentationPaths()).map(readDocumentation)))
      .flatMap(typescriptQuickstarts);
    expect(quickstarts.length).toBeGreaterThan(0);
    const directory = await mkdtemp(join(tmpdir(), 'flowkit-docs-consumer-'));
    temporaryDirectories.push(directory);
    const packages = await packLocalPackages(join(directory, 'tarballs'));
    const dependencies = Object.fromEntries(packages.map(({ name, tarball }) => [name, `file:${tarball}`]));
    await writeFile(join(directory, 'package.json'), JSON.stringify({
      name: 'flowkit-documentation-consumer', private: true, type: 'module', dependencies, overrides: dependencies,
    }, null, 2));
    await run(['bun', 'install', '--offline', '--ignore-scripts'], directory);
    await writeFile(join(directory, 'quickstart.ts'), quickstarts.join('\n\n'));
    await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', strict: true, noEmit: true, skipLibCheck: true },
      files: ['quickstart.ts'],
    }));
    await run(['bun', 'x', '--offline', 'tsc', '--project', 'tsconfig.json'], directory);
  }, 60_000);
});
