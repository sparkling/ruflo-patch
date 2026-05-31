#!/usr/bin/env bash
# scripts/napi-rebuild.sh — Detect Rust source changes + rebuild .node binaries.
#
# Why this exists (ADR-0133, generalised by ADR-0150):
#   The pipeline previously bumped versions + published when ruvector source
#   changed, but did NOT rebuild the napi-rs .node binaries. Result: the published
#   `@sparkleideas/ruvector` artifact shipped stale binaries even after Rust source
#   changes (e.g. the ADR-0095 d12 flock+refcount cherry-pick produced new .rs but
#   the .node was a month-old cached build, masking the fix).
#
# What it does:
#   1. Loads PREV_<FORK>_HEAD from .last-build-state (passed via positional args).
#   2. For each fork in lib/napi-config.sh's NAPI_PACKAGES, diffs HEAD against
#      its prev SHA for *.rs / Cargo.toml changes under the configured crate paths.
#   3. If changed, runs `npm run build` in every crate dir from the config.
#   4. Verifies .darwin-arm64.node mtimes updated since rebuild started.
#   5. Commits + pushes rebuilt binaries to each affected fork's main + sparkling.
#
# Called by: scripts/ruflo-publish.sh (run_phase "napi-rebuild")
# Usage:     bash scripts/napi-rebuild.sh [<PREV_RUVECTOR_HEAD>] [<PREV_AGENTIC_HEAD>]
#
# Backwards-compatible: if only positional $1 is given, treats it as PREV_RUVECTOR_HEAD
# (matches the original ADR-0133 contract). $2+ extends to other forks per ADR-0150.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Single source of truth for fork dirs (ADR-0039) + napi config (ADR-0150)
# shellcheck source=/dev/null
source "${ROOT_DIR}/lib/fork-paths.sh"
# shellcheck source=/dev/null
source "${ROOT_DIR}/lib/napi-config.sh"

# Positional args: prev SHAs per fork (in declaration order)
PREV_RUVECTOR_HEAD="${1:-}"
PREV_AGENTIC_HEAD="${2:-}"

# Marker file declared at script scope so EXIT-trap cleanup can find it
# under set -u (defined in main, dereferenced in trap = unbound otherwise).
MARKER=""

log() {
  printf '[%s] napi-rebuild: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}
log_error() {
  printf '[%s] napi-rebuild: ERROR: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >&2
}

# Map fork dir to its PREV_*_HEAD env var (so multi-fork generalisation can look up
# the right SHA without hard-coding ruvector everywhere).
prev_head_for_fork() {
  local fork_dir="$1"
  case "$fork_dir" in
    "$FORK_DIR_RUVECTOR") echo "$PREV_RUVECTOR_HEAD" ;;
    "$FORK_DIR_AGENTIC")  echo "$PREV_AGENTIC_HEAD" ;;
    *) echo "" ;;
  esac
}

# ---------------------------------------------------------------------------
# Detect Rust source changes for a SPECIFIC fork (was hardcoded to FORK_RUVECTOR
# pre-ADR-0150)
# ---------------------------------------------------------------------------

