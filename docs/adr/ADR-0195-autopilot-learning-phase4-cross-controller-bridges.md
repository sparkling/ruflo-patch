---
status: implemented
date: 2026-05-19
accepted: 2026-05-19
implemented: 2026-05-19
methodology: [MADR]
decision-makers: [Henrik Pettersen]
tags: [autopilot, learning, sona, cross-controller, phase4, ADR-0193, ADR-059]
related: [0192, 0193, 0194]
upstream-related: [agentic-flow/ADR-059]
audience: ai-executor
---

# ADR-0195: AutopilotLearning Phase 4 — cross-controller bridges

## Context and Problem Statement

ADR-0193 §G defers Phase 4 to this sub-ADR. The Phase 4 promise from upstream
agentic-flow ADR-059:

1. `LearningSystem` consumes autopilot outcomes to update its
   algorithm-recommendation weights.
2. SONA RL trajectory feedback loop: trajectories recorded in ADR-0193 Item B
   feed back into SONA's policy updates.

Today three controllers exist in isolation:

- **AutopilotLearning** (`forks/agentic-flow/agentic-flow/src/coordination/autopilot-learning.ts:174`)
  is a producer. It writes episodes via
  `AgentDBService.storeEpisode` (autopilot-learning.ts:485-498) and opens SONA
  trajectories via `SonaRvfService.beginTrajectory` /
  `addStep` / `endTrajectory` (autopilot-learning.ts:285-329). It exposes
  read methods (`getMetrics`, `getReEngagementContext`,
  `discoverSuccessPatterns`, `predictNextAction`) but has zero outbound event
  surface — `export class AutopilotLearning` (line 174) declares no superclass.
- **LearningSystem** (`forks/agentdb/src/controllers/LearningSystem.ts:91`)
  manages 9 RL algorithms with `startSession` / `predict` / `submitFeedback` /
  `train` (lines 192-427). Weights live in `learning_policies` /
  `learning_experiences` SQLite tables. It is constructed eagerly inside
  `AgentDBService.initialize()` at
  `forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts:355-359`
  via `controllerRegistry.getOrCreate('learningSystem', ...)`. It has its
  own private in-memory SonaTrajectoryService (LearningSystem.ts:152-165) —
  this is an intentional split per the `INTENTIONAL SPLIT` comment at
  LearningSystem.ts:144-151.
- **SonaRvfService** (`forks/agentic-flow/agentic-flow/src/services/sona-rvf-service.ts:43`)
  is a process-local singleton with in-memory trajectory + pattern stores
  (lines 52-55). `endTrajectory` (lines 109-126) already aggregates patterns
  into `this.patterns` after each close. There is no callback or event when
  this aggregation happens.

