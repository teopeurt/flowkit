import type {
  EvaluationContext,
  FlowCommand,
  FlowDefinition,
  FlowState,
  PredicateContext,
} from './types';

export interface TransitionRecord {
  action: string;
  fromStage: string;
  nextStage: string;
  status: string;
  pendingRole: string | null;
  trackUpdates: Record<string, string>;
}

export interface TransitionOutcome {
  state: FlowState;
  transition: TransitionRecord;
}

export interface FlowStateOverrides {
  stage?: string;
  status?: string;
  pendingRole?: string | null;
  tracks?: Record<string, string>;
}

export class UnknownStageError extends Error {
  constructor(readonly stage: string) {
    super(`Unknown stage "${stage}".`);
    this.name = 'UnknownStageError';
  }
}

export class UnknownTrackError extends Error {
  constructor(readonly track: string) {
    super(`Unknown track "${track}".`);
    this.name = 'UnknownTrackError';
  }
}

export class InvalidTrackValueError extends Error {
  constructor(
    readonly track: string,
    readonly value: string,
    readonly allowedValues: readonly string[],
  ) {
    super(
      `Invalid value "${value}" for track "${track}". Expected one of: ${allowedValues.join(', ')}`,
    );
    this.name = 'InvalidTrackValueError';
  }
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly stage: string,
    readonly action: string,
    readonly sourceStages: string[],
  ) {
    super(
      `Invalid action "${action}" from stage "${stage}". Declared on: ${sourceStages.join(', ') || '<none>'}`,
    );
    this.name = 'InvalidTransitionError';
  }
}

export class MissingPolicyError extends Error {
  constructor(readonly policy: string, readonly action: string) {
    super(`Missing authorization policy "${policy}" for action "${action}".`);
    this.name = 'MissingPolicyError';
  }
}

export class MissingGuardError extends Error {
  constructor(readonly guard: string, readonly action: string) {
    super(`Missing guard "${guard}" for action "${action}".`);
    this.name = 'MissingGuardError';
  }
}

export class AuthorizationRejectionError extends Error {
  constructor(readonly policy: string, readonly action: string) {
    super(`Authorization policy "${policy}" rejected action "${action}".`);
    this.name = 'AuthorizationRejectionError';
  }
}

export class GuardRejectionError extends Error {
  constructor(readonly guard: string, readonly action: string) {
    super(`Guard "${guard}" rejected action "${action}".`);
    this.name = 'GuardRejectionError';
  }
}

const getStage = (definition: FlowDefinition, stage: string) => {
  const resolved = definition.stages[stage];

  if (!resolved) {
    throw new UnknownStageError(stage);
  }

  return resolved;
};

const validateTracks = (
  definition: FlowDefinition,
  tracks: Record<string, string>,
) => {
  const declaredTracks = definition.tracks ?? {};

  for (const [trackName, trackValue] of Object.entries(tracks)) {
    const declaredTrack = declaredTracks[trackName];

    if (!declaredTrack) {
      throw new UnknownTrackError(trackName);
    }

    if (!declaredTrack.values.includes(trackValue)) {
      throw new InvalidTrackValueError(trackName, trackValue, declaredTrack.values);
    }
  }
};

const buildPredicateContext = (
  definition: FlowDefinition,
  state: FlowState,
  command: FlowCommand,
  context: EvaluationContext,
): PredicateContext => ({
  definition,
  state,
  command,
  subject: context.subject ?? {},
  facts: context.facts ?? {},
  actor: context.actor,
});

const validateState = (definition: FlowDefinition, state: FlowState) => {
  getStage(definition, state.stage);
  validateTracks(definition, state.tracks);
};

export function buildInitialState(
  definition: FlowDefinition,
  overrides: FlowStateOverrides = {},
): FlowState {
  const stage = overrides.stage ?? definition.initialStage;
  const stageDefinition = getStage(definition, stage);
  const baseTracks = Object.fromEntries(
    Object.entries(definition.tracks ?? {}).map(([trackName, track]) => [
      trackName,
      track.initial,
    ]),
  );
  const tracks = {
    ...baseTracks,
    ...(overrides.tracks ?? {}),
  };

  validateTracks(definition, tracks);

  return {
    stage,
    status: overrides.status ?? definition.initialStatus ?? 'pending',
    pendingRole:
      overrides.pendingRole === undefined
        ? stageDefinition.pendingRole ?? null
        : overrides.pendingRole,
    tracks,
  };
}

export function getDeclaredActions(
  definition: FlowDefinition,
  stage: string,
): string[] {
  return Object.keys(getStage(definition, stage).actions ?? {});
}

export function getActionSourceStages(
  definition: FlowDefinition,
  action: string,
): string[] {
  return Object.entries(definition.stages)
    .filter(([, stage]) => stage.actions?.[action])
    .map(([stageName]) => stageName);
}

export function transition(
  definition: FlowDefinition,
  state: FlowState,
  command: FlowCommand,
  context: EvaluationContext = {},
): TransitionOutcome {
  validateState(definition, state);

  const stageDefinition = getStage(definition, state.stage);
  const actionDefinition = stageDefinition.actions?.[command.action];

  if (!actionDefinition) {
    throw new InvalidTransitionError(
      state.stage,
      command.action,
      getActionSourceStages(definition, command.action),
    );
  }

  const predicateContext = buildPredicateContext(definition, state, command, context);

  if (actionDefinition.policy) {
    const policy = context.policies?.[actionDefinition.policy];

    if (!policy) {
      throw new MissingPolicyError(actionDefinition.policy, command.action);
    }

    if (!policy(predicateContext)) {
      throw new AuthorizationRejectionError(actionDefinition.policy, command.action);
    }
  }

  for (const guardName of actionDefinition.guards ?? []) {
    const guard = context.guards?.[guardName];

    if (!guard) {
      throw new MissingGuardError(guardName, command.action);
    }

    if (!guard(predicateContext)) {
      throw new GuardRejectionError(guardName, command.action);
    }
  }

  const nextStageDefinition = getStage(definition, actionDefinition.to);
  const trackUpdates = { ...(actionDefinition.tracks ?? {}) };
  const nextTracks = {
    ...state.tracks,
    ...trackUpdates,
  };

  validateTracks(definition, nextTracks);

  const nextState: FlowState = {
    stage: actionDefinition.to,
    status: actionDefinition.status ?? state.status,
    pendingRole: actionDefinition.pendingRole ?? nextStageDefinition.pendingRole ?? null,
    tracks: nextTracks,
  };

  return {
    state: nextState,
    transition: {
      action: command.action,
      fromStage: state.stage,
      nextStage: nextState.stage,
      status: nextState.status,
      pendingRole: nextState.pendingRole,
      trackUpdates,
    },
  };
}
