---
status: superseded
date: 2026-05-11
tags: [agentdb, postgres, pglite, ruvector, graph-node, substrate-replacement, fork-divergence]
supersedes: [ADR-0166]
superseded-by: [ADR-0177]
depends-on: [ADR-0073]
implements: []
---

# AgentDB substrate replacement — PostgreSQL primary (pglite embedded, postgres server); retire SQLite

## Status

**Superseded by ADR-0177 (2026-05-12).** The postgres substrate landed (Phases A.2 + B Wave 1a + C.1 + D step 5 on archive branch `pre-adr-0177-reset-2026-05-12`) and was reverted on `bd760f2` (2026-05-12) per ADR-0177's RVF-first single-node-fork decision. SQLite is restored as the `agentdb_*` primary; vectors mirror to RVF-backed sqlite-vec virtual tables per ADR-0166 Option F. The `PostgresBackend.ts` + `migrate-sqlite-to-pglite.ts` files survive as `@deprecated` museum scaffolding (forks/agentdb commit `4f1626d`) for a possible future `@ruvector` PG extension hook (ADR-0177 Open Follow-up #5). DO NOT wire either back without a new ADR.

~~**Proposed (2026-05-11) — fork-leading substrate-replacement decision.**~~

~~Supersedes ADR-0166's "SQLite primary, permanently" stance for the `agentdb_*` axis. PostgreSQL becomes the sole supported relational substrate going forward; SQLite is retired. The `memory_*` axis (RVF primary per ADR-0073) is unchanged.~~

This is a deliberate, fork-initiated divergence from upstream. Standalone `ruvnet/agentdb@3.0.0-alpha.14` (updated 2026-05-11) ships on SQLite via `better-sqlite3`, and zero of its 9 published ADRs (002–010) propose PostgreSQL. The fork chooses this substrate on technical merits — not because upstream is going there. See §"Relationship to upstream agentdb" below.

## Context and Problem Statement

ADR-0166 settled the agentdb persistence question by framing the choice as "SQLite primary (current) vs RuVector substrate flip (retired)" and converging on Option F — `sqlite-vec` virtual table augmentation inside SQLite. The 8-persona dialectic council never considered PostgreSQL.

Three findings, taken together, reopen the question:

1. **The Option F mirrors we shipped are structurally inert.** Five controllers (HierarchicalMemory, ReflexionMemory, SkillLibrary, ReasoningBank, LearningSystem) now write to vec0 virtual tables on every store. **No recall path reads from them.** ADR-0166 §"What this actually buys today" framed this honestly at ship time: vec0 is "wired but inert pending a reader". The reader did not materialize, and on reflection the gap is design-level, not effort-level: an efficient reader needs the relational query planner to use the vector index as part of `WHERE … ORDER BY embedding <-> ? LIMIT k` plans. `sqlite-vec` exposes a virtual table you JOIN against; the planner doesn't natively know about its ordering. `pgvector` on PostgreSQL exposes vectors as a first-class column type with HNSW/IVFFlat indexes the planner uses directly. The substrate choice — not just the library choice — determines whether the reader pattern composes.

2. **The 5 PERMANENT_SQLITE_CARVE_OUT controllers don't actually need SQLite — they need SQL.** ADR-0166 named those controllers as needing `WITH RECURSIVE`, FK CASCADE, `GROUP BY HAVING`, multi-record ACID, FTS. PostgreSQL is a strict superset on every one of those features (and a meaningful upgrade on several: tsvector FTS, MVCC multi-writer concurrency, richer planner). The carve-out is real; the substrate isn't load-bearing.

3. **The "SQLite is embedded; postgres requires a server" objection is obsoleted by pglite.** `@electric-sql/pglite@0.4.5` is a WASM build of PostgreSQL 15: runs in-process (Node, browser, edge), persists to a single file or IndexedDB. Drop-in for SQLite's portability story while speaking real postgres SQL — same dialect, same migrations, same client code as a real `postgres://…` server. The embedded-default story is preserved without language or dialect fork.

ADR-0166's option list was filtered too narrowly — the council considered "SQLite vs RuVector substrate flip" but not "SQL substrate replacement". The question this ADR settles: **make PostgreSQL (pglite embedded + server `postgres://…`) the sole relational substrate for the `agentdb_*` axis; retire SQLite + Option F.**

## Decision Drivers

The drivers are technical, fork-internal, and stand on their own merits — none is "upstream said so".

* **SQL-feature fit, not SQLite fit.** The 5 PERMANENT_SQLITE_CARVE_OUT controllers need `WITH RECURSIVE`, FK CASCADE, `GROUP BY HAVING`, multi-record ACID, FTS. PostgreSQL is a strict superset of SQLite on every one of those, and a strict upgrade on FTS (tsvector — Lucene-grade ranking, multilingual stemming, weight classes) and concurrency (MVCC multi-writer vs SQLite's single-writer lock).
* **Native vector ops without the vec0 hack.** `pgvector` exposes vectors as first-class column types with HNSW/IVFFlat indexes the relational query planner uses directly. `SELECT … WHERE tier = 'working' ORDER BY embedding <-> ? LIMIT 10` becomes a single plan. The Option F design pattern (mirror writes into a vec0 virtual table you JOIN against) becomes structurally unnecessary, not just unimplemented.
* **`feedback-data-loss-zero-tolerance` is satisfied at the substrate.** PostgreSQL's MVCC handles multi-writer concurrency natively. The cross-process coordination work (ADR-0167 Phase 2's writer-coordinator pattern, RVF-side) does not need a parallel implementation on the agentdb_* axis — postgres ships with it.
* **pglite preserves the embedded story.** `@electric-sql/pglite@0.4.5` is WASM postgres 15: in-process, single-file persist, no server required. The embedded use cases SQLite supports today translate 1:1 without a dialect fork — same SQL runs against pglite and a real `postgres://…` server.
* **`@ruvector/postgres-cli` is a real package the fork can consume.** Per `feedback-no-value-judgements-on-features` ("wire all upstream capability") — 46 files, CLI + client + 11 command modules (`attention.js`, `benchmark.js`, `gnn.js`, `graph.js`, `hyperbolic.js`, `quantization.js`, `routing.js`, `sparse.js`, `vector.js`). It exists; it's published; the fork can adopt it without waiting on anyone.
* **Sunk-cost honesty.** Option F's vec0 mirror work shipped 2026-05-11 across patches 44–48. The Phase 1 + 1.5 + 2 wiring fixes were substrate-agnostic correctness work and survive. The Phase 3 vec0 mirror writes specifically don't — they're tied to the SQLite design. Acknowledging this directly is better than pretending the substrate is still right.

