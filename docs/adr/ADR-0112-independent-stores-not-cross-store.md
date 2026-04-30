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

ADR-0086 §Debt 15 already decided this; this ADR records the reasoning explicitly so it's findable next time the question is asked:

1. **Schema mismatch.** AgentDB controllers have rich relational schemas (multi-column tables with FKs, secondary indexes, per-controller migrations). RVF is a key-value store with embeddings. Forcing AgentDB's relational data into RVF would lose schema fidelity (joins, FK constraints, schema-versioned migrations).
2. **Ownership.** RVF is fork-architectural — we wrote it (ADR-0073). AgentDB is an external upstream package — we consume it. Modifying AgentDB's internals to use RVF as its persistence layer violates our fork-only stance for upstream packages (memory `feedback-no-value-judgements-on-features.md` says wire all features; memory `feedback-fork-commits.md` and the broader fork model say we don't fork upstream packages just to change their internals).
3. **Effort vs value.** Per ADR-0086 §Debt 15 — "high effort, low value for the CRUD memory path." The CRUD path doesn't need neural-controller features, and the neural-controller path doesn't need RVF's HNSW.
4. **Independence is a feature.** RVF can crash without affecting AgentDB controllers; AgentDB can fail to load a controller without affecting RVF stores. Independent failure modes are cheaper to reason about than coupled ones.

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

1. **Each store MUST satisfy ADR-0082's no-silent-fallback contract independently.**
   - RVF write path: no silent in-memory degradation; persistence failures propagate as fatal errors.
   - AgentDB SQLite write path: no silent in-memory degradation; controller construction failures propagate as fatal errors; controller `.store()` calls that don't reach disk MUST throw, not return success.
   - Both contracts apply at the method level, not just at init time (W1.5/W1.6 closed init-time; W1.8 closes method-time).

2. **The 9 failing acceptance tests MUST flip green** (or convert to honest hard-fail with a tracked port-required action — not skip_accepted) as part of W1.8 execution:
   - `t3-2-concurrent` (RVF store)
   - `adr0090-b5-reflexion`, `-skillLibrary`, `-reasoningBank`, `-causalRecall`, `-learningSystem`, `-hierarchicalMemory`, `-nightlyLearner`, `-explainableRecall` (AgentDB SQLite store)
   - Failure of any of these in post-W1.8 acceptance is a release blocker, not a soak window.

3. **New silent-fallthrough sites in either store MUST be caught proactively, not reactively.** ADR-0111 W1.8 item #22 (static-analysis enforcement) + #24 (unit-level fail-loud invariant tests) implement the proactive detection. Acceptance tests catch the symptom; lint + unit tests catch the cause at write time. Both are required.

4. **No new "best-effort" / "graceful degradation" / "in-memory fallback" code paths** in either store's persistence path. Per memory `feedback-no-fallbacks.md` + `feedback-best-effort-must-rethrow-fatals.md`. Existing such paths must be removed (audit slices 1–8 of W1.8 enumerate them).

5. **No coordination contract.** A write succeeding in one store does NOT imply or require a write in the other. Tests asserting "both stores must contain X after operation Y" are wrong by construction — Y targets exactly one store.

### Done criteria for ADR-0112

ADR-0112 closes (moves from `Accepted` to `Implemented`) when:

- ✅ ADR-0111 W1.8 items #17–#25 are all closed
- ✅ Per-store fail-loud contract verified by:
  - All 9 named acceptance tests passing
  - Unit-level fail-loud invariant tests asserting public methods of `RvfBackend`, `AgentDBBackend`, `ControllerRegistry` throw on uninitialized state
  - Static-analysis lint rule (W1.8 item #22) reports zero unannotated SF1/SF3/SF4/SF6 in scope
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
