import { describe, expect, test } from 'bun:test';

import type { FlowDefinition } from '@naakwu/flowkit-core';

import type { PublishedFlowDefinition } from './contracts';
import { canonicalizeJson, hashCanonicalJson, publishDefinition } from './snapshot';
import {
  assertValidFlowkit,
  parseSlaDuration,
  validateFlowkit,
} from './validation';

const definition = (): FlowDefinition => ({
  id: 'leave-approval',
  version: 1,
  roles: ['employee', 'manager'],
  initialStage: 'draft',
  stages: {
    draft: {
      pendingRole: 'employee',
      entry: [
        { kind: 'system', ref: 'prepare' },
        { kind: 'ai', ref: 'summarize', gate: 'human' },
      ],
      actions: {
        submit: {
          to: 'review',
          policy: 'employeeOnly',
          guards: ['hasComment'],
          notify: { template: 'submitted', channels: ['email'] },
        },
      },
    },
    review: {
      pendingRole: 'manager',
      entry: [{ kind: 'rule', ref: 'autoEscalate' }],
      sla: { after: '24h', escalate: { notify: 'manager' } },
      actions: {
        approve: { to: 'approved', policy: 'managerOnly' },
        escalate: { to: 'review', kind: 'system' },
      },
    },
    approved: { final: true },
  },
});

const registries = () => ({
  policies: {
    employeeOnly: () => true,
    managerOnly: () => true,
  },
  guards: {
    hasComment: () => true,
  },
  rules: {
    autoEscalate: {
      run: () => undefined,
      actions: ['escalate'],
    },
  },
  systemSteps: { prepare: {} },
  aiSteps: { summarize: {} },
  templates: { submitted: {} },
  channels: { email: {} },
});

const publishRaw = (definitionSnapshot: unknown): PublishedFlowDefinition => ({
  definitionSnapshot: definitionSnapshot as FlowDefinition,
  definitionHash: hashCanonicalJson(canonicalizeJson(definitionSnapshot)),
});

const codes = (issues: ReturnType<typeof validateFlowkit>) => issues.map((issue) => issue.code);

describe('parseSlaDuration', () => {
  test.each([
    ['250ms', 250],
    ['1s', 1_000],
    ['2m', 120_000],
    ['24h', 86_400_000],
    ['1h30m', 5_400_000],
  ])('parses %s', (input: string, expected: number) => {
    expect(parseSlaDuration(input)).toBe(expected);
  });

  test.each([['0s'], ['-1m'], ['soon'], ['1w'], ['1 h']])('rejects invalid duration %s', (input: string) => {
    expect(parseSlaDuration(input)).toBe(undefined);
  });
});

describe('validateFlowkit', () => {
  test('accepts a fully wired published definition', () => {
    expect(
      validateFlowkit({
        published: publishDefinition({ definition: definition() }),
        registries: registries(),
      }),
    ).toEqual([]);
  });

  test('fails fast through assertValidFlowkit', () => {
    const invalid = publishRaw({ ...definition(), version: -1 });

    expect(() => assertValidFlowkit({ published: invalid, registries: registries() })).toThrow();
  });

  test('reports a malformed or mismatched definition hash', () => {
    const published = publishDefinition({ definition: definition() });
    const issues = validateFlowkit({
      published: { ...published, definitionHash: `sha256:${'0'.repeat(64)}` },
      registries: registries(),
    });

    expect(codes(issues)).toContainEqual('invalid-definition-hash');
  });

  test('reports schema errors independently of hash verification', () => {
    const issues = validateFlowkit({
      published: publishRaw({ ...definition(), version: -1 }),
      registries: registries(),
    });

    expect(codes(issues)).toContainEqual('schema-error');
  });

  test('promotes missing human authorization policy to a boot error', () => {
    const input = definition();
    input.stages.review.actions!.approve = { to: 'approved' };
    const issues = validateFlowkit({
      published: publishRaw(input),
      registries: registries(),
    });

    expect(codes(issues)).toContainEqual('missing-action-policy');
  });

  test('reports missing action refs', () => {
    const available = registries();
    const missing = {
      ...available,
      policies: { managerOnly: available.policies.managerOnly },
      guards: {},
      templates: {},
      channels: {},
    };
    const issues = validateFlowkit({
      published: publishDefinition({ definition: definition() }),
      registries: missing,
    });

    expect(codes(issues)).toContainEqual('missing-policy-ref');
    expect(codes(issues)).toContainEqual('missing-guard-ref');
    expect(codes(issues)).toContainEqual('missing-template-ref');
    expect(codes(issues)).toContainEqual('missing-channel-ref');
  });

  test('reports missing step and rule refs', () => {
    const available = registries();
    const missing = {
      ...available,
      systemSteps: {},
      aiSteps: {},
      rules: {},
    };
    const issues = validateFlowkit({
      published: publishDefinition({ definition: definition() }),
      registries: missing,
    });

    expect(codes(issues)).toContainEqual('missing-system-step-ref');
    expect(codes(issues)).toContainEqual('missing-ai-step-ref');
    expect(codes(issues)).toContainEqual('missing-rule-ref');
  });

  test('rejects rule metadata for unavailable or human actions', () => {
    const unavailable = registries();
    unavailable.rules.autoEscalate.actions = ['missing'];
    const unavailableIssues = validateFlowkit({
      published: publishDefinition({ definition: definition() }),
      registries: unavailable,
    });

    expect(codes(unavailableIssues)).toContainEqual('rule-action-unavailable');

    const human = registries();
    human.rules.autoEscalate.actions = ['approve'];
    const humanIssues = validateFlowkit({
      published: publishDefinition({ definition: definition() }),
      registries: human,
    });

    expect(codes(humanIssues)).toContainEqual('rule-action-not-system');
  });

  test.each([
    ['soon', 'invalid-sla-duration'],
    ['0s', 'invalid-sla-duration'],
    ['-1m', 'invalid-sla-duration'],
  ])('rejects SLA duration %s', (after: string, expected: string) => {
    const input = definition();
    input.stages.review.sla!.after = after;
    const issues = validateFlowkit({
      published: publishRaw(input),
      registries: registries(),
    });

    expect(codes(issues)).toContainEqual(expected);
  });

  test('rejects final stages that schedule work', () => {
    const input = definition();
    input.stages.approved = {
      final: true,
      entry: [{ kind: 'system', ref: 'prepare' }],
    };
    const issues = validateFlowkit({
      published: publishRaw(input),
      registries: registries(),
    });

    expect(codes(issues)).toContainEqual('final-stage-schedules-work');
  });
});
