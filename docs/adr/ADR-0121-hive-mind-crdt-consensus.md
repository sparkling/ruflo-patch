# ADR-0121: Hive-mind CRDT consensus protocol (T3)

- **Status**: **Implemented (2026-05-03)** per ADR-0118 §Status (T3 complete; fork 49a2786dd + ruflo-patch this commit). In-handler dispatch at `hive-mind-tools.ts:241` (enum) + `:78-104, 134-163` (vote tally).
- **Date**: 2026-05-02
- **Deciders**: Henrik Pettersen
- **Depends on**: ADR-0116 (hive-mind marketplace plugin — verification matrix), ADR-0118 (runtime-gaps tracker — owns T3 task definition)
- **Related**: ADR-0114 (substrate/protocol/execution layering), ADR-0117 (marketplace MCP-server registration — supplies the `mcp__ruflo__hive-mind_consensus` namespace the agent file references)
- **Scope**: Fork-side runtime work in `forks/ruflo/v3/@claude-flow/cli/src/`. Closes the CRDT portion of the "5 protocols" matrix row. Independent of T1 (Weighted) and T2 (Gossip) — no cross-Tn dependencies.

## Context

ADR-0116's verification matrix flagged the "5 protocols" row as ✗ partial: USERGUIDE advertises BFT, Raft, Quorum, Weighted, Gossip, and CRDT as available consensus protocols, but the runtime exposes only the first three. T3 in ADR-0118 owns the CRDT slice.

Empirical state in the fork (verified at HEAD):

| Surface | Path | Current value | Effect |
|---|---|---|---|
| Strategy enum (TS type) | `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:46` | `type ConsensusStrategy = 'bft' \| 'raft' \| 'quorum'` | `crdt` literally cannot be passed to `hive-mind_consensus`; type-check rejects it |
| Strategy enum (MCP inputSchema) | same file, `hive-mind_consensus` registration at line 563, `strategy.enum` at line 575 | `enum: ['bft', 'raft', 'quorum']` | runtime mirror of the type gap; rejected at MCP validation |
| `calculateRequiredVotes` dispatch | same file, line 84 | `switch (strategy)` with no `crdt` case | falls through `default` to majority — silent wrong-protocol behaviour today, throw point once `'crdt'` is added (see §Refinement) |
| Vote payload | same file, `proposal.votes: Record<string, boolean>` at line 55 | per-voter boolean tally | not a CRDT-state snapshot; no per-voter merged-state surface exists today |
| Agent file | `forks/ruflo/v3/@claude-flow/cli/.claude/agents/consensus/crdt-synchronizer.md` (and duplicate at `v3/@claude-flow/mcp/.claude/agents/consensus/crdt-synchronizer.md`) | upstream pseudocode skeleton; **no `allowed-tools` frontmatter field**; references `GCounter`/`ORSet`/`LWWRegister`/`RGA` classes that don't exist in the runtime | docs-only — the agent does not declare a tool grant and the tool it would call into has no `crdt` branch |
| USERGUIDE | upstream `docs/USERGUIDE.md` Hive Mind section | lists CRDT as one of 5 protocols | contract not honoured |

The `hive-mind_broadcast` tool (same file, line 857) is a string-message bulletin board (last-100 messages in `state.sharedMemory.broadcasts`), not a per-voter state-snapshot exchange. CRDT-state exchange between voters does not yet exist on any surface; this ADR adds it onto the existing proposal record, not onto `hive-mind_broadcast`.

Per `feedback-patches-in-fork.md`, USERGUIDE-promised features that don't work are bugs and bugs are fixed in fork.

## Decision drivers

- **USERGUIDE contract** — CRDT is one of 5 advertised consensus protocols; the runtime currently rejects `crdt` at the TS type level (`hive-mind-tools.ts:46`) and at the MCP `inputSchema.strategy.enum` (`:575`). Per ADR-0116's verification matrix, this is a partial-implementation bug.
- **No causal-broadcast requirement** — CmRDT (op-based) would require reliable causal broadcast; the substrate has no such layer (`hive-mind_broadcast` is a string-bulletin-board, not a causal op stream). CvRDT semantics (full-state exchange + commutative-associative-idempotent join) require only that voters exchange serialised state through the existing proposal record — no causal ordering, no exactly-once delivery contract, no new substrate.
- **Algebraic merge property** — commutative, associative, idempotent merge functions give mathematical convergence regardless of message order or duplication. Re-broadcast safety is inherent; no quorum coordination, no leader, no rounds beyond what `hive-mind_consensus` already runs.
- **Fork-side patching** — per `feedback-patches-in-fork.md`, the runtime fix lands on the fork, not as a codemod or upstream PR. New module `crdt-types.ts` is fork-internal source.
- **Three primitives map cleanly to the consensus shapes the round needs** — G-Counter for monotonic vote-count accumulation, OR-Set for the set of approving voter IDs, LWW-Register for the single-value verdict. Each primitive sits at exactly one role the round must produce; no speculative primitives.

