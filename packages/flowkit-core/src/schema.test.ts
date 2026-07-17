import { describe, expect, test } from 'bun:test';

import { lintFlow } from './lint';
import { defineFlow, flowSchema } from './schema';
import type { ActionName, StageName } from './types';

const validDefinition = () => ({
  id: 'document-review',
  version: 1,
  roles: ['author', 'reviewer', 'supervisor'],
  tracks: {
    visibility: { initial: 'private', values: ['private', 'public'] },
  },
  initialStage: 'draft',
  initialStatus: 'pending',
  stages: {
    draft: {
      pendingRole: 'author',
      entry: [{ kind: 'system' as const, ref: 'prepareDraft' }],
      actions: {
        submit: {
          to: 'review',
          pendingRole: 'reviewer',
          tracks: { visibility: 'private' },
          guards: ['hasContent'],
          policy: 'authorOnly',
          notify: {
            template: 'reviewRequested',
            channels: ['email'],
            to: ['reviewer'],
          },
        },
      },
    },
    review: {
      pendingRole: 'reviewer',
      sla: {
        after: '72h',
        escalate: { notify: 'supervisor', action: 'publish' },
      },
      actions: {
        publish: { to: 'published', status: 'approved', tracks: { visibility: 'public' } },
      },
    },
    published: { final: true },
  },
});

const expectInvalid = (definition: unknown) => {
  expect(flowSchema.safeParse(definition).success).toBe(false);
};

