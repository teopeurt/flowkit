# FlowKit YAML definitions: technical deep dive

> **Scope and evidence.** This guide describes the checked-out implementation. Claims are traced to source symbols; line numbers are intentionally omitted where possible because they drift.

## 1. Mental model

Definitions are data. The definitions package parses YAML; core owns the data model, schema, lint, and pure transition; Temporal runs a published snapshot. Consumer registries supply handlers and pure functions. Activities are the side-effect boundary.

```mermaid
flowchart LR
 Y[YAML] --> P[parse + flowSchema] --> D[FlowDefinition]
 D --> S[publishDefinition: frozen snapshot + hash]
 S --> W[Temporal workflow]
 W --> A[activities]
 W --> R[consumer registries]
 W --> H[human commands/signals]
```

`FlowState` contains `stage`, `status`, `pendingRole: string | null`, and `tracks`. Published identity contains `id`, `version`, and `hash`.

## 2. Definition shape

`FlowDefinition` in `packages/core/src/types.ts` has exactly these top-level fields:

| Key | Meaning |
|---|---|
| `id` | non-empty definition identifier |
| `version` | numeric version |
| `roles` | declared role names |
| `tracks` | optional map of `{initial, values}` track definitions |
| `initialStage` | starting stage |
| `initialStatus` | optional initial status; the transition default is `pending` |
| `actions` | optional global action map |
| `stages` | stage map |

A `StageDef` may contain `pendingRole` (including explicit `null`), `final`, `steady`, `entry`, `entryNotify`, `disabledGlobalActions`, `sla`, and `actions`. An SLA has required `after` and `escalate`; escalation may specify `notify` and/or `action`. An `ActionDef` has `to`, optional `kind` (`human`, `system`, `signal`), `status`, `pendingRole`, `tracks`, `guards`, `policy`, and `notify`. Notifications have `template`, `channels`, and optional `to`.

A `StepDef` is `{kind, ref}` with kind `system`, `ai`, `rule`, or `orchestrate`. AI and orchestrate steps may use `gate: human|auto`; `gate: auto` requires `decide`, and `decide` is not valid for other step kinds/gates. Global `actions` is the code shape; prose using `globalActions` is drift.

```yaml
id: change-request
version: 1
roles: [requester, reviewer]
initialStage: review
initialStatus: pending
stages:
  review:
    pendingRole: reviewer
    entry: [{kind: ai, ref: assessRisk, gate: human}]
    actions: {approve: {to: done, kind: human, policy: reviewer}}
  done: {final: true}
```

The snippet is a **schema fragment**: it has no consumer manifest and is not claimed to pass registry-aware CLI validation.

```mermaid
classDiagram
 class FlowDefinition { id; version; roles; tracks; initialStage; initialStatus; actions; stages }
 class StageDef { pendingRole; final; steady; entry; entryNotify; disabledGlobalActions; sla; actions }
 class ActionDef { to; kind; status; pendingRole; tracks; guards; policy; notify }
 class StepDef { kind; ref; gate; decide }
 class SLA { after; escalate }
 FlowDefinition *-- StageDef
 FlowDefinition o-- ActionDef
 StageDef *-- ActionDef
 StageDef *-- StepDef
 StageDef o-- SLA
```

## 3. Stage entry and interpreter turns

On a committed transition, `entryEpoch` increments. Entry step results are keyed by `entryEpoch:stepIndex`; each result records `ref`, `kind`, `status`, `entryEpoch`, and optionally `output`, `gateDecision`, or orchestration `tasks`. The automatic-transition cap defaults to 32 (`config.maxAutomaticTransitionsPerTurn ?? 32`). Exceeding it raises non-retryable `FLOWKIT_AUTOMATIC_LOOP`.

