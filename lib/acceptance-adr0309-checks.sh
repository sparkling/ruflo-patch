#!/usr/bin/env bash
# lib/acceptance-adr0309-checks.sh — ADR-0309 federation Phase-2 acceptance.
#
# ADR-0309 T1′/T2′: port the upstream ADR-109 inbound-dispatcher into the
# fork's plugin-agent-federation (the fork patch.197 lineage lacked it;
# upstream @alpha.16 ships+wires it) AND add the net-new T2′ local-memory
# responder (no upstream artifact). The responder answers an inbound
# `memory-query` from THIS node's memory, trust-gated on the
# `query-redacted` capability (UNTRUSTED/VERIFIED refused + audited),
# PII-gated at the peer's trust level, with a signed `memory-response`
# sent back over the same transport.
#
# ONE check (`adr0309-fed-memory-roundtrip`) enforces the ADR's single
# acceptance criterion (Decision Outcome §Confirmation): the two-node
# `memory-query` round-trip is green AND an untrusted query is refused +
# audited. It asserts three things in one pass:
#
#   (a) Source present  — all four ported/net-new files exist in the fork:
#         src/application/inbound-dispatcher.ts   (T1′ port)
#         src/application/memory-responder.ts     (T2′ net-new)
#         __tests__/unit/inbound-dispatcher.test.ts
#         __tests__/unit/memory-responder.test.ts
#   (b) Wiring present  — plugin.ts binds `transport.onMessage(...)` ->
#         `dispatchInbound(...)` (the T1′ dispatcher wiring) AND subscribes
#         `federation:inbound:memory-query` -> `handleInboundMemoryQuery`
#         (the T2′ responder wiring). The dispatcher's `AgentMessage` type
#         is imported through the fork's transport re-export
#         (`../transport/agentic-flow-loader.js`) — the recorded adaptation
#         for agentic-flow's optional-dep posture (ADR-0297 R2).
#   (c) Behaviour green — the 2 fork vitest suites run 26/26 pass
#         (17 dispatcher + 9 responder), AND the two ADR DoD test cases are
#         present by name: DoD #1 "two-node round-trip" (TRUSTED served +
#         signed reply) and DoD #2 "untrusted refused + audited"
#         (UNTRUSTED REFUSED, refusal AUDITED, no response sent).
#
# Wired into the existing `adr0265` group (federation transport) of
# scripts/test-acceptance.sh — same bounded context, same fork plugin.
# v3-ci-quic.yml already triggers on the plugin path
# (forks/ruflo/v3/@claude-flow/plugin-agent-federation/**), so this rides
# the existing CI stanza — no workflow edit needed.
#
# Per `feedback-no-tail-tests` + `feedback-full-test-output`: the vitest
# log is teed to disk in full and grepped AFTER the run; tail is used only
# for the failure breadcrumb in _CHECK_OUTPUT, never as the pass oracle.

_FORK_RUFLO="${_FORK_RUFLO:-/Users/henrik/source/forks/ruflo}"

# The plugin has its own vitest.config.ts whose `include` globs are
# relative (`__tests__/**/*.test.ts`); we therefore run vitest from INSIDE
# the plugin dir. The plugin dir has no local vitest binary — the fork
# root hoists it — so we invoke the fork-root binary explicitly.
_ADR0309_PLUGIN_DIR="${_FORK_RUFLO}/v3/@claude-flow/plugin-agent-federation"
_ADR0309_VITEST_BIN="${_FORK_RUFLO}/node_modules/.bin/vitest"

