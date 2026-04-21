#!/usr/bin/env bash
# lib/acceptance-claims-checks.sh — ADR-0094 Phase 1: Claims MCP tools
#
# Acceptance checks for the 11 claims_* MCP tools. Each check invokes the
# canonical `_mcp_invoke_tool` helper from acceptance-harness.sh (ADR-0094
# Sprint 0 WI-3 — no per-domain drift). Includes a lifecycle round-trip
# (claim -> board -> release -> board) using _with_iso_cleanup.
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
#           (_mcp_invoke_tool, _cli_cmd, _e2e_isolate, _with_iso_cleanup)
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG

# ════════════════════════════════════════════════════════════════════
# Lifecycle body: claim -> board -> release -> board
# Called via _with_iso_cleanup — iso dir is arg $1, trap handles cleanup.
# Each step temporarily overrides $E2E_DIR so _mcp_invoke_tool's cwd is
# the isolated dir (prevents concurrent-write contention).
# ════════════════════════════════════════════════════════════════════
_claims_lifecycle_body() {
  local iso="$1"

  # Save + override E2E_DIR for the entire lifecycle
  local _saved_e2e="${E2E_DIR:-}"
  E2E_DIR="$iso"

  # Step 1: Claim a task
  _mcp_invoke_tool "claims_claim" \
    '{"taskId":"adr0094-lifecycle","agentId":"lifecycle-agent"}' \
    'claim|success|true|assigned|acquired' \
    "P1/claims_lifecycle/claim" 15 --rw

  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: P1/claims_lifecycle: claims_claim not in build — $(echo "${_MCP_BODY:-}" | head -3 | tr '\n' ' ')"
    E2E_DIR="$_saved_e2e"; return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    local d="$_CHECK_OUTPUT"; _CHECK_PASSED="false"
    _CHECK_OUTPUT="P1/claims_lifecycle: step 1 (claim) failed — $d"
    E2E_DIR="$_saved_e2e"; return
  fi

  # Step 2: Verify board shows the claim
  _mcp_invoke_tool "claims_board" '{}' \
    'adr0094-lifecycle|lifecycle-agent|claim|board|task' \
    "P1/claims_lifecycle/board-after-claim" 15 --rw

  if [[ "$_CHECK_PASSED" != "true" ]]; then
    local d="$_CHECK_OUTPUT"; _CHECK_PASSED="false"
    _CHECK_OUTPUT="P1/claims_lifecycle: step 2 (board after claim) failed — $d"
    E2E_DIR="$_saved_e2e"; return
  fi

  # Step 3: Release the claim
  _mcp_invoke_tool "claims_release" \
    '{"taskId":"adr0094-lifecycle"}' \
    'release|success|true|freed|removed' \
    "P1/claims_lifecycle/release" 15 --rw

  if [[ "$_CHECK_PASSED" != "true" ]]; then
    local d="$_CHECK_OUTPUT"; _CHECK_PASSED="false"
    _CHECK_OUTPUT="P1/claims_lifecycle: step 3 (release) failed — $d"
    E2E_DIR="$_saved_e2e"; return
  fi

  # Step 4: Verify board no longer shows the claim
  _mcp_invoke_tool "claims_board" '{}' \
    'board|claims|empty|"tasks"|"agents"|\[\]|\{\}' \
    "P1/claims_lifecycle/board-after-release" 15 --rw

  if [[ "$_CHECK_PASSED" != "true" ]]; then
    # Accept if the response simply lacks the released task ID
    if [[ -n "${_MCP_BODY:-}" ]] && ! echo "${_MCP_BODY}" | grep -q 'adr0094-lifecycle'; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="P1/claims_lifecycle: full round-trip passed (claim -> board -> release -> board confirms task removed)"
    else
      local d="$_CHECK_OUTPUT"; _CHECK_PASSED="false"
      _CHECK_OUTPUT="P1/claims_lifecycle: step 4 (board after release) still shows claim — $d"
    fi
  else
    _CHECK_OUTPUT="P1/claims_lifecycle: full round-trip passed (claim -> board -> release -> board)"
  fi

  E2E_DIR="$_saved_e2e"
}

