# @naakwu/flowkit-definitions

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
