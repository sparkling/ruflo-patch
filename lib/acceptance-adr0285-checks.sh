#!/usr/bin/env bash
# lib/acceptance-adr0285-checks.sh — ADR-0285 repair the ADR-index causal +
# recall surfaces and complete `--purge`.
#
# Runs scripts/smoke-adr0285-causal-crud-and-purge.mjs against a LIVE MCP server
# (no stop — re-validates the ADR-0274/0284 concurrent-index promise). Asserts,
# end-to-end via `cli mcp exec` / `agentdb index`:
#   A1 causal CRUD round-trip on '/'-bearing ids (create P3 / query P7 /
#      edge-delete P5 / node-delete P4 — delete handlers must accept the same
#      '/' ids create accepts, mirroring ADR-0281 R3);
#   A2 hierarchical-recall + causal-recall are non-erroring (P6, not "Internal error");
#   A3 `agentdb index --purge` is idempotent on the edge surface (P1/P2 — edge
#      count does not climb across two runs, records do not duplicate);
#   A4 the reindex reconciles all surfaces (P8 — hierarchical==adr-patterns==count,
#      edges==inverses).
# FAILs pre-impl (delete handlers reject '/'; causal/recall/purge surfaces broken),
# PASSes after ADR-0285 lands. Reuses ACCEPT_TEMP via ADR0255_SMOKE_SHARED_TEMP.

if ! declare -f _ns >/dev/null 2>&1; then
  _ns() { date +%s%N 2>/dev/null || echo $(( $(date +%s) * 1000000000 )); }
fi
if ! declare -f _elapsed_ms >/dev/null 2>&1; then
  _elapsed_ms() { echo $(( ( ${2:-0} - ${1:-0} ) / 1000000 )); }
fi

check_adr0285_causal_crud_and_purge() {
  local start_ns end_ns log_path rc
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  log_path=$(mktemp -t "adr0285-causal-crud-and-purge-XXXXXX.log")

  if [[ ! -f "${PROJECT_DIR}/scripts/smoke-adr0285-causal-crud-and-purge.mjs" ]]; then
    _CHECK_OUTPUT="missing: scripts/smoke-adr0285-causal-crud-and-purge.mjs"
    end_ns=$(_ns); _EXIT=2; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  node "${PROJECT_DIR}/scripts/smoke-adr0285-causal-crud-and-purge.mjs" > "${log_path}" 2>&1
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
