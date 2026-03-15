#!/usr/bin/env bash
# sync-and-build.sh — Fork-based build pipeline for ruflo (ADR-0027).
#
# Three stages (review gate is manual, not in this script):
#
#   --publish   Publish stage: Detect merges to fork main, bump versions,
#               build, test (preflight + unit + acceptance), publish to local Verdaccio.
#
#   --sync      Sync stage: Fetch upstream, create sync branch, merge,
#               type-check, build, test (preflight + unit + acceptance). On success create PR
#               with label "ready". On failure create PR with error label.
#
# Publish runs before Sync when both are requested (default).
# Review gate (manual PR merge on GitHub) happens between timer runs.
#
# Flags:
#   --sync        Sync stage only
#   --publish     Publish stage only
#   --force       Build even when no changes detected
#   --build-only  Stop after build (no tests, no publish)
#   --pull        Pull upstream repos in --build-only mode
#   --seed-state  Record current fork HEADs as baseline (no build)
#
# See: ADR-0027 (fork migration), ADR-0009 (systemd timer),
#      ADR-0023 (test framework), ADR-0026 (build caching)

set -euo pipefail

# ---------------------------------------------------------------------------
# CLI flags (parsed before concurrency guard so --build-only can skip it)
# ---------------------------------------------------------------------------

RUN_SYNC=false
RUN_PUBLISH=false
FORCE_BUILD=false
BUILD_ONLY=false
PULL_UPSTREAM=false
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

Stages:
  Publish stage  Detect merged PRs, bump versions, build, test, publish
  Review gate    (manual) Operator reviews and merges PR on GitHub
  Sync stage     Fetch upstream, branch, type-check, codemod, build, test, create PR

See: docs/pipeline-reference.md
USAGE
      exit 0
      ;;
    -*) echo "Error: Unknown flag: $arg (use --help for usage)"; exit 1 ;;
  esac
done
SEED_STATE="${SEED_STATE:-false}"

# Default: run both stages
if [[ "${RUN_SYNC}" == "false" && "${RUN_PUBLISH}" == "false" ]]; then
  RUN_SYNC=true
  RUN_PUBLISH=true
fi

# ---------------------------------------------------------------------------
# Concurrency guard — prevent overlapping runs (ADR-0027)
# Skipped for --build-only (local build doesn't conflict with pipeline)
# ---------------------------------------------------------------------------
if [[ "$BUILD_ONLY" != "true" ]]; then
  LOCKFILE="/tmp/ruflo-sync-and-build.lock"
  exec 9>"$LOCKFILE"
  if ! flock -n 9; then
    # Lock is held — check if the holder is still alive
    LOCK_HOLDER=$(fuser "$LOCKFILE" 2>/dev/null | tr -d ' ') || LOCK_HOLDER=""
    if [[ -n "$LOCK_HOLDER" ]]; then
      HOLDER_CMD=$(ps -p "$LOCK_HOLDER" -o comm= 2>/dev/null) || HOLDER_CMD=""
      if [[ "$HOLDER_CMD" == "sleep" ]]; then
        # Orphaned timeout subprocess holding the lock — kill it and retry
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
      # Holder is gone, lock fd leaked. Recreate the lock file.
      rm -f "$LOCKFILE"
      exec 9>"$LOCKFILE"
      flock -n 9 || { echo "Failed to reclaim lock — exiting"; exit 0; }
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Environment configuration
# ---------------------------------------------------------------------------
# RUFLO_NOTIFY_EMAIL — recipient for pipeline email notifications.
# Set in secrets.env (EnvironmentFile in systemd unit) or export before running.
# When unset, email notifications are logged but not sent.
: "${RUFLO_NOTIFY_EMAIL:=}"

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

STATE_FILE="${SCRIPT_DIR}/.last-build-state"

# Fork directories (ADR-0027: source is local forks, not upstream repos)
FORK_DIR_RUFLO="/home/claude/src/forks/ruflo"
FORK_DIR_AGENTIC="/home/claude/src/forks/agentic-flow"
FORK_DIR_FANN="/home/claude/src/forks/ruv-FANN"
FORK_DIR_RUVECTOR="/home/claude/src/forks/ruvector"

FORK_NAMES=("ruflo" "agentic-flow" "ruv-FANN" "ruvector")
FORK_DIRS=("${FORK_DIR_RUFLO}" "${FORK_DIR_AGENTIC}" "${FORK_DIR_FANN}" "${FORK_DIR_RUVECTOR}")

UPSTREAM_RUFLO="https://github.com/ruvnet/ruflo.git"
UPSTREAM_AGENTIC="https://github.com/ruvnet/agentic-flow.git"
UPSTREAM_FANN="https://github.com/ruvnet/ruv-FANN.git"
UPSTREAM_RUVECTOR="https://github.com/ruvnet/RuVector.git"

UPSTREAM_URLS=("${UPSTREAM_RUFLO}" "${UPSTREAM_AGENTIC}" "${UPSTREAM_FANN}" "${UPSTREAM_RUVECTOR}")

TEMP_DIR=""  # set in create_temp_dir, cleaned up on exit

# Track fork HEAD SHAs for state
NEW_RUFLO_HEAD=""
NEW_AGENTIC_HEAD=""
NEW_FANN_HEAD=""
NEW_RUVECTOR_HEAD=""

