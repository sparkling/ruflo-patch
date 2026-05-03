# ADR-0109: Worker failure handling / fault tolerance

- **Status**: Partially superseded by ADR-0131 (T12 complete, 2026-05-03). Original Option E §6 prompt protocol shipped: `commands/hive-mind.ts:495-534` + `hive-mind-tools.ts:2397-2407`. **Residual R8** (sub-queen failure escalation in hierarchical-mesh topology) carried forward to **ADR-0132**.
- **Date**: 2026-04-29 (promoted 2026-05-01)
- **Roadmap**: ADR-0103 item 5
- **Scope**: hive-mind worker-failure detection, retry, quorum-with-loss
  semantics. Not federated cross-hive consensus.
- **Inherits**: trusted-clique trust model from ADR-0106. Byzantine
  adversarial framing is theatrical at this trust boundary.

## Context

README claims, surveyed verbatim:

- Line 204: "Agents organize into swarms led by queens that coordinate
  work, prevent drift, and reach consensus on decisions—**even when
  some agents fail**."
- Line 794: "🛡️ **Byzantine Consensus** | Coordinates agents even when
  some fail or return bad results | Fault-tolerant, **handles up to
  1/3 failing agents**".
- Line 404: "**Byzantine fault-tolerant voting (f < n/3)**, weighted,
  majority".
- Line 211: "Fault-tolerant decisions (2/3 majority for BFT)".

ADR-0104 §Out-of-scope is explicit: no worker-failure detection, no
contract-violation triage, no quorum checks. The §6 worker-coordination
contract (lines 168–178 of `commands/hive-mind.ts`) instructs workers to
write their result key — full stop. Nothing about what the Queen does if
a worker doesn't.

ADR-0106 surfaces a load-bearing trust insight, repeated here because
this ADR depends on it: hive workers are Task sub-agents spawned BY the
Queen INSIDE one `claude` session. Same model, same auth, same MCP tool
boundary, no cryptographic identity. This is a **trusted-clique** model.
"Failure" within a hive means **a worker errored / crashed / didn't
return / produced malformed output**, not "a worker is lying to us."
Adversarial Byzantine guarantees apply only to **federated cross-hive
scenarios** (multiple machines, multiple Queens) — none of which the CLI
exposes today.

This reframes the ADR's job: explain what fault-tolerance the runtime
*actually* provides, decide whether to implement worker-unreliability
handling (warranted), keep adversarial Byzantine machinery as future
federation infrastructure (preserve), and align the README to the real
trust model (mandatory).

## Investigation findings

### Source archaeology

**`commands/hive-mind.ts:168–178` — the §6 worker contract**: instructs
workers to write a result key before returning. Zero instructions for
timeout, missing result key, malformed JSON, Task tool errors, retry,
or mark-as-absent. The Queen prompt has no "if a worker doesn't return
within T, do X" branch.

**`mcp-tools/hive-mind-tools.ts:805–829` — `_consensus({action:'status'})`**:
detects `timedOut` for `raft` proposals only and surfaces it as a `hint`
field. **Status does not transition** — stays `'pending'` forever.
`bft` and `quorum` strategies don't check timeout. ADR-0106 already
proposes a `'failed-quorum-not-reached'` transition; this ADR adopts
it as a building block.

**`loadHiveState()` / `saveHiveState()` (lines 180–201)**: pure JSON
read/write. `state.workers[]` is a flat array of IDs — no timestamps,
no heartbeat, no per-worker status. No mechanism to detect a worker
registered but never reporting (stale entry).

**`v3/@claude-flow/swarm/src/consensus/byzantine.ts` — PBFT impl
(431 LOC)**: `ByzantineMessage.signature?: string` exists (line 25),
but `grep "verify\|crypto"` returns zero matches. The signature field
is **declared but never produced or checked**. PBFT shape is faithful
(`pre-prepare → prepare → commit → reply`), `requiredVotes = 2*f + 1`
math is correct (line 177). Fault-tolerance theorems for PBFT require
**verified identity** — that's absent. Structurally PBFT, securely
no-op.

