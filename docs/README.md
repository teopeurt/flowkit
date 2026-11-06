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

`flowkit-demo` lives in its own public repository, [teopeurt/flowkit-demo](https://github.com/teopeurt/flowkit-demo).
The release workflow checks it out anonymously (it needs no token, because the repository is public) and runs the exact
release candidates against it before publishing.

Read the [package contracts](./package-contracts.md) for public API boundaries,
[definitions in YAML](./definitions-yaml.md) for the definition authoring format, and
[testing and operations](./testing-and-operations.md) for the disposable stack.
