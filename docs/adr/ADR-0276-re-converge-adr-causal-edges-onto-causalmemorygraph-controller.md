---
status: accepted
date: 2026-05-30
tags: [agentdb, causal, mcp, memory, upstream-convergence, adr-index]
supersedes: []
depends-on: [ADR-0273]
implements: [ADR-0147]
---

# Re-converge ADR causal edges onto upstream's CausalMemoryGraph controller

## Context and Problem Statement

The fork records the ADR dependency graph (`supersedes` / `depends-on` / `implements` + their derived inverses) as causal edges. Today it writes them through a **fork-only shortcut**: `routeCausalOp` in `@claude-flow/cli/src/memory/memory-router.ts` stores each edge in a KV memory namespace `causal-edges`, keyed `${src}→${tgt}`, with the relation in the JSON value (`memory-router.ts:2488-2491`). The MCP tool `agentdb_causal-query` reads that namespace via the ADR-0147 R6 fallback and merges it with a (dead) controller arm.

Two facts, established by live probe + file:line trace (2026-05-30), frame the decision:

1. **The KV shortcut works — but it is not upstream's model.** `agentdb_causal-query` returns correct, complete results off the KV namespace (`effect=ADR-0201` → all 39 inbound; `cause=ADR-0261` → all 11 outbound; inverses included). So the handover's "returns empty — by design" was inaccurate. But the entire `memory-router.ts` / `routeCausalOp` / `causal-edges` namespace mechanism is **fork-authored — it has never existed in ruvnet upstream** (`git log --all` on `ruvnet/ruflo` for `memory-router.ts` is empty).
2. **Upstream's intent is a controller-backed causal *graph*, keyed by numeric memory IDs.** The `CausalMemoryGraph` controller is the canonical store; the fork's KV path bypasses it. Our write arm is dead (`addEdge` typo guard, permanently false, `memory-router.ts:2467`) and our read arm calls the controller with the wrong arg shape (`memory-router.ts:2527-2530`), so the controller's value — multi-hop traversal, `ExplainableRecall`, uplift/confidence weighting, the `agentdb-investigator` root-cause walker, cascade-delete — is entirely forfeited.

The fork is committed to upstream alignment (ADR-0177). The question: **should the fork re-converge its ADR causal edges onto upstream's `CausalMemoryGraph` controller, and what exactly does "fulfilling upstream's vision" mean for *structural ADR edges* specifically?**

### Upstream intent — evidence and analysis

All references read from `origin/main` (working trees are stale): **agentdb `@1776223`** (2026-05-23), **agentic-flow `@6a06854`** (2026-05-23), **ruflo `@367cb82ad`** (2026-05-29). Sourced per `feedback-upstream-means-upstream` (ruvnet, not forks) + `feedback-fresh-upstream-via-git-show`.

