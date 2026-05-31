#!/usr/bin/env bash
# lib/acceptance-adr0278-checks.sh — ADR-0278 ModelRouter contextual-uplift bandit.
#
# Runs scripts/smoke-adr0278-model-contextual-bandit.mjs: records outcomes via
# hooks_model-outcome for two task-types where DIFFERENT models win, then reads
# the per-(task_type,model) priors back via hooks_model-stats and asserts the
# winner FLIPS by task-type (frontend favors haiku, database favors opus) while
# the pooled marginal still ranks haiku>opus for both — the de-confounding the
# old per-model bandit could not represent. FAILs pre-impl (hooks_model-stats
# exposes no contextualPriors field, and a single marginal prior cannot make the
# winner flip), PASSes after ADR-0278 lands. Reuses the main ACCEPT_TEMP install
# via ADR0255_SMOKE_SHARED_TEMP — no per-ADR install.

if ! declare -f _ns >/dev/null 2>&1; then
  _ns() { date +%s%N 2>/dev/null || echo $(( $(date +%s) * 1000000000 )); }
fi
if ! declare -f _elapsed_ms >/dev/null 2>&1; then
  _elapsed_ms() { echo $(( ( ${2:-0} - ${1:-0} ) / 1000000 )); }
fi

check_adr0278_model_contextual_bandit() {
  local start_ns end_ns log_path rc
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  log_path=$(mktemp -t "adr0278-model-contextual-bandit-XXXXXX.log")

  if [[ ! -f "${PROJECT_DIR}/scripts/smoke-adr0278-model-contextual-bandit.mjs" ]]; then
    _CHECK_OUTPUT="missing: scripts/smoke-adr0278-model-contextual-bandit.mjs"
    end_ns=$(_ns); _EXIT=2; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  node "${PROJECT_DIR}/scripts/smoke-adr0278-model-contextual-bandit.mjs" > "${log_path}" 2>&1
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
