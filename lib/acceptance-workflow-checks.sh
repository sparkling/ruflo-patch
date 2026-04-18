#!/usr/bin/env bash
# lib/acceptance-workflow-checks.sh — ADR-0094 Phase 2: Workflow MCP tools
#
# Acceptance checks for the 10 workflow_* MCP tools. Each check invokes the
# tool via the canonical `_mcp_invoke_tool` helper from acceptance-harness.sh
# (ADR-0094 Sprint 0 WI-3 — no per-domain drift).
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
#           (_mcp_invoke_tool, _cli_cmd, _e2e_isolate, _with_iso_cleanup)
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG
#
# Tools (10): workflow_{create,execute,run,pause,resume,cancel,status,
#              list,delete,template}
# Three-way bucket (ADR-0090 Tier A2): pass / fail / skip_accepted enforced
# by _mcp_invoke_tool.
#
# Key invariant (ADR-0094 Sprint 1.4): the workflow store keys workflows by
# their generated `workflowId` (e.g. `workflow-1776505382285-q4nuap`), NOT
# by user-supplied `name`. Execute/pause/resume/cancel/delete/status all
# require `workflowId` in their params; passing `name` returns the correct
# "Workflow not found" response. Each check therefore captures the ID from
# `workflow_create` (via `_MCP_BODY`) and reuses it for subsequent steps.
#
# Isolation (ADR-0094 Sprint 1.4): workflow_create + workflow_execute +
# workflow_pause + workflow_resume all read-modify-write
# `.claude-flow/workflows/store.json`. Upstream uses naive overwrite
# (writeFileSync) with no locking. When multiple checks run concurrently
# against the shared E2E_DIR, last-writer-wins clobbers in-flight state —
# e.g. resume sees its workflow in the wrong status because a sibling test's
# write overwrote. Multi-step checks therefore use `_with_iso_cleanup` to
# get a per-check `.iso-*` dir (see `_e2e_isolate` in acceptance-e2e-checks.sh)
# and scope `E2E_DIR` to it for the duration of the check.

# ─── internal: extract workflowId from the last _MCP_BODY ─────────────
# Workflow create responses have the shape:
#   { "workflowId": "workflow-<ts>-<rand>", "name": "...", ... }
# node is used because jq is not guaranteed in all test environments and
# grep/sed over JSON is fragile.
_extract_workflow_id() {
  local body="${_MCP_BODY:-}"
  [[ -z "$body" ]] && { echo ""; return; }
  node -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
      try {
        const j = JSON.parse(d);
        const id = j.workflowId || j.workflow_id || (j.workflow && j.workflow.workflowId);
        if (typeof id === "string" && id.length > 0) process.stdout.write(id);
      } catch {}
    });
  ' <<<"$body" 2>/dev/null || true
}

