import type { NotificationDeliveryEnvelope, NotificationPlan, NotificationRequest, NotificationChannelAdapter, RecipientResolver, RetryPolicy } from './contracts.js';
import { envelopeSchema, requestSchema } from './schema.js';
import { deliveryDedupeKey, payloadFingerprint, requestFingerprint } from './dedupe.js';
import { resolveRecipients, selectRoutes } from './recipients.js';
import type { TemplateRegistry } from './templates.js';

export class NotificationIdempotencyConflictError extends Error {}

export interface PlannerOptions {
  resolver?: RecipientResolver;
  templates: TemplateRegistry;
  retryPolicies?: Record<string, RetryPolicy>;
  adapters?: Iterable<Pick<NotificationChannelAdapter, 'channel'>>;
}

export async function planNotification(input: NotificationRequest, options: PlannerOptions): Promise<NotificationPlan> {
  const request = requestSchema.parse(input);
  const fingerprintOfRequest = requestFingerprint(request);
  const resolved = await resolveRecipients(request, options.resolver);
  const envelopes: NotificationDeliveryEnvelope[] = [];
  const skips = [...resolved.skips];
  const enabledChannels = new Set([...options.adapters ?? []].map((adapter) => adapter.channel));
  for (const recipient of resolved.recipients) {
    const selection = selectRoutes(recipient, request.channels);
    skips.push(...selection.skips);
    for (const route of selection.routes) {
      if (enabledChannels.size > 0 && !enabledChannels.has(route.channel)) { skips.push({ reason: 'disabled_channel', recipientKey: recipient.key, channel: route.channel }); continue; }
      const rendered = options.templates.render(request.templateKey, request.data, recipient);
      const envelope = {
        namespace: request.namespace,
        sourceKey: request.sourceKey,
        aggregate: request.aggregate,
        templateKey: request.templateKey,
        channel: route.channel,
        recipient: route,
        rendered,
        dedupeKey: deliveryDedupeKey({ namespace: request.namespace, sourceKey: request.sourceKey, templateKey: request.templateKey, channel: route.channel, recipientCanonicalKey: route.canonicalKey }),
        payloadFingerprint: '',
        requestFingerprint: fingerprintOfRequest,
        retryPolicy: options.retryPolicies?.[route.channel] ?? { maxAttempts: 3, initialDelayMs: 1000, multiplier: 2, maxDelayMs: 60_000 },
        metadata: request.metadata ?? {},
      } satisfies Omit<NotificationDeliveryEnvelope, 'payloadFingerprint'> & { payloadFingerprint: string };
      envelope.payloadFingerprint = payloadFingerprint(envelope);
      envelopes.push(Object.freeze(envelope));
    }
  }
  return Object.freeze({ requestFingerprint: fingerprintOfRequest, envelopes, skips });
}

export function assertNoPayloadConflict(existing: NotificationDeliveryEnvelope, incoming: NotificationDeliveryEnvelope): void {
  if (existing.payloadFingerprint !== incoming.payloadFingerprint) throw new NotificationIdempotencyConflictError(existing.dedupeKey);
}

export function validateEnvelope(envelope: NotificationDeliveryEnvelope): NotificationDeliveryEnvelope { return envelopeSchema.parse(envelope); }
