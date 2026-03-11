#!/usr/bin/env bash
# scripts/test-verify.sh — Unified verification: publish once, install once,
# run all structural + functional checks, promote (ADR-0023 refactor).
#
# Replaces both test-integration.sh and test-rq.sh for the CI pipeline.
# Single Verdaccio publish + single install eliminates ~12 minutes of waste.
#
# Usage:
#   bash scripts/test-verify.sh [--build-dir <path>] [--changed-packages <json>] [--skip-promote]
#
# Exit code: number of failed checks (0 = all pass)
set -uo pipefail

# ── Defaults ──────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

BUILD_DIR=""
RQ_PORT=4873
CHANGED_PACKAGES="all"
SKIP_PROMOTE="false"
VERIFY_TEMP=""

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
    --skip-promote)
      SKIP_PROMOTE="true"
      shift
      ;;
    -h|--help)
      echo "Usage: bash scripts/test-verify.sh [--build-dir <path>] [--changed-packages <json>] [--skip-promote]"
      echo ""
      echo "Options:"
      echo "  --build-dir <path>         Built package directory (default: /tmp/ruflo-build)"
      echo "  --changed-packages <json>  JSON array of changed packages, or \"all\" (default: all)"
      echo "  --skip-promote             Skip promoting packages to @latest"
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

# ── Global timeout: 180s with SIGTERM→5s→SIGKILL escalation ──────
( sleep 180; log_error "[TIMEOUT] test-verify.sh exceeded 180s — sending SIGTERM"; kill -TERM -$$ 2>/dev/null || kill -TERM $$ 2>/dev/null || true; sleep 5; kill -KILL -$$ 2>/dev/null || kill -KILL $$ 2>/dev/null || true ) &
GLOBAL_TIMEOUT_PID=$!

# ── Cleanup trap ──────────────────────────────────────────────────
cleanup() {
  kill "$GLOBAL_TIMEOUT_PID" 2>/dev/null || true
  if [[ -n "$VERIFY_TEMP" && -d "$VERIFY_TEMP" ]]; then
    rm -rf "$VERIFY_TEMP"
  fi
  if [[ -n "${RQ_PARALLEL_DIR:-}" && -d "${RQ_PARALLEL_DIR:-}" ]]; then
    rm -rf "$RQ_PARALLEL_DIR"
  fi
}
trap cleanup EXIT INT TERM

# ── Phase timing infrastructure ───────────────────────────────────
VERIFY_PHASE_TIMINGS=""
VERIFY_TIMING_FILE="/tmp/ruflo-verify-timing.jsonl"
: > "$VERIFY_TIMING_FILE"

# Record a phase timing: name, duration_ms
_record_phase() {
  local name="$1" ms="$2"
  VERIFY_PHASE_TIMINGS="${VERIFY_PHASE_TIMINGS} ${name}:${ms}"
  printf '{"phase":"%s","duration_ms":%d}\n' "$name" "$ms" >> "$VERIFY_TIMING_FILE"
  if [[ $ms -ge 1000 ]]; then
    log "  Phase '${name}' completed in ${ms}ms ($(( ms / 1000 ))s)"
  else
    log "  Phase '${name}' completed in ${ms}ms"
  fi
}

# Nanosecond timestamp helper
_ns() { date +%s%N 2>/dev/null || echo 0; }

# Compute elapsed ms between two ns timestamps
_elapsed_ms() {
  local start="$1" end="$2"
  if [[ "$start" != "0" && "$end" != "0" ]]; then
    echo $(( (end - start) / 1000000 ))
  else
    echo 0
  fi
}

verify_start_ns=$(_ns)
verify_start_s=$(date +%s)
log "test-verify.sh starting (build-dir: ${BUILD_DIR})"

# ══════════════════════════════════════════════════════════════════
# Phase 1: Verdaccio health check
# ══════════════════════════════════════════════════════════════════
_p1_start=$(_ns)
if ! curl -sf "http://localhost:${RQ_PORT}/-/ping" >/dev/null 2>&1; then
  log_error "Verdaccio not running on port ${RQ_PORT}"
  log_error "Start it: systemctl --user start verdaccio"
  exit 1
