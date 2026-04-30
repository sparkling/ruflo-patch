# ADR-0112: Independent stores by feature surface (not "cross-store")

- **Status**: Accepted (work pending) — terminology + reaffirmation done; per-store fail-loud mandate (§Required follow-up work) blocks promotion to Implemented until ADR-0111 W1.8 items #17–#25 close
- **Date**: 2026-04-30
- **Deciders**: Henrik Pettersen
- **Methodology**: 8-agent silent-fallthrough audit swarm (slices 1–8) + ADR-0086 §Debt 15 review
- **Depends on**: ADR-0073 (RVF storage upgrade), ADR-0080 (storage consolidation verdict), ADR-0086 (Layer 1 single storage abstraction — Debt 15 ACCEPTED TRADE-OFF), ADR-0082 (test integrity, no fallbacks), ADR-0090 (acceptance suite coverage audit)
- **Closes**: terminology drift surfaced during ADR-0111 W1.8 problem-collection pass

## Context

During the ADR-0111 W4 prep `npm run test:acceptance` smoke (2026-04-30), 9 acceptance failures surfaced: 8 `adr0090-b5-*` controller-roundtrip failures (`.swarm/memory.db not created after successful store call — silent in-memory fallback, ADR-0082`) and 1 `t3-2-concurrent` failure (`no .rvf file written by any of 6 concurrent stores`).

A natural reading of the failure cluster — both stores failing silently — was that the project has a **dual-store coordination invariant** that's broken: writes to one of `.swarm/memory.rvf` or `.swarm/memory.db` should imply writes to the other; W1.5/W1.6/W1.7's fail-loud cleanup work introduced asymmetric breakage.

This framing **was wrong**. There is no dual-store coordination contract. The 8-agent audit swarm and a re-read of ADR-0086 §Accepted Trade-offs Debt 15 confirms:

> **Debt 15: ControllerRegistry dual-backend** — ACCEPTED TRADE-OFF.
> `memory-router.ts` bootstraps `ControllerRegistry` with its own SQLite configuration via agentdb. This is a separate domain concern for neural/learning controllers.
> Unifying with RvfBackend would require rewriting controller persistence — high effort, low value for the CRUD memory path.

The two stores are **two independent stores serving different feature surfaces**. The "cross-store" framing is a misnomer. This ADR codifies the correct framing so future audits, test design, and silent-fallthrough work don't drift back into expecting coordination that was explicitly declined in 2026-04-13.

## The two stores

| File | Store | Owner | Purpose | Schema shape | Native? |
|---|---|---|---|---|---|
| `.swarm/memory.rvf` | RvfBackend | `@claude-flow/memory` (fork) | Structural memory — key-value entries with embeddings; the broader memory subsystem; HNSW vector search via NAPI | Key-value with binary header + WAL + atomic compact + meta sidecar | Yes (`@ruvector/rvf-node` NAPI) |
| `.swarm/memory.db` | AgentDB SQLite | `agentdb` (external package, `agentdb@3.0.0-alpha.10-patch.348`) | Neural-controller persistence — Reflexion (`episodes`), SkillLibrary (`skills`), ReasoningBank (`reasoning_patterns`), CausalGraph (`causal_edges`), LearningSystem (`experiences`), HierarchicalMemory (`hierarchical_memory`), ConsolidationLog, ExplainableRecall, NightlyLearner, and ~10 more controllers | Multi-table relational with FKs, per-controller migrations | better-sqlite3 (Node native binding) |

Each store is **fully owned by its feature surface**:
- A user calling `mcp__ruflo__memory_store` writes to `.swarm/memory.rvf` only. AgentDB SQLite is irrelevant.
- A user calling `mcp__ruflo__agentdb_reflexion_store` writes to `.swarm/memory.db` only. RVF is irrelevant.

## Why we have two stores (and why not one)

**Two genuinely different workloads, each requiring different storage primitives.** The design isn't a workaround or a historical artifact — it's the correct architecture for the use cases:

### Workload 1 — Structural memory (hot path, RVF)

Use case: "store this entry; semantic-search across millions of entries; return top-k matches in sub-millisecond."

- **Native NAPI HNSW vector index** via `@ruvector/rvf-node` — no SQL overhead, no JSON parse-per-query, binary format, zero serialization on hot reads
- **Append-only WAL + atomic compact** — crash-safe writes without SQL transaction overhead
- **Embedding-aligned storage** — vectors live next to their entries; no JOIN cost
- **Performance**: ADR-0086 cites 150×–12,500× search speedup vs brute-force; this is the whole point of RVF

### Workload 2 — Neural-controller relational data (cold path, AgentDB SQLite)

Use case: "Reflexion remembers episodes with steps + outcomes; SkillLibrary tracks skills with code blocks + feature vectors; CausalGraph stores causal edges with weights + confidence." 10+ controllers, each with their own table set.

