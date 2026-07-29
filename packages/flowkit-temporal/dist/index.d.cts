import { FlowRuntime } from '@flowkit/consumer';
import { FlowCommand, FlowDefinition } from '@flowkit/core';
import { F as FlowkitWorkflow, a as FlowkitWorkflowInput, b as FlowkitStateView, D as DefinitionHash, P as PublishedFlowDefinition, c as FlowkitPureRegistries, d as FlowkitDeclaredRefs } from './workflow-CVia-PJ6.cjs';
export { C as CommandEnvelope, e as CommandOrigin, f as DefinitionIdentity, g as DispatchNotificationInput, E as EntryReason, h as ExecuteAiStepInput, i as ExecuteAiStepOutput, j as ExecuteSystemStepInput, k as ExecuteSystemStepOutput, m as FlowkitActivityRegistry, l as FlowkitActorRef, n as FlowkitExecutionState, o as FlowkitNotificationBinding, r as FlowkitRule, s as FlowkitRuleRegistration, p as FlowkitStepResult, q as FlowkitSubject, R as RecordStageReadyInput, t as RecordTransitionInput, u as RecordTransitionOutput, v as ResolveActionContextInput, w as ResolvedActionContext, x as RuleContext } from './workflow-CVia-PJ6.cjs';
import '@temporalio/workflow';

interface TemporalWorkflowHandle {
    query(name: 'getState'): Promise<FlowkitStateView>;
    executeUpdate(name: 'applyAction', options: {
        updateId: string;
        args: [FlowCommand];
    }): Promise<FlowkitStateView>;
}
interface TemporalRuntimeOptions {
    client: {
        workflow: {
            start(workflowType: FlowkitWorkflow, options: {
                taskQueue: string;
                workflowId: string;
                args: [FlowkitWorkflowInput];
            }): Promise<TemporalWorkflowHandle>;
            getHandle(flowId: string): TemporalWorkflowHandle;
        };
    };
    taskQueue: string;
    workflowType: FlowkitWorkflow;
    healthProbe(): Promise<{
        ready: boolean;
        checkedAt: string;
    }>;
}
declare function createFlowkitTemporalRuntime(options: TemporalRuntimeOptions): FlowRuntime;

declare class SnapshotError extends Error {
    constructor(message: string);
}
/**
 * Deterministic canonical JSON: object keys sorted recursively (by UTF-16
 * code unit, never locale-sensitive), array order preserved, only JSON
 * primitives accepted. `undefined`, bigint, function, symbol, non-finite
 * numbers, and non-plain objects are rejected so a hash never depends on
 * platform-specific serialization.
 */
declare function canonicalizeJson(value: unknown): string;
declare function hashCanonicalJson(canonical: string): DefinitionHash;
/**
 * Validate a definition, detach it into a deeply frozen JSON clone, and
 * compute its deterministic content hash. Runs before workflow start (client
 * side); the resulting pair is the workflow's immutable input.
 */
declare function publishDefinition(args: {
    definition: FlowDefinition;
}): PublishedFlowDefinition;
/**
 * Re-verify a published pair. Called inside the workflow before any handler
 * is registered: the hash must be well-formed, the snapshot must hash back to
 * it exactly, and the snapshot must still satisfy the strict schema.
 */
declare function verifyPublishedDefinition(published: PublishedFlowDefinition): void;

interface FlowkitValidationRegistries extends FlowkitPureRegistries, FlowkitDeclaredRefs {
}
interface FlowkitValidationIssue {
    code: string;
    message: string;
    path: string;
}
declare class FlowkitValidationError extends Error {
    readonly issues: readonly FlowkitValidationIssue[];
    constructor(issues: readonly FlowkitValidationIssue[]);
}
/** Parses positive SLA durations such as `250ms`, `24h`, or `1h30m`. */
declare function parseSlaDuration(input: string): number | undefined;
/** Returns all boot-blocking errors for a published definition and registries. */
declare function validateFlowkit(args: {
    published: PublishedFlowDefinition;
    registries: FlowkitValidationRegistries;
}): FlowkitValidationIssue[];
/** Throws a compact boot error when any interpreter validation fails. */
declare function assertValidFlowkit(args: {
    published: PublishedFlowDefinition;
    registries: FlowkitValidationRegistries;
}): void;

declare const FLOWKIT_TEMPORAL_VERSION = "0.1.0";

export { DefinitionHash, FLOWKIT_TEMPORAL_VERSION, FlowkitDeclaredRefs, FlowkitPureRegistries, FlowkitStateView, FlowkitValidationError, type FlowkitValidationIssue, type FlowkitValidationRegistries, FlowkitWorkflowInput, PublishedFlowDefinition, SnapshotError, assertValidFlowkit, canonicalizeJson, createFlowkitTemporalRuntime, hashCanonicalJson, parseSlaDuration, publishDefinition, validateFlowkit, verifyPublishedDefinition };
