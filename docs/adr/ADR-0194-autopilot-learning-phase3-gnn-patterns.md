---
status: proposed
date: 2026-05-19
methodology: [MADR]
decision-makers: [Henrik Pettersen]
tags: [autopilot, learning, gnn, ruvector, phase3, ADR-0193, ADR-059]
related: [0192, 0193]
upstream-related: [agentic-flow/ADR-059]
audience: ai-executor
---

# ADR-0194: AutopilotLearning Phase 3 — embedding-cluster pattern discovery

## Context and Problem Statement

ADR-0193 §G defers AutopilotLearning's Phase 3 (per upstream ADR-059's
roadmap) to this sub-ADR. Phase 2 ships keyword-frequency pattern
discovery; Phase 3 swaps the algorithm to embedding-similarity
clustering so semantically related episodes are grouped even when they
share no literal tokens.

### What Phase 2 actually returns today

`_aggregatePatterns` (`forks/agentic-flow/agentic-flow/src/coordination/autopilot-learning.ts:615-637`):

1. Lowercases each `episode.subject`, splits on whitespace, keeps tokens
   with `length >= 4`.
2. Deduplicates per-episode via `new Set(tokens)`.
3. Builds a `Map<string, { count, rewardSum }>` keyed by token.
4. Filters to tokens with `count >= 2`, computes `avgReward`, sorts by
   frequency desc, slices to top 10.

Output shape (`autopilot-learning.ts:41-45`):

```ts
interface DiscoveredPattern {
  pattern: string;     // single lowercase keyword
  frequency: number;
  avgReward: number;
}
```

### Why this is too thin

Concrete failure cases the keyword path misses:

* `{ "react bug fix", "frontend defect resolution", "ui regression" }`
  — no token overlap of length ≥ 4, so each appears once and is
  filtered out by `count >= 2`. Three semantically identical episodes
  produce zero discovered patterns.
* `{ "implement OAuth login", "build SAML signup", "add SSO flow" }` —
  no shared ≥4-char token; three auth-flow episodes produce zero
  patterns even though they cluster naturally in embedding space.
* `{ "fix slow query", "optimize index", "cache db results" }` —
  no overlap; three perf episodes produce zero patterns.

### Downstream consumers depending on `DiscoveredPattern[]`

* `discoverSuccessPatterns` (`autopilot-learning.ts:331-335`) — public
  API surfaced via `getMetrics().patterns` count and via CLI/MCP
  inspection.
* `getReEngagementContext` (`autopilot-learning.ts:403-425`) — feeds
  `patterns` into `_buildRecommendations` which formats them as
  `"Pattern \"${p.pattern}\" succeeded ${p.frequency}× (avg reward
  ${p.avgReward.toFixed(2)})"` strings (`autopilot-learning.ts:654-673`).
* `getMetrics().patterns` (`autopilot-learning.ts:427-438`) — exposed
  via Phase 2 metrics; populated test
  (`forks/agentic-flow/tests/integration/autopilot-learning.test.ts:158-166`)
  asserts `patterns > 0`.

The public `DiscoveredPattern` shape MUST stay stable. The `pattern`
field is rendered verbatim in user-facing recommendation strings.

## Decision Drivers

* **`DiscoveredPattern` is rendered to users** — `pattern` field must
  remain a short, human-meaningful string after the swap.
* **Existing GNNService access path is via the controller registry** —
  `getController('gnnService')` already exists
  (`forks/ruflo/v3/@claude-flow/memory/src/controller-registry.ts:1725-1735`);
  no new wiring needed at the controller-registry layer. Phase 3 needs
  an AgentDBService accessor or a new AutopilotLearning import path.
* **`@ruvector/gnn` Node binding does NOT expose clustering** — the
  napi-rs surface
  (`forks/ruvector/crates/ruvector-gnn-node/index.d.ts`) exports only
  `differentiableSearch`, `hierarchicalForward`, `getCompressionLevel`,
  `RuvectorLayer.forward`, and `TensorCompress`. There is no Louvain,
  no k-means, no community-detection primitive. Clustering must be
  implemented in TypeScript over Float32Array embeddings.
* **`MemoryConsolidation` already does greedy cosine clustering** —
  `forks/agentdb/src/controllers/MemoryConsolidation.ts:298-341`
  implements greedy single-pass clustering with `clusterThreshold`
  (default 0.75), `maxClusterSize`, and centroid-average updates. This
  is the established in-tree pattern; copy it rather than invent.
* **Embeddings are computed but discarded by the recall surface** —
  `ReflexionMemory.retrieveRelevant` returns `EpisodeWithEmbedding[]`
  (`forks/agentdb/src/controllers/ReflexionMemory.ts:37-40,241-291`)
  with optional `embedding: Float32Array`, but
  `AgentDBService.recallEpisodes` strips that field in its mapping
  (`forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts:918-923`).
  Phase 3 must either extend the recall surface OR re-embed via
  `AgentDBService.generateEmbedding`
  (`agentdb-service.ts:1672-1693`).
* **`feedback-no-fallbacks` governs availability handling** — when
  GNNService / ruvector-gnn is unreachable, Phase 3 must NOT silently
  catch and degrade to Phase 2 per-call; it must check at init and
  expose `engine: 'keyword' | 'embedding-cluster'` so tests can assert
  which path is live.
* **Cold-start episodes are normal** — populated tests run with cap=15
  (`autopilot-learning.test.ts:108-156`); production typically <50
  episodes before patterns are useful. Greedy clustering handles small
  N gracefully; algorithms requiring large N (e.g., GAT training) do
  not fit this corpus shape.

## Considered Options

### Option 1 — Greedy cosine clustering on episode embeddings (recommended)

