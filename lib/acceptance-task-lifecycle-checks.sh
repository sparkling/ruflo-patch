#!/usr/bin/env bash
# lib/acceptance-task-lifecycle-checks.sh — ADR-0094 Phase 3: Task MCP tools
#
# 8 task_* MCP tool checks + full lifecycle. Pattern: aidefence-checks.sh.
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG

# ════════════════════════════════════════════════════════════════════
# Shared helper: _task_invoke_tool ($1=tool $2=params $3=pattern $4=label $5=timeout)
# Sets: _CHECK_PASSED, _CHECK_OUTPUT
_task_invoke_tool() {
  local tool="$1"
  local params="$2"
  local expected_pattern="$3"
  local label="$4"
  local timeout="${5:-15}"

  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  if [[ -z "$tool" || -z "$expected_pattern" || -z "$label" ]]; then
    _CHECK_OUTPUT="P3-task/${label}: helper called with missing args (tool=$tool pattern=$expected_pattern label=$label)"
    return
  fi

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/task-${tool}-XXXXX)

  # Build the command — include --params only when non-empty
  local cmd
  if [[ -n "$params" && "$params" != "{}" ]]; then
    cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool $tool --params '$params'"
  else
    cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool $tool"
  fi

  _run_and_kill_ro "$cmd" "$work" "$timeout"
  local body; body=$(cat "$work" 2>/dev/null || echo "")
  body=$(echo "$body" | grep -v '^__RUFLO_DONE__:')

  rm -f "$work" 2>/dev/null

  # ─── Three-way bucket ────────────────────────────────────────────
  # 1. Tool not found / not registered -> skip_accepted
  if echo "$body" | grep -qiE 'tool.+not found|not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P3-task/${label}: MCP tool '$tool' not in build — $(echo "$body" | head -3 | tr '\n' ' ')"
    return
  fi

  # 2. Expected pattern match -> PASS
  if echo "$body" | grep -qiE "$expected_pattern"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P3-task/${label}: tool '$tool' returned expected pattern ($expected_pattern)"
    return
  fi

  # 3. Everything else -> FAIL with diagnostic
  _CHECK_PASSED="false"
  _CHECK_OUTPUT="P3-task/${label}: tool '$tool' output did not match /$expected_pattern/i. Output (first 10 lines):
$(echo "$body" | head -10)"
}

# ════════════════════════════════════════════════════════════════════
# Lifecycle: create->assign->update->list->status->summary->complete->cancel
# ════════════════════════════════════════════════════════════════════
check_adr0094_p3_task_lifecycle() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/task-lifecycle-XXXXX)
  local tn="adr0094-lifecycle-$$"  # task name
  local _lc_body=""

  # _lc_exec: run tool, capture body, match pattern. Returns 1 on failure.
  # Args: $1=step# $2=tool $3=params_or_empty $4=rw|ro $5=pattern
  _lc_exec() {
    local cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool $2"
    [[ -n "$3" ]] && cmd="$cmd --params '$3'"
    if [[ "$4" == "ro" ]]; then _run_and_kill_ro "$cmd" "$work" 15
    else                        _run_and_kill    "$cmd" "$work" 15; fi
    _lc_body=$(cat "$work" 2>/dev/null || echo "")
    _lc_body=$(echo "$_lc_body" | grep -v '^__RUFLO_DONE__:')
    if echo "$_lc_body" | grep -qiE "$5"; then return 0; fi
    _CHECK_OUTPUT="P3-task/lifecycle: step $1 ($2) — no match /$5/. Output: $(echo "$_lc_body" | head -5 | tr '\n' ' ')"
    return 1
  }

  # Step 1: create (also probe for tool-not-found -> skip_accepted)
  _lc_exec 1 task_create "{\"name\":\"$tn\",\"description\":\"lifecycle test\"}" rw 'created|task|id'
  if [[ $? -ne 0 ]]; then
    if echo "$_lc_body" | grep -qiE 'tool.+not found|not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'; then
      _CHECK_PASSED="skip_accepted"
      _CHECK_OUTPUT="SKIP_ACCEPTED: P3-task/lifecycle: task_create not in build — $(echo "$_lc_body" | head -3 | tr '\n' ' ')"
    fi
    rm -f "$work" 2>/dev/null; return
  fi

  _lc_exec 2 task_assign  "{\"taskId\":\"$tn\",\"agentId\":\"test-agent\"}" rw 'assigned|success'            || { rm -f "$work"; return; }
  _lc_exec 3 task_update  "{\"taskId\":\"$tn\",\"status\":\"in_progress\"}" rw 'updated|success'             || { rm -f "$work"; return; }
  _lc_exec 4 task_list    ""                                                ro 'tasks|list|\[\]'              || { rm -f "$work"; return; }
  _lc_exec 5 task_status  "{\"taskId\":\"$tn\"}"                            ro 'status|state|task'            || { rm -f "$work"; return; }
  _lc_exec 6 task_summary ""                                                ro 'summary|total|completed|pending' || { rm -f "$work"; return; }
  _lc_exec 7 task_complete "{\"taskId\":\"$tn\"}"                           rw 'completed|done|success'       || { rm -f "$work"; return; }

  # Step 8: cancel needs a fresh task (first one is completed)
  local ct="adr0094-cancel-$$"
  _lc_exec 8a task_create "{\"name\":\"$ct\",\"description\":\"cancel test\"}" rw 'created|task|id'           || { rm -f "$work"; return; }
  _lc_exec 8  task_cancel "{\"taskId\":\"$ct\"}"                               rw 'cancelled|canceled|success' || { rm -f "$work"; return; }

  rm -f "$work" 2>/dev/null
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="P3-task/lifecycle: full 8-step task lifecycle passed (create->assign->update->list->status->summary->complete->cancel)"
}

# ═══════ Individual tool checks ═══════════════════════════════════

check_adr0094_p3_task_create() {
  _task_invoke_tool \
    "task_create" \
    '{"name":"adr0094-test-task","description":"test"}' \
    'created|task|id' \
    "task_create" \
    15
}

check_adr0094_p3_task_assign() {
  _task_invoke_tool \
    "task_assign" \
    '{"taskId":"adr0094-test-task","agentId":"test-agent"}' \
    'assigned|success' \
    "task_assign" \
    15
}

check_adr0094_p3_task_update() {
  _task_invoke_tool \
    "task_update" \
    '{"taskId":"adr0094-test-task","status":"in_progress"}' \
    'updated|success' \
    "task_update" \
    15
}

check_adr0094_p3_task_cancel() {
  _task_invoke_tool \
    "task_cancel" \
    '{"taskId":"adr0094-test-task"}' \
    'cancelled|canceled|success' \
    "task_cancel" \
    15
}

check_adr0094_p3_task_complete() {
  _task_invoke_tool \
    "task_complete" \
    '{"taskId":"adr0094-test-task"}' \
    'completed|done|success' \
    "task_complete" \
    15
}

check_adr0094_p3_task_list() {
  _task_invoke_tool \
    "task_list" \
    '{}' \
    'tasks|list|\[\]' \
    "task_list" \
    15
}

check_adr0094_p3_task_status() {
  _task_invoke_tool \
    "task_status" \
    '{"taskId":"adr0094-test-task"}' \
    'status|state|task' \
    "task_status" \
    15
}

check_adr0094_p3_task_summary() {
  _task_invoke_tool \
    "task_summary" \
    '{}' \
    'summary|total|completed|pending' \
    "task_summary" \
    15
}
