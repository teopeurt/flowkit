import { FlowDefinition, FlowState } from '@flowkit/core';
import { z } from 'zod';

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | {
    [key: string]: JsonValue;
};
type FlowTaskStatus = 'open' | 'claimed' | 'completed' | 'cancelled';
type TaskEventType = 'opened' | 'claimed' | 'released' | 'reassigned' | 'completed' | 'reopened' | 'cancelled' | 'invited' | 'invitation_accepted';
type TaskSort = 'created_at' | 'updated_at' | 'due_at' | 'stage';
interface TaskReference {
    namespace: string;
    flowId: string;
    subjectType: string;
    subjectId: string;
    stage: string;
    role: string;
}
interface FlowTask extends TaskReference {
    id: string;
    status: FlowTaskStatus;
    assigneeId: string | null;
    revision: number;
    lifecycleEpoch: number;
    dueAt: string | null;
    claimedAt: string | null;
    completedAt: string | null;
    openedOperationId: string;
    metadata: Record<string, JsonValue>;
    createdAt: string;
    updatedAt: string;
}
interface TaskEvent {
    id: string;
    taskId: string;
    sequence: number;
    transitionSequence: number | null;
    operationId: string;
    eventType: TaskEventType;
    previousStatus: FlowTaskStatus | null;
    nextStatus: FlowTaskStatus;
    previousAssigneeId: string | null;
    nextAssigneeId: string | null;
    actorId: string | null;
    reason: string | null;
    action: string | null;
    lifecycleEpoch: number;
    metadata: Record<string, JsonValue>;
    createdAt: string;
}
interface TaskProjectionInput {
    namespace: string;
    flowId: string;
    subject: {
        type: string;
        id: string;
    };
    definition: FlowDefinition;
    operationId: string;
    transitionSequence: number;
    action: string;
    actorId: string | null;
    previousState: FlowState;
    nextState: FlowState;
    dueAt?: string | null;
    metadata?: Record<string, JsonValue>;
}
interface TaskMutation {
    kind: 'complete' | 'open' | 'reopen' | 'close';
    reference: TaskReference;
    operationId: string;
    transitionSequence: number;
    actorId: string | null;
    action: string;
    lifecycleEpoch: number;
    dueAt?: string | null;
    metadata: Record<string, JsonValue>;
}
interface TaskProjectionPlan {
    operationId: string;
    mutations: TaskMutation[];
    events: Array<Pick<TaskEvent, 'eventType' | 'operationId' | 'transitionSequence' | 'actorId' | 'action' | 'lifecycleEpoch' | 'metadata'>>;
}
interface TaskProjectionResult {
    created: boolean;
    tasks: FlowTask[];
    events: TaskEvent[];
}
interface TaskClaimCommand {
    taskId: string;
    expectedRevision: number;
    actorId: string;
    operationId: string;
    now: string;
}
interface TaskReleaseCommand {
    taskId: string;
    expectedRevision: number;
    actorId: string;
    operationId: string;
    reason: string;
    now: string;
}
interface TaskReassignCommand {
    taskId: string;
    expectedRevision: number;
    actorId: string;
    targetActorId: string;
    operationId: string;
    reason: string;
    now: string;
}
interface TaskInboxQuery {
    view: 'my_claims' | 'role_queue' | 'all';
    actorId?: string;
    roles?: string[];
    statuses?: FlowTaskStatus[];
    stage?: string;
    dueBefore?: string;
    dueAfter?: string;
    subjectId?: string;
    sort?: TaskSort;
    direction?: 'asc' | 'desc';
    cursor?: string;
    limit?: number;
}
interface TaskInboxPage {
    items: FlowTask[];
    nextCursor: string | null;
}
interface TaskEligibilityResolver {
    canWorkRole(input: {
        actorId: string;
        role: string;
        task: FlowTask;
    }): Promise<boolean>;
    canAdminister?(input: {
        actorId: string;
        task: FlowTask;
    }): Promise<boolean>;
}
interface TaskClock {
    now(): string;
}
interface TaskLogger {
    info(message: string, metadata?: Record<string, JsonValue>): void;
    warn(message: string, metadata?: Record<string, JsonValue>): void;
}
interface TaskInvitation {
    id: string;
    taskId: string;
    subjectType: string;
    subjectId: string;
    role: string;
    contactKind: 'email' | 'phone';
    contactHash: string;
    contactHashKeyVersion: string;
    tokenHash: string;
    status: 'pending' | 'accepted' | 'revoked' | 'expired';
    expiresAt: string;
    sourceKey: string;
    acceptedIdentityId: string | null;
    acceptedAt: string | null;
    metadata: Record<string, JsonValue>;
}
interface TaskIdentityGateway {
    normalizeContact(input: {
        kind: 'email' | 'phone';
        value: string;
    }): string;
    hashContact(input: {
        kind: 'email' | 'phone';
        normalized: string;
    }): string;
    verify(input: {
        kind: 'email' | 'phone';
        contactHash: string;
    }): Promise<{
        identityId: string;
        contactHash: string;
    }>;
}
interface TaskInvitationNotifier {
    notify(input: {
        invitation: TaskInvitation;
        rawToken: string;
        sourceKey: string;
    }): Promise<void>;
}
interface TaskStore {
    get(taskId: string): Promise<FlowTask | null>;
    find(reference: TaskReference): Promise<FlowTask | null>;
    applyProjection(input: {
        plan: TaskProjectionPlan;
        operationId: string;
    }): Promise<TaskProjectionResult>;
    claim(command: TaskClaimCommand): Promise<{
        task: FlowTask | null;
        reason?: 'not_found' | 'conflict' | 'not_claimable';
    }>;
    release(command: TaskReleaseCommand): Promise<{
        task: FlowTask | null;
        reason?: 'not_found' | 'conflict' | 'not_owned';
    }>;
    reassign(command: TaskReassignCommand): Promise<{
        task: FlowTask | null;
        reason?: 'not_found' | 'conflict' | 'not_authorized';
    }>;
    history(taskId: string): Promise<TaskEvent[]>;
    inbox(query: TaskInboxQuery): Promise<TaskInboxPage>;
    latestMakerCompletion(input: {
        subjectType: string;
        subjectId: string;
        makerStage: string;
        beforeEpoch: number;
    }): Promise<TaskEvent | null>;
    createInvitation(input: Omit<TaskInvitation, 'id' | 'status' | 'acceptedIdentityId' | 'acceptedAt'>): Promise<TaskInvitation>;
    getInvitationByTokenHash(tokenHash: string): Promise<TaskInvitation | null>;
    redeemInvitation(input: {
        invitationId: string;
        identityId: string;
        expectedExpiry: string;
        now: string;
        operationId: string;
    }): Promise<{
        invitation: TaskInvitation;
        task: FlowTask;
    } | null>;
    revokeInvitation(input: {
        invitationId: string;
        now: string;
        operationId: string;
    }): Promise<void>;
}

