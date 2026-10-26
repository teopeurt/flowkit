# Changesets

FlowKit packages release in lockstep. The initial private publication is the seven package manifests already pinned at `1.0.0`; `release:plan` uses Changesets' `publish-plan` command so it identifies packages that have not yet been published at those manifest versions. It does not create a version bump.

After the initial publication, add a changeset for every publishable change, run `release:version` through the Changesets release PR workflow, and then use `release:plan` and `release:validate` to check the packages ready for publication.

`bun run release:version` is more than `changeset version`. It runs `changeset version`, then `scripts/sync-release-versions.ts` rewrites each package's `FLOWKIT_*_VERSION` constant and the seven `bun.lock` workspace version entries, and finally verifies the lockfile with `bun install --frozen-lockfile` and rebuilds the packages. The release PR therefore commits manifests, version constants, and the lockfile together; do not hand-edit those files during a release.
