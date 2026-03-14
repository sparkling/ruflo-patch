#!/usr/bin/env bash
# sync-and-build.sh — Fork-based build pipeline for ruflo (ADR-0027).
#
# Three stages (review gate is manual, not in this script):
#
#   --publish   Publish stage: Detect merges to fork main, bump versions,
#               build, test (L0-L3), publish to local Verdaccio.
#
#   --sync      Sync stage: Fetch upstream, create sync branch, merge,
#               type-check, build, test (L0-L3). On success create PR
#               with label "ready". On failure create PR with error label.
#
# Publish runs before Sync when both are requested (default).
# Review gate (manual PR merge on GitHub) happens between timer runs.
#
# Flags:
#   --sync        Sync stage only
#   --publish     Publish stage only
#   --test-only   Stop after tests (no publish)
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
TEST_ONLY=false
FORCE_BUILD=false
BUILD_ONLY=false
PULL_UPSTREAM=false
for arg in "$@"; do
  case "$arg" in
    --sync)       RUN_SYNC=true ;;
    --publish)    RUN_PUBLISH=true ;;
    --test-only)  TEST_ONLY=true ;;
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
  --test-only   Stop after tests (no publish)
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

# Deferred version bump pushes (populated by bump_fork_versions, pushed after publish)
PENDING_VERSION_PUSHES=()

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

log() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*" >&2
}

log_error() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] ERROR: $*" >&2
}

# ---------------------------------------------------------------------------
# Email notification helper
# ---------------------------------------------------------------------------

send_email() {
  local subject="$1"
  local body="$2"
  local recipient="${RUFLO_NOTIFY_EMAIL:-}"

  if [[ -z "$recipient" ]]; then
    log "Email notification (no recipient configured): ${subject}"
    return 0
  fi

  if command -v sendmail &>/dev/null; then
    printf "Subject: %s\nFrom: ruflo-build@$(hostname)\nTo: %s\n\n%s\n" \
      "$subject" "$recipient" "$body" | sendmail "$recipient" 2>/dev/null || {
      log "WARNING: sendmail failed for: ${subject}"
    }
  elif command -v mail &>/dev/null; then
    echo "$body" | mail -s "$subject" "$recipient" 2>/dev/null || {
      log "WARNING: mail failed for: ${subject}"
    }
  else
    log "Email notification (no mail command): ${subject}"
  fi
}

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------

GLOBAL_TIMEOUT_PID=""

cleanup() {
  local exit_code=$?
  if [[ -n "${GLOBAL_TIMEOUT_PID}" ]]; then
    kill "${GLOBAL_TIMEOUT_PID}" 2>/dev/null || true
  fi
  if [[ -n "${TEMP_DIR}" && -d "${TEMP_DIR}" && "${BUILD_ONLY}" != "true" ]]; then
    log "Cleaning up temp directory: ${TEMP_DIR}"
    rm -rf "${TEMP_DIR}"
  fi
  if [[ ${exit_code} -ne 0 ]]; then
    log_error "Build failed with exit code ${exit_code}"
  fi
  exit "${exit_code}"
}

trap cleanup EXIT

# ---------------------------------------------------------------------------
# State file helpers
# ---------------------------------------------------------------------------

load_state() {
  RUFLO_HEAD=""
  AGENTIC_HEAD=""
  FANN_HEAD=""
  RUVECTOR_HEAD=""
  UPSTREAM_RUFLO_SHA=""
  UPSTREAM_AGENTIC_SHA=""
  UPSTREAM_FANN_SHA=""
  UPSTREAM_RUVECTOR_SHA=""

  if [[ -f "${STATE_FILE}" ]]; then
    log "Loading state from ${STATE_FILE}"
    while IFS='=' read -r key value; do
      [[ -z "${key}" || "${key}" =~ ^# ]] && continue
      case "${key}" in
        RUFLO_HEAD)          RUFLO_HEAD="${value}" ;;
        AGENTIC_HEAD)        AGENTIC_HEAD="${value}" ;;
        FANN_HEAD)           FANN_HEAD="${value}" ;;
        RUVECTOR_HEAD)       RUVECTOR_HEAD="${value}" ;;
        UPSTREAM_RUFLO_SHA)  UPSTREAM_RUFLO_SHA="${value}" ;;
        UPSTREAM_AGENTIC_SHA) UPSTREAM_AGENTIC_SHA="${value}" ;;
        UPSTREAM_FANN_SHA)   UPSTREAM_FANN_SHA="${value}" ;;
        UPSTREAM_RUVECTOR_SHA) UPSTREAM_RUVECTOR_SHA="${value}" ;;
      esac
    done < "${STATE_FILE}"
    log "State loaded: RUFLO=${RUFLO_HEAD:0:12}, AGENTIC=${AGENTIC_HEAD:0:12}, FANN=${FANN_HEAD:0:12}, RUVECTOR=${RUVECTOR_HEAD:0:12}"
  else
    log "No state file found — first run"
  fi

  # Snapshot state as PREV_* for check_merged_prs() comparison
  PREV_RUFLO_HEAD="${RUFLO_HEAD}"
  PREV_AGENTIC_HEAD="${AGENTIC_HEAD}"
  PREV_FANN_HEAD="${FANN_HEAD}"
  PREV_RUVECTOR_HEAD="${RUVECTOR_HEAD}"
}

save_state() {
  cat > "${STATE_FILE}" <<EOF
# ruflo build state — written by sync-and-build.sh (ADR-0027)
# Last updated: $(date -u '+%Y-%m-%dT%H:%M:%SZ')
RUFLO_HEAD=${NEW_RUFLO_HEAD:-${RUFLO_HEAD}}
AGENTIC_HEAD=${NEW_AGENTIC_HEAD:-${AGENTIC_HEAD}}
FANN_HEAD=${NEW_FANN_HEAD:-${FANN_HEAD}}
RUVECTOR_HEAD=${NEW_RUVECTOR_HEAD:-${RUVECTOR_HEAD}}
UPSTREAM_RUFLO_SHA=${UPSTREAM_RUFLO_SHA:-}
UPSTREAM_AGENTIC_SHA=${UPSTREAM_AGENTIC_SHA:-}
UPSTREAM_FANN_SHA=${UPSTREAM_FANN_SHA:-}
UPSTREAM_RUVECTOR_SHA=${UPSTREAM_RUVECTOR_SHA:-}
EOF
  log "State saved"
}

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
  log "Pushing deferred version bumps to ${#PENDING_VERSION_PUSHES[@]} fork(s)"
  for dir in "${PENDING_VERSION_PUSHES[@]}"; do
    local name
    name=$(basename "$dir")
    log "  Pushing version bump for ${name}"
    git -C "${dir}" push origin main --quiet 2>/dev/null || {
      log "WARNING: Failed to push version bump for ${name} — will retry next run"
    }
  done
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

  for i in "${!FORK_NAMES[@]}"; do
    local name="${FORK_NAMES[$i]}"
    local dir="${FORK_DIRS[$i]}"

    [[ -d "${dir}/.git" ]] || continue

    # Add upstream remote if not present
    if ! git -C "${dir}" remote get-url upstream &>/dev/null; then
      git -C "${dir}" remote add upstream "${UPSTREAM_URLS[$i]}" 2>/dev/null || true
    fi

    # Fetch upstream
    log "Fetching upstream for ${name}"
    local _uf_start _uf_end
    _uf_start=$(date +%s%N 2>/dev/null || echo 0)
    git -C "${dir}" fetch upstream main --quiet 2>/dev/null || {
      log_error "Failed to fetch upstream for ${name}"
      continue
    }
    _uf_end=$(date +%s%N 2>/dev/null || echo 0)
    if [[ "$_uf_start" != "0" && "$_uf_end" != "0" ]]; then
      local _uf_ms=$(( (_uf_end - _uf_start) / 1000000 ))
      log "  fetch upstream ${name}: ${_uf_ms}ms"
      add_cmd_timing "sync-upstream" "git fetch upstream ${name}" "${_uf_ms}"
    fi

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
      create_sync_pr "${dir}" "${name}" "${branch_name}" "conflict" \
        "Merge conflict when syncing upstream/main. Manual resolution required."

      send_email "[ruflo] Merge conflict in ${name}" \
        "Upstream sync for ${name} has merge conflicts.\nBranch: ${branch_name}\nManual resolution required."
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
      if ! (cd "${dir}" && $tsc_bin --noEmit --skipLibCheck --project v3/tsconfig.json 2>/dev/null); then
        _tc_end=$(date +%s%N 2>/dev/null || echo 0)
        if [[ "$_tc_start" != "0" && "$_tc_end" != "0" ]]; then
          local _tc_ms=$(( (_tc_end - _tc_start) / 1000000 ))
          log "  type-check ${name}: ${_tc_ms}ms"
          add_cmd_timing "sync-upstream" "tsc --noEmit ${name}" "${_tc_ms}"
        fi
        log_error "Type-check failed for ${name}"

        create_sync_pr "${dir}" "${name}" "${branch_name}" "compile-error" \
          "TypeScript compilation failed after merging upstream/main."

        send_email "[ruflo] Compile error in ${name} sync" \
          "TypeScript compilation failed for ${name} after syncing upstream.\nBranch: ${branch_name}"

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
      if ! (cd "${dir}" && $tsc_bin --noEmit --skipLibCheck 2>/dev/null); then
        log_error "Type-check failed for ${name}"

        create_sync_pr "${dir}" "${name}" "${branch_name}" "compile-error" \
          "TypeScript compilation failed after merging upstream/main."

        send_email "[ruflo] Compile error in ${name} sync" \
          "TypeScript compilation failed for ${name} after syncing upstream.\nBranch: ${branch_name}"

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
# Create sync PR on GitHub
# ---------------------------------------------------------------------------

