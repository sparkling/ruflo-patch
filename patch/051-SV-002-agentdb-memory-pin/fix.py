# SV-002: Fix agentdb pin in @claude-flow/memory
#
# Original upstream has "agentdb": "2.0.0-alpha.3.7" which doesn't exist.
# After codemod scope-rename + wildcard replacement, this becomes
# "@sparkleideas/agentdb": "*". We pin to a known-good range.

patch("SV-002a: pin agentdb range * -> ^3.0.0-alpha.10 in memory",
    MEMORY_PKG_JSON,
    '"@sparkleideas/agentdb": "*"',
    '"@sparkleideas/agentdb": "^3.0.0-alpha.10"')
