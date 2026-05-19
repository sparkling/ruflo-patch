# ADR-0194 / -0195 / -0196 — Coordination Map for 14-Agent Parallel Landing

Status: planning artifact (not an ADR). Read once; reference during execution.
Scope: tells each landing agent EXACTLY which byte-ranges it may touch so two agents never edit the same lines.

All line numbers are from current HEAD (commit `0dfbca7`). All paths are
absolute. Forks live at `/Users/henrik/source/forks/...` (NOT under
`ruflo-patch/`).

## 1. File ownership matrix

| File | Anchor / line range | Owner ADR / phase | Agent slot |
|---|---|---|---|
| `forks/agentic-flow/agentic-flow/src/coordination/autopilot-pattern-cluster.ts` | NEW FILE (whole file) | ADR-0194 Landing A | A1 |
| `forks/agentic-flow/tests/integration/autopilot-pattern-cluster.test.ts` | NEW FILE | ADR-0194 Landing A | A1 |
| `agentic-flow/src/services/agentdb-service.ts` lines 913–936 (`recallEpisodes`) | INSERT new `recallEpisodesWithEmbeddings` IMMEDIATELY AFTER line 936 | ADR-0194 Landing B | A2 |
| `agentic-flow/src/services/agentdb-service.ts` lines 130–190 (private-field block) | INSERT `private learningEvents = new EventEmitter()` AFTER line 174 (after `costOptimizer` field) | ADR-0195 P4.1 | A4 |
| `agentic-flow/src/services/agentdb-service.ts` line 1241 (after `getSonaService`) | INSERT `getLearningEvents()`, `getLearningSystem()`, `getSyncCoordinator()`, `getOrCreateInstallId()` BEFORE existing `getController()` at line 1250 | ADR-0195 P4.1 + ADR-0196 step 1 | A4 + A8 (sequenced) |
| `agentic-flow/src/services/agentdb-service.ts` lines 355–360 (LearningSystem field-construct site) | DO NOT TOUCH — read-only by P4.2 subscriber wire-up | ADR-0195 P4.2 | A5 (reads only) |
| `agentic-flow/src/services/agentdb-service.ts` post-line 379 (cost-optimizer block end) | INSERT P4.2 subscriber: `this.learningEvents.on('episode:recorded', ...)` calling `this.learningSystem.submitFeedback(...)` | ADR-0195 P4.2 | A5 |
| `agentic-flow/src/coordination/autopilot-learning.ts` lines 134–172 (`AgentDBLike`) | EXTEND interface with optional members — see §2 anchor block | ADR-0194 C / ADR-0195 P4.1+P4.3 / ADR-0196 step 2 | A3, A4, A8 (serialize through this single block) |
| `agentic-flow/src/coordination/autopilot-learning.ts` line 334 (`_aggregatePatterns(filter)` inside `discoverSuccessPatterns`) | REPLACE with branching on `_engine` | ADR-0194 Landing C | A3 |
| `agentic-flow/src/coordination/autopilot-learning.ts` lines 295, 301–305, 325, 498 (existing producer boundaries) | INSERT 4 emit calls (NOT rewrite — single-line additions only) | ADR-0195 P4.1 | A4 |
| `agentic-flow/src/coordination/autopilot-learning.ts` lines 485–498 (`storeEpisode` payload — `metadata` block) | EXTEND `metadata` with `originInstallId` + (optional) `vectorClock` | ADR-0196 step 1 | A8 |
| `agentic-flow/src/coordination/autopilot-learning.ts` after line 254 (`initialize` end) | INSERT `_engine` probe, `_eventBus` resolve, `_syncProvider` constructor assignment | ADR-0194 C, ADR-0195 P4.1, ADR-0196 step 2 | A3, A4, A8 (serialize) |
| `agentic-flow/src/coordination/autopilot-learning.ts` `// === PHASE 3 BEGIN ===` block at EOF (line 674) | NEW methods: `_aggregatePatternsKeyword` (renamed from `_aggregatePatterns`), `_clusterPath`, `_engineDescriptor`, `_resolveEmbeddings` | ADR-0194 Landing C | A3 |
| `agentic-flow/src/coordination/autopilot-learning.ts` `// === PHASE 4 BEGIN ===` block | NEW methods: `_resolveEventBus`, `_emitEpisodeRecorded`, `_emitTrajectory*`, `getSonaPatterns` | ADR-0195 P4.1–P4.3 | A4, A5, A6 |
| `agentic-flow/src/coordination/autopilot-learning.ts` `// === PHASE 5 BEGIN ===` block | NEW: `_emitLocalEpisodeRecorded`, `_attachSyncProvider`, public `getSyncProvider()` | ADR-0196 step 2–4 | A8, A9 |
| `forks/agentic-flow/agentic-flow/src/coordination/federated-sync-provider.ts` | NEW FILE | ADR-0196 step 2–3 | A8 |
| `forks/agentic-flow/agentic-flow/src/cli/autopilot-cli.ts` lines 261–271 (`learn --json` output) | RENAME accesses: `p.taskType→p.pattern`, `p.approach→<derived>`, `p.successRate→p.avgReward`, `p.uses→p.frequency` | ADR-0198 Finding 2 | A7 |
| `forks/agentic-flow/agentic-flow/src/cli/autopilot-cli.ts` lines 282–289 (`learn` text output) | Same rename set (also drops percent rendering for `successRate`; show `avgReward.toFixed(2)`) | ADR-0198 Finding 2 | A7 |
| `forks/agentic-flow/agentic-flow/src/cli/autopilot-cli.ts` lines 322–347 (`history`) | RENAME accesses: `ep.task→ep.subject`, `ep.success→<derive from status>`, drop `ep.similarity` (not on `AutopilotEpisode`) | ADR-0198 Finding 2 | A7 |
| `forks/agentic-flow/agentic-flow/src/cli/autopilot-cli.ts` lines 376–398 (`predict`) | DROP `prediction.alternatives` access (not on `predictNextAction` return). Either widen producer return type (ADR-0195 expansion) OR delete CLI access. Recommend latter for ADR-0198 fix-only. | ADR-0198 Finding 2 | A7 |
| `forks/agentic-flow/tests/integration/autopilot-event-bus.test.ts` | NEW FILE | ADR-0195 closure | A6 |
| `forks/agentic-flow/tests/integration/federated-sync-provider.test.ts` | NEW FILE — two SQLite files, one host | ADR-0196 closure | A9 |
| `forks/agentic-flow/tests/integration/autopilot-cli-types.test.ts` | NEW FILE — exhaustive type-shape assertions for CLI output | ADR-0198 closure | A7 |

