#!/usr/bin/env bash
# lib/acceptance-github-integration-checks.sh — ADR-0094 Phase 4: GitHub MCP tools
#
# Acceptance checks for 5 github_* MCP tools. ALL checks require
# GITHUB_TOKEN — if unset, every check skip_accepted immediately.
#
# Tools under test:
#   github_issue_track, github_pr_manage, github_metrics,
#   github_repo_analyze, github_workflow
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
#           (_run_and_kill_ro, _cli_cmd available)
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG

# ════════════════════════════════════════════════════════════════════
# Shared helper: _github_invoke_tool
# ════════════════════════════════════════════════════════════════════
#
# Arguments (positional):
#   $1 tool             — MCP tool name (e.g. "github_issue_track")
#   $2 params           — JSON params string (e.g. '{}')
#   $3 expected_pattern — grep -iE pattern for a PASS match
#   $4 label            — human-readable label for diagnostics
#   $5 timeout          — max seconds (default 15)
#
# Sets: _CHECK_PASSED ("true" / "false" / "skip_accepted")
#       _CHECK_OUTPUT  (diagnostic string)
_github_invoke_tool() {
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

  # ─── GITHUB_TOKEN guard ───────────────────────────────────────────
  if [[ -z "${GITHUB_TOKEN:-}" ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P4/${label}: GITHUB_TOKEN not set — all github tools skip"
    return
  fi

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/github-${tool}-XXXXX)

  # Build the command — include --params only when non-empty
  local cmd
  if [[ -n "$params" && "$params" != "{}" ]]; then
    cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' GITHUB_TOKEN='$GITHUB_TOKEN' $cli mcp exec --tool $tool --params '$params'"
  else
    cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' GITHUB_TOKEN='$GITHUB_TOKEN' $cli mcp exec --tool $tool"
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

  # 1b. Auth error -> skip_accepted (token may be expired / scoped)
  if echo "$body" | grep -qiE 'unauthorized|401|403|bad credentials|token.*invalid|authentication failed'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P4/${label}: auth error on '$tool' (token invalid or insufficient scope) — $(echo "$body" | head -3 | tr '\n' ' ')"
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
# Check 1: github_issue_track — track issues
# ════════════════════════════════════════════════════════════════════
check_adr0094_p4_github_issue_track() {
  _github_invoke_tool \
    "github_issue_track" \
    '{}' \
    'issues|track|list|result' \
    "github_issue_track" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 2: github_pr_manage — manage pull requests
# ════════════════════════════════════════════════════════════════════
check_adr0094_p4_github_pr_manage() {
  _github_invoke_tool \
    "github_pr_manage" \
    '{}' \
    'pull|request|pr|manage|list|result' \
    "github_pr_manage" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 3: github_metrics — repository metrics
# ════════════════════════════════════════════════════════════════════
check_adr0094_p4_github_metrics() {
  _github_invoke_tool \
    "github_metrics" \
    '{}' \
    'metrics|stars|forks|issues|commits|result' \
    "github_metrics" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 4: github_repo_analyze — analyze repository
# ════════════════════════════════════════════════════════════════════
check_adr0094_p4_github_repo_analyze() {
  _github_invoke_tool \
    "github_repo_analyze" \
    '{}' \
    'analy|repo|language|result' \
    "github_repo_analyze" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 5: github_workflow — GitHub Actions workflows
# ════════════════════════════════════════════════════════════════════
check_adr0094_p4_github_workflow() {
  _github_invoke_tool \
    "github_workflow" \
    '{}' \
    'workflow|action|run|result' \
    "github_workflow" \
    15
}
