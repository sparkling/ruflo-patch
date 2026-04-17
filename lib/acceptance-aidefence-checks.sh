#!/usr/bin/env bash
# lib/acceptance-aidefence-checks.sh — ADR-0094 Phase 1: AI Defence MCP tools
#
# Acceptance checks for the 6 aidefence_* MCP tools. Each check invokes
# the tool via the canonical `_mcp_invoke_tool` helper defined in
# acceptance-harness.sh (ADR-0094 Sprint 0 WI-3 — no per-domain drift).
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
#           (_mcp_invoke_tool, _cli_cmd, _e2e_isolate available)
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG

# ════════════════════════════════════════════════════════════════════
# Check 1: aidefence_scan — scan input for threats
# ════════════════════════════════════════════════════════════════════
check_adr0094_p1_aidefence_scan() {
  _mcp_invoke_tool \
    "aidefence_scan" \
    '{"input":"hello world"}' \
    'safe|threat|result|scanned' \
    "P1/aidefence_scan" \
    15 --ro
}

# ════════════════════════════════════════════════════════════════════
# Check 2: aidefence_analyze — deep analysis
# ════════════════════════════════════════════════════════════════════
check_adr0094_p1_aidefence_analyze() {
  _mcp_invoke_tool \
    "aidefence_analyze" \
    '{"input":"normal text for analysis"}' \
    'analysis|result|safe' \
    "P1/aidefence_analyze" \
    15 --ro
}

# ════════════════════════════════════════════════════════════════════
# Check 3: aidefence_has_pii — PII detection
# ════════════════════════════════════════════════════════════════════
check_adr0094_p1_aidefence_has_pii() {
  _mcp_invoke_tool \
    "aidefence_has_pii" \
    '{"input":"Contact john@example.com or call 555-1234"}' \
    'true|pii|found' \
    "P1/aidefence_has_pii" \
    15 --ro
}

# ════════════════════════════════════════════════════════════════════
# Check 4: aidefence_is_safe — safety check
# ════════════════════════════════════════════════════════════════════
check_adr0094_p1_aidefence_is_safe() {
  _mcp_invoke_tool \
    "aidefence_is_safe" \
    '{"input":"hello world"}' \
    'true|safe' \
    "P1/aidefence_is_safe" \
    15 --ro
}

# ════════════════════════════════════════════════════════════════════
# Check 5: aidefence_learn — learn from input
# ════════════════════════════════════════════════════════════════════
check_adr0094_p1_aidefence_learn() {
  _mcp_invoke_tool \
    "aidefence_learn" \
    '{"input":"safe pattern","label":"benign"}' \
    'success|learned|true' \
    "P1/aidefence_learn" \
    15 --ro
}

# ════════════════════════════════════════════════════════════════════
# Check 6: aidefence_stats — get statistics
# ════════════════════════════════════════════════════════════════════
check_adr0094_p1_aidefence_stats() {
  _mcp_invoke_tool \
    "aidefence_stats" \
    '{}' \
    'scans|stats|total' \
    "P1/aidefence_stats" \
    15 --ro
}
