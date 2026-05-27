---
status: accepted
completed: true
date: 2026-05-25
revised: 2026-05-27
ratified: 2026-05-27
implemented: 2026-05-27
tags: [upstream-sync, graph-intelligence, ADR-130, re-implementation, archivist, embeddings]
supersedes: []
depends-on: [ADR-0117, ADR-0147, ADR-0166, ADR-0177, ADR-0181, ADR-0202, ADR-0221, ADR-0227, ADR-0246, ADR-0253, ADR-0254]
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
7. Witness chain mismatch — upstream's temporal-decay uses `verification/witness-fixes.json` (an Ed25519-signed per-edge witness path). Fork has a file named `forks/ruflo/witness-fixes.json` but with a **completely different semantic**: it is a build-time fix-registry for `scripts/regen-witness.mjs` manifest regeneration, not per-edge signing material. The per-edge Ed25519 path upstream relies on does not exist in the fork. Fork's witness IDs map to the archivist's audit-chain entry id instead (see §Revision 1 for council-verified correction).

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
- The fork's `causal_edges` shape is controller-id space with a closed `from_memory_type` enum `'episode'|'skill'|'note'|'fact'` (per ADR-0147 R7) — extending to memory-entry-row space requires either widening the enum (cascading change to `CausalMemoryGraph.addCausalEdge` numeric-id validators) or adding a join table. The schema impedance is the real cost, not row size.
- ~~Embedding storage isn't part of causal_edges today; adding 784B/edge PQ payload to causal_edges grows that table's row size 50× (current rows are ~12 bytes; adding PQ pushes them to ~800 bytes).~~ **Council correction (§Revision 1):** causal_edges is 19 columns including JSON arrays — real rows average 150–300B. A 784B payload column is ~3–5× growth, not 50×. Rejection of Option B stands on schema-impedance grounds (above bullet), not row size.

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

This ADR is **proposed**. Ratification + implementation are separate steps. Once ratified, the implementation ADR (this one amended to `accepted` + `implemented`) covers (post-§Revision 2 file list — port U3 with invariant-mandated transforms only; no fork-preference decoration):

* New handler at `forks/agentdb/src/archivist/handlers/agentdb/graph-edge.ts` (mirror `causal-edge.ts` shape); internal `_save` action invoked by hooks via `dispatch('agentdb_graph_edge', {action:'save', ...})` — same effective shape as upstream's `insertGraphEdge`, routed through archivist instead of a private function with a module-scope cache
* New invariants at `forks/agentdb/src/archivist/invariants/agentdb/graph-edge.ts`
* New schema at `forks/agentdb/src/schemas/graph-edges.sql` — DDL mirrors upstream's `MEMORY_SCHEMA_V3` column list (`id`, `source_id`, `target_id`, `relation`, `weight`, `confidence`, `decay_rate`, `last_reinforced`, `witness_id`, `embedding_ref`, `metadata`, `created_at`) plus FK from `source_id`/`target_id` to `memory_entries(id)` and the 4 upstream indexes
* **Scalar int8 encoder** at `forks/agentdb/src/encoders/scalar-int8-encoder.ts` — model-agnostic; reads embedding dim from config-chain (`forks/agentdb/src/core/config-chain.ts`); payload size `= 4B header + 8B (min/max float32) + configuredDim B` (dynamic). For mpnet-768 = 780B; if config swaps model, encoder adapts. No hardcoded dim, no codebook
* Substrate-registry extension: add `agentdb_graph_edge` to `SQLITE_CARVE_OUT_STORE_IDS` at `forks/agentdb/src/archivist/substrate-registry.ts`
* Dispatch-types extension: add `agentdb_graph_edge` entry to `ToolPayloadMap` at `forks/agentdb/src/archivist/dispatch-types.ts`
* Per-op substrate acquisition via `staging-substrate.ts::withWrite`
* **2 MCP read tools (mirror upstream)**: `agentdb_graph-query` (modes: `k-hop` | `pagerank` | `semantic` — matches upstream's `agentdb-tools.ts:888`) and `agentdb_graph-pathfinder` (6 algorithms verbatim from upstream's `agentdb-tools.ts:1171` — `temporal-centrality`, `witness-chain-divergence`, plus the 4 remaining). Read-only; acquire substrate per query
* **2 hook writers via internal dispatch** (no separate MCP save tool): `hooks_intelligence_trajectory-step` → `dispatch({action:'save', relation:'trajectory-caused'})`; `hooks_post-task` on `success=true` → `dispatch({action:'save', relation:'reinforced-by'})`. Both go through the archivist handler; no private write path
* **Sweep is a background worker, NOT an MCP tool** — `forks/agentdb/src/workers/graph-edge-sweep.ts` running on nightly schedule; `maxAgeDays` configurable via config-chain (default 90). Matches upstream's "no explicit sweep MCP tool" shape (upstream relies on decay-to-zero scoring); the worker is fork's addition to avoid unbounded growth without exposing it as a caller surface
* **Plugin adapter (P4 deliverable from upstream)**: `forks/ruflo/plugins/ruflo-knowledge-graph/src/adapters/knowledge-graph-adapter.ts` — port upstream's `GraphEdgesSource` class (73 LOC at `plugins/ruflo-graph-intelligence/src/adapters/knowledge-graph-adapter.ts` upstream). Add `graph_adapter` field to the fork plugin's `plugin.json` declaring this source. **Note**: upstream's plugin is `ruflo-graph-intelligence` (ADR-123); fork only has `ruflo-knowledge-graph` — mapping needs verification at implementation time. If fork is missing `ruflo-graph-intelligence` entirely, that's a separate upstream-port to do alongside ADR-0261.
* **Schema loader extension** (REQUIRED — caught in completeness audit): the schema loader is **hardcoded** at `forks/agentdb/src/cli/commands/init.ts:110` (`['schema.sql', 'frontier-schema.sql']`) AND `forks/agentdb/src/core/AgentDB.ts:210-216` (two explicit `schemaPath` reads). Without extension, `graph-edges.sql` is **not picked up at init**. Edit both callsites to add `'graph-edges.sql'`. Acceptance test: smoke-graph-schema-migration verifies the table exists after `agentdb_init`.
* **5 granular smokes** (P1–P5 parity with upstream):
    - `scripts/smoke-graph-schema-migration.mjs` (P1: table + indexes exist after init)
    - `scripts/smoke-graph-query-dispatch.mjs` (P2: `agentdb_graph-query` returns k-hop/pagerank/semantic for golden input)
    - `scripts/smoke-trajectory-graph-edges.mjs` (P3: hooks_intelligence_trajectory-step + hooks_post-task write expected rows)
    - `scripts/smoke-graph-plugin-adapter.mjs` (P4: GraphEdgesSource exposes graph_edges to the plugin)
    - `scripts/smoke-graph-pathfinder.mjs` (P5: all 6 pathfinder algorithms return expected rankings)
