import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkLockstepVersions, type PackageManifestVersion } from './check-lockstep-versions';

const primaryConstantPattern = /^\s*export\s+const\s+(FLOWKIT_[A-Z_]+_VERSION)\s*=\s*'([^']*)'/gm;
const exportedVersionConstantPattern =
  /^export const ([A-Za-z_$][\w$]*) = (['"])([^'"]+)\2;?$/gm;
const versionNamePattern = /(?:VERSION|Version)$/;
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const workspaceKeyPattern = /^ {4}"([^"]*)": \{$/;
const workspaceNamePattern = /^ {6}"name": "([^"]+)",$/;
const workspaceVersionPattern = /^( {6})"version": "[^"]*",$/;

export interface ExportedVersionConstant {
  name: string;
  value: string;
}

/**
 * Rewrites one `export const NAME = '<version>'` declaration and leaves every
 * other byte of the module untouched. Throws when the declaration is missing or
 * duplicated so a release cannot silently ship a stale version constant.
 */
export function syncVersionConstant(source: string, exportName: string, version: string): string {
  const pattern = new RegExp(
    `^(\\s*export\\s+const\\s+${exportName}\\s*=\\s*)(['"])([^'"]*)\\2`,
    'gm',
  );
  const matches = [...source.matchAll(pattern)];

  if (matches.length === 0) {
    throw new Error(`Expected an exported version constant named ${exportName}`);
  }
  if (matches.length > 1) {
    throw new Error(`Exported version constant ${exportName} is declared more than once`);
  }

  return source.replace(pattern, (_match, prefix: string, quote: string) => `${prefix}${quote}${version}${quote}`);
}

/** Requires exactly one `FLOWKIT_*_VERSION` export in a package's index module. */
export function requirePrimaryVersionConstant(source: string, packageName: string): ExportedVersionConstant {
  const matches = [...source.matchAll(primaryConstantPattern)];

  if (matches.length === 0) {
    throw new Error(
      `${packageName} must export exactly one FLOWKIT_*_VERSION constant from src/index.ts; found none`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `${packageName} exports more than one FLOWKIT_*_VERSION constant from src/index.ts: ${matches
        .map((match) => match[1])
        .join(', ')}`,
    );
  }

  return { name: matches[0][1], value: matches[0][2] };
}

/** Finds top-level exported version constants, including mirrors such as testingContractVersion. */
export function findExportedVersionConstants(source: string): ExportedVersionConstant[] {
  return [...source.matchAll(exportedVersionConstantPattern)]
    .map((match) => ({ name: match[1], value: match[3] }))
    .filter(({ name, value }) => versionNamePattern.test(name) && semverPattern.test(value));
}

/** Counts line-level changes between two texts that must have identical line counts. */
export function countChangedLines(before: string, after: string): number {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  if (beforeLines.length !== afterLines.length) {
    throw new Error(`Text line count changed from ${beforeLines.length} to ${afterLines.length}`);
  }

  return beforeLines.reduce((count, line, index) => (line === afterLines[index] ? count : count + 1), 0);
}

/**
 * Rewrites only the `"version"` line that directly follows a workspace
 * `"name": "@teopeurt/flowkit-*"` entry in bun.lock. Every other lockfile byte is
 * preserved; a partial rewrite is treated as an error.
 */
export function syncLockfileWorkspaceVersions(
  lockText: string,
  versionsByName: Record<string, string>,
): string {
  const lines = lockText.split('\n');
  const expectedNames = new Set(Object.keys(versionsByName));
  const workspacesStart = lines.findIndex((line) => line === '  "workspaces": {');
  if (workspacesStart === -1) {
    throw new Error('bun.lock has no top-level "workspaces" block');
  }

  const workspacesEnd = lines.findIndex((line, index) => index > workspacesStart && line === '  },');
  if (workspacesEnd === -1) {
    throw new Error('bun.lock "workspaces" block is not terminated');
  }

  const updatedNames = new Set<string>();
  let workspaceKey = '';
  for (let index = workspacesStart + 1; index < workspacesEnd; index += 1) {
    const keyMatch = workspaceKeyPattern.exec(lines[index]);
    if (keyMatch) {
      workspaceKey = keyMatch[1];
      continue;
    }

    const nameMatch = workspaceNamePattern.exec(lines[index]);
    if (!nameMatch) {
      continue;
    }

    const versionMatch = workspaceVersionPattern.exec(lines[index + 1] ?? '');
    if (!versionMatch) {
      continue;
    }

    if (workspaceKey === '') {
      // The workspace root is not a publishable package.
      continue;
    }

    const expectedVersion = versionsByName[nameMatch[1]];
    if (expectedVersion === undefined) {
      throw new Error(`bun.lock workspace ${nameMatch[1]} has no version in the release set`);
    }

    lines[index + 1] = `${versionMatch[1]}"version": "${expectedVersion}",`;
    updatedNames.add(nameMatch[1]);
  }

  const missingNames = [...expectedNames].filter((name) => !updatedNames.has(name));
  if (missingNames.length > 0) {
    throw new Error(
      `bun.lock is missing workspace version entries for: ${missingNames.join(', ')}`,
    );
  }

  return lines.join('\n');
}