**V2's intent (`v2/src/hive-mind/`)**: V2 had a real worker-failure
model — `HiveMind.ts:402–420` (`retryTask` with `retryOf` lineage),
`HiveMind.ts:309` (`failed` count in status), `Queen.ts:636` (triggers
`['agent_failure', 'deadline_approaching', 'consensus_failure']`),
`consensus.js:78,100,147,470,496` (deadlines, `setTimeout`
finalization, `failedConsensus` metric, `quorum_failed` result).
**None of it carried into V3's CLI/MCP path.** The PBFT in
`swarm/consensus/byzantine.ts` is not a V2 port — it's a new (orphaned)
implementation of the wrong abstraction (adversarial protocol) for
this trust model.

### What happens today on worker failure

Three failure shapes when the Queen spawns worker-1 via Task:

1. **`Task` returns an error** (claude CLI exited non-zero, model
   refused). Queen receives the error; prompt has no instruction for
   it; Queen improvises or silently abandons.
2. **`Task` returns OK, but worker didn't write its result key**.
   Subsequent `_memory({action:'get', key:'worker-1-result'})` returns
   null. Prompt silent on what to do; Queen improvises.
3. **Worker wrote a malformed / partial result key**. Queen reads it
   back as a string and must parse. Prompt silent.

In all three cases behavior is ad-hoc model judgment, not contract.
No detection harness, no metric, no acceptance check that catches
"a worker silently produced no output". Production symptom: runs
"complete" with N-1 results when N were spawned; the missing one is
invisible.

### `hive-mind_consensus` review (intra-hive)

The MCP tool tracks `proposal.byzantineVoters` (line 622) — populated
when a voter casts conflicting votes. This is **equivocation
detection**, not Byzantine fault tolerance. It catches a voter saying
"yes" then "no" — useful but does not catch a worker that never voted
(silent absence) or a worker that voted because its logic crashed mid-
run. Absence is the dominant failure mode in this trust model and the
MCP tool doesn't surface it.

### Swarm-package `ByzantineConsensus` review

Correct for what it claims (structural PBFT) but mismatched to ruflo's
deployment:

- `signature` field on messages is decorative; no signing on broadcast,
  no verification on receipt. Adversarial guarantees evaporate.
- `awaitConsensus` (line 192) sets `proposal.status = 'expired'` on
  timeout — ironically the *right* shape, better than the MCP tool's
  frozen `'pending'`.
- `electPrimary()` (line 102) uses `viewNumber % nodeIds.length` —
  deterministic, not Byzantine-safe; acceptable in a trusted clique.
- `EventEmitter`-based and process-local; MCP tool integration would
  lose state between calls. ADR-0106's Option A1/A2/A3 covers this.

Appropriate as **future federated cross-hive infrastructure** (signed
messages, Byzantine actors realistic). Not appropriate as the runtime
for intra-hive Task-spawned workers — trust model doesn't justify the
machinery.

## Current state verdict

| README claim | Reality | Verdict |
|---|---|---|
| "even when some agents fail" (line 204) | No worker-absence detection in §6 contract or status handler | ❌ |
| "handles up to 1/3 failing agents" (line 794) | PBFT impl exists in swarm package, never wired, signatures unverified | ❌ theatrical |
| "Byzantine fault-tolerant voting (f < n/3)" (line 404) | MCP tool computes `ceil(2/3 * n)` correctly; no signed identity → not actually BFT | ⚠️ correct math, wrong claim |
| "2/3 majority for BFT" (line 211) | Correct, intra-hive | ✅ as a vote-tally rule |
| `--consensus byzantine` flag | Maps to `bft` strategy in MCP tool with equivocation detection | ⚠️ partial |
| Worker timeout / retry | None in CLI/MCP path; V2 had it; not migrated | ❌ |

Summary: the strongest README overclaim of the six items in ADR-0103.
"Even when some agents fail" is doubly mendacious — there is neither
detection of failure nor recovery from it.

## Decision options

### Option A — Worker-absence handling in the Queen prompt

Extend the §6 contract with a WORKER FAILURE PROTOCOL block:

- After `Task` returns, immediately
  `_memory({action:'get', key:'worker-<id>-result'})`.
