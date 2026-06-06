# C1 Learning & Intelligence — Dispositions

**Protocol:** ADR-0292 step 6. Per divergence: re-converge / keep-with-justification / unwind. **No
implementation here** — proposals + go-ahead checkpoints only. Plus: what the C1 re-convergence ADR should
contain.

## Disposition table

| # | Divergence | Class | Disposition | Rationale |
|---|---|---|---|---|
| D1 | **RuVLLM WASM dead** — `mod.initSync is not a function` kills all 6 `ruvllm_*` create/config tools (+ likely the `neural_*` hash-fallback) | FORK-REGRESSION | **RE-CONVERGE (fix, high priority)** | Version skew: vendored `@sparkleideas/ruvector-ruvllm-wasm@2.0.2-patch.93` exports `init`+auto-instantiate (no `initSync`); the cli wrapper calls `mod.initSync`. Either (a) re-pin the wasm package to the wasm-bindgen build that exports `initSync` (match upstream `@ruvector/ruvllm-wasm`), or (b) update the wrapper to the new module shape (`init`/auto-instantiate). Whole `ruflo-ruvllm` plugin + `neural-train` SONA/MicroLoRA MCP path is non-functional in the fork while working upstream. Wire an acceptance check: one MCP-session `ruvllm_hnsw_create→add→route` must return `score`. |
| D2 | **`hooks_transfer` fabricates demo-data** on empty/nonexistent source (`total:40, dataSource:"demo-data"`) vs upstream honest `{success:false,"No patterns found"}` | FORK-REGRESSION | **UNWIND** the demo-data branch | Direct violation of `feedback-no-fallbacks` + `feedback-pass-skip-not-signal`. Restore upstream's honest empty return (hooks-tools.ts:2233-2237 → return `{success:false, message:"No patterns found in source project", transferred:0}`). Acceptance: `hooks_transfer{sourcePath:<nonexistent>}` → `success:false`, `transferred:0`. |
| D3 | **`neural_train`/`neural_predict`/`neural_status` use hash-fallback, not the real embedder** (`_realEmbeddings:false`); `cosineSimilarity:0` w/ `confidence:1`; 384/768 dim disagreement | FORK-REGRESSION (narrow) | **RE-CONVERGE (fix)** | NOT a total embeddings failure — the fork's `embeddings_*` mpnet path works (`embeddings_status initialized:true`, real 768-d vector). The **neural-tools store specifically** doesn't wire to it (`neural_status.neural.ruvector:false`). Fix = route `neural_*` through the same real embedder `embeddings_*` uses. The `confidence:1 @ similarity:0` is a scoring bug to fix alongside. Likely partly downstream of D1 (WASM init starving the provider) — re-verify after D1. |
| D4 | **`neural_compress` removed** — `{success:false, "Quantization not available — memory-initializer removed in ADR-0086 Phase 1"}` (upstream works once trained) | FORK-REGRESSION (capability) | **KEEP-WITH-JUSTIFICATION** *or* re-converge — **decision needed** | ADR-0086 Phase 1 deliberately removed the memory-initializer/quantization path. The tool now advertises a capability it cannot perform (an ADR-0210-class "lie"). Options: (a) keep removed but make the tool **honestly report "compression not supported in this build"** as a documented capability boundary (preferred — matches the honesty posture); or (b) re-port a quantization path. Do NOT leave a half-advertised no-op. Tie to the ADR-0086 disposition. |
| D5 | **Episode → action-value → causal-recall machinery** (`agentdb_learner_run`, `_experience_record`, `_learning_predict`, `reflexion-store` w/ action+task_type, `causal-recall`) absent upstream | FORK-AHEAD | **KEEP-WITH-JUSTIFICATION** | Re-justification (ADR-0292 demands "would re-enabling upstream have sufficed? No"): **upstream has NO episode writer at all** (`episodes`=0 rows, live-confirmed both sides; ADR-0291 G3) and NO scheduled learner (G4). There is no upstream mechanism to re-enable — this is genuine implement-ahead (ADR-0177), aligned with upstream's *stated* ADR-074 direction. ADR-0268/0277/0279/0280 premises are all DEMONSTRATED. Keep; record the justification in the C1 ADR. |
| D6 | **`neural_train` runtime enum enforcement** (rejects `coordination`) | FORK-AHEAD | **KEEP** | Both declare enum `[moe,transformer,classifier,embedding]`; fork enforces it, upstream silently accepts invalid `coordination`. Fork is strictly more correct. **Side action:** fix the `neural-train` SKILL + `neural.md` command doc, which wrongly say `--pattern-type coordination\|edit\|task` (drift vs the actual schema). |
| D7 | **Unified `neural_patterns` read** (surfaces reasoningBank patterns; upstream neural-store stays empty) | FORK-AHEAD | **KEEP-WITH-JUSTIFICATION** | More useful than upstream's separate-empty store; record as intentional. |
| D8 | **Auto-capture trigger** (file-hook → `hooks post-task` → episode) — ADR-0290 | FORK-AHEAD | **KEEP** (already shipped, 17/17) | Plugs the G1 trigger gap that exists identically upstream. Per ADR-0292, the smoke proves mechanism not necessity — but the gap (no auto-trigger, frozen learning) is independently DEMONSTRATED and matches upstream ADR-074's own roadmap. Keep; ensure it stays metadata-only (PII decoupling per ADR-0289). |
| D9 | **`enabled:false` in `hooks_list`** for trajectory/pattern/learn tools | NOT A DEFECT (cosmetic) | **CLARIFY (doc), optionally relabel** | The flags are `hooks_list` display metadata, not execution gates; the tools work. Recommend: leave behaviour as-is, but **correct ADR-0291 F1** (and any memory/notes) which mis-state these as a fork regression. Optionally rename the field to `autoFire`/`hookRegistered` in `hooks_list` output to stop the misreading recurring. |
| D10 | **`hooks_transfer` IPFS/Pinata skill drift** (intelligence-transfer skill documents `action:store/cid`+PINATA; upstream+fork tool is `sourcePath` project-to-project) | DOC DRIFT (both sides) | **FIX DOC** | Not a fork divergence — upstream tool never matched the skill. Update the `ruflo-intelligence` `intelligence-transfer` skill to document the real `{sourcePath, filter, minConfidence}` surface, or carve the IPFS surface into a separate (real) tool if desired. Low priority. |
| D11 | **`ruvector embed` ONNX-not-bundled + `stats` redb-JSON bug** | UPSTREAM-THIRD-PARTY | **NO FORK ACTION** (document) | `ruvector@0.2.25` first-run packaging gap + native-db stats bug; identical fork/upstream (both `npx ruvector@0.2.25`). Ruflo's own embeddings path works. Out of scope for fork re-convergence; note in the vector-setup skill (already partly documented). |

