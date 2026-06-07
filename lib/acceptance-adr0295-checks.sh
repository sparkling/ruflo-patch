#!/usr/bin/env bash
# lib/acceptance-adr0295-checks.sh — ADR-0295 C3 Orchestration & Agents
# re-convergence fixes (stale agent_execute MODEL_MAP, task-completed surface
# rewire, wasm prompt no-key NOTE + envelope shape).
#
# Runs scripts/smoke-adr0295-c3-reconvergence.mjs against the shared ACCEPT_TEMP
# install. Drives ONE long-lived MCP stdio JSON-RPC session and asserts (NO paid
# LLM calls — every assertion is resolver-level or no-key-path):
#   R1 agent_execute MODEL_MAP ported to current Claude 4.x ids — spawn →
#      agent_execute (haiku + sonnet tiers) resolves a CURRENT-allowlist id
#      (claude-haiku-4-5-20251001 / claude-sonnet-4-6) and NOT a deprecated
#      claude-3-5-* id; with no provider key the envelope is the honest "No LLM
#      provider configured" message, never a deprecated-id 400. The stale map
#      (un-merged paired half of upstream #2042, M-C1) 400'd every logical-name
#      call; the coupled wasm_agent_prompt LLM path shares resolveAnthropicModel.
#   R2 hooks_task-completed surface — the thin alias over the fork trajectory
#      pipeline is REGISTERED (tools/list, not -32601) and returns real
#      training evidence (patternsLearned>=1 + learningPath:'trajectory-pipeline',
#      content not counter). The SONA half LOUD-SKIPs without a real embedder;
#      the trajectory-step graph_edges write LOUD-SKIPs if the AgentDB controller
#      registry is unavailable (the real trajectory-* tools share that throw) —
#      never a silent pass.
#   W1 wasm_agent_prompt no-key NOTE — the MCP-path response carries the
#      [NOTE: set ANTHROPIC_API_KEY…] hint the CLI path already appended.
#   W2 wasm envelope shape — content[0].text is a JSON STRING, not an object
#      (the live rvagent-wasm echo returns {response:…}; normalized at the
#      promptWasmAgent boundary, which heals W1 + the latent LLM-fallback too).
# FAILs against the published cli (patch.415 era — agent_execute resolves
# claude-3-5-*; hooks_task-completed absent; wasm prompt bare-echo object),
# PASSes after the ADR-0295 fixes ship. Reuses ACCEPT_TEMP via
# ADR0255_SMOKE_SHARED_TEMP.

if ! declare -f _ns >/dev/null 2>&1; then
  _ns() { date +%s%N 2>/dev/null || echo $(( $(date +%s) * 1000000000 )); }
fi
if ! declare -f _elapsed_ms >/dev/null 2>&1; then
  _elapsed_ms() { echo $(( ( ${2:-0} - ${1:-0} ) / 1000000 )); }
fi

check_adr0295_c3_reconvergence() {
  local start_ns end_ns log_path rc
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  log_path=$(mktemp -t "adr0295-c3-reconvergence-XXXXXX.log")

  if [[ ! -f "${PROJECT_DIR}/scripts/smoke-adr0295-c3-reconvergence.mjs" ]]; then
    _CHECK_OUTPUT="missing: scripts/smoke-adr0295-c3-reconvergence.mjs"
    end_ns=$(_ns); _EXIT=2; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  node "${PROJECT_DIR}/scripts/smoke-adr0295-c3-reconvergence.mjs" > "${log_path}" 2>&1
  rc=$?

  end_ns=$(_ns)
  _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns")
  _EXIT=$rc
  _OUT="exit=${rc} log=${log_path} (tail -40: $(tail -40 "${log_path}" 2>/dev/null | tr '\n' ' ' | head -c 400))"
  _CHECK_OUTPUT="$_OUT"

  if [[ $rc -eq 0 ]]; then
    _CHECK_PASSED="true"
  fi
}
