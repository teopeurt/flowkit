import type { FlowDefinition } from '@flowkit/core';

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
      actions: { submit: { to: 'review', policy: 'employeeOnly', guards: ['commentAllowed'] } },
    },
    review: {
      pendingRole: 'manager',
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

export async function testFlowkitWorkflow(input: FlowkitWorkflowInput) {
  return await testInterpreter(input);
}

export const testFlowkitInput = (): FlowkitWorkflowInput => ({
  published: publishDefinition({ definition: testDefinition }),
  subject: { id: 'leave-1' },
});

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
export const entryFlowkitInput = (): FlowkitWorkflowInput => ({ published: publishDefinition({ definition: entryDefinition }), subject: { id: 'entry-1' } });

const loopDefinition: FlowDefinition = {
  id: 'loop-flow', version: 1, roles: [], initialStage: 'loop',
  stages: { loop: { entry: [{ kind: 'rule', ref: 'loop' }], actions: { loop: { to: 'loop', kind: 'system' } } } },
};
const loopInterpreter = createFlowkitWorkflow({
  activityTaskQueue: 'flowkit-temporal-workflow-test',
  registries: { rules: { loop: { actions: ['loop'], run: () => 'loop' } } },
});
export async function loopFlowkitWorkflow(input: FlowkitWorkflowInput) { return await loopInterpreter(input); }
export const loopFlowkitInput = (): FlowkitWorkflowInput => ({ published: publishDefinition({ definition: loopDefinition }), subject: { id: 'loop-1' } });

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
export const notifySlaInput = (): FlowkitWorkflowInput => ({ published: publishDefinition({ definition: slaDefinition({ notify: 'reminder' }) }), subject: { id: 'sla-notify' } });
const actionSlaInterpreter = createFlowkitWorkflow({ activityTaskQueue: 'flowkit-temporal-workflow-test', registries: slaRegistries });
export async function actionSlaWorkflow(input: FlowkitWorkflowInput) { return await actionSlaInterpreter(input); }
export const actionSlaInput = (): FlowkitWorkflowInput => ({ published: publishDefinition({ definition: slaDefinition({ action: 'expire' }) }), subject: { id: 'sla-action' } });
const continuationInterpreter = createFlowkitWorkflow({ activityTaskQueue: 'flowkit-temporal-workflow-test', registries: slaRegistries, shouldContinueAsNew: () => true });
export async function continuationWorkflow(input: FlowkitWorkflowInput) { return await continuationInterpreter(input); }
export const continuationInput = (): FlowkitWorkflowInput => ({ published: publishDefinition({ definition: slaDefinition({ notify: 'reminder' }) }), subject: { id: 'continuation' } });
