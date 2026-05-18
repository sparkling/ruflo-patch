---
status: proposed
date: 2026-05-18
tags: [hive-mind, consensus, cli-retirement, archivist, runtime-activation]
depends-on: [ADR-0180, ADR-0181, ADR-0184]
implements: []
---

# ADR-0185: Hive-Mind Consensus Cli Retirement

## Context and Problem Statement

[ADR-0184](ADR-0184-hive-mind-consensus-handler-port.md) closed (2026-05-18, Wave 6a) with all 6 per-strategy bodies live in `forks/agentdb/src/archivist/handlers/hive-mind/consensus/<strategy>.ts`. The Wave 6a exit-gate test verifies zero `pending` stubs in the agentdb handler tree and audit-entry count = mutation count. Acceptance baseline maintained at 672/681/0/9 across all 6 waves.

The cli `hive-mind_consensus` handler at `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts` (lines 1984-2919, ~870 LoC handler body + ~50 LoC schema/header) is now **100% redundant** with the agentdb per-strategy handlers. Both surfaces work correctly; they are dual-write. ADR-0184 Wave 6 envisioned flipping the cli to a thin `archivist.dispatch('hive-mind_consensus', payload)` wrapper, but scope measurement during Wave 6 execution revealed the cli flip itself is a substantial focused refactor:

| Concern | Approximate scope |
|---|---|
| `buildConsensusResponse(state, action, strategy)` — reconstructs ~20 telemetry fields per action from POST-dispatch state | ~300-400 LoC standalone |
| Try/catch error-reshape (5 typed-error branches → `{action, error, ...}` envelope; 3 re-throw branches) | ~30 LoC |
| Helper-set cleanup (10 cli-local helpers: zero external callers confirmed; need to split dead-after-flip from still-callable-by-response-builder) | ~200 LoC delete + ~100 LoC keep |
| Cli test re-validation (existing assertions in `__tests__/mcp-tools-deep.test.ts` for response shapes, error classes, byzantine detection, gossip rounds, CRDT merges) | full re-run + per-assertion review |
| **Total** | ~1500 LoC of focused refactor work |