| # | Reference (`origin/main`) | What it shows | Analysis |
|---|---|---|---|
| U1 | `agentdb:docs/adrs/ADR-009-causal-atlas-rvf-runtime.md` | **Empty placeholder (0 bytes).** | There is **no formal upstream ADR** articulating causal intent. Intent must be read from the controller code, the schema, and the product (plugin) docs — done below. |
| U2 | `agentdb:src/controllers/CausalMemoryGraph.ts:37-57` | `CausalEdge { fromMemoryId: number; fromMemoryType: 'episode'\|'skill'\|'note'\|'fact'; toMemoryId: number; …; uplift?: number /* E[y\|do(x)] */; confidence; sampleSize; experimentIds; mechanism }`. `addCausalEdge(edge): number`. | The canonical model keys edges on **numeric memory IDs** and is shaped as a **causal-inference engine** (do-calculus uplift, confidence, A/B experiments) — not a string-keyed dependency table. |
| U3 | `agentdb:src/schemas/frontier-schema.sql:14-48` | `causal_edges`: `from_memory_id INTEGER NOT NULL`, `from_memory_type TEXT NOT NULL` (enum is a **comment only — no CHECK constraint**); explicit note *"from_memory_id and to_memory_id can be 0 for abstract causal relationships"*; composite indexes on numeric `(from_memory_id, to_memory_id)`. | Two load-bearing facts: (a) `'adr'` is **not** a DB-level blocker (no CHECK) — it is only a TypeScript-type concern; (b) **`id = 0` is upstream's own sentinel for abstract (non-memory) edges** — the intended hook for edges between concepts that are not numeric memory rows. |
| U4 | `agentdb:plugins/agentdb-causal/skills/agentdb-causal-link/SKILL.md` + `commands/link.md` | Product spec. `fromMemoryType: 'episode'\|'pattern'\|'skill'\|'adr'`; `relation: 'caused'\|'supersedes'\|'depends-on'\|'related-to'\|<custom>`; named use case **"ADR housekeeping — `supersedes` / `amends` / `related-to` between architecture decisions"**; cascade tools `agentdb_causal_edge_delete`, `agentdb_causal_node_delete({cascade:true})`, `agentdb_edges_by_endpoints`; *"uplift is the secret sauce … the agentdb-investigator walks edges weighted by uplift × confidence."* | The **documented product intent explicitly blesses ADR causal edges** — our goal is upstream-aligned, not a divergence. Critically, **the doc is ahead of the code**: it lists `'adr'` (and `'pattern'`) as memory types the controller interface (U2) and schema comment (U3) do **not** yet enumerate. Upstream has *specified* the ADR use case but **not shipped a string-ADR path** for it. |
| U5 | `agentic-flow:docs/plans/agentic-flow-v2/components/03-causal-reasoning.md` | Design plan: "explainable AI through causal graphs." Three controllers — **CausalMemoryGraph** (graph), **CausalRecall** (forward/backward/multi-hop/**counterfactual** retrieval), **ExplainableRecall** (NL explanations, confidence intervals, decision traces). Use cases: debugging decisions, **root-cause analysis**, policy learning. | The vision splits cleanly into a **graph/explainability layer** (traversal, explain, cascade) and an **inference layer** (uplift/counterfactual/policy). The first applies to any typed edge; the second needs a statistical signal. |
| U6 | `agentic-flow:src/agentdb/controllers/CausalMemoryGraph.ts` | Same numeric-ID `CausalEdge` model as U2 (agentdb spun off from agentic-flow per `reference-ruvnet-upstream-repos`). | Confirms U2 is the stable, canonical model across both upstream repos — not an agentdb-only quirk. |
| U7 | `ruflo` (`@367cb82ad`, full history) | **No `memory-router.ts`, no `routeCausalOp`, no `causal-edges` namespace** anywhere (`git log --all` empty); only `memory-bridge.ts` + a benchmark mention causal. | The fork's KV causal mechanism is **100% fork-authored**. Re-convergence is therefore *toward* the upstream controller, not away from any upstream router — and deleting the fork's dead controller arm would burn the only bridge back to U2/U5. |

**Synthesis.** Upstream's vision has two layers: a **typed causal graph** (edges + multi-hop traversal + `ExplainableRecall` + cascade-delete — U5) and a **causal-inference engine** (uplift / do-calculus / experiments / policy-learning — U2/U4/U5). ADR structural edges (`supersedes`/`depends-on`/`implements`) fit the **graph layer perfectly** and the **inference layer not at all** — they are deterministic facts with no experimental uplift or confidence-from-observation. Upstream's product docs (U4) already name ADR housekeeping as a first-class causal use case, but upstream's *code* (U2/U3) still keys on numeric IDs and has not shipped the `'adr'`/string path the docs advertise. So the fork is, paradoxically, **closer to upstream's documented intent** (it actually stores + queries ADR causal edges) than upstream's shipped code is — just via a non-canonical mechanism that forfeits the graph layer's value.

### Current fork state (the gap to close)

- `forks/ruflo` `@claude-flow/cli/src/memory/memory-router.ts` — write arm dead (`addEdge` guard always false, `:2467`); read arm wrong-shape (`:2527-2530`); KV write `${src}→${tgt}` (`:2488-2491`); R6 KV fallback is the working canonical read path.
- `forks/agentdb` `src/core/AgentDB.ts:130-136` wires `CausalMemoryGraph` with `graphBackend: undefined` → the **SQLite-only** runtime path (not the string-tolerant GraphDatabaseAdapter). Confirmed 2026-05-30; this is why string ADR IDs need a numeric allocator.
- `forks/agentdb` `src/controllers/CausalMemoryGraph.ts` + `src/schemas/frontier-schema.sql` mirror U2/U3 (numeric IDs, `'episode'|'skill'|'note'|'fact'`, no CHECK, `id=0` abstract sentinel).

## Decision Drivers

* Re-converge onto upstream's controller model (ADR-0177) — unlock multi-hop traversal, `ExplainableRecall`, cascade-delete, and the `agentdb-investigator`, which the KV shortcut cannot provide.
* Do not regress the working `agentdb_causal-query` surface — the R6 KV path returns complete results today and must keep working through any transition.
* Honour the structural-vs-statistical reality of ADR edges — do not misuse the inference machinery (uplift/experiments) for deterministic dependency facts.
* Respect the SQLite-only runtime (`AgentDB.ts:132`) — string ADR IDs require a durable string→numeric mapping; the GraphDatabaseAdapter string-tolerance is not wired.
* Fork-only (`feedback-no-upstream-donate-backs`); cross-fork change touching `forks/agentdb` (controller/schema/type) + `forks/ruflo` (router/tools).

## Considered Options

* **A — Re-converge the ADR graph onto the controller (layer 1), migrate KV → controller, keep KV as a transitional read-fallback (chosen).** ADRs become numeric-ID memory nodes via a durable string→numeric map; edges write through `addCausalEdge` (numeric IDs, `relation`/`mechanism`, `confidence=1`, no `uplift`); reads build the proper `CausalQuery`; wire cascade-delete + `edges_by_endpoints`; `memory_type` gains `'adr'` (type-only — U3 has no CHECK). Layer 2 (inference) deliberately **not** driven for ADR edges.
* **B — Keep the KV shortcut; formally decline R7 (status quo).** Accept the fork divergence permanently; delete the dead controller arm as honest cleanup.
* **C — Full inference engine for ADRs (layer 1 + layer 2).** Also populate `uplift`/`confidence`/experiments for ADR edges and run them through `CausalRecall`/the investigator.
* **D — `id=0` abstract-edge mode (no allocator).** Use upstream's `id=0` abstract sentinel (U3) for every ADR edge, carrying the ADR id only in `mechanism`/`metadata`, avoiding a numeric allocator.

## Decision Outcome

Chosen option: **"A — re-converge the ADR graph onto the controller (layer 1), with a durable numeric-ID map, migrating KV → controller and keeping KV as a transitional fallback"**, because it is the only option that fulfils upstream's *applicable* vision (the graph + explainability layer, U5) for ADR edges while honouring their structural-not-statistical nature (rejecting C) and upstream's numeric-ID model (rejecting D's lossy abstract-edge shape). B is rejected because it permanently forfeits the controller's value and entrenches a fork-only divergence that upstream's own docs (U4) say should be controller-backed.

**Scope boundary (the honest tension, recorded):** ADR structural edges go through the **graph layer only**. `confidence` defaults to `1.0` (a declared dependency is certain), `uplift` is left null, and no experiment/treatment rows are synthesised. Layer 2 (do-calculus uplift, A/B experiments, policy learning — U2/U5) remains available for episode/skill memories where a real statistical signal exists; forcing ADR edges through it would be misuse, not fulfilment.

### Ratification + upstream three-controller mapping (2026-05-31)

Ratified at **Layer 1** (`status: proposed → accepted`). Grounding: upstream offers **one model**, not a layer switch — `frontier-schema.sql` carries `uplift`/`confidence`/`sample_size`/`experiment_ids` as nullable columns on every edge, the only causal ADR (agentdb `ADR-009`) is an empty placeholder, and the `agentdb-causal` plugin frames ADR `supersedes`/`depends-on` as typed **links** (relation + optional confidence) while pointing uplift/the investigator at episode/outcome memories.

The clarifying frame: each upstream controller has a **structural half** (works on any typed edge) and a **statistical half** (needs outcomes). Layer 1 = the structural halves; the statistical halves stay dormant for ADRs (which carry no outcomes).

| Upstream controller / feature | Structural half — Layer 1, ADR-0276 lands this | Statistical half — Layer 2, dormant for ADRs |
|---|---|---|
| **CausalMemoryGraph** | edge rows + 1-hop `queryCausalEffects`/`getCausalChain` + cascade-delete | uplift-weighted ranking |
| **CausalRecall** | forward/backward/**multi-hop** chains (supersession / transitive deps) | **counterfactual** probabilities |
| **ExplainableRecall** | narrate *why* two ADRs connect (relation path) | confidence intervals (degenerate at `confidence=1`) |
| uplift / experiments / `agentdb-investigator` | — | did-it-help / A/B / root-cause-by-uplift (needs episode outcomes) |

R1–R6 wire **CausalMemoryGraph** (graph + 1-hop + cascade); the multi-hop (CausalRecall) and path-explanation (ExplainableRecall) halves then operate on that graph for free, but exposing them as ADR-facing MCP tools is a fast-follow, not core R1–R6. ADR writes use `confidence=1`, `uplift=null`. **Note:** this graph wiring is also the substrate the broader upstream *agent causal-learning* vision (episode→outcome→uplift→decision) would need — ADR-0276 is the structural foundation either way; whether to pursue that broader loop is a separate, larger decision under evaluation.

### Consequences

* Good, because ADR causal edges become first-class controller nodes — unlocking multi-hop traversal, `ExplainableRecall`, cascade-delete (U4) and the `agentdb-investigator`, none of which the flat KV namespace can offer.
* Good, because it realises ADR-0147 R7 deliberately (as a forward-looking convergence decision) instead of leaving a dead controller arm + a divergent KV store.
* Good, because it re-converges the fork onto upstream's documented model (U4/U5), reducing future merge friction in the causal subsystem.
* Bad, because it is a cross-fork change (durable string→numeric map + write/read arm + `memory_type` type + MCP cascade tools + a migration of the existing 850 KV edges) — the "large" item R7 always named.
* Bad, because a durable ID map is new persistent state that must survive the MCP read/write split and be rebuildable (corruption/loss must degrade to a re-index, not silent edge loss).
* Neutral, because the KV `causal-edges` namespace is retained as a transitional read-fallback (dual-read) until the controller path is proven at corpus scale, then retired in a follow-up — no flag-day cutover.
* Neutral, because `'adr'` in `memory_type` is a TypeScript-type widening only (U3 has no DB CHECK), so the agentdb-side change is minimal at the schema layer.

### Confirmation

* A `scripts/smoke-adr0276-*.mjs` acceptance check (canonical harness: `run_check_bg` + `collect_parallel`) that, after `agentdb index`, asserts the **controller** (not the KV fallback) answers: `agentdb_causal-query effect=ADR-0201` returns all 39 inbound via `controller: causalGraph` (not `router-fallback`); a 2-hop traversal (e.g. `ADR-0276 → ADR-0147 → ADR-0094`) returns the chain; cascade-delete of a node removes its incident edges; and the durable ID map round-trips a string ADR id → numeric → string.
* The existing `agentdb_causal-query` results must remain complete during the dual-read transition (no regression vs the 39/11/18 probe baseline).
* Green in a release; forks committed before `npm run release`.

## Rules

### Design decisions to resolve at implementation (gated on ratification)

* **R1 — Durable string→numeric ID map.** A persistent table (`adr_node_ids(adr_id TEXT PRIMARY KEY, memory_id INTEGER)` or reuse of a hierarchical/memory record's numeric id) that both the MCP write and read processes resolve through. Must be rebuildable from the corpus on loss (degrade to re-index, never silent edge drop). Resolves the SQLite-only constraint (`AgentDB.ts:132`).
* **R2 — Write arm.** Replace the dead `addEdge` guard (`memory-router.ts:2467`) with `addCausalEdge({fromMemoryId:<num>, fromMemoryType:'adr', toMemoryId:<num>, toMemoryType:'adr', relation, confidence:1.0, mechanism:relation})`. Keep the KV write during transition (dual-write) so reads never regress.
* **R3 — Read arm.** Build the proper `CausalQuery` struct for `queryCausalEffects` and numeric args for `getCausalChain` (`memory-router.ts:2527-2530`); prefer controller results, fall back to KV until parity is proven.
* **R4 — `memory_type` widening.** Add `'adr'` to the `CausalEdge` type union in `forks/agentdb` `CausalMemoryGraph.ts` (U2). No schema migration needed (U3 has no CHECK); update the `from_memory_type` comment.
* **R5 — Cascade + endpoints tools.** Verify `agentdb_causal-node-delete({cascade})` and `agentdb_edges_by_endpoints` (U4) are wired through the controller for ADR nodes — cascade on supersession (an obsolete ADR's edges must not dangle, per U4 "Don't").
* **R6 — Migration.** One-time backfill of the 850 KV `causal-edges` into the controller via the ID map; the ADR-0273 `agentdb index --purge` path is the natural carrier (it already rebuilds all surfaces).
* **R7 — KV retirement.** After controller parity is proven at corpus scale, retire the `causal-edges` KV namespace as canonical read source in a follow-up; until then it is the dual-read safety net.
* **Inversion note.** The caller-side inverse derivation (ADR-0273 D10) still produces `superseded-by`/`depended-on-by`/`implemented-by` edges; these become controller edges too, and the ADR-0273 key-collision caveat (10 edges, ADR-0273 amendment) is moot once edges are keyed by `(from_memory_id, to_memory_id, relation)` rows rather than an upsert KV key.

## More Information

- **Implements ADR-0147 R7** (the deferred write-arm/`addCausalEdge` mirror + read-arm arg-shape correction). ADR-0147 stays the bug-refinement record for the cross-process KV path; this ADR is the forward-looking convergence decision that realises R7's intent properly. ADR-0147's R7 §Trade-off backend-uncertainty is resolved here: the runtime is SQLite-only (`AgentDB.ts:132`), so a numeric-ID allocator (R1) is required — confirming the original deferral's "substantial infrastructure" read.
- **Depends on ADR-0273** (`agentdb index`) — the command that writes ADR causal edges; this ADR redirects its edge writes from the KV shortcut (ADR-0273 D8/D9) onto the controller, and R6 reuses its `--purge` rebuild for the migration. The ADR-0273 causal-edge key-collision caveat is dissolved by the controller's row model.
- **Relates to ADR-0271** (the corpus the edges are derived from) and **ADR-0177** (RVF-first / upstream-aligned implement-ahead posture — this ADR builds ahead of upstream's not-yet-shipped `'adr'` path, U4).
- **Upstream provenance** (all `origin/main`): agentdb `@1776223`, agentic-flow `@6a06854`, ruflo `@367cb82ad` — see the §"Upstream intent" table (U1–U7) for per-reference paths, summaries, and analysis. Per `feedback-no-upstream-donate-backs`, this convergence stays fork-only.