## Considered Options

* **Option A** — Stay on ADR-0166 Option F. Continue extending sqlite-vec mirrors to remaining controllers; accept that vec0 mirrors are structurally inert and design a non-planner reader on top.
* **Option B** — Adopt postgres as a SIBLING of SQLite. Both `primaryStorage` values valid; user picks. (This was the ADR-0170 draft committed at `64e7333` before this revision.)
* **Option C** — Replace SQLite with PostgreSQL entirely. pglite for embedded/CLI/edge; real postgres for server/production. **Single substrate, single test matrix, single integration story.**
* **Option D** — Defer the substrate question; wait to see whether `ruvnet/agentdb` itself moves off SQLite (no current signal it will — see §"Relationship to upstream agentdb").

## Decision Outcome

Chosen: **Option C — PostgreSQL is the sole relational substrate for the `agentdb_*` axis. pglite handles the embedded/portable case; `postgres://...` handles server/production. SQLite is retired.**

Rationale:

1. **Single substrate halves the integration matrix.** Option B's "sibling" framing would create two persistence lanes (sqlite + postgres) with two acceptance test matrices, two failure modes, two migration stories. Option C collapses to one.
2. **pglite eliminates the "postgres requires a server" objection.** It IS PostgreSQL (literally WASM-built postgres 15), runs in-process, persists to disk or IndexedDB. Every embedded use case SQLite supports today, pglite supports tomorrow — with strict SQL feature superset.
3. **Native vector ops via pgvector + `@ruvector/postgres-cli`** integrate with the query planner. No vec0 mirror needed. The Option F design becomes unnecessary on this substrate.
4. **The 5 PERMANENT_SQLITE_CARVE_OUT controllers run unchanged.** Their requirements were SQL-feature requirements, not SQLite-specific. PostgreSQL satisfies every one (and improves several — tsvector FTS, multi-writer MVCC).
5. **The fork can act unilaterally on technical merits.** `@ruvector/postgres-cli@0.2.8` and `@electric-sql/pglite@0.4.5` are real, published, maintained packages. Adopting them is not gated on upstream's plans. The fork has chosen, before, to wire surfaces upstream hasn't (see `feedback-no-value-judgements-on-features`); this is the same posture applied to the substrate.

### What this means for ADR-0166

ADR-0166's amendments (through 2026-05-11f) settled on Option F (sqlite-vec mirrors) as the agentdb_* persistence shape, with vec0 wired but inert pending a reader. This ADR retires that assumption on technical merits — the inertness is design-level (the SQLite query planner doesn't natively use vec0 ordering for `ORDER BY embedding <-> ?`), not effort-level. The retirement is fork-internal; upstream is not retiring SQLite (see §"Relationship to upstream agentdb").

ADR-0166 is therefore **partially superseded for the `agentdb_*` axis**:

- Phase 1 (wire `vectorBackend` field): **survives** — it was a correctness fix, applies on any substrate.
- Phase 1.5 (delete dead `graphBackend` param): **survives** — pure cleanup, applies on any substrate.
- Phase 2 (split `vectorBackend` into `vectorIndex` + `primaryStorage`): **survives** — the orthogonal axes framing is still right; this ADR **replaces** the `primaryStorage` union from `'sqlite'` to `'pglite' | 'postgres'` (the `'sqlite'` value is removed outright per §"No-fallback policy", not kept alongside during transition) and reframes `vectorIndex` to add `'pgvector'` and `'postgres-cli'` (with `'ruvector'` and `'hnswlib'` retiring per §"Implementation pre-flight").
- Phase 3 (Option F, sqlite-vec mirrors): **superseded on technical merits.** The vec0 mirror writes shipped in patches 46-48 against the SQLite-substrate assumption; with the substrate retiring, the mirrors become obsolete. They stay in the code for now (harmless), but no new wiring extends them, and Phase D removes them.
- The axis-separation rule (memory_* RVF, agentdb_* SQL) **survives, with SQL = PostgreSQL** rather than SQLite.

### What this means for `memory_*` axis

**Unchanged.** RVF-primary stays per ADR-0073. ADR-0167/0168 cross-process coordination work continues for `memory_*`. The `.swarm/memory.rvf` file is still the canonical store for memory_* operations. This ADR addresses the `agentdb_*` axis only.

### No-fallback policy (load-bearing)

**Per `feedback-no-fallbacks` and the user-binding directive 2026-05-11 ("no automatic fallback — postgres, or fail fast, fail loud"):**

- **No runtime fallback between substrates.** PostgreSQL (pglite-embedded or `postgres://` server) is the sole runtime persistence option. If postgres is unreachable, AgentDB throws at boot — never silently downgrades to SQLite or anything else.
- **No `'sqlite'` value in `primaryStorage`** going forward. The Phase 2 union widens from `'sqlite'` to `'pglite' | 'postgres'` (sqlite is removed, not deprecated alongside).
- **No silent dep-import fallback.** If `pglite` or `@ruvector/postgres-cli` cannot be loaded at boot, AgentDB throws with a diagnostic message naming the missing package — does not fall through to sql.js or better-sqlite3.
- **No "transition fallback"** during the controller-port phase. Each Phase B commit dead-strips the SQLite path for its controller atomically. There is no in-flight state where a controller silently routes to SQLite if postgres fails — the controller either runs on postgres or throws.
- **No automatic data migration.** Existing `.swarm/memory.db` files don't auto-import. Users with legacy state run the one-shot `agentdb migrate --from sqlite --to pglite` CLI (Phase D) explicitly. Boot against a `.db` file with `primaryStorage: 'pglite'` throws "incompatible legacy database — run `agentdb migrate`".

This is a strict reading of `feedback-no-fallbacks`. Any softening (cascade, graceful degradation, auto-import) reopens the substrate decision via a new ADR.

### Implementation pre-flight (decisions named upfront so Phase A doesn't stall on them)

Each item below is a decision made now so phase execution doesn't have to re-litigate it mid-stream. None of these is in-scope for renegotiation during Phase A; if a decision turns out wrong it's a follow-up ADR.

1. **`vectorIndex: 'ruvector'` and `vectorIndex: 'hnswlib'` are retired.** In the postgres world, vectors are first-class column types indexed by pgvector inside the relational table — there is no separate in-memory HNSW axis to select. The valid `vectorIndex` values become `'auto' | 'pgvector' | 'postgres-cli' | 'sqlite-vec'`-retired. Phase A wires both `'ruvector'` and `'hnswlib'` to throw a clear loud error pointing users to `'pgvector'` or `'auto'`. No deprecation period — the values are loud-rejected immediately per `feedback-no-fallbacks`.

