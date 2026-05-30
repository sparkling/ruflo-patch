---
status: accepted
date: 2026-05-30
tags: [rvf, ruvector, hnsw, vector-search, memory, performance]
supersedes: []
depends-on: [ADR-0274]
implements: [ADR-0177]
---

# Adopt upstream's RVF progressive-indexing vision (ADR-033): RVF-native HNSW Layer B, now

## Context and Problem Statement

RVF vector search is a **brute-force O(N) linear scan** today — `RvfStore::query` iterates every live vector and computes distance (`forks/ruvector/.../rvf-runtime/src/store.rs:683`). This was flagged as a real scalability gap in ADR-0274 (the lock-fix), and the question raised there was: does the fork invent ANN, or is there an upstream path?

The answer (from a 2026-05-30 upstream source/ADR review) is that **upstream already designed the fix and the fork has been carrying its scaffolding unused**:

- **Upstream ADR-033 "Progressive Indexing Hardening"** (`ruvnet/RuVector/docs/adr/ADR-033`, Accepted 2026-02-15; amends ADR-029 RVF-canonical-format + ADR-030 cognitive-container) defines a **layered index**: **Layer A** (centroid/coarse, instant), **Layer B** (HNSW), a dual-budgeted **brute-force safety net**, and a **quality envelope** that reports which layers ran and the recall confidence (`Full / Partial(A+B) / LayerAOnly / BruteForceBudgeted / DegenerateDetected`).
- Upstream ships `query_with_envelope` (the "preferred, mandatory" query API per ADR-033 §2.4) — and **the fork inherited it** (`forks/ruvector/.../store.rs:741`, citing "ADR-033 §2.4") — but in both upstream and fork **`layer_b: false` is hardcoded and never set true** (`store.rs:487`). Layer B (HNSW) was never wired into `rvf-runtime`; the runtime runs Layer-A/brute-force + safety net.
- Upstream has a **production HNSW implementation in a different crate** — `ruvector-core/src/index/hnsw.rs` (Phase 2, `hnsw_rs` 0.3.3, M=32, all distance metrics), plus ADR-027 (HNSW parameterized query) and ADR-154 (RaBitQ binary quantization). Upstream cites ~2.5K queries/sec at O(log n) on 10K vectors. None of it is connected to the RVF cognitive-container query path yet.
- The fork is a further notch behind: its napi memory hot path calls the **bare brute-force `query()`**, not even upstream's `query_with_envelope` safety-net/quality path.

So the gap is not "fork lacks ANN" — it is "upstream designed the layered index (ADR-033), built the HNSW engine (`ruvector-core`), but has not wired Layer B into `rvf-runtime`, and the fork has not adopted even the envelope path." The decision: do we adopt that vision now, in the fork, or wait for upstream to wire it?

## Decision Drivers

* RVF is the fork's committed memory substrate (ADR-0177); brute-force O(N) search does not scale and is the flagged ADR-0274 gap.
* The fork's posture is implement-ahead-following-upstream-design (ADR-0177), not invent-divergent — ADR-033 is the design to follow so a future upstream sync reconciles cleanly.
* Deferring Layer B "until upstream wires it" / "corpus is small now" are disallowed scoping reasons (the include-out-of-scope rule).
* The HNSW engine already exists upstream (`hnsw_rs` via `ruvector-core`), so adoption is integration, not novel algorithm design.
* Must compose with ADR-0274's read/write handle split (search runs on the persistent read handle) and the RVF append-only witness chain.

## Considered Options

* **A — Adopt ADR-033 progressive indexing now, including RVF-native HNSW Layer B (chosen).** Wire the fork's RVF memory reads through `query_with_envelope`, AND implement Layer B HNSW inside `rvf-runtime` per ADR-033, using `hnsw_rs` (the same library/params as `ruvector-core`), persisted as an HNSW segment in the `.rvf` and loaded progressively. Layer A (centroid) + the budgeted brute-force safety net remain the correctness fallback.
* **B — Envelope wiring only; defer Layer B HNSW.** Route reads through `query_with_envelope` (gets the safety net + quality reporting) but leave the base brute-force. Rejected: it keeps the O(N) base and defers the actual fix on the disallowed "small now / wait for upstream" grounds.
* **C — Build a fork-divergent custom ANN.** Rejected: violates the track-upstream posture (ADR-0177); ADR-033 + `hnsw_rs` is the upstream-canonical design to follow, not reinvent.
* **D — Leave brute-force.** Rejected: O(N) per query does not scale; it is the flagged ADR-0274 gap.

