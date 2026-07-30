import { AuthError } from './errors';
import type { IdentityLinkStore, IdentityProof, ProvisioningDecision } from './contracts';
import type { RoleRegistry } from './roles/registry';

export async function provisionIdentity(input: { authUserId: string; proofs: readonly IdentityProof[]; decision: ProvisioningDecision; registry: RoleRegistry<any>; store: IdentityLinkStore }): Promise<{ subjectId: string }> {
  const existing = await input.store.findByAuthUser({ authUserId: input.authUserId });
  if (existing) return { subjectId: existing.subjectId };
  if (input.proofs.length === 0) throw new AuthError('identity_unverified', 'A verified identity proof is required');
  if (!input.registry.canSelfProvision(input.decision.role) && !input.decision.invitationAuthorized) throw new AuthError('provisioning_forbidden', 'Role cannot be self provisioned');
  const matches = (await Promise.all(input.proofs.map(proof => input.store.findByProof({ proof })))).filter(Boolean);
  const subjects = new Set(matches.map(match => match!.subjectId));
  if (subjects.size > 1) throw new AuthError('identity_collision', 'Verified identities belong to different subjects');
  if (matches[0]) {
    const claimed = await input.store.claimSubject({ subjectId: matches[0].subjectId, authUserId: input.authUserId });
    if (!claimed) {
      const winner = await input.store.findByAuthUser({ authUserId: input.authUserId });
      if (winner) return { subjectId: winner.subjectId };
      throw new AuthError('identity_already_claimed', 'Identity was claimed by another account');
    }
    return { subjectId: matches[0].subjectId };
  }
  const created = await input.store.createSubject({ authUserId: input.authUserId, proofs: input.proofs });
  return { subjectId: created.subjectId };
}
