# @naakwu/flowkit-definitions

Authoring surface for Flowkit workflow definitions. The definition model itself lives in
`@naakwu/flowkit-core`; this package owns how a definition is written down and how it is checked
before it reaches a worker bundle.

## What ships

| Artifact | Purpose |
| --- | --- |
| `parseFlowYaml(source)` / `loadFlowFile(path)` | Load a YAML definition into a validated `FlowDefinition`. |
| `flowkit definitions validate <glob-or-path>...` CLI | Validate definition files from the command line. |
| `schema/flowdefinition.schema.json` | JSON Schema (draft-07) generated from core's `flowSchema`. Use it for editor completion and for validating definitions in any language. |
| `FLOWKIT_DEFINITIONS_VERSION` | The package version, in lockstep with the other Flowkit packages. |
| `FLOW_DEFINITION_SCHEMA_PATH` | The schema's path relative to the installed package directory. |

The schema is generated, never hand-edited. Regenerate it with:

```sh
bun run --cwd packages/definitions schema:emit
```

A test fails if the committed artifact differs from what the current `flowSchema` produces, so the
schema cannot silently drift from the definition model.

## Loading a definition

```ts
import { parseFlowYaml, loadFlowFile, FlowDefinitionYamlError } from '@naakwu/flowkit-definitions';

{
  const source = `id: leave-approval
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
`;

  const definition = parseFlowYaml(source, { sourceName: 'leave.yaml' });
  const loadFromDisk = loadFlowFile;
  const isYamlError = (error: unknown): error is FlowDefinitionYamlError =>
    error instanceof FlowDefinitionYamlError;
  void definition;
  void loadFromDisk;
  void isYamlError;
}
```

`parseFlowYaml` is a pure function of its input — it never touches the filesystem, and `sourceName` is
used only in error messages. `loadFlowFile` reads a file and parses it.

| Error | Raised for | Carries |
| --- | --- | --- |
| `FlowDefinitionFileError` | The path cannot be opened or read, or is not a regular file. | `path`, `cause` |
| `FlowDefinitionYamlError` | The document cannot be turned into a valid definition: size cap, malformed YAML, an empty or multi-document stream, a merge key, a key/tag/version rule, an alias bomb, or a `flowSchema` rejection. | `issues` of `{ path, line, column, message }`, plus `sourceName` |

`line` and `column` are 1-indexed and present whenever the source names the offending position; `path`
is a dot-joined key path such as `stages.review.entry.0.ref`, or `<document>` for the whole stream.

The loader is a **transport, not a second authority**: it accepts exactly what `defineFlow` accepts.
The extra rules below exist only because a YAML file is untrusted input.

| Rule | Enforced behaviour |
| --- | --- |
| `version` | A plain decimal integer in the source (`0`, `1`, `12`), within the safe-integer range. `010`, `09`, `0x0A`, `1:00`, `1_0`, `1e1`, `2.0`, `.inf`, `9007199254740993` and a quoted `"2"` are rejected — each would pin a number other than the one written. |
| Mapping keys | Strings only. An unquoted `null`, `~`, `yes`, `off` or `1` key is rejected with a hint to quote it; keys are compared by their text, so `1` / `"1"` and `yes` / `"true"` are duplicates; `__proto__` is rejected at any depth. |
| Tags | Only `!!str`, `!!int`, `!!float`, `!!bool`, `!!null`, `!!map`, `!!seq`. `!foo`, `!!js/function`, `!!timestamp` are rejected at the tagged node. Parser warnings are errors. |
| Source size | At most `MAX_DEFINITION_BYTES` (2097152 bytes, 2 MiB) of UTF-8, checked before parsing. |
| Aliases | Allowed, up to 1000 expansions of one anchor; exceeding that is a typed error naming the alias line, not a crash. |
| Merge keys | A plain `<<` is rejected; a quoted `"<<"` is an ordinary key (and then fails as an unrecognised field). |
| Documents | Exactly one, non-empty. |
| Files | Regular files only: a directory, FIFO, socket or device is rejected as a `FlowDefinitionFileError` without being read. |

Anchors and aliases are expanded before the result is returned, so a YAML-authored definition and its
TypeScript twin produce the same `publishDefinition` `definitionHash`.

## Validating from the CLI