type TaskErrorCode = 'task_not_found' | 'task_claim_conflict' | 'task_not_claimable' | 'task_not_owned' | 'task_role_ineligible' | 'maker_checker_conflict' | 'stale_task_revision' | 'invitation_invalid' | 'invitation_identity_mismatch' | 'idempotency_conflict';
declare class FlowkitTaskError extends Error {
    readonly code: TaskErrorCode;
    constructor(code: TaskErrorCode, message: string);
}

declare const jsonValueSchema: z.ZodType<JsonValue>;
declare const taskReferenceSchema: z.ZodObject<{
    namespace: z.ZodString;
    flowId: z.ZodString;
    subjectType: z.ZodString;
    subjectId: z.ZodString;
    stage: z.ZodString;
    role: z.ZodString;
}, "strict", z.ZodTypeAny, {
    stage: string;
    subjectType: string;
    subjectId: string;
    role: string;
    namespace: string;
    flowId: string;
}, {
    stage: string;
    subjectType: string;
    subjectId: string;
    role: string;
    namespace: string;
    flowId: string;
}>;
declare const flowTaskSchema: z.ZodEffects<z.ZodEffects<z.ZodObject<{
    status: z.ZodEnum<["open", "claimed", "completed", "cancelled"]>;
    assigneeId: z.ZodNullable<z.ZodString>;
    revision: z.ZodNumber;
    lifecycleEpoch: z.ZodNumber;
    dueAt: z.ZodNullable<z.ZodString>;
    claimedAt: z.ZodNullable<z.ZodString>;
    completedAt: z.ZodNullable<z.ZodString>;
    openedOperationId: z.ZodString;
    metadata: z.ZodRecord<z.ZodString, z.ZodType<JsonValue, z.ZodTypeDef, JsonValue>>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
    namespace: z.ZodString;
    flowId: z.ZodString;
    subjectType: z.ZodString;
    subjectId: z.ZodString;
    stage: z.ZodString;
    role: z.ZodString;
    id: z.ZodString;
}, "strict", z.ZodTypeAny, {
    stage: string;
    lifecycleEpoch: number;
    metadata: Record<string, JsonValue>;
    id: string;
    createdAt: string;
    status: "open" | "claimed" | "completed" | "cancelled";
    subjectType: string;
    subjectId: string;
    role: string;
    namespace: string;
    flowId: string;
    assigneeId: string | null;
    revision: number;
    dueAt: string | null;
    claimedAt: string | null;
    completedAt: string | null;
    openedOperationId: string;
    updatedAt: string;
}, {
    stage: string;
    lifecycleEpoch: number;
    metadata: Record<string, JsonValue>;
    id: string;
    createdAt: string;
    status: "open" | "claimed" | "completed" | "cancelled";
    subjectType: string;
    subjectId: string;
    role: string;
    namespace: string;
    flowId: string;
    assigneeId: string | null;
    revision: number;
    dueAt: string | null;
    claimedAt: string | null;
    completedAt: string | null;
    openedOperationId: string;
    updatedAt: string;
}>, {
    stage: string;
    lifecycleEpoch: number;
    metadata: Record<string, JsonValue>;
    id: string;
    createdAt: string;
    status: "open" | "claimed" | "completed" | "cancelled";
    subjectType: string;
    subjectId: string;
    role: string;
    namespace: string;
    flowId: string;
    assigneeId: string | null;
    revision: number;
    dueAt: string | null;
    claimedAt: string | null;
    completedAt: string | null;
    openedOperationId: string;
    updatedAt: string;
}, {
    stage: string;
    lifecycleEpoch: number;
    metadata: Record<string, JsonValue>;
    id: string;
    createdAt: string;
    status: "open" | "claimed" | "completed" | "cancelled";
    subjectType: string;
    subjectId: string;
    role: string;
    namespace: string;
    flowId: string;
    assigneeId: string | null;
    revision: number;
    dueAt: string | null;
    claimedAt: string | null;
    completedAt: string | null;
    openedOperationId: string;
    updatedAt: string;
}>, {
    stage: string;
    lifecycleEpoch: number;
    metadata: Record<string, JsonValue>;
    id: string;
    createdAt: string;
    status: "open" | "claimed" | "completed" | "cancelled";
    subjectType: string;
    subjectId: string;
    role: string;
    namespace: string;
    flowId: string;
    assigneeId: string | null;
    revision: number;
    dueAt: string | null;
    claimedAt: string | null;
    completedAt: string | null;
    openedOperationId: string;
    updatedAt: string;
}, {
    stage: string;
    lifecycleEpoch: number;
    metadata: Record<string, JsonValue>;
    id: string;
    createdAt: string;
    status: "open" | "claimed" | "completed" | "cancelled";
    subjectType: string;
    subjectId: string;
    role: string;
    namespace: string;
    flowId: string;
    assigneeId: string | null;
    revision: number;
    dueAt: string | null;
    claimedAt: string | null;
    completedAt: string | null;
    openedOperationId: string;
    updatedAt: string;
}>;
declare const taskProjectionInputSchema: z.ZodObject<{
    namespace: z.ZodString;
    flowId: z.ZodString;
    subject: z.ZodObject<{
        type: z.ZodString;
        id: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        id: string;
        type: string;
    }, {
        id: string;
        type: string;
    }>;
    operationId: z.ZodString;
    transitionSequence: z.ZodNumber;
    action: z.ZodString;
    actorId: z.ZodNullable<z.ZodString>;
    previousState: z.ZodObject<{
        stage: z.ZodString;
        status: z.ZodString;
        pendingRole: z.ZodNullable<z.ZodString>;
        tracks: z.ZodRecord<z.ZodString, z.ZodString>;
    }, "strict", z.ZodTypeAny, {
        stage: string;
        status: string;
        pendingRole: string | null;
        tracks: Record<string, string>;
    }, {
        stage: string;
        status: string;
        pendingRole: string | null;
        tracks: Record<string, string>;
    }>;
    nextState: z.ZodObject<{
        stage: z.ZodString;
        status: z.ZodString;
        pendingRole: z.ZodNullable<z.ZodString>;
        tracks: z.ZodRecord<z.ZodString, z.ZodString>;
    }, "strict", z.ZodTypeAny, {
        stage: string;
        status: string;
        pendingRole: string | null;
        tracks: Record<string, string>;
    }, {
        stage: string;
        status: string;
        pendingRole: string | null;
        tracks: Record<string, string>;
    }>;
    dueAt: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodType<JsonValue, z.ZodTypeDef, JsonValue>>>;
}, "strict", z.ZodTypeAny, {
    operationId: string;
    transitionSequence: number;
    actorId: string | null;
    action: string;
    namespace: string;
    flowId: string;
    subject: {
        id: string;
        type: string;
    };
    previousState: {
        stage: string;
        status: string;
        pendingRole: string | null;
        tracks: Record<string, string>;
    };
    nextState: {
        stage: string;
        status: string;
        pendingRole: string | null;
        tracks: Record<string, string>;
    };
    metadata?: Record<string, JsonValue> | undefined;
    dueAt?: string | null | undefined;
}, {
    operationId: string;
    transitionSequence: number;
    actorId: string | null;
    action: string;
    namespace: string;
    flowId: string;
    subject: {
        id: string;
        type: string;
    };
    previousState: {
        stage: string;
        status: string;
        pendingRole: string | null;
        tracks: Record<string, string>;
    };
    nextState: {
        stage: string;
        status: string;
        pendingRole: string | null;
        tracks: Record<string, string>;
    };
    metadata?: Record<string, JsonValue> | undefined;
    dueAt?: string | null | undefined;
}>;
declare const taskInboxQuerySchema: z.ZodObject<{
    view: z.ZodEnum<["my_claims", "role_queue", "all"]>;
    actorId: z.ZodOptional<z.ZodString>;
    roles: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    statuses: z.ZodOptional<z.ZodArray<z.ZodEnum<["open", "claimed", "completed", "cancelled"]>, "many">>;
    stage: z.ZodOptional<z.ZodString>;
    dueBefore: z.ZodOptional<z.ZodString>;
    dueAfter: z.ZodOptional<z.ZodString>;
    subjectId: z.ZodOptional<z.ZodString>;
    sort: z.ZodOptional<z.ZodEnum<["created_at", "updated_at", "due_at", "stage"]>>;
    direction: z.ZodOptional<z.ZodEnum<["asc", "desc"]>>;
    cursor: z.ZodOptional<z.ZodString>;
    limit: z.ZodOptional<z.ZodNumber>;
}, "strict", z.ZodTypeAny, {
    view: "my_claims" | "role_queue" | "all";
    stage?: string | undefined;
    actorId?: string | undefined;
    subjectId?: string | undefined;
    sort?: "created_at" | "updated_at" | "due_at" | "stage" | undefined;
    roles?: string[] | undefined;
    statuses?: ("open" | "claimed" | "completed" | "cancelled")[] | undefined;
    dueBefore?: string | undefined;
    dueAfter?: string | undefined;
    direction?: "asc" | "desc" | undefined;
    cursor?: string | undefined;
    limit?: number | undefined;
}, {
    view: "my_claims" | "role_queue" | "all";
    stage?: string | undefined;
    actorId?: string | undefined;
    subjectId?: string | undefined;
    sort?: "created_at" | "updated_at" | "due_at" | "stage" | undefined;
    roles?: string[] | undefined;
    statuses?: ("open" | "claimed" | "completed" | "cancelled")[] | undefined;
    dueBefore?: string | undefined;
    dueAfter?: string | undefined;
    direction?: "asc" | "desc" | undefined;
    cursor?: string | undefined;
    limit?: number | undefined;
}>;

