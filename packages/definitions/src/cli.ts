import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { publishDefinition, validateFlowkit } from '@naakwu/flowkit-temporal';
import type {
  FlowkitValidationIssue,
  FlowkitValidationRegistries,
  PublishedFlowDefinition,
} from '@naakwu/flowkit-temporal';

import {
  FlowDefinitionYamlError,
  locateYamlPath,
  parseYamlWithStructure,
  splitYamlPath,
} from './yaml';
import type { ParsedFlowYaml } from './yaml';

/* -------------------------------------------------------------------------- */
/* Exit codes                                                                  */
/* -------------------------------------------------------------------------- */

export const EXIT_CLEAN = 0;
export const EXIT_ISSUES = 1;
export const EXIT_USAGE = 2;
export const EXIT_MISSING_MANIFEST = 3;
export const EXIT_MALFORMED_MANIFEST = 4;
export const EXIT_UNREADABLE_DEFINITION = 5;

const USAGE = `Usage: flowkit definitions validate <glob> [--registries <file>] [--json]

  <glob>              Glob of definition files to validate (for example "definitions/*.yaml").
  --registries <file> YAML or JSON manifest of declared refs; enables ref validation.
  --json              Emit machine-readable JSON instead of human-readable lines.

Exit codes:
  0  every definition is valid
  1  one or more definitions have validation issues
  2  usage error
  3  the --registries manifest is missing
  4  the --registries manifest is malformed
  5  a definition file cannot be read
`;

/* -------------------------------------------------------------------------- */
/* Registry-independent validation                                             */
/* -------------------------------------------------------------------------- */

/**
 * `validateFlowkit` emits `missing-*-ref` issues only when a registry is
 * missing the name the definition references. With no manifest there are no
 * registries to check against, so those codes are filtered out and the
 * registry-dependent checks are reported as skipped on stdout.
 */
const REGISTRY_DEPENDENT_CODES = new Set([
  'missing-policy-ref',
  'missing-guard-ref',
  'missing-rule-ref',
  'missing-system-step-ref',
  'missing-ai-step-ref',
  'missing-template-ref',
  'missing-channel-ref',
  'rule-action-unavailable',
  'rule-action-not-system',
]);

const SKIPPED_NOTE =
  'declared-ref validation (policies, guards, rules, system steps, AI steps, templates, channels)';

/* -------------------------------------------------------------------------- */
/* Registries manifest                                                         */
/* -------------------------------------------------------------------------- */

const MANIFEST_SECTIONS = [
  'policies',
  'guards',
  'rules',
  'systemSteps',
  'aiSteps',
  'templates',
  'channels',
] as const;

const recordKeys = (section: string, value: unknown): string[] => {
  if (value === undefined) {
    return [];
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`section "${section}" must be a mapping of names.`);
  }

  return Object.keys(value as Record<string, unknown>);
};

/**
 * Builds a {@link FlowkitValidationRegistries} from a parsed manifest. The
 * manifest is data — only the declared names matter to `validateFlowkit`, which
 * checks existence (`registries.policies?.[name]`) and, for rules, the finite
 * `actions` list. Handler functions are therefore placeholders; they are never
 * invoked during validation.
 */
