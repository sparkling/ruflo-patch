---
status: accepted
completed: true
date: 2026-05-19
accepted: 2026-05-19
implemented: 2026-05-19
methodology: [MADR]
decision-makers: [Henrik Pettersen]
tags: [autopilot, learning, federated, quic, crdt, phase5, ADR-0193, ADR-059]
related: [0192, 0193, 0194, 0195]
upstream-related: [agentic-flow/ADR-059]
audience: ai-executor
---

> **Implementation note (2026-05-19):** Runtime is wired — `FederatedSyncProvider`
> interface + `NoopFederatedSyncProvider` default + `SyncCoordinatorFederatedAdapter`
> shipped in `forks/agentic-flow/agentic-flow/src/services/`. `AutopilotLearning`
> constructor accepts an optional provider arg; `_record` populates
> `originInstallId` + `vectorClock` on every episode write and calls
> `provider.notifyEpisode` (errors propagate per `feedback-no-fallbacks`).
> **Transport selection is deferred to a future ADR** (pick a QUIC binding —
> `node:quic` vs `@fails-components/webtransport` vs HTTP/2 fallback — and wire
> the socket bind in `QUICServer.start()` / connect in `QUICClient.connect()`).
> Closure criterion #3 (federation-runtime ADR `proposed`/`accepted`) remains
> open; status flips to `implemented` here because the interface + adapter
> landed and ADR-0196's scope was explicitly "interface + adapter, runtime
> deferred."

# ADR-0196: AutopilotLearning Phase 5 — federated learning interface (runtime deferred)

## Context and Problem Statement

ADR-0193 §G defers Phase 5 to a sub-ADR. Phase 5's promise (per
ADR-0193 lines 265-272): "Episodes shared across ruflo installs via
QUIC/CRDT… The interface can be defined… defer the runtime to a
dedicated federation-infrastructure ADR."

A pre-decision audit of agentdb's existing federation surface
changes the picture substantially. The QUIC + CRDT + sync stack
is **far more complete at the interface level than the stub
assumed**, but the transport is not wired to a real network:

* **`QUICServer`** (`forks/agentdb/src/controllers/QUICServer.ts`,
  503 lines): full request/response shape, connection registry,
  rate-limiting, auth-token check, `processSyncRequest` dispatch
  to `syncEpisodes` / `syncSkills` / `syncEdges`. `start()` at
  line 100 only sets `isRunning = true` — there is **no `listen()`,
  no socket bind**. Line 111-112 in-source comment: *"Actual QUIC
  implementation would use a library like @fails-components/
  webtransport or node-quic. This is a reference implementation
  showing the interface."*
* **`QUICClient`** (667 lines): pool, retry, push/pull surface.
  Same in-source disclaimer at line 126-127 (no real transport).
* **`QUICConnection`** (429 lines, file header line 1):
  *"TODO: ADR required before activation — ADR-0161 lift, no
  production wiring"* — 0-RTT / BBR / migration logic implemented
  against a fictional underlying socket.
* **`SyncCoordinator`** (792 lines,
  `forks/agentdb/src/controllers/SyncCoordinator.ts`):
  bidirectional `sync(ctx, onProgress)`, change detection by
  `ts > lastSyncAt` against `episodes`/`skills`/`skill_edges`
  tables, conflict resolution strategies (`local-wins` |
  `remote-wins` | `latest-wins` | `merge`), Merkle-style
  checksumming, ADR-0180 audit integration. The class is real,
  but it's wired to a `QUICClient` that has no real transport.
* **CRDT primitives in `forks/agentdb/src/types/quic.ts`**
  (772 lines): `VectorClock` with `compareVectorClocks` /
  `mergeVectorClocks` / `incrementVectorClock`, `GCounter`,
  `LWWRegister<T>`, `ORSet<T>`, `EpisodeSync` / `SkillSync` /
  `CausalEdgeSync` message envelopes, `JWTClaims` for auth.
