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
check_adr0094_p7_cli_version() {
  _p7_cli_check \
    "--version" \
    '[0-9]+\.[0-9]+\.[0-9]+' \
    "cli_version" \
    10
}

# ════════════════════════════════════════════════════════════════════
# Check 2: doctor
# ════════════════════════════════════════════════════════════════════
check_adr0094_p7_cli_doctor() {
  _p7_cli_check \
    "doctor" \
    'diagnostic|check|pass|fail|ok|warn|doctor|health' \
    "cli_doctor" \
    30
}

# ════════════════════════════════════════════════════════════════════
# Check 3: init --help
# ════════════════════════════════════════════════════════════════════
check_adr0094_p7_cli_init_help() {
  _p7_cli_check \
    "init --help" \
    'usage|options|init|initialize|project' \
    "cli_init_help" \
    10
}

# ════════════════════════════════════════════════════════════════════
# Check 4: agent --help
# ════════════════════════════════════════════════════════════════════
check_adr0094_p7_cli_agent_help() {
  _p7_cli_check \
    "agent --help" \
    'usage|options|agent|spawn|list|status' \
    "cli_agent_help" \
    10
}

# ════════════════════════════════════════════════════════════════════
# Check 5: swarm --help
# ════════════════════════════════════════════════════════════════════
check_adr0094_p7_cli_swarm_help() {
  _p7_cli_check \
    "swarm --help" \
    'usage|options|swarm|init|topology' \
    "cli_swarm_help" \
    10
}

# ════════════════════════════════════════════════════════════════════
# Check 6: memory --help
# ════════════════════════════════════════════════════════════════════
check_adr0094_p7_cli_memory_help() {
  _p7_cli_check \
    "memory --help" \
    'usage|options|memory|store|search|list' \
    "cli_memory_help" \
    10
}

# ════════════════════════════════════════════════════════════════════
# Check 7: session --help
# ════════════════════════════════════════════════════════════════════
check_adr0094_p7_cli_session_help() {
  _p7_cli_check \
    "session --help" \
    'usage|options|session|save|restore|list' \
    "cli_session_help" \
    10
}

# ════════════════════════════════════════════════════════════════════
# Check 8: hooks --help
# ════════════════════════════════════════════════════════════════════
check_adr0094_p7_cli_hooks_help() {
  _p7_cli_check \
    "hooks --help" \
    'usage|options|hooks|pre-task|post-task|worker' \
    "cli_hooks_help" \
    10
}

# ════════════════════════════════════════════════════════════════════
# Check 9: mcp status
# ════════════════════════════════════════════════════════════════════
check_adr0094_p7_cli_mcp_status() {
  _p7_cli_check \
    "mcp status" \
    'mcp|status|tools|server|running|connected|transport' \
    "cli_mcp_status" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 10: system info
# ════════════════════════════════════════════════════════════════════
check_adr0094_p7_cli_system_info() {
  _p7_cli_check \
    "system info" \
    'system|info|version|node|platform|memory|os' \
    "cli_system_info" \
    15
}