fi
log "Verdaccio healthy on port ${RQ_PORT}"
_record_phase "health-check" "$(_elapsed_ms "$_p1_start" "$(_ns)")"

# ══════════════════════════════════════════════════════════════════
# Phase 2: Selective cache clear
# ══════════════════════════════════════════════════════════════════
_p2_start=$(_ns)
RQ_STORAGE="/home/claude/.verdaccio/storage"
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
_record_phase "cache-clear" "$(_elapsed_ms "$_p2_start" "$(_ns)")"

# ══════════════════════════════════════════════════════════════════
# Phase 3: Publish built packages to Verdaccio (ONCE)
# ══════════════════════════════════════════════════════════════════
_p3_start=$(_ns)
log "Publishing built packages to Verdaccio..."
npm config set "//localhost:${RQ_PORT}/:_authToken" "test-token" 2>/dev/null || true

publish_args=(--no-rate-limit --no-save)
if [[ "$CHANGED_PACKAGES" != "all" && "$CHANGED_PACKAGES" != "[]" ]]; then
  publish_args+=(--packages "$CHANGED_PACKAGES")
fi
NPM_CONFIG_REGISTRY="http://localhost:${RQ_PORT}" \
  node "${SCRIPT_DIR}/publish.mjs" --build-dir "${BUILD_DIR}" "${publish_args[@]}" 2>&1 || {
  log_error "Failed to publish to Verdaccio"
  exit 1
}
log "Built packages published to Verdaccio"
_record_phase "publish-verdaccio" "$(_elapsed_ms "$_p3_start" "$(_ns)")"

# ══════════════════════════════════════════════════════════════════
# Phase 4: Publish wrapper package (@sparkleideas/ruflo)
# ══════════════════════════════════════════════════════════════════
_p4_start=$(_ns)
if [[ -f "${PROJECT_DIR}/package.json" ]]; then
  log "Publishing local wrapper (@sparkleideas/ruflo) to Verdaccio..."
  NPM_CONFIG_REGISTRY="http://localhost:${RQ_PORT}" \
    npm publish "${PROJECT_DIR}" --access public --ignore-scripts --tag latest 2>&1 || \
    log "  wrapper publish skipped (may already exist)"
fi
_record_phase "publish-wrapper" "$(_elapsed_ms "$_p4_start" "$(_ns)")"

# ══════════════════════════════════════════════════════════════════
# Phase 5: NPX cache clear (ADR-0025)
# ══════════════════════════════════════════════════════════════════
_p5_start=$(_ns)
# Two caches: _npx/ (resolution trees) and _cacache/ (HTTP metadata + tarballs)
find "${HOME}/.npm/_npx" -path "*/@sparkleideas" -type d -exec rm -rf {} + 2>/dev/null || true
if [[ "$CHANGED_PACKAGES" == "all" || "$CHANGED_PACKAGES" == "[]" ]]; then
  grep -rl "sparkleideas" "${HOME}/.npm/_cacache/index-v5/" 2>/dev/null | xargs rm -f 2>/dev/null || true
