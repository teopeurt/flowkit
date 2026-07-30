import { describe, expect, it } from 'bun:test';
import { claimTask } from './claiming.js';
import { createLeaveApprovalFixture, leaveTransitionPlan } from './testing/leave-approval.fixture.js';

describe('leave approval integration fixture', () => {
  it('projects and claims a human task through public package APIs', async () => {
    const store = createLeaveApprovalFixture(); const plan = leaveTransitionPlan({ store, operationId: 'op-1', previousStage: 'employee', previousRole: null, nextStage: 'manager', nextRole: 'manager', actorId: null, action: 'submit', sequence: 1 }); await store.applyProjection({ plan, operationId: 'op-1' }); const task = [...store.tasks.values()][0];
    const claimed = await claimTask({ store, eligibility: { canWorkRole: async () => true }, command: { taskId: task.id, expectedRevision: 0, actorId: 'manager-1', operationId: 'claim-1', now: '2026-07-27T00:00:00.000Z' } });
    expect(claimed?.status).toBe('claimed'); expect((await store.history(task.id)).length).toBe(2);
  });
});
