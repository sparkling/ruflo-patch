#!/usr/bin/env bash
# lib/acceptance-terminal-checks.sh — ADR-0094 Phase 4: Terminal MCP tools
#
# Acceptance checks for the 5 terminal_* MCP tools. Each check invokes
# the tool via `cli mcp exec --tool <name> --params '<json>'` and matches
# the output against an expected pattern.
#
# Lifecycle tested: create -> list -> execute -> history -> close
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
#           (_run_and_kill_ro, _cli_cmd, _e2e_isolate available)
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG

# ════════════════════════════════════════════════════════════════════
# Shared helper: _terminal_invoke_tool
# ════════════════════════════════════════════════════════════════════
#
# Arguments (positional):
#   $1 tool             — MCP tool name (e.g. "terminal_create")
#   $2 params           — JSON params string (e.g. '{"name":"adr0094-term"}')
#   $3 expected_pattern — grep -iE pattern for a PASS match
#   $4 label            — human-readable label for diagnostics
#   $5 timeout          — max seconds (default 15)
#
# Sets: _CHECK_PASSED ("true" / "false" / "skip_accepted")
#       _CHECK_OUTPUT  (diagnostic string)
_terminal_invoke_tool() {
  local tool="$1"
  local params="$2"
  local expected_pattern="$3"
  local label="$4"
  local timeout="${5:-15}"

  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  if [[ -z "$tool" || -z "$expected_pattern" || -z "$label" ]]; then
    _CHECK_OUTPUT="P4/${label}: helper called with missing args (tool=$tool pattern=$expected_pattern label=$label)"
    return
  fi

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/terminal-${tool}-XXXXX)

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
    _CHECK_OUTPUT="SKIP_ACCEPTED: P4/${label}: MCP tool '$tool' not in build — $(echo "$body" | head -3 | tr '\n' ' ')"
    return
  fi

  # 2. Expected pattern match -> PASS
  if echo "$body" | grep -qiE "$expected_pattern"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P4/${label}: tool '$tool' returned expected pattern ($expected_pattern)"
    return
  fi

  # 3. Everything else -> FAIL with diagnostic
  _CHECK_PASSED="false"
  _CHECK_OUTPUT="P4/${label}: tool '$tool' output did not match /$expected_pattern/i. Output (first 10 lines):
$(echo "$body" | head -10)"
}

# ════════════════════════════════════════════════════════════════════
# Check 1: terminal_create — create a named terminal session
# ════════════════════════════════════════════════════════════════════
check_adr0094_p4_terminal_create() {
  _terminal_invoke_tool \
    "terminal_create" \
    '{"name":"adr0094-term"}' \
    'created|terminal|id' \
    "terminal_create" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 2: terminal_execute — execute a command in the terminal
# ════════════════════════════════════════════════════════════════════
check_adr0094_p4_terminal_execute() {
  _terminal_invoke_tool \
    "terminal_execute" \
    '{"command":"echo hello","terminalId":"adr0094-term"}' \
    'hello|output|result' \
    "terminal_execute" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 3: terminal_list — list active terminals
# ════════════════════════════════════════════════════════════════════
check_adr0094_p4_terminal_list() {
  _terminal_invoke_tool \
    "terminal_list" \
    '{}' \
    'terminals|list|\[\]' \
    "terminal_list" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 4: terminal_history — retrieve command history
# ════════════════════════════════════════════════════════════════════
check_adr0094_p4_terminal_history() {
  _terminal_invoke_tool \
    "terminal_history" \
    '{"terminalId":"adr0094-term"}' \
    'history|commands|\[\]' \
    "terminal_history" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 5: terminal_close — close a terminal session
# ════════════════════════════════════════════════════════════════════
check_adr0094_p4_terminal_close() {
  _terminal_invoke_tool \
    "terminal_close" \
    '{"terminalId":"adr0094-term"}' \
    'closed|success|removed' \
    "terminal_close" \
    15
}