```sh
flowkit definitions validate "definitions/*.yaml" "definitions/**/*.yaml" --registries definitions/registries.yaml
```

One or more paths or globs are accepted. All arguments are expanded, de-duplicated by real path,
sorted, and validated; a file matched twice is validated once. Glob syntax is `*` (within one path
segment), `**` (any number of segments), `?` (one character) and `[...]` character classes — brace
alternation `{a,b}` is not supported and is a usage error. An argument that exists literally is read
by its exact name, even if it contains brackets; only a non-existent argument is treated as a glob.
Symbolic links are followed (to files and directories, cycle-safe); a dangling link is an unreadable
entry, not a no-match.

Text mode prints `<issue-path>:<line>:<col> <code> <message>` per issue (with a `# <file>` header per
file when more than one file was validated) and a summary line, and states which checks were skipped
when no manifest was given:

```text
$ flowkit definitions validate definitions/leave.yaml
Skipped: declared-ref validation (policies, guards, rules, system steps, AI steps, templates, channels)
1 definition file(s) valid.
```

An unreadable file does not abort the run: every readable file is still validated and reported.
Without `--registries` the CLI runs the registry-independent checks (schema, lint, SLA/final-stage
scheduling) and prints the skip note above.

| Exit code | Meaning |
| --- | --- |
| 0 | Every definition is valid. |
| 1 | One or more definitions have validation issues. |
| 2 | Usage error. |
| 3 | The `--registries` manifest does not exist. |
| 4 | The `--registries` manifest is malformed. |
| 5 | A definition file cannot be read (unreadable, not a regular file, dangling link). |
| 6 | The `--registries` manifest cannot be read (permissions, a directory, other I/O). |
| 7 | A glob or path matched no definition files. |
| 70 | Internal error: an unexpected exception while validating a file. |

Codes 2, 3, 4, 6 and 7 are fatal and stop the run before any file is validated. When per-file results
disagree, the exit code is the worst of them: **5 > 70 > 1 > 0**.

`--json` makes stdout exactly one JSON document, including for fatal failures. Per-file shape is
`{ valid, skippedChecks, files: [{ path, kind, issues: [{ path, line, column, code, message }] }] }`,
where `kind` is one of `valid`, `invalid`, `unreadable`, `internal-error` and an issue's `line` /
`column` is `null` when the path has no position. A fatal failure prints
`{ valid: false, error: { code, kind, message }, files: [] }`, where `kind` is `usage`,
`manifest-missing`, `manifest-unreadable`, `manifest-malformed`, `no-files-matched` or
`internal-error`, and writes the message to stderr as well.

The registries manifest lists declared refs by name — only the names matter to validation:

```yaml
policies:
  employee_can_submit: {}
  manager_can_decide: {}
systemSteps:
  prepare: {}
templates:
  approved_notice: {}
channels:
  inbox: {}
```

Sections are `policies`, `guards`, `rules`, `systemSteps`, `aiSteps`, `templates` and `channels`. The
manifest may be YAML or JSON and is parsed with the same YAML 1.1 rules as a definition, so a name
that looks numeric or boolean must be quoted (`policies: { "010": {} }`); an empty section
(`policies:`) declares no names. Names are matched as own entries only, so a definition referring to
`constructor` or `toString` is a missing ref and can never be satisfied by an inherited object member.

## Using the schema

Point an editor at the schema through a YAML language-server comment:

```yaml
# yaml-language-server: $schema=./node_modules/@naakwu/flowkit-definitions/schema/flowdefinition.schema.json
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

Validate the same document in CI with any draft-07 validator, or let the Flowkit CLI do it.

## What the schema does not cover

`flowSchema` enforces rules that JSON Schema cannot express, notably that an AI step must declare
`gate: human` or `gate: auto` (with a `decide` rule) and that no other step kind may declare a gate. Those refinements are still enforced
whenever a definition passes through `defineFlow`; the schema only catches unknown fields, wrong
types, and wrong enum values. The loader enforces them too, since it ends in `flowSchema`. See
[definitions-yaml.md](../../docs/definitions-yaml.md) for the full contract and its limits.

## Depends on

- `@naakwu/flowkit-core` — the definition model and `flowSchema`.
- `@naakwu/flowkit-temporal` — `publishDefinition` and `validateFlowkit`, used by the CLI.
