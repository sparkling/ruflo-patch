#!/usr/bin/env bash
# scripts/copy-source.sh — Copy fork sources to /tmp/ruflo-build (ADR-0038)

set -euo pipefail

# ---------------------------------------------------------------------------
# Path setup
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ---------------------------------------------------------------------------
# Helpers — source lib/pipeline-utils.sh if available, else define inline
# ---------------------------------------------------------------------------

if [[ -f "${SCRIPT_DIR}/lib/pipeline-utils.sh" ]]; then
  # shellcheck source=lib/pipeline-utils.sh
  source "${SCRIPT_DIR}/lib/pipeline-utils.sh"
else
  log() {
    echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*" >&2
  }

  log_error() {
    echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] ERROR: $*" >&2
  }

  TIMING_CMDS_FILE="/tmp/ruflo-timing-cmds.jsonl"

  add_cmd_timing() {
    local phase="$1" cmd="$2" ms="$3" exit_code="${4:-0}"
    printf '{"phase":"%s","command":"%s","duration_ms":%s,"exit_code":%s}\n' \
      "$phase" "$cmd" "$ms" "$exit_code" >> "$TIMING_CMDS_FILE"
  }
fi

# ---------------------------------------------------------------------------
# Fork directories (ADR-0039: single source of truth)
# ---------------------------------------------------------------------------

# shellcheck source=../lib/fork-paths.sh
source "${PROJECT_DIR}/lib/fork-paths.sh"

TEMP_DIR=""  # set in create_temp_dir

# ---------------------------------------------------------------------------
# Functions
# ---------------------------------------------------------------------------

create_temp_dir() {
  TEMP_DIR="/tmp/ruflo-build"
  mkdir -p "${TEMP_DIR}"
  log "Using persistent build directory: ${TEMP_DIR}"
}

copy_source() {
  log "Copying fork source to ${TEMP_DIR}"
  local _cp_start _cp_end

  # Copy all 3 forks in parallel (uses all available I/O bandwidth)
  mkdir -p "${TEMP_DIR}/cross-repo/agentic-flow" "${TEMP_DIR}/cross-repo/ruv-FANN" "${TEMP_DIR}/cross-repo/ruvector"

  _cp_start=$(date +%s%N 2>/dev/null || echo 0)
  local rsync_status_dir
  rsync_status_dir=$(mktemp -d /tmp/ruflo-rsync-XXXXX)

  rsync -a --delete --filter='P dist/' --filter='P .tsbuildinfo' --filter='P .build-manifest.json' --filter='P .wasm-cache.json' --filter='P .last-verified.json' --filter='P tsconfig.build.json' --filter='P cross-repo/' --exclude=node_modules --exclude=.git "${FORK_DIR_RUFLO}/" "${TEMP_DIR}/" \
    && touch "${rsync_status_dir}/ruflo" &
  local pid_ruflo=$!
  rsync -a --delete --filter='P dist/' --filter='P .tsbuildinfo' --filter='P wasm/' --filter='P .build-manifest.json' --filter='P tsconfig.build.json' \
    --exclude=node_modules --exclude=.git \
    --exclude='packages/agentic-jujutsu/*.node' \
    --exclude='packages/agentic-jujutsu/*.tgz' \
    --exclude='packages/agentic-jujutsu/tests' \
    --exclude='packages/agentic-jujutsu/benchmarks' \
    --exclude='packages/agentic-jujutsu/benches' \
    --exclude='packages/agentic-jujutsu/examples' \
    --exclude='packages/agentic-jujutsu/docs' \
    --exclude='packages/agentic-jujutsu/test-repo' \
    --exclude='packages/agentic-jujutsu/target' \
    "${FORK_DIR_AGENTIC}/" "${TEMP_DIR}/cross-repo/agentic-flow/" \
    && touch "${rsync_status_dir}/agentic" &
  local pid_agentic=$!
  rsync -a --delete --filter='P dist/' --filter='P .tsbuildinfo' --filter='P .build-manifest.json' --filter='P tsconfig.build.json' --exclude=node_modules --exclude=.git "${FORK_DIR_FANN}/" "${TEMP_DIR}/cross-repo/ruv-FANN/" \
    && touch "${rsync_status_dir}/fann" &
  local pid_fann=$!
  rsync -a --delete --filter='P dist/' --filter='P .tsbuildinfo' --filter='P .build-manifest.json' --filter='P tsconfig.build.json' --exclude=node_modules --exclude=.git "${FORK_DIR_RUVECTOR}/" "${TEMP_DIR}/cross-repo/ruvector/" \
    && touch "${rsync_status_dir}/ruvector" &
  local pid_ruvector=$!
  wait $pid_ruflo $pid_agentic $pid_fann $pid_ruvector
  _cp_end=$(date +%s%N 2>/dev/null || echo 0)

  # Verify all rsync operations succeeded
  local rsync_failures=0
  for fork_name in ruflo agentic fann ruvector; do
    if [[ ! -f "${rsync_status_dir}/${fork_name}" ]]; then
      log_error "rsync failed for ${fork_name}"
      rsync_failures=$((rsync_failures + 1))
    fi
  done
  rm -rf "${rsync_status_dir}"
  if [[ $rsync_failures -gt 0 ]]; then
    log_error "${rsync_failures} rsync operation(s) failed — aborting build"
    return 1
  fi

  local _cp_ms=0
  if [[ "$_cp_start" != "0" && "$_cp_end" != "0" ]]; then
    _cp_ms=$(( (_cp_end - _cp_start) / 1000000 ))
    log "  Parallel copy completed in ${_cp_ms}ms"
    add_cmd_timing "copy-source" "rsync (4 forks parallel)" "${_cp_ms}"
  fi
  log "Source copied to temp directory (4 forks merged, parallel)"

  # ADR-0069: Clear stale dist/ for packages with patched .ts source.
  # The rsync --filter='P dist/' preserves compiled JS to avoid recompiling
  # everything, but fork patches to .ts files won't take effect until dist
  # is cleared. Compare source mtime vs dist mtime for known-patched packages.
  for pkg_dir in \
    "${TEMP_DIR}/v3/@claude-flow/memory" \
    "${TEMP_DIR}/v3/@claude-flow/cli" \
    "${TEMP_DIR}/v3/@claude-flow/hooks" \
    "${TEMP_DIR}/v3/@claude-flow/integration" \
    "${TEMP_DIR}/v3/@claude-flow/embeddings" \
    "${TEMP_DIR}/v3/@claude-flow/neural" \
    "${TEMP_DIR}/v3/@claude-flow/guidance" \
    "${TEMP_DIR}/v3/@claude-flow/plugins" \
    "${TEMP_DIR}/v3/@claude-flow/shared" \
    ; do
    if [[ -d "$pkg_dir/dist" && -d "$pkg_dir/src" ]]; then
      local newest_src newest_dist
      newest_src=$(find "$pkg_dir/src" -name '*.ts' -newer "$pkg_dir/dist" 2>/dev/null | head -1)
      if [[ -n "$newest_src" ]]; then
        rm -rf "$pkg_dir/dist" "$pkg_dir/.tsbuildinfo" 2>/dev/null
        log "  Cleared stale dist/ for $(basename "$pkg_dir") (source newer than dist)"
      fi
    fi
  done
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

create_temp_dir
copy_source
