# Flowkit Reference Guide

Flowkit is split into seven reusable packages and one independent consumer demo:

```text
core -> definitions
core -> temporal
core -> tasks
notify
auth
       \-> flowkit-demo (consumer-owned adapters and domain)
```

Read the [package contracts](./package-contracts.md) for public API boundaries,
[definitions in YAML](./definitions-yaml.md) for the definition authoring format,
the [CLI quickstart](./cli-quickstart.md) for a walkthrough, the
[definitions deep dive](./definitions-deep-dive.md) for engine internals, gates,
orchestration, and replay, and [testing and operations](./testing-and-operations.md)
for the disposable stack.
