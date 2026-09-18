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

// src/workflow.ts
var workflow_exports = {};
__export(workflow_exports, {
  createFlowkitWorkflow: () => createFlowkitWorkflow
});
module.exports = __toCommonJS(workflow_exports);
var import_workflow = require("@temporalio/workflow");
var import_flowkit_core3 = require("@naakwu/flowkit-core");

// src/snapshot.ts
var import_sha2 = require("@noble/hashes/sha2.js");
var import_utils = require("@noble/hashes/utils.js");
var import_flowkit_core = require("@naakwu/flowkit-core");
var SnapshotError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "SnapshotError";
  }
};
var HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
var isPlainObject = (value) => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
function canonicalizeJson(value) {
  const write = (current) => {
    if (current === null) {
      return "null";
    }
    switch (typeof current) {
      case "string":
        return JSON.stringify(current);
      case "boolean":
        return current ? "true" : "false";
      case "number": {
        if (!Number.isFinite(current)) {
          throw new SnapshotError("Canonical JSON rejects non-finite numbers.");
        }
        return JSON.stringify(current);
      }
      case "object": {
        if (Array.isArray(current)) {
          return `[${current.map((item) => write(item)).join(",")}]`;
        }
        if (!isPlainObject(current)) {
          throw new SnapshotError("Canonical JSON only accepts plain objects.");
        }
        const entries = Object.keys(current).sort().map((key) => {
          const item = current[key];
          if (item === void 0) {
            throw new SnapshotError(`Canonical JSON rejects undefined at key "${key}".`);
          }
          return `${JSON.stringify(key)}:${write(item)}`;
        });
        return `{${entries.join(",")}}`;
      }
      default:
        throw new SnapshotError(`Canonical JSON rejects ${typeof current} values.`);
    }
  };
  return write(value);
}
var encodeUtf8 = (input) => {
  const bytes = [];
  for (let index = 0; index < input.length; index += 1) {
    let code = input.charCodeAt(index);
    if (code >= 55296 && code <= 56319 && index + 1 < input.length) {
      const next = input.charCodeAt(index + 1);
      if (next >= 56320 && next <= 57343) {
        code = 65536 + (code - 55296 << 10) + (next - 56320);
        index += 1;
      }
    }
    if (code < 128) {
      bytes.push(code);
    } else if (code < 2048) {
      bytes.push(192 | code >> 6, 128 | code & 63);
    } else if (code < 65536) {
      bytes.push(224 | code >> 12, 128 | code >> 6 & 63, 128 | code & 63);
    } else {
      bytes.push(
        240 | code >> 18,
        128 | code >> 12 & 63,
        128 | code >> 6 & 63,
        128 | code & 63
      );
    }
  }
  return Uint8Array.from(bytes);
};
function hashCanonicalJson(canonical) {
  return `sha256:${(0, import_utils.bytesToHex)((0, import_sha2.sha256)(encodeUtf8(canonical)))}`;
}
function verifyPublishedDefinition(published) {
  if (!published || typeof published !== "object") {
    throw new SnapshotError("Published definition must be an object.");
  }
  const { definitionSnapshot, definitionHash } = published;
  if (typeof definitionHash !== "string" || !HASH_PATTERN.test(definitionHash)) {
    throw new SnapshotError(
      'Definition hash must be "sha256:" followed by 64 lowercase hex characters.'
    );
  }
  const actual = hashCanonicalJson(canonicalizeJson(definitionSnapshot));
  if (actual !== definitionHash) {
    throw new SnapshotError("Definition snapshot does not match its content hash.");
  }
  const parsed = import_flowkit_core.flowSchema.safeParse(definitionSnapshot);
  if (!parsed.success) {
    throw new SnapshotError("Definition snapshot fails schema validation.");
  }
}

