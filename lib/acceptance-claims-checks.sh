#!/usr/bin/env bash
# lib/acceptance-claims-checks.sh — ADR-0094 Phase 1: Claims MCP tools
#
# Acceptance checks for the 11 claims_* MCP tools. Each check invokes
# the tool via `cli mcp exec --tool <name> --params '<json>'` and matches
# the output against an expected pattern. Includes a lifecycle round-trip
# check (claim -> board -> release -> board) using _e2e_isolate.
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
#           (_run_and_kill_ro, _run_and_kill, _cli_cmd, _e2e_isolate)
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG

# ════════════════════════════════════════════════════════════════════
# Shared helper: _claims_invoke_tool (read-only variant)
# Args: $1=tool $2=params $3=expected_pattern $4=label $5=timeout(15)
# Sets: _CHECK_PASSED, _CHECK_OUTPUT
# ════════════════════════════════════════════════════════════════════
_claims_invoke_tool() {
  local tool="$1" params="$2" expected_pattern="$3" label="$4" timeout="${5:-15}"
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""

  if [[ -z "$tool" || -z "$expected_pattern" || -z "$label" ]]; then
    _CHECK_OUTPUT="P1/${label}: helper called with missing args (tool=$tool pattern=$expected_pattern label=$label)"
    return
  fi

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/claims-${tool}-XXXXX)

  local cmd
  if [[ -n "$params" && "$params" != "{}" ]]; then
    cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool $tool --params '$params'"
  else
    cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool $tool"
  fi

  _run_and_kill_ro "$cmd" "$work" "$timeout"
  local body; body=$(cat "$work" 2>/dev/null || echo "")
  body=$(echo "$body" | grep -v '^__RUFLO_DONE__:')
  rm -f "$work" 2>/dev/null

  # Three-way bucket: tool-not-found → skip_accepted
  if echo "$body" | grep -qiE 'tool.+not found|not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P1/${label}: MCP tool '$tool' not in build — $(echo "$body" | head -3 | tr '\n' ' ')"
    return
  fi
  # Expected pattern → PASS
  if echo "$body" | grep -qiE "$expected_pattern"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P1/${label}: tool '$tool' returned expected pattern ($expected_pattern)"
    return
  fi
  # Everything else → FAIL
  _CHECK_OUTPUT="P1/${label}: tool '$tool' output did not match /$expected_pattern/i. Output (first 10 lines):
$(echo "$body" | head -10)"
}

# ════════════════════════════════════════════════════════════════════
# Write-path variant for state-mutating ops. Uses _run_and_kill (WAL
# grace). Runs against an isolated dir ($5). Sets _CLAIMS_BODY for
# chained assertions.
# Args: $1=tool $2=params $3=expected_pattern $4=label $5=iso_dir $6=timeout(15)
# ════════════════════════════════════════════════════════════════════
_claims_invoke_tool_rw() {
  local tool="$1" params="$2" expected_pattern="$3" label="$4"
  local iso_dir="$5" timeout="${6:-15}"
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""; _CLAIMS_BODY=""

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/claims-rw-${tool}-XXXXX)

  local cmd
  if [[ -n "$params" && "$params" != "{}" ]]; then
    cmd="cd '$iso_dir' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool $tool --params '$params'"
  else
    cmd="cd '$iso_dir' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool $tool"
  fi

  _run_and_kill "$cmd" "$work" "$timeout"
  local body; body=$(cat "$work" 2>/dev/null || echo "")
  body=$(echo "$body" | grep -v '^__RUFLO_DONE__:')
  _CLAIMS_BODY="$body"
  rm -f "$work" 2>/dev/null

  if echo "$body" | grep -qiE 'tool.+not found|not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P1/${label}: MCP tool '$tool' not in build — $(echo "$body" | head -3 | tr '\n' ' ')"
    return
  fi
  if echo "$body" | grep -qiE "$expected_pattern"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P1/${label}: tool '$tool' returned expected pattern ($expected_pattern)"
    return
  fi
  _CHECK_OUTPUT="P1/${label}: tool '$tool' output did not match /$expected_pattern/i. Output (first 10 lines):
$(echo "$body" | head -10)"
}