else
  for pkg in $(echo "$CHANGED_PACKAGES" | node -e "
    JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'))
      .forEach(p => console.log(p.replace('@sparkleideas/','')))
  " 2>/dev/null); do
    grep -rl "\"@sparkleideas/${pkg}\"" "${HOME}/.npm/_cacache/index-v5/" 2>/dev/null \
      | xargs rm -f 2>/dev/null || true
  done
fi
_record_phase "npx-cache-clear" "$(_elapsed_ms "$_p5_start" "$(_ns)")"

# ══════════════════════════════════════════════════════════════════
# Phase 6: Install packages into temp dir (ONCE)
# ══════════════════════════════════════════════════════════════════
_p6_start=$(_ns)
VERIFY_TEMP=$(mktemp -d /tmp/ruflo-verify-XXXXX)
(cd "$VERIFY_TEMP" && echo '{"name":"ruflo-verify-test","version":"1.0.0","private":true}' > package.json \
  && echo "registry=http://localhost:${RQ_PORT}" > .npmrc \
  && npm install @sparkleideas/cli @sparkleideas/agent-booster @sparkleideas/plugins \
     --registry "http://localhost:${RQ_PORT}" \
     --ignore-scripts --no-audit --no-fund 2>&1) || {
  log_error "Failed to install packages"
  exit 1
}
log "Packages installed to ${VERIFY_TEMP}"
_record_phase "npm-install" "$(_elapsed_ms "$_p6_start" "$(_ns)")"

# ══════════════════════════════════════════════════════════════════
# Phase 7: Structural checks (from test-integration.sh Phase 7)
# ══════════════════════════════════════════════════════════════════
_p7_start=$(_ns)
structural_fail=0

# S-1: CLI in node_modules
if [[ -d "${VERIFY_TEMP}/node_modules/@sparkleideas/cli" ]]; then
  log "  PASS  S-1: @sparkleideas/cli in node_modules"
else
  log "  FAIL  S-1: @sparkleideas/cli not found in node_modules"
  structural_fail=$((structural_fail + 1))
fi

# S-2: ADR-0022 packages available on Verdaccio
for new_pkg in "@sparkleideas/agent-booster" "@sparkleideas/plugins" "@sparkleideas/ruvector-upstream"; do
  if npm view "$new_pkg" version --registry "http://localhost:${RQ_PORT}" >/dev/null 2>&1; then
    log "  PASS  S-2: ADR-0022 package available: $new_pkg"
  else
    log "  WARN  S-2: ADR-0022 package not published: $new_pkg"
    # ruvector-upstream is optional — don't count as failure
    [[ "$new_pkg" != *"ruvector-upstream"* ]] && structural_fail=$((structural_fail + 1))
  fi
done

# S-3: npm ls clean (no MISSING deps)
missing_deps=$(cd "${VERIFY_TEMP}" && npm ls --all 2>&1 | grep 'MISSING' || true)
if [[ -n "$missing_deps" ]]; then
  log "  WARN  S-3: Missing dependencies detected:"
  echo "$missing_deps" | head -10 | while IFS= read -r line; do
    log "        $line"
  done
else
  log "  PASS  S-3: All dependencies resolved"
fi
_record_phase "structural-checks" "$(_elapsed_ms "$_p7_start" "$(_ns)")"

if [[ $structural_fail -gt 0 ]]; then
  log_error "Structural checks failed ($structural_fail failures)"
  exit 1
fi

# ══════════════════════════════════════════════════════════════════
# Phase 8: Functional checks (RQ-1..RQ-14)
# ══════════════════════════════════════════════════════════════════
_p8_start=$(_ns)
checks_lib="${PROJECT_DIR}/lib/acceptance-checks.sh"
if [[ ! -f "$checks_lib" ]]; then
  log_error "Shared test library not found: $checks_lib"
  exit 1
fi
# shellcheck source=../lib/acceptance-checks.sh
source "$checks_lib"

# Set environment for shared checks
REGISTRY="http://localhost:${RQ_PORT}"
PKG="@sparkleideas/cli"
RUFLO_WRAPPER_PKG="@sparkleideas/ruflo@latest"
TEMP_DIR="$VERIFY_TEMP"

# Persistent npx cache for external deps (ADR-0025).
# Isolated from ~/.npm to avoid stale metadata, NOT deleted on exit
# so external deps (better-sqlite3, onnxruntime) stay cached.
RQ_NPX_CACHE="/tmp/ruflo-rq-npxcache"
mkdir -p "$RQ_NPX_CACHE"
# Clear @sparkleideas entries from persistent cache
find "$RQ_NPX_CACHE/_npx" -path "*/@sparkleideas" -type d -exec rm -rf {} + 2>/dev/null || true
if [[ "$CHANGED_PACKAGES" == "all" || "$CHANGED_PACKAGES" == "[]" ]]; then
  grep -rl "sparkleideas" "$RQ_NPX_CACHE/_cacache/index-v5/" 2>/dev/null | xargs rm -f 2>/dev/null || true
else
  for pkg in $(echo "$CHANGED_PACKAGES" | node -e "
    JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'))
      .forEach(p => console.log(p.replace('@sparkleideas/','')))
  " 2>/dev/null); do
    grep -rl "\"@sparkleideas/${pkg}\"" "$RQ_NPX_CACHE/_cacache/index-v5/" 2>/dev/null \
      | xargs rm -f 2>/dev/null || true
  done
fi
export NPM_CONFIG_CACHE="$RQ_NPX_CACHE"

# Define run_timed for the shared library
run_timed() {
  local t_start t_end
  t_start=$(date +%s%N 2>/dev/null || echo 0)
  _OUT="$(timeout 30 bash -c "$*" 2>&1)" || true
  _EXIT=${PIPESTATUS[0]:-$?}
  t_end=$(date +%s%N 2>/dev/null || echo 0)
  if [[ "$t_start" == "0" || "$t_end" == "0" ]]; then
    _DURATION_MS=0
  else
    _DURATION_MS=$(( (t_end - t_start) / 1000000 ))
  fi
}

# ── RQ result tracking ────────────────────────────────────────────
rq_pass=0
rq_fail=0
rq_total=0
rq_results_json="[]"
rq_timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

run_rq_check() {
  local id="$1" name="$2" fn="$3"
  rq_total=$((rq_total + 1))
  log "  RQ $id: $name..."
  local rq_start_ns rq_end_ns rq_dur_ms=0
  rq_start_ns=$(date +%s%N 2>/dev/null || echo 0)
  "$fn"
  rq_end_ns=$(date +%s%N 2>/dev/null || echo 0)
  if [[ "$rq_start_ns" != "0" && "$rq_end_ns" != "0" ]]; then
    rq_dur_ms=$(( (rq_end_ns - rq_start_ns) / 1000000 ))
  fi
  if [[ $rq_dur_ms -gt 15000 ]]; then
    log "  SLOW  $id: ${rq_dur_ms}ms (threshold: 15000ms)"
  fi
  local rq_passed_bool="false"
  if [[ "$_CHECK_PASSED" == "true" ]]; then
    rq_pass=$((rq_pass + 1))
    rq_passed_bool="true"
    log "  PASS  $id: $name (${rq_dur_ms}ms)"
  else
    rq_fail=$((rq_fail + 1))
    log "  FAIL  $id: $name (${rq_dur_ms}ms)"
    echo "${_CHECK_OUTPUT:-}" | head -3 | while IFS= read -r line; do
      log "        $line"
    done
  fi
  # Escape output for JSON
  local rq_escaped_output
  rq_escaped_output=$(printf '%s' "${_CHECK_OUTPUT:-${_OUT:-}}" | head -c 4096 | python3 -c '
import sys, json
data = sys.stdin.read()
print(json.dumps(data), end="")
' 2>/dev/null || echo '""')

  local rq_entry
  rq_entry=$(printf '{"id":"%s","name":"%s","passed":%s,"output":%s,"duration_ms":%d}' \
    "$id" "$name" "$rq_passed_bool" "$rq_escaped_output" "$rq_dur_ms")
  if [[ "$rq_results_json" == "[]" ]]; then
    rq_results_json="[$rq_entry]"
  else
    rq_results_json="${rq_results_json%]}, $rq_entry]"
  fi
}

# Sequential: RQ-1 and RQ-2 must run first (RQ-2 creates init state)
run_rq_check "RQ-1"  "Version check"       check_version
run_rq_check "RQ-2"  "Init"                check_init

# Parallel: RQ-3..RQ-14 are independent
RQ_PARALLEL_DIR=$(mktemp -d /tmp/ruflo-verify-parallel-XXXXX)
RQ_BG_PIDS=()

run_rq_check_bg() {
  local id="$1" name="$2" fn="$3"
  (
    local rq_start_ns rq_end_ns rq_dur_ms=0
    rq_start_ns=$(date +%s%N 2>/dev/null || echo 0)
    "$fn"
    rq_end_ns=$(date +%s%N 2>/dev/null || echo 0)
    if [[ "$rq_start_ns" != "0" && "$rq_end_ns" != "0" ]]; then
      rq_dur_ms=$(( (rq_end_ns - rq_start_ns) / 1000000 ))
    fi
    local rq_escaped_output
    rq_escaped_output=$(printf '%s' "${_CHECK_OUTPUT:-${_OUT:-}}" | head -c 4096 | python3 -c '
import sys, json
data = sys.stdin.read()
print(json.dumps(data), end="")
' 2>/dev/null || echo '""')
    echo "${_CHECK_PASSED}|${rq_dur_ms}|${rq_escaped_output}" > "${RQ_PARALLEL_DIR}/${id}"
  ) &
  RQ_BG_PIDS+=($!)
}

run_rq_check_bg "RQ-3"  "Settings file"       check_settings_file
run_rq_check_bg "RQ-4"  "Scope check"         check_scope
run_rq_check_bg "RQ-5"  "Doctor"              check_doctor
run_rq_check_bg "RQ-6"  "MCP config"          check_mcp_config
run_rq_check_bg "RQ-7"  "Wrapper proxy"       check_wrapper_proxy
run_rq_check_bg "RQ-8"  "Memory lifecycle"    check_memory_lifecycle
run_rq_check_bg "RQ-9"  "Neural training"     check_neural_training
run_rq_check_bg "RQ-10" "Agent Booster ESM"   check_agent_booster_esm
run_rq_check_bg "RQ-11" "Agent Booster CLI"   check_agent_booster_bin
run_rq_check_bg "RQ-12" "Plugins SDK"         check_plugins_sdk
run_rq_check_bg "RQ-13" "@latest resolves"    check_latest_resolves
run_rq_check_bg "RQ-14" "ruflo init --full"   check_ruflo_init_full

# Wait only for RQ check PIDs, not the global timeout subprocess
wait "${RQ_BG_PIDS[@]}"

# Collect parallel results in order
for id in RQ-3 RQ-4 RQ-5 RQ-6 RQ-7 RQ-8 RQ-9 RQ-10 RQ-11 RQ-12 RQ-13 RQ-14; do
  result_file="${RQ_PARALLEL_DIR}/${id}"
  rq_total=$((rq_total + 1))
  if [[ -f "$result_file" ]]; then
    IFS='|' read -r passed dur_ms escaped_output < "$result_file"
    name_map=""
    case "$id" in
      RQ-3)  name_map="Settings file";;     RQ-4)  name_map="Scope check";;
      RQ-5)  name_map="Doctor";;             RQ-6)  name_map="MCP config";;
      RQ-7)  name_map="Wrapper proxy";;      RQ-8)  name_map="Memory lifecycle";;
      RQ-9)  name_map="Neural training";;    RQ-10) name_map="Agent Booster ESM";;
      RQ-11) name_map="Agent Booster CLI";;  RQ-12) name_map="Plugins SDK";;
      RQ-13) name_map="@latest resolves";;   RQ-14) name_map="ruflo init --full";;
    esac
    rq_passed_bool="false"
    if [[ "$passed" == "true" ]]; then
      rq_pass=$((rq_pass + 1))
      rq_passed_bool="true"
      log "  PASS  $id: $name_map (${dur_ms:-0}ms)"
    else
      rq_fail=$((rq_fail + 1))
      log "  FAIL  $id: $name_map (${dur_ms:-0}ms)"
    fi
    if [[ "${dur_ms:-0}" -gt 15000 ]]; then
      log "  SLOW  $id: ${dur_ms}ms (threshold: 15000ms)"
    fi
    rq_entry=$(printf '{"id":"%s","name":"%s","passed":%s,"output":%s,"duration_ms":%d}' \
      "$id" "$name_map" "$rq_passed_bool" "${escaped_output:-\"\"}" "${dur_ms:-0}")
    if [[ "$rq_results_json" == "[]" ]]; then
      rq_results_json="[$rq_entry]"
    else
      rq_results_json="${rq_results_json%]}, $rq_entry]"
    fi
  else
    rq_fail=$((rq_fail + 1))
    log "  FAIL  $id: (no result file — subprocess crashed)"
  fi
