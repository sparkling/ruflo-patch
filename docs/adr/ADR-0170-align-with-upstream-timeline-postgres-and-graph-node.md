---
status: proposed
date: 2026-05-11
tags: [agentdb, postgres, ruvector, graph-node, upstream-alignment, optimized-master-timeline]
supersedes: []
depends-on: [ADR-0073, ADR-0166]
implements: []
---

# Align fork direction with upstream OPTIMIZED_MASTER_TIMELINE.md — adopt postgres-cli + deepen graph-node; skip placeholder packages

## Context and Problem Statement

Upstream `ruvnet/agentic-flow/docs/ruvector-ecosystem/OPTIMIZED_MASTER_TIMELINE.md` (2025-12-30) names eight phases for the `agentdb` → `agentic-flow` integration arc. Two phases address persistence + storage substrate questions that ADR-0166 explicitly **filtered out of its option list**:

- **Phase 2: PostgreSQL Backend** — `@ruvector/postgres-cli@0.2.6`, 4-day workstream, target 10x faster than SQLite for enterprise persistence, `PostgresBackend` implements `VectorBackend` interface.
- **Phase 3 (subset): Hypergraph + Clustering + HTTP Server** — `@ruvector/graph-node@0.1.25` (real, already a dep), `@ruvector/cluster@0.1.0` (new), `@ruvector/server@0.1.0` (new), 4 days.

ADR-0166 §"Considered Options" considered Option A (RuVector substrate flip) and Option F (sqlite-vec virtual table augmentation) but did NOT consider PostgreSQL as an option. The 8-persona council that produced Amendment 2026-05-11f converged on Option F by filtering out the substrate-flip choices on RuVector-specific grounds (redb-quadruplication, Cypher binding immaturity, upstream cadence). **Postgres was never on the council's option list.**

Re-reading the question — "what if the agentdb_* axis isn't limited to SQLite?" — reframes the answer entirely:

- PostgreSQL **preserves every relational feature** ADR-0166's 5 PERMANENT_SQLITE_CARVE_OUT controllers depend on (WITH RECURSIVE, FK CASCADE, GROUP BY HAVING, multi-record ACID, FTS via tsvector).
- PostgreSQL **adds native vector operations** via `pgvector` or `@ruvector/postgres-cli`, removing the need for `sqlite-vec` virtual tables on this substrate.
- PostgreSQL **gives multi-writer durability** out of the box, sidestepping the `feedback-data-loss-zero-tolerance` story for the `agentdb_*` axis without further work.

The fork's recent Phase 3 (Option F) work, by contrast, **wasn't on the upstream timeline at all**. It is fork-additive: ~5 controller mirrors that write into `sqlite-vec` vec0 virtual tables. No consumer currently reads from those mirrors (the `vectorBackend.search(...)` path remains active). The work is shipped but inert pending a reader.

This ADR settles the question that ADR-0166 didn't ask: **should the fork track the upstream timeline's Phase 2 (postgres) + Phase 3 hypergraph subset, or stay fork-divergent on Option F?**

## Decision Drivers

* **`feedback-no-value-judgements-on-features`** ("wire all upstream capability"). Upstream identified postgres + hypergraph as the persistence direction; the fork should track that intent.
* **`feedback-no-upstream-donate-backs`**. The fork cannot drive upstream to ship the placeholder packages. Phases that depend on those packages are blocked at the substrate, not the consumer.
* **`feedback-data-loss-zero-tolerance`**. PostgreSQL's multi-writer MVCC trivially satisfies this for the `agentdb_*` axis — current SQLite-primary stance requires `flock`-based coordination via ADR-0167/0168 for cross-process safety, while postgres handles this at the substrate layer.
* **`project-rvf-primary`**. The `memory_*` axis is unchanged; this ADR only addresses the `agentdb_*` substrate axis. Postgres is *additive*, not a replacement for SQLite — both remain valid `primaryStorage` values.
* **Audit findings (2026-05-11)**. `@ruvector/postgres-cli@0.2.8` is a real, substantial package (46 files including `client.js`, `attention.js`, `benchmark.js`, `gnn.js`, `graph.js`, `hyperbolic.js`, `quantization.js`, `routing.js`, `sparse.js`, `vector.js`). `@ruvector/cluster@0.1.0` and `@ruvector/server@0.1.0` are **name-squat placeholders** (2.7KB tarballs containing only `package.json` + `README.md`, no `main` source files, zero dependencies). Adopting postgres-cli is substrate-ready; adopting cluster/server is impossible until upstream actually publishes implementations.

