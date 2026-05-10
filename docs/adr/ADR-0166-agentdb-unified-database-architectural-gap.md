---
status: discussion
date: 2026-05-10
methodology: [architectural-audit, decision-record]
decision-makers: [Henrik Pettersen]
tags: [agentdb, ruvector, sqlite, unified-database, architecture, aspirational-vs-delivered]
related: [0154, 0160, 0161, 0162, 0163, 0165]
audience: ai-executor
---

# ADR-0166: AgentDB UnifiedDatabase wiring — close the aspirational/delivered gap

> **Status**: discussion. This ADR documents an architectural gap surfaced by ADR-0165's investigation. It does not pick a decision; it lays out the two paths and the trade-offs so the parent thread can decide when the question becomes load-bearing.

## Context and Problem Statement

ADR-0165's AgentDB Backend-Resolution Auditor found a discrepancy between AgentDB's documented architecture and its delivered behavior:

**Documented (aspirational)**: `forks/agentdb/src/db-unified.ts:5`:

> *"PRIMARY: RuVector GraphDatabase (@ruvector/graph-node) for new databases"*

**Delivered (actual)**: `forks/agentdb/src/core/AgentDB.ts:117-128`:

```ts
// Line 117 (simplified):
this.db = new (better-sqlite3).default(dbPath);
// Line 124-128: fallback to sql.js WASM
```

`UnifiedDatabase` is a separate class at `forks/agentdb/src/db-unified.ts:37-141` that **is never imported by AgentDB core**. The `vectorBackend: 'auto'/'rvf'/'ruvector'/'hnswlib'` config field at `core/AgentDB.ts:82` selects only the **vector-search axis** (line 173-192); SQLite is **always** the primary persistence target.

This gap has three concrete consequences:

1. **Dual-storage pattern is intentional, not drift.** The fork has two parallel persistence systems:
   - `memory_*` MCP tools → RvfBackend → `.swarm/memory.rvf`
   - `agentdb_*` MCP tools → AgentDB core → `.swarm/memory.db` (SQLite)
2. **`vectorBackend: 'auto'` is a half-truth.** It controls vector search but NOT where the actual rows live. A user reading the config would reasonably assume `'auto'` resolving to `'rvf'` means RVF is the storage; it doesn't.
3. **The ADR-0154 architectural promise of "single-file storage" applies to the `memory_*` path only.** AgentDB's SQLite file is a separate persistence target that ADR-0154's Phase B deletion plan (under ADR-0164) does NOT touch.

The user surfaced this question during ADR-0165's investigation: *"is agentdb not configured with ruvector? Does that make sense?"* The answer is no — agentdb is hard-wired to SQLite regardless of `vectorBackend` config — and **that's not what the architecture documents claim**.

## Decision Drivers

* **Architectural honesty.** Aspirational docstrings that don't match delivered behavior cause investigation churn. ADR-0163's prior council misdiagnosed t3-2-concurrent because session memory `project-adr0154-true-scope.md` claimed `write_meta_seg` was `#[allow(dead_code)]` when it wasn't — same pattern of stale-aspiration creating diagnostic blind spots. The agentdb dual-storage pattern is currently UN-documented; the next investigation that hits a `.swarm/memory.db` failure will repeat the cycle.
* **`feedback-no-fallbacks` posture.** The dual-storage pattern is not a `feedback-no-fallbacks` violation per se — both stores are loud and intentional. But the silent-fallback inside AgentDB core (which ADR-0165 fixed at `d6ccca63a`) was a derived violation. Addressing the root cleanly requires deciding whether AgentDB's primary should remain SQLite or migrate to RuVector.
* **Scope discipline.** Wiring `UnifiedDatabase` into `AgentDB.initialize()` is a substantial architectural change touching the agentdb fork, the agentic-flow vendored copy (ADR-0160 parallel-extraction context), and ruflo's adapter. Conversely, updating the docstring to reflect delivered reality is trivial. The right call depends on whether the dual-storage pattern is permanent posture or transitional debt.
* **`project-rvf-primary` rule (memory).** Per the project's canonical memory: *"RVF is primary; SQLite fallback only; never add new SQLite-first code paths."* AgentDB's SQLite-first architecture is the largest extant violation of this rule in the fork. It existed before the rule was articulated; addressing it requires either acknowledging the exception explicitly or migrating AgentDB onto RVF.

