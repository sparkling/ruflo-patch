---
status: proposed
date: 2026-05-25
tags: [upstream-sync, graph-intelligence, ADR-130, re-implementation, archivist, embeddings, design-gate]
supersedes: []
depends-on: [ADR-0177, ADR-0181, ADR-0202, ADR-0227, ADR-0246, ADR-0253, ADR-0254]
implements: []
---

# Fork-native graph intelligence backend — ADR-130 re-implementation design

## Context and Problem Statement

Upstream PR `edde98f9e` ("feat(graph): ADR-130 — unified graph intelligence backend (P1-P6) (#2129)") ships a unified graph-edges substrate with temporal decay and witness signing. The intended capability is real and useful: graph-shaped retrieval that `causal_edges` cannot serve — trajectory-caused / reinforced-by edges between `memory_entries` rows, with `confidence × exp(-decay_rate × days_since_last_reinforced) × weight` scoring (a "graph that forgets" property).

[[ADR-0254]] dispositioned the verbatim upstream pick as `defer` with `re-implement-when-revisited` and a 7-item re-implementation criteria checklist. The verbatim surface violates seven fork invariants in ways that cannot be reconciled by codemod:

1. Module-scope `_db` cache violates the spirit of ADR-0202's no-daemon-lock-cache lint (lint is `worker-daemon.ts`-scoped today; the policy is general).
2. `} catch { return false; }` fire-and-forget writes violate `[[feedback-best-effort-must-rethrow-fatals]]`.
3. MiniLM-384 embedding model + 400B/edge PQ budget vs fork's mpnet-768 + 784B/edge budget per `[[reference-embedding-model]]`.
4. No archivist routing — upstream writes directly via the module-scope `_db`; fork's [[ADR-0181]] mandates writes go through `routeMemoryOp` for audit-traceability.
5. No substrate routing — fork's [[ADR-0246]] requires writes route through `staging-substrate.ts` for crash-safe RVF/SQLite handling.
6. Schema impedance — upstream extends `MEMORY_SCHEMA_V3`; fork has no `MEMORY_SCHEMA_V3`. The fork-native graph schema lives in `forks/agentdb/src/schemas/`, not `forks/ruflo/v3/@claude-flow/cli/src/memory/`.
7. Witness chain mismatch — upstream's temporal-decay uses `verification/witness-fixes.json` (fork doesn't have this file); fork's witness IDs map to the archivist's audit-chain entry id.

This ADR is the fork-side design that satisfies all 7 criteria. It is intentionally proposed-only — no implementation lands until ratified.

## Decision Drivers

* **Preserve the capability.** "Graph that forgets" + reinforced-edge retrieval is a real feature gap. The fork should have an equivalent, just shaped differently to fit its architecture.
* **Don't re-introduce ADR-0177's substrate split.** [[ADR-0177]] restored RVF as the primary write path; graph edges must NOT live in a separate SQLite-only carve-out that bypasses RVF, OR if they do, it must be documented as a Phase-7-style intentional carve-out (like daemon Archivist FS-JSON per [[ADR-0253]] C1).
* **Honor ADR-0181's audit-traceability mandate.** Every graph-edge write must be routable through `routeMemoryOp` so the audit chain captures it. No silent writes.
* **Stay within `[[reference-embedding-model]]`'s mpnet-768 commitment.** Per the §1 criterion, switching encoders for a single feature would fragment the embedding space (PQ-quantized cosine MiniLM-384 vs mpnet-768 is mathematically meaningless).
* **Don't fork the schema layer.** Fork's `agentdb` package owns the schema; if graph-edges need a new table, it lives in `forks/agentdb/src/schemas/`, not in `forks/ruflo/v3/@claude-flow/cli/src/memory/`.
* **Lock-free under daemon mode.** Per [[ADR-0253]] C2 (RVF-lock-holding workers), any new write path must either acquire-release per-op (per [[ADR-0202]] live-fix) or document why it can hold lifetime locks.

## Considered Options

### Option A — Fork-native `agentdb_graph_edge` archivist handler

Add a new MCP-tool-level `agentdb_graph_edge` handler in `forks/agentdb/src/archivist/handlers/`. Writes route through `routeMemoryOp({type:'graph-edge', ...})`. Schema lives in `forks/agentdb/src/schemas/graph-edges.sql`. mpnet-768 PQ encoding at 784B/edge. No module-scope cache — handler acquires substrate handle per-op via `staging-substrate.ts`. Fire-and-forget writes are rejected; data-integrity errors throw.

**Pros:**
- Satisfies all 7 ADR-0254 criteria cleanly.
- Existing pattern — handler shape mirrors `agentdb_causal-edge`, `agentdb_hierarchical-store`, etc.
- Schema lives in agentdb package — matches fork ownership model.
- Audit-traceable via routeMemoryOp.

