# ADR-0059: RVF Native Storage Backend

- **Status**: Proposed (decision finalised, not yet implemented)
- **Date**: 2026-04-03
- **Updated**: 2026-04-04 (v12 — clean rewrite from 11 iterations)
- **Deciders**: ruflo-patch maintainers
- **Methodology**: SPARC + multi-agent swarm analysis (8 hives, 30+ experts)

## Architecture

Two stores, one bridge, zero in-process reconciliation.

```
Hook → RvfBackend → .swarm/agentdb-memory.rvf  (vectors/KV, atomic persist)
CLI  → memory-bridge → .swarm/memory.db         (relational, 24 tables, full AgentDB)
Both → AutoMemoryBridge → MEMORY.md              (session-boundary reconciliation)
```

| Store | File | Owner | Format | Purpose |
|-------|------|-------|--------|---------|
| Hook store | `.swarm/agentdb-memory.rvf` | Hook subprocess | RVF binary | Fast vector/KV writes during session |
| CLI store | `.swarm/memory.db` | CLI/MCP | SQLite | Relational data, controllers, embeddings |
| Reconciliation | `MEMORY.md` + topic files | AutoMemoryBridge | Markdown | Session-boundary sync, human-readable |
| Session cache | `.claude-flow/data/*.json` | CJS intelligence | JSON | Intra-session PageRank/context (ephemeral) |

This is the upstream-intended architecture per upstream-ruflo:ADR-048 (auto-memory bridge), upstream-ruflo:ADR-057 (RVF for vectors), and upstream-agentic:ADR-057 ("Full SQLite + RuVector").

> **Two `RvfBackend` classes exist.** The `@claude-flow/memory` version (pure-TS, `IMemoryBackend`) is used here. The `agentdb` version (N-API/WASM wrapper) is a different class in a different package. All references below mean the memory-package version.

## Problem

`auto-memory-hook.mjs` `createBackend()` instantiates `AgentDBBackend`, which does `import('@sparkleideas/agentdb')` — a cross-package dynamic import that fails silently in the hook subprocess. Data writes to an in-memory `Map`, lost on process exit. The `.rvf` file is never created. The session-boundary drain (upstream-ruflo:ADR-048) has never worked.

### Root Cause Chain

1. `AgentDBBackend.initialize()` calls `import('@sparkleideas/agentdb')` (line ~51)
2. `@sparkleideas/agentdb` is NOT a dependency of `@sparkleideas/memory` — the import resolves from the caller's module graph
3. In the hook subprocess, `@sparkleideas/agentdb` is not installed → import fails
4. Empty `catch` block silently swallows the error (line ~53)
5. `AgentDBBackend` sets `this.available = false`, continues with in-memory `Map`
6. Every `store()` call writes to RAM → process exits → data evaporates
7. `.swarm/agentdb-memory.rvf` is never created → drain is a no-op

### Why Not Fix AgentDBBackend?

Investigated thoroughly (8 expert analyses). Three independent problems:

| Problem | Fix AgentDBBackend? | Swap to RvfBackend? |
|---------|--------------------|--------------------|
| Cross-package import fails | Would need `agentdb` as dep (18MB sql.js in 50ms hook) | RvfBackend is in same package — no cross-package import |
| `dbPath` defaults to `':memory:'` | One-line fix, but hook already passes a real path | N/A — RvfBackend always writes to file |
| Silent degradation (catch swallows error) | Could throw, but caller also swallows | N/A — RvfBackend never degrades |

Even if all three were fixed, `AgentDBBackend` would pull in 18MB sql.js + embeddings + 44 controllers for 5 basic `IMemoryBackend` calls (`initialize`, `shutdown`, `count`, `bulkInsert`, `query`). The hook never calls `getAgentDB()`, `getController()`, or any AgentDB-specific method. `AgentDBBackend` was chosen because it was the only `IMemoryBackend` at the time, not for its features.

### Why the Two Stores Are Intentionally Separate

- **RVF has no file-level locking** — two processes sharing one `.rvf` file corrupt each other
- **SQLite WAL handles concurrent readers** — but 18MB sql.js in a 50ms hook budget is unacceptable
- **MEMORY.md is the designed reconciliation layer** — curated at session-end, imported at session-start
- **The stores were ALWAYS separate** — `AgentDBBackend` writes to `.swarm/agentdb-memory.rvf`, CLI reads `.swarm/memory.db`. The swap doesn't create a new split; it makes the existing one work.

