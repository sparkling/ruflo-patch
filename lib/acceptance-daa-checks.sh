#!/usr/bin/env bash
# lib/acceptance-daa-checks.sh — ADR-0094 Phase 3: DAA (Dynamic Adaptive Agents) MCP tools
#
# Acceptance checks for the 8 daa_* MCP tools. Each check invokes
# the tool via `cli mcp exec --tool <name> --params '<json>'` and matches
# the output against an expected pattern.
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
#           (_run_and_kill_ro, _cli_cmd, _e2e_isolate available)
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG

# ════════════════════════════════════════════════════════════════════
# Shared helper: _daa_invoke_tool
# ════════════════════════════════════════════════════════════════════
#
# Arguments (positional):
#   $1 tool             — MCP tool name (e.g. "daa_agent_create")
#   $2 params           — JSON params string (e.g. '{"name":"daa-test"}')
#   $3 expected_pattern — grep -iE pattern for a PASS match
#   $4 label            — human-readable label for diagnostics
#   $5 timeout          — max seconds (default 15)
#
# Sets: _CHECK_PASSED ("true" / "false" / "skip_accepted")
#       _CHECK_OUTPUT  (diagnostic string)
_daa_invoke_tool() {
  local tool="$1"
  local params="$2"
  local expected_pattern="$3"
  local label="$4"
  local timeout="${5:-15}"

  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  if [[ -z "$tool" || -z "$expected_pattern" || -z "$label" ]]; then
    _CHECK_OUTPUT="P3/${label}: helper called with missing args (tool=$tool pattern=$expected_pattern label=$label)"
    return
  fi

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/daa-${tool}-XXXXX)

  # Build the command — include --params only when non-empty
  local cmd
  if [[ -n "$params" && "$params" != "{}" ]]; then
    cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool $tool --params '$params'"
  else
    cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool $tool"
  fi

  _run_and_kill_ro "$cmd" "$work" "$timeout"
  local body; body=$(cat "$work" 2>/dev/null || echo "")
  # Strip the sentinel line before matching
  body=$(echo "$body" | grep -v '^__RUFLO_DONE__:')

  rm -f "$work" 2>/dev/null

  # ─── Three-way bucket ────────────────────────────────────────────
  # 1. Tool not found / not registered -> skip_accepted (ADR-0096: narrow
  # to tool-registry phrasing only; bare "not found" matches domain errors
  # like "Agent not found" or "Workflow not found" — those are real handler
  # responses and must FAIL, not skip. See ADR-0096 skip-rot 2026-04-19.)
  if echo "$body" | grep -qiE 'tool.+not (found|registered)|unknown tool|no such tool|method .* not found|invalid tool|tool .* not found in registry'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P3/${label}: MCP tool '$tool' not in build — $(echo "$body" | head -3 | tr '\n' ' ')"
    return
  fi

  # 2. Expected pattern match -> PASS
  if echo "$body" | grep -qiE "$expected_pattern"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P3/${label}: tool '$tool' returned expected pattern ($expected_pattern)"
    return
  fi

  # 3. Everything else -> FAIL with diagnostic
  _CHECK_PASSED="false"
  _CHECK_OUTPUT="P3/${label}: tool '$tool' output did not match /$expected_pattern/i. Output (first 10 lines):
$(echo "$body" | head -10)"
}

