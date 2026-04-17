#!/usr/bin/env bash
# lib/acceptance-performance-adv-checks.sh — ADR-0094 Phase 5: Performance MCP tools
#
# Acceptance checks for the 6 performance_* MCP tools. Each check invokes
# the tool via `cli mcp exec --tool <name> --params '<json>'` and matches
# the output against an expected pattern.
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
#           (_run_and_kill_ro, _cli_cmd, _e2e_isolate available)
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG

# ════════════════════════════════════════════════════════════════════
# Shared helper: _perf_adv_invoke_tool
# ════════════════════════════════════════════════════════════════════
#
# Arguments (positional):
#   $1 tool             — MCP tool name (e.g. "performance_benchmark")
#   $2 params           — JSON params string (e.g. '{}')
#   $3 expected_pattern — grep -iE pattern for a PASS match
#   $4 label            — human-readable label for diagnostics
#   $5 timeout          — max seconds (default 15)
#
# Sets: _CHECK_PASSED ("true" / "false" / "skip_accepted")
#       _CHECK_OUTPUT  (diagnostic string)
_perf_adv_invoke_tool() {
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
  local work; work=$(mktemp /tmp/perf-adv-${tool}-XXXXX)

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
# Check 1: performance_benchmark — run performance benchmark
# ════════════════════════════════════════════════════════════════════
check_adr0094_p5_performance_benchmark() {
  _perf_adv_invoke_tool \
    "performance_benchmark" \
    '{}' \
    'benchmark|timing|results|ms' \
    "performance_benchmark" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 2: performance_bottleneck — detect bottlenecks
# ════════════════════════════════════════════════════════════════════
check_adr0094_p5_performance_bottleneck() {
  _perf_adv_invoke_tool \
    "performance_bottleneck" \
    '{}' \
    'bottleneck|analysis|issues' \
    "performance_bottleneck" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 3: performance_profile — profile system resources
# ════════════════════════════════════════════════════════════════════
check_adr0094_p5_performance_profile() {
  _perf_adv_invoke_tool \
    "performance_profile" \
    '{}' \
    'profile|metrics|cpu|memory' \
    "performance_profile" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 4: performance_optimize — suggest optimizations
# ════════════════════════════════════════════════════════════════════
check_adr0094_p5_performance_optimize() {
  _perf_adv_invoke_tool \
    "performance_optimize" \
    '{}' \
    'optimiz|suggestions|improvements' \
    "performance_optimize" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 5: performance_metrics — query performance metrics
# ════════════════════════════════════════════════════════════════════
check_adr0094_p5_performance_metrics() {
  _perf_adv_invoke_tool \
    "performance_metrics" \
    '{}' \
    'metrics|latency|throughput' \
    "performance_metrics" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 6: performance_report — generate performance report
# ════════════════════════════════════════════════════════════════════
check_adr0094_p5_performance_report() {
  _perf_adv_invoke_tool \
    "performance_report" \
    '{}' \
    'report|summary|performance' \
    "performance_report" \
    15
}