Mirror `MemoryConsolidation.clusterMemories`: greedy single-pass over
episodes, seed a cluster per unassigned episode, assign neighbours with
`cosineSimilarity >= threshold`, update centroid by average. Each
cluster → one `DiscoveredPattern` with `pattern` derived from the
cluster's representative subject (top-1 nearest-to-centroid subject, or
top-3 most-frequent ≥4-char tokens joined by `+`).

* **Pros**: copy-paste-able from `MemoryConsolidation.ts:298-341`;
  works at N=2; no new clustering primitive; no GNN dependency
  required for the core algorithm.
* **Cons**: greedy ordering is not deterministic across episode
  insertion order; threshold tuning sensitivity; doesn't exploit
  `@ruvector/gnn` at all — the GNN role becomes optional embedding
  enhancement via `RuvectorLayer.forward`, not the clustering itself.

### Option 2 — GNNService-enhanced embeddings + greedy clustering

Pass episode embeddings through `GNNService.forward` (via
`getController('gnnService')`) to get graph-enhanced embeddings, then
cluster as in Option 1. The "graph" is built from current episodes:
neighbour edges = top-K cosine-similar episodes.

* **Pros**: actually exercises ruvector-gnn (Option 1's "GNN-enhanced"
  framing is honest); GNNService falls back to JS cleanly already
  (`forks/agentdb/src/services/GNNService.ts:108-112`); benefits from
  the native GAT layer when available.
* **Cons**: more moving parts; cold-start with N<5 produces degenerate
  graph; native engine availability is opportunistic — `GNNService`
  uses `engineType: 'native' | 'js'` and silently picks the JS path
  when @ruvector/gnn is missing, so the "GNN" claim is conditional on
  install. Adds a code path that must be tested in both engine modes.

### Option 3 — Hybrid: keep Phase 2, add a Phase 3 cluster pass on top

Keep `_aggregatePatterns` output as `keywordPatterns`, add a parallel
`_clusterPatterns` that returns embedding-clustered patterns, and union
them via a new `DiscoveredPattern.source: 'keyword' | 'cluster'`
field.

* **Pros**: zero regression risk on the keyword path; users see strict
  superset; A/B comparison possible from a single call.
* **Cons**: extends the public `DiscoveredPattern` shape (breaking
  consumers that rely on `Object.keys` matching); duplicates the
  output array; doesn't replace the failing keyword case, just
  augments around it.

### Option 4 — Defer indefinitely

Leave Phase 2 as the final state. Acceptable if production telemetry
shows the keyword path is sufficient (e.g., autopilot subjects in real
use always overlap on ≥4-char tokens).

* **Pros**: zero implementation cost; no new dependency surface.
* **Cons**: closes off the upstream ADR-059 Phase 3 promise; leaves
  the failure cases above unaddressed; orphans the populated test
  scaffolding that would prove the swap works.

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

## Scope when implemented

### New files

* `forks/agentic-flow/agentic-flow/src/coordination/autopilot-pattern-cluster.ts`
  — pure module exporting `clusterEpisodes(episodes, opts):
  Promise<DiscoveredPattern[]>`. Mirrors
  `MemoryConsolidation.clusterMemories` shape but takes
  `AutopilotEpisode[]` and returns `DiscoveredPattern[]`. Pure
  function; no controller dependency. Lets the algorithm be unit-tested
  without AgentDB.
* `forks/agentic-flow/tests/integration/autopilot-pattern-cluster.test.ts`
  — pure-function unit tests for the cluster module
  (cross-lexical clustering, threshold edge cases, centroid updates,
  pattern-string derivation).

### Edited files

* `forks/agentic-flow/agentic-flow/src/coordination/autopilot-learning.ts`:
  * Add `_gnnService: GNNServiceLike | null` field; resolve via
    `_agentdb.getController?.('gnnService')` during `initialize()`.
  * Replace `_aggregatePatterns` body with a call to
    `clusterEpisodes`, passing the same `episodes` array PLUS either
    (a) embeddings extracted from a new `recallEpisodesWithEmbeddings`
    surface, or (b) re-embedded on demand via
    `_agentdb.generateEmbedding(ep.subject)`.
  * Keep the keyword aggregation as `_aggregatePatternsKeyword` (no
    longer the default but retained for: fallback when GNNService is
    unreachable AND the cluster path requires it; A/B parity tests).
  * Add an `engine: 'keyword' | 'embedding-cluster'` field to
    `LearningMetrics` so tests can assert which path is live (per
    `feedback-no-fallbacks` — must be observable, not silent).
* `forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts`:
  * Add `recallEpisodesWithEmbeddings(query, limit, filters):
    Promise<EpisodeWithEmbedding[]>` — same body as `recallEpisodes`
    but the row-map preserves `embedding: Float32Array`. Mark the
    existing `recallEpisodes` as the embedding-stripped convenience
    overload.
  * Alternative if the AgentDBLike interface should not expand: leave
    `recallEpisodes` as-is and have AutopilotLearning re-embed each
    subject. Costs `O(N)` embedder calls per `discoverSuccessPatterns`
    invocation; with the existing batched + RVFOptimizer-compressed
    path (`agentdb-service.ts:1672-1716`) this is acceptable for
    N=10000 cap.

### Public surface changes

* `DiscoveredPattern.pattern` semantics widen from "single ≥4-char
  token" to "human-readable cluster label (single token OR top-3
  tokens joined by `+`)". Stays a `string`; consumers that string-format
  the field unchanged. Recommendation rendering at
  `autopilot-learning.ts:660-664` still works.
* `LearningMetrics` gains `engine: 'keyword' | 'embedding-cluster'`
  (additive; safe).
* `AgentDBLike` gains an optional
  `recallEpisodesWithEmbeddings?` member (additive; test doubles
  unaffected because it's optional).

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
