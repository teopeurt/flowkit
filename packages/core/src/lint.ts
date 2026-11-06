import { getActionDefinition, getDeclaredActions } from './transition';
import type { ActionDef, FlowDefinition, LintIssue, NotificationBinding } from './types';

export interface RegistryRefs {
  guards?: Record<string, unknown>;
  policies?: Record<string, unknown>;
  steps?: Record<string, unknown>;
  templates?: Record<string, unknown>;
  channels?: Record<string, unknown>;
}

const pushIssue = (
  issues: LintIssue[],
  issue: LintIssue,
) => {
  issues.push(issue);
};

const notificationBindings = (binding: NotificationBinding | undefined) =>
  binding === undefined ? [] : Array.isArray(binding) ? binding : [binding];

const actionEntries = (definition: FlowDefinition): Array<{
  actionName: string;
  action: ActionDef;
  path: string;
}> => [
  ...Object.entries(definition.actions ?? {}).map(([actionName, action]) => ({
    actionName,
    action,
    path: `actions.${actionName}`,
  })),
  ...Object.entries(definition.stages).flatMap(([stageName, stage]) =>
    Object.entries(stage.actions ?? {}).map(([actionName, action]) => ({
      actionName,
      action,
      path: `stages.${stageName}.actions.${actionName}`,
    })),
  ),
];

export function lintFlow(definition: FlowDefinition): LintIssue[] {
  const issues: LintIssue[] = [];
  const reachableStages = new Set<string>();
  const usedRoles = new Set<string>();
  const usedTracks = new Set<string>();
  const actionSources = new Map<string, string[]>();
  const queue = [definition.initialStage];

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current || reachableStages.has(current)) {
      continue;
    }

    reachableStages.add(current);

    for (const actionName of getDeclaredActions(definition, current)) {
      const action = getActionDefinition(definition, current, actionName);
      if (!action) continue;
      if (!reachableStages.has(action.to)) {
        queue.push(action.to);
      }
    }
  }

  for (const [stageName, stage] of Object.entries(definition.stages)) {
    if (!reachableStages.has(stageName)) {
      pushIssue(issues, {
        code: 'unreachable-stage',
        severity: 'error',
        message: `Stage "${stageName}" cannot be reached from "${definition.initialStage}".`,
        path: `stages.${stageName}`,
      });
    }

    if (stage.pendingRole) {
      usedRoles.add(stage.pendingRole);
    }

    for (const notification of notificationBindings(stage.entryNotify)) {
      for (const role of notification.to ?? []) usedRoles.add(role);
    }

    if (stage.final && Object.keys(stage.actions ?? {}).length > 0) {
      pushIssue(issues, {
        code: 'final-stage-has-actions',
        severity: 'error',
        message: `Final stage "${stageName}" should not declare actions.`,
        path: `stages.${stageName}.actions`,
      });
    }

    if (!stage.final && getDeclaredActions(definition, stageName).length === 0) {
      pushIssue(issues, {
        code: 'dead-end-stage',
        severity: 'error',
        message: `Stage "${stageName}" is non-final and declares no actions.`,
        path: `stages.${stageName}.actions`,
      });
    }

    if (!stage.final && !stage.sla && (stage.entry ?? []).some((step) => step.kind === 'orchestrate')) {
      pushIssue(issues, {
        code: 'orchestrate-without-sla',
        severity: 'warning',
        message: `Stage "${stageName}" runs an orchestrate step but declares no SLA. Orchestrations are long-running and should be bounded by an escalation.`,
        path: `stages.${stageName}`,
      });
    }

    if (
      !stage.final &&
      !stage.steady &&
      !stage.sla &&
      !(stage.entry ?? []).some((step) => step.kind === 'rule')
    ) {
      pushIssue(issues, {
        code: 'unbounded-stage',
        severity: 'warning',
        message: `Stage "${stageName}" has no SLA, automatic rule, or explicit steady marker.`,
        path: `stages.${stageName}`,
      });
    }

    for (const [actionName, action] of Object.entries(stage.actions ?? {})) {
      usedTracksForAction(usedTracks, action.tracks);

      if (action.pendingRole) {
        usedRoles.add(action.pendingRole);
      }

      for (const role of notificationBindings(action.notify).flatMap((notification) => notification.to ?? [])) {
        usedRoles.add(role);
      }

      const sources = actionSources.get(actionName) ?? [];
      sources.push(stageName);
      actionSources.set(actionName, sources);
    }

    if (stage.sla?.escalate.notify) {
      usedRoles.add(stage.sla.escalate.notify);
    }
  }

  for (const action of Object.values(definition.actions ?? {})) {
    usedTracksForAction(usedTracks, action.tracks);
    if (action.pendingRole) usedRoles.add(action.pendingRole);
    for (const role of notificationBindings(action.notify).flatMap((notification) => notification.to ?? [])) {
      usedRoles.add(role);
    }
  }

  for (const role of definition.roles) {
    if (usedRoles.has(role)) {
      continue;
    }

    pushIssue(issues, {
      code: 'unused-role',
      severity: 'warning',
      message: `Role "${role}" is declared but never referenced by the flow.`,
      path: 'roles',
    });
  }

  for (const trackName of Object.keys(definition.tracks ?? {})) {
    if (usedTracks.has(trackName)) {
      continue;
    }

    pushIssue(issues, {
      code: 'unused-track',
      severity: 'warning',
      message: `Track "${trackName}" is declared but never updated by any action.`,
      path: `tracks.${trackName}`,
    });
  }

  for (const [actionName, sources] of actionSources.entries()) {
    if (sources.length < 2) {
      continue;
    }

    pushIssue(issues, {
      code: 'duplicate-action-source',
      severity: 'warning',
      message: `Action "${actionName}" is declared on multiple stages: ${sources.join(', ')}.`,
      path: 'stages',
    });
  }

  return issues;
}

