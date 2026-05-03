# ADR-0120: Hive-mind Gossip consensus protocol (T2)

- **Status**: **Implemented (2026-05-03)** per ADR-0118 §Status (T2 complete; fork 2839874b2 + ruflo-patch ccf2c62). In-handler dispatch at `hive-mind-tools.ts:241` (enum) + `:78-104, 134-163` (vote tally).
- **Date**: 2026-05-02
- **Deciders**: Henrik Pettersen
- **Depends on**: ADR-0116 (hive-mind marketplace plugin — provides the verification matrix that surfaced this gap), ADR-0118 (runtime gaps tracker — owns the T2 task definition)
- **Related**: ADR-0114 (substrate/protocol/execution layering — the gossip protocol must respect the protocol-layer contract)
- **Scope**: Fork-side runtime in `v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts` plus agent wiring. Closes T2 from ADR-0118.

## Context

ADR-0116's USERGUIDE-vs-implementation verification matrix flagged the row "5 protocols" as a documentation-only feature. The USERGUIDE block `**Consensus Strategies**` (substring anchor in `/Users/henrik/source/ruvnet/ruflo/docs/USERGUIDE.md`) advertises five protocols — Byzantine, Raft, Quorum, Weighted, Gossip — but the runtime enum only ships three.

Empirical state in the fork:

| Surface | Path | Current value |
|---|---|---|
| Runtime enum | `v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:46` | `type ConsensusStrategy = 'bft' \| 'raft' \| 'quorum'` — no `'gossip'` member |
| `_consensus` JSON-schema strategy | `v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:575` | enum literal `['bft', 'raft', 'quorum']` — rejects `'gossip'` at JSON-RPC validation |
| Agent file | `.claude/agents/consensus/gossip-coordinator.md` | Exists as documentation-only — no `allowed-tools` frontmatter and no MCP-tool wiring |
| USERGUIDE contract | substring `**Consensus Strategies**` | Lists Gossip as one of 5 protocols |

Result: an installer who reads the USERGUIDE and asks the gossip-coordinator agent to drive a consensus round gets a runtime error from `_consensus` because the JSON-schema validator rejects `strategy: 'gossip'` before the dispatcher even runs. The agent prose advertises a capability the runtime cannot dispatch.

T2 in ADR-0118 owns this gap and is independent of T1 (Weighted) and T3 (CRDT) — the three Tns all extend the same enum but their tally implementations don't share state. T2 ships standalone.

## Decision drivers

- **USERGUIDE contract.** The "Consensus Strategies" block names Gossip; ADR-0116's verification matrix treats USERGUIDE-promised features as a contract the runtime must honour.
- **Agent file resolves to nothing.** `forks/ruflo/v3/@claude-flow/cli/.claude/agents/consensus/gossip-coordinator.md` is shippable surface today; without runtime support, an agent invocation passing `strategy: 'gossip'` is rejected by the `_consensus` JSON-schema validator at the MCP boundary.
- **Eventual consistency is acceptable here.** Hive-mind consensus is advisory (queen orchestration, ADR-0104), not safety-critical state-machine replication; bounded staleness is fine, BFT-grade liveness is not required.
- **Hive sizes are small.** Typical hive workloads run with N in the 4–32 range; rounds-to-converge for `O(log N)` is 2–5. Wall-clock convergence is dominated by per-round jitter (`10-50ms`) plus `_consensus` poll cadence rather than asymptotic complexity.
- **Existing single-process runtime.** All voters run inside one MCP server process (`hive-mind-tools.ts` operates on a single `state.json`); "broadcast to peer" is in-process scheduling, not network I/O. Failure modes that motivate pull-style anti-entropy in distributed gossip (writer crashes, partitioned subnets) collapse to "vote handler threw" or "process died" here.
- **Fork-side patching.** Per `feedback-patches-in-fork.md` and ADR-0118 §Scope, this lands in `forks/ruflo/v3/...`, not the patch repo's codemod or in upstream.
- **ADR-0118 §T2 escalation rule.** This ADR picks push-style as the default per the task definition. If push-vs-pull-vs-push-pull becomes contested in real workloads, that promotion goes to its own ADR rather than re-litigating here.
- **Protocol-layer constraint (ADR-0114).** Gossip is a protocol-layer addition; substrate (storage, MCP transport) and execution (agent dispatch) layers stay untouched.

