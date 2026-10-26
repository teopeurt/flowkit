import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';

import { flowSchema } from '@naakwu/flowkit-core';
import type { FlowDefinition } from '@naakwu/flowkit-core';
import {
  isAlias,
  isMap,
  isNode,
  isScalar,
  isSeq,
  LineCounter,
  parseAllDocuments,
  visit,
} from 'yaml';
import type { Alias, Pair, ParsedNode, Range, Scalar } from 'yaml';

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
 * not a regular file, or another I/O failure). Distinguishable from
 * {@link FlowDefinitionYamlError} so callers can treat "cannot open the file"
 * and "the file is not a valid definition" as different failure classes.
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

/**
 * Largest definition source the loader accepts, in UTF-8 bytes. A larger file
 * is rejected before it is parsed, so one request cannot make the loader
 * allocate an unbounded document.
 */
export const MAX_DEFINITION_BYTES = 2 * 1024 * 1024;

/**
 * Upper bound on how many times one anchor may be expanded through aliases.
 * Anchors are legal (a definition may reuse a shared block), but a chain of
 * aliases that refer to aliases would otherwise expand exponentially.
 */
const MAX_ALIAS_COUNT = 1000;

const CORE_TAG_PREFIX = 'tag:yaml.org,2002:';

/**
 * The only explicit tags a definition may carry: the YAML core failsafe and
 * JSON types. Any other tag (`!foo`, `!!js/function`, `!!timestamp`, `!!set`,
 * ...) either names no type the loader knows or changes the value the author
 * wrote, so it is rejected at the tagged node.
 */
const ALLOWED_TAGS: ReadonlySet<string> = new Set(
  ['str', 'int', 'float', 'bool', 'null', 'map', 'seq'].map((name) => `${CORE_TAG_PREFIX}${name}`),
);

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
 * can be rejected explicitly (see {@link auditStructure}).
 *
 * `uniqueKeys` is off because the parser's own duplicate check compares keys
 * with a linear scan per key, which is quadratic on large mappings. Duplicates
 * are detected in {@link auditStructure} instead, in one pass, on the text of
 * each key, which is what the loader actually keeps.
 */
const PARSE_OPTIONS = {
  merge: false,
  schema: 'yaml-1.1',
  uniqueKeys: false,
} as const;

type ParsedDocument = ReturnType<typeof parseAllDocuments>[number];

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

/**
 * Per-mapping index from a key's text to its first pair. It is built once for
 * each mapping and reused, so attributing N keys to one mapping costs O(N)
 * rather than O(N²).
 */
const pairIndexes = new WeakMap<object, Map<string, Pair>>();

const pairIndex = (map: { items: Pair[] }): Map<string, Pair> => {
  const cached = pairIndexes.get(map);
  if (cached) {
    return cached;
  }

  const index = new Map<string, Pair>();
  for (const item of map.items) {
    if (isScalar(item.key)) {
      const text = String(item.key.value);
      if (!index.has(text)) {
        index.set(text, item);
      }
    }
  }

  pairIndexes.set(map, index);
  return index;
};

const findPair = (map: { items: Pair[] }, key: string): Pair | undefined =>
  pairIndex(map).get(key);

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

const childPath = (parent: string, segment: string): string =>
  parent === '' ? segment : `${parent}.${segment}`;

const issuePath = (path: string): string => (path === '' ? '<root>' : path);

const formatPath = (path: ReadonlyArray<string | number>): string =>
  path.length === 0 ? '<root>' : path.map(String).join('.');

/** `!!js/function` for a core-namespace tag, the raw tag otherwise (`!foo`). */
const tagDisplay = (tag: string): string =>
  tag.startsWith(CORE_TAG_PREFIX) ? `!!${tag.slice(CORE_TAG_PREFIX.length)}` : tag;

/**
 * Resolves every alias in the document to the node it names, in one pass. The
 * rule is the parser's own: the last anchor with the same name that appears
 * before the alias in document order.
 */
const aliasTargets = (document: ParsedDocument): Map<Alias, ParsedNode> => {
  const targets = new Map<Alias, ParsedNode>();
  const anchors = new Map<string, ParsedNode>();

  visit(document, {
    Node(_key, node) {
      if (isAlias(node)) {
        const target = anchors.get(node.source);
        if (target) {
          targets.set(node, target);
        }
        return;
      }

      const anchor = (node as { anchor?: string }).anchor;
      if (anchor !== undefined) {
        anchors.set(anchor, node as ParsedNode);
      }
    },
  });

  return targets;
};

interface StructureAudit {
  issues: FlowDefinitionYamlIssue[];
  /** Path of every alias the walk reached, used to attribute alias-limit failures. */
  aliasPaths: Map<Alias, string>;
}

interface WalkEntry {
  node: unknown;
  path: string;
}

