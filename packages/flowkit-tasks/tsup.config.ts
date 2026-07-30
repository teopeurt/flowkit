import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  noExternal: ['@noble/hashes', 'zod'],
  external: ['@flowkit/core'],
});
