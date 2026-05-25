# 2026-05-25 — ADR-130 graph intelligence: upstream trace + archivist impact

## Summary (5 bullets max)

- Upstream ADR-130 (commit `542481053`, impl `edde98f9e`) lands a `graph_edges` table inside upstream's `MEMORY_SCHEMA_V3` plus a thin `graph-edge-writer.ts` that **opens sql.js directly with a module-level `_db` cache and fire-and-forget writes** — zero archivist routing, zero substrate seam, zero invariants.
- The fork has **no `MEMORY_SCHEMA_V3`** (it never picked up upstream's combined schema), has **no `graph_edges` anywhere**, and uses a **different graph table — `causal_edges` (different shape, INTEGER ids, agentdb-internal)** — already audited through the archivist via `agentdb_causal_edge` handler.
- The upstream write path **directly conflicts with ADR-0253 and ADR-0202**: `graph-edge-writer.ts` holds a process-lifetime cached sql.js handle (`_db`/`_dbPath`) and writes via fs.writeFileSync; this is exactly the shape that fork's `scripts/lint-no-daemon-lock-cache.mjs` was built to forbid, and it bypasses the archivist seam entirely.
- **Embedding incompatibility is hard**: upstream's PQ encoder is hard-coded to a 4-byte global-min + global-max for a 384-dim ONNX MiniLM vector (400-byte payload); the fork is 768-dim mpnet. The PQ blob layout is *dimension-agnostic by encoding* but the upstream-emitted blobs will only be interoperable with same-dim same-model peers, and upstream's `getEmbeddingService()` returns MiniLM-384 — every edge written upstream is mathematically incomparable to the fork's mpnet-768 retrieval surface.
- **Recommendation: DEFER the pick whole**, OR partial-pick the `graph_edges` schema only as a fork-archivist-routed `agentdb_graph_edge` handler with mpnet-768 PQ + Archivist write protocol. Six items the queen must resolve before any code lands (listed at the end).

## What ADR-130 introduces

Source: design doc `/Users/henrik/source/ruvnet/ruflo/v3/docs/adr/ADR-130-graph-intelligence-integration.md` (only accessible via `git -C /Users/henrik/source/ruvnet/ruflo show 542481053:v3/docs/adr/ADR-130-graph-intelligence-integration.md`; the file does not exist on upstream HEAD because HEAD is older than the design commit). Implementation source: `git -C /Users/henrik/source/ruvnet/ruflo show edde98f9e --stat` (19 files, 2662 insertions).

ADR-130 unifies four parallel upstream graph layers (graph-node native, AgentDB CausalMemoryGraph, ruflo-knowledge-graph plugin, ruflo-graph-intelligence plugin) onto a single canonical surface:

- **Schema** — adds a `graph_edges` table to `MEMORY_SCHEMA_V3` (`v3/@claude-flow/cli/src/memory/memory-initializer.ts:385-405` in `edde98f9e`). Columns: `id, source_id, target_id, relation, weight, confidence, decay_rate, last_reinforced, witness_id, embedding_ref, metadata, created_at`. Four indexes on `source_id, target_id, relation, last_reinforced`. The temporal columns (`confidence, decay_rate, last_reinforced, witness_id`) are the "graph that forgets" property — read paths multiply `weight × confidence × exp(-decay_rate × days_since_last_reinforced)`. `witness_id` chains every reinforcement to an ADR-103 manifest entry.
- **Embedding encoding** — `v3/@claude-flow/cli/src/memory/embedding-quantization.ts:33-82` (in `edde98f9e`): Int8 PQ encoder, global-scalar (not per-dim), 4-byte magic + 4-byte dims + 4-byte gMin + 4-byte gMax + 1 byte/dim = **400 bytes/384-dim embedding**. Base64-wrapped as `inline:<base64>`. `inlineCosine(refA, refB)` does zero-decode comparison via paired decode and float dot product. Tier names `inline:`, `vector_indexes:`, `rvf:` are placeholders; only `inline:` is wired in P1.
- **Writer** — `v3/@claude-flow/cli/src/memory/graph-edge-writer.ts` (215 lines, `edde98f9e`): module-level `_db: any = null, _dbPath = ''` cache; `getBridgeDb()` reads `getMemoryRoot()/memory.db` via `fs.readFileSync` + `new SQL.Database(fileBuffer)`; `insertGraphEdge()` is fire-and-forget (`try/catch returns false`); `flushDb()` writes the whole sql.js in-memory db back via `fs.writeFileSync`. No locking, no substrate, no archivist, no invariants.
- **Phase 2 query tool** — `agentdb_graph-query` MCP tool in `agentdb-tools.ts:877-1100` (in `edde98f9e`). Three modes: `k-hop` (recursive CTE up to depth 3 if graph-node native unavailable), `semantic` (linear scan of `graph_edges` rows, cosine on inline PQ blobs — *no HNSW*), `pagerank` (PPR power iteration). complexityBudget enforced (`maxNodesVisited, maxDepth, maxMillis, maxMemoryMB`).
- **Phase 3 hooks** — `hooks-tools.ts:1342-1345, 2471-2472` in `edde98f9e`: `hooks_intelligence_trajectory-step` writes `relation: 'trajectory-caused'` edge, `hooks_post-task` (success=true) writes `relation: 'reinforced-by'` edge. Both fire-and-forget via the same `insertGraphEdge` path.
- **Phase 4 plugin contract** — `plugins/ruflo-graph-intelligence/src/adapters/knowledge-graph-adapter.ts:106-170` (in `edde98f9e`): new `GraphEdgesSource implements KnowledgeGraphSource` class; lazy dynamic-import of `@claude-flow/cli/src/memory/graph-edge-writer.js`; reads via `db.exec("SELECT source_id, target_id, relation, weight FROM graph_edges ... LIMIT 100000")`. Optional `graph_adapter` field in plugin.json (`edgeRelations`, `nodeTypes`, `autoRegister`).
- **Phase 5 pathfinder** — `agentdb_graph-pathfinder` MCP tool at `agentdb-tools.ts:1168-1280` (in `edde98f9e`). Six algorithm variants: `personalized-pagerank, dynamic-mincut, spectral-sparsify, temporal-centrality, connected-component-churn, witness-chain-divergence`. `depth > 5` clamped. Loads edges via `getBridgeDb` + `SELECT ... FROM graph_edges LIMIT ?`.
- **Phase 6 benchmarks** — `scripts/benchmark-graph.mjs` reports 2345 ops/sec write, 578 bytes/edge SQLite footprint, 400 bytes/edge raw PQ; p99 k-hop depth=1 = 4.9 ms, p99 PQ encode = 0.063 ms.

## Upstream consumers (writers + readers)

Greps over `git show edde98f9e -- v3/ plugins/ scripts/`:

Writers (any callsite of `insertGraphEdge`):

- `v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts:349,361` — `agentdb_causal-edge` handler dual-writes (graph-node + AgentDB bridge + `graph_edges`) per ADR-130 Risk #2.
- `v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:1342,1345,2471,2472` — `hooks_intelligence_trajectory-step` and `hooks_post-task` write trajectory-caused / reinforced-by edges.

Readers (any callsite of `getBridgeDb`):

- `v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts:958, 984, 1025, 1228` — `agentdb_graph-query` k-hop CTE fallback, semantic mode cosine scan, pagerank mode edge load, `agentdb_graph-pathfinder` edge load.
- `plugins/ruflo-graph-intelligence/src/adapters/knowledge-graph-adapter.ts:138` — `GraphEdgesSource.read()` via lazy import.

Smoke scripts (acceptance harnesses):

- `scripts/smoke-graph-schema-migration.mjs` (298 lines) — Phase 1 schema migration.
- `scripts/smoke-graph-query-dispatch.mjs` (223 lines) — Phase 2 three-mode dispatch.
- `scripts/smoke-trajectory-graph-edges.mjs` (212 lines) — Phase 3 hook side-effects.
- `scripts/smoke-graph-plugin-adapter.mjs` (166 lines) — Phase 4 adapter.
- `scripts/smoke-graph-pathfinder.mjs` (238 lines) — Phase 5 pathfinder.
- `scripts/benchmark-graph.mjs` (259 lines) — Phase 6 benchmark.

No `EdgeWriter` class exists (the prompt's term); the upstream surface is the module-level functions in `graph-edge-writer.ts`. No `GraphIntelligence` class either — `ruflo-graph-intelligence` is a separate plugin not modified by `edde98f9e`.

## Fork archivist architecture today

Summarized from ADR-0253, ADR-0177, ADR-0246, plus live fork code reading.

**Substrate axes (post-ADR-0177):**

- `memory_*` axis — RVF primary via `@ruvector/rvf` `.rvf` single-file Cognitive Container (ADR-0177 supersedes ADR-0170/0174/0175); SQLite carve-outs only for the 5 ADR-0166 controllers.
- `agentdb_*` axis — RVF primary; SQLite-carve-out controllers (CausalMemoryGraph, CausalRecall, NightlyLearner, LearningSystem, ...) share a single better-sqlite3 handle per ADR-0166; Phase 7 collapsed cli + archivist onto one SQLite handle for hierarchical/reflexion/skill (ADR-0246 F-03-002 audit-vs-storage rationale, `forks/agentdb/src/archivist/handlers/agentdb/causal-edge.ts:31-43`).
- No `graph_*` axis — ADR-0177 folded ADR-0174's third axis back into RVF.

**Storage map:**

- `memory_entries` table — schema at `forks/ruflo/v3/@claude-flow/memory/src/memory-schema.ts:14-32` (55-line file; only `MEMORY_ENTRIES_DDL` + `MEMORY_ENTRIES_INDEXES` + `MEMORY_EMBEDDINGS_DDL`). Consumed by `sqlite-backend.ts:712` and `agentdb-backend.ts:765`. **No `MEMORY_SCHEMA_V3` exists in the fork at all** — fork never adopted upstream's combined memory schema.
- `causal_edges` table — fork-only, INTEGER ids, `from_memory_id/to_memory_id/from_memory_type/to_memory_type/similarity/uplift/confidence/sample_size/evidence_ids/experiment_ids/confounder_score/mechanism/created_at` schema at `forks/agentdb/src/schemas/frontier-schema.sql:14-44` and `forks/agentdb/src/mcp/agentdb-mcp-server.ts:137-153`. Written by `forks/agentdb/src/controllers/CausalMemoryGraph.ts:209`. Different shape entirely from upstream `graph_edges`.
- HNSW for memory entries — `M:23, efConstruction:100, efSearch:50` per ADR-0246 F-03-003 + memory `reference-embedding-model.md`. Set via `forks/agentdb/src/core/config-chain.ts:38-46 deriveHNSWParams(768)`.

**Archivist routing:**

- Charter: `forks/agentdb/src/archivist/MODULE.md`; 10 in-scope responsibilities (`dispatch, audit-chain, type-enforcement, substrate-seam, guard-policy, testing-surface, hot-path-fast-path, mutation-invariants, lazy-init, replay-verification`).
- Causal edge handler: `forks/agentdb/src/archivist/handlers/agentdb/causal-edge.ts:80-121` — registers as `GuardedWrite<AgentdbCausalEdgePayload>` with invariants from `forks/agentdb/src/archivist/invariants/agentdb/causal-edge.ts`. Routes through `ctx.capabilities.requireCausalGraphWriter()` + `ctx.substrate.withWrite({ storeId: 'agentdb_causal_edge' })` (SQLite carve-out).
- Capability factory: `forks/agentdb/src/archivist/index.ts:350-364` — `causalGraphWriterFactory` adapts cli's `recordCausalEdge` → `routeCausalOp({ type:'edge' })` (controller-first + router-fallback).
- Staging substrate: `forks/agentdb/src/archivist/staging-substrate.ts:17-32, 367-385` (header carve-out + in-lock-commit). FS-JSON commits in-lock per ADR-0123 durability; RVF + SQLite use staged journal/SAVEPOINT (ADR-0246 F-03-002 path b).
- Daemon archivist (ADR-0253 C1): `forks/ruflo/v3/@claude-flow/cli/src/services/worker-daemon.ts:196-206` — daemon's per-process Archivist is FS-JSON-substrate-only by design (the chokepoint can't be its own consumer; permanent carve-out).
- Two unmigrated workers (ADR-0253 C2): `runConsolidateWorker` (worker-daemon.ts:1536) and `runPreloadWorkerLocal` (worker-daemon.ts:1703) — hold the RVF flock per-tick below the archivist seam; deferred-migration to ADR-0180 Phase 7.

**ADR-0202 lint rule** — `scripts/lint-no-daemon-lock-cache.mjs` (the structural rule named in ADR-0253 C2 evidence and ADR-0202 §"Confirmation") forbids module-scope substrate handle caching in `worker-daemon.ts`.

## Schema compatibility

| Aspect | Upstream `graph_edges` (ADR-130) | Fork `causal_edges` (frontier-schema.sql) | Fork `memory_entries` (memory-schema.ts) |
|---|---|---|---|
| ID column | `id TEXT PRIMARY KEY` (UUID-prefixed `edge-{uuid}`) | `id INTEGER PRIMARY KEY AUTOINCREMENT` | `id TEXT PRIMARY KEY` |
| Source/target | `source_id TEXT, target_id TEXT` (domain-prefixed: `mem:`, `agent:`, etc.) | `from_memory_id INTEGER, from_memory_type TEXT enum, to_memory_id INTEGER, to_memory_type TEXT enum` | n/a |
| Relation typing | `relation TEXT` (free-form e.g. `caused`, `depends-on`, `trajectory-caused`, `reinforced-by`) | `mechanism TEXT` (free-form causal hypothesis) | n/a |
| Weight | `weight REAL DEFAULT 1.0` | `uplift REAL` (causal: `E[y|do(x)] - E[y]`) + `similarity REAL` | n/a |
| Confidence/temporal | `confidence REAL, decay_rate REAL, last_reinforced TEXT (ISO-8601), witness_id TEXT` | `confidence REAL, sample_size INTEGER, last_validated_at INTEGER (epoch)` | n/a |
| Embedding | `embedding_ref TEXT` (placeholder for `inline:{base64}` PQ-int8 384-dim, `vector_indexes:{id}`, `rvf:{cid}`) | n/a (causal edges are scalar+JSON, no embedding) | `memory_embeddings` separate table, `embedding BLOB` 768-dim mpnet (FK to `memory_entries.id`) |
| Metadata | `metadata TEXT` (JSON blob) | `metadata JSON` + `evidence_ids TEXT (JSON array)` + `experiment_ids TEXT (JSON array)` | `metadata TEXT NOT NULL` + `tags TEXT NOT NULL` |
| Indexes | 4: source_id, target_id, relation, last_reinforced | 4: from_memory composite, to_memory composite, uplift DESC, confidence DESC | 8: namespace, key, namespace+key, type, owner_id, created_at, updated_at, expires_at |
| Embedding model assumption | 384-dim MiniLM (`memory-bridge.ts:84-85, 1042, 1227 'Xenova/all-MiniLM-L6-v2'` in upstream) | n/a | 768-dim mpnet (`resolve-config.ts:96-97 DEFAULT_MODEL = 'Xenova/all-mpnet-base-v2'; DEFAULT_DIMENSION = 768`) |
| HNSW assumption | `vector_indexes` default `hnsw_m 16, ef_construction 200, ef_search 100` (memory-initializer.ts:361-363) | n/a | mpnet canonical `M:23, efC:100, efS:50` (config-chain.ts deriveHNSWParams) |

**Verdict: Would `graph_edges` slot into the fork's existing schema cleanly?** No.

1. **No host schema.** The fork has no `MEMORY_SCHEMA_V3` to extend — only the 55-line `memory-schema.ts` for memory_entries. Importing the upstream schema wholesale would land 8 new tables (memory_entries v3, patterns, pattern_history, trajectories, trajectory_steps, migration_state, sessions, vector_indexes, graph_edges, metadata) that the fork's RVF-primary architecture (ADR-0177) explicitly rejects — `vector_indexes` overlaps the fork's RVF substrate; `patterns/trajectories/sessions` overlap the fork's RVF-routed pattern storage.
2. **Graph table shape mismatch.** Fork has `causal_edges` with INTEGER ids + enum memory types tied to AgentDB's controller-numeric-id space; upstream uses TEXT ids with `domain:` prefixes. Adopting `graph_edges` as a second graph table without retiring `causal_edges` produces two parallel graph tables (a five-layer fragmentation, not the four-layer one ADR-130 was attacking).
3. **HNSW defaults conflict.** Upstream `vector_indexes` defaults to `M:16, efC:200, efS:100`; fork's canonical is `M:23, efC:100, efS:50`. ADR-0246 F-03-003 (CRITICAL) was specifically the fix that wired `deriveHNSWParams` to enforce mpnet-768 defaults at the factory.
4. **Witness chain divergence.** `witness_id` in upstream refers to `verification/witness-fixes.json` per ADR-103 (upstream-only ADR); fork has no equivalent. The fork's audit chain is the archivist's audit log per ADR-0180; mapping `witness_id` to that would require a new translation.

## Archivist write-path conflict

**`graph-edge-writer.ts` bypasses the archivist entirely.** Evidence:

- Zero references to `withWrite`, `substrate`, `archivist`, `MutationContext`, `GuardedWrite`, `registerMutationHandler` in `graph-edge-writer.ts` or `embedding-quantization.ts` (verified by grep).
- Writes via direct `fs.writeFileSync` in `flushDb()` at `graph-edge-writer.ts:92-94` — outside any substrate seam.
- Module-level handle cache: `let _db: any = null; let _dbPath = '';` at `graph-edge-writer.ts:28-29` — process-lifetime substrate handle, **exactly the shape `scripts/lint-no-daemon-lock-cache.mjs` is built to forbid** (ADR-0202 §"Confirmation"; ADR-0253 C2 evidence).
- `insertGraphEdge()` is fire-and-forget (`} catch { return false; }` at `graph-edge-writer.ts:158-160`) — violates `feedback-no-fallbacks` and `feedback-best-effort-must-rethrow-fatals` (data-loss errors swallowed silently).

**Conflict against ADR-0253:**

- ADR-0253 C1 (daemon Archivist FS-JSON) — not directly violated (upstream writes to `memory.db` sql.js, not the daemon's FS-JSON store), but the daemon's archivist becomes invisible to upstream's writes (they bypass it).
- ADR-0253 C2 (two RVF-lock-holding workers) — graph-edge-writer adds **a third** module-scope lock-holding code path. ADR-0202's lint is module-scope-cache-banned; importing graph-edge-writer.ts as-is would either (a) fail the lint, or (b) require an exemption that re-opens ADR-0253's framing.
- ADR-0253 C3 (FS-JSON in-lock commit) — orthogonal; the upstream write path is sql.js + fs.writeFileSync, not FS-JSON.

**Conflict against ADR-0246:**

- F-03-002 fix landed mutation-invariants for FS-JSON via `staging-substrate.ts`; RVF + SQLite use staged journal/SAVEPOINT. The graph-edge-writer's `INSERT OR IGNORE INTO graph_edges` runs **outside** any of these — no invariants fire, no audit chain entry, no `intent → applied|rejected` transition. The "graph_edges write" becomes a silent side-effect that audit replay cannot reproduce.
- F-03-001 (RVF metric not re-probed on reopen) — orthogonal; graph-edge-writer doesn't touch RVF at all.

**Conflict against ADR-0177:**

- ADR-0177 §"Substrate decisions (fork-wide)" puts the `agentdb_*` axis on RVF primary. The upstream `graph_edges` write lands in `getMemoryRoot()/memory.db` sql.js — a **separate database file** from the fork's RVF substrate. The fork's archivist routes `agentdb_causal_edge` through SQLite carve-out (per ADR-0166), but that's the *AgentDB-controlled* SQLite handle (`forks/agentdb/src/archivist/handlers/agentdb/causal-edge.ts:55-58`), not the upstream graph_edges' sql.js write target. Two SQLite stores would coexist with no coordination.

**The conflict is structural, not cosmetic.** Adopting upstream `graph-edge-writer.ts` as-shipped re-introduces the exact pattern ADR-0181/0202/0246/0253 were authored to forbid: module-scope handle cache, fire-and-forget writes, no audit, no invariants, no substrate seam.

## Embedding encoding compatibility

Per `embedding-quantization.ts:33-82` upstream's PQ encoder semantics:

- **Dimension-agnostic by encoding**: the blob layout is `[4-byte magic][4-byte dims uint32][4-byte gMin float32][4-byte gMax float32][dims × 1-byte quant]`. A 768-dim encode would produce `4+4+4+4+768 = 784 bytes` (vs the 400-byte ADR-130 budget assumption for 384-dim).
- **Dimension-LOCKED by upstream's callers**: every upstream caller of `encodeEmbedding()` feeds it the result of `generateEmbedding()` (from `memory-initializer.ts:413`) which defaults to **384-dim MiniLM** (`getEmbeddingService()` in upstream uses `Xenova/all-MiniLM-L6-v2`, confirmed via `memory-bridge.ts:84-85, 1042, 1227`).
- **Cosine semantics are model-locked**: PQ-quantized cosine on two MiniLM-384 blobs is comparable; PQ-quantized cosine on mpnet-768 blobs is comparable to itself; **PQ-quantized cosine MiniLM-384 vs mpnet-768 is mathematically meaningless** (different vector spaces, different ranges, different geometric properties). The PQ encoder doesn't know which model produced its input.
- **The fork's mpnet retrieval surface is already at risk**: per memory `project-memory-search-rvf-snapshot-isolation`, the `2cos − 1` trap from ADR-0073 + the 0.3 floor from ADR-0227 were both adaptive to mpnet-768's score distribution. Upstream MiniLM-384 PQ-encoded scores would land in a different distribution; the fork's adaptive floor 0.3 → 0.15 (ADR-0227) was tuned for mpnet — would need re-tuning.

**`embedding_ref` semantics in upstream:**

- The fork shares no embedding store with `graph_edges`. The `embedding_ref` field is opaque-text: `inline:<base64>` is self-contained PQ blob (no external link); `vector_indexes:{id}` and `rvf:{cid}` are **placeholder tier names** in `getEmbeddingRefTier()` at `embedding-quantization.ts:147-153` — but only `inline:` is wired in P1. The `vector_indexes` tier would point at `vector_indexes` SQL rows (a separate upstream sql.js table the fork doesn't have); the `rvf:` tier is unimplemented.
- **No sharing path exists**. Each graph edge embedding is independent of memory_entries embeddings. Even if the fork picked `graph_edges`, the embeddings would not be deduplicated against existing memory_entries embeddings — they'd be a parallel store.

**Verdict: incompatible.** PQ-int8 is a fine compression scheme in principle (4× reduction, fast inline cosine), but upstream's wiring locks it to MiniLM-384. Re-targeting to mpnet-768 needs: (a) bumping the budget from 400B to 784B per edge, (b) wiring `generateEmbedding()` to call the fork's `getEmbeddingService()` (mpnet), (c) recalibrating any threshold consumer of PQ cosine.

## Performance overlap

Per memory `project-fork-only-controllers` the fork's RVF/HNSW path delivers "150x-12500x faster semantic retrieval via HNSW" via the eight fork-only controllers (HierarchicalMemory, MemoryConsolidation, RVFOptimizer, etc.).

ADR-130's reported numbers (per `scripts/benchmark-graph.mjs` in commit `edde98f9e`):

- Write throughput: 2345 ops/sec (>500 target)
- SQLite footprint: 578 bytes/edge; PQ raw: 400 bytes/edge
- k-hop depth=1 p99: 4.9 ms; depth=3 p99: 0.1 ms
- PQ encode p99: 0.063 ms; decode p99: 0.031 ms

**ADR-130 does NOT use HNSW for graph_edges retrieval.** The Phase 2 `semantic` mode at `agentdb-tools.ts:984-1010` is a **linear scan**: `SELECT ... FROM graph_edges WHERE embedding_ref IS NOT NULL LIMIT ?` followed by per-row PQ decode + cosine. `complexityBudget.maxNodesVisited` (default 10,000) is the only scaling guard. No HNSW index is built over `graph_edges.embedding_ref`. This is fine for the 1,000-edge scale ADR-130 measures, but it does NOT supersede or integrate with the fork's HNSW path — it's a parallel, linear-scan substrate.

**Overlap shape:**

- The fork's HNSW path indexes `memory_entries.embedding` (mpnet-768, M:23/efC:100/efS:50). It serves `memory_search` / `agentdb_pattern_search` / `agentdb_filtered_search`.
- ADR-130's graph_edges path is its own embedding store with no HNSW. It serves `agentdb_graph-query mode=semantic` / `agentdb_graph-pathfinder`.
- They are **complementary, not competing**. The fork's HNSW would still handle memory retrieval; ADR-130's PQ-linear-scan would handle graph traversal seeded on a node.
- BUT: ADR-130 explicitly claims (Phase 6 benchmark commentary) that `agentdb_graph-pathfinder` operates as the "RETRIEVE backbone." In the fork, retrieval is already HNSW-backed. Layering linear-scan PQ on top of HNSW would degrade — not improve — retrieval performance for graph-seeded queries.

## Dependencies

Cross-repo coupling from commit `edde98f9e`:

- `sql.js` — added to root `npm install --legacy-peer-deps` (per the CI fix commits in the squash: graph-schema-smoke, graph-query-smoke). The fork already has sql.js (per `forks/agentdb/src/backends/rvf/RvfBackend.ts:200` — SqlJsRvfBackend). No new dep.
- `@ruvector/graph-node` — optional native dep, dispatched-to when available per ADR-130 Phase 2. Fork has graph-node integration via ADR-087; status unverified for ADR-130 compatibility.
- `ruflo-graph-intelligence` plugin — only modified in Phase 4 (GraphEdgesSource added). The plugin itself is upstream-only (per ADR-130 §Context Layer 4: `ruflo-graph-intelligence@0.1.0-alpha.1` is unpublished); fork has no consumer of this plugin.
- `verification/macos/manifest.md.json` — updated by `edde98f9e` (witness manifest). Fork's witness path is different (ADR-103 is upstream-only; fork has no `verification/` directory in this shape).
- Package version bumps — `e1bd1f072` bumps all packages to 3.10.0 for ADR-130 P4+P5+P6. Picking partial would force a version dance.

**No cross-repo coupling against `forks/agentdb` per se** — ADR-130's writer is in `v3/@claude-flow/cli/src/memory/`, not in `agentdb/`. But the fork's archivist (which lives in `forks/agentdb/src/archivist/`) would either be bypassed (if upstream is taken as-is) or would need a new `agentdb_graph_edge` handler (if partial-picked properly).

## Open questions for the queen

1. **Is the fork still in ADR-0253-shape (FS-JSON daemon + RVF flock workers as carve-outs)?** If yes, ADR-130's module-scope `_db` cache is forbidden by ADR-0202's lint and contradicts ADR-0253's "no new module-scope substrate handles" implication. If the queen wants to relax that, ADR-0253 itself needs amendment.
2. **Does the fork want `graph_edges` as a fork-native table, or stay with `causal_edges`?** They are different shapes (TEXT domain-prefixed IDs vs INTEGER controller IDs + memory-type enum). Picking ADR-130 means either (a) two parallel graph tables (5 layers), (b) retire `causal_edges` (breaking ADR-0181 Item 3 / ADR-0147 R7), or (c) translate `graph_edges` writes to `causal_edges` (loses the temporal-decay + witness_id semantics that ADR-130 is *about*).
3. **Is the embedding model migration acceptable?** ADR-130's PQ cosine is meaningful only within one model's vector space. Picking ADR-130 as-shipped means MiniLM-384 graph edges coexist with mpnet-768 memory entries — different distributions, can't cross-compare. Re-targeting to mpnet-768 means 784B/edge (not 400B/edge) and recalibrating ADR-0227's adaptive floor.
4. **Does the fork pick the temporal/decay semantics (`confidence`, `decay_rate`, `last_reinforced`)?** These are the differentiating property of ADR-130 (the "graph that forgets"). The fork's `causal_edges.confidence + last_validated_at` is similar-shaped but with different semantics (causal-inference confidence intervals, not retrieval decay). Mapping requires a decision.
5. **What's the audit-chain story for graph writes?** Upstream graph writes are fire-and-forget with errors swallowed. The fork's archivist requires every mutation to transition `intent → applied|partial|failed|rejected` with audit entries. Picking ADR-130 means either (a) wiring a new `agentdb_graph_edge` archivist handler (fork-only divergence), (b) accepting silent graph writes (violates `feedback-no-fallbacks` / `feedback-best-effort-must-rethrow-fatals` / ADR-0181 audit-vs-storage rationale), or (c) deferring the whole pick.
6. **What's the witness chain mapping?** ADR-130 `witness_id` points at upstream's `verification/witness-fixes.json` (ADR-103 lineage). The fork has no equivalent. If the queen wants to preserve the "every reinforcement is auditable" property, the fork needs an analogue (probably the archivist's audit chain entry id) or accepts NULL `witness_id` everywhere (downgrades the feature to silent).

---

## Verdict (for the queen's vote)

**DEFER the whole pick.** Partial-pick is possible but expensive: it requires a fork-only ADR (`agentdb_graph_edge` handler routed through the archivist, with mpnet-768 PQ encoder at 784B/edge, with `witness_id` re-mapped to archivist audit-chain ids, with `causal_edges` retire/coexist disposition resolved). The shipped upstream surface conflicts with ADR-0202, ADR-0246, ADR-0253, ADR-0177 in ways that can't be reconciled by codemod.

**Archivist conflicts the queen needs to know:**

- Module-scope `_db` cache in `graph-edge-writer.ts:28-29` violates ADR-0202 `scripts/lint-no-daemon-lock-cache.mjs`.
- Fire-and-forget writes at `graph-edge-writer.ts:120-161` violate `feedback-no-fallbacks` + `feedback-best-effort-must-rethrow-fatals` + ADR-0246 F-03-002 mutation-invariants contract.
- Direct `fs.writeFileSync` in `flushDb()` (graph-edge-writer.ts:92-94) bypasses the archivist substrate seam (ADR-0180 §Architecture).
- `memory.db` write target conflicts with ADR-0177's RVF-primary axis decision; would land a second SQLite file outside the fork's substrate map.
