import { z } from 'zod';

import type {
  ActionDef,
  FlowDefinition,
  NotificationBinding,
  StageDef,
  StepDef,
  TrackDef,
} from './types';

const trackDefSchema: z.ZodType<TrackDef> = z
  .object({
    initial: z.string(),
    values: z.array(z.string()),
  })
  .strict();

const stepDefSchema: z.ZodType<StepDef> = z
  .object({
    kind: z.enum(['system', 'ai', 'rule', 'orchestrate']),
    ref: z.string(),
    gate: z.enum(['human', 'auto']).optional(),
    decide: z.string().optional(),
  })
  .strict()
  .superRefine((step, ctx) => {
    const gated = step.kind === 'ai' || step.kind === 'orchestrate';

    if (step.gate !== undefined && !gated) {
      addIssue(ctx, ['gate'], `Step gate is only accepted on AI and orchestrate steps, not "${step.kind}" steps.`);
    }

    if (gated && step.gate === undefined) {
      addIssue(ctx, ['gate'], `${step.kind === 'ai' ? 'AI' : 'Orchestrate'} step "${step.ref}" must declare gate "human" or "auto".`);
    }

    if (step.gate === 'auto' && step.decide === undefined) {
      addIssue(ctx, ['decide'], `Step "${step.ref}" with gate "auto" must name a deciding rule in "decide".`);
    }

    if (step.decide !== undefined && step.gate !== 'auto') {
      addIssue(ctx, ['decide'], `Step "decide" is only accepted with gate "auto".`);
    }
  });

const notificationSchema = z
  .object({
    template: z.string(),
    channels: z.array(z.string()),
    to: z.array(z.string()).optional(),
  })
  .strict();

const notificationBindingSchema: z.ZodType<NotificationBinding> = z.union([
  notificationSchema,
  z.array(notificationSchema).min(1),
]);

const actionDefSchema: z.ZodType<ActionDef> = z
  .object({
    to: z.string(),
    kind: z.enum(['human', 'system', 'signal']).optional(),
    status: z.string().optional(),
    pendingRole: z.string().nullable().optional(),
    tracks: z.record(z.string()).optional(),
    guards: z.array(z.string()).optional(),
    policy: z.string().optional(),
    notify: notificationBindingSchema.optional(),
  })
  .strict();

const slaEscalationSchema = z
  .object({
    notify: z.string().optional(),
    action: z.string().optional(),
  })
  .strict();

const slaSchema = z
  .object({
    after: z.string(),
    escalate: slaEscalationSchema,
  })
  .strict();

const stageDefSchema: z.ZodType<StageDef> = z
  .object({
    pendingRole: z.string().nullable().optional(),
    final: z.boolean().optional(),
    steady: z.boolean().optional(),
    entry: z.array(stepDefSchema).optional(),
    entryNotify: notificationBindingSchema.optional(),
    disabledGlobalActions: z.array(z.string()).optional(),
    sla: slaSchema.optional(),
    actions: z.record(actionDefSchema).optional(),
  })
  .strict()
  .superRefine((stage, ctx) => {
    const orchestrations = (stage.entry ?? []).flatMap((step, index) => (step.kind === 'orchestrate' ? [index] : []));

    if (orchestrations.length > 1) {
      addIssue(ctx, ['entry', orchestrations[1]], 'A stage may declare at most one orchestrate step.');
    }
  });

const addIssue = (
  ctx: z.RefinementCtx,
  path: Array<string | number>,
  message: string,
) => {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path,
    message,
  });
};

const findDuplicates = (values: readonly string[]) => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
      continue;
    }

    seen.add(value);
  }

  return [...duplicates];
};