* **`FederatedLearningManager`** (real, not deprecated —
  `forks/agentdb/src/services/federated-learning.ts:330`): runs
  in-process. Manages `EphemeralLearningAgent`s, aggregates
  Float32Array state via averaging, consolidates back to agents.
  Wired in `forks/ruflo/v3/@claude-flow/memory/src/controller-registry.ts:2038`
  (Level 4, A11). **No QUIC dependency** — purely in-process
  aggregation across agents in one runtime. This is *not* what
  Phase 5 needs.

### What `AgentDBService` already exposes

`forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts:801-893`
already wires `SyncCoordinator` and (conditionally) `QUICClient` /
`QUICServer` behind `ENABLE_QUIC_SYNC` / `ENABLE_QUIC_SERVER` env
vars. `syncWithRemote(onProgress)` at line 1545 is exposed.
`forks/agentic-flow/agentic-flow/src/mcp/fastmcp/tools/quic-tools.ts`
registers 4 MCP tools (`quic_sync_episodes`, `quic_sync_skills`,
`quic_latency`, `quic_health`) on top.

Net: **the entire surface above the transport is built**. Episodes
already flow into `SyncCoordinator`'s `detectChanges()` (line 220)
via the SQL `episodes` table that `AutopilotLearning._record`
already writes to (`forks/agentic-flow/agentic-flow/src/coordination/autopilot-learning.ts:485-498`).

### What's NOT in `AutopilotEpisode`

The `AutopilotEpisode` interface
(`forks/agentic-flow/agentic-flow/src/coordination/autopilot-learning.ts:29-39`)
carries `taskId`, `subject`, `status`, `iterations`, `durationMs`,
`reward`, `critique`, `timestamp`, `sessionId`. For federation it
is missing:

* **Origin attribution** — no `nodeId` / `installId`. Conflicts
  across installs cannot be attributed.
* **Stable cross-node ID** — `taskId` is process-local (e.g.
  `Date.now()`-derived in callers); two installs running the
  same template will collide.
* **Vector clock** — agentdb's CRDT layer assumes
  `vectorClock: VectorClock` on synced records; autopilot
  episodes have none today.

### The deprecation history (load-bearing)

Memory `project-deprecated-controllers.md` (42 days old, flagged
stale) claimed `FederatedLearningManager` was disabled-stub.
**Current code disagrees**: it's wired, real, and aggregates
in-process Float32Array state across SONA ephemeral agents
(`forks/agentdb/src/services/federated-learning.ts:330-436`;
registry case at `controller-registry.ts:2038-2045`). The
actually-deprecated controller in
`forks/ruflo/v3/@claude-flow/cli/src/init/config-template.ts:213`
is `federatedSession` (ADR-0068), a different surface.

The lesson is **not** "previous federation attempt failed" —
it's that we have **two parallel federation stories**:

1. **`FederatedLearningManager`** — in-process Float32Array
   aggregation across SONA agents. Already shipping.
2. **`SyncCoordinator` + QUIC + CRDT** — cross-process episode/
   skill/edge synchronisation. Interface-complete, transport-stub.

Phase 5 is **story 2**. The audit confirms agentdb provides the
right abstraction; missing are (a) a real QUIC transport, (b) the
autopilot-side adapter, (c) episode identity fields.

### The runtime constraint (re-verified)

User's environment per `user_machine.md`: M5 Max MacBook Pro,
single host. No multi-host infrastructure. docker-compose files
in forks (e.g. `forks/agentdb/docker/docker-compose.yml`) are
single-container test rigs, **not** federation testbeds.
`forks/agentdb/package.json` deps confirm no real QUIC transport
package is installed (no `node:quic`,
`@fails-components/webtransport`, or `node-quic`).

The runtime is absent because no real QUIC binding has been
picked AND no second host exists to test against — not because
nobody tried to build it.

## Decision Drivers

* **Reuse over invention**: agentdb's CRDT/QUIC surface is the
  obvious substrate. Defining a parallel `FederatedSyncProvider`
  that doesn't compose with `SyncCoordinator` would re-implement
  conflict resolution, vector clocks, and Merkle verification
  that already exist.
