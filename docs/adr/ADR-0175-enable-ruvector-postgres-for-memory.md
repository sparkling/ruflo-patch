---
status: superseded
date: 2026-05-12
tags: [memory, ruvector-postgres, postgres, pgrx, axis-substrate, fork-freedom, embeddings, no-fallback]
supersedes: []
superseded-by: [ADR-0177]
depends-on: [ADR-0073, ADR-0086, ADR-0166, ADR-0170, ADR-0174]
retires-for-axis: [ADR-0073, ADR-0086]   # for memory_* only; RVF stays relevant outside this axis (e.g., graph_* persistence per ADR-0174 follow-up #2)
implements: []
references-upstream: [ruvnet/ruflo:PR-1569, ruvnet/ruflo:Issue-1568, ruvnet/RuVector:ADR-044, ruvnet/ruflo:ADR-027]
---

> **Superseded by ADR-0177 (2026-05-12).** The `memory_*`-on-`ruvector-postgres` substrate change is retired in favor of staying on RVF + `@ruvector/rvf` (the pre-existing ADR-0073 substrate). ADR-0177 keeps RVF as the `memory_*` primary; ADR-0073 + ADR-0086 are reinstated and no longer "retires-for-axis" candidates.

# Mandate `ruvector-postgres` as the `memory_*` axis substrate (single, no fallback)

## Context and Problem Statement

The `memory_*` axis currently runs on RVF per ADR-0073 (storage backend upgrade), ADR-0086 (canonical RvfBackend interface), and the `project-rvf-primary` memory. RVF works end-to-end: agentdb's RvfBackend → `@ruvector/rvf` → `@ruvector/rvf-node` NAPI → `rvf-runtime` Rust → `.rvf` binary files. Live evidence on this machine: `.swarm/memory.rvf` (59KB, mtime today). RVF gives memory_* HNSW-indexed vector search, WITNESS_SEG audit trail, COW branching, ~50ms cold start, zero native deps.

RVF is excellent for single-process / edge / WASM / dev-mode use. The fork's actual deployment shape is different:

1. **Multi-process write concurrency.** MCP server + hooks + interactive `ruflo memory store` commands all write the same store. RVF's file-lock coordination via `memory.rvf.lock` is a real source of bugs.
2. **Multi-machine deployments.** A `.rvf` file is single-node.
3. **Configurable embedding dimensions at runtime.** RVF segments commit to a dimension at creation. Switching providers (Xenova 384d → OpenAI 1536d → 3072d) requires re-embedding + re-segmenting.
4. **Operational unification with ADR-0174 Phase A.6.** ADR-0174 commits the `agentdb_*` axis to `ruvector-postgres` extension. memory_* on a different substrate means two storage systems to operate, monitor, back up, and reason about.
5. **`feedback-no-fallbacks`.** A dual-substrate / opt-in / auto-cascade design violates the project's no-fallbacks discipline. ADR-0170 already retired SQLite for agentdb_* under the same discipline; the analogous move for memory_* is to retire RVF.

Upstream `ruvnet/ruflo` PR #1569 attempts a postgres-for-memory wiring but is stalled (33 days untouched, branch deleted from origin, 0 approvals, mergeable: false, single-author batch-generated cadence). Upstream's compat envelope keeps PR #1569 stuck: they can't drop their existing RVF/SQLite users. The fork doesn't carry that envelope — the bundle ships one substrate per release.

**Question this ADR settles:** make `ruvector-postgres` the sole substrate for `memory_*` in fork, retire RVF for this axis, fail loud if the extension or postgres connection is unavailable at boot.

## Decision Drivers

* **`feedback-no-fallbacks`.** Single substrate per axis. No silent auto-cascade. No "postgres if reachable else RVF". Chosen substrate is mandatory; loud failure at boot when unavailable.
* **`feedback-no-value-judgements-on-features`.** Ship the upstream surface. `ruvector-postgres` v0.3 ships 143 SQL functions including hyperbolic, GNN, hybrid+BM25+RRF, in-column quantization, SIMD ops. **Note (per the per-method analysis below):** Layer 5 of memory_* uses only ~4 of those functions in Phase 1-4 (column type, index, distance, cast — all of which have pgvector equivalents). The ruvector-only surfaces (fastembed-in-DB, hyperbolic distance, hybrid BM25+RRF, in-column quantization) become opportunistic Phase 5+ enhancements, not Phase 1-4 requirements. The fork-freedom + ship-the-surface argument is therefore weaker for memory_* than for agentdb_* (where ADR-0174 Phase A.6 uses more of the 143-function surface), but the operational-unification argument (shared postgres install + extension with ADR-0174) carries Phase 1-4 on its own.
* **ADR-0174 Phase A.6 alignment.** That phase commits `ruvector-postgres` for `agentdb_*`. One postgres instance, one extension, one Docker image, one connection — both axes' data in different schemas. Discordant substrates across axes is operational debt.
* **ADR-0170 discipline as precedent.** ADR-0170 retired SQLite for `agentdb_*`. The same discipline applied to `memory_*` retires RVF.
* **Configurable embeddings story.** Upstream PR #1569's secondary contribution decouples embedding provider (OpenAI / ONNX / fastembed) from substrate. Postgres + `ruvector(${dims})` column makes dimension a deploy-time decision rather than a substrate property.
* **`feedback-no-api-keys`.** ZERO API costs by default. Any embedding-provider choice that could touch a paid endpoint must be explicitly gated.
* **Witness chain trade-off.** RVF's WITNESS_SEG + ML-DSA-65 PQ signature audit is lost when RVF retires from memory_*. Postgres WAL + optional `pgaudit` extension provides an alternative audit story. This is a real cost; named explicitly so users understand it.

## Considered Options

