# ADR-0058: Memory, Learning & Storage — Deep Analysis

- **Status**: Active (living document)
- **Date**: 2026-04-04
- **Updated**: 2026-04-04
- **Deciders**: ruflo-patch maintainers
- **Methodology**: SPARC + multi-agent swarm analysis

## Context

This ADR documents the findings from a comprehensive swarm-assisted audit of the ruflo memory, learning, and storage subsystems. It traces root causes across both upstream repos (ruflo, agentic-flow) and the ruflo-patch pipeline, cross-referencing ADRs, patches, commits, and upstream issues.

The audit was triggered by investigating upstream issue ruvnet/claude-flow#1204 (12 dead config keys) and expanded to cover the full memory/learning stack after discovering cascading issues.

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

| # | Fix | Files | Impact |
|---|-----|-------|--------|
| P0 | Fix ID generation: `entries.length` index | `intelligence.cjs` line 276 | Prevents 4,482 duplicates |
| P0 | Scope bootstrap to current project (ML-006) | `intelligence.cjs` lines 231-244 | Prevents cross-project contamination |
| P1 | Fix `tool_input` snake_case (HK-001) | `hook-handler.cjs` line 157 | Enables file tracking in learning loop |
| P1 | Fix `createBackend()` for `hybrid` | `auto-memory-hook.mjs` line 235 | Unifies the two memory stacks |
| P2 | Fix consolidate() identity guard | `intelligence.cjs` line 554 | Prevents session-over-session accumulation |
| P2 | Skip consolidation for `file === 'unknown'` | `intelligence.cjs` consolidate() | Prevents garbage entries |
| P3 | Implement ADR-0049 fail-loud | 132 catch blocks across 2 files | Surfaces all hidden bugs |

## Consequences

### If Priority Fixes Are Applied

- Single memory stack (SQLite + HNSW) for all operations
- Learning loop tracks real files, promotes hot files correctly
- graph-state.json stays under 100KB regardless of session count
- Runtime errors visible instead of silent degradation
- Memory entries scoped to current project only

### If Not Applied

- Two permanent memory silos with no data exchange
- Learning loop accumulates garbage ("unknown" file entries)
- graph-state.json may regrow to 194MB+ on unpatched intelligence.cjs
- 132 silent catch blocks continue hiding every controller failure
- Cross-project data contamination on every session start
