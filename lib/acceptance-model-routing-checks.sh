#!/usr/bin/env bash
# lib/acceptance-model-routing-checks.sh — ADR-0094 Phase 6: Model routing
# MCP tool acceptance checks (3 tools).
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
#           (_mcp_invoke_tool, _cli_cmd available)
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG
#
# Tools: hooks_model-route, hooks_model-outcome, hooks_model-stats
# Three-way bucket enforced by _mcp_invoke_tool (ADR-0094 Sprint 0 WI-3).

# ════════════════════════════════════════════════════════════════════
# Individual model routing tool checks
# ════════════════════════════════════════════════════════════════════

check_adr0094_p6_model_route() {
  _mcp_invoke_tool \
    "hooks_model-route" \
    '{"task":"write unit test","complexity":0.5}' \
    'model|route|haiku|sonnet|opus|tier' \
    "P6-model/model-route" \
    15 --ro
}

check_adr0094_p6_model_outcome() {
  _mcp_invoke_tool \
    "hooks_model-outcome" \
    '{"taskId":"test","model":"haiku","success":true}' \
    'recorded|outcome|success' \
    "P6-model/model-outcome" \
    15 --ro
}

check_adr0094_p6_model_stats() {
  _mcp_invoke_tool \
    "hooks_model-stats" \
    '{}' \
    'stats|routes|models|count' \
    "P6-model/model-stats" \
    15 --ro
}
