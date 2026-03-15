#!/usr/bin/env bash
# scripts/publish-verdaccio.sh — Publish built packages to local Verdaccio + promote (ADR-0037).
#
# Extracted from test-verify.sh phases 1-5, 9. Publishing is CI/CD
# infrastructure, not testing — this script handles publish + promote only.
#
# Usage:
#   bash scripts/publish-verdaccio.sh --build-dir <path> [--changed-packages <json>]
#
# Exit code: 0 on success, non-zero on failure
set -uo pipefail

# ── Defaults ──────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

BUILD_DIR=""
PORT=4873
CHANGED_PACKAGES="all"

# ── Argument parsing ──────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --build-dir)
      BUILD_DIR="${2:-}"
      [[ -z "$BUILD_DIR" ]] && { echo "Error: --build-dir requires a path"; exit 1; }
      shift 2
      ;;
    --changed-packages)
      CHANGED_PACKAGES="${2:-all}"
      shift 2
      ;;
    -h|--help)
      echo "Usage: bash scripts/publish-verdaccio.sh [--build-dir <path>] [--changed-packages <json>]"
      echo ""
      echo "Options:"
      echo "  --build-dir <path>         Built package directory (default: /tmp/ruflo-build)"
      echo "  --changed-packages <json>  JSON array of changed packages, or \"all\" (default: all)"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$BUILD_DIR" ]]; then
  BUILD_DIR="/tmp/ruflo-build"
  if [[ ! -f "${BUILD_DIR}/.build-manifest.json" ]]; then
    echo "Error: no build artifacts at ${BUILD_DIR}" >&2
    echo "Run 'npm run build' first, or pass --build-dir <path>" >&2
    exit 1
  fi
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Using cached build at ${BUILD_DIR}" >&2
fi

# ── Logging ───────────────────────────────────────────────────────
log() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*" >&2; }
log_error() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] ERROR: $*" >&2; }

# ── Phase timing infrastructure ───────────────────────────────────
PHASE_TIMINGS=""
TIMING_FILE="/tmp/ruflo-publish-verdaccio-timing.jsonl"
: > "$TIMING_FILE"

_record_phase() {
  local name="$1" ms="$2"
  PHASE_TIMINGS="${PHASE_TIMINGS} ${name}:${ms}"
  printf '{"phase":"%s","duration_ms":%d}\n' "$name" "$ms" >> "$TIMING_FILE"
  if [[ $ms -ge 1000 ]]; then
    log "  Phase '${name}': ${ms}ms ($(( ms / 1000 ))s)"
  else
    log "  Phase '${name}': ${ms}ms"
  fi
}

_ns() { date +%s%N 2>/dev/null || echo 0; }
_elapsed_ms() {
  local start="$1" end="$2"
  if [[ "$start" != "0" && "$end" != "0" ]]; then
    echo $(( (end - start) / 1000000 ))
  else
    echo 0
  fi
}

publish_start_ns=$(_ns)
publish_start_s=$(date +%s)
log "publish-verdaccio.sh starting (build-dir: ${BUILD_DIR})"

# ══════════════════════════════════════════════════════════════════
# Phase 1: Verdaccio health check
# ══════════════════════════════════════════════════════════════════
_p=$(_ns)
if ! curl -sf "http://localhost:${PORT}/-/ping" >/dev/null 2>&1; then
  log_error "Verdaccio not running on port ${PORT}"
  log_error "Start it: systemctl --user start verdaccio"
  exit 1
fi
log "Verdaccio healthy on port ${PORT}"
_record_phase "health-check" "$(_elapsed_ms "$_p" "$(_ns)")"

# ══════════════════════════════════════════════════════════════════
# Phase 2: Selective cache clear
# ══════════════════════════════════════════════════════════════════
_p=$(_ns)
RQ_STORAGE="/run/user/1000/verdaccio-storage"
if [[ "$CHANGED_PACKAGES" == "all" || "$CHANGED_PACKAGES" == "[]" ]]; then
  log "Full mode: clearing all @sparkleideas/* from Verdaccio"
  rm -rf "${RQ_STORAGE}/@sparkleideas" 2>/dev/null || true
