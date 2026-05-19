---
status: proposed
date: 2026-05-19
methodology: [MADR]
decision-makers: [Henrik Pettersen]
tags: [autopilot, learning, sona, cross-controller, phase4, ADR-0193, ADR-059]
related: [0192, 0193, 0194]
upstream-related: [agentic-flow/ADR-059]
audience: ai-executor
---

# ADR-0195: AutopilotLearning Phase 4 — cross-controller bridges

## Context and Problem Statement

ADR-0193 §G defers Phase 4 to a sub-ADR. Phase 4's promise:

1. Hook for `LearningSystem` to consume autopilot outcomes and update its algorithm-recommendation weights.
2. SONA RL trajectory feedback loop: trajectories recorded in ADR-0193 Item B feed back into SONA's policy updates.

Today AutopilotLearning is an isolated producer: writes episodes and trajectories, exposes `getMetrics` / `getReEngagementContext`. Other controllers don't react. The trajectories Item B records are stored but not consumed — that's the open risk ADR-0193 §Risks Item B explicitly named ("trajectories recorded without a consumer").

## Decision Drivers

* **Risk discharge for ADR-0193 §B**: trajectories without consumers are storage; Phase 4 turns them into signal.
* **Loose coupling**: AutopilotLearning ↔ LearningSystem must not become a tight import dependency. Use event-emitter or message-bus pattern.
* **No regression on isolated mode**: AutopilotLearning must keep working when LearningSystem isn't subscribed.

## Considered Options

### Option 1 — EventEmitter on AutopilotLearning (chosen if accepted)

Add `learning.events: EventEmitter`. Emit `episode:recorded`, `trajectory:opened`, `trajectory:closed`. LearningSystem subscribes via `learning.events.on(...)`. No mutual import.

### Option 2 — Message-bus (e.g., AgentDB-backed pub/sub)

Heavier; useful only if cross-process consumers exist. Phase 4 is in-process per ADR-059; defer the bus.

### Option 3 — Shared callback registry

AutopilotLearning exposes `registerOutcomeConsumer(fn)`. Consumers register functions called on every episode. Functionally similar to EventEmitter but less idiomatic for Node.

## Decision Outcome

**Deferred — status proposed.** Implementation waits for a concrete consumer requirement (likely: SONA's `addStep` reward shaping benefits from autopilot's actual rewards, which the in-process EventEmitter enables).

## Scope when implemented

* Add `learning.events: EventEmitter` field.
* Emit on `_record` (post-storeEpisode), `recordIterationStep` (post-counter-bump), `endSwarmTrajectory` (post-endTrajectory).
* Document the event payload contract.
* LearningSystem wires `learning.events.on('episode:recorded', updateWeights)` in its bootstrap.
* Add a test asserting that episodes emitted by AutopilotLearning trigger LearningSystem weight updates.

## Closure

When implemented:

* Both subscribers wired.
* Tests pass.
* Status flips to `implemented`.

## Out of scope

* Federation of events across installs (that's ADR-0196 Phase 5).
* Persistent event log — events are transient; episodes/trajectories are persistent on their own.
