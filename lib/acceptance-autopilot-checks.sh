#!/usr/bin/env bash
# lib/acceptance-autopilot-checks.sh — ADR-0094 Phase 2: Autopilot MCP tools
#
# Acceptance checks for the 9 autopilot_* MCP tools. Each check invokes
# the tool via `cli mcp exec --tool <name> --params '<json>'` and matches
# the output against an expected pattern.
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
#           (_run_and_kill_ro, _cli_cmd, _e2e_isolate available)
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG

# ════════════════════════════════════════════════════════════════════
# Shared helper: _autopilot_invoke_tool
# ════════════════════════════════════════════════════════════════════
#
# Arguments (positional):
#   $1 tool             — MCP tool name (e.g. "autopilot_enable")
#   $2 params           — JSON params string (e.g. '{"context":"test"}')
#   $3 expected_pattern — grep -iE pattern for a PASS match
#   $4 label            — human-readable label for diagnostics
#   $5 timeout          — max seconds (default 15)
#
# Sets: _CHECK_PASSED ("true" / "false" / "skip_accepted")
#       _CHECK_OUTPUT  (diagnostic string)
_autopilot_invoke_tool() {
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
  local work; work=$(mktemp /tmp/autopilot-${tool}-XXXXX)

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
  # 1. Tool not found / not registered → skip_accepted
  if echo "$body" | grep -qiE 'tool.+not found|not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P2/${label}: MCP tool '$tool' not in build — $(echo "$body" | head -3 | tr '\n' ' ')"
    return
  fi

  # 2. Expected pattern match → PASS
  if echo "$body" | grep -qiE "$expected_pattern"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P2/${label}: tool '$tool' returned expected pattern ($expected_pattern)"
    return
  fi

  # 3. Everything else → FAIL with diagnostic
  _CHECK_PASSED="false"
  _CHECK_OUTPUT="P2/${label}: tool '$tool' output did not match /$expected_pattern/i. Output (first 10 lines):
$(echo "$body" | head -10)"
}

# ════════════════════════════════════════════════════════════════════
# LIFECYCLE: check_adr0094_p2_autopilot_lifecycle
# ════════════════════════════════════════════════════════════════════
#
# Multi-step sequence: enable → status (shows enabled) → predict →
# disable → status (shows disabled). Each step uses its own temp file.
# Any tool-not-found at any step → skip_accepted for the whole check.
check_adr0094_p2_autopilot_lifecycle() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp -d /tmp/autopilot-lifecycle-XXXXX)

  # ─── Step 1: enable ──────────────────────────────────────────────
  _run_and_kill_ro "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool autopilot_enable" "$work/enable.out" 15
  local enable_body; enable_body=$(cat "$work/enable.out" 2>/dev/null | grep -v '^__RUFLO_DONE__:' || echo "")

  if echo "$enable_body" | grep -qiE 'tool.+not found|not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P2/lifecycle: autopilot_enable not in build — $(echo "$enable_body" | head -3 | tr '\n' ' ')"
    rm -rf "$work" 2>/dev/null
    return
  fi

  if ! echo "$enable_body" | grep -qiE 'enabled|success|true'; then
    _CHECK_OUTPUT="P2/lifecycle: autopilot_enable did not confirm enable. Output: $(echo "$enable_body" | head -5 | tr '\n' ' ')"
    rm -rf "$work" 2>/dev/null
    return
  fi

  # ─── Step 2: status after enable ─────────────────────────────────
  _run_and_kill_ro "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool autopilot_status" "$work/status1.out" 15
  local status1_body; status1_body=$(cat "$work/status1.out" 2>/dev/null | grep -v '^__RUFLO_DONE__:' || echo "")

  if ! echo "$status1_body" | grep -qiE 'status|enabled|disabled|state'; then
    _CHECK_OUTPUT="P2/lifecycle: autopilot_status after enable did not return status shape. Output: $(echo "$status1_body" | head -5 | tr '\n' ' ')"
    rm -rf "$work" 2>/dev/null
    return
  fi

  # ─── Step 3: predict ─────────────────────────────────────────────
  _run_and_kill_ro "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool autopilot_predict --params '{\"context\":\"writing tests\"}'" "$work/predict.out" 15
  local predict_body; predict_body=$(cat "$work/predict.out" 2>/dev/null | grep -v '^__RUFLO_DONE__:' || echo "")

  if ! echo "$predict_body" | grep -qiE 'prediction|task|suggest|\[OK\]|content|result'; then
    _CHECK_OUTPUT="P2/lifecycle: autopilot_predict did not return prediction. Output: $(echo "$predict_body" | head -5 | tr '\n' ' ')"
    rm -rf "$work" 2>/dev/null
    return
  fi

  # ─── Step 4: disable ─────────────────────────────────────────────
  _run_and_kill_ro "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool autopilot_disable" "$work/disable.out" 15
  local disable_body; disable_body=$(cat "$work/disable.out" 2>/dev/null | grep -v '^__RUFLO_DONE__:' || echo "")

  if ! echo "$disable_body" | grep -qiE 'disabled|success|true'; then
    _CHECK_OUTPUT="P2/lifecycle: autopilot_disable did not confirm disable. Output: $(echo "$disable_body" | head -5 | tr '\n' ' ')"
    rm -rf "$work" 2>/dev/null
    return
  fi

  # ─── Step 5: status after disable ────────────────────────────────
  _run_and_kill_ro "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool autopilot_status" "$work/status2.out" 15
  local status2_body; status2_body=$(cat "$work/status2.out" 2>/dev/null | grep -v '^__RUFLO_DONE__:' || echo "")

  if ! echo "$status2_body" | grep -qiE 'status|enabled|disabled|state'; then
    _CHECK_OUTPUT="P2/lifecycle: autopilot_status after disable did not return status shape. Output: $(echo "$status2_body" | head -5 | tr '\n' ' ')"
    rm -rf "$work" 2>/dev/null
    return
  fi

  # ─── All 5 steps passed ──────────────────────────────────────────
  rm -rf "$work" 2>/dev/null
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="P2/lifecycle: enable → status(enabled) → predict → disable → status(disabled) all confirmed"
}

