> **Package scope migration:** Versions through 1.0.0 were published as `@naakwu/*`. From 1.1.0 onward, install and import the same API as `@teopeurt/*`.

## Install

The packages are public on [npmjs.org](https://www.npmjs.org/); installing them needs no token and no registry configuration. Every release is also mirrored to GitHub Packages for consumers who already authenticate there. The seven package names are listed under [Packages](#packages).

Consumers upgrading from 1.0.0 must rename `@naakwu/flowkit-*` imports and dependencies to `@teopeurt/flowkit-*`; the API is unchanged.

# FlowKit

FlowKit is a set of TypeScript packages for defining, running, projecting, and integrating durable flows.
This repository is Apache-2.0 licensed source. The packages install from the public npm registry; GitHub Packages carries the same releases as a mirror.

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

## Install

Install from npmjs.org with no authentication:

```sh
npm install @teopeurt/flowkit-core
pnpm add @teopeurt/flowkit-core
yarn add @teopeurt/flowkit-core
bun add @teopeurt/flowkit-core
```

### GitHub Packages mirror

GitHub Packages hosts the same released versions. Installing from it requires a GitHub token with `read:packages` and access to this repository. Keep the token in your package-manager configuration or environment; never commit it.

For npm, pnpm, Bun, and Yarn Classic, copy [`.npmrc.example`](.npmrc.example) to your user-level or project-level npm configuration, set `GITHUB_PACKAGES_TOKEN` in your shell or CI secret store, then install the same package names as above.

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

All seven packages release in lockstep. A change to any package goes through a Changesets release PR; the release job validates the packed manifests and runs the exact candidate tarballs against the downstream demo before publishing.

Publication targets two registries, in order: GitHub Packages first, then npmjs.org. `bun run publish:npm` uploads the tarballs the candidate gate tested instead of repacking them, and skips any `<name>@<version>` that npmjs.org already carries, so a partially failed run resumes cleanly. Installing from npmjs.org needs no token; the GitHub Packages mirror requires `read:packages`.

Version 1.1.0 on GitHub Packages is not installable because its tarballs shipped `workspace:` dependency ranges. Version 1.1.1 is the first installable release and the first version published on npmjs.org.

Maintainers: see [`.changeset/README.md`](.changeset/README.md) for the one-time npm organization and `NPM_TOKEN` setup.

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting changes. Report vulnerabilities privately under [SECURITY.md](SECURITY.md).

Published package manifests use concrete semver ranges for internal FlowKit dependencies (not `workspace:`), so packed artifacts remain installable outside the monorepo. Use workspace/file overrides only for local validation and restore the released range before publishing.