declare function planTaskProjection(input: TaskProjectionInput, current: FlowTask | null, priorOperationIds?: string[]): TaskProjectionPlan;
declare function stageReadyIntent(input: {
    taskId: string;
    stage: string;
    lifecycleEpoch: number;
    dueAt: string;
    operationId: string;
}): {
    taskId: string;
    stage: string;
    lifecycleEpoch: number;
    dueAt: string;
    operationId: string;
};
declare function humanTaskForStage(definition: FlowDefinition, stage: string): {
    stage: string;
    role: string;
} | null;

declare function claimTask(input: {
    store: TaskStore;
    eligibility: TaskEligibilityResolver;
    command: TaskClaimCommand;
}): Promise<Awaited<ReturnType<TaskStore['claim']>>['task']>;
declare function releaseTask(input: {
    store: TaskStore;
    command: TaskReleaseCommand;
}): Promise<NonNullable<Awaited<ReturnType<TaskStore['release']>>['task']>>;
declare function reassignTask(input: {
    store: TaskStore;
    eligibility: TaskEligibilityResolver;
    command: TaskReassignCommand;
}): Promise<NonNullable<Awaited<ReturnType<TaskStore['reassign']>>['task']>>;

declare function queryTaskInbox(input: {
    store: TaskStore;
    eligibility: TaskEligibilityResolver;
    query: TaskInboxQuery;
}): Promise<TaskInboxPage>;

