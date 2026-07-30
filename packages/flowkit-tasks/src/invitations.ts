import type { TaskClock, TaskIdentityGateway, TaskInvitation, TaskInvitationNotifier, TaskStore } from './contracts.js';
import { FlowkitTaskError } from './errors.js';
import { hashInvitationToken, requireTokenEntropy } from './token.js';

export async function createTaskInvitation(input: { store: TaskStore; identity: TaskIdentityGateway; notifier: TaskInvitationNotifier; clock: TaskClock; task: { id: string; subjectType: string; subjectId: string; role: string }; contact: { kind: 'email' | 'phone'; value: string }; rawToken: string; expiresAt: string; sourceKey: string; metadata?: Record<string, any> }): Promise<{ invitation: TaskInvitation; rawToken: string }> {
  requireTokenEntropy(input.rawToken);
  const normalized = input.identity.normalizeContact(input.contact);
  const contactHash = input.identity.hashContact({ kind: input.contact.kind, normalized });
  const invitation = await input.store.createInvitation({ taskId: input.task.id, subjectType: input.task.subjectType, subjectId: input.task.subjectId, role: input.task.role, contactKind: input.contact.kind, contactHash, contactHashKeyVersion: 'v1', tokenHash: hashInvitationToken(input.rawToken), expiresAt: input.expiresAt, sourceKey: input.sourceKey, metadata: input.metadata ?? {} });
  await input.notifier.notify({ invitation, rawToken: input.rawToken, sourceKey: input.sourceKey });
  return { invitation, rawToken: input.rawToken };
}

export async function redeemTaskInvitation(input: { store: TaskStore; identity: TaskIdentityGateway; clock: TaskClock; rawToken: string; contact: { kind: 'email' | 'phone'; value: string }; operationId: string }): Promise<{ invitation: TaskInvitation; task: import('./contracts.js').FlowTask }> {
  const invitation = await input.store.getInvitationByTokenHash(hashInvitationToken(input.rawToken));
  if (!invitation || invitation.status !== 'pending' || invitation.expiresAt <= input.clock.now()) throw new FlowkitTaskError('invitation_invalid', 'Invitation is invalid');
  const normalized = input.identity.normalizeContact(input.contact);
  const proof = await input.identity.verify({ kind: input.contact.kind, contactHash: input.identity.hashContact({ kind: input.contact.kind, normalized }) });
  if (proof.contactHash !== invitation.contactHash) throw new FlowkitTaskError('invitation_identity_mismatch', 'Invitation identity does not match');
  const result = await input.store.redeemInvitation({ invitationId: invitation.id, identityId: proof.identityId, expectedExpiry: invitation.expiresAt, now: input.clock.now(), operationId: input.operationId });
  if (!result) throw new FlowkitTaskError('invitation_invalid', 'Invitation is invalid');
  return result;
}
