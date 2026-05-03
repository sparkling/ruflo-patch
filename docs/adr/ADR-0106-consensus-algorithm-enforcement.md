# ADR-0106: Consensus algorithm enforcement

- **Status**: Accepted; in-handler dispatch superseded by ADR-0119 (T1 weighted) + ADR-0120 (T2 gossip) + ADR-0121 (T3 CRDT) — all complete in ADR-0118 §Status (2026-05-03). Daemon-resident `ConsensusEngine` (Option A wiring) intentionally deferred per §Out of scope (federation infrastructure, ~1400 LOC parked). Orphaned: `forks/ruflo/v3/@claude-flow/swarm/src/consensus/{raft,byzantine,gossip,index}.ts` — preserved per §Out of scope. — Original status: Full wire-up of `swarm/src/consensus/{raft,gossip,byzantine}.ts` (443 + 513 + 431 LOC) + `ConsensusEngine` (267 LOC) into `hive-mind_consensus` MCP handler via daemon-resident pattern, per memory `feedback-no-value-judgements-on-features.md`. All 4 strategies become real protocol implementations (raft term-based leader election + log replication; gossip epoch-based propagation; byzantine PBFT vote-counting + equivocation detection — signatures-unverified annotation stays as documented limitation, not gate). Upstream's `6992d5f67` JSON-tally improvements (term-collision, Byzantine cross-vote detection) layer on top. Add CLI flag exposure (`strategy` / `term` / `quorumPreset` / `timeoutMs`) so all protocol parameters are user-addressable. Trust-model framing stays as documented context. Implementation in ADR-0103's program (post-W5; now operationalised via ADR-0118 §Status table).
- **Date**: 2026-04-29 (promoted 2026-05-01)
- **Roadmap**: ADR-0103 item 2
- **Scope**: hive-mind consensus protocols (`raft` / `byzantine` / `gossip` /
  `quorum` / `crdt`) — runtime fault-tolerance properties, not just labels.

## Context

README claims, surveyed:

- "consensus on decisions—**even when some agents fail**" (line 204)
- "Coordination | … | Manages agent teams (Raft, Byzantine, Gossip)" (line 208)
- "Consensus | Byzantine, Weighted, Majority | **Fault-tolerant decisions (2/3 majority for BFT)**" (line 211)
- "🗳️ **3 Consensus Algorithms**: Majority, Weighted (Queen 3x), **Byzantine (f < n/3)**" (line 216)
- "Queen-led hierarchy with **5 consensus algorithms** (Raft, Byzantine, Gossip)" (line 402)
- "**Byzantine fault-tolerant voting** (f < n/3), weighted, majority" (line 404)
- "Consensus Protocols: ✅ **5** (Raft, BFT, etc.)" (line 751)
- "🛡️ **Byzantine Consensus** | Coordinates agents even when some fail or return bad results | Fault-tolerant, **handles up to 1/3 failing agents**" (line 794)
- CLI: `--consensus byzantine` (line 1631)
- Skill doc: `byzantine | raft | gossip | crdt | quorum`

Multiple internal inconsistencies:

- Count varies: 3 / 4 (`Raft/BFT/Gossip/CRDT`) / 5
- Conflates **protocols** (Raft, Byzantine, Gossip — how nodes agree) with
  **aggregations** (Majority, Weighted, Supermajority — how votes are tallied)

## Investigation findings

### Source archaeology — three levels of "consensus"

