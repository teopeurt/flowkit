import type { FlowRuntime } from '@naakwu/flowkit-consumer';
import type { FlowCommand } from '@naakwu/flowkit-core';

import type {
  FlowkitStateView,
  FlowkitWorkflowInput,
} from './contracts';
import type { FlowkitWorkflow } from './workflow';

interface TemporalWorkflowHandle {
  query(name: 'getState'): Promise<FlowkitStateView>;
  executeUpdate(
    name: 'applyAction',
    options: { updateId: string; args: [FlowCommand] },
  ): Promise<FlowkitStateView>;
}

/**
 * A runtime resolves a workflow by its registered type name. A workflow value produced by a
 * factory such as `createFlowkitWorkflow` is anonymous, so the runtime cannot derive a name from
 * it; consumers that register their workflow as a module export must pass that export's name.
 */
type FlowkitWorkflowType = FlowkitWorkflow | string;

interface TemporalRuntimeOptions {
  client: {
    workflow: {
      start(
        workflowType: FlowkitWorkflowType,
        options: {
          taskQueue: string;
          workflowId: string;
          args: [FlowkitWorkflowInput];
        },
      ): Promise<TemporalWorkflowHandle>;
      getHandle(flowId: string): TemporalWorkflowHandle;
    };
  };
  taskQueue: string;
  workflowType: FlowkitWorkflowType;
  healthProbe(): Promise<{ ready: boolean; checkedAt: string }>;
}

export function createFlowkitTemporalRuntime(options: TemporalRuntimeOptions): FlowRuntime {
  return {
    async start(input) {
      const handle = await options.client.workflow.start(options.workflowType, {
        taskQueue: options.taskQueue,
        workflowId: input.flowId,
        args: [{ published: input.published, subject: input.subject }],
      });

      return handle.query('getState');
    },
    act: (input) => options.client.workflow.getHandle(input.flowId).executeUpdate('applyAction', {
      updateId: input.operationId,
      args: [{ action: input.action, actorId: input.actorId, comment: input.comment }],
    }),
    get: ({ flowId }) => options.client.workflow.getHandle(flowId).query('getState'),
    health: () => options.healthProbe(),
  };
}