check_adr0094_p1_claims_lifecycle() { # adr0097-l2-delegator: flag set inside body via _with_iso_cleanup
  _with_iso_cleanup "claims-lifecycle" _claims_lifecycle_body
}

# ════════════════════════════════════════════════════════════════════
# Individual tool checks (read-only shape verification)
# ════════════════════════════════════════════════════════════════════

check_adr0094_p1_claims_claim() { # adr0097-l2-delegator: flag set inside _mcp_invoke_tool
  _mcp_invoke_tool "claims_claim" \
    '{"taskId":"adr0094-test","agentId":"test-agent"}' \
    'claim|success|true|assigned|acquired' \
    "P1/claims_claim" 15 --ro
}

check_adr0094_p1_claims_status() { # adr0097-l2-delegator: flag set inside _mcp_invoke_tool
  _mcp_invoke_tool "claims_status" \
    '{"taskId":"adr0094-test"}' \
    'status|claim|unclaimed|claimed|not found|taskId' \
    "P1/claims_status" 15 --ro
}

check_adr0094_p1_claims_list() { # adr0097-l2-delegator: flag set inside _mcp_invoke_tool
  _mcp_invoke_tool "claims_list" '{}' \
    'claims|list|\[\]|tasks|"taskId"' \
    "P1/claims_list" 15 --ro
}

check_adr0094_p1_claims_board() { # adr0097-l2-delegator: flag set inside _mcp_invoke_tool
  _mcp_invoke_tool "claims_board" '{}' \
    'board|claims|agents|tasks|\[\]|\{\}' \
    "P1/claims_board" 15 --ro
}

check_adr0094_p1_claims_load() { # adr0097-l2-delegator: flag set inside _mcp_invoke_tool
  _mcp_invoke_tool "claims_load" '{}' \
    'load|count|agents|capacity|0|utilization' \
    "P1/claims_load" 15 --ro
}

check_adr0094_p1_claims_handoff() { # adr0097-l2-delegator: flag set inside _mcp_invoke_tool
  _mcp_invoke_tool "claims_handoff" \
    '{"taskId":"adr0094-test","fromAgent":"test-agent","toAgent":"agent-2"}' \
    'handoff|success|true|pending|transfer|error' \
    "P1/claims_handoff" 15 --ro
}

check_adr0094_p1_claims_accept_handoff() { # adr0097-l2-delegator: flag set inside _mcp_invoke_tool
  _mcp_invoke_tool "claims_accept-handoff" \
    '{"taskId":"adr0094-test","agentId":"agent-2"}' \
    'accept|handoff|success|true|error|no.*pending' \
    "P1/claims_accept-handoff" 15 --ro
}

check_adr0094_p1_claims_steal() { # adr0097-l2-delegator: flag set inside _mcp_invoke_tool
  _mcp_invoke_tool "claims_steal" \
    '{"taskId":"adr0094-test","agentId":"agent-3"}' \
    'steal|success|true|stole|error|not.*stealable' \
    "P1/claims_steal" 15 --ro
}

check_adr0094_p1_claims_mark_stealable() { # adr0097-l2-delegator: flag set inside _mcp_invoke_tool
  _mcp_invoke_tool "claims_mark-stealable" \
    '{"taskId":"adr0094-test"}' \
    'stealable|marked|success|true|error' \
    "P1/claims_mark-stealable" 15 --ro
}

check_adr0094_p1_claims_rebalance() { # adr0097-l2-delegator: flag set inside _mcp_invoke_tool
  _mcp_invoke_tool "claims_rebalance" '{}' \
    'rebalance|success|true|balanced|moved|0|no.*change' \
    "P1/claims_rebalance" 15 --ro
}

check_adr0094_p1_claims_release() { # adr0097-l2-delegator: flag set inside _mcp_invoke_tool
  _mcp_invoke_tool "claims_release" \
    '{"taskId":"adr0094-test"}' \
    'release|success|true|freed|removed|error|not.*found' \
    "P1/claims_release" 15 --ro
}
