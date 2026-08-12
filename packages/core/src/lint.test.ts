import { describe, expect, test } from 'bun:test';

import { defineFlow } from './schema';
import { lintFlow, lintInterpreterFlow, validateRegistryRefs } from './lint';
import type { FlowDefinition } from './types';

describe('lintFlow', () => {
  test('reports structural lint issues and warnings', () => {
    const definition = defineFlow({
      id: 'lint-demo',
      version: 1,
      roles: ['author', 'reviewer', 'observer'],
      tracks: {
        visibility: { initial: 'private', values: ['private', 'public'] },
        audit: { initial: 'idle', values: ['idle', 'logged'] },
      },
      initialStage: 'draft',
      stages: {
        draft: {
          pendingRole: 'author',
          actions: {
            submit: { to: 'review', tracks: { visibility: 'public' } },
          },
        },
        review: {
          pendingRole: 'reviewer',
          actions: {
            submit: { to: 'published' },
          },
        },
        stalled: {
          pendingRole: 'reviewer',
        },
        published: {
          final: true,
        },
      },
    });

    expect(lintFlow(definition)).toEqual([
      expect.objectContaining({ code: 'unreachable-stage', severity: 'error', path: 'stages.stalled' }),
      expect.objectContaining({ code: 'dead-end-stage', severity: 'error', path: 'stages.stalled.actions' }),
      expect.objectContaining({ code: 'unused-role', severity: 'warning' }),
      expect.objectContaining({ code: 'unused-track', severity: 'warning', path: 'tracks.audit' }),
      expect.objectContaining({ code: 'duplicate-action-source', severity: 'warning' }),
    ]);
  });

  test('flags final-stage actions in defense-in-depth mode', () => {
    const invalidDefinition = {
      id: 'lint-invalid',
      version: 1,
      roles: ['author'],
      initialStage: 'draft',
      stages: {
        draft: { actions: { submit: { to: 'published' } } },
        published: { final: true, actions: { reopen: { to: 'draft' } } },
      },
    } as unknown as FlowDefinition;

    expect(lintFlow(invalidDefinition)).toContainEqual(
      expect.objectContaining({
        code: 'final-stage-has-actions',
        severity: 'error',
        path: 'stages.published.actions',
      }),
    );
  });
});

describe('lintInterpreterFlow', () => {
  const interpreterInput = () => ({
    id: 'interpreter-demo',
    version: 1,
    roles: ['author', 'reviewer'],
    initialStage: 'draft',
    stages: {
      draft: {
        pendingRole: 'author',
        actions: {
          submit: { to: 'review', policy: 'authorOnly' },
          autofix: { to: 'draft', kind: 'system' as const },
        },
      },
      review: {
        pendingRole: 'reviewer',
        actions: {
          publish: { to: 'published' },
        },
      },
      published: { final: true },
    },
  });

  const interpreterDefinition = () => defineFlow(interpreterInput());

  test('errors on human actions without a policy', () => {
    expect(lintInterpreterFlow(interpreterDefinition())).toContainEqual(
      expect.objectContaining({
        code: 'missing-action-policy',
        severity: 'error',
        path: 'stages.review.actions.publish.policy',
      }),
    );
  });

  test('accepts human actions with policies and system actions without one', () => {
    const input = interpreterInput();
    const withPolicy = {
      ...input,
      stages: {
        ...input.stages,
        review: {
          ...input.stages.review,
          actions: {
            publish: { to: 'published', policy: 'reviewerOnly' },
          },
        },
      },
    };

    expect(
      lintInterpreterFlow(defineFlow(withPolicy)).filter(
        (issue) => issue.code === 'missing-action-policy',
      ),
    ).toEqual([]);
  });

  test('includes the base lintFlow issues', () => {
    const definition = interpreterDefinition();
    const interpreterCodes = lintInterpreterFlow(definition).map((issue) => issue.code);
    const missingBaseIssues = lintFlow(definition).filter(
      (issue) => !interpreterCodes.includes(issue.code),
    );

    expect(missingBaseIssues).toEqual([]);
  });

  test('the default lintFlow stays policy-neutral', () => {
    expect(
      lintFlow(interpreterDefinition()).filter((issue) => issue.code === 'missing-action-policy'),
    ).toEqual([]);
  });
});

describe('validateRegistryRefs', () => {
  test('reports missing named refs without executing them', () => {
    const definition = defineFlow({
      id: 'registry-demo',
      version: 1,
      roles: ['author', 'reviewer'],
      initialStage: 'draft',
      stages: {
        draft: {
          entry: [{ kind: 'system', ref: 'prepareDraft' }],
          actions: {
            submit: {
              to: 'review',
              guards: ['hasContent'],
              policy: 'authorOnly',
              notify: {
                template: 'reviewRequested',
                channels: ['email', 'slack'],
              },
            },
          },
        },
        review: { final: true },
      },
    });

    expect(
      validateRegistryRefs(definition, {
        guards: {},
        policies: {},
        steps: {},
        templates: {},
        channels: { email: {} },
      }),
    ).toEqual([
      expect.objectContaining({ code: 'missing-step-ref', severity: 'error' }),
      expect.objectContaining({ code: 'missing-guard-ref', severity: 'error' }),
      expect.objectContaining({ code: 'missing-policy-ref', severity: 'error' }),
      expect.objectContaining({ code: 'missing-template-ref', severity: 'error' }),
      expect.objectContaining({ code: 'missing-channel-ref', severity: 'error' }),
    ]);
  });
});
