#!/usr/bin/env bash
# scripts/ruflo-sync.sh — Sync stage (ADR-0039)
#
# Self-contained sync stage: fetch upstream, create sync branch, merge,
# type-check, build, test, create PR.
#
# Usage: bash scripts/ruflo-sync.sh [--force]
#
# Called by ruflo.service or npm run sync.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

STATE_FILE="${SCRIPT_DIR}/.last-build-state"

# Mutable state (single source of truth: lib/pipeline-state.sh)
source "${PROJECT_DIR}/lib/pipeline-state.sh"

# Parse flags
FORCE_BUILD="${FORCE_BUILD:-false}"
BUILD_ONLY="${BUILD_ONLY:-false}"
for arg in "$@"; do
  case "$arg" in
    --force) FORCE_BUILD=true ;;
  esac
done

# Sourced libraries
source "${PROJECT_DIR}/lib/fork-paths.sh"
source "${PROJECT_DIR}/lib/pipeline-utils.sh"
source "${PROJECT_DIR}/lib/email-notify.sh"
source "${PROJECT_DIR}/lib/github-issues.sh"
source "${PROJECT_DIR}/lib/pipeline-helpers.sh"

# Initialise timing files (idempotent)
: >> "$TIMING_CMDS_FILE"
: >> "$TIMING_BUILD_PKGS_FILE"

# Environment
: "${RUFLO_NOTIFY_EMAIL:=}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Build email URLs from _email_meta output and send a sync notification.
# Arguments: status title fork_name fork_dir branch pr_url message [extra]
_send_sync_email() {
  local status="$1" title="$2" fork_name="$3" fork_dir="$4"
  local branch="$5" pr_url="$6" message="$7" extra="${8:-}"

  _email_meta "$fork_dir"
  local _branch_url="" _upstream_url="" _fork_commit_url=""
  [[ -n "$_EML_FORK_URL" ]] && _branch_url="${_EML_FORK_URL}/tree/${branch}"
  [[ -n "$_EML_UPSTREAM_URL" && -n "$_EML_UPSTREAM_SHA" ]] && _upstream_url="${_EML_UPSTREAM_URL}/commit/${_EML_UPSTREAM_SHA}"
  [[ -n "$_EML_FORK_URL" && -n "$_EML_FORK_SHA" ]] && _fork_commit_url="${_EML_FORK_URL}/commit/${_EML_FORK_SHA}"

  local email_body
  email_body=$(_email_html_body "$status" \
    "$title" \
    "$fork_name" "$branch" "$_branch_url" \
    "$pr_url" "$_upstream_url" \
    "$_EML_FORK_URL" "$_fork_commit_url" \
    "$message" "$extra")
  send_email "[ruflo] ${title}" "$email_body"
}

# Add upstream remotes if not present
_add_upstream_remotes() {
  for i in "${!FORK_NAMES[@]}"; do
    local dir="${FORK_DIRS[$i]}"
    [[ -d "${dir}/.git" ]] || continue
    if ! git -C "${dir}" remote get-url upstream &>/dev/null; then
      git -C "${dir}" remote add upstream "${UPSTREAM_URLS[$i]}" 2>/dev/null || true
    fi
  done
}

# Fetch all upstream repos in parallel
_fetch_upstream_parallel() {
  local _uf_start
  _uf_start=$(_ns)
  local upstream_fetch_pids=()
  for i in "${!FORK_NAMES[@]}"; do
    local dir="${FORK_DIRS[$i]}"
    [[ -d "${dir}/.git" ]] || continue
    git -C "${dir}" fetch upstream main --quiet 2>/dev/null &
    upstream_fetch_pids+=($!)
  done
  wait "${upstream_fetch_pids[@]}" 2>/dev/null || true
  local _uf_ms; _uf_ms=$(_elapsed_ms "$_uf_start" "$(_ns)")
  if [[ "$_uf_ms" -gt 0 ]]; then
    log "  fetch all upstream (parallel): ${_uf_ms}ms"
    add_cmd_timing "sync-upstream" "git fetch upstream all (parallel)" "${_uf_ms}"
  fi
}