# Selective version bumping: tracks which forks changed (set by check_merged_prs)
CHANGED_FORK_SHAS=""  # format: dir1:oldSha,dir2:oldSha
# JSON array of @sparkleideas/* packages: CHANGED = full transitive set (for publish)
CHANGED_PACKAGES_JSON="all"
# DIRECTLY_CHANGED = source-changed only (for build — no transitive deps)
DIRECTLY_CHANGED_JSON="all"

# Build version (set by read_build_version)
BUILD_VERSION=""

# Build stats (set by run_build, used by write_build_manifest to avoid re-scanning)
BUILD_COMPILED_COUNT=""
BUILD_TOTAL_COUNT=""

# Deferred version bump pushes (populated by bump_fork_versions, pushed after publish)
PENDING_VERSION_PUSHES=()

# ---------------------------------------------------------------------------
# Sourced libraries (ADR-0038)
# ---------------------------------------------------------------------------

source "${PROJECT_DIR}/lib/pipeline-utils.sh"
source "${PROJECT_DIR}/lib/email-notify.sh"
source "${PROJECT_DIR}/lib/github-issues.sh"

# ---------------------------------------------------------------------------
# Thin wrappers — call standalone scripts (ADR-0038)
# ---------------------------------------------------------------------------

copy_source()         { bash "${SCRIPT_DIR}/copy-source.sh"; }
run_codemod()         { bash "${SCRIPT_DIR}/build-packages.sh" --codemod-only 2>/dev/null || node "${SCRIPT_DIR}/codemod.mjs" "${TEMP_DIR}"; }
run_build()           { TEMP_DIR="${TEMP_DIR}" CHANGED_PACKAGES_JSON="${CHANGED_PACKAGES_JSON:-all}" bash "${SCRIPT_DIR}/build-packages.sh"; }
write_build_manifest() {
  # Manifest writer is embedded in build-packages.sh; for standalone calls
  # use the function from pipeline-utils.sh if available, else inline.
  local manifest="${TEMP_DIR}/.build-manifest.json"
  local codemod_hash
  codemod_hash=$(sha256sum "${SCRIPT_DIR}/codemod.mjs" 2>/dev/null | cut -d' ' -f1) || codemod_hash=""
  local compiled_count="${BUILD_COMPILED_COUNT:-}"
  local total_count="${BUILD_TOTAL_COUNT:-}"
  [[ -z "$compiled_count" ]] && compiled_count=$(find "${TEMP_DIR}" -name "dist" -type d 2>/dev/null | wc -l)
  [[ -z "$total_count" ]] && total_count=$(find "${TEMP_DIR}" -name "package.json" -not -path "*/node_modules/*" -not -path "*/.tsc-toolchain/*" -exec grep -l '"@sparkleideas/' {} + 2>/dev/null | wc -l)
  cat > "$manifest" <<MANIFESTEOF
{
  "version": 2,
  "built_at": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "ruflo_head": "${NEW_RUFLO_HEAD:-}",
  "agentic_head": "${NEW_AGENTIC_HEAD:-}",
  "fann_head": "${NEW_FANN_HEAD:-}",
  "ruvector_head": "${NEW_RUVECTOR_HEAD:-}",
  "codemod_hash": "${codemod_hash}",
  "packages_compiled": ${compiled_count},
  "packages_total": ${total_count}
}
MANIFESTEOF
}

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------

GLOBAL_TIMEOUT_PID=""

trap cleanup EXIT

# ---------------------------------------------------------------------------
# Publish stage: Check for merged PRs (origin/main vs local main)
# ---------------------------------------------------------------------------

check_merged_prs() {
  # Returns 0 if any fork has new commits on origin/main since last build, 1 otherwise.
  # Compares origin/main SHA against the STATE FILE (not local main), so pushes
  # from this machine are detected correctly.
  # Updates NEW_*_HEAD variables and fast-forwards local main.
  # Sets CHANGED_FORK_SHAS (format: dir1:oldSha,dir2:oldSha) for selective bumping.
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

    # Get the SHA from the state file (last successfully processed build)
    case "$name" in
      ruflo)        state_sha="${PREV_RUFLO_HEAD:-}" ;;
      agentic-flow) state_sha="${PREV_AGENTIC_HEAD:-}" ;;
      ruv-FANN)     state_sha="${PREV_FANN_HEAD:-}" ;;
      ruvector)     state_sha="${PREV_RUVECTOR_HEAD:-}" ;;
    esac

    if [[ -z "$state_sha" ]]; then
      # No previous state — treat as new
      log "No previous state for ${name} — treating as new (origin=${origin_sha:0:12})"
      any_changed=true
      # Empty SHA after colon signals first run to fork-version.mjs
      if [[ -n "$CHANGED_FORK_SHAS" ]]; then
        CHANGED_FORK_SHAS="${CHANGED_FORK_SHAS},${dir}:"
      else
        CHANGED_FORK_SHAS="${dir}:"
      fi
    elif [[ "$origin_sha" == "$state_sha" ]]; then
      log "No new merges for ${name} (origin=${origin_sha:0:12})"
    elif git -C "${dir}" merge-base --is-ancestor "$origin_sha" "$state_sha" 2>/dev/null; then
      # origin/main is an ancestor of the state SHA — state is ahead (e.g., version bumps
      # that were pushed). This is NOT a new merge.
      log "No new merges for ${name} (state ahead: state=${state_sha:0:12}, origin=${origin_sha:0:12})"
    else
      # origin/main has commits not in state — new merge or push
      log "New commits on origin/main for ${name}: state=${state_sha:0:12} -> origin=${origin_sha:0:12}"
      any_changed=true
      # Record dir:oldSha for selective version bumping
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
      # If local has diverged (shouldn't normally happen), reset to origin
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
# Publish stage: Bump fork versions, commit, tag, push
# ---------------------------------------------------------------------------

