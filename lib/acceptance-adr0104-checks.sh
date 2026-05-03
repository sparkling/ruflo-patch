#!/usr/bin/env bash
# lib/acceptance-adr0104-checks.sh — ADR-0104 acceptance checks
#
# Hive-mind Queen orchestration:
#   §1  parser hoists --non-interactive to global boolean flags
#   §2  --claude with no objective fails loudly (already in fork)
#   §3  "Registered worker slot(s)" wording (already in fork)
#   §4a init .mcp.json uses direct claude-flow path (or npx fallback)
#   §5  hive-mind_memory writes are race-safe under contention
#   §6  generated Queen prompt reverts #1422 block, adds v3 worker contract
#
# Requires: _cli_cmd, _run_and_kill, _e2e_isolate from acceptance-harness.sh
# Caller MUST set: REGISTRY, TEMP_DIR (or E2E_DIR)

set +u 2>/dev/null || true

# Helper: initialize hive in an iso dir. The `_e2e_isolate` snapshot copies
# .claude-flow / .swarm but not hive-mind state, so every check that exercises
# `hive-mind spawn` must hive-init first or hit "Hive-mind not initialized".
#
# `.ruflo-project` sentinel pins findProjectRoot (ADR-0100) to the iso dir.
# Without it, findProjectRoot walks up to the iso's parent ($E2E_DIR) which
# has CLAUDE.md + .claude/ markers — and the CLI writes hive state to the
# wrong path. Symptom: state.json exists in iso (stale copy) but the writes
# land in $E2E_DIR/.claude-flow/hive-mind/state.json.
_adr0104_hive_init() {
  local iso="$1"
  local cli; cli=$(_cli_cmd)
  : > "$iso/.ruflo-project"
  (cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 30 $cli hive-mind init >/dev/null 2>&1) || return 1
  return 0
}

