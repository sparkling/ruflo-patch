# ADR-0173 Graph DB Council — Round 3 transcript

**Date:** 2026-05-12
**Team:** `graph-db-council`
**Composition shift:** Queen + Devil's Advocate participating **alongside** experts in real-time (not as sequential follow-on rounds), per project memory `feedback-council-queen-da-alongside-experts.md`.

## Constraint deltas from R2 → R3

1. **DROP PGLITE FOREVER.** PG-server is the substrate.
2. **Capability-driven, not consumer-driven.** Graphs haven't been available — absence of multi-hop callsites is consequence, not signal.
3. **ADR plugin IS a graph consumer.** `adr-index` skill uses `mcp__ruflo__agentdb_causal-edge` + `agentdb_hierarchical-store` to build ADR dependency graph (typed `supersedes`/`depends-on`/`implements` relations).
4. **graph-node Cypher CAN be patched** in patch repo.
5. **Validate Vela claim**: confirmed `Vela-Engineering/kuzu` exists (29 stars, MIT, last push 2026-03-09).

## Team-lead reconnaissance (before R3 dispatch)

Comprehensive grep for graph consumers across `/Users/henrik/.claude/skills/`, `forks/agentdb/src/`, `forks/ruflo/v3/`:

1. **5 decision-record skills** use graph MCP tools: `adr-index`, `adr-create`, `odr-index`, `odr-create`, `odr-review` — typed-relation frontmatter (`supersedes`/`depends-on`/`implements`)
2. **13+ graph-shaped MCP tools** in `agentdb-tools.ts`: causal-edge, causal-edge-delete, causal-query, causal-recall, causal-node-delete, graph_node_create, graph_node_get, graph_edge_create, hierarchical_store, hierarchical_recall, hierarchical-delete, skill_create, skill_search
3. **`memory-graph.ts`** in `forks/ruflo/v3/@claude-flow/memory/` (405 LoC pure-TS) — knowledge graph with PageRank + Louvain/label-propagation + 5 edge types (`reference|similar|temporal|co-accessed|causal`)
4. **`SparsificationService.ts`** — Personalized PageRank, spectral methods, random walk
5. **Plugin `@claude-flow/plugins/src/integrations/ruvector/gnn.ts`** — GNN analysis
6. **Coordination agents**: pagerank-analyzer, mesh-coordinator, consensus-coordinator, topology-optimizer

## Revised R3 positions

### postgres-architect (R3) → AGE single Phase C (collapse C-1/C-2)

Tightened recommendation. PG-server-only flips equation harder toward AGE:
- Build matrix collapses to one cell: PG17 + AGE 1.6.0/1.7.0-rc + pgvector + apache/age Docker image.
- `shared_preload_libraries` + SUPERUSER are operational concerns, not deployment blockers (self-hosted = we own postgres.conf).
- PR #375 patchability removes one objection but **substrate bifurcation cost is independent**. graph-node + redb is a separate process from postgres — no cross-engine joins for ADR plugin queries like "ADRs depending on ADR-0170, status=accepted, ordered by embedding similarity."

Updated Phase C scope: pgvector + AGE + apache/age:PG17_latest Docker base image + graph schema for 5 known consumers (ADR/ODR, SkillLibrary, CausalMemoryGraph mirrored, GNN). CausalMemoryGraph keeps E-Hardened SQL for 5-hop traversal.

### graph-theory-expert (R3) → AGE primary, REVERSED from R2

**Honest concession of 3 R2 errors:**
1. Underweighted hybrid vector+graph workload pattern (was 30%, now 60% under capability framing)
2. Overweighted Vela's multi-writer advantage (postgres MVCC covers it)
3. Treated columnar/Arrow as more load-bearing than it is (algorithms run in-process anyway)

