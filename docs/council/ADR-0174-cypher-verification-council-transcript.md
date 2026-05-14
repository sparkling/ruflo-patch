---
title: ADR-0174 Cypher Verification Council — Transcript
date: 2026-05-12
team: cypher-verification-council
topology: mesh
agents: 7
question: Is ADR-0173 council R2's "partially hollow" finding for ruvector-postgres' Cypher executor correct?
---

# ADR-0174 Cypher Verification Council — Transcript

**Date:** 2026-05-12
**Team:** cypher-verification-council
**Topology:** mesh, 7 agents, single-wave dispatch
**Question:** Is ADR-0173 council R2's "partially hollow" finding for ruvector-postgres' Cypher executor correct?

## Council composition

| Role | Agent name | Mandate |
|---|---|---|
| Source analyst | `source-analyst-cypher` | Re-read `crates/ruvector-postgres/src/graph/cypher/executor.rs` at HEAD; produce feature-by-feature table |
| Graph-query expert | `graph-query-expert-cypher` | Define minimum-viable Cypher/SPARQL 1.1 surface; classify gaps; find other Cypher implementations |
| Dependency mapper | `dep-mapper-cypher` | Map cross-crate dependencies; stack-trace Cypher queries; confirm/refute `ruvector-graph-node` dep |
| Version analyst | `version-analyst-cypher` | Commits/PRs since 2026-05-12 R2 council read; release-channel reconciliation |
| Controller auditor | `controller-auditor-cypher` | SQL function consumption + MCP tool routing + ruflo callsites |
| Devil's Advocate | `da-cypher-verify` | Challenge experts; independent spot-check; README-vs-reality; test surface |
| Queen | `queen-cypher-verify` (this transcript) | Synthesize; verdict; ADR-0174 update guidance |

## Source-analyst's feature-by-feature table (`executor.rs` at HEAD `c15326d04`)

> Source-analyst-cypher re-derived this from source, not from prior council notes.

> Author self-classification (load-bearing context): `cypher/mod.rs:1` literal header *"Simplified Cypher query support"*; `cypher/parser.rs:1` *"Simplified Cypher parser. Note: This is a basic parser for demonstration. A production parser would use a proper parsing library like nom, pest, or lalrpop"*; `parser.rs:14` *"Production code should use a proper parser"*. The author labelled this code as demo at three separate top-of-file comments.

| Clause / feature | Status | File:line | Notes |
|---|---|---|---|
| MATCH (single label) | REAL | `executor.rs:111-131`, `:234-265` | Label filter via `find_by_label` + `has_label`; emits one binding row per matching node |
| MATCH (single-hop relationship) | REAL | `executor.rs:133-228`, `:268-289` | Iterates `graph.edges.find_by_type` / `all_edges`; honours `Direction::Outgoing/Incoming/Both` |
| MATCH (multi-hop path) | STUB / BROKEN | `executor.rs:140-224` | Each `rel_pattern` iteration overwrites `result_rows`; hops don't join. Multi-hop returns rows from the LAST relationship only |
| MATCH (variable-length `[*1..5]`) | MISSING | AST `ast.rs:247-282` has fields; executor never reads `min_hops`/`max_hops` | Parser also never populates them |
| MATCH (relationship property filter) | PARTIAL | `executor.rs:140-224` | `rel_pattern.properties` parsed but never read; only `rel_type` + `direction` checked |
| WHERE (per-row eval) | BROKEN | `executor.rs:487-504` | Evaluates expression ONCE; if false, calls `bindings.last_mut().clear()` wiping the entire scope. Not a row filter |
| WHERE (`=`, `<>`) | REAL (as expression eval, still subject to global-scope bug) | `executor.rs:555-556` | `Eq`/`Neq` via JsonValue equality |
| WHERE (`<`, `>`) | PARTIAL | `executor.rs:557-570` | Numeric only; non-numeric returns `false` silently |
| WHERE (`<=`, `>=`) | MISSING | `executor.rs:571` | `Lte`/`Gte` exist in AST (`ast.rs:339-341`) but no executor arm — falls through to `"Unsupported binary operator"` |
| WHERE (AND / OR) | MISSING | `executor.rs:571`, AST `:342-343` | Defined in `BinaryOperator`, NO executor arm |
| WHERE (IS NULL / IN / arithmetic +-*/% / Contains / Starts / Ends) | MISSING | AST `:344-352`, executor catch-all `:571` | All defined in AST, NONE implemented |
| WHERE (NOT, unary minus) | MISSING | `executor.rs:574` | `Expression::UnaryOp` → catch-all `"Unsupported expression type"` |
| WHERE (parameter `$name`) | REAL (when expression types supported) | `executor.rs:547-549` | Reads `context.get_param` |
| CREATE node | REAL | `executor.rs:291-350` | Calls `graph.add_node(labels, properties)` and binds variable |
| CREATE relationship | PARTIAL / BUGGY | `executor.rs:352-384`, `:307-330`, `:370-383` | Target resolution heuristic: "Look through bindings for any non-source node". `create_pattern` walks left-to-right so target isn't bound yet → falls through to `unwrap_or(source_id)`, **creates self-loops on every `CREATE (a)-[:R]->(b)`** |
| RETURN (variable / property projection) | REAL | `executor.rs:386-485` | Iterates `context.bindings`, projects per item |
| RETURN DISTINCT | REAL | `executor.rs:424-427` | Sort + dedup |
| RETURN SKIP | REAL | `executor.rs:430-432` | `.skip(n)` |
| RETURN LIMIT | REAL | `executor.rs:435-437` | `.truncate(n)`. **But parser never sets these fields from query text** (`parser.rs:320-353` has no LIMIT/SKIP/DISTINCT recognition); reachable only via builder API in tests |
| RETURN function calls (count, collect, …) | MISSING | `executor.rs:483` | Catch-all `"Unsupported return expression"` |
| RETURN `... AS alias` | REAL | parser `:328-331`, executor `:408-415` | `" AS "` splitter |
| SET | STUB / NO-OP | `executor.rs:506-513` | Body literally `Ok(())`; params underscored; comment "Simplified SET implementation" |
| DELETE | STUB / NO-OP | `executor.rs:515-522` | Same shape, "Simplified DELETE implementation" |
| WITH (chaining) | STUB / NO-OP | `executor.rs:524-531` | Same shape, "Simplified WITH implementation". `push_scope`/`pop_scope` (`:67-73`) are dead code, never called |
| MERGE | MISSING | AST `:33-42` | Not in `Clause` enum |
| UNION | MISSING | AST `:33-42` | Not in `Clause` enum |
| OPTIONAL MATCH | PARTIAL (AST only) | AST `:47-62` has `optional` bool; executor never reads it; parser never recognises "OPTIONAL" | Top-level parser only accepts queries starting with `MATCH` or `CREATE` (`parser.rs:16-22`) |
| ORDER BY | MISSING | `ast.rs:78-110` | `ReturnClause` has no `order_by` field; parser never recognises "ORDER BY" |
| Multi-statement queries / multi-pattern MATCH (e.g. `MATCH (a),(b)`) | PARTIAL | `parser.rs:10-23`, `:89-122` | Top-level dispatcher only handles single CREATE or single MATCH; `parse_pattern` only parses one head element |

