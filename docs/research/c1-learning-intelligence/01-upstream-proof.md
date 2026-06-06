# C1 Learning & Intelligence — Upstream Proof Record

**Protocol:** ADR-0292 step 2-3 (prove upstream + explain mechanism). **Validation bar:** ADR-0291 §Confirmation.
**Reference env:** `/tmp/ruflo-fresh` — ruflo@3.10.36, installed bin `/Users/henrik/.npm/_npx/2ed56890c96f58f7/node_modules/.bin/ruflo`, public npm registry. **Date:** 2026-06-04.
**Production shape used:** one long-lived `ruflo mcp start` stdio session per drive (`/tmp/c1-evidence/mcp_driver.py`, `intel_threaded.py`, `autopilot_ruvllm2.py`), correct arg names derived from live `tools/list` schemas, threaded trajectory/router/sona/lora IDs, NODE_OPTIONS write-trace shim, SQLite dumps.
**Raw evidence:** `/tmp/c1-evidence/up-intel2-results.jsonl`, `up-apllm2-results.jsonl`, `up-*-fswrites.log`, ruvector runs inline below.

> **Method correction applied (track-record warning honoured).** The first drive used wrong arg names
> (`topic`/`limit`/`taskId`/`pattern_type`, no threaded `trajectoryId`) and produced a wall of
> `{"success":false,"error":"X must be a string"}` — i.e. **wrong test shape, not brokenness**. Re-derived
> every schema from the live server's `tools/list` before recording any verdict. All "WORKS" rows below are
> from the corrected drive.

## Intelligence (ruflo-intelligence) — 24 tools

| Feature | Invocation (corrected args) | Result envelope (truncated) | Verdict |
|---|---|---|---|
| `hooks_route` | `{task}` | `routing.method=semantic-native`, `backend=native VectorDb(HNSW)`, `primaryAgent=architect@0.48`, semantic matches | WORKS |
| `hooks_model-route` | `{task}` | `{model:opus, confidence:0.50, complexity:0.31, alternatives[…], implementation:tiny-dancer-neural}` | WORKS |
| `hooks_model-stats` | `{}` | `{available:true, totalDecisions:1, modelDistribution{…}, circuitBreakerTrips:0}` | WORKS |
| `hooks_model-outcome` | `{task, model, outcome}` | `{recorded:true, task, model, outcome, timestamp}` | WORKS (needs `task`+`model`+`outcome`, **not** `taskId`/`success`) |
| `hooks_explain` | `{task, verbose}` | `{task, explanation:"routing decision … keyword analysis", …}` | WORKS (needs `task`, not `topic`) |
| `hooks_intelligence_stats` | `{}` | `sona{trajectoriesTotal:5, patternsLearned:4, successRate:1, impl:real-sona}`, real moe/ewc/flash/lora blocks | WORKS |
| `hooks_metrics` | `{}` | `{_real:true, _dataSource:"intelligence-stats+routing-outcomes", patterns/agents/commands, _note:"run hooks_route to populate"}` | WORKS (honest empty) |
| `hooks_intelligence_pattern-store` | `{pattern:<string>, type, confidence}` | `{patternId:"entry_…", namespace:"pattern", stored}` | WORKS (`pattern` is a **string**) |
| `hooks_intelligence_pattern-search` | `{query, topK}` | `{results:[{patternId, similarity:0.51, namespace:pattern}], backend:"real-vector-search", note:"HNSW/SQLite BM25 hybrid"}` | WORKS (needs `topK`, not `limit`) |
| `hooks_intelligence_attention` | `{query, topK}` | `{mode:flash, results:[{weight, pattern}]}` | WORKS (needs `query`, not `task`) |
| `hooks_intelligence_learn` | `{}` | `{learned:true, cycleTriggered:true, trajectoriesProcessed:4, ewc.consolidation:true, confidence.average:0.565, impl:real-distill-consolidate}` | WORKS |
| `hooks_intelligence_trajectory-start` | `{task}` | `{trajectoryId:"traj-…", agent:coder, status:recording, impl:real-trajectory-tracking}` | WORKS |
| `hooks_intelligence_trajectory-step` | `{trajectoryId, action, result, quality}` | `{stepId:"step-…", action, result}` | WORKS (needs threaded `trajectoryId`) |
| `hooks_intelligence_trajectory-end` | `{trajectoryId, success, feedback}` | `{persisted:true, persistedId:"entry_…", learning{sonaUpdate:true, sonaPatternKey:"coder:…", sonaConfidence:0.55, ewcConsolidation:true, patternsExtracted:1}, impl:real-sona-learning}` | **WORKS — durable** |
| `neural_train` | `{modelType:"moe", epochs}` | `{success:true, _realEmbedding:true, embeddingProvider:"ruvector@0.2.27 MiniLM", modelId, status:ready, patternsStored:0, totalPatterns:0}` | WORKS — see G5 note |
| `neural_status` | `{}` | `{_realEmbeddings:true, embeddingProvider, models{total:0}, features{hnsw,quantization,flashAttention,reasoningBank:true}}` | WORKS |
| `neural_patterns` | `{list:true}` | `{patterns:[], total:0}` (neural-store empty; separate from SONA) | WORKS (honest) |
| `neural_predict` | `{input}` | `{success:true, _realEmbedding:true, _embeddingSource:"ruvector MiniLM", embedding:[384-d real], predictions:[]}` | WORKS |
| `neural_optimize` | `{}` | `{success:false, error:"No patterns to optimize. Train patterns first…"}` | WORKS (documented precondition) |
| `neural_compress` | `{}` | `{success:false, error:"No patterns to compress…"}` | WORKS (documented precondition) |
| `hooks_pretrain` | `{path, depth}` | `{success:true, _real:true, stats{filesAnalyzed:8, patternsExtracted:0}, note:"extracts import/require from .ts/.js/… only — Markdown/text → 0 by design"}` | WORKS (honest) |
| `hooks_build-agents` | `{agentTypes:"coder,tester"}` | `{outputDir, persisted:true, agents:[{type, configFile, capabilities, optimizations}]}` (writes `agents/*.yaml`) | WORKS |
| `hooks_transfer` | `{sourcePath}` | bad/empty source → `{success:false, message:"No patterns found in source project", transferred:0}` | WORKS (**honest** documented-failure) |
| `agentdb_consolidate` | `{}` | `{success:true, consolidated{promoted:0, pruned:0, timestamp}}` | WORKS |

