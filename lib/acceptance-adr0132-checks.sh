#!/usr/bin/env bash
# lib/acceptance-adr0132-checks.sh — ADR-0132 (T14) Sub-queen failure
#                                    escalation acceptance checks
#
# Cover the three runtime surfaces ADR-0132 ships, asserted statically
# against fork source (NOT compiled dist — the runtime work lives in
# fork .ts files; codemod/copy-source has not run yet at the wave this
# fires). This matches ADR-0132 §Acceptance criteria:
#
#   1. Prompt-protocol extension at
#      forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts §6
#      WORKER FAILURE PROTOCOL block contains a SUB-QUEEN FAILURE
#      PROTOCOL extension (verbatim heading required — sentinel literal
#      per ADR-0131 contract pattern).
#
#   2. Handler at
#      forks/ruflo/v3/@claude-flow/swarm/src/queen-coordinator.ts
#      exports a `subQueenFailed(...)` method/function the top-level
#      queen invokes when sub-queen non-response is detected.
#
#   3. Integration test at
#      forks/ruflo/v3/@claude-flow/swarm/__tests__/sub-queen-failure.test.ts
#      exists with at least 3 `it(...)` / `test(...)` blocks (mocked I/O
#      + reassignment-logic round-trip per ADR-0132 §Acceptance criteria).
#
# Invocation choice — static greps only:
#
# Per `reference-cli-cmd-helper.md` and the cascading-pipeline rules
# (CLAUDE.md "Build & Test — TWO COMMANDS, NOTHING ELSE"), this file
# does NOT spawn fork CLI invocations or actually run the unit test. A
# 4th smoke check that runs `npm test` against the new test file would
# either (a) duplicate `npm run test:unit`'s coverage or (b) re-spawn
# `npx @sparkleideas/cli` mid-acceptance which serializes on npm cache
# lock (36× slower per memory). Runtime invocation is delegated to
# `npm run test:unit` via the existing cascade. Static-grep contracts
# here, behavioural contracts there.
#
# IMPORTANT: ADR-0132 §Decision Outcome defers the option (a)/(b)/(c)
# choice to implementation. Therefore this file does NOT assert a
# specific reassignment strategy (no "absorb"/"promote" sentinel
# substrings) — only that the named handler and prompt block exist.
# Once Option ships, a follow-up commit can add option-specific
# sentinel asserts (similar to how ADR-0131 sentinels grew once Option
# E landed).
#
# Conventions per CLAUDE.md memories:
#   - `_cli_cmd` helper if/when we invoke fork CLI (memory
#     reference-cli-cmd-helper) — NEVER raw `npx @sparkleideas/cli@latest`
#     (36× slower from npm cache lock). Not used here — static greps only.
#   - Capture full output to a per-check `.log` file (memories
#     feedback-no-tail-tests + feedback-full-test-output): NEVER
#     pipe-mid-stream; grep the log AFTER each step completes.
#   - `var=$(grep -c ...); var=${var:-0}` (memory
#     reference-grep-c-bash-trap): `grep -c pat || echo 0` produces
#     "0\n0" on no-match and trips bash arithmetic.
#   - Each assertion explicitly fails (memory feedback-no-fallbacks) —
#     no silent skips, no "warn and continue".
#
# Operates on:
#   - forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts
#   - forks/ruflo/v3/@claude-flow/swarm/src/queen-coordinator.ts
#   - forks/ruflo/v3/@claude-flow/swarm/__tests__/sub-queen-failure.test.ts

set +u 2>/dev/null || true

# ════════════════════════════════════════════════════════════════════
# Resolve fork dir from config/upstream-branches.json (matches the
# pattern used by ADR-0117's check). Falls back to the conventional
# /Users/henrik/source/forks/ruflo path if config lookup fails — but
# only after the config-resolved path is empty/unreadable, never as a
# silent retry. Used by all 3 checks below.
# ════════════════════════════════════════════════════════════════════
__ADR0132_FORK_DIR=""
_adr0132_resolve_fork() {
  if [[ -n "$__ADR0132_FORK_DIR" ]]; then return; fi
  __ADR0132_FORK_DIR=$(node -e "
    const c = JSON.parse(require('fs').readFileSync(
      require('path').resolve('${PROJECT_DIR:-.}', 'config', 'upstream-branches.json'), 'utf8'));
    process.stdout.write(c.ruflo?.dir || '');
  " 2>/dev/null)
  if [[ -z "$__ADR0132_FORK_DIR" || ! -d "$__ADR0132_FORK_DIR" ]]; then
    __ADR0132_FORK_DIR="/Users/henrik/source/forks/ruflo"
  fi
}

# ════════════════════════════════════════════════════════════════════
# Check 1: §Prompt-protocol extension — fork hive-mind.ts §6 WORKER
# FAILURE PROTOCOL block carries a SUB-QUEEN FAILURE PROTOCOL
# sub-heading (around lines 495-534 per ADR-0132 §Acceptance criteria).
#
# Per ADR-0131 §Specification convention: sentinel substrings are
# verbatim contracts; renaming "SUB-QUEEN FAILURE PROTOCOL" is a
# breaking change.
# ════════════════════════════════════════════════════════════════════
check_adr0132_subqueen_prompt_block_present() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  _adr0132_resolve_fork
  local fork="$__ADR0132_FORK_DIR"
  local hive_src="$fork/v3/@claude-flow/cli/src/commands/hive-mind.ts"
  local log="${TEST_DIR:-/tmp}/.adr0132-prompt-block.log"

  if [[ ! -f "$hive_src" ]]; then
    _CHECK_OUTPUT="ADR-0132-§prompt-block: fork source missing at $hive_src"
    return
  fi

  # Capture full grep output to log (no pipe-through-tail per
  # feedback-no-tail-tests).
  grep -n "SUB-QUEEN FAILURE PROTOCOL" "$hive_src" > "$log" 2>&1 || true

  local hits
  hits=$(grep -c "SUB-QUEEN FAILURE PROTOCOL" "$hive_src" 2>/dev/null)
  hits=${hits:-0}

  if [[ "$hits" -lt 1 ]]; then
    _CHECK_OUTPUT="ADR-0132-§prompt-block: SUB-QUEEN FAILURE PROTOCOL heading missing from $hive_src (expected ≥1 occurrence near §6 WORKER FAILURE PROTOCOL block, ADR-0132 §Acceptance criteria). log=$log"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0132-§prompt-block: SUB-QUEEN FAILURE PROTOCOL heading present in $hive_src (${hits} occurrence(s)); §6 WORKER FAILURE PROTOCOL block extended per ADR-0132."
}