detect_rust_changes() {
  local fork_dir="$1"
  local prev="$2"
  local fork_name; fork_name=$(basename "$fork_dir")

  if [[ -z "$prev" ]]; then
    log "${fork_name}: no PREV head — first run, will rebuild"
    return 0
  fi

  if ! git -C "$fork_dir" cat-file -e "${prev}^{commit}" 2>/dev/null; then
    log "${fork_name}: PREV ${prev:0:12} unreachable — assume changed"
    return 0
  fi

  local current
  current=$(git -C "$fork_dir" rev-parse HEAD)

  if [[ "$prev" == "$current" ]]; then
    log "${fork_name}: no commits since last build (HEAD=${current:0:12})"
    return 1
  fi

  # Build the path-spec list from this fork's NAPI_PACKAGES entries
  local pathspecs=()
  for entry in "${NAPI_PACKAGES[@]}"; do
    napi_parse_entry "$entry" || continue
    if [[ "$NAPI_FORK_DIR" == "$fork_dir" ]]; then
      pathspecs+=("${NAPI_CRATE_PATH}/**/*.rs" "${NAPI_CRATE_PATH}/**/Cargo.toml" "${NAPI_CRATE_PATH}/Cargo.toml")
      # A napi crate statically links its in-workspace path-dependencies, so a
      # change in a SIBLING lib crate must also trigger a .node rebuild. The
      # rvf-node binding links the whole rvf workspace (rvf-runtime, rvf-index,
      # …); watching only crates/rvf/rvf-node/ would miss a fix in rvf-runtime
      # and publish a stale .node — the ADR-0095 t3-2 concurrent-write trap
      # (a WriterLock fix in rvf-runtime that never reaches the CLI). Watch the
      # whole crates/rvf tree for any rvf-workspace napi crate. Over-rebuilding
      # is safe; under-rebuilding ships stale binaries.
      if [[ "$NAPI_CRATE_PATH" == crates/rvf/* ]]; then
        pathspecs+=("crates/rvf/**/*.rs" "crates/rvf/**/Cargo.toml")
      fi
    fi
  done

  if [[ ${#pathspecs[@]} -eq 0 ]]; then
    log "${fork_name}: no NAPI_PACKAGES entries — skipping"
    return 1
  fi

  local diff_out
  diff_out=$(git -C "$fork_dir" diff --name-only "$prev" "$current" -- "${pathspecs[@]}" 2>/dev/null || true)

  if [[ -n "$diff_out" ]]; then
    log "${fork_name}: Rust source changed since ${prev:0:12} → ${current:0:12}:"
    printf '  %s\n' $diff_out | head -10
    [[ $(printf '%s\n' "$diff_out" | wc -l) -gt 10 ]] && log "  ... (truncated)"
    return 0
  fi

  log "${fork_name}: no .rs / Cargo.toml changes since ${prev:0:12} — skipping rebuild"
  return 1
}

# ---------------------------------------------------------------------------
# Find napi crates from config (replaces the old find-by-script-content logic
# which was scoped to ruvector/crates/)
# ---------------------------------------------------------------------------

find_napi_crates_for_fork() {
  local fork_dir="$1"
  for entry in "${NAPI_PACKAGES[@]}"; do
    napi_parse_entry "$entry" || continue
    if [[ "$NAPI_FORK_DIR" == "$fork_dir" ]]; then
      local crate_dir="${NAPI_FORK_DIR}/${NAPI_CRATE_PATH}"
      [[ -f "${crate_dir}/package.json" ]] || continue
      # Only include crates whose package.json has a `build` script that runs
      # `napi build`. Some workspace crates (e.g. ruvector-graph-node, sona)
      # ship pre-built .node files without a build script — silently skip per
      # original ADR-0133 behaviour.
      local build_script
      build_script=$(jq -r '.scripts.build // empty' "${crate_dir}/package.json" 2>/dev/null)
      if [[ "$build_script" == *"napi build"* ]]; then
        echo "$crate_dir"
      fi
    fi
  done
}

# ---------------------------------------------------------------------------
# Rebuild
# ---------------------------------------------------------------------------

rebuild_crate() {
  local crate_dir="$1"
  local name; name=$(basename "$crate_dir")

  log "rebuilding ${name}..."
  if (cd "$crate_dir" && npm run build >/dev/null 2>&1); then
    log "  ✓ ${name}"
    return 0
  else
    log_error "  ✗ ${name} build failed"
    # Re-run with output for diagnosis
    (cd "$crate_dir" && npm run build 2>&1 | tail -20) >&2
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Verify binaries updated since marker time (per fork)
# ---------------------------------------------------------------------------

verify_binaries_fresh() {
  local fork_dir="$1"
  local marker="$2"
  local fork_name; fork_name=$(basename "$fork_dir")
  local count=0

  # Only check crate dirs configured for this fork (avoids false-negatives
  # when other forks' crates also live under the same parent)
  for entry in "${NAPI_PACKAGES[@]}"; do
    napi_parse_entry "$entry" || continue
    [[ "$NAPI_FORK_DIR" == "$fork_dir" ]] || continue
    local crate_dir="${NAPI_FORK_DIR}/${NAPI_CRATE_PATH}"
    while IFS= read -r f; do
      if [[ "$f" -nt "$marker" ]]; then
        count=$((count + 1))
      fi
    done < <(find "$crate_dir" -maxdepth 2 -name '*.darwin-arm64.node' -type f 2>/dev/null)
  done

  if [[ $count -eq 0 ]]; then
    log_error "${fork_name}: 0 .darwin-arm64.node files updated — build silently produced nothing"
    return 1
  fi
  log "${fork_name}: ${count} .darwin-arm64.node binaries refreshed"
  return 0
}

# ---------------------------------------------------------------------------
# Commit + push (per memory feedback-trunk-only-fork-development: main only;
# memory feedback-fork-commit-attribution: no Co-Authored-By trailer)
# ---------------------------------------------------------------------------

commit_and_push_binaries_for_fork() {
  local fork_dir="$1"
  local fork_name; fork_name=$(basename "$fork_dir")

  cd "$fork_dir"

  # Verify on main + sparkling remote present
  local branch; branch=$(git branch --show-current)
  if [[ "$branch" != "main" ]]; then
    log_error "${fork_name}: on '$branch', expected 'main' — refusing to commit"
    return 1
  fi
  if ! git remote -v | grep -q '^sparkling'; then
    log_error "${fork_name}: no 'sparkling' remote configured"
    return 1
  fi

  # Stage .node binaries inside this fork's configured crate paths
  for entry in "${NAPI_PACKAGES[@]}"; do
    napi_parse_entry "$entry" || continue
    [[ "$NAPI_FORK_DIR" == "$fork_dir" ]] || continue
    git add -- "${NAPI_CRATE_PATH}"/*.darwin-arm64.node \
                "${NAPI_CRATE_PATH}"/*-node/*.darwin-arm64.node 2>/dev/null || true
  done

  if [[ -z "$(git diff --cached --name-only)" ]]; then
    log "${fork_name}: no binary changes to commit (rebuild produced byte-identical output)"
    return 0
  fi

  log "${fork_name}: staged binaries:"
  git diff --cached --name-only | sed 's/^/  /'

  git commit -m "build(napi): rebuild .node binaries from current Rust source

Triggered by scripts/napi-rebuild.sh — detected Rust source changes since
last successful build state. Rebuilds all napi crates' .node binaries so
the published artifact reflects current source.

Without this auto-rebuild step, fork .node binaries can lag behind
fork .rs source, masking real fixes (ADR-0133, generalised ADR-0150)."

  # Pull --rebase to handle any concurrent push from fork-version bump
  git pull --rebase sparkling main 2>&1 | tail -3 || true
  if ! git push sparkling main; then
    log_error "${fork_name}: push to sparkling failed"
    return 1
  fi
  log "${fork_name}: ✓ committed + pushed rebuilt binaries"
  return 0
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  log "=================================================="
  log "Phase: napi-rebuild (ADR-0133/0150 — multi-fork)"
  log "=================================================="

  # Verify npm available — fail loud
  if ! command -v npm >/dev/null 2>&1; then
    log_error "npm not in PATH — cannot rebuild napi binaries"
    return 1
  fi

  # Iterate unique forks; skip those without changes
  local any_built=0
  while IFS= read -r fork_dir; do
    local prev; prev=$(prev_head_for_fork "$fork_dir")
    if ! detect_rust_changes "$fork_dir" "$prev"; then
      continue
    fi

    # Snapshot mtime baseline before rebuild
    MARKER=$(mktemp /tmp/napi-rebuild-marker.XXXXXX)
    trap 'rm -f "${MARKER:-}"' EXIT

    local crates=()
    while IFS= read -r d; do
      crates+=("$d")
    done < <(find_napi_crates_for_fork "$fork_dir")

    if [[ ${#crates[@]} -eq 0 ]]; then
      log_error "${fork_dir}: 0 napi crates resolvable — refusing to continue (probable config bug)"
      return 1
    fi

    log "$(basename "$fork_dir"): ${#crates[@]} napi crates to rebuild"
    for c in "${crates[@]}"; do
      log "  - $(basename "$c")"
    done

    for c in "${crates[@]}"; do
      if ! rebuild_crate "$c"; then
        return 1
      fi
    done

    if ! verify_binaries_fresh "$fork_dir" "$MARKER"; then
      return 1
    fi

    if ! commit_and_push_binaries_for_fork "$fork_dir"; then
      return 1
    fi

    any_built=1
    rm -f "$MARKER"
    MARKER=""
  done < <(napi_unique_forks)

  if [[ $any_built -eq 0 ]]; then
    log "→ skipped all forks (no Rust source changes anywhere)"
  fi

  log "=================================================="
  log "napi-rebuild complete"
  log "=================================================="
}

main
