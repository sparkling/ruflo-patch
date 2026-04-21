#!/usr/bin/env bash
# lib/acceptance-cli-commands-checks.sh — ADR-0094 Phase 7: CLI command checks
#
# Invoke CLI subcommands with --help or minimal args, verify non-error exit
# and non-empty output. All checks are read-only — use _run_and_kill_ro.
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
#           (_run_and_kill_ro, _cli_cmd available)
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG

# ════════════════════════════════════════════════════════════════════
# Shared helper: _p7_cli_check
# ════════════════════════════════════════════════════════════════════
#
# Arguments (positional):
#   $1 subcmd           — CLI subcommand string (e.g. "--version", "init --help")
#   $2 expected_pattern — grep -iE pattern that output must match for PASS
#   $3 label            — human-readable label for diagnostics
#   $4 timeout          — max seconds (default 15)
#
# Sets: _CHECK_PASSED ("true" / "false")
#       _CHECK_OUTPUT  (diagnostic string)
_p7_cli_check() {
  local subcmd="$1"
  local expected_pattern="$2"
  local label="$3"
  local timeout="${4:-15}"

  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/p7-cli-${label}-XXXXX)

  local cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli $subcmd 2>&1"
  _run_and_kill_ro "$cmd" "$work" "$timeout"
  local exit_code="${_RK_EXIT:-1}"
  local body; body=$(cat "$work" 2>/dev/null || echo "")

  rm -f "$work" 2>/dev/null

  # ─── Exit code check ──────────────────────────────────────────
  if [[ "$exit_code" -ne 0 ]]; then
    _CHECK_OUTPUT="P7/${label}: exited ${exit_code} (expected 0). Output (first 10 lines):
$(echo "$body" | head -10)"
    return
  fi

  # ─── Non-empty output check ───────────────────────────────────
  if [[ -z "$body" ]]; then
    _CHECK_OUTPUT="P7/${label}: exited 0 but produced no output"
    return
  fi

  # ─── Pattern match ────────────────────────────────────────────
  if echo "$body" | grep -qiE "$expected_pattern"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P7/${label}: exits 0, output matches /${expected_pattern}/i"
    return
  fi

  _CHECK_PASSED="false"
  _CHECK_OUTPUT="P7/${label}: exited 0 but output did not match /${expected_pattern}/i. Output (first 10 lines):
$(echo "$body" | head -10)"
}

# ════════════════════════════════════════════════════════════════════
# Check 1: --version
# ════════════════════════════════════════════════════════════════════
check_adr0094_p7_cli_version() { # adr0097-l2-delegator: flag set inside _p7_cli_check
  _p7_cli_check \
    "--version" \
    '[0-9]+\.[0-9]+\.[0-9]+' \
    "cli_version" \
    10
}

# ════════════════════════════════════════════════════════════════════
# Check 2: doctor
# ════════════════════════════════════════════════════════════════════
check_adr0094_p7_cli_doctor() { # adr0097-l2-delegator: flag set inside _p7_cli_check
  _p7_cli_check \
    "doctor" \
    'diagnostic|check|pass|fail|ok|warn|doctor|health' \
    "cli_doctor" \
    30
}

# ════════════════════════════════════════════════════════════════════
# Check 3: init --help
# ════════════════════════════════════════════════════════════════════
check_adr0094_p7_cli_init_help() { # adr0097-l2-delegator: flag set inside _p7_cli_check
  _p7_cli_check \
    "init --help" \
    'usage|options|init|initialize|project' \
    "cli_init_help" \
    10
}

# ════════════════════════════════════════════════════════════════════
# Check 4: agent --help
# ════════════════════════════════════════════════════════════════════
check_adr0094_p7_cli_agent_help() { # adr0097-l2-delegator: flag set inside _p7_cli_check
  _p7_cli_check \
    "agent --help" \
    'usage|options|agent|spawn|list|status' \
    "cli_agent_help" \
    10
}

# ════════════════════════════════════════════════════════════════════
# Check 5: swarm --help
# ════════════════════════════════════════════════════════════════════
check_adr0094_p7_cli_swarm_help() { # adr0097-l2-delegator: flag set inside _p7_cli_check
  _p7_cli_check \
    "swarm --help" \
    'usage|options|swarm|init|topology' \
    "cli_swarm_help" \
    10
}

# ════════════════════════════════════════════════════════════════════
# Check 6: memory --help
# ════════════════════════════════════════════════════════════════════
check_adr0094_p7_cli_memory_help() { # adr0097-l2-delegator: flag set inside _p7_cli_check
  _p7_cli_check \
    "memory --help" \
    'usage|options|memory|store|search|list' \
    "cli_memory_help" \
    10
}

# ════════════════════════════════════════════════════════════════════
# Check 7: session --help
# ════════════════════════════════════════════════════════════════════
check_adr0094_p7_cli_session_help() { # adr0097-l2-delegator: flag set inside _p7_cli_check
  _p7_cli_check \
    "session --help" \
    'usage|options|session|save|restore|list' \
    "cli_session_help" \
    10
}

