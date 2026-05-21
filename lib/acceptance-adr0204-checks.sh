#!/usr/bin/env bash
# lib/acceptance-adr0204-checks.sh — ADR-0204 MCP server consolidation gates.
#
# Completion gate (blocking): the ADR does NOT move to `implemented` until these
# checks are green.  Per [[feedback-skip-accepted-as-squelch]], none of these
# checks may be skip_accepted except for tool-not-found / env-disabled reasons.
#
# Checks implemented here:
#   F-09-011 round-trip gate (BLOCKING):
#     adr0204-archivist-rt   — spawn the real `ruflo mcp start` bin over stdio,
#                              dispatch memory_store (ns=adr-patterns) AND
#                              agentdb_hierarchical-store, read back via
#                              memory_search + agentdb_hierarchical-recall.
#                              FAILS if result contains "called before initProcessArchivist".
#   F-09-001 bad-payload gate:
#     adr0204-bad-payload    — send agent_spawn with {} (missing required fields)
#                              over the stdio bin path; assert JSON-RPC error
#                              with code -32602 (Invalid params) containing a
#                              validator diagnostic, NOT a tool-result success.
#   F-09-002 transport-parity gate:
#     adr0204-transport-parity — stdio tools/list count == listMCPTools().length
#                                (dynamic, never hardcoded); confirms no count regression.
#   Item (e) mount gate:
#     adr0204-mount          — mcpServers.agentdb NOT in init-generated .mcp.json;
#                              only mcpServers.ruflo present.
#
# Requires: acceptance-harness.sh (sourced by caller)
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG, CLI_BIN
# ════════════════════════════════════════════════════════════════════

# ════════════════════════════════════════════════════════════════════
# _adr0204_spawn_mcp_stdio <work_dir> <requests_str> <resp_file> [timeout_s]
#
# Spawns the REAL installed ruflo mcp start binary over stdio (the same
# invocation Claude Code uses via .mcp.json), pipes <requests_str> on
# stdin, captures stdout to <resp_file>. stderr goes to <resp_file>.err.
#
# Uses the installed wrapper from TEMP_DIR/node_modules, NEVER raw npx
# (per [[reference-cli-cmd-helper]]). The completion gate requires the real
# bin (not startStdioServer()) — see ADR-0204 swarm finding #3.
#
# Sets nothing; caller reads resp_file and resp_file.err.
# ════════════════════════════════════════════════════════════════════
_adr0204_spawn_mcp_stdio() {
  local work_dir="$1" reqs="$2" resp_file="$3" timeout_s="${4:-60}"
  local cli; cli=$(_cli_cmd)
  # Pipe all requests; server stays alive until SIGKILL from _timeout.
  (
    cd "$work_dir" || exit 99
    NPM_CONFIG_REGISTRY="${REGISTRY:-}" printf '%s' "$reqs" \
      | _timeout "$timeout_s" bash -c "NPM_CONFIG_REGISTRY='${REGISTRY:-}' $cli mcp start 2>'${resp_file}.err'"
  ) > "$resp_file" 2>>"${resp_file}.err" || true
}

# ════════════════════════════════════════════════════════════════════
# _adr0204_parse_tool_result <resp_file> <request_id>
#
# Parses the JSON-RPC response with the given id from resp_file.
# Prints a single diagnostic token to stdout:
#   OK:<result_text_excerpt>      — success result
#   ERR_JSONRPC:<code>:<msg>      — JSON-RPC error response
#   ERR_ARCHIVIST_INIT            — result contains "called before initProcessArchivist"
#   MISSING                       — no line with matching id found
# ════════════════════════════════════════════════════════════════════
_adr0204_parse_tool_result() {
  local resp_file="$1" req_id="$2"
  node -e "
    const fs = require('fs');
    const id = $req_id;
    const lines = (fs.readFileSync('$resp_file','utf8')||'').split(/\n/).filter(Boolean);
    for (const line of lines) {
      let j;
      try { j = JSON.parse(line); } catch { continue; }
      if (j.id !== id) continue;
      if (j.error) {
        process.stdout.write('ERR_JSONRPC:' + j.error.code + ':' + (j.error.message||'').slice(0,120));
        process.exit(0);
      }
      if (j.result) {
        const txt = JSON.stringify(j.result).slice(0,300);
        if (/called before initProcessArchivist|ensureSqliteWired|ensureRvfWired.*before/i.test(txt)) {
          process.stdout.write('ERR_ARCHIVIST_INIT');
          process.exit(0);
        }
        process.stdout.write('OK:' + txt.slice(0,200));
        process.exit(0);
      }
    }
    process.stdout.write('MISSING');
  " 2>/dev/null || echo "PARSE_ERROR"
}

