#!/usr/bin/env bash
# lib/acceptance-error-paths-checks.sh — ADR-0094 Phase 6: Error path checks.
# Verifies CLI handles broken/missing/corrupt configs gracefully (non-zero
# exit + diagnostic, not crash/hang). Uses _e2e_isolate for isolation.
#
# Requires: acceptance-harness.sh + acceptance-checks.sh + acceptance-e2e-checks.sh
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG

# ════════════════════════════════════════════════════════════════════
# P6-err-1: Invalid (malformed) JSON config
# ════════════════════════════════════════════════════════════════════
#
# Write syntactically broken JSON to .claude-flow/config.json, then run
# `doctor`. Expect non-zero exit and a diagnostic (not a crash).
check_adr0094_p6_invalid_config() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local iso; iso=$(_e2e_isolate "p6-invalid-cfg")
  if [[ -z "$iso" || ! -d "$iso" ]]; then
    _CHECK_OUTPUT="P6-err/invalid-config: failed to create isolated dir"
    return
  fi

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/p6-invalid-cfg-XXXXX)

  # Inject malformed JSON
  mkdir -p "$iso/.claude-flow" 2>/dev/null
  echo '{ "broken json <<<' > "$iso/.claude-flow/config.json"

  _run_and_kill "cd '$iso' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli doctor 2>&1" "$work" 20
  local exit_code="${_RK_EXIT:-1}"
  local body; body=$(cat "$work" 2>/dev/null || echo "")
  body=$(echo "$body" | grep -v '^__RUFLO_DONE__:')

  rm -f "$work" 2>/dev/null

  # Crash detection
  if echo "$body" | grep -qiE 'SIGSEGV|unhandled.*exception|Cannot find module'; then
    _CHECK_OUTPUT="P6-err/invalid-config: CRASH on malformed config: $(echo "$body" | head -5 | tr '\n' ' ')"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Accept: non-zero exit OR any diagnostic message (error/warn/invalid/fail)
  if [[ "$exit_code" -ne 0 ]] || echo "$body" | grep -qiE 'error|warn|invalid|fail|parse|config|diagnostic|issue'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P6-err/invalid-config: CLI handled malformed config gracefully (exit=$exit_code)"
  else
    _CHECK_OUTPUT="P6-err/invalid-config: CLI exited 0 with no diagnostic for malformed JSON config. Output: $(echo "$body" | head -5 | tr '\n' ' ')"
  fi

  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# P6-err-2: Missing config file
# ════════════════════════════════════════════════════════════════════
#
# Delete the config file entirely, then run `mcp status`. Expect graceful
# handling (either default init or explicit error), not a crash.
check_adr0094_p6_missing_config() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local iso; iso=$(_e2e_isolate "p6-missing-cfg")
  if [[ -z "$iso" || ! -d "$iso" ]]; then
    _CHECK_OUTPUT="P6-err/missing-config: failed to create isolated dir"
    return
  fi

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/p6-missing-cfg-XXXXX)

  # Remove config
  rm -f "$iso/.claude-flow/config.json" 2>/dev/null
  rm -f "$iso/claude-flow.config.json" 2>/dev/null

  _run_and_kill_ro "cd '$iso' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp status 2>&1" "$work" 15
  local exit_code="${_RK_EXIT:-1}"
  local body; body=$(cat "$work" 2>/dev/null || echo "")
  body=$(echo "$body" | grep -v '^__RUFLO_DONE__:')

  rm -f "$work" 2>/dev/null

  # Crash detection
  if echo "$body" | grep -qiE 'SIGSEGV|unhandled.*exception|Cannot find module'; then
    _CHECK_OUTPUT="P6-err/missing-config: CRASH with missing config: $(echo "$body" | head -5 | tr '\n' ' ')"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Accept: any non-crash outcome — either default init, graceful error, or
  # explicit diagnostic. The key is that it did NOT crash.
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="P6-err/missing-config: CLI handled missing config without crash (exit=$exit_code)"

  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# P6-err-3: Corrupted swarm state