Agent slots A10–A14 reserved for: acceptance harness wiring (A10), USERGUIDE
update (A11), integration ledger row (A12), build verification on each fork
(A13), final commit + tag (A14).

## 2. Method anchor design — `autopilot-learning.ts`

To prevent diff churn at the bottom of the class, all NEW code from the three
ADRs goes into three contiguous anchor blocks INSIDE the class, ABOVE the
existing closing brace at line 674. Insertion ordering A3 → A4/A5/A6 → A8/A9.

```ts
  // === PHASE 3 BEGIN (ADR-0194) ===
  // New private state:
  //   private _engine: 'keyword' | 'embedding-cluster' = 'keyword';
  //   private _gnnService: GNNServiceLike | null = null;   // Landing D
  // New methods (all private unless noted):
  //   _aggregatePatternsKeyword  (renamed body of current _aggregatePatterns)
  //   _clusterPath
  //   _resolveEmbeddings
  //   _engineDescriptor
  // Public surface delta: LearningMetrics gains { engine }; DiscoveredPattern unchanged.
  // === PHASE 3 END ===

  // === PHASE 4 BEGIN (ADR-0195) ===
  // New private state:
  //   private _eventBus: EventEmitter | null = null;
  // New methods:
  //   _resolveEventBus(caller)              — mirrors _resolveSona
  //   _emitEpisodeRecorded(ep, reward)
  //   _emitTrajectoryOpened(id)
  //   _emitTrajectoryStep(id, step)
  //   _emitTrajectoryClosed(id)
  //   getSonaPatterns(limit)                — public read-only
  // Public surface delta: 4 EventEmitter events documented in §5 of ADR-0195.
  // === PHASE 4 END ===

  // === PHASE 5 BEGIN (ADR-0196) ===
  // New private state:
  //   private _syncProvider: FederatedSyncProvider = new NoOpFederatedSyncProvider();
  //   private _localInstallId: string | null = null;
  // Constructor change: AutopilotLearning now accepts optional { syncProvider }.
  // New methods:
  //   _emitLocalEpisodeRecorded(ep)         — fired from _record AFTER storeEpisode
  //   _resolveInstallId()                   — reads from AgentDBService.getOrCreateInstallId()
  //   getSyncProvider()                     — public accessor (for tests + injection)
  // === PHASE 5 END ===
```

