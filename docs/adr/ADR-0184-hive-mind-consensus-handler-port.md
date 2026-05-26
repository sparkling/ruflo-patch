---
status: accepted
completed: true
date: 2026-05-18
closed-on: 2026-05-18
tags: [hive-mind, consensus, archivist, runtime-activation, multi-strategy]
depends-on: [ADR-0180, ADR-0181]
implements: []
---

# ADR-0184: Hive-Mind Consensus Handler Port — Multi-Strategy Fan-Out Activation

## Context and Problem Statement

[ADR-0181 §Closure plan amendment](ADR-0181-archivist-runtime-activation.md#amendment-closure-plan--sequenced-path-to-close-the-program-2026-05-17) Phase D — "Final stub close: `forks/agentdb/src/archivist/handlers/hive-mind/consensus.ts`" — was sized for a swarm-driven port but blocked the close-out under a single-threaded queen-as-implementer execution model. ADR-0181 closed (2026-05-18, 672/681 default + 681/681 heavy) with Phase D deferred here.

**Stub state today.** `forks/agentdb/src/archivist/handlers/hive-mind/consensus.ts` is 148 LoC: header doc-comment + `HiveMindConsensusPayload` discriminated union (`propose | vote | status | list`) + STORE_ID + a stub handler that throws inside `withWrite`:

```ts
throw new Error(
  'archivist: hive-mind_consensus handler body pending Phase 4 wire-up; ' +
  'callers currently route through cli/src/mcp-tools/hive-mind-tools.ts ' +
  '\'hive-mind_consensus\' handler',
);
```

The `invariants: []` array is the only `invariants: []` left in the entire handler tree (per ADR-0181 Phase E inventory — 127 mutation handlers, 103 wired with `<surface>Invariants`).

**Cli surface that needs porting.** `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts` `hive-mind_consensus` handler spans **926 LoC** (handler boundary measured via `awk` extraction during the ADR-0181 Phase D inventory, 2026-05-18). Each strategy carries its own merge/tally/quorum logic with ADR provenance:

| Strategy | Provenance | Surface |
|---|---|---|
| `bft` (Byzantine Fault Tolerant) | ADR-0098 | f+1 of 2f+1 voting threshold; equivocation detection |
| `raft` | ADR-0117 | term-based leader election; `timeoutMs` re-proposal trigger |
| `quorum` | (base) | `quorumPreset: unanimous \| majority \| supermajority` thresholds |
| `weighted` | ADR-0119 (T1) | queen 3x voting power per USERGUIDE |
| `byzantine` | (alias for `bft`; ADR-0106 R1 carry-forward per ADR-0118 review-notes-triage 2026-05-02) | normalized to `bft` at handler entry |
| `gossip` | ADR-0120 (T2) | push-style epidemic propagation; `roundTimeoutMs` per-round bound; eventual-consistency settling |
| `crdt` | ADR-0121 (T3) | state-based CvRDT merge via `mergeCRDTState` (G-Counter / OR-Set / LWW-Register); optional `crdtSnapshot: {votes, approvers, verdict}` triple |

Plus the cross-strategy ADR-0131 (T12) auto-status-transition logic in the `status` action: writes `proposal.status = 'failed-quorum-not-reached'` + appends to `state.consensus.history` when `Date.now() >= timeoutAt`. Gossip + CRDT status paths also force-settle and persist via `saveHiveState`.

**Why this is its own ADR rather than an ADR-0181 follow-up.** The 926-LoC port spans 7 strategies × 4 actions = 28 distinct mutation paths, each with its own invariants and audit-trail concerns. Doing it serially in a queen-as-implementer context (the constraint ADR-0181's close-out documented) is high-risk for one-shot success — likely 2-3 release cycles of trace-and-revert per strategy. Treating it as its own decision program lets the next executor:

1. Author a real `/swarm-advanced` wave (per-strategy worker × 7) without the ADR-0181 closure clock.
2. Make per-strategy invariant decisions deliberately (CRDT idempotency vs Raft term monotonicity vs Byzantine equivocation detection are NOT the same shape).
3. Land per-strategy modules incrementally with their own release gates, rather than the all-or-nothing flip the closure plan implied.

The cli surface works today; the archivist coverage gap is the only thing pending. Deferral pattern mirrors ADR-0183 (peel out a single concern when the prior ADR's closure plan would otherwise bloat).

## Decision Drivers

- `feedback-no-fallbacks` / `feedback-data-loss-zero-tolerance` — a half-ported consensus surface where *some* strategies dispatch and others don't is a split-brain consensus path, worse than the current all-cli-side state. Per-strategy activation must be coherent.
- `feedback-trace-before-hypothesis` — each strategy has its own invariants (e.g. CRDT merge idempotency vs BFT equivocation detection); the port for each strategy starts with a trace of the cli implementation's actual behaviour, not a hypothesis about what the strategy "should" do.
- ADR-0180 §Confirmation invariant ("audit-entry count equals mutation count") — each consensus action (propose / vote / status / list) is one audit entry; the port preserves this.
- ADR-0181 closure-plan amendment Phase D criterion ("zero `pending` stubs in `handlers/**`") — this ADR's exit gate inherits that criterion.
- ADR-0183 spin-out precedent — single-concern ADRs are preferred when the prior ADR's closure plan would otherwise bloat indefinitely.
- `npm run release` exit gate per ADR-0181 — every phase here gates on full preflight + build + publish + acceptance.

## Considered Options

- **A. Port all 7 strategies in one commit, flip cli dispatch in a second commit.** Rejected — 926-LoC single-commit port is exactly the one-shot-risk ADR-0181 close-out flagged. No room for per-strategy iteration.
- **B. Defer indefinitely; leave the stub `pending` forever.** Rejected — the `pending` stub is the only remaining `invariants: []` in the entire handler tree; leaving it indefinite blocks any future "zero stubs" claim on the archivist surface.
- **C. Per-strategy modules under `handlers/hive-mind/consensus/<strategy>.ts` + per-strategy dispatch table in the parent handler (chosen).** Each strategy gets its own file with its own invariants and tests. The parent handler dispatches to the per-strategy module based on `payload.strategy` (normalising `byzantine` → `bft` at entry). Per-strategy modules land incrementally with their own release gates. When all 7 land, the parent handler stops throwing and the cli's strategy-fan-out gets retired in a final commit.
- **D. Refactor the cli handler in-place to call into a shared module under `cli/src/mcp-tools/hive-mind-consensus/`, leaving the archivist handler as a thin dispatcher.** Rejected — keeps the cli as the authoritative consensus surface, which defeats the archivist-runtime-activation purpose ADR-0181 framed.

## Decision Outcome

Chosen: **Option C**, executed as a per-strategy ADR-0181-style wave (next swarm fleshes out the §Execution Plan below; this ADR is a placeholder + structural decision, not a complete plan).

### Consequences

- Good — each strategy gets dedicated attention (its invariants, its tests, its release gate). CRDT merge idempotency, Raft term monotonicity, Byzantine equivocation detection are NOT collapsed into one omnibus port.
- Good — the per-strategy file convention mirrors ADR-0180 §Per-surface handler layout (one file per dispatched tool name); the consensus split is structurally consistent.
- Good — the close-out can declare "zero `pending` stubs in `handlers/**`" once the 7 strategies land; ADR-0181 Phase D's stated exit gate is realisable here, not abandoned.
- Bad — 7 commits + 7 release gates is more wall-clock than a one-shot port, IF the one-shot would have worked. The trade is "more gates, less per-gate risk."
- Neutral — the cli's hive-mind_consensus handler stays load-bearing until the final commit retires its strategy fan-out. No split-brain interval per ADR-0181 §Decision Drivers.

### Confirmation

- **`npm run release` is the gate for each per-strategy commit.**
- Per-strategy invariants must throw on falsy per `feedback-no-fallbacks` — no silent pass branches.
- Final gate: zero `pending` stubs in `forks/agentdb/src/archivist/handlers/**` (per ADR-0181 Phase D exit criterion); audit-entry count equals mutation count (per ADR-0180 §Confirmation); `invariants: []` count in the handler tree drops to zero.

## Architecture

(Placeholder — next executor fleshes this out.)

- **Per-strategy modules.** `forks/agentdb/src/archivist/handlers/hive-mind/consensus/<strategy>.ts` for each of: `bft.ts`, `raft.ts`, `quorum.ts`, `weighted.ts`, `gossip.ts`, `crdt.ts`. `byzantine` is normalised to `bft` at handler entry, so no separate file.
- **Parent dispatcher.** The existing `forks/agentdb/src/archivist/handlers/hive-mind/consensus.ts` retains its `registerMutationHandler('hive-mind_consensus', ...)` registration; the body delegates to the per-strategy module by `payload.strategy`. Stub-throw replaced with strategy-dispatch.
- **Per-strategy invariants.** `forks/agentdb/src/archivist/invariants/hive-mind/consensus/<strategy>.ts` mirrors the per-handler invariant pattern. The parent handler concatenates per-strategy invariant arrays at registration; the dispatcher selects the strategy-specific subset at evaluation time.
- **Cli retirement.** Final commit: cli's `hive-mind-tools.ts` `hive-mind_consensus` handler dispatches through `archivist.dispatch('hive-mind_consensus', payload)` (the typed-overload form from ADR-0181 Phase 5). Strategy-specific cli logic (lines ~2030-2956 currently) is deleted.

## Execution Plan

(Placeholder — next executor sizes the per-strategy waves.)

| Wave | Scope | Exit gate |
|---|---|---|
| **1** | Per-strategy module skeletons (7 files, registration plumbing). Parent dispatcher selects strategy; per-strategy bodies still throw `pending` (drops `invariants: []` to per-strategy empty arrays). | `npm run release` passes; consensus dispatch correctly routes to per-strategy stub for each `strategy` value; cli still unchanged. |
| **2** | Port the 3 "simpler" strategies: `bft`, `raft`, `quorum`. Their merge/tally logic is well-isolated (no cross-round state). | Per-strategy invariants land; `npm run release` passes; cli still unchanged. |
| **3** | Port `weighted` (ADR-0119 queen 3x). Per-strategy invariant: weight-sum validation. | `npm run release` passes; cli still unchanged. |
| **4** | Port `gossip` (ADR-0120 push-style epidemic + `roundTimeoutMs`). Per-strategy invariants: round-bound monotonicity, settle-condition correctness. | `npm run release` passes; cli still unchanged. |
| **5** | Port `crdt` (ADR-0121 CvRDT). Per-strategy invariants: merge idempotency, commutativity, associativity (sampled-property tests). | `npm run release` passes; cli still unchanged. |
| **6** | Cli `hive-mind_consensus` handler flips to dispatch through `archivist.dispatch('hive-mind_consensus', payload)`. Cli's strategy fan-out (lines ~2030-2956) deleted. | `npm run release` passes; zero `pending` stubs in `handlers/**`; cli's `hive-mind_consensus` is a thin dispatch wrapper. |

## Open Follow-ups

1. **ADR-0131 (T12) auto-status-transition timing**. The current cli logic runs `Date.now() >= timeoutAt` checks inline in the `status` action. The port needs to decide: does the archivist handler also check timing inline, or is `status` a pure read with timing-driven mutations factored into a separate `status_settle` mutation? Decision deferred to Wave 2 implementation.

2. **CRDT `mergeCRDTState` import location**. Today `mergeCRDTState` lives in cli (`hive-mind-tools.ts` imports it from a sibling module). The port likely needs to vendor it into the agentdb handler tree (or expose it via an archivist capability surface). Decision deferred to Wave 5 implementation.

3. **Per-strategy invariant authoring**. Each strategy has its own correctness gates (BFT f+1 threshold, Raft term monotonicity, Quorum threshold preset arithmetic, Weighted weight-sum normalisation, Gossip settle-condition, CRDT idempotency/commutativity/associativity). The per-strategy invariant authoring is non-trivial; each wave's commit includes the invariant module + tests.

4. **`feedback-singleton-frozen-state-desync`** likely applies if any wave's tests touch cli singletons (e.g. `getProcessHiveMindStore()`). Use the `CLAUDE_FLOW_CWD` env-var pattern from the ADR-0183 A0 swarm.

## Amendments

### Amendment: Status reconciliation (2026-05-18)

Frontmatter `status` flipped `proposed` → `implemented` per the close-out
amendment below (2026-05-18) and `docs/council/ADR-0184-close-out-report.md`.
`closed-on: 2026-05-18` was already set when this ADR closed; the status
flip was deferred and reconciled as part of the ADR status audit.

### Amendment: Close-out — ADR-0184 agentdb coverage complete; cli retirement deferred to ADR-0185 (2026-05-18)

All 6 waves green-gated at 672/681/0/9 acceptance. Per-strategy handler bodies live in `forks/agentdb/src/archivist/handlers/hive-mind/consensus/<strategy>.ts` (bft, raft, quorum, weighted, gossip, crdt); zero `pending` stubs remain in the agentdb handler tree; audit-entry count equals mutation count (verified by Wave 6a exit-gate test).

Per-wave commit trail (`forks/agentdb` main):

- Wave 1 (`6c88a6b`): per-strategy skeletons + parent dispatcher (`byzantine → bft` normalisation)
- Wave 2.1 (`f3c0f37`): `_shared.ts` (vendored cli helpers + 4 error classes) + bft port + invariants + 8 tests
- Wave 2.2 (`0c6da39`): raft port + invariants + 5 tests
- Wave 2.3 (`5d51b18`): quorum port + invariants + 6 tests
- Wave 3 (`7772008`): weighted port + invariants + 8 tests (queen 3x voting power)
- Wave 4 (`655d330`): gossip port + invariants + 9 tests + ADR-0131 inline-timing decision (OF#1)
- Wave 5 (`c9e0ed0`): crdt port + invariants + 11 tests (7 behavioural + 3×50 sampled property) + `_crdt-types.ts` vendor (OF#2)
- Wave 6a (`4a8aee7`): exit-gate test + barrel error-class re-exports in `archivist/index.ts`

**Decisions ratified:**

- **ADR-0131 auto-status-transition timing** (Open Follow-up #1): INLINE at `status` action across all strategies, not split into a separate `status_settle` mutation. Rationale: gossip status is already a mutation action; half-split (gossip/crdt → status_settle, threshold strategies → inline) is worse than no split; preserves cli interface verbatim. Trade-off acknowledged: `status` action's name is slightly misleading.
- **mergeCRDTState location** (Open Follow-up #2): VENDORED into `forks/agentdb/src/archivist/handlers/hive-mind/consensus/_crdt-types.ts` (439 LoC verbatim from cli `crdt-types.ts`). Rationale: pure JSON-merge math, no I/O dependencies, capability-handle plumbing is architectural overhead, single consumer.

**Cli retirement deferred to ADR-0185.** The cli `hive-mind_consensus` handler (lines 1984-2919 of `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts`, ~870 LoC handler body + ~50 LoC schema/header) is now 100% redundant with the agentdb handler — both surfaces work correctly in dual-write. The cli flip itself requires a comprehensive `buildConsensusResponse` helper reconstructing all post-dispatch telemetry, a try/catch error-reshape with 5 typed-error branches, helper-set cleanup (zero external callers confirmed for 10 cli-local helpers), and cli-test re-validation. Scope measurement during Wave 6 execution revealed this is ~1500 LoC of focused refactor work warranting its own ADR. Spin-out pattern mirrors [ADR-0181 → ADR-0184](ADR-0181-archivist-runtime-activation.md#amendment-closure-plan--sequenced-path-to-close-the-program-2026-05-17).

**Open Follow-up #3** (per-strategy invariant authoring): partially addressed. Wave 2 DA Axis (f) ruling resolved that invariants must use the `Invariant<T>` signature's payload-shape-only inputs (`callerIntent` + `recordedPayload`, no before/after state snapshot). Per-strategy correctness gates (BFT f+1 threshold, Raft term monotonicity, CRDT idempotency/commutativity/associativity) split: payload-shape checks landed in `invariants/hive-mind/consensus/<strategy>.ts`; correctness-triad property tests for CRDT landed in `test/archivist/handlers/hive-mind/consensus/crdt.test.ts` via the `crdtSemanticEqual()` helper. Open Follow-up #3 is **resolved** at the agentdb layer.

**Open Follow-up #4** (`feedback-singleton-frozen-state-desync` carry-forward): no Wave 1-6a test path touched cli singletons; the `withTestContext` test harness uses `makeFsJsonSubstrateFixture` which is per-test and never reaches `getProcessHiveMindStore()`. Not an issue here. Carry-forward stays applicable to ADR-0185 cli-flip tests.

Close-out report: [docs/council/ADR-0184-close-out-report.md](../council/ADR-0184-close-out-report.md).

## More Information

- [ADR-0181: Archivist Runtime Activation](ADR-0181-archivist-runtime-activation.md) — the parent activation program; §Closure plan amendment Phase D is the scope this ADR inherits.
- [ADR-0185: Hive-Mind Consensus Cli Retirement](ADR-0185-hive-mind-consensus-cli-retirement.md) — the cli-flip program spun out from this ADR's Wave 6.
- [ADR-0181 §Amendment: Close-out — ADR-0181 implementation complete (2026-05-18)](ADR-0181-archivist-runtime-activation.md#amendment-close-out--adr-0181-implementation-complete-2026-05-18) — the close-out that defers Phase D here.
- [ADR-0183: Memory Write-Path Unification](ADR-0183-memory-write-path-unification.md) — the precedent for spinning out a heavy single-concern from a closure plan when serial execution constraints would otherwise blow the wall-clock budget.
- [docs/council/ADR-0181-close-out-report.md](../council/ADR-0181-close-out-report.md) — the close-out report containing the per-phase outcomes table and the deferred-follow-up list this ADR closes #1 of.
- `forks/agentdb/src/archivist/handlers/hive-mind/consensus.ts` — the 148-LoC stub this ADR will replace.
- `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts` `hive-mind_consensus` handler (lines ~1984-2910) — the 926-LoC cli implementation being ported.
- `feedback-no-fallbacks.md` — invariants on per-strategy modules must throw on falsy, not silently pass.
- `feedback-trace-before-hypothesis.md` — each per-strategy port starts with a trace of the cli implementation's actual behaviour, not a hypothesis.