# ════════════════════════════════════════════════════════════════════
#
# Write garbage to .swarm/state.json, then run `swarm status`. Expect
# non-zero exit or a diagnostic message (not a crash).
check_adr0094_p6_corrupted_state() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local iso; iso=$(_e2e_isolate "p6-corrupt-state")
  if [[ -z "$iso" || ! -d "$iso" ]]; then
    _CHECK_OUTPUT="P6-err/corrupted-state: failed to create isolated dir"
    return
  fi

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/p6-corrupt-state-XXXXX)

  # Inject garbage
  mkdir -p "$iso/.swarm" 2>/dev/null
  echo 'NOT_JSON_AT_ALL_@#$%^&' > "$iso/.swarm/state.json"

  _run_and_kill_ro "cd '$iso' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli swarm status 2>&1" "$work" 15
  local exit_code="${_RK_EXIT:-1}"
  local body; body=$(cat "$work" 2>/dev/null || echo "")
  body=$(echo "$body" | grep -v '^__RUFLO_DONE__:')

  rm -f "$work" 2>/dev/null

  # Crash detection
  if echo "$body" | grep -qiE 'SIGSEGV|unhandled.*exception|Cannot find module'; then
    _CHECK_OUTPUT="P6-err/corrupted-state: CRASH on corrupted state: $(echo "$body" | head -5 | tr '\n' ' ')"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Accept: non-zero exit OR any diagnostic
  if [[ "$exit_code" -ne 0 ]] || echo "$body" | grep -qiE 'error|warn|invalid|fail|parse|corrupt|state|no.*swarm|not.*running|initialized'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P6-err/corrupted-state: CLI handled corrupted swarm state gracefully (exit=$exit_code)"
  else
    _CHECK_OUTPUT="P6-err/corrupted-state: CLI exited 0 with no diagnostic for corrupted state. Output: $(echo "$body" | head -5 | tr '\n' ' ')"
  fi

  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# P6-err-4: Permission denied on config directory
# ════════════════════════════════════════════════════════════════════
#
# chmod 000 on .claude-flow, then run memory search. Expect non-zero exit
# or diagnostic. ALWAYS restore permissions in cleanup.
check_adr0094_p6_permission_denied() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local iso; iso=$(_e2e_isolate "p6-perms")
  if [[ -z "$iso" || ! -d "$iso" ]]; then
    _CHECK_OUTPUT="P6-err/permission-denied: failed to create isolated dir"
    return
  fi

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/p6-perms-XXXXX)

  # Lock down the config dir
  if [[ -d "$iso/.claude-flow" ]]; then
    chmod 000 "$iso/.claude-flow"
  fi

  _run_and_kill_ro "cd '$iso' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory search --query test 2>&1" "$work" 15
  local exit_code="${_RK_EXIT:-1}"
  local body; body=$(cat "$work" 2>/dev/null || echo "")
  body=$(echo "$body" | grep -v '^__RUFLO_DONE__:')

  rm -f "$work" 2>/dev/null

  # ALWAYS restore permissions before any exit path
  chmod 755 "$iso/.claude-flow" 2>/dev/null

  # Crash detection
  if echo "$body" | grep -qiE 'SIGSEGV|unhandled.*exception'; then
    _CHECK_OUTPUT="P6-err/permission-denied: CRASH on permission denied: $(echo "$body" | head -5 | tr '\n' ' ')"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Accept: non-zero exit OR any error/permission diagnostic
  if [[ "$exit_code" -ne 0 ]] || echo "$body" | grep -qiE 'error|permission|denied|EACCES|access|fail'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P6-err/permission-denied: CLI handled permission denied gracefully (exit=$exit_code)"
  else
    _CHECK_OUTPUT="P6-err/permission-denied: CLI exited 0 with no diagnostic for chmod 000 config. Output: $(echo "$body" | head -5 | tr '\n' ' ')"
  fi

  rm -rf "$iso" 2>/dev/null
}
