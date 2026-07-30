# Flowkit — Vision

**Status:** Phase 1 in progress (in-place extraction inside this monorepo)
**Working name:** `flowkit`, packages published as `@flowkit/*`
**Source design:** [`docs/superpowers/specs/2026-07-09-generic-workflow-framework-design.md`](../superpowers/specs/2026-07-09-generic-workflow-framework-design.md)
**Live status tracker:** [`docs/TASKS.md`](../TASKS.md) (FLOWKIT-00 through FLOWKIT-11) — treat this document as the "why," TASKS.md as the "how far along"

---

## 1. What Flowkit is

Flowkit is a generic software framework for **workflow-heavy systems that combine human and
automated steps** — approvals, reviews, maker-checker controls, SLA-driven escalation, and
system/AI-assisted decisions, all wired together as one auditable process.

It is being extracted from this repository's FAAN AVSEC ODC e-Vetting system, which is itself the
first consumer and reference implementation. The ODC application proves the framework works by
running unchanged on top of it, not by being rebuilt for it.

## 2. The problem

The ODC e-vetting workflow (see [`PROJECT.md`](../PROJECT.md)) is a 16-stage, multi-role process —
company request → RGM gate → applicant form → company validation → FAAN vetting (maker-checker) →
HOU/2IC → ACOS → payment routing → Airport Manager → production — with hard sequencing rules,
mandatory audit trails, role-scoped queues, and multi-channel notifications at every transition.

Before Flowkit, that entire process lived as one hand-written Temporal workflow
(`OdcEVettingWorkflow`) with its transition table, notification bindings, and task-claiming logic
tangled directly into ODC-specific code. That shape does not generalize: every new workflow-heavy
system built the same way would mean rewriting the state machine, the human task/inbox layer, the
notification fan-out, and the identity/RBAC foundation from scratch, with no way to share
hardening (SLA timers, maker-checker enforcement, idempotent audit projection, phone-OTP lessons)
across systems.

Flowkit exists so that the next workflow-heavy system — inside or outside FAAN — starts from a
proven kernel instead of a blank Temporal file.

## 3. Roadmap

The framework is being built in three deliberate phases. Each phase changes *where* workflow
definitions live, never *what guarantees the interpreter gives*.

```
Phase 1 (now)       Phase 2 (later)              Phase 3 (later)
extract reusable  → clone-and-customize        → config-driven engine:
framework          starter/template repo          definitions loaded as
packages in this                                  data (e.g. from a DB)
monorepo
```

- **Phase 1 — extract in place.** Pull the workflow kernel, human task layer, notification
  framework, and identity/RBAC foundation out of the ODC codebase into standalone packages, while
  the FAAN app stays green at every step. This is the current phase; see §7 for status.
- **Phase 2 — starter repo.** A clone-and-customize template that a new team can fork to stand up
  their own workflow-heavy system on the same kernel. Not started; out of scope until Phase 1 is
  proven with a second, independent consumer (`flowkit-demo`).
- **Phase 3 — config-driven engine.** Workflow definitions move from compiled TypeScript to data
  loaded at runtime (for example, from a database), enabling non-engineers to author or edit
  workflows without a deploy. Out of scope for Phase 1, but every Phase 1 abstraction is required
  to point toward it (see §5).

## 4. Success bar

Phase 1 is not "done" until both of these are true simultaneously:

1. **FAAN e-vetting runs unchanged on the extracted packages.** The public workflow API
   (`getOdcWorkflowTransition`, `getNextOdcWorkflowActions`, `odcWorkflowAction`, `getApplicationState`,
   …) does not change for callers. Every `(stage, action)` pair is checked against a frozen,
   independent oracle of the legacy transition table so the migration cannot silently drift.
2. **A small demo workflow is built purely from the framework.** `flowkit-demo` is an independently
   authenticated leave-approval app that consumes all five packages through their public exports
   with no FAAN-specific code. It proves the kernel generalizes beyond the one system it was
   extracted from.

A framework that only the app it was extracted from can use is not a framework — it is that app
with extra layers. The demo consumer is what disqualifies that outcome.

## 5. Design philosophy

### 5.1 Declarative definitions, generic interpreter (not a code-first DSL)

Three approaches were weighed (full comparison in the design spec, §"Approaches considered"):

