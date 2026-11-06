import type { ActivityOptions } from '@temporalio/workflow';
import type {
  AuthorizationPolicyRegistry,
  FlowCommand,
  FlowDefinition,
  FlowState,
  GuardRegistry,
  TransitionRecord,
} from '@naakwu/flowkit-core';

/**
 * Data contracts shared between Flowkit consumers (workers, services) and the
 * generic interpreter. Every public workflow and Activity contract takes a
 * single object parameter so call sites stay stable as fields are added.
 */

export type DefinitionHash = `sha256:${string}`;

export interface PublishedFlowDefinition {
  definitionSnapshot: FlowDefinition;
  definitionHash: DefinitionHash;
}

/** Subject (application/case) the workflow instance governs. */
export interface FlowkitSubject {
  id: string;
  organizationId: string;
  metadata?: Record<string, unknown>;
}

/** Signal ingress deliberately has no caller-supplied actor identity. */
export type FlowkitSignalCommand = Omit<FlowCommand, 'actorId'>;

/** Who/what originated a command. Rules and SLAs may only target system actions. */
export type CommandOrigin = 'human' | 'signal' | 'rule' | 'sla';

/** Server-resolved authenticated actor. Never trusted from command payloads. */
export interface FlowkitActorRef {
  id: string;
  roles: string[];
  organizationId: string;
}

export interface FlowkitNotificationBinding {
  template: string;
  channels: string[];
  to?: string[];
}

export type EntryReason = 'initial' | 'transition';

/** One queued command processed serially by the interpreter's main loop. */
export interface CommandEnvelope {
  operationId: string;
  origin: CommandOrigin;
  command: FlowCommand;
}

/** Lifecycle of one subagent task inside an orchestration. */
export type OrchestrationTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Per-task progress recorded on an orchestrate step result. Outputs are never kept here, only a reference. */
export interface FlowkitOrchestrationTaskState {
  id: string;
  agent: string;
  status: OrchestrationTaskStatus;
  outputRef?: string;
}

export interface FlowkitStepResult {
  ref: string;
  kind: 'system' | 'ai' | 'rule' | 'orchestrate';
  /**
   * `running` and `superseded` apply to orchestrate steps only: an orchestration is in flight, or the
   * stage changed before it finished and its late results were discarded.
   */
  status: 'completed' | 'degraded_to_human' | 'running' | 'superseded';
  entryEpoch: number;
  output?: unknown;
  /** Present for `gate: auto` steps: whether the deciding rule released the stage or left it to a human. */
  gateDecision?: { outcome: 'auto' | 'human'; action?: string };
  /** Orchestrate steps only: live per-subagent progress. */
  tasks?: FlowkitOrchestrationTaskState[];
}

