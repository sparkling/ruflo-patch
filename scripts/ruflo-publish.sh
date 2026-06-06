#!/usr/bin/env bash
# scripts/ruflo-publish.sh — Publish stage (ADR-0039)
#
# Self-contained publish stage: detect merges to fork main, bump versions,
# build, test (preflight + unit + acceptance), publish to local Verdaccio.
#
# Usage: bash scripts/ruflo-publish.sh [--force]
#
# Called by ruflo.service, `npm run release`, or `make release`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Aborted runs must tear down their own process group so backgrounded
# children (sleep/tee that inherit fd 9 via `exec 9>`) don't outlive the
# parent holding the flock. `kill -- -$$` only signals THIS process's own
# group — no cross-process risk. Mirrors scripts/test-acceptance.sh.
trap 'kill -- -$$ 2>/dev/null; exit 143' INT TERM

# Concurrency guard — prevent overlapping timer + manual deploy runs
LOCKFILE="/tmp/ruflo-pipeline.lock"

# Reap orphaned lock holders: if a previous run was aborted, its backgrounded
# sleep/tee children may still hold the flock (fd 9 inherited via `exec 9>`)
# even though the owning pipeline is dead. Reap them ONLY IF none of the
# holders has a LIVE ruflo-publish.sh ancestor — otherwise a legitimately
# concurrent (e.g. timer-triggered) release holds the lock and we must NOT
# touch it. Without lsof we cannot inspect holders, so we skip the reaper
# and behave exactly as before (hard-fail on contention).
_reap_orphan_lock_holders() {
  command -v lsof >/dev/null 2>&1 || return 1   # no lsof → don't guess
  local holders
  # Our own `exec 9>` keeps the lockfile open on fd 9 even though flock failed,
  # so $$ appears in lsof as a holder. Exclude it — otherwise the reap loop
  # below would `kill -TERM $$` and the pipeline would terminate itself in the
  # all-orphan path (the exact case this reaper exists to recover).
  holders=$(lsof -t "${LOCKFILE}" 2>/dev/null | grep -vx "$$" || true)
  [[ -n "$holders" ]] || return 1               # nobody else holds it
  local pid
  for pid in $holders; do
    if _pid_has_live_publish_ancestor "$pid"; then
      # A live pipeline owns this lock — do NOT reap.
      return 1
    fi
  done
  # All holders are orphans (no live ruflo-publish.sh ancestor) — reap them.
  for pid in $holders; do
    kill -TERM "$pid" 2>/dev/null
  done
  return 0
}

# Walk a PID's ancestry (macOS `ps` syntax) toward pid 1, returning success
# if any ancestor — including the pid itself — is a live ruflo-publish.sh.
# NOTE: the pipeline runs as `bash .../ruflo-publish.sh`, so `ps -o comm=`
# reports the *executable* (`bash`), NOT the script. We must inspect the full
# command line (`ps -o command=`) to see the script path. Matching on comm=
# alone would never fire → a live pipeline's children would look orphaned and
# get reaped, killing a legitimately-concurrent release. So match command=.
# A bounded walk (max 64 hops) guards against any cycle/weird ppid.
_pid_has_live_publish_ancestor() {
  local pid="$1" hops=0 cmd ppid
  while [[ -n "$pid" && "$pid" != "0" && "$pid" != "1" ]] && (( hops < 64 )); do
    # Skip our own pid — we are the live pipeline asking the question;
    # counting ourselves would make every reap a no-op. (Continue the walk
    # upward so a parent ruflo-publish.sh, if any, is still detected.)
    if [[ "$pid" == "$$" ]]; then
      pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
      hops=$((hops + 1))
      continue
    fi
    cmd=$(ps -o command= -p "$pid" 2>/dev/null)
    case "$cmd" in
      *ruflo-publish.sh|*ruflo-publish.sh\ *) return 0 ;;
    esac
    ppid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
    [[ -n "$ppid" && "$ppid" != "$pid" ]] || return 1
    pid="$ppid"
    hops=$((hops + 1))
  done
  return 1
}

