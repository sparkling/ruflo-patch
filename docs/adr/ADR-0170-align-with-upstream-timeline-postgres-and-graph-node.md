---
status: proposed
date: 2026-05-11
tags: [agentdb, postgres, pglite, ruvector, graph-node, substrate-replacement, upstream-alignment]
supersedes: []
depends-on: [ADR-0073, ADR-0166]
implements: []
---

# AgentDB substrate replacement — PostgreSQL primary (pglite embedded, postgres server); retire SQLite

## Status

**Proposed (2026-05-11) — substrate-replacement decision.**

Supersedes ADR-0166's "SQLite primary, permanently" stance for the `agentdb_*` axis. PostgreSQL becomes the sole supported relational substrate going forward; SQLite is retired. The `memory_*` axis (RVF primary per ADR-0073) is unchanged.

## Context and Problem Statement

ADR-0166 settled the agentdb persistence question by framing the choice as "SQLite primary (current) vs RuVector substrate flip (retired)" and converging on Option F — `sqlite-vec` virtual table augmentation inside SQLite. The 8-persona dialectic council never considered PostgreSQL.

Two follow-up findings reopen the question:

1. **The Option F mirrors we shipped are inert.** Five controllers (HierarchicalMemory, ReflexionMemory, SkillLibrary, ReasoningBank, LearningSystem) now write to vec0 virtual tables on every store. **No recall path reads from them.** The work is plumbing without a consumer. ADR-0166 §"What this actually buys today" framed this honestly: vec0 is "wired but inert pending a reader". The reader never materialized in this session, and on reflection the right reader requires native vector ops integrated with the relational query planner — which is exactly what `pgvector` / `@ruvector/postgres-cli` provide on PostgreSQL.

2. **Upstream `OPTIMIZED_MASTER_TIMELINE.md` (2025-12-30) named PostgreSQL as Phase 2** and `@ruvector/postgres-cli@0.2.6` (now 0.2.8) as its substrate. Upstream wrote the plan, surpassed Phase 4's publish target, but **never landed the consumer-side wiring** — postgres-cli isn't a dep of upstream's agentdb today. The fork can pick up that paused work and converge with upstream's stated direction.

3. **The "SQLite is embedded; postgres requires a server" objection is obsoleted by pglite.** `@electric-sql/pglite@0.4.5` is a WASM build of PostgreSQL 15, runs in-process (Node, browser, edge), persists to a single file or IndexedDB. Drop-in for SQLite's portability story while speaking real postgres SQL — same dialect, same migrations, same client code as a real `postgres://...` server.

ADR-0166's option list was filtered too narrowly. The question this ADR settles: **make PostgreSQL (pglite embedded + server `postgres://...`) the sole relational substrate for the `agentdb_*` axis; retire SQLite + Option F.**

## Decision Drivers

* **The 5 PERMANENT_SQLITE_CARVE_OUT controllers don't actually need SQLite — they need SQL.** PostgreSQL is a strict superset of SQLite's relational features for our use cases: `WITH RECURSIVE` ✅, FK CASCADE ✅, `GROUP BY HAVING` ✅, multi-record ACID ✅ (MVCC, multi-writer), FTS ✅ (tsvector, Lucene-grade — strict upgrade over SQLite FTS5).
* **Native vector ops without the vec0 hack.** `pgvector` + `@ruvector/postgres-cli` provide HNSW / IVFFlat indexing integrated with the relational query planner. No separate virtual table; no mirror writes; vectors are first-class columns. The Option F design pattern (mirror to vec0) becomes unnecessary because the postgres SQL planner can use vector indexes in normal `SELECT ... ORDER BY embedding <-> ?` queries.
* **`feedback-data-loss-zero-tolerance` becomes trivial.** PostgreSQL's MVCC handles multi-writer concurrency at the substrate. The cross-process coordination work (ADR-0167 Phase 2's writer-coordinator pattern) becomes irrelevant on this axis — the substrate solves it.
* **Upstream alignment.** OPTIMIZED_MASTER_TIMELINE.md Phase 2 + Phase 3a are the upstream direction. The fork picks up paused consumer-side wiring rather than diverging.
* **`feedback-no-value-judgements-on-features`** ("wire all upstream capability"). `@ruvector/postgres-cli@0.2.8` is a real, substantial package (46 files: CLI, client, `attention.js`, `benchmark.js`, `gnn.js`, `graph.js`, `hyperbolic.js`, `quantization.js`, `routing.js`, `sparse.js`, `vector.js`). The fork should consume it.
* **Sunk-cost honesty.** Option F's vec0 mirror work shipped 2026-05-11 across patches 44–48. Some of it is reusable framing (the Phase 1 + 1.5 + 2 wiring fixes were correctness fixes; they survive). The Phase 3 vec0 mirrors specifically don't survive — they're tied to the SQLite path. Acknowledging this clearly is better than pretending the substrate is still SQLite.

