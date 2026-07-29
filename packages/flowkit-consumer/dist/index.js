// src/consumer.ts
import { claimTask } from "@flowkit/tasks";
function toClaimCommand(input, now) {
  return {
    taskId: input.taskId,
    expectedRevision: input.expectedRevision,
    actorId: input.actor.id,
    operationId: input.operationId,
    now
  };
}
function createFlowkitConsumer(deps) {
  return {
    start: async (input) => deps.views.read(
      await deps.runtime.start({
        flowId: input.flowId,
        published: deps.definition,
        subject: input.subject,
        operationId: input.operationId
      })
    ),
    act: async (input) => {
      const actor = await deps.actorResolver.resolve(input.actor.id);
      return deps.views.read(
        await deps.runtime.act({
          flowId: input.flowId,
          action: input.action,
          actorId: actor.id,
          operationId: input.operationId,
          comment: input.comment
        })
      );
    },
    getFlow: (flowId) => deps.views.readByFlowId(flowId),
    tasks: {
      claim: async (input) => await claimTask({
        store: deps.tasks,
        eligibility: deps.eligibility,
        command: toClaimCommand(input, deps.clock.now())
      }),
      list: ({ actor }) => deps.tasks.inbox({
        view: "role_queue",
        roles: actor.roles,
        statuses: ["open", "claimed"]
      })
    }
  };
}
export {
  createFlowkitConsumer
};
