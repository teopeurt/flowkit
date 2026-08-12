declare module 'bun:test' {
  interface Matchers {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toContainEqual(expected: unknown): void;
  }

  interface Expect {
    (value: unknown): Matchers;
    objectContaining<T extends object>(value: T): T;
  }

  interface Test {
    (name: string, fn: () => void | Promise<void>): void;
    each(
      cases: ReadonlyArray<ReadonlyArray<unknown>>,
    ): (name: string, fn: (...args: any[]) => void | Promise<void>) => void;
  }

  export const describe: (name: string, fn: () => void) => void;
  export const expect: Expect;
  export const test: Test;
}