bump_fork_versions() {
  # Bump all forks at once so cross-fork dep references are updated (ADR-0027)
  local dirs_args=()
  for dir in "${FORK_DIRS[@]}"; do
    [[ -d "${dir}/.git" ]] && dirs_args+=("${dir}")
  done

  if [[ ${#dirs_args[@]} -eq 0 ]]; then
    log "No fork directories found — skipping version bump"
    return 0
  fi

  # Build fork-version.mjs args: selective bump if we know which forks changed
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

  # Parse BUMPED_PACKAGES (full transitive set — for publish/promote)
  CHANGED_PACKAGES_JSON=$(echo "$bump_output" | grep '^BUMPED_PACKAGES:' | sed 's/^BUMPED_PACKAGES://') || true
  if [[ -z "${CHANGED_PACKAGES_JSON}" ]]; then
    CHANGED_PACKAGES_JSON="all"
  fi
  # Parse DIRECTLY_CHANGED (source-changed only — for build)
  DIRECTLY_CHANGED_JSON=$(echo "$bump_output" | grep '^DIRECTLY_CHANGED:' | sed 's/^DIRECTLY_CHANGED://') || true
  if [[ -z "${DIRECTLY_CHANGED_JSON}" ]]; then
    DIRECTLY_CHANGED_JSON="${CHANGED_PACKAGES_JSON}"
  fi
  log "Build set (source changed): ${DIRECTLY_CHANGED_JSON}"
  log "Publish set (+ dependents): ${CHANGED_PACKAGES_JSON}"

  # If no packages changed (e.g., commit was outside any package dir), skip build+publish
  if [[ "${CHANGED_PACKAGES_JSON}" == "[]" ]]; then
    log "No packages changed — skipping build and publish"
    log "  (The merge was detected but no package.json was in the changed files)"
    # Still save state so we don't re-detect this merge next run
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

  # Commit and push each fork that changed
  for i in "${!FORK_NAMES[@]}"; do
    local name="${FORK_NAMES[$i]}"
    local dir="${FORK_DIRS[$i]}"

    [[ -d "${dir}/.git" ]] || continue

    git -C "${dir}" add -A
    local has_changes
    has_changes=$(git -C "${dir}" diff --cached --name-only 2>/dev/null) || true
    if [[ -n "$has_changes" ]]; then
      local cli_version _bv_commit_start _bv_push_start _bv_push_end

      cli_version=$(node -e "
        const { findPackages } = await import('${SCRIPT_DIR}/fork-version.mjs');
        const pkgs = findPackages('${dir}');
        console.log(pkgs.length > 0 ? pkgs[0].pkg.version : 'unknown');
      " --input-type=module 2>/dev/null) || cli_version="unknown"

      _bv_commit_start=$(date +%s%N 2>/dev/null || echo 0)
      git -C "${dir}" commit -m "chore: bump versions to ${cli_version}" --quiet 2>/dev/null || true

      # Tag with version
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

      # Defer push until after successful publish
      PENDING_VERSION_PUSHES+=("${dir}")
      log "Version bump committed for ${name}: ${cli_version} (push deferred)"
    else
      log "No version changes in ${name} — skipping commit"
    fi
  done
}

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
# Sync stage: Fetch upstream into fork branches
# ---------------------------------------------------------------------------

sync_upstream() {
  # Fetch upstream changes and create sync branches.
  # Returns 0 if any fork has new upstream commits, 1 otherwise.
  local any_changed=false
  local timestamp
  timestamp=$(date -u '+%Y%m%dT%H%M%S')
  local branch_name="sync/upstream-${timestamp}"

  # Track which forks need syncing
  declare -a forks_to_sync=()

  # Parallel upstream fetch — add remotes first, then fetch all at once
  for i in "${!FORK_NAMES[@]}"; do
    local dir="${FORK_DIRS[$i]}"
    [[ -d "${dir}/.git" ]] || continue
    if ! git -C "${dir}" remote get-url upstream &>/dev/null; then
      git -C "${dir}" remote add upstream "${UPSTREAM_URLS[$i]}" 2>/dev/null || true
    fi
  done

  local _uf_start _uf_end
  _uf_start=$(date +%s%N 2>/dev/null || echo 0)
  local upstream_fetch_pids=()
  for i in "${!FORK_NAMES[@]}"; do
    local dir="${FORK_DIRS[$i]}"
    [[ -d "${dir}/.git" ]] || continue
    git -C "${dir}" fetch upstream main --quiet 2>/dev/null &
    upstream_fetch_pids+=($!)
  done
  wait "${upstream_fetch_pids[@]}" 2>/dev/null || true
  _uf_end=$(date +%s%N 2>/dev/null || echo 0)
  if [[ "$_uf_start" != "0" && "$_uf_end" != "0" ]]; then
    local _uf_ms=$(( (_uf_end - _uf_start) / 1000000 ))
    log "  fetch all upstream (parallel): ${_uf_ms}ms"
    add_cmd_timing "sync-upstream" "git fetch upstream all (parallel)" "${_uf_ms}"
  fi

  for i in "${!FORK_NAMES[@]}"; do
    local name="${FORK_NAMES[$i]}"
    local dir="${FORK_DIRS[$i]}"

    [[ -d "${dir}/.git" ]] || continue

    local upstream_sha last_synced_sha
    upstream_sha=$(git -C "${dir}" rev-parse upstream/main 2>/dev/null) || continue

    # Get last-synced SHA from state
    case "$name" in
      ruflo)        last_synced_sha="${UPSTREAM_RUFLO_SHA:-}" ;;
      agentic-flow) last_synced_sha="${UPSTREAM_AGENTIC_SHA:-}" ;;
      ruv-FANN)     last_synced_sha="${UPSTREAM_FANN_SHA:-}" ;;
      ruvector)     last_synced_sha="${UPSTREAM_RUVECTOR_SHA:-}" ;;
    esac

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
    local _merge_start _merge_end
    _merge_start=$(date +%s%N 2>/dev/null || echo 0)
    if ! git -C "${dir}" merge --no-edit upstream/main 2>/dev/null; then
      log_error "Merge conflict in ${name}"
      git -C "${dir}" merge --abort 2>/dev/null || true

      # Push the branch and create a PR with conflict label
      git -C "${dir}" checkout main --quiet 2>/dev/null
      local conflict_pr_url
      conflict_pr_url=$(create_sync_pr "${dir}" "${name}" "${branch_name}" "conflict" \
        "Merge conflict when syncing upstream/main. Manual resolution required.")

      _email_meta "$dir"
      local _conflict_branch_url=""
      [[ -n "$_EML_FORK_URL" ]] && _conflict_branch_url="${_EML_FORK_URL}/tree/${branch_name}"
      local _conflict_upstream_url=""
      [[ -n "$_EML_UPSTREAM_URL" && -n "$_EML_UPSTREAM_SHA" ]] && _conflict_upstream_url="${_EML_UPSTREAM_URL}/commit/${_EML_UPSTREAM_SHA}"
      local _conflict_fork_commit_url=""
      [[ -n "$_EML_FORK_URL" && -n "$_EML_FORK_SHA" ]] && _conflict_fork_commit_url="${_EML_FORK_URL}/commit/${_EML_FORK_SHA}"
      local conflict_email_body
      conflict_email_body=$(_email_html_body "error" \
        "Merge conflict in ${name}" \
        "$name" "$branch_name" "$_conflict_branch_url" \
        "$conflict_pr_url" "$_conflict_upstream_url" \
        "$_EML_FORK_URL" "$_conflict_fork_commit_url" \
        "Upstream sync for ${name} has merge conflicts. Manual resolution required.")
      send_email "[ruflo] Merge conflict in ${name}" "$conflict_email_body"
      create_failure_issue "sync-conflict-${name}" "1"
      return 1
    fi
    _merge_end=$(date +%s%N 2>/dev/null || echo 0)
    if [[ "$_merge_start" != "0" && "$_merge_end" != "0" ]]; then
      local _merge_ms=$(( (_merge_end - _merge_start) / 1000000 ))
      log "  merge upstream ${name}: ${_merge_ms}ms"
      add_cmd_timing "sync-upstream" "git merge ${name}" "${_merge_ms}"
    fi

    log "Merged upstream/main into ${branch_name} for ${name}"

    # Update upstream SHA tracking
    local upstream_sha
    upstream_sha=$(git -C "${dir}" rev-parse upstream/main 2>/dev/null) || true
    case "$name" in
      ruflo)        UPSTREAM_RUFLO_SHA="$upstream_sha" ;;
      agentic-flow) UPSTREAM_AGENTIC_SHA="$upstream_sha" ;;
      ruv-FANN)     UPSTREAM_FANN_SHA="$upstream_sha" ;;
      ruvector)     UPSTREAM_RUVECTOR_SHA="$upstream_sha" ;;
    esac
  done

  # Type-check each fork on the sync branch
  for i in "${forks_to_sync[@]}"; do
    local name="${FORK_NAMES[$i]}"
    local dir="${FORK_DIRS[$i]}"

    # ruflo fork: root tsconfig.json is broken (includes all v3/**/*.ts but
    # only maps @v3/*, not @claude-flow/*). Use v3/tsconfig.json instead —
    # it's the solution-style config with composite project references and
    # correct path mappings. Compiles the 11 maintained packages with 0 errors.
    if [[ "$name" == "ruflo" && -f "${dir}/v3/tsconfig.json" ]]; then
      log "Type-checking ${name} via v3/tsconfig.json on sync branch"
      local tsc_bin="${dir}/node_modules/.bin/tsc"
      if [[ ! -x "$tsc_bin" ]]; then
        tsc_bin="npx tsc"
      fi
      local _tc_start _tc_end
      _tc_start=$(date +%s%N 2>/dev/null || echo 0)
      local _tsc_output
      _tsc_output=$(cd "${dir}" && $tsc_bin --noEmit --skipLibCheck --project v3/tsconfig.json 2>&1) || true
      if [[ $? -ne 0 ]] || echo "$_tsc_output" | grep -q "error TS"; then
        _tc_end=$(date +%s%N 2>/dev/null || echo 0)
        if [[ "$_tc_start" != "0" && "$_tc_end" != "0" ]]; then
          local _tc_ms=$(( (_tc_end - _tc_start) / 1000000 ))
          log "  type-check ${name}: ${_tc_ms}ms"
          add_cmd_timing "sync-upstream" "tsc --noEmit ${name}" "${_tc_ms}"
        fi
        log_error "Type-check failed for ${name}"

        local ce_pr_url
        ce_pr_url=$(create_sync_pr "${dir}" "${name}" "${branch_name}" "compile-error" \
          "TypeScript compilation failed after merging upstream/main.")

        _email_meta "$dir"
        local _ce_branch_url=""
        [[ -n "$_EML_FORK_URL" ]] && _ce_branch_url="${_EML_FORK_URL}/tree/${branch_name}"
        local _ce_upstream_url=""
        [[ -n "$_EML_UPSTREAM_URL" && -n "$_EML_UPSTREAM_SHA" ]] && _ce_upstream_url="${_EML_UPSTREAM_URL}/commit/${_EML_UPSTREAM_SHA}"
        local _ce_fork_commit_url=""
        [[ -n "$_EML_FORK_URL" && -n "$_EML_FORK_SHA" ]] && _ce_fork_commit_url="${_EML_FORK_URL}/commit/${_EML_FORK_SHA}"
        # Include first 20 lines of tsc errors in the email, HTML-escaped
        local _tsc_errors
        _tsc_errors=$(echo "$_tsc_output" | grep "error TS" | head -20)
        _tsc_errors="${_tsc_errors//&/&amp;}"
        _tsc_errors="${_tsc_errors//</&lt;}"
        _tsc_errors="${_tsc_errors//>/&gt;}"
        local ce_email_body
        ce_email_body=$(_email_html_body "error" \
          "Compile error in ${name}" \
          "$name" "$branch_name" "$_ce_branch_url" \
          "$ce_pr_url" "$_ce_upstream_url" \
          "$_EML_FORK_URL" "$_ce_fork_commit_url" \
          "TypeScript compilation failed for ${name} after syncing upstream." \
          "$_tsc_errors")
        send_email "[ruflo] Compile error in ${name} sync" "$ce_email_body"
        create_failure_issue "sync-compile-error-${name}" "1"

        git -C "${dir}" checkout main --quiet 2>/dev/null
        return 1
      fi
      _tc_end=$(date +%s%N 2>/dev/null || echo 0)
      if [[ "$_tc_start" != "0" && "$_tc_end" != "0" ]]; then
        local _tc_ms=$(( (_tc_end - _tc_start) / 1000000 ))
        log "  type-check ${name}: ${_tc_ms}ms"
        add_cmd_timing "sync-upstream" "tsc --noEmit ${name}" "${_tc_ms}"
      fi
    # Other forks: use root tsconfig.json if present AND tsc is available
    elif [[ -f "${dir}/tsconfig.json" ]]; then
      local tsc_bin="${dir}/node_modules/.bin/tsc"
      if [[ ! -x "$tsc_bin" ]]; then
        # No local tsc — skip type-check (npx tsc fails without typescript installed)
        log "Skipping type-check for ${name} (no local tsc — install typescript in fork)"
        git -C "${dir}" checkout main --quiet 2>/dev/null
        continue
      fi
      log "Type-checking ${name} on sync branch"
      local _tc_start _tc_end
      _tc_start=$(date +%s%N 2>/dev/null || echo 0)
      local _tsc_output2
      _tsc_output2=$(cd "${dir}" && $tsc_bin --noEmit --skipLibCheck 2>&1) || true
      if [[ $? -ne 0 ]] || echo "$_tsc_output2" | grep -q "error TS"; then
        log_error "Type-check failed for ${name}"

        local ce2_pr_url
        ce2_pr_url=$(create_sync_pr "${dir}" "${name}" "${branch_name}" "compile-error" \
          "TypeScript compilation failed after merging upstream/main.")

        _email_meta "$dir"
        local _ce2_branch_url=""
        [[ -n "$_EML_FORK_URL" ]] && _ce2_branch_url="${_EML_FORK_URL}/tree/${branch_name}"
        local _ce2_upstream_url=""
        [[ -n "$_EML_UPSTREAM_URL" && -n "$_EML_UPSTREAM_SHA" ]] && _ce2_upstream_url="${_EML_UPSTREAM_URL}/commit/${_EML_UPSTREAM_SHA}"
        local _ce2_fork_commit_url=""
        [[ -n "$_EML_FORK_URL" && -n "$_EML_FORK_SHA" ]] && _ce2_fork_commit_url="${_EML_FORK_URL}/commit/${_EML_FORK_SHA}"
        local _tsc_errors2
        _tsc_errors2=$(echo "$_tsc_output2" | grep "error TS" | head -20)
        _tsc_errors2="${_tsc_errors2//&/&amp;}"
        _tsc_errors2="${_tsc_errors2//</&lt;}"
        _tsc_errors2="${_tsc_errors2//>/&gt;}"
        local ce2_email_body
        ce2_email_body=$(_email_html_body "error" \
          "Compile error in ${name}" \
          "$name" "$branch_name" "$_ce2_branch_url" \
          "$ce2_pr_url" "$_ce2_upstream_url" \
          "$_EML_FORK_URL" "$_ce2_fork_commit_url" \
          "TypeScript compilation failed for ${name} after syncing upstream." \
          "$_tsc_errors2")
        send_email "[ruflo] Compile error in ${name} sync" "$ce2_email_body"
        create_failure_issue "sync-compile-error-${name}" "1"

        # Switch back to main
        git -C "${dir}" checkout main --quiet 2>/dev/null
        return 1
      fi
      _tc_end=$(date +%s%N 2>/dev/null || echo 0)
      if [[ "$_tc_start" != "0" && "$_tc_end" != "0" ]]; then
        local _tc_ms=$(( (_tc_end - _tc_start) / 1000000 ))
        log "  type-check ${name}: ${_tc_ms}ms"
        add_cmd_timing "sync-upstream" "tsc --noEmit ${name}" "${_tc_ms}"
      fi
    fi
  done

  return 0
}