- If key missing OR Task returned error: write
  `worker-<id>-status: 'absent'`.
- Decide: retry-once (re-spawn via Task) OR proceed without this
  worker's result (record gap in final summary). Do not silently drop.
- Never wait indefinitely; 60s with no result → `'absent'`.

Effort: prompt edit + acceptance check + live smoke. Low blast radius.
Relies on Queen LLM following instructions (no runtime enforcement) —
matches ADR-0104's prompt-driven design.

### Option B — Status auto-transition in `hive-mind_consensus`

Already proposed in ADR-0106 §Recommendation. Pull forward:

- `_consensus({action:'status'})` checks
  `timedOut && totalVotes < required`.
- Transitions status to `'failed-quorum-not-reached'`.
- Records `absentVoters = state.workers.filter(w => !(w in proposal.votes))`.
- Emits to `state.consensus.history`.
- Applies to all strategies (bft, raft, quorum), not just raft.

Effort: ~30 LOC in handler + paired unit + acceptance check.

### Option C — Separate `hive-mind_worker-status` MCP tool

New tool Queen calls between `Task` invocations, returns
`{found, lastSeen, status, resultKey}`. Requires workers to write a
heartbeat field; §6 contract grows. Combines naturally with Option A.

### Option D — Doc correction only

Rewrite README to match the trust model:

> "Within a hive, the Queen detects worker absence (a Task that errored
> or never wrote its result) and either retries or records the gap.
> Workers are spawned by the Queen in one session and are trusted
> siblings; Byzantine adversary detection is not applicable. The PBFT
> implementation in `@claude-flow/swarm` is reserved for future
> federated cross-hive scenarios where independent identities exist."

Drop "even when some agents fail" or qualify it ("even when some
worker tasks error or crash"). Drop "handles up to 1/3 failing
agents" — math is meaningless without verified identity.

Effort: README diff + ADR-0101 prelude entry + CLAUDE.md + skill doc.

### Option E — Hybrid (recommended): A + B + D, defer C

A (prompt protocol) + B (status auto-transition) + D (README
reframing). Defer C until A+B prove insufficient. Low blast radius,
fixes the worst overclaim, preserves PBFT for federated future, keeps
the trust model honest.

## Test plan

**Regression** (automated, runs in `test:acceptance`):

1. The §6 contract block in the generated Queen prompt contains the
   "WORKER FAILURE PROTOCOL" subsection (Option A).
2. `hive-mind_consensus({action:'status'})` on a proposal whose
   `timeoutAt` has passed and which has zero votes → status field
   returned is `'failed-quorum-not-reached'`, not `'pending'`
   (Option B).
3. Same scenario, the response includes `absentVoters` listing the
   workers in `state.workers` who did not vote (Option B).
4. `hive-mind_consensus({action:'status'})` on a `bft` proposal past
   timeout — status transitions, parity with raft (Option B).
5. README and skill doc do NOT contain the literal phrase
   "1/3 failing agents" (Option D).

**Live smoke** (uses developer's `claude` CLI per ADR-0104; no API
costs): spawn a hive with 3 workers and an objective deliberately
crafted so worker-1's task is impossible (e.g.,
`worker-1: read /this-path-does-not-exist/file`; worker-2: list /tmp;
worker-3: print date). Verify post-run:

- `worker-2-result` and `worker-3-result` exist in shared memory.
- Either `worker-1-status == 'absent'` OR retry key `worker-1-retry-1`
  exists.
- Queen's final summary explicitly mentions worker-1 failed/absent
  (does not report 2/3 as 3/3).
- If consensus was issued, `state.consensus.history` shows
  `'failed-quorum-not-reached'` — not perpetual `'pending'`.

**Unit** (in ruflo-patch `tests/unit/`):

- `acceptance-adr0109-fault-tolerance-checks.test.mjs` — paired with
  the acceptance lib per ADR-0097.
- Tests `_consensus` status transition with mocked `Date.now()`.
- Tests `absentVoters` calculation.
- Tests prompt-string presence of the failure protocol block.

## Implementation plan

If Option E (recommended):