else
  log "Incremental mode: clearing only changed packages from Verdaccio"
  echo "$CHANGED_PACKAGES" | node -e "
    const fs = require('fs');
    const pkgs = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
    for (const pkg of pkgs) {
      const name = pkg.replace('@sparkleideas/', '');
      const dir = '${RQ_STORAGE}/@sparkleideas/' + name;
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  " 2>/dev/null || true
fi
_record_phase "cache-clear" "$(_elapsed_ms "$_p" "$(_ns)")"

# ══════════════════════════════════════════════════════════════════
# Phase 3: Publish built packages to Verdaccio
# ══════════════════════════════════════════════════════════════════
_p=$(_ns)
log "Publishing built packages to Verdaccio..."
npm config set "//localhost:${PORT}/:_authToken" "test-token" 2>/dev/null || true

# Always publish ALL packages to Verdaccio (not just changed ones).
# Acceptance checks need every package available. Incremental publish
# breaks tests when unchanged packages aren't on Verdaccio.
publish_args=(--no-rate-limit --no-save)
NPM_CONFIG_REGISTRY="http://localhost:${PORT}" \
  node "${SCRIPT_DIR}/publish.mjs" --build-dir "${BUILD_DIR}" "${publish_args[@]}" 2>&1 || {
  log_error "Failed to publish to Verdaccio"
  exit 1
}
log "Built packages published to Verdaccio"
_record_phase "publish-verdaccio" "$(_elapsed_ms "$_p" "$(_ns)")"

# ══════════════════════════════════════════════════════════════════
# Phase 4: Publish wrapper package (@sparkleideas/ruflo)
# ══════════════════════════════════════════════════════════════════
_p=$(_ns)
if [[ -f "${PROJECT_DIR}/package.json" ]]; then
  log "Publishing local wrapper (@sparkleideas/ruflo) to Verdaccio..."
  NPM_CONFIG_REGISTRY="http://localhost:${PORT}" \
    npm publish "${PROJECT_DIR}" --access public --ignore-scripts --tag latest 2>&1 || \
    log "  wrapper publish skipped (may already exist)"
fi
_record_phase "publish-wrapper" "$(_elapsed_ms "$_p" "$(_ns)")"

# ══════════════════════════════════════════════════════════════════
# Phase 5: NPX cache clear (ADR-0025)
# ══════════════════════════════════════════════════════════════════
_p=$(_ns)
# Clear _npx/ resolution trees so npx picks up fresh versions
find "${HOME}/.npm/_npx" -path "*/@sparkleideas" -type d -exec rm -rf {} + 2>/dev/null || true
_p5_ms=$(_elapsed_ms "$_p" "$(_ns)")
log "  npx tree clear: ${_p5_ms}ms (cacache skipped — using --prefer-offline)"
_record_phase "npx-cache-clear" "$(_elapsed_ms "$_p" "$(_ns)")"

# ══════════════════════════════════════════════════════════════════
# Phase 6: Promote all packages to @latest
# ══════════════════════════════════════════════════════════════════
_p=$(_ns)
log "Promoting packages to @latest on Verdaccio (parallel)..."
_promote_count=0
_prom_pids=()
_prom_count=0
for pkg_dir in "${RQ_STORAGE}/@sparkleideas"/*/; do
  [[ -d "$pkg_dir" ]] || continue
  pkg_name="@sparkleideas/$(basename "$pkg_dir")"
  (
    latest_ver=$(npm view "${pkg_name}" version --registry "http://localhost:${PORT}" 2>/dev/null) || exit 0
    [[ -z "$latest_ver" ]] && exit 0
    npm dist-tag add "${pkg_name}@${latest_ver}" latest \
      --registry "http://localhost:${PORT}" 2>/dev/null || true
  ) &
  _prom_pids+=($!)
  _prom_count=$((_prom_count + 1))
  _promote_count=$((_promote_count + 1))
  # Cap at 10 concurrent
  if [[ $_prom_count -ge 10 ]]; then
    wait "${_prom_pids[@]}" 2>/dev/null || true
    _prom_pids=()
    _prom_count=0
  fi
done
wait "${_prom_pids[@]}" 2>/dev/null || true
log "Promote complete (${_promote_count} packages, parallel)"
_record_phase "promote" "$(_elapsed_ms "$_p" "$(_ns)")"

# ══════════════════════════════════════════════════════════════════
# Timing summary
# ══════════════════════════════════════════════════════════════════
publish_end_ns=$(_ns)
publish_total_ms=$(_elapsed_ms "$publish_start_ns" "$publish_end_ns")
publish_end_s=$(date +%s)

log "──────────────────────────────────────────"
log "Publish-verdaccio timing summary:"
for entry in $PHASE_TIMINGS; do
  _name="${entry%%:*}"
  _ms="${entry##*:}"
  if [[ $publish_total_ms -gt 0 ]]; then
    _pct=$(( (_ms * 100) / publish_total_ms ))
  else
    _pct=0
  fi
  if [[ $_ms -ge 1000 ]]; then
    log "  $(printf '%-22s %6dms (%3ds) %3d%%' "$_name" "$_ms" "$((_ms / 1000))" "$_pct")"
  else
    log "  $(printf '%-22s %6dms        %3d%%' "$_name" "$_ms" "$_pct")"
  fi
done
log "  $(printf '%-22s %6dms (%3ds)' 'TOTAL' "$publish_total_ms" "$(( publish_end_s - publish_start_s ))")"
log "──────────────────────────────────────────"

printf '{"phase":"TOTAL","duration_ms":%d}\n' "$publish_total_ms" >> "$TIMING_FILE"

exit 0
