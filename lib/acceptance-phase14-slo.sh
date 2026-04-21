# lib/acceptance-phase14-slo.sh — ADR-0094 Phase 14: Performance SLO per tool class
#
# Asserts per-tool-class wall-clock SLO budgets. Tools must be fast AND work —
# a correct response that takes 45 seconds is still a regression. Phases 11
# and 12 only check shape (rejection signal) and error-message quality; they
# will pass a tool that silently fell back to a slow degraded path. Phase 14
# catches those latency regressions by timing the happy path against a
# published budget per tool class.
#
# 8 tool classes × 1 probe each = 8 checks total. All probes use valid input
# so the only thing being measured is latency of the success path; we do not
# mix fuzzing into this phase.
#
# Per-class SLO matrix:
#   #  class       tool                 budget   params
#   1. memory      memory_store         10s      {"key":"p14-slo-probe","value":"slo","namespace":"p14"}
#   2. session     session_save         10s      {"name":"p14-slo-probe"}
#   3. agent       agent_list           15s      {}
#   4. claims      claims_board         10s      {}
#   5. workflow    workflow_list        10s      {}
#   6. config      config_get           10s      {"key":"version"}
#   7. neural      neural_status        15s      {}
#   8. autopilot   autopilot_status     10s      {}
#
# memory_store and session_save use `--rw` (writes need WAL grace); the other
# six are `--ro`. Timeout passed to `_mcp_invoke_tool` is always `budget+5` so
# a tool that blows through its SLO still hits the timeout and produces an
# exit code the verdict helper can see.
#
# PASS          : elapsed ≤ budget AND exit == 0 AND no error-shape word
#                 AND body is non-empty.
# FAIL — SLO    : elapsed > budget, regardless of whether the tool eventually
#                 returned success (ADR-0082 — "worked eventually" is not the
#                 contract; "fast enough AND worked" is).
# FAIL — error  : within budget but exit != 0, "success":false, or error-shape
#                 word in the body.
# FAIL — silent : elapsed ≤ budget and no rejection signal, but body is empty
#                 or neutral (ADR-0082 silent-pass-suspect — same canary as
#                 P11/P12).
# SKIP_ACCEPTED : tool-not-found preserved from `_mcp_invoke_tool` (no new
#                 skip reasons introduced by this phase).
#
# Requires: acceptance-harness.sh (_mcp_invoke_tool, _with_iso_cleanup).
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG.

# ════════════════════════════════════════════════════════════════════
# Shared helper — every check calls this exactly once.
# ════════════════════════════════════════════════════════════════════

# _p14_expect_within_slo <label> <budget_seconds> <elapsed_seconds>
#
# Post-condition evaluator. Reads _MCP_BODY + _MCP_EXIT + _CHECK_PASSED that
# _mcp_invoke_tool just populated, plus the caller-computed <elapsed_seconds>,
# then overwrites _CHECK_PASSED / _CHECK_OUTPUT with the Phase 14 verdict.
# Order of buckets matters — SLO-exceeded fires even when the tool eventually
# returned success, because the contract is "fast enough AND worked".
_p14_expect_within_slo() {
  local label="${1:-p14}"
  local budget="${2:-0}"
  local elapsed="${3:-0}"

  # (1) SKIP_ACCEPTED preserved — _mcp_invoke_tool already decided tool-not-found.
  if [[ "${_CHECK_PASSED:-}" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: ${label}: tool not in build (elapsed=${elapsed}s, budget=${budget}s)"
    return
  fi

  local body="${_MCP_BODY:-}"
  local exit_code="${_MCP_EXIT:-0}"

  # Reset — we re-decide below.
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # (2) SLO exceeded — FAIL regardless of tool outcome inside the oversized
  # window. "Worked eventually" is not the contract.
  if (( elapsed > budget )); then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="${label} FAIL: exceeded SLO (${elapsed}s > ${budget}s). exit=${exit_code}. Body: $(echo "$body" | head -5 | tr '\n' ' ')"
    return
  fi

  # (3) Tool errored within the budget window — FAIL. Non-zero exit, explicit
  # success:false, or error-shape word in the body all count as failure.
  if [[ "$exit_code" != "0" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="${label} FAIL: tool errored within SLO window (elapsed=${elapsed}s, budget=${budget}s, exit=${exit_code}). Body: $(echo "$body" | head -5 | tr '\n' ' ')"
    return
  fi

  if echo "$body" | grep -qE '"success"[[:space:]]*:[[:space:]]*false'; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="${label} FAIL: tool errored within SLO window (elapsed=${elapsed}s, budget=${budget}s, exit=${exit_code}). Body: $(echo "$body" | head -5 | tr '\n' ' ')"
    return
  fi

  if echo "$body" | grep -qiE 'error|invalid|required|must|missing|malformed|unexpected|cannot'; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="${label} FAIL: tool errored within SLO window (elapsed=${elapsed}s, budget=${budget}s, exit=${exit_code}). Body: $(echo "$body" | head -5 | tr '\n' ' ')"
    return
  fi

  # (4) Empty/neutral body — ADR-0082 silent-pass-suspect. Same canary as P11/P12.
  if [[ -z "$body" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="${label} FAIL: neutral body is ADR-0082-suspect (elapsed=${elapsed}s, budget=${budget}s, exit=${exit_code}). Body: <empty>"
    return
  fi

  # (5) PASS — fast enough, exit clean, no error words, body present.
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="${label} OK: ${elapsed}s ≤ budget=${budget}s"
}

# ════════════════════════════════════════════════════════════════════
# 1. memory_store — budget 10s, --rw
# ════════════════════════════════════════════════════════════════════
_p14_slo_memory_store_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  local start end elapsed
  start=$(date +%s)
  _mcp_invoke_tool "memory_store" \
    '{"key":"p14-slo-probe","value":"slo","namespace":"p14"}' \
    '.' "P14/memory_store" 15 --rw
  end=$(date +%s)
  elapsed=$((end - start))
  _p14_expect_within_slo "P14/memory_store" 10 "$elapsed"
  E2E_DIR="$_saved"
}
check_adr0094_p14_slo_memory_store() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p14-slo-memory-store" _p14_slo_memory_store_body
}

# ════════════════════════════════════════════════════════════════════
# 2. session_save — budget 10s, --rw
# ════════════════════════════════════════════════════════════════════
_p14_slo_session_save_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  local start end elapsed
  start=$(date +%s)
  _mcp_invoke_tool "session_save" \
    '{"name":"p14-slo-probe"}' \
    '.' "P14/session_save" 15 --rw
  end=$(date +%s)
  elapsed=$((end - start))
  _p14_expect_within_slo "P14/session_save" 10 "$elapsed"
  E2E_DIR="$_saved"
}
check_adr0094_p14_slo_session_save() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p14-slo-session-save" _p14_slo_session_save_body
}

# ════════════════════════════════════════════════════════════════════
# 3. agent_list — budget 15s, --ro
# ════════════════════════════════════════════════════════════════════
_p14_slo_agent_list_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  local start end elapsed
  start=$(date +%s)
  _mcp_invoke_tool "agent_list" \
    '{}' \
    '.' "P14/agent_list" 20 --ro
  end=$(date +%s)
  elapsed=$((end - start))
  _p14_expect_within_slo "P14/agent_list" 15 "$elapsed"
  E2E_DIR="$_saved"
}
check_adr0094_p14_slo_agent_list() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p14-slo-agent-list" _p14_slo_agent_list_body
}

