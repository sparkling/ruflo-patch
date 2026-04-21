#!/usr/bin/env bash
# lib/acceptance-phase16-pii-inverse.sh — ADR-0094 Phase 16: PII detection inverse
#
# Asserts the aidefence PII detector does NOT false-positive on non-PII
# inputs. The upstream Phase-1 positive check (`check_adr0094_p1_aidefence_
# has_pii`) proves the detector FIRES on obvious PII; this phase proves it
# does NOT fire on benign inputs. Together they bracket the detector's
# contract from both sides.
#
# ADR-0082 silent-pass trap — the reason the guard check exists:
#   A detector that has regressed to "always return false" would cause every
#   inverse check in this file to pass trivially, giving the appearance of
#   coverage while testing nothing. Check #8 (`guard_detects_email`) is the
#   positive control — it invokes the same tool with an obvious email address
#   and asserts `"hasPII":true`. If the guard FAILs, the inverse checks must
#   be read as unreliable regardless of their individual verdicts. This is
#   exactly the pattern ADR-0082 exists to prevent (silent-pass via a stub)
#   and the pattern ADR-0090 Tier A2 codified at the harness layer
#   (skip_accepted bucket).
#
# Upstream response shape (verified live against 3.5.58-patch.136):
#   aidefence_has_pii → { "hasPII": true|false }       (exact casing)
#   aidefence_scan    → { "safe": bool,
#                         "piiFound": bool,
#                         "threats": [...],
#                         "detectionTimeMs": number,
#                         "mitigations": [...] }
#
# Tool matrix (7 inverse + 1 guard = 8 checks; all --ro):
#   #  check                                  tool              assertion
#   1. nopii_plain_prose       aidefence_has_pii  hasPII:false
#   2. nopii_code_snippet      aidefence_has_pii  hasPII:false
#   3. nopii_version_string    aidefence_has_pii  hasPII:false
#   4. nopii_uuid              aidefence_has_pii  hasPII:false
#   5. nopii_url               aidefence_has_pii  hasPII:false
#   6. nopii_markdown          aidefence_has_pii  hasPII:false
#   7. nopii_scan_clean        aidefence_scan     piiFound:false AND safe:true
#   8. guard_detects_email     aidefence_has_pii  hasPII:true  (POSITIVE control)
#
# Verdict buckets:
#   - PASS          : inverse check body matches `"hasPII":false` AND does NOT
#                     match `"hasPII":true`; guard body matches `"hasPII":true`;
#                     scan_clean body matches both `"piiFound":false` AND
#                     `"safe":true`.
#   - FAIL — false-positive    : inverse check body carries `"hasPII":true`
#                     (detector is over-eager).
#   - FAIL — guard regression  : guard check body carries `"hasPII":false`
#                     (detector has regressed — inverse coverage is unreliable).
#   - FAIL — missing field     : body missing the expected JSON key altogether
#                     (response shape changed; reassess this phase).
#   - SKIP_ACCEPTED            : `_mcp_invoke_tool` reports tool-not-found.
#                     Handled by the shared harness; we do not reimplement.
#
# Requires: acceptance-harness.sh (_mcp_invoke_tool, _with_iso_cleanup).
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG.

# ════════════════════════════════════════════════════════════════════
# Shared helpers — inverse + positive PII assertion.
# ════════════════════════════════════════════════════════════════════

# _p16_assert_no_pii <label> <params_json>
#
# Invokes aidefence_has_pii with <params_json>, asserts the body carries
# `"hasPII":false`. Belt-and-braces: after the primary regex match, ALSO
# grep for `"hasPII":true` and force-FAIL if present. That guards against
# a body that somehow contains both tokens (e.g. a debug echo of the
# input alongside the verdict); without this second check the first
# regex alone could silent-pass.
_p16_assert_no_pii() {
  local label="$1" params="$2"

  _mcp_invoke_tool \
    "aidefence_has_pii" \
    "$params" \
    '"hasPII"[[:space:]]*:[[:space:]]*false' \
    "$label" \
    15 --ro

  # SKIP_ACCEPTED / not-found is handled by _mcp_invoke_tool — bail.
  if [[ "${_CHECK_PASSED:-}" == "skip_accepted" ]]; then
    return
  fi

  # Primary regex didn't match — harness already wrote a diagnostic.
  if [[ "${_CHECK_PASSED:-}" != "true" ]]; then
    return
  fi

  # Belt-and-braces: body must NOT also contain `"hasPII":true`. If it
  # does, the primary regex matched on a stray token and we force-FAIL
  # with an explicit diagnostic.
  if echo "${_MCP_BODY:-}" | grep -qE '"hasPII"[[:space:]]*:[[:space:]]*true'; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="${label} FAIL: body contains BOTH \"hasPII\":false AND \"hasPII\":true — ambiguous response, treat as false-positive. Body (first 10 lines):
$(echo "${_MCP_BODY:-}" | head -10)"
    return
  fi

  # Canonical PASS diagnostic — overwrites the harness's regex-echo line
  # with a human-readable no-PII / clean verdict. Downstream dashboards
  # and the paired unit test grep on "hasPII:false" / "no PII" / "clean".
  _CHECK_OUTPUT="${label}: benign input → hasPII:false (no PII, clean)"
}

