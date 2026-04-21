#!/usr/bin/env bash
# lib/acceptance-phase11-fuzzing.sh — ADR-0094 Phase 11: Input fuzzing (sampled)
#
# Sampled fuzzing across 8 tool classes × 2 reps (type-mismatch + boundary).
# 16 checks total. Not all 213 tools — this is the sampling Phase 11 (per ADR
# §Phases 11–17). Error-*message* quality is Phase 12; Phase 11 only verifies
# that malformed inputs produce a loud failure rather than a silent
# `{success:true}` with no side effects (ADR-0082 rule).
#
# Per-class matrix (rep_a = type-mismatch, rep_b = boundary):
#   1.  memory      / memory_store       — {key:123,value:["not","string"]}   / {key:"",value:""}
#   2.  session     / session_save       — {name:42}                          / {name:"../../../etc/passwd"}
#   3.  agent       / agent_spawn        — {type:["coder"]}                   / {type:""}
#   4.  claims      / claims_claim       — {task:null}                        / {task:"<10KB>"}
#   5.  workflow    / workflow_create    — {name:true,steps:"not-array"}      / {name:"",steps:[]}
#   6.  config      / config_set         — {key:{},value:123}                 / {key:"",value:""}
#   7.  neural      / neural_train       — {patternType:42}                   / {patternType:"",trainingData:""}
#   8.  autopilot   / autopilot_enable   — {mode:["array"]}                   / {mode:""}
#
# PASS   : _MCP_EXIT != 0, OR body matches /error|invalid|required|must|missing|
#          malformed|unexpected|cannot/i, OR body contains "success":false.
# FAIL   : body contains "success":true with no diagnostic — the exact
#          ADR-0082 silent-pass Phase 11 is designed to catch.
# SKIP_ACCEPTED : tool is not in the build (regex: not.*found|unknown.*tool|
#          no.*such.*tool) — reuses `_mcp_invoke_tool`'s own skip path.
#
# Requires: acceptance-harness.sh (_mcp_invoke_tool, _with_iso_cleanup).
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG.

# ════════════════════════════════════════════════════════════════════
# Shared helper — every check calls this exactly once.
# ════════════════════════════════════════════════════════════════════

# _p11_expect_fuzz_rejection <label> [extra_reject_regex]
#
# Post-condition evaluator. Reads _MCP_BODY + _MCP_EXIT + _CHECK_PASSED that
# _mcp_invoke_tool just populated, then overwrites _CHECK_PASSED / _CHECK_OUTPUT
# with the Phase 11 verdict:
#   - SKIP_ACCEPTED if _mcp_invoke_tool decided tool-not-found (preserved).
#   - PASS if any rejection signal present.
#   - FAIL if the body looks like a silent success.
#
# The optional <extra_reject_regex> is OR'd into the default error regex so a
# check can accept an additional domain-specific shape (e.g. a schema tool
# that rejects with a custom code word). The default is broad enough that
# callers usually pass nothing.
_p11_expect_fuzz_rejection() {
  local label="${1:-p11}"
  local extra_regex="${2:-}"

  # _mcp_invoke_tool already handled tool-not-found → skip_accepted.
  if [[ "${_CHECK_PASSED:-}" == "skip_accepted" ]]; then
    _CHECK_OUTPUT="SKIP_ACCEPTED: ${label}: tool not in build"
    return
  fi

  local body="${_MCP_BODY:-}"
  local exit_code="${_MCP_EXIT:-0}"

  # Reset — we re-decide below.
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # Default rejection shapes. Word-boundary-ish; case-insensitive at match time.
  local reject_regex='error|invalid|required|must|missing|malformed|unexpected|cannot'
  if [[ -n "$extra_regex" ]]; then
    reject_regex="${reject_regex}|${extra_regex}"
  fi

  # (a) Non-zero exit → PASS (tool rejected at CLI layer).
  if [[ "$exit_code" != "0" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="${label} OK: rejected via exit=${exit_code}"
    return
  fi

  # (b) Body contains "success":false → PASS (tool rejected in-band).
  if echo "$body" | grep -qE '"success"[[:space:]]*:[[:space:]]*false'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="${label} OK: rejected via success:false"
    return
  fi

  # (c) Body carries an error-shaped diagnostic word → PASS.
  if echo "$body" | grep -qiE "$reject_regex"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="${label} OK: rejected via error-shape body"
    return
  fi

  # Silent success detection — the ADR-0082 anti-pattern.
  if echo "$body" | grep -qE '"success"[[:space:]]*:[[:space:]]*true'; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="${label} FAIL: malformed input accepted with success:true, no diagnostic (ADR-0082 silent-pass). Body: $(echo "$body" | head -5 | tr '\n' ' ')"
    return
  fi

  # No explicit success, no explicit rejection — treat as FAIL. The tool
  # must be loud one way or the other; bare empty/neutral bodies mask bugs.
  _CHECK_PASSED="false"
  _CHECK_OUTPUT="${label} FAIL: no rejection signal and no success marker (neutral body is also ADR-0082-suspect). exit=${exit_code}, body: $(echo "$body" | head -5 | tr '\n' ' ')"
}

# Convenience: build a ~10KB 'A' string once per check (boundary rep for claims).
_p11_big_string() {
  local n="${1:-10240}"
  # printf %*s pads with spaces; translate spaces to A.
  printf '%*s' "$n" '' | tr ' ' 'A'
}

# ════════════════════════════════════════════════════════════════════
# 1. memory_store
# ════════════════════════════════════════════════════════════════════
_p11_memory_store_type_mismatch_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _mcp_invoke_tool "memory_store" \
    '{"key":123,"value":["not","string"]}' \
    '.' "P11/memory_store/type" 20 --ro
  _p11_expect_fuzz_rejection "P11/memory_store/type-mismatch"
  E2E_DIR="$_saved"
}
check_adr0094_p11_fuzz_memory_type_mismatch() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p11-fuzz-memory-type" _p11_memory_store_type_mismatch_body
}

