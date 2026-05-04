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

# ADR-0142 Guard G1: bump the @sparkleideas/ruflo wrapper's pinned
# @sparkleideas/cli version in lockstep with the fork bump above.
# At this point cli's package.json (pre-codemod) sits at
# forks/ruflo/v3/@claude-flow/cli/package.json with the new version.
# The wrapper's package.json stores the dep under the post-codemod name
# (@sparkleideas/cli) but the version string itself is identical.
CLI_PKG_JSON="${FORK_DIR_RUFLO}/v3/@claude-flow/cli/package.json"
if [[ -f "${CLI_PKG_JSON}" ]]; then
  NEW_CLI_VER=$(node -e "const p=require('${CLI_PKG_JSON}'); console.log(p.name==='@claude-flow/cli'?p.version:'')")
  if [[ -n "${NEW_CLI_VER}" ]]; then
    node --input-type=module -e "
      import { bumpWrapperPin } from '${SCRIPT_DIR}/fork-version.mjs';
      const updated = await bumpWrapperPin('${PROJECT_DIR}', '${NEW_CLI_VER}');
      console.log(updated
        ? '[wrapper-pin] @sparkleideas/cli bumped to ${NEW_CLI_VER}'
        : '[wrapper-pin] already at ${NEW_CLI_VER} (no change)');
    "
  else
    echo "[wrapper-pin] WARNING: could not extract cli version from ${CLI_PKG_JSON}"
  fi
fi
