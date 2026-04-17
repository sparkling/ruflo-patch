#!/usr/bin/env bash
# lib/acceptance-hooks-lifecycle-checks.sh — ADR-0094 Phase 6: Hooks lifecycle
# MCP tool acceptance checks (8 tools).
#
# Requires: acceptance-harness.sh + acceptance-checks.sh sourced first
#           (_mcp_invoke_tool, _cli_cmd available)
# Caller MUST set: E2E_DIR, TEMP_DIR, REGISTRY, PKG
#
# Tools: hooks_pre-task, hooks_post-task, hooks_pre-edit, hooks_post-edit,
#        hooks_pre-command, hooks_post-command, hooks_session-start,
#        hooks_session-end
#
# Three-way bucket (ADR-0090 Tier A2): pass / fail / skip_accepted — enforced
# by _mcp_invoke_tool in the harness (ADR-0094 Sprint 0 WI-3). No per-domain
# drift.

# ════════════════════════════════════════════════════════════════════
# Individual hook tool checks
# ════════════════════════════════════════════════════════════════════

check_adr0094_p6_hooks_pre_task() {
  _mcp_invoke_tool \
    "hooks_pre-task" \
    '{"description":"test task"}' \
    'risk|assessment|pre-task|success' \
    "P6-hooks/pre-task" \
    15 --ro
}

check_adr0094_p6_hooks_post_task() {
  _mcp_invoke_tool \
    "hooks_post-task" \
    '{"taskId":"test-1","success":true}' \
    'recorded|learning|post-task|success' \
    "P6-hooks/post-task" \
    15 --ro
}

check_adr0094_p6_hooks_pre_edit() {
  _mcp_invoke_tool \
    "hooks_pre-edit" \
    '{"file":"test.js","description":"edit"}' \
    'pre-edit|analysis|success' \
    "P6-hooks/pre-edit" \
    15 --ro
}

check_adr0094_p6_hooks_post_edit() {
  _mcp_invoke_tool \
    "hooks_post-edit" \
    '{"file":"test.js","success":true}' \
    'post-edit|recorded|success' \
    "P6-hooks/post-edit" \
    15 --ro
}

check_adr0094_p6_hooks_pre_command() {
  _mcp_invoke_tool \
    "hooks_pre-command" \
    '{"command":"test"}' \
    'pre-command|allowed|success' \
    "P6-hooks/pre-command" \
    15 --ro
}

check_adr0094_p6_hooks_post_command() {
  _mcp_invoke_tool \
    "hooks_post-command" \
    '{"command":"test","exitCode":0}' \
    'post-command|recorded|success' \
    "P6-hooks/post-command" \
    15 --ro
}

check_adr0094_p6_hooks_session_start() {
  _mcp_invoke_tool \
    "hooks_session-start" \
    '{}' \
    'session|started|success' \
    "P6-hooks/session-start" \
    15 --ro
}

check_adr0094_p6_hooks_session_end() {
  _mcp_invoke_tool \
    "hooks_session-end" \
    '{}' \
    'session|ended|saved|success' \
    "P6-hooks/session-end" \
    15 --ro
}
