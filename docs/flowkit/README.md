# Flowkit Reference Guide

Flowkit is split into five reusable packages and one independent consumer demo:

```text
core -> temporal
core -> tasks
notify
auth
       \-> flowkit-demo (consumer-owned adapters and domain)
```

Read the [package contracts](./package-contracts.md) for public API boundaries and
[testing and operations](./testing-and-operations.md) for the disposable stack.
