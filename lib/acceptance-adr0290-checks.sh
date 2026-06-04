#!/usr/bin/env bash
# lib/acceptance-adr0290-checks.sh — ADR-0290 automatic learning capture:
# hook → episode → NightlyLearner → action-values.
#
# Runs scripts/smoke-adr0290-learning-loop.mjs against the shared ACCEPT_TEMP
# install. Asserts, end-to-end through the FILE-BASED hook (never a manual MCP
# call — the ADR-0290 Confirmation requirement):
#   A1 the init-generated hook-handler.mjs carries the capture wiring and
#      settings.json wires PostToolUse(Task) → post-task;
#   A2 a real PostToolUse(Task) stdin payload produces an `episodes` row with
#      real metadata (task_type derived from the description, action =
#      subagent_type, reward 0.6 skeptic default, session_id forwarded);
#   A3 the row is METADATA-ONLY: description/prompt canaries absent, free-text
#      columns NULL, task label = derived type slug, no episode_embeddings row
#      (skipEmbedding — ADR-0287 F10 constraint 4), free-text sinks dormant;
#   A4 an underivable outcome dispatches NO capture (no fabrication);
#   A5 `daemon trigger -w learn` (the scheduled learn worker's own code path)
#      persists .swarm/action-values.json containing the captured
#      (task_type, action) row — the ADR-0280 routing consumers' input.
# FAILs pre-impl (cli rejects --task/--session; generated hook lacks the
# capture), PASSes after ADR-0290 Phase 1. Reuses ACCEPT_TEMP via
# ADR0255_SMOKE_SHARED_TEMP.

if ! declare -f _ns >/dev/null 2>&1; then
  _ns() { date +%s%N 2>/dev/null || echo $(( $(date +%s) * 1000000000 )); }
fi
if ! declare -f _elapsed_ms >/dev/null 2>&1; then
  _elapsed_ms() { echo $(( ( ${2:-0} - ${1:-0} ) / 1000000 )); }
fi

check_adr0290_learning_loop() {
  local start_ns end_ns log_path rc
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  log_path=$(mktemp -t "adr0290-learning-loop-XXXXXX.log")

  if [[ ! -f "${PROJECT_DIR}/scripts/smoke-adr0290-learning-loop.mjs" ]]; then
    _CHECK_OUTPUT="missing: scripts/smoke-adr0290-learning-loop.mjs"
    end_ns=$(_ns); _EXIT=2; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  node "${PROJECT_DIR}/scripts/smoke-adr0290-learning-loop.mjs" > "${log_path}" 2>&1
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
