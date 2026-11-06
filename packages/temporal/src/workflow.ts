import {
  allHandlersFinished,
  ApplicationFailure,
  CancellationScope,
  condition,
  continueAsNew,
  currentUpdateInfo,
  defineQuery,
  defineUpdate,
  isCancellation,
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
} from '@teopeurt/flowkit-core';
import type { FlowCommand, FlowState, NotificationBinding, StepDef } from '@teopeurt/flowkit-core';

import { FLOWKIT_ORCHESTRATION_DEFAULTS, FLOWKIT_ORCHESTRATION_HARD_LIMIT } from './contracts';
import type {
  CommandEnvelope,
  FlowkitActivityRegistry,
  FlowkitExecutionState,
  FlowkitOrchestrationActivities,
  FlowkitOrchestratorRegistration,
  OrchestrationTask,
  OrchestrationTaskResult,
  FlowkitPureRegistries,
  FlowkitNotificationBinding,
  FlowkitSignalCommand,
  FlowkitStateView,
  FlowkitWorkflowInput,
  EntryReason,
} from './contracts';
import type { TransitionRecord } from '@teopeurt/flowkit-core';
import { verifyPublishedDefinition } from './snapshot';
import { parseSlaDuration } from './validation';

const isFactsObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** UTF-8 byte length without TextEncoder, which the deterministic workflow sandbox may not provide. */
const utf8Length = (text: string): number => {
  let bytes = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
};

const resolveOrchestrationLimits = (registration: FlowkitOrchestratorRegistration) => ({
  maxTasks: Math.min(registration.maxTasks ?? FLOWKIT_ORCHESTRATION_DEFAULTS.maxTasks, FLOWKIT_ORCHESTRATION_HARD_LIMIT),
  maxConcurrency: Math.min(registration.maxConcurrency ?? FLOWKIT_ORCHESTRATION_DEFAULTS.maxConcurrency, FLOWKIT_ORCHESTRATION_HARD_LIMIT),
  failFast: registration.failFast ?? FLOWKIT_ORCHESTRATION_DEFAULTS.failFast,
  maxOutputBytes: registration.maxOutputBytes ?? FLOWKIT_ORCHESTRATION_DEFAULTS.maxOutputBytes,
});

