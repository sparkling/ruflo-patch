#!/usr/bin/env bash
# lib/acceptance-phase12-error-quality.sh — ADR-0094 Phase 12: Error message quality
#
# Goes beyond Phase 11 ("does the tool fire an error?") to ask the stricter
# question: "does the error NAME the problem?". A tool that rejects with
# `{"error":"failed"}` passes P11 but fails P12 — the surfaced diagnostic
# must mention the offending field, constraint, or expected type so callers
# can repair their input without reading source.
#
# 7 tool classes × 2 reps = 14 checks total. Rep A = missing required field;
# Rep B = wrong type for a required field. Tokens are chosen per-class so
# the expected name is unambiguous.
#
# Previously 8 classes × 2 = 16. The autopilot_enable class was dropped:
# the tool legitimately has NO required fields (empty `{}` is a valid call
# that returns success:true), so a missing-field probe is not applicable
# and an equivalent wrong-type probe has nothing to type-mismatch against.
# Removing the row is test-matrix alignment, not a coverage regression.
#
# Per-class matrix:
#   #  class       tool              rep_a (missing)              token (missing)                    rep_b (wrong type)              token (wrong type)
#   1. memory      memory_store      {}                           key                                {"key":"k","value":42}          value
#   2. session     session_save      {}                           name                               {"name":42}                     name|string
#   3. agent       agent_spawn       {}                           type                               {"type":42}                     type|string
#   4. claims      claims_claim      {}                           issueId|claimant                   {"task":[1,2]}                  issueId|claimant
#   5. workflow    workflow_create   {"name":"w"}                 steps                              {"name":"w","steps":"x"}        steps|array
#   6. config      config_set        {"key":"k"}                  value                              {"key":42,"value":"v"}          key|string
#   7. neural      neural_train      {}                           patternType|pattern_type|model     {"patternType":42}              patternType|pattern_type|string|type
#
# PASS  : body shows rejection (exit!=0, "success":false, or ADR-0082 error-
#         shape word) AND mentions the class-specific expected token AND
#         carries at least one structural hint word (required|must|invalid|
#         expected|missing|type|string|array|number|schema|validation).
# FAIL  :
#   - "success":true with no diagnostic  → ADR-0082 silent-pass canary (kept
#     defensively, same as P11).
#   - rejection but token not named      → "fires but doesn't name the problem".
#   - token named but no structural hint → "names field but not shape".
#   - empty/neutral body                 → ADR-0082-suspect, same as P11.
# SKIP_ACCEPTED : tool-not-found preserved from `_mcp_invoke_tool` (no new
#   skip reasons introduced by this phase).
#
# Requires: acceptance-harness.sh (_mcp_invoke_tool, _with_iso_cleanup).
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG.

# ════════════════════════════════════════════════════════════════════
# Shared helper — every check calls this exactly once.
# ════════════════════════════════════════════════════════════════════

