---
status: superseded
date: 2026-05-19
tags: [federation, sync-coordinator, merge, crdt]
supersedes: []
depends-on: [ADR-0201, ADR-0200]
implements: []
---

# Replace SyncCoordinator counting-stub merge with real merge

> **Superseded by [ADR-0217](./ADR-0217-implement-full-quic-synchronization-architecture.md).**
> This ADR's chosen Option A (row-level LWW on the existing schema) keyed
> conflict resolution on the autoincrement `id`, which is a *local* counter —
> peer A's `id=5` and peer B's `id=5` are different rows, so resolving "by id"
> resolves unrelated records. It is therefore unsound, and it deviates from the
> documented vector-clock + CRDT design (upstream `QUIC-ARCHITECTURE.md`)
> while *looking* like real conflict resolution.
>
> **Supersession rationale corrected (2026-05-20 second-pass swarm):** the
> original banner cited ADR-0217's *build-the-architecture* option
> (`(node_id, record_id)` identity, §3.4 matrix, "absorbed into Phases 2–3").
> ADR-0217 was reframed to **QUARANTINE** the dormant federation stack (no
> driver; defer multi-writer to a future evidenced product-bet ADR), so those
> clauses are stale. The supersession nonetheless **holds**, for two
> independently-sufficient reasons: **(1)** 0205's Option A is independently
> unsound — keying resolution on autoincrement `id` resolves unrelated rows
> across peers (verified `schema.sql:22/58/81` vs `SyncCoordinator.ts:739`),
> and even the one table with a natural key (`skills.name UNIQUE`) is keyed by
> `id`, not the natural key, so it converges nothing; **(2)** 0217 quarantine
> deletes/neutralizes `resolveConflicts` + `conflictStrategy`, and
> `resolveConflicts` is never even called (`pullChanges` never populates
> `conflicts`), behind an apply path that crashes on a phantom schema — so
> there is nothing for 0205's merge to fix. A revival probe (devil's advocate)
> confirmed reviving 0205 as a "cheap interim" is strictly worse than
> quarantine: unsound *and* solving a non-problem (zero concurrent-writer
> driver). 0205's one durable design point — `applyChanges` must consume the
> *resolved* set (not raw `pullResult.data`) — and the F-06-010 direction-only
> test gap are **preserved as requirements for ADR-0217's future
> product-bet reopen path**, NOT "absorbed into Phases 2–3" (which no longer
> exist under quarantine). Retained for reference; **do not implement as
> written, and do not revive.**

## Context and Problem Statement

ADR-0201's soundness audit, finding F-06-001 ([CRITICAL]) at
`forks/agentdb/src/controllers/SyncCoordinator.ts:679-705`, established
that `SyncCoordinator.resolveConflicts()` is a counting stub. All four
`conflictStrategy` branches just increment a counter or no-op. The
`merge` case is the literal comment `// Attempt to merge (simplified)`
followed by `resolved++`. None of the four branches ever writes back to
either `conflict.local` or `conflict.remote`, and the orchestrator at
line 160 calls `applyChanges(ctx, pullResult.data)` with the
**unmodified** `pullResult.data` — so the path from "conflict resolved"
to "what reaches the database" does not exist. ADR-0200's `pullOnly()`
inherits the same broken call (line 350).

Two further audit findings compound the problem:

