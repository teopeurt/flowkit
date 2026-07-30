import type { ClaimedDelivery, JsonValue, NotificationDeliveryEnvelope, NotificationOutboxStore, NotificationDeliveryStatus } from '../contracts.js';

export interface MemoryOutboxRow { id: string; envelope: NotificationDeliveryEnvelope; status: NotificationDeliveryStatus; attemptCount: number; availableAt: Date; leaseOwner?: string; leaseExpiresAt?: Date; error?: string; }
export class MemoryOutboxStore implements NotificationOutboxStore {
  readonly rows: MemoryOutboxRow[] = [];
  restore(rows: MemoryOutboxRow[]) { this.rows.length = 0; this.rows.push(...rows.map((row) => ({ ...row, availableAt: new Date(row.availableAt), leaseExpiresAt: row.leaseExpiresAt ? new Date(row.leaseExpiresAt) : undefined }))); }
  async insert(envelopes: NotificationDeliveryEnvelope[]) {
    const inserted: NotificationDeliveryEnvelope[] = []; const existing: NotificationDeliveryEnvelope[] = [];
    for (const envelope of envelopes) {
      const row = this.rows.find((candidate) => candidate.envelope.dedupeKey === envelope.dedupeKey);
      if (row) existing.push(row.envelope); else { this.rows.push({ id: `delivery-${this.rows.length + 1}`, envelope, status: 'pending', attemptCount: 0, availableAt: new Date(0) }); inserted.push(envelope); }
    }
    return { inserted, existing };
  }
  async claimDue(owner: string, now: Date, leaseMs: number, limit: number): Promise<ClaimedDelivery[]> {
    return this.rows.filter((row) => row.status === 'pending' && row.availableAt <= now).slice(0, limit).map((row) => {
      row.status = 'leased'; row.attemptCount += 1; row.leaseOwner = owner; row.leaseExpiresAt = new Date(now.getTime() + leaseMs);
      return { id: row.id, envelope: row.envelope, status: 'leased', attemptCount: row.attemptCount, leaseOwner: owner, leaseExpiresAt: row.leaseExpiresAt };
    });
  }
  private row(id: string, owner: string): MemoryOutboxRow { const row = this.rows.find((candidate) => candidate.id === id); if (!row || row.leaseOwner !== owner || row.status !== 'leased') throw new Error('invalid delivery lease'); return row; }
  async recordDelivered(input: { id: string; owner: string; providerMessageId?: string; receipt?: JsonValue }) { const row = this.row(input.id, input.owner); row.status = 'delivered'; row.leaseOwner = undefined; }
  async recordRetry(input: { id: string; owner: string; availableAt: Date; errorCode: string; message: string }) { const row = this.row(input.id, input.owner); row.status = 'pending'; row.availableAt = input.availableAt; row.error = `${input.errorCode}: ${input.message}`; row.leaseOwner = undefined; }
  async recordFailed(input: { id: string; owner: string; errorCode: string; message: string }) { const row = this.row(input.id, input.owner); row.status = 'failed'; row.error = `${input.errorCode}: ${input.message}`; row.leaseOwner = undefined; }
  async recordSkipped(input: { id: string; owner: string; reason: string }) { const row = this.row(input.id, input.owner); row.status = 'skipped'; row.error = input.reason; row.leaseOwner = undefined; }
  async recordReconciliation(input: { id: string; owner: string; reason: string }) { const row = this.row(input.id, input.owner); row.status = 'reconciliation_required'; row.error = input.reason; row.leaseOwner = undefined; }
  async recoverExpired(now: Date) { let count = 0; for (const row of this.rows) if (row.status === 'leased' && row.leaseExpiresAt && row.leaseExpiresAt <= now) { row.status = 'pending'; row.leaseOwner = undefined; count += 1; } return count; }
}
