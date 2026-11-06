import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { defineFlow, flowSchema } from '@teopeurt/flowkit-core';
import type { FlowDefinition } from '@teopeurt/flowkit-core';

import type { DefinitionHash, PublishedFlowDefinition } from './contracts';

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/**
 * Deterministic canonical JSON: object keys sorted recursively (by UTF-16
 * code unit, never locale-sensitive), array order preserved, only JSON
 * primitives accepted. `undefined`, bigint, function, symbol, non-finite
 * numbers, and non-plain objects are rejected so a hash never depends on
 * platform-specific serialization.
 */
export function canonicalizeJson(value: unknown): string {
  const write = (current: unknown): string => {
    if (current === null) {
      return 'null';
    }

    switch (typeof current) {
      case 'string':
        return JSON.stringify(current);
      case 'boolean':
        return current ? 'true' : 'false';
      case 'number': {
        if (!Number.isFinite(current)) {
          throw new SnapshotError('Canonical JSON rejects non-finite numbers.');
        }

        return JSON.stringify(current);
      }
      case 'object': {
        if (Array.isArray(current)) {
          return `[${current.map((item) => write(item)).join(',')}]`;
        }

        if (!isPlainObject(current)) {
          throw new SnapshotError('Canonical JSON only accepts plain objects.');
        }

        const entries = Object.keys(current)
          .sort()
          .map((key) => {
            const item = current[key];

            if (item === undefined) {
              throw new SnapshotError(`Canonical JSON rejects undefined at key "${key}".`);
            }

            return `${JSON.stringify(key)}:${write(item)}`;
          });

        return `{${entries.join(',')}}`;
      }
      default:
        throw new SnapshotError(`Canonical JSON rejects ${typeof current} values.`);
    }
  };

  return write(value);
}

/**
 * Self-contained UTF-8 encoder. The Temporal workflow sandbox does not
 * guarantee `TextEncoder`, and determinism must not depend on it.
 */
const encodeUtf8 = (input: string): Uint8Array => {
  const bytes: number[] = [];

  for (let index = 0; index < input.length; index += 1) {
    let code = input.charCodeAt(index);

    if (code >= 0xd800 && code <= 0xdbff && index + 1 < input.length) {
      const next = input.charCodeAt(index + 1);

      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      }
    }

    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }

  return Uint8Array.from(bytes);
};

export function hashCanonicalJson(canonical: string): DefinitionHash {
  return `sha256:${bytesToHex(sha256(encodeUtf8(canonical)))}`;
}

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }

    Object.freeze(value);
  }

  return value;
};

/**
 * Validate a definition, detach it into a deeply frozen JSON clone, and
 * compute its deterministic content hash. Runs before workflow start (client
 * side); the resulting pair is the workflow's immutable input.
 */
export function publishDefinition(args: {
  definition: FlowDefinition;
}): PublishedFlowDefinition {
  const parsed = defineFlow(args.definition);
  // Zod preserves explicitly supplied optional `undefined` fields. They have
  // no JSON representation, so remove them only after strict schema parsing.
  const normalized = JSON.parse(JSON.stringify(parsed)) as FlowDefinition;
  const canonical = canonicalizeJson(normalized);
  const snapshot = deepFreeze(JSON.parse(canonical)) as FlowDefinition;

  return {
    definitionSnapshot: snapshot,
    definitionHash: hashCanonicalJson(canonical),
  };
}

/**
 * Re-verify a published pair. Called inside the workflow before any handler
 * is registered: the hash must be well-formed, the snapshot must hash back to
 * it exactly, and the snapshot must still satisfy the strict schema.
 */
export function verifyPublishedDefinition(published: PublishedFlowDefinition): void {
  if (!published || typeof published !== 'object') {
    throw new SnapshotError('Published definition must be an object.');
  }

  const { definitionSnapshot, definitionHash } = published;

  if (typeof definitionHash !== 'string' || !HASH_PATTERN.test(definitionHash)) {
    throw new SnapshotError(
      'Definition hash must be "sha256:" followed by 64 lowercase hex characters.',
    );
  }

  const actual = hashCanonicalJson(canonicalizeJson(definitionSnapshot));

  if (actual !== definitionHash) {
    throw new SnapshotError('Definition snapshot does not match its content hash.');
  }

  const parsed = flowSchema.safeParse(definitionSnapshot);

  if (!parsed.success) {
    throw new SnapshotError('Definition snapshot fails schema validation.');
  }
}
