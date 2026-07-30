import { describe, expect, it } from 'bun:test';
import { defineRoleRegistry } from './registry';
import { synchronizeRoles } from './synchronization';
import { InMemoryRoleStore } from '../testing/in-memory-role.store';
describe('role synchronization', () => {
  it('preserves an existing opaque id while reconciling metadata', async () => { const registry = defineRoleRegistry({ reviewer: { label: 'Reviewer', permissions: ['case:read'], scopes: ['case'], kind: 'external', provisioning: 'self_service' } } as const); const store = new InMemoryRoleStore(); await store.upsert({ key: 'reviewer', label: 'Old', permissions: ['old'], scopes: ['case'], readOnly: false }); const before = (await store.findByKey({ key: 'reviewer' }))!.id; await synchronizeRoles(registry, store); expect((await store.findByKey({ key: 'reviewer' }))!.id).toBe(before); expect((await store.findByKey({ key: 'reviewer' }))!.permissions).toEqual(['case:read']); });
});