### Source-analyst's verdict on R2 contested findings, item by item

- MATCH / CREATE node / RETURN / property literal filters real → **CONFIRMED**
- WHERE evaluated globally (clears bindings on false) → **CONFIRMED** at `executor.rs:487-504`
- SET / DELETE / WITH = no-op stubs → **CONFIRMED** at `executor.rs:506-531`
- Variable-length paths missing → **CONFIRMED**; AST fields exist, parser and executor ignore them
- Multi-hop transitive joins missing → **CONFIRMED, and worse**: relationships beyond the first are processed independently and overwrite bindings rather than join
- AND / OR / IS NULL / IN / arithmetic unsupported → **CONFIRMED**; AST variants with no executor arms, fall through to error catch-alls

### Additional findings source-analyst surfaced that R2 understated or missed

1. CREATE-relationship target resolution is **actively buggy** (silent self-loops on `(a)-[:R]->(b)`), not just "simplified"
2. Parser silently drops `LIMIT`/`SKIP`/`DISTINCT`/`ORDER BY`/`OPTIONAL`/`MERGE`/`UNION` keywords — the AST builders are dead code from the parser's perspective
3. `<=`/`>=` unsupported despite being in the AST
4. `Lt`/`Gt` silently return `false` for non-numeric comparisons rather than erroring
5. Single-pattern `(n)` short-circuit (`executor.rs:127`) REPLACES the binding stack rather than extending it — CREATE-then-MATCH in one query may lose CREATE bindings
6. `push_scope`/`pop_scope` and `Binding::Value` are dead code
7. Undirected `-[]-` patterns may double-count via the `Direction::Both` handling at `executor.rs:154` + `:200-222`

## Graph-query-expert's framing

### Minimum-viable Cypher surface (anchored to openCypher M-CIR, GQL ISO/IEC 39075:2024 §10–14, Neo4j 5.x parity)

> Honest "Full Cypher engine" claim requires:

- **Reading**: MATCH (multi-pattern, multi-hop, labels, props, anonymous), OPTIONAL MATCH with null-propagation, WHERE with full predicate tree (AND/OR/XOR/NOT, IN, IS NULL/NOT NULL, comparison, regex `=~`, string `STARTS/ENDS WITH/CONTAINS`, `EXISTS { … }`), WITH `[WHERE ORDER BY SKIP LIMIT]`, variable-length paths `[*]`/`[*n..m]` with cycle handling, pattern-variables on rels/paths.
- **Writing**: CREATE multi-element patterns, MERGE with `ON CREATE/MATCH SET`, SET (single, `+=`, `=`, labels), REMOVE, DELETE / DETACH DELETE.
- **Projection**: RETURN multi-row, DISTINCT, ORDER BY (ASC/DESC, multi-key, expr, NULL ordering), SKIP/LIMIT, aliases.
- **Expressions**: literals (int/float/string/bool/null/list/map), property `n.prop`, dynamic `n[key]`, parameters `$name`/`$pos`, arithmetic `+ - * / % ^` with string-concat overload, comparison + logical with three-valued logic, CASE (simple + searched), list/pattern comprehensions, map projection.
- **Aggregations**: `COUNT(*)/COUNT(DISTINCT)`, SUM/AVG/MIN/MAX/STDEV/STDEVP, COLLECT/COLLECT(DISTINCT), implicit GROUP BY from non-aggregating RETURN items.
- **Procedures & functions**: full built-in lib (`id`, `labels`, `type`, `keys`, `properties`, `size`, `length`, `nodes`, `relationships`, `head/tail/last`, `range`, `coalesce`, `toInteger/toFloat/toString/toBoolean`, `timestamp`, `datetime`, `duration`), string funcs, `CALL { … }` subqueries, `CALL proc(args) YIELD …`, UDF/UDP hook.
- **Transactions / integrity**: ACID per statement, `CALL { … } IN TRANSACTIONS OF n ROWS`, unique/existence constraints, indexes, schema introspection.

