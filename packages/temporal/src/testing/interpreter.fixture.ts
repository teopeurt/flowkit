import type { FlowDefinition } from '@teopeurt/flowkit-core';

import type { FlowkitWorkflowInput } from '../contracts';
import { publishDefinition } from '../snapshot';
import { createFlowkitWorkflow } from '../workflow';

export const testDefinition: FlowDefinition = {
  id: 'leave-approval',
  version: 1,
  roles: ['employee', 'manager'],
  initialStage: 'draft',
  stages: {
    draft: {
      pendingRole: 'employee',
      actions: { submit: { to: 'review', policy: 'employeeOnly', guards: ['commentAllowed'], notify: [{ template: 'submitted', channels: ['inbox'] }] } },
    },
    review: {
      pendingRole: 'manager',
      entryNotify: [{ template: 'reviewReady', channels: ['inbox'] }],
      actions: { approve: { to: 'approved', policy: 'managerOnly' } },
    },
    approved: { final: true },
  },
};

const testInterpreter = createFlowkitWorkflow({
  activityTaskQueue: 'flowkit-temporal-workflow-test',
  registries: {
    policies: {
      employeeOnly: (context) => context.actor?.roles.includes('employee') ?? false,
      managerOnly: (context) => context.actor?.roles.includes('manager') ?? false,
    },
    guards: {
      commentAllowed: (context) => context.facts.commentAllowed === true,
    },
  },
});

const adaptedInterpreter = createFlowkitWorkflow({
  activityTaskQueue: 'flowkit-temporal-workflow-test',
  registries: {},
  adaptState: ({ state }) => ({ legacyStage: state.state.stage }),
});

export async function testFlowkitWorkflow(input: FlowkitWorkflowInput) {
  return await testInterpreter(input);
}

export async function adaptedFlowkitWorkflow(input: FlowkitWorkflowInput) {
  return await adaptedInterpreter(input);
}

export const testFlowkitInput = (): FlowkitWorkflowInput => ({
  published: publishDefinition({ definition: testDefinition }),
  subject: { id: 'leave-1', organizationId: 'org-1' },
});

const signalDefinition: FlowDefinition = {
  id: 'signal-flow', version: 1, roles: ['scheduler'], initialStage: 'waiting',
  stages: {
    waiting: {
      actions: {
        refresh: { to: 'waiting', kind: 'signal', policy: 'trustedScheduler' },
      },
    },
  },
};
const signalInterpreter = createFlowkitWorkflow({
  activityTaskQueue: 'flowkit-temporal-workflow-test',
  registries: {
    policies: {
      trustedScheduler: (context) => context.actor?.id === 'service-scheduler',
    },
  },
});
export async function signalFlowkitWorkflow(input: FlowkitWorkflowInput) { return await signalInterpreter(input); }
export const signalFlowkitInput = (): FlowkitWorkflowInput => ({ published: publishDefinition({ definition: signalDefinition }), subject: { id: 'signal-1', organizationId: 'org-1' } });

const entryDefinition: FlowDefinition = {
  id: 'entry-flow', version: 1, roles: ['employee'], initialStage: 'draft',
  stages: {
    draft: {
      pendingRole: 'employee',
      entry: [
        { kind: 'system', ref: 'prepare' },
        { kind: 'system', ref: 'notify' },
        { kind: 'ai', ref: 'summarize', gate: 'human' },
        { kind: 'rule', ref: 'auto' },
      ],
      actions: {
        self: { to: 'draft', policy: 'employeeOnly', guards: ['commentAllowed'] },
        auto: { to: 'approved', kind: 'system', guards: ['autoAllowed'] },
      },
    },
    approved: { final: true },
  },
};

const entryRegistries = (autoAllowed: boolean, action?: string) => ({
  policies: { employeeOnly: (context: { actor?: { roles: string[] } }) => context.actor?.roles.includes('employee') ?? false },
  guards: {
    commentAllowed: (context: { facts: Record<string, unknown> }) => context.facts.commentAllowed === true,
    autoAllowed: () => autoAllowed,
  },
  rules: { auto: { actions: ['auto'], run: () => action } },
});

const entryInterpreter = createFlowkitWorkflow({ activityTaskQueue: 'flowkit-temporal-workflow-test', registries: entryRegistries(true) });
const ruleInterpreter = createFlowkitWorkflow({ activityTaskQueue: 'flowkit-temporal-workflow-test', registries: entryRegistries(true, 'auto') });
const blockedRuleInterpreter = createFlowkitWorkflow({ activityTaskQueue: 'flowkit-temporal-workflow-test', registries: entryRegistries(false, 'auto') });

