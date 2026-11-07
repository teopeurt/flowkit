import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import {
  buildPublishArgs,
  buildRegistryCheckArgs,
  interpretRegistryCheck,
  orderPackagesForPublish,
  publishPackages,
  type CommandResult,
  type CommandRunner,
  type PublishablePackage,
  userconfigContents as buildUserconfig,
} from './publish-npm';

const version = '1.1.0';

function manifest(
  name: string,
  dependencies: Record<string, string> = {},
): PublishablePackage {
  return {
    name,
    version,
    directory: name.replace('@teopeurt/flowkit-', ''),
    dependencies,
  };
}

const packages: PublishablePackage[] = [
  manifest('@teopeurt/flowkit-auth'),
  manifest('@teopeurt/flowkit-consumer', {
    '@teopeurt/flowkit-core': `^${version}`,
    '@teopeurt/flowkit-tasks': `^${version}`,
  }),
  manifest('@teopeurt/flowkit-core'),
  manifest('@teopeurt/flowkit-definitions', {
    '@teopeurt/flowkit-core': `^${version}`,
    '@teopeurt/flowkit-temporal': `^${version}`,
  }),
  manifest('@teopeurt/flowkit-notify'),
  manifest('@teopeurt/flowkit-tasks', { '@teopeurt/flowkit-core': `^${version}` }),
  manifest('@teopeurt/flowkit-temporal', {
    '@teopeurt/flowkit-consumer': `^${version}`,
    '@teopeurt/flowkit-core': `^${version}`,
  }),
];

const expectedOrder = [
  '@teopeurt/flowkit-auth',
  '@teopeurt/flowkit-core',
  '@teopeurt/flowkit-notify',
  '@teopeurt/flowkit-tasks',
  '@teopeurt/flowkit-consumer',
  '@teopeurt/flowkit-temporal',
  '@teopeurt/flowkit-definitions',
];

const missing: CommandResult = {
  code: 1,
  stdout: '',
  stderr: "npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/@teopeurt%2fflowkit-core - Not found\n",
};

function tarballName(name: string): string {
  return `${name.replace('@', '').replace('/', '-')}-${version}.tgz`;
}

function packageNameFromTarball(tarball: string): string {
  const suffix = `-${version}.tgz`;
  const file = basename(tarball);
  if (!file.endsWith(suffix)) throw new Error(`unexpected tarball ${tarball}`);
  const directory = file.slice(0, -suffix.length).replace(/^teopeurt-flowkit-/, '');
  return `@teopeurt/flowkit-${directory}`;
}

async function scratchDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'flowkit-npm-publish-test-'));
}

/**
 * A fake npm that never touches the network. `view` reports every package as
 * missing unless it is listed in `published`; `pack` reports the tarball name
 * for the cwd package; `tar` returns that tarball's manifest.
 */
function fakeRunner(options: {
  published?: string[];
  failOn?: string;
  commands?: string[][];
  userconfigContents?: string[];
} = {}): CommandRunner {
  return async (command, args, runOptions): Promise<CommandResult> => {
    options.commands?.push([command, ...args]);
    if (command === 'npm' && args[0] === 'view') {
      const name = args[1].split('@').slice(0, 2).join('@');
      if (options.published?.includes(name)) {
        return { code: 0, stdout: `${version}\n`, stderr: '' };
      }
      return missing;
    }
    if (command === 'npm' && args[0] === 'pack') {
      if (!runOptions?.cwd) throw new Error('npm pack was run without a cwd');
      const directory = basename(runOptions.cwd);
      const name = `@teopeurt/flowkit-${directory}`;
      return {
        code: 0,
        stdout: JSON.stringify({ [name]: { name, version, filename: tarballName(name) } }),
        stderr: '',
      };
    }
    if (command === 'tar' && args[0] === '-xOf') {
      const name = packageNameFromTarball(args[1]);
      return {
        code: 0,
        stdout: JSON.stringify({ name, version, publishConfig: { access: 'public' } }),
        stderr: '',
      };
    }
    if (command === 'npm' && args[0] === 'publish') {
      const userconfig = args[args.indexOf('--userconfig') + 1];
      if (options.userconfigContents) {
        options.userconfigContents.push(await readFile(userconfig, 'utf8'));
      }
      if (options.failOn && args[1].includes(tarballName(options.failOn))) {
        return { code: 1, stdout: '', stderr: 'npm error code E403\nnpm error 403 Forbidden' };
      }
      return { code: 0, stdout: `+ ${args[1]}\n`, stderr: '' };
    }
    throw new Error(`unexpected command: ${command} ${args.join(' ')} (cwd ${runOptions?.cwd ?? ''})`);
  };
}

