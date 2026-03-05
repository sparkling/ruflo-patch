# FB-002: Instrument local helper fallback code paths with debug logging

**Severity**: Enhancement

## Root Cause
Local helper files (intelligence.cjs, auto-memory-hook.mjs, learning-service.mjs, hook-handler.cjs)
have silent fallback paths that swallow errors with empty catch blocks or fall through without
any diagnostic output, making it impossible to diagnose why features degrade silently.

## Fix
Add `console.warn('[RUFLO-FALLBACK] FB-002-XX: ...')` instrumentation to every silent
fallback path in the four helper files. Patches both the upstream copy (SRC_* paths in
the npx cache) and the local project copy.

## Files Patched
- .claude/helpers/intelligence.cjs (upstream + local)
- .claude/helpers/auto-memory-hook.mjs (upstream + local)
- .claude/helpers/learning-service.mjs (upstream + local)
- .claude/helpers/hook-handler.cjs (upstream + local)

## ADR

[ADR-0002](../../docs/adr/0002-fallback-instrumentation.md)

## Ops
16 ops in fix.py