# ════════════════════════════════════════════════════════════════════
# Check 1: daa_agent_create — create a dynamic adaptive agent
# ════════════════════════════════════════════════════════════════════
check_adr0094_p3_daa_agent_create() {
  _daa_invoke_tool \
    "daa_agent_create" \
    '{"name":"daa-test","type":"worker"}' \
    'created|agent|id' \
    "daa_agent_create" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 2: daa_agent_adapt — adapt agent behavior
# ════════════════════════════════════════════════════════════════════
# Self-provisions its own prerequisite agent (unique id per run) so the
# check does not rely on check-1 ordering (checks run in parallel) and
# avoids matching a stale `agentId:"daa-test"` that was never created
# with a real `id` field. The create call's failure is non-fatal: if
# the tool is missing entirely, the adapt call will report "not found"
# and _daa_invoke_tool routes that to skip_accepted correctly.
check_adr0094_p3_daa_agent_adapt() {
  # Isolated E2E dir — daa_agent_create and _daa_invoke_tool both write
  # to .claude-flow/daa/store.json in the shared $E2E_DIR. Under the
  # mega-parallel acceptance wave (~100 concurrent subprocesses), the
  # create→adapt store round-trip races with other daa writers and the
  # adapt call can observe "Agent not found" even after a successful
  # create. Previously masked by a broad "not found" skip gate; after
  # ADR-0096 narrowed that gate (commit 5ad8af7), the race became
  # visible as a real failure. Isolation gives this check a private
  # DAA store so the sequence is race-free.
  _with_iso_cleanup "p3-da-adapt" _check_adr0094_p3_daa_agent_adapt_body
}

_check_adr0094_p3_daa_agent_adapt_body() {
  local iso="$1"
  local _saved="${E2E_DIR:-}"
  E2E_DIR="$iso"

  local cli; cli=$(_cli_cmd)
  local aid="p3-adapt-$$-${RANDOM}"

  # Provision prerequisite agent; tolerate create failure so the adapt
  # call drives the assertion even when the tool is missing entirely.
  (cd "$E2E_DIR" && NPM_CONFIG_REGISTRY="$REGISTRY" \
    "$cli" mcp exec --tool daa_agent_create \
      --params "{\"id\":\"${aid}\",\"type\":\"worker\"}" \
      >/dev/null 2>&1) || true

  _daa_invoke_tool \
    "daa_agent_adapt" \
    "{\"agentId\":\"${aid}\",\"feedback\":\"optimize\",\"performanceScore\":0.9}" \
    'adapted|updated|success|adaptation' \
    "daa_agent_adapt" \
    30

  E2E_DIR="$_saved"
}

# ════════════════════════════════════════════════════════════════════
# Check 3: daa_cognitive_pattern — store a cognitive pattern
# ════════════════════════════════════════════════════════════════════
check_adr0094_p3_daa_cognitive_pattern() {
  _daa_invoke_tool \
    "daa_cognitive_pattern" \
    '{"pattern":"test-pattern","context":"acceptance"}' \
    'pattern|cognitive|stored' \
    "daa_cognitive_pattern" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 4: daa_knowledge_share — share knowledge between agents
# ════════════════════════════════════════════════════════════════════
check_adr0094_p3_daa_knowledge_share() {
  _daa_invoke_tool \
    "daa_knowledge_share" \
    '{"from":"daa-test","knowledge":"test data"}' \
    'shared|knowledge|success' \
    "daa_knowledge_share" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 5: daa_learning_status — query learning status
# ════════════════════════════════════════════════════════════════════
check_adr0094_p3_daa_learning_status() {
  _daa_invoke_tool \
    "daa_learning_status" \
    '{}' \
    'learning|status|patterns|progress' \
    "daa_learning_status" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 6: daa_performance_metrics — query DAA performance
# ════════════════════════════════════════════════════════════════════
check_adr0094_p3_daa_performance_metrics() {
  _daa_invoke_tool \
    "daa_performance_metrics" \
    '{}' \
    'performance|metrics|latency' \
    "daa_performance_metrics" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 7: daa_workflow_create — create a DAA workflow
# ════════════════════════════════════════════════════════════════════
#
# Note: daa_workflow_create requires BOTH `id` and `name` (per schema in
# forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/daa-tools.ts line 220).
# Passing only `name` stores the workflow under key `undefined`, which
# collides with every other parallel check and is not reproducible.
check_adr0094_p3_daa_workflow_create() {
  _daa_invoke_tool \
    "daa_workflow_create" \
    '{"id":"daa-wf-create-check","name":"daa-wf","steps":["step1"]}' \
    'created|workflow' \
    "daa_workflow_create" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Check 8: daa_workflow_execute — execute a DAA workflow
# ════════════════════════════════════════════════════════════════════
#
# Self-contained: create then execute in the same check, because all
# P3 checks run in parallel via `run_check_bg` and cannot assume the
# create check finished first. Also, sharing workflow ids across
# parallel checks is flaky (the DAA store is JSON file-based).
#
# Pre-W2-I8 root cause: handler returned `{success:false, error:'Workflow not found'}`
# when given a missing workflowId, and the `not found` substring matched
# the skip_accepted regex in _daa_invoke_tool, causing false skip_accepted
# even though the tool is registered and in the build/manifest.
check_adr0094_p3_daa_workflow_execute() {
  local wf_id="daa-wf-exec-check-$$"
  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/daa-wf-exec-XXXXX)

  # Step 1: create the workflow with a deterministic id
  local create_cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool daa_workflow_create --params '{\"id\":\"$wf_id\",\"name\":\"daa-wf-exec\",\"steps\":[\"s1\"]}'"
  _run_and_kill_ro "$create_cmd" "$work" 15
  local create_body; create_body=$(cat "$work" 2>/dev/null || echo "")
  create_body=$(echo "$create_body" | grep -v '^__RUFLO_DONE__:')

  # If the create step itself reports the tool missing, skip_accepted (narrow pattern)
  if echo "$create_body" | grep -qiE 'tool.+not (found|registered)|unknown tool|no such tool|method .* not found|invalid tool|tool .* not found in registry'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P3/daa_workflow_execute: prerequisite tool 'daa_workflow_create' not in build — $(echo "$create_body" | head -3 | tr '\n' ' ')"
    rm -f "$work" 2>/dev/null
    return
  fi

  # Step 2: execute the workflow we just created, matching on workflowId
  local exec_cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool daa_workflow_execute --params '{\"workflowId\":\"$wf_id\"}'"
  _run_and_kill_ro "$exec_cmd" "$work" 15
  local exec_body; exec_body=$(cat "$work" 2>/dev/null || echo "")
  exec_body=$(echo "$exec_body" | grep -v '^__RUFLO_DONE__:')
  rm -f "$work" 2>/dev/null

  # Classify execute output (narrow pattern — bare "not found" matches domain errors)
  if echo "$exec_body" | grep -qiE 'tool.+not (found|registered)|unknown tool|no such tool|method .* not found|invalid tool|tool .* not found in registry'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P3/daa_workflow_execute: MCP tool 'daa_workflow_execute' not in build — $(echo "$exec_body" | head -3 | tr '\n' ' ')"
    return
  fi

  # PASS: handler returns status:'running' and workflowId matching our id
  if echo "$exec_body" | grep -qiE 'running|executed' && echo "$exec_body" | grep -qF "$wf_id"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P3/daa_workflow_execute: tool executed workflow '$wf_id' to status running"
    return
  fi

  _CHECK_PASSED="false"
  _CHECK_OUTPUT="P3/daa_workflow_execute: unexpected output. Create output (first 5 lines):
$(echo "$create_body" | head -5)
Execute output (first 10 lines):
$(echo "$exec_body" | head -10)"
}
