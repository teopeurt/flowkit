# Contributing to FlowKit

Thanks for improving FlowKit. This repository is Apache-2.0 licensed; contributions must be compatible with that license.

## Local workflow

Use Bun only. Run `bun install`, make a focused change, then run the narrowest relevant checks. Before proposing package changes, run `bun test`, `bun run typecheck`, and `bun run pack:check` when the package boundary or packed contents can be affected.

Keep public APIs aligned with each package's `package.json` `exports` map. Do not document or import internal source paths. Add tests for externally observable behavior and keep package versions lockstep unless the release policy changes.

## Private package development

Phase 2 packages are private GitHub Packages. A consumer may temporarily use a sibling `workspace:` or `file:` override for local validation. Record the override only in local work, test the consumer, and restore the normal released semver reference before committing a consuming manifest or preparing a release.

## Changes and releases

Describe the package boundary affected, update its README and the architecture/contract docs when needed, and include verification output in the change description. The initial private publication releases the already-pinned `1.0.0` manifests through `bun run release:plan` and `bun run release:validate`; it must not be versioned to `1.0.1` first. Later releases use a Changesets release PR to version all seven fixed packages before the same publish-plan validation. Releases are produced from checked packed artifacts and are published to GitHub Packages in Phase 2. Public npm publishing is a Phase 4 milestone.
