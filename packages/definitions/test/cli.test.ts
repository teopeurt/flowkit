import { afterAll, describe, expect, test } from 'bun:test';
import { chmod, copyFile, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runDefinitionsValidate } from '../src/cli';
import type { ValidateDeps } from '../src/cli';

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

/* -------------------------------------------------------------------------- */
/* Review lane B: F-05, F-06, F-07, F-08, F-12/F-29, F-13, F-14, F-15,        */
/* F-16, F-25, F-26. Symlinks and FIFOs are created in per-test temp dirs.    */
/* -------------------------------------------------------------------------- */

const fixture = (name: string): string => `test/fixtures/${name}`;

const tempDirs: string[] = [];
const makeTempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'flowkit-lane-b-'));
  tempDirs.push(dir);
  return dir;
};

afterAll(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

// Same as runCli, but under coreutils `timeout` so a hang fails fast (exit 124)
// instead of stalling the suite.
const runCliGuarded = async (args: string[], seconds = 5): Promise<CliResult> => {
  const process = Bun.spawn(['timeout', String(seconds), 'bun', 'src/bin.ts', ...args], {
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

// In-process run with captured output and an injectable dependency seam.
const runInProcess = async (
  argv: string[],
  deps: Partial<ValidateDeps> = {},
): Promise<CliResult> => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runDefinitionsValidate(argv, packageRoot, {
    ...deps,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  });
  return { code, stdout: out.join(''), stderr: err.join('') };
};

const makeFifo = async (path: string): Promise<void> => {
  const process = Bun.spawn(['mkfifo', path]);
  expect(await process.exited).toBe(0);
};

describe('F-07: every positional glob or path is validated', () => {
  test('a second invalid file makes the run exit 1', async () => {
    const { code, stdout } = await runCli([
      'definitions',
      'validate',
      fixture('lane-b-f07-valid.yaml'),
      fixture('lane-b-f07-invalid.yaml'),
    ]);

    expect(code).toBe(1);
    expect(stdout).toContain('bogusKey');
  });

  test('a second argument that cannot be read exits 5 and is named', async () => {
    const dir = await makeTempDir();
    await symlink('/nonexistent/lane-b-target.yaml', join(dir, 'dangling.yaml'));

    const { code, stderr } = await runCli([
      'definitions',
      'validate',
      fixture('lane-b-f07-valid.yaml'),
      join(dir, 'dangling.yaml'),
    ]);

    expect(code).toBe(5);
    expect(stderr).toContain('dangling.yaml');
  });

  test('zero positional arguments is a usage error (exit 2)', async () => {
    const { code, stderr } = await runCli(['definitions', 'validate']);
    expect(code).toBe(2);
    expect(stderr).toContain('Usage:');
  });

  test('the same file given twice is validated once', async () => {
    const { code, stdout } = await runCli([
      'definitions',
      'validate',
      fixture('lane-b-f07-invalid.yaml'),
      fixture('lane-b-f07-invalid.yaml'),
    ]);

    expect(code).toBe(1);
    expect(stdout).toContain('1 issue(s) across 1 file(s).');
  });
});

describe('F-08: symlinked definitions are followed or reported, never skipped', () => {
  test('a symlinked invalid definition matched by a glob is validated (exit 1)', async () => {
    const dir = await makeTempDir();
    await symlink(resolve(packageRoot, fixture('lane-b-f08-invalid.yaml')), join(dir, 'link.yaml'));

    const { code, stdout } = await runCli(['definitions', 'validate', join(dir, '*.yaml')]);

    expect(code).toBe(1);
    expect(stdout).toContain('bogusKey');
  });

  test('a dangling symlink matched by a glob is an unreadable entry (exit 5), not no-match', async () => {
    const dir = await makeTempDir();
    await symlink('/nonexistent/lane-b-target.yaml', join(dir, 'dangling.yaml'));

    const { code, stderr } = await runCli(['definitions', 'validate', join(dir, '*.yaml')]);

    expect(code).toBe(5);
    expect(stderr).toContain('Cannot read definition file');
    expect(stderr).toContain('dangling.yaml');
  });

  test('a symlinked directory is followed by a ** glob', async () => {
    const root = await makeTempDir();
    const targets = await makeTempDir();
    await copyFile(resolve(packageRoot, fixture('lane-b-f08-invalid.yaml')), join(targets, 'bad.yaml'));
    await symlink(targets, join(root, 'linked'));

    const { code, stdout } = await runCli(['definitions', 'validate', join(root, '**', '*.yaml')]);

    expect(code).toBe(1);
    expect(stdout).toContain('bogusKey');
  });

  test('a symlink cycle terminates and the real file is validated', async () => {
    const root = await makeTempDir();
    await copyFile(resolve(packageRoot, fixture('lane-b-f07-valid.yaml')), join(root, 'good.yaml'));
    await symlink(root, join(root, 'loop'));

    const { code, stdout } = await runCliGuarded(['definitions', 'validate', join(root, '**', '*.yaml')]);

    expect(code).toBe(0);
    expect(stdout).toContain('1 definition file(s) valid.');
  }, 20000);
});

describe('F-12 / F-29: non-regular files are unreadable entries, not hangs', () => {
  test('a FIFO at a literal definition path exits 5 instead of hanging', async () => {
    const dir = await makeTempDir();
    const fifo = join(dir, 'pipe.yaml');
    await makeFifo(fifo);

    const { code, stderr } = await runCliGuarded(['definitions', 'validate', fifo]);

    expect(code).toBe(5);
    expect(stderr).toContain('not a regular file');
  }, 20000);

  test('a FIFO matched by a glob is an unreadable entry, not a hang', async () => {
    const dir = await makeTempDir();
    await makeFifo(join(dir, 'pipe.yaml'));

    const { code, stderr } = await runCliGuarded(['definitions', 'validate', join(dir, '*.yaml')]);

    expect(code).toBe(5);
    expect(stderr).toContain('not a regular file');
  }, 20000);
});

describe('F-13: manifest read failures are classified by cause', () => {
  test('a --registries path that is a directory exits 6 (manifest unreadable)', async () => {
    const { code, stderr } = await runCli([
      'definitions',
      'validate',
      fixture('lane-b-f07-valid.yaml'),
      '--registries',
      'test/fixtures',
    ]);

    expect(code).toBe(6);
    expect(stderr).toContain('Cannot read registries manifest');
  });

  test('an empty --registries value is a usage error (exit 2)', async () => {
    const { code, stderr } = await runCli([
      'definitions',
      'validate',
      fixture('lane-b-f07-valid.yaml'),
      '--registries',
      '',
    ]);

    expect(code).toBe(2);
    expect(stderr).toContain('Usage:');
  });
});

describe('F-14: --json always writes exactly one JSON document to stdout', () => {
  test('a usage error under --json prints a JSON error document (exit 2)', async () => {
    const { code, stdout, stderr } = await runCli(['definitions', 'validate', '--json']);

    expect(code).toBe(2);
    expect(stderr).toContain('Usage:');
    const doc = JSON.parse(stdout) as { valid: boolean; error: { code: number; kind: string; message: string }; files: unknown[] };
    expect(doc.valid).toBe(false);
    expect(doc.error.code).toBe(2);
    expect(doc.error.kind).toBe('usage');
    expect(typeof doc.error.message).toBe('string');
    expect(doc.files).toEqual([]);
  });

  test('a missing manifest under --json prints the fatal document (exit 3)', async () => {
    const { code, stdout } = await runCli([
      'definitions',
      'validate',
      fixture('lane-b-f07-valid.yaml'),
      '--registries',
      'test/fixtures/lane-b-f14-does-not-exist.yaml',
      '--json',
    ]);

    expect(code).toBe(3);
    const doc = JSON.parse(stdout) as { valid: boolean; error: { code: number; kind: string } };
    expect(doc.valid).toBe(false);
    expect(doc.error.code).toBe(3);
    expect(doc.error.kind).toBe('manifest-missing');
  });

  test('a glob that matches nothing under --json prints the fatal document (exit 7)', async () => {
    const { code, stdout } = await runCli([
      'definitions',
      'validate',
      'test/fixtures/lane-b-f14-none-*.yaml',
      '--json',
    ]);

    expect(code).toBe(7);
    const doc = JSON.parse(stdout) as { error: { code: number; kind: string; message: string } };
    expect(doc.error.code).toBe(7);
    expect(doc.error.kind).toBe('no-files-matched');
    expect(doc.error.message).toContain('No definition files matched "test/fixtures/lane-b-f14-none-*.yaml"');
  });
});

describe('F-15: one unreadable file does not discard the other results', () => {
  test('an unreadable file gets its own entry while readable results are printed; exit 5', async () => {
    const dir = await makeTempDir();
    await copyFile(resolve(packageRoot, fixture('lane-b-f08-invalid.yaml')), join(dir, 'a-invalid.yaml'));
    await writeFile(join(dir, 'b-unreadable.yaml'), 'id: x\n');
    await chmod(join(dir, 'b-unreadable.yaml'), 0o000);

    const { code, stdout } = await runCli(['definitions', 'validate', join(dir, '*.yaml'), '--json']);

    expect(code).toBe(5);
    const doc = JSON.parse(stdout) as {
      valid: boolean;
      files: Array<{ path: string; kind: string; issues: Array<{ code: string }> }>;
    };
    expect(doc.valid).toBe(false);
    const invalid = doc.files.find((file) => file.path.endsWith('a-invalid.yaml'));
    const unreadable = doc.files.find((file) => file.path.endsWith('b-unreadable.yaml'));
    expect(invalid?.kind).toBe('invalid');
    expect(invalid?.issues.length).toBeGreaterThan(0);
    expect(unreadable?.kind).toBe('unreadable');
  });
});

describe('F-16: manifest names are YAML 1.1 strings, like definitions', () => {
  test('an unquoted 010 manifest key is a malformed manifest (exit 4) that asks for quotes', async () => {
    const { code, stderr } = await runCli([
      'definitions',
      'validate',
      fixture('lane-b-f16-definition-policy-010.yaml'),
      '--registries',
      fixture('lane-b-f16-manifest-unquoted.yaml'),
    ]);

    expect(code).toBe(4);
    expect(stderr).toContain('Malformed registries manifest');
    expect(stderr).toContain('quote');
  });

  test('a quoted "010" manifest key resolves a definition policy "010"', async () => {
    const { code, stdout } = await runCli([
      'definitions',
      'validate',
      fixture('lane-b-f16-definition-policy-010.yaml'),
      '--registries',
      fixture('lane-b-f16-manifest-quoted.yaml'),
    ]);

    expect(code).toBe(0);
    expect(stdout).not.toContain('missing-policy-ref');
  });

  test('a definition policy "10" does not resolve against a manifest declaring "010"', async () => {
    const { code, stdout } = await runCli([
      'definitions',
      'validate',
      fixture('lane-b-f16-definition-policy-10.yaml'),
      '--registries',
      fixture('lane-b-f16-manifest-quoted.yaml'),
    ]);

    expect(code).toBe(1);
    expect(stdout).toContain('missing-policy-ref');
  });
});

describe('F-25: glob and literal path handling', () => {
  test('a literal path containing brackets is read by its exact name', async () => {
    const dir = await makeTempDir();
    await copyFile(resolve(packageRoot, fixture('lane-b-f07-valid.yaml')), join(dir, 'a[1].yaml'));

    const { code } = await runCli(['definitions', 'validate', join(dir, 'a[1].yaml')]);

    expect(code).toBe(0);
  });

  test('a glob matching nothing exits 7 with its own message', async () => {
    const { code, stderr } = await runCli([
      'definitions',
      'validate',
      'test/fixtures/lane-b-f25-nomatch-*.yaml',
    ]);

    expect(code).toBe(7);
    expect(stderr).toContain('No definition files matched "test/fixtures/lane-b-f25-nomatch-*.yaml"');
  });

  test('brace alternation is rejected by a usage error (exit 2)', async () => {
    const { code, stderr } = await runCli([
      'definitions',
      'validate',
      'test/fixtures/{lane-b-f07-valid,lane-b-f07-invalid}.yaml',
    ]);

    expect(code).toBe(2);
    expect(stderr).toContain('Brace');
  });
});

describe('F-26: an empty manifest section means no names', () => {
  test('policies: with no entries is treated as an empty mapping', async () => {
    const { code, stdout, stderr } = await runCli([
      'definitions',
      'validate',
      fixture('lane-b-f07-valid.yaml'),
      '--registries',
      fixture('lane-b-f26-manifest-null-section.yaml'),
    ]);

    expect(stderr).not.toContain('Malformed');
    expect(code).toBe(1);
    expect(stdout).toContain('missing-policy-ref');
  });
});

describe('F-05: prototype-named refs do not resolve through Object.prototype', () => {
  test('a policy named constructor is missing when the manifest declares only requester_can_submit', async () => {
    const { code, stdout } = await runCli([
      'definitions',
      'validate',
      fixture('lane-b-f05-policy-constructor.yaml'),
      '--registries',
      fixture('lane-b-f05-manifest.yaml'),
    ]);

    expect(code).toBe(1);
    expect(stdout).toContain('missing-policy-ref');
    expect(stdout).toContain('constructor');
  });
});

describe('F-06: unexpected exceptions are internal errors (exit 70), not issues', () => {
  test('an exception from the validator becomes an internal-error entry naming the file (exit 70)', async () => {
    const { code, stdout } = await runInProcess(
      ['definitions', 'validate', fixture('lane-b-f07-valid.yaml'), '--json'],
      {
        validate: () => {
          throw new Error('validator exploded');
        },
      },
    );

    expect(code).toBe(70);
    const doc = JSON.parse(stdout) as {
      valid: boolean;
      files: Array<{ path: string; kind: string; message?: string }>;
    };
    expect(doc.valid).toBe(false);
    expect(doc.files).toHaveLength(1);
    expect(doc.files[0].kind).toBe('internal-error');
    expect(doc.files[0].path).toContain('lane-b-f07-valid.yaml');
    expect(doc.files[0].message).toContain('validator exploded');
  });

  test('internal-error outranks invalid: a crashing file and an invalid file exit 70', async () => {
    const { code, stdout } = await runInProcess(
      [
        'definitions',
        'validate',
        fixture('lane-b-f07-valid.yaml'),
        fixture('lane-b-f07-invalid.yaml'),
        '--json',
      ],
      {
        validate: () => {
          throw new Error('boom');
        },
      },
    );

    expect(code).toBe(70);
    const kinds = (JSON.parse(stdout) as { files: Array<{ kind: string }> }).files.map((file) => file.kind).sort();
    expect(kinds).toEqual(['internal-error', 'invalid']);
  });

  test('a rule ref named constructor is reported as missing-rule-ref, not a crash', async () => {
    const { code, stdout } = await runCli([
      'definitions',
      'validate',
      fixture('lane-b-f06-rule-constructor.yaml'),
      '--registries',
      fixture('lane-b-f05-manifest.yaml'),
    ]);

    expect(code).toBe(1);
    expect(stdout).toContain('missing-rule-ref');
  });
});
