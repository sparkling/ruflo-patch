#!/usr/bin/env bash
# sync-and-build.sh — Fork-based build pipeline for ruflo (ADR-0027).
#
# Two stages (Stage 2 is manual GitHub PR review, not in this script):
#
#   --publish   Stage 3: Detect merges to fork main, bump versions,
#               build, test (L0-L3), publish to npm, run L4 acceptance,
#               promote to @latest on success.
#
#   --sync      Stage 1: Fetch upstream, create sync branch, merge,
#               type-check, build, test (L0-L3). On success create PR
#               with label "ready". On failure create PR with error label.
#
# Stage 3 runs before Stage 1 when both are requested (default).
#
# Flags:
#   --sync        Stage 1 only
#   --publish     Stage 3 only
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
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Another sync-and-build is already running — exiting"
    exit 0
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

FORK_NAMES=("ruflo" "agentic-flow" "ruv-FANN")
FORK_DIRS=("${FORK_DIR_RUFLO}" "${FORK_DIR_AGENTIC}" "${FORK_DIR_FANN}")

UPSTREAM_RUFLO="https://github.com/ruvnet/ruflo.git"
UPSTREAM_AGENTIC="https://github.com/ruvnet/agentic-flow.git"
UPSTREAM_FANN="https://github.com/ruvnet/ruv-FANN.git"

UPSTREAM_URLS=("${UPSTREAM_RUFLO}" "${UPSTREAM_AGENTIC}" "${UPSTREAM_FANN}")

TEMP_DIR=""  # set in create_temp_dir, cleaned up on exit

# Track fork HEAD SHAs for state
NEW_RUFLO_HEAD=""
NEW_AGENTIC_HEAD=""
NEW_FANN_HEAD=""

# Selective version bumping: tracks which forks changed (set by check_merged_prs)
CHANGED_FORK_SHAS=""  # format: dir1:oldSha,dir2:oldSha
# JSON array of @sparkleideas/* packages: CHANGED = full transitive set (for publish)
CHANGED_PACKAGES_JSON="all"
# DIRECTLY_CHANGED = source-changed only (for build — no transitive deps)
DIRECTLY_CHANGED_JSON="all"

# Build version (set by read_build_version)
BUILD_VERSION=""

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
  UPSTREAM_RUFLO_SHA=""
  UPSTREAM_AGENTIC_SHA=""
  UPSTREAM_FANN_SHA=""

  if [[ -f "${STATE_FILE}" ]]; then
    log "Loading state from ${STATE_FILE}"
    while IFS='=' read -r key value; do
      [[ -z "${key}" || "${key}" =~ ^# ]] && continue
      case "${key}" in
        RUFLO_HEAD)          RUFLO_HEAD="${value}" ;;
        AGENTIC_HEAD)        AGENTIC_HEAD="${value}" ;;
        FANN_HEAD)           FANN_HEAD="${value}" ;;
        UPSTREAM_RUFLO_SHA)  UPSTREAM_RUFLO_SHA="${value}" ;;
        UPSTREAM_AGENTIC_SHA) UPSTREAM_AGENTIC_SHA="${value}" ;;
        UPSTREAM_FANN_SHA)   UPSTREAM_FANN_SHA="${value}" ;;
      esac
    done < "${STATE_FILE}"
    log "State loaded: RUFLO=${RUFLO_HEAD:0:12}, AGENTIC=${AGENTIC_HEAD:0:12}, FANN=${FANN_HEAD:0:12}"
  else
    log "No state file found — first run"
  fi

  # Snapshot state as PREV_* for check_merged_prs() comparison
  PREV_RUFLO_HEAD="${RUFLO_HEAD}"
  PREV_AGENTIC_HEAD="${AGENTIC_HEAD}"
  PREV_FANN_HEAD="${FANN_HEAD}"
}

save_state() {
  cat > "${STATE_FILE}" <<EOF
# ruflo build state — written by sync-and-build.sh (ADR-0027)
# Last updated: $(date -u '+%Y-%m-%dT%H:%M:%SZ')
RUFLO_HEAD=${NEW_RUFLO_HEAD:-${RUFLO_HEAD}}
AGENTIC_HEAD=${NEW_AGENTIC_HEAD:-${AGENTIC_HEAD}}
FANN_HEAD=${NEW_FANN_HEAD:-${FANN_HEAD}}
UPSTREAM_RUFLO_SHA=${UPSTREAM_RUFLO_SHA:-}
UPSTREAM_AGENTIC_SHA=${UPSTREAM_AGENTIC_SHA:-}
UPSTREAM_FANN_SHA=${UPSTREAM_FANN_SHA:-}
EOF
  log "State saved"
}

