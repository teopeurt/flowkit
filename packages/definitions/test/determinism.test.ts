import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { TestWorkflowEnvironment } from '@temporalio/testing';
import { Worker } from '@temporalio/worker';

import { loadFlowFile } from '../src/index';
import { publishDefinition } from '@naakwu/flowkit-temporal';

import { midFlightWorkflow } from './fixtures/midflight-workflow';
import type { MidFlightInput, PinnedView } from './fixtures/midflight-workflow';

const packageRoot = resolve(import.meta.dir, '..');
const fixtureDirectory = resolve(import.meta.dir, 'fixtures');

const v1Definition = `id: midflight-flow
version: 1
roles: [requester]
initialStage: draft
stages:
  draft:
    pendingRole: requester
    actions:
      submit:
        to: submitted
        kind: human
        policy: requester_can_submit
  submitted:
    final: true
`;

const v2Definition = `id: midflight-flow
version: 2
roles: [requester]
initialStage: draft
stages:
  draft:
    pendingRole: requester
    actions:
      submit:
        to: submitted
        kind: human
        policy: requester_can_submit
  submitted:
    final: true
`;

const testWithTimeout = test as unknown as (
  name: string,
  fn: () => Promise<void>,
  timeout: number,
) => void;

describe('mid-flight immunity', () => {
  testWithTimeout(
    'editing the YAML file after start does not change the running execution',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'flowkit-definitions-midflight-'));
      const definitionPath = join(directory, 'definition.yaml');

      try {
        await writeFile(definitionPath, v1Definition, 'utf8');

        const published1 = publishDefinition({ definition: await loadFlowFile(definitionPath) });
        const hash1 = published1.definitionHash;

        const environment = await TestWorkflowEnvironment.createLocal();
        const taskQueue = 'flowkit-definitions-midflight-test';
        const worker = await Worker.create({
          connection: environment.nativeConnection,
          taskQueue,
          workflowsPath: resolve(fixtureDirectory, 'midflight-workflow.ts'),
          activities: {},
        });
        const runWorker = worker.run();

        try {
          const handle = await environment.client.workflow.start(midFlightWorkflow, {
            taskQueue,
            workflowId: 'midflight-1',
            args: [{ published: published1 } satisfies MidFlightInput[]],
          });

          // A real completion signal — the query response proves the workflow has
          // executed and pinned the definition — not a fixed sleep.
          const pinnedBefore = (await handle.query('getPinned')) as PinnedView;
          expect(pinnedBefore).toEqual({ hash: hash1, id: 'midflight-flow', version: 1 });

          // Edit the source file while the execution is running.
          await writeFile(definitionPath, v2Definition, 'utf8');
          const published2 = publishDefinition({ definition: await loadFlowFile(definitionPath) });
          expect(published2.definitionHash).not.toBe(hash1);
          expect(published2.definitionSnapshot.version).toBe(2);

          // The running execution's pinned hash and identity are unchanged.
          const pinnedAfter = (await handle.query('getPinned')) as PinnedView;
          expect(pinnedAfter).toEqual({ hash: hash1, id: 'midflight-flow', version: 1 });

          await handle.signal('release');
          const result = await handle.result();
          expect(result).toEqual({ hash: hash1, id: 'midflight-flow', version: 1 });
        } finally {
          await worker.shutdown();
          await runWorker;
          await environment.teardown();
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    30_000,
  );
});

describe('workflow-bundle isolation', () => {
  test('the definition bundle does not import the YAML loader', async () => {
    const loaderEntry = resolve(packageRoot, 'src', 'index.ts');
    const workflowFixture = resolve(fixtureDirectory, 'midflight-workflow.ts');

    // Externalise the workspace packages, zod, and the sandbox runtime so only
    // the `yaml` parser (imported by the loader, and nothing else here) is ever
    // inlined. The parser is then the one thing that can mark a bundle.
    const external = ['@temporalio/*', '@naakwu/*', 'zod', '@noble/*', 'node:*'];

    // Control: bundling the loader entry pulls the `yaml` parser in.
    const loaderBundle = await Bun.build({
      entrypoints: [loaderEntry],
      target: 'bun',
      external,
      minify: false,
    });
    expect(loaderBundle.success).toBe(true);
    const loaderText = await loaderBundle.outputs[0].text();
    expect(loaderText).toContain('YAMLParseError');

    // The sandbox-side workflow fixture must not pull the parser (or the loader) in.
    const workflowBundle = await Bun.build({
      entrypoints: [workflowFixture],
      target: 'bun',
      external,
      minify: false,
    });
    expect(workflowBundle.success).toBe(true);
    const workflowText = await workflowBundle.outputs[0].text();
    expect(workflowText).not.toContain('YAMLParseError');
    expect(workflowText).not.toContain('FlowDefinitionYamlError');
  });
});
