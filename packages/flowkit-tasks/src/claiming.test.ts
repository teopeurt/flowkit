import { describe, expect, it } from 'bun:test';
import { claimTask } from './claiming.js';
import { createLeaveApprovalFixture, leaveTransitionPlan } from './testing/leave-approval.fixture.js';

describe('task claiming', () => {
  it('allows exactly one revision winner', async () => {
    const store = createLeaveApprovalFixture(); const plan = leaveTransitionPlan({ store, operationId: 'op-1', previousStage: 'employee', previousRole: null, nextStage: 'manager', nextRole: 'manager', actorId: 'system', action: 'submit', sequence: 1 });
    await store.applyProjection({ plan, operationId: 'op-1' }); const task = [...store.tasks.values()][0];
    const eligibility = { canWorkRole: async () => true };
    const winner = await claimTask({ store, eligibility, command: { taskId: task.id, expectedRevision: 0, actorId: 'actor-a', operationId: 'claim-a', now: '2026-07-27T00:00:00.000Z' } });
    expect(winner?.assigneeId).toBe('actor-a');
    await expect(claimTask({ store, eligibility, command: { taskId: task.id, expectedRevision: 0, actorId: 'actor-b', operationId: 'claim-b', now: '2026-07-27T00:00:01.000Z' } })).rejects.toThrow();
  });
});