_p11_memory_store_boundary_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _mcp_invoke_tool "memory_store" \
    '{"key":"","value":""}' \
    '.' "P11/memory_store/boundary" 20 --ro
  _p11_expect_fuzz_rejection "P11/memory_store/boundary"
  E2E_DIR="$_saved"
}
check_adr0094_p11_fuzz_memory_boundary() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p11-fuzz-memory-boundary" _p11_memory_store_boundary_body
}

# ════════════════════════════════════════════════════════════════════
# 2. session_save
# ════════════════════════════════════════════════════════════════════
_p11_session_save_type_mismatch_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _mcp_invoke_tool "session_save" \
    '{"name":42}' \
    '.' "P11/session_save/type" 20 --ro
  _p11_expect_fuzz_rejection "P11/session_save/type-mismatch"
  E2E_DIR="$_saved"
}
check_adr0094_p11_fuzz_session_type_mismatch() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p11-fuzz-session-type" _p11_session_save_type_mismatch_body
}

_p11_session_save_boundary_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  # Path traversal string — a name like "../../../etc/passwd" must either be
  # rejected as invalid (PASS) or sanitized-and-stored (FAIL: silent success
  # could indicate the tool wrote outside its sandbox).
  _mcp_invoke_tool "session_save" \
    '{"name":"../../../etc/passwd"}' \
    '.' "P11/session_save/boundary" 20 --ro
  _p11_expect_fuzz_rejection "P11/session_save/boundary" 'traversal|forbidden|denied|sanitiz'
  E2E_DIR="$_saved"
}
check_adr0094_p11_fuzz_session_boundary() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p11-fuzz-session-boundary" _p11_session_save_boundary_body
}

# ════════════════════════════════════════════════════════════════════
# 3. agent_spawn
# ════════════════════════════════════════════════════════════════════
_p11_agent_spawn_type_mismatch_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _mcp_invoke_tool "agent_spawn" \
    '{"type":["coder"]}' \
    '.' "P11/agent_spawn/type" 20 --ro
  _p11_expect_fuzz_rejection "P11/agent_spawn/type-mismatch"
  E2E_DIR="$_saved"
}
check_adr0094_p11_fuzz_agent_type_mismatch() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p11-fuzz-agent-type" _p11_agent_spawn_type_mismatch_body
}

_p11_agent_spawn_boundary_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _mcp_invoke_tool "agent_spawn" \
    '{"type":""}' \
    '.' "P11/agent_spawn/boundary" 20 --ro
  _p11_expect_fuzz_rejection "P11/agent_spawn/boundary"
  E2E_DIR="$_saved"
}
check_adr0094_p11_fuzz_agent_boundary() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p11-fuzz-agent-boundary" _p11_agent_spawn_boundary_body
}

# ════════════════════════════════════════════════════════════════════
# 4. claims_claim
# ════════════════════════════════════════════════════════════════════
_p11_claims_claim_type_mismatch_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _mcp_invoke_tool "claims_claim" \
    '{"task":null}' \
    '.' "P11/claims_claim/type" 20 --ro
  _p11_expect_fuzz_rejection "P11/claims_claim/type-mismatch"
  E2E_DIR="$_saved"
}
check_adr0094_p11_fuzz_claims_type_mismatch() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p11-fuzz-claims-type" _p11_claims_claim_type_mismatch_body
}

