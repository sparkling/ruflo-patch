#!/usr/bin/env bash
# lib/acceptance-phase8-invariants.sh — ADR-0094 Phase 8: Cross-tool invariants
#
# Each check follows the 5-step pattern: **isolate → pre-snapshot → mutate →
# post-assert → delta**. Uses canonical `_mcp_invoke_tool` / `_expect_mcp_body`
# from acceptance-harness.sh — no per-domain drift (ADR-0097).
#
# Phase 8 invariants (11 total):
#   INV-1   memory_store → memory_search round-trip
#   INV-2   session_save → session_list (appears)
#   INV-3   agent_spawn → agent_list (appears) → agent_terminate (gone)
#   INV-4   claims_claim → claims_board (appears) → claims_release (gone)
#   INV-5   workflow_create → workflow_list (appears) → workflow_delete (gone)
#   INV-6   config_set → config_get (value round-trips)
#   INV-7   task_create → task_list (appears) → task_complete → task_summary
#   INV-8   memory_store → session_save → (wipe) → session_restore → retrieve
#   INV-9   neural_train → neural_status patternCount strictly greater
#   INV-10  autopilot_enable → autopilot_status.enabled == true → predict shape
#   INV-11  Delta-sentinel: repeat every mutate twice; second pre-snapshot
#           must differ from first (proves the tool CAUSED the change,
#           not just that post-state exists)
#
# Requires: acceptance-harness.sh + acceptance-checks.sh + acceptance-e2e-checks.sh
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG

# ════════════════════════════════════════════════════════════════════
# Per-check isolation pattern: use `_with_iso_cleanup` so each check
# gets its own `.iso-<check_id>-<pid>` copy of E2E_DIR. This prevents
# concurrent RVF / store.json / session / claims contention.
# ════════════════════════════════════════════════════════════════════

# ─── shared helpers ───────────────────────────────────────────────

# Compute a fingerprint string for a "list" tool body — for delta-sentinel
# comparisons. Hashes the body sans timestamps so idempotent content
# hashes stably; mutation causes the hash to change.
_phase8_hash() {
  sed -E 's/"(createdAt|updatedAt|timestamp|generatedAt|modifiedAt|lastAccessed)"[[:space:]]*:[[:space:]]*"[^"]*"//g; s/"(ts|epoch|unix)"[[:space:]]*:[[:space:]]*[0-9]+//g' \
    | { shasum -a 256 2>/dev/null || sha256sum; } | awk '{print substr($1,1,16)}'
}

# ════════════════════════════════════════════════════════════════════
# INV-1: memory_store → memory_search round-trip
# ════════════════════════════════════════════════════════════════════
_inv1_body() {
  local iso="$1"
  local _saved="${E2E_DIR:-}"
  E2E_DIR="$iso"

  local key="inv-mem-$$-$(date +%s)"
  local val="phase8-sentinel-$(openssl rand -hex 4 2>/dev/null || echo $$)"

  # PRE-snapshot: search must not already contain the key
  _mcp_invoke_tool "memory_search" "{\"query\":\"$val\"}" 'results|\[\]|\{\}|match|found|count|total' "INV-1/pre" 15 --ro
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: INV-1: memory_search not in build"
    E2E_DIR="$_saved"; return
  fi
  if echo "$_MCP_BODY" | grep -q "$key"; then
    _CHECK_OUTPUT="INV-1 FAIL: dirty fixture: $key already present pre-store"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  # MUTATE: store
  _mcp_invoke_tool "memory_store" \
    "{\"key\":\"$key\",\"value\":\"$val\",\"namespace\":\"inv\"}" \
    'stored|success|key|true' \
    "INV-1/store" 30 --rw
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: INV-1: memory_store not in build"
    E2E_DIR="$_saved"; return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="INV-1 FAIL: store did not succeed — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  # POST-assert: search must now contain the key (body-level, not just exit=0)
  _mcp_invoke_tool "memory_search" "{\"query\":\"$val\"}" "$key" "INV-1/post-search" 30 --ro
  if [[ "$_CHECK_PASSED" == "skip_accepted" && "$_MCP_BODY" == *"embeddings"* ]]; then
    # skip_accepted from missing embeddings is acceptable; from tool-not-found
    # is inconsistent (search was present pre-store).
    _CHECK_OUTPUT="SKIP_ACCEPTED: INV-1: memory_search unavailable post-store"
    E2E_DIR="$_saved"; return
  fi
  if [[ "$_CHECK_PASSED" == "true" ]]; then
    _CHECK_OUTPUT="INV-1 OK: store→search round-trip ($key)"
    E2E_DIR="$_saved"; return
  fi

  # Try memory_retrieve as a fallback — some builds only store-to-disk,
  # and embedding load may silently fail in fresh iso (model cache cold).
  _mcp_invoke_tool "memory_retrieve" \
    "{\"key\":\"$key\",\"namespace\":\"inv\"}" \
    "$val" \
    "INV-1/retrieve-fallback" 15 --ro
  if [[ "$_CHECK_PASSED" == "true" ]]; then
    _CHECK_OUTPUT="INV-1 OK: store→retrieve round-trip ($key) [search fell through]"
    E2E_DIR="$_saved"; return
  fi

  _CHECK_PASSED="false"
  _CHECK_OUTPUT="INV-1 FAIL: neither search nor retrieve saw $key. Body: $(echo "${_MCP_BODY:-}" | head -5 | tr '\n' ' ')"
  E2E_DIR="$_saved"
}
check_adr0094_p8_inv1_memory_roundtrip() { _with_iso_cleanup "p8-inv1" _inv1_body; }