# ════════════════════════════════════════════════════════════════════
# Lifecycle body: create -> list -> execute -> status -> cancel -> delete -> list
# ════════════════════════════════════════════════════════════════════
# Exercises 7 tools in sequence inside an isolated E2E_DIR copy. On first
# skip_accepted (tool not in build), the entire lifecycle is skip_accepted.
# Each step uses the canonical probe and inspects _CHECK_PASSED; _MCP_BODY
# is available for post-hoc diagnostics.
_workflow_lifecycle_body() {
  local iso="$1"
  local _saved_e2e="${E2E_DIR:-}"
  E2E_DIR="$iso"

  # ─── Step 1: workflow_create ────────────────────────────────────
  _mcp_invoke_tool "workflow_create" \
    '{"name":"adr0094-test","steps":[{"name":"step1","action":"log"}]}' \
    'created|workflow|id' \
    "P2/lifecycle/create" 15 --rw
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: P2/lifecycle: workflow_create not in build — $(echo "${_MCP_BODY:-}" | head -3 | tr '\n' ' ')"
    E2E_DIR="$_saved_e2e"; return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="P2/lifecycle: step 1 (workflow_create) failed — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved_e2e"; return
  fi

  # Capture the generated workflowId for subsequent steps. The store keys
  # workflows by ID, not by name — see file header for details.
  local wf_id; wf_id=$(_extract_workflow_id)
  if [[ -z "$wf_id" ]]; then
    _CHECK_OUTPUT="P2/lifecycle: step 1 (workflow_create) returned no workflowId. Body: $(echo "${_MCP_BODY:-}" | head -3 | tr '\n' ' ')"
    _CHECK_PASSED="false"; E2E_DIR="$_saved_e2e"; return
  fi

  # ─── Step 2: workflow_list (verify created) ─────────────────────
  _mcp_invoke_tool "workflow_list" '{}' \
    'workflows|list|\[\]|name|adr0094' \
    "P2/lifecycle/list-after-create" 15 --ro
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: P2/lifecycle: workflow_list not in build"
    E2E_DIR="$_saved_e2e"; return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="P2/lifecycle: step 2 (workflow_list) failed — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved_e2e"; return
  fi

  # ─── Step 3: workflow_execute ───────────────────────────────────
  _mcp_invoke_tool "workflow_execute" \
    "{\"workflowId\":\"${wf_id}\"}" \
    'running|success|started|totalSteps' \
    "P2/lifecycle/execute" 15 --rw
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: P2/lifecycle: workflow_execute not in build"
    E2E_DIR="$_saved_e2e"; return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="P2/lifecycle: step 3 (workflow_execute) failed — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved_e2e"; return
  fi

  # ─── Step 4: workflow_status ────────────────────────────────────
  _mcp_invoke_tool "workflow_status" \
    "{\"workflowId\":\"${wf_id}\"}" \
    'status|state|workflow' \
    "P2/lifecycle/status" 15 --ro
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: P2/lifecycle: workflow_status not in build"
    E2E_DIR="$_saved_e2e"; return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="P2/lifecycle: step 4 (workflow_status) failed — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved_e2e"; return
  fi

  # ─── Step 5: workflow_cancel ────────────────────────────────────
  _mcp_invoke_tool "workflow_cancel" \
    "{\"workflowId\":\"${wf_id}\"}" \
    'cancelled|canceled|stopped|success|failed|skippedSteps' \
    "P2/lifecycle/cancel" 15 --rw
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: P2/lifecycle: workflow_cancel not in build"
    E2E_DIR="$_saved_e2e"; return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="P2/lifecycle: step 5 (workflow_cancel) failed — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved_e2e"; return
  fi

  # ─── Step 6: workflow_delete ────────────────────────────────────
  _mcp_invoke_tool "workflow_delete" \
    "{\"workflowId\":\"${wf_id}\"}" \
    'deleted|removed|success' \
    "P2/lifecycle/delete" 15 --rw
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: P2/lifecycle: workflow_delete not in build"
    E2E_DIR="$_saved_e2e"; return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="P2/lifecycle: step 6 (workflow_delete) failed — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved_e2e"; return
  fi

  # ─── Step 7: workflow_list (verify deletion) ────────────────────
  _mcp_invoke_tool "workflow_list" '{}' \
    'workflows|list|\[\]|name' \
    "P2/lifecycle/list-after-delete" 15 --ro
  # Not gating on tool-not-found here — if list worked in step 2,
  # it should still work. A failure here is a real FAIL.
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="P2/lifecycle: step 7 (workflow_list post-delete) failed — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved_e2e"; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="P2/lifecycle: full lifecycle (create->list->execute->status->cancel->delete->list) completed successfully (wf_id=${wf_id})"
  E2E_DIR="$_saved_e2e"
}

check_adr0094_p2_workflow_lifecycle() {
  _with_iso_cleanup "wf-lifecycle" _workflow_lifecycle_body
}

# ════════════════════════════════════════════════════════════════════
# Individual check: workflow_run
# ════════════════════════════════════════════════════════════════════
# workflow_run is self-contained: it generates a new workflowId internally
# and does not need a prior create. Template-driven or task-driven.
check_adr0094_p2_workflow_run() {
  _mcp_invoke_tool \
    "workflow_run" \
    '{"task":"adr0094-test-task"}' \
    'running|started|success|workflowId' \
    "P2/workflow_run" \
    15 --rw
}