_p11_claims_claim_boundary_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  # 10KB task payload — tests memory-bound input handling.
  local big; big=$(_p11_big_string 10240)
  # Bash-escape nothing here: JSON-encode via a single-quoted string; the
  # 10KB 'A' payload has no quotes or backslashes.
  _mcp_invoke_tool "claims_claim" \
    "{\"task\":\"${big}\"}" \
    '.' "P11/claims_claim/boundary" 20 --ro
  _p11_expect_fuzz_rejection "P11/claims_claim/boundary" 'too.long|limit|size'
  E2E_DIR="$_saved"
}
check_adr0094_p11_fuzz_claims_boundary() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p11-fuzz-claims-boundary" _p11_claims_claim_boundary_body
}

# ════════════════════════════════════════════════════════════════════
# 5. workflow_create
# ════════════════════════════════════════════════════════════════════
_p11_workflow_create_type_mismatch_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _mcp_invoke_tool "workflow_create" \
    '{"name":true,"steps":"not-array"}' \
    '.' "P11/workflow_create/type" 20 --ro
  _p11_expect_fuzz_rejection "P11/workflow_create/type-mismatch"
  E2E_DIR="$_saved"
}
check_adr0094_p11_fuzz_workflow_type_mismatch() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p11-fuzz-workflow-type" _p11_workflow_create_type_mismatch_body
}

_p11_workflow_create_boundary_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _mcp_invoke_tool "workflow_create" \
    '{"name":"","steps":[]}' \
    '.' "P11/workflow_create/boundary" 20 --ro
  _p11_expect_fuzz_rejection "P11/workflow_create/boundary" 'empty|non-empty|at.least'
  E2E_DIR="$_saved"
}
check_adr0094_p11_fuzz_workflow_boundary() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p11-fuzz-workflow-boundary" _p11_workflow_create_boundary_body
}

# ════════════════════════════════════════════════════════════════════
# 6. config_set
# ════════════════════════════════════════════════════════════════════
_p11_config_set_type_mismatch_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _mcp_invoke_tool "config_set" \
    '{"key":{},"value":123}' \
    '.' "P11/config_set/type" 20 --ro
  _p11_expect_fuzz_rejection "P11/config_set/type-mismatch"
  E2E_DIR="$_saved"
}
check_adr0094_p11_fuzz_config_type_mismatch() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p11-fuzz-config-type" _p11_config_set_type_mismatch_body
}

_p11_config_set_boundary_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _mcp_invoke_tool "config_set" \
    '{"key":"","value":""}' \
    '.' "P11/config_set/boundary" 20 --ro
  _p11_expect_fuzz_rejection "P11/config_set/boundary"
  E2E_DIR="$_saved"
}
check_adr0094_p11_fuzz_config_boundary() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p11-fuzz-config-boundary" _p11_config_set_boundary_body
}

# ════════════════════════════════════════════════════════════════════
# 7. neural_train
# ════════════════════════════════════════════════════════════════════
_p11_neural_train_type_mismatch_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _mcp_invoke_tool "neural_train" \
    '{"patternType":42}' \
    '.' "P11/neural_train/type" 20 --ro
  _p11_expect_fuzz_rejection "P11/neural_train/type-mismatch"
  E2E_DIR="$_saved"
}
check_adr0094_p11_fuzz_neural_type_mismatch() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p11-fuzz-neural-type" _p11_neural_train_type_mismatch_body
}

_p11_neural_train_boundary_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _mcp_invoke_tool "neural_train" \
    '{"patternType":"","trainingData":""}' \
    '.' "P11/neural_train/boundary" 20 --ro
  _p11_expect_fuzz_rejection "P11/neural_train/boundary"
  E2E_DIR="$_saved"
}
check_adr0094_p11_fuzz_neural_boundary() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p11-fuzz-neural-boundary" _p11_neural_train_boundary_body
}

# ════════════════════════════════════════════════════════════════════
# 8. autopilot_enable
# ════════════════════════════════════════════════════════════════════
_p11_autopilot_enable_type_mismatch_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _mcp_invoke_tool "autopilot_enable" \
    '{"mode":["array"]}' \
    '.' "P11/autopilot_enable/type" 20 --ro
  _p11_expect_fuzz_rejection "P11/autopilot_enable/type-mismatch"
  E2E_DIR="$_saved"
}
check_adr0094_p11_fuzz_autopilot_type_mismatch() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p11-fuzz-autopilot-type" _p11_autopilot_enable_type_mismatch_body
}

_p11_autopilot_enable_boundary_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _mcp_invoke_tool "autopilot_enable" \
    '{"mode":""}' \
    '.' "P11/autopilot_enable/boundary" 20 --ro
  _p11_expect_fuzz_rejection "P11/autopilot_enable/boundary"
  E2E_DIR="$_saved"
}
check_adr0094_p11_fuzz_autopilot_boundary() {
  # adr0097-l2-delegator: _CHECK_PASSED= is set inside _with_iso_cleanup / body fn
  _with_iso_cleanup "p11-fuzz-autopilot-boundary" _p11_autopilot_enable_boundary_body
}
