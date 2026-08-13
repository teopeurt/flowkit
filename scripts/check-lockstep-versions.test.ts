import { describe, expect, test } from 'bun:test';

import { checkLockstepVersions } from './check-lockstep-versions';

describe('checkLockstepVersions', () => {
  test('returns the shared version when all six package versions match', () => {
    expect(
      checkLockstepVersions([
        { name: '@naakwu/flowkit-core', version: '0.2.0' },
        { name: '@naakwu/flowkit-auth', version: '0.2.0' },
        { name: '@naakwu/flowkit-consumer', version: '0.2.0' },
        { name: '@naakwu/flowkit-notify', version: '0.2.0' },
        { name: '@naakwu/flowkit-tasks', version: '0.2.0' },
        { name: '@naakwu/flowkit-temporal', version: '0.2.0' },
      ]),
    ).toBe('0.2.0');
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
});