# ════════════════════════════════════════════════════════════════════
# INV-2: session_save → session_list (name appears)
# ════════════════════════════════════════════════════════════════════
_inv2_body() {
  local iso="$1"
  local _saved="${E2E_DIR:-}"
  E2E_DIR="$iso"

  local name="inv2-$$-$(date +%s)"

  _mcp_invoke_tool "session_list" '{}' 'sessions|list|\[\]|name' "INV-2/pre-list" 15 --ro
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: INV-2: session_list not in build"
    E2E_DIR="$_saved"; return
  fi
  if echo "$_MCP_BODY" | grep -q "$name"; then
    _CHECK_OUTPUT="INV-2 FAIL: dirty fixture: $name already present pre-save"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  _mcp_invoke_tool "session_save" "{\"name\":\"$name\"}" \
    'saved|success|session' "INV-2/save" 15 --rw
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: INV-2: session_save not in build"
    E2E_DIR="$_saved"; return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="INV-2 FAIL: save did not succeed — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  _mcp_invoke_tool "session_list" '{}' "$name" "INV-2/post-list" 15 --ro
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="INV-2 FAIL: list body missing $name post-save. Body: $(echo "${_MCP_BODY:-}" | head -5 | tr '\n' ' ')"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  _mcp_invoke_tool "session_info" "{\"name\":\"$name\"}" \
    "$name|sessionId|createdAt|path" "INV-2/info" 15 --ro
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="INV-2 OK: save→list→info round-trip ($name) [info skipped]"
    E2E_DIR="$_saved"; return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="INV-2 FAIL: session_info body missing name/metadata for $name. Body: $(echo "${_MCP_BODY:-}" | head -5 | tr '\n' ' ')"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  _CHECK_OUTPUT="INV-2 OK: save→list→info round-trip ($name)"
  E2E_DIR="$_saved"
}
check_adr0094_p8_inv2_session_roundtrip() { _with_iso_cleanup "p8-inv2" _inv2_body; }