export const flowSchema: z.ZodType<FlowDefinition> = z
  .object({
    id: z.string(),
    version: z.number().int().nonnegative(),
    roles: z.array(z.string()),
    tracks: z.record(trackDefSchema).optional(),
    initialStage: z.string(),
    initialStatus: z.string().optional(),
    actions: z.record(actionDefSchema).optional(),
    stages: z.record(stageDefSchema),
  })
  .strict()
  .superRefine((definition, ctx) => {
    const stageNames = Object.keys(definition.stages);
    const declaredRoles = new Set(definition.roles);
    const declaredTracks = definition.tracks ?? {};
    const globalActions = definition.actions ?? {};

    if (stageNames.length === 0) {
      addIssue(ctx, ['stages'], 'Expected at least one stage.');
      return;
    }

    for (const duplicateRole of findDuplicates(definition.roles)) {
      addIssue(ctx, ['roles'], `Duplicate role "${duplicateRole}".`);
    }

    if (!stageNames.includes(definition.initialStage)) {
      addIssue(ctx, ['initialStage'], `Unknown initial stage "${definition.initialStage}".`);
    }

    for (const [trackName, track] of Object.entries(declaredTracks)) {
      for (const duplicateValue of findDuplicates(track.values)) {
        addIssue(
          ctx,
          ['tracks', trackName, 'values'],
          `Track "${trackName}" contains duplicate value "${duplicateValue}".`,
        );
      }

      if (!track.values.includes(track.initial)) {
        addIssue(
          ctx,
          ['tracks', trackName, 'initial'],
          `Track "${trackName}" initial value "${track.initial}" is not declared in values.`,
        );
      }
    }

    for (const [stageName, stage] of Object.entries(definition.stages)) {
      if (stage.pendingRole && !declaredRoles.has(stage.pendingRole)) {
        addIssue(
          ctx,
          ['stages', stageName, 'pendingRole'],
          `Stage "${stageName}" references undeclared role "${stage.pendingRole}".`,
        );
      }

      if (stage.final && stage.actions !== undefined) {
        addIssue(
          ctx,
          ['stages', stageName, 'actions'],
          `Final stage "${stageName}" cannot declare actions.`,
        );
      }

      if (stage.final && stage.steady) {
        addIssue(
          ctx,
          ['stages', stageName, 'steady'],
          `Final stage "${stageName}" cannot also be steady.`,
        );
      }

      for (const actionName of stage.disabledGlobalActions ?? []) {
        if (!globalActions[actionName]) {
          addIssue(
            ctx,
            ['stages', stageName, 'disabledGlobalActions'],
            `Stage "${stageName}" disables undeclared global action "${actionName}".`,
          );
        }
      }

      for (const notification of notificationBindings(stage.entryNotify)) {
        for (const role of notification.to ?? []) {
          if (!declaredRoles.has(role)) {
            addIssue(
              ctx,
              ['stages', stageName, 'entryNotify', 'to'],
              `Stage "${stageName}" entry notification targets undeclared role "${role}".`,
            );
          }
        }
      }

      for (const [actionName, action] of Object.entries(stage.actions ?? {})) {
        if (!stageNames.includes(action.to)) {
          addIssue(
            ctx,
            ['stages', stageName, 'actions', actionName, 'to'],
            `Action "${stageName}.${actionName}" targets unknown stage "${action.to}".`,
          );
        }

        if (action.pendingRole && !declaredRoles.has(action.pendingRole)) {
          addIssue(
            ctx,
            ['stages', stageName, 'actions', actionName, 'pendingRole'],
            `Action "${stageName}.${actionName}" references undeclared role "${action.pendingRole}".`,
          );
        }

        for (const role of notificationBindings(action.notify).flatMap((notification) => notification.to ?? [])) {
          if (!declaredRoles.has(role)) {
            addIssue(
              ctx,
              ['stages', stageName, 'actions', actionName, 'notify', 'to'],
              `Action "${stageName}.${actionName}" notification targets undeclared role "${role}".`,
            );
          }
        }

        for (const [trackName, trackValue] of Object.entries(action.tracks ?? {})) {
          const declaredTrack = declaredTracks[trackName];

          if (!declaredTrack) {
            addIssue(
              ctx,
              ['stages', stageName, 'actions', actionName, 'tracks', trackName],
              `Action "${stageName}.${actionName}" updates undeclared track "${trackName}".`,
            );
            continue;
          }

          if (!declaredTrack.values.includes(trackValue)) {
            addIssue(
              ctx,
              ['stages', stageName, 'actions', actionName, 'tracks', trackName],
              `Action "${stageName}.${actionName}" assigns undeclared value "${trackValue}" to track "${trackName}".`,
            );
          }
        }
      }

      if (!stage.sla) {
        continue;
      }

      const { escalate } = stage.sla;

      if (!escalate.notify && !escalate.action) {
        addIssue(
          ctx,
          ['stages', stageName, 'sla', 'escalate'],
          `Stage "${stageName}" SLA escalation must declare notify or action.`,
        );
      }

      if (escalate.notify && !declaredRoles.has(escalate.notify)) {
        addIssue(
          ctx,
          ['stages', stageName, 'sla', 'escalate', 'notify'],
          `Stage "${stageName}" SLA notify role "${escalate.notify}" is undeclared.`,
        );
      }

      if (escalate.action) {
        const escalateTarget = stage.actions?.[escalate.action]
          ?? (stage.disabledGlobalActions?.includes(escalate.action)
            ? undefined
            : globalActions[escalate.action]);

        if (!escalateTarget) {
          addIssue(
            ctx,
            ['stages', stageName, 'sla', 'escalate', 'action'],
            `Stage "${stageName}" SLA action "${escalate.action}" is not declared on the stage or as an eligible top-level action.`,
          );
        } else if ((escalateTarget.kind ?? 'human') !== 'system') {
          addIssue(
            ctx,
            ['stages', stageName, 'sla', 'escalate', 'action'],
            `Stage "${stageName}" SLA action "${escalate.action}" must target a system action.`,
          );
        }
      }
    }


    for (const [actionName, action] of Object.entries(globalActions)) {
      if (!stageNames.includes(action.to)) {
        addIssue(ctx, ['actions', actionName, 'to'], `Global action "${actionName}" targets unknown stage "${action.to}".`);
      }
      if (action.pendingRole && !declaredRoles.has(action.pendingRole)) {
        addIssue(ctx, ['actions', actionName, 'pendingRole'], `Global action "${actionName}" references undeclared role "${action.pendingRole}".`);
      }
      for (const role of notificationBindings(action.notify).flatMap((notification) => notification.to ?? [])) {
        if (!declaredRoles.has(role)) {
          addIssue(ctx, ['actions', actionName, 'notify', 'to'], `Global action "${actionName}" notification targets undeclared role "${role}".`);
        }
      }
      for (const [trackName, trackValue] of Object.entries(action.tracks ?? {})) {
        const declaredTrack = declaredTracks[trackName];
        if (!declaredTrack) {
          addIssue(ctx, ['actions', actionName, 'tracks', trackName], `Global action "${actionName}" updates undeclared track "${trackName}".`);
        } else if (!declaredTrack.values.includes(trackValue)) {
          addIssue(ctx, ['actions', actionName, 'tracks', trackName], `Global action "${actionName}" assigns undeclared value "${trackValue}" to track "${trackName}".`);
        }
      }
    }
  });

const notificationBindings = (binding: NotificationBinding | undefined) =>
  binding === undefined ? [] : Array.isArray(binding) ? binding : [binding];

export class FlowDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlowDefinitionError';
  }
}

export const formatIssues = (issues: readonly z.ZodIssue[]) =>
  issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
      return `${path}: ${issue.message}`;
    })
    .join('\n');

export function defineFlow<const T extends FlowDefinition>(input: T): T {
  const parsed = flowSchema.safeParse(input);

  if (!parsed.success) {
    throw new FlowDefinitionError(formatIssues(parsed.error.issues));
  }

  return parsed.data as T;
}
