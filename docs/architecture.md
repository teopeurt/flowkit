# FlowKit architecture

FlowKit separates a pure flow kernel from optional execution and integration layers.

```text
@teopeurt/flowkit-core ──────→ @teopeurt/flowkit-definitions
          ├────────────────→ @teopeurt/flowkit-tasks ───→ @teopeurt/flowkit-consumer ───→ @teopeurt/flowkit-temporal
          ├───────────────────────────────────────────→ @teopeurt/flowkit-consumer
          └────────────────────────────────────────────────────────────────────────→ @teopeurt/flowkit-temporal
@teopeurt/flowkit-temporal ─→ @teopeurt/flowkit-definitions
@teopeurt/flowkit-notify     (no declared FlowKit package dependency)
@teopeurt/flowkit-auth       (no declared FlowKit package dependency)
```

In dependency-edge form, the graph is `@teopeurt/flowkit-core → @teopeurt/flowkit-definitions`, `@teopeurt/flowkit-core → @teopeurt/flowkit-tasks`, `@teopeurt/flowkit-core → @teopeurt/flowkit-consumer`, `@teopeurt/flowkit-tasks → @teopeurt/flowkit-consumer`, `@teopeurt/flowkit-core → @teopeurt/flowkit-temporal`, `@teopeurt/flowkit-consumer → @teopeurt/flowkit-temporal`, and `@teopeurt/flowkit-temporal → @teopeurt/flowkit-definitions`.

`@teopeurt/flowkit-core` owns serializable flow definitions, validation, and pure state transitions. `@teopeurt/flowkit-definitions` owns the authoring format for those definitions — the YAML binding and the emitted JSON Schema — so authoring concerns never leak into the kernel. `@teopeurt/flowkit-tasks` projects committed transitions into task lifecycle concerns. `@teopeurt/flowkit-consumer` supplies consumer-facing integration contracts, and `@teopeurt/flowkit-temporal` executes a published, immutable definition snapshot in Temporal. `@teopeurt/flowkit-notify` plans and delivers notification work through consumer adapters. `@teopeurt/flowkit-auth` provides portable authentication and authorization contracts with explicit subpath integrations.

Package boundaries are compiled artifacts. Consumers use the published entry points listed in [package contracts](package-contracts.md), rather than relative paths into source. This preserves the same boundary for local workspace validation and installed packages.

## Distribution

During Phase 2, all seven packages remain private GitHub Packages. Installation requires a `read:packages` token and access to the hosting repository. The repository itself is Apache-2.0 licensed, but that does not change the Phase 2 distribution channel. Public npm publication follows in Phase 4.

For local work, Bun workspaces are the primary development setup. A consumer can temporarily use a sibling `workspace:` or `file:` override, validate its integration, then restore the released semver dependency. See the root README for install and development commands.