### Mechanism — the W1 durable learning loop (write-trace + SQLite verified)

Trigger: model/operator calls `trajectory-start → -step → -end` in a **single MCP session** (in-process
`activeTrajectories` Map threads the ID). On `-end` (`hooks-tools.js`):
1. Persist trajectory → `storeFn({namespace:"trajectories", generateEmbeddingFlag:true})` → **`.swarm/memory.db memory_entries`** (ns=`trajectories`, 384-d embedding, BM25-hybrid searchable).
2. `sona.processTrajectoryOutcome(outcome)` → distils a routing pattern → **`.swarm/sona-patterns.json`** (`sona-optimizer.js DEFAULT_PERSISTENCE_PATH`); a repeat task in a NEW session reloads + reinforces (successCount/confidence climb).
3. EWC++ consolidation on success.

**Write-trace of the corrected drive (project-local, non-node_modules):**
```
2  writeFileSync  .claude-flow/neural/models.json
1  writeFileSync  .swarm/sona-patterns.json        <- SONA durable
1  writeFileSync  .swarm/model-router-state.json   <- router learning
1  writeFileSync  .swarm/memory.db                 <- trajectory rows + embeddings
1  writeFileSync  .claude-flow/neural/stats.json
1  writeFileSync  .claude-flow/neural/patterns.json
```
**SQLite dump (`.swarm/memory.db`):** `memory_entries` ns=`trajectories` = 12 rows; `episodes` table present, **0 rows**; `pattern`/`patterns`/`pretrain`/`feedback` namespaces populated. `sona-patterns.json` holds 3+ real `coder:<keywords>` patterns (confidence 0.55, successCount 1).

