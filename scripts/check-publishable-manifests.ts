import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const forbiddenPublishSpec = /^(?:workspace:|file:|link:|portal:)/;
const groups = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const;

type Manifest = { name: string; version: string; [key: string]: unknown };

export function assertPublishableManifest(manifest: Manifest, siblingVersions: Map<string, string>): void {
  for (const group of groups) {
    for (const [name, spec] of Object.entries((manifest[group] as Record<string,string> | undefined) ?? {})) {
      if (forbiddenPublishSpec.test(spec)) throw new Error(`${manifest.name} ${group}.${name} uses non-publishable specifier ${spec}`);
      const sibling = siblingVersions.get(name);
      if (sibling && !rangeSatisfies(spec, sibling)) throw new Error(`${manifest.name} ${name}@${spec} does not satisfy sibling ${sibling}`);
    }
  }
}

function rangeSatisfies(range: string, version: string): boolean {
  const r = range.match(/^\^(\d+)\.(\d+)\.(\d+)$/); const v = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!r || !v) return false;
  return Number(v[1]) === Number(r[1]) && (Number(v[2]) > Number(r[2]) || (Number(v[2]) === Number(r[2]) && Number(v[3]) >= Number(r[3])));
}

async function command(args: string[], cwd: string) {
  const p = Bun.spawn(args, { cwd, stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`${args.join(' ')} failed (${code}): ${err || out}`);
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const dirs = (await readdir(join(root, 'packages'), { withFileTypes: true })).filter(x => x.isDirectory()).map(x => x.name).sort();
  const manifests = await Promise.all(dirs.map(async d => JSON.parse(await readFile(join(root, 'packages', d, 'package.json'), 'utf8')) as Manifest));
  const versions = new Map(manifests.map(m => [m.name, m.version]));
  for (const m of manifests) assertPublishableManifest(m, versions);
  const destination = await mkdtemp(join(tmpdir(), 'flowkit-publish-shape-'));
  try {
    for (const m of manifests) {
      const dir = join(root, 'packages', m.name.replace('@teopeurt/flowkit-', ''));
      await command(['npm', 'pack', '--json', '--pack-destination', destination], dir);
      const files = (await readdir(destination)).filter(f => f.endsWith('.tgz'));
      const tar = join(destination, files[files.length - 1]);
      const p = Bun.spawn(['tar', '-xOf', tar, 'package/package.json'], { stdout: 'pipe' });
      const packed = JSON.parse(await new Response(p.stdout).text()) as Manifest;
      assertPublishableManifest(packed, versions);
    }
  } finally { await rm(destination, { recursive: true, force: true }); }
  console.log(`publishable manifests passed for ${manifests.length} packages`);
}

if (import.meta.main) await main();
