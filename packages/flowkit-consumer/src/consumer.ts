import { claimTask, type FlowTask } from '@flowkit/tasks';

import type {
  ConsumerDependencies,
  FlowkitConsumer,
  FlowkitConsumerClaim,
} from './contracts.js';

function toClaimCommand(input: FlowkitConsumerClaim, actorId: string, now: string) {
  return {
    taskId: input.taskId,
    expectedRevision: input.expectedRevision,
    actorId,
    operationId: input.operationId,
    now,
  };
}

export function createFlowkitConsumer(deps: ConsumerDependencies): FlowkitConsumer {
  return {
    start: async (input) =>
      deps.views.read(
        await deps.runtime.start({
          flowId: input.flowId,
          published: deps.definition,
          subject: input.subject,
          operationId: input.operationId,
        }),
      ),
    act: async (input) => {
      const actor = await deps.actorResolver.resolve(input.actor.id);
      return deps.views.read(
        await deps.runtime.act({
          flowId: input.flowId,
          action: input.action,
          actorId: actor.id,
          operationId: input.operationId,
          comment: input.comment,
        }),
      );
    },
    getFlow: (flowId) => deps.views.readByFlowId(flowId),
    tasks: {
      claim: async (input): Promise<FlowTask> => {
        const actor = await deps.actorResolver.resolve(input.actor.id);
        return (await claimTask({
          store: deps.tasks,
          eligibility: deps.eligibility,
          command: toClaimCommand(input, actor.id, deps.clock.now()),
        })) as FlowTask;
      },
      list: async ({ actor }) => {
        const resolvedActor = await deps.actorResolver.resolve(actor.id);
        const page = await deps.tasks.inbox({
          view: 'role_queue',
          actorId: resolvedActor.id,
          roles: resolvedActor.roles,
          statuses: ['open', 'claimed'],
        });
        const visible = await Promise.all(page.items.map(async (task) => {
          if (task.status === 'claimed') return task.assigneeId === resolvedActor.id;
          return deps.eligibility.canWorkRole({ actorId: resolvedActor.id, role: task.role, task });
        }));
        return { ...page, items: page.items.filter((_, index) => visible[index]) };
      },
    },
  };
}
