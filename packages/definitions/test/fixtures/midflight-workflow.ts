import { condition, defineQuery, defineSignal, setHandler } from '@temporalio/workflow';

import { verifyPublishedDefinition } from '@naakwu/flowkit-temporal';
import type { PublishedFlowDefinition } from '@naakwu/flowkit-temporal';

/**
 * Minimal deterministic workflow that pins a published definition and exposes the
 * pinned identity via query. It imports only `@temporalio/workflow` and
 * `@naakwu/flowkit-temporal` (never the YAML loader), mirroring the sandbox
 * boundary: YAML is resolved before start and the workflow only ever sees the
 * immutable snapshot + hash.
 */
export interface MidFlightInput {
  published: PublishedFlowDefinition;
}

export interface PinnedView {
  hash: string;
  id: string;
  version: number;
}

export async function midFlightWorkflow(input: MidFlightInput): Promise<PinnedView> {
  // Re-verify the published pair inside the sandbox: the snapshot must hash back
  // to the hash and satisfy the strict schema, or the workflow fails at boot.
  verifyPublishedDefinition(input.published);

  const pinned: PinnedView = {
    hash: input.published.definitionHash,
    id: input.published.definitionSnapshot.id,
    version: input.published.definitionSnapshot.version,
  };

  const getPinned = defineQuery<PinnedView>('getPinned');
  setHandler(getPinned, () => pinned);

  const release = defineSignal('release');
  let released = false;
  setHandler(release, () => {
    released = true;
  });

  await condition(() => released);
  return pinned;
}
