# FlowKit package contracts

Only the entry points declared in each package's `package.json` `exports` map are public. Consumers import package names, never a sibling package's `src/` directory.

| Package | Public entry points | Purpose |
| --- | --- | --- |
| `@naakwu/flowkit-core` | `.` | Flow definitions, validation/linting, initial state, and pure transitions. |
| `@naakwu/flowkit-tasks` | `.` | Task projection, claim, inbox, invitation, and testing helpers. |
| `@naakwu/flowkit-consumer` | `.` | Consumer integration contracts and `createFlowkitConsumer`. |
| `@naakwu/flowkit-temporal` | `.`, `./workflow` | Published definition/runtime helpers and the Temporal workflow factory. |
| `@naakwu/flowkit-notify` | `.` | Notification templates, planning, adapters, delivery runtime, and testing helpers. |
| `@naakwu/flowkit-auth` | `.`, `./roles`, `./better-auth`, `./nest`, `./testing` | Auth contracts plus explicit role, Better Auth, Nest, and testing integrations. |

The declared internal dependency edges (dependency → dependent) are:

- `@naakwu/flowkit-core → @naakwu/flowkit-tasks`
- `@naakwu/flowkit-core → @naakwu/flowkit-consumer`
- `@naakwu/flowkit-tasks → @naakwu/flowkit-consumer`
- `@naakwu/flowkit-core → @naakwu/flowkit-temporal`
- `@naakwu/flowkit-consumer → @naakwu/flowkit-temporal`

`@naakwu/flowkit-notify` and `@naakwu/flowkit-auth` have no declared FlowKit package dependency. Refer to the individual READMEs for usage. Every package emits ESM, CommonJS, and declaration artifacts under `dist/`.

Phase 2 packages are private GitHub Packages. They require a `read:packages` token and repository access. Public npm publication is planned for Phase 4.
