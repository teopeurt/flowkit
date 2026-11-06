# @teopeurt/flowkit-definitions

## 1.1.0

### Minor Changes

- 51dcb7c: Add `gate: auto` for AI steps and a new `orchestrate` step kind.
  
  `gate: auto` lets an AI or orchestrate step release its stage through a named `decide` rule that receives the step output; it fails closed to a human when the rule declines, throws, is missing, or the step degrades. `gate: human` is unchanged.
  
  `orchestrate` runs a chief-of-staff orchestrator in the background: a plan activity returns bounded subagent tasks, subagent activities run in parallel under a concurrency cap, and a synthesize activity merges the results. The stage stays responsive, the SLA stays armed, and a stage change cancels the orchestration and discards its late results. Limits live in the consumer's `orchestrators` registration. Boot validation checks the registration and the `decide` rule, step results record `tasks` and `gateDecision`, `lintFlow` warns on `orchestrate-without-sla`, and `flowkit definitions validate` accepts an `orchestrators` manifest section.
  
  Definitions that use either feature are rejected by older runtimes; upgrade workers first. Existing definitions are unaffected.

### Patch Changes

- Updated dependencies [51dcb7c]
  - @teopeurt/flowkit-core@1.1.0
  - @teopeurt/flowkit-temporal@1.1.0

## 1.0.0

### Major Changes

- Initial private publication, pinned to the lockstep `1.0.0` version alongside the six existing
  packages. Adds the YAML authoring binding of the core definition model (`parseFlowYaml`,
  `loadFlowFile`), a draft-07 JSON Schema generated from core's `flowSchema`, and the
  `flowkit definitions validate` CLI. Lockstep publication is a major boundary for a new package,
  so `1.0.0` is set by hand rather than through a changeset.

### Patch Changes

- 3aaac51: Refs named like `Object.prototype` members (`constructor`, `toString`, `valueOf`,
  `__proto__`) used to count as registered policy, guard, rule, and manifest entries, so a
  definition could be validated and a transition authorised on a ref that was never defined.
  Registry lookups now count only own entries, and the CLI reports such refs as missing.
