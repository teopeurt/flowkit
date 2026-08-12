import { describe, expect, it } from 'bun:test';
import { createTaskInvitation, redeemTaskInvitation } from './invitations.js';
import { createLeaveApprovalFixture, leaveTransitionPlan } from './testing/leave-approval.fixture.js';

describe('task invitations', () => {
  it('creates hash-only invitations and redeems them once', async () => {
    const store = createLeaveApprovalFixture(); const plan = leaveTransitionPlan({ store, operationId: 'open', previousStage: 'employee', previousRole: null, nextStage: 'manager', nextRole: 'manager', actorId: null, action: 'submit', sequence: 1 }); await store.applyProjection({ plan, operationId: 'open' });
    const task = [...store.tasks.values()][0]; const identity = { normalizeContact: ({ value }: { kind: 'email' | 'phone'; value: string }) => value.toLowerCase(), hashContact: ({ normalized }: { kind: 'email' | 'phone'; normalized: string }) => `contact:${normalized}`, verify: async ({ contactHash }: { kind: 'email' | 'phone'; contactHash: string }) => ({ identityId: 'actor-1', contactHash }) };
    const created = await createTaskInvitation({ store, identity, notifier: { notify: async () => {} }, clock: { now: () => '2026-07-27T00:00:00.000Z' }, task, contact: { kind: 'email', value: 'User@example.test' }, rawToken: 'a'.repeat(64), expiresAt: '2026-07-28T00:00:00.000Z', sourceKey: 'invite-1' });
    expect(created.invitation.tokenHash).not.toContain(created.rawToken);
    const redeemed = await redeemTaskInvitation({ store, identity, clock: { now: () => '2026-07-27T00:00:01.000Z' }, rawToken: created.rawToken, contact: { kind: 'email', value: 'user@example.test' }, operationId: 'redeem-1' });
    expect(redeemed.task.assigneeId).toBe('actor-1');
    await expect(redeemTaskInvitation({ store, identity, clock: { now: () => '2026-07-27T00:00:02.000Z' }, rawToken: created.rawToken, contact: { kind: 'email', value: 'user@example.test' }, operationId: 'redeem-2' })).rejects.toThrow();
  });
});