create_sync_pr() {
  local dir="$1"
  local name="$2"
  local branch="$3"
  local label="$4"
  local body="$5"

  # Push the branch
  local _pr_push_start _pr_push_end
  _pr_push_start=$(date +%s%N 2>/dev/null || echo 0)
  git -C "${dir}" push origin "${branch}" --quiet 2>/dev/null || {
    log_error "Failed to push branch ${branch} for ${name}"
    return 1
  }
  _pr_push_end=$(date +%s%N 2>/dev/null || echo 0)
  if [[ "$_pr_push_start" != "0" && "$_pr_push_end" != "0" ]]; then
    local _pr_push_ms=$(( (_pr_push_end - _pr_push_start) / 1000000 ))
    log "  git push ${name}/${branch}: ${_pr_push_ms}ms"
    add_cmd_timing "create-pr" "git push ${name}" "${_pr_push_ms}"
  fi

  # Get repo name from remote
  local repo_url
  repo_url=$(git -C "${dir}" remote get-url origin 2>/dev/null) || return 1
  local repo_slug
  repo_slug=$(echo "$repo_url" | sed -E 's#.*github\.com[:/]##; s/\.git$//')

  if [[ -z "$repo_slug" ]]; then
    log_error "Cannot determine GitHub repo slug for ${name}"
    return 1
  fi

  local pr_title="Sync upstream: ${branch}"
  local pr_body="Automated upstream sync.

**Fork**: ${name}
**Branch**: ${branch}
**Status**: ${label}
**Timestamp**: $(date -u '+%Y-%m-%dT%H:%M:%SZ')

${body}"

  log "Creating PR for ${name}: ${pr_title} [${label}]"

  # Create label if it doesn't exist (ignore errors)
  gh label create "$label" --repo "$repo_slug" --force 2>/dev/null || true

  local _pr_create_start _pr_create_end
  _pr_create_start=$(date +%s%N 2>/dev/null || echo 0)
  gh pr create \
    --repo "$repo_slug" \
    --head "$branch" \
    --base main \
    --title "$pr_title" \
    --body "$pr_body" \
    --label "$label" \
    2>/dev/null || {
      log_error "Failed to create PR for ${name} (non-fatal)"
    }
  _pr_create_end=$(date +%s%N 2>/dev/null || echo 0)
  if [[ "$_pr_create_start" != "0" && "$_pr_create_end" != "0" ]]; then
    local _pr_create_ms=$(( (_pr_create_end - _pr_create_start) / 1000000 ))
    log "  gh pr create ${name}: ${_pr_create_ms}ms"
    add_cmd_timing "create-pr" "gh pr create ${name}" "${_pr_create_ms}"
  fi
}

# ---------------------------------------------------------------------------
# Copy fork sources to temp directory
# ---------------------------------------------------------------------------

create_temp_dir() {
  if [[ "${BUILD_ONLY}" == "true" ]]; then
    TEMP_DIR="/tmp/ruflo-build"
    mkdir -p "${TEMP_DIR}"
    log "Using stable build directory: ${TEMP_DIR}"
  else
    TEMP_DIR=$(mktemp -d /tmp/ruflo-build-XXXXX)
    log "Created temp directory: ${TEMP_DIR}"
  fi
}

copy_source() {
  log "Copying fork source to ${TEMP_DIR}"
  local _cp_start _cp_end

  # Copy all 3 forks in parallel (uses all available I/O bandwidth)
  mkdir -p "${TEMP_DIR}/cross-repo/agentic-flow" "${TEMP_DIR}/cross-repo/ruv-FANN" "${TEMP_DIR}/cross-repo/ruvector"

  _cp_start=$(date +%s%N 2>/dev/null || echo 0)
  rsync -a --exclude=node_modules --exclude=.git "${FORK_DIR_RUFLO}/" "${TEMP_DIR}/" &
  local pid_ruflo=$!
  rsync -a --exclude=node_modules --exclude=.git "${FORK_DIR_AGENTIC}/" "${TEMP_DIR}/cross-repo/agentic-flow/" &
  local pid_agentic=$!
  rsync -a --exclude=node_modules --exclude=.git "${FORK_DIR_FANN}/" "${TEMP_DIR}/cross-repo/ruv-FANN/" &
  local pid_fann=$!
  rsync -a --exclude=node_modules --exclude=.git "${FORK_DIR_RUVECTOR}/" "${TEMP_DIR}/cross-repo/ruvector/" &
  local pid_ruvector=$!
  wait $pid_ruflo $pid_agentic $pid_fann $pid_ruvector
  _cp_end=$(date +%s%N 2>/dev/null || echo 0)

  local _cp_ms=0
  if [[ "$_cp_start" != "0" && "$_cp_end" != "0" ]]; then
    _cp_ms=$(( (_cp_end - _cp_start) / 1000000 ))
    log "  Parallel copy completed in ${_cp_ms}ms"
    add_cmd_timing "copy-source" "rsync (4 forks parallel)" "${_cp_ms}"
  fi
  log "Source copied to temp directory (4 forks merged, parallel)"
}

# ---------------------------------------------------------------------------
# Codemod
# ---------------------------------------------------------------------------

run_codemod() {
  log "Running codemod: @claude-flow/* -> @sparkleideas/*"
  local _cm_start _cm_end
  _cm_start=$(date +%s%N 2>/dev/null || echo 0)
  node "${SCRIPT_DIR}/codemod.mjs" "${TEMP_DIR}"
  _cm_end=$(date +%s%N 2>/dev/null || echo 0)
  if [[ "$_cm_start" != "0" && "$_cm_end" != "0" ]]; then
    local _cm_ms=$(( (_cm_end - _cm_start) / 1000000 ))
    log "  Codemod completed in ${_cm_ms}ms"
    add_cmd_timing "codemod" "node codemod.mjs" "${_cm_ms}"
  fi
}

