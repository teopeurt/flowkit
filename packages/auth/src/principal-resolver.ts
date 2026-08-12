import { AuthError } from './errors';
import { freezePrincipal, type AuthenticatedPrincipal } from './principal';
import type { AuthAuditSink, AuthSession, IdentityLinkStore, MembershipResolver } from './contracts';
import type { RoleRegistry } from './roles/registry';

export async function resolvePrincipal(input: { authUserId: string; session: AuthSession; role?: string; registry: RoleRegistry<any>; identities: IdentityLinkStore; memberships: MembershipResolver; audit?: AuthAuditSink }): Promise<AuthenticatedPrincipal> {
  const link = await input.identities.findByAuthUser({ authUserId: input.authUserId });
  if (!link) throw new AuthError('identity_not_found', 'No domain identity is linked');
  const memberships = (await input.memberships.list({ subjectId: link.subjectId })).filter(membership => membership.eligible);
  let active = input.session.activeScope;
  if (active) {
    const found = memberships.find(m => m.scope.type === active!.type && m.scope.id === active!.id && (!active!.membershipId || m.id === active!.membershipId));
    if (!found) throw new AuthError('scope_required', 'Requested scope is not available');
    active = { ...found.scope, membershipId: found.id };
  } else if (memberships.length === 1) active = { ...memberships[0].scope, membershipId: memberships[0].id };
  else if (memberships.length > 1) throw new AuthError('scope_ambiguous', 'An active scope must be selected');
  const role = active ? memberships.find(m => m.scope.id === active!.id)?.role : input.role;
  const key = role && input.registry.normalizeRole(role);
  const definition = key && input.registry.getRole(key);
  if (!key || !definition) throw new AuthError('role_unknown', 'Principal role is not registered');
  await input.audit?.emit({ type: 'principal.resolved', outcome: 'success', role: key, scopeType: active?.type });
  return freezePrincipal({ authUserId: input.authUserId, subjectId: link.subjectId, role: key, permissions: Object.freeze([...definition.permissions]), readOnly: definition.readOnly === true, identityProofs: link.proofs, activeScope: active, session: { id: input.session.id, issuedAt: input.session.issuedAt, expiresAt: input.session.expiresAt } });
}