interface MakerCheckerRule {
    makerStage: string;
    checkerStage: string;
    makerRole?: string;
    checkerRole?: string;
    factKey: string;
}
interface MakerCheckerDecision {
    allowed: boolean;
    reason: 'allowed' | 'same_actor' | 'missing_history' | 'wrong_stage';
    makerId: string | null;
    factKey: string;
}
declare function evaluateMakerChecker(input: {
    rule: MakerCheckerRule;
    actorId: string;
    latestMakerCompletion: TaskEvent | null;
}): MakerCheckerDecision;

declare function hashInvitationToken(rawToken: string): string;
declare function hashContact(input: {
    key: string;
    normalized: string;
}): string;
declare function requireTokenEntropy(rawToken: string, minimumBytes?: number): void;

declare function createTaskInvitation(input: {
    store: TaskStore;
    identity: TaskIdentityGateway;
    notifier: TaskInvitationNotifier;
    clock: TaskClock;
    task: {
        id: string;
        subjectType: string;
        subjectId: string;
        role: string;
    };
    contact: {
        kind: 'email' | 'phone';
        value: string;
    };
    rawToken: string;
    expiresAt: string;
    sourceKey: string;
    metadata?: Record<string, any>;
}): Promise<{
    invitation: TaskInvitation;
    rawToken: string;
}>;
declare function redeemTaskInvitation(input: {
    store: TaskStore;
    identity: TaskIdentityGateway;
    clock: TaskClock;
    rawToken: string;
    contact: {
        kind: 'email' | 'phone';
        value: string;
    };
    operationId: string;
}): Promise<{
    invitation: TaskInvitation;
    task: FlowTask;
}>;

