---
status: superseded
completed: true
date: 2026-05-12
tags: [graph, ruvector, axis-separation, substrate, hypergraph, three-axis, cypher-executor-patch, ruvector-postgres, fork-freedom]
supersedes: [ADR-0173]
superseded-by: [ADR-0177]
depends-on: [ADR-0073, ADR-0166, ADR-0170]
implements: []
references-upstream: [ruvnet/ruflo:ADR-027, ruvnet/ruflo:ADR-087, ruvnet/RuVector:ADR-044, ruvnet/RuVector:ADR-080, ruvnet/RuVector:ADR-143, ruvnet/RuVector:ADR-029, ruvnet/agentdb:ADR-007]
---

> **Superseded by ADR-0177 (2026-05-12).** ADR-0177 collapses back from three axes (memory_*, agentdb_*, graph_*) to two (memory_*, agentdb_*) following upstream `ruvnet/agentdb`'s framing. Graph data persists within `agentdb_*` via `@ruvector/graph-node` integration in upstream's `db-unified.ts`; no separate `graph_*` substrate axis. See ADR-0177 §"Relationship to ADR-0166 (axis-separation framing)".

# Introduce `graph_*` as a third persistence axis — RuVector graph engine

## Context and Problem Statement

Ruflo currently has two persistence axes under ADR-0166's axis-separation framing:

- **`memory_*` axis** — RVF + `@ruvector/rvf` per ADR-0073. Bulk vector storage and HNSW similarity recall over memory items. Settled.
- **`agentdb_*` axis** — pglite/postgres + `@ruvector/postgres-cli` per ADR-0170 (Phase B in flight). SQL-shaped controllers: HierarchicalMemory, ReflexionMemory, SkillLibrary, ReasoningBank, ExplainableRecall, LearningSystem, NightlyLearner, CausalMemoryGraph, etc.

Graph capability has been routed through these two axes without ever being treated as a substrate decision in its own right:

- The in-process knowledge graph (`forks/ruflo/v3/@claude-flow/memory/src/memory-graph.ts`, 405 LoC pure-TS) computes PageRank + Louvain over an in-memory adjacency map at recall time, with 5 edge types (`reference|similar|temporal|co-accessed|causal`). **Not persisted as a graph.**
- Causal edges between memories live in `causal_edges` postgres table (`agentdb_*`), queried via `CausalMemoryGraph.ts:469`/`:532` with `WITH RECURSIVE` 5-hop traversal. ADR-0170 Phase B is porting this from SQLite to postgres dialect; ADR-0173 proposes a PG14+ `CYCLE` clause migration on top of that.
- Skill prerequisite chains live in `skill_edges` postgres table (`agentdb_*`).
- ADR/ODR dependency graphs (typed `supersedes`/`depends-on`/`implements` relations between decision records) routed through `agentdb_causal-edge` + `agentdb_hierarchical-store` MCP tools, landing in postgres tables.
- Memory→agent→session provenance, memory consolidation lineage, hive coordination DAGs — **not tracked as persistent edges anywhere**.
- 13+ graph-shaped MCP tools registered in `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts` (`agentdb_causal-edge`, `agentdb_graph_node_create`, `agentdb_graph_edge_create`, `agentdb_hierarchical-store`, etc.) — most either route through `agentdb_*` postgres tables or return `graphAdapter not available` errors out of the box.

ADR-0173 (proposed 2026-05-12) proposed adding Apache AGE as a postgres extension to give `agentdb_*` graph-query capability. That decision is itself a signal: graph capability is a real need that the existing axis-substrate decisions don't natively serve. AGE makes graph a *postgres extension*; this ADR proposes making graph an *axis of its own*.

The 2026-05-12 audit of `ruvnet/RuVector` established that `ruvector-graph` + `@ruvector/graph-node` ships a real distributed hypergraph database: property graph + hyperedges + vector embedding per node + label-filtered HNSW + BFS/DFS + k-hop traversal + redb/in-memory/WASM persistence + RAFT + 11 integration test files. Adjacent crates compose with it in-process: `ruvector-gnn` (GCN/GAT/GraphSAGE/GraphMAE re-rank on neighborhoods), `ruvector-sparsifier` (PPR + spectral shadow graphs), `ruvector-graph-transformer` (8 modules), `ruvector-mincut-gated-transformer` (attention pruning), `rvf-crypto` (witness chain + attestation + lineage). The Cypher executor placeholder in `crates/ruvector-graph/src/executor/mod.rs:129` blocks one path (full openCypher pipeline through `QueryExecutor`); it does not block the imperative API (`createNode`/`createEdge`/`createHyperedge`/`getNeighbors`/`searchSimilar`) which serves most graph workloads.

**Three independent Cypher implementations exist in the RuVector workspace** (per the ADR-0174 cypher-verification council, 2026-05-12, transcript at `docs/council/ADR-0174-cypher-verification-council-transcript.md`):

1. **`ruvector-graph`** — parser/AST/semantic-analyzer/optimizer complete; executor returns `Ok(Vec::new())` placeholder at `executor/mod.rs:129`. Adopting Option α means this is the engine to fork-patch when a callsite needs full Cypher.
2. **`rvlite`** — real hand-rolled lexer + recursive-descent parser + functional single-row executor for limited expression types. PR #292/#293 fix the multi-row defect here. Targeted at WASM/edge deployments.
3. **`ruvector-postgres`** — separate demo-quality string-prefix-dispatch executor at `src/graph/cypher/executor.rs`, author-labelled "Simplified … not a production parser" at three top-of-file comments, untouched in the 2026-03-03 audit. Demo-only.

**The three do not share an AST/parser/executor crate.** Each is an independent hand-roll. The imperative graph-node API is independent of all three Cypher paths.

The question this ADR settles: **introduce `graph_*` as a third persistence axis, distinct from `memory_*` and `agentdb_*`, backed by the RuVector graph engine?** Graph data leaves `agentdb_*` postgres tables and `memory_*`'s in-process pure-TS layer; graph queries route through one engine.

