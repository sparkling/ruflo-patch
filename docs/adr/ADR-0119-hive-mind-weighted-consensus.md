# ADR-0119: Hive-mind weighted consensus (Queen 3x voting power)

- **Status**: **Implemented (2026-05-03)** per ADR-0118 §Status (T1 complete; fork ca9e29e2c + ruflo-patch 74f29e7). In-handler dispatch at `hive-mind-tools.ts:241` (enum) + `:78-104, 134-163` (vote tally).
- **Date**: 2026-05-02
- **Deciders**: Henrik Pettersen
- **Depends on**: ADR-0116 (hive-mind marketplace plugin — owns the verification matrix that flagged this gap), ADR-0118 (runtime gaps tracker — defines this as task T1)
- **Related**: ADR-0114 (substrate/protocol/execution layering — weighted is a protocol-layer addition), ADR-0104 (queen orchestration — owns single-queen invariant the tally relies on)
- **Scope**: Fork-side runtime work in `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts` and the matching deep-test file. Closes ADR-0118 task T1 only; T2-T10 are separate.

## Context

ADR-0116's USERGUIDE-vs-implementation verification matrix surfaced a partial gap on the **3 voting modes** row. The USERGUIDE block headed `**Consensus Mechanisms:**` advertises a `Weighted` mode where the queen's vote carries 3x the weight of a worker's. The implementation supports only three of the four advertised modes:

```ts
// forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:46
type ConsensusStrategy = 'bft' | 'raft' | 'quorum';
```

The MCP tool `hive-mind_consensus` declares a matching `strategy` JSON-schema enum at `hive-mind-tools.ts:575` with the same three values. There is no `weighted` branch in `calculateRequiredVotes` (lines 78-104) and no per-voter weight in the vote-tally code path (`tryResolveProposal`, lines 134-163). The plugin docs that ship via ADR-0116 carry `implementation-status: partial` annotations on this row pending closure.

ADR-0118's T1 row sized this as the smallest, most-isolated runtime gap (low risk, no dependencies, single-file diff) and recommended it as the first task to land in the tracker.

## Decision Drivers

- **USERGUIDE contract** — the §Hive Mind block in `/Users/henrik/source/ruvnet/ruflo/docs/USERGUIDE.md` enumerates `Weighted (Queen 3x)` literally as one of three voting modes. The 3x ratio is the contract; we are not free to pick another constant.
- **Fork-side patching only** — per `feedback-patches-in-fork.md`, USERGUIDE-promised features that don't work are bugs and bugs are fixed in the fork (`forks/ruflo/`), never in the codemod or in upstream donate-backs.
- **No silent fallbacks (global scope)** — per `feedback-no-fallbacks.md`, applied across ALL existing strategies (`bft`/`raft`/`quorum`/`weighted`), not just the new `'weighted'` arm. The `default:` arm in `calculateRequiredVotes` (line 101-102) currently silently returns majority; this ADR replaces it with a synchronous throw. Expands T1 scope by ~3 lines (the throw statement plus matching test) but is contained to the same single-file diff. Also covers wire-boundary rejection for unknown enum values.
- **ADR-0118 T1 escalation rule** — promote to a follow-up design ADR only if per-proposal weighting becomes contested (validation surface, propose-time authorization, persistence). Constant 3x stays inside this ADR.
- **`QUEEN_WEIGHT = 3` is USERGUIDE canon** — the 3x ratio is fixed by the USERGUIDE contract; rationale derivation is not in scope here. If `QUEEN_WEIGHT` ever needs retuning, write the derivation paragraph at that time.
- **Single-queen invariant from ADR-0104** — the tally branch identifies the queen by `state.queen?.agentId`. ADR-0104 owns single-queen enforcement; weighted consensus assumes that invariant rather than re-checking it.
- **ADR-0114 layering** — weighted is a protocol-layer addition; substrate (state file, AgentDB) and execution (queen process spawn) are unaffected.
- **`bft` ↔ `byzantine` strategy alias** — USERGUIDE uses "Byzantine" terminology; runtime enum uses `'bft'`. Carry-forward from ADR-0106 R1 (per ADR-0118 review-notes-triage carry-forward analysis 2026-05-02). T1's PR is the natural place to fix it since T1 already extends the `ConsensusStrategy` enum and the `_consensus` JSON-schema enum. Alias is normalized at the MCP wire boundary; runtime sees only `'bft'`.

## Considered Options

