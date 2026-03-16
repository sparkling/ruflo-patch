#!/usr/bin/env bash
# sync-and-build.sh — Thin dispatcher for ruflo pipeline (ADR-0039)
#
# Dispatches to ruflo-publish.sh and/or ruflo-sync.sh.
# Handles: flag parsing, concurrency guard, global timeout, --seed-state,
# --build-only (both too small for own scripts).
#
# Flags:
#   --sync        Sync stage only (ruflo-sync.sh)
#   --publish     Publish stage only (ruflo-publish.sh)
#   --force       Build even when no changes detected
#   --build-only  Stop after build (no tests, no publish)
#   --pull        Pull upstream repos in --build-only mode
#   --seed-state  Record current fork HEADs as baseline (no build)
#
# See: ADR-0027 (fork migration), ADR-0039 (pipeline decomposition)

set -euo pipefail

# ---------------------------------------------------------------------------
# CLI flags (parsed before concurrency guard so --build-only can skip it)
# ---------------------------------------------------------------------------

RUN_SYNC=false
RUN_PUBLISH=false
FORCE_BUILD=false
BUILD_ONLY=false
PULL_UPSTREAM=false
SEED_STATE=false
for arg in "$@"; do
  case "$arg" in
    --sync)       RUN_SYNC=true ;;
    --publish)    RUN_PUBLISH=true ;;
    --force)      FORCE_BUILD=true ;;
    --build-only) BUILD_ONLY=true ;;
    --pull)       PULL_UPSTREAM=true ;;
    --seed-state) SEED_STATE=true ;;
    --help|-h)
      cat <<'USAGE'
Usage: sync-and-build.sh [FLAGS]

Flags:
  --sync        Sync stage only (fetch upstream, create PR)
  --publish     Publish stage only (detect merges, build, publish)
  --force       Build even when no changes detected
  --build-only  Stop after build (no tests, no publish)
  --pull        Pull upstream repos in --build-only mode
  --seed-state  Record current fork HEADs as baseline (no build)
  --help, -h    Show this help

See: docs/pipeline-reference.md
USAGE
      exit 0
      ;;
    -*) echo "Error: Unknown flag: $arg (use --help for usage)"; exit 1 ;;
  esac
done

# Default: run both stages
if [[ "${RUN_SYNC}" == "false" && "${RUN_PUBLISH}" == "false" ]]; then
  RUN_SYNC=true
  RUN_PUBLISH=true
fi

# ---------------------------------------------------------------------------
# Concurrency guard — prevent overlapping runs (ADR-0027)
# ---------------------------------------------------------------------------
if [[ "$BUILD_ONLY" != "true" ]]; then
  LOCKFILE="/tmp/ruflo-sync-and-build.lock"
  exec 9>"$LOCKFILE"
  if ! flock -n 9; then
    LOCK_HOLDER=$(fuser "$LOCKFILE" 2>/dev/null | tr -d ' ') || LOCK_HOLDER=""
    if [[ -n "$LOCK_HOLDER" ]]; then
      HOLDER_CMD=$(ps -p "$LOCK_HOLDER" -o comm= 2>/dev/null) || HOLDER_CMD=""
      if [[ "$HOLDER_CMD" == "sleep" ]]; then
        echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Stale lock held by orphaned process $LOCK_HOLDER ($HOLDER_CMD) — reclaiming"
        kill "$LOCK_HOLDER" 2>/dev/null || true
        sleep 1
        if ! flock -n 9; then
          echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Failed to reclaim lock — exiting"
          exit 0
        fi
      else
        echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Another sync-and-build is running (PID $LOCK_HOLDER, $HOLDER_CMD) — exiting"
        exit 0
      fi
    else
      echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Lock held by dead process — reclaiming"
      rm -f "$LOCKFILE"
      exec 9>"$LOCKFILE"
      flock -n 9 || { echo "Failed to reclaim lock — exiting"; exit 0; }
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Constants and libraries
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

STATE_FILE="${SCRIPT_DIR}/.last-build-state"

# Mutable state (single source of truth: lib/pipeline-state.sh)
source "${PROJECT_DIR}/lib/pipeline-state.sh"

source "${PROJECT_DIR}/lib/fork-paths.sh"
source "${PROJECT_DIR}/lib/pipeline-utils.sh"
source "${PROJECT_DIR}/lib/pipeline-helpers.sh"

