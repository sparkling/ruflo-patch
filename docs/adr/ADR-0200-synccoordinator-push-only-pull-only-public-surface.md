---
status: accepted
date: 2026-05-19
tags: [federation, sync-coordinator, single-direction, ADR-0196, ADR-0199, agentdb-surface]
supersedes: []
depends-on: [0196, 0199]
implements: []
---

# Expose pushOnly() and pullOnly() public methods on SyncCoordinator

## Context and Problem Statement

ADR-0196's `FederatedSyncProvider` interface exposes `push()` and `pull()` as separate operations on the agentic-flow side. `SyncCoordinatorFederatedAdapter` (the agentic-flow implementation that wraps agentdb's `SyncCoordinator`) has to alias **both** of those calls to the same bidirectional `SyncCoordinator.sync()` under the hood, because that is the only public method on the agentdb side. The adapter then reports `itemsPushed` for `push()` callers and `itemsPulled` for `pull()` callers — but the wire traffic is identical in both cases. Wave-2 critique (INFO finding, security review `1ee7fcd`) flagged this; the docstring patch in `5503891` is the cosmetic fix.

The internal split is **already done**: `SyncCoordinator.pushChanges()` (line 248) and `pullChanges()` (line 385) are independent private methods. `sync()` orchestrates `detectChanges → pushChanges → pullChanges → resolveConflicts → applyChanges → saveSyncState`. A push-only or pull-only public surface needs only to expose the existing internal methods, plus `saveSyncState` book-keeping.

A caller that wants `push()` today pays for the inbound `pullChanges` traffic + conflict resolution + `applyChanges` write barrier they did not ask for. A caller that wants `pull()` similarly forces an outbound `pushChanges` they did not request. For low-bandwidth peers or unidirectional flows (e.g. an archive node that only consumes, a leaf agent that only emits), this doubles wire cost and write contention.

The question: do we extend the agentdb `SyncCoordinator` public surface with `pushOnly()` and `pullOnly()`, or keep aliasing in the adapter?

## Decision Drivers