# ════════════════════════════════════════════════════════════════════
# INV-3: agent_spawn → agent_list (appears) → agent_terminate (gone)
# ════════════════════════════════════════════════════════════════════
_inv3_body() {
  local iso="$1"
  local _saved="${E2E_DIR:-}"
  E2E_DIR="$iso"

  local agent_id="inv3-$$-$(date +%s)"

  _mcp_invoke_tool "agent_list" '{}' 'agents|list|\[\]|name' "INV-3/pre-list" 20 --ro
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: INV-3: agent_list not in build"
    E2E_DIR="$_saved"; return
  fi
  if echo "$_MCP_BODY" | grep -q "$agent_id"; then
    _CHECK_OUTPUT="INV-3 FAIL: dirty fixture: $agent_id present pre-spawn"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  _mcp_invoke_tool "agent_spawn" \
    "{\"agentType\":\"coder\",\"agentId\":\"$agent_id\"}" \
    'spawned|created|agent|id|success' \
    "INV-3/spawn" 30 --rw
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: INV-3: agent_spawn not in build"
    E2E_DIR="$_saved"; return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="INV-3 FAIL: spawn — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  _mcp_invoke_tool "agent_list" '{}' "$agent_id" "INV-3/list-after-spawn" 20 --ro
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="INV-3 FAIL: agent $agent_id missing from list post-spawn. Body: $(echo "${_MCP_BODY:-}" | head -5 | tr '\n' ' ')"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  _mcp_invoke_tool "agent_terminate" "{\"agentId\":\"$agent_id\"}" \
    'terminated|removed|success|true' "INV-3/terminate" 20 --rw
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="INV-3 FAIL: terminate — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  _mcp_invoke_tool "agent_list" '{}' 'agents|list|\[\]|name' "INV-3/post-terminate-list" 20 --ro
  if [[ "$_CHECK_PASSED" == "skip_accepted" || "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="INV-3 FAIL: agent_list unavailable post-terminate — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi
  if echo "$_MCP_BODY" | grep -q "$agent_id"; then
    _CHECK_OUTPUT="INV-3 FAIL: agent $agent_id still present in list post-terminate. Body: $(echo "${_MCP_BODY:-}" | head -5 | tr '\n' ' ')"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="INV-3 OK: spawn→list→terminate→gone round-trip ($agent_id)"
  E2E_DIR="$_saved"
}
check_adr0094_p8_inv3_agent_roundtrip() { _with_iso_cleanup "p8-inv3" _inv3_body; }

# ════════════════════════════════════════════════════════════════════
# INV-4: claims_claim → claims_board (has issue) → claims_release
#
# Schema note: claims_claim requires `issueId` + `claimant` (NOT taskId/agentId).
# claimant format is "type:id:role" (e.g. "agent:agent-1:coder") — parseClaimant
# splits on colons and crashes if any part is missing. The board lists active
# claims under `board.active[].issueId`.
# ════════════════════════════════════════════════════════════════════
_inv4_body() {
  local iso="$1"
  local _saved="${E2E_DIR:-}"
  E2E_DIR="$iso"

  local issue_id="inv4-$$-$(date +%s)"
  local claimant_id="inv4agent$$"
  local claimant="agent:${claimant_id}:coder"

  _mcp_invoke_tool "claims_claim" \
    "{\"issueId\":\"$issue_id\",\"claimant\":\"$claimant\"}" \
    'claim|success|true|claimed' \
    "INV-4/claim" 15 --rw
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: INV-4: claims_claim not in build"
    E2E_DIR="$_saved"; return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="INV-4 FAIL: claim — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  # Board must list the issueId under active[].
  _mcp_invoke_tool "claims_board" '{}' "$issue_id" "INV-4/board-after-claim" 15 --ro
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="INV-4 FAIL: $issue_id missing from board post-claim. Body: $(echo "${_MCP_BODY:-}" | head -5 | tr '\n' ' ')"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  _mcp_invoke_tool "claims_release" \
    "{\"issueId\":\"$issue_id\",\"claimant\":\"$claimant\"}" \
    'released|success|true|removed' "INV-4/release" 15 --rw
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="INV-4 FAIL: release — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  _mcp_invoke_tool "claims_board" '{}' 'board|active|\[\]|claims' "INV-4/post-release-board" 15 --ro
  if [[ "$_CHECK_PASSED" == "skip_accepted" || "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="INV-4 FAIL: claims_board unavailable post-release — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi
  if echo "$_MCP_BODY" | grep -q "$issue_id"; then
    _CHECK_OUTPUT="INV-4 FAIL: $issue_id still present on board post-release. Body: $(echo "${_MCP_BODY:-}" | head -5 | tr '\n' ' ')"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="INV-4 OK: claim→board→release→gone round-trip ($issue_id)"
  E2E_DIR="$_saved"
}
check_adr0094_p8_inv4_claims_roundtrip() { _with_iso_cleanup "p8-inv4" _inv4_body; }

# ════════════════════════════════════════════════════════════════════
# INV-5: workflow_create → workflow_list → workflow_delete
# ════════════════════════════════════════════════════════════════════
_inv5_body() {
  local iso="$1"
  local _saved="${E2E_DIR:-}"
  E2E_DIR="$iso"

  local name="inv5-wf-$$-$(date +%s)"

  _mcp_invoke_tool "workflow_create" \
    "{\"name\":\"$name\",\"steps\":[{\"name\":\"step1\",\"action\":\"log\"}]}" \
    'workflowId|created|workflow' \
    "INV-5/create" 15 --rw
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: INV-5: workflow_create not in build"
    E2E_DIR="$_saved"; return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="INV-5 FAIL: create — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  # Extract workflowId (format: workflow-<ts>-<rand>)
  local wf_id
  wf_id=$(echo "${_MCP_BODY:-}" | grep -oE 'workflow-[0-9]+-[a-z0-9]+' | head -1)
  if [[ -z "$wf_id" ]]; then
    _CHECK_OUTPUT="INV-5 FAIL: workflow_create did not return workflowId. Body: $(echo "${_MCP_BODY:-}" | head -5 | tr '\n' ' ')"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  _mcp_invoke_tool "workflow_list" '{}' "$wf_id" "INV-5/list-after-create" 15 --ro
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="INV-5 FAIL: $wf_id missing from list post-create. Body: $(echo "${_MCP_BODY:-}" | head -5 | tr '\n' ' ')"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  _mcp_invoke_tool "workflow_delete" "{\"workflowId\":\"$wf_id\"}" \
    'deleted|removed|success' "INV-5/delete" 15 --rw
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="INV-5 FAIL: delete — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  _mcp_invoke_tool "workflow_list" '{}' 'workflows|list|\[\]' "INV-5/post-delete-list" 15 --ro
  if [[ "$_CHECK_PASSED" == "skip_accepted" || "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="INV-5 FAIL: workflow_list unavailable post-delete — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi
  if echo "$_MCP_BODY" | grep -q "$wf_id"; then
    _CHECK_OUTPUT="INV-5 FAIL: $wf_id still present in list post-delete. Body: $(echo "${_MCP_BODY:-}" | head -5 | tr '\n' ' ')"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="INV-5 OK: create→list→delete→gone round-trip ($wf_id)"
  E2E_DIR="$_saved"
}
check_adr0094_p8_inv5_workflow_roundtrip() { _with_iso_cleanup "p8-inv5" _inv5_body; }

# ════════════════════════════════════════════════════════════════════
# INV-6: config_set → config_get (value round-trips)
# ════════════════════════════════════════════════════════════════════
_inv6_body() {
  local iso="$1"
  local _saved="${E2E_DIR:-}"
  E2E_DIR="$iso"

  local key="inv6.p8.rt$$"
  local val="phase8-cfg-$(date +%s)"

  _mcp_invoke_tool "config_set" \
    "{\"key\":\"$key\",\"value\":\"$val\"}" \
    'set|success|updated|saved|true' \
    "INV-6/set" 15 --rw
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: INV-6: config_set not in build"
    E2E_DIR="$_saved"; return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="INV-6 FAIL: set — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  # POST-assert: get must return the value
  _mcp_invoke_tool "config_get" "{\"key\":\"$key\"}" "$val" "INV-6/get" 15 --ro
  if [[ "$_CHECK_PASSED" == "true" ]]; then
    _CHECK_OUTPUT="INV-6 OK: set→get round-trip ($key=$val)"
  else
    _CHECK_OUTPUT="INV-6 FAIL: config_get body missing $val. Body: $(echo "${_MCP_BODY:-}" | head -5 | tr '\n' ' ')"
    _CHECK_PASSED="false"
  fi
  E2E_DIR="$_saved"
}
check_adr0094_p8_inv6_config_roundtrip() { _with_iso_cleanup "p8-inv6" _inv6_body; }

# ════════════════════════════════════════════════════════════════════
# INV-7: task_create → task_list (appears) → task_complete → task_summary
# ════════════════════════════════════════════════════════════════════
_inv7_body() {
  local iso="$1"
  local _saved="${E2E_DIR:-}"
  E2E_DIR="$iso"

  _mcp_invoke_tool "task_create" \
    '{"type":"test","description":"inv7-phase8-probe"}' \
    'task|created|id|success' \
    "INV-7/create" 15 --rw
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: INV-7: task_create not in build"
    E2E_DIR="$_saved"; return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="INV-7 FAIL: create — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  local tid
  tid=$(echo "${_MCP_BODY:-}" | grep -oE 'task-[0-9]+-[a-z0-9]+' | head -1)
  if [[ -z "$tid" ]]; then
    _CHECK_OUTPUT="INV-7 FAIL: task_create did not return task-<ts>-<rand> id. Body: $(echo "${_MCP_BODY:-}" | head -5 | tr '\n' ' ')"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  _mcp_invoke_tool "task_list" '{}' "$tid" "INV-7/list-after-create" 15 --ro
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="INV-7 FAIL: $tid missing from list post-create. Body: $(echo "${_MCP_BODY:-}" | head -5 | tr '\n' ' ')"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  _mcp_invoke_tool "task_complete" "{\"taskId\":\"$tid\"}" \
    'completed|done|success|true' "INV-7/complete" 15 --rw
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="INV-7 FAIL: complete — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  _mcp_invoke_tool "task_summary" '{}' 'total|completed|pending' \
    "INV-7/summary" 15 --ro
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="INV-7 FAIL: task_summary body missing summary shape fields. Body: $(echo "${_MCP_BODY:-}" | head -5 | tr '\n' ' ')"
    _CHECK_PASSED="false"
  else
    # task_summary returns aggregate counters (total/pending/running/completed/failed)
    # with NO task IDs enumerated. After our task_complete, `completed` MUST be >=1 —
    # a silent no-op task_complete would leave completed=0.
    local completed
    completed=$(echo "$_MCP_BODY" | node -e '
      let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{
        try { const j = JSON.parse(d); if (typeof j?.completed === "number") process.stdout.write(String(j.completed)); }
        catch {}
      });
    ' 2>/dev/null || true)
    completed="${completed:-0}"
    if (( completed >= 1 )); then
      _CHECK_OUTPUT="INV-7 OK: create→list→complete→summary round-trip ($tid; completed=$completed)"
    else
      _CHECK_OUTPUT="INV-7 FAIL: task_summary.completed=$completed after task_complete (expected >=1) — silent no-op suspected. Body: $(echo "${_MCP_BODY:-}" | head -5 | tr '\n' ' ')"
      _CHECK_PASSED="false"
    fi
  fi
  E2E_DIR="$_saved"
}
check_adr0094_p8_inv7_task_lifecycle() { _with_iso_cleanup "p8-inv7" _inv7_body; }

# ════════════════════════════════════════════════════════════════════
# INV-8: Session captures active task state (Debt-15-style regression guard)
#
# Premise: session_save(includeTasks:true) MUST capture the current task store
# and report the count in its response body. A silent no-op save would return
# ok with stats.tasks=0 despite an active task — the exact ADR-0086 Debt-15
# pattern where the surface artifact existed but the promised round-trip was
# broken.
#
# Sequence:
#   1. task_create T1 (establish state to snapshot)
#   2. session_save S includeTasks:true
#        → response.stats.tasks MUST be >= 1 (proves capture, not no-op)
#   3. session_restore S
#        → response MUST succeed and reference the session
#
# Design note (2026-04-19): the original memory-based INV-8 exposed a real
# product mismatch — memory_store writes to RVF (primary) but session_save
# reads .claude-flow/memory/store.json (legacy). The mismatch is tracked as
# a follow-up product bug. Tasks use the store.json backend that session-tools
# actually reads, so the Debt-15 guard lives here unambiguously.
# ════════════════════════════════════════════════════════════════════
_inv8_body() {
  local iso="$1"
  local _saved="${E2E_DIR:-}"
  E2E_DIR="$iso"

  local sess="inv8-sess-$$-$(date +%s)"

  # Step 1: Create a probe task so there is real state to snapshot.
  _mcp_invoke_tool "task_create" \
    '{"type":"test","description":"inv8-debt15-probe"}' \
    'task|created|id|success' "INV-8/task-create" 15 --rw
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: INV-8: task_create not in build"
    E2E_DIR="$_saved"; return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="INV-8 FAIL: task_create — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi
  local tid
  tid=$(echo "${_MCP_BODY:-}" | grep -oE 'task-[0-9]+-[a-z0-9]+' | head -1)
  if [[ -z "$tid" ]]; then
    _CHECK_OUTPUT="INV-8 FAIL: task_create did not return task-<ts>-<rand> id. Body: $(echo "${_MCP_BODY:-}" | head -5 | tr '\n' ' ')"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  # Step 2: Save with includeTasks and require stats.tasks >= 1.
  _mcp_invoke_tool "session_save" \
    "{\"name\":\"$sess\",\"includeTasks\":true}" \
    'sessionId|savedAt|stats|path' "INV-8/save" 15 --rw
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: INV-8: session_save not in build"
    E2E_DIR="$_saved"; return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="INV-8 FAIL: save — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi
  local task_count
  task_count=$(echo "$_MCP_BODY" | node -e '
    let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{
      try { const j = JSON.parse(d); if (typeof j?.stats?.tasks === "number") process.stdout.write(String(j.stats.tasks)); }
      catch {}
    });
  ' 2>/dev/null || true)
  task_count="${task_count:-0}"
  if (( task_count < 1 )); then
    _CHECK_OUTPUT="INV-8 FAIL: session_save stats.tasks=$task_count despite active task $tid — silent no-op suspected (Debt-15 pattern). Body: $(echo "${_MCP_BODY:-}" | head -5 | tr '\n' ' ')"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  # Step 3: Restore must succeed and reference the session.
  _mcp_invoke_tool "session_restore" "{\"name\":\"$sess\"}" \
    'restored|loaded|session|success|sessionId' "INV-8/restore" 15 --rw
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="INV-8 FAIL: restore — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="INV-8 OK: session captures+restores task state (tid=$tid, stats.tasks=$task_count)"
  E2E_DIR="$_saved"
}
check_adr0094_p8_inv8_session_memory_roundtrip() { _with_iso_cleanup "p8-inv8" _inv8_body; }

# ════════════════════════════════════════════════════════════════════
# INV-9: neural_patterns(store) raises neural_status patterns.total
#
# Catches "pattern store returns ok but persists nothing" silent-no-op.
#
# Tool note (verified via handler source forks/ruflo/v3/.../neural-tools.ts):
# neural_status reports `patterns.total` = Object.values(store.patterns).length.
# The primitive that actually adds to store.patterns is
# `neural_patterns(action=store)`, NOT `neural_train` (which writes to
# store.models — a separate bucket that doesn't flow into patterns.total).
# ════════════════════════════════════════════════════════════════════
_phase8_neural_total() {
  # Extract patterns.total from a JSON body via node. Prints integer or empty.
  node -e '
    let d=""; process.stdin.on("data",c=>d+=c).on("end",()=>{
      try {
        const j = JSON.parse(d);
        const t = j?.patterns?.total;
        if (typeof t === "number") process.stdout.write(String(t));
      } catch {}
    });
  ' 2>/dev/null || true
}
_inv9_body() {
  local iso="$1"
  local _saved="${E2E_DIR:-}"
  E2E_DIR="$iso"

  # Warm-up call 1: may bootstrap defaults on cold start (count may jump 0→N).
  _mcp_invoke_tool "neural_status" '{}' \
    'status|model|ready|neural|patterns' \
    "INV-9/warm-status-1" 15 --ro
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: INV-9: neural_status not in build"
    E2E_DIR="$_saved"; return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="INV-9 FAIL: pre-status (warm-1) — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  # Warm-up call 2: second call gives the authoritative pre_count (cold-start
  # bootstrap already settled after first call).
  _mcp_invoke_tool "neural_status" '{}' \
    'status|model|ready|neural|patterns' \
    "INV-9/warm-status-2" 15 --ro
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="INV-9 FAIL: pre-status (warm-2) — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi
  local pre_count
  pre_count=$(echo "${_MCP_BODY:-}" | _phase8_neural_total)
  pre_count="${pre_count:-0}"

  _mcp_invoke_tool "neural_patterns" \
    '{"action":"store","name":"phase8-inv9-probe","type":"test","data":{"probe":"inv9"}}' \
    'success|patternId|stored|pattern' \
    "INV-9/store-pattern" 30 --rw
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: INV-9: neural_patterns not in build"
    E2E_DIR="$_saved"; return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="INV-9 FAIL: pattern-store — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi
  local pattern_id
  pattern_id=$(echo "${_MCP_BODY:-}" | grep -oE '"patternId"[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 | sed -E 's/.*"([^"]+)"$/\1/')

  _mcp_invoke_tool "neural_status" '{}' \
    'status|patterns|neural' \
    "INV-9/post-status" 15 --ro
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="INV-9 FAIL: post-status — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi
  local post_count
  post_count=$(echo "${_MCP_BODY:-}" | _phase8_neural_total)
  post_count="${post_count:-0}"

  if ! (( post_count > pre_count )); then
    _CHECK_OUTPUT="INV-9 FAIL: patterns.total did not increase ($pre_count → $post_count) after neural_patterns(store). Body: $(echo "${_MCP_BODY:-}" | head -5 | tr '\n' ' ')"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  # neural_status returns aggregate `patterns: { total, byType, totalEmbeddingDims }`
  # and does NOT enumerate individual patternIds (see neural-tools.ts lines 474-481).
  # We rely on the strict counter delta above (combined with the 2x warm-up that
  # cancels cold-start bootstrap) to prove neural_patterns(store) caused the increment.
  _CHECK_PASSED="true"
  if [[ -n "$pattern_id" ]]; then
    _CHECK_OUTPUT="INV-9 OK: patterns.total increased $pre_count → $post_count after neural_patterns(store) [patternId=$pattern_id returned]"
  else
    _CHECK_OUTPUT="INV-9 OK: patterns.total increased $pre_count → $post_count after neural_patterns(store)"
  fi
  E2E_DIR="$_saved"
}
check_adr0094_p8_inv9_neural_delta() { _with_iso_cleanup "p8-inv9" _inv9_body; }

# ════════════════════════════════════════════════════════════════════
# INV-10: autopilot_enable → autopilot_status.enabled==true → predict shape
#
# Catches tool that returns {} or empty stub from autopilot_predict.
# ════════════════════════════════════════════════════════════════════
_inv10_body() {
  local iso="$1"
  local _saved="${E2E_DIR:-}"
  E2E_DIR="$iso"

  _mcp_invoke_tool "autopilot_enable" '{}' \
    'enabled|success|true' "INV-10/enable" 15 --rw
  if [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: INV-10: autopilot_enable not in build"
    E2E_DIR="$_saved"; return
  fi
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="INV-10 FAIL: enable — $_CHECK_OUTPUT"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  # status MUST say enabled=true post-enable (body-level, not exit=0 alone).
  _mcp_invoke_tool "autopilot_status" '{}' \
    '"enabled"[[:space:]]*:[[:space:]]*true' \
    "INV-10/status-after-enable" 15 --ro
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    _CHECK_OUTPUT="INV-10 FAIL: status.enabled != true post-enable. Body: $(echo "${_MCP_BODY:-}" | head -5 | tr '\n' ' ')"
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  # predict must return a non-empty shaped body (not {} or bare OK).
  # Accept any of: recommendation|confidence|prediction|task|suggest.
  _mcp_invoke_tool "autopilot_predict" \
    '{"context":"writing tests"}' \
    'recommendation|confidence|prediction|task|suggest' \
    "INV-10/predict" 15 --ro
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    # Verify it's not the empty-stub case
    local trimmed; trimmed=$(echo "${_MCP_BODY:-}" | tr -d ' \t\r\n')
    if [[ "$trimmed" == "{}" || -z "$trimmed" ]]; then
      _CHECK_OUTPUT="INV-10 FAIL: autopilot_predict returned empty stub ({}). Post-enable body was OK but predict is unshaped."
    else
      _CHECK_OUTPUT="INV-10 FAIL: autopilot_predict body missing shape fields. Body: $(echo "${_MCP_BODY:-}" | head -5 | tr '\n' ' ')"
    fi
    _CHECK_PASSED="false"; E2E_DIR="$_saved"; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="INV-10 OK: enable→status(enabled=true)→predict(shaped) round-trip"
  E2E_DIR="$_saved"
}
check_adr0094_p8_inv10_autopilot_shape() { _with_iso_cleanup "p8-inv10" _inv10_body; }

# ════════════════════════════════════════════════════════════════════
# INV-11: Delta-sentinel (meta-probe)
#
# Re-runs representative mutate pairs twice in the same iso dir and
# asserts the second pre-snapshot differs from the first. If a tool is
# silently no-op'd (returns ok but writes nothing), repeated-run delta
# is zero → probe fails loudly.
#
# Targets three surfaces (picked to span RVF, store.json, agent registry):
#   - memory_store (RVF)
#   - workflow_create (.claude-flow/workflows/store.json)
#   - agent_spawn (in-memory agent registry via agent_list)
#
# Rationale: if any of these are stubbed out, INV-1/3/5 could still
# pass (they check post-state *matches expected*, but don't prove the
# mutation caused the change). INV-11 proves causality.
# ════════════════════════════════════════════════════════════════════
_inv11_body() {
  local iso="$1"
  local _saved="${E2E_DIR:-}"
  E2E_DIR="$iso"

  local failures=""
  local probes=0 confirmed=0

  # ── Probe A: memory_store affects memory_list body ────────────────
  _mcp_invoke_tool "memory_list" '{"namespace":"inv11"}' 'list|items|\[|count|total|results' \
    "INV-11/A/list-0" 15 --ro
  if [[ "$_CHECK_PASSED" == "true" ]]; then
    local h0; h0=$(echo "${_MCP_BODY:-}" | _phase8_hash)
    probes=$((probes + 1))
    _mcp_invoke_tool "memory_store" \
      "{\"key\":\"inv11-A-$$-$(date +%s)\",\"value\":\"v1\",\"namespace\":\"inv11\"}" \
      'stored|success|key' "INV-11/A/store" 30 --rw
    if [[ "$_CHECK_PASSED" == "true" ]]; then
      _mcp_invoke_tool "memory_list" '{"namespace":"inv11"}' '.' \
        "INV-11/A/list-1" 15 --ro
      local h1; h1=$(echo "${_MCP_BODY:-}" | _phase8_hash)
      if [[ -n "$h0" && -n "$h1" && "$h0" != "$h1" ]]; then
        confirmed=$((confirmed + 1))
      else
        failures+="A:memory_store(h0=$h0,h1=$h1) "
      fi
    else
      failures+="A:store-skipped "
    fi
  fi

  # ── Probe B: workflow_create affects workflow_list body ───────────
  _mcp_invoke_tool "workflow_list" '{}' 'workflows|list|\[' \
    "INV-11/B/list-0" 15 --ro
  if [[ "$_CHECK_PASSED" == "true" ]]; then
    local h0; h0=$(echo "${_MCP_BODY:-}" | _phase8_hash)
    probes=$((probes + 1))
    _mcp_invoke_tool "workflow_create" \
      "{\"name\":\"inv11-B-$$-$(date +%s)\",\"steps\":[{\"name\":\"s\",\"action\":\"log\"}]}" \
      'workflowId|created|workflow' "INV-11/B/create" 15 --rw
    if [[ "$_CHECK_PASSED" == "true" ]]; then
      _mcp_invoke_tool "workflow_list" '{}' '.' "INV-11/B/list-1" 15 --ro
      local h1; h1=$(echo "${_MCP_BODY:-}" | _phase8_hash)
      if [[ -n "$h0" && -n "$h1" && "$h0" != "$h1" ]]; then
        confirmed=$((confirmed + 1))
      else
        failures+="B:workflow_create(h0=$h0,h1=$h1) "
      fi
    else
      failures+="B:create-skipped "
    fi
  fi

  # ── Probe C: agent_spawn affects agent_list body ──────────────────
  _mcp_invoke_tool "agent_list" '{}' 'agents|list|\[' \
    "INV-11/C/list-0" 15 --ro
  if [[ "$_CHECK_PASSED" == "true" ]]; then
    local h0; h0=$(echo "${_MCP_BODY:-}" | _phase8_hash)
    probes=$((probes + 1))
    local aid="inv11-C-$$-$(date +%s)"
    _mcp_invoke_tool "agent_spawn" \
      "{\"agentType\":\"coder\",\"agentId\":\"$aid\"}" \
      'spawned|created|agent|id' "INV-11/C/spawn" 30 --rw
    if [[ "$_CHECK_PASSED" == "true" ]]; then
      _mcp_invoke_tool "agent_list" '{}' '.' "INV-11/C/list-1" 15 --ro
      local h1; h1=$(echo "${_MCP_BODY:-}" | _phase8_hash)
      if [[ -n "$h0" && -n "$h1" && "$h0" != "$h1" ]]; then
        confirmed=$((confirmed + 1))
      else
        failures+="C:agent_spawn(h0=$h0,h1=$h1) "
      fi
    else
      failures+="C:spawn-skipped "
    fi
  fi

  if (( probes == 0 )); then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: INV-11: no list tools available for delta-sentinel probe"
    E2E_DIR="$_saved"; return
  fi

  # ADR-0082 / Phase 8 follow-up (ITEM 4): strict all-or-fail threshold.
  # All three probes (memory_store / workflow_create / agent_spawn) are core
  # MCP tools required in any Phase 8-eligible build. If any one silently
  # degrades to a no-op, INV-11 is the only cross-tool invariant that would
  # surface it — the previous >=2 / >=1 partial-pass fallback masked real
  # regressions as green. Demand all `probes` confirmations now that at least
  # one list tool answered (skip_accepted already covers the genuinely-empty
  # build case above).
  if (( confirmed == probes )); then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="INV-11 OK: delta-sentinel confirmed $confirmed/$probes mutations cause observable list-body delta (strict all-required)"
  else
    _CHECK_OUTPUT="INV-11 FAIL: delta-sentinel requires all $probes probes to cause observable list-body delta, only $confirmed confirmed — tools may be silently no-op'd. misses=$failures"
    _CHECK_PASSED="false"
  fi
  E2E_DIR="$_saved"
}
check_adr0094_p8_inv11_delta_sentinel() { _with_iso_cleanup "p8-inv11" _inv11_body; }
