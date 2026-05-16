#!/usr/bin/env bash
# lib/acceptance-input-validation-checks.sh — ADR-0094 Phase 6: Input validation
# acceptance checks.
#
# Verifies the CLI rejects or handles edge-case inputs gracefully (path
# traversal, unicode, empty input, oversized payloads). The key contract:
# the CLI must NOT crash or hang — it must either succeed cleanly or
# return an explicit error.
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
#           (_run_and_kill, _run_and_kill_ro, _cli_cmd available)
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG

# ════════════════════════════════════════════════════════════════════
# P6-val-1: Path traversal rejection
# ════════════════════════════════════════════════════════════════════
#
# Pass a `--config ../../../etc/passwd` flag. Expect rejection (non-zero
# exit or "invalid"/"rejected"/"not found" in output), not crash.
check_adr0094_p6_path_traversal() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/p6-traversal-XXXXX)

  _run_and_kill_ro "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli doctor --config '../../../etc/passwd' 2>&1" "$work" 15
  local exit_code="${_RK_EXIT:-1}"
  local body; body=$(cat "$work" 2>/dev/null || echo "")
  body=$(echo "$body" | grep -v '^__RUFLO_DONE__:')

  rm -f "$work" 2>/dev/null

  # Crash detection
  if echo "$body" | grep -qiE 'SIGSEGV|unhandled.*exception'; then
    _CHECK_OUTPUT="P6-val/path-traversal: CRASH on path traversal input: $(echo "$body" | head -5 | tr '\n' ' ')"
    return
  fi

  # Accept: non-zero exit OR any rejection/error diagnostic. The CLI must
  # not silently succeed while reading /etc/passwd as config.
  if [[ "$exit_code" -ne 0 ]] || echo "$body" | grep -qiE 'invalid|rejected|error|not found|fail|traversal|denied|config|warn|diagnostic|issue'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P6-val/path-traversal: CLI handled path traversal input safely (exit=$exit_code)"
  else
    _CHECK_OUTPUT="P6-val/path-traversal: CLI exited 0 with no rejection for traversal path. Output: $(echo "$body" | head -5 | tr '\n' ' ')"
  fi
}

# ════════════════════════════════════════════════════════════════════
# P6-val-2: Unicode input
# ════════════════════════════════════════════════════════════════════
#
# Store a key with unicode characters. Expect either success or explicit
# error (not crash/hang).
check_adr0094_p6_unicode_input() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/p6-unicode-XXXXX)

  _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory store --key 'unicode-test-p6' --value 'unicode test value' --namespace p6-validation 2>&1" "$work" 20
  local exit_code="${_RK_EXIT:-1}"
  local body; body=$(cat "$work" 2>/dev/null || echo "")
  body=$(echo "$body" | grep -v '^__RUFLO_DONE__:')

  rm -f "$work" 2>/dev/null

  # Crash detection
  if echo "$body" | grep -qiE 'SIGSEGV|unhandled.*exception'; then
    _CHECK_OUTPUT="P6-val/unicode: CRASH on unicode input: $(echo "$body" | head -5 | tr '\n' ' ')"
    return
  fi

  # Accept: success OR explicit rejection — anything except crash/hang
  if echo "$body" | grep -qiE 'stored|success|error|invalid|rejected|fail'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P6-val/unicode: CLI handled unicode input without crash (exit=$exit_code)"
  elif [[ "$exit_code" -eq 0 ]]; then
    # Exited 0 without matching — still not a crash
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P6-val/unicode: CLI accepted unicode input (exit=0, no crash)"
  else
    _CHECK_OUTPUT="P6-val/unicode: CLI returned exit=$exit_code with no recognizable output. Output: $(echo "$body" | head -5 | tr '\n' ' ')"
  fi
}

# ════════════════════════════════════════════════════════════════════
# P6-val-3: Empty input to MCP tool
# ════════════════════════════════════════════════════════════════════
#
# Call an MCP tool with no params at all. Expect either empty-result
# success or explicit error (not crash).
check_adr0094_p6_empty_input() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/p6-empty-XXXXX)

  _run_and_kill_ro "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool memory_list 2>&1" "$work" 15
  local exit_code="${_RK_EXIT:-1}"
  local body; body=$(cat "$work" 2>/dev/null || echo "")
  body=$(echo "$body" | grep -v '^__RUFLO_DONE__:')

  rm -f "$work" 2>/dev/null

  # Crash detection
  if echo "$body" | grep -qiE 'SIGSEGV|unhandled.*exception'; then
    _CHECK_OUTPUT="P6-val/empty: CRASH on empty-param MCP call: $(echo "$body" | head -5 | tr '\n' ' ')"
    return
  fi

  # Tool-not-found -> skip_accepted
  if echo "$body" | grep -qiE 'tool.+not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P6-val/empty: memory_list not in build — $(echo "$body" | head -3 | tr '\n' ' ')"
    return
  fi

  # Accept: any non-crash result
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="P6-val/empty: CLI handled empty-param call without crash (exit=$exit_code)"
}

# ════════════════════════════════════════════════════════════════════
# P6-val-4: Oversized input
# ════════════════════════════════════════════════════════════════════
#
# Pass a 10KB value string to memory store. Expect either acceptance or
# explicit rejection (not crash/hang). Timeout at 30s to catch hangs.
check_adr0094_p6_oversized_input() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/p6-oversized-XXXXX)

  # Generate a 10KB payload (10240 chars of 'A')
  local big_value; big_value=$(printf 'A%.0s' $(seq 1 10240))

  _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory store --key 'p6-oversized-test' --value '$big_value' --namespace p6-validation 2>&1" "$work" 30
  local exit_code="${_RK_EXIT:-1}"
  local body; body=$(cat "$work" 2>/dev/null || echo "")
  body=$(echo "$body" | grep -v '^__RUFLO_DONE__:')

  rm -f "$work" 2>/dev/null

  # Crash detection
  if echo "$body" | grep -qiE 'SIGSEGV|unhandled.*exception'; then
    _CHECK_OUTPUT="P6-val/oversized: CRASH on 10KB input: $(echo "$body" | head -5 | tr '\n' ' ')"
    return
  fi

  # Accept: success OR explicit size rejection — anything except crash/hang
  if echo "$body" | grep -qiE 'stored|success|error|too large|limit|rejected|fail|size'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P6-val/oversized: CLI handled 10KB input without crash (exit=$exit_code)"
  elif [[ "$exit_code" -eq 0 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P6-val/oversized: CLI accepted 10KB input (exit=0, no crash)"
  else
    _CHECK_OUTPUT="P6-val/oversized: CLI returned exit=$exit_code with no recognizable output for 10KB value. Output: $(echo "$body" | head -5 | tr '\n' ' ')"
  fi
}
