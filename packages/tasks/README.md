> Versions through 1.0.0 used `@naakwu/*`; from 1.1.0 use the public `@teopeurt/*` package with the same API.

# `@teopeurt/flowkit-tasks`

Human-task projection, claiming, inbox, invitation, and testing contracts, exposed from `@teopeurt/flowkit-tasks`.

```ts
import { MemoryTaskStore, planTaskProjection } from '@teopeurt/flowkit-tasks';

const store = new MemoryTaskStore();
const project = planTaskProjection;
```

Consumers provide durable storage, eligibility resolution, identity provisioning, clocks, and notification adapters.
