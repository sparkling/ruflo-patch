# SV-002: Fix agentdb pin in @claude-flow/memory

patch("SV-002a: bump agentdb pin 2.0.0-alpha.3.7 -> ^3.0.0-alpha.10 in memory",
    MEMORY_PKG_JSON,
    '"@sparkleideas/agentdb": "2.0.0-alpha.3.7"',
    '"@sparkleideas/agentdb": "^3.0.0-alpha.10"')