1. **Fork `commands/hive-mind.ts`**: extend `generateHiveMindPrompt()`
   to emit the WORKER FAILURE PROTOCOL block in §6 (60s absence
   threshold, retry-once policy).
2. **Fork `mcp-tools/hive-mind-tools.ts`**: in `_consensus` status
   handler, when `timedOut && totalVotes < required`, set
   `status = 'failed-quorum-not-reached'`, populate `absentVoters`,
   move from `pending` to `history`, save.
3. **Fork `swarm/src/consensus/byzantine.ts`**: append header comment
   `// @internal — federated cross-hive future infrastructure, not
   used by hive-mind CLI; see ADR-0109`.
4. **Fork README**: replace overclaiming lines 204, 794, 404 with
   trust-model-honest phrasing from Option D.
5. **Fork CLAUDE.md** + skill doc: update fault-tolerance language.
6. **ruflo-patch `lib/acceptance-adr0109-checks.sh`**: regression checks.
7. **ruflo-patch `tests/unit/acceptance-adr0109-fault-tolerance-checks.test.mjs`**:
   paired unit per ADR-0097.
8. **Live smoke**: `lib/acceptance-adr0109-live-smoke.sh` — opt-in,
   manual-only (consumes `claude` subscription); do not gate parallel
   acceptance on it.

Each step: appropriate fork build branch, push to `sparkling`, paired
ruflo-patch commit. No `Co-Authored-By` trailer.

## Risks / open questions

- **R1 — Infinite retry loops**: retry-once must be hard-capped at one.
  If worker-1 fails twice, mark `absent` and proceed. Prompt block must
  be unambiguous; acceptance check verifies literal "retry-once"
  wording.
- **R2 — Cascading failures**: if N-1 of N fail, retrying all is
  expensive and may hit the same root cause. Open: should Queen abort
  when failure rate exceeds (e.g.) 50%? Out of scope; future
  "hive-abort policy" ADR.
- **R3 — Time source**: `Date.now()` depends on system clock. NTP /
  suspend jumps break timeout math. Acceptable for now (matches V2);
  document in handler.
- **R4 — Heartbeat vs. result-only**: this ADR assumes one result-key
  write per worker. Mid-run checkpoints are a separate feature; don't
  conflate.
- **R5 — `byzantineVoters` vs. `absentVoters`**: orthogonal —
  equivocation = saw contradiction; absence = saw nothing. Tests must
  verify both populate independently.
- **R6 — Federated future**: if cross-hive ever ships, swarm-package
  `ByzantineConsensus` becomes load-bearing and `signature` needs real
  signing/verification. Keep file undeleted; don't promise the
  capability in user-facing copy.
