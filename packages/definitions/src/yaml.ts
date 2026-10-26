import { readFile } from 'node:fs/promises';

import { flowSchema } from '@naakwu/flowkit-core';
import type { FlowDefinition } from '@naakwu/flowkit-core';
import {
  isMap,
  isScalar,
  isSeq,
  LineCounter,
  parseAllDocuments,
} from 'yaml';
import type { Pair, ParsedNode, Range, Scalar } from 'yaml';

/**
 * One location (line, column) inside a YAML source, both 1-indexed.
 */
export interface FlowDefinitionYamlIssueLocation {
  line: number;
  column: number;
}

/**
 * One rejection, tied to a YAML position when the offending construct can be
 * named. `path` is the dot-joined key path (for example
 * `stages.review.actions.approve.to`).
 */
export interface FlowDefinitionYamlIssue {
  path: string;
  message: string;
  line?: number;
  column?: number;
}

/**
 * Thrown when a YAML source cannot be turned into a valid `FlowDefinition`:
 * malformed YAML, a multi-document stream, a merge key, or a document that
 * `flowSchema` rejects. Every issue carries a path and, where the source can
 * name the offending line, a 1-indexed line/column.
 */
export class FlowDefinitionYamlError extends Error {
  constructor(
    readonly issues: readonly FlowDefinitionYamlIssue[],
    readonly sourceName?: string,
  ) {
    super(formatIssues(issues, sourceName));
    this.name = 'FlowDefinitionYamlError';
  }
}

/**
 * Thrown when a definition file cannot be read (missing, permission denied,
 * or another I/O failure). Distinguishable from {@link FlowDefinitionYamlError}
 * so callers can treat "cannot open the file" and "the file is not a valid
 * definition" as different failure classes.
 */