exec 9>"${LOCKFILE}"
if ! flock -n 9; then
  # Contended. Try to reap orphaned holders, then retry once.
  if _reap_orphan_lock_holders && flock -n 9; then
    echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] publish: reaped orphaned lock holders on ${LOCKFILE} — acquired" >&2
  else
    echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] publish: another pipeline run holds ${LOCKFILE} — exiting" >&2
    exit 0
  fi
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
# run_adr0180_gates — ADR-0180 Phase 0 prerequisite gates (per ADR-0180
# §Pre-Phase-2 prerequisite, Pass 3 Finding G expansion):
#
#   1. Halt/Amendment trailer scan — blocks if an `ADR-0180-Halt:` commit
#      sits between the last release tag and HEAD without a paired
#      `ADR-0180-Amendment: phase-N` resolution commit in the same range.
#
#   2. Charter conformance hook — invokes scripts/check-archivist-charter.sh
#      if the archivist module exists (forks/agentdb/src/archivist/MODULE.md).
#      Pre-Phase-2 (archivist not yet scaffolded) the check is a no-op.
#
#   3. Pre-Phase-4 maintenance-commit gate — once Phase 4 work has begun
#      (sentinel: forks/agentdb/src/archivist/handlers/hive-mind/ exists),
#      requires the two `fix(hive-mind): wrap … (pre-Phase 4)` commits to
#      be present on forks/ruflo/v3 main per ADR-0180 §Migration concerns
#      Phase 4 paragraph. Pre-Phase-4 the check is a no-op.
# ---------------------------------------------------------------------------