describe('topological publish order', () => {
  test('orders packages after every internal dependency', () => {
    expect(orderPackagesForPublish(packages).map((pkg) => pkg.name)).toEqual(expectedOrder);
  });

  test('is deterministic regardless of manifest order', () => {
    const shuffled = [...packages].reverse();
    expect(orderPackagesForPublish(shuffled).map((pkg) => pkg.name)).toEqual(expectedOrder);
  });

  test('ignores external dependencies', () => {
    const withExternal = [manifest('@teopeurt/flowkit-auth', { zod: '^3.25.42' })];
    expect(orderPackagesForPublish(withExternal).map((pkg) => pkg.name)).toEqual([
      '@teopeurt/flowkit-auth',
    ]);
  });

  test('rejects a dependency cycle', () => {
    const cyclic = [
      manifest('@teopeurt/flowkit-auth', { '@teopeurt/flowkit-core': `^${version}` }),
      manifest('@teopeurt/flowkit-core', { '@teopeurt/flowkit-auth': `^${version}` }),
    ];
    expect(() => orderPackagesForPublish(cyclic)).toThrow(/cycle/i);
  });
});

describe('registry skip decision', () => {
  test('treats a returned version as already published', () => {
    expect(interpretRegistryCheck({ code: 0, stdout: '1.1.0\n', stderr: '' })).toBe('published');
  });

  test('treats E404 as missing', () => {
    expect(interpretRegistryCheck(missing)).toBe('missing');
  });

  test('fails on registry errors that are not 404 so a network fault cannot be mistaken for a new package', () => {
    expect(() =>
      interpretRegistryCheck({
        code: 1,
        stdout: '',
        stderr: 'npm error code EAI_AGAIN\nnpm error network request failed',
      }),
    ).toThrow(/cannot determine/i);
  });
});

describe('argument building', () => {
  test('builds the registry check against the generated userconfig, never the ambient one', () => {
    expect(
      buildRegistryCheckArgs('@teopeurt/flowkit-core', version, 'https://registry.npmjs.org', '/tmp/x/.npmrc'),
    ).toEqual([
      'view',
      '@teopeurt/flowkit-core@1.1.0',
      'version',
      '--registry',
      'https://registry.npmjs.org',
      '--userconfig',
      '/tmp/x/.npmrc',
    ]);
  });

  test('publishes an exact tarball with provenance through a temporary userconfig', () => {
    const args = buildPublishArgs('/tmp/candidate/teopeurt-flowkit-core-1.1.0.tgz', {
      registry: 'https://registry.npmjs.org',
      userconfig: '/tmp/flowkit-npm-publish-x/.npmrc',
      dryRun: false,
    });
    expect(args).toEqual([
      'publish',
      '/tmp/candidate/teopeurt-flowkit-core-1.1.0.tgz',
      '--access',
      'public',
      '--provenance',
      '--registry',
      'https://registry.npmjs.org',
      '--userconfig',
      '/tmp/flowkit-npm-publish-x/.npmrc',
    ]);
  });

  test('adds --dry-run only when requested', () => {
    const args = buildPublishArgs('/tmp/x.tgz', {
      registry: 'https://registry.npmjs.org',
      userconfig: '/tmp/.npmrc',
      dryRun: true,
    });
    expect(args).toContain('--dry-run');
  });
});