# ════════════════════════════════════════════════════════════════════
# 4. claims_board — budget 10s, --ro
# ════════════════════════════════════════════════════════════════════
_p14_slo_claims_board_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  local start end elapsed
  start=$(date +%s)
  _mcp_invoke_tool "claims_board" \
    '{}' \
    '.' "P14/claims_board" 15 --ro
  end=$(date +%s)
  elapsed=$((end - start))
  _p14_expect_within_slo "P14/claims_board" 10 "$elapsed"
  E2E_DIR="$_saved"
}
check_adr0094_p14_slo_claims_board() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p14-slo-claims-board" _p14_slo_claims_board_body
}

# ════════════════════════════════════════════════════════════════════
# 5. workflow_list — budget 10s, --ro
# ════════════════════════════════════════════════════════════════════
_p14_slo_workflow_list_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  local start end elapsed
  start=$(date +%s)
  _mcp_invoke_tool "workflow_list" \
    '{}' \
    '.' "P14/workflow_list" 15 --ro
  end=$(date +%s)
  elapsed=$((end - start))
  _p14_expect_within_slo "P14/workflow_list" 10 "$elapsed"
  E2E_DIR="$_saved"
}
check_adr0094_p14_slo_workflow_list() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p14-slo-workflow-list" _p14_slo_workflow_list_body
}

# ════════════════════════════════════════════════════════════════════
# 6. config_get — budget 10s, --ro
# ════════════════════════════════════════════════════════════════════
_p14_slo_config_get_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  local start end elapsed
  start=$(date +%s)
  _mcp_invoke_tool "config_get" \
    '{"key":"version"}' \
    '.' "P14/config_get" 15 --ro
  end=$(date +%s)
  elapsed=$((end - start))
  _p14_expect_within_slo "P14/config_get" 10 "$elapsed"
  E2E_DIR="$_saved"
}
check_adr0094_p14_slo_config_get() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p14-slo-config-get" _p14_slo_config_get_body
}

# ════════════════════════════════════════════════════════════════════
# 7. neural_status — budget 15s, --ro
# ════════════════════════════════════════════════════════════════════
_p14_slo_neural_status_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  local start end elapsed
  start=$(date +%s)
  _mcp_invoke_tool "neural_status" \
    '{}' \
    '.' "P14/neural_status" 20 --ro
  end=$(date +%s)
  elapsed=$((end - start))
  _p14_expect_within_slo "P14/neural_status" 15 "$elapsed"
  E2E_DIR="$_saved"
}
check_adr0094_p14_slo_neural_status() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p14-slo-neural-status" _p14_slo_neural_status_body
}

# ════════════════════════════════════════════════════════════════════
# 8. autopilot_status — budget 10s, --ro
# ════════════════════════════════════════════════════════════════════
_p14_slo_autopilot_status_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  local start end elapsed
  start=$(date +%s)
  _mcp_invoke_tool "autopilot_status" \
    '{}' \
    '.' "P14/autopilot_status" 15 --ro
  end=$(date +%s)
  elapsed=$((end - start))
  _p14_expect_within_slo "P14/autopilot_status" 10 "$elapsed"
  E2E_DIR="$_saved"
}
check_adr0094_p14_slo_autopilot_status() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p14-slo-autopilot-status" _p14_slo_autopilot_status_body
}
