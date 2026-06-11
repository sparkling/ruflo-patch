# Batch-U Disposition — Slice B (BEIR / retrieval research)

ADR-0313 upstream-sync. Read-only analysis. 13 commits, newest → oldest.
Analyst slice: **B-beir-retrieval**.

## Context: why this slice is almost entirely SKIP

The fork's retrieval stack has **diverged structurally and by model** from
the upstream BEIR research line:

- **Model.** Fork unified model = `Xenova/all-mpnet-base-v2` (768-dim),
  HNSW m=23/efC=100/efS=50 (ADR-0068/0069). This entire upstream slice is
  **BEIR/BGE research**: `Xenova/bge-base-en-v1.5` (110M) and
  `bge-large-en-v1.5` (335M) bi-encoders, `Xenova/ms-marco-MiniLM-L-6-v2`
  cross-encoder reranker, a Lucene-style BM25 (Porter+Lucene stopwords),
  RRF fusion, and public BEIR datasets (NFCorpus/SciFact/ArguAna/SciDocs).
  The fork has **not** adopted BGE/CE/Lucene/BEIR.

- **Architecture.** Upstream builds a **standalone pure-function in-memory
  retrieval lib** (`v3/@claude-flow/cli/src/memory/hybrid-retrieval.ts`,
  `cross-encoder-rerank.ts`, `lucene-bm25.ts`, `bge-embedder.ts`) wired into
  the **`neural_patterns`** MCP handler via a `{mode:'hybrid', alpha,
  mmrLambda, rerank}` param, scoring BM25 over the candidate set **per
  query** with no RVF/HNSW involvement.
  The fork has **none of these files** (verified: `ls
  v3/@claude-flow/cli/src/memory/` → archivist-init, intelligence,
  memory-router, rabitq-index, sona-optimizer, ewc-consolidation,
  neural-package-bridge — and **no** hybrid-retrieval / cross-encoder-rerank
  / lucene-bm25 / bge-embedder). The fork's `neural-tools.ts` (35 KB) has
  **zero** references to `hybrid|rerank|bm25|mmr|alpha|mode:|outcome` — its
  `neural_patterns` search routes through `memory-router` (mpnet ONNX
  embedder + RVF). A **separate, already-present** hybrid path exists:
  `agentdb_pattern-search` is documented as *"Search patterns via
  ReasoningBank controller with BM25+semantic hybrid"* (agentdb-tools.ts),
  dispatched through the archivist's SQLite carve-out.

Consequently the fork **already has** BM25+semantic hybrid retrieval; porting
the upstream lib would stand up a **second, competing** in-memory BM25 path
that fights the fork's ReasoningBank+RVF hybrid and presupposes a
`neural_patterns` cosine implementation the fork doesn't run. None of the 13
commits touch a file the fork shares in a way that benefits the mpnet stack.

Most commits are **release-tagged research deliverables** (benchmark runner
`.mjs` + giant per-query result JSONs + an ADR-08x/09x doc) that the fork
deliberately does not carry. Two were examined as model-agnostic
HAND-PORT candidates (the **outcome signal** in the pretrain harvester, and a
generic **RRF utility**) and both are declined with specific reasons below.

## Disposition table

