"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  AuthorizationRejectionError: () => AuthorizationRejectionError,
  FLOWKIT_CORE_VERSION: () => FLOWKIT_CORE_VERSION,
  FlowDefinitionError: () => FlowDefinitionError,
  GuardRejectionError: () => GuardRejectionError,
  InvalidTrackValueError: () => InvalidTrackValueError,
  InvalidTransitionError: () => InvalidTransitionError,
  MissingGuardError: () => MissingGuardError,
  MissingPolicyError: () => MissingPolicyError,
  UnknownStageError: () => UnknownStageError,
  UnknownTrackError: () => UnknownTrackError,
  buildInitialState: () => buildInitialState,
  defineFlow: () => defineFlow,
  flowSchema: () => flowSchema,
  formatIssues: () => formatIssues,
  getActionSourceStages: () => getActionSourceStages,
  getDeclaredActions: () => getDeclaredActions,
  lintFlow: () => lintFlow,
  lintInterpreterFlow: () => lintInterpreterFlow,
  transition: () => transition,
  validateRegistryRefs: () => validateRegistryRefs
});
module.exports = __toCommonJS(index_exports);

// src/lint.ts
var pushIssue = (issues, issue) => {
  issues.push(issue);
};
function lintFlow(definition) {
  const issues = [];
  const reachableStages = /* @__PURE__ */ new Set();
  const usedRoles = /* @__PURE__ */ new Set();
  const usedTracks = /* @__PURE__ */ new Set();
  const actionSources = /* @__PURE__ */ new Map();
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
        code: "unreachable-stage",
        severity: "error",
        message: `Stage "${stageName}" cannot be reached from "${definition.initialStage}".`,
        path: `stages.${stageName}`
      });
    }
    if (stage.pendingRole) {
      usedRoles.add(stage.pendingRole);
    }
    if (stage.final && Object.keys(stage.actions ?? {}).length > 0) {
      pushIssue(issues, {
        code: "final-stage-has-actions",
        severity: "error",
        message: `Final stage "${stageName}" should not declare actions.`,
        path: `stages.${stageName}.actions`
      });
    }
    if (!stage.final && Object.keys(stage.actions ?? {}).length === 0) {
      pushIssue(issues, {
        code: "dead-end-stage",
        severity: "error",
        message: `Stage "${stageName}" is non-final and declares no actions.`,
        path: `stages.${stageName}.actions`
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
      code: "unused-role",
      severity: "warning",
      message: `Role "${role}" is declared but never referenced by the flow.`,
      path: "roles"
    });
  }
  for (const trackName of Object.keys(definition.tracks ?? {})) {
    if (usedTracks.has(trackName)) {
      continue;
    }
    pushIssue(issues, {
      code: "unused-track",
      severity: "warning",
      message: `Track "${trackName}" is declared but never updated by any action.`,
      path: `tracks.${trackName}`
    });
  }
  for (const [actionName, sources] of actionSources.entries()) {
    if (sources.length < 2) {
      continue;
    }
    pushIssue(issues, {
      code: "duplicate-action-source",
      severity: "warning",
      message: `Action "${actionName}" is declared on multiple stages: ${sources.join(", ")}.`,
      path: "stages"
    });
  }
  return issues;
}
function lintInterpreterFlow(definition) {
  const issues = lintFlow(definition);
  for (const [stageName, stage] of Object.entries(definition.stages)) {
    for (const [actionName, action] of Object.entries(stage.actions ?? {})) {
      if ((action.kind ?? "human") === "system" || action.policy) {
        continue;
      }
      pushIssue(issues, {
        code: "missing-action-policy",
        severity: "error",
        message: `Human action "${stageName}.${actionName}" must declare an authorization policy.`,
        path: `stages.${stageName}.actions.${actionName}.policy`
      });
    }
  }
  return issues;
}
function validateRegistryRefs(definition, registry) {
  const issues = [];
  for (const [stageName, stage] of Object.entries(definition.stages)) {
    for (const [entryIndex, step] of (stage.entry ?? []).entries()) {
      if (registry.steps?.[step.ref]) {
        continue;
      }
      pushIssue(issues, {
        code: "missing-step-ref",
        severity: "error",
        message: `Missing step ref "${step.ref}" for ${stageName}.entry[${entryIndex}].`,
        path: `stages.${stageName}.entry.${entryIndex}.ref`
      });
    }
    for (const [actionName, action] of Object.entries(stage.actions ?? {})) {
      for (const guardName of action.guards ?? []) {
        if (registry.guards?.[guardName]) {
          continue;
        }
        pushIssue(issues, {
          code: "missing-guard-ref",
          severity: "error",
          message: `Missing guard ref "${guardName}" for action "${stageName}.${actionName}".`,
          path: `stages.${stageName}.actions.${actionName}.guards`
        });
      }
      if (action.policy && !registry.policies?.[action.policy]) {
        pushIssue(issues, {
          code: "missing-policy-ref",
          severity: "error",
          message: `Missing policy ref "${action.policy}" for action "${stageName}.${actionName}".`,
          path: `stages.${stageName}.actions.${actionName}.policy`
        });
      }
      if (action.notify?.template && !registry.templates?.[action.notify.template]) {
        pushIssue(issues, {
          code: "missing-template-ref",
          severity: "error",
          message: `Missing template ref "${action.notify.template}" for action "${stageName}.${actionName}".`,
          path: `stages.${stageName}.actions.${actionName}.notify.template`
        });
      }
      for (const channel of action.notify?.channels ?? []) {
        if (registry.channels?.[channel]) {
          continue;
        }
        pushIssue(issues, {
          code: "missing-channel-ref",
          severity: "error",
          message: `Missing channel ref "${channel}" for action "${stageName}.${actionName}".`,
          path: `stages.${stageName}.actions.${actionName}.notify.channels`
        });
      }
    }
  }
  return issues;
}
var usedTracksForAction = (usedTracks, tracks) => {
  for (const trackName of Object.keys(tracks ?? {})) {
    usedTracks.add(trackName);
  }
};