check_adr0309_fed_memory_roundtrip() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local plugin_dir="$_ADR0309_PLUGIN_DIR"
  local dispatcher_src="${plugin_dir}/src/application/inbound-dispatcher.ts"
  local responder_src="${plugin_dir}/src/application/memory-responder.ts"
  local dispatcher_test="${plugin_dir}/__tests__/unit/inbound-dispatcher.test.ts"
  local responder_test="${plugin_dir}/__tests__/unit/memory-responder.test.ts"
  local plugin_ts="${plugin_dir}/src/plugin.ts"

  # ── (a) Source present ──────────────────────────────────────────────
  local f
  for f in "$dispatcher_src" "$responder_src" "$dispatcher_test" "$responder_test" "$plugin_ts"; do
    if [[ ! -f "$f" ]]; then
      _CHECK_OUTPUT="FAIL: missing required file: ${f#${_FORK_RUFLO}/}"
      return
    fi
  done

  # Dispatcher adaptation: AgentMessage routed through the fork's transport
  # re-export, NOT the bare `agentic-flow/transport/loader` specifier.
  if ! grep -qE "import type \{[^}]*AgentMessage[^}]*\} from '\.\./transport/agentic-flow-loader\.js'" "$dispatcher_src"; then
    _CHECK_OUTPUT="FAIL: inbound-dispatcher.ts does not import AgentMessage from ../transport/agentic-flow-loader.js (ADR-0309 adaptation #1 regressed)"
    return
  fi

  # Responder trust gate constant — must be the `query-redacted` capability.
  if ! grep -qE "MEMORY_QUERY_CAPABILITY[[:space:]]*=[[:space:]]*'query-redacted'" "$responder_src"; then
    _CHECK_OUTPUT="FAIL: memory-responder.ts missing MEMORY_QUERY_CAPABILITY = 'query-redacted' trust gate"
    return
  fi

  # ── (b) Wiring present (plugin.ts) ──────────────────────────────────
  # T1′: transport.onMessage(...) -> dispatchInbound(...)
  if ! grep -qE "from '\./application/inbound-dispatcher\.js'" "$plugin_ts"; then
    _CHECK_OUTPUT="FAIL: plugin.ts does not import from ./application/inbound-dispatcher.js (T1′ dispatcher not wired)"
    return
  fi
  if ! grep -qE "transport\.onMessage\(" "$plugin_ts"; then
    _CHECK_OUTPUT="FAIL: plugin.ts does not call transport.onMessage(...) (T1′ inbound dispatch not bound)"
    return
  fi
  if ! grep -qE "dispatchInbound\(" "$plugin_ts"; then
    _CHECK_OUTPUT="FAIL: plugin.ts onMessage handler does not invoke dispatchInbound(...) (T1′ dispatch loop missing)"
    return
  fi

  # T2′: federation:inbound:memory-query subscriber -> handleInboundMemoryQuery
  if ! grep -qE "from '\./application/memory-responder\.js'" "$plugin_ts"; then
    _CHECK_OUTPUT="FAIL: plugin.ts does not import from ./application/memory-responder.js (T2′ responder not wired)"
    return
  fi
  if ! grep -qE "eventBus\.on\('federation:inbound:memory-query'" "$plugin_ts"; then
    _CHECK_OUTPUT="FAIL: plugin.ts does not subscribe federation:inbound:memory-query (T2′ responder not subscribed)"
    return
  fi
  if ! grep -qE "handleInboundMemoryQuery\(" "$plugin_ts"; then
    _CHECK_OUTPUT="FAIL: plugin.ts memory-query subscriber does not invoke handleInboundMemoryQuery(...) (T2′ responder not invoked)"
    return
  fi

  # ── (c) Behaviour: the two ADR DoD test cases are present by name ────
  # DoD #1 — two-node round-trip (TRUSTED served + signed reply).
  if ! grep -qE "two-node round-trip" "$responder_test"; then
    _CHECK_OUTPUT="FAIL: memory-responder.test.ts missing the 'two-node round-trip' DoD #1 case"
    return
  fi
  # DoD #2 — untrusted refused + audited.
  if ! grep -qiE "UNTRUSTED peer is REFUSED.*AUDITED|untrusted refused \+ audited" "$responder_test"; then
    _CHECK_OUTPUT="FAIL: memory-responder.test.ts missing the 'untrusted refused + audited' DoD #2 case"
    return
  fi

  # ── (c) Behaviour: run the 2 suites — expect 26/26 (17 + 9) ─────────
  if [[ ! -x "$_ADR0309_VITEST_BIN" ]]; then
    _CHECK_OUTPUT="FAIL: vitest binary not found/executable at ${_ADR0309_VITEST_BIN} (run npm install in the fork)"
    return
  fi

  local log
  log=$(mktemp -t "adr0309-vitest-XXXXXX.log")
  (
    cd "$plugin_dir" && \
    timeout 180 "$_ADR0309_VITEST_BIN" run \
      __tests__/unit/inbound-dispatcher.test.ts \
      __tests__/unit/memory-responder.test.ts \
      > "$log" 2>&1
  )
  local rc=$?

  if [[ $rc -ne 0 ]]; then
    local tail_out
    tail_out=$(tail -15 "$log" 2>/dev/null | tr '\n' ' ' | head -c 500)
    _CHECK_OUTPUT="FAIL: adr0309 vitest exit=$rc (log=$log) tail: $tail_out"
    return
  fi

  # 17 dispatcher + 9 responder = 26 tests across 2 files.
  if ! grep -qE "Test Files +2 passed \(2\)" "$log"; then
    local summary
    summary=$(grep -E "Test Files|Tests " "$log" 2>/dev/null | tr '\n' ' ')
    _CHECK_OUTPUT="FAIL: adr0309 vitest did not report 2 passed test files: $summary (log=$log)"
    return
  fi
  if ! grep -qE "Tests +26 passed \(26\)" "$log"; then
    local summary
    summary=$(grep -E "Test Files|Tests " "$log" 2>/dev/null | tr '\n' ' ')
    _CHECK_OUTPUT="FAIL: adr0309 vitest passed but count != 26/26: $summary (log=$log)"
    return
  fi

  rm -f "$log"
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0309 federation Phase-2 OK: dispatcher+responder ported & wired (plugin.ts onMessage->dispatchInbound, federation:inbound:memory-query->handleInboundMemoryQuery); 2 suites 26/26 (17 dispatcher + 9 responder); DoD #1 two-node round-trip + DoD #2 untrusted-refused-and-audited present"
}