## Considered options

- **Option A: State-based CRDTs (CvRDT)** — workers exchange full state; merge with a join function. Three primitives: G-Counter, OR-Set, LWW-Register.
- **Option B: Operation-based CRDTs (CmRDT)** — workers exchange operations; merge replays ops in causal order. Requires reliable causal broadcast.
- **Option C: Delta-CRDTs** — hybrid; ship state deltas instead of full state. Smaller payloads, more code surface (delta-state lattice + acknowledgement bookkeeping).

## Pros and cons of the options

### Option A: CvRDT (state-based) — chosen

- Pros: merge is commutative/associative/idempotent by construction; re-broadcast safe; no causal-broadcast layer required; CRDT-state rides on the existing proposal record (extend `ConsensusProposal`, not the broadcast bus); minimum new code surface (one module + three primitives).
- Cons: full-state payload grows with proposal cardinality and per-voter slot count (acceptable for short-lived consensus rounds — see §Risks for measured-bloat escalation criterion); OR-Set tombstones occupy memory until garbage collection; LWW tiebreaker drops one of two writes that arrive at the same `(timestamp, voterId)` key by construction (see §Refinement edge cases).

### Option B: CmRDT (operation-based)

- Pros: smaller per-message payload (op delta vs. full state); some primitives admit simpler merge semantics under guaranteed causal delivery.
- Cons: requires reliable causal broadcast, which the fork has no layer for; `hive-mind_broadcast` is a string-bulletin-board (last-100 messages, no causal ordering, no per-recipient delivery guarantee). Op-replay must be exactly-once, forcing dedup bookkeeping. Correctness contract leaks into the substrate layer.

### Option C: Delta-CRDTs

- Pros: bandwidth win over CvRDT for steady-state; preserves CvRDT's mathematical convergence properties.
- Cons: not a third algebra — delta-CRDTs are a transport-layer optimisation of state-based CRDTs (ship state diffs instead of full state). The lattice itself is still a CvRDT. The optimisation requires per-peer delta-acknowledgement bookkeeping and adds a delta-lattice surface alongside the state lattice — over-engineered for short-lived consensus rounds where full-state payload is bounded by participant count. If implementation measures payload bloat, this ADR's escalation criterion (§Risks) promotes the delta optimisation to its own ADR rather than implementing it speculatively here.

## Decision outcome

**Chosen option: CvRDT with G-Counter / OR-Set / LWW-Register** (traces to drivers *No causal-broadcast requirement*, *Algebraic merge property*, *Three primitives map cleanly*). It requires no substrate-layer guarantees beyond what `hive-mind_consensus` already provides, the merge property is mathematically self-evident (testable by property-based fuzzing), and the three primitives cover the round's needs without introducing optional or speculative lattice types. Option B is rejected as substrate-incompatible (no causal broadcast available); Option C is rejected as premature optimisation of the same algebra rather than a distinct alternative — consensus rounds are short-lived, payload bloat is not measured to be a problem.

If implementation surfaces a load-bearing reason to escalate (measured payload bloat that motivates delta state, causal-broadcast feature, RGA sequence semantics — see §Risks for the full escalation list), this ADR is promoted to a separate design-decision ADR before code lands. Default position commits only to the three primitives above.

## Consequences

### Positive

- Mathematical convergence guarantee — N replicas with arbitrary interleaved updates always converge to the same merged state, provable by property tests (idempotence + commutativity + associativity).
- Idempotent re-broadcast safe — workers can re-send the same state any number of times in any order without divergence; tolerates duplicates, retries, and out-of-order delivery natively.
- Closes the "5 protocols" matrix row in ADR-0116 once landed; no remaining CRDT-shaped runtime gap.
- Algebraic test surface (property-based) catches subtle merge bugs that scenario tests miss.

### Negative

- Full-state exchange bandwidth cost grows with proposal cardinality and voter count; acceptable for short-lived consensus rounds, brittle under future scale-out.
- LWW tiebreaker drops one of two writes that share the same `(timestamp, voterId)` pair — concrete loss case: the same voter writes twice in the same `Date.now()` millisecond (collision against itself); the second write's value vanishes silently. This is correct CvRDT behaviour for an LWW-Register, but it must be annotated in code and exercised by tests.
- The disappearing-voter case under G-Counter: a voter that increments and never returns leaves a stale slot that contributes to `value()` indefinitely (slot-wise max preserves the slot forever). This is correct CvRDT behaviour — votes are durable — but it must be annotated alongside the OR-Set tombstone note.
- OR-Set tombstones leak memory until garbage collection; for short-lived consensus this is bounded, but it must be annotated in code so future long-lived uses don't trip on it.

### Neutral

