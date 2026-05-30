---
status: accepted
date: 2026-05-11
tags: [agentdb, rvf, substrate, assessment]
supersedes: []
depends-on: [ADR-0166, ADR-0170]
implements: []
---

# Assessment — Can RVF replace SQLite/PostgreSQL as the `agentdb_*` relational substrate?

## Context and Problem Statement

This is a research-assessment record evaluating whether RVF can serve as the relational substrate for the `agentdb_*` axis, as a follow-up to ADR-0166's substrate question and ADR-0170's PostgreSQL proposal.

> **Verdict (TL;DR)**: **No.** Upstream `ruvnet/agentdb` ADR-003 ("RVF Format Integration for AgentDB", Proposed 2026-02-16) does **not** propose RVF as a relational substrate. It proposes RVF as a **drop-in `VectorBackend` replacement** for the vector-data sidecar only. RVF's actual API surface (`@ruvector/rvf` SDK + `rvf-runtime` Rust crate) has zero relational primitives — no `JOIN`, no `WITH RECURSIVE`, no `GROUP BY`, no multi-record transactions, no schema, no foreign keys. The 5 PERMANENT_SQLITE_CARVE_OUT controllers in ADR-0166 cannot run on RVF without writing a SQL engine on top of it. **The fork's substrate choice is between SQLite (ADR-0166) and PostgreSQL (ADR-0170); RVF is not a candidate.**

## Section 1 — What ADR-003 actually proposes

Read upstream ADR-003 in full at `/Users/henrik/source/ruvnet/agentic-flow/packages/agentdb/docs/adrs/ADR-003-rvf-native-format-integration.md` (also at `github.com/ruvnet/agentdb/blob/main/docs/adrs/ADR-003-rvf-native-format-integration.md`).

The decision statement (line 148-150) is unambiguous:

> "Integrate the `@ruvector/rvf` SDK as the **RVF backend** for AgentDB, targeting the N-API backend (`@ruvector/rvf-node`) for Node.js and the WASM backend (`@ruvector/rvf-wasm`) for browser/edge. Both backends implement the same **`RvfBackend` interface** with automatic fallback (`'auto'` mode)."

The scope is the vector-storage axis only. Three direct citations:

| ADR-003 claim | Citation | Scope |
|---|---|---|
| "AgentDB v2 stores vectors through the ruvector npm package's proprietary binary format plus a separate .meta.json sidecar file." | line 10 | **Vectors, not relational data** |
| "**SQLite schema unchanged** — Frontier memory tables (episodes, skills, causal_edges) are backend-agnostic" | line 439 | **Explicit carve-out for relational tables** |
| "Coexistence model: A single AgentDB instance can use SQLite for frontier memory (episodes, skills, causal graphs) while using RVF for vector storage. **The two are independent persistence layers.**" | line 442 | **Two-axis architecture identical to ADR-0166** |

ADR-003 names the same five episode/skill/causal tables that ADR-0166 declares PERMANENT_SQLITE_CARVE_OUT and **explicitly preserves them on SQLite**. The ADRs are not in conflict — they describe the same axis-separated architecture.

What ADR-003 actually replaces is the *current* upstream vector path: `.db` + `.meta.json` two-file persistence (lines 139-147). It's a single-file substitute for that pair, not a substitute for SQLite.

## Section 2 — RVF's actual capability surface

Inspecting the real implementation, not the marketing.

### Rust `RvfStore` API (`forks/ruvector/crates/rvf/rvf-runtime/src/store.rs`, 3,663 lines)

All public methods on `RvfStore` (extracted via `grep "pub fn"`):

| Category | Methods | Count |
|---|---|---|
| Vector CRUD | `ingest_batch`, `ingest_metadata_only`, `query`, `query_with_envelope`, `query_audited`, `delete`, `delete_by_filter`, `get_vector`, `iter_metadata`, `get_metadata`, `iter_metadata_with_vectors` | 11 |
| Lifecycle | `create`, `open`, `open_readonly`, `close`, `compact`, `status` | 6 |
| Lineage (COW) | `branch`, `freeze`, `is_cow_child`, `cow_stats`, `file_identity`, `file_id`, `parent_id`, `lineage_depth` | 8 |
| Segment embed | `embed_kernel`, `embed_kernel_with_binding`, `extract_kernel`, `extract_kernel_binding`, `embed_ebpf`, `extract_ebpf`, `embed_dashboard`, `extract_dashboard`, `embed_wasm`, `extract_wasm`, `extract_wasm_all`, `is_self_bootstrapping` | 12 |
| Introspection | `segment_dir`, `dimension`, `membership_filter` | 3 |
| **Relational** | **(none)** | **0** |

