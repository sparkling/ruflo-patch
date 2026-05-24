# lib/acceptance-adr0241-checks.sh — ADR-0241 schema-vs-handler parity trip-wire.
#
# Wires Batch 3's ADR-0241 (CT-H: schema-vs-handler truth + dedupe) per-package
# unit tests + structural arch-test into the fast acceptance runner.
#
# Four checks (per ADR-0241 §Confirmation + §"Concrete change shape"):
#
#   1. memory_store schema relaxed — `required` no longer lists `'namespace'`
#      (F-14-001 close, Option D1).
#   2. validate-input typed allowlist — both fork copies
#      (`cli-core/src/mcp-tools/validate-input.ts` and
#      `cli/src/mcp-tools/validate-input.ts`) reference
#      `SUPPRESSED_VALIDATION_CODES` instead of the bare
#      `if (issue.code === 'invalid_enum_value') continue;` swallow
#      (F-14-003 close).
#   3. Arch-test file present at
#      `cli/__tests__/arch/schema-handler-parity.arch.test.ts`.
#   4. Arch-test passes via vitest — enumerates ~115 (tool, requiredField)
#      pairs and asserts no handler silently defaults a schema-required
#      field on a literal (the F-14-001 defect class).
#
# Per ADR-0233 second-pass §Per-ADR validation gates §Gate 3.

_FORK_RUFLO="/Users/henrik/source/forks/ruflo"

check_adr0241_memory_store_schema_relaxed() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local memtools="${_FORK_RUFLO}/v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts"
  if [[ ! -f "$memtools" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: memory-tools.ts missing at ${memtools}"
    return
  fi

  # Strip line comments before scanning so the ADR-0241 divergence-marker
  # comment (which cites upstream's `required: ['key', 'value']`) doesn't
  # mask a real schema regression. The first non-comment `required: [...]`
  # in the file is the memory_store schema (per ADR-0241 Option D1).
  local first_required
  first_required=$(sed -E 's://[^\n]*$::g' "$memtools" \
    | grep -oE "required: \[[^]]+\]" \
    | head -1)

  if [[ "$first_required" != "required: ['key', 'value']" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: memory_store schema not relaxed — first \`required: […]\` reads: ${first_required:-<empty>}"
    return
  fi

  if ! grep -q "ADR-0241" "$memtools"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: memory-tools.ts missing ADR-0241 divergence marker after schema relax"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="memory_store schema relaxed (\`required: ['key', 'value']\`) + ADR-0241 marker present"
}

check_adr0241_validate_input_allowlist() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local copies=(
    "${_FORK_RUFLO}/v3/@claude-flow/cli-core/src/mcp-tools/validate-input.ts"
    "${_FORK_RUFLO}/v3/@claude-flow/cli/src/mcp-tools/validate-input.ts"
  )

  local missing=0 details=""
  for f in "${copies[@]}"; do
    if [[ ! -f "$f" ]]; then
      missing=$((missing + 1))
      details="${details} missing:${f}"
      continue
    fi
    # The allowlist set must be declared AND referenced; the bare swallow
    # `if (issue.code === 'invalid_enum_value') continue;` must NOT survive.
    if ! grep -q "SUPPRESSED_VALIDATION_CODES" "$f"; then
      missing=$((missing + 1))
      details="${details} no-allowlist:${f}"
      continue
    fi
    if grep -qE "if \(issue\.code === ['\"]invalid_enum_value['\"]\) continue" "$f"; then
      missing=$((missing + 1))
      details="${details} bare-swallow-survived:${f}"
      continue
    fi
    if ! grep -q "ADR-0241" "$f"; then
      missing=$((missing + 1))
      details="${details} no-marker:${f}"
      continue
    fi
  done

  if [[ "$missing" -gt 0 ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: ${missing} of ${#copies[@]} validate-input copies failed allowlist check:${details}"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="Both validate-input copies use SUPPRESSED_VALIDATION_CODES + ADR-0241 marker"
}

check_adr0241_arch_test_present() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local test="${_FORK_RUFLO}/v3/@claude-flow/cli/__tests__/arch/schema-handler-parity.arch.test.ts"
  if [[ ! -f "$test" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: schema-handler-parity.arch.test.ts missing"
    return
  fi

  # The iterator name is the public surface other arch-tests can reuse;
  # if it's renamed the contract changes.
  if ! grep -q "forEachToolRequiredField" "$test"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: arch-test present but forEachToolRequiredField iterator missing"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="schema-handler-parity.arch.test.ts present with forEachToolRequiredField iterator"
}

check_adr0241_arch_test_runs() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli="${_FORK_RUFLO}/v3/@claude-flow/cli"
  if [[ ! -d "${cli}/node_modules" && ! -d "${_FORK_RUFLO}/node_modules" ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: ruflo fork node_modules absent (run npm ci in fork first)"
    return
  fi

  local log
  log=$(mktemp /tmp/adr0241-vitest-XXXXX.log)
  (cd "${cli}" && timeout 60 npx vitest run \
    __tests__/arch/schema-handler-parity.arch.test.ts \
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

  # Strip ANSI codes before parsing pass count.
  local passed
  passed=$(sed -E $'s/\x1b\\[[0-9;]*[mK]//g' "$log" | grep -oE "Tests +[0-9]+ passed" | head -1 | grep -oE "[0-9]+")
  passed=${passed:-0}

  if [[ "$passed" -lt 50 ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: arch-test passed only $passed tests (expected ≥50 — sanity guard for extractor regression)"
    rm -f "$log"
    return
  fi

  rm -f "$log"
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="arch-test passed $passed (tool, requiredField) parity assertions"
}