* **Option A** — Adopt PR #1569 as-is (silent auto-cascade postgres-then-RVF). **Rejected**: violates `feedback-no-fallbacks`.
* **Option B** — `ruvector-postgres` exclusive for `memory_*`; retire RVF for this axis; fail loud if extension/connection unavailable. **Chosen.**
* **Option C** — RVF default, `ruvector-postgres` opt-in via boot config. **Rejected**: an opt-in IS a fallback in disguise — half the deployments stay on RVF, the bundle becomes dual-substrate, the no-fallbacks rule is half-applied.
* **Option D** — Don't adopt. Keep RVF-only. **Rejected**: misses ADR-0174 Phase A.6 unification, leaves Issue #1568 unresolved, forfeits 143-function SQL surface.
* **Option E** — Shared postgres with ADR-0174 + boot-time selection. **Rejected** for the same reason as C — selection IS a fallback path.

## Decision Outcome

Chosen option: **Option B — mandate `ruvector-postgres` as the sole `memory_*` substrate; retire RVF for this axis; fail loud at boot.**

Rationale:

1. **Single substrate per axis.** ADR-0170 retired SQLite for agentdb_*. ADR-0174 commits ruvector-postgres for agentdb_*. This ADR completes the discipline for memory_*. Both axes converge on the same extension on the same postgres install.
2. **No fallback is no fallback.** "RVF if postgres unavailable" is the silent failure mode `feedback-no-fallbacks` rules out. A boot-time config switch is a different shape of the same problem (the deployment bundle now has to support two substrates; tests have to cover both; the witness-chain story branches; documentation forks). Picking one is cleaner than picking either.
3. **The fork has no edge/WASM/CI deployment constraint that mandates RVF.** Postgres-server runs locally via `docker run ruvnet/ruvector-postgres:pg17,graph-complete,gated-transformer` — one container, available on every dev machine + CI runner already running Docker. RVF's zero-deps advantage matters for upstream's user base; the fork's bundle commits to its own install matrix.
4. **`ruvector-postgres` requires postgres-server-mode, not pglite.** Per ADR-044 + the upstream pgrx extension architecture, `ruvector-postgres` is a pgrx extension that ships as a Docker image. `@electric-sql/pglite` ships pgvector as a subpath export (per ADR-0170), but **not** ruvector-postgres. Mandating ruvector-postgres for memory_* therefore mandates **postgres-server mode**. The pglite-embedded path that ADR-0170 used for `agentdb_*` is not available here — see Open Follow-up #1 for the implication that ADR-0174 Phase A.6 also needs to commit to postgres-server-mode (or fork-patch a pglite variant that bundles ruvector).
5. **Configurable embeddings bundle as a sibling outcome.** PR #1569's embedding-provider decoupling is valuable independent of substrate choice. Lands in this ADR's Phase 2 with the `embedding.allowPaidProvider` gating per `feedback-no-api-keys`.

### Substrate spec (no selection; no config field)

There is no `memory.backend` config field. There is no `'auto'` mode. There is no opt-in. memory_* is `ruvector-postgres` on postgres-server. Period.

Boot validation in `@claude-flow/memory`'s initialization:

```
1. require RUFLO_POSTGRES_URL to be set
     → if unset: throw with remediation hint pointing at the Docker quick-start
2. open pg.Pool against RUFLO_POSTGRES_URL
     → if connection fails: throw with classifyPgError() output (ECONNREFUSED / auth / etc.)
3. run CREATE EXTENSION IF NOT EXISTS ruvector
     → if extension unavailable on this postgres: throw — extension must be installed in the postgres image
4. run CREATE EXTENSION IF NOT EXISTS pgcrypto
     → throw on failure
5. run CREATE SCHEMA IF NOT EXISTS claude_flow
6. run CREATE TABLE IF NOT EXISTS claude_flow.memory_entries (
       id           text PRIMARY KEY,
       key          text NOT NULL,
       namespace    text NOT NULL DEFAULT 'default',
       content      text,
       embedding    ruvector(${RUFLO_EMBEDDING_DIMS}),
       metadata     jsonb,
       tags         text[],
       ttl_seconds  integer,
       ts_created   timestamptz DEFAULT now(),
       ts_updated   timestamptz DEFAULT now()
   );
7. run CREATE INDEX IF NOT EXISTS memory_entries_embedding_ruhnsw
       ON claude_flow.memory_entries
       USING hnsw (embedding ruvector_cosine_ops);
8. verify the existing table's embedding dimension matches RUFLO_EMBEDDING_DIMS
     → if mismatch: throw — the operator must DROP TABLE and re-create with the new dim, or align RUFLO_EMBEDDING_DIMS to the existing column
```

Any step failing throws a typed `MemoryBackendInitError` whose message names the failing step + remediation. Per `feedback-no-fallbacks`, there is no RVF fallback to silently succeed against. Per ADR-0085-style discrimination (memory `feedback-best-effort-must-rethrow-fatals`), the throw is fatal — controllers do not silently degrade.

### Shared postgres with ADR-0174 Phase A.6

memory_* and agentdb_* share one postgres instance:

```
postgres (single instance, one Docker container)
  ├── CREATE EXTENSION ruvector;      -- shared, per ADR-044
  ├── CREATE EXTENSION pgcrypto;      -- needed by memory_* (PR #1569)
  ├── schema agentdb (per ADR-0170 Phase B + ADR-0174 Phase A.6)
  │     └── causal_edges / skill_edges / reflexion_episodes / reasoning_patterns / ...
  └── schema claude_flow (per this ADR)
        └── memory_entries
```

