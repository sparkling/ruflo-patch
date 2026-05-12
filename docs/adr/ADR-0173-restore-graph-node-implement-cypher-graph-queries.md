---
status: proposed
date: 2026-05-12
tags: [graph-database, cypher, hyperedges, ruvector, graph-node, retirement-reversal, upstream-alignment, adr-0170, adr-0172]
supersedes: []
depends-on: [ADR-0170, ADR-0172]
implements: []
---

# Restore `@ruvector/graph-node` and implement Cypher graph queries

## Context and Problem Statement

ADR-0170 Phase D (gap-J resolution, 2026-05-12) retired `@ruvector/graph-node` entirely: deleted `forks/agentdb/src/backends/graph/GraphDatabaseAdapter.ts`, removed the dep from `package.json`, made `enableGraph: true` loud-reject at config validation, and dead-stripped the Cypher branches from CausalMemoryGraph, ReflexionMemory, and SkillLibrary.

A subsequent audit (triggered by the same user investigation that produced ADR-0172) compared the retirement against **upstream's** stated direction and surfaced a contradiction:

1. **Upstream `ruvnet/agentdb` ADR-007** ("ruvector-full-capability-integration") lists `@ruvector/graph-node@0.1.26` as **85% UNUSED** and identifies HIGH-priority work to use *more* of it, not less: Cypher querySync (Phase 1), transactions (Phase 1), batch insert (Phase 1), hyperedges (Phase 2), k-hop neighbors (Phase 2), streaming + subscriptions (Phase 4). Direct upstream quote: "Cypher support would replace the current imperative query building with declarative graph queries."

2. **Upstream `ruvnet/ruflo` USERGUIDE.md** features Graph Queries as a **headline capability**: "Graph Queries — Full Cypher syntax (MATCH, WHERE, CREATE)". Example code shows direct Cypher:
   ```js
   await db.execute("CREATE (a:Person {name: 'Alice'})-[:KNOWS]->(b:Person {name: 'Bob'})");
   ```
   `@ruvector/graph-node` is listed in the official 11-package ruvector ecosystem alongside `@ruvector/core`, `@ruvector/gnn`, `@ruvector/router`, etc.

3. **Upstream considers PostgreSQL and graph-node complementary, not substitutable.** USERGUIDE lists them separately: "RuVector PostgreSQL — Enterprise Vector Database (77+ SQL functions)" AND "`@ruvector/graph-node` — Graph DB with Cypher queries". They serve different workload shapes.

4. **`feedback-no-value-judgements-on-features`** (project memory, load-bearing): "Don't curate features — import ALL upstream/orphaned capability. Default to WIRE for any 'wire vs don't wire' decision. NEVER gate on 'trust model doesn't justify it' / 'scale doesn't demand it' / 'redundant' / 'edge case'. Architectural conflicts are solvable via composition, not blocking. Annotate trade-offs in code comments; ship the full surface; let user judge usage."

   The gap-J resolution gated graph-node retirement on three patterns this memory explicitly forbids:
   - "Cypher WHERE evaluator is admittedly incomplete" → trust-model gating
   - "`createHyperedge`/`searchHyperedges` have zero in-fork call sites" → scale gating ("edge case")
   - "`enableGraph: false` is the de facto default" → redundancy gating (this is *also* the disabled-by-default anti-pattern ADR-0172 separately targets)

