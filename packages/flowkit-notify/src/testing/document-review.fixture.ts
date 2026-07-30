import { z } from 'zod';
import { NotificationAdapterRegistry } from '../adapters.js';
import { NotificationDeliveryRuntime } from '../delivery-runtime.js';
import { planNotification } from '../planner.js';
import { createTemplateRegistry, template } from '../templates.js';
import { MemoryOutboxStore } from './memory-outbox-store.js';
import { testAdapter } from './test-adapters.js';

export async function runDocumentReviewFixture() {
  const templates = createTemplateRegistry([template('document-reviewed', z.object({ reference: z.string() }).strict(), (data) => ({ subject: `Document ${data.reference}`, body: 'Your document was reviewed.' }))]);
  const request = { namespace: 'fixture', sourceKey: 'document-review-1', aggregate: { type: 'application', id: 'application-1' }, templateKey: 'document-reviewed', data: { reference: 'ODC-1' }, channels: ['in-app', 'email'], selectors: [{ key: 'applicant' }, { key: 'company' }] };
  const plan = await planNotification(request, { templates, resolver: { resolve: async () => [
    { key: 'applicant', routes: [{ channel: 'in-app', canonicalKey: 'applicant-inbox', address: 'applicant' }, { channel: 'email', canonicalKey: 'applicant-email', address: 'applicant@example.test' }] },
    { key: 'company', routes: [{ channel: 'in-app', canonicalKey: 'company-inbox', address: 'company' }, { channel: 'email', canonicalKey: 'company-email', address: 'company@example.test' }] },
  ] } });
  const store = new MemoryOutboxStore(); await store.insert(plan.envelopes);
  const adapters = new NotificationAdapterRegistry(); adapters.register(testAdapter('in-app')); adapters.register(testAdapter('email')); adapters.freeze();
  const runtime = new NotificationDeliveryRuntime({ store, adapters, clock: { now: () => new Date(0) } });
  await runtime.claimAndDeliver('fixture-worker', 20);
  return { plan, rows: store.rows };
}