## Decision

Swap `AgentDBBackend` for `RvfBackend` in `auto-memory-hook.mjs` `createBackend()`.

`RvfBackend` from `@sparkleideas/memory`:
- Implements full `IMemoryBackend` interface (17 methods) — drop-in replacement
- Lives in the same package — no cross-package import
- String IDs safe (`Map<string, MemoryEntry>` — no `Number()` coercion)
- Atomic persist (write-tmp + rename) — crash-safe
- Creates `.rvf` file on first flush — never throws on missing path
- Zero native dependencies — pure-TS `HnswLite` fallback
- Exported from `@sparkleideas/memory` (`index.ts` lines 196-197)

### Exact Code Change

File: `.claude/helpers/auto-memory-hook.mjs`, function `createBackend()` (~line 236)

```javascript
// BEFORE (broken — AgentDBBackend silently degrades to in-memory):
if (!memPkg.AgentDBBackend) {
  throw new Error('Memory backend requires AgentDBBackend...');
}
const backend = new memPkg.AgentDBBackend({
  dbPath: join(swarmDir, 'agentdb-memory.rvf'),
  vectorBackend: config.agentdb.vectorBackend || 'auto',
  enableLearning: config.agentdb.enableLearning !== false,
});
return { backend };

// AFTER (correct — RvfBackend persists atomically):
if (memPkg.RvfBackend) {
  const backend = new memPkg.RvfBackend({
    databasePath: join(swarmDir, 'agentdb-memory.rvf'),
  });
  return { backend };
}
// Fallback: AgentDBBackend (heavier but functional if agentdb is installed)
if (memPkg.AgentDBBackend) {
  const backend = new memPkg.AgentDBBackend({
    dbPath: join(swarmDir, 'agentdb-memory.rvf'),
  });
  return { backend };
}
throw new Error(
  'Memory backend requires RvfBackend or AgentDBBackend.\n' +
  'Fix: set "memory.backend": "json" in .claude-flow/config.json'
);
```

> **Verify before implementing**: confirm `RvfBackend` constructor parameter is `databasePath` by checking `@claude-flow/memory/src/rvf-backend.ts` constructor signature.

### Acceptance Criteria

1. After `doImport()`: `.swarm/agentdb-memory.rvf` exists on disk with size > 0
2. After `doSync()`: entries persist (re-read returns stored data)
3. Entries survive process restart
4. `npm run test:unit` passes (539/539)
5. `npm run deploy` passes (57/57 acceptance)
6. Hook subprocess does not load sql.js (no 18MB WASM overhead)

## Execution Plan

### Phase Independence (Confirmed)

Phase 1 and Phase 2 operate on **independent data paths** and can ship in any order:

```
Path A (CJS):  auto-memory-store.json → intelligence.cjs → ranked-context.json
Path B (ESM):  MEMORY.md → AutoMemoryBridge → RvfBackend → .rvf → MEMORY.md
```

Phase 1 fixes Path B (drain). Phase 2 fixes Path A (CJS cache). They never cross. The 4,482 duplicate entries in `auto-memory-store.json` cannot enter the `.rvf` file — `importFromAutoMemory()` reads only MEMORY.md topic files and has a content-hash dedup guard (line 405 of `auto-memory-bridge.ts`).

### Phases

| Order | Phase | What | Lines | Scope | Upstream PR? |
|-------|-------|------|-------|-------|-------------|
| 1 | **Phase 1** | Swap AgentDBBackend → RvfBackend in `createBackend()` | ~15 | Patch + upstream | Yes — see below |
| 2 | **Phase 2** | Fix CJS bugs: ID collision, ML-006 scope, `tool_input` snake_case | ~25 | Patch + upstream | Yes (separate PRs) |
| 3 | **Phase 3** | Wire MCP server to also query `.rvf` — unified search | ~200 | Fork-level | Yes (separate PR) |
| 4 | **Future** | Daemon IPC: hooks call Unix domain socket, daemon owns stores | ~265 | New feature | Yes |
| 5 | **Future** | Converge CLI onto RVF for vectors (upstream-ruflo:ADR-057) | TBD | Upstream | N/A |

### Why Not Skip to Daemon?

