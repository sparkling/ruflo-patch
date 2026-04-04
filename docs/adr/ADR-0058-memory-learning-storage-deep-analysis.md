# ADR-0058: Memory, Learning & Storage — Deep Analysis

- **Status**: Active (living document)
- **Date**: 2026-04-04
- **Updated**: 2026-04-04 (v2 — architecture hive findings)
- **Deciders**: ruflo-patch maintainers
- **Methodology**: SPARC + multi-agent swarm analysis (4 hives, 30+ agents)

## Context

This ADR documents the findings from a comprehensive swarm-assisted audit of the ruflo memory, learning, and storage subsystems. It traces root causes across both upstream repos (ruflo, agentic-flow) and the ruflo-patch pipeline, cross-referencing ADRs, patches, commits, and upstream issues.

The audit was triggered by investigating upstream issue ruvnet/claude-flow#1204 (12 dead config keys) and expanded to cover the full memory/learning stack after discovering cascading issues.

## Intended Architecture (Confirmed by Expert Hive)

The storage system is designed as a **write-ahead-log pattern** with three layers:

| Layer | Backend | Role | Lifetime |
|-------|---------|------|----------|
| **1. AgentDB** | SQLite (→ RVF per ADR-057) | Single source of truth — durable cross-session store | Permanent |
| **2. CJS JSON cache** | `.claude-flow/data/*.json` | Fast intra-session write-ahead for CJS hook subprocesses | Ephemeral — drained into AgentDB at session-end |
| **3. MEMORY.md** | Markdown files | Human-readable projection of most relevant entries | Permanent, curated |

**"AgentDB owns truth, JSON files own speed, MEMORY.md owns human readability."** — Reuven Cohen

### Key Design Decisions (from upstream ADRs)

- **CJS/ESM split is temporary** (ADR-050): hooks use CJS because ESM `import()` adds 50ms. Not a design goal — collapses when daemon IPC or synchronous ESM loading is available.
- **JSON files are staging, not permanent** (ADR-050, ADR-057): designed to migrate to RVF once ADR-057 ships. Until then, they are a valid write-ahead cache.
- **Two-system architecture is intentional** (ADR-048, ADR-050): CJS hooks append to JSON (fast), session-end reconciles into AgentDB (durable). Standard WAL pattern.
- **RVF replaces SQLite** (ADR-057, status: Proposed): binary container (5.5KB) with native HNSW, replacing sql.js (18MB WASM, O(n) brute-force). Do not depend on it yet.
- **Architecture is federated** (ADR-053): AgentDB handles episodic/skill/causal storage. ControllerRegistry adds routing, caching, graph layers on top. 44 controllers live in memory.

### How Many Systems Should Exist: Three, Not Eight

The current 8 persistence files exist because the drain from Layer 2 (JSON cache) to Layer 1 (AgentDB) is broken. Fix the drain, and 4 of 5 JSON files become transient caches that empty themselves.

| # | System | Files | Status |
|---|--------|-------|--------|
| 1 | AgentDB (SQLite → RVF) | `.swarm/memory.db` | Working but nearly empty (17 entries) — drain broken |
| 2 | CJS JSON cache | `.claude-flow/data/*.json` (5 files) | Working but accumulating permanently |
| 3 | SONA patterns | `.swarm/sona-patterns.json` | Working, appropriately small |

### The One Fix That Unblocks Everything

`auto-memory-hook.mjs` line 235: `createBackend("hybrid")` can't initialise → targets `.swarm/agentdb-memory.rvf` which doesn't exist → init throws → caught silently → falls back to `JsonFileBackend` → JSON cache never drains → data accumulates → two permanent silos.

Fix this function and the architecture works as designed.

### Are Our Patches Consistent With the Design?

**Most are genuine bug fixes.** The ID collision, tool_input snake_case mismatch, graph-state dedup, bare model names, ControllerRegistry→AgentDB config wiring — these fix real bugs in any design.

**A few fight the design.** Patches that treat JSON files as permanent fixtures (adding rotation, capping, optimising graph-state.json) are fortifying the cache instead of fixing the drain. The correct fix is to repair the AgentDB drain path, not make the JSON store self-sufficient.

### Storage Backend Roles

