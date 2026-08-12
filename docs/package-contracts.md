# Package Contracts

| Package | Owns | Demo uses |
|---|---|---|
| `@flowkit/core` | strict definitions, linting, pure transitions | leave definition and state changes |
| `@flowkit/temporal` | immutable snapshots, validation, workflow interpreter | definition publication and worker registration |
| `@flowkit/tasks` | task projections, revisions, claims, history | employee/manager task store |
| `@flowkit/notify` | templates, recipients, envelopes, outbox runtime | inbox/email fan-out and dedupe |
| `@flowkit/auth` | role registry, principals, Nest integration | local roles and authorization facts |

The demo owns PostgreSQL schema, BetterAuth wiring, SMTP/Mailpit adapters, domain repositories,
HTTP controllers, and process lifecycle. It may only import built package entry points. The
machine-readable manifest is `packages/flowkit-demo/package-contracts.json`.
