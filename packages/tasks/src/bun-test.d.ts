declare module 'bun:test' {
  interface Matchers { toBe(expected: unknown): void; toEqual(expected: unknown): void; toContain(expected: unknown): void; toThrow(): void; rejects: Matchers; not: Matchers; }
  interface Expect { (value: unknown): Matchers; }
  export const describe: (name: string, fn: () => void) => void;
  export const expect: Expect;
  export const it: (name: string, fn: () => void | Promise<void>) => void;
}
