import type {
  FlowkitActivityRegistry,
  RecordTransitionInput,
  ResolvedActionContext,
} from '../contracts';
import { ApplicationFailure } from '@temporalio/common';

export const testActivities: FlowkitActivityRegistry & {
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
  async dispatchNotification(input) {
    testActivities.notifications.push(input.operationKey);
    if (testActivities.failNotification) throw new Error('notification unavailable');
  },
};