# ---------------------------------------------------------------------------
# Build manifest (ADR-0026)
# ---------------------------------------------------------------------------

STABLE_BUILD_DIR="/tmp/ruflo-build"

write_build_manifest() {
  local manifest="${TEMP_DIR}/.build-manifest.json"
  local _wm_start _wm_end
  _wm_start=$(date +%s%N 2>/dev/null || echo 0)
  local codemod_hash
  codemod_hash=$(sha256sum "${SCRIPT_DIR}/codemod.mjs" 2>/dev/null | cut -d' ' -f1) || codemod_hash=""

  cat > "$manifest" <<MANIFESTEOF
{
  "version": 2,
  "built_at": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "ruflo_head": "${NEW_RUFLO_HEAD:-}",
  "agentic_head": "${NEW_AGENTIC_HEAD:-}",
  "fann_head": "${NEW_FANN_HEAD:-}",
  "ruvector_head": "${NEW_RUVECTOR_HEAD:-}",
  "codemod_hash": "${codemod_hash}",
  "packages_compiled": $(find "${TEMP_DIR}" -name "dist" -type d 2>/dev/null | wc -l),
  "packages_total": $(find "${TEMP_DIR}" -name "package.json" -not -path "*/node_modules/*" -not -path "*/.tsc-toolchain/*" 2>/dev/null | xargs grep -l '"@sparkleideas/' 2>/dev/null | wc -l)
}
MANIFESTEOF
  _wm_end=$(date +%s%N 2>/dev/null || echo 0)
  if [[ "$_wm_start" != "0" && "$_wm_end" != "0" ]]; then
    local _wm_ms=$(( (_wm_end - _wm_start) / 1000000 ))
    log "  Build manifest written in ${_wm_ms}ms"
    add_cmd_timing "build" "write-manifest" "${_wm_ms}"
  fi
}

