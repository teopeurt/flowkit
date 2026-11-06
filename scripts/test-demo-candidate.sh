#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: scripts/test-demo-candidate.sh DEMO_CHECKOUT AUTH_TARBALL CONSUMER_TARBALL CORE_TARBALL NOTIFY_TARBALL TASKS_TARBALL TEMPORAL_TARBALL
EOF
  exit 64
}

if [[ "$#" -ne 7 ]]; then
  usage
fi

demo_checkout="$1"
shift

if [[ ! -d "$demo_checkout" || ! -r "$demo_checkout/package.json" ]]; then
  echo "demo checkout must contain a readable package.json: $demo_checkout" >&2
  exit 66
fi

package_names=(
  "@teopeurt/flowkit-auth"
  "@teopeurt/flowkit-consumer"
  "@teopeurt/flowkit-core"
  "@teopeurt/flowkit-notify"
  "@teopeurt/flowkit-tasks"
  "@teopeurt/flowkit-temporal"
)
tarballs=()

for tarball in "$@"; do
  if [[ ! -f "$tarball" || ! -r "$tarball" ]]; then
    echo "candidate tarball does not exist or is not readable: $tarball" >&2
    exit 66
  fi
  tarballs+=("$(cd "$(dirname "$tarball")" && pwd -P)/$(basename "$tarball")")
done

demo_checkout="$(cd "$demo_checkout" && pwd -P)"
temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/flowkit-demo-candidate.XXXXXX")"
temporary_demo="$temporary_root/demo"

cleanup() {
  rm -rf "$temporary_root"
}
trap cleanup EXIT INT TERM

mkdir -p "$temporary_demo"
cp -R "$demo_checkout/." "$temporary_demo"
rm -rf "$temporary_demo/.git" "$temporary_demo/node_modules"

node - "$temporary_demo/package.json" "${package_names[@]}" -- "${tarballs[@]}" <<'JS'
import { readFileSync, writeFileSync } from "node:fs";

const separator = process.argv.indexOf("--");
const manifestPath = process.argv[2];
const packageNames = process.argv.slice(3, separator);
const tarballs = process.argv.slice(separator + 1);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const dependencyGroups = ["dependencies", "devDependencies", "optionalDependencies"];
const overrides = {};

for (const [index, packageName] of packageNames.entries()) {
  const dependencyGroup = dependencyGroups.find((group) => manifest[group]?.[packageName] !== undefined);
  if (!dependencyGroup) {
    throw new Error(`demo manifest does not pin ${packageName}`);
  }
  const candidate = `file:${tarballs[index]}`;
  manifest[dependencyGroup][packageName] = candidate;
  overrides[packageName] = candidate;
}

manifest.overrides = { ...manifest.overrides, ...overrides };
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
JS

cd "$temporary_demo"
bun install --lockfile-only
bun install --frozen-lockfile
bun run typecheck
FLOWKIT_DEMO_CANDIDATE_TARBALLS=true bun run test
FLOWKIT_DEMO_CANDIDATE_TARBALLS=true bun run test:enrolment-conformance
bun run build
CI=true NODE_ENV=test bun run stack:ci
