import { describe, expect, test } from 'bun:test';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';
import { WorkflowUpdateStage } from '@temporalio/client';

import { testActivities } from './testing/test-activities';
import {
  autoGateDeclineWorkflow,
  autoGateInput,
  autoGateReleaseWorkflow,
  autoGateThrowWorkflow,
  blockedRuleFlowkitWorkflow,
  entryFlowkitInput,
  entryFlowkitWorkflow,
  factFlowkitInput,
  factFlowkitWorkflow,
  loopFlowkitInput,
  orchestrateBlockedWorkflow,
  orchestrateContinueInput,
  orchestrateContinueWorkflow,
  orchestrateInput,
  orchestrateWorkflow,
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

  testWithTimeout('auto-gated AI steps release the stage only when the deciding rule says so, and otherwise fail closed to a human', async () => {
    const environment = await TestWorkflowEnvironment.createLocal();
    const worker = await Worker.create({ connection: environment.nativeConnection, taskQueue: 'flowkit-temporal-workflow-test', workflowsPath: new URL('./testing/interpreter.fixture.ts', import.meta.url).pathname, activities: testActivities });
    const runWorker = worker.run();
    type View = { state: { stage: string }; completed: boolean; stepResults: Record<string, { status: string; gateDecision?: { outcome: string; action?: string } }> };
    const start = (workflow: typeof autoGateReleaseWorkflow, workflowId: string) => environment.client.workflow.start(workflow, { taskQueue: 'flowkit-temporal-workflow-test', workflowId, args: [autoGateInput()] });
    // The entry step runs asynchronously after start, so wait for its recorded result before asserting on it.
    const settled = async (handle: Awaited<ReturnType<typeof start>>): Promise<View> => {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const view = await handle.query('getState') as View;
        if (view.stepResults['0:0']) return view;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('entry step never settled');
    };
    try {
      testActivities.reset();
      const released = await start(autoGateReleaseWorkflow, 'auto-gate-release');
      await released.result();
      expect(testActivities.transitions.map((t) => t.command.action)).toEqual(['proceed']);
      expect(testActivities.transitions[0].origin).toBe('rule');
      expect(testActivities.transitions[0].operationId).toBe('gate:0:0');

      testActivities.reset();
      const declined = await start(autoGateDeclineWorkflow, 'auto-gate-decline');
      let view = await settled(declined);
      expect(view.state.stage).toBe('plan');
      expect(view.stepResults['0:0'].gateDecision).toEqual({ outcome: 'human' });
      expect(testActivities.transitions).toEqual([]);
      await declined.cancel();

      testActivities.reset();
      const threw = await start(autoGateThrowWorkflow, 'auto-gate-throw');
      view = await settled(threw);
      expect(view.state.stage).toBe('plan');
      expect(view.stepResults['0:0'].gateDecision).toEqual({ outcome: 'human' });
      await threw.cancel();

      testActivities.reset(); testActivities.failAi = true;
      const degraded = await start(autoGateReleaseWorkflow, 'auto-gate-degraded');
      view = await settled(degraded);
      expect(view.state.stage).toBe('plan');
      expect(view.stepResults['0:0'].status).toBe('degraded_to_human');
      expect(view.stepResults['0:0'].gateDecision).toBe(undefined);
      expect(testActivities.transitions).toEqual([]);
      await degraded.cancel();
    } finally { await worker.shutdown(); await runWorker; await environment.teardown(); }
  }, 60_000);

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

type TaskView = { id: string; agent: string; status: string };
type OrchestrateView = {
  state: { stage: string };
  completed: boolean;
  stepResults: Record<string, { status: string; output?: unknown; gateDecision?: { outcome: string; action?: string }; tasks?: TaskView[] }>;
};
const taskQueue = 'flowkit-temporal-workflow-test';
const workflowsPath = new URL('./testing/interpreter.fixture.ts', import.meta.url).pathname;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const planOf = (...tasks: Array<[string, string]>) => tasks.map(([id, agent]) => ({ id, agent }));

const withOrchestrationWorker = async (run: (environment: TestWorkflowEnvironment) => Promise<void>) => {
  const environment = await TestWorkflowEnvironment.createLocal();
  const worker = await Worker.create({ connection: environment.nativeConnection, taskQueue, workflowsPath, activities: testActivities });
  const runWorker = worker.run();
  try {
    testActivities.reset();
    await run(environment);
  } finally { await worker.shutdown(); await runWorker; await environment.teardown(); }
};

type OrchestrateHandle = { query(name: 'getState'): Promise<unknown> };
const until = async (handle: OrchestrateHandle, predicate: (view: OrchestrateView) => boolean): Promise<OrchestrateView> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const view = await handle.query('getState') as OrchestrateView;
    if (predicate(view)) return view;
    await pause(100);
  }
  throw new Error('condition never met');
};