# Create sync branches and merge upstream
_create_sync_branches() {
  local branch_name="$1"
  shift
  local -a forks_to_sync=("$@")

  # Clean up stale local sync branches from previous runs
  for i in "${!FORK_NAMES[@]}"; do
    local dir="${FORK_DIRS[$i]}"
    [[ -d "${dir}/.git" ]] || continue
    local stale_branches
    stale_branches=$(git -C "${dir}" branch --list 'sync/*' 2>/dev/null) || true
    if [[ -n "$stale_branches" ]]; then
      git -C "${dir}" checkout main --quiet 2>/dev/null || true
      echo "$stale_branches" | while IFS= read -r branch; do
        branch=$(echo "$branch" | tr -d ' *')
        [[ -n "$branch" ]] && git -C "${dir}" branch -D "$branch" --quiet 2>/dev/null || true
      done
      log "  Cleaned stale sync branches in ${FORK_NAMES[$i]}"
    fi
  done

  # Create sync branches and merge upstream
  for i in "${forks_to_sync[@]}"; do
    local name="${FORK_NAMES[$i]}"
    local dir="${FORK_DIRS[$i]}"

    log "Creating sync branch ${branch_name} in ${name}"
    git -C "${dir}" checkout main --quiet 2>/dev/null
    git -C "${dir}" checkout -b "${branch_name}" --quiet 2>/dev/null || {
      log_error "Failed to create branch ${branch_name} in ${name}"
      continue
    }

    # Attempt merge
    local _merge_start
    _merge_start=$(_ns)
    if ! git -C "${dir}" merge --no-edit upstream/main 2>/dev/null; then
      log_error "Merge conflict in ${name}"
      git -C "${dir}" merge --abort 2>/dev/null || true

      git -C "${dir}" checkout main --quiet 2>/dev/null
      local conflict_pr_url
      conflict_pr_url=$(create_sync_pr "${dir}" "${name}" "${branch_name}" "conflict" \
        "Merge conflict when syncing upstream/main. Manual resolution required.")

      _send_sync_email "error" "Merge conflict in ${name}" \
        "$name" "$dir" "$branch_name" "$conflict_pr_url" \
        "Upstream sync for ${name} has merge conflicts. Manual resolution required."
      create_failure_issue "sync-conflict-${name}" "1"
      return 1
    fi
    local _merge_ms
    _merge_ms=$(_elapsed_ms "$_merge_start" "$(_ns)")
    if [[ "$_merge_ms" -gt 0 ]]; then
      log "  merge upstream ${name}: ${_merge_ms}ms"
      add_cmd_timing "sync-upstream" "git merge ${name}" "${_merge_ms}"
    fi

    log "Merged upstream/main into ${branch_name} for ${name}"

    local upstream_sha
    upstream_sha=$(git -C "${dir}" rev-parse upstream/main 2>/dev/null) || true
    set_upstream_sha "$name" "$upstream_sha"
  done
}

# Type-check a single fork on its sync branch.
# Arguments: name dir branch_name tsconfig_path
_typecheck_one_fork() {
  local name="$1" dir="$2" branch_name="$3" tsconfig_path="$4"

  local tsc_bin="${dir}/node_modules/.bin/tsc"
  [[ -x "$tsc_bin" ]] || tsc_bin="npx tsc"

  log "Type-checking ${name} via ${tsconfig_path} on sync branch"
  local _tc_start _tsc_output
  _tc_start=$(_ns)
  _tsc_output=$(cd "${dir}" && $tsc_bin --noEmit --skipLibCheck --project "$tsconfig_path" 2>&1) || true

  if echo "$_tsc_output" | grep -q "error TS"; then
    local _tc_ms; _tc_ms=$(_elapsed_ms "$_tc_start" "$(_ns)")
    add_cmd_timing "sync-upstream" "tsc --noEmit ${name}" "$_tc_ms"
    log_error "Type-check failed for ${name}"

    local ce_pr_url
    ce_pr_url=$(create_sync_pr "${dir}" "${name}" "${branch_name}" "compile-error" \
      "TypeScript compilation failed after merging upstream/main.")

    # Sanitise tsc errors for HTML email
    local _tsc_errors
    _tsc_errors=$(echo "$_tsc_output" | grep "error TS" | head -20)
    _tsc_errors="${_tsc_errors//&/&amp;}"
    _tsc_errors="${_tsc_errors//</&lt;}"
    _tsc_errors="${_tsc_errors//>/&gt;}"

    _send_sync_email "error" "Compile error in ${name}" \
      "$name" "$dir" "$branch_name" "$ce_pr_url" \
      "TypeScript compilation failed for ${name} after syncing upstream." \
      "$_tsc_errors"
    create_failure_issue "sync-compile-error-${name}" "1"

    git -C "${dir}" checkout main --quiet 2>/dev/null
    return 1
  fi

  local _tc_ms; _tc_ms=$(_elapsed_ms "$_tc_start" "$(_ns)")
  add_cmd_timing "sync-upstream" "tsc --noEmit ${name}" "$_tc_ms"
  log "  type-check ${name}: ${_tc_ms}ms"
}

