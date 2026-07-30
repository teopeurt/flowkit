import { z } from 'zod';

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | {
    [key: string]: JsonValue;
};
type NotificationChannel = string;
type NotificationDeliveryStatus = 'pending' | 'leased' | 'delivered' | 'failed' | 'skipped' | 'reconciliation_required';
type NotificationSkipReason = 'unknown_selector' | 'missing_route' | 'disabled_channel' | 'invalid_recipient';
interface RecipientSelector {
    key: string;
    data?: JsonValue;
}
interface NotificationBinding {
    selector: RecipientSelector;
    channels: NotificationChannel[];
}
interface NotificationRequest {
    namespace: string;
    sourceKey: string;
    aggregate: {
        type: string;
        id: string;
    };
    templateKey: string;
    data: JsonValue;
    channels: NotificationChannel[];
    selectors?: RecipientSelector[];
    explicitRecipients?: ResolvedNotificationRecipient[];
    metadata?: Record<string, JsonValue>;
}
interface RecipientChannelRoute {
    channel: NotificationChannel;
    canonicalKey: string;
    address: string;
    enabled?: boolean;
    metadata?: Record<string, JsonValue>;
}
interface ResolvedNotificationRecipient {
    key: string;
    label?: string;
    templateData?: JsonValue;
    routes: RecipientChannelRoute[];
}
interface RenderedNotification {
    subject: string;
    body: string;
    severity?: 'info' | 'success' | 'warning' | 'error';
    actions?: Array<{
        label: string;
        url: string;
    }>;
    metadata?: Record<string, JsonValue>;
}
interface RetryPolicy {
    maxAttempts: number;
    initialDelayMs: number;
    multiplier: number;
    maxDelayMs: number;
    maxRetryWindowMs?: number;
}
interface NotificationDeliveryEnvelope {
    namespace: string;
    sourceKey: string;
    aggregate: {
        type: string;
        id: string;
    };
    templateKey: string;
    channel: NotificationChannel;
    recipient: RecipientChannelRoute;
    rendered: RenderedNotification;
    dedupeKey: string;
    payloadFingerprint: string;
    requestFingerprint: string;
    retryPolicy: RetryPolicy;
    metadata: Record<string, JsonValue>;
}
interface NotificationSkip {
    reason: NotificationSkipReason;
    selectorKey?: string;
    recipientKey?: string;
    channel?: string;
}
interface NotificationPlan {
    requestFingerprint: string;
    envelopes: NotificationDeliveryEnvelope[];
    skips: NotificationSkip[];
}
interface NotificationRequestContext {
    now: Date;
    traceId?: string;
}
interface RecipientResolver {
    resolve(request: NotificationRequest): Promise<ResolvedNotificationRecipient[]>;
}
interface NotificationTemplateDefinition<T extends JsonValue = JsonValue> {
    key: string;
    input: z.ZodType<T>;
    render(data: T, recipient: ResolvedNotificationRecipient): RenderedNotification;
}
interface NotificationChannelAdapter {
    channel: NotificationChannel;
    idempotent: boolean;
    send(input: {
        envelope: NotificationDeliveryEnvelope;
        attemptId: string;
    }): Promise<{
        providerMessageId?: string;
        receipt?: JsonValue;
    }>;
}
interface NotificationClock {
    now(): Date;
}
interface NotificationLogger {
    info(message: string, metadata?: Record<string, JsonValue>): void;
    warn(message: string, metadata?: Record<string, JsonValue>): void;
    error(message: string, metadata?: Record<string, JsonValue>): void;
}
interface ClaimedDelivery {
    id: string;
    envelope: NotificationDeliveryEnvelope;
    status: 'leased';
    attemptCount: number;
    leaseOwner: string;
    leaseExpiresAt: Date;
}
interface NotificationOutboxStore {
    insert(envelopes: NotificationDeliveryEnvelope[]): Promise<{
        inserted: NotificationDeliveryEnvelope[];
        existing: NotificationDeliveryEnvelope[];
    }>;
    claimDue(owner: string, now: Date, leaseMs: number, limit: number): Promise<ClaimedDelivery[]>;
    recordDelivered(input: {
        id: string;
        owner: string;
        providerMessageId?: string;
        receipt?: JsonValue;
    }): Promise<void>;
    recordRetry(input: {
        id: string;
        owner: string;
        availableAt: Date;
        errorCode: string;
        message: string;
    }): Promise<void>;
    recordFailed(input: {
        id: string;
        owner: string;
        errorCode: string;
        message: string;
    }): Promise<void>;
    recordSkipped(input: {
        id: string;
        owner: string;
        reason: string;
    }): Promise<void>;
    recordReconciliation(input: {
        id: string;
        owner: string;
        reason: string;
    }): Promise<void>;
    recoverExpired(now: Date): Promise<number>;
}
type DeliveryOutcome = {
    kind: 'delivered';
    providerMessageId?: string;
    receipt?: JsonValue;
} | {
    kind: 'retryable';
    errorCode: string;
    message: string;
    retryAfterMs?: number;
} | {
    kind: 'permanent';
    errorCode: string;
    message: string;
} | {
    kind: 'ambiguous';
    errorCode: string;
    message: string;
};

