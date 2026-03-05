# SV-001: Fix @ruvector/ruvllm semver range in agentic-flow

**Severity**: Critical

## Root Cause
agentic-flow specifies `"@ruvector/ruvllm": "^0.2.3"` but npm latest is `2.5.1`.
Caret `^0.2.3` only matches `>=0.2.3 <0.3.0` and cannot resolve `2.5.1`.

## Fix
Replace `"@ruvector/ruvllm": "^0.2.3"` with `"@ruvector/ruvllm": "^2.5.1"` in
the agentic-flow package.json (post-codemod: `@claude-flow-patch/agentic-flow`).

## Files Patched
- agentic-flow/package.json

## Ops
1 op in fix.py
