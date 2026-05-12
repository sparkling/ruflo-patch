# ADR-0173 Graph DB Council — Round 1 transcript

**Date:** 2026-05-12
**Team:** `graph-db-council`
**Topology:** mesh (peer-to-peer), dialectical
**Question:** Which graph database should ruflo adopt? PostgreSQL server-mode is on the table (drop pglite-only constraint). OSS / self-hosted only. Implementation cost / legacy / backfill ignored — analyze on capability + strategic fit.

## Candidate options

* **A** — Restore `@ruvector/graph-node` (npm pkg, NAPI to Rust `ruvector-graph` crate, standalone graph DB with Cypher + hyperedges + redb persistence)
* **B** — Apache AGE (open-source PG extension; Cypher inside postgres; ASF top-level project)
* **C** — `ruvector-postgres@0.3.0` (Rust pgrx extension embedding Cypher AST + parser + executor inside postgres)
* **D** — OSS property graph DB (Neo4j CE / JanusGraph / Memgraph CE / KuzuDB / NebulaGraph / ArangoDB CE / Dgraph / TerminusDB / LadybugDB)
* **E** — Status quo (pgvector + WITH RECURSIVE)

## Participants (8)

| Role | Subagent_type | Stance |
|---|---|---|
| postgres-architect | system-architect | Deep PostgreSQL + extensions |
| graph-theory-expert | researcher | LPG/RDF/hypergraph + Cypher/SPARQL/GQL standards |
| oss-graph-landscape | researcher | OSS graph DB survey + licensing |
| ruvector-status-analyst | researcher | RuVector ecosystem health |
| performance-engineer | performance-engineer | Workload benchmark posture |
| production-ops-engineer | system-architect | Deployment + ops |
| devils-advocate | reviewer | Adversarial fact-check |
| queen-orchestrator | collective-intelligence-coordinator | Synthesis |

## Expert positions

### postgres-architect → B (AGE) + pgvector + E-Hardened
Recommends Apache AGE as graph engine, composed with pgvector, with WITH RECURSIVE for 2-3-hop traversal. Substrate consolidation: AGE keeps everything inside postgres (one planner, one transaction, one MVCC snapshot). Cited claim (later refuted by DA): "AGE is bundled in pglite." Postgres + AGE active under ASF: 4,496 stars, 489 forks, weekly commits, v1.7.0-rc for PG17 (Feb 2026). Phase A wiring should land pgvector first; AGE in a follow-on Phase C-2.

### graph-theory-expert → B (AGE) primary, C (ruvector-postgres) fallback
Property graph fits ruflo's workloads (causal chains, skill graphs, episode relationships). GQL ISO/IEC 39075:2024 ratification trajectory: AGE's OpenCypher is the GQL feedstock. Hyperedges reifiable to LPG with junction-node pattern. Single-substrate composition (postgres + pgvector + AGE) wins on data-model coherence vs federation layer in TypeScript.

### oss-graph-landscape → LadybugDB embedded / JanusGraph server
Survey of OSS property graph DBs (Apr 2025-May 2026 landscape):
- **License showstoppers**: Neo4j CE (GPLv3), Memgraph (BSL/MEL), ArangoDB (BSL since 2024), FalkorDB (SSPL-ish)
- **Apache 2.0/MIT survivors**: JanusGraph, NebulaGraph, Dgraph, TerminusDB, OrientDB, HugeGraph, ArcadeDB, LadybugDB, Kuzu (archived Oct 2025)
- **Top 3**: JanusGraph (Apache 2.0, no embedded), LadybugDB (MIT community fork of archived Kuzu), NebulaGraph (Apache 2.0)
- **No mainstream OSS property graph DB has first-class hyperedges in 2026**

### ruvector-status-analyst → A over C if forced into RuVector
- `@ruvector/graph-node@2.0.4` — 22,204 LoC Rust engine + 1,063 LoC NAPI; 3,780 crates.io downloads; 11 integration test files (4,567 LoC, 178 test fns); recent active development.
- Open structural bug: PR #375 (storage/memory write-ordering inversion) — unmerged in main.
- Zero independent third-party adoption: every consumer is RuVector-internal or a fork.
- `ruvector-postgres@0.3.0` — 14 SQL functions via pgrx; graph module 11,294 LoC (cypher parser + sparql + storage + traversal + operators); **own delivery doc admits: "In-memory only (no persistence). Simplified Cypher parser. No query optimization. Limited transaction support."** Multiple open issues including #48 (HNSW access methods disabled >5 months) and #271 (HNSW interferes with planner, production failure on Fly.io).
- Verdict: A > C if forced; broader risk of betting on RuVector is "material."

