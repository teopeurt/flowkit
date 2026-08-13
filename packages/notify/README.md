# `@naakwu/flowkit-notify`

Notification template, planning, adapter, delivery-runtime, and testing contracts, exposed from `@naakwu/flowkit-notify`.

```ts
import { createTemplateRegistry, planNotification } from '@naakwu/flowkit-notify';

const createTemplates = createTemplateRegistry;
const plan = planNotification;
```

Consumers provide recipient resolution, durable outbox storage, provider credentials, transactions, and queue wakeups.
