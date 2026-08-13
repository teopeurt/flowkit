import { FlowDefinition, FlowState } from '@naakwu/flowkit-core';
import { TaskStore, TaskEligibilityResolver, FlowTask, TaskInboxPage } from '@naakwu/flowkit-tasks';

type DefinitionHash = `sha256:${string}`;
interface PublishedFlowDefinition {
    definitionSnapshot: FlowDefinition;
    definitionHash: DefinitionHash;
}
interface FlowkitSubject {
    id: string;
    metadata?: Record<string, unknown>;
}
interface FlowkitActorRef {
    id: string;
    roles: string[];
    organizationId?: string;
}
interface FlowkitStepResult {
    ref: string;
    kind: 'system' | 'ai' | 'rule';
    status: 'completed' | 'degraded_to_human';
    entryEpoch: number;
    output?: unknown;
}
interface FlowkitStateView {
    state: FlowState;
    sequence: number;
    stepResults: Record<string, FlowkitStepResult>;
    slaDeadline?: number;
    completed: boolean;
    nextActions: string[];
}
interface FlowRuntime {
    start(input: {
        flowId: string;
        published: PublishedFlowDefinition;
        subject: FlowkitSubject;
        operationId: string;
    }): Promise<FlowkitStateView>;
    act(input: {
        flowId: string;
        action: string;
        actorId: string;
        operationId: string;
        comment?: string;
    }): Promise<FlowkitStateView>;
    get(input: {
        flowId: string;
    }): Promise<FlowkitStateView>;
    health(): Promise<{
        ready: boolean;
        checkedAt: string;
    }>;
}
interface FlowkitConsumerStart {
    flowId: string;
    subject: FlowkitSubject;
    actor: FlowkitActorRef;
    operationId: string;
}
interface FlowkitConsumerAction {
    flowId: string;
    action: string;
    actor: FlowkitActorRef;
    operationId: string;
    comment?: string;
}
interface FlowkitConsumerClaim {
    taskId: string;
    expectedRevision: number;
    actor: FlowkitActorRef;
    operationId: string;
}
type FlowkitConsumerView = FlowkitStateView;
interface FlowkitConsumer {
    start(input: FlowkitConsumerStart): Promise<FlowkitConsumerView>;
    act(input: FlowkitConsumerAction): Promise<FlowkitConsumerView>;
    getFlow(flowId: string): Promise<FlowkitConsumerView>;
    tasks: {
        claim(input: FlowkitConsumerClaim): Promise<FlowTask>;
        list(input: {
            actor: FlowkitActorRef;
        }): Promise<TaskInboxPage>;
    };
}
interface FlowkitActorResolver {
    resolve(actorId: string): Promise<FlowkitActorRef>;
}
interface FlowkitConsumerClock {
    now(): string;
}
interface FlowkitConsumerViews {
    read(state: FlowkitStateView): FlowkitConsumerView;
    readByFlowId(flowId: string): Promise<FlowkitConsumerView>;
}
interface ConsumerDependencies {
    definition: PublishedFlowDefinition;
    runtime: FlowRuntime;
    tasks: TaskStore;
    actorResolver: FlowkitActorResolver;
    eligibility: TaskEligibilityResolver;
    clock: FlowkitConsumerClock;
    views: FlowkitConsumerViews;
}

declare function createFlowkitConsumer(deps: ConsumerDependencies): FlowkitConsumer;

export { type ConsumerDependencies, type DefinitionHash, type FlowRuntime, type FlowkitActorRef, type FlowkitActorResolver, type FlowkitConsumer, type FlowkitConsumerAction, type FlowkitConsumerClaim, type FlowkitConsumerClock, type FlowkitConsumerStart, type FlowkitConsumerView, type FlowkitConsumerViews, type FlowkitStateView, type FlowkitStepResult, type FlowkitSubject, type PublishedFlowDefinition, createFlowkitConsumer };
