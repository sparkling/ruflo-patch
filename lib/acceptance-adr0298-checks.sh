#!/usr/bin/env bash
# lib/acceptance-adr0298-checks.sh — ADR-0298 C6 Operations re-convergence
# fixes (browser_session_record ruvector arg-skew; stat-tools repair; in-process
# browser-session memory ops).
#
# Runs scripts/smoke-adr0298-c6-reconvergence.mjs against the shared ACCEPT_TEMP
# install. LOCAL file:// targets only — no external sites, no paid LLM calls.
# Asserts (both directions):
#   R1 browser_session_record's 4 ruvector calls re-shaped to ruvector@0.2.25
#      (`rvf create <path> --dimension 768` + trajectory-begin/step/end via
#      `-c/--context`, `-a/-r`, `--success/--quality`): record → end → replay
#      completes against a LOCAL page and replay surfaces the RVF container.
#      LOUD-SKIPs when ruvector/agent-browser is absent (never silent-pass).
#      The published cli fails at step-1 (`--kind` invalid / `-d` missing).
#   R2 agentdb_circuit_status (registry key circuitBreakerController→circuitBreaker
#      AND getStats→getStatus) returns non-empty real breaker state;
#      agentdb_rate_limit_status surfaces real token-bucket fields OR an honest
#      capability-absent envelope — never a hollow {success:true}. The published
#      cli returns "not available" (wrong key) / hollow success.
#   R3a browser-session memory ops are in-process (memory_store(browser-templates)
#      → browser_template_apply round-trip content-verified in single-digit
#      seconds), not the ~26-31× per-call CLI cold-boot shell-out.
# FAILs against the published cli (step-1 arg error; hollow/absent stat tools;
# 30s+ shell tax); PASSes after the ADR-0298 fixes ship. Reuses ACCEPT_TEMP via
# ADR0255_SMOKE_SHARED_TEMP. Per feedback-no-tail-tests: the smoke writes its log
# to SMOKE_LOG_DIR; this check tails only for the result line.

if ! declare -f _ns >/dev/null 2>&1; then
  _ns() { date +%s%N 2>/dev/null || echo $(( $(date +%s) * 1000000000 )); }
fi
if ! declare -f _elapsed_ms >/dev/null 2>&1; then
  _elapsed_ms() { echo $(( ( ${2:-0} - ${1:-0} ) / 1000000 )); }
fi

check_adr0298_c6_reconvergence() {
  local start_ns end_ns log_path rc
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  log_path=$(mktemp -t "adr0298-c6-reconvergence-XXXXXX.log")

  if [[ ! -f "${PROJECT_DIR}/scripts/smoke-adr0298-c6-reconvergence.mjs" ]]; then
    _CHECK_OUTPUT="missing: scripts/smoke-adr0298-c6-reconvergence.mjs"
    end_ns=$(_ns); _EXIT=2; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  node "${PROJECT_DIR}/scripts/smoke-adr0298-c6-reconvergence.mjs" > "${log_path}" 2>&1
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