## Decision Outcome

Chosen option: **"A — Adopt ADR-033 progressive indexing now, including RVF-native HNSW Layer B"**, because the engine and the design already exist upstream, brute-force is a real scaling failure (not a someday concern), and implementing Layer B *in upstream's ADR-033 shape* is convergence, not divergence — it realises ADR-0177's "adopt upstream's RVF vision" for the search dimension. Adopting today (rather than waiting for upstream to wire `rvf-runtime`) is the fork's standard implement-ahead move, made safe by following ADR-033's on-disk + API contract so a later upstream Layer B reconciles cleanly.

### Phased implementation

**Phase 1 — Wire the envelope path (no new algorithm; immediate).** Route the fork's RVF memory reads (`agentdb` `RvfBackend` / cli `@claude-flow/memory` `rvf-backend.ts`) through `query_with_envelope` instead of the bare `query()`. This activates upstream's budgeted brute-force safety net + quality-envelope reporting today, and is the seam Layer B plugs into. Composes with ADR-0274 (the persistent read handle is where the envelope query runs).

**Phase 2 — RVF-native HNSW Layer B (the adopt-today core).** In `forks/ruvector/.../rvf-runtime`: build an HNSW index over the live vectors using `hnsw_rs` (0.3.3, M=32, ef params matching `ruvector-core`/the fork's unified-embedding HNSW settings), persist it as a witnessed HNSW segment in the append-only `.rvf` (so it participates in the RootHeader/manifest + witness chain, not a sidecar), load it on `boot()` as Layer B (set `layer_b: true`), and have `query()`/`query_with_envelope` traverse HNSW with the brute-force safety net catching recall shortfalls. Incremental insert on `ingest_batch`; rebuild on `compact()`.

**Phase 3 — Quantization (Layer C), tracked separately.** RaBitQ/PQ compressed-domain search (upstream ADR-154) is the next layer; out of this ADR's scope as a distinct concern (a separate ADR), not deferred on usage/effort.

### Consequences

* Good, because RVF memory search goes from O(N) brute-force to O(log N) HNSW — the ADR-0274 scaling gap closes, on upstream's own design.
* Good, because it adopts upstream's accepted ADR-033 shape (Layer A/B + safety net + quality envelope), so a future upstream sync reconciles rather than conflicts.
* Good, because the budgeted brute-force safety net (already in-tree) bounds recall loss — wrong-but-confident answers are reported via the quality envelope, not silently returned.
* Good, because Phase 1 (envelope wiring) delivers the safety-net + quality reporting immediately, independent of Phase 2.
* Bad, because Phase 2 is real Rust work in `rvf-runtime` (HNSW build/persist/load + incremental insert) and interacts with the append-only witness chain — it must be witnessed and crash-safe (RootHeader-committed) like every other segment.
* Bad, because the HNSW index adds boot/load cost and per-ingest insert cost; this compounds ADR-0274's read-handle reload (the read handle now also loads/holds the HNSW graph) — manage via persisted-graph load (not rebuild) on boot + incremental insert.
* Neutral, because the fork implements ahead of upstream's `rvf-runtime` Layer B; if upstream later wires its own, reconcile to upstream's exact on-disk/API form (this ADR mandates following ADR-033's contract precisely to make that cheap).

### Confirmation

* A recall + latency benchmark: HNSW results vs brute-force exact over a representative corpus, asserting recall ≥ ADR-033's Layer-A/B targets and O(log N) latency scaling (sanity vs upstream's ~2.5K q/s @ 10K vectors). Run as a `cargo` bench in `rvf-runtime` (per the Rust-only dev-loop rule) + an acceptance smoke on the JS memory path.
* `query_with_envelope` reports `layer_b: true` and `RetrievalQuality::Full`/`Partial` (not `LayerAOnly`/`BruteForceBudgeted`) on indexed queries.
* The HNSW segment round-trips crash-safely: kill mid-ingest, reopen, verify the index loads from the committed RootHeader and the witness chain validates.
* Cross-process correctness (ADR-0274): the persistent read handle serves HNSW search lock-free; the index reflects writes within the ADR-0274 consistency window.

### Amendment: implemented + deployed (2026-05-30)

Implemented and released; `cargo` recall + crash-safety tests pass and the `adr0275-hnsw` JS acceptance smoke (napi `queryWithEnvelope` reports `layerB: true` + recall + quality envelope through the published binding) is green. Implementation notes:

- **Phase 2 (Layer B) — full witnessed/committed INDEX_SEG persistence** (not the build-on-boot fallback), in `forks/ruvector` (`9e4c157f9`). The runtime builds an `rvf_index::HnswGraph` incrementally on `ingest_batch` (deterministic `splitmix64(id)` level RNG — no `rand`/`Math.random`), persists it as an **`Index` segment** (reused the existing `SegmentType::Index = 0x02`) written *before* `write_manifest`→`commit_new_root` flips the RootHeader, so a crash leaves an uncommitted segment the next boot ignores (crash-safe). `boot()` loads the latest committed INDEX_SEG with no rebuild; it rebuilds-from-vectors (loud stderr log) only for legacy files or a decode failure — acceptable because the index is derived data fully reconstructible from the VEC_SEGs (not a silent data-loss fallback). Rebuilt + re-persisted on `compact()`. `query()`/`query_with_envelope()` traverse the HNSW with the brute-force safety net; `layer_b` flips to `true`.
- **Added a faithful `serialize_graph`/`deserialize_graph`** in `rvf-index` rather than reusing `encode_index_seg`/`IndexSegData` — that codec reconstructs node ids from loop position (assumes contiguous `0..N`) and drops `entry_point`/`max_layer`, so it cannot losslessly round-trip a runtime graph with non-contiguous ids (deletes/COW/external ids). The ADR's note explicitly permitted this.
- **Recall@10 = 1.0000** (n=500, dim=768, m=23/efC=100/efS=50) vs brute-force exact; crash-safe reopen loads from the committed segment without rebuild; the full rvf-runtime suite (251) + witness e2e (10) stay green.
- **Phase 1 (envelope wiring)** — `forks/ruflo` cli `@claude-flow/memory` `rvf-backend.ts` `search()` now prefers napi `queryWithEnvelope` (Layer-B base query + budgeted safety net + quality) when the binding exposes it, falling back to bare `query()` on older bindings; the envelope signal is captured (`getLastRvfEnvelope()`). The bare `query()` also traverses HNSW, so the fork search path gets O(log N) transparently.
- **Phase 3 (quantization / Layer C, upstream ADR-154)** remains out of scope → future ADR.

## Swarm Execution Plan

> Coordination model: `swarm_init` + `Agent`-tool fan-out (`run_in_background: true`), orchestrator synthesis. **No hive-mind / consensus.** Depends on ADR-0274 (search runs on its persistent read handle; the HNSW graph loads into that handle). Mostly deep Rust in `forks/ruvector/rvf-runtime` + a smaller TS envelope wiring.

**Configuration** — `swarm_init { topology: 'hierarchical-mesh', maxAgents: 4, strategy: 'specialized' }` (via `/ruflo-swarm:swarm`).

| Param | Value |
|---|---|
| topology | `hierarchical-mesh` |
| strategy | `specialized` |
| maxAgents | `4` |
| isolation | Phase-1 TS (`forks/ruflo` + `forks/agentdb`) is parallel-safe; within `forks/ruvector/rvf-runtime` the HNSW coder and the benchmarker are **sequenced** (impl → cargo bench) or worktree-isolated; **do not run concurrently with the ADR-0274 swarm on the same `forks/ruvector` tree** (WS4 depends on WS1 landing anyway). |

**Why `hierarchical-mesh`.** Phase 2 (HNSW persisted as a witnessed segment) interacts with the append-only witness chain + RootHeader-commit — the same crash-safety surface that makes ADR-0274's gate high-risk. The HNSW coder, the benchmarker, and the reviewer mesh on the persistence/crash-safety contract; the hierarchy sequences Phase-1 envelope → Phase-2 Layer B → verification.

**Agent roster**

| Agent | Type | Fork/area | Task | Wave |
|---|---|---|---|---|
| hnsw-rust | `coder` (Rust) | `forks/ruvector/rvf-runtime` | Phase 2: HNSW via `hnsw_rs` 0.3.3 (M reconciled — project mpnet m=23 vs upstream M=32), persisted as a **witnessed HNSW segment** in the append-only `.rvf` (RootHeader-committed, crash-safe), loaded on `boot()`, `layer_b: true`, incremental insert on `ingest_batch`, rebuild on `compact()`; `query()`/`query_with_envelope` traverse HNSW with the brute-force safety net. | 1→2 |
| envelope-ts | `backend-dev` (TS) | `forks/ruflo` + `forks/agentdb` | Phase 1: route both RVF memory backends (`@claude-flow/memory` `rvf-backend.ts` + agentdb `RvfBackend`) through `query_with_envelope` (safety net + quality reporting); runs on ADR-0274's read handle. No new algorithm. | 1 |
| bench-eng | `performance-benchmarker` | `forks/ruvector` + harness | `cargo` recall + latency bench (HNSW vs brute-force exact; O(log N) scaling; sanity vs upstream ~2.5K q/s @ 10K); crash-safe round-trip (kill mid-ingest, reopen, witness chain validates, index loads from committed RootHeader); JS acceptance smoke on the memory path. | 3 |
| reviewer | `code-analyzer` | read-only | Witness-chain/crash-safety: the HNSW segment participates in RootHeader/manifest + witness chain (not a sidecar); boot loads the *persisted* graph (no rebuild); `query_with_envelope` reports `layer_b: true` + `Full`/`Partial` on indexed queries. | 2→3 |

**Waves**
1. envelope-ts wires Phase 1 (immediate on the ADR-0274 read handle) ‖ hnsw-rust builds the HNSW index + traversal.
2. hnsw-rust adds witnessed-segment persistence + `boot()` load + incremental insert + `compact()` rebuild ‖ reviewer audits the persistence/crash-safety contract.
3. **Verification** — bench-eng runs recall/latency + crash-safe round-trip + JS smoke; reviewer signs off.

**Out of this swarm**: RaBitQ/PQ Layer C (upstream ADR-154) → future ADR.

**Gate**: the existing `### Confirmation` — recall ≥ ADR-033 targets, O(log N) latency, `layer_b: true` envelope, crash-safe segment round-trip, cross-process freshness within the ADR-0274 window.

## More Information

- Implements ADR-0177 (adopt upstream's RVF-first Cognitive Container vision) for the vector-search dimension; depends on ADR-0274 (the read/write handle split that search runs on).
- Upstream sources: `ruvnet/RuVector` ADR-029 (RVF canonical format), ADR-030 (cognitive container), **ADR-033 (progressive indexing hardening — the layered-index + quality-envelope design)**, ADR-027 (HNSW parameterized query), ADR-154 (RaBitQ quantization); HNSW engine at `ruvector-core/src/index/hnsw.rs` (`hnsw_rs` 0.3.3, M=32); `query_with_envelope` at `forks/ruvector/.../rvf-runtime/src/store.rs:741` (cites ADR-033 §2.4); `layer_b: false` at `store.rs:487`.
- Surfaced by ADR-0274's "RVF has no ANN; `memory_search` is brute-force O(N)" gap note and the 2026-05-30 upstream review confirming it is a shared (upstream + fork) current state, not a fork regression.
- Unified-embedding HNSW params for this project: `all-mpnet-base-v2`, 768-dim, m=23/efC=100/efS=50 — reconcile with `ruvector-core`'s M=32 default at implementation.
