import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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

const documentedImports = new Map<string, Set<string>>([
  ['@naakwu/flowkit-auth/roles', new Set(['defineRoleRegistry'])],
  ['@naakwu/flowkit-consumer', new Set(['createFlowkitConsumer'])],
  ['@naakwu/flowkit-core', new Set(['buildInitialState', 'defineFlow', 'transition'])],
  ['@naakwu/flowkit-notify', new Set(['createTemplateRegistry', 'planNotification'])],
  ['@naakwu/flowkit-tasks', new Set(['MemoryTaskStore', 'planTaskProjection'])],
  ['@naakwu/flowkit-temporal', new Set(['publishDefinition'])],
  ['@naakwu/flowkit-temporal/workflow', new Set(['createFlowkitWorkflow'])],
]);

function declarationFixture(source: string): string {
  const modules = new Map<string, Set<string>>();
  for (const match of source.matchAll(/import\s*{([^}]+)}\s*from\s*['"]([^'"]+)['"]/g)) {
    const allowedExports = documentedImports.get(match[2]);
    if (!allowedExports) throw new Error(`quickstart imports unsupported entry point ${match[2]}`);
    const exports = modules.get(match[2]) ?? new Set<string>();
    for (const item of match[1].split(',')) {
      const name = item.trim().split(/\s+as\s+/)[0];
      if (!allowedExports.has(name)) throw new Error(`quickstart imports undocumented export ${name} from ${match[2]}`);
      if (name) exports.add(name);
    }
    modules.set(match[2], exports);
  }
  return [...modules.entries()]
    .map(([specifier, exports]) => `declare module '${specifier}' { ${[...exports].map((name) => `export const ${name}: any;`).join(' ')} }`)
    .join('\n');
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
    expect(npmrc).toContain('@naakwu:registry=https://npm.pkg.github.com');
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

  test('compiles every TypeScript quickstart in an isolated consumer fixture', async () => {
    const quickstarts = (await Promise.all((await documentationPaths()).map(readDocumentation)))
      .flatMap(typescriptQuickstarts);
    expect(quickstarts.length).toBeGreaterThan(0);
    const directory = await mkdtemp(join(tmpdir(), 'flowkit-docs-consumer-'));
    temporaryDirectories.push(directory);
    const source = quickstarts.join('\n\n');
    await writeFile(join(directory, 'quickstart.ts'), source);
    // This fixture is intentionally type-only: private packages cannot be installed by an
    // arbitrary temporary consumer. Its explicit module/export map mirrors the manifest-verified
    // imports above, so the copied snippets prove their import syntax and public API names without
    // relying on unpublished package resolution.
    await writeFile(join(directory, 'flowkit-fixture.d.ts'), declarationFixture(source));
    await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', strict: true, noEmit: true, skipLibCheck: true },
      files: ['quickstart.ts', 'flowkit-fixture.d.ts'],
    }));
    const compiler = Bun.spawn(['bun', 'x', 'tsc', '--project', 'tsconfig.json'], { cwd: directory, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(compiler.stdout).text(), new Response(compiler.stderr).text(), compiler.exited]);
    expect(exitCode, `${stdout}${stderr}`).toBe(0);
  });
});
