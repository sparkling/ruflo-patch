# C1 Learning & Intelligence — Fork Diff (classified deltas)

**Protocol:** ADR-0292 step 4. **Fork env:** `/tmp/ruflo-fork-c1` — `@sparkleideas/cli 3.7.0-alpha.10-patch.415` (`ruflo v3.7.0-alpha.10-patch.415`), Verdaccio registry, `ruflo init --full --force` + `ruflo memory init`. **Same drives, same corrected arg shapes, same long-lived-session production shape.**
**Raw evidence:** `/tmp/c1-evidence/fork-intel-results.jsonl`, `fork-apllm-results.jsonl`, `fork-*-fswrites.log`.

> **Init flag note:** the protocol's `--no-global` made the fork CLI reject with `[ERROR] Unknown option: --global`
> (parser quirk) and abort init. `--no-global` is a real flag (skips the `~/.claude` pointer); init succeeded
> without it via the `.ruflo-project` marker. No `~/.claude` writes occurred.

## Headline: the protocol's stated FORK-REGRESSION did NOT reproduce

> Protocol: *"Known expectation: fork's hooks_intelligence_trajectory-* are enabled:false (ADR-0287) — if they
> return disabled/not-found, that IS the FORK-REGRESSION."*

**They are NOT disabled.** In the fork's live MCP session, `trajectory-start → -step → -end` ran and did **real
SONA learning**: `{persisted:true, learning{sonaUpdate:true, sonaPatternKey:"coder:marker+module+payment+refactor+test+testability", sonaConfidence:0.55, ewcConsolidation:true, patternsExtracted:1}, implementation:"real-sona-learning"}`. Write-trace shows the fork wrote `.swarm/sona-patterns.json` (the c1-marker pattern persisted, confidence 0.55, successCount 1) + `.swarm/memory.rvf.wal` + `.swarm/model-router-state.json` — the **same durable loop as upstream** (fork substitutes RVF for `memory.db`).

The `enabled:false` flags (`hooks-tools.ts:1510-1517`) are **`hooks_list` display metadata only** — they describe which hooks auto-fire via settings.json, NOT whether the MCP tool executes. See `03-patch-audit.md` for full provenance (commit ML-005). **ADR-0291 F1 and the protocol's expectation are contradicted by live evidence.**

## Classified delta table

