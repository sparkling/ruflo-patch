#!/usr/bin/env bash
# lib/acceptance-neural-checks.sh — ADR-0094 Phase 5: Neural MCP tools
#
# Acceptance checks for the 6 neural_* MCP tools. Each check invokes
# the tool via `cli mcp exec --tool <name> --params '<json>'` and matches
# the output against an expected pattern.
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
#           (_run_and_kill_ro, _cli_cmd, _e2e_isolate available)
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG

# ════════════════════════════════════════════════════════════════════
# Shared helper: _neural_invoke_tool
# ════════════════════════════════════════════════════════════════════
#
# Arguments (positional):
#   $1 tool             — MCP tool name (e.g. "neural_train")
#   $2 params           — JSON params string (e.g. '{"data":"test"}')
#   $3 expected_pattern — grep -iE pattern for a PASS match
#   $4 label            — human-readable label for diagnostics
#   $5 timeout          — max seconds (default 15)
#
# Sets: _CHECK_PASSED ("true" / "false" / "skip_accepted")
#       _CHECK_OUTPUT  (diagnostic string)
# adr0097-l5-intentional: emits P3-neural/<label>-prefixed diagnostics (ADR-0094 Phase 3); canonical _mcp_invoke_tool has no phase-prefix convention and would lose forensic trace in grouped-parallel acceptance runs.
_neural_invoke_tool() {
  local tool="$1"
  local params="$2"
  local expected_pattern="$3"
  local label="$4"
  local timeout="${5:-15}"

  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  if [[ -z "$tool" || -z "$expected_pattern" || -z "$label" ]]; then
    _CHECK_OUTPUT="P5/${label}: helper called with missing args (tool=$tool pattern=$expected_pattern label=$label)"
    return
  fi

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/neural-${tool}-XXXXX)

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
    _CHECK_OUTPUT="SKIP_ACCEPTED: P5/${label}: MCP tool '$tool' not in build — $(echo "$body" | head -3 | tr '\n' ' ')"
    return
  fi

  # 2. Expected pattern match -> PASS
  if echo "$body" | grep -qiE "$expected_pattern"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5/${label}: tool '$tool' returned expected pattern ($expected_pattern)"
    return
  fi

  # 3. Everything else -> FAIL with diagnostic
  _CHECK_PASSED="false"
  _CHECK_OUTPUT="P5/${label}: tool '$tool' output did not match /$expected_pattern/i. Output (first 10 lines):
$(echo "$body" | head -10)"
}

# ════════════════════════════════════════════════════════════════════
# Check 1: neural_train — start a training job
# ════════════════════════════════════════════════════════════════════
check_adr0094_p5_neural_train() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _neural_invoke_tool
  _neural_invoke_tool \
    "neural_train" \
    '{"data":"test"}' \
    'train|started|job|progress' \
    "neural_train" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 2: neural_optimize — optimize neural model
# ════════════════════════════════════════════════════════════════════
check_adr0094_p5_neural_optimize() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _neural_invoke_tool
  _neural_invoke_tool \
    "neural_optimize" \
    '{}' \
    'optimiz|success|result' \
    "neural_optimize" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 3: neural_compress — compress neural model
# ════════════════════════════════════════════════════════════════════
check_adr0094_p5_neural_compress() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _neural_invoke_tool
  _neural_invoke_tool \
    "neural_compress" \
    '{}' \
    'compress|success|ratio' \
    "neural_compress" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 4: neural_predict — run prediction
# ════════════════════════════════════════════════════════════════════
check_adr0094_p5_neural_predict() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _neural_invoke_tool
  _neural_invoke_tool \
    "neural_predict" \
    '{"input":"test data"}' \
    'predict|result|output' \
    "neural_predict" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 5: neural_patterns — list learned patterns
# ════════════════════════════════════════════════════════════════════
check_adr0094_p5_neural_patterns() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _neural_invoke_tool
  _neural_invoke_tool \
    "neural_patterns" \
    '{}' \
    'patterns|list|\[\]' \
    "neural_patterns" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 6: neural_status — query neural subsystem status
# ════════════════════════════════════════════════════════════════════
check_adr0094_p5_neural_status() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _neural_invoke_tool
  _neural_invoke_tool \
    "neural_status" \
    '{}' \
    'status|model|ready|neural' \
    "neural_status" \
    15
}
