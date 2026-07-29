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

// src/index.ts
var index_exports = {};
__export(index_exports, {
  createFlowkitConsumer: () => createFlowkitConsumer
});
module.exports = __toCommonJS(index_exports);

// src/consumer.ts
var import_tasks = require("@flowkit/tasks");
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
      claim: async (input) => await (0, import_tasks.claimTask)({
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createFlowkitConsumer
});
