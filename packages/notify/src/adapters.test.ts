import { describe, expect, it } from 'bun:test';
import { NotificationAdapterRegistry } from './adapters.js';
import { testAdapter } from './testing/test-adapters.js';

describe('adapter registry', () => {
  it('rejects duplicates and freezes boot configuration', () => {
    const registry = new NotificationAdapterRegistry(); registry.register(testAdapter('email'));
    expect(() => registry.register(testAdapter('email'))).toThrow(); registry.freeze();
    expect(() => registry.register(testAdapter('in-app'))).toThrow();
  });
});
