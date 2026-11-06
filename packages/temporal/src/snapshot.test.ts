import { describe, expect, test } from 'bun:test';

import type { FlowDefinition } from '@teopeurt/flowkit-core';

import {
  canonicalizeJson,
  hashCanonicalJson,
  publishDefinition,
  SnapshotError,
  verifyPublishedDefinition,
} from './snapshot';

const definition = (): FlowDefinition => ({
  id: 'snapshot-demo',
  version: 1,
  roles: ['author', 'reviewer'],
  initialStage: 'draft',
  stages: {
    draft: {
      pendingRole: 'author',
      actions: {
        submit: { to: 'review', policy: 'authorOnly' },
      },
    },
    review: {
      pendingRole: 'reviewer',
      actions: {
        publish: { to: 'published', kind: 'system' },
      },
    },
    published: { final: true },
  },
});

describe('canonicalizeJson', () => {
  test('produces identical output for different key insertion orders', () => {
    const a = canonicalizeJson({ one: 1, two: { x: true, y: [1, 2] }, three: '3' });
    const b = canonicalizeJson({ three: '3', two: { y: [1, 2], x: true }, one: 1 });

    expect(a).toBe(b);
    expect(hashCanonicalJson(a)).toBe(hashCanonicalJson(b));
  });

  test('array order changes the hash', () => {
    expect(hashCanonicalJson(canonicalizeJson([1, 2, 3])) === hashCanonicalJson(canonicalizeJson([3, 2, 1]))).toBe(false);
  });

  test('any semantic change changes the hash', () => {
    const base = publishDefinition({ definition: definition() });
    const changed = publishDefinition({
      definition: { ...definition(), version: 2 },
    });

    expect(base.definitionHash === changed.definitionHash).toBe(false);
  });

  test.each([
    ['undefined', { value: undefined }],
    ['bigint', { value: 1n }],
    ['function', { value: () => 1 }],
    ['symbol', { value: Symbol('x') }],
    ['NaN', { value: Number.NaN }],
    ['Infinity', { value: Number.POSITIVE_INFINITY }],
    ['class instance', new Date('2026-01-01T00:00:00.000Z')],
  ])('rejects %s values', (_kind: string, value: unknown) => {
    expect(() => canonicalizeJson(value)).toThrow(SnapshotError);
  });

  test('rejects undefined nested inside accepted objects', () => {
    expect(() => canonicalizeJson({ outer: { inner: undefined } })).toThrow(SnapshotError);
  });
});

describe('publishDefinition', () => {
  test('normalizes absent optional definition fields before hashing', () => {
    const input = definition();
    input.stages.draft.entry = undefined;

    const published = publishDefinition({ definition: input });

    expect(/^sha256:[0-9a-f]{64}$/.test(published.definitionHash)).toBe(true);
  });

  test('returns a detached, deeply frozen snapshot', () => {
    const input = definition();
    const published = publishDefinition({ definition: input });

    input.stages.draft.actions!.submit.policy = 'mutated';
    (input.stages.draft as { pendingRole?: string | null }).pendingRole = 'mutated';

    expect(published.definitionSnapshot.stages.draft.actions?.submit.policy).toBe('authorOnly');
    expect(published.definitionSnapshot.stages.draft.pendingRole).toBe('author');
    expect(Object.isFrozen(published.definitionSnapshot)).toBe(true);
    expect(Object.isFrozen(published.definitionSnapshot.stages)).toBe(true);
    expect(Object.isFrozen(published.definitionSnapshot.stages.draft)).toBe(true);
    expect(Object.isFrozen(published.definitionSnapshot.stages.draft.actions)).toBe(true);
    expect(Object.isFrozen(published.definitionSnapshot.stages.draft.actions?.submit)).toBe(true);
    expect(Object.isFrozen(published.definitionSnapshot.roles)).toBe(true);
  });

  test('hashes with exactly 64 lowercase hex characters after sha256:', () => {
    const { definitionHash } = publishDefinition({ definition: definition() });

    expect(/^sha256:[0-9a-f]{64}$/.test(definitionHash)).toBe(true);
  });

  test('hash matches an independently canonicalized rendering', () => {
    const published = publishDefinition({ definition: definition() });

    expect(published.definitionHash).toBe(
      hashCanonicalJson(canonicalizeJson(published.definitionSnapshot)),
    );
  });
});

describe('verifyPublishedDefinition', () => {
  test('accepts a valid published pair', () => {
    const published = publishDefinition({ definition: definition() });

    verifyPublishedDefinition(published);
  });

  test('rejects a valid snapshot paired with another definition hash', () => {
    const published = publishDefinition({ definition: definition() });
    const other = publishDefinition({ definition: { ...definition(), id: 'other-flow' } });

    expect(() =>
      verifyPublishedDefinition({
        definitionSnapshot: published.definitionSnapshot,
        definitionHash: other.definitionHash,
      }),
    ).toThrow(SnapshotError);
  });

  test('rejects malformed hashes', () => {
    const published = publishDefinition({ definition: definition() });
    const malformed = [
      'sha256:xyz',
      `sha256:${'A'.repeat(64)}`,
      `sha256:${'0'.repeat(63)}`,
      'md5:00000000000000000000000000000000',
    ];

    for (const definitionHash of malformed) {
      expect(() =>
        verifyPublishedDefinition({
          definitionSnapshot: published.definitionSnapshot,
          definitionHash: definitionHash as `sha256:${string}`,
        }),
      ).toThrow(SnapshotError);
    }
  });
});
