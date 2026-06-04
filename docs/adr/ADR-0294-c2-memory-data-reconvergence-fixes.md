---
status: proposed
completed: false
date: 2026-06-04
tags: [memory, storage, rvf, sqljs, graph, rabitq, re-convergence, fork-regression, c2, fixes]
supersedes: [ADR-0248]
depends-on: [ADR-0292, ADR-0291, ADR-0293, ADR-0276, ADR-0177, ADR-0091, ADR-0086]
implements: []
---

# C2 re-convergence — fix the graph_edges starvation, wire RaBitQ, record the RVF substrate justification

## Context and Problem Statement

The ADR-0292 C2 review (executed 2026-06-04; evidence in `docs/research/c2-memory-data/01..04`, raw
drives in `/tmp/c2-evidence/`) proved every advertised upstream C2 feature works (5 plugins, zero
UPSTREAM-BROKEN; upstream substrate = sql.js + HNSW `.swarm/memory.db` single source of truth,
MiniLM-384) and classified the fork's deltas under the null hypothesis. A devil's-advocate pass
independently re-drove every load-bearing claim in both environments — all upheld, with two
re-characterizations folded into the findings.

The headline inverts C1: **zero assumed-broken premises** (24/24 audited fork ADR premises
DEMONSTRATED at authoring time — the C2 corpus is over-demonstrated). C2's failure mode is
*demonstrated-then-but-diverged-since*: three real fork regressions against today's upstream, one
substrate-direction tension requiring a recorded justification, and a small open/doc tail.

**This ADR is `proposed` — it authorises no code.** R1/R3/O1/O2 are fork code edits gated on an
explicit go-ahead; X1–X4 doc/label edits ship with the implementation batch.

## Decision Drivers

* The top regression kills a whole composition: `agentdb_graph-query` (all 3 modes),
  `agentdb_graph-pathfinder`, and the knowledge-graph plugin's `traverse`/`relations`/`visualize`
  are dead in the fork while fully working upstream.
