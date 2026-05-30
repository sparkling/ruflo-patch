---
status: accepted
date: 2026-05-19
tags: [autopilot, learning, gnn]
supersedes: []
depends-on: [ADR-0192, ADR-0193]
implements: []
---

# AutopilotLearning Phase 3 — embedding-cluster pattern discovery

## Context and Problem Statement

### Corpus evidence (2026-05-19)

A corpus-gap analysis of real autopilot subjects (124 unique task subjects across `~/.claude/tasks/*/*.json`; episode tables across 17 `.swarm/memory.db` files were empty for `autopilot:%` sessions) found the cross-lexical failure case this ADR addresses does NOT empirically occur in production data:

* Phase 2's keyword path produces 97 patterns (`count >= 2`) from the 124 subjects.
* Orphan rate (subjects with no shared ≥4-char token): 8.9% (11/124). Those 11 are heterogeneous one-offs, not a hidden cluster.
* Pairwise cosine similarity over all 7,626 pairs using `Xenova/all-mpnet-base-v2`: **0 cross-lexical pairs at ≥0.75** (the threshold this ADR recommends from `MemoryConsolidation.clusterMemories`). Only 5 cross-lexical pairs at ≥0.6, and those are accidental ADR-shape echoes, not the "react bug fix ↔ ui regression" kinship this ADR's Context posits.

Phase 2's token-sharing correlates well with embedding similarity in this corpus. The illustrative failure cases the ADR uses (`react bug fix` / `frontend defect resolution` / `ui regression`; `implement OAuth login` / `build SAML signup` / `add SSO flow`; `fix slow query` / `optimize index` / `cache db results`) are real LANGUAGE constructions but the actual autopilot subject corpus doesn't contain them.

**Decision (2026-05-19):** Build despite the corpus finding. The analysis above is retained as historical context for the threshold/algorithm tuning that follows.

Full analysis: [`docs/plans/adr0194-corpus-gap-analysis.md`](../plans/adr0194-corpus-gap-analysis.md).

### Problem statement

ADR-0193 §G defers AutopilotLearning's Phase 3 (per upstream ADR-059's
roadmap) to this sub-ADR. Phase 2 ships keyword-frequency pattern
discovery; Phase 3 swaps the algorithm to embedding-similarity
clustering so semantically related episodes are grouped even when they
share no literal tokens.

### What Phase 2 returns today

`_aggregatePatterns` (`forks/agentic-flow/agentic-flow/src/coordination/autopilot-learning.ts:615-637`)
lowercases each `episode.subject`, splits on whitespace, keeps tokens
≥4 chars, dedups per-episode, counts across the corpus, filters to
`count >= 2`, computes `avgReward`, returns the top 10 by frequency.

Output shape (`autopilot-learning.ts:41-45`):

```ts
interface DiscoveredPattern {
  pattern: string;     // single lowercase keyword
  frequency: number;
  avgReward: number;
}
```

### Why this is too thin

Concrete cases the keyword path misses (no shared ≥4-char token, so
every token's `count = 1`, filter drops them all → zero discovered
patterns):

* `{"react bug fix", "frontend defect resolution", "ui regression"}`
* `{"implement OAuth login", "build SAML signup", "add SSO flow"}`
* `{"fix slow query", "optimize index", "cache db results"}`

Each set is three semantically-identical episodes that Phase 2 cannot
group.

### Downstream consumers depending on `DiscoveredPattern[]`

* `discoverSuccessPatterns` (`autopilot-learning.ts:331-335`) —
  public API.
* `getReEngagementContext` (`autopilot-learning.ts:403-425`) — feeds
  `patterns` into `_buildRecommendations` which renders them as
  `"Pattern \"${p.pattern}\" succeeded ${p.frequency}× ..."` strings
  (`autopilot-learning.ts:654-673`).
* `getMetrics().patterns` (`autopilot-learning.ts:427-438`) —
  populated test asserts `patterns > 0`
  (`forks/agentic-flow/tests/integration/autopilot-learning.test.ts:158-166`).

