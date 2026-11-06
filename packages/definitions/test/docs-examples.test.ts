import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// The worked example in docs/definitions-deep-dive.md is checked in as real files. This test runs the
// real CLI on them so the documented definition and manifest cannot drift from the validator.
const repoRoot = resolve(import.meta.dir, '../../..');
const example = join(repoRoot, 'docs/examples/change-request');
const flow = join(example, 'change-request.flow.yaml');
const registries = join(example, 'registries.yaml');
const bin = resolve(import.meta.dir, '../src/bin.ts');

const cli = (...args: string[]) => {
  const result = spawnSync('bun', [bin, 'definitions', 'validate', ...args], { encoding: 'utf8', cwd: repoRoot });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
};

describe('docs/examples/change-request', () => {
  test('is valid against its registries manifest', () => {
    expect(cli(flow, '--registries', registries)).toEqual({ code: 0, out: '1 definition file(s) valid.\n' });
  });

  test('is valid without a manifest, but the ref checks are skipped (and said so)', () => {
    const { code, out } = cli(flow);
    expect(code).toBe(0);
    expect(out).toContain('Skipped: declared-ref validation');
  });

  test('a policy typo is caught only when the manifest is supplied', () => {
    const dir = mkdtempSync(join(tmpdir(), 'docs-example-'));
    const typo = join(dir, 'typo.yaml');
    writeFileSync(typo, readFileSync(flow, 'utf8').replace('policy: reviewerDecision, guards', 'policy: reviewerDecison, guards'));
    expect(cli(typo).code).toBe(0);
    const checked = cli(typo, '--registries', registries);
    expect(checked.code).toBe(1);
    expect(checked.out).toContain('missing-policy-ref');
    expect(checked.out).toContain('reviewerDecison');
  });

  test('the documented step kinds are all present', () => {
    const source = readFileSync(flow, 'utf8');
    for (const needle of ['kind: ai', 'gate: auto', 'decide: lowRiskAutoApprove', 'kind: orchestrate', 'gate: human', 'sla:']) {
      expect(source).toContain(needle);
    }
  });
});
