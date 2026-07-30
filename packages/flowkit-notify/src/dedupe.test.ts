import { describe, expect, it } from 'bun:test';
import { attemptId, canonicalJson, deliveryDedupeKey, fingerprint } from './dedupe.js';

describe('dedupe identities', () => {
  it('sorts object keys but preserves arrays', () => {
    expect(canonicalJson({ b: 1, a: [2, 1] })).toBe('{"a":[2,1],"b":1}');
    expect(fingerprint({ a: 1 })).toBe(fingerprint({ a: 1 }));
  });
  it('creates non-PII, BullMQ-safe identities', () => {
    const key = deliveryDedupeKey({ namespace: 'x', sourceKey: 'y', templateKey: 'z', channel: 'email', recipientCanonicalKey: 'recipient-1' });
    expect(key).not.toContain('recipient-1');
    expect(attemptId(key, 2)).not.toContain(':');
  });
});
