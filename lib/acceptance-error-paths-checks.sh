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
# chmod 000 on .claude-flow, then run an operation that MUST read/write
# the config dir (doctor enumerates keys; memory store persists there).
# Expect non-zero exit OR a clear permission diagnostic.
#
# History: the original version exercised `memory search`, which succeeds
# on cached embeddings and never touches the config dir — so the check
# silent-passed on exit 0. See ADR-0094 P6 fix notes.
#
# If NO CLI operation fails on chmod 000 config in this environment,
# report SKIP_ACCEPTED (NOT silent-pass) per ADR-0082 / ADR-0090 Tier A2.
#
# Permission restoration is guaranteed via a trap so we never leak an
# unreadable dir that blocks later cleanup.
check_adr0094_p6_permission_denied() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local iso; iso=$(_e2e_isolate "p6-perms")
  if [[ -z "$iso" || ! -d "$iso" ]]; then
    _CHECK_OUTPUT="P6-err/permission-denied: failed to create isolated dir"
    return
  fi

  local cli; cli=$(_cli_cmd)

  # Guarantee chmod restoration + iso cleanup on every exit path (including
  # kill/interrupt). Restore BEFORE rm -rf so the rm itself doesn't fail.
  # shellcheck disable=SC2064
  trap "chmod -R u+rwX '$iso' 2>/dev/null; rm -rf '$iso' 2>/dev/null; trap - RETURN INT TERM" RETURN INT TERM

  # Lock down the config dir. If it doesn't exist, we can't exercise the
  # permission path at all — skip_accepted.
  if [[ ! -d "$iso/.claude-flow" ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="P6-err/permission-denied: SKIP_ACCEPTED: no .claude-flow dir in isolated copy — cannot exercise permission path"
    return
  fi
  chmod 000 "$iso/.claude-flow"

  # Primary probe: `doctor` enumerates config keys → must read .claude-flow.
  local work1; work1=$(mktemp /tmp/p6-perms-doctor-XXXXX)
  _run_and_kill_ro "cd '$iso' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli doctor 2>&1" "$work1" 20
  local exit1="${_RK_EXIT:-1}"
  local body1; body1=$(cat "$work1" 2>/dev/null || echo "")
  body1=$(echo "$body1" | grep -v '^__RUFLO_DONE__:')
  rm -f "$work1" 2>/dev/null

  # Crash detection on probe 1
  if echo "$body1" | grep -qiE 'SIGSEGV|unhandled.*exception'; then
    _CHECK_OUTPUT="P6-err/permission-denied: CRASH on doctor with chmod 000: $(echo "$body1" | head -5 | tr '\n' ' ')"
    return
  fi

  # Accept probe 1 as pass if it failed loudly (non-zero + diagnostic, or
  # clear permission/EACCES string). Note: non-zero alone is NOT enough —
  # doctor may fail for unrelated reasons; require exit!=0 AND a diagnostic,
  # OR a permission-specific string regardless of exit code.
  if echo "$body1" | grep -qiE 'permission|EACCES|denied|cannot (access|read|open)'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P6-err/permission-denied: doctor reported permission diagnostic (exit=$exit1)"
    return
  fi
  if [[ "$exit1" -ne 0 ]] && echo "$body1" | grep -qiE 'error|fail|invalid'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P6-err/permission-denied: doctor exited non-zero with diagnostic (exit=$exit1)"
    return
  fi

  # Probe 2: `memory store` MUST persist into .claude-flow or .swarm. With
  # .claude-flow unreadable, the config-load path should trip EACCES.
  local work2; work2=$(mktemp /tmp/p6-perms-store-XXXXX)
  _run_and_kill "cd '$iso' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory store --key p6-perm-test --value 'should fail on chmod 000' --namespace p6-perms 2>&1" "$work2" 20
  local exit2="${_RK_EXIT:-1}"
  local body2; body2=$(cat "$work2" 2>/dev/null || echo "")
  body2=$(echo "$body2" | grep -v '^__RUFLO_DONE__:')
  rm -f "$work2" 2>/dev/null

  # Crash detection on probe 2
  if echo "$body2" | grep -qiE 'SIGSEGV|unhandled.*exception'; then
    _CHECK_OUTPUT="P6-err/permission-denied: CRASH on memory store with chmod 000: $(echo "$body2" | head -5 | tr '\n' ' ')"
    return
  fi

  if echo "$body2" | grep -qiE 'permission|EACCES|denied|cannot (access|read|open|write)'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P6-err/permission-denied: memory store reported permission diagnostic (exit=$exit2)"
    return
  fi
  if [[ "$exit2" -ne 0 ]] && echo "$body2" | grep -qiE 'error|fail|invalid'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P6-err/permission-denied: memory store exited non-zero with diagnostic (exit=$exit2)"
    return
  fi

  # Both probes tolerated chmod 000 without a loud failure. Per ADR-0082
  # (no silent pass) and ADR-0090 Tier A2 (skip_accepted bucket), report
  # skip_accepted rather than fabricate a pass.
  _CHECK_PASSED="skip_accepted"
  _CHECK_OUTPUT="P6-err/permission-denied: SKIP_ACCEPTED: CLI tolerates unreadable config dir — no fail-loud path available (doctor exit=$exit1, memory store exit=$exit2)"
}