const buildRegistriesFromManifest = (
  source: string,
  path: string,
): FlowkitValidationRegistries => {
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (error) {
    throw new Error(
      `cannot parse as YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(
      `must be a mapping of sections (${MANIFEST_SECTIONS.join(', ')}).`,
    );
  }

  const manifest = raw as Record<string, unknown>;
  for (const key of Object.keys(manifest)) {
    if (!(MANIFEST_SECTIONS as readonly string[]).includes(key)) {
      throw new Error(`unknown section "${key}".`);
    }
  }

  const rules: Record<string, { actions: string[] }> = {};
  const rulesValue = manifest.rules;
  if (rulesValue !== undefined) {
    if (rulesValue === null || typeof rulesValue !== 'object' || Array.isArray(rulesValue)) {
      throw new Error('section "rules" must be a mapping of rule names.');
    }

    for (const [name, entry] of Object.entries(rulesValue as Record<string, unknown>)) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`rule "${name}" must declare an "actions" list.`);
      }

      const actions = (entry as Record<string, unknown>).actions;
      if (!Array.isArray(actions) || actions.some((action) => typeof action !== 'string')) {
        throw new Error(`rule "${name}" must declare an "actions" list of strings.`);
      }

      rules[name] = { actions: actions as string[] };
    }
  }

  const namesOf = (section: (typeof MANIFEST_SECTIONS)[number]): string[] =>
    recordKeys(section, manifest[section]);

  return {
    policies: Object.fromEntries(namesOf('policies').map((name) => [name, () => false])),
    guards: Object.fromEntries(namesOf('guards').map((name) => [name, () => false])),
    rules: Object.fromEntries(
      Object.entries(rules).map(([name, entry]) => [
        name,
        { actions: entry.actions, run: () => undefined },
      ]),
    ),
    systemSteps: Object.fromEntries(namesOf('systemSteps').map((name) => [name, {}])),
    aiSteps: Object.fromEntries(namesOf('aiSteps').map((name) => [name, {}])),
    templates: Object.fromEntries(namesOf('templates').map((name) => [name, {}])),
    channels: Object.fromEntries(namesOf('channels').map((name) => [name, {}])),
  };
};

/* -------------------------------------------------------------------------- */
/* Glob expansion (self-contained; no dependency on Bun globals)              */
/* -------------------------------------------------------------------------- */

const hasMagic = (pattern: string): boolean => /[*?[]/.test(pattern);

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Converts a glob with `*`, `**`, and `?` into an anchored regular expression.
 * A `**` segment matches zero or more path segments; `*` and `?` never cross a
 * path separator.
 */
const globToRegExp = (pattern: string): RegExp => {
  let source = '^';

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];

    if (char === '*') {
      if (pattern[index + 1] === '*') {
        if (pattern[index + 2] === '/') {
          source += '(?:.*/)?';
          index += 2;
        } else {
          source += '.*';
          index += 1;
        }
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else if (char === '[') {
      const end = pattern.indexOf(']', index);
      if (end === -1) {
        source += '\\[';
      } else {
        source += pattern.slice(index, end + 1);
        index = end;
      }
    } else {
      source += escapeRegExp(char);
    }
  }

  return new RegExp(`${source}$`);
};

const splitGlob = (
  pattern: string,
): { base: string; relPattern: string } => {
  const segments = pattern.split('/');
  const firstMagic = segments.findIndex((segment) => hasMagic(segment));

  if (firstMagic === -1) {
    const last = Math.max(0, segments.length - 1);
    return { base: segments.slice(0, last).join('/') || '.', relPattern: segments[last] ?? '' };
  }

  return {
    base: segments.slice(0, firstMagic).join('/') || '.',
    relPattern: segments.slice(firstMagic).join('/'),
  };
};

const walkFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }

  return files;
};

const expandGlob = async (pattern: string, cwd: string): Promise<string[]> => {
  const normalized = pattern.replaceAll(sep === '/' ? '\\' : '/', '/');
  const { base, relPattern } = splitGlob(normalized);
  const baseDirectory = resolve(cwd, base);

  if (!hasMagic(normalized)) {
    // A literal path: read it directly so a missing file is an "unreadable
    // definition file" error rather than a silent zero-match.
    try {
      const source = await readFile(resolve(cwd, normalized), 'utf8');
      void source;
      return [resolve(cwd, normalized)];
    } catch (error) {
      throw new Error(
        `Cannot read definition file "${normalized}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const regex = globToRegExp(relPattern);
  const allFiles = await walkFiles(baseDirectory);

  return allFiles
    .filter((file) => regex.test(relative(baseDirectory, file)))
    .sort();
};

/* -------------------------------------------------------------------------- */
/* Runner                                                                      */
/* -------------------------------------------------------------------------- */

interface ReportedIssue {
  path: string;
  line?: number;
  column?: number;
  code: string;
  message: string;
}

interface FileResult {
  path: string;
  issues: ReportedIssue[];
}

interface ParsedArgs {
  glob?: string;
  registries?: string;
  json: boolean;
}

const parseArgs = (args: readonly string[]): ParsedArgs | { usage: string } => {
  const positional: string[] = [];
  let registries: string | undefined;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--json') {
      json = true;
      continue;
    }

    if (arg === '--registries') {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) {
        return { usage: '--registries requires a file path.' };
      }
      registries = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--registries=')) {
      registries = arg.slice('--registries='.length);
      continue;
    }

    if (arg.startsWith('-')) {
      return { usage: `Unknown option "${arg}".` };
    }

    positional.push(arg);
  }

  return { glob: positional[0], registries, json };
};

/**
 * Runs `flowkit definitions validate`. Returns the process exit code and prints
 * results to stdout (issues to stderr for the fatal manifest/file cases). This
 * is the testable core; `src/bin.ts` is a thin shim over it.
 */
