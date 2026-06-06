#!/usr/bin/env bash
# lib/acceptance-adr0294-checks.sh — ADR-0294 C2 Memory & Data
# re-convergence fixes (graph_edges starvation, RaBitQ wiring, semantic-route
# honesty, batch cold rate-limit).
#
# Runs scripts/smoke-adr0294-c2-reconvergence.mjs against the shared
# ACCEPT_TEMP install. Drives ONE long-lived MCP stdio JSON-RPC session and
# asserts:
#   R1 general-entity graph_edges write restored — agentdb_causal-edge(entity)
#      → agentdb_graph-query k-hop + pagerank non-empty (+ semantic mode
#      reachable, embedder-gated) → agentdb_graph-pathfinder returns ≥1 path →
#      agentdb_causal-query STILL returns the edge (J2 must-not-regress). ADR-0276
#      narrowed causal-edge to causal_edges; R1 restores the graph_edges write
#      the graph-traversal surface (and the kg traverse/relations/visualize
#      composition) reads.
#   R3 embeddings_rabitq_* wired — the 3 tools are registered in tools/list;
#      status is honest pre-build; with a real embedder, build over a ≥5-vector
#      store returns a compression envelope (vectorCount, compressionRatio) and
#      search returns ranked results (embedder-gated assertions LOUD-SKIP without
#      a real embedder).
#   O2 agentdb_semantic-route honest envelope — cold AND warm calls return a
#      structured envelope (success:false + message + agentdb_route
#      recommendation); never bare null.
#   O1 agentdb_batch{insert} cold rate-limit fixed — the FIRST batch insert of 3
#      entries in a fresh process succeeds and lands 3 (DB-confirmed write count),
#      not cold rate_limited (token-count bug) nor session_id-constraint failure.
# FAILs against the published cli/agentdb (patch.415 era — regressions present;
# 10 sub-assertions fail), PASSes after the ADR-0294 fixes ship. Reuses
# ACCEPT_TEMP via ADR0255_SMOKE_SHARED_TEMP.

if ! declare -f _ns >/dev/null 2>&1; then
  _ns() { date +%s%N 2>/dev/null || echo $(( $(date +%s) * 1000000000 )); }
fi
if ! declare -f _elapsed_ms >/dev/null 2>&1; then
  _elapsed_ms() { echo $(( ( ${2:-0} - ${1:-0} ) / 1000000 )); }
fi

check_adr0294_c2_reconvergence() {
  local start_ns end_ns log_path rc
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  log_path=$(mktemp -t "adr0294-c2-reconvergence-XXXXXX.log")

  if [[ ! -f "${PROJECT_DIR}/scripts/smoke-adr0294-c2-reconvergence.mjs" ]]; then
    _CHECK_OUTPUT="missing: scripts/smoke-adr0294-c2-reconvergence.mjs"
    end_ns=$(_ns); _EXIT=2; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  node "${PROJECT_DIR}/scripts/smoke-adr0294-c2-reconvergence.mjs" > "${log_path}" 2>&1
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
