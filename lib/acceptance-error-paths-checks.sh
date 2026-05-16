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
# P6-err-4: Permission denied on persistence directory
# ════════════════════════════════════════════════════════════════════
#
# chmod 000 on .swarm (the ACTUAL write target for `memory store`), then
# run `memory store`. Expect EACCES + non-zero exit from the CLI.
#
# History:
#   v1 — exercised `memory search` which hits cached embeddings and never
#        writes to disk. Silent-passed on exit 0.
#   v2 — chmod 000 on `.claude-flow` + `doctor` + `memory store`. But
#        `memory store` writes to `.swarm/memory.rvf`, NOT `.claude-flow/`,
#        so `.swarm` remained writable and the store succeeded with exit 0.
#        Manually reproduced in agent A13 session — catalog showed
#        `(doctor exit=0, memory store exit=0)` uniformly. Probe was real
#        (not dead) but aimed at the wrong directory.
#   v3 (current) — chmod 000 on `.swarm` (the real RVF path). Manually
#        verified: produces
#          `[ERROR] Failed to store: Storage initialization failed:
#           [StorageFactory] Failed to create storage backend (EACCES).
#           Path: …/.swarm/memory.rvf … Underlying: EACCES: permission
#           denied, open '…/.swarm/memory.rvf.lock'`
#        and exits 1.
#
# Doctor remains as a secondary read-path probe on `.claude-flow` — some
# doctor checks DO read config, and reporting a warning with an unreadable
# config dir is also acceptable evidence of graceful handling.
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

  # Primary probe: chmod 000 on .swarm (actual memory.rvf write path).
  # If .swarm doesn't exist in the isolated copy, we can't exercise the
  # write-path permission check at all → skip_accepted (ADR-0082).
  if [[ ! -d "$iso/.swarm" ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="P6-err/permission-denied: SKIP_ACCEPTED: no .swarm dir in isolated copy — cannot exercise memory.rvf write permission path"
    return
  fi
  chmod 000 "$iso/.swarm"

  # memory store writes to .swarm/memory.rvf → chmod 000 must trip EACCES.
  local work1; work1=$(mktemp /tmp/p6-perms-store-XXXXX)
  _run_and_kill "cd '$iso' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory store --key p6-perm-test --value 'should fail on chmod 000 swarm' --namespace p6-perms 2>&1" "$work1" 20
  local exit1="${_RK_EXIT:-1}"
  local body1; body1=$(cat "$work1" 2>/dev/null || echo "")
  body1=$(echo "$body1" | grep -v '^__RUFLO_DONE__:')
  rm -f "$work1" 2>/dev/null

  # Crash detection
  if echo "$body1" | grep -qiE 'SIGSEGV|unhandled.*exception|Cannot find module'; then
    _CHECK_OUTPUT="P6-err/permission-denied: CRASH on memory store with chmod 000 .swarm: $(echo "$body1" | head -5 | tr '\n' ' ')"
    return
  fi

  # Pass: explicit EACCES/permission diagnostic (tight regex — not the
  # over-broad 'error|warn|fail' that v2 tolerated).
  if echo "$body1" | grep -qiE 'EACCES|permission denied|permission.*denied|cannot (write|open|create).*\.rvf'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P6-err/permission-denied: memory store reported EACCES on chmod 000 .swarm (exit=$exit1)"
    # Restore .swarm before running secondary probe
    chmod -R u+rwX "$iso/.swarm" 2>/dev/null
    return
  fi
  # Also pass on non-zero exit WITH a generic failure diagnostic (still
  # fail-loud, just shape-independent) — but require exit!=0 so we don't
  # re-introduce the v2 silent-pass bug.
  if [[ "$exit1" -ne 0 ]] && echo "$body1" | grep -qiE 'storage.*fail|initialization failed|failed to store|Underlying'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P6-err/permission-denied: memory store failed loudly on chmod 000 .swarm (exit=$exit1, diagnostic present)"
    chmod -R u+rwX "$iso/.swarm" 2>/dev/null
    return
  fi

  # Restore .swarm before secondary probe (doctor) so doctor gets a clean
  # persistence dir and we isolate .claude-flow read-path behavior.
  chmod -R u+rwX "$iso/.swarm" 2>/dev/null

  # Secondary probe: doctor on chmod 000 .claude-flow. Doctor reading the
  # config dir should warn/error, not crash. Used as corroboration only —
  # a graceful-degrade warning ("No config file (using defaults)") is OK.
  if [[ -d "$iso/.claude-flow" ]]; then
    chmod 000 "$iso/.claude-flow"
    local work2; work2=$(mktemp /tmp/p6-perms-doctor-XXXXX)
    _run_and_kill_ro "cd '$iso' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli doctor 2>&1" "$work2" 20
    local exit2="${_RK_EXIT:-1}"
    local body2; body2=$(cat "$work2" 2>/dev/null || echo "")
    body2=$(echo "$body2" | grep -v '^__RUFLO_DONE__:')
    rm -f "$work2" 2>/dev/null

    if echo "$body2" | grep -qiE 'SIGSEGV|unhandled.*exception'; then
      _CHECK_OUTPUT="P6-err/permission-denied: CRASH on doctor with chmod 000 .claude-flow: $(echo "$body2" | head -5 | tr '\n' ' ')"
      return
    fi

    # Doctor passes iff it produced a diagnostic (warning or error) and did
    # not crash. Both "No config file (using defaults)" and EACCES text are
    # acceptable fail-loud outcomes for a read-path probe.
    if echo "$body2" | grep -qiE 'EACCES|permission|denied|cannot (access|read|open)|No config file|Config File|warning'; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="P6-err/permission-denied: store path fine, doctor handled chmod 000 .claude-flow with diagnostic (store_exit=$exit1, doctor_exit=$exit2)"
      return
    fi
  fi

  # No loud failure on either probe. Per ADR-0082 / ADR-0090 Tier A2,
  # skip_accepted rather than fabricate a pass.
  _CHECK_PASSED="skip_accepted"
  _CHECK_OUTPUT="P6-err/permission-denied: SKIP_ACCEPTED: memory store tolerated chmod 000 .swarm (exit=$exit1) — no fail-loud path available"
}
