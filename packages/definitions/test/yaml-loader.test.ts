import { describe, expect, test } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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

/* -------------------------------------------------------------------------- */
/* Review lane A: structural rejections (F-01 F-02 F-03 F-04 F-09 F-10 F-11     */
/* F-12 F-18 F-22). Every rejection names the author's line and column.         */
/* -------------------------------------------------------------------------- */

const TWO_MIB = 2 * 1024 * 1024;

const captureYamlError = (source: string, sourceName?: string): FlowDefinitionYamlError => {
  try {
    parseFlowYaml(source, { sourceName });
  } catch (error) {
    if (error instanceof FlowDefinitionYamlError) {
      return error;
    }
    throw error;
  }
  throw new Error('Expected a FlowDefinitionYamlError, but the document parsed.');
};

/** 1-indexed line of the first line matching `pattern`. */
const lineOf = (source: string, pattern: RegExp, nth = 1): number => {
  let seen = 0;
  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (pattern.test(lines[index])) {
      seen += 1;
      if (seen === nth) {
        return index + 1;
      }
    }
  }
  throw new Error(`No line matching ${pattern} (occurrence ${nth}).`);
};

const issuesAt = (error: FlowDefinitionYamlError, line: number) =>
  error.issues.filter((issue) => issue.line === line);

const manyStagesSource = (count: number): string => {
  const lines = [
    'id: big-flow',
    'version: 1',
    'roles: [requester]',
    'initialStage: draft',
    'stages:',
    '  draft:',
    '    pendingRole: requester',
    '    actions:',
    '      submit:',
    '        to: s0',
    '        kind: human',
    '        policy: requester_can_submit',
  ];
  for (let index = 0; index < count; index += 1) {
    lines.push(`  s${index}:`, '    final: true');
  }
  return `${lines.join('\n')}\n`;
};

const unknownKeysSource = (count: number): string => {
  const lines = [
    'id: unknown-flow',
    'version: 1',
    'roles: [requester]',
    'initialStage: draft',
    'stages:',
    '  draft:',
    '    pendingRole: requester',
    '    actions:',
    '      submit:',
    '        to: submitted',
    '        kind: human',
    '        policy: requester_can_submit',
  ];
  for (let index = 0; index < count; index += 1) {
    lines.push(`    unknownOption${index}: true`);
  }
  lines.push('  submitted:', '    final: true');
  return `${lines.join('\n')}\n`;
};

describe('F-01 __proto__ keys', () => {
  test('rejects a stage-level __proto__ key at the key position', async () => {
    const source = await readFixture('lane-a-F01-proto-stage.yaml');
    const error = captureYamlError(source, 'lane-a-F01-proto-stage.yaml');
    const line = lineOf(source, /^  __proto__:/);
    const hits = issuesAt(error, line);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].column).toBe(3);
    expect(hits[0].message).toContain('__proto__');
  });

  test('rejects an action-level __proto__ key at the key position', async () => {
    const source = await readFixture('lane-a-F01-proto-action.yaml');
    const error = captureYamlError(source, 'lane-a-F01-proto-action.yaml');
    const line = lineOf(source, /^      __proto__:/);
    const hits = issuesAt(error, line);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].column).toBe(7);
    expect(hits[0].message).toContain('__proto__');
  });

  test('rejects a root-level __proto__ key at the key position', async () => {
    const source = await readFixture('lane-a-F01-proto-root.yaml');
    const error = captureYamlError(source, 'lane-a-F01-proto-root.yaml');
    const line = lineOf(source, /^__proto__:/);
    const hits = issuesAt(error, line);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].column).toBe(1);
    expect(hits[0].message).toContain('__proto__');
  });

  test('rejects a quoted "__proto__" key as well', () => {
    const source = [
      'id: minimal-flow',
      'version: 1',
      'roles: [requester]',
      'initialStage: draft',
      'stages:',
      '  draft:',
      '    pendingRole: requester',
      '  "__proto__":',
      '    final: true',
      '',
    ].join('\n');
    const error = captureYamlError(source);
    const hits = issuesAt(error, 8);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].message).toContain('__proto__');
  });
});