- New module `crdt-types.ts` adds a third consensus-shape file to `mcp-tools/`; future protocols (delta-CRDT, RGA) would extend rather than replace it.
- `ConsensusStrategy` enum gains `'crdt'` value; T1 (Weighted) and T2 (Gossip) extend the same enum — see §Risks for merge-conflict batching.

## Validation

- Unit: associativity / commutativity / idempotency property tests for each of G-Counter, OR-Set, LWW-Register; LWW tiebreaker collision tests with synthetic clock-skewed timestamps; OR-Set concurrent add/remove tombstone tests; G-Counter monotonicity test under simulated voter restart.
- Integration: round-trip merge convergence — N (N ≥ 3) replicas with randomised-interleaving fuzzer (≥ 100 schedules per primitive); verifies all replicas converge to the same merged state regardless of message order.
- Acceptance: `lib/acceptance-adr0121-crdt-consensus.sh` exercises the CRDT path through an init'd project — invokes `hive-mind_consensus` with `strategy: 'crdt'` via the `crdt-synchronizer.md` agent, observes a CRDT-merged verdict.

## Decision

**Implement state-based CRDT primitives (G-Counter, OR-Set, LWW-Register) and replace the vote tally for the `crdt` strategy with a CRDT merge over per-voter snapshots stored on the proposal record.** State-based (CvRDT) chosen over operation-based (CmRDT) as the default position because it does not require reliable causal broadcast — voters submit serialised state through `hive-mind_consensus.vote`, and the handler merges it into the proposal's `crdtState` accumulator using commutative-associative-idempotent join functions.

The three primitives cover the consensus shapes the existing `hive-mind_consensus` tool's resolved-proposal contract already needs:
- **G-Counter** — monotonic vote-count accumulation per voter
- **OR-Set** — set of approving voter IDs with safe add/remove under concurrent updates
- **LWW-Register** — single-value decision (the proposal verdict) with last-write-wins by `(timestamp, voterId)` tiebreaker

Merge functions are commutative, associative, and idempotent — convergence is mathematical, not protocol-driven. Workers can re-broadcast the same state any number of times in any order without divergence.

## Implementation plan

