# Flowkit — Architecture

**Status:** Phase 1 complete; Phase 4 FAAN operational adoption pending
**Source design:** [`docs/superpowers/specs/2026-07-09-generic-workflow-framework-design.md`](../superpowers/specs/2026-07-09-generic-workflow-framework-design.md)
**Live status tracker:** [`docs/TASKS.md`](../TASKS.md) (FLOWKIT-00 through FLOWKIT-12 and FLOWKIT-P4 items)
**Vision / rationale:** [`vision.md`](./vision.md)

This document describes how Flowkit is built: the package graph, the kernel's data model and
semantics, the Temporal interpreter, and the three layers built on top of it (tasks, notify,
auth). It favors the stable design contract over day-to-day implementation status — for "is X
done yet," see [`docs/TASKS.md`](../TASKS.md).

---

## 1. Package graph

All packages live under `packages/`, are TypeScript, and are managed as Bun workspaces. Each
publishes as `@flowkit/<name>`.

```
packages/flowkit-core        @flowkit/core       Engine-agnostic kernel (no Temporal, no Nest, no DB)
packages/flowkit-temporal    @flowkit/temporal   Generic Temporal interpreter    (depends on core)
packages/flowkit-tasks       @flowkit/tasks      Human task / inbox layer        (depends on core)
packages/flowkit-notify      @flowkit/notify     Notification framework          (standalone)
packages/flowkit-auth        @flowkit/auth       Identity & RBAC foundation      (standalone)
packages/flowkit-demo        —                   Demo workflow / e2e proof       (depends on all five)
```

**Dependency rules:**

- `@flowkit/core` has no runtime dependency except Zod. It never imports Temporal, NestJS, or a
  database driver.
- `@flowkit/temporal` and `@flowkit/tasks` depend only on `@flowkit/core`.
- `@flowkit/notify` and `@flowkit/auth` stand alone — neither depends on the workflow kernel.
- Packages that need NestJS wiring expose it via a `./nest` subpath export (e.g.
  `@flowkit/auth/nest`); there is no separate bindings package per framework package.
- `packages/faan-avsec-backend` and `flowkit-demo` are the two consumers; both import all five
  packages.

