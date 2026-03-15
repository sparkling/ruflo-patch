#!/usr/bin/env bash
# scripts/ruflo-publish.sh — Publish stage (ADR-0039)
#
# Self-contained publish stage: detect merges to fork main, bump versions,
# build, test (preflight + unit + acceptance), publish to local Verdaccio.
#
# Usage: bash scripts/ruflo-publish.sh [--force]
#
# Called by sync-and-build.sh dispatcher or directly via npm run.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

STATE_FILE="${SCRIPT_DIR}/.last-build-state"
TEMP_DIR=""

# ---------------------------------------------------------------------------
# Mutable state
# ---------------------------------------------------------------------------

NEW_RUFLO_HEAD=""
NEW_AGENTIC_HEAD=""
NEW_FANN_HEAD=""
NEW_RUVECTOR_HEAD=""
UPSTREAM_RUFLO_SHA=""
UPSTREAM_AGENTIC_SHA=""
UPSTREAM_FANN_SHA=""
UPSTREAM_RUVECTOR_SHA=""
CHANGED_FORK_SHAS=""
CHANGED_PACKAGES_JSON="all"
DIRECTLY_CHANGED_JSON="all"
BUILD_VERSION=""
BUILD_COMPILED_COUNT=""
BUILD_TOTAL_COUNT=""
PENDING_VERSION_PUSHES=()
GLOBAL_TIMEOUT_PID=""

# Parse flags
FORCE_BUILD="${FORCE_BUILD:-false}"
for arg in "$@"; do
  case "$arg" in
    --force) FORCE_BUILD=true ;;
  esac
done

# ---------------------------------------------------------------------------
# Sourced libraries
# ---------------------------------------------------------------------------

source "${PROJECT_DIR}/lib/fork-paths.sh"
source "${PROJECT_DIR}/lib/pipeline-utils.sh"
source "${PROJECT_DIR}/lib/email-notify.sh"
source "${PROJECT_DIR}/lib/github-issues.sh"
source "${PROJECT_DIR}/lib/pipeline-helpers.sh"

# Initialise timing files
: > "$TIMING_CMDS_FILE"
: > "$TIMING_BUILD_PKGS_FILE"

# Environment
: "${RUFLO_NOTIFY_EMAIL:=}"

# ---------------------------------------------------------------------------
# check_merged_prs — detect new commits on fork origin/main
# ---------------------------------------------------------------------------