Derived from the ADR-0118 task index row for T3 (no narrative §T3 section exists upstream of this ADR — the row defines the surface; this section defines the steps). Files: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts` + new `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/crdt-types.ts`.

1. Extend `ConsensusStrategy` TS type at line 46 to include `'crdt'`; extend the `hive-mind_consensus` `inputSchema.strategy.enum` at line 575 to include `'crdt'`; extend the tool `description` at line 564 to list CRDT.
2. Implement CRDT primitives (G-Counter, OR-Set, LWW-Register) in `crdt-types.ts` with `merge` functions and the operations listed in §Specification.
3. Add a `crdt` case to the strategy dispatch in `calculateRequiredVotes` at line 84 (or short-circuit `crdt` before it reaches that helper, since CRDT rounds do not run a vote-count threshold). Replace the vote tally in `tryResolveProposal` (line 134) for the `crdt` strategy with a CRDT merge over per-voter snapshots stored on the `ConsensusProposal` record (extend `ConsensusProposal` at line 49 with an optional `crdtState` field carrying the serialised `{ votes, approvers, verdict }` triple).
4. Wire the agent file at `forks/ruflo/v3/@claude-flow/cli/.claude/agents/consensus/crdt-synchronizer.md` (and the duplicate at `v3/@claude-flow/mcp/.claude/agents/consensus/crdt-synchronizer.md`): add the missing `allowed-tools: mcp__ruflo__hive-mind_consensus` frontmatter field. Per ADR-0117 the `mcp__ruflo__*` namespace is supplied by the marketplace MCP-server registration; without ADR-0117 the agent's tool reference does not resolve at runtime.
5. Tests: idempotence, commutativity, associativity, conflict-free convergence (per §Validation).

## Specification

Three primitive surfaces, all from `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/crdt-types.ts` (new file).

### G-Counter

- `increment(voterId)` — monotonic add-1 to the per-voter counter slot owned by `voterId`. No-op if `voterId` is not the local node.
- `merge(a, b)` — per-voter slot-wise `max(a[voterId], b[voterId])` across the union of voter keys.
- `value()` — sum across all voter slots.
- State shape: `{ counts: Record<voterId, non-negative integer> }`.

### OR-Set

- `add(element, voterId)` — append `(element, uniqueTag)` where `uniqueTag` is generated locally; one tag per add invocation.
- `remove(element)` — move all `(element, *)` entries from `entries` to `tombstones`. Concurrent adds with un-seen tags survive removal.
- `elements()` — set of `element` values present in `entries` and not shadowed by `tombstones` for the same `(element, tag)`.
- `merge(a, b)` — `entries = a.entries ∪ b.entries`, `tombstones = a.tombstones ∪ b.tombstones`. Tombstones are observed-remove: only entries whose exact `(element, tag)` pair appears in tombstones are dropped.
- State shape: `{ entries: Set<(element, tag)>, tombstones: Set<(element, tag)> }`.

### LWW-Register

- `write(value, voterId, timestamp)` — replaces local register state if `(timestamp, voterId)` is lexicographically greater than the current state's `(timestamp, voterId)`.
- `value()` — current register value.
- `merge(a, b)` — pick whichever side has the lexicographically greater `(timestamp, voterId)` pair. On exact tie (same timestamp + voterId, which can happen on local re-broadcast), pick `a` deterministically.
- State shape: `{ value, timestamp, voterId }`.

### Tiebreaker contract (LWW)

The `timestamp` is a wall-clock millisecond from `Date.now()` on the writing voter — explicitly NOT a logical clock, NOT a vector clock, NOT an HLC. Logical clocks were considered and rejected as overkill for short-lived consensus rounds where a deterministic total order on `(timestamp, voterId)` already gives convergence. Wall-clock skew across voters is irrelevant to the algebra: the tiebreaker is total-ordered on the pair, so any skew magnitude resolves deterministically — the larger pair wins, full stop. What clock skew DOES change is which voter's value wins, not whether merge converges.

`voterId` is the stable string identifier the worker registers under in `state.workers` (NOT the node's hostname or PID — those drift across restarts). Test surface MUST include collision cases where two voters write the same register at the same `Date.now()` millisecond; the tiebreaker resolves by `voterId` string lexicographic comparison.

A voter writing twice in the same millisecond against itself is the one collision case where data is silently dropped (same `(ts, voterId)` pair on both writes); per §Consequences-Negative this is acknowledged correct LWW behaviour and tests must assert the second write loses.

### State-snapshot shape per voter

The snapshot a voter contributes to `hive-mind_consensus` carries one CRDT instance per consensus role:

- `votes: GCounter` — accumulated yea-vote count per voter
- `approvers: ORSet<voterId>` — set of voters who have approved the proposal
- `verdict: LWWRegister<verdictValue>` — the proposal's resolved verdict (single value, last-write-wins)

The triple lands on the existing `ConsensusProposal` record as a new optional field (`crdtState`). The CRDT round does NOT use `hive-mind_broadcast` — that tool is a string-message bulletin board with no per-voter snapshot path. Voters submit their CRDT triple through the `vote` action of `hive-mind_consensus` (extended to accept the triple alongside or in place of the boolean `vote`). The merge step on round close runs `merge` on each role independently.

## Pseudocode

Prose-level merge logic. Concrete implementation lands in `crdt-types.ts` per Implementation plan §2.

### G-Counter merge

For each voter key in the union of `a.counts` and `b.counts`, take the max of the per-voter slot values. Voter keys present in only one side carry their slot through unchanged (treat-as-zero on the absent side, so `max(x, 0) = x`); this handles non-overlapping state and is the standard CvRDT G-Counter join. Result is a new `GCounter` whose `counts` map has every voter key from both sides, each holding the larger of the two observed values. `value()` is the sum across the merged map. Idempotence: `merge(a, a)` produces slot-wise `max(x, x) = x`, so it equals `a`. Commutativity follows from `max` symmetry. Associativity follows from `max` associativity.

A disappearing voter leaves a stale slot that contributes to `value()` indefinitely. This is correct CvRDT semantics (votes are durable across voter death); §Consequences-Negative annotates the trade-off.

### OR-Set merge

Compute `entries = a.entries ∪ b.entries` and `tombstones = a.tombstones ∪ b.tombstones`. The `elements()` projection then drops any `(element, tag)` whose exact pair appears in `tombstones`. Add-wins under concurrent add/remove: if voter A adds `(x, tag1)` and voter B (without seeing tag1) removes `x`, B's tombstone set contains only the tags B observed; tag1 is not among them, so `(x, tag1)` survives the merge. Remove-after-observe works because B's tombstones include the exact tags B saw, and those tags propagate alongside the union.

### LWW-Register merge

Compare `(a.timestamp, a.voterId)` against `(b.timestamp, b.voterId)` lexicographically. Return whichever side has the greater pair. Exact equality on the pair only arises when the two sides represent the SAME write (local re-broadcast, or a voter writing identical `(value, ts, voterId)` twice — see §Tiebreaker contract); both sides hold the same `value`, so returning either side is safe. The implementation returns `a` deterministically for explicitness. Idempotence: `merge(a, a)` returns `a` because the pairs are equal. Commutativity: lexicographic max is symmetric; the equality branch is degenerate (same value on both sides) so the deterministic `a` choice does not break it. Associativity follows from lexicographic max associativity.

### Consensus-round flow through merge

1. `hive-mind_consensus` initiates a round with `strategy: 'crdt'`. The proposal record is created with an empty `crdtState` triple `{ votes: GCounter, approvers: ORSet, verdict: LWWRegister }`.
2. Each voter applies their local update — `votes.increment(voterId)`, `approvers.add(voterId, voterId)` if approving, `verdict.write(localVerdict, voterId, Date.now())`.
3. Each voter submits their snapshot through the `vote` action on `hive-mind_consensus`. The handler merges the incoming snapshot into the proposal's `crdtState` (per-primitive `merge`). No causal ordering is required; resubmission is safe (idempotent merge).
4. Round closes when all expected voter snapshots are observed (round termination is decided by the calling code, NOT by the CRDT layer — CRDT only provides convergence, not a stopping rule). The merged `verdict.value()` is the round's resolved verdict; `approvers.elements()` is the union of approvers; `votes.value()` is the total approval count.

Note: this flow does not use `hive-mind_broadcast`. Snapshot exchange rides on the `hive-mind_consensus.vote` path with the proposal record as the merge accumulator. `hive-mind_broadcast` remains a string-only bulletin board.

## Architecture

### `crdt-types.ts` module surface

Path: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/crdt-types.ts` (new file, per Implementation plan §2).