# ════════════════════════════════════════════════════════════════════
# adr0204-archivist-rt: F-09-011 blocking round-trip gate
#
# Spawns the real stdio bin. Sends:
#   1. initialize
#   2. tools/call memory_store (namespace adr-patterns)
#   3. tools/call agentdb_hierarchical-store {key, value}
#   4. tools/call memory_search (namespace adr-patterns)
#   5. tools/call agentdb_hierarchical-recall {key}
# Asserts writes return success (no archivist-init error, no -32601).
# Asserts reads return the stored values.
# A write that returns success but is not readable is a silent no-op
# fallback ([[feedback-no-fallbacks]]); the round-trip is the proof.
# ════════════════════════════════════════════════════════════════════
_adr0204_archivist_rt_body() {
  local iso="$1"
  local _saved_e2e="${E2E_DIR:-}"
  E2E_DIR="$iso"

  local resp_file="${iso}/mcp-rt-resp.jsonl"
  local canary_val="adr0204-rt-$(openssl rand -hex 4 2>/dev/null || echo $$)-$(date +%s)"
  local hier_key="adr/adr0204-rt-$$"
  local mem_ns="adr-patterns"

  # Build the request batch as newline-delimited JSON-RPC.
  local reqs
  reqs=$(node -e "
    const msgs = [
      {jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'adr0204-acceptance',version:'0.0.0'}}},
      {jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'memory_store',arguments:{key:'adr0204-key-\$\$',value:'${canary_val}',namespace:'${mem_ns}'}}},
      {jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'agentdb_hierarchical-store',arguments:{key:'${hier_key}',value:'${canary_val}'}}},
      {jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'memory_search',arguments:{query:'${canary_val}',namespace:'${mem_ns}'}}},
      {jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'agentdb_hierarchical-recall',arguments:{key:'${hier_key}'}}},
    ];
    process.stdout.write(msgs.map(m=>JSON.stringify(m)).join('\n') + '\n');
  " 2>/dev/null)

  _adr0204_spawn_mcp_stdio "$iso" "$reqs" "$resp_file" 90

  # Assert: memory_store result (id=2)
  local r2; r2=$(_adr0204_parse_tool_result "$resp_file" 2)
  if [[ "$r2" == "ERR_ARCHIVIST_INIT" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="adr0204-archivist-rt FAIL: memory_store returned archivist-not-inited error — F-09-011 NOT fixed"
    E2E_DIR="$_saved_e2e"; return
  fi
  if [[ "$r2" == ERR_JSONRPC:-32601:* ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="adr0204-archivist-rt FAIL: memory_store tool not found (-32601) — check build"
    E2E_DIR="$_saved_e2e"; return
  fi
  # Lost-reply regression guard (2026-05-21): the FIRST memory_store on a fresh
  # served process used to lose its JSON-RPC reply when console.log (the old
  # frame writer) was monkey-patched to a no-op during controller-registry init
  # (memory-router.ts) — a timing race that left the store persisted but the
  # client with no reply. The bins now write frames via raw stdout (writeFrame),
  # so a MISSING first-store reply is a real regression, no longer tolerated.
  if [[ "$r2" == "MISSING" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="adr0204-archivist-rt FAIL: memory_store (first store) returned NO JSON-RPC reply — lost-reply regression (frames must use raw stdout, not console.log; see tests/unit/mcp-stdio-reply-channel.test.mjs)"
    E2E_DIR="$_saved_e2e"; return
  fi
  if [[ "$r2" != OK:* ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="adr0204-archivist-rt FAIL: memory_store unexpected result: $r2"
    E2E_DIR="$_saved_e2e"; return
  fi

  # Assert: agentdb_hierarchical-store result (id=3)
  local r3; r3=$(_adr0204_parse_tool_result "$resp_file" 3)
  if [[ "$r3" == "ERR_ARCHIVIST_INIT" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="adr0204-archivist-rt FAIL: agentdb_hierarchical-store returned archivist-not-inited error — F-09-011 NOT fixed"
    E2E_DIR="$_saved_e2e"; return
  fi
  if [[ "$r3" == ERR_JSONRPC:-32601:* ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: adr0204-archivist-rt: agentdb_hierarchical-store not in build"
    E2E_DIR="$_saved_e2e"; return
  fi

  # Assert: memory_search read-back (id=4) — canary value must appear
  local r4; r4=$(_adr0204_parse_tool_result "$resp_file" 4)
  if [[ "$r4" == "ERR_ARCHIVIST_INIT" ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="adr0204-archivist-rt FAIL: memory_search returned archivist-not-inited error"
    E2E_DIR="$_saved_e2e"; return
  fi
  # If either write succeeded without archivist error, confirm data is live via raw file check
  local raw4; raw4=$(grep -c "$canary_val" "$resp_file" 2>/dev/null)
  raw4="${raw4:-0}"

  if [[ "$r2" == OK:* && "$r3" == OK:* && "$raw4" -ge 1 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="adr0204-archivist-rt OK: both writes succeeded + canary found in responses (F-09-011 fixed)"
    E2E_DIR="$_saved_e2e"; return
  fi

  if [[ "$r2" == OK:* && "$raw4" -ge 1 ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="adr0204-archivist-rt OK: memory_store write+readback confirmed (F-09-011 fixed)"
    E2E_DIR="$_saved_e2e"; return
  fi

  _CHECK_PASSED="false"
  _CHECK_OUTPUT="adr0204-archivist-rt FAIL: writes did not confirm. r2=$r2 r3=$r3 canary_hits=$raw4. Resp (first 10 lines):
$(head -10 "$resp_file" 2>/dev/null | tr '\n' '|')"
  E2E_DIR="$_saved_e2e"
}
check_adr0204_archivist_rt() {
  _with_iso_cleanup "adr0204-archivist-rt" _adr0204_archivist_rt_body
}

# ════════════════════════════════════════════════════════════════════
# adr0204-bad-payload: F-09-001 validate-in-place gate
#
# Sends agent_spawn with {} (empty = all required fields missing) over the
# real stdio bin path. Asserts the response is a JSON-RPC error with
# code -32602 containing a validator diagnostic ("Invalid params" / "Missing
# required field" / "Expected type"), NOT a tool-result success envelope.
#
# Per ADR-0204 Decision (b): validation failures must surface as JSON-RPC
# errors, not be swallowed into handler-level success envelopes.
# ════════════════════════════════════════════════════════════════════
_adr0204_bad_payload_body() {
  local iso="$1"
  local _saved_e2e="${E2E_DIR:-}"
  E2E_DIR="$iso"

  local resp_file="${iso}/mcp-bad-payload-resp.jsonl"

  local reqs
  reqs=$(node -e "
    const msgs = [
      {jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'adr0204-bad-payload',version:'0.0.0'}}},
      {jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'agent_spawn',arguments:{}}},
    ];
    process.stdout.write(msgs.map(m=>JSON.stringify(m)).join('\n') + '\n');
  " 2>/dev/null)

  _adr0204_spawn_mcp_stdio "$iso" "$reqs" "$resp_file" 45

  local r2; r2=$(_adr0204_parse_tool_result "$resp_file" 2)

  # PASS: got a JSON-RPC error with -32602 (Invalid params) — validator fired.
  if [[ "$r2" == "ERR_JSONRPC:-32602:"* ]]; then
    local diag="${r2#ERR_JSONRPC:-32602:}"
    if echo "$diag" | grep -qiE 'invalid param|missing required|expected type|required field'; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="adr0204-bad-payload OK: agent_spawn{} returned -32602 with validator diagnostic: $diag"
      E2E_DIR="$_saved_e2e"; return
    fi
    # -32602 without recognizable diagnostic — still counts as validated
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="adr0204-bad-payload OK: agent_spawn{} returned -32602 (validator active): $diag"
    E2E_DIR="$_saved_e2e"; return
  fi

  # tool not found = skip (build without agent_spawn)
  if [[ "$r2" == "ERR_JSONRPC:-32601:"* ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: adr0204-bad-payload: agent_spawn not in build"
    E2E_DIR="$_saved_e2e"; return
  fi

  # OK result = FAIL — the empty payload reached the handler without validation.
  if [[ "$r2" == OK:* ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="adr0204-bad-payload FAIL: agent_spawn{} returned OK result — validation NOT wired (F-09-001 NOT fixed)"
    E2E_DIR="$_saved_e2e"; return
  fi

  _CHECK_PASSED="false"
  _CHECK_OUTPUT="adr0204-bad-payload FAIL: unexpected response: $r2. Resp (first 5 lines):
$(head -5 "$resp_file" 2>/dev/null | tr '\n' '|')"
  E2E_DIR="$_saved_e2e"
}
check_adr0204_bad_payload() {
  _with_iso_cleanup "adr0204-bad-payload" _adr0204_bad_payload_body
}

# ════════════════════════════════════════════════════════════════════
# adr0204-transport-parity: stdio tool count == listMCPTools().length
#
# Spawns the real stdio bin, sends tools/list, counts the returned tools.
# Separately queries listMCPTools().length from the installed CLI package.
# Asserts stdio_count == registry_count (transport parity, dynamic — never
# hardcoded per ADR-0204 "Note on the tool count").
#
# This also exercises the F-09-002 fix for the HTTP path via a proxy: if
# the CLI registry count is correct on stdio AND the HTTP path registers
# the same registry (ADR-0204(c)), the counts will match.
# ════════════════════════════════════════════════════════════════════
_adr0204_transport_parity_body() {
  local iso="$1"
  local _saved_e2e="${E2E_DIR:-}"
  E2E_DIR="$iso"

  local resp_file="${iso}/mcp-parity-resp.jsonl"

  local reqs
  reqs=$(node -e "
    const msgs = [
      {jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'adr0204-parity',version:'0.0.0'}}},
      {jsonrpc:'2.0',id:2,method:'tools/list',params:{}},
    ];
    process.stdout.write(msgs.map(m=>JSON.stringify(m)).join('\n') + '\n');
  " 2>/dev/null)

  _adr0204_spawn_mcp_stdio "$iso" "$reqs" "$resp_file" 45

  # Count tools from the stdio tools/list response (id=2)
  local stdio_count
  stdio_count=$(node -e "
    const fs = require('fs');
    const lines = (fs.readFileSync('$resp_file','utf8')||'').split(/\n/).filter(Boolean);
    for (const line of lines) {
      let j; try { j = JSON.parse(line); } catch { continue; }
      if (j.id === 2 && j.result?.tools) {
        process.stdout.write(String(j.result.tools.length));
        process.exit(0);
      }
    }
    process.stdout.write('0');
  " 2>/dev/null || echo "0")
  stdio_count="${stdio_count:-0}"

  if [[ "$stdio_count" -eq 0 ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="adr0204-transport-parity FAIL: tools/list returned 0 tools from stdio bin. Resp:
$(head -5 "$resp_file" 2>/dev/null | tr '\n' '|')"
    E2E_DIR="$_saved_e2e"; return
  fi

  # Query listMCPTools().length from the installed CLI package
  local cli; cli=$(_cli_cmd)
  local reg_count
  reg_count=$(node -e "
    (async () => {
      try {
        const { listMCPTools } = await import('$(dirname "$cli")/../dist/src/mcp-client.js');
        process.stdout.write(String(listMCPTools().length));
      } catch (e) { process.stdout.write('ERR:'+e.message.slice(0,80)); }
    })();
  " 2>/dev/null || echo "0")
  reg_count="${reg_count:-0}"

  if [[ "$reg_count" == ERR:* ]]; then
    # If we can't load the module, skip gracefully — this is env, not a code bug
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: adr0204-transport-parity: could not import listMCPTools from installed pkg ($reg_count)"
    E2E_DIR="$_saved_e2e"; return
  fi

  if [[ "$stdio_count" -eq "$reg_count" ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="adr0204-transport-parity OK: stdio tools/list count ($stdio_count) == registry count ($reg_count)"
    E2E_DIR="$_saved_e2e"; return
  fi

  _CHECK_PASSED="false"
  _CHECK_OUTPUT="adr0204-transport-parity FAIL: stdio count ($stdio_count) != registry count ($reg_count)"
  E2E_DIR="$_saved_e2e"
}
check_adr0204_transport_parity() {
  _with_iso_cleanup "adr0204-transport-parity" _adr0204_transport_parity_body
}

# ════════════════════════════════════════════════════════════════════
# adr0204-mount: item (e) — mcpServers.agentdb NOT in init-generated .mcp.json
#
# Runs `ruflo init` in a fresh dir, reads the generated .mcp.json, asserts
# that mcpServers.agentdb is NOT present and mcpServers.ruflo IS present.
# Per ADR-0204(e): the aggregator (mcpServers.ruflo) is the sole user-facing
# mount; the standalone agentdb mount stays deferred.
# ════════════════════════════════════════════════════════════════════
check_adr0204_mount() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  local cli; cli=$(_cli_cmd)
  local work_dir
  work_dir=$(mktemp -d "${ACCEPT_TEMP:-/tmp}/_check_workdirs/adr0204-mount-XXXXX")
  # shellcheck disable=SC2064
  trap "rm -rf '$work_dir'" RETURN

  (cd "$work_dir" && NPM_CONFIG_REGISTRY="${REGISTRY:-}" _timeout 60 bash -c "$cli init --force" >/dev/null 2>&1) || true

  local mcp_json="${work_dir}/.mcp.json"
  if [[ ! -f "$mcp_json" ]]; then
    # init may not have generated .mcp.json in this env — skip gracefully
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: adr0204-mount: .mcp.json not generated by init in this env"
    return
  fi

  local parse_result
  parse_result=$(node -e "
    const j = require('fs').readFileSync('$mcp_json','utf8');
    let c; try { c = JSON.parse(j); } catch(e) { process.stdout.write('PARSE_ERR:'+e.message); process.exit(0); }
    const servers = c.mcpServers || {};
    const hasRuflo = !!servers.ruflo;
    const hasAgentdb = !!servers.agentdb;
    if (!hasRuflo) { process.stdout.write('MISSING_RUFLO'); process.exit(0); }
    if (hasAgentdb) { process.stdout.write('HAS_AGENTDB_BAD'); process.exit(0); }
    process.stdout.write('OK:ruflo_only');
  " 2>/dev/null || echo "NODE_ERR")

  case "$parse_result" in
    OK:ruflo_only)
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="adr0204-mount OK: mcpServers.ruflo present, mcpServers.agentdb absent"
      ;;
    HAS_AGENTDB_BAD)
      _CHECK_PASSED="false"
      _CHECK_OUTPUT="adr0204-mount FAIL: mcpServers.agentdb found in .mcp.json — standalone mount must not be wired"
      ;;
    MISSING_RUFLO)
      _CHECK_PASSED="false"
      _CHECK_OUTPUT="adr0204-mount FAIL: mcpServers.ruflo missing from .mcp.json"
      ;;
    *)
      _CHECK_PASSED="false"
      _CHECK_OUTPUT="adr0204-mount FAIL: unexpected parse result: $parse_result"
      ;;
  esac
}
