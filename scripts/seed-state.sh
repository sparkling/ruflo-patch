#!/usr/bin/env bash
# scripts/seed-state.sh — Record current fork HEADs as baseline (no build)
#
# Use after clean-slate reset so the NEXT pipeline run is incremental.
# Usage: bash scripts/seed-state.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
STATE_FILE="${SCRIPT_DIR}/.last-build-state"

source "${PROJECT_DIR}/lib/pipeline-state.sh"
source "${PROJECT_DIR}/lib/fork-paths.sh"
source "${PROJECT_DIR}/lib/pipeline-utils.sh"

GLOBAL_TIMEOUT_PID=""

log "Seeding state file with current fork HEADs + upstream SHAs..."
for i in "${!FORK_NAMES[@]}"; do
  dir="${FORK_DIRS[$i]}"
  name="${FORK_NAMES[$i]}"
  if [[ -d "${dir}/.git" ]]; then
    git -C "${dir}" fetch origin main --quiet 2>/dev/null || true
    sha=$(git -C "${dir}" rev-parse origin/main 2>/dev/null) || sha=""
    set_fork_head "$name" "$sha"
    log "  ${name} fork: ${sha:0:12}"

    if git -C "${dir}" remote get-url upstream &>/dev/null; then
      git -C "${dir}" fetch upstream main --quiet 2>/dev/null || true
      upstream_sha=$(git -C "${dir}" rev-parse upstream/main 2>/dev/null) || upstream_sha=""
      if [[ -n "$upstream_sha" ]]; then
        set_upstream_sha "$name" "$upstream_sha"
        log "  ${name} upstream: ${upstream_sha:0:12}"
      fi
    fi
  fi
done
save_state
log "State seeded — next pipeline run will be incremental"