## Contradictions with ADR-0291 (must be recorded)

1. **ADR-0291 F1 is WRONG.** *"the fork's `hooks_intelligence_trajectory-*` tools are `enabled:false` and its
   sona-optimizer is off the live path … upstream's are enabled and demonstrably working."* — **Live evidence:
   the fork's trajectory tools are enabled, do real SONA learning, and persist `.swarm/sona-patterns.json` +
   RVF, exactly like upstream.** The `enabled:false` is `hooks_list` display metadata (commit ML-005
   `7162ba58c`), not a tool gate. This is the same wrong-shape failure mode ADR-0291 was written to catch,
   reproduced *inside ADR-0291 itself*. The C1 ADR must correct F1.
2. **Nuance on ADR-0291 G3/G5** — both **confirmed and strengthened** here (live SQLite dumps: `episodes`=0
   upstream after the full battery; neural-store separate from SONA store). No contradiction; reinforced.
3. **The fork's frozen-learning is NOT a regression** — it is the *same* dormant-by-design state as upstream
   (no auto-trigger, episodes empty). ADR-0287 §F10's core premise is right; only its `enabled:false` citation
   (→ F1) mis-led.

## What the C1 re-convergence ADR should contain

1. **Corrections** (record explicitly, supersede the wrong claims):
   - ADR-0291 **F1 retraction**: trajectory tools are enabled+working in the fork; `enabled:false` is cosmetic.
   - ADR-0287 §F10 **citation fix**: keep the frozen-learning premise; drop/footnote the `enabled:false
     (:1510-1512)` as non-load-bearing.
2. **Fork-regression fixes** (each with an acceptance check wired into `test-acceptance*.sh` + CI per
   `feedback-always-wire-tests-into-cicd`):
   - **D1** RuVLLM WASM init (highest priority — whole plugin family dead): re-pin wasm pkg or update wrapper;
     acceptance = one-session `ruvllm_hnsw_create→add→route` returns a score.
   - **D2** `hooks_transfer` un-fabricate demo-data → honest empty; acceptance = nonexistent source ⇒
     `success:false, transferred:0`.
   - **D3** wire `neural_*` to the real (already-working) mpnet embedder; fix `confidence@similarity:0`;
     acceptance = `neural_status._realEmbeddings:true`.
   - **D4** decide `neural_compress`: honest capability-boundary message OR re-port; acceptance asserts the tool
     never advertises a no-op.
3. **Fork-ahead justifications** (recorded, kept): D5 (episode/action-value/causal cluster), D6 (enum
   enforcement), D7 (unified neural_patterns), D8 (auto-capture trigger). Justification standard: *upstream has
   no mechanism to re-enable* (episodes=0, no scheduled learner), so these are implement-ahead, not avoidable
   divergence.
4. **Doc fixes:** D6 (neural-train skill `--pattern-type` drift), D10 (intelligence-transfer IPFS drift),
   D9 (relabel `hooks_list` `enabled`→`autoFire`), D11 (vector-setup note on ruvector embed/stats).
5. **Supersedes:** the wrong slice of ADR-0291 F1; refines ADR-0287 §F10 citation. Does **not** unwind
   ADR-0268/0277/0279/0280/0290 (premises DEMONSTRATED) — only re-justifies them as recorded FORK-AHEAD.

## Go-ahead checkpoints (no work started)
- D1, D2, D3, D4 are **fork code edits** → require explicit go-ahead before any implementation.
- D5–D8 are **keep** (no code change) but the C1 ADR recording them needs ratification.
- D9–D11 are doc/label edits → bundle with the C1 ADR, go-ahead with it.
