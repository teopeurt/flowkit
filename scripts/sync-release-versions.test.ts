import { describe, expect, test } from 'bun:test';

import {
  countChangedLines,
  findExportedVersionConstants,
  lockstepVersionFromManifests,
  requirePrimaryVersionConstant,
  syncLockfileWorkspaceVersions,
  syncVersionConstant,
} from './sync-release-versions';

const packages = [
  '@naakwu/flowkit-auth',
  '@naakwu/flowkit-consumer',
  '@naakwu/flowkit-core',
  '@naakwu/flowkit-definitions',
  '@naakwu/flowkit-notify',
  '@naakwu/flowkit-tasks',
  '@naakwu/flowkit-temporal',
] as const;

const versionsByName = Object.fromEntries(packages.map((name) => [name, '1.0.0']));

// Mirrors the shape of the real bun.lock: four-space workspace keys, six-space
// "name"/"version" members, and a trailing "packages" section that must not move.
const lockFixture = `{
  "lockfileVersion": 1,
  "configVersion": 1,
  "workspaces": {
    "": {
      "name": "@naakwu/flowkit-workspace",
      "version": "0.2.0",
      "devDependencies": {
        "@changesets/cli": "3.0.0",
      },
    },
    "packages/auth": {
      "name": "@naakwu/flowkit-auth",
      "version": "0.2.0",
      "dependencies": {
        "zod": "^3.25.42",
      },
    },
    "packages/consumer": {
      "name": "@naakwu/flowkit-consumer",
      "version": "0.2.0",
      "dependencies": {
        "@naakwu/flowkit-core": "workspace:^",
        "@naakwu/flowkit-tasks": "workspace:^",
      },
    },
    "packages/core": {
      "name": "@naakwu/flowkit-core",
      "version": "0.2.0",
      "dependencies": {
        "zod": "^3.25.42",
      },
    },
    "packages/definitions": {
      "name": "@naakwu/flowkit-definitions",
      "version": "0.2.0",
      "dependencies": {
        "@naakwu/flowkit-core": "workspace:^",
        "@naakwu/flowkit-temporal": "workspace:^",
        "yaml": "^2.9.0",
      },
    },
    "packages/notify": {
      "name": "@naakwu/flowkit-notify",
      "version": "0.2.0",
      "dependencies": {
        "@noble/hashes": "^2.0.1",
        "zod": "^3.25.42",
      },
    },
    "packages/tasks": {
      "name": "@naakwu/flowkit-tasks",
      "version": "0.2.0",
      "dependencies": {
        "@naakwu/flowkit-core": "workspace:^",
        "@noble/hashes": "^2.0.1",
        "zod": "^3.25.42",
      },
    },
    "packages/temporal": {
      "name": "@naakwu/flowkit-temporal",
      "version": "0.2.0",
      "dependencies": {
        "@naakwu/flowkit-consumer": "workspace:^",
        "@naakwu/flowkit-core": "workspace:^",
        "@noble/hashes": "^2.0.1",
        "@temporalio/workflow": "1.16.2",
      },
    },
  },
  "packages": {
    "@naakwu/flowkit-auth": ["@naakwu/flowkit-auth@workspace:packages/auth"],
    "@naakwu/flowkit-consumer": ["@naakwu/flowkit-consumer@workspace:packages/consumer"],
    "@naakwu/flowkit-core": ["@naakwu/flowkit-core@workspace:packages/core"],
    "@naakwu/flowkit-definitions": ["@naakwu/flowkit-definitions@workspace:packages/definitions"],
    "@naakwu/flowkit-notify": ["@naakwu/flowkit-notify@workspace:packages/notify"],
    "@naakwu/flowkit-tasks": ["@naakwu/flowkit-tasks@workspace:packages/tasks"],
    "@naakwu/flowkit-temporal": ["@naakwu/flowkit-temporal@workspace:packages/temporal"],
  },
}
`;

describe('syncVersionConstant', () => {
  test("rewrites a package's exported version constant and nothing else", () => {
    const source = "export const FLOWKIT_CORE_VERSION = '0.2.0';\n\nexport { lintFlow } from './lint';\n";

    const updated = syncVersionConstant(source, 'FLOWKIT_CORE_VERSION', '1.0.0');

    expect(updated).toBe(
      "export const FLOWKIT_CORE_VERSION = '1.0.0';\n\nexport { lintFlow } from './lint';\n",
    );
  });

  test('rewrites a constant declared partway through a module', () => {
    const source = [
      "// Definitions package public surface.",
      "export { loadDefinitions } from './loader';",
      '',
      "export const FLOWKIT_DEFINITIONS_VERSION = '0.2.0';",
      '',
      "export { runCli } from './cli';",
      '',
    ].join('\n');

    const updated = syncVersionConstant(source, 'FLOWKIT_DEFINITIONS_VERSION', '1.0.0');

    expect(updated).toBe(source.replace("'0.2.0'", "'1.0.0'"));
  });

  test('is idempotent', () => {
    const source = "export const FLOWKIT_TASKS_VERSION = '0.2.0';\n";
    const once = syncVersionConstant(source, 'FLOWKIT_TASKS_VERSION', '1.0.0');

    expect(syncVersionConstant(once, 'FLOWKIT_TASKS_VERSION', '1.0.0')).toBe(once);
  });

  test('throws when the package has no matching constant', () => {
    const source = "export * from './contracts';\n";

    expect(() => syncVersionConstant(source, 'FLOWKIT_CONSUMER_VERSION', '1.0.0')).toThrow(
      /FLOWKIT_CONSUMER_VERSION/,
    );
  });

  test('throws when the package declares the constant more than once', () => {
    const source = [
      "export const FLOWKIT_NOTIFY_VERSION = '0.2.0';",
      "export const FLOWKIT_NOTIFY_VERSION = '0.2.0';",
      '',
    ].join('\n');

    expect(() => syncVersionConstant(source, 'FLOWKIT_NOTIFY_VERSION', '1.0.0')).toThrow(
      /more than once/,
    );
  });
});

