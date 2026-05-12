---
status: superseded
date: 2026-05-10
tags: [agentdb, ruvector, sqlite, sqlite-vec, axis-separation, option-f, persistence, dialectical-council]
supersedes: []
superseded-by: [ADR-0170]
depends-on: [ADR-0056, ADR-0067, ADR-0069, ADR-0073, ADR-0154, ADR-0165, ADR-0167]
implements: []
---

# AgentDB persistence — axis-separated dual-storage with Option F

> **Status**: accepted (2026-05-11), **partially superseded by ADR-0170 (2026-05-11)**. Phase 1 + 1.5 + 2 + Phase 3 (Option F)
> foundation + Phase 3 per-controller wiring for 5 of 9 augmented controllers
> shipped across patches 44–48 on Verdaccio. Amendment 2026-05-11f is the binding
> final record FOR THE SQLITE PATH.
>
> **ADR-0170 (2026-05-11) supersedes this ADR's substrate decision for the `agentdb_*` axis**:
> PostgreSQL (pglite embedded, postgres server) replaces SQLite. The Option F vec0 mirror
> work shipped in patches 46-48 is superseded — Phase 3 is no longer extended to remaining
> controllers (ExplainableRecall, QUICServer). The Phase 1 + 1.5 + 2 correctness fixes
> (`vectorBackend` field wire, dead `graphBackend` removal, `vectorIndex`/`primaryStorage`
> split) survive on any substrate. The axis-separation framing (memory_* RVF, agentdb_* SQL)
> survives — only the SQL identity changes from SQLite to PostgreSQL. See ADR-0170 for
> the substrate-replacement plan and rationale.

## Implementation status (2026-05-11)

| Phase | Status | Where it shipped |
|---|---|---|
| Phase 1 — wire `vectorBackend` field | **accepted** | `agentdb@3.0.0-alpha.14-patch.44`, commit `3e99d50` on `forks/agentdb` main; validated by `tests/adr0166-vectorbackend-wired.test.ts` and the 674/674 acceptance suite (p2 run) |
| Phase 1.5 — delete dead `graphBackend` | **accepted** | Same commit; agentic-flow caller update at commit `9364e84`; ruflo comment refresh at `8905716f4` |
| Phase 2 — split into `vectorIndex` + `primaryStorage` (Option E) | **accepted** | `agentdb@patch.45`, commits `544db88` + `5e26500` (warning dedup); ruflo adapter at `57dccac91` + `bad35b123` (type fix); validated by `tests/adr0166-phase2-vectorindex-split.test.ts` |
| Phase 3 (Option F) — sqlite-vec foundation | **accepted** | `agentdb@patch.46`, commit `845112a` (extension loader, vec0 virtual tables, defang removal at `agentdb-mcp-server.ts:247`); validated by `tests/adr0166-phase3-optionf-virtual-tables.test.ts` |
| Phase 3 (Option F) — HierarchicalMemory wiring | **accepted** | `agentdb@patch.46`, commit `bd760f2`; mirror INSERT/DELETE into `hmem_vec`; validated 674/674 in p3 acceptance run |
| Phase 3 (Option F) — ReflexionMemory + SkillLibrary + ReasoningBank | **accepted** | `agentdb@patch.47`–`patch.48`, commits `30a8120` (wiring) + `5865a91` (aux-id type fix). The aux-id fix replaced `+id INTEGER` with `+id TEXT` and stringifies numeric ids — `+id INTEGER` rejected JS Number bindings under better-sqlite3 with "auxiliary column id has type INTEGER, but FLOAT was provided" (surfaced in p4 acceptance) |
| Phase 3 (Option F) — LearningSystem wiring | **accepted** | `agentdb@patch.48`, commit `9791701`; mirror into `learning_vec` (GROUP BY aggregations stay on relational table per PERMANENT_SQLITE_CARVE_OUT); validated 674/674 in p5 acceptance run |
| Phase 3 (Option F) — ExplainableRecall + QUICServer | **deferred** | `recall_vec` virtual table is created; ExplainableRecall's `recall_certificates` is metadata-only at the controller level (no embedding column to mirror without re-architecting the chunk-retrieval pipeline). QUICServer has minimal vector ops per the ADR. Both can be wired in a follow-up if a concrete need emerges |
| Phase 3 (Option F) — MemoryConsolidation | **implicit accepted** | Consolidation creates semantic memories via `hierarchicalMemory.store(...)` which already flows through the HierarchicalMemory Option F mirror; the `consolidated_vec` virtual table is provisioned but unused at the controller level |
| Phase 3 (Option F) — SyncCoordinator | **N/A** | No vector ops per the ADR |
| Parallel track — ADR-007 Phase 1 capability adoption | **mostly wired (~5/9 audited as already in fork)** | A 2026-05-11 audit found 4 items already wired (EWC++, SIMD activations, RVF compression profiles, router save/load) and 1 partially wired (SONA — module imported but `addTrajectoryContext` not called in recall paths). Real remaining gaps: RLM controller, native ruvllm.ReasoningBank fast path, adaptive `ef_search` via SolverBandit, SONA recall-path enrichment, vec0 mirror batching. Each ~20–200 LoC, tracked in ADR-0094 |

Five of nine augmented controllers are actively wired (HierarchicalMemory,
ReflexionMemory, SkillLibrary, ReasoningBank, LearningSystem). The two
deferred (ExplainableRecall, QUICServer) and one N/A (SyncCoordinator) have
their vec0 virtual tables created idempotently at boot but are not yet
populated by controller writes. The dedicated Phase 3 contract test at
`tests/adr0166-phase3-controller-wiring.test.ts` asserts wired-controller
mirroring; degraded-mode contract is in
`tests/adr0166-phase3-optionf-virtual-tables.test.ts`.

## Context and Problem Statement

AgentDB's `db-unified.ts:5` docstring claims *"PRIMARY: RuVector GraphDatabase"* but `core/AgentDB.ts:117-128` hard-wires `better-sqlite3` (with `sql.js` WASM fallback). The `vectorBackend` config field at `core/AgentDB.ts:49` is dead — `core/AgentDB.ts:175` calls `createGuardedBackend('auto', ...)` with the literal string and never reads `this.config.vectorBackend`. ADR-0165's audit surfaced the discrepancy as part of the post-ADR-0162 regression cluster.

This three-way dual-storage pattern is unintentionally entrenched: the SDK boot path uses pure SQLite; the standalone MCP server (`agentdb-mcp-server.ts:243-247`) imports `UnifiedDatabase` then defangs it via `unified.getSQLiteDatabase() ?? unified`; only the 17 simulation scenarios under `simulation/scenarios/*.ts` actually exercise UnifiedDatabase as RuVector-primary. Nine+ ruflo call sites pass `vectorBackend` expecting it to do something.

The question this ADR settles: **what should the vision be for agentdb/ruvector storage and retrieval — substrate replacement (RuVector primary), permanent dual surface, or composition?** The eight ruvnet upstream ADRs (RuVector ADR-029 + agentdb ADR-002 through ADR-010 + ruflo ADR-028) collectively describe RuVector as the intelligence substrate; the question is whether that mandates substrate replacement for AgentDB's relational controllers, or composition via virtual tables.

## Decision Drivers