2. **`forks/agentdb/src/db-unified.ts` is retired in Phase A.** The "graph mode vs sqlite-legacy" framing collapses under a single postgres substrate. Phase A deletes the file and updates `core/AgentDB.ts` to instantiate `PostgresBackend` directly. The standalone `agentdb-mcp-server.ts` (which uses `createUnifiedDatabase` at line 243) is rewritten in Phase A to open `PostgresBackend` directly — same shape as ADR-0166 Phase 3's `agentdb-mcp-server.ts:247` defang removal, just routed to postgres instead of sqlite-vec.

3. **Browser/edge entry points adopt pglite-IndexedDB in Phase A.** pglite supports IndexedDB-backed storage in browser. The browser bundle (`browser-entry.js`, `dist/` browser build) routes to pglite-IndexedDB. If pglite cannot initialize in a target browser, boot throws loudly — no fallback to sql.js, no fallback to in-memory-only. Per `feedback-no-fallbacks`, browser users get the same fail-loud contract as Node users.

4. **Existing `tests/adr0166-*.test.ts` are rewritten or deleted in Phase D.** The Phase 3 contract tests assert vec0 virtual tables and Option F mirror writes — both retire when SQLite retires. Phase D either deletes those tests (`adr0166-phase3-optionf-virtual-tables.test.ts`, `adr0166-phase3-controller-wiring.test.ts`) or rewrites them to assert the postgres-native contracts (pgvector HNSW indexes exist; controllers write to the right tables). The Phase 1 + 1.5 + 2 tests survive substrate-agnostically.

5. **Ruflo + agentic-flow call-site audit in Phase A.** The fork has ~9 call sites that pass `vectorBackend` (legacy) through to AgentDB. Phase A enumerates and updates them as part of the substrate plumbing PR, not as a follow-up. Files to audit and update:
   - `forks/ruflo/v3/@claude-flow/memory/src/agentdb-backend.ts` (lines 92, 124, 303)
   - `forks/ruflo/v3/@claude-flow/memory/src/controller-registry.ts` (multiple sites; the comments documenting agentdb constructor signatures need refreshing too)
   - `forks/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts:561` (currently sets `vectorBackend: 'ruvector'`; becomes `vectorIndex: 'pgvector'` or `'auto'`)
   - `forks/ruflo/v3/@claude-flow/cli/src/init/types.ts:247`, `init/settings-generator.ts:132` (init template)
   - `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts:1091` (controller resolver)
   - `forks/ruflo/v3/@claude-flow/neural/src/reasoning-bank.ts:219`
   - `forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts` (HierarchicalMemory + MemoryConsolidation construction)

### Phased plan

**Phase A — substrate plumbing + fail-loud gates (no in-flight fallback).**

1. Add `@ruvector/postgres-cli@0.2.8+`, `@electric-sql/pglite@0.4.5+`, and `pg@^8.11.0` to `forks/agentdb/package.json` as required deps. **Boot-gate enforcement is staged**: in Phase A the deps must IMPORT successfully (their absence at install time throws); the strict "pglite or `postgres://` connection or throw" runtime check activates with Phase B's first controller commit. This avoids the in-between state where the boot gate refuses to start AgentDB even though every controller is still using SQLite. Phase A introduces the postgres substrate; Phase B's first controller commit (HierarchicalMemory port) is what flips the boot gate to strict.
2. New backend: `forks/agentdb/src/backends/postgres/PostgresBackend.ts` implementing the `VectorBackend` interface. Two connection modes:
   - **Embedded (pglite)**: default when no `connectionString` is set. Persists to `.swarm/memory.pglite/`. Boot throws loudly if pglite import fails (no fallback to sqlite).
   - **Server (`postgres://...`)**: when `connectionString` is set via `AGENTDB_POSTGRES_URL` env or `AgentDBConfig.connectionString`. Boot throws loudly if connection fails (no fallback to pglite, no fallback to sqlite).
3. Wire into `backends/factory.ts`: `createBackend('postgres', config)` → `new PostgresBackend(config)`. The factory's `'auto'` cascade is **removed for the relational substrate axis** — `primaryStorage` has no auto-cascade. Only `vectorIndex` retains 'auto' (it picks pgvector when available, throws loudly when not).
4. Replace `AgentDBConfig.primaryStorage` union: `'sqlite'` → `'pglite' | 'postgres'` (default `'pglite'`). The `'sqlite'` value is REMOVED, not deprecated. Add `connectionString?: string` config field (server mode opt-in).
5. Schema port: rewrite `schemas/schema.sql` + `schemas/frontier-schema.sql` to PostgreSQL dialect. Differences: `INTEGER PRIMARY KEY AUTOINCREMENT` → `BIGSERIAL PRIMARY KEY`, `INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))` → `BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT`, `BLOB` → `BYTEA`, FTS5 virtual tables → `tsvector` columns + GIN indexes.
6. **Fail-loud gates** added at boot:
   - `if (!pglite && !connectionString) throw new Error("Cannot initialize AgentDB: pglite unavailable and no connectionString provided")`.
   - `if (connectionString && !canReachPostgres(connectionString)) throw new Error("Cannot reach postgres at ${connectionString}")`.
   - `if (legacy .db file detected) throw new Error("Legacy SQLite database detected. Run 'agentdb migrate --from sqlite --to pglite'. No auto-migration.")`.
   - Any of these errors is FATAL — never caught-and-degraded.
7. **`PostgresBackend.dataDir` resolution rule** (per 2026-05-11 cold-start profiling, resolution `/tmp/adr0170-resolution-I.md`): if `connectionString` set → server mode, no dataDir; else if `config.dataDir` set explicitly → use verbatim; else default to `${projectRoot}/.swarm/memory.pglite/`. This ensures repeated CLI invocations in the same project dir hit the **warm-reopen path (~94 ms)** instead of cold-init (~673 ms).
8. **Harness gate** in `scripts/test-acceptance.sh:337` (after `_record_phase "harness-init"`): assert `${ACCEPT_TEMP}/.swarm/memory.pglite/PG_VERSION` exists. `cp -r` propagation to `$E2E_DIR` at line 346 inherits the warm cluster automatically — every downstream isolated check pays the 94 ms warm-reopen cost, never the 673 ms cold cost. **No changes to `_run_and_kill_ro` budgets** (default 8s, max 60s) — pglite cold-start at 673 ms is 11×–88× under every existing budget.