- **R7 — Trust model drift**: if ruflo ever supports third-party
  "worker plugins" (untrusted code in Queen's session), trusted-clique
  breaks. README must say "spawned by the Queen in the same session"
  so the boundary survives.
- **R8 — Sub-queen failure in hierarchical-mesh topology**: ADR-0128
  introduces a topology where sub-queens coordinate sub-hives below the
  top-tier Queen. If a sub-queen fails (Task error, no result key,
  mid-run crash), this ADR's flat retry-once-then-mark-absent policy is
  ill-shaped: the sub-queen owns N workers whose results route through
  it. Three options surface — (a) promote a worker in that sub-hive to
  sub-queen and resume, (b) fail the sub-hive's task and propagate
  absence to top-tier Queen, (c) absorb orphaned workers into top tier
  and continue. Decision deferred to a follow-up ADR; T10's
  `hierarchical-mesh` dispatch must surface sub-queen-absence as a
  distinct event, not collapse it into the worker-absence path.
  Cross-references: ADR-0128 §Refinement (sub-queen failure edge case),
  ADR-0118 review-notes-triage row 54.

## Out of scope

- Federated cross-hive consensus (Byzantine adversary on independent
  machines). Separate future ADR; the swarm-package code is preserved
  as infrastructure for that.
- Mid-run worker checkpoints / heartbeats beyond the start/result
  protocol. Separate ADR if needed (R4).
- Whole-hive abort policy when failure rate exceeds threshold. Separate
  ADR if needed (R2).
- Implementing actual signature signing/verification in
  `ByzantineConsensus.signature`. Federation prerequisite, defer.
- Reviving V2's `retryTask` lineage tracking (`retryOf` chains). The
  Option A "retry-once" policy is simpler and sufficient for the
  current trust model.
- README rewrite of capabilities table — covered by ADR-0101.

## Recommendation

Ship **Option E (A + B + D)**.

- README overclaim is the strongest in ADR-0103; doc correction (D)
  is non-negotiable. "1/3 failing agents" with unverified-signature
  PBFT is not honest.
- Worker absence is a real, frequent, currently-invisible failure
  mode. Option A makes it loud at the prompt layer (matches ADR-0104).
- Option B makes it loud at the JSON layer (ADR-0106 already endorsed;
  pull forward).
- Option C (new MCP tool) is deferred until A+B prove insufficient.
- PBFT in `@claude-flow/swarm` is preserved as future federation
  infrastructure — marked internal, not deleted.

**Concrete per-class wire-up plan for orphaned `swarm/src/consensus/`** (per ADR-0111 §"Orphaned `swarm/src/` classes — per-class wire-up plan", corrected per memory `feedback-no-value-judgements-on-features.md` — "import ALL features"). Earlier draft said "don't wire intra-hive"; that was a value judgement to skip. **All 4 protocols wire** as backends in `mcp__ruflo__hive-mind_consensus` MCP handler:

- `consensus/index.ts` (`ConsensusEngine` factory) — wire as the dispatch layer. Replaces inline `switch (strategy)` with `ConsensusEngine.initialize({algorithm: strategy})`.
- `raft.ts` — wire as `strategy:'raft'` backend. Real term-based leader election + log replication. Annotation: `// Raft state is in-process per Queen session; cross-hive federation persistence is a separate enhancement.`
- `gossip.ts` — wire as `strategy:'gossip'` backend. Real epoch propagation. Annotation: `// Gossip epoch state per Queen session; cross-hive persistence is a federation enhancement.`
- `byzantine.ts` — wire as `strategy:'byzantine'` backend. Structural PBFT (vote-counting, equivocation detection across rounds, `requiredVotes = 2*f + 1`) is real value even with signatures unverified. Annotation: `// signatures field is structural-only; full PBFT identity verification is a separate feature gap (federation layer needs it). Wiring the protocol now means strategy='byzantine' produces real BFT-shape vote tallies; signature-verified adversarial guarantees come later.`

The "securely no-op" finding from §Investigation findings stays as a documented limitation in the code — but it's an annotation, not a gating policy. **Wiring `byzantine.ts` ships real PBFT vote-tallying today.** Adversarial signature verification is a separate feature to fill in later (when independent identity exists across federation boundaries) — not a reason to leave the protocol unwired.

**Cross-reference to ADR-0105 (Topology) — load-bearing for this ADR's Option A worker-absence retry**: ADR-0105's recommendation wires `TopologyManager` (per ADR-0111 §"Orphaned `swarm/src/` classes" disposition). The Queen's worker-absence-protocol (Option A's prompt-block addition) can then call `topology.electLeader()` to designate a replacement worker if the leader role-tagged worker is the absent one — matches TopologyManager's role-indexed map. Without TopologyManager, "designate a replacement" becomes Queen prose-judgment; with TopologyManager, it's a deterministic state operation. This ADR's Option A prompt block should reference `topology.electLeader()` semantics by name once ADR-0105 ships.

**Cross-reference to ADR-087 `graph-backend.ts`**: collaboration history (`getNeighbors` + `recordCollaboration`) lets the Queen's retry decision (Option A) read which workers have historically completed similar tasks successfully — informs which worker to re-spawn. Adopt on the upstream merge per ADR-0111.

Trust-model implication: the system provides **worker-unreliability
tolerance** (Queen detects and handles crashed/silent workers), not
**adversarial fault tolerance** (no guarantee against a lying
worker). README will say so. Adversarial guarantees, if ever
necessary, are a federated cross-hive ADR with signed-message
infrastructure (using `swarm/src/consensus/{raft,byzantine,gossip}.ts` as the implementation foundation, marked `@internal` until that scenario ships) — not a tweak to the current path.