| Tool / behaviour | Upstream | Fork | Class | Evidence |
|---|---|---|---|---|
| `hooks_intelligence_trajectory-start/-step/-end` | enabled, real SONA learning, persists sona-patterns.json + memory.db | **enabled, real SONA learning, persists sona-patterns.json + memory.rvf** | **PARITY** | live drives both sides; fork sona-patterns.json shows c1 pattern |
| `hooks_explain` | `{explanation}` | `{explanation}` | PARITY | identical |
| `hooks_intelligence_pattern-store` | `{patternId:"entry_…", ns:pattern}` backend real-vector-search | `{patternId:"pattern_…", ns:patterns}` backend **reasoningBank** | PARITY (functional) | both store+retrieve; fork routes via reasoningBank controller |
| `hooks_intelligence_pattern-search` | similarity 0.51, backend real-vector-search | similarity **0.81**, backend reasoningBank | PARITY (fork higher recall) | both retrieve the stored pattern |
| `hooks_intelligence_attention` | flash weights | flash weights | PARITY | identical |
| `hooks_intelligence_stats` | sona real, reinforces across drives | sona real (fresh: trajectoriesTotal:1) | PARITY | identical shape |
| `hooks_intelligence_learn` | real-distill-consolidate | (not re-driven; same handler) | PARITY | source identical |
| `hooks_model-route/-stats/-outcome` | works | works | PARITY | live |
| `hooks_metrics` | honest empty | honest empty | PARITY | live |
| `neural_status` | `embeddingProvider: ruvector@0.2.27 MiniLM`, `_realEmbeddings:true` | (status not re-driven; predict shows) **`hash-fallback`, `_realEmbedding:false`** | **FORK-REGRESSION (embeddings)** | fork `neural_predict._embeddingSource="hash-fallback"`; upstream real MiniLM |
| `neural_predict` | `_realEmbedding:true`, real 384-d MiniLM, `predictions:[]` (no stored) | `_realEmbedding:false hash-fallback`; `predictions:[{cosineSimilarity:0, confidence:1}]` | **FORK-REGRESSION + scoring oddity** | `topConfidence:1` with `topSimilarity:0` is a counter/scoring inconsistency; `embeddingDims` 384 (predict) vs 768 (optimize) disagree |
| `neural_patterns` | `total:0` (neural-store) | `total:1` — surfaces the pattern-store entry (unified store) | FORK-AHEAD (unified read) | fork reads reasoningBank; upstream's neural-store stays separate/empty |
| `neural_train` | accepts `coordination` (schema enum **not** runtime-enforced) | **rejects** `coordination` → `-32602 must be one of moe/transformer/classifier/embedding` | **FORK-AHEAD (stricter)** | both declare the same enum; fork added `VALID_MODEL_TYPES` runtime check (neural-tools.ts:223). The neural-train SKILL's `coordination|edit|task` is itself drift vs the schema |
| `neural_optimize` | "No patterns to optimize" | `{success:true, actions:["Quantization skipped (memory-initializer removed in ADR-0086 Phase 1)"]}` | FORK divergence (ADR-0086) | fork removed quantization path; returns success+skip note |
| `neural_compress` | "No patterns to compress" (works once trained) | `{success:false, error:"Quantization not available — memory-initializer was removed in ADR-0086 Phase 1"}` | **FORK-REGRESSION (capability removed)** | fork can never compress; ADR-0086 removed memory-initializer. Re-justify (see dispositions) |
| `hooks_pretrain` | honest (0 patterns on non-code corpus) | honest (0 patterns) | PARITY | live |
| `hooks_build-agents` | writes agents/*.yaml | (not re-driven; same handler) | PARITY | source identical |
| **`hooks_transfer`** (empty/nonexistent source) | **`{success:false, message:"No patterns found in source project", transferred:0}`** (HONEST) | **`{transferred:{total:40, byType{file-patterns:8,task-routing:12,command-risk:5,agent-success:15}}, dataSource:"demo-data"}`** (FABRICATED) | **FORK-REGRESSION (counter-fabrication)** | upstream hooks-tools.js:1764-1768 returns honest empty; fork hooks-tools.ts:2233-2237 / installed dist:2027 fabricates demo data. Live-confirmed both sides |
| `agentdb_consolidate` | `{promoted:0, pruned:0}` | (not re-driven; substrate) | PARITY | — |
| **Autopilot (all 10)** | enable→…→disable all real; learn/history `available:false` (needs AgentDB) | **identical** — enable→…→disable all real; learn/history `available:false`; progress 93/134 | **PARITY** | live both sides |
| `ruvllm_status` | `{wasm.available:true, native.available:true}` | `{wasm.available:true, version:2.0.0, native.available:true, graph.available:true}` | PARITY (status only) | live |
| **`ruvllm_generate_config / chat_format / hnsw_create / sona_create / microlora_create`** | all WORK (bundled `@ruvector/ruvllm-wasm`) | **ALL FAIL** — `-32603 Failed to initialize @sparkleideas/ruvector-ruvllm-wasm: TypeError: mod.initSync is not a function` | **FORK-REGRESSION (ruvllm WASM dead)** | root-caused below; full bar met |
| `agentdb_learner_run`, `agentdb_learning_predict`, `agentdb_experience_record`, `agentdb_reflexion-store` (action/task_type dims), `agentdb_causal-recall` | **absent upstream** | present, schemas as ADR-0279/0280 | **FORK-AHEAD** | live `tools/list` both sides |

## FORK-REGRESSION root cause — RuVLLM WASM (all 6 create/config tools dead)

**Symptom (live, production shape):** every `ruvllm_*` create/config call →
`Failed to initialize @sparkleideas/ruvector-ruvllm-wasm: TypeError: mod.initSync is not a function`.

**Root cause (installed-dist + node_modules verified):**
- Fork wrapper `cli/dist/src/ruvector/ruvllm-wasm.js:47-52` does `const mod = await import('@sparkleideas/ruvector-ruvllm-wasm'); mod.initSync({module: wasmBytes})` — **byte-identical logic** to upstream's `@ruvector/ruvllm-wasm` wrapper (a faithful rebrand).
- The vendored `@sparkleideas/ruvector-ruvllm-wasm@2.0.2-patch.93` is a **newer wasm-bindgen build**: it exports `exports.init` (CJS, line 2974) and **auto-instantiates** the WASM at module load (`let wasm = new WebAssembly.Instance(…)` at top). It exports **no `initSync`**.
- Upstream's `@ruvector/ruvllm-wasm` (works live) is an **older wasm-bindgen build** that exports `initSync`.
- → `mod.initSync` is `undefined` → "is not a function" → init throws → every dependent tool returns the `-32603` isError envelope.

**Classification:** FORK-REGRESSION. The fork bundled a wasm package whose module shape diverged from the
consuming wrapper (version skew between `@sparkleideas/ruvector-ruvllm-wasm` and the `cli` wrapper). Validation
bar satisfied: production shape (long-lived MCP session) · installed-dist code verified · root-cause mechanism
named · reproducible. This is the **most consequential fork-side defect in C1** — the entire ruvllm tool family
(the `ruflo-ruvllm` plugin + `neural-train` skill's SONA/MicroLoRA MCP path) is non-functional in the fork while
working upstream.

## FORK-REGRESSION — `neural_predict`/`neural_status` hash-fallback embeddings

Upstream `neural_predict` uses real `ruvector@0.2.27` MiniLM (`_realEmbedding:true`). Fork falls back to
`hash-fallback` (`_realEmbedding:false`). Compounding scoring oddity: fork returns
`{cosineSimilarity:0, confidence:1, topConfidence:1, topSimilarity:0}` — a confidence of 1.0 on a
zero-similarity match is internally inconsistent (counter-vs-content smell), and `embeddingDims` is 384 in
`predict` but 768 in `optimize`. Likely tied to the same ruvllm-wasm/embeddings init failure starving the real
provider. **FORK-REGRESSION**, lower severity than the ruvllm-wasm break but probably the same upstream cause
(WASM init). Re-verify after the ruvllm-wasm fix.

## FORK-REGRESSION — `hooks_transfer` fabricates demo-data

Upstream returns honest `{success:false, "No patterns found in source project"}` on an empty/nonexistent source.
The fork **fabricates** `total:40` patterns with a `dataSource:"demo-data"` tag (hooks-tools.ts:2233-2237). This
is precisely the fake-success / counter-as-content anti-pattern ADR-0291 warns against, and it directly
contradicts the fork's own `feedback-no-fallbacks` / fail-loud posture. **FORK-REGRESSION** — the fork diverged
from honest to fabricated. (Note: upstream *also* contains a `demo-data` string but only the honest branch is
reachable on empty source; the fork rewired the empty branch to the fabrication.)

## FORK-AHEAD inventory (re-justify, do not assume regression)

- **Episode → action-value → causal-recall machinery** (`agentdb_reflexion-store` w/ `action`+`task_type`,
  `agentdb_learner_run`, `agentdb_learning_predict`, `agentdb_experience_record`, `agentdb_causal-recall`) —
  absent upstream (ADR-0291 F2). This is the ADR-0268/0277/0279/0280 implement-ahead cluster. Re-justification
  in `04-dispositions.md`.
- **`neural_train` runtime enum enforcement** — fork enforces the schema upstream only declares. Strictly more
  correct; keep.
- **Unified `neural_patterns` read** (surfaces reasoningBank patterns) — arguably better than upstream's
  separate-empty neural-store, but diverges; record.
