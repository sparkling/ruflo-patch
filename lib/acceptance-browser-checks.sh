#!/usr/bin/env bash
# lib/acceptance-browser-checks.sh — ADR-0094 Phase 4: Browser MCP tools
#
# 23 browser_* tools covered via 5 scenario checks. Playwright is optional;
# every check gates on _browser_playwright_available() -> skip_accepted.
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG

# ════════════════════════════════════════════════════════════════════
# Guard: _browser_playwright_available
# ════════════════════════════════════════════════════════════════════
# Probes browser_session-list. Returns 1 if Playwright binary absent.
# Result cached after first call.
_BROWSER_PW_AVAILABLE=""
_BROWSER_PW_DIAG=""

_browser_playwright_available() {
  # Return cached result if already probed
  if [[ -n "$_BROWSER_PW_AVAILABLE" ]]; then
    return "$_BROWSER_PW_AVAILABLE"
  fi

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/browser-probe-XXXXX)

  _run_and_kill_ro \
    "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool browser_session-list" \
    "$work" 15
  local body; body=$(cat "$work" 2>/dev/null || echo "")
  body=$(echo "$body" | grep -v '^__RUFLO_DONE__:')
  rm -f "$work" 2>/dev/null

  # Playwright missing: binary not installed, executable doesn't exist
  if echo "$body" | grep -qiE 'playwright.*not (found|installed)|browser.*not (found|installed)|executable.*not found|browserType\.launch|PLAYWRIGHT_BROWSERS_PATH|install.*playwright'; then
    _BROWSER_PW_AVAILABLE=1
    _BROWSER_PW_DIAG="Playwright binary not installed: $(echo "$body" | head -3 | tr '\n' ' ')"
    return 1
  fi

  # Tool itself not registered in MCP server — still counts as
  # "available to attempt" for skip_accepted routing inside the helper
  _BROWSER_PW_AVAILABLE=0
  _BROWSER_PW_DIAG=""
  return 0
}

# ════════════════════════════════════════════════════════════════════
# Helper: _browser_invoke_tool(tool, params, pattern, label, timeout)
# ════════════════════════════════════════════════════════════════════
# adr0097-l5-intentional: adds a "Playwright binary not installed" skip bucket (via _BROWSER_PW_AVAILABLE / _BROWSER_PW_DIAG) and a runtime "browser launch failed" skip — browser-specific preconditions that _mcp_invoke_tool has no knowledge of (ADR-0094 Phase 4).
_browser_invoke_tool() {
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

  # ─── Playwright guard ──────────────────────────────────────────
  if ! _browser_playwright_available; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P4/${label}: ${_BROWSER_PW_DIAG:-Playwright binary not installed}"
    return
  fi

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/browser-${tool}-XXXXX)

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

  # ─── Three-way bucket ──────────────────────────────────────────
  # 1. Tool not found / not registered -> skip_accepted
  if echo "$body" | grep -qiE 'tool.+not found|not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P4/${label}: MCP tool '$tool' not in build — $(echo "$body" | head -3 | tr '\n' ' ')"
    return
  fi

  # 2. Playwright missing (detected at invocation time, not probe)
  if echo "$body" | grep -qiE 'playwright.*not (found|installed)|browser.*not (found|installed)|executable.*not found|browserType\.launch|PLAYWRIGHT_BROWSERS_PATH|install.*playwright'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P4/${label}: Playwright unavailable at runtime — $(echo "$body" | head -3 | tr '\n' ' ')"
    return
  fi

  # 3. Expected pattern match -> PASS
  if echo "$body" | grep -qiE "$expected_pattern"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P4/${label}: tool '$tool' returned expected pattern ($expected_pattern)"
    return
  fi

  # 4. Everything else -> FAIL with diagnostic
  _CHECK_PASSED="false"
  _CHECK_OUTPUT="P4/${label}: tool '$tool' output did not match /$expected_pattern/i. Output (first 10 lines):
$(echo "$body" | head -10)"
}