done
rm -rf "$RQ_PARALLEL_DIR"
RQ_PARALLEL_DIR=""

_record_phase "rq-checks" "$(_elapsed_ms "$_p8_start" "$(_ns)")"
log "Verification: ${rq_pass}/${rq_total} passed, ${rq_fail} failed"

# ══════════════════════════════════════════════════════════════════
# Phase 9: Promote to @latest (Verdaccio only)
# ══════════════════════════════════════════════════════════════════
_p9_start=$(_ns)
_promote_count=0
if [[ "${SKIP_PROMOTE}" != "true" ]]; then
  log "Promoting packages to @latest on Verdaccio..."
  for pkg_dir in "${RQ_STORAGE}/@sparkleideas"/*/; do
    [[ -d "$pkg_dir" ]] || continue
    pkg_name="@sparkleideas/$(basename "$pkg_dir")"
    latest_ver=$(npm view "${pkg_name}" version --registry "http://localhost:${RQ_PORT}" 2>/dev/null) || continue
    [[ -z "$latest_ver" ]] && continue
    npm dist-tag add "${pkg_name}@${latest_ver}" latest \
      --registry "http://localhost:${RQ_PORT}" 2>/dev/null && \
      { log "  ${pkg_name}@${latest_ver} -> @latest"; _promote_count=$((_promote_count + 1)); } || true
  done
  log "Promote complete (${_promote_count} packages)"
fi
_record_phase "promote" "$(_elapsed_ms "$_p9_start" "$(_ns)")"

# ══════════════════════════════════════════════════════════════════
# Phase 10: Write results
# ══════════════════════════════════════════════════════════════════
_p10_start=$(_ns)
verify_results_dir="${PROJECT_DIR}/test-results/verify-${rq_timestamp//:/}"
mkdir -p "$verify_results_dir"

_promoted="true"
[[ "${SKIP_PROMOTE}" == "true" ]] && _promoted="false"
_structural_pass="true"
[[ $structural_fail -gt 0 ]] && _structural_pass="false"

cat > "$verify_results_dir/verify-results.json" <<VJSONEOF
{
  "timestamp": "$rq_timestamp",
  "layer": 2,
  "registry": "http://localhost:${RQ_PORT}",
  "total": $rq_total,
  "passed": $rq_pass,
  "failed": $rq_fail,
  "structural_passed": ${_structural_pass},
  "promoted": ${_promoted},
  "results": $rq_results_json
}
VJSONEOF
log "Results written to ${verify_results_dir}/verify-results.json"
_record_phase "write-results" "$(_elapsed_ms "$_p10_start" "$(_ns)")"

# ══════════════════════════════════════════════════════════════════
# Timing summary
# ══════════════════════════════════════════════════════════════════
verify_end_ns=$(_ns)
verify_total_ms=$(_elapsed_ms "$verify_start_ns" "$verify_end_ns")
verify_end_s=$(date +%s)

log "──────────────────────────────────────────"
log "Verify phase timing summary:"
for entry in $VERIFY_PHASE_TIMINGS; do
  _name="${entry%%:*}"
  _ms="${entry##*:}"
  # compute percentage of total
  if [[ $verify_total_ms -gt 0 ]]; then
    _pct=$(( (_ms * 100) / verify_total_ms ))
  else
    _pct=0
  fi
  if [[ $_ms -ge 1000 ]]; then
    log "  $(printf '%-22s %6dms (%3ds) %3d%%' "$_name" "$_ms" "$((_ms / 1000))" "$_pct")"
  else
    log "  $(printf '%-22s %6dms        %3d%%' "$_name" "$_ms" "$_pct")"
  fi
done
log "  $(printf '%-22s %6dms (%3ds)' 'TOTAL' "$verify_total_ms" "$(( verify_end_s - verify_start_s ))")"
log "──────────────────────────────────────────"

# Write timing data for parent pipeline to ingest
printf '{"phase":"TOTAL","duration_ms":%d}\n' "$verify_total_ms" >> "$VERIFY_TIMING_FILE"

exit "$rq_fail"