**Counter-vs-content (ADR-0291 #5):** `neural_train`→`patternsStored:0` / `neural_patterns`→`total:0` is the **neural-tools store**, which is *separate* from the SONA/ReasoningBank store that trajectory-end feeds. Not a malfunction — confirms ADR-0291 **G5** (two distinct stores; `neural status` counter ≠ trajectory content). `hooks_metrics` likewise reports 0 with an honest "run hooks_route to populate" note.

### Known upstream gaps re-confirmed (ADR-0291, not re-litigated)
* **G1** no automatic trigger for the W1 loop — only deliberate MCP calls reach it. Confirmed: the only auto-fire hook (ruflo-core PostToolUse) writes `.claude-flow/neural/stats.json` counters, never the optimizer.
* **G3** **`episodes` table = 0 rows upstream** even after the full battery (SQLite dump). No episode writer in the cli hooks layer. The episode→learner→action-value chain is genuinely absent upstream.

### Doc-vs-dist drift discovered
`ruflo-intelligence`'s `intelligence-transfer` skill documents `hooks_transfer` as **IPFS/Pinata** (`{action:store|load, cid}`, `PINATA_API_JWT`). **Upstream 3.10.36's `hooks_transfer` MCP tool is project-to-project** (`required:[sourcePath]`, `from-project` semantics). `PINATA_API_JWT` appears **nowhere** in the cli dist except unrelated `appliance/rvfa-distribution.js`. The skill's documented behaviour cannot be reproduced by the shipped tool — this is plugin-skill drift, not a tool defect.

## Autopilot (ruflo-autopilot) — 10 tools, one-session lifecycle

| Step | Tool | Result | Verdict |
|---|---|---|---|
| enable | `autopilot_enable` | `{enabled:true, maxIterations:50, timeoutMinutes:240}` | WORKS |
| status | `autopilot_status` | `{enabled:true, sessionId, iterations:0, taskSources, elapsedMs}` | WORKS |
| config | `autopilot_config{maxIterations,timeoutMinutes}` | `{maxIterations:50, timeoutMinutes:30, taskSources:[team-tasks,swarm-tasks,file-checklist]}` | WORKS |
| predict | `autopilot_predict` | `{action:"Work on: Release-verify all changes", confidence:0.5, reason:"Heuristic (learning not available)", remaining:41}` | WORKS |
| log | `autopilot_log{last:10}` | `[{ts, event:enabled, sessionId}, {event:reset}, …]` | WORKS |
| progress | `autopilot_progress` | `{overall:{completed:93, total:134, percent:69}, bySource{team-tasks:{tasks:[…]}}}` (real checklist scan) | WORKS |
| learn | `autopilot_learn` | `{available:false, reason:"AgentDB/AutopilotLearning not initialized", patterns:[]}` | WORKS (documented graceful state) |
| history | `autopilot_history{query, limit}` | `{query, results:[], available:false}` | WORKS (graceful — needs AgentDB) |
| reset | `autopilot_reset` | `{reset:true, iterations:0}` | WORKS |
| disable | `autopilot_disable` | `{enabled:false}` | WORKS |

**Mechanism:** state in `autopilot-state.js` (session file under project). `predict`/`learn`/`history` consult AgentDB AutopilotLearning when initialised; absent it, `predict` falls back to a heuristic over the file-checklist task scan and `learn`/`history` return `available:false`. All ten lifecycle transitions are real and persistent across the session.

## RuVLLM (ruflo-ruvllm) — 10 tools, chained

| Feature | Invocation | Result | Verdict |
|---|---|---|---|
| `ruvllm_status` | `{}` | `{wasm{available:true}, native{available:true, coordinator:active}, graph{available:true, backend:graph-node}}` | WORKS |
| `ruvllm_generate_config` | `{maxTokens, temperature}` | `{max_tokens:512, temperature:0.7, top_p:0.9, top_k:40, repetition_penalty:1.1, stop_sequences:[]}` | WORKS |
| `ruvllm_chat_format` | `{messages, template:"anthropic"}` | `<|im_start|>user\nhello<|im_end|>…` (real chatml) | WORKS |
| `ruvllm_hnsw_create` | `{dimensions:384, maxPatterns:100}` | `{success:true, routerId:"hnsw-…"}` | WORKS |
| `ruvllm_hnsw_add` | `{routerId, name, embedding[384]}` | `{success:true, patternCount:1}` | WORKS (threaded routerId) |
| `ruvllm_hnsw_route` | `{routerId, query[384], k}` | `{results:[{name:"pattern-A", score:1}]}` (exact-match retrieval) | WORKS |
| `ruvllm_sona_create` | `{hiddenDim:64}` | `{success:true, sonaId:"sona-…"}` | WORKS |
| `ruvllm_sona_adapt` | `{sonaId, quality:0.9}` | `{success:true, stats:{config{hidden_dim:64, micro_lora_rank, learning_rate, ema_decay}…}}` | WORKS |
| `ruvllm_microlora_create` | `{inputDim:384, outputDim:384, rank:8}` | `{success:true, loraId:"lora-…"}` | WORKS |
| `ruvllm_microlora_adapt` | `{loraId, quality:0.85, success:true}` | `{success:true, stats:{adapter:{lora_a:[…real weights…]}}}` | WORKS |

**Mechanism:** `ruvllm-bridge.js` / `ruvllm-wasm.js` load the bundled `ruvector@0.2.27` WASM (`@ruvector/ruvllm-wasm`) via `mod.initSync({module:bytes})`; HNSW router, SONA adapter, MicroLoRA adapter are in-WASM objects keyed by returned IDs. The create→adapt/add→route chains are stateful within the session.

> Earlier wrong shape: the first drive failed to thread `routerId`/`sonaId`/`loraId` because these tools
> double-wrap their JSON inside a `{content:[{text:…}]}` envelope; the driver unwrap was patched
> (`autopilot_ruvllm2.py`). After unwrapping, all chains pass.

## RuVector (ruflo-ruvector) — npx CLI (`ruvector@0.2.25`)

Setup followed per the binding `vector-setup` SKILL (local `npm install ruvector@0.2.25 ruvector-onnx-embeddings-wasm`).

| Feature | Invocation | Result | Verdict |
|---|---|---|---|
| `doctor` | `ruvector doctor` | "All checks passed" — `@ruvector/core`+native binding working, gnn/attention installed, rustc/cargo present | WORKS |
| `attention list` | `ruvector attention list` | 10 mechanisms (DotProduct/MultiHead/Flash/Hyperbolic/Linear/MoE/GraphRoPe/EdgeFeatured/DualSpace/LocalGlobal) | WORKS |
| `rvf examples` | `ruvector rvf examples` | 45 reference stores listed (basic_store, semantic_search, rag_pipeline, …) | WORKS |
| `hooks route <task>` | `ruvector hooks route "…"` | `{recommended:coder, confidence:0, reasoning:"default for unknown files"}` (honest, no seeded state) | WORKS |
| `info` | `ruvector info` | `{CLI:0.2.25, Implementation:native, GNN:Available}` | WORKS |
| `create -d 384 -m cosine` | `ruvector create … ` | `{Dimension:384, Metric:cosine, Implementation:native}` (writes redb file) | WORKS (create) |
| `embed text` | `ruvector embed text "…"` | `Embedding failed: ONNX WASM files not bundled. The onnx/ directory is missing.` | DOCUMENTED-SETUP-LIMITATION — see note |
| `stats <db>` | `ruvector stats …` | `Failed to load database: Unexpected token 'r', "redb…" is not valid JSON` | UPSTREAM-THIRD-PARTY-BUG — see note |

**`embed` — not "broken", a packaging limitation in the third-party `ruvector@0.2.25`.** Traced to
`ruvector/dist/core/onnx-embedder.js:184-187`: the loader requires WASM at `__dirname/onnx/pkg/…` +
`__dirname/onnx/loader.js`; the published 0.2.25 ships an **empty** `dist/core/onnx/pkg/` (only a 23-byte
`package.json`) and **no** `onnx/loader.js`, so it throws the documented "not bundled" error. Installing the
separate `ruvector-onnx-embeddings-wasm` package does **not** satisfy this path (the loader only consults
`ruvector-onnx-embeddings-wasm/parallel` conditionally). Copying the add-on's files into the expected path
advanced the error to a wasm-bindgen **ESM/CJS module-scope** mismatch. This is a genuine first-run gap in the
upstream third-party `ruvector` CLI — **identical for fork and upstream** (both shell out to `npx ruvector@0.2.25`).
The vector-setup skill explicitly lists this error class. Ruflo's own embedding path (`neural_predict`,
`embeddings_*`) uses the **bundled** `@claude-flow/embeddings` MiniLM and works (proven above).

**`stats` on a native(redb) db genuinely fails** in 0.2.25 (`stats` JSON-parses a redb binary). Third-party
ruvector bug; `info`/`attention`/`rvf`/`hooks` paths unaffected; vector.md item 81 already flags a sibling
`benchmark` known-issue. Not a Ruflo defect.

## Graph-Intelligence (ruflo-graph-intelligence) — SOURCE ONLY

`0.1.0-alpha.1` ships `src/`, `tests/`, `package.json`, `tsconfig.json` — **no skills/commands/agents/hooks/MCP**.
Plugin manifest: "RuFlo Graph Intelligence Engine — real-time relationship intelligence." **No Claude-Code-facing
feature surface (alpha library plugin).** Recorded per protocol; not rabbit-holed.
