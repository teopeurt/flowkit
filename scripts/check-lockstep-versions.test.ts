import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { checkLockstepVersions } from './check-lockstep-versions';
import { FLOWKIT_AUTH_VERSION } from '../packages/auth/src';
import { testingContractVersion } from '../packages/auth/src/testing/contract-suites';
import { FLOWKIT_CORE_VERSION } from '../packages/core/src';
import { FLOWKIT_DEFINITIONS_VERSION } from '../packages/definitions/src';
import { FLOWKIT_NOTIFY_VERSION } from '../packages/notify/src';
import { FLOWKIT_TASKS_VERSION } from '../packages/tasks/src';
import { FLOWKIT_TEMPORAL_VERSION } from '../packages/temporal/src';

const publicVersionContracts = [
  {
    name: '@naakwu/flowkit-auth',
    manifestPath: '../packages/auth/package.json',
    exports: [FLOWKIT_AUTH_VERSION, testingContractVersion],
  },
  {
    name: '@naakwu/flowkit-core',
    manifestPath: '../packages/core/package.json',
    exports: [FLOWKIT_CORE_VERSION],
  },
  {
    name: '@naakwu/flowkit-definitions',
    manifestPath: '../packages/definitions/package.json',
    exports: [FLOWKIT_DEFINITIONS_VERSION],
  },
  {
    name: '@naakwu/flowkit-notify',
    manifestPath: '../packages/notify/package.json',
    exports: [FLOWKIT_NOTIFY_VERSION],
  },
  {
    name: '@naakwu/flowkit-tasks',
    manifestPath: '../packages/tasks/package.json',
    exports: [FLOWKIT_TASKS_VERSION],
  },
  {
    name: '@naakwu/flowkit-temporal',
    manifestPath: '../packages/temporal/package.json',
    exports: [FLOWKIT_TEMPORAL_VERSION],
  },
];

describe('checkLockstepVersions', () => {
  test('returns the shared version when all seven package versions match', () => {
    expect(
      checkLockstepVersions([
        { name: '@naakwu/flowkit-core', version: '1.0.0' },
        { name: '@naakwu/flowkit-auth', version: '1.0.0' },
        { name: '@naakwu/flowkit-consumer', version: '1.0.0' },
        { name: '@naakwu/flowkit-definitions', version: '1.0.0' },
        { name: '@naakwu/flowkit-notify', version: '1.0.0' },
        { name: '@naakwu/flowkit-tasks', version: '1.0.0' },
        { name: '@naakwu/flowkit-temporal', version: '1.0.0' },
      ]),
    ).toBe('1.0.0');
  });

  test('reports every package whose version differs from the first package', () => {
    expect(() =>
      checkLockstepVersions([
        { name: '@naakwu/flowkit-core', version: '0.2.0' },
        { name: '@naakwu/flowkit-auth', version: '0.2.1' },
        { name: '@naakwu/flowkit-consumer', version: '0.3.0' },
      ]),
    ).toThrow(/flowkit-auth.*0\.2\.1[\s\S]*flowkit-consumer.*0\.3\.0/);
  });

  test.each(publicVersionContracts)('$name public version exports match its manifest', (contract) => {
    const manifest = JSON.parse(
      readFileSync(new URL(contract.manifestPath, import.meta.url), 'utf8'),
    ) as { version: string };

    for (const exportedVersion of contract.exports) {
      expect(exportedVersion).toBe(manifest.version);
    }
  });
});
