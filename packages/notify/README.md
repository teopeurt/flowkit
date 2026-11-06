> Versions through 1.0.0 used `@naakwu/*`; from 1.1.0 use the public `@teopeurt/*` package with the same API.

# `@teopeurt/flowkit-notify`

Notification template, planning, adapter, delivery-runtime, and testing contracts, exposed from `@teopeurt/flowkit-notify`.

```ts
import { createTemplateRegistry, planNotification } from '@teopeurt/flowkit-notify';

const createTemplates = createTemplateRegistry;
const plan = planNotification;
```

Consumers provide recipient resolution, durable outbox storage, provider credentials, transactions, and queue wakeups.
