#!/usr/bin/env bash
# scripts/deploy-finalize.sh — Post-publish finalization (ADR-0038)
#
# Runs the five finalization steps that follow a successful publish:
#   1. read_build_version  — reads version from CLI package.json
#   2. save_state          — writes state file with fork HEADs
#   3. push_fork_version_bumps — pushes deferred version bumps to GitHub
#   4. write_pipeline_summary  — writes timing JSON to test-results/
#   5. print_phase_summary     — prints phase timing to stderr
#
# Expected env vars (set by the publish stage before invoking this script):
#   NEW_RUFLO_HEAD, NEW_AGENTIC_HEAD, NEW_FANN_HEAD, NEW_RUVECTOR_HEAD
#   UPSTREAM_RUFLO_SHA, UPSTREAM_AGENTIC_SHA, UPSTREAM_FANN_SHA, UPSTREAM_RUVECTOR_SHA
#   PIPELINE_START_NS
#
# Usage:
#   export NEW_RUFLO_HEAD=abc123... NEW_AGENTIC_HEAD=...
#   export PIPELINE_START_NS=$(date +%s%N)
#   scripts/deploy-finalize.sh

set -euo pipefail

# ---------------------------------------------------------------------------
# Directory setup
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

STATE_FILE="${SCRIPT_DIR}/.last-build-state"

TEMP_DIR="/tmp/ruflo-build"

# ---------------------------------------------------------------------------
# Fork directories (ADR-0039: single source of truth)
# ---------------------------------------------------------------------------

# shellcheck source=../lib/fork-paths.sh
source "${PROJECT_DIR}/lib/fork-paths.sh"

# ---------------------------------------------------------------------------
# Env var defaults (caller should export these before invoking)
# ---------------------------------------------------------------------------

: "${NEW_RUFLO_HEAD:=}"
: "${NEW_AGENTIC_HEAD:=}"
: "${NEW_FANN_HEAD:=}"
: "${NEW_RUVECTOR_HEAD:=}"
: "${UPSTREAM_RUFLO_SHA:=}"
: "${UPSTREAM_AGENTIC_SHA:=}"
: "${UPSTREAM_FANN_SHA:=}"
: "${UPSTREAM_RUVECTOR_SHA:=}"
: "${PIPELINE_START_NS:=}"

# Build version (set by read_build_version)
BUILD_VERSION=""

# Deferred version bump pushes (populated by caller, pushed after publish)
PENDING_VERSION_PUSHES=()

# Needed by save_state fallback when NEW_*_HEAD is empty
RUFLO_HEAD=""
AGENTIC_HEAD=""
FANN_HEAD=""
RUVECTOR_HEAD=""

# No global timeout PID for this script
GLOBAL_TIMEOUT_PID=""

# ---------------------------------------------------------------------------
# Source shared pipeline utilities
# ---------------------------------------------------------------------------

# shellcheck source=../lib/pipeline-utils.sh
source "${PROJECT_DIR}/lib/pipeline-utils.sh"

# ---------------------------------------------------------------------------
# Push deferred version bumps (extracted from sync-and-build.sh)
# ---------------------------------------------------------------------------

push_fork_version_bumps() {
  if [[ ${#PENDING_VERSION_PUSHES[@]} -eq 0 ]]; then
    return 0
  fi
  log "Pushing deferred version bumps to ${#PENDING_VERSION_PUSHES[@]} fork(s) (parallel)"
  local push_pids=()
  local _push_start
  _push_start=$(date +%s%N 2>/dev/null || echo 0)
  for dir in "${PENDING_VERSION_PUSHES[@]}"; do
    local name
    name=$(basename "$dir")
    (
      git -C "${dir}" push origin main --quiet 2>/dev/null || {
        echo "WARNING: Failed to push version bump for ${name}" >&2
      }
    ) &
    push_pids+=($!)
  done
  wait "${push_pids[@]}" 2>/dev/null || true
  local _push_end
  _push_end=$(date +%s%N 2>/dev/null || echo 0)
  if [[ "$_push_start" != "0" && "$_push_end" != "0" ]]; then
    local _push_ms=$(( (_push_end - _push_start) / 1000000 ))
    log "  Parallel push completed in ${_push_ms}ms"
    add_cmd_timing "push-versions" "git push (${#PENDING_VERSION_PUSHES[@]} forks parallel)" "${_push_ms}"
  fi
}

# ---------------------------------------------------------------------------
# Main: run finalization steps
# ---------------------------------------------------------------------------

log "── deploy-finalize: starting post-publish finalization ──"

# 1. Read version from fork package.json (no computation needed)
read_build_version

# 2. Save state after successful verify + publish
save_state

# 3. Push deferred version bumps now that publish succeeded
push_fork_version_bumps

# 4. Write JSON timing summary
write_pipeline_summary

# 5. Print phase timing to stderr
print_phase_summary

log "deploy-finalize complete: ${BUILD_VERSION}"
