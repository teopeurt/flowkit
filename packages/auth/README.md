> Versions through 1.0.0 used `@naakwu/*`; from 1.1.0 use the public `@teopeurt/*` package with the same API.

# `@teopeurt/flowkit-auth`

Portable authentication and authorization contracts. Its public entry points are `.`, `./roles`, `./better-auth`, `./nest`, and `./testing`.

Use the role entry point for browser-safe role definitions; use the explicit Better Auth and Nest entry points only in server integrations.

```ts
import { defineRoleRegistry } from '@teopeurt/flowkit-auth/roles';

const roles = defineRoleRegistry({ reviewer: {
  label: 'Reviewer', permissions: ['case:read'], scopes: ['case'],
  kind: 'external', provisioning: 'self_service',
} });
```

Consumers own their identities, memberships, persistence, and application roles.