## Considered Options

* **Option A — Wire UnifiedDatabase into AgentDB.initialize().** Make `vectorBackend: 'rvf'` actually use RuVector as primary. Substantial change touching:
  - `forks/agentdb/src/core/AgentDB.ts:117-128` — remove the SQLite hard-wire; conditionally route through `UnifiedDatabase` based on resolved vectorBackend.
  - `forks/agentdb/src/db-unified.ts:37-141` — verify the class is functionally complete; likely needs implementation work since it's been uncalled.
  - `forks/agentdb/src/core/AgentDB.ts:144-153` — schema management on RVF (AgentDB schemas are SQL DDL today; RuVector is K-V + vector). Either translate schemas to RuVector primitives or keep a SQLite shadow for schema enforcement.
  - `forks/ruflo/v3/@claude-flow/memory/src/agentdb-adapter.ts` — adapter behavior may shift if `this.db` is no longer a SQLite handle.
  - All `agentdb_*` MCP tools that read/write rows — query semantics differ between SQLite (SQL) and RuVector (vector + key/value). Likely need a translation layer.
  - Estimated scope: ~500–1500 LoC across forks/agentdb + forks/ruflo, plus migration tooling for existing `.swarm/memory.db` files. Spans the full ADR-0160 parallel-extraction surface.

* **Option B — Update db-unified.ts docstring to delivered reality.** Trivial cleanup. Document explicitly that:
  - AgentDB's primary persistence is SQLite (better-sqlite3 / sql.js fallback).
  - `vectorBackend` config selects vector-search axis only.
  - `UnifiedDatabase` is a separate class for future RuVector-primary scenarios; not currently wired.
  - The dual-storage pattern (RVF via `memory_*` + SQLite via `agentdb_*`) is intentional.
  Estimated scope: 1 file, ~20 LoC. Plus a project-memory entry capturing the dual-storage pattern so future investigations skip the misdiagnosis cycle.