- **Rich relational schemas** — multi-column tables with foreign keys, secondary indexes, per-controller migrations
- **Proven SQL query engine** (better-sqlite3 native binding) — handles JOINs, aggregations, complex filtering that key-value can't express
- **Schema flexibility** — new controllers add new tables without disrupting existing ones
- **Sync semantics** — better-sqlite3 is synchronous by design, fits Node's event loop without async overhead for hot path

### Why unifying would catastrophically regress

- **RVF-only** would mean storing relational neural-controller data as JSON blobs in a key-value store. Lose JOINs, lose schema-versioned migrations, lose per-controller indexes. Every Reflexion `episodes` query becomes a full scan with JS-side filtering.
- **SQLite-only** would mean putting structural memory's HNSW into SQLite. Lose native NAPI vector search. Fall back to brute-force or sql-extension HNSW (10–100× slower). ADR-0073's RVF storage upgrade was specifically about getting AWAY from this.

### Confirming-but-not-load-bearing factors (ADR-0086 §Debt 15 reasoning)

- **Ownership boundary.** RVF is fork-architectural — we wrote it (ADR-0073). AgentDB is an external upstream package — we consume it. Modifying AgentDB's internals to use RVF as its persistence layer would mean forking upstream packages just to change their internals (out of fork stance per `feedback-no-value-judgements-on-features.md` + general fork model).
- **Effort vs value.** Per ADR-0086 §Debt 15 — "high effort, low value for the CRUD memory path." The CRUD path doesn't need neural-controller features; the neural-controller path doesn't need RVF's HNSW.
- **Independence is a feature.** RVF can crash without affecting AgentDB controllers; AgentDB can fail to load a controller without affecting RVF stores. Independent failure modes are cheaper to reason about than coupled ones.

The performance + workload-differentiation reasoning is the **primary** justification. Ownership boundary and effort/value were the considerations that closed the original ADR-0086 §Debt 15 decision; they're confirming, not load-bearing.

## Soundness and completeness

### Sound (does the architecture work correctly for its purpose)?

**Yes.** Per the workload analysis above:

- RVF correctly handles structural-memory CRUD + vector search at NAPI speed
- AgentDB SQLite correctly handles neural-controller relational schemas with full SQL query power
- Each store's failure is contained — neither can corrupt the other
- ADR-0086 acceptance tests (`adr0086-*`) + ADR-0090 controller-roundtrip tests (`adr0090-b5-*`) + ADR-0079 RVF concurrency tests (`t3-*`) verify both stores work under their target workloads
- The 2026-04-30 acceptance smoke (540/553 passed) confirms each store's happy path is sound

The 9 failing tests are **silent-fallthrough bugs WITHIN each store** (per the W1.8 audit), not architectural soundness bugs. The two-store partition is doing its job; the per-store implementation has the gaps.

### Complete (does it cover the use cases without gaps)?

**Yes for current workloads.** Every actual ruflo workload maps cleanly to one store:

- `mcp__ruflo__memory_*` tools → RVF
- `mcp__ruflo__agentdb_*` tools → AgentDB SQLite
- Hooks (intelligence/sona/learning) → AgentDB SQLite (via controllers)
- Test inventory (ADR-0086, ADR-0090, ADR-0079) — every test asserts behavior in exactly one store

**Edge cases worth flagging (real but not blocking):**

1. **No cross-store transactions.** If a future feature needed atomic writes spanning both stores (e.g., "store entry in RVF + reference in AgentDB controller"), there's no transaction primitive. Mitigation: by ADR-0112 §Decision, no tool spans both. If a future use case requires it, that's a NEW design decision (would need to extend or supersede this ADR).
2. **Operational doubling.** Two stores = two backup paths, two restore paths, two monitoring surfaces. Real ops cost. Mitigation: wrap with tooling (a `ruflo memory backup` command can handle both internally; not yet built).
3. **HNSW redundancy.** AgentDB has its own HNSW (via better-sqlite3 + hnswlib); RVF has its own HNSW (native NAPI). If a developer accidentally ingests the same vectors into both, duplicate indexes drift independently. Mitigation: tools partition cleanly — no tool uses both HNSWs for the same data. Code-review gate prevents accidental dual-ingest.
4. **Scale ceilings differ.** RVF: native HNSW max element count (configurable, default 100k). AgentDB SQLite: better-sqlite3 practical limits ~10s of GB. Neither approaches a blocker for typical ruflo workloads, but if a future workload exceeds either, that's a per-store scale decision.

### Verdict

**Sound and complete for the current workloads ruflo handles.** The two-store design is the right architecture, not a compromise. The bugs we're fixing in W1.8 are implementation gaps within each store; they don't reflect on the two-store partition itself.

