---
status: accepted
date: 2026-06-11
tags: [intelligence, observability, stats, batch-u-followup, upstream-port]
supersedes: []
depends-on: [ADR-0290]
implements: []
---

# Unified learning-stats read-through view

## Context
Upstream `ca77f8307` adds `getUnifiedLearningStats()` — a read-through VIEW over
the 4 learning stores with cross-store drift flagging. Batch-U deferred (the
mechanism was SUPERSEDE'd by ADR-0290, but the observability *view* is portable).

## Decision
`intelligence.ts` `getUnifiedLearningStats()` aggregates the fork's 4 stores
(globalStats, sona, memory-bridge, neural) + flags cross-store drift; exposed via
the `hooks_intelligence_unified-stats` MCP tool. Mechanism-neutral — read-only,
does NOT touch the ADR-0290 learning seam. Fork adaptations: `getMemoryBridgeStats`
from memory-tools (no `memory-bridge.ts` in fork), `getNeuralStoreStats` from
neural-tools, fork's actual SONA stats shape.

## Consequences
Good: honest "store A says N, store B says 0" reconciliation surface.
Neutral: drift test asserts the contract (notes reflect bridge state), not a
brittle env-dependent reachability bool.

## Confirmation
adr0326 vitest (4-store view + drift flag). tsc clean. forks/ruflo `bf8d585f9`.
