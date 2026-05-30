---
status: accepted
date: 2026-05-12
tags: [substrate, rvf, agentdb]
supersedes: [ADR-0170, ADR-0174, ADR-0175]
depends-on: [ADR-0068, ADR-0073, ADR-0086, ADR-0102]
implements: []
---

> **Status note (2026-05-28)**: All Phase 0 confirmation criteria met
> (ADR-0170/0174/0175 all `status:superseded` + `completed:true`,
> `superseded-by:[ADR-0177]`). The Amendment 2026-05-23 records the
> substrate re-convergence completion: ADR-0230 landed all 7 phases of
> upstream ADR-125 on fork main 2026-05-23. The RVF-first vision is
> in production. Flipping `proposed` → `accepted` + `completed:true`
> per the ADR's own Phase 0 trigger.

# Adopt upstream agentdb's RVF-first single-file Cognitive Container vision (supersedes the divergent postgres path)

## Context and Problem Statement

> **Stance (load-bearing):** The fork is **redoing agentdb from upstream**, not building a separate agentdb. ADR-0177 anchors the fork's substrate to whatever `ruvnet/agentdb` HEAD ships and applies a small, named delta on top. The 2026-05-12 audit of upstream `ruvnet/agentdb` (HEAD `a478ab3`) is the canonical "what does agentdb use now" reference for both upstream and fork-revert-target. Anywhere this ADR talks about substrate, it means upstream's substrate; the fork inherits it.

The fork has accumulated three substrate ADRs (ADR-0170, ADR-0174, ADR-0175) that collectively commit the fork to a **postgres-server + `ruvector-postgres` extension** substrate for both `agentdb_*` (controller state) and `memory_*` (memory entries), retiring RVF for the memory axis and introducing a third `graph_*` axis backed by `ruvector-graph` (redb or RVF-backed). These ADRs were reasoned under a "fork-freedom" posture — adopting features upstream's compat envelope keeps blocked.

The 2026-05-12 audit of upstream `ruvnet/agentdb`'s README + `docs/adrs/` revealed that **upstream's documented vision is the opposite direction**:

**Upstream README** (`ruvnet/agentdb/README.md:15-19`):

> *"Vector memory that gets smarter every time your agent uses it."*
> *"A single-file cognitive container — vectors, indexes, learning state, and a cryptographic audit trail in one `.rvf`."*

**Upstream ADR-006** (`ruvnet/agentdb/docs/adrs/ADR-006-unified-self-learning-rvf-integration.md:201-242`) is explicit:

> *"Storage Backend: @ruvector (NOT pgvector)"*
>
> *"All vector persistence in the RVF stack uses the **@ruvector** ecosystem exclusively. The system MUST NOT use `pgvector` for any vector storage, indexing, or search operations."*
>
> *"PostgreSQL persistence: When relational persistence is required (e.g., metadata, session state, audit logs), the system uses `@ruvector/rvf` file-based stores or future `@ruvector` PostgreSQL extensions — never `pgvector`. Vector data remains in the `.rvf` binary format; PostgreSQL serves only as a coordination/metadata layer when needed."*
>
> *"Any future PostgreSQL integration MUST use @ruvector's native extension that reads/writes `.rvf` segments directly, preserving witness chains, lineage tracking, and segment signing. Falling back to pgvector would break the tamper-evident audit trail and lose RVF-specific capabilities (kernel embedding, eBPF programs, quantization profiles, adaptive ef_search via solver)."*

`ruvector-postgres` (the extension our ADR-0174 Phase A.6 + ADR-0175 commit to) does **not** read/write `.rvf` segments — it uses postgres-native varlena heap storage. Confirmed by:
- ADR-0029 RVF canonical-format migration table omits `ruvector-postgres`
- `crates/ruvector-postgres/docs/ARCHITECTURE.md` describes varlena + TOAST + `ruhnsw` extension index (not RVF segment IO)
- The "RVF ↔ ruvector-postgres relationship" research record in ADR-0174 catalogues the parallel-substrate split

**Therefore the fork's current substrate direction violates upstream ADR-006's mandate.** The "future @ruvector PostgreSQL extension" ADR-006 envisions does not yet exist; `ruvector-postgres` is not it.

Upstream **ADR-007** (`ruvnet/agentdb/docs/adrs/ADR-007-ruvector-full-capability-integration.md`) lays out the actual upstream agentdb roadmap — a **5-phase, 16-week plan** to reach **~95% @ruvector capability coverage** with RVF as the canonical substrate:

| Phase | Weeks | Goal |
|---|---|---|
| Phase 1 — Critical Path | 1-3 | Native optimizers (AdamW, InfoNCE), full SIMD surface, WASM verification, RVF compression profiles, **Graph Transactions + Cypher via `querySync`** (HIGH priority), router persistence, SONA context enrichment, batch operations, tensor compression, read-only access + filter expressions |
| Phase 2 — Kernel Runtimes + Import/Export | 4-6 | Kernel + eBPF embedding APIs, model import/export (SafeTensors/HF/JSON), WASM in-memory store, ReasoningBank integration, RLM controller for RAG |
| Phase 3 — Advanced Features | 7-10 | (detail) |
| Phase 4 — Streaming + Graph Events | 11-13 | Streaming token generation, streaming graph queries + subscriptions, hyperbolic attention |
| Phase 5 — Full Ecosystem | 14-16 | RuvLLM engine integration, model management, WASM memory management |

ADR-007 success metrics target ~95% capability coverage, ACID + Cypher graph consistency, browser vector DB via WASM, full RAG via RLM, kernel embedding making RVF an "active compute container".

**User directive (2026-05-12, this session):** "Implement the agentdb readme vision (ignoring what we have done so far, its incorrect)."

**Question this ADR settles:** Pivot the fork's substrate direction back to upstream's documented RVF-first vision; supersede the divergent ADR-0170 + ADR-0174 + ADR-0175.

## Decision Drivers

* **Upstream alignment.** Upstream agentdb's README + ADRs are the documented vision; the user's directive is to follow it. Adopt the single-file `.rvf` Cognitive Container model.
* **ADR-006's explicit no-pgvector mandate** carries over to fork. Any postgres-as-vector-store (pgvector OR ruvector-postgres extension) breaks the witness chain + lineage + segment signing the RVF stack provides.
* **`feedback-no-value-judgements-on-features`.** Default to WIRE; ship the upstream surface. Upstream ships a 95%-coverage roadmap targeting RVF — ship that.
* **`feedback-no-fallbacks`.** Per-axis single substrate, fail-loud. Apply consistently: RVF is single-substrate for memory_* and agentdb_*. No dual-mode.
* **Witness chain + audit trail preservation.** WITNESS_SEG + ML-DSA-65 PQ signatures + lineage tracking via fileId/parentId/derive are RVF-native capabilities upstream ADR-006 calls out as load-bearing.
* **`project-rvf-primary` memory's original framing.** RVF was primary for memory_* per ADR-0073 + ADR-0086. This ADR returns to that original framing, retiring ADR-0175's reversal.
* **Skill/USERGUIDE/MCP surface alignment.** Upstream's docs (USERGUIDE 1934-2050 "RuVector PostgreSQL Bridge" / 3054-3180 "RVF Storage" / 5332-5644 "RuVector") describe RVF-based substrate. Skills like `/adr-index` write to `agentdb_hierarchical_store` expecting RVF-backed persistence. Fork's divergent postgres path makes the docs internally inconsistent.

## Considered Options

* **Option A** — Stay the course: keep ADR-0170 + ADR-0174 + ADR-0175 (postgres + ruvector-postgres + retire RVF for memory_*). **Rejected per user directive.**
* **Option B** — Adopt upstream's RVF-first vision; supersede the three divergent ADRs; follow upstream ADR-007's 5-phase plan. **Chosen.**
* **Option C** — Hybrid: RVF for memory_*; postgres for agentdb_*; no graph_* axis. Rejected because it preserves the pgvector / postgres-as-vector-store contradiction with ADR-006 for the agentdb_* path.
* **Option D** — Implement the "future @ruvector PostgreSQL extension that reads/writes `.rvf` segments directly" that ADR-006 imagines. Rejected because that extension doesn't exist; building it is a multi-month research project; outside fork scope.

## Decision Outcome

Chosen option: **Option B — adopt upstream's RVF-first single-file Cognitive Container vision.**

### Substrate decisions (fork-wide)