declare const jsonValueSchema: z.ZodType<JsonValue>;
declare const routeSchema: z.ZodObject<{
    channel: z.ZodString;
    canonicalKey: z.ZodString;
    address: z.ZodString;
    enabled: z.ZodOptional<z.ZodBoolean>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodType<JsonValue, z.ZodTypeDef, JsonValue>>>;
}, "strict", z.ZodTypeAny, {
    channel: string;
    canonicalKey: string;
    address: string;
    enabled?: boolean | undefined;
    metadata?: Record<string, JsonValue> | undefined;
}, {
    channel: string;
    canonicalKey: string;
    address: string;
    enabled?: boolean | undefined;
    metadata?: Record<string, JsonValue> | undefined;
}>;
declare const recipientSchema: z.ZodObject<{
    key: z.ZodString;
    label: z.ZodOptional<z.ZodString>;
    templateData: z.ZodOptional<z.ZodType<JsonValue, z.ZodTypeDef, JsonValue>>;
    routes: z.ZodArray<z.ZodObject<{
        channel: z.ZodString;
        canonicalKey: z.ZodString;
        address: z.ZodString;
        enabled: z.ZodOptional<z.ZodBoolean>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodType<JsonValue, z.ZodTypeDef, JsonValue>>>;
    }, "strict", z.ZodTypeAny, {
        channel: string;
        canonicalKey: string;
        address: string;
        enabled?: boolean | undefined;
        metadata?: Record<string, JsonValue> | undefined;
    }, {
        channel: string;
        canonicalKey: string;
        address: string;
        enabled?: boolean | undefined;
        metadata?: Record<string, JsonValue> | undefined;
    }>, "many">;
}, "strict", z.ZodTypeAny, {
    key: string;
    routes: {
        channel: string;
        canonicalKey: string;
        address: string;
        enabled?: boolean | undefined;
        metadata?: Record<string, JsonValue> | undefined;
    }[];
    label?: string | undefined;
    templateData?: JsonValue | undefined;
}, {
    key: string;
    routes: {
        channel: string;
        canonicalKey: string;
        address: string;
        enabled?: boolean | undefined;
        metadata?: Record<string, JsonValue> | undefined;
    }[];
    label?: string | undefined;
    templateData?: JsonValue | undefined;
}>;
declare const selectorSchema: z.ZodObject<{
    key: z.ZodString;
    data: z.ZodOptional<z.ZodType<JsonValue, z.ZodTypeDef, JsonValue>>;
}, "strict", z.ZodTypeAny, {
    key: string;
    data?: JsonValue | undefined;
}, {
    key: string;
    data?: JsonValue | undefined;
}>;
declare const requestSchema: z.ZodEffects<z.ZodObject<{
    namespace: z.ZodString;
    sourceKey: z.ZodString;
    aggregate: z.ZodObject<{
        type: z.ZodString;
        id: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        type: string;
        id: string;
    }, {
        type: string;
        id: string;
    }>;
    templateKey: z.ZodString;
    data: z.ZodType<JsonValue, z.ZodTypeDef, JsonValue>;
    channels: z.ZodEffects<z.ZodArray<z.ZodString, "many">, string[], string[]>;
    selectors: z.ZodOptional<z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        data: z.ZodOptional<z.ZodType<JsonValue, z.ZodTypeDef, JsonValue>>;
    }, "strict", z.ZodTypeAny, {
        key: string;
        data?: JsonValue | undefined;
    }, {
        key: string;
        data?: JsonValue | undefined;
    }>, "many">>;
    explicitRecipients: z.ZodOptional<z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        label: z.ZodOptional<z.ZodString>;
        templateData: z.ZodOptional<z.ZodType<JsonValue, z.ZodTypeDef, JsonValue>>;
        routes: z.ZodArray<z.ZodObject<{
            channel: z.ZodString;
            canonicalKey: z.ZodString;
            address: z.ZodString;
            enabled: z.ZodOptional<z.ZodBoolean>;
            metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodType<JsonValue, z.ZodTypeDef, JsonValue>>>;
        }, "strict", z.ZodTypeAny, {
            channel: string;
            canonicalKey: string;
            address: string;
            enabled?: boolean | undefined;
            metadata?: Record<string, JsonValue> | undefined;
        }, {
            channel: string;
            canonicalKey: string;
            address: string;
            enabled?: boolean | undefined;
            metadata?: Record<string, JsonValue> | undefined;
        }>, "many">;
    }, "strict", z.ZodTypeAny, {
        key: string;
        routes: {
            channel: string;
            canonicalKey: string;
            address: string;
            enabled?: boolean | undefined;
            metadata?: Record<string, JsonValue> | undefined;
        }[];
        label?: string | undefined;
        templateData?: JsonValue | undefined;
    }, {
        key: string;
        routes: {
            channel: string;
            canonicalKey: string;
            address: string;
            enabled?: boolean | undefined;
            metadata?: Record<string, JsonValue> | undefined;
        }[];
        label?: string | undefined;
        templateData?: JsonValue | undefined;
    }>, "many">>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodType<JsonValue, z.ZodTypeDef, JsonValue>>>;
}, "strict", z.ZodTypeAny, {
    data: JsonValue;
    namespace: string;
    sourceKey: string;
    aggregate: {
        type: string;
        id: string;
    };
    templateKey: string;
    channels: string[];
    metadata?: Record<string, JsonValue> | undefined;
    selectors?: {
        key: string;
        data?: JsonValue | undefined;
    }[] | undefined;
    explicitRecipients?: {
        key: string;
        routes: {
            channel: string;
            canonicalKey: string;
            address: string;
            enabled?: boolean | undefined;
            metadata?: Record<string, JsonValue> | undefined;
        }[];
        label?: string | undefined;
        templateData?: JsonValue | undefined;
    }[] | undefined;
}, {
    data: JsonValue;
    namespace: string;
    sourceKey: string;
    aggregate: {
        type: string;
        id: string;
    };
    templateKey: string;
    channels: string[];
    metadata?: Record<string, JsonValue> | undefined;
    selectors?: {
        key: string;
        data?: JsonValue | undefined;
    }[] | undefined;
    explicitRecipients?: {
        key: string;
        routes: {
            channel: string;
            canonicalKey: string;
            address: string;
            enabled?: boolean | undefined;
            metadata?: Record<string, JsonValue> | undefined;
        }[];
        label?: string | undefined;
        templateData?: JsonValue | undefined;
    }[] | undefined;
}>, {
    data: JsonValue;
    namespace: string;
    sourceKey: string;
    aggregate: {
        type: string;
        id: string;
    };
    templateKey: string;
    channels: string[];
    metadata?: Record<string, JsonValue> | undefined;
    selectors?: {
        key: string;
        data?: JsonValue | undefined;
    }[] | undefined;
    explicitRecipients?: {
        key: string;
        routes: {
            channel: string;
            canonicalKey: string;
            address: string;
            enabled?: boolean | undefined;
            metadata?: Record<string, JsonValue> | undefined;
        }[];
        label?: string | undefined;
        templateData?: JsonValue | undefined;
    }[] | undefined;
}, {
    data: JsonValue;
    namespace: string;
    sourceKey: string;
    aggregate: {
        type: string;
        id: string;
    };
    templateKey: string;
    channels: string[];
    metadata?: Record<string, JsonValue> | undefined;
    selectors?: {
        key: string;
        data?: JsonValue | undefined;
    }[] | undefined;
    explicitRecipients?: {
        key: string;
        routes: {
            channel: string;
            canonicalKey: string;
            address: string;
            enabled?: boolean | undefined;
            metadata?: Record<string, JsonValue> | undefined;
        }[];
        label?: string | undefined;
        templateData?: JsonValue | undefined;
    }[] | undefined;
}>;
declare const renderedSchema: z.ZodObject<{
    subject: z.ZodString;
    body: z.ZodString;
    severity: z.ZodOptional<z.ZodEnum<["info", "success", "warning", "error"]>>;
    actions: z.ZodOptional<z.ZodArray<z.ZodObject<{
        label: z.ZodString;
        url: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        label: string;
        url: string;
    }, {
        label: string;
        url: string;
    }>, "many">>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodType<JsonValue, z.ZodTypeDef, JsonValue>>>;
}, "strict", z.ZodTypeAny, {
    subject: string;
    body: string;
    metadata?: Record<string, JsonValue> | undefined;
    severity?: "info" | "success" | "warning" | "error" | undefined;
    actions?: {
        label: string;
        url: string;
    }[] | undefined;
}, {
    subject: string;
    body: string;
    metadata?: Record<string, JsonValue> | undefined;
    severity?: "info" | "success" | "warning" | "error" | undefined;
    actions?: {
        label: string;
        url: string;
    }[] | undefined;
}>;
declare const retryPolicySchema: z.ZodObject<{
    maxAttempts: z.ZodNumber;
    initialDelayMs: z.ZodNumber;
    multiplier: z.ZodNumber;
    maxDelayMs: z.ZodNumber;
    maxRetryWindowMs: z.ZodOptional<z.ZodNumber>;
}, "strict", z.ZodTypeAny, {
    maxAttempts: number;
    initialDelayMs: number;
    multiplier: number;
    maxDelayMs: number;
    maxRetryWindowMs?: number | undefined;
}, {
    maxAttempts: number;
    initialDelayMs: number;
    multiplier: number;
    maxDelayMs: number;
    maxRetryWindowMs?: number | undefined;
}>;
declare const envelopeSchema: z.ZodObject<{
    namespace: z.ZodString;
    sourceKey: z.ZodString;
    aggregate: z.ZodObject<{
        type: z.ZodString;
        id: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        type: string;
        id: string;
    }, {
        type: string;
        id: string;
    }>;
    templateKey: z.ZodString;
    channel: z.ZodString;
    recipient: z.ZodObject<{
        channel: z.ZodString;
        canonicalKey: z.ZodString;
        address: z.ZodString;
        enabled: z.ZodOptional<z.ZodBoolean>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodType<JsonValue, z.ZodTypeDef, JsonValue>>>;
    }, "strict", z.ZodTypeAny, {
        channel: string;
        canonicalKey: string;
        address: string;
        enabled?: boolean | undefined;
        metadata?: Record<string, JsonValue> | undefined;
    }, {
        channel: string;
        canonicalKey: string;
        address: string;
        enabled?: boolean | undefined;
        metadata?: Record<string, JsonValue> | undefined;
    }>;
    rendered: z.ZodObject<{
        subject: z.ZodString;
        body: z.ZodString;
        severity: z.ZodOptional<z.ZodEnum<["info", "success", "warning", "error"]>>;
        actions: z.ZodOptional<z.ZodArray<z.ZodObject<{
            label: z.ZodString;
            url: z.ZodString;
        }, "strict", z.ZodTypeAny, {
            label: string;
            url: string;
        }, {
            label: string;
            url: string;
        }>, "many">>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodType<JsonValue, z.ZodTypeDef, JsonValue>>>;
    }, "strict", z.ZodTypeAny, {
        subject: string;
        body: string;
        metadata?: Record<string, JsonValue> | undefined;
        severity?: "info" | "success" | "warning" | "error" | undefined;
        actions?: {
            label: string;
            url: string;
        }[] | undefined;
    }, {
        subject: string;
        body: string;
        metadata?: Record<string, JsonValue> | undefined;
        severity?: "info" | "success" | "warning" | "error" | undefined;
        actions?: {
            label: string;
            url: string;
        }[] | undefined;
    }>;
    dedupeKey: z.ZodString;
    payloadFingerprint: z.ZodString;
    requestFingerprint: z.ZodString;
    retryPolicy: z.ZodObject<{
        maxAttempts: z.ZodNumber;
        initialDelayMs: z.ZodNumber;
        multiplier: z.ZodNumber;
        maxDelayMs: z.ZodNumber;
        maxRetryWindowMs: z.ZodOptional<z.ZodNumber>;
    }, "strict", z.ZodTypeAny, {
        maxAttempts: number;
        initialDelayMs: number;
        multiplier: number;
        maxDelayMs: number;
        maxRetryWindowMs?: number | undefined;
    }, {
        maxAttempts: number;
        initialDelayMs: number;
        multiplier: number;
        maxDelayMs: number;
        maxRetryWindowMs?: number | undefined;
    }>;
    metadata: z.ZodRecord<z.ZodString, z.ZodType<JsonValue, z.ZodTypeDef, JsonValue>>;
}, "strict", z.ZodTypeAny, {
    channel: string;
    metadata: Record<string, JsonValue>;
    namespace: string;
    sourceKey: string;
    aggregate: {
        type: string;
        id: string;
    };
    templateKey: string;
    recipient: {
        channel: string;
        canonicalKey: string;
        address: string;
        enabled?: boolean | undefined;
        metadata?: Record<string, JsonValue> | undefined;
    };
    rendered: {
        subject: string;
        body: string;
        metadata?: Record<string, JsonValue> | undefined;
        severity?: "info" | "success" | "warning" | "error" | undefined;
        actions?: {
            label: string;
            url: string;
        }[] | undefined;
    };
    dedupeKey: string;
    payloadFingerprint: string;
    requestFingerprint: string;
    retryPolicy: {
        maxAttempts: number;
        initialDelayMs: number;
        multiplier: number;
        maxDelayMs: number;
        maxRetryWindowMs?: number | undefined;
    };
}, {
    channel: string;
    metadata: Record<string, JsonValue>;
    namespace: string;
    sourceKey: string;
    aggregate: {
        type: string;
        id: string;
    };
    templateKey: string;
    recipient: {
        channel: string;
        canonicalKey: string;
        address: string;
        enabled?: boolean | undefined;
        metadata?: Record<string, JsonValue> | undefined;
    };
    rendered: {
        subject: string;
        body: string;
        metadata?: Record<string, JsonValue> | undefined;
        severity?: "info" | "success" | "warning" | "error" | undefined;
        actions?: {
            label: string;
            url: string;
        }[] | undefined;
    };
    dedupeKey: string;
    payloadFingerprint: string;
    requestFingerprint: string;
    retryPolicy: {
        maxAttempts: number;
        initialDelayMs: number;
        multiplier: number;
        maxDelayMs: number;
        maxRetryWindowMs?: number | undefined;
    };
}>;
type RequestInput = z.infer<typeof requestSchema>;