There is no `select`, no `join`, no `aggregate`, no `transaction`, no `prepare`, no `execute`. The only multi-record operation is `ingest_batch` (insert-many of a single shape).

### Filter expression surface (`rvf-runtime/src/filter.rs:14-37`, `rvf-types/src/filter.rs:10-33`)

`FilterExpr` is a single-vector metadata predicate tree:

```rust
pub enum FilterExpr {
    Eq(u16, FilterValue), Ne(u16, FilterValue),
    Lt, Le, Gt, Ge,                    // single field comparison
    In(u16, Vec<FilterValue>),         // field in [values]
    Range(u16, FilterValue, FilterValue),
    And(Vec<FilterExpr>), Or, Not,     // boolean combinators
}
```

`FilterValue` is `{U64, I64, F64, String, Bool}`. The filter operates on `(vector_id, field_id) -> MetadataValue` pairs stored per-vector (`filter.rs:64-69`'s `MetadataStore`). **There is no cross-vector relation, no second table to join against, no aggregation, no recursion.** This is equivalent in expressive power to a single-table `WHERE` clause with comparison/`IN`/`BETWEEN` predicates — comparable to a Bloom-filter or vector-index post-filter, not a query engine.

### TypeScript SDK surface (`@ruvector/rvf@0.1.7`, per ADR-003 §"SDK API Surface" lines 102-133)

Matches the Rust surface 1:1: `ingestBatch`, `query`, `delete`, `deleteByFilter`, `status`, `segments`, `compact`, `derive`, `fileId`, `parentId`, `lineageDepth`, `embedKernel`, `embedEbpf`. No SQL primitive surfaces.

### What the standalone agentdb's `RvfBackend.ts` proves

Inspected at `github.com/ruvnet/agentdb/blob/main/src/backends/rvf/RvfBackend.ts` (22,564 bytes). The class implements `VectorBackendAsync`, not a relational backend. Its methods are `initialize`, `insert`, `insertBatch`, `search`, `searchAsync`, `delete`, `deleteByFilter`, `flush`, `compact`, `getStats`, `derive`, `extractKernel`, `embedEbpf`. **It is a vector store wrapper.** The relational data path lives elsewhere (`db-fallback.ts`, `db-unified.ts`), using `better-sqlite3` or `sql.js`.

### The `SqlJsRvfBackend` red herring

Standalone agentdb ships a second class, `SqlJsRvfBackend` (`src/backends/rvf/SqlJsRvfBackend.ts`, 14,462 bytes), which superficially looks like an RVF-on-SQL adapter. Inspection reveals (lines 323-340):

```typescript
createSchema(): void {
  this.db.run(`CREATE TABLE IF NOT EXISTS rvf_vectors (
    id TEXT PRIMARY KEY,
    embedding BLOB NOT NULL,
    metadata TEXT,
    created_at INTEGER ...)`);
}
async save(savePath: string): Promise<void> {
  const data: Uint8Array = this.db.export();
  fs.writeFileSync(targetPath, data);
}
```

This is a **SQLite database written to a file named `.rvf`** — not an RVF-format file. The `.rvf` extension is reused as a *target filename* with sql.js's serialized SQLite buffer as the payload. It is a fallback when `@ruvector/rvf-node` N-API binaries are unavailable. It does not implement the RVF binary format (segments, manifest, witness chain, COW lineage); it is unrelated to RVF except by filename. This proves nothing about RVF's relational capability.

### Upstream rvf-adapters cross-check

`forks/ruvector/crates/rvf/rvf-adapters/` ships adapters for 6 consumers: `agentdb`, `agentic-flow`, `claude-flow`, `ospipe`, `rvlite`, `sona`. The `agentdb` adapter (`agentdb/src/`) contains exactly three files: `vector_store.rs`, `pattern_store.rs`, `index_adapter.rs`. **Zero relational adapter.** Same for the five other consumers — every adapter wraps `RvfStore::create`/`open`/`ingest_batch`/`query`. No adapter exposes a SQL-like surface, because RVF cannot provide one.

## Section 3 — Feasibility of RVF as relational substrate

To replace SQL on the 5 PERMANENT_SQLITE_CARVE_OUT controllers, RVF would need to host these query shapes:

| Controller | SQL surface count (grep on `forks/agentdb/src/controllers/`) | Required primitive | RVF support |
|---|---:|---|---|
| `CausalMemoryGraph.ts` | 20 hits (WITH RECURSIVE / JOIN / GROUP BY / prepare) | `WITH RECURSIVE chain ... JOIN causal_edges ON chain.to_id = ce.from_memory_id` (line 566, 643) | None. RVF has no second relation to join. |
| `CausalRecall.ts` | 7 hits | `SELECT * FROM causal_edges ... JOIN episodes ... ORDER BY uplift DESC` | None. Single-table filter only. |
| `NightlyLearner.ts` | 19 hits | `FROM episodes e1 JOIN episodes e2 ON e1.session_id = e2.session_id` (cross-product self-JOIN, line 928-929) | None. No self-join primitive. |
| `LearningSystem.ts` | 31 hits | `GROUP BY state/session/date` aggregations for RL telemetry | None. No aggregation. |
| `ReasoningBank.ts` | 15 hits | `GROUP BY task_type` aggregations | None. No aggregation. |

**Total**: 92 SQL primitives across 5 controllers (joins + recursive + aggregations + prepared statements). RVF provides 0 of the 5 primitive *categories* needed.

What it would take to land RVF as substrate (counterfactual):

1. **Build a query engine on top of RVF.** RVF is a segment-addressed binary store; a relational query layer would need its own SELECT/JOIN/GROUP BY/WITH-RECURSIVE planner + executor. This is a 6-12+ engineer-month project (SQLite is ~150K lines; pg is ~1.5M). Even a "minimum viable" planner covering the 5 controllers' SQL is multi-engineer-months — and zero of that work exists upstream.
2. **Define a schema/metadata model.** RVF stores vectors with `(field_id: u16, value: U64/I64/F64/String/Bytes)` pairs per vector. There is no concept of a second entity type (e.g., `causal_edges` independent of `episodes`). The schema layer must be invented from scratch.
3. **Multi-record ACID transactions.** RVF commits per-segment with a two-fsync protocol (ADR-029, "Write Atomicity Invariant"). It has no transaction concept spanning multiple logical records — every `ingest_batch` is one commit. Foreign-key CASCADE, multi-table atomic updates, READ COMMITTED isolation: none exist.
4. **Upstream cadence is zero.** Upstream ADR-003 has been "Proposed" since 2026-02-16 (3 months at this writing). Standalone `ruvnet/agentdb`'s `src/backends/rvf/RvfBackend.ts` has had a single commit since init on 2026-05-06 — and that commit added vector-side wiring only. There is no upstream work on a relational engine, and a relational engine is not in scope per the ADR.
5. **Even if built, you'd need to reinvent the controller business logic.** The 5 controllers contain ~3,000 lines of SQL-driven business logic. Translating to RVF would require either (a) a query language emitter that compiles SQL to RVF segment operations (a SQL-to-RVF translator — not designed, not specified, not started) or (b) hand-rewriting each controller. Both are months of work that produce a slower, less-tested, single-vendor-substrate compared to SQLite/Postgres.

**Conclusion: not feasible.** RVF is architecturally a vector-data format with K-V metadata sidecar — categorically not a relational engine and not on a roadmap to become one.

## Section 4 — Recommendation

The 3-way framing in the brief (SQLite / PostgreSQL / RVF) is asymmetric. RVF is not a substrate candidate — it is what ADR-0166 already calls the `memory_*` axis (vector data), which is already shipped per ADR-0073. The real choice for the `agentdb_*` axis is binary:

| | SQLite (ADR-0166 Option F) | PostgreSQL (ADR-0170) | RVF |
|---|---|---|---|
| Relational SQL (WITH RECURSIVE, JOIN, GROUP BY) | yes | yes (strict superset) | no |
| Multi-record ACID | yes | yes (MVCC) | no |
| Foreign keys + CASCADE | yes | yes | no |
| Vector ops integration | sqlite-vec virtual table (vec0) — planner doesn't use it for ordering | pgvector — planner uses HNSW/IVF natively in `ORDER BY embedding <-> ?` | native, but only for vectors |
| Embedded-default story | yes (better-sqlite3 / sql.js) | yes (pglite WASM) | yes (rvf-wasm) |
| Multi-writer concurrency | single-writer lock; ADR-0167 work needed | MVCC native | not applicable |
| Already shipped in fork | yes (patches 44-48) | not yet | partial (memory_* axis) |
| Upstream cadence | active (sqlite-vec maintained) | active (pgvector + pglite) | zero relational; vector adapter dormant 3+ months |

**Recommended primary**: PostgreSQL via ADR-0170 (Option C: pglite for embedded, `postgres://...` for server). The technical case in ADR-0170 stands on its own merits — pgvector's planner-native vector ordering eliminates the structurally-inert vec0-mirror problem that ADR-0166's Phase 3 documents honestly. RVF as a *secondary vector axis* (the existing `memory_*` `.rvf` files per ADR-0073) is unchanged and unrelated to this decision.

**Recommended secondary (fallback)**: ADR-0166 Option F (SQLite + sqlite-vec) is shipped, tested, and works. If ADR-0170 is not adopted, the fork stays here. The Phase 3 vec0 mirrors are structurally inert today but not actively harmful; the carve-out remains correct.

**Not recommended (rejected)**: RVF substrate. Cannot host the 5 carve-out controllers without writing a relational engine on top, which upstream has not proposed, is not building, and would take engineer-months for the fork to do unilaterally. The "single-file .rvf cognitive container" marketing claim refers to vector + segment data + embedded kernels, not relational state.

## Section 5 — Open questions

The evidence is unambiguous on the central question (RVF is not a relational substrate). Genuinely open downstream questions:

1. **Does ADR-0170's pgvector integration actually deliver planner-used vector ordering for the 5 carve-out controllers?** Not yet shipped — ADR-0170 is "Proposed". Worth piloting on one controller (e.g., `ReasoningBank` GROUP BY + vector recall) before committing the full axis.
2. **Does pglite's WASM postgres handle the migration from existing `.db` SQLite files?** ADR-0170 names migration as fork-internal work. Need to verify pglite supports `CREATE TABLE ... AS SELECT FROM sqlite_dump` or a similar import path before retiring SQLite.
3. **Should `memory_*` axis's RVF retain its current per-process posture (ADR-0167) or graduate to a multi-process RVF coordinator?** Separate question from the `agentdb_*` substrate decision — RVF for vectors is settled at ADR-0073.
4. **Is there an upstream signal that would change this verdict?** Yes — if `ruvnet/agentdb` or `ruvnet/ruvector` ever publishes a relational query layer on top of RVF (e.g., an ADR proposing `RvfStore::execute_sql` or a `rvf-sql` crate), this assessment must be re-run. Currently no such signal exists in the visible upstream commit history (last 3 months).

## Evidence file references

- `/Users/henrik/source/ruvnet/agentic-flow/packages/agentdb/docs/adrs/ADR-003-rvf-native-format-integration.md` (ADR-003 full text; 1,401 lines)
- `/Users/henrik/source/ruvnet/RuVector/docs/adr/ADR-029-rvf-canonical-format.md` (RVF format mandate; lines 47-65, 269-276)
- `/Users/henrik/source/forks/ruvector/crates/rvf/rvf-runtime/src/store.rs` (RvfStore implementation; 3,663 lines, no relational primitives)
- `/Users/henrik/source/forks/ruvector/crates/rvf/rvf-runtime/src/options.rs:101-127` (QueryOptions; filter is the only predicate)
- `/Users/henrik/source/forks/ruvector/crates/rvf/rvf-runtime/src/filter.rs:14-69` (FilterExpr; single-vector metadata predicate tree)
- `/Users/henrik/source/forks/ruvector/crates/rvf/rvf-types/src/filter.rs:10-33` (FilterOp; 11 operators, all comparison/boolean)
- `/Users/henrik/source/forks/ruvector/crates/rvf/rvf-adapters/agentdb/src/vector_store.rs` (upstream Rust adapter; vector-only, 339 lines)
- `github.com/ruvnet/agentdb/blob/main/src/backends/rvf/RvfBackend.ts` (TS RvfBackend; implements VectorBackendAsync, not relational)
- `github.com/ruvnet/agentdb/blob/main/src/backends/rvf/SqlJsRvfBackend.ts:323-340` (proves `.rvf` filename can hold a SQLite payload as fallback; unrelated to RVF format)
- `/Users/henrik/source/forks/agentdb/src/controllers/CausalMemoryGraph.ts:566,643,928-929` (WITH RECURSIVE + self-JOIN — the SQL surface RVF cannot host)
- `/Users/henrik/source/ruflo-patch/docs/adr/ADR-0166-agentdb-unified-database-architectural-gap.md:101-111` (PERMANENT_SQLITE_CARVE_OUT list)
- `/Users/henrik/source/ruflo-patch/docs/adr/ADR-0170-agentdb-substrate-replacement-postgresql.md` (PostgreSQL substitute proposal)
