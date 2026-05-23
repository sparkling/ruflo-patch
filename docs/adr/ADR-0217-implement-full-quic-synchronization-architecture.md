---
status: proposed
date: 2026-05-20
tags: [federation, quic, crdt, vector-clock, sync, multi-writer, changelog, reconciliation, auth, phase5, swarm-reviewed]
supersedes: [0205, 0206]
depends-on: [0199, 0200, 0201]
implements: []
---

# QUIC federation: quarantine the dormant stack; defer multi-writer to an evidenced product bet

> **Reframed after a 6-expert swarm review (2026-05-20).**
> The original draft chose **Option A — implement the full multi-writer QUIC
> architecture in 5 phases**, justified as "implementing the canonical
> upstream design the runtime ignores," with urgency from a "live data-loss
> path ADR-0199 activated." A 6-expert adversarial swarm found every pillar
> of that case fails the pre-flight checks ([[feedback-remediation-adr-preflight]]):
>
> 1. **Upstream never built this and isn't behind on it (#2).** Upstream
>    `resolveConflicts` is the byte-identical counting stub; CRDT merge fns
>    are uncalled and `sync_changelog` is absent **in both repos**. The
>    whole stack was created in one upstream init commit and untouched for
>    ~7 months. `QUIC-ARCHITECTURE.md` is an *unstarted* 8-week roadmap
>    (unchecked boxes); upstream's README never advertises federation. It is
>    an aspirational proposal, not a design the runtime fell behind on.
> 2. **The urgency premise is false at runtime (#3).** The `ENABLE_QUIC_SYNC`
>    gate exists (`agentdb-service.ts:877`) but is **off by default, never
>    set by init/product, and has no automatic trigger** — sync fires only
>    when a user manually sets `ENABLE_QUIC_SYNC=true` + `QUIC_SERVER_HOST`
>    and invokes a `quic_sync_*` MCP tool or the `agentdb sync` CLI. The
>    product (`ruflo`) never constructs a sync; autopilot defaults to
>    `NoopFederatedSyncProvider` with the real adapter having **zero runtime
>    instantiation** (so even with QUIC on, autopilot doesn't feed it); and
>    the apply path is **already broken** (writes to `usage_count`/
>    `skill_edges`, which don't exist in the schema) so it has
>    never run end-to-end. Nothing bleeds today.
> 3. **No driver.** No install-id on disk, no second host, the phase-5
>    federation test is `.skip`/"NOT yet implemented." The capability is
>    exported and type-tested but **unused**. The draft cites
>    [[feedback-corpus-evidence-before-feature-work]] to defer Phase-5
>    hardening while exempting the very build that memory condemns.
> 4. **The "reuse the half-built runtime" premise is false.** The runtime
>    targets a *phantom schema* — Option A is closer to from-scratch than
>    represented (9 write-owning files, 3 schema sources, a migration
>    framework that doesn't exist).
>
> **Chosen now: Option C — quarantine the dormant federation stack and make
> the surface honest** (plus the cleanup half of Option B). Multi-writer
> collaborative learning is **deferred to a future explicit product-bet
> ADR**, gated on a real ≥2-install driver — *not* framed as "implementing
> upstream's design." The corrected Option-A blueprint is preserved below so
> the design work is not lost. Original Option A is retained under
> *Considered Options* with its full steelman.
>
> **Second-pass re-validation (2026-05-20).** Load-bearing facts re-confirmed
> at fork HEAD: `ENABLE_QUIC_SYNC` gate is exactly `process.env.ENABLE_QUIC_SYNC === 'true'`
> at `forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts:877` (off-by-default —
> the earlier false "doesn't exist" claim was a mis-scoped grep against `forks/agentdb`
> and a fish `--include` glob error; it DOES exist); `resolveConflicts` counting stub
> present (`agentdb/src/controllers/SyncCoordinator.ts:155,350`); phantom-schema writes
> (`usage_count`/`skill_edges`) referenced in `SyncCoordinator`/`QUICServer`/`db-unified`;
> `NoopFederatedSyncProvider` is the autopilot default (`autopilot-learning.ts`). 0205 +
> 0206 both `status: superseded by ADR-0217` with quarantine-corrected banners; 0217
> `supersedes: [0205, 0206]`. Quarantine reframe holds — no corrections.

## Context and Problem Statement

The 2026-05-19 soundness audit (ADR-0201, slice 06) surfaced three
federation findings — F-06-001 (`SyncCoordinator.resolveConflicts` is a
counting stub), F-06-002 (CRDT primitives in `types/quic.ts` have zero
runtime callers), F-06-003 (`QUICConnectionPool` / `QUICStreamManager`
unwired). ADR-0205 and ADR-0206 were filed to patch the first two. The
common root: **the federation runtime was never built to its own
architecture** — in the fork *or upstream*.

### How we got here (corrected by the swarm)

* The `SyncCoordinator` + `QUICServer` + CRDT stack was imported verbatim
  from upstream `ruvnet/agentdb` at the fork's initial commit (`8b3388b`)
  as a **reference skeleton**. `resolveConflicts` was a counting stub on
  day one; the stub is byte-identical to upstream's
  (`ruvnet/agentdb/src/controllers/SyncCoordinator.ts:478`).
* **Upstream authored a design doc and walked away.** The QUIC stack was
  created in a *single* upstream init commit; no commit in ~7 months across
  two repos ever gave the CRDT primitives a runtime caller. Upstream's
  v1.6.0 "Production Ready" notes (Oct 2025) self-describe QUIC as "Complete
  — Ready for v1.7.0"; v1.7.0 never shipped. `QUIC-ARCHITECTURE.md` ends in
  an 8-week roadmap whose final item is "Begin Phase 1 implementation." It
  is a *plan to build*, never started — not a spec the runtime betrayed.
* ADR-0196 (Phase 5) deferred the runtime **explicitly because no second
  host exists to test against** and no transport binding was chosen — a
  considered deferral, not an oversight. It shipped the interface adapter +
  origin stamping only.
* ADR-0199 wired a real transport (WebTransport + HTTP/2). The draft framed
  this as "activating a live data-loss path." The swarm found this
  **overstated**: the path is reachable only by a manual two-host
  `agentdb sync` CLI invocation; it is unwired into the product and the
  apply path is itself broken (below).
* ADR-0201's audit was the first end-to-end trace finding `resolveConflicts`
  dead.

### What the fork actually has (and what's dormant)

| Architecture element | Fork state |
|---|---|
| Transport (WebTransport + HTTP/2) | **Done** (ADR-0199), real loopback bind |
| `pushOnly()` / `pullOnly()` surface | **Done** (ADR-0200) — but **zero runtime instantiation** (manual CLI + skipped tests only) |
| Design types (`VectorClock`/`GCounter`/`LWWRegister`/`ORSet`/envelopes/`JWTClaims`/merge fns) | **Ported** to `types/quic.ts`, **zero runtime callers** in fork *and upstream* (F-06-002) |
| Episode origin stamping (`originInstallId`) | **Partial** — stamped on the object, lost at the SQL boundary (no column) |
| `sync_changelog` table | **Missing in fork and upstream** |
| `node_id` / `vector_clock` columns | **Missing** |
| Conflict detection / resolution runtime | **Missing** — `resolveConflicts` is a counting stub; `pullChanges` never populates `conflicts`, so it is never even invoked |
| `applyChanges` | **Broken** — unconditional `INSERT OR REPLACE` against a *phantom schema* (`usage_count`/`skill_edges` don't exist; omits `signature NOT NULL`) — has never executed end-to-end |
| JWT / mTLS auth | **Missing** — `authenticate()` is `authToken === config.authToken` |

The current sync also keys on `id INTEGER PRIMARY KEY AUTOINCREMENT` — a
local counter that collides across peers. The identity model
(`(node_id, record_id)`) was never carried into the row schema.

### Reachability: dormant, not live

The "live data-loss" framing is **materially overstated** (verified):

* `ENABLE_QUIC_SYNC` exists (`forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts:877`) but is **off by default and never set by init or any product code** — a user must hand-set `ENABLE_QUIC_SYNC=true` + `QUIC_SERVER_HOST`. There is **no automatic/periodic trigger**.
* The only `new SyncCoordinator` callers are `agentdb sync push/pull`
  (manual CLI, user must supply `--server host:port`) + an example file.
* The product (`ruflo`) has **zero** runtime references to
  `SyncCoordinator`/`QUICClient`/`QUICServer`.
* Autopilot defaults to `NoopFederatedSyncProvider`; the real
  `SyncCoordinatorFederatedAdapter` is instantiated only in tests.
* `applyChanges` is already broken against the real schema, so the path has
  never run cleanly even via the CLI.

So this is a **quarantine/honesty problem on a dormant unsound feature**,
not an active-bleed emergency.

### The question

ADR-0205 (raw-row LWW) and ADR-0206 (wire-or-remove) each addressed a slice.
The real question: **do we build the documented multi-writer architecture,
make it an honest single-writer mirror, or quarantine the dormant stack and
defer the build until a real driver appears?**

## Decision Drivers

* **Premise true at runtime** ([[feedback-remediation-adr-preflight]] #3) —
  the `ENABLE_QUIC_SYNC` gate exists but is off-by-default, never set by
  init, never auto-triggered, and fed by a Noop in the autopilot path, so
  there is no *live* data-loss path; the urgency that biased the draft
  toward a build is absent.
* **No evidenced driver** ([[feedback-corpus-evidence-before-feature-work]])
  — no second install, no install-id, no consumer of multi-writer merge.
  "Exported capability ≠ used capability." Building the fork's largest-ever
  feature for a driver-less capability is the exact anti-pattern. **This is
  principled, not convenient:** ADR-0187 (`implemented`) *declined* upstream's
  WireGuard mesh federation ("no fork consumer has asked"); ADR-0196
  deliberately deferred the phase-5 runtime (no second host); ADR-0222 (this
  batch) *deletes* a dead federation module. The fork's consistent posture is
  declining/removing federation — not deferring a wanted feature.
* **Re-converge with upstream, don't diverge** (#2) — upstream shipped this
  as design-only and never built it. A fork-only full build is maximal
  divergence + a perpetual maintenance tax with no donate-back outlet
  ([[feedback-no-upstream-donate-backs]]) and a permanent JSON-vs-protobuf
  wire fork.
* **Honesty over a label** ([[feedback-no-fallbacks]]) — the surface
  advertises CRDT/vector-clock convergence (exported types, `conflictStrategy`
  enum, docstrings) the runtime does not deliver. Quarantine must *retract
  the advertisement*, not just disable a flag.
* **Reversibility** — quarantine keeps the paid-for transport (0199),
  surface (0200), and ported types for the day a real driver appears, and is
  reversible at Phase 0 — before any schema migration locks it in.
* **Proportionality vs the batch** — 0202 (the RVF lock) is a *live*
  CRITICAL data-loss bug; the fork's largest-ever effort should not go to a
  driver-less feature ahead of it.

## Considered Options

* **Option A — Implement the full architecture (5 phases). ORIGINAL DRAFT,
  REJECTED.** Build changelog, `(node_id,id)` identity, vector-clock LWW +
  CRDT + OT resolution, incremental + Merkle reconciliation, JWT/mTLS.
  Rejected: upstream abandoned it, no driver, false urgency premise, and the
  runtime targets a phantom schema (closer to from-scratch than "wire the
  half-built thing"). Full steelman + corrected blueprint retained below.
* **Option B — Honest single-writer mirror.** Make `INSERT OR REPLACE`
  semantically a documented mirror, delete the convergence machinery,
  retract the CRDT types. Sound, but still implies the mirror is a *used*
  capability — and pushOnly/pullOnly also has zero runtime instantiation.
* **Option C — Quarantine + honesty (chosen).** Mark federation
  experimental/dormant, retract the convergence advertisement, neutralize
  the dead/broken runtime, carry ADR-0206's pool/stream deletion, and defer
  the multi-writer build to a future evidenced product-bet ADR. Closest to
  upstream's own deliberate posture.
* **Option D — Raw-row LWW shortcut (ADR-0205 Option A).** Rejected as
  unsound (keys on autoincrement `id`).

## Decision Outcome

**Chosen: Option C — quarantine the dormant federation stack and make the
surface honest, folding in the cleanup half of Option B. Defer multi-writer
collaborative learning to a future explicit product-bet ADR.**

The data-integrity concern is real but **dormant** (no live path, no
driver). The proportionate response to a dormant unsound feature that
upstream itself never built is to stop the surface lying and remove the
landmine — not to build the largest feature in the fork's history for a
hypothetical user.

### Quarantine + honesty actions

1. **Retract the convergence advertisement** (closes F-06-002 by honesty,
   not by either deletion or use). **Carve-out (2026-05-22 re-validation):
   the vector-clock family is a LIVE agentic-flow consumer** —
   `autopilot-learning.ts:42-43` imports `VectorClock`/`incrementVectorClock`/
   `createVectorClock` from `'agentdb'` and calls `incrementVectorClock` on
   the `_record` episode-write path (`:1083`); `src/index.ts:178-194`
   re-exports them deliberately (with a comment). They **must NOT** be
   removed from the export surface — that breaks the agentic-flow build at
   the next publish. So F-06-002's "zero runtime callers" is only true for
   the *merge-CRDT* fns, not the vector-clock family.
   * **Mark `@internal` + add a JSDoc "single-writer / experimental;
     conflict resolution NOT implemented" docstring** on the vector-clock
     family, `SyncCoordinator`, and `types/quic.ts`. The fork has no
     `stripInternal`/api-extractor, so `@internal` strips nothing — **the
     JSDoc docstring is the load-bearing honesty signal**, not the annotation.
   * The genuinely-dead exports (zero consumers) **may be removed** from
     `src/index.ts`: `VectorClockComparison`, `SyncMessage`, `SyncPayload`,
     `EpisodeSync`, `SyncableEpisode`, `compareVectorClocks`,
     `mergeVectorClocks`. (The `mergeGCounter`/`mergeLWWRegister`/`mergeORSet`/
     `isAuthorized`/`isJWTExpired` the original draft named to remove are
     **not in `index.ts`** — they live only in `types/quic.ts`, already
     non-public; no export action needed for them.)
   * **Scope note:** `controllers/index.ts` re-exports `QUICServer`/
     `QUICClient`/`SyncCoordinator` (classes), kept public by
     `src/index.ts`'s `export *`. The docstring on `SyncCoordinator` is the
     honesty signal for those; `@internal` them too only if the publish
     surface must visibly shrink.
2. **Neutralize the dead/broken runtime** (closes F-06-001 honestly).
   **Sequence matters:** the `conflictStrategy` enum is threaded through 4
   sites (`SyncCoordinatorConfig`, the CLI `--conflict-strategy` parser,
   `quicPull`/`quicSync` params, the example), so this is a coordinated edit,
   not a one-line delete.
   * **First**, make the `agentdb sync push/pull` CLI **fail loud** with an
     "experimental — single-writer only, may overwrite peer data; not for
     production" guard, OR disable the subcommand until a real build lands —
     which makes the `--conflict-strategy` flag unreachable. (It is already
     broken against the schema; do not leave a path that silently
     `INSERT OR REPLACE`s on a phantom schema.)
   * **Then** delete (or clearly mark non-functional) the `resolveConflicts`
     counting stub and the now-unreachable `conflictStrategy` enum across all
     4 sites — it selects nothing real.
3. **Carry ADR-0206's deletion forward (now vindicated):** delete
   `QUICConnectionPool.ts` + `QUICStreamManager.ts` + tests (F-06-003);
   add the arch-test forbidding their re-import. No driver justifies them.
   Re-validation confirmed this deletion is **fully safe** — zero external
   importers, not in the `controllers/index.ts` barrel, `QUICServer`/
   `QUICClient` import only `QUICConnection` (kept). The arch-test is
   **net-new** (the fork has no forbidden-import/arch-fitness pattern to
   model on — `api-compat.test.ts` is a runtime-shape guard, not a static
   import-graph test); build it as a source-scan test.
   * **Out of scope (flagged):** `agentic-flow/src/federation/FederationHub*`
     is a *separate* WebSocket federation stack (its own vector clocks; does
     not import agentdb's `VectorClock`; ADR-0069 lineage). Quarantining the
     agentdb QUIC stack does not touch it; a `FederationHub` disposition is a
     distinct decision, not part of this ADR.
4. **Keep the building blocks** — ADR-0199 transport, ADR-0200 surface,
   the ported `types/quic.ts` (marked internal) — preserved for a future
   build; they are paid-for and harmless when not advertised.
5. **Honest federation surface docs:** the README/feature docs (if any
   mention federation) describe it as experimental/dormant, matching
   upstream's own posture.

### Deferral: multi-writer as a future evidenced product bet

Multi-writer collaborative learning is **not built now**. It reopens **only**
as an explicit fork *product decision* (ADR), gated on:

* a real ≥2-install driver (an actual second federated deployment, or a
  committed product roadmap item — not an ADR illustration), AND
* the corrected scope below (the original draft's plan understated it).

It must **not** be reopened as "implement upstream's canonical design" —
upstream never implemented, advertised, or committed to it.

**Open item for the product owner (the one thing code cannot settle):**
whether collaborative cross-install learning is a committed product goal is
the *sole* condition that flips this ADR to a build (Option A). No such
commitment was found in the repo, roadmap, ADRs, or upstream — and
ADR-0187/0196/0222 point the other way. Absent an out-of-band product
decision, the evidence-based default is quarantine; this is a queen/user
escalation, not a code finding.

### Corrected Option-A blueprint (preserved for the future product-bet ADR — NOT being built now)

If/when a driver justifies the build, the swarm's corrections to the
original phased plan must be folded in:

* **Fix the phantom schema FIRST.** `applyChanges`/`detectChanges` target
  `skill_edges` (real table: `skill_links`, different columns),
  `skills.usage_count` (real column: `uses`), `skills.ts` (real:
  `updated_at`), and omit `signature NOT NULL`. The runtime has never
  executed; this is foundational, not incidental.
* **Three schema sources, not one.** Federated tables span `schema.sql`,
  `frontier-schema.sql`, and runtime `CREATE` in `agentdb-mcp-server.ts`.
  Column additions + changelog must land consistently across all three.
* **Nine write-owning files, not three controllers.** Changelog hooks are
  needed in `ReflexionMemory`, `SkillLibrary`, `CausalMemoryGraph`, **plus**
  `agentdb-mcp-server.ts`, `BatchOperations.ts` (batch-delete), and
  `agentdb-cli.ts` (~27 INSERT/UPDATE/DELETE sites).
* **No migration framework exists.** `migrate.ts` is a legacy v1→v2 corpus
  migrator, not a schema forward-migration tool; in-place column additions
  need new machinery.
* **`getLocalInstallId()` does not exist in agentdb** — net-new cross-fork
  plumbing, not a "thread it through."
* **Identity model is per-table and under-specified.** `(node_id, id)` with
  autoincrement `id` does **not** converge episodes (same logical episode →
  two distinct rows forever); it only avoids clobbering. Skills converge via
  natural key `name UNIQUE`; edges via `(from_skill, to_skill)`. The
  "convergence" claim must be restated honestly per data type.
* **§3.4 matrix is only 4/6 mapped** — causal-edge OT is silently replaced
  by OR-Set; experiments sync is dropped. Either implement or explicitly
  scope out.
* **Topology contradiction:** the draft builds mesh-cost machinery while
  deferring mesh topology; upstream *recommends* hub-and-spoke (simpler,
  authoritative-server). Pick the topology before paying for its cost.
* **Wire format:** JSON-over-frames diverges permanently from upstream's
  protobuf (§2.2) if upstream ever revives the design.
* **Delete-propagation vs pruning:** changelog DELETE ops resurrect rows if
  the changelog is pruned (30 days) before a long-offline peer syncs;
  reconcile retention vs delete durability (ADR-0205's tombstone concern).
* **Single-host test harness already exists** (the one fully-borne-out
  feasibility claim) — `tests/integration/quic-transport.test.ts` binds
  real loopback sockets; convergence tests extend it.

### Supersession scope

* **ADR-0205** (raw-row LWW) — **reversed** (unsound autoincrement-id
  identity). Its durable point (`applyChanges` must consume the *resolved*
  set, not raw `pullResult.data`) and the F-06-010 direction-only test gap
  are preserved as requirements for the future product-bet ADR.
* **ADR-0206** (wire-or-remove CRDT + delete pool/stream-manager) — its
  **REMOVE branch is now vindicated**: with no driver, this ADR resolves
  toward remove/quarantine, not "wire it all." The pool/stream-manager
  deletion lands here (action 3); the "keep CRDT primitives" disposition
  becomes "keep but mark internal/unwired" (action 1).

Unchanged and depended-on: ADR-0199 (transport), ADR-0200 (surface),
ADR-0196 §1 (origin stamping) — all retained, none consumed by a live sync.

### Consequences

* Good, because the surface stops advertising convergence it doesn't
  deliver — F-06-001/002/003 close by honesty + deletion, the data-integrity
  boundary holds (a dormant resolver that can't run can't lose data).
* Good, because it matches upstream's deliberate posture and avoids the
  largest fork-only divergence in the repo's history.
* Good, because the paid-for transport/surface/types survive for a future
  driver; the decision is reversible at Phase 0.
* Good, because effort is freed for the live CRITICAL (0202) rather than a
  driver-less feature.
* Bad, because "experimental/quarantined" surfaces can rot if not revisited
  — mitigated by the explicit reopen criteria (a real driver).
* Bad, because it defers collaborative learning indefinitely. Honest
  counter: you cannot defer a capability that has never functioned and has
  no consumer.
* Neutral, because single-install (non-federated) behaviour is entirely
  unchanged.

### Confirmation

* The dead CRDT/sync-message exports (`compareVectorClocks`/`mergeVectorClocks`/
  `VectorClockComparison`/`SyncMessage`/`SyncPayload`/`EpisodeSync`/
  `SyncableEpisode`) are removed from `src/index.ts`; the live vector-clock
  family (`VectorClock`/`incrementVectorClock`/`createVectorClock`, consumed
  by agentic-flow autopilot) is marked `@internal` with an experimental
  docstring and **retained** — a "grep public API empty" check does NOT apply
  to these (removing them breaks the agentic-flow build).
* `resolveConflicts` + `conflictStrategy` are deleted or marked
  non-functional; no code selects a strategy.
* `agentdb sync push/pull` either errors with an explicit experimental/
  data-loss guard or is disabled; it can no longer silently
  `INSERT OR REPLACE` on a phantom schema.
* `QUICConnectionPool.ts` / `QUICStreamManager.ts` are deleted; an arch-test
  forbids re-import (F-06-003).
* Docstrings on `types/quic.ts` + `SyncCoordinator` state single-writer /
  experimental.
* Audit re-run (slice 06): F-06-001/002/003 resolved by honesty+deletion;
  F-06-010 noted as deferred-with-the-build.
* `npm run release` green; single-install behaviour unchanged.
* A reopen criterion is recorded: multi-writer returns only via a product-bet
  ADR with a real ≥2-install driver and the corrected scope above.

## Pros and Cons of the Options

### Option C — Quarantine + honesty (chosen)

* Good, because proportionate to a dormant, driver-less, unsound feature.
* Good, because it converges with upstream's posture and minimises
  divergence.
* Good, because reversible and preserves the building blocks.
* Bad, because it leaves a labelled-experimental surface that must be
  revisited if a driver appears.

### Option A — Implement the full architecture (rejected)

Retained with its full steelman because the *design analysis* is valuable
and the option reopens if a real driver materialises.

* Good, because it would deliver genuine multi-writer collaborative learning
  — merging independently-learned skill stats across installs, which a mirror
  (B) cannot do. If that is a committed product goal, B/C discard a real
  feature.
* Good, because the type layer is faithfully ported + unit-tested, and the
  transport (0199) + surface (0200) are wired — real reusable blocks.
* Good, because the phased plan has falsifiable gates (convergence
  integration test, identity-collision test, delete-propagation test, audit
  re-run grep) and the single-host harness already exists.
* Bad (decisive), because **upstream never built it and isn't behind on it**
  — fork-only construction is maximal divergence + perpetual merge tax for a
  capability upstream shipped as design-only and never advertised.
* Bad, because **there is no driver** — no second install, no install-id, no
  consumer; the phase-5 federation test is `.skip`/"NOT yet implemented."
  The ADR cites the anti-speculation memory then exempts its own build.
* Bad, because the **urgency premise is false** — `ENABLE_QUIC_SYNC` exists
  but is off-by-default/never-set/no-auto-trigger; the path is dormant
  manual-opt-in only and the autopilot path is Noop-fed; `applyChanges` is
  already broken, so there is no live silent-fallback firing.
* Bad, because **"reuse the half-built runtime" is false** — the runtime
  targets a phantom schema; the real scope is 9 files / 3 schema sources /
  a missing migration framework / nonexistent `getLocalInstallId()` — closer
  to from-scratch.
* Bad, because the identity model doesn't converge episodes; the §3.4 matrix
  is 4/6 mapped; the topology that justifies the CRDT cost is deferred; the
  wire format diverges permanently from upstream protobuf.
* Bad, because it is the largest effort in the fork's history, ahead of the
  live CRITICAL 0202.

### Option B — Honest single-writer mirror (not chosen; cleanup actions folded into C)

* Good, because small and truthful; converges toward upstream's actual
  shipped behaviour (which *is* an `INSERT OR REPLACE` mirror).
* Bad, because it implies the mirror is a *used* capability — but
  pushOnly/pullOnly has zero runtime instantiation too, so "build a correct
  mirror" is also partly speculative. C's quarantine is the more honest
  posture given no driver. (B's honesty actions — retract types, delete the
  dead resolver, fix docstrings — are adopted *into* C.)
* **On delete-vs-keep (the asymmetry vs ADR-0222, which deletes dead
  federation code):** the split is decided by *live-consumer-ness*, not
  philosophy. C *does* delete the fully-dead parts (pool/stream-manager; the
  zero-consumer exports), matching 0222/0203's delete-when-dead posture. It
  keeps the vector-clock family (`@internal` + docstring) **only** because
  agentic-flow's autopilot is a live consumer that cannot be deleted without
  breaking the build. So C is not "softer than 0222" — it deletes everything
  with no consumer and keeps only what a live caller forces.

### Option D — Raw-row LWW shortcut (rejected)

* Bad, because unsound — keys conflict resolution on autoincrement `id`,
  which collides across peers.

## Swarm review evidence

Reviewed 2026-05-20 by a 6-expert adversarial swarm (queen + domain
architect + runtime/feasibility + code archaeologist + upstream analyst +
devil's advocate), applying [[feedback-remediation-adr-preflight]].

* **Upstream is an abandoned skeleton (#2).** Upstream `resolveConflicts`
  (`ruvnet/agentdb/src/controllers/SyncCoordinator.ts:478`) = byte-identical
  counting stub; CRDT fns uncalled; `sync_changelog` absent in both repos.
  Standalone `ruvnet/agentdb` = 7 commits, QUIC stack created in one
  (`8b3388b`), dormant. Origin `ruvnet/agentic-flow`: stub present since
  v1.6.0 "Production Ready" (Oct 2025); no commit ever wired the CRDT
  runtime. `QUIC-ARCHITECTURE.md` §7 = unstarted 8-week roadmap; README
  never advertises agentdb federation. The QUIC/federation issues that DO
  exist are upstream's own roadmap tickets for the **transport** layer + a
  WebSocket agent-coordination Federation Hub — a different layer, mostly
  maintainer-authored; demand for agentdb's CRDT multi-writer data-sync
  specifically is **zero**.
* **Premise false at runtime (#3).** The `ENABLE_QUIC_SYNC` gate exists
  (`agentdb-service.ts:877`) but is off-by-default, never set by init, and
  has no automatic trigger; only `new SyncCoordinator` callers are the
  manual `agentdb sync` CLI + the `quic_sync_*` MCP tools + an example;
  product never constructs a sync; autopilot defaults to Noop with the real
  adapter never instantiated; `applyChanges` writes `usage_count`/
  `skill_edges` that don't exist (phantom schema) → never run end-to-end. No
  live data loss. (Correction: the original swarm pass said the flag "does
  not exist" — that was a mis-scoped grep; the flag is real but unused.)
* **No driver.** No install-id on disk; `originInstallId` only in test
  fixtures; phase-5 federation convergence test is `.skip`/"NOT yet
  implemented." Exported ≠ used.
* **Anti-speculation applied inconsistently.** The draft cites
  [[feedback-corpus-evidence-before-feature-work]] only to defer Phase-5;
  the same memory downgraded ADR-0194 to `evidence-deferred` and led
  ADR-0205 to reject this exact full build. By that threshold the
  multi-writer driver is at 0%.
* **Phantom schema + blast radius.** Runtime targets `skill_edges`/
  `usage_count`/`skills.ts` that don't exist; real scope = 9 write-owning
  files, 3 schema sources, no forward-migration framework, nonexistent
  `getLocalInstallId()`.
* **Identity doesn't converge episodes.** `(node_id, id)` with autoincrement
  `id` = two distinct rows per logical episode forever; the ADR conflated
  "doesn't clobber" with "converges."
* **Reversibility is Phase-0-only** — after Phase-1 hot-table migrations +
  changelog hooks, reverting is another migration, not a code delete.
* **Preserved counter (the one thing that flips this):** if collaborative
  cross-install learning is a *committed product goal* held out-of-band,
  Option A's phased/reversible approach is defensible and "no driver"
  becomes "no driver yet." Absent that commitment, the evidence says
  quarantine. This is why C records an explicit reopen criterion rather than
  deleting the design.

### Second council re-validation (2026-05-22)

Re-reviewed by a second 6-expert dialectic council (S4 Round 1: queen-led,
shared-memory; devil cast as the *build-opponent*). **Verdict: 6×
accept-with-edits, 0 needs-rework — the build→quarantine reversal (Option C)
stands and is *better*-corroborated than the ADR stated.** No Round 2 was
needed: Round 1 + queen verification resolved both the build-vs-quarantine
question and the delete-vs-keep tension. But the second-pass note above
("Quarantine reframe holds — no corrections") did **not** survive — this pass
found a real implementation-safety bug. Corrections folded in:

* **Action 1 export-retraction was a build-breaking bug (the headline).**
  Two lenses independently caught it, and I verified it: the vector-clock
  family `VectorClock`/`incrementVectorClock`/`createVectorClock` is a **live
  agentic-flow consumer** (`autopilot-learning.ts:42-43` → `incrementVectorClock`
  on the `_record` path; `index.ts:178-194` re-exports them deliberately).
  "Remove from the public export surface" + the F-06-002 "zero runtime callers"
  + the Confirmation "grep public API empty" would all break the agentic-flow
  build. Fixed: `@internal` + JSDoc the live family, remove only the
  zero-consumer exports. The merge-fns/auth symbols the draft named to remove
  (`mergeGCounter`/`mergeLWWRegister`/`mergeORSet`/`isAuthorized`/`isJWTExpired`)
  are **phantom** — not in `index.ts` at all. Also: `@internal` is doc-only
  (no `stripInternal`), so the **JSDoc docstring is the load-bearing honesty
  signal**, not the annotation.
* **The C-vs-B / ADR-0222 asymmetry (devil's strongest objection) resolved
  empirically.** 0222 deletes dead federation code; 0217 keeps types
  `@internal`. The split is decided by *live-consumer-ness*, not philosophy:
  C deletes everything with no consumer (pool/stream-manager — verified
  fully safe; the zero-consumer exports), and keeps the vector-clock family
  only because a live caller forbids deletion. Stated in the Option B section.
* **"No driver" is principled, not convenient** — cited ADR-0187 (declined
  upstream mesh), ADR-0196 (deliberate deferral), ADR-0222 (deletes a
  federation module): a consistent fork posture of declining/removing
  federation. The ADR previously omitted this corroboration.
* **The product-goal crux is escalated as an explicit open item** for the
  product owner — the sole condition (a committed multi-writer goal) that
  flips C→A, found nowhere in repo/roadmap/ADRs/upstream and contradicted by
  0187/0196/0222. Code cannot settle it.
* **"Zero demand" tightened** — upstream *did* invest in QUIC **transport** (a
  Rust crate) + a WebSocket Federation Hub, but never the agentdb CRDT
  episode-merge layer this ADR governs; demand for *that* layer is zero. The
  earlier flat "zero demand for QUIC/federation" was refutable by a 10-second
  issue search.
* **Buildability:** action 2 sequenced (guard the sync CLI first → makes
  `conflictStrategy` unreachable → then drop the enum across its 4 sites);
  action 3's arch-test flagged net-new (no forbidden-import pattern to model
  on); scope-noted the still-public `controllers/index.ts` classes and the
  separate `agentic-flow/src/federation/FederationHub` stack (ADR-0069),
  which this ADR does not touch.
* **Minor:** the `implement-full-quic` filename slug is stale (decision is
  quarantine) — left as-is (renaming breaks `supersedes`/`depends-on` graph
  refs + the AgentDB `file:` path, same call as 0215's slug); `resolveConflicts`
  is def `:679` (fork) / `:478` (upstream, byte-identical) with callers
  `:155/:350`; "~27 sites" = mutation call-sites; deferred-blueprint edge key
  is `(parent_skill_id, child_skill_id, relationship)`.

**Held under re-check:** the quarantine decision; every dormancy / phantom-schema
(`uses` not `usage_count`, `skill_links` not `skill_edges`, `signature NOT NULL`
omitted) / build-scope (`getLocalInstallId` absent, no migration framework)
premise; "upstream abandoned the agentdb CRDT layer" (#2 — the transport/hub
investment is a *different* layer, and revival risk cuts *toward* quarantine);
the wholesale supersession of 0205/0206 (both carry `superseded by ADR-0217`,
additive carry-forward); MADR structure (`### Consequences` nested, preserved
blueprint unambiguously fenced "NOT being built now"); action 3 deletion
verified orphan-free. State: quarantine code-work is 0% done in the fork (clean
slate, not stale).

## More Information

* **Canonical design (aspirational, unbuilt upstream):**
  `ruvnet/agentdb/docs/quic/QUIC-ARCHITECTURE.md` — §3.4 conflict matrix,
  §5 sync strategies, §7 unstarted roadmap. Preserved as the blueprint for a
  future product-bet ADR, with the swarm's corrections above.
* **Audit source:** ADR-0201 slice 06
  (`docs/audits/2026-05-19-soundness-audit/06-controllers-graph-federation.md`)
  — F-06-001/002/003/010. The audit's own disposition was "decide which:
  delete or wire" — never "build the full architecture."
* **Superseded:** ADR-0205 (reversed, unsound); ADR-0206 (REMOVE branch
  vindicated — this ADR implements its delete + mark-internal dispositions).
* **Building blocks retained (not consumed):** ADR-0199 (transport),
  ADR-0200 (surface), ADR-0196 §1 (origin stamping).
* **Key runtime sites:** `forks/agentdb/src/controllers/SyncCoordinator.ts`
  (`resolveConflicts` 679 stub, `pullChanges` 573 never sets `conflicts`,
  `applyChanges` 715 phantom-schema INSERTs), `QUICServer.ts` (`authenticate`
  251 string compare), `src/schemas/schema.sql` (no `node_id`/`vector_clock`/
  `sync_changelog`; `skills.uses` not `usage_count`; `skill_links` not
  `skill_edges`), `src/index.ts` (CRDT type re-exports to retract),
  `agentic-flow/src/coordination/autopilot-learning.ts:365` (Noop default).
* **Memory references:**
  * [[feedback-remediation-adr-preflight]] — #2 (upstream abandoned) + #3
    (premise false at runtime) both fired.
  * [[feedback-corpus-evidence-before-feature-work]] — no driver; the build
    is the speculative feature, not just Phase-5 hardening.
  * [[feedback-no-fallbacks]] — the fix is to retract the lying surface, not
    to build a runtime to back a dormant claim.
  * [[feedback-no-upstream-donate-backs]] — a fork-only build has no
    convergence outlet; the JSON-vs-protobuf wire diverges permanently.
  * [[project-rvf-primary]] — sync operates over agentdb's SQLite sync
    tables; RVF primacy unaffected.
