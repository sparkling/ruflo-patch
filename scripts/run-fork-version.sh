#!/usr/bin/env bash
# scripts/run-fork-version.sh — Bump -patch.N versions in all forks (ADR-0038)
#
# Thin wrapper: calls fork-version.mjs with the fork directories.
# Used by the cascading npm script `npm run fork-version`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# shellcheck source=../lib/fork-paths.sh
source "${PROJECT_DIR}/lib/fork-paths.sh"

node "${SCRIPT_DIR}/fork-version.mjs" bump "${FORK_DIRS[@]}"
