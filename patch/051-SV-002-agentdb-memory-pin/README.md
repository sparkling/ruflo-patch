# SV-002: Fix agentdb pin in @claude-flow/memory

**Severity**: Critical

## Root Cause
@claude-flow/memory pins `"agentdb": "2.0.0-alpha.3.7"` which does not exist on npm.
The codemod scope-renames and replaces with `"*"`, but we want a specific range.

## Fix
Replace `"@sparkleideas/agentdb": "*"` (post-codemod) with
`"@sparkleideas/agentdb": "^3.0.0-alpha.10"` to pin to a known-good version range.

## Pipeline Order
1. Codemod renames `@claude-flow/agentdb` → `@sparkleideas/agentdb` and sets range to `"*"`
2. This patch narrows `"*"` → `"^3.0.0-alpha.10"`

## Files Patched
- @claude-flow/memory/package.json (post-codemod: @sparkleideas/memory)

## Ops
1 op in fix.py
