# C2 Memory & Data substrate — Upstream Proof Record

**Protocol:** ADR-0292 steps 1-3 (enumerate → prove upstream → explain mechanism). **Validation bar:** ADR-0291 §Confirmation (5-point).
**Null hypothesis:** UPSTREAM WORKS — this is positive proof, not gap-hunting.
**Date:** 2026-06-04. **Author:** upstream-prover (queen-led C2 swarm).

> **DA review (2026-06-04) — reviewed, UPHELD, errata applied.** All load-bearing claims survived adversarial re-drive (`/tmp/c2-evidence/da/`). Errata folded in: (a) the `agentdb_batch` verdict is softened — only the cold precondition envelope was demonstrated; a successful warm batch insert was NEVER driven, and the DA's warm re-drive also failed ("Embedder not initialized" after a working `embeddings_generate`) — **batch insert is UNPROVEN upstream**; (b) clarification: upstream `graph_edges` columns are `source_id`/`target_id` (the substance — domain-prefixed IDs, weight/confidence, inline embeddings — is exact as written).

**Reference env:** `/tmp/ruflo-fresh` (REUSED from C1 — verified intact, not rebuilt). All drives run in a clean sub-project `/tmp/c2-up` (only `.mcp.json` at start) so stores begin empty for clean write-traces + SQLite dumps.