## Considered options

- **(a) Push-style epidemic propagation [CHOSEN].** Each voter, on receiving a vote, re-broadcasts proposal state to a deterministic random subset of size `ceil(log2(N))`. Settling is detected by a round counter plus a no-vote-changed predicate.
- **(b) Pull-style anti-entropy.** Idle voters poll a randomly selected peer for proposal state; convergence is driven by readers, not writers. Settling requires a separate round-tracking signal.
- **(c) Push-pull hybrid.** Combine (a) and (b): writers push on vote, idle voters also pull periodically. Faster convergence under churn, larger surface.

## Pros and cons of the options

**(a) Push-style epidemic [CHOSEN]**
- Pros: simplest schedule (broadcast on vote, done); reuses existing `vote` action machinery; deterministic round count given proposal id; matches the round-counter shape already specified for `ConsensusProposal`.
- Cons: every vote triggers `ceil(log2(N))` re-broadcasts → total in-process message count is `O(N log N)` per fully-voted proposal (broadcast amplification); silent voter dropouts in the chosen fanout subset extend convergence by one round; for small N the `ceil(log2(N))` fanout has degenerate cases — `N=2` gives `fanout=1` (single point of failure for re-broadcast) and `N=1` gives `fanout=0` (no propagation, so the predicate must short-circuit, see Specification); no reader-driven catch-up so a node that misses round `r` only catches up if a later round picks it.

**(b) Pull-style anti-entropy**
- Pros: tolerant to writer dropouts (idle readers re-fetch state); throttled by reader cadence rather than vote arrival; naturally tolerates voter joins mid-proposal because joiners simply pull the current state on their next poll.
- Cons: requires a separate idle-poll scheduler in the MCP server (new timer per voter); settling detection is harder — no clean round boundary, so `gossipRound` becomes meaningless and a separate convergence signal is required; higher latency to first convergence under low-churn load (no event triggers a fetch).

**(c) Push-pull hybrid**
- Pros: best convergence under churn; defensible against both writer and reader silence; standard production choice for distributed gossip (e.g. SWIM, Cassandra anti-entropy) precisely because pure push leaks state under partition.
- Cons: combined complexity of (a) + (b) — two independent schedulers; cost not justified given this fork's single-process runtime (no real network partitions) and small N (≤ 32) where pure push converges in 2–5 rounds.

## Decision outcome

**Chosen option: (a) push-style epidemic propagation**, because it delivers the eventual-consistency guarantee the USERGUIDE row requires with the smallest mechanical surface, slots cleanly into the existing `vote`-action code path in `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:582+`, and reuses the round-counter shape already specified for the proposal record. Fanout `ceil(log2(N))` gives sublinear bandwidth growth with deterministic convergence in `O(log N)` rounds — concretely, for the N=4–32 range the fork targets, that is 2–5 rounds, and with the per-rebroadcast jitter of 10–50ms specified under §Architecture this maps to wall-clock settling on the order of 50ms–250ms (excluding caller poll cadence on `_consensus`). Per ADR-0118 §T2, push-vs-pull-vs-push-pull escalates to its own ADR if real workloads contest the choice.

## Consequences

**Positive**
- No causal-broadcast or total-order requirement at the substrate layer (ADR-0114 protocol-layer respected).
- Bandwidth scales sublinearly with N (`ceil(log2(N))` fanout).
- Reuses existing `vote` action wiring; no new MCP tool; no new transport.
- Closes the "5 protocols (Gossip)" row in ADR-0116's verification matrix.

**Negative**
- Longer time-to-convergence than BFT/Raft (`O(log N)` rounds vs. constant for quorum-decided protocols).
- Eventual consistency only — callers must check `settled: true` before acting on the tally; `{ settled: false, exhausted: true }` is a possible terminal state callers must handle.
- Broadcast amplification: every vote schedules `ceil(log2(N))` re-broadcasts, so total in-process message count is `O(N log N)` per fully-voted proposal.
- Degenerate fanout at small N: `N=1` requires the predicate's short-circuit, `N=2` runs with fanout=1 (a single missed deferred-rebroadcast costs an extra round). Mitigated by the per-round timeout but still a tuning weakness for very small hives.
- Voter dropouts in the chosen fanout subset can extend convergence by one round; persistently disagreeing voter sets exhaust the budget rather than settle.