Rule: every agent appends INSIDE its own anchor block. The single shared block
where conflict is possible is the `AgentDBLike` interface (lines 134–172) and
the `initialize()` epilogue (after line 254). Resolve via merge-order P3 → P4
→ P5 (see §5).

## 3. Existing API surface inventory (HEAD)

### `AutopilotLearning` public surface (autopilot-learning.ts:174–674)

Constructor: zero-arg `new AutopilotLearning()`. No DI today.

Public methods:
- `initialize(): Promise<boolean>`
- `isAvailable(): boolean`
- `recordTaskCompletion(ep: AutopilotEpisode): Promise<void>`
- `recordTaskFailure(ep: AutopilotEpisode): Promise<void>`
- `recordIterationStep(progress: unknown, drift: unknown[]): Promise<void>`
- `endSwarmTrajectory(_summary: unknown): Promise<void>`
- `discoverSuccessPatterns(): Promise<DiscoveredPattern[]>`
- `recallSimilarTasks(query: string, limit: number): Promise<AutopilotEpisode[]>`
- `predictNextAction(state: Record<string, unknown>): Promise<{ action: string; confidence: number }>`
- `getReEngagementContext(incompleteTasks): Promise<ReEngagementContext>`
- `getMetrics(): Promise<LearningMetrics>`

### Exported interfaces

- `AutopilotEpisode` (lines 29–39): `taskId, subject, status, iterations, durationMs, reward?, critique?, timestamp?, sessionId?`. No `task`, no `success`, no `similarity`, no `id`, no `originInstallId`.
- `DiscoveredPattern` (lines 41–45): `pattern, frequency, avgReward`. No `taskType`, no `approach`, no `successRate`, no `uses`.
- `ReEngagementContext` (lines 47–53)
- `LearningMetrics` (lines 55–60): `available, episodes, patterns, trajectories`. No `engine`, no `engineDescriptor`.

### Private surface relied on by ADR plans

- `_listEpisodes()` line 604 — bulk reader, sessionId-filtered
- `_aggregatePatterns(episodes)` line 615 — keyword aggregator; ADR-0194 renames to `_aggregatePatternsKeyword`
- `_record(ep, baseReward, success)` line 478 — episode write site; ADR-0195 emits `episode:recorded` HERE; ADR-0196 stamps `originInstallId` in metadata HERE
- `_resolveSona(caller)` line 459 — pattern for ADR-0195's `_resolveEventBus`

### `AgentDBService` symbols ADR plans touch

- `learningSystem: any = null` line 139 (private → ADR-0195 needs `getLearningSystem()`)
- `syncCoordinator: any = null` line 160 (private → ADR-0196 needs `getSyncCoordinator()`)
- `recallEpisodes(query, limit, filters)` line 913 → ADR-0194 adds parallel `recallEpisodesWithEmbeddings` immediately after
- `predictAction(state)` line 1194 — read-only for these ADRs (not modified)
- `getSonaService()` line 1238 — pattern for ADR-0195's new accessors
- `getController(name)` line 1250 — read-only (used by ADR-0194 to resolve `gnnService`)
- `initializePhase4Controllers` line 801 — read-only (already wires `syncCoordinator`)
- `syncWithRemote(onProgress)` line 1545 — read-only (ADR-0196 adapter calls this)
- `costOptimizer` field at line 174 — ADR-0195 inserts `learningEvents` immediately after

## 4. Dependency edges between phases

**Phase 3 (ADR-0194) and Phase 4 (ADR-0195) are independent.**

- ADR-0194 touches `_aggregatePatterns` body + `AgentDBLike` (adds
  `recallEpisodesWithEmbeddings?`) + new pure module. None of these are
  consumed by ADR-0195.
- ADR-0195 touches `_record` post-write + 3 trajectory boundaries +
  `AgentDBLike` (adds `getLearningEvents?`). None of these are consumed by
  ADR-0194.

Sole shared edit point: the `AgentDBLike` interface block at lines 134–172.
Both ADRs append OPTIONAL fields — pure additive. Resolve by ordering: A2/A3
land first, then A4 layers on top.

**Phase 5 (ADR-0196) DOES depend on Phase 4.** ADR-0196 step 4 says:
*"SyncCoordinator.applyChanges emits a `remoteEpisodeApplied` event; adapter
forwards as `onRemoteEpisode` callback."* The most natural wiring for that is
the SAME EventEmitter (`learningEvents`) introduced by ADR-0195 P4.1, OR a
parallel `syncEvents` emitter. The ADRs do not specify which.

