import { proxyActivities } from '@temporalio/workflow';
import { FlowDefinition, FlowState, AuthorizationPolicyRegistry, GuardRegistry, TransitionRecord, FlowCommand } from '@flowkit/core';

/**
 * Data contracts shared between Flowkit consumers (workers, services) and the
 * generic interpreter. Every public workflow and Activity contract takes a
 * single object parameter so call sites stay stable as fields are added.
 */
type DefinitionHash = `sha256:${string}`;
interface PublishedFlowDefinition {
    definitionSnapshot: FlowDefinition;
    definitionHash: DefinitionHash;
}
/** Subject (application/case) the workflow instance governs. */
interface FlowkitSubject {
    id: string;
    metadata?: Record<string, unknown>;
}
/** Who/what originated a command. Rules and SLAs may only target system actions. */
type CommandOrigin = 'human' | 'rule' | 'sla';
/** Server-resolved authenticated actor. Never trusted from command payloads. */
interface FlowkitActorRef {
    id: string;
    roles: string[];
    organizationId?: string;
}
interface FlowkitNotificationBinding {
    template: string;
    channels: string[];
    to?: string[];
}
type EntryReason = 'initial' | 'transition';
/** One queued command processed serially by the interpreter's main loop. */
interface CommandEnvelope {
    operationId: string;
    origin: CommandOrigin;
    command: FlowCommand;
}
interface FlowkitStepResult {
    ref: string;
    kind: 'system' | 'ai' | 'rule';
    status: 'completed' | 'degraded_to_human';
    entryEpoch: number;
    output?: unknown;
}
/** Full interpreter state; carried across Continue-As-New unchanged. */
interface FlowkitExecutionState {
    state: FlowState;
    /** Monotonic transition sequence; also the projection sequence number. */
    sequence: number;
    /** Stage-entry epoch; increments on every committed transition. */
    entryEpoch: number;
    stepResults: Record<string, FlowkitStepResult>;
    /** Absolute SLA deadline (epoch ms) for the current entry epoch. */
    slaDeadline?: number;
    /** Initial entry work ran; prevents re-running it after Continue-As-New. */
    completedInitialEntry: boolean;
    /** A final stage was reached; the workflow drains and completes. */
    completed: boolean;
}
/** Workflow input. `resume` is set only by Continue-As-New. */
interface FlowkitWorkflowInput {
    published: PublishedFlowDefinition;
    subject: FlowkitSubject;
    initialState?: FlowState;
    resume?: {
        execution: FlowkitExecutionState;
    };
}
/** Generic read model returned by the state query (adapters may reshape). */
interface FlowkitStateView {
    state: FlowState;
    sequence: number;
    stepResults: Record<string, FlowkitStepResult>;
    slaDeadline?: number;
    completed: boolean;
    nextActions: string[];
}
interface DefinitionIdentity {
    id: string;
    version: number;
    hash: DefinitionHash;
}
interface ResolveActionContextInput {
    workflowId: string;
    runId: string;
    operationId: string;
    origin: CommandOrigin;
    definition: DefinitionIdentity;
    subject: FlowkitSubject;
    state: FlowState;
    command: FlowCommand;
}
interface ResolvedActionContext {
    actor?: FlowkitActorRef;
    facts: Record<string, unknown>;
    /**
     * Set when this operation ID already committed in an earlier Run; the
     * interpreter returns it without re-evaluating policy or transition.
     */
    priorResult?: {
        state: FlowState;
    };
}
interface RecordTransitionInput {
    workflowId: string;
    runId: string;
    operationId: string;
    sequence: number;
    origin: CommandOrigin;
    definition: DefinitionIdentity;
    subject: FlowkitSubject;
    command: FlowCommand;
    previousState: FlowState;
    nextState: FlowState;
    transition: TransitionRecord;
    notify?: FlowkitNotificationBinding;
}
interface RecordTransitionOutput {
    /** Projected state; an idempotent retry returns the stored state. */
    state: FlowState;
    /** False when the operation was already committed. */
    created?: boolean;
}
interface RecordStageReadyInput {
    workflowId: string;
    definition: DefinitionIdentity;
    subject: FlowkitSubject;
    state: FlowState;
    entryEpoch: number;
    slaDeadline?: number;
}
interface ExecuteSystemStepInput {
    ref: string;
    definition: DefinitionIdentity;
    subject: FlowkitSubject;
    state: FlowState;
    entryEpoch: number;
    entryReason: EntryReason;
    priorTransition?: TransitionRecord;
}
interface ExecuteSystemStepOutput {
    output?: unknown;
}
interface ExecuteAiStepInput {
    ref: string;
    definition: DefinitionIdentity;
    subject: FlowkitSubject;
    state: FlowState;
    entryEpoch: number;
    entryReason: EntryReason;
    priorTransition?: TransitionRecord;
}
interface ExecuteAiStepOutput {
    output?: unknown;
}
interface DispatchNotificationInput {
    /** Deterministic dedupe key shared by fast-path and outbox fallback. */
    operationKey: string;
    definition: DefinitionIdentity;
    subject: FlowkitSubject;
    notification: FlowkitNotificationBinding;
    context?: Record<string, unknown>;
}
/** Pure rule evaluation context; rules run on stage entry, inside the loop. */
interface RuleContext {
    definition: FlowDefinition;
    state: FlowState;
    subject: Readonly<Record<string, unknown>>;
    facts: Readonly<Record<string, unknown>>;
    priorTransition?: TransitionRecord;
}
/**
 * A pure rule returns the name of a follow-up system action, or `undefined`
 * when no automatic transition should fire.
 */
