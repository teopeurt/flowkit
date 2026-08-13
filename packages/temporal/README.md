# `@naakwu/flowkit-temporal`

Temporal runtime helpers are exported from `@naakwu/flowkit-temporal`; the workflow factory is exported from `@naakwu/flowkit-temporal/workflow`.

```ts
import { publishDefinition } from '@naakwu/flowkit-temporal';
import { createFlowkitWorkflow } from '@naakwu/flowkit-temporal/workflow';

const publish = publishDefinition;
const workflowFactory = createFlowkitWorkflow;
```

Publish and verify an immutable definition snapshot before execution. Consumers implement the activity registry and keep durable infrastructure outside the workflow package.
