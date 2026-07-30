import { describe, expect, it } from 'bun:test';
import { defineRoleRegistry } from './registry';
describe('role registry', () => {
  const registry = defineRoleRegistry({ reviewer: { label: 'Reviewer', aliases: ['review'], permissions: ['case:read'], scopes: ['case'], kind: 'external', provisioning: 'self_service' }, readonly: { label: 'Readonly', permissions: ['case:read'], scopes: ['case'], kind: 'internal', provisioning: 'invite_only', readOnly: true } } as const);
  it('normalizes only declared aliases and denies unknown values', () => { expect(registry.normalizeRole('review')).toBe('reviewer'); expect(registry.normalizeRole('REVIEWER')).toBeUndefined(); expect(registry.hasPermission('unknown', 'case:read')).toBe(false); });
  it('rejects alias collisions', () => expect(() => defineRoleRegistry({ one: { label: 'One', aliases: ['two'], permissions: ['x'], scopes: ['s'], kind: 'external', provisioning: 'self_service' }, two: { label: 'Two', permissions: ['x'], scopes: ['s'], kind: 'external', provisioning: 'self_service' } })).toThrow());
  it('denies self provisioning for readonly invite roles', () => expect(registry.canSelfProvision('readonly')).toBe(false));
});
