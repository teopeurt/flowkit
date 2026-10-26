import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { defineFlow } from '@naakwu/flowkit-core';
import type { FlowDefinition } from '@naakwu/flowkit-core';
import { publishDefinition } from '@naakwu/flowkit-temporal';

import {
  FlowDefinitionFileError,
  FlowDefinitionYamlError,
  loadFlowFile,
  parseFlowYaml,
} from '../src/index';

const fixtureDirectory = resolve(import.meta.dir, 'fixtures');

const readFixture = (name: string): Promise<string> =>
  readFile(resolve(fixtureDirectory, name), 'utf8');

const expectYamlError = async (
  fixture: string,
  matcher: (issues: Array<{ path: string; message: string; line?: number }>) => void,
): Promise<void> => {
  const source = await readFixture(fixture);
  try {
    parseFlowYaml(source, { sourceName: fixture });
    throw new Error(`Expected ${fixture} to be rejected, but it parsed.`);
  } catch (error) {
    expect(error).toBeInstanceOf(FlowDefinitionYamlError);
    const yamlError = error as FlowDefinitionYamlError;
    matcher(yamlError.issues);
  }
};

const hashOf = (definition: FlowDefinition): string =>
  publishDefinition({ definition }).definitionHash;

// Independent TypeScript twin of hash-parity.yaml. Key order and stage
// declaration order differ from the YAML; array order (roles, entry steps,
// notify channels/to) is semantic and therefore preserved.
const approvalNotify = { template: 'approved_notice', channels: ['inbox'], to: ['author'] };
const hashParityTsTwin: FlowDefinition = {
  stages: {
    draft: {
      actions: {
        submit: { to: 'review', kind: 'human', policy: 'author_can_submit', notify: approvalNotify },
      },
      pendingRole: 'author',
    },
    review: {
      entry: [
        { kind: 'rule', ref: 'resolveRoute' },
        { kind: 'ai', ref: 'summarize', gate: 'human' },
      ],
      actions: {
        approve: { to: 'published', kind: 'human', policy: 'reviewer_can_decide', notify: approvalNotify },
        reject: { to: 'draft', kind: 'human', policy: 'reviewer_can_decide', notify: approvalNotify },
      },
      pendingRole: 'reviewer',
    },
    published: { final: true },
  },
  initialStage: 'draft',
  id: 'hash-parity-flow',
  version: 1,
  roles: ['reviewer', 'author'],
};

describe('parseFlowYaml', () => {
  test('accepts every legal fixture', async () => {
    for (const name of ['legal-minimal.yaml', 'legal-full.yaml', 'legal-rule-heavy.yaml']) {
      const definition = parseFlowYaml(await readFixture(name), { sourceName: name });
      expect(() => defineFlow(definition)).not.toThrow();
    }
  });

  test('rejects a refinement-only document exactly as defineFlow rejects its JSON twin', async () => {
    // refinement-sla-disabled-action validates against the emitted JSON Schema but fails
    // `flowSchema`: the stage disables the action its SLA escalation fires, and the
    // escalation names an undeclared notify role. The loader is a transport, so it must
    // fail identically — and name the lines.
    await expectYamlError('refinement-sla-disabled-action.yaml', (issues) => {
      expect(issues.map((issue) => issue.path).sort()).toEqual([
        'stages.intake.sla.escalate.action',
        'stages.intake.sla.escalate.notify',
      ]);
      for (const issue of issues) {
        expect(typeof issue.line).toBe('number');
      }
    });
  });

  test('rejects a word boolean where a string is required, naming the line', async () => {
    await expectYamlError('hazard-word-boolean.yaml', (issues) => {
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].path).toBe('stages.draft.actions.submit.to');
      expect(issues[0].message).toContain('Expected string, received boolean');
      expect(typeof issues[0].line).toBe('number');
    });
  });

  test('rejects a quoted version, naming the line', async () => {
    await expectYamlError('hazard-quoted-version.yaml', (issues) => {
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].path).toBe('version');
      expect(issues[0].message).toContain('Expected number, received string');
      expect(typeof issues[0].line).toBe('number');
    });
  });

  test('rejects a merge key with a line-bearing message', async () => {
    await expectYamlError('hazard-merge-key.yaml', (issues) => {
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('Merge keys');
      expect(typeof issues[0].line).toBe('number');
    });
  });

  test('rejects a multi-document stream with a line-bearing message', async () => {
    await expectYamlError('hazard-multi-document.yaml', (issues) => {
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].message).toContain('Multiple YAML documents');
      expect(typeof issues[0].line).toBe('number');
    });
  });

  test('rejects an unknown key, attributing it to its own line', async () => {
    await expectYamlError('hazard-unknown-key.yaml', (issues) => {
      expect(issues.length).toBeGreaterThan(0);
      const issue = issues.find((candidate) => candidate.path.includes('unsupportedStageOption'));
      expect(issue).toBeDefined();
      expect(issue?.message).toContain('Unrecognized key "unsupportedStageOption"');
      expect(typeof issue?.line).toBe('number');
    });
  });
});

describe('hash parity', () => {
  test('anchors/aliases, key order, and stage order do not change the hash', async () => {
    const aliased = parseFlowYaml(await readFixture('hash-parity.yaml'));
    const reordered = parseFlowYaml(await readFixture('hash-parity-reordered.yaml'));

    expect(hashOf(aliased)).toBe(hashOf(hashParityTsTwin));
    expect(hashOf(reordered)).toBe(hashOf(hashParityTsTwin));
    expect(hashOf(aliased)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test('the YAML form of a JSON fixture hashes identically to the JSON form', async () => {
    for (const base of ['legal-minimal', 'legal-rule-heavy']) {
      const yaml = parseFlowYaml(await readFixture(`${base}.yaml`));
      const json = JSON.parse(await readFixture(`${base}.json`)) as FlowDefinition;

      expect(hashOf(yaml)).toBe(hashOf(json));
    }
  });
});

describe('parseFlowYaml determinism', () => {
  test('identical input yields a deep-equal, freshly allocated result', async () => {
    const source = await readFixture('legal-rule-heavy.yaml');

    const first = parseFlowYaml(source);
    const second = parseFlowYaml(source);

    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second.stages).not.toBe(first.stages);
  });

  test('is a pure function of its input and never reads the filesystem', async () => {
    const source = await readFixture('legal-minimal.yaml');

    // sourceName points at a file that does not exist: parsing must not care,
    // because the function only sees the string.
    const definition = parseFlowYaml(source, { sourceName: '/nonexistent/no-such-file.yaml' });
    expect(definition.id).toBe('minimal-flow');
  });
});

describe('loadFlowFile', () => {
  test('reads and parses a definition file', async () => {
    const definition = await loadFlowFile(resolve(fixtureDirectory, 'legal-minimal.yaml'));
    expect(definition.id).toBe('minimal-flow');
  });

  test('distinguishes an unreadable file from a malformed one', async () => {
    await expect(loadFlowFile(resolve(fixtureDirectory, 'does-not-exist.yaml'))).rejects.toBeInstanceOf(
      FlowDefinitionFileError,
    );

    await expect(loadFlowFile(resolve(fixtureDirectory, 'hazard-multi-document.yaml'))).rejects.toBeInstanceOf(
      FlowDefinitionYamlError,
    );
  });
});
