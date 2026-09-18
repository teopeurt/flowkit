import { describe, expect, it } from 'bun:test';

import { createFlowkitTemporalRuntime } from './consumer-runtime';
import { publishDefinition } from './snapshot';
import type { FlowkitStateView } from './contracts';

const published = publishDefinition({
  definition: {
    id: 'leave-approval',
    version: 1,
    roles: ['employee'],
    initialStage: 'draft',
    stages: {
      draft: {
        actions: {
          submit: { to: 'submitted' },
        },
      },
      submitted: { final: true },
    },
  },
});

const subject = { id: 'leave-request-1', organizationId: 'org-1' };
const state: FlowkitStateView = {
  state: { stage: 'draft', status: 'draft', pendingRole: 'employee', tracks: {} },
  sequence: 0,
  stepResults: {},
  completed: false,
  nextActions: ['submit'],
};

async function leaveWorkflow() {
  return state;
}

function fakeWorkflowClient() {
  const started: Array<Record<string, unknown>> = [];
  const updates: Array<{ name: string; updateId?: string; args?: unknown[] }> = [];
  const handle = {
    query: async () => state,
    executeUpdate: async (name: string, options: { updateId?: string; args?: unknown[] }) => {
      updates.push({ name, ...options });
      return state;
    },
  };

  return {
    started,
    updates,
    workflow: {
      start: async (_workflowType: unknown, options: Record<string, unknown>) => {
        started.push(options);
        return handle;
      },
      getHandle: (_flowId: string) => handle,
    },
  };
}

describe('createFlowkitTemporalRuntime', () => {
  it('maps a Flowkit start and action to the generic interpreter contract', async () => {
    const client = fakeWorkflowClient();
    const runtime = createFlowkitTemporalRuntime({
      client,
      taskQueue: 'flowkit-demo',
      workflowType: leaveWorkflow,
      healthProbe: async () => ({ ready: true, checkedAt: '2026-07-29T00:00:00.000Z' }),
    });

    await runtime.start({ flowId: 'leave-1', published, subject, operationId: 'start-1' });
    await runtime.act({ flowId: 'leave-1', action: 'submit', actorId: 'employee-1', operationId: 'submit-1' });
    await runtime.signal({ flowId: 'leave-1', action: 'refresh', operationId: 'refresh-1' });

    expect(client.started[0]).toMatchObject({ workflowId: 'leave-1', args: [{ published, subject }] });
    expect(client.updates[0]).toEqual({ name: 'applyAction', updateId: 'submit-1', args: [{ action: 'submit', actorId: 'employee-1' }] });
    expect(client.updates[1]).toEqual({ name: 'applySignal', updateId: 'refresh-1', args: [{ action: 'refresh', comment: undefined }] });
  });
});
