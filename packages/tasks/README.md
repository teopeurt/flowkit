# `@naakwu/flowkit-tasks`

Human-task projection, claiming, inbox, invitation, and testing contracts, exposed from `@naakwu/flowkit-tasks`.

```ts
import { MemoryTaskStore, planTaskProjection } from '@naakwu/flowkit-tasks';

const store = new MemoryTaskStore();
const project = planTaskProjection;
```

Consumers provide durable storage, eligibility resolution, identity provisioning, clocks, and notification adapters.