run_adr0180_gates() {
  local _gate_start; _gate_start=$(_ns)
  log "Running ADR-0180 Phase 0 gates"

  # Gate 1: Halt/Amendment trailer scan
  # Search commits between last fork tag and HEAD on ruflo-patch for unresolved Halt trailers.
  # A "trailer" is a line that starts with "ADR-0180-Halt:" — distinct from prose mentions
  # of the convention in commit body text. We post-process git log output to enforce
  # line-start anchoring (which --grep alone doesn't provide).
  local last_tag
  last_tag=$(git -C "${PROJECT_DIR:-.}" describe --tags --abbrev=0 2>/dev/null || echo "")
  local halt_range="HEAD"
  [[ -n "$last_tag" ]] && halt_range="${last_tag}..HEAD"
  local halt_candidates
  halt_candidates=$(git -C "${PROJECT_DIR:-.}" log "$halt_range" --grep='ADR-0180-Halt:' --format='%H' 2>/dev/null || echo "")
  if [[ -n "$halt_candidates" ]]; then
    local unresolved=0
    while IFS= read -r halt_sha; do
      [[ -z "$halt_sha" ]] && continue
      # Verify the trailer appears at line-start in the commit body (not just substring)
      if ! git -C "${PROJECT_DIR:-.}" log -1 "$halt_sha" --format='%B' | grep -qE '^ADR-0180-Halt:'; then
        continue  # prose mention only, not a real trailer
      fi
      # Real trailer — look for paired Amendment commit in the range halt..HEAD
      local amendment_found
      amendment_found=$(git -C "${PROJECT_DIR:-.}" log "${halt_sha}..HEAD" --grep='^ADR-0180-Amendment:' --extended-regexp --format='%H' 2>/dev/null | head -1 || echo "")
      if [[ -z "$amendment_found" ]]; then
        local halt_subj
        halt_subj=$(git -C "${PROJECT_DIR:-.}" log -1 "$halt_sha" --format='%s')
        log_error "Unresolved ADR-0180-Halt: ${halt_sha} ${halt_subj}"
        unresolved=$((unresolved + 1))
      fi
    done <<< "$halt_candidates"
    if [[ "$unresolved" -gt 0 ]]; then
      log_error "ADR-0180 gate 1 FAILED: ${unresolved} unresolved Halt trailer(s). Release blocked until matching ADR-0180-Amendment commit(s) land."
      return 1
    fi
  fi

  # Gate 2: Charter conformance — only if archivist module exists
  # ADR-0245 §F-02-006: use FORK_DIR_AGENTDB (env-overridable) rather than
  # the previous hard-coded /Users/henrik/source/... literal.
  local archivist_dir="${FORK_DIR_AGENTDB}/src/archivist"
  if [[ -f "${archivist_dir}/MODULE.md" ]]; then
    if [[ -x "${SCRIPT_DIR}/check-archivist-charter.sh" ]]; then
      if ! "${SCRIPT_DIR}/check-archivist-charter.sh"; then
        log_error "ADR-0180 gate 2 FAILED: charter conformance check exited non-zero. Each source file under forks/agentdb/src/archivist/** must carry a '// charter: <responsibility>' header tag matching a responsibility in MODULE.md."
        return 1
      fi
    else
      log_error "ADR-0180 gate 2 FAILED: forks/agentdb/src/archivist/MODULE.md exists but scripts/check-archivist-charter.sh missing or non-executable."
      return 1
    fi
  fi

  # Gate 3: Pre-Phase-4 maintenance-commit gate — only if Phase 4 surface in flight
  if [[ -d "${archivist_dir}/handlers/hive-mind" ]]; then
    # ADR-0245 §F-02-006: use FORK_DIR_RUFLO (env-overridable) rather than
    # the previous hard-coded /Users/henrik/source/... literal.
    local ruflo_v3_dir="${FORK_DIR_RUFLO}/v3"
    local maint_agents_json
    maint_agents_json=$(git -C "${ruflo_v3_dir}" log main --grep='fix(hive-mind): wrap agents.json writes in withHiveStoreLock (pre-Phase 4)' --format='%H' 2>/dev/null | head -1 || echo "")
    local maint_consensus
    maint_consensus=$(git -C "${ruflo_v3_dir}" log main --grep='fix(hive-mind): wrap consensus propose/vote in withHiveStoreLock (pre-Phase 4)' --format='%H' 2>/dev/null | head -1 || echo "")
    if [[ -z "$maint_agents_json" ]] || [[ -z "$maint_consensus" ]]; then
      log_error "ADR-0180 gate 3 FAILED: Phase 4 archivist surface is active but pre-Phase-4 maintenance commits are absent from forks/ruflo/v3 main. Required: agents.json wrap + consensus propose/vote wrap commits with the canonical subjects per ADR-0180 §Migration concerns Phase 4."
      return 1
    fi
  fi

  # Gate 4: ADR-0112 retirement drift guard (per ADR-0180 Phase 10)
  # Once Phase 10 retires the ADR-0112 patterns, they must not reappear.
  # ADR-0245 §F-02-006: use FORK_DIR_AGENTDB (env-overridable) rather than
  # the previous hard-coded /Users/henrik/source/... literal.
  local adr0112_drift
  adr0112_drift=$(grep -rlE 'RvfNotInitializedError|MemoryNotInitializedError|requireAgentDB\(|ADR-0112 Phase 2' \
    "${FORK_DIR_AGENTDB}/src/" 2>/dev/null \
    | grep -vE 'ADR-0112-AUDIT\.md|MODULE\.md|archivist/index\.ts' || echo "")
  if [[ -n "$adr0112_drift" ]]; then
    log_error "ADR-0180 gate 4 FAILED: retired ADR-0112 pattern reappeared in: $adr0112_drift"
    return 1
  fi

  local _gate_ms; _gate_ms=$(_elapsed_ms "$_gate_start" "$(_ns)")
  log "  Phase 'adr0180-gates' completed in ${_gate_ms}ms (all 4 gates passed)"
  PHASE_TIMINGS="${PHASE_TIMINGS} adr0180-gates:${_gate_ms}"
}

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

  # Pass 2: process results (FF first, then SHA compare on HEAD)
  for i in "${!FORK_NAMES[@]}"; do
    local name="${FORK_NAMES[$i]}"
    local dir="${FORK_DIRS[$i]}"

    if [[ ! -d "${dir}/.git" ]]; then
      log_error "Fork directory ${dir} is not a git repo"
      continue
    fi

    # FF local main to origin/main FIRST (so HEAD includes any new upstream
    # commits before we read it). Per `reference-fork-workflow.md` and
    # `feedback-no-upstream-donate-backs.md`, our fork commits live on
    # sparkling/main only — origin = ruvnet is read-only. NEVER reset
    # destructively if FF fails: a failing FF means local is ahead of
    # origin (our normal state with unpublished fork commits). A
    # `reset --hard origin/main` here would silently nuke our work;
    # the bug bit us 2026-04-30 wiping 12 trunk-pivot commits across
    # 4 forks. Just continue.
    local _ff_start; _ff_start=$(_ns)
    git -C "${dir}" checkout main --quiet 2>/dev/null || true
    if ! git -C "${dir}" merge --ff-only origin/main --quiet 2>/dev/null; then
      log "  ${name}: local main not FF of origin/main (likely ahead — local commits unpublished). Continuing without reset."
    fi
    local _ff_ms; _ff_ms=$(_elapsed_ms "$_ff_start" "$(_ns)")
    log "  fast-forward ${name}: ${_ff_ms}ms"
    add_cmd_timing "merge-detect" "git ff-merge ${name}" "$_ff_ms"

    # Detection compares HEAD (post-FF — includes both upstream merges AND
    # our own fork-side commits to sparkling/main) against the last-verified
    # state_sha. Earlier versions compared origin/main (ruvnet, read-only),
    # which silently missed all our fork-side work — bug observed 2026-05-04
    # when ruvector commit 38191e27e (WriterLock bounded-wait flock) sat
    # unpublished because origin/main hadn't moved.
    local head_sha state_sha
    head_sha=$(git -C "${dir}" rev-parse HEAD 2>/dev/null) || continue
    state_sha=$(get_prev_head "$name")

    if [[ -z "$state_sha" ]]; then
      log "No previous state for ${name} — treating as new (head=${head_sha:0:12})"
      any_changed=true
      if [[ -n "$CHANGED_FORK_SHAS" ]]; then
        CHANGED_FORK_SHAS="${CHANGED_FORK_SHAS},${dir}:"
      else
        CHANGED_FORK_SHAS="${dir}:"
      fi
    elif [[ "$head_sha" == "$state_sha" ]]; then
      log "No new commits for ${name} (head=${head_sha:0:12})"
    else
      log "New commits for ${name}: state=${state_sha:0:12} -> head=${head_sha:0:12}"
      any_changed=true
      if [[ -n "$CHANGED_FORK_SHAS" ]]; then
        CHANGED_FORK_SHAS="${CHANGED_FORK_SHAS},${dir}:${state_sha}"
      else
        CHANGED_FORK_SHAS="${dir}:${state_sha}"
      fi
    fi

    set_fork_head "$name" "$head_sha"
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

  # ADR-0142 G1 wrapper-pin auto-bump runs INSIDE bumpAll() (CLI mode passes
  # wrapperRoot=SCRIPT_PROJECT_ROOT). No bash-side wrapper-pin code needed
  # here — fork-version.mjs handles it. Output appears in bump_output above.

  CHANGED_PACKAGES_JSON=$(echo "$bump_output" | grep '^BUMPED_PACKAGES:' | sed 's/^BUMPED_PACKAGES://') || true
  [[ -z "${CHANGED_PACKAGES_JSON}" ]] && CHANGED_PACKAGES_JSON="all"
  DIRECTLY_CHANGED_JSON=$(echo "$bump_output" | grep '^DIRECTLY_CHANGED:' | sed 's/^DIRECTLY_CHANGED://') || true
  [[ -z "${DIRECTLY_CHANGED_JSON}" ]] && DIRECTLY_CHANGED_JSON="${CHANGED_PACKAGES_JSON}"
  log "Build set (source changed): ${DIRECTLY_CHANGED_JSON}"
  log "Publish set (+ dependents): ${CHANGED_PACKAGES_JSON}"

  # ADR-0193 Item F follow-up: write the bumped-packages list to a sibling
  # state file so `_cache_bust_bumped_packages` in test-acceptance.sh can
  # bust the exact set rather than a hardcoded 5-package list. The
  # bump_output BUMPED_PACKAGES: line is already deduplicated and
  # toNpmName-translated to @sparkleideas/* names — exactly what
  # `npm cache clean` wants.
  #
  # Lifecycle: written AFTER bump succeeds and BEFORE acceptance runs,
  # so the same release that bumps the set is the one whose acceptance
  # reads it. `.last-build-state` is the wrong file (it's
  # atomically-overwritten end-of-pipeline AFTER acceptance, and its
  # schema is fork-SHAs not package-names).
  #
  # Skip cases: "all" (full bump — no explicit list available; the
  # downstream fallback handles this and logs loudly) and "[]" (no
  # packages changed — early-return below). For an explicit JSON array
  # we emit one package per line for trivial shell parsing.
  local _bumped_state="${SCRIPT_DIR}/.last-bumped-packages"
  if [[ "${CHANGED_PACKAGES_JSON}" != "all" && "${CHANGED_PACKAGES_JSON}" != "[]" ]]; then
    if ! echo "${CHANGED_PACKAGES_JSON}" \
         | node -e "const a=JSON.parse(require('fs').readFileSync(0,'utf8'));if(!Array.isArray(a))process.exit(2);for(const n of a)console.log(n)" \
         > "${_bumped_state}.tmp" 2>/dev/null; then
      log_error "Failed to parse BUMPED_PACKAGES JSON for ${_bumped_state} — leaving prior file in place"
      rm -f "${_bumped_state}.tmp"
    else
      mv "${_bumped_state}.tmp" "${_bumped_state}"
      log "Wrote bumped-packages list ($(wc -l < "${_bumped_state}" | tr -d ' ') pkgs) -> ${_bumped_state}"
    fi
  fi

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
        # Non-fast-forward: sparkling has commits this local lacks (e.g.
        # napi-rebuild.sh pushes rebuilt native binaries to sparkling on a
        # separate cadence — the recurring ruvector divergence). Reconcile
        # (fetch + merge — NO squash/rebase, per the fork-history rule) and
        # retry the push ONCE. Version-bump vs binary commits don't overlap, so
        # the merge is clean in practice; a genuine conflict is NOT
        # auto-resolved — the retry fails and we warn loudly.
        git -C "${dir}" fetch sparkling main --quiet 2>/dev/null
        if git -C "${dir}" merge --no-edit FETCH_HEAD >/dev/null 2>&1 && \
           git -C "${dir}" push sparkling main --quiet 2>/dev/null; then
          echo "INFO: reconciled diverged sparkling and pushed version bump for ${name}" >&2
        else
          git -C "${dir}" merge --abort >/dev/null 2>&1 || true
          echo "WARNING: Failed to push version bump for ${name} (sparkling diverged; manual reconcile needed)" >&2
        fi
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

  # ADR-0236 gate-0: cross-registry scope/package-name lint. Runs BEFORE
  # all other phases (Phase 0 ADR-0180 gates, load_state, merge-detect,
  # napi-coverage, bump-versions, codemod, build, publish, acceptance).
  # Catches drift between fork-version.mjs::SCOPES + UNSCOPED_PUBLISHABLE,
  # codemod.mjs::UNSCOPED_MAP, build-packages.sh::_v3_packages (bash +
  # inline JS), and config/publish-levels.json. Fails loud with both
  # registries cited so the operator can fix from the message alone.
  # See ADR-0236 §Decision (option A) + swarm-review R2.
  if ! node "${SCRIPT_DIR}/lint-scope-registries.mjs"; then
    log_error "lint-scope-registries: FAIL — release blocked (ADR-0236 gate-0)"
    return 1
  fi

  # ADR-0265 §C7.c — reverse-import guard. Asserts the new N-API binding
  # crate at forks/agentic-flow/crates/agentic-flow-quic-node/ does not
  # import agentdb (preserves §I9 SyncCoordinator untouched, §I10 no
  # @fails-components/webtransport dep). NO-OPs cleanly when the crate
  # has not yet been authored (Phase 1 not yet shipped); flips to fail-loud
  # once the crate appears.
  if ! node "${SCRIPT_DIR}/lint-no-agentdb-in-quic-crate.mjs"; then
    log_error "lint-no-agentdb-in-quic-crate: FAIL — release blocked (ADR-0265 §C7.c)"
    return 1
  fi

  # Load previous state
  load_state

  # ADR-0180 Phase 0 gates (Halt trailer scan + charter conformance + pre-Phase-4 maintenance)
  if ! run_adr0180_gates; then
    log_error "ADR-0180 Phase 0 gates failed — release blocked"
    return 1
  fi

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

  # ADR-0189: fail-loud NAPI coverage gate. Catches the case where a new
  # NAPI-consumer crate appears upstream but isn't in NAPI_PACKAGES (Path 1
  # build-from-source) or republish-eligible (Path 2: package.json +
  # pre-built .node in npm/<platform>/) — would otherwise silently drop at
  # publish time (ADR-0082-style hazard). Runs after merge-detect (no point
  # checking if we're skipping) and before napi-rebuild + bump-versions
  # (so a coverage gap doesn't pollute fork main with version bumps for
  # crates that won't ship).
  run_phase "napi-coverage" node "${SCRIPT_DIR}/check-napi-coverage.mjs"

  # ADR-0186 follow-up #1: fail-loud fetch-timeout gate. Same shape as the
  # NAPI coverage check above — silent-drop class is "fetch() without
  # AbortSignal.timeout hangs the pipeline if the remote stalls". As of
  # commit 995012ec8 on forks/ruflo, all 39 fetch() calls in cli +
  # agentic-flow src carry a signal option. Allowlist at
  # lib/fetch-timeout-allowlist.txt.
  run_phase "fetch-timeout" node "${SCRIPT_DIR}/check-fetch-timeouts.mjs"

  # feedback-no-fallbacks + ADR-0082: fail-loud silent-catch gate. Flags
  # `catch { }` blocks with truly empty bodies (no comment rationale, no
  # log, no re-throw). Documented form `catch { /* explanation */ }` is
  # the canonical surfacing per project convention and is NOT flagged.
  # As of commit 47437a50f on forks/ruflo, all 1296 catch blocks in scope
  # surface their error. Allowlist at lib/silent-catches-allowlist.txt.
  run_phase "silent-catches" node "${SCRIPT_DIR}/check-silent-catches.mjs"

  # ADR-0191 Phase D (gate-flip): stricter sibling to silent-catches.
  # Flags `catch { /* comment */ }` patterns that document intent but
  # take no runtime action (no rethrow, no log, no conditional
  # discrimination). This is the failure mode that hid an ESM-vs-CJS
  # error in the 2026-05-19 TrainingPipeline regression. Cluster A-E
  # closed the 29 HIGH-risk catches (8 deletions + 10 catch+log +
  # 2 typed-contracts + 4 helper conversions + 5 inline ENOENT-only),
  # bringing the HIGH count to 0. The remaining ~340 LOW/MEDIUM catches
  # stay visible in the detector output but are allowlisted via
  # lib/undiscriminating-catches-allowlist.txt so the gate fires only on
  # NEW HIGH-class regressions of this shape.
  run_phase "undiscriminating-catches" node "${SCRIPT_DIR}/check-undiscriminating-catches.mjs"

  # ADR-0242 §Decision scope #3 (advisory-first cultural lint): counts
  # `throw new Error("...")` (naked throw, no code, no cause) across
  # forks/ruflo/v3. Existing ~881 sites grandfathered in
  # lib/throw-new-error-allowlist.txt. New code should prefer
  # `throw new RufloError(msg, RufloErrorCode.X, ctx, cause)` from
  # @claude-flow/errors. Exits 0 advisory-first per ADR-0242 — promotion
  # to exit 1 deferred to cycle N+3 erosion-vs-rot check.
  run_phase "throw-new-error-advisory" node "${SCRIPT_DIR}/check-throw-new-error.mjs"

  # ADR-0242 §Decision scope #4 (advisory-first MCP envelope honesty):
  # flags MCP tool handlers that catch fatal errors and return
  # `{success: false, ...}` instead of throwing. The mcp-server.ts
  # wrap converts thrown errors to JSON-RPC -32603 frames; a returned
  # envelope is flattened into content[0].text and demotes a fatal
  # data-integrity error to a successful call. Existing ~20 unique
  # sites (out of ~61 total occurrences) grandfathered in
  # lib/mcp-handler-fatal-throw-allowlist.txt. Exits 0 advisory-first.
  run_phase "mcp-handler-fatal-throw-advisory" node "${SCRIPT_DIR}/check-mcp-handler-fatal-throw.mjs"

  # ADR-0190 §Decision Outcome Option 1: cross-repo TS package build-state
  # detector. Walks forks/*/npm/packages/*/package.json, asserts every
  # declared main/module/types/exports entry exists as a file in the source
  # tree. A missing entry = silent-drop hazard (tarball ships without dist/;
  # consumers hit MODULE_NOT_FOUND at runtime). Pre-existing baseline of
  # ~30 violations in ruvector/npm/packages/ that imported broken main
  # declarations from upstream — advisory mode prints the count + first 10
  # so operators see the inventory without blocking releases. Promote to
  # fail-loud (drop CROSS_REPO_BUILDS_ADVISORY=1) when the baseline is
  # cleaned.
  run_phase "cross-repo-builds-advisory" \
    env CROSS_REPO_BUILDS_ADVISORY=1 \
    node "${SCRIPT_DIR}/check-cross-repo-builds.mjs"

  # ADR-0133/0150: Detect Rust source changes across all napi-shipping forks
  # (ruvector + agentic-flow per lib/napi-config.sh) and rebuild .node binaries
  # before bump-versions, so the rebuilt binaries land on fork main and ship
  # via the normal copy-source path. Without this, .rs changes can publish but
  # the .node files stay stale.
  run_phase "napi-rebuild" bash "${SCRIPT_DIR}/napi-rebuild.sh" \
    "${PREV_RUVECTOR_HEAD:-}" \
    "${PREV_AGENTIC_HEAD:-}"

  # ADR-0232: pure-WASM crate rebuild (parallel to napi-rebuild). Detects
  # Rust source changes for entries in lib/wasm-config.sh::WASM_PACKAGES
  # and runs `wasm-pack build --target nodejs --out-dir <canonical>` so the
  # canonical npm/packages/<name>/ artefact reflects current source.
  # Closes the ADR-0231 wave A9 class of bug at the source (stale
  # wasm-pack output anywhere on disk can't compete for the publishable-
  # name slot when the canonical artefact is pipeline-built every cycle).
  # Per ADR-0232 §"Bad" trade-off: requires `wasm-pack` in PATH; fails loud
  # if missing (no silent fallback per feedback-no-fallbacks). Starts with
  # ruvllm-wasm; other WASM crates added to WASM_PACKAGES as confirmed.
  run_phase "wasm-rebuild" bash "${SCRIPT_DIR}/wasm-rebuild.sh" \
    "${PREV_RUVECTOR_HEAD:-}" \
    "${PREV_AGENTIC_HEAD:-}"

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

  # Build pipeline: copy -> codemod -> build -> test
  create_temp_dir
  run_phase "copy-source" copy_source
  run_phase "codemod" run_codemod
  # Build BEFORE test-ci (NOT in parallel). Many unit tests load the built
  # /tmp/ruflo-build dist (e.g. bug4-storage-init-concurrent loads the native
  # rvf-backend.js; ~15 tests resolve dist artifacts). Running test-ci in
  # parallel with build raced those tests against a stale/mid-build tree, and
  # blocked shipping any fix whose own regression test needs the NEW build
  # (chicken-and-egg: test-ci validated last release's dist, so a fix could
  # never go green). Sequencing build first makes test-ci validate THIS
  # release's complete, consistent artifact. Surfaced by the ADR-0167
  # loadFromDisk RVFR-prefix fix (see ADR-0167 amendment 2026-05-21).
  run_phase "build" run_build
  write_build_manifest
  run_phase "test-ci" run_tests_ci

  # ADR-0295: strip dangling @sparkleideas/* optional deps (unpublished napi
  # platform binaries + pure sub-packages) before publish, so the published
  # manifests never reference a package that 404s. Prevents the npm/arborist
  # empty-version dedup crash that bricks `npx @sparkleideas/ruflo` installs.
  # Fails loud on an unresolvable HARD dep (a real publish gap, not a dangling
  # optional). Runs on the final build tree, immediately before publish.
  run_phase "sanitize-optional-deps" run_sanitize_optional_deps

  # Publish to local Verdaccio + run acceptance tests
  run_phase "publish-verdaccio" run_publish_verdaccio
  run_phase "acceptance" run_acceptance

  # Post-acceptance: skip-rot invariant. Reads the just-generated
  # test-results/accept-*/acceptance-results.json and verifies every
  # skip_accepted entry carries a recognized marker (HEAVY_SKIP, tool
  # not in published build, ...) or is in lib/skip-accepted-allowlist.txt.
  # A skip without rationale is silent-drop class — see ADR-0082.
  run_phase "skip-accepted-audit" node "${SCRIPT_DIR}/check-skip-accepted.mjs"

  # Record successful verification so sync stage can skip redundant acceptance
  local _verify_manifest="/tmp/ruflo-build/.last-verified.json"
  local _verify_codemod_hash
  _verify_codemod_hash=$(sha256sum "${SCRIPT_DIR}/codemod.mjs" 2>/dev/null | cut -d' ' -f1) || _verify_codemod_hash=""
  cat > "$_verify_manifest" <<VMANIFEST
{"ruflo_head":"${NEW_RUFLO_HEAD:-}","agentic_head":"${NEW_AGENTIC_HEAD:-}","fann_head":"${NEW_FANN_HEAD:-}","ruvector_head":"${NEW_RUVECTOR_HEAD:-}","agentdb_head":"${NEW_AGENTDB_HEAD:-}","codemod_hash":"${_verify_codemod_hash}","verified_at":"$(date -u '+%Y-%m-%dT%H:%M:%SZ')"}
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

  # ADR-0182 L8: opportunistic Verdaccio storage GC.
  # Runs ONLY after a successful publish (we're past run_publish_verdaccio +
  # acceptance + save_state + push_fork_version_bumps at this point). GC
  # failure does NOT fail the release — log a warning and defer cleanup.
  if command -v node >/dev/null 2>&1; then
    local _gc_log="${PROJECT_DIR}/logs/verdaccio-gc-$(date +%Y%m%d-%H%M%S).log"
    mkdir -p "${PROJECT_DIR}/logs"
    if node "${SCRIPT_DIR}/verdaccio-gc.mjs" >>"${_gc_log}" 2>&1; then
      log "L8 verdaccio-gc complete (log: ${_gc_log})"
    else
      log "[L8][warn] verdaccio-gc.mjs failed — release still successful, GC deferred (log: ${_gc_log})"
    fi
  fi
}