# _p16_assert_has_pii <label> <params_json>
#
# Positive guard — invokes aidefence_has_pii with obvious PII and asserts
# the body carries `"hasPII":true`. If the detector has regressed to a
# stub-returning-false, this check FAILS and the inverse checks above
# must be read as unreliable. This is the ADR-0082 canary for this phase.
_p16_assert_has_pii() {
  local label="$1" params="$2"

  _mcp_invoke_tool \
    "aidefence_has_pii" \
    "$params" \
    '"hasPII"[[:space:]]*:[[:space:]]*true' \
    "$label" \
    15 --ro

  # SKIP_ACCEPTED propagates as-is; guard regression shows up as the
  # harness's default FAIL diagnostic (body did not match /true/).
  if [[ "${_CHECK_PASSED:-}" == "skip_accepted" ]]; then
    return
  fi

  if [[ "${_CHECK_PASSED:-}" != "true" ]]; then
    _CHECK_OUTPUT="${label} FAIL — GUARD REGRESSION: obvious PII input did not produce \"hasPII\":true. Detector may have regressed to a stub (every inverse check in Phase 16 becomes unreliable until this is fixed — ADR-0082 silent-pass trap). Body (first 10 lines):
$(echo "${_MCP_BODY:-}" | head -10)"
    return
  fi
}

# _p16_assert_scan_clean <label> <params_json>
#
# Invokes aidefence_scan with a benign input and asserts BOTH
# `"piiFound":false` AND `"safe":true`. Either assertion failing maps
# to FAIL with a diagnostic naming the specific field that mismatched,
# so a shape change in the upstream envelope is distinguishable from
# a real false-positive.
_p16_assert_scan_clean() {
  local label="$1" params="$2"

  _mcp_invoke_tool \
    "aidefence_scan" \
    "$params" \
    '"piiFound"[[:space:]]*:[[:space:]]*false' \
    "$label" \
    15 --ro

  if [[ "${_CHECK_PASSED:-}" == "skip_accepted" ]]; then
    return
  fi

  if [[ "${_CHECK_PASSED:-}" != "true" ]]; then
    # First-field miss; harness wrote the diagnostic. Augment it so the
    # operator can see which field failed without reading the regex.
    _CHECK_OUTPUT="${label} FAIL: \"piiFound\":false not found in body (benign input triggered PII detection — false-positive). Body (first 10 lines):
$(echo "${_MCP_BODY:-}" | head -10)"
    return
  fi

  # piiFound:false matched — now assert safe:true too. Without this,
  # the check would PASS on a body that says "no PII but also unsafe",
  # which contradicts the benign-input premise.
  if ! echo "${_MCP_BODY:-}" | grep -qE '"safe"[[:space:]]*:[[:space:]]*true'; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="${label} FAIL: \"piiFound\":false matched but \"safe\":true did NOT — body is contradictory for a benign input (no PII yet unsafe). Body (first 10 lines):
$(echo "${_MCP_BODY:-}" | head -10)"
    return
  fi

  _CHECK_OUTPUT="${label}: aidefence_scan on benign input returned \"piiFound\":false AND \"safe\":true (canonical clean verdict)"
}