describe('F-02 keys that collide after stringification', () => {
  const cases: Array<[string, string, RegExp]> = [
    ['lane-a-F02-collide-int.yaml', '  1:', /^  1:$/],
    ['lane-a-F02-collide-bool.yaml', '  "true":', /^  "true":$/],
    ['lane-a-F02-collide-null.yaml', '  "null":', /^  "null":$/],
  ];

  for (const [fixture, , pattern] of cases) {
    test(`rejects ${fixture} at the second key with "Map keys must be unique"`, async () => {
      const source = await readFixture(fixture);
      const error = captureYamlError(source, fixture);
      // The first key is the one the author wrote first; the second is the duplicate.
      const secondLine = lineOf(source, pattern);
      const hits = issuesAt(error, secondLine);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.some((issue) => issue.message.includes('Map keys must be unique'))).toBe(true);
    });
  }
});

describe('F-03 non-string mapping keys', () => {
  const cases: Array<[string, RegExp]> = [
    ['lane-a-F03-null-key.yaml', /^  null:$/],
    ['lane-a-F03-tilde-key.yaml', /^  ~:$/],
    ['lane-a-F03-off-key.yaml', /^  off:$/],
    ['lane-a-F03-int-key.yaml', /^  1:$/],
  ];

  for (const [fixture, pattern] of cases) {
    test(`rejects ${fixture} at the key, asking the author to quote it`, async () => {
      const source = await readFixture(fixture);
      const error = captureYamlError(source, fixture);
      const line = lineOf(source, pattern);
      const hits = issuesAt(error, line);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].column).toBe(3);
      expect(hits[0].message).toContain('quote');
    });
  }

  test('a quoted "1" key is still a legal string key and names the stage "1"', async () => {
    const source = await readFixture('lane-a-F03-quoted-numeric-key.yaml');
    const definition = parseFlowYaml(source, { sourceName: 'lane-a-F03-quoted-numeric-key.yaml' });
    expect(Object.keys(definition.stages)).toContain('1');
  });
});

describe('F-04 numeric version forms', () => {
  const rejected: Array<[string, string]> = [
    ['lane-a-F04-version-octal.yaml', '010'],
    ['lane-a-F04-version-hex.yaml', '0x0A'],
    ['lane-a-F04-version-sexagesimal.yaml', '1:00'],
    ['lane-a-F04-version-underscore.yaml', '1_0'],
    ['lane-a-F04-version-exponent.yaml', '1e1'],
    ['lane-a-F04-version-leading-zero.yaml', '09'],
    ['lane-a-F04-version-float.yaml', '2.0'],
    ['lane-a-F04-version-bigint.yaml', '9007199254740993'],
    ['lane-a-F04-version-inf.yaml', '.inf'],
  ];

  for (const [fixture, raw] of rejected) {
    test(`rejects version: ${raw} at the version scalar`, async () => {
      const source = await readFixture(fixture);
      const error = captureYamlError(source, fixture);
      const versionLine = lineOf(source, /^version:/);
      const hits = issuesAt(error, versionLine).filter((issue) => issue.path === 'version');
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].column).toBe(10);
      expect(hits[0].message).toContain('version must be a plain decimal integer');
    });
  }

  test('plain decimal versions 1, 3, 7 and a comment after 1 are accepted', async () => {
    const base = await readFixture('legal-minimal.yaml');
    for (const version of ['1', '3', '7']) {
      const definition = parseFlowYaml(base.replace(/^version: 1$/m, `version: ${version}`));
      expect(definition.version).toBe(Number(version));
    }
    const commented = parseFlowYaml(await readFixture('lane-a-F04-version-plain-comment-ok.yaml'));
    expect(commented.version).toBe(1);
  });
});

describe('F-18 explicit YAML tags', () => {
  test('rejects an unknown local tag on a value, naming the tag and line', async () => {
    const source = await readFixture('lane-a-F18-local-tag.yaml');
    const error = captureYamlError(source, 'lane-a-F18-local-tag.yaml');
    const hits = issuesAt(error, 1);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((issue) => issue.message.includes('!foo'))).toBe(true);
  });

  test('rejects !!js/function on a value instead of changing it to text', async () => {
    const source = await readFixture('lane-a-F18-js-function-tag.yaml');
    const error = captureYamlError(source, 'lane-a-F18-js-function-tag.yaml');
    const hits = issuesAt(error, 1);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((issue) => issue.message.includes('js/function'))).toBe(true);
  });

  test('rejects !!timestamp on version (outside the core tag allowlist)', async () => {
    const source = await readFixture('lane-a-F18-timestamp-tag.yaml');
    const error = captureYamlError(source, 'lane-a-F18-timestamp-tag.yaml');
    expect(issuesAt(error, lineOf(source, /^version:/)).length).toBeGreaterThan(0);
  });

  test('an allowlisted !!str tag keeps the same hash as the untagged document', async () => {
    const base = await readFixture('legal-minimal.yaml');
    const tagged = base.replace(/^id: minimal-flow$/m, 'id: !!str minimal-flow');
    expect(hashOf(parseFlowYaml(tagged))).toBe(hashOf(parseFlowYaml(base)));
  });
});

