#!/usr/bin/env bash
# lib/acceptance-adr0293-checks.sh — ADR-0293 C1 Learning & Intelligence
# re-convergence fixes (the four fork regressions).
#
# Runs scripts/smoke-adr0293-c1-reconvergence.mjs against the shared
# ACCEPT_TEMP install. Drives ONE long-lived MCP stdio JSON-RPC session and
# asserts:
#   D1 ruvllm WASM init skew fixed — ruvllm_hnsw_create → add → route returns a
#      REAL score; ruvllm_status reports wasm.available + initialized true
#      (vendored 2.0.2-patch.93 auto-instantiate/init() shape; the wrapper no
#      longer calls the absent initSync).
#   D2 hooks_transfer no longer fabricates demo-data — a nonexistent source ⇒
#      success:false, transferred:0, no demo-data marker; a real source ⇒
#      success:true with real counts.
#   D3 neural_* wired to the real mpnet embedder embeddings_* uses
#      (_realEmbeddings:true when a real embedder is reachable) AND the
#      confidence@similarity:0 scoring bug fixed (disjoint-text predict
#      confidence ≠ 1; gated by match strength).
#   D4 neural_compress documents the quantize capability boundary (removed in
#      ADR-0086 Phase 1) — response matches the advertised capability; prune /
#      distill still work.
# FAILs against the published cli/agentdb (patch.415 era — regressions present;
# 7 sub-assertions fail), PASSes after the ADR-0293 fixes ship. Reuses
# ACCEPT_TEMP via ADR0255_SMOKE_SHARED_TEMP.

if ! declare -f _ns >/dev/null 2>&1; then
  _ns() { date +%s%N 2>/dev/null || echo $(( $(date +%s) * 1000000000 )); }
fi
if ! declare -f _elapsed_ms >/dev/null 2>&1; then
  _elapsed_ms() { echo $(( ( ${2:-0} - ${1:-0} ) / 1000000 )); }
fi

check_adr0293_c1_reconvergence() {
  local start_ns end_ns log_path rc
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  log_path=$(mktemp -t "adr0293-c1-reconvergence-XXXXXX.log")

  if [[ ! -f "${PROJECT_DIR}/scripts/smoke-adr0293-c1-reconvergence.mjs" ]]; then
    _CHECK_OUTPUT="missing: scripts/smoke-adr0293-c1-reconvergence.mjs"
    end_ns=$(_ns); _EXIT=2; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  node "${PROJECT_DIR}/scripts/smoke-adr0293-c1-reconvergence.mjs" > "${log_path}" 2>&1
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