* **Architectural honesty.** The dead `vectorBackend` config field, aspirational `db-unified.ts:5` docstring, and half-completed `agentdb-mcp-server.ts:247` defang create diagnostic blind spots that have already cost dialectical investigation cycles (ADR-0165 audit; this ADR's 8-persona council).
* **`feedback-no-fallbacks`** (silent fallbacks unacceptable) and **`feedback-data-loss-zero-tolerance`** (100% durability or not shippable) constrain any substrate flip until ADR-0167 Phase 2 cross-process N=8 durability lands on the `.rvf` axis.
* **`feedback-no-value-judgements-on-features`** ("wire all upstream capability") biases toward composition over substrate replacement — wire what upstream shipped without conflating substrate question with capability question.
* **`feedback-no-upstream-donate-backs`** prevents driving upstream; we can only consume what upstream has shipped. Upstream agentic-flow ADR-007 Phases 2-5 have been "Proposed" 12+ weeks with zero substantive commits.
* **`project-rvf-primary`** carve-out for AgentDB SQL-DDL controllers is permanent — relational semantics (FK CASCADE, WITH RECURSIVE, GROUP BY HAVING, multi-record ACID, FTS) cannot be hosted by RuVector's K-V + property-graph substrate without a category-level rebuild.

## Considered Options

* **Option A** — Wire `UnifiedDatabase` into `AgentDB.initialize()` as primary persistence. Substrate flip; RuVector primary; SQLite removed; existing `.db` files migrated via upstream agentdb ADR-003's `agentdb migrate --to rvf` tool.
* **Option B** — Update `db-unified.ts:5` docstring only. No-cost interim documenting the dual-storage pattern; removes the diagnostic blind spot without changing runtime behavior.
* **Option C** — Hybrid: SQLite primary + parallel RuVector index mirror. Already approximates the status quo — controllers already receive a separate `controllerVB` (vector backend) that routes to RuVector under `'auto'`.
* **Option D** — Decommission `agentdb_*` MCP tools; consolidate their functionality into `memory_*` (RVF-backed). Controllers become thin wrappers over `memory_*` operations.
* **Option E** — Split the overloaded `vectorBackend` config into orthogonal `vectorIndex` + `primaryStorage` fields. Honest separation of vector-search axis from primary-persistence axis; backward-compatible.
* **Option F** — `sqlite-vec` virtual tables embed RuVector HNSW inside SQLite, in-place. Composition via virtual table; no substrate flip; honors ADR-029's "MUST use RVF for vector data" via the embedded ANN engine.

## Decision Outcome

Chosen: **Option B as Phase 1, Option E as Phase 2, Option F as Phase 3, axis-separated permanently**, with Option A retired and Option D rejected. Option C is the existing status quo and folds into Option F's composition stance.

Rationale: Option F satisfies ADR-029's vector-data mandate without forcing relational controllers off SQL — the only substrate that can host their WITH RECURSIVE + GROUP BY + FK CASCADE semantics today. Phase 1 closes the diagnostic blind spot; Phase 2 introduces backward-compat opt-in; Phase 3 lands per-controller virtual-table augmentation incrementally. The 8-persona dialectic council (Amendment 2026-05-11f) converged unanimously on this combination.

The vision is **axis-separated permanent dual-storage with Option F**:

```
                     AgentDB persistence
                    /                    \
              memory_* axis            agentdb_* axis
           (RuVector primary)        (SQLite primary)
                  |                         |
          .swarm/memory.rvf          .swarm/memory.db
          (RvfBackend, RVF)          (better-sqlite3 / sql.js)
          — already shipped per          |
            ADR-0073 Phases 1-3 —    Option F augmentation:
                                    CREATE VIRTUAL TABLE <controller>_vec
                                       USING vec0(embedding float[768])
                                    (sqlite-vec embeds RuVector HNSW
                                     inside SQLite, in-place;
                                     zero migration, zero new formats)
```

Five controllers are **PERMANENT_SQLITE_CARVE_OUT** — architecturally relational, do not migrate:

| Controller | Why permanent SQLite |
|---|---|
| `CausalMemoryGraph` | WITH RECURSIVE 5-hop causal chain traversal |
| `CausalRecall` | SQL JOIN + ORDER BY rerank over causal_edges |
| `NightlyLearner` | Cross-product self-JOIN + GROUP BY + HAVING |
| `LearningSystem` aggregations | GROUP BY state/session/date for RL telemetry |
| `ReasoningBank` GROUP BY queries | GROUP BY task_type aggregations |

The `agentdb-mcp-server.ts:247` defang (`unified.getSQLiteDatabase() ?? unified`) is documented as **permanent intentional posture**, not unfinished migration. The `db-unified.ts:5` "PRIMARY: RuVector" docstring applies to the `memory_*` axis only.

### Why this combination — six findings from the 8-persona dialectic

Full transcript in §"Amendments" Amendment 2026-05-11f. Load-bearing findings:

1. **REDB-quadruplication**: `@ruvector/graph-node` 2.0.3-patch.52 is **redb-backed**, NOT RVF-backed (`forks/ruvector/crates/ruvector-graph/Cargo.toml:20`, `storage.rs:21-31`). Option A's substrate flip would add a fourth on-disk format (SQLite + `.rvf` + `.meta` + `.redb`) — opposite of consolidation; violates ADR-029's own goal.
2. **Upstream cadence is NULL**: standalone `ruvnet/agentdb` has zero substantive technical commits since init 2026-05-06; agentic-flow vendored copy has NO defang (the defang is fork-only via ADR-0056). The fork is AHEAD of upstream on RuVector-primary, not waiting for it.
3. **5 of 14 controllers are PERMANENT_SQLITE_CARVE_OUT**: WITH RECURSIVE causal chains, multi-table joins, GROUP BY aggregations have no Cypher equivalent in `@ruvector/graph-node`'s alpha binding. They don't migrate, period.
4. **Zero user-facing capability fails today**: the only candidate Phase 3 user-benefit (substring-collision bug in `CausalMemoryGraph.getCausalChain`) was retracted by Controllers in Round 3. Phase 3 has no engineering motive.
5. **Migration tool already exists upstream**: agentic-flow ADR-003 specifies `agentdb migrate --to rvf` with 7-step pipeline. Building it fork-side duplicates upstream work; under Option F no migration is needed at all.
6. **ADR-029's "MUST use RVF" applies to vector data**: ADR-029 names agentdb's baseline as *"Custom HNSW + JSON"* not SQLite; its target is *"RVF with RVText profile"* for vector data, not relational replacement. **Option F satisfies ADR-029** by embedding RuVector HNSW (via sqlite-vec virtual table) — the vector data IS in RVF-equivalent form, accessible through the SQL planner.

```
                     AgentDB persistence
                    /                    \
              memory_* axis            agentdb_* axis
           (RuVector primary)        (SQLite primary)
                  |                         |
          .swarm/memory.rvf          .swarm/memory.db
          (RvfBackend, RVF)          (better-sqlite3 / sql.js)
          — already shipped per          |
            ADR-0073 Phases 1-3 —    Option F augmentation:
                                    CREATE VIRTUAL TABLE <controller>_vec
                                       USING vec0(embedding float[768])
                                    (sqlite-vec embeds RuVector HNSW
                                     inside SQLite, in-place;
                                     zero migration, zero new formats)
```

**Five controllers are PERMANENT_SQLITE_CARVE_OUT** — architecturally relational, do not migrate:

| Controller | Why permanent SQLite |
|---|---|
| `CausalMemoryGraph` | WITH RECURSIVE 5-hop causal chain traversal |
| `CausalRecall` | SQL JOIN + ORDER BY rerank over causal_edges |
| `NightlyLearner` | Cross-product self-JOIN + GROUP BY + HAVING |
| `LearningSystem` aggregations | GROUP BY state/session/date for RL telemetry |
| `ReasoningBank` GROUP BY queries | GROUP BY task_type aggregations |

**Permanent posture, not transitional**: the `agentdb-mcp-server.ts:247` defang (`unified.getSQLiteDatabase() ?? unified`) is documented as intentional. The `db-unified.ts:5` "PRIMARY: RuVector" docstring applies to the `memory_*` axis only.

**Honors upstream lineage**: ADR-029's "MUST use RVF for vector data" is satisfied via Option F's virtual table embedding RuVector HNSW. ADR-007's "wire all upstream capability" is satisfied via the parallel-track ADR-007 Phase 1 capability adoption.

Each phase below is independently shippable. Phase 1 + 1.5 are immediate; Phase 2 ships after Phase 1 bakes one release cycle; Phase 3 (Option F) ships incrementally per controller after Phase 2; the parallel track ships independently of all phases.

### Phase 1 — wire dead `vectorBackend` config field (immediate, ~50 LoC)

**Problem**: `forks/agentdb/src/core/AgentDB.ts:175` calls `createGuardedBackend('auto', ...)` with the literal string `'auto'`. The `this.config.vectorBackend` value is read NOWHERE in `initialize()`. Setting `vectorBackend: 'hnswlib'` in `AgentDBConfig` has no effect today. Nine+ ruflo call sites pass this field expecting it to do something.

**Files to edit**:

| File | Change |
|---|---|
| `forks/agentdb/src/core/AgentDB.ts:175` | `createGuardedBackend('auto', { ... })` → `createGuardedBackend(this.config.vectorBackend ?? 'auto', { ... })` |
| `forks/agentdb/src/db-unified.ts:5` | Reframe docstring: *"PRIMARY: RuVector GraphDatabase"* → specify it applies to `memory_*` axis only; document axis-separation; cite Amendment 2026-05-11f |
| `forks/agentdb/README.md` | Add "Persistence architecture" section: explain axis-separation; note `agentdb_*` is SQLite-primary with Option F augmentation; note `memory_*` is RuVector-primary via RVF; link `project-rvf-primary.md` memory entry |

**Test to add** at `forks/agentdb/tests/adr0166-vectorbackend-wired.test.ts`:

```ts
test('vectorBackend config field is respected after Phase 1 wire', async () => {
  const db = new AgentDB({ vectorBackend: 'ruvector' });
  await db.initialize();
  expect(db.vectorBackendName).toMatch(/ruvector/);  // Phase 1 — passes
  // expect((db as any).db.constructor.name).not.toBe('Database');  // Phase 3 (Option F) — keep commented until Phase 3 lands
});
```

**Exit criteria**: (a) field wired and respected at the call site; (b) docstring + README reflect axis-separation; (c) test exists and passes the first assertion.

**Rollback**: trivial revert; no data migration. Promotes to `accepted` for Phase 1.

### Phase 1.5 — delete dead `graphBackend` parameter (immediate, after Phase 1)

`HierarchicalMemory` and `MemoryConsolidation` constructors accept a `graphBackend` parameter that is never used (Retrieval Specialist's Phase 4 quick win).

**Files to edit**:

| File | Change |
|---|---|
| `forks/agentdb/src/controllers/HierarchicalMemory.ts:157` | Remove unused `graphBackend` parameter from constructor; update call sites in `core/AgentDB.ts` controller-construction block |
| `forks/agentdb/src/controllers/MemoryConsolidation.ts:107` | Same |

Independent of all other phases; can ship anytime. Catches a shipped bug at low cost.

### Phase 2 — split `vectorBackend` into `vectorIndex` + `primaryStorage` (Option E, after Phase 1 bakes)

Currently `vectorBackend?: 'auto' | 'ruvector' | 'hnswlib'` overloads two orthogonal concerns: vector-search engine choice AND primary persistence backend. Split into two fields.

**Files to edit**:

| File | Change |
|---|---|
| `forks/agentdb/src/core/AgentDB.ts:49` (AgentDBConfig type) | Add `vectorIndex?: 'sqlite-vec' \| 'hnswlib' \| 'auto'` (default `'auto'`). Add `primaryStorage?: 'sqlite'` (only valid value under Option F; default `'sqlite'`). Mark `vectorBackend?` as deprecated alias (JSDoc `@deprecated`) |
| `core/AgentDB.ts:initialize()` | If legacy `vectorBackend` is set, mirror to `vectorIndex` and emit deprecation warning to stderr. If `primaryStorage === 'ruvector'` is attempted on a legacy `.db` file, throw a loud error per `feedback-no-fallbacks` ("primary storage incompatible with existing database file") |
| `forks/ruflo/v3/@claude-flow/memory/src/agentdb-backend.ts` (lines 92, 124, 303) | Accept both `vectorIndex` and `primaryStorage`; forward to AgentDB. Default `primaryStorage: 'sqlite'` preserves existing behavior |

**Tests to add**: regression test for `primaryStorage: 'sqlite'` (default behavior unchanged); new test for the loud-error case.

**Exit criteria**: (a) deprecation warning observed in acceptance log when legacy `vectorBackend` is set; (b) backward-compat verified across ruflo call sites; (c) loud-error test passes.

**Rollback**: deprecation alias preserves previous behavior. Promotes to `accepted` for Phase 2.

### Phase 3 — Option F: sqlite-vec virtual tables per controller (after Phase 2)

For each non-PERMANENT_SQLITE_CARVE_OUT controller using vector ops, augment its schema with a sqlite-vec virtual table:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS <controller>_vec USING vec0(
  embedding float[768]
);
```

**Controllers to augment (9 of 14)**:

| Bucket | Controller | Vector op served by Option F virtual table |
|---|---|---|
| TRIVIAL | HierarchicalMemory | k-NN over `embedding` column |
| TRIVIAL | MemoryConsolidation | k-NN over consolidated entries |
| TRIVIAL | SyncCoordinator | (no vector ops; no augmentation needed) |
| MODERATE | ReflexionMemory | `episode_vec` virtual table joined to `episodes` |
| MODERATE | SkillLibrary | `skill_vec` virtual table |
| MODERATE | ReasoningBank | `pattern_vec` (NB: GROUP BY queries stay SQLite) |
| MODERATE | ExplainableRecall | `recall_vec` |
| MODERATE | LearningSystem | `learning_vec` (NB: GROUP BY aggregations stay SQLite) |
| MODERATE | QUICServer | (vector ops minimal; evaluate per controller) |

**Controllers UNCHANGED (the 5 PERMANENT_SQLITE_CARVE_OUT)**: `CausalMemoryGraph`, `CausalRecall`, `NightlyLearner`, `LearningSystem` aggregations, `ReasoningBank` GROUP BY queries.

**Files to edit**:

| File | Change |
|---|---|
| `forks/agentdb/src/mcp/agentdb-mcp-server.ts:243-247` | Remove the `unified.getSQLiteDatabase() ?? unified` defang. Replace with direct SQLite open + `db.loadExtension('sqlite-vec')` (or equivalent) at boot |
| `forks/agentdb/src/schemas/schema.sql` | Add `CREATE VIRTUAL TABLE` statements for each augmented controller (9 statements) |
| Per-controller files (~3-6 LoC each) | Update INSERT/SELECT/UPDATE statements to use the virtual table where appropriate |
| Browser/WASM substrate | Feature-detect sqlite-vec at boot via `loadExtension` availability; if unavailable, gracefully degrade to JS-side cosine compute (matches `controllers/HNSWIndex.ts:34-54` pattern). **Loud error message at boot, not silent runtime fallback** (per `feedback-no-fallbacks`) |

**Extension package decision** (open question, sequenced):

| Option | Trade-off | Sequencing |
|---|---|---|
| **sqlite-vec** (existing OSS package) | Ship-fast; loses RuVector's measured AVX2/AVX512/NEON SIMD profile + ADR-0068 m=23/efC=100/efS=50 tuning + 5-level TensorCompress quantization | Phase 3 entry |
| **`@sparkleideas/ruvector-sqlite-vec-node`** (substrate-side build) | Preserves RuVector HNSW capability profile; ~200-500 LoC binding work + 5-platform npm CI | Later substrate work, replaces sqlite-vec when ready |

Per Storage Architect's Phase 4 Commitment A: start with sqlite-vec for Phase 3 entry, replace with `@sparkleideas/ruvector-sqlite-vec-node` later.

**Exit criteria**: (a) all 9 augmented controllers' acceptance tests pass; (b) defang at line 247 removed; (c) browser/WASM degradation path tested; (d) Phase 1 contract test's commented assertion (`db.constructor.name !== 'Database'`) re-enabled and passes when `primaryStorage` opts in.

**Rollback**: per-controller; each `CREATE VIRTUAL TABLE` is independently revertable. Promotes to `accepted` for Phase 3 (and the ADR as a whole moves to `accepted` if not already).

### Parallel track — ADR-007 Phase 1 capability adoption (independent, immediate)

Per `feedback-no-value-judgements-on-features` ("wire all upstream capability"), upstream agentdb ADR-007 Phase 1 capabilities should ship independently of any phase above. **No substrate-flip dependency.** Phase 1 of upstream ADR-007 is already complete substrate-side; the work is fork-side wiring.

**Upstream context (the original 9-item list).** Upstream `ruvnet/agentic-flow/packages/agentdb` declares 11 `@ruvector/*` packages as dependencies and ADR-007 §"Gap Analysis" reports adoption depth of ~30% on average (rvf ~45%, attention ~15%, ruvllm ~10%, graph-node ~15%, router ~30%, sona ~30%). Phase 1 enumerates 11 capability wirings to raise that. Upstream marks Phase 1 as **Complete** (2026-02-17) — the @ruvector substrates ship working APIs and most of the consumer-side wiring landed there.

**Fork audit (2026-05-11).** A bench-audit against `forks/agentdb/src/` shows the picture is much narrower than ADR-007's full list suggests — most of Phase 1 already rode in via past forks/upstream merges:

| ADR-007 Phase 1 item | Fork state | Pointer |
|---|---|---|
| Native optimizers + EWC++ | **wired** | `backends/rvf/NativeAccelerator.ts:461` (`loadEwcManager` lazy-imports `@ruvector/ruvllm.EwcManager`) |
| Full SIMD activation functions | **wired** | `backends/rvf/NativeAccelerator.ts:104-120` (matvec/softmax/relu/gelu) + `:388` import of `@ruvector/ruvllm.SimdOps` |
| RVF compression profiles | **wired** | `backends/rvf/RvfBackend.ts:54` — `compression?: 'none' \| 'scalar' \| 'product'` config field exists |
| `@ruvector/router` save/load | **wired** | `backends/rvf/NativeAccelerator.ts:431-433` (`router.SemanticRouter.load(p)`) + `backends/rvf/SemanticQueryRouter.ts:129` |
| SONA context enrichment | **partial** | `SonaTrajectoryService` is imported at module scope in `core/AgentDB.ts`; `backends/rvf/SonaLearningBackend.ts` exists. Gap is narrow: `HierarchicalMemory.recall()` and `ReflexionMemory.search()` don't call `addTrajectoryContext(...)` to enrich results |
| RLM controller for RAG | **missing** | Zero references to `RlmController` in `forks/agentdb/src/`. New `getController('rlm')` + thin facade needed |
| Batch operations | **partial** | `BatchOperations` exists as a lazy `getController('batchOperations')` singleton, but Option F vec0 mirror INSERTs (Phase 3 above) are still per-row. Gap: batch the mirror writes + adopt `@ruvector/core.insertBatch` where applicable |
| ReasoningBank native fast path | **missing** | Zero references to `@ruvector/ruvllm.ReasoningBank` in the fork. The TS `ReasoningBank` controller is the only path; native Float64Array-optimized variant should sit behind a lazy-import fast path |
| Adaptive `ef_search` via Thompson Sampling | **partial** | `SolverBandit` exists at `backends/rvf/SolverBandit.ts` and is wired into `AdaptiveIndexTuner.ts` for temporal-compression decisions — **not** into search-time efSearch. Gap: consult the bandit at `RuVectorBackend.search` / `HNSWLibBackend.search` / `RvfBackend.search` with a query-quality reward |

**Real remaining wiring** (~3-5 small workstreams, not 9):

- RLM controller for RAG (`@ruvector/ruvllm.RlmController`) — ~100-200 LoC, brand-new facade
- ReasoningBank native fast path (`@ruvector/ruvllm.ReasoningBank`) — ~80-150 LoC, lazy-import + try/catch
- Adaptive `ef_search` via `@ruvector/rvf-solver` — ~80-150 LoC across 3 search call sites
- SONA `addTrajectoryContext` in recall paths — ~20-40 LoC across 2 call sites once enrichment shape is decided
- Batch the Option F vec0 mirror INSERTs (perf optimization, not a missing capability) — ~50-150 LoC

Each wiring lands as a separate small commit; track in ADR-0094 (living acceptance-coverage tracker).

### Note: postgres backend is additive, not a substrate flip

Upstream's optimized timeline (`ruvnet/agentic-flow/docs/ruvector-ecosystem/OPTIMIZED_MASTER_TIMELINE.md`) introduces `@ruvector/postgres-cli@0.2.6` as **an additional VectorBackend** alongside SQLite/RVF/HNSWLib, targeting an enterprise persistence tier (~10x faster than SQLite for that profile). This is the same pluggable-backend axis ADR-0166 already accommodates — not a substrate flip away from SQLite or RVF. The fork's "SQLite primary on the `agentdb_*` axis" stance is consistent with upstream's direction; postgres-cli would simply become a fourth `VectorBackend` selector value when it stabilizes.

### Out of scope

1. **Reimplementing upstream agentic-flow ADR-003's `agentdb migrate --to rvf` tool** — under Option F no migration is needed; if the substrate question ever reopens, use upstream's tool, don't build a fork-side duplicate.
2. **Migrating `@ruvector/graph-node` from redb to RVF** — upstream-coordination problem we cannot drive per `feedback-no-upstream-donate-backs`.
3. **The `memory_*` axis** — RuVector primary via RVF is already shipped per ADR-0073; ADR-0167/0168 cross-process write coordination work continues independently for this axis.
4. **Permanent SQL→Cypher controller rewrites** — explicitly rejected for the 5 PERMANENT_SQLITE_CARVE_OUT controllers; their relational semantics are load-bearing.
5. **Acceptance-coverage tracking** — handled by ADR-0094 living tracker; each phase + parallel-track capability wires its own acceptance entries there.

### Consequences

* Good, because the dead `vectorBackend` config field becomes load-bearing after Phase 1 (one-line wire fix).
* Good, because the `memory_*` axis remains untouched and ADR-0073's RVF substrate continues working unchanged.
* Good, because no migration is needed for the `agentdb_*` axis — existing `.swarm/memory.db` files continue to boot unchanged.
* Good, because the SQLite ergonomic surface (`sqlite3` REPL, Datasette, DuckDB, dbt, pandas) is preserved; downstream BI/analytics workflows survive.
* Good, because per-database `primaryStorage: 'sqlite'` default (Phase 2) preserves backward compat across all 9+ ruflo call sites.
* Good, because Option F honors ADR-029's "MUST use RVF for vector data" via the sqlite-vec virtual table embedding RuVector HNSW.
* Good, because parallel-track ADR-007 Phase 1 capability adoption ships `@ruvector/*` capabilities (router, sona, ruvllm, rvf-solver) independently of any substrate decision.
* Bad, because the standalone MCP server's `agentdb-mcp-server.ts:247` defang is reclassified as permanent intentional posture rather than fixed — a permanent half-step that some readers may find confusing.
* Bad, because `@ruvector/graph-node`'s Cypher capabilities (variable-length paths, WHERE evaluator, multi-record ACID, FTS) remain unavailable to AgentDB controllers — the capability gap is permanent, not "deferred until a future phase".
* Bad, because if upstream ever ships RuVector-primary as the agentdb default, this ADR's permanent-dual-storage stance becomes a fork divergence that must be revisited via a new ADR.
* Neutral, because the `db-unified.ts:5` "PRIMARY: RuVector" docstring now applies only to the `memory_*` axis — readers must internalise the axis-separation framing to read the codebase correctly.
* Neutral, because the choice between sqlite-vec (ship-fast) and `@sparkleideas/ruvector-sqlite-vec-node` (preserves RuVector HNSW capability profile) for the Option F extension is sequenced, not decided here.

### Confirmation

Compliance is verified by:

1. **Phase 1 contract test** at `forks/agentdb/tests/adr0166-vectorbackend-wired.test.ts` asserting `db.vectorBackendName.includes('ruvector')` after `new AgentDB({ vectorBackend: 'ruvector' }).initialize()`. Passes after Phase 1 wire; documents the contract.
2. **`adr-review` lint** — typed-relation frontmatter integrity (intra-corpus `supersedes:` / `implements:`; cross-corpus-allowed `depends-on:`).
3. **Acceptance suite under `npm run release`** — Option F per-controller virtual-table augmentations land incrementally; each gets its own acceptance check tracked in ADR-0094 (living acceptance-coverage tracker).
4. **No future ADR opens `enableGraph: true` on `core/AgentDB.ts:67-69` as agentdb default** — gated by reviewer convention; if a future ADR proposes flipping that flag as the agentdb default, it MUST be a NEW ADR (not a resumption of ADR-0166) per Reopen triggers in §"More Information" below.

## More Information

### Reopen triggers

ADR-0166 closes once Phase 1 + 1.5 + 2 + 3 (Option F) all land. The substrate question reopens via a **NEW ADR (not a resumption of ADR-0166)** when one of:

1. **Upstream removes the `agentdb-mcp-server.ts:247` defang** in `ruvnet/agentdb` standalone — would signal upstream chose to incur the engineering work we declined.
2. **`@ruvector/graph-node` ships Cypher WHERE evaluator + variable-length paths + multi-record ACID + FTS at Tier 1 NAPI maturity** — would close the binding gaps that motivate Option F.
3. **A concrete user-facing capability emerges that Option F cannot host** — currently zero such cases identified.

### Local ADRs (`docs/adr/`)

| ADR | Title | Status | Role for ADR-0166 |
|---|---|---|---|
| **0056** | MCP Server Unified Backend — RVF Primary, SQLite Fallback | Implemented (2026-03-22) | Contemporary production validation of UnifiedDatabase wiring; the `agentdb-mcp-server.ts:247` defang is reclassified by Amendment 2026-05-11f as permanent intentional posture |
| **0067** | Original Vision — Controller Wiring | Closed | 4-layer architecture; controller-wiring decisions preserved verbatim under Option F |
| **0069** | Future Vision — F1/F2/F3 (AgentDBService consolidation, RVF storage, AttentionService) | Implemented | F2 applies to `memory_*` only; F1/F3 still relevant via parallel-track |
| **0073** | RVF Storage Backend Upgrade — WAL Write Path, Rust HNSW, Native Activation | Phases 1-3 Implemented (2026-04-06) | Canonical `memory_*` implementation; no agentdb-side companion needed under Option F |
| **0154** | RVF storage unification — single-file, `.meta` removal | Implemented + Validated | `memory_*` axis single-file architecture |
| **0160** | Track upstream agentdb extraction as 5th fork | Superseded by 0161 | Historical |
| **0161** | Consolidate agentdb onto 5th fork; vendored copy deleted | Accepted (2026-05-08, commit `b9167b8`) | Single agentdb source tree |
| **0162** | Upstream fork sync, May 2026 (288 commits) | Accepted | Timeline context for the post-sync regression cluster |
| **0163** | RVF concurrent-writer data-loss investigation | Accepted/closed 2026-05-10 (fix `7deff1027`) | Parallel investigation to ADR-0165 |
| **0164** | Close ADR-0154 deferred follow-ups | Accepted | Phase B closure |
| **0165** | AgentDB backend-resolution audit + residual cluster | Accepted/closed 2026-05-10 (674/674 PASS) | Surfaced this ADR's architectural gap |
| **0167** | Cross-process RVF write coordination | Accepted (Phase 1 at `forks/ruvector @ f4cbbf45e`) | `memory_*` axis only |
| **0168** | Rust NAPI library coordinator (Phase 2 of 0167) | Accepted | `memory_*` axis only |

### Upstream ADRs (`ruvnet/*`)

| Path | Title | Status | Role for ADR-0166 |
|---|---|---|---|
| `ruvnet/RuVector/docs/adr/ADR-029-rvf-canonical-format.md` | RVF as Canonical Binary Format | **Accepted** (2026-02-13) | Format-level mandate; honored on `agentdb_*` axis via Option F sqlite-vec virtual table embedding RuVector HNSW |
| `ruvnet/agentic-flow/packages/agentdb/docs/adrs/ADR-002` | RuVector WASM Complete Integration | Partially Implemented | Capability roadmap; parallel-track |
| `ruvnet/agentic-flow/packages/agentdb/docs/adrs/ADR-003` | RVF Format Integration for AgentDB | Proposed | Specifies `agentdb migrate --to rvf` CLI; under Option F no migration needed |
| `ruvnet/agentic-flow/packages/agentdb/docs/adrs/ADR-004` | AGI Capabilities Integration | Accepted (2026-02-17) | Wired via parallel-track |
| `ruvnet/agentic-flow/packages/agentdb/docs/adrs/ADR-005` | Self-Learning Pipeline Integration | Accepted (2026-02-17) | Wired via parallel-track |
| `ruvnet/agentic-flow/packages/agentdb/docs/adrs/ADR-006` | Unified Self-Learning RVF Integration | Proposed | — |
| `ruvnet/agentic-flow/packages/agentdb/docs/adrs/ADR-007` | `@ruvector` Full Capability Integration | Phase 1 Complete (2026-02-17); Phases 2-5 Proposed | Capability-roadmap; Phases 2-5 frozen 12+ weeks; **parallel-track Phase 1 capability adoption ships fork-side ASAP** |
| `ruvnet/agentic-flow/packages/agentdb/docs/adrs/ADR-008` | `@agentdb/chat` self-contained RVF Chat UI | Proposed | — |
| `ruvnet/agentic-flow/packages/agentdb/docs/adrs/ADR-010` | `@ruvector/rvf-solver v0.1.6` Deep Integration | Proposed | Wired via parallel-track (adaptive ef_search) |
| `ruvnet/ruflo/v3/implementation/adrs/ADR-028-neural-attention-mechanisms.md` | Neural Attention Mechanisms (39-mechanism design) | Proposed (2026-01-16) | Cited by local ADR-0069 F3 |

### Architecture doc

- `/Users/henrik/source/ruflo-patch/docs/architecture/controller-wiring-vision.md` (2026-04-05) — fork-side blueprint synthesizing upstream + fork vision

### Project-memory entries

| Entry | Relevance |
|---|---|
| `project-rvf-primary` | Axis-separated rule per Amendment 2026-05-11f (`memory_*` RVF, `agentdb_*` SQLite-with-Option-F) |
| `project-agentdb-parallel-extraction` | Migration complete per ADR-0161 |
| `project-adr0154-true-scope` | META_SEG implementation reality |
| `feedback-no-fallbacks` | Loud-failure for silent-fallback paths (load-bearing for Phase 1.5 + Phase 2 + Phase 3) |
| `feedback-data-loss-zero-tolerance` | Blocks any substrate flip without 100% durability (one reason Phase 3 retired) |
| `feedback-no-value-judgements-on-features` | Wire all upstream capability — justifies parallel-track |
| `feedback-no-upstream-donate-backs` | Don't drive upstream — explains why we can't make ADR-007 Phases 2-5 ship |
| `feedback-agent-dialectic-via-sendmessage` | Methodology used for the 8-persona council that produced this decision |

### Source citations (live in current code)

- `forks/agentdb/src/db-unified.ts:5` — the docstring being reframed
- `forks/agentdb/src/db-unified.ts:37-307` — `UnifiedDatabase` class (271 lines, fully implemented; exercised by 17 simulations + standalone MCP server + integration test; not exercised by SDK init path)
- `forks/agentdb/src/core/AgentDB.ts:117-128` — SQLite hard-wire in `initialize()`
- `forks/agentdb/src/core/AgentDB.ts:49` — `vectorBackend?` config field type union (currently dead)
- `forks/agentdb/src/core/AgentDB.ts:175` — call site to be edited in Phase 1
- `forks/agentdb/src/backends/factory.ts:381-383` — factory `createGuardedBackend` signature
- `forks/agentdb/src/backends/graph/GraphDatabaseAdapter.ts:293` — admits Cypher WHERE evaluator incomplete
- `forks/agentdb/src/mcp/agentdb-mcp-server.ts:243-247` — UnifiedDatabase usage + defang
- `forks/agentdb/src/schemas/schema.sql` + `schemas/frontier-schema.sql` — controller DDL (≥19 tables across 14 SQL-using controllers)
- `forks/ruvector/crates/ruvector-graph/Cargo.toml:20` + `storage.rs:21-31` — `@ruvector/graph-node`'s redb backend (basis for REDB-quadruplication finding)
- `forks/ruflo/v3/@claude-flow/memory/src/agentdb-backend.ts` (lines 92, 124, 303) — ruflo adapter forwarding `vectorBackend`
- `forks/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts:561` — sets `vectorBackend: 'ruvector'` literal (dead today; activates after Phase 1)

### Decision-trail methodology

The 8-persona dialectic council that produced this decision (queen + devil + storage + retrieval + controllers + ruvector + migration + upstream) used Claude Code's Agent Teams `SendMessage` primitives for peer-to-peer engagement on team `adr0166-vision-council`. The methodology is documented in memory `feedback-agent-dialectic-via-sendmessage.md`. Six chronological amendments preserve the journey verbatim in §"Amendments" below; **Amendment 2026-05-11f is the binding final record**.

<!-- Original investigation (Context, Drivers, Options, Decision Outcome, Triggers, Out-of-scope, Open Questions, More-information, Recommendation as authored 2026-05-10) was previously appendix-preserved here; deleted 2026-05-11g during MADR-conformance restructure. The journey is fully preserved in §"Amendments" below — Amendments 2026-05-11 / b / c / d / e / f record every refinement of the original text. -->

## Amendments

The 6 amendments below are the chronological audit trail. The canonical decision and implementation plan are in §"Decision Outcome" above; this trail records the journey, the dialectical engagement, and the evidence base. Amendment 2026-05-11f is the final, authoritative record. Earlier amendments are partially superseded but preserved verbatim for evidence and reproducibility.

### Amendment 2026-05-11 — Five citation/factual corrections + dead-config-field finding

Source-verification pass against `forks/agentdb/src/db-unified.ts` and `forks/agentdb/src/core/AgentDB.ts` produced five corrections to the Context section. Provisional posture (Option B) is unchanged; status remains discussion. Corrections 2 and 4 shift the cost/benefit math materially; Correction 3 retires Open Question #2.

**Correction 1 — `vectorBackend: 'rvf'` does not exist** (Context line 31; "Memory entries with implications" line 115).

The actual config type at `forks/agentdb/src/core/AgentDB.ts:49` is `'auto' | 'ruvector' | 'hnswlib'`. The factory's `BackendType` at `forks/agentdb/src/backends/factory.ts:381-383` matches. Drop `'rvf'` from the union and from the "Op A: vectorBackend 'auto' → 'rvf'" pointer. The `'rvf'` mode lives on the `memory_*` RvfBackend axis, not on AgentDB's vectorBackend axis.

**Correction 2 — `vectorBackend` is a dead config field, not "vector-axis-only"** (Context line 31, line 38).

`forks/agentdb/src/core/AgentDB.ts:175` calls `createGuardedBackend('auto', { ... })` with the literal string `'auto'`. The `this.config.vectorBackend` value is read **nowhere** in `initialize()`. Setting `vectorBackend: 'hnswlib'` in `AgentDBConfig` therefore has no effect today — the field exists in the type but is unwired. This makes the architectural gap **larger** than the original Context described:

- Aspirational: "PRIMARY: RuVector GraphDatabase" (`db-unified.ts:5`)
- Original ADR claim: "vectorBackend selects the vector-search axis only"
- Actual delivered: vectorBackend selects nothing; SQLite is hard-wired and the vector backend is hard-wired to `'auto'`, which then performs its own runtime detection inside `createBackend`.

This expands Option B to **B+**: docstring update at `db-unified.ts:5` plus either (a) wiring `this.config.vectorBackend ?? 'auto'` into the `createGuardedBackend` call, or (b) removing `vectorBackend?` from `AgentDBConfig` and documenting that runtime detection is the sole resolver.

**Correction 3 — "never imported by AgentDB core" is overstated** (Context line 31).

`UnifiedDatabase` IS imported, by 17 files under `forks/agentdb/simulation/scenarios/*.ts` (e.g. `consciousness-explorer.ts:14`, `causal-reasoning.ts:7`, `multi-agent-swarm.ts:7`). The original phrasing is correct for the production AgentDB initialization path but reads as "dead code" in context. Reword to: *"never imported by the production AgentDB initialization path; only by simulation scenarios under `simulation/scenarios/`."*

This collaterally answers Open Question #2 (*"Was UnifiedDatabase ever functional?"*): yes — actively exercised by 17 simulations including migration, query routing, and mode getters. Remove OQ #2.

**Correction 4 — `db-unified.ts:37-141` understates the class span** (Context line 31; Option A bullet line 54).

Actual class span is `db-unified.ts:37-307` (271 lines). Lines 37–141 cover only the constructor, `initialize()`, and `initializeMode()`. The rest of the class includes the full SQLite→Graph migration (162-260), mode getters (262-281), `query()` routing (286-294), and `close()` (299-306). Update the citation to `:37-307`.

This refutes Option A's scope-estimate clause *"likely needs implementation work since it's been uncalled"* — the class is functionally complete and exercised by 17 simulations. Option A's true scope is closer to **wiring + adapter translation**, not new implementation; revise the `~500-1500 LoC` estimate downward (the migration and query-routing surface already exists).

**Correction 5 — `d6ccca63a` lives in `forks/ruflo`, not `forks/agentdb`** (Decision Drivers line 46).

`git log` confirms `d6ccca63a` on `forks/ruflo` main: *"fix(memory-router): make AgentDB controller-registry init fatal (ADR-0165)"*. The fix touched `forks/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts`, which is ruflo's wrapper around AgentDB — **not** AgentDB core itself. Reword the parenthetical to: *"the silent-fallback in ruflo's AgentDB adapter (which ADR-0165 fixed at `forks/ruflo @ d6ccca63a`)"*. AgentDB core itself was not patched by ADR-0165.

**Completeness gap noted but deferred** — The agentic-flow vendored copy of agentdb (per ADR-0160 parallel-extraction context) was not audited. If the two copies diverge on the SQLite hard-wire or dead-config-field pathology, Options A/B/D need to specify which copy receives the change. Captured here as a known unknown; deferred to whichever option fires first.

**Net effect on outcome**: Correction 2 strengthens the case for Option B by adding the dead-field cleanup to the no-cost interim. Correction 4 weakens the case for Option A's scope conservatism. Provisional posture (adopt Option B as no-cost interim, defer A/C/D) remains correct; the recommended Option B work now expands to **B+** — docstring update + `vectorBackend` field decision (wire or remove) + project-memory entry.

### Amendment 2026-05-11b — Full-ADR audit (4-agent read-only swarm)

A 4-agent swarm (claim verifier, cross-ADR consistency auditor, full-ADR architecture critic, memory/rule consistency auditor) audited the ENTIRE ADR — every section, not just Amendment 1. This amendment records the substantive findings; status remains discussion. Together with Amendment 1, this supersedes the original Context, Decision Drivers (specifically #1 and #4), Considered Options C/D, Triggers 3 and 5, and Open Questions 1–3. Correction 3 in Amendment 1 also receives a follow-up correction.

#### A. Driver #1 framing INVERTED — supersedes Amendment 1's silence

ADR-0166 line 45 reads: *"ADR-0163's prior council misdiagnosed t3-2-concurrent because session memory `project-adr0154-true-scope.md` claimed `write_meta_seg` was `#[allow(dead_code)]` when it wasn't."* This inverts the actual narrative.

Verbatim memory text (`project-adr0154-true-scope.md`): *"`write_meta_seg` is `#[allow(dead_code)]` from its introduction in `3bb6c438` (2026-02-14, the original Feb-14 mega-drop) — zero callers ever, zero TODOs, zero recent commits."* The memory is **correct**, not inverted.

Verbatim ADR-0163 §"Investigation log" (line 99 + 119): the council's Concurrency Expert misdiagnosed by *"[relying] on the literal text of the original ADR-0154 Decision section ('META_SEG is canonical') rather than the Implementation log + delivered-reality reconciliation appended on 2026-05-07"*. The misdiagnosis was caused by **ignoring** `project-adr0154-true-scope.md`, not by trusting an incorrect claim in it.

Reword line 45 to: *"ADR-0163's prior council Concurrency Expert misdiagnosed t3-2-concurrent by relying on ADR-0154's original Decision text ('META_SEG is canonical') rather than session memory `project-adr0154-true-scope.md`'s correction that `write_meta_seg` is `#[allow(dead_code)]` and never called. The session memory was correct; the misdiagnosis came from disregarding it."* The same diagnostic-blind-spot risk that motivates this Driver still applies (stale-aspiration vs delivered-reality), but the analogy mechanism is "correct memory ignored", not "wrong memory believed".

#### B. Amendment 1 Correction 3 needs follow-up — UnifiedDatabase IS in production

Amendment 1 Correction 3 reworded the original "never imported by AgentDB core" to *"never imported by the production AgentDB initialization path; only by simulation scenarios under `simulation/scenarios/`."* This is also wrong.

`forks/agentdb/src/mcp/agentdb-mcp-server.ts:243-247` actively imports and uses `UnifiedDatabase` in the **standalone MCP server boot path** (a production path):

```ts
const { createUnifiedDatabase } = await import('../db-unified.js');
const unified = await createUnifiedDatabase(dbPath, embeddingService, { dimensions: embCfg.dimension });
db = unified.getSQLiteDatabase() ?? unified;
console.error('✅ Unified database backend loaded (RVF + SQLite)');
```

The server log message is itself part of the aspirational/delivered gap — line 247 immediately calls `unified.getSQLiteDatabase() ?? unified`, **defanging UnifiedDatabase by extracting only the SQLite handle** (or falling back to the unified object as opaque). RuVector graph mode is reachable but unused even in this branch. The standalone MCP server is invoked via `forks/agentdb/src/cli/agentdb-cli.ts:2137` (`mcpServerPath = '../mcp/agentdb-mcp-server.js'`) — production CLI surface.

Plus `tests/cli-mcp-integration.test.ts:110, 204, 224, 392` imports `UnifiedDatabase` directly. So the full picture: 17 simulation scenarios + 1 standalone production MCP server + 1 integration test, AND it remains uninvoked by the SDK-side `core/AgentDB.ts:initialize()` consumed by ruflo. Reword Correction 3 to: *"`UnifiedDatabase` is imported by 17 simulation scenarios, the standalone agentdb MCP server boot path (`src/mcp/agentdb-mcp-server.ts:243`, which then defangs it by extracting only the SQLite handle), and the cli-mcp integration test. It is NOT imported by the SDK-side `core/AgentDB.ts:initialize()` path that ruflo consumes via `@sparkleideas/agentdb`."*

This re-corrects the architectural framing in two ways:
1. The "PRIMARY: RuVector" docstring is being **partially honored** by one production boot path (the standalone MCP server) and **fully ignored** by the SDK boot path. The dual-storage pattern is therefore THREE-way, not two-way: SDK→pure SQLite, standalone MCP server→UnifiedDatabase-but-extract-SQLite, simulation→UnifiedDatabase-pure-RuVector.
2. This invalidates Open Question #2's surface ("was UnifiedDatabase ever functional?") even more strongly than Amendment 1 noted — UnifiedDatabase has been in active production use; the question is why the SDK path doesn't use it.

#### C. Cross-ADR drift — multiple §"Related ADRs" + §"Decision Drivers" entries are stale

Cross-ADR auditor read each cited ADR. Findings:

1. **ADR-0160 superseded by 0161** (per ADR-0161 line 17: *"this ADR supersedes ADR-0160's 'observation-only' framing with the actual migration"*). ADR-0166's More-information line 117 (*"ADR-0160 — AgentDB extraction is parallel, not migratory (architectural framing)"*) and Trigger 5 (*"agentdb fork's parallel maintenance (per ADR-0160) closes the gap upstream"*) both reference 0160 as if active. Reword: *"ADR-0160 (superseded by 0161) — the parallel-extraction framing has been replaced by 0161's consolidation onto the 5th fork."*

2. **ADR-0163 and ADR-0165 are NOT sister ADRs.** ADR-0166 line 121 says *"t3-2-concurrent regression (closed; sister ADR is ADR-0165)"*. Per ADR-0163's amendment 2026-05-10d: *"ADR-0163: CLOSED. Root cause identified, real fix landed at `7deff1027`."* — that's vectorless-recovery, distinct from ADR-0165's mechanisms. ADR-0165 covers the residual 12-failure cluster (B1 silent-fallback at `d6ccca63a`, B2 embeddings.json clobbering at `5dac592e9`). They're parallel investigations of a 14-failure cluster split into orthogonal root causes, not sister ADRs of the same issue. Reword line 120-121: *"ADR-0163 — t3-2-concurrent regression (closed by vectorless-recovery fix at `7deff1027`); ADR-0165 — residual 12-failure cluster from the same post-ADR-0162 investigation."*

3. **ADR-0165 is closed, not pending verification.** ADR-0166 line 122 says *"pending verification; surfaced this gap"*. Per ADR-0165 amendment 2026-05-10b: 674/674 PASS, status accepted. Reword: *"ADR-0165 — closed 2026-05-10 (674/674 PASS); surfaced this gap in its Mechanism 2 architectural finding."*

4. **ADR-0162 didn't "expose" the silent fallback.** ADR-0166 line 120 attributes the exposure to ADR-0162. Per ADR-0165 amendment text, the silent fallback at `memory-router.ts:838-848` was **pre-existing**; ADR-0162's sync changed cold-start version pins which pushed AgentDB.initialize() over the 30s kill budget under parallel acceptance load, **activating** a previously-dormant fallback. Reword: *"ADR-0162 (Upstream fork sync; the cold-start regression that activated a pre-existing silent fallback ADR-0165 then fixed)."*

5. **Trigger 5 conflates two unrelated concerns.** Trigger 5 references "agentdb fork's parallel maintenance (per ADR-0160)" closing the gap upstream. ADR-0167 (which exists, status accepted) is about Rust-runtime concurrent-writer coordination on `.rvf` files — orthogonal to AgentDB's RuVector-vs-SQLite primary persistence question. Trigger 5 should split into: (a) drop the "parallel maintenance" framing entirely (ADR-0161 ended that state on 2026-05-08, see §D below); (b) replace with the new Trigger 6 in §H below.

#### D. Cross-fork "completeness gap" RESOLVED — supersedes Amendment 1's deferral

Amendment 1 noted: *"The agentic-flow vendored copy of agentdb (per ADR-0160 parallel-extraction context) was not audited."* This is structurally moot. Per ADR-0161 Step 13 (line 72): *"Delete vendored: `rm -rf forks/agentic-flow/packages/agentdb/` and `packages/agentdb-onnx/`."* Done in commit `b9167b8` on 2026-05-08, deleting 1,105 files / 362,170 LoC. Memory `project-agentdb-parallel-extraction.md` confirms: *"Status (post-2026-05-08): Migration complete per ADR-0161. The parallel-source state ENDED."* ADR-0161 also adds regression test `tests/unit/adr0161-agentdb-consolidation-complete.test.mjs` to prevent silent revert.

Only one agentdb source tree exists: `/Users/henrik/source/forks/agentdb/`. Any Option A/B/D landing applies in exactly one place. Strike Amendment 1's "Completeness gap noted but deferred" paragraph; the gap is closed by ADR-0161's structural fact.

#### E. Driver #4 framing DRIFTS — supersedes line 48

ADR-0166 line 48 reads: *"AgentDB's SQLite-first architecture is the largest extant violation of [project-rvf-primary] in the fork. It existed before the rule was articulated; addressing it requires either acknowledging the exception explicitly or migrating AgentDB onto RVF."*

Memory `project-rvf-primary.md` verbatim: *"The `memory.db` SQLite file exists for schema compatibility (AgentDB controllers, memory_entries table) but should NOT be the primary write target for vector data."* The rule **explicitly carves out** AgentDB controller storage as legitimate SQLite usage. AgentDB's controller schemas (episodes, skills, reasoning_patterns, causal_edges) are SQL DDL loaded via `db.exec(schema.sql)` at `core/AgentDB.ts:142-153` — RVF cannot host them natively (RVF is K-V + vector, not relational).

So AgentDB's SQL-DDL controllers are the **rule's natural carve-out**, not its largest violation. Reword Driver #4: *"AgentDB's SQL-DDL controllers represent the structural exception to project-rvf-primary that the rule explicitly carves out. The unresolved gap is whether to formalize this exception (Option B) or pursue Option A/D to eliminate the carve-out via SQL→Cypher controller translation."* This actively **supports Option B** (and weakens Option A's motivation), not the other way around.

#### F. Option C is status quo, not a new option — should be deleted or redefined

Per `core/AgentDB.ts:172-192`, controllers already receive a separate `controllerVB` (vector backend) that routes to RuVector under `'auto'` when available. Vector embeddings already aren't stored in SQLite — they're in the vector backend's own store. Option C's text (*"Keep SQLite for AgentDB schema enforcement... but add a parallel RuVector index that mirrors `(rowId, embedding)`"*) describes the **current** delivered architecture. Synthesizer should either delete Option C or redefine it as: *"Option C (redefined) — promote `enableGraph: true` (already a config flag at `AgentDB.ts:67-69`) into a first-class persistence-axis option, surfacing the SQLite/RuVector hybrid that UnifiedDatabase implements."*

#### G. Option D's "external consumers" claim is a misnomer

Option D bullet says: *"Likely incompatible with AgentDB's external-tool surface (other consumers depend on `agentdb_*` semantics)."* Grep across `forks/ruflo` and `forks/agentic-flow` finds `agentdb_*` MCP-tool consumers in: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`, `forks/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts`, `forks/agentic-flow/.../mcp/standalone-stdio.ts`, and the agentdb fork's own `src/mcp/agentdb-mcp-server.ts`. **All first-party.** No third-party consumer was found. Reword: *"The dual-MCP-surface is internal-only (ruflo + agentic-flow + agentdb's own standalone server). Option D's friction is migration-path size and `b5-*` controller acceptance-test rewriting, not external compatibility. Materially less risky than the original framing claimed."*

#### H. Triggers — retire 3 and 5 as written; add 6

- **Trigger 3 (cognitive-load via investigation-cycle counting)**: unfireable. No counter exists; the "~3 agent-hours" cost is a one-shot estimate, not an instrumented metric. Replace with: *"Trigger 3 (revised) — a future ADR or investigation references the agentdb-vs-RVF dual-storage pattern as a root cause of misdiagnosis. Tracked by lexical match against this ADR's number in subsequent ADR text."*
- **Trigger 5 (upstream closes the gap)**: passive, no monitoring, AND temporally inverted (per §D, the parallel-extraction state already ended). Strike entirely; replaced by Trigger 6 below.
- **Trigger 6 (new)**: *"ADR-0167 Phase 1 stabilization removes the cross-process concurrent-writer blocker for shared `.rvf` files. Today, Option A would inherit RVF's unfixed N=8 concurrent-writer data-loss path (per ADR-0167 §Context). Per `feedback-data-loss-zero-tolerance`, Option A is unshippable until ADR-0167 Phase 1 lands. Trigger fires when ADR-0167 reaches accepted + verified status across the release pipeline."*

#### I. Add Option E — split `vectorBackend` into two fields

Real candidate not currently in the option list: split the dead/overloaded `vectorBackend?: 'auto' | 'ruvector' | 'hnswlib'` field into two orthogonal fields:

- `vectorIndex?: 'ruvector' | 'hnswlib' | 'auto'` — controls vector-search axis (the field's intended semantics).
- `primaryStorage?: 'sqlite' | 'ruvector'` — controls primary persistence axis (defaults to `'sqlite'`; opting into `'ruvector'` routes through `UnifiedDatabase`).

Per-database opt-in. Smaller surface than Option A (no global migration), more honest than Option B (resolves the dead-field problem by giving it real semantics), doesn't collapse the dual MCP surface like Option D. **Recommended insertion point**: between Options B and C in the §"Considered Options" list.

#### J. Narrow B+ to wire-only — supersedes Amendment 1's "(b) remove" sub-path

Amendment 1's Correction 2 expanded Option B to **B+** with two sub-paths: *"(a) wiring `this.config.vectorBackend ?? 'auto'` into the `createGuardedBackend` call, or (b) removing `vectorBackend?` from `AgentDBConfig`."* Confirmed by independent grep that ~9+ ruflo source files set or reference `vectorBackend`:

- `forks/ruflo/v3/@claude-flow/memory/src/agentdb-backend.ts` (lines 92, 124, 303 — type def, default, forwarding pass)
- `forks/ruflo/v3/@claude-flow/memory/src/controller-registry.ts` (lines 65, 332, 495, 1046, 1049, 1127, 1395, 1453, 1465, 1480, 1742, 1746, 1763–1767, 1801, 1812, 1822 — multiple type/forward/route sites)
- `forks/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts:561` (sets `vectorBackend: 'ruvector'` literal — clearly intends to pin RuVector)
- `forks/ruflo/v3/@claude-flow/cli/src/init/types.ts:247`, `init/settings-generator.ts:132` (init template)
- `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts:1091` (controller resolver)
- `forks/ruflo/v3/@claude-flow/neural/src/reasoning-bank.ts:219`

Removing `vectorBackend?` from `AgentDBConfig` is a typed breaking change requiring synchronized updates across 4+ ruflo packages. NOT low-cost. Narrow B+ to **wire-only**: change `core/AgentDB.ts:175` from `createGuardedBackend('auto', ...)` to `createGuardedBackend(this.config.vectorBackend ?? 'auto', ...)`. This is one line + the docstring update + the project-memory entry. The "(b) remove" sub-path is removed from B+; if removal is ever wanted, it's a separate, larger ADR.

A related observation worth flagging: the factory's `BackendType` (`forks/agentdb/src/backends/factory.ts:26`) is `'auto' | 'ruvector' | 'rvf' | 'hnswlib'` — strictly wider than `AgentDBConfig.vectorBackend`'s `'auto' | 'ruvector' | 'hnswlib'`. The config can't express `'rvf'` even though the factory supports it. Consider widening the config union to match the factory in B+, or document the deliberate omission.

#### K. Open Questions resolved or made concrete

- **OQ #1** (programmatic detection of AgentDB→SQLite hard-wire from outside): concrete answer — write an integration test under `forks/agentdb/tests/` asserting both `await new AgentDB({ vectorBackend: 'ruvector' }).initialize().then(db => db.vectorBackendName.includes('ruvector'))` AND `(db as any).db.constructor.name !== 'Database'`. Today both assertions FAIL pre-fix; after B+ wire-only, the first passes but the second still fails (the gap is then explicit and contract-tested).
- **OQ #2** (was UnifiedDatabase ever functional?): RESOLVED. Per §B above, exercised by 17 simulations + standalone MCP server + integration test. Strike OQ #2.
- **OQ #3** (where to document the dual-storage pattern): default to `forks/agentdb/README.md` (architectural posture follows code) plus a one-line cross-reference in `project-rvf-primary.md` memory entry. Strike OQ #3 with this default; reopen if discoverability proves inadequate.
- **OQ #4** (ADR-0160 framing application): RESOLVED. Per §D above, the parallel-extraction state ended 2026-05-08; only one copy exists. Strike OQ #4.

#### L. Missing memory citations to add

- **`feedback-data-loss-zero-tolerance.md`** — load-bearing for Option A and Trigger 6 (per §H above). Add to Decision Drivers as a fifth driver: *"Driver #5 — `feedback-data-loss-zero-tolerance`. Any Option A migration must achieve 100% write durability under cross-process concurrency. Today, RVF's N=8 concurrent-writer path has unfixed data loss (per ADR-0167 §Context). This rule is a hard precondition for Option A activation."*
- **`project-adr0094-living-tracker.md`** — coverage tracking obligation. Add to §"Out of scope" item 5: *"Acceptance-coverage impact (deferred to ADR-0094): if Options A/C/D are pursued, AgentDB schema-migration tests and UnifiedDatabase routing tests are currently absent or under-covered; add tracking entry to ADR-0094 in the same session."*

#### Net effect on outcome

**Provisional posture (B today, defer A/C/D) survives the audit but with material narrowing and reframing**:

1. **B+ today** narrows to **wire-only** (1-line code change at `core/AgentDB.ts:175` + docstring update at `db-unified.ts:5` + `forks/agentdb/README.md` dual-storage doc + `project-rvf-primary.md` memory cross-ref). Cost: ~50 LoC + 2 docs. The "(b) remove" sub-path is dropped.
2. **Option C** marked for deletion (status-quo restatement, not a real option).
3. **Option D** loses the "external compatibility" objection (all first-party).
4. **Option E** (split vectorBackend into vectorIndex + primaryStorage) added as the next-most-attractive future option after B+, smaller scope than A.
5. **Driver #4** flipped from "supports A" to "supports B".
6. **Driver #5** added (data-loss-zero-tolerance, blocks A pre-Trigger-6).
7. **Trigger 5** retired; **Trigger 3** rewritten; **Trigger 6** added (ADR-0167 Phase 1 dependency).
8. **All four Open Questions** either resolved or given concrete defaults.
9. **Cross-ADR cite hygiene** updated: ADR-0160 superseded, ADR-0163/0165 reframed as parallel investigations not sister ADRs, ADR-0165 status closed.
10. Amendment 1's "Completeness gap" deferral struck (ADR-0161 closed it 2026-05-08).
11. Amendment 1's Correction 3 receives a follow-up: UnifiedDatabase IS in production via the standalone MCP server, just defanged at the call site.

The conclusion (recommend B+ wire-only today; defer A and E pending Trigger 6; delete C; preserve D as a smaller-than-thought option) is consistent with the ADR's original direction, but the chain of justification is materially rebuilt around delivered evidence rather than aspirational framing.

### Amendment 2026-05-11c — Reframe: commit to RuVector-primary as the desired outcome (status: discussion → proposed)

The original framing ("discussion; let the parent thread decide later") was wrong-headed for a follow-up ADR. ADR-0166 was created to advance ADR-0165's surfaced gap, but it produced no successor and the "parent thread" was never named. This amendment names the desired outcome and commits to a phased plan to reach it. Status moves to `proposed`; phases promote to `accepted` as each lands.

The desired outcome (now stated near the top of the ADR) is: **AgentDB's primary persistence is RuVector**, with SQLite retained only as the explicit `project-rvf-primary` carve-out for SQL-DDL controller schemas — and that carve-out itself is sunset when controller schemas migrate to RuVector primitives.

#### Why now

- **Trigger 6 (Amendment 2026-05-11b §H) has fired**. ADR-0167 is `accepted` (Phase 1 RootHeader pattern landed at `f4cbbf45e` on `forks/ruvector`); ADR-0168 is `accepted` (Phase 2 in-process writer-coordinator). The cross-process concurrent-writer blocker that gated Option A is resolved.
- **The dead-config-field problem is documented but unfixed**. `core/AgentDB.ts:175` still hardcodes `'auto'`; ruflo's `memory-router.ts:561` still passes `vectorBackend: 'ruvector'` and gets SQLite anyway. Each session this stays unfixed re-creates the diagnostic-blind-spot risk Driver #1 names.
- **The standalone MCP server's defang at `agentdb-mcp-server.ts:247`** (`db = unified.getSQLiteDatabase() ?? unified`) is the smoking gun: someone wired UnifiedDatabase, then immediately downgraded its return value to SQLite-only. That line records the unfinished migration intent.
- **There is no successor ADR**. ADR-0167 and ADR-0168 are about RVF runtime concurrency, not about AgentDB→RuVector. If 0166 doesn't commit, nothing closes the gap.

#### Phased plan

**Phase 1 — Wire-only fix + documentation (immediate, ~50 LoC + 2 docs)**

- *Code*: Change `core/AgentDB.ts:175` from `createGuardedBackend('auto', { ... })` to `createGuardedBackend(this.config.vectorBackend ?? 'auto', { ... })`. One line.
- *Docs*: Update `db-unified.ts:5` docstring to reflect delivered reality (UnifiedDatabase is currently used by the standalone MCP server boot path with the SQLite-extract defang; SDK path hard-wires SQLite). Add a one-paragraph "Persistence architecture" section to `forks/agentdb/README.md` documenting the three-way pattern (SDK, standalone MCP, simulation) and the carve-out for SQL-DDL controllers. Cross-reference the carve-out from `project-rvf-primary.md` memory entry.
- *Test*: Add the OQ#1 contract test under `forks/agentdb/tests/` asserting `await new AgentDB({ vectorBackend: 'ruvector' }).initialize().then(db => db.vectorBackendName.includes('ruvector'))`. Today this passes only because the factory's `'auto'` happens to detect RuVector; after the wire, it passes by user intent. The companion assertion `(db as any).db.constructor.name !== 'Database'` is documented as expected-FAIL until Phase 3.
- *Exit criteria*: (a) field is wired and respected at the call site; (b) docs reflect reality; (c) contract test exists and passes its first assertion. After exit, status promotes to `accepted` for Phase 1 alone.
- *Rollback*: trivial revert; no data migration.

**Phase 2 — Split the field, expose per-database opt-in (Option E, backward-compatible)**

- *Code*: Split `vectorBackend?: 'auto' | 'ruvector' | 'hnswlib'` into two orthogonal fields in `AgentDBConfig` (`forks/agentdb/src/core/AgentDB.ts:49`):
  - `vectorIndex?: 'ruvector' | 'hnswlib' | 'auto'` (default `'auto'`) — controls vector-search axis.
  - `primaryStorage?: 'sqlite' | 'ruvector'` (default `'sqlite'`) — controls primary persistence axis.
- *Backward-compat shim*: `vectorBackend` remains as a deprecated alias. If set, mirror to `vectorIndex`. Type-deprecate via JSDoc; remove in a future major.
- *Wiring*: when `primaryStorage === 'ruvector'`, route `core/AgentDB.ts:initialize()` through `createUnifiedDatabase` (already exists at `db-unified.ts:312-328`) instead of constructing `better-sqlite3` directly at line 117. Controllers consume `unified.getGraphDatabase()` for new vector data + `unified.getSQLiteDatabase()` (if present from legacy detection) for SQL-DDL schema reads. Existing `.db` files trigger UnifiedDatabase's existing legacy-detection path.
- *Adapter updates*: `forks/ruflo/v3/@claude-flow/memory/src/agentdb-backend.ts` accepts and forwards both fields. Default `primaryStorage: 'sqlite'` preserves all 9+ existing call sites unchanged.
- *Tests*: integration tests covering both `primaryStorage: 'sqlite'` (regression) and `primaryStorage: 'ruvector'` (new opt-in path) for: initial boot on empty path; legacy `.db` re-open; new `.graph` create; controller CRUD against each.
- *Exit criteria*: (a) both `primaryStorage` values pass acceptance; (b) `vectorBackend` deprecation warning emits at runtime when set; (c) at least one ruflo call site (suggest `memory-router.ts:561`) opts into `primaryStorage: 'ruvector'` end-to-end with documented behavior. After exit, status promotes to `accepted` for Phase 2.
- *Rollback*: deprecation alias preserves previous behavior; users who never set `primaryStorage` see no change.

**Phase 3 — Flip the default + extend migration tool + remove SDK SQLite hard-wire (terminal)**

- *Code*: change `primaryStorage` default from `'sqlite'` to `'ruvector'`. SDK boot path (`core/AgentDB.ts:initialize()`) routes through `createUnifiedDatabase` by default. Standalone MCP server's defang at `agentdb-mcp-server.ts:247` (`db = unified.getSQLiteDatabase() ?? unified`) is removed; consumers receive the unified handle directly.
- *Migration tool extension*: `db-unified.ts:migrateSQLiteToGraph` (lines 162-260) covers episodes, skills, causal_edges only. Phase 3 extends to all controller tables enumerated by `schemas/schema.sql` + `schemas/frontier-schema.sql` (per Amendment 2026-05-11b §A: episodes, episode_embeddings, skills, skill_links, skill_embeddings, facts, notes, note_embeddings, events, consolidated_memories, exp_nodes, exp_edges, exp_node_embeddings, memory_scores, memory_access_log, consolidation_runs, causal_edges, causal_experiments, causal_observations). Add a one-shot CLI command `agentdb migrate <path>` that idempotently converts `.db` → `.graph`. Per `feedback-data-loss-zero-tolerance`, migration must be transactional and verifiable.
- *Carve-out sunset*: SQL-DDL controllers (those that depend on SQL joins, e.g., `CausalRecall`'s edge traversal) get a Cypher-equivalent on RuVector graph mode. Where Cypher equivalence is non-trivial, a SQLite read-only shadow is acceptable until the equivalent lands — but no new SQLite writes after Phase 3.
- *Exit criteria*: (a) SDK boot path defaults to RuVector primary; (b) `agentdb-mcp-server.ts:247` defang removed; (c) all controller acceptance tests pass on `primaryStorage: 'ruvector'` boot; (d) `agentdb migrate` tool exists and round-trips a populated `.db` → `.graph` with byte-equivalent semantic content; (e) the OQ#1 contract test's second assertion (`db.constructor.name !== 'Database'`) now passes with default config. After exit, status promotes to `accepted` for Phase 3 (and the ADR as a whole moves to `accepted` if not already).
- *Rollback*: each user retains the ability to set `primaryStorage: 'sqlite'` explicitly; the default flip can be reverted by a single-line config change. The migration tool is one-way (sqlite → graph); per `feedback-no-fallbacks`, no auto-downgrade to SQLite occurs.

#### Phase gates (replaces the original Triggers section)

- **Phase 1 → Phase 2 gate**: Phase 1 contract test passes the first assertion (vectorBackendName respects user intent). At least one investigation cycle confirms the dead-field diagnostic-blind-spot is closed.
- **Phase 2 → Phase 3 gate**: At least one production ruflo call site opts into `primaryStorage: 'ruvector'` for at least one release cycle without triggering acceptance regressions. The deprecation warning on `vectorBackend` is observed (signals Phase 2 is reaching the call sites). `agentdb migrate` tool spec is reviewed and approved (separate ADR if scope warrants).
- **Re-evaluation event (replaces Trigger 6)**: ADR-0167 Phase 1 destabilization at any point during Phase 2 or Phase 3 immediately pauses the plan and reopens this ADR. Per `feedback-data-loss-zero-tolerance`, RuVector primary cannot proceed without a stable cross-process write story.
- **Re-evaluation event (replaces original Trigger 5)**: Upstream `ruvnet/agentdb` adopts UnifiedDatabase as its SDK default before Phase 3 lands. If so, Phase 3 collapses to a sync; we don't fork the change.

#### What this amendment supersedes (within ADR-0166)

- **Decision Outcome / "Pending"**: superseded — the decision is the phased plan above.
- **Original Recommendation ("Take Option B today")**: superseded — Phase 1 is B+ wire-only (per Amendment 2026-05-11b §J). Phase 2 lands Option E. Phase 3 lands Option A.
- **Original Triggers 1–5**: superseded by phase gates and re-evaluation events above.
- **Option C**: deleted (per Amendment 2026-05-11b §F — status quo, not an option).
- **Option D**: retained as a fallback alternative if Phase 2 reveals the dual-MCP surface is incompatible with `primaryStorage: 'ruvector'` semantics. Not pursued unless a concrete blocker emerges.
- **Open Questions 2 + 3 + 4**: resolved per Amendment 2026-05-11b §K. OQ #1 absorbed into Phase 1 contract test.

#### What this amendment does NOT do

- Does not promote status to `accepted` for the full plan today. Each phase promotes to `accepted` independently as it lands and exits its criteria.
- Does not write the code. Phase 1 is execution work the user can opt into when ready (one-line wire + docs + one test). Phase 2/3 are larger and warrant their own implementation logs.
- Does not change `forks/agentdb/src/db-unified.ts:5` docstring or `core/AgentDB.ts:175` call site. Those are Phase 1 work.

### Amendment 2026-05-11d — Vision lineage + scope honesty (4-agent audit + vision-doc swarm)

Two parallel swarms ran on 2026-05-11. The first audited the "sunset SQLite" claim from three angles: AgentDB controller SQL-feature usage, RuVector capability today, and the framing itself (`feedback-no-value-judgements-on-features` posture). All three converged: today's path from SQLite to RuVector-primary is materially larger than the ADR's Phase 3 implies. The second hunted for the unified vision document the user said exists. It does, in four documents this ADR failed to cite.

This amendment absorbs both swarms' findings. Net result: **the desired outcome (RuVector primary) survives**, but the framing is rebuilt around the vision lineage that already exists in our corpus and upstream's, and Phase 3's scope is honestly named as a continuation of multi-month work that ADR-0073 already started on the memory-side.

#### Vision lineage — cited now, missed in original ADR

ADR-0166 was created as if the question (should AgentDB use RuVector as primary?) was fresh. It is not. Four prior documents already establish RuVector-as-substrate as the vision:

1. **`ruvnet/agentic-flow/README.md`** (upstream, top-level). Positions Claude-Flow/Agentic-Flow as the orchestration platform with RuVector as the intelligence substrate. Enumerates 9 core RuVector components (SONA, EWC++, Flash Attention, HNSW, ReasoningBank, hyperbolic embeddings, LoRA/MicroLoRA, Int8 quantization, SemanticRouter + 9 RL algorithms) consumed by AgentDB. The vision is RuVector-primary; SQL/Postgres is interop (`@ruvector/postgres-cli` layers RuVector onto Postgres, not the other way).

2. **`ruvnet/agentic-flow/packages/agentdb/docs/adrs/ADR-007-ruvector-full-capability-integration.md`** (upstream, 2026-02-17, Phase 1 Complete, Phases 2-5 Proposed). The formal upstream ADR. Verbatim: *"AgentDB depends on 11 `@ruvector/*` npm packages but uses only a fraction of their exported APIs"* — coverage table shows `@ruvector/core` at ~40%, `@ruvector/attention` at ~15%, `@ruvector/rvf-wasm` at ~5%, etc. Concludes *"AgentDB leaves ~70% of available @ruvector capability unused"* and lays out a 5-phase integration roadmap. This is the upstream architectural mandate ADR-0166 is operating under, whether it knew it or not.

3. **ADR-0067 (closed, 2026-04-21)** — *Original Vision: Controller Wiring*. Establishes the 4-layer architecture: Layer 1 (AgentDB) as a lazy infrastructure container; Layer 2 (ControllerRegistry) as lifecycle manager; Layer 3 (memory-bridge.ts) constructing the runtime; Layer 4 (config). AgentDB is *infrastructure*, not a controller owner — which is consistent with the "RuVector primary" framing (AgentDB hosts controllers; its own primary store is whatever the infrastructure layer says it is).

4. **ADR-0069 (F1 implemented, F2 → ADR-0073, F3 implemented)** — *Future Vision*. F2 verbatim: *"RVF as Single Storage Format"*. Cites ruvnet/RuVector ADR-029 (RVF Canonical Format) as the migration mandate: *"agentdb: Custom HNSW + JSON → RVF with RVText profile; claude-flow memory: JSON + flat files → RVF with WITNESS_SEG..."*

5. **ADR-0073 (Phases 1-3 Implemented, 2026-04-06)** — *RVF Storage Backend Upgrade*. Extracted from ADR-0069 F2. **This is the direct precursor of ADR-0166 that the original framing failed to cite.** Verbatim Context: *"ADR-0069 F2 envisioned 'RVF as the single storage format' — replacing 6 storage formats with RuVector's binary format. Analysis by a 6-agent hive council found that the full consolidation vision is multi-month scope, but three concrete improvements to the primary storage backend deliver most of the value."* ADR-0073 took the *ruflo-memory side* of the vision (`RvfBackend` in `@claude-flow/memory`); Phases 1-3 shipped. The *agentdb-side* of the same vision was acknowledged as remaining scope. **ADR-0166 IS that remaining scope — it is the agentdb-side companion to ADR-0073, under the unified ADR-0069 / upstream ADR-007 vision.**

6. **`docs/architecture/controller-wiring-vision.md`** (2026-04-05) — the blueprint synthesizing the upstream + fork-side vision into a single architecture document. Explicitly references ruvnet/ruflo issues #1228/#1516, ruvnet/RuVector ADR-029, and ruvnet/agentic-flow branch `feat/adr-053-controller-activation`.

#### Repositioning

ADR-0166 is **no longer a discovery ADR** — it is a continuation ADR under an established vision lineage. Its purpose narrows: *complete the agentdb-side of the RVF-as-single-storage-format vision that ADR-0073 began on the memory-side, in alignment with upstream ADR-007's Phases 2-5 of the @ruvector full-capability-integration roadmap.*

The "Desired outcome" (line 17 area) is correct on direction; the framing was wrong to claim it as a fresh decision. The two prior amendments' corrections about controllers/RuVector capability/sunset framing are **evidence for the multi-month scope ADR-0073 already named**, not arguments against the goal. ADR-0073's own Context paragraph forecast precisely this: *"the full consolidation vision is multi-month scope."*

#### Driver updates

- **Driver #1 (architectural honesty)** — *retain*, but reground the supporting evidence: the ADR-0163 misdiagnosis (already covered in Amendment 2026-05-11b §A) is one data point; the *bigger* data point is that ADR-0067/0069/0073 + upstream ADR-007 established this vision over years and the SDK boot path still hard-wires SQLite. The architectural-honesty cost is not a hypothetical future investigation cycle — it's already paid every time a session reads `db-unified.ts:5` and the SDK boot ignores it. Phase 1 closes that gap.

- **Driver #4 (project-rvf-primary)** — Amendment 2026-05-11b §E flipped this to "structural exception, not violation." The vision lineage refines further: the rule's AgentDB controller carve-out was **always intended as transitional**, not permanent. Upstream ADR-007 Phases 2-5 lay out the path to dissolving the carve-out. The rule is honoring the carve-out *during the migration*; ADR-0166's Phase 3 is the migration's tail end. The carve-out's "permanence" was a fork-side assumption that the vision lineage refutes.

- **Driver #5 (new — vision-lineage alignment)** — Add: *"This ADR is the agentdb-side continuation of ADR-0073's RVF-as-single-storage work, under the unified vision established by ADR-0067, ADR-0069, `docs/architecture/controller-wiring-vision.md`, upstream `ruvnet/agentic-flow/README.md`, and upstream ADR-007 (`@ruvector full-capability-integration`). Phase 3's scope is the agentdb companion to ADR-0073's memory-side Phases 1-3, sized to match the upstream ADR-007 Phases 2-5 roadmap."*

#### Phase 3 scope honesty

The audit findings name the real shape of Phase 3:

- **Controller SQL usage** (audit 1): 14 controllers split 3 TRIVIAL / 8 MODERATE / 2 HARD. The two HARD controllers (CausalMemoryGraph, CausalRecall) use `WITH RECURSIVE` causal-chain traversal that has no current Cypher equivalent. Plus 9 FK CASCADE constraints + 6 update triggers + 6 views + conditional aggregations.
- **RuVector capability gap** (audit 2): no DDL, incomplete Cypher WHERE (admitted at `GraphDatabaseAdapter.ts:293`), no multi-record ACID, no FTS, zero SQL→Cypher translation tests. Production-grade for vector search; scaffolded-only for graph queries.

These are **not arguments against Phase 3** — they are the inventory of what Phase 3 actually contains. Per upstream ADR-007's Phases 2-5, RuVector capability closure is upstream's roadmap. Phase 3 lands when that capability closure produces a `@ruvector/graph-node` whose Cypher subset can host AgentDB's queries.

**Phase 3 is therefore reframed as gated on a precursor sub-ADR:**

- **ADR-0169 (proposed)** — *RuVector capability closure for AgentDB migration*. Owns: Cypher WHERE completeness, multi-record transactional semantics, FTS-equivalent (or SQL-shadow read fallback), schema-equivalent DDL surface, and SQL→Cypher translation test harness. Per upstream ADR-007 Phases 2-5, this work mostly lives in `ruvector` and `agentic-flow/packages/agentdb`. ADR-0169's exit criteria become Phase 3's entry gate.

- **Phase 3 entry gate**: ADR-0169 reaches Phase 1 stabilization (the controller-feature-parity subset of capability closure). Until then, Phase 3 cannot begin; Phase 2 (Option E per-database opt-in) is the operational stopping point.

#### Critic findings absorbed

The critic's recommendation to *split Phase 1 from Phase 3 into two separate ADRs* is partially right: Phase 1 delivers honoring-the-typed-contract independently of Phase 3. But splitting fully would also fragment the vision-lineage citation, and the user's stated goal ("AgentDB using RuVector") needs a single home for the desired outcome. Compromise: **Phase 1 and Phase 2 land under ADR-0166; Phase 3 is gated on ADR-0169** (the prerequisite capability-closure ADR named above). ADR-0166 retains the desired outcome and the lineage; ADR-0169 carries the precursor cost. The critic's "bundling" concern is resolved by the gate, not by splitting the desired outcome from its phases.

The critic's other reframe candidates (A — honest equilibrium; C — status-quo description; D — sunset as conditional aspiration) are not adopted because they all soften the desired outcome below what the vision lineage commits to. The vision is RuVector-primary; the lineage is unambiguous on that point. The honest move is *naming the work*, not *softening the goal*.

The critic's "monoculture vs `feedback-no-value-judgements-on-features`" concern resolves under the lineage: importing all upstream capability is precisely what upstream ADR-007 Phases 2-5 enumerate — wire kernel runtime, attention, GNN, graph, router, RVF, sona at their full surface area. "Sunset SQLite" in ADR-0166 is shorthand for "complete the @ruvector full-capability-integration roadmap," which IS importing all upstream capability. The rule and the goal align.

#### Updated phase summary

| Phase | Scope | Status | Gate to next |
|-------|-------|--------|--------------|
| **Phase 1** | Wire `vectorBackend` at `core/AgentDB.ts:175`; fix `db-unified.ts:5` docstring; add persistence-architecture section to `forks/agentdb/README.md`; cross-ref from `project-rvf-primary.md`; add OQ#1 contract test (first assertion). ~50 LoC + 2 docs. | proposed (immediate execution) | Contract test's first assertion passes; investigation-cycle dead-field risk closed. |
| **Phase 2** | Split `vectorBackend?` into `vectorIndex?` + `primaryStorage?` (Option E); default `primaryStorage: 'sqlite'` for backward compat; opt-in route through `createUnifiedDatabase`; deprecate `vectorBackend` alias. | proposed (after Phase 1) | At least one ruflo call site opts into `primaryStorage: 'ruvector'` end-to-end for one release cycle without acceptance regressions; ADR-0169 reaches Phase 1 stabilization (capability gate). |
| **ADR-0169 prerequisite** | RuVector capability closure for AgentDB migration: Cypher WHERE completeness, multi-record ACID, FTS-equivalent or SQL-shadow read fallback, schema-equivalent DDL surface, SQL→Cypher translation test harness. Mostly lives in `ruvector` + upstream agentdb under ADR-007 Phases 2-5. | not yet authored | ADR-0169 Phase 1 exit unlocks ADR-0166 Phase 3 entry. |
| **Phase 3** | Flip `primaryStorage` default to `'ruvector'`; SDK boot path consumes `UnifiedDatabase`; remove `agentdb-mcp-server.ts:247` defang; extend `migrateSQLiteToGraph` to all 19 controller tables; add `agentdb migrate` CLI; ergonomic-parity story for SQLite inspection (Datasette equivalent, or documented read-only SQLite shadow during transition). | gated on ADR-0169 | OQ#1 contract test's second assertion passes (`db.constructor.name !== 'Database'`); ADR-0166 promotes to `accepted` as a whole. |

#### What this amendment supersedes

- The "no successor ADR exists" framing in Amendment 2026-05-11c — there IS a precursor (ADR-0073) and a co-equal upstream lineage (ADR-0069, controller-wiring-vision.md, ruvnet ADR-007). ADR-0166 sits inside that lineage, not in isolation.
- Phase 3's previous scope estimate. The 19-table migration + Cypher equivalence work is honestly upstream ADR-007 Phases 2-5 territory; we don't pretend the agentdb-side migration is independently sizable.
- The Direction-1-vs-Direction-2 question from the synthesis: Direction 1 is correct because the vision is already established by the lineage; the only honest choice is how to size it (this amendment) vs. whether to do it (settled by upstream).

#### What this amendment does NOT change

- Phase 1 stays exactly as defined in Amendment 2026-05-11c. Immediate, ~50 LoC, low risk.
- Phase 2 stays as Option E with `primaryStorage: 'sqlite'` default. Backward-compat preserved.
- Status remains `proposed`. Each phase promotes to `accepted` independently as it lands and exits its criteria.
- The cited audit findings (controllers + RuVector) are recorded as scope evidence; no edits to Amendment 2026-05-11b's text.

### Amendment 2026-05-11e — Full upstream lineage citation + cross-reference fan-out

A two-agent sweep across local corpora (`ruflo-patch/docs/adr/`, `forks/ruflo/v3/implementation/adrs/`) and upstream (`ruvnet/agentic-flow/packages/agentdb/docs/adrs/`, `ruvnet/RuVector/docs/adr/`, `ruvnet/ruflo/v3/implementation/adrs/`) closed two gaps Amendment 2026-05-11d named but didn't fully populate.

#### 1. ADR-0056 added to `related:` frontmatter

ADR-0056 (MCP Server Unified Backend — RVF Primary, SQLite Fallback, Implemented 2026-03-22, v3.5.15-patch.115) already wires `UnifiedDatabase` in production for the standalone agentdb MCP server boot path. It is the contemporary production validation of the wiring pattern ADR-0166 Phase 1 introduces to the SDK boot path. The defang at `agentdb-mcp-server.ts:247` (`unified.getSQLiteDatabase() ?? unified`) is the unfinished tail of ADR-0056's work; ADR-0166 Phase 3 removes it.

#### 2. Upstream RuVector ADR-029 named as the canonical binding

Amendment 2026-05-11d cited upstream `agentdb/ADR-007` (capability roadmap) but missed the more fundamental document: **`ruvnet/RuVector/docs/adr/ADR-029-rvf-canonical-format.md`** (Accepted 2026-02-13). ADR-029 mandates RVF as the single canonical binary format across all RuVector libs (70+ Rust crates, 50+ npm packages) — segment forward compatibility, RVText/RVGraph nested profiles, REDB→RVF migration, wire format standardization. **ADR-029 is the format-level upstream mandate; ADR-007 is the integration-level roadmap that consumes it.** Our local ADR-0154 already aligns with ADR-029 explicitly; ADR-0166's Phase 3 inherits the same alignment by extension.

#### Full upstream lineage now made explicit

| Layer | Upstream ADR | Status | Role |
|-------|--------------|--------|------|
| Format mandate | RuVector ADR-029 | Accepted 2026-02-13 | Single binary format for all RuVector libs |
| Capability roadmap | agentdb ADR-007 | Phase 1 Complete | 11-package inventory; ~70% unused; 5-phase closure |
| WASM integration | agentdb ADR-002 | Partially Implemented | Curriculum, attention, micro-LoRA, embedding optimization |
| RVF integration assessment | agentdb ADR-003 | Proposed | `@ruvector/rvf{,-node,-wasm}` validation |
| AGI integration | agentdb ADR-004 | Accepted 2026-02-17 | RvfSolver, witness chains, N-API methods |
| Self-learning integration | agentdb ADR-005 | Accepted 2026-02-17 | `@ruvector/sona`, `@ruvector/ruvllm`, `@ruvector/attention` wiring |
| Unified RVF self-learning | agentdb ADR-006 | Proposed | SonaLearningBackend, ContrastiveTrainer, SemanticQueryRouter on RVF |
| Chat surface | agentdb ADR-008 | Proposed | RVF-backed chat with self-contained schema |
| RVF solver | agentdb ADR-010 | Proposed | `@ruvector/rvf-solver v0.1.6` deep integration |
| Attention mechanisms | ruflo ADR-028 | Proposed | 39-mechanism AttentionService cited by local ADR-0069 F3 |

The proposed ADR-0169 (Phase 3 prerequisite per Amendment 2026-05-11d) maps to a subset of upstream ADR-002 + ADR-003 + ADR-006 + ADR-007 Phases 2-5. ADR-0169 should cite all four when authored.

#### Cross-references added to other local ADRs in this same pass

- **ADR-0056** — `## Related` section gains a bullet pointing to ADR-0166 (vision-lineage successor) and to upstream RuVector ADR-029.
- **ADR-0067** — Cross-reference block appended naming upstream ADR-029 + ADR-007 + ADR-0166. ADR-0067's controller-wiring decisions are preserved verbatim; only the underlying storage substrate moves.
- **ADR-0069** — Cross-reference block appended; F2 (RVF as Single Storage Format) maps to upstream ADR-029, F1/F3 map to upstream ADR-007 + ruflo ADR-028.
- **ADR-0073** — Cross-reference block appended; ADR-0073 IS the local memory-side implementation of upstream ADR-029. ADR-0166 inherits the same multi-month scope framing for the agentdb side.
- **ADR-0167** — `related:` frontmatter widened to include 0166 (closes the bidirectional reference: ADR-0166's Trigger 6 cites ADR-0167; ADR-0167 now reciprocates).

Stage C edits (the cross-reference blocks on ADR-0067/0069/0073) are inline notes appended after the existing closing sections — not rewrites. Those ADRs' decisions stand; the cross-references make the upstream lineage discoverable without re-litigating prior decisions.

### Amendment 2026-05-11f — 8-persona dialectic council reverses Phase 3 direction (Option F adopted)

An 8-persona dialectic council on team `adr0166-vision-council` engaged on the question *"What should the vision be for agentdb/ruvector storage and retrieval solutions?"* via Agent Teams SendMessage primitives (peer-to-peer, no shared-disk comms). All 8 personas (queen + devil + storage + retrieval + controllers + ruvector + migration + upstream) returned final Phase 4 positions. The council converged unanimously on a vision that **reverses the Phase 3 direction set in Amendment 2026-05-11c**.

This amendment supersedes Amendment 2026-05-11c's "Desired outcome" (RuVector primary via 3-phase migration) and Amendment 2026-05-11d's phase-3-conditional-on-ADR-0169 framing. The earlier amendments' lineage citations (ADR-0067, ADR-0069, ADR-0073, upstream ADR-029, upstream ADR-007) remain accurate and load-bearing; only the synthesis built on them changes.

#### Council convergence: 8-of-8 on Option F + axis-separated permanent dual-storage

Queen's amended synthesis (after Round 3 substrate evidence): *"Synthesizer's role is to weave dissent into consensus. The council's consensus moved during synthesis (the coalition coalesced after my initial vision broadcast). I am updating the synthesis to honor the council's converged direction even where it inverts my own initial position. The substrate evidence (REDB-quadruplication, SQL-fallback silent deletion, segment-ID upstream-coordination dependency) is decisive."*

The convergent finding — **Option F** — was not in the original ADR-0166 option set. It emerged from the dialectic: SQLite stays primary for `agentdb_*` permanently; RuVector embeds as a vector-index virtual table inside SQLite via sqlite-vec or `@sparkleideas/ruvector-sqlite-vec-node`. This is composition, not substrate replacement.

#### Substantive findings the dialectic produced

1. **REDB-quadruplication** (RuVector substrate specialist + storage architect): `@ruvector/graph-node` 2.0.3-patch.52 is **redb-backed**, NOT RVF-backed (`forks/ruvector/crates/ruvector-graph/Cargo.toml:20`, `storage.rs:21-31`). Adopting Option A's `enableGraph: true` would add a fourth on-disk format (SQLite + `.rvf` + `.meta` + `.redb`) — opposite of consolidation, violating ADR-029's own goal. Format unification by Option A is impossible without first migrating `@ruvector/graph-node` from redb to RVF (upstream-coordination problem we can't drive per `feedback-no-upstream-donate-backs`).

2. **Upstream cadence NULL** (upstream lineage historian): standalone `ruvnet/agentdb` has zero substantive technical commits since init 2026-05-06. agentic-flow vendored copy has NO `getSQLiteDatabase()` defang at all (the defang at `agentdb-mcp-server.ts:247` is fork-only via ADR-0056). The fork is AHEAD of upstream on RuVector-primary, not waiting for it. Upstream ADR-007 Phases 2-5 have been "Proposed" since 2026-02-17 — 12 weeks with zero shipping commits.

3. **5-of-14 controllers are PERMANENT_SQLITE_CARVE_OUT** (controllers specialist, retracted previous "concur direction"): CausalMemoryGraph (WITH RECURSIVE), CausalRecall (JOIN + rerank), NightlyLearner (self-JOIN + GROUP BY + HAVING), LearningSystem (RL aggregations), ReasoningBank (GROUP BY task_type). These are architecturally relational, don't migrate, period. The remaining 9 controllers (3 TRIVIAL + 6 MODERATE) can adopt Option F at ~3-6 LoC SQL change each (`CREATE VIRTUAL TABLE <controller>_vec USING vec0(embedding float[768])`).

4. **No user-facing capability fails on today's architecture** (Queen conceded). The only candidate Phase 3 user-benefit (substring-collision bug in `CausalMemoryGraph.getCausalChain`) was retracted by Controllers in Round 3. Phase 3 has **no identified user-facing motive**.

5. **Migration scope correction** (migration/ops specialist): upstream agentic-flow ADR-003 already specifies the migration tool (`agentdb migrate --to rvf` CLI, 7-step pipeline). The previously-proposed fork-side ADR-0170 narrows to validation harness only — not building. Under Option F this entire ADR collapses (no migration needed).

6. **The "Custom HNSW + JSON → RVF" migration in ADR-029** (upstream specialist re-read): ADR-029's stated agentdb baseline is *"Custom HNSW + JSON"* — it does NOT name SQLite as a baseline or as a target for replacement. The "MUST use RVF" applies to *vector data persistence and exchange*, which Option F honors via the sqlite-vec virtual table embedding RuVector HNSW. **Option F is not actually a fork-divergence from ADR-029's stated direction** — it's an alternative composition that satisfies both ADR-029 ("RVF for vector data") and ADR-007 ("wire all upstream capability") without doing what neither ADR explicitly mandates (replace SQLite as relational substrate).

#### Phase plan — final

| Phase | Scope | Status |
|-------|-------|--------|
| **Phase 1** | Wire `vectorBackend` at `core/AgentDB.ts:175`; fix `db-unified.ts:5` docstring (reframe as "PRIMARY: RuVector for memory_* axis"; document axis-separation); add persistence-architecture section to `forks/agentdb/README.md`; cross-ref from `project-rvf-primary.md`; add OQ#1 contract test (first assertion). ~50 LoC. | **proposed (immediate execution)** |
| **Phase 1.5** | Retrieval Specialist's quick win — delete or wire the dead `graphBackend` parameter on `HierarchicalMemory.ts:157` and `MemoryConsolidation.ts:107`. Removes a shipped bug at low cost; independent of other phases. | **proposed (after Phase 1)** |
| **Phase 2** | Split `vectorBackend?` into `vectorIndex?: 'sqlite-vec' \| 'hnswlib' \| 'auto'` + `primaryStorage?: 'sqlite'` (only valid value under Option F). **Per-database opt-in, NEVER process-global.** Deprecation warning emits at runtime when legacy `vectorBackend` is set. Loud-error boot when legacy `.db` + `'ruvector'` opt-in attempted. Default `primaryStorage: 'sqlite'` preserves all 9+ existing ruflo call sites unchanged. | **proposed (after Phase 1 bakes one release cycle)** |
| **Phase 3 (Option F)** | sqlite-vec virtual table integration for controllers using vector ops. Per-controller `CREATE VIRTUAL TABLE <controller>_vec USING vec0(embedding float[768])` augmentation, landed incrementally — 3-6 LoC SQL change per controller. No data migration; no `.db → .graph`; no UnifiedDatabase wiring into SDK. Standalone MCP server defang at `agentdb-mcp-server.ts:247` cleaned up to direct SQLite open + sqlite-vec load. Browser/WASM substrate gracefully degrades to JS-side cosine compute (matches existing pattern in `controllers/HNSWIndex.ts:34-54`). | **proposed (after Phase 2)** |
| **Parallel track** | ADR-007 Phase 1 capability adoption ships ASAP per `feedback-no-value-judgements-on-features`. Native optimizers, EWC++, full SIMD, RVF compression profiles, router persistence, SONA context enrichment, RLM controller for RAG, batch ops, ReasoningBank wire-up, adaptive ef_search via rvf-solver. Independent of phase plan; substrate-ready, fork-side wiring only. | **proposed (parallel, immediate)** |

**Phase 3 (substrate flip + SDK SQLite hard-wire removal + UnifiedDatabase wiring into core/AgentDB.ts:117-128 + `agentdb-mcp-server.ts:247` defang removal) — as defined in Amendments 2026-05-11c/d/e — is RETIRED.** Not "gated", not "directional aspiration", not "perpetually-conditional." Retired. No user-facing capability gap was identified; the only candidate was retracted. Substrate-flip work has no engineering motive and is not in the project plan.

#### Prerequisite ADRs collapse from 6 to 1

Amendment 2026-05-11d named six prerequisite ADRs (ADR-0167 Phase 2, ADR-0169a, ADR-0169b, ADR-0170, ADR-0171, ADR-0089 verification). Under Option F:

- **ADR-0167 Phase 2** (cross-process N=8 durability on `.rvf`) — **remains valid** but applies to `memory_*` axis only, independent of ADR-0166 outcome. Not a prerequisite for any agentdb_* work.
- **ADR-0169 (RuVector capability closure)** — **reframed from "capability roadmap" to "capability categorization"**. Documents why Phase 3 substrate-flip is retired: RuVector is vector-first + graph-second, not relational; expecting `@ruvector/graph-node` to host the agentdb controller surface is asking it to become a different category of database (5-10 year project per Devil's category-claim, sustained). Informational ADR, not a roadmap.
- **ADR-0170 (Storage segment-format reservation)** — **withdrawn**. Storage architect withdrew this proposal after the council formed Option F coalition; no Phase 3 means no SegmentType reservation needed.
- **ADR-0171 (Migration tooling)** — **withdrawn**. No migration under Option F.
- **ADR-0089 singleton verification** — handled separately; not gated to ADR-0166.

**No new ADR is needed.** ADR-0166 with Amendments 2026-05-11b/c/d/e/f IS the binding decision record. Earlier amendment text named "a single decision ADR documenting Option F adoption" — that framing was leftover from Amendment 2026-05-11d's prerequisite list and is hereby struck. This ADR (its top-of-file Desired Outcome + Amendment 2026-05-11f) carries the Option F decision. `project-rvf-primary` memory entry was updated 2026-05-11f to reflect axis-clarity; no further ADR work outstanding for the decision itself. Execution work (Phase 1, 1.5, 2, 3 Option F + parallel-track ADR-007 Phase 1 capability adoption) remains as live next steps, but those are implementation tasks, not new ADRs.

#### Memory rule clarification: `project-rvf-primary` axis-separation

Amendment 2026-05-11b §E already flipped Driver #4 from "violation" to "structural exception." This amendment extends that: the `project-rvf-primary` carve-out is **permanent, axis-separated**, not transitional:

- "RVF is primary" applies to the **`memory_*` axis** (`.swarm/memory.rvf` via `RvfBackend`). Correctly RVF-primary today; Option F doesn't touch it.
- "RVF is primary" does NOT apply to the **`agentdb_*` axis** (`.swarm/memory.db`). AgentDB's SQL-DDL controllers are the rule's natural carve-out, formalized by Option F as permanent posture.

The `project-rvf-primary` memory entry should be updated in a separate edit to reflect this axis-clarity (out-of-scope for this ADR amendment).

#### Recorded dissents

- **Queen's mild dissent** (recorded in her amended synthesis): *"Option F is a fork-divergence from upstream-stated direction (ADR-029 + ADR-007). Defensible per Upstream's 'we are AHEAD of upstream' finding, but the divergence should be named explicitly in the ADR."* — **This dissent is partially overstated**: per finding #6 above, Option F honors ADR-029's "MUST use RVF for vector data" via the virtual table embedding RuVector HNSW. ADR-029 names agentdb's baseline as "Custom HNSW + JSON", not SQLite, and its migration target is "RVF with RVText profile" for vector data, not relational-replacement. Option F satisfies that mandate. Queen's dissent is honored by naming it here; the council acknowledges Option F is an interpretive composition over ADR-029, but not a divergence from its binding text.

- **Storage vs Controllers table-count**: Storage counted 24 tables (16 schema.sql + 8 frontier-schema.sql); Controllers revised to 19 tables across 14 controllers. Resolved: **≥19 tables, exact count to be confirmed during Phase 3 (Option F) implementation** since each controller migrates independently and the count matters only per-controller.

- **WITH RECURSIVE replacement** (Retrieval vs Controllers): under Option F this dissent is moot — `CausalMemoryGraph` and `CausalRecall` stay on SQLite permanently (PERMANENT_SQLITE_CARVE_OUT bucket); their `WITH RECURSIVE` queries are preserved literally. No replacement needed.

#### Net effect on outcome

The ADR's direction reverses: Phase 3 (RuVector-primary substrate flip) is retired; Option F (sqlite-vec virtual table augmentation) replaces it. Phase 1, Phase 1.5, and Phase 2 remain shippable as defined in Amendment 2026-05-11c, with Phase 2's `primaryStorage?` field semantics restricted to `'sqlite'` opt-in only (`'ruvector'` no longer a meaningful value under Option F).

The dialectic produced new architectural facts (REDB-quadruplication, upstream-cadence NULL, 5 PERMANENT carve-outs, no user-facing Phase 3 motive) that materially refute the Phase 3 plan. The council's reversal is technically grounded, not fashion-driven. Per `feedback-no-value-judgements-on-features`, parallel-track ADR-007 Phase 1 capability adoption ships regardless — we wire all upstream capability without conflating substrate question with capability question.

#### Reopen triggers

If Option F's permanence is ever questioned, a NEW ADR (not a resumption of ADR-0166) handles the reopen. Triggers:

1. Upstream removes the `agentdb-mcp-server.ts:247` defang in `ruvnet/agentdb` standalone — would signal upstream chose to incur the engineering work we declined.
2. `@ruvector/graph-node` ships Cypher WHERE evaluator + variable-length paths + multi-record ACID + FTS at Tier 1 NAPI maturity — would close the binding gaps that motivate Option F.
3. A concrete user-facing capability emerges that Option F cannot host — currently zero such cases identified.

#### What this amendment does NOT do

- Does not execute Phase 1's wire-only code change. That remains opt-in next-step work (~50 LoC at `core/AgentDB.ts:175` + docstring + memory cross-ref + contract test).
- Does not author the proposed sqlite-vec extension package `@sparkleideas/ruvector-sqlite-vec-node`. That's separate substrate-side scope.
- Does not modify `project-rvf-primary.md` memory entry. Axis-clarity update is a separate edit.
- Does not shut down the `adr0166-vision-council` Agent Teams council. Eight personas remain spawned and idle; manual shutdown_request needed when the council's work is fully consumed.
