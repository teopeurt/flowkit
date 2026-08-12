import { describe, expect, it } from 'bun:test';
import { AmbiguousNotificationError, PermanentNotificationError, RetryableNotificationError, classifyError, nextRetryAt } from './retry.js';

const policy = { maxAttempts: 3, initialDelayMs: 100, multiplier: 2, maxDelayMs: 500 };
describe('retry policy', () => {
  it('classifies outcomes and bounds retry-after', () => {
    expect(classifyError(new RetryableNotificationError('TIMEOUT', 'timeout', 1000)).kind).toBe('retryable');
    expect(classifyError(new PermanentNotificationError('BAD', 'bad')).kind).toBe('permanent');
    expect(classifyError(new AmbiguousNotificationError('UNKNOWN', 'unknown')).kind).toBe('ambiguous');
    expect(nextRetryAt(new Date(0), 1, policy, 1000)?.getTime()).toBe(500);
    expect(nextRetryAt(new Date(0), 3, policy)).toBe(undefined);
  });
});
