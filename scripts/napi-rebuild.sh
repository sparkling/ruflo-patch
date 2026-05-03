#!/usr/bin/env bash
# scripts/napi-rebuild.sh — Detect ruvector Rust source changes and rebuild .node binaries.
#
# Why this exists (ADR-0133):
#   The pipeline previously bumped versions + published when ruvector source
#   changed, but did NOT rebuild the napi-rs .node binaries. Result: the published
#   `@sparkleideas/ruvector` artifact shipped stale binaries even after Rust source
#   changes (e.g. the ADR-0095 d12 flock+refcount cherry-pick produced new .rs but
#   the .node was a month-old cached build, masking the fix).
#
# What it does:
#   1. Loads PREV_RUVECTOR_HEAD from .last-build-state (passed via $1)
#   2. Diffs current ruvector HEAD against it for *.rs / Cargo.toml changes under crates/
#   3. If changed, runs `npm run build` in every crate/package.json with `napi build`
#      script (currently 8 crates: rvf-node + 7 ruvector-*-node)
#   4. Verifies .darwin-arm64.node mtimes updated
#   5. Commits the rebuilt binaries to forks/ruvector main + pushes to sparkling
#
# Called by: scripts/ruflo-publish.sh (run_phase "napi-rebuild")
# Usage:     bash scripts/napi-rebuild.sh <PREV_RUVECTOR_HEAD>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Single source of truth for fork dirs (ADR-0039)
# shellcheck source=/dev/null
source "${ROOT_DIR}/lib/fork-paths.sh"

FORK_RUVECTOR="${FORK_DIR_RUVECTOR:?FORK_DIR_RUVECTOR not exported by lib/fork-paths.sh}"
PREV_HEAD="${1:-}"

# Marker file declared at script scope so EXIT-trap cleanup can find it
# under set -u (defined in main, dereferenced in trap = unbound otherwise).
MARKER=""

