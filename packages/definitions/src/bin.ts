#!/usr/bin/env node
import { EXIT_INTERNAL_ERROR, printHelpOrVersion, runDefinitionsValidate } from './cli';

// `runDefinitionsValidate` converts every failure into an exit code itself. This
// catch is a last resort for an error thrown while reporting, and it uses the
// internal-error code so it is never confused with a validation issue (1).
const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  if (printHelpOrVersion(argv, (text) => process.stdout.write(text))) {
    process.exitCode = 0;
    return;
  }
  process.exitCode = await runDefinitionsValidate(argv);
};

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = EXIT_INTERNAL_ERROR;
});