One `pg.Pool` initialized at process boot, shared between `@claude-flow/memory`'s postgres backend (this ADR) and `@claude-flow/agentdb`'s `PostgresBackend` (ADR-0170 + ADR-0174). One `RUFLO_POSTGRES_URL` env (with `AGENTDB_POSTGRES_URL` and `RUVECTOR_POSTGRES_URL` as accepted aliases for transition — see Open Follow-up #2). One Docker image: `ruvnet/ruvector-postgres:pg17,graph-complete,gated-transformer` per ADR-0174 Phase A.6.

If the postgres image / extension / URL is unavailable, **both axes fail at boot**. There is no axis-level fallback either — `agentdb_*` doesn't silently fall back to pglite; `memory_*` doesn't silently fall back to RVF. The fork's deployment posture is: postgres-server is a required component.

### Configurable embeddings (Phase 2 — bundled with this ADR)

PR #1569's secondary contribution lands here.

**Provider selection at boot** (no per-operation fallback):

| Config | Provider | Default dimension |
|---|---|---|
| `embedding.provider = 'onnx'` (default) | `Xenova/all-MiniLM-L6-v2` or `ONNX_EMBEDDING_MODEL` env override | 384 (or per-model lookup table) |
| `embedding.provider = 'openai'` + `embedding.allowPaidProvider = true` + `OPENAI_API_KEY` set | `text-embedding-3-small` or `OPENAI_EMBEDDING_MODEL` env override | 1536 (or 3072 for `text-embedding-3-large`) |

**`feedback-no-api-keys` enforcement:**

- `embedding.allowPaidProvider` defaults to `false`.
- If `embedding.provider = 'openai'` and `embedding.allowPaidProvider = false`: throw at boot. No silent use of OpenAI.
- If `embedding.provider = 'openai'` and `OPENAI_API_KEY` is unset: throw at boot.
- The user must explicitly set both `embedding.allowPaidProvider = true` and `OPENAI_API_KEY` to take the paid path. Two-key opt-in. Per `feedback-no-api-keys`: zero API costs by default. **Never silently use a key the user set for another purpose.**

**Dimension lock:**

- `RUFLO_EMBEDDING_DIMS` env var explicitly sets the dimension. If set, the embedding column is created with that dimension.
- If unset, dimension is derived from the configured provider's default (ONNX: 384 for the Xenova default; OpenAI: 1536 for `text-embedding-3-small`).
- The dimension is locked at table-create time. Subsequent inserts must produce embeddings of exactly that dimension or fail with a typed dimension-mismatch error.
- Changing the dimension requires `DROP TABLE claude_flow.memory_entries; CREATE TABLE ... ruvector(${new_dim})`. Out of scope for this ADR; users rebuild the corpus.

Known-model dimension lookup table (for `ONNX_EMBEDDING_MODEL`):

| Model | Dimension |
|---|---|
| `Xenova/all-MiniLM-L6-v2` | 384 |
| `Xenova/all-MiniLM-L12-v2` | 384 |
| `Xenova/all-mpnet-base-v2` | 768 |
| `Xenova/bge-small-en-v1.5` | 384 |
| `Xenova/bge-base-en-v1.5` | 768 |
| `Xenova/gte-small` | 384 |
| `Xenova/gte-base` | 768 |
| `Xenova/e5-small-v2` | 384 |
| `Xenova/e5-base-v2` | 768 |

### What happens to RVF for `memory_*`

**Retired.** Same posture as ADR-0170 took for SQLite under `agentdb_*`:

- `RvfBackend` is no longer instantiated for the memory_* path.
- `DatabaseProvider`'s `'rvf'` selection branch for memory_* is removed.
- `IStorageContract` implementation for memory_* is `PostgresMemoryBackend` (or equivalently named, derived from PR #1569's `memory-bridge.ts` additions).
- The `database-provider.ts` auto-cascade (`'rvf' | 'better-sqlite3' | 'sql.js' | 'json'`) for memory_* is removed entirely. There is no provider list.
- Boot-time validation throws a typed `MemoryBackendInitError` if the postgres path can't initialize.
- Any existing `.rvf` files at the previous memory paths are **not migrated automatically**. Users rebuild the corpus by re-importing through `memory_import_claude` against the new backend, or by writing a one-shot migration script. Out of scope for this ADR.

**RVF stays relevant outside this axis.** RVF is still:
- The persistence format Phase A follow-up #2 in ADR-0174 weighs for `graph_*` substrate (RVF-backed graph storage via ruvector-graph's feature flag).
- A reusable binary format for offline export / archival / cross-fork sharing (not currently wired in fork, but available).
- The substrate for upstream's memory_* axis — which the fork no longer follows here.

`project-rvf-primary` memory needs an explicit update: "RVF was primary for memory_* under ADR-0073 + ADR-0086 + the original framing of this memory. ADR-0175 retires RVF for memory_*; the axis substrate is now `ruvector-postgres` per ADR-0174 Phase A.6. RVF remains relevant for graph_* persistence (ADR-0174 follow-up #2) and for offline/archival use."

### Out of scope

- Migration of existing `.rvf` files to `claude_flow.memory_entries`. Users rebuild from source.
- pglite-mode for memory_* (pglite doesn't ship ruvector-postgres; see Open Follow-up #1).
- Dual-write / hybrid mode between RVF and postgres. Rejected per `feedback-no-fallbacks`.
- `ruvector-postgres` Cypher executor — **not invoked by any Layer 5 method**. Per the per-method analysis in "ruvector-postgres functions consumed by memory_*" below, Layer 5 consumes 4 primitives (column type, index, distance, cast) plus standard pg WHERE/ORDER BY/COUNT/jsonb. Cypher is a graph query language; memory_* is a key-value-with-embedding store. The cypher-verification council's hollow-executor finding is **irrelevant to this ADR**. Cypher belongs on graph_* per ADR-0174.
- pgvector-compatible alternatives (`pgvecto.rs`, `lantern`, `pgvectorscale`, `pg_search`) — see ADR-0174 Path Y standby plan. This ADR commits to ruvector-postgres per ADR-0174 Phase A.6 alignment. If ADR-0174 follow-up #11 triggers Path Y, this ADR follows (see Open Follow-up #5).
- The 8 `ruvector_*` MCP tools in `ruvector-bridge.ts` plugin. Those route via pgvector on a separate code path; orthogonal to memory_*.
- WITNESS_SEG audit-trail equivalent on postgres. Postgres WAL + `pgaudit` is the substitute; per-row ML-DSA-65 PQ signatures (RVF's behavior) do not transplant cleanly to postgres. Audit-trail-critical use cases get a different audit model under this ADR, not an equivalent one.

### Consequences

* Good, because single substrate per axis matches ADR-0170 + ADR-0174 + `feedback-no-fallbacks` discipline. memory_*, agentdb_*, and graph_* axes all enforce mandatory-substrate-or-throw at boot.
* Good, because shared postgres install with ADR-0174 Phase A.6 means one DB to operate, monitor, back up; not RVF + postgres separately.
* Good (Phase 5+), because a handful of ruvector-postgres functions uniquely unavailable in pgvector — local fastembed-inside-postgres (eliminates JS→DB embedding round-trip on `storeEntry`), hyperbolic distance over hierarchical memory keys, built-in hybrid vector+BM25+RRF for `memory_search_unified`, in-column quantization at insert time, SIMD-accelerated batch distance — become opportunistic enhancements memory_* can wire up after Phase 1-4 stabilizes. See "ruvector-postgres functions consumed by memory_*" below for the per-method analysis; Phase 1-4 itself uses only ~4 of the 143 advertised functions.
* Neutral for Phase 1-4 functional surface, because the minimum-viable Layer 5 implementation (CRUD + HNSW k-NN over an embedding column) works identically against pgvector or ruvector-postgres. The choice between them at Phase 1-4 is purely operational (ADR-0174 alignment) not functional. The functional differentiator emerges at Phase 5+.
* Good, because configurable embedding providers (with `feedback-no-api-keys` gating) make the embedding-quality story a deploy-time setting instead of a code change.
* Good, because retiring RVF eliminates a code path the bundle no longer covers — fewer test surfaces, fewer config fields, smaller install matrix surface.
* Bad, because edge / WASM / CI-without-postgres deployments cannot run memory_*. Mitigation: `ruvnet/ruvector-postgres:pg17` Docker image is one `docker run` away; CI runners already running Docker can stand it up; the fork's deployment matrix assumes Docker availability already.
* Bad, because RVF's WITNESS_SEG + ML-DSA-65 PQ signature audit chain retires for memory_*. Mitigation: postgres WAL + `pgaudit` provides an alternative audit model; users with audit-critical requirements understand the change. Open Follow-up #6 documents this explicitly.
* Bad, because RVF's COW branching retires for memory_*. Mitigation: postgres has different branching models (logical replication, schema clones); out of scope for this ADR.
* Bad, because `project-rvf-primary` memory needs explicit retirement (not just amendment) — RVF is no longer primary for memory_*. Phase 5 below handles this.
* Bad, because we inherit upstream PR #1569's adoption-of-a-stalled-PR risk. If upstream eventually merges or rewrites #1569 differently, we may need to reconcile. Mitigation: Open Follow-up #8 considers a fork-side PR back to upstream once Phase 4 validation passes.
* Neutral, because `ruvector_*` MCP tools (the bridge plugin) are unchanged — separate code path using pgvector for a different surface (the "RuVector PostgreSQL Bridge" plugin advertised in USERGUIDE:1934-2050).
* Neutral, because `memory_*` MCP surface (15 tools) is preserved — the change is below the MCP boundary.

### Confirmation

1. **Phase 1 — `PostgresMemoryBackend` module landed** when `@claude-flow/memory/src/postgres-memory-backend.ts` (new module, derived from PR #1569's `memory-bridge.ts` additions, refactored for module-boundary clarity) implements `IStorageContract` against `claude_flow.memory_entries` with `embedding ruvector(${dims})` + `ruhnsw` HNSW index; passes the same operational test suite as the previous `RvfBackend` (store / retrieve / search / delete / list / stats / namespace filtering / tag filtering / TTL).
2. **Phase 2 — RVF retired for memory_*** when `database-provider.ts`'s `'rvf' | 'better-sqlite3' | 'sql.js' | 'json'` cascade for memory_* is removed; `RvfBackend` is no longer instantiated for memory_* paths; `MemoryBackendInitError` throws loudly at boot if postgres path can't initialize; no silent fallback branch exists in the code path.
3. **Phase 3 — configurable embeddings + `feedback-no-api-keys` gating** when `memory-initializer.ts` resolves the embedding provider via `embedding.provider` config + `embedding.allowPaidProvider` flag + `OPENAI_API_KEY`/`OPENAI_EMBEDDING_MODEL`/`ONNX_EMBEDDING_MODEL`/`RUFLO_EMBEDDING_DIMS` env vars; the dimension is materialized in `memory_entries` schema at table-create time and validated against inserts; using OpenAI without `allowPaidProvider = true` throws at boot.
4. **Phase 4 — shared postgres with ADR-0174** when one `pg.Pool` is initialized once at process boot and shared between `@claude-flow/memory`'s postgres backend (this ADR) and `@claude-flow/agentdb`'s `PostgresBackend` (ADR-0170 + ADR-0174); both axes read the same `RUFLO_POSTGRES_URL`; acceptance test stores + retrieves a memory entry AND inserts a causal edge against the same postgres image with both `agentdb` and `claude_flow` schemas populated.
5. **Phase 5 — `project-rvf-primary` memory updated** to reflect retirement for memory_*; new `reference-memory-backend-postgres.md` memory entry documents the env vars / config fields / Docker image / boot validation contract; existing `feedback-no-fallbacks` memory remains in force (this ADR is an instance of it, not a counter-example).
6. **Phase 6 — upstream PR consideration** when Phase 4 acceptance passes in fork, decide whether to PR our adopted-and-modified design back to `ruvnet/ruflo` on Issue #1568 explicitly superseding PR #1569's stalled state. Decision factors: maintainer engagement signal, scope alignment with upstream's compat envelope (likely fork-only adoption; PR may not land), relationship value.

## Pros and Cons of the Options

### Option A — adopt PR #1569 as-is (silent auto-cascade)

* Bad, because silent auto-cascade violates `feedback-no-fallbacks`. Postgres unreachable → falls back to RVF silently → "looks like it worked" while writing to the wrong substrate.
* Bad, because debugging "why is my memory in RVF when I set `RUVECTOR_POSTGRES_URL`?" requires log-line forensics.

### Option B — `ruvector-postgres` exclusive for memory_* (chosen)

* Good, because single substrate per axis; cleanest possible interpretation of `feedback-no-fallbacks`.
* Good, because eliminates the `memory.backend` config field entirely.
* Good, because matches ADR-0170 + ADR-0174's substrate discipline; all three axes (memory_*, agentdb_*, graph_*) enforce mandatory-substrate-or-throw at boot.
* Good, because one postgres install + one extension + one Docker image powers two axes (memory_* + agentdb_*); operational unification per ADR-0174 Phase A.6.
* Bad, because retires RVF for memory_*; edge/WASM/CI-without-Docker deployments lose memory_* capability. Mitigation: fork's deployment matrix already assumes Docker availability.
* Bad, because retires WITNESS_SEG + ML-DSA-65 PQ audit chain for memory_*. Mitigation: postgres WAL + pgaudit substitute; users who need WITNESS_SEG specifically can keep RVF outside the memory_* axis (offline export / archival).
* Bad, because conflicts with `project-rvf-primary` memory — explicit retirement-for-memory_* required (Phase 5).
* Bad, because mandates postgres-server-mode (pglite doesn't ship ruvector-postgres). See Open Follow-up #1 — ADR-0174 Phase A.6 has the same constraint and the question is whether ADR-0170's pglite-default path is now invalidated for both axes.

### Option C — RVF default, postgres opt-in via boot config

* Good, because deterministic substrate selection.
* Bad, because an opt-in IS a fallback in disguise. Half of deployments stay on RVF; the bundle becomes dual-substrate; tests cover two backends; documentation forks; witness chain story branches. The no-fallbacks rule applies half-heartedly.
* Bad, because operational discipline diverges: agentdb_* under ADR-0174 is mandatory-substrate-or-throw, memory_* under this option would be selectable. Discordant.
* Bad, because doesn't actually save the edge/WASM/CI-without-Docker case — those deployments still can't run agentdb_* under ADR-0174 Phase A.6 (which is unconditional). Saving RVF for memory_* doesn't help if agentdb_* requires postgres anyway.

### Option D — don't adopt (keep RVF-only)

* Good, because zero new code; simplest possible state.
* Bad, because forfeits ADR-0174 Phase A.6's operational unification.
* Bad, because production multi-process deployments stuck on RVF lock-file coordination.
* Bad, because configurable embeddings (a real shipping gap per Issue #1568) stay unaddressed; ONNX 384d stays hardcoded.
* Bad, because ignores fork-freedom; upstream PR #1569's stalled state isn't a substrate decision against postgres, just an upstream compat envelope blocker.

### Option E — opt-in with shared postgres + boot-time selection

* Good, because closest to "best of both worlds" optics.
* Bad, same as Option C — selection is a fallback in disguise; bundle dual-substrate; tests dual-coverage; documentation forks; witness chain branches.
* Bad, because the "shared postgres" benefit is partial — operators running the `memory.backend = 'rvf'` mode get no benefit from the shared install they're not using.

## More Information

### Relationship to ADR-0073 (RVF Storage Backend Upgrade)

ADR-0073 established RVF as the canonical memory_* substrate and shipped Phases 1-3 (WAL write path, Rust HNSW, native activation). This ADR **retires RVF as the memory_* substrate** under fork-freedom. ADR-0073's implementation work is not undone — `RvfBackend` and the rvf-runtime crate remain in the fork bundle — but they are no longer wired to memory_* MCP tools. RVF remains available for non-memory uses (graph_* persistence under ADR-0174 follow-up #2; offline export; cross-fork archival).

### Relationship to ADR-0086 (Layer 1 Storage Abstraction)

ADR-0086 defines `IStorageContract`. This ADR adds a new implementer (`PostgresMemoryBackend`) and removes `RvfBackend` from the memory_* selection path. The interface contract is unchanged; only the concrete implementation changes for this axis. `RvfBackend` continues to satisfy `IStorageContract` for any non-memory_* consumer that chooses it.

### Relationship to ADR-0166 (axis-separation framing)

ADR-0166's framing — pick substrates for the shape of the data, not for cross-axis unification — is preserved. memory_* data shape (key-value with embeddings + metadata) maps cleanly to `claude_flow.memory_entries` with `ruvector(N)` embeddings. The substrate change is intra-axis; ADR-0166's between-axis discipline is unaffected.

### Relationship to ADR-0170 (PostgreSQL primary for `agentdb_*`)

ADR-0170 commits postgres as `agentdb_*` substrate and retired SQLite for that axis. This ADR is the analogous move for memory_*: mandate ruvector-postgres + retire RVF. The two axes share one postgres install + one extension. The pglite-embedded default ADR-0170 retains for agentdb_* is now in tension with ADR-0174 Phase A.6's ruvector-postgres commitment — see Open Follow-up #1.

### Relationship to ADR-0174 (graph_* axis introduction + Phase A.6 ruvector-postgres for agentdb_*)

ADR-0174 introduces `graph_*` axis (backed by `ruvector-graph` → redb or RVF-backed) and commits `ruvector-postgres` extension for `agentdb_*` (Phase A.6). This ADR commits `memory_*` to the **same extension on the same postgres install**. Result: agentdb_* and memory_* share one `ruvector-postgres` extension on one postgres instance; graph_* is on a different substrate (`ruvector-graph` crate, not the pgrx extension); RVF is retired from memory_* but candidate for graph_* persistence per ADR-0174 follow-up #2.

ADR-0174 follow-up #11 (Path Y standby plan: pgvector + pgvectorscale + pg_search) is the one place this ADR's substrate could be forced to change: if Path Y triggers for agentdb_*, memory_* would either (a) track Path Y and lose ruvector-postgres-only SQL surfaces (hyperbolic, GNN-in-SQL, fastembed-inside-postgres), or (b) diverge — memory_* keeps ruvector-postgres on its own DB instance while agentdb_* runs pgvector on another. (b) is operational regression; lean (a) if Path Y triggers. See Open Follow-up #5.

### `ruvector-postgres` functions consumed by `memory_*` (minimal surface)

This ADR commits the `agentdb_*`-aligned ruvector-postgres extension as the memory_* substrate, but the **Layer 5 contract** (`IMemoryBackend` in `@claude-flow/memory/src/index.ts`) consumes only a tiny fraction of the 143 SQL functions ruvector-postgres advertises. The breakdown matters for: (a) Phase 1-4 vs Phase 5+ scope; (b) the mechanical-transplant story to Path Y if ADR-0174 follow-up #11 triggers; (c) calibrating the "ship the full surface" framing against actual consumption.

**Required for Phase 1-4 (4 primitives):**

| Primitive | Used by Layer 5 method | Pgvector equivalent |
|---|---|---|
| `ruvector(N)` varlena type | `initialize` (column DDL) | `vector(N)` |
| `ruhnsw` extension index + `ruvector_cosine_ops` operator class | `initialize` (CREATE INDEX) | `hnsw` + `vector_cosine_ops` |
| Cosine distance — operator `<=>` (if exposed) OR function `ruvector_cosine_distance(a, b)` | `search`, `findSimilar` | `<=>` |
| Text-literal cast `'[1.0,2.0,...]'::ruvector` | `store`, `update`, `bulkInsert`, `search` (query binding) | `'[...]'::vector` |

That's it. Four primitives, none of which require Cypher / hyperedges / GNN / SPARQL / attention / RDF triples — i.e., none of the surfaces that distinguish ruvector-postgres from pgvector in the SQL function count.

**Per-Layer-5-method analysis:**

| `IMemoryBackend` method | SQL shape | Beyond the 4 primitives? |
|---|---|---|
| `initialize` / `shutdown` | `CREATE EXTENSION ruvector`, schema/table/index DDL, `pg.Pool.end()` | No |
| `store` / `storeEntry` | `INSERT ... VALUES (..., $emb::ruvector, ...)` | No |
| `get` / `getByKey` | `SELECT ... WHERE id = $1` or `WHERE namespace = $1 AND key = $2` | No |
| `update` / `appendContent` / `addTags` / `removeTags` | `UPDATE ... SET content = ..., tags = array_cat(...)` | No — standard pg array ops |
| `delete` / `bulkDelete` / `clearNamespace` | `DELETE ... WHERE ...` | No |
| `query` | `SELECT ... WHERE namespace = $1 AND tags @> $2 ... ORDER BY ts_updated DESC LIMIT $3` | No — plain pg WHERE/ORDER BY |
| `search` / `findSimilar` | `SELECT id, key, embedding <=> $emb::ruvector AS dist FROM ... ORDER BY dist LIMIT $k` | **The 4 primitives, and only those** |
| `bulkInsert` | per-row `INSERT` or `jsonb_populate_recordset` | No |
| `count` / `getStats` / `listNamespaces` | `COUNT`, `GROUP BY`, `SELECT DISTINCT` | No — plain pg aggregation |
| `healthCheck` | `SELECT 1` | No |
| `shareWith` / `getSharedWith` | `UPDATE ... SET metadata = jsonb_set(...)` / `SELECT WHERE metadata->'sharedWith' @> $1` | No — plain pg jsonb |

**Not used by Layer 5 (rest of the 143 functions):**

- Cypher executor (`ruvector_cypher`) — memory_* makes no MATCH/WHERE/RETURN calls. The cypher-verification council's hollow-executor finding is **irrelevant to this ADR**.
- Hyperedges (`ruvector_hyperedge_*`) — graph concern, not memory.
- GNN layers as SQL functions (`ruvector_gat_layer`, `ruvector_graphsage_layer`, etc., ~15 functions) — graph re-ranking territory.
- Attention mechanisms in SQL (`ruvector_flash_attention` etc., ~39 functions) — compute kernel territory.
- Multi-hop traversal (any `*_traversal` / `*_kHopNeighbors` function) — not a memory_* operation.
- SPARQL / RDF triple operations.
- Causal edge functions (`ruvector_causal_*`) — agentdb_* concern.
- Skill graph functions — agentdb_* concern.

Estimated: of the 143 advertised functions, Layer 5 Phase 1-4 invokes **~4**, Phase 5+ opportunistically uses **~5-10 more**, and the remaining **~130** are agentdb_* / graph_* / out-of-scope territory.

**Phase 5+ optional enhancements unique to ruvector-postgres:**

| Function family | Layer 5 method enhanced | Real value? |
|---|---|---|
| Local fastembed inside postgres (`ruvector_embed_xenova_all_minilm_l6_v2(text)`, 6 model variants) | `storeEntry` passes raw text directly; embedding generated server-side; eliminates JS→DB round-trip | **Yes** — concrete write-latency improvement |
| Hyperbolic distance (`ruvector_poincare_distance`, `ruvector_exp_map`, etc., ~3-5 functions) | `findSimilar` over hierarchical memory key namespaces (`project/component/file/...`) | **Niche** — only useful if keys form a tree |
| Hybrid vector + BM25 + RRF (built-in or composed with `pg_search`) | `memory_search_unified` (currently composed in JS) | **Yes** — moves composition to SQL |
| In-column quantization at insert (Scalar / Product / Binary / Half) | `store` with quantization mode set at column-create | **Yes for scale** — 4-32× memory reduction at million-entry scale |
| SIMD-accelerated batch distance (`ruvector_batch_distance`) | Internal HNSW build/rebuild | **Maybe** — only matters if rebuild frequency is high |

Phase 1-4 sticks to the 4 primitives so the substrate swap is self-contained. Phase 5+ work (new ADRs or follow-up work in this ADR) wires the optional surfaces opportunistically.

**Mechanical-transplant property (load-bearing for ADR-0174 follow-up #11 / Path Y):**

Because Phase 1-4 uses only the 4 primitives that have direct pgvector equivalents, the Phase 1-4 implementation **transplants mechanically** to Path Y (pgvector + pgvectorscale + pg_search) with substitutions:

| ruvector-postgres | pgvector + companions |
|---|---|
| `ruvector(N)` column type | `vector(N)` |
| `ruhnsw` index access method | `hnsw` (pgvector built-in) |
| `ruvector_cosine_ops` operator class | `vector_cosine_ops` |
| `'[...]'::ruvector` cast | `'[...]'::vector` |

Zero algorithmic changes. Just textual substitutions in the table DDL + INSERT/SELECT statements. Phase 5+ surfaces would need redesign around Path Y equivalents (`pg_search` for hybrid; node-side embeddings for everything else; hyperbolic distance moves to application layer or is dropped). This means **Phase 1-4 substrate commitment is reversible**; the lock-in to ruvector-postgres specifically only happens at Phase 5+. This refines Open Follow-up #5's Path-Y-coupling decision: if Path Y triggers during Phase 1-4, the migration cost is ~30 minutes of search-and-replace plus re-running acceptance tests. If Path Y triggers after Phase 5+ is committed, the migration cost includes redesigning the Phase-5+ surfaces.

### Research record (2026-05-12 session)

#### Upstream PR #1569 — design adopted with modifications

| Aspect | PR #1569 (upstream) | This ADR (fork) |
|---|---|---|
| Substrate selection model | Silent auto-cascade: postgres if `RUVECTOR_POSTGRES_URL` set + reachable; else RVF/SQLite | **No selection.** ruvector-postgres mandatory; throws at boot if unavailable. |
| Extension | `ruvector-postgres` (`ruvector(N)` type + `::ruvector` cast) | Same |
| Schema | `claude_flow.memory_entries` | Same |
| Default embedding | OpenAI `text-embedding-3-small` (1536d) when `OPENAI_API_KEY` set, ONNX 384d otherwise | OpenAI gated behind `embedding.allowPaidProvider = true` + `OPENAI_API_KEY`; ONNX (384d default) otherwise; **`feedback-no-api-keys` discipline enforced**. |
| Configurable dims | `RUVECTOR_EMBEDDING_DIMS` env var | Renamed `RUFLO_EMBEDDING_DIMS` (with `RUVECTOR_EMBEDDING_DIMS` as accepted alias) |
| Shared with agentdb_* | Not addressed | **Explicit** — same `pg.Pool`, same `RUFLO_POSTGRES_URL`, two schemas (`agentdb` + `claude_flow`) |
| RVF retention | Kept as fallback | **Retired for memory_*** |
| Issue resolution | Fixes Issue #1568's 5 listed failures | Same five + dimension validation + `feedback-no-api-keys` gate |
| Status | Open, stalled 33 days, branch deleted, 0 approvals, `mergeable: false` | Fork-adopted with the modifications above |

#### Upstream Issue #1568 — gap inventory (verbatim)

> "1. `CLAUDE_FLOW_MEMORY_BACKEND=postgres` silently ignored — `normalizeMemoryBackend()` in `config-adapter.ts` has no `'postgres'` case, falls through to `'hybrid'` (SQLite)
> 2. `@claude-flow/memory` not in CLI dependencies — `import('@claude-flow/memory')` fails silently, `bridgeAvailable = false`
> 3. `pg` (node-postgres) not in dependencies — bridge can't connect to PostgreSQL
> 4. RuVector bridge plugin never loaded — exists in `@claude-flow/plugins` but never imported by MCP server
> 5. `RUVECTOR_POSTGRES_URL` not read anywhere — zero occurrences in codebase"

Fork inherits these gaps via upstream sync. Phase 1-4 address all five plus the dimension-validation and `feedback-no-api-keys` gates upstream's PR omitted.

#### Live memory_* MCP→substrate trace (upstream main, refreshed 2026-05-12)

```
15 memory_* MCP tools  →  @claude-flow/memory  →  database-provider.ts selector
  →  priority: 'rvf' (tries first) → 'better-sqlite3' → 'sql.js' → 'json'
  →  RvfBackend → @ruvector/rvf → @ruvector/rvf-node NAPI → rvf-runtime Rust → .rvf
```

After this ADR's Phase 1-4 in fork:

```
15 memory_* MCP tools  →  @claude-flow/memory  →  PostgresMemoryBackend (sole)
  →  shared pg.Pool (with @claude-flow/agentdb's PostgresBackend per ADR-0170/0174)
  →  CREATE EXTENSION ruvector
  →  claude_flow.memory_entries with embedding ruvector(${dims}) + ruhnsw HNSW index
```

If pg.Pool init fails or extension is unavailable, all 15 memory_* tools throw at boot. No silent fallback to RVF. No silent fallback to sql.js.

#### `ruvector-postgres` SQL surfaces directly applicable to memory entries

Once committed:

- **Hyperbolic distance functions** (`ruvector_poincare_distance`, `ruvector_exp_map`, etc.) — usable for hierarchical memory namespaces (memory keys forming a tree).
- **Hybrid vector + BM25 + RRF fusion** — `memory_search` can blend semantic + keyword retrieval natively.
- **In-column quantization** (Scalar / Product / Binary / Half-Prec) — memory entries written compressed; saves storage at scale.
- **SIMD distance ops** (AVX-512 / AVX2 / NEON / scalar) — faster than HnswLite's JS-side cosine.
- **Local fastembed inside postgres** (6 models) — text → vector inside the DB; bypasses node-side embedding generation. (Subject to `feedback-no-api-keys` discipline — fastembed is local-only, no paid API; safe by default.)

Phase 5+ work (out of scope for this ADR's initial commit) will progressively wire these into `memory_search` and friends. Phase 1-4 sticks to basic CRUD + HNSW so the substrate swap is self-contained.

#### Memory entries consulted

- `project-rvf-primary.md` — current statement: "RVF is primary for memory_*". This ADR retires the statement for memory_*; RVF stays relevant elsewhere (graph_* persistence; offline use).
- `feedback-no-fallbacks.md` — load-bearing. This ADR is an instance of the rule, not a counter-example. Option A/C/E rejections trace directly to this memory.
- `feedback-no-value-judgements-on-features.md` — authorizes adopting PR #1569's design under fork-freedom.
- `feedback-no-api-keys.md` — load-bearing for embedding provider design. `embedding.allowPaidProvider` gate exists because of this memory; default is `false`; never silently use a key set for another purpose.
- `feedback-upstream-means-upstream.md` — all upstream citations sourced from `ruvnet/*`, verified live against GitHub 2026-05-12.
- `feedback-best-effort-must-rethrow-fatals.md` — boot-validation failures throw; never swallowed.

### Memory entries this ADR would touch

- `project-rvf-primary.md` — explicit retirement-for-memory_*: "RVF was primary for memory_* under ADR-0073 + ADR-0086. ADR-0175 retires RVF for memory_*; the axis substrate is now `ruvector-postgres` per ADR-0174 Phase A.6. RVF remains relevant for graph_* persistence (ADR-0174 follow-up #2) and for offline/archival use."
- New `reference-memory-backend-postgres.md` — pointer entry documenting `RUFLO_POSTGRES_URL`, `RUFLO_EMBEDDING_DIMS`, `embedding.provider`, `embedding.allowPaidProvider`, Docker image, schema layout, boot validation contract.

### Open follow-ups

1. **pglite vs postgres-server reconciliation across both axes.** ADR-0170 Phase A.4 lists `pglite` as the default backing for `agentdb_*`. ADR-0174 Phase A.6 commits ruvector-postgres extension. ADR-0175 (this ADR) does the same for memory_*. **`@electric-sql/pglite` ships pgvector as a subpath export; it does not ship ruvector-postgres.** Consequence: both axes' commitments mandate postgres-server-mode, which contradicts ADR-0170's pglite-default. Reconcile before Phase 1 commits: (a) accept that ruvector-postgres mandates postgres-server-mode for all axes and revise ADR-0170 Phase A.4 accordingly; (b) fork-patch pglite to ship ruvector (multi-month work; out of scope); (c) split the axes onto different postgres instances (operational regression). **Lean (a)** — the simplest reconciliation and aligns with ADR-0174 Phase A.6's Docker image.
2. **Env var namespace consolidation.** `RUVECTOR_POSTGRES_URL` (PR #1569), `AGENTDB_POSTGRES_URL` (current agentdb_* code), and the new `RUFLO_POSTGRES_URL` need to converge. Lean: accept all three as aliases for transition; `RUFLO_POSTGRES_URL` is canonical; emit deprecation warnings when only the aliases are set.
3. **`feedback-no-api-keys` compliance audit.** Beyond the `embedding.allowPaidProvider` gate, audit every code path the embedding system can take to ensure no `process.env.OPENAI_API_KEY` is dereferenced without the gate being checked first. Cover transitive callers from `memory-initializer.ts`, `memory-bridge.ts`, MCP-tool handlers, and ControllerRegistry initialization. Acceptance gate: with `embedding.allowPaidProvider = false` set, no code path can produce a network call to api.openai.com regardless of environment.
4. **Acceptance test coverage.** Add to the fork's acceptance suite:
   - Boot with `RUFLO_POSTGRES_URL` set against `ruvnet/ruvector-postgres:pg17,graph-complete,gated-transformer`; verify `claude_flow.memory_entries` schema created with correct dim.
   - Boot with `RUFLO_POSTGRES_URL` unset; verify typed `MemoryBackendInitError` thrown at MCP-server startup.
   - Boot with `RUFLO_POSTGRES_URL` pointing at unreachable host; verify classifyPgError-style typed throw.
   - Boot with valid `RUFLO_POSTGRES_URL` but postgres image missing `ruvector` extension; verify typed throw on `CREATE EXTENSION` step.
   - Store 100 memory entries, run `memory_search`, verify ruhnsw HNSW index used (EXPLAIN ANALYZE).
   - Verify `memory.backend = 'rvf'` config field does NOT exist (rejected by config validation).
   - Verify `embedding.provider = 'openai'` without `allowPaidProvider = true` throws at boot.
   - Run alongside ADR-0174 Phase A.6 acceptance test against same postgres image, both schemas populated, both tools (memory_store + agentdb_causal-edge) writing successfully.
5. **ADR-0174 Path Y coupling.** If ADR-0174 follow-up #11 triggers Path Y (pgvector + pgvectorscale + pg_search instead of ruvector-postgres for agentdb_*), this ADR's substrate must follow — memory_* on ruvector-postgres + agentdb_* on pgvector on one DB is impossible (ruvector-postgres README: "drop-in pgvector replacement … not designed to coexist"). **Phase-dependent migration cost:** per the "Mechanical-transplant property" finding above, Phase 1-4's migration to Path Y is ~30 minutes of mechanical textual substitution (4 primitives swap to pgvector equivalents), zero algorithmic changes. Phase 5+ migration cost includes redesigning the optional surfaces (fastembed → node-side, hyperbolic → application layer or dropped, hybrid → `pg_search` composition). Implication: **delay Phase 5+ commits until ADR-0174 follow-up #7 (install verification) and follow-up #11 (Path Y trigger conditions) are resolved.** Phase 1-4 can land immediately without exposure to Path Y switching cost.
6. **Witness-chain divergence documentation.** RVF: WITNESS_SEG + ML-DSA-65 PQ signatures per segment. Postgres + ruvector-postgres: WAL + (optional) `pgaudit` extension. Document the divergence in user-facing config docs. Users with audit-chain requirements who need WITNESS_SEG specifically have to manage that separately (offline RVF export of memory_* state on a schedule, etc.) — out of scope for this ADR.
7. **Module naming.** PR #1569 added postgres path inside `memory-bridge.ts` (existing file). Fork creates a dedicated `postgres-memory-backend.ts` module for boundary clarity; matches the existing file-naming pattern in `@claude-flow/memory/src/` (`rvf-backend.ts`, `sqlite-backend.ts`, `sqljs-backend.ts`, `agentdb-backend.ts`, etc.).
8. **Upstream PR back to ruvnet/ruflo.** Once Phase 4 passes, decide whether to PR our adopted-and-modified design back as a comment-on / supersedes-of PR #1569 on Issue #1568. The fork's modifications (no-fallback enforcement, `feedback-no-api-keys` gate, shared pg.Pool with agentdb, deterministic boot validation) are exactly the kind of changes upstream maintainers may want to consider — or may decline to take given their compat envelope. Plan submission as separable commits so upstream can pick the parts they want.