# _p12_expect_named_error <label> <expected_token_regex>
#
# Post-condition evaluator. Reads _MCP_BODY + _MCP_EXIT + _CHECK_PASSED that
# _mcp_invoke_tool just populated, then overwrites _CHECK_PASSED /
# _CHECK_OUTPUT with the Phase 12 verdict. Unlike P11, merely rejecting is
# not enough — the body must also mention <expected_token_regex> AND carry
# at least one structural hint word.
_p12_expect_named_error() {
  local label="${1:-p12}"
  local token_regex="${2:-}"

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

  # Step 1: detect rejection signal (same as P11).
  local rejected="false"
  local reject_via=""
  if [[ "$exit_code" != "0" ]]; then
    rejected="true"
    reject_via="exit=${exit_code}"
  elif echo "$body" | grep -qE '"success"[[:space:]]*:[[:space:]]*false'; then
    rejected="true"
    reject_via="success:false"
  elif echo "$body" | grep -qiE 'error|invalid|required|must|missing|malformed|unexpected|cannot'; then
    rejected="true"
    reject_via="error-shape"
  fi

  # Step 2: silent-success canary — ADR-0082 (defense-in-depth).
  if [[ "$rejected" == "false" ]] && echo "$body" | grep -qE '"success"[[:space:]]*:[[:space:]]*true'; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="${label} FAIL: malformed input accepted with success:true, no diagnostic (ADR-0082 silent-pass). Body: $(echo "$body" | head -5 | tr '\n' ' ')"
    return
  fi

  # Step 3: empty/neutral body — FAIL (same as P11).
  if [[ "$rejected" == "false" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="${label} FAIL: no rejection signal and no success marker (neutral body is ADR-0082-suspect). exit=${exit_code}, body: $(echo "$body" | head -5 | tr '\n' ' ')"
    return
  fi

  # Step 4: token check — rejection must name the expected field.
  if ! echo "$body" | grep -qiE "$token_regex"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="${label} FAIL: error fires but does not name expected field (${token_regex}). reject_via=${reject_via}. Body: $(echo "$body" | head -5 | tr '\n' ' ')"
    return
  fi

  # Step 5: structural hint check — body must carry constraint vocabulary.
  local hint_regex='required|must|invalid|expected|missing|type|string|array|number|schema|validation'
  if ! echo "$body" | grep -qiE "$hint_regex"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="${label} FAIL: names field but not shape (no structural hint word from {${hint_regex}}). reject_via=${reject_via}. Body: $(echo "$body" | head -5 | tr '\n' ' ')"
    return
  fi

  # All three layers passed.
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="${label} OK: rejected via ${reject_via}, named ${token_regex}, carries structural hint"
}

# ════════════════════════════════════════════════════════════════════
# 1. memory_store
# ════════════════════════════════════════════════════════════════════
_p12_memory_missing_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _mcp_invoke_tool "memory_store" \
    '{}' \
    '.' "P12/memory_store/missing" 20 --ro
  _p12_expect_named_error "P12/memory_store/missing" 'key'
  E2E_DIR="$_saved"
}
check_adr0094_p12_quality_memory_missing() {
  _with_iso_cleanup "p12-qual-memory-missing" _p12_memory_missing_body
}

_p12_memory_wrong_type_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _mcp_invoke_tool "memory_store" \
    '{"key":"k","value":42}' \
    '.' "P12/memory_store/wtype" 20 --ro
  _p12_expect_named_error "P12/memory_store/wrong-type" 'value'
  E2E_DIR="$_saved"
}
check_adr0094_p12_quality_memory_wrong_type() {
  _with_iso_cleanup "p12-qual-memory-wtype" _p12_memory_wrong_type_body
}

# ════════════════════════════════════════════════════════════════════
# 2. session_save
# ════════════════════════════════════════════════════════════════════
_p12_session_missing_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _mcp_invoke_tool "session_save" \
    '{}' \
    '.' "P12/session_save/missing" 20 --ro
  _p12_expect_named_error "P12/session_save/missing" 'name'
  E2E_DIR="$_saved"
}
check_adr0094_p12_quality_session_missing() {
  _with_iso_cleanup "p12-qual-session-missing" _p12_session_missing_body
}

_p12_session_wrong_type_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _mcp_invoke_tool "session_save" \
    '{"name":42}' \
    '.' "P12/session_save/wtype" 20 --ro
  _p12_expect_named_error "P12/session_save/wrong-type" 'name|string'
  E2E_DIR="$_saved"
}
check_adr0094_p12_quality_session_wrong_type() {
  _with_iso_cleanup "p12-qual-session-wtype" _p12_session_wrong_type_body
}

# ════════════════════════════════════════════════════════════════════
# 3. agent_spawn
# ════════════════════════════════════════════════════════════════════
_p12_agent_missing_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _mcp_invoke_tool "agent_spawn" \
    '{}' \
    '.' "P12/agent_spawn/missing" 20 --ro
  _p12_expect_named_error "P12/agent_spawn/missing" 'type'
  E2E_DIR="$_saved"
}
check_adr0094_p12_quality_agent_missing() {
  _with_iso_cleanup "p12-qual-agent-missing" _p12_agent_missing_body
}

_p12_agent_wrong_type_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _mcp_invoke_tool "agent_spawn" \
    '{"type":42}' \
    '.' "P12/agent_spawn/wtype" 20 --ro
  _p12_expect_named_error "P12/agent_spawn/wrong-type" 'type|string'
  E2E_DIR="$_saved"
}
check_adr0094_p12_quality_agent_wrong_type() {
  _with_iso_cleanup "p12-qual-agent-wtype" _p12_agent_wrong_type_body
}

# ════════════════════════════════════════════════════════════════════
# 4. claims_claim
# ════════════════════════════════════════════════════════════════════
_p12_claims_missing_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  # claims_claim requires BOTH issueId and claimant. Empty input surfaces
  # whichever guard fires first — accept either token name.
  _mcp_invoke_tool "claims_claim" \
    '{}' \
    '.' "P12/claims_claim/missing" 20 --ro
  _p12_expect_named_error "P12/claims_claim/missing" 'issueId|claimant'
  E2E_DIR="$_saved"
}
check_adr0094_p12_quality_claims_missing() {
  _with_iso_cleanup "p12-qual-claims-missing" _p12_claims_missing_body
}