**Phase B — controller port (one controller at a time, each its own commit + acceptance run).**

Each Phase B commit also **dead-strips the `@ruvector/graph-node` Cypher branch** for its controller in the same atomic commit (per resolution `/tmp/adr0170-resolution-J.md`, 2026-05-11): every Cypher query the fork actually executes has a clean postgres SQL equivalent (verified call-site by call-site); `enableGraph: false` is the de facto default in ruflo deployments; the Cypher WHERE evaluator is admittedly incomplete at `GraphDatabaseAdapter.ts:246`; choosing graph-node over postgres' planner is a regression. The Phase B dead-strip removes the graph-node code paths from `CausalMemoryGraph`, `ReflexionMemory`, and `SkillLibrary` atomically with the SQL port for each controller. Hyperedges (`createHyperedge`, `searchHyperedges`) are aspirational with zero in-fork call sites — they retire with graph-node.

Per ADR-0166 Phase 3's incremental pattern, port each SQL-bearing controller's SQL to the postgres dialect. The list below is the **complete set of SQL-bearing controllers in `forks/agentdb/src/controllers/`**, derived from a `grep -E "this.db.(prepare|exec|run)|CREATE TABLE|INSERT INTO|SELECT.*FROM"` audit on 2026-05-11:

1. HierarchicalMemory (TRIVIAL — 19 SQL lines, fork-only; schema port)
2. MemoryConsolidation (TRIVIAL — 13 SQL lines, fork-only; schema port)
3. ReflexionMemory (MODERATE — 28 SQL lines; `episode_embeddings` BYTEA + pgvector column variant)
4. SkillLibrary (MODERATE — 28 SQL lines; same)
5. ReasoningBank (MODERATE — 24 SQL lines; verify GROUP BY queries on postgres)
6. ExplainableRecall (MODERATE — 26 SQL lines; `recall_certificates` schema port + tsvector for query_text)
7. LearningSystem (HARD — 51 SQL lines; RL aggregations over `learning_state_embeddings`; verify GROUP BY semantics)
8. CausalMemoryGraph (HARDEST — 29 SQL lines; `WITH RECURSIVE` 5-hop traversal — postgres syntax differs from sqlite slightly)
9. CausalRecall (HARD — 7 SQL lines; JOIN + ORDER BY rerank)
10. NightlyLearner (HARD — 26 SQL lines; cross-product self-JOIN + GROUP BY + HAVING)
11. SyncCoordinator (MODERATE — 9 SQL lines; owns its own `sync_state` table + reads `episodes`/`skills`/`skill_edges` from other controllers; sync-protocol; dialect port + cross-table reads)
12. QUICServer (TRIVIAL — 6 SQL lines, all read-only `SELECT * FROM (episodes|skills|skill_edges)`; dialect-correctness check only; no schema of its own)
13. HNSWIndex (TRIVIAL — 1 SQL line; existence guard `SELECT 1 FROM pattern_embeddings`; internal helper)

**Connection-aware updates only (no SQL dialect changes needed):**

- EmbeddingService, EnhancedEmbeddingService — 0 SQL lines each; need to receive the postgres-backed `db` handle through the existing constructor pipe, no schema work.

**Out of Phase B (zero SQL state, no port needed):**

AttentionService, ContextSynthesizer, MemoryController, MetadataFilter, MincutService, MMRDiversityRanker, QUICClient, QUICConnection, QUICConnectionPool, QUICStreamManager, SparsificationService, StreamingEmbeddingService, WASMVectorSearch — all pure compute / transport / utility with no `this.db.*` calls.

Each Phase B commit also flips its acceptance check to run against pglite (default test env) **and dead-strips the SQLite code path for that controller in the same commit**. After all 13 land, the SQLite code is fully unreachable from any controller. Phase D becomes a confirmation pass (`grep -r 'better-sqlite3\|sql.js\|sqlite-vec' src/` returns zero hits in controller code), not a removal pass.

**Phase C — vector ops integration.**

