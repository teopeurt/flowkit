export interface TrackDef {
  initial: string;
  values: string[];
}

export interface StepDef {
  kind: 'system' | 'ai' | 'rule';
  ref: string;
  gate?: 'human';
}

export interface NotificationDef {
  template: string;
  channels: string[];
  to?: string[];
}

export type NotificationBinding = NotificationDef | NotificationDef[];

export interface ActionDef {
  to: string;
  kind?: 'human' | 'system' | 'signal';
  status?: string;
  pendingRole?: string | null;
  tracks?: Record<string, string>;
  guards?: string[];
  policy?: string;
  notify?: NotificationBinding;
}

export interface StageDef {
  pendingRole?: string | null;
  final?: boolean;
  steady?: boolean;
  entry?: StepDef[];
  entryNotify?: NotificationBinding;
  disabledGlobalActions?: string[];
  sla?: {
    after: string;
    escalate: { notify?: string; action?: string };
  };
  actions?: Record<string, ActionDef>;
}

export interface FlowDefinition {
  id: string;
  version: number;
  roles: string[];
  tracks?: Record<string, TrackDef>;
  initialStage: string;
  initialStatus?: string;
  actions?: Record<string, ActionDef>;
  stages: Record<string, StageDef>;
}

export type StageName<D extends FlowDefinition> = keyof D['stages'] & string;

export type StageActionName<D extends FlowDefinition> = {
  [S in keyof D['stages']]: D['stages'][S] extends { actions?: infer A }
    ? keyof NonNullable<A> & string
    : never;
}[keyof D['stages']];

export type ActionName<D extends FlowDefinition> =
  | StageActionName<D>
  | (D extends { actions?: infer A } ? keyof NonNullable<A> & string : never);

export interface FlowCommand {
  action: string;
  actorId?: string;
  comment?: string;
  payload?: Record<string, unknown>;
  attachments?: Array<{ url: string; name?: string; size?: number; type?: string }>;
}

export interface FlowState {
  stage: string;
  status: string;
  pendingRole: string | null;
  tracks: Record<string, string>;
}

export interface EvaluationContext {
  subject?: Readonly<Record<string, unknown>>;
  facts?: Readonly<Record<string, unknown>>;
  actor?: Readonly<{ id: string; roles: string[]; organizationId?: string }>;
  guards?: GuardRegistry;
  policies?: AuthorizationPolicyRegistry;
}

export interface PredicateContext {
  definition: FlowDefinition;
  state: FlowState;
  command: FlowCommand;
  subject: Readonly<Record<string, unknown>>;
  facts: Readonly<Record<string, unknown>>;
  actor?: EvaluationContext['actor'];
}

export type Guard = (ctx: PredicateContext) => boolean;
export type GuardRegistry = Record<string, Guard>;
export type AuthorizationPolicy = (ctx: PredicateContext) => boolean;
export type AuthorizationPolicyRegistry = Record<string, AuthorizationPolicy>;

export type LintIssueCode =
  | 'unreachable-stage'
  | 'dead-end-stage'
  | 'final-stage-has-actions'
  | 'unused-role'
  | 'unused-track'
  | 'duplicate-action-source'
  | 'missing-guard-ref'
  | 'missing-policy-ref'
  | 'missing-step-ref'
  | 'missing-template-ref'
  | 'missing-channel-ref'
  | 'missing-action-policy'
  | 'unbounded-stage';

export interface LintIssue {
  code: LintIssueCode;
  severity: 'error' | 'warning';
  message: string;
  path: string;
}