Exports: `GCounter`, `ORSet`, `LWWRegister` classes (or factory functions — concrete shape deferred to implementation). Each export carries an `instance.merge(other) -> instance` method plus the per-primitive operations listed in §Specification. No external dependencies; pure data structures.

### Integration with `hive-mind_consensus` MCP tool's strategy dispatch

`forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:46` is where `ConsensusStrategy` lives today (`'bft' | 'raft' | 'quorum'`). Implementation plan §1 extends this union (and the `inputSchema.strategy.enum` at line 575) to add `'crdt'`. The strategy-aware code paths to extend:

1. `calculateRequiredVotes` (line 84) — short-circuit `crdt` (CRDT rounds have no vote-count threshold; round termination is "all voters submitted", not "k of n approved").
2. `tryResolveProposal` (line 134) — gain a `crdt` branch that merges the proposal's `crdtState` triple and returns `'approved'` once all expected voters have submitted, or `null` while pending.
3. `ConsensusProposal` interface (line 49) — extend with optional `crdtState?: { votes, approvers, verdict }` carrying serialised CRDT state.

The vote-tally arithmetic that currently runs for `bft`/`raft`/`quorum` is bypassed entirely on the `'crdt'` branch — convergence is mathematical, not arithmetic.

### Snapshot exchange path

Voters submit CRDT-state snapshots through the `vote` action on `hive-mind_consensus` (handler at line 643+). The handler is extended on the `'crdt'` branch to (a) accept the serialised `{ votes, approvers, verdict }` triple alongside or in place of the boolean `vote`, and (b) merge it into `proposal.crdtState`. No new MCP tool, no use of `hive-mind_broadcast` (which is a string bulletin board, not a snapshot path).

Per ADR-0114 layering, the CRDT primitives sit in the protocol layer; `hive-mind_consensus` remains the execution-layer surface that drives them; the proposal record acts as the merge accumulator (substrate is the SQLite-backed `state.json`, not a network transport).

### Agent wiring

The agent file at `forks/ruflo/v3/@claude-flow/cli/.claude/agents/consensus/crdt-synchronizer.md` (and the duplicate at `v3/@claude-flow/mcp/.claude/agents/consensus/crdt-synchronizer.md`) currently has NO `allowed-tools` frontmatter field — it is upstream pseudocode that references `GCounter`/`ORSet`/`LWWRegister`/`RGA` classes that do not exist in the runtime. Implementation plan §4 adds `allowed-tools: mcp__ruflo__hive-mind_consensus` to the frontmatter and adds an integration test that drives the agent end-to-end.

The `mcp__ruflo__*` tool prefix is contributed by the marketplace MCP-server registration per ADR-0117; without that registration the agent's tool reference does not resolve. ADR-0121 lists ADR-0117 in §Related accordingly. The agent file's body (lines 41+) is upstream-authored pseudocode and is left unmodified — it does not have to match the runtime implementation; it is documentation only.

## Refinement

### Edge cases