/**
 * One linear pass over the document that rejects, at the offending position:
 *
 * - a merge key (`<<`), written plain (a quoted `"<<"` is ordinary text);
 * - a `__proto__` key at any level;
 * - a key whose text collides with an earlier key in the same mapping
 *   (`Map keys must be unique`), compared on the text the loader keeps;
 * - a key that is not text (`null`, `~`, `off`, `1`, a list or a mapping),
 *   which would otherwise be silently renamed;
 * - an explicit tag outside the core allowlist.
 *
 * Aliases are not expanded here: an anchored node is audited where it is
 * defined, so the walk is bounded by the source size, not by alias fan-out.
 */
const auditStructure = (
  root: ParsedNode,
  targets: ReadonlyMap<Alias, ParsedNode>,
  source: string,
  lineCounter: LineCounter,
): StructureAudit => {
  const issues: FlowDefinitionYamlIssue[] = [];
  const aliasPaths = new Map<Alias, string>();
  const stack: WalkEntry[] = [{ node: root, path: '' }];

  const checkTag = (node: ParsedNode, path: string): void => {
    if (!(isScalar(node) || isMap(node) || isSeq(node))) {
      return;
    }

    const tag = node.tag;
    if (tag === undefined || ALLOWED_TAGS.has(tag)) {
      return;
    }

    issues.push({
      path: issuePath(path),
      message:
        `YAML tag ${tagDisplay(tag)} is not allowed. Definitions use plain values; ` +
        'only the core tags !!str, !!int, !!float, !!bool, !!null, !!map and !!seq are accepted, ' +
        'because any other tag changes the value the author wrote.',
      ...(lineCol(lineCounter, node.range) ?? {}),
    });
  };

  const typeLabel = (value: unknown): string => {
    if (value === null) return 'null';
    if (typeof value === 'boolean') return 'a boolean';
    if (typeof value === 'number') return 'a number';
    return 'a non-text value';
  };

  /** Audits one pair; returns the child to walk, or undefined when there is none. */
  const auditPair = (
    pair: Pair,
    mapPath: string,
    mapNode: ParsedNode,
    seen: Set<string>,
  ): WalkEntry | undefined => {
    const keyNode = pair.key as ParsedNode | null | undefined;

    if (keyNode == null) {
      issues.push({
        path: issuePath(mapPath),
        message: 'A mapping entry has no key; write the key as quoted text, for example "name".',
        ...(lineCol(lineCounter, mapNode.range) ?? {}),
      });
      return undefined;
    }

    if (isAlias(keyNode)) {
      aliasPaths.set(keyNode, mapPath);
    } else {
      checkTag(keyNode, mapPath);
    }

    const keyTarget = isAlias(keyNode) ? targets.get(keyNode) : keyNode;
    if (keyTarget === undefined) {
      // An unresolved alias is a parse error, which has already been reported.
      return undefined;
    }

    const keyWritten = keyNode.range ? source.slice(keyNode.range[0], keyNode.range[1]) : '';
    if (!isScalar(keyTarget)) {
      issues.push({
        path: issuePath(mapPath),
        message: 'Mapping keys must be plain text; a list or a mapping cannot be a key.',
        ...(lineCol(lineCounter, keyNode.range) ?? {}),
      });
      return { node: pair.value, path: childPath(mapPath, '<complex key>') };
    }

    const value: unknown = keyTarget.value;
    const isMergeKey =
      isScalar(keyNode) && keyNode.type === 'PLAIN' && (value === '<<' || typeof value === 'symbol');
    const label = typeof value === 'symbol' ? '<<' : String(value);
    const keyPath = childPath(mapPath, label);
    const position = lineCol(lineCounter, keyNode.range) ?? {};

    if (seen.has(label)) {
      issues.push({
        path: keyPath,
        message:
          `Map keys must be unique: "${label}" is already a key in this mapping. ` +
          'Keys are compared by their text, so 1 and "1", or yes and "true", are the same key.',
        ...position,
      });
    } else {
      seen.add(label);

      if (isMergeKey) {
        issues.push({
          path: issuePath(mapPath),
          message: 'Merge keys (`<<`) are not allowed; declare every field explicitly.',
          ...position,
        });
      } else if (typeof value !== 'string') {
        issues.push({
          path: keyPath,
          message:
            `Mapping key ${keyWritten} is not text (YAML reads it as ${typeLabel(value)}). ` +
            `Put the key in quotes, for example ${JSON.stringify(keyWritten)}, ` +
            'so its name is kept exactly as written.',
          ...position,
        });
      } else if (value === '__proto__') {
        issues.push({
          path: keyPath,
          message:
            'Key "__proto__" is not allowed: it would be dropped silently. Rename this key.',
          ...position,
        });
      }
    }

    return { node: pair.value, path: keyPath };
  };

  while (stack.length > 0) {
    const { node, path } = stack.pop() as WalkEntry;

    if (isAlias(node)) {
      aliasPaths.set(node, path);
      continue;
    }

    if (!isNode(node)) {
      continue;
    }

    const parsed = node as ParsedNode;
    checkTag(parsed, path);

    const children: WalkEntry[] = [];
    if (isMap(parsed)) {
      const seen = new Set<string>();
      for (const pair of parsed.items) {
        const child = auditPair(pair, path, parsed, seen);
        if (child) {
          children.push(child);
        }
      }
    } else if (isSeq(parsed)) {
      parsed.items.forEach((item, index) => {
        children.push({ node: item, path: `${path}[${index}]` });
      });
    }

    // Pushed in reverse so the walk pops children in document order.
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]);
    }
  }

  return { issues, aliasPaths };
};