# ---------------------------------------------------------------------------
# Auto-retry wrapper — feedback-pipeline-shared-skip-on-dist-clear
#
# The selective-build skip path can leave @sparkleideas/shared's dist empty
# while tsbuildinfo says "up to date" — downstream consumers then crash with
# ERR_MODULE_NOT_FOUND at runtime during the test-ci phase. Recovery is a
# rerun with --force (full rebuild bypassing selective-skip).
#
# One-shot retry semantics:
#   - Catch main's exit code (run in subshell so `exit 1` in run_phase
#     doesn't kill us)
#   - On failure, grep captured stderr for the canonical signature
#   - If matched AND --force was NOT already set AND we haven't retried:
#       reset mutable state, set FORCE_BUILD=true, run main again
#   - Otherwise (different failure, or already on --force, or already
#     retried once): exit with the original failure code. No infinite loop.
#
# Manual test recipe (documented for future reference):
#   1. Build the pipeline once cleanly so tsbuildinfo exists:
#        npm run release
#   2. Wipe forks/ruflo/v3/packages/shared/dist/ (but NOT its tsbuildinfo):
#        rm -rf forks/ruflo/v3/packages/shared/dist/
#   3. Trigger a publish that bumps shared's dependents (touch a CLI src file):
#        echo "// touch" >> forks/ruflo/v3/packages/cli/src/index.ts
#        git -C forks/ruflo/v3 add -A && git -C forks/ruflo/v3 commit -m "test"
#   4. Run: npm run release
#      Expect: test-ci fails with ERR_MODULE_NOT_FOUND .../@sparkleideas/shared/dist/...
#              Then [AUTO-RETRY] line, then full rebuild + green.
# ---------------------------------------------------------------------------

