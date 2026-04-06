# ADR-0073: RVF Storage Backend Upgrade — WAL Write Path, Rust HNSW, Native Activation

- **Status**: Implemented (Phases 1-3)
- **Date**: 2026-04-06
- **Extracted from**: ADR-0069 F2 (RVF as Single Storage Format)
- **Depends on**: ADR-0068 (config chain), ADR-0069 F1 (AgentDBService delegation)
- **Analysis**: 6-agent hive council (queen + 5 specialists), verified against source code

## Context

ADR-0069 F2 envisioned "RVF as the single storage format" — replacing 6 storage formats with
RuVector's binary format. Analysis by a 6-agent hive council (queen "Meridian" + specialists in
Rust internals, storage/WAL, release/pipeline, benchmarking, and risk) found that the full
consolidation vision is multi-month scope, but three concrete improvements to the primary
storage backend deliver most of the value.

The primary storage backend is ruflo's `RvfBackend` (`@claude-flow/memory/src/rvf-backend.ts`,
532 lines). It is selected by default in `auto` mode (`database-provider.ts` lines 104-140)
and handles all `memory store` and `memory search` CLI operations.

### Current problems (verified against source)

1. **Write bottleneck**: `persistToDisk()` (lines 475-531) rewrites the ENTIRE file as JSON on
   every mutation. At 500 entries with 768-dim embeddings (~3KB each), that's ~1.5 MB rewritten
   per `memory store`. Format: `RVF\0` magic + JSON header + [4-byte length + JSON entry] repeated.
   Atomic via temp-file rename (crash-safe), but O(n) I/O per write.

2. **Native handle opened but unused**: `tryNativeInit()` (lines 374-397) attempts to import
   `@ruvector/rvf` and open a native handle, but never routes reads or writes through it. All
   operations go through the pure-TS path. Additionally, 4 API bugs prevent it from even
   initializing:
   - Wrong package name (`@ruvector/rvf` vs `@ruvector/rvf-node`)
   - Wrong constructor form (`new` vs `RvfDatabase.create`)
   - Wrong key name (`dimensions` vs `dimension`)
   - Wrong method pattern (`.open()` is static, not instance)

3. **Upstream HNSW disconnected from runtime**: `rvf-runtime/Cargo.toml` has zero dependency on
   `rvf-index`. `RvfStore.query()` is brute-force O(n) linear scan. HNSW params (`m`,
   `ef_construction`, `ef_search`) are accepted by NAPI bindings and silently ignored.
   `rvf-index` has a complete, tested HNSW (recall >= 0.95, 2,673 lines) that is simply not
   wired in.

### Why ordering matters

Enabling native RVF (fixing tryNativeInit) **before** wiring rvf-index into rvf-runtime makes
search **slower**: O(n) native brute-force replaces O(log n) pure-TS `HnswLite`. The phases
must be ordered correctly:

```
Phase 1 (WAL)  ──────────────────→  ships independently
Phase 2 (Rust HNSW patch)  ──→  Phase 3 (tryNativeInit fix)
```

### Two things called "RvfBackend"

| | ruflo `RvfBackend` | agentdb `RvfBackend` |
|---|---|---|
| Location | `@claude-flow/memory/src/rvf-backend.ts` | `agentdb/src/backends/rvf/RvfBackend.ts` |
| Interface | `IMemoryBackend` (17 methods, full MemoryEntry) | `VectorBackendAsync` (raw float vectors) |
| File format | Custom `RVF\0` + JSON header + JSON entries | Real `@ruvector/rvf` binary segments |
| HNSW | Pure-TS `HnswLite` (works, O(log n)) | Delegates to `@ruvector/rvf` (brute-force O(n)) |
| Native upgrade | `tryNativeInit()` opens handle but never routes reads/writes | Direct `@ruvector/rvf` delegation |
| Production role | **Primary backend** (default in `auto` mode) | Via `SelfLearningRvfBackend` controller |

Both classes are kept. Different interfaces, different purposes. This ADR targets the ruflo one.

## Decision

Implement F2 as three ordered phases targeting the ruflo `RvfBackend` only.

## Phase 1: WAL Write Path (pure TS, 1-2 days)

### What

Replace `persistToDisk()`'s full-file rewrite with append-only WAL.

### How

