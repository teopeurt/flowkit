# `@flowkit/tasks`

Portable human-task lifecycle contracts for Flowkit consumers.

The package projects committed workflow transitions into durable logical tasks, plans return/reopen
semantics, exposes compare-and-set claim/release/reassignment orchestration, evaluates maker-checker
facts, defines cursor-based inbox queries, and provides hash-only external invitation helpers.

Consumers provide the `TaskStore`, authenticated eligibility resolver, identity gateway, clock, and
notification adapter. The package never advances a workflow, queries a database, creates accounts,
sends transport messages, or imports NestJS, Temporal, BullMQ, React, BetterAuth, or FAAN modules.

Task claims are revision-checked. A task action must revalidate the current assignee and revision at
the consumer action boundary. Invitation tokens are returned only during creation, stored as hashes,
expire, and are redeemed through a consumer transaction that atomically assigns the task.
