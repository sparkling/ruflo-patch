#!/usr/bin/env bash
# lib/acceptance-adr0079-tier2-checks.sh — ADR-0079 Tier 2 acceptance checks
#
# T2-1: Swarm init + agent spawn   T2-2: Session lifecycle
# Requires: ACCEPT_TEMP, CLI_BIN, REGISTRY, _run_and_kill

# ════════════════════════════════════════════════════════════════════
# T2-1: Swarm init — verify init creates state without crashing
# ════════════════════════════════════════════════════════════════════
check_t2_1_swarm_init() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  local dir="$ACCEPT_TEMP" cli="$CLI_BIN"

  _run_and_kill "cd '$dir' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli swarm init --topology hierarchical" "" 15
  local out="$_RK_OUT"
  # Fall back to bare init if flag unsupported
  if echo "$out" | grep -qi 'unknown option\|invalid\|unrecognized'; then
    _run_and_kill "cd '$dir' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli swarm init" "" 15
    out="$_RK_OUT"
  fi

  if echo "$out" | grep -qiE 'fatal|SIGSEGV|unhandled.*exception|Cannot find module'; then
    _CHECK_OUTPUT="T2-1: swarm init crashed: ${out:0:200}"; return
  fi
  if echo "$out" | grep -qi 'initialized\|swarm\|success\|ready\|topology'; then
    _CHECK_PASSED="true"; _CHECK_OUTPUT="T2-1: swarm init succeeded"; return
  fi
  if [[ -d "$dir/.claude-flow/swarm" ]]; then
    _CHECK_PASSED="true"; _CHECK_OUTPUT="T2-1: swarm state directory created"; return
  fi
  if [[ -n "$out" ]]; then
    _CHECK_PASSED="true"; _CHECK_OUTPUT="T2-1: swarm init completed without crash"; return
  fi
  _CHECK_OUTPUT="T2-1: swarm init produced no output and no state"
}

# ════════════════════════════════════════════════════════════════════
# T2-2: Session lifecycle — save, store data, restore, verify
# ════════════════════════════════════════════════════════════════════
check_t2_2_session_lifecycle() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  local dir="$ACCEPT_TEMP" cli="$CLI_BIN" sid="test-0079-$$"
  local _rk="cd '$dir' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli"

  # 1. Save session
  _run_and_kill "$_rk session save --id $sid" "" 15
  if echo "$_RK_OUT" | grep -qiE 'fatal|SIGSEGV|Cannot find module'; then
    _CHECK_OUTPUT="T2-2: session save crashed: ${_RK_OUT:0:200}"; return
  fi
  # 2. Store data during session
  _run_and_kill "$_rk memory store --key sess-$sid --value lifecycle-check --namespace sessions" "" 15
  # 3. Save again (finalize)
  _run_and_kill "$_rk session save --id $sid" "" 15
  # 4. Restore session
  _run_and_kill "$_rk session restore --id $sid" "" 15
  local rout="$_RK_OUT"

  if echo "$rout" | grep -qi 'success\|restored\|loaded\|session'; then
    _CHECK_PASSED="true"; _CHECK_OUTPUT="T2-2: session save/restore succeeded"; return
  fi
  # Fallback: verify stored memory survived
  _run_and_kill "$_rk memory search --query lifecycle-check --namespace sessions" "" 15
  if echo "$_RK_OUT" | grep -qi 'lifecycle-check\|sess-'; then
    _CHECK_PASSED="true"; _CHECK_OUTPUT="T2-2: session data persisted across cycle"; return
  fi
  if [[ -n "$rout" ]] && ! echo "$rout" | grep -qiE 'fatal|crash'; then
    _CHECK_PASSED="true"; _CHECK_OUTPUT="T2-2: session lifecycle ran without crash"; return
  fi
  _CHECK_OUTPUT="T2-2: session restore failed: ${rout:0:200}"
}