This spin-out follows the [ADR-0181 → ADR-0184](ADR-0181-archivist-runtime-activation.md#amendment-closure-plan--sequenced-path-to-close-the-program-2026-05-17) precedent (peel out a single concern when the closure plan would otherwise bloat). ADR-0184 Wave 6a delivered the agentdb-side correctness gates; ADR-0185 picks up the cli retirement as a focused next step.

## Decision Drivers

- `feedback-no-fallbacks` — every cli soft-`{action, error}` return must map cleanly to either a typed throw (reshaped post-dispatch) or a re-throw (preserving cli's pre-flip contract). No silent coerce.
- `feedback-no-value-judgements-on-features` — default to WIRE. The cli flip unifies the consensus surface; the dual-write state is structurally redundant and should be collapsed.
- **Response-shape parity is its own correctness gate.** The cli's existing response objects span ~20 telemetry fields per action × 4 actions × 6 strategies. Each field must round-trip exactly through `buildConsensusResponse(...)` or downstream MCP callers break.
- **One-shot 1500-LoC was the risk that motivated this spin-out.** ADR-0184 Wave 6 attempted a one-shot retire; scope measurement triggered a stand-down. ADR-0185 takes the time to do it incrementally with proper verification.
- ADR-0184 Wave 6a exit-gate test (zero `pending` stubs, audit-equals-mutation count) verifies the agentdb surface is COMPLETE independent of cli retirement. ADR-0185 does not block any future archivist work.
- `feedback-singleton-frozen-state-desync` (ADR-0184 Open Follow-up #4): cli tests that touch `getProcessHiveMindStore()` may need `CLAUDE_FLOW_CWD` env-var isolation. ADR-0185 carries the responsibility for this guard.

## Considered Options

- **A. 1500-LoC one-shot retire.** Rejected — this is the one-shot risk that motivated the spin-out. ADR-0184 Wave 6 stood down to avoid it.
- **B. Per-action incremental flip** (propose first → vote → status → list). Each action lands as its own commit; cli's strategy fan-out gets thinner with each commit. Cli tests can be re-validated per action.
- **C. Per-strategy + per-action matrix** (24 commits across 6 strategies × 4 actions). Maximum granularity; minimum per-commit risk; substantial coordination overhead.
- **D. Hybrid: response-builder-first then per-action flip.** Land `buildConsensusResponse(...)` as its own commit (pure additive; called by an "experimental" code path that mirrors the existing handler's output). Then flip each action one at a time. Verification via parallel-strategy harness: drive identical inputs through cli + archivist, diff responses.

## Decision Outcome

(Placeholder — next executor sizes the option choice and per-wave plan.)

The author's lean: **Option D (hybrid)**. Land the response-builder additively; verify response parity via a harness; then flip per-action with the harness still running as a regression guard. This sequences risk: the response-builder bug (if any) shows up at land-time, not at flip-time. Per-action flip then becomes a 1-line dispatcher swap per action, with the response-builder already proven correct.

### Consequences

- Good — incremental verification at each action's flip. Per-action commit revert is surgical.
- Good — the response-builder is a pure read function over POST-dispatch state; no mutation, no I/O. Trivially testable in isolation.
- Bad — Option D requires more wall-clock than Option A (multiple commits + multiple release gates) IF Option A would have worked one-shot.
- Neutral — cli `crdt-types.ts` deletion is a separate cli-housekeeping concern. ADR-0185 may delete the cli copy iff the cli's `buildConsensusResponse` is the last consumer, OR leave it as an orphaned export.

### Confirmation

- **`npm run release` is the gate for each per-action commit.**
- **Parallel-strategy verification harness**: drive identical inputs through cli (pre-flip) AND archivist (post-flip via test-only direct call) and diff responses; the diff must be empty for every action × strategy combination.
- Per-action invariants must throw on falsy per `feedback-no-fallbacks` — no silent pass branches.
- Final gate: cli `hive-mind_consensus` handler body is a thin dispatch wrapper; helper-set cleanup landed; cli `crdt-types.ts` deletion decision documented.

## Architecture

(Placeholder — next executor fleshes this out.)

- **`buildConsensusResponse(action, strategy, proposalId, state, input) → response`** — pure function. Locates the proposal in `state.consensus.pending` first, falls back to `state.consensus.history`. For each action × strategy, constructs the cli's pre-flip response shape from the loaded proposal + computed telemetry (`votesFor`, `votesAgainst`, `required`, `resolved`, `result`, `byzantineVoters`, gossip-fields, crdt-fields, etc.).
- **Cli `hive-mind_consensus` handler** — thin dispatch wrapper:
  1. Pre-mint `proposalId` for `action === 'propose'` (mirrors task_create precedent).
  2. Call `archivist.dispatch('hive-mind_consensus', payload)`.
  3. Try/catch: reshape 5 typed errors (`RaftTermCollisionError`, `RaftVoteChangeError`, `DuplicateVoteError`, `VoterIdRequiredError`, `ProposalNotFoundError`) into `{action, error, ...}` envelope. Re-throw 3 others (`MissingQueenForWeightedConsensusError`, `WorkerAlreadyFailedError`, `ProposalAlreadyFailedError`) per cli's pre-flip contract.
  4. Re-read state, call `buildConsensusResponse(...)`.
- **Helper-set cleanup** — DELETE iff zero external callers AND not needed by `buildConsensusResponse`:
  - Mutation-only helpers (always dead-after-flip): `detectByzantineVoters`, `tryResolveProposal`, `maybeAdvanceGossipRoundOnTimeout`, `selectGossipTargets`, `reconcileFailedFromStatusKeys`, `workerMetaFor`.
  - Pure-read helpers (may stay if `buildConsensusResponse` uses them): `calculateRequiredVotes`, `weightedTally`, `settleCheckGossip`, `gossipFanout`. Decision: vendor-vs-import. Cli could import from `@sparkleideas/agentdb/archivist` to avoid keeping cli copies; OR cli keeps its copies for response-building isolation. Author's lean: KEEP cli copies — response-building is a cli concern; cross-package coupling is unnecessary for pure-read helpers.
  - Cli `crdt-types.ts` — vendored copy from cli (still load-bearing for cli `buildConsensusResponse` CRDT telemetry: `LWWRegister.from(...).value()`, `ORSet.from(...).elements()`, `GCounter.from(...).value()`). KEEP unless `buildConsensusResponse` chooses to import the agentdb-vendored copy.

## Execution Plan

(Placeholder — next executor sizes the per-action waves.)

Suggested shape (Option D hybrid):

| Wave | Scope | Exit gate |
|---|---|---|
| 1 | Land `buildConsensusResponse(...)` as an additive helper in `cli/src/mcp-tools/hive-mind-consensus-response.ts`. Add parallel-strategy verification harness in `cli/__tests__/`: drive 24+ input shapes (4 actions × 6 strategies) through current cli + agentdb dispatch, diff responses, all diffs must be empty. | `npm run release` passes; harness asserts zero response diffs. |
| 2 | Flip the `propose` action: cli handler's propose branch dispatches to archivist + calls `buildConsensusResponse`. Other actions stay on cli fan-out. | `npm run release` passes; harness asserts zero propose-response diffs against the pre-flip baseline. |
| 3 | Flip `vote`. | `npm run release` passes; harness verified. |
| 4 | Flip `status`. | `npm run release` passes; harness verified. |
| 5 | Flip `list`. | `npm run release` passes; harness verified. |
| 6 | Helper-set cleanup; cli `crdt-types.ts` deletion decision; remove the verification harness (or keep as permanent regression guard). ADR-0185 close-out. | `npm run release` passes; zero unreachable helpers in `mcp-tools/hive-mind-tools.ts`; ADR-0185 close-out report + amendment. |

## Open Follow-ups

1. **Response-shape spec capture**. The cli's existing response objects span ~20 telemetry fields per action with strategy-conditional inclusions (gossip-only, crdt-only, weighted-only, byzantine-only, etc.). A formal spec capture — possibly as a TypeScript discriminated union — would be valuable for both `buildConsensusResponse` correctness AND downstream MCP-caller documentation. Decision deferred to Wave 1 implementation.

2. **Parallel-strategy verification harness**. Wave 1's harness drives identical inputs through cli + archivist and diffs responses. The harness needs to deal with: timestamps (`Date.now()` differs between runs), `proposalId` minting (cli mints internally; pre-mint mitigates), `Math.random()` calls in OR-Set tag generation. Solutions: inject deterministic clock; pre-mint everywhere; canonicalize ORSet entries via `crdtSemanticEqual()` from ADR-0184 Wave 5. Decision deferred to Wave 1.

3. **Cli `crdt-types.ts` deletion**. Cli has its own copy (referenced by Wave 5 trace as STAYING through Wave 6). Once the agentdb copy is the only consumer, the cli copy can be deleted. Decision deferred to ADR-0185 Wave 6.

4. **`feedback-singleton-frozen-state-desync`**. Cli test paths that touch `getProcessHiveMindStore()` (or any cli singleton initialized from `process.cwd()`) need the `CLAUDE_FLOW_CWD` env-var pattern from the ADR-0183 A0 swarm. ADR-0185 inherits this guard.

5. **Cli helpers — vendor-vs-import for pure-read functions**. `calculateRequiredVotes`, `weightedTally`, `settleCheckGossip`, `gossipFanout`. Cli could import from `@sparkleideas/agentdb/archivist` (clean coupling) or keep its own copies (response-building isolation). Decision deferred to ADR-0185 Wave 6 helper-cleanup.

## More Information

- [ADR-0184 close-out report](../council/ADR-0184-close-out-report.md) — the parent close-out that records the cli retirement spin-out.
- [ADR-0184: Hive-Mind Consensus Handler Port](ADR-0184-hive-mind-consensus-handler-port.md) — the parent ADR; all 6 per-strategy bodies live in agentdb per Wave 1-6a.
- [ADR-0181: Archivist Runtime Activation §Closure plan amendment](ADR-0181-archivist-runtime-activation.md#amendment-closure-plan--sequenced-path-to-close-the-program-2026-05-17) — the closure-plan-amendment precedent for sequencing the work.
- [ADR-0183: Memory Write-Path Unification close-out](../council/ADR-0183-a1-report.md) — the spin-out precedent for peeling a single concern out of a parent closure plan.
- `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts` lines 1984-2919 — the 926-LoC cli handler this ADR retires.
- `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/task-tools.ts` lines 127-160 — the `task_create` precedent for cli-flip pattern (pre-mint id, dispatch, post-dispatch re-read).
- `forks/agentdb/src/archivist/handlers/hive-mind/consensus/_shared.ts` — agentdb's vendored cli helpers + 8 typed error classes (re-exported via `archivist/index.ts` per ADR-0184 Wave 6a).
- `forks/agentdb/test/archivist/handlers/exit-gate.test.ts` — the agentdb-side exit-gate test that verifies handler completeness independent of cli retirement.