* Wire cost — round-trip and bytes are non-trivial under federation load (≥100 RPS per peer per ADR-0108's roadmap).
* Caller honesty — the adapter currently lies about what `push()`/`pull()` does (docstring acknowledges, but the API still pretends to be one-direction).
* Implementation cost — the split already exists in private methods; the marginal cost is two thin public wrappers + state book-keeping.
* Backwards compatibility — `sync()` must remain unchanged. Existing callers continue to work without modification.
* Conflict-resolution coupling — `pullChanges()` returns conflicts that `sync()` resolves via `resolveConflicts()`. A `pullOnly()` call must decide whether to resolve conflicts inline (consistent with `sync()`) or surface them to the caller. Decision: resolve inline to keep symmetry with `sync()`.
* Auth + rate-limit — `pushOnly`/`pullOnly` should reuse the same `MutationContext` threading and audit-write contract as `sync()` so ADR-0180 guarantees aren't lost.

## Considered Options

* **Option 1 — Add `pushOnly(ctx, onProgress)` and `pullOnly(ctx, onProgress)` public methods to `SyncCoordinator`** that internally call `detectChanges` (push-side only) + `pushChanges` + `saveSyncState`, or `pullChanges` + `resolveConflicts` + `applyChanges` + `saveSyncState`. Adapter rewires.
* **Option 2 — Add a `direction: 'push' | 'pull' | 'both'` parameter to the existing `sync()` method** (default `'both'`). One method, three modes.
* **Option 3 — Keep aliasing in the adapter** (current state). Docstring already documents the limitation per `5503891`. No agentdb change.
* **Option 4 — Move `pushOnly`/`pullOnly` to the adapter layer only**, reaching into `SyncCoordinator`'s private methods via TypeScript `private` softening or a leaky accessor. No public agentdb surface change.

## Decision Outcome

**Chosen: Option 1 — separate `pushOnly()` and `pullOnly()` public methods on `SyncCoordinator`.**

Rationale:

* The internal split exists already. Two thin wrappers (~30 LOC each) are cheaper than a parameter-driven `sync(direction)` redesign (Option 2) which would force every existing caller to provide the default + maintain branch logic inside `sync()`.
* Option 3 leaves the docstring lie standing — a known sharp edge that future implementers will trip on. Wave-2 critique flagged it; the right fix is to remove the lie, not document it harder.
* Option 4 (reach into private methods) breaks encapsulation and creates an implicit ABI between the adapter and `SyncCoordinator` internals. Refactors in `SyncCoordinator` would silently break the adapter.
* `MutationContext` threading + audit-write semantics carry over unchanged — `pushOnly`/`pullOnly` accept the same `ctx` parameter and call `saveSyncState(ctx)` exactly as `sync()` does. ADR-0180 guarantees preserved.

### Consequences

* Good, because `FederatedSyncProvider.push()`/`pull()` finally honour their interface contract — wire traffic now matches the named direction.
* Good, because the cost of wave-2's adapter critique INFO finding gets paid down, removing a documented sharp edge.
* Good, because callers with unidirectional flows (archive nodes, leaf agents) get the bandwidth saving they expected when they wrote `push()` instead of `sync()`.
* Bad, because the agentdb `SyncCoordinator` public surface grows by two methods. Larger surface = more API maintenance.
* Bad, because `pushOnly` callers no longer see remote changes accumulating — they may need to call `pullOnly` (or `sync()`) periodically to stay current. Caller responsibility, not a regression in `sync()` semantics.
* Neutral, because `sync()` itself is unchanged. Existing callers carry on; opt-in to the new methods only when the unidirectional cost matters.
* Neutral, because `pushOnly` does NOT call `detectChanges` for the remote side and `pullOnly` does NOT push local changes — that's the whole point. Conflict resolution still runs in `pullOnly` (we keep the `resolveConflicts` step) because pulled data may conflict with local state and the caller should not have to repeat that orchestration.

### Confirmation

* Unit + integration tests in `forks/agentdb/tests/integration/` cover:
  * `pushOnly()` emits the push wire-traffic and `saveSyncState`s without ever calling `pullChanges`.
  * `pullOnly()` emits the pull wire-traffic and runs `resolveConflicts` + `applyChanges` + `saveSyncState`, without ever calling `pushChanges`.
  * `SyncCoordinatorFederatedAdapter.push()` and `.pull()` now route to the new methods (no more bidirectional alias).
* Docstring patch from `5503891` superseded by a new docstring on the adapter pointing at this ADR.
* `npm run release` acceptance gate continues to pass (the controller-stack roundtrip test stays green).

## Pros and Cons of the Options

### Option 1 — Separate public methods (chosen)

* Good, because honours the `FederatedSyncProvider` interface contract.
* Good, because minimal code (~30 LOC × 2) — internal split already exists.
* Good, because preserves `sync()` semantics for existing callers.
* Bad, because two new public methods to maintain.

### Option 2 — Parameter-driven `sync(direction)`

* Good, because single method to maintain.
* Bad, because every existing `sync(ctx)` caller has to either provide `'both'` explicitly or trust a default. Branch logic in `sync()` makes the orchestrator harder to reason about.
* Bad, because the parameter is enum-y — `'push' | 'pull' | 'both'`. Easy to typo, easy to default wrong.

### Option 3 — Keep aliasing in adapter (status quo)

* Good, because no agentdb change.
* Good, because docstring already documents the limitation.
* Bad, because `push()` and `pull()` still lie about what they do — wave-2 critique INFO finding stays open.
* Bad, because callers pay 2× wire cost when they only wanted one direction.

### Option 4 — Reach into private methods from adapter

* Good, because no public-surface change.
* Bad, because TypeScript `private` is only a compile-time hint; calling `coordinator['pushChanges']` works but creates an implicit ABI.
* Bad, because refactors of `SyncCoordinator` internals silently break the adapter.

## More Information

* **Parent ADR**: [ADR-0196](./ADR-0196-autopilot-learning-phase5-federated-interface.md) — Phase 5 federated interface. Defines `FederatedSyncProvider` and the `push()`/`pull()` semantics on the consumer side.
* **Transport ADR**: [ADR-0199](./ADR-0199-quic-transport-binding-selection.md) — picks the binding under the adapter.
* **Wave-2 critique INFO finding** that motivated this: `docs/security/adr0191-and-followups-review.md` — adapter `push()`/`pull()` both aliased to bidirectional sync.
* **Adapter docstring patch** that flagged the limitation as architectural follow-up: agentic-flow commit `5503891`.
* **Internal method locations** in `forks/agentdb/src/controllers/SyncCoordinator.ts`:
  * `pushChanges()` — line 248 (private)
  * `pullChanges()` — line 385 (private)
  * `resolveConflicts()` — referenced from `sync()` at line 155
  * `applyChanges()` — line 527
  * `saveSyncState()` — invoked at line 168 in `sync()`
* **Out of scope** for this ADR:
  * Per-table direction selection (`pushOnly({ tables: ['episodes'] })`). Today's flag is direction-only; per-table opt-out tracks ADR-0196 §"Open questions" item 1.
  * A `peek()` method that returns pending pull data without applying. Speculative; revisit when a use case appears.