check_merged_prs() {
  local any_changed=false
  CHANGED_FORK_SHAS=""

  # Pass 1: launch all fetches in parallel
  local fetch_pids=()
  local fetch_start_ns
  fetch_start_ns=$(date +%s%N 2>/dev/null || echo 0)
  for i in "${!FORK_NAMES[@]}"; do
    local dir="${FORK_DIRS[$i]}"
    [[ -d "${dir}/.git" ]] || continue
    git -C "${dir}" fetch origin main --quiet 2>/dev/null &
    fetch_pids+=($!)
  done
  wait "${fetch_pids[@]}" 2>/dev/null || true
  local fetch_end_ns
  fetch_end_ns=$(date +%s%N 2>/dev/null || echo 0)
  if [[ "$fetch_start_ns" != "0" && "$fetch_end_ns" != "0" ]]; then
    local _fetch_all_ms=$(( (fetch_end_ns - fetch_start_ns) / 1000000 ))
    log "  fetch all forks (parallel): ${_fetch_all_ms}ms"
    add_cmd_timing "merge-detect" "git fetch all (parallel)" "${_fetch_all_ms}"
  fi

  # Pass 2: process results (SHA compare, fast-forward)
  for i in "${!FORK_NAMES[@]}"; do
    local name="${FORK_NAMES[$i]}"
    local dir="${FORK_DIRS[$i]}"

    if [[ ! -d "${dir}/.git" ]]; then
      log_error "Fork directory ${dir} is not a git repo"
      continue
    fi

    local origin_sha state_sha
    origin_sha=$(git -C "${dir}" rev-parse origin/main 2>/dev/null) || continue

    case "$name" in
      ruflo)        state_sha="${PREV_RUFLO_HEAD:-}" ;;
      agentic-flow) state_sha="${PREV_AGENTIC_HEAD:-}" ;;
      ruv-FANN)     state_sha="${PREV_FANN_HEAD:-}" ;;
      ruvector)     state_sha="${PREV_RUVECTOR_HEAD:-}" ;;
    esac

    if [[ -z "$state_sha" ]]; then
      log "No previous state for ${name} — treating as new (origin=${origin_sha:0:12})"
      any_changed=true
      if [[ -n "$CHANGED_FORK_SHAS" ]]; then
        CHANGED_FORK_SHAS="${CHANGED_FORK_SHAS},${dir}:"
      else
        CHANGED_FORK_SHAS="${dir}:"
      fi
    elif [[ "$origin_sha" == "$state_sha" ]]; then
      log "No new merges for ${name} (origin=${origin_sha:0:12})"
    elif git -C "${dir}" merge-base --is-ancestor "$origin_sha" "$state_sha" 2>/dev/null; then
      log "No new merges for ${name} (state ahead: state=${state_sha:0:12}, origin=${origin_sha:0:12})"
    else
      log "New commits on origin/main for ${name}: state=${state_sha:0:12} -> origin=${origin_sha:0:12}"
      any_changed=true
      if [[ -n "$CHANGED_FORK_SHAS" ]]; then
        CHANGED_FORK_SHAS="${CHANGED_FORK_SHAS},${dir}:${state_sha}"
      else
        CHANGED_FORK_SHAS="${dir}:${state_sha}"
      fi
    fi

    # Always fast-forward local main to origin/main
    local _ff_start _ff_end
    _ff_start=$(date +%s%N 2>/dev/null || echo 0)
    git -C "${dir}" checkout main --quiet 2>/dev/null || true
    git -C "${dir}" merge --ff-only origin/main --quiet 2>/dev/null || {
      git -C "${dir}" reset --hard origin/main --quiet 2>/dev/null || true
    }
    _ff_end=$(date +%s%N 2>/dev/null || echo 0)
    if [[ "$_ff_start" != "0" && "$_ff_end" != "0" ]]; then
      local _ff_ms=$(( (_ff_end - _ff_start) / 1000000 ))
      log "  fast-forward ${name}: ${_ff_ms}ms"
      add_cmd_timing "merge-detect" "git ff-merge ${name}" "${_ff_ms}"
    fi

    local new_sha
    new_sha=$(git -C "${dir}" rev-parse HEAD 2>/dev/null) || continue
    case "$name" in
      ruflo)        NEW_RUFLO_HEAD="$new_sha" ;;
      agentic-flow) NEW_AGENTIC_HEAD="$new_sha" ;;
      ruv-FANN)     NEW_FANN_HEAD="$new_sha" ;;
      ruvector)     NEW_RUVECTOR_HEAD="$new_sha" ;;
    esac
  done

  if [[ "$any_changed" == "true" ]]; then
    return 0
  fi
  return 1
}

# ---------------------------------------------------------------------------
# bump_fork_versions — bump versions, commit, tag
# ---------------------------------------------------------------------------