# ════════════════════════════════════════════════════════════════════
# Check 2: §Handler — fork queen-coordinator.ts exports a
# `subQueenFailed(...)` method/function. The top-level queen invokes
# this when sub-queen non-response is detected (60s timeout per
# ADR-0131 sentinel reuse).
#
# Per ADR-0132 §Decision Outcome the option (a)/(b)/(c) reassignment
# strategy is deferred — this check only asserts the named handler is
# wired, not which strategy it implements. Strategy-specific sentinels
# can be added once Option ships.
# ════════════════════════════════════════════════════════════════════
check_adr0132_subqueen_failed_handler_exported() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  _adr0132_resolve_fork
  local fork="$__ADR0132_FORK_DIR"
  local handler_src="$fork/v3/@claude-flow/swarm/src/queen-coordinator.ts"
  local log="${TEST_DIR:-/tmp}/.adr0132-handler.log"

  if [[ ! -f "$handler_src" ]]; then
    _CHECK_OUTPUT="ADR-0132-§handler: fork source missing at $handler_src (per ADR-0132 §Risks 'Low — queen-coordinator.ts is currently orphaned in the swarm package'; wire-up is prerequisite per ADR-0111)"
    return
  fi

  grep -nE "subQueenFailed\s*\(" "$handler_src" > "$log" 2>&1 || true

  local hits
  hits=$(grep -cE "subQueenFailed\s*\(" "$handler_src" 2>/dev/null)
  hits=${hits:-0}

  if [[ "$hits" -lt 1 ]]; then
    _CHECK_OUTPUT="ADR-0132-§handler: subQueenFailed(...) method/function missing from $handler_src (expected ≥1 occurrence; ADR-0132 §Acceptance criteria). log=$log"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0132-§handler: subQueenFailed(...) handler exported from $handler_src (${hits} occurrence(s)); reassignment logic per ADR-0132 §Decision Outcome (option-choice deferred — no sentinel asserts on strategy)."
}

# ════════════════════════════════════════════════════════════════════
# Check 3: §Integration test — fork
# swarm/__tests__/sub-queen-failure.test.ts exists with ≥3
# `it(...)` / `test(...)` blocks per ADR-0132 §Acceptance criteria
# (integration test simulates sub-queen failure end-to-end + unit test
# asserts handler logic against mocked I/O).
#
# We do NOT execute the test here — npm run test:unit covers behavior;
# this just asserts the artifact exists with the documented shape.
# ════════════════════════════════════════════════════════════════════
check_adr0132_subqueen_failure_test_present() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  _adr0132_resolve_fork
  local fork="$__ADR0132_FORK_DIR"
  local test_src="$fork/v3/@claude-flow/swarm/__tests__/sub-queen-failure.test.ts"
  local log="${TEST_DIR:-/tmp}/.adr0132-test.log"

  if [[ ! -f "$test_src" ]]; then
    _CHECK_OUTPUT="ADR-0132-§test: integration test missing at $test_src (ADR-0132 §Acceptance criteria requires integration test simulating sub-queen failure end-to-end + unit test asserting handler logic)"
    return
  fi

  grep -nE "^\s*(it|test)\s*\(" "$test_src" > "$log" 2>&1 || true

  local hits
  hits=$(grep -cE "^\s*(it|test)\s*\(" "$test_src" 2>/dev/null)
  hits=${hits:-0}

  if [[ "$hits" -lt 3 ]]; then
    _CHECK_OUTPUT="ADR-0132-§test: $test_src has ${hits} it()/test() blocks; ADR-0132 §Acceptance criteria requires ≥3 (integration + unit + reassignment-logic round-trip). log=$log"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0132-§test: $test_src present with ${hits} it()/test() blocks (≥3 per ADR-0132 §Acceptance criteria; behavioural execution delegated to npm run test:unit)."
}
