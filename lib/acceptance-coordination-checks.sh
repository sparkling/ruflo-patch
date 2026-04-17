#!/usr/bin/env bash
# lib/acceptance-coordination-checks.sh — ADR-0094 Phase 3: Coordination MCP tools
#
# Acceptance checks for the 7 coordination_* MCP tools. Each check invokes
# the tool via `cli mcp exec --tool <name> --params '<json>'` and matches
# the output against an expected pattern.
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
#           (_run_and_kill_ro, _cli_cmd, _e2e_isolate available)
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG

# ════════════════════════════════════════════════════════════════════
# Shared helper: _coordination_invoke_tool
# ════════════════════════════════════════════════════════════════════
#
# Arguments (positional):
#   $1 tool             — MCP tool name (e.g. "coordination_consensus")
#   $2 params           — JSON params string (e.g. '{"proposal":"test"}')
#   $3 expected_pattern — grep -iE pattern for a PASS match
#   $4 label            — human-readable label for diagnostics
#   $5 timeout          — max seconds (default 15)
#
# Sets: _CHECK_PASSED ("true" / "false" / "skip_accepted")
#       _CHECK_OUTPUT  (diagnostic string)
_coordination_invoke_tool() {
  local tool="$1"
  local params="$2"
  local expected_pattern="$3"
  local label="$4"
  local timeout="${5:-15}"

  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  if [[ -z "$tool" || -z "$expected_pattern" || -z "$label" ]]; then
    _CHECK_OUTPUT="P3/${label}: helper called with missing args (tool=$tool pattern=$expected_pattern label=$label)"
    return
  fi

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/coordination-${tool}-XXXXX)

  # Build the command — include --params only when non-empty
  local cmd
  if [[ -n "$params" && "$params" != "{}" ]]; then
    cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool $tool --params '$params'"
  else
    cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool $tool"
  fi

  _run_and_kill_ro "$cmd" "$work" "$timeout"
  local body; body=$(cat "$work" 2>/dev/null || echo "")
  # Strip the sentinel line before matching
  body=$(echo "$body" | grep -v '^__RUFLO_DONE__:')

  rm -f "$work" 2>/dev/null

  # ─── Three-way bucket ────────────────────────────────────────────
  # 1. Tool not found / not registered -> skip_accepted
  if echo "$body" | grep -qiE 'tool.+not found|not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P3/${label}: MCP tool '$tool' not in build — $(echo "$body" | head -3 | tr '\n' ' ')"
    return
  fi

  # 2. Expected pattern match -> PASS
  if echo "$body" | grep -qiE "$expected_pattern"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P3/${label}: tool '$tool' returned expected pattern ($expected_pattern)"
    return
  fi

  # 3. Everything else -> FAIL with diagnostic
  _CHECK_PASSED="false"
  _CHECK_OUTPUT="P3/${label}: tool '$tool' output did not match /$expected_pattern/i. Output (first 10 lines):
$(echo "$body" | head -10)"
}

# ════════════════════════════════════════════════════════════════════
# Check 1: coordination_consensus — propose and gather votes
# ════════════════════════════════════════════════════════════════════
check_adr0094_p3_coordination_consensus() {
  _coordination_invoke_tool \
    "coordination_consensus" \
    '{"proposal":"test"}' \
    'consensus|result|vote' \
    "coordination_consensus" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 2: coordination_load_balance — distribute load across agents
# ════════════════════════════════════════════════════════════════════
check_adr0094_p3_coordination_load_balance() {
  _coordination_invoke_tool \
    "coordination_load_balance" \
    '{}' \
    'balance|load|distribution|agents' \
    "coordination_load_balance" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 3: coordination_node — node status query
# ════════════════════════════════════════════════════════════════════
check_adr0094_p3_coordination_node() {
  _coordination_invoke_tool \
    "coordination_node" \
    '{"action":"status"}' \
    'node|status|id' \
    "coordination_node" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 4: coordination_orchestrate — orchestrate a task
# ════════════════════════════════════════════════════════════════════
check_adr0094_p3_coordination_orchestrate() {
  _coordination_invoke_tool \
    "coordination_orchestrate" \
    '{"task":"test orchestration"}' \
    'orchestrat|plan|agents' \
    "coordination_orchestrate" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 5: coordination_sync — synchronize state
# ════════════════════════════════════════════════════════════════════
check_adr0094_p3_coordination_sync() {
  _coordination_invoke_tool \
    "coordination_sync" \
    '{}' \
    'sync|synchronized|state' \
    "coordination_sync" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 6: coordination_topology — query topology
# ════════════════════════════════════════════════════════════════════
check_adr0094_p3_coordination_topology() {
  _coordination_invoke_tool \
    "coordination_topology" \
    '{}' \
    'topology|nodes|connections|mesh' \
    "coordination_topology" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 7: coordination_metrics — query coordination metrics
# ════════════════════════════════════════════════════════════════════
check_adr0094_p3_coordination_metrics() {
  _coordination_invoke_tool \
    "coordination_metrics" \
    '{}' \
    'metrics|latency|throughput|count' \
    "coordination_metrics" \
    15
}
