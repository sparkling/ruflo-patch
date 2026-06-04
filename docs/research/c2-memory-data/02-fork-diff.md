# C2 Memory & Data substrate — Fork Diff (classified deltas)

**Protocol:** ADR-0292 step 4. **Null hypothesis:** upstream works; fork divergence is the bug (FORK-REGRESSION is the default for any delta). **Validation bar:** ADR-0291 §Confirmation (5-point) — binding before any UPSTREAM-BROKEN verdict.
**Author:** fork-auditor (queen-led C2 swarm). **Date:** 2026-06-04.

> **DA review (2026-06-04) — all 3 regressions + the M1 framing UPHELD on independent re-drive** (`/tmp/c2-evidence/da/`); the DA's own fallback-artifact counter-hypothesis for M1 was REFUTED (upstream sql.js is primary-by-design: node-24, native better-sqlite3 loads fine, `initSqlJs` is the primary path with `backend:"sql.js + HNSW"` hardcoded at 8 sites, no native branch in the memory write path). Errata applied: `agentdb_batch` reclassified NOT-DEMONSTRATED-both-sides (fork cold `rate_limited` reproducible ×3 fresh processes — NOT transient); Regression #3 re-characterized (fork RETAINS the 205-line `rabitq-index.js` wrapper + declares `@sparkleideas/ruvector-rabitq-wasm@^0.1.0` — the gaps are MCP tools never registered + wasm pkg not installed, so the disposition is WIRE+INSTALL, not a removal to re-justify); G7 count precision (only **2** of the README's named five are ON — semanticRouter is G7-family ON-but-inert and NOT among the named five).
**Diffed against:** the upstream proof record `01-upstream-proof.md` (ruflo 3.10.36, sql.js + HNSW, MiniLM-384).

## Environment record (exact)

