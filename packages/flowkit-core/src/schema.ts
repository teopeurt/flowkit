import { z } from 'zod';

import type {
  ActionDef,
  FlowDefinition,
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
    kind: z.enum(['system', 'ai', 'rule']),
    ref: z.string(),
    gate: z.literal('human').optional(),
  })
  .strict()
  .superRefine((step, ctx) => {
    if (step.gate !== undefined && step.kind !== 'ai') {
      addIssue(ctx, ['gate'], `Step gate is only accepted on AI steps, not "${step.kind}" steps.`);
    }

    if (step.kind === 'ai' && step.gate !== 'human') {
      addIssue(ctx, ['gate'], `AI step "${step.ref}" must declare gate "human".`);
    }
  });

const notificationSchema = z
  .object({
    template: z.string(),
    channels: z.array(z.string()),
    to: z.array(z.string()).optional(),
  })
  .strict();

const actionDefSchema: z.ZodType<ActionDef> = z
  .object({
    to: z.string(),
    kind: z.enum(['human', 'system']).optional(),
    status: z.string().optional(),
    pendingRole: z.string().nullable().optional(),
    tracks: z.record(z.string()).optional(),
    guards: z.array(z.string()).optional(),
    policy: z.string().optional(),
    notify: notificationSchema.optional(),
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
    entry: z.array(stepDefSchema).optional(),
    sla: slaSchema.optional(),
    actions: z.record(actionDefSchema).optional(),
  })
  .strict();

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
    stages: z.record(stageDefSchema),
  })
  .strict()
  .superRefine((definition, ctx) => {
    const stageNames = Object.keys(definition.stages);
    const declaredRoles = new Set(definition.roles);
    const declaredTracks = definition.tracks ?? {};

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

        for (const role of action.notify?.to ?? []) {
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
        const escalateTarget = stage.actions?.[escalate.action];

        if (!escalateTarget) {
          addIssue(
            ctx,
            ['stages', stageName, 'sla', 'escalate', 'action'],
            `Stage "${stageName}" SLA action "${escalate.action}" is not declared on the same stage.`,
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
  });

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