7 graph-shaped workloads currently linearized identified:
- ADR dependency graph (typed labeled multigraph; transitive closure + cycle detection)
- Plugin dependency graph (DAG with version constraints)
- Hive coordination DAG (queen→worker→subworker + cross-edges)
- Session→agent→memory provenance (bipartite-with-extension)
- Skill prerequisite chains (weighted DAG)
- Causal pattern composition (path enumeration with confidence aggregation)
- Memory consolidation lineage (provenance DAG with merge semantics)

NetworkX-native interop matters less than thought; ruflo runs algorithms in-process (Rust+WASM in Sparsification, TS in MemoryGraph). AGE's agtype overhead is bounded for `to_networkx()` callers only. **AGE wins on 6 of 9 capability-weighted axes.**

### oss-graph-landscape (R3) → AGE; Kuzu/Lady/Vela ALL drop

Two findings:
1. **Kuzu has no live server-mode option.** `kuzudb/api-server` (Express.js REST wrapper) archived 2025-10-10. LadybugDB hasn't built one. Vela-Engineering/kuzu (29 stars, last push 2026-03-09) hasn't built one. Under PG-server-only deployment, Kuzu/Lady/Vela all drop out.
2. **Apache AGE shipped official NetworkX adapter in Sept 2025.** AGE Python driver now has `age_to_networkx()` adapter methods. Closes Kuzu's interop advantage (Arrow-backed export only helps Pandas/Polars, not NetworkX which uses native Python dicts).

Re-ranked: AGE (1), HugeGraph fallback (2), NebulaGraph (3).

### ruvector-status-analyst (R3) — DISSENT: pglite + WITH RECURSIVE already shipped per ADR-0170 Phase B

**Council is litigating a decision the fork already made.** Verified:
- `forks/agentdb/src/mcp/agentdb-mcp-server.ts` causal_query handler → `CausalMemoryGraph.queryCausalEffects()` → `PostgresBackend.query()` → WITH RECURSIVE on `causal_edges` table. **No graph-node call.**
- `forks/agentdb/src/core/AgentDB.ts:401-409` throws loudly on `config.enableGraph = true`: "AgentDBConfig.enableGraph is retired (ADR-0170 Phase D / resolution-J). @ruvector/graph-node was removed as an optionalDependency. The graph features (causal edges, hyperedges) now route through postgres SQL — typically WITH RECURSIVE on causal_edges/skill_edges."
- MCP tools `agentdb_graph_node_create/get/edge_create` have **NO LIVE HANDLERS** in `agentdb-mcp-server.ts` — stale-deferred or rejected at config-level.

**Cypher executor in `ruvector-graph` Rust crate doesn't exist.** Direct read of `crates/ruvector-graph/src/executor/mod.rs:129-133`:
```rust
fn execute_sequential(&self, _plan: &PhysicalPlan) -> Result<Vec<RowBatch>> {
    // Note: In a real implementation, we would need to reconstruct operators
    // For now, return empty results as placeholder
    Ok(Vec::new())
}
```
The 21 Cypher execution tests in `tests/cypher_execution_tests.rs` have **every `db.execute()` assertion commented out**. There IS no executor to expose.

Patch scope for ruflo's narrow subset: 1,500-3,000 LoC of Rust (not 500-1,500 as R2 estimate suggested).

Recommendation: **Reject A, C, AGE — endorse already-shipped pglite path.** Counter-position to user's "drop pglite" directive: fork's queries don't NEED Cypher; they reduce cleanly to SQL.

### performance-engineer (R3) → AGE primary, REVERSED from R2 C

**Major pivot.** Three new findings:
1. **D (Kuzu) ELIMINATED**: Kuzu is embedded-only by design (per Kuzu docs verbatim). Vela's fork inherits this — no server mode exists. Under PG-server-only topology, embedded-Kuzu-in-Node = embedded-pglite-in-Node (eliminated by symmetry). RPC shims (kuzu-mcp-server) destroy Kuzu's zero-copy advantage.
2. **NetworkX advantage corrected**: Per Kuzu's own docs, "Running graph algorithm in NetworkX will be slower than using Kuzu's algo extension, due to additional overhead in dealing with Python objects." Arrow-backed export is for Pandas/Polars, not NetworkX (which uses Python dicts). NetworkX is Python-only — irrelevant for JS/Rust ruflo.
3. **C executor confirmed hollow**: 540 LoC Rust patch minimum (Ge/Le/And/Or/Not + property access + real WHERE + variable-length paths + path projection + WITH chaining). 2-3 engineer-weeks. Not "easy fix."

