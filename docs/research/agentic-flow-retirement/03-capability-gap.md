# Facet 3 — Capability Gap Analysis: Is anything UNIQUE lost on retiring agentic-flow's `AgentDBService` + fastmcp?

**Swarm** `swarm-1780507536857-mruhcx`, facet 3 of 5. Read-only.
**Verdict (one line):** **NO unique capability is lost.** Every `AgentDBService` method and every fastmcp tool either (a) has a live `mcp__ruflo__*` equivalent, (b) has a live `agentdb` CLI equivalent, or (c) is a one-liner pass-through to an `agentdb` controller that survives retirement untouched. The fastmcp layer is a *re-exposure* of agentdb controllers, not a home for unique logic.

---

## 0. Two corrections to the established context (verify-don't-trust)

1. **It is NOT "~12 fastmcp tools." It is ~190.** `stdio-full.ts` registers 22 tool modules (`stdio-full.ts:862-882`), ~190 tools total. `AgentDBService` backs ~80+ of these (memory/neural/attention/daa/workflow/session/quic/performance/rvf/hidden-controllers + sona/streaming/quantization/explainability/cost). The "~12" likely counted only the 10 files that literally `import AgentDBService` + the server — but the backing is far wider. This does not change the verdict; it widens the surface that maps cleanly.

2. **The fastmcp `AgentDBService` server is NOT the live agentic-flow MCP surface — and is not registered anywhere live.** Two distinct entry points exist:
   - `cli-proxy.ts:168` (`agentic-flow mcp`, the default proxy mode) → `mcp/standalone-stdio.js` — a **slim ~15-tool FastMCP shell** that does NOT use `AgentDBService`; it shells out via `spawnSync` and reaches agentdb through the **agentdb CLI** (`agentdb_pattern_store/search/stats`, `standalone-stdio.ts:722-848`).
   - `cli/mcp.ts startStdioServer` (`cli/mcp.ts:20`) + `cli/doctor-cli.ts:30` → `mcp/fastmcp/servers/stdio-full.js` — the **full ~190-tool server** that DOES use `AgentDBService`.
   - **Neither is in the live `.mcp.json`.** The only live MCP server is `@sparkleideas/ruflo` (`CLAUDE_FLOW_MODE=v3` → claude-flow v3 `@claude-flow/cli` + agentdb archivist). So the fastmcp `AgentDBService` tools are **not exposed to this session at all** — the live `mcp__ruflo__*` catalog is v3 + agentdb.

---

## 1. The structural fact that decides the whole question

`AgentDBService` holds **no unique logic**. It is a singleton that, during init, does `await import('agentdb')` and `await import('@claude-flow/memory')` to load controllers, then every public method is a thin delegation:

```
syncWithRemote()        → return this.syncCoordinator.sync(onProgress)      (:1960)
createRecallCertificate() → return this.explainableRecall.createCertificate(params) (:1992)
startQUICServer()       → return this.quicServer.start()                    (:2048)
recallDiverseEpisodes() → this.mmrRanker.selectDiverse(...)                 (:1080)
storePattern()          → return this.reasoningBank.storePattern(...)       (:1164)
queryCausalPath()       → this.causalGraph.queryCausalEffects(...)          (:1233)
```

The fork's own `controller-bridge.ts` header states this explicitly (ADR-0076 Phase 4 transition adapter): *"MCP tool files can switch their import from AgentDBService to this bridge [→ `ControllerRegistry` from `@claude-flow/memory`] without changing their calling pattern… Phase 5 will remove this bridge entirely, wiring MCP tools directly to the registry."* (`controller-bridge.ts:1-15`). **`AgentDBService` IS the legacy path the fork already planned to delete.** The live `@claude-flow/memory` `ControllerRegistry` (used by the live archivist) holds the **same** controllers (`controller-registry.ts:310,398,912,1731,2101` — `QuantizedVectorStore`, `NightlyLearner`, `scalarQuantizer`, etc.).

