import type {
  FlowkitActivityRegistry,
  FlowkitOrchestrationActivities,
  OrchestrationTask,
  RecordTransitionInput,
  ResolvedActionContext,
} from '../contracts';
import { ApplicationFailure } from '@temporalio/common';

/** Knobs and observations for the orchestration activities. Reset by `testActivities.reset()`. */
export interface OrchestrationControls {
  plan: OrchestrationTask[];
  subagentMs: number;
  /** Per-task override of `subagentMs`. */
  taskMs: Record<string, number>;
  failTasks: string[];
  failPlan: boolean;
  failSynthesize: boolean;
  bigOutput: boolean;
  planCalls: number;
  started: string[];
  active: number;
  maxActive: number;
  synthesized: Array<Array<{ id: string; status: string }>>;
}

const freshOrchestration = (): OrchestrationControls => ({
  plan: [],
  subagentMs: 50,
  taskMs: {},
  failTasks: [],
  failPlan: false,
  failSynthesize: false,
  bigOutput: false,
  planCalls: 0,
  started: [],
  active: 0,
  maxActive: 0,
  synthesized: [],
});

export const testActivities: FlowkitActivityRegistry & FlowkitOrchestrationActivities & {
  orchestration: OrchestrationControls;
  transitions: RecordTransitionInput[];
  resolvedCommands: Array<{ origin: string; actorId?: string }>;
  failNextProjection: boolean;
  blockNextProjection: boolean;
  failAi: boolean;
  systemSteps: string[];
  systemStepInputs: Array<{ workflowId: string; entryEpoch: number; stepIndex: number; idempotencyKey: string }>;
  aiSteps: string[];
  stageReady: Array<{ entryEpoch: number; slaDeadline?: number }>;
  notifications: string[];
  failNotification: boolean;
  stageReadyResolver?: () => void;
  releaseProjection?: () => void;
  projectionStarted?: () => void;
  priorResult?: ResolvedActionContext['priorResult'];
  reset(): void;
  waitForProjection(): Promise<void>;
  waitForStageReady(): Promise<void>;
  unblockProjection(): void;
} = {
  orchestration: freshOrchestration(),
  transitions: [],
  resolvedCommands: [],
  failNextProjection: false,
  blockNextProjection: false,
  failAi: false,
  systemSteps: [],
  systemStepInputs: [],
  aiSteps: [],
  stageReady: [],
  notifications: [],
  failNotification: false,
  reset() {
    this.transitions.length = 0;
    this.resolvedCommands.length = 0;
    this.failNextProjection = false;
    this.blockNextProjection = false;
    this.failAi = false;
    this.systemSteps.length = 0;
    this.systemStepInputs.length = 0;
    this.aiSteps.length = 0;
    this.stageReady.length = 0;
    this.notifications.length = 0;
    this.failNotification = false;
    this.stageReadyResolver = undefined;
    this.releaseProjection = undefined;
    this.projectionStarted = undefined;
    this.priorResult = undefined;
    this.orchestration = freshOrchestration();
  },
  waitForProjection() {
    return new Promise((resolve) => { this.projectionStarted = resolve; });
  },
  waitForStageReady() { return new Promise((resolve) => { this.stageReadyResolver = resolve; }); },
  unblockProjection() {
    this.releaseProjection?.();
  },
  async resolveActionContext(input): Promise<ResolvedActionContext> {
    testActivities.resolvedCommands.push(input.command.actorId === undefined
      ? { origin: input.origin }
      : { origin: input.origin, actorId: input.command.actorId });
    const trustedSignal = input.origin !== 'signal'
      || input.operationId === 'trusted-signal'
      || input.operationId === 'cross-org-signal';
    return {
      actor: !trustedSignal ? undefined : {
        id: input.origin === 'signal'
          ? 'service-scheduler'
          : input.command.comment === 'unauthorized' || input.command.action === 'approve' ? 'manager-1' : 'employee-1',
        roles: [input.origin === 'signal'
          ? 'scheduler'
          : input.command.comment === 'unauthorized' || input.command.action === 'approve' ? 'manager' : 'employee'],
        organizationId: input.operationId === 'cross-org-signal' || input.command.comment === 'wrong-tenant' ? 'org-2' : 'org-1',
      },
      facts: { commentAllowed: input.command.comment !== 'blocked' },
      priorResult: testActivities.priorResult,
    };
  },
  async recordTransition(input) {
    if (testActivities.failNextProjection) {
      testActivities.failNextProjection = false;
      throw ApplicationFailure.nonRetryable('projection unavailable', 'TEST_PROJECTION_FAILURE');
    }
    if (testActivities.blockNextProjection) {
      testActivities.blockNextProjection = false;
      testActivities.projectionStarted?.();
      await new Promise<void>((resolve) => { testActivities.releaseProjection = resolve; });
    }
    testActivities.transitions.push(input);
    return { state: input.nextState };
  },
  async recordStageReady(input) { testActivities.stageReady.push({ entryEpoch: input.entryEpoch, slaDeadline: input.slaDeadline }); testActivities.stageReadyResolver?.(); },
  async executeSystemStep(input) {
    testActivities.systemSteps.push(input.ref);
    testActivities.systemStepInputs.push({ workflowId: input.workflowId, entryEpoch: input.entryEpoch, stepIndex: input.stepIndex, idempotencyKey: input.idempotencyKey });
    if (input.ref === 'inspect') return { output: { verdict: 'pass' } };
    return { output: `system:${input.ref}` };
  },
  async executeAiStep(input) {
    testActivities.aiSteps.push(input.ref);
    if (testActivities.failAi) throw ApplicationFailure.nonRetryable('AI unavailable', 'TEST_AI_FAILURE');
    return { output: `ai:${input.ref}` };
  },
  async planOrchestration() {
    const controls = testActivities.orchestration;
    controls.planCalls += 1;
    if (controls.failPlan) throw ApplicationFailure.nonRetryable('plan unavailable', 'TEST_PLAN_FAILURE');
    return { tasks: controls.plan.map((task) => ({ ...task })) };
  },
  async runSubagent(input) {
    const controls = testActivities.orchestration;
    controls.started.push(input.taskId);
    controls.active += 1;
    controls.maxActive = Math.max(controls.maxActive, controls.active);
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, controls.taskMs[input.taskId] ?? controls.subagentMs));
      if (controls.failTasks.includes(input.taskId)) {
        throw ApplicationFailure.nonRetryable(`subagent ${input.taskId} failed`, 'TEST_SUBAGENT_FAILURE');
      }
      return { output: `done:${input.taskId}` };
    } finally {
      controls.active -= 1;
    }
  },
  async synthesizeOrchestration(input) {
    const controls = testActivities.orchestration;
    controls.synthesized.push(input.results.map(({ id, status }) => ({ id, status })));
    if (controls.failSynthesize) throw ApplicationFailure.nonRetryable('synthesis unavailable', 'TEST_SYNTH_FAILURE');
    return { output: controls.bigOutput ? { blob: 'x'.repeat(200) } : { merged: input.results.length } };
  },
  async dispatchNotification(input) {
    testActivities.notifications.push(input.operationKey);
    if (testActivities.failNotification) throw new Error('notification unavailable');
  },
};
