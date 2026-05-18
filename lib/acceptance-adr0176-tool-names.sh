#!/usr/bin/env bash
# lib/acceptance-adr0176-tool-names.sh — ADR-0176 Phase 5.
#
# Asserts the 4 dash-form agentdb_* tool names declared in the `ruflo-adr`
# plugin's skill manifests are present in the MCP tool registry at boot.
# Per ADR-0176 §Confirmation Phase 5: prevents future underscore-vs-dash
# drift from re-occurring undetected.
#
# The 4 names (canonical per ADR-0176 §Context lines 19-22):
#   - agentdb_hierarchical-store
#   - agentdb_hierarchical-query
#   - agentdb_causal-edge
#   - agentdb_causal-query
#
# Method: spawn the fork CLI MCP server (via _cli_cmd), JSON-RPC
# `initialize` + `tools/list` on stdin, parse the response, assert each
# of the 4 names is present. Per-name diagnostic on miss (memory
# feedback-no-fallbacks).
#
# Mirrors the registry-inspection pattern in
# lib/acceptance-adr0117-marketplace-mcp.sh::check_adr0117_mcp_tool_resolution
# (AC #4), narrowed to the 4 ADR-0176 names.
#
# Caller MUST set: REGISTRY, PKG, TEMP_DIR
# Caller MAY set:  ACCEPT_TEMP, PROJECT_DIR

# Portable timeout shim: prefers harness-provided _timeout (KILL signal),
# falls back to `timeout`/`gtimeout` so this check can run under the fast
# runner (scripts/test-acceptance-fast.sh) which does not source the full
# acceptance-harness helper set.
_adr0176_timeout() {
  if declare -f _timeout >/dev/null 2>&1; then
    _timeout "$@"
  elif command -v timeout >/dev/null 2>&1; then
    timeout --signal=KILL "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout --signal=KILL "$@"
  else
    # No timeout available — best-effort run without it. The check fails
    # loudly downstream if the MCP server hangs without producing output.
    shift
    "$@"
  fi
}

# Emit the harness-expected reporting vars only if the helpers exist.
# `run_check_bg` in scripts/test-acceptance.sh reads _OUT/_EXIT/_DURATION_MS;
# the fast runner (_fast_run) reads only _CHECK_PASSED/_CHECK_OUTPUT.
_adr0176_finalize() {
  _OUT="$_CHECK_OUTPUT"
  _EXIT=0
  if declare -f _ns >/dev/null 2>&1 && declare -f _elapsed_ms >/dev/null 2>&1; then
    _DURATION_MS=$(_elapsed_ms "${_adr0176_t0:-0}" "$(_ns)")
  else
    _DURATION_MS=0
  fi
}

check_adr0176_tool_names() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  if declare -f _ns >/dev/null 2>&1; then
    _adr0176_t0=$(_ns)
  else
    _adr0176_t0=0
  fi

  local test_dir="${ACCEPT_TEMP:-/tmp}/_check_workdirs/ruflo-adr0176-tool-names"
  local log="${test_dir}/.log"
  local resp_file="${test_dir}/tools-list.json"
  rm -rf "$test_dir"
  mkdir -p "$test_dir"

  local cli; cli=$(_cli_cmd)

  # JSON-RPC: initialize handshake first (protocol-correct), then tools/list.
  local reqs
  reqs=$'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"adr0176-acceptance","version":"0.0.0"}}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}\n'

  # The stdio MCP server hangs after responses waiting for more input;
  # KILL it after we have the response. 30s budget covers cold-start of
  # better-sqlite3 native compile in a fresh node_modules.
  (
    cd "$test_dir" || exit 99
    printf '%s' "$reqs" | _adr0176_timeout 30 bash -c "$cli mcp start 2>/dev/null"
  ) > "$resp_file" 2>>"$log" || true

  if [[ ! -s "$resp_file" ]]; then
    _CHECK_OUTPUT="ADR-0176 Phase 5 failed: empty tools/list response from '${cli} mcp start' (log: ${log})"
    _adr0176_finalize; return
  fi

  # Parse registered tool names from the JSON-RPC response stream.
  local registered
  registered=$(node -e "
    const fs = require('fs');
    const lines = fs.readFileSync('$resp_file','utf8').split(/\n/).filter(Boolean);
    const names = new Set();
    for (const line of lines) {
      try {
        const j = JSON.parse(line);
        const tools = j.result?.tools || [];
        for (const t of tools) if (t.name) names.add(t.name);
      } catch (e) { /* tolerate non-JSON banner lines */ }
    }
    process.stdout.write(Array.from(names).sort().join('\n'));
  " 2>>"$log")

  if [[ -z "$registered" ]]; then
    _CHECK_OUTPUT="ADR-0176 Phase 5 failed: zero tool names extracted from tools/list response (resp: ${resp_file}, log: ${log})"
    _adr0176_finalize; return
  fi

  # Assert each of the 4 ADR-0176-declared dash-form names is present.
  # Per memory feedback-no-fallbacks: per-name diagnostic on miss, no
  # silent "tool not found, but other tools were registered so pass".
  local required=(
    "agentdb_hierarchical-store"
    "agentdb_hierarchical-query"
    "agentdb_causal-edge"
    "agentdb_causal-query"
  )
  local missing=()
  local t
  for t in "${required[@]}"; do
    if ! echo "$registered" | grep -qx "$t"; then
      missing+=("$t")
    fi
  done

  if (( ${#missing[@]} > 0 )); then
    local total_registered
    total_registered=$(echo "$registered" | wc -l | tr -d ' ')
    _CHECK_OUTPUT="ADR-0176 Phase 5 failed: ${#missing[@]} of 4 declared dash-form agentdb_* tool names missing from MCP registry: [${missing[*]}] (${total_registered} tools registered total; resp: ${resp_file})"
    _adr0176_finalize; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0176 Phase 5 PASS: all 4 dash-form agentdb_* tool names registered in MCP registry (hierarchical-store, hierarchical-query, causal-edge, causal-query)"
  _adr0176_finalize
}