**Recommendation:** treat ADR-0195 P4.1 (bus plumbing) as a prerequisite for
ADR-0196 step 4. Steps 1–3 of ADR-0196 (install ID + interface + adapter) are
independent of Phase 4 and can land in parallel with ADR-0195 P4.1 / P4.2 /
P4.3.

ADR-0196 also names `originInstallId` on episode metadata write
(autopilot-learning.ts:485-498). This is the SAME `metadata` literal where
ADR-0195 P4.1 emits `episode:recorded` AFTER the write. No conflict — one
extends the object literal, the other adds an emit AFTER the await. But the
diff hunks overlap; serialize A4 (P4.1 emits) → A8 (Phase 5 metadata stamp).

## 5. Risk list — conflict-plausible lines + merge order

| Risk | Location | Resolution |
|---|---|---|
| `AgentDBLike` interface concurrent extension | `autopilot-learning.ts:134-172` | Merge order: A2 (P3 `recallEpisodesWithEmbeddings?`) → A4 (P4 `getLearningEvents?`) → A8 (P5 `getSyncCoordinator?` + `getOrCreateInstallId?`). Each agent appends ONE optional member; no field reordering. |
| `initialize()` epilogue (after line 254) | `autopilot-learning.ts:243-254` | Three new probe blocks land here. Order: P3 engine probe → P4 event-bus probe → P5 install-id resolve. Each block is 5–10 lines, distinct `console.error` prefixes, no shared state. |
| `_record` body — both an event emit (P4) and a metadata field (P5) target this same method | `autopilot-learning.ts:478-504` | A4 inserts `this._emitEpisodeRecorded(ep, reward)` AFTER line 498 (after `await storeEpisode`). A8 extends the `metadata` literal at lines 491–497. Both edits coexist; reviewer must check A8's diff includes A4's emit line unchanged. |
| `LearningMetrics` shape | `autopilot-learning.ts:55-60` | A3 adds `engine: 'keyword' | 'embedding-cluster'`. No other ADR extends this interface. Single owner. |
| `recallEpisodes` parallel signature | `agentdb-service.ts:913-936` | A2 inserts `recallEpisodesWithEmbeddings` IMMEDIATELY AFTER line 936. No edit to existing 913–936; pure addition. |
| New public accessors on `AgentDBService` | `agentdb-service.ts:1241-1262` | A4 inserts `getLearningEvents`, `getLearningSystem` after `getSonaService` (line 1241). A8 inserts `getSyncCoordinator`, `getOrCreateInstallId` after A4's block. Both BEFORE existing `getController` at line 1250. |
| P4.2 subscriber wire-up vs init-order in `AgentDBService.initialize` | `agentdb-service.ts:355-379` | A5's subscriber MUST run after `learningSystem` is assigned (line 355–359) AND after `learningEvents` field exists. Place subscriber block right before line 372 (cost-optimizer init). |
| autopilot-cli.ts type-drift fix overlaps with new Phase 4 CLI surface | `autopilot-cli.ts:239-398` | A7 fixes existing drift only — no new fields. ADR-0195 says CLI is "re-touched" but the actual ADRs don't add new CLI subcommands. So A7's diff is rename-only; if a follow-up surfaces `engine`, `originInstallId`, etc., handle in a later patch. |
| `_engine` flag value when `recallEpisodesWithEmbeddings` missing | `autopilot-learning.ts` initialize epilogue | Per `feedback-no-fallbacks`: A3 sets `_engine='keyword'` AND emits `console.error('[AutopilotLearning] embedding-cluster engine unavailable: recallEpisodesWithEmbeddings missing on AgentDBService')`. Not a silent fallback — observable in stderr and via `LearningMetrics.engine`. |
| `vectorClock` on episodes — declared in `quic.ts` SyncableEpisode (line 91) but NOT in `AutopilotEpisode` | spans both forks | ADR-0196 step 5 (optional) says populate `vectorClock` via `incrementVectorClock`. `agentdb/src/types/quic.ts:552` exports it. A8 should add `vectorClock` to `AutopilotEpisode` as optional; defer population until step 5 actually lands. |

**Recommended merge order:**

1. A1 — pure cluster module + tests (zero risk; standalone file)
2. A2 — `recallEpisodesWithEmbeddings` in agentdb-service.ts (additive; no
   autopilot-learning.ts edit)
3. A7 — CLI type-drift fix (ADR-0198; no producer touch — fix can land
   anytime, but landing it FIRST eliminates a class of regressions from
   subsequent landings; also no `--noCheck` removal as a side effect)