* **Episode identity is buildable today**: adding `nodeId` /
  `originInstallId` / stable cross-node `taskId` to
  `AutopilotEpisode` requires no transport. This work is
  prerequisite to *any* federation runtime and unlocks local
  pre-flight tests (two SQLite files on one host, manual sync).
* **Transport selection is its own decision**: picking
  `@fails-components/webtransport` vs `node:quic` (Node 23+) vs
  HTTP/2 fallback vs gRPC vs libp2p is a separate ADR with
  separate operational impact. Phase 5 must not pre-commit.
* **Interface decay is real**: an interface defined with no
  consumer drifts. Mitigation: this ADR ships the autopilot-side
  *adapter that targets the existing `SyncCoordinator`* — the
  consumer is real even if the transport is stubbed.
* **No multi-host test rig today**: any Phase 5 work must be
  exercisable with two SQLite files / two processes on one host
  (loopback or shared-fs), otherwise it's untestable.

## Considered Options

### Option 1 — `FederatedSyncProvider` interface only, no-op default

The original stub plan. Interface +
`NoOpFederatedSyncProvider`, optional constructor arg.

* Pro: zero coupling to agentdb's existing primitives;
  minimal surface.
* Con: re-invents push/pull semantics that `SyncCoordinator`
  already provides — interface will either parallel
  `SyncCoordinator`'s shape (waste) or diverge from it (later
  bridge pain).
* Con: no real consumer at landing — untestable beyond "did
  the no-op get called."

### Option 2 — `FederatedSyncProvider` that adapts to `SyncCoordinator`

A thin adapter around agentdb's existing surface.
`AutopilotLearning` doesn't talk to QUIC directly; it talks to
the adapter, which dispatches to `SyncCoordinator.sync(ctx)`.
Episodes already land in the `episodes` SQL table via
`AgentDBService.storeEpisode`
(`forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts:898`),
so `SyncCoordinator.detectChanges()` already picks them up at
the right ts boundary — **no new write path needed**. What's
needed:

1. Add `originInstallId` to episode metadata.
2. Add `vectorClock` to episode metadata (optional pre-runtime).
3. Expose `FederatedSyncProvider` with `requestSync()` (forwards
   to `SyncCoordinator.sync`) + `onRemoteEpisode(callback)`
   (subscribes to a new post-apply event emitted from
   `SyncCoordinator.applyChanges` when origin ≠ local).

* Pro: composes with existing CRDT / conflict resolution /
  Merkle verification.
* Pro: testable on one host — two SQLite files + two
  `SyncCoordinator` instances, manual sync. Real adapter +
  real CRDT + stub transport.
* Pro: when transport is wired, no autopilot-side change is
  needed.
* Con: adds two fields to `AutopilotEpisode` metadata and one
  source of `originInstallId`.
* Con: pre-commits the future runtime ADR to agentdb's QUIC
  stack — reasonable given existing investment.

### Option 3 — Defer entirely (no interface)

Loses the "interface defined, runtime deferred" partial-progress
option that ADR-0193 §G asked for. Later consumers can't depend
on shape.

### Option 4 — Skip the abstraction; call `SyncCoordinator` from `AutopilotLearning`

Couples `AutopilotLearning` to ~792 lines of `SyncCoordinator`
surface for stubbing in tests; forecloses any future non-QUIC
transport (e.g. shared-fs MVP).

## Decision Outcome

**Choose Option 2 — adapter over `SyncCoordinator`. Accepted 2026-05-19.**

Rationale: the existing federation primitives in agentdb are
**too built** to ignore. Defining a parallel `FederatedSyncProvider`
that doesn't compose with `SyncCoordinator` would be the worst
of both worlds — an untested abstraction layered over an
untested transport. By adapting to `SyncCoordinator`, the
interface is exercisable today (two SQLite files on one host)
without a real QUIC binding, and the runtime ADR's job
narrows to "pick the QUIC library and write the socket code"
rather than "design federation semantics."

Runtime transport remains deferred to a separate ADR (pick a
QUIC binding gated on host availability and `node:quic` vs library
choice). This ADR covers the interface + adapter only.

## Scope when implemented

### Files touched (Option 2 plan)