### performance-engineer → D (Vela-Kuzu fork), E (status quo + CYCLE) fallback
Cited "Vela's AI-agent fork of Kuzu, 374× faster than Neo4j" (later revealed: real fork exists but the 374× is unfiltered Q8; ruflo's Q9 filtered shape is ~31×).
- Ruflo's 5-hop WITH RECURSIVE `path NOT LIKE '%X%'` cycle detection: textbook anti-pattern, O(N²) text-scan worst case.
- Pure graph perf: Kuzu/Vela wins by ~10× on filtered 5-hop, ~30× on unfiltered.
- Hybrid graph+kNN p95 estimates favor E (single-plan postgres) over cross-process options.
- AGE rejected as "worst of both worlds" — cites Trendyol production writeup: variable-length-path queries in AGE bypass postgres indexes entirely.
- E (status quo) acceptable if cycle detection rewrites to `NOT (ce.to_memory_id = ANY(path_array))`.

### production-ops-engineer → B (AGE) IF pglite-AGE verified
Conditional recommendation. Three ops concerns for Option A: multi-substrate disk layout, NAPI install fragility, undefined multi-process semantics. AGE on self-hosted PG: same backup story as pgvector, same connection model, same backup/DR. Critical open question: "Does pglite-WASM support loading AGE?" — punted to verification.

## Devil's Advocate R1 critique

Load-bearing fact-checks (HIGH PRIORITY):

1. **"AGE bundled in pglite" → FALSE.** DA verified: no `@electric-sql/pglite-age` package exists. No AGE WASM build. Apache AGE repo has no `pglite/` directory, no `wasm/` directory, no upstream issues mentioning WASM/pglite. **AGE is server-only.** Postgres-architect's central claim was wrong.
2. **"Vela fork" → APPARENT PHANTOM** (DA Round 1 found nothing via GitHub search for "vela kuzu graph" / "vela ai-agent" / "vela graph database fork"). Performance-engineer's 374× claim "rests on a phantom artifact." (Later corrected in R3: repo does exist at `Vela-Engineering/kuzu` — DA's search terms missed it.)
3. **PG14+ has native `CYCLE … SET … USING …` clause.** Performance-engineer's `path NOT LIKE` anti-pattern critique is obsolete for any postgres ≥14. Option E with standard CYCLE clause is materially stronger than performance-engineer represented.
4. **GQL ISO/IEC 39075:2024 ratification real but** "zero major engine ships full GQL compliance as of 2026-05." Graph-theory-expert's "GQL is the SQL of graphs by 2028-2030" is aspirational.

Three questions to Queen:
1. Does pglite-AGE exist? Are we accepting AGE-server as a deployment dep?
2. Hot-path query latency baseline?
3. Minimum-viable solution with zero substrate change?

Four missed options DA surfaced:
- (i) DuckDB + PGQ plugin (embedded columnar with property-graph syntax)
- (ii) Dual-substrate explicit design (AGE server + LadybugDB embedded)
- (iii) Cypher → SQL transpiler in TS (~500 LoC)
- (iv) Status quo + traversal helpers + better indexing

## Queen R1 synthesis

**Verdict**: **E-Hardened + additive Option B for server-mode** — replace ADR-0173's "restore @ruvector/graph-node" with:
1. **Primary fix (all users)**: CYCLE-clause migration in `CausalMemoryGraph.ts` + covering indices on `causal_edges` + `skill_links` + p50/p95 telemetry. ~50 LoC, one file, one SQL migration.
2. **Additive (server-mode users)**: Apache AGE behind capability flag `AGENTDB_GRAPH_BACKEND=age` (only honored when `AGENTDB_POSTGRES_URL` set). Fails loud at config-load if AGE missing — no silent fallback.
3. **Defer Option A** (graph-node restore) pending RuVector PR #375.

Honest admission: **no measured baseline latencies exist.** Both "10×" and "374×" claims are unanchored. Queen explicitly named: capture p50/p95 BEFORE the CYCLE-clause migration.

## Outcome → R2 setup

User pushback: "no skips" wasn't an issue here, but two new constraints surfaced for R2:
- pglite-AGE doesn't exist (DA confirmed) — moots embedded-mode framing
- User clarified: PG-server mode is on the table for AGE
- PR #375 IS fixable in patch repo (Queen's deferral was naive)

These reframings triggered R2.
