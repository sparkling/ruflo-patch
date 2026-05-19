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

# ADR-0194: AutopilotLearning Phase 3 — GNN-enhanced pattern discovery

## Context and Problem Statement

ADR-0193 §G defers AutopilotLearning's Phase 3 (per upstream ADR-059's scoping) to a dedicated sub-ADR. The current Phase 2 implementation aggregates patterns by keyword frequency over subject tokens (`_aggregatePatterns` in `autopilot-learning.ts`). This finds repeated words but misses structural similarity (e.g., "react bug fix" and "frontend defect resolution" cluster only if they share a literal token ≥4 chars).

Phase 3's promise: use `@sparkleideas/ruvector-gnn` (already an optional dependency, lazy-loaded by `gnn-router-service.ts`) to build a task-similarity graph over episodes and discover patterns via graph clustering rather than just keyword frequency. The output of `discoverSuccessPatterns` becomes richer, surfacing semantic clusters rather than lexical buckets.

## Decision Drivers

* **Phase 2 is keyword-only**: lexical aggregation misses semantically related episodes.
* **`@sparkleideas/ruvector-gnn` already available**: 8-head GAT-style model, lazy-loadable, no new dependency cost.
* **AutopilotLearning's existing `_aggregatePatterns` is the swap point**: keep the public surface (`DiscoveredPattern[]`) stable; swap the internal algorithm.

## Considered Options

### Option 1 — Graph clustering over embeddings (chosen if accepted)

Build a task-similarity graph from episode subject embeddings. Edge weight = cosine similarity. Run GNN-based clustering (Louvain or similar via ruvector-gnn). Each cluster becomes one `DiscoveredPattern` with `pattern` = top-3 representative tokens from the cluster centroid, `frequency` = cluster size, `avgReward` = mean reward over cluster members.

### Option 2 — Hybrid: keyword + GNN reranking

Keep Phase 2's frequency aggregation, then GNN-rerank the top-K patterns by semantic coherence. Simpler integration but doesn't catch the lexically-different semantically-similar case.

### Option 3 — Defer indefinitely

Leave Phase 2 as the final state. Acceptable if no production signal demands richer patterns.

## Decision Outcome

**Deferred — status proposed.** This ADR documents the scope so it doesn't decay. Implementation prioritization waits for a concrete signal (e.g., a populated AutopilotLearning instance where Phase 2's keyword patterns are demonstrably under-clustering).

## Scope when implemented

* Lazy-load `@sparkleideas/ruvector-gnn` via the same pattern as `gnn-router-service.ts`.
* Replace `_aggregatePatterns` with a graph-clustering pass over episode embeddings (embeddings already exist from Item A.2's `recallSimilarTasks` swap).
* Preserve the `DiscoveredPattern` public shape so consumers (Stop hook, `getReEngagementContext`) need no changes.
* Add a populated test asserting Phase 3 finds cross-lexical clusters that Phase 2 misses (e.g., {"react bug fix", "frontend defect resolution", "ui regression"} → one pattern).

## Closure

When implemented:

* `discoverSuccessPatterns` returns GNN-clustered patterns.
* Existing tests still pass.
* New test demonstrates cross-lexical clustering.
* Status flips to `implemented`.

## Out of scope

* Cross-controller GNN training (that's ADR-0195 Phase 4).
* Federated sharing of patterns across installs (that's ADR-0196 Phase 5).
* Persisting GNN-discovered patterns to a separate store — they're derived on-demand from episodes.
