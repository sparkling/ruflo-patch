#!/usr/bin/env bash
# lib/acceptance-adr0261-checks.sh — ADR-0261 fork-native graph-edges (ADR-130 re-impl) acceptance checks
#
# Each check shells out to the corresponding smoke / benchmark .mjs in scripts/
# and reports pass/fail based on the script's exit code + captured output.
#
# Requires: PROJECT_DIR, _ns, _elapsed_ms from acceptance-harness.sh
# The smokes themselves bring up their own per-test temp dirs (mkdtempSync +
# `npm install @sparkleideas/cli` from Verdaccio), so this lib does NOT need to
# share TEMP_DIR with the surrounding harness.

_check_adr0261_smoke() {
  local script_name="$1"
  local start_ns end_ns log_path
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  log_path=$(mktemp -t "adr0261-${script_name}-XXXXXX.log")

  if [[ ! -f "${PROJECT_DIR}/scripts/${script_name}" ]]; then
    _CHECK_OUTPUT="missing: scripts/${script_name}"
    end_ns=$(_ns); _EXIT=2; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  # Full tee per feedback-no-tail-tests + feedback-full-test-output — never
  # pipe through tail/head; the log lives on disk for post-hoc inspection.
  node "${PROJECT_DIR}/scripts/${script_name}" > "${log_path}" 2>&1
  local rc=$?

  end_ns=$(_ns)
  _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns")
  _EXIT=$rc
  _OUT="exit=${rc} log=${log_path} (tail -50: $(tail -50 "${log_path}" 2>/dev/null | tr '\n' ' ' | head -c 400))"
  _CHECK_OUTPUT="$_OUT"

  if [[ $rc -eq 0 ]]; then
    _CHECK_PASSED="true"
  fi
}

# P1: graph_edges schema migration (table + 12 columns + 5 indexes after init)
check_adr0261_schema_migration() {
  _check_adr0261_smoke "smoke-graph-schema-migration.mjs"
}

# P2: agentdb_graph-query in 3 modes (k-hop, pagerank, semantic)
check_adr0261_query_dispatch() {
  _check_adr0261_smoke "smoke-graph-query-dispatch.mjs"
}

# P3: trajectory + post-task hooks write trajectory-caused / reinforced-by edges
check_adr0261_trajectory_edges() {
  _check_adr0261_smoke "smoke-trajectory-graph-edges.mjs"
}

# P4: ruflo-knowledge-graph plugin's GraphEdgesSource adapter sees graph_edges
check_adr0261_plugin_adapter() {
  _check_adr0261_smoke "smoke-graph-plugin-adapter.mjs"
}

# P5: agentdb_graph-pathfinder — all 6 algorithms return expected shape
check_adr0261_pathfinder() {
  _check_adr0261_smoke "smoke-graph-pathfinder.mjs"
}

# P6: benchmark — 3 targets (≥2345 writes/sec, ≤780B/edge, k-hop d=1 p99 ≤5ms)
check_adr0261_benchmark() {
  _check_adr0261_smoke "benchmark-graph.mjs"
}
