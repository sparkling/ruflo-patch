# ADR-0083: Phase 5 — Single Data Flow Path

- **Status**: Implemented (Waves 1-2 completed 2026-04-12; Wave 3 completed via ADR-0084 Phase 3 T3.2, 2026-04-13)
- **Date**: 2026-04-12
- **Deciders**: Henrik Pettersen
- **Methodology**: 8-agent hive (spec reader, bridge inventory, conflict assessor, architect, devil's advocate, advocate, CJS analyst, effort estimator) + queen synthesis
- **Depends on**: ADR-0076 (Phase 5 original spec), ADR-0080 (Phases 5-6 shim/bridge approach)
- **Supersedes**: ADR-0080 Phase 5 (RVF-Primary Shim) and Phase 6 (reverse JSON bridge)

## Context

### Three disconnected storage systems

A 9-agent hive traced every write path in the memory subsystem. Finding: there are
three completely separate storage systems that never share data without explicit bridges:

| System | Storage file | Written by | Read by |
|--------|-------------|------------|---------|
| **CLI memory** (SQLite) | `.swarm/memory.db` | `storeEntry()` in memory-initializer.ts via better-sqlite3 | `searchEntries()`, `listEntries()`, `memory search` CLI |
| **CJS intelligence** (JSON) | `.claude-flow/data/auto-memory-store.json` | `intelligence.cjs consolidate()`, `bootstrapFromMemoryFiles()` | `intelligence.cjs init()` → builds graph → `ranked-context.json` |
| **ESM hooks** (RVF) | `.swarm/agentdb-memory.rvf` | `auto-memory-hook.mjs doImport()/doSync()` via RvfBackend | `auto-memory-hook.mjs`, `memory-bridge.ts` search (read-only merge) |

These systems were identified as separate silos across multiple ADRs:

- **ADR-0058** (2026-04-04): First identified as "P0 bridge bug" — *"JSON cache never drains
  to SQLite."*
- **ADR-0074** (2026-04-06), Root Cause B: *"intelligence.cjs is a pure CJS system with no
  imports of @sparkleideas/memory, agentdb, or sql.js. Its data flow is entirely
  JSON-to-JSON. There is no drain path. PageRank scores, confidence boosts, access counts,
  and pattern insights computed by intelligence.cjs are invisible to AgentDB."*
- **ADR-0076** (2026-04-07): Phase 5 planned to fix this by rewiring `intelligence.ts` to
  use ControllerRegistry directly. Phase 5 was never started.
- **ADR-0080** (2026-04-11): Expert 3 re-confirmed: *"intelligence.cjs is a completely
  separate data silo — no write path into AgentDB."* Then explicitly ruled out direct
  consolidation: *"CJS subprocess workers can't import TypeScript modules — JSON is the
  IPC contract"* (What NOT to do, line 145).

### The bridge workarounds that replaced Phase 5

ADR-0080 abandoned the original Phase 5 (memory-router rewiring) due to merge conflict
risk and replaced it with two workarounds:

- **Phase 5 substitute**: `rvf-shim.ts` (182 lines) — RVF-primary with SQLite dual-write
- **Phase 6**: `appendToAutoMemoryStore()` (50 lines) — JSON dual-write for intelligence.cjs

Together with the ADR-0074 Phase 2 drain (`doSync()` ranked-context.json → RVF, 60 lines)
and `open-database.ts` (263 lines, sql.js → better-sqlite3 wrapper), this creates 555
lines of bridge code whose sole purpose is keeping 3 storage systems in sync.

### The growing bridge problem

Each ADR discovers another direction data doesn't flow and bolts on another bridge:

| ADR | Bridge added | Lines | Direction |
|-----|-------------|-------|-----------|
| 0074 | `doSync()` drain | 60 | intelligence → RVF |
| 0080 P4 | `open-database.ts` | 263 | sql.js → better-sqlite3 |
| 0080 P5 | `rvf-shim.ts` | 182 | CLI → RVF primary |
| 0080 P6 | `appendToAutoMemoryStore()` | 50 | CLI → JSON (intelligence.cjs) |
| **Total** | | **555** | |

`storeEntry()` now writes to 3 places: SQLite + RVF + JSON. Every future feature
(tagging, TTL, scoping) must be wired into all 3.

### Current architecture

```
MCP tools → memory-bridge → ControllerRegistry → SQLite + RVF
          → memory-initializer → SQLite (fallback)
          → rvf-shim → RVF (dual-write)
          → appendToAutoMemoryStore → JSON (for intelligence.cjs)

intelligence.cjs → reads auto-memory-store.json only (CJS, can't import TS)
auto-memory-hook.mjs → reads/writes agentdb-memory.rvf
```

7,675 lines across 5 memory files. 4 dual-write sites. 39 fallback chains. 54 bridge
functions.

### Current implementation state of memory-router.ts

`memory-router.ts` (360 lines) already exists and routes 7 of 30 exported functions
from `memory-initializer.ts`:

**Already routed (7):** `storeEntry`, `searchEntries`, `listEntries`, `getEntry`,
`deleteEntry`, `initializeMemoryDatabase`, `checkMemoryInitialization`

**Not yet routed (23):**
- HNSW (6): `getHNSWIndex`, `addToHNSWIndex`, `searchHNSWIndex`, `getHNSWStatus`,
  `clearHNSWIndex`, `rebuildSearchIndex`
- Quantization (4): `quantizeInt8`, `dequantizeInt8`, `quantizedCosineSim`,
  `getQuantizationStats`
- Attention (3): `batchCosineSim`, `softmaxAttention`, `topKIndices`,
  `flashAttentionSearch`
- DB lifecycle (5): `getInitialMetadata`, `ensureSchemaColumns`,
  `checkAndMigrateLegacy`, (init/check already routed)
- Embedding (4): `loadEmbeddingModel`, `generateEmbedding`,
  `generateBatchEmbeddings`, `getAdaptiveThreshold`
- Decay/verify (2): `applyTemporalDecay`, `verifyMemoryInit`

The estimated complete router: ~550-600 lines (adding ~200-240 lines of lazy-loader
wrappers for the 23 remaining functions).

### Import sites across the codebase

**Files importing from memory-bridge.ts (38 imports across 7 files):**

| File | Bridge imports | Upstream commits (6 weeks) |
|------|---------------|---------------------------|
| `hooks-tools.ts` | 16 | 20 |
| `agentdb-tools.ts` | 3 (already migrated to router) | — |
| `memory-tools.ts` | 11 (already migrated to router) | — |
| `daa-tools.ts` | 2 | 4 |
| `system-tools.ts` | 1 | 6 |
| `worker-daemon.ts` | 3 | — |
| `intelligence.ts` | 2 | — |

**Files importing from memory-initializer.ts (42 imports across 16 files):**

The main external consumers are `index.ts` (18 re-exports for public API) and
`headless.ts` (3 symbols). The MCP tool files import from memory-bridge, not
memory-initializer directly.

### ADR-0080 decisions this ADR overrides

ADR-0080 made these specific decisions that this ADR reverses:

1. **Priority Scorecard**: *"Phase 5 data flow | Excessive | Abandon | Do not rewire
   remaining 18 tool files"*
2. **What NOT to do**: *"Delete upstream files (memory-bridge.ts, memory-initializer.ts)
   — Fork-patching model, merge conflicts"*
3. **Data flow layer count**: *"Excessive | Low priority | Don't add more; don't rewire"*

**Justification for override**: The bridge count grew from 1 (ADR-0074) to 4
(ADR-0080 Phases 4-6) in 6 days. The shim approach reached its ceiling — storeEntry()
now writes to 3 places. The merge conflict cost is real but manageable with the 3-wave
approach, and the actual number of files requiring changes is lower than the original
estimate (6 files, not 18, because 2 are already migrated).

### CJS constraint analysis (intelligence.cjs)

A dedicated analyst confirmed intelligence.cjs is pure CJS using only `require('fs')`,
`require('path')`, `require('os')`. Zero external package imports. All data comes from
JSON files in `.claude-flow/data/`.

**Rewriting to use better-sqlite3 is impractical:**
- better-sqlite3 is a native N-API addon — prebuild must match the exact Node version
  and platform of Claude Code's hook subprocess (not user-controlled)
- WAL locking: if the daemon writes via WAL while the hook subprocess opens the same DB,
  simultaneous WAL checkpoint + read can cause SQLITE_BUSY
- Startup time: better-sqlite3 open + query adds ~5-15ms vs ~1-2ms for `readFileSync`
  on a small JSON file. For a hook that fires on every edit, this adds up

**Conclusion**: intelligence.cjs will always read JSON. The fix is to centralize the JSON
write in memory-router.ts as a controlled side-effect, not to rewrite the CJS helper.

(Note: This conclusion was overturned by ADR-0085, which converted `intelligence.cjs` to
read SQLite directly via better-sqlite3, proving the native binary and WAL concerns
manageable in practice. The JSON sidecar was fully eliminated.)

## Decision

Implement Phase 5 in 3 waves, migrating low-risk files first and deferring the
high-conflict file (`hooks-tools.ts`) until upstream stabilizes.

### Target architecture

```
ALL callers → memory-router.ts → backend
                  │
                  ├── routeMemoryOp()      → CRUD (store/search/list/get/delete)
                  ├── routeEmbeddingOp()   → embeddings, HNSW  [NEW]
                  ├── getController()       → controller-intercept pool
                  └── JSON sidecar write   → auto-memory-store.json (for intelligence.cjs)
                       │
                       └── internally delegates to:
                            memory-initializer.ts  (private impl, never imported externally)
                            memory-bridge.ts       (private impl, never imported externally)
```
(Note: Superseded by ADR-0086 and ADR-0085. Router now uses RvfBackend directly;
`memory-initializer.ts` was fully DELETED in ADR-0086 Phase 3 (not just a shim).
`writeJsonSidecar()` and the `auto-memory-store.json` sidecar were eliminated by ADR-0085;
`intelligence.cjs` now reads SQLite directly via better-sqlite3.)

One entry point. One store path. One JSON side-effect for the CJS contract.

### Wave 1: Low-risk migrations (3 files, 4 import sites)

| File | Current imports | Risk | Upstream commits (6 weeks) |
|------|----------------|------|---------------------------|
| `session-tools.ts` | 1 from initializer | LOW | 2 |
| `agentdb-orchestration.ts` | 1 from initializer | LOW | 1 |
| `daa-tools.ts` | 2 from bridge | LOW | 4 |

Also in Wave 1:
- Add `routeEmbeddingOp()` to memory-router.ts (~40 lines)
- Centralize JSON sidecar write in `routeMemoryOp()` (move from `appendToAutoMemoryStore`)
- Delete `rvf-shim.ts` (182 lines) — router handles RVF directly

### Wave 2: Medium-risk migrations (3 files, 11 import sites)

| File | Current imports | Risk | Upstream commits (6 weeks) |
|------|----------------|------|---------------------------|
| `embeddings-tools.ts` | 2 from initializer | MEDIUM | 8 |
| `system-tools.ts` | 1 from bridge | MEDIUM | 6 |
| `intelligence.ts` | 4 from bridge+initializer | MEDIUM | — |

Also in Wave 2:
- Delete `open-database.ts` (263 lines) — router manages DB lifecycle
- Remove `appendToAutoMemoryStore()` from memory-initializer.ts (50 lines)
- Remove ADR-0074 `doSync()` drain from auto-memory-hook.mjs (60 lines)

### Wave 3: High-risk migration (1 file, 19 import sites)

| File | Current imports | Risk | Upstream commits (6 weeks) |
|------|----------------|------|---------------------------|
| `hooks-tools.ts` | 3 init + 16 bridge | HIGH | 20 |

**Defer until**: upstream commit frequency on hooks-tools.ts drops below 2/month,
OR a sync merge creates a natural conflict resolution point.

### The CJS constraint (intelligence.cjs)

intelligence.cjs is pure CJS — it cannot import TypeScript or ESM packages.
It will always read from `.claude-flow/data/auto-memory-store.json`.

Phase 5 centralized the write into `writeJsonSidecar()` in memory-router:

```
Current:  storeEntry() → appendToAutoMemoryStore()  (scattered in memory-initializer)
Phase 5:  routeMemoryOp('store') → writeJsonSidecar()  (centralized in memory-router)
```

(Note: Superseded by ADR-0085. The CJS constraint was resolved: `intelligence.cjs` was
rewritten to read SQLite directly via better-sqlite3, eliminating the JSON sidecar entirely.
`writeJsonSidecar()` was deleted and `auto-memory-store.json` is no longer written or read.
The original CJS analyst finding below is preserved for historical context.)

One write, one place, one try/catch. The CJS analyst confirmed that rewriting
intelligence.cjs to use better-sqlite3 is impractical (native binary portability,
WAL locking conflicts, 5-15ms startup penalty per hook invocation vs 1-2ms for JSON).

### What gets deleted

| Code | Lines | Why deletable |
|------|-------|--------------|
| `rvf-shim.ts` | 182 | Router handles RVF directly |
| `open-database.ts` | 263 | Router manages DB lifecycle |
| `appendToAutoMemoryStore()` | 50 | Centralized in router |
| `doSync()` drain (auto-memory-hook.mjs) | 60 | Router writes JSON directly |
| 14 `openDatabase()` call sites in memory-initializer | ~70 | Replaced by router's DB pool |
| sql.js fallback in storeEntry/searchEntries | ~200 | Router uses better-sqlite3 only |
| **Total eliminated** | **~825** | |

### Fork patches that become unnecessary

| Patch/commit | What it did | Why deletable |
|-------------|-------------|--------------|
| ADR-0080 Phase 4 (open-database.ts) | sql.js → better-sqlite3 wrapper | Router manages DB directly |
| ADR-0080 Phase 5 (rvf-shim.ts) | RVF-primary dual-write | Router is the single write path |
| ADR-0080 Phase 6 (appendToAutoMemoryStore) | JSON bridge for intelligence.cjs | Centralized in router |
| ADR-0074 Phase 2 (doSync drain) | intelligence → RVF drain | Router writes both targets |
| SqlJsCompatStatement shim | sql.js API compat for better-sqlite3 | Only needed by open-database.ts |

### Acceptance tests simplified

Current tests must verify data flows through each bridge independently. With Phase 5:

- `memory store` → verify via `memory search` (one path, no bridge verification needed)
- intelligence graph → verify via `intelligence.cjs init()` after CLI store (JSON sidecar)
- hooks → verify hook runs without error (no bridge to test)
- Rate limit → verify `rate_limit_status` returns success

The 6 tests that failed due to the storage silo (ADR-0082) would pass trivially because
all storage goes through one router.

## Implementation Notes

### Implemented (2026-04-12)

**Wave 1 (Low-risk):**
- session-tools.ts: migrated storeEntry import → routeMemoryOp
- agentdb-orchestration.ts: migrated generateEmbedding import → router wrapper
- daa-tools.ts: migrated 2 bridge imports → router
- memory-router.ts: added routeEmbeddingOp(), writeJsonSidecar(), 23 lazy wrappers
- rvf-shim.ts: deleted (182 lines)

**Wave 2 (Medium-risk):**
- embeddings-tools.ts: migrated 2 initializer imports → router
- system-tools.ts: migrated 1 bridge import → router
- intelligence.ts: migrated 4 bridge+initializer imports → router
- open-database.ts: deleted (263 lines)
- memory-initializer.ts: removed appendToAutoMemoryStore, rvf-shim imports, openDatabase wrapper calls
- auto-memory-hook.mjs: removed doSync() drain

**Wave 3 (High-risk): Completed via ADR-0084 Phase 3 (2026-04-13)**
- hooks-tools.ts: 18 bridge call sites migrated to router (T3.2) — 8 getController, 2 feedback, 2 session, 1 causal, 2 pattern, 3 solver/route via controller-direct

### Lines eliminated
- rvf-shim.ts: 182
- open-database.ts: 263
- appendToAutoMemoryStore: ~50
- doSync drain: ~60
- openDatabase call sites: ~70
- sql.js fallback paths: ~200
- **Total: ~825 lines**

### Hive review findings (2026-04-12)

An 11-agent hive (queen, 2 devil's advocates, 8 experts including Reuven Cohen) audited
47 acceptance checks across ADR-0059/0074/0080/0083 for post-implementation validity.

**P0 — Will fail (fixed):**

| Check | File | Issue |
|-------|------|-------|
| `check_adr0074_drain_wired` | adr0074-checks.sh | Grepped for `doSync()` code that Wave 2 deleted |
| `check_adr0059_hook_full_lifecycle` | adr0059-checks.sh | Called `auto-memory-hook.mjs "sync"` — command removed |
| `check_adr0080_rvf_has_entries` | adr0080-checks.sh | Asserted RVF >1KB after store — rvf-shim deleted |

**P1 — Bug found and fixed:**

`writeJsonSidecar()` wrote `value` but not `content`. intelligence.cjs edge builder uses
`entry.content || entry.summary || ''`, so CLI-stored entries became isolated nodes with
zero PageRank. Fix: sidecar now includes `content: entry.value`.

**P2 — Stale checks (9):**

Reversed ADR-0080 duplicate checks (rvf_shim_exists, open_database_exists), stale sql.js
exclusion filter, bridge-level tests for contracts now held by the router, "both stores"
framing in Phase 3 unified search checks.

**P3 — Missing tests added:**

- `check_adr0083_no_dosync_drain` — verifies doSync absent from published hook
- `agentdb-orchestration` added to migration check list
- `routeEmbeddingOp` made mandatory in router exports check (was 3-of-4)

**29 checks confirmed sound** across all 4 ADR test files.

## Devil's Advocate Position

1. **Merge conflict risk for hooks-tools.ts is real** — 20 upstream commits in 6 weeks,
   19 import sites to change. Wave 3 acknowledges this by deferring.

2. **The shim approach already works** — 555 lines of bridges is ugly but functional.
   No user-facing bugs remain after Phase 6.

3. **"Don't rewire" was the ADR-0080 decision** — this ADR explicitly overrides it.
   The justification: the bridge count keeps growing (4 bridges in 4 ADRs), and each
   bridge adds test complexity and maintenance burden.

4. **CJS contract means JSON never goes away** — correct, but Phase 5 centralizes the
   write instead of scattering it.

## Consequences

- ~825 lines of bridge code eliminated
- Store path collapses from 3 writes to 1 write (JSON side-effect also eliminated by ADR-0085)
- Fallback chains reduced from 39 to ~5
- memory-bridge.ts becomes a private implementation detail; memory-initializer.ts fully deleted (ADR-0086 Phase 3)
- Merge conflict risk managed via 3-wave approach (low → medium → high)
- intelligence.cjs now reads SQLite directly (CJS constraint resolved by ADR-0085)
- Future features wire into one router, not 3 storage systems
