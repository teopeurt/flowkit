# FlowKit package contracts

Only the entry points declared in each package's `package.json` `exports` map are public. Consumers import package names, never a sibling package's `src/` directory.

| Package | Public entry points | Purpose |
| --- | --- | --- |
| `@teopeurt/flowkit-core` | `.` | Flow definitions, validation/linting, initial state, and pure transitions. |
| `@teopeurt/flowkit-definitions` | `.` | Definition authoring format (YAML) and the emitted definition JSON Schema. |
| `@teopeurt/flowkit-tasks` | `.` | Task projection, claim, inbox, invitation, and testing helpers. |
| `@teopeurt/flowkit-consumer` | `.` | Consumer integration contracts and `createFlowkitConsumer`. |
| `@teopeurt/flowkit-temporal` | `.`, `./workflow` | Published definition/runtime helpers, the Temporal workflow factory, and the orchestration activity contracts. |
| `@teopeurt/flowkit-notify` | `.` | Notification templates, planning, adapters, delivery runtime, and testing helpers. |
| `@teopeurt/flowkit-auth` | `.`, `./roles`, `./better-auth`, `./nest`, `./testing` | Auth contracts plus explicit role, Better Auth, Nest, and testing integrations. |

The declared internal dependency edges (dependency → dependent) are:

- `@teopeurt/flowkit-core → @teopeurt/flowkit-definitions`
- `@teopeurt/flowkit-core → @teopeurt/flowkit-tasks`
- `@teopeurt/flowkit-core → @teopeurt/flowkit-consumer`
- `@teopeurt/flowkit-tasks → @teopeurt/flowkit-consumer`
- `@teopeurt/flowkit-core → @teopeurt/flowkit-temporal`
- `@teopeurt/flowkit-consumer → @teopeurt/flowkit-temporal`
- `@teopeurt/flowkit-temporal → @teopeurt/flowkit-definitions`

`@teopeurt/flowkit-notify` and `@teopeurt/flowkit-auth` have no declared FlowKit package dependency.
`@teopeurt/flowkit-definitions` ships its schema as `schema/flowdefinition.schema.json` alongside its
runtime entry point. Refer to the individual READMEs for usage. Every package emits ESM, CommonJS, and declaration artifacts under `dist/`.

Packages are published on npmjs.org; installing them needs no token or registry configuration. Releases are mirrored to GitHub Packages, which requires a `read:packages` token and repository access.