describe('orchestrate step', () => {
  testWithTimeout('releases the stage with one rule-origin transition, in plan order, within the concurrency limit', async () => {
    await withOrchestrationWorker(async (environment) => {
      testActivities.orchestration.plan = planOf(['t1', 'coder'], ['t2', 'tester'], ['t3', 'coder']);
      testActivities.orchestration.subagentMs = 150;
      const handle = await environment.client.workflow.start(orchestrateWorkflow, { taskQueue, workflowId: 'orch-release', args: [orchestrateInput()] });
      const view = await handle.result() as OrchestrateView;

      expect(testActivities.transitions.length).toBe(1);
      expect(testActivities.transitions[0].origin).toBe('rule');
      expect(testActivities.transitions[0].operationId).toBe('orch:0:0');
      expect(testActivities.transitions[0].command.action).toBe('proceed');
      expect(testActivities.orchestration.started).toEqual(['t1', 't2', 't3']);
      expect(testActivities.orchestration.maxActive).toBe(2);
      expect(view.stepResults['0:0'].status).toBe('completed');
      expect(view.stepResults['0:0'].tasks?.map((task) => task.status)).toEqual(['completed', 'completed', 'completed']);
      expect(view.stepResults['0:0'].gateDecision).toEqual({ outcome: 'auto', action: 'proceed' });
    });
  }, 60_000);

  testWithTimeout('the target action guard still applies to an auto release', async () => {
    await withOrchestrationWorker(async (environment) => {
      testActivities.orchestration.plan = planOf(['t1', 'coder']);
      const handle = await environment.client.workflow.start(orchestrateBlockedWorkflow, { taskQueue, workflowId: 'orch-guard', args: [orchestrateInput()] });
      const view = await until(handle, (candidate) => candidate.stepResults['0:0']?.status === 'completed');
      await pause(500);

      expect(view.stepResults['0:0'].gateDecision).toEqual({ outcome: 'auto', action: 'proceed' });
      expect(testActivities.transitions).toEqual([]);
      expect((await handle.query('getState') as OrchestrateView).state.stage).toBe('work');
      await handle.cancel();
    });
  }, 60_000);

  testWithTimeout('a failed subagent does not stop its siblings and the rule refuses to release', async () => {
    await withOrchestrationWorker(async (environment) => {
      testActivities.orchestration.plan = planOf(['t1', 'coder'], ['t2', 'tester']);
      testActivities.orchestration.failTasks = ['t2'];
      const handle = await environment.client.workflow.start(orchestrateWorkflow, { taskQueue, workflowId: 'orch-failed-task', args: [orchestrateInput()] });
      const view = await until(handle, (candidate) => candidate.stepResults['0:0']?.status === 'completed');

      expect(view.stepResults['0:0'].tasks?.map((task) => task.status)).toEqual(['completed', 'failed']);
      expect(testActivities.orchestration.synthesized[0]).toEqual([{ id: 't1', status: 'completed' }, { id: 't2', status: 'failed' }]);
      expect(view.stepResults['0:0'].gateDecision).toEqual({ outcome: 'human' });
      expect(view.state.stage).toBe('work');
      expect(testActivities.transitions).toEqual([]);
      await handle.cancel();
    });
  }, 60_000);

  testWithTimeout('failFast cancels the remaining subagents when one fails', async () => {
    await withOrchestrationWorker(async (environment) => {
      testActivities.orchestration.plan = planOf(['t1', 'coder'], ['t2', 'coder'], ['t3', 'coder'], ['t4', 'coder']);
      testActivities.orchestration.subagentMs = 2_000;
      testActivities.orchestration.taskMs = { t2: 50 };
      testActivities.orchestration.failTasks = ['t2'];
      const handle = await environment.client.workflow.start(orchestrateWorkflow, { taskQueue, workflowId: 'orch-failfast', args: [orchestrateInput('failfast')] });
      const view = await until(handle, (candidate) => candidate.stepResults['0:0']?.status === 'completed');

      expect(view.stepResults['0:0'].tasks?.map((task) => task.status)).toEqual(['cancelled', 'failed', 'cancelled', 'cancelled']);
      expect(view.stepResults['0:0'].gateDecision).toEqual({ outcome: 'human' });
      await handle.cancel();
    });
  }, 60_000);

  testWithTimeout('a bad plan, a failed plan or synthesis, or an oversized output degrades to a human', async () => {
    await withOrchestrationWorker(async (environment) => {
      const cases: Array<[string, string, () => void]> = [
        ['unknown-agent', 'build', () => { testActivities.orchestration.plan = planOf(['t1', 'planner']); }],
        ['duplicate-id', 'build', () => { testActivities.orchestration.plan = planOf(['t1', 'coder'], ['t1', 'tester']); }],
        ['too-many-tasks', 'build', () => { testActivities.orchestration.plan = planOf(['a', 'coder'], ['b', 'coder'], ['c', 'coder'], ['d', 'coder']); }],
        ['plan-fails', 'build', () => { testActivities.orchestration.plan = planOf(['t1', 'coder']); testActivities.orchestration.failPlan = true; }],
        ['synthesis-fails', 'build', () => { testActivities.orchestration.plan = planOf(['t1', 'coder']); testActivities.orchestration.failSynthesize = true; }],
        ['output-too-large', 'tiny', () => { testActivities.orchestration.plan = planOf(['t1', 'coder']); testActivities.orchestration.bigOutput = true; }],
      ];
      for (const [name, ref, arrange] of cases) {
        testActivities.reset();
        arrange();
        const handle = await environment.client.workflow.start(orchestrateWorkflow, { taskQueue, workflowId: `orch-bad-${name}`, args: [orchestrateInput(ref)] });
        const view = await until(handle, (candidate) => candidate.stepResults['0:0']?.status === 'degraded_to_human');

        expect(view.state.stage).toBe('work');
        expect(view.stepResults['0:0'].gateDecision).toBe(undefined);
        expect(testActivities.transitions).toEqual([]);
        await handle.cancel();
      }
    });
  }, 120_000);

  testWithTimeout('a human action is handled while subagents are still running, and supersedes the orchestration', async () => {
    await withOrchestrationWorker(async (environment) => {
      testActivities.orchestration.plan = planOf(['t1', 'coder']);
      testActivities.orchestration.subagentMs = 3_000;
      const handle = await environment.client.workflow.start(orchestrateWorkflow, { taskQueue, workflowId: 'orch-human', args: [orchestrateInput('build', { gate: 'human' })] });
      await until(handle, (candidate) => candidate.stepResults['0:0']?.tasks?.[0]?.status === 'running');

      const startedAt = Date.now();
      await handle.executeUpdate('applyAction', { updateId: 'orch-human-approve', args: [{ action: 'approve' }] });
      const view = await handle.result() as OrchestrateView;

      expect(Date.now() - startedAt < 2_500).toBe(true);
      expect(testActivities.transitions.map((transition) => transition.origin)).toEqual(['human']);
      expect(view.stepResults['0:0'].status).toBe('superseded');
      expect(view.stepResults['0:0'].tasks?.[0].status).toBe('cancelled');
      expect(testActivities.orchestration.synthesized).toEqual([]);
    });
  }, 60_000);

  testWithTimeout('the stage SLA fires while subagents are still running', async () => {
    await withOrchestrationWorker(async (environment) => {
      testActivities.orchestration.plan = planOf(['t1', 'coder']);
      testActivities.orchestration.subagentMs = 4_000;
      const handle = await environment.client.workflow.start(orchestrateWorkflow, { taskQueue, workflowId: 'orch-sla', args: [orchestrateInput('build', { sla: true, gate: 'human' })] });
      const view = await handle.result() as OrchestrateView;

      expect(testActivities.transitions.map((transition) => transition.origin)).toEqual(['sla']);
      expect(view.stepResults['0:0'].status).toBe('superseded');
    });
  }, 60_000);

  testWithTimeout('a stale orchestration never enqueues a command after the stage is re-entered', async () => {
    await withOrchestrationWorker(async (environment) => {
      testActivities.orchestration.plan = planOf(['t1', 'coder']);
      testActivities.orchestration.subagentMs = 600;
      const handle = await environment.client.workflow.start(orchestrateWorkflow, { taskQueue, workflowId: 'orch-stale', args: [orchestrateInput()] });
      await until(handle, (candidate) => candidate.stepResults['0:0']?.tasks?.[0]?.status === 'running');
      await handle.executeUpdate('applyAction', { updateId: 'orch-stale-revisit', args: [{ action: 'revisit' }] });
      const view = await handle.result() as OrchestrateView;

      expect(testActivities.orchestration.planCalls).toBe(2);
      expect(testActivities.transitions.map((transition) => transition.operationId)).toEqual(['orch-stale-revisit', 'orch:1:0']);
      expect(view.stepResults['0:0'].status).toBe('superseded');
      expect(view.stepResults['1:0'].status).toBe('completed');
    });
  }, 60_000);

  testWithTimeout('defers Continue-As-New while an orchestration runs, then continues with state intact', async () => {
    await withOrchestrationWorker(async (environment) => {
      testActivities.orchestration.plan = planOf(['t1', 'coder']);
      testActivities.orchestration.subagentMs = 800;
      const handle = await environment.client.workflow.start(orchestrateContinueWorkflow, { taskQueue, workflowId: 'orch-continue', args: [orchestrateContinueInput()] });
      const firstRunId = handle.firstExecutionRunId;
      await handle.executeUpdate('applyAction', { updateId: 'orch-continue-go', args: [{ action: 'go' }] });
      await until(handle, (candidate) => candidate.stepResults['1:0']?.status === 'running');

      expect((await handle.describe()).runId).toBe(firstRunId);
      await until(handle, (candidate) => candidate.stepResults['1:0']?.status === 'completed');
      await handle.executeUpdate('applyAction', { updateId: 'orch-continue-finish', args: [{ action: 'finish' }] });

      const continued = environment.client.workflow.getHandle('orch-continue');
      const view = await until(continued, (candidate) => candidate.state.stage === 'closed');
      expect(view.stepResults['1:0'].status).toBe('completed');
      expect((await continued.describe()).runId === firstRunId).toBe(false);
      await continued.cancel();
    });
  }, 60_000);

  testWithTimeout('replays a captured orchestration history without nondeterminism', async () => {
    const environment = await TestWorkflowEnvironment.createTimeSkipping();
    const worker = await Worker.create({ connection: environment.nativeConnection, taskQueue, workflowsPath, activities: testActivities });
    const runWorker = worker.run();
    try {
      testActivities.reset();
      testActivities.orchestration.plan = planOf(['t1', 'coder'], ['t2', 'tester']);
      testActivities.orchestration.subagentMs = 100;
      const handle = await environment.client.workflow.start(orchestrateWorkflow, { taskQueue, workflowId: 'orch-replay', args: [orchestrateInput()] });
      await handle.result();
      await Worker.runReplayHistory({ workflowsPath }, await handle.fetchHistory(), 'orch-replay');
      expect(testActivities.transitions[0].operationId).toBe('orch:0:0');
    } finally { await worker.shutdown(); await runWorker; await environment.teardown(); }
  }, 60_000);
});