declare function canonicalJson(value: JsonValue): string;
declare function fingerprint(value: JsonValue): string;
declare function requestFingerprint(request: NotificationRequest): string;
declare function payloadFingerprint(envelope: Pick<NotificationDeliveryEnvelope, 'rendered' | 'recipient' | 'channel'>): string;
declare function deliveryDedupeKey(input: Pick<NotificationDeliveryEnvelope, 'namespace' | 'sourceKey' | 'templateKey' | 'channel'> & {
    recipientCanonicalKey: string;
}): string;
declare function attemptId(dedupeKey: string, attempt: number): string;

declare class RetryableNotificationError extends Error {
    readonly code: string;
    readonly retryAfterMs?: number | undefined;
    readonly kind = "retryable";
    constructor(code: string, message: string, retryAfterMs?: number | undefined);
}
declare class PermanentNotificationError extends Error {
    readonly code: string;
    readonly kind = "permanent";
    constructor(code: string, message: string);
}
declare class AmbiguousNotificationError extends Error {
    readonly code: string;
    readonly kind = "ambiguous";
    constructor(code: string, message: string);
}
declare function classifyError(error: unknown): Exclude<DeliveryOutcome, {
    kind: 'delivered';
}>;
declare function nextRetryAt(now: Date, attempt: number, policy: RetryPolicy, retryAfterMs?: number): Date | undefined;