**Cons:**
- Implementation surface ~400 lines (handler + schema + PQ encoder thread + tests + smoke).
- Forces a `causal_edges` disposition decision (sub-option A1/A2/A3 below).
- Forces a witness-chain mapping (witness_id → archivist audit-chain entry id) that doesn't have a precedent.

### Option B — Extend `causal_edges` with reinforcement-decay columns

Add `last_reinforced_at`, `reinforcement_count`, `decay_rate` columns to the existing `causal_edges` table. Compute the "graph that forgets" score as `confidence × exp(-decay_rate × (now - last_reinforced_at)) × weight`. No new handler — `agentdb_causal-edge` already exists.

**Pros:**
- Smallest surface — schema migration + score-computation tweak in existing handler.
- No new substrate-routing question to answer (causal_edges already routes through archivist).
- No witness-chain question (causal_edges already maps to archivist audit-chain).

**Cons:**
- Loses upstream's "graph-edges as a distinct concept from causal" framing — every edge becomes a causal edge with decay metadata.
- The fork's `causal_edges` shape is controller-id space (per ADR-0147 R7) — extending to memory-entry-row space requires a join model that may not fit cleanly.
- Embedding storage isn't part of causal_edges today; adding 784B/edge PQ payload to causal_edges grows that table's row size 50× (current rows are ~12 bytes; adding PQ pushes them to ~800 bytes).

### Option C — Defer with a tighter trigger (status-quo)

Keep [[ADR-0254]]'s defer disposition. Tighten the unblock trigger from "user/queen mandate OR real fork-side need" to a single concrete predicate: "a user-facing query that `causal_edges` cannot serve, captured as a failing acceptance test."

**Pros:**
- Zero implementation cost now.
- Forces evidence-gated revisit: a failing test in `tests/acceptance/` is concrete, not speculative.

**Cons:**
- The feature stays a known gap. If trajectory/reinforcement-shaped retrieval becomes useful before the trigger fires, we know-but-don't-have.
- Doesn't make progress on the architectural questions — punts them to a future session.

### Sub-options for Option A: `causal_edges` disposition (criterion #5)

If Option A is chosen, the question of what to do with the existing `causal_edges` table needs an answer:

* **A1 — Coexist.** Both tables exist. Documented as: `causal_edges` = controller-id-space narrative (small, stable); `graph_edges` = memory-row-space PQ-encoded with decay (large, mutable). Each has clear ownership.
* **A2 — Consolidate (graph_edges absorbs causal_edges).** Translate causal_edges' (cause_controller, effect_controller) tuples into the graph_edges format with `decay_rate = 0` (no decay) + `weight = 1`. Single table, loses the "small stable" vs "large mutable" semantic split.
* **A3 — Retire causal_edges.** Same as A2 but explicitly drop the causal_edges schema after migration. Breaks [[ADR-0181]] Item 3 + [[ADR-0147]] R7 callers; requires those to migrate too. Highest cost.

### Sub-options for Option A: witness chain mapping (criterion #7)

* **A-W1 — Archivist audit-chain ids.** Every graph_edges row's `witness_id` is the archivist's audit-chain entry id that recorded the write. The fork doesn't have `verification/witness-fixes.json` (that's an upstream Ed25519 path); we use archivist as the witness surface instead. Cleanest fit.
* **A-W2 — No witness column.** Drop the column entirely. Lose the audit-shape but avoid the mapping question.
* **A-W3 — Borrow upstream's signature shape.** Carry the Ed25519 fields but with our own signing pipeline. Heaviest; redundant with the archivist's audit chain.

## Decision Outcome

**Proposed: Option A + Sub-options A1 (coexist) + A-W1 (archivist audit-chain ids).**

Why A:
- Cleanest satisfaction of all 7 criteria.
- Implementation surface is bounded (~400 lines).
- Schema lives in the right package (agentdb).
- The "graph that forgets" capability lands as a real, audit-traceable surface.

Why A1 over A2/A3:
- causal_edges is stable, mostly-immutable controller-narrative data; graph_edges is mutable memory-row-data. Different shapes shouldn't share a table.
- A2/A3 force migration of [[ADR-0181]] Item 3 + [[ADR-0147]] R7 callers — significant blast radius for a refactor that doesn't add capability.
- A1's "documented two-table split" precedent exists already (RVF + SQLite per [[ADR-0177]]; causal vs hierarchical per [[ADR-0147]]).

Why A-W1 over A-W2/A-W3:
- A-W1 reuses the archivist's existing audit-chain shape. No new signing pipeline. No new file dependency.
- A-W2 loses audit-traceability — every graph-edge write should be traceable.
- A-W3 duplicates the audit surface — two-witness systems is harder to keep consistent.

