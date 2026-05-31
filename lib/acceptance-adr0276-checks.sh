#!/usr/bin/env bash
# lib/acceptance-adr0276-checks.sh — ADR-0276 re-converge ADR causal edges onto
# upstream's CausalMemoryGraph controller.
#
# Runs scripts/smoke-adr0276-controller-causal.mjs: builds a synthetic ADR index
# (agentdb index) alongside a live MCP server, then proves the SQLite
# CausalMemoryGraph CONTROLLER (not the KV `router-fallback`) answers ADR causal
# queries — inbound edges with controller='causalGraph', a 2-hop chain, a
# cascade-delete that removes incident edges, and a string→numeric ID map that
# round-trips. FAILs pre-impl (router-fallback / native-unsupported cascade / no
# numeric map), PASSes after ADR-0276 R1-R5 land. Reuses the main ACCEPT_TEMP
# install via ADR0255_SMOKE_SHARED_TEMP — no per-ADR install.

if ! declare -f _ns >/dev/null 2>&1; then
  _ns() { date +%s%N 2>/dev/null || echo $(( $(date +%s) * 1000000000 )); }
fi
if ! declare -f _elapsed_ms >/dev/null 2>&1; then
  _elapsed_ms() { echo $(( ( ${2:-0} - ${1:-0} ) / 1000000 )); }
fi

check_adr0276_controller_causal() {
  local start_ns end_ns log_path rc
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  log_path=$(mktemp -t "adr0276-controller-causal-XXXXXX.log")

  if [[ ! -f "${PROJECT_DIR}/scripts/smoke-adr0276-controller-causal.mjs" ]]; then
    _CHECK_OUTPUT="missing: scripts/smoke-adr0276-controller-causal.mjs"
    end_ns=$(_ns); _EXIT=2; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  node "${PROJECT_DIR}/scripts/smoke-adr0276-controller-causal.mjs" > "${log_path}" 2>&1
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
