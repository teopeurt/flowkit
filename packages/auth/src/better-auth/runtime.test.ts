import { expect, it } from 'bun:test';
import { createAuthRuntime } from './runtime';
import { defineRoleRegistry } from '../roles';
it('creates independent runtimes and rejects weak production secrets', () => { const registry = defineRoleRegistry({ user: { label: 'User', permissions: ['read'], scopes: ['app'], kind: 'external', provisioning: 'self_service' } }); expect(() => createAuthRuntime({ database: {}, secret: 'short', baseURL: 'https://app.example', trustedOrigins: ['https://app.example'], roleRegistry: registry, environment: 'production' })).toThrow(); const options = { database: {}, secret: 'x'.repeat(32), baseURL: 'https://app.example', trustedOrigins: ['https://app.example'], roleRegistry: registry }; expect(createAuthRuntime(options)).not.toBe(createAuthRuntime(options)); });
