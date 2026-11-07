#!/usr/bin/env bash

set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
release_workflow="$repository_root/.github/workflows/release.yml"
expected_output_reference='has_changesets: ${{ steps.changesets.outputs.has-changesets }}'

if ! grep -Fq "$expected_output_reference" "$release_workflow"; then
  echo "release workflow must alias changesets/action's has-changesets output" >&2
  exit 1
fi

if grep -Fq 'steps.changesets.outputs.hasChangesets' "$release_workflow"; then
  echo "release workflow references the nonexistent hasChangesets output" >&2
  exit 1
fi

for required_fragment in \
  'bun run version:check' \
  'bun run build' \
  'candidate_root="$(mktemp -d "$RUNNER_TEMP/flowkit-candidate.XXXXXX")"' \
  'packages=(auth consumer core notify tasks temporal definitions)' \
  'demo_packages=(auth consumer core notify tasks temporal)' \
  'const names = ["auth", "consumer", "core", "definitions", "notify", "tasks", "temporal"]' \
  'demo_candidate_tarballs+=("${candidate_tarball_by_package[$package]}")' \
  'bash scripts/test-demo-candidate.sh'; do
  if ! grep -Fq "$required_fragment" "$release_workflow"; then
    echo "release workflow is missing candidate gate fragment: $required_fragment" >&2
    exit 1
  fi
done

candidate_line="$(grep -n 'Test the exact candidates in the demo' "$release_workflow" | cut -d: -f1)"
publish_line="$(grep -n 'Publish validated candidates' "$release_workflow" | cut -d: -f1)"
if [[ -z "$candidate_line" || -z "$publish_line" || "$candidate_line" -ge "$publish_line" ]]; then
  echo "release workflow must publish only after the exact candidate gate" >&2
  exit 1
fi

# The demo candidate gate runs the demo's own `bun run stack:ci`, which uses the
# demo's locked Playwright. Chromium must be installed at that exact version, and
# only after the demo checkout exists so the lockfile is available.
chromium_install_line="$(grep -n 'Install Chromium for the candidate stack gate' "$release_workflow" | head -1 | cut -d: -f1)"
demo_checkout_line="$(grep -n 'Check out FlowKit demo' "$release_workflow" | head -1 | cut -d: -f1)"
if [[ -z "$chromium_install_line" || -z "$demo_checkout_line" ]]; then
  echo "release workflow must install Chromium for the candidate stack gate after checking out the demo" >&2
  exit 1
fi
if [[ "$demo_checkout_line" -ge "$chromium_install_line" || "$chromium_install_line" -ge "$candidate_line" ]]; then
  echo "Chromium install must run after the FlowKit demo checkout and before the candidate gate" >&2
  exit 1
fi

if grep -Eq 'bunx +playwright +install' "$release_workflow"; then
  echo "Chromium must not be installed through an unpinned bunx playwright (it fetches the latest build)" >&2
  exit 1
fi

for required_fragment in \
  'flowkit-demo/bun.lock' \
  'playwright_version=' \
  'versions.size !== 1' \
  'bunx "playwright@${playwright_version}" install --with-deps chromium'; do
  if ! grep -Fq "$required_fragment" "$release_workflow"; then
    echo "Chromium install must derive the demo's locked Playwright version: missing $required_fragment" >&2
    exit 1
  fi
done

# release:version runs the sync script, a frozen install, and a build, so the
# release PR job must install dependencies before changesets/action invokes it.
if ! grep -Fq 'version-script: bun run release:version' "$release_workflow"; then
  echo "release workflow must version packages through bun run release:version" >&2
  exit 1
fi

install_line="$(grep -n 'Install dependencies' "$release_workflow" | head -1 | cut -d: -f1)"
release_pr_line="$(grep -n 'Create or update the Changesets release pull request' "$release_workflow" | cut -d: -f1)"
if [[ -z "$install_line" || -z "$release_pr_line" || "$install_line" -ge "$release_pr_line" ]]; then
  echo "release PR job must install dependencies before running release:version" >&2
  exit 1
fi

# npmjs.org publication runs after the GitHub Packages publish, with its own
# credential guard and a short-lived OIDC token for provenance.
if ! grep -Fq 'id-token: write' "$release_workflow"; then
  echo "publish job must grant id-token: write for npm provenance" >&2
  exit 1
fi

for required_fragment in \
  'Verify npm publish credentials' \
  'NPM_TOKEN is not configured' \
  'bun run publish:npm' \
  'FLOWKIT_CANDIDATE_TARBALL_DIR=' \
  'npm pack --json --pack-destination "$candidate_root"'; do
  if ! grep -Fq "$required_fragment" "$release_workflow"; then
    echo "release workflow is missing npm publication fragment: $required_fragment" >&2
    exit 1
  fi
done

npm_publish_line="$(grep -n 'name: Publish to npm' "$release_workflow" | head -1 | cut -d: -f1)"
guard_line="$(grep -n 'Verify npm publish credentials' "$release_workflow" | head -1 | cut -d: -f1)"
if [[ -z "$npm_publish_line" || -z "$guard_line" || "$guard_line" -ge "$npm_publish_line" ]]; then
  echo "npm credential guard must run before the npm publish step" >&2
  exit 1
fi
if [[ "$publish_line" -ge "$guard_line" ]]; then
  echo "npm publication must run only after the GitHub Packages publish succeeds" >&2
  exit 1
fi

# The npm step must pass the secret through env (never argv) and keep its own
# registry selection, independent of setup-node's GitHub Packages .npmrc.
npm_step_block="$(sed -n "${npm_publish_line},$((npm_publish_line + 12))p" "$release_workflow")"
if ! grep -Fq 'NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}' <<<"$npm_step_block"; then
  echo "npm publish step must receive NODE_AUTH_TOKEN from secrets.NPM_TOKEN" >&2
  exit 1
fi
if ! grep -Fq "if: steps.publish_plan.outputs.has_releases == 'true'" <<<"$npm_step_block"; then
  echo "npm publish step must be gated on has_releases" >&2
  exit 1
fi
if grep -Eq 'echo .*NODE_AUTH_TOKEN|\$\{\{ secrets\.NPM_TOKEN \}\}.*--token|npm publish.*secrets\.' "$release_workflow"; then
  echo "release workflow must never place the npm token in a command line" >&2
  exit 1
fi
if grep -Fq 'echo "$NODE_AUTH_TOKEN"' "$release_workflow"; then
  echo "release workflow must never echo the npm token" >&2
  exit 1
fi

echo "release workflow contract passed"