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
# Close fd 9 (flock) so orphaned timeout process cannot hold the pipeline lock
( exec 9>&- 2>/dev/null; sleep 180; log_error "[TIMEOUT] test-verify.sh exceeded 180s — sending SIGTERM"; kill -TERM -$$ 2>/dev/null || kill -TERM $$ 2>/dev/null || true; sleep 5; kill -KILL -$$ 2>/dev/null || kill -KILL $$ 2>/dev/null || true ) &
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
rq_timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
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

# Always publish ALL packages to Verdaccio (not just changed ones).
# Acceptance checks need every package available. Incremental publish
# breaks tests when unchanged packages aren't on Verdaccio.
publish_args=(--no-rate-limit --no-save)
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
# D4: Skip slow grep _cacache scan — use --prefer-offline on install instead
# ══════════════════════════════════════════════════════════════════
_p5_start=$(_ns)
# Clear _npx/ resolution trees so npx picks up fresh versions
find "${HOME}/.npm/_npx" -path "*/@sparkleideas" -type d -exec rm -rf {} + 2>/dev/null || true
_p5a_ms=$(_elapsed_ms "$_p5_start" "$(_ns)")
log "  npx tree clear: ${_p5a_ms}ms (cacache skipped — using --prefer-offline)"
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
     --prefer-offline --ignore-scripts --no-audit --no-fund 2>&1) || {
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
_s1_start=$(_ns)
if [[ -d "${VERIFY_TEMP}/node_modules/@sparkleideas/cli" ]]; then
  log "  PASS  S-1: @sparkleideas/cli in node_modules ($(_elapsed_ms "$_s1_start" "$(_ns)")ms)"
else
  log "  FAIL  S-1: @sparkleideas/cli not found in node_modules ($(_elapsed_ms "$_s1_start" "$(_ns)")ms)"
  structural_fail=$((structural_fail + 1))
fi

# S-2: ADR-0022 packages available on Verdaccio
# In incremental mode, not all packages are published — only count as failure
# if the package was in the publish set or if running in full mode
for new_pkg in "@sparkleideas/agent-booster" "@sparkleideas/plugins" "@sparkleideas/ruvector-upstream"; do
  _s2_start=$(_ns)
  if npm view "$new_pkg" version --registry "http://localhost:${RQ_PORT}" >/dev/null 2>&1; then
    log "  PASS  S-2: $new_pkg ($(_elapsed_ms "$_s2_start" "$(_ns)")ms)"
  else
    log "  WARN  S-2: $new_pkg not published ($(_elapsed_ms "$_s2_start" "$(_ns)")ms)"
    # Only fail if we published ALL packages (full mode) — in incremental mode
    # unchanged packages may not be on Verdaccio yet
    if [[ "$CHANGED_PACKAGES" == "all" ]]; then
      [[ "$new_pkg" != *"ruvector-upstream"* ]] && structural_fail=$((structural_fail + 1))
    fi
  fi
done

# S-3: npm ls clean (no MISSING deps)
_s3_start=$(_ns)
missing_deps=$(cd "${VERIFY_TEMP}" && npm ls --all 2>&1 | grep 'MISSING' || true)
_s3_ms=$(_elapsed_ms "$_s3_start" "$(_ns)")
if [[ -n "$missing_deps" ]]; then
  log "  WARN  S-3: Missing dependencies detected (${_s3_ms}ms):"
  echo "$missing_deps" | head -10 | while IFS= read -r line; do
    log "        $line"
  done
else
  log "  PASS  S-3: All dependencies resolved (${_s3_ms}ms)"
fi
_record_phase "structural-checks" "$(_elapsed_ms "$_p7_start" "$(_ns)")"

if [[ $structural_fail -gt 0 ]]; then
  log_error "Structural checks failed ($structural_fail failures)"
  exit 1
fi

# ══════════════════════════════════════════════════════════════════
# Phase 8: Acceptance checks (inline, grouped parallel execution)
#
# Sources lib/acceptance-checks.sh and runs checks directly, avoiding
# the overhead of shelling out to test-acceptance.sh (which would
# duplicate the install, structural checks, and promote steps).
#
# Groups:
#   1. Smoke: T01-T03 (version, @latest, broken versions) — parallel
#   2. Init/Config: T04 sequential, then T05-T07 parallel
#   3-5. All remaining T08-T16 overlapped in parallel
# ══════════════════════════════════════════════════════════════════
_p8_start=$(_ns)
log "Running acceptance checks (inline)..."

# Source shared check library
checks_lib="${PROJECT_DIR}/lib/acceptance-checks.sh"
[[ -f "$checks_lib" ]] || { log_error "Missing: $checks_lib"; exit 1; }
source "$checks_lib"

# Set up variables expected by the check functions
PKG="@sparkleideas/cli"
RUFLO_WRAPPER_PKG="@sparkleideas/ruflo@latest"
TEMP_DIR="$VERIFY_TEMP"
REGISTRY="http://localhost:${RQ_PORT}"

# Persistent npx cache (ADR-0025)
NPX_CACHE="/tmp/ruflo-verify-npxcache"
mkdir -p "$NPX_CACHE"
find "$NPX_CACHE/_npx" -path "*/@sparkleideas" -type d -exec rm -rf {} + 2>/dev/null || true
export NPM_CONFIG_CACHE="$NPX_CACHE"

run_timed() {
  local t_start t_end
  t_start=$(date +%s%N 2>/dev/null || echo 0)
  # Use --signal=KILL to force-kill hung processes (CLI keeps SQLite handles open)
  _OUT="$(timeout --signal=KILL 60 bash -c "$*" 2>&1)" || true
  _EXIT=${PIPESTATUS[0]:-$?}
  t_end=$(date +%s%N 2>/dev/null || echo 0)
  [[ "$t_start" == "0" || "$t_end" == "0" ]] && _DURATION_MS=0 || _DURATION_MS=$(( (t_end - t_start) / 1000000 ))
}

# ── Result tracking ──────────────────────────────────────────────
rq_pass=0
rq_fail=0
rq_total=0
rq_results_json="[]"

_escape_json() {
  # Pure bash JSON escaping — avoids spawning Python subprocess per check (~2-3s total saving)
  local s="${1:-}"
  s="${s:0:4096}"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '"%s"' "$s"
}

run_check() {
  local id="$1" name="$2" fn="$3" group="$4"
  rq_total=$((rq_total + 1))
  local c_start c_end c_ms=0
  c_start=$(_ns)
  "$fn"
  c_end=$(_ns)
  c_ms=$(_elapsed_ms "$c_start" "$c_end")

  local passed_bool="false"
  if [[ "$_CHECK_PASSED" == "true" ]]; then
    rq_pass=$((rq_pass + 1)); passed_bool="true"
    log "  PASS  ${id}: ${name} (${c_ms}ms)"
  else
    rq_fail=$((rq_fail + 1))
    log "  FAIL  ${id}: ${name} (${c_ms}ms)"
    echo "${_CHECK_OUTPUT:-}" | head -3 | while IFS= read -r line; do log "        $line"; done
  fi
  [[ $c_ms -gt 15000 ]] && log "  SLOW  ${id}: ${c_ms}ms"

  local escaped; escaped=$(_escape_json "${_CHECK_OUTPUT:-${_OUT:-}}")
  local entry; entry=$(printf '{"id":"%s","name":"%s","group":"%s","passed":%s,"output":%s,"duration_ms":%d}' \
    "$id" "$name" "$group" "$passed_bool" "$escaped" "$c_ms")
  [[ "$rq_results_json" == "[]" ]] && rq_results_json="[$entry]" || rq_results_json="${rq_results_json%]}, $entry]"
}

RQ_PARALLEL_DIR=$(mktemp -d /tmp/ruflo-verify-par-XXXXX)
BG_PIDS=()

run_check_bg() {
  local id="$1" name="$2" fn="$3" group="$4"
  (
    local c_start c_end c_ms=0
    c_start=$(_ns)
    "$fn"
    c_end=$(_ns)
    c_ms=$(_elapsed_ms "$c_start" "$c_end")
    local escaped; escaped=$(_escape_json "${_CHECK_OUTPUT:-${_OUT:-}}")
    echo "${_CHECK_PASSED}|${c_ms}|${escaped}" > "${RQ_PARALLEL_DIR}/${id}"
  ) &
  BG_PIDS+=($!)
}

collect_parallel() {
  local group="$1"; shift
  wait "${BG_PIDS[@]}"
  BG_PIDS=()
  for spec in "$@"; do
    local id="${spec%%|*}" name="${spec#*|}"
    rq_total=$((rq_total + 1))
    local result_file="${RQ_PARALLEL_DIR}/${id}"
    if [[ -f "$result_file" ]]; then
      IFS='|' read -r passed dur_ms escaped_output < "$result_file"
      local passed_bool="false"
      if [[ "$passed" == "true" ]]; then
        rq_pass=$((rq_pass + 1)); passed_bool="true"
        log "  PASS  ${id}: ${name} (${dur_ms:-0}ms)"
      else
        rq_fail=$((rq_fail + 1))
        log "  FAIL  ${id}: ${name} (${dur_ms:-0}ms)"
      fi
      [[ "${dur_ms:-0}" -gt 15000 ]] && log "  SLOW  ${id}: ${dur_ms}ms"
      local entry; entry=$(printf '{"id":"%s","name":"%s","group":"%s","passed":%s,"output":%s,"duration_ms":%d}' \
        "$id" "$name" "$group" "$passed_bool" "${escaped_output:-\"\"}" "${dur_ms:-0}")
      [[ "$rq_results_json" == "[]" ]] && rq_results_json="[$entry]" || rq_results_json="${rq_results_json%]}, $entry]"
    else
      rq_fail=$((rq_fail + 1))
      log "  FAIL  ${id}: ${name} (subprocess crashed)"
    fi
  done
  for spec in "$@"; do
    local id="${spec%%|*}"
    rm -f "${RQ_PARALLEL_DIR}/${id}"
  done
}

# Registry-specific checks (not in shared lib)
check_no_broken_versions() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  local resolved
  resolved=$(NPM_CONFIG_REGISTRY="$REGISTRY" npm view @sparkleideas/cli@latest version 2>/dev/null) || true
  if [[ -n "$resolved" ]]; then
    local has_bin
    has_bin=$(NPM_CONFIG_REGISTRY="$REGISTRY" npm view "@sparkleideas/cli@${resolved}" bin --json 2>/dev/null) || true
    if [[ -n "$has_bin" && "$has_bin" != "{}" ]]; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="cli@latest = $resolved (has bin)"
    else
      _CHECK_OUTPUT="cli@latest = $resolved (no bin entries — broken)"
    fi
  else
    _CHECK_OUTPUT="cli@latest did not resolve"
  fi
  end_ns=$(_ns)
  _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

check_plugin_install() {
  local cli; cli=$(_cli_cmd)
  run_timed "cd '$TEMP_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli plugins install --name @sparkleideas/plugin-prime-radiant"
  _CHECK_PASSED="false"
  _CHECK_OUTPUT="$_OUT"
  if [[ $_EXIT -eq 0 ]] && echo "$_OUT" | grep -qi 'install\|success\|prime-radiant'; then
    _CHECK_PASSED="true"
  fi
}

# ── Group 1: Smoke (parallel — all independent) ──
log "── Group 1: Smoke ──"
run_check_bg "T01" "Version check"          check_version            "smoke"
run_check_bg "T02" "@latest resolves"       check_latest_resolves    "smoke"
run_check_bg "T03" "No broken versions"     check_no_broken_versions "smoke"
collect_parallel "smoke" \
  "T01|Version check" "T02|@latest resolves" "T03|No broken versions"

# ── Group 2: Init & Config (init first, then config checks parallel) ──
log "── Group 2: Init & Config ──"
run_check "T04" "Init"                   check_init               "init-config"

run_check_bg "T05" "Settings file"       check_settings_file      "init-config"
run_check_bg "T06" "Scope check"         check_scope              "init-config"
run_check_bg "T07" "MCP config"          check_mcp_config         "init-config"
collect_parallel "init-config" \
  "T05|Settings file" "T06|Scope check" "T07|MCP config"

# ── Groups 3-5 + long-running (all overlapped) ──
log "── Groups 3-5 + long-running (overlapped) ──"
run_check_bg "T08" "ruflo init --full"   check_ruflo_init_full    "init-config"
run_check_bg "T09" "Doctor"              check_doctor             "diagnostics"
run_check_bg "T10" "Wrapper proxy"       check_wrapper_proxy      "diagnostics"
run_check_bg "T11" "Memory lifecycle"    check_memory_lifecycle   "data-ml"
run_check_bg "T12" "Neural training"     check_neural_training    "data-ml"
run_check_bg "T13" "Agent Booster ESM"   check_agent_booster_esm  "packages"
run_check_bg "T14" "Agent Booster CLI"   check_agent_booster_bin  "packages"
run_check_bg "T15" "Plugins SDK"         check_plugins_sdk        "packages"
run_check_bg "T16" "Plugin install"      check_plugin_install     "packages"
collect_parallel "all" \
  "T08|ruflo init --full" "T09|Doctor" "T10|Wrapper proxy" \
  "T11|Memory lifecycle" "T12|Neural training" \
  "T13|Agent Booster ESM" "T14|Agent Booster CLI" "T15|Plugins SDK" "T16|Plugin install"
rm -rf "$RQ_PARALLEL_DIR"; RQ_PARALLEL_DIR=""

log "Acceptance results: ${rq_pass}/$((rq_pass + rq_fail)) passed, ${rq_fail} failed"

_record_phase "acceptance-checks" "$(_elapsed_ms "$_p8_start" "$(_ns)")"

# ══════════════════════════════════════════════════════════════════
# Phase 9: Promote to @latest (Verdaccio only)
# ══════════════════════════════════════════════════════════════════
_p9_start=$(_ns)
_promote_count=0
if [[ "${SKIP_PROMOTE}" != "true" ]]; then
  log "Promoting packages to @latest on Verdaccio (parallel)..."
  _prom_pids=()
  _prom_count=0
  for pkg_dir in "${RQ_STORAGE}/@sparkleideas"/*/; do
    [[ -d "$pkg_dir" ]] || continue
    pkg_name="@sparkleideas/$(basename "$pkg_dir")"
    (
      latest_ver=$(npm view "${pkg_name}" version --registry "http://localhost:${RQ_PORT}" 2>/dev/null) || exit 0
      [[ -z "$latest_ver" ]] && exit 0
      npm dist-tag add "${pkg_name}@${latest_ver}" latest \
        --registry "http://localhost:${RQ_PORT}" 2>/dev/null || true
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
