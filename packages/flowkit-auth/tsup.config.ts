import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/roles/index.ts', 'src/better-auth/index.ts', 'src/nest/index.ts', 'src/testing/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: false,
  external: ['better-auth', '@nestjs/common', '@nestjs/core', 'reflect-metadata'],
});