The `DiscoveredPattern` shape MUST stay stable. `pattern` is rendered
verbatim in user-facing strings.

## Decision Drivers

* **`DiscoveredPattern.pattern` is rendered to users** — must remain a
  short, human-meaningful string after the swap (formatter at
  `autopilot-learning.ts:660-664`).
* **`@ruvector/gnn` Node binding does NOT expose clustering** —
  napi-rs surface (`forks/ruvector/crates/ruvector-gnn-node/index.d.ts`)
  exports only `differentiableSearch`, `hierarchicalForward`,
  `getCompressionLevel`, `RuvectorLayer.forward`, and `TensorCompress`.
  No Louvain, k-means, or community-detection primitive. Clustering
  must be implemented in TypeScript.
* **`MemoryConsolidation` already does greedy cosine clustering** —
  `forks/agentdb/src/controllers/MemoryConsolidation.ts:298-341`
  implements greedy single-pass with `clusterThreshold` (default 0.75),
  `maxClusterSize`, and centroid-average updates. Established in-tree
  pattern; copy rather than invent.
* **GNNService is reachable via controller registry** —
  `getController('gnnService')` (`forks/ruflo/v3/@claude-flow/memory/src/controller-registry.ts:1725-1735`)
  returns the `GNNService` from `forks/agentdb/src/services/GNNService.ts`,
  which itself falls back from native ruvector-gnn to JS cleanly
  (`GNNService.ts:108-112`). No new controller wiring required.
* **Embeddings are computed but discarded by the recall surface** —
  `ReflexionMemory.retrieveRelevant` returns `EpisodeWithEmbedding[]`
  (`forks/agentdb/src/controllers/ReflexionMemory.ts:37-40,241-291`)
  with `embedding: Float32Array`, but `AgentDBService.recallEpisodes`
  strips that field
  (`forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts:918-923`).
  Phase 3 must either extend the recall surface OR re-embed via
  `AgentDBService.generateEmbedding` (`agentdb-service.ts:1672-1693`).
* **`feedback-no-fallbacks` governs availability handling** — when
  cluster path is unreachable, log reason at init and expose `engine`
  in metrics. No silent per-call degradation.
* **Small corpora are normal** — populated tests use cap=15
  (`autopilot-learning.test.ts:108-156`); production typically <50.
  Greedy clustering handles small N; algorithms needing training
  (e.g., GAT) do not fit this corpus shape.

## Considered Options

### Option 1 — Greedy cosine clustering on episode embeddings (recommended)

Mirror `MemoryConsolidation.clusterMemories` (`MemoryConsolidation.ts:298-341`):
greedy single-pass, seed a cluster per unassigned episode, assign
neighbours with `cosineSimilarity >= threshold`, update centroid by
average. Each cluster → one `DiscoveredPattern` with `pattern` derived
from the cluster's representative (top-1 nearest-to-centroid subject,
or top-3 most-frequent ≥4-char tokens joined by `+`).

* **Pros**: copy-paste-able from in-tree precedent; works at N=2; no
  new clustering primitive; the core algorithm needs no GNN dependency.
* **Cons**: greedy ordering nondeterminism (mitigatable by id-sort);
  threshold tuning sensitivity; doesn't actually exploit @ruvector/gnn
  — the GNN role becomes optional embedding enhancement via
  `RuvectorLayer.forward`, not the clustering itself.

### Option 2 — GNNService-enhanced embeddings + greedy clustering

Pass episode embeddings through `GNNService.forward` (via
`getController('gnnService')`) to get graph-enhanced embeddings, then
cluster as in Option 1. The "graph" is built per call: neighbour
edges = top-K cosine-similar episodes.

* **Pros**: honestly exercises ruvector-gnn; GNNService already falls
  back to JS cleanly (`GNNService.ts:108-112`); benefits from native
  GAT when available.
