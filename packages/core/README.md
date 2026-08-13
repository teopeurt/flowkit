# `@naakwu/flowkit-core`

The pure workflow-definition and transition kernel. Its only public entry point is `@naakwu/flowkit-core`.

```ts
import { buildInitialState, defineFlow, transition } from '@naakwu/flowkit-core';

const flow = defineFlow({
  id: 'review', version: 1, roles: ['author'], initialStage: 'draft',
  stages: { draft: { pendingRole: 'author', actions: { close: { to: 'done', status: 'approved' } } }, done: { final: true } },
});
const state = buildInitialState(flow);
const outcome = transition(flow, state, { action: 'close' });
```

Core has no executor, persistence, notification, or authorization runtime. Resolve I/O-derived facts before calling a transition.
