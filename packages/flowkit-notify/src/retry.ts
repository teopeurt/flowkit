import type { DeliveryOutcome, RetryPolicy } from './contracts.js';

export class RetryableNotificationError extends Error { readonly kind = 'retryable'; constructor(readonly code: string, message: string, readonly retryAfterMs?: number) { super(message); } }
export class PermanentNotificationError extends Error { readonly kind = 'permanent'; constructor(readonly code: string, message: string) { super(message); } }
export class AmbiguousNotificationError extends Error { readonly kind = 'ambiguous'; constructor(readonly code: string, message: string) { super(message); } }

export function classifyError(error: unknown): Exclude<DeliveryOutcome, { kind: 'delivered' }> {
  if (error instanceof RetryableNotificationError) return { kind: 'retryable', errorCode: error.code, message: error.message, retryAfterMs: error.retryAfterMs };
  if (error instanceof AmbiguousNotificationError) return { kind: 'ambiguous', errorCode: error.code, message: error.message };
  if (error instanceof PermanentNotificationError) return { kind: 'permanent', errorCode: error.code, message: error.message };
  return { kind: 'retryable', errorCode: 'UNKNOWN', message: error instanceof Error ? error.message : 'unknown delivery error' };
}

export function nextRetryAt(now: Date, attempt: number, policy: RetryPolicy, retryAfterMs?: number): Date | undefined {
  if (attempt >= policy.maxAttempts) return undefined;
  const calculated = Math.min(policy.maxDelayMs, policy.initialDelayMs * policy.multiplier ** Math.max(0, attempt - 1));
  const delay = Math.min(policy.maxDelayMs, Math.max(calculated, retryAfterMs ?? 0));
  const next = new Date(now.getTime() + delay);
  if (policy.maxRetryWindowMs !== undefined && next.getTime() > now.getTime() + policy.maxRetryWindowMs) return undefined;
  return next;
}
