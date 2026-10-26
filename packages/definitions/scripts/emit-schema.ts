import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FLOW_DEFINITION_SCHEMA_RELATIVE_PATH,
  serializeFlowDefinitionSchema,
} from './build-schema';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(packageRoot, FLOW_DEFINITION_SCHEMA_RELATIVE_PATH);
const document = serializeFlowDefinitionSchema();

await mkdir(dirname(target), { recursive: true });
await writeFile(target, document, 'utf8');

process.stdout.write(
  `${FLOW_DEFINITION_SCHEMA_RELATIVE_PATH} written (${document.length} bytes)\n`,
);
