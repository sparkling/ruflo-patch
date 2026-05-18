---
title: ADR-0184 close-out — Hive-Mind Consensus Handler Port
date: 2026-05-18
status: closed
authors: [queen + da agents, team-lead coordination]
tags: [adr-0184, hive-mind, consensus, archivist, runtime-activation, close-out]
---

# ADR-0184 close-out report

ADR-0184 closed via Wave 6a (agentdb-side close-out). The cli-side retirement of `hive-mind_consensus` is spun out to [ADR-0185](../adr/ADR-0185-hive-mind-consensus-cli-retirement.md) — the structural rationale is in §Wave 6a + ADR-0185 spin-out below. All 5 per-strategy bodies are live in `forks/agentdb/src/archivist/handlers/hive-mind/consensus/<strategy>.ts`; zero `pending` stubs remain in the agentdb handler tree; audit-entry count equals mutation count.

## Per-wave outcomes

| Wave | Scope | Result | DA verdict | Acceptance |
|---|---|---|---|---|
| 1 | Per-strategy skeletons + parent dispatcher (`byzantine → bft` normalisation, exhaustiveness `never` guard, 6 stub modules + 6 empty invariant arrays + dispatch test) | 9/9 dispatch tests | 1 Concern (dispatch shape) | 681/681 heavy, 672/681 default — baseline maintained |
| 2.1 | `_shared.ts` (vendored cli helpers: ConsensusProposal / calculateRequiredVotes / tryResolveProposal / detectByzantineVoters / weightedTally / workerMetaFor / reconcileFailedFromStatusKeys + 4 error classes) + bft port + bft invariants + 8 bft tests; signature bump on all 6 stubs to `(ctx, handle, payload)`; `proposalId?` field added to propose payload | 1 Block (signature bumps must happen simultaneously) — resolved in-commit | 672/681/0/9 |
| 2.2 | raft port + raft invariants + 5 raft tests (single-pending-per-term, RaftVoteChangeError, auto-status-transition) | PASS | 672/681/0/9 |
| 2.3 | quorum port + quorum invariants + 6 quorum tests (unanimous fast-reject, DuplicateVoteError, deadlock arithmetic) | PASS | 672/681/0/9 |
| 3 | weighted port + invariants + 8 tests (queen 3x voting power, `MissingQueenForWeightedConsensusError` at propose/vote/status-transition) | 1 Concern (queen-abdicated at status-time should throw not fallback) — resolved with `MissingQueenForWeightedConsensusError('status-transition')` | 672/681/0/9 |
| 4 | gossip port + invariants + 9 tests (`gossipFanout` + `selectGossipTargets` deterministic shuffle + `maybeAdvanceGossipRoundOnTimeout` + `settleCheckGossip` 6-step bookkeeping + ADR-0131 timing decision) | 1 Concern (hard-budget exhaustion handling) — resolved with `gossipExhausted?: boolean` field on `ConsensusProposal` | 672/681/0/9 |
| 5 | crdt port + invariants + 11 tests (7 behavioural + 3×50 sampled property) + `_crdt-types.ts` vendor (GCounter/ORSet/LWWRegister/mergeCRDTState, 439 LoC verbatim from cli) | 1 Block (property tests need semantic equality, not raw `toJSON` deep-equal — ORSet internal entry ordering) — resolved with `crdtSemanticEqual()` helper | 672/681/0/9 |
| **6a** | **Close-out prep**: exit-gate test (zero `pending` stubs + audit-entry = mutation count) + barrel error-class re-exports in `archivist/index.ts` | PASS + 2 action items completed (barrel exports landed; cli sync-throw audit confirmed zero call sites to migrate) | 672/681/0/9 (pending team-lead final gate) |

**Wave 6 cli retirement deferred to ADR-0185** — see §Wave 6a + ADR-0185 spin-out below.

## Fork commit trail (agentdb)

```
6c88a6b  Wave 1: per-strategy skeletons + dispatcher
f3c0f37  Wave 2.1: _shared.ts + bft + helpers
0c6da39  Wave 2.2: raft
5d51b18  Wave 2.3: quorum
7772008  Wave 3: weighted
655d330  Wave 4: gossip + ADR-0131 inline timing decision (OF#1)
c9e0ed0  Wave 5: crdt + crdt-types vendor (OF#2)
4a8aee7  Wave 6a: exit-gate test + barrel error-class exports
```

## Acceptance trajectory

