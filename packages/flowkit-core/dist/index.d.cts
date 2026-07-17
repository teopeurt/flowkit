import { z } from 'zod';

interface TrackDef {
    initial: string;
    values: string[];
}
interface StepDef {
    kind: 'system' | 'ai' | 'rule';
    ref: string;
    gate?: 'human';
}
interface ActionDef {
    to: string;
    status?: string;
    pendingRole?: string | null;
    tracks?: Record<string, string>;
    guards?: string[];
    policy?: string;
    notify?: {
        template: string;
        channels: string[];
        to?: string[];
    };
}
interface StageDef {
    pendingRole?: string | null;
    final?: boolean;
    entry?: StepDef[];
    sla?: {
        after: string;
        escalate: {
            notify?: string;
            action?: string;
        };
    };
    actions?: Record<string, ActionDef>;
}
interface FlowDefinition {
    id: string;
    version: number;
    roles: string[];
    tracks?: Record<string, TrackDef>;
    initialStage: string;
    initialStatus?: string;
    stages: Record<string, StageDef>;
}
type StageName<D extends FlowDefinition> = keyof D['stages'] & string;
type ActionName<D extends FlowDefinition> = {
    [S in keyof D['stages']]: D['stages'][S] extends {
        actions?: infer A;
    } ? keyof NonNullable<A> & string : never;
}[keyof D['stages']];
interface FlowCommand {
    action: string;
    actorId?: string;
    comment?: string;
    payload?: Record<string, unknown>;
    attachments?: Array<{
        url: string;
        name?: string;
        size?: number;
        type?: string;
    }>;
}
interface FlowState {
    stage: string;
    status: string;
    pendingRole: string | null;
    tracks: Record<string, string>;
}
interface EvaluationContext {
    subject?: Readonly<Record<string, unknown>>;
    facts?: Readonly<Record<string, unknown>>;
    actor?: Readonly<{
        id: string;
        roles: string[];
        organizationId?: string;
    }>;
    guards?: GuardRegistry;
    policies?: AuthorizationPolicyRegistry;
}
interface PredicateContext {
    definition: FlowDefinition;
    state: FlowState;
    command: FlowCommand;
    subject: Readonly<Record<string, unknown>>;
    facts: Readonly<Record<string, unknown>>;
    actor?: EvaluationContext['actor'];
}
type Guard = (ctx: PredicateContext) => boolean;
type GuardRegistry = Record<string, Guard>;
type AuthorizationPolicy = (ctx: PredicateContext) => boolean;
type AuthorizationPolicyRegistry = Record<string, AuthorizationPolicy>;
type LintIssueCode = 'unreachable-stage' | 'dead-end-stage' | 'final-stage-has-actions' | 'unused-role' | 'unused-track' | 'duplicate-action-source' | 'missing-guard-ref' | 'missing-policy-ref' | 'missing-step-ref' | 'missing-template-ref' | 'missing-channel-ref';
interface LintIssue {
    code: LintIssueCode;
    severity: 'error' | 'warning';
    message: string;
    path: string;
}

interface RegistryRefs {
    guards?: Record<string, unknown>;
    policies?: Record<string, unknown>;
    steps?: Record<string, unknown>;
    templates?: Record<string, unknown>;
    channels?: Record<string, unknown>;
}
declare function lintFlow(definition: FlowDefinition): LintIssue[];
declare function validateRegistryRefs(definition: FlowDefinition, registry: RegistryRefs): LintIssue[];

declare const flowSchema: z.ZodType<FlowDefinition>;
declare class FlowDefinitionError extends Error {
    constructor(message: string);
}
declare const formatIssues: (issues: readonly z.ZodIssue[]) => string;
declare function defineFlow<const T extends FlowDefinition>(input: T): T;

interface TransitionRecord {
    action: string;
    fromStage: string;
    nextStage: string;
    status: string;
    pendingRole: string | null;
    trackUpdates: Record<string, string>;
}
interface TransitionOutcome {
    state: FlowState;
    transition: TransitionRecord;
}
interface FlowStateOverrides {
    stage?: string;
    status?: string;
    pendingRole?: string | null;
    tracks?: Record<string, string>;
}
declare class UnknownStageError extends Error {
    readonly stage: string;
    constructor(stage: string);
}
declare class UnknownTrackError extends Error {
    readonly track: string;
    constructor(track: string);
}
declare class InvalidTrackValueError extends Error {
    readonly track: string;
    readonly value: string;
    readonly allowedValues: readonly string[];
    constructor(track: string, value: string, allowedValues: readonly string[]);
}
declare class InvalidTransitionError extends Error {
    readonly stage: string;
    readonly action: string;
    readonly sourceStages: string[];
    constructor(stage: string, action: string, sourceStages: string[]);
}
declare class MissingPolicyError extends Error {
    readonly policy: string;
    readonly action: string;
    constructor(policy: string, action: string);
}
declare class MissingGuardError extends Error {
    readonly guard: string;
    readonly action: string;
    constructor(guard: string, action: string);
}
declare class AuthorizationRejectionError extends Error {
    readonly policy: string;
    readonly action: string;
    constructor(policy: string, action: string);
}
declare class GuardRejectionError extends Error {
    readonly guard: string;
    readonly action: string;
    constructor(guard: string, action: string);
}
declare function buildInitialState(definition: FlowDefinition, overrides?: FlowStateOverrides): FlowState;
declare function getDeclaredActions(definition: FlowDefinition, stage: string): string[];
declare function getActionSourceStages(definition: FlowDefinition, action: string): string[];
declare function transition(definition: FlowDefinition, state: FlowState, command: FlowCommand, context?: EvaluationContext): TransitionOutcome;

declare const FLOWKIT_CORE_VERSION = "0.1.0";

export { type ActionDef, type ActionName, type AuthorizationPolicy, type AuthorizationPolicyRegistry, AuthorizationRejectionError, type EvaluationContext, FLOWKIT_CORE_VERSION, type FlowCommand, type FlowDefinition, FlowDefinitionError, type FlowState, type FlowStateOverrides, type Guard, type GuardRegistry, GuardRejectionError, InvalidTrackValueError, InvalidTransitionError, type LintIssue, type LintIssueCode, MissingGuardError, MissingPolicyError, type PredicateContext, type StageDef, type StageName, type StepDef, type TrackDef, type TransitionOutcome, type TransitionRecord, UnknownStageError, UnknownTrackError, buildInitialState, defineFlow, flowSchema, formatIssues, getActionSourceStages, getDeclaredActions, lintFlow, transition, validateRegistryRefs };