declare class MemoryTaskStore implements TaskStore {
    readonly tasks: Map<string, FlowTask>;
    readonly events: TaskEvent[];
    readonly invitations: Map<string, TaskInvitation>;
    private readonly operationResults;
    private id;
    private eventId;
    private invitationId;
    restore(snapshot: {
        tasks: FlowTask[];
        events: TaskEvent[];
        invitations?: TaskInvitation[];
    }): void;
    get(taskId: string): Promise<FlowTask | null>;
    find(reference: TaskReference): Promise<FlowTask | null>;
    applyProjection(input: {
        plan: TaskProjectionPlan;
        operationId: string;
    }): Promise<{
        created: boolean;
        tasks: FlowTask[];
        events: TaskEvent[];
    }>;
    claim(command: TaskClaimCommand): Promise<{
        task: null;
        reason: "not_found";
    } | {
        task: null;
        reason: "not_claimable";
    } | {
        task: null;
        reason: "conflict";
    } | {
        task: {
            status: "claimed";
            assigneeId: string;
            revision: number;
            claimedAt: string;
            updatedAt: string;
            id: string;
            lifecycleEpoch: number;
            dueAt: string | null;
            completedAt: string | null;
            openedOperationId: string;
            metadata: Record<string, JsonValue>;
            createdAt: string;
            namespace: string;
            flowId: string;
            subjectType: string;
            subjectId: string;
            stage: string;
            role: string;
        };
        reason?: undefined;
    }>;
    release(command: TaskReleaseCommand): Promise<{
        task: null;
        reason: "not_found";
    } | {
        task: null;
        reason: "conflict";
    } | {
        task: null;
        reason: "not_owned";
    } | {
        task: {
            status: "open";
            assigneeId: null;
            claimedAt: null;
            revision: number;
            updatedAt: string;
            id: string;
            lifecycleEpoch: number;
            dueAt: string | null;
            completedAt: string | null;
            openedOperationId: string;
            metadata: Record<string, JsonValue>;
            createdAt: string;
            namespace: string;
            flowId: string;
            subjectType: string;
            subjectId: string;
            stage: string;
            role: string;
        };
        reason?: undefined;
    }>;
    reassign(command: TaskReassignCommand): Promise<{
        task: null;
        reason: "not_found";
    } | {
        task: null;
        reason: "conflict";
    } | {
        task: {
            status: "claimed";
            assigneeId: string;
            claimedAt: string;
            revision: number;
            updatedAt: string;
            id: string;
            lifecycleEpoch: number;
            dueAt: string | null;
            completedAt: string | null;
            openedOperationId: string;
            metadata: Record<string, JsonValue>;
            createdAt: string;
            namespace: string;
            flowId: string;
            subjectType: string;
            subjectId: string;
            stage: string;
            role: string;
        };
        reason?: undefined;
    }>;
    history(taskId: string): Promise<TaskEvent[]>;
    inbox(query: TaskInboxQuery): Promise<TaskInboxPage>;
    latestMakerCompletion(input: {
        subjectType: string;
        subjectId: string;
        makerStage: string;
        beforeEpoch: number;
    }): Promise<TaskEvent | null>;
    createInvitation(input: Omit<TaskInvitation, 'id' | 'status' | 'acceptedIdentityId' | 'acceptedAt'>): Promise<TaskInvitation>;
    getInvitationByTokenHash(tokenHash: string): Promise<TaskInvitation | null>;
    redeemInvitation(input: {
        invitationId: string;
        identityId: string;
        expectedExpiry: string;
        now: string;
        operationId: string;
    }): Promise<{
        invitation: {
            status: "accepted";
            acceptedIdentityId: string;
            acceptedAt: string;
            id: string;
            taskId: string;
            subjectType: string;
            subjectId: string;
            role: string;
            contactKind: "email" | "phone";
            contactHash: string;
            contactHashKeyVersion: string;
            tokenHash: string;
            expiresAt: string;
            sourceKey: string;
            metadata: Record<string, JsonValue>;
        };
        task: {
            status: "claimed";
            assigneeId: string;
            claimedAt: string;
            revision: number;
            updatedAt: string;
            id: string;
            lifecycleEpoch: number;
            dueAt: string | null;
            completedAt: string | null;
            openedOperationId: string;
            metadata: Record<string, JsonValue>;
            createdAt: string;
            namespace: string;
            flowId: string;
            subjectType: string;
            subjectId: string;
            stage: string;
            role: string;
        };
    } | null>;
    revokeInvitation(input: {
        invitationId: string;
        now: string;
        operationId: string;
    }): Promise<void>;
    private appendEvent;
}