- **Option A — Fixed 3x queen weight** [CHOSEN]. `queenWeight` is a constant inside `calculateRequiredVotes`, defaulted to 3, no caller-side override.
- **Option B — Per-proposal configurable weights**. `hive-mind_consensus` accepts a `queenWeight: number` argument; `ConsensusProposal` persists the chosen weight; tally reads from the proposal.
- **Option C — Role-based weight matrix from a config table**. A `consensusWeights: Record<HiveMemberRole, number>` map (queen, scout, coder, …) loaded from hive config; tally looks up each voter's role and multiplies accordingly.

## Pros and Cons of the Options

**Option A — Fixed 3x**
- Pros: matches the USERGUIDE substring (`Queen 3x`) literally; single-file diff; zero new validation surface; `calculateRequiredVotes` signature stays backward-compatible via a defaulted parameter.
- Cons: `queenWeight = 3` is a hardcoded constant — re-tuning (e.g. to 2x or 5x) requires a source change and a fork republish, not a config knob. The tally branch needs to look up `state.queen?.agentId` at vote time, which couples consensus tally to hive-state queen identity (currently the tally is queen-agnostic). And the contract is "what USERGUIDE says" rather than a derivation from BFT/Raft/quorum theory — if a future security review wants a derived weight, that's a follow-up ADR.

**Option B — Per-proposal configurable**
- Pros: flexible — supports asymmetric proposals (e.g. security-critical proposals with higher queen weight); avoids the rebuild-to-re-tune problem of Option A; surfaces the weight in the audit trail (each proposal records what weighting it used).
- Cons: introduces propose-time authorization (who is allowed to set the weight?), input validation (clamp range, integer-only, reject negatives), persistence-shape change, and a tampering surface (stored weight could be mutated between propose and tally without an integrity check). Exceeds mechanical implementation per the ADR-0118 T1 escalation rule.

**Option C — Role-based matrix**
- Pros: extends naturally to weighted worker types (T8 may want this); centralises weighting in hive config rather than scattering constants across the codebase; one place to audit if security review questions the weights.
- Cons: requires a hive-config schema change, config-validation tests, and migration for existing hive state files; couples T1 to T7/T8 work that the ADR-0118 dependency graph keeps independent.

## Decision Outcome

Chosen option: **Option A (fixed 3x queen weight)**, because the USERGUIDE driver pins the ratio to 3x literally (so "flexibility" buys nothing the contract can use), the no-new-validation-surface driver excludes Option B's authorization/clamping/persistence work, and the ADR-0118 T1 escalation rule explicitly defers configurable weighting to a follow-up ADR. Options B and C remain viable as follow-up ADRs once a real use case emerges that justifies the validation/migration surface.

**Queen-absent stance: throw, not permissive math.** When `'weighted'` strategy is invoked but `state.queen === undefined` at propose- or vote-time, the handler throws `MissingQueenForWeightedConsensusError` synchronously. Rationale: queen is process-bound (per ADR-0104); `state.queen === undefined` during a weighted round indicates a bug in the caller (init race, dangling shutdown, or queen nulled by an upstream error path). Surface loudly per the `feedback-no-fallbacks.md` spirit rather than degrading silently to a permissive denominator.

## Consequences

**Positive**
- USERGUIDE contract closed for the `Weighted` voting mode; ADR-0116 plugin README drops the `partial` annotation on next P1 materialise run.
- Backward-compatible: existing `bft`/`raft`/`quorum` callers compile unchanged; `queenWeight` is an optional defaulted parameter on `calculateRequiredVotes`.
- Single-file change footprint matches the ADR-0118 T1 sizing; no Tn dependencies disturbed.

**Negative**
- `queenWeight = 3` is a hardcoded constant — re-tuning requires editing source and republishing the fork, not a config change. If we later want 2x or 5x or any derived value, that's a follow-up ADR (see §Risks).
- Tally branch introduces a coupling between consensus and hive-state queen identity: the queen is identified by `state.queen?.agentId` at tally time. Previously the tally was queen-agnostic.
- Weighted strategy unusable until a queen is elected — explicit precondition. Callers must ensure `state.queen` is populated before invoking `hive-mind_consensus` with `strategy: 'weighted'`; otherwise `MissingQueenForWeightedConsensusError` is thrown.
- `tryResolveProposal`'s deadlock check (current line 154-160) sums raw vote counts, not weighted; the `'weighted'` branch must replace that arithmetic or risk false-deadlock rejections.
- Adds one more case to `calculateRequiredVotes`; future `gossip` (T2) and `crdt` (T3) extensions share this branch structure.