/**
 * Rejects a `version` whose raw source is not a plain decimal integer. YAML 1.1
 * reads `010` as 8, `0x0A` as 10, `1:00` as 60, `1_0` as 10, `1e1` as 10, `2.0`
 * as 2 and rounds integers above 2^53, so the number the author pinned would not
 * be the one written. The check reads the source text, so it sees the form the
 * author wrote. Quoted and other non-number values are left to the schema,
 * which already rejects them with a type error.
 */
const versionIssue = (
  contents: ParsedNode,
  targets: ReadonlyMap<Alias, ParsedNode>,
  source: string,
  lineCounter: LineCounter,
): FlowDefinitionYamlIssue | undefined => {
  if (!isMap(contents)) {
    return undefined;
  }

  const pair = findPair(contents, 'version');
  const written = pair?.value as ParsedNode | null | undefined;
  if (!written) {
    return undefined;
  }

  const resolved = isAlias(written) ? targets.get(written) : written;
  if (!isScalar(resolved) || typeof resolved.value !== 'number' || !resolved.range) {
    return undefined;
  }

  const raw = source.slice(resolved.range[0], resolved.range[1]);
  if (/^(0|[1-9][0-9]*)$/.test(raw) && Number.isSafeInteger(Number(raw))) {
    return undefined;
  }

  return {
    path: 'version',
    message:
      'version must be a plain decimal integer (for example 1 or 12). YAML number forms such as ' +
      '010, 0x0A, 1_0, 1e1, 1:00 and 2.0 are read as a different number, so they are not accepted.',
    ...(lineCol(lineCounter, written.range) ?? {}),
  };
};

/**
 * Parser warnings are surfaced as typed issues. An unresolved tag is skipped
 * here because {@link auditStructure} reports every explicit tag with a more
 * precise message at the tagged node.
 */
const warningIssues = (
  document: ParsedDocument,
  lineCounter: LineCounter,
): FlowDefinitionYamlIssue[] =>
  document.warnings
    .filter((warning) => !warning.message.startsWith('Unresolved tag'))
    .map((warning) => {
      const position = warning.linePos?.[0] ?? lineCounter.linePos(warning.pos[0]);
      return {
        path: '<document>',
        message: warning.message.split('\n')[0].replace(/ at line \d+, column \d+:$/, ''),
        line: position.line,
        column: position.col,
      };
    });

const sourceBytes = (source: string): number =>
  // UTF-8 uses at most three bytes per UTF-16 code unit, so a source this short is under the cap.
  source.length <= MAX_DEFINITION_BYTES / 3
    ? source.length
    : new TextEncoder().encode(source).byteLength;

const oversizeError = (bytes: number, sourceName?: string): FlowDefinitionYamlError =>
  new FlowDefinitionYamlError(
    [
      {
        path: '<document>',
        message:
          `Definitions are limited to 2 MiB (${MAX_DEFINITION_BYTES} bytes); ` +
          `this source is ${bytes} bytes. Split the definition or remove content that is not needed.`,
        line: 1,
        column: 1,
      },
    ],
    sourceName,
  );