* **NEW** `forks/agentic-flow/agentic-flow/src/coordination/federated-sync-provider.ts`:
  `interface FederatedSyncProvider`, `class NoOpFederatedSyncProvider`,
  `class SyncCoordinatorBackedProvider` (depends on
  `AgentDBService.getSyncCoordinator()`).
* **MODIFIED** `forks/agentic-flow/agentic-flow/src/coordination/autopilot-learning.ts`:
  add `originInstallId` to episode metadata write path (lines
  485-498); constructor accepts optional `syncProvider`;
  `_record` emits a `LocalEpisodeRecorded` event the provider
  listens to.
* **MODIFIED** `forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts`:
  expose `getSyncCoordinator()` (private field at line 160) and
  `getOrCreateInstallId()` reading/writing `.claude-flow/install-id`.
* **NEW** `forks/agentic-flow/agentic-flow/tests/integration/federated-sync-provider.test.ts`:
  two `AutopilotLearning` instances over two SQLite files,
  manual `requestSync()` round-trip, assert episode appears in
  peer with correct `originInstallId`.

### Interface shape

```ts
export interface FederatedSyncProvider {
  /** Out-of-band signal hook called after each local episode write. */
  notifyEpisode(episode: AutopilotEpisode): Promise<void>;

  /** Flush local changes since last sync to the remote peer. */
  push(): Promise<FederatedSyncReport>;

  /** Fetch remote changes since last sync and apply locally. */
  pull(): Promise<FederatedSyncReport>;

  /** Synchronous snapshot of provider state. Never throws. */
  status(): FederatedSyncStatus;

  /** Synchronous accessor for the configured strategy. Never throws. */
  conflictStrategy(): ConflictResolutionStrategy;

  /** Stable install identifier (outgoing episode origin). */
  getLocalInstallId(): string;
}
```

#### Spec deviation note

The shipped interface diverges from the spec text immediately above
(`requestSync()` + `onRemoteEpisode(cb)` + `getLocalInstallId()`).
Source of truth: `forks/agentic-flow/agentic-flow/src/services/federated-sync-provider.ts`
header comment, paraphrased here:

* **`push()` / `pull()` split** replaces the unified `requestSync()`.
  Rationale: callers can drive sync direction independently, matching
  `SyncCoordinator.detectChanges` / `applyChanges` split. The adapter
  wraps a single `SyncCoordinator.sync(ctx)` call to service both
  directions, so the surface stays compatible with agentdb's primitives
  while giving callers per-direction control.
* **`notifyEpisode(episode)` replaces `onRemoteEpisode(cb)`** as the
  event-subscription pattern. Episode writes already go through
  `AgentDBService.storeEpisode` → SQL `episodes` table, which
  `SyncCoordinator.detectChanges()` picks up on next sync. The pull
  side of inbound delivery is therefore covered by the existing SQL
  path — no callback registry needed. `notifyEpisode` is the optional
  out-of-band signal hook a provider can use to trigger an eager push
  (e.g., the future QUIC provider can stream the episode immediately
  rather than waiting for the next batch sync window).
* **`status()` + `conflictStrategy()` accessors** added during
  implementation to surface provider state to callers that need to
  reason about federation health without reaching into the adapter
  internals. Both are synchronous and never throw.
* **`FederatedSyncReport` + `FederatedSyncStatus` envelope types**
  introduced to avoid leaking `SyncCoordinator.SyncReport` /
  `getStatus()` types through the interface boundary. Subset of
  agentdb's surface; adapter passes fields through verbatim.

Per `feedback-no-fallbacks`: provider methods MUST propagate errors.
The `NoopFederatedSyncProvider` default does not throw, but any real
provider (adapter / future QUIC) MUST surface failures. The
`notifyEpisode` hook called from `AutopilotLearning._record` re-throws
— no silent catch.

Cursor bookkeeping unchanged: `SyncCoordinator` already tracks
`lastEpisodeSync` at `SyncCoordinator.ts:38-47`, so the adapter does
not need to maintain its own. `AutopilotLearning` default stays
`NoopFederatedSyncProvider`, preserving single-install behaviour.

