# SG-003: Init missing helpers for --dual, --minimal, hooks, and upgrade paths

**Severity**: Critical
**Ported from**: claude-flow-patch (270-SG-003-init-helpers-all-paths)

## Root Cause

Multiple `init` code paths generate `settings.json` (which references `hook-handler.cjs`,
`auto-memory-hook.mjs`, `statusline.cjs`) without generating the helper files those hooks need.

| Path | Generates settings? | Generates helpers? | Result |
|------|--------------------|--------------------|--------|
| `init` (default) | YES | YES | OK |
| `init --dual` | NO (bypasses executeInit) | NO | Broken: no Claude infra despite CLAUDE.md |
| `init --minimal` | YES | NO (helpers: false) | Broken: dangling settings refs |
| `init hooks` | YES | NO (helpers: false) | Broken: dangling settings refs |
| `init upgrade` | Only with --settings | Partial (3 of 8) | Broken: missing router/session/memory |
| `init wizard` | YES | YES (default) | OK |

## Fix

4 ops across 2 files:

1. **init.js** — After `--dual` codex init succeeds, call `executeInit()` with
   all components so full Claude Code infrastructure is created.
2. **executor.js** — When `settings` is generated but `helpers` is not, also generate
   the critical helpers that `settings.json` references (fixes `--minimal` and `init hooks`).
3. **executor.js** — Fix `executeUpgrade()` fallback to use `intelligenceContent` instead
   of `generateIntelligenceStub()`.
4. **init.js** — Transition op: update `--dual` components from `skills: false` to `true`.

## Files Patched

- `commands/init.js`
- `init/executor.js`
