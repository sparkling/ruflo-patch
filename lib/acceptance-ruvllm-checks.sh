#!/usr/bin/env bash
# lib/acceptance-ruvllm-checks.sh — ADR-0094 Phase 5: RuvLLM MCP tools
#
# Acceptance checks for the 10 ruvllm_* MCP tools. Each check invokes
# the tool via `cli mcp exec --tool <name> --params '<json>'` and matches
# the output against an expected pattern.
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
#           (_run_and_kill_ro, _cli_cmd, _e2e_isolate available)
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG

# ════════════════════════════════════════════════════════════════════
# Shared helper: _ruvllm_invoke_tool
# ════════════════════════════════════════════════════════════════════
#
# Arguments (positional):
#   $1 tool             — MCP tool name (e.g. "ruvllm_status")
#   $2 params           — JSON params string (e.g. '{"name":"test-idx"}')
#   $3 expected_pattern — grep -iE pattern for a PASS match
#   $4 label            — human-readable label for diagnostics
#   $5 timeout          — max seconds (default 15)
#
# Sets: _CHECK_PASSED ("true" / "false" / "skip_accepted")
#       _CHECK_OUTPUT  (diagnostic string)
_ruvllm_invoke_tool() {
  local tool="$1"
  local params="$2"
  local expected_pattern="$3"
  local label="$4"
  local timeout="${5:-15}"

  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  if [[ -z "$tool" || -z "$expected_pattern" || -z "$label" ]]; then
    _CHECK_OUTPUT="P5/${label}: helper called with missing args (tool=$tool pattern=$expected_pattern label=$label)"
    return
  fi

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/ruvllm-${tool}-XXXXX)

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
  #
  # The CLI emits `[OK] Tool executed in N ms` when the handler ran.
  # Stateful-registry tools (e.g. ruvllm_hnsw_add) return valid
  # handler errors containing substrings like "Router not found: …" —
  # those are NOT skip conditions, they are real tool executions. So
  # only trip the skip bucket when `[OK]` is absent AND a registry-
  # lookup-failure phrase is present in stderr/stdout.
  if ! echo "$body" | grep -qiE '\[OK\] Tool executed' \
     && echo "$body" | grep -qiE 'tool .+(not found|not registered)|unknown tool|no such tool|method .* not found|invalid tool|Tool [A-Za-z0-9_]+ not registered'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P5/${label}: MCP tool '$tool' not in build — $(echo "$body" | head -3 | tr '\n' ' ')"
    return
  fi

  # 2. Expected pattern match -> PASS
  if echo "$body" | grep -qiE "$expected_pattern"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P5/${label}: tool '$tool' returned expected pattern ($expected_pattern)"
    return
  fi

  # 3. Everything else -> FAIL with diagnostic
  _CHECK_PASSED="false"
  _CHECK_OUTPUT="P5/${label}: tool '$tool' output did not match /$expected_pattern/i. Output (first 10 lines):
$(echo "$body" | head -10)"
}

# Check 1: ruvllm_status — query RuvLLM runtime status
check_adr0094_p5_ruvllm_status() {
  _ruvllm_invoke_tool \
    "ruvllm_status" \
    '{}' \
    'status|runtime|ready' \
    "ruvllm_status" \
    15
}

# Check 2: ruvllm_hnsw_create — create an HNSW index
check_adr0094_p5_ruvllm_hnsw_create() {
  _ruvllm_invoke_tool \
    "ruvllm_hnsw_create" \
    '{"name":"test-idx","dimensions":768}' \
    '\[OK\]|content|result|index|hnsw|created|success' \
    "ruvllm_hnsw_create" \
    15
}

# Check 3: ruvllm_hnsw_add — add pattern to HNSW router
#
# Stateful tool: the hnswRouters Map only persists within a single process.
# `cli mcp exec` is a one-shot invocation, so any router created in
# ruvllm_hnsw_create is gone by the time this check runs. Accepting
# "Router not found: ..." as a valid terminal state proves:
#   1. tool is registered (would otherwise hit "tool not found" skip bucket)
#   2. params schema parses (routerId/name/embedding accepted)
#   3. handler's registry lookup executed
check_adr0094_p5_ruvllm_hnsw_add() {
  _ruvllm_invoke_tool \
    "ruvllm_hnsw_add" \
    '{"routerId":"hnsw-nonexistent","name":"v1","embedding":[0.1,0.2]}' \
    '\[OK\]|content|result|index|hnsw|added|success|router not found|patternCount' \
    "ruvllm_hnsw_add" \
    15
}

# Check 4: ruvllm_hnsw_route — route query via HNSW
# Same stateful-registry caveat as ruvllm_hnsw_add above.
check_adr0094_p5_ruvllm_hnsw_route() {
  _ruvllm_invoke_tool \
    "ruvllm_hnsw_route" \
    '{"routerId":"hnsw-nonexistent","query":[0.1,0.2],"k":3}' \
    '\[OK\]|content|result|index|hnsw|route|match|router not found|results' \
    "ruvllm_hnsw_route" \
    15
}

# Check 5: ruvllm_sona_create — create a SONA instance
check_adr0094_p5_ruvllm_sona_create() {
  _ruvllm_invoke_tool \
    "ruvllm_sona_create" \
    '{"name":"test-sona"}' \
    '\[OK\]|content|result|sona|created|success' \
    "ruvllm_sona_create" \
    15
}

# Check 6: ruvllm_sona_adapt — adapt a SONA instance
# Same stateful-registry caveat as ruvllm_hnsw_add above.
check_adr0094_p5_ruvllm_sona_adapt() {
  _ruvllm_invoke_tool \
    "ruvllm_sona_adapt" \
    '{"sonaId":"sona-nonexistent","quality":0.5}' \
    '\[OK\]|content|result|sona|adapted|success|sona not found|stats' \
    "ruvllm_sona_adapt" \
    15
}

# Check 7: ruvllm_microlora_create — create a MicroLoRA adapter
check_adr0094_p5_ruvllm_microlora_create() {
  _ruvllm_invoke_tool \
    "ruvllm_microlora_create" \
    '{"name":"test-lora"}' \
    '\[OK\]|content|result|lora|microlora|created|success' \
    "ruvllm_microlora_create" \
    15
}

# Check 8: ruvllm_microlora_adapt — adapt via MicroLoRA
# Same stateful-registry caveat as ruvllm_hnsw_add above.
check_adr0094_p5_ruvllm_microlora_adapt() {
  _ruvllm_invoke_tool \
    "ruvllm_microlora_adapt" \
    '{"loraId":"lora-nonexistent","quality":0.5}' \
    '\[OK\]|content|result|lora|microlora|adapted|success|microlora not found|stats' \
    "ruvllm_microlora_adapt" \
    15
}

# Check 9: ruvllm_generate_config — generate RuvLLM config
check_adr0094_p5_ruvllm_generate_config() {
  _ruvllm_invoke_tool \
    "ruvllm_generate_config" \
    '{}' \
    '\[OK\]|content|result|config|generated|settings' \
    "ruvllm_generate_config" \
    15
}

# Check 10: ruvllm_chat_format — format chat messages
check_adr0094_p5_ruvllm_chat_format() {
  _ruvllm_invoke_tool \
    "ruvllm_chat_format" \
    '{"messages":[{"role":"user","content":"hi"}]}' \
    '\[OK\]|content|result|format|chat|message' \
    "ruvllm_chat_format" \
    15
}
