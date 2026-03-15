#!/usr/bin/env bash
# scripts/build-wasm.sh — WASM compilation for agent-booster (ADR-0039)
#
# Standalone WASM build with Rust source hash caching.
# Exits 0 gracefully if: build dir missing, wasm-pack not installed,
# or crate directory not found. WASM is always optional.
#
# Usage: bash scripts/build-wasm.sh [--build-dir <dir>]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Source shared utilities
source "${PROJECT_DIR}/lib/pipeline-utils.sh"

# Parse args
BUILD_DIR="/tmp/ruflo-build"
for arg in "$@"; do
  case "$arg" in
    --build-dir) shift; BUILD_DIR="${1:-/tmp/ruflo-build}"; shift || true ;;
    --build-dir=*) BUILD_DIR="${arg#--build-dir=}" ;;
  esac
done

# Exit 0 if build dir doesn't exist (nothing to build)
if [[ ! -d "$BUILD_DIR" ]]; then
  log "WASM: build dir ${BUILD_DIR} does not exist — skipping"
  exit 0
fi

# Exit 0 if wasm-pack not installed (WASM is optional)
if ! command -v wasm-pack &>/dev/null; then
  log "WASM: wasm-pack not installed — skipping"
  exit 0
fi

# Locate crate directory
PKG_DIR="${BUILD_DIR}/cross-repo/agentic-flow/packages/agent-booster"
CRATE_DIR="${PKG_DIR}/crates/agent-booster-wasm"

if [[ ! -d "$CRATE_DIR" ]]; then
  log "WASM: crate dir not found — skipping"
  exit 0
fi

# ---------------------------------------------------------------------------
# WASM build with source hash caching
# ---------------------------------------------------------------------------

WASM_CACHE="${BUILD_DIR}/.wasm-cache.json"
PARENT_CRATE_DIR="${CRATE_DIR}/../agent-booster"

# Compute hash of all WASM-relevant source files
current_wasm_hash=""
current_wasm_hash=$(cat \
  "$CRATE_DIR/Cargo.toml" \
  "$CRATE_DIR/src/lib.rs" \
  "$PARENT_CRATE_DIR/Cargo.toml" \
  $(find "$PARENT_CRATE_DIR/src" -name "*.rs" -type f 2>/dev/null | sort) \
  2>/dev/null | sha256sum | cut -d' ' -f1) || current_wasm_hash=""

# Check cache
if [[ -n "$current_wasm_hash" && -f "$WASM_CACHE" && -f "$PKG_DIR/wasm/agent_booster_wasm.js" ]]; then
  cached_wasm_hash=""
  cached_wasm_hash=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$WASM_CACHE','utf-8')).wasm_source_hash||'')" 2>/dev/null) || cached_wasm_hash=""
  if [[ "$current_wasm_hash" == "$cached_wasm_hash" ]]; then
    log "WASM: cache hit — skipping wasm-pack (hash=${current_wasm_hash:0:12})"
    add_cmd_timing "build" "wasm-pack (cache hit)" "0"
    exit 0
  fi
fi

# Build WASM
log "WASM: building agent-booster-wasm"
_wasm_start=$(date +%s%N 2>/dev/null || echo 0)

wasm_out=$(wasm-pack build "$CRATE_DIR" --target nodejs --out-dir "$PKG_DIR/wasm" 2>&1) || {
  log "WARN: WASM build failed"
  echo "$wasm_out" | tail -5 >&2
  exit 0  # WASM is optional — don't fail the pipeline
}

if [[ -f "$PKG_DIR/wasm/agent_booster_wasm.js" ]]; then
  rm -f "$PKG_DIR/wasm/package.json" "$PKG_DIR/wasm/.gitignore"
  # Write WASM cache on success
  cat > "$WASM_CACHE" <<WASMCACHE
{"wasm_source_hash":"${current_wasm_hash}","built_at":"$(date -u '+%Y-%m-%dT%H:%M:%SZ')"}
WASMCACHE
fi

_wasm_end=$(date +%s%N 2>/dev/null || echo 0)
if [[ "$_wasm_start" != "0" && "$_wasm_end" != "0" ]]; then
  _wasm_ms=$(( (_wasm_end - _wasm_start) / 1000000 ))
  log "WASM: build completed in ${_wasm_ms}ms"
  add_cmd_timing "build" "wasm-pack agent-booster" "${_wasm_ms}"
fi

log "WASM: build succeeded"
