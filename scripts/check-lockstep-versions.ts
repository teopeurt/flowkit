import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PackageManifestVersion {
  name: string;
  version: string;
}

export function checkLockstepVersions(manifests: PackageManifestVersion[]): string {
  const expectedVersion = manifests[0]?.version;
  if (!expectedVersion) {
    throw new Error('No package versions were provided');
  }

  const mismatches = manifests.filter(({ version }) => version !== expectedVersion);
  if (mismatches.length > 0) {
    const details = mismatches.map(({ name, version }) => `${name}: ${version}`).join('\n');
    throw new Error(`Package versions must match ${expectedVersion}:\n${details}`);
  }

  return expectedVersion;
}

async function readWorkspaceManifests(rootDirectory: string): Promise<PackageManifestVersion[]> {
  const packagesDirectory = join(rootDirectory, 'packages');
  const entries = await readdir(packagesDirectory, { withFileTypes: true });

  return Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => {
        const manifestPath = join(packagesDirectory, entry.name, 'package.json');
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as PackageManifestVersion;
        return { name: manifest.name, version: manifest.version };
      }),
  );
}

if (import.meta.main) {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const version = checkLockstepVersions(await readWorkspaceManifests(repositoryRoot));
  console.log(`FlowKit packages are in lockstep at ${version}`);
}
