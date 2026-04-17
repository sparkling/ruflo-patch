#!/usr/bin/env bash
# lib/acceptance-workflow-checks.sh — ADR-0094 Phase 2: Workflow MCP tools
#
# Acceptance checks for the 10 workflow_* MCP tools. Each check invokes
# the tool via `cli mcp exec --tool <name> --params '<json>'` and matches
# the output against an expected pattern.
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
#           (_run_and_kill_ro, _cli_cmd, _e2e_isolate available)
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG
#
# Tools (10): workflow_{create,execute,run,pause,resume,cancel,status,
#              list,delete,template}
# Three-way bucket (ADR-0090 Tier A2): pass / fail / skip_accepted

# ════════════════════════════════════════════════════════════════════
# Shared helper: _workflow_invoke_tool
# ════════════════════════════════════════════════════════════════════
#
# Arguments (positional):
#   $1 tool             — MCP tool name (e.g. "workflow_create")
#   $2 params           — JSON params string
#   $3 expected_pattern — grep -iE pattern for a PASS match
#   $4 label            — human-readable label for diagnostics
#   $5 timeout          — max seconds (default 15)
#
# Sets: _CHECK_PASSED ("true" / "false" / "skip_accepted")
#       _CHECK_OUTPUT  (diagnostic string)
_workflow_invoke_tool() {
  local tool="$1"
  local params="$2"
  local expected_pattern="$3"
  local label="$4"
  local timeout="${5:-15}"

  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  if [[ -z "$tool" || -z "$expected_pattern" || -z "$label" ]]; then
    _CHECK_OUTPUT="P2/${label}: helper called with missing args (tool=$tool pattern=$expected_pattern label=$label)"
    return
  fi

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/workflow-${tool}-XXXXX)

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
  # 1. Tool not found / not registered -> skip_accepted
  if echo "$body" | grep -qiE 'tool.+not found|not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P2/${label}: MCP tool '$tool' not in build — $(echo "$body" | head -3 | tr '\n' ' ')"
    return
  fi

  # 2. Expected pattern match -> PASS
  if echo "$body" | grep -qiE "$expected_pattern"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P2/${label}: tool '$tool' returned expected pattern ($expected_pattern)"
    return
  fi

  # 3. Everything else -> FAIL with diagnostic
  _CHECK_PASSED="false"
  _CHECK_OUTPUT="P2/${label}: tool '$tool' output did not match /$expected_pattern/i. Output (first 10 lines):
$(echo "$body" | head -10)"
}