* **Cons**: more moving parts; cold-start with N<5 produces degenerate
  graph; native engine availability is opportunistic so "GNN" claim is
  conditional on install. Adds a code path that must be tested in both
  engine modes.

### Option 3 — Hybrid: keep Phase 2, add a Phase 3 cluster pass on top

Keep `_aggregatePatterns` as `keywordPatterns`, add parallel
`_clusterPatterns`, union via a new `DiscoveredPattern.source:
'keyword' | 'cluster'` field.

* **Pros**: zero regression risk on keyword path; strict superset; A/B
  comparison possible from a single call.
* **Cons**: extends public `DiscoveredPattern` shape (breaks consumers
  doing `Object.keys` matching); duplicates output; doesn't replace
  the failing keyword case, just augments around it.

### Option 4 — Defer indefinitely

Leave Phase 2 as the final state. Acceptable if production telemetry
shows the keyword path is sufficient.

* **Pros**: zero implementation cost; no new surface.
* **Cons**: closes off ADR-059 Phase 3 promise; leaves failure cases
  unaddressed; orphans the populated test scaffolding.

## Decision Outcome

**Deferred — status proposed. Recommended option when prioritised:
Option 1 (greedy cosine clustering), with Option 2's GNNService
embedding-enhancement as a follow-up landing once Option 1 is stable.**

Readiness criterion (the sharp signal that turns "proposed" into
"queue for implementation"):

> A populated autopilot corpus exists (real or synthesised, N ≥ 20)
> where Phase 2's `discoverSuccessPatterns()` returns fewer patterns
> than a hand-labelled ground truth would predict — specifically,
> where the corpus contains at least one cross-lexical cluster (no
> shared ≥4-char tokens) that Phase 2 demonstrably misses.

Until that signal exists, the keyword path is "thin but not wrong"; a
swap is speculation. The signal can be produced cheaply via a one-off
script that seeds an `EPISODE_SESSION_ID`-scoped corpus with known
cross-lexical groups and runs `discoverSuccessPatterns` against it.

### Consequences

* Good, because the chosen Option 1 (greedy cosine clustering) is copy-paste-able from the in-tree `MemoryConsolidation.clusterMemories` precedent, works at N=2, and needs no new clustering primitive or GNN dependency.
* Good, because Option 2's GNNService embedding-enhancement remains available as a follow-up landing once Option 1 is stable, honestly exercising ruvector-gnn with a clean JS fallback.
* Bad, because greedy ordering introduces nondeterminism (mitigatable by id-sort) and threshold-tuning sensitivity, and the core algorithm doesn't itself exploit `@ruvector/gnn` — the GNN role becomes optional embedding enhancement, not the clustering.
* Neutral, because the full set of considered options' trade-offs (Options 2, 3, 4) is retained in the Considered Options section above; the readiness criterion gates when the swap is worth doing.

## Scope when implemented

### New files

* `forks/agentic-flow/agentic-flow/src/coordination/autopilot-pattern-cluster.ts`
  — pure module exporting `clusterEpisodes(episodes, opts):
  Promise<DiscoveredPattern[]>`. Mirrors
  `MemoryConsolidation.clusterMemories` shape but takes
  `AutopilotEpisode[]`. Pure function, no controller dependency, so it
  unit-tests without AgentDB.
* `forks/agentic-flow/tests/integration/autopilot-pattern-cluster.test.ts`
  — unit tests for the cluster module.

### Edited files

* `forks/agentic-flow/agentic-flow/src/coordination/autopilot-learning.ts`:
  * Add `_gnnService: GNNServiceLike | null`; resolve via
    `_agentdb.getController?.('gnnService')` during `initialize()`.
  * Replace `_aggregatePatterns` body with a call to `clusterEpisodes`
    over embeddings sourced from either (a) a new
    `recallEpisodesWithEmbeddings` surface, or (b) re-embedding via
    `_agentdb.generateEmbedding(ep.subject)`.
  * Keep keyword aggregation as `_aggregatePatternsKeyword` —
    retained for: fallback when cluster surface is unreachable; A/B
    parity tests.
  * Add `engine: 'keyword' | 'embedding-cluster'` to
    `LearningMetrics` (per `feedback-no-fallbacks`: observable, not
    silent).
