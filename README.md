> **Package scope migration:** Versions through 1.0.0 were published as `@naakwu/*`. From 1.1.0 onward, install and import the same API as `@teopeurt/*`.

## GitHub Packages

The packages are public on GitHub Packages. Configure the scope registry and authenticate with a GitHub token that has `read:packages`:

```ini
@teopeurt:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Consumers upgrading from 1.0.0 must rename `@naakwu/flowkit-*` imports and dependencies to `@teopeurt/flowkit-*`; the API is unchanged.

# FlowKit

FlowKit is a set of TypeScript packages for defining, running, projecting, and integrating durable flows.
This repository is Apache-2.0 licensed source. During Phase 2, packages install only from private GitHub Packages; public npm publication is planned for Phase 4.

## Packages

```text
@teopeurt/flowkit-core       definition and transition kernel
├── @teopeurt/flowkit-definitions   definition authoring format (YAML) and JSON Schema
├── @teopeurt/flowkit-tasks     task projections and claims
│   └── @teopeurt/flowkit-consumer  consumer integration contracts (also uses core)
└── @teopeurt/flowkit-temporal  Temporal runtime (uses core and consumer)
@teopeurt/flowkit-notify     notification planning and delivery contracts
@teopeurt/flowkit-auth       authentication and authorization contracts
```

See [package contracts](docs/package-contracts.md) and the [architecture](docs/architecture.md) for the supported entry points and boundaries.

## Install from GitHub Packages

You need a GitHub Packages token with `read:packages` and access to the private repository that hosts these packages. Keep the token in your package-manager configuration or environment; never commit it.

For npm, pnpm, Bun, and Yarn Classic, copy [`.npmrc.example`](.npmrc.example) to your user-level or project-level npm configuration, set `GITHUB_PACKAGES_TOKEN` in your shell or CI secret store, then install:

```sh
npm install @teopeurt/flowkit-core
pnpm add @teopeurt/flowkit-core
yarn add @teopeurt/flowkit-core
bun add @teopeurt/flowkit-core
```

For Yarn Berry (v2+), configure the scope in `.yarnrc.yml` instead of relying on `.npmrc`:

```yml
npmScopes:
  teopeurt:
    npmRegistryServer: "https://npm.pkg.github.com"
    npmAlwaysAuth: true
    npmAuthToken: "${GITHUB_PACKAGES_TOKEN}"
```

Then run `yarn add @teopeurt/flowkit-core`. Keep the token in your shell, CI secret store, or Yarn-supported environment configuration; do not commit it.

## Develop locally

FlowKit uses Bun workspaces. After cloning, run `bun install`, then use `bun test`, `bun run typecheck`, `bun run build`, or `bun run pack:check` from the repository root.

For a local sibling override, replace the affected dependency in the consuming workspace with a `workspace:` (same monorepo) or `file:` path (separate sibling checkout), run Bun install there, and validate the consuming application. Restore the released semver dependency before publishing or committing consumer manifests. Do not treat a sibling source path as a package runtime contract: consumers import package entry points only.

## Releases

All seven packages are pinned to the initial lockstep release version, `1.0.0`. The first private publication uses Changesets' publish plan to publish those existing manifest versions, rather than creating a synthetic version bump. A release builds and checks packed artifacts before publishing to GitHub Packages. Phase 2 remains private-package distribution; public npm publication is explicitly deferred to Phase 4.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes. Report vulnerabilities privately under [SECURITY.md](SECURITY.md).

Published package manifests use concrete semver ranges for internal FlowKit dependencies (not `workspace:`), so packed artifacts remain installable outside the monorepo. Use workspace/file overrides only for local validation and restore the released range before publishing.