| Layer | Location | What it does | Wired? |
|---|---|---|---|
| 1. **Swarm package runtime** | `v3/@claude-flow/swarm/src/consensus/{raft,byzantine,gossip,index}.ts` | Full implementations: `RaftConsensus` (term-based leader election + log replication), `ByzantineConsensus` (11891 bytes, f<n/3 voting), `GossipConsensus` (13651 bytes, epoch propagation). `ConsensusEngine` wraps them with a `'raft' \| 'byzantine' \| 'gossip' \| 'paxos'` (paxos→raft) algorithm switch. | **Imported by `unified-coordinator.ts:172` only**. NOT imported by CLI. |
| 2. **Swarm tests** | `v3/@claude-flow/swarm/__tests__/consensus.test.ts` | Direct vitest suites against `RaftConsensus`, `ByzantineConsensus`, `GossipConsensus`. | Tests only. |
| 3. **MCP tool surface** | `v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:563` `hive-mind_consensus` | Pure JSON state-record operation. Accepts `strategy: 'bft' \| 'raft' \| 'quorum'`. Calculates required votes via `calculateRequiredVotes(strategy, totalNodes, quorumPreset)`. Tracks per-strategy fields (term for raft, byzantineVoters for bft, quorumPreset for quorum). Stores proposals in `state.consensus.pending`. **Does NOT call into swarm-package consensus code.** | This is what gets used. |

### What `hive-mind_consensus` actually does (handler at line 582)

For `action='propose'`:
1. Loads hive state from `.claude-flow/hive-mind/state.json`.
2. For Raft: rejects duplicate-term pending proposals with the existing-proposal-ID echoed back.
3. Calculates `required` vote count via the strategy's threshold (2/3 for BFT, term-majority for Raft, configured preset for Quorum).
4. Constructs a `ConsensusProposal` JSON object with strategy-specific bookkeeping fields.
5. Pushes to `state.consensus.pending`, saves under §5 lock.

For `vote` / `status` / `list`: pure JSON read/write under the same lock.

**No Raft state machine. No Byzantine signature verification. No Gossip
epoch propagation. No leader election. No log replication. No "even
when some agents fail" detection.** The MCP surface is a tally calculator
with strategy-shaped record keeping.

### Strategy mismatch

Three definitions of the consensus algorithm set don't agree:

| Source | Algorithms |
|---|---|
| Swarm package code | `raft`, `byzantine`, `gossip` (+ `paxos`→`raft` fallback) |
| MCP tool input enum | `bft`, `raft`, `quorum` |
| README §Hive Mind Capabilities | `Majority`, `Weighted (Queen 3x)`, `Byzantine (f<n/3)` |
| README diagram (line 65) | `Raft/BFT/Gossip/CRDT` |
| README comparison row | `5 consensus algorithms (Raft, Byzantine, Gossip)` |
| Skill doc | `byzantine`, `raft`, `gossip`, `crdt`, `quorum` |

`crdt` and `quorum` have no runtime implementation in the swarm package.
`gossip` exists in the swarm package but is not exposed via the MCP tool.
`weighted` and `majority` are aggregation modes, not protocols.

### Trust model context

Within a single hive, all workers are Task sub-agents spawned BY the Queen
INSIDE the same `claude` session. They share:

- The same model
- The same authentication context
- The same MCP tool boundary
- No independent identity / no cryptographic separation

This is a **trusted-clique model**, not a Byzantine adversarial model.
Byzantine fault tolerance (f<n/3 with signature verification) is
mathematically meaningful for **independent untrusted nodes**; for a
clique of LLM-spawned sub-agents from one session, it's theatrical.

The exception is **federated scenarios** (multiple machines / multiple
hives coordinating). The swarm package's runtime would be appropriate
there, but no upstream code wires hives across machines today.

## Current state verdict

- ✅ Code: `RaftConsensus`, `ByzantineConsensus`, `GossipConsensus` exist
  in the swarm package, with tests.
- ❌ Wiring: CLI / MCP-tool path does not use them. The `hive-mind_consensus`
  MCP tool is JSON tally calculation with strategy-shaped bookkeeping.
- ❌ Label coherence: README, skill doc, MCP tool, and swarm code each
  cite a different set of algorithms.
