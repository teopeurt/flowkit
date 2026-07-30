import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { planNotification, assertNoPayloadConflict } from './planner.js';
import { createTemplateRegistry, template } from './templates.js';

describe('notification planner', () => {
  const templates = createTemplateRegistry([template('reviewed', z.object({ ref: z.string() }).strict(), (data) => ({ subject: data.ref, body: `Reviewed ${data.ref}` }))]);
  const base = { namespace: 'odc', sourceKey: 'op-1', aggregate: { type: 'application', id: 'app-1' }, templateKey: 'reviewed', data: { ref: 'ODC-1' }, channels: ['email'], selectors: [{ key: 'company' }] };
  it('creates deterministic one-per-route envelopes', async () => {
    const plan = await planNotification(base, { templates, resolver: { resolve: async () => [{ key: 'r', routes: [{ channel: 'email', canonicalKey: 'r-email', address: 'r@example.test' }] }] } });
    expect(plan.envelopes.length).toBe(1);
    const again = await planNotification(base, { templates, resolver: { resolve: async () => [{ key: 'r', routes: [{ channel: 'email', canonicalKey: 'r-email', address: 'r@example.test' }] }] } });
    expect(again.envelopes[0].dedupeKey).toBe(plan.envelopes[0].dedupeKey);
  });
  it('detects a payload conflict', async () => {
    const plan = await planNotification(base, { templates, resolver: { resolve: async () => [{ key: 'r', routes: [{ channel: 'email', canonicalKey: 'r-email', address: 'r@example.test' }] }] } });
    const changed = { ...plan.envelopes[0], payloadFingerprint: 'sha256:' + '0'.repeat(64) };
    expect(() => assertNoPayloadConflict(plan.envelopes[0], changed)).toThrow();
  });
});
