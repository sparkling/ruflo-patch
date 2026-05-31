#!/usr/bin/env bash
# lib/acceptance-adr0279-checks.sh — ADR-0279 episodes carry an action dimension.
#
# Runs scripts/smoke-adr0279-episodes-action-dimension.mjs: writes action-tagged
# episodes (agentdb_reflexion-store with `action`), runs agentdb_learner_run, then
# asserts report.learned.actionValues carries the per-(action, task_type) value
# with de-confounded uplift (the high-reward action ranks above the low-reward
# one). FAILs pre-impl (no episodes.action column/param; the cli adapter drops
# the field; no E[reward | action, task_type] aggregate), PASSes after ADR-0279
# lands. Reuses the main ACCEPT_TEMP install via ADR0255_SMOKE_SHARED_TEMP.

if ! declare -f _ns >/dev/null 2>&1; then
  _ns() { date +%s%N 2>/dev/null || echo $(( $(date +%s) * 1000000000 )); }
fi
if ! declare -f _elapsed_ms >/dev/null 2>&1; then
  _elapsed_ms() { echo $(( ( ${2:-0} - ${1:-0} ) / 1000000 )); }
fi

check_adr0279_episodes_action_dimension() {
  local start_ns end_ns log_path rc
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  log_path=$(mktemp -t "adr0279-episodes-action-dimension-XXXXXX.log")

  if [[ ! -f "${PROJECT_DIR}/scripts/smoke-adr0279-episodes-action-dimension.mjs" ]]; then
    _CHECK_OUTPUT="missing: scripts/smoke-adr0279-episodes-action-dimension.mjs"
    end_ns=$(_ns); _EXIT=2; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  node "${PROJECT_DIR}/scripts/smoke-adr0279-episodes-action-dimension.mjs" > "${log_path}" 2>&1
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