- ❌ "Even when some agents fail": the MCP tool has no Byzantine adversary
  detection, no equivocation rejection, no malformed-vote handling.
  Worker absence (didn't vote within the timeout) is the only failure
  mode the JSON layer recognizes.
- ⚠️ Trust model: hive workers are not independent untrusted nodes;
  Byzantine guarantees are over-claimed regardless of wiring.

## Decision options

### Option A — Wire `ConsensusEngine` into MCP tool

Replace the JSON-tally handler in `hive-mind_consensus` with calls into
`v3/@claude-flow/swarm/src/consensus/index.ts`. Per-hive `ConsensusEngine`
instance, persisted across MCP calls.

**Hard problem**: `ConsensusEngine` is `EventEmitter`-based and stateful.
The MCP tool handler is process-local (each `claude-flow mcp start` is
a fresh process), and proposals must persist across MCP-tool invocations
that may land in different MCP-server instances.

Sub-options:
- **A1**: Put ConsensusEngine in the daemon process (long-running),
  expose via socket. MCP tool handlers RPC into the daemon.
- **A2**: Serialize ConsensusEngine state into `state.consensus` JSON
  on every call; rehydrate on next call. Loses event-emitter semantics
  but keeps state.
- **A3**: Run ConsensusEngine only inside the Queen's session (no
  cross-process). Means the Queen owns the engine; MCP tools just record
  results. Limited to single-hive scenarios.

### Option B — Improve JSON-tally semantics, drop protocol claims

Keep the existing handler. Fix the gaps:

1. Equivocation detection: if a `voterId` votes differently on the same
   proposalId, mark the voter as Byzantine and exclude its votes.
2. Worker-absence handling: if a quorum can't be reached because workers
   never voted, surface that explicitly in the proposal status (instead
   of "pending forever").
3. Term progression for Raft: enforce monotonically increasing terms
   (already partially done — duplicate-term-pending rejected).
4. Reframe the README and CLI flag wording: `--consensus` becomes
   `--vote-tally-mode`; values are `majority` / `supermajority` /
   `unanimous` / `weighted`. Drop "fault-tolerant" / "f<n/3" claims.
5. Park the swarm-package implementations as `// @internal — reserved
   for federated scenarios (ADR-0106 recommends keeping for future
   cross-hive consensus)`.

### Option C — Doc correction only

README updated to:

> "The hive uses majority/supermajority vote tallying among Queen-spawned
> workers. Strategy labels (`raft`, `byzantine`, `quorum`) select tally
> shape (term-based / 2/3 / configurable). Workers in a hive are
> trusted siblings spawned by the same Queen — Byzantine adversary
> detection is not applicable to that trust model."

CLI flags retained, no code change. ConsensusEngine in swarm package
documented as "future federated scenario infrastructure."

### Option D — Hybrid (recommended)

- **Within a hive** (worker-to-worker, all under one Queen session):
  ship Option B. Improve the JSON-tally handler with equivocation
  detection, absence handling, and clearer status. Reframe README to
  match the trust model.
- **Across hives** (federated, multi-machine, future): keep
  `ConsensusEngine` as the infrastructure. Add a separate
  `mcp__ruflo__cross-hive_consensus` tool (future ADR) that wires Raft
  for leader election among Queens. Document the line in ADR-0103.
- **Worker-failure handling** (the "even when some agents fail" claim):
  belongs to ADR-0109. This ADR contributes the JSON-tally side — when
  a worker doesn't vote, the proposal status surfaces it; ADR-0109
  decides on retry / replacement / quorum-with-loss.

This split lets the README claim be honest (intra-hive: trusted-clique
voting; cross-hive: real Raft) without forcing every hive run through
heavyweight consensus machinery.

## Test plan

**Regression** (automated, runs in `test:acceptance`):

1. `hive-mind_consensus({action:'propose', strategy:'bft'})` returns
   `required` = `ceil(2/3 * totalNodes)`.