| SHA | type(area) | subject | VERDICT | rationale + fork-evidence | target files / port-approach |
|---|---|---|---|---|---|
| ef4acc49d | feat(beir) | 4-dataset BEIR (SciDocs) + config-divergence finding (ADR-091) | SKIP-by-policy(research-infra) | Adds a 4th BEIR dataset run + leaderboard + the "no single pipeline wins everywhere" finding. Pure BGE/Lucene/RRF/CE benchmark deliverable (runner .mjs + result JSONs + ADR). Fork ships none of this pipeline; its model is mpnet, not BGE. No fork src file touched. | none (benchmark `.mjs`/JSON/ADR only) |
| 05bb9cf7e | feat(beir) | 3-dataset BEIR (ArguAna) + ruvector@0.2.27 + #2246 fixes (ADR-089/090) | SKIP-by-policy(research-infra) | BEIR research batch. The non-research riders (ruvector@0.2.27 Tier-0 wiring; 4 user-bug fixes from upstream issue #2246) are bundled but belong to the **ruvector/MCP-init** slice, not BEIR retrieval; out of this slice's scope and not portable here. Retrieval content is BGE+RRF+CE on ArguAna. | none in this slice (ruvector/#2246 riders belong to a different batch-U slice) |
| aa810856f | feat(beir) | Lucene BM25 + RRF + CE rerank — passes acceptance (ADR-088) | SKIP-fork-ahead / SKIP-by-policy | Adds `src/memory/lucene-bm25.ts` (Porter 1980 + Lucene stopwords + Okapi k1=1.2/b=0.75) + inline `rrfFuse(rankings,k=60,weights)` + a BEIR runner. **Fork already has BM25+semantic hybrid** via ReasoningBank (`agentdb_pattern-search`). The Lucene-BM25 lib + RRF are coupled to the BEIR/BGE/CE runner; the RRF fn is **inline in lucene-bm25.ts and the .mjs runner**, not a standalone utility, and presumes the BGE-dense + Lucene-sparse candidate lists the fork doesn't produce. Porting = a 2nd BM25 path competing with the live ReasoningBank hybrid. | (declined) `lucene-bm25.ts` / `rrfFuse` — see PICK/HAND-PORT details §RRF |
| ea99215f8 | feat(beir) | RRF ablation harness + HONEST NEGATIVE RESULT (ADR-087) | SKIP-by-policy(research-infra) | Ships an RRF ablation harness + the finding that default RRF k=60 equal-weights **degrades** nDCG@10 vs dense-alone on this corpus. Negative result, benchmark `.mjs` + bootstrap-CI; informative but not code the fork runs. The cautionary insight (asymmetric-strength inputs → RRF noise-averaging) is captured here for the fork's record, no port. | none (harness `.mjs` + ADR) |
| 149027817 | feat(intelligence) | BEIR matrix + bootstrap CIs + 2nd dataset (ADR-086) | SKIP-by-policy(research-infra) | "This release IS the infrastructure": BEIR-MATRIX.md, paired-bootstrap significance script (10k resamples, mulberry32 seed=42), perQuery JSON. **Touches no fork src .ts** (verified: no `src/`/`.ts` in diff). Statistics/benchmark tooling for the BEIR line. | none (docs + `.mjs` only) |
| 004cc2524 | feat(intelligence) | BEIR public benchmark + BGE bi-encoder — rank 2/11 NFCorpus (ADR-085) | SKIP-fork-ahead(model-conflict) | Adds `src/memory/bge-embedder.ts` loading `Xenova/bge-base-en-v1.5` directly via @xenova AutoTokenizer/AutoModel + the BEIR NFCorpus harness. **Directly conflicts** with the fork's unified mpnet embedder (ADR-0068/0069). The fork deliberately does not run BGE. | (declined) `bge-embedder.ts` — conflicts with mpnet unified model |
| 709b85949 | feat(intelligence) | cross-repo generalisation proof (ADR-084) | SKIP-by-policy(research-infra) | Parameterises `pretrain-from-github.mjs` (REPO_ROOT/GH_REPO env) + new `benchmark-cross-repo.mjs` with embedded labelled query sets for agentdb/agentic-flow. **No fork src .ts touched** (benchmark `.mjs` + ADR only). The fork has neither `pretrain-from-github.mjs` nor `benchmark-pretrained-retrieval.mjs` (verified absent). Evidence artifact, not a capability. | none (`.mjs` + ADR) |
| d3223dc3d | feat(intelligence) | joint rerank re-grid + conditional defaults (ADR-083) | SKIP-fork-ahead | Tunes the upstream hybrid lib's defaults (subjectWeight conditional on useRerank: 3.0/2.0; hybridWeight 0.5→0.7; ceWeight 0.5→0.3). These are knobs on `hybrid-retrieval.ts`/`cross-encoder-rerank.ts` the fork doesn't have. Nothing to tune. | none (default tuning of absent lib) |
| fc39e29f2 | feat(intelligence) | grid-search retrieval defaults vs labelled metric (ADR-082) | SKIP-fork-ahead | Adds `grid-search-retrieval.mjs` sweeping 32 configs + retunes alpha/subjectWeight/mmrLambda for the upstream hybrid lib. Same absent-lib dependency; the grid script + defaults target `hybrid-retrieval.ts`. | none (grid `.mjs` + default tuning) |
| 17ce6ba67 | feat(intelligence) | labelled held-out corpus + nDCG metrics (ADR-081) | SKIP-by-policy(research-infra) | Replaces a regex relevance proxy with a 10-query hand-labelled corpus + `ndcgAtK`/precision@3 in the benchmark harness. Benchmark-measurement plumbing inside `benchmark-pretrained-retrieval.mjs` (absent in fork). Methodology note, not shipped code. | none (benchmark harness + ADR) |
| 57a4a1b73 | feat(intelligence) | cross-encoder reranker (ADR-080) | SKIP-fork-ahead(model-conflict) | Adds `src/memory/cross-encoder-rerank.ts` (Xenova/ms-marco-MiniLM-L-6-v2) + `{rerank:true}` wiring into `neural-tools.ts`. The fork's `neural-tools.ts` has no rerank wiring and runs mpnet+RVF; this is a parallel CE reranker on the upstream hybrid lib. Cross-encoder rerank is a real capability but it is built on / wired to the BGE-hybrid `neural_patterns` path the fork replaced, and the model is an upstream choice not adopted by the fork. | (declined) `cross-encoder-rerank.ts` — built on absent hybrid lib + non-mpnet model |
| e6b557cb3 | feat(intelligence) | multi-field BM25 + opt-in type penalty (ADR-079) | SKIP-fork-ahead | Extends `hybrid-retrieval.ts` with multi-field (3:1 subject:body) BM25 + `META_COMMIT_REGEX` type penalty (default off, found to hurt). Depends entirely on the absent upstream hybrid lib; fork's BM25 lives in ReasoningBank. | none (extends absent lib) |
| 62df8a184 | feat(intelligence) | hybrid retrieval + outcome signal (ADR-078) | SKIP-fork-ahead | Foundational: adds `src/memory/hybrid-retrieval.ts` (BM25+cosine+MMR pure lib) + `Pattern.content` persistence + the **outcome signal** (revert/hotfix detection) in `pretrain-from-github.mjs`. (1) Hybrid lib — fork already has ReasoningBank BM25+semantic hybrid; would be a competing 2nd path on a `neural_patterns` cosine impl the fork doesn't run. (2) Outcome signal — the fork's live learning loop **already** records `outcome/reward/success` (archivist-init.ts, ADR-0090/0082) and classifies reverts/regressions (`ruvector/diff-classifier.ts`); the upstream signal is a benchmark-corpus harvester heuristic in a `.mjs` the fork lacks. | (declined) `hybrid-retrieval.ts` (competes w/ ReasoningBank) + outcome signal (fork already has outcome capture) — see details |