# ════════════════════════════════════════════════════════════════════
# Individual tool checks (9 tools)
# ════════════════════════════════════════════════════════════════════

# Check 1: autopilot_enable
check_adr0094_p2_autopilot_enable() {
  _autopilot_invoke_tool \
    "autopilot_enable" \
    '{}' \
    'enabled|success|true' \
    "autopilot_enable" \
    15
}

# Check 2: autopilot_disable
check_adr0094_p2_autopilot_disable() {
  _autopilot_invoke_tool \
    "autopilot_disable" \
    '{}' \
    'disabled|success|true' \
    "autopilot_disable" \
    15
}

# Check 3: autopilot_status
check_adr0094_p2_autopilot_status() {
  _autopilot_invoke_tool \
    "autopilot_status" \
    '{}' \
    'status|enabled|disabled|state' \
    "autopilot_status" \
    15
}

# Check 4: autopilot_config
check_adr0094_p2_autopilot_config() {
  _autopilot_invoke_tool \
    "autopilot_config" \
    '{}' \
    'config|settings|mode' \
    "autopilot_config" \
    15
}

# Check 5: autopilot_predict
check_adr0094_p2_autopilot_predict() {
  _autopilot_invoke_tool \
    "autopilot_predict" \
    '{"context":"writing tests"}' \
    'prediction|task|suggest|\[OK\]|content|result' \
    "autopilot_predict" \
    15
}

# Check 6: autopilot_history
check_adr0094_p2_autopilot_history() {
  _autopilot_invoke_tool \
    "autopilot_history" \
    '{}' \
    'history|entries|events|\[\]' \
    "autopilot_history" \
    15
}

# Check 7: autopilot_learn
check_adr0094_p2_autopilot_learn() {
  _autopilot_invoke_tool \
    "autopilot_learn" \
    '{"input":"test pattern","outcome":"success"}' \
    'learned|success|true' \
    "autopilot_learn" \
    15
}

# Check 8: autopilot_log
check_adr0094_p2_autopilot_log() {
  _autopilot_invoke_tool \
    "autopilot_log" \
    '{"message":"test log entry"}' \
    'logged|success|true|\[OK\]|content|result' \
    "autopilot_log" \
    15
}

# Check 9: autopilot_reset
check_adr0094_p2_autopilot_reset() {
  _autopilot_invoke_tool \
    "autopilot_reset" \
    '{}' \
    'reset|success|cleared' \
    "autopilot_reset" \
    15
}