bump_fork_versions() {
  local dirs_args=()
  for dir in "${FORK_DIRS[@]}"; do
    [[ -d "${dir}/.git" ]] && dirs_args+=("${dir}")
  done

  if [[ ${#dirs_args[@]} -eq 0 ]]; then
    log "No fork directories found — skipping version bump"
    return 0
  fi

  local -a bump_extra_args=()
  if [[ -n "${CHANGED_FORK_SHAS:-}" && "${FORCE_BUILD}" != "true" ]]; then
    bump_extra_args+=(--changed-shas "${CHANGED_FORK_SHAS}")
    log "Selective bump: --changed-shas ${CHANGED_FORK_SHAS}"
  else
    log "Bumping versions across all forks (full bump)"
  fi

  local bump_output _bump_start _bump_end
  _bump_start=$(date +%s%N 2>/dev/null || echo 0)
  bump_output=$(node "${SCRIPT_DIR}/fork-version.mjs" bump \
    "${bump_extra_args[@]+"${bump_extra_args[@]}"}" "${dirs_args[@]}" 2>&1) || {
    log_error "Version bump failed: ${bump_output}"
    return 1
  }
  _bump_end=$(date +%s%N 2>/dev/null || echo 0)
  log "${bump_output}"
  if [[ "$_bump_start" != "0" && "$_bump_end" != "0" ]]; then
    add_cmd_timing "bump-versions" "node fork-version.mjs bump" "$(( (_bump_end - _bump_start) / 1000000 ))"
  fi

  CHANGED_PACKAGES_JSON=$(echo "$bump_output" | grep '^BUMPED_PACKAGES:' | sed 's/^BUMPED_PACKAGES://') || true
  [[ -z "${CHANGED_PACKAGES_JSON}" ]] && CHANGED_PACKAGES_JSON="all"
  DIRECTLY_CHANGED_JSON=$(echo "$bump_output" | grep '^DIRECTLY_CHANGED:' | sed 's/^DIRECTLY_CHANGED://') || true
  [[ -z "${DIRECTLY_CHANGED_JSON}" ]] && DIRECTLY_CHANGED_JSON="${CHANGED_PACKAGES_JSON}"
  log "Build set (source changed): ${DIRECTLY_CHANGED_JSON}"
  log "Publish set (+ dependents): ${CHANGED_PACKAGES_JSON}"

  if [[ "${CHANGED_PACKAGES_JSON}" == "[]" ]]; then
    log "No packages changed — skipping build and publish"
    for i in "${!FORK_NAMES[@]}"; do
      local dir="${FORK_DIRS[$i]}"
      local name="${FORK_NAMES[$i]}"
      [[ -d "${dir}/.git" ]] || continue
      local sha
      sha=$(git -C "${dir}" rev-parse HEAD 2>/dev/null) || continue
      case "$name" in
        ruflo)        NEW_RUFLO_HEAD="$sha" ;;
        agentic-flow) NEW_AGENTIC_HEAD="$sha" ;;
        ruv-FANN)     NEW_FANN_HEAD="$sha" ;;
        ruvector)     NEW_RUVECTOR_HEAD="$sha" ;;
      esac
    done
    save_state
    return 0
  fi

  # Commit and tag each fork that changed
  for i in "${!FORK_NAMES[@]}"; do
    local name="${FORK_NAMES[$i]}"
    local dir="${FORK_DIRS[$i]}"
    [[ -d "${dir}/.git" ]] || continue

    git -C "${dir}" add -A
    local has_changes
    has_changes=$(git -C "${dir}" diff --cached --name-only 2>/dev/null) || true
    if [[ -n "$has_changes" ]]; then
      local cli_version _bv_commit_start
      cli_version=$(node -e "
        const { findPackages } = await import('${SCRIPT_DIR}/fork-version.mjs');
        const pkgs = findPackages('${dir}');
        console.log(pkgs.length > 0 ? pkgs[0].pkg.version : 'unknown');
      " --input-type=module 2>/dev/null) || cli_version="unknown"

      _bv_commit_start=$(date +%s%N 2>/dev/null || echo 0)
      git -C "${dir}" commit -m "chore: bump versions to ${cli_version}" --quiet 2>/dev/null || true

      local tag="v${cli_version}"
      git -C "${dir}" tag -a "$tag" -m "Release ${tag}" 2>/dev/null || {
        log "Tag ${tag} already exists in ${name} — skipping"
      }
      local _bv_commit_end
      _bv_commit_end=$(date +%s%N 2>/dev/null || echo 0)
      if [[ "$_bv_commit_start" != "0" && "$_bv_commit_end" != "0" ]]; then
        local _bvc_ms=$(( (_bv_commit_end - _bv_commit_start) / 1000000 ))
        log "  commit+tag ${name}: ${_bvc_ms}ms"
        add_cmd_timing "bump-versions" "git commit+tag ${name}" "${_bvc_ms}"
      fi

      PENDING_VERSION_PUSHES+=("${dir}")
      log "Version bump committed for ${name}: ${cli_version} (push deferred)"
    else
      log "No version changes in ${name} — skipping commit"
    fi
  done
}