The four edge cases above are flagged for awareness; none are current blockers; if any becomes one, it triggers a new ADR (not this one's reversal).

## Why "cross-store" was the wrong framing

The 8-agent audit during ADR-0111 W1.8 problem-collection (2026-04-30) momentarily treated the b5 failures + t3-2 failure as evidence of a "broken cross-store invariant." Slice 6 of the audit explicitly debunked this:

> RVF path triggers AgentDB index update? **NO**. `RvfBackend.store` writes to `.rvf` + WAL + native HNSW. It NEVER touches `.swarm/memory.db`.
> AgentDB store triggers RVF write? **NO**. Each agentdb controller opens its own better-sqlite3 handle to `.swarm/memory.db`. RvfBackend is invisible to them.
> Verdict: independent paths — by design.

The b5 failures were **per-store silent-fallthrough inside AgentDB's controller path** (controllers' `.store()` resolves successfully but writes only to in-memory cache when controller construction is partially broken — masked by `controller-registry.ts:1521` `?? null`).

The t3-2 failure was **per-store silent-fallthrough inside RVF's WAL/persist coordination** (or, per slice 2, a project-root resolution drift in `_e2e_isolate` test harness — a test-infrastructure bug, not a runtime persistence bug).

Neither is a coordination failure between the two stores. The fixes are per-store, not cross-store.

## Decision

**Drop the "cross-store" / "dual-store invariant" framing across the codebase, ADRs, and test harness.** Replace with **"two independent stores, feature-aligned"**:

- A given MCP tool writes to exactly one store. The store is determined by the tool's feature domain.
- Each store has its own fail-loud contract per ADR-0082. There is no "writes must succeed in both" invariant.
- Acceptance tests assert per-store behavior. Test names should make the target store unambiguous (e.g., `b5_reflexion_writes_to_memory_db` vs `t3_2_concurrent_writes_to_memory_rvf`).

ADR-0086 §Debt 15 is **REAFFIRMED** (not reversed). The dual-backend trade-off remains accepted: we will not unify storage; we will not rewrite AgentDB's controller persistence; we will not push neural-controller schemas onto RVF.

## Consequences

### Positive

- Future audits don't waste time hunting a coordination invariant that doesn't exist.
- Test design is clearer: each test asserts one store; no "verify both" superset checks.
- Silent-fallthrough fixes can proceed per-store independently. Slices 1–8 of the W1.8 audit produce per-store findings; this ADR confirms they don't need cross-coupling.
- ADR-0086 §Debt 15 accepted trade-off has explicit cross-reference.

### Negative

- Users debugging a tool's persistence must know which store it targets. Mitigation: per-tool documentation in MCP tool descriptions + acceptance test names that surface the target store.
- Loss of an attractive "single source of truth" mental model. Accepted: the actual architecture has two sources of truth for two feature surfaces, and that's fine.

### Neutral

- No code changes from this ADR alone. It's terminology + reaffirmation.
- No new test infrastructure. Existing acceptance tests already target a single store each (`adr0090-b5-*` → `.swarm/memory.db`; `t3-2-concurrent` → `.swarm/memory.rvf`); they were never coordinated checks.

## Required follow-up work

The "two independent stores" framing is correct architecturally but **becomes meaningful only when each store has its own fail-loud contract**. ADR-0082 establishes the no-silent-fallbacks policy in the abstract; ADR-0090 added acceptance tests that detect silent-fallback violations; ADR-0111 W1.8 collected the fix work. This ADR MANDATES that the fix work happens — the per-store framing is incoherent without it.

### Mandate (binding on ADR-0111 W1.8 program)

