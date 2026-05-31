#!/usr/bin/env bash
# lib/acceptance-adr0280-checks.sh — ADR-0280 causal recall on the default
# routing hot path.
#
# Runs scripts/smoke-adr0280-routing-action-uplift.mjs: writes action-tagged
# episodes, runs agentdb_learner_run, then asserts the run persisted the
# de-confounded action-value uplift to .swarm/action-values.json — the
# cross-process bridge the routing hot path (ModelRouter A-coupling +
# LocalReasoningBank rerank) consumes. FAILs pre-impl (the learner report's
# action-values are never persisted), PASSes after ADR-0280 lands. Reuses the
# main ACCEPT_TEMP install via ADR0255_SMOKE_SHARED_TEMP.

if ! declare -f _ns >/dev/null 2>&1; then
  _ns() { date +%s%N 2>/dev/null || echo $(( $(date +%s) * 1000000000 )); }
fi
if ! declare -f _elapsed_ms >/dev/null 2>&1; then
  _elapsed_ms() { echo $(( ( ${2:-0} - ${1:-0} ) / 1000000 )); }
fi

check_adr0280_routing_action_uplift() {
  local start_ns end_ns log_path rc
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  log_path=$(mktemp -t "adr0280-routing-action-uplift-XXXXXX.log")

  if [[ ! -f "${PROJECT_DIR}/scripts/smoke-adr0280-routing-action-uplift.mjs" ]]; then
    _CHECK_OUTPUT="missing: scripts/smoke-adr0280-routing-action-uplift.mjs"
    end_ns=$(_ns); _EXIT=2; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  node "${PROJECT_DIR}/scripts/smoke-adr0280-routing-action-uplift.mjs" > "${log_path}" 2>&1
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