* `forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts`:
  * Add `recallEpisodesWithEmbeddings(query, limit, filters):
    Promise<EpisodeWithEmbedding[]>` — same body as `recallEpisodes`
    but preserves `embedding: Float32Array` in the row map.
  * Alternative (re-embed in AutopilotLearning) costs O(N) embedder
    calls per `discoverSuccessPatterns`; with the batched
    RVFOptimizer-compressed path (`agentdb-service.ts:1672-1716`)
    this is acceptable for the N=10000 cap. Decision deferred to
    Landing B PR.

### Public surface changes

* `DiscoveredPattern.pattern` semantics widen from "single ≥4-char
  token" to "cluster label (single subject OR top-3 tokens joined by
  `+`)". Stays a `string`; formatter at `autopilot-learning.ts:660-664`
  unaffected.
* `LearningMetrics` gains `engine: 'keyword' | 'embedding-cluster'`
  (additive).
* `AgentDBLike` gains optional `recallEpisodesWithEmbeddings?`
  (additive; test doubles unaffected).

### Interface to `clusterEpisodes`

```ts
interface ClusterEpisodesOpts {
  clusterThreshold: number;       // cosine, default 0.75 (matches MemoryConsolidation)
  maxClusterSize: number;         // safety cap, default 100
  minClusterSize: number;         // filter, default 2 (matches keyword count>=2)
  labelStrategy: 'centroid-nearest' | 'top-tokens';
}

interface EpisodeWithEmbedding extends AutopilotEpisode {
  embedding: Float32Array;
}

async function clusterEpisodes(
  episodes: EpisodeWithEmbedding[],
  opts?: Partial<ClusterEpisodesOpts>,
): Promise<DiscoveredPattern[]>;
```

`labelStrategy: 'centroid-nearest'` picks the cluster member with the
highest cosine to the centroid and uses its subject as `pattern`.
`'top-tokens'` aggregates the same ≥4-char-token frequency over cluster
members and joins the top 3 with `+`. Default `'centroid-nearest'`
because Phase 2 already proved single-token labels are tractable for
the user-facing rendering at `autopilot-learning.ts:660-664`.

## Implementation phases

Ordered by risk reduction. Each landing leaves the system coherent.

### Landing A — pure cluster module + unit tests

Add `autopilot-pattern-cluster.ts` with `clusterEpisodes`. Pure
function, no imports from autopilot-learning or agentdb-service. Unit
tests cover cross-lexical clustering, threshold-edge cases, centroid
correctness, both label strategies, empty/single/all-identical inputs.
Risk shape: zero impact on autopilot-learning.ts; strictly additive.

### Landing B — `recallEpisodesWithEmbeddings` on AgentDBService

Add the new surface next to `recallEpisodes` with identical query path
but `embedding` preserved in the row map. Mark optional on
`AgentDBLike` (`autopilot-learning.ts:134-172`). Risk shape: additive;
AutopilotLearning still uses the embedding-stripping `recallEpisodes`,
no behaviour change.

### Landing C — wire AutopilotLearning to embedding clustering

In `initialize`, probe `typeof
this._agentdb.recallEpisodesWithEmbeddings === 'function'`. Set
`_engine = 'embedding-cluster'` if present; else log `console.error`
with reason and set `'keyword'` (per `feedback-no-fallbacks`). Replace
the `_aggregatePatterns` call at `autopilot-learning.ts:334` with
branching: cluster path fetches via the new surface and calls
`clusterEpisodes`; keyword path calls the renamed
`_aggregatePatternsKeyword`. Risk shape: Phase 2 preserved verbatim
under `'keyword'`; swap only fires when surface AND embedder are
healthy.

