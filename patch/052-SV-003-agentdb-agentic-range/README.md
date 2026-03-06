# SV-003: Fix agentdb range in agentic-flow

**Severity**: Critical

## Root Cause
agentic-flow specifies `"agentdb": "^2.0.0-alpha.2.20"` but npm latest is
`3.0.0-alpha.10`. The caret range cannot resolve across major versions.
The codemod replaces with `"*"`, but we want a specific range.

## Fix
Replace `"@sparkleideas/agentdb": "*"` (post-codemod) with
`"@sparkleideas/agentdb": "^3.0.0-alpha.10"` to pin to a known-good version range.

## Pipeline Order
1. Codemod renames `@claude-flow/agentdb` → `@sparkleideas/agentdb` and sets range to `"*"`
2. This patch narrows `"*"` → `"^3.0.0-alpha.10"`

## Files Patched
- agentic-flow/package.json (post-codemod: @sparkleideas/agentic-flow)

## Ops
1 op in fix.py
