# Flow definition authoring format (YAML binding)

**Status:** format specification. See [Tooling status](#8-tooling-status) for what is implemented in
this checkout and what lands with the loader.

A Flowkit definition is data: `@naakwu/flowkit-core` validates it with a Zod schema and a generic
interpreter executes any definition it accepts. The TypeScript form (`defineFlow({...})`) is one way
to write that data. This document specifies the YAML form — the same document, written in a file
instead of a module, so it can be edited without a build.

The YAML form is a **serialisation, not a second language**. Every field name, nesting level, and
constraint comes from `flowSchema`; nothing here may differ from the TypeScript form.

## 1. Document rules

| Rule | Behaviour |
| --- | --- |
| One definition per file | A file contains exactly one definition document. Multi-document YAML is rejected. |
| Identity lives in the document | `id` and `version` are required fields. The file name is not authoritative. |
| Unknown fields are rejected | Every object is strict: a typo or an unsupported option fails validation instead of being ignored. |
| No code | The format cannot express expressions, function calls, or imports. Dynamic behaviour is referenced by name (`ref`) and resolved from consumer registries at runtime. |
| Anchors and aliases | Allowed. They are expanded before the definition is canonicalised, so aliases do not affect the resulting hash. |
| Merge keys (`<<`) | Rejected. A definition should state every field it declares. |

## 2. Field reference

Top level (`FlowDefinition`):

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `id` | string | yes | Stable definition identity, used together with `version` to find a definition. |
| `version` | integer ≥ 0 | yes | Pinned into every execution started from this definition. |
| `roles` | string[] | yes | Roles the flow declares. |
| `initialStage` | string | yes | Stage an execution starts in. |
| `stages` | map of stage | yes | The stage graph. |
| `initialStatus` | string | no | Status an execution starts with. |
| `tracks` | map of track | no | Named sub-state machines, see below. |
| `actions` | map of action | no | Global actions available from every stage that does not disable them. |

Each stage (`StageDef`) — no field inside a stage is mandatory:

| Field | Type | Meaning |
| --- | --- | --- |
| `pendingRole` | string or null | Role the stage is waiting on; drives role-scoped inboxes. |
| `final` | boolean | Terminal stage. A final stage must not declare `entry` work or an `sla`. |
| `steady` | boolean | Marks a stage as intentionally parked without an SLA. |
| `entry` | step[] | Work run on entry to the stage, in declaration order. |
| `entryNotify` | notify or notify[] | Notification binding dispatched on entry. |
| `disabledGlobalActions` | string[] | Global actions this stage suppresses. |
| `sla` | object | Deadline and escalation, see below. |
| `actions` | map of action | Actions available from this stage. |

Each action (`ActionDef`):

| Field | Type | Meaning |
| --- | --- | --- |
| `to` | string | Destination stage. Required. |
| `kind` | `human` \| `system` \| `signal` | Who or what performs the action. Defaults to human. Human and signal actions must declare `policy`. |
| `status` | string | Status applied on transition. |
| `pendingRole` | string or null | Role the destination stage waits on. |
| `tracks` | map of string | Track transitions applied by this action. |
| `guards` | string[] | Named predicates resolved from the consumer registry. Guards are pure; they decide whether the transition is allowed given the state. |
| `policy` | string | Named authorization policy resolved from the consumer registry. Required for human and signal actions: authentication alone is never sufficient. |
| `notify` | notify or notify[] | Notification binding(s) dispatched by the transition. |

Each entry step (`StepDef`):

| Field | Type | Meaning |
| --- | --- | --- |
| `kind` | `system` \| `ai` \| `rule` | Step kind. |
| `ref` | string | Name resolved from the consumer registry at runtime. This is the escape hatch: logic that cannot be serialised stays in code. |
| `gate` | `human` | Only valid on `ai` steps, and required there: AI output is recorded for a human to act on rather than transitioning automatically. |

Notifications (`NotificationDef`):

| Field | Type | Meaning |
| --- | --- | --- |
| `template` | string | Template key resolved by the notification layer. |
| `channels` | string[] | Channel names, for example `inbox`. |
| `to` | string[] | Recipient roles. |

Tracks and SLAs:

| Field | Type | Meaning |
| --- | --- | --- |
| `tracks.<name>.initial` | string | Initial value of the track. |
| `tracks.<name>.values` | string[] | Closed set of values; transitioning outside it is an error. |
| `sla.after` | duration string | Positive duration, units `ms`, `s`, `m`, `h`, `d`; composite forms such as `1h30m` are accepted. |
| `sla.escalate.notify` | string | Notification key emitted on expiry. |
| `sla.escalate.action` | string | Action auto-fired on expiry. |

## 3. Complete example

```yaml
id: sample-onboarding
version: 2
roles: [applicant, reviewer, supervisor]
initialStage: intake
initialStatus: pending

tracks:
  payment:
    initial: not_required
    values: [not_required, required, confirmed, rejected]

actions:
  escalate:
    to: review
    kind: system
    policy: supervisor_can_escalate
    guards: [sla_expired]

stages:
  intake:
    pendingRole: applicant
    entry:
      - { kind: system, ref: verifyDocumentChecklist }
    sla:
      after: 72h
      escalate: { notify: intake_sla_expired, action: escalate }
    actions:
      submit:
        to: review
        kind: human
        policy: applicant_can_submit
        tracks: { payment: required }
        notify:
          - { template: review_requested, channels: [inbox], to: [reviewer] }

  review:
    pendingRole: reviewer
    steady: true
    entry:
      - { kind: rule, ref: resolvePaymentRequirement }
      - { kind: ai, ref: summarizeCaseForReviewer, gate: human }
    actions:
      approve: { to: approved, kind: human, policy: reviewer_can_decide, notify: { template: request_approved, channels: [inbox] } }
      reject: { to: rejected, kind: human, policy: reviewer_can_decide }

  approved: { final: true }
  rejected: { final: true }
```

## 4. Scalar and structure hazards

YAML has its own typing rules; these are the ones that bite when the target is a strict schema.

| Hazard | What to write | Why |
| --- | --- | --- |
| Booleans from words | Quote anything meant to be a string: `to: "yes"`. | Some YAML 1.1 parsers read `yes`, `no`, `on`, `off` as booleans, which would fail a string field. |
| Version numbers | `version: 2` (an integer, not `"2"`). | The schema requires an integer for `version` and strings everywhere else. |
| Durations | `after: 72h`, or `after: "1h30m"` when the leading digits could be read as a number. | The SLA parser accepts `ms`, `s`, `m`, `h`, `d`, and composites; other units are rejected. |
| Key order | Irrelevant. | Canonicalisation sorts object keys, so two documents with the same content produce the same hash. Array order is semantic and must be preserved (`entry` steps run in declaration order). |
| Anchors and aliases | Allowed, expanded before hashing. | Keeps large definitions readable without changing the pinned identity. |
| Merge keys (`<<`) | Not allowed. | A definition must declare its own fields so review can see what it actually sets. |
| Multiple documents in one file | Split into separate files. | One definition per file keeps `id`/`version` unambiguous. |

## 5. Validation: what each layer catches

| Layer | Catches | Does not catch |
| --- | --- | --- |
| JSON Schema (`schema/flowdefinition.schema.json`) | Unknown fields, wrong types, wrong enum values, missing top-level keys. Usable from any editor or CI step. | Anything requiring cross-field logic; see below. |
| `defineFlow` (Zod `flowSchema`) | Everything the schema catches, plus refinements such as "an AI step must declare `gate: human`, and only AI steps may declare a gate". | Whether `ref`s, policies, guards, templates, and channels actually resolve. |
| `lintFlow` / `lintInterpreterFlow` (`@naakwu/flowkit-core`) | Graph and wiring problems: unreachable stages, dead ends, actions on final stages, human actions without a policy, stages with no SLA, rule, or steady marker. | Whether a referenced name exists in a consumer registry. |
| `validateFlowkit` (`@naakwu/flowkit-temporal`) | Everything above plus declared-ref validation against consumer registries, and SLA duration syntax. This is the boot gate a worker should run before accepting work. | Runtime behaviour of the resolved handlers. |

A definition is only "valid" in the full sense when it passes all four layers.

## 6. Determinism and pinning

- A definition is canonicalised to a key-sorted JSON document and hashed (`sha256:<64 hex>`).
- Every execution is pinned at start to an immutable snapshot plus that hash, and `continueAsNew`
  carries the same snapshot forward. A running execution never re-reads a definition.
- Because of that, a file edited after a start cannot change the running execution — including a
  YAML file on disk.
- A content-identical YAML document and TypeScript definition produce the same hash. Only a content
  change produces a new hash.
- A structural change (a new stage, a removed action, a changed destination) is a new `version`, not
  an in-place edit: `(id, version)` finds a definition, while the snapshot and hash are what make
  replay safe.

## 7. File placement

Definitions are data, so they do not have to live in the worker bundle. A consumer chooses; the two
working options are a source file committed next to the code that loads it, or a definition
directory consumed at worker boot. Either way the loader runs **outside** the workflow sandbox:
parsing happens before a start, and the pinned snapshot is what the workflow receives.

A definition must not be parsed inside a workflow bundle: the deterministic sandbox has no
filesystem, and reading mutable definition data during replay would break determinism.

## 8. Tooling status

| Tool | Status in this checkout |
| --- | --- |
| JSON Schema emission (`schema/flowdefinition.schema.json`) | Implemented in `@naakwu/flowkit-definitions`; regeneration is checked by a test. |
| `parseFlowYaml(source)` / `loadFlowFile(path)` | Implemented in `@naakwu/flowkit-definitions` (`import { parseFlowYaml, loadFlowFile } from '@naakwu/flowkit-definitions'`). |
| `flowkit definitions validate <glob>` CLI | Implemented; exposed as the `flowkit` bin of `@naakwu/flowkit-definitions`. |
| Draft-07 validation of the emitted schema against legal fixtures | Implemented as a test (`packages/definitions/test/json-schema.test.ts`). |

The loader runs **outside** the workflow sandbox: it is the only place YAML is read, and it resolves a
definition to the same immutable snapshot + `sha256` hash that `publishDefinition` produces. A workflow
bundle never imports it — the CLI (`flowkit definitions validate`) is the authoring-time check, and
`validateFlowkit` is the boot-time check.