# Type-check each fork on the sync branch
_typecheck_sync_branches() {
  local branch_name="$1"
  shift
  local -a forks_to_sync=("$@")

  for i in "${forks_to_sync[@]}"; do
    local name="${FORK_NAMES[$i]}"
    local dir="${FORK_DIRS[$i]}"

    if [[ "$name" == "ruflo" && -f "${dir}/v3/tsconfig.json" ]]; then
      _typecheck_one_fork "$name" "$dir" "$branch_name" "v3/tsconfig.json" || return 1
    elif [[ -f "${dir}/tsconfig.json" ]]; then
      local tsc_bin="${dir}/node_modules/.bin/tsc"
      if [[ ! -x "$tsc_bin" ]]; then
        log "Skipping type-check for ${name} (no local tsc)"
        continue
      fi
      _typecheck_one_fork "$name" "$dir" "$branch_name" "tsconfig.json" || return 1
    fi
  done
}

# ---------------------------------------------------------------------------
# sync_upstream — orchestrate fetch, compare, merge, typecheck
# ---------------------------------------------------------------------------
sync_upstream() {
  local any_changed=false
  local timestamp
  timestamp=$(date -u '+%Y%m%dT%H%M%S')
  local branch_name="sync/upstream-${timestamp}"

  declare -a forks_to_sync=()

  _add_upstream_remotes
  _fetch_upstream_parallel

  for i in "${!FORK_NAMES[@]}"; do
    local name="${FORK_NAMES[$i]}"
    local dir="${FORK_DIRS[$i]}"
    [[ -d "${dir}/.git" ]] || continue

    local upstream_sha last_synced_sha
    upstream_sha=$(git -C "${dir}" rev-parse upstream/main 2>/dev/null) || continue
    last_synced_sha=$(get_upstream_sha "$name")

    if [[ "$upstream_sha" == "$last_synced_sha" ]]; then
      log "No new upstream commits for ${name} (SHA=${upstream_sha:0:12})"
      continue
    fi

    log "New upstream commits for ${name}: ${last_synced_sha:0:12} -> ${upstream_sha:0:12}"
    forks_to_sync+=("$i")
    any_changed=true
  done

  if [[ "$any_changed" == "false" && "$FORCE_BUILD" == "false" ]]; then
    log "No upstream changes to sync"
    return 1
  fi

  _create_sync_branches "$branch_name" "${forks_to_sync[@]}" || return 1
  _typecheck_sync_branches "$branch_name" "${forks_to_sync[@]}" || return 1

  return 0
}

