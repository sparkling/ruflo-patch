# Task #98 — `hive-mind/consensus.ts` per-strategy split — scoping plan

**Author**: architecture-agent under /loop self-pacing (2026-05-17)
**Status**: PLAN ONLY — awaiting green-light before any commits land
**Estimated total**: ~1,280 LoC across 6 independently-revertable commits
**Blocker history**: ADR-0181 Phase 8 stub-porter deferred this (1000+ LoC strategy fan-out in cli's `hive-mind-tools.ts` lines 1984-3138; cli's own deferral comment says "needs per-strategy split first")

## 1. Strategy × Action matrix (6 strategies + 1 wire alias)

| Strategy | propose | vote | status | list |
|---|---|---|---|---|
| **bft** (alias `byzantine` normalised at entry) | new pending; required = ceil(2n/3)+1 | tally; flip on threshold | passthrough | passthrough |
| **raft** | guard: existing same-term pending → error; honour `timeoutMs` | tally majority; honour term | timeout re-propose path | passthrough |
| **quorum** | `quorumPreset` → required; unanimous short-circuits on any "no" | tally; unanimous reject on first against | ADR-0131 T12 auto-transition on timeout → `failed-quorum-not-reached` (**mutating!**) | passthrough |
| **weighted** (ADR-0119) | guard: `state.queen` required; denom = (n−1)+QUEEN_WEIGHT(3) | weightedTally; queen counts 3× | same auto-transition as quorum | passthrough |
| **gossip** (ADR-0120) | snapshot totalNodes; init gossipRound=0 | settleCheckGossip; advance round on `roundTimeoutMs`; force-settle on hard budget `2×ceil(log2 N)` (**mutating!**) | force-settle path mutates | passthrough |
| **crdt** (ADR-0121) | snapshot `crdtExpectedVoters`; init CRDTState | `mergeCRDTState` (pure JSON); short-circuit converged | force-settle on `roundTimeoutMs` (**mutating!**) | passthrough |

## 2. Per-strategy split shape — RECOMMENDATION

**One handler file, internal dispatcher to per-strategy modules.** Registry holds ONE name (`hive-mind_consensus`); the split is *internal* to that handler. Layout:

```
handlers/hive-mind/consensus.ts                 (registered dispatcher, ~120 LoC)
handlers/hive-mind/consensus/normalize.ts       (byzantine→bft, action validation)
handlers/hive-mind/consensus/{bft,raft,quorum,weighted,gossip,crdt}.ts
handlers/hive-mind/consensus/shared/            (calculateRequiredVotes, checkProposalResolution, weightedTally, gossipFanout, selectGossipTargets — extracted verbatim from cli)
```

Each strategy module exports `propose(state, payload)` / `vote(state, payload)` and a `settle(proposal, now)` predicate. Dispatcher: normalise → load → `ctx.substrate.withWrite` → action-switch → strategy-switch → return.

## 3. Capability surface

**None new.** Today's hive-mind handlers use FS-JSON substrate via `ctx.substrate.withWrite({storeId: 'hive-mind_consensus'})`. The cli's `withHiveStoreLock` collapses into the substrate write (lock owned by primitive). Charter-check on `consensus.ts` passes today (header already says `dispatch`).

## 4. Phase plan (6 commits, each shippable)

