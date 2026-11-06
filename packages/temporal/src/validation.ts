import { flowSchema, getActionDefinition, lintInterpreterFlow } from '@naakwu/flowkit-core';
import type { ActionDef, FlowDefinition, NotificationBinding } from '@naakwu/flowkit-core';

import { FLOWKIT_ORCHESTRATION_HARD_LIMIT } from './contracts';
import type {
  FlowkitDeclaredRefs,
  FlowkitOrchestratorRegistration,
  FlowkitPureRegistries,
  PublishedFlowDefinition,
} from './contracts';
import { verifyPublishedDefinition } from './snapshot';

export interface FlowkitValidationRegistries
  extends FlowkitPureRegistries,
    FlowkitDeclaredRefs {}

export interface FlowkitValidationIssue {
  code: string;
  message: string;
  path: string;
}

export class FlowkitValidationError extends Error {
  constructor(readonly issues: readonly FlowkitValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
    this.name = 'FlowkitValidationError';
  }
}

const durationUnits: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Parses positive SLA durations such as `250ms`, `24h`, or `1h30m`. */
export function parseSlaDuration(input: string): number | undefined {
  const parts = input.match(/(\d+)(ms|s|m|h|d)/g);

  if (!parts || parts.join('') !== input) {
    return undefined;
  }

  const milliseconds = parts.reduce((total, part) => {
    const match = /^(\d+)(ms|s|m|h|d)$/.exec(part);

    if (!match) {
      return Number.NaN;
    }

    return total + Number(match[1]) * durationUnits[match[2]];
  }, 0);

  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : undefined;
}

const pathFor = (...parts: Array<string | number>) => parts.join('.');

/**
 * Registry lookups must count only the registry's OWN entries. A plain `registry[name]` also
 * resolves inherited `Object.prototype` members (`constructor`, `toString`, `valueOf`,
 * `__proto__`, ...): an unregistered ref with one of those names would look registered and
 * pass boot validation, and a rule ref would crash it with an unrelated TypeError. Refs are
 * data written in a definition, so a missing one must be reported whatever its name.
 */
const hasOwnRef = (registry: Readonly<Record<string, unknown>> | undefined, name: string): boolean =>
  registry !== undefined && Object.hasOwn(registry, name) && Boolean(registry[name]);

const ownRef = <T>(registry: Readonly<Record<string, T>> | undefined, name: string): T | undefined =>
  registry !== undefined && Object.hasOwn(registry, name) ? registry[name] : undefined;

const pushIssue = (
  issues: FlowkitValidationIssue[],
  code: string,
  path: string,
  message: string,
) => {
  issues.push({ code, path, message });
};

const isIntegerInRange = (value: unknown, min: number, max: number): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

const validateOrchestratorRegistration = (
  ref: string,
  registration: FlowkitOrchestratorRegistration,
  path: string,
  issues: FlowkitValidationIssue[],
) => {
  const agents = registration.agents;

  if (!Array.isArray(agents) || agents.length === 0 || agents.some((agent) => typeof agent !== 'string' || agent === '')) {
    pushIssue(issues, 'orchestrator-agents-empty', path, `Orchestrator "${ref}" must declare a non-empty list of agent names.`);
  }

  const limits: Array<[string, unknown, number]> = [
    ['maxTasks', registration.maxTasks, FLOWKIT_ORCHESTRATION_HARD_LIMIT],
    ['maxConcurrency', registration.maxConcurrency, FLOWKIT_ORCHESTRATION_HARD_LIMIT],
  ];

  for (const [name, value, max] of limits) {
    if (value !== undefined && !isIntegerInRange(value, 1, max)) {
      pushIssue(issues, 'orchestrator-limit-invalid', path, `Orchestrator "${ref}" ${name} must be an integer from 1 to ${max}.`);
    }
  }

  if (registration.maxOutputBytes !== undefined && !isIntegerInRange(registration.maxOutputBytes, 1, Number.MAX_SAFE_INTEGER)) {
    pushIssue(issues, 'orchestrator-limit-invalid', path, `Orchestrator "${ref}" maxOutputBytes must be a positive integer.`);
  }
};

const validateEntryRefs = (
  definition: FlowDefinition,
  registries: FlowkitValidationRegistries,
  issues: FlowkitValidationIssue[],
) => {
  for (const [stageName, stage] of Object.entries(definition.stages)) {
    for (const [index, step] of (stage.entry ?? []).entries()) {
      const path = pathFor('stages', stageName, 'entry', index, 'ref');

      if (step.kind === 'system' && !hasOwnRef(registries.systemSteps, step.ref)) {
        pushIssue(issues, 'missing-system-step-ref', path, `Missing system step ref "${step.ref}".`);
      }

      if (step.kind === 'ai' && !hasOwnRef(registries.aiSteps, step.ref)) {
        pushIssue(issues, 'missing-ai-step-ref', path, `Missing AI step ref "${step.ref}".`);
      }

      if (step.kind === 'orchestrate') {
        const orchestrator = ownRef(registries.orchestrators, step.ref);

        if (!orchestrator) {
          pushIssue(issues, 'missing-orchestrator-ref', path, `Missing orchestrator ref "${step.ref}".`);
        } else {
          validateOrchestratorRegistration(step.ref, orchestrator, path, issues);
        }
      }

      const ruleRef = step.kind === 'rule'
        ? step.ref
        : (step.kind === 'ai' || step.kind === 'orchestrate') && step.gate === 'auto'
          ? step.decide
          : undefined;

      if (ruleRef === undefined) {
        continue;
      }

      const rulePath = step.kind === 'rule' ? path : pathFor('stages', stageName, 'entry', index, 'decide');
      const rule = ownRef(registries.rules, ruleRef);

      if (!rule) {
        pushIssue(issues, 'missing-rule-ref', rulePath, `Missing rule ref "${ruleRef}".`);
        continue;
      }

      for (const actionName of rule.actions) {
        const action = getActionDefinition(definition, stageName, actionName);
        const actionPath = pathFor('stages', stageName, 'actions', actionName);

        if (!action) {
          pushIssue(
            issues,
            'rule-action-unavailable',
            actionPath,
            `Rule "${ruleRef}" may return "${actionName}", which is unavailable from stage "${stageName}".`,
          );
          continue;
        }

        if ((action.kind ?? 'human') !== 'system') {
          pushIssue(
            issues,
            'rule-action-not-system',
            actionPath,
            `Rule "${ruleRef}" may return human action "${actionName}". Rules may target only system actions.`,
          );
        }
      }
    }
  }
};