log() {
  printf '[%s] napi-rebuild: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}
log_error() {
  printf '[%s] napi-rebuild: ERROR: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >&2
}

# ---------------------------------------------------------------------------
# Detect Rust source changes
# ---------------------------------------------------------------------------

detect_rust_changes() {
  local prev="$1"

  if [[ -z "$prev" ]]; then
    log "no PREV_RUVECTOR_HEAD — first run, will rebuild"
    return 0
  fi

  if ! git -C "$FORK_RUVECTOR" cat-file -e "${prev}^{commit}" 2>/dev/null; then
    log "PREV_RUVECTOR_HEAD ${prev:0:12} unreachable — assume changed"
    return 0
  fi

  local current
  current=$(git -C "$FORK_RUVECTOR" rev-parse HEAD)

  if [[ "$prev" == "$current" ]]; then
    log "no commits since last build (HEAD=${current:0:12})"
    return 1
  fi

  # Anything matching .rs or Cargo.toml under crates/?
  local diff_out
  diff_out=$(git -C "$FORK_RUVECTOR" diff --name-only "$prev" "$current" -- 'crates/**/*.rs' 'crates/**/Cargo.toml' 2>/dev/null || true)

  if [[ -n "$diff_out" ]]; then
    log "Rust source changed since ${prev:0:12} → ${current:0:12}:"
    printf '  %s\n' $diff_out | head -10
    [[ $(printf '%s\n' "$diff_out" | wc -l) -gt 10 ]] && log "  ... (truncated)"
    return 0
  fi

  log "no .rs / Cargo.toml changes since ${prev:0:12} — skipping rebuild"
  return 1
}

# ---------------------------------------------------------------------------
# Find napi crates
# ---------------------------------------------------------------------------

find_napi_crates() {
  # Print one crate dir per line
  while IFS= read -r -d '' pkg; do
    local build_script
    build_script=$(jq -r '.scripts.build // empty' "$pkg" 2>/dev/null)
    if [[ "$build_script" == *"napi build"* ]]; then
      dirname "$pkg"
    fi
  done < <(find "$FORK_RUVECTOR/crates" -mindepth 2 -maxdepth 4 -name 'package.json' -print0 2>/dev/null)
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
# Verify binaries updated since marker time
# ---------------------------------------------------------------------------

verify_binaries_fresh() {
  local marker="$1"
  local count=0
  while IFS= read -r f; do
    if [[ "$f" -nt "$marker" ]]; then
      count=$((count + 1))
    fi
  done < <(find "$FORK_RUVECTOR/crates" -name '*.darwin-arm64.node' -type f 2>/dev/null)

  if [[ $count -eq 0 ]]; then
    log_error "0 .darwin-arm64.node files updated — build silently produced nothing"
    return 1
  fi
  log "${count} .darwin-arm64.node binaries refreshed"
  return 0
}

# ---------------------------------------------------------------------------
# Commit + push (per memory feedback-trunk-only-fork-development: main only;
# memory feedback-fork-commit-attribution: no Co-Authored-By trailer)
# ---------------------------------------------------------------------------

commit_and_push_binaries() {
  cd "$FORK_RUVECTOR"

  # Verify on main + sparkling remote present
  local branch; branch=$(git branch --show-current)
  if [[ "$branch" != "main" ]]; then
    log_error "fork is on '$branch', expected 'main' — refusing to commit"
    return 1
  fi
  if ! git remote -v | grep -q '^sparkling'; then
    log_error "no 'sparkling' remote configured"
    return 1
  fi

  # Stage only .node binaries we may have just rebuilt
  git add -- 'crates/*-node/*.darwin-arm64.node' \
              'crates/*/*-node/*.darwin-arm64.node' \
              'crates/sona/*.darwin-arm64.node' \
              'crates/ruvector-router-ffi/*.darwin-arm64.node' 2>/dev/null || true

  if [[ -z "$(git diff --cached --name-only)" ]]; then
    log "no binary changes to commit (rebuild produced byte-identical output)"
    return 0
  fi

  log "staged binaries:"
  git diff --cached --name-only | sed 's/^/  /'

  git commit -m "build(napi): rebuild .node binaries from current Rust source

Triggered by scripts/napi-rebuild.sh — detected Rust source changes since
last successful build state. Rebuilds all napi crates' .node binaries so
the published @sparkleideas/ruvector artifact reflects current source.

Without this auto-rebuild step, fork .node binaries can lag behind
fork .rs source, masking real fixes (regression: ADR-0133)."

  # Pull --rebase to handle any concurrent push from fork-version bump
  git pull --rebase sparkling main 2>&1 | tail -3 || true
  if ! git push sparkling main; then
    log_error "push to sparkling failed"
    return 1
  fi
  log "✓ committed + pushed rebuilt binaries"
  return 0
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  log "=================================================="
  log "Phase: napi-rebuild (ADR-0133)"
  log "=================================================="

  if ! detect_rust_changes "$PREV_HEAD"; then
    log "→ skipping rebuild (no Rust source changes)"
    return 0
  fi

  # Verify napi CLI is available — fail loud, don't skip silently
  if ! command -v npm >/dev/null 2>&1; then
    log_error "npm not in PATH — cannot rebuild napi binaries"
    return 1
  fi

  # Snapshot mtime baseline before rebuild
  MARKER=$(mktemp /tmp/napi-rebuild-marker.XXXXXX)
  trap 'rm -f "${MARKER:-}"' EXIT

  # Find + rebuild
  local crates=()
  while IFS= read -r d; do
    crates+=("$d")
  done < <(find_napi_crates)

  if [[ ${#crates[@]} -eq 0 ]]; then
    log_error "found 0 napi crates — refusing to continue (probable script bug)"
    return 1
  fi

  log "found ${#crates[@]} napi crates to rebuild"
  for c in "${crates[@]}"; do
    log "  - $(basename "$c")"
  done

  for c in "${crates[@]}"; do
    if ! rebuild_crate "$c"; then
      return 1
    fi
  done

  if ! verify_binaries_fresh "$MARKER"; then
    return 1
  fi

  if ! commit_and_push_binaries; then
    return 1
  fi

  log "=================================================="
  log "napi-rebuild complete"
  log "=================================================="
}

main
