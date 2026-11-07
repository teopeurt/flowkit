# Contributing to FlowKit

Thanks for improving FlowKit. This repository is Apache-2.0 licensed; contributions must be compatible with that license.

## Local workflow

Use Bun only. Run `bun install`, make a focused change, then run the narrowest relevant checks. Before proposing package changes, run `bun test`, `bun run typecheck`, and `bun run pack:check` when the package boundary or packed contents can be affected.

Keep public APIs aligned with each package's `package.json` `exports` map. Do not document or import internal source paths. Add tests for externally observable behavior and keep package versions lockstep unless the release policy changes.

## Private package development

Packages are published on npmjs.org and mirrored to GitHub Packages; installing from npmjs.org needs no token. A consumer may temporarily use a sibling `workspace:` or `file:` override for local validation. Record the override only in local work, test the consumer, and restore the normal released semver reference before committing a consuming manifest or preparing a release.

## Changes and releases

Describe the package boundary affected, update its README and the architecture/contract docs when needed, and include verification output in the change description. The initial private publication releases the already-pinned `1.0.0` manifests through `bun run release:plan` and `bun run release:validate`; it must not be versioned to `1.0.1` first. Later releases use a Changesets release PR to version all seven fixed packages before the same publish-plan validation. `bun run release:version` runs `changeset version` and then syncs every `FLOWKIT_*_VERSION` constant and the `bun.lock` workspace versions, so the release PR contains a fully consistent tree. Releases are produced from checked packed artifacts and published to GitHub Packages first and npmjs.org second; the npm step uploads the tarballs the candidate gate exercised.

Published package manifests use concrete semver ranges for internal FlowKit dependencies (not `workspace:`), so packed artifacts remain installable outside the monorepo. Use workspace/file overrides only for local validation and restore the released range before publishing.
