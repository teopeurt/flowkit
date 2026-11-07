# Changesets

FlowKit packages release in lockstep. The initial private publication is the seven package manifests already pinned at `1.0.0`; `release:plan` uses Changesets' `publish-plan` command so it identifies packages that have not yet been published at those manifest versions. It does not create a version bump.

After the initial publication, add a changeset for every publishable change, run `release:version` through the Changesets release PR workflow, and then use `release:plan` and `release:validate` to check the packages ready for publication.

`bun run release:version` is more than `changeset version`. It runs `changeset version`, then `scripts/sync-release-versions.ts` rewrites each package's `FLOWKIT_*_VERSION` constant and the seven `bun.lock` workspace version entries, and finally verifies the lockfile with `bun install --frozen-lockfile` and rebuilds the packages. The release PR therefore commits manifests, version constants, and the lockfile together; do not hand-edit those files during a release.

Published package manifests use concrete semver ranges for internal FlowKit dependencies (not `workspace:`), so packed artifacts remain installable outside the monorepo. Use workspace/file overrides only for local validation and restore the released range before publishing.

## Publication targets

A release publishes to GitHub Packages first (`bun run release:publish`) and then mirrors to npmjs.org (`bun run publish:npm`). The npm step uploads the exact npm-packed tarballs that the candidate gate exercised; the workflow hands their directory to the script through `FLOWKIT_CANDIDATE_TARBALL_DIR`, so nothing is repacked between the gate and the upload. The script skips any `<name>@<version>` that npmjs.org already carries, which makes reruns after a partial failure resumable, and stops at the first failure with the published, skipped, failed, and not-attempted lists.

`publishConfig.registry` is intentionally absent from the package manifests. npm applies that field at publish time and it overrides the `.npmrc`/userconfig registry, so a single manifest cannot target both registries. The registry is selected per command instead: setup-node's `.npmrc` for the GitHub Packages step, and `--registry https://registry.npmjs.org` with a temporary userconfig for `publish:npm`.

## One-time npm setup (maintainer)

1. Create the npm user or organization `teopeurt`; the `@teopeurt` scope must be owned by it.
2. Create a granular npm automation token with publish rights on `@teopeurt/*`.
3. Add it to the repository as the Actions secret `NPM_TOKEN`. The workflow reads it only as `${{ secrets.NPM_TOKEN }}` and never writes or echoes it.
4. After the first successful npm release, each package may be switched to npm trusted publishing. The publish job already grants `id-token: write`, and the `NPM_TOKEN` guard can be removed once every package uses trusted publishing.

Version 1.1.0 on GitHub Packages is not installable because its tarballs shipped `workspace:` dependency ranges. The first installable version — and the first version on npmjs.org — is the next release produced by the pipeline.

## Changesets for release-infrastructure changes

A release-tooling change (workflow, publish script, registry configuration) does not alter what consumers receive from any package, so it does not need a changeset. Add a changeset only when a change modifies at least one package's published contents.