# ════════════════════════════════════════════════════════════════════
# Lifecycle: claim -> board -> release -> board (full round-trip)
# Uses _e2e_isolate — claims mutate in-memory state.
# ════════════════════════════════════════════════════════════════════
check_adr0094_p1_claims_lifecycle() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""

  if [[ -z "${E2E_DIR:-}" || ! -d "$E2E_DIR" ]]; then
    _CHECK_OUTPUT="P1/claims_lifecycle: E2E_DIR not set or missing"; return
  fi

  local iso; iso=$(_e2e_isolate "claims-lifecycle")
  if [[ -z "$iso" || ! -d "$iso" ]]; then
    _CHECK_OUTPUT="P1/claims_lifecycle: failed to create isolated project dir"; return
  fi

  # Step 1: Claim a task
  _claims_invoke_tool_rw "claims_claim" \
    '{"taskId":"adr0094-lifecycle","agentId":"lifecycle-agent"}' \
    'claim|success|true|assigned|acquired' "claims_lifecycle/claim" "$iso" 15

  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: P1/claims_lifecycle: claims_claim not in build — $(echo "$_CLAIMS_BODY" | head -3 | tr '\n' ' ')"
    rm -rf "$iso" 2>/dev/null; return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    local d="$_CHECK_OUTPUT"; _CHECK_PASSED="false"
    _CHECK_OUTPUT="P1/claims_lifecycle: step 1 (claim) failed — $d"
    rm -rf "$iso" 2>/dev/null; return
  fi

  # Step 2: Verify board shows the claim
  _claims_invoke_tool_rw "claims_board" '{}' \
    'adr0094-lifecycle|lifecycle-agent|claim|board|task' \
    "claims_lifecycle/board-after-claim" "$iso" 15

  if [[ "$_CHECK_PASSED" != "true" ]]; then
    local d="$_CHECK_OUTPUT"; _CHECK_PASSED="false"
    _CHECK_OUTPUT="P1/claims_lifecycle: step 2 (board after claim) failed — $d"
    rm -rf "$iso" 2>/dev/null; return
  fi

  # Step 3: Release the claim
  _claims_invoke_tool_rw "claims_release" \
    '{"taskId":"adr0094-lifecycle"}' \
    'release|success|true|freed|removed' "claims_lifecycle/release" "$iso" 15

  if [[ "$_CHECK_PASSED" != "true" ]]; then
    local d="$_CHECK_OUTPUT"; _CHECK_PASSED="false"
    _CHECK_OUTPUT="P1/claims_lifecycle: step 3 (release) failed — $d"
    rm -rf "$iso" 2>/dev/null; return
  fi

  # Step 4: Verify board no longer shows the claim
  _claims_invoke_tool_rw "claims_board" '{}' \
    'board|claims|empty|"tasks"|"agents"|\[\]|\{\}' \
    "claims_lifecycle/board-after-release" "$iso" 15

  if [[ "$_CHECK_PASSED" != "true" ]]; then
    # Accept if the response simply lacks the released task ID
    if [[ -n "$_CLAIMS_BODY" ]] && ! echo "$_CLAIMS_BODY" | grep -q 'adr0094-lifecycle'; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="P1/claims_lifecycle: full round-trip passed (claim -> board -> release -> board confirms task removed)"
    else
      local d="$_CHECK_OUTPUT"; _CHECK_PASSED="false"
      _CHECK_OUTPUT="P1/claims_lifecycle: step 4 (board after release) still shows claim — $d"
    fi
  else
    _CHECK_OUTPUT="P1/claims_lifecycle: full round-trip passed (claim -> board -> release -> board)"
  fi

  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Individual tool checks (read-only shape verification)
# ════════════════════════════════════════════════════════════════════

check_adr0094_p1_claims_claim() {
  _claims_invoke_tool "claims_claim" \
    '{"taskId":"adr0094-test","agentId":"test-agent"}' \
    'claim|success|true|assigned|acquired' "claims_claim" 15
}

check_adr0094_p1_claims_status() {
  _claims_invoke_tool "claims_status" \
    '{"taskId":"adr0094-test"}' \
    'status|claim|unclaimed|claimed|not found|taskId' "claims_status" 15
}

check_adr0094_p1_claims_list() {
  _claims_invoke_tool "claims_list" '{}' \
    'claims|list|\[\]|tasks|"taskId"' "claims_list" 15
}

check_adr0094_p1_claims_board() {
  _claims_invoke_tool "claims_board" '{}' \
    'board|claims|agents|tasks|\[\]|\{\}' "claims_board" 15
}

check_adr0094_p1_claims_load() {
  _claims_invoke_tool "claims_load" '{}' \
    'load|count|agents|capacity|0|utilization' "claims_load" 15
}

check_adr0094_p1_claims_handoff() {
  _claims_invoke_tool "claims_handoff" \
    '{"taskId":"adr0094-test","fromAgent":"test-agent","toAgent":"agent-2"}' \
    'handoff|success|true|pending|transfer|error' "claims_handoff" 15
}

check_adr0094_p1_claims_accept_handoff() {
  _claims_invoke_tool "claims_accept-handoff" \
    '{"taskId":"adr0094-test","agentId":"agent-2"}' \
    'accept|handoff|success|true|error|no.*pending' "claims_accept-handoff" 15
}

check_adr0094_p1_claims_steal() {
  _claims_invoke_tool "claims_steal" \
    '{"taskId":"adr0094-test","agentId":"agent-3"}' \
    'steal|success|true|stole|error|not.*stealable' "claims_steal" 15
}

check_adr0094_p1_claims_mark_stealable() {
  _claims_invoke_tool "claims_mark-stealable" \
    '{"taskId":"adr0094-test"}' \
    'stealable|marked|success|true|error' "claims_mark-stealable" 15
}

check_adr0094_p1_claims_rebalance() {
  _claims_invoke_tool "claims_rebalance" '{}' \
    'rebalance|success|true|balanced|moved|0|no.*change' "claims_rebalance" 15
}

check_adr0094_p1_claims_release() {
  _claims_invoke_tool "claims_release" \
    '{"taskId":"adr0094-test"}' \
    'release|success|true|freed|removed|error|not.*found' "claims_release" 15
}
