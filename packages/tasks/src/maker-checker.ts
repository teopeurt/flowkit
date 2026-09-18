import type { TaskEvent } from './contracts.js';

export interface SeparationOfDutiesDecision {
  allowed: boolean;
  reason: 'allowed' | 'same_actor' | 'missing_history' | 'wrong_stage';
  conflictingActorIds: string[];
  priorActorIds: string[];
  factKey: string;
}

export function evaluateSeparationOfDuties(input: {
  actorId: string;
  priorCompletions: Array<TaskEvent | null>;
  factKey: string;
}): SeparationOfDutiesDecision {
  if (input.priorCompletions.length === 0 || input.priorCompletions.some((event) => event === null)) {
    return { allowed: false, reason: 'missing_history', conflictingActorIds: [], priorActorIds: [], factKey: input.factKey };
  }
  const completions = input.priorCompletions as TaskEvent[];
  if (completions.some((event) => event.actorId === null)) {
    return { allowed: false, reason: 'missing_history', conflictingActorIds: [], priorActorIds: [], factKey: input.factKey };
  }
  const priorActorIds = [...new Set(completions.flatMap((event) => event.actorId ? [event.actorId] : []))];
  if (completions.some((event) => event.eventType !== 'completed' || event.nextStatus !== 'completed' || event.action === null)) {
    return { allowed: false, reason: 'wrong_stage', conflictingActorIds: [], priorActorIds, factKey: input.factKey };
  }
  const conflictingActorIds = priorActorIds.filter((actorId) => actorId === input.actorId);
  return {
    allowed: conflictingActorIds.length === 0,
    reason: conflictingActorIds.length === 0 ? 'allowed' : 'same_actor',
    conflictingActorIds,
    priorActorIds,
    factKey: input.factKey,
  };
}

export interface MakerCheckerRule { makerStage: string; checkerStage: string; makerRole?: string; checkerRole?: string; factKey: string; }
export interface MakerCheckerDecision { allowed: boolean; reason: 'allowed' | 'same_actor' | 'missing_history' | 'wrong_stage'; makerId: string | null; factKey: string; }
export function evaluateMakerChecker(input: { rule: MakerCheckerRule; actorId: string; latestMakerCompletion: TaskEvent | null }): MakerCheckerDecision {
  const event = input.latestMakerCompletion;
  if (!event || event.eventType !== 'completed' || event.nextStatus !== 'completed' || event.actorId === null) {
    return { allowed: false, reason: 'missing_history', makerId: null, factKey: input.rule.factKey };
  }
  const decision = evaluateSeparationOfDuties({ actorId: input.actorId, priorCompletions: [input.latestMakerCompletion], factKey: input.rule.factKey });
  return { allowed: decision.allowed, reason: decision.reason, makerId: decision.priorActorIds[0] ?? null, factKey: decision.factKey };
}
