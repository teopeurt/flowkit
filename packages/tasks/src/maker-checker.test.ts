import { describe, expect, it } from 'bun:test';
import { evaluateMakerChecker } from './maker-checker.js';

describe('maker checker', () => {
  const rule = { makerStage: 'maker', checkerStage: 'checker', factKey: 'makerActor' };
  const event = { id: 'e', taskId: 't', sequence: 1, transitionSequence: 1, operationId: 'op', eventType: 'completed' as const, previousStatus: 'claimed' as const, nextStatus: 'completed' as const, previousAssigneeId: 'maker-1', nextAssigneeId: null, actorId: 'maker-1', reason: null, action: 'submit', lifecycleEpoch: 0, metadata: {}, createdAt: '2026-07-27T00:00:00.000Z' };
  it('denies the maker and allows another actor', () => {
    expect(evaluateMakerChecker({ rule, actorId: 'maker-1', latestMakerCompletion: event }).allowed).toBe(false);
    expect(evaluateMakerChecker({ rule, actorId: 'checker-1', latestMakerCompletion: event }).allowed).toBe(true);
  });
  it('does not allow missing history', () => { expect(evaluateMakerChecker({ rule, actorId: 'checker-1', latestMakerCompletion: null }).reason).toBe('missing_history'); });
});
