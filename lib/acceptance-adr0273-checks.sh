#!/usr/bin/env bash
# lib/acceptance-adr0273-checks.sh — ADR-0273 scriptable `agentdb index` command.
#
# Runs scripts/smoke-adr0273-index.mjs: builds a small synthetic ADR corpus,
# starts a live MCP server, runs `agentdb index` ALONGSIDE it (no stop), and
# asserts 3 hierarchical records + 2 edges + 2 inverses + the records are
# queryable via agentdb_hierarchical-query (ADR-0176) — proving the ADR-0274
# handle split lets the index write past a running server. Reuses ACCEPT_TEMP.

if ! declare -f _ns >/dev/null 2>&1; then
  _ns() { date +%s%N 2>/dev/null || echo $(( $(date +%s) * 1000000000 )); }
fi
if ! declare -f _elapsed_ms >/dev/null 2>&1; then
  _elapsed_ms() { echo $(( ( ${2:-0} - ${1:-0} ) / 1000000 )); }
fi

check_adr0273_index() {
  local start_ns end_ns log_path rc
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  log_path=$(mktemp -t "adr0273-index-XXXXXX.log")

  if [[ ! -f "${PROJECT_DIR}/scripts/smoke-adr0273-index.mjs" ]]; then
    _CHECK_OUTPUT="missing: scripts/smoke-adr0273-index.mjs"
    end_ns=$(_ns); _EXIT=2; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  node "${PROJECT_DIR}/scripts/smoke-adr0273-index.mjs" > "${log_path}" 2>&1
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
