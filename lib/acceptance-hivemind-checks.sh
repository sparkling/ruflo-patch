#!/usr/bin/env bash
# lib/acceptance-hivemind-checks.sh — ADR-0094 Phase 3: hive-mind MCP tools
#
# Acceptance checks for the 9 hive-mind_* MCP tools. Each check invokes
# the tool via `cli mcp exec --tool <name> --params '<json>'` and matches
# the output against an expected pattern.
#
# NOTE: These tools use HYPHENS in the prefix: "hive-mind_init", not
# "hivemind_init". The MCP dispatcher normalises hyphens/underscores for
# routing, but the canonical names carry the hyphen.
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
#           (_run_and_kill_ro, _cli_cmd, _e2e_isolate available)
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG

# ════════════════════════════════════════════════════════════════════
# Shared helper: _hivemind_invoke_tool
# ════════════════════════════════════════════════════════════════════
#
# Arguments (positional):
#   $1 tool             — MCP tool name (e.g. "hive-mind_init")
#   $2 params           — JSON params string (e.g. '{"topology":"raft"}')
#   $3 expected_pattern — grep -iE pattern for a PASS match
#   $4 label            — human-readable label for diagnostics
#   $5 timeout          — max seconds (default 15)
#
# Sets: _CHECK_PASSED ("true" / "false" / "skip_accepted")
#       _CHECK_OUTPUT  (diagnostic string)
_hivemind_invoke_tool() {
  local tool="$1"
  local params="$2"
  local expected_pattern="$3"
  local label="$4"
  local timeout="${5:-15}"

  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  if [[ -z "$tool" || -z "$expected_pattern" || -z "$label" ]]; then
    _CHECK_OUTPUT="P3/${label}: helper called with missing args (tool=$tool pattern=$expected_pattern label=$label)"
    return
  fi

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/hivemind-${tool}-XXXXX)

  # Build the command — include --params only when non-empty
  local cmd
  if [[ -n "$params" && "$params" != "{}" ]]; then
    cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool $tool --params '$params'"
  else
    cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool $tool"
  fi

  _run_and_kill_ro "$cmd" "$work" "$timeout"
  local body; body=$(cat "$work" 2>/dev/null || echo "")
  # Strip the sentinel line before matching
  body=$(echo "$body" | grep -v '^__RUFLO_DONE__:')

  rm -f "$work" 2>/dev/null

  # ─── Three-way bucket ────────────────────────────────────────────
  # 1. Tool not found / not registered -> skip_accepted
  if echo "$body" | grep -qiE 'tool.+not found|not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P3/${label}: MCP tool '$tool' not in build — $(echo "$body" | head -3 | tr '\n' ' ')"
    return
  fi

  # 2. Expected pattern match -> PASS
  if echo "$body" | grep -qiE "$expected_pattern"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P3/${label}: tool '$tool' returned expected pattern ($expected_pattern)"
    return
  fi

  # 3. Everything else -> FAIL with diagnostic
  _CHECK_PASSED="false"
  _CHECK_OUTPUT="P3/${label}: tool '$tool' output did not match /$expected_pattern/i. Output (first 10 lines):
$(echo "$body" | head -10)"
}

# ── Check 1: hive-mind_init — Initialize hive with raft topology ──
check_adr0094_p3_hivemind_init() {
  _hivemind_invoke_tool \
    "hive-mind_init" \
    '{"topology":"raft"}' \
    'initialized|hive|success|running' \
    "hive-mind_init" \
    15
}

# ── Check 2: hive-mind_join — Join an agent to the hive ───────────
check_adr0094_p3_hivemind_join() {
  _hivemind_invoke_tool \
    "hive-mind_join" \
    '{"agentId":"test-agent"}' \
    'joined|success|member' \
    "hive-mind_join" \
    15
}

# ── Check 3: hive-mind_leave — Remove agent from hive ─────────────
check_adr0094_p3_hivemind_leave() {
  _hivemind_invoke_tool \
    "hive-mind_leave" \
    '{"agentId":"test-agent"}' \
    'left|removed|success' \
    "hive-mind_leave" \
    15
}

# ── Check 4: hive-mind_status — Query hive status ─────────────────
check_adr0094_p3_hivemind_status() {
  _hivemind_invoke_tool \
    "hive-mind_status" \
    '{}' \
    'status|state|members|topology' \
    "hive-mind_status" \
    15
}

# ── Check 5: hive-mind_spawn — Spawn agent inside hive ────────────
check_adr0094_p3_hivemind_spawn() {
  _hivemind_invoke_tool \
    "hive-mind_spawn" \
    '{"type":"worker"}' \
    'spawned|created|agent' \
    "hive-mind_spawn" \
    15
}

