# ADR-0131: Hive-mind worker-failure prompt protocol + auto-status-transitions in `_consensus` (T12)

- **Status**: Implemented (2026-05-03) per ADR-0118 §Status (T12 complete)
- **Date**: 2026-05-02
- **Deciders**: Henrik Pettersen
- **Depends on**: ADR-0103 (README claims investigation roadmap — ratified ADR-0109 Option E as the worker-failure design), ADR-0109 (worker-failure handling — Option E §6 is the prompt-side contract carried forward here), ADR-0118 (hive-mind runtime gaps tracker — owns this work as task T12)
- **Related**: ADR-0104 (queen orchestration — owns the §6 worker-coordination prompt template this ADR extends), ADR-0106 (consensus algorithm enforcement — owns the auto-status-transition surface in `_consensus`), ADR-0114 (substrate/protocol/execution layering — failure-protocol lives at protocol + execution layers), ADR-0119/ADR-0120/ADR-0121 (T1/T2/T3 consensus strategy extensions — auto-status-transition logic must stay correct across all strategies)
- **Scope**: Fork-side runtime work in `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts` (`_consensus` action + `_status` action surface) and `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts` (queen prompt template §6). Closes ADR-0118 task T12 only; T1-T11 remain separate.

## Context

ADR-0103's investigation roadmap row 92 ratified **ADR-0109 Option E** (hybrid: A worker-failure protocol in §6 prompt + B auto-status transitions in `_consensus` + D README reframing). That program landed Option D (the README + skill doc copy corrections) and structurally shipped Option B's auto-status precedent in ADR-0106, but the **prompt-side failure model (Option A) and the auto-status-transitions in `_consensus` for the modern consensus strategy surface (`weighted`/`gossip`/`crdt` once T1/T2/T3 land) had no Tn assignment** in ADR-0118's initial 11-task split. The comparison report 2026-05-02 surfaced this as the residual gap; the runtime-gaps tracker accepts T12 to close it.

Empirical state in the fork (verified against current `sparkling/main`):

| Surface | Path | Current behaviour |
|---|---|---|
| §6 worker-coordination prompt body | `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts:168-178` | Instructs workers to write `worker-<id>-result` keys; zero instructions for timeout, missing result key, retry, or mark-as-absent |
| `_consensus({action:'status'})` | `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:805-829` | Surfaces `timedOut` as a `hint` field for `raft` only; status stays `'pending'` forever; `bft` and `quorum` skip the timeout check entirely |
| `_consensus({action:'vote'})` tally path | `hive-mind-tools.ts:740-741` (vote) and `hive-mind-tools.ts:134-163` (`tryResolveProposal`) | Counts votes from `proposal.votes`; absent voters contribute neither for nor against; resolution can stall indefinitely |
| `_status` MCP tool surface | `hive-mind-tools.ts` `_status` action | Returns `state.workers[]` as flat IDs; no per-worker failure flag, no `failedAt`, no retry-lineage |
| `state.workers[]` shape | `loadHiveState`/`saveHiveState` (lines 180-201) | Flat array of IDs — no timestamps, no heartbeat, no per-worker status |

**Carried-forward design from ADR-0109 Option E §6** (verbatim contract this ADR materialises):

> After `Task` returns, immediately `_memory({action:'get', key:'worker-<id>-result'})`. If key missing OR Task returned error: write `worker-<id>-status: 'absent'`. Decide: retry-once (re-spawn via Task) OR proceed without this worker's result (record gap in final summary). Do not silently drop. Never wait indefinitely; 60s with no result → `'absent'`.

> [Auto-status-transitions in `_consensus`:] `_consensus({action:'status'})` checks `timedOut && totalVotes < required`. Transitions status to `'failed-quorum-not-reached'`. Records `absentVoters = state.workers.filter(w => !(w in proposal.votes))`. Emits to `state.consensus.history`. Applies to all strategies (bft, raft, quorum), not just raft.

ADR-0109 explicitly listed **"Reviving V2's `retryTask` lineage tracking (`retryOf` chains)"** as out-of-scope for Option E §6; T12 picks that limited carry-forward up because the §6 prompt protocol describes a retry decision but the runtime surface offers no way to record what was retried (so post-mortems and audit trails currently lose the parent-child relationship). T12 keeps lineage minimal — a single `retryOf: <originalWorkerId>` pointer per retried worker, not a chain depth or graph; it is the smallest data shape that supports the §6 prompt's "retry-once" instruction without elevating retry into its own subsystem.

ADR-0109 R8 (sub-queen failure in hierarchical-mesh topology) is **explicitly out-of-scope of T12**: T10 (ADR-0128) owns that surface. T12's flat retry-once-then-mark-absent policy is for direct-queen-spawned workers only.

## Decision Drivers