## PICK / HAND-PORT details

**None.** All 13 commits are SKIP (research-infra by-policy, fork-ahead, or
model-conflict). The two genuinely model-agnostic candidates flagged in the
brief were examined closely and declined:

### Candidate 1 — RRF utility (from ADR-088, aa810856f) — DECLINED

- **What it is:** `rrfFuse(rankings, k = 60, weights)` — reciprocal-rank
  fusion, `score = Σ 1/(k + rank)` across systems. Generic in principle.
- **Why declined:**
  1. It is **not a standalone reusable lib** — it lives **inline** inside
     `src/memory/lucene-bm25.ts` and is duplicated inline in the
     `run-beir-hybrid.mjs` BEIR runner. There is no `rrf.ts` to lift.
  2. Its only consumers are the **BEIR/BGE/Lucene/CE benchmark pipeline**,
     fusing a BGE-dense ranking with a Lucene-sparse ranking — candidate
     lists the fork's mpnet+RVF path does not produce.
  3. The fork's hybrid is **score-combination (α·cosine + (1-α)·BM25 + MMR)
     inside ReasoningBank**, not rank-fusion. Bolting RRF on would be a new,
     unconsumed surface (no caller), i.e. a stub — and upstream's own
     ADR-087 result is that **default RRF degraded nDCG** on these corpora.
     No evidence it would help the fork.
- **Verdict:** SKIP-fork-ahead. If a future fork ADR wants rank-fusion in the
  ReasoningBank hybrid, re-derive the 3-line formula against the fork's
  candidate lists; do not import the BEIR-coupled copy.

### Candidate 2 — Outcome signal in pretrain harvester (ADR-078, 62df8a184) — DECLINED

- **What it is:** a revert/hotfix classifier in `pretrain-from-github.mjs`:
  `success | reverted | hotfixed` per commit (revert = later
  `Revert "<subject>"`; hotfix = later commit within
  `HOTFIX_WINDOW_COMMITS=20` sharing ≥50% touched files + a
  fix|hotfix|patch keyword), then mapped to the trajectory binary verdict.
- **Why it looked portable:** model-agnostic (operates on git history, not
  embeddings) and a plausible learning-loop signal regardless of mpnet/BGE.
- **Why declined:**
  1. It lives in `pretrain-from-github.mjs` — a **benchmark-corpus bootstrap
     harvester the fork does not carry** (verified: no `pretrain-from-github`
     or `benchmark-pretrained-retrieval` script in the fork). It feeds the
     BEIR/labelled-corpus harness, not the production learning loop.
  2. The fork's **live** learning loop already captures outcome: the
     archivist's experience-record path threads `outcome/reward/success`
     (archivist-init.ts §613–691, ADR-0090 B5 / ADR-0082), and
     `ruvector/diff-classifier.ts` already classifies reverts/regressions.
     The capability the signal provides is **already present** via a
     different (and live, not benchmark-time) mechanism.
- **Verdict:** SKIP-fork-ahead. No port; the fork is not behind on
  outcome-aware learning. If the heuristic's specific revert/hotfix
  thresholds are ever wanted in the fork's harvester, that is a fork-authored
  enhancement to the fork's own ingestion, not a port of this `.mjs`.

## Per-verdict counts

| Verdict | Count | SHAs |
|---|---|---|
| PICK | 0 | — |
| HAND-PORT | 0 | — |
| SKIP-fork-ahead | 7 | aa810856f, 004cc2524, d3223dc3d, fc39e29f2, 57a4a1b73, e6b557cb3, 62df8a184 |
| SKIP-by-policy(research-infra) | 6 | ef4acc49d, 05bb9cf7e, ea99215f8, 149027817, 709b85949, 17ce6ba67 |
| SKIP-merge | 0 | — |
| SUPERSEDE | 0 | — |
| **Total** | **13** | |

Note: aa810856f, 004cc2524, 57a4a1b73 sit at the SKIP-fork-ahead /
SKIP-by-policy boundary (they add real src `.ts` but for a BGE/CE/Lucene
pipeline the fork structurally replaced); classified fork-ahead because the
fork already provides the equivalent capability (BM25+semantic hybrid via
ReasoningBank) and/or the model conflicts with the unified mpnet choice.