# ════════════════════════════════════════════════════════════════════
# Scenario 1 (§4a): .mcp.json uses direct path when ruflo is in PATH;
#                   falls back to npx -y when not.
#                   (Key flipped from `claude-flow` to `ruflo` per ADR-0117 R1.)
# ════════════════════════════════════════════════════════════════════
check_adr0104_mcp_direct_path() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  if [[ -z "$CLI_BIN" ]]; then
    _CHECK_OUTPUT="ADR-0104-§4a: CLI_BIN not set"
    return
  fi

  local iso; iso=$(mktemp -d /tmp/ruflo-adr0104-mcp-XXXXX)
  if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR/node_modules" ]]; then
    ln -sf "$TEMP_DIR/node_modules" "$iso/node_modules"
  fi

  # Path A: ruflo IS available (CLI_BIN itself qualifies). Init expects
  # the resolved path, not the npx invocation.
  # (Key flipped from `claude-flow` to `ruflo` per ADR-0117 R1.)
  local cf_path; cf_path=$(command -v ruflo 2>/dev/null || true)
  (cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 60 "$CLI_BIN" init --full --quiet >/dev/null 2>&1) || true

  if [[ ! -f "$iso/.mcp.json" ]]; then
    _CHECK_OUTPUT="ADR-0104-§4a: .mcp.json not generated"
    rm -rf "$iso" 2>/dev/null; return
  fi

  local cf_cmd
  cf_cmd=$(python3 -c "import json,sys; d=json.load(open('$iso/.mcp.json')); print((d.get('mcpServers',{}).get('ruflo',{}) or {}).get('command',''))" 2>/dev/null)

  if [[ -n "$cf_path" ]]; then
    # Direct path expected. Either matches `which ruflo`, or at least is
    # NOT `npx` (covers the case where the resolved path differs but is still a
    # direct binary).
    if [[ "$cf_cmd" == "npx" ]]; then
      _CHECK_OUTPUT="ADR-0104-§4a: ruflo in PATH ($cf_path) but .mcp.json command='npx' — direct-path detection failed"
      rm -rf "$iso" 2>/dev/null; return
    fi
    if [[ -z "$cf_cmd" ]]; then
      _CHECK_OUTPUT="ADR-0104-§4a: .mcp.json missing ruflo.command"
      rm -rf "$iso" 2>/dev/null; return
    fi
  else
    # npx fallback expected when not on PATH.
    if [[ "$cf_cmd" != "npx" ]]; then
      _CHECK_OUTPUT="ADR-0104-§4a: ruflo NOT in PATH but .mcp.json command='$cf_cmd' (expected npx fallback)"
      rm -rf "$iso" 2>/dev/null; return
    fi
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0104-§4a: .mcp.json ruflo.command='$cf_cmd' (PATH detection: ${cf_path:-not-found})"
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Scenario 2 (§2): hive-mind spawn --claude --dry-run with NO objective
#                  exits non-zero with "Objective is required".
# ════════════════════════════════════════════════════════════════════
check_adr0104_objective_required() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local cli; cli=$(_cli_cmd)
  local iso; iso=$(_e2e_isolate "adr0104-no-obj")
  _adr0104_hive_init "$iso" || { _CHECK_OUTPUT="ADR-0104-§2: hive-mind init failed in iso"; rm -rf "$iso" 2>/dev/null; return; }

  local out rc
  out=$(cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 30 $cli hive-mind spawn --claude --dry-run 2>&1)
  rc=$?

  if [[ $rc -eq 0 ]]; then
    _CHECK_OUTPUT="ADR-0104-§2: hive-mind spawn --claude (no objective) exited 0; expected non-zero. out: ${out:0:200}"
    rm -rf "$iso" 2>/dev/null; return
  fi

  if ! echo "$out" | grep -qF "Objective is required"; then
    _CHECK_OUTPUT="ADR-0104-§2: missing 'Objective is required' message. out: ${out:0:300}"
    rm -rf "$iso" 2>/dev/null; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0104-§2: --claude with no objective exits non-zero with required-message"
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Scenario 3 (§2 positive): hive-mind spawn --claude --dry-run -o "obj"
#                           succeeds and prompt file contains the objective.
# ════════════════════════════════════════════════════════════════════
check_adr0104_objective_via_flag() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local cli; cli=$(_cli_cmd)
  local iso; iso=$(_e2e_isolate "adr0104-obj-flag")
  _adr0104_hive_init "$iso" || { _CHECK_OUTPUT="ADR-0104-§2pos: hive-mind init failed in iso"; rm -rf "$iso" 2>/dev/null; return; }

  local out rc
  out=$(cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 60 $cli hive-mind spawn --claude --dry-run -o "Build a REST API" 2>&1)
  rc=$?

  if [[ $rc -ne 0 ]]; then
    _CHECK_OUTPUT="ADR-0104-§2pos: -o objective rejected (rc=$rc). out: ${out:0:300}"
    rm -rf "$iso" 2>/dev/null; return
  fi

  local prompt_files
  prompt_files=$(find "$iso/.hive-mind/sessions" -name 'hive-mind-prompt-*.txt' 2>/dev/null | head -1)
  if [[ -z "$prompt_files" || ! -f "$prompt_files" ]]; then
    _CHECK_OUTPUT="ADR-0104-§2pos: prompt file not generated. out: ${out:0:300}"
    rm -rf "$iso" 2>/dev/null; return
  fi

  if ! grep -qF "Build a REST API" "$prompt_files"; then
    _CHECK_OUTPUT="ADR-0104-§2pos: prompt file missing objective text"
    rm -rf "$iso" 2>/dev/null; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0104-§2pos: -o flag preserves objective in generated prompt"
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Scenario 4 (§1): hive-mind spawn --claude --dry-run --non-interactive "obj"
#                  preserves "obj" as positional, NOT consumed as flag value.
# ════════════════════════════════════════════════════════════════════
check_adr0104_non_interactive_global() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local cli; cli=$(_cli_cmd)
  local iso; iso=$(_e2e_isolate "adr0104-noninter")
  _adr0104_hive_init "$iso" || { _CHECK_OUTPUT="ADR-0104-§1: hive-mind init failed in iso"; rm -rf "$iso" 2>/dev/null; return; }

  local out rc
  out=$(cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 60 $cli hive-mind spawn --claude --dry-run --non-interactive "Coordinate frontend rebuild" 2>&1)
  rc=$?

  if [[ $rc -ne 0 ]]; then
    _CHECK_OUTPUT="ADR-0104-§1: --non-interactive consumed positional (rc=$rc). out: ${out:0:300}"
    rm -rf "$iso" 2>/dev/null; return
  fi

  local prompt_files
  prompt_files=$(find "$iso/.hive-mind/sessions" -name 'hive-mind-prompt-*.txt' 2>/dev/null | head -1)
  if [[ -z "$prompt_files" || ! -f "$prompt_files" ]]; then
    _CHECK_OUTPUT="ADR-0104-§1: prompt file not generated"
    rm -rf "$iso" 2>/dev/null; return
  fi

  if ! grep -qF "Coordinate frontend rebuild" "$prompt_files"; then
    _CHECK_OUTPUT="ADR-0104-§1: positional 'Coordinate frontend rebuild' not in prompt file — parser greedy-consumed it as flag value"
    rm -rf "$iso" 2>/dev/null; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0104-§1: --non-interactive parsed as boolean; positional preserved"
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Scenario 5 (§6 negative): generated prompt does NOT contain the #1422 block.
# ════════════════════════════════════════════════════════════════════
check_adr0104_prompt_no_1422_block() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local cli; cli=$(_cli_cmd)
  local iso; iso=$(_e2e_isolate "adr0104-no1422")
  _adr0104_hive_init "$iso" || { _CHECK_OUTPUT="ADR-0104-§6neg: hive-mind init failed in iso"; rm -rf "$iso" 2>/dev/null; return; }

  (cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 60 $cli hive-mind spawn --claude --dry-run -o "test prompt" >/dev/null 2>&1) || true

  local pf
  pf=$(find "$iso/.hive-mind/sessions" -name 'hive-mind-prompt-*.txt' 2>/dev/null | head -1)
  if [[ -z "$pf" || ! -f "$pf" ]]; then
    _CHECK_OUTPUT="ADR-0104-§6neg: prompt file not generated"
    rm -rf "$iso" 2>/dev/null; return
  fi

  if grep -qF "Do NOT use Claude native Task/Agent tools for swarm coordination" "$pf"; then
    _CHECK_OUTPUT="ADR-0104-§6neg: REGRESSED — #1422 'Do NOT use Claude native Task/Agent tools' block still present"
    rm -rf "$iso" 2>/dev/null; return
  fi

  if grep -qF "TOOL PREFERENCE RULES (#1422)" "$pf"; then
    _CHECK_OUTPUT="ADR-0104-§6neg: REGRESSED — '#1422 TOOL PREFERENCE RULES' header still present"
    rm -rf "$iso" 2>/dev/null; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0104-§6neg: prompt free of #1422 block"
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Scenario 6 (§6 positive): prompt contains TOOL USE + WORKER COORDINATION
#                           CONTRACT blocks; existing 4-phase PROTOCOL preserved.
# ════════════════════════════════════════════════════════════════════
check_adr0104_prompt_v3_contract() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local cli; cli=$(_cli_cmd)
  local iso; iso=$(_e2e_isolate "adr0104-contract")
  _adr0104_hive_init "$iso" || { _CHECK_OUTPUT="ADR-0104-§6pos: hive-mind init failed in iso"; rm -rf "$iso" 2>/dev/null; return; }

  (cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 60 $cli hive-mind spawn --claude --dry-run -o "test prompt v3" >/dev/null 2>&1) || true

  local pf
  pf=$(find "$iso/.hive-mind/sessions" -name 'hive-mind-prompt-*.txt' 2>/dev/null | head -1)
  if [[ -z "$pf" || ! -f "$pf" ]]; then
    _CHECK_OUTPUT="ADR-0104-§6pos: prompt file not generated"
    rm -rf "$iso" 2>/dev/null; return
  fi

  local missing=""
  grep -qF "TOOL USE" "$pf" || missing="${missing}TOOL USE;"
  grep -qF "WORKER COORDINATION CONTRACT" "$pf" || missing="${missing}WORKER COORDINATION CONTRACT;"
  grep -qF "Use Claude Code's Task tool to spawn worker agents" "$pf" || missing="${missing}Task-tool instruction;"
  grep -qF "worker-<your-id>-result" "$pf" || missing="${missing}MCP-write contract;"
  # Preserved 4-phase PROTOCOL
  grep -qF "INITIALIZATION PHASE" "$pf" || missing="${missing}INIT phase;"
  grep -qF "TASK DISTRIBUTION PHASE" "$pf" || missing="${missing}DIST phase;"
  grep -qF "COORDINATION PHASE" "$pf" || missing="${missing}COORD phase;"
  grep -qF "COMPLETION PHASE" "$pf" || missing="${missing}COMPL phase;"

  if [[ -n "$missing" ]]; then
    _CHECK_OUTPUT="ADR-0104-§6pos: prompt missing expected blocks: $missing"
    rm -rf "$iso" 2>/dev/null; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0104-§6pos: prompt has TOOL USE + WORKER CONTRACT; 4-phase PROTOCOL preserved"
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Scenario 7 (§6 metadata): parameterization headers preserved.
# ════════════════════════════════════════════════════════════════════
check_adr0104_prompt_metadata_preserved() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local cli; cli=$(_cli_cmd)
  local iso; iso=$(_e2e_isolate "adr0104-meta")
  _adr0104_hive_init "$iso" || { _CHECK_OUTPUT="ADR-0104-§6meta: hive-mind init failed in iso"; rm -rf "$iso" 2>/dev/null; return; }

  (cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 60 $cli hive-mind spawn --claude --dry-run -o "metadata test" --queen-type strategic --consensus byzantine --topology mesh >/dev/null 2>&1) || true

  local pf
  pf=$(find "$iso/.hive-mind/sessions" -name 'hive-mind-prompt-*.txt' 2>/dev/null | head -1)
  if [[ -z "$pf" || ! -f "$pf" ]]; then
    _CHECK_OUTPUT="ADR-0104-§6meta: prompt file not generated"
    rm -rf "$iso" 2>/dev/null; return
  fi

  local missing=""
  grep -qF "Queen Type:" "$pf" || missing="${missing}Queen Type;"
  grep -qF "Topology:" "$pf" || missing="${missing}Topology;"
  grep -qF "Consensus Algorithm:" "$pf" || missing="${missing}Consensus;"
  grep -qF "Worker Count:" "$pf" || missing="${missing}WorkerCount;"
  grep -qF "WORKER DISTRIBUTION:" "$pf" || missing="${missing}WorkerDist;"

  if [[ -n "$missing" ]]; then
    _CHECK_OUTPUT="ADR-0104-§6meta: prompt missing parameterization headers: $missing"
    rm -rf "$iso" 2>/dev/null; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0104-§6meta: parameterization metadata preserved (Queen/Topology/Consensus/WorkerCount/Distribution)"
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Scenario 8 (§3): output says "Registered N worker slot(s)" with the
#                  "actual workers" note. Does NOT say "Spawned N agent(s)".
# ════════════════════════════════════════════════════════════════════
check_adr0104_honest_spawn_wording() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local cli; cli=$(_cli_cmd)
  local iso; iso=$(_e2e_isolate "adr0104-wording")
  _adr0104_hive_init "$iso" || { _CHECK_OUTPUT="ADR-0104-§3: hive-mind init failed in iso"; rm -rf "$iso" 2>/dev/null; return; }

  # Spawn without --claude so the dry-run prompt path is skipped; we want the
  # spawnCommand output that prints the "Registered N worker slot(s)" line.
  local out
  out=$(cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 60 $cli hive-mind spawn -t researcher -c 2 -o "wording test" 2>&1) || true

  if echo "$out" | grep -qE "Spawned [0-9]+ agent\(s\)"; then
    _CHECK_OUTPUT="ADR-0104-§3: REGRESSED — output still says 'Spawned N agent(s)'. out: ${out:0:300}"
    rm -rf "$iso" 2>/dev/null; return
  fi

  if ! echo "$out" | grep -qE "Registered [0-9]+ worker slot\(s\)"; then
    _CHECK_OUTPUT="ADR-0104-§3: missing 'Registered N worker slot(s)' wording. out: ${out:0:300}"
    rm -rf "$iso" 2>/dev/null; return
  fi

  if ! echo "$out" | grep -qF "actual worker"; then
    _CHECK_OUTPUT="ADR-0104-§3: missing 'actual worker' clarifier note. out: ${out:0:300}"
    rm -rf "$iso" 2>/dev/null; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0104-§3: 'Registered N worker slot(s)' wording with 'actual workers' note present"
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Scenario 9 (§5): 8 parallel hive-mind_memory({set}) with distinct keys
#                  produce 8 entries (no race-clobber). Lock cleaned up.
# ════════════════════════════════════════════════════════════════════
check_adr0104_memory_distinct_keys() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local cli; cli=$(_cli_cmd)
  local iso; iso=$(_e2e_isolate "adr0104-mem-dk")
  _adr0104_hive_init "$iso" || { _CHECK_OUTPUT="ADR-0104-§5dk: hive-mind init failed in iso"; rm -rf "$iso" 2>/dev/null; return; }

  # Spawn 8 background MCP set calls with distinct keys. ADR-0122 T4 made
  # `--type` mandatory at the MCP boundary; pass `--type system` (a
  # permanent system entry) to satisfy MissingMemoryTypeError without
  # changing the lock-test intent — we are testing concurrent writes, not
  # memory-typing.
  local pids=()
  for i in 1 2 3 4 5 6 7 8; do
    (cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 30 $cli hive-mind memory --action set --type system --key "race-key-$i" --value "value-$i" >/dev/null 2>&1) &
    pids+=($!)
  done
  for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null || true; done

  local state="$iso/.claude-flow/hive-mind/state.json"
  if [[ ! -f "$state" ]]; then
    _CHECK_OUTPUT="ADR-0104-§5dk: state.json not created"
    rm -rf "$iso" 2>/dev/null; return
  fi

  local count
  count=$(python3 -c "
import json
d = json.load(open('$state'))
sm = d.get('sharedMemory', {})
kept = [k for k in sm if k.startswith('race-key-')]
print(len(kept))
" 2>/dev/null)
  count=${count:-0}

  if [[ "$count" != "8" ]]; then
    _CHECK_OUTPUT="ADR-0104-§5dk: distinct-key concurrency CLOBBERED — got $count entries, expected 8"
    rm -rf "$iso" 2>/dev/null; return
  fi

  if [[ -f "$state.lock" ]]; then
    _CHECK_OUTPUT="ADR-0104-§5dk: lock sentinel '$state.lock' not cleaned up"
    rm -rf "$iso" 2>/dev/null; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0104-§5dk: 8 distinct-key parallel writes produced 8 entries; lock cleaned up"
  rm -rf "$iso" 2>/dev/null
}

