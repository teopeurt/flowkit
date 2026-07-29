import { describe, expect, it } from 'bun:test';
import type { FlowTask, TaskClaimCommand, TaskStore } from '@flowkit/tasks';
import {
  createFlowkitConsumer,
  type FlowkitActorRef,
  type FlowkitStateView,
  type FlowkitSubject,
  type FlowRuntime,
  type PublishedFlowDefinition,
} from '../src/index.js';

const definition: PublishedFlowDefinition = {
  definitionSnapshot: {
    id: 'leave-approval',
    version: 1,
    roles: ['employee', 'manager'],
    initialStage: 'employee',
    stages: { employee: { actions: { submit: { to: 'manager', kind: 'human' } } }, manager: { final: true } },
  },
  definitionHash: 'sha256:leave-approval',
};

const subject: FlowkitSubject = { id: 'leave-1' };
const employee: FlowkitActorRef = { id: 'employee-browser-id', roles: ['untrusted-browser-role'] };
const manager: FlowkitActorRef = { id: 'manager-1', roles: ['manager'] };
const state: FlowkitStateView = {
  state: { stage: 'employee', status: 'active', pendingRole: 'employee', tracks: {} },
  sequence: 0,
  stepResults: {},
  completed: false,
  nextActions: ['submit'],
};

function fakeRuntime(calls: string[]): FlowRuntime {
  return {
    start: async ({ flowId }) => {
      calls.push(`start:${flowId}`);
      return state;
    },
    act: async ({ operationId, actorId }) => {
      expect(actorId).toBe('employee-server-id');
      calls.push(`act:${operationId}`);
      return state;
    },
    get: async () => state,
    health: async () => ({ ready: true, checkedAt: '2026-07-29T00:00:00.000Z' }),
  };
}

function fakeTasks(calls: string[]): TaskStore {
  return {
    get: async () => ({ id: 'task-1', role: 'manager' } as FlowTask),
    claim: async (command: TaskClaimCommand) => {
      expect(command).toMatchObject({ expectedRevision: 0, actorId: 'manager-1', operationId: 'claim-1' });
      calls.push(`claim:${command.taskId}`);
      return { task: { id: command.taskId } as FlowTask };
    },
    inbox: async () => ({ items: [], nextCursor: null }),
  } as unknown as TaskStore;
}

describe('createFlowkitConsumer', () => {
  it('uses public Flowkit ports for start, action, and claim', async () => {
    const calls: string[] = [];
    const consumer = createFlowkitConsumer({
      definition,
      runtime: fakeRuntime(calls),
      tasks: fakeTasks(calls),
      actorResolver: { resolve: async () => ({ id: 'employee-server-id', roles: ['employee'] }) },
      eligibility: { canWorkRole: async () => true },
      clock: { now: () => '2026-07-29T00:00:00.000Z' },
      views: { read: (view) => view, readByFlowId: async () => state },
    });

    await consumer.start({ flowId: 'leave-1', subject, actor: employee, operationId: 'start-1' });
    await consumer.act({ flowId: 'leave-1', action: 'submit', actor: employee, operationId: 'submit-1' });
    await consumer.tasks.claim({ taskId: 'task-1', expectedRevision: 0, actor: manager, operationId: 'claim-1' });

    expect(calls).toEqual(['start:leave-1', 'act:submit-1', 'claim:task-1']);
  });
});