describe('requirePrimaryVersionConstant', () => {
  test('returns the single FLOWKIT_*_VERSION export from a package index', () => {
    const source = [
      "export const FLOWKIT_AUTH_VERSION = '0.2.0';",
      "export * from './contracts';",
      '',
    ].join('\n');

    expect(requirePrimaryVersionConstant(source, '@naakwu/flowkit-auth')).toEqual({
      name: 'FLOWKIT_AUTH_VERSION',
      value: '0.2.0',
    });
  });

  test('throws when a package index has no FLOWKIT_*_VERSION export', () => {
    expect(() => requirePrimaryVersionConstant("export * from './contracts';\n", '@naakwu/flowkit-consumer')).toThrow(
      /@naakwu\/flowkit-consumer.*FLOWKIT_\*_VERSION/,
    );
  });

  test('throws when a package index declares more than one FLOWKIT_*_VERSION export', () => {
    const source = [
      "export const FLOWKIT_CORE_VERSION = '0.2.0';",
      "export const FLOWKIT_TASKS_VERSION = '0.2.0';",
      '',
    ].join('\n');

    expect(() => requirePrimaryVersionConstant(source, '@naakwu/flowkit-core')).toThrow(/more than one/);
  });
});

describe('findExportedVersionConstants', () => {
  test('finds exported version constants in both naming styles', () => {
    const source = [
      "export const FLOWKIT_AUTH_VERSION = '0.2.0';",
      "export const testingContractVersion = '0.2.0';",
      "export const FLOWKIT_AUTH_SCHEMA = 'v1';",
      '',
    ].join('\n');

    expect(findExportedVersionConstants(source)).toEqual([
      { name: 'FLOWKIT_AUTH_VERSION', value: '0.2.0' },
      { name: 'testingContractVersion', value: '0.2.0' },
    ]);
  });
});

describe('syncLockfileWorkspaceVersions', () => {
  test('rewrites exactly the seven workspace version lines', () => {
    const updated = syncLockfileWorkspaceVersions(lockFixture, versionsByName);

    expect(countChangedLines(lockFixture, updated)).toBe(7);
    expect(updated.split('\n').length).toBe(lockFixture.split('\n').length);

    const changed = lockFixture
      .split('\n')
      .map((line, index) => ({ line, next: updated.split('\n')[index] }))
      .filter(({ line, next }) => line !== next);
    expect(changed).toHaveLength(7);
    for (const { next } of changed) {
      expect(next).toBe('      "version": "1.0.0",');
    }

    // The workspace root and dependency/lock data are untouched.
    expect(updated).toContain('"name": "@naakwu/flowkit-workspace",\n      "version": "0.2.0",');
    expect(updated).toContain('"@naakwu/flowkit-core": "workspace:^",');
    expect(updated).toContain('"@naakwu/flowkit-definitions": ["@naakwu/flowkit-definitions@workspace:packages/definitions"],');
    expect(updated).toContain('"@changesets/cli": "3.0.0",');
  });

  test('is idempotent', () => {
    const once = syncLockfileWorkspaceVersions(lockFixture, versionsByName);

    expect(syncLockfileWorkspaceVersions(once, versionsByName)).toBe(once);
  });

  test('throws when a workspace package is missing from the version map', () => {
    const missing = { ...versionsByName } as Record<string, string>;
    delete missing['@naakwu/flowkit-temporal'];

    expect(() => syncLockfileWorkspaceVersions(lockFixture, missing)).toThrow(/flowkit-temporal/);
  });

  test('throws when the lockfile has no workspaces block', () => {
    expect(() => syncLockfileWorkspaceVersions('{ "lockfileVersion": 1 }\n', versionsByName)).toThrow(
      /workspaces/,
    );
  });
});

describe('lockstepVersionFromManifests', () => {
  test('returns the shared version for seven lockstep manifests', () => {
    expect(
      lockstepVersionFromManifests(packages.map((name) => ({ name, version: '1.0.0' }))),
    ).toBe('1.0.0');
  });

  test('throws on a non-lockstep manifest set', () => {
    expect(() =>
      lockstepVersionFromManifests([
        { name: '@naakwu/flowkit-core', version: '1.0.0' },
        { name: '@naakwu/flowkit-auth', version: '0.2.0' },
      ]),
    ).toThrow(/auth.*0\.2\.0/);
  });
});