# ════════════════════════════════════════════════════════════════════
# Check 8: hooks --help
# ════════════════════════════════════════════════════════════════════
check_adr0094_p7_cli_hooks_help() { # adr0097-l2-delegator: flag set inside _p7_cli_check
  _p7_cli_check \
    "hooks --help" \
    'usage|options|hooks|pre-task|post-task|worker' \
    "cli_hooks_help" \
    10
}

# ════════════════════════════════════════════════════════════════════
# Check 9: mcp status
# ════════════════════════════════════════════════════════════════════
check_adr0094_p7_cli_mcp_status() { # adr0097-l2-delegator: flag set inside _p7_cli_check
  _p7_cli_check \
    "mcp status" \
    'mcp|status|tools|server|running|connected|transport' \
    "cli_mcp_status" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 10: status (system-level runtime info)
#
# NOTE: The CLI has no `system` subcommand (the error-suggested list is
# status / swarm / route). `status` is the closest semantic match — it
# reports RuFlo runtime state (swarm, agents, tasks, memory backend,
# MCP server) from within an init'd project (E2E_DIR is init'd).
# Function name is preserved so the test-acceptance.sh wiring
# (run_check_bg "p7-cli-system" → check_adr0094_p7_cli_system_info)
# stays intact; the check now exercises `status` instead.
# ════════════════════════════════════════════════════════════════════
check_adr0094_p7_cli_system_info() { # adr0097-l2-delegator: flag set inside _p7_cli_check
  _p7_cli_check \
    "status" \
    'ruflo|swarm|agents|tasks|memory|backend|mcp|status|stopped|running' \
    "cli_status" \
    30
}

# ════════════════════════════════════════════════════════════════════
# Check 11 (W4-A3): doctor never reports "npm not found" when npm IS on PATH
#
# Regression target: under parallel acceptance load (~8 concurrent CLI
# subprocesses), doctor.ts#checkNpmVersion's 5s execAsync timeout on
# `npm --version` fired in ~20% of runs. The old catch-all branch
# returned { status: 'fail', message: 'npm not found' }, flipping the
# process exit to 1 and surfacing as `p7-cli-doctor: exited 1`. This
# was a false product assertion — npm was clearly installed (the test
# harness itself had just used npm to install @sparkleideas/cli).
#
# W4-A3 fork fix: doctor.ts discriminates ENOENT (real "not found",
# reported as fail) from killed/signal (timeout, reported as warn) and
# any other catch (reported as warn). This check pins the invariant:
# if `npm --version` works in the shell, doctor must never claim
# "npm not found". It does NOT require doctor to pass overall (other
# warns are fine).
#
# Note: unlike check_adr0094_p7_cli_doctor which runs one parallel
# invocation of doctor, this check introduces real contention — it
# spawns 4 concurrent `cli doctor` subprocesses in the background and
# asserts that none of them emits "✗ npm Version: npm not found".
# ════════════════════════════════════════════════════════════════════
check_adr0094_p7_cli_doctor_npm_no_false_fail() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # Pre-flight: verify npm is actually on PATH. If not, the invariant
  # the check guards doesn't apply — report skip_accepted.
  if ! command -v npm >/dev/null 2>&1; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="W4-A3: npm not on PATH in harness — invariant not applicable"
    return
  fi

  local cli; cli=$(_cli_cmd)
  local tmpdir; tmpdir=$(mktemp -d /tmp/w4-a3-doctor-XXXXX)

  # Launch 4 concurrent doctor invocations (mirrors the parallel
  # acceptance pattern that originally tripped the flake).
  local pids=()
  local outs=()
  for i in 1 2 3 4; do
    local out="$tmpdir/doctor-$i.out"
    outs+=("$out")
    ( cd "$E2E_DIR" && NPM_CONFIG_REGISTRY="$REGISTRY" "$cli" doctor > "$out" 2>&1 ) &
    pids+=($!)
  done

  # Wait with a generous ceiling (4x single-run time is a safe upper bound).
  local deadline=$(( $(date +%s) + 60 ))
  for pid in "${pids[@]}"; do
    while kill -0 "$pid" 2>/dev/null && [[ "$(date +%s)" -lt "$deadline" ]]; do
      sleep 0.2
    done
    # Kill any stragglers — we don't fail on slow, only on false-fail content.
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
    wait "$pid" 2>/dev/null || true
  done

  # Scan every subprocess's output for the regression signature.
  local bad_runs=0
  local bad_first=""
  for out in "${outs[@]}"; do
    if [[ -f "$out" ]] && grep -qE '^[✗x][[:space:]]+npm Version:[[:space:]]+npm not found' "$out"; then
      bad_runs=$((bad_runs + 1))
      if [[ -z "$bad_first" ]]; then
        bad_first=$(grep -E '^[✗x][[:space:]]+npm Version' "$out" | head -1)
      fi
    fi
  done

  rm -rf "$tmpdir" 2>/dev/null

  if [[ "$bad_runs" -gt 0 ]]; then
    _CHECK_OUTPUT="W4-A3: doctor falsely reported 'npm not found' in ${bad_runs}/4 concurrent runs even though npm is on PATH. First offender: ${bad_first}"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="W4-A3: 4 concurrent doctor runs, none asserted 'npm not found' (pre-fix reliably flaked ~20%)"
}