> **Terminology — `graph_*` means substrate, not MCP namespace.** Throughout this ADR, `graph_*`, `memory_*`, and `agentdb_*` refer to *persistence axes* (where data lives, what contract the substrate satisfies). They are NOT proposals to add a new `graph_*` MCP tool namespace. The existing `memory_*` (15 tools) and `agentdb_*` (~49 tools, including the 13+ graph-shaped ones like `agentdb_graph_node_create`, `agentdb_causal-edge`, `agentdb_hierarchical-store`) MCP namespaces are preserved. Phase C below re-routes the handler implementations of the existing graph-shaped `agentdb_*` tools to the new `graph_*` substrate — tool names are unchanged. Adding a parallel `graph_*` MCP namespace was considered and rejected because it would require refactoring every skill that calls these tools by name (e.g., `/adr-index`'s `mcp__ruflo__agentdb_hierarchical-store` reference). The substrate decision and the MCP-namespace naming are independent concerns; this ADR settles only the former.

## Decision Drivers

* **Three-axis fit-by-shape.** Each axis carries data shaped to one substrate:
  - `memory_*` — bulk vectors, HNSW recall → RVF (current, unchanged)
  - `agentdb_*` — relational + aggregational + FTS + recursive CTE → pglite/postgres (current, unchanged)
  - `graph_*` — typed edges + hyperedges + multi-hop traversal + per-node embeddings + GNN re-rank + sparsified shadow graph → ruvector-graph (proposed)

  Each substrate is chosen for its native shape. ADR-0166's axis-separation framing extends cleanly from two axes to three.

* **`feedback-no-value-judgements-on-features` reads cleanly under three axes.** Ruvector's graph stack is a real, published, end-goal-aligned upstream surface. Wiring `graph_*` to it ships the upstream feature; routing graph capability through AGE-on-postgres (ADR-0173) ships a parallel external feature with overlapping semantics.

* **`agentdb_*` retains its momentum.** ADR-0170 Phase B continues as planned for the SQL-shaped controllers. Only graph-resident data (causal edges, skill edges, hierarchical *graph* relations) migrates out. The relational/aggregational/FTS portions of those controllers stay on postgres.

* **`memory_*` retains its substrate.** RVF stays primary for bulk vector storage per ADR-0073. `memory-graph.ts`'s in-process pure-TS computation either retires (graph_* serves its consumers natively) or becomes a query-time layer over `graph_*` data.

* **ADR-0173 (AGE) becomes moot.** Graph capability is delivered via the new axis. The PG14+ CYCLE clause migration for the two recursive-CTE callsites becomes substrate-orthogonal — those callsites migrate to `graph_*` k-hop queries.

* **`feedback-no-fallbacks`.** Each axis fails loud on its substrate unavailability; no silent cross-axis fallback.

* **Cross-axis composition is a controller responsibility, not a substrate responsibility.** Controllers that need to compose data across axes (e.g., CausalMemoryGraph reading typed-edge traversal from `graph_*` + confidence aggregation from `agentdb_*`) coordinate at the controller layer. The pattern is already in use for `memory_*` ↔ `agentdb_*` cross-axis composition.
* **Skill manifest stability.** Skills like `/adr-index`, `/odr-index`, and others declare specific MCP tool names in their `allowed-tools` frontmatter (e.g., `mcp__ruflo__agentdb_hierarchical-store`, `mcp__ruflo__agentdb_causal-edge`). The substrate refactor cannot change those names without forcing every skill manifest to be updated in lockstep. Therefore: substrate boundaries shift below the MCP boundary; MCP tool names are stable; the existing `agentdb_*` namespace continues to own graph-shaped tools even when their handlers route to `graph_*` storage.

## Considered Options

* **Option α** — `graph_*` as a third axis, ruvector-graph as the substrate. Graph-shaped data leaves `agentdb_*` postgres tables; `agentdb_*` retains SQL-shaped controllers per ADR-0170 Phase B; `memory_*` unchanged.
* **Option β** — Keep two axes; bolt graph capability onto `agentdb_*` via AGE per ADR-0173. Graph data lives in postgres tables (relational form) + AGE-managed graph storage (`ag_catalog`); marshalling between agtype and JSONB at the controller layer.
* **Option γ** — Keep two axes; add ruvector-graph as an *adapter inside* `agentdb_*`. Sub-substrate within an axis; controllers route some queries to postgres, some to graph-node, all under one axis namespace.
* **Option δ** — Keep two axes; add ruvector-graph as an *adapter inside* `memory_*`. Memory's graph data lives alongside RVF vectors in the memory axis; `agentdb_*` unchanged.

## Decision Outcome

Chosen option: **Option α — introduce `graph_*` as a third persistence axis backed by `ruvector-graph`.**

> **Implementation posture (2026-05-12):** Option α's substrate choice is final. Phase A scope was elaborated under a fork-freedom reconsideration (see "Reconsideration under fork-freedom posture" below) that adds two first-class Phase A items: a narrow Cypher executor patch (Phase A.5) and a `ruvector-postgres` extension swap for `agentdb_*` (Phase A.6). Read this Decision Outcome together with that section; the implementation phases in Confirmation incorporate both.

Rationale:

1. **Substrate-by-shape extends ADR-0166 cleanly.** Two axes weren't enough because graph has been a third shape all along — routed through whichever axis was closest to hand. Naming it as its own axis with its own substrate respects the data's actual shape.
2. **Avoids the `agentdb_*` substrate revisit ADR-0174 originally proposed.** ADR-0170 Phase B stays on track for the SQL-shaped controllers. The work that changes is the migration of *graph-shaped* data out of `agentdb_*` tables and into `graph_*`.
3. **Avoids the `memory_*` substrate revisit.** RVF stays primary for bulk vectors; memory's graph relationships move to `graph_*` rather than being added to the memory axis's existing substrate.
4. **ADR-0173 becomes superseded rather than competing.** No AGE; no agtype marshalling; no per-connection `LOAD 'age'` hook; no `Dockerfile.age`. The PG14+ CYCLE clause migration for the two recursive-CTE callsites becomes moot once those callsites migrate to `graph_*` k-hop queries.
5. **The 13+ graph-shaped MCP tools get a real backend.** They currently return errors or route through awkward postgres adapters. Under `graph_*` they route to ruvector-graph natively, with hyperedge + label-filtered HNSW + GNN re-rank + sparsifier all available in one engine.

### Scope of `graph_*` axis

**Lives in `graph_*` (moves here from `agentdb_*` or from the in-process pure-TS layer):**

- ADR/ODR dependency graph (typed `supersedes`/`depends-on`/`implements` relations between decision records)
- Causal edges between memories (currently `causal_edges` postgres table per ADR-0170 Phase B; under this ADR, migrates to typed `caused` edges in `graph_*` with `getNeighbors(memoryId, 5)` replacing `WITH RECURSIVE` 5-hop)
- Skill prerequisite chains (currently `skill_edges` postgres table; migrates to typed `requires`/`provides` edges in `graph_*`)
- The 5 edge types in `memory-graph.ts` (`reference|similar|temporal|co-accessed|causal`) — persisted in `graph_*` instead of recomputed in-process at every recall
- Memory→agent→session provenance (not currently persisted as edges; becomes hyperedges in `graph_*`)
- Memory consolidation lineage (becomes typed `derived-from` edges in `graph_*`)
- Hive coordination DAG (queen→worker→subworker → typed edges; multi-party coordination → hyperedges)
- All 13+ graph-shaped MCP tools route to `graph_*`

**Stays in `agentdb_*`:**

- Counts, aggregations, ORDER BY, GROUP BY HAVING over controller state
- FTS via tsvector on episode bodies, skill descriptions, ADR/ODR text
- RL state aggregations (LearningSystem, NightlyLearner cross-product self-JOIN)
- ExplainableRecall's `recall_certificates` with tsvector query_text
- The SQL-shaped portions of every controller in ADR-0170 Phase B's list

**Stays in `memory_*`:**

- Bulk vector storage of memory items (RVF segments)
- HNSW recall over the memory vector substrate
- The memory items themselves; only their *relationships to each other* move to `graph_*`

### Controllers that span axes

Three controllers have both SQL state and graph state:

- **CausalMemoryGraph** — typed `caused` edges + 5-hop traversal move to `graph_*`; confidence aggregation + per-edge attributes stay in `agentdb_*`. Controller code coordinates reads/writes across both axes.
- **SkillLibrary** — `skill_edges` graph (typed `requires`/`provides`) moves to `graph_*`; skill metadata + descriptions + FTS stays in `agentdb_*`.
- **HierarchicalMemory** — parent/child tree structure moves to `graph_*`; tier metadata + counts stay in `agentdb_*`.

The pattern is the same already in use for `memory_*` ↔ `agentdb_*` cross-axis composition: a thin coordination layer in the controller, no cross-axis fallback.

### What changes about ADR-0170 Phase B

ADR-0170 Phase B is **not unwound**. The SQL-shaped portions of the 13 controllers continue to be ported to postgres dialect. What changes:

- **B-7 CausalMemoryGraph** drops the `WITH RECURSIVE` 5-hop translation (that traversal moves to `graph_*`'s k-hop API); the controller's SQL aggregation work is unchanged.
- **B-3 SkillLibrary** drops the `skill_edges` table port (edges move to `graph_*`); skills metadata port unchanged.
- **B-1 HierarchicalMemory** drops the parent/child edge persistence (tree structure moves to `graph_*`); tier metadata port unchanged.
- The per-controller `@ruvector/graph-node` dead-strip ADR-0170 §"Phase B" specified (per gap-J resolution) **no longer applies** — graph-node IS the substrate now.

### What changes about ADR-0173

**Superseded by this ADR.** AGE not installed; no per-connection `LOAD 'age'` hook; no `Dockerfile.age`; no agtype marshalling. The R3 council transcripts (`docs/council/ADR-0173-graph-db-council-r{1,2,3}-transcript.md`) remain as evidence of the question's evolution: R3 chose AGE because it served the data shape *within the two-axis framing*. Once the framing extends to three axes, the AGE choice dissolves.

The PG14+ CYCLE clause migration ADR-0173 specified for `CausalMemoryGraph.ts:469`/`:532` is moot — those callsites migrate to `graph_*` k-hop queries.

### Out of scope

- Migration of memory items themselves to `graph_*`. Only their relationships move; memory items stay in `memory_*` RVF.
- Choice of `graph_*` persistence format (redb vs RVF-backed). The graph crate supports both via feature flag; decision deferred to Phase A.
- Distributed mode (RAFT + federation). Single-node first; revisit if/when a multi-node deployment is in scope.
- WASM target for `graph_*`. Available via `ruvector-graph-wasm` if needed; not load-bearing for current consumers.
- Cypher executor patch in `forks/ruvector/`. Imperative API serves current consumers; patch scope deferred until a specific callsite needs WHERE/projection/multi-hop Cypher.

### Consequences

* Good, because each axis substrate fits the shape of its data; no shape forced through an unsuitable engine.
* Good, because ADR-0170 Phase B momentum preserved for the SQL-shaped work that's already in flight.
* Good, because ADR-0173 supersedes — AGE adoption, per-connection LOAD hook, Dockerfile.age, agtype marshalling all retire.
* Good, because the 13+ graph-shaped MCP tools get a real backend (most currently return errors or route through awkward postgres adapters).
* Good, because hyperedges become natural for n-ary provenance/causation/team-formation; junction-node reification retires.
* Good, because in-engine GNN re-rank + sparsifier + transformer + witness chain compose with the graph substrate via adjacent ruvector crates.
* Good, because `memory-graph.ts` either retires or simplifies to a query-time layer; in-process pure-TS PageRank/Louvain stops recomputing at every recall.
* Bad, because adds a third persistence engine to the deployment story (RVF + postgres + ruvector-graph). Triple the backup, triple the failure modes, triple the install matrix. Mitigation: each axis fails loud on its own; controllers coordinate at the layer above; cross-axis composition is explicit.
* Bad, because three controllers (CausalMemoryGraph, SkillLibrary, HierarchicalMemory) become cross-axis — their code must coordinate reads/writes across `agentdb_*` and `graph_*`. Mitigation: pattern already exists for `memory_*` ↔ `agentdb_*`.
* Bad, because graph-node's Cypher executor placeholder remains a tactical patch item if/when a callsite needs WHERE/projection/multi-hop Cypher beyond what the imperative API serves. Mitigation: most graph workloads fit the imperative API; council R3 estimated 500-1,000 LoC Rust for ruflo's narrow Cypher needs if patched in fork; rvlite has a real Cypher executor that's also routable.
* Bad, because ruvector-graph's distributed mode (RAFT + federation) is a different operational model than postgres replication. Mitigation: single-node first; distributed mode out of scope until needed.
* Neutral, because `memory_*` and `agentdb_*` substrate identities are unchanged. Only the *boundaries* of what they each carry change.

### Confirmation

> **Note (2026-05-12):** Phases A.5 and A.6 below are new commitments introduced by the fork-freedom reconsideration section. The original Phase A/B/C/D/E remain but are augmented; see the reconsideration section above for rationale.

1. **Phase A — `graph_*` axis introduced** when `@ruvector/graph-node` (republished as `@sparkleideas/graph-node`) is wired as the substrate for the axis (new `forks/agentdb/src/backends/graph/` directory or a new `forks/ruflo/v3/@claude-flow/graph/` package — pick at Phase A); an `AGENTDB_GRAPH_AXIS_ENABLED` boot-validation gate exists and fails loud if the engine is unreachable per `feedback-no-fallbacks`; the persistence format choice is committed (preferred: RVF-backed, gated on follow-up #1; fallback: redb).
2. **Phase A.5 — narrow Cypher executor patch landed** when `forks/ruvector/crates/ruvector-graph/src/executor/mod.rs:129` is wired to the existing parser / AST / semantic-analyzer / optimizer and the scope from "Option α elaboration A" above passes integration tests against `@sparkleideas/ruvector-graph` and `@sparkleideas/graph-node`: WHERE filters per-row, DELETE actually mutates, RETURN projects + DISTINCT + ORDER BY + SKIP + LIMIT honored, multi-pattern MATCH joins correctly, parameter binding works. CI gate: at least one test for each of the four `GraphDatabaseAdapter.delete*` methods running against the real binding (not a `CypherSpy` mock) asserts the underlying state actually changed. An upstream PR against `ruvnet/RuVector` opens in parallel — fork retires the patch if/when upstream accepts.
3. **Phase A.6 — `agentdb_*` substrate swap to `ruvector-postgres`** when (a) `forks/ruflo/v3/@claude-flow/plugins/src/integrations/ruvector/ruvector-bridge.ts:1840` calls `CREATE EXTENSION ruvector` instead of `CREATE EXTENSION vector`; (b) operator/function callsites are rewritten (`<=>`/`<->`/`<#>` → `ruvector_cosine_distance`/`_euclidean_distance`/`_dot_product`); (c) HNSW index DDL uses `ruvector_cosine_ops` operator class; (d) the postgres image in `scripts/` and Verdaccio-managed setup is switched from `postgres:17` to `ruvnet/ruvector-postgres:pg17,graph-complete,gated-transformer`; (e) the actual installed extension's SQL function count is verified against ADR-044's "143 functions" claim and the per-function surfaces are mapped to ADR-0170 controller needs.
4. **Phase B — graph-shaped data migration** when CausalMemoryGraph's `caused` edges, SkillLibrary's `requires`/`provides` edges, HierarchicalMemory's parent/child relations, and the ADR/ODR dependency frontmatter relations all persist in `graph_*` and not in `agentdb_*` postgres tables; the three cross-axis controllers have an audited coordination layer; the dual-mode `if (graphBackend && '<method>' in graphBackend)` upstream pattern is collapsed to direct dispatch (no SQLite fallback per `feedback-no-fallbacks`).
5. **Phase C — MCP tool routing (handlers only; tool names unchanged)** when the 13+ graph-shaped MCP tools — `agentdb_graph_node_create`, `agentdb_graph_edge_create`, `agentdb_graph_node_get`, `agentdb_causal-edge`, `agentdb_causal_query`, `agentdb_causal_recall`, `agentdb_hierarchical_store`, `agentdb_hierarchical_recall`, `agentdb_hierarchical-delete`, `agentdb_causal-edge-delete`, `agentdb_causal-node-delete`, etc. — keep their existing `agentdb_*` MCP namespace names but their **handler implementations** route to `graph_*` natively (no more `graphAdapter not available` error returns; no more displaced writes to `causal_edges`/`skill_edges` postgres tables); the three Phase-3.7-alpha-8 delete tools route through `@sparkleideas/graph-node`'s Cypher path and the Phase A.5 patch makes them actually delete. **No skill manifest changes** — `/adr-index`, `/odr-index`, and other skills that declare `mcp__ruflo__agentdb_*` tools in their `allowed-tools` continue to work without modification.
6. **Phase D — ADR-0173 supersession** when this ADR promotes to `accepted` and ADR-0173's status flips to `superseded by ADR-0174`; AGE-related branches/deps retire.
7. **Phase E — `memory-graph.ts` decision** when the in-process knowledge graph either retires (if `graph_*` serves its consumers natively) or remains as a query-time analytics layer over `graph_*` data (compute-on-read pattern, e.g., on-demand Louvain communities).

## Pros and Cons of the Options

### Option α — Three axes (proposed)

* Good, because substrate-by-shape; each axis fits its data.
* Good, because ADR-0170 Phase B momentum preserved (and sharpened by the Phase A.6 `ruvector-postgres` extension swap — see fork-freedom reconsideration above).
* Good, because end-goal-aligned with upstream RuVector graph stack.
* Good, because the 13+ graph-shaped MCP tools get a real backend.
* Good, because memory's graph need (currently displaced into `agentdb_*` or unmet) gets a first-class home.
* Good, because under the fork-freedom posture the Phase A.5 narrow Cypher executor patch is a high-leverage upstream-PR candidate — exactly the gap upstream ADR-087 explicitly defers and ADR-007 Phase 1 lists as HIGH priority.
* Good, because `agentdb_*` gains 143 SQL functions (hyperbolic embeddings, GNN layers, 39+ attention mechanisms, hybrid vector+BM25+RRF, local embeddings, in-column quantization, SIMD ops) via the Phase A.6 `ruvector-postgres` swap — surfaces upstream advertises but cannot ship at runtime under their compat envelope.
* Bad, because adds a third persistence engine.
* Bad, because three controllers become cross-axis.
* Bad, because Phase A.5 (narrow Cypher executor) is ~1KLoC Rust patch maintained against an actively-developed crate until upstream merges the PR.
* Bad, because Phase A.6 (`ruvector-postgres` swap) requires the `ruvnet/ruvector-postgres:pg17,graph-complete,gated-transformer` Docker image with `ruhnsw` extension index — newer surface than the production-tested pgvector path.

### Option β — AGE per ADR-0173 (two-axis status quo)

* Good, because no new axis; one postgres install handles SQL + graph.
* Good, because AGE's Cypher executor is real (mature openCypher implementation).
* Bad, because graph data marshals through agtype ↔ JSONB at the controller layer.
* Bad, because AGE's openCypher coverage has documented quirks (NULL in list comprehensions, `WHERE EXISTS { ... }` crashes, MATCH-after-WITH edge cases).
* Bad, because RuVector graph stack (`gnn`, `sparsifier`, `graph-transformer`, `mincut-gated`, witness chain) stays unwired for graph workloads.
* Bad, because hyperedges in AGE require junction-reification.
* Bad, because memory's graph need stays displaced into `agentdb_*` postgres tables.

### Option γ — ruvector-graph as adapter inside `agentdb_*`

* Good, because doesn't add a third axis to the deployment story.
* Bad, because a sub-substrate within an axis is conceptually awkward; controllers route some queries to postgres, some to graph-node — boundary becomes contestable per controller.
* Bad, because backup story for `agentdb_*` splits (postgres `pg_dump` vs graph-node redb snapshot) but appears as one axis from the outside.
* Bad, because `memory_*`'s graph data still has to route through `agentdb_*` to hit the graph adapter.

### Option δ — ruvector-graph as adapter inside `memory_*`

* Good, because keeps memory's graph data close to its vector data.
* Bad, because memory's graph data has consumers in `agentdb_*`-resident controllers (CausalMemoryGraph, SkillLibrary) — cross-axis composition shape inverts.
* Bad, because RVF and ruvector-graph have different persistence semantics; one substrate axis with two engines is the worst of γ at a different layer.

## Reconsideration under fork-freedom posture (2026-05-12)

The Decision (Option α) above was reasoned from an implicit "follow upstream's de facto direction" stance — keeping Option α as the substrate choice while deferring the Cypher executor patch and accepting pgvector as the live postgres extension. The session that produced this ADR also re-examined that stance against the fork's actual constraints. The result strengthens Option α and replaces several Phase A details with more ambitious commitments. The substrate choice (three axes, ruvector-graph as `graph_*`) is unchanged; what changes is the implementation posture for the executor placeholder and the `agentdb_*` extension.

### Why upstream's posture is partly merit, partly backward-compat

Upstream's working code reflects two intertwined drivers: technical merit, and a backward-compatibility envelope. The fork does not carry the same envelope. Naming which upstream choices stand on merit (and therefore replicate) vs which stand on backward-compat (and therefore can be re-decided) is load-bearing for Phase A scope.

| Upstream constraint | What it forces upstream to do | What the fork actually carries |
|---|---|---|
| Existing `query(cypher)` callers (third-party packages, marketplace plugins, documentation examples) cannot start erroring | Keep the Cypher surface even when its executor is hollow — silent no-op preserves the "doesn't crash" contract for callers that depend on the empty result | Zero third-party Cypher callers in the fork bundle. All Cypher callsites live in `forks/agentdb/` + `forks/ruflo/` and are atomically rewriteable per `npm run release`. |
| `.graph` redb files on user disks must remain readable across version bumps | Cannot change graph-node persistence format mid-life | No production `.graph` files exist in fork users' environments. Persistence format is forward-fresh; we pick whatever suits Phase A. |
| sql.js (WASM SQLite) install path must work on Alpine, no-build-tools containers, CI runners without native deps | Keep dual-mode (graph vs sqlite) controller pattern; SQLite fallback remains a viable production target | ADR-0170 already retired SQLite for `agentdb_*`. Per `feedback-no-fallbacks`, fork posture is single-substrate-per-axis with loud failure. |
| `GraphBackend.execute(cypher, params)` interface in public agentdb exports must not change shape | Cannot drop or reshape `execute()` even when its implementation is hollow | All `GraphBackend` implementers live in `forks/agentdb`. The interface is ours to reshape; the bundle's release cycle propagates the change atomically. |
| "Single Cognitive Container `.rvf`" marketing language drives npm SEO and marketplace positioning | Cannot publicly acknowledge that real storage is `.rvf` (memory_*) + `.graph` (redb) + `.db` (sql.js) — three files, not one | No npm SEO posture; `@sparkleideas/*` packages serve internal users. Documentation can canonically state three-axis multi-file substrate without marketing tension. |
| pgvector has years of production installations with deployed indexes, query patterns, ORM bindings (`pgvector-py`, `pgvector-rust`, `pgvector-django`) | Bridge plugin must call `CREATE EXTENSION vector` and use pgvector operators (`<=>`, `<->`, `<#>`); ADR-027 (consumer-side ruvector-postgres plan) sat dormant for 4 months rather than supersede | All postgres consumers in fork bundle are versioned together; the extension and operator choice rebuilds atomically per release. No third-party ORM dependence on pgvector operator syntax. |
| `crates/ruvector-graph/src/executor/mod.rs:129` placeholder change risks breaking existing test fixtures, benchmark numbers, and the `tests/cypher_execution_tests.rs` 405-LoC `// TODO` skeleton | Cannot replace the placeholder without revisiting that surface comprehensively | Fork-side Cypher tests are ours to write from scratch; no existing fixture is pinned to the "returns empty Vec" behavior. |
| ADR-0170 Phase B controller migrations must accept gradual rollout (deployed users on pglite, postgres-server, legacy sql.js, mixed in time) | Cross-axis migrations cannot be hard cutovers | Fork bundle is single-release; cross-axis controller migrations are atomic. Phase B can be a single coordinated cutover, not a phased rollout. |

The fork's purpose is captured in memory `feedback-no-value-judgements-on-features`: **default to WIRE; ship the full upstream surface; let user judge usage**. Upstream's compat envelope keeps them from shipping the surface their docs claim. The fork can ship it.

### Option α elaboration A — narrow Cypher executor patch in `graph_*`

The original Decision Outcome treats `crates/ruvector-graph/src/executor/mod.rs:129` as a deferred tactical patch — addressed only if/when a specific callsite needs Cypher syntax beyond label-lookup. Under the fork-freedom posture, the patch becomes a **Phase A.5 first-class item**. Two reasons make deferral pose more risk than the patch:

1. **Active upstream consumer.** The late-breaking finding in the research record below (`ruvnet/agentdb` extracted 2026-05-06) confirms `GraphDatabaseAdapter.deleteNode/deleteEdge/deleteHyperedge/deleteEdgesByEndpoints` routes user-invoked deletions through the hollow Cypher path. Ruflo v3.7.0-alpha.8 wires this into three MCP tools (`agentdb_hierarchical-delete`, `agentdb_causal-edge-delete`, `agentdb_causal-node-delete`). The fork inherits the silent-no-op behavior on `npm install`. Deferring the executor patch means shipping known-broken delete tools.
2. **Existing soft-failure consumer.** `ReflexionMemory.ts:316-317, :451-468` builds Cypher `MATCH (e:Episode) WHERE e.reward >= 0.5 AND e.success = false RETURN e LIMIT k*3` and calls `graphBackend.execute()`. Under the hollow path, the WHERE doesn't filter — the controller receives every Episode node and re-filters in TypeScript downstream. Functions but is wasteful, fragile, and grows linearly with episode count.

**Two scope levels for the patch:**

| Variant | LoC estimate | Surface delivered | Risk |
|---|---|---|---|
| **Narrow Cypher** (recommended) | ~500-1,500 Rust | Wire `executor/mod.rs:129` to consume the parser, AST, semantic-analyzer, and optimizer that are already complete in `crates/ruvector-graph/src/cypher/{parser,ast,semantic,optimizer}.rs`. Implement: Statement::Match (multi-pattern, single-hop relationship, label + property filter), Statement::Create (single + multi-element patterns), Statement::Delete + DETACH DELETE, Statement::Return (projection + DISTINCT + ORDER BY + SKIP + LIMIT), WHERE (full predicate tree: comparison, logical AND/OR/NOT, IS NULL, IN, numeric arithmetic), parameter binding (`$name` + positional). **Skip** for this phase: multi-hop joins, variable-length paths `[*n..m]`, MERGE, OPTIONAL MATCH, list/pattern comprehensions, CASE, aggregations beyond `count()`. | Medium — ~1KLoC patch tracked against an actively-developed crate. Mitigated by upstreaming as a PR (high signal-to-noise contribution; matches the gap multiple upstream ADRs name but none plan). |
| **Full openCypher M-CIR** | ~5,000-15,000 Rust | The complete MVP-Cypher surface from the cypher-verification council's graph-query-expert framework. ~700 openCypher conformance tests. | High — multi-month effort; significant Rust expertise; replaces tail features (variable-length paths, MERGE, list comprehensions, CASE) that no fork callsite currently uses. |

**Recommendation: narrow Cypher.** The 500-1,500 LoC version covers every consumer the cypher-verification council enumerated (ReflexionMemory's filtered Episode query; the four GraphDatabaseAdapter delete methods; the 5 decision-record skills' MCP-tool-routed graph queries). The patch lands in `forks/ruvector/crates/ruvector-graph/src/executor/mod.rs` and propagates through to `@sparkleideas/ruvector-graph` + `@sparkleideas/graph-node` NAPI `query()` and `querySync()`. The full openCypher version is deferred until a callsite requires its features.

### Option α elaboration B — `ruvector-postgres` for `agentdb_*` (per ADR-0170 Phase A revision)

The original Decision Outcome accepts ADR-0170's substrate (postgres) and clarifies that ADR-0170 should pick `ruvector-postgres` rather than `pgvector` (since they don't coexist). Under fork-freedom the choice becomes definite and earlier: **adopt `ruvector-postgres` as the `agentdb_*` extension for Phase A.6**. Three reasons:

1. **Surface delivered.** `ruvector-postgres` v0.3 ships **143 SQL functions** vs pgvector's ~10:
   - Hyperbolic embeddings (`ruvector_poincare_distance`, `ruvector_exp_map`, `ruvector_log_map`) — Poincaré, Lorentz, Klein models for hierarchical data (ADR/ODR graphs, skill hierarchies)
   - 15 GNN layer types callable as SQL functions (`ruvector_gat_layer`, `ruvector_graphsage_layer`, `ruvector_gcn_layer`, etc.)
   - 39+ attention mechanisms via SQL
   - Hybrid vector + BM25 + RRF fusion built-in
   - Local embeddings inside postgres (6 fastembed models — text → vector without leaving the DB)
   - Per-column quantization at insert time (Scalar 4×, Product 8-16×, Binary 32×, Half-Prec 2×)
   - SIMD distance ops (AVX-512 / AVX2 / NEON / scalar) with ~2× pgvector throughput claim per RuVector ADR-044
2. **Fork-freedom enables the swap.** Upstream's `ruvector-bridge.ts` uses `CREATE EXTENSION vector` (pgvector) at line 1840 because the installed-user base assumes pgvector. We have no such base — our `@sparkleideas/*` users get the postgres image we choose. The extension swap is a one-line DDL change plus ~15-30 operator/function call site rewrites in `ruvector-bridge.ts` and any postgres backend that uses pgvector operators.
3. **`feedback-no-value-judgements-on-features` authorizes it.** `ruvector-postgres` is real, published (`@ruvector/postgres-cli` + the pgrx extension), and end-goal-aligned with the upstream stack. The default rule is WIRE.

**What we do NOT double down on:** `ruvector-postgres/src/graph/cypher/executor.rs` — the embedded Cypher executor inside the pgrx extension. The cypher-verification council confirmed it as demo-quality (three "Simplified … not a production parser" top-of-file comments; WHERE evaluator is a query-aborter, not row-filter; CREATE produces silent self-loops; SET/DELETE/WITH are literal `Ok(())` stubs; 4 vacuous unit tests; zero fork callers; passed over in the 2026-03-03 audit commit `229877fe`). Patching this executor would duplicate Cypher work for a different codepath. **Cypher lives on the `graph_*` axis (ruvector-graph with our patched executor); `ruvector-postgres` provides only the vector + hyperbolic + GNN + hybrid SQL surface for `agentdb_*`.**

#### The agentdb_* vector-extension option space

The `pgvector` vs `ruvector-postgres` framing is binary, but the actual choice space for `agentdb_*` (postgres-server per ADR-0170) is broader. Six genuine options exist; they group into two shapes.

| Option | Column type | Index | Functions | Distinguishing capability | Project pace | Ecosystem fit |
|---|---|---|---|---|---|---|
| **pgvector** | `vector(N)` | `hnsw`, `ivfflat` | ~10 | Production baseline; widest ORM/tooling support | Stable, slow-moving (Andrew Kane) | Reference |
| **ruvector-postgres** | `ruvector(N)` | `ruhnsw` | 143 (v0.3 per ADR-044) | Hyperbolic embeddings + 15 GNN layer types + 39+ attention mechanisms + hybrid vector+BM25+RRF + 6 fastembed models inside postgres + in-column quantization (Scalar/Product/Binary/Half) + SIMD distance ops (AVX-512/AVX2/NEON/scalar); embedded Cypher (demo-quality, ignored) | "Accepted, in flight" upstream per ADR-044; weekly cadence; single-author batch-generated PRs (same pattern observed for PR #387) | **Not** pgvector-compatible — replaces both type and index |
| **pgvecto.rs** (Tensorchord) | `vector(N)` (compatible) | `vchordrq`, custom HNSW | ~30 | Rust-rewritten pgvector; disk-based ANN; product quantization; multi-billion-scale focus | Active, weekly cadence, CMU PASE / VLDB-aware team | Pgvector type-compatible; index different |
| **lantern** | `vector(N)` (compatible) | `lantern_hnsw` | ~15 | Hardware-accelerated HNSW; CPU SIMD + GPU paths; pgvector drop-in | Active, commercial (Lantern Cloud + OSS) | Pgvector API-compatible |
| **pgvectorscale** (Timescale) | `vector(N)` (compatible; layers on pgvector) | `diskann` | layers on pgvector | StreamingDiskANN; designed for billion-scale; SBQ quantization | Active, Timescale-backed | **Layered on pgvector** — uses it, doesn't replace |
| **pgvector + pg_search** (ParadeDB) | `vector(N)` + tantivy-backed BM25 columns | pgvector `hnsw` + tantivy | pgvector + BM25 SQL functions | Hybrid vector + BM25 via standard SQL composition (one of ruvector-postgres' headline features without the swap) | Active, ParadeDB Inc. | Pgvector + separate composable extension |

**Two shapes:**

- **Path X — bespoke maximalist replacement:** `ruvector-postgres`. Owns its own type + index; no pgvector coexistence; maximalist SQL surface (143 functions); pinned to one upstream project's pace.
- **Path Y — layered ecosystem on pgvector base:** `pgvector` + best-of-breed additional extensions (any combination of `pgvecto.rs` index-engine swap, `pgvectorscale` for DiskANN scale, `pg_search` for hybrid BM25, `lantern` for HW-accelerated HNSW). Compositional, multi-vendor, pgvector-compatible.

**Capabilities ONLY available on Path X (ruvector-postgres):**

- **Hyperbolic embeddings in SQL** (Poincaré / Lorentz / Klein) — no other extension ships this as a SQL surface
- **15 GNN layer types as SQL functions** — neighborhood re-rank inside the DB
- **39+ attention mechanisms as SQL functions** — multi-head / flash / sparse / linear callable from SQL
- **6 fastembed models inside postgres** — text → vector without leaving the DB
- **In-column quantization at insert time** (Scalar 4× / Product 8-16× / Binary 32× / Half-Prec 2×)

Path Y can deliver: pgvector-compatible vector storage + HNSW + IVFFlat (pgvector); DiskANN for billion-scale (pgvectorscale); product quantization + Rust performance (pgvecto.rs); HW-accelerated index (lantern); hybrid vector+BM25 (pg_search). Path Y cannot deliver any of the five Path-X-only capabilities above.

**Capabilities Path Y has that Path X does NOT:**

- Multi-contributor maintainer pools (pgvector, pgvecto.rs, lantern, pgvectorscale, ParadeDB each have 5-20+ active contributors per their issue trackers; ruvector-postgres is single-author cadence)
- Multi-billion-scale production hardening (pgvectorscale and pgvecto.rs both have production deployments documented; ruvector-postgres' production deployment evidence is upstream marketing, not third-party reports)
- ORM ecosystem compatibility (`pgvector-py`, `pgvector-rs`, `pgvector-django`, Drizzle/Prisma adapters all assume `vector(N)` type)

**Chosen path: X (ruvector-postgres).** Memory `feedback-no-value-judgements-on-features` ("default to WIRE; ship the full upstream surface") authorizes Path X. The five Path-X-only capabilities are exactly the upstream surface the fork's purpose is to ship. ORM-ecosystem compatibility doesn't matter for `@sparkleideas/*` consumers (no third-party ORMs in our bundle); production-hardening risk is mitigated by Phase A.6 follow-up #7's install + surface verification gate.

**Named fallback: Path Y** (`pgvector` + `pgvectorscale` + `pg_search`). If Phase A.6 follow-up #7 reveals (a) the `ruvnet/ruvector-postgres:pg17,graph-complete,gated-transformer` Docker image is unavailable / broken; (b) the installed extension's actual SQL function count falls materially below 143; (c) the hyperbolic / GNN / attention SQL surfaces don't work against the published image; or (d) ruvector-postgres' upstream cadence stalls beyond an acceptable threshold — Path Y becomes the committed substrate for `agentdb_*`. Open follow-up #11 (new, below) tracks Path Y as the standby plan.

**Compatibility note.** Per the `ruvector-postgres` README, it is a **"drop-in pgvector replacement"** — pgvector and ruvector-postgres own different varlena types (`vector(N)` vs `ruvector(N)`) and different index extensions (`hnsw` vs `ruhnsw`). They are not designed to coexist. The `agentdb_*` install matrix commits to one extension family per release: either `ruvector-postgres` (Path X) or `pgvector` + chosen layered extensions (Path Y). The Docker image is `ruvnet/ruvector-postgres:pg17,graph-complete,gated-transformer` per RuVector ADR-044 for Path X; standard `postgres:17` plus extension installs for Path Y.

### Combined trade-off — conservative vs ambitious fork-freedom variant

| Dimension | Conservative (rip Cypher + pgvector — follow upstream's de facto direction) | Ambitious (narrow Cypher + ruvector-postgres — deliver upstream's documented vision) |
|---|---|---|
| Phase A LoC delta | ~200-400 (delete Cypher surface in adapter; rewrite ~5 callsites imperatively) | ~500-1,500 Rust (narrow Cypher executor) + ~300-500 TS (bridge plugin extension swap + operator rewrites) |
| Phase A timeline | Weeks | 1-2 focused person-months |
| Cypher capability in fork | None (rewriteable imperatively per consumer) | MATCH / WHERE / DELETE / RETURN with multi-pattern, full predicate tree, projection, ORDER BY, LIMIT |
| SQL surface in `agentdb_*` | pgvector — ~10 functions, HNSW indexes | ruvector-postgres — 143 functions: hyperbolic + GNN + hybrid + quantization-in-column + SIMD ops |
| Maintenance debt | Low (small reverse-diff against upstream; easy to merge upstream changes) | Medium (~1.5KLoC Rust executor patch + extension swap config; tracks two actively-developed crates) |
| Upstream-back potential | Low (deleting interfaces is hard to PR back) | High — narrow Cypher executor is exactly the gap multiple upstream ADRs name but none plan (ADR-087 deferral; ADR-007 Phase 1 list calls for `querySync`; the late-breaking delete-API gap that pushed agentdb to route delete through hollow Cypher). PR landing it converts the patch into a one-time investment. |
| Risk if upstream rewrites the area | Low | **Low-to-medium.** ADR-044 (ruvector-postgres v0.3) is "Accepted, in flight" but ships orthogonally — the SQL surface, not the Cypher executor. PR #387 (`feature/graph-vector-property-index`) is **stalled** — single-commit branch from 2026-04-25, 17 days without engagement, 0 comments / 0 reviews, `mergeable: false`, 84 commits behind main; adds an orthogonal imperative `VectorPropertyIndex::knn` Rust API, not Cypher. No active upstream PR touches `executor/mod.rs:129`. Mitigation: aggressive upstream PR pacing for our Cypher patch is still worth doing, but the urgency comes from internal consumer pressure (delete-API silent-no-op landed in v3.7.0-alpha.8), not from racing a competing upstream rewrite. |
| User-visible capability gain | Cleaner; smaller; fewer surprises | Materially richer; declarative graph queries; hyperbolic + GNN inside SQL; brings the fork's marketing-vs-code gap to *zero* |
| Memory alignment | `feedback-no-fallbacks` ✓, `feedback-patches-in-fork` ✓ | `feedback-no-value-judgements-on-features` ✓ (ship the full surface), `feedback-no-fallbacks` ✓, `feedback-patches-in-fork` ✓ |

### Recommendation — adopt the ambitious variant

**Six concrete moves:**

1. **Narrow Cypher executor patch (Phase A.5).** Wire `forks/ruvector/crates/ruvector-graph/src/executor/mod.rs:129` to the existing parser/AST/optimizer. Implement the scope spelled out in elaboration A. Target: ~1,000 LoC Rust. Republish as `@sparkleideas/ruvector-graph` and `@sparkleideas/graph-node`. **Plan to upstream the patch as a PR** in parallel — if upstream accepts it, the fork-side patch retires to zero LoC and the relationship value lands instead.
2. **Swap pgvector → ruvector-postgres (Phase A.6).** Replace `CREATE EXTENSION vector` with `CREATE EXTENSION ruvector` in `forks/ruflo/v3/@claude-flow/plugins/src/integrations/ruvector/ruvector-bridge.ts:1840`. Rewrite operator and function callsites (`<=>`/`<->`/`<#>` → `ruvector_cosine_distance` / `ruvector_euclidean_distance` / `ruvector_dot_product`; HNSW operator class `vector_cosine_ops` → `ruvector_cosine_ops`). Switch the postgres image in `scripts/` and Verdaccio-managed setup from `postgres:17` to `ruvnet/ruvector-postgres:pg17,graph-complete,gated-transformer`. Verify the extension SQL surface against ADR-044's "143 functions" claim before committing.
3. **Do NOT touch `ruvector-postgres`'s embedded Cypher executor.** Cypher lives on `graph_*`, not `agentdb_*`. Cross-axis controllers compose via the controller-layer pattern (existing for memory_* ↔ agentdb_*).
4. **Reshape `GraphBackend` interface in `forks/agentdb`** to expose typed imperative methods (`createCausalEdge`, `storeSkill`, `searchSkills`, `kHopNeighbors`, `deleteNode`, `deleteEdge`, `deleteHyperedge`, `deleteEdgesByEndpoints`, `vectorSearch`, `createRelationship`) alongside `execute(cypher, params)`. The narrow Cypher patch makes `execute` real; controllers stay imperative or migrate to declarative case-by-case as the patch matures.
5. **Drop dual-mode SQLite fallback in cross-axis controllers.** Per `feedback-no-fallbacks`, `graph_*` is required; the cross-axis controllers (CausalMemoryGraph, SkillLibrary, HierarchicalMemory) assert `graphBackend` presence at boot and fail loud otherwise. Matches ADR-0170's no-fallback discipline for `agentdb_*`. The dual-mode `if (graphBackend && '<method>' in graphBackend)` upstream pattern simplifies to direct dispatch.
6. **Lean toward RVF-backed for `graph_*` persistence (Phase A follow-up #2 promoted to "preferred").** Witness-chain unification across `memory_*` and `graph_*` becomes architecturally compelling: every write through `graph_*` produces a `WITNESS_SEG` segment via the same `rvf-runtime` infrastructure `memory_*` uses. Cross-axis attestation + lineage is unified. Open follow-up #1 (verify witness chain by source-read of `rvf-crypto/src/{witness,attestation,sign,lineage}.rs`) gates this; fall back to redb only if the source-read reveals the witness chain is scaffolding rather than working code.

### What stays unchanged

- **Option α (three axes by shape).** memory_* (RVF) + agentdb_* (postgres, now via `ruvector-postgres` extension) + graph_* (ruvector-graph with patched executor).
- **ADR-0173 supersession.** No AGE adoption; the PG14+ CYCLE clause migration becomes moot regardless of pgvector vs ruvector-postgres.
- **Hyperedges as first-class.** Native `createHyperedge` on `graph_*`; no junction-node reification anywhere in the fork.
- **Scope of what lives in which axis.** Causal edges, skill edges, hierarchical relations, ADR/ODR deps → `graph_*`; controller relational state + FTS + RL aggregations stay in `agentdb_*`; bulk vector memory items stay in `memory_*`.
- **Cross-axis composition is a controller responsibility.** Now expressible declaratively (Cypher MATCH against `graph_*`) and imperatively, depending on the controller's query shape.

## More Information

### Relationship to ADR-0073 (RVF Storage Backend Upgrade)

`memory_*` axis is unchanged. RVF + `@ruvector/rvf` remains primary for bulk vector storage and HNSW recall over memory items. This ADR cites ADR-0073 only as the canonical `memory_*` substrate decision being respected.

### Relationship to ADR-0166 (axis-separation framing)

Extends ADR-0166's framing from two axes to three. The original framing — pick substrates for the *shape* of the data, not for cross-axis unification — applies to graph data as a third shape. ADR-0166 itself remains in force for the two-axis split between `memory_*` and `agentdb_*`.

### Relationship to ADR-0170 (PostgreSQL primary for `agentdb_*`)

ADR-0170 stays in force for the SQL-shaped portion of `agentdb_*`. Phase B's controller port list is unchanged for SQL-shaped concerns; only the graph-shaped concerns of three controllers (CausalMemoryGraph, SkillLibrary, HierarchicalMemory) migrate to `graph_*` instead of being ported to postgres dialect. The per-controller `@ruvector/graph-node` dead-strip ADR-0170 §"Phase B" specified no longer applies (graph-node IS the substrate now).

**ADR-0170 substrate composition clarification** (per 2026-05-12 research below): ADR-0170 lists `@electric-sql/pglite` + `@ruvector/postgres-cli` + `pg` as deps and references both "pgvector" and `@ruvector/postgres-cli` as the vector-ops layer. Per the upstream `crates/ruvector-postgres/README.md`, `ruvector-postgres` is **"a drop-in pgvector replacement"** — it owns its own `ruvector(N)` varlena type and `ruhnsw` extension index, distinct from pgvector's `vector(N)`/`hnsw`. They are not designed to coexist. Phase A of ADR-0170 should install `ruvector-postgres` and NOT also install `pgvector`. ADR-044 (upstream "Accepted, in flight") brings ruvector-postgres to 143 SQL functions in v0.3 — that's the SQL surface ADR-0170 driver #5 names ("@ruvector/postgres-cli is a real package the fork can consume").

**ADR-0170 Phase A.6 commitment (per fork-freedom reconsideration above):** ADR-0174 promotes this clarification from "should install ruvector-postgres" to a Phase A.6 commitment that supersedes the live `ruvector-bridge.ts` plugin's pgvector usage. The upstream bridge plugin uses `CREATE EXTENSION vector` at `:1840` because their installed-user base assumes pgvector; the fork's bundled-release posture means we can commit to `CREATE EXTENSION ruvector` atomically. This is the fork-side resolution of ADR-027 (the upstream consumer-side plan that has sat in "Proposed" status since 2026-01-16) — agentdb_* uses ruvector-postgres, graph_* uses ruvector-graph (with patched executor), no ruvector-postgres Cypher wiring (demo-quality per cypher-verification council).

### Relationship to ADR-0173 (Graph workload strategy — AGE)

**Superseded by this ADR.** ADR-0173's verdict (Apache AGE on PG-server + E-Hardened CYCLE) is replaced by Option α here. The R3 council transcripts remain as evidence of the question's evolution: R3 chose AGE because it served the data shape *within the two-axis framing*. Once the framing extends to three axes, the constraint that drove AGE adoption dissolves.

When this ADR promotes to `accepted`, ADR-0173's status flips to `superseded by ADR-0174`.

### Research record (2026-05-12 session)

This ADR's claims rest on direct source-reading and upstream ADR review. All upstream sources are `ruvnet/*` per `feedback-upstream-means-upstream` (never `forks/*`). Citations use absolute paths under `/Users/henrik/source/ruvnet/` or fetchable `gh api repos/ruvnet/<repo>/...` references.

#### Council transcripts (inputs to ADR-0173, which this ADR supersedes)

| Path | Content |
|---|---|
| `docs/council/ADR-0173-graph-db-council-r1-transcript.md` | Round 1 — 8 participants, mesh topology; initial framings; DA killed postgres-architect's "AGE bundled in pglite" claim |
| `docs/council/ADR-0173-graph-db-council-r2-transcript.md` | Round 2 — pglite-AGE moot under PG-server-mode; load-bearing hollow-Cypher findings for graph-node and ruvector-postgres; verdict: E-Hardened primary + AGE additive |
| `docs/council/ADR-0173-graph-db-council-r3-transcript.md` | Round 3 — capability-driven reframe replaces consumer-driven; 5/6 experts converge on AGE; final two-axis-framing verdict |

#### Cypher-verification council (input to ADR-0174 directly)

| Path | Content |
|---|---|
| `docs/council/ADR-0174-cypher-verification-council-transcript.md` | 2026-05-12 — 7-agent mesh (queen + DA + 5 specialists) re-verifying the contested R2 "partially hollow" finding for `ruvector-postgres/src/graph/cypher/executor.rs`. Verdict: **CONFIRMED with HIGH confidence**; R2 finding was conservative, not overstated. DA spot-check upgraded "WHERE broken" to "WHERE is a query-aborter, not a row-filter". Three independent Cypher implementations in upstream (`ruvector-graph`, `rvlite`, `ruvector-postgres`) — no shared crate. ruvector-postgres has zero fork callers; agentdb routes through graph-node, ruflo bridge issues pgvector ops only. No substrate decision change for ADR-0174 — Option α stands. |

The "AGE wired-but-unused" intermediate state R3 accepted is itself a signal that the two-axis framing didn't honestly serve graph workloads — feeding into this ADR's three-axis reframe.

#### Upstream RuVector ADRs reviewed

| ADR | Status | Topic | Relevance |
|---|---|---|---|
| **ADR-029** | Accepted (2026-02-13) | RVF as canonical binary format | RVF universal binary substrate; 7 consuming libraries' migration table; **ruvector-postgres conspicuously absent** (postgres has own native storage); segment forward-compat rule (skip+preserve unknown segments byte-for-byte) |
| **ADR-044** | Accepted, in flight | ruvector-postgres v0.3 extension upgrade | 143 SQL functions across 20+ modules (101 base + 42 new); "drop-in pgvector replacement" with own `ruvector(N)` type and `ruhnsw` index; Docker build `pg17,graph-complete,gated-transformer` |
| **ADR-038** | Accepted | npx-ruvector-rvlite-witness-integration | rvlite as WASM-first port of ruvector-postgres |
| ADR-030, 031, 032, 037, 039, 040, 042 | Various | RVF-adjacent | Cognitive container, example repo, WASM integration, acceptance test, solver-WASM-AGI, causal-atlas, security-AIDefence-TEE |
| ADR-053 | (reviewed) | temporal-causal-graph-layers | Temporal graph extensions to RVF |
| ADR-056, 057, 072 | (reviewed) | RVF knowledge export, federated transfer learning, example downloads | Federation + lineage primitives |
| ADR-071, 080 | (reviewed) | npx-ruvector ecosystem gap + deep capability audit | Positioning of rvlite + RuVector packages |
| ADR-100, 106, 113 | (reviewed) | RVF integration with deepagents/ruvix/app-gallery | Kernel + container integration |
| ADR-155, 156 | (reviewed, excluded per user) | rulake datalake layer + memory substrate | Federation cache, not directly relevant to ruflo substrate choice |

ADR-029's migration table (verbatim from the ADR):

| Library | Was | RVF Migration |
|---|---|---|
| ruvector-core | REDB + bincode | RVF as primary, REDB as optional metadata store |
| agentdb | Custom HNSW + JSON | RVF with RVText profile |
| claude-flow memory | JSON + flat files | RVF + WITNESS_SEG for audit trails |
| agentic-flow | Shared memory blobs | RVF streaming protocol |
| ospipe | Custom binary | RVF + META_SEG for observation state |
| rvlite | bincode dump | RVF Core Profile (minimal, WASM-fits) |
| sona | Custom persistence | RVF + SKETCH_SEG for learning patterns |

`ruvector-postgres` is conspicuously absent — it uses postgres-native varlena storage, not RVF segments. This is the load-bearing finding for the parallel-substrate framing below.

#### Source-read findings (upstream `ruvnet/RuVector` HEAD)

| File | Finding |
|---|---|
| `crates/ruvector-graph/src/executor/mod.rs:129-133` | `execute_sequential` placeholder returns `Ok(Vec::new())` with explicit "placeholder" comment. Blocks the openCypher pipeline path through `QueryExecutor`. |
| `crates/ruvector-graph/src/executor/parallel.rs:101-105` | Sibling `execute_sequential` returns empty `results` ("Simplified sequential execution"). |
| `crates/ruvector-graph/src/executor/parallel.rs:141-143` | `execute_partition` returns `Ok(None)` ("Simplified partition execution"). |
| `crates/ruvector-graph-node/src/lib.rs:255-329` | NAPI `query()` doesn't route through `QueryExecutor` — does ad-hoc label-lookup. `Statement::Create` explicitly skipped (line 306: "skip in query"). `Statement::Return` no-op (line 309: "handled implicitly"). |
| `crates/ruvector-graph/tests/` | 11 integration test files: compatibility, concurrent, distributed, edge, hyperedge, node, performance, transaction, cypher-execution, cypher-parser-integration, cypher-parser. |
| `crates/ruvector-graph/ARCHITECTURE.md` (1,154 lines) | Distributed hypergraph DB architecture: SIMD-first, lock-free, cache-optimized, zero-copy, adaptive indexing, hybrid execution. RAFT consensus + federation layer. Performance targets: 10-100× Neo4j on traversals, sub-ms latency on 3-hop on billion-edge graphs. |
| `crates/ruvector-postgres/src/graph/cypher/executor.rs` (632 LoC) | Per ADR-0174 cypher-verification council (2026-05-12, transcript at `docs/council/ADR-0174-cypher-verification-council-transcript.md`, **CONFIRMED with HIGH confidence**): functional surface is single-MATCH-single-hop + CREATE + RETURN with working DISTINCT/SKIP/LIMIT projection (LIMIT/SKIP only reachable via builder API; parser silently drops the keywords from query text). Author-labelled "Simplified … not a production parser" at three top-of-file comments (`cypher/mod.rs:1`, `parser.rs:1`, `parser.rs:14`). 4 vacuous unit tests, zero fork callers, untouched in the 2026-03-03 audit commit `229877fe` (which touched 60+ files but explicitly passed over these stubs — maintainers consider this complete). `CREATE (a)-[:R]->(b)` produces silent self-loops (relationship target resolution actively buggy). WHERE evaluator is a query-aborter, not a row-filter (`executor.rs:487-504` calls `bindings.last_mut().clear()` once on a globally-evaluated predicate). |
| `crates/ruvector-postgres/README.md` + `docs/ARCHITECTURE.md` | "Drop-in pgvector replacement"; 143 SQL functions; own `ruvector(N)` varlena type (4 byte vl_len + 2 byte dims + 2 byte align + 4*dim bytes); `ruhnsw` extension index; SIMD distance layer (AVX-512/AVX2/NEON/scalar); Quantization Engine (Scalar 4×, Product 8-16×, Binary 32×, Half-Prec 2×); Hybrid vector + BM25 + RRF fusion; 46 attention mechanisms; 15 GNN layer types; hyperbolic (Poincaré/Lorentz/Klein); local embeddings (6 fastembed models inside postgres). |
| `crates/rvf/rvf-crypto/src/{witness,attestation,sign,lineage}.rs` | 1,728 LoC total (witness 189, attestation 839, sign 188, lineage 272) + integration test `crypto_sign_verify.rs`. **Unread in this session** — needs source-read verification before Phase A commits to RVF-backed `graph_*` persistence (see follow-up 1). |
| `crates/rvlite/README.md` + `docs/01_SPECIFICATION.md` | v0.1.0 POC; WASM-first port of ruvector-postgres; thin orchestration over ruvector-core/wasm/graph-wasm/gnn-wasm/sona/micro-hnsw-wasm; SQL + Cypher + SPARQL in one engine; bundle target <3MB gzipped; target users: frontend/edge/mobile/data-science/embedded — **not designed as a server-side substrate**. |

#### Live controller→substrate wiring trace (2026-05-12, this session)

Sharpens the "wired vs intent" claims in this ADR's research record by tracing from controllers down to disk against `ruvnet/*` sources (per `feedback-upstream-means-upstream`).

**RVF — fully wired, live on this machine**

```
agentdb controller
  → backends/rvf/RvfBackend.ts:147   await import('@ruvector/rvf')
                              :157   RvfDatabase.open(storagePath, rvfBackendType)
                              :172   RvfDatabase.create(storagePath, createOpts, ...)
@ruvector/rvf npm   (ruvnet/RuVector/npm/packages/rvf/src/backend.ts:94)
  → await import('@ruvector/rvf-node')
@ruvector/rvf-node NAPI   (ruvnet/RuVector/crates/rvf/rvf-node/src/lib.rs:20)
  → use rvf_runtime::RvfStore
rvf-runtime Rust crate   (ruvnet/RuVector/crates/rvf/rvf-runtime/src/lib.rs:38)
  → pub mod store / write_path / read_path / cow / witness
.rvf binary file on disk
```

Live evidence: `.swarm/memory.rvf` (59KB, mtime 2026-05-12T13:03). The prior framing "ruvector-graph uses redb + bincode; RVF not yet wired as backing storage for the other crates" conflated *ruvector-graph crate's internal default persistence* (redb) with *whether RVF is reachable at runtime from controllers* — RVF is reachable end-to-end via the chain above, not just on intent.

**`@ruvector/graph-node` — wired, reachable**

```
agentdb controllers   (CausalMemoryGraph.ts:168, SkillLibrary.ts:84, ReflexionMemory.ts:85)
  → if graphBackend && 'createCausalEdge' in graphBackend
backends/graph/GraphDatabaseAdapter.ts:121
  → const graphNodeModule = await import('@ruvector/graph-node')
  → :140   new GraphDatabase({ storagePath, dimensions, distanceMetric })
@ruvector/graph-node NAPI   (ruvnet/RuVector/crates/ruvector-graph-node/src/lib.rs:18)
  → use ruvector_graph::storage::GraphStorage
  → :88    GraphStorage::new(&path)
ruvector-graph   (ruvnet/RuVector/crates/ruvector-graph/src/storage.rs:22)
  → use redb::{Database, ReadableTable, TableDefinition}
.graph file on disk (redb single-file DB; bincode-encoded values)
```

Live evidence: `.swarm/memory.graph` (1.5MB). Suggested extension `.graph` per `db-unified.ts:103`.

**`ruvector-postgres` pgrx extension — not in any runtime data path**

- Upstream agentdb (`ruvnet/agentic-flow/packages/agentdb/package.json`) depends on `@ruvector/{attention,gnn,graph-node,router,ruvllm,rvf,rvf-node}` — **no `@ruvector/postgres-cli` dep at all**. (The fork's `agentdb/package.json:202` adds the dep declaratively; zero runtime imports of it in either upstream or fork.)
- Upstream ruflo's `ruvector-bridge.ts` plugin (named `ruvector-postgres` at `:93`) connects via `pg.Pool` and at line 1840 calls `CREATE EXTENSION IF NOT EXISTS vector` — **pgvector**, not the ruvector-postgres extension. Vector ops use pgvector operators `<=>`, `<->`, `<#>`. Probes `ruvector.version()` with `COALESCE(..., 'N/A')` (`:223`) — tolerates the extension being absent.
- `IRuVectorClient` (`integrations/ruvector/types.ts:1737`) is a locally-defined interface, **not** `RuVectorClient` from `@ruvector/postgres-cli`. The 8 MCP tools (`ruvector_search`/`_insert`/`_update`/`_delete`/`_create_index`/`_index_stats`/`_batch_search`/`_health`) at `ruvector-bridge.ts:1240-1582` are *named* `ruvector_*` but route through `VectorOps.search/insert/...` to plain pgvector SQL.
- `ruvnet/ruflo/v3/@claude-flow/cli/src/commands/ruvector/setup.ts` is a **scaffold generator** — emits a `docker-compose.yml` + `init-db.sql` referencing `ruvnet/ruvector-postgres:latest` image with DDL using `ruvector_cosine_ops` / `ruvector_exp_map` / `ruvector_poincare_distance` / `ruvector_version()`. The user is expected to then run `docker-compose up -d`. Nothing in ruflo's runtime calls these.

The postgres substrate that IS live in upstream is **pgvector**; the `ruvector-postgres` pgrx extension is reachable only via a user-run docker scaffold with no runtime callers in ruflo or agentdb.

#### Upstream graph storage/querying as it works today (2026-05-12, this session)

Dual-mode pattern in upstream agentdb (`ruvnet/agentic-flow/packages/agentdb/src/db-unified.ts:114`):

```ts
if (this.mode === 'graph') {
  this.graphDb = new GraphDatabaseAdapter(config, embedder);      // graph mode
} else {
  this.sqliteDb = await createDatabase(this.config.path);          // legacy (sql.js)
}
```

Each controller takes optional `graphBackend?` and branches on its presence (CausalMemoryGraph.ts:168, SkillLibrary.ts:84, ReflexionMemory.ts:85). Without it, controllers fall through to SQLite prepared statements against `causal_edges`/`skill_edges`/etc.; multi-hop uses `WITH RECURSIVE` CTEs (CausalMemoryGraph.ts:507, :584).

**Imperative-API graph path — works end-to-end:** `graphAdapter.createCausalEdge` (CausalMemoryGraph.ts:192), `graphAdapter.storeSkill` (SkillLibrary.ts:90), `graphAdapter.searchSkills` (SkillLibrary.ts:213), `graphBackend.createNode(['Episode'], {...})` (ReflexionMemory.ts:125), `graphBackend.vectorSearch` (ReflexionMemory.ts:894), `graphBackend.createRelationship` (ReflexionMemory.ts:899). All route through dedicated NAPI methods to real ruvector-graph functions.

**Cypher path — hollow when invoked:** ReflexionMemory.ts:316-317, :451-468 builds `MATCH (e:Episode) WHERE 1=1 AND e.reward >= ${minReward} AND e.success = false ... RETURN e LIMIT ${k*3}` and calls `graphBackend.execute(cypherQuery)`. The chain `GraphBackend.execute` → `GraphDatabaseAdapter.query` (`:232`) → NAPI `db.query(cypher)` → `crates/ruvector-graph-node/src/lib.rs:255-329` does `parse_cypher` correctly, then for `Statement::Match` calls `gdb.get_nodes_by_label(label)` (label-only), explicitly skips `Statement::Create` (L306: "we need mutable access, so skip in query"), no-ops `Statement::Return` (L309: "handled implicitly"). Result: every Episode node returned; WHERE/projection/ORDER BY/LIMIT/relationship pattern all dropped. Same shape as the `ruvector-postgres` Cypher executor the council mapped — different codepath, same hollowness.

So upstream graph today is: **imperative API over `@ruvector/graph-node` → redb (when graph mode selected)** + **`WITH RECURSIVE` CTE over sql.js (when SQLite fallback)** + **Cypher surface that exists but doesn't filter**. The pgrx `ruvector-postgres` extension's Cypher surface is hollow on its own track *and* has zero runtime callers in fork or upstream.

#### Docs claims vs upstream code (2026-05-12, this session)

Verbatim claims from upstream docs (`ruvnet/*`), compared against the source-read findings above.

**Overshoots (docs claim, code does not deliver):**

| Claim | Source | Code reality |
|---|---|---|
| "**Full Cypher engine** — `MATCH (a)-[:KNOWS]->(b)` like Neo4j" | RuVector README L52, L82, L250, L698; ruflo USERGUIDE L5332 | NAPI `query()` does label-only lookup; CREATE skipped, RETURN no-op, WHERE silently ignored, multi-hop / LIMIT / ORDER BY unhandled. |
| Cypher example `MATCH (e:Episode)-[:CAUSED]->(s:Skill) WHERE e.reward > 0.8 RETURN e, s ORDER BY e.reward DESC LIMIT 10` | agentdb README L1422-1429 (verbatim) | Returns every Episode node; WHERE/projection/ORDER BY/LIMIT/relationship pattern all dropped on the executor floor. |
| "**Full Neo4j-compatible Cypher syntax** including MATCH, RETURN, WHERE, ORDER BY, LIMIT, relationship patterns, and graph traversal" | agentdb README L1405 | Only single-label MATCH is honored on the NAPI path. |
| "AgentDB auto-selects: RuVector > Cognitive Container (RVF) > HNSWLib > sql.js" | agentdb README L156 | `db-unified.ts:114` only branches `graph` vs `sqlite` — no 4-tier auto-cascade in unified mode. |
| "Everything lives in a **single Cognitive Container** (`.rvf` file) — vectors, indexes, learning state, audit trail" | agentdb README L19, L357 | Vectors → `.rvf`, graph state → `.graph` (redb), legacy tables → `.db` (sql.js). At least 2-3 files, not one. ADR-029's migration table (with `ruvector-postgres` conspicuously absent) corroborates the parallel-substrate reality. |
| "230+ SQL functions" vs "77+" vs "143" for the postgres extension | RuVector README L62/L161 vs ruflo USERGUIDE L5332 vs ruvector-postgres README L13 | Internally inconsistent; the council's "one real number" point stands. |
| `ruvector_cypher_query('MATCH ...')` example in README | RuVector README L567 | Actual pgrx fn is `ruvector_cypher(graph_name, query, params)` — 3 args, different name. |
| 8 MCP tools advertised as the "RuVector PostgreSQL Bridge" surface | ruflo USERGUIDE L1934-2050 | Tools named `ruvector_*` route to **pgvector**, not the ruvector-postgres extension. |

**Matches (where docs and code agree):** RVF as binary substrate for memory items (agentdb README L19, USERGUIDE L3054-3180); `@ruvector/graph-node` as the graph backend (agentdb README L1401); imperative API methods (`createNode`/`createEdge`/`createHyperedge`/`kHopNeighbors`/`searchSimilar`); GNN re-rank and attention mechanisms (`ruvector-gnn`, `ruvector-attention`).

#### Upstream ADR coverage of the gap (2026-05-12, this session)

What upstream ADRs say about the Cypher/graph/postgres gaps documented above.

| ADR | Status / Date | Stance toward the gap |
|---|---|---|
| **ruflo ADR-087 — graph-node native backend** | Implemented 2026-04-07 | Names the gap (`@ruvector/graph-node` installed, 0 references in source). Wires only the imperative API. **Explicit non-goal (L62): "Not adding Cypher query interface (graph-node querySync untested)"**. Persistence note (L76): graph-node returns null path but data persists. |
| **agentdb ADR-007 — full-capability integration** *(authoritative path: `ruvnet/agentdb/docs/adrs/` after the 2026-05-06 extraction from `ruvnet/agentic-flow/packages/agentdb/`)* | "Phase 1 Complete (Proposed for Phases 2-5)" | Names `querySync(cypher)` as **HIGH priority, Phase 1** (L197). Plans (L565-567): "Add Cypher query support via querySync". Success Metrics (L824) Phase 5 target: "ACID + Cypher". **This plan presupposes querySync works** — the executor placeholder prevents it; ADR-087 specifically backed away. |
| **RuVector ADR-080 — npx-ruvector deep capability audit** | Accepted | Names performance-claim-vs-reality gap (L161) and "MCP tool functionality untested" (L162); catalogues 6 stub MCP tools. **Treats query-engine tools as "real implementations" (L103)** — audit appears to have only checked the rvlite path. |
| **RuVector ADR-143 — implement missing capabilities** | Accepted 2026-04-06 | Audits `ruvector` npm v0.2.22; fixes 3 specific gaps (speculative embedding stub, RAG keyword-only, DiskANN claimed-but-missing). **Cypher executor placeholder not named.** Concludes "All other 14 modules verified as real implementations" — same blind spot as ADR-080. |
| **RuVector ADR-029 — RVF as canonical binary format** | Accepted 2026-02-13 | Migration table lists 7 libraries moving to RVF; **`ruvector-postgres` conspicuously absent**. Quietly disproves the "single Cognitive Container" framing at the canonical-format level. |
| **ruflo ADR-027 — RuVector PostgreSQL Integration** | Proposed 2026-01-16 (still Proposed) | Original plan to wire `@ruvector/postgres-cli` as a plugin bridge. ~4 months in "Proposed". The shipped `ruvector-bridge.ts` is a **different design** (pgvector via `pg.Pool`); no ADR formally retires/restates ADR-027 or explains the divergence. |
| **RuVector ADR-044 — ruvector-postgres v0.3 extension** | Accepted, in flight | Adds 42 new SQL functions (101 → 143). Ships the extension; doesn't address the fork-runtime disconnect. |
| **RuVector ADR-071 — npx-ruvector ecosystem gap** | Proposed | Proposes unified `ruvector graph query` Cypher CLI entry point. About CLI surface, not the executor placeholder. |
| **ruflo ADR-053 — agentdb v3 controller activation** | Implemented 2026-02-25 | Activates 28 controllers; confirms dual-mode design ("Optional GraphDatabaseAdapter for persistent graph storage", L75). |
| **ruflo ADR-057 — RVF native storage backend** | Proposed 2026-02-28 | Replaces sql.js with RVF in event-store + memory + embeddings (3 separate `.rvf` consumers — confirms multi-substrate reality). Doesn't touch graph or ruvector-postgres. |
| **ruflo ADR-056 — agentic-flow v3 integration** | (referenced) | Confirms `@ruvector/graph-node@^2.0.2` as the graph dep. |

**What no upstream ADR addresses today:**

1. The Cypher executor placeholder at `crates/ruvector-graph/src/executor/mod.rs:129`.
2. The NAPI `query()` short-circuit at `crates/ruvector-graph-node/src/lib.rs:255-329` (Statement::Create skipped, Statement::Return no-op, label-only Match).
3. The hollow `ruvector-postgres` Cypher path at `crates/ruvector-postgres/src/graph/cypher/executor.rs` — author-labelled "Simplified" three times, passed over in 2026-03-03 audit `229877fe`.
4. The README/USERGUIDE "Full Cypher" claims overshooting code (ADR-080 audits performance claims; ADR-143 audits 3 specific feature claims; Cypher executor is out of scope for both).
5. The "single Cognitive Container" framing vs `.rvf` + `.graph` + `.db` multi-file reality.
6. The ADR-027 (consumer-side plan) ↔ `ruvector-bridge.ts` (shipped, pgvector-based) divergence.

These six are the gaps ADR-0174 captures that no upstream ADR currently does. The cypher-verification council documents (3); this ADR's research record documents (1)-(6). Decision (Option α) unchanged.

#### Late-breaking finding (2026-05-12) — Cypher hollow path biting newly-shipped upstream code

After refreshing local clones to live GitHub HEAD, traced one more callsite that lands the council's hollow-Cypher finding squarely on **code shipped this week** in upstream `ruvnet/agentdb` + `ruvnet/ruflo` v3.7.0-alpha.8.

**Chain:**

1. **`ruvnet/RuVector` commit `1493bab0` (2026-05-06)** — `feat(graph-node): add deleteNode/deleteEdge/deleteHyperedge API — closes #427`. Rust source adds the three delete methods to `crates/ruvector-graph-node/src/lib.rs`; version bump 2.0.3 → 2.0.4 declared.
2. **Published `@ruvector/graph-node@2.0.4` on npm DOES NOT include the delete methods.** Verified by installing the package and reading the shipped `.d.ts` (322-line auto-generated NAPI loader; `delete*` not in the exported class). The Rust source was updated but the published binary lags. Method list on the published class: `createNode/createEdge/createHyperedge/query/querySync/searchHyperedges/kHopNeighbors/begin/commit/rollback/batchInsert/subscribe/stats`. No deletes.
3. **`ruvnet/agentdb` (extracted 2026-05-06, commit `8b3388b`) implements delete via Cypher** — `src/backends/graph/GraphDatabaseAdapter.ts:292-401`. Comment at L295-300 (verbatim):
   > "The native @ruvector/graph-node binding (currently 2.0.4) doesn't expose direct deleteNode / deleteEdge / deleteHyperedge methods, but `query()` accepts arbitrary Cypher. We implement deletes by routing through Cypher so downstream consumers (ruflo's adr-index, agent decommissioning, etc.) can keep the graph in sync with external sources of truth without rebuilding the whole database."
   Emitted Cypher: `MATCH (n {id: 'X'}) DETACH DELETE n RETURN count(n) AS deleted` (and analogous for edge / hyperedge / by-endpoints). Routes through `db.query(cypher)` — the NAPI `query()` path this ADR's research record already documented as hollow.
4. **`ruvnet/agentdb/tests/unit/controllers/ReflexionMemory-delete.test.ts:144-244` tests only with a `CypherSpy` mock** that returns canned `{ deleted: 1, edgeCount: 3 }` rows when the emitted Cypher string matches a regex. The tests assert *emission* (the right Cypher string is built and `firstNumeric` reads the right field) — they never run against the real published NAPI binding, so they don't catch the hollow path.
5. **`ruvnet/ruflo` v3.7.0-alpha.8 (2026-05-06, commits `d031c3d13` + `584fc8e66` + `6c14c912e`) wires three MCP tools** that call the adapter's delete methods: `agentdb_hierarchical-delete` → `ReflexionMemory.deleteEpisode`; `agentdb_causal-edge-delete` → `GraphDatabaseAdapter.deleteEdgesByEndpoints(from, to, relation?)`; `agentdb_causal-node-delete` → `GraphDatabaseAdapter.deleteNode(id, {cascade: true})`. USERGUIDE.md update (commit `6c14c912e`, verbatim) advertises: *"Three new MCP tools wired through agentdb@3.0.0-alpha.13's native Cypher-routed delete API … Closed [#1784]"*.
6. **Net effect at runtime:** When a user invokes `agentdb_causal-node-delete` against a real `@ruvector/graph-node@2.0.4` binding, the chain executes as:
   - ruflo MCP tool → `GraphDatabaseAdapter.deleteNode('episode-123', {cascade: true})`
   - adapter emits `MATCH (n {id: 'episode-123'}) DETACH DELETE n RETURN count(n) AS deleted`
   - NAPI `query()` at `lib.rs:255-329` parses successfully, then:
     - `Statement::Match` with no label → `node_pattern.labels.is_empty()` branch is empty (`// for now just stats`), so `result_nodes` stays empty
     - `Statement::Delete` (and `DETACH DELETE`) falls through `_ => {}`
     - `Statement::Return` is `_ => {}` ("handled implicitly")
   - Returns `JsQueryResult { nodes: [], edges: [], stats: Some(...) }`
   - Adapter: `firstNumeric(result, 'deleted') ?? 0` → 0 → `deletedNode = false`; returns `{ deletedNode: false, deletedEdges: 0 }`
   - **Hypergraph state unchanged — the node was not deleted.**

The ruflo USERGUIDE feature note that closed issue #1784 ships a silent no-op against the published binding. The mock-based test suite passes because it intercepts the binding entirely.

This is the cypher-verification council's "WHERE silently doesn't filter" finding, except for DELETE: "Cypher-routed delete silently doesn't delete" — and it landed in upstream main this week, in code that's now in ruflo 3.7.0-alpha.8.

**What this strengthens for ADR-0174:**

- Gap #1 from "What no upstream ADR addresses today" (the executor placeholder + NAPI `query()` short-circuit) is now actively biting real upstream code in production, not just a theoretical concern.
- The Option α decision (the `graph_*` axis backed by `ruvector-graph` with eventual Cypher executor fork-patch if/when a callsite needs it) gains a concrete real-world consumer to point at: the delete-API path either needs the executor patched, or the imperative `deleteNode`/`deleteEdge`/`deleteHyperedge` published in graph-node@2.0.5+ for the adapter to route through directly instead of Cypher.
- The previous "ReflexionMemory's WHERE silently doesn't filter" example (cypher-verification council) was a soft failure — the controller still returned rows. This new delete-API example is a *hard* failure — the user-facing operation has no effect at all. The Cypher gap has consumer-blast-radius implications the ADR's research record should preserve.

**Liveness check (2026-05-12, post-update):** Verified against live GitHub (not just the 2026-05-02 local clones). Live `ruvnet/ruflo` HEAD `ef73a1616`, `ruvnet/RuVector` HEAD `9054c2cc`, `ruvnet/agentic-flow` HEAD `b280a4c`, `ruvnet/agentdb` HEAD `a478ab3` — all clones now at live HEAD. Drift found and reconciled:
- agentdb was extracted from `ruvnet/agentic-flow/packages/agentdb/` to a dedicated `ruvnet/agentdb` repo on 2026-05-06 (commit `daa521a15`); ADR-007 authoritative path is now `ruvnet/agentdb/docs/adrs/ADR-007-ruvector-full-capability-integration.md`. Cited line numbers (L197, L208, L565, L567, L831) are unchanged on the live file.
- ruflo ADR-087 status header was reformatted on 2026-05-09 (commit `a8ba7276d`, "Status: Implemented" → "Accepted — Implemented · Updated: 2026-05-09"); the non-goal text *"Not adding Cypher query interface (graph-node querySync untested)"* is unchanged.
- No new upstream ADR added between 2026-05-02 and 2026-05-12 names `executor/mod.rs:129`, the NAPI `query()` short-circuit, the hollow Cypher claim, or restates/retires ADR-027. Code-search across all four repos returned zero ADR matches for `executor/mod.rs`, for `placeholder+cypher`, or for `ruvector-bridge`. The new ADRs in the window are orthogonal: ruflo federation (ADR-097/101-111), DSPy.ts plugin (ADR-114), MCP tool guidance (ADR-112), witness temporal (ADR-103), ConsensusTransport (ADR-095 G2), Plugin Capability Sync ADR-098 (about plugin docs surface, not substrate), Claude Managed Agents ADR-115 (about rvagent runtime); RuVector Hailo NPU (ADR-167-170, 179), sparse attention (ADR-183-192), RAIRS IVF (ADR-193).
- One upstream code change in the window is directly load-bearing for ADR-0174: `RuVector@1493bab0` (2026-05-06) added imperative `deleteNode`/`deleteEdge`/`deleteHyperedge` to graph-node's Rust source (version bump 2.0.3 → 2.0.4); the published npm 2.0.4 binding does not yet ship them; agentdb's adapter therefore implements deletes by routing through Cypher (`MATCH … DETACH DELETE … RETURN count(...)`), which the NAPI `query()` no-ops. See "Late-breaking finding" above.
- One upstream structural change in the window: `ruvnet/agentic-flow` switched from vendoring `packages/agentdb/` to a git submodule pointing at the new top-level `ruvnet/agentdb` repo (`.gitmodules` declares `path = packages/agentdb` / `url = https://github.com/ruvnet/agentdb.git`). Confirmed by commits `daa521a` (extraction) + `5e0497d`/`bc31f0b`/`629eb4f`/`d231a13` (submodule pin bumps).

#### Upstream RuVector branches probed (6 candidate branches)

| Branch | Touches executor placeholder? | Active graph work? |
|---|---|---|
| `feat/implement-missing-capabilities` | No (placeholder unchanged) | No recent graph commits |
| `feat/implement-cli-placeholders` | No | No recent graph commits |
| `feature/graph-vector-property-index` | No | **Stalled.** Single commit `29767d33` (2026-04-25), PR #387 opened 2026-04-26, 17 days without activity, 84 commits behind main. Adds `VectorPropertyIndex::build(&graph, "embedding", config)` + `idx.knn(query, k)` as a NEW Rust module (`src/vector_property_index.rs`, ~240 LoC) plus a `GraphDB::node_ids()` accessor and one `error.rs` variant. Behind a `rabitq` cargo feature (default-on). Imperative API only; doesn't touch the Cypher executor. **Earlier text mentioning `has_edge` + batch delete was incorrect** — the commit ships only the VectorPropertyIndex module + supporting tests/bench. The 2026-05-06 `1493bab0` delete-API commit on a different branch is what added `deleteNode`/`deleteEdge`/`deleteHyperedge`. |
| `feat/graph-transformer-crates` | No | No recent ruvector-graph commits |
| `feat/partition-cache-large-graph-guard` | No | No recent commits |
| `research/nightly/2026-04-23-compact-graph-embeddings` | No | No recent commits |

`executor/mod.rs:129` placeholder has not been touched on any branch. Last commits to that file: 3 on 2025-11-25/26 ("Add Neo4j-compatible hypergraph database package" + "Resolve compilation errors" + "Resolve CI build failures").

#### Upstream RuVector PRs reviewed

| PR | State | Branch | Touches | Relevance |
|---|---|---|---|---|
| #292 | open, **base==head==main (broken state)** | main | `crates/rvlite/src/cypher/executor.rs` | Fixes Cypher MATCH multi-row bug (Issue #269) — in **rvlite**, not graph-node. PR will not merge as-stated. |
| #293 | open since 2026-04-21 | `fix/real-benchmarks` | Same Cypher fix + "honest README" | Corrects "100% recall" + "simulated Python baseline" with real hnswlib comparison. The real candidate. |
| #375 | open since 2026-04-24 | `graph-sona-fixes` | ruvector-graph + sona | Disk-first persistence + finite-weight validation; the "144 LoC 3-function reorder" ADR-0173 cited. |
| #387 | **open but stalled** — opened 2026-04-26T03:19Z; `updated_at == created_at`; 0 comments / 0 review comments; `mergeable: false`; 17 days untouched as of 2026-05-12; branch 84 commits behind main | `feature/graph-vector-property-index` (single commit `29767d33`, 2026-04-25T23:18 EDT) | ruvector-graph | VectorPropertyIndex (RaBitQ-backed kNN over node properties) — Phase 1 item #2 of `docs/research/rabitq-integration/05-roadmap.md`. +649 / -1 LoC across 8 files. **Orthogonal to ADR-0174's Phase A.5 Cypher executor patch** — new imperative `knn()` method on a property field, not Cypher-accessible; doesn't touch `executor/mod.rs:129`. Promises: recall@10 ≥ 0.95 at 100k×768d (M1 acceptance gate), 1/16 memory footprint asymptotic, deterministic `(seed, graph) → bit-identical codes` per ADR-154. The stalled cadence (Saturday-night commit with co-author `claude-flow`, opened 6 hours later, untouched since) is itself signal — single-author batch-generated PRs with no follow-up appear common in the RuVector cadence. |
| #421, #428, #443 | open (research nightlies) | various symphony-qg branches | research | Graph-coupled 1-bit/4-bit FastScan neighbor scoring (SIGMOD 2025) — orthogonal to substrate choice. |

#### RVF ↔ ruvector-postgres relationship

**Parallel substrates, no storage-layer fusion.** Confirmed by reading ADR-029's migration table (ruvector-postgres absent) + the ruvector-postgres ARCHITECTURE.md (varlena heap storage, ruhnsw extension index, no RVF reader). The "integration" between RVF and ruvector-postgres is at the **application layer**:

| Concern | RVF answer | ruvector-postgres answer |
|---|---|---|
| Vector storage | RVF segments with progressive HNSW (Layer A/B/C) | postgres heap + `ruvector` varlena type + TOAST |
| Vector search | HnswLite pure-TS (or hnswlib-node native) | ruhnsw extension index, SIMD distance ops |
| Crash safety | Per-segment integrity (no WAL needed) | postgres WAL + checkpoints |
| Quantization | Temperature-tiered (fp16/int8/PQ/binary) per segment | Quantization Engine per row |
| Witness/audit | WITNESS_SEG + ML-DSA-65 PQ signatures | postgres logical decoding / audit extensions |
| Deployment | In-process file (Node/browser/edge/WASM) | postgres server (or pglite WASM) |
| SQL surface | None — queried via library API (`RvfDatabase` + `HnswLite`) | 143 SQL functions + partial Cypher + partial SPARQL |

No FDW reading RVF segments from inside postgres; no `COPY ... FROM file.rvf` SQL surface; no ruvector-postgres reader for RVF. They are independent storage engines that share the higher-level RuVector function surface only conceptually.

This finding is load-bearing for the three-axis framing: each axis owns its substrate, controllers coordinate at the application layer, no cross-axis storage fusion is being assumed.

#### ruflo USERGUIDE references

`/Users/henrik/source/ruvnet/ruflo/docs/USERGUIDE.md` (7,557 lines as of 2026-05-12):

| Lines | Section | Relevance |
|---|---|---|
| **1934-2050** | RuVector PostgreSQL Bridge | Production vector DB integration in ruflo. 8 MCP tools (`ruvector_search/insert/update/delete/create_index/index_stats/batch_search/health`). 39 attention mechanisms, 15 GNN layer types, hyperbolic operations (Poincaré/Lorentz/Klein). Self-learning system (query optimizer + index tuner with EWC++). Performance: 52,000+ inserts/sec, sub-ms queries. |
| **3054-3180** | RVF Storage | Ruflo's RVF usage: 4 magic-byte formats (`RVF\0`/`RVEC`/`RVFL`/`RVLS`), HnswLite pure-TS HNSW, auto-selection cascade `RVF → better-sqlite3 → sql.js → JSON`, atomic writes, `RvfMigrator`, ~50ms cold start vs ~2s for sql.js. Pure TypeScript fallback. |
| **5332-5644** | RuVector | ~61µs HNSW latency, 16,400 QPS, 7+ sub-packages (`@ruvector/{attention,sona,gnn,graph-node,rvlite,router,postgres-cli,...}`), Cypher graph queries, ruvector-postgres Docker image. |

These are described in **separate USERGUIDE sections** — consistent with the parallel-substrate framing. `memory_*` (RVF, lines 3054-3180) and `agentdb_*` (ruvector-postgres, lines 1934-2050) are independent subsystems in user-facing docs. This ADR's `graph_*` axis would warrant its own future USERGUIDE section.

#### Upstream ruflo + agentic-flow ADRs referenced

| ADR | Status | Relevance |
|---|---|---|
| `ruvnet/ruflo/v3/docs/adr/ADR-087-graph-node-native-backend.md` | Implemented 2026-04-07 | Upstream ruflo's working graph-node wiring: `createNode`/`createEdge`/`createHyperedge`/`kHopNeighbors`. Explicit non-goal: "Not adding Cypher query interface (graph-node querySync untested)". This is the existing on-ramp for the imperative API. |
| `ruvnet/agentic-flow/packages/agentdb/docs/adrs/ADR-007-ruvector-full-capability-integration.md` | Phase 1 Complete (Proposed for Phases 2-5) | Lists `@ruvector/graph-node` Cypher querySync as Phase 1 HIGH priority; unblocked by the executor placeholder (Phase 1 work has not closed this gap). |

#### Memory entries consulted

- `feedback-upstream-means-upstream.md` — "Upstream" sources are `ruvnet/*`, never `forks/*`. All citations above are from `/Users/henrik/source/ruvnet/` per this rule.
- `project-rvf-primary.md` — current axis statement: "RVF primary for memory_*; SQLite primary for agentdb_*" (note: pre-dates ADR-0170's postgres choice — needs update regardless of this ADR's outcome).
- `feedback-no-value-judgements-on-features.md` — ship the upstream surface; don't pre-emptively gate. Authorizes Option α cleanly.
- `feedback-no-fallbacks.md` — each axis fails loud on its substrate; no silent cross-axis fallback.
- `feedback-patches-in-fork.md` — Cypher executor patch (if/when needed) goes in `forks/ruvector/`, in-charter for this fork.
- `feedback-no-codex-mentions.md` — observed (no codex references in this ADR).

### Memory entries this ADR would touch

- `project-rvf-primary.md` — add a third row for `graph_*`: "RuVector graph engine (RVF-backed preferred, redb fallback if witness-chain source-read fails — decided at Phase A)". `memory_*` row unchanged. `agentdb_*` row updated: "postgres via `ruvector-postgres` pgrx extension (143 SQL functions: hyperbolic + GNN + hybrid + quantization), NOT pgvector" — per Phase A.6 commitment from the fork-freedom reconsideration section.
- `feedback-no-value-judgements-on-features.md` — Option α + ambitious fork-freedom variant is the route this memory most cleanly authorizes. The narrow Cypher executor patch and the `ruvector-postgres` swap together ship the full upstream surface that upstream's compat envelope keeps them from delivering.
- `project-agentdb-parallel-extraction.md` — already updated 2026-05-12 with the new upstream agentdb path (`ruvnet/agentdb/docs/adrs/`). ADR-0174's substrate composition references the post-extraction structure.

### Open follow-ups before Phase A

1. **Verify RVF witness chain by source-read** — read `rvf-crypto/src/{witness,attestation,sign,lineage}.rs` + the `crypto_sign_verify.rs` integration test to confirm implementation, not scaffolding. Source-read evidence, not LoC-counting. **Now load-bearing** for the fork-freedom recommendation #6 (RVF-backed `graph_*` persistence preferred over redb if and only if the witness chain is real and integrable). If the source-read reveals scaffolding, persistence reverts to redb and witness-chain unification across memory_* + graph_* is deferred.
2. **Pick `graph_*` persistence format** — RVF-backed (preferred under the ambitious variant) vs redb (fallback). Decision informed by (1). **Resolved direction under fork-freedom:** lean RVF-backed for the cross-axis witness-chain unification benefit; commit at Phase A after (1).
3. **Narrow Cypher feature set definition (was: Cypher consumer enumeration).** Under the ambitious variant the question shifts from "do we need Cypher at all" to "which Cypher features go in the narrow executor patch". Enumerate the 5 decision-record skills + 13 graph MCP tools + the upstream consumers (ReflexionMemory's WHERE filter at `:316-317, :451-468`; the four `GraphDatabaseAdapter.delete*` methods that route through Cypher per the late-breaking finding) and map per-callsite to required Cypher features. Confirm the narrow scope from "Option α elaboration A" above covers every enumerated callsite; identify any callsite that requires variable-length paths / MERGE / OPTIONAL MATCH / list comprehensions / CASE / aggregations beyond `count()` — if found, decide whether to expand the patch or rewrite the callsite imperatively. **Inputs already collected:** Cypher-via-postgres has zero live consumers (no MCP tool routes Cypher into `SELECT ruvector_cypher(...)`); agentdb's Cypher path routes through `@ruvector/graph-node`, not the postgres extension; the postgres-Cypher executor (demo-quality per council) stays untouched.
4. **Name the cross-axis controller pattern** — three controllers (CausalMemoryGraph, SkillLibrary, HierarchicalMemory) become cross-axis. Document the coordination pattern: read graph portion from `graph_*`, read SQL aggregates from `agentdb_*`, write to both atomically (or accept eventual consistency where appropriate). Decide before Phase B touches the three cross-axis controllers. Under the ambitious variant, controllers can express the graph half declaratively via Cypher MATCH (after Phase A.5 lands) or imperatively via the typed methods — pick per-controller based on query shape.
5. **Phase B sequencing** — graph-shaped data migration depends on Phase A axis introduction. Decide if Phase B runs in parallel with the rest of ADR-0170 Phase B (controllers proceed independently with their SQL ports unchanged) or after. **Resolved under fork-freedom:** the bundled-release posture allows a single coordinated cutover. Phase B can be hard cutover, not phased rollout. Phase A.5 (Cypher executor) and Phase A.6 (`ruvector-postgres` swap) gate Phase B.
6. **`memory-graph.ts` fate** — once `graph_*` is wired, decide whether the in-process pure-TS layer retires entirely or remains as a query-time analytics layer (Louvain/PageRank computed on-demand over `graph_*` data). Probably the latter for compute-on-read patterns that don't need persistence.
7. **NEW — `ruvector-postgres` install + surface verification (Path X gating)** — before Phase A.6 commits to Path X, verify (a) `ruvnet/ruvector-postgres:pg17,graph-complete,gated-transformer` Docker image is published and pullable; (b) the extension actually installs cleanly against a fresh postgres 17 base; (c) the v0.3.x extension's actual SQL function count is ≥143 per ADR-044's claim; (d) per-function mapping to ADR-0170 controller needs (which controllers use which `ruvector_*` functions; identify any pgvector-only operator with no `ruvector_*` equivalent); (e) confirm `ruhnsw` operator class works with HNSW DDL upstream uses; (f) **test the Path-X-only capabilities specifically** — hyperbolic distance functions return numeric results against real embeddings; GNN layer functions execute without error; attention functions accept the expected tensor shapes; the 6 fastembed models actually run inside postgres. Failure modes: image gone / install broken / function count materially under 143 / Path-X-only capabilities don't work → trigger Path Y per follow-up #11.
8. **NEW — plan upstream PR for the narrow Cypher executor patch** — coordinate timing with `ruvnet/RuVector` maintainers. **Target `main`** (not `feature/graph-vector-property-index` — that branch is stalled per "Upstream RuVector branches probed" above; 17 days untouched, 84 commits behind main, 0 engagement). Prepare against ADR-007's "Cypher Queries — HIGH priority — Phase 1" plan and ADR-087's "querySync untested" deferral as motivating context, and cite the 2026-05-06 delete-API workaround in `ruvnet/agentdb` (commit `8b3388b`) as the load-bearing current-impact case: agentdb's `GraphDatabaseAdapter.deleteNode/deleteEdge/deleteHyperedge/deleteEdgesByEndpoints` route through Cypher because graph-node's published 2.0.4 binding lacks native delete methods, and the hollow Cypher path makes those deletes silent no-ops. The patch converts this whole class of workaround into actual functionality. High-leverage: lands the gap multiple upstream ADRs name but none plan; converts our ~1KLoC ongoing patch into a one-time investment if accepted; earns maintainer relationship credit. Risk: PR rejected or sits in the same stalled-cadence pattern observed for PR #387 (17 days untouched is the upstream baseline, not a red flag) → we carry the patch in fork; mitigation: scope the patch narrow enough that it's the obvious right addition to the existing executor scaffold and pre-emptively handles the delete-API regression upstream's bridge code is already silently broken on.
9. **NEW — patch hosting decision for the Cypher executor** — pick between (a) direct edit of `forks/ruvector/crates/ruvector-graph/src/executor/mod.rs` (republished as `@sparkleideas/ruvector-graph` and `@sparkleideas/graph-node`) — simpler, tracks upstream automatically, harder to retire if upstream PR lands; or (b) dedicated overlay crate `forks/ruvector/crates/ruvector-graph-cypher-patch/` that monkey-patches the executor via trait extension — more complex, easier to retire when upstream accepts the PR. Lean (a) for simplicity; revisit if upstream PR pace is slow.
10. **NEW — Cross-axis controller declarative query patterns.** With Phase A.5 making Cypher real, the cross-axis controllers gain a choice point: write controller logic in TypeScript with imperative calls to `graph_*` + SQL to `agentdb_*`, OR write Cypher queries against `graph_*` and let the planner handle traversal. Establish a convention: use Cypher for variable-shape traversals (multi-hop, optional join, recursive walk); use imperative API for fixed-shape mutations (createCausalEdge with known endpoints). Decide before Phase B touches the three cross-axis controllers so their code shape is consistent.
11. **NEW — Path Y standby plan (`pgvector + pgvectorscale + pg_search`).** Maintain a documented fallback substrate for `agentdb_*` in case Phase A.6 follow-up #7 reveals Path X (ruvector-postgres) is not viable. Path Y composition: `pgvector` as base (`vector(N)` type + `hnsw`/`ivfflat` indexes), `pgvectorscale` for StreamingDiskANN at billion-scale, `pg_search` (ParadeDB) for tantivy-backed BM25 to deliver hybrid vector+BM25+RRF without ruvector-postgres' bespoke functions. Verify: image base `postgres:17` + extension install scripts for all three; per-extension version compatibility matrix; ORM bindings if any controller code depends on them. Capability gaps if forced to Path Y: lose hyperbolic embeddings + GNN-in-SQL + attention-in-SQL + 6 fastembed-models-inside-postgres + in-column quantization. Mitigations: hyperbolic embeddings move to application layer (TypeScript hyperbolic distance fn over plain `vector(N)` columns); GNN re-rank moves to `ruvector-graph` (already chosen for `graph_*`) which has GNN crate adjacencies; attention moves to `@ruvector/attention` NAPI in-process; local embeddings move to `@ruvector/router` or a separate embedding service. Cost of falling back: ~300-500 LoC of additional TypeScript bridging where ruvector-postgres would have provided a SQL function. Decision gate: fall back to Path Y if follow-up #7 fails OR if upstream cadence stalls for 60+ days OR if a load-bearing Path-X-only capability is found to be README-only-not-real during install verification.