# ---------------------------------------------------------------------------
# Test (preflight + unit + acceptance)
# ---------------------------------------------------------------------------

run_tests_ci() {
  # preflight + unit only — no Verdaccio
  log "Running preflight + unit tests"
  local _pf_start _pf_end _ut_start _ut_end
  _pf_start=$(date +%s%N 2>/dev/null || echo 0)
  npm run preflight --prefix "${PROJECT_DIR}" || {
    log_error "Preflight failed"
    return 1
  }
  _pf_end=$(date +%s%N 2>/dev/null || echo 0)
  if [[ "$_pf_start" != "0" && "$_pf_end" != "0" ]]; then
    local _pf_ms=$(( (_pf_end - _pf_start) / 1000000 ))
    log "  Preflight: ${_pf_ms}ms"
    add_cmd_timing "test-ci" "npm run preflight" "${_pf_ms}"
  fi

  _ut_start=$(date +%s%N 2>/dev/null || echo 0)
  node "${PROJECT_DIR}/scripts/test-runner.mjs" || {
    log_error "Unit tests failed"
    return 1
  }
  _ut_end=$(date +%s%N 2>/dev/null || echo 0)
  if [[ "$_ut_start" != "0" && "$_ut_end" != "0" ]]; then
    local _ut_ms=$(( (_ut_end - _ut_start) / 1000000 ))
    log "  Unit tests: ${_ut_ms}ms"
    add_cmd_timing "test-ci" "node test-runner.mjs" "${_ut_ms}"
  fi
}