## Considered Options

* **Option A** — Stay on ADR-0166 Option F. Continue extending sqlite-vec mirrors to remaining controllers. Treat upstream's postgres direction as informational.
* **Option B** — Adopt postgres as a SIBLING of SQLite. Both `primaryStorage` values valid; user picks. (This was the ADR-0170 draft committed at `64e7333` before this revision.)
* **Option C** — Replace SQLite with PostgreSQL entirely. pglite for embedded/CLI/edge; real postgres for server/production. **Single substrate, single test matrix, single integration story.**
* **Option D** — Wait for upstream to ship the postgres wiring themselves.

## Decision Outcome

Chosen: **Option C — PostgreSQL is the sole relational substrate for the `agentdb_*` axis. pglite handles the embedded/portable case; `postgres://...` handles server/production. SQLite is retired.**

Rationale:

1. **Single substrate halves the integration matrix.** Option B's "sibling" framing would create two persistence lanes (sqlite + postgres) with two acceptance test matrices, two failure modes, two migration stories. Option C collapses to one.
2. **pglite eliminates the "postgres requires a server" objection.** It IS PostgreSQL (literally WASM-built postgres 15), runs in-process, persists to disk or IndexedDB. Every embedded use case SQLite supports today, pglite supports tomorrow — with strict SQL feature superset.
3. **Native vector ops via pgvector + `@ruvector/postgres-cli`** integrate with the query planner. No vec0 mirror needed. The Option F design becomes unnecessary on this substrate.
4. **The 5 PERMANENT_SQLITE_CARVE_OUT controllers run unchanged.** Their requirements were SQL-feature requirements, not SQLite-specific. PostgreSQL satisfies every one (and improves several — tsvector FTS, multi-writer MVCC).
5. **Upstream alignment without dependency** on upstream finishing the work themselves. Substrate (`@ruvector/postgres-cli@0.2.8`) is real and published; consumer-side wiring is fork-side work the fork can do unilaterally.

### What this means for ADR-0166

ADR-0166 is **partially superseded for the `agentdb_*` axis**:

- Phase 1 (wire `vectorBackend` field): **survives** — it was a correctness fix, applies on any substrate.
- Phase 1.5 (delete dead `graphBackend` param): **survives** — pure cleanup, applies on any substrate.
- Phase 2 (split `vectorBackend` into `vectorIndex` + `primaryStorage`): **survives** — the orthogonal axes framing is still right; this ADR widens `primaryStorage` from `'sqlite'` to `'sqlite' | 'pglite' | 'postgres'` (with sqlite retiring) and reframes `vectorIndex` to include `'pgvector'` and `'postgres-cli'`.
- Phase 3 (Option F, sqlite-vec mirrors): **superseded.** The vec0 mirror writes shipped in patches 46-48 stay in the code for now (harmless), but no new wiring extends them, and a future cleanup commit removes them entirely once the postgres path stabilizes.
- The axis-separation rule (memory_* RVF, agentdb_* SQL) **survives, with SQL = PostgreSQL** rather than SQLite.

### What this means for `memory_*` axis

**Unchanged.** RVF-primary stays per ADR-0073. ADR-0167/0168 cross-process coordination work continues for `memory_*`. The `.swarm/memory.rvf` file is still the canonical store for memory_* operations. This ADR addresses the `agentdb_*` axis only.

### Phased plan

**Phase A — substrate plumbing (foundation, no behavior change yet).**

1. Add `@ruvector/postgres-cli@0.2.8+`, `@electric-sql/pglite@0.4.5+`, and `pg@^8.11.0` to `forks/agentdb/package.json` (postgres-cli + pg as optional, pglite as required to preserve the embedded-default story).
2. New backend: `forks/agentdb/src/backends/postgres/PostgresBackend.ts` implementing the `VectorBackend` interface. Two connection modes: embedded (pglite, default — no connection string needed, persists to `.swarm/memory.pglite/`) and server (`postgres://...` from `AGENTDB_POSTGRES_URL` env or config).
3. Wire into `backends/factory.ts`: `createBackend('postgres', config)` → `new PostgresBackend(config)`; `'auto'` cascade prefers postgres-cli when available.
4. Widen `AgentDBConfig.primaryStorage` union from `'sqlite'` to `'pglite' | 'postgres'` (default `'pglite'`). Add `connectionString?: string` config field.
5. Schema port: rewrite `schemas/schema.sql` + `schemas/frontier-schema.sql` to PostgreSQL dialect — most tables are identical; differences are limited to `INTEGER PRIMARY KEY AUTOINCREMENT` → `BIGSERIAL PRIMARY KEY`, `INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))` → `BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT`, `BLOB` → `BYTEA`, FTS5 virtual tables → `tsvector` columns + GIN indexes.