## Implementation phases

Ordered, NOT time-estimated:

1. **Episode identity** — add `originInstallId` to episode
   metadata writes; add `getOrCreateInstallId()` to `AgentDBService`;
   assert in unit test that every persisted episode carries it.
2. **Interface skin** — `FederatedSyncProvider` interface +
   `NoOpFederatedSyncProvider`; wire constructor; assert no-op
   does not call any sync method.
3. **Adapter** — `SyncCoordinatorBackedProvider` over
   `AgentDBService.getSyncCoordinator()`; integration test with
   two SQLite files exercising one `requestSync()` round-trip.
4. **Inbound event** — `SyncCoordinator.applyChanges` emits a
   `remoteEpisodeApplied` event (new); adapter forwards as
   `onRemoteEpisode` callback; test asserts callback fires
   only for non-local origin.
5. **VectorClock** (optional pre-runtime) — populate
   `vectorClock` in episode metadata using agentdb's
   `incrementVectorClock`. Defer if Phase 5 closure does not
   need conflict resolution beyond timestamp ordering.
6. **Runtime hand-off** — open a federation-runtime ADR
   (separate). Scope: pick QUIC binding, document TLS / cert
   provisioning, real socket bind in `QUICServer.start()`,
   real connect in `QUICClient.connect()`. This ADR does NOT
   land that work.

Phases 1-4 are landable without any second host. Phase 6 is
gated on a separate ADR + second-host availability.

## Closure criteria

Status flips from `accepted` to `implemented` when ALL of:

* Phases 1-4 above are merged.
* The two-SQLite integration test passes in `npm run release`.
* A federation-runtime ADR exists with `status: proposed` or
  `accepted` (or with an explicit "deferred indefinitely"
  decision and a tracking issue). The ADR closure depends on
  the runtime question being **answered**, not necessarily
  **resolved**.

Status stays `accepted` while any of the above is missing; flips to `implemented` once all conditions hold.

## Out of scope

All of the following belong to the future federation-runtime ADR:

* **Real QUIC transport** — pick `node:quic` vs
  `@fails-components/webtransport` vs `node-quic` vs HTTP/2.
* **TLS / cert provisioning** — `ServerConfig` at
  `forks/agentdb/src/types/quic.ts:344-370` declares
  `tlsCertPath` / `tlsKeyPath` / `caCertPath` / `jwtSecret`
  but nothing populates them.
* **Cross-install auth** — JWT shape exists
  (`forks/agentdb/src/types/quic.ts:260-296`); no identity
  provider chosen.
* **Bandwidth / quota / privacy controls** — `QUICServer` has
  per-minute rate limits at the interface level
  (`QUICServer.ts:214-244`); no policy framework.
* **Conflict resolution beyond timestamp** — `SyncCoordinator`
  supports `local-wins`/`remote-wins`/`latest-wins`/`merge`;
  this ADR picks `latest-wins` (matching the
  `SyncCoordinator.ts:84` default).
* **`FederatedLearningManager` integration** — different system
  (in-process SONA agent state); doesn't share the episode
  surface.
* **Peer mesh topology** — `NetworkTopology` at
  `forks/agentdb/src/types/quic.ts:317-321` declares
  `HUB_AND_SPOKE` / `MESH` / `HIERARCHICAL`; runtime concern.

## Risks

* **Interface decay** — Mitigation: the Option 2 adapter is
  *exercised* by the two-SQLite integration test, so the
  interface gets hit on every release. Decay risk is on the
  *runtime* side, not the interface side.
* **Episode-identity migration** — adding `originInstallId`
  is a forward-compatible metadata-only change. Risk is in
  tests that hardcode `metadata` shape; audit before landing.
* **`SyncCoordinator` wired to stub transport** — calling
  `requestSync()` against the live `QUICClient` today returns
  silently. The integration test must bypass `QUICClient`
  and call `SyncCoordinator.sync(ctx)` directly. The adapter
  takes `syncCoordinator: SyncCoordinator` directly so the
  transport question stays one layer below.