5. **PostgreSQL/pgvector does not functionally replace graph-node.** Phase C-1 verified the *actually-used* surface (multi-hop traversal via `WITH RECURSIVE`, node CRUD via tables, similarity via pgvector). But the *aspirational* surface (Cypher syntax, property graphs, hyperedges, k-hop primitives, subscriptions, graph algorithms) is not available in plain pgvector. Three options to provide it:
   - Re-vendor `@ruvector/graph-node` (this ADR's choice — aligns with upstream)
   - Apache AGE postgres extension (Cypher inside postgres, but not shipped with pglite default)
   - Build out the WITH RECURSIVE patterns more (lost capabilities permanent)

The retirement was a value judgement on the aspirational surface. Per the memory, this is exactly the curation rule we agreed not to make.

### Scope clarification — what stays retired

This ADR does not un-retire `hnswlib-node` or `sqlite-vec`. Those retirements stand:

- **`hnswlib-node`**: in-memory HNSW index, replaced by pgvector HNSW (Phase C-1). Same algorithm, persistence + query-planner integration are upgrades. No upstream signal that hnswlib-node is meant as a complementary surface to pgvector; both provide the same HNSW algorithm.
- **`sqlite-vec`**: SQLite virtual-table vector extension. Retired alongside SQLite itself per ADR-0170's substrate replacement. Equivalent surface is pgvector.

`@ruvector/graph-node` is materially different: it provides **graph capabilities pgvector does not** (Cypher, hyperedges, k-hop primitives, property graphs). The retirement loses these without replacement.

## Decision Drivers

* **Upstream alignment.** Upstream `ruvnet/agentdb` ADR-007 has graph-node as Phase 1 (HIGH priority) integration work. Upstream `ruvnet/ruflo` USERGUIDE features Cypher graph queries as a headline. Diverging from upstream on this axis would force ongoing translation cost during upstream-sync.
* **`feedback-no-value-judgements-on-features`** (project memory). The gap-J reasoning relied on patterns this memory forbids (incompleteness gating, zero-call-sites gating, default-disabled gating).
* **ADR-0166 axis-separation preserved.** memory_* axis = RVF; agentdb_* axis = postgres for relational, graph-node for graph. The graph axis is a fork in the agentdb_* substrate, not a violation of axis-separation — it's a *deeper* substrate decomposition that mirrors upstream's architecture.
* **ADR-0172 init-template alignment.** ADR-0172 already proposes flipping disabled-by-default controller flags. `graphAdapter: true` joins that flip as part of the same audit work; the two ADRs reinforce each other.
* **Capability gap is real.** Cypher syntax, hyperedges, k-hop neighbors, graph subscriptions — none replaceable by plain pgvector. WITH RECURSIVE covers some traversal but not the wider graph-query surface.
* **No-fallback policy** (`feedback-no-fallbacks`, ADR-0170 §"No-fallback policy"). Restoration must keep the fail-loud posture: if `@ruvector/graph-node` is unavailable at boot, the controller fails loud — not silent fallback to "graph operations unavailable, using SQL only".

## Considered Options

* **Option A** — Status quo. Keep graph-node retired. Document the capability gap. Accept the divergence from upstream.
* **Option B** — Restore `@ruvector/graph-node` dep + `GraphDatabaseAdapter.ts` + the 3 controller branches. Fix the incomplete Cypher WHERE evaluator. Enable `graphAdapter: true` in init template. Composition: graph-node and postgres coexist; each handles its strength. **Upstream-aligned.**
* **Option C** — Adopt Apache AGE postgres extension instead. Cypher support lands inside postgres. Single substrate. Requires extension-loading work on pglite + server postgres; pglite may not support AGE natively.
* **Option D** — Build out the WITH RECURSIVE / SQL graph patterns more. No new dep. Accept that Cypher syntax, hyperedges, etc. remain unavailable. Equivalent to a stronger Option A.

## Decision Outcome

Chosen option: **Option B** — Restore `@ruvector/graph-node` and implement the Cypher graph surface. graph-node coexists with postgres in the agentdb_* substrate; each handles its strength.

### Rationale

1. **Upstream architecture wins on technical merit too.** Cypher is a declarative, well-understood graph query language. Hyperedges, k-hop neighbors, graph subscriptions are real capabilities consumers (skills, hives, swarms) can use. WITH RECURSIVE covers a subset; the rest is genuinely lost.

2. **`feedback-no-value-judgements-on-features` is load-bearing project memory.** It exists because past retirements based on "incomplete" or "edge case" gating cost the fork capabilities that turned out to matter. Reversing this retirement honors that memory.

3. **Option C (Apache AGE) is interesting but riskier.** AGE inside pglite is unproven; AGE on a server postgres requires SUPERUSER privilege to `CREATE EXTENSION` (a pre-existing concern from PostgresBackend's pgvector loading). Re-vendoring graph-node is the path upstream chose and the path the existing controller code already has shape for (the dead-stripped branches are in git history).

4. **Composition resolves the "consolidation goal" objection.** ADR-0170's "consolidation to 2 substrates (postgres + RVF)" was a legitimate goal, but per the memory: "Architectural conflicts are solvable via composition, not blocking." Three substrates (postgres + RVF + .graph) is the upstream-shipped state. The trade-off is real but the memory says to accept it and annotate, not exclude.

### Phased plan

**Phase A — restore the dep + adapter (no controller changes yet).**

1. Add to `forks/agentdb/package.json`: `"@ruvector/graph-node": "^2.0.4"` (latest as of audit). Match the upstream agentic-flow v2 plan's version where alignment matters.
2. Restore `forks/agentdb/src/backends/graph/GraphDatabaseAdapter.ts` from git history (parent of commit `4d83da2`, which was b7-causal-memory-graph's port). Use `git show <parent>:src/backends/graph/GraphDatabaseAdapter.ts`.
3. Restore the `forks/agentdb/src/backends/graph/` directory and any sibling files (NodeIdMapper, GraphBackend interface).
4. Wire back into `forks/agentdb/src/core/AgentDB.ts`: the `if (this.config.enableGraph) { GraphDatabaseAdapter.initialize(); }` block per ADR-0170 line 384-407. Add `await graphAdapter.initialize()`.
5. Restore the `enableGraph` field on `AgentDBConfig`. Reverse the Phase D loud-reject. Default to `false` for backward compatibility; ADR-0172 Phase B flips the init-template default to `true`.

Commit: `adr-0173 Phase A: restore @ruvector/graph-node + GraphDatabaseAdapter (gap-J retirement reversal)`. Push to sparkling.

**Phase B — fix the incomplete Cypher WHERE evaluator.**

1. Locate the documented-incomplete evaluator at `GraphDatabaseAdapter.ts:246` (per gap-J resolution doc). Identify which Cypher WHERE clause types are unsupported.
2. Implement support for the missing clause types. Acceptance: a contract test exercising the previously-broken cases must pass.
3. If completing the WHERE evaluator is non-trivial, ALTERNATIVELY: delegate the WHERE evaluation to graph-node's native `querySync(cypher)` API (per upstream ADR-007's Phase 1 work). The adapter becomes a thin wrapper; native graph-node handles Cypher parsing + evaluation.

Commit: `adr-0173 Phase B: complete Cypher WHERE evaluator (graph-node native querySync delegation OR JS completion)`.

**Phase C — restore the 3 controller branches.**

1. **CausalMemoryGraph** (lines 227-260 per gap-J): restore the graph-Cypher branch alongside the WITH RECURSIVE branch. When `enableGraph` true and graphAdapter available, Cypher is the primary path; SQL is fallback. **NOT silent fallback** — both paths are exercised and consistency between them is verified at acceptance time. Per `feedback-no-fallbacks`, the dual-write is explicit and the read returns the same data from either path.
2. **ReflexionMemory** (lines 347-350, 418-428, 986-1067): restore `retrieveFromGraphAdapter`, `retrieveFromGenericGraph`, `createEpisodeGraphNode`, and the deleteEpisode graph branches.
3. **SkillLibrary** (lines 172-196, 316-321): restore the graph-skill creation and graph-skill search branches.

Per-controller commits:
- `adr-0173 Phase C.1: CausalMemoryGraph re-wires graph-node Cypher branch`
- `adr-0173 Phase C.2: ReflexionMemory re-wires graph-node episode operations`
- `adr-0173 Phase C.3: SkillLibrary re-wires graph-node skill operations`

**Phase D — wire upstream ADR-007 Phase 1 graph-node capabilities.**

Per upstream agentdb ADR-007's Phase 1 (HIGH priority):
1. **Cypher querySync** as the primary controller query mechanism (the adapter's `query()` method).
2. **Transactions** wired into the controller mutation surface — multi-step graph mutations get ACID guarantees.
3. **Batch insert** for bulk node/edge ingest (10-100x speedup per upstream's claim).

Commits per capability.

**Phase E — enable `graphAdapter: true` in init template + acceptance.**

1. Update `forks/ruflo/v3/@claude-flow/cli/src/init/config-template.ts:163` (or wherever `agentMemoryScope` lives) to add `graphAdapter: true` to `controllers.enabled` (or set `enableGraph: true` on the AgentDBConfig pass-through).
2. Update memory `project-rvf-primary.md`: the agentdb_* substrate is PostgreSQL + graph-node (composition); the memory currently says PostgreSQL-only.
3. Run full acceptance: target 674/674 PASS (no skips). The B5/graphAdapter test ADR-0172 Phase D retired must be RESURRECTED — restore the test, restore the controller list entry, restore the runner invocations. Total count returns to 674.
4. Final release.

Commit: `adr-0173 Phase E: enable graphAdapter by default; restore B5/graphAdapter acceptance test`.

### What this means for ADR-0170 and ADR-0172

- **ADR-0170 Phase D's gap-J resolution is partially reversed.** The substrate replacement (SQLite → pglite) survives; only the graph-node retirement portion of Phase D reverses. ADR-0170 status stays `accepted` (the bulk of the work was correct).
- **ADR-0172 Phase B's init-template flip** extends to include `graphAdapter: true`. The two ADRs land their init-template work coordinated.
- **ADR-0166's axis-separation preserved.** The agentdb_* axis is PostgreSQL for relational + pgvector for vectors + graph-node for graphs. Three substrates with explicit roles, composed.

### Consequences

* Good, because Cypher graph queries return to the agentdb_* surface (alignment with upstream's headline capability).
* Good, because hyperedges, k-hop neighbors, graph subscriptions become available again (capabilities pgvector does not provide).
* Good, because upstream-sync friction decreases — when upstream lands ADR-007's Phase 2-4 graph-node work, we can pull it forward without architectural reversal.
* Good, because the `feedback-no-value-judgements-on-features` precedent gets reinforced by a visible reversal, not just lip service.
* Good, because the incomplete Cypher WHERE evaluator gets *fixed*, not deleted-around — solving a real bug instead of removing the surface that exposed it.
* Bad, because on-disk substrate count returns to 3 (postgres + RVF + .graph), undoing ADR-0170's consolidation. Trade-off is explicit per the memory.
* Bad, because graph-node restoration adds native-module dep (NAPI bindings). Install-time complexity returns to where it was pre-ADR-0170. This is upstream's posture; we re-adopt it.
* Bad, because the dual-substrate consistency (graph-node + postgres reading/writing the same logical entity) reintroduces sync challenges that gap-J flagged. Mitigation: per-controller, the graph branch is the *primary* path; postgres is the relational metadata; controllers explicitly write to both and verify consistency at acceptance time (no silent dual-write per ADR-0082).
* Neutral, because pgvector continues to handle vector similarity (graph-node's vector capabilities are not used to replace pgvector — graph-node is for graph queries, pgvector is for k-NN).

### Confirmation

Compliance verified by:

1. **Phase A complete** when `@ruvector/graph-node` is in `forks/agentdb/package.json` deps, `GraphDatabaseAdapter.ts` exists, `enableGraph: true` no longer throws at config validation, and `await graphAdapter.initialize()` is called when `enableGraph: true`.
2. **Phase B complete** when a contract test for the previously-incomplete Cypher WHERE clauses passes against the rewired adapter.
3. **Phase C complete** when the 3 controllers' graph branches are restored and acceptance covers both the graph-path and SQL-path with consistency verification.
4. **Phase D complete** when querySync/transactions/batch-insert from upstream ADR-007 Phase 1 are wired into the adapter and exercised by tests.
5. **Phase E complete** when init template generates `enableGraph: true` (or `graphAdapter: true`) by default, the B5/graphAdapter acceptance test is restored, and the suite passes 674/674.

### Out of scope

* **Apache AGE adoption** (Option C). Defer for now; revisit if `@ruvector/graph-node` becomes unmaintained.
* **Hyperedge consumer wiring**. Phase D wires the capability; deciding which controllers should USE hyperedges is downstream design work (ADR follow-up). Memory `feedback-no-value-judgements-on-features` says ship the surface; consumers can adopt when ready.
* **Graph algorithms (PageRank, centrality, community detection)**. Listed in upstream USERGUIDE as graph-node capabilities; not wired by Phase D. Future ADR if/when needed.
* **Reversing `hnswlib-node` or `sqlite-vec` retirements**. Those substrates ARE genuinely replaced (pgvector covers them). graph-node is the only one with a real capability gap post-retirement.

## More Information

### Related ADRs

* **ADR-0170** — Substrate replacement (SQLite → pglite). Phase D's gap-J resolution is partially reversed by this ADR; the substrate replacement itself is preserved.
* **ADR-0172** — Router silent-fallback + disabled-controller audit. Phase B's init-template flip extends to include `graphAdapter: true`. The two ADRs land their init defaults in coordination.
* **ADR-0166** — Axis-separation. The agentdb_* substrate decomposes into postgres (relational + vector) + graph-node (graph); the axis-separation rule is preserved at a coarser level.
* **ADR-0117** — Marketplace MCP server registration. The graphAdapter controller's MCP tools (`agentdb_graph_node_create`, `agentdb_graph_edge_create`, etc.) return to the surface; consumers can call them.
* **Upstream `ruvnet/agentdb` ADR-007** — "ruvector-full-capability-integration". Lists graph-node's unused Cypher/transactions/hyperedges/batch as Phase 1-2 work. This ADR ports upstream's intended direction into the fork.

### Why this surfaces now

User question 2026-05-12 ("why did we do this?" re: graph-node retirement) triggered a re-read of gap-J's reasoning against `feedback-no-value-judgements-on-features` and upstream agentdb ADR-007. The conflict became evident; the user requested an ADR to reverse the retirement.

### Upstream package versions to align

- `@ruvector/graph-node@^2.0.4` (current Verdaccio + npm-registry)
- Alongside `@ruvector/core@^0.1.30+`, `@ruvector/gnn@^0.1.23+`, etc. — the broader ecosystem ADR-007 references.

Per ADR-0170 Phase A's `optionalDependencies` posture for `@ruvector/postgres-cli`: consider whether graph-node should be `dependencies` (hard requirement) or `optionalDependencies` (graceful degrade). Per `feedback-no-fallbacks`, hard `dependencies` is correct — if graph-node fails to load and `enableGraph: true`, AgentDB throws at boot. If `enableGraph: false`, the dep load is skipped entirely.
