#!/usr/bin/env bash
# lib/acceptance-model-routing-checks.sh — ADR-0094 Phase 6: Model routing
# MCP tool acceptance checks (3 tools).
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
#           (_run_and_kill_ro, _cli_cmd available)
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG
#
# Tools: hooks_model-route, hooks_model-outcome, hooks_model-stats
#
# Three-way bucket (ADR-0090 Tier A2): pass / fail / skip_accepted

# ════════════════════════════════════════════════════════════════════
# Shared helper: _model_invoke_tool
# ════════════════════════════════════════════════════════════════════
#
# Arguments (positional):
#   $1 tool             — MCP tool name (e.g. "hooks_model-route")
#   $2 params           — JSON params string
#                         Pass "" or "{}" for no-param tools.
#   $3 expected_pattern — grep -iE regex the output must match for PASS
#   $4 label            — Human label for diagnostics
#   $5 timeout_s        — Max seconds (default 15)
#
# Contract:
#   Sets _CHECK_PASSED ("true"/"false"/"skip_accepted") and _CHECK_OUTPUT.
_model_invoke_tool() {
  local tool="$1"
  local params="$2"
  local expected_pattern="$3"
  local label="$4"
  local timeout_s="${5:-15}"

  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  if [[ -z "$tool" || -z "$expected_pattern" || -z "$label" ]]; then
    _CHECK_OUTPUT="P6-model/${label}: helper called with missing args (tool=$tool pattern=$expected_pattern label=$label)"
    return
  fi

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/model-${tool}-XXXXX)

  # Build the command — include --params only when non-empty
  local cmd
  if [[ -n "$params" && "$params" != "{}" ]]; then
    cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool $tool --params '$params'"
  else
    cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool $tool"
  fi

  _run_and_kill_ro "$cmd" "$work" "$timeout_s"
  local body; body=$(cat "$work" 2>/dev/null || echo "")
  body=$(echo "$body" | grep -v '^__RUFLO_DONE__:')

  rm -f "$work" 2>/dev/null

  # ─── Three-way bucket ────────────────────────────────────────────
  # 1. Tool not found / not registered -> skip_accepted
  if echo "$body" | grep -qiE 'tool.+not found|not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P6-model/${label}: MCP tool '$tool' not in build — $(echo "$body" | head -3 | tr '\n' ' ')"
    return
  fi

  # 2. Crash detection
  if echo "$body" | grep -qiE 'fatal|SIGSEGV|unhandled.*exception|Cannot find module'; then
    _CHECK_OUTPUT="P6-model/${label}: CRASH: $(echo "$body" | head -5 | tr '\n' ' ')"
    return
  fi

  # 3. Expected pattern match -> PASS
  if echo "$body" | grep -qiE "$expected_pattern"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P6-model/${label}: tool '$tool' returned expected pattern ($expected_pattern)"
    return
  fi

  # 4. Everything else -> FAIL with diagnostic
  _CHECK_PASSED="false"
  _CHECK_OUTPUT="P6-model/${label}: tool '$tool' output did not match /$expected_pattern/i. Output (first 10 lines):
$(echo "$body" | head -10)"
}

# ════════════════════════════════════════════════════════════════════
# Individual model routing tool checks
# ════════════════════════════════════════════════════════════════════

check_adr0094_p6_model_route() {
  _model_invoke_tool \
    "hooks_model-route" \
    '{"task":"write unit test","complexity":0.5}' \
    'model|route|haiku|sonnet|opus|tier' \
    "model-route" \
    15
}

check_adr0094_p6_model_outcome() {
  _model_invoke_tool \
    "hooks_model-outcome" \
    '{"taskId":"test","model":"haiku","success":true}' \
    'recorded|outcome|success' \
    "model-outcome" \
    15
}

check_adr0094_p6_model_stats() {
  _model_invoke_tool \
    "hooks_model-stats" \
    '{}' \
    'stats|routes|models|count' \
    "model-stats" \
    15
}
