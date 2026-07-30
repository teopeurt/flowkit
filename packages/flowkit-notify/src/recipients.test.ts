import { describe, expect, it } from 'bun:test';
import { resolveRecipients, selectRoutes } from './recipients.js';

describe('recipient normalization', () => {
  it('deduplicates repeated recipients and reports missing or disabled routes', async () => {
    const request = { namespace: 'x', sourceKey: 's', aggregate: { type: 'a', id: '1' }, templateKey: 't', data: {}, channels: ['email', 'in-app'], selectors: [{ key: 'users' }] };
    const result = await resolveRecipients(request, { resolve: async () => [{ key: 'r', routes: [
      { channel: 'email', canonicalKey: 'email-r', address: 'x@example.test' },
      { channel: 'email', canonicalKey: 'email-r', address: 'x@example.test' },
      { channel: 'in-app', canonicalKey: 'inapp-r', address: 'r', enabled: false },
    ] }] });
    expect(result.recipients[0].routes.length).toBe(2);
    const selected = selectRoutes(result.recipients[0], ['email', 'in-app', 'sms']);
    expect(selected.routes.length).toBe(1);
    expect(selected.skips.length).toBe(2);
  });
});