- **LWW clock skew** — `Date.now()` on two voters can disagree. The tiebreaker is total-ordered on `(timestamp, voterId)`, so any skew magnitude resolves deterministically — the larger pair wins, regardless of how far apart the wall-clocks are. Skew changes which voter's value wins, not whether merge converges. Tests must include cases where voter B's clock is behind voter A's by a large margin yet B's write must lose deterministically.
- **LWW same-voter same-millisecond collision** — voter A writes `(v1, ts, A)` then `(v2, ts, A)` in the same `Date.now()` millisecond. The pairs are equal; per the §Tiebreaker contract the second write loses (the register holds `v1`). This is correct LWW semantics and must be exercised by a test asserting silent-drop behaviour.
- **OR-Set concurrent removes** — voter A removes `x` after observing tag1; voter B concurrently adds `(x, tag2)` without seeing tag1. After merge, A's tombstone set contains tag1 only; tag2 survives in `entries`; `x` is in `elements()`. Add-wins is the correct CvRDT semantic — tests must assert this rather than expecting remove to win.
- **G-Counter overflow at 2^53** — JavaScript Number precision caps integer slots at `Number.MAX_SAFE_INTEGER` (2^53 - 1). For consensus-vote use the per-voter slot is bounded by participant count and round count, so this is well below the limit. Annotate the constraint in the code as a no-op overflow handler (a comment that `Number.MAX_SAFE_INTEGER` is the implicit cap and that overflow indicates a bug, not an expected case); do not implement BigInt slots speculatively (per CLAUDE.md "no abstractions for single-use code").
- **Voter rejoins with stale state** — a voter that drops out and rejoins arrives with stale local CRDTs. On receiving the next merged proposal record, its state monotonically advances to at-least the merged max (G-Counter slot-wise, OR-Set entry-union, LWW lexicographic max). No special rejoin handshake is needed; the merge function is its own reconciliation. Stale-vs-fresh: the rejoiner's contribution is bounded — its slots are merged via max, so old slot values never overwrite newer ones; old OR-Set tombstones merge in via union (already-removed elements stay removed); old LWW values lose to newer `(ts, voterId)` pairs unless the rejoiner happens to be the latest writer.
- **Voter never rejoins** — see §Consequences-Negative; the disappeared voter's G-Counter slot persists indefinitely and contributes to `value()`. Correct CvRDT behaviour, not a bug.

### Error paths

- Invalid CRDT-state payload arrives via `hive-mind_consensus.vote` — merge MUST throw rather than silently coerce or fall back to a boolean tally. Per `feedback-no-fallbacks.md`, no fallback to "merge what we can"; the round fails loudly with a typed error.
- Unknown strategy reaches dispatch — the existing `default` branch of `calculateRequiredVotes` (line 102) currently returns a majority threshold for any unknown strategy. Per `feedback-no-fallbacks.md` this is a silent-fallback that masks failures; the `default` branch MUST be changed to throw on unknown strategy as part of this ADR's implementation. The `'crdt'` case is added explicitly, not absorbed by the default.
- `voterId` is missing on a write — `LWWRegister.write` MUST require `voterId` as a required argument. Throw on absence; do not default to a hostname or PID (both drift across restarts and break tiebreaker determinism).
- `ConsensusStrategy === 'crdt'` reached but `crdt-types.ts` export is missing — fail fast with a typed error before the round opens; do not fall back to quorum tally (would silently produce a non-CRDT result).

### Test list

- **Unit (property-based)** — for each primitive: 100+ randomised inputs assert `merge(a, a) === a`, `merge(a, b) === merge(b, a)`, `merge(merge(a, b), c) === merge(a, merge(b, c))`. Assertion uses semantic equality (deep-equal on canonicalised state), not reference equality.
- **Unit (LWW tiebreaker)** — synthetic timestamp-collision cases; assert `voterId` lexicographic comparison resolves all ties deterministically.
- **Unit (OR-Set tombstones)** — concurrent add (voter B, tag2) + remove (voter A, observing tag1 only); assert post-merge `elements()` contains the element via tag2.
- **Unit (G-Counter monotonicity)** — simulated voter restart that resets local count; assert merge with a previously-seen snapshot recovers slot value via slot-wise max.
- **Integration (round-trip merge convergence)** — N ≥ 3 replicas, randomised-interleaving fuzzer, 100+ schedules per primitive; assert all replicas converge to the same merged state regardless of message order.
- **Acceptance** — `lib/acceptance-adr0121-crdt-consensus.sh` (new file, wired into `scripts/test-acceptance.sh`) runs `hive-mind_consensus` with `strategy: 'crdt'` against an init'd project; asserts the agent at `forks/ruflo/v3/@claude-flow/cli/.claude/agents/consensus/crdt-synchronizer.md` (post-Implementation-plan-§4 edit, with `allowed-tools: mcp__ruflo__hive-mind_consensus`) drives the path and observes a CRDT-merged verdict whose value matches the LWW-Register decision and whose approver set matches the OR-Set union. Per `reference-cli-cmd-helper.md`, parallel acceptance checks use `$(_cli_cmd)`, never raw `npx @latest`.

## Completion

T3 marked `complete` in ADR-0118 §Status table, with Owner/Commit columns naming a green-CI commit. Annotation lift fires on the next materialise run after that flip — drops the "5 protocols (CRDT)" row from the plugin README gap table and updates the `implementation-status` frontmatter on both `crdt-synchronizer.md` agent copies. Canonical contract: ADR-0118 §Annotation lifecycle (lines 67-74).

### Acceptance wire-in

