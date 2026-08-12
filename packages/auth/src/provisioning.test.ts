import { describe, expect, it } from 'bun:test';
import { defineRoleRegistry } from './roles';
import { provisionIdentity } from './provisioning';
import { InMemoryIdentityLinkStore } from './testing/in-memory-identity-link.store';
describe('identity provisioning', () => {
  const registry = defineRoleRegistry({ employee: { label: 'Employee', permissions: ['read'], scopes: ['company'], kind: 'external', provisioning: 'self_service' }, admin: { label: 'Admin', permissions: ['read'], scopes: ['company'], kind: 'internal', provisioning: 'invite_only' } } as const);
  it('is idempotent for the same authenticated identity', async () => { const store = new InMemoryIdentityLinkStore(); const input = { authUserId: 'auth-1', proofs: [{ kind: 'email' as const, normalizedValue: 'person@example.com', verified: true as const }], decision: { role: 'employee' }, registry, store }; const first = await provisionIdentity(input); const second = await provisionIdentity(input); expect(second).toEqual(first); });
  it('denies unverified or invite-only public provisioning', async () => { const store = new InMemoryIdentityLinkStore(); await expect(provisionIdentity({ authUserId: 'a', proofs: [], decision: { role: 'employee' }, registry, store })).rejects.toMatchObject({ code: 'identity_unverified' }); await expect(provisionIdentity({ authUserId: 'b', proofs: [{ kind: 'email', normalizedValue: 'a@example.com', verified: true }], decision: { role: 'admin' }, registry, store })).rejects.toMatchObject({ code: 'provisioning_forbidden' }); });
});