```mermaid
stateDiagram-v2
 [*] --> stage_entry
 stage_entry --> execute_entry
 execute_entry --> automatic_command: rule or accepted auto gate
 execute_entry --> waiting: no automatic command
 automatic_command --> stage_entry: committed transition
 waiting --> command: human/signal/update
 command --> stage_entry: non-final transition
 command --> [*]: final transition
```

```mermaid
sequenceDiagram
 participant WF as Workflow
 participant ACT as Activity
 participant REG as Registry
 participant HIST as Temporal history
 WF->>HIST: load published snapshot and execution state
 WF->>ACT: execute step with entryEpoch and idempotencyKey
 ACT->>REG: resolve compiled handler
 REG-->>ACT: output
 ACT-->>WF: typed result
 WF->>HIST: persist result, gateDecision, transition
 WF->>WF: automatic loop (default cap 32)
```

System and AI activity inputs include `workflowId`, `ref`, `definition`, `subject`, `state`, `entryEpoch`, `stepIndex`, serialized idempotency key, `entryReason`, and optional `priorTransition`. AI returns `{output?: unknown}`. The workflow records that output; it does not treat it as authority.

## 4. Actions, own entries, and authorization

Action kinds are exactly `human`, `system`, and `signal`. `transition()` resolves the declared action, checks its policy and then each guard in order, computes the next state, and applies status, pending-role, track, and notification effects. The explicit-null fix is in `packages/core/src/transition.ts`: destination `pendingRole` is inherited only when the action omits the field; `pendingRole: null` clears it.

Registry checks use own entries, not prototype lookup: `hasOwnRef`/`ownRef` in `packages/temporal/src/validation.ts` and `ownRef` in `packages/core/src/transition.ts`. The definitions CLI builds manifest sections with null-prototype objects. This keeps names such as `constructor`, `toString`, and `__proto__` from masquerading as registered refs. The old attribution to `cli.ts` is incorrect.

```mermaid
flowchart TD
  C[command] --> V[validateState: stage exists in definition]
  V --> O{action declared on the current stage?}
  O -- no --> E1[InvalidTransitionError]
  O -- yes --> P{policy declared?}
  P -- no --> G
  P -- yes --> PR{own entry in policies registry?}
  PR -- no --> E2[MissingPolicyError]
  PR -- yes --> PX{policy returns true?}
  PX -- no --> E3[AuthorizationRejectionError]
  PX -- yes --> G{each guard, in order}
  G --> GR{own entry in guards registry?}
  GR -- no --> E4[MissingGuardError]
  GR -- yes --> GX{guard returns true?}
  GX -- no --> E5[GuardRejectionError]
  GX -- yes --> T[compute next FlowState]
```

## 5. Step kinds and registries

The manifest section names in `packages/definitions/src/cli.ts` and `packages/temporal/src/contracts.ts` are `policies`, `guards`, `rules`, `orchestrators`, `systemSteps`, `aiSteps`, `templates`, and `channels`. The names `systems` and `ai` are not registry section names.

| Step | Registry section | Boot validation | Core lint ref check |
|---|---|---|---|
| `system` | `systemSteps` | missing `missing-system-step-ref` | `missing-step-ref` only when `validateRegistryRefs` gets a `steps` registry |
| `ai` | `aiSteps` | missing `missing-ai-step-ref`; auto gate also checks its rule | `missing-step-ref` only through the generic core registry helper |
| `rule` | `rules` | missing `missing-rule-ref`, unavailable action `rule-action-unavailable`, non-system action `rule-action-not-system` | not emitted by `lintFlow` |
| `orchestrate` | `orchestrators` | `missing-orchestrator-ref`, empty agents `orchestrator-agents-empty`, invalid limits `orchestrator-limit-invalid`; auto gate checks rule | not emitted by `lintFlow` |

The CLI says `Skipped: declared-ref validation (policies, guards, rules, system steps, AI steps, orchestrators, templates, channels)` when no manifest is supplied. CLI validation and boot validation are distinct from core `LintIssueCode`.

## 6. Exact lint contract

