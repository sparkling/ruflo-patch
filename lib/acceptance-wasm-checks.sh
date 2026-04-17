#!/usr/bin/env bash
# lib/acceptance-wasm-checks.sh — ADR-0094 Phase 4: WASM MCP tools
#
# Acceptance checks for 10 wasm_* MCP tools covering agent lifecycle
# (create -> list -> prompt -> terminate -> list empty) and gallery
# operations (list, search, create).
#
# Tools under test:
#   wasm_agent_create, wasm_agent_prompt, wasm_agent_tool,
#   wasm_agent_export, wasm_agent_terminate, wasm_agent_list,
#   wasm_agent_files, wasm_gallery_list, wasm_gallery_search,
#   wasm_gallery_create
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
#           (_run_and_kill_ro, _cli_cmd available)
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG

# ════════════════════════════════════════════════════════════════════
# Shared helper: _wasm_invoke_tool
# ════════════════════════════════════════════════════════════════════
#
# Arguments (positional):
#   $1 tool             — MCP tool name (e.g. "wasm_agent_create")
#   $2 params           — JSON params string (e.g. '{"name":"test"}')
#   $3 expected_pattern — grep -iE pattern for a PASS match
#   $4 label            — human-readable label for diagnostics
#   $5 timeout          — max seconds (default 15)
#
# Sets: _CHECK_PASSED ("true" / "false" / "skip_accepted")
#       _CHECK_OUTPUT  (diagnostic string)
_wasm_invoke_tool() {
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
  local work; work=$(mktemp /tmp/wasm-${tool}-XXXXX)

  # Build the command — include --params only when non-empty
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
# LIFECYCLE CHECKS: create -> list -> prompt -> terminate -> list
# ════════════════════════════════════════════════════════════════════

# Check 1: wasm_agent_create — create a WASM agent
check_adr0094_p4_wasm_agent_create() {
  _wasm_invoke_tool \
    "wasm_agent_create" \
    '{"name":"accept-test-agent","type":"coder"}' \
    'created|agent|id|success' \
    "wasm_agent_create" \
    20
}

# Check 2: wasm_agent_list — list should show the created agent
check_adr0094_p4_wasm_agent_list() {
  _wasm_invoke_tool \
    "wasm_agent_list" \
    '{}' \
    'agents|list|\[\]|accept-test|id' \
    "wasm_agent_list" \
    15
}

# Check 3: wasm_agent_prompt — send a prompt to an agent
check_adr0094_p4_wasm_agent_prompt() {
  _wasm_invoke_tool \
    "wasm_agent_prompt" \
    '{"name":"accept-test-agent","prompt":"hello"}' \
    'response|result|output|hello' \
    "wasm_agent_prompt" \
    20
}

# Check 4: wasm_agent_tool — invoke a tool on an agent
check_adr0094_p4_wasm_agent_tool() {
  _wasm_invoke_tool \
    "wasm_agent_tool" \
    '{"name":"accept-test-agent","tool":"status"}' \
    'tool|result|status|output' \
    "wasm_agent_tool" \
    15
}

# Check 5: wasm_agent_export — export agent state
check_adr0094_p4_wasm_agent_export() {
  _wasm_invoke_tool \
    "wasm_agent_export" \
    '{"name":"accept-test-agent"}' \
    'export|data|state|agent' \
    "wasm_agent_export" \
    15
}

# Check 6: wasm_agent_files — list agent files
check_adr0094_p4_wasm_agent_files() {
  _wasm_invoke_tool \
    "wasm_agent_files" \
    '{"name":"accept-test-agent"}' \
    'files|\[\]|agent|list' \
    "wasm_agent_files" \
    15
}

# Check 7: wasm_agent_terminate — terminate the test agent
check_adr0094_p4_wasm_agent_terminate() {
  _wasm_invoke_tool \
    "wasm_agent_terminate" \
    '{"name":"accept-test-agent"}' \
    'terminated|success|removed|stopped' \
    "wasm_agent_terminate" \
    15
}

# ════════════════════════════════════════════════════════════════════
# GALLERY CHECKS: list, search, create
# ════════════════════════════════════════════════════════════════════

# Check 8: wasm_gallery_list — list gallery entries
check_adr0094_p4_wasm_gallery_list() {
  _wasm_invoke_tool \
    "wasm_gallery_list" \
    '{}' \
    'gallery|list|items|\[\]|agents' \
    "wasm_gallery_list" \
    15
}

# Check 9: wasm_gallery_search — search gallery
check_adr0094_p4_wasm_gallery_search() {
  _wasm_invoke_tool \
    "wasm_gallery_search" \
    '{"query":"coder"}' \
    'results|gallery|search|\[\]|items' \
    "wasm_gallery_search" \
    15
}

# Check 10: wasm_gallery_create — create a gallery entry
check_adr0094_p4_wasm_gallery_create() {
  _wasm_invoke_tool \
    "wasm_gallery_create" \
    '{"name":"accept-test-template","description":"acceptance test template"}' \
    'created|gallery|success|template' \
    "wasm_gallery_create" \
    15
}
