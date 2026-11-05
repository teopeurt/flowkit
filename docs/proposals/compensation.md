# Proposal: saga compensation (target FlowKit 1.1.0)

**Status:** Draft for ratification. Additive; no change to existing definitions or the frozen `(stage, action)` oracle.
**Packages touched:** `flowkit-core`, `flowkit-definitions`, `flowkit-temporal`, `flowkit-auth` (capability only).

## Why

When a later action fails after earlier actions already produced side effects (access provisioned, calendar entry created, balance reserved), a flow has no structured way to undo them. Today each consumer hand-authors reverse actions and sequencing. This proposal makes the inverse a declared, replayable part of the definition.

## What the code looks like today (constraints)

- `FlowDefinition` is `stages` + `actions`. `ActionDef` is `{ to, kind?, status?, pendingRole?, tracks?, guards?, policy?, notify? }`, where `kind` is `human | system | signal`. There is no `steps` array.
- Entry steps (`StepDef.kind`: `system | ai | rule`) run on stage entry; an `ai` step must declare `gate: 'human'`. Stage `sla` escalates by action or notification.
- `FlowState` is `{ stage, status, pendingRole, tracks }`. It carries **no history**.
- `transition(definition, state, command, context)` is pure and returns `{ state, transition }`. Every committed transition is recorded by the consumer through the `recordTransition` activity, with `sequence`, `operationId` and a `TransitionRecord`.
- The Temporal workflow keeps `FlowkitExecutionState` (`sequence`, `entryEpoch`, `stepResults`, ...), carried across Continue-As-New via `resume.execution`.

Consequence: the history a compensation plan needs must live in the **runtime's execution state** (and the consumer's projection), not in `FlowState`. The kernel stays pure.

## Design

### 1. Declare the inverse on the action

```ts
interface CompensationDef {
  /** Named ref resolved from the consumer registry (same model as step refs). */
  ref: string;
  params?: Record<string, string>;   // paths into subject/state, resolved by the runtime
  timeoutMs?: number;
  retry?: { maxAttempts?: number; initialBackoffMs?: number; maxBackoffMs?: number };
}

interface ActionDef {
  // ... existing fields
  compensate?: CompensationDef;      // absent = not compensable
}

interface FlowDefinition {
  // ... existing fields
  compensation?: {
    policy?: 'none' | 'manual' | 'automatic';           // default 'none'
    onFailure?: 'halt' | 'continue';                    // default 'halt'
    terminalStage?: string;                             // stage entered when a plan finishes
  };
}
```

All new fields are optional and default to today's behavior. Lint adds `missing-compensation-ref`, `unknown-compensation-terminal-stage`, and a warning when `policy: 'automatic'` is set but a side-effecting `system` action has no `compensate`.

### 2. Runtime records a compensable ledger

`FlowkitExecutionState` gains `ledger: Array<{ sequence, operationId, action, fromStage }>`, appended only for committed actions whose `ActionDef` has `compensate`. It is carried by Continue-As-New. The plan is **derived** (reverse order of the ledger minus already-compensated entries); it is never stored as a separate plan.

### 3. Two reserved commands, still one atomic path

- `__compensate__` with `payload = { targetSequence, effect: { succeeded, completedAt, error? } }`. The kernel validates the target is in the ledger passed via `context.facts.ledger`, is not already compensated (idempotent no-op if so), and that the actor is `system` or holds `canCompensate`. It performs **no I/O**; the runtime runs the ref and passes the outcome in as data.
- `__finalize_compensation__` moves the instance to `compensation.terminalStage` and sets `status` to `compensated`, `compensated_with_skips` or `compensation_failed`.

This preserves vision §5.4 (one atomic transition, no detached apply): the side effect is an input to a single committed transition.

### 4. Runtime orchestration (`flowkit-temporal`)

On abort or unrecoverable failure: derive the plan from the ledger, invoke each compensator as an activity with idempotency key `${workflowId}:${sequence}:compensate`, feed the outcome to `transition()`, then call `recordTransition`. `onFailure: 'halt'` stops at the first failed compensator; `'continue'` records it and proceeds. A missing registry ref always fails closed. After a crash the plan is recomputed from the ledger; already-committed compensations are skipped.

### 5. Authorization

Automatic compensation runs as the `system` principal and is recorded as such. Manual compensation requires a `canCompensate` capability (a portable contract in `flowkit-auth`); the maker-checker rule applies, so a principal cannot compensate their own approval.

### 6. Projections

Compensation transitions are ordinary rows in the consumer's transition projection. `flowkit-tasks` can expose an "undo trail" view; no new mutable store.

## Compatibility

Additive minor release (**1.1.0**): no required field is added, existing definitions validate unchanged, and the oracle for existing `(stage, action)` pairs is untouched. `flowkit-definitions` emits the new fields in the YAML binding and JSON Schema. A running instance resolves `compensate.ref` from the snapshot it started with, so registries must retain old refs until those instances end.

## Open questions

1. Pass the ledger explicitly via `context.facts.ledger` (shape defined in `flowkit-core`) so non-Temporal runtimes can reuse it? Recommended: yes.
2. Require `terminalStage` when `policy` is not `none`? Recommended: yes, enforced by lint.
3. Partial compensation ("undo up to sequence N") as an operator action: the kernel supports it via repeated `__compensate__`; runtime surface deferred.
4. Ledger growth with Continue-As-New: compaction deferred.

## Work breakdown

1. `flowkit-core`: types, the two reserved commands in `transition()`, lint rules, tests (idempotence, authorization, unknown or non-compensable target).
2. `flowkit-definitions`: YAML and JSON Schema for the new fields.
3. `flowkit-temporal`: ledger in execution state, plan derivation, compensator activity, replay tests, Continue-As-New carry-over.
4. `flowkit-auth`: `canCompensate` capability contract and test suite.
5. Changeset (`minor`, lockstep to 1.1.0) and docs.