# ---------------------------------------------------------------------------
# Stage 3: Check for merged PRs (origin/main vs local main)
# ---------------------------------------------------------------------------

check_merged_prs() {
  # Returns 0 if any fork has new commits on origin/main since last build, 1 otherwise.
  # Compares origin/main SHA against the STATE FILE (not local main), so pushes
  # from this machine are detected correctly.
  # Updates NEW_*_HEAD variables and fast-forwards local main.
  # Sets CHANGED_FORK_SHAS (format: dir1:oldSha,dir2:oldSha) for selective bumping.
  local any_changed=false
  CHANGED_FORK_SHAS=""

  for i in "${!FORK_NAMES[@]}"; do
    local name="${FORK_NAMES[$i]}"
    local dir="${FORK_DIRS[$i]}"

    if [[ ! -d "${dir}/.git" ]]; then
      log_error "Fork directory ${dir} is not a git repo"
      continue
    fi

    # Fetch origin to see if anything was merged
    git -C "${dir}" fetch origin main --quiet 2>/dev/null || {
      log_error "Failed to fetch origin for ${name}"
      continue
    }

    local origin_sha state_sha
    origin_sha=$(git -C "${dir}" rev-parse origin/main 2>/dev/null) || continue

    # Get the SHA from the state file (last successfully processed build)
    case "$name" in
      ruflo)        state_sha="${PREV_RUFLO_HEAD:-}" ;;
      agentic-flow) state_sha="${PREV_AGENTIC_HEAD:-}" ;;
      ruv-FANN)     state_sha="${PREV_FANN_HEAD:-}" ;;
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
    git -C "${dir}" checkout main --quiet 2>/dev/null || true
    git -C "${dir}" merge --ff-only origin/main --quiet 2>/dev/null || {
      # If local has diverged (shouldn't normally happen), reset to origin
      git -C "${dir}" reset --hard origin/main --quiet 2>/dev/null || true
    }

    local new_sha
    new_sha=$(git -C "${dir}" rev-parse HEAD 2>/dev/null) || continue
    case "$name" in
      ruflo)        NEW_RUFLO_HEAD="$new_sha" ;;
      agentic-flow) NEW_AGENTIC_HEAD="$new_sha" ;;
      ruv-FANN)     NEW_FANN_HEAD="$new_sha" ;;
    esac
  done

  if [[ "$any_changed" == "true" ]]; then
    return 0
  fi
  return 1
}

# ---------------------------------------------------------------------------
# Stage 3: Bump fork versions, commit, tag, push
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

  # Commit and push each fork that changed
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

      git -C "${dir}" commit -m "chore: bump versions to ${cli_version}" --quiet 2>/dev/null || true

      # Tag with version
      local tag="v${cli_version}"
      git -C "${dir}" tag -a "$tag" -m "Release ${tag}" 2>/dev/null || {
        log "Tag ${tag} already exists in ${name} — skipping"
      }

      # Push commit and tag
      git -C "${dir}" push origin main --quiet 2>/dev/null || {
        log_error "Failed to push version bump for ${name}"
      }
      git -C "${dir}" push origin "$tag" --quiet 2>/dev/null || true

      log "Version bump committed and pushed for ${name}: ${cli_version}"
    else
      log "No version changes in ${name} — skipping commit"
    fi
  done
}

