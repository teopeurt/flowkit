import { describe, expect, it } from 'bun:test';
import { NotificationAdapterRegistry } from './adapters.js';
import { NotificationDeliveryRuntime } from './delivery-runtime.js';
import { planNotification } from './planner.js';
import { createTemplateRegistry, template } from './templates.js';
import { MemoryOutboxStore } from './testing/memory-outbox-store.js';
import { testAdapter } from './testing/test-adapters.js';
import { z } from 'zod';

describe('delivery runtime', () => {
  async function setup(behavior: Parameters<typeof testAdapter>[1] = 'success') {
    const templates = createTemplateRegistry([template('reviewed', z.object({ ref: z.string() }), (data) => ({ subject: data.ref, body: 'body' }))]);
    const plan = await planNotification({ namespace: 'x', sourceKey: 's', aggregate: { type: 'a', id: '1' }, templateKey: 'reviewed', data: { ref: '1' }, channels: ['email'], explicitRecipients: [{ key: 'r', routes: [{ channel: 'email', canonicalKey: 'r-email', address: 'r@example.test' }] }] }, { templates });
    const store = new MemoryOutboxStore(); await store.insert(plan.envelopes); const adapters = new NotificationAdapterRegistry(); adapters.register(testAdapter('email', behavior)); adapters.freeze();
    return { store, runtime: new NotificationDeliveryRuntime({ store, adapters, clock: { now: () => new Date(0) } }) };
  }
  it('delivers successful claims', async () => { const { store, runtime } = await setup(); await runtime.claimAndDeliver('worker'); expect(store.rows[0].status).toBe('delivered'); });
  it('records permanent and ambiguous outcomes', async () => { const permanent = await setup('permanent'); await permanent.runtime.claimAndDeliver('worker'); expect(permanent.store.rows[0].status).toBe('failed'); const ambiguous = await setup('ambiguous'); await ambiguous.runtime.claimAndDeliver('worker'); expect(ambiguous.store.rows[0].status).toBe('reconciliation_required'); });
  it('requeues retryable failures', async () => { const { store, runtime } = await setup('retry'); await runtime.claimAndDeliver('worker'); expect(store.rows[0].status).toBe('pending'); });
});