- New entries appended to `.wal` sidecar file (single-entry write, ~1ms)
- Periodic compaction merges WAL into main `.rvf` file (uses existing `persistToDisk()`)
- Read-through: search checks both main file and WAL entries (in-memory index covers both)
- Atomic rename for crash safety (existing pattern)
- Compaction trigger: entry count threshold or time interval (configurable)

### Expected impact

At 500 entries: `memory store` goes from ~50ms (full rewrite) to ~1ms (append).

### Dependencies

None. Pure TS, zero new packages.

### Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| WAL crash recovery | MEDIUM | Append is atomic per entry; compaction uses existing crash-safe `persistToDisk()` |
| Read-through complexity | LOW | In-memory `HnswLite` already indexes all entries regardless of on-disk layout |
| Compaction timing | LOW | Configurable; default conservative (compact every N writes or M seconds) |

### Tests required

- **Unit**: WAL append, read-through merge, compaction trigger, crash recovery (partial WAL)
- **Integration**: Store/search round-trip across WAL boundary, concurrent access
- **Acceptance**: `memory store` latency at 500+ entries (must be <5ms)

## Phase 2: rvf-index Rust Patch (fork patch in RuVector, 2-3 days)

### What

Wire `rvf-index` into `rvf-runtime` so native RVF queries use HNSW instead of brute-force.

### How

- Add `rvf-index` dependency to `rvf-runtime/Cargo.toml`
- Wire `RvfStore.query()` → `HnswGraph` (~200 lines Rust)
- Rebuild NAPI binaries via existing build pipeline (`build.rs` fix already in place)
- Queries go from O(n) brute-force to O(log n) HNSW (recall >= 0.95)
- Track as GitHub issue on sparkleideas RuVector fork

### Where

Fork patch in `/Users/henrik/source/forks/ruvector`. Picked up by `copy-source.sh` → codemod →
build → publish as `@sparkleideas/ruvector-rvf-node`.

### Dependencies

RuVector fork source. Existing NAPI build pipeline.

### Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Rust patch maintenance across upstream syncs | MEDIUM | One more patch in a repo maintaining patches in 4 forks. `sync` script handles merge conflicts. |
| NAPI binary rebuild | LOW | Build pipeline already handles 5-platform prebuilt binaries |
| rvf-index API surface | LOW | Crate exports are stable (`HnswGraph`, `HnswConfig`, `ProgressiveIndex`) |

### Tests required

- **Rust**: Unit tests for HNSW query integration in rvf-runtime
- **NAPI**: Smoke test verifying HNSW params are no longer silently ignored
- **Integration**: Query recall comparison (brute-force vs HNSW at 1K+ entries)

## Phase 3: Activate Native RVF (TS, 1 day, depends on Phase 2)

### What

Fix the 4 `tryNativeInit()` bugs and install `@ruvector/rvf-node` in the ruflo fork.

### How

- Fix package name: `@ruvector/rvf` → `@ruvector/rvf-node`
- Fix constructor: `new RvfDatabase({...})` → `RvfDatabase.create(path, {...})`
- Fix key name: `dimensions` → `dimension`
- Fix method pattern: `.open()` is static factory, not instance method
- Route `store/search/delete` through native handle
- Pure-TS `HnswLite` becomes fallback (not primary)
- Reference implementation: agentdb's `RvfBackend.ts` (lines 138-192) uses the correct API

### Dependencies

Phase 2 must be complete. Without rvf-index wiring, native queries are O(n) brute-force —
slower than pure-TS HnswLite O(log n).

`@ruvector/rvf-node` must be installed in ruflo fork. Both `@sparkleideas/ruvector-rvf` and
`@sparkleideas/ruvector-rvf-node` are already in `publish-levels.json` Level 1 (foundational).

### Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Native module load failure on some platform | LOW | Pure-TS fallback preserves current behavior exactly |
| Format migration (old custom → native binary) | LOW | Version header in magic bytes allows format detection; old files readable via TS path |
| API drift between @ruvector/rvf-node versions | LOW | Pin version in fork's package.json |

### Tests required

- **Unit**: Native init success, fallback chain (NAPI → TS), API bridge correctness
- **Integration**: Store/search round-trip via native handle, format detection (old vs new files)
- **Acceptance**: `memory search` returns correct results with native backend

## What's OUT of scope (and why)