**Every controller behind every "candidate orphan" tool lives in `forks/agentdb/src/controllers/` and survives retirement:**
`ExplainableRecall.ts`, `QUICClient.ts`, `QUICServer.ts`, `QUICConnection.ts`, `StreamingEmbeddingService.ts`, `SyncCoordinator.ts`, `MMRDiversityRanker.ts`, `NightlyLearner.ts`, `CausalRecall.ts`, `ContextSynthesizer.ts`, `ReasoningBank.ts`, `ReflexionMemory.ts`, `SkillLibrary.ts`, `HierarchicalMemory.ts`, `AttentionService.ts`, `WASMVectorSearch.ts` (full list: `forks/agentdb/src/controllers/*.ts`).

Retiring agentic-flow removes the *wrapper + tool re-exposure*. It removes **zero controllers**.

---

## 2. `AgentDBService` public method → live equivalent

| `AgentDBService` method (`agentdb-service.ts`) | Delegates to (agentdb controller) | Live `mcp__ruflo__*` equiv | Live agentdb CLI equiv | Orphan? |
|---|---|---|---|---|
| `storeEpisode` / `recallEpisodes` / `deleteEpisode` (:1010-1064) | ReflexionMemory | `agentdb_reflexion-store` / `agentdb_reflexion-retrieve` | `reflexion` | No |
| `recallDiverseEpisodes` (MMR) (:1080) | MMRDiversityRanker | `memory_search` (`smart=true`/`mmr_lambda`) — `memory-tools.js:444,549` | — | No |
| `publishSkill` / `findSkills` (:1121-1138) | SkillLibrary | `agentdb_skill_create` / `agentdb_skill_search` | — | No |
| `storePattern` / `searchPatterns` (:1164-1181) | ReasoningBank | `agentdb_pattern-store` / `agentdb_pattern-search` | `agentdb_pattern_store/search` (standalone) | No |
| `recordCausalEdge` / `queryCausalPath` (:1216-1233) | CausalMemoryGraph | `agentdb_causal-edge` / `agentdb_causal-query` / `agentdb_causal-recall` | — | No |
| `recordTrajectory` / `predictAction` (:1266-1301) | SonaTrajectory / LearningSystem | `agentdb_sona_trajectory_store` + `ruvllm_sona_create/adapt` + `agentdb_learning_predict` | — | No |
| `storeGraphState` / `queryGraph` (:1684-1744) | GraphDatabaseAdapter | `agentdb_graph_node_create` / `agentdb_graph-query` / `agentdb_graph-pathfinder` | — | No |
| `routeSemantic` (:1759) | SemanticRouter | `agentdb_semantic-route` / `agentdb_route` / `agentdb_semantic_add_route` | — | No |
| `explainDecision` (:1798) | ExplainableRecall | (no MCP tool) | `with-certificate` | No (CLI) |
| `synthesizeContext` (:1850) | ContextSynthesizer | `agentdb_context-synthesize` | — | No |
| `searchWithWASM` (:1836) | WASMVectorSearch | `agentdb_filtered_search` / `embeddings_search` (HNSW) | — | No |
| `runNightlyLearner` (:1921) | NightlyLearner | `agentdb_learner_run` (+ `agentdb_session-end` triggers it) | — | No |
| `consolidateEpisodes` (:1950) | MemoryConsolidation | `agentdb_consolidate` | `consolidate` | No |
| `syncWithRemote` / `getSyncStatus` (:1960-1970) | SyncCoordinator | (no MCP tool) | `sync` | No (CLI) |
| `createRecallCertificate` + verify/justify/trace/audit (:1992-2048) | ExplainableRecall | (no MCP tool) | `certificates`, `with-certificate` | No (CLI) |
| `startQUICServer` / `stopQUICServer` (:2048-2068) | QUICServer | (no MCP tool) | (transport for `sync`) | No (CLI/transport) |
| `generateEmbedding(s)` (:2090-2114) | EnhancedEmbeddingService (RVF) | `embeddings_generate` / `embeddings_neural` | `embed` | No |
| `storeEpisodesWithDedup` (:2140) | ReflexionMemory + dedup | `agentdb_reflexion-store` (dedup internal) | — | No |
| `pruneStaleMemories` / `previewPruning` (:2175-2212) | MemoryConsolidation | `agentdb_consolidate` (prune mode) | `prune` | No |
| `selectModelForTask` / `recordModelSpend` / `getCostOptimizer` (:2267-2292) | CostOptimizerService (fork svc) | `cost-report`/`cost-optimize` skills; `performance_*` | — | No (skill) |
| `getMetrics` / `getRVFStats` / `getAttentionStats` (:1808-1921) | (aggregators) | `agentdb_health` / `agentdb_query_stats` / `agentdb_attention_metrics` | `agentdb_stats` | No |