## Validation

Per `feedback-all-test-levels`, all three pyramid levels are mandatory and ship in the same commit:

- **Unit** — `tests/unit/hive-mind-weighted-consensus.test.mjs` (London-school, mocked I/O): covers `ConsensusStrategy` extension, `calculateRequiredVotes('weighted', N, _, 3)` math, tally multiplier, queen-elected-but-abstaining behaviour, the unknown-strategy throw, and the missing-queen throw on `'weighted'`. Plus backward-compat denominators for `bft`/`raft`/`quorum`. Mirrors the cases in §Implementation plan step 9.
- **Integration** — also `tests/unit/*.test.mjs` per CLAUDE.md pyramid (real I/O): drive `hive-mind_consensus` end-to-end through `propose → vote → tally`, with `loadHiveState`/`saveHiveState` writing to a tempdir, asserting on-disk proposal state and outcome through the resolution path.
- **Acceptance** — `check_hive_mind_weighted_consensus` in `lib/acceptance-hive-mind-checks.sh`, wired into `scripts/test-acceptance.sh`. Round-trips a `hive-mind_consensus` invocation with `strategy: 'weighted'` against a fresh `init --full` project's published `@sparkleideas/cli`; asserts the returned outcome matches the queen-decisive scenario. Uses `_cli_cmd` per `reference-cli-cmd-helper.md`.

ADR-0118 status table flips T1 to `complete` only after all three levels are green; ADR-0116 annotation lift is blocked until then per `feedback-no-fallbacks.md`.

## Implementation plan

Lifted from ADR-0118's T1 row plus the verified file structure. Single file (`hive-mind-tools.ts`) plus matching test file; no new product files.

