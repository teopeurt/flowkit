# Flowkit CLI quickstart

This walkthrough is for authors who write workflow definitions, not for engineers.

## Install from GitHub Packages

GitHub Packages asks for a token even for public packages. Create a GitHub token with `read:packages`, then set `GITHUB_TOKEN` in your shell and create `.npmrc`:

```sh
@teopeurt:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Install and run the CLI:

```sh
bun add @teopeurt/flowkit-definitions
bunx flowkit definitions validate "definitions/**/*.yaml"
```

## Validate a definition

Create `definitions/leave.yaml` with one valid definition, then run:

```sh
bun packages/definitions/src/bin.ts definitions/leave.yaml
```

Output from this repository's valid example:

```text
Skipped: declared-ref validation (policies, guards, rules, system steps, AI steps, orchestrators, templates, channels)
1 definition file(s) valid.
```

> **Important:** Without `--registries`, reference checks are **SKIPPED**. A typo in a policy name passes unless you supply a registries manifest.

With a manifest, declared references are checked:

```sh
bun packages/definitions/src/bin.ts packages/definitions/test/fixtures/cli-clean.yaml --registries packages/definitions/test/fixtures/cli-clean.registries.yaml
```

```text
1 definition file(s) valid.
```

## Reading errors

The validator reports `path:line:col code message`. For example, these are the real paths and locations produced by the test fixture:

```text
stages.orphaned:19:5 unreachable-stage Stage "orphaned" cannot be reached from "pending".
stages.pending.actions.approve.policy:12:9 missing-action-policy Human action "approve" must declare an authorization policy.
stages.pending.entry.0.ref:9:30 missing-system-step-ref Missing system step ref "danglingSystemStep".
stages.approved:15:5 final-stage-schedules-work Final stage "approved" cannot declare entry work or an SLA.
```

Three common mistakes are: misspelling a key (the YAML/schema error names the key), pointing a transition at a stage that does not exist (the `to` path is reported), and using an undeclared policy ref (the policy path is reported). Fix the named line and column, then run the command again.

## Exit codes

| Code | Plain meaning |
|---:|---|
| 0 | Every file is valid. |
| 1 | At least one file has validation issues. |
| 2 | The command was used incorrectly. |
| 3–7 | A manifest or definition could not be read, was malformed, or matched nothing. |
| 70 | Unexpected internal error. |

## Check whether the definition changed

`--hash` prints the same deterministic hash used when Flowkit publishes a definition:

```sh
bun packages/definitions/src/bin.ts definitions/leave.yaml --hash
```

```text
sha256:4b6b23b3d7c1f1943502180d6a85add6cfd6692fa8d392e8c876c89e35aa46c4  /home/appadmin/stridekonfam/flowkit/flowkit/packages/definitions/test/fixtures/cli-clean.yaml
Skipped: declared-ref validation (policies, guards, rules, system steps, AI steps, orchestrators, templates, channels)
1 definition file(s) valid.
```

## Editor setup

Use the shipped JSON Schema. Add this as the first line of a YAML file:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/teopeurt/flowkit/main/packages/definitions/schema/flowdefinition.schema.json
```

## GitHub Actions CI recipe

Copy this job into a workflow. It fails when validation returns exit code 1.

```yaml
name: Validate definitions
on: [push, pull_request]
permissions:
  packages: read
jobs:
  definitions:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: '1.3.14'
      - run: printf '%s\n' '@teopeurt:registry=https://npm.pkg.github.com' '//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}' > .npmrc
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - run: bun add -d @teopeurt/flowkit-definitions
      - run: bunx flowkit definitions validate 'definitions/**/*.yaml' --registries definitions/registries.yaml
```

The workflow YAML parses as shown. The commands use the CLI's documented syntax; this repository cannot execute a GitHub-hosted job here.
