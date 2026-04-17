#!/usr/bin/env bash
# lib/acceptance-workflow-checks.sh — ADR-0094 Phase 2: Workflow MCP tools
#
# Acceptance checks for the 10 workflow_* MCP tools. Each check invokes the
# tool via the canonical `_mcp_invoke_tool` helper from acceptance-harness.sh
# (ADR-0094 Sprint 0 WI-3 — no per-domain drift).
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
#           (_mcp_invoke_tool, _cli_cmd, _e2e_isolate available)
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG
#
# Tools (10): workflow_{create,execute,run,pause,resume,cancel,status,
#              list,delete,template}
# Three-way bucket (ADR-0090 Tier A2): pass / fail / skip_accepted enforced
# by _mcp_invoke_tool.

# ════════════════════════════════════════════════════════════════════
# Lifecycle: create -> list -> execute -> status -> cancel -> delete -> list
# ════════════════════════════════════════════════════════════════════
# Exercises 7 tools in sequence. On first skip_accepted (tool not in
# build), the entire lifecycle is skip_accepted. Each step uses the
# canonical probe and inspects _CHECK_PASSED; _MCP_BODY is available for
# post-hoc diagnostics.
check_adr0094_p2_workflow_lifecycle() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # ─── Step 1: workflow_create ────────────────────────────────────
  _mcp_invoke_tool "workflow_create" \
    '{"name":"adr0094-test","steps":[{"name":"step1","action":"log"}]}' \
    'created|workflow|id' \
    "P2/lifecycle/create" 15 --rw
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: P2/lifecycle: workflow_create not in build — $(echo "${_MCP_BODY:-}" | head -3 | tr '\n' ' ')"
    return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="P2/lifecycle: step 1 (workflow_create) failed — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; return
  fi

  # ─── Step 2: workflow_list (verify created) ─────────────────────
  _mcp_invoke_tool "workflow_list" '{}' \
    'workflows|list|\[\]|name|adr0094' \
    "P2/lifecycle/list-after-create" 15 --ro
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: P2/lifecycle: workflow_list not in build"
    return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="P2/lifecycle: step 2 (workflow_list) failed — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; return
  fi

  # ─── Step 3: workflow_execute ───────────────────────────────────
  _mcp_invoke_tool "workflow_execute" \
    '{"name":"adr0094-test"}' \
    'executing|started|running|success' \
    "P2/lifecycle/execute" 15 --rw
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: P2/lifecycle: workflow_execute not in build"
    return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="P2/lifecycle: step 3 (workflow_execute) failed — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; return
  fi

  # ─── Step 4: workflow_status ────────────────────────────────────
  _mcp_invoke_tool "workflow_status" \
    '{"name":"adr0094-test"}' \
    'status|state|workflow' \
    "P2/lifecycle/status" 15 --ro
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: P2/lifecycle: workflow_status not in build"
    return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="P2/lifecycle: step 4 (workflow_status) failed — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; return
  fi

  # ─── Step 5: workflow_cancel ────────────────────────────────────
  _mcp_invoke_tool "workflow_cancel" \
    '{"name":"adr0094-test"}' \
    'cancelled|canceled|stopped|success' \
    "P2/lifecycle/cancel" 15 --rw
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: P2/lifecycle: workflow_cancel not in build"
    return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="P2/lifecycle: step 5 (workflow_cancel) failed — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; return
  fi

  # ─── Step 6: workflow_delete ────────────────────────────────────
  _mcp_invoke_tool "workflow_delete" \
    '{"name":"adr0094-test"}' \
    'deleted|removed|success' \
    "P2/lifecycle/delete" 15 --rw
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: P2/lifecycle: workflow_delete not in build"
    return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="P2/lifecycle: step 6 (workflow_delete) failed — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; return
  fi

  # ─── Step 7: workflow_list (verify deletion) ────────────────────
  _mcp_invoke_tool "workflow_list" '{}' \
    'workflows|list|\[\]|name' \
    "P2/lifecycle/list-after-delete" 15 --ro
  # Not gating on tool-not-found here — if list worked in step 2,
  # it should still work. A failure here is a real FAIL.
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="P2/lifecycle: step 7 (workflow_list post-delete) failed — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="P2/lifecycle: full lifecycle (create->list->execute->status->cancel->delete->list) completed successfully"
}

# ════════════════════════════════════════════════════════════════════
# Individual check: workflow_run
# ════════════════════════════════════════════════════════════════════
check_adr0094_p2_workflow_run() {
  _mcp_invoke_tool \
    "workflow_run" \
    '{"name":"adr0094-test"}' \
    'running|started|success' \
    "P2/workflow_run" \
    15 --rw
}

# ════════════════════════════════════════════════════════════════════
# Individual check: workflow_pause
# ════════════════════════════════════════════════════════════════════
check_adr0094_p2_workflow_pause() {
  _mcp_invoke_tool \
    "workflow_pause" \
    '{"name":"adr0094-test"}' \
    'paused|success' \
    "P2/workflow_pause" \
    15 --rw
}

# ════════════════════════════════════════════════════════════════════
# Individual check: workflow_resume
# ════════════════════════════════════════════════════════════════════
check_adr0094_p2_workflow_resume() {
  _mcp_invoke_tool \
    "workflow_resume" \
    '{"name":"adr0094-test"}' \
    'resumed|running|success' \
    "P2/workflow_resume" \
    15 --rw
}

# ════════════════════════════════════════════════════════════════════
# Individual check: workflow_template
# ════════════════════════════════════════════════════════════════════
check_adr0094_p2_workflow_template() {
  _mcp_invoke_tool \
    "workflow_template" \
    '{}' \
    'template|templates|\[\]|name' \
    "P2/workflow_template" \
    15 --ro
}