# ════════════════════════════════════════════════════════════════════
# 1. nopii_plain_prose — generic English sentence
# ════════════════════════════════════════════════════════════════════
_p16_nopii_plain_prose_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _p16_assert_no_pii "P16/nopii_plain_prose" \
    '{"input":"Hello world, this is a simple sentence."}'
  E2E_DIR="$_saved"
}
check_adr0094_p16_nopii_plain_prose() {
  _with_iso_cleanup "p16-nopii-plain-prose" _p16_nopii_plain_prose_body
}

# ════════════════════════════════════════════════════════════════════
# 2. nopii_code_snippet — short JS expression
# ════════════════════════════════════════════════════════════════════
_p16_nopii_code_snippet_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _p16_assert_no_pii "P16/nopii_code_snippet" \
    '{"input":"const counter = 42; return counter + 1;"}'
  E2E_DIR="$_saved"
}
check_adr0094_p16_nopii_code_snippet() {
  _with_iso_cleanup "p16-nopii-code-snippet" _p16_nopii_code_snippet_body
}

# ════════════════════════════════════════════════════════════════════
# 3. nopii_version_string — version/date/build noise
# ════════════════════════════════════════════════════════════════════
_p16_nopii_version_string_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _p16_assert_no_pii "P16/nopii_version_string" \
    '{"input":"Version 1.2.3 released on 2024-01-15 with patch 42"}'
  E2E_DIR="$_saved"
}
check_adr0094_p16_nopii_version_string() {
  _with_iso_cleanup "p16-nopii-version-string" _p16_nopii_version_string_body
}

# ════════════════════════════════════════════════════════════════════
# 4. nopii_uuid — random UUIDv4 (deliberately not a stable identifier)
# ════════════════════════════════════════════════════════════════════
_p16_nopii_uuid_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _p16_assert_no_pii "P16/nopii_uuid" \
    '{"input":"550e8400-e29b-41d4-a716-446655440000"}'
  E2E_DIR="$_saved"
}
check_adr0094_p16_nopii_uuid() {
  _with_iso_cleanup "p16-nopii-uuid" _p16_nopii_uuid_body
}

# ════════════════════════════════════════════════════════════════════
# 5. nopii_url — public docs URL, no user-identifying path segments
# ════════════════════════════════════════════════════════════════════
_p16_nopii_url_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _p16_assert_no_pii "P16/nopii_url" \
    '{"input":"Visit https://docs.example.com/api/v1/users for details"}'
  E2E_DIR="$_saved"
}
check_adr0094_p16_nopii_url() {
  _with_iso_cleanup "p16-nopii-url" _p16_nopii_url_body
}

# ════════════════════════════════════════════════════════════════════
# 6. nopii_markdown — markdown formatting with heading + emphasis
# ════════════════════════════════════════════════════════════════════
_p16_nopii_markdown_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  # Literal \n inside the JSON string — the JSON parser sees "# Heading\n..."
  _p16_assert_no_pii "P16/nopii_markdown" \
    '{"input":"# Heading\nThis is **bold** and *italic* text."}'
  E2E_DIR="$_saved"
}
check_adr0094_p16_nopii_markdown() {
  _with_iso_cleanup "p16-nopii-markdown" _p16_nopii_markdown_body
}

# ════════════════════════════════════════════════════════════════════
# 7. nopii_scan_clean — aidefence_scan against benign input
# ════════════════════════════════════════════════════════════════════
_p16_nopii_scan_clean_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _p16_assert_scan_clean "P16/nopii_scan_clean" \
    '{"input":"Hello world, benign input."}'
  E2E_DIR="$_saved"
}
check_adr0094_p16_nopii_scan_clean() {
  _with_iso_cleanup "p16-nopii-scan-clean" _p16_nopii_scan_clean_body
}

# ════════════════════════════════════════════════════════════════════
# 8. guard_detects_email — POSITIVE control (ADR-0082 canary)
#
# Without this guard, a detector that silently regressed to always-false
# would make every inverse check above pass trivially. Any FAIL here
# invalidates the inverse verdicts until the detector is restored.
# ════════════════════════════════════════════════════════════════════
_p16_guard_detects_email_body() {
  local iso="$1"; local _saved="${E2E_DIR:-}"; E2E_DIR="$iso"
  _p16_assert_has_pii "P16/guard_detects_email" \
    '{"input":"Contact john@example.com for details"}'
  E2E_DIR="$_saved"
}
check_adr0094_p16_guard_detects_email() {
  _with_iso_cleanup "p16-guard-detects-email" _p16_guard_detects_email_body
}