1. **Each store MUST satisfy ADR-0082's no-silent-fallback contract independently — for BOTH read and write paths.**
   
   **Write path** (store / update / delete / persist):
   - RVF: no silent in-memory degradation; persistence failures propagate as fatal errors. The write MUST reach disk before success is returned.
   - AgentDB SQLite: no silent in-memory degradation; controller construction failures propagate as fatal errors; controller `.store()` calls that don't reach disk MUST throw, not return success.
   
   **Read path** (get / query / search / count / list):
   - Cache hits returning OK only when the cache is authoritative (e.g., write-through cache that's guaranteed-coherent with the store). 
   - Cache misses MUST consult the underlying store — not silently return `null` / empty / stale.
   - A read that returns "no results" when the data IS in the store but the query path silently bypassed it is the same antipattern as a write that reports success without writing.
   - Conditional `if (this.<backend>)` bypass on reads is forbidden — same rule as writes.
   - `count()` / `listNamespaces()` / `getStats()` etc. MUST reflect store state, not in-memory cache that may diverge from the store.
   
   **Both contracts apply at the method level**, not just at init time (W1.5/W1.6 closed init-time; W1.8 closes method-time, both read and write).

2. **The 9 failing acceptance tests MUST flip green** (or convert to honest hard-fail with a tracked port-required action — not skip_accepted) as part of W1.8 execution:
   - `t3-2-concurrent` (RVF store)
   - `adr0090-b5-reflexion`, `-skillLibrary`, `-reasoningBank`, `-causalRecall`, `-learningSystem`, `-hierarchicalMemory`, `-nightlyLearner`, `-explainableRecall` (AgentDB SQLite store)
   - Failure of any of these in post-W1.8 acceptance is a release blocker, not a soak window.

3. **New silent-fallthrough sites in either store MUST be caught proactively, not reactively.** ADR-0111 W1.8 item #22 (static-analysis enforcement) + #24 (unit-level fail-loud invariant tests) implement the proactive detection. Acceptance tests catch the symptom; lint + unit tests catch the cause at write time. Both are required.

4. **No new "best-effort" / "graceful degradation" / "in-memory fallback" code paths** in either store's persistence path. Per memory `feedback-no-fallbacks.md` + `feedback-best-effort-must-rethrow-fatals.md`. Existing such paths must be removed (audit slices 1–8 of W1.8 enumerate them).

5. **No coordination contract.** A write succeeding in one store does NOT imply or require a write in the other. Tests asserting "both stores must contain X after operation Y" are wrong by construction — Y targets exactly one store.

### Done criteria for ADR-0112

ADR-0112 closes (moves from `Accepted` to `Implemented`) when:

- ✅ ADR-0111 W1.8 items #17–#26 are all closed
- ✅ Per-store fail-loud contract verified by:
  - All 9 named acceptance tests passing
  - Unit-level fail-loud invariant tests asserting public methods of `RvfBackend`, `AgentDBBackend`, `ControllerRegistry` throw on uninitialized state
  - Static-analysis lint rule (W1.8 item #22) reports zero unannotated SF1/SF3/SF4/SF6 in scope
- ✅ **Partition-holds tests** (W1.8 item #26) verify the no-coordination contract for BOTH reads and writes:
  - **Writes**: `cli memory store` does NOT touch `.swarm/memory.db`; `agentdb_*_store` does NOT touch `.swarm/memory.rvf`
  - **Reads**: `cli memory search` / `memory list` does NOT query `.swarm/memory.db`; `agentdb_*_query` / `agentdb_*_recall` does NOT query `.swarm/memory.rvf`
  - Locks in this ADR's mandate so accidental cross-reads or cross-writes are caught immediately
- ✅ **AgentDB MCP read-tool round-trip tests** (W1.8 item #27): store via `agentdb_*_store` → read via `agentdb_*_recall` / `_search` / `_query` / `_predict` → assert returned data matches stored. Existing b5-* tests bypass read tools by SELECTing sqlite3 directly; if a read MCP tool silently bypasses AgentDB, no current test catches it.
- ✅ ADR-0086 §Debt 15 cross-references ADR-0112 (terminology anchor)
- ✅ Code comments / commit messages preserve the design history (W1.8 item #20)

Until these are satisfied, ADR-0112 stays `Accepted` (decision made, work pending) — it does NOT advance to `Implemented` on the basis of the terminology cleanup alone.

## Implementation notes

- ADR-0111's W1.8 problem list (#17–#25) is the canonical work tracker for the mandate above. No item assumes cross-store coordination; this ADR confirms that's correct AND requires the per-store cleanup happens.
- ADR-0090 acceptance tests already partition by store. No test-harness changes required for the partition; new tests added per W1.8 item #24 should also partition by store.
- Future ADR amendments referencing storage architecture should cite ADR-0112 alongside ADR-0086 §Debt 15 to anchor the framing.
- Any future architectural decision that proposes coupling RVF and AgentDB SQLite (e.g., synchronous mirror writes, cross-store transactions) MUST explicitly reverse this ADR and ADR-0086 §Debt 15 — not silently introduce coupling.

## Cross-references

- ADR-0073 — RVF storage upgrade (RvfBackend introduction)
- ADR-0080 — Storage consolidation verdict (single CRUD path through router → RvfBackend)
- ADR-0086 §Debt 15 — ControllerRegistry dual-backend ACCEPTED TRADE-OFF (the original decision this ADR reaffirms)
- ADR-0082 — Test integrity, no fallbacks (per-store fail-loud contract)
- ADR-0090 — Acceptance suite coverage audit (the test inventory partitioned by store)
- ADR-0111 — Upstream merge program (W1.8 silent-fallthrough audit that surfaced the terminology drift)
- Memory `project-rvf-primary.md` — RVF primary, sqlite fallback only (applies to the RVF store; orthogonal to AgentDB SQLite which is its own primary)
- Memory `feedback-no-value-judgements-on-features.md` — wire all features; preserves AgentDB controllers as-is
