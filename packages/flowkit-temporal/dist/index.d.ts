import { FlowDefinition } from '@flowkit/core';
import { D as DefinitionHash, P as PublishedFlowDefinition, F as FlowkitPureRegistries, a as FlowkitDeclaredRefs } from './contracts-nQAacdxJ.js';
export { C as CommandEnvelope, b as CommandOrigin, c as DefinitionIdentity, d as DispatchNotificationInput, E as EntryReason, e as ExecuteAiStepInput, f as ExecuteAiStepOutput, g as ExecuteSystemStepInput, h as ExecuteSystemStepOutput, j as FlowkitActivityRegistry, i as FlowkitActorRef, k as FlowkitExecutionState, l as FlowkitNotificationBinding, p as FlowkitRule, q as FlowkitRuleRegistration, m as FlowkitStateView, n as FlowkitStepResult, o as FlowkitSubject, r as FlowkitWorkflowInput, R as RecordStageReadyInput, s as RecordTransitionInput, t as RecordTransitionOutput, u as ResolveActionContextInput, v as ResolvedActionContext, w as RuleContext } from './contracts-nQAacdxJ.js';

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

export { DefinitionHash, FLOWKIT_TEMPORAL_VERSION, FlowkitDeclaredRefs, FlowkitPureRegistries, FlowkitValidationError, type FlowkitValidationIssue, type FlowkitValidationRegistries, PublishedFlowDefinition, SnapshotError, assertValidFlowkit, canonicalizeJson, hashCanonicalJson, parseSlaDuration, publishDefinition, validateFlowkit, verifyPublishedDefinition };
