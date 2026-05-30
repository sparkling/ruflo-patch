#!/usr/bin/env bash
# lib/acceptance-adr0275-checks.sh — ADR-0275 RVF-native HNSW Layer B.
#
# Runs scripts/smoke-adr0275-hnsw.mjs: loads the published rvf-node napi binding,
# ingests vectors, and asserts queryWithEnvelope reports layerB=true (HNSW Layer
# B active) + recall sanity + a populated quality envelope. Reuses ACCEPT_TEMP.

if ! declare -f _ns >/dev/null 2>&1; then
  _ns() { date +%s%N 2>/dev/null || echo $(( $(date +%s) * 1000000000 )); }
fi
if ! declare -f _elapsed_ms >/dev/null 2>&1; then
  _elapsed_ms() { echo $(( ( ${2:-0} - ${1:-0} ) / 1000000 )); }
fi

check_adr0275_hnsw() {
  local start_ns end_ns log_path rc
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  log_path=$(mktemp -t "adr0275-hnsw-XXXXXX.log")

  if [[ ! -f "${PROJECT_DIR}/scripts/smoke-adr0275-hnsw.mjs" ]]; then
    _CHECK_OUTPUT="missing: scripts/smoke-adr0275-hnsw.mjs"
    end_ns=$(_ns); _EXIT=2; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  node "${PROJECT_DIR}/scripts/smoke-adr0275-hnsw.mjs" > "${log_path}" 2>&1
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
