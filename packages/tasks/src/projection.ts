import type { FlowDefinition } from '@naakwu/flowkit-core';
import type { FlowTask, TaskMutation, TaskProjectionInput, TaskProjectionPlan, TaskReference } from './contracts.js';

function reference(input: TaskProjectionInput, stage: string, role: string): TaskReference {
  return { namespace: input.namespace, flowId: input.flowId, subjectType: input.subject.type, subjectId: input.subject.id, stage, role };
}

function mutation(kind: TaskMutation['kind'], ref: TaskReference, input: TaskProjectionInput, epoch: number): TaskMutation {
  return { kind, reference: ref, operationId: input.operationId, transitionSequence: input.transitionSequence, actorId: input.actorId, action: input.action, lifecycleEpoch: epoch, dueAt: input.dueAt ?? null, metadata: input.metadata ?? {} };
}

export function planTaskProjection(input: TaskProjectionInput, current: FlowTask | null, priorOperationIds: string[] = []): TaskProjectionPlan {
  if (priorOperationIds.includes(input.operationId)) return { operationId: input.operationId, mutations: [], events: [] };
  const mutations: TaskMutation[] = [];
  const events: TaskProjectionPlan['events'] = [];
  const previousRole = input.previousState.pendingRole;
  const nextRole = input.nextState.pendingRole;
  const previousRef = previousRole ? reference(input, input.previousState.stage, previousRole) : null;
  const nextRef = nextRole ? reference(input, input.nextState.stage, nextRole) : null;
  if (previousRef && current && current.stage === previousRef.stage && current.role === previousRef.role && current.status !== 'completed') {
    mutations.push(mutation('complete', previousRef, input, current.lifecycleEpoch));
    events.push({ eventType: 'completed', operationId: input.operationId, transitionSequence: input.transitionSequence, actorId: input.actorId, action: input.action, lifecycleEpoch: current.lifecycleEpoch, metadata: input.metadata ?? {} });
  }
  if (nextRef) {
    const sameLogicalTask = previousRef && previousRef.stage === nextRef.stage && previousRef.role === nextRef.role;
    const epoch = sameLogicalTask ? (current?.lifecycleEpoch ?? 0) + 1 : 0;
    mutations.push(mutation(sameLogicalTask ? 'reopen' : 'open', nextRef, input, epoch));
    events.push({ eventType: sameLogicalTask ? 'reopened' : 'opened', operationId: input.operationId, transitionSequence: input.transitionSequence, actorId: input.actorId, action: input.action, lifecycleEpoch: epoch, metadata: input.metadata ?? {} });
  }
  return { operationId: input.operationId, mutations, events };
}

export function stageReadyIntent(input: { taskId: string; stage: string; lifecycleEpoch: number; dueAt: string; operationId: string }): { taskId: string; stage: string; lifecycleEpoch: number; dueAt: string; operationId: string } { return { ...input }; }

export function humanTaskForStage(definition: FlowDefinition, stage: string): { stage: string; role: string } | null {
  const role = definition.stages[stage]?.pendingRole;
  return role ? { stage, role } : null;
}