declare class UnknownNotificationTemplateError extends Error {
}
declare class InvalidNotificationTemplateError extends Error {
}
interface TemplateRegistry {
    has(key: string): boolean;
    keys(): string[];
    validate(key: string, data: JsonValue): JsonValue;
    render(key: string, data: JsonValue, recipient: ResolvedNotificationRecipient): RenderedNotification;
}
declare function createTemplateRegistry(definitions: NotificationTemplateDefinition[]): TemplateRegistry;
declare function template<T extends JsonValue>(key: string, input: z.ZodType<T>, render: NotificationTemplateDefinition<T>['render']): NotificationTemplateDefinition<T>;

interface NormalizedRecipients {
    recipients: ResolvedNotificationRecipient[];
    skips: NotificationSkip[];
}
declare function resolveRecipients(request: NotificationRequest, resolver?: RecipientResolver): Promise<NormalizedRecipients>;
declare function selectRoutes(recipient: ResolvedNotificationRecipient, channels: NotificationChannel[]): {
    routes: ResolvedNotificationRecipient['routes'];
    skips: NotificationSkip[];
};

declare class NotificationIdempotencyConflictError extends Error {
}
interface PlannerOptions {
    resolver?: RecipientResolver;
    templates: TemplateRegistry;
    retryPolicies?: Record<string, RetryPolicy>;
    adapters?: Iterable<Pick<NotificationChannelAdapter, 'channel'>>;
}
declare function planNotification(input: NotificationRequest, options: PlannerOptions): Promise<NotificationPlan>;
declare function assertNoPayloadConflict(existing: NotificationDeliveryEnvelope, incoming: NotificationDeliveryEnvelope): void;
declare function validateEnvelope(envelope: NotificationDeliveryEnvelope): NotificationDeliveryEnvelope;

