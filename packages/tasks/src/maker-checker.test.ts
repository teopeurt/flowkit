import { describe, expect, it } from 'bun:test';
import { evaluateMakerChecker, evaluateSeparationOfDuties } from './maker-checker.js';

describe('maker checker', () => {
  const rule = { makerStage: 'maker', checkerStage: 'checker', factKey: 'makerActor' };
  const event = { id: 'e', taskId: 't', sequence: 1, transitionSequence: 1, operationId: 'op', eventType: 'completed' as const, previousStatus: 'claimed' as const, nextStatus: 'completed' as const, previousAssigneeId: 'maker-1', nextAssigneeId: null, actorId: 'maker-1', reason: null, action: 'submit', lifecycleEpoch: 0, metadata: {}, createdAt: '2026-07-27T00:00:00.000Z' };
  it('denies the maker and allows another actor', () => {
    expect(evaluateMakerChecker({ rule, actorId: 'maker-1', latestMakerCompletion: event }).allowed).toBe(false);
    expect(evaluateMakerChecker({ rule, actorId: 'checker-1', latestMakerCompletion: event }).allowed).toBe(true);
  });
  it('does not allow missing history', () => { expect(evaluateMakerChecker({ rule, actorId: 'checker-1', latestMakerCompletion: null }).reason).toBe('missing_history'); });

  it('preserves missing-history compatibility for malformed maker completions', () => {
    const malformed = { ...event, eventType: 'claimed' as const, nextStatus: 'claimed' as const, action: null };
    expect(evaluateMakerChecker({ rule, actorId: 'checker-1', latestMakerCompletion: malformed })).toEqual({
      allowed: false,
      reason: 'missing_history',
      makerId: null,
      factKey: 'makerActor',
    });
  });

  it('fails closed when a completion has no actor', () => {
    const systemCompletion = { ...event, actorId: null };
    expect(evaluateSeparationOfDuties({ actorId: 'checker-1', priorCompletions: [systemCompletion], factKey: 'makerActor' })).toEqual({
      allowed: false,
      reason: 'missing_history',
      conflictingActorIds: [],
      priorActorIds: [],
      factKey: 'makerActor',
    });
  });

  it('reports missing history when the generalized chain is empty or incomplete', () => {
    expect(evaluateSeparationOfDuties({ actorId: 'checker-1', priorCompletions: [], factKey: 'makerActor' })).toEqual({
      allowed: false,
      reason: 'missing_history',
      conflictingActorIds: [],
      priorActorIds: [],
      factKey: 'makerActor',
    });
    expect(evaluateSeparationOfDuties({ actorId: 'checker-1', priorCompletions: [null], factKey: 'makerActor' }).reason).toBe('missing_history');
  });

  it('rejects a completion that is not a completed task transition', () => {
    const wrongStage = { ...event, nextStatus: 'claimed' as const, action: null };
    expect(evaluateSeparationOfDuties({ actorId: 'checker-1', priorCompletions: [wrongStage], factKey: 'makerActor' })).toEqual({
      allowed: false,
      reason: 'wrong_stage',
      conflictingActorIds: [],
      priorActorIds: ['maker-1'],
      factKey: 'makerActor',
    });
  });

  it('excludes every actor in a three-party decision chain', () => {
    const confirmer = { ...event, id: 'e2', actorId: 'checker-1', operationId: 'confirm' };
    expect(evaluateSeparationOfDuties({
      actorId: 'checker-1',
      priorCompletions: [event, confirmer],
      factKey: 'appealActors',
    })).toEqual({
      allowed: false,
      reason: 'same_actor',
      conflictingActorIds: ['checker-1'],
      priorActorIds: ['maker-1', 'checker-1'],
      factKey: 'appealActors',
    });
    expect(evaluateSeparationOfDuties({
      actorId: 'appeal-1',
      priorCompletions: [event, confirmer],
      factKey: 'appealActors',
    }).allowed).toBe(true);
  });

  it('reports every conflicting actor in a multi-actor chain', () => {
    const confirmer = { ...event, id: 'e2', actorId: 'checker-1', operationId: 'confirm' };
    expect(evaluateSeparationOfDuties({
      actorId: 'maker-1',
      priorCompletions: [event, confirmer],
      factKey: 'appealActors',
    })).toEqual({
      allowed: false,
      reason: 'same_actor',
      conflictingActorIds: ['maker-1'],
      priorActorIds: ['maker-1', 'checker-1'],
      factKey: 'appealActors',
    });
  });
});
