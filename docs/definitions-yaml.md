# Flow definition authoring format (YAML binding)

**Status:** format specification. See [Tooling status](#8-tooling-status) for the implementation that
enforces it in this checkout.

A Flowkit definition is data: `@teopeurt/flowkit-core` validates it with a Zod schema and a generic
interpreter executes any definition it accepts. The TypeScript form (`defineFlow({...})`) is one way
to write that data. This document specifies the YAML form — the same document, written in a file
instead of a module, so it can be edited without a build.

The YAML form is a **serialisation, not a second language**. Every field name, nesting level, and
constraint comes from `flowSchema`; nothing here may differ from the TypeScript form. The loader adds
only the structural rules below, which exist because a YAML file is untrusted input rather than a
module the compiler already checked.

## 1. Document rules

| Rule | Behaviour |
| --- | --- |
| One definition per file | A file contains exactly one definition document. An empty stream and a multi-document stream are both rejected. |
| Identity lives in the document | `id` and `version` are required fields. The file name is not authoritative. |
| Unknown fields are rejected | Every object is strict: a typo or an unsupported option fails validation instead of being ignored. |
| No code | The format cannot express expressions, function calls, or imports. Dynamic behaviour is referenced by name (`ref`) and resolved from consumer registries at runtime. |
| Mapping keys are text | A key must be a string. An unquoted `null`, `~`, `yes`, `off` or `1` key is rejected with a hint to quote it; duplicates are detected on the key's text (so `1` and `"1"`, or `yes` and `"true"`, collide); `__proto__` is rejected at any depth. |
| Anchors and aliases | Allowed, up to 1000 expansions of one anchor. They are expanded before the definition is canonicalised, so aliases do not affect the resulting hash. |
| Merge keys (`<<`) | A plain `<<` is rejected. A quoted `"<<"` is an ordinary key — and then fails as an unrecognised field wherever it appears. |
| Explicit tags | Only the core tags `!!str`, `!!int`, `!!float`, `!!bool`, `!!null`, `!!map` and `!!seq`. `!foo`, `!!js/function` and `!!timestamp` are rejected at the tagged node. |
| Parser warnings are errors | Any warning the YAML parser emits (`yaml` package) is reported as an issue and fails the document. |
| Input size | A source larger than 2 MiB (2097152 bytes, UTF-8) is rejected before it is parsed. |

## 2. Field reference

Top level (`FlowDefinition`):

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `id` | string | yes | Stable definition identity, used together with `version` to find a definition. |
| `version` | integer ≥ 0 | yes | Pinned into every execution started from this definition. Written as a plain decimal integer (`0`, `1`, `12`) — never `"2"`, `010`, `0x0A`, `1e1` or `2.0`. |
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
| `kind` | `system` \| `ai` \| `rule` \| `orchestrate` | Step kind. |
| `ref` | string | Name resolved from the consumer registry at runtime. This is the escape hatch: logic that cannot be serialised stays in code. |
| `gate` | `human` \| `auto` | Only valid on `ai` and `orchestrate` steps, and required there. `human`: AI output is recorded for a person to act on. `auto`: the named `decide` rule may fire a system action from the output (see below). |
| `decide` | string | Required with `gate: auto`, rejected otherwise. Name of a rule in the consumer's `rules` registry. |

**Auto gates.** `gate: auto` lets an AI step release its stage without a person, but only through a
rule the consumer wrote and registered. After the AI step completes, the rule runs with the step's
output (`gatedOutput`) and the accumulated entry facts. If it returns a system action name, that action
is fired as a `rule`-origin command with operation id `gate:<epoch>:<index>`; the step result records
`gateDecision: { outcome: 'auto', action }`. In every other case the stage waits for a human exactly as
with `gate: human`: the rule returned nothing, the rule threw, the rule is not registered, or the AI
step degraded (`degraded_to_human`). `validateFlowkit` requires the `decide` rule to be registered and
to name only system actions available from the stage. Auto-fired actions still go through the action's
guards and count toward `maxAutomaticTransitionsPerTurn`. Because an undecided auto gate falls back to a
human, the stage still needs an SLA, a `steady` marker or a rule to satisfy `lintFlow`.

```yaml
entry:
  - { kind: ai, ref: assessChange, gate: auto, decide: lowRiskAutoApprove }
actions:
  proceed: { to: implement, kind: system, guards: [withinBudget] }
  approve: { to: implement, kind: human, policy: reviewerCanApprove }   # fallback when not auto-released

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
| `sla.escalate.notify` | string | Role to notify on expiry; must be a declared role. |
| `sla.escalate.action` | string | System action auto-fired on expiry; must be declared on the stage or be an eligible top-level action. |

## 3. Complete example

```

**Orchestrate steps.** `kind: orchestrate` runs a chief-of-staff orchestrator: a plan activity returns a
bounded list of subagent tasks, one activity per task runs in parallel under a concurrency cap, and a
synthesize activity merges the results. The step requires `gate` exactly as an `ai` step does, so its
output never transitions the flow by itself; with `gate: auto` the `decide` rule additionally receives
`tasks` (the final status of every subagent) alongside `gatedOutput`. A stage may declare at most one
`orchestrate` step.

```yaml
entry:
  - { kind: orchestrate, ref: buildFeature, gate: auto, decide: allSubagentsClean }
```

The orchestration runs **in the background**: stage entry starts it and returns at once, so the stage's
SLA is armed and human actions and signals are handled while subagents work. The update that caused the
stage entry returns when the orchestration has *started*, not finished. Because of that, a later `rule`
step in the same entry does not see the orchestrator's output; only its `decide` rule does.

- Limits (`maxTasks`, `maxConcurrency`, `failFast`, `maxOutputBytes`, activity options) belong to the
  consumer's `orchestrators` registration, never to the definition. Defaults are 16 tasks, concurrency 4,
  `failFast: false`, and 65536 bytes of output; tasks and concurrency are capped at 64.
- A plan that names an agent outside the registration's `agents`, repeats a task id, exceeds `maxTasks`,
  or fails, a failed synthesis, and an oversized output all set the step to `degraded_to_human`.
- One failed subagent does not stop the others unless `failFast` is set; synthesis still runs and
  `decide` sees the failed status, so it can refuse to release.
- If the stage changes first (a human action, a signal, an SLA escalation), the orchestration is
  cancelled, its step result becomes `superseded`, and its late results are discarded.
- A releasing action is enqueued as a `rule`-origin command with operation id `orch:<epoch>:<index>` and
  goes through the same guards, context resolution and projection as any other transition.
- `continueAsNew` is deferred while an orchestration is running. Activity idempotency keys are
  `[workflowId, entryEpoch, stepIndex, phase]`, with phase `"plan"`, `"synthesize"`, or `"task", taskId`.
- `lintFlow` warns (`orchestrate-without-sla`) when a stage with an `orchestrate` step has no SLA.
yaml
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
      escalate: { notify: supervisor, action: escalate }
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

YAML has its own typing rules; these are the ones that bite when the target is a strict schema. Each
row states what is enforced, not what is advisable.

| Hazard | What to write | Enforced rule |
| --- | --- | --- |
| Booleans from words | Quote anything meant to be a string: `to: "yes"`. | The document is parsed as YAML 1.1, so `yes`, `no`, `on` and `off` are booleans; a string field then fails with `Expected string, received boolean`. |
| Version spelling | `version: 2` — plain digits, no quotes, no sign, no leading zero. | The loader reads the scalar's source text: only `/^(0\|[1-9][0-9]*)$/` within the safe-integer range is accepted. `09`, `010`, `0x0A`, `1:00`, `1_0`, `1e1`, `2.0`, `.inf`, `9007199254740993` and a quoted `"2"` are rejected, because each would pin a number other than the one written, or is not a number at all. |
| Mapping keys | Quote any key that is not obviously text. | Keys are compared by their string form: an unquoted `null`, `~`, `yes`, `off` or `1` key is rejected with a hint to quote it, and `1` / `"1"` or `yes` / `"true"` are the same key, so the second is reported as a duplicate. |
| `__proto__` | Rename the key. | Rejected as a key at any depth, quoted or plain. |
| Duplicate keys | Declare each key once. | Duplicates are detected in one pass on the key's text and reported at the second key with `Map keys must be unique`. |
| Durations | `after: 72h`, or `after: 1h30m` (already text — no quotes needed). | `after: 60` is a YAML number and fails the string type. The duration itself (positive, units `ms`, `s`, `m`, `h`, `d`, composites accepted) is checked by `validateFlowkit` as `invalid-sla-duration`. |
| Explicit tags | Write plain values. | Only `!!str`, `!!int`, `!!float`, `!!bool`, `!!null`, `!!map` and `!!seq` are accepted; `!foo` and `!!js/function` are rejected at the tagged node. |
| Key order | Irrelevant. | Canonicalisation sorts object keys, so two documents with the same content produce the same hash. Array order is semantic and must be preserved (`entry` steps run in declaration order). |
| Anchors and aliases | Reuse a shared block with `&a` / `*a`. | Aliases are expanded before hashing, so they never change the hash. One anchor may be expanded at most 1000 times; beyond that the load fails with a typed error naming the alias line, not a crash. |
| Merge keys (`<<`) | Write every field out. | A plain `<<` key is rejected; a quoted `"<<"` is an ordinary key and fails as an unrecognised field at that position. |
| Multiple documents in one file | Split into separate files. | The second document is rejected, with its line. |
| File size | Keep the source under 2 MiB. | A source over `MAX_DEFINITION_BYTES` (2097152 bytes) is rejected before parsing, as a `FlowDefinitionYamlError` at line 1, column 1. |
| Non-regular file | Pass a regular file path. | `loadFlowFile` rejects a directory, FIFO, socket or device as not a regular file, without reading it. |

## 5. Validation: what each layer catches

| Layer | Catches | Does not catch |
| --- | --- | --- |
| YAML loader (`parseFlowYaml` / `loadFlowFile`) | Everything listed in §1: document count, key and tag rules, the version spelling, the byte cap, the alias limit, then everything `flowSchema` rejects. | Anything needing a consumer registry, and the graph checks below. |
| JSON Schema (`schema/flowdefinition.schema.json`) | Unknown fields, wrong types, wrong enum values, missing top-level keys. Usable from any editor or CI step. | Anything requiring cross-field logic; see below. |
| `defineFlow` (Zod `flowSchema`) | Everything the schema catches, plus refinements such as "an AI step must declare `gate` (`human` or `auto`), `gate: auto` requires `decide` and `decide` requires `gate: auto`, and only AI steps may declare a gate". | Whether `ref`s, policies, guards, templates, and channels actually resolve. |
| `lintFlow` / `lintInterpreterFlow` (`@teopeurt/flowkit-core`) | Graph and wiring problems: unreachable stages, dead ends, actions on final stages, human actions without a policy, stages with no SLA, rule, or steady marker. | Whether a referenced name exists in a consumer registry. |
| `validateFlowkit` (`@teopeurt/flowkit-temporal`) | Everything above plus declared-ref validation against consumer registries, and SLA duration syntax. This is the boot gate a worker should run before accepting work. | Runtime behaviour of the resolved handlers. |

A definition is only "valid" in the full sense when it passes every layer.

Ref lookups are own-entry lookups in every layer that performs one — the core transition, the
`validateFlowkit` boot checks, and the interpreter's rule lookup all use `Object.hasOwn`, never a bare
`registry[name]`. A ref named like an `Object.prototype` member (`constructor`, `toString`,
`valueOf`, `hasOwnProperty`) is therefore a missing ref, and can never be satisfied by an inherited
member.

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
| JSON Schema emission (`schema/flowdefinition.schema.json`) | Implemented in `@teopeurt/flowkit-definitions`; regeneration is checked by `packages/definitions/test/json-schema.test.ts`. |
| `parseFlowYaml(source)` / `loadFlowFile(path)` | Implemented and exported by `@teopeurt/flowkit-definitions`. |
| `flowkit definitions validate` CLI | Implemented as the `flowkit` bin of `@teopeurt/flowkit-definitions`. |
| Draft-07 validation of the emitted schema against legal fixtures | Implemented as a test (`packages/definitions/test/json-schema.test.ts`). |

The loader runs **outside** the workflow sandbox: it is the only place YAML is read, and it resolves a
definition to the same immutable snapshot + `sha256` hash that `publishDefinition` produces. A workflow
bundle never imports it — the CLI (`flowkit definitions validate`) is the authoring-time check, and
`validateFlowkit` is the boot-time check.

### 8.1 Loader contract

```text
parseFlowYaml(source, { sourceName? }): FlowDefinition
loadFlowFile(path): Promise<FlowDefinition>
```

`parseFlowYaml` is a pure function of its input: it never touches the filesystem, and `sourceName` is
used only in error messages. `loadFlowFile` opens the path, checks the open descriptor, and parses
what it read.

| Limit | Enforced value |
| --- | --- |
| Source size | `MAX_DEFINITION_BYTES` = 2097152 bytes (2 MiB) of UTF-8. Checked before parsing; `loadFlowFile` also checks the file size before reading it. |
| Alias expansion | 1000 expansions of one anchor (`maxAliasCount`). |
| Documents | Exactly one, and not empty. |
| Mapping keys | Text only; unique by text; `__proto__` rejected at any depth. |
| Merge keys | A plain `<<` rejected, a quoted `"<<"` kept as an ordinary key. |
| Tags | The seven core tags only; every other tag rejected at the node. |
| Files | Regular files only: a directory, FIFO, socket or device is rejected without being read. |

Two error classes, so a caller can separate "cannot open the file" from "the file is not a definition":

| Error | Thrown for | Carries |
| --- | --- | --- |
| `FlowDefinitionFileError` | The path cannot be opened or read, or is not a regular file. | `path`, `cause` — no position, because an I/O failure has none. |
| `FlowDefinitionYamlError` | The byte cap, malformed YAML, an empty or multi-document stream, a merge key, the key/tag/version rules, an alias bomb, or anything `flowSchema` rejects. | `issues: Array<{ path, line?, column?, message }>` and `sourceName`. |

`path` in an issue is a dot-joined key path (`stages.review.actions.approve.to`, `stages.review.entry.0.ref`,
or `<document>` for the whole stream); `line` and `column` are 1-indexed and present whenever the source
names the offending position.

### 8.2 CLI contract

> **Warning:** Without `--registries`, declared-reference validation is **SKIPPED**. A typo in a policy, guard, rule, or step name can pass. Supply a registries manifest to check references.

See the [CLI quickstart](./cli-quickstart.md) for a walkthrough.

```sh
flowkit definitions validate <glob-or-path>... [--registries <file>] [--json] [--hash]
```

| Argument | Behaviour |
| --- | --- |
| `<glob-or-path>...` | One or more positional arguments. All are expanded, de-duplicated by real path, sorted, and validated. A file matched by two arguments is validated once. |
| `--registries <file>` / `--registries=<file>` | Enables declared-ref validation against a manifest (§8.4). |
| `--json` | Writes exactly one JSON document to stdout, for every outcome (§8.3). May appear anywhere. |

| Glob syntax | Matches |
| --- | --- |
| `*` | Any run of characters within one path segment. |
| `**` | Zero or more path segments when written `**/`; otherwise any run of characters, including `/`. |
| `?` | Exactly one character other than `/`. |
| `[...]` | A character class, passed through to the regular expression. |
| `{a,b}` | **Not supported** — a usage error (exit 2). Pass each file as its own argument. |

An argument that exists literally is read as written, even when it contains `*`, `?` or brackets
(`a[1].yaml` is a file name, not a pattern). Only a non-existent argument is treated as a glob. Paths
are resolved against the working directory and printed absolute.

Symbolic links are followed, to files and to directories (including under `**`); a link cycle
terminates and the real file is still validated. A dangling link is an unreadable entry (exit 5), not
a no-match.

| Exit code | Meaning |
| --- | --- |
| 0 | Every definition is valid. |
| 1 | One or more definitions have validation issues. |
| 2 | Usage error: wrong subcommand, unknown option, no positional argument, empty `--registries` value, or brace alternation. |
| 3 | The `--registries` manifest does not exist (`ENOENT`). |
| 4 | The `--registries` manifest is malformed. |
| 5 | A definition file cannot be read: unreadable, not a regular file, or a dangling link. |
| 6 | The `--registries` manifest cannot be read: permissions, a directory, another I/O error. |
| 7 | A glob or path matched no definition files. |
| 70 | Internal error: an unexpected exception while validating a file. |

Codes 2, 3, 4, 6 and 7 are **fatal**: they stop the run before any file is validated. When per-file
results disagree, the exit code is the worst of them, highest priority first: **5 > 70 > 1 > 0**.

One unreadable file does not abort the run: every readable file is still validated and reported, and
its issues still appear, alongside an `unreadable` entry for the file that failed (exit 5).

Text mode writes `<issue-path>:<line>:<col> <code> <message>` per issue to stdout, an unreadable-file
message to stderr, a `# <file>` header before each file when more than one file was validated, and a
summary line (`N definition file(s) valid.` or `N issue(s) across M file(s).`). Without `--registries`,
the registry-dependent checks are skipped and the run states so:

```text
$ flowkit definitions validate definitions/leave.yaml
Skipped: declared-ref validation (policies, guards, rules, system steps, AI steps, templates, channels)
1 definition file(s) valid.
```

The skipped issue codes are `missing-policy-ref`, `missing-guard-ref`, `missing-rule-ref`,
`missing-system-step-ref`, `missing-ai-step-ref`, `missing-template-ref`, `missing-channel-ref`,
`rule-action-unavailable` and `rule-action-not-system`.

### 8.3 `--json`

stdout is always exactly one JSON document, including for usage, manifest and no-match failures; a
fatal failure also writes its message to stderr. Per-file output (shape; values are placeholders):

```json
{
  "valid": false,
  "skippedChecks": [],
  "files": [
    {
      "path": "/abs/path/to/definition.yaml",
      "kind": "valid | invalid | unreadable | internal-error",
      "hash": "sha256:<64 lowercase hex> | null",
      "issues": [
        { "path": "stages.draft", "line": 12, "column": 5, "code": "unreachable-stage", "message": "..." }
      ],
      "message": "present only on unreadable and internal-error entries"
    }
  ]
}
```

`line` and `column` are `null` when the issue's path has no position in the source.
`skippedChecks` lists the checks that were skipped (the declared-ref note when no manifest was given,
otherwise `[]`).

Fatal output — `kind` is one of `usage`, `manifest-missing`, `manifest-unreadable`,
`manifest-malformed`, `no-files-matched`, `internal-error`:

```json
{
  "valid": false,
  "error": { "code": 7, "kind": "no-files-matched", "message": "..." },
  "files": []
}
```

Captured from the CLI (paths are printed relative to the working directory):

```json
{
  "valid": true,
  "skippedChecks": [],
  "files": [
    {
      "path": "packages/definitions/test/fixtures/cli-clean.yaml",
      "kind": "valid",
      "hash": "sha256:4b6b23b3d7c1f1943502180d6a85add6cfd6692fa8d392e8c876c89e35aa46c4",
      "issues": []
    }
  ]
}
```

```json
{
  "valid": false,
  "skippedChecks": [],
  "files": [
    {
      "path": "packages/definitions/test/fixtures/cli-four-issues.yaml",
      "kind": "invalid",
      "hash": "sha256:5850c6c7cd59495c6c7085373bfaa5defa613b35946bb41cc4ff1de6a5137d15",
      "issues": [
        {
          "path": "stages.orphaned",
          "line": 19,
          "column": 5,
          "code": "unreachable-stage",
          "message": "Stage \"orphaned\" cannot be reached from \"pending\"."
        },
        {
          "path": "stages.pending.actions.approve.policy",
          "line": 12,
          "column": 9,
          "code": "missing-action-policy",
          "message": "Human action \"approve\" must declare an authorization policy."
        },
        {
          "path": "stages.pending.entry.0.ref",
          "line": 9,
          "column": 30,
          "code": "missing-system-step-ref",
          "message": "Missing system step ref \"danglingSystemStep\"."
        },
        {
          "path": "stages.approved",
          "line": 15,
          "column": 5,
          "code": "final-stage-schedules-work",
          "message": "Final stage \"approved\" cannot declare entry work or an SLA."
        }
      ]
    }
  ]
}
```

```json
{
  "valid": false,
  "error": {
    "code": 7,
    "kind": "no-files-matched",
    "message": "No definition files matched \"test/fixtures/nope-*.yaml\"."
  },
  "files": []
}
```

### 8.4 Registries manifest

A `--registries` file is YAML or JSON, parsed with the same YAML 1.1 rules and merge-key setting as a
definition, so a name means the same thing in both files. Only the declared names matter; the CLI
never invokes a handler.

| Section | Names checked |
| --- | --- |
| `policies` | Action `policy`. |
| `guards` | Action `guards`. |
| `rules` | `rule` step `ref` (also needs an `actions` list, see below). |
| `systemSteps` | `system` step `ref`. |
| `aiSteps` | `ai` step `ref`. |
| `orchestrators` | `orchestrate` step `ref` (also needs an `agents` list and may declare `maxTasks`, `maxConcurrency`, `failFast`, `maxOutputBytes`). |
| `templates` | Notification `template`. |
| `channels` | Notification `channels`. |

```yaml
policies:
  employee_can_submit: {}
  manager_can_decide: {}
rules:
  route_after_review: { actions: [approve, reject] }
systemSteps:
  prepare: {}
aiSteps:
  summarize: {}
orchestrators:
  buildFeature: { agents: [coder, tester], maxTasks: 8 }
guards:
  sla_expired: {}
templates:
  approved_notice: {}
channels:
  inbox: {}
```

| Rule | Enforcement |
| --- | --- |
| Shape | The document must be a mapping of sections; an unknown section is a malformed manifest (exit 4). |
| Section values | A section is a mapping of names (its values are ignored), or empty. `policies:` with nothing under it declares no names. |
| Rules | A `rules` entry must be a mapping with an `actions` list of strings. Each name in that list must be an action available from the stage and must be a `system` action, or the run reports `rule-action-unavailable` / `rule-action-not-system`. |
| Names are strings | Because the manifest is YAML 1.1, an unquoted numeric or boolean-looking name is not a string and is rejected as malformed with a hint to quote it: write `policies: { "010": {} }`. `"010"` and `"10"` are different names, and a definition's policy `"10"` does not resolve against `"010"`. |
| Own entries only | Names are matched as own entries of the section. A definition that refers to `constructor`, `toString` or `__proto__` is reported as a missing ref; it can never be satisfied by an inherited object member. |

A manifest that does not exist exits 3; one that cannot be read (a directory, permissions) exits 6;
one that parses but breaks the rules above exits 4.
