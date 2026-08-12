import type { TaskClaimCommand, TaskEligibilityResolver, TaskReleaseCommand, TaskReassignCommand, TaskStore } from './contracts.js';
import { FlowkitTaskError } from './errors.js';

export async function claimTask(input: { store: TaskStore; eligibility: TaskEligibilityResolver; command: TaskClaimCommand }): Promise<Awaited<ReturnType<TaskStore['claim']>>['task']> {
  const task = await input.store.get(input.command.taskId);
  if (!task) throw new FlowkitTaskError('task_not_found', 'Task not found');
  if (!(await input.eligibility.canWorkRole({ actorId: input.command.actorId, role: task.role, task }))) throw new FlowkitTaskError('task_role_ineligible', 'Actor is not eligible for this role');
  const result = await input.store.claim(input.command);
  if (!result.task) throw new FlowkitTaskError(result.reason === 'not_claimable' ? 'task_not_claimable' : result.reason === 'conflict' ? 'task_claim_conflict' : 'task_not_found', 'Task claim was not accepted');
  return result.task;
}

export async function releaseTask(input: { store: TaskStore; command: TaskReleaseCommand }): Promise<NonNullable<Awaited<ReturnType<TaskStore['release']>>['task']>> {
  if (!input.command.reason.trim()) throw new FlowkitTaskError('task_not_owned', 'A release reason is required');
  const result = await input.store.release(input.command);
  if (!result.task) throw new FlowkitTaskError(result.reason === 'not_owned' ? 'task_not_owned' : result.reason === 'conflict' ? 'stale_task_revision' : 'task_not_found', 'Task release was not accepted');
  return result.task;
}

export async function reassignTask(input: { store: TaskStore; eligibility: TaskEligibilityResolver; command: TaskReassignCommand }): Promise<NonNullable<Awaited<ReturnType<TaskStore['reassign']>>['task']>> {
  const task = await input.store.get(input.command.taskId);
  if (!task) throw new FlowkitTaskError('task_not_found', 'Task not found');
  if (!(await input.eligibility.canAdminister?.({ actorId: input.command.actorId, task })) ) throw new FlowkitTaskError('task_not_owned', 'Actor cannot reassign this task');
  if (!(await input.eligibility.canWorkRole({ actorId: input.command.targetActorId, role: task.role, task }))) throw new FlowkitTaskError('task_role_ineligible', 'Target actor is not eligible');
  const result = await input.store.reassign(input.command);
  if (!result.task) throw new FlowkitTaskError(result.reason === 'conflict' ? 'stale_task_revision' : 'task_not_found', 'Task reassignment was not accepted');
  return result.task;
}
