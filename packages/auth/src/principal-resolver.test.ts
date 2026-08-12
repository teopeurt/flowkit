import { describe, expect, it } from 'bun:test';
import { defineRoleRegistry } from './roles';
import { resolvePrincipal } from './principal-resolver';
import { InMemoryIdentityLinkStore } from './testing/in-memory-identity-link.store';
describe('principal resolution', () => {
  it('rejects ambiguous memberships instead of selecting an arbitrary row', async () => { const identities = new InMemoryIdentityLinkStore(); await identities.createSubject({ authUserId: 'a', proofs: [{ kind: 'email', normalizedValue: 'a@example.com', verified: true }] }); const registry = defineRoleRegistry({ reviewer: { label: 'Reviewer', permissions: ['read'], scopes: ['company'], kind: 'external', provisioning: 'self_service' } } as const); await expect(resolvePrincipal({ authUserId: 'a', session: { id: 's', authUserId: 'a', expiresAt: '2030-01-01T00:00:00Z' }, registry, identities, memberships: { list: async () => [{ id: '1', scope: { type: 'company', id: 'one' }, role: 'reviewer', eligible: true }, { id: '2', scope: { type: 'company', id: 'two' }, role: 'reviewer', eligible: true }] } })).rejects.toMatchObject({ code: 'scope_ambiguous' }); });
});