* **Option C — Hybrid: minimum-viable Unified primary path.** Keep SQLite for AgentDB schema enforcement (`db.exec(schema.sql)` is load-bearing for the controllers' table semantics). But add a parallel RuVector index that mirrors `(rowId, embedding)` so `agentdb_*` semantic searches can hit RuVector instead of SQLite vector-table joins. Smaller than A but doesn't fully unify storage; partial gain.

* **Option D — Decommission `agentdb_*` MCP tools as a parallel surface.** Migrate their functionality into `memory_*` (which uses RVF). The b5 controllers (reflexion, skill-library, etc.) become thin wrappers over `memory_*` operations with namespace conventions for the controller-specific semantics. Largest scope, biggest payoff: collapses the dual-storage to single-storage. Likely incompatible with AgentDB's external-tool surface (other consumers depend on `agentdb_*` semantics).

## Decision Outcome

**Pending.** This ADR records the architectural question without picking. The dual-storage pattern is currently functioning correctly post-ADR-0165's fixes; the question is when (if ever) the gap becomes load-bearing enough to justify Option A or D's scope.

**Provisional posture** (until the parent thread decides):
- Adopt **Option B** as a no-cost interim — update `db-unified.ts:5` docstring to reflect delivered reality, add a project-memory entry. Removes the diagnostic-blind-spot risk for future investigations.
- Defer **Option A / C / D** until a concrete need emerges (e.g., ADR-0164's Phase B closure exposes a specific dual-storage friction, or a user-facing feature requires unified semantics).

## Triggers for re-evaluation

This ADR moves to a real decision when one of:

1. **ADR-0164 Phase B closure surfaces a dual-storage friction** that Option A would address. (Currently Phase B doesn't touch agentdb; if it grows to, this ADR activates.)
2. **A user-facing feature requires unified vector-store semantics** across `memory_*` and `agentdb_*`. E.g., cross-namespace semantic search that wants to query both surfaces atomically.
3. **The dual-storage cognitive-load cost exceeds the migration cost.** Hard to quantify; tracked by counting investigation-cycles spent re-deriving the dual-storage pattern. ADR-0165's swarm spent ~3 agent-hours on this confusion; if that pattern repeats in 2–3 more investigations, the cost case for Option A grows.
4. **AgentDB's published `db-unified.ts` "PRIMARY: RuVector" docstring becomes a user-facing promise** (e.g., a third-party integration relies on it). Today it's internal aspiration; that's not currently true but could change.
5. **The agentdb fork's parallel maintenance (per ADR-0160) closes the gap upstream**, removing fork burden.

## Out of scope (deliberate)

1. **AgentDB schema migration**. AgentDB's controller schemas (episodes, skills, reasoning_patterns, causal_edges, etc.) are SQL DDL. Migrating them to RuVector primitives is non-trivial and not addressed here.
2. **Existing `.swarm/memory.db` data migration**. If Option A is later picked, existing SQLite data needs to migrate to RuVector. That migration tool design lives in a separate ADR.
3. **`memory_*` <-> `agentdb_*` semantic unification**. Even under Option A, the two MCP tool surfaces have distinct semantics (key/value memory vs structured controllers). Unifying the surfaces is a separate ADR (Option D's scope).
4. **The ADR-0160/0161 parallel-extraction strategy.** AgentDB exists in two places (ruvnet/agentdb new + agentic-flow vendored). This ADR is about the agentdb-internal architecture, not the cross-fork extraction strategy.

## Open questions

1. Is there a programmatic way to detect AgentDB → SQLite hard-wire from outside the codebase, so docstring drift gets caught automatically? (E.g., a unit test that asserts `core/AgentDB.ts` does NOT import `db-unified.ts` if `db-unified.ts` advertises RuVector PRIMARY.)
2. Was `UnifiedDatabase` ever functional, or has it always been a parallel-class that nobody imported? Git archaeology could clarify whether this is "decommissioned legacy" or "future code that never got wired".
3. If Option B is taken, where should the dual-storage pattern be documented for discoverability? Candidates: `project-rvf-primary.md` memory entry (add caveat), `forks/agentdb/README.md` (architectural posture), `CLAUDE.md` `Project Architecture` section.
4. Does the ADR-0160 `agentdb extraction is parallel, not migratory` framing (per session memory) apply here? If the new ruvnet/agentdb fork (5th fork) has different defaults than the agentic-flow vendored copy, the right Option may already exist upstream.

## More information

* **Investigation source**: `/tmp/adr0165-investigation/AUDIT.md` — the architectural finding that prompted this ADR.
* **Source citations**:
  - `forks/agentdb/src/db-unified.ts:5` — the aspirational docstring
  - `forks/agentdb/src/db-unified.ts:37-141` — the unused UnifiedDatabase class
  - `forks/agentdb/src/core/AgentDB.ts:117-128` — the SQLite hard-wire
  - `forks/agentdb/src/core/AgentDB.ts:82` — the vectorBackend field
  - `forks/agentdb/src/core/AgentDB.ts:173-192` — vectorBackend resolution (vector-axis only)
  - `forks/agentdb/src/wasm-loader.ts:134-152` — both backends exported but only one wired
* **Memory entries with implications**:
  - `project-rvf-primary` — the rule that the dual-storage pattern violates
  - `Op A: vectorBackend 'auto' → 'rvf'` — describes the resolution of `'auto'` for the vector-search axis (not primary)
* **Related ADRs**:
  - ADR-0154 — RVF storage unification (memory_* path; out of scope for this ADR)
  - ADR-0160 — AgentDB extraction is parallel, not migratory (architectural framing)
  - ADR-0161 — Consolidate agentdb onto fifth fork (cross-fork strategy)
  - ADR-0162 — Upstream fork sync (sync that exposed the silent-fallback ADR-0165 fixed)
  - ADR-0163 — t3-2-concurrent regression (closed; sister ADR is ADR-0165)
  - ADR-0165 — AgentDB backend-resolution + residual cluster (pending verification; surfaced this gap)

## Recommendation

**Take Option B today.** Cost: ~20 LoC docstring update + 1 project-memory entry. Benefit: removes diagnostic blind spot; future investigations don't repeat the misdiagnosis cycle. Defer Options A/C/D until a trigger above fires.

The parent thread can request Option A/C/D at any time via an amendment to this ADR; until then, ADR-0166 sits as discussion-status documentation of the gap.

## Amendments

(none yet — this section will receive a decision when the parent thread picks an option, or further trigger evidence when one of §"Triggers for re-evaluation" fires)