type FlowkitRule = (ctx: RuleContext) => string | undefined;
interface FlowkitRuleRegistration {
    run: FlowkitRule;
    /**
     * Finite set of system action names this rule may return. Boot validation
     * rejects registrations that could target a human or unknown action.
     */
    actions: string[];
}
/** Compiled pure registries bundled with the workflow code. */
interface FlowkitPureRegistries {
    policies?: AuthorizationPolicyRegistry;
    guards?: GuardRegistry;
    rules?: Record<string, FlowkitRuleRegistration>;
}
/**
 * Declared refs for I/O work. The workflow bundle only carries the names;
 * the consumer's worker registers the actual handlers.
 */
interface FlowkitDeclaredRefs {
    systemSteps?: Record<string, unknown>;
    aiSteps?: Record<string, unknown>;
    templates?: Record<string, unknown>;
    channels?: Record<string, unknown>;
}
/** Activity handler surface implemented by the consumer's worker. */
interface FlowkitActivityRegistry {
    resolveActionContext(input: ResolveActionContextInput): Promise<ResolvedActionContext>;
    recordTransition(input: RecordTransitionInput): Promise<RecordTransitionOutput>;
    recordStageReady(input: RecordStageReadyInput): Promise<void>;
    executeSystemStep(input: ExecuteSystemStepInput): Promise<ExecuteSystemStepOutput>;
    executeAiStep(input: ExecuteAiStepInput): Promise<ExecuteAiStepOutput>;
    dispatchNotification(input: DispatchNotificationInput): Promise<void>;
}

interface FlowkitWorkflowConfig {
    registries: FlowkitPureRegistries;
    /**
     * Omit to run activities on the workflow's own task queue. A workflow module is imported inside
     * the deterministic sandbox, where `process` does not exist, so a consumer that has to read this
     * from the environment cannot configure it here.
     */
    activityTaskQueue?: string;
    activityOptions?: Parameters<typeof proxyActivities>[0];
    queryName?: string;
    updateName?: string;
    maxAutomaticTransitionsPerTurn?: number;
    shouldContinueAsNew?: () => boolean;
    adaptState?: (args: {
        state: FlowkitStateView;
        input: FlowkitWorkflowInput;
    }) => unknown;
}
type FlowkitWorkflow = (input: FlowkitWorkflowInput) => Promise<unknown>;
/**
 * Creates a deterministic workflow interpreter. Definitions remain execution
 * input so replay never reads a mutable definition registry.
 */
declare function createFlowkitWorkflow(config: FlowkitWorkflowConfig): FlowkitWorkflow;

export { type CommandEnvelope as C, type DefinitionHash as D, type EntryReason as E, type FlowkitWorkflow as F, type PublishedFlowDefinition as P, type RecordStageReadyInput as R, type FlowkitWorkflowInput as a, type FlowkitStateView as b, type FlowkitPureRegistries as c, type FlowkitDeclaredRefs as d, type CommandOrigin as e, type DefinitionIdentity as f, type DispatchNotificationInput as g, type ExecuteAiStepInput as h, type ExecuteAiStepOutput as i, type ExecuteSystemStepInput as j, type ExecuteSystemStepOutput as k, type FlowkitActorRef as l, type FlowkitActivityRegistry as m, type FlowkitExecutionState as n, type FlowkitNotificationBinding as o, type FlowkitStepResult as p, type FlowkitSubject as q, type FlowkitRule as r, type FlowkitRuleRegistration as s, type RecordTransitionInput as t, type RecordTransitionOutput as u, type ResolveActionContextInput as v, type ResolvedActionContext as w, type RuleContext as x, type FlowkitWorkflowConfig as y, createFlowkitWorkflow as z };