/** Full interpreter state; carried across Continue-As-New unchanged. */
export interface FlowkitExecutionState {
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
export interface FlowkitWorkflowInput {
  published: PublishedFlowDefinition;
  subject: FlowkitSubject;
  initialState?: FlowState;
  resume?: {
    execution: FlowkitExecutionState;
  };
}

/** Generic read model returned by the state query (adapters may reshape). */
export interface FlowkitStateView {
  state: FlowState;
  sequence: number;
  stepResults: Record<string, FlowkitStepResult>;
  slaDeadline?: number;
  completed: boolean;
  nextActions: string[];
}

export interface DefinitionIdentity {
  id: string;
  version: number;
  hash: DefinitionHash;
}

/* ------------------------------------------------------------------------ */
/* Activity contracts (implemented by the consumer's worker)                 */
/* ------------------------------------------------------------------------ */

export interface ResolveActionContextInput {
  workflowId: string;
  runId: string;
  operationId: string;
  origin: CommandOrigin;
  definition: DefinitionIdentity;
  subject: FlowkitSubject;
  state: FlowState;
  /**
   * For signal origins, actorId is deliberately omitted: caller-provided
   * signal identity is untrusted and the activity must resolve the service
   * principal from its own boundary.
   */
  command: FlowCommand;
}

/**
 * A resolved actor is authoritative for policy and organization scope. The
 * `command.actorId` field is only an ingress hint for human commands and is
 * never an authorization assertion.
 */
export interface ResolvedActionContext {
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

export interface RecordTransitionInput {
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
  notifications?: FlowkitNotificationBinding[];
}

export interface RecordTransitionOutput {
  /** Projected state; an idempotent retry returns the stored state. */
  state: FlowState;
  /** False when the operation was already committed. */
  created?: boolean;
}

export interface RecordStageReadyInput {
  workflowId: string;
  definition: DefinitionIdentity;
  subject: FlowkitSubject;
  state: FlowState;
  entryEpoch: number;
  slaDeadline?: number;
}

export interface ExecuteSystemStepInput {
  workflowId: string;
  ref: string;
  definition: DefinitionIdentity;
  subject: FlowkitSubject;
  state: FlowState;
  entryEpoch: number;
  stepIndex: number;
  /**
   * Serialized `(workflowId, entryEpoch, stepIndex)` identity. Activity
   * persistence must enforce that tuple, or this complete key, for dedupe.
   */
  idempotencyKey: string;
  entryReason: EntryReason;
  priorTransition?: TransitionRecord;
}

export interface ExecuteSystemStepOutput {
  output?: unknown;
}

export interface ExecuteAiStepInput {
  workflowId: string;
  ref: string;
  definition: DefinitionIdentity;
  subject: FlowkitSubject;
  state: FlowState;
  entryEpoch: number;
  stepIndex: number;
  /** Serialized `(workflowId, entryEpoch, stepIndex)` identity; see system steps. */
  idempotencyKey: string;
  entryReason: EntryReason;
  priorTransition?: TransitionRecord;
}

export interface ExecuteAiStepOutput {
  output?: unknown;
}

export interface DispatchNotificationInput {
  /** Deterministic dedupe key shared by fast-path and outbox fallback. */
  operationKey: string;
  definition: DefinitionIdentity;
  subject: FlowkitSubject;
  notification: FlowkitNotificationBinding;
  context?: Record<string, unknown>;
}

/* ------------------------------------------------------------------------ */
/* Registries                                                                */
/* ------------------------------------------------------------------------ */

/** Pure rule evaluation context; rules run on stage entry, inside the loop. */
export interface RuleContext {
  definition: FlowDefinition;
  state: FlowState;
  subject: Readonly<Record<string, unknown>>;
  facts: Readonly<Record<string, unknown>>;
  priorTransition?: TransitionRecord;
  /** Set only when the rule is deciding an `auto` gate: that step's raw output. */
  gatedOutput?: unknown;
  /** Set only when the rule is deciding an `auto` orchestrate gate: the final status of every subagent task. */
  tasks?: ReadonlyArray<{ id: string; agent: string; status: 'completed' | 'failed' | 'cancelled' }>;
}

/**
 * A pure rule returns the name of a follow-up system action, or `undefined`
 * when no automatic transition should fire.
 */
export type FlowkitRule = (ctx: RuleContext) => string | undefined;

export interface FlowkitRuleRegistration {
  run: FlowkitRule;
  /**
   * Finite set of system action names this rule may return. Boot validation
   * rejects registrations that could target a human or unknown action.
   */
  actions: string[];
}

/** Hard ceiling on tasks and concurrency for one orchestration, whatever the registration asks for. */
export const FLOWKIT_ORCHESTRATION_HARD_LIMIT = 64;

/** Defaults applied when an orchestrator registration omits a limit. */
export const FLOWKIT_ORCHESTRATION_DEFAULTS = {
  maxTasks: 16,
  maxConcurrency: 4,
  failFast: false,
  maxOutputBytes: 65_536,
} as const;

/**
 * Registration of one named orchestrator. Limits live here, in compiled code, and never in the
 * serialized definition, so a definition cannot change its own resource limits.
 */
export interface FlowkitOrchestratorRegistration {
  /** Finite set of subagent names a plan may assign tasks to. Must not be empty. */
  agents: string[];
  /** Maximum tasks accepted from the plan (1 to 64, default 16). */
  maxTasks?: number;
  /** Maximum subagent activities running at once (1 to 64, default 4). */
  maxConcurrency?: number;
  /** When true the first failed task cancels the remaining ones (default false). */
  failFast?: boolean;
  /** Cap on the synthesized output, in UTF-8 bytes of its JSON form (default 65536). */
  maxOutputBytes?: number;
  /** Temporal activity options for this orchestrator's plan, subagent and synthesize activities. */
  activityOptions?: ActivityOptions;
}

/** Compiled pure registries bundled with the workflow code. */
export interface FlowkitPureRegistries {
  policies?: AuthorizationPolicyRegistry;
  guards?: GuardRegistry;
  rules?: Record<string, FlowkitRuleRegistration>;
  orchestrators?: Record<string, FlowkitOrchestratorRegistration>;
}

/**
 * Declared refs for I/O work. The workflow bundle only carries the names;
 * the consumer's worker registers the actual handlers.
 */
export interface FlowkitDeclaredRefs {
  systemSteps?: Record<string, unknown>;
  aiSteps?: Record<string, unknown>;
  templates?: Record<string, unknown>;
  channels?: Record<string, unknown>;
}

/** Activity handler surface implemented by the consumer's worker. */
export interface FlowkitActivityRegistry {
  resolveActionContext(input: ResolveActionContextInput): Promise<ResolvedActionContext>;
  recordTransition(input: RecordTransitionInput): Promise<RecordTransitionOutput>;
  recordStageReady(input: RecordStageReadyInput): Promise<void>;
  executeSystemStep(input: ExecuteSystemStepInput): Promise<ExecuteSystemStepOutput>;
  executeAiStep(input: ExecuteAiStepInput): Promise<ExecuteAiStepOutput>;
  dispatchNotification(input: DispatchNotificationInput): Promise<void>;
}

/* ------------------------------------------------------------------------ */
/* Orchestration activities (optional; implemented by the consumer's worker) */
/* ------------------------------------------------------------------------ */

/** Identity every orchestration activity receives; mirrors the AI and system step inputs. */
export interface OrchestrationStepInput {
  workflowId: string;
  ref: string;
  definition: DefinitionIdentity;
  subject: FlowkitSubject;
  state: FlowState;
  entryEpoch: number;
  stepIndex: number;
  /**
   * Serialized `[workflowId, entryEpoch, stepIndex, phase]` where phase is `"plan"`, `"synthesize"`, or
   * `"task", taskId` for a subagent, so the three kinds of activity never share a key. Activities must be
   * idempotent on it.
   */
  idempotencyKey: string;
  entryReason: EntryReason;
  priorTransition?: TransitionRecord;
}

/** One unit of work the plan assigns to a subagent. */
export interface OrchestrationTask {
  id: string;
  agent: string;
  input?: unknown;
}

export type PlanOrchestrationInput = OrchestrationStepInput;

export interface PlanOrchestrationOutput {
  tasks: OrchestrationTask[];
}

export interface RunSubagentInput extends OrchestrationStepInput {
  taskId: string;
  agent: string;
  input?: unknown;
}

export interface RunSubagentOutput {
  output?: unknown;
  /** Reference to a large result stored outside workflow history. */
  outputRef?: string;
}

/** The outcome of one task, as handed to the synthesize activity. */
export interface OrchestrationTaskResult {
  id: string;
  agent: string;
  status: 'completed' | 'failed' | 'cancelled';
  output?: unknown;
  outputRef?: string;
  error?: string;
}

export interface SynthesizeOrchestrationInput extends OrchestrationStepInput {
  results: OrchestrationTaskResult[];
}

export interface SynthesizeOrchestrationOutput {
  output?: unknown;
}

/**
 * Activities an orchestrate step needs. A separate interface so existing consumers, which implement
 * only {@link FlowkitActivityRegistry}, are unaffected.
 */
export interface FlowkitOrchestrationActivities {
  planOrchestration(input: PlanOrchestrationInput): Promise<PlanOrchestrationOutput>;
  runSubagent(input: RunSubagentInput): Promise<RunSubagentOutput>;
  synthesizeOrchestration(input: SynthesizeOrchestrationInput): Promise<SynthesizeOrchestrationOutput>;
}
