import { describe, expect, test } from 'bun:test';
import { assertPublishableManifest } from './check-publishable-manifests';

describe('publishable manifest guard', () => {
  test('rejects workspace and path dependency protocols', () => {
    expect(() => assertPublishableManifest({ name: 'x', version: '1.1.0', dependencies: { '@teopeurt/flowkit-core': 'workspace:^' } }, new Map([['@teopeurt/flowkit-core', '1.1.0']]))).toThrow(/workspace/);
    expect(() => assertPublishableManifest({ name: 'x', version: '1.1.0', devDependencies: { foo: 'file:../foo' } }, new Map())).toThrow(/file/);
  });
  test('accepts concrete internal ranges satisfied by sibling versions', () => {
    expect(() => assertPublishableManifest({ name: 'x', version: '1.1.0', dependencies: { '@teopeurt/flowkit-core': '^1.1.0' } }, new Map([['@teopeurt/flowkit-core', '1.1.0']]))).not.toThrow();
  });
});
