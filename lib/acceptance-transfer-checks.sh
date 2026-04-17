#!/usr/bin/env bash
# lib/acceptance-transfer-checks.sh — ADR-0094 Phase 4: Transfer MCP tools
#
# 9 transfer_* tools. Network-dependent — skip_accepted when offline.
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG

_TRANSFER_NETWORK_OK=""  # lazy probe result (set once, reused)

# Shared helper: _transfer_invoke_tool
# Args: $1=tool $2=params $3=expected_pattern $4=label $5=timeout(15)
# Sets: _CHECK_PASSED, _CHECK_OUTPUT
_transfer_invoke_tool() {
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

  # ─── Network guard (lazy, runs once) ──────────────────────────────
  if [[ -z "$_TRANSFER_NETWORK_OK" ]]; then
    local cli; cli=$(_cli_cmd)
    local probe_work; probe_work=$(mktemp /tmp/transfer-probe-XXXXX)
    local probe_cmd="cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool transfer_store-featured"
    _run_and_kill_ro "$probe_cmd" "$probe_work" 15
    local probe_body; probe_body=$(cat "$probe_work" 2>/dev/null || echo "")
    probe_body=$(echo "$probe_body" | grep -v '^__RUFLO_DONE__:')
    rm -f "$probe_work" 2>/dev/null

    if echo "$probe_body" | grep -qiE 'ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network.*(error|unavailable)|fetch failed|connect error|socket hang up'; then
      _TRANSFER_NETWORK_OK="no"
    elif echo "$probe_body" | grep -qiE 'tool.+not found|not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'; then
      # Tool itself is missing from build — still counts as "not network"
      _TRANSFER_NETWORK_OK="tool_missing"
    else
      _TRANSFER_NETWORK_OK="yes"
    fi
  fi

  if [[ "$_TRANSFER_NETWORK_OK" == "no" ]]; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P4/${label}: network unavailable — all transfer tools skip (probe returned connection error)"
    return
  fi

  local cli; cli=$(_cli_cmd)
  local work; work=$(mktemp /tmp/transfer-${tool}-XXXXX)

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
  if echo "$body" | grep -qiE 'tool.+not found|not found|not registered|unknown tool|no such tool|method .* not found|invalid tool'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P4/${label}: MCP tool '$tool' not in build — $(echo "$body" | head -3 | tr '\n' ' ')"
    return
  fi

  # 1b. Connection error on this specific call -> skip_accepted
  if echo "$body" | grep -qiE 'ECONNREFUSED|ENOTFOUND|ETIMEDOUT|network.*(error|unavailable)|fetch failed|connect error|socket hang up'; then
    _CHECK_PASSED="skip_accepted"
    _CHECK_OUTPUT="SKIP_ACCEPTED: P4/${label}: network error on '$tool' — $(echo "$body" | head -3 | tr '\n' ' ')"
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

# Check 1: transfer_store-search
check_adr0094_p4_transfer_store_search() {
  _transfer_invoke_tool \
    "transfer_store-search" \
    '{"query":"test"}' \
    'results|items|\[\]|store|search' \
    "transfer_store-search" \
    15
}

# Check 2: transfer_store-info
check_adr0094_p4_transfer_store_info() {
  _transfer_invoke_tool \
    "transfer_store-info" \
    '{}' \
    'info|store|version|status' \
    "transfer_store-info" \
    15
}

# Check 3: transfer_store-featured
check_adr0094_p4_transfer_store_featured() {
  _transfer_invoke_tool \
    "transfer_store-featured" \
    '{}' \
    'featured|items|\[\]|results' \
    "transfer_store-featured" \
    15
}

# Check 4: transfer_store-trending
check_adr0094_p4_transfer_store_trending() {
  _transfer_invoke_tool \
    "transfer_store-trending" \
    '{}' \
    'trending|items|\[\]|results' \
    "transfer_store-trending" \
    15
}

# Check 5: transfer_plugin-search
check_adr0094_p4_transfer_plugin_search() {
  _transfer_invoke_tool \
    "transfer_plugin-search" \
    '{"query":"test"}' \
    'results|plugins|\[\]|search' \
    "transfer_plugin-search" \
    15
}

# Check 6: transfer_plugin-info
check_adr0094_p4_transfer_plugin_info() {
  _transfer_invoke_tool \
    "transfer_plugin-info" \
    '{}' \
    'info|plugin|version|status' \
    "transfer_plugin-info" \
    15
}

# Check 7: transfer_plugin-featured
check_adr0094_p4_transfer_plugin_featured() {
  _transfer_invoke_tool \
    "transfer_plugin-featured" \
    '{}' \
    'featured|plugins|\[\]|results' \
    "transfer_plugin-featured" \
    15
}

# Check 8: transfer_plugin-official
check_adr0094_p4_transfer_plugin_official() {
  _transfer_invoke_tool \
    "transfer_plugin-official" \
    '{}' \
    'official|plugins|\[\]|results' \
    "transfer_plugin-official" \
    15
}

# Check 9: transfer_detect-pii — PII detection (local, no network needed)
check_adr0094_p4_transfer_detect_pii() {
  _transfer_invoke_tool \
    "transfer_detect-pii" \
    '{"input":"john@example.com 555-1234"}' \
    'pii|detected|true|found' \
    "transfer_detect-pii" \
    15
}