## Considered Options

* **Option A** — Adopt the entire OPTIMIZED_MASTER_TIMELINE as the fork's direction (Phases 2 + 3 + 4 + 5-8). Includes the placeholder packages.
* **Option B** — Adopt only the substrate-ready phases: Phase 2 (postgres-cli) + Phase 3a (deepen `@ruvector/graph-node` in CausalMemoryGraph). Skip Phase 3b (cluster) + Phase 3c (server) until those packages have implementations. Continue Option F as legacy fork-additive work, but stop calling it the "next direction".
* **Option C** — Stay on the ADR-0166 trajectory (Option F as the agentdb_* axis future). Treat the upstream timeline as informational only.
* **Option D** — Do nothing this iteration; revisit when upstream publishes cluster/server implementations.

## Decision Outcome

Chosen: **Option B — adopt Phase 2 + Phase 3a where substrates ship; skip Phase 3b/3c; deprioritize finishing Option F's deferred controllers.**

Rationale:

1. The substrate audit shows `@ruvector/postgres-cli@0.2.8` is real and substantial. Phase 2 is consumer-side wiring on a working substrate.
2. `@ruvector/graph-node@2.0.4` is already a dep of agentdb both upstream and fork. Phase 3a is deeper wiring on a working substrate.
3. `@ruvector/cluster@0.1.0` and `@ruvector/server@0.1.0` are 2.7KB placeholder tarballs with no implementations. Adopting them is impossible (nothing to consume) and the fork cannot ship the implementations itself per `feedback-no-upstream-donate-backs`.
4. Option F's vec0 mirrors are shipped and inert. Honest framing: keep the 5 wired controllers, do NOT pursue ExplainableRecall + QUICServer wiring, treat as legacy. New work on the agentdb_* axis routes through postgres.
5. PostgreSQL becomes a new `primaryStorage?: 'sqlite' | 'postgres'` value. SQLite remains the default for local/CLI/edge; postgres opts in for production/multi-writer/enterprise.

### Direction realignment summary

| Workstream | Status post-ADR-0170 |
|---|---|
| `@ruvector/postgres-cli` integration as `primaryStorage: 'postgres'` | **adopt** — new VectorBackend + relational substrate option |
| `@ruvector/graph-node` Cypher + hyperedges in `CausalMemoryGraph` | **adopt** — deepen existing dep usage |
| `@ruvector/cluster` Raft consensus integration | **skip until substrate ships** — placeholder package today |
| `@ruvector/server` HTTP/gRPC server | **skip until substrate ships** — placeholder package today |
| ADR-0166 Phase 3 Option F (sqlite-vec mirrors) for remaining controllers (ExplainableRecall, QUICServer) | **deprioritize** — current 5-controller wiring stays; no more wiring |
| ADR-0166 Phase 3 Option F mirror-batching (perf) | **defer** — pending a real reader; not worth optimizing inert writes |

### Phase 2 (postgres) — implementation outline

Mirrors upstream timeline's Day 4-7 but sized for fork's existing structure:

1. **Add `@ruvector/postgres-cli` as optionalDependency** in `forks/agentdb/package.json`.
2. **New backend: `forks/agentdb/src/backends/postgres/PostgresBackend.ts`** implementing the `VectorBackend` interface (same shape as `RuVectorBackend`, `HNSWLibBackend`, `RvfBackend`).
3. **Wire into factory.ts**: `createBackend('postgres', config)` returns `new PostgresBackend(config)`; `'auto'` cascade tries postgres last (after ruvector/rvf/hnswlib) so it only activates when explicitly selected via `vectorIndex: 'postgres'`.
4. **Add `primaryStorage?: 'sqlite' | 'postgres'`** value to ADR-0166 Phase 2's `AgentDBConfig`. Currently restricted to `'sqlite'`; this ADR widens the union.
5. **Loud-error on `primaryStorage: 'postgres'` without connection-string config** per `feedback-no-fallbacks`.
6. **Migration script** at `forks/agentdb/scripts/migrate-sqlite-to-postgres.ts` (one-shot, idempotent). Per upstream Phase 2 Day 5.
7. **Acceptance check** — `tests/adr0170-postgres-roundtrip.test.ts` asserting INSERT/SELECT round-trip on a `postgres://...` connection string. Skipped gracefully when postgres isn't reachable in the test env (matches the sqlite-vec absence pattern).