describe('F-22 quoted "<<" key', () => {
  test('a quoted "<<" key is not reported as a merge key', async () => {
    const source = await readFixture('lane-a-F22-quoted-merge-key.yaml');
    let message = '';
    try {
      parseFlowYaml(source, { sourceName: 'lane-a-F22-quoted-merge-key.yaml' });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain('Merge keys');
  });
});

describe('F-09 input size cap and linear parsing', () => {
  test('MAX_DEFINITION_BYTES is 2 MiB', async () => {
    const mod = await import('../src/yaml');
    expect(mod.MAX_DEFINITION_BYTES).toBe(TWO_MIB);
  });

  test('a source larger than 2 MiB is rejected at line 1 column 1 before parsing', () => {
    const source = `# ${'x'.repeat(TWO_MIB)}\n`;
    const error = captureYamlError(source, 'huge.yaml');
    expect(error.issues).toHaveLength(1);
    expect(error.issues[0].path).toBe('<document>');
    expect(error.issues[0].line).toBe(1);
    expect(error.issues[0].column).toBe(1);
    expect(error.issues[0].message).toContain('limited to 2 MiB');
  });

  test('a multi-byte source over 2 MiB in bytes is rejected even if shorter in characters', () => {
    // 'é' is two bytes in UTF-8; this string is ~1.1 M characters but over 2 MiB of bytes.
    const source = `# ${'é'.repeat(Math.floor(TWO_MIB / 2) + 16)}\n`;
    const error = captureYamlError(source);
    expect(error.issues[0].message).toContain('limited to 2 MiB');
  });

  test('a source of exactly 2 MiB is not rejected by the size cap', () => {
    const prefix = '# ';
    const source = `${prefix}${'x'.repeat(TWO_MIB - prefix.length - 1)}\n`;
    expect(new TextEncoder().encode(source).byteLength).toBe(TWO_MIB);
    const error = captureYamlError(source);
    expect(error.issues[0].message).not.toContain('limited to 2 MiB');
  });

  test('a valid 16,000-stage file parses in under 1.5 s', () => {
    const source = manyStagesSource(16_000);
    const started = performance.now();
    const definition = parseFlowYaml(source);
    const elapsed = performance.now() - started;
    expect(Object.keys(definition.stages)).toHaveLength(16_001);
    console.log(`TIMING 16000-stage valid file: ${elapsed.toFixed(0)} ms`);
    expect(elapsed).toBeLessThan(1500);
  });
});

describe('F-10 unknown-key attribution', () => {
  test('20,000 unknown keys in one stage: one issue per key, under 1.5 s', () => {
    const source = unknownKeysSource(20_000);
    const started = performance.now();
    const error = captureYamlError(source);
    const elapsed = performance.now() - started;
    const unknown = error.issues.filter((issue) => issue.message.startsWith('Unrecognized key'));
    expect(unknown).toHaveLength(20_000);
    expect(unknown.every((issue) => typeof issue.line === 'number')).toBe(true);
    console.log(`TIMING 20000-unknown-keys file: ${elapsed.toFixed(0)} ms`);
    expect(elapsed).toBeLessThan(1500);
  });
});

describe('F-11 alias expansion', () => {
  test('a legitimate document with 119 aliases of one anchor is accepted', async () => {
    const source = await readFixture('lane-a-F11-legit-120-aliases.yaml');
    const definition = parseFlowYaml(source, { sourceName: 'lane-a-F11-legit-120-aliases.yaml' });
    expect(Object.keys(definition.stages).length).toBeGreaterThan(100);
  });

  test('the nine-level alias bomb is rejected quickly with a typed error naming a line', async () => {
    const source = await readFixture('lane-a-F11-alias-bomb-9x9.yaml');
    const started = performance.now();
    const error = captureYamlError(source, 'lane-a-F11-alias-bomb-9x9.yaml');
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(1000);
    expect(error.issues.some((issue) => typeof issue.line === 'number')).toBe(true);
    expect(error.issues.some((issue) => /alias/i.test(issue.message))).toBe(true);
    // The alias that breaks the limit is attributed to the line that holds it (x4).
    const x4Line = lineOf(source, /^x4:/);
    expect(error.issues.some((issue) => issue.line === x4Line)).toBe(true);
  });

  test('a version given by an alias is judged by the anchored source text', async () => {
    const base = await readFixture('legal-minimal.yaml');
    const source = base
      .replace(/^version: 1$/m, 'version: *v')
      .replace(/^id: minimal-flow$/m, 'meta: &v 010\nid: minimal-flow');
    const error = captureYamlError(source, 'alias-version.yaml');
    const versionLine = lineOf(source, /^version: \*v$/);
    const hits = issuesAt(error, versionLine).filter((issue) => issue.path === 'version');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].message).toContain('version must be a plain decimal integer');
  });

  test('an alias used as a key resolves to its text, so it collides with the key it repeats', async () => {
    const base = await readFixture('legal-minimal.yaml');
    const source = base
      .replace(/^  submitted:$/m, '  &k submitted:')
      .concat('  *k :\n    final: true\n');
    const error = captureYamlError(source, 'alias-key.yaml');
    const aliasLine = lineOf(source, /^  \*k :$/);
    const hits = issuesAt(error, aliasLine);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((issue) => issue.message.includes('Map keys must be unique'))).toBe(true);
  });
});

