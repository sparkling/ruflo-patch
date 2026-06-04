#!/usr/bin/env bash
# lib/wasm-config.sh — Shared wasm-pack-package config (ADR-0232)
#
# Single source of truth for pure-WASM crates (wasm-bindgen + cdylib) that
# ship a canonical npm/packages/<name>/ artefact. Mirrors lib/napi-config.sh
# in shape; sourced by:
#   - scripts/wasm-rebuild.sh — detect Rust source changes + rebuild _bg.wasm
#   - tests/unit/adr0232-wasm-config.test.mjs — schema validation
#
# Format: WASM_PACKAGES is an array of "<fork_dir_var>:<crate_path>:<dest_npm_dir>"
#   - <fork_dir_var>:  name of the FORK_DIR_* env var (e.g. FORK_DIR_RUVECTOR)
#   - <crate_path>:    relative path under fork to the wasm-bindgen crate
#                      (where Cargo.toml + src/ live)
#   - <dest_npm_dir>:  relative path under fork to the canonical publish dir
#                      where wasm-pack output (*_bg.wasm + *.js + *.d.ts) MUST
#                      land. This is the artefact the publish pipeline picks
#                      up via Verdaccio.
#
# Per ADR-0232 §"Confirmation": start with `ruvllm-wasm` as the confirmed-
# publishable entry. Other WASM crates remain developer-local builds until
# their canonical npm/packages/ pin is confirmed and added here.

# Helper: parse one config entry into 3 globals: WASM_FORK_DIR, WASM_CRATE_PATH, WASM_DEST_NPM_DIR
# Usage:
#   wasm_parse_entry "FORK_DIR_RUVECTOR:crates/ruvllm-wasm:npm/packages/ruvllm-wasm"
#   echo "$WASM_FORK_DIR/$WASM_CRATE_PATH"
wasm_parse_entry() {
  local entry="$1"
  IFS=':' read -r _fork_var WASM_CRATE_PATH WASM_DEST_NPM_DIR <<<"$entry"
  WASM_FORK_DIR="${!_fork_var:-}"
  if [[ -z "$WASM_FORK_DIR" ]]; then
    return 1
  fi
  return 0
}

# Helper: list unique fork dirs that have at least one wasm package
wasm_unique_forks() {
  local seen=""
  for entry in "${WASM_PACKAGES[@]}"; do
    wasm_parse_entry "$entry" || continue
    if [[ ":$seen:" != *":$WASM_FORK_DIR:"* ]]; then
      seen="${seen}:${WASM_FORK_DIR}"
      echo "$WASM_FORK_DIR"
    fi
  done
}

WASM_PACKAGES=(
  # ── ruvllm-wasm (the ADR-0232 §Confirmation entry #1) ──
  # Crate at forks/ruvector/crates/ruvllm-wasm/; canonical publish dir at
  # forks/ruvector/npm/packages/ruvllm-wasm/. The ADR-0231 wave A9 defect
  # surfaced exactly this crate: stale crates/ruvllm-wasm/pkg/ + canonical
  # npm/packages/ruvllm-wasm/ competed for the publishable name.
  "FORK_DIR_RUVECTOR:crates/ruvllm-wasm:npm/packages/ruvllm-wasm"
  # ── rabitq-wasm (ADR-0294 R3) ──
  # Crate at forks/ruvector/crates/ruvector-rabitq-wasm/; canonical publish dir
  # at forks/ruvector/npm/packages/rabitq-wasm/. Wiring this makes the pipeline
  # rebuild + publish @sparkleideas/ruvector-rabitq-wasm every cycle (the cli's
  # rabitq-index.ts wrapper imports the codemod-renamed name). wasm-rebuild emits
  # the --target nodejs shape (auto-instantiated, no initSync); the wrapper's
  # loadRabitqModule() accepts all three wasm-bindgen shapes (web-legacy /
  # web-auto / nodejs) so the rebuilt artefact works. Without this entry the
  # mirror was never published → the renamed optionalDependency 404'd and a clean
  # install silently skipped it (visible-but-dead tools — ADR-0294 B1). See also
  # the codemod UNSCOPED_MAP entry (the nodejs build emits the unscoped
  # `ruvector-rabitq-wasm` name) and config/publish-levels.json level 0.
  "FORK_DIR_RUVECTOR:crates/ruvector-rabitq-wasm:npm/packages/rabitq-wasm"
)

# Future entries (per ADR-0232 §Decision Outcome "add others as the
# publishable inventory is confirmed"):
#   - rvagent-wasm (confirmed exists; canonical dir TBD)
#   - other ruvector wasm crates that ship via npm/packages/
#
# Adding an entry requires the same operator-visible artefact contract:
#   1. The crate has a canonical npm/packages/<name>/ publish dir
#   2. wasm-pack build --target nodejs (or web) writes to that dir
#   3. The pipeline-rebuilt _bg.wasm is the source-of-truth for releases