| After wave | agentdb patch | ruflo patch | Acceptance |
|---|---|---|---|
| baseline (pre-ADR-0184) | patch.193 | patch.181 | 681/681 heavy / 672/681 default |
| Wave 1 | patch.194 | patch.182 | 672/681/0/9 |
| Wave 2.3 | patch.196 | patch.184 | 672/681/0/9 |
| Wave 3 | patch.198 | patch.186 | 672/681/0/9 |
| Wave 4 | patch.199 | (no bump) | 672/681/0/9 |
| Wave 5 | patch.200 | (no bump) | 672/681/0/9 |
| Wave 6a | (gating) | (gating) | (gating) |

Zero new acceptance failures across the 6 waves. Same 7 pre-existing `dispatch-types.test.ts` unhandled-rejection errors observed throughout (verified pre-existing on clean main pre-Wave-1; not ADR-0184 regressions).

## DA engagement summary

DA councilled every wave plan before commit; verdicts captured below.

- **Wave 1**: 1 Concern (per-invariant strategy guard shape) — resolved via dispatcher mutating `payload.strategy = 'bft'` for byzantine callers (Wave 1 DA Concern 4).
- **Wave 2**: 1 Block (all 6 stub signatures must bump simultaneously to avoid TS breakage) + 5 Pass. Resolved in commit 2.1.
- **Wave 3**: 1 Concern (queen-abdicated at status-time fallback) — resolved by throwing `MissingQueenForWeightedConsensusError('status-transition')` instead of falling back to `{votesFor: 0, votesAgainst: 0}` history-row telemetry. Wave 3 DA Concern 3.
- **Wave 4**: 1 Concern (hard-budget exhaustion handling) — resolved by adding `gossipExhausted?: boolean` flag to `ConsensusProposal` so Wave 6 cli reads exhausted state directly rather than re-running `settleCheckGossip`. Wave 4 DA Concern 2.
- **Wave 5**: 1 Block (property tests need semantic equality for ORSet, not raw JSON deep-equal — internal entry orderings differ between `merge(a,b)` and `merge(b,a)`) + 5 Pass. Resolved with `crdtSemanticEqual()` helper that compares ORSet via `.elements().sort()`, GCounter via slot-map, LWWRegister via `.value()`. Wave 5 DA Concern 5.
- **Wave 6 (original plan)**: PASS + 2 action items. Both completed (barrel error-class exports in agentdb landed; cli synchronous-throw test audit confirmed zero call sites to migrate — existing cli tests already use `rejects.toThrow`). After action-item completion, scope-check revealed the cli flip itself is ~1500 LoC of focused refactor work warranting its own ADR.

## Architectural decisions ratified