4. A3 — Phase 3 wire-in to autopilot-learning.ts (consumes A1 + A2)
5. A4 — Phase 4 bus plumbing (overlaps A3 only at `AgentDBLike` and
   `initialize` epilogue — rebase trivially)
6. A5 — Phase 4 LearningSystem subscriber (consumes A4)
7. A6 — Phase 4 SONA read-back + event-bus integration tests
8. A8 — Phase 5 interface + install ID + episode metadata stamp (consumes
   A4 if step 4 uses shared bus)
9. A9 — Phase 5 adapter + two-SQLite integration test
10. A10–A14 — harness, ledger, USERGUIDE, build verification, final commit

## 6. Open questions

1. **`autopilot-cli.ts` `predict` `alternatives` field.** Producer
   `predictNextAction` returns `{ action; confidence }` only — no
   `alternatives`. CLI line 379–392 accesses `prediction.alternatives`. Two
   options for A7: (a) widen `predictNextAction` to return `alternatives:
   Array<{ action; confidence }>` and populate from the tally Map at
   autopilot-learning.ts:384–396; (b) delete the CLI access. The ADRs prefer
   (a) longer-term — same shape `AgentDBService.predictAction` already
   returns (line 76–80). Recommend A7 implements (a) since the tally is
   already computed and discarded.

2. **Phase 5 step 4 — which emitter for `remoteEpisodeApplied`?** ADR-0196
   says `SyncCoordinator.applyChanges emits ... new`. ADR-0195's
   `learningEvents` is autopilot-domain; `remoteEpisodeApplied` is a
   sync-domain event. Cleaner: add a separate `syncEvents` EventEmitter on
   AgentDBService for sync-bus traffic, and let the adapter bridge
   `syncEvents.on('remoteEpisodeApplied', ...)` → `onRemoteEpisode`
   callbacks. Confirm with reviewer before A8/A9 land.

3. **Phase 3 Landing D `gnnEnhancement` gating.** ADR-0194 names
   `engine.gnnEnhancement: 'native' | 'js' | 'disabled'` as an extension to
   `LearningMetrics`. The ADR also says Landing D is deferred — so do NOT
   add this field as part of Landing C. The `engine` field stays
   single-string for now. Add `gnnEnhancement` only when Landing D actually
   lands.

4. **`vectorClock` interop.** `agentdb/src/types/quic.ts` exports
   `incrementVectorClock`, `mergeVectorClocks`, `createVectorClock`.
   AutopilotEpisode has no `vectorClock` field today. ADR-0196 step 5 is
   marked optional. If we add `vectorClock?: VectorClock` to
   `AutopilotEpisode`, the import path (`from
   '@sparkleideas/agentdb/types/quic'` after codemod, or vendored copy)
   must be confirmed; the consumer fork may need the type re-exported from
   `@sparkleideas/agentdb`'s public surface (today only the `clocks`
   interfaces live in `src/types/quic.ts`, not in any index barrel).

5. **`AgentDBLike.getSonaPatterns?` payload shape.** ADR-0195 P4.3 says
   "delegates to `SonaRvfService.findPatterns`" but doesn't pin the
   `SonaPattern` shape. Before A6 can write its test, A4 or A6 must declare
   `interface SonaPattern { ... }` inside `autopilot-learning.ts`'s
   AgentDBLike block. Open to whoever lands P4.3 — propose mirroring
   sona-rvf-service.ts:findPatterns's return type to keep the surface narrow.

6. **`AutopilotLearning` constructor signature change (ADR-0196).** Today
   constructor is zero-arg. ADR-0196 says it "accepts optional
   `syncProvider`". This is the ONE backward-incompatible-looking change
   across the three ADRs. Mitigation: optional parameter, default
   `NoOpFederatedSyncProvider`. Verify no production callsite passes a
   different shape — grep `new AutopilotLearning()` across all four forks
   before A8 lands. `autopilot-cli.ts:242, :308, :357` all construct
   zero-arg — safe.

7. **Single AgentDBLike vs split.** As the interface picks up
   `recallEpisodesWithEmbeddings?` + `getLearningEvents?` + `getSyncCoordinator?`
   + `getOrCreateInstallId?` + `getSonaPatterns?`, it widens significantly
   from its current narrow shape. Consider whether `AgentDBLike` should be
   split into role-narrowed slices (e.g. `EpisodeStoreLike`,
   `EventBusHostLike`, `FederationHostLike`). Out of scope for this
   landing — flag for a follow-up cleanup ADR if the interface gets
   unwieldy.
