#!/usr/bin/env bash
set -u
export PATH=/home/appadmin/.local/share/mise/installs/bun/1.3.14/bin:$PATH
run() { echo "== $1"; shift; "$@"; rc=$?; echo "rc=$rc"; return $rc; }
run install bun install --frozen-lockfile
run build bun run build
run version bun run version:check
run typecheck bun run typecheck
run test bun run test
run pack bun run pack:check
run docs bun test test/documentation.test.ts
run workflow bash scripts/test-release-workflow.test.sh