### Landing D — GNNService embedding enhancement (Option 2 follow-up)

Resolve `_gnnService` lazily via `_agentdb.getController?.('gnnService')`.
When `getEngineType() === 'native'`, route each embedding through
`gnn.forward(embedding, kNN-neighbours, weights)` before clustering.
When absent or `'js'`, skip enhancement. Add
`engine.gnnEnhancement: 'native' | 'js' | 'disabled'` to
`LearningMetrics`. Risk shape: deferred to a separate landing because
native ruvector-gnn is platform-gated in CI and Landing C must be
stable before stacking another conditional.

### Landing E — closure assertions

Add the populated integration test asserting cross-lexical clustering
(see Closure criteria). Flip ADR-0194 status to `implemented`.

## Closure criteria

Specific assertions in tests + acceptance probes that gate flipping
status to `implemented`:

* **Unit (`autopilot-pattern-cluster.test.ts`)**: `clusterEpisodes`
  groups three episodes with no shared ≥4-char tokens (e.g., the
  `{"react bug fix", "frontend defect resolution", "ui regression"}`
  case from the Context section) into one cluster when their
  embeddings have pairwise cosine ≥ 0.75. Asserts
  `result.length === 1`, `result[0].frequency === 3`, and
  `result[0].pattern` is one of the three subjects (centroid-nearest)
  OR a `+`-joined top-token string (`top-tokens`).
* **Unit**: greedy ordering invariant — for a corpus where every
  episode pair is below threshold, output `length === 0` regardless of
  input order.
* **Integration (`autopilot-learning.test.ts` new describe block)**:
  `discoverSuccessPatterns` on a populated corpus seeded with two
  cross-lexical clusters returns ≥ 2 patterns (vs. Phase 2's 0 on the
  same corpus).
* **Integration**: `getMetrics()` returns
  `engine: 'embedding-cluster'` when AgentDBService exposes
  `recallEpisodesWithEmbeddings` AND the embedder is healthy.
* **Integration**: `getMetrics()` returns
  `engine: 'keyword'` and logs a discriminable `console.error` when
  the new surface is missing (proves graceful-unavailable observability
  per `feedback-no-fallbacks`).
* **Acceptance probe (new in `ctrl-autopilot-cluster`)**: assert the
  metrics `engine` field is present and is one of the two valid
  values; assert `patterns >= 1` in a populated init'd project.

## Out of scope

* **GNN model training over episodes** — Phase 3 uses GNNService for
  embedding enhancement only, never for trainable parameters. Training
  is a Phase 4 question.
* **Cross-controller bridges** — ADR-0195 (deferred). LearningSystem
  remains independent of AutopilotLearning's pattern output.
* **Federated sharing of clusters across installs** — ADR-0196
  (deferred). Phase 3 clusters are derived on-demand from local
  episodes and not persisted.
* **Streaming / incremental clustering** — every call to
  `discoverSuccessPatterns` recomputes from the full episode listing
  (bounded by `MAX_LIST=1000` at `autopilot-learning.ts:75`). Online
  clustering belongs to a later optimisation pass.
* **Persisting clusters as their own table** — clusters are derived,
  not stored. Adding `autopilot_clusters` SQL is a separate question.
* **Tuning `clusterThreshold` dynamically** — default 0.75 matches
  `MemoryConsolidation`'s precedent; adaptive thresholding is
  out-of-scope until corpus telemetry shows it's needed.

## Risks

Ranked by likelihood × impact, highest first.

* **Cosine threshold mis-tuning → either everything clusters or
  nothing does** (high × medium). `MemoryConsolidation` surfaces an
  explicit recommendation when no clusters form
  (`MemoryConsolidation.ts:625`). Mitigation: copy that pattern;
  make threshold configurable per call AND via env var so a
  corpus-seeding script can sweep it.
