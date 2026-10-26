# @naakwu/flowkit-definitions

Authoring surface for Flowkit workflow definitions. The definition model itself lives in
`@naakwu/flowkit-core`; this package owns how a definition is written down and how it is checked
before it reaches a worker bundle.

## What ships

| Artifact | Purpose |
| --- | --- |
| `parseFlowYaml(source)` / `loadFlowFile(path)` | Load a YAML definition into a validated `FlowDefinition`. |
| `flowkit definitions validate <glob>` CLI | Validate definition files from the command line. |
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

`parseFlowYaml` is a pure function of its input — it never touches the filesystem. `loadFlowFile`
reads a file and parses it; I/O failures throw `FlowDefinitionFileError` while parse/validation
failures throw `FlowDefinitionYamlError` (whose `issues` carry `{ path, line, column, message }`).

The loader is a **transport, not a second authority**: it accepts exactly what `defineFlow` accepts,
rejecting multi-document streams, merge keys (`<<`), word-boolean scalars such as `yes`/`on` where a
string is required, and any field `flowSchema` rejects. Anchors and aliases are expanded before the
result is returned, so a YAML-authored definition and its TypeScript twin produce the same
`publishDefinition` `definitionHash`.

## Validating from the CLI

```sh
flowkit definitions validate "definitions/*.yaml" --registries definitions/registries.yaml
```

Prints `path:line:col code message` per issue and exits non-zero when any definition has errors.
Without `--registries`, the CLI runs the registry-independent checks (schema, lint, SLA/final-stage
scheduling) and states on stdout which checks were skipped. Add `--json` for machine output.

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
`gate: human` and that no other step kind may declare a gate. Those refinements are still enforced
whenever a definition passes through `defineFlow`; the schema only catches unknown fields, wrong
types, and wrong enum values. See [definitions-yaml.md](../../docs/definitions-yaml.md) for the full
contract and its limits.

## Depends on

- `@naakwu/flowkit-core` — the definition model and `flowSchema`.
- `@naakwu/flowkit-temporal` — `publishDefinition` and `validateFlowkit`, used by the CLI.