export async function runDefinitionsValidate(
  argv: readonly string[],
  cwd: string = process.cwd(),
): Promise<number> {
  if (argv[0] !== 'definitions' || argv[1] !== 'validate') {
    process.stderr.write(USAGE);
    return EXIT_USAGE;
  }

  const parsed = parseArgs(argv.slice(2));
  if ('usage' in parsed) {
    process.stderr.write(`${parsed.usage}\n\n${USAGE}`);
    return EXIT_USAGE;
  }

  if (parsed.glob === undefined) {
    process.stderr.write(`A definition file glob is required.\n\n${USAGE}`);
    return EXIT_USAGE;
  }

  // Resolve the registries manifest first so a bad manifest fails fast with a
  // distinct exit code and a message naming the offending path.
  let registries: FlowkitValidationRegistries | undefined;
  const skipped: string[] = [];

  if (parsed.registries !== undefined) {
    const manifestPath = resolve(cwd, parsed.registries);
    let manifestSource: string;

    try {
      manifestSource = await readFile(manifestPath, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        process.stderr.write(`Missing registries manifest: ${manifestPath}\n`);
      } else {
        process.stderr.write(
          `Cannot read registries manifest "${manifestPath}": ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
      return EXIT_MISSING_MANIFEST;
    }

    try {
      registries = buildRegistriesFromManifest(manifestSource, manifestPath);
    } catch (error) {
      process.stderr.write(
        `Malformed registries manifest "${manifestPath}": ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return EXIT_MALFORMED_MANIFEST;
    }
  } else {
    skipped.push(SKIPPED_NOTE);
  }

  let files: string[];
  try {
    files = await expandGlob(parsed.glob, cwd);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT_UNREADABLE_DEFINITION;
  }

  if (files.length === 0) {
    process.stderr.write(`No definition files matched "${parsed.glob}".\n`);
    return EXIT_UNREADABLE_DEFINITION;
  }

  const results: FileResult[] = [];

  for (const file of files) {
    let source: string;
    try {
      source = await readFile(file, 'utf8');
    } catch (error) {
      process.stderr.write(
        `Cannot read definition file "${file}": ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return EXIT_UNREADABLE_DEFINITION;
    }

    let parsed: ParsedFlowYaml;
    try {
      parsed = parseYamlWithStructure(source, file);
    } catch (error) {
      if (error instanceof FlowDefinitionYamlError) {
        results.push({
          path: file,
          issues: error.issues.map((issue) => ({
            path: issue.path,
            line: issue.line,
            column: issue.column,
            code: 'yaml-error',
            message: issue.message,
          })),
        });
        continue;
      }

      throw error;
    }

    const published: PublishedFlowDefinition = publishDefinition({ definition: parsed.definition });
    let issues: FlowkitValidationIssue[];

    if (registries) {
      issues = validateFlowkit({ published, registries });
    } else {
      issues = validateFlowkit({ published, registries: {} }).filter(
        (issue) => !REGISTRY_DEPENDENT_CODES.has(issue.code),
      );
    }

    results.push({
      path: file,
      issues: issues.map((issue) => {
        const location = locateYamlPath(parsed.structure, splitYamlPath(issue.path));
        return {
          path: issue.path,
          line: location?.line,
          column: location?.column,
          code: issue.code,
          message: issue.message,
        };
      }),
    });
  }

  const total = results.reduce((count, result) => count + result.issues.length, 0);

  if (parsed.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          valid: total === 0,
          skippedChecks: skipped,
          files: results.map((result) => ({
            path: result.path,
            issues: result.issues.map((issue) => ({
              path: issue.path,
              line: issue.line ?? null,
              column: issue.column ?? null,
              code: issue.code,
              message: issue.message,
            })),
          })),
        },
        null,
        2,
      )}\n`,
    );
  } else {
    for (const result of results) {
      if (files.length > 1) {
        process.stdout.write(`# ${result.path}\n`);
      }

      for (const issue of result.issues) {
        const location =
          issue.line === undefined ? '?:?' : `${issue.line}:${issue.column ?? 1}`;
        process.stdout.write(`${issue.path}:${location} ${issue.code} ${issue.message}\n`);
      }
    }

    if (skipped.length > 0) {
      process.stdout.write(`Skipped: ${skipped.join(', ')}\n`);
    }

    if (total === 0) {
      process.stdout.write(`${results.length} definition file(s) valid.\n`);
    } else {
      process.stdout.write(`${total} issue(s) across ${results.length} file(s).\n`);
    }
  }

  return total === 0 ? EXIT_CLEAN : EXIT_ISSUES;
}