# ---------------------------------------------------------------------------
# Main: sync stage pipeline
# ---------------------------------------------------------------------------
main() {
  log "────────────────────────────────────────────────"
  log "Sync stage (fetch upstream, create sync branches)"
  log "────────────────────────────────────────────────"

  # Load previous state
  load_state

  # Sync upstream into fork branches
  if ! sync_upstream; then
    log "No upstream changes — skipping sync build"
    return 0
  fi

  # Save upstream SHA state immediately
  save_state

  # Read current fork HEADs for verify dedup check
  for i in "${!FORK_NAMES[@]}"; do
    local dir="${FORK_DIRS[$i]}"
    local name="${FORK_NAMES[$i]}"
    [[ -d "${dir}/.git" ]] || continue
    local sha
    sha=$(git -C "${dir}" rev-parse HEAD 2>/dev/null) || continue
    set_fork_head "$name" "$sha"
  done

  # Reuse build artifacts if publish stage already built from same fork HEADs
  if check_build_freshness; then
    log "Reusing existing build artifacts from publish stage"
    TEMP_DIR="/tmp/ruflo-build"
  else
    create_temp_dir
    run_phase "copy-source" copy_source
    run_phase "codemod" run_codemod
    run_phase "build" run_build
  fi

  if [[ "${BUILD_ONLY}" == "true" ]]; then
    print_phase_summary
    log "Sync build complete (--build-only mode). Artifacts at: ${TEMP_DIR}"
    for dir in "${FORK_DIRS[@]}"; do
      git -C "${dir}" checkout main --quiet 2>/dev/null || true
    done
    return 0
  fi

  # Test — skip expensive acceptance if publish stage already verified
  local tests_passed=false skip_acceptance=false
  local _verify_manifest="/tmp/ruflo-build/.last-verified.json"
  if check_build_freshness && [[ -f "$_verify_manifest" ]]; then
    local _vm_data
    _vm_data=$(node -e "
      const m=JSON.parse(require('fs').readFileSync('$_verify_manifest','utf-8'));
      console.log([m.ruflo_head,m.agentic_head,m.fann_head,m.ruvector_head,m.codemod_hash].join(':'));
    " 2>/dev/null) || _vm_data=""

    local _vm_ruflo _vm_agentic _vm_fann _vm_ruvector _vm_codemod
    IFS=':' read -r _vm_ruflo _vm_agentic _vm_fann _vm_ruvector _vm_codemod <<< "$_vm_data"
    local _current_codemod
    _current_codemod=$(sha256sum "${SCRIPT_DIR}/codemod.mjs" 2>/dev/null | cut -d' ' -f1) || _current_codemod=""

    if [[ "${_vm_ruflo}" == "${NEW_RUFLO_HEAD}" && \
          "${_vm_agentic}" == "${NEW_AGENTIC_HEAD}" && \
          "${_vm_fann}" == "${NEW_FANN_HEAD}" && \
          "${_vm_ruvector}" == "${NEW_RUVECTOR_HEAD}" && \
          "${_vm_codemod}" == "${_current_codemod}" ]]; then
      log "Skipping acceptance — already verified by publish stage"
      skip_acceptance=true
    fi
  fi

  if [[ "$skip_acceptance" == "true" ]]; then
    run_tests_ci && tests_passed=true
  else
    run_tests && tests_passed=true
  fi

  # Create PRs for each fork that was synced
  for i in "${!FORK_NAMES[@]}"; do
    local name="${FORK_NAMES[$i]}"
    local dir="${FORK_DIRS[$i]}"

    local current_branch
    current_branch=$(git -C "${dir}" branch --show-current 2>/dev/null) || continue
    [[ "$current_branch" == sync/* ]] || continue

    if [[ "$tests_passed" == "true" ]]; then
      local ready_pr_url
      ready_pr_url=$(create_sync_pr "${dir}" "${name}" "${current_branch}" "ready" \
        "All tests passed (preflight + unit + acceptance). Ready for review and merge.")
      _send_sync_email "success" "Sync PR ready for ${name}" \
        "$name" "$dir" "$current_branch" "$ready_pr_url" \
        "Upstream sync for ${name} is ready for review. All tests passed."
    else
      local fail_pr_url
      fail_pr_url=$(create_sync_pr "${dir}" "${name}" "${current_branch}" "test-failure" \
        "Tests failed during sync validation. Review required.")
      _send_sync_email "warning" "Sync test failure for ${name}" \
        "$name" "$dir" "$current_branch" "$fail_pr_url" \
        "Upstream sync for ${name} failed tests. Manual review required."
      create_failure_issue "sync-test-failure-${name}" "1"
    fi

    git -C "${dir}" checkout main --quiet 2>/dev/null || true
  done

  # Ensure all forks are back on main after sync
  for dir in "${FORK_DIRS[@]}"; do
    git -C "${dir}" checkout main --quiet 2>/dev/null || true
  done

  # Save upstream SHA state
  save_state

  print_phase_summary
  log "Sync stage complete"
}

main "$@"
