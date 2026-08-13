# FlowKit

FlowKit is a set of TypeScript packages for defining, running, projecting, and integrating durable flows.
This repository is Apache-2.0 licensed source. During Phase 2, packages install only from private GitHub Packages; public npm publication is planned for Phase 4.

## Packages

```text
@naakwu/flowkit-core       definition and transition kernel
├── @naakwu/flowkit-tasks     task projections and claims
│   └── @naakwu/flowkit-consumer  consumer integration contracts (also uses core)
└── @naakwu/flowkit-temporal  Temporal runtime (uses core and consumer)
@naakwu/flowkit-notify     notification planning and delivery contracts
@naakwu/flowkit-auth       authentication and authorization contracts
```

See [package contracts](docs/package-contracts.md) and the [architecture](docs/architecture.md) for the supported entry points and boundaries.

## Install from GitHub Packages

You need a GitHub Packages token with `read:packages` and access to the private repository that hosts these packages. Keep the token in your package-manager configuration or environment; never commit it.

For npm, pnpm, Bun, and Yarn Classic, copy [`.npmrc.example`](.npmrc.example) to your user-level or project-level npm configuration, set `GITHUB_PACKAGES_TOKEN` in your shell or CI secret store, then install:

```sh
npm install @naakwu/flowkit-core
pnpm add @naakwu/flowkit-core
yarn add @naakwu/flowkit-core
bun add @naakwu/flowkit-core
```

For Yarn Berry (v2+), configure the scope in `.yarnrc.yml` instead of relying on `.npmrc`:

```yml
npmScopes:
  naakwu:
    npmRegistryServer: "https://npm.pkg.github.com"
    npmAlwaysAuth: true
    npmAuthToken: "${GITHUB_PACKAGES_TOKEN}"
```

Then run `yarn add @naakwu/flowkit-core`. Keep the token in your shell, CI secret store, or Yarn-supported environment configuration; do not commit it.

## Develop locally

FlowKit uses Bun workspaces. After cloning, run `bun install`, then use `bun test`, `bun run typecheck`, `bun run build`, or `bun run pack:check` from the repository root.

For a local sibling override, replace the affected dependency in the consuming workspace with a `workspace:` (same monorepo) or `file:` path (separate sibling checkout), run Bun install there, and validate the consuming application. Restore the released semver dependency before publishing or committing consumer manifests. Do not treat a sibling source path as a package runtime contract: consumers import package entry points only.

## Releases

All six packages are pinned to the initial lockstep release version, `0.2.0`. The first private publication uses Changesets' publish plan to publish those existing manifest versions, rather than creating a synthetic version bump. A release builds and checks packed artifacts before publishing to GitHub Packages. Phase 2 remains private-package distribution; public npm publication is explicitly deferred to Phase 4.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes. Report vulnerabilities privately under [SECURITY.md](SECURITY.md).
