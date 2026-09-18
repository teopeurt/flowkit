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
  'bunx playwright install --with-deps chromium' \
  'candidate_root="$(mktemp -d "$RUNNER_TEMP/flowkit-candidate.XXXXXX")"' \
  'packages=(auth consumer core notify tasks temporal)' \
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

echo "release workflow contract passed"
