#!/usr/bin/env bash
# scripts/test-acceptance.sh — Unified acceptance tests (ADR-0023 simplified)
#
# Assumes packages are already published to the registry (by publish.mjs or
# the deploy pipeline). Installs from the registry and runs 16 checks in
# 5 logical groups.
#
# Pipeline: build → unit tests → publish → acceptance tests
#
# Usage:
#   bash scripts/test-acceptance.sh [--registry <url>] [--skip-promote]
#
# Groups:
#   1. Smoke        — version, dist-tag, broken-version check (sequential, fast)
#   2. Init/Config  — init, settings, scope, MCP, ruflo init --full (init first, rest parallel)
#   3. Diagnostics  — doctor, wrapper proxy (parallel)
#   4. Data & ML    — memory lifecycle, neural training (parallel)
#   5. Packages     — agent-booster ESM/CLI, plugins SDK, plugin install (parallel)
#
# Exit code: number of failed checks (0 = all pass)
set -uo pipefail

# ── Defaults ────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

PORT=4873
REGISTRY="http://localhost:${PORT}"
SKIP_PROMOTE="false"
ACCEPT_TEMP=""

# ── Argument parsing ────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --registry)         REGISTRY="${2:-}"; shift 2 ;;
    --port)             PORT="${2:-4873}"; REGISTRY="http://localhost:${PORT}"; shift 2 ;;
    --skip-promote)     SKIP_PROMOTE="true"; shift ;;
    -h|--help)
      echo "Usage: bash scripts/test-acceptance.sh [options]"
      echo "  --registry <url>           Registry URL (default: http://localhost:4873)"
      echo "  --port <port>              Verdaccio port (default: 4873)"
      echo "  --skip-promote             Skip promoting packages to @latest"
      exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

# ── Logging ─────────────────────────────────────────────────────────
_ts() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log()       { echo "[$(_ts)] $*" >&2; }
log_error() { echo "[$(_ts)] ERROR: $*" >&2; }

# ── Timing helpers ──────────────────────────────────────────────────
_ns() { date +%s%N 2>/dev/null || echo 0; }
_elapsed_ms() {
  local s="$1" e="$2"
  if [[ "$s" != "0" && "$e" != "0" ]]; then echo $(( (e - s) / 1000000 )); else echo 0; fi
}

# Phase timing accumulator
PHASE_TIMINGS=""
TIMING_FILE="/tmp/ruflo-acceptance-timing.jsonl"
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

# ── Global timeout: 300s ────────────────────────────────────────────
( sleep 300; log_error "[TIMEOUT] test-acceptance.sh exceeded 300s"; kill -TERM -$$ 2>/dev/null || kill -TERM $$ 2>/dev/null || true; sleep 5; kill -KILL -$$ 2>/dev/null || kill -KILL $$ 2>/dev/null || true ) &
GLOBAL_TIMEOUT_PID=$!

# ── Cleanup ─────────────────────────────────────────────────────────
cleanup() {
  kill "$GLOBAL_TIMEOUT_PID" 2>/dev/null || true
  [[ -n "$ACCEPT_TEMP" && -d "$ACCEPT_TEMP" ]] && rm -rf "$ACCEPT_TEMP"
  [[ -n "${PARALLEL_DIR:-}" && -d "${PARALLEL_DIR:-}" ]] && rm -rf "$PARALLEL_DIR"
}
trap cleanup EXIT INT TERM

ACCEPT_START_NS=$(_ns)
ACCEPT_START_S=$(date +%s)
log "Acceptance tests starting"
log "  registry: ${REGISTRY}"

# ════════════════════════════════════════════════════════════════════
# Setup: health check → install
# ════════════════════════════════════════════════════════════════════

# Phase: Registry health check
_p=$(_ns)
if ! curl -sf "${REGISTRY}/-/ping" >/dev/null 2>&1; then
  log_error "Registry not reachable at ${REGISTRY}"
  exit 1
fi
_record_phase "health-check" "$(_elapsed_ms "$_p" "$(_ns)")"

# Phase: Clear stale npm cache entries
_p=$(_ns)
find "${HOME}/.npm/_npx" -path "*/@sparkleideas" -type d -exec rm -rf {} + 2>/dev/null || true
_record_phase "cache-clear" "$(_elapsed_ms "$_p" "$(_ns)")"