| # | Work item | LoC | Commit message stem |
|---|---|----:|---|
| 1 | Register stub-dispatcher with action-switch wired to **per-strategy module imports that throw `not-yet-ported`**; uncomment barrel export; verify charter-check + type-check + skip-accepted acceptance | ~80 | `feat(agentdb): register hive-mind_consensus dispatcher shell` |
| 2 | Port `shared/` helpers (`calculateRequiredVotes`, `checkProposalResolution`, `weightedTally`, `gossipFanout`, `selectGossipTargets`, `MissingQueenForWeightedConsensusError`) verbatim from cli | ~250 | `feat(agentdb): extract consensus shared helpers from cli` |
| 3 | Wire **bft + raft + quorum** (3 of 6; share `checkProposalResolution`); flip cli `hive-mind_consensus` to dispatch ONLY when `strategy ∈ {bft,raft,quorum,byzantine}` | ~300 | `feat(agentdb): port bft/raft/quorum consensus strategies` |
| 4 | Wire **weighted** (queen guard) + cli flip extends to `weighted` | ~150 | `feat(agentdb): port weighted consensus strategy (ADR-0119)` |
| 5 | Wire **gossip** (round/fanout/settle); cli flip extends to `gossip` | ~250 | `feat(agentdb): port gossip consensus strategy (ADR-0120)` |
| 6 | Wire **crdt** (mergeCRDTState/CRDTState); cli flip extends to `crdt`; remove cli `withHiveStoreLock` outer wrapper; remove cli action-switch body | ~250 | `feat(agentdb): port crdt consensus + retire cli implementation` |

Commit 1 unblocks the structural foundation (registry resolves, no "not registered" throws). Each subsequent commit is independently revertable.

## 5. Test plan

`forks/agentdb/test/archivist/handlers/hive-mind/consensus/<strategy>.test.ts` — 6 files. Each gets: propose-happy, vote-resolves-approved, vote-resolves-rejected, status-readback. Strategy-specific: raft term-collision, quorum unanimous-short-circuit, weighted no-queen throws, gossip force-settle on round budget, crdt mergeCRDTState convergence, ADR-0131 quorum/weighted auto-status-transition. Acceptance: existing `adr0181` + `adr0119/0120/0121` checks already cover the cli path end-to-end — they flip from `skip_accepted` to PASS as commits 3-6 land, providing built-in regression coverage.

## 6. Risks / unknowns that would NACK

- **CRDT types import path** — `cli/src/mcp-tools/crdt-types.ts` lives in cli. Must port to `agentdb/src/archivist/handlers/hive-mind/consensus/crdt-types.ts`; no cli→agentdb dep allowed.
- **`saveHiveState` substrate parity** — cli writes `state.json` flat; archivist convention is `{key:'root'}` wrapping (per Phase 6). Verify `loadHiveState` unwrap covers both, OR commit 1 also ports the wrapping convention. If `state.consensus` lives under `state.root.consensus` in dispatch reads but cli reads flat, votes silently lose. Pre-flight (per handover §K): trace cli's `loadHiveState` unwrap path before commit 1.
- **`withHiveStoreLock` reentrancy** — `substrate.withWrite` already holds the lock. If cli's outer `withHiveStoreLock` (still wrapping the dispatch call in commits 3-5) creates O_EXCL collision, dispatch deadlocks. Commit 6 must remove the cli outer wrapper; if it can't be removed earlier without breaking single-strategy commits, restructure: defer cli flip to a separate commit 7.
- **ADR-0131 T12 reconciliation as mutating-status** — status action mutates (forces transition). Handler is `GuardedWrite` (spec-compatible), but invariants array currently `[]`. Author of T12 invariants should sign off on whether reconciliation needs an invariant entry before commits 3-6 land.

## Decision point for green-light

The user should pick one:

(a) **Land commit 1 only** as a low-risk structural anchor — dispatcher shell, all strategies throw `not-yet-ported`, registry resolves, charter passes. ~80 LoC. Unblocks future loops without behavior change today.

(b) **Land commits 1-3** as a coherent first delivery — covers bft/raft/quorum (the simplest 3 strategies, no consensus algorithms beyond majority/threshold). Gives real coverage for the most common cli usage. ~630 LoC, real risk of `loadHiveState` parity or `withHiveStoreLock` collision.

(c) **Defer the entire program** — bank this plan as the authoritative scoping doc; revisit when ADR-0131 invariants author is available + the cli `loadHiveState` parity trace is done.

The Phase 8 stub-porter chose (c) per cli's own deferral comment. Default for this loop: **(c)** — landing commit 1 in isolation buys little without commits 3-6, and the risks (loadHiveState parity, withHiveStoreLock reentrancy) need a cli-adapter-trace pre-flight that didn't happen yet.
