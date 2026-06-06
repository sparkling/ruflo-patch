# C2 Memory & Data substrate — Dispositions

**Protocol:** ADR-0292 step 6. Per divergence: re-converge / keep-with-justification / unwind. **No
implementation here** — proposals + go-ahead checkpoints only. Synthesized by the queen from
`01-upstream-proof.md` (upstream-prover), `02-fork-diff.md` + `03-patch-audit.md` (fork-auditor), and the
devil's-advocate cross-examination (independent re-drives in both envs; verdicts + errata folded into
01–03 on 2026-06-04). Re-convergence ADR: **ADR-0294**.

**DA verdict summary:** every load-bearing claim attacked and UPHELD — all 3 regressions reproduced
independently; the M1 "upstream sql.js is primary-by-design" framing survived the strongest
counter-hypothesis (fallback-became-live via ABI mismatch: REFUTED — node-24, native better-sqlite3
loads, `initSqlJs` is the primary path, `backend:"sql.js + HNSW"` hardcoded, no native branch in the
memory write path); the 24/24-DEMONSTRATED patch audit sampled and confirmed. Two DA corrections
re-characterized R3 (unwired, not removed) and reclassified `agentdb_batch` (unproven both sides).

## Disposition table

| # | Divergence | Class | Disposition | Rationale |
|---|---|---|---|---|
| **R1** | **`agentdb_causal-edge` rerouted to `causal_edges` → `graph_edges` starved → `agentdb_graph-query` (all 3 modes), `agentdb_graph-pathfinder`, and kg `traverse`/`relations`/`visualize` dead** (work upstream: cosine 0.81, PPR 0.126, real paths) | FORK-REGRESSION (top) | **RE-CONVERGE (fix, highest C2 priority)** | Root cause: ADR-0276 (premise sound, ADR-edge re-convergence correct) narrowed `causal-edge` to the CausalMemoryGraph/`causal_edges` ADR case without preserving the general-entity `graph_edges` write upstream's traversal surface reads. DA confirmed no other fork path populates `graph_edges` (`graph_edge_create`/`node_create` all fail, graphAdapter off, no fallback). **Preferred fix (a):** `causal-edge` always writes the general entity edge to `graph_edges` (upstream parity — restores graph-query/pathfinder/kg), and *additionally* writes `causal_edges` when the edge is ADR-structural (preserves ADR-0276). Alternatives: (b) route-by-edge-type — rejected: entity edges would vanish from `causal-query` (which reads `causal_edges` only) unless reads are unioned; (c) point graph-query at `causal_edges` — rejected: diverges the read contract from upstream and still splits the kg composition. **Must-not-regress:** `agentdb_causal-query`/`-recall` (J2) and the ADR-0276 acceptance. *Acceptance:* one MCP session `causal-edge`(entity) → `graph-query` k-hop/semantic/pagerank all non-empty + `graph-pathfinder` returns paths (mirror the upstream drives); ADR-0276's adr-edge checks stay green. |
| **R2** | **`ruvllm_hnsw_create/add/route` dead** — `mod.initSync is not a function` (advertised ruflo-agentdb headline family; works upstream) | FORK-REGRESSION | **ALREADY FIXED — ADR-0293 D1** (fork commit `7f2c4dfc4`, pushed, pending release) | Same root cause as C1 D1 (DA-confirmed same defect, not a second skew). No C2 work item; `smoke-adr0293-c1-reconvergence.mjs` already gates `create→add→route` returning a real score. *C2 action:* confirm post-release by re-driving `adb2-hnsw-create` in the fork env. |
| **R3** | **`embeddings_rabitq_*` (3 tools) absent from the fork's 317-tool list** while upstream ships them working (32× compression) | FORK-REGRESSION (re-characterized by DA) | **RE-CONVERGE (wire + install)** | NOT a removal to re-justify: the fork retains a real 205-line `rabitq-index.js` wrapper and declares `@sparkleideas/ruvector-rabitq-wasm@^0.1.0`; the gaps are (i) tools never registered, (ii) wasm pkg not installed. ADR-0248 was correctly scoped at the time (phantom BOTH sides, "inherited"); upstream evolved past it. **Pre-flight:** the wrapper's `mod.initSync({module})` (line 23) is the same call shape D1 just fixed — verify the rabitq wasm build's export shape first and apply the D1 shape-detection pattern if skewed. *Acceptance:* `embeddings_rabitq_build` over a ≥5-vector store returns a real compression envelope; `embeddings_rabitq_search` returns ranked results (mirror upstream proof). |
| **O1** | **`agentdb_batch{insert}` unproven on BOTH sides** — fork: `rate_limited` on FIRST call in a fresh process (single entry, DA-reproduced ×3 — not transient); upstream: "Embedder not initialized" even warm (DA) | NOT-DEMONSTRATED both sides | **OPEN — investigate, then fix or document** | Do NOT classify FORK-REGRESSION (upstream batch equally undemonstrated). Two questions: why does the fork's rate-limiter trip cold on a first single-entry call (init-order bug?); and what is the actual working batch shape (if any) on either side. *Acceptance once fixed:* batch insert of N entries lands N, content-verified. |
| **O2** | **`agentdb_semantic-route` honesty drift** — fork: bare `null` (cold) / `{success:false, "No route matched"}` (warm, semanticRouter ON with no routes); upstream: explicit `{route:null, error:"SemanticRouter not available…", recommendation:"Use agentdb_route"}` | divergence (response honesty) | **MINOR FIX with the R batch** | semanticRouter ON-but-routeless is acceptable (self-inert-until-data posture); the response envelope is not: return an explicit honest envelope (no-routes-configured + `agentdb_route` recommendation), never bare `null`. |
| **J1** | **RVF-as-sole-truth + better-sqlite3 relational split vs upstream's sql.js-primary single file** (ADR-0086/0091/0177/0166a; the category-defining divergence, M1) | FORK-AHEAD (engine) | **KEEP-WITH-JUSTIFICATION (recorded; decision ratified with ADR-0294)** | The full justification ADR-0292 demands: (i) the fork substrate is **demonstrated at functional parity** across the entire memory CRUD contract (real mpnet-768 cosine, adaptive 0.15 floor, 0-loss concurrent writes post-ADR-0284, native engines); (ii) **ADR-0177**: upstream's own *documented* vision is RVF-first — the fork built toward upstream's stated direction; upstream's *shipped* runtime (sql.js-by-design, DA-verified) lags its own vision; (iii) **ADR-0166a** correctly bounds RVF (relational axis stays better-sqlite3); (iv) unwinding would forfeit demonstrated fork fixes (0284 lock collapse, 0227 floor, 0073 cosine, mpnet-768) for a WASM engine with no native perf path. **Recorded cost:** permanent merge-tax — upstream `memory_entries` fixes must be substrate-aware-skipped (ledger row `cfc341706` is the model); the CI-enforced sql.js absence makes any future re-convergence expensive. **Standing watch:** if upstream ships its RVF-first vision, re-converge onto it then. |
| **J2** | **Fork-only `agentdb_causal-query` / `agentdb_causal-recall`** | FORK-AHEAD (load-bearing) | **KEEP** | The only working read path for the fork's `causal_edges`. Post-R1 these must keep working (acceptance includes them). |
| **J3** | **Reflexion/learner/experience/skill cluster** (~learning subset of the ~30 fork-only agentdb tools) | FORK-AHEAD | **KEEP per ADR-0293 D5** (cross-ref) | Already re-justified in C1: upstream has no episode writer / scheduled learner; genuine implement-ahead. Not re-audited here. |
| **J4** | **G7 activations: gnnService + rvfOptimizer ON** (semanticRouter G7-family ON-but-inert; upstream: all off) | FORK-AHEAD | **KEEP with this record** | Deliberate fork activation (ADR-095 lineage). semanticRouter stays ON (self-inert-until-routes) with the O2 envelope fix. README overclaim handled at X1. |
| **J5** | **42-controller registry + attention_*/semantic_*/skill_* tool clusters** (~25 tools enumerated, not all driven) | FORK-AHEAD | **KEEP; per-tool justification deferred to C3** | These are orchestration/learning surface (C1/C3), enumerated here for completeness (`toollist.json`). Avoid double-audit; C3 owns them. |
| **J6** | **kg `src/adapters/knowledge-graph-adapter.ts` shelfware** (no upstream counterpart) | FORK-AHEAD | **KEEP-AS-CAPABILITY** | Honestly self-documented (`autoRegister:false`, "NO src/ runtime", ADR-0261). Per `feedback-no-consumer-is-not-stub`: real honest unadvertised code ahead of its consumer — not a stub, not a lie, not a DELETE. |
| **J7** | **mpnet-768 embeddings** (upstream MiniLM-384) | FORK-AHEAD (by design) | **KEEP** | ADR-0052/0052a demonstrated decision; recorded divergence; adaptive-floor (ADR-0227) makes the score scale work. |
| **X1** | agentdb/kg README "ADR-095 activated five controllers in 3.6.23+" | doc drift | **FIX DOC** | Actual: 2 of the named five ON (gnnService, rvfOptimizer); semanticRouter (not among the five) also ON, inert; mutationGuard/attestationLog/guardedVectorBackend OFF. Stale both ways (upstream: all off). |
| **X2** | Backend-label drift (M6): `memory_store` "archivist (RVF + HNSW)" vs `memory_list/retrieve` "SQLite + HNSW" vs `memory_stats` "RVF + HNSW"; bridge-status advertises "all-MiniLM-L6-v2 (384-dim)" over an mpnet-768 store; CLI stats "HNSW Index: not active" vs MCP `hnswIndex:true` (ADR-0257 anomaly #5, <32-entries diagnostic) | label honesty | **FIX LABELS (one truthful string per engine)** | Three names for one substrate is a counters-vs-content smell; finish what ADR-0257 started. Include the bridge MiniLM literal. |
| **X3** | kg namespace + quote drift (M5): command template ns `knowledge-graph` vs plugin.json/README `kg-graph`; `kg search` template quotes upstream's "SemanticRouter not available" while the fork returns "No route matched" | doc drift | **FIX DOC** | Pick one namespace (match the contract ADR), align the quoted envelope with O2's outcome. |
| **X4** | ruflo-agentdb plugin contract ADR-0001 staleness: "7 embeddings_*" undercount (upstream now 10 incl. rabitq), RaBitQ-phantom note superseded by R3, controller-count claims | doc drift | **REFRESH CONTRACT ADR** | Keep the anti-magic-number discipline; update the two facts upstream evolved past, fold X1's count. |
| — | **PARITY (~30 rows)**: memory CRUD/search/unified/stats/delete, hierarchical store/recall, pattern store/search, embeddings family, sessions (incl. the `memoryEntries:0` manifest quirk — identical both sides), migrations namespace, consolidate/feedback/route/context-synthesize, `memory_export`/`memory_import_claude` (DA-closed) | PARITY | **NO ACTION** | Recorded in 02. The session quirk is documented behaviour (manifest captures the in-process buffer, not memory.db) — do not re-report. |
| — | **UPSTREAM-BROKEN: 0** | — | — | Nothing upstream met the 5-point bar. The two run-1 upstream "failures" were wrong arg shapes, corrected before any verdict. |

## Key tensions recorded (for the program record)

1. **The vision/runtime split (J1):** the fork followed upstream's *documented* RVF-first direction
   (ADR-0177) while upstream's *shipped* runtime is sql.js-primary-by-design (DA-verified). Both facts
   are true; the fork's bet is recorded as justified FORK-AHEAD with merge-tax cost and a standing
   re-convergence watch. This is the C2 analogue of C1's headline — but **inverted**: C1's premise
   failure was an assumed-broken citation; C2 has **zero assumed-broken premises** (24/24 demonstrated,
   DA-sampled). C2's failure mode is *demonstrated-then-but-diverged-since*.
2. **ADR-0276's scope-gap (R1):** a correct, well-evidenced re-convergence can still introduce a
   regression outside its sightline. The acceptance for R1 therefore tests the *composition*
   (causal-edge → graph-query → kg), not just the unit.
3. **Cold-vs-warm process** (controllers warm lazily; cold reads mis-report) is now a named
   generalization of the counters-vs-content bar point — carried into the ADR-0291 validation-bar
   practice for future categories.

## What the C2 re-convergence ADR (ADR-0294) must contain

1. **Fixes (go-ahead gated):** R1 (graph_edges write restoration, preferred option a), R3 (wire rabitq
   + install wasm, D1-pattern pre-flight), O1 (batch investigation → fix or documented boundary), O2
   (semantic-route honest envelope). Each with its acceptance check wired into `test-acceptance*.sh`
   (run_check_bg + collect_parallel) + CI path filter per `feedback-always-wire-tests-into-cicd`.
2. **Cross-ref:** R2 fixed by ADR-0293 D1 (no new work; post-release confirmation).
3. **Keep-justifications:** J1 (the substrate decision, with cost + watch), J2, J4, J6, J7 (J3/J5
   cross-ref to ADR-0293/C3).
4. **Doc repairs:** X1–X4 (bundle with the implementation batch).
5. **Supersedes/refines:** refines ADR-0276 (R1 restores the general-entity path it narrowed);
   supersedes ADR-0248's phantom note (R3); does NOT unwind ADR-0086/0091/0177 (J1 keeps them, with
   recorded re-justification).

## Go-ahead checkpoints (no work started)

- **R1, R3, O1, O2 are fork code edits → require explicit go-ahead** before any implementation.
- J1–J7 are keep (no code change) but the recorded justifications need ratification with ADR-0294.
- X1–X4 are doc/label edits → bundle with the implementation batch, go-ahead with it.
- After the next release ships ADR-0293 D1: re-drive R2's probe in the C2 fork env to confirm closure.
