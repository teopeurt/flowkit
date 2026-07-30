import { describe, expect, it } from 'bun:test';
import { runDocumentReviewFixture } from './document-review.fixture.js';

describe('document review fixture', () => {
  it('proves independent multi-channel fan-out and delivery', async () => {
    const result = await runDocumentReviewFixture();
    expect(result.plan.envelopes.length).toBe(4);
    expect(result.rows.every((row) => row.status === 'delivered')).toBe(true);
  });
});