| Axis | Old substrate (ADR-0170/0174/0175) | New substrate (this ADR) |
|---|---|---|
| `memory_*` | ruvector-postgres extension via `pg.Pool` (per ADR-0175) | **`@ruvector/rvf` stack → `.rvf` single file** per upstream ADR-006 + fork ADR-0073 + ADR-0086 (returns to original framing) |
| `agentdb_*` | postgres + ruvector-postgres extension (per ADR-0170 + ADR-0174 Phase A.6) | **`@ruvector/rvf` stack → `.rvf` single file**; controllers consume RvfBackend; SQLite/sql.js retained ONLY as fallback for relational metadata when explicitly needed (per upstream ADR-006's "metadata only" pattern) |
| `graph_*` (ADR-0174's third axis) | `ruvector-graph` crate (redb or RVF-backed) | **Folded back into RVF.** Graph data persists as RVF segments via the `@ruvector/graph-node` integration (when graph-mode is enabled per upstream `agentdb/db-unified.ts`). The three-axis framing collapses to upstream's two-mode framing: graph mode (graph-node + RVF) vs sqlite-legacy fallback. |

### Supersession of ADR-0170 + ADR-0174 + ADR-0175

This ADR **supersedes** all three:

- **ADR-0170 (PostgreSQL primary for agentdb_*)** — Status flips to `superseded by ADR-0177`. The entire Phase B controller-port-to-postgres work is reverted. Controllers go back to RvfBackend consumption.
- **ADR-0174 (graph_* axis + Phase A.5 Cypher executor + Phase A.6 ruvector-postgres swap)** — Status flips to `superseded by ADR-0177`. **Two pieces survive contextually:**
  - The **narrow Cypher executor patch (ADR-0174 Phase A.5)** stays as a valuable contribution but **lands in a different substrate context**: it patches `@ruvector/graph-node`'s Cypher executor (the `executor/mod.rs:129` placeholder), which is upstream's chosen graph engine per the README + ADR-007 Phase 1 #6 ("Add Cypher query support via querySync"). The patch directly implements upstream's stated need. Re-scope: the patch is now an **upstream-PR-first** investment, not a fork-divergence patch.
  - The **graph-shaped data scope** (causal edges, skill edges, hierarchical parent/child, ADR/ODR deps as typed relations) stays — but persists via `@ruvector/graph-node` writing to RVF segments (when graph-node is configured for RVF-backed persistence; otherwise to its native redb).
  - ADR-0174 Phase A.6 (ruvector-postgres extension swap for agentdb_*) is **fully retired**.
- **ADR-0175 (mandate ruvector-postgres for memory_*)** — Status flips to `superseded by ADR-0177`. Memory_* returns to RVF; the `PostgresMemoryBackend` module proposed in ADR-0175 is not built; the configurable embeddings story (Phase 2 of ADR-0175) is preserved as independent fork work, decoupled from substrate.

### Adoption of upstream ADR-007's 5-phase plan

Fork follows upstream ADR-007's 5-phase capability-integration roadmap, with each phase implemented atop the RVF substrate. Phases re-scoped for fork's release cadence (single-bundle releases rather than 3-week sprints):

**Phase 1 — Critical Path (adapted):**
- ✅ Use `@ruvector/rvf` + `@ruvector/rvf-node` as substrate (already wired; live evidence on this machine — `.swarm/memory.rvf` 59KB writes)
- ✅ Wire `SonaLearningBackend` + `SemanticQueryRouter` + `RvfSolver` into `RvfBackend.searchAsync/insertAsync` per upstream ADR-006
- ✅ Native optimizers (`AdamWOptimizer`, `InfoNceLoss`) in `ContrastiveTrainer`
- ✅ Native EWC++ in self-learning paths
- ✅ Full SIMD surface in `NativeAccelerator` (3/16 → 16/16 ops)
- ✅ WASM verification APIs (`rvf_witness_verify`, `rvf_witness_count`)
- ✅ RVF compression profiles (Scalar / Product / Binary / Half — 4-32× memory reduction)
- ✅ **Graph Transactions + Cypher via `querySync`** — this is where the ADR-0174 Phase A.5 narrow Cypher executor patch lands. PR target: upstream `ruvnet/RuVector`.
- ✅ Router persistence (`@ruvector/router save/load`)
- ✅ SONA context enrichment
- ✅ Batch operations (10-100× bulk insert)
- ✅ Tensor compression
- ✅ Read-only access + filter expressions

**Phase 2 — Kernel Runtimes + Import/Export:**
- ✅ Kernel + eBPF embedding APIs (RVF as "active compute container")
- ✅ Model import/export pipeline (SafeTensors, HF, JSON, Binary)
- ✅ WASM in-memory store (full vector DB in browsers without N-API)
- ✅ ReasoningBank integration (replace TS pattern storage with `@ruvector/ruvllm.ReasoningBank`)
- ✅ RLM controller for RAG (multi-hop with sub-query decomposition)

**Phase 3 — Advanced Features** (per upstream ADR-007).

**Phase 4 — Streaming + Graph Events:**
- ✅ Streaming token generation
- ✅ Streaming graph queries + subscriptions (`QueryResultStream`, `HyperedgeStream`, `NodeStream`)
- ✅ Stream processing for long sequences
- ✅ Hyperbolic attention (`DualSpaceAttention`)

**Phase 5 — Full Ecosystem:**
- ✅ `RuvLLM` engine integration (`NativeRuvLLM.RuvLLMEngine`)
- ✅ Model management (`ModelDownloader`, `MODEL_ALIASES`)
- ✅ WASM memory management (`rvf_alloc` / `rvf_free`)

### Upstream-current baseline + fork deltas

The fork is **redoing agentdb from upstream**, not building a different agentdb. ADR-0177 anchors the fork's substrate to whatever `ruvnet/agentdb` HEAD ships at the time of revert — currently `a478ab3` (2026-05-12) — and lists the specific deltas the fork applies on top.

**Upstream's current storage (source-traced 2026-05-12, verified against `a478ab3`):**

| Concern | What upstream uses today |
|---|---|
| Primary substrate | **RVF** — `src/backends/factory.ts:166` returns `RvfBackend` (749 LoC, `@ruvector/rvf` → `@ruvector/rvf-node` NAPI → `rvf-runtime` Rust → `.rvf` files) |
| HNSW similarity | Built into RVF segments (progressive Layer A/B/C HNSW) |
| Graph storage (when graph mode) | `@ruvector/graph-node` NAPI → `ruvector-graph` Rust → **redb** + bincode → `.graph` files |
| Restricted-host fallback | `database-provider.ts` cascade: `RVF → better-sqlite3 → sql.js → JSON`. `sql.js` is a HARD dep (every install pulls it). |
| Self-learning loop | **Built but ORPHANED.** `SelfLearningRvfBackend` (487 LoC, composes all 6 ADR-005 components correctly per ADR-006). `factory.ts:166` returns bare `RvfBackend`, not the wrapper. README's +36% claim cannot be delivered in default deployment. |
| Cypher | Hollow — `@ruvector/graph-node` NAPI `query()` does label-only `Match`, `Statement::Delete` falls through `_ => {}`, `Statement::Return` no-op |
| postgres / pgvector / ruvector-postgres | **Zero** matches in `src/` (per ADR-006 audit) — no-pgvector mandate enforced |

**Fork's deltas on top of that baseline (what the Phases below actually do):**

| Delta | What changes vs upstream | Phase |
|---|---|---|
| **Keep RVF as primary substrate** | No change — already what upstream does | Phase 1 (revert fork's divergent ADR-0170/0174/0175 changes back to upstream's state) |
| **Keep `@ruvector/graph-node` for graph data** | No change — upstream's graph mode is correct | Phase 1 (reverse Phase D resolution-J's `enableGraph` retirement) |
| ~~**Drop the sql.js / better-sqlite3 / hnswlib-node fallback cascade**~~ **[Reversed 2026-05-12 by Amendment 2 — fork preserves upstream's cascade wholesale; no removal.]** | ~~Fork-only change. Upstream serves restricted-host populations via the cascade; fork doesn't have that user base. Per `feedback-no-fallbacks`.~~ | ~~Phase 1.5~~ retired |
| **Wire embedding model + dimension through ruflo config chain** | Fork-only change. Upstream reads model/dim from constructor options at the call site; fork canonicalizes via `ruflo init` per ADR-0068 + ADR-0102. | Phase 1.6 |
| **Fix the orphaned wrapper** — change factory.ts:166 to return `SelfLearningRvfBackend` instead of bare `RvfBackend` | **✅ Landed 2026-05-12** in `forks/agentdb/main` commit `511b7d3`. Three-line diff: type import for `SelfLearningConfig`, factory body swap to `SelfLearningRvfBackend.create()`, comment update citing ADR-006 + ADR-0177 Phase 2. Plan to PR back upstream (Phase 7). | Phase 2 ✅ |
| **Patch the hollow Cypher executor** | `forks/ruvector/crates/ruvector-graph/src/executor/mod.rs:129` — narrow scope (~1KLoC Rust). Aligns with upstream ADR-007 Phase 1 item #6 ("Add Cypher query support via querySync"). Plan to PR back upstream. | Phase 3 |
| **Track upstream ADR-007 Phases 2-5 capabilities** | Upstream's roadmap — fork picks up whatever's done upstream + invests where useful. | Phases 4-5 |
| **Retire `ruvector-bridge.ts` plugin** | Fork-only — that plugin (pgvector via `pg.Pool`) was a fork addition that violates ADR-006's no-pgvector mandate. | Phase 6 |
| **Send orphan-fix PR back to upstream** | Fork → upstream contribution; closes the orphan for upstream users too. | Phase 7 |
| **File ADR-009 clarification with upstream** | Fork → upstream issue; placeholder file ("i weds") needs upstream answer. | Phase 8 |

**Net read:** the fork's `@sparkleideas/agentdb` runs **the same RVF substrate as `npm i agentdb`** from upstream, plus the orphan fix (delivers the +36% self-learning claim upstream advertises but doesn't engage), minus the restricted-host fallback baggage (per no-fallbacks), with embedding params canonical-sourced from `ruflo init` (per the config chain). We're not building a different agentdb. We're shipping the agentdb upstream describes in its README, with three targeted fixes upstream's compat envelope blocks them from making.

### What this means concretely for forks

| Fork file | Old direction | New direction |
|---|---|---|
| `forks/ruflo/v3/@claude-flow/plugins/src/integrations/ruvector/ruvector-bridge.ts:1840` | `CREATE EXTENSION vector` (pgvector) → ADR-0174 Phase A.6 would swap to `CREATE EXTENSION ruvector` | **Retire the bridge plugin's pg-based substrate path entirely.** ruvector-bridge.ts becomes either (a) deprecated entirely if its 8 MCP tools (`ruvector_search`/`_insert`/etc.) have no dependencies, or (b) re-pointed at `@ruvector/rvf` rather than `pg.Pool`. |
| `forks/agentdb/src/backends/postgres/PostgresBackend.ts` | ADR-0170 Phase A-D primary substrate | **Retired.** Controllers consume `RvfBackend` per ADR-0086 instead. Code stays in tree as a museum piece + reference for the "future @ruvector PG extension" if that ever materializes. |
| `forks/agentdb/src/backends/rvf/RvfBackend.ts` | Existing — was being deprioritized under ADR-0170 Phase D | **Restored as primary.** All 9 controllers (ReflexionMemory, SkillLibrary, ReasoningBank, CausalMemoryGraph, HierarchicalMemory, MemoryConsolidation, NightlyLearner, LearningSystem, ExplainableRecall) consume it. |
| `forks/agentdb/src/core/AgentDB.ts:127, :397-410` | `enableGraph: true` throws (Phase D resolution-J retirement) | **Re-enable graph mode.** `@ruvector/graph-node` is reinstated as graph-axis substrate (via the `db-unified.ts` graph-mode path upstream uses). The Phase D `enableGraph` retirement is reverted. |
| `forks/ruvector/crates/ruvector-graph/src/executor/mod.rs:129` | ADR-0174 Phase A.5 patch lands here (narrow Cypher executor) | **Same — patch lands here.** But now framed as upstream-PR-first contribution per upstream ADR-007 Phase 1 #6, not as fork divergence. |
| `forks/ruflo/v3/@claude-flow/memory/src/database-provider.ts` | ADR-0175 would remove the 'rvf' → 'better-sqlite3' → 'sql.js' → 'json' cascade for memory_* | **Cascade preserved.** RVF wins (as in upstream main today). Better-sqlite3 / sql.js / json remain as fallbacks for environments without `@ruvector/rvf` available. |
| `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts` (49 tools) | Tools' handlers re-routed to postgres backends per ADR-0170 Phase B | **Tools' handlers route to RVF-backed controllers** per upstream ADR-006. Handler implementations re-point to the RvfBackend consumer pattern. |

### What about the MCP namespace alignment work (ADR-0176)?

ADR-0176 (reconcile `/adr-index` MCP tool naming) **stays valid and independent**. The tool-name fix (rename `_store` underscore → `-store` dash, etc.) is below the substrate layer — it's purely about MCP tool registration names. Whatever substrate the handlers route to (postgres under the old direction; RVF under this ADR), the tool names need to match the skill manifest. ADR-0176 lands regardless.

### Self-learning loop integration (per upstream ADR-006)

The six self-learning components upstream ADR-005 created remain standalone in fork today. This ADR mandates wiring them into `RvfBackend.searchAsync` / `insertAsync` per upstream ADR-006:

```
search()
  → SemanticQueryRouter.route(query)             [intent-based routing via HNSW]
  → RvfSolver.adaptiveSearch(query, route)       [Thompson Sampling ef_search + safety + cost]
  → SonaLearningBackend.recordTrajectory(...)    [trajectory capture for learning loop]
  → ContrastiveTrainer.update(...)               [hard negative mining + curriculum]
  → AdaptiveIndexTuner.observe(...)              [index health + tier compression decisions]
  → FederatedSessionManager.aggregate(...)       [cross-session LoRA aggregation]
  → return ranked results

insertAsync()
  → embed
  → AdaptiveIndexTuner.tierDecide(...)
  → RvfBackend.store(...)
  → WITNESS_SEG audit (rvf-crypto witness chain)
```

This is what makes "search smarter over time" — the +36% lift the README claims.

### Out of scope

- Building the "@ruvector PostgreSQL extension that reads/writes `.rvf` segments directly" upstream ADR-006 envisions. That's a multi-month upstream research project; we wait.
- Retaining `pgvector` or `ruvector-postgres` in any role for vector storage. Both retired from the fork's substrate per upstream ADR-006's mandate. (The 8 `ruvector_*` MCP tools in `ruvector-bridge.ts` plugin either retire entirely or re-point at RVF — see Open Follow-up #1.)
- Multi-machine deployment story for `memory_*` and `agentdb_*`. Upstream's vision is single-file + COW branching + RAFT federation (for graph-node). Distributed mode is downstream of Phase 4-5 and not in scope for the initial supersession.
- `memory_*` schema migration from existing data. Each user re-imports or rebuilds; this matches upstream's `.rvf` migration story (`RvfMigrator` per upstream `agentdb` package).

### Consequences

* Good, because fork's substrate direction realigns with upstream's documented vision per `feedback-no-value-judgements-on-features` and `feedback-upstream-means-upstream`.
* Good, because RVF single-file Cognitive Container preserves the witness chain (WITNESS_SEG + ML-DSA-65 PQ signatures), lineage tracking (fileId/parentId/derive), and per-segment integrity that ADR-006 names as load-bearing.
* Good, because the self-learning loop (Thompson Sampling bandit, +36% feedback gain) becomes possible — RvfSolver + SonaLearningBackend + AdaptiveIndexTuner integrate cleanly with RvfBackend per upstream ADR-006.
* Good, because the fork can adopt upstream ADR-007's 5-phase capability roadmap directly — no design translation needed; upstream's plan IS our plan.
* Good, because deployment matrix simplifies dramatically. No postgres-server. No Docker image dependency. No `RUFLO_POSTGRES_URL` env requirement. Single `.rvf` file per project. Same UX everywhere (Node, browser, WASM, edge, offline).
* Good, because the ADR-0174 Phase A.5 narrow Cypher executor patch is preserved as upstream-PR-first work — high relationship value, fork patch only if PR doesn't land.
* Good, because the ADR-0176 MCP tool-naming fix stays in scope (substrate-orthogonal).
* Bad, because reverses substantial prior fork work. ADR-0170 + ADR-0174 + ADR-0175 represent multiple weeks of design and implementation thinking. Mitigation: the design work isn't wasted — much of it (Cypher executor patch, MCP naming reconciliation, the per-controller analysis, the cypher-verification council research record) carries over and informs the new direction.
* Bad, because the postgres-multi-process-correctness argument (one of ADR-0175's drivers) loses its substrate solution. RVF's `memory.rvf.lock` file-locking remains the multi-process coordination mechanism. Mitigation: upstream's lock pattern is real and works; the in-fork concurrency issues that motivated ADR-0175's postgres bid were misframed — the actual fix is lock-file-correctness, not substrate swap.
* Bad, because hyperbolic distance, in-postgres BM25+RRF, in-DB local embeddings (the ruvector-postgres-only surfaces ADR-0174 Phase A.6 promised) retire. Mitigation: most of those surfaces have RVF-native equivalents (per upstream ADR-007 Phase 1+2): hyperbolic via `DualSpaceAttention`, hybrid via `RvfSolver` adaptive scoring, embeddings via `@ruvector/router` + ONNX in-process.
* Bad, because the multi-month commitment to upstream ADR-007's roadmap is significant. Fork either tracks upstream's pace (subject to upstream's stalled-cadence pattern documented for PR #1569 / #387) or builds independently. Mitigation: fork-freedom is preserved — we can implement ADR-007 phases ahead of upstream where useful, and upstream's stalled cadence (PRs sitting 17-33 days untouched is the baseline) means fork-side velocity has room to be faster.
* Bad, because `feedback-data-loss-zero-tolerance` becomes more load-bearing — RVF's file-locking + lineage + witness chain must be hardened to handle the multi-process scenarios postgres' MVCC would have absorbed. Mitigation: ADR-007 Phase 1 includes "Read-only access + filter expressions" via `openReadonly` for concurrent reader patterns; the lock-file write path stays as-is; CI gates for concurrent-write correctness move to acceptance suite (per the `feedback-data-loss-zero-tolerance` memory's "100% or not fixed" rule).
* **[Reversed 2026-05-12 by Amendment 2 — Phase 1.5 retired; no fallback elimination, no dep promotion. Bullet preserved for traceability.]** Good, because Phase 1.5 (dependency hygiene) eliminates three fallback substrates — `sql.js` (hard dep → removed), `better-sqlite3` (optional → removed), `hnswlib-node` (optional → removed) — and promotes the three load-bearing primaries — `@ruvector/rvf` (optional → hard), `@ruvector/rvf-node` (optional → hard), `@xenova/transformers` (optional → hard) — so the package install matrix matches the "RVF or throw" semantics rather than the upstream "RVF with three layers of silent degradation" matrix.
* Good, because embedding pipeline is committed in fork: local ONNX models via `@xenova/transformers`. Model + dimension live in the ruflo config chain (per ADR-0068 + ADR-0102), written by `ruflo init` at project creation; default = `Xenova/all-mpnet-base-v2` 768d with HNSW `m=23/efC=100/efS=50` per memory `reference-embedding-model`. No env vars and no per-call config — single source of truth at the project boundary. Embeddings never leave the process; no paid API path is default per `feedback-no-api-keys`. The embedder is a hard dep, not a fallback — agentdb without an embedder cannot produce vectors to persist in RVF.
* **[Reversed 2026-05-12 by Amendment 2 — Phase 1.5 retired; native NAPI is not mandatory; sql.js WASM fallback row stays available. Bullet preserved for traceability.]** Bad, because Phase 1.5 makes fork's `@sparkleideas/agentdb` install footprint mandate native NAPI on Node (`@ruvector/rvf-node`) and the ONNX runtime (`@xenova/transformers`). Restricted hosts that previously got the sql.js WASM fallback row are no longer supported by fork. Mitigation: this matches `feedback-no-fallbacks` discipline + the fork's bundle-release deployment posture; restricted hosts are upstream's user base, not the fork's.

### Confirmation

> **Phase confidence calibrated by the 9-agent audit (2026-05-12).** Upstream-baseline % below names how much of each phase upstream agentdb already ships; fork-effort % names what the fork has to add. Lower fork-effort = lower risk + faster delivery.

1. **Phase 0 — Supersession declarations.** ADR-0170, ADR-0174, ADR-0175 status fields update to `superseded by ADR-0177`. This ADR's status moves from `proposed` to `accepted` when all three supersedence updates land in the docs/adr/ tree. *Upstream baseline: n/a. Fork effort: trivial doc edits.*
2. **Phase 1 — Substrate revert in fork.** `forks/agentdb/src/core/AgentDB.ts` reverses Phase D resolution-J: `enableGraph: true` no longer throws; `@ruvector/graph-node` is reinstated. Controllers' `if (this.graphBackend && '<method>' in this.graphBackend)` dual-mode pattern is restored (per upstream `db-unified.ts` graph-vs-sqlite-legacy mode selection — but see Phase 1.5 below for fork's no-fallback tightening). `PostgresBackend.ts` becomes museum code — not deleted (preserved for reference + future @ruvector PG extension hook), but no controller initialization touches it. *Upstream baseline: 100% (RvfBackend at 749 LoC, factory wiring, async adapter, advanced features — per ADR-003 audit at 80%, all infra exists). Fork effort: revert the Phase D + Phase A.6 + ADR-0175 changes — substantive but mechanical.*

3. **Phase 1.5 — Dependency hygiene under `feedback-no-fallbacks`.** **[Reversed 2026-05-12 by Amendment 2 — fork preserves upstream's dependency posture wholesale. No removal of `sql.js` / `hnswlib-node`, no promotion of `better-sqlite3` to hard dep, no cascade collapse, no fail-fast at boot. See §"Amendment 2 (2026-05-12): dependency-hygiene reversal" below for the current decision. The original Phase 1.5 text and Amendment 1 below are preserved for traceability; both are superseded.]** Upstream agentdb ships sql.js as a HARD dependency (`package.json:"dependencies"`) and `better-sqlite3` + `hnswlib-node` as optional fallback substrates. Per the README's own build-targets table (L260) sql.js is named only as "Node WASM fallback — Restricted hosts that can't run NAPI" — i.e., it exists exclusively to serve the unhappy path. Under fork's no-fallbacks discipline (per `feedback-no-fallbacks`, ADR-0170, ADR-0174, ADR-0175 conventions): **fork-patch `forks/agentdb/package.json`** to:
    - **Remove** `sql.js` (hard dep → eliminated) — fallback substrate, no longer needed under "RVF or throw" posture
    - **Remove** `better-sqlite3` from `optionalDependencies` — native SQLite fallback, same retirement rationale
    - **Remove** `hnswlib-node` from `optionalDependencies` — non-ruvector HNSW fallback in factory.ts auto-cascade
    - **Promote** `@ruvector/rvf` from `optionalDependencies` → `dependencies` — the actual primary substrate; not a fallback, the foundation
    - **Promote** `@ruvector/rvf-node` from `optionalDependencies` → `dependencies` — the NAPI binding that delivers the substrate; required on Node native target
    - **Promote** `@xenova/transformers` from `optionalDependencies` → `dependencies` — **the embedding pipeline**, not a fallback. agentdb persists vectors; vectors come from somewhere; Xenova ONNX models generate them locally. Fork commits to local ONNX embedding generation per `feedback-no-api-keys` (zero paid API by default). Xenova is the embedder; its absence breaks the substrate, so it cannot be optional. **The exact model + dimension are NOT set by env var or per-call config** — they flow through the ruflo config chain (per ADR-0068 + ADR-0102) and are written by `ruflo init` into the project's `.claude-flow/config.json` (or equivalent). Default per fork memory `reference-embedding-model`: model = `Xenova/all-mpnet-base-v2`, dimension = 768, HNSW = `m=23 / efConstruction=100 / efSearch=50`. Init template sets these keys at project creation per `project-config-gaps.md` ("All 11 dead keys wired; init template generates all keys"). Phase 5 init validation per `project-phase5-testing.md` confirms every default round-trips through the config chain. Model names always full-qualified (`Xenova/...`) per `feedback-full-model-names.md` — no bare names, no runtime prefix prepending.
    - **Keep optional**: `@ruvector/rvf-wasm` (browser/edge target needs it but Node native path doesn't); `@ruvector/{attention, gnn, graph-node, router, ruvllm, sona, graph-transformer}` (capability surfaces, not substrate); `argon2` / `chalk` / `commander` / `inquirer` (security + CLI, not substrate)
    - **`database-provider.ts` cascade collapses**: the upstream 4-tier auto-selection (`'rvf' | 'better-sqlite3' | 'sql.js' | 'json'`) becomes "RVF or throw `MemoryBackendInitError`". Single substrate per axis, loud failure at boot. Matches ADR-0170's discipline for SQLite retirement, ADR-0174's discipline for graphAdapter availability, ADR-0175's discipline for postgres availability — applied uniformly. *Upstream baseline: 0% (upstream maintains the fallback chain for its install matrix). Fork effort: ~50 LoC package.json + ~30 LoC `database-provider.ts` collapse + integration-test concurrency hardening to ensure RVF lock-file coordination handles multi-process correctly per `feedback-data-loss-zero-tolerance`. The collapse delivers the "single-file `.rvf` Cognitive Container" framing the README headline promises — the framing upstream's own install matrix dilutes.*
4. **Phase 1.6 — Wire embedding config chain through `ruflo init`.** **[✅ All sub-steps a-g + cross-fork refactor complete 2026-05-12.**

    **Implementation commits:**
    - (a)/(b)/(g) on `forks/ruflo/main` `c4b36ca57` (21/21 tests)
    - (c)/(d)/(e) on `forks/agentdb/main` `5242679` (27/27 new tests, 120 baseline preserved)
    - (f) on `ruflo-patch/main` `4656787` + `2ca30ab` (asserts both `config.json` nested and `embeddings.json` top-level shapes across default + 2 alt-model flag invocations; bash -n + ADR-0097 lint clean)

    **Cross-fork refactor (extracts the 143-LoC duplicated accessor into a shared package, breaks the circular dep memory → agentdb → memory):**
    - New package `@claude-flow/config-chain` at `forks/ruflo/v3/@claude-flow/config-chain/` (auto-renamed to `@sparkleideas/config-chain` by codemod Pass 1). Picked up by existing `v3/pnpm-workspace.yaml` glob; zero workspace edits needed. Leaf dep — no workspace deps; runtime deps zero, devDeps `@types/node` + `vitest` only.
    - Public surface: types `ConfigChain` / `EmbeddingChainConfig`, errors `ConfigChainValidationError` / `EmbeddingDimensionMismatchError`, accessors `getConfig` / `getEmbeddingConfig` / `resetConfig` / `isConfigOnDisk`, validation `validateBoot(chain?)`.
    - `forks/ruflo/main` `2bbb158e8` (introduce shared package; 14/14 standalone tests) + `93ae47a26` (route `@claude-flow/memory` through shared package, drop the buggy dynamic `require('@claude-flow/agentdb')`)
    - `forks/agentdb/main` `97fb022c9` (route agentdb through shared package; 249-LoC accessor → 31-LoC re-export stub preserving every in-fork import path + `src/index.ts` external surface)

    **Independent verification (refactor-verifier, task #21):**
    - VERDICT: GREEN
    - Shared package: 14/14 pass (106ms)
    - agentdb Phase 1.6 sweep: 27/27 pass (559ms)
    - agentdb full regression: 674 pass / 90 fail post-refactor — IDENTICAL to 674 pass / 90 fail pre-refactor baseline. Zero new failures. All 90 are pre-existing in auth/crypto, attention, controllers, sparsification, CausalMemoryGraph — none reference config-chain.
    - Memory typecheck (tsc --noEmit): exit 0 with shared package symlinked
    - Circular-dep audit: clean — no `require('@claude-flow/agentdb')` in memory; no `from '@claude-flow/memory'` in agentdb; shared package has zero workspace imports
    - Functional parity: 14 it() titles in shared package are verbatim ports from agentdb's original tests/unit/config-chain.test.ts

    **Callsite retired in favor of a workspace-resident shared package — NOT a name-correctness bug fix.** Earlier drafts of this ADR characterized the dynamic `require('@claude-flow/agentdb')` at `memory/src/resolve-config.ts:134` as a name-correctness bug; that framing was wrong. The require call was an instance of the deliberate optional-imports pattern documented in `forks/ruflo/v3/@claude-flow/cli/types/optional-modules.d.ts`:

    > *"Ambient declarations for OPTIONAL dependencies that tsc cannot resolve in the workspace. Each declared module is opaque (typed `any`) — these declarations exist only to satisfy tsc's module-resolution pass for our dynamic `await import('...')` and `import type {...}` sites. Runtime behavior is unchanged: imports still fail at runtime if the package is missing, and the existing try/catch guards at the call sites handle it ... workspace pins `-patch.NNN` external versions that aren't on Verdaccio, so `pnpm install` cannot fetch them."*

    Verified via runtime resolution test (2026-05-12): both `import('@claude-flow/agentdb')` AND `import('agentdb')` fail with `ERR_MODULE_NOT_FOUND` in the dev workspace — neither resolves. The codemod's Pass 1 (`@claude-flow/* → @sparkleideas/*`) rewrites the scoped form to a valid post-publish name; the unscoped rule at `scripts/codemod.mjs:41` rewrites the bare form. Both produce working production code. Both fail in dev. Both are valid forms of the documented pattern.

    What the refactor actually did: replaced one callsite of the optional-imports pattern (dynamic `require('@claude-flow/agentdb')` + try/catch guard) with a **static import** of the new `@claude-flow/config-chain` workspace package. Static import works because the new package IS a workspace member (under `v3/@claude-flow/` glob in `pnpm-workspace.yaml`), so pnpm symlinks resolve in dev and codemod rewrites for production — no optional-imports dance needed.

    **The 5 other `@claude-flow/agentdb` dynamic-import callsites in the workspace are unchanged and remain correct as-is.** They target the standalone `agentdb` fork which isn't a v3 workspace member, so the optional-imports pattern (ambient `.d.ts` declaration + dynamic import + try/catch) is the right shape for them.

    **One real anti-pattern that survived (separate concern):** several optional-import callsites use `.catch(() => null)` to swallow `ModuleNotFoundError`, then fall back to default behavior. Per `feedback-best-effort-must-rethrow-fatals.md`, this conflates "package legitimately not installed" with "package present but broken on load" — fatal errors get masked. The refactor doesn't address this; deferred as separate cleanup.

    **Three open questions deferred to first `npm run release`:** (1) `scripts/fork-version.mjs` auto-discovery of the new sub-package (glob vs hard-coded list); (2) Verdaccio bootstrap of `@sparkleideas/config-chain` first publish; (3) any pipeline gates that don't yet know about the package.]** **[Clarification 2026-05-12 per implementation finding — REVISED:** `ruflo init` writes **two separate files** via two code paths: (1) `.claude-flow/config.json` with **nested** `embedding.{provider,model,dimension,allowPaidProvider}` + `index.hnsw.{m,efConstruction,efSearch}`, written by `cli/src/init/config-template.ts` — provider hardcoded to `"onnx"`; (2) `.claude-flow/embeddings.json` with **top-level** `model`, `dimension`, `provider`, `hnsw.{M, efConstruction, efSearch}`, written by `executor.ts:1399-1476` — provider written as `"transformers.js"` and normalized to `"onnx"` inside agentdb's accessor (`config-chain.ts:170`). The agentdb accessor reads embeddings.json (primary) and falls back to config.json's nested shape. Both files coexist by accident of two different init code paths writing the same data in different shapes. The Phase 1.6 (f) acceptance test asserts BOTH files for completeness. **Cleanup follow-up:** consolidate the two write paths into one canonical write target (Open Follow-up below). References to `config.json` in the sub-steps below should be read as "the embedding config" generically.]** The Phase 1.5 commitment to "model + dimension live in the ruflo config chain, not env vars" requires concrete plumbing:
   - **(a) Init template generation.** Add to `forks/ruflo/v3/@claude-flow/cli/src/init/templates/config-template.ts` (or the equivalent init-template source per ADR-0068's pipeline) the embedding/index keys with defaults:
     ```
     embedding: { provider: "onnx", model: "Xenova/all-mpnet-base-v2", dimension: 768, allowPaidProvider: false },
     index:     { hnsw: { m: 23, efConstruction: 100, efSearch: 50 } }
     ```
     Per memory `project-config-gaps.md`, "init template generates all keys" — these become the 12th+ keys (no longer dead).
   - **(b) `ruflo init --embedding-model <name>` flag.** Extend `cli/src/commands/init.ts` to accept a model override at init time. Validate against the known-dim lookup table from `memory-initializer.ts`; reject unknown models with a typed error; set the matching `embedding.dimension` automatically. Default = `Xenova/all-mpnet-base-v2` if flag absent.
   - **(c) Config-chain reader in agentdb backends.** Add to `forks/agentdb/src/backends/rvf/RvfBackend.ts` (and `SelfLearningRvfBackend.ts`) a config-resolution step at construction: read `embedding.dimension` from the project's `.claude-flow/config.json` via the canonical config-chain accessor (per ADR-0068's `getConfig()`-shaped API). Pass dimension to `RvfDatabase.create({ dimension: ..., ... })` at table-create time. Per ADR-0175's retained dimension-lock pattern, the table-create dimension is locked for the life of the RVF segment.
   - **(d) Config-chain reader in embedding service.** Add to `forks/agentdb/src/controllers/EmbeddingService.ts` (and `EnhancedEmbeddingService.ts`) the same config-chain read: resolve `embedding.model` + `embedding.provider`; instantiate `@xenova/transformers` pipeline with the configured model; verify model output dim matches `embedding.dimension` from config (throw typed `EmbeddingDimensionMismatchError` if not — same loud-failure discipline as ADR-0175's mismatch case, retained).
   - **(e) Boot-time validation.** Add to `forks/agentdb/src/core/AgentDB.ts:initialize()` an early-exit check: if `embedding.model` is not set in config, OR if `embedding.allowPaidProvider = false` and `embedding.provider != 'onnx'`, throw a typed `ConfigChainValidationError` pointing at `ruflo init` as the fix. Matches the no-API-keys discipline + the config-chain canonical-source rule.
   - **(f) Phase 5 init validation per `project-phase5-testing.md`.** Add acceptance test in `tests/acceptance/` (or wherever fork tracks Phase 5 checks) that:
     - Runs `ruflo init` in a temp directory
     - Reads the generated `.claude-flow/config.json`
     - Asserts the 7 keys above are present with the exact default values
     - Instantiates an `AgentDB` against that config
     - Stores + retrieves a memory entry to verify the dimension round-trips
     - Drops and re-runs with `ruflo init --embedding-model Xenova/bge-base-en-v1.5` (768d) — verifies the alternative model + matching dimension lands in config AND in the RvfBackend
     - Drops and re-runs with `ruflo init --embedding-model Xenova/all-MiniLM-L6-v2` (384d) — verifies the dimension auto-adjusts to 384 and a new RVF segment is created at that dim
   - **(g) `feedback-full-model-names` enforcement.** Validate in the init flag parser that any user-supplied model name is full-qualified (`Xenova/...` prefix). Reject bare names; surface a typed error pointing at the memory. Per ADR-0069 / `feedback-full-model-names.md` — never bare names, never runtime prefix prepending.

   *Upstream baseline: 0% (upstream agentdb reads model/dim from constructor options, not from a ruflo-style project-config file; upstream doesn't have a `ruflo init` template at all). Fork effort: medium — ~200-400 LoC across 4-5 files (init template, init command flag, RvfBackend constructor, EmbeddingService constructor, boot validation, acceptance test). Self-contained; doesn't depend on Phases 2-8.*

5. **Phase 2 — RVF self-learning wiring (upstream ADR-006).** **[✅ Implemented 2026-05-12 — `forks/agentdb/main` commit `511b7d3` (one commit ahead of upstream HEAD `a478ab3`). Factory swap done; pending verification via `npm run release` acceptance + Phase 2 NDCG@10 benchmark.]** `RvfBackend.searchAsync` + `insertAsync` integrate `SonaLearningBackend`, `SemanticQueryRouter`, `RvfSolver`, `ContrastiveTrainer`, `AdaptiveIndexTuner`, `FederatedSessionManager`. Acceptance: a 100-search synthetic test with `recordFeedback` calls shows quality improvement over baseline static HNSW (target: ≥10% NDCG@10 improvement as proof-of-loop; +36% is the upstream README claim but takes longer training to demonstrate). **Audit reveals: `SelfLearningRvfBackend` wrapper exists at 487 LoC composing all 6 components correctly, but `src/backends/factory.ts:166` returns bare `RvfBackend` not the wrapper.** The fix is a one-line factory change. **Upstream-rationale audit (see Load-bearing finding #5 below):** zero TODO/FIXME/disabled comments anywhere; `grep -rn 'SelfLearningRvfBackend' src/` returns zero consumer matches; entire codebase landed in single dump commit `8b3388b`; ADR-006 line 480 specifies `learning?: boolean (default: true)`; ADR-006 status still "Proposed" since 2026-02-17. The orphan isn't a designed opt-in — it's an unfinished governance handoff waiting on ADR-006 acceptance. Fork's factory-flip executes ADR-006's own mandate. *Upstream baseline: ~70% (wrapper built, factory orphans it). Fork effort: tiny — change factory default + add the 3 missing SoTA enhancements (DPO loss, NV-Retriever false-negative filter, SCAFFOLD/K-Merge) if Phase 2 acceptance requires them, otherwise defer.*
6. **Phase 3 — Upstream ADR-007 Phase 1 capabilities** (native optimizers, full SIMD, WASM verification, RVF compression profiles, Cypher querySync, router persistence, batch ops). The Cypher patch (was ADR-0174 Phase A.5) lands here as upstream PR. *Upstream baseline: 95% per audit — Phase 1 is essentially shipped. Fork effort: light cleanup + the Cypher executor patch (~1KLoC Rust, upstream-PR-first per ADR-007 Phase 1 item #6).*
7. **Phase 4 — Upstream ADR-007 Phase 2** (kernel/eBPF embedding, model import/export, WASM in-memory store, ReasoningBank, RLM RAG). *Upstream baseline: ~35% per audit — kernel/eBPF + ReasoningBank + WasmStoreBridge stubs exist; SafeTensors / RlmController / LoraAdapter / CurriculumScheduler missing. Fork effort: substantial — building the missing pieces or accepting Phase 4 stops short of the full surface.*
8. **Phase 5 — Upstream ADR-007 Phases 3-5** (streaming graph events, hyperbolic attention, RuvLLM engine, model management, WASM memory management). *Upstream baseline: 15% / 5% / 25% (Phases 3 / 4 / 5 audited individually). Fork effort: highest — Phase 4 streaming surface is nearly absent upstream (5%); fork either invests heavily or ADR-007 Phase 5's 95%-coverage target stays aspirational.*
9. **Phase 6 — `ruvector-bridge.ts` plugin retirement decision.** The 8 `ruvector_*` MCP tools (`ruvector_search`/`_insert`/`_update`/`_delete`/`_create_index`/`_index_stats`/`_batch_search`/`_health`) either retire entirely (no fork callers) or re-point at `@ruvector/rvf` (decoupling from `pg.Pool`). Decide based on consumer audit. *Upstream baseline: n/a (this is fork plugin, not upstream agentdb). Fork effort: small.*
10. **NEW Phase 7 — Patch upstream's orphaned-wrapper bug back via PR.** **[🔻 Retired 2026-05-12 per `feedback-no-upstream-donate-backs.md`. Fork improvements stay fork-only; no PRs to ruvnet/* repos. The factory fix from Phase 2 (fork commit `511b7d3`) remains in fork-only state. Original text preserved below for traceability.]** **[Phase 2 ✅ landed in fork commit `511b7d3` on 2026-05-12; Phase 7 PR pending fork-side `npm run release` acceptance verification.]** Once Phase 2's factory fix is verified working in fork, propose the same one-line change to `ruvnet/agentdb/src/backends/factory.ts:166`. **PR rationale to cite directly (per the upstream-rationale audit in Load-bearing finding #5):** ADR-006 line 480 specifies `learning?: boolean (default: true)`; ADR-006's "Negative" + "Risks" sections enumerate construction costs and pre-mitigate them ("learning is additive, never degrades below baseline RvfBackend performance"); the one-line factory change is the literal implementation of ADR-006's stated default. Likely path-of-least-resistance: pair the PR with an ADR-006 status flip from "Proposed" to "Accepted" — the wiring change is the missing implementation step that gates acceptance. Coordinate with the Cypher executor PR (Phase 3) for maximum maintainer-relationship value. *Upstream baseline: 0% (orphan exists). Fork effort: trivial PR + advocacy.*
11. **NEW Phase 8 — ADR-009 (Causal Atlas) clarification request to upstream.** **[🔻 Retired 2026-05-12 per `feedback-no-upstream-donate-backs.md`. No issues/PRs to ruvnet/* repos. Fork treats the pre-existing `CausalMemoryGraph.ts` + `CausalRecall.ts` + `plugins/agentdb-causal/` as the de facto causal substrate regardless of upstream's placeholder file state. Original text preserved below for traceability.]** The 6-byte placeholder file is either a missing-content bug or a real-but-not-yet-written design. File an issue or PR upstream asking which. Until clarified, fork treats the pre-existing `CausalMemoryGraph.ts` + `CausalRecall.ts` + `plugins/agentdb-causal/` as the de facto causal substrate (no design lineage required since none exists). *Upstream baseline: 0% (file is a stub). Fork effort: open one upstream issue.*

## Pros and Cons of the Options

### Option A — stay with ADR-0170 + 0174 + 0175 (postgres + ruvector-postgres + retire RVF)

* Good, because preserves prior fork work and the operational unification ADR-0174 + ADR-0175 promised.
* Good, because the 143-function ruvector-postgres SQL surface (when actually used at Phase 5+) is genuinely richer than RVF's equivalents.
* Bad, because contradicts upstream ADR-006's explicit no-pgvector / RVF-only mandate.
* Bad, because user explicitly directed this ADR ("ignoring what we have done so far, its incorrect").
* Bad, because diverges from upstream's documented vision — fork-freedom posture has limits when upstream has clearly stated its direction.

### Option B — adopt upstream's RVF-first vision (chosen)

* Good, because aligns with upstream's clearly documented direction (README + ADR-006 + ADR-007).
* Good, because preserves witness chain + lineage + segment signing capabilities.
* Good, because eliminates postgres install matrix burden (no Docker image, no env var, no CREATE EXTENSION, no schema management).
* Good, because the self-learning loop becomes implementable.
* Good, because upstream ADR-007's 5-phase plan provides a ready roadmap.
* Bad, because reverses ADR-0170 + ADR-0174 + ADR-0175. Prior work has to be re-scoped.
* Bad, because loses the postgres MVCC concurrency story for multi-process scenarios. RVF lock-file coordination becomes the multi-process correctness path.
* Bad, because ruvector-postgres-only SQL surfaces (hyperbolic, GNN-in-SQL, hybrid BM25+RRF, in-DB fastembed) are not available — but most have RVF-stack equivalents via @ruvector adjacent crates.

### Option C — hybrid (RVF for memory_*; postgres for agentdb_*)

* Good, because partial alignment with upstream's RVF vision.
* Bad, because contradicts ADR-006's mandate for the agentdb_* path (vectors in postgres heap, not `.rvf` segments).
* Bad, because operationally worse than either pure option — two substrates means two backup stories, two failure modes, two install paths.

### Option D — wait for the "@ruvector PG extension that reads/writes .rvf segments" ADR-006 envisions

* Good, because in theory satisfies both postgres operability and RVF semantics.
* Bad, because this extension doesn't exist. ADR-006 names it as future work; no upstream PR proposes it; building it is a multi-month research project well outside fork's bundle-release scope.

## More Information

Original status: accepted 2026-05-28, implemented 2026-05-23, completed. This ADR references upstream sources `ruvnet/agentdb:README`, `ruvnet/agentdb:ADR-002` through `ADR-010`, and `ruvnet/RuVector:ADR-029`.

### Relationship to ADR-0068 (Unified config chain)

ADR-0068 (Implemented 2026-04-05) establishes the ruflo config chain — single source of truth for project-scoped settings written by `ruflo init` and read by every downstream consumer. This ADR's Phase 1.5 + Open Follow-up #10 make the embedding model + dimension + HNSW params first-class config-chain keys (per ADR-0102's unified embedding/index profile). No env-var override path for those keys — config chain is canonical.

### Relationship to ADR-0102 (Unified embedding/index config)

ADR-0102 defines the unified `embedding.*` + `index.hnsw.*` config-chain profile. This ADR commits the fork's RVF substrate to consume those config keys (model, dimension, m, efConstruction, efSearch) at table-create / segment-create time. The dimension lock at RVF segment creation (per ADR-0175's retained pattern) reads from `embedding.dimension` in the config chain. Model switches require `ruflo init --embedding-model <name>` and a corpus rebuild — out of scope for runtime reconfiguration.

### Relationship to ADR-0073 (RVF Storage Backend Upgrade) — restored to primary

ADR-0073 established RVF as the canonical memory_* substrate and shipped Phases 1-3 (WAL write path, Rust HNSW, native activation). ADR-0175 retired this for memory_*. **This ADR restores ADR-0073's primacy.** All ADR-0073 implementation work is now load-bearing for all axes (memory_*, agentdb_*, and the graph data within those axes), not just memory_*.

### Relationship to ADR-0086 (Layer 1 Storage Abstraction) — restored to primary

ADR-0086 defines the `IStorageContract` interface that `RvfBackend` implements. This ADR makes `RvfBackend` the **sole production implementer** for `agentdb_*` controllers (`SQLiteBackend`, `SqlJsBackend` retained as fallbacks for environments without `@ruvector/rvf`; `PostgresBackend` retained as museum code).

### Relationship to ADR-0166 (axis-separation framing)

ADR-0166's framing — pick substrates for the shape of the data, not for cross-axis unification — was applied to two axes (memory_* + agentdb_*). ADR-0174 extended to three axes (graph_*). **This ADR collapses back to two axes** following upstream's framing: `memory_*` (memory entries) and `agentdb_*` (controller state). Graph data persists within `agentdb_*` via the `@ruvector/graph-node` integration (graph-mode of upstream `db-unified.ts`). There is no separate `graph_*` axis.

### Relationship to ADR-0170 (PostgreSQL primary for `agentdb_*`)

**Superseded.** Status flips to `superseded by ADR-0177`. Phase B controller-port-to-postgres work is reverted. The pglite-default vs postgres-server tension surfaced in ADR-0175 Open Follow-up #1 becomes moot — no postgres substrate at all in fork.

### Relationship to ADR-0174 (graph_* axis introduction)

**Superseded** with two pieces salvaged:
- **ADR-0174 Phase A.5 narrow Cypher executor patch survives** — re-scoped as upstream-PR-first contribution targeting `ruvnet/RuVector`. Aligns with upstream ADR-007 Phase 1 item #6 ("Add Cypher query support via `querySync`"). Same code; different framing (upstream-aligned, not fork-divergent).
- **ADR-0174's graph-shaped data scope** (causal edges, skill edges, hierarchical relations, ADR/ODR deps as typed relations) carries forward, but persists via `@ruvector/graph-node` writing to RVF segments (or its native redb), within the existing memory_* + agentdb_* axes rather than a third graph_* axis.

ADR-0174's Phase A.6 (ruvector-postgres extension swap for agentdb_*) is **fully retired**.

### Relationship to ADR-0175 (mandate ruvector-postgres for memory_*)

**Superseded.** Memory_* returns to RVF. The `PostgresMemoryBackend` module is not built. The configurable embeddings story (OpenAI/ONNX with `embedding.allowPaidProvider` gating) survives as substrate-independent work — applies to the RVF substrate's embedding generation path equally well.

### Relationship to ADR-0176 (reconcile `/adr-index` MCP tool naming) — independent

ADR-0176 fixes MCP tool names so the skill's `allowed-tools` declarations match the registered tools. The fix is substrate-orthogonal — handlers route to whatever substrate the ADR-stack picks. ADR-0176 lands regardless of this ADR's adoption.

### Upstream sources consulted (verified 2026-05-12 against live GitHub)

| Source | Path / SHA | Stance |
|---|---|---|
| Upstream README | `ruvnet/agentdb/README.md` | "Single-file cognitive container — vectors, indexes, learning state, and a cryptographic audit trail in one `.rvf`." |
| Upstream ADR-002 | `ruvnet/agentdb/docs/adrs/ADR-002-ruvector-wasm-integration.md` | RuVector WASM complete integration (curriculum + negative mining + contrastive + FastGRNN + hyperbolic + dual-space + tensor compression + temporal hyperedges) |
| Upstream ADR-003 | `ruvnet/agentdb/docs/adrs/ADR-003-rvf-native-format-integration.md` | RVF as v3 format; replace v2's proprietary binary + `.meta.json` sidecar |
| Upstream ADR-004 | `ruvnet/agentdb/docs/adrs/ADR-004-agi-capabilities-integration.md` | AGI capabilities (4 N-API methods, AgentDBSolver wrapper, 5 CLI subcommands, witness/freeze/index-stats surfaces) |
| Upstream ADR-005 | `ruvnet/agentdb/docs/adrs/ADR-005-self-learning-pipeline-integration.md` | Created 6 self-learning components (SonaLearningBackend, AdaptiveIndexTuner, ContrastiveTrainer, SemanticQueryRouter, FederatedSessionManager, RvfSolver) — standalone, awaiting unification |
| Upstream ADR-006 | `ruvnet/agentdb/docs/adrs/ADR-006-unified-self-learning-rvf-integration.md` | Wire the 6 components into RvfBackend; **explicit no-pgvector mandate** |
| Upstream ADR-007 | `ruvnet/agentdb/docs/adrs/ADR-007-ruvector-full-capability-integration.md` | 5-phase plan: 30% → 95% @ruvector capability coverage |
| Upstream ADR-008 | `ruvnet/agentdb/docs/adrs/ADR-008-chat-ui-rvf-kernel-embedding.md` | Proposed `@agentdb/chat` package — SvelteKit + RVF kernel embedding |
| Upstream ADR-009 | `ruvnet/agentdb/docs/adrs/ADR-009-causal-atlas-rvf-runtime.md` | **6-byte placeholder file** ("i weds") — no design content; see implementation audit below |
| Upstream ADR-010 | `ruvnet/agentdb/docs/adrs/ADR-010-rvf-solver-v014-deep-integration.md` | Three-loop adaptive solver deep integration |
| RuVector ADR-029 | `ruvnet/RuVector/docs/adr/ADR-029-rvf-canonical-format.md` | RVF canonical format; `ruvector-postgres` conspicuously absent from migration table |
| Live agentdb HEAD | `a478ab3` (2026-05-12) | Verified |

### Implementation status of upstream agentdb ADRs (9-agent parallel audit, 2026-05-12)

A 9-agent audit swarm (`agentdb-adr-audit` team) source-read each ADR against `ruvnet/agentdb/src/` to determine how much of the documented design is actually shipping. Each agent ran in parallel, classified per-artifact (Not Implemented / Stub / Partial / Mostly / Full), and produced a weighted overall percent.

| ADR | Title | Declared status | Audit % | Confidence | Key finding |
|---|---|---|---|---|---|
| **ADR-002** | RuVector WASM Complete Integration | Partially Implemented | **~22%** | high | CLI scaffolding ships (`learn`/`route`/`hyperbolic`), but compute paths are JS simulations (`simulateTraining`, `simulateFastGRNN`, "Simplified InfoNCE loss simulation"). 8 of the ADR's "New Files" don't exist (`CurriculumLearner`, `NegativeMiner`, `ContrastiveLearner`, `FastGRNNRouter`, `HyperbolicSpace`, `DualSpaceSearcher`, `AdaptiveTensorStore`, `TemporalHyperedgeStore`). Phase 1, 2.2, 3.1, 3.2 checkmarks in the ADR overstate reality. |
| **ADR-003** | RVF Format Integration for AgentDB | Proposed | **~80%** | high | Core `RvfBackend` (749 LoC), factory wiring with auto-fallback, async adapter, and advanced features (progressive indexing, solver, native accelerator, SIMD, self-learning) all ship — exceeding the ADR's sketches. Gaps: `init --backend rvf` wizard (Phase 4: 0%); 7 `agentdb_rvf_*` MCP tools (Phase 6: 0%); doctor RVF checks (Phase 10: 0%); full `RvfMigrator` with detect / .bak / dry-run streaming (Phase 3: partial). Status field is stale — should be "Accepted (Substantially Implemented)". |
| **ADR-004** | AGI Capabilities Integration | Accepted | **~90%** | high | All 4 AGI N-API methods (`metric`, `indexStats`, `verifyWitness`, `freeze`), the `AgentDBSolver` wrapper (with deeper integration into `SelfLearningRvfBackend` and `AdaptiveIndexTuner` beyond ADR scope), type definitions, all 5 CLI subcommands, and the export surface are present and wired. Only gap: Phase 5 — `detector.ts` was never extended with a `checkRvf()` returning `RvfAvailability { solver: boolean }`; availability is checked ad-hoc via `AgentDBSolver.isAvailable()` instead. |
| **ADR-005** | Self-Learning Pipeline Integration | Accepted | **100%** | high | All 6 ADR-005 artifacts exist as substantial implementations in `src/backends/rvf/` totaling ~2,841 LoC with real algorithmic content: analytical gradients (ContrastiveTrainer:233-238), HNSW routing (SemanticQueryRouter), Matryoshka compression (AdaptiveIndexTuner:123), federated aggregation (FederatedSessionManager:190), three-loop solver (RvfSolver:189-190), EWC++ trajectory lifecycle (SonaLearningBackend). ADR-005's stated scope is CREATION; wiring is ADR-006's scope. |
| **ADR-006** | Unified Self-Learning RVF Integration | Proposed | **~70%** | high | **Critical finding:** `SelfLearningRvfBackend` wrapper (487 LoC) exists and correctly composes all 6 ADR-005 components on search/insert per the ADR's "wraps RvfBackend" decision. BUT the production factory at `src/backends/factory.ts:166` returns a bare `RvfBackend`, NOT the wrapper. **The self-learning loop is shipped but orphaned.** `SelfLearningRvfBackend` has zero consumers outside tests. The README's +36%-feedback-gain claim cannot be delivered in default agentdb usage today. Also: 3 ADR-006 SoTA enhancements (DPO loss, NV-Retriever false-negative filter, SCAFFOLD/K-Merge federation) are absent. **No-pgvector mandate verified upheld in code** — zero matches for `pgvector` / `pg.Pool` / `from 'pg'` / `pg-pool` / `pg-promise` / `@ruvector/postgres` in `src/`. |
| **ADR-007** | @ruvector Full Capability Integration | Phase 1 Complete (Phases 2-5 Proposed) | **~45%** | high | Per-phase: Phase 1: **95%** (native AdamW/InfoNCE, EwcManager, full SIMD surface, WASM verifiers, compression profiles, Cypher+transactions via GraphDatabaseAdapter, router persist, SONA context, batch insert, TensorCompress, FilterBuilder — essentially shipped). Phase 2: **35%** (kernel/eBPF wired, ReasoningBank present, FederatedSessionManager exists; missing: SafeTensors/ModelExporter/RlmController/queryStream/LoraAdapter/CurriculumScheduler). Phase 3: **15%** (GraphRoPeAttention, hyperbolic CLI, differentiableSearch; missing: TrainingPipeline/TrainingFactory/segment-signing/temporal-hyperedges/dataset-exporter). Phase 4: **5%** (only `benchmarkAttention` as JS fallback; missing: all streaming primitives). Phase 5: **25%** (RuvLLMEngine lazy-loaded; missing: ModelDownloader/MODEL_ALIASES/rvf_alloc/rvf_free). Overall ~45% — about halfway from 30% baseline to 95% target. |
| **ADR-008** | @agentdb/chat — Self-Contained RVF Chat UI | Proposed (Revision 4) | **0%** | high | None of the proposed `@agentdb/chat` package artifacts exist. No `packages/agentdb-chat/`, no `ChatPersistence`/`ChatInference`/`ChatServer`/`KernelBuilder` modules, no CLI bin, no SvelteKit chat-ui fork, no `ruvbot` dependency. **The README's `@agentdb/chat serve` claim is misattributed** — that line (README:223) is the opener for the "Learning + Routing (11 tools)" details table; `@agentdb/chat` appears nowhere in the README. Only prerequisite that IS live: `RvfBackend.embedKernel()` / `extractKernel()` at `src/backends/rvf/RvfBackend.ts:672, 692`. |
| **ADR-009** | Causal Atlas RVF Runtime | (no Status field) | **0%** | high | **The file is a 6-byte placeholder** containing the literal text "i weds". No frontmatter, no Status, no Date, no Decision, no enumerated artifacts. The pre-existing causal stack (`CausalMemoryGraph.ts` 875 LoC, `CausalRecall.ts` 505 LoC, `plugins/agentdb-causal/`) was imported in the same single commit (`8b3388b`) as the ADR-009 stub and cannot derive from a design that doesn't exist — it's unrelated prior work, not ADR-009 implementation. **The README/ADR ecosystem includes literal placeholder files that look like design docs but contain no design.** |
| **ADR-010** | @ruvector/rvf-solver v0.1.6 Deep Integration | Proposed | **~70%** | high | Phases 1, 2, 4 substantially complete: v0.1.6 type expansion (`SolverSkipMode`/`SolverSkipModeStats`/`SolverCompiledConfig`), `SolverCycleMetrics` v0.1.6 fields (`noiseAccuracy`/`violations`/`patternsLearned`), `SolverModeResult` v0.1.6 fields (5 new), snake→camel mappers, `runAcceptanceCheck` with `dimensionsImproved`/`zeroViolations` regression detection, and Phase 5 test coverage. **Phase 3 entirely absent** — the 4 MCP solver tools (`solver_train`/`solver_acceptance`/`solver_policy`/`solver_witness`, ~145 LoC) are not in `agentdb-mcp-server.ts`. Minor gaps: no `emitEvent('solver:violation')`; three loops run inside the WASM solver rather than orchestrated per-query in `searchAsync`. |

**Aggregate** (mean across the 8 non-stub ADRs, excluding ADR-009 placeholder): **~60%** implemented. Range 0%–100%. Median ~70%.

### Load-bearing findings for the fork's path forward

1. **ADR-005 + ADR-006 give the fork an unusually cheap win.** All 6 self-learning components exist (100% per ADR-005). The wrapper that composes them exists (70% per ADR-006). The only missing wiring is a one-line change at `src/backends/factory.ts:166` — return `SelfLearningRvfBackend` instead of bare `RvfBackend`. Fork can deliver the README's "+36% from feedback alone" claim that upstream's own deployment doesn't.

2. **ADR-007's 95% target is ~50pp away.** Phase 1 is nearly complete (95%), but Phases 2-5 are scattered (35%, 15%, 5%, 25%). The 16-week roadmap is realistic only with sustained focus; in practice it accumulates faster on high-value primitives (kernel embedding, ReasoningBank, RuvLLM routing) than on the long-tail surfaces (streaming graph events, model lifecycle, derivation chain).

3. **The no-pgvector mandate IS enforced in code, not just documentation.** ADR-006 audit verified zero matches for `pgvector` / `pg.Pool` / `from 'pg'` / `pg-pool` / `pg-promise` / `@ruvector/postgres` across `src/`. Only mentions are in comparison docs naming pgvector as competitor. This is a hard architectural commitment, not a soft preference.

4. **ADR-009 being a 6-byte stub file is a real signal about upstream documentation reliability.** When ADR-009 / ADR-008's README claim / ADR-002's "Completed" checkmarks fail under audit, the fork can't take upstream's design-doc surface at face value — must source-read every claim. This calibrates the trust model for tracking upstream over time.

5. **ADR-006's orphaned wrapper is an unfinished governance handoff, not a designed-and-justified opt-in.** **[Refined 2026-05-12 with upstream source audit.]** Source-reading `ruvnet/agentdb` for upstream rationale on why `SelfLearningRvfBackend` isn't wired into `factory.ts:166`:

    | Search | Result |
    |---|---|
    | `factory.ts` references to `SelfLearningRvfBackend` / `SelfLearningConfig` | **Zero.** No TODO, FIXME, "disabled", "opt-in", "future", or env-var-gating comment near the return statement. |
    | `grep -rn 'SelfLearningRvfBackend' src/` excluding the file itself | **Zero matches anywhere** — not in factory, not in tests, not in `index.ts` public exports, not in CLI. Built but never even surfaced as a public API. |
    | `git log src/backends/factory.ts` | Single commit `8b3388b "init: agentdb package source + marketing UI"`. Entire agentdb codebase landed as one initial dump. No subsequent commit refines the factory's return choice — no commit narrative explains the orphan. |
    | `SelfLearningRvfBackend.ts` header docstring | Plain class description, no "not yet default" caveat. |
    | ADR-006 `SelfLearningConfig` definition (line ~480 of the ADR) | **"Enable/disable self-learning (default: true)"** — the ADR explicitly designs the wrapper to be default-on. Factory.ts contradicts the ADR's own design. |
    | ADR-006 status field | **"Proposed"** since 2026-02-17. Not Accepted. |
    | ADR-006 "Negative" + "Risks" sections | Enumerate construction costs (~0.7ms latency, async factory + WASM load, memory growth, learning instability, cold start) and **pre-mitigate them** via "conservative defaults — learning is additive, never degrades below baseline RvfBackend performance." Not framed as reasons to orphan; framed as costs the ADR accepts. |

    **Plausible read:** ADR-005 (which CREATED the 6 components) is Accepted. ADR-006 (which WIRES them into RvfBackend via the wrapper) is Proposed. The wrapper code per ADR-006's design landed in the dump commit alongside everything else. The factory.ts change that would deliver ADR-006's "default: true" mandate — a one-line return-flip — was never made, presumably because ADR-006 hasn't been accepted yet. Three months elapsed (2026-02-17 → 2026-05-12) without the status flip. There is no upstream PR proposing the factory change.

    **Implication for fork Phase 2 + Phase 7:** the one-line factory fix isn't crossing a contested or considered opt-in decision — it's executing ADR-006's own specified default. Phase 7's upstream PR can cite ADR-006's `learning?: boolean (default: true)` clause directly. Hard to argue against a project's own ADR. The "compat envelope blocks upstream from making the change" framing (used in the original version of this finding) was speculation; the evidence-based read is simpler: ADR-006 hasn't been accepted, so nobody's pulled the lever.

    **Prior framing (preserved for traceability):** *"ADR-006's orphaned wrapper is the kind of bug that won't surface in upstream because nobody's deploying production agents on `npm i agentdb`. Fork's bundle-release posture would surface this immediately — and the fix is trivial. This is exactly the value upstream's compat envelope blocks: upstream can't flip the factory default to `SelfLearningRvfBackend` without breaking the dual-mode-fallback semantics their existing users depend on. Fork can."* — superseded by the evidence-based finding above. The "compat envelope" claim wasn't backed by any specific dual-mode-fallback semantic that would actually break; it was a guess at upstream's reasoning, not a finding.

### Memory entries this ADR would touch

- `project-rvf-primary.md` — return to its original framing: "RVF is primary for memory_*". Expand: "and for agentdb_* per ADR-0177; postgres is retired from substrate role across the fork."
- Retire ADR-0175's pending `reference-memory-backend-postgres.md` memory entry (was Phase 5 of ADR-0175; never created).
- New entry `reference-rvf-cognitive-container-vision.md` — document the substrate alignment + upstream sources + the Phase 0-6 confirmation list for future reference.

### Amendment 1 (2026-05-12): Phase 1.5 cascade conflation correction — SUPERSEDED

**[Superseded 2026-05-12 by Amendment 2 (dependency-hygiene reversal). The cascade-conflation analysis in this amendment is still accurate as a description of upstream's storage layering — but the decision to ACT on it (collapse cascades, retire sql.js / hnswlib-node, promote better-sqlite3) is reversed. The fork preserves upstream's dependency posture and fallback semantics wholesale. Preserved below for traceability.]**

**Bug being fixed.** The Phase 1.5 list item in Confirmation treats `sql.js` + `better-sqlite3` + `hnswlib-node` as a single "fallback cascade" to retire wholesale under "RVF or throw". Source-reading `forks/agentdb/src/core/AgentDB.ts` after the 2026-05-12 reset (now at upstream HEAD `a478ab3`) shows that framing collapsed three distinct cascades covering three different storage concerns, only one of which RVF actually replaces.

**The three cascades, separately:**

| # | Cascade | Location | What it stores | What RVF replaces |
|---|---|---|---|---|
| A | **Relational** | `forks/agentdb/src/core/AgentDB.ts:98-115` (`initializeDatabase`) | SQL tables defined in `src/schemas/schema.sql`: `episodes`, `skills`, `facts`, `events`, `notes`, `exp_nodes`, `exp_edges`, `causal_edges`, `skill_links`, `consolidated_memories`, etc. Includes all "graph"-shaped data, stored as join tables. | **Nothing.** RVF is not a SQL store. Every controller (ReflexionMemory, SkillLibrary, CausalMemoryGraph, …) calls `this.db.prepare(SQL)`. Removing SQLite breaks `loadSchemas()` and every controller. |
| B | **Vector** | `forks/agentdb/src/backends/factory.ts` (`createBackend('auto' \| 'ruvector' \| 'hnswlib')`) | Vector embeddings for similarity search (HNSW index + dense vectors) | **Everything in this cascade.** RVF is exactly the right substrate; `hnswlib-node` retires. |
| C | **Ruflo memory** | `forks/ruflo/v3/@claude-flow/memory/src/database-provider.ts` (4-tier: `'rvf' \| 'better-sqlite3' \| 'sql.js' \| 'json'`) | Memory entries with embeddings for the `memory_*` axis (separate from agentdb's controllers) | **Everything in this cascade.** RVF is the canonical `memory_*` substrate per restored ADR-0073 framing. |

Original Phase 1.5 wrote package.json deltas for cascade A as if RVF replaces SQLite there. It does not. The "single-file Cognitive Container" framing applies to cascade B (vectors) and cascade C (memory_*), not to cascade A (relational + graph-as-tables).

**Corrected package.json deltas for `forks/agentdb/package.json`:**

| Package | Upstream state | Corrected fork state | Cascade | Rationale |
|---|---|---|---|---|
| `better-sqlite3` | optionalDependencies | **`dependencies` (hard)** | A | Primary relational engine. `AgentDB.initializeDatabase()` opens this first; every controller depends on it. Promoting to hard dep matches reality + `feedback-no-fallbacks` (no silent degradation to sql.js). |
| `sql.js` | dependencies (hard) | **removed** | A | WASM fallback for restricted hosts. Fork's user base has native NAPI (per `user_machine.md`). Drop. |
| `@ruvector/rvf` | optionalDependencies | **`dependencies` (hard)** | B + C | Primary vector substrate + canonical `memory_*` substrate. |
| `@ruvector/rvf-node` | optionalDependencies | **`dependencies` (hard)** | B + C | NAPI binding; required for RVF on Node native target. |
| `hnswlib-node` | optionalDependencies | **removed** | B | Non-ruvector HNSW fallback in factory.ts auto-cascade. Retire. |
| `@xenova/transformers` | optionalDependencies | **`dependencies` (hard)** | B + C | Local ONNX embedding pipeline. Vectors come from somewhere; this is where. Per `feedback-no-api-keys`. |
| `@ruvector/rvf-wasm` | optionalDependencies | **unchanged** (optional) | B + C | Browser/edge target only; Node native path doesn't need it. |
| `@ruvector/{attention,gnn,graph-node,router,ruvllm,sona,graph-transformer}` | optionalDependencies | **unchanged** (optional) | — | Capability surfaces, not substrate. Phase 2-5 work decides which become hard. |

**Corrected cascade behaviour:**

- **Cascade A (relational, in `AgentDB.initializeDatabase`):** simplify the upstream try/catch fallback (lines 104-115) to open `better-sqlite3` directly. If the native binding is missing, throw a typed `RelationalBackendInitError` naming the install requirement. The `forceWasm` config option becomes a no-op (or a typed error). No silent fallthrough to sql.js — the cascade collapses to a single substrate.
- **Cascade B (vector, in `createBackend`):** default `vectorBackend` from `'auto'` to `'rvf'` explicitly. Drop the `'hnswlib'` branch. If `@ruvector/rvf-node` NAPI binding is unavailable, throw a typed `RvfBackendInitError`. (This matches the existing Op A pattern in pattern intelligence: *"vectorBackend 'auto' → 'rvf'"*.)
- **Cascade C (ruflo memory, in `database-provider.ts`):** collapse the 4-tier `'rvf' \| 'better-sqlite3' \| 'sql.js' \| 'json'` to **RVF or throw `MemoryBackendInitError`**. This is the cascade the original Phase 1.5 language actually described correctly; the bug was attaching its package.json deltas to agentdb instead of ruflo. The deltas land in `forks/ruflo/v3/@claude-flow/memory/package.json`, not `forks/agentdb/package.json`. Affected ruflo-memory-package deps (if pinned independently): drop `sql.js`, drop the `json` backend code path, drop `better-sqlite3` if it's a memory-package-local dep (verify at Phase 1.5 land time).

**What this means concretely for ADR-0177's headline framing.** The "single-file `.rvf` Cognitive Container" framing of upstream's README applies to **vectors and memory_* entries**, not to all of agentdb. AgentDB-as-shipped is a hybrid: SQLite for relational + graph-as-tables, RVF for vectors. That hybrid is correct as-shipped and the fork should preserve it. The orphaned `UnifiedDatabase` / `db-unified.ts` path would change this picture (graph engine for graph data, no SQLite for relational at all) — but that is a controller port project (rewrite every `db.prepare(SQL)` call to graph-native API + design a graph schema), not a Phase 1.5 dependency-hygiene change. It's deferred to a later ADR scope.

**Knock-on changes elsewhere in this ADR:**

- The "Drop the sql.js / better-sqlite3 / hnswlib-node fallback cascade" row in the deltas table (Decision Outcome → Upstream-current baseline + fork deltas) overstates the change. Corrected: **drop sql.js + hnswlib-node + retire ruflo-memory 4-tier; promote better-sqlite3 to hard dep**.
- The Consequence bullet at line 231 (Phase 1.5 eliminates three fallback substrates) is wrong about `better-sqlite3`. Corrected: Phase 1.5 eliminates **two** fallback substrates (`sql.js`, `hnswlib-node`) and **promotes three primaries** (`@ruvector/rvf`, `@ruvector/rvf-node`, `@xenova/transformers`) **plus promotes `better-sqlite3` from optional to hard** (was already de-facto primary in upstream's `AgentDB.initializeDatabase`).
- The Consequence bullet at line 233 (restricted hosts no longer supported) holds — restricted hosts that previously got sql.js are out of fork scope. The framing of "native NAPI required" gets one more dep (better-sqlite3 native build), not just RVF + ONNX.
- Open Follow-up #11 acceptance test list updates accordingly (see correction below in §"Open follow-ups").

### Amendment 2 (2026-05-12): Dependency-hygiene reversal — fork preserves upstream's fallback posture

**Decision being reversed.** Phase 1.5 (Confirmation list) + Amendment 1 (cascade-conflation correction) together specified that the fork would (a) remove `sql.js` and `hnswlib-node` from `forks/agentdb/package.json`, (b) promote `better-sqlite3` from optional to hard dep, (c) collapse the cascades in `AgentDB.initializeDatabase`, `createBackend('auto')`, and `forks/ruflo/v3/@claude-flow/memory/src/database-provider.ts` to single-substrate-or-throw, and (d) add typed `*BackendInitError` boot failures (`RelationalBackendInitError`, `RvfBackendInitError`, `MemoryBackendInitError`) for missing primaries. This is reversed.

**New decision (canonical from 2026-05-12 onward).** The fork preserves upstream agentdb's dependency posture and fallback cascade semantics **wholesale**. Specifically:

| Concern | Decision |
|---|---|
| `sql.js` in `forks/agentdb/package.json` | **Keep** as upstream-shipped HARD dependency. No removal. |
| `hnswlib-node` in `forks/agentdb/package.json` | **Keep** as upstream-shipped optionalDependency. No removal. |
| `better-sqlite3` in `forks/agentdb/package.json` | **Keep** as upstream-shipped optionalDependency. No promotion to hard. |
| `@ruvector/rvf` + `@ruvector/rvf-node` | **Keep** as upstream-shipped optionalDependencies. No promotion. |
| `@xenova/transformers` | **Keep** as upstream-shipped optionalDependency. No promotion. (Phase 1.6's embedding-config-chain wiring continues, but does NOT require dep promotion — the model + dimension keys flow through ruflo config regardless of @xenova's optional/hard status. If @xenova is unavailable at runtime, embedding initialization fails loudly via the existing upstream error path, which is acceptable under the reversal — no new fail-fast scaffolding.) |
| `AgentDB.initializeDatabase()` try/catch fallback (better-sqlite3 → sql.js) | **Keep** as-shipped. No simplification. No typed `RelationalBackendInitError`. |
| `createBackend('auto')` cascade (ruvector → hnswlib-node) | **Keep** as-shipped. No default flip to `'rvf'`. No drop of `'hnswlib'` branch. |
| `database-provider.ts` 4-tier (`'rvf' \| 'better-sqlite3' \| 'sql.js' \| 'json'`) in ruflo memory package | **Keep** as-shipped. No collapse. No `MemoryBackendInitError`. |
| Restricted-host install matrix | **Preserved.** Hosts without native NAPI continue to receive the sql.js WASM fallback row. Fork matches upstream's install matrix exactly. |

**User directive (2026-05-12, this session):** *"I am reversing the decision to remove sql.js and to fail fast. Keep it like it is in the upstream."* The reversal applies across all three cascades that Amendment 1 enumerated (relational / vector / ruflo-memory).

**Why this reverses prior reasoning.**

- The `feedback-no-fallbacks` memory is **scoped narrower** by this reversal. It still applies to (a) NEW fork-introduced fallback paths and (b) silent-catch wrappers that mask data-integrity errors per ADR-0085. It does NOT apply to upstream-shipped fallback cascades that the fork inherits. The fork does not introduce new fallbacks; it lives with the ones upstream chose.
- The "single-file Cognitive Container" headline from upstream's README remains aspirational for `@sparkleideas/agentdb` exactly as it is for `npm i agentdb`. The fork's bundle ships the same install matrix shape — RVF when available, SQLite/sql.js otherwise — and does not advertise stricter semantics than upstream delivers.
- The cascade-conflation analysis in Amendment 1 remains accurate as a description of how upstream's storage layering works (three cascades, three different concerns, RVF only replaces one). That analysis is preserved for future readers but is no longer load-bearing for any package.json change.

**What this means concretely for ADR-0177's remaining phases.**

- **Phase 1 (substrate revert in fork)** is unchanged. The Phase D / Phase A.6 / ADR-0175 revert work still lands — that's about postgres + ruvector-postgres retirement, separate from the fallback-cascade question. (Already complete in practice via the 2026-05-12 fork reset to upstream HEAD `a478ab3`.)
- **Phase 1.5 (dependency hygiene)** is **retired in full.** No package.json changes. No cascade collapses. No new typed errors. The phase number is preserved in the Confirmation list as a marker; its content is reversed by this amendment.
- **Phase 1.6 (embedding config chain through `ruflo init`)** survives but its dep-promotion clause is severed. The init template still writes `embedding.model`, `embedding.dimension`, `embedding.provider`, and `index.hnsw.*` per ADR-0068 + ADR-0102. `@xenova/transformers` remains optionalDep per upstream — the config chain drives WHICH model is requested, not whether @xenova is installable. Boot-time validation per Phase 1.6 (e) is unchanged (typed `ConfigChainValidationError` when config keys are missing); it does NOT validate @xenova availability, since that's an upstream-managed concern.
- **Phases 2–8** (self-learning factory fix, Cypher executor patch, ADR-007 Phases 2-5 tracking, ruvector-bridge retirement, orphan-fix PR back upstream, ADR-009 placeholder question) are unchanged. They never depended on Phase 1.5.

**Status of prior ADR-0177 locations referencing the reversed scope** (preserved for traceability, no longer load-bearing):

- Decision Drivers line 64 — `feedback-no-fallbacks` bullet's "Apply consistently: RVF is single-substrate" framing is narrowed to apply only to NEW fallbacks, not upstream-shipped ones.
- Decision Outcome → "Upstream-current baseline + fork deltas" table row "Drop the sql.js / better-sqlite3 / hnswlib-node fallback cascade" (line 160) — **reversed; row's content no longer applies.** Fork ships upstream's cascade unchanged.
- Decision Outcome → "Net read" paragraph (line 169) — "minus the restricted-host fallback baggage" framing is reversed; the fork inherits upstream's restricted-host coverage.
- Consequences bullet line 231 (Phase 1.5 hygiene benefits) — **reversed; bullet no longer holds.**
- Consequences bullet line 233 (Phase 1.5 makes native NAPI mandatory) — **reversed; bullet no longer holds.** Native NAPI is preferred but not mandatory; sql.js WASM path stays available.
- "Relationship to ADR-0068" (line 318) — narrows to Phase 1.6 only; Phase 1.5 no longer contributes to the config-chain commitment.
- Open Follow-up #11 — rewritten below as an upstream-parity guard (no-removal-of-fallbacks guard, not a no-fallbacks guard).

**Net effect.** Fork's `@sparkleideas/agentdb` package.json after the 2026-05-12 reset matches upstream `ruvnet/agentdb` HEAD `a478ab3` exactly on every dependency entry. Future upstream syncs to package.json land cleanly; no fork-side rebase pain on dependency posture.

### Open follow-ups before Phase 1

1. **`ruvector-bridge.ts` plugin disposition.** The 8 `ruvector_*` MCP tools in `forks/ruflo/v3/@claude-flow/plugins/src/integrations/ruvector/ruvector-bridge.ts` connect via `pg.Pool` to pgvector. Decide: (a) retire entirely if no fork callers depend on them, (b) re-point at `@ruvector/rvf` (keeping the MCP tool names stable per ADR-0174's skill-manifest-stability driver), or (c) preserve as a separate "external pgvector store" surface for users explicitly wanting it. Audit consumer count; lean (a) or (b).
2. **~~`PostgresBackend.ts` retention.~~** **[✅ Resolved 2026-05-13: museum.]** Restored from archive HEAD with explicit `@deprecated` headers calling out (a) ADR-0170 retirement, (b) no `factory.ts`/`controller-registry`/CLI wiring, (c) `pg` + `@electric-sql/pglite` not in package.json (dynamic imports throw at `initialize()` with install instructions), (d) "DO NOT wire back without a new ADR". `migrate-sqlite-to-pglite.ts` restored alongside as reference material. Both files are orphan code — zero compile impact, zero runtime impact unless deliberately wired. Preserves the future @ruvector PG extension hook (Open Follow-up #5) without re-archaeology.
3. **Concurrency hardening of `RvfBackend`.** The motivation for postgres' MVCC was multi-process write coordination. RVF's `memory.rvf.lock` file-locking handles this; verify it under acceptance-test concurrency loads (per `feedback-data-loss-zero-tolerance` — 100% pass rate required, not 99.9%). If `memory.rvf.lock` has bugs, those become Phase 1 hardening work, not substrate-change work.
4. **Self-learning loop acceptance baseline.** Define the +X% NDCG@10 target for Phase 2 verification. Upstream README claims +36% from feedback alone; pick a realistic intermediate target for the initial fork integration (e.g., +10% as proof-of-loop), with full claim verification deferred to a longer-running benchmark.
5. **ADR-006's "future @ruvector PG extension" hook.** Decide whether fork should monitor upstream for any RVF-aware postgres extension that would let agentdb_* relational state live in postgres while vectors stay in RVF. If such an extension ever ships upstream, fork can opt in without abandoning the RVF substrate decision.
6. **Skill manifest re-audit.** Per ADR-0176, the `/adr-index` skill assumes specific MCP tool names. The substrate change in this ADR is below the MCP boundary, so tool names don't change. But verify: every skill in `forks/ruflo/plugins/` that declares `agentdb_*` or `memory_*` tools still works after substrate revert. CI guard from ADR-0176 follow-up #2 covers this.
7. **Existing `.swarm/memory.rvf` + `.swarm/memory.graph` + `.swarm/memory.db` files on user machines.** These exist on developers' machines (verified on this machine 2026-05-12). RVF format is forward-compatible with itself; users keep their `.rvf` files. `.db` (sql.js) and `.graph` (graph-node redb) files become legacy — users either migrate (via `RvfMigrator`) or rebuild.
8. **Upstream PR coordination for Phase 3's Cypher executor patch.** Submit to `ruvnet/RuVector` targeting `main`. Cite upstream ADR-007 Phase 1 item #6 as motivation. Aligns this ADR's Phase 3 work with upstream's documented Phase 1. If upstream merges, fork retires the patch; if upstream sits stalled (PR #1569 and #387 cadence baseline = 17-33 days untouched), fork carries the patch as a value-add — but unlike under ADR-0174 framing, the patch is now upstream-direction-aligned, not divergent.
9. **Federation + RAFT distributed mode (scaffolding restored 2026-05-13; activation deferred).** Upstream ADR-007 Phase 5 includes distributed deployment. Single-node-first stance unchanged: no boot-time wiring, no controller-registry registration, no advertised MCP surface. **However**, per `feedback-no-value-judgements-on-features.md` (default-to-WIRE; ship the surface, let the user judge usage), the four scaffolding classes removed by the 2026-05-12 reset have been restored from snapshot `bd760f2` so the future-wiring path stays open without re-archaeology:
   - `src/controllers/QUICConnection.ts` (0-RTT, BBR, migration)
   - `src/controllers/QUICConnectionPool.ts` (pool of QUICConnection)
   - `src/controllers/QUICStreamManager.ts` (stream multiplexing over QUICConnection)
   - `src/consensus/RaftConsensus.ts` (leader election, log replication, BFT)

   Each carries its original `// TODO: ADR required before activation` marker. Zero in-tree consumers; zero compile impact (self-contained except QUICConnectionPool/StreamManager → QUICConnection internal-only). Pre-existing `QUICClient.ts` + `QUICServer.ts` remain stub-shaped and continue to not import these classes. Activation (wire to controller-registry, expose MCP tools, define cluster bootstrap) requires a future ADR.
10. **Embedding model + dimension commitment via the ruflo config chain.** Phase 1.5 promotes `@xenova/transformers` to hard dep. The exact model + dimension + HNSW parameters live in the **ruflo config chain** (per ADR-0068 unified config chain + ADR-0102 unified embedding/index config) — **not** in env vars and **not** in per-call config. The flow:
    - `ruflo init` runs at project creation and writes the embedding + index keys into `.claude-flow/config.json` (or the equivalent project-scoped config file). Per memory `project-config-gaps.md`: "init template generates all keys; sarsa bug fixed; all 11 dead keys wired".
    - **Default keys** (written by init unless explicitly overridden):
      - `embedding.model = "Xenova/all-mpnet-base-v2"` (full-qualified name per `feedback-full-model-names.md` — never bare, never runtime-prepended; ADR-0069 / `reference-embedding-model`)
      - `embedding.dimension = 768`
      - `embedding.provider = "onnx"` (local; paid provider requires `embedding.allowPaidProvider = true` per `feedback-no-api-keys`)
      - `index.hnsw.m = 23`
      - `index.hnsw.efConstruction = 100`
      - `index.hnsw.efSearch = 50`
    - All consumers (agentdb controllers, RvfBackend, MCP tools, `/adr-index`, `/odr-index`) read from this config chain. Single source of truth.
    - **Phase 5 init validation** (per memory `project-phase5-testing.md`) — acceptance check confirms every default round-trips through the config chain from `ruflo init` write through to controller read.
    - Switching the model later requires `ruflo init --force` (or equivalent) to rewrite config + re-embed all stored vectors + re-create RVF segments. Out of scope for an ADR-0177 commit; document the migration shape in a separate ADR if/when the default changes.
    - Alternative models considered (callable via `ruflo init --embedding-model <name>` flag): `Xenova/all-MiniLM-L6-v2` (384d, smaller / faster / less recall), `Xenova/all-MiniLM-L12-v2` (384d), `Xenova/bge-base-en-v1.5` (768d), `Xenova/gte-base` (768d). Known-dim lookup table referenced in `memory-initializer.ts` matches `reference-embedding-model.md`.
    - **NO env-var override path** for model or dimension. Per the no-fallbacks discipline + config-chain single-source-of-truth principle, env vars that silently shadow project config are exactly the kind of out-of-band reconfiguration the config chain replaces. If a user needs a different model, they re-run `ruflo init --embedding-model <name>` and accept the corpus-rebuild cost.
11. **Upstream-parity CI guard for dependency posture.** **[Rewritten 2026-05-12 per Amendment 2 — replaces the prior "no-fallback CI guard" which is reversed.]** Add an acceptance test that asserts the fork's `forks/agentdb/package.json` matches upstream `ruvnet/agentdb` HEAD on the storage-cascade dependency entries:

    **Resolvability (matches upstream install matrix):**
    - `require.resolve('sql.js')` **succeeds** (upstream hard dep — preserved)
    - `require.resolve('better-sqlite3')` succeeds when native build toolchain available (upstream optionalDep — preserved)
    - `require.resolve('hnswlib-node')` succeeds when build available (upstream optionalDep — preserved)
    - `require.resolve('@ruvector/rvf')` succeeds when ruvector binding available (upstream optionalDep — preserved)
    - `require.resolve('@ruvector/rvf-node')` succeeds when native NAPI binding available (upstream optionalDep — preserved)
    - `require.resolve('@xenova/transformers')` succeeds when ONNX runtime available (upstream optionalDep — preserved)

    **Cascade behaviour (matches upstream fallback semantics):**
    - `AgentDB.initializeDatabase()` opens `better-sqlite3` when available; falls back to `sql.js` WASM otherwise; no typed `RelationalBackendInitError` thrown (matches upstream try/catch at AgentDB.ts:104-115)
    - `createBackend('auto')` selects RuVector when `@ruvector/rvf-node` is installed; falls back to `hnswlib-node` otherwise; no typed `RvfBackendInitError` thrown when fallbacks succeed
    - `database-provider.ts` in `forks/ruflo/v3/@claude-flow/memory/` retains the 4-tier `'rvf' \| 'better-sqlite3' \| 'sql.js' \| 'json'` selection; no `MemoryBackendInitError` for missing RVF when downstream tiers succeed

    **Drift-detection (per-package version + dependencyType parity):**
    - For each key in upstream's `dependencies` + `optionalDependencies`, fork's same-key entry must have the SAME dependency-type bucket. Detects accidental drift if a future fork-side change demotes/promotes a dep relative to upstream.

    Prevents regression where a future fork-side decision re-introduces the dep-removal or fail-fast pattern without an ADR update. Matches the discipline pattern from ADR-0176 follow-up #2 (skill-manifest ↔ MCP-registry guard) — same shape (CI gate on artifact parity), different target (package.json instead of MCP tool registry).

12. **Consolidate the dual `config.json` + `embeddings.json` write paths.** **[Added 2026-05-12 per Phase 1.6 implementation finding.]** `ruflo init` currently writes the embedding config to **two files in two shapes** via two code paths:

    - `cli/src/init/config-template.ts` writes `.claude-flow/config.json` with nested `embedding.{provider,model,dimension,allowPaidProvider}` + `index.hnsw.{m,efConstruction,efSearch}`. Provider hardcoded `"onnx"`. (Sibling commit `c4b36ca57`.)
    - `cli/src/init/executor.ts:1399-1476` writes `.claude-flow/embeddings.json` with top-level `model`, `dimension`, `provider: "transformers.js"`, `hnsw.{M, efConstruction, efSearch}`. Pre-existing legacy code path.

    Both files are read by the agentdb accessor (`forks/agentdb/src/core/config-chain.ts`); `embeddings.json` is primary, `config.json` is fallback. The Phase 1.6 (f) acceptance test asserts both files for completeness.

    **Decision needed:**

    a) **Keep both files** (current state). Accept the redundancy; document it as deliberate dual-write for resilience. CI guard asserts both stay in sync.

    b) **Consolidate to `embeddings.json` only** — retire the new `config-template.ts` keys, remove `config.json` nested-shape support from the accessor. Simplest target shape; matches the agentdb accessor's primary path. Requires updating cli-init-template's sibling tests (the integration tests assert `config.json` nested shape).

    c) **Consolidate to `config.json` only** — retire the legacy `executor.ts:1399-1476` `embeddings.json` write, switch accessor to read config.json's nested shape as primary. Matches the new init template's contract; aligns with ADR-0068's "ruflo config chain" framing where `config.json` is the canonical project-scoped file.

    Lean: (c) — config.json's nested shape is the design ADR-0068 anticipated, and the new init template plus its tests already commit to that shape. `embeddings.json` retirement frees the filename for a different concern (e.g., learned embedding model state per ADR-007 Phase 1's router-persist pattern). Out of scope for Phase 1.6; revisit in a dedicated follow-up ADR or scoped cleanup pass.

13. **ADR-060 proof-gated mutation layer (scaffolding restored 2026-05-13; activation deferred).** **[Added 2026-05-13 to correct an earlier mis-categorization.]** The 2026-05-12 reset removed `src/security/MutationGuard.ts`, `src/security/AttestationLog.ts`, `src/security/index.ts` (barrel), and `src/backends/ruvector/GuardedVectorBackend.ts`. The original survey wrongly grouped these with the distributed-mode (QUIC/Raft) deferral; they are in fact ADR-060 single-node proof-gating with zero references to Raft / QUIC / consensus / cluster anywhere in the source. Real dependencies are `./validation.js` + `./input-validation.js` (both already in main) + optional WASM via `@ruvnet/ruvector-verified-wasm`.

    The fork's only post-`bd760f2` change to these files was commit `06aaf9e` ("port AttestationLog to postgres") — exactly the postgres dialect work this ADR retires. Restoring from snapshot `bd760f2` (sqlite-shaped originals) is therefore directly substrate-compatible; archive HEAD versions would not compile after the postgres deletion.

    Per `feedback-no-value-judgements-on-features.md` (default-to-WIRE), the four files have been restored to preserve the proof-gated-mutation surface as future-wiring optionality. Single-node-multi-agent isolation (per-write `agentId` / `namespace` / `scope` attestation) is exactly the kind of capability the fork already cares about. Activation (have `factory.ts:createGuardedBackend()` return `GuardedVectorBackend` instead of bare `RvfBackend`; expose attestation MCP tools) requires a future ADR.

### Amendment: Status reconciliation (2026-05-18) — partial implementation; substrate decision in force

Status kept `proposed` per the 2026-05-18 ADR status audit.

**Substrate decision in force (the load-bearing part that landed):**

ADR-0177's RVF-primary substrate posture IS the active substrate
contract:

- `agentdb_*` routes through the archivist substrate seam (ADR-0180 /
  ADR-0181), NOT postgres/pglite. ADR-0180 §Architecture explicitly
  cites ADR-0177 as the substrate referent ("RVF-primary per ADR-0177
  for vector + content stores").
- The permanent SQLite carve-out roster (5 controllers per ADR-0166:
  CausalMemoryGraph, CausalRecall, NightlyLearner, LearningSystem
  aggregations, ReasoningBank GROUP-BY) runs on better-sqlite3 / sql.js
  per ADR-0177's substrate table.
- ADR-0170 (postgres primary), ADR-0174 (graph_* axis), ADR-0175
  (ruvector-postgres for memory_*) all carry `superseded-by: ADR-0177`
  in frontmatter.
- Amendment 2 (dependency-hygiene reversal) landed wholesale: fork
  preserves upstream agentdb's `package.json` posture, no fail-fast
  scaffolding, no cascade collapse.
- Phase 1.6 (embedding config chain through `ruflo init`) marked ✅
  complete inline.
- Phase 2 (RVF self-learning factory swap, fork commit `511b7d3`)
  marked ✅ implemented; verification deferred.
- `PostgresBackend` + `migrate-sqlite-to-pglite` restored as museum
  pieces (Open Follow-up #2 ✅ resolved 2026-05-13).
- Four QUIC/Raft + four security scaffolding files restored from
  `bd760f2` per Open Follow-ups #9, #13.

ADR-0177 is **load-bearing for ADR-0180, ADR-0181, ADR-0184** as the
substrate referent. Those downstream ADRs would not have closed
coherently without ADR-0177's decision in force.

**Open follow-ups (13 items, named by their §Open follow-ups section
numbering):**

1. `ruvector-bridge.ts` plugin disposition (retire / re-point / keep).
2. ~~`PostgresBackend.ts` retention~~ ✅ resolved 2026-05-13.
3. Concurrency hardening of `RvfBackend` under acceptance-test loads.
4. Self-learning loop acceptance baseline (+X% NDCG@10 target).
5. ADR-006's "future @ruvector PG extension" hook monitoring.
6. Skill manifest re-audit (CI guard from ADR-0176 follow-up #2).
7. Existing `.swarm/memory.{rvf,graph,db}` migration on user machines.
8. Upstream PR coordination for Phase 3 Cypher executor patch.
9. Federation + RAFT distributed mode (restored 2026-05-13; activation
   gated on future ADR).
10. Phase 4 (upstream ADR-007 Phase 2) kernel/eBPF / ReasoningBank /
    RLM scaffolding — partial; SafeTensors / RlmController /
    LoraAdapter / CurriculumScheduler missing.
11. Phase 5 (upstream ADR-007 Phases 3-5) streaming / hyperbolic /
    RuvLLM — minimal upstream coverage (5-25%); fork investment
    decision deferred.
12. Dual `config.json` + `embeddings.json` write-path consolidation
    (Phase 1.6 follow-up).
13. ADR-060 proof-gated mutation activation (scaffolding restored
    2026-05-13; `factory.ts:createGuardedBackend()` swap + attestation
    MCP tools require a future ADR).

Reconciled as part of the 2026-05-18 status audit.

## Amendment 2026-05-23 — Re-convergence achievement (closes the fork-freedom posture gap)

ADR-0230 (substrate re-convergence with upstream ADR-125) executed
2026-05-23 lands all 7 phases of upstream ADR-125 on fork main:

| Phase | Upstream SHA | Fork SHA | Disposition |
|---|---|---|---|
| 1 (MemoryService rename) | `4e9a33ce2` | `402786f16` | TAKE |
| 2 (HybridBackend wire) | `11eaef851` | `fe682324b` | ADAPT |
| 3 (HNSW snapshot/restore) | `81a2b23eb` | `7fefa0c3e` | TAKE |
| 4 (MemoryConsolidator) | `850450f38` | `a68817f6b` | ADAPT |
| 5 (FTS5 fallback) | `8773fcffd` | `7f3e15334` | TAKE |
| 6 (benchmarks) | `ed95d6782` | `f1ccba609` | TAKE (via Batch S) |
| 7 (RuVector cleanup) | `7dd4b5252` | `ebcbba949` | TAKE (via Batch S) |

The RVF-first vision this ADR adopted has now extended through three
upstream-substrate bug fixes the fork previously forked around (HNSW
persistence stubs, embedder-availability gap, ruvector.db leak). The
"fork-freedom posture" of ADR-0170/0174/0175 (postgres + ruvector-
postgres substrate, superseded by this ADR) is now closed-out cleanly:
fork's substrate axis (below MCP) re-converges with upstream while
the Archivist axis (above MCP, fork-original) remains. ADR-0230
§Architectural invariants #1-5 record the orthogonality contract.

The fork retains a narrow set of internal-plumbing carve-outs per
ADR-0177's spirit (`hnsw-lite.ts` kept as a separate module, top-level
public surface still excludes `HnswLite`, `RvfBackend`, `HybridBackend`,
etc.). These are surface preservation, not vision divergence.
