import type { NotificationDeliveryEnvelope } from '../contracts.js';
import { RetryableNotificationError, PermanentNotificationError, AmbiguousNotificationError } from '../retry.js';
import type { RegisteredAdapter } from '../adapters.js';

export function testAdapter(channel: string, behavior: 'success' | 'retry' | 'permanent' | 'ambiguous' = 'success'): RegisteredAdapter {
  return { channel, enabled: true, idempotent: behavior !== 'ambiguous', retryPolicy: { maxAttempts: 3, initialDelayMs: 0, multiplier: 2, maxDelayMs: 1000 }, send: async (_input: { envelope: NotificationDeliveryEnvelope; attemptId: string }) => {
    if (behavior === 'retry') throw new RetryableNotificationError('TIMEOUT', 'temporary failure');
    if (behavior === 'permanent') throw new PermanentNotificationError('BAD_PAYLOAD', 'permanent failure');
    if (behavior === 'ambiguous') throw new AmbiguousNotificationError('UNKNOWN', 'provider result unknown');
    return { providerMessageId: `${channel}-message` };
  } };
}
