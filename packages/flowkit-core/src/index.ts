export const FLOWKIT_CORE_VERSION = '0.1.0';

export { validateRegistryRefs, lintFlow, lintInterpreterFlow } from './lint';
export { defineFlow, FlowDefinitionError, flowSchema, formatIssues } from './schema';
export {
  AuthorizationRejectionError,
  buildInitialState,
  getActionSourceStages,
  getDeclaredActions,
  GuardRejectionError,
  InvalidTrackValueError,
  InvalidTransitionError,
  MissingGuardError,
  MissingPolicyError,
  transition,
  UnknownStageError,
  UnknownTrackError,
} from './transition';
export type {
  ActionDef,
  ActionName,
  AuthorizationPolicy,
  AuthorizationPolicyRegistry,
  EvaluationContext,
  FlowCommand,
  FlowDefinition,
  LintIssue,
  LintIssueCode,
  FlowState,
  Guard,
  GuardRegistry,
  PredicateContext,
  StageDef,
  StageName,
  StepDef,
  TrackDef,
} from './types';
export type { FlowStateOverrides, TransitionOutcome, TransitionRecord } from './transition';

export * from './schema';
export * from './types';