describe('publish run', () => {
  test('publishes all seven in dependency order in dry-run mode without credentials', async () => {
    const logs: string[] = [];
    const commands: string[][] = [];
    const report = await publishPackages({
      packagesRoot: '/repo/packages',
      packages,
      dryRun: true,
      runner: fakeRunner({ commands }),
      logger: (line) => logs.push(line),
    });

    expect(report.published).toEqual(expectedOrder.map((name) => `${name}@${version}`));
    expect(report.skipped).toEqual([]);
    expect(report.remaining).toEqual([]);
    expect(report.failed).toBeUndefined();
    expect(report.dryRun).toBe(true);

    const publishes = commands.filter(([command, subcommand]) => command === 'npm' && subcommand === 'publish');
    expect(publishes).toHaveLength(7);
    for (const [index, args] of publishes.entries()) {
      expect(args[2]).toContain(tarballName(expectedOrder[index]));
      expect(args).toContain('--dry-run');
    }
    expect(logs.join('\n')).toContain(
      `order: ${expectedOrder.map((name) => `${name}@${version}`).join(', ')}`,
    );
  });

  test('skips package 3 when it already exists and stops at package 5, reporting published, skipped and remaining', async () => {
    const logs: string[] = [];
    const report = await publishPackages({
      packagesRoot: '/repo/packages',
      packages,
      token: 'npm_fake_token',
      runner: fakeRunner({
        published: ['@teopeurt/flowkit-notify'],
        failOn: '@teopeurt/flowkit-consumer',
      }),
      logger: (line) => logs.push(line),
    });

    expect(report).toEqual({
      dryRun: false,
      published: [
        '@teopeurt/flowkit-auth@1.1.0',
        '@teopeurt/flowkit-core@1.1.0',
        '@teopeurt/flowkit-tasks@1.1.0',
      ],
      skipped: ['@teopeurt/flowkit-notify@1.1.0'],
      failed: '@teopeurt/flowkit-consumer@1.1.0',
      remaining: ['@teopeurt/flowkit-temporal@1.1.0', '@teopeurt/flowkit-definitions@1.1.0'],
    });
    const output = logs.join('\n');
    expect(output).toContain('skipping @teopeurt/flowkit-notify@1.1.0');
    expect(output).toContain('failed @teopeurt/flowkit-consumer@1.1.0');
    expect(output).toContain(
      'published: @teopeurt/flowkit-auth@1.1.0, @teopeurt/flowkit-core@1.1.0, @teopeurt/flowkit-tasks@1.1.0',
    );
    expect(output).toContain(
      'not attempted: @teopeurt/flowkit-temporal@1.1.0, @teopeurt/flowkit-definitions@1.1.0',
    );
  });

  test('resumes a partially published release by skipping what already exists', async () => {
    const report = await publishPackages({
      packagesRoot: '/repo/packages',
      packages,
      token: 'npm_fake_token',
      runner: fakeRunner({
        published: [
          '@teopeurt/flowkit-auth',
          '@teopeurt/flowkit-core',
          '@teopeurt/flowkit-notify',
          '@teopeurt/flowkit-tasks',
        ],
      }),
      logger: () => {},
    });

    expect(report.skipped).toEqual([
      '@teopeurt/flowkit-auth@1.1.0',
      '@teopeurt/flowkit-core@1.1.0',
      '@teopeurt/flowkit-notify@1.1.0',
      '@teopeurt/flowkit-tasks@1.1.0',
    ]);
    expect(report.published).toEqual([
      '@teopeurt/flowkit-consumer@1.1.0',
      '@teopeurt/flowkit-temporal@1.1.0',
      '@teopeurt/flowkit-definitions@1.1.0',
    ]);
  });

  test('publishes the exact candidate tarballs that the demo gate tested', async () => {
    const candidateDirectory = await scratchDirectory();
    const commands: string[][] = [];
    await writeFile(join(candidateDirectory, tarballName('@teopeurt/flowkit-core')), '');
    try {
      const report = await publishPackages({
        packagesRoot: '/repo/packages',
        packages: [manifest('@teopeurt/flowkit-core')],
        token: 'npm_fake_token',
        candidateDir: candidateDirectory,
        runner: fakeRunner({ commands }),
        logger: () => {},
      });

      expect(report.published).toEqual(['@teopeurt/flowkit-core@1.1.0']);
      expect(commands.some(([command, subcommand]) => command === 'npm' && subcommand === 'pack')).toBe(false);
      const publish = commands.find(([command, subcommand]) => command === 'npm' && subcommand === 'publish');
      expect(publish?.[2]).toBe(join(candidateDirectory, tarballName('@teopeurt/flowkit-core')));
    } finally {
      await rm(candidateDirectory, { recursive: true, force: true });
    }
  });

  test('requires NODE_AUTH_TOKEN outside dry-run before contacting anything', async () => {
    const commands: string[][] = [];
    await expect(
      publishPackages({
        packagesRoot: '/repo/packages',
        packages,
        token: '',
        runner: fakeRunner({ commands }),
        logger: () => {},
      }),
    ).rejects.toThrow(/NODE_AUTH_TOKEN/);
    expect(commands).toEqual([]);
  });

  test('fails when a manifest pins a different publishConfig.registry instead of guessing', async () => {
    const pinned = [
      { ...manifest('@teopeurt/flowkit-core'), publishConfig: { registry: 'https://npm.pkg.github.com' } },
    ];
    await expect(
      publishPackages({
        packagesRoot: '/repo/packages',
        packages: pinned,
        token: 'npm_fake_token',
        runner: fakeRunner(),
        logger: () => {},
      }),
    ).rejects.toThrow(/publishConfig\.registry/);
  });

  test('restricts a run to --only packages while keeping dependency order', async () => {
    const commands: string[][] = [];
    const report = await publishPackages({
      packagesRoot: '/repo/packages',
      packages,
      token: 'npm_fake_token',
      only: ['@teopeurt/flowkit-core', '@teopeurt/flowkit-tasks'],
      runner: fakeRunner({ commands }),
      logger: () => {},
    });

    expect(report.published).toEqual([
      '@teopeurt/flowkit-core@1.1.0',
      '@teopeurt/flowkit-tasks@1.1.0',
    ]);
    expect(report.remaining).toEqual([]);
  });

  test('rejects an unknown --only package', async () => {
    await expect(
      publishPackages({
        packagesRoot: '/repo/packages',
        packages,
        token: 'npm_fake_token',
        only: ['@teopeurt/flowkit-missing'],
        runner: fakeRunner(),
        logger: () => {},
      }),
    ).rejects.toThrow(/unknown package/i);
  });
});

