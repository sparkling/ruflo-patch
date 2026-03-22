# Dependency Analysis: @claude-flow/memory → agentdb v2/v3

## Date: 2026-02-27

## Key Discovery: Unpublished ControllerRegistry

The upstream repo (`ruvnet/claude-flow`) has a critical commit (`f6c4f5c`, Feb 26) that was **never published to npm**:

### What's in the commit (ADR-053)
- `controller-registry.ts` — 728 lines, the `ControllerRegistry` class that `memory-bridge.js` expects
- `controller-registry.test.ts` — 776 lines of tests
- `package.json` change: `agentdb: "2.0.0-alpha.3.7"` → `agentdb: "^3.0.0-alpha.7"`
- `index.ts` adds `export { ControllerRegistry, INIT_LEVELS }`
- `agentdb-backend.ts` +17 lines, `hybrid-backend.ts` +66 lines

### ControllerRegistry API (matches memory-bridge.js expectations)
- `.initialize(config)` — level-based controller ordering
- `.get(name)` — named controller lookup (reasoningBank, causalGraph, etc.)
- `.register(name, instance)` — dynamic registration
- `.getAgentDB()` — underlying AgentDB access
- `.listControllers()` — introspection
- `.shutdown()` — graceful teardown

### Timeline
- Feb 16: alpha.11 published (agentdb v2, no ControllerRegistry)
- Feb 16: "Fix npm 11 install crash: pin agentdb to 2.0.0-alpha.3.7"
- Feb 26: ADR-053 commit adds ControllerRegistry, bumps to agentdb ^3.0.0-alpha.7
- Feb 27: NEVER PUBLISHED to npm

## Three Problems Identified

### Problem 1: agentdb v2 dependency resolution
- `@claude-flow/memory@3.0.0-alpha.11` on npm depends on `agentdb@2.0.0-alpha.3.7` (v2)
- npm correctly installs v2 and ruvllm 0.2.4
- WM-008 fix.sh replaces agentdb files with v3 but doesn't update transitive deps
- **Patching memory package alone doesn't fix this** — npm lock file already resolved

### Problem 2: ControllerRegistry doesn't exist (in published version)
- `memory-bridge.js` imports `{ ControllerRegistry }` from `@claude-flow/memory`
- Published alpha.11 doesn't export it → bridge is dead code
- Unpublished upstream commit adds it → would bring bridge to life

### Problem 3: ruvllm 0.2.4 at top level
- Transitive dep from agentdb v2
- Broken ESM: `export * from './types'` missing .js extension
- ADR-040 symlink handles this as a band-aid

## Two Parallel Memory Paths in CLI

| Path | How it works | Status |
|------|-------------|--------|
| Bridge (`memory-bridge.js`) | `ControllerRegistry` → AgentDB v3 controllers | **Dead** — ControllerRegistry missing |
| Direct (`memory-initializer.js`) | `HybridBackend` → `AgentDBBackend` → bare `import('agentdb')` | **Alive** — patched by WM-008 |

Our 67 WM patches wire v3 controllers directly into CLI handlers, bypassing the dead bridge.

## Architectural Direction

The bridge path is clearly upstream's intended architecture (ADR-053). If we continue expanding direct-wiring patches, we'll increasingly diverge from upstream, making future syncs harder.

## All Published @claude-flow/memory Versions

| Version | Date | agentdb dep |
|---------|------|-------------|
| 3.0.0-alpha.1 | 2026-01-06 | (unknown) |
| 3.0.0-alpha.2 | 2026-01-06 | (unknown) |
| 3.0.0-alpha.7 | 2026-02-08 | (unknown) |
| 3.0.0-alpha.8 | 2026-02-08 | (unknown) |
| 3.0.0-alpha.9 | 2026-02-11 | 2.0.0-alpha.3.5 |
| 3.0.0-alpha.10 | 2026-02-12 | 2.0.0-alpha.3.6 |
| 3.0.0-alpha.11 | 2026-02-16 | 2.0.0-alpha.3.7 |

Every published version depends on agentdb v2. The v3 upgrade only exists in the unpublished commit.

## Package Upgrade Summary

| Package | Installed | Latest | Action |
|---------|-----------|--------|--------|
| @claude-flow/cli | 3.1.0-alpha.52 | 3.1.0-alpha.54 | Safe upgrade |
| @claude-flow/memory | 3.0.0-alpha.11 | 3.0.0-alpha.11 | Only version; critical unpublished commit exists |
| agentdb | 3.0.0-alpha.3 (via WM-008) | 3.0.0-alpha.9 | Hold — breaking changes (drops ruvllm, RVF, better-sqlite3) |
| @ruvector/ruvllm | 2.5.1 (via ADR-040 dedup) | 2.5.1 | Current |
| better-sqlite3 | 11.10.0 | 12.6.2 | Hold — major native addon bump |

## Related Files
- `docs/adr/ADR-039-fail-loud-agentdb-v3-resolution.md`
- `docs/adr/ADR-040-dedup-ruvllm-hoisting-fix.md`
- `patch/560-WM-008-agentdb-v3-upgrade/fix.sh`
- `tests/helpers/integration-setup.mjs` (findAgentDBv3Path, resolveAgentDBv3)
- `tests/helpers/cache-lifecycle.mjs` (findWorkingRuvllm, ensureTestCache)
