# Batches H+I — Cross-fork (agentic-flow + ruvector) — agent analysis (2026-05-09)

Source: ADR-0162 Batches H and I. Produced by general-purpose research agent against `forks/agentic-flow` and `forks/ruvector`. READ-ONLY analysis.

## Batch H — agentic-flow (29 commits)

### `daa521a` confirmed-skip

SKIP. The commit deletes `packages/agentdb/` (full source tree, ~30 .md docs, .tgz tarballs, Dockerfile, src/) and replaces it with a gitlink submodule pointing at `ruvnet/agentdb@3e4a349`. Our fork removed `packages/agentdb/` entirely under ADR-0161 (extracted to `forks/agentdb/` as a peer repo, NOT as a submodule). Touching this commit would re-introduce the directory + a foreign submodule pointer that conflicts with our agentdb fork's actual git URL. Also adds `.github/workflows/agentdb-docker-test.yml` + `test-agentdb.yml` `submodules: recursive` flag — irrelevant for our setup.

### Submodule-bump commits

| SHA | Verdict | Rationale |
|---|---|---|
| `61f5841` | **SKIP** | Merge-of-`daa521a` (PR #152). Same content. |
| `d231a13` | **REWRITE-LITE** | 3 sub-changes: (1) `.gitignore` adds `benchmark-results/`, `agentdb.db-shm`, `.claude/scheduled_tasks.lock` — KEEP. (2) submodule pin bump — SKIP. (3) drops orphan `open-lovable` gitlink — KEEP if present. Cherry-pick only the .gitignore hunk. |
| `629eb4f` | **SKIP** | Pure submodule pin bump (1 file, +1/-1). |
| `bc31f0b` | **SKIP** | Pure submodule pin bump (README rewrite, applied at agentdb side). |
| `1b85f67` | **REWRITE-LITE** | 2 sub-changes: (1) submodule pin → SKIP. (2) `agentic-flow/package.json` version bump 2.0.10→2.0.11 + `dependencies.agentdb ^3.0.0-alpha.13 → ^3.0.0-alpha.14`. We track `@sparkleideas/agentdb` not `agentdb`, so dep bump is meaningless; SKIP this whole commit unless ruflo-patch needs the version-floor. |
| `5e0497d` | **SKIP** | Pure submodule pin bump (a478ab3 — plugin schema fix in agentdb). |
| `50eef3a` | **REWRITE** | NOT really a submodule bump. Touches `agentic-flow/wasm/reasoningbank/*` (regenerated WASM artifacts: `.d.ts`, `.js`, `_bg.js`, `_bg.wasm`, `_bg.wasm.d.ts`). KEEP the WASM regen; SKIP the `packages/agentdb/package-lock.json` bump (file no longer exists locally). |

### Substantive commits

**`c2af4dc fix(agentdb): add delete API to GraphDatabaseAdapter + ReflexionMemory.deleteEpisode`**
- Touches ONLY `packages/agentdb/src/...` and `packages/agentdb/tests/...` (3 files, +480 LOC).
- **Plan: Re-apply at `forks/agentdb/`, NOT in agentic-flow.** Our `forks/agentdb` was carved off pre-extraction state, so these paths exist there. Cherry-pick 1:1 in `forks/agentdb/` with the same paths minus the `packages/agentdb/` prefix.
- Coordinates with ruvector `1493bab01` (graph-node delete API). Apply both or neither.

**`f5b6c7d fix: 8 open issues + 23 verification tests`**
- 21 files, ~2300 LOC. Mixed scope: 18 files in `agentic-flow/src/` (KEEP), 3 in `packages/agentdb/src/controllers/` (re-target to `forks/agentdb/`).
- **Plan: Cherry-pick into agentic-flow with conflict resolution; the 3 agentdb files re-applied at `forks/agentdb/`.** Watch for the same `agentic-flow/src/index.ts` library-safe entrypoint patch — verify against our existing index.ts. Note `protobufjs` overrides in package.json — we may have already added them.

**`d671c91`, `57a3859`, `e60a5ba`, `62e4961`** — release/version-bump commits referencing `agentdb` as an npm dep. We track `@sparkleideas/agentdb`. **SKIP all four** unless ruflo-patch versioning needs alignment.

**Pre-extraction commits (`bd434bf` through `25b26e2`, dated 2026-03-25 to 2026-03-26):**
All 13 commits touch `packages/agentdb/...` exclusively. Our fork DOES NOT have `packages/agentdb/` anymore. **Re-target ALL of these to `forks/agentdb/`** (strip the `packages/agentdb/` path prefix during cherry-pick). Or better: skip them in agentic-flow entirely and pull the equivalent versions through `forks/agentdb` (which is 11 alpha versions ahead and may already have them).

The exception: `c830a98` adds a `.gitmodules` entry for `packages/ruvector-upstream` — both irrelevant to our setup AND conflicts with ADR-0161 architecture. **SKIP `c830a98`.**

`6ef7ebb` adds `benchmark-results/*.json|*.md` (1484 LOC of test artifacts) — **SKIP** (artifacts).

`62e4961` is the merge of `e60a5ba` (release merge) — SKIP.

### Recommended cherry-pick sequence — agentic-flow

```
SKIP: 25b26e2 (docs-only, ADR moved out of agentic-flow context)
SKIP: 7bbe540, 6ef7ebb, 45bbf17 (packages/agentdb/* — re-apply at forks/agentdb)
SKIP: d19c130, 2f24973, acfba14, 034b0a6, 24adb18, 0a8d6a1, 74f1a59 (same)
SKIP: c830a98 (ruvector submodule — ADR-0161 conflict)
SKIP: a65ae9e, 54440ca, bd434bf (same — re-apply at forks/agentdb)
PICK: f5b6c7d (cherry-pick with conflict resolution; 3 agentdb files re-target)
SKIP: e60a5ba, 62e4961, 57a3859 (release commits)
PICK: 50eef3a (KEEP only WASM artifact regen; drop lockfile hunk)
PICK: c2af4dc (re-target ALL files to forks/agentdb, NOT to agentic-flow)
SKIP: d671c91, daa521a, 61f5841, 5e0497d, 1b85f67, bc31f0b, 629eb4f
PICK: d231a13 (KEEP .gitignore additions only; drop submodule + open-lovable hunks)
```

**Net agentic-flow application: 4 partial cherry-picks (50eef3a, c2af4dc → forks/agentdb, f5b6c7d, d231a13). 25 SKIPs.**

## Batch I — ruvector (39 commits)

### NAPI-RS binary commits — confirmed SKIP

All 16 commits (`ef5274c29`, `e38347601`, `6808c706e`, `fa39e66cf`, `ec4e4bbd1`, `1b106721b`, `5c580ebae`, `645c94df4`, `259c28965`, `5ea1c275e`, `b71981b5c`, `81a3532f3`, `77b44c2e1`, `999bfbdf7`, `225184550`, `368d64a29`, `0442856c3` partial, `5e0a1a414`, `8b518302c`) touch ONLY `npm/core/native/*/ruvector.node` and `npm/core/platforms/*/ruvector.node`. **SKIP ALL — we rebuild locally.**

### Substantive commits — application plan

| SHA | Subject | Scope | Plan |
|---|---|---|---|
| `d771d06ee` | NPU embedding + multi-Pi cluster (ADRs 167-170) | New `ruvector-hailo-cluster` crate, CI workflows | **PICK as add-only.** Crate doesn't exist locally; clean addition. |
| `c7b0ba4c0` | NPU pipeline pool + bridge cache/health | Builds on `ruvector-hailo-cluster` | **PICK.** Depends on `d771d06ee`. |
| `c12d828b7` | Hailo lint cleanup + bridge test gates | Same crate | **PICK.** Depends on prior 2. |
| `0442856c3` | Hailo bench fingerprint + StatsResponse | Same crate, plus 1 NAPI binary | **PICK** with `--no-binary` filter. Drop the `npm/core/...` hunk. |
| `c6d69003a` | ADR-179: 4-Pi 5 + Hailo HAT cluster | Same crate, plus `RUVLLM_CLUSTER_PLAN.md`, deploy scripts | **PICK.** |
| `55eae8887` | ADR-180: ruvllm 2.2.1 cache-reset patch | Same crate, plus pi-worker.rs | **PICK.** |
| `1493bab01` | feat(graph-node): deleteNode/Edge/Hyperedge | `crates/ruvector-graph-node/src/{lib,types}.rs`, `ruvector-core/.../hypergraph.rs`, `ruvector-graph/src/graph.rs`, `npm/packages/graph-node/package.json` | **REVIEW BEFORE PICK.** Our fork has 84+/157- divergence at graph-node/lib.rs. Will conflict; manual merge required. CRITICAL: paired with agentic-flow `c2af4dc`. |
| `4922b034f` | Foundational `ruvllm_sparse_attention` crate | New crate (20 files) | **PICK as add-only.** Crate absent locally. |
| `4c375e7ef` | KV cache decode_step + GQA/MQA forward (17 tests) | Same crate | **PICK.** Depends on `4922b034f`. |
| `eb0fc2858` | Export KvCache from lib.rs | Same crate | **PICK.** |
| `4db35f280` | IncrementalLandmarks + decode_batch | Same crate | **PICK.** |
| `add51a930` | parallel forward_gqa + export | Same crate | **PICK.** |
| `3c80010c0` | sorted candidates + H2O eviction | Same crate | **PICK.** |
| `efc3d3618` | flash-sparse IO tiling, FP16 KV, SIMD | Same crate | **PICK.** |
| `9d8006ae2` | FastGRNN-gated near-linear attention v0.1.1 | Same crate (substantial: README +413, attention.rs major) | **PICK.** |
| `c30987277` | docs: SOTA extension sections in ADRs 183/184/186/189/190 | Docs only | **PICK.** |
| `068bb637a` | Update README with SOTA extensions | Docs only | **PICK.** |
| `36912ba3e` | Pi 5 hardware benchmarks | Docs only | **PICK.** |
| `58de8932d` | sparse attention + Hailo-10H sections | Docs only | **PICK.** |
| `51b1ca777` | sparse-mario + retrieval_diffusion crate | New crate (3832 LOC); also adds 4 files to existing sparse_attention | **PICK LAST.** Depends on full sparse_attention chain. |

### Cherry-pick ordering (chronological/topological)

`51b1ca777 sparse-mario` does NOT apply cleanly without prior sparse-attention commits — it edits `crates/ruvllm_sparse_attention/Cargo.toml` (+4 lines) and `crates/ruvllm_sparse_attention/README.md` (+77 lines), so the crate must exist with the right structure first.

### Recommended cherry-pick sequence — ruvector

```
SKIP all 16 NAPI-RS binary churn commits

# Hailo cluster chain (oldest first)
PICK: d771d06ee (NPU embedding + cluster — new crate add-only)
PICK: c7b0ba4c0 (pipeline pool)
PICK: c12d828b7 (lint cleanup)
PICK: 0442856c3 (bench fingerprint — strip binary hunks)
PICK: c6d69003a (ADR-179)
PICK: 55eae8887 (ADR-180)

# Graph-node delete API (PAIRED with agentic-flow c2af4dc)
REVIEW + PICK: 1493bab01 (manual merge — our graph-node/lib.rs has 84+/157- divergence)

# Sparse-attention chain (chronological, must be in order)
PICK: 4922b034f (foundational — new crate)
PICK: 4c375e7ef
PICK: eb0fc2858
PICK: 4db35f280
PICK: add51a930
PICK: 3c80010c0
PICK: efc3d3618
PICK: 9d8006ae2 (v0.1.1)
PICK: 51b1ca777 (sparse-mario + new retrieval_diffusion crate)

# Docs last
PICK: c30987277 (ADR SOTA sections)
PICK: 068bb637a (README SOTA)
PICK: 36912ba3e (Pi 5 benchmarks)
PICK: 58de8932d (sparse + Hailo-10H docs)
```

**Net ruvector application: 19 PICKs (1 with manual conflict review). 20 SKIPs.**

## Risks

1. **`1493bab01` graph-node delete API will conflict.** Our fork's `crates/ruvector-graph-node/src/lib.rs` has +84/-157 divergence vs `origin/main`. The 126-line delta from upstream will need manual merge. Recommend resolving as a SEMANTIC PICK: re-implement deleteNode/deleteEdge/deleteHyperedge methods on TOP of our current lib.rs structure, taking the API contract from upstream.

2. **agentic-flow `c2af4dc` and ruvector `1493bab01` are paired.** They implement two halves of the same delete API (RuVector#427 + ruflo#1784). Apply both in the same sync session, OR defer both. Don't ship one half.

3. **`forks/agentdb` is 11 alpha versions ahead of upstream's `packages/agentdb/`.** Pre-extraction agentdb commits (25b26e2 through bd434bf, 13 commits, ~3000 LOC) may already be present at `forks/agentdb/`. **Verify before re-applying** — do `git log --grep="ADR-072"` and `git log --grep="alpha.6"` at `forks/agentdb` to check.

4. **`50eef3a` WASM regen** — the `agentic-flow/wasm/reasoningbank/*` files may have been touched by our local divergence. Cherry-pick may conflict. If it does, prefer the upstream WASM artifacts.

5. **`f5b6c7d` is a multi-PR squash** — 8 separate fixes in one commit. If conflicts, consider applying file-by-file rather than as a single cherry-pick. Particularly the Ollama provider addition (`router/providers/ollama.ts`) is large new code.

6. **NAPI-RS commits skipped means our fork won't ship NAPI binaries via this sync.** Confirmed acceptable per Henrik's M5 Max + Pi 5 cluster build setup. Ensure `npm pack` workflow rebuilds binaries before publish.

7. **No new submodules.** ADR-0161 mandates parallel-extraction (5 forks all peers), not nested submodules. Any `.gitmodules` additions in the upstream chain must be SKIPPED — including `c830a98` (ruvector submodule), `daa521a` and follow-ups.