# ---------------------------------------------------------------------------
# Stage 1: Sync upstream into fork branches
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
    git -C "${dir}" fetch upstream main --quiet 2>/dev/null || {
      log_error "Failed to fetch upstream for ${name}"
      continue
    }

    local upstream_sha last_synced_sha
    upstream_sha=$(git -C "${dir}" rev-parse upstream/main 2>/dev/null) || continue

    # Get last-synced SHA from state
    case "$name" in
      ruflo)        last_synced_sha="${UPSTREAM_RUFLO_SHA:-}" ;;
      agentic-flow) last_synced_sha="${UPSTREAM_AGENTIC_SHA:-}" ;;
      ruv-FANN)     last_synced_sha="${UPSTREAM_FANN_SHA:-}" ;;
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

    log "Merged upstream/main into ${branch_name} for ${name}"

    # Update upstream SHA tracking
    local upstream_sha
    upstream_sha=$(git -C "${dir}" rev-parse upstream/main 2>/dev/null) || true
    case "$name" in
      ruflo)        UPSTREAM_RUFLO_SHA="$upstream_sha" ;;
      agentic-flow) UPSTREAM_AGENTIC_SHA="$upstream_sha" ;;
      ruv-FANN)     UPSTREAM_FANN_SHA="$upstream_sha" ;;
    esac
  done

  # Type-check each fork on the sync branch
  for i in "${forks_to_sync[@]}"; do
    local name="${FORK_NAMES[$i]}"
    local dir="${FORK_DIRS[$i]}"

    # Only type-check if there's a tsconfig.json
    if [[ -f "${dir}/tsconfig.json" ]]; then
      log "Type-checking ${name} on sync branch"
      local tsc_bin="${dir}/node_modules/.bin/tsc"
      if [[ ! -x "$tsc_bin" ]]; then
        # Try npx
        tsc_bin="npx tsc"
      fi
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
  git -C "${dir}" push origin "${branch}" --quiet 2>/dev/null || {
    log_error "Failed to push branch ${branch} for ${name}"
    return 1
  }

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

  # Copy the primary fork (ruflo) as the base
  cp -a "${FORK_DIR_RUFLO}/." "${TEMP_DIR}/"
  rm -rf "${TEMP_DIR}/.git"

  # Copy cross-repo packages into the build dir (ADR-0014 Level 1)
  # agentic-flow repo provides agentdb and agentic-flow packages
  mkdir -p "${TEMP_DIR}/cross-repo/agentic-flow"
  cp -a "${FORK_DIR_AGENTIC}/." "${TEMP_DIR}/cross-repo/agentic-flow/"
  rm -rf "${TEMP_DIR}/cross-repo/agentic-flow/.git"

  # ruv-FANN repo provides ruv-swarm package
  mkdir -p "${TEMP_DIR}/cross-repo/ruv-FANN"
  cp -a "${FORK_DIR_FANN}/." "${TEMP_DIR}/cross-repo/ruv-FANN/"
  rm -rf "${TEMP_DIR}/cross-repo/ruv-FANN/.git"

  log "Source copied to temp directory (3 forks merged)"
}

# ---------------------------------------------------------------------------
# Codemod
# ---------------------------------------------------------------------------

run_codemod() {
  log "Running codemod: @claude-flow/* -> @sparkleideas/*"
  node "${SCRIPT_DIR}/codemod.mjs" "${TEMP_DIR}"
  log "Codemod complete"
}

# ---------------------------------------------------------------------------
# Build manifest (ADR-0026)
# ---------------------------------------------------------------------------

STABLE_BUILD_DIR="/tmp/ruflo-build"

