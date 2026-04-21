#!/usr/bin/env bash
# lib/acceptance-phase17-validator-fuzzing.sh — ADR-0094 Phase 17: Validator property fuzzing
#
# Meta-tests the bash VALIDATORS earlier phases rely on. If a validator silently
# regresses (branch deleted, regex relaxed, skip-guard removed), the entire
# phase it backs becomes unreliable — every previously-green check would still
# report PASS while the validator has stopped checking anything. Phase 17 seeds
# `_MCP_BODY` / `_MCP_EXIT` / `_CHECK_PASSED` directly (no real MCP call), runs
# the validator, and asserts resulting `_CHECK_PASSED` matches expected verdict.
# The final "turtles all the way down" layer for ADR-0094.
#
# Validators under test: `_p11_expect_fuzz_rejection` (P11 fuzzing),
# `_p12_expect_named_error` (P12 error quality), `_p15_classify` +
# `_p15_expect_deterministic` (P15 flakiness), `_p16_assert_no_pii` +
# `_p16_assert_has_pii` (P16 PII inverse positive guard / ADR-0082 canary).
#
# ADR-0082 silent-pass traps covered:
#   T1 skip-guard preserve; T2 silent-success; T3 neutral body; T4 branch
#   ordering (success:true+error → error wins); T5 P12 token-without-hint;
#   T6 P15 flaky; T7 P16 ambiguous hasPII body; T8 P16 guard regression +
#   "GUARD REGRESSION" diagnostic string.
#
# Per-check matrix (15 checks; all validator-level, no CLI, no E2E_DIR):
#     1. p11-nonzero-exit-passes        (branch a: exit!=0 → PASS)
#     2. p11-success-false-passes       (branch b: "success":false → PASS)
#     3. p11-error-word-passes          (branch c: error-shape word → PASS)
#     4. p11-silent-success-fails       (T2: "success":true, no diagnostic)
#     5. p11-empty-body-fails           (T3: neutral body — ADR-0082 canary)
#     6. p11-skip-propagates            (T1: skip_accepted preserved)
#     7. p11-ambiguity-error-wins       (T4: success:true+error → PASS via c)
#     8. p12-named-with-hint-passes     (canonical: reject + token + hint)
#     9. p12-rejected-without-token-fails (fires but doesn't name field)
#    10. p12-named-but-no-hint-fails    (T5: token present, no structural hint)
#    11. p12-skip-propagates            (T1: P12 skip_accepted preserved)
#    12. p15-classify-four-shapes       (direct stdout: exit_error/empty/failure/success)
#    13. p15-flaky-detected             (T6: flaky/all-empty/all-error FAIL; 3xsuccess PASS)
#    14. p16-no-pii-ambiguous-body-fails (T7: belt-and-braces double-match force-FAIL)
#    15. p16-guard-regression-fails    (T8: hasPII:false on PII input → FAIL + GUARD REGRESSION diag)
#
# Budget: ≤2s wall-clock total. Each check is pure bash string-matching; the
# dominant cost is the validator's own `grep -E` subshells (~40-80ms per check
# × 15 ≈ 0.6-1.2s). Runs in parallel with zero shared I/O.
#
# Requires phases 11/12/15/16 libs sourced by caller (scripts/test-acceptance.sh).
# Does NOT require E2E_DIR, TEMP_DIR, REGISTRY, PKG, or any network/CLI access.

# ════════════════════════════════════════════════════════════════════
# Shared helpers — verdict assertion + MCP stubbing.
# ════════════════════════════════════════════════════════════════════

# _p17_assert_verdict <label> <expected> <actual>
#
# Compares <actual> (the validator's post-state _CHECK_PASSED) against
# <expected> and writes the Phase-17 outcome into _CHECK_PASSED/_CHECK_OUTPUT.
# Must be called AFTER the check function has captured `observed="$_CHECK_PASSED"`
# into a local so the validator's write is not clobbered by the reset below.
_p17_assert_verdict() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="${label} OK: validator produced _CHECK_PASSED=${actual} as expected"
  else
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="${label} FAIL: expected _CHECK_PASSED=${expected}, got ${actual}. Validator misbehaved — its diagnostic (if any): ${_CHECK_OUTPUT:-<empty>}"
  fi
}