**Consumption contract:** every package emits JS + `.d.ts` under `dist/` (tsup-built) and is
imported by package name — `import { defineFlow } from '@flowkit/core'`, never a relative path
into another package's `src/`. Consumers resolve compiled artifacts, not sibling TypeScript
source. This is what lets Phase 2 (a starter/template repo) publish or copy the same artifacts
without reworking runtime resolution — see [`vision.md` §5.6](./vision.md#56-package-boundary-build-artifacts-not-source-bridges).

**Public surface per package** (from `packages/flowkit-demo/package-contracts.json`, the contract
the demo app is required to consume through):

| Package | Key exports |
|---|---|
| `@flowkit/core` | `defineFlow`, `flowSchema`, `lintFlow`, `lintInterpreterFlow`, `validateRegistryRefs`, `buildInitialState`, `transition` |
| `@flowkit/temporal` | `publishDefinition`, `verifyPublishedDefinition`, `assertValidFlowkit`, `canonicalizeJson`, `hashCanonicalJson` |
| `@flowkit/tasks` | `MemoryTaskStore`, `planTaskProjection`, `claimTask`, `leaveApprovalDefinition`, `humanTaskForStage` |
| `@flowkit/notify` | `createTemplateRegistry`, `template`, `planNotification`, `MemoryOutboxStore`, `NotificationAdapterRegistry`, `NotificationDeliveryRuntime`, `testAdapter` |
| `@flowkit/auth` | `defineRoleRegistry`, `parseAuthConfig`, `verifiedProofs`, `freezePrincipal` (entrypoints: `.`, `./roles`, `./better-auth`, `./nest`) |

---

## 2. Kernel: `@flowkit/core`

The kernel is the only package with zero I/O. It defines what a workflow *is* and the one
operation that moves it forward.

### 2.1 Workflow definitions are data

A workflow definition is a typed object validated by a Zod schema at load time — not a class
hierarchy, not a builder chain evaluated at runtime. Sketch, using a slice of the ODC flow:

```typescript
const odcEvetting = defineFlow({
  id: 'odc-evetting', version: 1,
  roles: ['company_user', 'rgm', 'applicant', /* ... */],
  tracks: {                       // named sub-state machines
    payment: ['not_required', 'required', 'submitted', 'confirmed', 'rejected'],
    production: ['not_ready', 'ready', 'in_production', 'produced'],
  },
  stages: {
    rgm_release_review: {
      pendingRole: 'rgm',
      sla: { after: '72h', escalate: { notify: 'rgm_supervisor' } },
      actions: {
        rgm_approve_release: { to: 'applicant_completion', status: 'pending' },
        rgm_return_release:  { to: 'release_request_pending' },
        rgm_reject_release:  { to: 'closed', status: 'rejected' },
      },
    },
    acos_review: {
      pendingRole: 'acos',
      entry: [
        { kind: 'rule', ref: 'resolvePaymentRequirement' },
        { kind: 'ai',   ref: 'summarizeCaseForReviewer', gate: 'human' },
      ],
      actions: { /* ... */ },
    },
  },
});
```

**Strict validation.** Definition objects are strict at every nesting level. Unknown keys,
duplicate roles/track values, invalid initial track values, empty stage maps, inconsistent final
stages, and empty SLA escalations fail at boot — never silently stripped.

**Type preservation.** `defineFlow()` preserves literal stage/action/role/track names, so a normal
TypeScript caller cannot pass an arbitrary string for a stage or action without an explicit
boundary cast.

### 2.2 State, commands, and the one transition operation

- **State** — `{ stage, status, pendingRole, tracks: Record<string, string> }`. This is the
  existing `OdcWorkflowState` shape with `paymentState`/`productionState` generalized into named
  `tracks`.
- **Commands** — `{ action, actorId, comment?, attachments?, payload? }`.
- **`transition(def, state, command, context)`** is the *only* state-changing kernel operation. It
  rejects invalid stage/action pairs, evaluates named guards and authorization policies, and
  returns `{ state: nextState, transition }`. There is no detached "apply this result" API that
  could apply a stale transition to an unrelated state.
- **`getDeclaredActions(def, stage)`** returns structural action names only. Core deliberately does
  not call these "available" — the task/API adapter layer must combine declared actions with
  recorded actor, claim, authorization-policy, and subject context before exposing UI actions.

### 2.3 Guards vs. authorization — two different questions

| | Guards | Authorization policies |
|---|---|---|
| Question answered | "Given the current state, command, and known facts — is this transition valid?" | "Is *this authenticated actor* allowed to attempt it?" |
| Inputs | Complete current state, command, subject context, previously resolved facts | Server-resolved roles, org scope, assignment/claim, subject facts |
| I/O | None — synchronous, deterministic, pure | Resolved by the interpreter before the kernel is called |
| Examples | `commentRequired`, `paymentConfirmed`, `actorDiffersFromMaker` (when maker identity is present in recorded facts) | "does this actor hold the `rgm` role for this org" |
| Enforced by | The kernel, on every `transition()` call | The generic interpreter, on every human command — mandatory, authentication alone is never sufficient |

Guards never query a database or call an API — any I/O-derived fact (a claim, a maker's recorded
identity) is resolved by the interpreter *before* it reaches the kernel and passed in as already-known
context.

### 2.4 Step kinds

Stages attach one or more of these behaviors:

| Kind | Behavior |
|---|---|
| `human` | Implicit whenever a stage declares `pendingRole` + `actions` |
| `system` | Integration/API steps run as Temporal activities on stage entry |
| `ai` | LLM steps; with `gate: 'human'`, output is written for a human to act on rather than auto-transitioning |
| `rule` | Declarative decisions that may auto-fire a follow-up action through the evaluator (auto-routing / auto-approval) |
| `timer` | Expressed via `sla` (deadline + escalation) |

### 2.5 Escape hatch

Everything dynamic — guards, system/AI/rule steps, notification templates — is a named `ref`
resolved from a consumer-supplied registry at runtime. This keeps definitions serializable
(required for Phase 3) while keeping the logic itself in ordinary code.

### 2.6 Versioning and the deterministic definition lifecycle

`(id, version)` identifies an immutable definition *record* — it is an index for finding a
definition, not the guarantee that makes replay safe. Every workflow execution additionally
receives the validated definition **snapshot and its content hash** at start time. Running
instances replay from that pinned snapshot; only *new* starts resolve "latest approved version."
Registry implementation changes (e.g. swapping which `ref` a name resolves to) go through Temporal
Worker Versioning or event patching, not a live definition swap.

```text
Definition authoring / DB record (mutable draft)
                    │ publish
                    ▼
Immutable { id, version, snapshot, contentHash }
                    │ validate refs + schema
                    ▼
Start workflow with snapshot + hash ──────┐
                    │                     │ replay / continue-as-new
                    ▼                     │ carries the same snapshot + hash
Generic deterministic interpreter ◄──────┘
```

Phase 3 database access happens **before** workflow start or through an Activity whose result is
recorded in workflow history. Workflow code never performs a live database lookup for a definition
during replay — this is the one invariant Phase 3 is not allowed to break.

---

## 3. Interpreter: `@flowkit/temporal`

One generic workflow function replaces every hand-written flow:

```typescript
flowkitWorkflow({ definitionSnapshot, definitionHash, subjectId, initialState? })
```

Before start, the application service resolves an immutable definition from the compiled registry
(Phase 1) or definition store (Phase 3), validates it, and passes its snapshot and hash as
workflow input. The interpreter loop itself is storage-agnostic and replay-safe.

It exposes a `getState` query and an `applyAction` update — the same shape as today's
`getApplicationState` / `odcWorkflowAction` — but generically:

1. **`applyAction(command)`** authenticates the server-issued actor context, resolves any external
   policy/guard facts through an idempotent Activity, then calls the pure kernel. Invalid
   authorization, sequence, or guard failures produce a typed **non-retryable** rejection —
   nothing about state mutates before every check passes.
2. **`recordTransition`** activity persists the audit row (generalizes `recordApprovalAction`).
3. **Entry steps** of the new stage execute: `system`/`ai` steps run as activities resolved by
   `ref` from the consumer's registry; `rule` steps evaluate and may auto-fire a follow-up action
   back through the evaluator.
4. **Notification bindings** for the transition dispatch via the outbox — never blocking the
   transition itself.
5. **SLA timers re-arm**: one Temporal timer per stage deadline; on expiry, fire the escalation
   (notify or auto-action); cancelled on transition.

`continueAsNew` guards history growth and always carries forward the *same* definition
snapshot/hash and current state — it never re-resolves "latest" for an in-flight execution.

**Activity contracts owned by this package:** `recordTransition`, `executeSystemStep`,
`executeAiStep`, `dispatchNotification`.

```text
immutable definition snapshot + hash
                │
                ▼
authenticated action + recorded facts ──► pure flowkit transition
                │                                  │
                │                                  ▼
                └────────────────────────► next state + transition record
                                                   │
                                                   ▼
                                  idempotent Temporal/DB projections
```

**FAAN adapter.** The ODC definition adapter (`OdcFlowkitWorkflow`) supplies explicit human
authorization, notification bindings, and legacy query/update state compatibility on top of the
generic interpreter; `OdcEVettingWorkflow` (the hand-written legacy workflow) stays registered
until in-flight executions drain. New workflow IDs select `OdcFlowkitWorkflow` by default;
`TEMPORAL_ODC_FLOWKIT_ENABLED=false` routes future IDs to the legacy type only. See
[`docs/runbooks/flowkit-temporal-rollout.md`](../runbooks/flowkit-temporal-rollout.md) for the
staged rollout/drain procedure.

---

## 4. Human task layer: `@flowkit/tasks`

The Temporal workflow stays the source of truth for **position** (what stage is this in); the task
layer is a **Postgres read-model** projected from transitions, written by the `recordTransition`
activity.

- **Task row** — `{ flowId, subjectId, stage, role, assignee?, status, dueAt }`. Powers
  role/user inboxes ("everything waiting on RGM").
- **Claiming** — a reviewer claims a task using a compare-and-set (CAS) update, so two reviewers
  cannot both win the same task. The action authorization policy re-verifies the recorded claim
  before accepting the transition; return/closure releases the claim idempotently.
- **Maker-checker** — a pattern helper, not magic: two sequential stages with different roles plus
  a provided guard `actorDiffersFromMakerOf(subject)` for four-eyes enforcement. Checker actions
  resolve the *latest durable maker completion* from task history and reject same-actor attempts.
- **Return-for-correction** — ordinary backward transitions; the task layer reopens the earlier
  task with history intact rather than creating a new one.
- **Invitations** — tokened invites for external actors with no account yet (generalizing
  applicant invitations): a token bound to `(flow, subject, role, contact)`; redemption
  provisions/claims identity via `@flowkit/auth`, making the task actionable. Contact values are
  normalized transiently and stored only as HMAC hashes.

**FAAN integration.** Backend tables: `flow_tasks`, `flow_task_events`, `flow_task_invitations`
(migration `20260727000001_add_flowkit_tasks.sql`). `FlowkitTaskRepository` provides
revision-checked claims, history reads, inbox queries, atomic invitation redemption, and
startup/five-minute-cron reconciliation. Authenticated routes live under `/flowkit/tasks`;
`FLOWKIT_TASKS_REQUIRE_CLAIM=true` makes human Flowkit actions require a current claim
(`taskId` + `expectedTaskRevision` in the command payload). The Temporal projection writes task
mutations in the same Drizzle transaction as the transition audit/application update.

---

## 5. Notification framework: `@flowkit/notify`

The existing `modules/notifications` stack (channel registry, dispatcher, template service,
recipient resolver, delivery handler) extracts nearly wholesale. Two things change shape:

- **Bindings move into the definition.** The action → `{ templateKey, channels }` map that used to
  live in `odc-workflow-notifications.ts` becomes declarative, per-transition:
  `notify: { template: 'rgm_approved', channels: ['in_app', 'email'], to: ['company_user'] }`.
- **Channels are adapters** registered by the consumer (in-app inbox, email/Apprise, SMS
  KudiSMS/Twilio, SSE) behind one interface; the framework owns fan-out, dedupe, and retry.

**Stays domain-owned:** recipient resolution. Consumers implement
`RecipientResolver { resolve(role, subject): UserRef[] }` — the framework never guesses who a
role maps to for a given consumer's org model.

**Outbox delivery.** Delivery rows are written in the same database transaction as the idempotent
transition audit projection (the existing event-outbox pattern), then dispatched asynchronously
with per-channel retry and delivery-status tracking. The Temporal event is the source of truth;
the projection activity uses `(workflowId, runId, updateId/action sequence)` as a uniqueness key
so retries cannot duplicate audit, task, or delivery rows.

**FAAN integration.** Atlas-backed outbox, inbox/invitation dedupe, Flowkit adapters, a dedicated
worker, a compatibility flag (`FLOWKIT_NOTIFY_ENABLED`), and Resend/in-app idempotency are wired
into the backend. See [`docs/runbooks/flowkit-notify-rollout.md`](../runbooks/flowkit-notify-rollout.md).

---

## 6. Identity & RBAC foundation: `@flowkit/auth`

Extracts the hardened BetterAuth work as a reusable identity foundation:

- **Config factory** — one function producing the BetterAuth setup (phone OTP, email, test-mode
  fixed OTP, phone normalization) — the 080/234 Nigerian international-format lessons baked in
  once instead of re-learned per consumer.
- **Role registry** — consumers declare roles by name at bootstrap; the framework seeds and
  resolves them. Hardcoded role UUIDs disappear as a pattern.
- **Provisioning & claiming** — verified-identity-required provisioning and public-user claiming
  become default framework behavior, wired to invitation redemption from `@flowkit/tasks`.
- **Canonical request user + guards** — the canonical BetterAuth request-user contract,
  `authRequired`, role guards, and readonly-role enforcement with session audit logging, shipped
  as `@flowkit/auth/nest` exports.

**FAAN integration.** FAAN's canonical role catalog lives in
`packages/core/src/rbac/faan-role-definitions.ts`; `FaanRoleStore` adapts the existing
`public.roles` table and synchronizes role metadata **without replacing IDs**. Identity-link,
membership, principal, shadow-comparison, and guarded-readonly adapters live under
`packages/faan-avsec-backend/src/auth/flowkit/`. Legacy request-user behavior stays authoritative
until `FLOWKIT_AUTH_PRINCIPAL_ENABLED=true`; shadow comparison is a separate flag
(`FLOWKIT_AUTH_SHADOW_ENABLED`). See
[`docs/runbooks/flowkit-auth-rollout.md`](../runbooks/flowkit-auth-rollout.md).

---

## 7. Error handling

- Invalid authorization, action/stage pairs, and failed guards return typed **non-retryable**
  rejections at the update handler — state never mutates before all checks pass.
- Per-step-kind retry defaults (consumer-overridable): `system` steps retry with backoff; `ai`
  steps get bounded retries then **degrade to a human task** ("AI pre-screen unavailable — review
  manually") rather than blocking; `rule` failures halt at the current stage and raise an ops
  alert.
- **Notifications never block transitions.** The transition commits first; deliveries go through
  the outbox with per-channel retry.
- **Fail-fast boot.** At worker startup, the definition is schema-validated and every named `ref`
  (guards, steps, templates) is checked against the registries. A missing ref kills boot, not a
  live workflow.

---

## 8. Testing strategy

| Package | Strategy |
|---|---|
| `flowkit-core` | Pure `bun:test` unit tests, plus a **definition linter** (`lintFlow` / `lintInterpreterFlow`) that catches unreachable stages, dead ends, final stages with actions, duplicate/unused roles and tracks, and missing registry refs — the same linter also runs in CI against consumer definitions. A small document/leave-approval definition ships with the package's own tests as the second consumer of the kernel API, exercised *before* Temporal extraction begins. |
| `flowkit-temporal` | Temporal `TestWorkflowEnvironment` with time-skipping, covering concurrency, rejection, idempotency, and replay for SLA timers/escalations. |
| FAAN regression gate | A frozen legacy transition oracle (copied from the hand-written table before it was deleted/wrapped) is checked against the new definition for every `(stage, action)` pair — an independent proof, not a circular one. Existing `odc-workflow.spec.ts`, `odc-evetting.workflow.spec.ts`, and `odc-evetting.state.spec.ts` must pass (import updates only) after each migration step. |
| `flowkit-demo` | Doubles as the full-framework end-to-end CI test: a 3-stage leave-approval flow with one human gate, one system step, one timer escalation, and one auto-decide rule, run against real Docker-stack scenarios. |

---

## 9. Migration plan

Each step is designed to land green on its own, with the FAAN app staying green throughout:

1. **`flowkit-core`** — build and consume a real package artifact; prove the API with an
   independent small definition; freeze the legacy ODC transition oracle; rewrite
   `odc-workflow.ts` as a flowkit definition behind thin compat wrappers
   (`getOdcWorkflowTransition`, `getNextOdcWorkflowActions`, `normalizeOdcWorkflowStage`, …) so no
   caller changes.
2. **`flowkit-temporal`** — new FAAN workflow starts use the generic interpreter; the old
   `OdcEVettingWorkflow` stays registered until in-flight (weeks-long) executions drain.
3. **`flowkit-notify`** — extract, rewire the backend.
4. **`flowkit-tasks`** — new capability: inbox projection, claiming, invitations.
5. **`flowkit-auth`** — extract the BetterAuth foundation.
6. **`flowkit-demo`** + per-package READMEs (what it does / how to use it / what it depends on).

All six extraction steps are complete. See [`docs/TASKS.md`](../TASKS.md) (`FLOWKIT-00` through
`FLOWKIT-12`) for their validation record. Enabling the guarded integrations across FAAN
environments, completing application cutovers, and draining legacy executions/queues are Phase 4
operational adoption work, tracked separately as FLOWKIT-P4 items.

---

## 10. Out of scope for Phase 1

- Template/starter repo (Phase 2).
- Config-driven definition storage, definition-editing UI (Phase 3).
- FAAN environment rollout, principal/global-guard and frontend-role cutovers, production
  verification, and legacy workflow/queue drains (Phase 4).
- Migrating `actor-core`, the EventBridge runtime, or the AWS runtime packages into the framework.
- Frontend framework packages — the React apps keep consuming the backend API as-is.

See [`vision.md`](./vision.md) for the reasoning behind these boundaries.