* **Embedder unavailability → cluster path is silently empty**
  (medium × high). If `_record` wrote no embedding for an episode,
  `clusterEpisodes` would skip it. Mitigation: filter
  `e.embedding != null` explicitly, log the dropped count via
  `console.warn`, assert in unit test.
* **`recallEpisodesWithEmbeddings` extends `AgentDBLike` → test
  doubles miss it** (medium × low). Method is optional on the
  interface; `_engine` detection logs reason and falls back to
  `'keyword'`. Test the test-double path explicitly.
* **`pattern` label change breaks string-matching consumers** (low ×
  medium). The only in-tree formatter is `_buildRecommendations`
  (`autopilot-learning.ts:654-673`) which treats `pattern` as opaque.
  External MCP plugin consumers are undocumented territory. Mitigation:
  `'centroid-nearest'` strategy returns a real subject string (already
  a valid `pattern` value under Phase 2 for any single-token subject);
  worst case is multi-word labels where single-token labels were. JSDoc
  the widening.
* **Greedy ordering nondeterminism → flaky tests** (low × low). Sort
  episodes by `id` ascending before the greedy pass; assert
  determinism on duplicate-input test.
* **GNNService `'js'` engine makes Option 2 enhancement a no-op**
  (medium × low). `GNNService.forward`'s JS fallback uses raw
  embedding (`GNNService.ts:451-477`). Landing D is gated on the
  `'native'` engine; `'js'` path is documented and observable via
  `engine.gnnEnhancement` metric.

## Open questions

Items that could not be answered from code and need research before
prioritisation:

* **Does the populated test corpus need cross-lexical examples
  injected, or do real autopilot subjects already exhibit the failure
  case?** Current populated test
  (`autopilot-learning.test.ts:108-156`) seeds subjects that DO share
  ≥4-char tokens (`"write unit tests for authentication"`, `"fix
  database migration"`). A one-off inspection script against a real
  ruflo dev session's autopilot log would settle whether the failure
  case is hypothetical or load-bearing. Without that signal, the
  readiness criterion above is the gate.
* **Should `recallEpisodesWithEmbeddings` be a new surface or should
  AutopilotLearning re-embed via `generateEmbedding`?** Embeddings ARE
  computed during `storeEpisode` (`ReflexionMemory.ts:241-291`), so
  re-embedding is duplicate work — but adding a method extends a
  much-consumed public surface. The RVFOptimizer-backed
  `generateEmbedding` (`agentdb-service.ts:1672-1693`) is cached and
  batched, so the cost asymmetry is smaller than it first appears.
  Defer to the Landing B PR.
* **What threshold value actually clusters real autopilot subjects?**
  `MemoryConsolidation`'s 0.75 is tuned for general memory tiering,
  not short autopilot subject strings. A sweep (0.5, 0.6, 0.7, 0.75,
  0.8, 0.85) over a real corpus is the cheapest way to set the
  default. Landing E task, not a prioritisation blocker.
* **Is upstream racing a hand-port of this same change?** ADR-059
  lists Phase 3 as complete
  (`forks/agentic-flow/docs/adr/ADR-059-agentdb-ruvector-deep-optimization.md:412`),
  but the populated test confirms `_aggregatePatterns` is still
  keyword-only — the upstream "complete" referred to controller
  backend-wiring (`ADR-059:217-218`), NOT to AutopilotLearning pattern
  clustering. Confirm via `git log -S "_aggregatePatterns"` upstream
  before Landing C.

## Implementation log

| Date | Commit (sparkling/agentic-flow main) | Scope |
|---|---|---|
| 2026-05-19 | `f3e48a1` | `feat(autopilot): ADR-0194 Phase 3 embedding-cluster pattern discovery` — Landing C wire-in (DiscoveredPattern.source, AutopilotLearningConfig + ResolvedClusterConfig, discoverPatternsByEmbedding, _cosine, _updateCentroid, discoverSuccessPatterns rewrite). |
| 2026-05-19 | `c89a782` | `test(autopilot): unit tests for ADR-0194/0195/0196` — bundled unit tests (skip-with-marker tolerant of unlanded Phase 4/5 surfaces). |
| 2026-05-19 | `9b55d88` | `test(autopilot): integration tests for ADR-0194/0195/0196` — bundled integration tests. |
| 2026-05-19 | `d06ba2c` | `feat(autopilot): ADR-0196 Phase 5 _record stamping + SyncCoordinator adapter` — ships the three `.claude/helpers/autopilot-learning.mock.*.mjs` test doubles consumed by Phase 3 hook tests. |