describe('credential handling', () => {
  const token = 'npm_SENTINEL_TOKEN_DO_NOT_PRINT_0123456789';

  test('never writes the token to logs, arguments, or the userconfig file, and deletes the userconfig afterwards', async () => {
    const logs: string[] = [];
    const commands: string[][] = [];
    const userconfigContents: string[] = [];
    const report = await publishPackages({
      packagesRoot: '/repo/packages',
      packages,
      token,
      runner: fakeRunner({ commands, userconfigContents }),
      logger: (line) => logs.push(line),
    });

    expect(report.published).toHaveLength(7);
    expect(logs.join('\n')).not.toContain(token);
    expect(commands.flat().join('\n')).not.toContain(token);
    expect(userconfigContents).toHaveLength(7);
    for (const contents of userconfigContents) {
      expect(contents).toContain('//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}');
      expect(contents).not.toContain(token);
    }

    const userconfigPath = commands
      .filter(([command, ...args]) => command === 'npm' && args[0] === 'publish')
      .map((args) => args[args.indexOf('--userconfig') + 1])[0];
    expect(userconfigPath).toBeDefined();
    expect(existsSync(userconfigPath)).toBe(false);
    // The script prefers $RUNNER_TEMP (set on GitHub runners) over the OS temp dir.
    expect(userconfigPath.startsWith(process.env.RUNNER_TEMP || tmpdir())).toBe(true);
  });
});


describe('registry selection beats an ambient scope mapping', () => {
  // actions/setup-node writes `@teopeurt:registry=https://npm.pkg.github.com` into the runner's
  // userconfig (NPM_CONFIG_USERCONFIG). A scope mapping outranks `--registry`, so the "is it on npm
  // yet?" lookup silently went to GitHub Packages and failed with 401 in the first real release.
  const scopes = ['@teopeurt'];

  test('the generated userconfig maps every package scope to the target registry', () => {
    const contents = buildUserconfig('https://registry.npmjs.org', scopes);
    expect(contents).toContain('@teopeurt:registry=https://registry.npmjs.org/');
    expect(contents).toContain('//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}');
  });

  test('real npm resolves the scope to npmjs even when the ambient userconfig maps it to GitHub Packages', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'publish-npm-scope-'));
    try {
      const ambient = join(dir, 'ambient.npmrc');
      const generated = join(dir, 'generated.npmrc');
      await writeFile(ambient, '@teopeurt:registry=https://npm.pkg.github.com\n');
      await writeFile(generated, buildUserconfig('https://registry.npmjs.org', scopes));
      const env = { ...process.env, NPM_CONFIG_USERCONFIG: ambient };
      delete env.NODE_AUTH_TOKEN;

      const before = spawnSync('npm', ['config', 'get', '@teopeurt:registry'], { env, encoding: 'utf8' });
      expect(before.stdout.trim()).toBe('https://npm.pkg.github.com');

      const after = spawnSync('npm', ['config', 'get', '@teopeurt:registry', '--userconfig', generated], {
        env,
        encoding: 'utf8',
      });
      expect(after.stdout.trim()).toBe('https://registry.npmjs.org/');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('every registry lookup and publish runs with the generated userconfig', async () => {
    const commands: string[][] = [];
    await publishPackages({
      packagesRoot: '/repo/packages',
      packages,
      token: 'x'.repeat(8),
      runner: fakeRunner({ commands }),
      logger: () => {},
    });
    const npmCommands = commands.filter(([command, verb]) => command === 'npm' && (verb === 'view' || verb === 'publish'));
    expect(npmCommands.length).toBe(14);
    for (const args of npmCommands) {
      expect(args).toContain('--userconfig');
    }
  });
});