| Backend | Right Use | Wrong Use |
|---------|-----------|-----------|
| **SQLite/AgentDB** | Durable entries, patterns, trajectories, sessions, embeddings | Intra-session cache (too slow for hook budget) |
| **JSON files** | Fast hook-subprocess IPC, session-scoped ranked context | Long-term storage (no indexing, no ACID) |
| **RVF** | Future: replace SQLite with native HNSW + smaller footprint | Current: not yet merged (ADR-057 Proposed) |
| **HNSW (in-memory)** | Vector similarity search during active session | Persistence (that's RVF's job) |
| **MEMORY.md** | Human-readable knowledge base, version-controlled | Machine-readable store (no schema, no search) |
| **SONA patterns** | Lightweight routing heuristics (2-10 entries) | Large-scale pattern storage |

### Embedding Service Duplication (Intentional)

`AgentDB.embedder` (EmbeddingService) is the low-level ONNX model driver, shared by AgentDB's 8 core controllers. `EnhancedEmbeddingService` is a CLI-layer wrapper adding batching, caching, and fallback chains for controllers owned by ControllerRegistry. The duplication is architectural: AgentDB is a self-contained library; ControllerRegistry is the CLI integration point.

## Architecture: Two Independent Stacks

The system has two memory stacks separated by the ESM/CJS boundary, with no synchronisation between them.

| Stack | Runtime | Storage | Entries | Upstream ADR |
|-------|---------|---------|---------|-------------|
| **AgentDB** (ESM) | CLI/MCP tools | `.swarm/memory.db` (SQLite) + `.swarm/memory.graph` (HNSW) | 17 | ADR-053, ADR-057 |
| **CJS Intelligence** (CJS) | Hook subprocess | `.claude-flow/data/*.json` (5 files) | 157 (4,482 raw) | ADR-050, ADR-048 |

### Why Two Stacks?

ADR-050 (upstream): "Hooks are short-lived Node.js processes invoked by Claude Code. `hook-handler.cjs` uses `require()`. ESM dynamic `import()` is async and adds ~50ms overhead per invocation. The memory package (`@claude-flow/memory`) is ESM-only. The intelligence layer must be CJS for synchronous, fast loading."

The two stacks hold **completely disjoint data** with different ID schemes, different write paths, and different search algorithms:
- **AgentDB**: UUIDs, cosine similarity over 768-dim ONNX vectors, HNSW index
- **CJS Intelligence**: `mem-${filename}-${title}` slugs, Jaccard trigram similarity, PageRank

### 8 Persistence Mechanisms (Total)

1. `.swarm/memory.db` — SQLite (AgentDB, better-sqlite3/sql.js)
2. `.swarm/memory.graph` — RuVector HNSW binary index
3. `.claude-flow/data/auto-memory-store.json` — flat JSON entry list
4. `.claude-flow/data/graph-state.json` — PageRank graph (nodes + edges)
5. `.claude-flow/data/ranked-context.json` — pre-computed ranked entries
6. `.claude-flow/data/intelligence-snapshot.json` — graph build stats
7. `.claude-flow/data/pending-insights.jsonl` — append-only edit log
8. `.swarm/sona-patterns.json` — SONA learning patterns

## Bugs Found

### P0: ID Collision in `intelligence.cjs` (No Upstream Issue)

**File**: `intelligence.cjs` line 276
**Formula**: `mem-${file.replace('.md', '')}-${title.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 30)}`

Two collision vectors:
1. **Bare filename** — every project's `MEMORY.md` produces `mem-MEMORY-{heading}`. With 51 project dirs under `~/.claude/projects/`, different projects' sections collide.
2. **30-char title truncation** — headings sharing a 30-char prefix collide after slugification.

**Result**: 4,482 entries with only 157 unique IDs. `buildEdges()` processes all 4,482, generating O(n²) edges → 1,337,498 edges → 194MB `graph-state.json`.

**ADR-048 designed `insightCounter` for unique keys** (line 516) but only for the `AutoMemoryBridge` path, not `intelligence.cjs`'s `parseMemoryDir()`.

**Fix**: Use `entries.length` as index suffix (like the stub generator at `helpers-generator.ts` line 694).

**Mitigation applied**: Dedup guard in `init()` collapses to 157 unique entries before building edges (194MB → 79KB). Root cause unfixed.

### P0: ML-006 Incomplete — Scans All 51 Project Dirs

**File**: `intelligence.cjs` lines 231-244

`bootstrapFromMemoryFiles()` scans `~/.claude/projects/` — all 51 project subdirectories, not just the current project. ML-006 (ADR-0029) was supposed to fix this but the fix only landed in the **stub generator** (`helpers-generator.ts` line 666-667), not in the full `intelligence.cjs` that ships with the npm package.

