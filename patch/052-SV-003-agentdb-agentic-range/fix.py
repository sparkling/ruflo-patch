# SV-003: Fix agentdb range in agentic-flow

patch("SV-003a: bump agentdb range ^2.0.0-alpha.2.20 -> ^3.0.0-alpha.10 in agentic-flow",
    AGENTIC_FLOW_PKG_JSON,
    '"@claude-flow-patch/agentdb": "^2.0.0-alpha.2.20"',
    '"@claude-flow-patch/agentdb": "^3.0.0-alpha.10"')