| Component | Value |
|---|---|
| Fork project | `/tmp/ruflo-fork-c2` — `ruflo init --full --force` + `ruflo memory init`, Verdaccio registry (`http://localhost:4873`) |
| `@sparkleideas/ruflo` (wrapper) | `3.1.0-alpha.14-patch.389` |
| `@sparkleideas/cli` | **`3.7.0-alpha.10-patch.415`** (`ruflo v3.7.0-alpha.10-patch.415`) |
| `@sparkleideas/agentdb` | **`3.0.0-alpha.14-patch.427`** |
| MCP serverInfo | `ruflo 3.0.0` (matches upstream's protocol server version) |
| Embedding model | **`Xenova/all-mpnet-base-v2`, 768-dim** (upstream: MiniLM-L6-v2, 384-dim — divergence by design, ADR-0052) |
| Memory backend (live) | **`archivist (RVF + HNSW)`** / `RVF + HNSW` — `.swarm/memory.rvf` is the authoritative store (grew 290 B → 80 KB across drives); SQLite `.swarm/memory.db` holds relational sidecars (causal/hierarchical/patterns). **No `memory_entries` table exists** (upstream's single source of truth) |
| Node | v24.14.1 (native `better-sqlite3`; the resolved daemon-node-version trap is not in play) |
| Tool count | 317 MCP tools (upstream: 293). agentdb family: ~50 (upstream: 20). |
| Bin driven | `node_modules/@sparkleideas/cli/bin/cli.js` directly (per `project-adr0284-rvf-single-lock-collapse` — wrapper `.bin/ruflo` is a thin in-proc proxy to the same file; ADR-0142) |
| Raw evidence | `/tmp/c2-evidence/fork/` — `ragmem-results.jsonl`, `agentdb-results.jsonl`, `agentdb2-results.jsonl`, `kg2-results.jsonl`, `migrations-results.jsonl`, `rvf-results.jsonl`, `toollist.json`, `schemas.json`; SQLite dumps + controller state in `logs/` |

> **Harness note (recorded so the DA doesn't misread it):** the first `memory_store` against a long-lived MCP server hung at 100% CPU for minutes **only when the `NODE_OPTIONS --require fswrites-shim.cjs` write-trace was active** — the JS fs-hook deadlocked the server's native RVF/onnxruntime write loop. With the shim removed the identical store returns in 36–394 ms. The CLI one-shot `ruflo memory store` was never affected. **Conclusion: harness artifact, NOT a fork defect.** All behavioural drives below ran without the shim; persistence was verified by **direct store-content dumps** (the protocol's preferred "content not counters" method — and RVF writes are native Rust, invisible to a JS fs hook anyway). Also: the mpnet-768 model (~110 MB quantized) downloaded fresh into the project `node_modules/@xenova/.cache` on first use (one-time, ~3 min); the model itself is healthy (CLI store stamped "Vector: Yes (768-dim)" instantly once warm).

## Headline divergences (the substrate the fork diverged from hardest)

1. **RVF-as-sole-truth replaces upstream's sql.js `memory_entries`** (ADR-0086/0091/0177). Upstream 3.10.36 runs LIVE on `sql.js + HNSW` with `memory_entries` as the single source of truth (the queen's proof + `memory init` help "sql.js (WASM SQLite)"). The fork removed the sql.js memory path entirely and routes `memory_*` to `.swarm/memory.rvf` via the archivist. **For memory CRUD this is a FORK-AHEAD divergence that is NOT a regression** — store/search/list/retrieve/unified all work with real mpnet-768 cosine ranking (scores 0.28/0.62; adaptive 0.15 floor per ADR-0227 lets mpnet's ~0.25–0.28 related scores survive). The read-back contract holds.
2. **`agentdb_causal-edge` rerouted away from `graph_edges` → breaks `agentdb_graph-query`/`graph-pathfinder`/`kg traverse`.** This is the **top FORK-REGRESSION** (content-verified, full bar). Detail below.
3. **G7 controllers partially ON in the fork** (gnnService, rvfOptimizer + the G7-family semanticRouter) where upstream 3.10.36 has all of them OFF — FORK-AHEAD, but the agentdb/kg README claim "ADR-095 activated **five**" is **stale/overclaimed**: of the README's named five, only **two** are actually enabled (gnnService, rvfOptimizer); semanticRouter is ON-but-inert and is NOT among the named five; mutationGuard, attestationLog, guardedVectorBackend remain OFF in the fork too. *(Count corrected per DA review.)*

## Classified delta table

Legend: **FORK-REGRESSION** (works upstream, broken/diverged in fork — the default) · **FORK-AHEAD** (fork capability absent upstream) · **PARITY** · **UPSTREAM-BROKEN** (full bar + root cause).

### ruflo-rag-memory (memory CRUD + recall + bridge)

| Feature | Upstream | Fork | Class | Evidence |
|---|---|---|---|---|
| `memory_store` | `{backend:"sql.js + HNSW", embeddingDimensions:384}` → `memory_entries` | `{backend:"archivist (RVF + HNSW)", embeddingDimensions:null}` → `.swarm/memory.rvf` | **FORK-AHEAD (storage engine)** + minor honesty gap | `ragmem-results` mem-store-1; RVF 290B→80KB |
| `memory_retrieve` | full value+tags, `accessCount` bumped | identical, `accessCount` bumped to 2; `backend:"SQLite + HNSW"` | PARITY | mem-retrieve-key |
| `memory_search` (dense) | real cosine 0.73/0.65 | real cosine **0.284/0.281** (mpnet scale); results returned at default threshold (adaptive 0.15 floor) | PARITY (functional) | mem-search-related; `threshold:-1` identical |
| `memory_search --smart` | `{backend:"SmartRetrieval (RRF+MMR+Recency)"}` pipeline live | returns ranked results (0.249/0.168) — pipeline live | PARITY | mem-search-smart |
| `memory_search_unified` | cross-ns ranked, `source:"agentdb"` 0.64/0.62 | cross-ns ranked, `source:"agentdb"` **0.623** | PARITY | mem-search-unified |
| `memory_list` | `{backend:"sql.js + HNSW"}` | `{backend:"SQLite + HNSW"}` (label drift vs store/stats) | PARITY (cosmetic label drift) | mem-list-patterns |
| `memory_stats` | `{totalEntries, embeddingCoverage:"100.0%", backend:"sql.js + HNSW"}` | `{totalEntries:6, embeddingCoverage:"100.0%", backend:"RVF + HNSW", location:.swarm/memory.rvf, hnswIndex:true}` | PARITY | mem-stats |
| CLI `memory stats` | — | reports **`HNSW Index: not active`** (contradicts MCP `hnswIndex:true`) | divergence (cosmetic) — known: ADR-0257 anomaly #5, "<32 entries" diagnostic | `logs/cli-store-probe.log` region |
| `memory_delete` | `{deleted:true, hnswIndexInvalidated:true}` | `{success:true, deleted:true}` | PARITY | mem-delete |
| `memory_bridge_status` | `{claudeCode{memoryFiles:368, projects:11}, bridge{status:"connected", embedding:"all-MiniLM-L6-v2 (384-dim)"}}` | `{claudeCode{memoryFiles:368, projects:11}, agentdb{backend:"SQLite + ONNX"}, bridge{status:"not-synced", embedding:"all-MiniLM-L6-v2 (384-dim)"}}` | PARITY (bridge embedding label still says MiniLM-384 — see note) | mem-bridge-status |
| `memory_import_claude` | not actively driven (368 real files) | `{...}` ran with `allProjects:false`, ms=5 | PARITY (not destructively driven) | mem-import-claude-noproj |
| `memory_export` | not driven (needs `outputPath`) | `-32602` missing `outputPath` (my arg omission, not a bug) | NOT-DRIVEN (arg) | mem-export; schema confirms `outputPath` required |

> **Bridge embedding-label oddity (flag, not a verdict):** `memory_bridge_status` reports `embedding:"all-MiniLM-L6-v2 (384-dim)"` even though the live memory store uses **mpnet-768**. The bridge sidecar advertises the upstream MiniLM string. Likely a stale literal in the bridge-status handler (the bridge's own ONNX path vs the memory store's mpnet path). Worth a fork follow-up; harmless to recall.

### ruflo-agentdb (substrate — 15→~50 agentdb_*, 7→7 embeddings_*, 3 ruvllm_hnsw_*)

| Feature | Upstream | Fork | Class | Evidence |
|---|---|---|---|---|
| `agentdb_health` | `{available:true, controllers:[…23 warm…]}` | `{available:true, controllers:42}` | FORK-AHEAD (controller superset) | adb-health |
| `agentdb_controllers` (warm) | 23 (15 enabled / 8 disabled) | **42 (33 enabled / 9 disabled)** | FORK-AHEAD | adb-controllers; `logs/controllers-state.txt` |
| **G7: gnnService** | OFF | **ON** | FORK-AHEAD | controllers-state |
| **G7: rvfOptimizer** | OFF | **ON** | FORK-AHEAD | controllers-state |
| **G7-family: semanticRouter** (NOT among the README's named five) | OFF | **ON** (but `semantic-route`→"No route matched") | FORK-AHEAD (enabled, inert) | controllers-state |
| G7: mutationGuard / attestationLog / guardedVectorBackend | OFF | **OFF** | PARITY (README "activated five" is stale — only 2 of its named five are ON) | controllers-state |
| `agentdb_hierarchical-store` | `{success:true, tier}` → `memory_entries` (type=semantic) | `{success:true, tier, controller:"archivist"}` → `hierarchical_memory` (SQLite, 4 rows) + RVF | PARITY (functional) | adb2-hier-store-*; `hierarchical_memory`=4 |
| `agentdb_hierarchical-recall` | returns entities `{controller:"hierarchicalMemory"}` | returns entities, score 0.5, `{controller:"archivist"}` | PARITY | adb2-hier-recall (found c2hier-s1/w1) |
| `agentdb_hierarchical-store` bad tier | rejects | rejects `-32602 tier must be working|episodic|semantic` | PARITY | adb2-hier-store-badtier |
| `agentdb_pattern-store` | `{controller:"memory-store-fallback"|"bridge-fallback", note:"…persisted"}` (ADR-093 F4) | `{success:true, controller:"archivist"}` → `reasoning_patterns`/`pattern_embeddings` (SQLite) | divergence (mechanism) — fork routes via archivist not the documented fallback | adb-pattern-store; `reasoning_patterns`=1 |
| `agentdb_pattern-search` | `{results:[], controller:"memory-store-fallback", tier:"substring"}` | `{results:[{score:0.843}], controller:"archivist"}` — real vector hit | PARITY / fork higher recall | adb-pattern-search |
| **`agentdb_causal-edge`** | `{backend:"graph-node", _graphNodeBackend:true}` → **`graph_edges`** | `{controller:"archivist"}` → **`causal_edges`** (CausalMemoryGraph, ADR-0276), `graph_edges` stays empty | **FORK-REGRESSION (downstream: breaks graph-query/pathfinder)** | adb2-causal-edge; `causal_edges`=2, `graph_edges`=0 |
| **`agentdb_graph-query`** (k-hop / semantic / pagerank) | real topology + scores (`sql-cosine` 0.81, `sql-ppr` 0.126) traversing `graph_edges` | **ALL EMPTY** — `{backend:"archivist-khop"/"archivist-cosine", results:[], message:"graph_edges is empty"}` | **FORK-REGRESSION** | adb2/kg2-graph-query-*; full bar (below) |
| **`agentdb_graph-pathfinder`** | `{algorithm:"personalized-pagerank", paths:[{UserService 0.126}]}` traverses `graph_edges` | **`{paths:[], message:"no edges found"}`** | **FORK-REGRESSION** | adb2/kg2-graph-pathfinder |
| `agentdb_graph_node_create`/`_get` | (upstream uses graphAdapter; off → causal-edge path covers it) | `{success:false, error:"graphAdapter not available (must be enabled in config)"}` | divergence — graphAdapter OFF (parity with upstream-off) but fork has no working graph-node fallback | kg2-graph-node-create-1/2/get |
| `agentdb_causal-query` (**fork-only**) | absent upstream | `{results:[{AuthController→UserService}], count:1, controller:"causalGraph+fallback"}` — reads `causal_edges` | **FORK-AHEAD** (the working read path for fork causal edges) | adb2-causal-query |
| `agentdb_causal-recall` (**fork-only**) | absent upstream | `{results:[], count:0, controller:"archivist"}` | FORK-AHEAD | adb2-causal-recall |
| `agentdb_semantic-route` | `{route:null, error:"SemanticRouter not available…", recommendation:"Use agentdb_route"}` (explicit redirect) | `{success:false, route:null, error:"No route matched"}` (semanticRouter ON, no routes) — **and a cold first call returned bare `null`** | divergence (less honest than upstream's explicit redirect) | adb-semantic-route (null) / adb2-semantic-route ("No route matched") |
| `agentdb_route` | `{route:"general", confidence:0.5, controller:"fallback"}` | `{success:true, controller:"archivist"}` | PARITY (functional) | adb-route |
| `agentdb_context-synthesize` | cold `{error:"ContextSynthesizer not available"}`; warm works | `{success:true, synthesis:{summary:"No relevant memories found.", totalMemories:0}}` — honest empty, works | PARITY | adb-context-synth |
| `agentdb_batch` (insert) | cold `{error:"Embedder not initialized…"}` precondition envelope (warm success NEVER demonstrated — DA re-drive also failed warm) | `{success:false, error:"rate_limited", retryAfter:1000}` on the FIRST call in a fresh process with a single entry — DA-reproduced ×3 fresh processes, NOT transient | **NOT-DEMONSTRATED both sides (open)** — do not classify FORK-REGRESSION (upstream batch also unproven); fork cold-`rate_limited` flagged as follow-up | adb2-batch-insert; DA `new-finding-batch.md` |
| `agentdb_consolidate` | `{promoted:0, pruned:0}` | `{promoted:0, pruned:0}` | PARITY | adb-consolidate |
| `agentdb_feedback` | `{controller:"none", updated:0}` honest (no task) | `{success:true, ...}` ms=32 | PARITY | adb-feedback |
| `agentdb_session-start`/`-end` | `{controller:"bridge-search"/"bridge-store", persisted:true}` | `{success:true}` both | PARITY | adb-session-start/-end |
| **embeddings_* (7 tools)** | MiniLM-384, all DEMONSTRATED | **mpnet-768**, all work: status/init/generate/compare(0.x)/search/neural/hyperbolic | PARITY (model differs by design — ADR-0052) | emb-* all ok |
| `embeddings_compare` | similarity 0.6046 (MiniLM) | real cosine (mpnet) similar/unrelated separated | PARITY | emb-compare / emb-compare-unrelated |
| **`embeddings_rabitq_*` (3 tools)** | present upstream (build→32× compression, search) | **MCP surface ABSENT in fork** (no `embeddings_rabitq_*` in 317-tool list) — but the fork RETAINS a real 205-line `rabitq-index.js` wrapper AND declares `@sparkleideas/ruvector-rabitq-wasm@^0.1.0`; the gaps are (i) tools never registered, (ii) wasm pkg not installed *(DA re-characterization)* | **FORK-REGRESSION (advertised surface unwired — wire+install, not a removal)** | `toollist.json` (no rabitq); DA `regression3-rabitq-verdict.md` |
| **`ruvllm_hnsw_create`/`_add`/`_route`** (advertised by ruflo-agentdb) | all WORK (bundled `@claude-flow/ruvllm-wasm`) | **`ruvllm_hnsw_create` FAILS** — `-32603 Failed to initialize @sparkleideas/ruvector-ruvllm-wasm: TypeError: mod.initSync is not a function` | **FORK-REGRESSION (ruvllm WASM dead)** — same root cause C1 D1 (`initSync` version skew). Breaks an advertised ruflo-agentdb tool family, not just ruflo-ruvllm | adb2-hnsw-create; see C1 `02-fork-diff` §RuVLLM root cause |

### ruflo-rvf (portable memory + session persistence)

| Feature | Upstream | Fork | Class | Evidence |
|---|---|---|---|---|
| `/rvf` stats (`memory_stats`) | proven | works (`RVF + HNSW`) | PARITY | mem-stats-rvf |
| `session_save` | `{path:.claude-flow/sessions/*.json, stats{memoryEntries:0}}` | `{sessionId, path:.claude-flow/sessions/session-*.json, stats{memoryEntries:0, totalSize:165}}` | **PARITY** (incl. the `memoryEntries:0` quirk — Q6) | session-save; file written (211 B) |
| `session_list` | saved session listed | saved session listed w/ stats | PARITY | session-list |
| `session_restore`/`_info` | schema-verified, not destructively run | `{error:"Session not found"}` — my arg used wrong sessionId (auto-gen `session-…43ndm0`); not a fork bug | NOT-DRIVEN (arg) | session-info/restore |
| `memory_migrate` | (n/a) | `{success:true, message:"No legacy data to migrate", migrated:0}` | PARITY (honest) | mem-migrate |
| `memory_export` (rvf/json) | (needs `outputPath`) | `-32602` missing `outputPath` (arg) | NOT-DRIVEN (arg) | mem-export-rvf/json |
| RVF cognitive-container tooling (`ruvector rvf *`) | belongs to ruflo-ruvector (C1) | (C1 scope) | — | per README cross-ownership table |

### ruflo-knowledge-graph (workflow scaffold over agentdb primitives)

| KG step | Underlying primitive | Upstream | Fork | Class |
|---|---|---|---|---|
| `kg extract` → store entities | `agentdb_hierarchical-store` | works | works (`hierarchical_memory`) | PARITY |
| `kg extract` → create edges | `agentdb_causal-edge` | → `graph_edges` (traversable) | → `causal_edges` (NOT traversable by graph-query) | **FORK-REGRESSION** (root of the kg break) |
| `kg extract` → semantic index | `embeddings_generate` | works (384) | works (768) | PARITY |
| **`kg traverse`** (pathfinder) | `agentdb_graph-pathfinder` | PPR traversal returns paths | **`{paths:[], "no edges found"}`** | **FORK-REGRESSION** |
| **`kg relations`** | `agentdb_graph-query{k-hop}` | returns relations | **empty (`graph_edges is empty`)** | **FORK-REGRESSION** |
| **`kg visualize`** | recall all + render | renders real graph | renders empty (graph_edges empty) | **FORK-REGRESSION** |
| `kg search` | `agentdb_pattern-search` | DEMONSTRATED | works (archivist, score 0.843) | PARITY |
| `src/adapters/knowledge-graph-adapter.ts` | (no upstream counterpart) | absent | present, **honestly self-documented shelfware** (ADR-0261, `autoRegister:false`, "NO src/ runtime") | **FORK-AHEAD / KEEP-AS-CAPABILITY** (Q5) |
| namespace name | `kg-graph` (plugin.json) | — | command template uses `knowledge-graph`, plugin.json/README use `kg-graph` — internal inconsistency | doc-drift (cosmetic) |

### ruflo-migrations (file-scaffolding skill; metadata via `memory_*`)

| Feature | Upstream | Fork | Class | Evidence |
|---|---|---|---|---|
| `migrate create` metadata | `memory_store --namespace migrations` (384) | `memory_store --namespace migrations` works (mpnet-768) | PARITY | mig-store-001/002 |
| `migrate history`/`status` | `memory_list --namespace migrations` | `memory_list --namespace migrations` recalls rows | PARITY | mig-list/mig-history-recall |
| `migrate validate` (pattern-search) | `agentdb_pattern-search` | works | PARITY | mig-pattern-search |
| `migrate up/down` SQL | agent Bash on user DB (no ruflo tool) | same | OUT-OF-SUBSTRATE | — |
| CLI `migrate` collision | (upstream plugin = pure markdown; CLI `migrate` = V2→V3 tool) | identical — CLI `ruflo migrate` is **V2→V3 migration** (`status/run/verify/rollback/breaking`), NOT the plugin's `create/up/down`; the plugin commands are agent thought-templates | PARITY (both flavors); note the name collision is upstream-shared, not fork-introduced | `logs/help-migrate.log` |

## FORK-REGRESSION #1 (top) — `agentdb_causal-edge` rerouted → graph-traversal surface dead

**Validation bar satisfied (all 5 points):**
1. **Production shape:** warm long-lived MCP server (`cli.js mcp start`), corrected arg shapes from live schemas, 42 warm controllers.
2. **Documented defaults:** `agentdb_graph-query` requires `nodeId`+`mode∈{k-hop,semantic,pagerank}`, `graph-pathfinder` requires `seedNodeId`+`query` — all supplied per live schema.
3. **Content not counters:** `sqlite3` dump — `causal_edges`=2 rows (the edges I wrote), `graph_edges`=**0**. The traversal tools explicitly report `message:"graph_edges is empty"` / `"no edges found"`.
4. **Installed-dist:** driven against the installed `@sparkleideas/cli@3.7.0-alpha.10-patch.415` dist; root cause traced to ADR-0276 (committed, accepted).
5. **Cold-vs-warm ruled out:** re-driven warm with explicit entity stores + graph_node_create attempts; still empty. graphAdapter is OFF (so graph_node_create can't populate either).

**Mechanism (root-caused):** Upstream's `agentdb_causal-edge` writes a general entity edge to **`graph_edges`** via `@claude-flow/ruvector-graph-node` (`_graphNodeBackend:true`); `agentdb_graph-query`/`graph-pathfinder` traverse `graph_edges` with three real algorithms. **ADR-0276** (accepted 2026-05-30) re-converged the fork's *ADR structural edges* onto upstream's `CausalMemoryGraph` controller, which writes **`causal_edges`** keyed by numeric ADR node IDs (the `adr_node_ids` allocator). The `agentdb_causal-edge` MCP tool is wired to that CausalMemoryGraph path — so a **general entity edge** (`AuthController→UserService`) lands in `causal_edges` as an `adr`-typed row, and the `graph_edges`-reading traversal surface gets nothing. The fork-only `agentdb_causal-query` reads `causal_edges` and works; the upstream-shared `agentdb_graph-query`/`graph-pathfinder` (and the entire `kg traverse`/`relations`/`visualize` composition) are **starved**.

**Impact:** `agentdb_graph-query` (all 3 modes), `agentdb_graph-pathfinder`, and the ruflo-knowledge-graph plugin's `traverse`/`relations`/`visualize` thought-templates are **non-functional** in the fork while fully working upstream (queen's proof: AuthController↔UserService 0.81 cosine, pagerank 0.126, PPR paths). **This is the highest-impact C2 fork regression.** (Disposition note: ADR-0276's *own* premise was demonstrated and its ADR-edge re-convergence is sound — the regression is that it narrowed `agentdb_causal-edge` to the ADR case without preserving a general-entity `graph_edges` write path for graph-query/kg. Re-justification belongs in `03-patch-audit` + the C2 re-convergence ADR.)

## FORK-REGRESSION #2 — `ruvllm_hnsw_*` WASM dead (advertised ruflo-agentdb tool family)

`ruvllm_hnsw_create` → `-32603 Failed to initialize @sparkleideas/ruvector-ruvllm-wasm: TypeError: mod.initSync is not a function`. **Identical root cause to C1 D1** (the vendored `@sparkleideas/ruvector-ruvllm-wasm@2.0.2-patch.93` is a newer wasm-bindgen build exporting `init` + auto-instantiate, no `initSync`; the cli wrapper calls `mod.initSync`). C1 owns the root-cause writeup (`docs/research/c1-learning-intelligence/02-fork-diff.md §RuVLLM`). **C2-specific consequence:** `ruflo-agentdb` advertises `ruvllm_hnsw_*` as one of its **three** headline tool families ("HNSW pattern router: 3 ruvllm_hnsw_* tools") — so this regression breaks an advertised substrate feature, not only the ruflo-ruvllm plugin. Upstream's `ruvllm_hnsw_create/add/route` all work (queen's proof).

## FORK-REGRESSION #3 — `embeddings_rabitq_*` MCP surface unwired (advertised capability unreachable)

Upstream registers `embeddings_rabitq_status/build/search` (RaBitQ 1-bit quantization, 32× compression — queen's proof: `vectorCount:5, compressionRatio:32`). The fork's 317-tool list has **no `embeddings_rabitq_*` tools**. **DA re-characterization (corrects the original "capability removed" framing):** the fork **retains a real 205-line `rabitq-index.js` implementation wrapper** and **declares `@sparkleideas/ruvector-rabitq-wasm@^0.1.0` as a dependency**; the actual gaps are (i) the `embeddings_rabitq_*` MCP tools are **never registered** (0 refs in fork dist) and (ii) the WASM package is **not installed**. ADR-0248 correctly found RaBitQ phantom in **both** upstream and fork at the time ("inherited, not a fork regression"); upstream **subsequently** shipped the working tools. Disposition: **WIRE the existing impl + install the WASM** — and verify the wrapper's `mod.initSync({module})` call (line 23) against the C1-D1 wasm-bindgen shape skew before wiring. Lower severity (optimization, not core recall). Evidence: DA `regression3-rabitq-verdict.md`, `da-up-rabitq-results.jsonl`.

## FORK-AHEAD inventory (re-justify, do not assume regression)

- **RVF-as-sole-truth memory substrate** (ADR-0086/0091/0177) — the central divergence. Memory CRUD works; would re-enabling upstream's sql.js path have sufficed? Upstream demonstrably ships sql.js-primary and it works — so the *necessity* of RVF-as-sole-truth is the re-justification question for `04-dispositions`. NOT a regression (CRUD functional), but a permanent merge-tax divergence (upstream is actively fixing `memory_entries`, e.g. `#2120`, which the fork skips because the table doesn't exist — INTEGRATION-LEDGER row `cfc341706`).
- **Fork-only agentdb tools** — `agentdb_causal-query`, `agentdb_causal-recall`, `agentdb_hierarchical-query`, `agentdb_reflexion-store/-retrieve`, `agentdb_skill_create/_search`, `agentdb_graph_node_*`, `agentdb_branch`, `agentdb_experience_record`, `agentdb_learner_run`, `agentdb_learning_predict`, the `agentdb_attention_*`/`agentdb_semantic_*` clusters, `agentdb_filtered_search`, `agentdb_query_stats`, `agentdb_circuit_status`, `agentdb_rate_limit_status`, `agentdb_resource_usage`, `agentdb_sona_trajectory_store`. ~30 tools absent upstream. `causal-query`/`causal-recall` are the working read path for the fork's `causal_edges` (FORK-AHEAD, load-bearing). The reflexion/learner/experience/causal-recall cluster = the ADR-0268/0277/0279/0280 implement-ahead (C1 already re-justified these). Per-tool unwind analysis → `04-dispositions`.
- **G7 controllers ON** (gnnService, rvfOptimizer + G7-family semanticRouter) — FORK-AHEAD activation; semanticRouter is enabled-but-inert ("No route matched") and NOT among the README's named five. README claim "five activated" is stale (only 2 of its named five on).
- **42-controller registry** (vs upstream 23) — the V3 attention/neural cluster (selfAttention, crossAttention, multiHeadAttention, flashAttentionService, moeAttentionService, enhancedEmbeddingService, quantizedVectorStore, solverBandit, nativeAccelerator…). FORK-AHEAD; mostly C1/C3 surface, recorded here for completeness.
- **kg `src/adapters/knowledge-graph-adapter.ts`** — FORK-AHEAD structural port, **honestly self-documented as shelfware-by-design** (ADR-0261 §R2.9, `autoRegister:false`, "plugin currently has NO src/ runtime"). No upstream counterpart. Per `feedback-no-consumer-is-not-stub`: **KEEP-AS-CAPABILITY**, not DELETE — it's real honest unadvertised code ahead of its consumer (ADR-0177 implement-ahead posture). Q5 answered.

## Known-RESOLVED items — verified current, NOT re-reported as fresh regressions

Per the brief, these are KNOWN-RESOLVED/KNOWN-EXPLAINED; I verified current state rather than re-deriving:

| Item | Memory | Current state in fork env |
|---|---|---|
| sql.js NAMED-bind / SAVEPOINT (ADR-0285) | `project-adr0285-p3p4-causal-crud` | ADR-0285 **accepted**; live daemon runs **native better-sqlite3** (node-24), not sql.js; causal-edge/causal-query succeeded — no P3/P4/P6 reproduced. The bsq→sql.js fallback now fails loud (opt-in only). |
| RVF single-lock collapse + hash-ids (ADR-0284) | `project-adr0284-rvf-single-lock-collapse` | Live on Verdaccio (patch.397+); my cli.415 stores/lists with 0 loss across 6 entries; no write-loss or deadlock observed. |
| memory_search `2cos−1` / 0.3-floor (ADR-0073/0227) | `project-memory-search-rvf-snapshot-isolation` | Fixed: `memory_search` returns real cosine (0.28/0.62), adaptive 0.15 floor lets mpnet related scores survive; ADR-0227 **accepted**. |
| t3-2 vectorless confound | `project-t3-2-durable-count-vectorless-confound` | No vectorless producer in current store path; all 6 entries `hasEmbedding:true`; durable (RVF) + visible (list) agree. |
| daemon node-version trap | `project-mcp-daemon-runs-sqljs-fallback` | Node v24.14.1, native better-sqlite3 — resolved. |
| agentdb extraction (ADR-0161) | `project-agentdb-parallel-extraction` | `@sparkleideas/agentdb@3.0.0-alpha.14-patch.427` consumed; consolidated fork. |
| hierarchical keyed upsert/delete + query-limit (ADR-0281/0282) | — | Both **accepted**; hierarchical-store/recall work with tier routing. |

## Drive coverage + gaps

**Driven (production shape, content-verified):** all `memory_*` (11 tools), the agentdb substrate (hierarchical store/recall, pattern store/search, causal-edge/query/recall, route, semantic-route, context-synthesize, batch, consolidate, feedback, session, graph-query×3, graph-pathfinder, graph_node_create/get), all 7 `embeddings_*`, `ruvllm_hnsw_create`, `session_save/list/info/restore`, `memory_migrate`, the migrations-namespace battery, the kg primitive composition.

**Could NOT drive (recorded judgment calls — NOT failures):**
- `memory_export` (rvf/json), `memory_import_claude` (active import): require `outputPath` / would pull 368 real MEMORY.md files — arg/scope, schemas verified. (Upstream prover also did not drive these.)
- `agentdb_graph_edge_create`: `-32602` missing `type` (arg shape; the working edge path is `agentdb_causal-edge`).
- `session_restore`/`_info` against my chosen id: failed on auto-generated sessionId mismatch (arg), not a fork defect; save/list proven.
- `ruvllm_hnsw_add/_route`: gated behind `ruvllm_hnsw_create` which fails at WASM init (FORK-REGRESSION #2) — could not reach.
- `agentdb_batch` re-drive: hit transient `rate_limited`; the tool itself is reachable (the upstream prover proved batch works once warm).
- The ~25 fork-only agentdb tools beyond causal/hierarchical/graph (attention_*, semantic_*, reflexion-*, skill_*, learner/experience) — enumerated in `toollist.json`, classified FORK-AHEAD by absence-upstream; not all individually driven (C1 already exercised the learning cluster; remainder are C3/attention surface).

## Divergence counts

- **FORK-REGRESSION: 3** — (1) `agentdb_causal-edge`→`causal_edges` breaks graph-query/pathfinder/kg-traverse [top]; (2) `ruvllm_hnsw_*` WASM dead [shared C1 root cause — fixed by ADR-0293 D1, pending release]; (3) `embeddings_rabitq_*` MCP surface unwired + wasm uninstalled (impl wrapper present).
- **FORK-AHEAD: 6 clusters** — RVF-as-sole-truth substrate; ~30 fork-only agentdb tools; G7 controllers (3 of 5) ON; 42-controller registry; kg `src/adapters` shelfware; mpnet-768 embeddings.
- **PARITY: ~30** — memory CRUD, hierarchical store/recall, pattern store/search, embeddings family, sessions, migrations namespace, consolidate/feedback/route/context-synth.
- **UPSTREAM-BROKEN: 0** — no upstream feature met the 5-point bar for a broken verdict.
- **Cosmetic/doc-drift (sub-regression, flagged not classified):** inconsistent `backend` labels across memory surfaces (archivist/RVF/SQLite); CLI stats "HNSW not active" vs MCP `hnswIndex:true` (ADR-0257 anomaly #5, <32 entries); bridge-status MiniLM-384 label over an mpnet-768 store; `semantic-route` bare-null/"No route matched" less honest than upstream's explicit redirect; kg namespace `knowledge-graph` vs `kg-graph`; README "ADR-095 activated five controllers" (only 3 on).