export async function entryFlowkitWorkflow(input: FlowkitWorkflowInput) { return await entryInterpreter(input); }
export async function ruleFlowkitWorkflow(input: FlowkitWorkflowInput) { return await ruleInterpreter(input); }
export async function blockedRuleFlowkitWorkflow(input: FlowkitWorkflowInput) { return await blockedRuleInterpreter(input); }
export const entryFlowkitInput = (): FlowkitWorkflowInput => ({ published: publishDefinition({ definition: entryDefinition }), subject: { id: 'entry-1', organizationId: 'org-1' } });

const updateRuleDefinition: FlowDefinition = {
  id: 'update-rule-flow', version: 1, roles: ['employee'], initialStage: 'waiting',
  stages: {
    waiting: { actions: { submit: { to: 'checking', policy: 'employeeOnly' } } },
    checking: { entry: [{ kind: 'rule', ref: 'auto' }], actions: { auto: { to: 'approved', kind: 'system' } } },
    approved: { final: true },
  },
};
const updateRuleInterpreter = createFlowkitWorkflow({
  activityTaskQueue: 'flowkit-temporal-workflow-test',
  registries: { ...entryRegistries(true, 'auto'), rules: { auto: { actions: ['auto'], run: () => 'auto' } } },
});
export async function updateRuleFlowkitWorkflow(input: FlowkitWorkflowInput) { return await updateRuleInterpreter(input); }
export const updateRuleFlowkitInput = (): FlowkitWorkflowInput => ({ published: publishDefinition({ definition: updateRuleDefinition }), subject: { id: 'update-rule-1', organizationId: 'org-1' } });

const factDefinition: FlowDefinition = {
  id: 'fact-flow', version: 1, roles: [], initialStage: 'checking',
  stages: {
    checking: {
      entry: [{ kind: 'system', ref: 'inspect' }, { kind: 'rule', ref: 'route' }],
      actions: { approve: { to: 'approved', kind: 'system' } },
    },
    approved: { final: true },
  },
};
const factInterpreter = createFlowkitWorkflow({
  activityTaskQueue: 'flowkit-temporal-workflow-test',
  registries: { rules: { route: { actions: ['approve'], run: ({ facts }) => facts.verdict === 'pass' ? 'approve' : undefined } } },
});
export async function factFlowkitWorkflow(input: FlowkitWorkflowInput) { return await factInterpreter(input); }
export const factFlowkitInput = (): FlowkitWorkflowInput => ({ published: publishDefinition({ definition: factDefinition }), subject: { id: 'fact-1', organizationId: 'org-1' } });

// A rule step whose ref is named like an Object.prototype member and is NOT registered. The
// interpreter must treat it as an unregistered rule (no automatic action), not call an inherited
// function and fail the workflow task.
const protoRuleDefinition: FlowDefinition = {
  id: 'proto-rule-flow', version: 1, roles: [], initialStage: 'checking',
  stages: {
    checking: {
      steady: true,
      entry: [{ kind: 'rule', ref: 'constructor' }],
      actions: { approve: { to: 'approved', kind: 'system' } },
    },
    approved: { final: true },
  },
};
const protoRuleInterpreter = createFlowkitWorkflow({
  activityTaskQueue: 'flowkit-temporal-workflow-test',
  registries: { rules: {} },
});
export async function protoRuleFlowkitWorkflow(input: FlowkitWorkflowInput) { return await protoRuleInterpreter(input); }
export const protoRuleFlowkitInput = (): FlowkitWorkflowInput => ({ published: publishDefinition({ definition: protoRuleDefinition }), subject: { id: 'proto-rule-1', organizationId: 'org-1' } });

const loopDefinition: FlowDefinition = {
  id: 'loop-flow', version: 1, roles: [], initialStage: 'loop',
  stages: { loop: { entry: [{ kind: 'rule', ref: 'loop' }], actions: { loop: { to: 'loop', kind: 'system' } } } },
};
const loopInterpreter = createFlowkitWorkflow({
  activityTaskQueue: 'flowkit-temporal-workflow-test',
  registries: { rules: { loop: { actions: ['loop'], run: () => 'loop' } } },
});
export async function loopFlowkitWorkflow(input: FlowkitWorkflowInput) { return await loopInterpreter(input); }
export const loopFlowkitInput = (): FlowkitWorkflowInput => ({ published: publishDefinition({ definition: loopDefinition }), subject: { id: 'loop-1', organizationId: 'org-1' } });

