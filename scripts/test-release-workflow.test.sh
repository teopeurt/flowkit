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

echo "release workflow contract passed"
