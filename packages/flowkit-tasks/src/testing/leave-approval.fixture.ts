import type { FlowDefinition } from '@flowkit/core';
import { MemoryTaskStore } from './memory-task-store.js';
import { planTaskProjection } from '../projection.js';

export const leaveApprovalDefinition: FlowDefinition = { id: 'leave-approval', version: 1, roles: ['employee', 'manager', 'hr'], initialStage: 'employee', stages: { employee: { pendingRole: 'employee', actions: { submit: { to: 'manager', kind: 'human' } } }, manager: { pendingRole: 'manager', actions: { approve: { to: 'hr', kind: 'human' }, return: { to: 'employee', kind: 'human' } } }, hr: { pendingRole: 'hr', final: true, actions: { approve: { to: 'done', kind: 'human' } } }, done: { final: true } } };
export function createLeaveApprovalFixture() { return new MemoryTaskStore(); }
export function leaveTransitionPlan(input: { store: MemoryTaskStore; operationId: string; previousStage: string; previousRole: string | null; nextStage: string; nextRole: string | null; actorId: string | null; action: string; sequence: number }) {
  const current = input.previousRole ? [...input.store.tasks.values()].find((task) => task.stage === input.previousStage && task.role === input.previousRole) ?? null : null;
  return planTaskProjection({ namespace: 'fixture', flowId: 'leave-1', subject: { type: 'leave', id: 'leave-1' }, definition: leaveApprovalDefinition, operationId: input.operationId, transitionSequence: input.sequence, action: input.action, actorId: input.actorId, previousState: { stage: input.previousStage, status: 'active', pendingRole: input.previousRole, tracks: {} }, nextState: { stage: input.nextStage, status: 'active', pendingRole: input.nextRole, tracks: {} } }, current);
}
