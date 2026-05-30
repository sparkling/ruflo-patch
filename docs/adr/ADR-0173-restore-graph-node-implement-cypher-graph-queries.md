---
status: superseded
date: 2026-05-12
tags: [graph-database, cypher, apache-age, postgres]
supersedes: []
depends-on: [ADR-0170, ADR-0172]
implements: []
---

> **Superseded by [ADR-0174](ADR-0174-introduce-graph-axis-ruvector-graph-engine.md) (2026-05-12), which itself was superseded by [ADR-0177](ADR-0177-adopt-upstream-agentdb-rvf-vision.md) (2026-05-12). See ADR-0177 for current graph-workload strategy.** ADR-0174 frontmatter declares `supersedes: [ADR-0173]` and §"What changes about ADR-0173" documents that AGE is not installed, no per-connection `LOAD 'age'` hook, no agtype marshalling, no `Dockerfile.age`. ADR-0177 then retires the postgres/pglite substrate entirely (per upstream ADR-006's no-pgvector mandate), making the PG14+ `CYCLE` clause migration moot. R3 council transcripts at `docs/council/ADR-0173-graph-db-council-r{1,2,3}-transcript.md` remain as evidence of the question's evolution.

# Graph workload strategy: Apache AGE on PG-server + E-Hardened CYCLE for existing recursive callsites

## Context and Problem Statement

ADR-0170 Phase D (gap-J resolution, 2026-05-11) retired `@ruvector/graph-node` from the agentdb_* substrate on three grounds: (1) the Cypher WHERE evaluator at `GraphDatabaseAdapter.ts:246` was admittedly incomplete; (2) `enableGraph: false` was the de facto default; (3) `createHyperedge`/`searchHyperedges` had zero in-fork call sites. The retirement reduced the on-disk format count to 2 (postgres + RVF), satisfying ADR-0166's consolidation goal.

A user audit on 2026-05-12 (post-ADR-0170 acceptance) flagged that the retirement may have over-reached: upstream `ruvnet/agentdb` ADR-007 lists `@ruvector/graph-node` as HIGH-priority Phase 1 integration work (Cypher querySync, transactions, batch insert) and upstream `ruvnet/ruflo` USERGUIDE features Cypher graph queries as a headline capability. The user invoked `feedback-no-value-judgements-on-features` ("Don't curate features — import ALL upstream/orphaned capability") to challenge the retirement.

The fork has graph-shaped data and graph consumers across multiple layers:

- **5 decision-record skills** (`adr-index`, `adr-create`, `odr-index`, `odr-create`, `odr-review`) maintain typed-relation dependency graphs (`supersedes`/`depends-on`/`implements`) via `mcp__ruflo__agentdb_causal-edge` + `agentdb_hierarchical-store` MCP tools
- **13+ graph-shaped MCP tools** registered in `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`: causal-edge, causal-query, graph_node_create/get, graph_edge_create, hierarchical_*, skill_*
- **`forks/ruflo/v3/@claude-flow/memory/src/memory-graph.ts`** (405 LoC pure-TS): in-process knowledge graph with PageRank + Louvain/label-propagation
- **`forks/agentdb/src/controllers/SparsificationService.ts`**: Personalized PageRank, spectral methods, random walk over adjacency lists
- **`forks/ruflo/v3/@claude-flow/plugins/src/integrations/ruvector/gnn.ts`**: GNN analysis surface
- **Coordination agents** (`pagerank-analyzer`, `mesh-coordinator`, `consensus-coordinator`, `topology-optimizer`)

ADR-0170 Phase B explicitly ported `CausalMemoryGraph.ts` to use postgres `WITH RECURSIVE` (lines 469 and 532) for 5-hop causal chain traversal with cycle prevention via `path NOT LIKE '%X%'` substring scans — an O(N²) anti-pattern on cyclic graphs of any meaningful size.

The decision space the user opened (PG-server-mode acceptable; OSS / self-hosted only; pglite dropped as embedded target; PR #375 patchable in-fork):

- **Option A** — Restore `@ruvector/graph-node` (npm pkg, NAPI to Rust `ruvector-graph` crate). User-explicit framing for ADR-0173 originally.
- **Option B** — Apache AGE on PostgreSQL server (Cypher inside postgres; ASF top-level project).
- **Option C** — `ruvector-postgres@0.3.0` (Rust pgrx extension embedding Cypher AST + parser + executor inside postgres).
- **Option D** — OSS property graph DB (Neo4j CE / JanusGraph / Memgraph / KuzuDB / NebulaGraph / ArangoDB / Dgraph / TerminusDB / LadybugDB / Vela-Engineering/kuzu).
- **Option E** — Status quo + native PG14+ `CYCLE` clause (E-Hardened): rewrite `path NOT LIKE` cycle detection to standard SQL `CYCLE … SET is_cycle USING path_array`; add covering indices; capture telemetry.

## Decision Drivers

* **User-binding constraints**: OSS / self-hosted only; PG-server is the substrate (pglite dropped); no commercial managed services (RDS / Supabase / Neon / Cloud SQL excluded); capability-driven framing (graphs haven't been available, so absence of multi-hop callsites is consequence, not signal); patch-repo charter permits in-fork engine work (`feedback-patches-in-fork`).
* **`feedback-no-value-judgements-on-features`** — "ship the full surface that already exists upstream"; this authorizes adopting AGE's existing openCypher engine but does NOT authorize building a new Cypher executor from scratch.
* **`feedback-no-fallbacks`** — shipping a Cypher API whose `query()` silently no-ops (hollow execution) violates fail-loud invariants.
* **`feedback-data-loss-zero-tolerance`** — hollow `query()` returning silently wrong results is an answer-correctness data-loss issue.
* **ADR-0170 substrate consolidation** — agentdb_* axis is PG-server (pglite-embedded retired by user directive); choice should not bifurcate substrate.
* **License hard-blocks**: Neo4j CE (GPLv3), Memgraph (BSL), ArangoDB (BSL ≥3.12), FalkorDB (source-available SSPL).
* **Capability surface latent**: 5 skills + 13 MCP tools + memory-graph.ts + Sparsification + GNN + coord agents = real graph workload that's currently linearized into SQL, in-process TS, or stub-routed via MCP tools to non-graph stores.

## Considered Options

* **Option A** — Restore `@ruvector/graph-node` + patch the Cypher executor in-fork.
* **Option B** — Apache AGE on PG-server alongside pgvector.
* **Option C** — `ruvector-postgres` Cypher extension.
* **Option D** — OSS property graph DB (Vela-Kuzu / LadybugDB / JanusGraph / HugeGraph / NebulaGraph / Dgraph / TerminusDB).
* **Option E** — Status quo + PG14+ `CYCLE` clause migration (E-Hardened).
* **Option B + Option E composition** — AGE as primary graph substrate + E-Hardened CYCLE for the 2 existing recursive callsites on the same PG-server.

## Decision Outcome

Chosen option: **Option B (Apache AGE) as the load-bearing graph substrate on PG-server + Option E (E-Hardened CYCLE clause migration) for the 2 existing recursive-CTE callsites in `CausalMemoryGraph.ts`, running alongside AGE on the same PG-server.**

Rationale (council deliberation across three rounds, full transcripts in `docs/council/`):

1. **PG-server-only deployment collapses AGE's prior deployment-blocker.** Under R1/R2 framing, AGE-not-in-pglite was a material concern. R3's drop-pglite-forever directive nullifies it. AGE is no longer "for some users" — it IS the substrate.
2. **The capability surface is real but doesn't push toward Cypher syntax specifically — it pushes toward typed-edge LPG persistence + graph algorithms.** AGE delivers the LPG storage shape cleanly. Cypher comes free for future callsites. Graph algorithms (PageRank, Louvain, PPR) stay substrate-orthogonal via in-process TS or Rust/NAPI.
3. **Option A's "graph-node Cypher patch" is engine construction, not patching.** Direct source-read evidence: `crates/ruvector-graph/src/executor/mod.rs:129-133` is a placeholder returning `Vec::new()` unconditionally; all 21 Cypher execution tests have `db.execute()` assertions commented out. Realistic Rust scope: 2,000-5,000 LoC + tests, multi-person-month. `feedback-no-value-judgements-on-features` authorizes shipping upstream features that exist; AGE has the surface, graph-node has only a parser.
4. **Option C (ruvector-postgres) confirmed partially hollow.** DA direct read of `crates/ruvector-postgres/src/graph/cypher/executor.rs` (632 LoC): MATCH/CREATE/RETURN real; WHERE evaluates globally not per-row (broken); SET/DELETE/WITH are stubs; variable-length paths missing; multi-hop transitive joins missing.
5. **Option D candidates eliminated by deployment topology**: Kuzu/LadybugDB/Vela-Engineering/kuzu have no live server-mode option (`kuzudb/api-server` archived 2025-10-10; Kuzu is embedded-only by design; Vela's fork preserves that). JanusGraph requires Cassandra/HBase backing. HugeGraph + NebulaGraph add a second daemon for capability AGE delivers in the same substrate. Neo4j CE / Memgraph / ArangoDB blocked by license.
6. **Native PG14+ `CYCLE … SET … USING …`** is the canonical replacement for `path NOT LIKE` substring cycle detection. Wins on indexed array-membership semantics; standard SQL; runs alongside AGE on the same PG-server with no codepath overlap.

### Scope

**AGE adoption** (Option B):

1. Add Apache AGE extension to the agentdb PG-server install. Pin to AGE 1.6.0 stable + PG16 initially; bump to 1.7.0 GA + PG17 when AGE 1.7.0 GA ships.
2. In `forks/agentdb/src/backends/postgres/PostgresBackend.ts`, add per-connection initialization hook: `LOAD 'age'; SET search_path = ag_catalog, "$user", public;`. Boot-time validation: smoke-query `SELECT * FROM cypher('_smoke', $$ MATCH (n) RETURN n LIMIT 0 $$) AS (v agtype)` — fail loud if AGE unreachable.
3. Configure `shared_preload_libraries = 'age'` in postgresql.conf for PgBouncer transaction-mode compatibility.
4. Ship `forks/agentdb/docker/Dockerfile.age` based on `apache/age:PG17_latest` (or apt-installed for non-Docker installs).
5. New MCP tool: `agentdb_cypher_query` (auth + parameterized) backed by AGE.
6. Existing `agentdb_graph_node_create / graph_edge_create / graph_node_get` MCP tools (currently returning errors per the disabled-by-default `graphAdapter` controller — see ADR-0172) re-implemented against AGE-backed storage.
7. **AGE wired-but-unused for immediate post-decision state.** Existing graph consumers (5 skills, memory-graph.ts, MCP tools routing through RVF namespaces, coord agents) do NOT migrate to AGE in this ADR's scope. Migration of each consumer is a separate decision when a callsite genuinely benefits — avoids "build empty surfaces" anti-pattern.

**E-Hardened migration** (Option E, same PG-server):

1. Rewrite `forks/agentdb/src/controllers/CausalMemoryGraph.ts:469` (`getCausalChain`) and `:532` (`getCausalChainWithAttention`) from `path NOT LIKE '%X%'` substring cycle detection to PG14+ `CYCLE id SET is_cycle USING path_array`. Path becomes integer array; line 506's `row.path.split('->').map(Number)` simplifies to direct array consumption.
2. Add covering indices:
   - `CREATE INDEX IF NOT EXISTS idx_causal_edges_from_conf ON causal_edges(from_memory_id, confidence) WHERE confidence >= 0.5;`
   - `CREATE INDEX IF NOT EXISTS idx_skill_links_parent_rel_weight ON skill_links(parent_skill_id, relationship, weight DESC);`
3. Add p50/p95 telemetry spans around both `getCausalChain` and `getCausalChainWithAttention`. **No measured baseline exists today — telemetry capture MUST precede the migration.**

### Out of scope

* **Migration of existing graph consumers to AGE-backed storage.** Each consumer migrates when its callsite materially benefits, decided per consumer.
* **AGE graph algorithm integration** (PageRank, Louvain, etc.). PPR stays in `@ruvector/sparsifier` (NAPI/WASM); `memory-graph.ts` keeps in-process pure-TS PageRank/Louvain. Substrate-orthogonal; revisit if a future callsite needs in-DB analytics.
* **Hyperedge primitives.** No consuming callsite; junction-table reification suffices when needed.
* **graph-node Cypher patch** (Option A scope). Deferred to watch state with named trigger criteria below.

### Consequences

* Good, because the agentdb_* substrate stays single (PG-server) — backup, replication, PITR, connection pooling, auth all inherit postgres-standard tooling. One backup story, one restore drill, one HA pattern.
* Good, because `agentdb_cypher_query` and AGE-backed graph MCP tools provide a real openCypher engine for future graph workloads (decision-record traversal, ADR/ODR dependency queries, future LPG-shaped consumers).
* Good, because E-Hardened on the 2 existing recursive-CTE sites uses standard PG14+ `CYCLE` syntax — planner-friendly, indexed, no string-scan anti-pattern, no engine swap.
* Good, because Vela-Kuzu, LadybugDB, and Kuzu are all eliminated on architectural grounds (embedded-only, no live server mode) — the council reached this honestly rather than dismissing on maintenance fears.
* Good, because hollow-Cypher findings in A and C are recorded in the council transcripts as load-bearing evidence — future revisits won't repeat the audit.
* Bad, because AGE adds a build/install dependency to the agentdb PG-server target. Mitigation: Dockerfile-baked install; install matrix pinned to one PG major per release; apt repo packages available for major distros.
* Bad, because `agtype` return values require marshalling at the controller layer (vs JSONB which is already idiomatic). For analyst-shaped queries needing NetworkX-style traversal, this is real but bounded overhead; ruflo's in-process algorithms bypass it entirely.
* Bad, because AGE's openCypher coverage has documented quirks (NULL handling in list comprehensions, `WHERE EXISTS { ... }` crashes, `MATCH` after `WITH` boundary edge cases). Ruflo's planned Cypher use avoids these; document the no-go list in the AGE wrapper.
* Neutral, because the AGE wired-but-unused initial state honors capability-driven framing (capability is present for future consumers) without forcing premature migration (avoids "build empty surfaces").
* Neutral, because graph-node deferral leaves the user's "we can easily fix it" claim on the table for future reconsideration with named triggers.

### Confirmation

Compliance is verified by:

1. **AGE foundation lands** when `apache/age` extension is loadable on the agentdb PG-server target; `forks/agentdb/src/backends/postgres/PostgresBackend.ts` emits the `LOAD 'age'; SET search_path = ag_catalog, "$user", public;` prelude on every connection acquire; boot validation smoke-query passes against a tiny known graph; failing-to-load AGE throws loudly at boot per `feedback-no-fallbacks`.
2. **E-Hardened CYCLE migration lands** when `forks/agentdb/src/controllers/CausalMemoryGraph.ts` no longer contains `path NOT LIKE` and uses `CYCLE id SET is_cycle USING path_array` instead; covering indices `idx_causal_edges_from_conf` and `idx_skill_links_parent_rel_weight` exist; p50/p95 telemetry spans emit metrics on both `getCausalChain` and `getCausalChainWithAttention`.
3. **`agentdb_cypher_query` MCP tool exists** with parameterized inputs (no string-concat Cypher); request/response contract test ensures fail-loud on AGE unavailable.
4. **Council transcripts linked** from the ADR `## More Information` section: `docs/council/ADR-0173-graph-db-council-r1-transcript.md`, `-r2-transcript.md`, `-r3-transcript.md`.

### Watch triggers for Option A reconsideration

Defer Option A (graph-node + Cypher patch in fork) but reopen if any of these materialize:

* A Cypher operator ruflo needs that AGE doesn't ship (with documented failure mode against an actual workload).
* A hyperedge callsite where junction-node reification is provably insufficient (e.g., n-ary causal-attribution semantics that lose information when binarized).
* An embedded-Rust execution path requirement orthogonal to Cypher syntax (e.g., future need to run graph queries inside a Rust agent process without round-tripping through postgres).

Without one of these triggers, Option A stays deferred. `feedback-no-value-judgements-on-features` is read as "ship the surface upstream has," not "build the surface upstream is missing."

## Pros and Cons of the Options

### Option A — Restore `@ruvector/graph-node` + patch Cypher executor

* Good, because hyperedges are unique to A among OSS options.
* Good, because PR #375 is a small 3-function reorder (144 LoC), patchable in `forks/ruvector/` per `feedback-patches-in-fork`.
* Good, because Rust integration aligns with RuVector ownership patterns the fork already maintains.
* Bad, because `crates/ruvector-graph/src/executor/mod.rs:129-133` is a placeholder returning `Vec::new()` unconditionally — there is no Cypher executor to expose. README claim "Parse and execute Cypher queries" is misleading; parsing only.
* Bad, because the patch scope is engine construction (2,000-5,000 LoC Rust + 1,000-2,000 LoC tests) — multi-person-month work substituting for AGE's mature engine.
* Bad, because A's standalone redb-backed process is a separate substrate from postgres — no cross-engine joins for hybrid graph+vector+relational queries.
* Bad, because no consuming callsite needs hyperedges (every existing graph use is binary); the unique advantage is unconsumed.

### Option B — Apache AGE on PG-server + pgvector composition

* Good, because AGE ships a real OpenCypher engine today (with documented quirks).
* Good, because single PG-server substrate — backup, HA, auth, observability all inherit postgres patterns; zero new ops surface beyond an extension install.
* Good, because AGE composes with pgvector in the same query plan (single transaction, single MVCC snapshot, no cross-process tax).
* Good, because Apache Software Foundation top-level project — active commit cadence, governance stability, license-clean (Apache 2.0).
* Good, because user explicitly authorized server-mode dependency.
* Bad, because AGE source-build per PG major version × per arch is real but bounded under self-hosted-only (one PG major per ruflo release).
* Bad, because per-connection `LOAD 'age'; SET search_path...` ritual is a footgun if missed; mitigated by `PostgresBackend.ts` connection-acquire hook with boot validation.
* Bad, because `agtype` return values require marshalling layer at the controller; bounded overhead for analyst-shaped queries.
* Bad, because variable-length-path queries in AGE bypass postgres indexes (Trendyol production writeup); mitigated by keeping `CausalMemoryGraph.ts` 5-hop traversal on E-Hardened SQL, not AGE Cypher.

### Option C — `ruvector-postgres@0.3.0` Cypher extension

* Good, because PG-substrate-aligned (in-postgres-process, single-plan hybrid with pgvector preserved).
* Good, because Rust integration matches RuVector ownership.
* Bad, because executor is partially hollow: WHERE evaluates globally not per-row; SET/DELETE/WITH are stubs; variable-length paths missing; multi-hop transitive joins missing; AND/OR/IS NULL/IN/arithmetic unsupported.
* Bad, because patch scope to make executor functional for ruflo's queries is ~540 LoC minimum (2-3 engineer-weeks); for broader Cypher subset, 1,500-3,000+ LoC.
* Bad, because ruvector-postgres ships its own parallel Cypher AST + parser + executor independent of `ruvector-graph` crate (two parallel implementations in same upstream repo).
* Bad, because production issues `#48` (HNSW access methods disabled >5 months) and `#271` (HNSW interferes with planner, Fly.io production failure) suggest the crate is not production-grade.

### Option D — OSS property graph DB (Vela-Kuzu / Lady / JanusGraph / HugeGraph / NebulaGraph / Dgraph / TerminusDB)

* Good, because Vela-Engineering/kuzu inherits Kuzu's real Cypher executor + concurrent multi-writer.
* Good, because JanusGraph (Apache 2.0) has TinkerPop ecosystem and is production-proven at billion-edge scale.
* Bad, because Kuzu / LadybugDB / Vela-Kuzu are embedded-only by design (per Kuzu docs verbatim). `kuzudb/api-server` (the only REST wrapper) archived 2025-10-10. Under PG-server-only deployment topology, embedded-Kuzu-in-Node ≡ embedded-pglite-in-Node (eliminated by user directive).
* Bad, because JanusGraph mandates Cassandra/HBase backing store — heavier operational substrate than AGE-in-PG.
* Bad, because HugeGraph + NebulaGraph add a second daemon for capability AGE delivers in the same substrate.
* Bad, because Neo4j CE (GPLv3), Memgraph (BSL/MEL), ArangoDB (BSL) are all license-blocked for the fork's distribution posture.
* Bad, because NetworkX-native interop advantage that some Round 1/2 framings cited is Python-only — irrelevant for ruflo's JS/Rust runtime.

### Option E — Status quo + PG14+ CYCLE clause migration (E-Hardened)

* Good, because two sites, one file (`CausalMemoryGraph.ts`), one migration; ~50 LoC + 2 indices; zero new substrate.
* Good, because PG14+ native `CYCLE … SET … USING …` is standard SQL; planner uses indexed array-membership; no `path NOT LIKE` substring-scan anti-pattern.
* Good, because runs on the same PG-server as AGE; no codepath overlap, no fallback path.
* Bad, because doesn't deliver Cypher syntax for future graph-shaped consumers; doesn't deliver LPG typed-edge storage; doesn't help the broader capability surface.
* Bad, because on its own, capability ceiling is real — every new graph workload re-derives semantics in SQL.

## More Information

Original metadata: marked `completed: true`. This decision is superseded by ADR-0174 (which was itself superseded by ADR-0177); see the banner at the top and ADR-0177 for the current graph-workload strategy.

### Council deliberation

This ADR's verdict emerged from three rounds of dialectical deliberation in the `graph-db-council` agent team (mesh topology, 8 participants: 6 specialist experts + devil's-advocate + queen-orchestrator, with queen and DA participating alongside experts in real-time per `feedback-council-queen-da-alongside-experts.md` for R3).

* **Round 1 transcript**: `docs/council/ADR-0173-graph-db-council-r1-transcript.md` — initial framings; verdict: E-Hardened + additive AGE for server-mode; DA fact-checks (pglite-AGE doesn't exist; Vela "phantom" R1 finding later corrected in R2; PG14+ CYCLE clause).
* **Round 2 transcript**: `docs/council/ADR-0173-graph-db-council-r2-transcript.md` — constraint reframing (pglite-AGE moot under PG-server-mode; PR #375 fixable; OSS+self-hosted only); load-bearing hollow-Cypher finding for graph-node and ruvector-postgres; verdict: E-Hardened primary + AGE additive.
* **Round 3 transcript**: `docs/council/ADR-0173-graph-db-council-r3-transcript.md` — drop-pglite-forever directive; capability-driven framing replaces consumer-driven; team-lead reconnaissance surfaces real consumer surface (5 skills + 13 MCP tools + memory-graph.ts + Sparsification + GNN + coord agents); 5/6 experts converge on AGE; final verdict locks in.

### Honest acknowledgment of evolution

Queen's framing (R3): "R1's 'additive AGE' was right for a dual-substrate world; R2's 'E-Hardened primary' was right when no consumers existed; R3's 'AGE primary on PG-only with E-Hardened on the side' is right under the actual deployment-target + capability-surface constraints. Each round was correct for the inputs it had; what changed is the inputs."

Material errors corrected across rounds:

* **R1**: postgres-architect's "AGE bundled in pglite" claim — DA verified as false; pglite has no AGE WASM build.
* **R2**: DA's "Vela fork is phantom" finding — `Vela-Engineering/kuzu` exists; DA search terms missed it; corrected in R2 by performance-engineer + R3 confirmation by oss-graph-landscape.
* **R2**: ruvector-status-analyst's "ruvector-graph has Cypher executor we just need to expose" assumption — direct source-read in R3 confirmed `execute_sequential` is a placeholder returning `Vec::new()`.
* **R1/R2**: performance-engineer's "374× speedup" headline — R2 clarified that's Q8 unfiltered; Q9 filtered (matching ruflo's workload) is ~31×; mental "divide by 10" rule for filtered queries.
* **R3**: graph-theory-expert's R2 framing weighted 70% pure-graph / 30% hybrid — R3 honest concession that capability-driven framing shifts it to 30% pure-graph / 60% hybrid (every memory/skill/episode/ADR has an embedding, so most queries are hybrid vector+graph).

### Related ADRs

* **ADR-0166** — agentdb unified database architectural gap (superseded by ADR-0170).
* **ADR-0170** — agentdb substrate replacement — PostgreSQL primary. This ADR runs entirely on the PG-server target ADR-0170 introduced; it does not change the substrate, only adds AGE + pgvector extensions on top.
* **ADR-0172** — router silent-fallback + disabled-controller audit. The 5 disabled-by-default controllers ADR-0172 names include `graphAdapter` (the abstraction that would have backed graph-node); under this ADR, `graphAdapter` is retired and the new `agentdb_cypher_query` MCP tool replaces its planned surface.

### Upstream references (citations, not directional signals)

* `@ruvector/graph-node@2.0.4` (npm) — 22,204 LoC Rust engine; verified Cypher executor is placeholder (council R3 source-read).
* Apache AGE — Apache top-level project; v1.7.0-rc0 for PG18 (Jan 2026); 4,496 stars; openCypher implementation.
* `kuzudb/kuzu` — archived 2025-10-10. `kuzudb/api-server` (Express.js REST wrapper) archived same day.
* `Vela-Engineering/kuzu` — real fork (29 stars, MIT, last push 2026-03-09); inherits Kuzu's embedded-only architecture.
* Trendyol AGE production writeup (April 2026) — variable-length-path queries bypass postgres indexes; mitigation via iterative fixed-depth Cypher queries.
* PG14+ `WITH RECURSIVE ... CYCLE` clause — postgresql.org/docs; standard SQL since SQL:1999, postgres support since PG14.

### Open follow-ups (per Queen R3 synthesis)

1. **AGE install verification** on the agentdb PG-server target before this ADR's scope-of-work lands.
2. **Baseline p50/p95 capture** on `getCausalChain` and `getCausalChainWithAttention` *before* CYCLE-clause migration — answer-of-record to "what's the hot-path latency" question.
3. **Per-consumer migration audit** for AGE adoption (ADR/ODR edges good fit; memory-graph.ts probable; `agentdb_graph_*` MCP tools direct; SparsificationService no; coord agents no).
4. **`agentdb_cypher_query` MCP tool design** — auth, sandboxing, parameterized Cypher (no string-concat) to prevent injection across MCP boundary.
5. **graph-node watch trigger criteria** documented in this ADR's `Watch triggers for Option A reconsideration` section above.
6. **Hyperedge use-case watch**: revisit if a multi-party causal-attribution callsite emerges where junction-reification is provably insufficient.