- **ADR-0103 ratified roadmap** — Option E was endorsed in row 92; T12 finishes the program. Not optional, not re-decidable.
- **ADR-0109 §6 verbatim contract** — the prompt-side failure block, the 60s threshold, retry-once policy, and `'absent'` status string are all literal contracts that downstream tests will assert on. They are not free for re-naming or re-tuning here.
- **`feedback-no-fallbacks.md` (global scope)** — the auto-status-transitions in `_consensus` must apply to **all** consensus strategies (current `bft`/`raft`/`quorum` and future `weighted`/`gossip`/`crdt` from T1/T2/T3). No silent fallback to "raft only" timeout handling. The default arm of the strategy switch in the timeout/transition code path throws synchronously on unknown values, mirroring ADR-0119's `default:` pattern.
- **`feedback-patches-in-fork.md`** — USERGUIDE-promised features that don't work are bugs; bugs are fixed in fork (`forks/ruflo/`), never in the codemod or in upstream donate-backs.
- **No new MCP tool surface unless A+B prove insufficient** — ADR-0109 Option C (separate `hive-mind_worker-status` MCP tool) was deferred. T12 honours that deferral and extends the existing `_status` action's response shape rather than introducing a new tool.
- **Cross-strategy correctness over strategy-specific shortcuts** — auto-status-transitions are invoked by the `_consensus({action:'status'})` handler, which is strategy-agnostic at the dispatch boundary. The transition logic reads `proposal.strategy` to compute the per-strategy quorum threshold (delegating to `calculateRequiredVotes`, which T1/T2/T3 will have already extended), so adding a new strategy in a sibling Tn does not require T12 changes.
- **ADR-0118 T12 escalation rule** — promote to a follow-up design ADR if any of (a) retry-lineage grows beyond a single `retryOf` pointer (chains, trees, retry-counter graphs); (b) per-worker heartbeat/checkpoint protocol is needed (ADR-0109 R4 deferred this); (c) whole-hive abort policy is needed when failure rate exceeds a threshold (ADR-0109 R2 deferred this). T12 stays inside the mechanical implementation of §6 + auto-status.
- **ADR-0114 layering** — the §6 prompt edit lives at the execution layer (queen-process spawn output); the `_consensus` auto-transition + `_status` shape extension live at the protocol layer; substrate (state file, AgentDB) is unaffected. Lineage is one new field on the worker record in `state.workers`, additive only.
- **Worker-rejoin-after-marked-failed is a bug, not a feature** — once a worker is marked failed, its slot is `'absent'` for tally purposes for the lifetime of the current consensus round. If a late `vote` MCP call arrives, it is rejected with a named error; consistency over best-effort rescue.
- **Strategy-dependence acknowledged** — the auto-transition predicate `timedOut && totalVotes < required` is well-defined for `bft`/`raft`/`quorum` today and for `weighted`/`gossip`/`crdt` once T1/T2/T3 land. T12 ships its acceptance check **without** weighted/gossip/crdt cases initially; those cases are added in a follow-up commit once each Tn lands. Documented as a dependency, not a blocker (see §Risks).

## Considered Options

- **Option (a) — Auto-status-transitions in `_consensus` + minimal lineage tracking + §6 prompt protocol** *[CHOSEN]*. Materialises ADR-0109 Option E §6 literally: the queen prompt's §6 worker-coordination block gains a WORKER FAILURE PROTOCOL subsection; `_consensus({action:'status'})` auto-transitions `'pending'` → `'failed-quorum-not-reached'` when `timedOut && totalVotes < required`, populates `absentVoters`, moves the proposal from `state.consensus.pending` to `state.consensus.history`. `_status` action surfaces a `failedWorkers` summary derived from the new per-worker `failedAt`/`retryOf` fields. Single `retryOf: <originalWorkerId>` pointer per retried worker; no chains.
- **Option (b) — Defer failure handling entirely to caller (queen prompt)**. Ship Option E §A only (the prompt protocol); leave `_consensus` and `_status` unchanged. Caller writes its own `state.consensus.history` entry on timeout via `_memory`.
- **Option (c) — Split into separate `_failure` MCP tool**. Introduce a new `hive-mind_failure` action verb (or even a new MCP tool) for `report-worker-absent` / `mark-quorum-failed` / `retry-task` actions. Keep `_consensus` and `_status` clean of failure semantics.

## Pros and Cons of the Options

**Option (a) — auto-transitions + minimal lineage + §6 protocol**
- Pros: matches ADR-0109 Option E §6 literally; closes T12 in a single commit; `_consensus({action:'status'})` becomes self-healing across all strategies (no caller-side coordination required); `_status` surfaces failure state to the queen prompt without a new tool; lineage is one additive field — substrate-compatible. Cross-strategy: as T1/T2/T3 extend `calculateRequiredVotes` to `weighted`/`gossip`/`crdt`, the auto-transition predicate "transparently" handles them via the strategy-agnostic dispatch.
- Cons: couples failure semantics into `_consensus`'s status path — the action gains a side effect (mutating `proposal.status`, moving the row from `pending` to `history`) where today it only reads. Callers expecting pure-read behaviour from `action: 'status'` may be surprised; mitigated by it being our own first-party caller (the queen prompt). Lineage adds one persisted field per worker; test surface grows.

**Option (b) — defer to caller**
- Pros: smallest fork-side diff; preserves `_consensus`-as-pure-read invariant; failure handling stays in the queen prompt where the LLM already coordinates spawn/result decisions.
- Cons: every queen prompt across every hive must independently implement the auto-status-transition logic via raw `_memory` writes — duplicates the §6 contract across N spawn templates and trusts the LLM to write the exact `'failed-quorum-not-reached'` literal that downstream tooling reads. Brittle. Falsifiable contract gets hidden in prose. ADR-0109 Option E specifically pulled this work *out* of the prompt and into the handler precisely because prompt-only enforcement failed in practice.

**Option (c) — separate `_failure` MCP tool**
- Pros: clean separation of concerns — `_consensus` reads, `_failure` writes failure state; orthogonal action verbs; easier to disable/feature-flag the failure subsystem if it regresses.
- Cons: introduces a new MCP tool surface (or new action verb requiring its own JSON-schema and dispatch arm); Queen prompt must coordinate two tools where today it coordinates one; ADR-0109 Option C already considered and deferred this exact split — undoing that deferral without new evidence (specifically that A+B proved insufficient) violates the tracker's escalation rule.

## Decision Outcome

Chosen option: **Option (a) (auto-status-transitions in `_consensus` + minimal lineage tracking + §6 prompt protocol)**, because (1) ADR-0103 already ratified ADR-0109 Option E and option (a) is the mechanical implementation of that ratified design; (2) option (b) duplicates the protocol across N spawn templates with no enforcement; (3) option (c) violates the explicit ADR-0109 deferral on Option C without new evidence. Lineage stays at a single `retryOf` pointer per worker; if chain semantics or whole-hive abort policy emerge as needs, escalate per the ADR-0118 T12 escalation rule.

