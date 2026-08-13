import {
  FlowkitValidationError,
  SnapshotError,
  assertValidFlowkit,
  canonicalizeJson,
  hashCanonicalJson,
  parseSlaDuration,
  publishDefinition,
  validateFlowkit,
  verifyPublishedDefinition
} from "./chunk-PDJX3YVH.js";

// src/consumer-runtime.ts
function createFlowkitTemporalRuntime(options) {
  return {
    async start(input) {
      const handle = await options.client.workflow.start(options.workflowType, {
        taskQueue: options.taskQueue,
        workflowId: input.flowId,
        args: [{ published: input.published, subject: input.subject }]
      });
      return handle.query("getState");
    },
    act: (input) => options.client.workflow.getHandle(input.flowId).executeUpdate("applyAction", {
      updateId: input.operationId,
      args: [{ action: input.action, actorId: input.actorId, comment: input.comment }]
    }),
    get: ({ flowId }) => options.client.workflow.getHandle(flowId).query("getState"),
    health: () => options.healthProbe()
  };
}

// src/index.ts
var FLOWKIT_TEMPORAL_VERSION = "0.2.0";
export {
  FLOWKIT_TEMPORAL_VERSION,
  FlowkitValidationError,
  SnapshotError,
  assertValidFlowkit,
  canonicalizeJson,
  createFlowkitTemporalRuntime,
  hashCanonicalJson,
  parseSlaDuration,
  publishDefinition,
  validateFlowkit,
  verifyPublishedDefinition
};