: "${RUFLO_NOTIFY_EMAIL:=}"
[[ -z "${RUFLO_NOTIFY_EMAIL}" ]] && log_warn "RUFLO_NOTIFY_EMAIL not set — failure notifications disabled"

trap cleanup EXIT

# Initialise timing files
: > "$TIMING_CMDS_FILE"
: > "$TIMING_BUILD_PKGS_FILE"

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  PIPELINE_START_NS=$(_ns)
  log "=========================================="
  log "ruflo sync-and-build starting (ADR-0027)"
  log "  --sync=${RUN_SYNC} --publish=${RUN_PUBLISH}"
  log "  --force=${FORCE_BUILD}"
  log "  --build-only=${BUILD_ONLY} --pull=${PULL_UPSTREAM}"
  log "=========================================="

  # Global timeout — 900s
  ( exec 9>&- 1>/dev/null 2>/dev/null; sleep 900; kill -TERM -$$ 2>/dev/null || kill -TERM $$ 2>/dev/null || true; sleep 5; kill -KILL -$$ 2>/dev/null || kill -KILL $$ 2>/dev/null || true ) &
  GLOBAL_TIMEOUT_PID=$!

  # Load previous state
  load_state

  # --seed-state: record current fork HEADs as baseline
  if [[ "${SEED_STATE}" == "true" ]]; then
    log "Seeding state file with current fork HEADs + upstream SHAs..."
    for i in "${!FORK_NAMES[@]}"; do
      local dir="${FORK_DIRS[$i]}"
      local name="${FORK_NAMES[$i]}"
      if [[ -d "${dir}/.git" ]]; then
        git -C "${dir}" fetch origin main --quiet 2>/dev/null || true
        local sha
        sha=$(git -C "${dir}" rev-parse origin/main 2>/dev/null) || sha=""
        set_fork_head "$name" "$sha"
        log "  ${name} fork: ${sha:0:12}"

        if git -C "${dir}" remote get-url upstream &>/dev/null; then
          git -C "${dir}" fetch upstream main --quiet 2>/dev/null || true
          local upstream_sha
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
    exit 0
  fi

  # --build-only mode: simplified pipeline (copy + codemod + build)
  if [[ "${BUILD_ONLY}" == "true" ]]; then
    for i in "${!FORK_NAMES[@]}"; do
      local dir="${FORK_DIRS[$i]}"
      local name="${FORK_NAMES[$i]}"
      if [[ -d "${dir}/.git" ]]; then
        if [[ "${PULL_UPSTREAM}" == "true" ]]; then
          log "Pulling fork: ${name}"
          git -C "${dir}" fetch origin main --quiet 2>/dev/null || true
          git -C "${dir}" reset --hard origin/main --quiet 2>/dev/null || true
        fi
        local sha
        sha=$(git -C "${dir}" rev-parse HEAD 2>/dev/null) || sha=""
        set_fork_head "$name" "$sha"
      fi
    done

    if [[ "${FORCE_BUILD}" == "false" ]] && check_build_freshness; then
      print_phase_summary
      log "Build is current — nothing to do"
      exit 0
    fi

    create_temp_dir
    run_phase "copy-source" copy_source
    run_phase "codemod" run_codemod
    run_phase "build" run_build
    write_build_manifest

    print_phase_summary
    log "=========================================="
    log "Build complete (--build-only mode)"
    log "Build artifacts at: ${TEMP_DIR}"
    log "=========================================="
    exit 0
  fi

  # Dispatch to stage scripts
  if [[ "${RUN_PUBLISH}" == "true" ]]; then
    FORCE_BUILD="${FORCE_BUILD}" bash "${SCRIPT_DIR}/ruflo-publish.sh" ${FORCE_BUILD:+--force}
  fi

  if [[ "${RUN_SYNC}" == "true" ]]; then
    FORCE_BUILD="${FORCE_BUILD}" BUILD_ONLY="${BUILD_ONLY}" bash "${SCRIPT_DIR}/ruflo-sync.sh" ${FORCE_BUILD:+--force}
  fi

  # End-to-end timing
  local _main_end_ns _main_ms
  _main_end_ns=$(_ns)
  _main_ms=$(_elapsed_ms "$PIPELINE_START_NS" "$_main_end_ns")
  if [[ "$_main_ms" -gt 0 ]]; then
    log "=========================================="
    log "ruflo sync-and-build complete (${_main_ms}ms / $((_main_ms / 1000))s)"
    log "=========================================="
  else
    log "=========================================="
    log "ruflo sync-and-build complete"
    log "=========================================="
  fi
}

main "$@"