1. Integrate `pgvector` extension for `pglite` (pglite supports postgres extensions) and real postgres.
2. Switch HNSW indexing from in-memory `RuVectorBackend` to pgvector HNSW indexes on the `embedding` column. Controllers don't need the `vectorBackend.insert(...)` parallel write any more — vectors live in the same row as their metadata.
3. Wire `@ruvector/postgres-cli` for the higher-level features it exposes (53+ SQL functions, 39 attention mechanisms per upstream docs). Audit which are actually useful for the fork.
4. Acceptance tests cover the postgres-native `SELECT ... ORDER BY embedding <-> ?` k-NN path.
5. **Performance benchmark gate** (per resolution `/tmp/adr0170-resolution-H-K.md`). Add `tests/benchmarks/adr0170-pglite-vs-sqlite.mjs` driving 200 `memory store` + 50 `memory search` ops via the real `ruflo` CLI against a representative corpus. Capture three metrics: total wall-clock, store/search p50+p95, RSS peak (`/usr/bin/time -l` on macOS, `time -v` on Linux). Phase C exits only when pglite is **within 10%** of the SQLite baseline on every metric — explicitly **not** "10x faster" (upstream's claim, not ours). If pglite is slower by >10% on any metric, root-cause fix the regression; never widen the band per `feedback-no-squelch-tests`. Sample-size justification for the 10% band documented in the resolution doc.
6. **Baseline capture**, done once on Phase A HEAD before Phase B begins: cherry-pick the Phase A merge SHA, run `tests/benchmarks/adr0170-pglite-vs-sqlite.mjs --substrate sqlite`, commit the resulting JSON to `tests/benchmarks/baselines/adr0170-sqlite-baseline.json` with `acceptance_run_id` tying it to the last green acceptance run before Phase B starts. Results from each Phase C+ run go to `test-results/benchmarks/adr0170-<utc-stamp>.json` mirroring the `test-results/accept-<utc-stamp>/` pattern.

**Phase D — confirmation + orphan removal (NOT a fallback removal — Phase B already did that atomically).**

1. Confirm Phase B fully dead-stripped SQLite + graph-node from every controller: `grep -r 'better-sqlite3\|sql.js\|sqlite-vec\|sqljs\|hmem_vec\|reflexion_episode_vec\|skill_vec\|reasoning_pattern_vec\|learning_vec\|@ruvector/graph-node\|graphAdapter' forks/agentdb/src/controllers/` returns zero hits. Otherwise the rollout was incomplete; loop back.
2. Delete now-orphaned deps from `forks/agentdb/package.json`: `better-sqlite3`, `sql.js`, `hnswlib-node`, `sqlite-vec`, **`@ruvector/graph-node`** (added per resolution J — graph-node retires under postgres). Update lockfile.
3. Delete the now-orphaned source: `forks/agentdb/src/backends/hnswlib/`, `forks/agentdb/src/db-fallback.ts`, **`forks/agentdb/src/backends/graph/GraphDatabaseAdapter.ts`** (graph-node retirement), the sqlite-vec extension loader from `AgentDB.ts`, the `createOptionFVirtualTables` method, the Option F mirror writes from the 5 wired controllers (these are already dead per Phase B but the dead-code lines remain in the diff for review-clarity; Phase D removes the lines).
4. Reroute the `vectorIndex: 'hnswlib'` config value: throw a clear error pointing users to `'pgvector'` or `'auto'`. Same treatment for `enableGraph` — remove the field from `AgentDBConfig` entirely; passing it raises a typed error pointing to `WITH RECURSIVE` + `pgvector` as replacements.
5. **Add the one-shot CLI: `agentdb migrate --from sqlite --to pglite <path>`** (per resolution `/tmp/adr0170-resolution-H-K.md`). Idempotent-with-loud-refuse — refuses on existing non-empty target unless its manifest shows `IN_PROGRESS` (resume) or `COMPLETE` (exit 0 with "already migrated"). Per-table checkpoint manifest at `<target>/.pglite/.migration-manifest.json` with `source_sha256` for mid-flight source-change detection. Preflight: refuses if `PRAGMA user_version` outside known-good set, or if expected agentdb controller tables are missing. Conversion rules: `INTEGER PRIMARY KEY AUTOINCREMENT` → `BIGSERIAL` with `OVERRIDING SYSTEM VALUE` + `setval()` once per table after bulk insert (FK preservation); `BLOB` → `BYTEA` byte-for-byte; FTS5 → `tsvector GENERATED ALWAYS AS … STORED` + GIN. Contract test at `tests/acceptance/adr0170-migration-roundtrip.test.mjs` asserts row count parity, ID preservation, sequence next-value correctness, BYTEA byte-fidelity, FK integrity, FTS roundtrip with **exact result-set equality** (per `feedback-no-squelch-tests` — never relax to "approximately similar"), idempotent re-run, resume-after-kill, BYTEA corruption negative path.
6. Update memory `project-rvf-primary.md` to reflect the new agentdb_* substrate (postgres-only).
7. Mark ADR-0166's Option F as fully superseded (status → `superseded by ADR-0170`). At the same time, flip ADR-0170's frontmatter: add `supersedes: [ADR-0166]` and remove ADR-0166 from `depends-on:` to satisfy the indexer's directed-edge requirement (per resolution `/tmp/adr0170-resolution-L-M.md`).

### Multi-agent execution plan

Each phase below can run as a coordinated agent swarm to compress wall-clock time. The plan respects three hard constraints: (1) **one release-pipeline runner at a time** (the fork's pipeline holds a flock per `feedback-build-scripts-only` + `reference-pipeline-publish-paths`); (2) **each commit on `forks/agentdb` main must keep the full acceptance suite green** per `feedback-fix-all-tests`; (3) **no silent fallback** between substrates per the §"No-fallback policy" above. Parallelism happens on *patch preparation*; serialization happens on *merge + release*.

#### Pre-flight (sequential, single agent)

1. **Baseline capture agent** — runs `tests/benchmarks/adr0170-pglite-vs-sqlite.mjs --substrate sqlite` on the last green acceptance run before Phase B starts (e.g., `accept-2026-05-11T173048Z`). Commits the result to `tests/benchmarks/baselines/adr0170-sqlite-baseline.json`. Phase A's merge commit references this baseline.

#### Phase A — single coordinator agent

Phase A is not parallelizable: schema port, factory wiring, fail-loud gates, and the dataDir resolution all touch the same files. One agent (`backend-dev` or `adr-architect` subagent_type) executes Phase A linearly. Commits at the boundary of each item-numbered step. Release at the end of Phase A.

#### Phase B — Wave 1a (9 parallel agents, then Wave 1b, then merge)

The 13 SQL-bearing controllers split into two waves by dependency.

**Wave 1a (parallel, 9 independent agents)** — controllers that don't read from other controllers' tables. Each agent owns one controller, ports the SQL dialect, dead-strips the SQLite path, dead-strips the `@ruvector/graph-node` Cypher branch where applicable, runs `npm run test:unit` locally for fast feedback, prepares a patch (does **not** run `npm run release`).

| Agent | Controller | SQL lines | Graph-node branch to strip? |
|---|---|---|---|
| B-1 | HierarchicalMemory | 19 | no |
| B-2 | ReflexionMemory | 28 | yes (lines 347-350, 418-428, 986-1067 per resolution J) |
| B-3 | SkillLibrary | 28 | yes (lines 172-196, 316-321 per resolution J) |
| B-4 | ReasoningBank | 24 | no |
| B-5 | ExplainableRecall | 26 | no |
| B-6 | LearningSystem | 51 | no |
| B-7 | CausalMemoryGraph | 29 | yes (lines 227-260 per resolution J) |
| B-8 | NightlyLearner | 26 | no |
| B-9 | EmbeddingService + EnhancedEmbeddingService (bundled, no SQL) | 0 | no — connection-aware updates only |

**Wave 1b (parallel, 5 dependent agents)** — controllers that read from Wave 1a's ported tables. Run only after Wave 1a merges.

| Agent | Controller | Depends on Wave 1a | Notes |
|---|---|---|---|
| B-10 | MemoryConsolidation | HM | Reads HM's `hierarchical_memory` table |
| B-11 | CausalRecall | CausalMemoryGraph | Joins `causal_edges` (CMG's table) |
| B-12 | SyncCoordinator | Reflexion + Skills | Reads `episodes`, `skills`, `skill_edges` cross-table |
| B-13 | QUICServer | Reflexion + Skills | Read-only `SELECT * FROM (episodes\|skills\|skill_edges)` |
| B-14 | HNSWIndex | ReasoningBank | Existence guard `SELECT 1 FROM pattern_embeddings` |

**Coordinator agent (single, runs Phase B merge + release loop):**

1. Wait for each Wave 1a agent to signal patch-ready. Pull each patch, run a fast local sanity check (`npm run test:unit`), merge to `forks/agentdb` main in topological order. Resolve merge conflicts (rare — controllers are file-disjoint).
2. After Wave 1a's 9 commits land on main, run `npm run release` **once** for the wave. The wave must pass 674/674 acceptance; any failure halts the wave and the failing controller's commit is reverted + revised.
3. Repeat for Wave 1b.
4. Wave 1a + 1b together = 14 commits, 2 release cycles. Each release runs the full acceptance suite against pglite (default).

**Why per-wave release, not per-commit:** the fork's pipeline takes ~7 min per release. 14 commits × 7 min = 98 min of release time if serialized per-commit. Per-wave is 14 min total. Per-commit acceptance is overkill when controllers are file-disjoint and unit tests catch most regressions.

**Why not per-controller release:** the fork's flock prevents concurrent releases; per-commit serialization wastes wall-clock without earning signal.

#### Phase C — 2 sequential agents

1. **pgvector integration agent** (`backend-dev` subagent_type) — adds pgvector HNSW indexes to ported tables; switches controllers from `vectorBackend.insert(...)` parallel-writes to single-row INSERTs with pgvector columns; rewrites k-NN paths to `ORDER BY embedding <-> ?`. Commits per controller. One release at the end of pgvector integration.
2. **Benchmark agent** (`Benchmark Suite` subagent_type) — runs `tests/benchmarks/adr0170-pglite-vs-sqlite.mjs` against the post-Phase-C build. Compares to baseline. **Halts on >10% regression on any metric** per `feedback-no-squelch-tests`. Commits result to `test-results/benchmarks/`. This commit is Phase C's exit gate.

#### Phase D — single coordinator agent

Phase D is mostly mechanical (greps + deletions + frontmatter flips); not parallelizable. One agent (`adr-architect`):

1. Grep-confirms zero SQLite + graph-node references in `forks/agentdb/src/controllers/`. If non-zero, halt and report the offending controllers — Phase B was incomplete.
2. Deletes orphaned deps from `package.json`. Updates lockfile.
3. Deletes orphaned source: `backends/hnswlib/`, `db-fallback.ts`, `backends/graph/GraphDatabaseAdapter.ts`, Option F mirror code, sqlite-vec extension loader, `createOptionFVirtualTables`, `enableGraph` config field.
4. Builds the `agentdb migrate --from sqlite --to pglite` CLI per gap-H spec. Contract test at `tests/acceptance/adr0170-migration-roundtrip.test.mjs` must pass before the CLI ships.
5. Updates memory `project-rvf-primary.md` to reflect the new agentdb_* substrate (postgres-only).
6. Flips frontmatter: ADR-0166 status → `superseded`; ADR-0170 frontmatter adds `supersedes: [ADR-0166]` and removes ADR-0166 from `depends-on:`.
7. Final release: full acceptance suite must pass 674/674 with CI restricted to pglite-only paths.

#### Wall-clock estimate (release cycles, not total time)

The fork's release pipeline takes ~7 min; the rest of the work parallelizes inside agent prep time. Conservative cycle count, not minute count, to avoid `feedback-no-time-estimates` violation:

| Phase | Release cycles | Coordination shape |
|---|---|---|
| Pre-flight (baseline) | 0 (no source change; baseline captured at HEAD) | 1 agent |
| Phase A | 1 | 1 agent linear |
| Phase B Wave 1a | 1 | 9 parallel + 1 coordinator |
| Phase B Wave 1b | 1 | 5 parallel + 1 coordinator |
| Phase C | 1 (pgvector) + 1 (benchmark exit gate) | 2 agents sequential |
| Phase D | 1 | 1 agent linear |
| **Total** | **6 release cycles** | up to **9 agents in parallel** at Wave 1a peak |

If any wave fails its acceptance gate, the coordinator reverts the failing commit + cycles back to the responsible agent for revision. The 6-cycle estimate assumes Wave 1a, 1b, C-pgvector, and C-benchmark each pass first time.

#### Spawning the swarm

When ready to execute (not yet — this is plan, not action), the swarm is launched via parallel `Agent` calls in a single message:

```
Agent (subagent_type="backend-dev", run_in_background=true) — Phase A coordinator
Agent (subagent_type="backend-dev", run_in_background=true) — Phase B-1 HierarchicalMemory
… (8 more for Wave 1a)
```

Each agent gets a self-contained brief naming its controller, its dependencies (none for Wave 1a), its exit criteria (commit ready + unit tests green), and its non-action constraint (does not run `npm run release` — the coordinator does).

The coordinator agent's brief includes the topological merge order, the release-after-wave rule, and the revert-on-failure protocol.

### Out of scope

1. **`memory_*` axis changes.** RVF stays primary for memory_*; this ADR addresses agentdb_* only.
2. **Migration of existing user `.swarm/memory.db` files.** A one-shot `agentdb migrate --from sqlite --to pglite` CLI lives in Phase D; users opt in. No automatic mass-migration.
3. **`@ruvector/cluster` / `@ruvector/server` adoption.** Both are 2.7KB placeholder packages today; can't adopt nothing. Skip until substrates ship.
4. **agentic-flow side of the upstream timeline** (Phases 5-8: RuvLLM orchestration, circuit breakers, neuromorphic, etc.). Outside `forks/agentdb` scope.
5. **Backward compatibility shim** that lets users run on legacy SQLite during transition. The rollout DOES NOT keep SQLite alive as a runtime fallback. Each Phase B controller commit dead-strips its SQLite path atomically. No long-tail compat. No silent degradation. No automatic fallback per `feedback-no-fallbacks` + user-binding directive 2026-05-11 ("postgres, or fail fast, fail loud").

### Known minor gaps — resolved by 2026-05-11 swarm consolidation

The 6 gaps (H–M) originally parked here have been resolved by a 4-agent swarm investigation on 2026-05-11. Resolution docs at `/tmp/adr0170-resolution-{H-K,I,J,L-M}.md`; load-bearing decisions folded inline into Phase A/B/C/D above. One-line resolution per gap:

- **H — Migration script fidelity**: spec consolidated into Phase D item 5. Idempotent-with-loud-refuse (no merge, no silent no-op per `feedback-no-fallbacks`); per-table checkpoint manifest with `source_sha256`; preflight schema check; contract test at `tests/acceptance/adr0170-migration-roundtrip.test.mjs` with **exact result-set equality** for FTS roundtrip (per `feedback-no-squelch-tests`).
- **I — pglite cold-start vs `_run_and_kill_ro` budget**: profiled at 672.8 ms ± 42.3 ms cold, 94.5 ms warm-reopen. Default budget is 8 s (not 30 s as feared), max is 60 s. **Cold pglite is 11×–88× under every budget; no bump needed.** Mitigation consolidated into Phase A items 7-8: PostgresBackend.dataDir routes to `.swarm/memory.pglite/` so repeated invocations hit warm-reopen; harness gate confirms `PG_VERSION` exists after `harness-init`.
- **J — graph-node Cypher path under postgres**: **retire `@ruvector/graph-node` entirely** from `CausalMemoryGraph`, `ReflexionMemory`, `SkillLibrary`. Every Cypher query the fork actually executes has a clean SQL equivalent; the Cypher WHERE evaluator is admittedly incomplete; `enableGraph: false` is the de facto default; hyperedges have zero in-fork call sites. On-disk format count drops to 2 (postgres + RVF) — the consolidation ADR-0166 was reaching for. Dead-strip is atomic with each Phase B controller commit; dep removal lands in Phase D.
- **K — Performance benchmark in confirmation criteria**: spec consolidated into Phase C items 5-6. Gate is **"no >10% regression vs SQLite baseline"** on any of (total wall-clock, store/search p50+p95, RSS peak) — explicitly NOT upstream's "10x faster" claim (per `feedback-no-time-estimates`). Baseline captured once on Phase A HEAD, tied to a specific green acceptance run by ID for reviewer verifiability.
- **L — Phase E (graph-node deepening) homelessness**: retired alongside graph-node per resolution J. Task #30 closes; no Phase E section is added.
- **M — `depends-on` + partial-supersedes frontmatter**: no change needed today. The `adr-review` skill's cross-corpus lint excludes `depends-on` from the supersedes-overlap rule, and `adr-index`'s frontmatter whitelist (6 keys) doesn't admit `partially-supersedes`. The prose-level "partially superseded by ADR-0170" pattern matches existing ADR-0166 convention. **Future caveat** (added to Phase D item 7): when ADR-0170 itself promotes to `accepted`, ADR-0166's status flips from `accepted` to `superseded`, and ADR-0170's frontmatter gains `supersedes: [ADR-0166]` while removing ADR-0166 from `depends-on:` to satisfy the indexer's directed-edge requirement.

### Consequences

* Good, because the substrate halves: one SQL dialect (postgres), one acceptance test matrix, one migration story.
* Good, because pgvector + postgres-cli give native vector ops with HNSW integrated into the query planner — `WHERE tier = 'working' ORDER BY embedding <-> ? LIMIT 10` becomes a single query plan, no vec0 join hack.
* Good, because multi-writer MVCC means the `agentdb_*` axis no longer needs flock-based cross-process coordination (the ADR-0167/0168 work was for memory_* anyway, but the principle applies — postgres handles concurrent writers natively).
* Good, because tsvector FTS strictly upgrades SQLite FTS5 (Lucene-grade ranking, multilingual stemming, weight classes).
* Good, because pglite preserves the embedded/CLI/edge story — no operational regression for users who don't want to run a server.
* Bad, because the fork now carries an explicit substrate-axis divergence from upstream `ruvnet/agentdb` (which remains on SQLite). Future upstream-sync work must respect that the SQL dialect on the fork is postgres, not sqlite — bug-fix patches and feature backports from upstream that touch SQL will need translation rather than direct application.
* Bad, because porting 11 controllers' SQL to postgres dialect is real engineering work (Phase B is the bulk of the effort).
* Bad, because the Option F vec0 mirror writes shipped in patches 46-48 become obsolete; some user-visible CLI output (the `Option F vec0 virtual tables created` log line) goes away.
* Bad, because pglite adds ~3MB to the install size (WASM binary) for users who don't connect to a real postgres server. Acceptable trade for "embedded postgres semantics".
* Bad, because some pre-existing SQLite-specific tooling (sqlite3 REPL, Datasette compatibility, DuckDB cross-query) breaks. Migration guidance recommends postgres-native equivalents (psql, pg-bouncer, postgrest, Apache Superset).
* Neutral, because the `vectorIndex` config field can be widened to include `'pgvector'` and `'postgres-cli'` cleanly — orthogonal axes from ADR-0166 Phase 2 still hold; the postgres path doesn't break that framing, it lights up new values for it.

### Confirmation

Compliance is verified by:

1. **Phase A foundation lands** when `@ruvector/postgres-cli@0.2.8+` + `@electric-sql/pglite@0.4.5+` + `pg@^8.11.0` are deps; `PostgresBackend.ts` exists implementing the `VectorBackend` interface with the dataDir resolution rule from item 7; the factory wires `'postgres'` correctly; `scripts/test-acceptance.sh` confirms `.swarm/memory.pglite/PG_VERSION` exists after `harness-init`; `harness-init` wall-clock delta vs the SQLite baseline does not exceed +1 s.
2. **Phase B controller port lands** when all 13 SQL-bearing controllers run against pglite in the acceptance suite (replacing SQLite). 674/674 acceptance green on pglite is the gate. Per-controller commits also dead-strip the `@ruvector/graph-node` Cypher branches for `CausalMemoryGraph`, `ReflexionMemory`, `SkillLibrary` (per gap-J resolution).
3. **Phase C vector ops integration lands** when `pgvector` HNSW indexes are created for `episode_embeddings`, `skill_embeddings`, `learning_state_embeddings`, etc.; the `vectorBackend.insert(...)` parallel-write pattern is replaced by single-row inserts; k-NN queries go through postgres native ordering; AND the `adr0170-pglite-vs-sqlite.mjs` benchmark report shows **no >10% regression** vs the captured SQLite baseline on any of (total wall-clock, store p95, search p95, RSS peak) per gap-K resolution.
4. **Phase D cleanup lands** when `better-sqlite3`, `sql.js`, `sqlite-vec`, `hnswlib-node`, **`@ruvector/graph-node`**, `db-fallback.ts`, `src/backends/graph/GraphDatabaseAdapter.ts`, the Option F mirror code, and the `enableGraph` config field are all removed; the `agentdb migrate --from sqlite --to pglite` CLI exists with its contract test passing per gap-H resolution; CI passes on pglite-only.

### Reopen triggers

ADR-0170 promotes to `accepted` when Phase A + Phase B land green. The substrate question reopens when:

1. **pglite stops being maintained or develops a critical bug** that pgvector can't work around — would force evaluation of alternative embedded postgres (currently no real alternative; SQLite return would be a step backward).
2. **A first-party postgres alternative emerges** that has materially better embedded characteristics than pglite — would trigger a new substrate decision.
3. **`@ruvector/postgres-cli` is abandoned by its maintainers** — fork would need to vendor or replace the client surface.
4. **Upstream `ruvnet/agentdb` adopts a SQLite-replacement** (postgres, RVF-substrate, or any other) via a formal ADR — would trigger re-evaluation of fork-vs-upstream alignment on this axis. Today no such signal exists; the fork is leading, not tracking.

## More Information

### Substrate audit (2026-05-11)

Verified against `http://localhost:4873` (npm proxy):

| Package | Latest | Files | Verdict |
|---|---|---|---|
| `@ruvector/postgres-cli` | 0.2.8 | 46 — full CLI + client + 11 command modules | **Real, substantial** |
| `@ruvector/graph-node` | 2.0.4 | Substantial; already an agentdb dep | **Real** |
| `@electric-sql/pglite` | 0.4.5 | WASM postgres 15 build | **Real**, embedded story |
| `@ruvector/cluster` | 0.1.0 | 2 files (`package.json` + `README.md`) | **Placeholder** — skip |
| `@ruvector/server` | 0.1.0 | 2 files (`package.json` + `README.md`) | **Placeholder** — skip |

### Local ADRs

| ADR | Title | Role for ADR-0170 |
|---|---|---|
| **0073** | RVF Storage Backend Upgrade | `memory_*` axis canonical; ADR-0170 does NOT affect memory_* |
| **0154** | RVF single-file storage unification | `memory_*` axis only |
| **0166** | AgentDB persistence — axis-separated dual-storage with Option F | **Partially superseded by this ADR.** Phase 1 + 1.5 + 2 survive (correctness fixes). Phase 3 (Option F sqlite-vec mirrors) superseded — sqlite is retiring. Axis-separation rule survives but the agentdb_* axis substrate changes from SQLite to PostgreSQL |
| **0167** | Cross-process RVF write coordination | `memory_*` axis only; not affected |
| **0168** | Rust NAPI library coordinator | `memory_*` axis only; not affected |

### Relationship to upstream agentdb

The fork is deliberately diverging from upstream on the substrate axis. The honest read of upstream state as of 2026-05-11:

**Standalone `ruvnet/agentdb@3.0.0-alpha.14` (updated 2026-05-11T07:52Z) is SQLite-only.**

- `core/AgentDB.ts:106` imports `better-sqlite3`; `package.json` lists `better-sqlite3` and `sql.js` as deps.
- No `postgres`, `pglite`, or `@ruvector/postgres-cli` reference anywhere in source or manifest.
- This is current upstream HEAD, not a stale tag.

**Zero of upstream's 9 published ADRs propose PostgreSQL.**

- Upstream agentdb ships ADRs 002–010 under `docs/adrs/`. All build on SQLite as the assumed substrate.
- ADR-003 ("RVF native format integration", status Proposed for ~3 months) is the closest upstream comes to a substrate change — and it's toward `.rvf` single-file storage, not toward postgres.
- There is no upstream ADR proposing, approving, or planning a SQL substrate replacement.

**The `OPTIMIZED_MASTER_TIMELINE.md` document (2025-12-30) is not active direction.**

- It named `@ruvector/postgres-cli@0.2.6` as Phase 2's persistence tier, with consumer-side wiring as a deliverable.
- Five months later, neither the consumer wiring nor any ADR ratifying the direction has appeared. Upstream version progress (`3.0.0-alpha.14`) far outpaces the timeline's targets while the postgres line item remains untouched.
- Best read: the document is abandoned planning, not abandoned-but-still-intended work. It is cited here only as evidence that `@ruvector/postgres-cli` is real and intended for substrate use — not as a directional signal.

**Therefore this ADR is fork-leading, not upstream-tracking.** The fork is choosing a SQL substrate upstream has explicitly not chosen. The substrate-axis divergence is real and should be owned in this document and in future upstream-sync work.

#### Controller-set audit precision (2026-05-11)

Verified Phase B's 11-controller port list against the standalone `ruvnet/agentdb@3.0.0-alpha.14` repo (the authoritative upstream — `ruvnet/agentic-flow/packages/agentdb/` was deleted by ADR-0161 on 2026-05-08). Findings:

- **6 controllers in `forks/agentdb/src/controllers/` are fork-only** (no upstream equivalent): `HierarchicalMemory`, `MemoryConsolidation`, `StreamingEmbeddingService`, `QUICConnection`, `QUICConnectionPool`, `QUICStreamManager`.
- **3 controllers I'd initially miscalled fork-only actually exist upstream** but hold zero SQL state and are therefore correctly excluded from Phase B: `MincutService` (434 LoC, pure WASM/NAPI compute), `SparsificationService` (492 LoC, same), `prerequisites.ts` (283 LoC, utility functions).
- **Phase B's port list grew from 11 to 13 controllers** after the SQL-state audit. The original list missed three SQL-bearing controllers wired by ruflo's controller-registry but not by AgentDB's own `getController()` switch: `SyncCoordinator` (9 SQL lines, owns `sync_state`), `QUICServer` (6 SQL lines, read-only against other controllers' tables), and `HNSWIndex` (1 SQL line, existence guard). The audit also confirmed exclusion accuracy: 13 other controllers in `/controllers/` have zero SQL state (AttentionService, ContextSynthesizer, MemoryController, MetadataFilter, MincutService, MMRDiversityRanker, QUICClient/Connection/Pool/StreamManager, SparsificationService, StreamingEmbeddingService, WASMVectorSearch) and are correctly omitted from Phase B. EmbeddingService + EnhancedEmbeddingService also have zero SQL state but need connection-aware updates (separate bucket within Phase B).
- Upstream commit cadence on standalone `ruvnet/agentdb` since init 2026-05-06: 7 commits total, all 2026-05-06, then dormant. The version (`3.0.0-alpha.14`) carried over from prior agentic-flow vendored work, not progressed by the standalone repo.

#### Useful upstream references (citations, not rationale)

- `@ruvector/postgres-cli@0.2.8` on npm — 46 files, real package, documented as "53+ SQL functions, 39 attention mechanisms" in `ruvnet/agentic-flow/docs/DOCUMENTATION_ORGANIZATION_SUMMARY.md`. Cited as evidence the dependency is consumable, not as evidence upstream is moving toward it.
- `ruvnet/agentic-flow/docs/ruvector-ecosystem/OPTIMIZED_MASTER_TIMELINE.md` (2025-12-30) — historical planning artifact; not active direction.

### Project memory entries to update post-Phase-D

- `project-rvf-primary.md` — replace "agentdb_* axis SQLite-primary with Option F" with "agentdb_* axis PostgreSQL-primary (pglite embedded, postgres server)". Note that the axis-separation framing survives; only the substrate identity changes.
- Remove or revise any references that imply SQLite is permanent on the agentdb_* axis.