run_publish_verdaccio() {
  # Publish + promote to local Verdaccio (always — no external consumers)
  local -a args=(--build-dir "${TEMP_DIR}")
  [[ -n "${CHANGED_PACKAGES_JSON:-}" && "${CHANGED_PACKAGES_JSON}" != "all" ]] && \
    args+=(--changed-packages "${CHANGED_PACKAGES_JSON}")
  bash "${SCRIPT_DIR}/publish-verdaccio.sh" "${args[@]}"
}

run_acceptance() {
  bash "${SCRIPT_DIR}/test-acceptance.sh" --registry "http://localhost:4873"
}

run_tests() {
  # Called from sync stage where sub-phase timing is less important
  run_tests_ci
  run_publish_verdaccio
  run_acceptance
}

# ---------------------------------------------------------------------------
# Phase runner with timing
# ---------------------------------------------------------------------------

PHASE_TIMINGS=""

# Per-command and per-package timing for pipeline-timing.json
TIMING_CMDS_FILE="/tmp/ruflo-timing-cmds.jsonl"
TIMING_BUILD_PKGS_FILE="/tmp/ruflo-timing-build-pkgs.jsonl"
: > "$TIMING_CMDS_FILE"
: > "$TIMING_BUILD_PKGS_FILE"

# ---------------------------------------------------------------------------
# Post-publish helpers (extracted for run_phase timing)
# ---------------------------------------------------------------------------

