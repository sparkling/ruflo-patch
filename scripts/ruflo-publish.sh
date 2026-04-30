#!/usr/bin/env bash
# scripts/ruflo-publish.sh — Publish stage (ADR-0039)
#
# Self-contained publish stage: detect merges to fork main, bump versions,
# build, test (preflight + unit + acceptance), publish to local Verdaccio.
#
# Usage: bash scripts/ruflo-publish.sh [--force]
#
# Called by ruflo.service or npm run deploy.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Concurrency guard — prevent overlapping timer + manual deploy runs
LOCKFILE="/tmp/ruflo-pipeline.lock"
exec 9>"${LOCKFILE}"
if ! flock -n 9; then
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] publish: another pipeline run holds ${LOCKFILE} — exiting" >&2
  exit 0
fi

STATE_FILE="${SCRIPT_DIR}/.last-build-state"

# ---------------------------------------------------------------------------
# Mutable state (single source of truth: lib/pipeline-state.sh)
# ---------------------------------------------------------------------------

source "${PROJECT_DIR}/lib/pipeline-state.sh"

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
  local _start; _start=$(_ns)
  for i in "${!FORK_NAMES[@]}"; do
    local dir="${FORK_DIRS[$i]}"
    [[ -d "${dir}/.git" ]] || continue
    git -C "${dir}" fetch origin main --quiet 2>/dev/null &
    fetch_pids+=($!)
  done
  wait "${fetch_pids[@]}" 2>/dev/null || true
  local _ms; _ms=$(_elapsed_ms "$_start" "$(_ns)")
  log "  fetch all forks (parallel): ${_ms}ms"
  add_cmd_timing "merge-detect" "git fetch all (parallel)" "$_ms"

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

    state_sha=$(get_prev_head "$name")

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

    # Try fast-forwarding local main to origin/main, but DO NOT reset
    # destructively if FF fails. A failing FF means local is ahead of
    # origin (= ruvnet, read-only) — that's our normal state when we
    # have unpublished fork commits ahead of upstream. A `reset --hard
    # origin/main` here would silently nuke our work; the bug bit us
    # 2026-04-30 wiping 12 trunk-pivot commits across 4 forks.
    local _ff_start; _ff_start=$(_ns)
    git -C "${dir}" checkout main --quiet 2>/dev/null || true
    if ! git -C "${dir}" merge --ff-only origin/main --quiet 2>/dev/null; then
      log "  ${name}: local main not FF of origin/main (likely ahead — local commits unpublished). Continuing without reset."
    fi
    local _ff_ms; _ff_ms=$(_elapsed_ms "$_ff_start" "$(_ns)")
    log "  fast-forward ${name}: ${_ff_ms}ms"
    add_cmd_timing "merge-detect" "git ff-merge ${name}" "$_ff_ms"

    local new_sha
    new_sha=$(git -C "${dir}" rev-parse HEAD 2>/dev/null) || continue
    set_fork_head "$name" "$new_sha"
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

  local bump_output _bump_start
  _bump_start=$(_ns)
  bump_output=$(node "${SCRIPT_DIR}/fork-version.mjs" bump \
    "${bump_extra_args[@]+"${bump_extra_args[@]}"}" "${dirs_args[@]}" 2>&1) || {
    log_error "Version bump failed: ${bump_output}"
    return 1
  }
  local _bump_ms; _bump_ms=$(_elapsed_ms "$_bump_start" "$(_ns)")
  log "${bump_output}"
  add_cmd_timing "bump-versions" "node fork-version.mjs bump" "$_bump_ms"

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
      set_fork_head "$name" "$sha"
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
      local cli_version
      cli_version=$(node -e "
        const { findPackages } = await import('${SCRIPT_DIR}/fork-version.mjs');
        const pkgs = findPackages('${dir}');
        console.log(pkgs.length > 0 ? pkgs[0].pkg.version : 'unknown');
      " --input-type=module 2>/dev/null) || cli_version="unknown"

      local _ct_start; _ct_start=$(_ns)
      git -C "${dir}" commit -m "chore: bump versions to ${cli_version}" --quiet 2>/dev/null || true

      local tag="v${cli_version}"
      git -C "${dir}" tag -a "$tag" -m "Release ${tag}" 2>/dev/null || {
        log "Tag ${tag} already exists in ${name} — skipping"
      }
      local _ct_ms; _ct_ms=$(_elapsed_ms "$_ct_start" "$(_ns)")
      log "  commit+tag ${name}: ${_ct_ms}ms"
      add_cmd_timing "bump-versions" "git commit+tag ${name}" "$_ct_ms"

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
  local _start; _start=$(_ns)
  for dir in "${PENDING_VERSION_PUSHES[@]}"; do
    local name
    name=$(basename "$dir")
    (
      git -C "${dir}" push sparkling main --quiet 2>/dev/null || {
        echo "WARNING: Failed to push version bump for ${name}" >&2
      }
    ) &
    push_pids+=($!)
  done
  wait "${push_pids[@]}" 2>/dev/null || true
  local _ms; _ms=$(_elapsed_ms "$_start" "$(_ns)")
  log "  Parallel push completed in ${_ms}ms"
  add_cmd_timing "push-versions" "git push (${#PENDING_VERSION_PUSHES[@]} forks parallel)" "$_ms"
}

# ---------------------------------------------------------------------------
# Main: publish stage pipeline
# ---------------------------------------------------------------------------

main() {
  PIPELINE_START_NS=$(_ns)
  log "────────────────────────────────────────────────"
  log "Publish stage (detect merged PRs, build, publish)"
  log "────────────────────────────────────────────────"

  # Load previous state
  load_state

  # Check for new merges to fork main branches
  local has_merges=false
  local _md_start; _md_start=$(_ns)
  if check_merged_prs; then
    has_merges=true
  fi
  local _md_ms; _md_ms=$(_elapsed_ms "$_md_start" "$(_ns)")
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
    set_fork_head "$name" "$sha"
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