- `lib/acceptance-adr0121-crdt-consensus.sh` is added with executable bit set.
- `scripts/test-acceptance.sh` is edited to invoke the new check in the standard parallel wave (NOT the `RUFLO_RUVECTOR_TESTS` opt-in tier — CRDT consensus is non-WASM, safe in the parallel band).

## Acceptance criteria

- [ ] `ConsensusStrategy` type at `hive-mind-tools.ts:46` includes `'crdt'`; `hive-mind_consensus` MCP tool's `inputSchema.strategy.enum` at `:575` accepts `'crdt'` without throwing at validation
- [ ] `calculateRequiredVotes` `default` branch (line 102) throws on unknown strategy — no silent fallback (per `feedback-no-fallbacks.md`)
- [ ] `mcp-tools/crdt-types.ts` exports `GCounter`, `ORSet`, `LWWRegister` with `merge(a, b)` functions for each; `voterId` is a required parameter on `LWWRegister.write` (throws on absence)
- [ ] **Idempotence**: `merge(a, a) === a` for all three primitives (test with semantic equality on canonicalised state, not reference equality)
- [ ] **Commutativity**: `merge(a, b) === merge(b, a)` for arbitrary `a`, `b` of the same primitive type
- [ ] **Associativity**: `merge(merge(a, b), c) === merge(a, merge(b, c))` for arbitrary `a`, `b`, `c`
- [ ] **Conflict-free convergence**: given N (N ≥ 3) replicas with arbitrary interleaved updates, all replicas converge to the same merged state regardless of message order; test with a randomised-interleaving fuzzer (≥ 100 random schedules per primitive)
- [ ] **LWW collisions**: synthetic `Date.now()`-collision tests assert `voterId` lexicographic comparison resolves all ties deterministically; same-voter same-millisecond write asserts the second write loses
- [ ] `hive-mind_consensus` with `strategy: 'crdt'` returns a settled verdict whose value matches the LWW-Register merged decision; the OR-Set of approving voters matches the union across all received votes; the proposal record carries a `crdtState` field on the `'crdt'` branch only
- [ ] `crdt-synchronizer.md` agent file (both copies — CLI and MCP package) declares `allowed-tools: mcp__ruflo__hive-mind_consensus`; integration test invokes the agent and observes a CRDT-merged result
- [ ] `npm run test:unit` green; acceptance check in `lib/acceptance-adr0121-crdt-consensus.sh` (wired into `scripts/test-acceptance.sh`) green

## Risks