## Landing D deferral note (2026-05-19)

**Decision: defer Landing D (GNNService embedding enhancement). No code changes.**

Per memory `feedback-corpus-evidence-before-feature-work`, re-ran the corpus
probe before any implementation. The corpus has grown slightly since the
2026-05-19 morning walk (124 → 131 unique task subjects, 7 new tasks; full
file count 131 vs 124) but the shape is unchanged:

| Metric                                                            | Morning walk (N=124) | Re-run (N=131) |
| ----------------------------------------------------------------- | -------------------- | -------------- |
| Phase 2 tokens with `count >= 2`                                  | 97                   | 100            |
| Orphan rate (no shared ≥4-char token)                             | 8.9% (11/124)        | 9.9% (13/131)  |
| Pairwise cross-lex pairs at cosine `>= 0.75` (cluster threshold)  | **0 / 7 626**        | **0 / 7 969**  |
| Pairwise cross-lex pairs at cosine `>= 0.60` (relaxed)            | 5                    | 7              |
| Pairwise cross-lex pairs at cosine `>= 0.50`                      | (not reported)       | 135            |

The 7 cross-lex pairs above 0.60 in the re-run remain accidental
ADR-cross-reference shape echoes
(`ADR-0181 Phase 7 ↔ ADR-0182 L6: baseline capture`,
`ADR-0171 Phase 2: per-controller integration points ↔ ADR-0195 trajectory
step-level feedback`, `Unit-level fail-loud invariant test for AgentDBBackend
↔ AgentDB MCP read-tool round-trip tests`), not the
"react bug fix ↔ ui regression" semantic kinship Landing D's GNN
enhancement is meant to surface.

**Why GNN enhancement would be a structural no-op for this corpus:** Landing
D's value proposition is that `gnn.forward` over a kNN-neighbour graph
pushes semantically-related embeddings closer together so they cross the
0.75 cluster threshold. With zero cross-lex pairs within reach of the
threshold (highest is 0.638, off by ≥0.11), any plausible GNN enhancement
would need to shift cosine by >0.11 on the boundary pairs to produce a
single new cluster — and even then, the resulting clusters would group
ADR-cross-references, not the kinship class the ADR's Context posits.
Landing D would add a code path that triggers `'native'`-only in CI, costs
embedder calls, and produces no observable behaviour change on real
autopilot data.

**Re-evaluation trigger.** Re-run this probe and reconsider Landing D when
EITHER:

1. The autopilot `episodes` table accumulates ≥ 200 rows with
   `session_id = 'autopilot:%'` across walked DBs. Today's count is 0;
   episode-volume arrival would change the subject-text distribution from
   ADR-identifier-dominated to free-text.
2. A cross-lex pair appears in `~/.claude/tasks` above cosine 0.70 (within
   striking distance of the 0.75 threshold). Today's max cross-lex is
   0.638; a 0.70+ outlier would signal that the kinship gap is starting to
   exist.

The probe script lives at
[`docs/plans/adr0194-corpus-gap-analysis.md`](../plans/adr0194-corpus-gap-analysis.md)
methodology; it can be re-run cheaply (~2 minutes including model load).

## More Information

Original status: accepted, implemented, and completed 2026-05-19. Original frontmatter recorded `methodology: [MADR]`, `decision-makers: [Henrik Pettersen]`, `audience: ai-executor`, `related: [0192, 0193]`, and `upstream-related: [agentic-flow/ADR-059]`.