* **Benchmark** (P6 parity): `scripts/benchmark-graph.mjs` — same targets as upstream (2345 writes/sec, ≤780B/edge for mpnet-768, k-hop depth=1 p99 ≤5ms). Reuses upstream's golden-input shape so the bench numbers are comparable.
* Unit tests at `forks/agentdb/tests/handlers/graph-edge.test.ts` AND `forks/agentdb/tests/workers/graph-edge-sweep.test.ts` (sweep worker has its own test set covering: rows under threshold survive; rows over threshold are dropped; errors propagate; no lifetime lock held per ADR-0202 / ADR-0253 C2)
* **Hook wire-up paths**: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts` (upstream edits this +39 lines for the trajectory + post-task hooks) AND `forks/agentdb/src/archivist/handlers/intelligence/trajectory-step.ts` / `post-task.ts` (fork-side equivalents) — needs verification at implementation which side carries the wire (probably both: cli wires the MCP-callable hook, agentdb handler wires the archivist-side producer)
* Lint extension at `scripts/lint-no-daemon-lock-cache.mjs` (extend `TARGET_FILE` to include the new handler AND the sweep worker)
* Codemod WONT_MERGE guard at `scripts/codemod.mjs` for upstream's `graph-edge-writer.ts`
* **CI job stanza** matching upstream's 5 jobs in `.github/workflows/v3-ci.yml` (one per smoke; gated parallel; failure-aggregating per ADR-0245)
* **SKILL.md update** at `forks/ruflo/plugins/ruflo-plugin-creator/skills/create-plugin/SKILL.md` — port upstream's 12-line addition documenting the new `graph_adapter` plugin.json field, so plugin authors creating graph-aware plugins can find the wire-up instructions
* INTEGRATION-LEDGER row 234 disposition flip: `deferred` → `reimplemented-via-adr-0261`

**Not part of this ADR's deliverables** (touched by upstream PR `edde98f9e` but mechanically auto-handled by the fork release pipeline):

* `verification/macos/manifest.md.json` + `history.jsonl` — auto-regenerated by the fork release pipeline (`scripts/regen-witness.mjs`); included in the upstream PR diff because their commit-then-witness flow happens to land them together. Fork's release pipeline handles them automatically; no separate ADR action.
* Three `package.json` version bumps — automatic via fork's release pipeline.

## Risks

| Risk | Mitigation |
|---|---|
| Quantized payload makes the graph_edges table grow fast (per-edge size = `12 + configuredDim` bytes per §Revision 2.3 — 780B for current mpnet-768 config) | Internal background sweep worker (`graph-edge-sweep.ts`) on nightly schedule hard-drops rows whose `(now - last_reinforced_at) > maxAgeDays * 86400`. `maxAgeDays` configurable via config-chain `graphEdges.sweep.maxAgeDays` (default 90). **No MCP sweep tool** — matches upstream's surface shape per §Revision 2.2. |
| coexist (A1) creates UI confusion ("which table do I query?") | The `causal_edges` and `graph_edges` MCP tools are distinct (`agentdb_causal-edge` vs `agentdb_graph-edge`) — the naming alone disambiguates. README in agentdb package documents the split. |
| archivist audit-chain id (A-W1) doesn't have a stable serialization that survives store rebuilds | Verify before implementation: `archivist.dispatch(...)` already returns an audit-chain id today (per [[ADR-0181]] Phase C); that id IS stable. If not, fall back to A-W2 (no witness column). |
| mpnet-768 encoder is slow for high-volume edge writes | Batch encoder calls — caller pushes N edges in one MCP call, encoder runs scalar int8 quantization (per §Revision 1.5) once over the batch. Default batch size 64. |
| Existing upstream `graph-edge-writer.ts` pattern leaks into the fork via a future verbatim merge | Add an explicit "WONT_MERGE" guard in `scripts/codemod.mjs` (similar to `DELETE_FILES`) for `graph-edge-writer.ts`. Re-implementation criterion #1 (no module-scope cache) is policy-only today per [[ADR-0254]] Revision 2; this codemod entry makes it enforced-at-pipeline. **§Revision 1 amendment:** also extend `scripts/lint-no-daemon-lock-cache.mjs` `TARGET_FILE` to cover the new handler, closing the policy-vs-lint gap honestly. |
| **8th criterion — cross-installation federation stability of `witness_id`** (§Revision 1, devil's-advocate critique) | A-W1's archivist audit-chain id is stable across substrate rebuilds but NOT guaranteed stable across installations. If `graph_edges` rows ever participate in federation/sync (per ADR-0117 marketplace MCP-server registration, ADR-0221 federation-peer scenarios), the witness column needs cross-installation determinism. Mitigation: derive `witness_id = sha256(installation_id ‖ audit_chain_entry_id).slice(0,16)`. Federation wire-up itself deferred to a sibling implementation ADR; this ADR commits to the stable-derivation shape so federation isn't blocked later. |
| Upstream's `decay_rate` column is schema-reserved but dead — the JS scoring path uses a hardcoded `0.1` (per §Revision 1 archeology). Fork must avoid the same trap. | Fork's decay must read `decay_rate` from the column and use it in `Math.exp(-decay_rate * daysSince) * confidence * weight`. Smoke step 6 asserts the formula reads the column. |
| Upstream's `witness_id` column is schema-reserved but never populated (§Revision 1 archeology). Inheriting that shape would be silent regression. | Fork's `_save` handler MUST populate `witness_id = ctx.auditChainEntryId` synchronously in the same SAVEPOINT as the row insert; rollback test asserts no orphan row + no orphan audit-chain entry. |

## Cross-references

* [[ADR-0254]] — upstream ADR-129/130 disposition. ADR-130 deferred with the 7-criteria checklist this ADR satisfies.
* [[ADR-0177]] — RVF-primary substrate. Constrains where graph_edges schema lives (forks/agentdb/src/schemas/, not v3/cli/memory/).
* [[ADR-0181]] — archivist seam discipline. Mandates routeMemoryOp for all writes.
* [[ADR-0202]] — no module-scope substrate handle cache. Bans the upstream `let _db = null` pattern.
* [[ADR-0227]] — adaptive-floor 0.3→0.15 tuned for mpnet. Locks the embedding model choice.
* [[ADR-0246]] — staging-substrate seam. Mandates per-op acquire/release.
* [[ADR-0253]] — substrate carve-outs (daemon Archivist FS-JSON; RVF-lock-holding workers). Documents the prior carve-outs this ADR's design avoids.
* `forks/ruflo/witness-fixes.json` (1025B) — build-time fix-registry for `scripts/regen-witness.mjs`. Cited by §Revision 1.1 to clarify why our same-named file is NOT upstream's per-edge Ed25519 signing path; no formal ADR documents its inception.
* [[ADR-0117]] — marketplace MCP-server registration and federation surface. Cited by §Revision 1.4 — federation stability of `witness_id` defers actual wire-up here.
* [[ADR-0147]] — causal_edges controller-id-space contract (R7 string-vs-numeric-id gap). Cited by §Revision 1.2 — the schema-impedance rejection of Option B.
* [[ADR-0166]] — shared better-sqlite3 handle per controller. Justifies SQLite-carve-out classification of `agentdb_graph_edge` (FK to `memory_entries` requires shared handle).
* [[ADR-0221]] — GraphDatabaseAdapter corrupt-db error surfacing. Documents the existing-but-stubbed graph-property surface that `graph_edges` does NOT replace.
* `[[reference-embedding-model]]` — mpnet-768 canonical choice. Locks criterion #4.
* `[[feedback-best-effort-must-rethrow-fatals]]` — corpus rule informing criterion #6 (no fire-and-forget).
* `[[feedback-no-fallbacks]]` — informs the rejection of fire-and-forget patterns.
* `[[feedback-corpus-evidence-before-feature-work]]` — informed the §Revision 1.3 consumer-naming requirement.
* `[[feedback-remediation-adr-preflight]]` — the 3+1 preflight that surfaced the false-premise and missing-consumer in §Revision 1.
* Upstream PR `edde98f9e` (SHA `edde98f9eb2897da6d2dbb83e9d0b547a1c40cc7`, PR #2129, 2026-05-24) — the verbatim implementation this ADR replaces with a fork-native equivalent. Council archeology (§Revision 1) verified upstream's actually-shipped encoder is **global-scalar int8**, not product quantization; `decay_rate` column is dead (hardcoded 0.1 in JS); `witness_id` column is never populated.

## Confirmation

This ADR is proposed-only. To advance:

0. **Name the consumer** (§Revision 1, devil's-advocate critique). The fork-side consumers for `graph_edges` are: (a) `hooks_intelligence_trajectory-step` writes `trajectory-caused` edges between successive memory_entries rows in a trajectory; (b) `hooks_post-task` on `success=true` writes `reinforced-by` edges from the task's output memory_entry back to retrieved-context memory_entries. Both consumers exist in the fork today but currently land their signals in RVF, not in a graph store — this ADR's `graph_edges` table is the targeted landing site. Implementation MUST wire both hooks to the new `agentdb_graph-edge_save` dispatch path; otherwise the feature is shelfware.
1. **Council review** of the design (Option A + A1 + A-W1) — **completed 2026-05-26, see §Revision 1**. Three load-bearing corrections applied (premise #7 framing, Option B baseline, missing consumer); one 8th criterion added (federation stability); design surface reduced from 6 MCP tools to 3 tools + 2 hook consumers; encoder downgraded from product-quantization to global-scalar int8 to match upstream's actually-shipped encoding.
2. **Ratification** flips status `proposed` → `accepted`. **Ratified 2026-05-27** after §Revision 1 council corrections + §Revision 2 port-to-upstream alignment + §Revision 2.9 plugin-mapping resolution.
3. **Implementation** is a separate ADR amendment (status → `implemented`, with the named files + tests + smoke + CI job in place).
4. **Re-implementation criteria audit** at end of implementation: each of the **8** criteria has a passing acceptance test verifying its compliance (7 from ADR-0254 + 1 federation-stability added in §Revision 1).
5. **Sibling-ADR slot for layer-3+4 cleanup** (§Revision 1.8). Out of scope of this ADR — bookmarked as `ADR-0264 — Retire @ruvector/graph-node MCP veneer or finish the Rust executor`. Does NOT block ratification of ADR-0261; tracked so the 5-surface state has a planned reduction path.

Until step 4 completes, ADR-130 stays deferred in the ledger.

## Revision 1 — Council ratification corrections (2026-05-26)

A 5-expert council was convened on the proposed design: upstream-implementation archeologist, fork-invariants steward, existing-graph-DB cartographer, schema+encoder engineer, devil's-advocate. The following corrections derive from their evidence and supersede the corresponding claims in the original body.

### 1.1 Premise #7 (witness file) — clarified, not invalidated

**Original framing:** "fork doesn't have `verification/witness-fixes.json`."

**Corrected framing:** the fork has a file *named* `witness-fixes.json` at `forks/ruflo/witness-fixes.json` (1025B), but its semantic is unrelated — it is a build-time fix-registry for `scripts/regen-witness.mjs` to regenerate the build artifact manifest (`verification/macos/manifest.md.json`-equivalent). It carries no per-edge Ed25519 signing material. Upstream's per-edge `verification/witness-fixes.json` (Ed25519-signed witness payload per graph-edge row) does NOT exist in the fork in any form. A-W1 (archivist audit-chain ids) remains the correct choice; A-W3 (Ed25519 borrow) remains rejected because the fork has no per-edge signing pipeline, only a build-time manifest-signing one.

### 1.2 Option B "50× row growth" — wrong baseline; rejection stands on schema-impedance grounds

**Original cons #3:** "current rows are ~12 bytes; adding PQ pushes them to ~800 bytes" (50× growth).

**Corrected:** `causal_edges` DDL at `forks/agentdb/src/schemas/frontier-schema.sql:14-44` is 19 columns including `evidence_ids` (JSON array), `experiment_ids` (JSON array), `mechanism` TEXT, `metadata` JSON, plus 6 REAL + 6 INTEGER cols. Real rows average 150–300B. Adding a 784B PQ payload column is ~3–5× growth, not 50×. The honest rejection of Option B is **schema impedance**: `causal_edges.from_memory_type` is a closed enum `'episode'|'skill'|'note'|'fact'` (controller-id-space); `graph_edges` operates in memory-entry-row-space (FK to `memory_entries.id`). Widening the enum cascades into `CausalMemoryGraph.addCausalEdge` numeric-id validators (ADR-0147 R7 territory). The two-table split (A1) is correct; the original numeric justification was not.

### 1.3 Signal-reaches-audience — explicit consumer named

**Original framing:** "graph that forgets" + reinforced-edge retrieval is a real feature gap.

**Corrected:** the gap is real but the consumer was unnamed. **Council audit:** zero greps in `forks/agentdb` for `trajectory-caused` / `reinforced-by`. The original ADR risked shelfware. §Confirmation step 0 (added in this revision) names two concrete consumers — `hooks_intelligence_trajectory-step` and `hooks_post-task` — and mandates wiring them to the new dispatch path as part of implementation, not as a follow-up. Without those two hooks landing in the same PR as the schema, the design's "graph that forgets" semantic has no producer in the fork.

### 1.4 8th criterion — cross-installation federation stability of `witness_id`

**New constraint** (devil's-advocate critique). A-W1's audit-chain entry id is stable across substrate rebuilds (the only scenario the original §Risks row addressed) but NOT across installations. If `graph_edges` ever participates in federation/sync surfaces (ADR-0117 marketplace MCP, ADR-0221 federation-peer scenarios), the witness column needs cross-installation determinism. **Mitigation locked into this design:** `witness_id = sha256(installation_id ‖ audit_chain_entry_id).slice(0,16)`. Federation wire-up itself defers to a sibling implementation ADR; this revision commits to the stable-derivation shape now so federation isn't blocked later.

### 1.5 Encoder downgrade: product-quantization → global-scalar int8

**Original §Decision Outcome:** "mpnet-768 PQ encoder thread."

**Corrected:** upstream PR `edde98f9e` does NOT implement product quantization despite the name `embedding-quantization.ts`. The actual upstream encoder is **global-scalar int8**: single global min/max per vector, no subspaces, no centroids, no codebook. For 384-dim: 4B magic + 4B dims + 4B min + 4B max + 384B int8 codes = exactly 400B. For fork's 768-dim mpnet: 4B header + 8B (min/max float32) + 768B int8 codes = 780B (within the 784B budget, padded to 784B fixed-width for forward-compat). True product quantization would require an offline-trained codebook (256 centroids × 96 subspaces × 8 float16 = 4096B codebook file) and introduces first-write nondeterminism — neither warranted by upstream's actually-shipped capability nor by any fork-side need. Encoder file rename: `mpnet768-pq.ts` → `mpnet768-scalar-int8.ts`.

### 1.6 MCP tool surface reduction: 6 → 3 explicit + 2 hook consumers

**Original §Decision Outcome:** "`loadEdge`/`saveEdge`/`queryByMemoryRow`/`reinforce`/`decay`/`sweep` MCP tools (~6 tools)."

**Corrected:** upstream PR ships 2 read tools (`agentdb_graph-query`, `agentdb_graph-pathfinder`) with all writes hook-implicit through the offending `graph-edge-writer.ts` private function (which is the source of upstream's criterion-#1 violation). Fork's right shape is 3 explicit MCP tools + 2 named hook consumers — all going through the same archivist dispatch:

* `agentdb_graph-edge_save` — upsert with reinforce-on-conflict (`ON CONFLICT(src,dst,relation) DO UPDATE SET confidence=excluded.confidence, last_reinforced_at=strftime('%s','now'), reinforcement_count=reinforcement_count+1`). Subsumes `saveEdge` + `reinforce` (they're the same SQL).
* `agentdb_graph-edge_query` — modes: `load-by-id` | `by-row` | `decay-scored` | `k-hop`. Subsumes `loadEdge` + `queryByMemoryRow` + `decay` (each is a `_query` mode).
* `agentdb_graph-edge_sweep` — admin GC, default `maxAgeDays=90`. `DELETE WHERE (strftime('%s','now') - last_reinforced_at) > maxAgeDays*86400`.
* **Hook consumer (a)** — `hooks_intelligence_trajectory-step` calls `dispatch('agentdb_graph_edge', {action:'save', relation:'trajectory-caused', ...})` between successive trajectory memory_entries.
* **Hook consumer (b)** — `hooks_post-task` on `success=true` calls `dispatch('agentdb_graph_edge', {action:'save', relation:'reinforced-by', ...})` from output memory to retrieved-context memories.

No private write path; every write traces to the same handler; criterion #1 satisfied not only by policy but by surface design.

### 1.7 Acceptance tests tied to all 8 criteria

| Criterion | Test | Method |
|---|---|---|
| C1 — no module-scope cache | source-grep `^(let\|var\|const) _\w+\s*=` in `graph-edge.ts` → 0 hits | source-grep + extended lint |
| C2 — substrate routing | `grep -E 'fs\.writeFileSync\|new (better-sqlite3\|Database)\(' graph-edge.ts` → 0; `ctx.substrate.withWrite` used exclusively | source-grep |
| C3 — ADR-0202 policy compliance | extended `scripts/lint-no-daemon-lock-cache.mjs` passes against new handler | lint |
| C4 — mpnet-768 + 784B budget | smoke step 3 asserts `pq_payload.length ≤ 784`; embedding round-trip cosine vs `embeddings_compare` > 0.85 for related edges | runtime |
| C5 — `causal_edges` coexists | existing `agentdb_causal-edge_*` smokes pass unchanged; new `agentdb_graph-edge_*` smokes pass | existing+new |
| C6 — no fire-and-forget | source-grep `catch.*\{[^}]*return (false\|null\|0\|\[\])` in handler → 0 hits; induced EIO surfaces to caller as throw | grep + runtime |
| C7 — witness chain | `witness_id = sha256(installation_id ‖ ctx.auditChainEntryId).slice(0,16)`; forced-invariant-rollback test → no orphan row, no orphan audit-chain entry | runtime |
| C8 — federation stability (NEW) | `witness_id` is deterministic across simulated installation-id restart; cross-installation merge dry-run does not duplicate witness columns | runtime |

### 1.8 Graph layer landscape — 5-surface audit and cleanup recommendation

Post-ratification, the fork carries **five coexisting graph-shaped surfaces**. The original body's §"Decision Outcome" framed this as an A1-coexist tradeoff already accepted, but did not enumerate the full landscape or audit which surfaces are live vs aspirational. The council finding records the complete picture here so the next architectural pass starts with the audit done.

#### Per-layer provenance

| Layer | First introduced | ADR provenance | Unique value (no other layer provides) | Status |
|---|---|---|---|---|
| 1. `causal_edges` | Initial agentdb (`8b3388b`); formally handler-routed in ADR-0181 Item 3 (`5d1b122` "CausalGraphWriter"); refined per ADR-0147 | [[ADR-0147]] (controller-id-space contract), [[ADR-0181]] (archivist seam) | **Causal inference math** — counterfactual reasoning via `uplift`, `confounder_score`, `sample_size`, `evidence_ids`, `experiment_ids`, `mechanism`. Closed enum `from_memory_type ∈ {episode\|skill\|note\|fact}` | live |
| 2. `exp_nodes` / `exp_edges` / `exp_node_embeddings` | Initial agentdb (`8b3388b`); predates explicit ADR organization | (no fork-side ADR — initial schema) | **GraphRAG-style multi-hop retrieval** with centrality-weighted experience nodes. Schema is experience-shaped: `kind`, `label`, `payload JSON`, `centrality`. Node-first model | live |
| 3. `@ruvector/graph-node` via `GraphDatabaseAdapter` | Upstream's ADR-086/087 (commit `7eb505d22` "native ruvllm + graph-node intelligence backends"); fork pulled it in; [[ADR-0173]] attempted to choose between Apache AGE on PG-server and this engine; [[ADR-0174]] declared RuVector the "third persistence axis"; [[ADR-0221]] surfaces corrupt-db errors honestly | [[ADR-0173]] / [[ADR-0174]] / [[ADR-0221]] | **Universal property-graph + Cypher** — intended as the single graph DB for everything | OFF-by-default; **underlying Rust executor in `@ruvector/graph-node` is `Vec::new()`** — returns empty results; WHERE eval broken; DELETE/SET/WITH stubbed (per cartographer audit) |
| 4. `agentdb_graph_node_create` / `agentdb_graph_edge_create` MCP tools | Same lineage as layer 3 (cli-side veneer at `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts:811-916`) | (same as 3) | None of its own — pure MCP wrapper. Writes `new Float32Array(0)` empty embeddings into the stubbed executor | wired-but-disabled (short-circuits when `controllers.graphAdapter=false`, which is the default) |
| **5.** **`graph_edges`** (this ADR) | **proposed 2026-05-25; council-amended 2026-05-26** | **ADR-0261** | **Reinforcement-decay retrieval** ("graph that forgets"). Memory-entry-row-space via `memory_entries.id` FK; archivist-routed with audit-chain witness; only layer with `confidence × exp(-decay_rate × Δt) × weight` semantics | **proposed** |

#### Capability overlap matrix

| Capability | causal_edges | exp_* | graph-node (stubbed) | graph_node MCP (broken veneer) | graph_edges (new) |
|---|---|---|---|---|---|
| Node identity | controller-id enum | internal `exp_nodes.id` int | string `"kind:uuid"` | string `"kind:uuid"` | `memory_entries.id` INTEGER FK |
| Edge carries embedding | no | yes (BLOB in `exp_node_embeddings`) | yes (Float32 native) | no (empty Float32Array) | yes (784B int8 BLOB) |
| Reinforcement-decay math | no | no | no | no | **only here** |
| Audit-chain routed | yes | no | no | no | yes |
| Causal-inference fields | **only here** | no | no | no | no |
| Node-first model | no | **only here** | yes (partial) | yes (partial) | no (edge-only) |
| Cypher language | no | no | yes (parser only — exec stub) | no | no |
| Actually functional today | yes | yes | **no — stub** | **no — stub** | (post-implementation) |

#### Council verdict (three findings)

1. **Three layers serve genuinely distinct purposes.** `causal_edges` (causal inference; uplift/confounder math), `exp_*` (GraphRAG with node centrality), `graph_edges` (reinforcement-decay retrieval). None subsumes the others; each addresses a capability the others cannot.
2. **Two layers are aspirational cruft.** `@ruvector/graph-node` was intended (upstream ADR-086/087; fork's [[ADR-0173]] / [[ADR-0174]]) as the universal graph DB. Years later its Rust executor is still `Vec::new()`. The cli-side MCP wrappers write empty embeddings into that stubbed executor. They cost nothing to keep but serve no traffic.
3. **The meaningful semantic overlap is `exp_*` vs `graph_edges`.** Both carry per-edge embeddings; both do similarity retrieval. The split (node-first GraphRAG vs edge-first memory-row reinforcement-decay) is defensible because the retrieval shapes are genuinely different — but a future pass should evaluate whether `exp_*` callers could reach `graph_edges`-shaped retrieval through a thin adapter rather than via a separate substrate.

#### Cleanup recommendation — sibling-ADR slot (out of ADR-0261 scope)

Layers 3+4 are the load-bearing complexity problem. Adding `graph_edges` raises net surface count from 4 → 5. Retiring layers 3+4 would lower it from 5 → 3. **Recommended follow-up: a sibling ADR (provisional slot `ADR-0264 — Retire @ruvector/graph-node MCP veneer or finish the Rust executor`)** offering two explicit paths:

- **Path α — Retire.** Drop `agentdb_graph_node_create` / `agentdb_graph_edge_create` from the cli MCP surface; uninstall `@ruvector/graph-node` from the controllers config; mark upstream-ADR-086/087 + fork [[ADR-0173]] / [[ADR-0174]] / [[ADR-0221]] as **superseded-by-removal**. Estimated surface: ~150 LOC + 4 ADR amendments + INTEGRATION-LEDGER row. Net post-ratification graph surfaces drop to 3 (causal_edges, exp_*, graph_edges).
- **Path β — Finish.** Complete the Rust executor in `@ruvector/graph-node` (WHERE evaluation, DELETE/SET/WITH); flip `controllers.graphAdapter` default to `true`; re-evaluate whether `graph_edges` (this ADR) should remain a separate substrate or migrate to a graph-node-backed view. Estimated surface: weeks of Rust work; separate ADR for the migration plan.

**This ADR (0261) is bounded to landing the new layer.** The cleanup decision is explicitly deferred to the ADR-0264-shaped follow-up. Documenting the landscape here ensures the next session does not re-discover the 5-surface state from scratch and can act on a complete audit.

### 1.9 Status after Revision 1

Status remains **`proposed`**. Awaiting user ratification of the §1.1–1.8 amendments. On ratification → status `accepted`, then implementation lands as a sibling ADR amendment per §Confirmation step 3. The §1.8 cleanup recommendation is tracked separately for a future ADR-0264-shaped follow-up and does NOT block ratification of this ADR.

## Revision 2 — Port-to-upstream alignment (2026-05-27)

User direction (2026-05-27): "port U3 to F3, do not consider the effort in designing the solution. We want the best architectural solution, and we want to match the direction upstream. Any embedding config or other config should come from the config chain."

§Revision 1 prioritized fork hygiene over upstream alignment. The §Revision 1.6 expansion (6→3 explicit MCP tools + 2 hook consumers) was honest "shape cleanup" but represented fork-preference, not invariant compliance. §Revision 2 reverts those decorations and re-aligns the design to **port U3 with invariant-mandated transforms only**.

### 2.1 MCP surface reverts to upstream's 2-tool shape

§Revision 1.6 is **superseded.** The fork ships the same 2 MCP tools as upstream:

- `agentdb_graph-query` — modes: `k-hop` | `pagerank` | `semantic`. Signature mirrors upstream `agentdb-tools.ts:888`.
- `agentdb_graph-pathfinder` — 6 algorithms (`temporal-centrality`, `witness-chain-divergence`, plus the 4 remaining upstream algorithms). Signature mirrors upstream `agentdb-tools.ts:1171`.

Hook writers (§Revision 1.3's named consumers) keep their semantic — `hooks_intelligence_trajectory-step` writes `trajectory-caused` edges; `hooks_post-task` on `success=true` writes `reinforced-by` edges — but they call `dispatch('agentdb_graph_edge', {action:'save', ...})` **internally**, not via a separate MCP tool. Same effective shape as upstream's hook-implicit writes through `insertGraphEdge`, just routed through the archivist instead of a private function with a module-scope cache.

Rationale: graph_edges writes are produced by trajectory observation, not by humans typing MCP commands. Exposing `_save` / `_reinforce` as MCP tools is decoration. The producer is well-typed (specific hooks, specific relation names) without needing a callable MCP surface.

### 2.2 Sweep moves from MCP tool to background worker

§Revision 1.6's `_sweep` MCP tool is **superseded.** Upstream has no sweep MCP tool; retention is implicit via decay-to-zero scoring (old edges fall below retrieval thresholds without being deleted). Fork follows the same shape but adds a **background worker** to prevent unbounded table growth:

- File: `forks/agentdb/src/workers/graph-edge-sweep.ts`
- Cadence: nightly (config-chain `graphEdges.sweep.cadence`, default `0 3 * * *`)
- Retention threshold: `maxAgeDays` (config-chain `graphEdges.sweep.maxAgeDays`, default 90)
- Lock-free per [[ADR-0202]] / [[ADR-0253]] C2 — uses per-tick substrate acquisition like the existing consolidation workers
- Not exposed as MCP tool; not callable from agents; purely operational

The §Risks table row 1 (table-growth risk) mitigation is updated in-place to reference this worker, not an MCP tool.

### 2.3 Embedding config from the config-chain (not hardcoded)

§Revision 1.5 named the encoder `mpnet768-scalar-int8.ts` with a hardcoded 768-dim and embedded the dim into the file name. **Superseded.** The encoder pulls all embedding configuration from the config-chain:

- **Encoder file rename**: `forks/agentdb/src/encoders/scalar-int8-encoder.ts` (model-agnostic; not pinned to any specific dim)
- **Reads at startup**: embedding dim from `config-chain.embeddings.dim` (currently 768 for mpnet); embedding model name from `config-chain.embeddings.model` (currently `Xenova/all-mpnet-base-v2`)
- **Payload size dynamic**: `4B header + 8B (min/max float32) + configuredDim B` — auto-adapts to any model the config-chain specifies
  - mpnet-768: 780B per edge (current fork)
  - MiniLM-384: 396B per edge (hypothetical revert)
  - Any future model: `12 + dim` bytes
- **784B figure** in §Decision Drivers / criterion #4 / §Risks is no longer a fixed budget — it's the worst-case ceiling for current mpnet-768 config. The on-disk row size is config-derived, not magic-number-derived.

Other config-chain pull-throughs the implementation MUST honor (no hardcoded constants):

- `config-chain.graphEdges.sweep.maxAgeDays` (default 90) — sweep threshold
- `config-chain.graphEdges.sweep.cadence` (default `0 3 * * *`) — sweep cron
- `config-chain.graphEdges.decay.defaultRate` (default 0.01) — default `decay_rate` for new edges if hook doesn't specify
- `config-chain.graphEdges.batchSize` (default 64) — encoder batch size

Implementation rule: **the new graph-edge code must contain zero hardcoded model names, dims, or numeric defaults** that aren't first sourced from config-chain. Acceptance test C4 (§2.6) verifies this by grep.

### 2.4 Algorithm parity with upstream

The 2 MCP read tools implement **all** upstream algorithms verbatim — not a subset:

| Tool | Algorithm / Mode | Match upstream? | Source |
|---|---|---|---|
| `agentdb_graph-query` | `k-hop` (recursive CTE over graph_edges) | yes | upstream `agentdb-tools.ts:888` |
| `agentdb_graph-query` | `pagerank` (simple personalized PageRank power-iteration in JS) | yes | upstream P2 |
| `agentdb_graph-query` | `semantic` (cosine on int8 codes via `inlineCosine`) | yes | upstream P2 |
| `agentdb_graph-pathfinder` | `temporal-centrality` (decay-weighted neighbor scoring) | yes — and fork USES the column instead of upstream's hardcoded 0.1 (correctness fix, not divergence) | upstream P5 |
| `agentdb_graph-pathfinder` | `witness-chain-divergence` | yes — and fork's `witness_id` is actually populated (per §1.4 / §1.7), unlike upstream's dead column | upstream P5 |
| `agentdb_graph-pathfinder` | remaining 4 algorithms | yes — port verbatim | upstream P5 |

Each algorithm is ~30–80 lines lifted from upstream, retargeted from sql.js + module cache to better-sqlite3 + per-query substrate acquisition. No fork-specific divergence in algorithm logic.

### 2.5 What stays from §Revision 1

| §R1 subsection | Status | Notes |
|---|---|---|
| 1.1 — witness-file premise clarified | **kept** | the path/semantic correction stands |
| 1.2 — Option B row-size correction | **kept** | reject-on-schema-impedance, not row size |
| 1.3 — hook consumers explicitly named | **kept** | consumers wire via internal dispatch per §2.1 |
| 1.4 — federation stability of `witness_id` | **kept** | `sha256(installation_id ‖ audit_chain_entry_id).slice(0,16)` |
| 1.5 — encoder is scalar int8, not PQ | **kept (refined)** | encoder also config-chain-parametric per §2.3 |
| 1.6 — 6 → 3 MCP tools | **superseded by §2.1** | fork mirrors upstream's 2-tool shape |
| 1.7 — acceptance test table | **superseded by §2.6** | updated to match new tool surface |
| 1.8 — 5-surface landscape audit | **kept** | independent of §Revision 2 |

### 2.6 Acceptance tests (revised for §2.1–2.4)

| Criterion | Test | Method |
|---|---|---|
| C1 — no module-scope cache | source-grep `^(let\|var\|const) _\w+\s*=` in handler + workers → 0 hits | source-grep + extended lint |
| C2 — substrate routing | handler `_save` uses `ctx.substrate.withWrite`; read tools acquire per-query | source-grep |
| C3 — ADR-0202 policy | extended `lint-no-daemon-lock-cache.mjs` passes against handler AND sweep worker | lint |
| C4 — **config-chain compliance** (NEW per §2.3) | source-grep in new files for hardcoded values: `\b(768\|384\|90\|0\.01\|64)\b` outside of test fixtures → 0 hits; `Xenova/` literal outside config-chain → 0 hits; encoder reads `config.embeddings.dim` at startup | source-grep + runtime |
| C5 — `causal_edges` coexists | existing `agentdb_causal-edge_*` smokes pass unchanged | existing |
| C6 — no fire-and-forget | source-grep `catch.*\{[^}]*return (false\|null\|0\|\[\])` → 0; induced EIO surfaces to caller as throw | grep + runtime |
| C7 — witness chain | `witness_id` populated; forced-rollback test → no orphan row, no orphan audit-chain entry | runtime |
| C8 — federation stability | `witness_id` deterministic across simulated installation-id restart | runtime |
| **Algorithm parity** (NEW per §2.4) | `agentdb_graph-query` + `agentdb_graph-pathfinder` return same shape/ranking as upstream's tools for a golden-input fixture across all 9 algorithm modes | golden-input smoke |
| **Sweep is background-only** (NEW per §2.2) | MCP tool list contains 2 graph-edge tools (query, pathfinder); no `_sweep` MCP tool registered; sweep worker file exists and runs on schedule | smoke + worker-list assertion |

### 2.7 Consumer comparison U3 vs F3 (post-§2.1 + §R2 completeness audit)

| Role | Upstream U3 | Fork F3 (per §R2) | Same / differs |
|---|---|---|---|
| WRITE producer #1 | `hooks_intelligence_trajectory-step` → writes `trajectory-caused` edges between successive trajectory memory rows (upstream P3) | same hook, same relation; calls `dispatch('agentdb_graph_edge', {action:'save', relation:'trajectory-caused'})` instead of `insertGraphEdge` directly | **same surface**; archivist-routed |
| WRITE producer #2 | `hooks_post-task` on `success=true` → writes `reinforced-by` edge from output memory back to retrieved-context memories (upstream P3) | same hook, same relation, same trigger; same dispatch routing | **same surface**; archivist-routed |
| READ adapter (plugin-side) | `GraphEdgesSource` class in `plugins/ruflo-graph-intelligence/src/adapters/knowledge-graph-adapter.ts` (+73 LOC, upstream P4) — exposes graph_edges to the plugin's read interface; `plugin.json` `graph_adapter` field declares this | **port to fork** at `forks/ruflo/plugins/ruflo-knowledge-graph/src/adapters/knowledge-graph-adapter.ts` (subject to fork-plugin-mapping verification — upstream's `ruflo-graph-intelligence` plugin may need separate porting if fork doesn't have it) | **same shape**; port pending |
| READ end-consumer (plugin) | `ruflo-graph-intelligence` plugin (upstream U2) reads via the adapter; graph_edges is one of its 5 wedges per ADR-123 | the fork-side plugin (likely `ruflo-knowledge-graph`, plus possibly `ruflo-graph-intelligence` if a separate port lands) reads via the same adapter shape | **same**; subject to plugin-mapping note above |
| READ end-consumer (agents) | LLM agents calling `agentdb_graph-query` (3 modes) and `agentdb_graph-pathfinder` (6 algorithms) directly via MCP | same 2 MCP tools, same names, same modes, same algorithms (per §R2.1 + §R2.4) | **same** |
| ADMIN / GC | none — retention implicit via decay-to-zero scoring (rows stay forever; just stop surfacing) | nightly background worker `graph-edge-sweep.ts` runs `DELETE WHERE (now - last_reinforced_at) > maxAgeDays*86400`; not on MCP surface; lock-free per ADR-0202 | **fork adds**; kept off MCP/agent surface (matches upstream's caller-visible shape) |

**Producers, end-consumers, and the read adapter are 1-to-1 identical with upstream** (modulo the plugin-mapping note). The only consumer-side delta is the background sweep worker, which is operational (cron-style) and not on any caller-visible surface.

### 2.8 Implementation completeness audit (cross-checked vs upstream PR file list)

§Decision Outcome was cross-checked against the 19-file list of upstream PR `edde98f9e`. **8 graph-related deliverables** were missing and have been added. **1 file in upstream's PR is mechanically auto-handled** by the fork release pipeline and listed in §Decision Outcome's "Not part of this ADR's deliverables" stanza, not as a ratification target. The audit:

| # | Upstream deliverable | Was in §Decision Outcome pre-§R2.8? | Verdict | Action |
|---|---|---|---|---|
| 1 | Plugin adapter `GraphEdgesSource` (P4, +73 LOC) | No — gap caught by user | **graph-deliverable** | Added; plugin-mapping note flagged |
| 2 | 5 granular smokes (P1–P5, +1137 LOC total) | No — only 1 combined smoke listed | **graph-deliverable** | All 5 added |
| 3 | `scripts/benchmark-graph.mjs` (+259 LOC) | No | **graph-deliverable** | Added |
| 4 | Schema loader extension at `init.ts:110` + `AgentDB.ts:210/216` | No — would silently skip `graph-edges.sql` | **graph-deliverable (REQUIRED)** | Added |
| 5 | `hooks-tools.ts` wire-up (+39 LOC) | Partial — agentdb-side named, cli-side missing | **graph-deliverable** | Both paths named |
| 6 | CI 5-job stanza specifics | "CI job stanza" listed unspecified | **graph-deliverable** | Specifies 5 jobs |
| 7 | Sweep-worker unit tests | No | **graph-deliverable** | Added as separate test file |
| 8 | `plugins/ruflo-plugin-creator/skills/create-plugin/SKILL.md` (+12 LOC documenting the `graph_adapter` plugin.json field) | I added it then removed it — both wrong | **graph-deliverable** — plugin-creator skill documentation for the new graph_adapter, not generic plugin drift | Restored after second user challenge |
| 9 | Witness manifest regen (`verification/macos/manifest.md.json`, `history.jsonl`) | I added it last turn — wrongly as deliverable | **AUTOMATIC** — release pipeline regen | Listed in §Decision Outcome's "not part of this ADR" stanza |

**Two self-corrections (2026-05-27)**: my earlier amendment included item 9 as a deliverable (scope inflation — release pipeline auto-handles it); then on user challenge I also removed item 8, which was wrong because the 12 LOC document the new `graph_adapter` field and ARE plugin-creator-skill documentation for graph work. Item 8 restored; item 9 stays in "not part of" stanza.

**Net implementation surface after corrected audit**: ~1100 LOC of fork code + ~1140 LOC of smokes/bench + ~120 LOC of CI/lint/codemod glue + ~250 LOC of tests + 12 LOC of plugin-creator skill doc. Total ~2620 LOC — comparable to upstream's +2662/-26 PR diff *minus* the witness-regen + package.json bumps that the release pipeline auto-handles.

### 2.9 Remaining open items (smaller, but real)

The following are NOT in §Decision Outcome because they're either implementation-time decisions or out-of-scope for ratification, but are worth flagging:

1. **Plugin mapping — RESOLVED 2026-05-27.** Verification: `grep -rl ruflo-graph-intelligence forks/ruflo` returned only one stray ADR mention (`ADR-126`) and no plugin directory. Conclusion: **fork is genuinely missing the upstream `ruflo-graph-intelligence` plugin**; it was never codemod-renamed. Two options for the adapter host: (a) **retarget to `ruflo-knowledge-graph`** (lower friction; subject to verifying that plugin's startup logic reads a `graph_adapter` field in its `plugin.json`, otherwise the adapter file is dead); (b) **port the upstream `ruflo-graph-intelligence` plugin** as a separate sibling ADR. **Decision for ADR-0261**: option (a) — retarget to `ruflo-knowledge-graph`. Implementation must verify the plugin's runtime reads `plugin.json.graph_adapter`; if not, a small wire-up edit lands in that plugin's bootstrap. The full upstream-plugin port (option b) is out of scope; tracked as a candidate future ADR.
2. **`inlineCosine` function** — upstream's reader path uses an `inlineCosine()` JS function (at `embedding-quantization.ts:134`) for zero-decode similarity ranking. The fork's `scalar-int8-encoder.ts` must export a matching function for the read tools (graph-query semantic mode, graph-pathfinder temporal-centrality) to use. Mechanical but easy to forget.
3. **Handler registration call**: the new handler at `agentdb/handlers/agentdb/graph-edge.ts` must be REGISTERED with the archivist via `registerMutationHandler('agentdb_graph_edge', graphEdgeHandler)`. Sibling handlers do this in a single index file; fork must add the registration line. Mechanical.
4. **Dist-built schema verification**: per `feedback-commit-forks-before-release`, the fork rebuild reads committed state. Acceptance smoke must verify the new `graph-edges.sql` is in the built dist, not just in source. (Already implicit in smoke-graph-schema-migration but worth being explicit.)

These are footnotes, not gates. None should block ratification.

### 2.10 Status after Revision 2

**Ratified 2026-05-27 → status `accepted`. Implemented 2026-05-27 → `completed: true`.** The combined §Revision 1 (council corrections) + §Revision 2 (port-to-upstream alignment) + §Revision 2.9 plugin-mapping resolution amendments narrow fork-vs-upstream divergence to invariant-forced items only.

**Implementation landed** in 5 commits across 3 repos (forks/agentdb `8c44f1f`, forks/ruflo `56e4cdd4a`, ruflo-patch `905bd7d`+`5dae89d`+`56a8cfe`+`133ab75`+`e474e39`). Acceptance verdict via canonical `npm run release` harness pass 2026-05-27 11:02Z — all 6 §R2.6 criteria GREEN: schema-migration (22/22), query-dispatch (17/17), trajectory-edges (9/9), pathfinder (35/35 — all 6 algorithms), plugin-adapter (12/12), benchmark (T1=48,336 ops/s, T2=147.8B/edge, T3=1.53ms p99). Forks published to Verdaccio as `3.7.0-alpha.10-patch.327` and pushed to sparkling; ruflo-patch pushed to origin.

The fork-vs-upstream divergence catalog:

| Item | Upstream | Fork | Why divergent |
|---|---|---|---|
| Substrate library | sql.js (JS-port SQLite) | better-sqlite3 (native) | fork uses native sqlite throughout (ADR-0166) |
| Schema location | `cli/src/memory/memory-initializer.ts` | `agentdb/src/schemas/graph-edges.sql` | agentdb owns schemas (ADR-0181) |
| Write routing | private `insertGraphEdge` with module-scope cache | archivist dispatch per-op | ADR-0181 / ADR-0202 / ADR-0246 |
| Catch sites | 12 fire-and-forget `catch { return false }` | 0 — fatal errors throw | `feedback-best-effort-must-rethrow-fatals` |
| `decay_rate` column | dead (hardcoded 0.1 in JS) | live (reads from column) | bug fix, not divergence |
| `witness_id` column | dead (never populated) | live (audit-chain id hashed with installation_id) | criterion #7 + §1.4 federation |
| Embedding dim source | hardcoded in writer | config-chain (§2.3) | fork's no-magic-numbers convention |
| Sweep | none (decay-to-zero only) | background worker (no MCP tool) | unbounded growth mitigation, but kept off the MCP surface |
| MCP read tools | 2 (graph-query, graph-pathfinder) | 2 (same names, same algorithms) | NO divergence (was 3 in §R1; reverted) |
| Hook writes | hook → `insertGraphEdge` private | hook → `dispatch('agentdb_graph_edge')` | shape inversion forced by ADR-0181 |

Everything that diverges is traceable to a named fork invariant or bug fix in upstream. Nothing diverges as decoration. Awaiting user ratification of the combined §1.1–1.8 + §2.1–2.6 amendments.