---

## 3. fastmcp tool group → live equivalent (the ~190-tool surface)

| fastmcp module (`tools/*.ts`) | # | Live equivalent surface | Orphan tools |
|---|---|---|---|
| `memory-tools` (hierarchical) | 6 | `agentdb_hierarchical-store/recall/query/delete` + `agentdb_consolidate` | none |
| `neural-tools` | 6 | `neural_train/predict/status` + `agentdb_neural_patterns` + `agentdb_learner_run` | `neural_explain`→(no tool; ExplainableRecall CLI) |
| `attention-tools` | 6 | `agentdb_attention_metrics/configure/benchmark` | `attention_flash/multihead/moe`→ controller survives, no live tool |
| `daa-tools` | 10 | `daa_*` (live: agent_create/adapt/cognitive_pattern/knowledge_share/learning_status/performance_metrics/workflow_create/execute) | `daa_init`/`daa_meta_learning`→ ruv-swarm `daa_init`/`daa_meta_learning` live |
| `workflow-tools` | ~13 | `workflow_*` (create/execute/list/status/template) + `automation:*` skills | `self_healing`/`drift_detect`/`smart_spawn`→ `automation:*` skills |
| `session-tools` | 8 | `session_*` (save/restore/list/info) + `agentdb_session-start/end` + `memory_search` | none |
| `quic-tools` | 7 | — (no live MCP) | all 7 → SyncCoordinator/QUIC* controllers survive; live via agentdb CLI `sync` |
| `performance-tools` | 15 | `performance_*` + `analysis:*`/`optimization:*` skills | none material |
| `rvf-tools` | 7 | `embeddings_*` + `vector` skill (`npx ruvector`) + `neural_compress` | `rvf_quantize_4bit`/`rvf_progressive_compress`→ QuantizedVectorStore survives, no live tool |
| `hidden-controllers` | 17 | `agentdb_context-synthesize` (context_synth); `embeddings_search`/`filtered_search` (wasm_search); `agentdb_learner_run` (nightly_*) | `recall_certificate/verify/audit`, `sync_remote/status`, `quic_*` → controllers survive; certs+sync live via agentdb CLI |
| `sona-tools` / `sona-rvf-tools` | 8+11 | `ruvllm_sona_create/adapt` + `agentdb_sona_trajectory_store` | none material |
| `streaming-tools` | 10 | `embeddings_neural` (StreamingEmbeddingService); SSE is HTTP-server detail | streaming-as-tool → controller survives, no live tool |
| `quantization-tools` | 8 | `neural_compress` (`method:'quantize'`, `neural-tools.js:535`) | `agentdb_quantize_status` is "deferred (bridge not impl)" even in live v3 (`agentdb-tools.js:1557`) — already not a live tool |
| `explainability-tools` | 10 | — (no live MCP) | all → ExplainableRecall survives; live via agentdb CLI `with-certificate` |
| `cost-optimizer-tools` | 4 | `cost-report`/`cost-optimize` skills | none |
| `consensus-tools` / `swarm` | — | `hive-mind_consensus` + `coordination_consensus` (live) | none |
| `github-tools` | 8 | `github_*` (live) | none |
| `infrastructure-tools` | 13 | `system_*` / `swarm_*` (live) | none |
| `gnn-tools` / `ruvector-tools` / `booster-tools` | — | `agentdb_gnn`*/`embeddings_*`/`vector`; booster→`standalone-stdio` `agent_booster_*` (the LIVE agentic-flow tools, retirement-affected — see caveat) | none in scope |

---

## 4. The orphan list — tools with NO live `mcp__ruflo__*` equivalent

These are the only tools that lose their **MCP-tool exposure** on retirement. For **every one**, the underlying controller lives in agentdb and survives, and most have a live agentdb **CLI** path:

| Orphaned MCP tool | Controller (survives in agentdb) | Live fallback |
|---|---|---|
| `quic_sync_episodes/skills`, `quic_latency/health/pool_stats/0rtt/multiplex`, `quic_connect/server_start/client_status` | `QUICClient/Server/Connection`, `SyncCoordinator` | agentdb CLI `sync` (QUIC is its transport) |
| `recall_certificate`, `recall_verify`, `recall_audit`, `context_explain`, `neural_explain`, all `explainability-tools` | `ExplainableRecall` | agentdb CLI `certificates` / `with-certificate` |
| `sync_remote`, `sync_status` | `SyncCoordinator` | agentdb CLI `sync` |
| `rvf_quantize_4bit`, `rvf_progressive_compress`, `attention_flash/multihead/moe` | `QuantizedVectorStore`, `AttentionService` | `neural_compress` (quantize); attention configurable live via `agentdb_attention_configure` |
| `streaming-tools` (10, as discrete tools) | `StreamingEmbeddingService` | `embeddings_neural` (live) |

**Truly-unique-and-fully-lost capabilities (controller AND CLI AND MCP all gone): NONE.** The worst case is "loses the MCP *tool* but the controller stays and a CLI command covers it" (QUIC sync, recall certificates). Note: per memory `feedback-no-consumer-is-not-stub`, these are honest unadvertised capabilities, not stubs — but the verdict here is narrower than KEEP/DELETE: the *capability* is not lost because it lives in agentdb, which is not being retired.

---

## 5. Caveats / what this facet does NOT cover

1. **`standalone-stdio.js` IS a live-ish surface and is NOT `AgentDBService`.** The question scopes "AgentDBService + fastmcp." `standalone-stdio`'s `agent_booster_edit_file/batch_edit/parse_markdown` + `agentic_flow_*` agent-runner tools are a *separate* concern (the agentic-flow agent runtime, not the agentdb wrapper). If "retire agentic-flow" means the whole package, the booster/agent-runner tools are a distinct question for another facet — they do NOT route through `AgentDBService` and are not agentdb re-exposures. **This facet's "no loss" verdict is about the `AgentDBService`+fastmcp memory/neural layer only.**
2. **Liveness asymmetry.** Because the fastmcp `AgentDBService` server is not in `.mcp.json`, retiring it removes tools **nobody in this session can currently call**. The "loss" is theoretical (a user who manually starts `agentic-flow mcp` via `cli/mcp.ts`), not a live-surface regression.
3. **CLI-fallback freshness not load-tested.** I confirmed the agentdb CLI *registers* `sync`/`certificates`/`with-certificate`/`consolidate`/`prune` (`agentdb-cli.ts`), but did not execute them. If retirement is pursued, smoke those CLI paths once to confirm parity (per memory `feedback-always-wire-tests-into-cicd`).
4. Grep matches for "quic"/"explain"/"nightly" in live v3 `*-tools.js` were verified as **description-text only** (e.g. "quick", "explanation", NightlyLearner mentioned in `agentdb_session-end` description) — not standalone live tools. The only real "quantize" live tool is `neural_compress`; `agentdb_quantize_status` is self-documented as deferred.

---

## Key files
- `/Users/henrik/source/forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts` (2383 ln; all delegation)
- `/Users/henrik/source/forks/agentic-flow/agentic-flow/src/services/controller-bridge.ts:1-15` (the "Phase 5 will remove" smoking gun)
- `/Users/henrik/source/forks/agentic-flow/agentic-flow/src/mcp/fastmcp/servers/stdio-full.ts:862-882` (~190-tool registration)
- `/Users/henrik/source/forks/agentic-flow/agentic-flow/src/cli-proxy.ts:168` + `src/cli/mcp.ts:20` (two entry points; fastmcp-full not the default)
- `/Users/henrik/source/forks/agentdb/src/controllers/*.ts` (every backing controller — survives)
- `/Users/henrik/source/forks/agentdb/src/archivist/invariants/agentdb/*.ts` (live archivist handlers behind `mcp__ruflo__agentdb_*`)
- `/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/dist/src/mcp-tools/agentdb-tools.js` (51 live `agentdb_*` tools)
- `/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/controller-registry.ts` (live registry; same controllers)
