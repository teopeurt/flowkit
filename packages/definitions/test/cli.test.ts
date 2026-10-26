import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

const packageRoot = resolve(import.meta.dir, '..');

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

const runCli = async (args: string[]): Promise<CliResult> => {
  const process = Bun.spawn(['bun', 'src/bin.ts', ...args], {
    cwd: packageRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const [stdout, stderr] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  const code = await process.exited;

  return { code, stdout, stderr };
};

describe('flowkit definitions validate', () => {
  test('reports four distinct issues with path:line:col for the four-issue fixture', async () => {
    const { code, stdout } = await runCli([
      'definitions',
      'validate',
      'test/fixtures/cli-four-issues.yaml',
      '--registries',
      'test/fixtures/cli-four-issues.registries.yaml',
    ]);

    expect(code).toBe(1);

    const issueLines = stdout.split('\n').filter((line) => /\S+:\d+:\d+ \S+ /.test(line));
    expect(issueLines).toHaveLength(4);

    expect(stdout).toMatch(
      /stages\.pending\.actions\.approve\.policy:\d+:\d+ missing-action-policy/,
    );
    expect(stdout).toMatch(/stages\.pending\.entry\.0\.ref:\d+:\d+ missing-system-step-ref/);
    expect(stdout).toMatch(/stages\.orphaned:\d+:\d+ unreachable-stage/);
    expect(stdout).toMatch(/stages\.approved:\d+:\d+ final-stage-schedules-work/);
  });

  test('exits 0 with a one-line summary for a clean fixture and complete manifest', async () => {
    const { code, stdout } = await runCli([
      'definitions',
      'validate',
      'test/fixtures/cli-clean.yaml',
      '--registries',
      'test/fixtures/cli-clean.registries.yaml',
    ]);

    expect(code).toBe(0);
    expect(stdout).toContain('1 definition file(s) valid.');
    expect(stdout).not.toContain('Skipped:');
  });

  test('states which checks were skipped when no manifest is supplied', async () => {
    const { code, stdout } = await runCli([
      'definitions',
      'validate',
      'test/fixtures/cli-clean.yaml',
    ]);

    expect(code).toBe(0);
    expect(stdout).toContain('Skipped:');
    expect(stdout).toContain('declared-ref validation');
  });

  test('exits 3 naming the path for a missing manifest', async () => {
    const { code, stderr } = await runCli([
      'definitions',
      'validate',
      'test/fixtures/cli-clean.yaml',
      '--registries',
      'test/fixtures/does-not-exist.yaml',
    ]);

    expect(code).toBe(3);
    expect(stderr).toContain('Missing registries manifest');
    expect(stderr).toContain('does-not-exist.yaml');
  });

  test('exits 4 naming the path for a malformed manifest', async () => {
    const { code, stderr } = await runCli([
      'definitions',
      'validate',
      'test/fixtures/cli-clean.yaml',
      '--registries',
      'test/fixtures/cli-malformed-manifest.yaml',
    ]);

    expect(code).toBe(4);
    expect(stderr).toContain('Malformed registries manifest');
    expect(stderr).toContain('cli-malformed-manifest.yaml');
  });

  test('exits 5 naming the path for an unreadable definition file', async () => {
    const { code, stderr } = await runCli([
      'definitions',
      'validate',
      'test/fixtures/does-not-exist.yaml',
    ]);

    expect(code).toBe(5);
    expect(stderr).toContain('Cannot read definition file');
    expect(stderr).toContain('does-not-exist.yaml');
  });

  test('--json emits machine-readable output with the four issues', async () => {
    const { code, stdout } = await runCli([
      'definitions',
      'validate',
      'test/fixtures/cli-four-issues.yaml',
      '--registries',
      'test/fixtures/cli-four-issues.registries.yaml',
      '--json',
    ]);

    expect(code).toBe(1);

    const document = JSON.parse(stdout) as {
      valid: boolean;
      files: Array<{ path: string; issues: Array<{ code: string; line: number | null; column: number | null }> }>;
    };

    expect(document.valid).toBe(false);
    expect(document.files).toHaveLength(1);
    expect(document.files[0].issues).toHaveLength(4);

    const codes = document.files[0].issues.map((issue) => issue.code).sort();
    expect(codes).toEqual(
      ['final-stage-schedules-work', 'missing-action-policy', 'missing-system-step-ref', 'unreachable-stage'].sort(),
    );

    for (const issue of document.files[0].issues) {
      expect(typeof issue.line).toBe('number');
      expect(typeof issue.column).toBe('number');
    }
  });

  test('exits 2 with usage for an unknown subcommand', async () => {
    const { code, stderr } = await runCli(['definitions', 'unknown']);
    expect(code).toBe(2);
    expect(stderr).toContain('Usage:');
  });
});
