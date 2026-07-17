# `@flowkit/core`

Pure workflow-definition and transition kernel for flow-heavy systems.

What it is:

- strict serializable flow definitions validated with Zod
- one atomic pure `transition()` operation from `(definition, state, command, context)` to
  `{ state, transition }`
- structural helpers such as `buildInitialState()` and `getDeclaredActions()`
- ESM, CommonJS, and declaration outputs from `dist/`

What it is not:

- not a workflow executor
- not a Temporal workflow
- not an authorization runtime
- not a persistence, notification, or task system

Important boundary:

- `getDeclaredActions()` is structural only. It tells you what the definition declares on a stage.
  It does not mean a user is allowed to perform that action.
- guards and authorization policies must be deterministic and synchronous
- guards and policies receive current state, command, actor, subject, and pre-resolved facts
- any I/O-derived facts must be resolved by the caller before evaluation

Later packages are responsible for:

- Temporal execution
- immutable definition snapshot + hash workflow inputs
- authorization fact resolution via activities
- task projection and claiming
- notifications
- audit persistence

## Usage

ESM:

```ts
import { buildInitialState, defineFlow, transition } from '@flowkit/core';

const reviewFlow = defineFlow({
  id: 'doc-review',
  version: 1,
  roles: ['author', 'reviewer'],
  initialStage: 'draft',
  stages: {
    draft: {
      pendingRole: 'author',
      actions: {
        submit: { to: 'review', pendingRole: 'reviewer' },
      },
    },
    review: {
      pendingRole: 'reviewer',
      actions: {
        approve: { to: 'published', status: 'approved' },
      },
    },
    published: {
      final: true,
    },
  },
});

const state = buildInitialState(reviewFlow);
const outcome = transition(reviewFlow, state, { action: 'submit' });
```

CommonJS:

```js
const { buildInitialState, defineFlow, transition } = require('@flowkit/core');

const flow = defineFlow({
  id: 'simple',
  version: 1,
  roles: ['owner'],
  initialStage: 'open',
  stages: {
    open: {
      pendingRole: 'owner',
      actions: {
        close: { to: 'closed', status: 'approved' },
      },
    },
    closed: {
      final: true,
    },
  },
});

const state = buildInitialState(flow);
const outcome = transition(flow, state, { action: 'close' });
```
