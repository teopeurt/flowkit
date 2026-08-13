import type { FlowDefinition, FlowState } from '@naakwu/flowkit-core';
import type { FlowTask, TaskEligibilityResolver, TaskInboxPage, TaskStore } from '@naakwu/flowkit-tasks';

export type DefinitionHash = `sha256:${string}`;

export interface PublishedFlowDefinition {
  definitionSnapshot: FlowDefinition;
  definitionHash: DefinitionHash;
}

export interface FlowkitSubject {
  id: string;
  metadata?: Record<string, unknown>;
}

export interface FlowkitActorRef {
  id: string;
  roles: string[];
  organizationId?: string;
}

export interface FlowkitStepResult {
  ref: string;
  kind: 'system' | 'ai' | 'rule';
  status: 'completed' | 'degraded_to_human';
  entryEpoch: number;
  output?: unknown;
}

export interface FlowkitStateView {
  state: FlowState;
  sequence: number;
  stepResults: Record<string, FlowkitStepResult>;
  slaDeadline?: number;
  completed: boolean;
  nextActions: string[];
}

export interface FlowRuntime {
  start(input: { flowId: string; published: PublishedFlowDefinition; subject: FlowkitSubject; operationId: string }): Promise<FlowkitStateView>;
  act(input: { flowId: string; action: string; actorId: string; operationId: string; comment?: string }): Promise<FlowkitStateView>;
  get(input: { flowId: string }): Promise<FlowkitStateView>;
  health(): Promise<{ ready: boolean; checkedAt: string }>;
}

export interface FlowkitConsumerStart {
  flowId: string;
  subject: FlowkitSubject;
  actor: FlowkitActorRef;
  operationId: string;
}

export interface FlowkitConsumerAction {
  flowId: string;
  action: string;
  actor: FlowkitActorRef;
  operationId: string;
  comment?: string;
}

export interface FlowkitConsumerClaim {
  taskId: string;
  expectedRevision: number;
  actor: FlowkitActorRef;
  operationId: string;
}

export type FlowkitConsumerView = FlowkitStateView;

export interface FlowkitConsumer {
  start(input: FlowkitConsumerStart): Promise<FlowkitConsumerView>;
  act(input: FlowkitConsumerAction): Promise<FlowkitConsumerView>;
  getFlow(flowId: string): Promise<FlowkitConsumerView>;
  tasks: {
    claim(input: FlowkitConsumerClaim): Promise<FlowTask>;
    list(input: { actor: FlowkitActorRef }): Promise<TaskInboxPage>;
  };
}

export interface FlowkitActorResolver {
  resolve(actorId: string): Promise<FlowkitActorRef>;
}

export interface FlowkitConsumerClock {
  now(): string;
}

export interface FlowkitConsumerViews {
  read(state: FlowkitStateView): FlowkitConsumerView;
  readByFlowId(flowId: string): Promise<FlowkitConsumerView>;
}

export interface ConsumerDependencies {
  definition: PublishedFlowDefinition;
  runtime: FlowRuntime;
  tasks: TaskStore;
  actorResolver: FlowkitActorResolver;
  eligibility: TaskEligibilityResolver;
  clock: FlowkitConsumerClock;
  views: FlowkitConsumerViews;
}
