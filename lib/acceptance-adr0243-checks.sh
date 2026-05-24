# lib/acceptance-adr0243-checks.sh — ADR-0243 long-lived process discipline trip-wire.
#
# Wires Batch 2's ADR-0243 (F-10-001 / F-10-005 / F-10-007 / F-10-010 +
# the standalone lint-no-unref-setinterval.mjs Node TS-AST script —
# substituted for the originally-planned ESLint plugin per workspace:*
# protocol constraint) per-site implementation snapshots into the fast
# acceptance runner.
#
# Three checks:
#
#   1. BoundedLRU utility module is present at cli/src/utils/.
#   2. ruvllm-tools / hooks-tools have been migrated to BoundedLRU
#      (no module-scope `new Map()` literals in their cache slots).
#   3. lint-no-unref-setinterval.mjs is wired as `npm run lint` in BOTH
#      cli and memory workspaces, and exits 0 on the current source tree.
#
# Per ADR-0233 second-pass §Per-ADR validation gates §Gate 2.

_FORK_RUFLO="/Users/henrik/source/forks/ruflo"

check_adr0243_boundedlru_present() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local lru="${_FORK_RUFLO}/v3/@claude-flow/cli/src/utils/bounded-lru.ts"
  if [[ ! -f "$lru" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: BoundedLRU utility missing at cli/src/utils/bounded-lru.ts"
    return
  fi

  # Per ADR-0243 §Decision: dispose probe + env-driven cap + fail-loud
  # invalid maxEntries / idleTtlMs.
  if ! grep -q "class BoundedLRU" "$lru"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: bounded-lru.ts present but BoundedLRU class export missing"
    return
  fi

  if ! grep -qE "(dispose|destroy|free)" "$lru"; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: bounded-lru.ts missing dispose-probe surface"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="BoundedLRU utility present with dispose probe surface"
}

check_adr0243_ruvllm_hooks_migrated_to_lru() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local ruvllm="${_FORK_RUFLO}/v3/@claude-flow/cli/src/mcp-tools/ruvllm-tools.ts"
  local hooks="${_FORK_RUFLO}/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts"

  if [[ ! -f "$ruvllm" || ! -f "$hooks" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: ruvllm-tools.ts or hooks-tools.ts missing"
    return
  fi

  # Both files should import / instantiate BoundedLRU rather than
  # `new Map()` at module scope for their cache slots.
  local ruvllm_uses=0
  local hooks_uses=0
  grep -q "BoundedLRU" "$ruvllm" && ruvllm_uses=1
  grep -q "BoundedLRU" "$hooks"  && hooks_uses=1

  if [[ "$ruvllm_uses" -eq 0 || "$hooks_uses" -eq 0 ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: BoundedLRU adoption: ruvllm=$ruvllm_uses hooks=$hooks_uses (expected both 1)"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ruvllm-tools + hooks-tools both adopt BoundedLRU (F-10-001 + F-10-005)"
}

check_adr0243_lint_no_unref_setinterval() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local lint="${_FORK_RUFLO}/v3/@claude-flow/cli/scripts/lint-no-unref-setinterval.mjs"
  if [[ ! -f "$lint" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: lint-no-unref-setinterval.mjs missing at cli/scripts/"
    return
  fi

  # cli + memory package.json both wire it as `npm run lint`.
  local cli_pkg="${_FORK_RUFLO}/v3/@claude-flow/cli/package.json"
  local mem_pkg="${_FORK_RUFLO}/v3/@claude-flow/memory/package.json"
  local cli_wired=0
  local mem_wired=0
  grep -q "lint-no-unref-setinterval" "$cli_pkg" 2>/dev/null && cli_wired=1
  grep -q "lint-no-unref-setinterval" "$mem_pkg" 2>/dev/null && mem_wired=1

  if [[ "$cli_wired" -eq 0 || "$mem_wired" -eq 0 ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: lint wiring: cli=$cli_wired memory=$mem_wired (expected both 1)"
    return
  fi

  # Run it against cli/src — exit 0 expected per coder report.
  local log
  log=$(mktemp /tmp/adr0243-lint-XXXXX.log)
  (cd "${_FORK_RUFLO}/v3/@claude-flow/cli" && timeout 60 npm run lint >"$log" 2>&1)
  local rc=$?

  if [[ $rc -ne 0 ]]; then
    local tail_out
    tail_out=$(tail -10 "$log" | tr '\n' ' ')
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="FAIL: cli npm run lint exit=$rc; tail: $tail_out"
    rm -f "$log"
    return
  fi

  rm -f "$log"
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="lint-no-unref-setinterval.mjs wired in both cli + memory; cli npm run lint passes"
}