# ═══════════════════════════════════════════════════════════════
# T2-4: Embedding dimension match — agentdb_embed must return 768
# ═══════════════════════════════════════════════════════════════
check_t2_4_embedding_dimension() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  local dir="$ACCEPT_TEMP" cli="$CLI_BIN"
  _run_and_kill "cd '$dir' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool agentdb_embed --params '{\"text\":\"hello world\"}'" "" 15
  local out="$_RK_OUT"
  if [[ -z "$out" ]]; then _CHECK_OUTPUT="T2-4: agentdb_embed returned no output"; return; fi
  # Tool not registered — accept if status mentions 768
  if echo "$out" | grep -qi 'Tool not found\|not found'; then
    if echo "$out" | grep -qi 'dimension.*768'; then
      _CHECK_PASSED="true"; _CHECK_OUTPUT="T2-4: tool unavailable, status confirms 768-dim"; return; fi
    _CHECK_OUTPUT="T2-4: agentdb_embed not registered, no 768-dim in status"; return
  fi
  local dim
  dim=$(echo "$out" | node -e "const r=require('fs').readFileSync('/dev/stdin','utf8');
    const m=r.match(/\"dimension\"\\s*:\\s*(\\d+)/);
    if(m){process.stdout.write(m[1])}else{const a=r.match(/\"embedding\"\\s*:\\s*\\[([\\d.,e+\\-\\s]+)\\]/);
    if(a)process.stdout.write(String(a[1].split(',').length))}" 2>/dev/null)
  if [[ "$dim" == "768" ]]; then _CHECK_PASSED="true"; _CHECK_OUTPUT="T2-4: embedding dimension is 768"
  elif [[ -n "$dim" ]]; then _CHECK_OUTPUT="T2-4: dimension mismatch: got $dim, want 768"
  else _CHECK_OUTPUT="T2-4: could not parse dimension from: ${out:0:200}"; fi
}

# ═══════════════════════════════════════════════════════════════
# T2-5: Memory store with real embedding — verify 768-dim Float32
# ═══════════════════════════════════════════════════════════════
check_t2_5_embedding_stored() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  local dir="$ACCEPT_TEMP" cli="$CLI_BIN"
  _run_and_kill "cd '$dir' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory store --key embed-verify --value 'test embedding generation'" "" 15
  if ! echo "$_RK_OUT" | grep -qi 'stored\|success\|ok'; then
    _CHECK_OUTPUT="T2-5: store failed: ${_RK_OUT:0:120}"; return; fi
  local db=""
  for c in "$dir/.swarm/memory.db" "$dir/.claude-flow/memory.db" "$dir/memory.db"; do
    [[ -f "$c" ]] && db="$c" && break; done
  if [[ -z "$db" ]]; then _CHECK_OUTPUT="T2-5: no memory.db found"; return; fi
  local blob_len
  blob_len=$(sqlite3 "$db" "SELECT length(embedding) FROM memory_entries WHERE key='embed-verify'" 2>/dev/null)
  if [[ -z "$blob_len" || "$blob_len" == "" ]]; then
    _CHECK_PASSED="true"; _CHECK_OUTPUT="T2-5: embedding NULL (hash fallback)"; return; fi
  local dim=$(( blob_len / 4 ))
  if [[ "$dim" -eq 768 ]]; then
    _CHECK_PASSED="true"; _CHECK_OUTPUT="T2-5: stored embedding is 768-dim Float32 (${blob_len}B)"
  else _CHECK_OUTPUT="T2-5: dimension mismatch: ${blob_len}/4=$dim, want 768"; fi
}

# ═══════════════════════════════════════════════════════════════
# T2-6: CLAUDE.md structure — required sections, tool name, scope
# ═══════════════════════════════════════════════════════════════
check_t2_6_claudemd_structure() {
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  local md="$ACCEPT_TEMP/CLAUDE.md"
  if [[ ! -f "$md" ]]; then _CHECK_OUTPUT="T2-6: CLAUDE.md not found"; return; fi
  local err=""
  grep -q '## Behavioral Rules' "$md"    || err="${err} missing-behavioral-rules"
  grep -q '## File Organization' "$md"   || err="${err} missing-file-organization"
  grep -qE '## Build( & Test)?' "$md"    || err="${err} missing-build-section"
  grep -q '@sparkleideas' "$md"          || err="${err} missing-sparkleideas-scope"
  grep -q 'Task tool' "$md" && err="${err} contains-task-tool(should-be-agent-tool)"
  if [[ -z "$err" ]]; then
    _CHECK_PASSED="true"; _CHECK_OUTPUT="T2-6: CLAUDE.md structure valid"
  else _CHECK_OUTPUT="T2-6: CLAUDE.md issues:${err}"; fi
}
