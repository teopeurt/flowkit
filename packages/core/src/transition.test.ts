import { describe, expect, test } from 'bun:test';

import * as flowkit from './index';
import { docReviewFlow } from './testing/doc-review.fixture';
import {
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

const expectError = <T extends Error>(
  run: () => unknown,
  ctor: new (...args: any[]) => T,
): T => {
  try {
    run();
  } catch (error) {
    if (error instanceof ctor) {
      return error;
    }

    throw error;
  }

  throw new Error(`Expected ${ctor.name} to be thrown.`);
};

describe('transition kernel', () => {
  test('buildInitialState uses explicit track initial values', () => {
    expect(buildInitialState(docReviewFlow)).toEqual({
      stage: 'draft',
      status: 'pending',
      pendingRole: 'author',
      tracks: {
        visibility: 'private',
      },
    });
  });

  test('resume overrides reject unknown stages, tracks, or track values', () => {
    expectError(() => buildInitialState(docReviewFlow, { stage: 'missing' }), UnknownStageError);
    expectError(
      () => buildInitialState(docReviewFlow, { tracks: { confidentiality: 'public' } }),
      UnknownTrackError,
    );
    expectError(
      () => buildInitialState(docReviewFlow, { tracks: { visibility: 'internal' } }),
      InvalidTrackValueError,
    );
  });

  test('getDeclaredActions returns stage declaration order and [] for final stages', () => {
    expect(getDeclaredActions(docReviewFlow, 'draft')).toEqual(['submit']);
    expect(getDeclaredActions(docReviewFlow, 'published')).toEqual([]);
  });

  test('unknown stages throw UnknownStageError', () => {
    expectError(() => getDeclaredActions(docReviewFlow, 'missing'), UnknownStageError);
  });

  test('invalid action/stage pairs throw InvalidTransitionError with source-stage diagnostics', () => {
    const error = expectError(
      () => transition(docReviewFlow, buildInitialState(docReviewFlow), { action: 'publish' }),
      InvalidTransitionError,
    );

    expect({
      stage: error.stage,
      action: error.action,
      sourceStages: error.sourceStages,
    }).toEqual({
      stage: 'draft',
      action: 'publish',
      sourceStages: ['review'],
    });

    expect(getActionSourceStages(docReviewFlow, 'publish')).toEqual(['review']);
  });

  test('transition runs the named policy before business guards', () => {
    const order: string[] = [];
    const reviewState = transition(
      docReviewFlow,
      buildInitialState(docReviewFlow),
      { action: 'submit' },
    ).state;

    transition(docReviewFlow, reviewState, { action: 'publish', comment: 'Looks good' }, {
      actor: { id: 'user-1', roles: ['reviewer'] },
      policies: {
        reviewerOnly: () => {
          order.push('policy');
          return true;
        },
      },
      guards: {
        commentRequired: () => {
          order.push('guard');
          return true;
        },
      },
    });

    expect(order).toEqual(['policy', 'guard']);
  });

  test('missing guard/policy refs fail fast with typed configuration errors', () => {
    const reviewState = transition(
      docReviewFlow,
      buildInitialState(docReviewFlow),
      { action: 'submit' },
    ).state;

    expectError(
      () =>
      transition(docReviewFlow, reviewState, { action: 'publish', comment: 'ok' }, {}),
      MissingPolicyError,
    );

    expectError(
      () =>
      transition(
        docReviewFlow,
        reviewState,
        { action: 'publish', comment: 'ok' },
        {
          policies: {
            reviewerOnly: () => true,
          },
        },
      ),
      MissingGuardError,
    );
  });

  test('rejected policy throws AuthorizationRejectionError', () => {
    const reviewState = transition(
      docReviewFlow,
      buildInitialState(docReviewFlow),
      { action: 'submit' },
    ).state;

    expectError(
      () =>
      transition(
        docReviewFlow,
        reviewState,
        { action: 'publish', comment: 'ok' },
        {
          policies: {
            reviewerOnly: () => false,
          },
        },
      ),
      AuthorizationRejectionError,
    );
  });

  test('rejected guard throws GuardRejectionError', () => {
    const reviewState = transition(
      docReviewFlow,
      buildInitialState(docReviewFlow),
      { action: 'submit' },
    ).state;

    expectError(
      () =>
      transition(
        docReviewFlow,
        reviewState,
        { action: 'publish', comment: 'ok' },
        {
          policies: {
            reviewerOnly: () => true,
          },
          guards: {
            commentRequired: () => false,
          },
        },
      ),
      GuardRejectionError,
    );
  });

  test('predicates receive full current state, command, subject, actor, and facts', () => {
    const reviewState = transition(
      docReviewFlow,
      buildInitialState(docReviewFlow),
      { action: 'submit' },
    ).state;
    const observed: Array<Record<string, unknown>> = [];

    transition(
      docReviewFlow,
      reviewState,
      { action: 'publish', comment: 'ready', payload: { version: 2 } },
      {
        actor: { id: 'user-1', roles: ['reviewer'], organizationId: 'org-1' },
        subject: { documentId: 'doc-1' },
        facts: { makerId: 'user-2' },
        policies: {
          reviewerOnly: (ctx) => {
            observed.push({
              stage: ctx.state.stage,
              action: ctx.command.action,
              actorId: ctx.actor?.id,
              documentId: ctx.subject.documentId,
              makerId: ctx.facts.makerId,
            });
            return true;
          },
        },
        guards: {
          commentRequired: (ctx) => {
            observed.push({
              comment: ctx.command.comment,
              payloadVersion: (ctx.command.payload as { version: number }).version,
            });
            return true;
          },
        },
      },
    );

    expect(observed).toEqual([
      {
        stage: 'review',
        action: 'publish',
        actorId: 'user-1',
        documentId: 'doc-1',
        makerId: 'user-2',
      },
      {
        comment: 'ready',
        payloadVersion: 2,
      },
    ]);
  });

  test('status and pending role default from the transition target shape', () => {
    const reviewState = transition(
      docReviewFlow,
      buildInitialState(docReviewFlow),
      { action: 'submit' },
    ).state;

    expect(reviewState).toEqual({
      stage: 'review',
      status: 'pending',
      pendingRole: 'reviewer',
      tracks: {
        visibility: 'private',
      },
    });
  });

  test('track updates are merged into the returned state and exposed as deltas in the record', () => {
    const reviewState = transition(
      docReviewFlow,
      buildInitialState(docReviewFlow),
      { action: 'submit' },
    ).state;
    const result = transition(
      docReviewFlow,
      reviewState,
      { action: 'publish', comment: 'ship it' },
      {
        policies: {
          reviewerOnly: () => true,
        },
        guards: {
          commentRequired: () => true,
        },
      },
    );

    expect(result.state.tracks).toEqual({ visibility: 'public' });
    expect(result.transition.trackUpdates).toEqual({ visibility: 'public' });
  });

  test('untouched tracks are preserved', () => {
    const reviewState = transition(
      docReviewFlow,
      buildInitialState(docReviewFlow),
      { action: 'submit' },
    ).state;

    expect(reviewState.tracks).toEqual({ visibility: 'private' });
  });

  test('the input state is not mutated', () => {
    const state = buildInitialState(docReviewFlow);
    const before = structuredClone(state);

    transition(docReviewFlow, state, { action: 'submit' });

    expect(state).toEqual(before);
  });

  test('no exported function accepts a detached transition record for later application', () => {
    expect('applyTransition' in flowkit).toBe(false);
  });
});
