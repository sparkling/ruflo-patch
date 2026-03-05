# SV-003: Fix agentdb range in agentic-flow

**Severity**: Critical

## Root Cause
agentic-flow specifies `"agentdb": "^2.0.0-alpha.2.20"` but npm latest is
`3.0.0-alpha.10`. The caret range cannot resolve across major versions.

## Fix
Replace `"@sparkleideas/agentdb": "^2.0.0-alpha.2.20"` with
`"@sparkleideas/agentdb": "^3.0.0-alpha.10"` in the agentic-flow package.json
(post-codemod target).

## Files Patched
- agentic-flow/package.json (post-codemod: @sparkleideas/agentic-flow)

## Ops
1 op in fix.py