* ADR-0292's null hypothesis discharged for C2 with the full evidence bar — fixes can be surgical.
* The substrate divergence (RVF+better-sqlite3 vs upstream's sql.js-primary) is the most expensive
  merge-tax in the corpus and has never had its necessity recorded against *demonstrated* upstream
  behaviour (only against upstream's documented vision).
* Every fix must land with an acceptance check in `test-acceptance*.sh` + CI
  (`feedback-always-wire-tests-into-cicd`).

## Considered Options

* **Fix the regressions + record the substrate keep-justification + repair docs** (this ADR). Chosen.
* Bulk re-converge the substrate onto upstream's sql.js-primary runtime — rejected: forfeits
  demonstrated fork fixes (ADR-0284 lock collapse, ADR-0227 adaptive floor, ADR-0073 cosine,
  mpnet-768) for a WASM engine with no native path; the fork substrate is at demonstrated functional
  parity; upstream's own documented vision (RVF-first, ADR-0177) points the fork's way.
* Record-only (no fixes) — rejected: R1 and R3 are advertised surfaces that are dead/unreachable —
  exactly the dishonest-capability class the fork's own rules forbid.

## Decision Outcome

Adopt the C2 dispositions table (`docs/research/c2-memory-data/04-dispositions.md`) verbatim. Work
items:

### Fork-regression fixes (go-ahead required)

* **R1 — restore the general-entity `graph_edges` write (highest C2 priority).** ADR-0276 correctly
  re-converged ADR structural edges onto `CausalMemoryGraph`/`causal_edges` but narrowed
  `agentdb_causal-edge` past upstream's contract: general entity edges no longer reach `graph_edges`,
  starving `agentdb_graph-query`/`graph-pathfinder`/kg (content-verified: `causal_edges`=2,
  `graph_edges`=0 *in the C2 drive*). **Premise narrowed by the C4 DA (2026-06-04):** `graph_edges`
  is not globally unpopulated — `hooks_post-task` (hooks-tools.js:1523-1551, ADR-0261 Phase 3) and
  `trajectory-step` (:2706) write reinforcement edges there; the C2-era "no other fork path
  populates graph_edges" was a dump-timing artifact. The still-true, narrower premise: the
  **`agentdb_causal-edge` tool's write path** doesn't reach `graph_edges` (graph-query on a
  causal-edge node: fork count:0, upstream count:2). The fix below is unaffected. **Preferred fix:**
  `causal-edge` always writes the entity edge to `graph_edges` (upstream parity) and *additionally*
  writes `causal_edges` for the ADR-structural case (preserves ADR-0276). Must-not-regress:
  `agentdb_causal-query`/`-recall` and the ADR-0276 acceptance. *Acceptance:* one MCP session
  `causal-edge`(entity) → `graph-query` k-hop/semantic/pagerank all non-empty + `graph-pathfinder`
  returns paths; ADR-0276 checks stay green.
* **R2 — `ruvllm_hnsw_*` WASM dead: already fixed by ADR-0293 D1** (fork `7f2c4dfc4`, pushed,
  pending release; DA confirmed same root cause, not a second skew). No new work; post-release,
  re-drive the C2 probe to confirm closure.
* **R3 — wire `embeddings_rabitq_*` + install the WASM backend.** Re-characterized by the DA: the
  fork *retains* a real 205-line `rabitq-index.js` wrapper and declares
  `@sparkleideas/ruvector-rabitq-wasm@^0.1.0`; the gaps are (i) the 3 MCP tools are never registered,
  (ii) the wasm package is not installed. Upstream ships them working (32× compression). Pre-flight:
  the wrapper's `mod.initSync({module})` (line 23) is the same call shape ADR-0293 D1 just fixed —
  verify the rabitq wasm export shape first and apply the D1 shape-detection pattern if skewed.
  *Acceptance:* `embeddings_rabitq_build` over a ≥5-vector store returns a real compression envelope;
  `embeddings_rabitq_search` returns ranked results.

### Open items (investigate with the batch)

* **O1 — `agentdb_batch{insert}` unproven BOTH sides.** Fork: `rate_limited` on the FIRST call in a
  fresh process (single entry; DA-reproduced ×3 — not transient). Upstream: embedder-not-initialized
  even warm (DA). Not classified FORK-REGRESSION. Investigate the fork's cold rate-limiter, then fix
  or document the real precondition. *Acceptance once fixed:* batch insert of N entries lands N,
  content-verified.
* **O2 — `agentdb_semantic-route` honest envelope.** Fork returns bare `null` (cold) /
  `"No route matched"` (warm, router ON with no routes); upstream returns an explicit
  capability-absent redirect. Fix: explicit no-routes-configured envelope + `agentdb_route`
  recommendation; never bare `null`. semanticRouter stays ON (self-inert-until-routes).

### Fork-ahead justifications (recorded; no code change)

* **J1 — RVF-as-sole-truth + better-sqlite3 relational split: KEEP-WITH-JUSTIFICATION.** Upstream
  3.10.36 ships sql.js-primary **by design** (DA-verified: node-24, native better-sqlite3 loads,
  `initSqlJs` is the primary path, no native branch in the memory write path — the fallback-artifact
  hypothesis is refuted). The fork keeps its substrate because: demonstrated functional parity across
  the whole memory CRUD contract; ADR-0177 (upstream's documented vision is RVF-first — the fork built
  toward upstream's stated direction); ADR-0166a bounds RVF correctly (relational axis on
  better-sqlite3); unwinding forfeits demonstrated fixes. **Recorded cost:** permanent merge-tax —
  upstream `memory_entries` fixes are substrate-aware-skipped (ledger row `cfc341706` is the model).
  **Standing watch:** if upstream ships its RVF-first vision, re-converge onto it then.
* **J2 — `agentdb_causal-query`/`-recall`: KEEP** (load-bearing — the working read path for
  `causal_edges`; R1 acceptance includes them).
* **J3 — reflexion/learner/experience cluster: KEEP per ADR-0293 D5** (cross-ref; not re-audited).
* **J4 — G7 activations (gnnService, rvfOptimizer ON; G7-family semanticRouter ON-inert): KEEP**
  with this record (upstream: all off).
* **J5 — 42-controller registry + attention/semantic/skill tool clusters: KEEP;** per-tool
  justification deferred to C3 (their home category).
* **J6 — kg `src/adapters` shelfware: KEEP-AS-CAPABILITY** (honestly self-documented, ADR-0261;
  `feedback-no-consumer-is-not-stub`).
* **J7 — mpnet-768 embeddings: KEEP** (ADR-0052/0052a; adaptive floor makes the scale work).

### Doc/label repairs (bundle with the implementation batch)

* **X1:** agentdb/kg README "ADR-095 activated five controllers" → actual: 2 of the named five ON
  (gnnService, rvfOptimizer); semanticRouter (not among the five) also ON, inert; rest OFF.
* **X2:** backend-label unification (`archivist (RVF + HNSW)` vs `SQLite + HNSW` vs `RVF + HNSW`
  across store/list/retrieve/stats — finish ADR-0257); bridge-status stale `all-MiniLM-L6-v2
  (384-dim)` literal over an mpnet-768 store; CLI stats "HNSW Index: not active" <32-entries
  diagnostic wording.
* **X3:** kg namespace inconsistency (`knowledge-graph` vs `kg-graph`) + `kg search` template's
  upstream-envelope quote aligned with O2's outcome.
* **X4:** refresh the ruflo-agentdb contract ADR-0001 facts upstream evolved past (embeddings count
  incl. rabitq; RaBitQ phantom note superseded here; controller claims per X1).

### Supersession scope

`ADR-0248` is superseded **only** in its RaBitQ disposition ("phantom, removed — permanent"): the
phantom verdict was correctly scoped at the time (both sides), but upstream subsequently shipped
working `embeddings_rabitq_*` tools, and R3 wires the fork's retained implementation to match.
ADR-0248's other removals are untouched. ADR-0276 is **refined, not superseded**: its ADR-edge
re-convergence stands; R1 restores the general-entity write path it left out of scope.

### Consequences

* Good, because the dead composition (graph-query/pathfinder/kg traverse) gets restored with a
  composition-level acceptance gate, and the substrate decision finally carries a recorded
  justification against demonstrated upstream behaviour (not just upstream's docs).
* Good, because the C2 corpus's premise hygiene is now on record (24/24 demonstrated, DA-sampled) —
  the "fixes built on assumed brokenness" failure mode did not occur in C2.
* Bad, because R1's dual-write adds a second write per edge. **Corrected per the implementation DA
  (2026-06-04):** the `causal_edges` write was ALREADY unconditional pre-R1 (the original
  "mitigated by scoping `causal_edges` to the ADR case" aside was factually wrong and would have
  regressed J2 — entity edges must keep round-tripping through `causal-query`); R1's net change is
  purely additive (+1 `graph_edges` write, embedding_ref NULL per the upstream-faithful optional
  contract — semantic mode needs embeddings and is asserted reachability-only). The pre-existing
  `from_memory_type:'adr'` coercion on entity edges is real but functionally inert
  (causal-query reverse-maps); out of R1's scope.
* Neutral, because O1's batch episodes are excluded from learner consumption by THREE independent
  structural filters (action=NULL, reward 0.5 < 0.7, attempt_count 1) — DA-verified no
  contamination of E[reward|action,task_type]; a `metadata.source:'batch-insert'` marker is added
  as cheap insurance against future filter drift.
* Neutral, because O1 may end as a documented precondition rather than a fix (both sides are
  unproven today).

### Confirmation

Each R/O fix lands with its acceptance check wired into `test-acceptance*.sh` (run_check_bg +
collect_parallel) and a CI path filter; the C2 review drives re-run green against the fixed release;
R2 closure confirmed post-release via the C2 fork-env probe. This ADR flips to
`accepted`/`completed:true` when R1, R3, O1, O2 + X1–X4 are shipped and the checks are green in a
release.

## More Information

* Evidence: `docs/research/c2-memory-data/01-upstream-proof.md` (upstream proof + mechanism map),
  `02-fork-diff.md` (classified deltas), `03-patch-audit.md` (24-ADR premise audit),
  `04-dispositions.md` (this ADR's source table) — produced under ADR-0292's protocol with the
  ADR-0291 validation bar; DA verdicts + errata folded 2026-06-04 (`/tmp/c2-evidence/da/`).
* Program tracking: ADR-0292 (C2 row links here). Sibling: ADR-0293 (C1 re-convergence; owns R2's
  fix as D1).
* Method note carried forward: **cold-vs-warm process** is a named generalization of the
  counters-vs-content bar point (controllers warm lazily; a single cold call mis-reports).