2. `hive-mind_consensus({action:'propose', strategy:'raft', term:N})`
   succeeds; second propose with same term fails with the existing-proposal
   echo.
3. `hive-mind_consensus({action:'vote'})` with same `voterId` voting
   differently on same `proposalId` → second vote rejected with
   `error: 'equivocation detected'` (Option B/D).
4. `hive-mind_consensus({action:'status'})` with no votes after timeout
   → status `'failed-quorum-not-reached'` not `'pending-forever'`
   (Option B/D).
5. CLI `--consensus byzantine` flag → MCP `strategy: 'bft'` →
   2/3 supermajority threshold applied to vote counts.

**Live smoke** (uses developer's `claude` CLI; per ADR-0104 §Verification):

In a 5-worker hive with `--consensus byzantine`, run an objective that
demands a vote. Verify:

- `state.consensus.pending` populated with a proposal of strategy `'bft'`.
- `required` = 4 (ceil(5 * 2/3)).
- Workers cast votes via MCP tool calls (visible as `votes[voterId]`
  entries on the proposal).
- Final status `'accepted'` or `'rejected'` based on threshold, NOT
  `'pending'`.

**Unit** (in ruflo-patch `tests/unit/`):

- `acceptance-adr0106-consensus-checks.test.mjs` — paired with the
  acceptance lib per ADR-0097.
- Tests `calculateRequiredVotes` for each strategy/preset combination.
- Tests equivocation detection (Option B/D).
- Tests Raft term-progression rejection.

## Implementation plan

If Option D (recommended):

1. **Equivocation detection**: in `hive-mind_consensus({action:'vote'})`
   handler, before recording the vote, check if `voterId` already has
   a vote on this `proposalId`. If yes and vote differs, mark voter
   as Byzantine in `proposal.byzantineVoters`, reject the second vote.
2. **Absence-aware status**: in `hive-mind_consensus({action:'status'})`
   handler, if `Date.now() > timeoutAt && votes.length < required`,
   transition status to `'failed-quorum-not-reached'`.
3. **README reconciliation** (in fork README):
   - Replace "Byzantine fault-tolerant voting (f < n/3), weighted,
     majority" with "Vote tallying among Queen-spawned workers:
     majority, supermajority (2/3), unanimous, term-based (Raft-style
     leader election)".
   - Remove the "even when some agents fail" claim (or move it to
     ADR-0109's worker-failure-handling section once that ships).
   - Document the swarm package's `ConsensusEngine` / `RaftConsensus` /
     etc. as "future federated infrastructure, not used by current hive
     command".
4. **CLAUDE.md update** (fork): document `--consensus` as a tally-mode
   flag with the four supported values.
5. **Tests**: regression + paired unit per ADR-0097.

If Option A (full wire-up): defer for a follow-up ADR — daemon socket
transport for ConsensusEngine state is its own design problem.

## Risks / open questions

- **R1 — `paxos` falls back to raft silently**: in `ConsensusEngine.initialize()`,
  `case 'paxos':` falls through to `createRaftConsensus`. If MCP tool ever
  forwards `paxos`, that's a silent algorithm swap. Per memory
  `feedback-no-fallbacks.md`, fail loudly instead.
- **R2 — `crdt` and `quorum` mismatch**: skill doc lists them, swarm code
  doesn't. If users `--consensus crdt`, what happens? Currently nothing
  enforces it; today the MCP tool would reject unknown values via the
  enum. Either implement them or remove from the skill doc.
- **R3 — Strategy alias**: MCP tool uses `'bft'`, code uses `'byzantine'`,
  README uses `'Byzantine'`. Alias mapping needs to be explicit.
- **R4 — Cross-hive (federated) scenarios**: this ADR explicitly says
  ConsensusEngine is for that future. If federated never happens, the
  swarm-package consensus code is dead weight. Worth checking in 6 months.

## Out of scope

- Implementing CRDT (`@automerge/automerge` or similar) — separate ADR if
  ever needed.
- Implementing `quorum` as a distinct protocol from "configurable
  threshold on existing tally" — the skill doc lists it, but the MCP
  tool already covers it via `quorumPreset`.
- Federated cross-hive consensus — separate ADR.
- Worker failure handling (retry / replacement) — ADR-0109.
- Daemon socket transport for ConsensusEngine state — separate ADR if
  Option A is ever revisited.
- README rewrite (covered by ADR-0101).

## Recommendation

**Updated 2026-04-29 per memory `feedback-no-value-judgements-on-features.md` ("import ALL features"):** earlier draft recommended **Option D** (improve JSON tally + reframe README + park `ConsensusEngine` as future federation infrastructure). That was a value judgement to skip wiring on trust-model grounds. **Recommendation flipped to Option A — full wire-up.**

Ship **Option A**: wire `ConsensusEngine` into the `hive-mind_consensus` MCP handler as the dispatch layer behind `strategy: 'raft' | 'byzantine' | 'gossip' | 'paxos'`. All 4 protocols become real protocol implementations:

- `consensus/index.ts` (`ConsensusEngine`) → MCP-handler dispatch (`ConsensusEngine.initialize({algorithm: strategy})` replaces inline `switch`)
- `consensus/raft.ts` → real term-based leader election + log replication for `strategy:'raft'`
- `consensus/gossip.ts` → real epoch propagation for `strategy:'gossip'`
- `consensus/byzantine.ts` → real PBFT vote-tallying + equivocation detection for `strategy:'byzantine'` (structural PBFT only — signature verification is a separate feature gap, annotated in code, not a reason to leave the protocol unwired)

The **trust-model insight** from §Investigation findings (workers are trusted siblings under one `claude` session; adversarial Byzantine guarantees are theatrical until federation ships) **stays in the ADR as documented context**, but it does NOT gate wiring. Annotations on each class capture the limitation:

```
// raft.ts: Raft state is in-process per Queen session; cross-hive federation persistence is a separate enhancement.
// gossip.ts: Gossip epoch state per Queen session; cross-hive persistence is a federation enhancement.
// byzantine.ts: signatures field is structural-only; full PBFT identity verification is a separate feature gap (federation layer needs it). Wiring the protocol now means strategy='byzantine' produces real BFT-shape vote tallies; signature-verified adversarial guarantees come later.
```

**What changes vs the prior Option D recommendation**:
- The "improve JSON tally" parts of Option D (equivocation detection, absence-aware status) **survive** — those are real correctness wins regardless of which backend dispatches. Layer them on top of `ConsensusEngine` rather than alongside it.
- The "preserve as @internal future federation" parts **flip to "wire and annotate"**. Federation enhancements (signature verification, cross-hive persistence) become *additional features to add later*, not the *only condition under which we'd wire these classes*.
- The "reframe README to match trusted-clique" parts **stay deflated**. README still shouldn't claim adversarial Byzantine fault tolerance until signature verification ships. But "consensus algorithms enforced at runtime via real Raft/Gossip/PBFT state machines" becomes empirically true.

**Daemon-socket transport for ConsensusEngine state** (the Option-A "hard problem" called out earlier — `ConsensusEngine` is `EventEmitter`-based and stateful, so cross-MCP-call persistence is non-trivial): solve it via Option-A1's daemon-resident pattern. ConsensusEngine instances live in the long-running ruflo daemon; MCP-tool handlers RPC into the daemon. Same pattern as ADR-0107's QueenCoordinator advisor wiring — both classes become daemon-side state.

**Why Option A now**: per `feedback-no-value-judgements-on-features.md`, default to wire. ~3500+ LOC of tested consensus implementations exist; not wiring them was a value judgement that the user explicitly rejected. The trust-model framing remains true (workers are trusted siblings) but it informs *what additional features to build* (signature verification, cross-hive persistence), not *whether to wire what's already written*.
