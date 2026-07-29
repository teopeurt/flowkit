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

Tests must not call external identity, business, or email services. Time-skipping semantics are
represented by deterministic tests; Docker black-box testing is an operational gate and is not
run automatically by the unit suite. Never upload cookies, credentials, SMTP bodies, or database
dumps as CI artifacts.
