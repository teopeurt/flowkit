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
  workflowInfo,
} from '@temporalio/workflow';
import {
  buildInitialState,
  getActionDefinition,
  getDeclaredActions,
  transition,
} from '@naakwu/flowkit-core';
import type { FlowCommand, FlowState, NotificationBinding } from '@naakwu/flowkit-core';

import type {
  CommandEnvelope,
  FlowkitActivityRegistry,
  FlowkitExecutionState,
  FlowkitPureRegistries,
  FlowkitNotificationBinding,
  FlowkitSignalCommand,
  FlowkitStateView,
  FlowkitWorkflowInput,
  EntryReason,
} from './contracts';
import type { TransitionRecord } from '@naakwu/flowkit-core';
import { verifyPublishedDefinition } from './snapshot';
import { parseSlaDuration } from './validation';

const isFactsObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeNotifications = (
  binding: NotificationBinding | undefined,
): FlowkitNotificationBinding[] =>
  binding === undefined ? [] : Array.isArray(binding) ? binding : [binding];

export interface FlowkitWorkflowConfig {
  registries: FlowkitPureRegistries;
  /**
   * Omit to run activities on the workflow's own task queue. A workflow module is imported inside
   * the deterministic sandbox, where `process` does not exist, so a consumer that has to read this
   * from the environment cannot configure it here.
   */
  activityTaskQueue?: string;
  activityOptions?: Parameters<typeof proxyActivities>[0];
  queryName?: string;
  updateName?: string;
  maxAutomaticTransitionsPerTurn?: number;
  shouldContinueAsNew?: () => boolean;
  adaptState?: (args: { state: FlowkitStateView; input: FlowkitWorkflowInput }) => unknown;
}

export type FlowkitWorkflow = (input: FlowkitWorkflowInput) => Promise<unknown>;

const stateView = (execution: FlowkitExecutionState, definition: FlowkitWorkflowInput['published']['definitionSnapshot']): FlowkitStateView => ({
  state: execution.state,
  sequence: execution.sequence,
  stepResults: execution.stepResults,
  slaDeadline: execution.slaDeadline,
  completed: execution.completed,
  nextActions: execution.completed ? [] : getDeclaredActions(definition, execution.state.stage),
});

const initialExecution = (input: FlowkitWorkflowInput): FlowkitExecutionState => input.resume?.execution ?? {
  state: input.initialState ?? buildInitialState(input.published.definitionSnapshot),
  sequence: 0,
  entryEpoch: 0,
  stepResults: {},
  completedInitialEntry: false,
  completed: false,
};

const commandFailure = (error: unknown): ApplicationFailure => ApplicationFailure.nonRetryable(
  error instanceof Error ? error.message : 'Flowkit command was rejected.',
  'FLOWKIT_COMMAND_REJECTED',
);

/**
 * Creates a deterministic workflow interpreter. Definitions remain execution
 * input so replay never reads a mutable definition registry.
 */