`lintFlow` emits every code below except `missing-action-policy`. `lintInterpreterFlow` starts with those results and additionally emits `missing-action-policy`. `validateRegistryRefs` emits the registry-oriented core codes shown below; it is not the Temporal boot validator.

| Code | Severity | Real trigger | Emitter |
|---|---|---|---|
| `unreachable-stage` | error | stage cannot be reached from `initialStage` by declared actions | `lintFlow` |
| `dead-end-stage` | error | non-final stage declares no actions, including global actions | `lintFlow` |
| `final-stage-has-actions` | error | final stage declares stage-local actions | `lintFlow` |
| `orchestrate-without-sla` | warning | non-final stage has an orchestrate entry step but no SLA | `lintFlow` |
| `unbounded-stage` | warning | non-final stage has no SLA, no rule entry, and is not `steady` | `lintFlow` |
| `unused-role` | warning | declared role is never referenced by pending role, notification recipient, or action | `lintFlow` |
| `unused-track` | warning | declared track is never updated by an action | `lintFlow` |
| `duplicate-action-source` | warning | same action name is declared on multiple stage-local sources | `lintFlow` |
| `missing-action-policy` | error | human or signal action lacks a policy; system actions are exempt | `lintInterpreterFlow` |
| `missing-step-ref` | error | generic `validateRegistryRefs` lacks `registry.steps[step.ref]` | `validateRegistryRefs` |
| `missing-guard-ref` | error | action guard is absent from `registry.guards` | `validateRegistryRefs` |
| `missing-policy-ref` | error | action policy is absent from `registry.policies` | `validateRegistryRefs` |
| `missing-template-ref` | error | notification template is absent from `registry.templates` | `validateRegistryRefs` |
| `missing-channel-ref` | error | notification channel is absent from `registry.channels` | `validateRegistryRefs` |

The exact `LintIssueCode` union has 14 members: the table above contains all of them.

## 7. Gates

For `gate: human`, the workflow records the step output and leaves the stage waiting. For
`gate: auto`, the deciding rule is looked up as an own entry of the `rules` registry and receives the
gated output (`gatedOutput`); for an `orchestrate` step it also receives the final task statuses
(`tasks`). If the rule returns an action and the automatic-transition budget allows it, the step
records `gateDecision: { outcome: 'auto', action }` and queues the action as a **system** command
(`actorId: 'system'`, `origin: 'rule'`). The operation id is `gate:<entryEpoch>:<index>` for an `ai`
step and `orch:<epoch>:<index>` for an `orchestrate` step.

The fail-closed branches, from `workflow.ts`:

- a missing rule, a rule that throws, or a rule that returns nothing records `gateDecision: { outcome: 'human' }`;
- a step whose work degrades (activity failure, timeout, oversized output, a stale epoch) records
  `status: 'degraded_to_human'` and has **no** `gateDecision`;
- when the automatic-transition budget (default 32) is exhausted, an `orchestrate` step falls back to
  a human, but an `ai` step throws the non-retryable `FLOWKIT_AUTOMATIC_LOOP` failure.

> **Not verified:** what happens when the queued action is later rejected by `transition()` (an
> action the rule was not registered for, a failing policy or a failing guard). The interpreter
> queues the command; this pass did not trace the rejection path after that point.

```mermaid
flowchart TD
  S[ai or orchestrate step runs] --> D{step completed?}
  D -- "activity failed, timed out, output too large, or epoch went stale" --> DG["status degraded_to_human (no gateDecision)"]
  D -- yes --> G{"gate: auto with a decide rule?"}
  G -- "no (gate: human)" --> H[record output; the stage waits for a person]
  G -- yes --> R["rules registry: own entry named by decide"]
  R --> X{"rule returns an action? (missing rule, throw or no answer all mean none)"}
  X -- no --> HD["gateDecision: outcome human"]
  X -- yes --> C{automatic-transition budget left?}
  C -- yes --> A["gateDecision: outcome auto; queue the action as a system command"]
  C -- "no, ai step" --> L["FLOWKIT_AUTOMATIC_LOOP (non-retryable failure)"]
  C -- "no, orchestrate step" --> HD
```

