# lib/acceptance-adr0246-checks.sh — ADR-0246 internals correctness trip-wire.
#
# Wires Batch 1's ADR-0246 (F-03-001 / F-03-002 / F-03-003) per-package
# unit tests into the fast acceptance runner. Three checks:
#
#   1. The three test files exist at forks/agentdb/tests/unit/.
#   2. vitest runs them end-to-end with non-empty pass count.
#   3. (Cross-bonus) F-03-007 precondition: mockEmbedding still present
#      in EmbeddingService.ts (Batch 1 did not touch it; closes
#      by-construction when ADR-0234 lands in Batch 2).
#
# Per ADR-0233 second-pass §Per-ADR validation gates.

_FORK_AGENTDB="/Users/henrik/source/forks/agentdb"

check_adr0246_test_files_present() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local missing=0
  for f in \
    "${_FORK_AGENTDB}/tests/unit/adr0246-f03001-metric-persistence.test.mjs" \
    "${_FORK_AGENTDB}/tests/unit/adr0246-f03002-staged-write.test.mjs" \
    "${_FORK_AGENTDB}/tests/unit/adr0246-f03003-factory-defaults.test.mjs"; do
    [[ -f "$f" ]] || missing=$((missing + 1))
  done

  if [[ "$missing" -gt 0 ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: $missing of 3 ADR-0246 test files missing in tests/unit/"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="All 3 ADR-0246 test files present (F-03-001, F-03-002, F-03-003)"
}

check_adr0246_vitest_run() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  if [[ ! -d "${_FORK_AGENTDB}/node_modules" ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: agentdb fork node_modules absent (run npm ci in fork first)"
    return
  fi

  local log
  log=$(mktemp /tmp/adr0246-vitest-XXXXX.log)
  (cd "${_FORK_AGENTDB}" && timeout 60 npx vitest run \
    tests/unit/adr0246-f03001-metric-persistence.test.mjs \
    tests/unit/adr0246-f03002-staged-write.test.mjs \
    tests/unit/adr0246-f03003-factory-defaults.test.mjs \
    >"$log" 2>&1)
  local rc=$?

  if [[ $rc -ne 0 ]]; then
    local tail
    tail=$(tail -5 "$log" | tr '\n' ' ')
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: vitest rc=$rc — $tail"
    rm -f "$log"
    return
  fi

  # Parse pass count from vitest output (e.g. "Tests   7 passed (7)").
  # Strip ANSI escapes first — vitest emits color codes between "Tests" and the number.
  local passed
  passed=$(sed -E $'s/\x1b\\[[0-9;]*[mK]//g' "$log" | grep -oE "Tests +[0-9]+ passed" | head -1 | grep -oE "[0-9]+")
  passed=${passed:-0}

  if [[ "$passed" -lt 1 ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: vitest rc=0 but no passing tests parsed from output"
    rm -f "$log"
    return
  fi

  rm -f "$log"
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="vitest passed: $passed test(s) across 3 ADR-0246 files"
}

check_adr0246_f03007_precondition() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local src="${_FORK_AGENTDB}/src/controllers/EmbeddingService.ts"
  if [[ ! -f "$src" ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: EmbeddingService.ts not found"
    return
  fi

  if ! grep -q "mockEmbedding" "$src"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: F-03-007 cross-bonus precondition broken — mockEmbedding absent (ADR-0234 will re-validate)"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="F-03-007 precondition intact — mockEmbedding present (closes when ADR-0234 lands in Batch 2)"
}
