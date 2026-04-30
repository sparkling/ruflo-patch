# ADR-0112: Independent stores by feature surface (not "cross-store")

- **Status**: **Implemented** 2026-04-30. All 7 §Done criteria items closed. Phases 1–6 complete. Phase 1 (quick wins) flipped 9/9 named failures green via the `_e2e_isolate` project-root anchor + `routePatternOp` silent-fallback removal. Phase 2 closed 5/5 tracks (RVF + AgentDB-backend + controller-registry + memory-router + MCP handlers). Phase 3 added 22 unit-level fail-loud invariant tests + 8 acceptance tests (4 partition-holds + 4 AgentDB read-tool round-trip). Phase 4 lint script wired into `npm run preflight` cascade (zero unannotated SF1/SF3/SF4/SF6 violations across 7 partition-relevant fork files; 32 legitimate sites annotated as design patterns). Phase 5 ADR-0086 §Debt 15 cross-references ADR-0112. Phase 6 acceptance verified: 540/553 baseline → 560/560 (8 new tests + 9 named tests now passing; 0 regressions).
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

## Glossary

- **Feature surface**: a coherent set of MCP tools, hooks, or runtime paths that share a single persistence target. Examples: structural memory (RVF, accessed via `mcp__ruflo__memory_*` tools); Reflexion neural-controller (AgentDB SQLite, accessed via `mcp__ruflo__agentdb_reflexion_*` tools). One feature surface = one persistence target.
- **Store** (in this ADR): a durable on-disk persistence target, owned and accessed by a single feature surface. Currently two: `.swarm/memory.rvf` (RVF) and `.swarm/memory.db` (AgentDB SQLite). Distinct from in-memory caches that mirror the store.
- **Partition**: the property that each store is accessed by one and only one feature surface; no MCP tool reads or writes both. Verified by tests in W1.8 item #26.
- **Per-store fail-loud contract**: each store independently satisfies ADR-0082 (no silent fallbacks) for both read and write paths at the method level (not just init time). See §Required follow-up work.
- **Cross-store coordination**: the ABSENCE of any contract requiring writes to one store imply writes to the other. ADR-0086 §Debt 15 + this ADR explicitly reject cross-store coordination.

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

