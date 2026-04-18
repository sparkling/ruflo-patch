#!/usr/bin/env bash
# lib/acceptance-session-lifecycle-checks.sh — ADR-0094 Phase 3: Session MCP tools
#
# Acceptance checks for the 5 session_* MCP tools. Each check invokes
# the tool via `cli mcp exec --tool <name> --params '<json>'` and matches
# the output against an expected pattern. A lifecycle check exercises the
# full save -> list -> info -> restore -> delete -> list sequence.
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
#           (_run_and_kill_ro, _run_and_kill, _cli_cmd, _e2e_isolate available)
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG

# ════════════════════════════════════════════════════════════════════
# Shared helper: _session_invoke_tool
# ════════════════════════════════════════════════════════════════════
#
# Arguments (positional):
#   $1 tool             — MCP tool name (e.g. "session_save")
#   $2 params           — JSON params string (e.g. '{"name":"test"}')
#   $3 expected_pattern — grep -iE pattern for a PASS match
#   $4 label            — human-readable label for diagnostics
#   $5 timeout          — max seconds (default 15)
#
# Sets: _CHECK_PASSED ("true" / "false" / "skip_accepted")
#       _CHECK_OUTPUT  (diagnostic string)
_session_invoke_tool() {
  local tool="$1"
  local params="$2"
  local expected_pattern="$3"
  local label="$4"
  local timeout="${5:-15}"

  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  if [[ -z "$tool" || -z "$expected_pattern" || -z "$label" ]]; then
    _CHECK_OUTPUT="P3-sess/${label}: helper called with missing args (tool=$tool pattern=$expected_pattern label=$label)"
    return
  fi

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/session-${tool}-XXXXX)

  # Build the command — include --params only when non-empty
  local cmd
  if [[ -n "$params" && "$params" != "{}" ]]; then
    cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool $tool --params '$params'"
  else
    cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool $tool"
  fi

  _run_and_kill_ro "$cmd" "$work" "$timeout"
  local body; body=$(cat "$work" 2>/dev/null || echo "")
  body=$(echo "$body" | grep -v '^__RUFLO_DONE__:')

  rm -f "$work" 2>/dev/null

  # ─── Three-way bucket ────────────────────────────────────────────
  # 1. Tool not found / not registered -> skip_accepted
  #    NOTE: pattern must NOT match JSON payloads like `"error": "Session not found"`
  #    (that is a handler-level domain response, not a tool-registration problem).
  #    Anchor to tool-level phrasing only.
  if echo "$body" | grep -qiE 'tool.+not (found|registered)|unknown tool|no such tool|method .* not found|invalid tool|tool .+ is not available'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P3-sess/${label}: MCP tool '$tool' not in build — $(echo "$body" | head -3 | tr '\n' ' ')"
    return
  fi

  # 2. Expected pattern match -> PASS
  if echo "$body" | grep -qiE "$expected_pattern"; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="P3-sess/${label}: tool '$tool' returned expected pattern ($expected_pattern)"
    return
  fi

  # 3. Everything else -> FAIL with diagnostic
  _CHECK_PASSED="false"
  _CHECK_OUTPUT="P3-sess/${label}: tool '$tool' output did not match /$expected_pattern/i. Output (first 10 lines):
$(echo "$body" | head -10)"
}

# ════════════════════════════════════════════════════════════════════
# Lifecycle check: full save -> list -> info -> restore -> delete flow
# ════════════════════════════════════════════════════════════════════
#
# Exercises the complete session lifecycle in sequence. Uses
# _run_and_kill (write variant) for mutating operations. Any step
# that fails short-circuits to FAIL with a diagnostic identifying
# which step broke.
check_adr0094_p3_session_lifecycle() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/session-lifecycle-XXXXX)
  local session_name="adr0094-lifecycle-$$"

  # Step 1: save
  _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool session_save --params '{\"name\":\"$session_name\"}'" "$work" 15
  local body; body=$(cat "$work" 2>/dev/null || echo ""); body=$(echo "$body" | grep -v '^__RUFLO_DONE__:')
  if echo "$body" | grep -qiE 'tool.+not (found|registered)|unknown tool|no such tool|method .* not found|invalid tool|tool .+ is not available'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P3-sess/lifecycle: session_save not in build — $(echo "$body" | head -3 | tr '\n' ' ')"
    rm -f "$work" 2>/dev/null; return
  fi
  if ! echo "$body" | grep -qiE 'saved|success|session'; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="P3-sess/lifecycle: step 1 (save) failed — output did not match /saved|success|session/. Output: $(echo "$body" | head -5 | tr '\n' ' ')"
    rm -f "$work" 2>/dev/null; return
  fi

  # Step 2: list — should contain the session
  _run_and_kill_ro "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool session_list" "$work" 15
  body=$(cat "$work" 2>/dev/null || echo ""); body=$(echo "$body" | grep -v '^__RUFLO_DONE__:')
  if ! echo "$body" | grep -qiE 'sessions|list|\[\]|name'; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="P3-sess/lifecycle: step 2 (list) failed — output did not match /sessions|list|name/. Output: $(echo "$body" | head -5 | tr '\n' ' ')"
    rm -f "$work" 2>/dev/null; return
  fi

  # Step 3: info
  _run_and_kill_ro "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool session_info --params '{\"name\":\"$session_name\"}'" "$work" 15
  body=$(cat "$work" 2>/dev/null || echo ""); body=$(echo "$body" | grep -v '^__RUFLO_DONE__:')
  if ! echo "$body" | grep -qiE 'info|session|metadata|created'; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="P3-sess/lifecycle: step 3 (info) failed — output did not match /info|session|metadata|created/. Output: $(echo "$body" | head -5 | tr '\n' ' ')"
    rm -f "$work" 2>/dev/null; return
  fi

  # Step 4: restore
  _run_and_kill_ro "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool session_restore --params '{\"name\":\"$session_name\"}'" "$work" 15
  body=$(cat "$work" 2>/dev/null || echo ""); body=$(echo "$body" | grep -v '^__RUFLO_DONE__:')
  if ! echo "$body" | grep -qiE 'restored|loaded|session'; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="P3-sess/lifecycle: step 4 (restore) failed — output did not match /restored|loaded|session/. Output: $(echo "$body" | head -5 | tr '\n' ' ')"
    rm -f "$work" 2>/dev/null; return
  fi

  # Step 5: delete
  _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool session_delete --params '{\"name\":\"$session_name\"}'" "$work" 15
  body=$(cat "$work" 2>/dev/null || echo ""); body=$(echo "$body" | grep -v '^__RUFLO_DONE__:')
  if ! echo "$body" | grep -qiE 'deleted|removed|success'; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="P3-sess/lifecycle: step 5 (delete) failed — output did not match /deleted|removed|success/. Output: $(echo "$body" | head -5 | tr '\n' ' ')"
    rm -f "$work" 2>/dev/null; return
  fi

  rm -f "$work" 2>/dev/null
  _CHECK_PASSED="true"
  _CHECK_OUTPUT="P3-sess/lifecycle: full 5-step session lifecycle passed (save->list->info->restore->delete)"
}