**Worker-rejoin-after-marked-failed stance: throw, not silent admission.** Once a worker has been marked failed (per-worker `failedAt` populated), a subsequent `vote` MCP call from that worker's ID for any active proposal in the same consensus round is rejected with a named error `WorkerAlreadyFailedError`. Rationale: re-admitting a previously-marked-absent voter would invalidate the `absentVoters` snapshot that the auto-transition wrote to history; consistency with the audit trail wins over best-effort rescue. Workers re-spawned with a *new* ID via the §6 retry-once policy carry a `retryOf` pointer back to the original; they are first-class voters under their new ID, not re-admitted under the old one.

**Quorum-failed semantics.** A consensus round is `'failed-quorum-not-reached'` (the Option E §B literal) when `timedOut && totalVotes < required`. The transition is one-way: a `'failed-quorum-not-reached'` proposal is appended to `state.consensus.history` and its row is removed from `state.consensus.pending`; subsequent `vote` calls against its `proposalId` are rejected with `ProposalAlreadyFailedError`. The `absentVoters` array is computed at transition time as `state.workers.filter(w => !(w in proposal.votes))` and persisted with the proposal in history; it is the audit trail of who didn't show up.

**Auto-transition strategy-applicability.** The transition fires for **any** `proposal.strategy` value in the supported enum at evaluation time. The threshold `required` is read from `calculateRequiredVotes(proposal.strategy, totalNodes, ...)`; T12 inherits the fully-extended switch from T1/T2/T3 once those land. Until then, the transition exercises against `bft`/`raft`/`quorum` only and the acceptance check skips `weighted`/`gossip`/`crdt` cases until each Tn lands its respective enum extension (each Tn must add its case to T12's acceptance check on closure — see §Risks and the cross-Tn dependency note).

## Consequences

**Positive**
- ADR-0109 Option E §6 prompt-protocol is materialised in the queen template; the §6 contract is no longer a documentation-only promise.
- `_consensus({action:'status'})` becomes self-healing for stalled proposals across all strategies; the queen no longer needs a per-strategy timeout-handling branch in its prompt.
- `_status` surfaces a `failedWorkers` summary, giving the queen prompt a one-shot "what's still missing" view without re-reading `state.consensus.history`.
- `retryOf` lineage records the parent-child relationship for retried workers, so post-mortems and audit trails can reconstruct who replaced whom.
- Cross-strategy: when T1/T2/T3 land, weighted/gossip/crdt rounds get auto-status-transition behaviour for free (no code change in `_consensus({action:'status'})`).
- ADR-0118 T12 row flips to `complete`; ADR-0116 plugin README annotation lift fires on the next P1 materialise run.

**Negative**
- `_consensus({action:'status'})` is no longer a pure read — it can mutate `proposal.status` and move the row from `pending` to `history`. Callers expecting idempotent reads must adapt; documented in the action's JSON-schema description and surfaced in the response shape (`statusJustTransitioned: boolean`).
- The auto-transition is one-way; a worker that was marked absent cannot be re-admitted to the *same* consensus round. Re-spawn requires a new worker ID and a fresh proposal (or a new vote on an unstarted proposal).
- `state.workers[]` shape gains optional `failedAt: number | null` and `retryOf: string | null` per entry. Existing state files compile against the wider shape (both fields optional and defaulted to null on load). One-shot migration is not required, but `loadHiveState` must default both fields when reading older state.
- `_status` response gains a `failedWorkers: { id, failedAt, retryOf }[]` summary field; downstream consumers that pattern-match the existing response shape with strict-shape validators will need to widen.
- Retry-lineage stays minimal (`retryOf` is a single pointer, not a chain). If a retried worker itself fails and is retried, the new entry's `retryOf` points to the *immediate* predecessor; chain reconstruction requires recursive lookup at audit-time.
- `_consensus({action:'vote'})` rejects votes against already-failed proposals and from already-failed worker IDs — adds two new named-error paths the queen prompt must handle gracefully (Option E §A's "do not silently drop" applies here too: the rejection must surface to the queen, not be swallowed).

## Validation

Per `feedback-all-test-levels`, all three pyramid levels are mandatory and ship in the same commit:

- **Unit** — `tests/unit/adr0131-worker-failure-protocol.test.mjs` (London-school, mocked I/O): covers (a) §6 prompt-string presence — the WORKER FAILURE PROTOCOL block is emitted by `generateHiveMindPrompt` with the literal `'absent'` status string, the literal `60s` threshold, and the literal `retry-once` instruction; (b) `_consensus({action:'status'})` auto-transition for `bft`, `raft`, `quorum` proposals past `timeoutAt` with `totalVotes < required` — verifies status flips to `'failed-quorum-not-reached'`, `absentVoters` populated, proposal moved from `pending` to `history`; (c) `_consensus({action:'vote'})` rejects votes from failed workers (`WorkerAlreadyFailedError`) and rejects votes against failed proposals (`ProposalAlreadyFailedError`); (d) `loadHiveState` defaults `failedAt`/`retryOf` to null on older state files; (e) `_status` response includes `failedWorkers` summary derived from per-worker fields; (f) `retryOf` round-trip through `saveHiveState`/`loadHiveState`; (g) the strategy-switch default arm in the auto-transition predicate throws synchronously on unknown strategy values.
- **Integration** — same file (per CLAUDE.md pyramid; `tests/unit/*.test.mjs` covers both tiers): drives `_consensus({action:'propose'}) → vote → tally → status` end-to-end through `loadHiveState`/`saveHiveState` writing to a tempdir; asserts on-disk `state.consensus.history` row matches the failed-quorum-not-reached resolution; asserts `state.workers[]` failedAt/retryOf fields persist; asserts the §6 prompt string appears verbatim in the rendered queen-spawn output.
- **Acceptance** — `lib/acceptance-adr0131-worker-failure.sh` (new file, wired into `scripts/test-acceptance.sh`): round-trips `_consensus`/`_status`/§6-prompt assertions against a fresh `init --full` project's published `@sparkleideas/cli`; constructs a `bft`/`raft`/`quorum` proposal with a `timeoutAt` already in the past and zero votes, calls `_consensus({action:'status'})`, asserts the response shows `'failed-quorum-not-reached'` with `absentVoters` populated. Strategy coverage starts at `bft`/`raft`/`quorum`; `weighted`/`gossip`/`crdt` cases added when their respective Tns land. Uses `_cli_cmd` per `reference-cli-cmd-helper.md`.

ADR-0118 status table flips T12 to `complete` only after all three levels are green; ADR-0116 annotation lift is blocked until then per `feedback-no-fallbacks.md`.

## Decision

T12 ships ADR-0109 Option E's §6 prompt protocol + auto-status-transitions in `_consensus` + minimal `retryOf` lineage tracking + `_status` failure summary, in a single commit, behind the test pyramid above. Option E's §6 contract strings (`'absent'`, `60s`, `retry-once`) and auto-status-transition literals (`'failed-quorum-not-reached'`, `absentVoters`) are verbatim contracts asserted by the tests; renaming any of them is a breaking change to the cross-ADR contract with ADR-0103/ADR-0109.

## Implementation plan

Lifted from ADR-0109 §Implementation plan steps 1, 2, 6, 7, plus the carry-forward retryOf surface and `_status` extension new to T12. Touch sites: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts` (`_consensus` action; `_status` action; `loadHiveState`/`saveHiveState` shape widening) and `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts` (queen prompt template §6).

1. **Extend the §6 worker-coordination prompt template.** `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts:168-178` — add a `WORKER FAILURE PROTOCOL` subsection with the literal text from ADR-0109 Option E §A: 60s absence threshold, retry-once policy, the literal `'absent'` status string, and the "do not silently drop" instruction. Sentinel substrings the unit test asserts on: `WORKER FAILURE PROTOCOL`, `60s`, `retry-once`, `'absent'`, `worker-<id>-status`.
2. **Widen the per-worker state shape.** Add optional `failedAt: number | null` and `retryOf: string | null` to the worker entry type emitted by `loadHiveState` / consumed by `saveHiveState`. Existing state files load with both defaulted to `null` (no migration).
3. **Add the auto-status-transition in `_consensus({action:'status'})`.** `hive-mind-tools.ts:805-829` — when handling a proposal in `state.consensus.pending`, if `Date.now() >= proposal.timeoutAt` and `totalVotes < calculateRequiredVotes(proposal.strategy, totalNodes, proposal.quorumPreset)`, set `proposal.status = 'failed-quorum-not-reached'`, populate `proposal.absentVoters = state.workers.filter(w => !(w.id in proposal.votes))`, append to `state.consensus.history`, remove from `state.consensus.pending`, save, and return the response with `statusJustTransitioned: true`. Apply for **all** strategies in the enum at evaluation time; do not gate on `proposal.strategy === 'raft'`.
4. **Replace any strategy-conditional default arm with a throw.** Anywhere the auto-transition path or `calculateRequiredVotes` invocation reads `proposal.strategy`, replace silent fallback with a synchronous throw on unknown values per `feedback-no-fallbacks.md` (mirrors the ADR-0119 §Implementation plan step 5 change to `calculateRequiredVotes`'s default arm).
5. **Add per-worker failure marking.** When the queen prompt writes `worker-<id>-status: 'absent'` via `_memory`, the next call to `_consensus({action:'status'})` (or any handler that reads worker state) sets that worker's `failedAt = Date.now()` and persists. T12's primary failure-marking path is the prompt → `_memory` → `_consensus`/`_status` chain; no separate "mark-failed" action verb is added (per the §Decision §c-deferral).
6. **Add `WorkerAlreadyFailedError` to `_consensus({action:'vote'})`.** When a vote arrives from a worker whose `failedAt !== null`, throw the named error synchronously. Same path: `ProposalAlreadyFailedError` when the target proposal's `status` is already `'failed-quorum-not-reached'` (or any other terminal state in `state.consensus.history`).
7. **Track retry lineage.** When a retried worker is registered (via the queen-prompt `_memory` write of a re-spawned worker entry), `retryOf` is set to the original worker's ID. T12 does not introduce a new MCP action verb for this; the queen-prompt §6 instructions describe the `_memory` write that records the lineage on the new worker entry. Acceptance check verifies the round-trip.
8. **Extend `_status` response shape.** `_status` action gains `failedWorkers: { id: string, failedAt: number, retryOf: string | null }[]`, derived by filtering `state.workers[]` for `failedAt !== null`. Backward-compatible: existing fields unchanged; consumers with strict-shape validators must widen.
9. **Tests.** Add to `tests/unit/adr0131-worker-failure-protocol.test.mjs` (covers unit and integration tier per CLAUDE.md pyramid):
   - **§6 prompt presence**: `generateHiveMindPrompt` output contains `WORKER FAILURE PROTOCOL`, `60s`, `retry-once`, `'absent'`, `worker-<id>-status` literally.
   - **Auto-transition fires across strategies**: parameterised over `bft`/`raft`/`quorum` (today) and `weighted`/`gossip`/`crdt` (added when each Tn lands); proposal with `timeoutAt < Date.now()` and `votes` below threshold transitions on next `_consensus({action:'status'})` call.
   - **`absentVoters` populated correctly**: matches `state.workers.filter(w => !(w.id in proposal.votes))` literally.
   - **Proposal moves from pending to history**: post-transition, `state.consensus.pending[proposalId]` is undefined; `state.consensus.history` last row is the transitioned proposal.
   - **`statusJustTransitioned: true`** in the response on the call that fires the transition; `false` on subsequent calls (proposal already in history).
   - **`WorkerAlreadyFailedError`**: vote from a worker with `failedAt !== null` throws synchronously.
   - **`ProposalAlreadyFailedError`**: vote against a proposal with terminal status throws synchronously.
   - **Retry lineage round-trip**: register a retried worker entry with `retryOf: <original>`; `loadHiveState`/`saveHiveState` preserves it; `_status.failedWorkers` includes the original with the retried worker's ID resolvable via the new entry's `retryOf` pointer.
   - **`loadHiveState` defaults**: older state file (without `failedAt`/`retryOf`) loads with both fields defaulted to `null`.
   - **Unknown strategy throws**: an internal call into the auto-transition path with `proposal.strategy: 'typo'` throws synchronously (no silent default).
   - **Backward-compat smoke**: existing `_consensus({action:'status'})` for an unexpired proposal returns the same shape as before plus `statusJustTransitioned: false`.

Per ADR-0118's test-first delivery rule, all tests ship in the same commit as the implementation; the ADR-0116 plugin README annotation lifts only after CI is green.

## Specification

**Per-worker state shape** (`forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts`, `state.workers[]`):

```ts
type WorkerEntry = {
  id: string;
  // ... existing fields unchanged ...
  failedAt: number | null;          // ms-since-epoch when worker was marked absent; null while live
  retryOf: string | null;            // original worker's ID when this entry is a retry; null otherwise
};
```

**Auto-transition contract** (in `_consensus({action:'status'})`):

- **Trigger predicate**: `Date.now() >= proposal.timeoutAt && totalVotes < calculateRequiredVotes(proposal.strategy, totalNodes, proposal.quorumPreset)`.
- **Side effects on trigger** (in order, atomic w.r.t. `saveHiveState`):
  1. `proposal.status = 'failed-quorum-not-reached'`
  2. `proposal.absentVoters = state.workers.filter(w => !(w.id in proposal.votes)).map(w => w.id)`
  3. `delete state.consensus.pending[proposal.proposalId]`
  4. `state.consensus.history.push(proposal)`
  5. `saveHiveState(state)`
- **Response shape** when the transition fires: `{ status: 'failed-quorum-not-reached', absentVoters: string[], statusJustTransitioned: true, ... }`. Subsequent calls for the same `proposalId` (now in history) return the historical row with `statusJustTransitioned: false`.
- **Strategy applicability**: applies for **every** value of `proposal.strategy` in the enum at evaluation time. The threshold is read from `calculateRequiredVotes`, which T1/T2/T3 will have extended to `weighted`/`gossip`/`crdt`; T12 makes no additional assumption about which strategies are enumerated.
- **Default arm**: any code path in this file that switches on `proposal.strategy` and currently has a permissive default arm replaces it with a synchronous throw (matches ADR-0119's `default:` change).

**§6 prompt template extension** (`forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts:168-178`):

The §6 worker-coordination block gains a `WORKER FAILURE PROTOCOL` subsection. Sentinel substrings (asserted by unit tests; do not rename without ADR amendment):

- `WORKER FAILURE PROTOCOL`
- `60s` — the absence threshold
- `retry-once` — the policy literal
- `'absent'` — the worker-status literal
- `worker-<id>-status` — the memory-key shape

**`_status` response shape extension**:

```ts
type StatusResponse = {
  // ... existing fields unchanged ...
  failedWorkers: Array<{
    id: string;
    failedAt: number;
    retryOf: string | null;
  }>;
};
```

`failedWorkers` is the result of `state.workers.filter(w => w.failedAt !== null).map(w => ({ id: w.id, failedAt: w.failedAt, retryOf: w.retryOf }))`.

**Invariants**
- Failure marking is one-way: `failedAt: null → number` is the only legal transition; reverse transitions throw.
- A worker entry's `failedAt` is independent of the proposal-level `absentVoters` snapshot. `absentVoters` is computed once at transition time and frozen with the historical proposal; per-worker `failedAt` is mutable forward-only state.
- `retryOf` is a single pointer per entry, not a chain depth. Chain reconstruction (worker A retried as B retried as C) is the consumer's job via recursive lookup.
- The auto-transition predicate is strategy-agnostic at the dispatch boundary; the threshold computation is strategy-aware via `calculateRequiredVotes`.
- `_consensus({action:'vote'})` rejects votes from any voter whose `failedAt !== null` and against any proposal whose `proposalId` resolves into `state.consensus.history` (terminal state).
- ADR-0109 R8 (sub-queen failure in hierarchical-mesh) is **explicitly out-of-scope**. `failedAt`/`retryOf` apply to direct-queen-spawned workers only. T10 (ADR-0128) owns the sub-queen failure semantics.

## Pseudocode

Plain prose; actual TypeScript lands in the implementing commit.

```
on _consensus({action: 'status', proposalId}):
    state = loadHiveState()
    proposal = state.consensus.pending[proposalId]
    if proposal is undefined:
        // already in history? return historical row, statusJustTransitioned: false
        historical = state.consensus.history.find(p => p.proposalId === proposalId)
        if historical: return { ...historical, statusJustTransitioned: false }
        throw ProposalNotFoundError

    totalNodes = max(1, count(state.workers))
    required = calculateRequiredVotes(proposal.strategy, totalNodes, proposal.quorumPreset)
    // calculateRequiredVotes throws on unknown strategy per ADR-0119

    totalVotes = count(keys(proposal.votes))

    if Date.now() >= proposal.timeoutAt AND totalVotes < required:
        proposal.status = 'failed-quorum-not-reached'
        proposal.absentVoters = state.workers
            .filter(w => not (w.id in proposal.votes))
            .map(w => w.id)
        delete state.consensus.pending[proposal.proposalId]
        state.consensus.history.push(proposal)
        saveHiveState(state)
        return { ...proposal, statusJustTransitioned: true }

    return { ...proposal, statusJustTransitioned: false }

on _consensus({action: 'vote', proposalId, voterId, vote}):
    state = loadHiveState()
    voter = state.workers.find(w => w.id === voterId)
    if voter AND voter.failedAt !== null:
        throw WorkerAlreadyFailedError(voterId)

    // proposal already terminal?
    if proposalId in keys(state.consensus.history):
        throw ProposalAlreadyFailedError(proposalId)

    proposal = state.consensus.pending[proposalId]
    // ... existing vote body, then tryResolveProposal

on _status():
    state = loadHiveState()
    failedWorkers = state.workers
        .filter(w => w.failedAt !== null)
        .map(w => ({ id: w.id, failedAt: w.failedAt, retryOf: w.retryOf }))
    return { ...existingStatusFields, failedWorkers }

on loadHiveState():
    raw = read state.json
    for each worker in raw.workers:
        worker.failedAt ??= null
        worker.retryOf ??= null
    return raw

on generateHiveMindPrompt(...):  // commands/hive-mind.ts
    body = existing §6 worker-coordination text
    body += WORKER_FAILURE_PROTOCOL_BLOCK   // sentinels: 'WORKER FAILURE PROTOCOL', '60s',
                                              // 'retry-once', "'absent'", 'worker-<id>-status'
    return body
```

The §6 prompt block instructs the queen LLM to (a) call `_memory({action:'get', key:'worker-<id>-result'})` after `Task` returns, (b) write `worker-<id>-status: 'absent'` if the result is missing or Task errored, (c) decide retry-once or proceed-without, (d) treat 60s with no result as `'absent'`, (e) never silently drop. The runtime side (this ADR's `_consensus`/`_status` extensions) materialises the audit-trail effect of those prompt-driven decisions; it does not enforce that the queen actually follows the protocol — that remains prompt-driven per ADR-0104.

## Architecture

**Touched files**
- `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts:168-178` — §6 WORKER FAILURE PROTOCOL prompt subsection
- `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:180-201` — `loadHiveState`/`saveHiveState` widening for `failedAt`/`retryOf`
- `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:805-829` — `_consensus({action:'status'})` auto-transition body
- `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts` `_consensus({action:'vote'})` — `WorkerAlreadyFailedError` + `ProposalAlreadyFailedError` paths
- `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts` `_status` action — `failedWorkers` summary field
- `tests/unit/adr0131-worker-failure-protocol.test.mjs` — new unit + integration test file
- `lib/acceptance-adr0131-worker-failure.sh` — new acceptance check, wired into `scripts/test-acceptance.sh`

**Data flow on worker failure**
1. Queen LLM calls `Task` to spawn worker-N. Task returns (error, no result key, or success but malformed result).
2. Queen prompt's §6 WORKER FAILURE PROTOCOL block instructs the queen to read `worker-N-result` via `_memory({action:'get'})`. If missing, write `worker-N-status: 'absent'` via `_memory({action:'set'})`.
3. Queen decides retry-once: if so, `Task`-spawn worker-N-retry-1 with a new ID and write a new worker entry with `retryOf: 'worker-N'` via `_memory`/state coordination. If not, proceed with the gap recorded.
4. On the next `_consensus({action:'status'})` call (whether the queen's own or a triggered system call), the handler reads `state.workers[]`, marks any worker whose `worker-<id>-status` memory key is `'absent'` and whose `failedAt` is still null with `failedAt = Date.now()`. (This step's exact triggering surface is part of step 5 of §Implementation plan; the prompt → `_memory` → status-handler chain is the canonical path.)
5. If a consensus round is in flight and `timedOut && totalVotes < required`, the auto-transition fires: status flips to `'failed-quorum-not-reached'`, `absentVoters` snapshot is taken, proposal moves from pending to history, state saved.
6. `_status` action surfaces `failedWorkers` summary; the queen prompt reads it and includes the gap in its final summary per the §6 contract.

**Layering** (per ADR-0114): §6 prompt template = execution layer (queen-process spawn output). `_consensus` auto-transition + `_status` shape extension = protocol layer. `state.workers[]` `failedAt`/`retryOf` fields = substrate, but additive-only and backward-compatible (no schema migration).

## Refinement

**Edge cases**
- **Worker rejoins after marked-failed**: the worker's `_consensus({action:'vote'})` call is rejected with `WorkerAlreadyFailedError` synchronously. `failedAt: number → null` is illegal; revival requires a new worker ID via the retry-lineage path. Per the §Decision Outcome rationale, this surfaces caller bugs (queen prompt mistake, late-arriving vote) loudly rather than silently re-admitting.
- **Partial result + failure**: a worker that wrote a malformed result key counts as failure for §6 purposes. The queen prompt's §6 block instructs writing `'absent'` when the result is missing OR malformed; T12's runtime side does not parse worker results — it trusts the queen's `'absent'` declaration via `_memory`. If the queen incorrectly judges a result as malformed, the worker is marked failed; that is a queen-prompt judgement, not a T12 enforcement.
- **Multi-retry chains** (worker A retried as B, B retried as C): each retry entry's `retryOf` points to the *immediate* predecessor (B.retryOf = A; C.retryOf = B). Chain depth reconstruction is recursive lookup at audit-time. T12 does not validate chain length, depth, or convergence; the §6 prompt's "retry-once" policy bounds depth at the prompt layer. If chain semantics or retry-counter graphs become a need, escalate per the ADR-0118 T12 escalation rule.
- **Queen-failed during retry**: if the queen process itself dies while a retry is in flight, the new worker entry may be partially-written. On next `loadHiveState`, partial entries (id but no failedAt/retryOf populated) load with both fields defaulted to null per the load-time defaults. This is acceptable for T12 — partial-write recovery is a substrate concern (T11 ADR-0130 RVF WAL fsync covers durability of writes; this ADR does not duplicate that). If a partial retry entry exists with `retryOf: null` where it should be set, the audit trail is lossy for that entry; documented as a known limitation.
- **Interaction with T1/T2/T3 consensus strategies**: the auto-transition predicate calls `calculateRequiredVotes(proposal.strategy, ...)`. T1 (weighted) extends the function with a 4th case; T2 (gossip) and T3 (crdt) add 5th and 6th. T12's auto-transition body is *strategy-agnostic at the dispatch boundary*, so adding cases to `calculateRequiredVotes` does not require changes here. The unit-test parameterisation, however, must add the new strategy values to its case matrix as each Tn lands. Documented as a per-Tn closure obligation: the closing commit for each of T1/T2/T3 must add a case to T12's parameterised auto-transition test.
- **Concurrent transitions**: two callers calling `_consensus({action:'status'})` simultaneously for the same `proposalId` whose timeout has just elapsed. Both reach the trigger predicate; whichever serialises first via `saveHiveState` wins; the second sees the proposal in history and returns `statusJustTransitioned: false`. State persistence ordering is `loadHiveState`'s responsibility; T12 does not add a new lock. If `saveHiveState` is non-atomic (substrate-level concern), worst case both writers persist the same `'failed-quorum-not-reached'` history row idempotently — T12 deduplicates on `proposalId` at write time (`history.push` checks for an existing row with the same `proposalId` first; if present, no-op). Acceptance test covers this with two sequential calls verifying only one history row.
- **`timeoutAt` in the future at trigger evaluation**: predicate returns false; status stays pending; response is `statusJustTransitioned: false`. No-op.
- **`timeoutAt` undefined on legacy proposals**: load-time defaults assign `timeoutAt = Number.POSITIVE_INFINITY`, so the predicate never trips. Legacy proposals never auto-fail; explicit caller-driven termination still works. Documented; if legacy proposals need migration, that is an ADR-0118 follow-up not in T12 scope.
- **Tie at threshold**: the auto-transition fires only when `totalVotes < required` strictly. A proposal whose votes match `required` but is past `timeoutAt` is *not* a quorum failure — the resolution path (`tryResolveProposal`) handles that case via approve/reject. T12's auto-transition is only for the "no-quorum-yet-and-time-is-up" case.
- **Worker re-spawn with same ID**: if the queen prompt mistakenly re-spawns a worker with the same ID as a failed one (instead of a new ID), the new entry inherits the old's `failedAt: number`. The worker remains marked failed; votes from that ID still throw `WorkerAlreadyFailedError`. The queen prompt's §6 block must instruct using a fresh ID for retries; the test asserts the literal `worker-<id>-retry-1` shape (incrementing suffix) as the canonical retry ID convention.

**Test list**
- Unit (`tests/unit/adr0131-worker-failure-protocol.test.mjs`):
  - §6 prompt presence (sentinel substrings).
  - Auto-transition fires for `bft`/`raft`/`quorum` (extended to `weighted`/`gossip`/`crdt` per Tn closure).
  - `absentVoters` populated correctly.
  - Proposal moves pending → history.
  - `statusJustTransitioned` true on first transition, false after.
  - `WorkerAlreadyFailedError` on vote from failed worker.
  - `ProposalAlreadyFailedError` on vote against failed proposal.
  - Retry lineage round-trip via `_memory` + state save/load.
  - `loadHiveState` defaults `failedAt`/`retryOf` on legacy state.
  - `_status.failedWorkers` derivation correctness.
  - Unknown strategy throws synchronously in auto-transition path.
  - Concurrent-transition idempotency (no duplicate history rows).
- Integration (same file, real I/O): drive `propose → vote → timeout → status → history` through `loadHiveState`/`saveHiveState` against a tempdir; assert on-disk state.consensus.history row matches transitioned proposal.
- Acceptance (`lib/acceptance-adr0131-worker-failure.sh::check_adr0131_worker_failure_auto_transition`): round-trip via `init --full` project + published `@sparkleideas/cli`; constructs proposal with `timeoutAt` in the past and zero votes; asserts `_consensus({action:'status'})` response shows `'failed-quorum-not-reached'` with populated `absentVoters`. Strategy coverage starts at `bft`/`raft`/`quorum`; cases for `weighted`/`gossip`/`crdt` added at each Tn closure. Uses `_cli_cmd` per `reference-cli-cmd-helper.md`.

## Completion

**Annotation lift criterion** (per ADR-0118 §H5 / Annotation lifecycle):

T12 marked `complete` in ADR-0118 §Status table with Owner/Commit columns naming a green-CI commit hash. Annotation lift fires on the next P1 materialise run after that flip — specifically, the ADR-0116 plugin README's "worker-failure handling" / "fault tolerance" row drops the `partial`/`missing` annotation, and any per-command frontmatter `implementation-status: partial` flips to `implemented`.

Per `feedback-no-fallbacks.md` and `feedback-no-squelch-tests.md`, annotations must NOT lift before all three test pyramid levels are green for T12. The materialise script reads ADR-0118's §Status table and only lifts annotations for Tns marked `complete` with a commit hash.

**Wire-up**
- New acceptance check `check_adr0131_worker_failure_auto_transition` added to `lib/acceptance-adr0131-worker-failure.sh` and dispatched from `scripts/test-acceptance.sh` in the appropriate phase group.
- New test file `tests/unit/adr0131-worker-failure-protocol.test.mjs` discovered automatically by the existing test runner (covers both unit and integration tier per the CLAUDE.md pyramid).

**ADR-0118 escalation reference**: per the T12 row, promote to a follow-up design ADR if any of (a) retry-lineage grows beyond a single `retryOf` pointer; (b) per-worker heartbeat/checkpoint protocol is needed (ADR-0109 R4 deferral); (c) whole-hive abort policy is needed when failure rate exceeds a threshold (ADR-0109 R2 deferral); (d) sub-queen failure semantics in hierarchical-mesh need T10/T12 cross-coordination beyond what ADR-0109 R8 + ADR-0128 already document.

**Per-Tn closure obligation**: as each of T1 (ADR-0119), T2 (ADR-0120), T3 (ADR-0121) lands its enum extension, that Tn's closing commit must add the new strategy value to T12's parameterised auto-transition test in `tests/unit/adr0131-worker-failure-protocol.test.mjs` and to the strategy coverage in `lib/acceptance-adr0131-worker-failure.sh`. T12 ships first; sibling Tns piggyback their case onto T12's matrix.

## Acceptance criteria

- [ ] `commands/hive-mind.ts:168-178` — §6 worker-coordination block contains `WORKER FAILURE PROTOCOL` subsection with literal sentinels `60s`, `retry-once`, `'absent'`, `worker-<id>-status`
- [ ] `state.workers[]` shape gains optional `failedAt: number | null` and `retryOf: string | null`; existing state files load with both defaulted to null
- [ ] `_consensus({action:'status'})` auto-transitions `'pending'` → `'failed-quorum-not-reached'` for proposals where `Date.now() >= proposal.timeoutAt && totalVotes < required`, applied across all strategies in the enum
- [ ] On transition: `absentVoters` populated as `state.workers.filter(w => !(w.id in proposal.votes))`, proposal moved from `state.consensus.pending` to `state.consensus.history`, state saved
- [ ] Response includes `statusJustTransitioned: boolean` reflecting whether *this* call fired the transition
- [ ] `_consensus({action:'vote'})` throws `WorkerAlreadyFailedError` synchronously on votes from workers with `failedAt !== null`
- [ ] `_consensus({action:'vote'})` throws `ProposalAlreadyFailedError` synchronously on votes against proposals with terminal status
- [ ] `_status` action response includes `failedWorkers: { id, failedAt, retryOf }[]` derived from `state.workers[]`
- [ ] Retry lineage: a re-spawned worker entry's `retryOf` points to the original worker's ID; round-trip preserves through `loadHiveState`/`saveHiveState`
- [ ] Auto-transition path's strategy-switch default arm throws synchronously on unknown strategy values (no silent fallback)
- [ ] Concurrent-transition idempotency: two `_consensus({action:'status'})` calls for the same expired proposal produce exactly one history row
- [ ] `npm run test:unit` green; `npm run test:acceptance` green
- [ ] ADR-0118 status table row T12 flips to `complete` with Owner/Commit; ADR-0116 plugin README "worker-failure handling" / "fault tolerance" row drops the `partial`/`missing` annotation on the next P1 materialise run

## Risks

**Medium — cross-Tn dependency on T1/T2/T3 for full strategy coverage.** T12 ships its acceptance check with `bft`/`raft`/`quorum` strategy cases initially. `weighted`/`gossip`/`crdt` cases require T1/T2/T3 to land their respective `calculateRequiredVotes` extensions first. T12 does *not* block on T1/T2/T3 — the dispatch is strategy-agnostic — but the test matrix has gaps until those Tns land. Mitigation: each of T1/T2/T3's closing commit adds a parameterised case to T12's test matrix per the §Completion per-Tn closure obligation. Risk shape: if a Tn lands but forgets to add its T12 case, the auto-transition behaviour for that strategy is untested. The ADR-0118 review-notes-triage's per-Tn closure checklist covers this; cross-reference at closure.

**Low — `_consensus({action:'status'})` becomes a side-effecting action.** Pure-read callers may be surprised. Mitigation: `statusJustTransitioned` field surfaces the transition explicitly in the response; the action's JSON-schema description documents the side effect; the queen-prompt §6 contract is the only first-party caller and is updated in the same commit.

**Low — `state.workers[]` shape widening.** Optional fields with load-time defaults; no migration. Risk only materialises if a downstream consumer uses strict-shape validation against the *old* shape; that consumer must widen. None known in fork or ruflo-patch today.

**Promote scope expansion if any of**:
- Retry-lineage chains/trees become a real need (currently single pointer).
- Per-worker heartbeat / checkpoint protocol becomes a real need (currently result-write-only per ADR-0109 R4).
- Whole-hive abort policy when failure rate exceeds threshold becomes a real need (currently no threshold per ADR-0109 R2).
- Sub-queen failure semantics in hierarchical-mesh need T10/T12 cross-coordination beyond what ADR-0109 R8 already documents (currently T10/ADR-0128's domain).

Each is a follow-up ADR per the ADR-0118 T12 escalation rule.

## References

- ADR-0103 — README claims investigation roadmap (row 92 ratified ADR-0109 Option E as the worker-failure design)
- ADR-0109 — Worker failure handling (Option E §6 is the prompt-side contract carried forward here; specifically Option A prompt protocol, Option B auto-status transitions; Option C deferred; R8 sub-queen out-of-scope)
- ADR-0118 — Hive-mind runtime gaps tracker (owns this work as task T12)
- ADR-0118 review-notes-triage — `docs/adr/ADR-0118-review-notes-triage.md` (open-question consolidation)
- ADR-0118 execution plan — `docs/adr/ADR-0118-execution-plan.md` (wave-based execution; T12 lands as a sibling task to T1-T11)
- ADR-0104 — queen orchestration (owns the §6 worker-coordination prompt template this ADR extends)
- ADR-0106 — consensus algorithm enforcement (owns the auto-status-transition surface in `_consensus` that this ADR materialises)
- ADR-0114 — substrate/protocol/execution layering (failure-protocol lives at protocol + execution layers)
- ADR-0119 — Weighted consensus (T1; T12's auto-transition inherits the extended `calculateRequiredVotes` enum)
- ADR-0120 — Gossip consensus (T2; same)
- ADR-0121 — CRDT consensus (T3; same)
- ADR-0128 — Topology runtime behaviour (T10; owns sub-queen failure semantics per ADR-0109 R8)
- USERGUIDE Hive Mind contract — substring anchor `<summary>👑 <strong>Hive Mind</strong>` in `/Users/henrik/source/ruvnet/ruflo/docs/USERGUIDE.md`
- Implementation surface: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:180-201,805-829` and `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts:168-178`
