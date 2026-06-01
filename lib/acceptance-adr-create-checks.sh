#!/usr/bin/env bash
# lib/acceptance-adr-create-checks.sh — adr-create + the 4 ADR storage mechanisms,
# full op matrix.
#
# Runs scripts/smoke-adr-create-storage-matrix.mjs against the shared ACCEPT_TEMP
# install (server-less — every op is a fresh `cli mcp exec` process → authoritative
# durable reads). Asserts, end-to-end via `cli mcp exec` / `agentdb index`, every
# operation (create / retrieve / get / search / query / update / upsert / delete)
# on each of the 4 surfaces the /adr-create skill + the ADR index write:
#   E2E  adr-create equivalent — surfaces 1 (hierarchical record) + 2 (adr-patterns
#        vector) write, read-back, and keyed-upsert idempotency (ADR-0281);
#   S1   hierarchical_memory (SQLite) op matrix incl. NON-erroring recall (P6);
#   S2   adr-patterns (RVF+HNSW) op matrix incl. hasEmbedding + hnswIndexInvalidated;
#   S3   causal_edges (SQLite) op matrix on '/'-bearing ids — create (P3) / query
#        (P7) / update / recall (P6) / edge-delete (P5) / node-delete (P4);
#   S4   causal-edges (RVF+HNSW) mirror + reconciliation — `agentdb index --purge`
#        TWICE: hierarchical==adr-patterns==count, edges==inverses (P8), no growth
#        across runs (P1/P2), and memory_stats namespace parity (mirror == SQLite).
# Locks in the ADR-0285 fixes (FAILs if any regression guard P1-P8 returns). Reuses
# ACCEPT_TEMP via ADR0255_SMOKE_SHARED_TEMP. Distinct from the narrower
# scripts/smoke-adr0285-causal-crud-and-purge.mjs ('/'-id-asymmetry regression).

if ! declare -f _ns >/dev/null 2>&1; then
  _ns() { date +%s%N 2>/dev/null || echo $(( $(date +%s) * 1000000000 )); }
fi
if ! declare -f _elapsed_ms >/dev/null 2>&1; then
  _elapsed_ms() { echo $(( ( ${2:-0} - ${1:-0} ) / 1000000 )); }
fi

check_adr_create_storage_matrix() {
  local start_ns end_ns log_path rc
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  log_path=$(mktemp -t "adr-create-storage-matrix-XXXXXX.log")

  if [[ ! -f "${PROJECT_DIR}/scripts/smoke-adr-create-storage-matrix.mjs" ]]; then
    _CHECK_OUTPUT="missing: scripts/smoke-adr-create-storage-matrix.mjs"
    end_ns=$(_ns); _EXIT=2; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  node "${PROJECT_DIR}/scripts/smoke-adr-create-storage-matrix.mjs" > "${log_path}" 2>&1
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