# ════════════════════════════════════════════════════════════════════
# Scenario 10 (§5): 8 parallel writes to SAME key — exactly one value persists,
#                   no torn writes. Validates lock under contention.
# ════════════════════════════════════════════════════════════════════
check_adr0104_memory_same_key() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  local cli; cli=$(_cli_cmd)
  local iso; iso=$(_e2e_isolate "adr0104-mem-sk")
  _adr0104_hive_init "$iso" || { _CHECK_OUTPUT="ADR-0104-§5sk: hive-mind init failed in iso"; rm -rf "$iso" 2>/dev/null; return; }

  # ADR-0122 T4 — pass `--type system` (see distinct-key test above for
  # rationale). The lock test's intent is unchanged.
  local pids=()
  for i in 1 2 3 4 5 6 7 8; do
    (cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 30 $cli hive-mind memory --action set --type system --key "race-test" --value "writer-$i" >/dev/null 2>&1) &
    pids+=($!)
  done
  for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null || true; done

  local state="$iso/.claude-flow/hive-mind/state.json"
  if [[ ! -f "$state" ]]; then
    _CHECK_OUTPUT="ADR-0104-§5sk: state.json not created"
    rm -rf "$iso" 2>/dev/null; return
  fi

  # Validate the file is well-formed JSON (no torn writes) and key holds a
  # single valid writer value. ADR-0122 T4 wraps the value in a typed
  # MemoryEntry dict (`{value, type, ttlMs, ...}`); accept both the legacy
  # raw-string shape and the post-T4 dict shape so this check survives the
  # shape migration without weakening the "exactly one writer wins"
  # assertion.
  local check
  check=$(python3 -c "
import json, sys
try:
  d = json.load(open('$state'))
except Exception as e:
  print('TORN:'+str(e)); sys.exit(0)
val = d.get('sharedMemory', {}).get('race-test')
if val is None:
  print('MISSING')
elif isinstance(val, str) and val.startswith('writer-'):
  print('OK:'+val)
elif isinstance(val, dict):
  inner = val.get('value')
  if isinstance(inner, str) and inner.startswith('writer-') and val.get('type') == 'system':
    print('OK:'+inner)
  else:
    print('UNEXPECTED:'+repr(val))
else:
  print('UNEXPECTED:'+repr(val))
" 2>/dev/null)

  if [[ "$check" != OK:* ]]; then
    _CHECK_OUTPUT="ADR-0104-§5sk: same-key concurrency failed — $check"
    rm -rf "$iso" 2>/dev/null; return
  fi

  if [[ -f "$state.lock" ]]; then
    _CHECK_OUTPUT="ADR-0104-§5sk: lock sentinel '$state.lock' not cleaned up"
    rm -rf "$iso" 2>/dev/null; return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0104-§5sk: 8 same-key parallel writes — JSON well-formed, value=$check; lock cleaned up"
  rm -rf "$iso" 2>/dev/null
}
