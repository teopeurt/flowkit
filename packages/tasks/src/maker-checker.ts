import type { TaskEvent } from './contracts.js';

export interface MakerCheckerRule { makerStage: string; checkerStage: string; makerRole?: string; checkerRole?: string; factKey: string; }
export interface MakerCheckerDecision { allowed: boolean; reason: 'allowed' | 'same_actor' | 'missing_history' | 'wrong_stage'; makerId: string | null; factKey: string; }
export function evaluateMakerChecker(input: { rule: MakerCheckerRule; actorId: string; latestMakerCompletion: TaskEvent | null }): MakerCheckerDecision {
  const event = input.latestMakerCompletion;
  if (!event || event.eventType !== 'completed' || event.nextStatus !== 'completed') return { allowed: false, reason: 'missing_history', makerId: null, factKey: input.rule.factKey };
  if (event.action === null) return { allowed: false, reason: 'wrong_stage', makerId: event.actorId, factKey: input.rule.factKey };
  if (event.actorId === input.actorId) return { allowed: false, reason: 'same_actor', makerId: event.actorId, factKey: input.rule.factKey };
  return { allowed: true, reason: 'allowed', makerId: event.actorId, factKey: input.rule.factKey };
}
