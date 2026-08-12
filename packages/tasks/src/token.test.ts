import { describe, expect, it } from 'bun:test';
import { hashContact, hashInvitationToken, requireTokenEntropy } from './token.js';

describe('invitation token helpers', () => {
  it('hashes tokens and contacts without exposing raw values', () => {
    const raw = 'a'.repeat(64); const hash = hashInvitationToken(raw);
    expect(hash).not.toContain(raw); expect(hashContact({ key: 'test-key', normalized: 'user@example.test' })).toBe(hashContact({ key: 'test-key', normalized: 'user@example.test' }));
    expect(() => requireTokenEntropy('short')).toThrow();
  });
});