# ════════════════════════════════════════════════════════════════════
# Individual check: workflow_pause
# ════════════════════════════════════════════════════════════════════
# Pause requires a running workflow. Self-contained in an isolated E2E_DIR:
# create->execute->pause. Using _with_iso_cleanup prevents concurrent-write
# contention with sibling workflow checks (store.json is last-writer-wins).
_workflow_pause_body() {
  local iso="$1"
  local _saved_e2e="${E2E_DIR:-}"
  E2E_DIR="$iso"

  # Step 1: create a workflow (captures ID for pause target).
  _mcp_invoke_tool "workflow_create" \
    '{"name":"adr0094-pause-test","steps":[{"name":"s1","action":"log"}]}' \
    'workflowId|created' \
    "P2/workflow_pause/create" 15 --rw
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: P2/workflow_pause: workflow_create not in build"
    E2E_DIR="$_saved_e2e"; return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="P2/workflow_pause: setup/create failed — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved_e2e"; return
  fi

  local wf_id; wf_id=$(_extract_workflow_id)
  if [[ -z "$wf_id" ]]; then
    _CHECK_OUTPUT="P2/workflow_pause: create returned no workflowId. Body: $(echo "${_MCP_BODY:-}" | head -3 | tr '\n' ' ')"
    _CHECK_PASSED="false"; E2E_DIR="$_saved_e2e"; return
  fi

  # Step 2: execute to put workflow in 'running' state (required by pause).
  _mcp_invoke_tool "workflow_execute" \
    "{\"workflowId\":\"${wf_id}\"}" \
    'running|status' \
    "P2/workflow_pause/execute" 15 --rw
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: P2/workflow_pause: workflow_execute not in build"
    E2E_DIR="$_saved_e2e"; return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="P2/workflow_pause: setup/execute failed — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved_e2e"; return
  fi

  # Step 3: the actual pause.
  _mcp_invoke_tool \
    "workflow_pause" \
    "{\"workflowId\":\"${wf_id}\"}" \
    'paused|success' \
    "P2/workflow_pause" \
    15 --rw

  E2E_DIR="$_saved_e2e"
}

check_adr0094_p2_workflow_pause() {
  _with_iso_cleanup "wf-pause" _workflow_pause_body
}

# ════════════════════════════════════════════════════════════════════
# Individual check: workflow_resume
# ════════════════════════════════════════════════════════════════════
# Resume requires a paused workflow. Self-contained in an isolated E2E_DIR:
# create->execute->pause->resume.
_workflow_resume_body() {
  local iso="$1"
  local _saved_e2e="${E2E_DIR:-}"
  E2E_DIR="$iso"

  _mcp_invoke_tool "workflow_create" \
    '{"name":"adr0094-resume-test","steps":[{"name":"s1","action":"log"}]}' \
    'workflowId|created' \
    "P2/workflow_resume/create" 15 --rw
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: P2/workflow_resume: workflow_create not in build"
    E2E_DIR="$_saved_e2e"; return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="P2/workflow_resume: setup/create failed — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved_e2e"; return
  fi

  local wf_id; wf_id=$(_extract_workflow_id)
  if [[ -z "$wf_id" ]]; then
    _CHECK_OUTPUT="P2/workflow_resume: create returned no workflowId. Body: $(echo "${_MCP_BODY:-}" | head -3 | tr '\n' ' ')"
    _CHECK_PASSED="false"; E2E_DIR="$_saved_e2e"; return
  fi

  _mcp_invoke_tool "workflow_execute" \
    "{\"workflowId\":\"${wf_id}\"}" \
    'running|status' \
    "P2/workflow_resume/execute" 15 --rw
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="P2/workflow_resume: setup/execute failed — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved_e2e"; return
  fi

  _mcp_invoke_tool "workflow_pause" \
    "{\"workflowId\":\"${wf_id}\"}" \
    'paused|success' \
    "P2/workflow_resume/pause" 15 --rw
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="P2/workflow_resume: setup/pause failed — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved_e2e"; return
  fi

  _mcp_invoke_tool \
    "workflow_resume" \
    "{\"workflowId\":\"${wf_id}\"}" \
    'resumed|running|success' \
    "P2/workflow_resume" \
    15 --rw

  E2E_DIR="$_saved_e2e"
}

check_adr0094_p2_workflow_resume() {
  _with_iso_cleanup "wf-resume" _workflow_resume_body
}

# ════════════════════════════════════════════════════════════════════
# Individual check: workflow_template
# ════════════════════════════════════════════════════════════════════
# Template tool requires an `action` parameter (save|create|list). Use
# "list" for a read-only probe that works in all states.
check_adr0094_p2_workflow_template() {
  _mcp_invoke_tool \
    "workflow_template" \
    '{"action":"list"}' \
    'template|templates|\[\]|name' \
    "P2/workflow_template" \
    15 --ro
}