# _p17_stub_mcp <stub_body> <stub_exit> <stub_passed>
#
# Replaces _mcp_invoke_tool (normally defined in lib/acceptance-harness.sh) with
# a seeded stub so `_p16_assert_*` validators can be exercised without a real
# CLI spawn. Must be paired with _p17_unstub_mcp. printf %q preserves body
# content across eval (quotes, backslashes, newlines).
_p17_stub_mcp() {
  local body="$1" exit_code="$2" passed="$3"
  _P17_ORIG_MCP=$(declare -f _mcp_invoke_tool 2>/dev/null || echo "")
  local q_body; q_body=$(printf '%q' "$body")
  # shellcheck disable=SC2016
  eval "_mcp_invoke_tool() {
    _MCP_BODY=${q_body}
    _MCP_EXIT=\"${exit_code}\"
    _CHECK_PASSED=\"${passed}\"
    _CHECK_OUTPUT=\"p17-stub\"
  }"
}

_p17_unstub_mcp() {
  unset -f _mcp_invoke_tool 2>/dev/null || true
  if [[ -n "${_P17_ORIG_MCP:-}" ]]; then
    eval "$_P17_ORIG_MCP"
  fi
  _P17_ORIG_MCP=""
}

# ════════════════════════════════════════════════════════════════════
# 1. p11-nonzero-exit-passes — branch (a): exit!=0 → PASS, regardless of body shape
# ════════════════════════════════════════════════════════════════════
check_adr0094_p17_p11_nonzero_exit_passes() {
  local _MCP_BODY='{"success":true}' _MCP_EXIT="7"
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  _p11_expect_fuzz_rejection "P17/p11/nonzero-exit"
  local observed="$_CHECK_PASSED"
  _p17_assert_verdict "P17/p11/nonzero-exit-passes" "true" "$observed"
}

# ════════════════════════════════════════════════════════════════════
# 2. p11-success-false-passes — branch (b): "success":false → PASS
# ════════════════════════════════════════════════════════════════════
check_adr0094_p17_p11_success_false_passes() {
  local _MCP_BODY='{"success":false}' _MCP_EXIT="0"
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  _p11_expect_fuzz_rejection "P17/p11/success-false"
  local observed="$_CHECK_PASSED"
  _p17_assert_verdict "P17/p11/success-false-passes" "true" "$observed"
}

# ════════════════════════════════════════════════════════════════════
# 3. p11-error-word-passes — branch (c): diagnostic word → PASS
# ════════════════════════════════════════════════════════════════════
check_adr0094_p17_p11_error_word_passes() {
  local _MCP_BODY='{"msg":"required field missing"}' _MCP_EXIT="0"
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  _p11_expect_fuzz_rejection "P17/p11/error-word"
  local observed="$_CHECK_PASSED"
  _p17_assert_verdict "P17/p11/error-word-passes" "true" "$observed"
}

# ════════════════════════════════════════════════════════════════════
# 4. p11-silent-success-fails — ADR-0082 silent-pass canary [T2]
# ════════════════════════════════════════════════════════════════════
check_adr0094_p17_p11_silent_success_fails() {
  local _MCP_BODY='{"success":true}' _MCP_EXIT="0"
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  _p11_expect_fuzz_rejection "P17/p11/silent-success"
  local observed="$_CHECK_PASSED"
  _p17_assert_verdict "P17/p11/silent-success-fails" "false" "$observed"
}

# ════════════════════════════════════════════════════════════════════
# 5. p11-empty-body-fails — ADR-0082 neutral-body canary [T3]
# ════════════════════════════════════════════════════════════════════
check_adr0094_p17_p11_empty_body_fails() {
  local _MCP_BODY="" _MCP_EXIT="0"
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  _p11_expect_fuzz_rejection "P17/p11/empty-body"
  local observed="$_CHECK_PASSED"
  _p17_assert_verdict "P17/p11/empty-body-fails" "false" "$observed"
}

# ════════════════════════════════════════════════════════════════════
# 6. p11-skip-propagates — skip-guard must preserve skip_accepted [T1]
# ════════════════════════════════════════════════════════════════════
check_adr0094_p17_p11_skip_propagates() {
  # Seed a body that would otherwise trigger PASS to prove the skip-guard
  # short-circuits BEFORE the body is inspected.
  local _MCP_BODY='{"error":"not found"}' _MCP_EXIT="0"
  _CHECK_PASSED="skip_accepted"; _CHECK_OUTPUT=""
  _p11_expect_fuzz_rejection "P17/p11/skip-propagate"
  local observed="$_CHECK_PASSED"
  _p17_assert_verdict "P17/p11/skip-propagates" "skip_accepted" "$observed"
}

