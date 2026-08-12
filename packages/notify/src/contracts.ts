import type { z } from 'zod';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type NotificationChannel = string;
export type NotificationDeliveryStatus =
  | 'pending'
  | 'leased'
  | 'delivered'
  | 'failed'
  | 'skipped'
  | 'reconciliation_required';

export type NotificationSkipReason =
  | 'unknown_selector'
  | 'missing_route'
  | 'disabled_channel'
  | 'invalid_recipient';

export interface RecipientSelector {
  key: string;
  data?: JsonValue;
}

export interface NotificationBinding {
  selector: RecipientSelector;
  channels: NotificationChannel[];
}

export interface NotificationRequest {
  namespace: string;
  sourceKey: string;
  aggregate: { type: string; id: string };
  templateKey: string;
  data: JsonValue;
  channels: NotificationChannel[];
  selectors?: RecipientSelector[];
  explicitRecipients?: ResolvedNotificationRecipient[];
  metadata?: Record<string, JsonValue>;
}

export interface RecipientChannelRoute {
  channel: NotificationChannel;
  canonicalKey: string;
  address: string;
  enabled?: boolean;
  metadata?: Record<string, JsonValue>;
}

export interface ResolvedNotificationRecipient {
  key: string;
  label?: string;
  templateData?: JsonValue;
  routes: RecipientChannelRoute[];
}

export interface RenderedNotification {
  subject: string;
  body: string;
  severity?: 'info' | 'success' | 'warning' | 'error';
  actions?: Array<{ label: string; url: string }>;
  metadata?: Record<string, JsonValue>;
}

export interface RetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  multiplier: number;
  maxDelayMs: number;
  maxRetryWindowMs?: number;
}

export interface NotificationDeliveryEnvelope {
  namespace: string;
  sourceKey: string;
  aggregate: { type: string; id: string };
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

export interface NotificationSkip {
  reason: NotificationSkipReason;
  selectorKey?: string;
  recipientKey?: string;
  channel?: string;
}

export interface NotificationPlan {
  requestFingerprint: string;
  envelopes: NotificationDeliveryEnvelope[];
  skips: NotificationSkip[];
}

export interface NotificationRequestContext {
  now: Date;
  traceId?: string;
}

export interface RecipientResolver {
  resolve(request: NotificationRequest): Promise<ResolvedNotificationRecipient[]>;
}

export interface NotificationTemplateDefinition<T extends JsonValue = JsonValue> {
  key: string;
  input: z.ZodType<T>;
  render(data: T, recipient: ResolvedNotificationRecipient): RenderedNotification;
}

export interface NotificationChannelAdapter {
  channel: NotificationChannel;
  idempotent: boolean;
  send(input: { envelope: NotificationDeliveryEnvelope; attemptId: string }): Promise<{
    providerMessageId?: string;
    receipt?: JsonValue;
  }>;
}

export interface NotificationClock {
  now(): Date;
}

export interface NotificationLogger {
  info(message: string, metadata?: Record<string, JsonValue>): void;
  warn(message: string, metadata?: Record<string, JsonValue>): void;
  error(message: string, metadata?: Record<string, JsonValue>): void;
}

export interface ClaimedDelivery {
  id: string;
  envelope: NotificationDeliveryEnvelope;
  status: 'leased';
  attemptCount: number;
  leaseOwner: string;
  leaseExpiresAt: Date;
}

export interface NotificationOutboxStore {
  insert(envelopes: NotificationDeliveryEnvelope[]): Promise<{
    inserted: NotificationDeliveryEnvelope[];
    existing: NotificationDeliveryEnvelope[];
  }>;
  claimDue(owner: string, now: Date, leaseMs: number, limit: number): Promise<ClaimedDelivery[]>;
  recordDelivered(input: { id: string; owner: string; providerMessageId?: string; receipt?: JsonValue }): Promise<void>;
  recordRetry(input: { id: string; owner: string; availableAt: Date; errorCode: string; message: string }): Promise<void>;
  recordFailed(input: { id: string; owner: string; errorCode: string; message: string }): Promise<void>;
  recordSkipped(input: { id: string; owner: string; reason: string }): Promise<void>;
  recordReconciliation(input: { id: string; owner: string; reason: string }): Promise<void>;
  recoverExpired(now: Date): Promise<number>;
}

export type DeliveryOutcome =
  | { kind: 'delivered'; providerMessageId?: string; receipt?: JsonValue }
  | { kind: 'retryable'; errorCode: string; message: string; retryAfterMs?: number }
  | { kind: 'permanent'; errorCode: string; message: string }
  | { kind: 'ambiguous'; errorCode: string; message: string };
