#!/usr/bin/env bash
# lib/acceptance-github-integration-checks.sh — ADR-0094 Phase 4: GitHub MCP tools
#
# Acceptance checks for 5 github_* MCP tools.
#
# ══════════════════════════════════════════════════════════════════════════════
# NOTE (2026-04-17 — A9 / ADR-0094-log):
# These tools are LOCAL-ONLY STUBS in the fork (see
# forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/github-tools.ts). They make
# NO GitHub API calls and do NOT read GITHUB_TOKEN. The previous
# `if [[ -z "$GITHUB_TOKEN" ]]; then skip_accepted fi` gate was therefore
# incorrect — it turned green for a reason that has nothing to do with what
# the tool actually does. That is exactly the class of silent-pass the
# ADR-0082 rule forbids.
#
# Corrected design:
#   - github_issue_track   → list issues (success:true, issues:[], total:N)
#   - github_pr_manage     → list PRs    (success:true, pullRequests:[], total:N)
#   - github_repo_analyze  → _stub:true marker + localData payload
#   - github_workflow      → _stub:true marker + localData payload
#   - github_metrics       → _stub:true marker + localData payload
#
# Patterns are NARROW — if the fork upgrades any of these from a local stub
# to a real GitHub-API call, the regex will no longer match the new response
# shape and the check will FAIL LOUDLY, forcing a re-evaluation. That is the
# ADR-0082 contract: acceptance checks must fail when the behavior they
# verify stops working, not pass silently.
# ══════════════════════════════════════════════════════════════════════════════
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

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/github-${tool}-XXXXX)

  # Build the command — include --params only when non-empty.
  # No GITHUB_TOKEN export: these tools are local stubs and do not touch the GH API.
  local cmd
  if [[ -n "$params" && "$params" != "{}" ]]; then
    cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool $tool --params '$params' 2>&1"
  else
    cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool $tool 2>&1"
  fi

  _run_and_kill_ro "$cmd" "$work" "$timeout"
  local body; body=$(cat "$work" 2>/dev/null || echo "")
  body=$(echo "$body" | grep -v '^__RUFLO_DONE__:')

  rm -f "$work" 2>/dev/null

  # ─── Buckets ─────────────────────────────────────────────────────
  # 1. Tool not found / not registered -> skip_accepted (tool de-scoped in build)
  if echo "$body" | grep -qiE 'tool.+not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'; then
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

  # 3. Everything else -> FAIL with diagnostic (ADR-0082: fail loudly)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT="P4/${label}: tool '$tool' output did not match /$expected_pattern/i. Output (first 10 lines):
$(echo "$body" | head -10)"
}

# ════════════════════════════════════════════════════════════════════
# Check 1: github_issue_track — list issues (real local-store handler)
# ════════════════════════════════════════════════════════════════════
# Default action is "list"; handler returns {success:true, issues:[...], total, open}.
# Pattern binds to the structural field names — if the shape changes, fail loudly.
check_adr0094_p4_github_issue_track() {
  _github_invoke_tool \
    "github_issue_track" \
    '{}' \
    '"issues"|"total"|"open"' \
    "github_issue_track" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 2: github_pr_manage — list PRs (real local-store handler)
# ════════════════════════════════════════════════════════════════════
# Default action is "list"; handler returns {success:true, pullRequests:[...], total, open}.
check_adr0094_p4_github_pr_manage() {
  _github_invoke_tool \
    "github_pr_manage" \
    '{}' \
    '"pullRequests"|"total"|"open"' \
    "github_pr_manage" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 3: github_metrics — documented local stub
# ════════════════════════════════════════════════════════════════════
# Handler returns {success:false, _stub:true, message:"...local-only stubs...",
#                  localData:{storedRepos, localIssueCount, localPrCount, ...}}.
# The _stub marker is load-bearing: when the fork implements real API calls,
# this regex will stop matching and the check will FAIL — forcing a rewrite.
check_adr0094_p4_github_metrics() {
  _github_invoke_tool \
    "github_metrics" \
    '{}' \
    '"_stub":\s*true|local-only stubs|"localData"' \
    "github_metrics" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 4: github_repo_analyze — records locally + returns _stub marker
# ════════════════════════════════════════════════════════════════════
# Handler persists the repo entry (storedRepos grows) AND returns
# {success:false, _stub:true, message:"...", localData:{repository, branch, lastAnalyzed, storedRepos}}.
check_adr0094_p4_github_repo_analyze() {
  _github_invoke_tool \
    "github_repo_analyze" \
    '{}' \
    '"_stub":\s*true|local-only stubs|"storedRepos"|"lastAnalyzed"' \
    "github_repo_analyze" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 5: github_workflow — documented local stub
# ════════════════════════════════════════════════════════════════════
# Handler returns {success:false, _stub:true, message:"...workflow operations require actual GitHub API access...",
#                  localData:{requestedAction, workflowId, ref}}.
check_adr0094_p4_github_workflow() {
  _github_invoke_tool \
    "github_workflow" \
    '{}' \
    '"_stub":\s*true|local-only stubs|"requestedAction"' \
    "github_workflow" \
    15
}