// src/schema.ts
var import_zod = require("zod");
var trackDefSchema = import_zod.z.object({
  initial: import_zod.z.string(),
  values: import_zod.z.array(import_zod.z.string())
}).strict();
var stepDefSchema = import_zod.z.object({
  kind: import_zod.z.enum(["system", "ai", "rule"]),
  ref: import_zod.z.string(),
  gate: import_zod.z.literal("human").optional()
}).strict().superRefine((step, ctx) => {
  if (step.gate !== void 0 && step.kind !== "ai") {
    addIssue(ctx, ["gate"], `Step gate is only accepted on AI steps, not "${step.kind}" steps.`);
  }
  if (step.kind === "ai" && step.gate !== "human") {
    addIssue(ctx, ["gate"], `AI step "${step.ref}" must declare gate "human".`);
  }
});
var notificationSchema = import_zod.z.object({
  template: import_zod.z.string(),
  channels: import_zod.z.array(import_zod.z.string()),
  to: import_zod.z.array(import_zod.z.string()).optional()
}).strict();
var actionDefSchema = import_zod.z.object({
  to: import_zod.z.string(),
  kind: import_zod.z.enum(["human", "system"]).optional(),
  status: import_zod.z.string().optional(),
  pendingRole: import_zod.z.string().nullable().optional(),
  tracks: import_zod.z.record(import_zod.z.string()).optional(),
  guards: import_zod.z.array(import_zod.z.string()).optional(),
  policy: import_zod.z.string().optional(),
  notify: notificationSchema.optional()
}).strict();
var slaEscalationSchema = import_zod.z.object({
  notify: import_zod.z.string().optional(),
  action: import_zod.z.string().optional()
}).strict();
var slaSchema = import_zod.z.object({
  after: import_zod.z.string(),
  escalate: slaEscalationSchema
}).strict();
var stageDefSchema = import_zod.z.object({
  pendingRole: import_zod.z.string().nullable().optional(),
  final: import_zod.z.boolean().optional(),
  entry: import_zod.z.array(stepDefSchema).optional(),
  sla: slaSchema.optional(),
  actions: import_zod.z.record(actionDefSchema).optional()
}).strict();
var addIssue = (ctx, path, message) => {
  ctx.addIssue({
    code: import_zod.z.ZodIssueCode.custom,
    path,
    message
  });
};
var findDuplicates = (values) => {
  const seen = /* @__PURE__ */ new Set();
  const duplicates = /* @__PURE__ */ new Set();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
      continue;
    }
    seen.add(value);
  }
  return [...duplicates];
};
var flowSchema = import_zod.z.object({
  id: import_zod.z.string(),
  version: import_zod.z.number().int().nonnegative(),
  roles: import_zod.z.array(import_zod.z.string()),
  tracks: import_zod.z.record(trackDefSchema).optional(),
  initialStage: import_zod.z.string(),
  initialStatus: import_zod.z.string().optional(),
  stages: import_zod.z.record(stageDefSchema)
}).strict().superRefine((definition, ctx) => {
  const stageNames = Object.keys(definition.stages);
  const declaredRoles = new Set(definition.roles);
  const declaredTracks = definition.tracks ?? {};
  if (stageNames.length === 0) {
    addIssue(ctx, ["stages"], "Expected at least one stage.");
    return;
  }
  for (const duplicateRole of findDuplicates(definition.roles)) {
    addIssue(ctx, ["roles"], `Duplicate role "${duplicateRole}".`);
  }
  if (!stageNames.includes(definition.initialStage)) {
    addIssue(ctx, ["initialStage"], `Unknown initial stage "${definition.initialStage}".`);
  }
  for (const [trackName, track] of Object.entries(declaredTracks)) {
    for (const duplicateValue of findDuplicates(track.values)) {
      addIssue(
        ctx,
        ["tracks", trackName, "values"],
        `Track "${trackName}" contains duplicate value "${duplicateValue}".`
      );
    }
    if (!track.values.includes(track.initial)) {
      addIssue(
        ctx,
        ["tracks", trackName, "initial"],
        `Track "${trackName}" initial value "${track.initial}" is not declared in values.`
      );
    }
  }
  for (const [stageName, stage] of Object.entries(definition.stages)) {
    if (stage.pendingRole && !declaredRoles.has(stage.pendingRole)) {
      addIssue(
        ctx,
        ["stages", stageName, "pendingRole"],
        `Stage "${stageName}" references undeclared role "${stage.pendingRole}".`
      );
    }
    if (stage.final && stage.actions !== void 0) {
      addIssue(
        ctx,
        ["stages", stageName, "actions"],
        `Final stage "${stageName}" cannot declare actions.`
      );
    }
    for (const [actionName, action] of Object.entries(stage.actions ?? {})) {
      if (!stageNames.includes(action.to)) {
        addIssue(
          ctx,
          ["stages", stageName, "actions", actionName, "to"],
          `Action "${stageName}.${actionName}" targets unknown stage "${action.to}".`
        );
      }
      if (action.pendingRole && !declaredRoles.has(action.pendingRole)) {
        addIssue(
          ctx,
          ["stages", stageName, "actions", actionName, "pendingRole"],
          `Action "${stageName}.${actionName}" references undeclared role "${action.pendingRole}".`
        );
      }
      for (const role of action.notify?.to ?? []) {
        if (!declaredRoles.has(role)) {
          addIssue(
            ctx,
            ["stages", stageName, "actions", actionName, "notify", "to"],
            `Action "${stageName}.${actionName}" notification targets undeclared role "${role}".`
          );
        }
      }
      for (const [trackName, trackValue] of Object.entries(action.tracks ?? {})) {
        const declaredTrack = declaredTracks[trackName];
        if (!declaredTrack) {
          addIssue(
            ctx,
            ["stages", stageName, "actions", actionName, "tracks", trackName],
            `Action "${stageName}.${actionName}" updates undeclared track "${trackName}".`
          );
          continue;
        }
        if (!declaredTrack.values.includes(trackValue)) {
          addIssue(
            ctx,
            ["stages", stageName, "actions", actionName, "tracks", trackName],
            `Action "${stageName}.${actionName}" assigns undeclared value "${trackValue}" to track "${trackName}".`
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
        ["stages", stageName, "sla", "escalate"],
        `Stage "${stageName}" SLA escalation must declare notify or action.`
      );
    }
    if (escalate.notify && !declaredRoles.has(escalate.notify)) {
      addIssue(
        ctx,
        ["stages", stageName, "sla", "escalate", "notify"],
        `Stage "${stageName}" SLA notify role "${escalate.notify}" is undeclared.`
      );
    }
    if (escalate.action) {
      const escalateTarget = stage.actions?.[escalate.action];
      if (!escalateTarget) {
        addIssue(
          ctx,
          ["stages", stageName, "sla", "escalate", "action"],
          `Stage "${stageName}" SLA action "${escalate.action}" is not declared on the same stage.`
        );
      } else if ((escalateTarget.kind ?? "human") !== "system") {
        addIssue(
          ctx,
          ["stages", stageName, "sla", "escalate", "action"],
          `Stage "${stageName}" SLA action "${escalate.action}" must target a system action.`
        );
      }
    }
  }
});
var FlowDefinitionError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "FlowDefinitionError";
  }
};
var formatIssues = (issues) => issues.map((issue) => {
  const path = issue.path.length > 0 ? issue.path.join(".") : "<root>";
  return `${path}: ${issue.message}`;
}).join("\n");
function defineFlow(input) {
  const parsed = flowSchema.safeParse(input);
  if (!parsed.success) {
    throw new FlowDefinitionError(formatIssues(parsed.error.issues));
  }
  return parsed.data;
}

