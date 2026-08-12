# `@flowkit/notify`

Portable notification planning and delivery contracts for Flowkit consumers.

The package validates requests, resolves domain-owned recipients, renders strict templates, creates immutable channel/recipient envelopes, derives deterministic non-PII delivery identities, and executes one provider attempt at a time through consumer adapters. A consumer supplies the durable outbox implementation and keeps provider credentials, database transactions, and queue wakeups outside this package.

```ts
const plan = await planNotification(request, {
  resolver,
  templates,
  retryPolicies: { email: { maxAttempts: 3, initialDelayMs: 1_000, multiplier: 2, maxDelayMs: 60_000 } },
});
await outbox.insert(plan.envelopes); // same consumer transaction as the source operation
```

Adapters receive the frozen envelope and its deterministic delivery key. The runtime classifies outcomes as delivered, retryable, permanent, or ambiguous. Queue jobs should wake one claimed outbox row and use attempt `1`; retry scheduling is owned by the outbox runtime rather than by queue-level attempts.

The package intentionally has no NestJS, BullMQ, Drizzle, PostgreSQL, Redis, Temporal, FAAN, SMTP, Resend, or SSE dependency. See `src/testing/document-review.fixture.ts` for an independent fan-out and delivery example.