/** Why a plan cannot be run, or undefined when it is acceptable. */
const planProblem = (
  tasks: unknown,
  registration: FlowkitOrchestratorRegistration,
  maxTasks: number,
): string | undefined => {
  if (!Array.isArray(tasks)) return 'plan did not return a task list';
  if (tasks.length > maxTasks) return `plan has ${tasks.length} tasks, more than the limit of ${maxTasks}`;
  const seen = new Set<string>();
  for (const task of tasks as OrchestrationTask[]) {
    if (task === null || typeof task !== 'object' || typeof task.id !== 'string' || task.id === '') return 'plan task has no id';
    if (seen.has(task.id)) return `plan repeats task id "${task.id}"`;
    seen.add(task.id);
    if (typeof task.agent !== 'string' || !registration.agents.includes(task.agent)) return `plan names unknown agent "${String(task.agent)}"`;
  }
  return undefined;
};

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
    /** In-flight orchestrations. They never cross Continue-As-New: it is deferred until this is empty. */
    const orchestrations = new Map<string, { epoch: number; scope: CancellationScope; settled: Promise<void> }>();
    const orchestrationActivityProxies = new Map<string, FlowkitOrchestrationActivities>();

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

    const cancelStaleOrchestrations = () => {
      for (const orchestration of orchestrations.values()) {
        if (orchestration.epoch !== execution.entryEpoch) orchestration.scope.cancel();
      }
    };

    const orchestrationActivities = (ref: string, registration: FlowkitOrchestratorRegistration): FlowkitOrchestrationActivities => {
      let proxy = orchestrationActivityProxies.get(ref);
      if (!proxy) {
        proxy = proxyActivities<FlowkitOrchestrationActivities>({
          taskQueue: config.activityTaskQueue,
          startToCloseTimeout: '1 minute',
          ...(config.activityOptions ?? {}),
          ...(registration.activityOptions ?? {}),
        });
        orchestrationActivityProxies.set(ref, proxy);
      }
      return proxy;
    };

    /**
     * Runs one orchestration in the background: plan, bounded parallel subagents, synthesize. It never
     * transitions state itself. At most it enqueues one rule-origin command, and only while its stage
     * is still current. Anything unexpected degrades the step so a human decides.
     */
    const runOrchestration = async (args: {
      key: string;
      epoch: number;
      index: number;
      step: StepDef;
      registration: FlowkitOrchestratorRegistration;
      baseFacts: Record<string, unknown>;
      reason: EntryReason;
      priorTransition?: TransitionRecord;
    }): Promise<void> => {
      const { key, epoch, index, step, registration, baseFacts, reason, priorTransition } = args;
      const limits = resolveOrchestrationLimits(registration);
      const acts = orchestrationActivities(step.ref, registration);
      const startState = execution.state;
      const stale = () => execution.entryEpoch !== epoch;
      const result = execution.stepResults[key];
      const workflowId = workflowInfo().workflowId;
      const identity = (...phase: string[]) => ({
        workflowId,
        ref: step.ref,
        definition: definitionIdentity,
        subject: input.subject,
        state: startState,
        entryEpoch: epoch,
        stepIndex: index,
        idempotencyKey: JSON.stringify([workflowId, epoch, index, ...phase]),
        entryReason: reason,
        priorTransition,
      });
      const setTask = (id: string, status: 'running' | 'completed' | 'failed' | 'cancelled', outputRef?: string) => {
        const task = result.tasks?.find((candidate) => candidate.id === id);
        if (task) {
          task.status = status;
          if (outputRef !== undefined) task.outputRef = outputRef;
        }
      };
      const supersede = () => {
        result.status = 'superseded';
        for (const task of result.tasks ?? []) {
          if (task.status === 'pending' || task.status === 'running') task.status = 'cancelled';
        }
      };
      const degrade = () => {
        result.status = 'degraded_to_human';
      };

      try {
        const plan = await acts.planOrchestration(identity('plan'));
        if (stale()) return supersede();
        const problem = planProblem(plan?.tasks, registration, limits.maxTasks);
        if (problem !== undefined) return degrade();
        const tasks = plan.tasks;
        result.tasks = tasks.map((task) => ({ id: task.id, agent: task.agent, status: 'pending' as const }));

        const results = new Map<string, OrchestrationTaskResult>();
        const queue = [...tasks];
        const fanOut = new CancellationScope();
        let stopLaunching = false;
        const runTask = async (task: OrchestrationTask) => {
          setTask(task.id, 'running');
          try {
            const output = await acts.runSubagent({ ...identity('task', task.id), taskId: task.id, agent: task.agent, input: task.input });
            results.set(task.id, { id: task.id, agent: task.agent, status: 'completed', output: output?.output, outputRef: output?.outputRef });
            setTask(task.id, 'completed', output?.outputRef);
          } catch (error) {
            if (isCancellation(error)) {
              results.set(task.id, { id: task.id, agent: task.agent, status: 'cancelled' });
              setTask(task.id, 'cancelled');
            } else {
              results.set(task.id, { id: task.id, agent: task.agent, status: 'failed', error: error instanceof Error ? error.message : 'Subagent failed.' });
              setTask(task.id, 'failed');
              if (limits.failFast) {
                stopLaunching = true;
                fanOut.cancel();
              }
            }
          }
        };
        const worker = async () => {
          while (!stopLaunching && !stale()) {
            const task = queue.shift();
            if (!task) return;
            await runTask(task);
          }
        };
        await fanOut.run(() => Promise.all(Array.from({ length: Math.min(limits.maxConcurrency, tasks.length) }, () => worker())));
        if (stale()) return supersede();

        const ordered: OrchestrationTaskResult[] = tasks.map((task) => results.get(task.id) ?? { id: task.id, agent: task.agent, status: 'cancelled' as const });
        for (const task of ordered) {
          if (task.status === 'cancelled') setTask(task.id, 'cancelled');
        }

        const synthesized = await acts.synthesizeOrchestration({ ...identity('synthesize'), results: ordered });
        if (stale()) return supersede();
        const output = synthesized?.output;
        if (output !== undefined && utf8Length(JSON.stringify(output)) > limits.maxOutputBytes) return degrade();

        result.status = 'completed';
        result.output = output;
        if (step.gate !== 'auto' || step.decide === undefined) return;

        // Fail closed: a missing rule, a throw, no answer, or an exhausted loop budget all leave the stage to a human.
        let action: string | undefined;
        try {
          const decider = Object.hasOwn(config.registries.rules ?? {}, step.decide) ? config.registries.rules?.[step.decide] : undefined;
          action = decider?.run({
            definition,
            state: startState,
            subject: input.subject.metadata ?? {},
            facts: { ...baseFacts, ...(isFactsObject(output) ? output : {}) },
            priorTransition,
            gatedOutput: output,
            tasks: ordered.map(({ id, agent, status }) => ({ id, agent, status })),
          });
        } catch {
          action = undefined;
        }
        if (action && automaticTransitions < (config.maxAutomaticTransitionsPerTurn ?? 32)) {
          automaticTransitions += 1;
          result.gateDecision = { outcome: 'auto', action };
          commands.push({ operationId: `orch:${epoch}:${index}`, origin: 'rule', command: { action, actorId: 'system' } });
        } else {
          result.gateDecision = { outcome: 'human' };
        }
      } catch (error) {
        if (isCancellation(error) || stale()) supersede();
        else degrade();
      }
    };

    const startOrchestration = (args: Parameters<typeof runOrchestration>[0]) => {
      const scope = new CancellationScope();
      const settled = scope.run(() => runOrchestration(args)).then(() => undefined, () => undefined);
      orchestrations.set(args.key, { epoch: args.epoch, scope, settled });
      void settled.then(() => orchestrations.delete(args.key));
    };

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
            if (step.gate === 'auto' && step.decide !== undefined) {
              // Fail closed: a missing rule, a throw, or no answer all leave the stage waiting on a human.
              let action: string | undefined;
              try {
                const decider = Object.hasOwn(config.registries.rules ?? {}, step.decide) ? config.registries.rules?.[step.decide] : undefined;
                action = decider?.run({ definition, state: execution.state, subject: input.subject.metadata ?? {}, facts: entryFacts, priorTransition, gatedOutput: result.output });
              } catch {
                action = undefined;
              }
              if (action) {
                if (automaticTransitions >= (config.maxAutomaticTransitionsPerTurn ?? 32)) {
                  throw ApplicationFailure.nonRetryable('Automatic transition limit exceeded.', 'FLOWKIT_AUTOMATIC_LOOP');
                }
                automaticTransitions += 1;
                execution.stepResults[key].gateDecision = { outcome: 'auto', action };
                automaticCommands.push({ operationId: `gate:${execution.entryEpoch}:${index}`, origin: 'rule', command: { action, actorId: 'system' } });
              } else {
                execution.stepResults[key].gateDecision = { outcome: 'human' };
              }
            }
          } catch (error) {
            if (error instanceof ApplicationFailure && error.type === 'FLOWKIT_AUTOMATIC_LOOP') throw error;
            execution.stepResults[key] = { ref: step.ref, kind: 'ai', status: 'degraded_to_human', entryEpoch: execution.entryEpoch };
          }
          continue;
        }

        if (step.kind === 'orchestrate') {
          const registration = Object.hasOwn(config.registries.orchestrators ?? {}, step.ref) ? config.registries.orchestrators?.[step.ref] : undefined;
          if (!registration) {
            execution.stepResults[key] = { ref: step.ref, kind: 'orchestrate', status: 'degraded_to_human', entryEpoch: execution.entryEpoch };
            continue;
          }
          // Started in the background so the stage returns to the command loop at once: humans, signals and the SLA stay live.
          execution.stepResults[key] = { ref: step.ref, kind: 'orchestrate', status: 'running', entryEpoch: execution.entryEpoch, tasks: [] };
          startOrchestration({ key, epoch: execution.entryEpoch, index, step, registration, baseFacts: { ...entryFacts }, reason, priorTransition });
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
        cancelStaleOrchestrations();
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

      const wantsContinueAsNew = !execution.completed &&
        commands.length === 0 &&
        (workflowInfo().continueAsNewSuggested || (!input.resume && config.shouldContinueAsNew?.() === true));
      if (wantsContinueAsNew) {
        // Orchestrations cancelled by the transition that just ran settle promptly; wait for them rather than
        // deferring for nothing. One still running for the current stage defers Continue-As-New (it cannot cross runs).
        await Promise.all([...orchestrations.values()].filter((orchestration) => orchestration.epoch !== execution.entryEpoch).map((orchestration) => orchestration.settled));
      }
      if (wantsContinueAsNew && orchestrations.size === 0 && commands.length === 0 && !execution.completed) {
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

    await Promise.all([...orchestrations.values()].map((orchestration) => orchestration.settled));
    draining = true;
    await condition(allHandlersFinished);
    return adaptedView();
  };
}
