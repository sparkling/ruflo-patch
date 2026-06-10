#!/usr/bin/env bash
# lib/acceptance-adr0305-checks.sh — ADR-0305 adr-index SKILL → in-process builder.
#
# Runs scripts/smoke-adr0305-index-skill-migration.mjs: asserts the canonical
# adr-index SKILL.md instructs `agentdb index` (not `node …/import.mjs`), then —
# on one identical synthetic corpus, alongside a live MCP server (no stop) —
# proves the builder's record + forward-edge counts MATCH the legacy import.mjs
# path (no records/edges lost in the migration), writes the 3 derived inverses
# import.mjs never wrote, and the records are queryable via
# agentdb_hierarchical-query (ADR-0176). Reuses ACCEPT_TEMP.

if ! declare -f _ns >/dev/null 2>&1; then
  _ns() { date +%s%N 2>/dev/null || echo $(( $(date +%s) * 1000000000 )); }
fi
if ! declare -f _elapsed_ms >/dev/null 2>&1; then
  _elapsed_ms() { echo $(( ( ${2:-0} - ${1:-0} ) / 1000000 )); }
fi

check_adr0305_index_skill() {
  local start_ns end_ns log_path rc
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  log_path=$(mktemp -t "adr0305-index-skill-XXXXXX.log")

  if [[ ! -f "${PROJECT_DIR}/scripts/smoke-adr0305-index-skill-migration.mjs" ]]; then
    _CHECK_OUTPUT="missing: scripts/smoke-adr0305-index-skill-migration.mjs"
    end_ns=$(_ns); _EXIT=2; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  node "${PROJECT_DIR}/scripts/smoke-adr0305-index-skill-migration.mjs" > "${log_path}" 2>&1
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
