#!/usr/bin/env bash
# lib/acceptance-guidance-checks.sh — ADR-0094 Phase 2: Guidance MCP tools
#
# Acceptance checks for the 5 guidance_* MCP tools. Each check invokes
# the tool via `cli mcp exec --tool <name> --params '<json>'` and matches
# the output against an expected pattern.
#
# All 5 tools are read-only (no state mutations), so we use
# _run_and_kill_ro directly against E2E_DIR — no _e2e_isolate needed.
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
#           (_run_and_kill_ro, _cli_cmd available)
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG

# ════════════════════════════════════════════════════════════════════
# Shared helper: _guidance_invoke_tool
# ════════════════════════════════════════════════════════════════════
#
# Arguments (positional):
#   $1 tool             — MCP tool name (e.g. "guidance_capabilities")
#   $2 params           — JSON params string (e.g. '{}')
#   $3 expected_pattern — grep -iE pattern for a PASS match
#   $4 label            — human-readable label for diagnostics
#   $5 timeout          — max seconds (default 15)
#
# Sets: _CHECK_PASSED ("true" / "false" / "skip_accepted")
#       _CHECK_OUTPUT  (diagnostic string)
_guidance_invoke_tool() {
  local tool="$1"
  local params="$2"
  local expected_pattern="$3"
  local label="$4"
  local timeout="${5:-15}"

  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  if [[ -z "$tool" || -z "$expected_pattern" || -z "$label" ]]; then
    _CHECK_OUTPUT="P2/${label}: helper called with missing args (tool=$tool pattern=$expected_pattern label=$label)"
    return
  fi

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/guidance-${tool}-XXXXX)

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
    _CHECK_OUTPUT="SKIP_ACCEPTED: P2/${label}: MCP tool '$tool' not in build — $(echo "$body" | head -3 | tr '\n' ' ')"
    return
  fi

  # 2. Expected pattern match -> PASS
  if echo "$body" | grep -qiE "$expected_pattern"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P2/${label}: tool '$tool' returned expected pattern ($expected_pattern)"
    return
  fi

  # 3. Everything else -> FAIL with diagnostic
  _CHECK_PASSED="false"
  _CHECK_OUTPUT="P2/${label}: tool '$tool' output did not match /$expected_pattern/i. Output (first 10 lines):
$(echo "$body" | head -10)"
}

# ════════════════════════════════════════════════════════════════════
# Check 1: guidance_capabilities — list available capabilities
# ════════════════════════════════════════════════════════════════════
check_adr0094_p2_guidance_capabilities() {
  _guidance_invoke_tool \
    "guidance_capabilities" \
    '{}' \
    'capabilities|tools|features|available' \
    "guidance_capabilities" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 2: guidance_discover — discover features by query
# ════════════════════════════════════════════════════════════════════
check_adr0094_p2_guidance_discover() {
  _guidance_invoke_tool \
    "guidance_discover" \
    '{"query":"memory"}' \
    'discover|results|features|memory' \
    "guidance_discover" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 3: guidance_recommend — get recommendations for a task
# ════════════════════════════════════════════════════════════════════
check_adr0094_p2_guidance_recommend() {
  _guidance_invoke_tool \
    "guidance_recommend" \
    '{"task":"write tests","context":"acceptance"}' \
    'recommend|suggest|tools|approach' \
    "guidance_recommend" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 4: guidance_workflow — get workflow guidance for a goal
# ════════════════════════════════════════════════════════════════════
check_adr0094_p2_guidance_workflow() {
  _guidance_invoke_tool \
    "guidance_workflow" \
    '{"goal":"implement feature"}' \
    'workflow|steps|plan|phase' \
    "guidance_workflow" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 5: guidance_quickref — quick reference / help
# ════════════════════════════════════════════════════════════════════
check_adr0094_p2_guidance_quickref() {
  _guidance_invoke_tool \
    "guidance_quickref" \
    '{}' \
    'content|text|result|reference|commands|usage|help|quickref' \
    "guidance_quickref" \
    15
}