**Phase B — controller port (one controller at a time, each its own commit + acceptance run).**

Per ADR-0166 Phase 3's incremental pattern, port each controller's SQL to the postgres dialect:

1. EmbeddingService + EnhancedEmbeddingService (no SQL state, just connection-aware)
2. HierarchicalMemory (TRIVIAL — schema port)
3. MemoryConsolidation (TRIVIAL — schema port)
4. ReflexionMemory (MODERATE — `episode_embeddings` BYTEA + pgvector column variant)
5. SkillLibrary (MODERATE — same)
6. ReasoningBank (MODERATE — same; verify GROUP BY queries on postgres)
7. ExplainableRecall (MODERATE — `recall_certificates` schema port + tsvector for query_text)
8. LearningSystem (HARD — RL aggregations over `learning_state_embeddings`; verify GROUP BY semantics)
9. CausalMemoryGraph (HARDEST — `WITH RECURSIVE` 5-hop traversal — postgres syntax differs from sqlite slightly)
10. CausalRecall (HARD — JOIN + ORDER BY rerank)
11. NightlyLearner (HARD — cross-product self-JOIN + GROUP BY + HAVING)

Each commit also flips its acceptance check to run against pglite (default test env). After all 11 land, the SQLite code paths are dead and can be removed in Phase D.

**Phase C — vector ops integration.**

1. Integrate `pgvector` extension for `pglite` (pglite supports postgres extensions) and real postgres.
2. Switch HNSW indexing from in-memory `RuVectorBackend` to pgvector HNSW indexes on the `embedding` column. Controllers don't need the `vectorBackend.insert(...)` parallel write any more — vectors live in the same row as their metadata.
3. Wire `@ruvector/postgres-cli` for the higher-level features it exposes (53+ SQL functions, 39 attention mechanisms per upstream docs). Audit which are actually useful for the fork.
4. Acceptance tests cover the postgres-native `SELECT ... ORDER BY embedding <-> ?` k-NN path.

**Phase D — cleanup.**

1. Delete the sqlite-vec / vec0 mirror code from the 5 wired Option F controllers (HM, Reflexion, Skills, ReasoningBank, LearningSystem). The mirror writes are no longer needed.
2. Delete `@sparkleideas/agentdb`'s `better-sqlite3` and `sql.js` deps (they remain as historical dependencies during Phases A-C for fallback safety; cleared once all controllers ported).
3. Delete `forks/agentdb/src/backends/hnswlib/` and reroute the lone `vectorIndex: 'hnswlib'` value to pgvector (hnswlib's role is replaced by pgvector's HNSW).
4. Delete `db-fallback.ts` (sql.js path).
5. Delete the sqlite-vec optional dep.
6. Update memory `project-rvf-primary.md` to reflect the new agentdb_* substrate.
7. Mark ADR-0166's Option F as superseded.

### Out of scope

1. **`memory_*` axis changes.** RVF stays primary for memory_*; this ADR addresses agentdb_* only.
2. **Migration of existing user `.swarm/memory.db` files.** A one-shot `agentdb migrate --from sqlite --to pglite` CLI lives in Phase D; users opt in. No automatic mass-migration.
3. **`@ruvector/cluster` / `@ruvector/server` adoption.** Both are 2.7KB placeholder packages today; can't adopt nothing. Skip until substrates ship.
4. **agentic-flow side of the upstream timeline** (Phases 5-8: RuvLLM orchestration, circuit breakers, neuromorphic, etc.). Outside `forks/agentdb` scope.
5. **Backward compatibility shim** that lets users run on legacy SQLite during transition. Phase B keeps the SQLite code paths alive for the duration of the port; Phase D deletes them. No long-tail compat.

### Consequences