**Stub fix** (correct): `path.join(os.homedir(), ".claude", "projects", PROJECT_ROOT.replace(/[/\\]/g, "-").replace(/^-/, ""), "memory")`

**Full intelligence.cjs** (broken): `path.join(require('os').homedir(), '.claude', 'projects')` → iterates ALL subdirectories

### P1: Edit Path Always "unknown" (HK-001)

**File**: `hook-handler.cjs` line 157
**Tracked**: sparkling/ruflo-patch#52, ruvnet/ruflo#1058

Claude Code PostToolUse sends `tool_input` (snake_case). Handler checks `toolInput` (camelCase). One-key mismatch.

**Result**: Every entry in `pending-insights.jsonl` has `file: "unknown"`. The learning loop can't identify hot files. `consolidate()` promotes a useless "unknown" entry.

**Fix**: Add `hookInput.tool_input?.file_path` as first fallback.

### P1: Dual Memory Stacks Never Sync

**File**: `auto-memory-hook.mjs` line 235
**Root cause**: `config.json` says `backend: "hybrid"` → `createBackend()` maps to `AgentDBBackend` → targets `.swarm/agentdb-memory.rvf` → file doesn't exist → init throws → caught silently → falls back to `JsonFileBackend`

SQLite (17 entries via MCP) and JSON (157 entries via hooks) remain permanently separated.

**Design intent** (ADR-048): `AutoMemoryBridge.importFromAutoMemory()` should sync entries from MEMORY.md into AgentDB; `syncToAutoMemory()` should write back. This round-trip is the designed unification mechanism, but it's broken because the backend can't initialise.

### P2: Cumulative Append Bug in `consolidate()`

**Not a race condition.** `consolidate()` runs at session-end, reads the store, generates insight entries for frequently-edited files, appends them, writes back. The identity guard at line 554 checks `e.metadata.sourceFile === file && e.metadata.autoGenerated` but file paths vary between sessions (absolute vs relative), so the guard never fires.

`doImport()` collapses via Map at next SessionStart — but only if the memory package loads. If unavailable, `consolidate()` keeps appending every session.

### P2: `pending-insights.jsonl` Not Pruned

`consolidate()` does truncate the file (line 573: `writeFileSync(PENDING_PATH, '')`), but:
1. Session-end hook may not fire (unclean exit)
2. All entries have `file: "unknown"` (HK-001), so consolidation promotes garbage
3. No max-entry cap, no TTL, no rotation

### P3: ADR-0049 Fail-Loud — Entirely Unimplemented

132 silent catch blocks in `controller-registry.ts` (27) and `memory-bridge.ts` (105) hide every broken controller. 240 unit tests pass while the runtime runs entirely on fallback paths. No error classes, no strict mode, no CI enforcement.

## ADR Cross-Reference

| ADR | Title | Memory/Storage Relevance | Unfixed Items |
|-----|-------|--------------------------|---------------|
| **0029** (patch) | Memory & Learning Fixes | ML-001→ML-007 | ML-006 partial, ML-005 hooks |
| **0030** (patch) | Memory Optimisation | OPT-001→OPT-017, dual SQLite | BUG-1/2/3/4, OPT-017 dual stores |
| **0033** (patch) | Controller Activation | 27/28 controllers wired | SolverBandit routing broken |
| **0039** (patch) | Integration Roadmap | 31 additional classes found | Superseded by 0040-0047 |
| **0041** (patch) | Composition-Aware | Composite controller pattern | Implemented |
| **0048** (patch) | Deferred Init | 44 controllers, 228ms warm | Silent swallowing preserved |
| **0049** (patch) | Fail-Loud | 132 silent catch blocks | **Entirely unimplemented** |
| **ADR-048** (upstream) | Auto-Memory Integration | Bidirectional MEMORY.md↔AgentDB sync | `insightCounter` only in bridge path |
| **ADR-050** (upstream) | Intelligence Loop | CJS layer design, file persistence | No dedup spec, no pruning spec |
| **ADR-053** (upstream) | Controller Activation | 28 controllers, 7 init levels | FederatedSession blocked |

## Patch Status

| Status | Count | Examples |
|--------|-------|---------|
| **Applied** | 11 | ML-001→ML-003, ML-005, ML-007, WM-102, AT-001, GV-001 |
| **Partial** | 1 | ML-006 (stub fixed, intelligence.cjs not) |
| **Still open** | 10 | OPT-009/010/011/017, WM-103/108, P4-B |
| **Unimplemented ADR** | 1 | ADR-0049 (132 silent catches) |

## Upstream Issues Filed This Session