// src/transition.ts
var UnknownStageError = class extends Error {
  constructor(stage) {
    super(`Unknown stage "${stage}".`);
    this.stage = stage;
    this.name = "UnknownStageError";
  }
  stage;
};
var UnknownTrackError = class extends Error {
  constructor(track) {
    super(`Unknown track "${track}".`);
    this.track = track;
    this.name = "UnknownTrackError";
  }
  track;
};
var InvalidTrackValueError = class extends Error {
  constructor(track, value, allowedValues) {
    super(
      `Invalid value "${value}" for track "${track}". Expected one of: ${allowedValues.join(", ")}`
    );
    this.track = track;
    this.value = value;
    this.allowedValues = allowedValues;
    this.name = "InvalidTrackValueError";
  }
  track;
  value;
  allowedValues;
};
var InvalidTransitionError = class extends Error {
  constructor(stage, action, sourceStages) {
    super(
      `Invalid action "${action}" from stage "${stage}". Declared on: ${sourceStages.join(", ") || "<none>"}`
    );
    this.stage = stage;
    this.action = action;
    this.sourceStages = sourceStages;
    this.name = "InvalidTransitionError";
  }
  stage;
  action;
  sourceStages;
};
var MissingPolicyError = class extends Error {
  constructor(policy, action) {
    super(`Missing authorization policy "${policy}" for action "${action}".`);
    this.policy = policy;
    this.action = action;
    this.name = "MissingPolicyError";
  }
  policy;
  action;
};
var MissingGuardError = class extends Error {
  constructor(guard, action) {
    super(`Missing guard "${guard}" for action "${action}".`);
    this.guard = guard;
    this.action = action;
    this.name = "MissingGuardError";
  }
  guard;
  action;
};
var AuthorizationRejectionError = class extends Error {
  constructor(policy, action) {
    super(`Authorization policy "${policy}" rejected action "${action}".`);
    this.policy = policy;
    this.action = action;
    this.name = "AuthorizationRejectionError";
  }
  policy;
  action;
};
var GuardRejectionError = class extends Error {
  constructor(guard, action) {
    super(`Guard "${guard}" rejected action "${action}".`);
    this.guard = guard;
    this.action = action;
    this.name = "GuardRejectionError";
  }
  guard;
  action;
};
var getStage = (definition, stage) => {
  const resolved = definition.stages[stage];
  if (!resolved) {
    throw new UnknownStageError(stage);
  }
  return resolved;
};
var validateTracks = (definition, tracks) => {
  const declaredTracks = definition.tracks ?? {};
  for (const [trackName, trackValue] of Object.entries(tracks)) {
    const declaredTrack = declaredTracks[trackName];
    if (!declaredTrack) {
      throw new UnknownTrackError(trackName);
    }
    if (!declaredTrack.values.includes(trackValue)) {
      throw new InvalidTrackValueError(trackName, trackValue, declaredTrack.values);
    }
  }
};
var buildPredicateContext = (definition, state, command, context) => ({
  definition,
  state,
  command,
  subject: context.subject ?? {},
  facts: context.facts ?? {},
  actor: context.actor
});
var validateState = (definition, state) => {
  getStage(definition, state.stage);
  validateTracks(definition, state.tracks);
};
function buildInitialState(definition, overrides = {}) {
  const stage = overrides.stage ?? definition.initialStage;
  const stageDefinition = getStage(definition, stage);
  const baseTracks = Object.fromEntries(
    Object.entries(definition.tracks ?? {}).map(([trackName, track]) => [
      trackName,
      track.initial
    ])
  );
  const tracks = {
    ...baseTracks,
    ...overrides.tracks ?? {}
  };
  validateTracks(definition, tracks);
  return {
    stage,
    status: overrides.status ?? definition.initialStatus ?? "pending",
    pendingRole: overrides.pendingRole === void 0 ? stageDefinition.pendingRole ?? null : overrides.pendingRole,
    tracks
  };
}
function getDeclaredActions(definition, stage) {
  return Object.keys(getStage(definition, stage).actions ?? {});
}
function getActionSourceStages(definition, action) {
  return Object.entries(definition.stages).filter(([, stage]) => stage.actions?.[action]).map(([stageName]) => stageName);
}
function transition(definition, state, command, context = {}) {
  validateState(definition, state);
  const stageDefinition = getStage(definition, state.stage);
  const actionDefinition = stageDefinition.actions?.[command.action];
  if (!actionDefinition) {
    throw new InvalidTransitionError(
      state.stage,
      command.action,
      getActionSourceStages(definition, command.action)
    );
  }
  const predicateContext = buildPredicateContext(definition, state, command, context);
  if (actionDefinition.policy) {
    const policy = context.policies?.[actionDefinition.policy];
    if (!policy) {
      throw new MissingPolicyError(actionDefinition.policy, command.action);
    }
    if (!policy(predicateContext)) {
      throw new AuthorizationRejectionError(actionDefinition.policy, command.action);
    }
  }
  for (const guardName of actionDefinition.guards ?? []) {
    const guard = context.guards?.[guardName];
    if (!guard) {
      throw new MissingGuardError(guardName, command.action);
    }
    if (!guard(predicateContext)) {
      throw new GuardRejectionError(guardName, command.action);
    }
  }
  const nextStageDefinition = getStage(definition, actionDefinition.to);
  const trackUpdates = { ...actionDefinition.tracks ?? {} };
  const nextTracks = {
    ...state.tracks,
    ...trackUpdates
  };
  validateTracks(definition, nextTracks);
  const nextState = {
    stage: actionDefinition.to,
    status: actionDefinition.status ?? state.status,
    pendingRole: actionDefinition.pendingRole ?? nextStageDefinition.pendingRole ?? null,
    tracks: nextTracks
  };
  return {
    state: nextState,
    transition: {
      action: command.action,
      fromStage: state.stage,
      nextStage: nextState.stage,
      status: nextState.status,
      pendingRole: nextState.pendingRole,
      trackUpdates
    }
  };
}

// src/index.ts
var FLOWKIT_CORE_VERSION = "0.2.0";
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AuthorizationRejectionError,
  FLOWKIT_CORE_VERSION,
  FlowDefinitionError,
  GuardRejectionError,
  InvalidTrackValueError,
  InvalidTransitionError,
  MissingGuardError,
  MissingPolicyError,
  UnknownStageError,
  UnknownTrackError,
  buildInitialState,
  defineFlow,
  flowSchema,
  formatIssues,
  getActionSourceStages,
  getDeclaredActions,
  lintFlow,
  lintInterpreterFlow,
  transition,
  validateRegistryRefs
});
