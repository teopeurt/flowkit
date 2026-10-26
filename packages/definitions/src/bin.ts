#!/usr/bin/env node
import { runDefinitionsValidate } from './cli';

const main = async (): Promise<void> => {
  process.exitCode = await runDefinitionsValidate(process.argv.slice(2));
};

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
