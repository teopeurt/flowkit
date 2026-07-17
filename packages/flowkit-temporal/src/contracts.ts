import type {
  FlowCommand,
  FlowDefinition,
  FlowState,
  TransitionRecord,
} from '@flowkit/core';

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
  metadata?: Record<string, unknown>;
}

/** Who/what originated a command. Rules and SLAs may only target system actions. */
export type CommandOrigin = 'human' | 'rule' | 'sla';

/** Server-resolved authenticated actor. Never trusted from command payloads. */
export interface FlowkitActorRef {
  id: string;
  roles: string[];
  organizationId?: string;
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

export interface FlowkitStepResult {
  ref: string;
  kind: 'system' | 'ai' | 'rule';
  status: 'completed' | 'degraded_to_human';
  entryEpoch: number;
  output?: unknown;
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
  command: FlowCommand;
}

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
}

export interface RecordTransitionOutput {
  /** Projected state; an idempotent retry returns the stored state. */
  state: FlowState;
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
  ref: string;
  definition: DefinitionIdentity;
  subject: FlowkitSubject;
  state: FlowState;
  entryEpoch: number;
  entryReason: EntryReason;
  priorTransition?: TransitionRecord;
}

export interface ExecuteSystemStepOutput {
  output?: unknown;
}

export interface ExecuteAiStepInput {
  ref: string;
  definition: DefinitionIdentity;
  subject: FlowkitSubject;
  state: FlowState;
  entryEpoch: number;
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