Rejected options:
- **Option B (extend causal_edges):** the embedding storage growth (12B → 800B per row, 50× row size) is real cost, and the schema impedance forces a join model that ADR-0147 didn't anticipate.
- **Option C (defer tighter):** valid as a fallback, but the user already named ADR-130 as a "go through one by one" item. Doing the design now while context is loaded is cheaper than re-loading later.

This ADR is **proposed**. Ratification + implementation are separate steps. Once ratified, the implementation ADR (this one amended to `accepted` + `implemented`) covers:

* New handler at `forks/agentdb/src/archivist/handlers/agentdb-graph-edge.ts`
* New schema at `forks/agentdb/src/schemas/graph-edges.sql`
* mpnet-768 PQ encoder thread in `forks/agentdb/src/encoders/`
* `routeMemoryOp` route extension for `type: 'graph-edge'`
* Per-op substrate acquisition via `staging-substrate.ts`
* `loadEdge`/`saveEdge`/`queryByMemoryRow`/`reinforce`/`decay`/`sweep` MCP tools (~6 tools)
* Smoke at `scripts/smoke-agentdb-graph-edge.mjs`
* Unit tests at `forks/agentdb/tests/`
* CI job stanza

## Risks

| Risk | Mitigation |
|---|---|
| 784B/edge PQ payload makes the graph_edges table grow fast | Add a `sweep(maxAgeDays)` MCP tool that hard-drops rows whose `(now - last_reinforced_at) > maxAgeDays`. Default 90 days. |
| coexist (A1) creates UI confusion ("which table do I query?") | The `causal_edges` and `graph_edges` MCP tools are distinct (`agentdb_causal-edge` vs `agentdb_graph-edge`) — the naming alone disambiguates. README in agentdb package documents the split. |
| archivist audit-chain id (A-W1) doesn't have a stable serialization that survives store rebuilds | Verify before implementation: `archivist.dispatch(...)` already returns an audit-chain id today (per [[ADR-0181]] Phase C); that id IS stable. If not, fall back to A-W2 (no witness column). |
| mpnet-768 encoder is slow for high-volume edge writes | Batch encoder calls — caller pushes N edges in one MCP call, encoder runs PQ once over the batch. Default batch size 64. |
| Existing upstream `graph-edge-writer.ts` pattern leaks into the fork via a future verbatim merge | Add an explicit "WONT_MERGE" guard in `scripts/codemod.mjs` (similar to `DELETE_FILES`) for `graph-edge-writer.ts`. Re-implementation criterion #1 (no module-scope cache) is policy-only today per [[ADR-0254]] Revision 2; this codemod entry makes it enforced-at-pipeline. |

## Cross-references

* [[ADR-0254]] — upstream ADR-129/130 disposition. ADR-130 deferred with the 7-criteria checklist this ADR satisfies.
* [[ADR-0177]] — RVF-primary substrate. Constrains where graph_edges schema lives (forks/agentdb/src/schemas/, not v3/cli/memory/).
* [[ADR-0181]] — archivist seam discipline. Mandates routeMemoryOp for all writes.
* [[ADR-0202]] — no module-scope substrate handle cache. Bans the upstream `let _db = null` pattern.
* [[ADR-0227]] — adaptive-floor 0.3→0.15 tuned for mpnet. Locks the embedding model choice.
* [[ADR-0246]] — staging-substrate seam. Mandates per-op acquire/release.
* [[ADR-0253]] — substrate carve-outs (daemon Archivist FS-JSON; RVF-lock-holding workers). Documents the prior carve-outs this ADR's design avoids.
* `[[reference-embedding-model]]` — mpnet-768 canonical choice. Locks criterion #4.
* `[[feedback-best-effort-must-rethrow-fatals]]` — corpus rule informing criterion #6 (no fire-and-forget).
* `[[feedback-no-fallbacks]]` — informs the rejection of fire-and-forget patterns.
* Upstream PR `edde98f9e` — the verbatim implementation this ADR replaces with a fork-native equivalent.

## Confirmation

This ADR is proposed-only. To advance:

1. **Council review** of the design (Option A + A1 + A-W1). Devil's-advocate critique surfaces any 8th criterion or invalidates one of the 7.
2. **Ratification** flips status `proposed` → `accepted`.
3. **Implementation** is a separate ADR amendment (status → `implemented`, with the named files + tests + smoke + CI job in place).
4. **Re-implementation criteria audit** at end of implementation: each of the 7 criteria has a passing acceptance test verifying its compliance.

Until step 4 completes, ADR-130 stays deferred in the ledger.
