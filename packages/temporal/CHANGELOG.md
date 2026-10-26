# @naakwu/flowkit-temporal

## 1.0.0

### Major Changes

- 603a238: Add the worker-enrolment conformance contract, including organization-scoped IDs and the new
  action and signal contracts. These are breaking public contract changes, so `major` is correct;
  Changesets 3.0.0 applies this bump as `0.2.0` → `1.0.0` for each package.

### Patch Changes

- Updated dependencies [603a238]
  - @naakwu/flowkit-consumer@1.0.0
  - @naakwu/flowkit-core@1.0.0
- 3aaac51: Refs named like `Object.prototype` members (`constructor`, `toString`, `valueOf`,
  `__proto__`) used to count as registered policy, guard, and rule refs, so a workflow could
  authorise a transition on a ref that was never defined and then fail at `.run`. Registry and
  boot validation now count only own entries, so a missing ref is rejected before execution.