* **F-06-002 [CRITICAL]**: The CRDT primitives (`G-Counter`, `LWW-Register`,
  `OR-Set` + `mergeGCounter` / `mergeLWWRegister` / `mergeORSet` /
  `incrementGCounter` / `updateLWWRegister` / `addToORSet` /
  `removeFromORSet`) defined and exported from
  `forks/agentdb/src/types/quic.ts:101-188` and `:566-702` have **zero
  callers in src/** outside their own definition file. The wire-type
  envelopes (`SkillSync`, `CausalEdgeSync`, `EpisodeSync`) declare CRDT
  shapes, but the runtime push/pull/apply path serialises raw SQL rows
  (`SELECT * FROM skills`) and applies them via `INSERT OR REPLACE`. The
  federation wire format announces CRDT semantics; the runtime does
  not honour them.

* **F-06-010 [WARNING]**: ADR-0200's `### Confirmation` section
  promised agentdb-side integration tests verifying `pushOnly()` does
  not call `pullChanges` and `pullOnly()` does not call `pushChanges`.
  Those tests do not exist (`grep -rln "pushOnly\|pullOnly"
  forks/agentdb/tests` is empty). Coverage is adapter-side only, in
  agentic-flow's `tests/unit/adr0200-adapter-push-pull-only.test.ts`.

Net consequence: federation **appears** to work — `push()` / `pull()` /
`sync()` return non-error reports with `itemsPushed` / `itemsPulled` /
`conflictsResolved` counts — but the counts are fiction and the
`applyChanges` step unconditionally overwrites local rows regardless
of the configured `conflictStrategy`. Two peers with diverging local
state silently overwrite each other on every sync. This is a
data-integrity boundary violation per [[feedback-no-fallbacks]] and a
documentation-drift defect against ADR-0196's claim of "CRDT-based"
synchronisation.

The question: how do we make merge actually merge?

## Decision Drivers

* **Data-integrity boundary** — federation must not silently lose data.
  Two peers updating the same skill's `successRate` should converge,
  not race.
* **No silent fallbacks** — per [[feedback-no-fallbacks]]. The current
  stub is the canonical silent-fallback anti-pattern: every branch
  reports success while doing nothing.
* **Existing CRDT investment** — `mergeGCounter` /
  `mergeLWWRegister` / `mergeORSet` already exist, are tested at the
  unit level inside `types/quic.ts`, and match the shapes declared on
  `SkillSync` / `CausalEdgeSync`. Reusing them is cheap; reinventing
  is expensive.
* **Wire-format compatibility** — the existing push/pull path emits
  raw SQL rows, not CRDT envelopes. A real merge needs either (a) a
  wire-format upgrade so CRDT fields cross the wire, or (b) merge
  semantics on top of raw-row payloads using timestamp/origin metadata
  that's already on the rows.
* **Backwards compatibility** — `sync()` semantics must not change
  for callers who don't care about strategy. The default `latest-wins`
  must continue to work without configuration.
* **Confirmation gap from ADR-0200** — the absent agentdb-side tests
  for direction-only flows must be added in this ADR's scope (they
  cover the same `resolveConflicts` call site that the merge work
  modifies).
* **Per-table semantics differ** — episodes are append-only (no
  meaningful merge beyond LWW); skills have G-Counter + LWW-Register
  + OR-Set fields that CRDT-merge correctly; causal edges have
  confidence/uplift LWW + experiment-id OR-Set semantics. A single
  merge function won't fit all three tables.

## Considered Options

* **Option A — Implement real merge using LWW-by-timestamp + tombstones
  on raw rows** — `resolveConflicts()` becomes a per-table dispatch:
  episodes use LWW on `ts`, skills use LWW on row `ts` (no CRDT field
  semantics), edges use LWW on `ts`. Tombstones added to handle
  deletes. Returns the resolved row set; `applyChanges` accepts the
  resolved set instead of `pullResult.data` raw. No wire-format
  change.

* **Option B — Defer merge; surface conflicts to caller via callback
  / event** — `resolveConflicts()` collects conflicts, emits them via
  a new `onConflict(conflict)` callback or `SyncCoordinator.events`
  emitter. Caller decides resolution. Default behaviour stays `INSERT
  OR REPLACE` (today's effective behaviour, but explicit). Documented
  as "conflict surfacing is caller's responsibility; SyncCoordinator
  does not resolve."

* **Option C — Bind merge to the CRDT primitives in `types/quic.ts`**
  — Upgrade the wire format from raw SQL rows to `SkillSync` /
  `CausalEdgeSync` / `EpisodeSync` envelopes so the CRDT fields
  (`uses: GCounter`, `successRate: LWWRegister<number>`,
  `sourceEpisodes: ORSet<number>`, etc.) cross the wire. Merge calls
  `mergeGCounter` / `mergeLWWRegister` / `mergeORSet` per field.
  ADR-0206 (companion) covers the wire-format upgrade plus
  `originInstallId` + `vectorClock` propagation through the SQL
  schema; this ADR consumes the upgraded primitives.

* **Option D — Mark federation as not-production-ready; emit warning
  on `sync()` invocation; defer real merge to a future ADR** — Status
  quo for `resolveConflicts`, plus a `console.warn` (or
  telemetry-event) on every `sync()` / `pushOnly()` / `pullOnly()`
  call disclosing that merge is non-functional and last-writer-wins
  via `INSERT OR REPLACE`. Buys time without changing behaviour.

## Decision Outcome

**Chosen: Option A — LWW-by-timestamp + tombstones on raw rows, with
per-table dispatch.**

Rationale:

* **Option C is the right destination but the wrong size for this
  ADR.** Wire-format upgrade (raw rows → CRDT envelopes) requires
  schema changes (`originInstallId`, `vectorClock`, `tombstone`
  columns), QUIC protocol-version bumps in `QUICServer` /
  `QUICClient`, and migration tooling for in-place databases. Per
  [[feedback-corpus-evidence-before-feature-work]], we should not
  ship CRDT envelopes for "react bug fix / ui regression"-style
  hypothetical convergence cases when the audit shows the actual gap
  is "writes overwrite each other" — which LWW resolves on day one.
  Option C is filed as the companion ADR-0206; this ADR's success
  unblocks it.

* **Option B (surface conflicts to caller) is a fallback-equivalent
  per [[feedback-no-fallbacks]] line "best-effort wrappers must
  re-throw fatals."** `SyncCoordinator` owns the data-integrity
  boundary; punting resolution upward means every caller has to
  rebuild conflict logic, and the default `INSERT OR REPLACE`
  behaviour stays silently lossy if the caller forgets to wire the
  callback. Surfacing conflicts as telemetry is *additionally*
  valuable, but it cannot be the resolution mechanism.

* **Option D (warn-and-defer) leaves a known-broken data path in
  production.** ADR-0196 ships
  `SyncCoordinatorFederatedAdapter` over `SyncCoordinator`; the
  adapter is the consumer that ADR-0196 used to justify shipping
  Phase 5 as `implemented`. A `console.warn` on every sync call
  contradicts that ADR's confirmation step. Acceptable as a
  temporary measure only if Option A is also blocked.

* **Option A's per-table dispatch matches the existing storage
  shape.** All three tables already carry `ts` columns
  (`episodes.ts`, `skills.ts`, `skill_edges.ts`), so LWW-by-timestamp
  is implementable without schema migration. Tombstones require one
  new column (`deleted_at INTEGER NULL` per table); migration is
  one `ALTER TABLE … ADD COLUMN`. The audit-finding fix lands inside
  `resolveConflicts()` + `applyChanges()` with the same MutationContext
  threading ADR-0180 already established.

### Supersession scope

Not a supersession. Companion to ADR-0200 (depended-on) and
ADR-0201 (audit source). This ADR extends the merge surface inside
the existing `resolveConflicts()` method; the public `sync()` /
`pushOnly()` / `pullOnly()` signatures from ADR-0200 remain
unchanged.

### Consequences

* Good, because `resolveConflicts()` finally honours its name —
  pulled rows that conflict with local rows are resolved per the
  configured strategy, and the resolved set is what reaches
  `applyChanges`.
* Good, because the `SyncReport.conflictsResolved` count becomes
  factual instead of fictional.
* Good, because data-integrity boundary holds — two peers with
  diverging local skill stats converge to the latest write per
  `(ts, nodeId)` tie-break (matching `mergeLWWRegister` semantics in
  `types/quic.ts:620-627`).
* Good, because adapter-side ADR-0196 `push()` / `pull()` start
  doing what their interface contract promises (matching the wave-2
  critique INFO finding's intent).
* Good, because the ADR-0200 confirmation gap (F-06-010) closes
  alongside the merge fix — same test file covers both invariants.
* Bad, because tombstones add one schema migration per affected
  table (3 migrations total: episodes, skills, skill_edges). Forward
  migration is `ALTER TABLE … ADD COLUMN deleted_at INTEGER`;
  backward migration is a `DROP COLUMN` (SQLite ≥3.35).
* Bad, because LWW-by-timestamp inherits wall-clock skew risk.
  Acceptable on single-host loopback (the only configuration today
  per ADR-0196 §runtime constraint); cross-host federation requires
  vector clocks (ADR-0206).
* Bad, because the four-strategy enum (`local-wins` / `remote-wins`
  / `latest-wins` / `merge`) becomes effectively three-strategy plus
  one wired-but-future-CRDT path. `merge` strategy in this ADR
  falls through to `latest-wins` until ADR-0206 wires the CRDT
  envelopes; explicitly documented at the strategy enum site.
* Neutral, because `sync()` callers without explicit strategy
  continue to get the default `latest-wins` behaviour, which now
  actually works instead of silently passing-through.

### Confirmation

Merge correctness is verified by a new integration test suite at
`forks/agentdb/tests/integration/sync-coordinator-merge.test.ts`
covering ALL of the following, against real `SyncCoordinator`
instances over two SQLite files on the same host (matching ADR-0196
§testability):

1. **`local-wins` actually keeps local** — Insert `{id:1, ts:100, value:'L'}` locally
   and `{id:1, ts:200, value:'R'}` remotely. Configure `local-wins`. Sync.
   Assert local row is `{id:1, ts:100, value:'L'}` post-apply.
2. **`remote-wins` actually keeps remote** — Mirror case. Assert local row
   is `{id:1, ts:200, value:'R'}` post-apply.
3. **`latest-wins` picks the latest by ts** — Verify both directions
   (local-newer-than-remote keeps local; remote-newer-than-local keeps
   remote). Tie-break: when `ts` equal, fall through to `nodeId`
   lexicographic order per `mergeLWWRegister` semantics in
   `types/quic.ts:610-614`.
4. **`merge` falls through to `latest-wins` and logs deferral** — Until
   ADR-0206 wires CRDT envelopes, `merge` strategy chooses the
   `latest-wins` resolution and emits a `mergeDeferred` telemetry event
   recording which fields would have CRDT-merged. Assert event fires.
5. **Tombstones propagate** — Delete `{id:1}` locally with
   `deleted_at: 150`. Remote has `{id:1, ts:100}`. Sync. Assert local
   row stays deleted; remote receives the tombstone on next pull.
6. **`conflictsResolved` count reflects reality** — Run a sync with N
   known conflicts. Assert `SyncReport.conflictsResolved === N` AND
   the actual row outcomes match expectations from cases 1-5. (Closes
   the "count is fiction" half of F-06-001.)
7. **`applyChanges` receives the resolved set, not raw pull data** —
   Spy on `applyChanges` invocation. Assert the `data` argument is
   the post-resolution row set, not `pullResult.data` verbatim.
   (Closes the "resolution never reaches DB" half of F-06-001.)
8. **`pushOnly()` does not call `pullChanges` and does not invoke
   `resolveConflicts`** — Spy on both. Assert zero calls during
   `pushOnly()`. (Closes F-06-010 on the push side; verifies merge
   wiring doesn't accidentally couple into the push-only path.)
9. **`pullOnly()` does not call `pushChanges` and DOES invoke
   `resolveConflicts`** — Spy on both. Assert `pushChanges` called
   zero times, `resolveConflicts` called once per conflicting row
   set. (Closes F-06-010 on the pull side.)

Additional confirmation steps:

* **Strategy-enum documentation** — `SyncOptions.conflictStrategy`
  TypeScript JSDoc updated to flag `merge` as "CRDT merge wired by
  ADR-0206; falls back to `latest-wins` until then." Without this
  comment the enum lies about its capability.
* **Acceptance gate** — `npm run release` continues to pass with
  the new integration tests included in the controller-stack
  acceptance group.
* **Adapter pass-through verification** — `forks/agentic-flow/.../tests/unit/adr0196-adapter.test.ts`
  receives a new case: configure adapter with `conflictStrategy:
  'latest-wins'`, drive a known conflict through the underlying
  `SyncCoordinator`, assert the adapter's `pull()` report carries
  factual `conflictsResolved` count.
* **Audit re-read** — F-06-001 entry in
  `docs/audits/2026-05-19-soundness-audit/06-controllers-graph-federation.md`
  updated post-implementation to mark the finding resolved with the
  commit SHA + test-file reference.

## Pros and Cons of the Options

### Option A — LWW-by-timestamp + tombstones (chosen)

* Good, because uses primitives the storage layer already has (`ts`
  on every row).
* Good, because per-table dispatch lets episodes/skills/edges have
  different semantics where they need to, without forcing a unified
  abstraction prematurely.
* Good, because tombstones close the silent-delete gap (today,
  deleted rows on one peer get re-inserted on next sync because
  there's no record of the deletion).
* Good, because incremental — ADR-0206 (CRDT wire envelopes) drops
  in as a `merge`-strategy upgrade without breaking the other three
  strategies.
* Bad, because wall-clock skew on cross-host setups (deferred to
  ADR-0206's vector-clock wiring).
* Bad, because three schema migrations needed (one `ALTER TABLE` per
  affected table).

### Option B — Surface conflicts to caller via callback

* Good, because keeps SyncCoordinator free of storage-semantic
  decisions.
* Good, because callers with domain knowledge (e.g. autopilot
  episodes vs skill stats) can resolve differently.
* Bad, because every caller has to wire the callback or accept
  silent lossy default. Violates
  [[feedback-best-effort-must-rethrow-fatals]] — the default path
  is exactly the silent-fallback anti-pattern.
* Bad, because `SyncReport.conflictsResolved` becomes
  caller-defined; report shape semantics drift.
* Bad, because the `ConflictResolutionStrategy` enum in
  `types/quic.ts:344` becomes dead — callers ignore strategy and
  bring their own. Documentation drift compounded.

### Option C — CRDT-envelope wire format

* Good, because the canonical destination. Convergence guarantees
  (G-Counter is grow-only, LWW-Register is monotonic-by-timestamp,
  OR-Set is observation-tagged) are mathematically rigorous.
* Good, because `mergeGCounter` / `mergeLWWRegister` / `mergeORSet`
  already exist and unit-test.
* Bad, because requires wire-format protocol-version bump in
  `QUICServer` / `QUICClient` request/response shapes — coupled
  fix not in this ADR's scope.
* Bad, because requires schema changes beyond tombstones —
  per-field `LWWRegister<T>` requires `value`, `timestamp`,
  `nodeId` columns per CRDT field (skills alone have 3+ such
  fields).
* Bad, because needs `originInstallId` and `vectorClock` populated
  on every row write — covered by ADR-0196 §1 (`originInstallId`)
  but `vectorClock` deferred per ADR-0196 §5. So Option C blocks
  on ADR-0196 §5 completion AND ADR-0206 wire-format ADR.
* Bad, because in-place database migration is non-trivial — old
  rows have no CRDT field decomposition; migration would have to
  synthesise initial states.

### Option D — Warn-and-defer

* Good, because zero implementation cost.
* Good, because surfaces the gap to operators who today see
  `success: true` and assume sync is real.
* Bad, because ADR-0196 closed Phase 5 as `implemented` based on
  the existence of the adapter; emitting a "not production ready"
  warning on every sync contradicts that closure.
* Bad, because the data-integrity boundary stays silently violated
  — warnings get filtered in production logs.
* Bad, because the audit's F-06-001 [CRITICAL] verdict stays open
  indefinitely. The audit's purpose (`ADR-0201`) was to surface
  exactly this kind of gap for resolution.

## More Information

* **Audit source**: [ADR-0201](./ADR-0201-codebase-soundness-completeness-audit-with-runtime-validation.md)
  §F-06-001, F-06-002, F-06-010 in
  `docs/audits/2026-05-19-soundness-audit/06-controllers-graph-federation.md`.
* **Public surface depended on**: [ADR-0200](./ADR-0200-synccoordinator-push-only-pull-only-public-surface.md)
  — `pushOnly()` / `pullOnly()` are the methods this ADR's merge
  fix slots underneath. Both inherit the new `resolveConflicts()`
  via the shared call site; tests cover both directions.
* **Federation interface consumer**: [ADR-0196](./ADR-0196-autopilot-learning-phase5-federated-interface.md)
  — the adapter ships against `SyncCoordinator.sync()`. The merge
  fix lands behind the adapter's `pull()` call site without
  interface change.
* **Future CRDT wiring**: ADR-0206 (companion, not yet filed) —
  wire-format upgrade from raw SQL rows to `SkillSync` /
  `CausalEdgeSync` / `EpisodeSync` envelopes; consumes the CRDT
  primitives in `types/quic.ts` that F-06-002 found unwired. This
  ADR's `merge` strategy is a placeholder that drops through to
  `latest-wins` until ADR-0206 wires it.
* **CRDT primitives** (exported from but currently uncalled
  outside `forks/agentdb/src/types/quic.ts`):
  * `mergeGCounter` — line 590
  * `mergeLWWRegister` — line 620
  * `mergeORSet` — line 677
  * `incrementGCounter` — line 573
  * `updateLWWRegister` — line 604
  * `addToORSet` — line 632
  * `removeFromORSet` — line 645
* **Internal method locations** in
  `forks/agentdb/src/controllers/SyncCoordinator.ts`:
  * `resolveConflicts()` — line 679 (the stub this ADR replaces)
  * `applyChanges()` — line 715 (changed to consume resolved set)
  * `sync()` call site — line 155
  * `pullOnly()` call site — line 350 (ADR-0200)
  * `pushOnly()` — line 227 (ADR-0200; not affected by merge)
* **Memory references shaping the decision**:
  * [[feedback-no-fallbacks]] — counting-stub merge is the
    canonical silent-fallback anti-pattern; default-pass branches
    that don't do the documented work.
  * [[feedback-best-effort-must-rethrow-fatals]] — Option B
    (caller callback) violates this when the default path is
    no-op.
  * [[feedback-corpus-evidence-before-feature-work]] — Option C
    is the canonical destination but the audit only surfaces the
    "writes overwrite" gap, not the "concurrent G-Counter
    increments" gap. Ship Option A first; revisit C when ADR-0206
    has actual cross-host convergence requirements.
  * [[project-rvf-primary]] — sync is a federation concern over
    agentdb's SQLite-backed sync tables; RVF primacy unaffected.

## Amendment — 2026-05-23 (Move A audit, supersession reconciliation)

Superseder ADR-0217 reached terminal status **`deferred`** on 2026-05-23 (Option C — quarantine + honesty; multi-writer build deferred to a future evidenced product-bet ADR). This ADR's `status: superseded by ADR-0217` is unchanged: deferred IS a valid terminal disposition for a superseder. The practical meaning is "the SyncCoordinator merge implementation chosen here is not the right shape; the larger multi-writer system is not being built now either."

The agentic-flow consumer at `agentdb-service.ts:877` (`ENABLE_QUIC_SYNC` env gate, off-by-default) and the `resolveConflicts` counting-stub at upstream `:478` remain as documented in ADR-0217. Quarantine actions (export retraction, CLI guard, dead-stub deletion, pool/stream-manager deletion + arch-test) are a follow-on slice owned by ADR-0217; this ADR carries no new code work.