describe('F-12 special files (loader half)', () => {
  test('loadFlowFile rejects a FIFO as not a regular file, within milliseconds', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lane-a-fifo-'));
    const fifo = join(directory, 'pipe.yaml');
    try {
      execFileSync('mkfifo', [fifo]);
      const outcome = await Promise.race([
        loadFlowFile(fifo).then(
          () => ({ kind: 'resolved' as const }),
          (error: unknown) => ({ kind: 'rejected' as const, error }),
        ),
        new Promise<{ kind: 'hung' }>((resolveTimer) =>
          setTimeout(() => resolveTimer({ kind: 'hung' }), 3000),
        ),
      ]);
      if (outcome.kind === 'hung') {
        // Unblock the pending open() so the process can exit, then fail.
        spawnSync('sh', ['-c', 'printf "" > "$0"', fifo], { timeout: 2000 });
        throw new Error('loadFlowFile hung on a FIFO');
      }
      expect(outcome.kind).toBe('rejected');
      if (outcome.kind === 'rejected') {
        expect(outcome.error).toBeInstanceOf(FlowDefinitionFileError);
        expect((outcome.error as Error).message).toContain('not a regular file');
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('loadFlowFile rejects a directory as not a regular file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lane-a-dir-'));
    try {
      const error = await loadFlowFile(directory).then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(FlowDefinitionFileError);
      expect((error as Error).message).toContain('not a regular file');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('F-09 oversized file on disk', () => {
  test('loadFlowFile rejects a file over 2 MiB with a YAML error before reading it all', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lane-a-big-'));
    const path = join(directory, 'big.yaml');
    try {
      await Bun.write(path, `# ${'x'.repeat(TWO_MIB)}\n`);
      const error = await loadFlowFile(path).then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(FlowDefinitionYamlError);
      expect((error as FlowDefinitionYamlError).issues[0].message).toContain('limited to 2 MiB');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('F-13 parser stack exhaustion', () => {
  // The `yaml` parser recurses between blockMap and step, so a flood of
  // misindented lines exhausts the call stack before it can report a positioned
  // syntax error. A RangeError must never escape parseFlowYaml.
  const floodSource = (): string => {
    const lines = [
      'id: t',
      'version: 1',
      'roles: [a]',
      'initialStage: draft',
      'stages:',
      '  draft:',
      '    pendingRole: a',
    ];
    for (let index = 0; index < 20000; index += 1) {
      lines.push(`      bad${String(index)}: v`);
    }
    lines.push('  submitted: { final: true }', '');
    return lines.join('\n');
  };

  test('a 20,000-line misindented flood becomes a typed whole-document YAML error', () => {
    try {
      parseFlowYaml(floodSource(), { sourceName: 'flood' });
      throw new Error('Expected the flood source to be rejected, but it parsed.');
    } catch (error) {
      expect(error).toBeInstanceOf(FlowDefinitionYamlError);
      const yamlError = error as FlowDefinitionYamlError;
      expect(yamlError.issues).toHaveLength(1);
      expect(yamlError.issues[0]?.path).toBe('<document>');
      expect(yamlError.issues[0]?.line).toBe(1);
      expect(yamlError.issues[0]?.column).toBe(1);
      expect(yamlError.issues[0]?.message).toContain('too deeply or badly malformed to parse');
      expect(yamlError.issues[0]?.message).toContain('fix the first syntax errors');
    }
  });
});