**Medium-high — CRDT semantics are non-trivial.** State-based merge functions are easy to state but easy to get subtly wrong (e.g., OR-Set tombstones not propagated, LWW tiebreaker not deterministic across nodes with skewed clocks, G-Counter not actually monotonic if a node's local count is reset on restart). The mathematical-property tests (idempotence, commutativity, associativity) are the safety net — if any of them fails, the primitive is broken regardless of how plausible the code looks.

**ADR escalation criterion** (per ADR-0118 §T3): if the CRDT algebra choice — state-based vs. operation-based, or the specific lattice types beyond the three listed — becomes load-bearing during implementation, this ADR should be promoted to a separate design-decision ADR before implementation begins. Default position is the three primitives listed above; this ADR commits only to that surface. Examples that would trigger escalation:

- Need for delta-CRDTs (only ship state diffs, not full state) because full-state submissions measurably bloat the `hive-mind_consensus` proposal payload
- Need for causal CRDTs (e.g., RGA for ordered sequences) because a downstream feature (session replay, ordered worker outputs) requires sequence semantics
- Discovery that the proposed voter-snapshot model on the proposal record doesn't actually fit a CvRDT shape and an op-based protocol is required

If none of those surface, this ADR stands as the implementation contract.

**Secondary risks**:

1. **LWW tiebreaker determinism**: timestamps from `Date.now()` collide under fast-loop tests; the tiebreaker must use `(timestamp, voterId)` lexicographically with `voterId` as the secondary key, and the test must include collision cases.
2. **OR-Set tombstone leakage**: removed elements still occupy memory until garbage collection; for the consensus-vote use case the proposal is short-lived so this is acceptable, but worth annotating in the code.
3. **Cross-Tn enum extension collision**: T1 (Weighted), T2 (Gossip), and T3 (CRDT) all extend `ConsensusStrategy`. If two land in parallel they will conflict-merge on the same line. Per ADR-0118 §Open-questions item 2, batch in dependency order; T3 is independent so it can land first or last.

## References

- Task definition: ADR-0118 task index row T3 (ADR-0118 has no narrative §T3 — the row defines the surface; this ADR fills in the steps)
- Verification matrix: ADR-0116 §USERGUIDE-vs-implementation verification matrix, "5 protocols" row
- Architectural constraints: ADR-0114 (CRDT primitives sit in the protocol layer; the `hive-mind_consensus` MCP tool is the execution-layer surface that drives them; the proposal record is the merge accumulator)
- MCP namespace: ADR-0117 (marketplace MCP-server registration — supplies the `mcp__ruflo__*` prefix that the agent file's `allowed-tools` resolves through)
- Fork-fix mandate: `feedback-patches-in-fork.md`
- Test discipline: `feedback-no-fallbacks.md` (mathematical-property tests must fail loudly, not silently fall back to a non-CRDT tally; unknown-strategy `default` branch must throw, not return a majority threshold)
- CLI invocation discipline: `reference-cli-cmd-helper.md` (parallel acceptance checks use `$(_cli_cmd)`, never raw `npx @latest`)

## Implementation log

(To be filled in as the task lands. Reference commit hash and the corresponding ADR-0118 §Status row update.)

- [ ] Step 1: TS-type extension (`hive-mind-tools.ts:46`) + MCP-schema extension (`:575`) + tool-description (`:564`) + `default`-branch throw at line 102
- [ ] Step 2: `crdt-types.ts` with three primitives + merge functions; `voterId` required on `LWWRegister.write`
- [ ] Step 3: `tryResolveProposal` (`:134`) `crdt` branch using LWW-Register for verdict + OR-Set for voter union; `ConsensusProposal` (`:49`) extended with `crdtState`
- [ ] Step 4: agent wiring — add `allowed-tools: mcp__ruflo__hive-mind_consensus` frontmatter to `forks/ruflo/v3/@claude-flow/cli/.claude/agents/consensus/crdt-synchronizer.md` AND `forks/ruflo/v3/@claude-flow/mcp/.claude/agents/consensus/crdt-synchronizer.md`; integration test exercises the path
- [ ] Step 5: mathematical-property tests + randomised-interleaving fuzzer + acceptance check
- [ ] ADR-0118 §Status table T3 row flipped to `complete`; plugin README annotation lifts on next P1 materialise run

## Review notes

Triage results from `/docs/adr/ADR-0118-review-notes-triage.md`. DEFER-TO-IMPL items remain open questions; resolved items are stamped inline.

1. **Round termination rule** — §Pseudocode says the round closes when "all expected voter snapshots are observed (or quorum-equivalent termination — defined by the calling code, not the CRDT layer)". The existing strategies use vote-count thresholds; the CRDT branch will need an explicit termination policy (all-voters? timeout-based? Queen-signalled?) that is NOT a CRDT concern but IS a `hive-mind_consensus` runtime concern. Default proposal: round closes when `state.workers.length` distinct voters have submitted, OR after the same `timeoutMs` window the Raft strategy already uses. (triage row 10 — DEFER-TO-IMPL: union of voter-count + timeoutMs window default; implementer documents in §Specification)
2. **`crdtState` serialisation** — the proposal record persists to `state.json` (substrate-layer SQLite). `Set`-typed fields in OR-Set don't survive `JSON.stringify` losslessly. Implementation must serialise to arrays and rehydrate to `Set` at load time (existing `loadHiveState` round-trips through JSON — this is a real gap, not just a typing issue). (triage row 11 — DEFER-TO-IMPL: serialise to arrays, rehydrate to Set at load time per implementer)
3. **Same-voter writing twice in one round** — the §Tiebreaker contract section says the second write loses on `(ts, voterId)` collision; what the §Spec doesn't say is whether the runtime should REJECT a second write from the same voter at the API level, or accept-and-let-LWW-resolve. Default: accept (LWW handles it; rejecting would force callers to dedupe, which contradicts the "merge is its own reconciliation" property). Surface this in tests. (triage row 12 — DEFER-TO-IMPL: accept-and-let-LWW-resolve default)
4. **`approvers: ORSet<voterId>` vs. `votes: GCounter`** — these are two different reads of the same data ("who approved" and "how many approvals"). For a pure approval round `votes.value() === approvers.elements().size` always, so the GCounter is technically redundant. — resolved (triage row 13: kept for future T1 weighted-vote variant; revisit if T1 lands first)
5. **`hive-mind_consensus` `vote` action signature** — currently takes a boolean `vote`. The `'crdt'` branch needs to accept the snapshot triple. Implementation must decide whether to overload `vote` (heterogeneous payload by strategy, type-discriminated) or add a sibling `submit` action. Default: overload `vote` with an optional `crdtSnapshot` field; the boolean `vote` becomes implicit (`true` when `crdtSnapshot.approvers` contains the voter, else `false`). (triage row 14 — DEFER-TO-IMPL: overload `vote` with optional `crdtSnapshot` field)
6. **Raft term collision with gossip** — review surfaced concern that `term`-pinning logic could leak into the CRDT branch. — resolved (triage row 9: term-pinning at hive-mind-tools.ts:595/597/620 gated on raft literal; gossip skips block; no collision)