Investigated as a serious candidate (4-expert hive). Findings:

- **Daemon has no IPC API today** — ~265 lines across 4 files to build (Unix socket server, route handler, hook client, fallback)
- **Daemon must be running before hooks fire** — if it's down, data loss returns. Fallback needed → that fallback IS Phase 1's RvfBackend
- **Phase 1 is prerequisite work for the daemon** — you need real persisted data to validate the daemon's API design against
- **Phase 1 is not throwaway work** — it becomes the daemon's offline fallback permanently

The daemon is the right **long-term** architecture (single writer, no reconciliation). But it's additive to Phase 1, not a replacement.

### Phase 3 Note

The intended MCP integration point (`db-unified.ts`) may have been renamed to `database-provider.ts`. Path must be confirmed before Phase 3 can be specified.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `RvfBackend` not exported from `@sparkleideas/memory` | High | Verify export at `index.ts:196-197`; add if missing |
| Constructor parameter name mismatch | Medium | Verify against source before implementing |
| Stale empty `.rvf` from prior broken runs | Low | `RvfBackend.loadFromDisk()` handles missing/empty files gracefully |
| `HnswLite` performance vs native HNSW | Low | Acceptable for hook use case (sub-5K entries) |

## Upstream Issue (Ready to File)

**Title**: `fix: auto-memory hook silently drops all session data — swap AgentDBBackend for RvfBackend`

**Labels**: `bug`, `memory`, `hooks`

<details>
<summary>Full issue body (click to expand)</summary>

## Summary

Every session's hook-written memory is silently discarded. `createBackend()` in `auto-memory-hook.mjs` instantiates `AgentDBBackend`, which does a cross-package `import('@claude-flow/agentdb')`. This import fails silently in the hook subprocess because `@claude-flow/agentdb` is not a dependency of `@claude-flow/memory`. The backend degrades to an in-memory `Map` — data writes succeed but are lost on process exit. The `.rvf` file is never created.

## Steps to Reproduce

1. Run a Claude Code session with hooks enabled
2. After session ends, check: `ls -la .swarm/agentdb-memory.rvf` — file does not exist
3. Run `memory search` for any term — no results from hook-written data
4. Repeat across sessions — the hook store never grows

## Expected Behavior

`.swarm/agentdb-memory.rvf` is created on first session and grows as hooks write entries. `syncToAutoMemory()` at session-end curates entries into MEMORY.md.

## Actual Behavior

`.swarm/agentdb-memory.rvf` is never created. All hook-written entries exist only in RAM, lost on process exit. The session-boundary drain (ADR-048) is a no-op.

## Root Cause

`AgentDBBackend.initialize()` (line ~51) calls `import('@claude-flow/agentdb')`. This package is not a dependency of `@claude-flow/memory`. The import fails. The error is caught silently (empty `catch`). The backend operates against an in-memory `Map` with no indication of failure.

## Fix

`RvfBackend` ships in `@claude-flow/memory` itself — same package, no cross-package import. It implements the identical `IMemoryBackend` interface and writes atomically to `.rvf` files with zero native dependencies.

```javascript
// Before (broken):
const backend = new memPkg.AgentDBBackend({ dbPath: join(swarmDir, 'agentdb-memory.rvf') });

// After (correct):
const backend = new memPkg.RvfBackend({ databasePath: join(swarmDir, 'agentdb-memory.rvf') });
```

`AgentDBBackend` is preserved as a fallback for environments where `RvfBackend` is not yet exported.

## Why RvfBackend, Not a Fixed AgentDBBackend

- Same package — no cross-package dynamic import
- Pure-TS `HnswLite` — no 18MB sql.js in a 50ms hook subprocess
- The hook calls only 5 `IMemoryBackend` methods — no need for 44 controllers
- The `.rvf` file path is already what the hook passes — `RvfBackend` handles it natively

## Impact

Silent data loss on every session. No warning emitted. `.rvf` file never written.

## Acceptance Criteria

1. `.swarm/agentdb-memory.rvf` created on first session
2. Entries survive process restart
3. Hook subprocess does not load sql.js

## Related

- ADR-048: auto-memory bridge design
- ADR-057: RVF storage specification

**File changed**: `.claude/helpers/auto-memory-hook.mjs` — `createBackend()`, ~10 lines.

</details>