| Issue | PR | What |
|-------|-----|------|
| ruvnet/ruflo#1511 | #1512 | CLAUDE.md generator: Task→Agent, MCP discovery, hook signals |
| ruvnet/ruflo#1516 | #1517 | Bare model names → Xenova/ prefix + ControllerRegistry→AgentDB config |
| ruvnet/ruflo#1518 | #1519 | intelligence.cjs graph-state.json dedup (194MB→79KB) |

## Fixes Applied This Session

| Fix | Where | Impact |
|-----|-------|--------|
| Dedup guard in `intelligence.cjs init()` | Fork + upstream PR | 194MB → 79KB graph-state.json |
| Bare model names → `Xenova/` prefix | Fork + upstream PR | Real ONNX embeddings instead of hash fallback |
| ControllerRegistry passes config to AgentDB | Fork + upstream PR | 768-dim embeddings, 20+ controllers active |
| Portable defaults (cache, nodes, SONA, decay) | Fork + upstream PR | Cross-platform config, benchmark-validated |
| Dynamic memory ceiling (75% of `os.totalmem()`) | Fork | No more 160GB hardcoded ceiling |
| `@sparkleideas/ruvector` published | Pipeline fix | Dependency chain unblocked |
| macOS pipeline parity | Pipeline fix | 57/57 acceptance on M5 Max |

## Priority Fixes Remaining

Reordered based on architecture understanding: fix the drain first, then the cache bugs.

| # | Fix | Files | Impact | Design Alignment |
|---|-----|-------|--------|-----------------|
| **P0** | Fix `createBackend("hybrid")` initialisation | `auto-memory-hook.mjs` line 235 | **Unblocks the entire architecture** — JSON cache drains into AgentDB as designed | Core design fix |
| **P0** | Scope bootstrap to current project (ML-006) | `intelligence.cjs` lines 231-244 | Prevents cross-project contamination (51 dirs → 1) | Bug fix |
| **P1** | Fix ID generation: `entries.length` index | `intelligence.cjs` line 276 | Prevents 4,482 duplicates in JSON cache | Bug fix |
| **P1** | Fix `tool_input` snake_case (HK-001) | `hook-handler.cjs` line 157 | Enables file tracking in learning loop | Bug fix |
| **P2** | Fix consolidate() identity guard | `intelligence.cjs` line 554 | Prevents session-over-session accumulation | Bug fix |
| **P2** | Skip consolidation for `file === 'unknown'` | `intelligence.cjs` consolidate() | Prevents garbage entries | Bug fix |
| **P3** | Implement ADR-0049 fail-loud | 132 catch blocks across 2 files | Surfaces all hidden bugs | Unimplemented ADR |
| **Future** | Migrate JSON cache to daemon IPC | `hook-handler.cjs` → daemon socket | Eliminates file I/O, gives hooks access to full in-memory graph | ADR-050 evolution |
| **Future** | Migrate SQLite to RVF | `@claude-flow/memory` | 150x-12,500x faster vector search, 18MB→5.5KB footprint | ADR-057 (Proposed) |

## Consequences

### If P0 Bridge Fix Is Applied

- JSON cache drains into AgentDB at session-end as designed
- SQLite becomes the populated source of truth (not 17 entries while JSON has 157)
- `memory search` (CLI/MCP) returns results from the same data hooks use
- The 8-file sprawl reduces to 3 systems as intended
- Remaining JSON cache bugs become self-healing (drain empties the cache)

### If P0-P2 Fixes Are All Applied

- Additionally: learning loop tracks real files, ID collisions eliminated
- graph-state.json stays under 100KB, scoped to current project
- consolidate() produces useful insight entries, not "unknown" garbage

### If Not Applied

- Two permanent memory silos with no data exchange
- `memory search` returns nothing useful (only 17 manual entries)
- hooks inject ranked context from stale, cross-project, duplicate-inflated JSON
- graph-state.json regrows to 194MB+ (without dedup guard)
- 132 silent catch blocks continue hiding every controller failure

### Relationship to Future ADRs

- **ADR-057 (RVF)**: once merged, SQLite→RVF migration. Does not change the 3-layer architecture. JSON cache still drains into RVF instead of SQLite.
- **ADR-050 evolution (daemon IPC)**: replaces JSON files with socket calls to the running daemon. Eliminates file I/O but keeps the same write-ahead pattern. Requires daemon to be running.
- **ADR-0049 (fail-loud)**: orthogonal to storage architecture. Surfaces bugs in controllers regardless of which backend stores the data.
