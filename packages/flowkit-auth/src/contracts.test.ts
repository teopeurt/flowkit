import { describe, expect, it } from 'bun:test';
import { parseAuthConfig } from './config';
import { AuthError } from './errors';
import { freezePrincipal } from './principal';
describe('portable contracts', () => {
  it('rejects fixed OTP configuration in production', () => expect(() => parseAuthConfig({ environment: 'production', sessionTtlSeconds: 3600, allowFixedTestOtp: true })).toThrow());
  it('freezes principal authorization facts', () => { const principal = freezePrincipal({ authUserId: 'a', subjectId: 's', role: 'reviewer', permissions: ['case:read'], readOnly: true, identityProofs: [{ kind: 'email', normalizedValue: 'a@example.com', verified: true }], session: { id: 'session', expiresAt: '2030-01-01T00:00:00.000Z' } }); expect(Object.isFrozen(principal)).toBe(true); expect(Object.isFrozen(principal.permissions)).toBe(true); });
  it('exposes stable typed error codes', () => expect(new AuthError('permission_denied', 'denied').code).toBe('permission_denied'));
});
