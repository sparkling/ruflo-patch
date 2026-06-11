---
status: proposed
date: 2026-06-11
tags: [memory, hybrid-search, entity, rrf, batch-u-followup, upstream-port]
supersedes: []
depends-on: [ADR-0068]
implements: []
---

# Entity arm + signal provenance in hybridSearch

## Context
The fork's `hybridSearch` fused only dense + sparse arms. Upstream `b099b705f`
(ADR-147) adds an entity-tagging retrieval arm + per-result signal provenance.
Batch-U deferred follow-up; re-homed under the fork's ADR-125 P5 lineage.

## Decision
New `v3/@claude-flow/memory/src/entity-tagger.ts` (`extractEntities`:
emails/URLs/paths/quoted/proper-noun 2-grams). `controller-registry.ts`
`hybridSearch` becomes a 3-arm `Promise.all` RRF (dense + sparse + per-entity
keyword) via the existing N-arm `applyRRF`, stamping `signals` provenance on
every fused result. The entity arm is lexical/FTS5 — NO mpnet (ADR-0068)
coupling. `signals` is purely additive (no existing consumer).

## Consequences
- Good: entity/proper-noun queries surface above vector noise; results carry
  honest provenance (`vector`/`bm25`/`entity`).
- Neutral: entity arm dropped from RRF when empty (can't dilute fusion).

## Confirmation
entity-tagger 12 tests (verbatim) + graceful-retrieval provenance + "entity arm
surfaces proper-noun matches" tests. tsc clean. forks/ruflo `92aa25e23`.
