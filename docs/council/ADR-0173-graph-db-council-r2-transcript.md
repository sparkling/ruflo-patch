# ADR-0173 Graph DB Council — Round 2 transcript

**Date:** 2026-05-12
**Team:** `graph-db-council`
**Question (revised):** Same 5 candidates, but: (1) drop the pglite-AGE requirement — PG-server is acceptable for AGE; (2) PR #375 is FIXABLE in patch repo; (3) validate Vela claim independently.

## Constraint deltas from R1 → R2

1. User clarified: "We can move to postgres server for AGE support." Embedded-mode is no longer a blocker for AGE.
2. PR #375 fixable in fork — don't defer Option A on this basis.
3. Performance-engineer must validate Vela claim or withdraw it.
4. OSS / self-hosted only emphasized: Neo4j GPLv3, Memgraph BSL, ArangoDB BSL all hard-blocked.

## Revised positions

### postgres-architect (R2) → B (AGE) primary, land in Phase C-2 alongside pgvector in C-1
Promoted from "defer indefinitely" to "land alongside pgvector in same release cycle." Reasons:
- Self-hosted-only kills the AGE deployment-blocker risk outright.
- PR #375 is 3-function reorder (144 LoC); fork can absorb. But A's substrate-bifurcation cost is independent of PR #375.
- AGE 1.7.0-rc on PG17 (Feb 2026) + PG18 (Jan 2026) actively maintained.
- Acknowledged fact error: original "AGE bundled in pglite" claim was wrong.

### graph-theory-expert (R2) → Hybrid: Vela-Kuzu (graph) + pgvector + AGE (hybrid queries)
Pivoted to hybrid model:
- Vela-Kuzu's concurrent multi-writer is purpose-built for multi-agent workloads (ruflo's exact shape).
- LadybugDB and Vela-Kuzu both ship Cypher with NetworkX-native return types.
- Junction-node reification for hyperedges is "tolerable today, structural risk tomorrow."
- GQL ratification confirmed: "no engine ships full GQL conformance" — soft preference only.
- Honest concession in later round: this R2 framing turned out to underweight hybrid vector+graph workload.