export function createFlowkitWorkflow(config: FlowkitWorkflowConfig): FlowkitWorkflow {
  const query = defineQuery<FlowkitStateView>(config.queryName ?? 'getState');
  const update = defineUpdate<FlowkitStateView, [FlowCommand]>(config.updateName ?? 'applyAction');
  const signalUpdate = defineUpdate<FlowkitStateView, [FlowkitSignalCommand]>('applySignal');
  const activities = proxyActivities<FlowkitActivityRegistry>({
    taskQueue: config.activityTaskQueue,
    startToCloseTimeout: '1 minute',
    ...(config.activityOptions ?? {}),
  });
  const aiActivities = proxyActivities<Pick<FlowkitActivityRegistry, 'executeAiStep'>>({
    taskQueue: config.activityTaskQueue,
    startToCloseTimeout: '1 minute',
    retry: { maximumAttempts: 3 },
    ...(config.activityOptions ?? {}),
  });

  return async (input) => {
    verifyPublishedDefinition(input.published);

    const definition = input.published.definitionSnapshot;
    const definitionIdentity = {
      id: definition.id,
      version: definition.version,
      hash: input.published.definitionHash,
    };
    const execution = initialExecution(input);
    const commands: Array<CommandEnvelope & { completion?: Trigger<FlowkitStateView> }> = [];
    let draining = false;
    let automaticTransitions = 0;

    const view = () => stateView(execution, definition);
    const adaptedView = () =>
      (config.adaptState?.({ state: view(), input }) ?? view()) as FlowkitStateView;

    setHandler(query, adaptedView);
    const enqueueUpdate = async (origin: 'human' | 'signal', command: FlowCommand) => {
      const updateId = currentUpdateInfo()?.id;

      if (!updateId) {
        throw ApplicationFailure.nonRetryable('A stable Temporal Update ID is required.', 'FLOWKIT_MISSING_UPDATE_ID');
      }

      if (draining) {
        throw ApplicationFailure.nonRetryable('Workflow is draining.', 'FLOWKIT_DRAINING');
      }

      const completion = new Trigger<FlowkitStateView>();
      commands.push({ operationId: updateId, origin, command, completion });
      return await completion;
    };
    setHandler(update, (command) => enqueueUpdate('human', command));
    setHandler(signalUpdate, (command) => enqueueUpdate('signal', command));

    const runEntry = async (
      reason: EntryReason,
      priorTransition?: TransitionRecord,
      completion?: Trigger<FlowkitStateView>,
    ): Promise<boolean> => {
      if (definition.stages[execution.state.stage]?.final) {
        execution.completed = true;
        return false;
      }

      const entryFacts: Record<string, unknown> = {};
      const automaticCommands: Array<CommandEnvelope & { completion?: Trigger<FlowkitStateView> }> = [];
      for (const [index, step] of (definition.stages[execution.state.stage]?.entry ?? []).entries()) {
        const key = `${execution.entryEpoch}:${index}`;
        const stepIdentity = {
          workflowId: workflowInfo().workflowId,
          stepIndex: index,
          idempotencyKey: JSON.stringify([
            workflowInfo().workflowId,
            execution.entryEpoch,
            index,
          ]),
        };
        if (step.kind === 'system') {
          const result = await activities.executeSystemStep({ ...stepIdentity, ref: step.ref, definition: definitionIdentity, subject: input.subject, state: execution.state, entryEpoch: execution.entryEpoch, entryReason: reason, priorTransition });
          execution.stepResults[key] = { ref: step.ref, kind: 'system', status: 'completed', entryEpoch: execution.entryEpoch, output: result.output };
          if (isFactsObject(result.output)) Object.assign(entryFacts, result.output);
          continue;
        }
        if (step.kind === 'ai') {
          try {
            const result = await aiActivities.executeAiStep({ ...stepIdentity, ref: step.ref, definition: definitionIdentity, subject: input.subject, state: execution.state, entryEpoch: execution.entryEpoch, entryReason: reason, priorTransition });
            execution.stepResults[key] = { ref: step.ref, kind: 'ai', status: 'completed', entryEpoch: execution.entryEpoch, output: result.output };
            if (isFactsObject(result.output)) Object.assign(entryFacts, result.output);
          } catch {
            execution.stepResults[key] = { ref: step.ref, kind: 'ai', status: 'degraded_to_human', entryEpoch: execution.entryEpoch };
          }
          continue;
        }

        // Own-property lookup only: `rules['constructor']` would otherwise resolve to an
        // inherited Object.prototype function, and calling `.run` on it fails the workflow task.
        const rule = Object.hasOwn(config.registries.rules ?? {}, step.ref) ? config.registries.rules?.[step.ref] : undefined;
        const action = rule?.run({ definition, state: execution.state, subject: input.subject.metadata ?? {}, facts: entryFacts, priorTransition });
        if (action) {
          if (automaticTransitions >= (config.maxAutomaticTransitionsPerTurn ?? 32)) {
            throw ApplicationFailure.nonRetryable('Automatic transition limit exceeded.', 'FLOWKIT_AUTOMATIC_LOOP');
          }
          automaticTransitions += 1;
          automaticCommands.push({ operationId: `rule:${execution.entryEpoch}:${index}`, origin: 'rule', command: { action, actorId: 'system' } });
        }
      }

      if (completion && automaticCommands.length > 0) {
        automaticCommands.at(-1)!.completion = completion;
      }
      commands.unshift(...automaticCommands);
      return automaticCommands.length > 0;
    };

    const armSla = async () => {
      const sla = definition.stages[execution.state.stage]?.sla;
      if (!sla) {
        execution.slaDeadline = undefined;
        return;
      }
      const duration = parseSlaDuration(sla.after);
      if (duration === undefined) {
        throw ApplicationFailure.nonRetryable(`Invalid SLA duration "${sla.after}".`, 'FLOWKIT_INVALID_SLA');
      }
      execution.slaDeadline = Date.now() + duration;
      await activities.recordStageReady({ workflowId: workflowInfo().workflowId, definition: definitionIdentity, subject: input.subject, state: execution.state, entryEpoch: execution.entryEpoch, slaDeadline: execution.slaDeadline });
    };

    if (!execution.completedInitialEntry) {
      await runEntry('initial');
      execution.completedInitialEntry = true;
      await armSla();
    }

    while (!execution.completed) {
      const receivedCommand = execution.slaDeadline === undefined
        ? (await condition(() => commands.length > 0), true)
        : await condition(() => commands.length > 0, Math.max(1, execution.slaDeadline - Date.now()));
      if (!receivedCommand) {
        const sla = definition.stages[execution.state.stage]?.sla;
        const deadline = execution.slaDeadline;
        execution.slaDeadline = undefined;
        if (sla?.escalate.notify) {
          try {
            await activities.dispatchNotification({ operationKey: `sla:${execution.entryEpoch}`, definition: definitionIdentity, subject: input.subject, notification: { template: sla.escalate.notify, channels: [] } });
          } catch {
            // Notification delivery is isolated from the workflow transition.
          }
        }
        if (sla?.escalate.action) {
          commands.push({ operationId: `sla:${execution.entryEpoch}`, origin: 'sla', command: { action: sla.escalate.action, actorId: 'system' } });
        }
        if (deadline === undefined) continue;
      }
      const envelope = commands.shift();

      if (!envelope) {
        continue;
      }

      try {
        const action = getActionDefinition(definition, execution.state.stage, envelope.command.action);

        const expectedKind = envelope.origin === 'human' ? 'human' : envelope.origin === 'signal' ? 'signal' : 'system';
        if (!action || (action.kind ?? 'human') !== expectedKind) {
          throw new Error(`Action "${envelope.command.action}" is not a valid ${expectedKind} action from stage "${execution.state.stage}".`);
        }

        const contextCommand = envelope.origin === 'signal'
          ? (() => {
            const { actorId: _callerActorId, ...commandWithoutCallerIdentity } = envelope.command;
            return commandWithoutCallerIdentity;
          })()
          : envelope.command;
        const context = await activities.resolveActionContext({
          workflowId: workflowInfo().workflowId,
          runId: workflowInfo().runId,
          operationId: envelope.operationId,
          origin: envelope.origin,
          definition: definitionIdentity,
          subject: input.subject,
          state: execution.state,
          command: contextCommand,
        });

        if (context.priorResult) {
          execution.state = context.priorResult.state;
          envelope.completion?.resolve(adaptedView());
          continue;
        }

        if (
          (envelope.origin === 'human' || envelope.origin === 'signal') &&
          (!context.actor || context.actor.organizationId !== input.subject.organizationId)
        ) {
          throw new Error('Actor organization does not match the workflow subject organization.');
        }

        const command = (envelope.origin === 'human' || envelope.origin === 'signal') && context.actor
          ? { ...envelope.command, actorId: context.actor.id }
          : envelope.command;

        const outcome = transition(definition, execution.state, command, {
          actor: context.actor,
          facts: context.facts,
          subject: input.subject.metadata,
          policies: config.registries.policies,
          guards: config.registries.guards,
        });
        const notifications = [
          ...normalizeNotifications(action.notify),
          ...normalizeNotifications(definition.stages[outcome.state.stage]?.entryNotify),
        ];
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
          notify: notifications[0],
          notifications,
        });

        execution.state = projected.state;
        execution.sequence += 1;
        execution.entryEpoch += 1;
        execution.completed = definition.stages[execution.state.stage]?.final === true;
        if (!execution.completed) {
          const completionTransferred = await runEntry('transition', outcome.transition, envelope.completion);
          await armSla();
          if (!completionTransferred) envelope.completion?.resolve(adaptedView());
        } else {
          envelope.completion?.resolve(adaptedView());
        }
        if (commands.length === 0) automaticTransitions = 0;
      } catch (error) {
        if (
          !envelope.completion &&
          error instanceof ApplicationFailure &&
          error.type === 'FLOWKIT_AUTOMATIC_LOOP'
        ) {
          throw error;
        }
        envelope.completion?.reject(error instanceof ApplicationFailure ? error : commandFailure(error));
      }

      if (
        !execution.completed &&
        commands.length === 0 &&
        (workflowInfo().continueAsNewSuggested || (!input.resume && config.shouldContinueAsNew?.() === true))
      ) {
        draining = true;
        await condition(allHandlersFinished);
        return await continueAsNew({
          published: input.published,
          subject: input.subject,
          initialState: input.initialState,
          resume: { execution },
        });
      }
    }

    draining = true;
    await condition(allHandlersFinished);
    return adaptedView();
  };
}
