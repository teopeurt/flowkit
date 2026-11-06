import { describe, expect, test } from 'bun:test';

import {
  assertDeclaredExportFilesPresent,
  assertPublicVersionExports,
  assertSafeTarballEntries,
  createConsumerManifest,
  runtimeSpecifiers,
} from './pack-check';

const manifest = {
  name: '@teopeurt/flowkit-auth',
  version: '0.2.0',
  files: ['dist', 'README.md'],
  exports: {
    '.': {
      import: './dist/index.js',
      require: './dist/index.cjs',
      types: './dist/index.d.ts',
    },
    './roles': {
      import: './dist/roles/index.js',
      require: './dist/roles/index.cjs',
      types: './dist/roles/index.d.ts',
    },
  },
};

describe('packed artifact boundaries', () => {
  test('permits only declared package files and standard package metadata', () => {
    expect(() =>
      assertSafeTarballEntries(manifest, [
        'package/package.json',
        'package/README.md',
        'package/dist/index.js',
        'package/dist/index.cjs',
        'package/dist/index.d.ts',
      ]),
    ).not.toThrow();
  });

  test.each([
    'package/src/index.ts',
    'package/dist/faan-adapter.js',
    'package/dist/avsec-contract.js',
    'package/.env.production',
    'package/build/index.js',
  ])('rejects unsafe or undeclared tar entry %s', (entry) => {
    expect(() => assertSafeTarballEntries(manifest, ['package/package.json', entry])).toThrow(entry);
  });

  test('enumerates every declared subpath for ESM and CommonJS checks', () => {
    expect(runtimeSpecifiers(manifest)).toEqual([
      '@teopeurt/flowkit-auth',
      '@teopeurt/flowkit-auth/roles',
    ]);
  });

  test('rejects an archive missing any declared runtime or type export file', () => {
    expect(() =>
      assertDeclaredExportFilesPresent(manifest, [
        'package/dist/index.js',
        'package/dist/index.cjs',
        'package/dist/index.d.ts',
        'package/dist/roles/index.js',
        'package/dist/roles/index.d.ts',
      ]),
    ).toThrow('package/dist/roles/index.cjs');
  });

  test('pins direct and transitive package resolution to the exact local tarballs', () => {
    expect(
      createConsumerManifest([
        {
          manifest: { name: '@teopeurt/flowkit-core' },
          tarballPath: '/tmp/tarballs/core.tgz',
        },
        {
          manifest: { name: '@teopeurt/flowkit-tasks' },
          tarballPath: '/tmp/tarballs/tasks.tgz',
        },
      ]),
    ).toEqual({
      name: 'flowkit-pack-consumer',
      private: true,
      type: 'module',
      dependencies: {
        '@teopeurt/flowkit-core': 'file:/tmp/tarballs/core.tgz',
        '@teopeurt/flowkit-tasks': 'file:/tmp/tarballs/tasks.tgz',
      },
      overrides: {
        '@teopeurt/flowkit-core': 'file:/tmp/tarballs/core.tgz',
        '@teopeurt/flowkit-tasks': 'file:/tmp/tarballs/tasks.tgz',
      },
    });
  });

  test('rejects public version exports that differ from the packed manifest', () => {
    expect(() =>
      assertPublicVersionExports(
        { name: '@teopeurt/flowkit-core', version: '0.2.0' },
        '@teopeurt/flowkit-core',
        { FLOWKIT_CORE_VERSION: '0.1.0' },
      ),
    ).toThrow(/FLOWKIT_CORE_VERSION.*0\.1\.0.*0\.2\.0/);

    expect(() =>
      assertPublicVersionExports(
        { name: '@teopeurt/flowkit-auth', version: '0.2.0' },
        '@teopeurt/flowkit-auth/testing',
        { testingContractVersion: '0.2.0' },
      ),
    ).not.toThrow();
  });
});