| # | Item | Why excluded |
|---|------|-------------|
| 1 | SQLiteBackend delegates vector ops to RvfBackend | SQLite users chose SQLite explicitly; no reason to hybridize independent backends |
| 2 | AgentDB internal HNSW delegates to Rust HNSW | Agentic-flow internal; agentdb has its own `RvfBackend` that works independently |
| 3 | GraphDatabaseAdapter migrates to RVF graph profile | Dead code — `graphBackend` stored but never read (ADR-0069 F1 graphBackend assessment) |
| 4 | Existing `.rvf` file migration tool | Version header allows format detection; old files still readable via TS fallback path |
| 5 | SQLite → RVF data conversion tool | No user demand; cross-backend migration is a separate feature request |
| 6 | RVText profile (text + embeddings + metadata) | RVF ecosystem feature; requires native RVF working first (Phase 3) |
| 7 | WITNESS_SEG profile (cryptographic audit trails) | Zero current users |
| 8 | Streaming protocol (cross-process memory sharing) | Zero current users |

### Trigger to reconsider OUT items

- **Items 1-3**: User reports interop issues between CLI and MCP memory, or AgentDB search
  performance degrades at scale
- **Item 4**: Users with large existing `.rvf` files report inability to use native backend
- **Item 5**: Users migrating from SQLite to RVF backend request data portability
- **Items 6-8**: Upstream RVF ecosystem matures and users request specific profiles

## Format consolidation: honest assessment