### Minimum-viable SPARQL 1.1 surface (W3C SPARQL 1.1 Query + Update + Federation)

> Honest "SPARQL 1.1" claim requires:

- **Query forms**: SELECT (+ DISTINCT/REDUCED), ASK, CONSTRUCT, DESCRIBE.
- **Graph patterns**: BGP, OPTIONAL (correct left-join + null-extension), UNION (bag), FILTER, FILTER EXISTS / NOT EXISTS, MINUS, GRAPH `?g { … }`, SERVICE (with SILENT), BIND, VALUES, full property paths (`^`, `/`, `|`, `*`, `+`, `?`, `!`, parens).
- **Solution-sequence modifiers**: ORDER BY (multi-key, expr), LIMIT, OFFSET, GROUP BY/HAVING, COUNT/SUM/MIN/MAX/AVG/SAMPLE/GROUP_CONCAT.
- **Expressions**: comparison (= != < > <= >=), `&&/||/!`, numeric + string ops + regex, RDF term ctors + inspection, date/time, hash, BOUND/COALESCE/IF/EXISTS.
- **Subqueries**: nested SELECT in WHERE.
- **Update**: INSERT DATA, DELETE DATA, INSERT/DELETE WHERE, graph management (CREATE/DROP/CLEAR/COPY/MOVE/ADD/LOAD).

### Cypher implementations in upstream RuVector

> Three completely independent implementations, **no sharing**.

