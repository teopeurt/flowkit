import { flowSchema } from '@naakwu/flowkit-core';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Building the JSON Schema is separated from writing it to disk so tests can assert the
 * committed artifact is exactly what the current `flowSchema` produces (no silent drift).
 */

export const FLOW_DEFINITION_SCHEMA_DRAFT = 'http://json-schema.org/draft-07/schema#' as const;

export const FLOW_DEFINITION_SCHEMA_RELATIVE_PATH = 'schema/flowdefinition.schema.json' as const;

/**
 * Deterministic: identical `flowSchema` input always serialises to identical bytes.
 *
 * `$refStrategy: 'none'` inlines every sub-schema so the document is self-contained for
 * editors that do not resolve `definitions`.
 *
 * Note what a JSON Schema cannot express: `flowSchema`'s refinements (for example "an AI step
 * must declare `gate: human`, and no other step kind may declare a gate") are Zod-only rules.
 * The emitted document therefore rejects unknown fields and wrong types, while refinement
 * violations are still caught by `defineFlow`. This limitation is documented in
 * `docs/definitions-yaml.md` rather than papered over.
 */
export function buildFlowDefinitionSchema(): Record<string, unknown> {
  const generated = zodToJsonSchema(flowSchema, {
    target: 'jsonSchema7',
    $refStrategy: 'none',
  }) as Record<string, unknown>;

  if ('$ref' in generated || 'definitions' in generated || '$defs' in generated) {
    throw new Error(
      'Emitted FlowDefinition schema is not self-contained; expected every sub-schema to be inlined.',
    );
  }

  const { $schema: _discarded, ...body } = generated;

  return {
    $schema: FLOW_DEFINITION_SCHEMA_DRAFT,
    title: 'FlowDefinition',
    description:
      'A Flowkit workflow definition as authored in YAML or JSON. Generated from @naakwu/flowkit-core flowSchema; do not edit by hand.',
    ...body,
  };
}

/** The canonical on-disk form: two-space indentation with a trailing newline. */
export function serializeFlowDefinitionSchema(): string {
  return `${JSON.stringify(buildFlowDefinitionSchema(), null, 2)}\n`;
}