_p12_claims_wrong_type_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  # `task` is not a real claims_claim field (schema: issueId + claimant);
  # passing {"task":[1,2]} still leaves both required fields missing, so
  # the response names one of them. Token matches either.
  _mcp_invoke_tool "claims_claim" \
    '{"task":[1,2]}' \
    '.' "P12/claims_claim/wtype" 20 --ro
  _p12_expect_named_error "P12/claims_claim/wrong-type" 'issueId|claimant'
  E2E_DIR="$_saved"
}
check_adr0094_p12_quality_claims_wrong_type() {
  _with_iso_cleanup "p12-qual-claims-wtype" _p12_claims_wrong_type_body
}

# ════════════════════════════════════════════════════════════════════
# 5. workflow_create
# ════════════════════════════════════════════════════════════════════
_p12_workflow_missing_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  # name supplied so the missing-field the tool surfaces is definitively `steps`.
  _mcp_invoke_tool "workflow_create" \
    '{"name":"w"}' \
    '.' "P12/workflow_create/missing" 20 --ro
  _p12_expect_named_error "P12/workflow_create/missing" 'steps'
  E2E_DIR="$_saved"
}
check_adr0094_p12_quality_workflow_missing() {
  _with_iso_cleanup "p12-qual-workflow-missing" _p12_workflow_missing_body
}

_p12_workflow_wrong_type_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _mcp_invoke_tool "workflow_create" \
    '{"name":"w","steps":"x"}' \
    '.' "P12/workflow_create/wtype" 20 --ro
  _p12_expect_named_error "P12/workflow_create/wrong-type" 'steps|array'
  E2E_DIR="$_saved"
}
check_adr0094_p12_quality_workflow_wrong_type() {
  _with_iso_cleanup "p12-qual-workflow-wtype" _p12_workflow_wrong_type_body
}

# ════════════════════════════════════════════════════════════════════
# 6. config_set
# ════════════════════════════════════════════════════════════════════
_p12_config_missing_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  # key supplied so the missing-field the tool surfaces is definitively `value`.
  _mcp_invoke_tool "config_set" \
    '{"key":"k"}' \
    '.' "P12/config_set/missing" 20 --ro
  _p12_expect_named_error "P12/config_set/missing" 'value'
  E2E_DIR="$_saved"
}
check_adr0094_p12_quality_config_missing() {
  _with_iso_cleanup "p12-qual-config-missing" _p12_config_missing_body
}

_p12_config_wrong_type_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _mcp_invoke_tool "config_set" \
    '{"key":42,"value":"v"}' \
    '.' "P12/config_set/wtype" 20 --ro
  _p12_expect_named_error "P12/config_set/wrong-type" 'key|string'
  E2E_DIR="$_saved"
}
check_adr0094_p12_quality_config_wrong_type() {
  _with_iso_cleanup "p12-qual-config-wtype" _p12_config_wrong_type_body
}

# ════════════════════════════════════════════════════════════════════
# 7. neural_train
# ════════════════════════════════════════════════════════════════════
_p12_neural_missing_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  # neural_train's required-field name is contested across upstream revisions:
  # some versions want `patternType`, some `pattern_type`, some `model`.
  # Accept any of those so the check is robust across builds.
  _mcp_invoke_tool "neural_train" \
    '{}' \
    '.' "P12/neural_train/missing" 20 --ro
  _p12_expect_named_error "P12/neural_train/missing" 'patternType|pattern_type|model'
  E2E_DIR="$_saved"
}
check_adr0094_p12_quality_neural_missing() {
  _with_iso_cleanup "p12-qual-neural-missing" _p12_neural_missing_body
}

_p12_neural_wrong_type_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _mcp_invoke_tool "neural_train" \
    '{"patternType":42}' \
    '.' "P12/neural_train/wtype" 20 --ro
  _p12_expect_named_error "P12/neural_train/wrong-type" 'patternType|pattern_type|string|type'
  E2E_DIR="$_saved"
}
check_adr0094_p12_quality_neural_wrong_type() {
  _with_iso_cleanup "p12-qual-neural-wtype" _p12_neural_wrong_type_body
}

# ════════════════════════════════════════════════════════════════════
# 8. autopilot_enable — REMOVED
# ════════════════════════════════════════════════════════════════════
# autopilot_enable has no required fields; `{}` is a valid invocation
# that returns success:true. Both the missing-field and wrong-type probes
# are inapplicable (no "required field" surface to name, no typed slot
# to type-mismatch). Removed to align the matrix with real tool schemas
# rather than speculating. Matrix: 8 classes × 2 reps = 16 → 7 classes ×
# 2 reps = 14. See header comment for drop rationale.
