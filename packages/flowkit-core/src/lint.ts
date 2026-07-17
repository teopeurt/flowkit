import type { FlowDefinition, LintIssue } from './types';

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

    for (const action of Object.values(definition.stages[current]?.actions ?? {})) {
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

    if (stage.final && Object.keys(stage.actions ?? {}).length > 0) {
      pushIssue(issues, {
        code: 'final-stage-has-actions',
        severity: 'error',
        message: `Final stage "${stageName}" should not declare actions.`,
        path: `stages.${stageName}.actions`,
      });
    }

    if (!stage.final && Object.keys(stage.actions ?? {}).length === 0) {
      pushIssue(issues, {
        code: 'dead-end-stage',
        severity: 'error',
        message: `Stage "${stageName}" is non-final and declares no actions.`,
        path: `stages.${stageName}.actions`,
      });
    }

    for (const [actionName, action] of Object.entries(stage.actions ?? {})) {
      usedTracksForAction(usedTracks, action.tracks);

      if (action.pendingRole) {
        usedRoles.add(action.pendingRole);
      }

      for (const role of action.notify?.to ?? []) {
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

      if (action.notify?.template && !registry.templates?.[action.notify.template]) {
        pushIssue(issues, {
          code: 'missing-template-ref',
          severity: 'error',
          message: `Missing template ref "${action.notify.template}" for action "${stageName}.${actionName}".`,
          path: `stages.${stageName}.actions.${actionName}.notify.template`,
        });
      }

      for (const channel of action.notify?.channels ?? []) {
        if (registry.channels?.[channel]) {
          continue;
        }

        pushIssue(issues, {
          code: 'missing-channel-ref',
          severity: 'error',
          message: `Missing channel ref "${channel}" for action "${stageName}.${actionName}".`,
          path: `stages.${stageName}.actions.${actionName}.notify.channels`,
        });
      }
    }
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