const validateActionRefs = (
  definition: FlowDefinition,
  registries: FlowkitValidationRegistries,
  issues: FlowkitValidationIssue[],
) => {
  const validateAction = (action: ActionDef, actionPath: string) => {

      if (action.policy && !hasOwnRef(registries.policies, action.policy)) {
        pushIssue(
          issues,
          'missing-policy-ref',
          `${actionPath}.policy`,
          `Missing policy ref "${action.policy}".`,
        );
      }

      for (const guard of action.guards ?? []) {
        if (!hasOwnRef(registries.guards, guard)) {
          pushIssue(
            issues,
            'missing-guard-ref',
            `${actionPath}.guards`,
            `Missing guard ref "${guard}".`,
          );
        }
      }

      validateNotificationRefs(action.notify, actionPath, registries, issues);
  };

  for (const [actionName, action] of Object.entries(definition.actions ?? {})) {
    validateAction(action, pathFor('actions', actionName));
  }

  for (const [stageName, stage] of Object.entries(definition.stages)) {
    for (const [actionName, action] of Object.entries(stage.actions ?? {})) {
      validateAction(action, pathFor('stages', stageName, 'actions', actionName));
    }
    validateNotificationRefs(stage.entryNotify, pathFor('stages', stageName, 'entryNotify'), registries, issues);
  }
};

const notificationBindings = (binding: NotificationBinding | undefined) =>
  binding === undefined ? [] : Array.isArray(binding) ? binding : [binding];

const validateNotificationRefs = (
  binding: NotificationBinding | undefined,
  path: string,
  registries: FlowkitValidationRegistries,
  issues: FlowkitValidationIssue[],
) => {
  for (const notification of notificationBindings(binding)) {
      if (!hasOwnRef(registries.templates, notification.template)) {
        pushIssue(
          issues,
          'missing-template-ref',
          `${path}.template`,
          `Missing template ref "${notification.template}".`,
        );
      }

      for (const channel of notification.channels) {
        if (!hasOwnRef(registries.channels, channel)) {
          pushIssue(
            issues,
            'missing-channel-ref',
            `${path}.channels`,
            `Missing channel ref "${channel}".`,
          );
        }
      }
  }
};

const validateStageScheduling = (
  definition: FlowDefinition,
  issues: FlowkitValidationIssue[],
) => {
  for (const [stageName, stage] of Object.entries(definition.stages)) {
    if (stage.sla && parseSlaDuration(stage.sla.after) === undefined) {
      pushIssue(
        issues,
        'invalid-sla-duration',
        pathFor('stages', stageName, 'sla', 'after'),
        `Stage "${stageName}" SLA duration "${stage.sla.after}" must be positive and use ms, s, m, h, or d units.`,
      );
    }

    if (stage.final && ((stage.entry?.length ?? 0) > 0 || stage.sla)) {
      pushIssue(
        issues,
        'final-stage-schedules-work',
        pathFor('stages', stageName),
        `Final stage "${stageName}" cannot declare entry work or an SLA.`,
      );
    }
  }
};

/** Returns all boot-blocking errors for a published definition and registries. */
export function validateFlowkit(args: {
  published: PublishedFlowDefinition;
  registries: FlowkitValidationRegistries;
}): FlowkitValidationIssue[] {
  const issues: FlowkitValidationIssue[] = [];

  try {
    verifyPublishedDefinition(args.published);
  } catch (error) {
    pushIssue(
      issues,
      'invalid-definition-hash',
      'definitionHash',
      error instanceof Error ? error.message : 'Definition hash verification failed.',
    );
  }

  const schema = flowSchema.safeParse(args.published.definitionSnapshot);

  if (!schema.success) {
    for (const issue of schema.error.issues) {
      pushIssue(
        issues,
        'schema-error',
        issue.path.length > 0 ? issue.path.join('.') : '<root>',
        issue.message,
      );
    }

    return issues;
  }

  for (const issue of lintInterpreterFlow(schema.data)) {
    if (issue.severity === 'error') {
      pushIssue(issues, issue.code, issue.path, issue.message);
    }
  }

  validateActionRefs(schema.data, args.registries, issues);
  validateEntryRefs(schema.data, args.registries, issues);
  validateStageScheduling(schema.data, issues);

  return issues;
}

/** Throws a compact boot error when any interpreter validation fails. */
export function assertValidFlowkit(args: {
  published: PublishedFlowDefinition;
  registries: FlowkitValidationRegistries;
}): void {
  const issues = validateFlowkit(args);

  if (issues.length > 0) {
    throw new FlowkitValidationError(issues);
  }
}