RETRY_STDERR_LOG="/tmp/ruflo-publish-stderr.$$.log"
: > "${RETRY_STDERR_LOG}"
trap 'rm -f "${RETRY_STDERR_LOG}"' EXIT

# Signature regex — match the failure mode where the v3 build leaves a
# @sparkleideas/* package's dist empty and a downstream import crashes.
# Tightened to require both the ERR_MODULE_NOT_FOUND token AND the
# canonical @sparkleideas/.../dist/ path so unrelated module-resolution
# errors (e.g. user code) don't trigger spurious retries.
RETRY_SIGNATURE_RE='ERR_MODULE_NOT_FOUND.*@sparkleideas/[^/]+/dist/'

max_attempts=2
attempt=1
final_rc=0

while [[ $attempt -le $max_attempts ]]; do
  # Run main in a subshell so run_phase's `exit 1` propagates as a non-zero
  # subshell exit code rather than killing the outer attempt loop.
  set +e
  ( main "$@" ) 2> >(tee -a "${RETRY_STDERR_LOG}" >&2)
  final_rc=$?
  # Wait for the tee process-substitution to flush before grepping.
  wait 2>/dev/null || true
  set -e

  if [[ $final_rc -eq 0 ]]; then
    break
  fi

  # Failed. Decide whether to retry.
  if [[ $attempt -ge $max_attempts ]]; then
    log_error "Auto-retry already exhausted (attempt ${attempt}/${max_attempts}) — failing through"
    break
  fi
  if [[ "${FORCE_BUILD}" == "true" ]]; then
    # Already running with --force; a second --force won't help.
    break
  fi
  if ! grep -qE "${RETRY_SIGNATURE_RE}" "${RETRY_STDERR_LOG}"; then
    # Different failure mode — don't auto-retry.
    break
  fi

  log "[AUTO-RETRY] feedback-pipeline-shared-skip-on-dist-clear hit (ERR_MODULE_NOT_FOUND on @sparkleideas/*/dist/); rerunning with --force"

  # Reset mutable state for clean second attempt.
  FORCE_BUILD=true
  # shellcheck disable=SC1091
  source "${PROJECT_DIR}/lib/pipeline-state.sh"
  PHASE_TIMINGS=""
  : > "$TIMING_CMDS_FILE"
  : > "$TIMING_BUILD_PKGS_FILE"
  : > "${RETRY_STDERR_LOG}"

  attempt=$((attempt + 1))
done

exit $final_rc