| Approach | Verdict |
|---|---|
| **A. Declarative definition + generic interpreter** | **Chosen.** A workflow is a typed, Zod-validated data structure; one generic Temporal workflow function interprets any definition. Matches the existing code shape (`odc-workflow.ts` was already a transition table) and is the only approach where Phase 3 (definitions as data) is a natural extension rather than a rewrite. |
| B. Code-first DSL/builder | Rejected as primary. Genericity would live in the API surface, not in data — Phase 3 would require rewriting the execution layer. A builder that *produces* the declarative definition may still be layered on top later for ergonomics. |
| C. Adopt an existing spec (BPMN / Serverless Workflow / Camunda) | Rejected. Heavy impedance mismatch with the state machine and maker-checker/invitation patterns already built. These specs are mined for vocabulary only. |

### 5.2 Every Phase 1 abstraction points at Phase 3

Workflow definitions are serializable data from day one, even while they are compiled TypeScript.
Phase 3 changes *where* a definition is stored, not the interpreter's replay contract: a running
Temporal workflow never reads mutable definition data during replay. Every execution is pinned to
an immutable, validated **definition snapshot and content hash** at start time, and
`continueAsNew` carries that same snapshot forward — it never re-resolves "latest" mid-execution.
`(id, version)` is an index for finding a definition, not the guarantee that makes replay safe;
the snapshot + hash is the guarantee.

### 5.3 Guards are pure; authorization is a mandatory boundary

Business logic that decides "is this transition allowed given the state" (guards) is kept
strictly separate from "is this actor allowed to attempt it" (authorization policy). Guards are
synchronous, deterministic predicates with no I/O. Authorization is a distinct interpreter
boundary the generic runtime enforces before every human command reaches the kernel —
authentication alone is never treated as sufficient.

### 5.4 One atomic transition, no detached apply

The kernel exposes exactly one state-changing operation:
`transition(definition, state, command, context) → { state, transition }`. There is no public
"apply this transition result to some other state" API, which would allow a stale result to be
applied to an unrelated state. Available actions are derived from the pinned definition, not
persisted, so they cannot drift from it.

### 5.5 Escape hatch: everything dynamic is a named `ref`

System/integration steps, AI steps, rule evaluations, and notification templates are referenced by
name (`ref: 'resolvePaymentRequirement'`) and resolved from a consumer-supplied registry at
runtime. Definitions stay fully serializable; the logic that can't be serialized stays in code,
one layer down.

### 5.6 Package boundary: build artifacts, not source bridges

Every reusable package emits `dist/` (JS + declarations) and is consumed by package name
(`@flowkit/core`, not a relative import into a sibling package's `src/`). This is enforced from
the first package onward specifically so Phase 2 (a starter repo) can publish or copy the same
built artifacts without reworking how consumers resolve them.

## 6. What Flowkit is not (non-goals for Phase 1)

- **Not a BPMN/Camunda-compatible engine.** Those specs were mined for vocabulary, not adopted.
- **Not a low-code workflow editor.** Definitions are TypeScript in Phase 1; a definition-editing
  UI is explicitly Phase 3 scope.
- **Not a frontend framework.** The React apps keep consuming the backend API as-is; no frontend
  packages are part of Flowkit.
- **Not a migration of every extracted subsystem in this repo.** `actor-core`, the EventBridge
  runtime, and the AWS runtime packages are out of scope for Phase 1.
- **Not a rewrite of ODC.** ODC is the proof, not the target. Its public API is a compatibility
  contract Flowkit must satisfy, not a design it dictates.

## 7. Current phase snapshot

Phase 1 package-by-package status (`flowkit-core` → `flowkit-temporal` → `flowkit-notify` →
`flowkit-tasks` → `flowkit-auth` → `flowkit-demo`) is tracked live in
[`docs/TASKS.md`](../TASKS.md) under FLOWKIT-00 through FLOWKIT-11 — that file is the source of
truth for what is Done, Partial, or Planned as of any given day, not this document. As of the last
recorded validation pass, the kernel, Temporal interpreter, notification framework, and task layer
have passing package/backend test suites and production Docker packaging validated; `flowkit-auth`
is mid-cutover; `flowkit-demo` (the Phase 1 success-bar item in §4) has not started.

For the package boundaries, kernel data model, and interpreter mechanics behind this vision, see
[`architecture.md`](./architecture.md).