Analytics reality: PPR is the only real consumer (in `@ruvector/sparsifier` NAPI, pulls edge lists). Louvain/centrality are only CLI wizard text + config labels, not runtime code.

**Verdict**: B (AGE) primary for new Cypher capability; E (CYCLE-migrated SQL) keeps existing hybrid workload; `@ruvector/sparsifier` keeps analytics.

### production-ops-engineer (R3) → AGE primary, REVERSED FROM R2 A

**Major pivot.** R2 "Option A cheap engineering" case dies against the real consumer surface.
- R2 was scoped to 3 controllers (ADR-0173 Phase C surface).
- R3 scope: 6 consumer categories (5 skills + 13 MCP tools + memory-graph + Sparsification + plugins + 4 coord agents).
- When surface grows 2×, the dimension that dominates ops cost shifts from "binary install matrix" to "Cypher executor implementation."

For A's consumer-surface coverage, someone must implement a Cypher executor (Rust, 500-2000+ LoC depending on scope). AGE ships Cypher today.

AGE on self-hosted PG-server install matrix collapses to (current PG major) × 4 archs given PG-server-only deployment. Per-conn `LOAD 'age'` hook is ~10 LoC. Backup/DR: standard `pg_dump`, **zero new ops work**.

JanusGraph/HugeGraph: adding a daemon is strictly more ops than an AGE extension. Vela-Kuzu has no real server mode.

## DA R3 critique (running in real-time alongside)

**Task 1 — Are the 13 graph MCP tools real consumers or hollow surface?** **Mostly hollow.**

DA read `agentdb-tools.ts` (2,236 LoC) directly:

- `agentdb_graph_node_create / graph_edge_create / graph_node_get` (lines 679-786): each handler calls `getController<any>('graphAdapter')`. If null, returns `{ success: false, error: 'graphAdapter not available (controllers.graphAdapter must be enabled in config)' }`. **No fallback. No RVF dispatch. Just an error.**
- `graphAdapter` is NOT in `controllers.enabled` defaults of `config-template.ts:151-165`. **Init'd projects return errors out-of-the-box.** These are unreachable surface unless user manually enables.

- `agentdb_causal_query / causal_recall / causal-edge / causal-edge-delete`: `causalRecall` IS enabled by default. But `routeCausalOp` (memory-router.ts:2043-2059) has a load-bearing comment explaining controller is called with wrong-shape contract (string ADR keys vs numeric memory IDs). Router KNOWS this and routes through RVF namespace fallback (`'causal-edges'`) for writes. Reads merge controller results + namespace fallback. **Graph DB is not actually being exercised end-to-end for causal use case.**

- `memory-graph.ts`: consumed by `auto-memory-bridge.ts:220-247` only. Computes PageRank + Louvain in-process over an in-memory adjacency map. **Not a graph-DB consumer — it's an in-process analytics layer.**

**Implication**: team-lead's "5 skills + 13 MCP tools" framing is *aspirational consumer surface*, not *active consumer surface*. But this strengthens the capability-driven framing rather than weakening it — exactly the user's point.

**Task 2 — Kuzu's NetworkX-native claim**: NetworkX is Python-only. ruflo runs Node + Rust + WASM. NetworkX bridge would require Python subprocess + IPC. **Vapor benefit for ruflo's actual stack.**

**Task 3 — graph-node patching realistic LoC**:
- For decision-record use case alone: 500-1,000 LoC of Rust + tests (narrow scope)
- For broader capability vision (skill + causal + episode graphs with WHERE filtering, multi-hop, weighted-path): 2,000-3,500 LoC

User's "easily fix" judgment correct for narrow scope, less correct for broad capability.

