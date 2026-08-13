#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
candidate_script="$repository_root/scripts/test-demo-candidate.sh"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/flowkit-demo-candidate-test.XXXXXX")"

cleanup() {
  rm -rf "$test_root"
}
trap cleanup EXIT

demo_checkout="$test_root/demo"
capture_directory="$test_root/captures"
package_stage="$test_root/package-stage"
mkdir -p "$demo_checkout" "$capture_directory" "$package_stage/package"

cat > "$demo_checkout/package.json" <<'JSON'
{
  "name": "fake-flowkit-demo",
  "private": true,
  "scripts": {
    "typecheck": "node fake-demo-command.mjs typecheck",
    "test": "node fake-demo-command.mjs test",
    "build": "node fake-demo-command.mjs build",
    "stack:ci": "node fake-demo-command.mjs stack:ci"
  },
  "dependencies": {
    "@naakwu/flowkit-auth": "0.2.0",
    "@naakwu/flowkit-consumer": "0.2.0",
    "@naakwu/flowkit-core": "0.2.0",
    "@naakwu/flowkit-notify": "0.2.0",
    "@naakwu/flowkit-tasks": "0.2.0",
    "@naakwu/flowkit-temporal": "0.2.0",
    "zod": "3.25.76"
  }
}
JSON

cat > "$demo_checkout/fake-demo-command.mjs" <<'JS'
import { appendFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const captureDirectory = process.env.FLOWKIT_CANDIDATE_TEST_CAPTURE;
if (!captureDirectory) throw new Error("FLOWKIT_CANDIDATE_TEST_CAPTURE is required");
const command = process.argv[2];
appendFileSync(join(captureDirectory, "commands.log"), `${command}:${process.env.FLOWKIT_DEMO_CANDIDATE_TARBALLS ?? ""}\n`);
copyFileSync("package.json", join(captureDirectory, `${command}.package.json`));
JS

cp "$demo_checkout/package.json" "$test_root/original-package.json"

package_names=(
  "@naakwu/flowkit-auth"
  "@naakwu/flowkit-consumer"
  "@naakwu/flowkit-core"
  "@naakwu/flowkit-notify"
  "@naakwu/flowkit-tasks"
  "@naakwu/flowkit-temporal"
)
tarballs=()

for package_name in "${package_names[@]}"; do
  package_slug="${package_name#@naakwu/}"
  tarball="$test_root/${package_slug}-candidate.tgz"
  cat > "$package_stage/package/package.json" <<JSON
{"name":"$package_name","version":"0.2.0","main":"index.js"}
JSON
  printf 'module.exports = {};\n' > "$package_stage/package/index.js"
  tar -czf "$tarball" -C "$package_stage" package
  tarballs+=("$tarball")
done

FLOWKIT_CANDIDATE_TEST_CAPTURE="$capture_directory" \
  bash "$candidate_script" "$demo_checkout" "${tarballs[@]}"

cmp "$test_root/original-package.json" "$demo_checkout/package.json"

node - "${tarballs[@]}" "$capture_directory/typecheck.package.json" <<'JS'
import { readFileSync, realpathSync } from "node:fs";

const packageNames = [
  "@naakwu/flowkit-auth",
  "@naakwu/flowkit-consumer",
  "@naakwu/flowkit-core",
  "@naakwu/flowkit-notify",
  "@naakwu/flowkit-tasks",
  "@naakwu/flowkit-temporal",
];
const tarballs = process.argv.slice(2, 8).map((tarball) => realpathSync(tarball));
const capturedManifest = JSON.parse(readFileSync(process.argv[8], "utf8"));
const expectedCandidates = {
  "@naakwu/flowkit-auth": `file:${tarballs[0]}`,
  "@naakwu/flowkit-consumer": `file:${tarballs[1]}`,
  "@naakwu/flowkit-core": `file:${tarballs[2]}`,
  "@naakwu/flowkit-notify": `file:${tarballs[3]}`,
  "@naakwu/flowkit-tasks": `file:${tarballs[4]}`,
  "@naakwu/flowkit-temporal": `file:${tarballs[5]}`,
};

for (const packageName of packageNames) {
  if (capturedManifest.dependencies[packageName] !== expectedCandidates[packageName]) {
    throw new Error(`${packageName} was not rewritten to its exact candidate tarball`);
  }
}
if (capturedManifest.dependencies.zod !== "3.25.76") {
  throw new Error("the candidate rewrite changed an unrelated dependency");
}
JS

expected_commands=$'typecheck:\ntest:true\nbuild:\nstack:ci:'
if [[ "$(cat "$capture_directory/commands.log")" != "$expected_commands" ]]; then
  printf 'unexpected demo command sequence:\n%s\n' "$(cat "$capture_directory/commands.log")" >&2
  exit 1
fi

missing_tarball="$test_root/missing-temporal.tgz"
if FLOWKIT_CANDIDATE_TEST_CAPTURE="$capture_directory" \
  bash "$candidate_script" "$demo_checkout" \
    "${tarballs[0]}" "${tarballs[1]}" "${tarballs[2]}" \
    "${tarballs[3]}" "${tarballs[4]}" "$missing_tarball"; then
  echo "candidate validation accepted a missing tarball" >&2
  exit 1
fi

cmp "$test_root/original-package.json" "$demo_checkout/package.json"
echo "demo candidate script contract passed"
