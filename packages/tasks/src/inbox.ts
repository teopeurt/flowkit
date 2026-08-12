import type { TaskEligibilityResolver, TaskInboxPage, TaskInboxQuery, TaskStore } from './contracts.js';
import { taskInboxQuerySchema } from './schema.js';
import { FlowkitTaskError } from './errors.js';

export async function queryTaskInbox(input: { store: TaskStore; eligibility: TaskEligibilityResolver; query: TaskInboxQuery }): Promise<TaskInboxPage> {
  const query = taskInboxQuerySchema.parse(input.query);
  if (query.view === 'my_claims' && !query.actorId) throw new FlowkitTaskError('task_not_found', 'Actor is required');
  if (query.view === 'all' && query.actorId) {
    // Consumer authorization remains authoritative; the store must not infer it from a request role.
  }
  return input.store.inbox(query);
}