describe('flowSchema', () => {
  test('accepts and returns a valid serializable definition', () => {
    const input = validDefinition();
    const parsed = flowSchema.parse(input);

    expect(parsed).toEqual(input);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(input);
  });

  test('defineFlow preserves literal stage and action names', () => {
    const definition = defineFlow({
      id: 'literal-flow',
      version: 1,
      roles: ['author'],
      initialStage: 'draft',
      stages: {
        draft: { actions: { submit: { to: 'published' } } },
        published: { final: true },
      },
    });

    type Stages = StageName<typeof definition>;
    type Actions = ActionName<typeof definition>;
    const stage: Stages = 'draft';
    const action: Actions = 'submit';
    // @ts-expect-error arbitrary stage names must not widen to string
    const invalidStage: Stages = 'missing';
    // @ts-expect-error arbitrary action names must not widen to string
    const invalidAction: Actions = 'missing';

    expect([stage, action, invalidStage, invalidAction]).toEqual([
      'draft',
      'submit',
      'missing',
      'missing',
    ]);
  });

  test.each([
    ['root', (d: any) => ({ ...d, unexpected: true })],
    ['stage', (d: any) => ({ ...d, stages: { ...d.stages, draft: { ...d.stages.draft, unexpected: true } } })],
    ['action', (d: any) => ({ ...d, stages: { ...d.stages, draft: { ...d.stages.draft, actions: { submit: { ...d.stages.draft.actions.submit, unexpected: true } } } } })],
    ['step', (d: any) => ({ ...d, stages: { ...d.stages, draft: { ...d.stages.draft, entry: [{ ...d.stages.draft.entry[0], unexpected: true }] } } })],
    ['notification', (d: any) => ({ ...d, stages: { ...d.stages, draft: { ...d.stages.draft, actions: { submit: { ...d.stages.draft.actions.submit, notify: { ...d.stages.draft.actions.submit.notify, unexpected: true } } } } } })],
    ['SLA', (d: any) => ({ ...d, stages: { ...d.stages, review: { ...d.stages.review, sla: { ...d.stages.review.sla, unexpected: true } } } })],
    ['SLA escalation', (d: any) => ({ ...d, stages: { ...d.stages, review: { ...d.stages.review, sla: { ...d.stages.review.sla, escalate: { ...d.stages.review.sla.escalate, unexpected: true } } } } })],
    ['track', (d: any) => ({ ...d, tracks: { visibility: { ...d.tracks.visibility, unexpected: true } } })],
  ])('rejects unknown keys at the %s level', (_level: string, mutate: (definition: any) => unknown) => {
    expectInvalid(mutate(validDefinition()));
  });

  test.each([
    ['initial stage', (d: any) => ({ ...d, initialStage: 'missing' })],
    ['action target', (d: any) => ({ ...d, stages: { ...d.stages, draft: { ...d.stages.draft, actions: { submit: { ...d.stages.draft.actions.submit, to: 'missing' } } } } })],
  ])('rejects an unknown %s', (_kind: string, mutate: (definition: any) => unknown) => {
    expectInvalid(mutate(validDefinition()));
  });

  test('rejects duplicate roles', () => {
    expectInvalid({ ...validDefinition(), roles: ['author', 'reviewer', 'author'] });
  });

  test('rejects duplicate track values', () => {
    const d = validDefinition();
    expectInvalid({ ...d, tracks: { visibility: { initial: 'private', values: ['private', 'private'] } } });
  });

  test('rejects a track initial value outside its values', () => {
    const d = validDefinition();
    expectInvalid({ ...d, tracks: { visibility: { initial: 'secret', values: ['private', 'public'] } } });
  });

  test.each([
    ['stage role', (d: any) => ({ ...d, stages: { ...d.stages, draft: { ...d.stages.draft, pendingRole: 'unknown' } } })],
    ['action role', (d: any) => ({ ...d, stages: { ...d.stages, draft: { ...d.stages.draft, actions: { submit: { ...d.stages.draft.actions.submit, pendingRole: 'unknown' } } } } })],
    ['notification role', (d: any) => ({ ...d, stages: { ...d.stages, draft: { ...d.stages.draft, actions: { submit: { ...d.stages.draft.actions.submit, notify: { ...d.stages.draft.actions.submit.notify, to: ['unknown'] } } } } } })],
    ['SLA role', (d: any) => ({ ...d, stages: { ...d.stages, review: { ...d.stages.review, sla: { ...d.stages.review.sla, escalate: { notify: 'unknown' } } } } })],
    ['track update', (d: any) => ({ ...d, stages: { ...d.stages, draft: { ...d.stages.draft, actions: { submit: { ...d.stages.draft.actions.submit, tracks: { missing: 'value' } } } } } })],
    ['track value update', (d: any) => ({ ...d, stages: { ...d.stages, draft: { ...d.stages.draft, actions: { submit: { ...d.stages.draft.actions.submit, tracks: { visibility: 'missing' } } } } } })],
  ])('rejects an undeclared %s', (_kind: string, mutate: (definition: any) => unknown) => {
    expectInvalid(mutate(validDefinition()));
  });

  test('rejects an empty stage map', () => {
    expectInvalid({ ...validDefinition(), stages: {} });
  });

  test('rejects a final stage with actions', () => {
    const d = validDefinition();
    expectInvalid({ ...d, stages: { ...d.stages, published: { final: true, actions: {} } } });
  });

  test('allows a non-final stage without actions in the schema but reports it in lintFlow', () => {
    const d = validDefinition();
    const definition = { ...d, stages: { ...d.stages, draft: { pendingRole: 'author' } } };

    expect(flowSchema.safeParse(definition).success).toBe(true);
    expect(lintFlow(flowSchema.parse(definition))).toContainEqual(
      expect.objectContaining({ code: 'dead-end-stage', severity: 'error' }),
    );
  });

  test('rejects an empty SLA escalation', () => {
    const d = validDefinition();
    expectInvalid({ ...d, stages: { ...d.stages, review: { ...d.stages.review, sla: { after: '72h', escalate: {} } } } });
  });

  test('rejects an SLA auto-action not declared on the same stage', () => {
    const d = validDefinition();
    expectInvalid({ ...d, stages: { ...d.stages, review: { ...d.stages.review, sla: { after: '72h', escalate: { action: 'submit' } } } } });
  });
});
