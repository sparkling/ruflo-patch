#!/usr/bin/env bash
# lib/acceptance-adr0277-checks.sh — ADR-0277 close the autonomous
# causal-learning loop.
#
# Runs scripts/smoke-adr0277-causal-learning-loop.mjs: writes N varied-reward
# episodes (reflexion-store), triggers the scheduled learner path
# (agentdb_learner_run), then proves the loop closes — SQLite causal_edges gains
# rows with NON-NULL uplift (the real NightlyLearner ran, not the
# MemoryConsolidator) and agentdb_causal-recall returns those edges uplift-ranked.
# FAILs pre-impl (factory prefers the consolidator → edgesDiscovered=0/avgUplift=0,
# causal-recall cold-start count=0), PASSes after ADR-0277 I1/I2 land. Reuses the
# main ACCEPT_TEMP install via ADR0255_SMOKE_SHARED_TEMP — no per-ADR install.

if ! declare -f _ns >/dev/null 2>&1; then
  _ns() { date +%s%N 2>/dev/null || echo $(( $(date +%s) * 1000000000 )); }
fi
if ! declare -f _elapsed_ms >/dev/null 2>&1; then
  _elapsed_ms() { echo $(( ( ${2:-0} - ${1:-0} ) / 1000000 )); }
fi

check_adr0277_causal_learning_loop() {
  local start_ns end_ns log_path rc
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  log_path=$(mktemp -t "adr0277-causal-learning-loop-XXXXXX.log")

  if [[ ! -f "${PROJECT_DIR}/scripts/smoke-adr0277-causal-learning-loop.mjs" ]]; then
    _CHECK_OUTPUT="missing: scripts/smoke-adr0277-causal-learning-loop.mjs"
    end_ns=$(_ns); _EXIT=2; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  node "${PROJECT_DIR}/scripts/smoke-adr0277-causal-learning-loop.mjs" > "${log_path}" 2>&1
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