const slaDefinition = (escalate: { notify?: string; action?: string }): FlowDefinition => ({
  id: 'sla-flow', version: 1, roles: ['employee', 'reminder'], initialStage: 'waiting',
  stages: {
    waiting: { pendingRole: 'employee', sla: { after: '1s', escalate }, actions: {
      advance: { to: 'review', policy: 'employeeOnly' },
      self: { to: 'waiting', policy: 'employeeOnly' },
      expire: { to: 'expired', kind: 'system' },
    } },
    review: { sla: { after: '1s', escalate }, actions: { self: { to: 'review', policy: 'employeeOnly' }, expire: { to: 'expired', kind: 'system' } } },
    expired: { final: true },
  },
});
const slaRegistries = { policies: { employeeOnly: (context: { actor?: { roles: string[] } }) => context.actor?.roles.includes('employee') ?? false } };
const notifySlaInterpreter = createFlowkitWorkflow({ activityTaskQueue: 'flowkit-temporal-workflow-test', registries: slaRegistries });
export async function notifySlaWorkflow(input: FlowkitWorkflowInput) { return await notifySlaInterpreter(input); }
export const notifySlaInput = (): FlowkitWorkflowInput => ({ published: publishDefinition({ definition: slaDefinition({ notify: 'reminder' }) }), subject: { id: 'sla-notify', organizationId: 'org-1' } });
const actionSlaInterpreter = createFlowkitWorkflow({ activityTaskQueue: 'flowkit-temporal-workflow-test', registries: slaRegistries });
export async function actionSlaWorkflow(input: FlowkitWorkflowInput) { return await actionSlaInterpreter(input); }
export const actionSlaInput = (): FlowkitWorkflowInput => ({ published: publishDefinition({ definition: slaDefinition({ action: 'expire' }) }), subject: { id: 'sla-action', organizationId: 'org-1' } });
const continuationInterpreter = createFlowkitWorkflow({ activityTaskQueue: 'flowkit-temporal-workflow-test', registries: slaRegistries, shouldContinueAsNew: () => true });
export async function continuationWorkflow(input: FlowkitWorkflowInput) { return await continuationInterpreter(input); }
export const continuationInput = (): FlowkitWorkflowInput => ({ published: publishDefinition({ definition: slaDefinition({ notify: 'reminder' }) }), subject: { id: 'continuation', organizationId: 'org-1' } });

const autoGateDefinition: FlowDefinition = {
  id: 'auto-gate-flow', version: 1, roles: ['reviewer'], initialStage: 'plan',
  stages: {
    plan: {
      pendingRole: 'reviewer',
      steady: true,
      entry: [{ kind: 'ai', ref: 'assess', gate: 'auto', decide: 'lowRisk' }],
      actions: {
        proceed: { to: 'done', kind: 'system' },
        approve: { to: 'done', policy: 'reviewerOnly' },
      },
    },
    done: { final: true },
  },
};
const autoGateRegistries = (decide: (gatedOutput: unknown) => string | undefined) => ({
  policies: { reviewerOnly: (context: { actor?: { roles: string[] } }) => context.actor?.roles.includes('reviewer') ?? false },
  rules: { lowRisk: { actions: ['proceed'], run: (context: { gatedOutput?: unknown }) => decide(context.gatedOutput) } },
});
const autoGateReleaseInterpreter = createFlowkitWorkflow({ activityTaskQueue: 'flowkit-temporal-workflow-test', registries: autoGateRegistries((output) => (output === 'ai:assess' ? 'proceed' : undefined)) });
const autoGateDeclineInterpreter = createFlowkitWorkflow({ activityTaskQueue: 'flowkit-temporal-workflow-test', registries: autoGateRegistries(() => undefined) });
const autoGateThrowInterpreter = createFlowkitWorkflow({ activityTaskQueue: 'flowkit-temporal-workflow-test', registries: autoGateRegistries(() => { throw new Error('rule exploded'); }) });
export async function autoGateReleaseWorkflow(input: FlowkitWorkflowInput) { return await autoGateReleaseInterpreter(input); }
export async function autoGateDeclineWorkflow(input: FlowkitWorkflowInput) { return await autoGateDeclineInterpreter(input); }
export async function autoGateThrowWorkflow(input: FlowkitWorkflowInput) { return await autoGateThrowInterpreter(input); }
export const autoGateInput = (): FlowkitWorkflowInput => ({ published: publishDefinition({ definition: autoGateDefinition }), subject: { id: 'auto-gate-1', organizationId: 'org-1' } });