### performance-engineer (R2) → C (ruvector-postgres extension) primary, E fallback
**Major pivot from R1 D-Vela pick.** New evidence:
- Confirmed `Vela-Engineering/kuzu` exists (MIT, last push 2026-03-09, 5,261 commits) — DA R1 "phantom" finding was wrong.
- Third-party benchmark (prrao87/graph-benchmark): Q8 unfiltered = 374-435×; Q9 filtered = 31× (matches ruflo's workload). "Mental divide by 10" rule for filtered.
- PR #375 is in `ruvnet/RuVector` (not graph-node specifically) — fixes `ruvector-graph` Rust crate edge-op ordering. **Confirms ruvector-graph HAS redb persistence** — earlier "in-memory only" delivery-doc framing was stale.
- Recommends C as primary because: in-postgres process = single-plan hybrid with pgvector preserved; same Rust storage layer as Option A but exposed via pgrx; we OWN the patches.
- Rejects B (AGE) citing Trendyol production writeup: variable-length-path queries bypass postgres indexes entirely.

### production-ops-engineer (R2) → A (graph-node + PR#375 patch) decisive flip
**Major pivot from R1 conditional-B.** Reasoning:
- Managed-PG concern moot under self-hosted-only.
- PR #375 patchable → "undefined multi-process semantics" risk dissolves.
- NAPI matrix already paid for `@ruvector/postgres-cli`; marginal cost zero.
- AGE's actual self-hosted ops cost worse than R1 estimate: source-build per PG version × per arch = 20 build combinations per AGE version; per-connection `LOAD 'age'` + `SET search_path` ritual; PgBouncer + transaction-mode incompatible.
- Engineering investment: A < E < B by ops surface fit.

### oss-graph-landscape (R2) → AGE preferred; HugeGraph if forced D
Confirmed BSL/license hard-blocks for Neo4j/Memgraph/Arango. Under self-hosted PG-server, LadybugDB's embedded niche evaporated. HugeGraph (Apache TLP, RocksDB single-node backend) beats JanusGraph operationally. AGE composes with pgvector in one planner — uniquely strong vs federation.

### ruvector-status-analyst (R2) — NEW LOAD-BEARING FINDING

Direct source-read of `/Users/henrik/source/ruvnet/RuVector/crates/ruvector-graph-node/src/lib.rs:255-329`:

**`@ruvector/graph-node`'s `query()` DOES NOT EXECUTE CYPHER.** Behavior:
- Parses Cypher string via `parse_cypher`
- For `Statement::Match`: iterates pattern's node-labels and calls `gdb.get_nodes_by_label(label)`
- **WHERE clauses are IGNORED**
- **RETURN projection is IGNORED**
- **Relationships in MATCH are IGNORED**
- **Property filters are NOT applied**
- For `Statement::Create`: literal source comment "`Handle CREATE - but we need mutable access, so skip in query`" → **no-op**
- For `Statement::Return`: "RETURN is handled implicitly" → **no-op**

The 3,415 LoC of `cypher/` in ruvector-graph is lexer + AST + parser + semantic analyzer + optimizer — **NO EXECUTOR**. A Cypher executor exists in `rvlite/src/cypher/executor.rs` (different crate, with bug #269 + PR #292 fix), but graph-node doesn't route through it.

README claim "Parse and execute Cypher queries" is **misleading — parses only**.

Recommendation: Conditional. A only if "label-lookup + hyperedge + vector" suffices for ruflo's use case. Else B-AGE.

## DA R2 critique

DA verified the hollow-Cypher finding by reading `crates/ruvector-postgres/src/graph/cypher/executor.rs` (632 LoC):

**`ruvector-postgres` (Option C) Cypher executor — PARTIALLY HOLLOW** (better than graph-node, worse than advertised):

| Clause | Status |
|---|---|
| MATCH (single + relationship) | REAL |
| CREATE node/rel | REAL |
| RETURN (DISTINCT/SKIP/LIMIT) | REAL |
| Property literal filters in pattern | REAL |
| **WHERE clause** | **BROKEN** (evaluates globally, not per-row; clears bindings on false) |
| **SET / DELETE / WITH** | **STUBS** (no-ops) |
| **Variable-length paths `[*1..5]`** | **MISSING** |
| **Multi-hop transitive joins** | **MISSING** |
| AND/OR/IS NULL/IN/arithmetic | Unsupported |

Realistic cost to write a real Cypher executor in Rust: 2,600-5,100 LoC + 1,000-2,000 LoC tests = multi-person-month work. **Out of patch-repo charter scope.**

DA also acknowledged R1 errors:
- Vela was wrongly called "phantom" (search term miss; repo exists at `Vela-Engineering/kuzu`)
- pglite-AGE doesn't exist (R1 finding stands)
- PG14+ CYCLE clause confirmed

Three final questions for Queen:
1. What's ruflo's actual hot-path query workload?
2. What's the patch-repo's appetite for writing a real Cypher executor in Rust?
3. Are hyperedges load-bearing for ruflo's design?

DA's reordered ranking:
- B (AGE) — only option with real compositional Cypher today
- E (CYCLE) — hidden winner if Cypher ergonomics not hard requirement
- D (Vela-Kuzu) — real Cypher executor, embedded
- A (graph-node + PR#375) — hyperedges + labels only (Cypher claims false)
- C (ruvector-postgres) — narrow Cypher subset (executor gaps)

## Queen R2 synthesis

**Verdict**: E-Hardened (CYCLE clause migration + indices) as load-bearing primary + Apache AGE additive on PG-server-mode behind capability flag. Reject A and C on hollow-Cypher grounds (silent wrong results = `feedback-no-fallbacks` violation). Defer D as watch item.

Hot-path workload audit (47 query sites across `CausalMemoryGraph.ts`, `ReflexionMemory.ts`, `SkillLibrary.ts`):
- 2 sites (`CausalMemoryGraph.ts:469` and `:532`) use WITH RECURSIVE / multi-hop / variable-length paths
- 45 sites are single-table SELECT / single-JOIN / single-hop subquery-in-IN
- **Multi-hop/variable-length share: ~4% of query sites**

Queen's finding: "ruflo is a 2-query graph problem, not a Cypher-engine problem."

Honest answers to DA's 3 questions:
1. ~4% need multi-hop; 45/47 don't
2. Patch repo appetite for Rust Cypher executor: **No** (out of charter; YAGNI)
3. Hyperedges load-bearing: **No** (no consuming callsite; junction-table already in use)

## Outcome → R3 setup

User pushback on Queen R2:
1. **DROP PGLITE FOREVER.** Stop hedging on embedded.
2. **"No current consumer" is NOT valid rejection reason.** Graphs haven't been available, so absence of multi-hop callsites is consequence, not signal.
3. **ADR plugin IS a graph consumer** (`adr-index` skill uses `agentdb_causal-edge` + `agentdb_hierarchical-store` for ADR dependency graph).
4. **graph-node Cypher CAN be patched** — user explicitly says "we can easily fix graph-node once we have decided on the implementation details."

These reframings triggered R3.
