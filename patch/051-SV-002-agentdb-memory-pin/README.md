# SV-002: Fix agentdb pin in @claude-flow/memory

**Severity**: Critical

## Root Cause
@claude-flow/memory pins `"agentdb": "2.0.0-alpha.3.7"` which does not exist on npm.
The current npm latest is `3.0.0-alpha.10`.

## Fix
Replace the exact pin with `"@claude-flow-patch/agentdb": "^3.0.0-alpha.10"` in
the memory package.json (post-codemod target).

## Files Patched
- @claude-flow/memory/package.json (post-codemod: @claude-flow-patch/memory)

## Ops
1 op in fix.py
