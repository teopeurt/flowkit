/**
 * `flowkit definitions validate <glob-or-path>... [--registries <file>] [--json]`
 *
 * Exit codes (the CI gate and the non-engineer check both read these):
 *
 *   0  every definition is valid
 *   1  one or more definitions have validation issues
 *   2  usage error
 *   3  the --registries manifest does not exist (ENOENT)
 *   4  the --registries manifest is malformed
 *   5  a definition file cannot be read (unreadable, not a regular file, dangling link)
 *   6  the --registries manifest cannot be read (permissions, a directory, other I/O)
 *   7  a glob or path matched no definition files
 *   70 internal error: an unexpected exception while validating a file
 *
 * Per-file results are combined with this priority, highest first:
 * 5 (unreadable definition), 70 (internal error), 1 (invalid), 0 (clean).
 * Usage, manifest and no-match failures are fatal: they stop the run before
 * any file is validated.
 *
 * With `--json`, stdout is always exactly one JSON document. Fatal failures use
 * `{ "valid": false, "error": { "code", "kind", "message" }, "files": [] }`; the
 * message is also written to stderr.
 */
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { LineCounter, isMap, isScalar, parseDocument } from 'yaml';

import { publishDefinition, validateFlowkit } from '@naakwu/flowkit-temporal';
import type { FlowkitValidationIssue, FlowkitValidationRegistries } from '@naakwu/flowkit-temporal';

import { FlowDefinitionYamlError, locateYamlPath, parseYamlWithStructure, splitYamlPath } from './yaml';
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
export const EXIT_UNREADABLE_MANIFEST = 6;
export const EXIT_NO_FILES_MATCHED = 7;
export const EXIT_INTERNAL_ERROR = 70;

