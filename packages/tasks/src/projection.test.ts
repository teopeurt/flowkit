import { describe, expect, it } from 'bun:test';
import { planTaskProjection } from './projection.js';
import { leaveApprovalDefinition } from './testing/leave-approval.fixture.js';

describe('task projection', () => {
  it('opens destinations and reopens the same logical task on self-transition', () => {
    const base = { namespace: 'fixture', flowId: 'flow-1', subject: { type: 'leave', id: 'leave-1' }, definition: leaveApprovalDefinition, operationId: 'op-1', transitionSequence: 1, action: 'submit', actorId: 'actor', previousState: { stage: 'employee', status: 'active', pendingRole: 'employee', tracks: {} }, nextState: { stage: 'manager', status: 'active', pendingRole: 'manager', tracks: {} } };
    const first = planTaskProjection(base, null); expect(first.mutations.length).toBe(1); expect(first.events[0].eventType).toBe('opened');
    const self = planTaskProjection({ ...base, operationId: 'op-2', transitionSequence: 2, previousState: base.nextState, nextState: base.nextState }, { id: 't', namespace: 'fixture', flowId: 'flow-1', subjectType: 'leave', subjectId: 'leave-1', stage: 'manager', role: 'manager', status: 'claimed', assigneeId: 'actor', revision: 1, lifecycleEpoch: 0, dueAt: null, claimedAt: null, completedAt: null, openedOperationId: 'op-1', metadata: {}, createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:00:00.000Z' });
    expect(self.events.map((event) => event.eventType)).toEqual(['completed', 'reopened']);
  });
});
