import { describe, expect, it } from 'bun:test';
import type { FlowTask, TaskClaimCommand, TaskInboxQuery, TaskStore } from '@naakwu/flowkit-tasks';
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
const manager: FlowkitActorRef = { id: 'manager-browser-id', roles: ['employee', 'super_admin'] };
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
      expect(command).toMatchObject({ expectedRevision: 0, actorId: 'manager-server-id', operationId: 'claim-1' });
      calls.push(`claim:${command.taskId}`);
      return { task: { id: command.taskId } as FlowTask };
    },
    inbox: async (query: TaskInboxQuery) => {
      expect(query).toMatchObject({
        view: 'role_queue',
        actorId: 'manager-server-id',
        roles: ['manager'],
        statuses: ['open', 'claimed'],
      });
      calls.push('list:manager');
      return { items: [], nextCursor: null };
    },
  } as unknown as TaskStore;
}

describe('createFlowkitConsumer', () => {
  it('uses public Flowkit ports for start, action, and claim', async () => {
    const calls: string[] = [];
    const consumer = createFlowkitConsumer({
      definition,
      runtime: fakeRuntime(calls),
      tasks: fakeTasks(calls),
      actorResolver: {
        resolve: async (actorId) =>
          actorId === 'manager-browser-id'
            ? { id: 'manager-server-id', roles: ['manager'] }
            : { id: 'employee-server-id', roles: ['employee'] },
      },
      eligibility: { canWorkRole: async () => true },
      clock: { now: () => '2026-07-29T00:00:00.000Z' },
      views: { read: (view) => view, readByFlowId: async () => state },
    });

    await consumer.start({ flowId: 'leave-1', subject, actor: employee, operationId: 'start-1' });
    await consumer.act({ flowId: 'leave-1', action: 'submit', actor: employee, operationId: 'submit-1' });
    await consumer.tasks.claim({ taskId: 'task-1', expectedRevision: 0, actor: manager, operationId: 'claim-1' });
    await consumer.tasks.list({ actor: manager });

    expect(calls).toEqual(['start:leave-1', 'act:submit-1', 'claim:task-1', 'list:manager']);
  });

  it('only returns open tasks the canonical actor is eligible to claim while retaining its claims', async () => {
    const openAssigned = { id: 'task-assigned', role: 'manager', status: 'open', assigneeId: null } as FlowTask;
    const openUnassigned = { id: 'task-unassigned', role: 'manager', status: 'open', assigneeId: null } as FlowTask;
    const claimedByManager = { id: 'task-claimed', role: 'manager', status: 'claimed', assigneeId: 'manager-server-id' } as FlowTask;
    const consumer = createFlowkitConsumer({
      definition,
      runtime: fakeRuntime([]),
      tasks: {
        inbox: async () => ({ items: [openAssigned, openUnassigned, claimedByManager], nextCursor: null }),
      } as unknown as TaskStore,
      actorResolver: { resolve: async () => ({ id: 'manager-server-id', roles: ['manager'] }) },
      eligibility: { canWorkRole: async ({ task }) => task.id === openAssigned.id },
      clock: { now: () => '2026-07-29T00:00:00.000Z' },
      views: { read: (view) => view, readByFlowId: async () => state },
    });

    const page = await consumer.tasks.list({ actor: manager });

    expect(page.items.map((task) => task.id)).toEqual([openAssigned.id, claimedByManager.id]);
  });
});
