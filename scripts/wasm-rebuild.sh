#!/usr/bin/env bash
# scripts/wasm-rebuild.sh — Detect Rust source changes + rebuild pure-WASM
# crates' wasm-pack artefacts. ADR-0232 §Decision Outcome Option B.
#
# Mirrors scripts/napi-rebuild.sh: source-diff → wasm-pack build → mtime
# verify-fresh → commit-and-push. Per ADR-0232 §"Bad": requires wasm-pack
# in PATH; fails loud if missing (per feedback-no-fallbacks) — unlike the
# legacy build-wasm.sh which silently exited 0.
#
# Called by: scripts/ruflo-publish.sh (run_phase "wasm-rebuild")
# Usage:     bash scripts/wasm-rebuild.sh [<PREV_RUVECTOR_HEAD>] [<PREV_AGENTIC_HEAD>]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# shellcheck source=/dev/null
source "${ROOT_DIR}/lib/fork-paths.sh"
# shellcheck source=/dev/null
source "${ROOT_DIR}/lib/wasm-config.sh"

PREV_RUVECTOR_HEAD="${1:-}"
PREV_AGENTIC_HEAD="${2:-}"

MARKER=""

log() {
  printf '[%s] wasm-rebuild: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}
log_error() {
  printf '[%s] wasm-rebuild: ERROR: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >&2
}

prev_head_for_fork() {
  local fork_dir="$1"
  case "$fork_dir" in
    "$FORK_DIR_RUVECTOR") echo "$PREV_RUVECTOR_HEAD" ;;
    "$FORK_DIR_AGENTIC")  echo "$PREV_AGENTIC_HEAD" ;;
    *) echo "" ;;
  esac
}

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

  local pathspecs=()
  for entry in "${WASM_PACKAGES[@]}"; do
    wasm_parse_entry "$entry" || continue
    if [[ "$WASM_FORK_DIR" == "$fork_dir" ]]; then
      pathspecs+=("${WASM_CRATE_PATH}/**/*.rs" "${WASM_CRATE_PATH}/**/Cargo.toml" "${WASM_CRATE_PATH}/Cargo.toml")
    fi
  done
  if [[ ${#pathspecs[@]} -eq 0 ]]; then
    log "${fork_name}: no WASM_PACKAGES entries — skipping"
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

find_wasm_crates_for_fork() {
  local fork_dir="$1"
  for entry in "${WASM_PACKAGES[@]}"; do
    wasm_parse_entry "$entry" || continue
    if [[ "$WASM_FORK_DIR" == "$fork_dir" ]]; then
      local crate_dir="${WASM_FORK_DIR}/${WASM_CRATE_PATH}"
      [[ -f "${crate_dir}/Cargo.toml" ]] || continue
      echo "${crate_dir}:${WASM_DEST_NPM_DIR}"
    fi
  done
}

rebuild_crate() {
  local crate_dir="$1"
  local dest_rel="$2"
  local fork_dir="$3"
  local name; name=$(basename "$crate_dir")
  # Use the canonical dest dir as an ABSOLUTE path so wasm-pack output lands
  # in npm/packages/<name>/ instead of crates/<name>/pkg/ (the ADR-0231 wave
  # A9 footgun).
  local dest_abs="${fork_dir}/${dest_rel}"
  mkdir -p "$dest_abs"

  log "rebuilding ${name} → ${dest_rel}..."
  if (cd "$crate_dir" && wasm-pack build --target nodejs --out-dir "$dest_abs" --release >/dev/null 2>&1); then
    log "  ✓ ${name}"
    return 0
  else
    log_error "  ✗ ${name} wasm-pack build failed"
    (cd "$crate_dir" && wasm-pack build --target nodejs --out-dir "$dest_abs" --release 2>&1 | tail -20) >&2
    return 1
  fi
}

verify_artefacts_fresh() {
  local fork_dir="$1"
  local marker="$2"
  local fork_name; fork_name=$(basename "$fork_dir")
  local count=0
  for entry in "${WASM_PACKAGES[@]}"; do
    wasm_parse_entry "$entry" || continue
    [[ "$WASM_FORK_DIR" == "$fork_dir" ]] || continue
    local dest_abs="${WASM_FORK_DIR}/${WASM_DEST_NPM_DIR}"
    while IFS= read -r f; do
      if [[ "$f" -nt "$marker" ]]; then
        count=$((count + 1))
      fi
    done < <(find "$dest_abs" -maxdepth 2 -name '*_bg.wasm' -type f 2>/dev/null)
  done
  if [[ $count -eq 0 ]]; then
    log_error "${fork_name}: 0 _bg.wasm files updated — wasm-pack silently produced nothing"
    return 1
  fi
  log "${fork_name}: ${count} _bg.wasm artefacts refreshed"
  return 0
}

commit_and_push_artefacts_for_fork() {
  local fork_dir="$1"
  local fork_name; fork_name=$(basename "$fork_dir")
  cd "$fork_dir"

  local branch; branch=$(git branch --show-current)
  if [[ "$branch" != "main" ]]; then
    log_error "${fork_name}: on '$branch', expected 'main' — refusing to commit"
    return 1
  fi
  if ! git remote -v | grep -q '^sparkling'; then
    log_error "${fork_name}: no 'sparkling' remote configured"
    return 1
  fi

  for entry in "${WASM_PACKAGES[@]}"; do
    wasm_parse_entry "$entry" || continue
    [[ "$WASM_FORK_DIR" == "$fork_dir" ]] || continue
    # wasm-pack outputs: *_bg.wasm, *.js, *.d.ts, *_bg.wasm.d.ts
    git add -- "${WASM_DEST_NPM_DIR}"/*_bg.wasm \
                "${WASM_DEST_NPM_DIR}"/*.js \
                "${WASM_DEST_NPM_DIR}"/*.d.ts 2>/dev/null || true
  done

  if [[ -z "$(git diff --cached --name-only)" ]]; then
    log "${fork_name}: no wasm artefact changes to commit (rebuild produced byte-identical output)"
    return 0
  fi

  log "${fork_name}: staged wasm artefacts:"
  git diff --cached --name-only | sed 's/^/  /'

  git commit -m "build(wasm): rebuild _bg.wasm artefacts from current Rust source

Triggered by scripts/wasm-rebuild.sh — detected Rust source changes since
last successful build state. Rebuilds all WASM_PACKAGES crates' wasm-pack
artefacts so the canonical npm/packages/<name>/ reflects current source.

Without this auto-rebuild step, fork wasm artefacts lag behind fork .rs
source — exactly the ADR-0231 wave A9 stale-pkg/-vs-canonical-dir silent
footgun. ADR-0232."

  git pull --rebase sparkling main 2>&1 | tail -3 || true
  if ! git push sparkling main; then
    log_error "${fork_name}: push to sparkling failed"
    return 1
  fi
  log "${fork_name}: ✓ committed + pushed rebuilt artefacts"
  return 0
}

main() {
  log "=================================================="
  log "Phase: wasm-rebuild (ADR-0232 — pure-WASM crates)"
  log "=================================================="

  if ! command -v wasm-pack >/dev/null 2>&1; then
    log_error "wasm-pack not in PATH — cannot rebuild WASM artefacts (per ADR-0232 §Bad: requires wasm-pack)"
    return 1
  fi

  if [[ ${#WASM_PACKAGES[@]} -eq 0 ]]; then
    log "no WASM_PACKAGES configured — skipping"
    return 0
  fi

  local any_built=0
  while IFS= read -r fork_dir; do
    [[ -z "$fork_dir" ]] && continue
    local prev; prev=$(prev_head_for_fork "$fork_dir")
    if ! detect_rust_changes "$fork_dir" "$prev"; then
      continue
    fi

    MARKER=$(mktemp /tmp/wasm-rebuild-marker.XXXXXX)
    trap 'rm -f "${MARKER:-}"' EXIT

    local crates=()
    while IFS= read -r d; do
      crates+=("$d")
    done < <(find_wasm_crates_for_fork "$fork_dir")

    if [[ ${#crates[@]} -eq 0 ]]; then
      log_error "${fork_dir}: 0 wasm crates resolvable — refusing to continue (probable config bug)"
      return 1
    fi

    log "$(basename "$fork_dir"): ${#crates[@]} wasm crates to rebuild"
    for entry in "${crates[@]}"; do
      log "  - $(basename "${entry%%:*}")"
    done

    for entry in "${crates[@]}"; do
      local crate_dir="${entry%%:*}"
      local dest_rel="${entry##*:}"
      if ! rebuild_crate "$crate_dir" "$dest_rel" "$fork_dir"; then
        return 1
      fi
    done

    if ! verify_artefacts_fresh "$fork_dir" "$MARKER"; then
      return 1
    fi

    if ! commit_and_push_artefacts_for_fork "$fork_dir"; then
      return 1
    fi

    any_built=1
    rm -f "$MARKER"
    MARKER=""
  done < <(wasm_unique_forks)

  if [[ $any_built -eq 0 ]]; then
    log "→ skipped all forks (no Rust source changes anywhere)"
  fi

  log "=================================================="
  log "wasm-rebuild complete"
  log "=================================================="
}

main "$@"