| Crate | Path | Lines | Classification | Evidence |
|---|---|---|---|---|
| `ruvector-postgres` | `crates/ruvector-postgres/src/graph/cypher/{mod,ast,parser,executor}.rs` | ~1455 | **DEMO-ONLY** | Parser self-described "basic parser for demonstration"; uses `query.to_uppercase().find("RETURN")` (breaks on `RETURN` inside string literals or property keys); SET/DELETE/WITH stubs; WHERE wrong semantics; no agg; no `MERGE/WITH/OPTIONAL/ORDER BY` |
| `rvlite` | `crates/rvlite/src/cypher/{mod,ast,lexer,parser,executor,graph_store}.rs` | ~3635 | **USABLE-WITH-LIMITS** | Real hand-rolled lexer + recursive-descent parser (WASM-friendly). AST covers Match/Create/Merge/Delete/Set/Remove/Return/With + Hyperedge + Path. But `execute_return` (`:440-441`) builds ONE row per call (multi-row defect PR #292/#293 target); SET only writes props on Nodes; DELETE only `clause.detach` path; MERGE routed to `Err(UnsupportedOperation)` (`:130-133`); expression evaluator returns `UnsupportedOperation` past primitives + Variable/Property; condition evaluator supports only Eq/Neq/Gt/Lt — no AND/OR/IN/CONTAINS |
| `ruvector-graph` | `crates/ruvector-graph/src/cypher/{mod,ast,lexer,parser,semantic,optimizer}.rs` + `src/executor/` | ~3815 + 2557 | **SCAFFOLDING-ONLY** (no Cypher-AST executor) | README claims "complete Cypher". AST + nom-based parser + semantic analyzer + cost-based optimizer all real. **But `src/executor/mod.rs:129-133`: `execute_sequential` returns `Ok(Vec::new())` with comment "In a real implementation, we would need to reconstruct operators. For now, return empty results as placeholder."** `cypher::mod.rs` does NOT re-export any executor; `tests/cypher_execution_tests.rs` is 405 LoC of `// TODO: Implement query execution` |

> rvlite and ruvector-graph parser.rs files are byte-identical (1295 LoC, 42430 bytes) — rvlite is a WASM-port of ruvector-graph's parser front-end, with rvlite adding the executor that ruvector-graph never built.

### Cross-fork search — no Cypher implementations exist outside RuVector

- `find /Users/henrik/source/ruvnet/{ruv-FANN,agentic-flow,ruflo} -type d -name cypher` → zero hits
- Same for `sparql` → zero hits
- `grep -rl "fn execute_cypher\|fn parse_cypher\|trait.*Cypher"` across those repos → zero hits

> ruvector-postgres' executor is one of exactly three Cypher engines in upstream RuVector and the only one targeting a Postgres-backed `GraphStore`. ruv-FANN, agentic-flow, and ruflo do not implement Cypher at any layer.

### Gap-impact classification for ADR-0174's use cases

| Use case | Required Cypher feature(s) | Impact under current ruvector-postgres |
|---|---|---|
| (a) Graph axis trio basic queries (MATCH a node, props, neighbours by edge type) | Single-hop MATCH + property literal filter + RETURN | **DEGRADING for edges, USABLE without**. Works only in simplest form |
| (b) HM lineage (council → expert → decision → ADR refs, multi-hop) | Multi-hop joins + var-length paths | **BLOCKING** |
| (c) Cross-ADR refs / council provenance (supersedes / dialectic produced) | WITH chaining (non-trivial query) + MERGE (idempotent ADR-node creation) | **BLOCKING** |

## Dependency map (dep-mapper-cypher)

### Cargo.toml — `ruvector-postgres` Cypher dependencies on other RuVector crates

> **NONE.** `crates/ruvector-postgres/Cargo.toml:77-148` declares path-deps on `ruvector-mincut-gated-transformer`, `ruvector-solver`, `ruvector-math`, `ruvector-attention`, `ruvector-sona`, `ruvector-domain-expansion` — all unrelated to Cypher. Line 148 has a commented-out `ruvector-core` (never enabled). The `graph = []` feature flag (`:56`) is pure code-gating, zero `dep:` entries.

`ruvector-postgres` Cypher dependencies are: `serde_json`, `dashmap`, `pgrx`. **No shared parser/AST/executor crate.**

### Stack trace through `ruvector-postgres`

```
SQL: SELECT ruvector_cypher('my_graph', 'MATCH (n:Person) RETURN n', NULL)
  → crates/ruvector-postgres/src/graph/operators.rs:36-46
      #[pg_extern] fn ruvector_cypher(graph_name, query, params)
        - line 38: get_graph(graph_name) → Arc<GraphStore> from GRAPH_REGISTRY
        - line 43: super::cypher::query(...) (imported as cypher_query line 8)
  → crates/ruvector-postgres/src/graph/cypher/mod.rs:23-30
      pub fn query(graph, query, params)
        - line 28: parse_cypher(query)
        - line 29: execute_cypher(graph, &parsed, params.as_ref())
  → crates/ruvector-postgres/src/graph/cypher/parser.rs:10-23
      String-match dispatch on uppercase prefix (CREATE → parse_create,
      MATCH → parse_match, else Err "Unsupported")
      Comment line 2-3: "Simplified … not a proper parsing library"
  → crates/ruvector-postgres/src/graph/cypher/executor.rs:11-32
      pub fn execute_cypher iterates Clause enum (Match/Create/Return/Where/
      Set/Delete/With at executor.rs:20-26)
  → crates/ruvector-postgres/src/graph/storage.rs (Node, Edge, GraphStore via DashMap)
      Plus PostgreSQL durability via SPI in mod.rs:26-40 (ensure_graph_tables —
      _ruvector_graphs, _ruvector_nodes, etc.)
```

### `ruvector-graph-node` crate

> Confirmed present in the `agentdb` integration path. **NOT a dependency of `ruvector-postgres`'s Cypher executor.** ADR-0173's R3 verdict (AGE on PG-server + E-Hardened CYCLE) is therefore *not* a "restore graph-node into ruvector-postgres" decision — it is a separate substrate choice. The two Cypher executors (`ruvector-postgres`'s in-crate one and `@ruvector/graph-node`'s) are independent codepaths.

### Diagram

```
                  RuVector workspace Cypher landscape
                  ═══════════════════════════════════

   ┌──────────────────────────┐     ┌─────────────────────────────┐    ┌──────────────────────────┐
   │  ruvector-postgres       │     │  ruvector-graph             │    │  rvlite                  │
   │  (PG extension, pgrx)    │     │  (distributed Neo4j-compat) │    │  (WASM lite engine)      │
   ├──────────────────────────┤     ├─────────────────────────────┤    ├──────────────────────────┤
   │ src/graph/cypher/        │     │ src/cypher/                 │    │ src/cypher/              │
   │   ast.rs                 │     │   ast.rs                    │    │   ast.rs                 │
   │   parser.rs (string-     │     │   lexer.rs                  │    │   lexer.rs               │
   │     prefix match,        │     │   parser.rs (nom/pest/      │    │   parser.rs              │
   │     "simplified")        │     │     lalrpop)                │    │   executor.rs            │
   │   executor.rs            │     │   semantic.rs               │    │   graph_store.rs         │
   │   mod.rs                 │     │   optimizer.rs              │    │   mod.rs                 │
   │                          │     │   mod.rs                    │    │     (CypherEngine        │
   │ storage.rs (DashMap +    │     │                             │    │      #[wasm_bindgen])    │
   │   PG SPI tables)         │     │ executor/ exists separately │    │ uses: crate::storage::   │
   │                          │     │   but emits empty Vec       │    │   state::GraphState      │
   │ deps for Cypher:         │     │   ("placeholder")           │    │                          │
   │   pgrx + serde_json      │     │                             │    │ deps for Cypher:         │
   │   (ZERO RuVector crates) │     │ parser deps: nom, pest      │    │   wasm-bindgen, serde,   │
   │                          │     │   (opt.), lalrpop (opt.)    │    │   std collections        │
   └──────────────────────────┘     └─────────────────────────────┘    └──────────────────────────┘

                  No edges between these boxes.
                  No shared crate sits beneath them.
                  Each owns its own parser, AST, executor.
```

## Version evolution (version-analyst-cypher)

### Recent commits to `crates/ruvector-postgres/src/graph/cypher/executor.rs`

| SHA | Date | Author | Message |
|---|---|---|---|
| `229877fe` | 2026-03-03 | rUv | fix: ruvector-postgres v0.3.1 — audit bug fixes, 46 SQL functions, Docker publish (#227) |
| `d316a52d` | 2025-12-26 | rUv | fix(ci): formatting and workflow perms |
| `34b433a8` | 2025-12-09 | rUv | feat(rvlite): Add multi-query language support (#66) |
| `84f8b685` | 2025-12-03 | rUv | feat(postgres): 53 SQL function definitions (#46) |

> **No new commits to this file since 2026-03-03** — 70 days before R2 council read on 2026-05-12.

### Recent commits to `crates/ruvector-postgres/src/graph/` (broader)

Activity concentrated in `sparql/` and `hnsw/`, not `cypher/`. Most recent: `cf542ca2` (2026-03-13, cargo fmt), `229877fe` (2026-03-03), `2466011d` (2026-02-17, SPARQL only), `e860b24b` (2026-02-15, HNSW+SPARQL).

### Open PRs touching `ruvector-postgres`' Cypher executor

| PR# | Branch | State | Touches postgres cypher executor? |
|---|---|---|---|
| #292 — fix(cypher): MATCH returns all matching rows (Issue #269) | `main` (HEAD-from-fork) | open, dirty, NOT mergeable | **No** — file listed as "added" with `additions:0, deletions:0, patch:null`; identical SHA (`b2ab16793eee983a20fc53d04622a689cdf50b8a`, 19793 bytes). PR mislabels file due to 8,963-file rebase churn |
| #293 — fix: real benchmarks, Cypher multi-row fix, honest README | `fix/real-benchmarks` | open, dirty | Same — `additions:0, deletions:0`, identical SHA |

> Both PRs are ~8,965 files (+3.6M / −31k lines). Their bodies fix `crates/rvlite/src/cypher/executor.rs` (size grew 20569 → 24030 bytes), **NOT** `crates/ruvector-postgres/src/graph/cypher/executor.rs`.

> Issue **#269** ("CypherEngine: MATCH RETURN produces single row") was filed against **rvlite WASM** (`rvlite npm v0.2.4`), not the postgres extension. The shipped fix is `rvlite@0.3.1` (crate) + `rvlite@0.2.5` (npm), 2026-03-25T15:07Z, **applied to `crates/rvlite/src/cypher/executor.rs`** — not ruvector-postgres.

### Merged PRs (last 30 days) touching `ruvector-postgres` Cypher

**None.** Most recent merged PR touching this path is `#227` (2026-03-03 v0.3.1 audit), 70 days old.

### Release-channel reconciliation

- `ruvector-postgres` crate: **v0.3.1** (commit `229877fe`, 2026-03-03).
- `@ruvector/postgres-cli` npm: **0.2.8** (2026-03-25T15:16Z).
- `rvlite` npm: **0.2.6** (2026-03-25T15:18Z) — **the actually-released Cypher fix for Issue #269, applies to rvlite WASM only**.
- Release notes mentioning Cypher: none in the 10 most recent. Release v2.2.0 (2026-04-20) lists math/attention crates, not postgres or Cypher.

> **The R2 source-read is current.** The two open Cypher-fix PRs do NOT remediate alleged gaps in ruvector-postgres' Cypher executor — they fix the **rvlite WASM** Cypher executor for Issue #269. No PR proposes a fix for the postgres tree.

## Consumer audit (controller-auditor-cypher)

### Cypher SQL functions exposed by `ruvector-postgres`

| Function | File:line | Signature |
|---|---|---|
| `ruvector_cypher` | `crates/ruvector-postgres/src/graph/operators.rs:37` | `(graph_name, query, params jsonb) → jsonb` — loads named graph, calls `super::cypher::query`, returns `JsonB` |
| `ruvector_create_graph`, `ruvector_shortest_path`, `ruvector_shortest_path_weighted`, `ruvector_graph_stats`, `ruvector_add_node`/`_add_edge`/`_get_node`/`_get_edge`/`_find_nodes_by_label`/`_get_neighbors`/`_delete_graph`/`_list_graphs` | `:24`, `:55`, `:88`, `:120`, `:143-296` | Non-Cypher graph API |
| `ruvector_sparql`, `_sparql_json`, RDF triple ops, `_sparql_update`, `_create_rdf_store` | `:311-632` | Separate RDF/SPARQL surface |

> The pgrx-generated SQL binding lives at `crates/ruvector-postgres/sql/ruvector--{0.1.0,0.3.0,2.0.0}.sql` (e.g. `0.3.0.sql:641-643`):
> ```sql
> CREATE OR REPLACE FUNCTION ruvector_cypher(graph_name text, query text, params jsonb)
>   RETURNS jsonb AS 'MODULE_PATHNAME', 'ruvector_cypher_wrapper'
> ```
> `ruvector_graph_query` does NOT exist; only `ruvector_cypher`.

### `@ruvector/postgres-cli` (npm)

| API | File:line | Routes to |
|---|---|---|
| `RuVectorClient.cypherQuery(graphName, query, params)` | `npm/packages/postgres-cli/src/client.ts:947-950` | `SELECT ruvector_cypher($1, $2, $3)` |
| `ruvector-pg graph query <graphName> <cypher>` CLI subcommand | `src/cli.ts:533-537` → `GraphCommands.query` | Delegates to `client.cypherQuery('default', cypher)` |
| Capability probe | `src/client.ts:393` | `SELECT 1 FROM pg_proc WHERE proname='ruvector_cypher'` |
| Traversal helper | `src/commands/graph.js:87-88` | Builds inline `MATCH (n)-[*1..${depth}]-(m) WHERE id(n) = ${start} RETURN m` — uses var-length path syntax which the executor does NOT support |

### Ruflo consumption of postgres-resident Cypher

> **No live callsites.** Exhaustive search of `/Users/henrik/source/ruvnet/ruflo/` (all `*.ts`/`*.js`/`*.mjs`/`*.json`, excluding `node_modules` and `*.tgz`):

- `forks/ruflo/v3/@claude-flow/plugins/src/collections/official/index.ts:606` — **docstring only**: `* Provides integration with @ruvector/postgres-cli including:`. No import, no require, no runtime reference.
- `forks/ruflo/v2/bin/init/templates/claude-md.js:814` — emits literal string `knowledge_graph_query` into a generated CLAUDE.md template. **Not a callsite, narrative content only.**
- `forks/ruflo/v3/` Cypher search: **zero hits**.
- Ruflo's own `ruvector-bridge.ts` plugin (`forks/ruflo/v3/@claude-flow/plugins/src/integrations/ruvector/ruvector-bridge.ts`) connects via `pg.Pool` (line 199) but executes pgvector-operator SQL (`<=>`, `<->`, `<#>` — lines 108-119, 504-508). The 8 MCP tools it exposes (`ruvector_{search,insert,update,delete,create_index,index_stats,batch_search,health}` at lines 1240/1300/1348/1396/1450/1515/1559/1582) **never call `ruvector_cypher` or any `ruvector_*` SQL function exposed by the postgres crate.** The bridge talks to plain pgvector tables; the postgres crate is not in its data path.

### agentdb

> Same searches: **zero references to `@ruvector/postgres-cli`, `postgres-cli`, or `ruvector_cypher`**.

- agentdb DOES build and execute Cypher in `controllers/ReflexionMemory.ts:316-317, 451-468` and `controllers/CausalMemoryGraph.ts`, but those route via the `GraphBackend` interface (`src/backends/GraphBackend.ts`).
- The only `GraphBackend` implementation is `GraphDatabaseAdapter` at `src/backends/graph/GraphDatabaseAdapter.ts:121`, which dynamically imports **`@ruvector/graph-node`** (separate standalone package). Confirmed at `src/db-unified.ts:5`, `backends/factory.ts:89,200`, `backends/detector.ts:10,145`, `backends/rvf/NativeAccelerator.ts:449`.
- **No `pg.Pool` / `postgres-cli` / `ruvector_cypher` code path in agentdb at all.** Cypher backend is `@ruvector/graph-node`, not in-PostgreSQL `ruvector_cypher`.

### MCP tool routing

- **`cypher_*` MCP tool?** No.
- **`graph_query` MCP tool routing to ruvector-postgres?** No. The 8 tools in `ruvector-bridge.ts` are vector ops; the USERGUIDE RuVector PostgreSQL Bridge section (lines 1934-2057) advertises 39 attention mechanisms + 15 GNN layers but only exposes those same 8 vector tools and zero Cypher tools.
- **Where Cypher does flow through MCP:** `mcp__claude-flow__agentdb_causal_query/causal_recall/reflexion_retrieve/graph_node_*/graph_edge_create` → `ReflexionMemory`/`CausalMemoryGraph`/`SkillLibrary` → `GraphBackend.execute(cypher)` → `GraphDatabaseAdapter` → **`@ruvector/graph-node`** — **NOT** `ruvector-postgres`.

### Controller-auditor verdict

**Cypher-via-postgres has zero live consumers in fork or upstream.** The `ruvector_cypher` SQL function is reachable in principle (postgres-cli's `cypherQuery()` + `ruvector-pg graph query` CLI), but:

1. Ruflo does not import or invoke `@ruvector/postgres-cli` anywhere.
2. Ruflo's `ruvector-bridge.ts` plugin never calls any `ruvector_*` SQL function — it issues pgvector-operator queries against plain vector tables.
3. agentdb's Cypher path bypasses ruvector-postgres entirely, routing through `@ruvector/graph-node`.
4. No MCP tool routes Cypher into `SELECT ruvector_cypher(...)`.

## DA challenges + expert responses

### Challenge 1 — to source-analyst-cypher: is WHERE really "broken" or just incomplete?

DA spot-check confirmed the breakage. `executor.rs:487-504`:

```rust
fn execute_where(
    _graph: &GraphStore,
    where_clause: &WhereClause,
    context: &mut ExecutionContext,
) -> Result<(), String> {
    let result = evaluate_expression(&where_clause.condition, context)?;
    if !result.as_bool().unwrap_or(false) {
        if let Some(last) = context.bindings.last_mut() {
            last.clear();
        }
    }
    Ok(())
}
```

> `evaluate_expression` looks up variables via `context.get(var)` (line 54-61) — returns the FIRST matching binding across the stack. For 10 candidate `n` rows, predicate evaluates against ONE binding only. Result is binary: either all rows pass or last scope is cleared. **This is not "filter row-by-row broken" — it's "filter doesn't exist at all".** DA upgrades source-analyst's BROKEN to: WHERE evaluator is a query-aborter, not a row-filter.

### Challenge 2 — to graph-query-expert-cypher: is the "21 commented db.execute() assertions" finding cited in ADR-0173:64 correct?

DA: that finding is from `crates/ruvector-graph/tests/cypher_execution_tests.rs` (the `ruvector-graph` crate / `@ruvector/graph-node` package), NOT `ruvector-postgres`. DA grep returned 1 hit in that file for `// db.execute`, so the literal "21" figure may be inflated even for the right crate. **Important for queen synthesis: don't conflate `ruvector-graph` and `ruvector-postgres` test surfaces.**

### Challenge 3 — to controller-auditor-cypher: are you sure ruflo doesn't actively call this?

DA confirmed independently:

- Inside RuVector: `crates/ruvector-postgres/src/graph/operators.rs:8,43` (the pg_extern wrapper), SQL CREATE FUNCTION definitions, `graph_examples.sql:92` (example WHERE), `crates/rvf/rvf-runtime/src/agi_container.rs:472` (a registry string literal, not a caller), docs only.
- Inside `forks/`: no compiled callers in agentdb / agentic-flow / ruflo / ruv-FANN. Hits are docker setup / docs / strings.
- `ruvector-graph-wasm/src/lib.rs:481` has its own `execute_cypher` method — SEPARATE codepath, not ruvector-postgres'.

> DA's caller search corroborates controller-auditor-cypher: **zero compiled fork callers**.

### Challenge 4 — to version-analyst-cypher: is the file really unchanged?

DA confirmed: total commits touching `executor.rs` = 4 (`84f8b685`, `34b433a8`, `d316a52d`, `229877fe`). Latest is `229877fe` (2026-03-03). DA additionally noted that `229877fe` was a 60+-file *audit* commit that didn't touch the cypher executor — **the audit passed over the stubs**. Maintainers consider this complete code.

## DA's independent spot-check

DA read `executor.rs` line-by-line (632 LoC, HEAD `c15326d04`).

### Spot-check A — WHERE evaluator (executor.rs:487-504)

Already reproduced above. **CONFIRMED BROKEN, council R2 understates severity.**

### Spot-check B — SET / DELETE / WITH stubs (executor.rs:506-531)

```rust
fn execute_set(_graph: &GraphStore, _set_clause: &SetClause, _context: &mut ExecutionContext) -> Result<(), String> {
    // Simplified SET implementation
    Ok(())
}
fn execute_delete(_graph: &GraphStore, _delete_clause: &DeleteClause, _context: &mut ExecutionContext) -> Result<(), String> {
    // Simplified DELETE implementation
    Ok(())
}
fn execute_with(_graph: &GraphStore, _with_clause: &WithClause, _context: &mut ExecutionContext) -> Result<(), String> {
    // Simplified WITH implementation
    Ok(())
}
```

> All three: literal `Ok(())`, silent no-op. SET = silent data corruption. DELETE = silent no-op. WITH = chaining absent. **CONFIRMED.**

### Spot-check C — Additional gaps R2 didn't enumerate

- `evaluate_expression` returns Err on AND/OR/NOT (line 571). README example `WHERE a.age > 18 AND b.country = 'UK'` cannot work.
- `evaluate_return_item` (line 484) returns Err for any non-Variable/Property/Literal — no aggregation, no functions, no `count()`.
- `create_relationship` (line 372-381) target resolution is non-deterministic for `CREATE (a)-[r]->(b), (a)-[r2]->(c)`.
- No variable-length paths.
- No MERGE clause anywhere (AST/parser/executor).

## README-vs-reality overshoot

> DA verbatim quotes vs verified reality.

| README claim | Source | Reality | Overshoot? |
|---|---|---|---|
| "Full Cypher engine — `MATCH (a)-[:KNOWS]->(b)` like Neo4j" | `RuVector/README.md:52` | MATCH works for fixed-pattern; WHERE broken; SET/DELETE/WITH stubs; no agg / AND / OR | **Severe** |
| "Cypher, W3C SPARQL 1.1, hyperedges — all built in" | `RuVector/README.md:250` | "Built in" suggests functional; closer to "parser + AST + half-executor + zero callers" | **Severe** |
| "Full Cypher engine + SPARQL 1.1 in SQL" | `crates/ruvector-postgres/README.md:19` | Same | **Severe** |
| "Query with Cypher — Graph queries like Neo4j" | `RuVector/README.md:82` | Below Neo4j parity by ~10 operators | **Severe** |
| "230+ SQL functions" / "143 SQL functions" | `RuVector/README.md:174` / `ruvector-postgres/README.md:13` | Inconsistent with itself; `ruvector_cypher` is one function whose impl is partially hollow | **Numbers internally inconsistent** |
| Example: `ruvector_cypher_query('MATCH (n:Person)-[:KNOWS]->(m) RETURN n, m')` | `RuVector/README.md:567` | Actual pg_extern is `ruvector_cypher(graph_name, query, params)` per `operators.rs:37` — 3 args, different name | **README wrong about own function signature** |

## Test surface (DA)

> Council R2's "21 commented `db.execute()` assertions" finding referred to `ruvector-graph`, NOT `ruvector-postgres`. For `ruvector-postgres` cypher executor specifically:

- `crates/ruvector-postgres/src/graph/cypher/executor.rs:582-630` — 2 inline tests:
  - `test_execute_create`: asserts `result.is_ok()` then `assert!(json.is_array())` — **vacuous** (would pass if executor returned empty for every query).
  - `test_execute_match`: asserts `result.is_ok()` only — **vacuous**.
- `crates/ruvector-postgres/src/graph/cypher/mod.rs:37-63` — 2 more tests, same shape: `assert!(result.is_ok())` only.
- `crates/ruvector-postgres/tests/`: only `hnsw_index_tests.sql` and `ivfflat_am_test.sql` + a README. **Zero Cypher integration tests.**

> Total: 4 unit tests, all assert "doesn't crash". The SET that silently no-ops or the WHERE that misfilters passes all 4 tests.

## Verdict

**CONFIRMED** — ADR-0173 R2's "partially hollow" finding for `crates/ruvector-postgres/src/graph/cypher/executor.rs` is correct at the line-level and, if anything, **conservative**.

- Source-analyst-cypher independently confirmed all 6 R2 claims at file:line and surfaced 7 additional load-bearing gaps R2 didn't enumerate (`executor.rs:127`, `:154`, `:307-330`, `:370-383`, `:487-504`, `:506-531`, `:557-572`).
- Graph-query-expert-cypher's MVP-Cypher framework places all three ADR-0174 graph-axis use cases (HM lineage, cross-ADR refs, council provenance) firmly in the BLOCKING gap zone of ruvector-postgres' current executor.
- Dep-mapper-cypher established ruvector-postgres' Cypher impl is fully self-contained — three independent Cypher implementations exist in the RuVector workspace (`ruvector-postgres`, `rvlite`, `ruvector-graph`), with **no shared crate** under them. The postgres one is demonstrably the weakest (string-prefix dispatch, author-labelled demo).
- Version-analyst-cypher confirmed the R2 source-read remains current (`229877fe`, 2026-03-03, 70 days unchanged) and that PRs #292/#293 fix `rvlite`, not `ruvector-postgres`. The 2026-03-03 audit commit `229877fe` touched 60+ files but explicitly passed over these stubs — **maintainers consider this complete**.
- Controller-auditor-cypher established that ruvector-postgres' Cypher executor has **zero compiled fork callers** — agentdb's Cypher path routes through `@ruvector/graph-node`, ruflo's `ruvector-bridge.ts` plugin issues pgvector-operator SQL only.
- DA's spot-check upgraded R2's "WHERE broken" finding: it's not "filter row-by-row broken" but "filter doesn't exist at all" — query-aborter masquerading as predicate filter at `executor.rs:487-504`.

> **Confidence:** **HIGH.** Six independent agents, six concordant findings, ten direct source citations under `/Users/henrik/source/ruvnet/RuVector/`, multiple author-supplied "Simplified … not a production parser" disclaimers in the source itself.

## Update guidance for ADR-0174

The ADR-0174 draft already references R2's finding correctly at `docs/adr/ADR-0174-introduce-graph-axis-ruvector-graph-engine.md:267`. The line reads:

> `crates/ruvector-postgres/src/graph/cypher/executor.rs` (632 LoC) | Per council R2 DA source-read: MATCH/CREATE/RETURN/property literals real; WHERE evaluates globally (not per-row); SET/DELETE/WITH stubs; variable-length paths missing; multi-hop transitive joins missing; AND/OR/IS NULL/IN/arithmetic unsupported. Cypher executor in ruvector-postgres is **partially hollow** — better than graph-node, worse than advertised.

Two **non-substrate** edits are warranted, plus one optional sharpening:

### Edit A — strengthen the postgres-cypher characterization at line 267

The R2 framing "better than graph-node" is wrong in light of dep-mapper-cypher + DA findings. The three Cypher implementations are independent codepaths, not a quality ladder. Replace `"better than graph-node, worse than advertised"` with:

> "Functional surface is single-MATCH-single-hop + CREATE + RETURN with working DISTINCT/SKIP/LIMIT projection (LIMIT/SKIP only reachable via builder API; parser silently drops the keywords from query text). Author-labelled demo at three top-of-file comments. 4 vacuous unit tests, zero fork callers, untouched in 2026-03-03 audit. CREATE-relationship target resolution is actively buggy — silent self-loops on canonical `CREATE (a)-[:R]->(b)`. WHERE evaluator is a query-aborter, not a row-filter (`executor.rs:487-504` calls `bindings.last_mut().clear()` once on a globally-evaluated predicate)."

### Edit B — correct the "executor placeholder" framing at line 30 and line 261

The framing "The Cypher executor placeholder in `crates/ruvector-graph/src/executor/mod.rs:129` blocks one path … it does not block the imperative API" is correct for `ruvector-graph` but **conflates** the three Cypher implementations. ADR-0174 should add an explicit clarification:

> "Three independent Cypher implementations exist in the RuVector workspace: `ruvector-graph` (parser/AST/semantic/optimizer complete, executor returns `Ok(Vec::new())` placeholder at `executor/mod.rs:129`); `rvlite` (real hand-rolled lexer + recursive-descent parser + functional single-row executor for limited expression types — the multi-row defect PR #292/#293 targets); `ruvector-postgres` (separate demo-quality string-prefix-dispatch executor at `src/graph/cypher/executor.rs`, author-labelled simplified, untouched in 2026-03-03 audit). The three do not share an AST/parser/executor crate. The imperative graph-node API (`createNode`/`createEdge`/`createHyperedge`/`getNeighbors`/`searchSimilar`) is independent of all three Cypher paths and serves most graph workloads."

### Edit C (optional sharpening) — note zero-consumer status at line 350

The ADR's R3 step "Cypher consumer enumeration — list every fork callsite that wants Cypher syntax specifically vs imperative API" is correctly identified as deferred. The cypher-verification council has already answered this for the postgres-cypher path:

> "Cypher-via-postgres has zero live consumers in fork or upstream. agentdb's Cypher path routes through `@ruvector/graph-node` (`backends/graph/GraphDatabaseAdapter.ts:121`). Ruflo's `ruvector-bridge.ts` issues pgvector-operator SQL only. No MCP tool routes Cypher into `SELECT ruvector_cypher(...)`. If `graph_*` axis adopts ruvector-graph as substrate, the postgres-cypher executor is moot for ruflo; if `agentdb_*` retains Cypher under R3's AGE path, AGE supersedes the postgres-cypher executor entirely."

> **No substantive change** is needed to ADR-0174's decision (Option α — `graph_*` as third axis backed by `ruvector-graph`). Council R2's finding stands and the verdict reinforces the case for ruvector-graph (imperative API + future executor fork-patch) over postgres-resident Cypher.

## Confidence

**HIGH.**

Rationale:

- Six independent source-reads (source-analyst, graph-query-expert, dep-mapper, version-analyst, controller-auditor, DA) converged on the same findings without coordination beyond initial assignment.
- Author-supplied disclaimers (`cypher/mod.rs:1`, `parser.rs:1`, `parser.rs:14`: "Simplified … not a proper parsing library") corroborate the council's external verdict.
- 2026-03-03 audit commit `229877fe` touching 60+ files but passing over these stubs is the strongest temporal signal: maintainers consider this code complete.
- Zero fork callers means the practical impact is bounded regardless of ADR-0174's substrate choice.
- The one remaining uncertainty is whether Reuven Cohen's webcasts demonstrated working Cypher on the postgres path; if so, the demos were either (a) on toy single-MATCH-single-hop-RETURN queries that the executor genuinely handles, or (b) routed through `rvlite` / `@ruvector/graph-node` (separate codepaths). Either way, the postgres-cypher executor's hollow state stands.