- ✅ ADR-0111 W1.8 items #17–#27 all closed (item #26 + #27 DONE 2026-04-30 in `02f03cc`; #17–#25 closed via Phase 2 tracks: RVF `ffa9de5f8`, AgentDB-backend `a3be0c1af`, controller-registry `fd9c4a1db`, memory-router `276ee7b55`, MCP handlers `fac6a01ac`)
- ✅ Per-store fail-loud contract verified by:
  - ✅ All 9 named acceptance tests passing (Phase 1, fix in `19768f711` + `ac61112` 2026-04-30; smoke 540/553 → 552/553)
  - ✅ Unit-level fail-loud invariant tests asserting public methods of `RvfBackend` and `AgentDBBackend` throw on uninitialized state — `tests/unit/adr0112-fail-loud-invariants.test.mjs` (commit `c4ef272`); 22 cases covering 9 RvfBackend methods + 9 AgentDBBackend methods + 4 contract probes; ControllerRegistry's `ControllerInitError` propagation exercised via integration (memory-router catches discriminate per memory-router track `276ee7b55`)
  - ✅ Static-analysis lint rule (W1.8 item #22) reports zero unannotated SF1/SF3/SF4/SF6 in scope — `scripts/lint-fail-loud.mjs` (commit `f47efb9`); 32 baseline violations annotated as legitimate design patterns in fork commit `7f64d3ee4`; wired into `npm run preflight` cascade so new silent-fallthroughs fail before they reach acceptance
- ✅ **Partition-holds tests** (W1.8 item #26) verify the no-coordination contract for BOTH reads and writes (DONE 2026-04-30 in `02f03cc`; `acceptance-adr0112-checks.sh` lines 26.1–26.4):
  - **Writes**: `cli memory store` does NOT leak user data into `.swarm/memory.db`; `agentdb_*_store` does NOT leak data into `.swarm/memory.rvf` family (`.rvf` + `.rvf.meta` + `.rvf.wal`)
  - **Reads**: `cli memory search` does NOT cause user data to land in `.swarm/memory.db`; `agentdb_*_retrieve` does NOT cause user data to land in `.swarm/memory.rvf` family
  - Locks in this ADR's mandate so accidental cross-reads or cross-writes are caught immediately
  - **Note on init coupling vs data coupling**: both stores eagerly initialize their files at module load (RvfBackend writes a header byte; AgentDB creates an empty schema). This is init-coupling, not data-coupling. The partition tests detect USER DATA crossing the store boundary via marker-substring scan, not file existence. Init-coupling lazy-init is a separate, lower-priority concern.
- ✅ **AgentDB MCP read-tool round-trip tests** (W1.8 item #27): store via `agentdb_*_store` → read via `agentdb_*_recall` / `_search` / `_retrieve` → assert returned data matches stored (DONE 2026-04-30 in `02f03cc`; `acceptance-adr0112-checks.sh` lines 27.1–27.4 cover reflexion, pattern, skill, hierarchical). Closes the gap where existing b5-* tests bypass read tools by SELECTing sqlite3 directly.
- ✅ ADR-0086 §Debt 15 cross-references ADR-0112 (terminology anchor) — DONE 2026-04-30 in `02f03cc`; Debt 15 entry now reads "ADR-0112 REAFFIRMS this trade-off"
- ✅ Code comments / commit messages preserve the design history (W1.8 item #20) — Phase 1 commits (`19768f711`, `ac61112`) and Phase 3 commit (`02f03cc`) all narrate the design decision and reference ADR-0112 §Decision

Until these are satisfied, ADR-0112 stays `Accepted` (decision made, work pending) — it does NOT advance to `Implemented` on the basis of the terminology cleanup alone.

**Status flip 2026-04-30**: all 7 items satisfied; ADR-0112 advances from `Accepted (work in progress)` to `Implemented`. The lint guardrail in `npm run preflight` is now the durable invariant that prevents regression — any new silent-fallthrough site in the 7 partition-relevant fork files fails the cascade before it can reach acceptance.

## Implementation plan

The 27-item ADR-0111 W1.8 problem list (items #17–#27) is the canonical work tracker. This plan organizes those items into 6 phases by dependency. Phases run in sequence with parallelism within phases where items are independent.

### Phase 1 — Quick wins (target: smoke 540/553 → ≥549/553)

Two single-site fixes likely close 2 of 9 failures cheaply, plus an investigation for the other 7. Sub-tasks within item #17.

1. **`_e2e_isolate` project-root anchor** (`lib/acceptance-e2e-checks.sh`): one-line `touch "$iso_dir/.ruflo-project"` to anchor `findProjectRoot()` inside iso. Likely flips `t3-2-concurrent` green per slice 2's analysis.
2. **`routePatternOp` line 1419 silent-fallback** (`memory-router.ts`): remove the silent fallback writing to wrong table when reasoningBank lacks a method. Likely flips `adr0090-b5-reasoningBank` green per slice 6.
3. **Investigation for the other 7 b5 tests**: per slice 6, masking lives inside the `agentdb` package itself — controllers' `.store()` resolves successfully but writes to in-memory only when controller construction is partially broken. Need to verify whether the actual fix is (a) `controller-registry.ts:1521` `?? null` strict-mode throw, (b) AgentDB package version-mismatch, or (c) something else.

### Phase 2 — Per-store fail-loud cleanup (the audit findings)

Independent tracks; can run in parallel. Each track is a sub-set of item #17.

- **RVF track** (slices 2, 8): add `RvfNotInitializedError` class + 9 init guards on public methods; fix 4 silent-fallthrough sites (`compactWal()` line 1800 `persisting`-guard, `persistToDiskInner()` line 2178 same, `autoPersistInterval` line 297 catch (discriminate per `feedback-best-effort-must-rethrow-fatals`), `mergePeerStateBeforePersist` lines 2161-2164 catch).
- **AgentDB-backend track** (slice 1): add `requireAgentDB(method)` private helper; apply to 9 public methods (read + write); remove 6 dead `if (!this.agentdb)` branches + 6 `if (this.agentdb)` conditionals; re-throw in 5 private DB methods; reorder write paths (DB-first, cache-on-success); real `healthCheck()` via `SELECT 1` probe. **Item #25** (available-flag dead-branch cleanup) is a sub-task here.
- **Controller-registry track** (slice 3): scrub remaining 27 silent-fallback sites with W1.5's `ControllerInitError` pattern; **special-case 3 Level-0 mandatory controllers** (`resourceTracker`, `rateLimiter`, `telemetryManager`) to throw unconditionally on missing-symbol; replace 7 `?? null` at lines 1521-1531 with strict-mode throw; decide stub fate (`createTieredMemoryStub`, `createConsolidationStub`).
- **Memory-router track** (slice 4): add `DimensionMismatchError` to discrimination at lines 526, 562, 669, 698, 717; add `RvfCorruptError` to 526, 562, 717 (parity with 698); surface unnamed schema-mismatch errors with original `cause`; discriminate `ControllerInitError` at op-layer.
- **MCP handler track** (slice 5): fix 4 silent-fallthrough sites (`agentdb_semantic_add_route` / `_remove_route`, `hooks_intelligence_pattern-store`, `memory_store` scope/graph enrichment); add response verification fields per the `agentdb_sona_trajectory_store` count-after pattern to all 8 b5 handlers.

### Phase 3 — Test surface

Per slice 8's recommendation: write tests FIRST (they fail against current code → prove bugs exist), THEN apply Phase 2 fixes, THEN tests pass. In practice: Phase 3 starts in parallel with Phase 2 — for each Phase 2 item, write the test first, watch it fail, apply fix, watch it pass.

- **Item #24** — unit-level fail-loud invariant tests for AgentDBBackend (~25 cases parameterised over public methods)
- Same shape for RvfBackend (depends on Phase 2's `RvfNotInitializedError` class)
- Same shape for ControllerRegistry (`ControllerInitError` propagation)
- New file `cli/__tests__/memory-router.test.ts` for `AgentDBInitError` re-throw paths
- Codemod test for error-class-name preservation through scope rename
- **Item #26** — partition-holds acceptance tests (4 cases: 2 write + 2 read; verify operations don't touch the wrong store)
- **Item #27** — AgentDB MCP read-tool round-trip tests (store via `agentdb_*_store`, read via `agentdb_*_recall` / `_search` / `_query` / `_predict`, assert match — closes the gap where existing b5 tests bypass read tools by SELECTing sqlite3 directly)

### Phase 4 — Static-analysis enforcement (item #22)

Implement `scripts/lint-fail-loud.mjs` with rules SF1–SF7 (slice 7 design):
1. Implement scanner (~250 LOC) + tests (~100 LOC)
2. Bootstrap pass: ~150–200 hits project-wide
3. Triage: ~70% legitimate (annotate with `// silent-fallthrough-OK: <reason>`), ~20% real fixes (already covered by Phase 2), ~10% ambiguous
4. Wire into `npm run preflight` cascade
5. Once green, lint becomes permanent guardrail — new silent-fallthroughs require explicit annotation

### Phase 5 — ADR amendments (depends on Phase 2/3 outcomes)

- **Item #18** — ADR-0086 amendment: W1.8 method-level invariant in §Accepted Trade-offs / §Architectural Direction
- **Item #23** — ADR-0082 amendment: codify detection mechanism (lint rule + unit invariants + audit cadence)
- **Item #21** — ADR-0090 amendment (conditional): if Phase 3 reveals test-inventory gaps
- ADR-0086 §Debt 15 cross-reference to ADR-0112 (terminology anchor per ADR-0112 §Done criteria)
- **Item #20** — design-history preservation in W1.8 commits + code comments (ongoing, not a gate)

### Phase 6 — Verification gate (item #19)

- Re-run `npm run test:acceptance` from `ruflo-patch/`
- **Required**: 540/553 → ≥549/553 (the 9 currently-failing tests pass; net gain by integration of items #26 and #27 may be higher)
- No new regressions
- Lint reports zero unannotated SF1/SF3/SF4/SF6 in scope
- Unit tests all green
- Partition-holds tests (item #26) pass
- AgentDB MCP read-tool round-trip tests (item #27) pass

**Performance regression gate**: the Phase 2 fail-loud guards add an `if (!this.<backend>) throw` check at the top of every public method. The `requireAgentDB(method)` helper + real `healthCheck()` SQL probe could in worst-case add latency to every `store/get/query` call. Phase 6 also asserts:

- **No >10% regression** on `t3-1-bulk-corpus` (current baseline ~16s for 1000 inserts)
- **No >10% regression** on `e2e-search-semantic-quality` (current baseline ~5s for store + search)
- **No >10% regression** on `adr0090-b3-*` worker-metric round-trip tests (latency-sensitive surface)

If any of these regresses past 10%, Phase 6 fails and the regression must be diagnosed before ADR-0112 closes. Likely causes if regressed: real `healthCheck()` adds SQL round-trip on every method call (mitigation: cache the healthcheck result with a 1s TTL); `requireAgentDB` is hot-path (mitigation: inline the check, avoid function-call overhead); reordered write path adds an extra await (mitigation: ensure the AgentDB write was synchronous before).

When all gates pass (test count + lint + unit + partition + read-roundtrip + perf), **ADR-0112 closes** (`Accepted (work pending) → Implemented`).

### Sequencing

- **Phase 1 first** — quick wins flip 2-3 of 9 failures and validate the larger fix shape works
- **Phases 2 + 3 in parallel** — TDD-first per Phase 3's recommendation; Phase 2's per-store tracks are independent
- **Phase 4 after Phase 2 baseline** — lint can run once core silent-fallthroughs are removed; bootstrap annotation pass uses Phase 2's findings
- **Phase 5 throughout** — ADR amendments land as their corresponding code changes commit (not all at once)
- **Phase 6 last** — single verification run after all items closed

### Rollback procedure

Phase 2 changes core persistence paths in `agentdb-backend.ts`, `rvf-backend.ts`, `controller-registry.ts`, `memory-router.ts`, and MCP handlers. If post-Phase 2 acceptance regresses unexpectedly (perf regression, deadlock, init-time hang, broader failure than the targeted 9 tests), the revert procedure is **per-track**, not whole-program:

- **Per-track tags**: each Phase 2 track lands as its own commit (or commit cluster) with a `pre-w1.8-<track>` tag on `forks/ruflo` `main` (fork work is trunk-based per memory `feedback-trunk-only-fork-development`; the originally-planned `merge/upstream-2026-04-29` working branch was abandoned 2026-04-30 and the commits FF'd onto `main`). Tracks: `rvf`, `agentdb-backend`, `controller-registry`, `memory-router`, `mcp-handlers`. Total 5 tags.
- **Per-track revert**: `git revert <track-commit-range>` reverts that track only. Other tracks' changes preserved. Useful when a single track regresses but others are fine.
- **Smoke gate after each track lands**: `npm run test:acceptance` against the post-track state. If smoke regresses by more than the expected 0-3 failures (the 9 we expect to flip green minus any broken, plus any genuinely new), halt and revert that track before merging the next.
- **Whole-Phase-2 revert path**: if multiple tracks combine to regress (e.g., interaction effect), revert all 5 tracks via `git reset --hard pre-w1.8-baseline` on `main`. This is the nuclear option; coordinate with whoever's holding the fork checkout.
- **Phase 1 quick wins are NOT in the per-track scope** — they're single-site fixes with minimal blast radius. If they regress, single-commit revert suffices.
- **Phase 3 tests can stay green during a revert** — they're new test files, independent of Phase 2 source changes (some tests will go from green to red without the fix; that's expected and acceptable for a revert).
- **Phase 4 lint annotations DO need coordination on revert** — if Phase 2 reverts, Phase 4's bootstrap annotation pass that marked sites as "now fail-loud, no annotation needed" becomes stale; would need a Phase 4 follow-up annotation pass.

### Implementation notes (orthogonal)

- ADR-0090 acceptance tests already partition by store. No test-harness changes required for the partition; new tests added per items #26 and #27 should also partition by store.
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
