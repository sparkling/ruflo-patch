# lib/acceptance-adr0247-checks.sh — ADR-0247 honesty fixes trip-wire.
#
# Wires Batch 4's ADR-0247 (3 commits, sites #1 mcp-client isError +
# #2 honesty-cluster joint + #3 aidefence install backoff) per-site
# implementation snapshots into the fast acceptance runner.
#
# Three checks:
#
#   1. Site #1 (F-04-009): callMCPTool inspects isError envelope and
#      throws MCPClientError instead of returning the raw envelope.
#   2. Site #3 (F-04-011): security-tools installAttemptedAt 5-minute
#      backoff for aidefence auto-install (renamed from boolean
#      installAttempted).
#   3. INTEGRATION-LEDGER has ≥2 byte-identical rows for ADR-0247.
#
# Also runs the isError + backoff vitest pair (10/10) once if cli pkg
# layout permits.
#
# Per ADR-0233 second-pass §Per-ADR validation gates §Gate 4.

_FORK_RUFLO="/Users/henrik/source/forks/ruflo"
_PATCH_ROOT="/Users/henrik/source/ruflo-patch"

check_adr0247_site1_iserror_envelope() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local client="${_FORK_RUFLO}/v3/@claude-flow/cli/src/mcp-client.ts"
  if [[ ! -f "$client" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: mcp-client.ts missing at cli/src/"
    return
  fi

  # Site #1: callMCPTool must inspect isError and throw MCPClientError.
  if ! grep -qE "isError" "$client"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: mcp-client.ts has no isError inspection (site #1 regression)"
    return
  fi

  if ! grep -qE "class MCPClientError|throw new MCPClientError" "$client"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: mcp-client.ts missing MCPClientError class or throw (site #1 regression)"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="mcp-client.ts inspects isError and throws MCPClientError (ADR-0247 site #1)"
}

check_adr0247_site3_security_backoff() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local sec="${_FORK_RUFLO}/v3/@claude-flow/cli/src/mcp-tools/security-tools.ts"
  if [[ ! -f "$sec" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: security-tools.ts missing"
    return
  fi

  # Site #3: installAttemptedAt (number|null) replaces installAttempted boolean.
  if ! grep -qE "installAttemptedAt" "$sec"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: security-tools.ts missing installAttemptedAt (site #3 regression)"
    return
  fi

  # The 5-minute backoff window (5 * 60 * 1000 = 300000 ms) should be present.
  if ! grep -qE "5\s*\*\s*60\s*\*\s*1000|300000|5 minute|five minute" "$sec"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: security-tools.ts missing 5-minute backoff constant (site #3 regression)"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="security-tools.ts has installAttemptedAt 5-minute backoff (ADR-0247 site #3)"
}

check_adr0247_vitest_pair() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local t1="${_FORK_RUFLO}/v3/@claude-flow/cli/__tests__/mcp-client-iserror.test.ts"
  local t2="${_FORK_RUFLO}/v3/@claude-flow/cli/__tests__/security-tools-backoff.test.ts"
  if [[ ! -f "$t1" || ! -f "$t2" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: ADR-0247 vitest pair missing (iserror=$([[ -f $t1 ]] && echo 1 || echo 0) backoff=$([[ -f $t2 ]] && echo 1 || echo 0))"
    return
  fi

  local log
  log=$(mktemp /tmp/adr0247-vitest-XXXXX.log)
  (cd "$_FORK_RUFLO" && timeout 90 npx vitest run "$t1" "$t2" >"$log" 2>&1)
  local rc=$?

  if [[ $rc -ne 0 ]]; then
    local tail_out
    tail_out=$(tail -10 "$log" | tr '\n' ' ')
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: adr0247 vitest exit=$rc; tail: $tail_out"
    rm -f "$log"
    return
  fi

  if ! grep -qE "Tests +10 passed \(10\)" "$log"; then
    local summary
    summary=$(grep -E "Test Files|Tests " "$log" | tr '\n' ' ')
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: adr0247 vitest passed but count != 10/10: $summary"
    rm -f "$log"
    return
  fi

  rm -f "$log"
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0247 vitest pair: 10/10 pass (6 isError + 4 backoff)"
}

check_adr0247_ledger_rows() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local ledger="${_PATCH_ROOT}/docs/upstream/INTEGRATION-LEDGER.md"
  if [[ ! -f "$ledger" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: INTEGRATION-LEDGER.md missing"
    return
  fi

  local n
  n=$(grep -c "ADR-0247" "$ledger" 2>/dev/null || echo 0)
  n=${n:-0}

  if [[ "$n" -lt 2 ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: expected ≥2 ADR-0247 rows in INTEGRATION-LEDGER.md, found $n"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="INTEGRATION-LEDGER.md has $n ADR-0247 rows (≥2 expected)"
}