## 8. Orchestration

`FLOWKIT_ORCHESTRATION_HARD_LIMIT` is 64. Defaults from `FLOWKIT_ORCHESTRATION_DEFAULTS` are `maxTasks: 16`, `maxConcurrency: 4`, `failFast: false`, and `maxOutputBytes: 65_536`. `workflow.ts` clamps the first two with `Math.min(..., FLOWKIT_ORCHESTRATION_HARD_LIMIT)`, while boot validation rejects registration values outside 1..64 with `orchestrator-limit-invalid`; it also requires non-empty `agents` (`orchestrator-agents-empty`). A plan over the effective task limit fails with the exact form `plan has N tasks, more than the limit of M`.

The activity identity is serialized as `[workflowId, entryEpoch, stepIndex, phase]`, with phase `plan`, `synthesize`, or `task`, `task` including `taskId`. Operation IDs used by the workflow are `orch:${epoch}:${index}` for an automatic orchestration transition, `gate:${entryEpoch}:${index}` for an auto AI gate, `sla:${entryEpoch}` for an SLA action/notification, and the incoming update ID for external commands. The plan, bounded parallel subagent activities, and synthesis run in activities. `failFast` cancels remaining tasks after the first failure; stale orchestration is superseded when the entry epoch changes; plan/task/synthesis/output-limit problems degrade to human. The workflow records task status/result references, synthesized output when successful, and gate decision in execution state/history; task outputs themselves are not kept in task state. The auto-gate rule receives final task statuses.

```mermaid
sequenceDiagram
 participant WF as Workflow
 participant PLAN as plan activity
 participant TASK as bounded task activities
 participant SYN as synthesize activity
 participant RULE as decide rule
 WF->>PLAN: [workflowId, epoch, index, plan]
 PLAN-->>WF: tasks
 par maxConcurrency (default 4)
  WF->>TASK: [workflowId, epoch, index, task, taskId]
  TASK-->>WF: status/output reference
 end
 WF->>SYN: results and statuses
 SYN-->>WF: bounded output
 WF->>RULE: gatedOutput + final task statuses
 RULE-->>WF: allowed system action or undefined
```

Concrete planner, agent, and synthesizer implementations remain consumer-provided contracts; this repository does not supply a universal model backend.

## 9. Validation, YAML safety, and snapshots

The layers are schema, core lint, then manifest/boot validation. `validateFlowkit` also verifies the published snapshot and parses positive SLA durations (`ms`, `s`, `m`, `h`, `d`, including compounds such as `1h30m`). The CLI exit kinds are `0` clean, `1` issues, `2` usage, `3` missing manifest, `4` malformed manifest, `5` unreadable definition, `6` unreadable manifest, `7` no files matched, and `70` internal error.

The YAML loader rejects malformed/empty/multi-document input, merge keys, tags, non-string or duplicate keys, forbidden `__proto__`, wrong version spelling, excessive alias expansion, schema failures, and inputs over 2 MiB. `publishDefinition` canonicalizes, recursively sorts keys, freezes the snapshot, and computes a `sha256:` hash. In-flight workflows retain their published snapshot.

```mermaid
sequenceDiagram
 participant AUTHOR as Author
 participant CLI as CLI validation
 participant PUB as publishDefinition
 participant OLD as old worker
 participant NEW as upgraded worker
 AUTHOR->>CLI: validate manifest + definition
 CLI->>PUB: publish immutable snapshot
 PUB-->>NEW: id/version/hash
 OLD-->>OLD: retains existing pinned snapshot
```

```mermaid
flowchart LR
 Y[YAML] --> S[flowSchema]
 S --> L[lint]
 L --> M[manifest refs]
 M --> V[validateFlowkit]
 V --> P[published snapshot]
```

