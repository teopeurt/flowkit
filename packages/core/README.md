> Versions through 1.0.0 used `@naakwu/*`; from 1.1.0 use the public `@teopeurt/*` package with the same API.

# `@teopeurt/flowkit-core`

The pure workflow-definition and transition kernel. Its only public entry point is `@teopeurt/flowkit-core`.

```ts
import { buildInitialState, defineFlow, transition } from '@teopeurt/flowkit-core';

const flow = defineFlow({
  id: 'review', version: 1, roles: ['author'], initialStage: 'draft',
  stages: { draft: { pendingRole: 'author', actions: { close: { to: 'done', status: 'approved' } } }, done: { final: true } },
});
const state = buildInitialState(flow);
const outcome = transition(flow, state, { action: 'close' });
```

Core has no executor, persistence, notification, or authorization runtime. Resolve I/O-derived facts before calling a transition.