/** Returns the shared version and rejects a non-lockstep manifest set. */
export function lockstepVersionFromManifests(manifests: PackageManifestVersion[]): string {
  return checkLockstepVersions(manifests);
}

async function collectTypeScriptSources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const sources: string[] = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') {
        continue;
      }
      sources.push(...(await collectTypeScriptSources(path)));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      sources.push(path);
    }
  }

  return sources.sort((left, right) => left.localeCompare(right));
}

async function writeIfChanged(path: string, before: string, after: string, changedPaths: string[]): Promise<void> {
  if (before === after) {
    return;
  }
  await writeFile(path, after);
  changedPaths.push(path);
}

async function main(): Promise<void> {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const packagesDirectory = join(repositoryRoot, 'packages');
  const packageDirectories = (await readdir(packagesDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const manifests: PackageManifestVersion[] = [];
  for (const directory of packageDirectories) {
    const manifest = JSON.parse(
      await readFile(join(packagesDirectory, directory, 'package.json'), 'utf8'),
    ) as PackageManifestVersion;
    manifests.push({ name: manifest.name, version: manifest.version });
  }

  const version = lockstepVersionFromManifests(manifests);
  const versionsByName = Object.fromEntries(manifests.map(({ name, version: packageVersion }) => [name, packageVersion]));
  const changedPaths: string[] = [];

  for (const directory of packageDirectories) {
    const manifest = manifests.find(({ name }) => name === `@teopeurt/flowkit-${directory}`);
    if (!manifest) {
      throw new Error(`No workspace manifest found for packages/${directory}`);
    }

    const indexSourcePath = join(packagesDirectory, directory, 'src', 'index.ts');
    const indexSource = await readFile(indexSourcePath, 'utf8');
    const primaryConstant = requirePrimaryVersionConstant(indexSource, manifest.name);
    await writeIfChanged(
      indexSourcePath,
      indexSource,
      syncVersionConstant(indexSource, primaryConstant.name, version),
      changedPaths,
    );

    for (const sourcePath of await collectTypeScriptSources(join(packagesDirectory, directory, 'src'))) {
      if (sourcePath === indexSourcePath) {
        continue;
      }
      const source = await readFile(sourcePath, 'utf8');
      let nextSource = source;
      for (const constant of findExportedVersionConstants(source)) {
        nextSource = syncVersionConstant(nextSource, constant.name, version);
      }
      await writeIfChanged(sourcePath, source, nextSource, changedPaths);
    }
  }

  const lockPath = join(repositoryRoot, 'bun.lock');
  const lockText = await readFile(lockPath, 'utf8');
  const nextLockText = syncLockfileWorkspaceVersions(lockText, versionsByName);
  const changedLockLines = countChangedLines(lockText, nextLockText);
  if (changedLockLines !== 0 && changedLockLines !== manifests.length) {
    throw new Error(
      `bun.lock update changed ${changedLockLines} lines; expected 0 or exactly ${manifests.length} workspace version lines`,
    );
  }
  await writeIfChanged(lockPath, lockText, nextLockText, changedPaths);

  console.log(
    `Synced ${manifests.length} FlowKit packages to ${version}: ` +
      `${changedPaths.length} file(s) updated, ${changedLockLines} bun.lock workspace version line(s) rewritten`,
  );
}

if (import.meta.main) {
  await main();
}
