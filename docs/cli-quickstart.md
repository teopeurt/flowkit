# Flowkit CLI quickstart

This walkthrough is for authors who write workflow definitions, not for engineers. The examples use the published `@teopeurt/flowkit-definitions` package.

## Install from npm

The CLI is published on the public npm registry at [npmjs.org](https://www.npmjs.org/). Installing and running it needs no token and no `.npmrc`.

```sh
npm install --save-dev @teopeurt/flowkit-definitions
```

Or with Bun:

```sh
bun add -d @teopeurt/flowkit-definitions
```

Run the installed CLI from your project root:

```sh
npx flowkit definitions validate "definitions/**/*.yaml"
```

Or with Bun:

```sh
bunx flowkit definitions validate "definitions/**/*.yaml"
```

The package's binary is named `flowkit`, not `@teopeurt/flowkit-definitions`. To run it without adding the dependency to your project, name the package explicitly:

```sh
npx --yes --package @teopeurt/flowkit-definitions flowkit definitions validate "definitions/**/*.yaml"
```

```sh
bunx --package @teopeurt/flowkit-definitions flowkit definitions validate "definitions/**/*.yaml"
```

> **Version note:** `--help`, `--version` and `--hash` need **1.2.0 or later** — the first release containing this change, which is not published yet. Version 1.1.1 supports `flowkit definitions validate` only. Use 1.1.1 or later: 1.1.0 was GitHub Packages-only and is not installable because its tarballs shipped `workspace:` dependency ranges.

> The same versions are mirrored on GitHub Packages, which needs a `read:packages` token; that mirror is optional.

## Validate a definition

Create `definitions/leave.yaml` with one valid definition. For example:

```yaml
id: leave-approval
version: 1
roles: [employee, manager]
initialStage: requested
stages:
  requested:
    pendingRole: employee
    actions:
      submit: { to: awaiting_decision, kind: human, policy: employee_can_submit }
  awaiting_decision:
    pendingRole: manager
    actions:
      approve: { to: approved, kind: human, policy: manager_can_decide }
  approved: { final: true }
```

Then run:

```sh
npx flowkit definitions validate "definitions/**/*.yaml"
```

```text
Skipped: declared-ref validation (policies, guards, rules, system steps, AI steps, orchestrators, templates, channels)
1 definition file(s) valid.
```

> **Important:** Without `--registries`, reference checks are **SKIPPED**. A typo in a policy name passes unless you supply a registries manifest.

Create `flowkit.registries.yaml` next to the definitions directory:

```yaml
policies:
  employee_can_submit: {}
  manager_can_decide: {}
```

With a manifest, declared references are checked:

```sh
npx flowkit definitions validate "definitions/**/*.yaml" --registries flowkit.registries.yaml
```

```text
1 definition file(s) valid.
```

## Reading errors

The validator reports `path:line:col code message`. For example, these are the real paths and locations produced by an invalid definition:

```text
stages.orphaned:19:5 unreachable-stage Stage "orphaned" cannot be reached from "pending".
stages.pending.actions.approve.policy:12:9 missing-action-policy Human action "approve" must declare an authorization policy.
stages.pending.entry.0.ref:9:30 missing-system-step-ref Missing system step ref "danglingSystemStep".
stages.approved:15:5 final-stage-schedules-work Final stage "approved" cannot declare entry work or an SLA.
4 issue(s) across 1 file(s).
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

In 1.2.0 or later, `--hash` prints the same deterministic hash used when Flowkit publishes a definition:

```sh
npx flowkit definitions validate definitions/leave.yaml --hash
```

```text
sha256:7d2db4bb9bbcc7b993bd50f1b29120d2d3c3d00c23761db526b8a1e97e787589  definitions/leave.yaml
Skipped: declared-ref validation (policies, guards, rules, system steps, AI steps, orchestrators, templates, channels)
1 definition file(s) valid.
```

Paths in CLI output are relative to the working directory, so the same command prints the same text on any machine.

## Editor setup

Use the shipped JSON Schema. Add this as the first line of a YAML file:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/teopeurt/flowkit/main/packages/definitions/schema/flowdefinition.schema.json
```

## GitHub Actions CI recipe

Copy this job into a workflow. It installs the published CLI from npmjs.org without a token and fails when validation returns exit code 1. The job needs no `permissions:` block, no `.npmrc`, and no registry secret.

```yaml
name: Validate definitions
on: [push, pull_request]
jobs:
  definitions:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm install --save-dev @teopeurt/flowkit-definitions@1.1.1
      - run: npx flowkit definitions validate 'definitions/**/*.yaml' --registries flowkit.registries.yaml
```

> **Important:** Without `--registries`, reference checks are **SKIPPED** in CI too. Keep the manifest and the flag in the job.

The YAML above parses as shown. Its install and validate commands were run locally against the published 1.1.1 package; this repository cannot execute a GitHub-hosted job here.