/* ------------------------------------------------------------------------ */
/* Orchestrate step fixtures                                                  */
/* ------------------------------------------------------------------------ */

const orchestrateDefinition = (ref: string, options: { sla?: boolean; gate?: 'auto' | 'human' } = {}): FlowDefinition => ({
  id: `orchestrate-${ref}`, version: 1, roles: ['manager'], initialStage: 'work',
  stages: {
    work: {
      pendingRole: 'manager',
      steady: true,
      ...(options.sla ? { sla: { after: '1s', escalate: { notify: 'manager', action: 'escalate' } } } : {}),
      entry: [options.gate === 'human'
        ? { kind: 'orchestrate', ref, gate: 'human' }
        : { kind: 'orchestrate', ref, gate: 'auto', decide: 'allClean' }],
      actions: {
        proceed: { to: 'done', kind: 'system', guards: ['released'] },
        escalate: { to: 'done', kind: 'system' },
        approve: { to: 'done', policy: 'managerOnly' },
        revisit: { to: 'work', policy: 'anyone' },
      },
    },
    done: { final: true },
  },
});

const orchestratorRegistry = {
  build: { agents: ['coder', 'tester'], maxTasks: 3, maxConcurrency: 2, activityOptions: { startToCloseTimeout: '30 seconds', retry: { maximumAttempts: 1 } } },
  failfast: { agents: ['coder', 'tester'], maxTasks: 4, maxConcurrency: 4, failFast: true, activityOptions: { startToCloseTimeout: '30 seconds', retry: { maximumAttempts: 1 } } },
  tiny: { agents: ['coder'], maxOutputBytes: 64, activityOptions: { startToCloseTimeout: '30 seconds', retry: { maximumAttempts: 1 } } },
};

const orchestrationRegistries = (released: boolean) => ({
  policies: { managerOnly: (context: { actor?: { roles: string[] } }) => context.actor?.roles.includes('manager') ?? false, anyone: () => true },
  guards: { released: () => released },
  rules: {
    allClean: {
      actions: ['proceed'],
      run: (context: { tasks?: ReadonlyArray<{ status: string }> }) =>
        context.tasks !== undefined && context.tasks.length > 0 && context.tasks.every((task) => task.status === 'completed') ? 'proceed' : undefined,
    },
  },
  orchestrators: orchestratorRegistry,
});

const orchestrateInterpreter = createFlowkitWorkflow({ activityTaskQueue: 'flowkit-temporal-workflow-test', registries: orchestrationRegistries(true) });
const orchestrateBlockedInterpreter = createFlowkitWorkflow({ activityTaskQueue: 'flowkit-temporal-workflow-test', registries: orchestrationRegistries(false) });
export async function orchestrateWorkflow(input: FlowkitWorkflowInput) { return await orchestrateInterpreter(input); }
export async function orchestrateBlockedWorkflow(input: FlowkitWorkflowInput) { return await orchestrateBlockedInterpreter(input); }
export const orchestrateInput = (ref = 'build', options: { sla?: boolean; gate?: 'auto' | 'human' } = {}): FlowkitWorkflowInput => ({
  published: publishDefinition({ definition: orchestrateDefinition(ref, options) }),
  subject: { id: `orchestrate-${ref}`, organizationId: 'org-1' },
});

/** intake -> work (orchestrate) -> closed -> done, with Continue-As-New always requested. */
const continueDefinition: FlowDefinition = {
  id: 'orchestrate-continue', version: 1, roles: ['manager'], initialStage: 'intake',
  stages: {
    intake: { pendingRole: 'manager', steady: true, actions: { go: { to: 'work', policy: 'anyone' } } },
    work: {
      pendingRole: 'manager',
      steady: true,
      entry: [{ kind: 'orchestrate', ref: 'build', gate: 'human' }],
      actions: { finish: { to: 'closed', policy: 'anyone' } },
    },
    closed: { pendingRole: 'manager', steady: true, actions: { close: { to: 'done', policy: 'anyone' } } },
    done: { final: true },
  },
};
const orchestrateContinueInterpreter = createFlowkitWorkflow({
  activityTaskQueue: 'flowkit-temporal-workflow-test',
  registries: orchestrationRegistries(true),
  shouldContinueAsNew: () => true,
});
export async function orchestrateContinueWorkflow(input: FlowkitWorkflowInput) { return await orchestrateContinueInterpreter(input); }
export const orchestrateContinueInput = (): FlowkitWorkflowInput => ({
  published: publishDefinition({ definition: continueDefinition }),
  subject: { id: 'orchestrate-continue-1', organizationId: 'org-1' },
});