1. **Extend the type alias.** `hive-mind-tools.ts:46` — add `'weighted'` to the `ConsensusStrategy` union.
2. **Extend the MCP tool JSON-schema enum.** `hive-mind-tools.ts:575` — add `'weighted'` to the `hive-mind_consensus` tool's `strategy` enum so the value is accepted at the wire boundary.
3. **Add a `queenWeight` module constant.** `const QUEEN_WEIGHT = 3;` near the top of the file (next to the type definitions). Not stored on `ConsensusProposal` — the tally derives queen identity from `state.queen?.agentId` at vote time, so per-voter weight does not need to persist on the proposal.
4. **Add the `weighted` case in `calculateRequiredVotes`** (lines 78-104). Signature becomes `calculateRequiredVotes(strategy, totalNodes, quorumPreset, queenWeight = QUEEN_WEIGHT)`. The `'weighted'` branch returns `(totalWorkers * 1) + queenWeight` where `totalWorkers = max(0, totalNodes - 1)` (queen counted as one node).
5. **Replace the `default:` arm with a throw.** Same function, lines 101-102. Replace `return Math.floor(totalNodes / 2) + 1;` with `throw new Error(\`Unknown consensus strategy: ${strategy}\`);` per `feedback-no-fallbacks.md` (global scope — covers all four strategies, including future typos and not-yet-implemented values). ~3 lines including the import-or-not decision; matches the scope expansion called out in §Decision Drivers.
6. **Add `state.queen` precondition to `propose` and `vote`.** Where `strategy === 'weighted'` is dispatched, throw a named error `MissingQueenForWeightedConsensusError` synchronously if `state.queen === undefined`. Both propose-time and vote-time enforcement; do not defer the check to tally.
7. **Update `tryResolveProposal`** (lines 134-163). When `proposal.strategy === 'weighted'`, compute `votesFor`/`votesAgainst` as weighted sums (queen vote contributes `queenWeight`, worker votes contribute 1). The deadlock-detection check at lines 154-160 must use the same weighted arithmetic — comparing weighted `votesFor + remaining_weighted` against the weighted `required` — or it will mark legitimate live proposals as deadlocked. `remaining_weighted` accounts for which uncast voters are queen vs worker.
8. **Update `vote` action's tally counters** (lines 740-741). When strategy is `'weighted'`, the `votesFor`/`votesAgainst` reported back to the caller in the `vote` response are the weighted counts (matching what `tryResolveProposal` consumed), not the raw count of true/false vote entries.
9. **Update `_consensus` JSON schema `strategy` enum at `hive-mind-tools.ts:575`** to accept both `'bft'` and `'byzantine'`. Add normalization at handler entry: `if (input.strategy === 'byzantine') input.strategy = 'bft'`. Type union stays `'bft' | 'raft' | 'quorum' | 'weighted'` post-normalization. Carry-forward from ADR-0106 R1 per the ADR-0118 review-notes-triage analysis on 2026-05-02.
10. **Tests.** Add to `forks/ruflo/v3/@claude-flow/cli/__tests__/mcp-tools-deep.test.ts`:
   - **Queen-decisive**: queen votes yes, simple worker majority votes no; worker-only count would fail quorum, but queen's 3x vote carries the proposal — assert resolution is `approved`.
   - **Queen-overruled-by-supermajority**: queen votes no, enough workers vote yes that worker count alone exceeds queen's 3x weight — assert resolution is `approved`.
   - **Denominator math**: assert `calculateRequiredVotes('weighted', N, _, 3)` returns `(N - 1) + 3` for `N` total nodes (queen is one node; `totalWorkers = N - 1`); assert the `N <= 0` and `N === 1` (queen-only) edges return sane values.
   - **Queen-absent (elected but didn't vote)**: queen present in `state.queen` but no vote cast; workers vote; with denominator `(N - 1) + 3`, assert resolution is `rejected` when worker yes-count alone falls below the weighted threshold (and `approved` when it clears it).
   - **Unknown strategy throws**: `calculateRequiredVotes('typo' as any, N)` throws synchronously; the thrown error names the offending value.
   - **Weighted with no queen elected throws**: invoking `propose` (and `vote`) with `strategy: 'weighted'` while `state.queen === undefined` throws `MissingQueenForWeightedConsensusError`. Covers init-race and post-abdication scenarios.
   - **Backward-compat**: assert `bft`, `raft`, `quorum` produce the same denominators and resolutions after the signature extension as before.

Per ADR-0118's test-first delivery rule, all tests ship in the same commit as the implementation; the ADR-0116 plugin README annotation lifts only after CI is green.

## Specification

**`ConsensusStrategy` enum surface** (`forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:46`):

```ts
type ConsensusStrategy = 'bft' | 'raft' | 'quorum' | 'weighted';
```

**`hive-mind_consensus` MCP tool surface** (`forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:575`): the `strategy` JSON-schema enum accepts `'weighted'` at the JSON-RPC boundary; all other tool-input fields unchanged.

**`ConsensusProposal` shape**: unchanged. The `votes: Record<voterId, boolean>` field already records who voted what; queen identity is recovered at tally time from `state.queen?.agentId`. No new persisted field — `queenWeight` is a module constant, not a per-proposal value.

**Invariants**
- `'byzantine'` is accepted as a synonym for `'bft'` at the MCP tool boundary. Internally the strategy is normalized to `'bft'` before dispatch. The `ConsensusStrategy` type union remains `'bft' | 'raft' | 'quorum' | 'weighted'` post-T1; the alias is purely an input normalization. Carry-forward from ADR-0106 R1 per the ADR-0118 review-notes-triage analysis on 2026-05-02.
- `QUEEN_WEIGHT` is a module-private constant (`= 3`), exposed as an optional defaulted parameter on `calculateRequiredVotes` for testability; not configurable via MCP tool input.
- Denominator formula when `strategy === 'weighted'`: `requiredVotes = totalWorkers + queenWeight`, where `totalWorkers = max(0, totalNodes - 1)` and `totalNodes = state.workers.length || 1` (matches existing handler convention at line 586).
- Worker votes count as `1`; the vote belonging to `state.queen.agentId` counts as `queenWeight`. No other multipliers exist.
- `bft`/`raft`/`quorum` denominators are unchanged after the signature extension.
- Unknown `strategy` value passed to `calculateRequiredVotes` throws synchronously; no silent default. Replaces the current majority fallback at line 101-102.
- Weighted consensus requires `state.queen` to be defined at propose- and vote-time; both handlers throw `MissingQueenForWeightedConsensusError` if `state.queen === undefined` and `strategy === 'weighted'`.

**Post-condition of the `vote` handler when `strategy === 'weighted'` and resolution fires**: `proposal.status` is `'approved'` iff weighted-`votesFor >= calculateRequiredVotes('weighted', totalNodes, _, QUEEN_WEIGHT)`; `'rejected'` iff weighted-`votesAgainst >= required` or the weighted deadlock check fires (neither side can reach `required` with remaining uncast votes); else stays `'pending'`. The proposal is removed from `state.consensus.pending` and appended to `state.consensus.history` exactly when status flips out of `'pending'`, identical to existing behaviour.

## Pseudocode

Plain prose; actual TypeScript lands in the implementing commit. `QUEEN_WEIGHT = 3` and `queenId = state.queen?.agentId` are looked up from module/handler scope.

```
on _consensus(input):                                  // MCP tool handler entry
    if input.strategy === 'byzantine':
        input.strategy = 'bft'                          // alias normalization at wire boundary
        // carry-forward from ADR-0106 R1; see ADR-0118 review-notes-triage 2026-05-02
    // ... dispatch to propose / vote / etc. with normalized strategy

on calculateRequiredVotes(strategy, totalNodes, quorumPreset, queenWeight = QUEEN_WEIGHT):
    if totalNodes <= 0: return 1                        // existing guard at line 83
    when strategy is 'bft':       return floor(2 * totalNodes / 3) + 1
    when strategy is 'raft':      return floor(totalNodes / 2) + 1
    when strategy is 'quorum':    return preset-driven (unanimous | majority | supermajority)
    when strategy is 'weighted':
        totalWorkers = max(0, totalNodes - 1)
        return totalWorkers + queenWeight                // effective electorate denominator
    default:                                              // unknown strategy
        throw Error("Unknown consensus strategy: " + strategy)
        // per feedback-no-fallbacks (global scope); replaces current line 101-102
        // majority fallback. Applies to ANY unknown value, not just typo'd 'weighted'.

on propose(strategy, ...):
    if strategy === 'weighted' AND state.queen is undefined:
        throw MissingQueenForWeightedConsensusError
    // ... existing propose body

on vote(proposalId, voterId, vote):
    proposal = state.consensus.pending[proposalId]
    if proposal.strategy === 'weighted' AND state.queen is undefined:
        throw MissingQueenForWeightedConsensusError
    // ... existing vote body, then tryResolveProposal

on weightedTally(proposal, totalNodes):
    // precondition (asserted in propose/vote): state.queen is defined
    queenId = state.queen.agentId
    weightedFor = 0; weightedAgainst = 0
    for each (voterId, vote) in proposal.votes:
        contribution = (voterId === queenId) ? QUEEN_WEIGHT : 1
        if vote: weightedFor += contribution
        else:    weightedAgainst += contribution
    required = calculateRequiredVotes('weighted', totalNodes, _, QUEEN_WEIGHT)

    if weightedFor >= required:    return 'approved'
    if weightedAgainst >= required: return 'rejected'

    // deadlock: weight remaining uncast voters by their role
    castVoters = keys(proposal.votes)
    queenStillUncast = (queenId not in castVoters)
    workerSlotsRemaining = max(0, (totalNodes - 1) - count(castVoters where v !== queenId))
    weightedRemaining = workerSlotsRemaining + (queenStillUncast ? QUEEN_WEIGHT : 0)
    if weightedFor + weightedRemaining < required AND
       weightedAgainst + weightedRemaining < required:
        return 'rejected'                                // deadlock
    return null                                          // still pending
```

When `'weighted'` is invoked and `state.queen === undefined`, the handler throws `MissingQueenForWeightedConsensusError` synchronously at propose- or vote-time. The tally itself never runs in that state; `weightedTally` may treat queen-defined as a precondition.

## Architecture

**Touched files**
- `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:46` — `ConsensusStrategy` union extension
- `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:575` — `hive-mind_consensus` tool's `strategy` JSON-schema enum extension (also accepts `'byzantine'` as an alias for `'bft'`; normalized at handler entry, runtime type union unchanged)
- `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:78-104` — new `'weighted'` case in `calculateRequiredVotes` plus signature extension
- `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:134-163` — `tryResolveProposal` weighted arithmetic for tally + deadlock check
- `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:740-741` — `vote` handler's reported `votesFor`/`votesAgainst` use weighted counts when applicable
- `forks/ruflo/v3/@claude-flow/cli/__tests__/mcp-tools-deep.test.ts` — new test cases (per §Implementation plan step 9)
- `lib/acceptance-hive-mind-checks.sh` — new `check_hive_mind_weighted_consensus` wired into `scripts/test-acceptance.sh`
- `tests/unit/hive-mind-weighted-consensus.test.mjs` — new unit file (covers unit + integration tier per CLAUDE.md pyramid)

**Data flow**
1. Caller invokes the `hive-mind_consensus` MCP tool with `strategy: 'weighted'` and a proposal payload.
2. JSON-schema validation at the wire boundary (`hive-mind-tools.ts:575`) accepts `'weighted'`; also accepts `'byzantine'` and normalizes it to `'bft'` at handler entry per the ADR-0106 R1 carry-forward; rejects unknown values per `feedback-no-fallbacks.md`.
3. The handler loads `state` via `loadHiveState`, computes `totalNodes = state.workers.length || 1`, and constructs a `ConsensusProposal` with the existing shape (no `weightedVoter[]` field).
4. `calculateRequiredVotes('weighted', totalNodes, _, QUEEN_WEIGHT)` returns the denominator `(max(0, totalNodes - 1)) + QUEEN_WEIGHT`.
5. Workers and queen call `vote`; the tally derives queen identity from `state.queen?.agentId` and contributes `QUEEN_WEIGHT` for that voter's recorded vote, 1 for everyone else.
6. Resolution (`approved`/`rejected`) returned to caller and appended to `state.consensus.history` via the existing `saveHiveState` path (no substrate change).

## Refinement

**Edge cases**
- **Queen elected but didn't vote**: tally treats the missing queen vote as abstention; denominator stays `(totalWorkers + QUEEN_WEIGHT)`, so a unanimous worker yes can still fall short of the threshold. Test asserts the queen-elected-but-silent denominator is `(N - 1) + 3` and that a worker-yes count below that returns `'rejected'` while a count >= it returns `'approved'`. (Distinct from "no queen elected" below — `state.queen` is populated; the queen's `agentId` simply isn't a key in `proposal.votes` yet.)
- **No queen elected at all (`state.queen === undefined`)**: the handler throws `MissingQueenForWeightedConsensusError` synchronously at propose- and vote-time. No tally is attempted; no permissive denominator math runs. Per the §Decision Outcome rationale, this surfaces caller bugs (init race, dangling shutdown, queen nulled by error) loudly rather than degrading silently.
- **Weighted call after queen abdication or before queen elected**: same throw path. If a weighted proposal is in flight when `state.queen` becomes undefined (abdication, shutdown), subsequent `vote` calls throw; the proposal stays `pending` and must be cleaned up by the caller (out of scope for T1; ADR-0104 owns queen-handover semantics).
- **Queen leaves the hive between propose and tally with a successor seated**: votes already cast under the old queen's `agentId` keep their weight on replay (the `voterId` literal is what matches `state.queen.agentId`, not a role tag). If the queen role transfers to a new agent before tally, the new queen's votes get the multiplier and the old queen's already-cast vote keeps its multiplier — a transient double-weighted period exists during transition. Documented as a known limitation; ADR-0104 owns queen-handover semantics.
- **Multi-queen tally**: out of scope. Hive-mind invariants assume exactly one queen (per ADR-0104). The tally multiplies whichever single `voterId` matches `state.queen.agentId` at lookup time — there is no role tag in `votes`, so multi-queen state corruption cannot multiply two voters by accident under the chosen design.
- **`queenWeight = 0`**: the `hive-mind_consensus` MCP tool does not accept a caller-supplied `queenWeight`, so reachable only via direct `calculateRequiredVotes(_, _, _, 0)` calls in tests. Behaviour collapses to plain majority over workers — documented as a test-only path.
- **Tie at threshold**: `'approved'` requires `weightedFor >= required` (not strictly greater); a tie at threshold approves. Mirrors the existing `bft`/`raft`/`quorum` resolution semantics at lines 146-147.
- **Unknown strategy passed to `calculateRequiredVotes`** (e.g., typo, future strategy not yet wired into the enum): throws synchronously per §Specification invariant. No silent majority fallback. Covers both direct calls and the defensive case where a future enum extension adds a name but forgets the dispatch arm.
- **Caller passes both `'byzantine'` and `'bft'` in the same proposal lifecycle** (e.g., propose with `'byzantine'`, vote with `'bft'`): both are accepted at the MCP wire boundary; both normalize to `'bft'` at handler entry; the same `proposalId` resolves correctly because `proposal.strategy` is stored post-normalization. Mixed casing (`'Byzantine'`, `'BFT'`) is not accepted — the JSON-schema enum is exact-match.

**Error paths**
- **Unknown strategy at the wire**: rejected by the MCP tool's JSON-schema enum at line 575; no fallback to `'quorum'`. The internal `default:` branch in `calculateRequiredVotes` (line 101-102) throws `Error("Unknown consensus strategy: ${strategy}")` synchronously, applied across all four strategies (`bft`/`raft`/`quorum`/`weighted`) per `feedback-no-fallbacks.md`.
- **`state.queen` undefined when strategy is `'weighted'`**: handler throws `MissingQueenForWeightedConsensusError` at propose- and vote-time. No tally runs; the proposal is not appended to `state.consensus.history`. Caller is responsible for ensuring queen election before invoking weighted consensus.

**Test list**
- Unit (`tests/unit/hive-mind-weighted-consensus.test.mjs`):
  - `enum extension` — `ConsensusStrategy` accepts `'weighted'`; tool JSON-schema accepts `'weighted'`.
  - `calculateRequiredVotes math` — `('weighted', N, _, 3)` returns `(max(0, N - 1)) + 3`; backward-compat for `bft`/`raft`/`quorum`.
  - `tally multiplier` — voter matching `state.queen.agentId` contributes `QUEEN_WEIGHT`; other voters contribute 1.
  - `queen-decisive`, `queen-overruled-by-supermajority`, and `queen-elected-but-abstaining` from §Implementation plan step 9.
  - `weighted deadlock detection` — when remaining uncast queen+worker weight cannot tip either side past `required`, resolution is `'rejected'`.
  - `unknown strategy throws` — `calculateRequiredVotes('typo' as any, ...)` throws synchronously.
  - `missing queen throws on weighted` — `propose`/`vote` with `strategy: 'weighted'` and `state.queen === undefined` throws `MissingQueenForWeightedConsensusError`.
  - `t1_bft_byzantine_alias_normalizes` — `_consensus({strategy: 'byzantine'})` and `_consensus({strategy: 'bft'})` produce equivalent proposals (same stored `proposal.strategy === 'bft'`, same denominator, same resolution path); mixed-lifecycle invocation (propose with `'byzantine'`, vote with `'bft'`) resolves correctly under the same `proposalId`.
- Integration (same file, real I/O): drive `propose → vote → tally` through `loadHiveState`/`saveHiveState` against a tempdir; assert on-disk `state.consensus.history` row matches the resolution.
- Acceptance (`lib/acceptance-hive-mind-checks.sh::check_hive_mind_weighted_consensus`): round-trip via `init --full` project + published `@sparkleideas/cli`; calls `hive-mind_consensus` with `strategy: 'weighted'`; asserts outcome matches expected. Uses `_cli_cmd` per `reference-cli-cmd-helper.md`.
- Acceptance (`lib/acceptance-hive-mind-checks.sh::acc_t1_bft_byzantine_alias_accepted`): round-trip via `init --full` project + published `@sparkleideas/cli`; calls `hive-mind_consensus` with `strategy: 'byzantine'`; asserts the proposal is accepted at the wire boundary, stored with `proposal.strategy === 'bft'`, and resolves identically to a `'bft'` invocation. Uses `_cli_cmd` per `reference-cli-cmd-helper.md`.

## Completion

T1 marked `complete` in ADR-0118 §Status, with Owner/Commit columns naming a green-CI commit. Annotation lift fires on the next materialise run after that flip. (Per ADR-0118 §Annotation lifecycle.)

**Wire-up**
- New acceptance check `check_hive_mind_weighted_consensus` added to `lib/acceptance-hive-mind-checks.sh` and dispatched from `scripts/test-acceptance.sh` in the appropriate phase group.
- New test file `tests/unit/hive-mind-weighted-consensus.test.mjs` discovered automatically by the existing test runner (covers both unit and integration tier per the CLAUDE.md pyramid).

**ADR-0118 escalation reference**: per the T1 row, promote to a follow-up design ADR if per-proposal weighting becomes contested (validation, propose-time authorization, persistence). Until that lands, fixed 3x is the canonical behaviour and configurable weighting is out of scope.

## Acceptance criteria

- [ ] `hive-mind-tools.ts:46` — `ConsensusStrategy` includes `'weighted'`
- [ ] `hive-mind-tools.ts:575` — `hive-mind_consensus` tool's `strategy` enum accepts `'weighted'` at the JSON-RPC boundary
- [ ] `calculateRequiredVotes('weighted', N, _, 3)` returns `max(0, N - 1) + 3`; signature stays backward-compatible for `bft`, `raft`, `quorum`
- [ ] `calculateRequiredVotes` throws synchronously on any unknown strategy value (replaces majority fallback at line 101-102)
- [ ] Weighted-consensus call with `state.queen === undefined` throws `MissingQueenForWeightedConsensusError` at propose- and vote-time
- [ ] `tryResolveProposal` weighted branch uses weighted arithmetic for both the resolution check and the deadlock check (no raw-count regressions)
- [ ] Queen-decisive test passes: queen yes + worker minority yes carries when worker-only would fail
- [ ] Queen-overruled test passes: workers override the queen with a sufficient supermajority
- [ ] Queen-elected-but-abstaining test passes: denominator stays `(N - 1) + 3`; resolution is `rejected` when worker-yes alone falls short
- [ ] Backward-compat tests pass for `bft`/`raft`/`quorum` denominators and resolutions
- [ ] `byzantine` alias resolves to `bft` at the MCP boundary (carry-forward from ADR-0106 R1 per ADR-0118 review-notes-triage 2026-05-02): JSON-schema accepts `'byzantine'`; handler normalizes to `'bft'` before dispatch; `proposal.strategy` is stored as `'bft'`; `t1_bft_byzantine_alias_normalizes` and `acc_t1_bft_byzantine_alias_accepted` pass
- [ ] `npm run test:unit` green; `npm run test:acceptance` green
- [ ] ADR-0118 status table row T1 flips to `complete`; ADR-0116 plugin README "3 voting modes" row drops the `partial` annotation on the next P1 materialise run

## Risks

**Low — additive change, no breaking API.** The new `'weighted'` enum value is opt-in; existing `bft`/`raft`/`quorum` callers are unaffected. The `calculateRequiredVotes` signature gains an optional `queenWeight` parameter with a default of 3, so existing call sites compile unchanged.

**Promote scope expansion if queen weighting must be configurable per proposal** (currently constant 3x) — per ADR-0118's escalation criterion. Configurable weighting introduces validation, persistence, and security surface (who is allowed to set the weight at propose time?) that exceeds mechanical implementation. If a real use case lands, fold it into a follow-up ADR rather than retrofitting this one.

## References

- ADR-0106 — consensus algorithm enforcement (origin of the `bft` ↔ `byzantine` alias-mapping carry-forward, R1)
- ADR-0116 — verification matrix, "3 voting modes" row (gap source)
- ADR-0118 — runtime gaps tracker, T1 row (task index entry)
- ADR-0114 — substrate/protocol/execution layering (weighted lives at the protocol layer)
- ADR-0104 — queen orchestration (single-queen invariant the tally relies on)
- USERGUIDE Hive Mind contract — substring anchor `**Consensus Mechanisms:**` in `/Users/henrik/source/ruvnet/ruflo/docs/USERGUIDE.md`
- Implementation surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:46,78-104,134-163,575` and `forks/ruflo/v3/@claude-flow/cli/__tests__/mcp-tools-deep.test.ts`

## Review notes

Resolutions from triage (Q1-Q3 closed in this revision; Q4 confirmed in scope):

- **Q1 (default-case throw scope) — resolved.** Apply globally: replace the `default:` arm in `calculateRequiredVotes` with a synchronous throw covering all four strategies. Reflected in §Decision Drivers ("No silent fallbacks (global scope)"), §Specification invariants, §Pseudocode, §Implementation plan step 5, and §Acceptance criteria.
- **Q2 (policy on weighted with no queen) — resolved.** Throw `MissingQueenForWeightedConsensusError` at propose- and vote-time; do not run permissive math. Reflected in §Decision Outcome rationale, §Specification invariants, §Pseudocode (`propose`/`vote` precondition checks), §Refinement edge cases, §Refinement error paths, and §Acceptance criteria.
- **Q3 (`QUEEN_WEIGHT = 3` rationale) — resolved.** USERGUIDE is canon; rationale derivation is not in scope. If `QUEEN_WEIGHT` ever needs retuning, write the derivation paragraph at that time. Reflected as a §Decision Drivers bullet.
- **Q4 (deadlock-arithmetic scope) — resolved (in scope).** The deadlock arithmetic change is intrinsic to weighted tally: leaving it raw would mark legitimate live proposals as deadlocked once the queen's weight is in play. Single-file diff scope holds (still inside `hive-mind-tools.ts`); see §Architecture touched-files list and §Implementation plan step 7.
