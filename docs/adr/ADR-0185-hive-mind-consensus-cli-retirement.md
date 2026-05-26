---
status: accepted
completed: true
date: 2026-05-18
closed-on: 2026-05-18
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

Chosen: **Option D (hybrid)** — land `buildConsensusResponse(...)` additively first; verify response parity via a parallel-strategy harness; then flip each action one at a time with the harness still running as a regression guard.

Option A (one-shot retire) is rejected: the 1500-LoC scope is the exact risk that motivated this spin-out from ADR-0184 Wave 6.

Option B (per-action flip without prior response-builder) is rejected: each per-action flip would need response-builder logic INLINE in that action's branch, duplicating work across 4 actions. Option D extracts the logic ONCE in Wave 1 and reuses it through Waves 2-5.

Option C (24-cell matrix) is rejected: 6 strategies × 4 actions × per-cell verification is overhead disproportionate to risk. The response-builder handles strategy-conditional fields internally; per-action flip is the natural granularity for cli changes.

Option D sequences risk so that the response-builder bug (if any) surfaces at LAND time (Wave 1, additive, no behaviour change), not at FLIP time (Waves 2-5, where a bug would correlate with the cli flip and obscure trace). Per-action flip then becomes a 1-line dispatcher swap per action, with the response-builder already proven correct against the cli's pre-flip baseline.

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