**Task 4 — Vela-Kuzu server mode**: **NO.** Kuzu is embedded-only by design. Vela's fork preserves that. "PG-server-only" mooting Vela depends on whether the constraint means (a) "no pglite-as-embedded-substrate" or (b) "no embedded DBs at all." Different answers.

**Task 5 — Is `memory-graph.ts` a consumer or implementation?** **Implementation.** It does NOT consume a graph backend; it implements one in pure-TS in-memory. Evidence ruflo has graph-analytics needs, but in-process pure-TS suffices at current scale.

DA's three final questions for Queen:
1. Capability scope: which graph workloads MUST-have for next 6 months?
2. Does "PG-server-only" disqualify embedded graph libraries too?
3. Graph algorithms in-process TS or in-DB?

## Queen R3 synthesis

**Verdict**: **Option B (Apache AGE on PG-server) as the load-bearing graph substrate**, with **E-Hardened (CYCLE clause + indices)** on the same PG-server for the recursive-CTE callsites that already exist. Defer A (graph-node + Cypher patch) to watch state. Reject C (hollow Cypher) and D (Vela-Kuzu embedded-target moot).

Three R3 inputs change the picture from R2:

1. **pglite-embedded is gone as deployment target.** PG-server-only nullifies "AGE doesn't support pglite" critique. AGE is no longer "for some users" — it IS the substrate.
2. **Capability-driven framing is correct, but it doesn't push toward Cypher specifically.** Surveyed consumers need typed-edge persistence + graph algorithms, not Cypher syntax. AGE gives LPG storage cleanly; algorithms stay substrate-orthogonal (TS or Rust/NAPI).
3. **graph-node Cypher IS patchable in-fork BUT the patch is engine construction (2,600-5,100 LoC Rust executor + tests)** substituting for AGE's mature engine. `feedback-no-value-judgements-on-features` authorizes shipping upstream features that exist, not building new engines.

R1 → R2 → R3 evolution (Queen's words):

> "R1's 'additive AGE' was right for a dual-substrate world; R2's 'E-Hardened primary' was right when no consumers existed; R3's 'AGE primary on PG-only with E-Hardened on the side' is right under the actual deployment-target + capability-surface constraints. Each round was correct for the inputs it had; what changed is the inputs."

Scope of revised ADR-0173:
1. AGE install + `LOAD 'age'; SET search_path = ag_catalog, "$user", public;` in `PostgresBackend.ts` per-connection hook
2. CYCLE-clause migration of `CausalMemoryGraph.ts:469` and `:532`
3. Covering indices on `causal_edges` + `skill_links`
4. p50/p95 telemetry spans (no measured baseline today — must precede migration)
5. New MCP tool: `agentdb_cypher_query`
6. **AGE wired-but-unused for immediate post-decision state** — no forced consumer migration

Watch triggers for reconsidering A:
- Cypher operator ruflo needs that AGE doesn't ship
- Hyperedge callsite junction-reification can't handle cleanly
- Embedded-Rust execution path requirement orthogonal to syntax

Open follow-ups:
1. AGE install verification on agentdb PG-server target
2. Baseline p50/p95 capture before CYCLE migration
3. Per-consumer migration audit (ADR/ODR edges good fit; memory-graph.ts probable; agentdb_graph_* MCP tools direct; SparsificationService no, coord agents no)
4. `agentdb_cypher_query` MCP tool design (auth/parameterization)
5. graph-node watch trigger criteria documented

**Confidence:**
- AGE as primary substrate: HIGH
- E-Hardened for existing recursive CTEs: HIGH
- Defer graph-node Cypher patch to watch: MEDIUM-HIGH
- Reject Vela-Kuzu: HIGH
- Reject ruvector-postgres: HIGH

## Outcome → ADR-0173 revision

ADR-0173 replaced with R3 verdict. Original "restore @ruvector/graph-node" framing preserved in "rejected alternatives" with the R1/R2/R3 reasoning per-round.

Council closed.