/**
 * Parses `source` into a `FlowDefinition`, throwing
 * {@link FlowDefinitionYamlError} with line/column-bearing issues for every
 * reason the document cannot become a valid definition. The exact set of
 * structural rejections is:
 *
 * - a source over {@link MAX_DEFINITION_BYTES} (2 MiB);
 * - malformed YAML (the parser's own errors, attributed to their position);
 * - a document the parser cannot finish at all — a stack overflow from deeply
 *   nested or misindented input — reported once at the document root;
 * - an empty stream or more than one document — a file holds exactly one
 *   definition because `id`/`version` live in the document, not the file name;
 * - a merge key (`<<`) — a definition must declare every field it sets;
 * - a `__proto__` key, a key that collides with another key by its text, or a
 *   key that is not text (for example `null`, `~`, `off`, `1`);
 * - an explicit tag outside the core allowlist, or any other parser warning;
 * - a `version` that is not a plain decimal integer in its source form;
 * - an alias chain that expands beyond the alias limit;
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
  try {
    return parseYamlStructure(source, sourceName);
  } catch (error) {
    // The `yaml` parser recurses between `blockMap` and `step`, so a
    // pathological document (a flood of misindented lines, very deep nesting)
    // can exhaust the call stack before the parser produces a positioned
    // error. A stack overflow carries no source position and is not a
    // FlowDefinitionYamlError, so report it as a whole-document syntax failure
    // rather than leaking a RangeError to callers. Only RangeError is
    // converted; every other error, including our own, passes through.
    if (!(error instanceof RangeError)) throw error;
    throw new FlowDefinitionYamlError(
      [
        {
          path: '<document>',
          message:
            'The document is too deeply or badly malformed to parse; fix the first syntax errors in the source.',
          line: 1,
          column: 1,
        },
      ],
      sourceName,
    );
  }
}

const parseYamlStructure = (source: string, sourceName?: string): ParsedFlowYaml => {
  const bytes = sourceBytes(source);
  if (bytes > MAX_DEFINITION_BYTES) {
    throw oversizeError(bytes, sourceName);
  }

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
  const targets = aliasTargets(document);
  const audit = auditStructure(contents, targets, source, lineCounter);

  const structureIssues: FlowDefinitionYamlIssue[] = [
    ...audit.issues,
    ...warningIssues(document, lineCounter),
  ];
  const version = versionIssue(contents, targets, source, lineCounter);
  if (version) {
    structureIssues.push(version);
  }

  if (structureIssues.length > 0) {
    throw new FlowDefinitionYamlError(structureIssues, sourceName);
  }

  // Record the first alias whose expansion breaks the limit, so the failure
  // can name its line. Hooks are installed on this document only.
  let failedAlias: Alias | undefined;
  for (const alias of audit.aliasPaths.keys()) {
    const hooked = alias as unknown as {
      toJSON: (arg: unknown, ctx: unknown) => unknown;
    };
    const original = hooked.toJSON.bind(alias);
    hooked.toJSON = (arg: unknown, ctx: unknown): unknown => {
      try {
        return original(arg, ctx);
      } catch (error) {
        failedAlias ??= alias;
        throw error;
      }
    };
  }

  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: MAX_ALIAS_COUNT });
  } catch (error) {
    const issue: FlowDefinitionYamlIssue = failedAlias
      ? {
          path: issuePath(audit.aliasPaths.get(failedAlias) ?? ''),
          message:
            `Alias *${failedAlias.source} expands too many times ` +
            `(more than ${MAX_ALIAS_COUNT} uses of one anchor); write the shared value out where it is used.`,
          ...(lineCol(lineCounter, failedAlias.range) ?? {}),
        }
      : {
          path: '<document>',
          message: error instanceof Error ? error.message : String(error),
          line: 1,
          column: 1,
        };
    throw new FlowDefinitionYamlError([issue], sourceName);
  }

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
};

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
 * Reads a definition file from disk and parses it. I/O failures throw
 * {@link FlowDefinitionFileError}; parse/validation failures throw
 * {@link FlowDefinitionYamlError}. Parsing happens here — outside any workflow
 * sandbox — so a workflow never re-reads a definition during replay.
 */
export async function loadFlowFile(path: string): Promise<FlowDefinition> {
  const source = await readDefinitionSource(path);
  return parseFlowYaml(source, { sourceName: path });
}

/**
 * Opens the path and checks the open descriptor before reading. A FIFO, socket,
 * device or directory is rejected instead of being read: a read on a FIFO with
 * no writer blocks forever. `O_NONBLOCK` keeps `open` itself from waiting for a
 * writer; the descriptor's own type check then rejects the file. Checking the
 * descriptor, rather than the path, also means the file that was checked is the
 * file that is read.
 */
const readDefinitionSource = async (path: string): Promise<string> => {
  const handle: FileHandle = await open(
    path,
    constants.O_RDONLY | (constants.O_NONBLOCK ?? 0),
  ).catch((cause: unknown) => {
    throw new FlowDefinitionFileError(path, cause);
  });

  try {
    const info = await handle.stat();
    if (!info.isFile()) {
      throw new FlowDefinitionFileError(
        path,
        new Error('not a regular file; a definition must be a regular file, not a directory, FIFO, socket or device'),
      );
    }

    if (info.size > MAX_DEFINITION_BYTES) {
      throw oversizeError(info.size, path);
    }

    return await handle.readFile({ encoding: 'utf8' });
  } catch (cause) {
    if (cause instanceof FlowDefinitionFileError || cause instanceof FlowDefinitionYamlError) {
      throw cause;
    }
    throw new FlowDefinitionFileError(path, cause);
  } finally {
    await handle.close();
  }
};

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
