# Changesets

FlowKit packages release in lockstep. The initial private publication is the six package manifests already pinned at `0.2.0`; `release:plan` uses Changesets' `publish-plan` command so it identifies packages that have not yet been published at those manifest versions. It does not create a version bump.

After the initial publication, add a changeset for every publishable change, run `release:version` through the Changesets release PR workflow, and then use `release:plan` and `release:validate` to check the packages ready for publication.
