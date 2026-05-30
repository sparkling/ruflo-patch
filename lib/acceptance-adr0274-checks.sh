#!/usr/bin/env bash
# lib/acceptance-adr0274-checks.sh — ADR-0274 RVF read/write handle split
# (resolves the re-opened ADR-0267).
#
# Runs scripts/smoke-adr0274-rvf-rw-split.mjs: starts an MCP server, drives a
# tools/call to force RVF warmup (flock acquire), then proves a concurrent CLI
# `memory store` from a separate process succeeds (no LockHeld, no 30s hang) —
# the discriminating case the adr0267 smoke misses (it never warms up). Reuses
# the main ACCEPT_TEMP install via ADR0255_SMOKE_SHARED_TEMP — no per-ADR install.

if ! declare -f _ns >/dev/null 2>&1; then
  _ns() { date +%s%N 2>/dev/null || echo $(( $(date +%s) * 1000000000 )); }
fi
if ! declare -f _elapsed_ms >/dev/null 2>&1; then
  _elapsed_ms() { echo $(( ( ${2:-0} - ${1:-0} ) / 1000000 )); }
fi

check_adr0274_rvf_rw_split() {
  local start_ns end_ns log_path rc
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  log_path=$(mktemp -t "adr0274-rvf-rw-split-XXXXXX.log")

  if [[ ! -f "${PROJECT_DIR}/scripts/smoke-adr0274-rvf-rw-split.mjs" ]]; then
    _CHECK_OUTPUT="missing: scripts/smoke-adr0274-rvf-rw-split.mjs"
    end_ns=$(_ns); _EXIT=2; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  node "${PROJECT_DIR}/scripts/smoke-adr0274-rvf-rw-split.mjs" > "${log_path}" 2>&1
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
