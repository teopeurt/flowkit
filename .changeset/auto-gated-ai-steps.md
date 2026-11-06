---
"@naakwu/flowkit-core": minor
"@naakwu/flowkit-temporal": minor
"@naakwu/flowkit-consumer": minor
"@naakwu/flowkit-definitions": minor
---

Add `gate: auto` for AI entry steps. A named `decide` rule receives the step output and may fire a system action so a flow can proceed without a person; it fails closed to a human when the rule declines, throws, is missing, or the AI step degrades. `gate: human` is unchanged. Boot validation checks the `decide` rule's actions, and step results record a `gateDecision`.
