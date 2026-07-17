import { proxyActivities } from '@temporalio/workflow';
import { F as FlowkitPureRegistries, m as FlowkitStateView, r as FlowkitWorkflowInput } from './contracts-nQAacdxJ.cjs';
import '@flowkit/core';

interface FlowkitWorkflowConfig {
    registries: FlowkitPureRegistries;
    activityTaskQueue: string;
    activityOptions?: Parameters<typeof proxyActivities>[0];
    queryName?: string;
    updateName?: string;
    maxAutomaticTransitionsPerTurn?: number;
    shouldContinueAsNew?: () => boolean;
    adaptState?: (state: FlowkitStateView) => unknown;
}
type FlowkitWorkflow = (input: FlowkitWorkflowInput) => Promise<unknown>;
/**
 * Creates a deterministic workflow interpreter. Definitions remain execution
 * input so replay never reads a mutable definition registry.
 */
declare function createFlowkitWorkflow(config: FlowkitWorkflowConfig): FlowkitWorkflow;

export { type FlowkitWorkflow, type FlowkitWorkflowConfig, createFlowkitWorkflow };
