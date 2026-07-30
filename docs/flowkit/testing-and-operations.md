# Testing and Operations

Fast validation requires only Bun:

```bash
bun run --cwd packages/flowkit-demo typecheck
bun run --cwd packages/flowkit-demo test
bun run --cwd packages/flowkit-demo build
```

The real stack is disposable and uses PostgreSQL on `5441`, the API on `3011`, the internal
workflow runtime on `7233`, and Mailpit on `8025`. Start it with
`bun run --cwd packages/flowkit-demo stack:up` only after the disposable migration/seed operation
has been explicitly approved. Stop with `stack:down`.

With the healthy stack already running, the browser proof is:

```bash
bun run --cwd packages/flowkit-demo test:browser
```

The suite is intentionally black-box: it signs in through the development-only selector, creates
and submits a five-day request, has the assigned manager claim then approve/reject it, verifies the
final Flowkit flow state and immutable timeline, waits for a durable inbox entry and worker
heartbeats, and queries Mailpit for an approval email. It never invokes a runtime-engine endpoint
or applies migrations. Use `FLOWKIT_DEMO_URL` and `FLOWKIT_DEMO_MAILPIT_URL` for overridden host
ports.

All three specs passed against the live stack on July 30, 2026, and passed again immediately
afterwards without a database reset. Getting there required fixing four defects the Bun suites
could not see, because each only appears once a real runtime and a real database are involved:

- the command side sent an anonymous workflow value as the workflow type, so no flow could start;
  the registered export name is now sent instead
- the workflow module read configuration at import time, which throws in the deterministic sandbox
  where `process` does not exist
- an interpreter operation id is unique only within its flow, so the globally unique operation keys
  collided and only the first flow ever could auto-route; ids are now qualified by flow
- `jsonb` columns were written as `JSON.stringify(...)::jsonb`, which stores a JSON *string*, so
  every `->`/`->>` read of them silently returned null — this broke transition dedupe and the
  delivery list; `src/db/jsonb.ts` now binds real `jsonb`

The Compose `api` service also had no `TEMPORAL_ADDRESS`, so it resolved the runtime as `localhost`
inside its container.

Tests must not call external identity, business, or email services. Time-skipping semantics are
represented by deterministic tests; Docker black-box testing is an operational gate and is not
run automatically by the unit suite. Never upload cookies, credentials, SMTP bodies, or database
dumps as CI artifacts — Playwright traces hold session cookies and are gitignored for that reason.
