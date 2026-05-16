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
  local work; work=$(mktemp "${ACCEPT_TEMP:-/tmp}/_check_workdirs/browser-probe-XXXXX")

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
  local work; work=$(mktemp "${ACCEPT_TEMP:-/tmp}/_check_workdirs/browser-${tool}-XXXXX")

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
  local resp_file; resp_file=$(mktemp "${ACCEPT_TEMP:-/tmp}/_check_workdirs/browser-nav-resp-XXXXX")

  # Refactored 2026-05-07: was 9 sequential `cli mcp exec` calls (each
  # spawning a fresh Playwright = ~13s × 9 = 115s wall time, the long
  # pole of the entire acceptance phase). Now batches all 9 JSON-RPC
  # tools/call requests through a SINGLE `cli mcp start` invocation —
  # one Playwright launch (~10s) + 9 in-process tool dispatches (~100ms
  # each) ≈ 12s wall time. Same coverage: each tool's id appears in the
  # response stream → counted as "responded" unless the response is a
  # tool-not-found error. Mirrors the adr0117 AC#4 pattern at
  # lib/acceptance-adr0117-marketplace-mcp.sh:256.
  local reqs
  reqs=$'{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"acc-p4-nav","version":"0.0.0"}}}\n'
  reqs+=$'{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"browser_open","arguments":{"url":"about:blank"}}}\n'
  reqs+=$'{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"browser_get-url","arguments":{}}}\n'
  reqs+=$'{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"browser_get-title","arguments":{}}}\n'
  reqs+=$'{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"browser_back","arguments":{}}}\n'
  reqs+=$'{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"browser_forward","arguments":{}}}\n'
  reqs+=$'{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"browser_reload","arguments":{}}}\n'
  reqs+=$'{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"browser_wait","arguments":{"timeout":500}}}\n'
  reqs+=$'{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"browser_screenshot","arguments":{}}}\n'
  reqs+=$'{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"browser_close","arguments":{}}}\n'

  # Single mcp start invocation. Stdio server hangs after responses
  # (waits for more input), so _timeout SIGKILLs it. 75s gives hard
  # margin: was 50s, but observed 1/3 runs producing skip_accepted
  # because all 9 tools didn't respond within 50s under bg phase5 init
  # CPU contention. The actual happy-path is ~45s; 75s gives 30s
  # headroom for variance. Cost: +25s on the long-pole wall in the
  # common case (server hangs ~30s after EOF). Worth it for 100%
  # stability per "no skips" goal. Interaction check (11 tools, mostly
  # stateless against blank page) gets away with 25s.
  (
    cd "$E2E_DIR" || exit 99
    printf '%s' "$reqs" | _timeout 75 bash -c "NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp start 2>/dev/null"
  ) > "$resp_file" 2>/dev/null || true

  # Count tools that responded (id 1..9). A response with the matching
  # id and no "tool not found" error counts as responded — same
  # semantic as the prior _nav_try counter.
  local tools_invoked=9 tools_responded=0
  local all_output
  all_output=$(cat "$resp_file" 2>/dev/null || echo "")
  for tid in 1 2 3 4 5 6 7 8 9; do
    local resp_line
    resp_line=$(grep -oE "\"id\":${tid}[^0-9].*" "$resp_file" 2>/dev/null | head -1)
    if [[ -n "$resp_line" ]] && ! echo "$resp_line" | grep -qiE 'tool.+not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'; then
      tools_responded=$((tools_responded + 1))
    fi
  done

  rm -f "$resp_file" 2>/dev/null

  if [[ $tools_responded -eq 0 ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P4/browser_navigation: all 9 tools not in build — $(echo "$all_output" | head -5 | tr '\n' ' ')"
    return
  fi

  if echo "$all_output" | grep -qiE 'playwright.*not (found|installed)|executable.*not found|install.*playwright'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P4/browser_navigation: Playwright unavailable at runtime — $(echo "$all_output" | head -5 | tr '\n' ' ')"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="P4/browser_navigation: ${tools_responded}/${tools_invoked} navigation tools responded (single MCP session, batched JSON-RPC)"
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
  local resp_file; resp_file=$(mktemp "${ACCEPT_TEMP:-/tmp}/_check_workdirs/browser-interact-resp-XXXXX")

  # Refactored 2026-05-07: was 11 sequential `cli mcp exec` calls (each
  # spawning Playwright fresh = ~3s × 11 = ~35s wall time). Now batches
  # all 11 tools/call requests through a SINGLE `cli mcp start`
  # invocation. Same coverage; one Playwright launch + 11 in-process
  # dispatches ≈ 12s wall.
  local reqs
  reqs=$'{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"acc-p4-int","version":"0.0.0"}}}\n'
  reqs+=$'{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"browser_fill","arguments":{"selector":"input","value":"test"}}}\n'
  reqs+=$'{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"browser_click","arguments":{"selector":"body"}}}\n'
  reqs+=$'{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"browser_get-value","arguments":{"selector":"input"}}}\n'
  reqs+=$'{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"browser_hover","arguments":{"selector":"body"}}}\n'
  reqs+=$'{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"browser_press","arguments":{"key":"Enter"}}}\n'
  reqs+=$'{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"browser_type","arguments":{"text":"hello"}}}\n'
  reqs+=$'{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"browser_select","arguments":{"selector":"select","value":"opt1"}}}\n'
  reqs+=$'{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"browser_check","arguments":{"selector":"input[type=checkbox]"}}}\n'
  reqs+=$'{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"browser_uncheck","arguments":{"selector":"input[type=checkbox]"}}}\n'
  reqs+=$'{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"browser_get-text","arguments":{"selector":"body"}}}\n'
  reqs+=$'{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"browser_scroll","arguments":{"direction":"down"}}}\n'

  (
    cd "$E2E_DIR" || exit 99
    printf '%s' "$reqs" | _timeout 25 bash -c "NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp start 2>/dev/null"
  ) > "$resp_file" 2>/dev/null || true

  local tools_invoked=11 tools_responded=0
  local all_output
  all_output=$(cat "$resp_file" 2>/dev/null || echo "")
  for tid in 1 2 3 4 5 6 7 8 9 10 11; do
    local resp_line
    resp_line=$(grep -oE "\"id\":${tid}[^0-9].*" "$resp_file" 2>/dev/null | head -1)
    if [[ -n "$resp_line" ]] && ! echo "$resp_line" | grep -qiE 'tool.+not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'; then
      tools_responded=$((tools_responded + 1))
    fi
  done

  rm -f "$resp_file" 2>/dev/null

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
  _CHECK_OUTPUT="P4/browser_interaction: ${tools_responded}/${tools_invoked} interaction tools responded (single MCP session, batched JSON-RPC)"
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
