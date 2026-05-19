---
status: proposed
date: 2026-05-19
methodology: [MADR]
decision-makers: [Henrik Pettersen]
tags: [autopilot, learning, federated, quic, crdt, phase5, ADR-0193, ADR-059]
related: [0192, 0193, 0194, 0195]
upstream-related: [agentic-flow/ADR-059]
audience: ai-executor
---

# ADR-0196: AutopilotLearning Phase 5 — federated learning interface (runtime deferred)

## Context and Problem Statement

ADR-0193 §G defers Phase 5 to a sub-ADR. Phase 5's promise: episodes shared across ruflo installs via QUIC/CRDT.

The honest constraint: there is no multi-instance runtime infrastructure in the current dev setup. Defining the interface is buildable; running it requires either (a) building a federation server, or (b) using an existing one. This ADR scopes the INTERFACE only — runtime is deferred to a federation-infrastructure ADR not yet written.

## Decision Drivers

* **Interface stability before runtime**: defining `FederatedSyncProvider` lets Phase 4's EventEmitter consumers eventually fan out without re-shaping the AutopilotLearning surface.
* **No runtime commitment**: avoid building federation infra before there's signal it's needed.
* **CRDT/QUIC affinity**: ruflo's distributed paths already use these (e.g., agentdb's QUIC sync); the interface should be CRDT-friendly so it composes with existing infrastructure when one's chosen.

## Considered Options

### Option 1 — Define `FederatedSyncProvider` interface; ship no-op default (chosen if accepted)

AutopilotLearning takes an optional `syncProvider: FederatedSyncProvider` in its constructor. Default is a `NoOpFederatedSyncProvider` that does nothing. Real providers (server-backed, peer-mesh, etc.) get added in separate ADRs when prioritized.

```ts
interface FederatedSyncProvider {
  pushEpisode(ep: AutopilotEpisode): Promise<void>;
  pullRemoteEpisodes(since: number): Promise<AutopilotEpisode[]>;
  // CRDT-friendly: episodes are append-only; resolution is by timestamp + nodeId.
}
```

### Option 2 — Build federation server alongside the interface

Heavier; couples runtime to interface and forces a server-choice decision before there's a use case.

### Option 3 — Defer the whole thing including interface

Acceptable but means later AutopilotLearning consumers can't even depend on the SHAPE of federation. Loses the "interface defined, runtime deferred" partial-progress option that ADR-0193 §G explicitly asked for.

## Decision Outcome

**Deferred — status proposed.** Implementation waits for either (a) a concrete cross-install use case OR (b) a federation infrastructure ADR that picks the runtime.

## Scope when interface ships

* `FederatedSyncProvider` interface defined in `forks/agentic-flow/agentic-flow/src/coordination/federated-sync-provider.ts`.
* `NoOpFederatedSyncProvider` default implementation.
* `AutopilotLearning` constructor takes `{ syncProvider?: FederatedSyncProvider }`.
* `_record` calls `this._syncProvider.pushEpisode(ep)` after persisting locally.
* Test: with no-op provider, episodes still persist locally; with mock provider, push is called per episode.

## Closure

When implemented:

* Interface defined + default + tests.
* Status flips to `implemented`.
* A separate "federation runtime" ADR is opened (or deferred indefinitely).

## Out of scope

* The actual federation runtime (server, peer mesh, sync protocol implementation).
* Cross-install identity / authentication.
* Conflict resolution beyond timestamp-ordering of append-only episodes.
* Bandwidth / quota / privacy controls.

## Risk

* **Interface decay**: an unused interface drifts from real needs. Mitigation: revisit when the runtime ADR is opened; rewrite the interface based on actual usage rather than today's speculation.
* **False sense of progress**: shipping the no-op default reads as "Phase 5 done" when it functionally isn't. Mitigation: this ADR's `status` stays `proposed` until the runtime question is answered; closure is interface + runtime, not interface alone.