* **`FederatedLearningManager` confusion** — in-process
  aggregator vs cross-install sync share a name pattern.
  Mitigation: this ADR's Context section calls out the
  distinction explicitly.
* **`SyncCoordinator` syncs more than episodes** — it syncs
  `episodes`, `skills`, AND `skill_edges`
  (`SyncCoordinator.ts:218-243`). A naïve `requestSync()`
  pulls everything. See first open question below.
* **Vector clock gap** — without `vectorClock`, conflict
  resolution falls back to wall-clock timestamps. Fine on
  single-host loopback; clock skew bites cross-host. The
  runtime ADR must not ship without vector clocks populated.

## Open questions

* **Per-table sync opt-out worth building?** `SyncCoordinator.sync()`
  syncs all of episodes/skills/edges. Options: (a) accept
  skills/edges federation as a side effect (shared skills is
  probably desirable too), (b) add `tables?:` to `SyncOptions`,
  (c) call lower-level `client.sync({type: 'episodes', ...})`
  directly. **Default: (a)** — note in ADR-0195 (Phase 4)
  during implementation.
* **`originInstallId` source?** Options: (a) UUIDv7 in
  `.claude-flow/install-id` at first init, (b) hash of machine
  UUID + cwd, (c) config-chain. **Default: (a)** — matches the
  pattern AgentDBService uses for agent-id default at
  `controller-registry.ts:2043`.
* **Populate `vectorClock` early or defer?** **Default: defer to
  step 5 of implementation**; start with timestamp ordering and
  add vector clocks when the runtime ADR is opened.
* **Does the future runtime ADR have to use agentdb's QUIC
  stack?** Adapter design pre-commits us. Escape hatch: swap
  `SyncCoordinator` later while keeping `FederatedSyncProvider`
  stable. Cost is one layer of indirection. Accept as known
  pre-commitment, not regret.
* **Was the `FederatedLearningManager` deprecation memory right
  or wrong?** Wrong — it was for `federatedSession`. The 42-day
  memory file should be updated post-implementation. Tracked as
  a memory-update task, not an ADR action.

## Implementation log

| Date | Commit (sparkling/agentic-flow main) | Scope |
|---|---|---|
| 2026-05-19 | `f3e48a1` | `feat(autopilot): ADR-0194 Phase 3 embedding-cluster pattern discovery` — Phase 5 anchors absorbed: federation imports + AutopilotEpisode.originInstallId + .vectorClock optional fields, _syncProvider + _vectorClock private fields, constructor accepting optional FederatedSyncProvider. |
| 2026-05-19 | `3fa9ec9` | `feat(autopilot): ADR-0195 Phase 4 episode:recorded emit in _record` — co-ships `agentic-flow/src/services/federated-sync-provider.ts` (interface + NoopFederatedSyncProvider) + `sync-coordinator-federated-adapter.ts` (adapter over agentdb's SyncCoordinator). |
| 2026-05-19 | `d06ba2c` | `feat(autopilot): ADR-0196 Phase 5 _record stamping + SyncCoordinator adapter` — _record stamps originInstallId pre-write, advances _vectorClock post-write (security hardening: failed writes do not leak clock ticks), constructs stampedEpisode + invokes provider.notifyEpisode after local persistence. |
| 2026-05-19 | `0f6f37f` | `fix(autopilot): ADR-0196 install-id security hardening (256-byte cap + UUIDv4 validation)` — `getOrCreateInstallId` now caps file reads at 256 bytes and validates `[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}` shape before accepting; malformed / oversized content triggers a `console.warn` and re-mint. Addresses security-review item from recovery brief. |
| 2026-05-19 | n/a (doc reconciliation) | Interface shape diverged from initial spec during implementation: `requestSync()` + `onRemoteEpisode(cb)` → `push() / pull() / notifyEpisode() / status() / conflictStrategy()`. Rationale captured in §"Interface shape" → "Spec deviation note" subsection. Source-of-truth header comment retained in `forks/agentic-flow/agentic-flow/src/services/federated-sync-provider.ts:10-33` as historical record. ADR text now matches shipped code; no source-code changes. |