# ---------------------------------------------------------------------------
# push_fork_version_bumps — push deferred version commits
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
# Main: publish stage pipeline
# ---------------------------------------------------------------------------

main() {
  PIPELINE_START_NS=$(date +%s%N 2>/dev/null || echo 0)
  log "────────────────────────────────────────────────"
  log "Publish stage (detect merged PRs, build, publish)"
  log "────────────────────────────────────────────────"

  # Load previous state
  load_state

  # Check for new merges to fork main branches
  local has_merges=false
  local _md_start _md_end _md_ms
  _md_start=$(date +%s%N 2>/dev/null || echo 0)
  if check_merged_prs; then
    has_merges=true
  fi
  _md_end=$(date +%s%N 2>/dev/null || echo 0)
  _md_ms=0; [[ "$_md_start" != "0" && "$_md_end" != "0" ]] && _md_ms=$(( (_md_end - _md_start) / 1000000 ))
  log "  Phase 'merge-detect' completed in ${_md_ms}ms"
  PHASE_TIMINGS="${PHASE_TIMINGS} merge-detect:${_md_ms}"

  if [[ "$has_merges" == "false" && "$FORCE_BUILD" == "false" ]]; then
    log "No new merges detected — skipping publish stage"
    return 0
  fi

  # Bump versions in forks
  run_phase "bump-versions" bump_fork_versions

  # Update NEW_*_HEAD after bump (the bump created new commits)
  for i in "${!FORK_NAMES[@]}"; do
    local dir="${FORK_DIRS[$i]}"
    local name="${FORK_NAMES[$i]}"
    local sha
    sha=$(git -C "${dir}" rev-parse HEAD 2>/dev/null) || continue
    case "$name" in
      ruflo)        NEW_RUFLO_HEAD="$sha" ;;
      agentic-flow) NEW_AGENTIC_HEAD="$sha" ;;
      ruv-FANN)     NEW_FANN_HEAD="$sha" ;;
      ruvector)     NEW_RUVECTOR_HEAD="$sha" ;;
    esac
  done

  # Build pipeline: copy -> codemod -> build
  create_temp_dir
  run_phase "copy-source" copy_source
  run_phase "codemod" run_codemod
  # Run build and preflight + unit tests in parallel
  run_phase "test-ci" run_tests_ci &
  local _test_pid=$!
  run_phase "build" run_build
  write_build_manifest

  # Wait for parallel test-ci to complete
  if ! wait "$_test_pid"; then
    log_error "test-ci failed (ran in parallel with build)"
    return 1
  fi

  # Publish to local Verdaccio + run acceptance tests
  run_phase "publish-verdaccio" run_publish_verdaccio
  run_phase "acceptance" run_acceptance

  # Record successful verification so sync stage can skip redundant acceptance
  local _verify_manifest="/tmp/ruflo-build/.last-verified.json"
  local _verify_codemod_hash
  _verify_codemod_hash=$(sha256sum "${SCRIPT_DIR}/codemod.mjs" 2>/dev/null | cut -d' ' -f1) || _verify_codemod_hash=""
  cat > "$_verify_manifest" <<VMANIFEST
{"ruflo_head":"${NEW_RUFLO_HEAD:-}","agentic_head":"${NEW_AGENTIC_HEAD:-}","fann_head":"${NEW_FANN_HEAD:-}","ruvector_head":"${NEW_RUVECTOR_HEAD:-}","codemod_hash":"${_verify_codemod_hash}","verified_at":"$(date -u '+%Y-%m-%dT%H:%M:%SZ')"}
VMANIFEST
  log "Verification manifest written"

  # Read version from fork package.json
  read_build_version

  # Save state after successful verify + publish
  save_state

  # Push deferred version bumps now that publish succeeded
  push_fork_version_bumps

  # Write JSON timing summary
  write_pipeline_summary

  print_phase_summary
  log "Publish stage complete: ${BUILD_VERSION}"
}

main "$@"