## 10. Worked example: a change request

A realistic definition that uses a human action, an `ai` step with `gate: auto`, an `orchestrate`
step with an SLA, notifications and a reopen path. The files are checked in and validated by a test
(`packages/definitions/test/docs-examples.test.ts`), so they cannot drift from the CLI:

- [`docs/examples/change-request/change-request.flow.yaml`](./examples/change-request/change-request.flow.yaml)
- [`docs/examples/change-request/registries.yaml`](./examples/change-request/registries.yaml) (the names the consumer registers at runtime)

```yaml
# yaml-language-server: $schema=../../../packages/definitions/schema/flowdefinition.schema.json
id: change-request
version: 1
roles: [requester, reviewer, approver]
initialStage: draft
initialStatus: draft

stages:
  draft:
    pendingRole: requester
    steady: true
    actions:
      submit:   { to: triage,    kind: human, policy: requesterCanSubmit }
      withdraw: { to: withdrawn, kind: human, policy: requesterCanSubmit }

  # An AI step proposes a risk level. gate: auto lets a deterministic rule release the stage;
  # if the rule declines, throws, is missing, or the step degrades, a reviewer decides.
  triage:
    pendingRole: reviewer
    sla: { after: 4h, escalate: { notify: approver } }
    entry:
      - { kind: system, ref: loadChangeFacts }
      - { kind: ai, ref: assessRisk, gate: auto, decide: lowRiskAutoApprove }
    actions:
      auto_approve: { to: implementation, kind: system }
      approve:      { to: implementation, kind: human, policy: reviewerDecision, guards: [reviewerClaimed] }
      reject:
        to: rejected
        kind: human
        policy: reviewerDecision
        guards: [reviewerClaimed]
        notify: { template: change.rejected, channels: [inbox, email] }

  # An orchestrate step plans bounded subagent work, runs it in parallel, and synthesizes a result.
  # gate: human means the output is only recorded for a person; it never moves the flow by itself.
  implementation:
    pendingRole: approver
    sla: { after: 24h, escalate: { notify: approver } }
    entry:
      - { kind: orchestrate, ref: implementChange, gate: human }
      - { kind: ai, ref: summarizeResult, gate: human }
    actions:
      signoff:
        to: done
        kind: human
        policy: approverSignoff
        notify: { template: change.accepted, channels: [inbox, email] }
      reopen: { to: triage, kind: human, policy: approverSignoff }

  done:      { final: true }
  rejected:  { final: true }
  withdrawn: { final: true }
```

The manifest the definition is checked against:

```yaml
# Names the consumer registers at runtime. Without this file the CLI skips every ref check.
policies:
  requesterCanSubmit: {}
  reviewerDecision: {}
  approverSignoff: {}
guards:
  reviewerClaimed: {}
rules:
  lowRiskAutoApprove:
    actions: [auto_approve]      # actions this rule is allowed to fire
systemSteps:
  loadChangeFacts: {}
aiSteps:
  assessRisk: {}
  summarizeResult: {}
orchestrators:
  implementChange:
    agents: [coder, tester, reviewer-bot]
    maxTasks: 8
    maxConcurrency: 2
templates:
  change.rejected: {}
  change.accepted: {}
channels:
  inbox: {}
  email: {}
```

The state diagram below was **generated from the YAML** by a short throwaway script (it walks
`stages`, `actions` and `entry`), not drawn by hand:

```mermaid
stateDiagram-v2
  [*] --> draft
  draft --> triage: submit (human, requesterCanSubmit)
  draft --> withdrawn: withdraw (human, requesterCanSubmit)
  triage --> implementation: auto_approve (system)
  triage --> implementation: approve (human, reviewerDecision)
  triage --> rejected: reject (human, reviewerDecision)
  implementation --> done: signoff (human, approverSignoff)
  implementation --> triage: reopen (human, approverSignoff)
  done --> [*]
  rejected --> [*]
  withdrawn --> [*]
  note right of triage
    entry: system:loadChangeFacts, ai:assessRisk/auto
  end note
  note right of implementation
    entry: orchestrate:implementChange/human, ai:summarizeResult/human
  end note
```