const USAGE = `Usage: flowkit definitions validate <glob-or-path>... [--registries <file>] [--json]

  <glob-or-path>...     One or more definition files or globs. Every match is
                        validated once, even if several arguments match it.
                        Glob syntax: * (within one path segment), ** (any number
                        of segments), ? (one character), [...] character classes.
                        Not supported: {a,b} braces (usage error).
                        A name that exists literally, brackets included, is read
                        as-is. Symbolic links are followed.
  --registries <file>   YAML or JSON manifest of declared refs; enables ref validation.
  --json                Emit one JSON document on stdout, including for fatal errors.

Exit codes:
  0   every definition is valid
  1   one or more definitions have validation issues
  2   usage error
  3   the --registries manifest does not exist
  4   the --registries manifest is malformed
  5   a definition file cannot be read (unreadable, not a regular file, dangling link)
  6   the --registries manifest cannot be read (permissions, a directory, other I/O)
  7   a glob or path matched no definition files
  70  internal error (an unexpected exception while validating a file)
When validated files disagree, the highest of 5, 70, 1, 0 is returned.
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
  'missing-orchestrator-ref',
  'orchestrator-agents-empty',
  'orchestrator-limit-invalid',
  'missing-template-ref',
  'missing-channel-ref',
  'rule-action-unavailable',
  'rule-action-not-system',
]);

const SKIPPED_NOTE =
  'declared-ref validation (policies, guards, rules, system steps, AI steps, orchestrators, templates, channels)';

/* -------------------------------------------------------------------------- */
/* Failures                                                                    */
/* -------------------------------------------------------------------------- */

type FatalKind =
  | 'usage'
  | 'manifest-missing'
  | 'manifest-unreadable'
  | 'manifest-malformed'
  | 'no-files-matched'
  | 'internal-error';

/** A failure that stops the run before any definition is validated. */
class CliFatal extends Error {
  constructor(
    readonly code: number,
    readonly kind: FatalKind,
    message: string,
    readonly showUsage = false,
  ) {
    super(message);
    this.name = 'CliFatal';
  }
}

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const errorCode = (error: unknown): string | undefined =>
  (error as NodeJS.ErrnoException | undefined)?.code;

/* -------------------------------------------------------------------------- */
/* Registries manifest                                                         */
/* -------------------------------------------------------------------------- */

const MANIFEST_SECTIONS = [
  'policies',
  'guards',
  'rules',
  'systemSteps',
  'aiSteps',
  'orchestrators',
  'templates',
  'channels',
] as const;

/**
 * Parsed with the same YAML 1.1 schema as definitions (see `src/yaml.ts`), so a
 * name means the same thing in both files. Merge keys are off, as in the loader.
 */
const MANIFEST_PARSE_OPTIONS = { schema: 'yaml-1.1', merge: false } as const;

/**
 * A record with no prototype. Names such as `constructor`, `toString` or
 * `__proto__` must not resolve through Object.prototype, or a missing ref would
 * look declared.
 */
const recordOf = <T>(names: readonly string[], make: (name: string) => T): Record<string, T> => {
  const record: Record<string, T> = Object.create(null);
  for (const name of names) {
    record[name] = make(name);
  }
  return record;
};

const sectionNames = (section: string, value: unknown): string[] => {
  if (value === undefined || value === null) {
    // An empty section (`policies:` with nothing under it) declares no names.
    return [];
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`section "${section}" must be a mapping of names.`);
  }

  return Object.keys(value);
};

/**
 * Builds a {@link FlowkitValidationRegistries} from manifest source. The manifest
 * is data: only the declared names matter to `validateFlowkit`, which checks
 * existence and, for rules, the finite `actions` list. Handler functions are
 * placeholders and are never invoked during validation.
 *
 * Mapping keys must be strings. An unquoted `010` or `yes` is a number or a
 * boolean under YAML 1.1, so it is rejected with a message asking for quotes.
 */
const buildRegistriesFromManifest = (source: string): FlowkitValidationRegistries => {
  const lineCounter = new LineCounter();
  const document = parseDocument(source, { ...MANIFEST_PARSE_OPTIONS, lineCounter });

  if (document.errors.length > 0) {
    const [first] = document.errors;
    const position = first.linePos?.[0];
    const where = position ? ` at line ${position.line}, column ${position.col}` : '';
    throw new Error(`cannot parse as YAML${where}: ${first.message.split('\n')[0]}`);
  }

  const contents = document.contents;
  if (!isMap(contents)) {
    throw new Error(`must be a mapping of sections (${MANIFEST_SECTIONS.join(', ')}).`);
  }

  const rawKeyText = (node: unknown): { text: string; where: string } => {
    const range = (node as { range?: [number, number, number] } | null | undefined)?.range;
    if (!range) {
      return { text: '?', where: '' };
    }
    const position = lineCounter.linePos(range[0]);
    return {
      text: source.slice(range[0], range[1]).trim(),
      where: ` (line ${position.line}, column ${position.col})`,
    };
  };

  const requireStringKey = (key: unknown, owner: string): void => {
    if (isScalar(key) && typeof key.value === 'string') {
      return;
    }
    const { text, where } = rawKeyText(key);
    throw new Error(
      `${owner} name ${text} is not a string${where}; quote the name, for example "${text}".`,
    );
  };

  for (const pair of contents.items) {
    requireStringKey(pair.key, 'section');
    if (isScalar(pair.key) && typeof pair.key.value === 'string' && isMap(pair.value)) {
      for (const inner of pair.value.items) {
        requireStringKey(inner.key, `"${pair.key.value}" entry`);
      }
    }
  }

  let manifest: Record<string, unknown>;
  try {
    manifest = document.toJS() as Record<string, unknown>;
  } catch (error) {
    throw new Error(describeError(error));
  }

  for (const key of Object.keys(manifest)) {
    if (!(MANIFEST_SECTIONS as readonly string[]).includes(key)) {
      throw new Error(`unknown section "${key}".`);
    }
  }

  const ruleActions = new Map<string, string[]>();
  const rulesValue = manifest.rules;
  if (rulesValue !== undefined && rulesValue !== null) {
    if (typeof rulesValue !== 'object' || Array.isArray(rulesValue)) {
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

      ruleActions.set(name, actions as string[]);
    }
  }

  // An orchestrator declares data only: its agents and, optionally, numeric limits. Activity options
  // and handlers are code and are never part of a manifest.
  const orchestrators: Record<string, Record<string, unknown>> = Object.create(null);
  const orchestratorsValue = manifest.orchestrators;
  if (orchestratorsValue !== undefined && orchestratorsValue !== null) {
    if (typeof orchestratorsValue !== 'object' || Array.isArray(orchestratorsValue)) {
      throw new Error('section "orchestrators" must be a mapping of orchestrator names.');
    }

    for (const [name, entry] of Object.entries(orchestratorsValue as Record<string, unknown>)) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`orchestrator "${name}" must declare an "agents" list.`);
      }

      const record = entry as Record<string, unknown>;
      if (!Array.isArray(record.agents) || record.agents.some((agent) => typeof agent !== 'string')) {
        throw new Error(`orchestrator "${name}" must declare an "agents" list of strings.`);
      }

      const { agents, maxTasks, maxConcurrency, failFast, maxOutputBytes, ...unknown } = record;
      const unknownKeys = Object.keys(unknown);
      if (unknownKeys.length > 0) {
        throw new Error(`orchestrator "${name}" has unknown field "${unknownKeys[0]}".`);
      }

      orchestrators[name] = { agents, maxTasks, maxConcurrency, failFast, maxOutputBytes };
    }
  }

  const namesOf = (section: (typeof MANIFEST_SECTIONS)[number]): string[] =>
    sectionNames(section, manifest[section]);

  return {
    policies: recordOf(namesOf('policies'), () => () => false),
    guards: recordOf(namesOf('guards'), () => () => false),
    rules: recordOf([...ruleActions.keys()], (name) => ({
      actions: ruleActions.get(name) as string[],
      run: () => undefined,
    })),
    systemSteps: recordOf(namesOf('systemSteps'), () => ({})),
    aiSteps: recordOf(namesOf('aiSteps'), () => ({})),
    orchestrators: orchestrators as unknown as FlowkitValidationRegistries['orchestrators'],
    templates: recordOf(namesOf('templates'), () => ({})),
    channels: recordOf(namesOf('channels'), () => ({})),
  } as FlowkitValidationRegistries;
};

/* -------------------------------------------------------------------------- */
/* Glob expansion (self-contained; no dependency on Bun globals)              */
/* -------------------------------------------------------------------------- */

const hasMagic = (pattern: string): boolean => /[*?[]/.test(pattern);

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');

/**
 * Converts a glob with `*`, `**`, `?` and `[...]` into an anchored regular
 * expression. A `**` segment matches zero or more path segments; `*` and `?`
 * never cross a path separator.
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

const splitGlob = (pattern: string): { base: string; relPattern: string } => {
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

interface PathFailure {
  path: string;
  message: string;
}

interface WalkResult {
  files: string[];
  unreadable: PathFailure[];
}

/**
 * Collects every non-directory entry under `directory`. Symbolic links are
 * followed: a link is treated as a directory when its target is one, and as a
 * file candidate otherwise, so a dangling link surfaces as unreadable instead of
 * disappearing. `ancestors` holds the real paths on the current chain; a link
 * back into it is a cycle and is not followed again.
 */
const walkDirectory = async (
  directory: string,
  ancestors: ReadonlySet<string>,
  result: WalkResult,
): Promise<void> => {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    result.unreadable.push({
      path: directory,
      message: `Cannot read directory "${directory}": ${describeError(error)}`,
    });
    return;
  }

  for (const entry of entries) {
    const full = join(directory, entry.name);

    let isDirectory = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      isDirectory = await stat(full).then(
        (target) => target.isDirectory(),
        () => false,
      );
    }

    if (!isDirectory) {
      result.files.push(full);
      continue;
    }

    let real: string;
    try {
      real = await realpath(full);
    } catch (error) {
      result.unreadable.push({
        path: full,
        message: `Cannot read directory "${full}": ${describeError(error)}`,
      });
      continue;
    }

    if (ancestors.has(real)) {
      continue;
    }

    await walkDirectory(full, new Set([...ancestors, real]), result);
  }
};

interface PatternExpansion {
  candidates: string[];
  unreadable: PathFailure[];
}

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

/**
 * Expands one argument. A name that exists as written is taken literally, even
 * if it contains glob characters. Otherwise a pattern with magic characters is
 * matched against the tree, and a plain name is passed on as a literal path,
 * which fails later as an unreadable file.
 */
const expandPattern = async (pattern: string, cwd: string): Promise<PatternExpansion> => {
  const literal = resolve(cwd, pattern);

  if (await exists(literal)) {
    return { candidates: [literal], unreadable: [] };
  }

  if (/[{}]/.test(pattern)) {
    throw new CliFatal(
      EXIT_USAGE,
      'usage',
      `Brace alternation in "${pattern}" is not supported; pass each file as its own argument.`,
      true,
    );
  }

  if (!hasMagic(pattern)) {
    return { candidates: [literal], unreadable: [] };
  }

  const normalized = pattern.replaceAll(sep === '/' ? '\\' : '/', '/');
  const { base, relPattern } = splitGlob(normalized);
  const baseDirectory = resolve(cwd, base);
  const regex = globToRegExp(relPattern);

  let baseReal: string;
  try {
    baseReal = await realpath(baseDirectory);
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') {
      return { candidates: [], unreadable: [] };
    }
    return {
      candidates: [],
      unreadable: [
        {
          path: baseDirectory,
          message: `Cannot read directory "${baseDirectory}": ${describeError(error)}`,
        },
      ],
    };
  }

  const result: WalkResult = { files: [], unreadable: [] };
  await walkDirectory(baseDirectory, new Set([baseReal]), result);

  return {
    candidates: result.files.filter((file) => regex.test(relative(baseDirectory, file))),
    unreadable: result.unreadable,
  };
};

/** Keeps one path per real file, so a file reached through two names is validated once. */
const dedupeByRealPath = async (paths: readonly string[]): Promise<string[]> => {
  const seen = new Map<string, string>();
  for (const path of paths) {
    const key = await realpath(path).catch(() => path);
    if (!seen.has(key)) {
      seen.set(key, path);
    }
  }
  return [...seen.values()].sort();
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

type FileKind = 'valid' | 'invalid' | 'unreadable' | 'internal-error';

interface FileResult {
  path: string;
  kind: FileKind;
  issues: ReportedIssue[];
  message?: string;
}

interface ParsedArgs {
  globs: string[];
  registries?: string;
}

/** Test seams. Production uses the defaults. */
export interface ValidateDeps {
  publish: typeof publishDefinition;
  validate: typeof validateFlowkit;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const usage = (message: string): CliFatal => new CliFatal(EXIT_USAGE, 'usage', message, true);

const parseArgs = (argv: readonly string[]): ParsedArgs => {
  if (argv[0] !== 'definitions' || argv[1] !== 'validate') {
    throw usage('Expected the command "flowkit definitions validate".');
  }

  const args = argv.slice(2);
  const globs: string[] = [];
  let registries: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--json') {
      continue;
    }

    if (arg === '--registries') {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw usage('--registries requires a file path.');
      }
      if (value === '') {
        throw usage('--registries requires a non-empty file path.');
      }
      registries = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--registries=')) {
      const value = arg.slice('--registries='.length);
      if (value === '') {
        throw usage('--registries requires a non-empty file path.');
      }
      registries = value;
      continue;
    }

    if (arg.startsWith('-')) {
      throw usage(`Unknown option "${arg}".`);
    }

    globs.push(arg);
  }

  if (globs.length === 0) {
    throw usage('A definition file glob is required.');
  }

  return { globs, registries };
};

const loadManifest = async (manifestPath: string): Promise<FlowkitValidationRegistries> => {
  let source: string;
  try {
    const info = await stat(manifestPath);
    if (!info.isFile()) {
      throw new CliFatal(
        EXIT_UNREADABLE_MANIFEST,
        'manifest-unreadable',
        `Cannot read registries manifest "${manifestPath}": not a regular file.`,
      );
    }
    source = await readFile(manifestPath, 'utf8');
  } catch (error) {
    if (error instanceof CliFatal) {
      throw error;
    }
    if (errorCode(error) === 'ENOENT') {
      throw new CliFatal(
        EXIT_MISSING_MANIFEST,
        'manifest-missing',
        `Missing registries manifest: ${manifestPath}`,
      );
    }
    throw new CliFatal(
      EXIT_UNREADABLE_MANIFEST,
      'manifest-unreadable',
      `Cannot read registries manifest "${manifestPath}": ${describeError(error)}`,
    );
  }

  try {
    return buildRegistriesFromManifest(source);
  } catch (error) {
    throw new CliFatal(
      EXIT_MALFORMED_MANIFEST,
      'manifest-malformed',
      `Malformed registries manifest "${manifestPath}": ${describeError(error)}`,
    );
  }
};

type SourceRead = { source: string } | { failure: string };

const readDefinitionSource = async (file: string): Promise<SourceRead> => {
  try {
    const info = await stat(file);
    if (!info.isFile()) {
      return { failure: 'not a regular file' };
    }
    return { source: await readFile(file, 'utf8') };
  } catch (error) {
    return { failure: describeError(error) };
  }
};

const validateSource = (
  source: string,
  file: string,
  registries: FlowkitValidationRegistries | undefined,
  deps: ValidateDeps,
): ReportedIssue[] => {
  let parsed: ParsedFlowYaml;
  try {
    parsed = parseYamlWithStructure(source, file);
  } catch (error) {
    if (error instanceof FlowDefinitionYamlError) {
      return error.issues.map((issue) => ({
        path: issue.path,
        line: issue.line,
        column: issue.column,
        code: 'yaml-error',
        message: issue.message,
      }));
    }
    throw error;
  }

  const published = deps.publish({ definition: parsed.definition });
  const issues: FlowkitValidationIssue[] = registries
    ? deps.validate({ published, registries })
    : deps.validate({ published, registries: {} }).filter(
        (issue) => !REGISTRY_DEPENDENT_CODES.has(issue.code),
      );

  return issues.map((issue) => {
    const location = locateYamlPath(parsed.structure, splitYamlPath(issue.path));
    return {
      path: issue.path,
      line: location?.line,
      column: location?.column,
      code: issue.code,
      message: issue.message,
    };
  });
};

/** One file. Any unexpected exception is recorded for this file and the run continues. */
const validateFile = async (
  file: string,
  registries: FlowkitValidationRegistries | undefined,
  deps: ValidateDeps,
): Promise<FileResult> => {
  try {
    const read = await readDefinitionSource(file);
    if ('failure' in read) {
      return {
        path: file,
        kind: 'unreadable',
        issues: [],
        message: `Cannot read definition file "${file}": ${read.failure}`,
      };
    }

    const issues = validateSource(read.source, file, registries, deps);
    return { path: file, kind: issues.length === 0 ? 'valid' : 'invalid', issues };
  } catch (error) {
    return {
      path: file,
      kind: 'internal-error',
      issues: [],
      message: `Internal error validating "${file}": ${describeError(error)}`,
    };
  }
};

const worstExit = (results: readonly FileResult[]): number => {
  if (results.some((result) => result.kind === 'unreadable')) {
    return EXIT_UNREADABLE_DEFINITION;
  }
  if (results.some((result) => result.kind === 'internal-error')) {
    return EXIT_INTERNAL_ERROR;
  }
  if (results.some((result) => result.kind === 'invalid')) {
    return EXIT_ISSUES;
  }
  return EXIT_CLEAN;
};

const reportFatal = (fatal: CliFatal, json: boolean, deps: ValidateDeps): number => {
  deps.stderr(`${fatal.message}\n${fatal.showUsage ? `\n${USAGE}` : ''}`);

  if (json) {
    deps.stdout(
      `${JSON.stringify(
        {
          valid: false,
          error: { code: fatal.code, kind: fatal.kind, message: fatal.message },
          files: [],
        },
        null,
        2,
      )}\n`,
    );
  }

  return fatal.code;
};

const execute = async (
  argv: readonly string[],
  cwd: string,
  deps: ValidateDeps,
  json: boolean,
): Promise<number> => {
  const parsed = parseArgs(argv);

  // Resolve the manifest first so a bad manifest fails fast with a distinct code.
  let registries: FlowkitValidationRegistries | undefined;
  const skipped: string[] = [];

  if (parsed.registries !== undefined) {
    registries = await loadManifest(resolve(cwd, parsed.registries));
  } else {
    skipped.push(SKIPPED_NOTE);
  }

  const candidates: string[] = [];
  const unreadable = new Map<string, string>();

  for (const pattern of parsed.globs) {
    const expansion = await expandPattern(pattern, cwd);

    if (expansion.candidates.length === 0 && expansion.unreadable.length === 0) {
      throw new CliFatal(
        EXIT_NO_FILES_MATCHED,
        'no-files-matched',
        `No definition files matched "${pattern}".`,
      );
    }

    candidates.push(...expansion.candidates);
    for (const failure of expansion.unreadable) {
      unreadable.set(failure.path, failure.message);
    }
  }

  const files = await dedupeByRealPath(candidates);

  const results: FileResult[] = [
    ...[...unreadable].map(([path, message]) => ({
      path,
      kind: 'unreadable' as const,
      issues: [],
      message,
    })),
  ];
  for (const file of files) {
    results.push(await validateFile(file, registries, deps));
  }
  results.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const exitCode = worstExit(results);
  const issueTotal = results.reduce((count, result) => count + result.issues.length, 0);
  const errorCount = results.filter(
    (result) => result.kind === 'unreadable' || result.kind === 'internal-error',
  ).length;

  if (json) {
    deps.stdout(
      `${JSON.stringify(
        {
          valid: exitCode === EXIT_CLEAN,
          skippedChecks: skipped,
          files: results.map((result) => ({
            path: result.path,
            kind: result.kind,
            issues: result.issues.map((issue) => ({
              path: issue.path,
              line: issue.line ?? null,
              column: issue.column ?? null,
              code: issue.code,
              message: issue.message,
            })),
            ...(result.message !== undefined ? { message: result.message } : {}),
          })),
        },
        null,
        2,
      )}\n`,
    );
  } else {
    for (const result of results) {
      if (results.length > 1) {
        deps.stdout(`# ${result.path}\n`);
      }

      for (const issue of result.issues) {
        const location = issue.line === undefined ? '?:?' : `${issue.line}:${issue.column ?? 1}`;
        deps.stdout(`${issue.path}:${location} ${issue.code} ${issue.message}\n`);
      }

      if (result.message !== undefined) {
        deps.stderr(`${result.message}\n`);
      }
    }

    if (skipped.length > 0) {
      deps.stdout(`Skipped: ${skipped.join(', ')}\n`);
    }

    if (issueTotal === 0 && errorCount === 0) {
      deps.stdout(`${results.length} definition file(s) valid.\n`);
    } else {
      deps.stdout(`${issueTotal} issue(s) across ${results.length} file(s).\n`);
      if (errorCount > 0) {
        deps.stdout(`${errorCount} file(s) could not be validated; see stderr.\n`);
      }
    }
  }

  return exitCode;
};

/**
 * Runs `flowkit definitions validate`. Returns the process exit code (see the
 * table at the top of this file). This is the testable core; `src/bin.ts` is a
 * thin shim over it. Every failure is converted to an exit code here, so the
 * caller never sees an exception.
 */
export async function runDefinitionsValidate(
  argv: readonly string[],
  cwd: string = process.cwd(),
  overrides: Partial<ValidateDeps> = {},
): Promise<number> {
  const deps: ValidateDeps = {
    publish: publishDefinition,
    validate: validateFlowkit,
    stdout: (text) => {
      process.stdout.write(text);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
    ...overrides,
  };
  const json = argv.includes('--json');

  try {
    return await execute(argv, cwd, deps, json);
  } catch (error) {
    const fatal =
      error instanceof CliFatal
        ? error
        : new CliFatal(
            EXIT_INTERNAL_ERROR,
            'internal-error',
            `Unexpected error: ${describeError(error)}`,
          );
    return reportFatal(fatal, json, deps);
  }
}
