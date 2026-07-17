import { describe, expect, test } from 'bun:test';

import { defineFlow } from './schema';
import { lintFlow, validateRegistryRefs } from './lint';
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