## Validation

Authoritative test list lives in §Refinement. This block is the per-level summary.

- **Unit + integration**: `forks/ruflo/v3/@claude-flow/cli/__tests__/mcp-tools-deep.test.ts` (added in the same commit as the implementation per `feedback-all-test-levels.md`).
- **Acceptance**: `check_hive_mind_gossip_consensus` in `lib/acceptance-hive-mind-checks.sh` (or the existing ADR-0118-allocated acceptance file). Wired into `scripts/test-acceptance.sh` per ADR-0094.

## Decision

**Implement gossip-style epidemic propagation with eventual-consistency settling.** Each `vote` action schedules deferred re-broadcasts to a deterministic-per-round subset of voters of size `ceil(log2(N))`; a `gossipRound` counter on each proposal tracks propagation depth; settling fires when `gossipRound >= ceil(log2(totalNodes))` AND `gossipRound > lastVoteChangedRound` (with an `N == 1` short-circuit). Round advancement is bounded by both `currentRoundBroadcastSet` coverage and a per-round timeout; total work is bounded by the hard budget `2 * ceil(log2(N))`. See §Specification for the full predicate, fields, and budget.

Push-style anti-entropy is the default. The ADR-0118 escalation rule applies: if push-vs-pull-vs-push-pull becomes a contested design decision, promote that choice to its own ADR rather than re-litigate here.

## Implementation plan

Five mechanical changes, all in `v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts` plus one agent file annotation.

### 1. Extend `ConsensusStrategy` enum

`v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:46`:

```diff
-type ConsensusStrategy = 'bft' | 'raft' | 'quorum';
+type ConsensusStrategy = 'bft' | 'raft' | 'quorum' | 'gossip';
```

Also extend the `_consensus` MCP tool's JSON-schema `strategy` enum (`hive-mind-tools.ts:575`) to include `'gossip'` so values are accepted at JSON-RPC validation, and update the tool `description` (line 564) which currently reads "BFT, Raft, or Quorum strategies".

### 2. Add gossip propagation in vote action

On each `vote` action where `strategy === 'gossip'`:

1. Apply the vote to the proposal's tally as today.
2. Pick a random subset of voters of size `ceil(log2(totalNodes))` (excluding the voter and any voters already in the current round's broadcast set).
3. Schedule a deferred re-broadcast of the current proposal state to that subset. Re-broadcasts use the same `_consensus` `vote` machinery — peers receive the proposal, merge their local view, and the cycle continues.
4. Increment the proposal's `gossipRound` counter when a full round completes (every node has either broadcast or been targeted in this round).

### 3. Track gossip state per proposal

Extend the `ConsensusProposal` shape with:

```ts
gossipRound: number;                  // current propagation round; 0 at proposal creation
lastVoteChangedRound: number;         // round number when tally last mutated
totalNodes: number;                   // snapshot of state.workers.length at proposal creation; voters joining later are admitted via anti-entropy but do not change the bound
currentRoundBroadcastSet: string[];   // voterIds already broadcast-from or targeted in the in-progress round; cleared when the round increments
```

`totalNodes` is snapshotted at propose-time and stays fixed for the proposal's lifetime — the `ceil(log2(N))` bound must be stable across rounds, otherwise late joiners would extend the round budget unboundedly. All four fields are persisted in the existing hive state JSON and serialised across restarts.

### 4. Settled predicate

The full predicate, hard budget, and per-round timeout live in §Specification. Implementation summary:

```
gossipRound >= Math.ceil(Math.log2(totalNodes))
  AND
(gossipRound > lastVoteChangedRound OR totalNodes === 1)
```

`_consensus` returns `{ settled: true, result: <tally> }` once the predicate holds. If `gossipRound > 2 * Math.ceil(Math.log2(totalNodes))`, return `{ settled: false, exhausted: true }` instead. Until either fires, return `{ settled: false, gossipRound, bound }` so callers can poll. Per `feedback-no-fallbacks.md`, exhaustion is never silently coerced to a settled result.

### 5. Wire the agent file

`forks/ruflo/v3/@claude-flow/cli/.claude/agents/consensus/gossip-coordinator.md` exists today as documentation-only — its frontmatter has no `allowed-tools`, no `implementation-status`, and the body never references the MCP tool. Add to the frontmatter:

```yaml
allowed-tools:
  - mcp__ruflo__hive-mind_consensus
implementation-status: implemented   # flipped only after CI is green; see §Annotation lifecycle
```

(Per ADR-0117, fork-side plugin docs use the `mcp__ruflo__*` namespace.) Add a short example block to the body showing `strategy: 'gossip'` being passed to `mcp__ruflo__hive-mind_consensus` so the agent's prose matches what the runtime accepts.

## Specification

**`ConsensusStrategy` enum surface.** `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:46` extends from a 3-member union to 4: `'bft' | 'raft' | 'quorum' | 'gossip'`. The `_consensus` MCP tool's JSON-schema `strategy` enum at `hive-mind-tools.ts:575` mirrors that change at the wire boundary so the value is accepted by JSON-RPC validation.

**Proposal-shape additions.** Four fields are added to `ConsensusProposal` (per Implementation §3): `gossipRound`, `lastVoteChangedRound`, `totalNodes`, `currentRoundBroadcastSet`. All four persist through the existing hive-state JSON serialisation and survive process restarts.

**Settle predicate.** A proposal is settled iff:

```
gossipRound >= ceil(log2(totalNodes))
  AND
(gossipRound > lastVoteChangedRound OR totalNodes == 1)
```

The first clause bounds depth; the second guarantees a quiescent round so callers don't act on a tally still mutating. The `totalNodes == 1` short-circuit handles the degenerate single-node case where `ceil(log2(1)) = 0` makes the first clause trivially true and `gossipRound = 0 = lastVoteChangedRound` makes a strict-greater-than check fail; without the short-circuit single-node proposals would never settle.

**Round budget.** A hard upper bound on rounds is part of the spec, not just the pseudocode: `gossipRound > 2 * ceil(log2(totalNodes))` returns `{ settled: false, exhausted: true }` to the caller. Callers handle exhaustion by retrying, escalating, or treating as inconclusive — never silently coercing to a "settled" tally (per `feedback-no-fallbacks.md`).

**Per-round timeout.** A round that has been open longer than `roundTimeoutMs` (default 5000ms; configurable via `_consensus` input parameter) advances even if `currentRoundBroadcastSet` does not yet cover all voters. This bounds settling latency in the presence of a slow voter that never sends — without the timeout, a single non-voting worker would block all rounds indefinitely. The dropped voter's vote is simply absent from the tally; the predicate still triggers because `lastVoteChangedRound` stops advancing once the responsive subset stabilises.

**Fanout function.** `fanout(N) = ceil(log2(N))` for N ≥ 2, with `fanout(1) = 0` (no peers to broadcast to). Selection is deterministic-per-round given `(proposalId, roundNumber)` — implemented as a seeded shuffle of the voter set, picking the first `fanout(N)` peers excluding the broadcaster and any voter already targeted in this round's broadcast set. The voter-set ordering must be canonical (sorted lexicographically by voterId) before the seeded shuffle so that two nodes seeing the same `(proposalId, gossipRound, voterSet)` produce the same target subset.

## Pseudocode

**Round-scheduling logic** (called from the `vote` action when `strategy === 'gossip'`):

```
on vote(proposalId, voterId, value):
  proposal = load(proposalId)
  prior_tally = proposal.tally
  apply_vote(proposal, voterId, value)
  if proposal.tally != prior_tally:
    proposal.lastVoteChangedRound = proposal.gossipRound
  N = proposal.totalNodes
  fanout_size = ceil(log2(N))
  if fanout_size == 0:                           # N=1 short-circuit
    persist(proposal); return
  voter_set_canonical = sort_lexicographic(voters(proposal))
  seed = hash(proposalId, proposal.gossipRound)
  candidates = voter_set_canonical - {voterId} - proposal.currentRoundBroadcastSet
  targets = seeded_shuffle(candidates, seed).take(fanout_size)
  for target in targets:
    schedule_deferred_rebroadcast(proposal, target)
  proposal.currentRoundBroadcastSet += targets ∪ {voterId}
  if proposal.currentRoundBroadcastSet covers all of voter_set_canonical:
    proposal.gossipRound += 1
    proposal.currentRoundBroadcastSet = []
  persist(proposal)
```

**Vote-rebroadcast selection.** Deferred re-broadcasts re-enter the same `vote` machinery on the target node (proposal merge + tally apply + further fanout). Canonicalising the voter set before the seeded shuffle ensures two nodes seeing the same `(proposalId, gossipRound, voterSet)` pick the same target subset — necessary so the `O(log N)` convergence bound holds.

**Settle-detection loop** (called by `_consensus` when caller polls or when a round completes):

```
on settle_check(proposalId):
  proposal = load(proposalId)
  N = proposal.totalNodes
  bound = ceil(log2(N))
  if proposal.gossipRound > 2 * bound:                                     # hard budget exhausted
    return { settled: false, exhausted: true, gossipRound: proposal.gossipRound, bound: bound }
  if proposal.gossipRound >= bound
     AND (proposal.gossipRound > proposal.lastVoteChangedRound OR N == 1):
    return { settled: true, result: proposal.tally, round: proposal.gossipRound }
  return { settled: false, gossipRound: proposal.gossipRound, bound: bound }
```

The hard budget `2 * ceil(log2(N))` caps how long `_consensus` will wait before returning `{ settled: false, exhausted: true }` — this protects callers from indefinite hangs on partitioned or persistently-disagreeing voter sets. Per `feedback-no-fallbacks.md`, exhaustion never coerces silently to a "settled" result; the caller decides what to do.

## Architecture

**Code path through `_consensus` MCP tool.** Caller invokes `mcp__ruflo__hive-mind_consensus` with `{ strategy: 'gossip', proposalId, ... }`. JSON-schema validation at `hive-mind-tools.ts:575` accepts the strategy after the enum is extended (Implementation §1); the `vote`-action handler beginning at `hive-mind-tools.ts:643` routes to the gossip branch via the existing `proposal.strategy` switch. The branch lives alongside the existing `bft`/`raft`/`quorum` cases — no new file, no new MCP tool registration.

**Deferred-broadcast scheduling layer.** Re-broadcasts run via a timer/queue: each scheduled rebroadcast lands in a per-proposal queue with a small jitter (e.g. 10-50ms) to avoid thundering-herd convergence. The queue drains on the same Node event loop as the rest of the MCP server — no new worker thread, no new transport. Persistence of pending re-broadcasts is opportunistic; on restart, the next vote action re-seeds the round.

**Interaction with `hive-mind_broadcast` MCP tool.** Gossip rounds use the same broadcast surface that `mcp__ruflo__hive-mind_broadcast` exposes — proposal-state messages are point-to-point peer notifications, not full hive-wide broadcasts. The `hive-mind_broadcast` tool stays as today's hive-wide notification channel; gossip uses the lower-level peer-message path inside the MCP server (no caller-visible new tool).

**Agent-file annotation update.** `forks/ruflo/v3/@claude-flow/cli/.claude/agents/consensus/gossip-coordinator.md` does not currently carry `allowed-tools` or `implementation-status` frontmatter. Per Implementation §5, this ADR adds both: `allowed-tools: [mcp__ruflo__hive-mind_consensus]` (added in the same commit as the implementation) and `implementation-status: implemented` (added only after CI is green, via the P1 materialise run that reads ADR-0118 §Status — see §Completion). The body gains a short example showing `strategy: 'gossip'` flowing through `mcp__ruflo__hive-mind_consensus` so prose and runtime stay aligned.

## Refinement

**Edge cases**

- **Voter set changes mid-round.** `proposal.totalNodes` is snapshotted at propose-time and never mutates, so the `ceil(log2(N))` bound is stable. A worker joining `state.workers` mid-round is admitted into round `r+1`'s candidate pool via the canonicalised voter-set lookup; it does not reset `gossipRound`. A worker leaving `state.workers` mid-round simply drops from future fanout subsets; already-scheduled deferred broadcasts to that voter fail silently on send and are not retried.
- **fanout=0 with N=1.** Single-node proposals settle on first vote: `bound = 0`, the first clause of the predicate holds immediately, and the `N == 1` short-circuit in the second clause makes settling fire on the first `settle_check`. Caller sees `settled: true` on the first poll.
- **fanout=1 with N=2.** With two voters, fanout is 1 — re-broadcasting from voter A reaches voter B (or vice versa) in a single hop. If the chosen target is unresponsive, the round timeout (Specification §Per-round timeout) advances `gossipRound` after `roundTimeoutMs` so settling is still bounded; without the timeout, N=2 with one slow voter would block indefinitely.
- **Tie-breaks.** Gossip itself does not resolve ties — the underlying tally algorithm does. Push protocol terminates when the tally is stable (predicate's second clause); a tied tally is still a stable tally, and the result returned reflects whatever tie-break the strategy's `apply_vote` already encodes.
- **Slow voter that never sends.** Without the per-round timeout, a voter that holds the round open by neither voting nor responding to deferred re-broadcasts blocks `currentRoundBroadcastSet` from ever covering all voters, so `gossipRound` never advances and settling never fires. With the per-round timeout (Specification §Per-round timeout), the round advances after `roundTimeoutMs`; the slow voter's vote is absent from the tally but the predicate can still fire once `lastVoteChangedRound` quiesces.
- **Voter dropout in chosen fanout subset.** Re-broadcast send-failures are silent; the dropout's vote is missing from the tally but the round still advances when `currentRoundBroadcastSet` covers all *responsive* voters or the round timeout fires. Convergence may take one extra round.
- **Network partition (in this single-process runtime).** True network partitions cannot occur (all voters share the same `state.json`). The "partition" test case (Validation, Acceptance criteria) is a synthetic stuck-broadcast simulation — the test injects a flag that makes deferred re-broadcasts no-op for a configured subset of voters, then heals by clearing the flag.
- **Round budget exceeded.** If `gossipRound > 2 * ceil(log2(N))` without settling (e.g. persistent disagreement), `_consensus` returns `{ settled: false, exhausted: true }`. Caller handles by retrying, escalating, or treating as inconclusive — no implicit fallback to a different strategy (per `feedback-no-fallbacks.md`).
- **Caller invokes `vote` with no votes received yet.** A `settle_check` on a proposal with zero votes returns `{ settled: false, gossipRound: 0 }` — never `{ settled: true, result: <empty-tally> }`. Per `feedback-no-fallbacks.md`, a no-vote tally is not a settled tally and must not be coerced to one.

**Error paths**

- Round budget exhaustion surfaces explicitly to the caller, never silently coerces to a tallied result.
- Persistence failures on `gossipRound` increment: the round counter is fail-loud — a write failure rejects the vote rather than continuing with a stale counter.
- Malformed proposal state on load (corrupt JSON, missing fields): explicit error; no silent default-zeroing of `gossipRound` or `lastVoteChangedRound`.

**Test list**

- **Unit** (`forks/ruflo/v3/@claude-flow/cli/__tests__/mcp-tools-deep.test.ts`):
  - `fanout` — `ceil(log2(N))` for N ∈ {1, 2, 3, 4, 7, 8, 15, 16, 32}; assert N=1 → 0, N=2 → 1
  - settle predicate — round-bound clause only is insufficient (returns `{ settled: false }` while votes still mutating); no-change clause only is insufficient (returns `{ settled: false }` while round-bound not yet reached); `N == 1` short-circuit fires on the first poll
  - no-vote rejection — `settle_check` on a proposal with zero votes returns `{ settled: false, gossipRound: 0 }`, never settled
  - hard budget — `gossipRound > 2 * ceil(log2(N))` returns `{ settled: false, exhausted: true }` (per `feedback-no-fallbacks.md`, never silently coerces to settled)
  - deterministic shuffle — same `(proposalId, gossipRound, voterSet)` → same target subset across two independent calls; permuting voter-set input order does not change output (canonical sort invariant)
- **Integration** (`forks/ruflo/v3/@claude-flow/cli/__tests__/mcp-tools-deep.test.ts`, real `_consensus` invocation):
  - full round to convergence — N=8, all voters vote once, assert settling within `ceil(log2(8)) + 1 = 4` rounds
  - convergence under simulated partition — N=8, deferred-rebroadcast no-op flag set on 4 voters, drive votes, clear flag, assert settling within 3 further rounds
  - anti-entropy joiner — voter joins after `gossipRound >= 1`, contributes without resetting counter; `proposal.totalNodes` does not change
  - per-round timeout — N=4, one voter never sends; assert `gossipRound` advances after `roundTimeoutMs` and predicate still fires
  - round-budget exhaustion — synthetic stuck-partition flag held permanently, assert `{ settled: false, exhausted: true }` once `gossipRound > 2 * ceil(log2(N))`
- **Acceptance** (`lib/acceptance-hive-mind-checks.sh` or the existing ADR-0118 file):
  - `check_hive_mind_gossip_consensus` — invokes the gossip-coordinator agent through a freshly init'd project, drives `_consensus` with `strategy: 'gossip'` via `$(_cli_cmd)` (per `reference-cli-cmd-helper.md`), asserts settling and tally match expected outcome and that `{ settled: false, exhausted: true }` is observable on a forced-exhaustion variant

## Completion

**Annotation lift criterion.** Per ADR-0118 §Annotation lifecycle, two artifacts update only after CI is green:

1. ADR-0116's plugin README `## Known gaps vs. USERGUIDE` table — drop the "5 protocols — Gossip portion" row.
2. `forks/ruflo/v3/@claude-flow/cli/.claude/agents/consensus/gossip-coordinator.md` frontmatter — set `implementation-status: implemented`. (The field does not exist today; it is added by the materialise run, not flipped from a prior value.)

The next P1 materialise run reads ADR-0118's §Status table and only lifts annotations for tasks marked `complete`.

**Acceptance wire-in.** `check_hive_mind_gossip_consensus` registers in the appropriate phase of `scripts/test-acceptance.sh` (likely P3 alongside other hive-mind protocol checks). Per `reference-cli-cmd-helper.md`, the check uses `$(_cli_cmd)` rather than raw `npx @sparkleideas/cli@latest`. Full cascade (`npm run test:acceptance`) must pass before ADR-0118 §Status row T2 flips to `complete` and the annotation lifts.

## Acceptance criteria

- [ ] `ConsensusStrategy` enum includes `'gossip'` at `mcp-tools/hive-mind-tools.ts:46`; `_consensus` JSON-schema strategy enum at `mcp-tools/hive-mind-tools.ts:575` accepts it; `_consensus` tool description (line 564) updated to mention Gossip.
- [ ] **Convergence under simulated partition**: N=8 voters, deferred-rebroadcast no-op flag set on 4 voters, drive votes, clear flag, assert that within `ceil(log2(8)) = 3` further rounds the responsive set converges to the same tally.
- [ ] **Settling latency bound**: from a fresh proposal, settling completes within `ceil(log2(N)) + 1` rounds when no vote changes mid-flight (the `+1` accounts for the strictly-greater-than `lastVoteChangedRound` clause).
- [ ] **Anti-entropy step**: a node joining mid-proposal (after `gossipRound >= 1`) receives current state via the next round's broadcast subset and contributes its vote; `proposal.totalNodes` and `gossipRound` do not change.
- [ ] **Per-round timeout**: a proposal with one slow voter that never sends still advances `gossipRound` after `roundTimeoutMs` (default 5000ms) and ultimately settles or exhausts.
- [ ] **Hard budget exhaustion**: forced-stuck-partition test case returns `{ settled: false, exhausted: true }` once `gossipRound > 2 * ceil(log2(N))`; never silently coerces to a settled tally.
- [ ] **No-vote rejection**: `settle_check` on a proposal with zero votes returns `{ settled: false, gossipRound: 0 }`, never settled (per `feedback-no-fallbacks.md`).
- [ ] `forks/ruflo/v3/@claude-flow/cli/.claude/agents/consensus/gossip-coordinator.md` frontmatter gains `allowed-tools: [mcp__ruflo__hive-mind_consensus]` (in the impl commit) and `implementation-status: implemented` (in the post-CI materialise run, per ADR-0118 §Annotation lifecycle); example body shows `strategy: 'gossip'`.
- [ ] Per ADR-0118 §Annotation lifecycle, the "5 protocols — Gossip portion" annotation in ADR-0116's plugin README lifts only after CI is green.

## Risks

**Medium.** Eventual-consistency semantics are subtle: the settled predicate must be conservative enough that callers don't act on a partially-propagated tally, and liberal enough that settling is bounded. The `lastVoteChangedRound` field is the key correctness lever — get it wrong and either settling never converges (too strict) or callers see stale tallies as "settled" (too loose).

The random-subset selection must be deterministic-per-round given `(proposalId, gossipRound, voterSet)`, with the voter set canonicalised before shuffling. Skip the canonicalisation and two voters seeing the same `(proposalId, gossipRound)` but disagreeing on `state.workers` ordering produce different target subsets — the `log(N)` bound doesn't hold and convergence becomes probabilistic rather than deterministic.

The per-round timeout is the second correctness lever: without it, a single non-voting worker blocks all gossip rounds indefinitely (`currentRoundBroadcastSet` never covers all voters). Set the default too tight (e.g. < 100ms) and slow-but-responsive voters get classified as dropouts; too loose (e.g. minutes) and a dead worker stalls the proposal far beyond the asymptotic `O(log N)` rounds bound.

**Promote to design-decision ADR if** anti-entropy protocol choice (push vs. pull vs. push-pull) becomes contested. Push is the chosen default per the ADR-0118 task definition; if a real workload reveals it as wrong, that's a design decision deserving its own ADR-0131+ (ADR-0121 through ADR-0130 are already allocated).

## References

- ADR-0116 §USERGUIDE-vs-implementation verification matrix (the audit row this closes)
- ADR-0118 §T2 (the task definition lifted into this ADR)
- ADR-0114 (architectural model — protocol-layer constraints the gossip implementation must respect)
- ADR-0117 (marketplace MCP server registration — establishes the `mcp__ruflo__*` namespace used in agent frontmatter)
- USERGUIDE Hive Mind contract: substring anchor `**Consensus Strategies**` in `/Users/henrik/source/ruvnet/ruflo/docs/USERGUIDE.md`

## Review notes

Open questions surfaced during review (2026-05-02), not blocking the Proposed status:

1. **`hive-mind_consensus` does not currently support a polling/`settle_check` action.** The existing actions are `propose | vote | status | list` (`hive-mind-tools.ts:569`). The pseudocode's `settle_check(proposalId)` maps most naturally to extending `status` to return `{ settled, exhausted, gossipRound, bound }` for gossip-strategy proposals — but the spec doesn't say which action surfaces the predicate result. Decide before implementation: extend `status`, add a new `settle` action, or fold settling into the next `vote` response.
2. **`roundTimeoutMs` configurability.** Spec says it's "configurable via `_consensus` input parameter" but the input is most naturally set at `propose` time, not `vote` time, and the existing schema has no such field. Confirm whether `roundTimeoutMs` joins `timeoutMs` (which today is raft-only) on the `propose` action or becomes a separate gossip-only knob.
3. **Persistence of pending re-broadcasts across restarts.** §Architecture says "opportunistic; on restart, the next vote action re-seeds the round" — but if no vote arrives after restart, the proposal sits indefinitely until the hard budget exhausts via wall-clock-based progress checks. Worth confirming whether that's acceptable or if proposals need an explicit replay-on-load step.
4. **"Network partition" terminology.** The Refinement edge case spells out that no real partition exists in this single-process runtime, but the older language in the Decision drivers still uses "partition simulation" framing. Future readers may misread the abstraction; consider a follow-up rename to "stuck-broadcast simulation" everywhere if confusion surfaces.
5. **Interaction with raft term-pinning.** Raft proposals use `term` as a uniqueness key (line 597); gossip proposals don't. Confirm there's no implicit collision when a queen running raft and a non-queen worker running gossip create proposals concurrently — the §595 raft-only check guards this today, but that guard's exemption is implicit, not documented.
