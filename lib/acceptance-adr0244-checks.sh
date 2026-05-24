# lib/acceptance-adr0244-checks.sh — ADR-0244 honesty fixes trip-wire.
#
# Wires Batch 4's ADR-0244 (8 commits across sites #1-#11, includes the
# CRITICAL daemon-PID race pair sites #1 + #2 and 7 HIGH/MEDIUM honesty
# fixes) per-site implementation snapshots into the fast acceptance
# runner.
#
# Four checks:
#
#   1. CRITICAL pair landed — process.ts daemon block deleted +
#      start.ts daemonPidPath WRITE removed (the in-startAction
#      `daemonPidPath = ...; await writeFile` block, NOT the unrelated
#      pre-existing-cleanup unlink in stop logic).
#   2. Pass 9 codemod extension landed (commands/*.ts brand-drift
#      pass present in scripts/codemod.mjs).
#   3. ADR-0244 vitest suite present (8 test files) and runs green
#      (53/53).
#   4. INTEGRATION-LEDGER has ≥9 byte-identical rows for ADR-0244.
#
# Per ADR-0233 second-pass §Per-ADR validation gates §Gate 4.

_FORK_RUFLO="/Users/henrik/source/forks/ruflo"
_PATCH_ROOT="/Users/henrik/source/ruflo-patch"

check_adr0244_critical_pair_closed() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local process_ts="${_FORK_RUFLO}/v3/@claude-flow/cli/src/commands/process.ts"
  local start_ts="${_FORK_RUFLO}/v3/@claude-flow/cli/src/commands/start.ts"

  if [[ ! -f "$process_ts" || ! -f "$start_ts" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: process.ts or start.ts missing"
    return
  fi

  # Site #1: daemon subcommand block deleted (no register/case 'daemon').
  if grep -qE "case 'daemon'|register.*'daemon'|daemon\s*=\s*new\s*Command" "$process_ts"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: process.ts still has daemon subcommand registration (site #1 regression)"
    return
  fi

  # Site #1: orphaned writePidFile helpers gone from process.ts.
  if grep -qE "function writePidFile|function readPidFile|function removePidFile" "$process_ts"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: process.ts still defines writePidFile/readPidFile/removePidFile helpers (site #1 regression)"
    return
  fi

  # Site #2: startAction no longer writes daemonPidPath. The unrelated
  # cleanup unlink in stop logic at the bottom of the file is allowed.
  # Look for a `writeFile.*daemonPidPath` or `await fs.writeFile.*daemon.pid` write.
  if grep -qE "(writeFile|fs\.writeFile|writeFileSync).*daemon\.pid|writeFile.*daemonPidPath" "$start_ts"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: start.ts still WRITES daemon.pid in startAction (site #2 regression)"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0244 CRITICAL pair closed: process.ts daemon block deleted; start.ts daemonPidPath write removed"
}

check_adr0244_pass9_codemod_extension() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local codemod="${_PATCH_ROOT}/scripts/codemod.mjs"
  if [[ ! -f "$codemod" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: codemod.mjs missing at scripts/"
    return
  fi

  # Pass 9 marker — brand-drift over commands/*.ts.
  if ! grep -qE "Pass 9|ADR-0244 site #9|brand-drift.*commands" "$codemod"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: codemod.mjs missing Pass 9 / ADR-0244 site #9 brand-drift marker"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="codemod.mjs has Pass 9 brand-drift extension (ADR-0244 site #9)"
}

check_adr0244_vitest_suite() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local tests_dir="${_FORK_RUFLO}/v3/@claude-flow/cli/__tests__"
  if [[ ! -d "$tests_dir" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: cli __tests__ dir missing"
    return
  fi

  # Count ADR-0244 test files (expect 8).
  local n
  n=$(find "$tests_dir" -name "adr0244*.test.ts" -type f | wc -l | tr -d ' ')
  if [[ "$n" -lt 8 ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: expected ≥8 adr0244*.test.ts files, found $n"
    return
  fi

  # Run them and expect 53/53 pass.
  local log
  log=$(mktemp /tmp/adr0244-vitest-XXXXX.log)
  (cd "$_FORK_RUFLO" && timeout 120 npx vitest run "v3/@claude-flow/cli/__tests__/adr0244" >"$log" 2>&1)
  local rc=$?

  if [[ $rc -ne 0 ]]; then
    local tail_out
    tail_out=$(tail -10 "$log" | tr '\n' ' ')
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: adr0244 vitest exit=$rc; tail: $tail_out"
    rm -f "$log"
    return
  fi

  # Expect "Tests  53 passed (53)".
  if ! grep -qE "Tests +53 passed \(53\)" "$log"; then
    local summary
    summary=$(grep -E "Test Files|Tests " "$log" | tr '\n' ' ')
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: adr0244 vitest passed but count != 53/53: $summary"
    rm -f "$log"
    return
  fi

  rm -f "$log"
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0244 vitest suite: $n files, 53/53 pass"
}

check_adr0244_ledger_rows() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local ledger="${_PATCH_ROOT}/docs/upstream/INTEGRATION-LEDGER.md"
  if [[ ! -f "$ledger" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: INTEGRATION-LEDGER.md missing"
    return
  fi

  # Per `[[reference-grep-c-bash-trap]]`: do NOT use `|| echo 0` (produces "0\n0").
  local n
  n=$(grep -c "ADR-0244" "$ledger" 2>/dev/null)
  n=${n:-0}

  if [[ "$n" -lt 9 ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: expected ≥9 ADR-0244 rows in INTEGRATION-LEDGER.md, found $n"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="INTEGRATION-LEDGER.md has $n ADR-0244 rows (≥9 expected)"
}
