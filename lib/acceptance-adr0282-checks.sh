#!/usr/bin/env bash
# lib/acceptance-adr0282-checks.sh — three agentdb-CLI-surface honesty fixes
# found during the ADR-0281 index remediation:
#   ADR-0282  agentdb_hierarchical-query honors an explicit `limit` (was clamped to MAX_TOP_K=100)
#   ADR-0276  agentdb_causal-edge-delete clears the KV dual-write copy (was leaving a router-fallback residual)
#   ADR-0273  agentdb index --dry-run does not mutate (kebab flag never read → --dry-run wrote)
#
# Runs scripts/smoke-adr0282-agentdb-surface-fixes.mjs. FAILs pre-impl, PASSes
# after the fixes land. Reuses the main ACCEPT_TEMP install via ADR0255_SMOKE_SHARED_TEMP.

if ! declare -f _ns >/dev/null 2>&1; then
  _ns() { date +%s%N 2>/dev/null || echo $(( $(date +%s) * 1000000000 )); }
fi
if ! declare -f _elapsed_ms >/dev/null 2>&1; then
  _elapsed_ms() { echo $(( ( ${2:-0} - ${1:-0} ) / 1000000 )); }
fi

check_adr0282_agentdb_surface_fixes() {
  local start_ns end_ns log_path rc
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  log_path=$(mktemp -t "adr0282-agentdb-surface-fixes-XXXXXX.log")

  if [[ ! -f "${PROJECT_DIR}/scripts/smoke-adr0282-agentdb-surface-fixes.mjs" ]]; then
    _CHECK_OUTPUT="missing: scripts/smoke-adr0282-agentdb-surface-fixes.mjs"
    end_ns=$(_ns); _EXIT=2; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  node "${PROJECT_DIR}/scripts/smoke-adr0282-agentdb-surface-fixes.mjs" > "${log_path}" 2>&1
  rc=$?

  end_ns=$(_ns)
  _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns")
  _EXIT=$rc
  _OUT="exit=${rc} log=${log_path} (tail -40: $(tail -40 "${log_path}" 2>/dev/null | tr '\n' ' ' | head -c 400))"
  _CHECK_OUTPUT="$_OUT"

  if [[ $rc -eq 0 ]]; then
    _CHECK_PASSED="true"
  fi
}