/**
 * Interpreter-facing lint: everything {@link lintFlow} reports, plus a hard
 * error for every human action that does not declare an authorization policy.
 *
 * The policy-neutral {@link lintFlow} default is unchanged so `flowkit-core`
 * remains usable as a kernel; interpreters (for example `flowkit-temporal`)
 * promote this helper's result to a boot failure.
 */
export function lintInterpreterFlow(definition: FlowDefinition): LintIssue[] {
  const issues = lintFlow(definition);

  for (const { actionName, action, path } of actionEntries(definition)) {
    if ((action.kind ?? 'human') === 'system' || action.policy) {
      continue;
    }

    pushIssue(issues, {
      code: 'missing-action-policy',
      severity: 'error',
      message: `${action.kind === 'signal' ? 'Signal' : 'Human'} action "${actionName}" must declare an authorization policy.`,
      path: `${path}.policy`,
    });
  }

  return issues;
}

export function validateRegistryRefs(
  definition: FlowDefinition,
  registry: RegistryRefs,
): LintIssue[] {
  const issues: LintIssue[] = [];

  for (const [stageName, stage] of Object.entries(definition.stages)) {
    for (const [entryIndex, step] of (stage.entry ?? []).entries()) {
      if (registry.steps?.[step.ref]) {
        continue;
      }

      pushIssue(issues, {
        code: 'missing-step-ref',
        severity: 'error',
        message: `Missing step ref "${step.ref}" for ${stageName}.entry[${entryIndex}].`,
        path: `stages.${stageName}.entry.${entryIndex}.ref`,
      });
    }

    for (const [actionName, action] of Object.entries(stage.actions ?? {})) {
      for (const guardName of action.guards ?? []) {
        if (registry.guards?.[guardName]) {
          continue;
        }

        pushIssue(issues, {
          code: 'missing-guard-ref',
          severity: 'error',
          message: `Missing guard ref "${guardName}" for action "${stageName}.${actionName}".`,
          path: `stages.${stageName}.actions.${actionName}.guards`,
        });
      }

      if (action.policy && !registry.policies?.[action.policy]) {
        pushIssue(issues, {
          code: 'missing-policy-ref',
          severity: 'error',
          message: `Missing policy ref "${action.policy}" for action "${stageName}.${actionName}".`,
          path: `stages.${stageName}.actions.${actionName}.policy`,
        });
      }

      validateNotifications(action.notify, registry, issues, `stages.${stageName}.actions.${actionName}.notify`, `action "${stageName}.${actionName}"`);
    }

    validateNotifications(stage.entryNotify, registry, issues, `stages.${stageName}.entryNotify`, `stage "${stageName}" entry`);
  }

  for (const [actionName, action] of Object.entries(definition.actions ?? {})) {
    for (const guardName of action.guards ?? []) {
      if (!registry.guards?.[guardName]) pushIssue(issues, { code: 'missing-guard-ref', severity: 'error', message: `Missing guard ref "${guardName}" for global action "${actionName}".`, path: `actions.${actionName}.guards` });
    }
    if (action.policy && !registry.policies?.[action.policy]) pushIssue(issues, { code: 'missing-policy-ref', severity: 'error', message: `Missing policy ref "${action.policy}" for global action "${actionName}".`, path: `actions.${actionName}.policy` });
    validateNotifications(action.notify, registry, issues, `actions.${actionName}.notify`, `global action "${actionName}"`);
  }

  return issues;
}

const usedTracksForAction = (
  usedTracks: Set<string>,
  tracks: Record<string, string> | undefined,
) => {
  for (const trackName of Object.keys(tracks ?? {})) {
    usedTracks.add(trackName);
  }
};

const validateNotifications = (
  binding: NotificationBinding | undefined,
  registry: RegistryRefs,
  issues: LintIssue[],
  path: string,
  owner: string,
) => {
  for (const notification of notificationBindings(binding)) {
    if (!registry.templates?.[notification.template]) {
      pushIssue(issues, { code: 'missing-template-ref', severity: 'error', message: `Missing template ref "${notification.template}" for ${owner}.`, path: `${path}.template` });
    }
    for (const channel of notification.channels) {
      if (!registry.channels?.[channel]) pushIssue(issues, { code: 'missing-channel-ref', severity: 'error', message: `Missing channel ref "${channel}" for ${owner}.`, path: `${path}.channels` });
    }
  }
};