# Phase: Install packages from registry
_p=$(_ns)
ACCEPT_TEMP=$(mktemp -d /tmp/ruflo-accept-XXXXX)
(cd "$ACCEPT_TEMP" \
  && echo '{"name":"ruflo-accept-test","version":"1.0.0","private":true}' > package.json \
  && echo "registry=${REGISTRY}" > .npmrc \
  && npm install @sparkleideas/cli @sparkleideas/agent-booster @sparkleideas/plugins \
     --registry "$REGISTRY" --ignore-scripts --no-audit --no-fund 2>&1) || {
  log_error "Failed to install packages from ${REGISTRY}"; exit 1
}
_record_phase "install" "$(_elapsed_ms "$_p" "$(_ns)")"

# Phase: Structural checks
_p=$(_ns)
structural_fail=0
if [[ ! -d "${ACCEPT_TEMP}/node_modules/@sparkleideas/cli" ]]; then
  log "  FAIL  S-1: @sparkleideas/cli not in node_modules"
  structural_fail=$((structural_fail + 1))
else
  log "  PASS  S-1: @sparkleideas/cli installed"
fi
for pkg in "@sparkleideas/agent-booster" "@sparkleideas/plugins"; do
  if npm view "$pkg" version --registry "$REGISTRY" >/dev/null 2>&1; then
    log "  PASS  S-2: $pkg available"
  else
    log "  FAIL  S-2: $pkg not available"
    structural_fail=$((structural_fail + 1))
  fi
done
_record_phase "structural" "$(_elapsed_ms "$_p" "$(_ns)")"
if [[ $structural_fail -gt 0 ]]; then
  log_error "Structural checks failed ($structural_fail)"; exit 1
fi

# ════════════════════════════════════════════════════════════════════
# Source shared check library
# ════════════════════════════════════════════════════════════════════
checks_lib="${PROJECT_DIR}/lib/acceptance-checks.sh"
[[ -f "$checks_lib" ]] || { log_error "Missing: $checks_lib"; exit 1; }
source "$checks_lib"

# Set check environment
PKG="@sparkleideas/cli"
RUFLO_WRAPPER_PKG="@sparkleideas/ruflo@latest"
TEMP_DIR="$ACCEPT_TEMP"

# Persistent npx cache (ADR-0025)
NPX_CACHE="/tmp/ruflo-accept-npxcache"
mkdir -p "$NPX_CACHE"
find "$NPX_CACHE/_npx" -path "*/@sparkleideas" -type d -exec rm -rf {} + 2>/dev/null || true
export NPM_CONFIG_CACHE="$NPX_CACHE"

run_timed() {
  local t_start t_end
  t_start=$(date +%s%N 2>/dev/null || echo 0)
  _OUT="$(timeout 30 bash -c "$*" 2>&1)" || true
  _EXIT=${PIPESTATUS[0]:-$?}
  t_end=$(date +%s%N 2>/dev/null || echo 0)
  [[ "$t_start" == "0" || "$t_end" == "0" ]] && _DURATION_MS=0 || _DURATION_MS=$(( (t_end - t_start) / 1000000 ))
}

# ════════════════════════════════════════════════════════════════════
# Result tracking
# ════════════════════════════════════════════════════════════════════
pass_count=0
fail_count=0
total_count=0
results_json="[]"
timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

_escape_json() {
  printf '%s' "${1:-}" | head -c 4096 | python3 -c '
import sys, json
print(json.dumps(sys.stdin.read()), end="")
' 2>/dev/null || echo '""'
}

# Run a check sequentially, record result
run_check() {
  local id="$1" name="$2" fn="$3" group="$4"
  total_count=$((total_count + 1))
  local c_start c_end c_ms=0
  c_start=$(_ns)
  "$fn"
  c_end=$(_ns)
  c_ms=$(_elapsed_ms "$c_start" "$c_end")

  local passed_bool="false"
  if [[ "$_CHECK_PASSED" == "true" ]]; then
    pass_count=$((pass_count + 1)); passed_bool="true"
    log "  PASS  ${id}: ${name} (${c_ms}ms)"
  else
    fail_count=$((fail_count + 1))
    log "  FAIL  ${id}: ${name} (${c_ms}ms)"
    echo "${_CHECK_OUTPUT:-}" | head -3 | while IFS= read -r line; do log "        $line"; done
  fi
  [[ $c_ms -gt 15000 ]] && log "  SLOW  ${id}: ${c_ms}ms"

  local escaped; escaped=$(_escape_json "${_CHECK_OUTPUT:-${_OUT:-}}")
  local entry; entry=$(printf '{"id":"%s","name":"%s","group":"%s","passed":%s,"output":%s,"duration_ms":%d}' \
    "$id" "$name" "$group" "$passed_bool" "$escaped" "$c_ms")
  [[ "$results_json" == "[]" ]] && results_json="[$entry]" || results_json="${results_json%]}, $entry]"
}