declare const leaveApprovalDefinition: FlowDefinition;
declare function createLeaveApprovalFixture(): MemoryTaskStore;
declare function leaveTransitionPlan(input: {
    store: MemoryTaskStore;
    operationId: string;
    previousStage: string;
    previousRole: string | null;
    nextStage: string;
    nextRole: string | null;
    actorId: string | null;
    action: string;
    sequence: number;
}): TaskProjectionPlan;

declare const FLOWKIT_TASKS_VERSION = "0.1.0";

export { FLOWKIT_TASKS_VERSION, type FlowTask, type FlowTaskStatus, FlowkitTaskError, type JsonPrimitive, type JsonValue, type MakerCheckerDecision, type MakerCheckerRule, MemoryTaskStore, type TaskClaimCommand, type TaskClock, type TaskEligibilityResolver, type TaskErrorCode, type TaskEvent, type TaskEventType, type TaskIdentityGateway, type TaskInboxPage, type TaskInboxQuery, type TaskInvitation, type TaskInvitationNotifier, type TaskLogger, type TaskMutation, type TaskProjectionInput, type TaskProjectionPlan, type TaskProjectionResult, type TaskReassignCommand, type TaskReference, type TaskReleaseCommand, type TaskSort, type TaskStore, claimTask, createLeaveApprovalFixture, createTaskInvitation, evaluateMakerChecker, flowTaskSchema, hashContact, hashInvitationToken, humanTaskForStage, jsonValueSchema, leaveApprovalDefinition, leaveTransitionPlan, planTaskProjection, queryTaskInbox, reassignTask, redeemTaskInvitation, releaseTask, requireTokenEntropy, stageReadyIntent, taskInboxQuerySchema, taskProjectionInputSchema, taskReferenceSchema };
