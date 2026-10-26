import { describe, expect, test } from 'bun:test';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { WorkflowUpdateStage } from '@temporalio/client';

import { testActivities } from './testing/test-activities';
import {
  blockedRuleFlowkitWorkflow,
  entryFlowkitInput,
  entryFlowkitWorkflow,
  factFlowkitInput,
  factFlowkitWorkflow,
  loopFlowkitInput,
  loopFlowkitWorkflow,
  protoRuleFlowkitInput,
  protoRuleFlowkitWorkflow,
  notifySlaInput,
  notifySlaWorkflow,
  actionSlaInput,
  actionSlaWorkflow,
  adaptedFlowkitWorkflow,
  continuationInput,
  continuationWorkflow,
  ruleFlowkitWorkflow,
  updateRuleFlowkitInput,
  updateRuleFlowkitWorkflow,
  signalFlowkitInput,
  signalFlowkitWorkflow,
  testFlowkitInput,
  testFlowkitWorkflow,
} from './testing/interpreter.fixture';

const expectRejected = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    expect(error instanceof Error).toBe(true);
    return;
  }
  throw new Error('Expected the Update to reject.');
};
const waitForStage = async (handle: { query: (name: string) => Promise<unknown> }, stage: string) => {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const current = (await handle.query('getState') as { state: { stage: string } }).state.stage;
    if (current === stage || Date.now() > deadline) return current;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

const testWithTimeout = test as unknown as (
  name: string,
  fn: () => Promise<void>,
  timeout: number,
) => void;

describe('createFlowkitWorkflow', () => {
  testWithTimeout('uses the adapted state shape for queries', async () => {
    const environment = await TestWorkflowEnvironment.createLocal();
    const taskQueue = 'flowkit-temporal-workflow-test';
    const worker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue,
      workflowsPath: new URL('./testing/interpreter.fixture.ts', import.meta.url).pathname,
      activities: testActivities,
    });
    const runWorker = worker.run();

    try {
      const handle = await environment.client.workflow.start(adaptedFlowkitWorkflow, {
        taskQueue,
        workflowId: 'flowkit-adapted-query',
        args: [testFlowkitInput()],
      });

      expect(await handle.query('getState')).toEqual({ legacyStage: 'draft' });
      await handle.cancel();
    } finally {
      await worker.shutdown();
      await runWorker;
      await environment.teardown();
    }
  }, 30_000);

  testWithTimeout('serializes concurrent updates in accepted arrival order and drains them through a final transition', async () => {
    const environment = await TestWorkflowEnvironment.createLocal();
    const taskQueue = 'flowkit-temporal-workflow-test';
    const worker = await Worker.create({
      connection: environment.nativeConnection,
      taskQueue,
      workflowsPath: new URL('./testing/interpreter.fixture.ts', import.meta.url).pathname,
      activities: testActivities,
    });
    const runWorker = worker.run();

    try {
      testActivities.reset();
      testActivities.blockNextProjection = true;
      const projectionStarted = testActivities.waitForProjection();
      const handle = await environment.client.workflow.start(testFlowkitWorkflow, {
        taskQueue,
        workflowId: 'flowkit-serialized-updates',
        args: [testFlowkitInput()],
      });

      const first = await handle.startUpdate('applyAction', {
        updateId: 'operation-1',
        args: [{ action: 'submit', comment: 'first' }],
        waitForStage: WorkflowUpdateStage.ACCEPTED,
      });
      await projectionStarted;
      const second = await handle.startUpdate('applyAction', {
        updateId: 'operation-2',
        args: [{ action: 'approve', comment: 'second' }],
        waitForStage: WorkflowUpdateStage.ACCEPTED,
      });
      testActivities.unblockProjection();

      expect((await first.result() as { state: { stage: string } }).state.stage).toBe('review');
      expect((await second.result() as { state: { stage: string } }).state.stage).toBe('approved');
      expect((await handle.result() as { state: { stage: string } }).state.stage).toBe('approved');
      expect(testActivities.transitions.map((transition) => transition.operationId)).toEqual([
        'operation-1',
        'operation-2',
      ]);
    } finally {
      await worker.shutdown();
      await runWorker;
      await environment.teardown();
    }
  }, 30_000);

  testWithTimeout('leaves query state unchanged when projection fails', async () => {
    const environment = await TestWorkflowEnvironment.createLocal();
    const worker = await Worker.create({ connection: environment.nativeConnection, taskQueue: 'flowkit-temporal-workflow-test', workflowsPath: new URL('./testing/interpreter.fixture.ts', import.meta.url).pathname, activities: testActivities });
    const runWorker = worker.run();
    try {
      testActivities.reset();
      testActivities.failNextProjection = true;
      const handle = await environment.client.workflow.start(testFlowkitWorkflow, { taskQueue: 'flowkit-temporal-workflow-test', workflowId: 'flowkit-projection-failure', args: [testFlowkitInput()] });
      await expectRejected(handle.executeUpdate('applyAction', { updateId: 'projection-failure', args: [{ action: 'submit', comment: 'first' }] }));
      expect((await handle.query('getState') as { state: { stage: string } }).state.stage).toBe('draft');
      expect(testActivities.transitions.length).toBe(0);
      await handle.cancel();
    } finally { await worker.shutdown(); await runWorker; await environment.teardown(); }
  }, 30_000);

  testWithTimeout('records action and destination entry notifications in transition order', async () => {
    const environment = await TestWorkflowEnvironment.createLocal();
    const worker = await Worker.create({ connection: environment.nativeConnection, taskQueue: 'flowkit-temporal-workflow-test', workflowsPath: new URL('./testing/interpreter.fixture.ts', import.meta.url).pathname, activities: testActivities });
    const runWorker = worker.run();
    try {
      testActivities.reset();
      const handle = await environment.client.workflow.start(testFlowkitWorkflow, { taskQueue: 'flowkit-temporal-workflow-test', workflowId: 'entry-notifications', args: [testFlowkitInput()] });
      await handle.executeUpdate('applyAction', { updateId: 'submit-notify', args: [{ action: 'submit', comment: 'allowed' }] });
      expect(testActivities.transitions[0].notifications).toEqual([
        { template: 'submitted', channels: ['inbox'] },
        { template: 'reviewReady', channels: ['inbox'] },
      ]);
      await handle.cancel();
    } finally { await worker.shutdown(); await runWorker; await environment.teardown(); }
  }, 30_000);

  testWithTimeout('returns a prior projection result for a duplicate operation without recording another transition', async () => {
    const environment = await TestWorkflowEnvironment.createLocal();
    const worker = await Worker.create({ connection: environment.nativeConnection, taskQueue: 'flowkit-temporal-workflow-test', workflowsPath: new URL('./testing/interpreter.fixture.ts', import.meta.url).pathname, activities: testActivities });
    const runWorker = worker.run();
    try {
      testActivities.reset();
      testActivities.priorResult = { state: { stage: 'review', status: 'pending', pendingRole: 'manager', tracks: {} } };
      const handle = await environment.client.workflow.start(testFlowkitWorkflow, { taskQueue: 'flowkit-temporal-workflow-test', workflowId: 'flowkit-duplicate', args: [testFlowkitInput()] });
      expect((await handle.executeUpdate('applyAction', { updateId: 'duplicate-operation', args: [{ action: 'submit', comment: 'first' }] }) as { state: { stage: string } }).state.stage).toBe('review');
      expect(testActivities.transitions.length).toBe(0);
      await handle.cancel();
    } finally { await worker.shutdown(); await runWorker; await environment.teardown(); }
  }, 30_000);

  testWithTimeout('never projects unauthorized or guard-rejected actions', async () => {
    const environment = await TestWorkflowEnvironment.createLocal();
    const worker = await Worker.create({ connection: environment.nativeConnection, taskQueue: 'flowkit-temporal-workflow-test', workflowsPath: new URL('./testing/interpreter.fixture.ts', import.meta.url).pathname, activities: testActivities });
    const runWorker = worker.run();
    try {
      testActivities.reset();
      const handle = await environment.client.workflow.start(testFlowkitWorkflow, { taskQueue: 'flowkit-temporal-workflow-test', workflowId: 'flowkit-rejections', args: [testFlowkitInput()] });
      await expectRejected(handle.executeUpdate('applyAction', { updateId: 'unauthorized', args: [{ action: 'submit', comment: 'unauthorized' }] }));
      await expectRejected(handle.executeUpdate('applyAction', { updateId: 'guard-rejected', args: [{ action: 'submit', comment: 'blocked' }] }));
      expect(testActivities.transitions.length).toBe(0);
      await handle.cancel();
    } finally { await worker.shutdown(); await runWorker; await environment.teardown(); }
  }, 30_000);

  testWithTimeout('runs initial entry steps in declaration order and re-runs them after a self-transition', async () => {
    const environment = await TestWorkflowEnvironment.createLocal();
    const worker = await Worker.create({ connection: environment.nativeConnection, taskQueue: 'flowkit-temporal-workflow-test', workflowsPath: new URL('./testing/interpreter.fixture.ts', import.meta.url).pathname, activities: testActivities });
    const runWorker = worker.run();
    try {
      testActivities.reset();
      const handle = await environment.client.workflow.start(entryFlowkitWorkflow, { taskQueue: 'flowkit-temporal-workflow-test', workflowId: 'entry-reentry', args: [entryFlowkitInput()] });
      await handle.executeUpdate('applyAction', { updateId: 'self', args: [{ action: 'self', comment: 'again' }] });
      expect((await handle.query('getState') as { stepResults: Record<string, { output: string }> }).stepResults['0:0'].output).toBe('system:prepare');
      expect(testActivities.systemSteps).toEqual(['prepare', 'notify', 'prepare', 'notify']);
      await handle.cancel();
    } finally { await worker.shutdown(); await runWorker; await environment.teardown(); }
  }, 30_000);

  testWithTimeout('passes completed entry-step object output to later rules with a stable idempotency key', async () => {
    const environment = await TestWorkflowEnvironment.createLocal();
    const worker = await Worker.create({ connection: environment.nativeConnection, taskQueue: 'flowkit-temporal-workflow-test', workflowsPath: new URL('./testing/interpreter.fixture.ts', import.meta.url).pathname, activities: testActivities });
    const runWorker = worker.run();
    try {
      testActivities.reset();
      const handle = await environment.client.workflow.start(factFlowkitWorkflow, { taskQueue: 'flowkit-temporal-workflow-test', workflowId: 'entry-facts', args: [factFlowkitInput()] });
      expect(await waitForStage(handle, 'approved')).toBe('approved');
      expect(testActivities.systemStepInputs).toEqual([{ workflowId: 'entry-facts', entryEpoch: 0, stepIndex: 0, idempotencyKey: '["entry-facts",0,0]' }]);
      await handle.cancel();
    } finally { await worker.shutdown(); await runWorker; await environment.teardown(); }
  }, 30_000);

  testWithTimeout('treats a rule ref named like an Object.prototype member as unregistered instead of failing the workflow task', async () => {
    const environment = await TestWorkflowEnvironment.createLocal();
    const worker = await Worker.create({ connection: environment.nativeConnection, taskQueue: 'flowkit-temporal-workflow-test', workflowsPath: new URL('./testing/interpreter.fixture.ts', import.meta.url).pathname, activities: testActivities });
    const runWorker = worker.run();
    try {
      testActivities.reset();
      const handle = await environment.client.workflow.start(protoRuleFlowkitWorkflow, { taskQueue: 'flowkit-temporal-workflow-test', workflowId: 'proto-rule', args: [protoRuleFlowkitInput()] });
      // `rules.constructor` would resolve to Object.prototype.constructor; calling `.run` on it
      // throws inside the workflow and wedges the task, so the query below would never answer.
      const view = await handle.query('getState') as { state: { stage: string }; completed: boolean };
      expect(view.state.stage).toBe('checking');
      expect(view.completed).toBe(false);
      await handle.cancel();
    } finally { await worker.shutdown(); await runWorker; await environment.teardown(); }
  }, 30_000);

  testWithTimeout('includes workflow identity in entry-step idempotency keys', async () => {
    const environment = await TestWorkflowEnvironment.createLocal();
    const worker = await Worker.create({ connection: environment.nativeConnection, taskQueue: 'flowkit-temporal-workflow-test', workflowsPath: new URL('./testing/interpreter.fixture.ts', import.meta.url).pathname, activities: testActivities });
    const runWorker = worker.run();
    try {
      testActivities.reset();
      const first = await environment.client.workflow.start(factFlowkitWorkflow, { taskQueue: 'flowkit-temporal-workflow-test', workflowId: 'entry-key-first', args: [factFlowkitInput()] });
      const second = await environment.client.workflow.start(factFlowkitWorkflow, { taskQueue: 'flowkit-temporal-workflow-test', workflowId: 'entry-key-second', args: [factFlowkitInput()] });
      await Promise.all([first.result(), second.result()]);

      expect(testActivities.systemStepInputs.length).toBe(2);
      expect(new Set(testActivities.systemStepInputs.map((step) => step.idempotencyKey)).size).toBe(2);
      expect(testActivities.systemStepInputs.map((step) => ({ workflowId: step.workflowId, entryEpoch: step.entryEpoch, stepIndex: step.stepIndex })).sort((a, b) => a.workflowId.localeCompare(b.workflowId))).toEqual([
        { workflowId: 'entry-key-first', entryEpoch: 0, stepIndex: 0 },
        { workflowId: 'entry-key-second', entryEpoch: 0, stepIndex: 0 },
      ]);
    } finally { await worker.shutdown(); await runWorker; await environment.teardown(); }
  }, 30_000);

  testWithTimeout('rejects a human actor from another organization before projection', async () => {
    const environment = await TestWorkflowEnvironment.createLocal();
    const worker = await Worker.create({ connection: environment.nativeConnection, taskQueue: 'flowkit-temporal-workflow-test', workflowsPath: new URL('./testing/interpreter.fixture.ts', import.meta.url).pathname, activities: testActivities });
    const runWorker = worker.run();
    try {
      testActivities.reset();
      const handle = await environment.client.workflow.start(testFlowkitWorkflow, { taskQueue: 'flowkit-temporal-workflow-test', workflowId: 'tenant-rejection', args: [testFlowkitInput()] });
      await expectRejected(handle.executeUpdate('applyAction', { updateId: 'wrong-tenant', args: [{ action: 'submit', comment: 'wrong-tenant' }] }));
      expect(testActivities.transitions).toEqual([]);
      await handle.cancel();
    } finally { await worker.shutdown(); await runWorker; await environment.teardown(); }
  }, 30_000);

  testWithTimeout('rejects an untrusted signal caller without an activity-resolved actor', async () => {
    const environment = await TestWorkflowEnvironment.createLocal();
    const worker = await Worker.create({ connection: environment.nativeConnection, taskQueue: 'flowkit-temporal-workflow-test', workflowsPath: new URL('./testing/interpreter.fixture.ts', import.meta.url).pathname, activities: testActivities });
    const runWorker = worker.run();
    try {
      testActivities.reset();
      const handle = await environment.client.workflow.start(signalFlowkitWorkflow, { taskQueue: 'flowkit-temporal-workflow-test', workflowId: 'signal-untrusted', args: [signalFlowkitInput()] });
      await expectRejected(handle.executeUpdate('applySignal', { updateId: 'untrusted-signal', args: [{ action: 'refresh', comment: 'caller-spoof' }] }));

      expect(testActivities.resolvedCommands).toContainEqual({ origin: 'signal' });
      expect(testActivities.transitions).toEqual([]);
      await handle.cancel();
    } finally { await worker.shutdown(); await runWorker; await environment.teardown(); }
  }, 30_000);

  testWithTimeout('accepts a trusted activity-resolved same-organization signal', async () => {
    const environment = await TestWorkflowEnvironment.createLocal();
    const worker = await Worker.create({ connection: environment.nativeConnection, taskQueue: 'flowkit-temporal-workflow-test', workflowsPath: new URL('./testing/interpreter.fixture.ts', import.meta.url).pathname, activities: testActivities });
    const runWorker = worker.run();
    try {
      testActivities.reset();
      const handle = await environment.client.workflow.start(signalFlowkitWorkflow, { taskQueue: 'flowkit-temporal-workflow-test', workflowId: 'signal-trusted', args: [signalFlowkitInput()] });
      await handle.executeUpdate('applySignal', { updateId: 'trusted-signal', args: [{ action: 'refresh' }] });

      expect(testActivities.resolvedCommands).toContainEqual({ origin: 'signal' });
      expect(testActivities.transitions[0].origin).toBe('signal');
      expect(testActivities.transitions[0].command.actorId).toBe('service-scheduler');
      await handle.cancel();
    } finally { await worker.shutdown(); await runWorker; await environment.teardown(); }
  }, 30_000);

  testWithTimeout('rejects a trusted signal actor from another organization before projection', async () => {
    const environment = await TestWorkflowEnvironment.createLocal();
    const worker = await Worker.create({ connection: environment.nativeConnection, taskQueue: 'flowkit-temporal-workflow-test', workflowsPath: new URL('./testing/interpreter.fixture.ts', import.meta.url).pathname, activities: testActivities });
    const runWorker = worker.run();
    try {
      testActivities.reset();
      const handle = await environment.client.workflow.start(signalFlowkitWorkflow, { taskQueue: 'flowkit-temporal-workflow-test', workflowId: 'signal-wrong-tenant', args: [signalFlowkitInput()] });
      await expectRejected(handle.executeUpdate('applySignal', { updateId: 'cross-org-signal', args: [{ action: 'refresh' }] }));

      expect(testActivities.transitions).toEqual([]);
      await handle.cancel();
    } finally { await worker.shutdown(); await runWorker; await environment.teardown(); }
  }, 30_000);

  testWithTimeout('records human-gated AI output and degrades failed AI work without accepting an action', async () => {
    const environment = await TestWorkflowEnvironment.createLocal();
    const worker = await Worker.create({ connection: environment.nativeConnection, taskQueue: 'flowkit-temporal-workflow-test', workflowsPath: new URL('./testing/interpreter.fixture.ts', import.meta.url).pathname, activities: testActivities });
    const runWorker = worker.run();
    try {
      testActivities.reset();
      const successful = await environment.client.workflow.start(entryFlowkitWorkflow, { taskQueue: 'flowkit-temporal-workflow-test', workflowId: 'ai-output', args: [entryFlowkitInput()] });
      await successful.executeUpdate('applyAction', { updateId: 'ai-self', args: [{ action: 'self', comment: 'again' }] });
      expect((await successful.query('getState') as { stepResults: Record<string, { status: string; output?: string }> }).stepResults['0:2']).toEqual({ ref: 'summarize', kind: 'ai', status: 'completed', entryEpoch: 0, output: 'ai:summarize' });
      await successful.cancel();
      testActivities.reset(); testActivities.failAi = true;
      const degraded = await environment.client.workflow.start(entryFlowkitWorkflow, { taskQueue: 'flowkit-temporal-workflow-test', workflowId: 'ai-degraded', args: [entryFlowkitInput()] });
      await degraded.executeUpdate('applyAction', { updateId: 'degraded-self', args: [{ action: 'self', comment: 'again' }] });
      const state = await degraded.query('getState') as { state: { stage: string }; stepResults: Record<string, { status: string }> };
      expect(state.state.stage).toBe('draft');
      expect(state.stepResults['0:2'].status).toBe('degraded_to_human');
      expect(testActivities.transitions.length).toBe(1);
      expect(testActivities.transitions[0].command.action).toBe('self');
      await degraded.cancel();
    } finally { await worker.shutdown(); await runWorker; await environment.teardown(); }
  }, 30_000);

  testWithTimeout('projects rule auto-transitions and rejects guarded rules before projection', async () => {
    const environment = await TestWorkflowEnvironment.createLocal();
    const worker = await Worker.create({ connection: environment.nativeConnection, taskQueue: 'flowkit-temporal-workflow-test', workflowsPath: new URL('./testing/interpreter.fixture.ts', import.meta.url).pathname, activities: testActivities });
    const runWorker = worker.run();
    try {
      testActivities.reset();
      const automatic = await environment.client.workflow.start(ruleFlowkitWorkflow, { taskQueue: 'flowkit-temporal-workflow-test', workflowId: 'rule-auto', args: [entryFlowkitInput()] });
      expect((await automatic.result() as { state: { stage: string } }).state.stage).toBe('approved');
      expect(testActivities.transitions[0].origin).toBe('rule');
      testActivities.reset();
      const blocked = await environment.client.workflow.start(blockedRuleFlowkitWorkflow, { taskQueue: 'flowkit-temporal-workflow-test', workflowId: 'rule-guard', args: [entryFlowkitInput()] });
      expect((await blocked.query('getState') as { state: { stage: string } }).state.stage).toBe('draft');
      expect(testActivities.transitions.length).toBe(0);
      await blocked.cancel();
    } finally { await worker.shutdown(); await runWorker; await environment.teardown(); }
  }, 30_000);

  testWithTimeout('resolves an update after its destination entry rule has projected', async () => {
    const environment = await TestWorkflowEnvironment.createLocal();
    const worker = await Worker.create({ connection: environment.nativeConnection, taskQueue: 'flowkit-temporal-workflow-test', workflowsPath: new URL('./testing/interpreter.fixture.ts', import.meta.url).pathname, activities: testActivities });
    const runWorker = worker.run();
    try {
      testActivities.reset();
      const handle = await environment.client.workflow.start(updateRuleFlowkitWorkflow, { taskQueue: 'flowkit-temporal-workflow-test', workflowId: 'rule-after-update', args: [updateRuleFlowkitInput()] });
      const result = await handle.executeUpdate('applyAction', { updateId: 'submit-and-auto', args: [{ action: 'submit', comment: 'allowed' }] }) as { state: { stage: string } };
      expect(result.state.stage).toBe('approved');
      expect(testActivities.transitions.map((transition) => transition.origin)).toEqual(['human', 'rule']);
    } finally { await worker.shutdown(); await runWorker; await environment.teardown(); }
  }, 30_000);

  testWithTimeout('fails after 32 automatic transitions', async () => {
    const environment = await TestWorkflowEnvironment.createLocal();
    const worker = await Worker.create({ connection: environment.nativeConnection, taskQueue: 'flowkit-temporal-workflow-test', workflowsPath: new URL('./testing/interpreter.fixture.ts', import.meta.url).pathname, activities: testActivities });
    const runWorker = worker.run();
    try {
      testActivities.reset();
      const handle = await environment.client.workflow.start(loopFlowkitWorkflow, { taskQueue: 'flowkit-temporal-workflow-test', workflowId: 'rule-loop', args: [loopFlowkitInput()] });
      await expectRejected(handle.result());
      expect(testActivities.transitions.length).toBe(32);
    } finally { await worker.shutdown(); await runWorker; await environment.teardown(); }
  }, 30_000);

  testWithTimeout('arms one SLA per epoch, re-arms transitions, and isolates notification failure', async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const worker = await Worker.create({ connection: environment.nativeConnection, taskQueue: 'flowkit-temporal-workflow-test', workflowsPath: new URL('./testing/interpreter.fixture.ts', import.meta.url).pathname, activities: testActivities });
    const runWorker = worker.run();
    try {
      testActivities.reset();
      const initialReady = testActivities.waitForStageReady();
      const notify = await environment.client.workflow.start(notifySlaWorkflow, { taskQueue: 'flowkit-temporal-workflow-test', workflowId: 'sla-notify', args: [notifySlaInput()] });
      await initialReady;
      await environment.sleep('1 second');
      expect(testActivities.stageReady.length).toBe(1);
      expect(testActivities.notifications).toEqual(['sla:0']);
      await environment.sleep('1 second');
      expect(testActivities.notifications).toEqual(['sla:0']);
      await notify.executeUpdate('applyAction', { updateId: 'advance', args: [{ action: 'advance', comment: 'go' }] });
      expect(testActivities.stageReady.map((entry) => entry.entryEpoch)).toEqual([0, 1]);
      await notify.cancel();

      testActivities.reset(); testActivities.failNotification = true;
      const failedNotify = await environment.client.workflow.start(notifySlaWorkflow, { taskQueue: 'flowkit-temporal-workflow-test', workflowId: 'sla-notify-failure', args: [notifySlaInput()] });
      await environment.sleep('1 second');
      expect((await failedNotify.query('getState') as { state: { stage: string } }).state.stage).toBe('waiting');
      await failedNotify.cancel();

      testActivities.reset();
      const action = await environment.client.workflow.start(actionSlaWorkflow, { taskQueue: 'flowkit-temporal-workflow-test', workflowId: 'sla-action', args: [actionSlaInput()] });
      await environment.sleep('1 second');
      expect((await action.result() as { state: { stage: string } }).state.stage).toBe('expired');
      expect(testActivities.transitions[0].origin).toBe('sla');
    } finally { await worker.shutdown(); await runWorker; await environment.teardown(); }
  }, 30_000);

  testWithTimeout('continues from the main loop without re-arming the carried SLA deadline', async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const worker = await Worker.create({ connection: environment.nativeConnection, taskQueue: 'flowkit-temporal-workflow-test', workflowsPath: new URL('./testing/interpreter.fixture.ts', import.meta.url).pathname, activities: testActivities });
    const runWorker = worker.run();
    try {
      testActivities.reset();
      const ready = testActivities.waitForStageReady();
      const handle = await environment.client.workflow.start(continuationWorkflow, { taskQueue: 'flowkit-temporal-workflow-test', workflowId: 'continuation', args: [continuationInput()] });
      await ready;
      await handle.executeUpdate('applyAction', { updateId: 'continue', args: [{ action: 'self', comment: 'continue' }] });
      const carriedDeadline = testActivities.stageReady[1].slaDeadline;
      const current = environment.client.workflow.getHandle('continuation');
      const state = await current.query('getState') as { state: { stage: string; status: string; pendingRole: string | null; tracks: Record<string, string> }; slaDeadline?: number };
      expect(state.state.stage).toBe('waiting');
      expect(state.slaDeadline).toBe(carriedDeadline);
      expect(testActivities.stageReady.length).toBe(2);
      testActivities.priorResult = { state: state.state };
      const duplicate = await current.executeUpdate('applyAction', { updateId: 'continue', args: [{ action: 'self', comment: 'continue' }] }) as { state: { stage: string } };
      expect(duplicate.state.stage).toBe('waiting');
      expect(testActivities.transitions.filter((transition) => transition.operationId === 'continue').length).toBe(1);
      await current.cancel();
    } finally { await worker.shutdown(); await runWorker; await environment.teardown(); }
  }, 30_000);

  testWithTimeout('replays a captured generic workflow history without nondeterminism', async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const workflowsPath = new URL('./testing/interpreter.fixture.ts', import.meta.url).pathname;
    const worker = await Worker.create({ connection: environment.nativeConnection, taskQueue: 'flowkit-temporal-workflow-test', workflowsPath, activities: testActivities });
    const runWorker = worker.run();
    try {
      testActivities.reset();
      const ready = testActivities.waitForStageReady();
      const handle = await environment.client.workflow.start(actionSlaWorkflow, { taskQueue: 'flowkit-temporal-workflow-test', workflowId: 'replay-sla-action', args: [actionSlaInput()] });
      await ready;
      await environment.sleep('1 second');
      await handle.result();
      await Worker.runReplayHistory({ workflowsPath }, await handle.fetchHistory(), 'replay-sla-action');
      expect(testActivities.transitions[0].origin).toBe('sla');
    } finally { await worker.shutdown(); await runWorker; await environment.teardown(); }
  }, 30_000);
});