# Run a check in background, write result to PARALLEL_DIR
PARALLEL_DIR=""
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
    echo "${_CHECK_PASSED}|${c_ms}|${escaped}" > "${PARALLEL_DIR}/${id}"
  ) &
  BG_PIDS+=($!)
}

# Collect parallel results
collect_parallel() {
  local group="$1"; shift
  wait "${BG_PIDS[@]}"
  BG_PIDS=()
  for spec in "$@"; do
    local id="${spec%%|*}" name="${spec#*|}"
    total_count=$((total_count + 1))
    local result_file="${PARALLEL_DIR}/${id}"
    if [[ -f "$result_file" ]]; then
      IFS='|' read -r passed dur_ms escaped_output < "$result_file"
      local passed_bool="false"
      if [[ "$passed" == "true" ]]; then
        pass_count=$((pass_count + 1)); passed_bool="true"
        log "  PASS  ${id}: ${name} (${dur_ms:-0}ms)"
      else
        fail_count=$((fail_count + 1))
        log "  FAIL  ${id}: ${name} (${dur_ms:-0}ms)"
      fi
      [[ "${dur_ms:-0}" -gt 15000 ]] && log "  SLOW  ${id}: ${dur_ms}ms"
      local entry; entry=$(printf '{"id":"%s","name":"%s","group":"%s","passed":%s,"output":%s,"duration_ms":%d}' \
        "$id" "$name" "$group" "$passed_bool" "${escaped_output:-\"\"}" "${dur_ms:-0}")
      [[ "$results_json" == "[]" ]] && results_json="[$entry]" || results_json="${results_json%]}, $entry]"
    else
      fail_count=$((fail_count + 1))
      log "  FAIL  ${id}: ${name} (subprocess crashed)"
    fi
  done
  rm -f "${PARALLEL_DIR}"/*
}

# ── Registry-specific checks (not in shared lib) ───────────────────

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

# ════════════════════════════════════════════════════════════════════
# Group 1: Smoke (sequential — fast gates)
# ════════════════════════════════════════════════════════════════════
_g=$(_ns)
log "── Group 1: Smoke ──"
run_check "T01" "Version check"          check_version            "smoke"
run_check "T02" "@latest resolves"       check_latest_resolves    "smoke"
run_check "T03" "No broken versions"     check_no_broken_versions "smoke"
_record_phase "group-smoke" "$(_elapsed_ms "$_g" "$(_ns)")"

# ════════════════════════════════════════════════════════════════════
# Group 2: Init & Config (init sequential, rest parallel)
# ════════════════════════════════════════════════════════════════════
_g=$(_ns)
log "── Group 2: Init & Config ──"
run_check "T04" "Init"                   check_init               "init-config"

PARALLEL_DIR=$(mktemp -d /tmp/ruflo-accept-par-XXXXX)
run_check_bg "T05" "Settings file"       check_settings_file      "init-config"
run_check_bg "T06" "Scope check"         check_scope              "init-config"
run_check_bg "T07" "MCP config"          check_mcp_config         "init-config"
run_check_bg "T08" "ruflo init --full"   check_ruflo_init_full    "init-config"
collect_parallel "init-config" \
  "T05|Settings file" "T06|Scope check" "T07|MCP config" "T08|ruflo init --full"
_record_phase "group-init-config" "$(_elapsed_ms "$_g" "$(_ns)")"

# ════════════════════════════════════════════════════════════════════
# Group 3: Diagnostics (parallel)
# ════════════════════════════════════════════════════════════════════
_g=$(_ns)
log "── Group 3: Diagnostics ──"
run_check_bg "T09" "Doctor"              check_doctor             "diagnostics"
run_check_bg "T10" "Wrapper proxy"       check_wrapper_proxy      "diagnostics"
collect_parallel "diagnostics" \
  "T09|Doctor" "T10|Wrapper proxy"
_record_phase "group-diagnostics" "$(_elapsed_ms "$_g" "$(_ns)")"

# ════════════════════════════════════════════════════════════════════
# Group 4: Data & ML (parallel)
# ════════════════════════════════════════════════════════════════════
_g=$(_ns)
log "── Group 4: Data & ML ──"
run_check_bg "T11" "Memory lifecycle"    check_memory_lifecycle   "data-ml"
run_check_bg "T12" "Neural training"     check_neural_training    "data-ml"
collect_parallel "data-ml" \
  "T11|Memory lifecycle" "T12|Neural training"
_record_phase "group-data-ml" "$(_elapsed_ms "$_g" "$(_ns)")"

# ════════════════════════════════════════════════════════════════════
# Group 5: Packages (parallel)
# ════════════════════════════════════════════════════════════════════
_g=$(_ns)
log "── Group 5: Packages ──"
run_check_bg "T13" "Agent Booster ESM"   check_agent_booster_esm  "packages"
run_check_bg "T14" "Agent Booster CLI"   check_agent_booster_bin  "packages"
run_check_bg "T15" "Plugins SDK"         check_plugins_sdk        "packages"
run_check_bg "T16" "Plugin install"      check_plugin_install     "packages"
collect_parallel "packages" \
  "T13|Agent Booster ESM" "T14|Agent Booster CLI" "T15|Plugins SDK" "T16|Plugin install"
_record_phase "group-packages" "$(_elapsed_ms "$_g" "$(_ns)")"
rm -rf "$PARALLEL_DIR"; PARALLEL_DIR=""

# ════════════════════════════════════════════════════════════════════
# Promote to @latest (local Verdaccio only)
# ════════════════════════════════════════════════════════════════════
_p=$(_ns)
RQ_STORAGE="/home/claude/.verdaccio/storage"
if [[ "${SKIP_PROMOTE}" != "true" && "$REGISTRY" == *"localhost"* ]]; then
  log "Promoting packages to @latest..."
  promote_count=0
  for pkg_dir in "${RQ_STORAGE}/@sparkleideas"/*/; do
    [[ -d "$pkg_dir" ]] || continue
    pkg_name="@sparkleideas/$(basename "$pkg_dir")"
    latest_ver=$(npm view "${pkg_name}" version --registry "$REGISTRY" 2>/dev/null) || continue
    [[ -z "$latest_ver" ]] && continue
    npm dist-tag add "${pkg_name}@${latest_ver}" latest --registry "$REGISTRY" 2>/dev/null && \
      promote_count=$((promote_count + 1)) || true
  done
  log "  Promoted ${promote_count} packages"
fi
_record_phase "promote" "$(_elapsed_ms "$_p" "$(_ns)")"

# ════════════════════════════════════════════════════════════════════
# Results
# ════════════════════════════════════════════════════════════════════
ACCEPT_END_NS=$(_ns)
ACCEPT_TOTAL_MS=$(_elapsed_ms "$ACCEPT_START_NS" "$ACCEPT_END_NS")
ACCEPT_END_S=$(date +%s)

results_dir="${PROJECT_DIR}/test-results/accept-${timestamp//:/}"
mkdir -p "$results_dir"

cat > "$results_dir/acceptance-results.json" <<JSONEOF
{
  "timestamp": "$timestamp",
  "registry": "$REGISTRY",
  "total_duration_ms": $ACCEPT_TOTAL_MS,
  "tests": $results_json,
  "summary": {
    "total": $total_count,
    "passed": $pass_count,
    "failed": $fail_count
  }
}
JSONEOF

# Timing summary
log ""
log "════════════════════════════════════════════"
log "Acceptance Results: ${pass_count}/${total_count} passed, ${fail_count} failed"
log "════════════════════════════════════════════"
log ""
log "Phase timing:"
for entry in $PHASE_TIMINGS; do
  _name="${entry%%:*}"; _ms="${entry##*:}"
  [[ $ACCEPT_TOTAL_MS -gt 0 ]] && _pct=$(( (_ms * 100) / ACCEPT_TOTAL_MS )) || _pct=0
  if [[ $_ms -ge 1000 ]]; then
    log "  $(printf '%-22s %6dms (%3ds) %3d%%' "$_name" "$_ms" "$((_ms / 1000))" "$_pct")"
  else
    log "  $(printf '%-22s %6dms        %3d%%' "$_name" "$_ms" "$_pct")"
  fi
done
log "  $(printf '%-22s %6dms (%3ds)' 'TOTAL' "$ACCEPT_TOTAL_MS" "$(( ACCEPT_END_S - ACCEPT_START_S ))")"
log "════════════════════════════════════════════"
log "Results: ${results_dir}/acceptance-results.json"

printf '{"phase":"TOTAL","duration_ms":%d}\n' "$ACCEPT_TOTAL_MS" >> "$TIMING_FILE"

exit "$fail_count"