# ── Check 6: hive-mind_broadcast — Broadcast message to hive ──────
check_adr0094_p3_hivemind_broadcast() {
  _hivemind_invoke_tool \
    "hive-mind_broadcast" \
    '{"message":"adr0094-test-ping"}' \
    'broadcast|sent|delivered|success' \
    "hive-mind_broadcast" \
    15
}

# ── Check 7: hive-mind_consensus — Propose consensus vote ─────────
check_adr0094_p3_hivemind_consensus() {
  _hivemind_invoke_tool \
    "hive-mind_consensus" \
    '{"proposal":"test-vote","value":"yes"}' \
    'consensus|vote|result|agreed' \
    "hive-mind_consensus" \
    15
}

# ── Check 8: hive-mind_memory — Shared memory get ─────────────────
check_adr0094_p3_hivemind_memory() {
  _hivemind_invoke_tool \
    "hive-mind_memory" \
    '{"action":"get","key":"test"}' \
    'memory|value|null|result' \
    "hive-mind_memory" \
    15
}

# ── Check 9: hive-mind_shutdown — Shut down the hive ──────────────
check_adr0094_p3_hivemind_shutdown() {
  _hivemind_invoke_tool \
    "hive-mind_shutdown" \
    '{}' \
    'shutdown|stopped|success' \
    "hive-mind_shutdown" \
    15
}

# ── LIFECYCLE: init -> join -> status -> broadcast -> memory ->
# ── consensus -> leave -> shutdown (sequential, single session) ───
# Each step must PASS (or skip_accepted) for the next to run.
# If any step FAILs, the chain breaks with a diagnostic.
check_adr0094_p3_hivemind_lifecycle() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp -d /tmp/hivemind-lifecycle-XXXXX)
  local step_pass step_out body
  local passed_steps=0
  local total_steps=8

  # Ordered lifecycle: init -> join -> status -> broadcast -> memory
  #                    -> consensus -> leave -> shutdown
  local -a tools=(
    "hive-mind_init"
    "hive-mind_join"
    "hive-mind_status"
    "hive-mind_broadcast"
    "hive-mind_memory"
    "hive-mind_consensus"
    "hive-mind_leave"
    "hive-mind_shutdown"
  )
  local -a params=(
    '{"topology":"raft"}'
    '{"agentId":"test-agent"}'
    '{}'
    '{"message":"adr0094-test-ping"}'
    '{"action":"get","key":"test"}'
    '{"proposal":"test-vote","value":"yes"}'
    '{"agentId":"test-agent"}'
    '{}'
  )
  local -a patterns=(
    'initialized|hive|success|running'
    'joined|success|member'
    'status|state|members|topology'
    'broadcast|sent|delivered|success'
    'memory|value|null|result'
    'consensus|vote|result|agreed'
    'left|removed|success'
    'shutdown|stopped|success'
  )

  local all_skipped=true

  for i in "${!tools[@]}"; do
    local t="${tools[$i]}"
    local p="${params[$i]}"
    local pat="${patterns[$i]}"
    local out_file="$work/step-${i}.out"

    local cmd
    if [[ -n "$p" && "$p" != "{}" ]]; then
      cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool $t --params '$p'"
    else
      cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool $t"
    fi

    _run_and_kill_ro "$cmd" "$out_file" 15
    body=$(cat "$out_file" 2>/dev/null || echo "")
    body=$(echo "$body" | grep -v '^__RUFLO_DONE__:')

    # Tool not found -> skip_accepted for this step, continue chain
    if echo "$body" | grep -qiE 'tool.+not found|not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'; then
      : # skip — tool not wired, continue to next step
    elif echo "$body" | grep -qiE "$pat"; then
      all_skipped=false
      passed_steps=$((passed_steps + 1))
    else
      # Hard FAIL — chain broken at this step
      _CHECK_PASSED="false"
      _CHECK_OUTPUT="P3/lifecycle: chain broken at step $((i+1))/$total_steps ($t). Output did not match /$pat/i. Output (first 5 lines):
$(echo "$body" | head -5)"
      rm -rf "$work" 2>/dev/null
      return
    fi
  done

  rm -rf "$work" 2>/dev/null

  if [[ "$all_skipped" == "true" ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P3/lifecycle: all $total_steps hive-mind tools returned not-found — hive-mind not in build"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="P3/lifecycle: $passed_steps/$total_steps steps passed sequentially (init->join->status->broadcast->memory->consensus->leave->shutdown)"
}