check_build_freshness() {
  local manifest="${STABLE_BUILD_DIR}/.build-manifest.json"
  if [[ ! -f "$manifest" ]]; then
    log "No build manifest found — will build"
    return 1
  fi

  local stored
  stored=$(node -e "
    const m = JSON.parse(require('fs').readFileSync('${manifest}', 'utf-8'));
    console.log([m.ruflo_head, m.agentic_head, m.fann_head, m.ruvector_head || '', m.codemod_hash].join(':'));
  " 2>/dev/null) || { log "Cannot read manifest — will build"; return 1; }

  local stored_ruflo stored_agentic stored_fann stored_ruvector stored_codemod
  IFS=':' read -r stored_ruflo stored_agentic stored_fann stored_ruvector stored_codemod <<< "$stored"

  local current_codemod
  current_codemod=$(sha256sum "${SCRIPT_DIR}/codemod.mjs" 2>/dev/null | cut -d' ' -f1) || current_codemod=""

  if [[ "${stored_ruflo}" == "${NEW_RUFLO_HEAD}" && \
        "${stored_agentic}" == "${NEW_AGENTIC_HEAD}" && \
        "${stored_fann}" == "${NEW_FANN_HEAD}" && \
        "${stored_ruvector}" == "${NEW_RUVECTOR_HEAD}" && \
        "${stored_codemod}" == "${current_codemod}" ]]; then
    log "Build is current (manifest matches) — skipping build"
    return 0
  fi

  log "Build is stale — will rebuild"
  return 1
}

# ---------------------------------------------------------------------------
# Build (TypeScript compilation)
# ---------------------------------------------------------------------------

run_build() {
  # Remove .npmignore and .gitignore so npm publish uses "files" from package.json
  find "${TEMP_DIR}" -name ".npmignore" -not -path "*/node_modules/*" -delete 2>/dev/null || true
  find "${TEMP_DIR}" -name ".gitignore" -not -path "*/node_modules/*" -delete 2>/dev/null || true

  local v3_dir="${TEMP_DIR}/v3"
  if [[ ! -d "$v3_dir" ]]; then
    log "No v3/ directory found — skipping TypeScript build"
    return 0
  fi

  # Install TypeScript in a persistent directory (cached across runs)
  local tsc_dir="/tmp/ruflo-tsc-toolchain"
  if [[ ! -x "${tsc_dir}/node_modules/.bin/tsc" ]] || \
     [[ $(find "${tsc_dir}" -maxdepth 0 -mmin +1440 -print 2>/dev/null | wc -l) -gt 0 ]]; then
    rm -rf "${tsc_dir}"
    mkdir -p "${tsc_dir}" "${tsc_dir}/stubs"
    (cd "$tsc_dir" && echo '{"private":true}' > package.json \
      && npm install typescript@5 zod@3 @types/express @types/cors @types/fs-extra --save-exact 2>&1) | tail -1
    # Create type stubs for optional modules (ADR-0028)
    cat > "${tsc_dir}/stubs/agentic-flow_embeddings.d.ts" << 'TSSTUB'
declare module 'agentic-flow/embeddings' {
  export function getOptimizedEmbedder(opts: any): any;
  export function getNeuralSubstrate(opts?: any): any;
  export function listAvailableModels(): Array<{ id: string; dimension: number; size: string; quantized: boolean; downloaded: boolean; }>;
  export function downloadModel(modelId: string): Promise<void>;
  export class OptimizedEmbedder { embed(text: string): Promise<Float32Array>; embedBatch(texts: string[]): Promise<Float32Array[]>; init(): Promise<void>; }
}
TSSTUB
    cat > "${tsc_dir}/stubs/onnxruntime-node.d.ts" << 'TSSTUB'
declare module 'onnxruntime-node' {
  export class InferenceSession { static create(path: string, opts?: any): Promise<InferenceSession>; run(feeds: any): Promise<any>; }
  export class Tensor { constructor(type: string, data: any, dims?: number[]); data: any; dims: number[]; }
}
TSSTUB
    cat > "${tsc_dir}/stubs/bcrypt.d.ts" << 'TSSTUB'
declare module 'bcrypt' {
  export function hash(data: string, saltOrRounds: string | number): Promise<string>;
  export function compare(data: string, encrypted: string): Promise<boolean>;
  export function genSalt(rounds?: number): Promise<string>;
}
TSSTUB
    cat > "${tsc_dir}/stubs/express.d.ts" << 'TSSTUB'
declare module 'express' {
  export interface Request { body: any; params: any; query: any; headers: any; method: string; url: string; path: string; }
  export interface Response { status(code: number): Response; json(body: any): Response; send(body?: any): Response; set(field: string, value: string): Response; end(): void; }
  export interface NextFunction { (err?: any): void; }
  export interface Express { use(...args: any[]): any; get(...args: any[]): any; post(...args: any[]): any; listen(...args: any[]): any; }
  export interface Router { use(...args: any[]): any; get(...args: any[]): any; post(...args: any[]): any; }
  function express(): Express;
  namespace express { function Router(): Router; function json(opts?: any): any; function urlencoded(opts?: any): any; function static(root: string): any; }
  export = express;
}
TSSTUB
    cat > "${tsc_dir}/stubs/cors.d.ts" << 'TSSTUB'
declare module 'cors' {
  function cors(options?: any): any;
  export = cors;
}
TSSTUB
    cat > "${tsc_dir}/stubs/fs-extra.d.ts" << 'TSSTUB'
declare module 'fs-extra' {
  export function ensureDir(path: string): Promise<void>;
  export function ensureDirSync(path: string): void;
  export function readJson(path: string): Promise<any>;
  export function writeJson(path: string, data: any, opts?: any): Promise<void>;
  export function copy(src: string, dest: string, opts?: any): Promise<void>;
  export function remove(path: string): Promise<void>;
  export function pathExists(path: string): Promise<boolean>;
  export function pathExistsSync(path: string): boolean;
  export function stat(path: string): Promise<any>;
  export function readFile(path: string, encoding?: string): Promise<any>;
  export function writeFile(path: string, data: any, opts?: any): Promise<void>;
  export function readdir(path: string): Promise<string[]>;
  export function mkdir(path: string, opts?: any): Promise<void>;
  export function mkdirp(path: string): Promise<void>;
  export function existsSync(path: string): boolean;
  export function outputFile(path: string, data: any): Promise<void>;
}
TSSTUB
    cat > "${tsc_dir}/stubs/vitest.d.ts" << 'TSSTUB'
declare module 'vitest' {
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export const expect: ((value: any) => any) & { extend(matchers: Record<string, any>): void };
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
  export function beforeAll(fn: () => void | Promise<void>): void;
  export function afterAll(fn: () => void | Promise<void>): void;
  export const vi: any;
  export type Mock<T = any> = ((...args: any[]) => T) & { mock: { calls: any[][]; results: any[]; instances: any[]; invocationCallOrder: number[]; lastCall: any[] }; mockReturnValue(v: any): Mock<T>; mockResolvedValue(v: any): Mock<T>; mockRejectedValue(v: any): Mock<T>; mockImplementation(fn: (...args: any[]) => any): Mock<T>; mockReturnValueOnce(v: any): Mock<T>; mockResolvedValueOnce(v: any): Mock<T>; mockRejectedValueOnce(v: any): Mock<T>; getMockImplementation(): ((...args: any[]) => any) | undefined; mockClear(): void; mockReset(): void; mockRestore(): void; };
  export type ExpectStatic = typeof expect;
}
TSSTUB
    cat > "${tsc_dir}/stubs/@ruvector_attention.d.ts" << 'TSSTUB'
declare module '@ruvector/attention' {
  export interface AttentionConfig { dim: number; numHeads?: number; dropout?: number; }
  export function scaledDotProductAttention(q: Float32Array, k: Float32Array[], v: Float32Array[]): Float32Array;
  export function multiHeadAttention(q: Float32Array, k: Float32Array[], v: Float32Array[], c: AttentionConfig): Float32Array;
  export function flashAttention(q: Float32Array, k: Float32Array[], v: Float32Array[], bs?: number): Float32Array;
  export function hyperbolicAttention(q: Float32Array, k: Float32Array[], v: Float32Array[], c?: number): Float32Array;
  export type ArrayInput = Float32Array | number[];
  export interface BenchmarkResult { name: string; ops: number; mean: number; median: number; stddev: number; min: number; max: number; }
  export class FlashAttention { constructor(dim: number, numHeads: number); constructor(c?: any); compute(q: Float32Array, k: Float32Array[], v: Float32Array[]): Float32Array; computeRaw(q: Float32Array, k: Float32Array[], v: Float32Array[]): Float32Array; }
  export class DotProductAttention { constructor(dim: number, numHeads: number); constructor(c?: any); compute(q: Float32Array, k: Float32Array[], v: Float32Array[]): Float32Array; computeRaw(q: Float32Array, k: Float32Array[], v: Float32Array[]): Float32Array; }
  export class MultiHeadAttention { constructor(dim: number, numHeads: number); constructor(c?: any); compute(q: Float32Array, k: Float32Array[], v: Float32Array[]): Float32Array; }
  export class LinearAttention { constructor(dim: number, seqLen: number); constructor(c?: any); compute(q: Float32Array, k: Float32Array[], v: Float32Array[]): Float32Array; }
  export class HyperbolicAttention { constructor(dim: number, numHeads: number); constructor(c?: any); compute(q: Float32Array, k: Float32Array[], v: Float32Array[]): Float32Array; }
  export class MoEAttention { constructor(c?: any); compute(q: Float32Array, k: Float32Array[], v: Float32Array[]): Float32Array; }
  export class InfoNceLoss { constructor(c?: any); compute(a: Float32Array[], p: Float32Array[], n?: Float32Array[]): number; }
  export class AdamWOptimizer { constructor(c?: any); step(p: Float32Array, g: Float32Array): Float32Array; }
}
TSSTUB
    cat > "${tsc_dir}/stubs/@ruvector_attention-wasm.d.ts" << 'TSSTUB'
declare module '@ruvector/attention-wasm' {
  const m: any;
  export default m;
  export = m;
}
TSSTUB
    cat > "${tsc_dir}/stubs/@ruvector_cognitum-gate-kernel.d.ts" << 'TSSTUB'
declare module '@ruvector/cognitum-gate-kernel' {
  const m: any;
  export default m;
  export = m;
}
TSSTUB
    cat > "${tsc_dir}/stubs/@ruvector_exotic-wasm.d.ts" << 'TSSTUB'
declare module '@ruvector/exotic-wasm' {
  const m: any;
  export default m;
  export = m;
}
TSSTUB
    cat > "${tsc_dir}/stubs/@ruvector_gnn-wasm.d.ts" << 'TSSTUB'
declare module '@ruvector/gnn-wasm' {
  const m: any;
  export default m;
  export = m;
}
TSSTUB
    cat > "${tsc_dir}/stubs/@ruvector_micro-hnsw-wasm.d.ts" << 'TSSTUB'
declare module '@ruvector/micro-hnsw-wasm' {
  const m: any;
  export default m;
  export = m;
}
TSSTUB
    cat > "${tsc_dir}/stubs/@ruvector_hyperbolic-hnsw-wasm.d.ts" << 'TSSTUB'
declare module '@ruvector/hyperbolic-hnsw-wasm' {
  const m: any;
  export default m;
  export = m;
}
TSSTUB
    cat > "${tsc_dir}/stubs/@ruvnet_bmssp.d.ts" << 'TSSTUB'
declare module '@ruvnet/bmssp' {
  export default function init(): Promise<void>;
  export class WasmNeuralBMSSP { constructor(c?: any); [key: string]: any; }
  export class WasmGraph { constructor(c?: any); [key: string]: any; }
}
TSSTUB
    cat > "${tsc_dir}/stubs/prime-radiant-advanced-wasm.d.ts" << 'TSSTUB'
declare module 'prime-radiant-advanced-wasm' {
  const m: any;
  export default m;
  export = m;
}
TSSTUB
    log "TypeScript toolchain installed at ${tsc_dir}"
  else
    log "TypeScript toolchain cached at ${tsc_dir}"
  fi
  local tsc_bin="${tsc_dir}/node_modules/.bin/tsc"

  # Build order: shared first, then the rest
  local build_order=(
    shared
    memory embeddings codex aidefence
    neural hooks browser plugins providers claims
    guidance mcp integration deployment swarm security performance testing
    cli
  )

  # Parse DIRECTLY_CHANGED_JSON into a lookup set for selective builds.
  # Only packages with actual source changes need recompilation.
  # Transitive dependents only need version bumps (handled by fork-version.mjs).
  local -A changed_set
  local selective_build=false
  if [[ -n "${DIRECTLY_CHANGED_JSON:-}" && "${DIRECTLY_CHANGED_JSON}" != "all" ]]; then
    selective_build=true
    # Extract package short names from JSON array of @sparkleideas/* names
    for full_name in $(echo "${DIRECTLY_CHANGED_JSON}" | node -e "
      const d=require('fs').readFileSync(0,'utf8');try{JSON.parse(d).forEach(n=>console.log(n.replace('@sparkleideas/','')))}catch{}
    " 2>/dev/null); do
      changed_set["$full_name"]=1
    done
  fi

  local built=0
  local failed=0
  local skipped=0

  # Build one package (called from parallel group below)
  build_one_pkg() {
    local pkg_name="$1"
    # Accept either a bare name (resolved under v3/@claude-flow/) or a full path
    local pkg_dir
    if [[ "$pkg_name" == /* ]]; then
      pkg_dir="$pkg_name"
      pkg_name="$(basename "$pkg_dir")"
    else
      pkg_dir="$v3_dir/@claude-flow/${pkg_name}"
    fi
    local pkg_build_start
    pkg_build_start=$(date +%s%N 2>/dev/null || echo 0)

    # Create a standalone tsconfig that doesn't require project references.
    # Fixes: remove composite, exclude test files, stub missing modules.
    # See ADR-0028 for the full rationale.
    local tmp_tsconfig="$pkg_dir/tsconfig.build.json"
    node -e "
      const fs = require('fs'), path = require('path');
      const ts = JSON.parse(fs.readFileSync('$pkg_dir/tsconfig.json', 'utf-8'));

      // Strip project references (we build standalone)
      delete ts.references;
      delete ts.compilerOptions?.composite;
      if (ts.extends) {
        try {
          const base = JSON.parse(fs.readFileSync(path.resolve('$pkg_dir', ts.extends), 'utf-8'));
          ts.compilerOptions = { ...base.compilerOptions, ...ts.compilerOptions };
          delete ts.extends;
        } catch {}
      }
      delete ts.compilerOptions.composite;
      ts.compilerOptions.skipLibCheck = true;
      ts.compilerOptions.noEmit = false;

      // Preserve original rootDir if set (e.g. './src' -> dist/index.js)
      if (!ts.compilerOptions.rootDir) ts.compilerOptions.rootDir = '.';

      // Exclude test files from compilation (they import vitest which isn't installed)
      if (!ts.exclude) ts.exclude = [];
      ts.exclude.push('**/*.test.ts', '**/*.spec.ts', '**/__tests__/**');

      // Map sibling @sparkleideas/* packages to their dist/ declarations.
      // IMPORTANT: use dist/*.d.ts (not src/*.ts) to avoid rootDir violations
      // when paths resolve to files outside this package's rootDir.
      const v3cf = path.resolve('$pkg_dir', '..'); // v3/@claude-flow parent
      if (fs.existsSync(v3cf)) {
        if (!ts.compilerOptions.paths) ts.compilerOptions.paths = {};
        if (!ts.compilerOptions.baseUrl) ts.compilerOptions.baseUrl = '.';
        for (const sibling of fs.readdirSync(v3cf)) {
          const sibDir = path.join(v3cf, sibling);
          const sibPkg = path.join(sibDir, 'package.json');
          if (!fs.existsSync(sibPkg)) continue;
          try {
            const sp = JSON.parse(fs.readFileSync(sibPkg, 'utf-8'));
            if (sp.name && sp.name.startsWith('@sparkleideas/')) {
              // Prefer dist/ declarations (avoids rootDir violations)
              const distIndex = path.join(sibDir, 'dist', 'index.d.ts');
              const distSrcIndex = path.join(sibDir, 'dist', 'src', 'index.d.ts');
              if (fs.existsSync(distIndex)) {
                ts.compilerOptions.paths[sp.name] = [path.relative('$pkg_dir', distIndex)];
              } else if (fs.existsSync(distSrcIndex)) {
                ts.compilerOptions.paths[sp.name] = [path.relative('$pkg_dir', distSrcIndex)];
              }
              // Fallback: src/ only if no dist/ exists (first build)
              else {
                const srcIndex = path.join(sibDir, 'src', 'index.ts');
                if (fs.existsSync(srcIndex)) {
                  ts.compilerOptions.paths[sp.name] = [path.relative('$pkg_dir', srcIndex)];
                }
              }
            }
          } catch {}
        }
      }

      // Stub commonly missing optional modules.
      // Filename convention: module_name.d.ts -> module/name
      //   agentic-flow_embeddings.d.ts -> agentic-flow/embeddings
      //   @ruvector_attention -> prefix @ then: ruvector/attention
      // Scoped packages: filename starts with @ (e.g. @ruvector_attention.d.ts)
      const stubDir = '$tsc_dir/stubs';
      if (fs.existsSync(stubDir)) {
        for (const stub of fs.readdirSync(stubDir).filter(f => f.endsWith('.d.ts'))) {
          let modName = stub.replace('.d.ts', '');
          // Split on first _ to get scope/name for scoped packages
          const firstUnderscore = modName.indexOf('_');
          if (firstUnderscore > 0) {
            modName = modName.substring(0, firstUnderscore) + '/' + modName.substring(firstUnderscore + 1).replace(/_/g, '/');
          }
          if (!ts.compilerOptions.paths[modName]) {
            ts.compilerOptions.paths[modName] = [path.resolve(stubDir, stub)];
          }
        }
      }

      // Add @types from tsc toolchain (express, cors, fs-extra, zod@3)
      if (!ts.compilerOptions.typeRoots) ts.compilerOptions.typeRoots = [];
      ts.compilerOptions.typeRoots.push('$tsc_dir/node_modules/@types');
      ts.compilerOptions.typeRoots.push('./node_modules/@types');

      // Resolve zod from tsc toolchain (v3) instead of /tmp/node_modules (v4)
      ts.compilerOptions.paths['zod'] = ['$tsc_dir/node_modules/zod/index.d.ts'];

      // Enable downlevelIteration for MapIterator support
      ts.compilerOptions.downlevelIteration = true;

      // Note: moduleResolution stays as 'bundler' (original). Bare specifier stubs
      // (express, cors, etc.) are installed as real @types in the tsc toolchain.

      fs.writeFileSync('$tmp_tsconfig', JSON.stringify(ts, null, 2));
    " 2>/dev/null

    local ok=0
    local tsc_log="$pkg_dir/.tsc-build.log"
    if "$tsc_bin" -p "$tmp_tsconfig" --skipLibCheck 2>"$tsc_log"; then
      ok=1
    elif "$tsc_bin" -p "$tmp_tsconfig" --skipLibCheck --noCheck 2>"$tsc_log"; then
      ok=1
    elif "$tsc_bin" -p "$tmp_tsconfig" --skipLibCheck --noCheck --isolatedModules 2>"$tsc_log"; then
      ok=1
    fi
    # Log failures instead of swallowing them
    if [[ $ok -eq 0 && -s "$tsc_log" ]]; then
      log "    tsc failed for ${pkg_name}: $(head -3 "$tsc_log" | tr '\n' ' ')"
    fi
    rm -f "$tmp_tsconfig" "$tsc_log"

    local pkg_build_end
    pkg_build_end=$(date +%s%N 2>/dev/null || echo 0)
    local _bms=0
    if [[ "$pkg_build_start" != "0" && "$pkg_build_end" != "0" ]]; then
      _bms=$(( (pkg_build_end - pkg_build_start) / 1000000 ))
    fi
    # Write result to a temp file so the parent can collect it
    echo "${pkg_name} ${ok} ${_bms}" >> "${TEMP_DIR}/.build-results"
  }

  # Group packages by dependency level for parallel builds
  # Packages within the same group have no inter-dependencies
  local -a group_0=(shared)
  local -a group_1=(memory embeddings codex aidefence)
  local -a group_2=(neural hooks browser plugins providers claims)
  local -a group_3=(guidance mcp integration deployment swarm security performance testing)
  local -a group_4=(cli)
  local -a all_groups=("group_0" "group_1" "group_2" "group_3" "group_4")

  : > "${TEMP_DIR}/.build-results"

  local _group_idx=0
  for group_var in "${all_groups[@]}"; do
    local -n group_ref="$group_var"
    local -a bg_pids=()
    local _grp_start _grp_end _grp_count=0

    _grp_start=$(date +%s%N 2>/dev/null || echo 0)
    for pkg_name in "${group_ref[@]}"; do
      local pkg_dir="$v3_dir/@claude-flow/${pkg_name}"
      [[ -d "$pkg_dir" ]] || continue
      [[ -f "$pkg_dir/tsconfig.json" ]] || continue

      if [[ "$selective_build" == "true" && -z "${changed_set[$pkg_name]:-}" ]]; then
        skipped=$((skipped + 1))
        continue
      fi

      build_one_pkg "$pkg_name" &
      bg_pids+=($!)
      _grp_count=$((_grp_count + 1))
    done

    # Wait for all packages in this group before starting the next
    for pid in "${bg_pids[@]}"; do
      wait "$pid" 2>/dev/null || true
    done
    _grp_end=$(date +%s%N 2>/dev/null || echo 0)
    if [[ "$_grp_start" != "0" && "$_grp_end" != "0" && $_grp_count -gt 0 ]]; then
      local _grp_ms=$(( (_grp_end - _grp_start) / 1000000 ))
      log "  GROUP ${_group_idx} (${_grp_count} pkgs): ${_grp_ms}ms wall-clock"
      add_cmd_timing "build" "group_${_group_idx} (${_grp_count} pkgs)" "${_grp_ms}"
    fi
    _group_idx=$((_group_idx + 1))
  done

  # Build packages outside v3/@claude-flow/ (cross-repo, v3/plugins/*)
  local -a extra_pkg_dirs=()
  # Cross-repo packages (agentic-flow fork)
  for extra_dir in \
    "${TEMP_DIR}/cross-repo/agentic-flow/packages/agentdb" \
    "${TEMP_DIR}/cross-repo/agentic-flow/packages/agentdb-onnx"; do
    [[ -d "$extra_dir" && -f "$extra_dir/tsconfig.json" ]] && extra_pkg_dirs+=("$extra_dir")
  done
  # agentic-flow root uses config/tsconfig.json — compile it directly
  local af_dir="${TEMP_DIR}/cross-repo/agentic-flow/agentic-flow"
  if [[ -f "${af_dir}/config/tsconfig.json" && ! -f "${af_dir}/dist/index.js" ]]; then
    log "  Building agentic-flow (config/tsconfig.json)..."
    local _af_start
    _af_start=$(date +%s%N 2>/dev/null || echo 0)
    "$tsc_bin" -p "${af_dir}/config/tsconfig.json" --skipLibCheck --noCheck 2>/dev/null || true
    local _af_end
    _af_end=$(date +%s%N 2>/dev/null || echo 0)
    local _af_ms=0
    [[ "$_af_start" != "0" && "$_af_end" != "0" ]] && _af_ms=$(( (_af_end - _af_start) / 1000000 ))
    if [[ -f "${af_dir}/dist/index.js" ]]; then
      log "  BUILD: agentic-flow ${_af_ms}ms"
      echo "agentic-flow 1 ${_af_ms}" >> "${TEMP_DIR}/.build-results"
    else
      log "  FAIL: agentic-flow ${_af_ms}ms"
      echo "agentic-flow 0 ${_af_ms}" >> "${TEMP_DIR}/.build-results"
    fi
  fi
  # v3/plugins/* (all plugin packages with tsconfig)
  for extra_dir in "${TEMP_DIR}"/v3/plugins/*/; do
    [[ -d "$extra_dir" && -f "$extra_dir/tsconfig.json" ]] && extra_pkg_dirs+=("$extra_dir")
  done
  if [[ ${#extra_pkg_dirs[@]} -gt 0 ]]; then
    local -a extra_pids=()
    local _extra_start
    _extra_start=$(date +%s%N 2>/dev/null || echo 0)
    for extra_dir in "${extra_pkg_dirs[@]}"; do
      build_one_pkg "$extra_dir" &
      extra_pids+=($!)
    done
    for pid in "${extra_pids[@]}"; do
      wait "$pid" 2>/dev/null || true
    done
    local _extra_end
    _extra_end=$(date +%s%N 2>/dev/null || echo 0)
    if [[ "$_extra_start" != "0" && "$_extra_end" != "0" ]]; then
      local _extra_ms=$(( (_extra_end - _extra_start) / 1000000 ))
      log "  EXTRA (${#extra_pkg_dirs[@]} pkgs): ${_extra_ms}ms wall-clock"
      add_cmd_timing "build" "extra (${#extra_pkg_dirs[@]} pkgs)" "${_extra_ms}"
    fi
  fi

  # Collect results from parallel builds
  while IFS=' ' read -r pkg_name ok _bms; do
    [[ -z "$pkg_name" ]] && continue
    if [[ "$ok" == "1" ]]; then
      built=$((built + 1))
    else
      log_error "TypeScript build failed for ${pkg_name}"
      failed=$((failed + 1))
    fi
    log "  BUILD: ${pkg_name} ${_bms}ms"
    add_build_pkg_timing "${pkg_name}" "${_bms}"
    add_cmd_timing "build" "tsc ${pkg_name}" "${_bms}"
  done < "${TEMP_DIR}/.build-results"
  rm -f "${TEMP_DIR}/.build-results"

  # Build cross-repo packages
  local cross_repo_builds=(
    "cross-repo/agentic-flow/packages/agent-booster"
  )
  for rel_path in "${cross_repo_builds[@]}"; do
    local pkg_dir="${TEMP_DIR}/${rel_path}"
    [[ -d "$pkg_dir" && -f "$pkg_dir/tsconfig.json" ]] || continue

    log "  Building cross-repo: ${rel_path}"
    local _xr_start _xr_end
    _xr_start=$(date +%s%N 2>/dev/null || echo 0)

    # Build WASM and TypeScript in parallel (independent processes)
    local crate_dir="$pkg_dir/crates/agent-booster-wasm"
    local wasm_pid=""
    local _wasm_start=""
    if [[ -d "$crate_dir" ]] && command -v wasm-pack &>/dev/null; then
      log "  Building WASM: ${rel_path}/crates/agent-booster-wasm"
      _wasm_start=$(date +%s%N 2>/dev/null || echo 0)
      (
        wasm_out=$(wasm-pack build "$crate_dir" --target nodejs --out-dir "$pkg_dir/wasm" 2>&1) || {
          echo "WARN: WASM build failed for ${rel_path}" >&2
          echo "$wasm_out" | tail -5 >&2
        }
        if [[ -f "$pkg_dir/wasm/agent_booster_wasm.js" ]]; then
          rm -f "$pkg_dir/wasm/package.json" "$pkg_dir/wasm/.gitignore"
        fi
      ) &
      wasm_pid=$!
    fi

    local _xr_tsc_start _xr_tsc_end
    _xr_tsc_start=$(date +%s%N 2>/dev/null || echo 0)
    if "$tsc_bin" -p "$pkg_dir/tsconfig.json" --skipLibCheck 2>/dev/null; then
      built=$((built + 1))
    else
      log "WARN: TypeScript build failed for ${rel_path}"
      failed=$((failed + 1))
    fi
    _xr_tsc_end=$(date +%s%N 2>/dev/null || echo 0)
    if [[ "$_xr_tsc_start" != "0" && "$_xr_tsc_end" != "0" ]]; then
      local _xr_tsc_ms=$(( (_xr_tsc_end - _xr_tsc_start) / 1000000 ))
      log "  cross-repo TSC: ${_xr_tsc_ms}ms"
      add_cmd_timing "build" "tsc cross-repo/agent-booster" "${_xr_tsc_ms}"
    fi

    # Wait for WASM build to finish
    if [[ -n "$wasm_pid" ]]; then
      wait "$wasm_pid" 2>/dev/null && {
        local _wasm_end
        _wasm_end=$(date +%s%N 2>/dev/null || echo 0)
        if [[ -n "$_wasm_start" && "$_wasm_start" != "0" && "$_wasm_end" != "0" ]]; then
          local _wasm_ms=$(( (_wasm_end - _wasm_start) / 1000000 ))
          log "  WASM build: ${_wasm_ms}ms"
          add_cmd_timing "build" "wasm-pack agent-booster" "${_wasm_ms}"
        fi
        log "  WASM build succeeded"
      } || true
    fi

    _xr_end=$(date +%s%N 2>/dev/null || echo 0)
    if [[ "$_xr_start" != "0" && "$_xr_end" != "0" ]]; then
      local _xr_ms=$(( (_xr_end - _xr_start) / 1000000 ))
      add_cmd_timing "build" "cross-repo total" "${_xr_ms}"
    fi
  done

  log "Build complete: ${built} built, ${skipped} skipped, ${failed} failed"

  local total_packages compiled_packages pre_built_packages _scan_start _scan_end
  _scan_start=$(date +%s%N 2>/dev/null || echo 0)
  total_packages=$(find "${TEMP_DIR}" -name "package.json" -not -path "*/node_modules/*" -not -path "*/.tsc-toolchain/*" 2>/dev/null | xargs grep -l '"@sparkleideas/' 2>/dev/null | wc -l)
  compiled_packages=$(find "${TEMP_DIR}" -name "dist" -type d 2>/dev/null | wc -l)
  pre_built_packages=$((total_packages - compiled_packages))
  _scan_end=$(date +%s%N 2>/dev/null || echo 0)
  if [[ "$_scan_start" != "0" && "$_scan_end" != "0" ]]; then
    local _scan_ms=$(( (_scan_end - _scan_start) / 1000000 ))
    log "  post-build scan: ${_scan_ms}ms"
    add_cmd_timing "build" "find scan" "${_scan_ms}"
  fi
  log "Build directory contains ${total_packages} publishable packages (${compiled_packages} compiled, ${pre_built_packages} pre-built)"
  if [[ $failed -gt 0 ]]; then
    log_error "Some packages failed to build — published packages may be broken"
  fi
}

# ---------------------------------------------------------------------------
# Test (Layers 0-3)
# ---------------------------------------------------------------------------

run_tests_ci() {
  # L0 preflight + L1 unit only — no Verdaccio
  log "Running preflight + unit tests (L0+L1)"
  local _pf_start _pf_end _ut_start _ut_end
  _pf_start=$(date +%s%N 2>/dev/null || echo 0)
  npm run preflight --prefix "${PROJECT_DIR}" || {
    log_error "Preflight failed"
    return 1
  }
  _pf_end=$(date +%s%N 2>/dev/null || echo 0)
  if [[ "$_pf_start" != "0" && "$_pf_end" != "0" ]]; then
    local _pf_ms=$(( (_pf_end - _pf_start) / 1000000 ))
    log "  Preflight (L0): ${_pf_ms}ms"
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
    log "  Unit tests (L1): ${_ut_ms}ms"
    add_cmd_timing "test-ci" "node test-runner.mjs" "${_ut_ms}"
  fi
}

run_verify() {
  # Publish once + install once + all checks + promote
  local -a args=(--build-dir "${TEMP_DIR}")
  [[ -n "${CHANGED_PACKAGES_JSON:-}" && "${CHANGED_PACKAGES_JSON}" != "all" ]] && \
    args+=(--changed-packages "${CHANGED_PACKAGES_JSON}")
  [[ "${TEST_ONLY}" == "true" ]] && args+=(--skip-promote)
  bash "${SCRIPT_DIR}/test-verify.sh" "${args[@]}"
}

run_tests() {
  # Called from sync stage where sub-phase timing is less important
  run_tests_ci
  run_verify
}

# ---------------------------------------------------------------------------
# Read build version from fork package.json
# ---------------------------------------------------------------------------

read_build_version() {
  # Read the CLI package version (has -patch.N suffix), not the root monorepo version
  BUILD_VERSION=$(node -e "
    const fs = require('fs');
    const path = require('path');
    // Try CLI package first (has the definitive version with -patch.N)
    const cliPath = path.join('${TEMP_DIR}', 'v3/@claude-flow/cli/package.json');
    if (fs.existsSync(cliPath)) {
      console.log(require(cliPath).version);
    } else {
      console.log(require('${TEMP_DIR}/package.json').version);
    }
  " 2>/dev/null) || {
    log_error "Could not read version from ${TEMP_DIR}"
    BUILD_VERSION="0.0.0"
  }
  log "Build version: ${BUILD_VERSION}"
}

# ---------------------------------------------------------------------------
# Publish
# ---------------------------------------------------------------------------

## run_publish removed — publish is now handled by test-verify.sh (Phase 3+4)

# ---------------------------------------------------------------------------
# Failure handler: create GitHub issue
# ---------------------------------------------------------------------------

create_failure_issue() {
  local phase="$1"
  local exit_code="$2"

  local title="Build failure in phase: ${phase}"
  local body="The automated ruflo build failed.

**Phase**: ${phase}
**Exit code**: ${exit_code}
**Timestamp**: $(date -u '+%Y-%m-%dT%H:%M:%SZ')
**Server**: $(hostname)

Check build logs:
\`\`\`bash
journalctl -u ruflo-sync --since '1 hour ago' --no-pager
\`\`\`"

  log_error "Creating failure issue: ${title}"
  gh issue create \
    --title "${title}" \
    --body "${body}" \
    --label "build-failure" \
    2>/dev/null || log_error "Could not create GitHub issue (gh CLI failed)"

  send_email "[ruflo] Build failure: ${phase}" "$body"
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

add_cmd_timing() {
  local phase="$1" cmd="$2" ms="$3" exit_code="${4:-0}"
  printf '{"phase":"%s","command":"%s","duration_ms":%s,"exit_code":%s}\n' \
    "$phase" "$cmd" "$ms" "$exit_code" >> "$TIMING_CMDS_FILE"
}

add_build_pkg_timing() {
  local name="$1" ms="$2"
  printf '{"name":"%s","duration_ms":%s}\n' "$name" "$ms" >> "$TIMING_BUILD_PKGS_FILE"
}

run_phase() {
  local phase_name="$1"
  shift

  log "=== Phase: ${phase_name} ==="
  local phase_start_ns
  phase_start_ns=$(date +%s%N 2>/dev/null || echo 0)
  if ! "$@"; then
    local code=$?
    create_failure_issue "${phase_name}" "${code}"
    log_error "Phase '${phase_name}' failed — aborting"
    exit 1
  fi
  local phase_end_ns
  phase_end_ns=$(date +%s%N 2>/dev/null || echo 0)
  if [[ "$phase_start_ns" != "0" && "$phase_end_ns" != "0" ]]; then
    local phase_ms=$(( (phase_end_ns - phase_start_ns) / 1000000 ))
    log "  Phase '${phase_name}' completed in ${phase_ms}ms"
    PHASE_TIMINGS="${PHASE_TIMINGS} ${phase_name}:${phase_ms}"
  fi
}

print_phase_summary() {
  log "──────────────────────────────────────────"
  log "Phase timing summary:"
  for entry in $PHASE_TIMINGS; do
    local name="${entry%%:*}"
    local ms="${entry##*:}"
    if [[ $ms -ge 1000 ]]; then
      log "  $(printf '%-25s %6dms (%ds)' "$name" "$ms" "$((ms / 1000))")"
    else
      log "  $(printf '%-25s %6dms' "$name" "$ms")"
    fi
  done
  log "──────────────────────────────────────────"
}

# ---------------------------------------------------------------------------
# Post-publish helpers (extracted for run_phase timing)
# ---------------------------------------------------------------------------

PIPELINE_START_NS=""

write_pipeline_summary() {
  local summary_dir="${PROJECT_DIR}/test-results"
  mkdir -p "$summary_dir"
  local timestamp
  timestamp=$(date -u '+%Y%m%dT%H%M%SZ')
  local summary_file="${summary_dir}/${timestamp}/pipeline-timing.json"
  mkdir -p "$(dirname "$summary_file")"

  local pipeline_end_ns
  pipeline_end_ns=$(date +%s%N 2>/dev/null || echo 0)
  local pipeline_ms=0
  if [[ -n "$PIPELINE_START_NS" && "$PIPELINE_START_NS" != "0" && "$pipeline_end_ns" != "0" ]]; then
    pipeline_ms=$(( (pipeline_end_ns - PIPELINE_START_NS) / 1000000 ))
  fi

  # Use node to assemble the full timing JSON (phases + commands + packages + verify sub-phases)
  node -e "
    const fs = require('fs');
    const phases = '${PHASE_TIMINGS}'.trim().split(/\s+/).filter(Boolean).map(e => {
      const i = e.lastIndexOf(':');
      return { name: e.slice(0, i), duration_ms: parseInt(e.slice(i + 1)) };
    });
    let commands = [];
    try {
      commands = fs.readFileSync('${TIMING_CMDS_FILE}', 'utf-8')
        .trim().split('\\n').filter(Boolean).map(l => JSON.parse(l));
    } catch {}
    let buildPkgs = [];
    try {
      buildPkgs = fs.readFileSync('${TIMING_BUILD_PKGS_FILE}', 'utf-8')
        .trim().split('\\n').filter(Boolean).map(l => JSON.parse(l));
    } catch {}
    let publishPkgs = [];
    try {
      publishPkgs = JSON.parse(fs.readFileSync('${PROJECT_DIR}/config/.publish-timing.json', 'utf-8'));
    } catch {}
    let verifyPhases = [];
    try {
      verifyPhases = fs.readFileSync('/tmp/ruflo-verify-timing.jsonl', 'utf-8')
        .trim().split('\\n').filter(Boolean).map(l => JSON.parse(l));
    } catch {}
    const result = {
      timestamp: '${timestamp}',
      version: '${BUILD_VERSION:-unknown}',
      total_duration_ms: ${pipeline_ms},
      acceptance_passed: true,
      phases,
      commands,
      verify_phases: verifyPhases,
      packages: {
        build: buildPkgs,
        publish: publishPkgs.map(p => ({
          name: p.name, duration_ms: p.duration_ms || 0,
          version: p.version || '', tag: p.tag || ''
        }))
      }
    };
    fs.writeFileSync('${summary_file}', JSON.stringify(result, null, 2) + '\\n');
  " 2>/dev/null || {
    log "WARNING: Node JSON assembly failed — writing basic summary"
    local phases_json='[]'
    cat > "$summary_file" <<EOJSON
{"timestamp":"${timestamp}","version":"${BUILD_VERSION:-unknown}","total_duration_ms":${pipeline_ms},"acceptance_passed":true,"phases":${phases_json},"commands":[],"verify_phases":[],"packages":{"build":[],"publish":[]}}
EOJSON
  }
  log "Pipeline timing summary written to ${summary_file}"
}

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
  run_phase "build" run_build
  write_build_manifest

  if [[ "${BUILD_ONLY}" == "true" ]]; then
    print_phase_summary
    log "Build complete (--build-only mode). Artifacts at: ${TEMP_DIR}"
    return 0
  fi

  # Test (L0+L1 only — no Verdaccio)
  run_phase "test-ci" run_tests_ci

  # Verify: publish once, install once, all checks, promote (unless --test-only)
  run_phase "verify" run_verify

  if [[ "${TEST_ONLY}" == "true" ]]; then
    print_phase_summary
    log "Gate 1 PASSED — all tests pass (--test-only mode)"
    return 0
  fi

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

  # D1: Reuse build artifacts if the publish stage already built from the
  # same fork HEADs (avoids redundant copy+codemod+build ~26s)
  if check_build_freshness; then
    log "Reusing existing build artifacts from publish stage"
    TEMP_DIR="${STABLE_BUILD_DIR}"
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

  # Test (L0-L3) against the sync branch build
  local tests_passed=false
  if run_tests; then
    tests_passed=true
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
      create_sync_pr "${dir}" "${name}" "${current_branch}" "ready" \
        "All tests passed (L0-L3). Ready for review and merge."
      send_email "[ruflo] Sync PR ready for ${name}" \
        "Upstream sync for ${name} is ready for review.\nBranch: ${current_branch}\nAll L0-L3 tests passed."
    else
      create_sync_pr "${dir}" "${name}" "${current_branch}" "test-failure" \
        "Tests failed during sync validation. Review required."
      send_email "[ruflo] Sync test failure for ${name}" \
        "Upstream sync for ${name} failed tests.\nBranch: ${current_branch}\nManual review required."
    fi

    # Switch back to main
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
  log "  --test-only=${TEST_ONLY} --force=${FORCE_BUILD}"
  log "  --build-only=${BUILD_ONLY} --pull=${PULL_UPSTREAM}"
  log "=========================================="

  # Global timeout — 900s
  # Close fd 9 (flock) in the subshell so the timeout process does NOT inherit
  # the lock. Without this, if the main script is killed externally the orphaned
  # sleep process keeps the flock forever, blocking all future pipeline runs.
  ( exec 9>&-; sleep 900; log_error "[TIMEOUT] sync-and-build.sh exceeded 900s — sending SIGTERM"; kill -TERM -$$ 2>/dev/null || kill -TERM $$ 2>/dev/null || true; sleep 5; kill -KILL -$$ 2>/dev/null || kill -KILL $$ 2>/dev/null || true ) &
  GLOBAL_TIMEOUT_PID=$!

  # Load previous state
  load_state

  # --seed-state: record current fork HEADs as baseline without building.
  # Use after clean-slate reset so the NEXT run is incremental (not "all changed").
  if [[ "${SEED_STATE}" == "true" ]]; then
    log "Seeding state file with current fork HEADs..."
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
        log "  ${name}: ${sha:0:12}"
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

  # Copy publish-stage build artifacts to stable dir for sync-stage reuse
  if [[ -n "${TEMP_DIR}" && -d "${TEMP_DIR}" && -f "${TEMP_DIR}/.build-manifest.json" ]]; then
    STABLE_BUILD_DIR="/tmp/ruflo-build"
    if [[ "${TEMP_DIR}" != "${STABLE_BUILD_DIR}" ]]; then
      log "Caching publish-stage build to ${STABLE_BUILD_DIR} for sync reuse"
      rsync -a --delete "${TEMP_DIR}/" "${STABLE_BUILD_DIR}/"
      # Update manifest with post-push HEADs so sync stage freshness check passes
      local codemod_hash
      codemod_hash=$(sha256sum "${SCRIPT_DIR}/codemod.mjs" 2>/dev/null | cut -d' ' -f1) || codemod_hash=""
      cat > "${STABLE_BUILD_DIR}/.build-manifest.json" <<MEOF
{
  "version": 2,
  "built_at": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "ruflo_head": "${NEW_RUFLO_HEAD:-}",
  "agentic_head": "${NEW_AGENTIC_HEAD:-}",
  "fann_head": "${NEW_FANN_HEAD:-}",
  "ruvector_head": "${NEW_RUVECTOR_HEAD:-}",
  "codemod_hash": "${codemod_hash}"
}
MEOF
    fi
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