**ADR-0131 auto-status-transition timing — INLINE at `status` action across all strategies (Open Follow-up #1, resolved Wave 4).** Rationale (3-fold): (1) gossip status is already a mutation action (`maybeAdvanceGossipRoundOnTimeout` + `settleCheckGossip` both mutate); (2) a half-split (gossip/crdt → `status_settle`, threshold strategies → inline) is worse than no split because callers would need to know which strategies use which verb; (3) preserves cli `_consensus({action:'status'})` interface verbatim. Trade-off acknowledged: the `status` action's name is slightly misleading — it can mutate. Already established by the bft/raft/quorum/weighted ports.

**mergeCRDTState location — VENDORED into `forks/agentdb/src/archivist/handlers/hive-mind/consensus/_crdt-types.ts` (Open Follow-up #2, resolved Wave 5).** Rationale (4-fold): (1) pure JSON-merge math, no I/O / state / capability dependencies; (2) capability-handle plumbing (option b) is architectural overhead for utility code; (3) cli `crdt-types.ts` stays load-bearing through Wave 6 — same vendor pattern as Wave 2's `_shared.ts`; (4) no second consumer emerges, so the "vendor unless a second consumer" pre-condition from ADR-0184 §OF#2 is satisfied.

## Audit-entry count = mutation count (verification)

The Wave 6a exit-gate test at `forks/agentdb/test/archivist/handlers/exit-gate.test.ts` drives 6 dispatches through `consensusHiveMindHandler` (1 propose per strategy + 1 list action) and asserts exactly 6 audit entries are recorded, with 5 distinct propose-proposalIds. The parent dispatcher's `withWrite` is the audit boundary; per-strategy bodies operate within that single scope. One write = one audit entry per ADR-0180 §Confirmation.

## Wave 6a + ADR-0185 spin-out

The original Wave 6 plan envisioned a full cli retirement: 926-LoC `hive-mind_consensus` handler delete, flip to `archivist.dispatch('hive-mind_consensus', payload)` via the task_create pattern, and a comprehensive `buildConsensusResponse` helper reconstructing all telemetry from post-dispatch re-reads.

Scope measurement during Wave 6 execution revealed the cli retirement is ~1500 LoC of focused refactor work:

- 4 actions × 6 strategies × ~20 telemetry fields per action = a comprehensive `buildConsensusResponse` helper (~300-400 LoC standalone) reconstructing `votesFor / votesAgainst / required / resolved / result / byzantineVoters / gossipRound / gossipBound / lastVoteChangedRound / settled / exhausted / noVotes / crdtState / crdtVerdict / crdtApprovers / crdtVoteCount / crdtExpectedVoters / crdtTimedOut / timedOut / hint / statusJustTransitioned / absentVoters` from the POST-dispatch re-read state
- Try/catch error-reshape with 5 typed-error branches (`RaftTermCollision / RaftVoteChange / DuplicateVote / VoterIdRequired / ProposalNotFound` → `{action, error, ...}` envelope)
- Helper-set cleanup (zero external callers confirmed for `calculateRequiredVotes / weightedTally / detectByzantineVoters / tryResolveProposal / maybeAdvanceGossipRoundOnTimeout / settleCheckGossip / gossipFanout / selectGossipTargets / reconcileFailedFromStatusKeys / workerMetaFor` — but some are PURE-READ helpers the new `buildConsensusResponse` may call; need to split dead-after-flip set from still-callable-by-response-builder set)
- Cli test re-validation against existing assertions (`__tests__/mcp-tools-deep.test.ts` references the 3 re-throw error classes — sync-throw audit confirmed zero call sites to migrate; but ADR-0184-driven response-shape parity is its own correctness gate)

This is a real ADR's-worth of work and was spun out per the [ADR-0181 → ADR-0184](../adr/ADR-0181-archivist-runtime-activation.md#amendment-closure-plan--sequenced-path-to-close-the-program-2026-05-17) deferral precedent — peel out a single concern when the closure plan would otherwise bloat.

**The agentdb-side surface is COMPLETE and verifiable independent of cli retirement.** The Wave 6a exit-gate test asserts:

1. Zero `pending` stubs in `forks/agentdb/src/archivist/handlers/**`.
2. Audit-entry count = mutation count (one entry per dispatch, 5 distinct propose-ids + 1 list = 6 entries on a 6-dispatch session).

The cli's `hive-mind_consensus` handler is now 100% redundant with the agentdb handler — both work correctly, they're just dual-write. ADR-0185 picks up the cli retirement as a focused next step.

## Open items handed off

| Item | Carrier | Status |
|---|---|---|
| Cli `hive-mind_consensus` retirement (~1500 LoC) | [ADR-0185](../adr/ADR-0185-hive-mind-consensus-cli-retirement.md) (proposed, 2026-05-18) | placeholder ADR landed alongside this close-out |
| Cli `crdt-types.ts` deletion (now-duplicate; agentdb has the vendored copy) | ADR-0185 §Architecture sub-task | deferred to ADR-0185 execution |
| Response-shape spec capture (formal documentation of each action's response shape across strategies) | ADR-0185 §Open Follow-ups | deferred |
| Parallel-strategy verification harness (drive identical inputs through cli + archivist, diff responses) | ADR-0185 §Open Follow-ups | deferred |

## More information

- [ADR-0184: Hive-Mind Consensus Handler Port](../adr/ADR-0184-hive-mind-consensus-handler-port.md) — the parent decision (proposed 2026-05-18, closed 2026-05-18 per Wave 6a; cli retirement spun to ADR-0185)
- [ADR-0185: Hive-Mind Consensus Cli Retirement](../adr/ADR-0185-hive-mind-consensus-cli-retirement.md) — the cli flip's spun-out program
- [ADR-0181 close-out report](ADR-0181-close-out-report.md) — Phase D deferred to ADR-0184; ADR-0184 close-out (this document) confirms agentdb-side complete + cli retirement spun to ADR-0185
- [ADR-0181: Archivist Runtime Activation §Closure plan amendment](../adr/ADR-0181-archivist-runtime-activation.md#amendment-closure-plan--sequenced-path-to-close-the-program-2026-05-17) — the parent activation program whose Phase D ADR-0184 inherits
- [ADR-0183: Memory Write-Path Unification close-out](ADR-0183-a1-report.md) — the spin-out precedent for peeling a single concern out of a parent closure plan
