import type {
  FlowkitActivityRegistry,
  RecordTransitionInput,
  ResolvedActionContext,
} from '../contracts';
import { ApplicationFailure } from '@temporalio/common';

export const testActivities: FlowkitActivityRegistry & {
  transitions: RecordTransitionInput[];
  failNextProjection: boolean;
  blockNextProjection: boolean;
  failAi: boolean;
  systemSteps: string[];
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
  failNextProjection: false,
  blockNextProjection: false,
  failAi: false,
  systemSteps: [],
  aiSteps: [],
  stageReady: [],
  notifications: [],
  failNotification: false,
  reset() {
    this.transitions.length = 0;
    this.failNextProjection = false;
    this.blockNextProjection = false;
    this.failAi = false;
    this.systemSteps.length = 0;
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
    return {
      actor: {
        id: input.command.comment === 'unauthorized' || input.command.action === 'approve' ? 'manager-1' : 'employee-1',
        roles: [input.command.comment === 'unauthorized' || input.command.action === 'approve' ? 'manager' : 'employee'],
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