- **ruflo** `3.10.36` (installed bin `/Users/henrik/.npm/_npx/2ed56890c96f58f7/node_modules/.bin/ruflo` → `ruflo/bin/ruflo.js`), wrapping **`@claude-flow/cli` `3.10.36`** (installed dist `…/@claude-flow/cli/dist/src/`).
- MCP serverInfo string: **`ruflo 3.0.0`** (protocol server version; distinct from CLI version).
- Bridge package present: **`@claude-flow/memory`** (`…/@claude-flow/memory/dist/controller-registry.js`) — so AgentDB controllers are LIVE, not in bridge-unavailable mode. (Fork's bridge is `@sparkleideas/memory` — the rename is a fork-auditor concern, not a behaviour delta.)
- Embeddings: `Xenova/all-MiniLM-L6-v2`, 384-dim, ONNX (SIMD), HNSW m=16/efC=200/efS=100, cosine.
- Memory backend (live): **`sql.js + HNSW`** (WASM SQLite) — every `memory_*` envelope reports `"backend":"sql.js + HNSW"`; `memory init` help confirms "sql.js (WASM SQLite)". This matches the known live-daemon sql.js posture (memory `project-mcp-daemon-runs-sqljs-fallback`).
- Public npm registry + private cache `/tmp/ruflo-fresh/.npm-cache` (Verdaccio shadow avoided).

**Production shape:** one long-lived `ruflo mcp start` stdio session per drive (`c2_driver.py`), arg names derived from live `tools/list` schemas, threaded IDs, NODE_OPTIONS write-trace shim (`fswrite-shim.cjs`), `sqlite3` content dumps, before/after tree diff. **Three drives:** main 53-call battery (`up-c2-results.jsonl`), corrective 15-call (`up-c2b-results.jsonl`, fixes my own shape errors), warm-ReasoningBank 7-call (`up-rb-results.jsonl`).

> **Method correction applied (track-record honoured).** Two run-1 "failures" were MY wrong test shape, not brokenness: `agentdb_batch{operation:"store"}` (tool requires `insert|update|delete`) and `agentdb_graph-query{mode:"neighbors"}` (requires `k-hop|semantic|pagerank`). Re-driven with correct args in `up-c2b` — both WORK. No failure verdict was recorded before re-driving in the correct shape.

---

## CRITICAL PROVENANCE FINDING (read first — affects the whole category)

**The C2 plugins ship TWO flavors in this machine; the upstream spec is the marketplace clone, not the plugin cache.**

| Location | Brand tokens | Identity |
|---|---|---|
| `~/.claude/plugins/marketplaces/ruflo/plugins/ruflo-*` (the `ruvnet/ruflo` GitHub clone) | `mcp__claude-flow__` (20× in rag-memory), **0× `mcp__ruflo__`**, `@claude-flow/cli` | **UPSTREAM** — this is the canonical spec for enumeration |
| `~/.claude/plugins/cache/ruflo/ruflo-*/<ver>` (installed/activated copies) | `mcp__ruflo__` (20-50×), `@sparkleideas/cli` | **FORK-published** plugins overlaid on the same marketplace name |

Upstream marketplace plugin versions: **rag-memory 0.2.0, agentdb 0.3.0, rvf 0.2.0, knowledge-graph 0.2.0, migrations 0.2.0**. The command/skill/agent **surface is identical** between flavors (same filenames; verified for agentdb) — only namespace/brand tokens differ. `ruflo-migrations` is the one plugin NOT fork-rebranded even in cache (pure `mcp__claude-flow__`/`@claude-flow/cli`). **Behavioural truth was driven against the upstream `@claude-flow/cli` 3.10.36 dist directly** (bare MCP tool names == `mcp__claude-flow__*`), so the proof stands regardless of which manifest flavor an agent reads. The enumeration below cites the upstream marketplace clone as spec. *(Open item for the fork-auditor: confirm whether the fork's published plugin set diverges in surface, not just branding.)*

Evidence: `logs/tools-list-all.txt` (293 tools, upstream serverInfo `ruflo 3.0.0`); brand-token counts in the prose above were produced by `grep -rho` over both trees.

---

## Per-plugin feature inventory + proof status

Legend: **DEMONSTRATED** (drove it; content/behaviour verified) · **DEMONSTRATED-HONEST-FALLBACK** (returns a documented graceful-degradation envelope, persists/redirects correctly — NOT a failure) · **NOT-DEMONSTRATED** (with the 5-point bar shown). No `UPSTREAM-BROKEN` verdicts recorded.

### ruflo-agentdb (substrate plugin — 20 `agentdb_*` + 10 `embeddings_*` + 3 `ruvllm_hnsw_*` MCP tools)

> Plugin README says "15 agentdb_* / 7 embeddings_*". **Upstream actually registers 20 `agentdb_*` and 10 `embeddings_*`** (`logs/tools-list-all.txt`). The extras: `agentdb_route`, `agentdb_graph-query`, `agentdb_graph-pathfinder`, `agentdb_causal-edge-delete`, `agentdb_causal-node-delete`, `agentdb_semantic-route`; embeddings adds 3 `embeddings_rabitq_*`. Doc undercount, not a missing feature. **No `agentdb_causal-query`/`_causal-recall`/`_hierarchical-query`/`_pattern-store`-variant tools exist upstream** — those names in the MCP catalog are fork-only (fork-auditor item).

| Feature | Tool | Result envelope (truncated) | Verdict |
|---|---|---|---|
| Health | `agentdb_health` | `{available:true, controllers:[…23 warm…], attestationCount:0}` | DEMONSTRATED |
| Controller registry | `agentdb_controllers` | warm: 23 controllers (15 enabled / 8 disabled — table below) | DEMONSTRATED |
| Session start/end | `agentdb_session-start` / `_-end` | start `{success:true, controller:"bridge-search", sessionId}`; end `{success:true, controller:"bridge-store", persisted:true}` | DEMONSTRATED |
| Hierarchical store | `agentdb_hierarchical-store{key,value,tier}` | `{success:true, key, tier:"semantic"}` (0ms in-process tier; flushed to memory.db) | DEMONSTRATED |
| Hierarchical recall | `agentdb_hierarchical-recall{query,tier,topK}` | returned both stored entities `{controller:"hierarchicalMemory"}` | DEMONSTRATED |
| Hierarchical delete | `agentdb_hierarchical-delete` | `{success:false, controller:"native-unsupported", error:"HierarchicalMemory has no public delete API"}` | DEMONSTRATED-HONEST (capability-absent, stated truthfully) |
| Pattern store | `agentdb_pattern-store{pattern,type,confidence}` | `{success:true, patternId, controller:"memory-store-fallback"\|"bridge-fallback", note:"…persisted via memory_store"}` | DEMONSTRATED-HONEST-FALLBACK (persists; ADR-093 F4) |
| Pattern search | `agentdb_pattern-search{query,topK}` | `{results:[], controller:"memory-store-fallback", tier:"substring", note:"ReasoningBank returned 0…"}` | DEMONSTRATED-HONEST-FALLBACK |
| Causal edge | `agentdb_causal-edge{sourceId,targetId,relation,weight}` | `{success:true, edgeId:<uuid>, backend:"graph-node", _graphNodeBackend:true}` — **persisted to `graph_edges`** | DEMONSTRATED (real graph write) |
| Causal edge delete | `agentdb_causal-edge-delete` | fresh node: `{success:true, deleted:true, controller:"bridge-fallback", guarded:true}` | DEMONSTRATED |
| Causal node delete | `agentdb_causal-node-delete` | `{success:true, deletedNode:false, controller:"bridge-fallback", guarded:true}` | DEMONSTRATED-HONEST (no matching node) |
| Graph query (k-hop) | `agentdb_graph-query{mode:"k-hop"}` | `{success:true, results:[…], backend:"graph-node"}` | DEMONSTRATED |
| Graph query (semantic) | `agentdb_graph-query{mode:"semantic"}` | cosine-scored neighbors `{backend:"sql-cosine"}` — AuthController↔UserService 0.81, Database 0.41 | DEMONSTRATED |
| Graph query (pagerank) | `agentdb_graph-query{mode:"pagerank"}` | PPR scores `{backend:"sql-ppr"}` — UserService 0.126, Database 0.019 | DEMONSTRATED |
| Graph pathfinder | `agentdb_graph-pathfinder{seedNodeId,query}` | `{algorithm:"personalized-pagerank", paths:[{nodeId:"entity:UserService", score:0.126, depth:1}]}` | DEMONSTRATED (traverses the real causal graph) |
| Context synthesize | `agentdb_context-synthesize` | cold: `{success:false, error:"ContextSynthesizer not available"}`; warm health shows `contextSynthesizer:enabled` | DEMONSTRATED-HONEST-FALLBACK (process-warmth dependent; README redirect → `memory_search_unified`, which works) |
| Semantic route | `agentdb_semantic-route` | `{route:null, error:"SemanticRouter not available in current agentdb build", recommendation:"Use … agentdb_route"}` | DEMONSTRATED-HONEST (retired controller; **tool still registered, returns explicit redirect**) |
| Route | `agentdb_route{task,context}` | `{route:"general", confidence:0.5, agents:["coder"], controller:"fallback"}` | DEMONSTRATED |
| Batch | `agentdb_batch{operation:"insert",entries}` | cold process: `{success:false, error:"Embedder not initialized for batch insert… run embeddings_init first"}` | DEMONSTRATED-HONEST (cold precondition envelope ONLY — warm success NOT driven; DA warm re-drive also failed → batch insert UNPROVEN upstream, open) |
| Feedback | `agentdb_feedback{taskId,success,quality,agent}` | `{success:true, controller:"none", updated:0}` | DEMONSTRATED-HONEST (no matching task row) |
| Consolidate | `agentdb_consolidate` | `{success:true, consolidated:{promoted:0, pruned:0, timestamp}}` | DEMONSTRATED |

**embeddings_* (10 tools):**

| Tool | Result | Verdict |
|---|---|---|
| `embeddings_status` (pre-init) | `{success:false, initialized:false, message:"Run embeddings/init first"}` | DEMONSTRATED-HONEST |
| `embeddings_init` | `{success:true, config:{model:"Xenova/all-MiniLM-L6-v2", dimension:384, hyperbolic{enabled,curvature:-1}, neural{enabled}}, paths{config:.claude-flow/embeddings.json}}` | DEMONSTRATED (writes `embeddings.json`) |
| `embeddings_generate{text}` | `{success:true, embedding:[384 real floats]}` | DEMONSTRATED |
| `embeddings_compare{text1,text2}` | `{similarity:0.6046, metric:"cosine", interpretation:"similar"}` | DEMONSTRATED |
| `embeddings_search{query,topK,threshold}` | ranked hits w/ cosine sim 0.70/0.69 from the persisted store | DEMONSTRATED |
| `embeddings_hyperbolic{action:"status"}` | `{success:true, hyperbolic{enabled, curvature:-1, maxNorm:0.99999}}` (Poincaré) | DEMONSTRATED |
| `embeddings_neural{action:"status"}` | `{neural{enabled, sonaEnabled:true, realMetrics{patternsLearned:7, trajectoriesRecorded:55, adaptationTime:"1.70μs"}}}` | DEMONSTRATED |
| `embeddings_rabitq_status` | pre-build `{available:false, initialized:false}` | DEMONSTRATED-HONEST |
| `embeddings_rabitq_build` | `{success:true, vectorCount:5, compressionRatio:32, wasmVersion:"0.1.0"}` → writes `.swarm/rabitq.meta.json` | DEMONSTRATED |
| `embeddings_rabitq_search{query,k}` | ranked results w/ distances over the quantized index | DEMONSTRATED |

**ruvllm_hnsw_* (3 tools, WASM router, cap ~11):**

| Tool | Result | Verdict |
|---|---|---|
| `ruvllm_hnsw_create{dimensions,maxPatterns}` | `{success:true, routerId:"hnsw-…", dimensions:384, maxPatterns:11}` | DEMONSTRATED |
| `ruvllm_hnsw_add{routerId,name,embedding}` | `{success:true, patternCount:1}` (threaded routerId + 384-d embedding) | DEMONSTRATED |
| `ruvllm_hnsw_route{routerId,query,k}` | `{results:[{name:"coder-route", score:1}]}` (exact-match retrieval) | DEMONSTRATED |

**agentdb_controllers — warm registry (23 instantiated; README's `ControllerName` union = 29 names):**

```
ENABLED (15): hierarchicalMemory, reasoningBank, tieredCache, memoryGraph, vectorBackend,
              batchOperations, explainableRecall, memoryConsolidation, reflexion, skills,
              causalGraph, learningSystem, nightlyLearner, contextSynthesizer, graphTransformer,
              mmrDiversityRanker
DISABLED (8): gnnService, mutationGuard, attestationLog, semanticRouter,
              guardedVectorBackend, rvfOptimizer, graphAdapter
```

> **FORK-AUDITOR FLAG (not a defect):** the agentdb/kg READMEs claim "ADR-095 G7 activated five controllers (`gnnService`, `rvfOptimizer`, `mutationGuard`, `attestationLog`, `GuardedVectorBackend`) in ruflo 3.6.23+." **In upstream 3.10.36 all five report `enabled:false`**, plus `semanticRouter` and `graphAdapter` off. If the fork has these ON, that is a FORK-AHEAD divergence to re-justify; if the fork's docs assert upstream-on, the docs are stale. (Evidence: `dumps/up-controllers-warm.txt`.) Process-warmth also matters: a cold first call showed only 6 controllers with reasoningBank/vectorBackend off → they warm up progressively (INIT_LEVELS lazy init). This is why pattern-store falls back early in a process and engages ReasoningBank later — counters-vs-content point (the bar's #5) reframed as cold-vs-warm.

### ruflo-rag-memory (memory CRUD + recall + bridge — routes to `memory_*` MCP + `ruflo memory` CLI)

| Feature | Drive | Result | Verdict |
|---|---|---|---|
| `memory store` | `memory_store{key,value,namespace,tags}` ×3 | `{success:true, stored:true, hasEmbedding:true, embeddingDimensions:384, backend:"sql.js + HNSW", storeTime:"~506ms"}` | DEMONSTRATED |
| `memory retrieve` | `memory_retrieve{key,namespace}` | full value + tags + `accessCount` bumped to 1, `found:true` | DEMONSTRATED |
| `memory search` (dense) | `memory_search{query,namespace,limit}` | 2 ranked hits, cosine sim 0.73 / 0.65 — **real semantic ranking** | DEMONSTRATED |
| `memory search` (threshold) | `memory_search{…,threshold:0.1}` | re-ranks (rate-limit 0.79 for its own query) | DEMONSTRATED (default threshold caveat — ADR-0291 W4) |
| `memory search --smart` | `memory_search{…,smart:true}` | `{backend:"SmartRetrieval (RRF + MMR + Recency)", stats{variantCount:2, variants:[…]}}` — pipeline ran; 0 results here because variants didn't clear RRF on a 3-row store | DEMONSTRATED (SmartRetrieval/ADR-090 pipeline live; honest empty) |
| `recall` (command) | == `memory_search` across namespaces | proven via `memory_search` + `memory_search_unified` | DEMONSTRATED |
| `memory list` | `memory_list{namespace,limit}` | 2 entries w/ `hasEmbedding:true` | DEMONSTRATED |
| Unified search | `memory_search_unified{query,limit}` | cross-namespace ranked `{source:"agentdb"}`, scores 0.64/0.62 | DEMONSTRATED |
| `memory stats` | `memory_stats` | `{totalEntries:3, embeddingCoverage:"100.0%", namespaces{…}, backend:"sql.js + HNSW"}` | DEMONSTRATED |
| `memory_detailed-stats` | — | per-namespace counts; `note:"perf metrics are placeholders; HNSW always enabled in sql.js backend"` | DEMONSTRATED-HONEST (placeholders labelled) |
| `memory delete` | `memory_delete{key,namespace}` | `{success:true, deleted:true, hnswIndexInvalidated:true}` | DEMONSTRATED |
| `consolidate` | `agentdb_consolidate` (the command's MCP target) | `{success:true, consolidated{promoted:0,pruned:0}}` | DEMONSTRATED |
| `bridge` / `memory_bridge_status` | `memory_bridge_status` | `{claudeCode{memoryFiles:368, projects:11}, agentdb{totalEntries:3}, bridge{status:"connected", embedding:"all-MiniLM-L6-v2 (384-dim, backend=onnx)"}}` | DEMONSTRATED (bridge sees 368 real MEMORY.md files across 11 projects) |
| CLI surface | `ruflo memory --help` / `list` | 12 subcommands; CLI `list` reads back the SAME persisted store (2 patterns, vectors ✓) | DEMONSTRATED (command-path end-to-end) |

> `memory_import_claude` NOT actively driven (would import 368 real project memory files into the test store — out of scope for a clean substrate proof). Its target (`claude-memories`) and bridge are proven live via `memory_bridge_status`. Recorded judgment call.

### ruflo-rvf (portable memory + session persistence — routes to `memory_stats`, `session_*` MCP)

| Feature | Drive | Result | Verdict |
|---|---|---|---|
| `/rvf` stats | `memory_stats` | (proven above) | DEMONSTRATED |
| Session save | `session_save{name,includeMemory,…}` | `{sessionId:"session-…", path:".claude-flow/sessions/session-….json", stats{totalSize:210}}` → file written | DEMONSTRATED |
| Session list | `session_list{limit}` | the saved session listed w/ metadata | DEMONSTRATED |
| Session current | `session_current` | `{sessionId, status:"active", startedAt}` | DEMONSTRATED |
| Session info | `session_info{sessionId}` | `{…, fileSize:260, hasData:{memory:false, tasks:false, agents:false}}` | DEMONSTRATED |
| Session restore/export/import/delete | (schemas captured; restore not destructively run) | tools registered w/ correct schemas | PARTIAL — see note |
| HNSW persistence | side-effect of stores | `.swarm/hnsw.index` (1.5 MB binary) + `.swarm/hnsw.metadata.json` (id→key→content map) | DEMONSTRATED |
| RaBitQ container | `embeddings_rabitq_build` | `.swarm/rabitq.meta.json` `{vectorCount:5, compressionRatio:32}` | DEMONSTRATED |

> **OBSERVATION (for DA):** `session_save{includeMemory:true}` reported `memoryEntries:0` though 6 memory.db entries exist. The session manifest captures the in-process session task/agent buffer (empty in an MCP-only drive), NOT a snapshot of memory.db — consistent with the README framing (sessions index *manifests*, the substrate lives in `.swarm/memory.db`). Not a loss; flagged because it could be misread as "session didn't capture memory." `session_restore`/`_export`/`_import`/`_delete` were schema-verified but not run to avoid mutating the proof state — PARTIAL, not a failure.
>
> **RVF clarification:** ruflo-rvf is a high-level session-persistence skin. The actual **`.rvf` cognitive-container tooling** (`ruvector rvf create|ingest|query|…`, 10 subcommands) belongs to **ruflo-ruvector** (C1, already proven: `ruvector rvf examples` → 45 stores). The session JSON at `.claude-flow/sessions/*.json` is plain JSON, not an `.rvf` blob. This plugin's *own* surface is session_*/memory_stats — all proven.

### ruflo-knowledge-graph (workflow scaffold composing agentdb primitives — NO standalone runtime/MCP tool)

The manifest self-declares `graph_adapter.autoRegister:false` + `_note:"Plugin runtime currently has no bootstrap… adapter is structural-port shelfware"`. `kg extract/traverse/relations/visualize/search` are **markdown thought-templates** the agent executes by composing MCP primitives. There is **no `kg_*` MCP tool**. Proof = the primitives each template invokes:

| KG step | Underlying primitive | Verdict |
|---|---|---|
| `kg extract` → store entities | `agentdb_hierarchical-store` | DEMONSTRATED (3 `entity:*` stored + recalled) |
| `kg extract` → create edges | `agentdb_causal-edge` | DEMONSTRATED (3 `graph_edges` w/ relation/weight/confidence) |
| `kg extract` → semantic index | `embeddings_generate` | DEMONSTRATED |
| `kg traverse` (pathfinder) | `agentdb_graph-pathfinder` | DEMONSTRATED (PPR traversal AuthController→UserService) |
| `kg relations` | `agentdb_graph-query{mode:"k-hop"}` | DEMONSTRATED |
| `kg search` | `agentdb_pattern-search` (manifest notes `agentdb_semantic-route` retired) | DEMONSTRATED-HONEST-FALLBACK + DEMONSTRATED (the retirement note is CORRECT — semantic-route returns the redirect) |
| `kg visualize` | recall all + render (pure agent text) | N/A (no substrate call) |

End-to-end composition is real: I stored `entity:UserService/AuthController/Database`, linked them `depends-on`, and `graph-query{semantic}`/`{pagerank}` + `graph-pathfinder` returned the correct topology with scores. **The KG workflow's substrate is fully functional upstream.**

> **FORK-AUDITOR FLAG:** the cached (fork) kg plugin ships `src/adapters/knowledge-graph-adapter.ts` self-described as "ADR-0261 Phase 4 fork-native port… shelfware-by-design… plugin currently has NO src/ runtime." The **upstream** marketplace clone's kg plugin is markdown-only (no `src/`). The adapter is a FORK-AHEAD structural port with no consumer — re-justify per ADR-0292 (would re-enabling an upstream mechanism have sufficed? upstream has none here). Evidence: `cache/ruflo/ruflo-knowledge-graph/0.2.21/src/adapters/knowledge-graph-adapter.ts` header comment.

### ruflo-migrations (file-scaffolding skill — NO `migrate_*` MCP tool; metadata via `memory_*`)

`migrate create/up/down/status/validate/history` are **agent-driven file + SQL scaffolding** templates (`Read/Write/Glob/Bash`) plus migration metadata persisted to the `migrations` namespace via `memory_store`. There is **no migration MCP tool** (the only `migrat`-matching tool is the unrelated `memory_migrate`). Upstream skill uses `mcp__claude-flow__memory_store --namespace migrations` + `agentdb_pattern-search`.

| Feature | Drive | Result | Verdict |
|---|---|---|---|
| `migrate create` → file pair | deterministic scaffold (`001_create_users.up.sql` + `.down.sql`) | both files written | DEMONSTRATED (file generation is agent-side; substrate not required) |
| `migrate create` → metadata | `ruflo memory store --namespace migrations --key migration-001_…` | `{[OK] Data stored successfully, Vector: Yes (384-dim)}` | DEMONSTRATED |
| `migrate history`/`status` | `ruflo memory list --namespace migrations` | the metadata row recalled `{Namespace:migrations, Vector ✓}` | DEMONSTRATED |
| `migrate validate` | SQL parse + checks (pure agent logic) + pattern-store | substrate (`memory_*`/`agentdb_pattern-store`) proven above; SQL checks are agent reasoning | DEMONSTRATED (substrate) / N/A (agent logic) |
| `migrate up/down [--dry-run]` | executes `.up/.down.sql` against a user DB (agent-side `Bash`) | N/A — operates on the user's target DB, not the ruflo substrate | OUT-OF-SUBSTRATE (no ruflo tool to drive; correctly a Bash/agent operation) |

The migrations plugin's *only* ruflo-substrate dependency is the `migrations` namespace for history — proven persistent + recallable. The rest is agent file/SQL work with no ruflo runtime to "be broken."

---

## Mechanism map (process → trigger → store → consumer)

The whole C2 substrate funnels through ONE store: **`.swarm/memory.db`** (sql.js WASM SQLite, 50+ tables) + sidecar HNSW index + per-engine state files. Write-trace of the 53-call drive (`traces/fswrites.log`, project-local, non-node_modules):

```
41  writeFileSync  .swarm/memory.db                 <- EVERY memory_/pattern-/embeddings-indexed write
 5  writeFileSync  .swarm/hnsw.metadata.json        <- HNSW id→key→content sidecar
 1  writeFileSync  .swarm/hnsw.index (1.5MB binary) <- persisted ANN index
 1  writeFileSync  .swarm/schema.sql                <- schema snapshot on init
 1  writeFileSync  .swarm/rabitq.meta.json          <- RaBitQ quantized index meta
 1  writeFileSync  .claude-flow/embeddings.json     <- ONNX engine config/state
 1  writeFileSync  .claude-flow/sessions/session-*.json  <- session_save manifest
```

| Surface | Process | Trigger | Store (table/file) | Consumer (read-back) |
|---|---|---|---|---|
| `memory store/search/retrieve/list/delete` | MCP server (single long-lived) | model/CLI call | `memory_entries` (sql.js) + `vector_indexes` (HNSW config) + `.swarm/hnsw.index` | `memory_search` (cosine via HNSW), `memory_list`, CLI `ruflo memory list`, `memory_search_unified`, `memory_bridge_status` |
| `embeddings_generate/search/compare/init` | MCP server | call | `.claude-flow/embeddings.json` (config) + in-mem 384-d cache; search hits `memory_entries.embedding` | `embeddings_search`, `memory_search` (shared ONNX) |
| `agentdb_hierarchical-store/recall` | MCP server, `hierarchicalMemory` controller | call w/ `tier` | in-process tier cache → flushed to `memory_entries` (type=semantic) | `agentdb_hierarchical-recall` (tier-routed) |
| `agentdb_pattern-store/search` | MCP server, `reasoningBank` controller (lazy-warm) | call | cold → `memory-store-fallback`/`bridge-fallback` → `memory_entries` ns=`pattern`; warm → ReasoningBank vector path | `agentdb_pattern-search` (vector→substring fallback), `embeddings_rabitq_search` |
| `agentdb_causal-edge` + `graph-query`/`graph-pathfinder` | MCP server, **`@claude-flow/ruvector-graph-node`** backend (`_graphNodeBackend:true`) | call | **`graph_edges`** (NOT `causal_edges`; domain-prefixed `mem:`/`entity:` IDs, weight/confidence/inline-embedding) | `graph-query` (k-hop/`sql-cosine`/`sql-ppr`), `graph-pathfinder` (personalized-pagerank) |
| `session_save/list/info` | MCP server | call | `.claude-flow/sessions/*.json` (plain JSON manifest) | `session_list`, `session_info`, `session_current` |
| `migrate` history | agent + CLI `ruflo memory` | agent call | `memory_entries` ns=`migrations` (384-d embedded) | `ruflo memory list --namespace migrations` |
| Claude-memory bridge | MCP server bridge | SessionStart hook / `memory_import_claude` | `memory_entries` ns=`claude-memories` | `memory_search_unified`, `memory_bridge_status` |

**Three most important mechanism findings (memory-store focus):**

1. **`.swarm/memory.db` is the single source of truth, and it is `sql.js` (WASM), not native, not RVF.** Every `memory_*`, `agentdb_pattern-*`, `agentdb_hierarchical-*`, and embeddings-indexed write lands in `memory_entries` (with real 384-d JSON embeddings) or its sibling tables; HNSW is persisted alongside in `.swarm/hnsw.index` + `vector_indexes` (m=16/efC=200/efS=100). Read-back via cosine is real (search similarities 0.73/0.65/0.79). **Content, not counters** (`dumps/up-memory-db-content.txt`: 6 rows, 8000-char embeddings each).
2. **The causal graph is a SEPARATE backend writing `graph_edges`, served by `@claude-flow/ruvector-graph-node`.** `agentdb_causal-edge` does NOT populate the bridge's `causal_edges` table (which stayed 0); it writes `graph_edges` (3 rows, domain-prefixed IDs, inline embeddings). `agentdb_graph-query`/`graph-pathfinder` traverse THAT table with three real algorithms (k-hop, sql-cosine, sql-ppr). This is the substrate the knowledge-graph plugin composes — fully functional.
3. **Controllers warm lazily, and "fallback" labels are the documented honest path — not breakage.** A cold MCP process reports 6 controllers (reasoningBank off) → `agentdb_pattern-store` returns `memory-store-fallback` (still persists). A warm process reports 23 controllers (reasoningBank on) → it returns `bridge-fallback` and `pattern-search` consults ReasoningBank (returns substring tier when the vector path yields nothing). Both persist and both are documented (ADR-093 F4). The ADR-0291 bar's "counters vs content" generalizes here to **cold vs warm process** — judging a feature from a single cold call mis-reports it.

---

## NOT-DEMONSTRATED ledger (with bar points satisfied)

No feature was found broken. The items below are simply *not exhaustively driven* (scope/safety judgment calls), NOT failures:

| Item | Why not driven | Bar points satisfied | 
|---|---|---|
| `session_restore` / `_export` / `_import` / `_delete` | Would mutate/destroy the proof-state session; schemas verified live | (1) prod-shape schemas captured · (4) tools present in installed dist registry (`logs/schemas-rest.txt`) |
| `memory_import_claude` (active import) | Would pull 368 real MEMORY.md files into the test store | (1) bridge proven connected via `memory_bridge_status` · (4) tool registered · (3) target ns `claude-memories` confirmed in `memory_search_unified` defaults |
| `migrate up/down` SQL execution | Operates on a user's target DB via agent `Bash`, not a ruflo substrate tool | (2) `--dry-run` documented; no ruflo runtime involved |
| `kg visualize` | Pure agent ASCII rendering; no substrate call | n/a — not a substrate feature |

These satisfy "production shape + documented behaviour + installed-dist presence." None met the threshold for an `UPSTREAM-BROKEN` verdict (which requires the full 5-point bar AND a named root-cause mechanism — not reached for anything).

---

## Environment record (exact)

| Component | Version / path |
|---|---|
| ruflo | 3.10.36 — `/Users/henrik/.npm/_npx/2ed56890c96f58f7/node_modules/ruflo` (bin `ruflo/bin/ruflo.js`) |
| @claude-flow/cli | 3.10.36 — `…/2ed56890c96f58f7/node_modules/@claude-flow/cli/dist/src/` |
| @claude-flow/memory (bridge) | present — `…/@claude-flow/memory/dist/controller-registry.js` |
| MCP serverInfo | `ruflo 3.0.0` |
| Embedding model | `Xenova/all-MiniLM-L6-v2`, 384-d, ONNX SIMD |
| Memory backend (live) | `sql.js + HNSW` (WASM SQLite) |
| Upstream plugin spec | `~/.claude/plugins/marketplaces/ruflo/plugins/` (ruvnet/ruflo clone) — rag-memory 0.2.0, agentdb 0.3.0, rvf 0.2.0, kg 0.2.0, migrations 0.2.0 |
| Reference root | `/tmp/ruflo-fresh` (REUSED, intact) |
| Clean drive sub-project | `/tmp/c2-up` |
| Registry / cache | public npm + `/tmp/ruflo-fresh/.npm-cache` |

## Evidence index (`/tmp/c2-evidence/upstream/`)

| File | Contents |
|---|---|
| `logs/tools-list-all.txt` | full 293-tool list, serverInfo, C2 family groupings |
| `logs/schemas-agentdb.txt`, `schemas-rest.txt` | live `inputSchema` for every C2 tool (arg names used in drives) |
| `calls-c2.json` + `up-c2-results.jsonl` | main 53-call battery + full result envelopes |
| `calls-c2b.json` + `up-c2b-results.jsonl` | corrective 15-call (batch insert, graph-query modes, deletes, compress/cleanup) |
| `calls-rb.json` + `up-rb-results.jsonl` | warm-ReasoningBank 7-call probe |
| `traces/fswrites.log`, `fswrites-b.log` | complete fs write-trace (NODE_OPTIONS shim) |
| `treediffs/up-tree-before.txt` / `-after.txt` | full-tree diff (files created by the drive) |
| `dumps/up-memory-db-summary.txt` | table row counts |
| `dumps/up-memory-db-content.txt` | **content rows** — memory_entries, vector_indexes, graph_edges, embedding sample |
| `dumps/up-controllers-warm.txt` | 23-controller warm health snapshot |
| `dumps/up-session-file.txt` | session manifest + embeddings.json + hnsw/rabitq sidecars |
| `logs/cli-memory-help.txt`, `cli-memory-list.txt`, `cli-embeddings-help.txt` | CLI command surface + read-back |
| `logs/cli-migrate-store.txt`, `cli-migrate-history.txt` | migrations metadata persist + recall |
| `c2_driver.py`, `list_all.py`, `fswrite-shim.cjs` | reproducible harness |

## Open questions for fork-auditor / devil's advocate

1. **G7 controllers OFF upstream.** `gnnService`, `rvfOptimizer`, `mutationGuard`, `attestationLog`, `GuardedVectorBackend`, `semanticRouter`, `graphAdapter` all `enabled:false` in upstream 3.10.36, contradicting the agentdb/kg README claim "ADR-095 activated five in 3.6.23+." Does the FORK turn these on? If yes → FORK-AHEAD to re-justify; if the fork merely *documents* them as on → stale doc. (The fork ships these READMEs.)
2. **`graph_edges` vs `causal_edges`.** Upstream's `agentdb_causal-edge` writes `graph_edges` via `ruvector-graph-node`, leaving the bridge's `causal_edges` empty. Does the fork's RVF-as-sole-truth / sql.js-removal (ADR-0091/0086) reroute this? The fork-only `agentdb_causal-query`/`_causal-recall` MCP tools (absent upstream) likely read a different table — confirm which.
3. **Fork-only tool names.** `agentdb_causal-query`, `agentdb_causal-recall`, `agentdb_hierarchical-query`, `agentdb_reflexion-store/-retrieve`, `agentdb_skill_*`, `agentdb_graph_node_*`, `agentdb_branch`, etc. appear in the fork MCP catalog but NOT upstream's 20 `agentdb_*`. Each is FORK-AHEAD — does it duplicate an upstream capability reachable via the 20 existing tools?
4. **sql.js vs native/RVF.** Upstream live backend is `sql.js + HNSW`. The fork's hardest divergence is RVF-as-sole-truth + sql.js removal. The substrate I proved (memory_entries + graph_edges + vector_indexes + .swarm/hnsw.index) is the sql.js shape — the fork-auditor must drive the SAME battery against the fork to see whether RVF replaces these tables 1:1 or changes the read-back contract.
5. **Plugin brand overlay.** The activated cache plugins are fork-branded (`mcp__ruflo__`/`@sparkleideas/`) over the `ruvnet/ruflo` marketplace name. Confirm the fork's published C2 plugins match the upstream *surface* (not just branding) — esp. the kg `src/adapters/` shelfware which has no upstream counterpart.
6. **session_save `memoryEntries:0`** with a populated memory.db — confirm the fork's session-persist captures (or deliberately doesn't capture) the substrate, so this isn't mis-classified as a fork regression by the DA.
