import { timingSafeEqual } from 'node:crypto';
export function parseTestOtpCodes(environment: 'development' | 'test' | 'production', values: Record<string, string> | undefined) { if (environment === 'production' && values && Object.keys(values).length) throw new Error('Fixed OTP codes are not allowed in production'); return Object.freeze({ ...(values ?? {}) }); }
export function matchesTestOtp(expected: string | undefined, actual: string): boolean { if (!expected || expected.length !== actual.length) return false; return timingSafeEqual(Buffer.from(expected), Buffer.from(actual)); }
