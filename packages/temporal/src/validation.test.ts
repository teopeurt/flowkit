import { describe, expect, test } from 'bun:test';

import type { FlowDefinition } from '@teopeurt/flowkit-core';

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

  describe('refs named like Object.prototype members are still missing refs', () => {
    // A registry is a plain object, so `registry['toString']` resolves to an inherited
    // function. Each lookup must count only own entries; otherwise a definition that names an
    // unregistered ref `constructor` / `toString` passes boot validation (or crashes it).
    const protoNames = ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'];

    // `definition()` declares every ref once; point one ref at a prototype name and give the
    // registries NO entry of that name. Each case replaces the original ref with the name.
    const cases: Array<{
      what: string;
      code: string;
      mutate: (input: FlowDefinition, name: string) => void;
      registryKey: string;
    }> = [
      {
        what: 'policy',
        code: 'missing-policy-ref',
        registryKey: 'policies',
        mutate: (input, name) => {
          input.stages.draft.actions!.submit.policy = name;
        },
      },
      {
        what: 'guard',
        code: 'missing-guard-ref',
        registryKey: 'guards',
        mutate: (input, name) => {
          input.stages.draft.actions!.submit.guards = [name];
        },
      },
      {
        what: 'system step',
        code: 'missing-system-step-ref',
        registryKey: 'systemSteps',
        mutate: (input, name) => {
          input.stages.draft.entry![0] = { kind: 'system', ref: name };
        },
      },
      {
        what: 'AI step',
        code: 'missing-ai-step-ref',
        registryKey: 'aiSteps',
        mutate: (input, name) => {
          input.stages.draft.entry![1] = { kind: 'ai', ref: name, gate: 'human' };
        },
      },
      {
        what: 'rule',
        code: 'missing-rule-ref',
        registryKey: 'rules',
        mutate: (input, name) => {
          input.stages.review.entry = [{ kind: 'rule', ref: name }];
        },
      },
      {
        what: 'notification template',
        code: 'missing-template-ref',
        registryKey: 'templates',
        mutate: (input, name) => {
          input.stages.draft.actions!.submit.notify = { template: name, channels: ['email'] };
        },
      },
      {
        what: 'notification channel',
        code: 'missing-channel-ref',
        registryKey: 'channels',
        mutate: (input, name) => {
          input.stages.draft.actions!.submit.notify = { template: 'submitted', channels: [name] };
        },
      },
    ];

    for (const { what, code, mutate, registryKey } of cases) {
      test.each(protoNames.map((name) => [name]))(`reports a missing ${what} ref named %s`, (name: string) => {
        const input = definition();
        mutate(input, name);
        const available = registries() as Record<string, Record<string, unknown>>;
        // The registry holds its usual entries but nothing called `name`.
        expect(Object.hasOwn(available[registryKey], name)).toBe(false);

        const issues = validateFlowkit({
          published: publishRaw(input),
          registries: available as ReturnType<typeof registries>,
        });

        expect(codes(issues)).toContainEqual(code);
      });
    }
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

describe('auto-gated AI step validation', () => {
  const autoGated = (): FlowDefinition => {
    const d = definition();
    d.stages.draft.entry = [{ kind: 'ai', ref: 'summarize', gate: 'auto', decide: 'lowRisk' }];
    d.stages.draft.actions = { ...d.stages.draft.actions, proceed: { to: 'review', kind: 'system' } };
    return d;
  };
  const withRule = (actions: string[]) => ({
    ...registries(),
    rules: { ...registries().rules, lowRisk: { run: () => undefined, actions } },
  });
  const validate = (reg: ReturnType<typeof withRule> | ReturnType<typeof registries>) =>
    validateFlowkit({ published: publishDefinition({ definition: autoGated() }), registries: reg });

  test('accepts an auto gate whose deciding rule only targets available system actions', () => {
    expect(validate(withRule(['proceed']))).toEqual([]);
  });

  test('reports a deciding rule that is not registered', () => {
    expect(validate(registries())).toContainEqual(
      expect.objectContaining({ code: 'missing-rule-ref', path: 'stages.draft.entry.0.decide' }),
    );
  });

  test('rejects a deciding rule that may return a human action', () => {
    expect(codes(validate(withRule(['submit'])))).toContainEqual('rule-action-not-system');
  });

  test('rejects a deciding rule that may return an action the stage does not have', () => {
    expect(codes(validate(withRule(['nope'])))).toContainEqual('rule-action-unavailable');
  });
});

describe('orchestrate step validation', () => {
  const orchestrated = (gate: 'human' | 'auto' = 'human'): FlowDefinition => {
    const d = definition();
    d.stages.draft.entry = [
      gate === 'auto'
        ? { kind: 'orchestrate', ref: 'build', gate: 'auto', decide: 'allClean' }
        : { kind: 'orchestrate', ref: 'build', gate: 'human' },
    ];
    d.stages.draft.actions = { ...d.stages.draft.actions, proceed: { to: 'review', kind: 'system' } };
    return d;
  };
  const withOrchestrator = (registration: unknown, rule = true) => ({
    ...registries(),
    rules: { ...registries().rules, ...(rule ? { allClean: { run: () => undefined, actions: ['proceed'] } } : {}) },
    orchestrators: { build: registration },
  });
  const validate = (definitionToCheck: FlowDefinition, reg: unknown) =>
    validateFlowkit({ published: publishDefinition({ definition: definitionToCheck }), registries: reg as never });
  const good = { agents: ['coder', 'tester'], maxTasks: 8, maxConcurrency: 2 };

  test('accepts a registered orchestrator whose limits are valid, including an auto gate rule', () => {
    expect(validate(orchestrated('human'), withOrchestrator(good))).toEqual([]);
    expect(validate(orchestrated('auto'), withOrchestrator(good))).toEqual([]);
  });

  test('reports an orchestrator that is not registered', () => {
    expect(codes(validate(orchestrated(), registries()))).toContainEqual('missing-orchestrator-ref');
  });

  test('reports an orchestrator with no agents', () => {
    expect(codes(validate(orchestrated(), withOrchestrator({ agents: [] })))).toContainEqual('orchestrator-agents-empty');
  });

  test.each([
    ['zero maxTasks', { agents: ['a'], maxTasks: 0 }],
    ['maxTasks above the hard limit', { agents: ['a'], maxTasks: 65 }],
    ['fractional maxConcurrency', { agents: ['a'], maxConcurrency: 1.5 }],
    ['maxConcurrency above the hard limit', { agents: ['a'], maxConcurrency: 65 }],
    ['zero maxOutputBytes', { agents: ['a'], maxOutputBytes: 0 }],
  ])('reports %s', (_name: string, registration: unknown) => {
    expect(codes(validate(orchestrated(), withOrchestrator(registration)))).toContainEqual('orchestrator-limit-invalid');
  });

  test('applies the deciding-rule checks to an auto-gated orchestrate step', () => {
    expect(validate(orchestrated('auto'), withOrchestrator(good, false))).toContainEqual(
      expect.objectContaining({ code: 'missing-rule-ref', path: 'stages.draft.entry.0.decide' }),
    );
  });
});