The trajectories ADR-0193 Item B records are stored but not consumed — that
is the open risk ADR-0193 §Risks Item B explicitly named ("trajectories
recorded without a consumer"). Phase 4 is the discharge.

### Three additional observations grounding the design

1. **`learningSystem.predictAction` does not exist.** AgentDBService.ts:1214
   calls `await this.learningSystem.predictAction?.(String(state))` —
   optional-chained against a method LearningSystem never declared. The
   actual surface is `predict(sessionId, state)` (LearningSystem.ts:267).
   The optional-chain returns undefined every time and the surrounding catch
   at line 1216 sets `this.learningSystem = null` permanently on first
   exception. Phase 4 cannot rely on this path; it has to wire to the real
   `predict` / `submitFeedback` surface.

2. **No re-entrancy risk on the autopilot → LearningSystem direction.**
   AutopilotLearning writes to `episodes` (via ReflexionMemory).
   LearningSystem writes to `learning_experiences` / `learning_policies`.
   `AutopilotLearning._listEpisodes` (autopilot-learning.ts:604-613) reads
   only `episodes`. There is no path where a LearningSystem write loops
   back into an autopilot `_record` invocation. The cycle is bounded.

3. **The SONA direction has two `SonaRvfService` consumers in this process
   already.** AutopilotLearning writes via
   `agentdbService.getSonaService()` (agentdb-service.ts:1238-1241).
   `SonaRvfService.endTrajectory` already updates `this.patterns` on close
   (sona-rvf-service.ts:113-124). The "feedback loop" Phase 4 names is not
   a new RL training step on SONA — it is just exposing the already-computed
   patterns to a consumer. The natural reader is LearningSystem's
   `submitFeedback` path so the autopilot's `state/action/reward` triple
   enters LearningSystem's policy update with shaping based on autopilot
   reward (autopilot-learning.ts:523-543).

4. **Pre-existing `autopilot-cli.ts` type drift** (ADR-0198 Finding 2).
   `forks/agentic-flow/agentic-flow/src/cli/autopilot-cli.ts` references
   properties (`successRate`, `taskType`, `approach`, `uses`, `success`,
   `similarity`, `task`, `alternatives`) that aren't on `DiscoveredPattern`
   / `AutopilotEpisode` / `predictNextAction` return types. Masked by
   `tsc --noCheck`. Phase 4 will re-touch this CLI surface when wiring to
   the real `predict` / `submitFeedback` calls — the type drift should be
   resolved as part of the same change rather than left for a separate
   commit touching the same file.

### Existing event-emitter precedent

Node `EventEmitter` is the dominant in-process pub/sub pattern in
agentic-flow:

- `HookService extends EventEmitter` (services/hook-service.ts:35)
- `StreamingService extends EventEmitter` (services/streaming-service.ts:67)
- `RuVectorBackend extends EventEmitter` (optimizations/ruvector-backend.ts:68)
- `WorkerDispatchService extends EventEmitter` (workers/dispatch-service.ts:33)
- `AgentDBFast extends EventEmitter` (core/agentdb-fast.ts:52)
- `AgentDebugStream extends EventEmitter`
  (federation/debug/agent-debug-stream.ts:77)
- `EmbeddingService extends EventEmitter` (core/embedding-service.ts:35)

Phase 4 should copy the pattern, not introduce a new one.

## Decision Drivers

* **Risk discharge for ADR-0193 §B**: trajectories without consumers are
  storage; Phase 4 turns them into signal.
* **No tight import coupling**: AutopilotLearning ↔ LearningSystem cannot
  become a direct import. AutopilotLearning is created lazily
  (autopilot-cli.ts:241-242, autopilot-cli.ts:307-308, autopilot-cli.ts:356-357,
  autopilot-tools.ts:114-115, swarm-completion.ts:242-244) per invocation;
  LearningSystem is constructed once at AgentDBService boot. A direct
  consumer-as-constructor-arg wiring inverts the lifecycle.
* **Subscriber-must-tolerate-multiple-producers**: each
  `new AutopilotLearning()` is a fresh instance. A subscription model has
  to handle "fan-in from N transient producers", not "fan-out from 1
  long-lived producer".
* **`feedback-no-fallbacks`**: when LearningSystem is unavailable or
  rejects a feedback, the wire must surface the error, not silently swallow.
* **No isolated-mode regression**: AutopilotLearning must keep working when
  no subscriber is wired (which is the current state — Phase 4 cannot
  break Phase 2/3).
* **Init order**: the bridge must work when subscribers exist before
  producers AND when subscribers attach after producers have already
  emitted (rare, but plausible during MCP tool reload).

## Considered Options

### Option 1 — Shared event bus owned by AgentDBService

Add a single `EventEmitter` field on AgentDBService called
`learningEvents`. AutopilotLearning's `_resolveSona`-style accessor pattern
extends with `_resolveEventBus()` and emits via the bus. LearningSystem
subscribes once at construction time (it already takes AgentDBService
implicitly via the registry's `getOrCreate` closure).

Pros:

- One stable subscription point — survives across AutopilotLearning
  instance churn because the bus outlives any single producer.
- Mirrors the existing `getSonaService()` pattern on AgentDBService
  (agentdb-service.ts:1238-1241): "service exposes shared resources to
  transient consumers".
- No circular import: AutopilotLearning already depends on AgentDBService;
  LearningSystem already depends on it via the registry.
- Subscribers attaching late do NOT lose events emitted before
  subscription — but Phase 4 documents this as expected and reasonable
  (lost-pre-subscription is acceptable when subscribers boot before
  producers, which is the actual init order; see #3 above).

Cons:

- Adds an `events` field to AgentDBService that isn't currently there.
- One more thing to clean up if AgentDBService is torn down (rare; the
  service is a process singleton).

### Option 2 — `EventEmitter` directly on AutopilotLearning

Each `AutopilotLearning` instance extends `EventEmitter` and emits its own
events. LearningSystem must locate live instances to subscribe.

Pros:

- Most idiomatic per-class; matches HookService / StreamingService shape.

Cons:

- **Fatal mismatch with the producer lifecycle.** LearningSystem boots
  once at AgentDBService init. AutopilotLearning is constructed per
  CLI call. There is no live AutopilotLearning instance at LearningSystem
  boot time, so a `.on()` call has nothing to attach to. The reverse
  ("AutopilotLearning looks up LearningSystem and registers itself") is
  the same pattern as Option 1 but with the subscription cost paid per
  AutopilotLearning instance.
- Subscribers would have to be re-attached per producer instance — that
  is a registry of (producer-id → subscribers) just to keep the surface
  sane. Option 1 already provides that registry — it's the event bus.

### Option 3 — Shared callback registry on AgentDBService

`AgentDBService.registerLearningConsumer(fn)` /
`AgentDBService.notifyLearningEvent(event)`. AutopilotLearning calls
notify; LearningSystem registers a consumer at boot.

Pros:

- No EventEmitter dependency.
- Trivial to test (replace registry with array; assert callback order).

Cons:

- Reimplements EventEmitter with weaker typing (loses event-name routing
  unless we add it manually).
- Diverges from the dominant agentic-flow pattern (7+ EventEmitter
  subclasses listed above) for no benefit.

### Option 4 — AgentDB-backed pub/sub (message bus)

Persist events to AgentDB; subscribers poll or stream.

Pros:

- Cross-process consumers possible.

Cons:

- Phase 4 is explicitly in-process per ADR-059.
- Adds latency + IO + a schema for transient signals.
- ADR-0196 (Phase 5 federation) is the right place for this; pulling
  it forward to Phase 4 conflates two scopes.

## Decision Outcome

**Chosen: Option 1 (shared event bus owned by AgentDBService).** Accepted 2026-05-19; implementation in scope per the phases below.

## Scope when implemented

### Files

- `forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts`
  - Add `private readonly learningEvents = new EventEmitter()` near the
    `costOptimizer` block (around line 374).
  - Add `getLearningEvents(): EventEmitter { return this.learningEvents; }`
    public accessor.
  - Add `getLearningSystem(): any { return this.learningSystem; }`
    public accessor (today the field is private — line 139). Phase 4
    needs LearningSystem access to bind a sessionId.

- `forks/agentic-flow/agentic-flow/src/coordination/autopilot-learning.ts`
  - Extend `AgentDBLike` with optional `getLearningEvents?(): EventEmitter`
    (alongside the existing `getSonaService?` on line 170).
  - Add `_resolveEventBus(caller)` mirroring `_resolveSona` shape
    (autopilot-learning.ts:459-476).
  - Emit four events at the existing producer boundaries:
    - `episode:recorded` after `storeEpisode` (autopilot-learning.ts:498)
      — payload `{ taskId, subject, status, reward, success, timestamp }`
    - `trajectory:opened` after `beginTrajectory` succeeds
      (autopilot-learning.ts:295) — payload `{ trajectoryId, openedAt }`
    - `trajectory:step` after every `addStep`
      (autopilot-learning.ts:301-305) — payload
      `{ trajectoryId, state, action, reward }`
    - `trajectory:closed` after `endTrajectory`
      (autopilot-learning.ts:325) — payload
      `{ trajectoryId, closedAt }`

- `forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts`
  (post-eventbus block, separate change):
  - In LearningSystem-wiring section (after line 359), subscribe
    `learningEvents.on('episode:recorded', ...)` to a private method
    that translates the autopilot episode into a
    `learningSystem.submitFeedback({...})` call. The sessionId is
    invented per autopilot subject — `autopilot:${subject-hash}` — and
    the per-sessionId `startSession` runs lazily on first feedback.

### Public surface change

- `AgentDBService.getLearningEvents(): EventEmitter` — new
- `AgentDBService.getLearningSystem(): any` — new (was private)
- `AgentDBLike.getLearningEvents?(): EventEmitter` — extension
- AutopilotLearning emits four events listed above (silent no-op when no
  subscribers — that's stock EventEmitter behavior, no extra code)

### Contract between controllers

```text
AutopilotLearning._record(...)
  └→ storeEpisode(...)                              [unchanged]
  └→ learningEvents.emit('episode:recorded', {...}) [new]
       └→ LearningSystem subscriber:
            ensureSession(`autopilot:${hash(subject)}`)
              .then(sid => submitFeedback({
                sessionId: sid,
                state: subject,
                action: status,
                reward,
                nextState: undefined,
                success,
                timestamp,
              }))
```

The synthetic sessionId is a stable hash of the autopilot subject so the
same task repeats into the same RL session, letting LearningSystem's
incremental Q-update (LearningSystem.ts:601-637) accumulate.

The reward shape on the wire is the SHAPED reward from
`_computeShapedReward` (autopilot-learning.ts:523-543), not the raw ±1
baseline — Phase 4 inherits ADR-0193 Item A.3's shaping.

## Implementation phases

Ordered, not time-estimated. Each phase is independently shippable; later
phases consume earlier phases' surfaces.

### P4.1 — Bus plumbing (no behavior change)

- Add `learningEvents` + `getLearningEvents()` to AgentDBService.
- Add `_resolveEventBus` + the four emits to AutopilotLearning.
- Test: a fresh AutopilotLearning + an attached listener observes the
  expected event count after a `recordTaskCompletion` /
  `recordIterationStep` / `endSwarmTrajectory` sequence.

No subscribers yet. No LearningSystem changes. Phase 2/3 tests stay green.

### P4.2 — LearningSystem subscriber (episode → submitFeedback)

- Add the autopilot-to-LearningSystem subscriber in AgentDBService boot.
- Test: after `recordTaskCompletion`, the corresponding
  `learning_experiences` row exists with the shaped reward, and the
  policy row for the synthesized session updates after multiple episodes.
- Risk-discharge test: drive 50 autopilot episodes; assert
  LearningSystem's `getMetrics({sessionId})` returns
  `policyImprovement.qValueImprovement != 0`.

### P4.3 — SONA pattern surface for autopilot read-back

- Extend `AgentDBLike` with `getSonaPatterns?(limit): SonaPattern[]`
  (delegates to `SonaRvfService.findPatterns` — sona-rvf-service.ts:139).
- Add `AutopilotLearning.getSonaPatterns()` read-only accessor.
- (No autopilot prediction change yet — read-back gives a future
  consumer a probe surface, but autopilot's own predictNextAction stays
  on the episode-based path. This phase exists to discharge ADR-0193
  Item B's "SONA trajectories without consumer" risk.)

### P4.4 — Subscriber error contract

- LearningSystem subscriber MUST re-throw fatal data-integrity errors
  per `feedback-best-effort-must-rethrow-fatals.md`. Catch only:
  - LearningSystem unavailable (`null` because earlier catch nuked it)
  - LearningSystem schema not yet provisioned (`SQLITE_ERROR: no such
    table: learning_experiences`)
- All other throws bubble to the EventEmitter's error path, which a
  default `'error'` listener on `learningEvents` surfaces via
  `console.error` (NOT swallow).

## Closure criteria

When Phase 4 is implemented:

- All four emit points in autopilot-learning.ts have unit tests that
  attach a spy listener and assert payload shape + emission count.
- The LearningSystem subscriber test asserts the
  `submitFeedback`-via-event path produces a `learning_experiences` row
  with the shaped reward (not the raw baseline).
- A negative test asserts the LearningSystem unavailable path: when
  AgentDBService.learningSystem is null (e.g., after a prior failure),
  episode emissions log `[AgentDBService] LearningSystem subscriber:
  learningSystem unavailable` via `console.error` and do NOT throw out
  of the bus.
- `getMetrics({available:true, episodes>=10})` and
  `LearningSystem.getMetrics({sessionId:'autopilot:...'})` agree on
  episode count.
- Status flips to `implemented`.

## Out of scope

- **Federation of events across processes.** That is ADR-0196 Phase 5.
- **Persistent event log.** Events are transient; episodes/trajectories
  are persistent on their own. A failed subscriber loses the in-flight
  signal but the source-of-truth row exists in `episodes`.
- **`AutopilotLearning.predictNextAction` rewrite to use LearningSystem.**
  ADR-0193 Item A.1 chose `recallSimilarTasks` + tally for a good reason
  (Phase 4 doesn't have a reason to swap, and doing so muddies the
  algorithm-comparison story Phase 4 enables). LearningSystem's policy
  improvements are observable via its own `getMetrics`.
- **Replacing the 3 `SonaTrajectoryService` / `SonaRvfService` instances
  with one.** The two `SonaTrajectoryService` instances at
  LearningSystem.ts:153 and controller-registry.ts:1470 are an
  intentional split (see the `INTENTIONAL SPLIT` comments at
  LearningSystem.ts:144-151 and controller-registry.ts:1463-1469). The
  `SonaRvfService` singleton at sona-rvf-service.ts:59-65 is what
  AutopilotLearning writes to via `getSonaService()`. Unifying is a
  separate ADR concern.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| `learningEvents.emit` synchronous listener throws break autopilot writes | low | high | EventEmitter's default behavior is synchronous; the bus owner attaches an `'error'` listener that logs + does not re-throw; subscribers wrap their handler in `setImmediate` so a slow consumer can't backpressure the producer. |
| Synthesized sessionId collisions across distinct autopilot subjects with same hash prefix | low | medium | Use SHA-1 (full 40-char hex) of subject string, not a substring; subject space is open but collision probability is negligible at autopilot's episode rate. |
| LearningSystem schema not yet provisioned at first emit | medium | low | P4.4 swallows `SQLITE_ERROR: no such table: learning_experiences` once, logs, and re-arms; the schema is loaded at AgentDB boot so this only happens during the AgentDBService init race window. Test the race explicitly. |
| EventEmitter listener leak across hot-reloaded MCP tool instances | medium | medium | autopilot-tools.ts:115 caches a module-level `_learningInstance` — the eventbus is on the long-lived AgentDBService, not the per-call AutopilotLearning, so producer churn doesn't leak listeners; subscribers register once at AgentDBService boot. |
| Subscriber registered before AutopilotLearning instance exists misses no events | n/a | n/a | This is the expected order (LearningSystem boots first, AutopilotLearning fires later); the bus is on AgentDBService so subscription order is fine. |
| Subscriber registered AFTER episodes have already been emitted misses those events | low | low | Out of scope by design — `episodes` table is the source of truth; a late-arriving subscriber can replay via `_listEpisodes` if it cares. Documented in §Out of scope. |

## Open questions

1. **Should `episode:recorded` carry the raw episode rowid?** It would
   let LearningSystem store `{transferred_from: episodeId}` in
   `learning_experiences.metadata` for joinability. Today the producer
   doesn't capture the AgentDB insert id (storeEpisode returns it but
   the value is discarded at autopilot-learning.ts:485). Adding capture
   is one line; the ADR should commit one way or the other before
   implementation.
2. **Synthesized sessionId scheme:** `autopilot:${sha1(subject)}` vs
   `autopilot:${subject.slice(0,32)}` vs `autopilot:default`. The first
   gives per-subject Q-learning; the third pools everything into one
   policy. ADR-059's wording leans toward per-subject but Phase 4
   should commit explicitly because `LearningSystem.predict`'s
   `learning_state_embeddings` cache (LearningSystem.ts:458-482) is
   session-scoped, which affects predict latency.
3. **Should the LearningSystem subscriber also consume
   `trajectory:closed` (in addition to `episode:recorded`)?** A closed
   trajectory has a full step sequence — feeding each step as a
   separate `submitFeedback` gives finer-grained RL learning than one
   episode-level feedback. The tradeoff is N inserts per swarm vs 1.
   Phase 4 should pick one (recommend episode-level for P4.2; trajectory
   step-level deferred to a future increment) and document.
4. **What is the cleanup path when a subscriber wants to unbind?**
   `learningEvents.removeListener` is stock EventEmitter, but the
   AgentDBService doesn't expose a `disposeLearningSubscriber` accessor.
   Probably unneeded for in-process; flag for ADR-0196.

## Implementation log

| Date | Commit (sparkling/agentic-flow main) | Scope |
|---|---|---|
| 2026-05-19 | `31a0c25` | `feat(autopilot): ADR-0195 Phase 4 cross-controller event bus + bridges (absorbs ADR-0197 F1)` — subscriber side: AgentDBService.learningEvents EventEmitter + getLearningEvents + getLearningSystem + _attachLearningSubscriber + _handleAutopilotEpisode (sha1-synthesized per-subject sessionId, shaped-reward submitFeedback). |
| 2026-05-19 | `1c0a079` | `feat(autopilot): ADR-0195 Phase 4 _resolveEventBus + _emitLearningEvent helpers` — producer side helpers on AutopilotLearning (mirrors _resolveSona; getLearningEvents on AgentDBLike). |
| 2026-05-19 | `3fa9ec9` | `feat(autopilot): ADR-0195 Phase 4 episode:recorded emit in _record` — episode:recorded emit after storeEpisode succeeds. |
| 2026-05-19 | `d06ba2c` | `feat(autopilot): ADR-0196 Phase 5 _record stamping + SyncCoordinator adapter` — combined commit also includes the three remaining Phase 4 trajectory emits (trajectory:opened in recordIterationStep first open, trajectory:step after each successful addStep, trajectory:closed after each successful endTrajectory). Phase 4 emit surface is now complete: all four emit points (1× episode + 3× trajectory) are wired to the bus. |
