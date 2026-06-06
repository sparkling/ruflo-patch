#!/usr/bin/env bash
# lib/acceptance-adr0299-checks.sh — ADR-0299 C7+C8 Verticals & Tooling
# re-convergence fixes (marketplace honesty completion; market-data command
# contract; neural-trader kernel smoke wiring; transfer demo-fallback
# disclosure).
#
# Runs scripts/smoke-adr0299-c78-reconvergence.mjs against the shared
# ACCEPT_TEMP install. Asserts:
#   F1 marketplace.json plugin descriptions carry no overclaim pattern (the
#      marketplace-integrity lint's Assertion 4 list — the lint itself is
#      extended to walk marketplace.json in tests/pipeline/).
#   F2 market-data command surface prescribes `memory_store --namespace
#      market-data` and never pairs `agentdb_hierarchical-store` with a
#      namespace (the live schema rejects it — split-surface drift).
#   F3 the 3 neural-trader kernel smokes (CG parity · Ed25519 · PageRank) run
#      green from the fork tree; LOUD-SKIP the two crypto smokes when
#      @noble/ed25519 is not resolvable from the fork root.
#   F4 transfer_plugin-official's envelope discloses demo-fallback provenance
#      (source + fromDemo + plugins) instead of a bare real-shaped array;
#      transfer_plugin-search unchanged.
# FAILs against the published cli (F4 bare-array envelope); PASSes after the
# ADR-0299 fixes ship. Fork-tree checks LOUD-SKIP when the fork is absent.
# Reuses ACCEPT_TEMP via ADR0255_SMOKE_SHARED_TEMP. Per feedback-no-tail-tests:
# the smoke writes its log to SMOKE_LOG_DIR; this check tails only for the
# result line.

if ! declare -f _ns >/dev/null 2>&1; then
  _ns() { date +%s%N 2>/dev/null || echo $(( $(date +%s) * 1000000000 )); }
fi
if ! declare -f _elapsed_ms >/dev/null 2>&1; then
  _elapsed_ms() { echo $(( ( ${2:-0} - ${1:-0} ) / 1000000 )); }
fi

check_adr0299_c78_reconvergence() {
  local start_ns end_ns log_path rc
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  log_path=$(mktemp -t "adr0299-c78-reconvergence-XXXXXX.log")

  if [[ ! -f "${PROJECT_DIR}/scripts/smoke-adr0299-c78-reconvergence.mjs" ]]; then
    _CHECK_OUTPUT="missing: scripts/smoke-adr0299-c78-reconvergence.mjs"
    end_ns=$(_ns); _EXIT=2; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  node "${PROJECT_DIR}/scripts/smoke-adr0299-c78-reconvergence.mjs" > "${log_path}" 2>&1
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
