/**
 * Flow definition authoring format.
 *
 * This package owns the *authoring* surface of a Flowkit definition, separate from
 * `@teopeurt/flowkit-core`, which owns the definition model itself:
 *
 * - `schema/flowdefinition.schema.json` — a JSON Schema generated from core's `flowSchema`,
 *   shipped for editors and CI validators that do not run TypeScript.
 * - the YAML binding of the same document shape (see `docs/definitions-yaml.md`), with a
 *   loader (`parseFlowYaml` / `loadFlowFile`) and a validation CLI.
 *
 * The definition model is not duplicated here. Every field name, nesting level, and
 * constraint comes from `@teopeurt/flowkit-core`; this package only changes how a definition
 * is written down and how it is checked before it reaches a worker bundle.
 */

export const FLOWKIT_DEFINITIONS_VERSION = '1.1.0';

/**
 * Path of the shipped JSON Schema, relative to this package's root. Resolve it against the
 * installed package directory (for example
 * `node_modules/@teopeurt/flowkit-definitions/schema/flowdefinition.schema.json`).
 */
export const FLOW_DEFINITION_SCHEMA_PATH = 'schema/flowdefinition.schema.json' as const;

export {
  FlowDefinitionFileError,
  FlowDefinitionYamlError,
  loadFlowFile,
  MAX_DEFINITION_BYTES,
  parseFlowYaml,
} from './yaml';
export type {
  FlowDefinitionYamlIssue,
  FlowDefinitionYamlIssueLocation,
  ParseFlowYamlOptions,
} from './yaml';