* Good, because the substrate halves: one SQL dialect (postgres), one acceptance test matrix, one migration story.
* Good, because pgvector + postgres-cli give native vector ops with HNSW integrated into the query planner — `WHERE tier = 'working' ORDER BY embedding <-> ? LIMIT 10` becomes a single query plan, no vec0 join hack.
* Good, because multi-writer MVCC means the `agentdb_*` axis no longer needs flock-based cross-process coordination (the ADR-0167/0168 work was for memory_* anyway, but the principle applies — postgres handles concurrent writers natively).
* Good, because tsvector FTS strictly upgrades SQLite FTS5 (Lucene-grade ranking, multilingual stemming, weight classes).
* Good, because the substrate decision aligns with upstream's stated direction; the fork stops accumulating substrate-axis divergence.
* Good, because pglite preserves the embedded/CLI/edge story — no operational regression for users who don't want to run a server.
* Bad, because porting 11 controllers' SQL to postgres dialect is real engineering work (Phase B is the bulk of the effort).
* Bad, because the Option F vec0 mirror writes shipped in patches 46-48 become obsolete; some user-visible CLI output (the `Option F vec0 virtual tables created` log line) goes away.
* Bad, because pglite adds ~3MB to the install size (WASM binary) for users who don't connect to a real postgres server. Acceptable trade for "embedded postgres semantics".
* Bad, because some pre-existing SQLite-specific tooling (sqlite3 REPL, Datasette compatibility, DuckDB cross-query) breaks. Migration guidance recommends postgres-native equivalents (psql, pg-bouncer, postgrest, Apache Superset).
* Neutral, because the `vectorIndex` config field can be widened to include `'pgvector'` and `'postgres-cli'` cleanly — orthogonal axes from ADR-0166 Phase 2 still hold; the postgres path doesn't break that framing, it lights up new values for it.

### Confirmation

Compliance is verified by:

1. **Phase A foundation lands** when `@ruvector/postgres-cli@0.2.8+` + `@electric-sql/pglite@0.4.5+` + `pg@^8.11.0` are deps; `PostgresBackend.ts` exists implementing the `VectorBackend` interface; the factory wires `'postgres'` correctly.
2. **Phase B controller port lands** when all 11 controllers run against pglite in the acceptance suite (replacing SQLite). 674/674 acceptance green on pglite is the gate.
3. **Phase C vector ops integration lands** when `pgvector` HNSW indexes are created for `episode_embeddings`, `skill_embeddings`, `learning_state_embeddings`, etc.; the `vectorBackend.insert(...)` parallel-write pattern is replaced by single-row inserts; k-NN queries go through postgres native ordering.
4. **Phase D cleanup lands** when `better-sqlite3`, `sql.js`, `sqlite-vec`, `db-fallback.ts`, `hnswlib-node`, and the Option F mirror code are all removed; CI passes on pglite-only.

### Reopen triggers

ADR-0170 promotes to `accepted` when Phase A + Phase B land green. The substrate question reopens when:

1. **pglite stops being maintained or develops a critical bug** that pgvector can't work around — would force evaluation of alternative embedded postgres (currently no real alternative; SQLite return would be a step backward).
2. **A first-party postgres alternative emerges** that has materially better embedded characteristics than pglite — would trigger a new substrate decision.
3. **`@ruvector/postgres-cli` is abandoned upstream** — fork would need to vendor or replace the client surface.

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

### Upstream references

- `ruvnet/agentic-flow/docs/ruvector-ecosystem/OPTIMIZED_MASTER_TIMELINE.md` (2025-12-30) — names `@ruvector/postgres-cli@0.2.6` as the enterprise persistence tier; ADR-0170 picks up the consumer-side wiring upstream paused.
- `ruvnet/agentic-flow/docs/DOCUMENTATION_ORGANIZATION_SUMMARY.md` — describes postgres-cli as having "53+ SQL functions, 39 attention mechanisms".
- `ruvnet/agentic-flow/packages/agentdb/docs/adrs/ADR-007` — capability roadmap; postgres-cli adoption is one of its Phase 2 items (never landed upstream).

### Why upstream itself didn't ship postgres-cli wiring

Upstream wrote OPTIMIZED_MASTER_TIMELINE.md in late 2025, surpassed Phase 4's publish target (agentdb is at `3.0.0-alpha.3` upstream, past the timeline's `2.0.0-alpha.2.21` target), but never landed Phase 2's consumer-side wiring. `@ruvector/postgres-cli` is NOT a dep of `ruvnet/agentic-flow/packages/agentdb/package.json` today; no `PostgresBackend.ts` exists in upstream `src/`. Upstream's substrate (the postgres-cli package) shipped to npm but the consumer wiring stalled. This ADR is the fork picking up paused upstream work, not "following upstream" — the fork's substrate-replacement commits will be ahead of upstream when they land.

### Project memory entries to update post-Phase-D

- `project-rvf-primary.md` — replace "agentdb_* axis SQLite-primary with Option F" with "agentdb_* axis PostgreSQL-primary (pglite embedded, postgres server)". Note that the axis-separation framing survives; only the substrate identity changes.
- Remove or revise any references that imply SQLite is permanent on the agentdb_* axis.
