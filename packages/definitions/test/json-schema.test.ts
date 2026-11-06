import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import Ajv, { type ValidateFunction } from 'ajv';
import { defineFlow, FlowDefinitionError, flowSchema } from '@teopeurt/flowkit-core';

import { docReviewFlow } from '../../core/src/testing/doc-review.fixture';
import { serializeFlowDefinitionSchema } from '../scripts/build-schema';
import { FLOWKIT_DEFINITIONS_VERSION, FLOW_DEFINITION_SCHEMA_PATH } from '../src/index';

const packageRoot = resolve(import.meta.dir, '..');
const fixtureDirectory = resolve(import.meta.dir, 'fixtures');

const at = (value: unknown, ...keys: Array<string | number>): unknown =>
  keys.reduce<unknown>(
    (current, key) => (current as Record<string | number, unknown> | undefined | null)?.[key],
    value,
  );

const readFixture = async (name: string): Promise<unknown> =>
  JSON.parse(await readFile(resolve(fixtureDirectory, name), 'utf8'));

const readCommittedSchema = async (): Promise<string> =>
  readFile(resolve(packageRoot, FLOW_DEFINITION_SCHEMA_PATH), 'utf8');

const compileSchema = (): ValidateFunction =>
  new Ajv({ allErrors: true, strict: true }).compile(
    JSON.parse(serializeFlowDefinitionSchema()) as Record<string, unknown>,
  );

const legalFixtures = ['legal-minimal.json', 'legal-full.json', 'legal-rule-heavy.json'];
const illegalFixtures = ['illegal-unknown-stage-key.json', 'illegal-missing-to.json'];

describe('flow definition JSON Schema', () => {
  test('the committed artifact is exactly what the current core schema produces', async () => {
    expect(await readCommittedSchema()).toBe(serializeFlowDefinitionSchema());
  });

  test('schema generation is deterministic', () => {
    expect(serializeFlowDefinitionSchema()).toBe(serializeFlowDefinitionSchema());
  });

  test('the public version export matches the package manifest', async () => {
    const manifest = JSON.parse(
      await readFile(resolve(packageRoot, 'package.json'), 'utf8'),
    ) as { version: string };

    expect(FLOWKIT_DEFINITIONS_VERSION).toBe(manifest.version);
  });

  test('the schema is a self-contained, strict object schema', () => {
    const schema = JSON.parse(serializeFlowDefinitionSchema()) as Record<string, unknown>;

    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(schema.title).toBe('FlowDefinition');
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(
      expect.arrayContaining(['id', 'version', 'roles', 'initialStage', 'stages']),
    );

    const stage = at(schema, 'properties', 'stages', 'additionalProperties');
    expect(at(stage, 'type')).toBe('object');
    expect(at(stage, 'additionalProperties')).toBe(false);
    // No field inside a stage is mandatory: `flowSchema` requires only the top-level keys.
    expect(at(stage, 'required')).toBeUndefined();

    const step = at(stage, 'properties', 'entry', 'items');
    expect(at(step, 'properties', 'kind', 'enum')).toEqual(['system', 'ai', 'rule', 'orchestrate']);
    expect(at(step, 'properties', 'ref', 'type')).toBe('string');
    expect(at(step, 'properties', 'gate', 'enum')).toEqual(['human', 'auto']);
    expect(at(step, 'properties', 'decide', 'type')).toBe('string');
    expect(at(step, 'required')).toEqual(expect.arrayContaining(['kind', 'ref']));

    const action = at(stage, 'properties', 'actions', 'additionalProperties');
    expect(at(action, 'properties', 'to', 'type')).toBe('string');
    expect(at(action, 'properties', 'kind', 'enum')).toEqual(['human', 'system', 'signal']);
    expect(at(action, 'additionalProperties')).toBe(false);
  });

  test('every legal fixture is accepted by the emitted schema and by flowSchema', async () => {
    const validate = compileSchema();

    for (const name of legalFixtures) {
      const fixture = await readFixture(name);
      const valid = validate(fixture);

      expect({ name, errors: valid ? [] : validate.errors }).toEqual({ name, errors: [] });

      // Shape-validity is not enough: a fixture named "legal" must also satisfy the
      // refinements `defineFlow` enforces, or the corpus drifts away from real definitions.
      const parsed = flowSchema.safeParse(fixture);
      expect({
        name,
        refinementIssues: parsed.success
          ? []
          : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      }).toEqual({ name, refinementIssues: [] });
    }
  });

  test('illegal fixtures are rejected at the offending path', async () => {
    const validate = compileSchema();

    const unknownKey = await readFixture('illegal-unknown-stage-key.json');
    expect(validate(unknownKey)).toBe(false);
    expect(validate.errors?.map((error) => `${error.instancePath} ${error.keyword}`)).toContain(
      '/stages/draft additionalProperties',
    );

    const missingDestination = await readFixture('illegal-missing-to.json');
    expect(validate(missingDestination)).toBe(false);
    expect(validate.errors?.map((error) => `${error.instancePath} ${error.keyword}`)).toContain(
      '/stages/draft/actions/submit required',
    );
  });

  test('core refinements are Zod-only and remain enforced by defineFlow', async () => {
    const validate = compileSchema();

    for (const name of ['refinement-ai-without-gate.json', 'refinement-sla-disabled-action.json']) {
      const fixture = await readFixture(name);

      // Shape-valid: a JSON Schema cannot express cross-field `superRefine` rules such as
      // "an AI step must gate on a human" or "an SLA may not fire an action the stage disables".
      expect({ name, schemaValid: validate(fixture) }).toEqual({ name, schemaValid: true });

      // Still enforced by the definition validator itself.
      expect({ name, flowSchemaAccepts: flowSchema.safeParse(fixture).success }).toEqual({
        name,
        flowSchemaAccepts: false,
      });
      expect(() => defineFlow(fixture as never)).toThrow(FlowDefinitionError);
    }
  });

  test('a definition authored with defineFlow validates against the emitted schema', () => {
    const validate = compileSchema();

    expect({ errors: validate(docReviewFlow) ? [] : validate.errors }).toEqual({ errors: [] });
  });
});
