#!/usr/bin/env bash
# lib/acceptance-coordination-checks.sh — ADR-0094 Phase 3: Coordination MCP tools
#
# Acceptance checks for the 7 coordination_* MCP tools. Each check invokes
# the tool via the canonical `_mcp_invoke_tool` helper from
# acceptance-harness.sh (ADR-0094 Sprint 0 WI-3 — no per-domain drift).
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
#           (_mcp_invoke_tool, _cli_cmd, _e2e_isolate available)
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG

# ════════════════════════════════════════════════════════════════════
# Check 1: coordination_consensus — propose and gather votes
# ════════════════════════════════════════════════════════════════════
check_adr0094_p3_coordination_consensus() {
  _mcp_invoke_tool \
    "coordination_consensus" \
    '{"proposal":"test"}' \
    'consensus|result|vote' \
    "P3/coordination_consensus" \
    15 --ro
}

# ════════════════════════════════════════════════════════════════════
# Check 2: coordination_load_balance — distribute load across agents
# ════════════════════════════════════════════════════════════════════
check_adr0094_p3_coordination_load_balance() {
  _mcp_invoke_tool \
    "coordination_load_balance" \
    '{}' \
    'balance|load|distribution|agents' \
    "P3/coordination_load_balance" \
    15 --ro
}

# ════════════════════════════════════════════════════════════════════
# Check 3: coordination_node — node status query
# ════════════════════════════════════════════════════════════════════
check_adr0094_p3_coordination_node() {
  _mcp_invoke_tool \
    "coordination_node" \
    '{"action":"status"}' \
    'node|status|id' \
    "P3/coordination_node" \
    15 --ro
}

# ════════════════════════════════════════════════════════════════════
# Check 4: coordination_orchestrate — orchestrate a task
# ════════════════════════════════════════════════════════════════════
check_adr0094_p3_coordination_orchestrate() {
  _mcp_invoke_tool \
    "coordination_orchestrate" \
    '{"task":"test orchestration"}' \
    'orchestrat|plan|agents' \
    "P3/coordination_orchestrate" \
    15 --ro
}

# ════════════════════════════════════════════════════════════════════
# Check 5: coordination_sync — synchronize state
# ════════════════════════════════════════════════════════════════════
check_adr0094_p3_coordination_sync() {
  _mcp_invoke_tool \
    "coordination_sync" \
    '{}' \
    'sync|synchronized|state' \
    "P3/coordination_sync" \
    15 --ro
}

# ════════════════════════════════════════════════════════════════════
# Check 6: coordination_topology — query topology
# ════════════════════════════════════════════════════════════════════
check_adr0094_p3_coordination_topology() {
  _mcp_invoke_tool \
    "coordination_topology" \
    '{}' \
    'topology|nodes|connections|mesh' \
    "P3/coordination_topology" \
    15 --ro
}

# ════════════════════════════════════════════════════════════════════
# Check 7: coordination_metrics — query coordination metrics
# ════════════════════════════════════════════════════════════════════
check_adr0094_p3_coordination_metrics() {
  _mcp_invoke_tool \
    "coordination_metrics" \
    '{}' \
    'metrics|latency|throughput|count' \
    "P3/coordination_metrics" \
    15 --ro
}
