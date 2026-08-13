# @naakwu/flowkit-auth

Portable authentication and authorization contracts for BetterAuth consumers.

The root and `@naakwu/flowkit-auth/roles` exports are browser-safe. Server integrations are explicit:
`/better-auth` provides configuration and policy factories, `/nest` provides guards and decorators,
and `/testing` provides in-memory stores and an unrelated leave-approval fixture.

```ts
import { defineRoleRegistry } from '@naakwu/flowkit-auth/roles';
const roles = defineRoleRegistry({ reviewer: {
  label: 'Reviewer', permissions: ['case:read'], scopes: ['case'],
  kind: 'external', provisioning: 'self_service'
} });
```

Authentication proves a session; authorization is resolved from consumer-owned roles, identities, and
memberships. The package does not own a schema, database, Redis client, SMS provider, organization
model, or application roles. BetterAuth compatibility is pinned to `1.3.34`.