### Real CLI output

With the manifest:

```text
1 definition file(s) valid.
[exit 0]
```

Without it, ref checks are skipped, and a typo goes unnoticed:

```text
Skipped: declared-ref validation (policies, guards, rules, system steps, AI steps, orchestrators, templates, channels)
1 definition file(s) valid.
[exit 0]
```

Four deliberate mistakes, each caught with a position (`path:line:column`). The first two are
schema-level errors (`yaml-error`) that need no manifest; the last two are ref errors that exist only
because the manifest was supplied:

**A stage transition that points nowhere**

```text
stages.triage.actions.auto_approve.to:25:27 yaml-error Action "triage.auto_approve" targets unknown stage "implementaton".
1 issue(s) across 1 file(s).
[exit 1]
```

**`gate: auto` without a `decide` rule**

```text
stages.triage.entry.1.decide:23:9 yaml-error Step "assessRisk" with gate "auto" must name a deciding rule in "decide".
1 issue(s) across 1 file(s).
[exit 1]
```

**A decide rule that is not registered**

```text
stages.triage.entry.1.decide:23:58 missing-rule-ref Missing rule ref "nopeRule".
1 issue(s) across 1 file(s).
[exit 1]
```

**A policy name typo**

```text
stages.triage.actions.approve.policy:26:64 missing-policy-ref Missing policy ref "reviewerDecison".
1 issue(s) across 1 file(s).
[exit 1]
```

The same policy typo **without** the manifest passes:

```text
Skipped: declared-ref validation (policies, guards, rules, system steps, AI steps, orchestrators, templates, channels)
1 definition file(s) valid.
[exit 0]
```

### Source map

- `FlowDefinition`, enums, state and lint types: `packages/core/src/types.ts` (symbols `FlowDefinition`, `StepDef`, `ActionDef`, `LintIssueCode`)
- schema and cross-field checks: `packages/core/src/schema.ts` (`flowSchema`)
- transition semantics: `packages/core/src/transition.ts` (`transition`, `ownRef`, `getActionDefinition`)
- core lint: `packages/core/src/lint.ts` (`lintFlow`, `lintInterpreterFlow`, `validateRegistryRefs`)
- contracts and orchestration constants: `packages/temporal/src/contracts.ts` (`FlowkitDeclaredRefs`, `FLOWKIT_ORCHESTRATION_DEFAULTS`, `FLOWKIT_ORCHESTRATION_HARD_LIMIT`, activity inputs)
- boot validation: `packages/temporal/src/validation.ts` (`validateFlowkit`, `hasOwnRef`, `ownRef`, `FlowkitValidationIssue`)
- interpreter: `packages/temporal/src/workflow.ts` (`FLOWKIT_AUTOMATIC_LOOP`, gate and orchestration branches)
- manifest and CLI: `packages/definitions/src/cli.ts` (`MANIFEST_SECTIONS`, exit constants, `SKIPPED_NOTE`)
- YAML: `packages/definitions/src/yaml.ts`; snapshot: `packages/temporal/src/snapshot.ts`

### Doc drift found

- Older plan prose says `globalActions`; the code shape is top-level `actions`.
- Older prose says registries `systems` and `ai`; the implementation uses `systemSteps` and `aiSteps`.
- Core lint and Temporal boot validation use different code sets; names such as `missing-ai-ref` are not valid lint codes, while `missing-ai-step-ref` is a Temporal validation code.
- Consumer planner, agent, synthesizer, and activity implementations are contracts, not supplied universal behavior; this guide does not claim otherwise.
- `docs/definitions-yaml.md` is a separate public contract and may drift from code; this deep dive reports discrepancies rather than editing that file.
