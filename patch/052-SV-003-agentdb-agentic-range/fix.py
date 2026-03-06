# SV-003: Fix agentdb range in agentic-flow
#
# Original upstream has "agentdb": "^2.0.0-alpha.2.20" which can't resolve
# across major versions. After codemod scope-rename + wildcard replacement,
# this becomes "@sparkleideas/agentdb": "*". We pin to a known-good range.

patch("SV-003a: pin agentdb range * -> ^3.0.0-alpha.10 in agentic-flow",
    AGENTIC_FLOW_PKG_JSON,
    '"@sparkleideas/agentdb": "*"',
    '"@sparkleideas/agentdb": "^3.0.0-alpha.10"')
