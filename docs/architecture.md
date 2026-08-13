# FlowKit architecture

FlowKit separates a pure flow kernel from optional execution and integration layers.

```text
@naakwu/flowkit-core ──────→ @naakwu/flowkit-tasks ───→ @naakwu/flowkit-consumer ───→ @naakwu/flowkit-temporal
          └───────────────────────────────────────────→ @naakwu/flowkit-consumer
          └────────────────────────────────────────────────────────────────────────→ @naakwu/flowkit-temporal
@naakwu/flowkit-notify     (no declared FlowKit package dependency)
@naakwu/flowkit-auth       (no declared FlowKit package dependency)
```

In dependency-edge form, the graph is `@naakwu/flowkit-core → @naakwu/flowkit-tasks`, `@naakwu/flowkit-core → @naakwu/flowkit-consumer`, `@naakwu/flowkit-tasks → @naakwu/flowkit-consumer`, `@naakwu/flowkit-core → @naakwu/flowkit-temporal`, and `@naakwu/flowkit-consumer → @naakwu/flowkit-temporal`.

`@naakwu/flowkit-core` owns serializable flow definitions, validation, and pure state transitions. `@naakwu/flowkit-tasks` projects committed transitions into task lifecycle concerns. `@naakwu/flowkit-consumer` supplies consumer-facing integration contracts, and `@naakwu/flowkit-temporal` executes a published, immutable definition snapshot in Temporal. `@naakwu/flowkit-notify` plans and delivers notification work through consumer adapters. `@naakwu/flowkit-auth` provides portable authentication and authorization contracts with explicit subpath integrations.

Package boundaries are compiled artifacts. Consumers use the published entry points listed in [package contracts](package-contracts.md), rather than relative paths into source. This preserves the same boundary for local workspace validation and installed packages.

## Distribution

During Phase 2, all six packages remain private GitHub Packages. Installation requires a `read:packages` token and access to the hosting repository. The repository itself is Apache-2.0 licensed, but that does not change the Phase 2 distribution channel. Public npm publication follows in Phase 4.

For local work, Bun workspaces are the primary development setup. A consumer can temporarily use a sibling `workspace:` or `file:` override, validate its integration, then restore the released semver dependency. See the root README for install and development commands.
