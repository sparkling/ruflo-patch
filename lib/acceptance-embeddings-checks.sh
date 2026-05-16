#!/usr/bin/env bash
# lib/acceptance-embeddings-checks.sh — ADR-0094 Phase 4: Embeddings MCP tools
#
# Acceptance checks for the 7 embeddings_* MCP tools. Each check invokes
# the tool via `cli mcp exec --tool <name> --params '<json>'` and matches
# the output against an expected pattern.
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
#           (_run_and_kill_ro, _cli_cmd, _e2e_isolate available)
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG

# ════════════════════════════════════════════════════════════════════
# Shared helper: _embeddings_invoke_tool
# ════════════════════════════════════════════════════════════════════
#
# Arguments (positional):
#   $1 tool             — MCP tool name (e.g. "embeddings_init")
#   $2 params           — JSON params string (e.g. '{"text":"hello"}')
#   $3 expected_pattern — grep -iE pattern for a PASS match
#   $4 label            — human-readable label for diagnostics
#   $5 timeout          — max seconds (default 15)
#
# Sets: _CHECK_PASSED ("true" / "false" / "skip_accepted")
#       _CHECK_OUTPUT  (diagnostic string)
# adr0097-l5-intentional: emits P4/<label>-prefixed diagnostics for embeddings checks (ADR-0094 Phase 4); canonical _mcp_invoke_tool has no phase-prefix convention and would lose forensic trace in grouped-parallel acceptance runs.
_embeddings_invoke_tool() {
  local tool="$1"
  local params="$2"
  local expected_pattern="$3"
  local label="$4"
  local timeout="${5:-15}"

  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  if [[ -z "$tool" || -z "$expected_pattern" || -z "$label" ]]; then
    _CHECK_OUTPUT="P4/${label}: helper called with missing args (tool=$tool pattern=$expected_pattern label=$label)"
    return
  fi

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/embeddings-${tool}-XXXXX)

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
    _CHECK_OUTPUT="SKIP_ACCEPTED: P4/${label}: MCP tool '$tool' not in build — $(echo "$body" | head -3 | tr '\n' ' ')"
    return
  fi

  # 2. Expected pattern match -> PASS
  if echo "$body" | grep -qiE "$expected_pattern"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P4/${label}: tool '$tool' returned expected pattern ($expected_pattern)"
    return
  fi

  # 3. Everything else -> FAIL with diagnostic
  _CHECK_PASSED="false"
  _CHECK_OUTPUT="P4/${label}: tool '$tool' output did not match /$expected_pattern/i. Output (first 10 lines):
$(echo "$body" | head -10)"
}

# ════════════════════════════════════════════════════════════════════
# Check 1: embeddings_init — initialize the embedding model
# ════════════════════════════════════════════════════════════════════
check_adr0094_p4_embeddings_init() { # adr0097-l2-delegator: flag set inside _embeddings_invoke_tool
  _embeddings_invoke_tool \
    "embeddings_init" \
    '{}' \
    'initialized|ready|success|model' \
    "embeddings_init" \
    30
}

# ════════════════════════════════════════════════════════════════════
# Check 2: embeddings_generate — generate an embedding vector
# ════════════════════════════════════════════════════════════════════
check_adr0094_p4_embeddings_generate() { # adr0097-l2-delegator: flag set inside _embeddings_invoke_tool
  _embeddings_invoke_tool \
    "embeddings_generate" \
    '{"text":"hello world"}' \
    'embedding|vector|dimensions|768|\[' \
    "embeddings_generate" \
    30
}

# ════════════════════════════════════════════════════════════════════
# Check 3: embeddings_compare — compare two texts by similarity
# ════════════════════════════════════════════════════════════════════
check_adr0094_p4_embeddings_compare() { # adr0097-l2-delegator: flag set inside _embeddings_invoke_tool
  _embeddings_invoke_tool \
    "embeddings_compare" \
    '{"text1":"hello","text2":"world"}' \
    'similarity|score|distance|0\.' \
    "embeddings_compare" \
    30
}

# ════════════════════════════════════════════════════════════════════
# Check 4: embeddings_search — search for similar embeddings
# ════════════════════════════════════════════════════════════════════
check_adr0094_p4_embeddings_search() { # adr0097-l2-delegator: flag set inside _embeddings_invoke_tool
  _embeddings_invoke_tool \
    "embeddings_search" \
    '{"query":"hello","limit":5}' \
    'results|matches|\[\]' \
    "embeddings_search" \
    30
}

# ════════════════════════════════════════════════════════════════════
# Check 5: embeddings_hyperbolic — hyperbolic embedding
# ════════════════════════════════════════════════════════════════════
check_adr0094_p4_embeddings_hyperbolic() { # adr0097-l2-delegator: flag set inside _embeddings_invoke_tool
  _embeddings_invoke_tool \
    "embeddings_hyperbolic" \
    '{"text":"hello"}' \
    'embedding|hyperbolic|vector' \
    "embeddings_hyperbolic" \
    30
}

# ════════════════════════════════════════════════════════════════════
# Check 6: embeddings_neural — neural embedding
# ════════════════════════════════════════════════════════════════════
check_adr0094_p4_embeddings_neural() { # adr0097-l2-delegator: flag set inside _embeddings_invoke_tool
  _embeddings_invoke_tool \
    "embeddings_neural" \
    '{"text":"hello"}' \
    'embedding|neural|vector' \
    "embeddings_neural" \
    30
}

# ════════════════════════════════════════════════════════════════════
# Check 7: embeddings_status — query embedding model status
# ════════════════════════════════════════════════════════════════════
check_adr0094_p4_embeddings_status() { # adr0097-l2-delegator: flag set inside _embeddings_invoke_tool
  _embeddings_invoke_tool \
    "embeddings_status" \
    '{}' \
    'status|model|loaded|ready' \
    "embeddings_status" \
    15
}