ADR-0069 F2's vision is "RVF as single storage format" — 6 formats → 1. This ADR does NOT
achieve that. It upgrades the primary format (ruflo's RvfBackend) from "custom JSON-in-binary
with full-file rewrite" to "native RVF with HNSW and WAL." The other 5 formats are unchanged:

| Format | Before | After |
|--------|--------|-------|
| SQLite (better-sqlite3) | AgentDB core, SQLiteBackend | **Unchanged** |
| SQLite (AgentDBBackend) | HybridBackend's AgentDB layer | **Unchanged** |
| RVF (ruflo RvfBackend) | Custom JSON-in-binary, full-file rewrite, TS HNSW | **Upgraded**: native binary, Rust HNSW, WAL |
| JSON flat files | Config, daemon state | **Unchanged** (human-readable, by design) |
| Graph binary | GraphDatabaseAdapter | **Unchanged** (dead code) |
| In-memory Maps | AgentDBService fallback | **Unchanged** (process-only) |

True single-format consolidation would additionally require: SQLiteBackend deprecation, AgentDB
core migration to RVF, in-memory Maps getting RVF-backed persistence, and graph adapter
replacement. That is multi-month, multi-fork scope — deferred until user demand.

## Pros of implementing

| # | Pro | Magnitude | Conditions |
|---|-----|-----------|------------|
| 1 | Write path ~50x faster at 500+ entries | HIGH | Phase 1 (WAL) |
| 2 | Native binary format — smaller files, faster load | MEDIUM | Phase 3 (native RVF) |
| 3 | Future-proofs for 10K+ entry scale | MEDIUM | Phase 2 (rvf-index wiring) |
| 4 | Shared format with agentdb — CLI/MCP interop possible | MEDIUM | Phase 3 (both use @ruvector/rvf) |
| 5 | Unblocks RVF ecosystem (ADR-029 profiles) | LOW | Depends on upstream maturity |
| 6 | Eliminates format fragmentation (long-term) | LOW | Only with full consolidation (OUT items) |

## Cons of implementing

| # | Con | Severity | Mitigation |
|---|-----|----------|------------|
| 1 | No user complaints — current perf adequate at typical scale | HIGH | Pre-emptive; Phase 1 (WAL) cost is low |
| 2 | Native binary dependency — platform-specific, CI complexity | HIGH | Prebuilt binaries for 5 platforms; existing build pipeline |
| 3 | Rust patch maintenance across upstream syncs | MEDIUM | One more patch; 4 forks already maintained |
| 4 | WAL crash recovery complexity | MEDIUM | Well-understood pattern; existing atomic rename is the compaction path |
| 5 | rvf-runtime brute-force without rvf-index | HIGH | Strict phase ordering (Phase 3 depends on Phase 2) |
| 6 | Old → new format migration | LOW | Version header detection; graceful TS fallback |
| 7 | Upstream blocking bugs (#315, #316, #323) | MEDIUM | Workarounds exist; #315 is misattributed (rvf-index gap, not import bug) |

## Decision points

1. **Is the write bottleneck hurting users?** Measure real-world entry counts. If most users
   have <200 entries, even Phase 1 is premature. If 500+, Phase 1 is urgent.
2. **Phase 2 upstream-first?** The rvf-index → rvf-runtime wiring could be offered as a PR to
   ruvnet/RuVector. If accepted, we get it for free on sync. If rejected or slow, we maintain
   the fork patch — that's what this repo exists to do.
3. **Phase 3 timing**: Only after Phase 2 ships and NAPI binaries are rebuilt with HNSW support.

## Upstream context

### Blocking issues (verified 2026-04-06)

| Issue | Original claim | Actual state |
|-------|---------------|-------------|
| #315 (import/recall) | Blocks import | Misattributed — `RvfStore.query()` is brute-force by design (no rvf-index dep). "Empty recall" is because HNSW graph is never built, not because import fails. |
| #323 (Node 22 ONNX) | Blocks ONNX embedding | Has workaround — `OnnxEmbedder` manually loads WASM bytes, bypassing broken ESM import |
| #316 (sync embed) | Blocks embed | By design — sync `embed()` uses hash vectors; async uses ONNX. Enforce async-only. |

### NAPI package status

`@ruvector/rvf-node` v0.1.7 published on npm with prebuilt binaries for darwin-arm64/x64,
linux-arm64/x64, win32-x64. Installed in agentic-flow fork, NOT in ruflo fork. Both
`@sparkleideas/ruvector-rvf` and `@sparkleideas/ruvector-rvf-node` in `publish-levels.json`
Level 1.

### RVF ADR ecosystem (12 upstream ADRs)

| ADR | Title | Status |
|-----|-------|--------|
| 029 | RVF Canonical Format | Accepted |
| 030 | Cognitive Container | Proposed |
| 031 | Example Repository | Accepted |
| 032 | WASM Integration | Accepted |
| 033 | Progressive Indexing Hardening | Accepted |
| 037 | Publishable Acceptance Test | Accepted |
| 039 | Solver WASM AGI Engine | Implemented |
| 042 | Security RVF AIDefence TEE | Accepted |
| 056 | Knowledge Export | Accepted |
| 057 | Federated Transfer Learning | Proposed |
| 063 | RVF Optimizer Integration | Implemented |
| 075 | Wire into mcp-brain-server | Implemented |

### SPARC integration branch

`claude-flow-v3-ruvector` branch: 14-document SPARC plan, original estimate 12-16 weeks, gap
analysis revised to 44-49 weeks (covers ~15-20% of existing features). Planning only, no
implementation. This ADR's phased approach delivers the high-value subset without the full
rewrite risk.

### Performance claims (verified)

| Claim | Reality |
|-------|---------|
| "150x pattern search" | Plausible at 10K+ entries (Rust HNSW vs TS linear scan). Irrelevant at typical scale — ruflo already uses HnswLite O(log n), not linear scan. |
| "500x batch operations" | Not benchmarked. Real win is eliminating O(n) full-file rewrite (Phase 1 WAL). |
| "<5ms cold boot" | Describes rvf-index design, not rvf-runtime implementation. |
| "recall >= 0.95" | True for rvf-index in isolation. Not wired into rvf-runtime. |

### Hardcoded values in ruvector (affect Phase 2/3)

| File | Value | Severity |
|------|-------|----------|
| `ruvector-postgres/src/routing/router.rs:158,167` | `embedding_dim: 768` | HIGH |
| `ruvector-postgres/src/workers/engine.rs:937,946,955` | `ef_search: Some(50)` x3 | HIGH |
| `ruvector-dag/src/qudag/network.rs:14`, `client.rs:17` | `qudag.network:8443` | HIGH |
| `ruvector-graph/src/distributed/replication.rs:111,121` | Port `:9001` | HIGH |
| `ruvector-core` vs `ruvector-postgres` | m:32/efC:200 vs m:16/efC:64 | MEDIUM |

## Post-Sync Update (2026-04-06)

ruvector upstream synced (68 commits). Impact: NO IMPACT on implementation plan.
- RVF crate: hash algorithm upgraded from CRC32C to SHAKE-256 (cryptographic). No structural changes.
- rvf-index: unchanged, HNSW still disconnected from rvf-runtime (Phase 2 blocker unchanged)
- rvf-node NAPI: binaries rebuilt, but 4 tryNativeInit() API bugs persist (Phase 3 unchanged)
- RVM witness chain: reference pattern for append-only log design, but NOT a dependency for Phase 1 WAL
- Upstream creator assessment: "Ship Phases 1-3. The disconnected rvf-index is embarrassing."
