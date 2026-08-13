import {
  parseSlaDuration,
  verifyPublishedDefinition
} from "./chunk-PDJX3YVH.js";

// src/workflow.ts
import {
  allHandlersFinished,
  ApplicationFailure,
  condition,
  continueAsNew,
  currentUpdateInfo,
  defineQuery,
  defineUpdate,
  proxyActivities,
  setHandler,
  Trigger,
  workflowInfo
} from "@temporalio/workflow";
import {
  buildInitialState,
  getDeclaredActions,
  transition
} from "@naakwu/flowkit-core";
var stateView = (execution, definition) => ({
  state: execution.state,
  sequence: execution.sequence,
  stepResults: execution.stepResults,
  slaDeadline: execution.slaDeadline,
  completed: execution.completed,
  nextActions: execution.completed ? [] : getDeclaredActions(definition, execution.state.stage)
});
var initialExecution = (input) => input.resume?.execution ?? {
  state: input.initialState ?? buildInitialState(input.published.definitionSnapshot),
  sequence: 0,
  entryEpoch: 0,
  stepResults: {},
  completedInitialEntry: false,
  completed: false
};
var commandFailure = (error) => ApplicationFailure.nonRetryable(
  error instanceof Error ? error.message : "Flowkit command was rejected.",
  "FLOWKIT_COMMAND_REJECTED"
);
function createFlowkitWorkflow(config) {
  const query = defineQuery(config.queryName ?? "getState");
  const update = defineUpdate(config.updateName ?? "applyAction");
  const activities = proxyActivities({
    taskQueue: config.activityTaskQueue,
    startToCloseTimeout: "1 minute",
    ...config.activityOptions ?? {}
  });
  const aiActivities = proxyActivities({
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
    setHandler(query, adaptedView);
    setHandler(update, async (command) => {
      const updateId = currentUpdateInfo()?.id;
      if (!updateId) {
        throw ApplicationFailure.nonRetryable("A stable Temporal Update ID is required.", "FLOWKIT_MISSING_UPDATE_ID");
      }
      if (draining) {
        throw ApplicationFailure.nonRetryable("Workflow is draining.", "FLOWKIT_DRAINING");
      }
      const completion = new Trigger();
      commands.push({ operationId: updateId, origin: "human", command, completion });
      return await completion;
    });
    const runEntry = async (reason, priorTransition) => {
      if (definition.stages[execution.state.stage]?.final) {
        execution.completed = true;
        return;
      }
      for (const [index, step] of (definition.stages[execution.state.stage]?.entry ?? []).entries()) {
        const key = `${execution.entryEpoch}:${index}`;
        if (step.kind === "system") {
          const result = await activities.executeSystemStep({ ref: step.ref, definition: definitionIdentity, subject: input.subject, state: execution.state, entryEpoch: execution.entryEpoch, entryReason: reason, priorTransition });
          execution.stepResults[key] = { ref: step.ref, kind: "system", status: "completed", entryEpoch: execution.entryEpoch, output: result.output };
          continue;
        }
        if (step.kind === "ai") {
          try {
            const result = await aiActivities.executeAiStep({ ref: step.ref, definition: definitionIdentity, subject: input.subject, state: execution.state, entryEpoch: execution.entryEpoch, entryReason: reason, priorTransition });
            execution.stepResults[key] = { ref: step.ref, kind: "ai", status: "completed", entryEpoch: execution.entryEpoch, output: result.output };
          } catch {
            execution.stepResults[key] = { ref: step.ref, kind: "ai", status: "degraded_to_human", entryEpoch: execution.entryEpoch };
          }
          continue;
        }
        const action = config.registries.rules?.[step.ref]?.run({ definition, state: execution.state, subject: input.subject.metadata ?? {}, facts: {}, priorTransition });
        if (action) {
          if (automaticTransitions >= (config.maxAutomaticTransitionsPerTurn ?? 32)) {
            throw ApplicationFailure.nonRetryable("Automatic transition limit exceeded.", "FLOWKIT_AUTOMATIC_LOOP");
          }
          automaticTransitions += 1;
          commands.push({ operationId: `rule:${execution.entryEpoch}:${index}`, origin: "rule", command: { action, actorId: "system" } });
        }
      }
    };
    const armSla = async () => {
      const sla = definition.stages[execution.state.stage]?.sla;
      if (!sla) {
        execution.slaDeadline = void 0;
        return;
      }
      const duration = parseSlaDuration(sla.after);
      if (duration === void 0) {
        throw ApplicationFailure.nonRetryable(`Invalid SLA duration "${sla.after}".`, "FLOWKIT_INVALID_SLA");
      }
      execution.slaDeadline = Date.now() + duration;
      await activities.recordStageReady({ workflowId: workflowInfo().workflowId, definition: definitionIdentity, subject: input.subject, state: execution.state, entryEpoch: execution.entryEpoch, slaDeadline: execution.slaDeadline });
    };
    if (!execution.completedInitialEntry) {
      await runEntry("initial");
      execution.completedInitialEntry = true;
      await armSla();
    }
    while (!execution.completed) {
      const receivedCommand = execution.slaDeadline === void 0 ? (await condition(() => commands.length > 0), true) : await condition(() => commands.length > 0, Math.max(1, execution.slaDeadline - Date.now()));
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
        const stage = definition.stages[execution.state.stage];
        const action = stage?.actions?.[envelope.command.action];
        const expectedKind = envelope.origin === "human" ? "human" : "system";
        if (!action || (action.kind ?? "human") !== expectedKind) {
          throw new Error(`Action "${envelope.command.action}" is not a valid ${expectedKind} action from stage "${execution.state.stage}".`);
        }
        const context = await activities.resolveActionContext({
          workflowId: workflowInfo().workflowId,
          runId: workflowInfo().runId,
          operationId: envelope.operationId,
          origin: envelope.origin,
          definition: definitionIdentity,
          subject: input.subject,
          state: execution.state,
          command: envelope.command
        });
        if (context.priorResult) {
          execution.state = context.priorResult.state;
          envelope.completion?.resolve(adaptedView());
          continue;
        }
        const command = envelope.origin === "human" && context.actor ? { ...envelope.command, actorId: context.actor.id } : envelope.command;
        const outcome = transition(definition, execution.state, command, {
          actor: context.actor,
          facts: context.facts,
          subject: input.subject.metadata,
          policies: config.registries.policies,
          guards: config.registries.guards
        });
        const projected = await activities.recordTransition({
          workflowId: workflowInfo().workflowId,
          runId: workflowInfo().runId,
          operationId: envelope.operationId,
          sequence: execution.sequence + 1,
          origin: envelope.origin,
          definition: definitionIdentity,
          subject: input.subject,
          command,
          previousState: execution.state,
          nextState: outcome.state,
          transition: outcome.transition,
          notify: action.notify
        });
        execution.state = projected.state;
        execution.sequence += 1;
        execution.entryEpoch += 1;
        execution.completed = definition.stages[execution.state.stage]?.final === true;
        if (!execution.completed) {
          await runEntry("transition", outcome.transition);
          await armSla();
        }
        envelope.completion?.resolve(adaptedView());
        if (commands.length === 0) automaticTransitions = 0;
      } catch (error) {
        if (!envelope.completion && error instanceof ApplicationFailure && error.type === "FLOWKIT_AUTOMATIC_LOOP") {
          throw error;
        }
        envelope.completion?.reject(error instanceof ApplicationFailure ? error : commandFailure(error));
      }
      if (!execution.completed && commands.length === 0 && (workflowInfo().continueAsNewSuggested || !input.resume && config.shouldContinueAsNew?.() === true)) {
        draining = true;
        await condition(allHandlersFinished);
        return await continueAsNew({
          published: input.published,
          subject: input.subject,
          initialState: input.initialState,
          resume: { execution }
        });
      }
    }
    draining = true;
    await condition(allHandlersFinished);
    return adaptedView();
  };
}
export {
  createFlowkitWorkflow
};