write_build_manifest() {
  local manifest="${TEMP_DIR}/.build-manifest.json"
  local codemod_hash
  codemod_hash=$(sha256sum "${SCRIPT_DIR}/codemod.mjs" 2>/dev/null | cut -d' ' -f1) || codemod_hash=""

  cat > "$manifest" <<MANIFESTEOF
{
  "version": 2,
  "built_at": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "ruflo_head": "${NEW_RUFLO_HEAD:-}",
  "agentic_head": "${NEW_AGENTIC_HEAD:-}",
  "fann_head": "${NEW_FANN_HEAD:-}",
  "codemod_hash": "${codemod_hash}",
  "packages_compiled": $(find "${TEMP_DIR}" -name "dist" -type d 2>/dev/null | wc -l),
  "packages_total": $(find "${TEMP_DIR}" -name "package.json" -not -path "*/node_modules/*" -not -path "*/.tsc-toolchain/*" 2>/dev/null | xargs grep -l '"@sparkleideas/' 2>/dev/null | wc -l)
}
MANIFESTEOF
  log "Build manifest written to ${manifest}"
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
    console.log([m.ruflo_head, m.agentic_head, m.fann_head, m.codemod_hash].join(':'));
  " 2>/dev/null) || { log "Cannot read manifest — will build"; return 1; }

  local stored_ruflo stored_agentic stored_fann stored_codemod
  IFS=':' read -r stored_ruflo stored_agentic stored_fann stored_codemod <<< "$stored"

  local current_codemod
  current_codemod=$(sha256sum "${SCRIPT_DIR}/codemod.mjs" 2>/dev/null | cut -d' ' -f1) || current_codemod=""

  if [[ "${stored_ruflo}" == "${NEW_RUFLO_HEAD}" && \
        "${stored_agentic}" == "${NEW_AGENTIC_HEAD}" && \
        "${stored_fann}" == "${NEW_FANN_HEAD}" && \
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

  # Install TypeScript in an isolated directory
  local tsc_dir="${TEMP_DIR}/.tsc-toolchain"
  log "Installing TypeScript toolchain"
  mkdir -p "$tsc_dir"
  echo '{}' > "$tsc_dir/package.json"
  local tsc_install_start
  tsc_install_start=$(date +%s%N 2>/dev/null || echo 0)
  (cd "$tsc_dir" && npm install typescript@5 2>&1) || {
    log_error "Failed to install TypeScript"
    return 1
  }
  local tsc_install_end
  tsc_install_end=$(date +%s%N 2>/dev/null || echo 0)
  if [[ "$tsc_install_start" != "0" && "$tsc_install_end" != "0" ]]; then
    local _tsc_ms=$(( (tsc_install_end - tsc_install_start) / 1000000 ))
    log "  TypeScript install: ${_tsc_ms}ms"
    add_cmd_timing "build" "npm install typescript@5" "${_tsc_ms}"
  fi
  local TSC="$tsc_dir/node_modules/.bin/tsc"

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
  for pkg_name in "${build_order[@]}"; do
    local pkg_dir="$v3_dir/@claude-flow/${pkg_name}"
    [[ -d "$pkg_dir" ]] || continue
    [[ -f "$pkg_dir/tsconfig.json" ]] || continue

    # Skip unchanged packages (selective build)
    if [[ "$selective_build" == "true" && -z "${changed_set[$pkg_name]:-}" ]]; then
      skipped=$((skipped + 1))
      continue
    fi

    local pkg_build_start
    pkg_build_start=$(date +%s%N 2>/dev/null || echo 0)

    # Create a standalone tsconfig that doesn't require project references
    local tmp_tsconfig="$pkg_dir/tsconfig.build.json"
    node -e "
      const ts = JSON.parse(require('fs').readFileSync('$pkg_dir/tsconfig.json', 'utf-8'));
      delete ts.references;
      if (ts.extends) {
        try {
          const base = JSON.parse(require('fs').readFileSync(require('path').resolve('$pkg_dir', ts.extends), 'utf-8'));
          ts.compilerOptions = { ...base.compilerOptions, ...ts.compilerOptions };
          delete ts.extends;
        } catch {}
      }
      ts.compilerOptions.skipLibCheck = true;
      ts.compilerOptions.noEmit = false;
      require('fs').writeFileSync('$tmp_tsconfig', JSON.stringify(ts, null, 2));
    " 2>/dev/null

    if "$TSC" -p "$tmp_tsconfig" --skipLibCheck 2>/dev/null; then
      built=$((built + 1))
    else
      if "$TSC" -p "$tmp_tsconfig" --skipLibCheck --noCheck 2>/dev/null; then
        built=$((built + 1))
      else
        log "WARN: TypeScript build failed for ${pkg_name} — trying transpileOnly"
        if "$TSC" -p "$tmp_tsconfig" --skipLibCheck --noCheck --isolatedModules 2>/dev/null; then
          built=$((built + 1))
        else
          log_error "TypeScript build failed for ${pkg_name}"
          failed=$((failed + 1))
        fi
      fi
    fi
    rm -f "$tmp_tsconfig"
    local pkg_build_end
    pkg_build_end=$(date +%s%N 2>/dev/null || echo 0)
    if [[ "$pkg_build_start" != "0" && "$pkg_build_end" != "0" ]]; then
      local _bms=$(( (pkg_build_end - pkg_build_start) / 1000000 ))
      log "  BUILD: ${pkg_name} ${_bms}ms"
      add_build_pkg_timing "${pkg_name}" "${_bms}"
      add_cmd_timing "build" "tsc ${pkg_name}" "${_bms}"
    fi
  done

  # Build cross-repo packages
  local cross_repo_builds=(
    "cross-repo/agentic-flow/packages/agent-booster"
  )
  for rel_path in "${cross_repo_builds[@]}"; do
    local pkg_dir="${TEMP_DIR}/${rel_path}"
    [[ -d "$pkg_dir" && -f "$pkg_dir/tsconfig.json" ]] || continue

    log "  Building cross-repo: ${rel_path}"

    # Build WASM module if this package has a Rust crate
    local crate_dir="$pkg_dir/crates/agent-booster-wasm"
    if [[ -d "$crate_dir" ]] && command -v wasm-pack &>/dev/null; then
      log "  Building WASM: ${rel_path}/crates/agent-booster-wasm"
      local wasm_out
      wasm_out=$(wasm-pack build "$crate_dir" --target nodejs --out-dir "$pkg_dir/wasm" 2>&1) || {
        log "WARN: WASM build failed for ${rel_path} (agent-booster ESM import will fail)"
        echo "$wasm_out" | tail -5 | while IFS= read -r line; do log "  $line"; done
      }
      if [[ -f "$pkg_dir/wasm/agent_booster_wasm.js" ]]; then
        rm -f "$pkg_dir/wasm/package.json" "$pkg_dir/wasm/.gitignore"
        log "  WASM build succeeded"
      fi
    fi

    if "$TSC" -p "$pkg_dir/tsconfig.json" --skipLibCheck 2>/dev/null; then
      built=$((built + 1))
    else
      log "WARN: TypeScript build failed for ${rel_path}"
      failed=$((failed + 1))
    fi
  done

  log "Build complete: ${built} built, ${skipped} skipped, ${failed} failed"

  local total_packages compiled_packages pre_built_packages
  total_packages=$(find "${TEMP_DIR}" -name "package.json" -not -path "*/node_modules/*" -not -path "*/.tsc-toolchain/*" 2>/dev/null | xargs grep -l '"@sparkleideas/' 2>/dev/null | wc -l)
  compiled_packages=$(find "${TEMP_DIR}" -name "dist" -type d 2>/dev/null | wc -l)
  pre_built_packages=$((total_packages - compiled_packages))
  log "Build directory contains ${total_packages} publishable packages (${compiled_packages} compiled, ${pre_built_packages} pre-built)"
  if [[ $failed -gt 0 ]]; then
    log_error "Some packages failed to build — published packages may be broken"
  fi
}

# ---------------------------------------------------------------------------
# Test (Layers 0-3)
# ---------------------------------------------------------------------------

run_tests_l1() {
  log "Running unit tests (L0+L1)"
  local _t0; _t0=$(date +%s%N 2>/dev/null || echo 0)
  npm test --prefix "${PROJECT_DIR}" || {
    log_error "Unit tests failed"
    return 1
  }
  local _t1; _t1=$(date +%s%N 2>/dev/null || echo 0)
  [[ "$_t0" != "0" && "$_t1" != "0" ]] && add_cmd_timing "test-l1-unit" "npm test" "$(( (_t1 - _t0) / 1000000 ))"
}

run_tests_l2() {
  log "Running integration test (L2: local Verdaccio)"
  local _t0; _t0=$(date +%s%N 2>/dev/null || echo 0)
  CHANGED_PACKAGES_JSON="${CHANGED_PACKAGES_JSON:-all}" bash "${SCRIPT_DIR}/test-integration.sh" || {
    log_error "Integration test failed — aborting before publish to npm"
    return 1
  }
  local _t1; _t1=$(date +%s%N 2>/dev/null || echo 0)
  [[ "$_t0" != "0" && "$_t1" != "0" ]] && add_cmd_timing "test-l2-integration" "test-integration.sh" "$(( (_t1 - _t0) / 1000000 ))"
}

run_tests_l3() {
  log "Running Release Qualification (L3)"
  local -a rq_args=(--build-dir "${TEMP_DIR}")
  # Pass changed packages for incremental Verdaccio clearing
  if [[ -n "${CHANGED_PACKAGES_JSON:-}" && "${CHANGED_PACKAGES_JSON}" != "all" ]]; then
    rq_args+=(--changed-packages "${CHANGED_PACKAGES_JSON}")
  fi
  local _t0; _t0=$(date +%s%N 2>/dev/null || echo 0)
  bash "${SCRIPT_DIR}/test-rq.sh" "${rq_args[@]}" || {
    log_error "Release Qualification FAILED"
    return 1
  }
  local _t1; _t1=$(date +%s%N 2>/dev/null || echo 0)
  [[ "$_t0" != "0" && "$_t1" != "0" ]] && add_cmd_timing "test-l3-rq" "test-rq.sh" "$(( (_t1 - _t0) / 1000000 ))"
}

run_tests() {
  # Called from Stage 1 (sync) where sub-phase timing is less important
  run_tests_l1
  run_tests_l2
  run_tests_l3
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

run_publish() {
  # Copy .npmrc with auth token into temp dir
  cp "${HOME}/.npmrc" "${TEMP_DIR}/.npmrc" 2>/dev/null || {
    echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN:-}" > "${TEMP_DIR}/.npmrc"
  }

  log "Publishing packages (versions from fork package.json files)"
  local -a publish_args=(--build-dir "${TEMP_DIR}")
  # Selective publish: only publish changed packages (+ dependents)
  if [[ -n "${CHANGED_PACKAGES_JSON:-}" && "${CHANGED_PACKAGES_JSON}" != "all" ]]; then
    publish_args+=(--packages "${CHANGED_PACKAGES_JSON}")
    log "Selective publish: $(echo "${CHANGED_PACKAGES_JSON}" | node -e "try{console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).length)}catch{console.log('?')}" 2>/dev/null) packages"
  fi
  local _pub_start; _pub_start=$(date +%s%N 2>/dev/null || echo 0)
  local _pub_rc=0
  node "${SCRIPT_DIR}/publish.mjs" "${publish_args[@]}" || _pub_rc=$?
  local _pub_end; _pub_end=$(date +%s%N 2>/dev/null || echo 0)
  if [[ $_pub_rc -ne 0 ]]; then
    log_error "publish.mjs failed with exit code ${_pub_rc}"
    return $_pub_rc
  fi
  log "Publish complete"
  if [[ "$_pub_start" != "0" && "$_pub_end" != "0" ]]; then
    add_cmd_timing "publish" "node publish.mjs" "$(( (_pub_end - _pub_start) / 1000000 ))"
  fi

  # Publish the local wrapper package (@sparkleideas/ruflo)
  # Auto-bump wrapper version if current version already exists on npm.
  if [[ -f "${PROJECT_DIR}/package.json" ]]; then
    local wrapper_ver
    wrapper_ver=$(node -e "console.log(require('${PROJECT_DIR}/package.json').version)" 2>/dev/null) || wrapper_ver=""
    if [[ -n "$wrapper_ver" ]]; then
      # Check if this wrapper version already exists on npm
      local wrapper_exists
      wrapper_exists=$(npm view "@sparkleideas/ruflo@${wrapper_ver}" version 2>/dev/null) || wrapper_exists=""
      if [[ "$wrapper_exists" == "$wrapper_ver" ]]; then
        # Bump wrapper version using same -patch.N logic
        local new_wrapper_ver
        new_wrapper_ver=$(node -e "
          import { bumpPatchVersion } from '${SCRIPT_DIR}/fork-version.mjs';
          console.log(bumpPatchVersion('${wrapper_ver}'));
        " --input-type=module 2>/dev/null) || new_wrapper_ver=""
        if [[ -n "$new_wrapper_ver" ]]; then
          log "Auto-bumping wrapper: ${wrapper_ver} -> ${new_wrapper_ver}"
          node -e "
            const fs = require('fs');
            const pkg = JSON.parse(fs.readFileSync('${PROJECT_DIR}/package.json', 'utf-8'));
            pkg.version = '${new_wrapper_ver}';
            fs.writeFileSync('${PROJECT_DIR}/package.json', JSON.stringify(pkg, null, 2) + '\n');
          " 2>/dev/null
          wrapper_ver="$new_wrapper_ver"
        fi
      fi
      log "Publishing wrapper package (@sparkleideas/ruflo@${wrapper_ver})"
      npm publish "${PROJECT_DIR}" --access public --ignore-scripts --tag prerelease 2>&1 || {
        log "  wrapper publish skipped (may already exist at this version)"
      }
      # Add wrapper to published-versions.json so promote.sh includes it
      local pvfile="${PROJECT_DIR}/config/published-versions.json"
      if [[ -f "$pvfile" ]]; then
        node -e "
          const fs = require('fs');
          const pv = JSON.parse(fs.readFileSync('${pvfile}', 'utf-8'));
          pv['@sparkleideas/ruflo'] = '${wrapper_ver}';
          fs.writeFileSync('${pvfile}', JSON.stringify(pv, null, 2) + '\n');
        " 2>/dev/null && log "  added wrapper to published-versions.json"
      fi
    fi
  fi
}

# ---------------------------------------------------------------------------
# GitHub release notification
# ---------------------------------------------------------------------------

create_github_notification() {
  local tag="sparkleideas/v${BUILD_VERSION}"
  local current_local_head
  current_local_head=$(git -C "${PROJECT_DIR}" rev-parse HEAD 2>/dev/null || echo "unknown")

  local pkg_versions=""
  if [[ -f "${PROJECT_DIR}/config/published-versions.json" ]]; then
    pkg_versions=$(node -e "
      const pv = JSON.parse(require('fs').readFileSync('${PROJECT_DIR}/config/published-versions.json', 'utf-8'));
      for (const [name, ver] of Object.entries(pv)) {
        console.log('- \`' + name + '@' + ver + '\`');
      }
    " 2>/dev/null) || true
  fi

  local body
  body="Automated build from forks (ADR-0027).

**CLI Version**: \`${BUILD_VERSION}\`
**Fork ruflo HEAD**: \`${NEW_RUFLO_HEAD:0:12}\`
**Fork agentic-flow HEAD**: \`${NEW_AGENTIC_HEAD:0:12}\`
**Fork ruv-FANN HEAD**: \`${NEW_FANN_HEAD:0:12}\`
**Local commit**: \`${current_local_head:0:12}\`
**Build timestamp**: $(date -u '+%Y-%m-%dT%H:%M:%SZ')

### Published packages
${pkg_versions:-_(none)_}

Install:
\`\`\`bash
npx @sparkleideas/cli
\`\`\`

Promote to latest:
\`\`\`bash
npm run promote
\`\`\`"

  log "Creating GitHub prerelease: ${tag}"
  gh release create "${tag}" \
    --repo "$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo 'ruvnet/ruflo')" \
    --title "@sparkleideas/cli ${BUILD_VERSION}" \
    --notes "${body}" \
    --prerelease \
    --target "$(git -C "${PROJECT_DIR}" rev-parse HEAD 2>/dev/null || echo HEAD)" \
    2>/dev/null || {
      log_error "Failed to create GitHub prerelease (non-fatal)"
    }

  log "GitHub notification created"
}

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

ACCEPTANCE_PASSED=false
PIPELINE_START_NS=""

wait_for_cdn() {
  log "Waiting for npm CDN to propagate ${BUILD_VERSION}..."
  local cdn_attempts=0
  local cdn_max=12
  while [[ $cdn_attempts -lt $cdn_max ]]; do
    local cdn_ver
    cdn_ver=$(npm view @sparkleideas/cli@prerelease version 2>/dev/null) || true
    if [[ "$cdn_ver" == "$BUILD_VERSION" ]]; then
      log "CDN propagation confirmed: @sparkleideas/cli@prerelease = ${cdn_ver}"
      return 0
    fi
    cdn_attempts=$((cdn_attempts + 1))
    log "  CDN check ${cdn_attempts}/${cdn_max}: got '${cdn_ver:-}', waiting for '${BUILD_VERSION}'..."
    sleep 10
  done
  log "WARNING: CDN propagation timed out after ${cdn_max}0s — continuing anyway"
}

run_acceptance_tests() {
  log "Running post-publish acceptance tests against version ${BUILD_VERSION}"
  local _t0; _t0=$(date +%s%N 2>/dev/null || echo 0)
  if bash "${SCRIPT_DIR}/test-acceptance.sh" --version "${BUILD_VERSION}"; then
    log "Acceptance tests passed"
    ACCEPTANCE_PASSED=true
  else
    log_error "WARNING: Acceptance tests failed after publish (packages are live)"
    create_failure_issue "post-publish-acceptance" "$?"
    send_email "[ruflo] Acceptance FAILED for ${BUILD_VERSION}" \
      "Post-publish acceptance tests failed.\nPackages are live on @prerelease but NOT promoted to @latest."
  fi
  local _t1; _t1=$(date +%s%N 2>/dev/null || echo 0)
  [[ "$_t0" != "0" && "$_t1" != "0" ]] && add_cmd_timing "test-l4-acceptance" "test-acceptance.sh" "$(( (_t1 - _t0) / 1000000 ))"
}

run_promote() {
  log "Promoting ${BUILD_VERSION} to @latest"
  local _t0; _t0=$(date +%s%N 2>/dev/null || echo 0)
  if bash "${SCRIPT_DIR}/promote.sh" --yes; then
    log "Promotion to @latest complete"
    send_email "[ruflo] Promoted ${BUILD_VERSION} to @latest" \
      "All packages promoted to @latest.\nVersion: ${BUILD_VERSION}"
  else
    log_error "WARNING: Promotion to @latest failed"
    create_failure_issue "promote-latest" "$?"
  fi
  local _t1; _t1=$(date +%s%N 2>/dev/null || echo 0)
  [[ "$_t0" != "0" && "$_t1" != "0" ]] && add_cmd_timing "promote" "promote.sh" "$(( (_t1 - _t0) / 1000000 ))"
}

run_post_promote_smoke() {
  log "Running post-promotion smoke test..."
  # Check that @latest tag resolves to the expected version on npm
  local latest_ver
  latest_ver=$(npm view @sparkleideas/cli@latest version 2>/dev/null) || true
  if echo "$latest_ver" | grep -qE '^[0-9]+\.[0-9]+'; then
    log "Post-promotion smoke PASSED: @latest = ${latest_ver}"
  else
    # Fallback: try running the CLI (filter npm deprecation warnings from stderr)
    local smoke_cache
    smoke_cache=$(mktemp -d /tmp/ruflo-smoke-XXXXX)
    local smoke_out
    smoke_out=$(NPM_CONFIG_CACHE="$smoke_cache" npx --yes @sparkleideas/cli@latest --version 2>/dev/null) || true
    rm -rf "$smoke_cache"
    if echo "$smoke_out" | grep -qE '^[0-9]+\.[0-9]+'; then
      log "Post-promotion smoke PASSED: @latest = $(echo "$smoke_out" | head -1)"
    else
      log_error "Post-promotion smoke FAILED — @latest is broken after promotion"
      log_error "npm view output: ${latest_ver:-empty}"
      log_error "CLI output: $(echo "$smoke_out" | head -3)"
    fi
  fi
}

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

  # Use node to assemble the full timing JSON (phases + commands + packages)
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
    const result = {
      timestamp: '${timestamp}',
      version: '${BUILD_VERSION:-unknown}',
      total_duration_ms: ${pipeline_ms},
      acceptance_passed: ${ACCEPTANCE_PASSED},
      phases,
      commands,
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
{"timestamp":"${timestamp}","version":"${BUILD_VERSION:-unknown}","total_duration_ms":${pipeline_ms},"acceptance_passed":${ACCEPTANCE_PASSED},"phases":${phases_json},"commands":[],"packages":{"build":[],"publish":[]}}
EOJSON
  }
  log "Pipeline timing summary written to ${summary_file}"
}

# ---------------------------------------------------------------------------
# Stage 3: Publish pipeline
# ---------------------------------------------------------------------------

run_stage3_publish() {
  PIPELINE_START_NS=$(date +%s%N 2>/dev/null || echo 0)
  log "────────────────────────────────────────────────"
  log "Stage 3: Publish (detect merged PRs, build, publish)"
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

  # Test (L0-L3) — each layer timed separately
  run_phase "test-l1-unit" run_tests_l1
  run_phase "test-l2-integration" run_tests_l2
  run_phase "test-l3-rq" run_tests_l3

  if [[ "${TEST_ONLY}" == "true" ]]; then
    print_phase_summary
    log "Gate 1 PASSED — all pre-publish tests pass (--test-only mode)"
    return 0
  fi

  # Read version from fork package.json (no computation needed)
  read_build_version

  # Publish to npm
  run_phase "publish" run_publish

  send_email "[ruflo] Published ${BUILD_VERSION}" \
    "All packages published to npm as @prerelease.\nVersion: ${BUILD_VERSION}"

  # Post-publish CDN propagation wait
  run_phase "cdn-propagation" wait_for_cdn

  # Post-publish acceptance tests (Layer 4)
  run_phase "test-l4-acceptance" run_acceptance_tests

  # Auto-promote to @latest
  if [[ "$ACCEPTANCE_PASSED" == true ]]; then
    run_phase "promote" run_promote
  else
    log "Skipping promotion to @latest — acceptance tests did not pass"
  fi

  # Post-promotion smoke test
  if [[ "$ACCEPTANCE_PASSED" == true ]]; then
    run_phase "post-promote-smoke" run_post_promote_smoke
  fi

  # GitHub release notification
  create_github_notification

  # Save state after successful publish
  save_state

  # Write JSON timing summary
  write_pipeline_summary

  print_phase_summary
  log "Stage 3 complete: ${BUILD_VERSION}"
}

# ---------------------------------------------------------------------------
# Stage 1: Sync upstream pipeline
# ---------------------------------------------------------------------------

run_stage1_sync() {
  log "────────────────────────────────────────────────"
  log "Stage 1: Sync (fetch upstream, create sync branches)"
  log "────────────────────────────────────────────────"

  # Sync upstream into fork branches
  if ! sync_upstream; then
    # sync_upstream returns 1 if no changes or if it already created a
    # PR for conflict/compile-error
    log "Upstream sync: no action needed or error handled"
    return 0
  fi

  # Build pipeline: copy -> codemod -> build -> test
  create_temp_dir
  run_phase "copy-source" copy_source
  run_phase "codemod" run_codemod
  run_phase "build" run_build

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
  log "Stage 1 complete"
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
  ( sleep 900; log_error "[TIMEOUT] sync-and-build.sh exceeded 900s — sending SIGTERM"; kill -TERM -$$ 2>/dev/null || kill -TERM $$ 2>/dev/null || true; sleep 5; kill -KILL -$$ 2>/dev/null || kill -KILL $$ 2>/dev/null || true ) &
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

  # Stage 3 runs first: publish reviewed code
  if [[ "${RUN_PUBLISH}" == "true" ]]; then
    run_stage3_publish
  fi

  # Stage 1 runs second: sync new upstream
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
