# @naakwu/flowkit-temporal

`@naakwu/flowkit-temporal` runs a serialized Flowkit definition inside a Temporal Workflow.

## Definition snapshots

Call `publishDefinition` before starting an execution and pass its immutable snapshot and SHA-256 hash as workflow input. Workflows verify that hash before registering handlers and never read a live definition registry. A definition version identifies data only; interpreter code changes still require Temporal patching or Worker Deployment Versioning.

## Commands and activities

Clients must supply a stable Temporal Update ID. The Update handler records that ID, enqueues one command, and waits for the main loop. It does not run Activities or mutate state itself. This keeps transitions ordered across Activity awaits and lets an activity adapter use `(workflowId, operationId)` to return an earlier committed projection after Continue-As-New.

Consumers implement the activity registry. `resolveActionContext` resolves server-trusted actor and authorization facts; `recordTransition` atomically stores the projection before workflow state changes; `recordStageReady`, step activities, and notification dispatch adapt framework events to application infrastructure. Notification delivery failures must not undo a committed transition.

## Actions and entry work

Human Updates can target only human actions and are checked by their named policy and guards. Rule and SLA-originated commands may target only system actions. Entry steps run in declaration order on initial entry and after a committed transition, including a self-transition. System and human-gated AI results are recorded; failed AI work degrades to a human-reviewable result rather than selecting a transition.

## SLA and continuation

An SLA is tied to a stage-entry epoch, so a successful transition cancels and re-arms the deadline. A notify escalation is isolated from state changes, while an auto-action reuses the system-command pipeline. Continue-As-New must be initiated by the main loop only after accepted handlers drain, carrying the same published definition, execution state, entry epoch, step results, and absolute deadline.