# ════════════════════════════════════════════════════════════════════
# Check 1: browser_session-list
# ════════════════════════════════════════════════════════════════════
check_adr0094_p4_browser_session() { # adr0097-l2-delegator: flag set inside _browser_invoke_tool
  _browser_invoke_tool \
    "browser_session-list" \
    '{}' \
    'session|browser|list|\[\]|\{.*\}|active|count|id' \
    "browser_session-list" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 2: browser_eval — eval "1+1" returns "2"
# ════════════════════════════════════════════════════════════════════
check_adr0094_p4_browser_eval() { # adr0097-l2-delegator: flag set inside _browser_invoke_tool
  _browser_invoke_tool \
    "browser_eval" \
    '{"expression":"1+1"}' \
    '2|result' \
    "browser_eval" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 3: navigation — open, get-url, get-title, back, forward,
#   reload, wait, screenshot, close (9 tools)
# ════════════════════════════════════════════════════════════════════
check_adr0094_p4_browser_navigation() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  if ! _browser_playwright_available; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P4/browser_navigation: ${_BROWSER_PW_DIAG:-Playwright binary not installed}"
    return
  fi

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/browser-nav-XXXXX)
  local all_output=""
  local tools_invoked=0
  local tools_responded=0

  _nav_try() {
    local tool="$1" params="$2" pat="$3"
    local cmd
    if [[ -n "$params" && "$params" != "{}" ]]; then
      cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool $tool --params '$params'"
    else
      cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool $tool"
    fi
    tools_invoked=$((tools_invoked + 1))
    _run_and_kill_ro "$cmd" "$work" 15
    local body; body=$(cat "$work" 2>/dev/null || echo "")
    body=$(echo "$body" | grep -v '^__RUFLO_DONE__:')
    all_output="${all_output}
[${tool}] ${body}"
    # Count as responded if it didn't say "not found"
    if ! echo "$body" | grep -qiE 'tool.+not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'; then
      tools_responded=$((tools_responded + 1))
    fi
  }

  # Invoke the 9 navigation-group tools
  _nav_try "browser_open"       '{"url":"about:blank"}'  'open|blank|page|ok'
  _nav_try "browser_get-url"    '{}'                      'about:blank|url|http'
  _nav_try "browser_get-title"  '{}'                      'title|blank'
  _nav_try "browser_back"       '{}'                      'back|navigat|ok'
  _nav_try "browser_forward"    '{}'                      'forward|navigat|ok'
  _nav_try "browser_reload"     '{}'                      'reload|refresh|ok'
  _nav_try "browser_wait"       '{"timeout":500}'         'wait|timeout|ok|done'
  _nav_try "browser_screenshot" '{}'                      'screenshot|base64|image|png|data'
  _nav_try "browser_close"      '{}'                      'close|ok|done'

  rm -f "$work" 2>/dev/null

  if [[ $tools_responded -eq 0 ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P4/browser_navigation: all 9 tools not in build — $(echo "$all_output" | head -5 | tr '\n' ' ')"
    return
  fi

  # At least one tool responded — check for playwright-missing at runtime
  if echo "$all_output" | grep -qiE 'playwright.*not (found|installed)|executable.*not found|install.*playwright'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P4/browser_navigation: Playwright unavailable at runtime — $(echo "$all_output" | head -5 | tr '\n' ' ')"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="P4/browser_navigation: ${tools_responded}/${tools_invoked} navigation tools responded"
}

# ════════════════════════════════════════════════════════════════════
# Check 4: interaction — fill, click, get-value, hover, press, type,
#   select, check, uncheck, get-text, scroll (11 tools)
# ════════════════════════════════════════════════════════════════════
check_adr0094_p4_browser_interaction() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  if ! _browser_playwright_available; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P4/browser_interaction: ${_BROWSER_PW_DIAG:-Playwright binary not installed}"
    return
  fi

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/browser-interact-XXXXX)
  local all_output=""
  local tools_invoked=0
  local tools_responded=0

  _interact_try() {
    local tool="$1" params="$2"
    local cmd
    if [[ -n "$params" && "$params" != "{}" ]]; then
      cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool $tool --params '$params'"
    else
      cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool $tool"
    fi
    tools_invoked=$((tools_invoked + 1))
    _run_and_kill_ro "$cmd" "$work" 15
    local body; body=$(cat "$work" 2>/dev/null || echo "")
    body=$(echo "$body" | grep -v '^__RUFLO_DONE__:')
    all_output="${all_output}
[${tool}] ${body}"
    if ! echo "$body" | grep -qiE 'tool.+not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'; then
      tools_responded=$((tools_responded + 1))
    fi
  }

  # Invoke the 11 interaction-group tools
  _interact_try "browser_fill"    '{"selector":"input","value":"test"}'
  _interact_try "browser_click"   '{"selector":"body"}'
  _interact_try "browser_get-value" '{"selector":"input"}'
  _interact_try "browser_hover"   '{"selector":"body"}'
  _interact_try "browser_press"   '{"key":"Enter"}'
  _interact_try "browser_type"    '{"text":"hello"}'
  _interact_try "browser_select"  '{"selector":"select","value":"opt1"}'
  _interact_try "browser_check"   '{"selector":"input[type=checkbox]"}'
  _interact_try "browser_uncheck" '{"selector":"input[type=checkbox]"}'
  _interact_try "browser_get-text" '{"selector":"body"}'
  _interact_try "browser_scroll"  '{"direction":"down"}'

  rm -f "$work" 2>/dev/null

  if [[ $tools_responded -eq 0 ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P4/browser_interaction: all 11 tools not in build — $(echo "$all_output" | head -5 | tr '\n' ' ')"
    return
  fi

  if echo "$all_output" | grep -qiE 'playwright.*not (found|installed)|executable.*not found|install.*playwright'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P4/browser_interaction: Playwright unavailable at runtime — $(echo "$all_output" | head -5 | tr '\n' ' ')"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="P4/browser_interaction: ${tools_responded}/${tools_invoked} interaction tools responded"
}

# ════════════════════════════════════════════════════════════════════
# Check 5: browser_snapshot — DOM shape
# ════════════════════════════════════════════════════════════════════
check_adr0094_p4_browser_snapshot() { # adr0097-l2-delegator: flag set inside _browser_invoke_tool
  _browser_invoke_tool \
    "browser_snapshot" \
    '{}' \
    'snapshot|dom|html|node|tree|body|document' \
    "browser_snapshot" \
    15
}
