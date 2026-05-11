---
status: proposed
date: 2026-05-11
tags: [agentdb, postgres, pglite, ruvector, graph-node, substrate-replacement, fork-divergence]
supersedes: []
depends-on: [ADR-0073, ADR-0166]
implements: []
---

# AgentDB substrate replacement — PostgreSQL primary (pglite embedded, postgres server); retire SQLite

## Status

**Proposed (2026-05-11) — fork-leading substrate-replacement decision.**

Supersedes ADR-0166's "SQLite primary, permanently" stance for the `agentdb_*` axis. PostgreSQL becomes the sole supported relational substrate going forward; SQLite is retired. The `memory_*` axis (RVF primary per ADR-0073) is unchanged.

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
- Phase 2 (split `vectorBackend` into `vectorIndex` + `primaryStorage`): **survives** — the orthogonal axes framing is still right; this ADR widens `primaryStorage` from `'sqlite'` to `'sqlite' | 'pglite' | 'postgres'` (with sqlite retiring) and reframes `vectorIndex` to include `'pgvector'` and `'postgres-cli'`.
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

### Phased plan

**Phase A — substrate plumbing + fail-loud gates (no in-flight fallback).**

1. Add `@ruvector/postgres-cli@0.2.8+`, `@electric-sql/pglite@0.4.5+`, and `pg@^8.11.0` to `forks/agentdb/package.json`. **All three required (not optional)** — pglite covers the embedded case, pg covers the server case, postgres-cli covers the higher-level capabilities. Missing any → loud install/boot error per `feedback-no-fallbacks`.
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

Each commit also flips its acceptance check to run against pglite (default test env) **and dead-strips the SQLite code path for that controller in the same commit**. After all 11 land, the SQLite code is fully unreachable from any controller. Phase D becomes a confirmation pass (`grep -r 'better-sqlite3\|sql.js\|sqlite-vec' src/` returns zero hits in controller code), not a removal pass.

**Phase C — vector ops integration.**

1. Integrate `pgvector` extension for `pglite` (pglite supports postgres extensions) and real postgres.
2. Switch HNSW indexing from in-memory `RuVectorBackend` to pgvector HNSW indexes on the `embedding` column. Controllers don't need the `vectorBackend.insert(...)` parallel write any more — vectors live in the same row as their metadata.
3. Wire `@ruvector/postgres-cli` for the higher-level features it exposes (53+ SQL functions, 39 attention mechanisms per upstream docs). Audit which are actually useful for the fork.
4. Acceptance tests cover the postgres-native `SELECT ... ORDER BY embedding <-> ?` k-NN path.

**Phase D — confirmation + orphan removal (NOT a fallback removal — Phase B already did that atomically).**

1. Confirm Phase B fully dead-stripped SQLite from every controller: `grep -r 'better-sqlite3\|sql.js\|sqlite-vec\|sqljs\|hmem_vec\|reflexion_episode_vec\|skill_vec\|reasoning_pattern_vec\|learning_vec' forks/agentdb/src/controllers/` returns zero hits. Otherwise the rollout was incomplete; loop back.
2. Delete now-orphaned deps from `forks/agentdb/package.json`: `better-sqlite3`, `sql.js`, `hnswlib-node`, `sqlite-vec`. Update lockfile.
3. Delete the now-orphaned source: `forks/agentdb/src/backends/hnswlib/`, `forks/agentdb/src/db-fallback.ts`, the sqlite-vec extension loader from `AgentDB.ts`, the `createOptionFVirtualTables` method, the Option F mirror writes from the 5 wired controllers (these are already dead per Phase B but the dead-code lines remain in the diff for review-clarity; Phase D removes the lines).
4. Reroute the `vectorIndex: 'hnswlib'` config value: throw a clear error pointing users to `'pgvector'` or `'auto'`.
5. Add the one-shot CLI: `agentdb migrate --from sqlite --to pglite <path>`. Reads legacy `.db` files, writes to `.pglite/`. Idempotent. Not invoked automatically — user runs it explicitly per `feedback-no-fallbacks`.
6. Update memory `project-rvf-primary.md` to reflect the new agentdb_* substrate (postgres-only).
7. Mark ADR-0166's Option F as fully superseded (status → `superseded by ADR-0170`).

### Out of scope

1. **`memory_*` axis changes.** RVF stays primary for memory_*; this ADR addresses agentdb_* only.
2. **Migration of existing user `.swarm/memory.db` files.** A one-shot `agentdb migrate --from sqlite --to pglite` CLI lives in Phase D; users opt in. No automatic mass-migration.
3. **`@ruvector/cluster` / `@ruvector/server` adoption.** Both are 2.7KB placeholder packages today; can't adopt nothing. Skip until substrates ship.
4. **agentic-flow side of the upstream timeline** (Phases 5-8: RuvLLM orchestration, circuit breakers, neuromorphic, etc.). Outside `forks/agentdb` scope.
5. **Backward compatibility shim** that lets users run on legacy SQLite during transition. The rollout DOES NOT keep SQLite alive as a runtime fallback. Each Phase B controller commit dead-strips its SQLite path atomically. No long-tail compat. No silent degradation. No automatic fallback per `feedback-no-fallbacks` + user-binding directive 2026-05-11 ("postgres, or fail fast, fail loud").

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

1. **Phase A foundation lands** when `@ruvector/postgres-cli@0.2.8+` + `@electric-sql/pglite@0.4.5+` + `pg@^8.11.0` are deps; `PostgresBackend.ts` exists implementing the `VectorBackend` interface; the factory wires `'postgres'` correctly.
2. **Phase B controller port lands** when all 11 controllers run against pglite in the acceptance suite (replacing SQLite). 674/674 acceptance green on pglite is the gate.
3. **Phase C vector ops integration lands** when `pgvector` HNSW indexes are created for `episode_embeddings`, `skill_embeddings`, `learning_state_embeddings`, etc.; the `vectorBackend.insert(...)` parallel-write pattern is replaced by single-row inserts; k-NN queries go through postgres native ordering.
4. **Phase D cleanup lands** when `better-sqlite3`, `sql.js`, `sqlite-vec`, `db-fallback.ts`, `hnswlib-node`, and the Option F mirror code are all removed; CI passes on pglite-only.

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

#### Useful upstream references (citations, not rationale)

- `@ruvector/postgres-cli@0.2.8` on npm — 46 files, real package, documented as "53+ SQL functions, 39 attention mechanisms" in `ruvnet/agentic-flow/docs/DOCUMENTATION_ORGANIZATION_SUMMARY.md`. Cited as evidence the dependency is consumable, not as evidence upstream is moving toward it.
- `ruvnet/agentic-flow/docs/ruvector-ecosystem/OPTIMIZED_MASTER_TIMELINE.md` (2025-12-30) — historical planning artifact; not active direction.

### Project memory entries to update post-Phase-D

- `project-rvf-primary.md` — replace "agentdb_* axis SQLite-primary with Option F" with "agentdb_* axis PostgreSQL-primary (pglite embedded, postgres server)". Note that the axis-separation framing survives; only the substrate identity changes.
- Remove or revise any references that imply SQLite is permanent on the agentdb_* axis.