PIPELINE_START_NS=""

# ---------------------------------------------------------------------------
# Publish stage: Build and publish pipeline
# ---------------------------------------------------------------------------

run_stage3_publish() {
  PIPELINE_START_NS=$(date +%s%N 2>/dev/null || echo 0)
  log "────────────────────────────────────────────────"
  log "Publish stage (detect merged PRs, build, publish)"
  log "────────────────────────────────────────────────"

  # Check for new merges to fork main branches
  # (Not wrapped in run_phase — returns 1 for "no changes", not an error)
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
  # NOTE: Do NOT save_state here. State is saved ONLY after successful
  # publish (line ~1145). If build/test/publish fails, the next run will
  # re-detect the merge and retry with the SAME versions (safeNextVersion
  # is idempotent — it won't re-bump unpublished versions).

  # Build pipeline: copy -> codemod -> build
  create_temp_dir
  run_phase "copy-source" copy_source
  run_phase "codemod" run_codemod
  # Run build and preflight + unit tests in parallel (tests don't depend on build artifacts)
  local _test_pid=""
  if [[ "${BUILD_ONLY}" != "true" ]]; then
    run_phase "test-ci" run_tests_ci &
    _test_pid=$!
  fi
  run_phase "build" run_build
  write_build_manifest

  if [[ "${BUILD_ONLY}" == "true" ]]; then
    print_phase_summary
    log "Build complete (--build-only mode). Artifacts at: ${TEMP_DIR}"
    return 0
  fi

  # Wait for parallel test-ci to complete
  if [[ -n "$_test_pid" ]]; then
    if ! wait "$_test_pid"; then
      log_error "test-ci failed (ran in parallel with build)"
      return 1
    fi
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

  # Read version from fork package.json (no computation needed)
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

# ---------------------------------------------------------------------------
# Sync stage: Upstream sync pipeline
# ---------------------------------------------------------------------------

run_stage1_sync() {
  log "────────────────────────────────────────────────"
  log "Sync stage (fetch upstream, create sync branches)"
  log "────────────────────────────────────────────────"

  # Sync upstream into fork branches
  if ! sync_upstream; then
    # sync_upstream returns 1 if no changes or if it already created a
    # PR for conflict/compile-error
    log "No upstream changes — skipping sync build"
    return 0
  fi

  # Save upstream SHA state immediately so next run won't re-create branches
  # if the build/test phase below fails
  save_state

  # Read current fork HEADs for verify dedup check
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

  # D1: Reuse build artifacts if the publish stage already built from the
  # same fork HEADs (avoids redundant copy+codemod+build ~26s)
  if check_build_freshness; then
    log "Reusing existing build artifacts from publish stage"
    TEMP_DIR="/tmp/ruflo-build"
  else
    # Build pipeline: copy -> codemod -> build
    create_temp_dir
    run_phase "copy-source" copy_source
    run_phase "codemod" run_codemod
    run_phase "build" run_build
  fi

  if [[ "${BUILD_ONLY}" == "true" ]]; then
    print_phase_summary
    log "Sync build complete (--build-only mode). Artifacts at: ${TEMP_DIR}"
    # Switch forks back to main
    for dir in "${FORK_DIRS[@]}"; do
      git -C "${dir}" checkout main --quiet 2>/dev/null || true
    done
    return 0
  fi

  # Test against the sync branch build.
  # Skip expensive acceptance if the publish stage already verified these exact artifacts.
  local tests_passed=false
  local skip_acceptance=false
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
    # Run preflight + unit only (fast sanity check)
    if run_tests_ci; then
      tests_passed=true
    fi
  else
    # Full preflight + unit + acceptance
    if run_tests; then
      tests_passed=true
    fi
  fi

  # Create PRs for each fork that was synced
  for i in "${!FORK_NAMES[@]}"; do
    local name="${FORK_NAMES[$i]}"
    local dir="${FORK_DIRS[$i]}"

    # Check if this fork is on a sync branch
    local current_branch
    current_branch=$(git -C "${dir}" branch --show-current 2>/dev/null) || continue
    [[ "$current_branch" == sync/* ]] || continue

    if [[ "$tests_passed" == "true" ]]; then
      local ready_pr_url
      ready_pr_url=$(create_sync_pr "${dir}" "${name}" "${current_branch}" "ready" \
        "All tests passed (preflight + unit + acceptance). Ready for review and merge.")
      _email_meta "$dir"
      local _ready_branch_url=""
      [[ -n "$_EML_FORK_URL" ]] && _ready_branch_url="${_EML_FORK_URL}/tree/${current_branch}"
      local _ready_upstream_url=""
      [[ -n "$_EML_UPSTREAM_URL" && -n "$_EML_UPSTREAM_SHA" ]] && _ready_upstream_url="${_EML_UPSTREAM_URL}/commit/${_EML_UPSTREAM_SHA}"
      local _ready_fork_commit_url=""
      [[ -n "$_EML_FORK_URL" && -n "$_EML_FORK_SHA" ]] && _ready_fork_commit_url="${_EML_FORK_URL}/commit/${_EML_FORK_SHA}"
      local ready_email_body
      ready_email_body=$(_email_html_body "success" \
        "Sync PR ready for ${name}" \
        "$name" "$current_branch" "$_ready_branch_url" \
        "$ready_pr_url" "$_ready_upstream_url" \
        "$_EML_FORK_URL" "$_ready_fork_commit_url" \
        "Upstream sync for ${name} is ready for review. All tests passed.")
      send_email "[ruflo] Sync PR ready for ${name}" "$ready_email_body"
    else
      local fail_pr_url
      fail_pr_url=$(create_sync_pr "${dir}" "${name}" "${current_branch}" "test-failure" \
        "Tests failed during sync validation. Review required.")
      _email_meta "$dir"
      local _fail_branch_url=""
      [[ -n "$_EML_FORK_URL" ]] && _fail_branch_url="${_EML_FORK_URL}/tree/${current_branch}"
      local _fail_upstream_url=""
      [[ -n "$_EML_UPSTREAM_URL" && -n "$_EML_UPSTREAM_SHA" ]] && _fail_upstream_url="${_EML_UPSTREAM_URL}/commit/${_EML_UPSTREAM_SHA}"
      local _fail_fork_commit_url=""
      [[ -n "$_EML_FORK_URL" && -n "$_EML_FORK_SHA" ]] && _fail_fork_commit_url="${_EML_FORK_URL}/commit/${_EML_FORK_SHA}"
      local fail_email_body
      fail_email_body=$(_email_html_body "warning" \
        "Sync test failure for ${name}" \
        "$name" "$current_branch" "$_fail_branch_url" \
        "$fail_pr_url" "$_fail_upstream_url" \
        "$_EML_FORK_URL" "$_fail_fork_commit_url" \
        "Upstream sync for ${name} failed tests. Manual review required.")
      send_email "[ruflo] Sync test failure for ${name}" "$fail_email_body"
      create_failure_issue "sync-test-failure-${name}" "1"
    fi

    # Switch back to main
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

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  PIPELINE_START_NS=$(date +%s%N 2>/dev/null || echo 0)
  log "=========================================="
  log "ruflo sync-and-build starting (ADR-0027)"
  log "  --sync=${RUN_SYNC} --publish=${RUN_PUBLISH}"
  log "  --force=${FORCE_BUILD}"
  log "  --build-only=${BUILD_ONLY} --pull=${PULL_UPSTREAM}"
  log "=========================================="

  # Global timeout — 900s
  # Close fd 9 (flock) in the subshell so the timeout process does NOT inherit
  # the lock. Without this, if the main script is killed externally the orphaned
  # sleep process keeps the flock forever, blocking all future pipeline runs.
  # Close ALL inherited fds so the timeout subprocess doesn't hold pipes open.
  # Without this, piping through tee/cat causes the sleep to block for 900s
  # after the main script exits (the sleep holds stdout/stderr fds open).
  ( exec 9>&- 1>/dev/null 2>/dev/null; sleep 900; kill -TERM -$$ 2>/dev/null || kill -TERM $$ 2>/dev/null || true; sleep 5; kill -KILL -$$ 2>/dev/null || kill -KILL $$ 2>/dev/null || true ) &
  GLOBAL_TIMEOUT_PID=$!

  # Load previous state
  load_state

  # --seed-state: record current fork HEADs as baseline without building.
  # Use after clean-slate reset so the NEXT run is incremental (not "all changed").
  if [[ "${SEED_STATE}" == "true" ]]; then
    log "Seeding state file with current fork HEADs + upstream SHAs..."
    for i in "${!FORK_NAMES[@]}"; do
      local dir="${FORK_DIRS[$i]}"
      local name="${FORK_NAMES[$i]}"
      if [[ -d "${dir}/.git" ]]; then
        git -C "${dir}" fetch origin main --quiet 2>/dev/null || true
        local sha
        sha=$(git -C "${dir}" rev-parse origin/main 2>/dev/null) || sha=""
        case "$name" in
          ruflo)        NEW_RUFLO_HEAD="$sha" ;;
          agentic-flow) NEW_AGENTIC_HEAD="$sha" ;;
          ruv-FANN)     NEW_FANN_HEAD="$sha" ;;
          ruvector)     NEW_RUVECTOR_HEAD="$sha" ;;
        esac
        log "  ${name} fork: ${sha:0:12}"

        # Also record upstream SHA so sync stage doesn't re-sync on next run
        if git -C "${dir}" remote get-url upstream &>/dev/null; then
          git -C "${dir}" fetch upstream main --quiet 2>/dev/null || true
          local upstream_sha
          upstream_sha=$(git -C "${dir}" rev-parse upstream/main 2>/dev/null) || upstream_sha=""
          if [[ -n "$upstream_sha" ]]; then
            case "$name" in
              ruflo)        UPSTREAM_RUFLO_SHA="$upstream_sha" ;;
              agentic-flow) UPSTREAM_AGENTIC_SHA="$upstream_sha" ;;
              ruv-FANN)     UPSTREAM_FANN_SHA="$upstream_sha" ;;
              ruvector)     UPSTREAM_RUVECTOR_SHA="$upstream_sha" ;;
            esac
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
    # Read current fork HEADs
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
        case "$name" in
          ruflo)        NEW_RUFLO_HEAD="$sha" ;;
          agentic-flow) NEW_AGENTIC_HEAD="$sha" ;;
          ruv-FANN)     NEW_FANN_HEAD="$sha" ;;
      ruvector)     NEW_RUVECTOR_HEAD="$sha" ;;
        esac
      fi
    done

    # Check freshness unless --force
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

  # Publish stage runs first: publish reviewed code
  if [[ "${RUN_PUBLISH}" == "true" ]]; then
    run_stage3_publish
  fi

  # Sync stage runs second: pull new upstream
  if [[ "${RUN_SYNC}" == "true" ]]; then
    run_stage1_sync
  fi

  # End-to-end timing
  local _main_end_ns
  _main_end_ns=$(date +%s%N 2>/dev/null || echo 0)
  if [[ -n "$PIPELINE_START_NS" && "$PIPELINE_START_NS" != "0" && "$_main_end_ns" != "0" ]]; then
    local _main_ms=$(( (_main_end_ns - PIPELINE_START_NS) / 1000000 ))
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