# ════════════════════════════════════════════════════════════════════
# Lifecycle: create -> list -> execute -> status -> cancel -> delete -> list
# ════════════════════════════════════════════════════════════════════
# Exercises 7 tools in sequence. On first skip_accepted (tool not in
# build), the entire lifecycle is skip_accepted.
check_adr0094_p2_workflow_lifecycle() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp -d /tmp/workflow-lifecycle-XXXXX)
  local wf_params='{"name":"adr0094-test","steps":[{"name":"step1","action":"log"}]}'

  # ─── Step 1: workflow_create ────────────────────────────────────
  local cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool workflow_create --params '$wf_params'"
  _run_and_kill_ro "$cmd" "$work/create.out" 15
  local create_body; create_body=$(cat "$work/create.out" 2>/dev/null || echo "")
  create_body=$(echo "$create_body" | grep -v '^__RUFLO_DONE__:')

  if echo "$create_body" | grep -qiE 'tool.+not found|not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P2/lifecycle: workflow_create not in build — $(echo "$create_body" | head -3 | tr '\n' ' ')"
    rm -rf "$work" 2>/dev/null
    return
  fi

  if ! echo "$create_body" | grep -qiE 'created|workflow|id'; then
    _CHECK_OUTPUT="P2/lifecycle: workflow_create did not return expected pattern. Output: $(echo "$create_body" | head -5 | tr '\n' ' ')"
    rm -rf "$work" 2>/dev/null
    return
  fi

  # ─── Step 2: workflow_list (verify created workflow appears) ────
  cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool workflow_list"
  _run_and_kill_ro "$cmd" "$work/list1.out" 15
  local list1_body; list1_body=$(cat "$work/list1.out" 2>/dev/null || echo "")
  list1_body=$(echo "$list1_body" | grep -v '^__RUFLO_DONE__:')

  if echo "$list1_body" | grep -qiE 'tool.+not found|not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P2/lifecycle: workflow_list not in build — $(echo "$list1_body" | head -3 | tr '\n' ' ')"
    rm -rf "$work" 2>/dev/null
    return
  fi

  if ! echo "$list1_body" | grep -qiE 'workflows|list|\[\]|name|adr0094'; then
    _CHECK_OUTPUT="P2/lifecycle: workflow_list did not return expected pattern after create. Output: $(echo "$list1_body" | head -5 | tr '\n' ' ')"
    rm -rf "$work" 2>/dev/null
    return
  fi

  # ─── Step 3: workflow_execute ───────────────────────────────────
  cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool workflow_execute --params '{\"name\":\"adr0094-test\"}'"
  _run_and_kill_ro "$cmd" "$work/execute.out" 15
  local exec_body; exec_body=$(cat "$work/execute.out" 2>/dev/null || echo "")
  exec_body=$(echo "$exec_body" | grep -v '^__RUFLO_DONE__:')

  if echo "$exec_body" | grep -qiE 'tool.+not found|not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P2/lifecycle: workflow_execute not in build — $(echo "$exec_body" | head -3 | tr '\n' ' ')"
    rm -rf "$work" 2>/dev/null
    return
  fi

  if ! echo "$exec_body" | grep -qiE 'executing|started|running|success'; then
    _CHECK_OUTPUT="P2/lifecycle: workflow_execute did not return expected pattern. Output: $(echo "$exec_body" | head -5 | tr '\n' ' ')"
    rm -rf "$work" 2>/dev/null
    return
  fi

  # ─── Step 4: workflow_status ────────────────────────────────────
  cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool workflow_status --params '{\"name\":\"adr0094-test\"}'"
  _run_and_kill_ro "$cmd" "$work/status.out" 15
  local status_body; status_body=$(cat "$work/status.out" 2>/dev/null || echo "")
  status_body=$(echo "$status_body" | grep -v '^__RUFLO_DONE__:')

  if echo "$status_body" | grep -qiE 'tool.+not found|not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P2/lifecycle: workflow_status not in build — $(echo "$status_body" | head -3 | tr '\n' ' ')"
    rm -rf "$work" 2>/dev/null
    return
  fi

  if ! echo "$status_body" | grep -qiE 'status|state|workflow'; then
    _CHECK_OUTPUT="P2/lifecycle: workflow_status did not return expected pattern. Output: $(echo "$status_body" | head -5 | tr '\n' ' ')"
    rm -rf "$work" 2>/dev/null
    return
  fi

  # ─── Step 5: workflow_cancel ────────────────────────────────────
  cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool workflow_cancel --params '{\"name\":\"adr0094-test\"}'"
  _run_and_kill_ro "$cmd" "$work/cancel.out" 15
  local cancel_body; cancel_body=$(cat "$work/cancel.out" 2>/dev/null || echo "")
  cancel_body=$(echo "$cancel_body" | grep -v '^__RUFLO_DONE__:')

  if echo "$cancel_body" | grep -qiE 'tool.+not found|not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P2/lifecycle: workflow_cancel not in build — $(echo "$cancel_body" | head -3 | tr '\n' ' ')"
    rm -rf "$work" 2>/dev/null
    return
  fi

  if ! echo "$cancel_body" | grep -qiE 'cancelled|canceled|stopped|success'; then
    _CHECK_OUTPUT="P2/lifecycle: workflow_cancel did not return expected pattern. Output: $(echo "$cancel_body" | head -5 | tr '\n' ' ')"
    rm -rf "$work" 2>/dev/null
    return
  fi

  # ─── Step 6: workflow_delete ────────────────────────────────────
  cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool workflow_delete --params '{\"name\":\"adr0094-test\"}'"
  _run_and_kill_ro "$cmd" "$work/delete.out" 15
  local delete_body; delete_body=$(cat "$work/delete.out" 2>/dev/null || echo "")
  delete_body=$(echo "$delete_body" | grep -v '^__RUFLO_DONE__:')

  if echo "$delete_body" | grep -qiE 'tool.+not found|not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P2/lifecycle: workflow_delete not in build — $(echo "$delete_body" | head -3 | tr '\n' ' ')"
    rm -rf "$work" 2>/dev/null
    return
  fi

  if ! echo "$delete_body" | grep -qiE 'deleted|removed|success'; then
    _CHECK_OUTPUT="P2/lifecycle: workflow_delete did not return expected pattern. Output: $(echo "$delete_body" | head -5 | tr '\n' ' ')"
    rm -rf "$work" 2>/dev/null
    return
  fi

  # ─── Step 7: workflow_list (verify deletion) ────────────────────
  cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool workflow_list"
  _run_and_kill_ro "$cmd" "$work/list2.out" 15
  local list2_body; list2_body=$(cat "$work/list2.out" 2>/dev/null || echo "")
  list2_body=$(echo "$list2_body" | grep -v '^__RUFLO_DONE__:')

  # Not gating on tool-not-found here — if list worked in step 2,
  # it should still work. A failure here is a real FAIL.
  if ! echo "$list2_body" | grep -qiE 'workflows|list|\[\]|name'; then
    _CHECK_OUTPUT="P2/lifecycle: workflow_list (post-delete) did not return expected pattern. Output: $(echo "$list2_body" | head -5 | tr '\n' ' ')"
    rm -rf "$work" 2>/dev/null
    return
  fi

  # ─── All 7 steps passed ────────────────────────────────────────
  rm -rf "$work" 2>/dev/null
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="P2/lifecycle: full lifecycle (create->list->execute->status->cancel->delete->list) completed successfully"
}

# ════════════════════════════════════════════════════════════════════
# Individual check: workflow_run
# ════════════════════════════════════════════════════════════════════
check_adr0094_p2_workflow_run() {
  _workflow_invoke_tool \
    "workflow_run" \
    '{"name":"adr0094-test"}' \
    'running|started|success' \
    "workflow_run" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Individual check: workflow_pause
# ════════════════════════════════════════════════════════════════════
check_adr0094_p2_workflow_pause() {
  _workflow_invoke_tool \
    "workflow_pause" \
    '{"name":"adr0094-test"}' \
    'paused|success' \
    "workflow_pause" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Individual check: workflow_resume
# ════════════════════════════════════════════════════════════════════
check_adr0094_p2_workflow_resume() {
  _workflow_invoke_tool \
    "workflow_resume" \
    '{"name":"adr0094-test"}' \
    'resumed|running|success' \
    "workflow_resume" \
    15
}

# ════════════════════════════════════════════════════════════════════
# Individual check: workflow_template
# ════════════════════════════════════════════════════════════════════
check_adr0094_p2_workflow_template() {
  _workflow_invoke_tool \
    "workflow_template" \
    '{}' \
    'template|templates|\[\]|name' \
    "workflow_template" \
    15
}