## Upstream PR (Ready to File)

**Title**: `fix: swap AgentDBBackend for RvfBackend in auto-memory-hook session bridge`

<details>
<summary>Full PR body (click to expand)</summary>

## Issue

Fixes #XXXX (the issue filed above)

## Summary

- Swap `AgentDBBackend` → `RvfBackend` in `createBackend()` — data persists to `.rvf` file
- Preserve `AgentDBBackend` as fallback for older package versions
- Preserve `JsonFileBackend` as last-resort fallback

## Root Cause

`AgentDBBackend` does `import('@claude-flow/agentdb')` — a cross-package import that fails silently in the hook subprocess. Data writes to RAM, lost on exit. See issue for full chain.

## Change

One function (`createBackend`), ~15 lines. `RvfBackend` tried first (same package, atomic persist, zero native deps). Falls back to `AgentDBBackend` then `JsonFileBackend`.

## Test Plan

- [ ] After `doImport()`: `.swarm/agentdb-memory.rvf` exists on disk
- [ ] Entries survive process restart
- [ ] `npm test` passes
- [ ] Hook subprocess does not load sql.js

## Backward Compatibility

Existing `.swarm/memory.db` files untouched. Fallback chain ensures older installations work.

Generated with [claude-flow](https://github.com/ruvnet/claude-flow)

</details>

## All Session Fixes (Cross-Reference)

### Upstream PRs Filed (ruvnet/ruflo)

| PR | Issue | Description |
|----|-------|-------------|
| [#1512](https://github.com/ruvnet/ruflo/pull/1512) | [#1511](https://github.com/ruvnet/ruflo/issues/1511) | CLAUDE.md generator: Task→Agent, MCP discovery, hook signals |
| [#1517](https://github.com/ruvnet/ruflo/pull/1517) | [#1516](https://github.com/ruvnet/ruflo/issues/1516) | Bare model names → Xenova/ prefix + ControllerRegistry config |
| [#1519](https://github.com/ruvnet/ruflo/pull/1519) | [#1518](https://github.com/ruvnet/ruflo/issues/1518) | intelligence.cjs dedup (194MB→79KB) |

### Fork Commits In Place (ruflo)

| Commit | Description |
|--------|-------------|
| `ad4fc39ba` + `1f83c817a` | CLAUDE.md generator rewrite (CM-001) |
| `72e7305eb` + `639aa3701` | Portable defaults + dynamic memory ceiling |
| `243386a25` + `d7654639b` + `0a5697b20` | Xenova/ prefix + ControllerRegistry embedding config |
| `7f4b7064d` | Remove memory-initializer prefix band-aid |
| `dc179d605` | intelligence.cjs dedup guard |
| `a50ff5c35` | Benchmark-validated config defaults |

### Pipeline Fixes (ruflo-patch)

Portable `_timeout`, `sed -i` fix, `config.yaml` acceptance, causal tool names, `init-config-vals` test, node 24, ONNX cache seeding, `@sparkleideas/ruvector` publishing, run_timed 120s timeout.

## Related ADRs

- **ADR-0058**: Memory, Learning & Storage Deep Analysis — root cause investigation
- **ADR-0056**: MCP Server Unified Backend — future Phase 3
- **upstream-ruflo:ADR-048**: Auto-memory bridge design (session-boundary drain)
- **upstream-ruflo:ADR-057**: RVF replaces sql.js for vectors/KV in @claude-flow/memory
- **upstream-agentic:ADR-057**: "Full SQLite + RuVector" for AgentDB relational tables

<details>
<summary>Version History (archived — 11 iterations during 2026-04-03/04 session)</summary>

See `ADR-0059-rvf-native-storage-backend.v11-archive.md` for the full deliberation
trail across 11 versions and 8 expert hives. Key decision points:

- v1-v4: Initial design, upstream code audit, agentic-flow deep search
- v5-v6: RvfBackend vs fix AgentDBBackend — both options documented fairly
- v7: Decision locked (Option A: RvfBackend) with unanimous expert consensus
- v8: Decision challenged — "can't we just fix agentdb?" — import topology investigated
- v9: "Shared store is a phantom" — the two files were ALWAYS separate
- v10: Final architecture confirmed — two stores, one bridge, zero reconciliation
- v11: Full session audit — zero reversals needed across all repos

</details>
