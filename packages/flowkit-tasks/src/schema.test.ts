import { describe, expect, it } from 'bun:test';
import { flowTaskSchema, taskInboxQuerySchema } from './schema.js';

describe('task schemas', () => {
  it('rejects assigned open tasks and unknown fields', () => {
    const task = { id: 'task-1', namespace: 'x', flowId: 'flow-1', subjectType: 'application', subjectId: 'a-1', stage: 'review', role: 'reviewer', status: 'open', assigneeId: 'actor-1', revision: 0, lifecycleEpoch: 0, dueAt: null, claimedAt: null, completedAt: null, openedOperationId: 'op-1', metadata: {}, createdAt: '2026-07-27T00:00:00.000Z', updatedAt: '2026-07-27T00:00:00.000Z' };
    expect(() => flowTaskSchema.parse(task)).toThrow();
    expect(() => taskInboxQuerySchema.parse({ view: 'role_queue', extra: true })).toThrow();
  });
});
