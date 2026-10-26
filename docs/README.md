# Flowkit Reference Guide

Flowkit is split into six reusable packages and one independent consumer demo:

```text
core -> definitions
core -> temporal
core -> tasks
notify
auth
       \-> flowkit-demo (consumer-owned adapters and domain)
```

Read the [package contracts](./package-contracts.md) for public API boundaries,
[definitions in YAML](./definitions-yaml.md) for the definition authoring format, and
[testing and operations](./testing-and-operations.md) for the disposable stack.