### Phase 3a (graph-node deepening) — implementation outline

1. **Adopt `querySync(cypher)`** for `CausalMemoryGraph.getCausalChain` traversals where `WITH RECURSIVE` is currently the only path. Coexists with WITH RECURSIVE; switch is per-query.
2. **Adopt `begin`/`commit`/`rollback`** transactions on `GraphDatabaseAdapter` mutations (upstream timeline Phase 1 item that's also unwired in fork).
3. **Adopt `createHyperedge`/`searchHyperedges`** in `CausalMemoryGraph` for multi-node causal relationships (currently only pairwise edges are supported).
4. Bound to Tier 3 alpha caveat from ADR-0166 Amendment 2026-05-11f: `@ruvector/graph-node`'s Cypher WHERE evaluator is incomplete (`GraphDatabaseAdapter.ts:293`). The fork uses whatever Cypher surface works today; falls back to SQL where it doesn't. Document the boundary; don't pretend Cypher is feature-complete.

### Out of scope

1. **`@ruvector/cluster` / `@ruvector/server` adoption** — substrate placeholders, blocked at upstream. Revisit when those packages ship real implementations.
2. **Phase 5-8 of the upstream timeline (agentic-flow side)** — outside `forks/agentdb` scope. Tracked in upstream `agentic-flow`'s own ADRs.
3. **Reopening Option F substrate flip** — Option F stays as legacy fork-additive. ADR-0166's reopen triggers remain in force; this ADR doesn't supersede ADR-0166, it extends the substrate axis with postgres as a sibling to sqlite.
4. **Removing the vec0 mirror writes** — they're inert but harmless. Cost of running them is per-store; cost of removing them is a release cycle of churn. Leave them.
5. **Migration of existing `.swarm/memory.db` files to postgres** — postgres is opt-in; users who don't enable it keep SQLite. The migration script exists for users who choose to migrate; no automatic mass-migration.

### Consequences

* Good, because postgres adoption preserves every PERMANENT_SQLITE_CARVE_OUT controller's relational semantics (postgres is a strict superset of SQLite's SQL features for our use cases).
* Good, because postgres natively handles multi-writer concurrency — `feedback-data-loss-zero-tolerance` is satisfied at the substrate layer for the postgres path, without ADR-0167/0168-style flock coordination.
* Good, because pgvector / `@ruvector/postgres-cli` provide native vector ops, removing the need for vec0 mirrors on this substrate.
* Good, because the fork stops accumulating divergent direction (Option F) and starts tracking upstream's actual intent.
* Good, because the audit pre-filters: cluster/server placeholders are skipped honestly rather than time-boxed and abandoned.
* Bad, because postgres requires a server (operational overhead, deployment shift) — local/CLI/edge users keep SQLite. The `primaryStorage` config split is the right escape hatch.
* Bad, because two parallel persistence paths (sqlite + postgres) on the same axis means two integration-test matrices and two failure modes. Acceptance suite needs both lanes.
* Bad, because the Option F work landed in this session is partially obsoleted (the postgres path doesn't need vec0 mirrors). The vec0 mirrors remain valid for the SQLite path; they're not deleted, just deprioritized.
* Neutral, because graph-node deepening (Phase 3a) is incremental — each capability lands as a separate small commit, can be paused at any point.

### Confirmation

Compliance is verified by:

1. **`@ruvector/postgres-cli@0.2.8+` installed via npm/Verdaccio** — substrate-availability gate.
2. **`tests/adr0170-postgres-roundtrip.test.ts` passes** when `POSTGRES_URL` env is set; skips gracefully when absent.
3. **Acceptance suite passes 674/674** on the SQLite default path — postgres lane is opt-in and doesn't regress the default.
4. **`primaryStorage: 'postgres'` end-to-end** in at least one ruflo call site (probably `memory-router.ts:561` once the substrate stabilizes) without regressions across a full release cycle.

### Reopen triggers

ADR-0170 promotes to `accepted` when Phase 2 lands and is validated. The substrate question reopens when:

1. `@ruvector/cluster` or `@ruvector/server` publish actual implementations (today they're 2.7KB placeholders) — would unlock Phase 3b/3c adoption.
2. `@ruvector/graph-node`'s Cypher WHERE evaluator reaches feature-complete state — would remove the Tier 3 alpha caveat on Phase 3a deepening.
3. A concrete capability gap surfaces that postgres-cli + graph-node together cannot satisfy — would trigger a new substrate decision.

## More Information

### Audit results (2026-05-11)

Substrate availability check against `http://localhost:4873` (npm proxy):

| Package | Latest | Files in tarball | Real or placeholder |
|---|---|---|---|
| `@ruvector/postgres-cli` | 0.2.8 | 46 | **Real** (full CLI + client) |
| `@ruvector/graph-node` | 2.0.4 | Substantial | **Real** (existing dep) |
| `@ruvector/cluster` | 0.1.0 | 2 (`package.json`, `README.md`) | **PLACEHOLDER** |
| `@ruvector/server` | 0.1.0 | 2 (`package.json`, `README.md`) | **PLACEHOLDER** |
| `@ruvector/tiny-dancer` | 0.1.18 | (not audited, agentic-flow scope) | — |
| `@ruvector/rudag` | 0.1.1 | (not audited, agentic-flow scope) | — |
| `spiking-neural` | 1.0.1 | (not audited, agentic-flow scope) | — |
| `@ruvector/agentic-synth` | 0.1.6 | (not audited, agentic-flow scope) | — |

### Local ADRs

| ADR | Title | Role for ADR-0170 |
|---|---|---|
| **0073** | RVF Storage Backend Upgrade | `memory_*` axis canonical; ADR-0170 only addresses `agentdb_*` |
| **0166** | AgentDB persistence — axis-separated dual-storage with Option F | Sibling. Option F (sqlite-vec mirror) is for the SQLite path; ADR-0170 adds postgres as a parallel option on the same axis. Both ADRs stay accepted; neither supersedes the other |
| **0167** | Cross-process RVF write coordination | `memory_*` axis only; not affected |
| **0168** | Rust NAPI library coordinator | `memory_*` axis only; not affected |

### Upstream references

- `ruvnet/agentic-flow/docs/ruvector-ecosystem/OPTIMIZED_MASTER_TIMELINE.md` (2025-12-30) — the source of Phase 2 + Phase 3 framing
- `ruvnet/agentic-flow/docs/DOCUMENTATION_ORGANIZATION_SUMMARY.md` — names `@ruvector/postgres-cli@0.2.6` as the "Enterprise PostgreSQL backend" tier
- `ruvnet/agentic-flow/packages/agentdb/docs/adrs/ADR-007` — capability roadmap; postgres-cli adoption is parallel-track-aligned

### Why upstream itself didn't ship the timeline

Quick context: upstream wrote OPTIMIZED_MASTER_TIMELINE.md 2025-12-30 with a 23-day target. Five months later upstream `agentdb` is at `3.0.0-alpha.3` (timeline targeted `2.0.0-alpha.2.21` for Phase 4 publish — surpassed). But `@ruvector/postgres-cli` is NOT a dep of upstream's agentdb today; no `PostgresBackend.ts` exists in `ruvnet/agentic-flow/packages/agentdb/src/`. Upstream wrote the plan, moved past the Phase 4 publish, then went elsewhere. Phase 2's substrate (`postgres-cli`) shipped to npm but the consumer-side wiring was never landed. This ADR picks up the consumer-side wiring without claiming to "track upstream" — the fork is finishing work upstream paused, not following.