- **`buildConsensusResponse(action, strategy, proposalId, state, input) → ConsensusResponse`** at NEW FILE `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-consensus-response.ts` (~300-400 LoC). Pure function. Locates the proposal in `state.consensus.pending` first, falls back to `state.consensus.history`.

  Signature:
  ```ts
  export function buildConsensusResponse(
    action: 'propose' | 'vote' | 'status' | 'list',
    strategy: 'bft' | 'raft' | 'quorum' | 'weighted' | 'gossip' | 'crdt',
    proposalId: string,
    state: HiveMindState,
    input: HiveMindConsensusPayload,
  ): ConsensusResponse;
  ```

  Return type `ConsensusResponse` is a **TypeScript discriminated union** on `action`: `ProposeResponse | VoteResponse | StatusResponse | ListResponse`. Each member carries strategy-conditional optional fields (gossip-only: `gossipRound`, `gossipBound`, `gossipExhausted`; crdt-only: `crdtState`, `crdtVerdict`, `crdtApprovers`, `crdtVoteCount`, `crdtExpectedVoters`, `crdtTimedOut`; weighted-only: weight-sum subfield; byzantine-only: `byzantineVoters`). The union shape is the formal cli response spec; downstream MCP-caller documentation can cite it directly. (This resolves Open Follow-up #1.)

- **Cli `hive-mind_consensus` handler** at `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts` — post-retirement shape is a thin wrapper (~40-50 LoC, down from ~870):

  1. Pre-mint `proposalId` for `action === 'propose'` (mirrors `task_create` precedent at `mcp-tools/task-tools.ts:127-160`). Other actions take `proposalId` from `payload`.
  2. `await archivist.dispatch('hive-mind_consensus', { ...payload, proposalId })` for write actions (`propose | vote | status`), `archivist.dispatchRead('hive-mind_consensus', payload)` for `list`. Typed-overload form per ADR-0181 Phase 5 `ToolPayloadMap`.
  3. Try/catch with `instanceof` discrimination (error classes re-exported from `@sparkleideas/agentdb/archivist` per ADR-0184 Wave 6a barrel):
     - **Reshape to `{action, error: <e.message>, ...}` envelope** (5): `RaftTermCollisionError`, `RaftVoteChangeError`, `DuplicateVoteError`, `VoterIdRequiredError`, `ProposalNotFoundError`.
     - **Re-throw** (3, per cli's pre-flip contract): `MissingQueenForWeightedConsensusError`, `WorkerAlreadyFailedError`, `ProposalAlreadyFailedError`.
  4. Re-read state via `archivist.dispatchRead('hive-mind_status', { proposalId })`.
  5. `return buildConsensusResponse(action, strategy, proposalId, state, input)`.

- **Helper-set cleanup** in `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts`:

  - **DELETE** — mutation-only, dead-after-flip (verify zero external callers via `grep -rE` per helper before delete): `detectByzantineVoters`, `tryResolveProposal`, `maybeAdvanceGossipRoundOnTimeout`, `selectGossipTargets`, `reconcileFailedFromStatusKeys`, `workerMetaFor`. Approximately ~200 LoC across the 6 functions.
  - **KEEP in cli** — pure-read, called by `buildConsensusResponse`: `calculateRequiredVotes`, `weightedTally`, `settleCheckGossip`, `gossipFanout`. **Vendor-from-agentdb is rejected** — response-building is a cli concern; cross-package import for pure-read helpers adds coupling that doesn't pay back. (This resolves Open Follow-up #5.)
  - **KEEP cli `crdt-types.ts`** — `buildConsensusResponse` calls `LWWRegister.from(...).value()` / `ORSet.from(...).elements()` / `GCounter.from(...).value()` for CRDT telemetry. Cross-package import (`@sparkleideas/agentdb/archivist/handlers/hive-mind/consensus/_crdt-types`) would add coupling without benefit. (This resolves Open Follow-up #3.)

- **Parallel-strategy verification harness** at NEW FILE `forks/ruflo/v3/@claude-flow/cli/__tests__/hive-mind-consensus-parity.test.ts` (~400 LoC):

  - Drives 24 inputs (4 actions × 6 strategies) — `propose × {bft, raft, quorum, weighted, gossip, crdt}`, same for `vote / status / list` — through BOTH cli's pre-flip handler AND archivist's dispatched handler. (For the `list` action, "across 6 strategies" is degenerate; harness uses 1 input there → 19 distinct cells in practice, expanded with state variants to ≥24 effective scenarios.)
  - Diffs responses field-by-field via:
    - `crdtSemanticEqual()` (already in agentdb per ADR-0184 Wave 5 `_shared.ts`) for CRDT subfields — handles ORSet's internal-ordering issue.
    - Plain deep-equal for other fields.
  - **Determinism strategy** (resolves Open Follow-up #2):
    - Clock: `vi.useFakeTimers()` + `vi.setSystemTime(<fixed epoch>)` per test, advance via `vi.advanceTimersByTime()` for ADR-0131 timeout-driven transitions.
    - `proposalId`: pre-mint via FNV-1a + mulberry32 seed (same pattern ADR-0184 Wave 5 used). Cli's `propose` action accepts the pre-minted id via payload.
    - ORSet tagging: cli's ORSet uses `Math.random()` for tag generation; harness stubs `Math.random` with a seeded mulberry32 sequence in `beforeEach`.
    - Per-test cleanup: `vi.restoreAllMocks()` in `afterEach`.
  - **Singleton isolation** (resolves Open Follow-up #4): each test uses `CLAUDE_FLOW_CWD` env-var injection (per ADR-0183 A0 swarm pattern) + `vi.stubEnv('HOME', ...)` to scope cli singletons (`getProcessHiveMindStore()`, etc.) per-test. Vitest `@claude-flow/memory` externalization (also per ADR-0183 A0) may be required.
  - **Harness lifecycle**: ACTIVE during Waves 1-5 as the regression guard. Decision in Wave 6: KEEP as permanent regression guard once cli is fully dispatched. Cost is ~400 LoC of test code; benefit is detecting any future drift between cli + archivist response shapes.

## Execution Plan

6 sequential waves under Option D hybrid. Each wave gates on `npm run release` (default acceptance — heavy gate only at Wave 6 close-out). Per-wave commit on `forks/ruflo` main with descriptive message naming the action flipped + harness verdict; no Co-Authored-By trailer.

| Wave | Scope | Files | Net LoC | Exit gate |
|---|---|---|---|---|
| **1** | Land `buildConsensusResponse(...)` additively + parallel-strategy verification harness. Cli `hive-mind_consensus` handler UNCHANGED — harness verifies the response-builder produces the cli's pre-flip shape exactly. | **NEW:** `cli/src/mcp-tools/hive-mind-consensus-response.ts` (~350 LoC including `ConsensusResponse` union), `cli/__tests__/hive-mind-consensus-parity.test.ts` (~400 LoC). **NO CHANGE:** `cli/src/mcp-tools/hive-mind-tools.ts`. | +750 | `npm run release` passes; harness asserts zero response diffs across all 24 cells (`{propose,vote,status,list} × {bft,raft,quorum,weighted,gossip,crdt}`); cli handler body unchanged (grep-asserted). |
| **2** | Flip `propose` action. Cli's propose branch: pre-mint `proposalId`, `archivist.dispatch('hive-mind_consensus', { ...payload, proposalId })`, try/catch with `instanceof` discrimination on 8 typed errors, re-read state via `dispatchRead('hive-mind_status')`, `return buildConsensusResponse(...)`. Other 3 action branches stay on cli fan-out. | **MODIFIED:** `cli/src/mcp-tools/hive-mind-tools.ts` (propose branch only, ~80 LoC → ~25 LoC). | −55 | `npm run release` passes; harness asserts zero propose-response diff across all 6 strategies; existing `cli/__tests__/mcp-tools-deep.test.ts` propose-related assertions pass; ADR-0184 audit-equals-mutation invariant preserved. |
| **3** | Flip `vote` action. Same shape as Wave 2 but for vote branch. The vote branch is heavier in cli (~200 LoC) because it carries strategy-specific tally/equivocation logic — that logic is now in agentdb per ADR-0184; cli just dispatches + builds response. | **MODIFIED:** `cli/src/mcp-tools/hive-mind-tools.ts` (vote branch). | −180 | `npm run release` passes; harness asserts zero vote-response diff; existing vote-related assertions pass (Byzantine equivocation detection still surfaces correctly via response shape). |
| **4** | Flip `status` action. ADR-0131 inline-timing decision (from ADR-0184 Wave 4) means status is a WRITE action; cli uses `archivist.dispatch` not `dispatchRead`. Harness must drive timeout-driven transitions via `vi.advanceTimersByTime()` and verify the auto-status-transition fields (`statusJustTransitioned`, `timedOut`, `settled`) round-trip. | **MODIFIED:** `cli/src/mcp-tools/hive-mind-tools.ts` (status branch). | −270 | `npm run release` passes; harness asserts zero status-response diff across all 6 strategies INCLUDING ADR-0131 timeout-driven transitions; gossip-strategy `gossipExhausted` flag (ADR-0184 Wave 4) round-trips. |
| **5** | Flip `list` action. Pure read — cli uses `archivist.dispatchRead('hive-mind_consensus', { action: 'list', ... })`. | **MODIFIED:** `cli/src/mcp-tools/hive-mind-tools.ts` (list branch). | −45 | `npm run release` passes; harness asserts zero list-response diff. Cli `hive-mind_consensus` handler body is now ~40-50 LoC of dispatch logic only. |
| **6** | Helper-set cleanup + close-out. Delete the 6 mutation-only helpers; verify zero external callers via `grep -rE` per helper. Keep the 4 pure-read helpers + cli `crdt-types.ts` per §Architecture decisions. Author close-out report + ADR-0185 amendment. Decide harness lifecycle (recommended: KEEP permanent). | **MODIFIED:** `cli/src/mcp-tools/hive-mind-tools.ts` (delete 6 helpers). **NEW:** `docs/council/ADR-0185-close-out-report.md`, ADR-0185 `### Amendment: Close-out` section. | −200 | `npm run release` passes (default + `ACCEPTANCE_HEAVY=1` heavy gate to mirror ADR-0181/0184 close-out posture); zero unreachable helpers in `mcp-tools/hive-mind-tools.ts`; cli `hive-mind_consensus` handler body ~40-50 LoC; ADR-0185 close-out report + amendment land in a ruflo-patch commit. |

**Net LoC delta:** +750 (Wave 1 additive) − 750 (Waves 2-6 deletions) = ~0 net, but the cli handler body shrinks ~870 → ~50 LoC. The 6 mutation-only helpers (~200 LoC) are net deleted; the response-builder + harness (~750 LoC) is net added.

**Estimated release-gate cycles:** 6 (one per wave). Plus 1 heavy gate at Wave 6 close-out (matches ADR-0181/0184 close-out parity).

**Per-wave revert posture:** each wave's commit is surgical (single action branch flip in Waves 2-5; pure additive in Wave 1; deletion-only in Wave 6). If a wave's harness asserts non-empty diff, the action under flip is the immediate suspect — revert that wave's commit cleanly, trace the diff, re-attempt. Per `feedback-trace-before-hypothesis`.

**Swarm sizing:** can run as a queen-as-implementer per the ADR-0181/0184 pattern, OR as `/swarm-advanced` per-action workers if the in-process Agent-spawn constraint is lifted by the time ADR-0185 starts. The work is naturally serial (each wave depends on the prior); parallel-worker fan-out doesn't add value within a wave.

## Open Follow-ups

1. ~~**Response-shape spec capture**~~ — **RESOLVED in §Architecture**: `ConsensusResponse` is a TypeScript discriminated union on `action`, with `ProposeResponse | VoteResponse | StatusResponse | ListResponse` members carrying strategy-conditional optional fields. The union shape IS the formal spec.

2. ~~**Parallel-strategy verification harness**~~ — **RESOLVED in §Architecture**: harness at `cli/__tests__/hive-mind-consensus-parity.test.ts`; determinism via `vi.useFakeTimers()` + `vi.setSystemTime()`, FNV-1a + mulberry32 `proposalId` seeding, `Math.random` stubbing for ORSet tags, `crdtSemanticEqual()` for CRDT subfield diff.

3. ~~**Cli `crdt-types.ts` deletion**~~ — **RESOLVED in §Architecture**: KEEP cli copy. `buildConsensusResponse` calls its constructors for CRDT telemetry; cross-package import would add coupling without benefit.

4. **`feedback-singleton-frozen-state-desync`** — partially resolved in §Architecture (harness uses `CLAUDE_FLOW_CWD` + `vi.stubEnv('HOME', ...)`). **Remaining concern**: Vitest `@claude-flow/memory` externalization may be required (precedent: ADR-0183 A0 swarm vitest config). Verify during Wave 1 harness authoring.

5. ~~**Cli helpers — vendor-vs-import for pure-read functions**~~ — **RESOLVED in §Architecture**: KEEP cli copies of `calculateRequiredVotes`, `weightedTally`, `settleCheckGossip`, `gossipFanout`. Response-building is a cli concern; cross-package import for pure-read helpers adds coupling that doesn't pay back.

6. **Harness lifecycle decision at Wave 6 close-out**. Current §Architecture lean: KEEP as permanent regression guard (cost ~400 LoC of test code; benefit catches future drift between cli + archivist response shapes). Alternative: retire iff cli is so thin post-Wave-6 that drift is impossible. Decision binding at Wave 6 close-out commit; default is KEEP.

7. **ADR-0184 Wave 6a `gossipExhausted?` flag** — added to `ConsensusProposal` in agentdb Wave 4. Cli's `buildConsensusResponse` reads it via the dispatched-response payload; harness must include a gossip-exhausted state variant to verify the flag round-trips.

8. **Cli-test assertion-set refresh** — `cli/__tests__/mcp-tools-deep.test.ts` currently asserts response shapes from the pre-flip cli handler. Post-flip the shapes are produced by `buildConsensusResponse`; assertion targets are nominally unchanged but should be reviewed per wave to confirm no assertion drifts behind the abstraction.

## Amendments

### Amendment: Close-out — ADR-0185 implementation complete (2026-05-18)

ADR-0185 is implemented and closed. The cli `hive-mind_consensus` handler is now a thin dispatch envelope; the strategy fan-out is gone.

**Execution structure** — 6 waves (Wave 2 split into 2a + 2b by DA mandate):

| Wave | Scope | Fork SHA |
|---|---|---|
| W1 | Additive `buildConsensusResponse` + parity harness (26 cells) + ruflo-patch wrapper gate | c81831164, 425710868, b43e039f3, eeb26cd7f |
| W2a | Harness shape-contract pivot (DA-mandated split) | a20732b98 |
| W2b | Flip propose action to `archivist.dispatch` | 7e06c8390 |
| W3 | Flip vote action | ca596e932 |
| W4 | Flip status action (includes ADR-0131 timeouts) | f4b9ffe12 |
| W5 | Flip list action + delete `withHiveStoreLock` wrapper | 84defa083 |
| W6 | Delete 3 dead helpers + close-out (this amendment) | bf72ed19a |

**Cumulative cli LoC reduction**: handler 870 → ~127 LoC + 3 dead helpers (~128 LoC) deleted. Total cli surface shrink across Waves 1-6 ≈ -870 LoC. Response-builder + parity harness add ~1150 LoC of test/projection code in their place.

**Acceptance trajectory**: 672/681/0/9 sustained across all 6 default-gate releases (patches 190 → 192 → 193 → 194 → 197 → 199 → 202 → 203). Heavy gate cleared at close-out.

**Helper-cleanup correction** (Wave 6, DA Axis 1): the pre-Wave-6 plan listed 6 helpers for deletion. Pre-emptive `grep` on `src/` + `__tests__/` confirmed only 3 were truly unreachable. The other 3 — `selectGossipTargets`, `reconcileFailedFromStatusKeys`, `workerMetaFor` — have live callers in `hive-mind_status` (a separate cli tool, explicitly deferred per the ADR's scope) plus active test-invariant refs in `mcp-tools-deep.test.ts`. Per `feedback-no-squelch-tests` they were preserved.

**Source-grep brittleness lesson**: 4 of 6 acceptance-test failures across the 6 waves were `assert.match(src, ...)` strings searching for identifiers that had relocated from cli to agentdb per-strategy handlers. Each pattern needed surgical migration (cli → agentdb dispatcher case-arm + per-strategy handler case-arm). Wave 7+ work should convert remaining `assert.match(src, ...)` assertions to behavioural tests so the corpus survives future relocations.

**Parity-harness lifecycle** (Wave 6, DA Axis 6): the parity harness (29 cells) + the ruflo-patch wrapper gate (3 cells) are permanent regression guards per ADR-0185 §Architecture. No future wave may delete them — they lock in cli/agentdb response-shape parity for the lifetime of the dispatch pattern.

## More Information

- [ADR-0184 close-out report](../council/ADR-0184-close-out-report.md) — the parent close-out that records the cli retirement spin-out.
- [ADR-0184: Hive-Mind Consensus Handler Port](ADR-0184-hive-mind-consensus-handler-port.md) — the parent ADR; all 6 per-strategy bodies live in agentdb per Wave 1-6a.
- [ADR-0181: Archivist Runtime Activation §Closure plan amendment](ADR-0181-archivist-runtime-activation.md#amendment-closure-plan--sequenced-path-to-close-the-program-2026-05-17) — the closure-plan-amendment precedent for sequencing the work.
- [ADR-0183: Memory Write-Path Unification close-out](../council/ADR-0183-a1-report.md) — the spin-out precedent for peeling a single concern out of a parent closure plan.
- `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts` lines 1984-2919 — the 926-LoC cli handler this ADR retires.
- `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/task-tools.ts` lines 127-160 — the `task_create` precedent for cli-flip pattern (pre-mint id, dispatch, post-dispatch re-read).
- `forks/agentdb/src/archivist/handlers/hive-mind/consensus/_shared.ts` — agentdb's vendored cli helpers + 8 typed error classes (re-exported via `archivist/index.ts` per ADR-0184 Wave 6a).
- `forks/agentdb/test/archivist/handlers/exit-gate.test.ts` — the agentdb-side exit-gate test that verifies handler completeness independent of cli retirement.