# ════════════════════════════════════════════════════════════════════
# 7. p11-ambiguity-error-wins — documents actual branch ordering [T4]
# phase11 line 85 (error-shape) runs BEFORE line 92 (silent-success canary).
# If branches are reordered, this check flips — contract change is visible.
# ════════════════════════════════════════════════════════════════════
check_adr0094_p17_p11_ambiguity_error_wins() {
  local _MCP_BODY='{"success":true,"error":"invalid"}' _MCP_EXIT="0"
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  _p11_expect_fuzz_rejection "P17/p11/ambiguity"
  local observed="$_CHECK_PASSED"
  _p17_assert_verdict "P17/p11/ambiguity-error-wins" "true" "$observed"
}

# ════════════════════════════════════════════════════════════════════
# 8. p12-named-with-hint-passes — canonical P12 PASS: rejection + token + hint
# ════════════════════════════════════════════════════════════════════
check_adr0094_p17_p12_named_with_hint_passes() {
  local _MCP_BODY='{"error":"field key is required (expected string)"}' _MCP_EXIT="0"
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  _p12_expect_named_error "P17/p12/named-with-hint" 'key'
  local observed="$_CHECK_PASSED"
  _p17_assert_verdict "P17/p12/named-with-hint-passes" "true" "$observed"
}

# ════════════════════════════════════════════════════════════════════
# 9. p12-rejected-without-token-fails — fires but doesn't name the field
# ════════════════════════════════════════════════════════════════════
check_adr0094_p17_p12_rejected_without_token_fails() {
  local _MCP_BODY='{"error":"validation failed"}' _MCP_EXIT="0"
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  _p12_expect_named_error "P17/p12/no-token" 'nonexistent'
  local observed="$_CHECK_PASSED"
  _p17_assert_verdict "P17/p12/rejected-without-token-fails" "false" "$observed"
}

# ════════════════════════════════════════════════════════════════════
# 10. p12-named-but-no-hint-fails — token present, no structural hint [T5]
# Body uses only "error" as rejection signal (in reject regex, NOT hint
# regex). "rejected" looks hint-like but doesn't match any of the hint
# vocabulary — verified at design time. Widening the hint regex flips this.
# ════════════════════════════════════════════════════════════════════
check_adr0094_p17_p12_named_but_no_hint_fails() {
  local _MCP_BODY='{"status":"error","detail":"the key was rejected"}' _MCP_EXIT="0"
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  _p12_expect_named_error "P17/p12/no-hint" 'key'
  local observed="$_CHECK_PASSED"
  _p17_assert_verdict "P17/p12/named-but-no-hint-fails" "false" "$observed"
}

# ════════════════════════════════════════════════════════════════════
# 11. p12-skip-propagates — [T1] for P12
# ════════════════════════════════════════════════════════════════════
check_adr0094_p17_p12_skip_propagates() {
  local _MCP_BODY='{"success":true}' _MCP_EXIT="0"
  _CHECK_PASSED="skip_accepted"; _CHECK_OUTPUT=""
  _p12_expect_named_error "P17/p12/skip-propagate" 'key'
  local observed="$_CHECK_PASSED"
  _p17_assert_verdict "P17/p12/skip-propagates" "skip_accepted" "$observed"
}

