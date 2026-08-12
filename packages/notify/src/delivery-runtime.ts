import type { ClaimedDelivery, NotificationClock, NotificationLogger, NotificationOutboxStore } from './contracts.js';
import { attemptId } from './dedupe.js';
import { classifyError, nextRetryAt } from './retry.js';
import { NotificationAdapterRegistry } from './adapters.js';

export interface DeliveryRuntimeOptions {
  store: NotificationOutboxStore;
  adapters: NotificationAdapterRegistry;
  clock?: NotificationClock;
  logger?: NotificationLogger;
  leaseMs?: number;
}

const systemClock: NotificationClock = { now: () => new Date() };
export class NotificationDeliveryRuntime {
  private readonly clock: NotificationClock;
  constructor(private readonly options: DeliveryRuntimeOptions) { this.clock = options.clock ?? systemClock; }

  async deliverClaimed(claimed: ClaimedDelivery): Promise<void> {
    const adapter = this.options.adapters.get(claimed.envelope.channel);
    if (!adapter || !adapter.enabled) { await this.options.store.recordSkipped({ id: claimed.id, owner: claimed.leaseOwner, reason: 'disabled_channel' }); return; }
    try {
      const result = await adapter.send({ envelope: claimed.envelope, attemptId: attemptId(claimed.envelope.dedupeKey, claimed.attemptCount) });
      await this.options.store.recordDelivered({ id: claimed.id, owner: claimed.leaseOwner, providerMessageId: result.providerMessageId, receipt: result.receipt });
    } catch (error) {
      const outcome = classifyError(error);
      if (outcome.kind === 'ambiguous' || !adapter.idempotent) {
        await this.options.store.recordReconciliation({ id: claimed.id, owner: claimed.leaseOwner, reason: outcome.message });
        return;
      }
      if (outcome.kind === 'permanent') { await this.options.store.recordFailed({ id: claimed.id, owner: claimed.leaseOwner, errorCode: outcome.errorCode, message: outcome.message }); return; }
      const availableAt = nextRetryAt(this.clock.now(), claimed.attemptCount, adapter.retryPolicy, outcome.retryAfterMs);
      if (!availableAt) { await this.options.store.recordFailed({ id: claimed.id, owner: claimed.leaseOwner, errorCode: outcome.errorCode, message: outcome.message }); return; }
      await this.options.store.recordRetry({ id: claimed.id, owner: claimed.leaseOwner, availableAt, errorCode: outcome.errorCode, message: outcome.message });
    }
  }

  async claimAndDeliver(owner: string, limit = 10): Promise<number> {
    const now = this.clock.now();
    await this.options.store.recoverExpired(now);
    const claimed = await this.options.store.claimDue(owner, now, this.options.leaseMs ?? 60_000, limit);
    for (const delivery of claimed) await this.deliverClaimed(delivery);
    return claimed.length;
  }
}
