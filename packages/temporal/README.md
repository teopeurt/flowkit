> Versions through 1.0.0 used `@naakwu/*`; from 1.1.0 use the public `@teopeurt/*` package with the same API.

# `@teopeurt/flowkit-temporal`

Temporal runtime helpers are exported from `@teopeurt/flowkit-temporal`; the workflow factory is exported from `@teopeurt/flowkit-temporal/workflow`.

```ts
import { publishDefinition } from '@teopeurt/flowkit-temporal';
import { createFlowkitWorkflow } from '@teopeurt/flowkit-temporal/workflow';

const publish = publishDefinition;
const workflowFactory = createFlowkitWorkflow;
```

Publish and verify an immutable definition snapshot before execution. Consumers implement the activity registry and keep durable infrastructure outside the workflow package.

## Orchestrate steps

A `kind: orchestrate` entry step needs an entry in `registries.orchestrators` (bundled with the workflow)
and a worker that implements `FlowkitOrchestrationActivities`: `planOrchestration`, `runSubagent` and
`synthesizeOrchestration`. See `docs/definitions-yaml.md` for the semantics.

```ts
import { createFlowkitWorkflow } from '@teopeurt/flowkit-temporal/workflow';

export const flow = createFlowkitWorkflow({
  registries: {
    rules: { allClean: { actions: ['proceed'], run: ({ tasks }) => tasks?.every((t) => t.status === 'completed') ? 'proceed' : undefined } },
    orchestrators: {
      buildFeature: { agents: ['coder', 'tester'], maxTasks: 8, maxConcurrency: 4, activityOptions: { startToCloseTimeout: '30 minutes', heartbeatTimeout: '2 minutes' } },
    },
  },
});
```

FlowKit never runs agents or chooses models; the activities do, from the `agent` name and task input.