# ════════════════════════════════════════════════════════════════════
# 12. p15-classify-four-shapes — pure-function classifier hits all 4 classes
# Four sub-assertions; 12b (whitespace→empty) guards the tr-strip step.
# ════════════════════════════════════════════════════════════════════
check_adr0094_p17_p15_classify_four_shapes() {
  _CHECK_PASSED="true"; _CHECK_OUTPUT=""
  local got

  # 12a: exit_error — non-zero exit wins regardless of body
  got=$(_p15_classify "anything" 5)
  if [[ "$got" != "exit_error" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="P17/p15/classify FAIL (branch exit_error): expected 'exit_error', got '$got' for body='anything' exit=5 — classifier short-circuit on non-zero exit regressed."
    return
  fi

  # 12b: empty — whitespace-only body classifies as empty (after tr strip)
  got=$(_p15_classify "   " 0)
  if [[ "$got" != "empty" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="P17/p15/classify FAIL (branch empty): expected 'empty' for whitespace body, got '$got' — the tr-whitespace-strip step regressed; whitespace-only body would reach success branch."
    return
  fi

  # 12c: failure — "success":false wins over everything else
  got=$(_p15_classify '{"success":false}' 0)
  if [[ "$got" != "failure" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="P17/p15/classify FAIL (branch failure): expected 'failure' for success:false, got '$got' — explicit failure marker detection regressed."
    return
  fi

  # 12d: success — explicit success marker
  got=$(_p15_classify '{"ok":true}' 0)
  if [[ "$got" != "success" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="P17/p15/classify FAIL (branch success): expected 'success' for non-failure body, got '$got' — default success fallthrough regressed."
    return
  fi

  _CHECK_OUTPUT="P17/p15/classify OK: all 4 shape classes (exit_error, empty, failure, success) returned canonical values"
}

# ════════════════════════════════════════════════════════════════════
# 13. p15-flaky-detected — _p15_expect_deterministic FAILs on flaky + canaries
# Sub-assertions: 13a flaky→FAIL[T6], 13b all-empty→FAIL, 13c all-error→FAIL,
# 13d 3xsuccess→PASS (positive control). 3xfailure is INTENTIONALLY PASS
# (phase15 lines 143-146: Phase 15 measures variance, not correctness).
# ════════════════════════════════════════════════════════════════════
check_adr0094_p17_p15_flaky_detected() {
  _CHECK_PASSED="true"; _CHECK_OUTPUT=""

  # 13a: flaky
  local _CHECK_PASSED_inner=""
  _CHECK_PASSED=""; _CHECK_OUTPUT=""
  _p15_expect_deterministic "P17/p15/flaky" "success" "failure" "empty"
  if [[ "$_CHECK_PASSED" != "false" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="P17/p15/flaky-detected FAIL (13a): three different classes (success,failure,empty) should produce FAIL, got _CHECK_PASSED='$_CHECK_PASSED' — flaky-detection branch regressed (the headline defect of Phase 15)."
    return
  fi

  # 13b: all-empty silent-pass canary
  _CHECK_PASSED=""; _CHECK_OUTPUT=""
  _p15_expect_deterministic "P17/p15/all-empty" "empty" "empty" "empty"
  if [[ "$_CHECK_PASSED" != "false" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="P17/p15/flaky-detected FAIL (13b): three empty classes should produce FAIL (silent-pass canary), got _CHECK_PASSED='$_CHECK_PASSED' — ADR-0082 empty-body guard regressed."
    return
  fi

  # 13c: all-error
  _CHECK_PASSED=""; _CHECK_OUTPUT=""
  _p15_expect_deterministic "P17/p15/all-error" "exit_error" "exit_error" "exit_error"
  if [[ "$_CHECK_PASSED" != "false" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="P17/p15/flaky-detected FAIL (13c): three exit_error classes should produce FAIL (persistent infra fault), got _CHECK_PASSED='$_CHECK_PASSED' — all-error branch regressed."
    return
  fi

  # 13d: 3× success → PASS (positive control; ensures we didn't just blanket-fail)
  _CHECK_PASSED=""; _CHECK_OUTPUT=""
  _p15_expect_deterministic "P17/p15/all-success" "success" "success" "success"
  if [[ "$_CHECK_PASSED" != "true" ]]; then
    local observed_success="$_CHECK_PASSED"
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="P17/p15/flaky-detected FAIL (13d): three success classes should produce PASS (canonical deterministic success), got _CHECK_PASSED='$observed_success' — positive control failed; validator is over-eager to FAIL everything."
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="P17/p15/flaky-detected OK: flaky (a), all-empty (b), all-error (c) all produced FAIL; 3x-success (d) produced PASS"
}

# ════════════════════════════════════════════════════════════════════
# 14. p16-no-pii-ambiguous-body-fails — belt-and-braces double-match force-FAIL [T7]
# Stub lets harness regex match `"hasPII":false` and seed _CHECK_PASSED=true.
# phase16 lines 92-97 must then detect ALSO-present `"hasPII":true` and flip
# to false. 14b positive control (clean body → PASS) prevents a blanket-FAIL
# regression from making 14a pass trivially.
# ════════════════════════════════════════════════════════════════════
check_adr0094_p17_p16_no_pii_ambiguous_body_fails() {
  # 14a: ambiguous body (BOTH tokens) → must FAIL
  _p17_stub_mcp '{"hasPII":false,"echo":"hasPII":true}' "0" "true"
  _CHECK_PASSED="true"; _CHECK_OUTPUT=""
  _p16_assert_no_pii "P17/p16/ambiguous" '{"input":"seeded"}'
  local observed_ambig="$_CHECK_PASSED"
  _p17_unstub_mcp

  if [[ "$observed_ambig" != "false" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="P17/p16/no-pii-ambiguous-body-fails FAIL (14a): body with BOTH \"hasPII\":false AND \"hasPII\":true should force-FAIL (belt-and-braces, phase16 lines 92-97), got _CHECK_PASSED='$observed_ambig' — double-match guard regressed."
    return
  fi

  # 14b: canonical clean body → must PASS (positive control)
  _p17_stub_mcp '{"hasPII":false}' "0" "true"
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  _p16_assert_no_pii "P17/p16/canonical" '{"input":"seeded"}'
  local observed_canon="$_CHECK_PASSED"
  _p17_unstub_mcp

  if [[ "$observed_canon" != "true" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="P17/p16/no-pii-ambiguous-body-fails FAIL (14b, positive control): clean body {\"hasPII\":false} should PASS, got _CHECK_PASSED='$observed_canon' — validator is over-eager to FAIL; 14a's PASS-observed is unreliable."
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="P17/p16/no-pii-ambiguous-body-fails OK: ambiguous body force-FAILed (14a); canonical clean body PASSed (14b)"
}

# ════════════════════════════════════════════════════════════════════
# 15. p16-guard-regression-fails — positive guard flags stub detector [T8]
# Regressed detector (hasPII:false on obvious PII) must FAIL with the specific
# "GUARD REGRESSION" diagnostic string (phase16 lines 127-131) so dashboards
# can grep for it. Also asserts verdict AND diagnostic; 15b is positive
# control (canonical PII → PASS).
# ════════════════════════════════════════════════════════════════════
check_adr0094_p17_p16_guard_regression_fails() {
  # 15a: regressed detector (hasPII:false on obvious-PII input) → must FAIL
  # with "GUARD REGRESSION" diagnostic.
  _p17_stub_mcp '{"hasPII":false}' "0" "false"
  _CHECK_PASSED="true"; _CHECK_OUTPUT=""
  _p16_assert_has_pii "P17/p16/guard-regress" '{"input":"email@example.com"}'
  local observed_regress="$_CHECK_PASSED"
  local diag_regress="$_CHECK_OUTPUT"
  _p17_unstub_mcp

  if [[ "$observed_regress" != "false" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="P17/p16/guard-regression-fails FAIL (15a verdict): regressed detector should produce _CHECK_PASSED=false, got '$observed_regress' — guard branch (phase16 lines 127-131) regressed."
    return
  fi

  if ! echo "$diag_regress" | grep -q 'GUARD REGRESSION'; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="P17/p16/guard-regression-fails FAIL (15a diagnostic): expected diagnostic to contain 'GUARD REGRESSION', got: $diag_regress — custom diagnostic was dropped in favor of the default harness reject message; signal clarity regressed (ADR-0082 §5.9)."
    return
  fi

  # 15b: canonical obvious-PII body → must PASS
  _p17_stub_mcp '{"hasPII":true}' "0" "true"
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  _p16_assert_has_pii "P17/p16/guard-canonical" '{"input":"email@example.com"}'
  local observed_canon="$_CHECK_PASSED"
  _p17_unstub_mcp

  if [[ "$observed_canon" != "true" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="P17/p16/guard-regression-fails FAIL (15b, positive control): canonical obvious-PII body should PASS, got _CHECK_PASSED='$observed_canon' — validator is over-eager to FAIL; 15a's FAIL-observed is unreliable."
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="P17/p16/guard-regression-fails OK: regressed detector produced FAIL with GUARD REGRESSION diagnostic (15a); canonical PII body produced PASS (15b)"
}
