# @teopeurt/flowkit-consumer

## 1.1.0

### Minor Changes

- 51dcb7c: Add `gate: auto` for AI steps and a new `orchestrate` step kind.
  
  `gate: auto` lets an AI or orchestrate step release its stage through a named `decide` rule that receives the step output; it fails closed to a human when the rule declines, throws, is missing, or the step degrades. `gate: human` is unchanged.
  
  `orchestrate` runs a chief-of-staff orchestrator in the background: a plan activity returns bounded subagent tasks, subagent activities run in parallel under a concurrency cap, and a synthesize activity merges the results. The stage stays responsive, the SLA stays armed, and a stage change cancels the orchestration and discards its late results. Limits live in the consumer's `orchestrators` registration. Boot validation checks the registration and the `decide` rule, step results record `tasks` and `gateDecision`, `lintFlow` warns on `orchestrate-without-sla`, and `flowkit definitions validate` accepts an `orchestrators` manifest section.
  
  Definitions that use either feature are rejected by older runtimes; upgrade workers first. Existing definitions are unaffected.

### Patch Changes

- Updated dependencies [51dcb7c]
  - @teopeurt/flowkit-core@1.1.0
  - @teopeurt/flowkit-tasks@1.1.0

## 1.0.0

### Major Changes

- 603a238: Add the worker-enrolment conformance contract, including organization-scoped IDs and the new
  action and signal contracts. These are breaking public contract changes, so `major` is correct;
  Changesets 3.0.0 applies this bump as `0.2.0` → `1.0.0` for each package.

### Patch Changes

- Updated dependencies [603a238]
  - @naakwu/flowkit-core@1.0.0
  - @naakwu/flowkit-tasks@1.0.0