interface RegisteredAdapter extends NotificationChannelAdapter {
    retryPolicy: RetryPolicy;
    enabled: boolean;
}
declare class NotificationAdapterRegistry {
    private readonly entries;
    private frozen;
    register(adapter: RegisteredAdapter): void;
    freeze(): void;
    get(channel: string): RegisteredAdapter | undefined;
    values(): RegisteredAdapter[];
}

interface DeliveryRuntimeOptions {
    store: NotificationOutboxStore;
    adapters: NotificationAdapterRegistry;
    clock?: NotificationClock;
    logger?: NotificationLogger;
    leaseMs?: number;
}
declare class NotificationDeliveryRuntime {
    private readonly options;
    private readonly clock;
    constructor(options: DeliveryRuntimeOptions);
    deliverClaimed(claimed: ClaimedDelivery): Promise<void>;
    claimAndDeliver(owner: string, limit?: number): Promise<number>;
}

interface MemoryOutboxRow {
    id: string;
    envelope: NotificationDeliveryEnvelope;
    status: NotificationDeliveryStatus;
    attemptCount: number;
    availableAt: Date;
    leaseOwner?: string;
    leaseExpiresAt?: Date;
    error?: string;
}
declare class MemoryOutboxStore implements NotificationOutboxStore {
    readonly rows: MemoryOutboxRow[];
    restore(rows: MemoryOutboxRow[]): void;
    insert(envelopes: NotificationDeliveryEnvelope[]): Promise<{
        inserted: NotificationDeliveryEnvelope[];
        existing: NotificationDeliveryEnvelope[];
    }>;
    claimDue(owner: string, now: Date, leaseMs: number, limit: number): Promise<ClaimedDelivery[]>;
    private row;
    recordDelivered(input: {
        id: string;
        owner: string;
        providerMessageId?: string;
        receipt?: JsonValue;
    }): Promise<void>;
    recordRetry(input: {
        id: string;
        owner: string;
        availableAt: Date;
        errorCode: string;
        message: string;
    }): Promise<void>;
    recordFailed(input: {
        id: string;
        owner: string;
        errorCode: string;
        message: string;
    }): Promise<void>;
    recordSkipped(input: {
        id: string;
        owner: string;
        reason: string;
    }): Promise<void>;
    recordReconciliation(input: {
        id: string;
        owner: string;
        reason: string;
    }): Promise<void>;
    recoverExpired(now: Date): Promise<number>;
}