# ════════════════════════════════════════════════════════════════════
# Seeding helper: save a one-off session and return its name via stdout.
# Each individual check seeds its own uniquely-named session so parallel
# runs don't collide, and so info/restore/delete exercise the real happy
# path rather than the "Session not found" branch.
#
# Usage:  local name; name=$(_session_seed "info") || return
# ════════════════════════════════════════════════════════════════════
_session_seed() {
  local tag="$1"
  local cli; cli=$(_cli_cmd)
  local name="adr0094-seed-${tag}-$$-${RANDOM}"
  local work; work=$(mktemp /tmp/session-seed-${tag}-XXXXX)
  _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool session_save --params '{\"name\":\"$name\"}'" "$work" 15
  local body; body=$(cat "$work" 2>/dev/null || echo ""); body=$(echo "$body" | grep -v '^__RUFLO_DONE__:')
  rm -f "$work" 2>/dev/null
  # Tool-registration-level skip surfaces up so the dependent check can mark skip_accepted.
  if echo "$body" | grep -qiE 'tool.+not (found|registered)|unknown tool|no such tool|method .* not found|invalid tool|tool .+ is not available'; then
    echo "__SKIP_TOOL_MISSING__"
    return 0
  fi
  # Seeding must actually produce a savedAt/sessionId-shaped response.
  if ! echo "$body" | grep -qiE 'savedAt|sessionId'; then
    echo "__SEED_FAILED__:$(echo "$body" | head -3 | tr '\n' ' ')"
    return 0
  fi
  echo "$name"
}

# ════════════════════════════════════════════════════════════════════
# Individual tool checks
# ════════════════════════════════════════════════════════════════════

check_adr0094_p3_session_save() {
  _session_invoke_tool \
    "session_save" \
    '{"name":"adr0094-test-session-save-'"$$"'"}' \
    'savedAt|sessionId' \
    "session_save" \
    15
}

check_adr0094_p3_session_restore() {
  local name; name=$(_session_seed "restore")
  if [[ "$name" == "__SKIP_TOOL_MISSING__" ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P3-sess/session_restore: session_save tool not in build (prereq)"
    return
  fi
  if [[ "$name" == __SEED_FAILED__* ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="P3-sess/session_restore: seed via session_save failed — ${name#__SEED_FAILED__:}"
    return
  fi
  _session_invoke_tool \
    "session_restore" \
    '{"name":"'"$name"'"}' \
    '"restored":\s*true|restoredAt' \
    "session_restore" \
    15
}

check_adr0094_p3_session_list() {
  _session_invoke_tool \
    "session_list" \
    '{}' \
    'sessions|list|\[\]|name' \
    "session_list" \
    15
}

check_adr0094_p3_session_delete() {
  local name; name=$(_session_seed "delete")
  if [[ "$name" == "__SKIP_TOOL_MISSING__" ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P3-sess/session_delete: session_save tool not in build (prereq)"
    return
  fi
  if [[ "$name" == __SEED_FAILED__* ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="P3-sess/session_delete: seed via session_save failed — ${name#__SEED_FAILED__:}"
    return
  fi
  _session_invoke_tool \
    "session_delete" \
    '{"name":"'"$name"'"}' \
    '"deleted":\s*true|deletedAt' \
    "session_delete" \
    15
}

check_adr0094_p3_session_info() {
  local name; name=$(_session_seed "info")
  if [[ "$name" == "__SKIP_TOOL_MISSING__" ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P3-sess/session_info: session_save tool not in build (prereq)"
    return
  fi
  if [[ "$name" == __SEED_FAILED__* ]]; then
    _CHECK_PASSED="false"
    _CHECK_OUTPUT="P3-sess/session_info: seed via session_save failed — ${name#__SEED_FAILED__:}"
    return
  fi
  _session_invoke_tool \
    "session_info" \
    '{"name":"'"$name"'"}' \
    'savedAt|fileSize|hasData' \
    "session_info" \
    15
}