export class FlowDefinitionFileError extends Error {
  constructor(
    readonly path: string,
    readonly cause: unknown,
  ) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Cannot read definition file "${path}": ${detail}`);
    this.name = 'FlowDefinitionFileError';
  }
}

/**
 * Options shared by every entry point that parses YAML.
 */
export interface ParseFlowYamlOptions {
  /** Used in error messages to name the offending input. */
  sourceName?: string;
}

/**
 * The raw YAML structure plus a line counter, reused to map a post-parse issue
 * path back to a line/column. Kept internal to the package (the CLI consumes it
 * through {@link parseYamlWithStructure}).
 */
export interface YamlStructure {
  sourceName?: string;
  contents: ParsedNode;
  lineCounter: LineCounter;
}

/**
 * A parsed and validated definition together with the structure needed to
 * locate issue paths afterwards.
 */
export interface ParsedFlowYaml {
  definition: FlowDefinition;
  structure: YamlStructure;
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * YAML is parsed with the YAML 1.1 schema. The authoring contract
 * (`docs/definitions-yaml.md` §4) names the YAML 1.1 truthiness traps as the
 * reason: `yes`/`no`/`on`/`off` become booleans and `1e3`/`007` become numbers,
 * so a word-boolean or a numeric-looking scalar written where the strict schema
 * expects a string fails validation instead of being silently accepted as a
 * string. Merge keys are disabled here so `<<` survives as an ordinary key and
 * can be rejected explicitly (see {@link collectMergeKeys}).
 */
const PARSE_OPTIONS = {
  merge: false,
  schema: 'yaml-1.1',
} as const;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const formatIssues = (issues: readonly FlowDefinitionYamlIssue[], sourceName?: string): string => {
  const header = sourceName === undefined ? '' : `${sourceName}: `;
  return issues
    .map((issue) => {
      const location =
        issue.line === undefined ? issue.path : `${issue.path}:${issue.line}:${issue.column ?? 1}`;
      return `${header}${location} ${issue.message}`;
    })
    .join('\n');
};

const lineCol = (
  lineCounter: LineCounter,
  range: Range | null | undefined,
): FlowDefinitionYamlIssueLocation | undefined => {
  if (!range) {
    return undefined;
  }

  const position = lineCounter.linePos(range[0]);
  return { line: position.line, column: position.col };
};

const findPair = (map: { items: Pair[] }, key: string): Pair | undefined =>
  map.items.find((item) => isScalar(item.key) && String(item.key.value) === key);

/**
 * Returns the node at `path` (a Zod path: map keys as strings, sequence indices
 * as numbers). When a segment is missing the node for the deepest found prefix
 * is returned instead, so a missing required field is still attributed to the
 * object that should have held it.
 */
const locateNode = (
  root: ParsedNode,
  path: ReadonlyArray<string | number>,
): ParsedNode | undefined => {
  let current: ParsedNode | null | undefined = root;

  for (const segment of path) {
    if (current == null) {
      return undefined;
    }

    if (isMap(current)) {
      const pair = findPair(current, String(segment));
      if (!pair) {
        return current;
      }
      current = pair.value as ParsedNode | null;
    } else if (isSeq(current)) {
      const index = typeof segment === 'number' ? segment : Number(segment);
      if (!Number.isInteger(index)) {
        return current;
      }
      current = current.items[index] ?? current;
    } else {
      return current;
    }
  }

  return current ?? undefined;
};

const keyName = (node: ParsedNode): string =>
  isScalar(node) ? (typeof node.value === 'symbol' ? '<<' : String(node.value)) : '<non-scalar>';

/**
 * The YAML 1.1 schema resolves `<<` into a special symbol-valued scalar rather
 * than a plain string, so a merge key is identified by either form.
 */
const isMergeKey = (key: unknown): boolean => {
  if (!isScalar(key)) {
    return false;
  }

  const value = key.value;
  return value === '<<' || typeof value === 'symbol';
};

/**
 * Collects every `<<` merge key in the document. Merge keys are rejected so a
 * definition states every field it actually sets: a merged block hides the
 * effective shape from review and makes it possible to change a definition's
 * content without any of the changed fields appearing under the stage that owns
 * them.
 */
const collectMergeKeys = (
  node: ParsedNode | null | undefined,
  issues: FlowDefinitionYamlIssue[],
  lineCounter: LineCounter,
  path: string,
): void => {
  if (node == null) {
    return;
  }

  if (isMap(node)) {
    for (const item of node.items) {
      if (isMergeKey(item.key)) {
        issues.push({
          path: path === '' ? '<root>' : path,
          message: 'Merge keys (`<<`) are not allowed; declare every field explicitly.',
          ...(lineCol(lineCounter, item.key.range) ?? {}),
        });
      }
      collectMergeKeys(item.value, issues, lineCounter, childPath(path, keyName(item.key)));
    }
  } else if (isSeq(node)) {
    node.items.forEach((value, index) =>
      collectMergeKeys(value, issues, lineCounter, `${path}[${index}]`),
    );
  }
};

const childPath = (parent: string, segment: string): string =>
  parent === '' ? segment : `${parent}.${segment}`;

const formatPath = (path: ReadonlyArray<string | number>): string =>
  path.length === 0 ? '<root>' : path.map(String).join('.');

/**
 * Maps a single `flowSchema` issue (a Zod issue) to one or more YAML issues with
 * line/column attached. Unknown-key issues are expanded to one issue per unknown
 * key so each is attributed to its own line.
 */
const zodIssueToYamlIssues = (
  issue: { code: string; path: Array<string | number>; message: string; keys?: string[] },
  root: ParsedNode,
  lineCounter: LineCounter,
): FlowDefinitionYamlIssue[] => {
  if (issue.code === 'unrecognized_keys') {
    const parent = locateNode(root, issue.path);
    const keys = issue.keys ?? [];

    if (parent && isMap(parent) && keys.length > 0) {
      return keys.map((key) => {
        const pair = findPair(parent, key);
        return {
          path: formatPath([...issue.path, key]),
          message: `Unrecognized key "${key}".`,
          ...(lineCol(lineCounter, (pair?.key as Scalar | undefined)?.range ?? parent.range) ?? {}),
        };
      });
    }
  }

  const node = locateNode(root, issue.path);
  return [
    {
      path: formatPath(issue.path),
      message: issue.message,
      ...(lineCol(lineCounter, node?.range) ?? {}),
    },
  ];
};

/**
 * Parses `source` into a `FlowDefinition`, throwing
 * {@link FlowDefinitionYamlError} with line/column-bearing issues for every
 * reason the document cannot become a valid definition. The exact set of
 * structural rejections is:
 *
 * - malformed YAML (the parser's own errors, attributed to their position);
 * - an empty stream or more than one document — a file holds exactly one
 *   definition because `id`/`version` live in the document, not the file name;
 * - a merge key (`<<`) — a definition must declare every field it sets;
 * - anything `flowSchema` rejects — unknown fields, wrong scalar types, and the
 *   refinements the JSON Schema cannot express.
 *
 * Anchors and aliases are expanded by the parser before this returns, so the
 * returned definition carries no alias identity into the hash.
 */
export function parseFlowYaml(
  source: string,
  options: ParseFlowYamlOptions = {},
): FlowDefinition {
  return parseYamlWithStructure(source, options.sourceName).definition;
}

/**
 * Like {@link parseFlowYaml}, but also returns the raw YAML structure and line
 * counter so a caller (the CLI) can attribute later semantic-issue paths back to
 * their lines without re-parsing.
 */
export function parseYamlWithStructure(
  source: string,
  sourceName?: string,
): ParsedFlowYaml {
  const lineCounter = new LineCounter();
  const documents = parseAllDocuments(source, { ...PARSE_OPTIONS, lineCounter });

  const parseIssues: FlowDefinitionYamlIssue[] = [];
  for (const document of documents) {
    for (const error of document.errors) {
      const position = error.linePos?.[0];
      parseIssues.push({
        path: '<document>',
        message: error.message,
        line: position?.line,
        column: position?.col,
      });
    }
  }

  if (parseIssues.length > 0) {
    throw new FlowDefinitionYamlError(parseIssues, sourceName);
  }

  if (documents.length === 0) {
    throw new FlowDefinitionYamlError(
      [
        {
          path: '<document>',
          message: 'The file contains no YAML document; a definition is required.',
          line: 1,
          column: 1,
        },
      ],
      sourceName,
    );
  }

  if (documents.length > 1) {
    const second = documents[1];
    throw new FlowDefinitionYamlError(
      [
        {
          path: '<document>',
          message:
            'Multiple YAML documents are not allowed; a definition file contains exactly one document.',
          ...(lineCol(lineCounter, second.range) ?? {}),
        },
      ],
      sourceName,
    );
  }

  const document = documents[0];

  if (document.contents === null) {
    throw new FlowDefinitionYamlError(
      [
        {
          path: '<document>',
          message: 'The document is empty; a definition is required.',
          line: 1,
          column: 1,
        },
      ],
      sourceName,
    );
  }

  const contents = document.contents;

  const mergeIssues: FlowDefinitionYamlIssue[] = [];
  collectMergeKeys(contents, mergeIssues, lineCounter, '');
  if (mergeIssues.length > 0) {
    throw new FlowDefinitionYamlError(mergeIssues, sourceName);
  }

  const value: unknown = document.toJS();
  const parsed = flowSchema.safeParse(value);

  if (!parsed.success) {
    const issues = parsed.error.issues.flatMap((issue) =>
      zodIssueToYamlIssues(
        {
          code: issue.code,
          path: issue.path.map((segment) =>
            typeof segment === 'number' ? segment : String(segment),
          ),
          message: issue.message,
          keys: (issue as { keys?: string[] }).keys,
        },
        contents,
        lineCounter,
      ),
    );

    throw new FlowDefinitionYamlError(issues, sourceName);
  }

  return {
    definition: parsed.data,
    structure: { sourceName, contents, lineCounter },
  };
}

/**
 * Reads a definition file from disk and parses it. I/O failures throw
 * {@link FlowDefinitionFileError}; parse/validation failures throw
 * {@link FlowDefinitionYamlError}. Parsing happens here — outside any workflow
 * sandbox — so a workflow never re-reads a definition during replay.
 */
export async function loadFlowFile(path: string): Promise<FlowDefinition> {
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch (cause) {
    throw new FlowDefinitionFileError(path, cause);
  }

  return parseFlowYaml(source, { sourceName: path });
}

/**
 * Splits a dot-joined issue path (as emitted by `validateFlowkit`) back into
 * path segments. A numeric segment is returned as a number so sequence indices
 * resolve; map lookups stringify either form, so a map key that happens to look
 * numeric still resolves.
 */
export const splitYamlPath = (path: string): Array<string | number> => {
  if (path === '' || path === '<root>') {
    return [];
  }

  return path.split('.').map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
};

/**
 * Attributes a path to its line/column in a parsed structure. Returns
 * `undefined` when the path cannot be located (for example a synthetic path that
 * has no corresponding node).
 */
export const locateYamlPath = (
  structure: YamlStructure,
  path: ReadonlyArray<string | number>,
): FlowDefinitionYamlIssueLocation | undefined =>
  lineCol(structure.lineCounter, locateNode(structure.contents, path)?.range);

/** Guard used by the CLI to tell a malformed document from an unreadable file. */
export const isYamlError = (error: unknown): error is FlowDefinitionYamlError =>
  error instanceof FlowDefinitionYamlError;

export { isPlainObject };