declare function testAdapter(channel: string, behavior?: 'success' | 'retry' | 'permanent' | 'ambiguous'): RegisteredAdapter;

declare function runDocumentReviewFixture(): Promise<{
    plan: NotificationPlan;
    rows: MemoryOutboxRow[];
}>;

declare const FLOWKIT_NOTIFY_VERSION = "0.1.0";

export { AmbiguousNotificationError, type ClaimedDelivery, type DeliveryOutcome, type DeliveryRuntimeOptions, FLOWKIT_NOTIFY_VERSION, InvalidNotificationTemplateError, type JsonPrimitive, type JsonValue, type MemoryOutboxRow, MemoryOutboxStore, type NormalizedRecipients, NotificationAdapterRegistry, type NotificationBinding, type NotificationChannel, type NotificationChannelAdapter, type NotificationClock, type NotificationDeliveryEnvelope, NotificationDeliveryRuntime, type NotificationDeliveryStatus, NotificationIdempotencyConflictError, type NotificationLogger, type NotificationOutboxStore, type NotificationPlan, type NotificationRequest, type NotificationRequestContext, type NotificationSkip, type NotificationSkipReason, type NotificationTemplateDefinition, PermanentNotificationError, type PlannerOptions, type RecipientChannelRoute, type RecipientResolver, type RecipientSelector, type RegisteredAdapter, type RenderedNotification, type RequestInput, type ResolvedNotificationRecipient, type RetryPolicy, RetryableNotificationError, type TemplateRegistry, UnknownNotificationTemplateError, assertNoPayloadConflict, attemptId, canonicalJson, classifyError, createTemplateRegistry, deliveryDedupeKey, envelopeSchema, fingerprint, jsonValueSchema, nextRetryAt, payloadFingerprint, planNotification, recipientSchema, renderedSchema, requestFingerprint, requestSchema, resolveRecipients, retryPolicySchema, routeSchema, runDocumentReviewFixture, selectRoutes, selectorSchema, template, testAdapter, validateEnvelope };