// src/validation.ts
var import_flowkit_core2 = require("@naakwu/flowkit-core");
var durationUnits = {
  ms: 1,
  s: 1e3,
  m: 6e4,
  h: 36e5,
  d: 864e5
};
function parseSlaDuration(input) {
  const parts = input.match(/(\d+)(ms|s|m|h|d)/g);
  if (!parts || parts.join("") !== input) {
    return void 0;
  }
  const milliseconds = parts.reduce((total, part) => {
    const match = /^(\d+)(ms|s|m|h|d)$/.exec(part);
    if (!match) {
      return Number.NaN;
    }
    return total + Number(match[1]) * durationUnits[match[2]];
  }, 0);
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : void 0;
}

// src/workflow.ts
var isFactsObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var normalizeNotifications = (binding) => binding === void 0 ? [] : Array.isArray(binding) ? binding : [binding];
var stateView = (execution, definition) => ({
  state: execution.state,
  sequence: execution.sequence,
  stepResults: execution.stepResults,
  slaDeadline: execution.slaDeadline,
  completed: execution.completed,
  nextActions: execution.completed ? [] : (0, import_flowkit_core3.getDeclaredActions)(definition, execution.state.stage)
});
var initialExecution = (input) => input.resume?.execution ?? {
  state: input.initialState ?? (0, import_flowkit_core3.buildInitialState)(input.published.definitionSnapshot),
  sequence: 0,
  entryEpoch: 0,
  stepResults: {},
  completedInitialEntry: false,
  completed: false
};
var commandFailure = (error) => import_workflow.ApplicationFailure.nonRetryable(
  error instanceof Error ? error.message : "Flowkit command was rejected.",
  "FLOWKIT_COMMAND_REJECTED"
);
function createFlowkitWorkflow(config) {
  const query = (0, import_workflow.defineQuery)(config.queryName ?? "getState");
  const update = (0, import_workflow.defineUpdate)(config.updateName ?? "applyAction");
  const signalUpdate = (0, import_workflow.defineUpdate)("applySignal");
  const activities = (0, import_workflow.proxyActivities)({
    taskQueue: config.activityTaskQueue,
    startToCloseTimeout: "1 minute",
    ...config.activityOptions ?? {}
  });
  const aiActivities = (0, import_workflow.proxyActivities)({
    taskQueue: config.activityTaskQueue,
    startToCloseTimeout: "1 minute",
    retry: { maximumAttempts: 3 },
    ...config.activityOptions ?? {}
  });
  return async (input) => {
    verifyPublishedDefinition(input.published);
    const definition = input.published.definitionSnapshot;
    const definitionIdentity = {
      id: definition.id,
      version: definition.version,
      hash: input.published.definitionHash
    };
    const execution = initialExecution(input);
    const commands = [];
    let draining = false;
    let automaticTransitions = 0;
    const view = () => stateView(execution, definition);
    const adaptedView = () => config.adaptState?.({ state: view(), input }) ?? view();
    (0, import_workflow.setHandler)(query, adaptedView);
    const enqueueUpdate = async (origin, command) => {
      const updateId = (0, import_workflow.currentUpdateInfo)()?.id;
      if (!updateId) {
        throw import_workflow.ApplicationFailure.nonRetryable("A stable Temporal Update ID is required.", "FLOWKIT_MISSING_UPDATE_ID");
      }
      if (draining) {
        throw import_workflow.ApplicationFailure.nonRetryable("Workflow is draining.", "FLOWKIT_DRAINING");
      }
      const completion = new import_workflow.Trigger();
      commands.push({ operationId: updateId, origin, command, completion });
      return await completion;
    };
    (0, import_workflow.setHandler)(update, (command) => enqueueUpdate("human", command));
    (0, import_workflow.setHandler)(signalUpdate, (command) => enqueueUpdate("signal", command));
    const runEntry = async (reason, priorTransition, completion) => {
      if (definition.stages[execution.state.stage]?.final) {
        execution.completed = true;
        return false;
      }
      const entryFacts = {};
      const automaticCommands = [];
      for (const [index, step] of (definition.stages[execution.state.stage]?.entry ?? []).entries()) {
        const key = `${execution.entryEpoch}:${index}`;
        const stepIdentity = {
          workflowId: (0, import_workflow.workflowInfo)().workflowId,
          stepIndex: index,
          idempotencyKey: JSON.stringify([
            (0, import_workflow.workflowInfo)().workflowId,
            execution.entryEpoch,
            index
          ])
        };
        if (step.kind === "system") {
          const result = await activities.executeSystemStep({ ...stepIdentity, ref: step.ref, definition: definitionIdentity, subject: input.subject, state: execution.state, entryEpoch: execution.entryEpoch, entryReason: reason, priorTransition });
          execution.stepResults[key] = { ref: step.ref, kind: "system", status: "completed", entryEpoch: execution.entryEpoch, output: result.output };
          if (isFactsObject(result.output)) Object.assign(entryFacts, result.output);
          continue;
        }
        if (step.kind === "ai") {
          try {
            const result = await aiActivities.executeAiStep({ ...stepIdentity, ref: step.ref, definition: definitionIdentity, subject: input.subject, state: execution.state, entryEpoch: execution.entryEpoch, entryReason: reason, priorTransition });
            execution.stepResults[key] = { ref: step.ref, kind: "ai", status: "completed", entryEpoch: execution.entryEpoch, output: result.output };
            if (isFactsObject(result.output)) Object.assign(entryFacts, result.output);
          } catch {
            execution.stepResults[key] = { ref: step.ref, kind: "ai", status: "degraded_to_human", entryEpoch: execution.entryEpoch };
          }
          continue;
        }
        const action = config.registries.rules?.[step.ref]?.run({ definition, state: execution.state, subject: input.subject.metadata ?? {}, facts: entryFacts, priorTransition });
        if (action) {
          if (automaticTransitions >= (config.maxAutomaticTransitionsPerTurn ?? 32)) {
            throw import_workflow.ApplicationFailure.nonRetryable("Automatic transition limit exceeded.", "FLOWKIT_AUTOMATIC_LOOP");
          }
          automaticTransitions += 1;
          automaticCommands.push({ operationId: `rule:${execution.entryEpoch}:${index}`, origin: "rule", command: { action, actorId: "system" } });
        }
      }
      if (completion && automaticCommands.length > 0) {
        automaticCommands.at(-1).completion = completion;
      }
      commands.unshift(...automaticCommands);
      return automaticCommands.length > 0;
    };
    const armSla = async () => {
      const sla = definition.stages[execution.state.stage]?.sla;
      if (!sla) {
        execution.slaDeadline = void 0;
        return;
      }
      const duration = parseSlaDuration(sla.after);
      if (duration === void 0) {
        throw import_workflow.ApplicationFailure.nonRetryable(`Invalid SLA duration "${sla.after}".`, "FLOWKIT_INVALID_SLA");
      }
      execution.slaDeadline = Date.now() + duration;
      await activities.recordStageReady({ workflowId: (0, import_workflow.workflowInfo)().workflowId, definition: definitionIdentity, subject: input.subject, state: execution.state, entryEpoch: execution.entryEpoch, slaDeadline: execution.slaDeadline });
    };
    if (!execution.completedInitialEntry) {
      await runEntry("initial");
      execution.completedInitialEntry = true;
      await armSla();
    }
    while (!execution.completed) {
      const receivedCommand = execution.slaDeadline === void 0 ? (await (0, import_workflow.condition)(() => commands.length > 0), true) : await (0, import_workflow.condition)(() => commands.length > 0, Math.max(1, execution.slaDeadline - Date.now()));
      if (!receivedCommand) {
        const sla = definition.stages[execution.state.stage]?.sla;
        const deadline = execution.slaDeadline;
        execution.slaDeadline = void 0;
        if (sla?.escalate.notify) {
          try {
            await activities.dispatchNotification({ operationKey: `sla:${execution.entryEpoch}`, definition: definitionIdentity, subject: input.subject, notification: { template: sla.escalate.notify, channels: [] } });
          } catch {
          }
        }
        if (sla?.escalate.action) {
          commands.push({ operationId: `sla:${execution.entryEpoch}`, origin: "sla", command: { action: sla.escalate.action, actorId: "system" } });
        }
        if (deadline === void 0) continue;
      }
      const envelope = commands.shift();
      if (!envelope) {
        continue;
      }
      try {
        const action = (0, import_flowkit_core3.getActionDefinition)(definition, execution.state.stage, envelope.command.action);
        const expectedKind = envelope.origin === "human" ? "human" : envelope.origin === "signal" ? "signal" : "system";
        if (!action || (action.kind ?? "human") !== expectedKind) {
          throw new Error(`Action "${envelope.command.action}" is not a valid ${expectedKind} action from stage "${execution.state.stage}".`);
        }
        const contextCommand = envelope.origin === "signal" ? (() => {
          const { actorId: _callerActorId, ...commandWithoutCallerIdentity } = envelope.command;
          return commandWithoutCallerIdentity;
        })() : envelope.command;
        const context = await activities.resolveActionContext({
          workflowId: (0, import_workflow.workflowInfo)().workflowId,
          runId: (0, import_workflow.workflowInfo)().runId,
          operationId: envelope.operationId,
          origin: envelope.origin,
          definition: definitionIdentity,
          subject: input.subject,
          state: execution.state,
          command: contextCommand
        });
        if (context.priorResult) {
          execution.state = context.priorResult.state;
          envelope.completion?.resolve(adaptedView());
          continue;
        }
        if ((envelope.origin === "human" || envelope.origin === "signal") && (!context.actor || context.actor.organizationId !== input.subject.organizationId)) {
          throw new Error("Actor organization does not match the workflow subject organization.");
        }
        const command = (envelope.origin === "human" || envelope.origin === "signal") && context.actor ? { ...envelope.command, actorId: context.actor.id } : envelope.command;
        const outcome = (0, import_flowkit_core3.transition)(definition, execution.state, command, {
          actor: context.actor,
          facts: context.facts,
          subject: input.subject.metadata,
          policies: config.registries.policies,
          guards: config.registries.guards
        });
        const notifications = [
          ...normalizeNotifications(action.notify),
          ...normalizeNotifications(definition.stages[outcome.state.stage]?.entryNotify)
        ];
        const projected = await activities.recordTransition({
          workflowId: (0, import_workflow.workflowInfo)().workflowId,
          runId: (0, import_workflow.workflowInfo)().runId,
          operationId: envelope.operationId,
          sequence: execution.sequence + 1,
          origin: envelope.origin,
          definition: definitionIdentity,
          subject: input.subject,
          command,
          previousState: execution.state,
          nextState: outcome.state,
          transition: outcome.transition,
          notify: notifications[0],
          notifications
        });
        execution.state = projected.state;
        execution.sequence += 1;
        execution.entryEpoch += 1;
        execution.completed = definition.stages[execution.state.stage]?.final === true;
        if (!execution.completed) {
          const completionTransferred = await runEntry("transition", outcome.transition, envelope.completion);
          await armSla();
          if (!completionTransferred) envelope.completion?.resolve(adaptedView());
        } else {
          envelope.completion?.resolve(adaptedView());
        }
        if (commands.length === 0) automaticTransitions = 0;
      } catch (error) {
        if (!envelope.completion && error instanceof import_workflow.ApplicationFailure && error.type === "FLOWKIT_AUTOMATIC_LOOP") {
          throw error;
        }
        envelope.completion?.reject(error instanceof import_workflow.ApplicationFailure ? error : commandFailure(error));
      }
      if (!execution.completed && commands.length === 0 && ((0, import_workflow.workflowInfo)().continueAsNewSuggested || !input.resume && config.shouldContinueAsNew?.() === true)) {
        draining = true;
        await (0, import_workflow.condition)(import_workflow.allHandlersFinished);
        return await (0, import_workflow.continueAsNew)({
          published: input.published,
          subject: input.subject,
          initialState: input.initialState,
          resume: { execution }
        });
      }
    }
    draining = true;
    await (0, import_workflow.condition)(import_workflow.allHandlersFinished);
    return adaptedView();
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createFlowkitWorkflow
});
