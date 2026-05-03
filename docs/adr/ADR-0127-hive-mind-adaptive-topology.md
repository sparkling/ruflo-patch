# ADR-0127: Hive-Mind T9 — Adaptive topology with load-based optimization and auto-scaling

- **Status**: **Implemented (2026-05-03)** per ADR-0118 §Status (T9 complete).
- **Date**: 2026-05-02
- **Deciders**: Henrik Pettersen
- **Depends on**: ADR-0116 (hive-mind marketplace plugin), ADR-0118 (hive-mind runtime gaps tracker), ADR-0125 (T7 — Adaptive queen-type), ADR-0128 (T10 — topology runtime; provides `swarm.mutateTopology()` dispatch surface this ADR mutates into)
- **Related**: ADR-0114 (3-layer hive architecture — substrate/protocol/execution), ADR-0105 (topology behavior differentiation; marks `queen-coordinator.ts` as `@internal` — see Review notes), ADR-0104 (prompt-driven Queen architecture)
- **Scope**: Fork-side artifact for `sparkling/ruflo` distribution. Per `feedback-no-upstream-donate-backs.md`, this stays on `sparkling/main`; we do not file a PR against `ruvnet/ruflo`.

## Context

ADR-0116's verification matrix row "Adaptive topology" flagged the gap: the marketplace plugin README advertises load-based optimization and auto-scaling, but the runtime carries the claim only as a config flag. Concretely:

| Surface | Path | Current state | Effect |
|---|---|---|---|
| Auto-scaling config | `forks/ruflo/v3/@claude-flow/swarm/src/unified-coordinator.ts:585` | `autoScaling: config.autoScaling ?? true` | Boolean is set on construction and never read by any runtime decision loop |
| Health metrics surface | `forks/ruflo/v3/@claude-flow/swarm/src/queen-coordinator.ts:183` | `HealthReport` interface defined; `monitorSwarmHealth()` at line 1415 already produces reports stored in `healthHistory` (line 515) and `lastHealthReport` (line 525) | Metrics exist and are produced; **no consumer mutates topology or worker count from them**. Source already exists; only the consumer side is missing |
| USERGUIDE claim | `**Hive-Mind Coordination**` block | "Load-based optimization and auto-scaling" listed as a delivered capability | Promise without runtime backing |

The empirical line at `queen-coordinator.ts:183` is the interface declaration; the JSDoc opens at line 182. Either anchor is unambiguous; this ADR uses both per local context.

ADR-0118 §T9 captures this as the highest-risk task in the runtime-gaps tracker (risk: **high**) and explicitly names it as "the most likely candidate for ADR escalation" because autonomous-control surfaces raise safety concerns that don't apply to the lower-risk Tn items. T9 depends on T7 (ADR-0125 — adaptive queen-type) and T10 (ADR-0128 — per-topology dispatch). Both dependencies are partial in their current proposed form; see §Cross-task dependency posture for the precise gap each leaves.

This ADR escalates T9 ahead of implementation, rather than landing it as a §T9 inline change in ADR-0118. The implementation plan below is preliminary; if the hysteresis policy or dampening parameters become contested during implementation, work halts and a design ADR is written before code lands. Threshold defaults stated below (5s poll, 30s settle, 30s dampening, CoV [0.3, 0.6], queue depth > 3) are placeholders chosen for plausibility, not measurement-derived; see §Risks and §Review notes.

## Decision Drivers

- **USERGUIDE contract.** The Hive-Mind block advertises "load-based optimization and auto-scaling" as a delivered capability. ADR-0116's verification matrix flagged this as documentation-only; closing the gap requires a runtime that observes load and acts on it.
- **`autoScaling` flag is dead code.** `unified-coordinator.ts:585` sets the boolean on construction. No call site reads it. The feature ships in name only. `monitorSwarmHealth()` already produces `HealthReport`s, but no consumer mutates state from them — the gap is on the consumer/decision side, not the production side.
- **Autonomous-control safety.** The loop terminates workers and switches topologies without operator acknowledgement. Hysteresis and dampening are not optimisations — they are required safety controls. Setting them late or implicitly invites oscillation, mid-task data loss, and coordination thrash. A bounded flip-rate (max-flips-per-window) circuit-breaker is required, not just hysteresis (see §Specification).
- **T7 (ADR-0125) is the natural decision-maker — but T7 in its current proposed shape does not provide a programmatic decision plane.** ADR-0125 differentiates queen types via prompt body only ("queen behaviour differentiation is mediated entirely through the LLM-facing prompt"; §Architecture: "Swarm coordinator: zero queenType branching added"). The adaptive queen prompt instructs an LLM to choose Strategic/Tactical mode and to call `_consensus`; it does not expose a method that consumes `HealthReport` and dispatches `swarm.scale()` / `swarm.mutateTopology()`. T9 either (a) waits for T7 to add a programmatic surface, (b) adds the consumer in a queen-side TS module that ADR-0125 leaves untouched, or (c) escalates T7 first to provide it. This ADR picks (b) for scaling and defers topology mutation until T10 lands; see §Cross-task dependency posture.
- **No parallel control plane in coordinator.** The coordinator polls metrics and emits `HealthReport` events; it does not decide on its own. Decisions cross the queen boundary. ADR-0114's substrate/protocol/execution layering forbids the coordinator from bypassing the protocol layer.
- **ADR-0105 layering caveat.** ADR-0105 §Recommendation marks `swarm/src/queen-coordinator.ts` as `@internal — V2→V3 migration target, superseded by ADR-0104 prompt-driven Queen` and explicitly says "don't wire" it. Extending `HealthReport` at line 183 inside that file is fine as a type-level extension (the interface is already exported and consumed elsewhere), but adding a queen-side **consumer class method** inside `queen-coordinator.ts` would re-wire a file ADR-0105 explicitly parks. The consumer therefore lives in a new module (`swarm/src/adaptive-loop.ts` or equivalent), not in `queen-coordinator.ts` itself. See §Architecture and §Review notes.
- **ADR-0118 escalation rule.** §T9 is named "the most likely candidate for ADR escalation." If hysteresis policy / dampening parameters become contested during implementation, work halts and a design ADR is written before merge. This ADR carries that rule forward.

## Considered Options

- **Option A — Poll loop in `unified-coordinator.ts` + queen-side consumer (`adaptive-loop.ts`) consumes `HealthReport` events.** Coordinator polls `_status` health metrics on a fixed interval, computes deltas + breach durations + flip-rate counts, emits `HealthReport`. The queen-side consumer (a new TS module, NOT T7's LLM-driven adaptive queen prompt) consumes events, decides, calls back into coordinator's `swarm.scale()` / `swarm.mutateTopology()`. **CHOSEN.**
- **Option B — Event-driven from queue depth (no poll, no timer).** Coordinator emits `HealthReport` only when worker queue depth crosses a threshold. No background loop, no interval timer, no idle ticking.
- **Option C — Declarative thresholds in config table (no runtime, no learning).** Operator declares thresholds in `swarm.config.json`; coordinator enforces them mechanically without queen involvement. No autonomous decision plane; ship the surface as configuration only.

## Pros and Cons of the Options

### Option A — Poll loop + queen-side consumer (CHOSEN)

- Pro: protocol-layer authority is centralised in one new module (`adaptive-loop.ts`); no parallel control plane in coordinator
- Pro: dampening / settle window / flip-rate ceiling all explicit and centralised in the loop's tick predicate (one place, not three)
- Pro: `HealthReport` shape gives the consumer full picture (queue percentiles, idle count, CoV, breach duration, flips-in-window) for combined decisions
- Pro: routes through ADR-0114 protocol layer cleanly (coordinator → event → consumer → mutation)
- Con: poll interval introduces latency (preliminary 5s) between threshold breach and action
- Con: idle ticking even under steady-state load
- Con: consumer unreachable blocks scaling; loop must halt loudly, not fall back
- Con: requires a new TS module, not just inline coordinator changes — T7's prompt-only shape forces this (see §Cross-task dependency posture)

### Option B — Event-driven from queue depth

- Pro: zero latency on threshold breach (event fires the moment queue depth crosses)
- Pro: no idle work
- Pro: with a bounded debounce buffer (single timer per axis, fired only on sustained state), Option B converges on Option A's behaviour with finer-grained reaction; the gap closes if the 5s poll proves too coarse in practice. This is genuinely competitive, not strawman.
- Con: dampening must live somewhere. Option A puts it in the loop's settle predicate (one place). Option B's "buffered event consumer" reintroduces a timer per axis (queue depth, CoV, idle count) and an explicit settle window across them — three timers + cross-axis coordination, not one.
- Con: queue depth alone misses the uneven-load topology trigger (CoV is a population stat computed across the worker set, not an edge event on a single worker's queue). Option B has to either run a second polling pass for CoV (defeating the "no poll" pro) or accept that topology mutation is poll-driven while scaling is event-driven (split control surface).
- Con: "split control surface" matters because the global settle window applies across scale + topology actions; a split design has to coordinate the timer and the event-debouncer manually. Option A does this for free in one tick.

Reconsider B if (a) the 5s poll proves too coarse for scale reaction during real load tests, AND (b) the buffered debounce can be expressed without re-introducing the cross-axis settle-window coordination problem.

### Option C — Declarative thresholds, no runtime

- Pro: no autonomous control surface — operator owns every decision
- Pro: zero oscillation risk; nothing fires without config
- Pro: simplest implementation
- Con: doesn't satisfy USERGUIDE contract ("auto-scaling")
- Con: no learning, no adaptation; static config can't track load patterns
- Con: parks the gap permanently; ADR-0116 row never lifts

## Decision Outcome

**Chosen option: A — poll loop + queen-side consumer**, because:

1. Dampening, settle window, and flip-rate ceiling all live in one place (the loop's tick predicate), making the autonomous-control safety surface explicit and auditable. Option B splits these across an event debouncer plus a separate CoV poll.
2. `HealthReport` carries enough state (queue percentiles, idle count, load CoV, breach duration, flips-in-window) for the consumer to make combined scale + topology decisions and to short-circuit redundant ones, rather than splitting them across event types.
3. Layering stays intact: coordinator observes (execution layer), consumer decides (protocol layer), coordinator executes mutation on consumer's instruction. Option C removes the protocol layer entirely; Option B blurs it (events fire from the execution layer's edge events without protocol-layer mediation).
4. The decision plane is a new TS module (`adaptive-loop.ts`), not a method on T7's prompt-only adaptive queen. This shift from "queen consumer" to "queen-side consumer" is forced by T7's prompt-only shape (see §Cross-task dependency posture); Option A's structure tolerates this rewording while B and C don't naturally accommodate the protocol-layer-but-not-LLM-queen placement.

Options B and C fail on dampening / contract grounds respectively. **B is reconsidered if** (a) the 5s poll interval proves too coarse for scale reaction during real load tests AND (b) the buffered-debounce design can be expressed without re-introducing cross-axis settle-window coordination — both must hold, not either. **C is reconsidered only if** autonomous control is removed from the USERGUIDE contract; this would also lift the ADR-0116 verification matrix row to "documented as manual config" rather than satisfied.

## Consequences

### Positive

- Protocol-layer authority centralised in `adaptive-loop.ts`; no parallel control plane in `unified-coordinator.ts`; no behavioural re-wiring of ADR-0105's parked `queen-coordinator.ts`
- Hysteresis, dampening, AND flip-rate ceiling explicit and centralised in one tick predicate; no scattered threshold checks
- `HealthReport` shape (extended type-only at line 183) gives the consumer combined view for cross-axis decisions (scale + topology); existing `monitorSwarmHealth()` source reused, not parallelised
- ADR-0114 layering preserved (coordinator observes → consumer decides → coordinator executes); ADR-0105 layering preserved (queen-coordinator.ts is type-extension only)
- Annotation-lift path clear: scaling component closes the ADR-0116 row's scale half once T9 acceptance is green; topology half closes once T10 lands `swarm.mutateTopology()`

### Negative

- Oscillation risk on threshold edges if dampening defaults are wrong. Mitigated by (a) 2× threshold gap, (b) global settle window, AND (c) max-flips-per-window circuit-breaker (preliminary: 4 flips per hour halts the loop loud per `feedback-no-fallbacks.md`). The first two bound steady-state oscillation; the third bounds adversarial / pathological input. All three values are **PRELIMINARY** and may need their own ADR if contested.
- Partition during a scale event leaves queen and coordinator with different worker-count beliefs. The reconciliation strategy is "next `HealthReport` carries actual `_status` worker count; queen reconciles on receipt", but this is non-trivial when the partition is asymmetric (queen reachable from coordinator, half the workers unreachable). In that case the `_status` worker count is itself a partial view and the queen will scale based on the visible subset. Treated explicitly in §Refinement.
- Queen unreachable blocks scaling; per `feedback-no-fallbacks.md`, the loop halts loudly rather than fall back to coordinator-local decisions. The halt criterion is bounded: queen unreachable for > 1 dampening window → halt. Not "any one missed event".
- Mid-task topology switch is hard to make safe; in-flight task state must survive the switch or the switch must defer. The switch-deferral bound (preliminary: 3 dampening windows) plus loud abandonment if the bound is crossed is the only safe shape — silently skipping the switch would be a `feedback-no-fallbacks.md` violation.
- Idle poll cost (preliminary 5s interval) under steady-state load — small but non-zero.
- Coupling to T10. The topology-mutation responsibility cannot be exercised end-to-end until T10 (ADR-0128) lands `swarm.mutateTopology()` as a real dispatch surface. Until then, T9 ships scaling-only and topology mutation is type-level (queen emits the decision; mutation call returns a not-implemented marker that fails loudly). See §Cross-task dependency posture.

## Validation

### Unit tests (`tests/unit/`)

- **`dampening-predicate.test.mjs`**: threshold crossings under settle window produce zero actions; sustained crossings produce one action
- **`threshold-math.test.mjs`**: high-water > low-water enforced; CoV thresholds 0 ≤ low < high ≤ 1 enforced; NaN and negative queue depth throw loud
- **`health-report-delta.test.mjs`**: queue percentiles, idle worker count, load CoV correctness on synthetic worker arrays
- **`flip-rate-ceiling.test.mjs`**: 4 flips within a 1h sliding window halts the loop; 4 flips spanning the window boundary do NOT halt
- **`abandoned-switch-surfaces.test.mjs`**: switch deferred past 3 dampening windows emits a fault on `_status`, never silently no-ops

### Integration tests (`tests/unit/`)

- **`oscillation-flap.test.mjs`**: flap load just above and below threshold; assert zero topology switches and zero scale actions across the flap window
- **`sustained-scale-up.test.mjs`**: drive queue depth above high-water for ≥ dampening window; assert exactly one spawn
- **`sustained-scale-down.test.mjs`**: drive a worker to idle for ≥ dampening window; assert exactly one termination, never below configured minimum
- **`topology-switch.test.mjs`**: sustained uneven load (CoV > high threshold for dampening window) → `hierarchical` → `mesh` decision emitted by consumer; until T10, mutation throws not-implemented marker; reverse assertion after load stabilises
- **`adversarial-flip-rate.test.mjs`**: load tuned to satisfy dampening on every flip → circuit-breaker halts after 4 flips, not silent toleration
- **`partition-asymmetric.test.mjs`**: half workers unreachable → loop suspends scaling, emits partition fault rather than scaling on partial view

### Acceptance tests

- **`acceptance-adr0127-scale-event.sh`**: end-to-end scale event in init'd project — drive load via test harness; assert worker count adjusted in `_status`
- **`acceptance-adr0127-runtime-presence.sh`**: verify adaptive topology runtime presence (loop registered, `HealthReport` emitted with new fields, `adaptive-loop.ts` consumer wired); does not exercise full simulation
- **Topology mutation acceptance**: deferred until T10 lands; until then, asserts the consumer emits `cov-high`/`cov-low` decisions and that `swarm.mutateTopology()` throws the not-implemented marker — per §Cross-task dependency posture

### ESCALATION CHECKPOINT

**If dampening parameters (poll interval, settle window, threshold gap, CoV bounds, per-type minimum, flip-rate ceiling) become contested during implementation — meaning more than one defensible default exists and the choice is not mechanical — halt implementation and write a design ADR before merge.** This is the ADR-0118 §T9 escalation rule, carried forward verbatim and extended with the flip-rate ceiling parameter. The default position (5s poll, 30s settle, 30s dampening, 2× threshold gap, CoV [0.3, 0.6], per-type min 1, max 4 flips/hour) is **PRELIMINARY** — a starting point for the implementation prompt, not a settled decision. Defaults that prove indefensible against the adversarial-flip-rate or partition-asymmetric tests are themselves an escalation trigger.

## Decision

**Convert the `autoScaling` boolean flag into a runtime control loop that polls `_status` health metrics and acts on them.** The loop has three responsibilities, in order of escalation:

1. **Worker count adjustment** (lowest risk): scale up when queue depth exceeds a high-water threshold; scale down idle workers when activity drops below a low-water threshold.
2. **Topology mutation** (high risk; gated by T10): emit a switch decision from `hierarchical` to `mesh` when load CoV exceeds the high threshold; from `mesh` to `hierarchical` when CoV drops below the low threshold. Until T10 lands `swarm.mutateTopology()`, mutation calls return a not-implemented marker; decision emission is exercised end-to-end. Once T10 is green, mutations are real.
3. **Hysteresis, dampening, and flip-rate circuit-breaker** (safety control): three predicates on every action — sustained crossing for the dampening duration, global settle window since last action, AND a max-flips-per-window ceiling that halts the loop on adversarial input. Default values are stated below as **preliminary** — they may need their own ADR if contested.

The decision-maker is a NEW TS module (`adaptive-loop.ts`), not the LLM-driven adaptive queen prompt T7 produces. T7 is prompt-only and has no programmatic surface; the consumer here lives on the queen's side of the coordinator boundary (per ADR-0114) but in code rather than in an LLM session. The control loop runs in `unified-coordinator.ts`; threshold breaches surface as `HealthReport` events that `adaptive-loop.ts` consumes and acts on. This keeps the autonomous-control surface routed through a protocol-layer authority rather than creating a parallel control plane in the coordinator and rather than re-wiring the parked `queen-coordinator.ts` (per ADR-0105).

## Implementation plan

Five bullets, lifted from ADR-0118 §T9.

### 1. Runtime loop polling `_status` health metrics

`forks/ruflo/v3/@claude-flow/swarm/src/unified-coordinator.ts:585`. Replace the construction-time `autoScaling: config.autoScaling ?? true` flag with a runtime poll loop. The loop reads `_status` health metrics on a fixed interval (preliminary: 5s) and emits `HealthReport` deltas. The boolean is preserved as a "loop enabled?" gate, not as the loop's only effect.

### 2. Scaling triggers — spawn and terminate workers

In the same file, add two thresholds:

- **High-water (scale up)**: if worker queue depth > threshold (preliminary: per-worker queue depth > 3) for the dampening window (preliminary: 30s), spawn one additional worker of the type currently most-backlogged.
- **Low-water (scale down)**: if a worker has been idle (queue depth = 0, no active task) for the dampening window, terminate it. Never scale below the configured minimum (preliminary: 1 worker per declared type).

### 3. Topology mutation — hierarchical ↔ mesh under uneven load

In the same file, add a topology-mutation trigger. When load coefficient-of-variation across workers exceeds a threshold (preliminary: CoV > 0.6) for the dampening window, emit a switch decision from `hierarchical` to `mesh`. When CoV drops below the lower threshold (preliminary: 0.3) for the dampening window, emit the reverse decision. Switches go through the queen-side consumer (`adaptive-loop.ts`), not directly mutate coordinator state. **Until T10 lands `swarm.mutateTopology()`**, the consumer emits the decision and the mutation call returns a not-implemented marker that throws loud per `feedback-no-fallbacks.md`. Acceptance tests assert the throw at this stage; once T10 is green, tests assert the actual switch.

### 4. Wire `HealthReport` interface at `queen-coordinator.ts:183` AND new consumer module

Two changes:

- **Type-level extension** at `forks/ruflo/v3/@claude-flow/swarm/src/queen-coordinator.ts:183` (interface declaration; JSDoc opens at line 182). Extend `HealthReport` with the deltas the coordinator's loop produces (queue-depth percentiles, idle-worker count, load CoV, `breachedThreshold`, `breachDurationMs`, `pollTimestamp`, `flipsInWindow`). No consumer method added to this file (per ADR-0105's `@internal` marker).
- **New module** `forks/ruflo/v3/@claude-flow/swarm/src/adaptive-loop.ts`. Translates `HealthReport` events into `swarm.scale()` and `swarm.mutateTopology()` calls. Subscribes to the coordinator's event bus on startup; stores per-axis flip counts; halts loud on flip-rate ceiling, mutation error, or consumer-side failure. The consumer is the protocol-layer authority described in §Architecture and §Decision Drivers; it is NOT the LLM-driven adaptive queen prompt T7 produces.

### 5. Tests for load-driven scale-up/down, topology decision, and circuit-breaker

Full test list lives in §Validation; this step is the implementation prompt's anchor. The minimum bar before the loop ships:

- Scale-up under simulated queue depth: drive queue depth above threshold for the dampening window; assert one additional worker spawned, no spawns before the dampening window elapses
- Scale-down under sustained idle: drive a worker to idle for the dampening window; assert termination, but never below the configured minimum
- Topology decision under uneven load: simulate one worker saturated, others idle; assert `cov-high` decision emitted by the consumer after dampening window; until T10, assert `swarm.mutateTopology()` throws not-implemented marker; once T10 is green, assert the actual switch
- Hysteresis case: flap load just at threshold; assert no oscillation (no decisions fire)
- Adversarial flip-rate: load tuned to satisfy dampening on every flip; assert circuit-breaker halts the loop after 4 flips
- Partition asymmetric: half workers unreachable; assert loop suspends scaling and emits partition fault

Per `feedback-all-test-levels.md`, all three levels (unit + integration + acceptance) ship in the same commit. See §Validation for the full breakdown.

## Specification

The control loop has three responsibilities, listed in ascending risk order. Implementation lands them in this order; lower-risk responsibilities ship first so dampening behaviour can be validated before higher-risk mutations are wired in.

1. **Worker count adjustment (LOW risk).** Spawn one additional worker when queue depth exceeds the high-water threshold for the dampening window; terminate one idle worker when queue depth has been zero for the dampening window. Never scale below the configured per-type minimum. Mutations cross the queen boundary; coordinator does not self-spawn.
2. **Topology mutation (HIGH risk; depends on T10 — see §Cross-task dependency posture).** Switch from `hierarchical` to `mesh` when load CoV exceeds the high CoV threshold for the dampening window; switch back when CoV drops below the low CoV threshold for the dampening window. Mutations cross the queen boundary; coordinator does not self-mutate. In-flight tasks must survive the switch; if any worker has a non-empty active task set, defer the switch until the next loop tick. Until T10 lands `swarm.mutateTopology()` as a real dispatch surface, this responsibility ships type-level only — the queen emits the decision; the mutation call returns a not-implemented marker that fails loudly per `feedback-no-fallbacks.md`.
3. **Hysteresis, dampening, AND flip-rate circuit-breaker (SAFETY control).** Three-stage gate on every action:
   - (a) **Dampening**: threshold must be crossed in the same direction for at least the dampening duration before the loop emits a `HealthReport` carrying the breach.
   - (b) **Settle window**: settle window must have elapsed since the last action of any kind. The settle window is global across scale + topology actions, not per-axis, so a scale-up cannot immediately precede a topology switch.
   - (c) **Flip-rate ceiling**: the loop maintains a sliding-window count of mutations per axis. If the count exceeds `maxFlipsPerWindow` (preliminary: 4 flips per hour), the loop halts loudly and emits a fault on `_status` per `feedback-no-fallbacks.md`. This bounds adversarial / pathological inputs that hysteresis alone cannot — a load oscillating at exactly the right cadence to satisfy dampening on every flip will still be capped.

### `HealthReport` event shape

Extends the existing interface at `forks/ruflo/v3/@claude-flow/swarm/src/queen-coordinator.ts:183` (interface declaration; JSDoc at line 182). The existing fields (`reportId`, `timestamp`, `overallHealth`, `domainHealth`, `agentHealth`, `bottlenecks`, `alerts`, `metrics`, `recommendations`) are preserved. Added fields:

- `queueDepthP50`, `queueDepthP90`, `queueDepthP99` — population percentiles across workers
- `idleWorkerCount` — workers with zero queue depth and no active task for ≥ 1 poll interval
- `loadCoV` — coefficient of variation of per-worker load (queue depth + active task weight)
- `breachedThreshold` — enum: `high-water` | `low-water` | `cov-high` | `cov-low` | `none`
- `breachDurationMs` — how long the breach has persisted (used by queen to confirm dampening was honoured)
- `pollTimestamp` — monotonic time of the poll that produced this report
- `flipsInWindow` — count of mutations on this axis in the trailing flip-rate window (used by queen to short-circuit redundant decisions and by the loop to enforce the circuit-breaker ceiling)

### Threshold values (all PRELIMINARY — placeholders, not measurement-derived)

These defaults are chosen for plausibility against typical hive workloads (a few workers, sub-minute task cadence). They are NOT derived from load-test measurement. The implementation prompt should treat them as starting points; the integration tests should record actual breach-vs-action latencies under simulated load and feed back into these values. If any of them prove indefensible against measurement, halt and escalate per the ADR-0118 §T9 rule.

- Poll interval: **5s** — basis: latency budget for scale reaction (workers are spawned in seconds, not ms; sub-second polling is wasted; > 10s loses reaction window)
- Settle window between any two control actions: **30s** — basis: a spawn typically takes < 5s to register in `_status`; a 30s window covers the spawn + initial task assignment without bouncing
- Dampening duration before threshold crossing emits a report: **30s** — same basis as settle window; mirrors the action stabilisation time
- High-water queue depth: per-worker queue depth > **3** — basis: a worker comfortably handles 1-2 queued tasks; 3+ is sustained backlog
- Low-water queue depth: per-worker queue depth = **0** — strict zero, not "low"; ensures we don't terminate workers carrying any queued work
- High CoV threshold: **0.6** — basis: CoV > 0.5 is conventionally "high variability"; 0.6 leaves headroom for noise
- Low CoV threshold: **0.3** — basis: 2× hysteresis gap below the high threshold; 0.3 is conventionally "moderate variability"
- Per-type worker minimum: **1** — basis: each declared type must have at least one live worker; sub-minimum termination would silently break the worker-type contract from T8 (ADR-0126)
- Max flips per hour (per axis): **4** — basis: order-of-magnitude guess. 4/hour ≈ one mutation per dampening window; sustained mutation at this rate is itself a signal that thresholds are wrong, which is exactly when the loop should halt and escalate

**All eight values above are PRELIMINARY.** The "basis" notes are reasoning, not measurement. None of these has been validated against live workload telemetry. The implementation prompt must run integration tests with synthetic load profiles and record `(threshold, dampening, settle, flip-rate) → (false-positive rate, false-negative rate, time-to-correct-action)`; if any default lands in a degenerate regime (constant flap, persistent under-reaction, etc.), escalate per the ADR-0118 §T9 rule before merging.

### Queen-consumes-events contract

The queen-side consumer subscribes to `HealthReport` on the coordinator's event bus. The consumer calls back into `swarm.scale(direction, type)` and `swarm.mutateTopology(target)` on the coordinator. The coordinator does not call queen methods directly; control flows coordinator → event → queen-side consumer → method-call → coordinator. If the queen-side consumer is unreachable for the duration of the next dampening window, the loop halts and surfaces an error per `feedback-no-fallbacks.md`.

The "queen-side consumer" is a TypeScript module — not the LLM-driven adaptive queen prompt from ADR-0125. T7's prompt-only queen has no method surface. The decision logic in §Pseudocode runs in code, not in an LLM call. The naming "queen-side consumer" reflects that decisions sit on the protocol-layer side of the coordinator boundary (per ADR-0114) and serve the same authority role the spawned LLM queen serves for task-level decisions, but in mechanical / non-LLM form. See §Cross-task dependency posture.

### Cross-task dependency posture

T9 inherits two soft dependencies that affect what can ship in a single PR:

- **T7 (ADR-0125 — adaptive queen-type) is prompt-only.** ADR-0125 differentiates queen types via prompt body; it does not introduce a programmatic decision plane. T9 cannot route decisions through "the queen" as a TS object because no such object exists for the prompt-driven queen. T9 ships its decision logic in a new module (`swarm/src/adaptive-loop.ts` or similar) that ADR-0114 calls "the protocol-layer consumer" — distinct from the LLM-driven adaptive queen prompt. This consumer is named "queen-side" because it sits on the queen's side of the coordinator boundary, not because it lives inside the LLM queen's prompt. Restated in §Architecture.
- **T10 (ADR-0128 — topology runtime) provides the dispatch surface T9 mutates into.** ADR-0128 §Implementation plan introduces `swarm.mutateTopology()` as the per-topology dispatch site at the worker-spawn path. T9 lands BEFORE T10 (per ADR-0118 §Dependency graph: T10 → T9). This means T9 cannot exercise topology mutation end-to-end at the time it ships. T9's topology-mutation responsibility ships type-level only — the consumer emits the decision; `swarm.mutateTopology()` returns a not-implemented marker that throws loud per `feedback-no-fallbacks.md` until T10 lands. Scaling responsibility (worker count) is independent of T10 and ships fully exercised.

This is an explicit acceptance of partial functionality at T9 land time. T10 closes the loop. The acceptance check (§Validation) reflects this — adaptive scaling is asserted end-to-end; adaptive topology mutation is asserted at the type / event-emission level only until T10 is green.

## Pseudocode

### Poll loop scheduling

The loop runs on a `setInterval` of poll-interval ms, gated by the `autoScaling` boolean (preserved as "loop enabled?"). Each tick: read `_status`, compute deltas vs. last tick, update breach-duration counters, decide whether to emit a `HealthReport`. The loop never blocks; if a tick is still running when the next interval fires, the next tick is dropped (logged but not retried).

### Threshold check + dampening logic

For each axis (queue-depth, CoV): if the current measurement is on the breach side of the threshold, increment the breach-duration counter by the elapsed-since-last-tick value. If on the safe side, reset the counter to zero. Emit a `HealthReport` with `breachedThreshold` set only when the counter exceeds the dampening duration AND the global settle window since the last action has elapsed. Otherwise, emit nothing (or emit a `none`-breach report on a slower cadence for queen observability).

### Queen-side consumer `onHealthReport` handler

The consumer (`adaptive-loop.ts`) receives a `HealthReport`, inspects `breachedThreshold` and `flipsInWindow`, and selects a mutation:

- `high-water` → if `flipsInWindow.scale < maxFlipsPerWindow`, call `swarm.scale('up', mostBackloggedType)`; else halt loud (circuit-breaker)
- `low-water` → identify the longest-idle worker; if `flipsInWindow.scale < maxFlipsPerWindow` and termination preserves the per-type minimum, call `swarm.scale('down', that-worker.type)`; else halt loud (circuit-breaker) or skip (minimum preserved)
- `cov-high` → if `flipsInWindow.topology < maxFlipsPerWindow`, call `swarm.mutateTopology('mesh')`, deferred if any worker has an active task; else halt loud. Until T10 lands, `swarm.mutateTopology()` returns the not-implemented marker; consumer logs and continues (this is the only expected non-fatal return on this call).
- `cov-low` → symmetric to `cov-high`, target `hierarchical`
- `none` → no-op

The consumer records the action timestamp + per-axis flip count; the coordinator's loop reads both on the next tick to enforce the global settle window AND the flip-rate ceiling. Deferred topology switches that exceed the deferral bound (3 dampening windows) emit a fault; they do NOT silently no-op.

### Scale-up flow

Coordinator emits `high-water` → consumer (`adaptive-loop.ts`) receives → consumer checks `flipsInWindow.scale` against ceiling (halt-loud if exceeded) → consumer picks worker type from `HealthReport.queueDepthP90` profile → consumer calls `swarm.scale('up', type)` → coordinator spawns worker → coordinator records action timestamp + increments `flipsInWindow.scale` → next tick's settle-window + flip-rate checks see recent action and suppress further reports.

### Scale-down flow

Coordinator emits `low-water` → consumer receives → consumer checks `flipsInWindow.scale` against ceiling → consumer identifies longest-idle worker → consumer verifies termination preserves per-type minimum (if not, skips silently — minimum is a hard floor, not an error) → if so, calls `swarm.scale('down', worker)` → coordinator terminates worker after confirming empty active task set → records action timestamp + increments flip count.

### Topology-switch flow

Coordinator emits `cov-high` → consumer receives → consumer checks `flipsInWindow.topology` against ceiling (halt-loud if exceeded) → consumer checks aggregate active-task count via `HealthReport.idleWorkerCount` complement → if any active tasks, consumer defers and waits for next tick (deferral counter increments; abandonment-fault on bound exceedance per §Refinement) → if zero active tasks, consumer calls `swarm.mutateTopology('mesh')` → **until T10**, the call returns the not-implemented marker; consumer logs and the deferral counter resets → **once T10 is green**, coordinator atomically swaps topology config → records action timestamp + increments `flipsInWindow.topology`. Reverse path for `cov-low`.

## Architecture

### Touched files

- `forks/ruflo/v3/@claude-flow/swarm/src/unified-coordinator.ts:585` — `autoScaling: config.autoScaling ?? true` boolean replaced with a runtime poll loop. Boolean preserved as the loop's enabled-gate, not as the loop's only effect. The poll loop is colocated with the coordinator's existing event bus; `HealthReport` events are emitted on that bus. The loop reuses the existing `monitorSwarmHealth()` source surface where possible (the report producer at line 1415 already exists; this ADR adds the loop's polling cadence and the new fields, not a parallel report producer).
- `forks/ruflo/v3/@claude-flow/swarm/src/queen-coordinator.ts:183` — **type-level extension only.** The `HealthReport` interface declaration at line 183 (JSDoc at 182) is extended with the fields from §Specification. **No consumer method is added to this file.** ADR-0105 marks `queen-coordinator.ts` as `@internal — V2→V3 migration target, superseded by ADR-0104 prompt-driven Queen`; adding a consumer method here would re-wire a parked file. The interface is already exported and consumed elsewhere, so extending the type is fine; adding behaviour is not.
- `forks/ruflo/v3/@claude-flow/swarm/src/adaptive-loop.ts` (NEW) — the protocol-layer queen-side consumer. Subscribes to `HealthReport` on the coordinator's event bus, decides, calls back into the coordinator's `swarm.scale()` / `swarm.mutateTopology()`. This module is the "queen-side consumer" referenced throughout this ADR. It is distinct from the LLM-driven adaptive queen prompt T7 produces; see §Cross-task dependency posture.

### Data flow

`_status` health metrics → coordinator's poll loop computes deltas + breach durations + flip-rate counts → coordinator emits `HealthReport` (only when dampening + settle-window + flip-rate predicates pass) → queen-side consumer (`adaptive-loop.ts`) consumes event → consumer decides + calls back → coordinator executes mutation → coordinator records action timestamp + increments per-axis flip count → next tick's settle-window + flip-rate checks see the recorded action.

### Control plane stays on queen side of the boundary

Coordinator observes; the queen-side consumer decides; coordinator executes. There is no path where the coordinator decides without consumer involvement. This preserves ADR-0114's layering (coordinator = execution layer; consumer = protocol layer) and avoids a parallel control plane that would duplicate the queen's authority over coordination decisions. The consumer is a TS module, not an LLM-driven prompt; ADR-0125's prompt-only adaptive queen continues to make task-level decisions in its own LLM session, while `adaptive-loop.ts` makes scale/topology decisions in code.

## Refinement

### Edge cases

- **Oscillation between hierarchical ↔ mesh.** Hysteresis required: 2× threshold gap (high CoV 0.6, low CoV 0.3 — both **PRELIMINARY**), a global settle window, AND the flip-rate circuit-breaker (preliminary 4 flips/hour per axis) bound flap-driven switches. The first two control steady-state oscillation; the circuit-breaker bounds adversarial input. Unit test: flap load just at threshold; assert zero switches. Adversarial test: drive load to satisfy dampening on every flip; assert circuit-breaker halts the loop after 4 flips, not silent toleration.
- **Partition during a scale event — symmetric.** Queen-side consumer and coordinator briefly disagree on worker count if the event bus drops a message mid-spawn. The next `HealthReport` carries the actual `_status` worker count; consumer reconciles on receipt. No special path; reconciliation is implicit in the next tick.
- **Partition during a scale event — asymmetric.** The hard case: the consumer is reachable from the coordinator, but half the workers are unreachable (network split, node failure). `_status` worker count reflects the visible subset, not the actual count. Two failure modes:
   1. The consumer scales up because P90 queue depth on the visible subset exceeds high-water → fleet over-provisions when the partition heals.
   2. The consumer scales down idle workers on the visible subset because their queue depth reads zero → the fleet under-provisions when the partition heals (reachable workers were terminated; unreachable ones may be alive and busy).
   Mitigation: the loop reads `_status.partitionDetected` (existing field; check empirically — see Review notes); if true, the loop suspends scaling decisions for the partition's duration and surfaces a fault per `feedback-no-fallbacks.md`. Scaling decisions on partial views are NOT safe; do not attempt them. If `partitionDetected` is not yet a real field, this ADR depends on the partition-detection work landing first or on a follow-up ADR exposing it.
- **Queen-side consumer unreachable.** Per `feedback-no-fallbacks.md`, no fallback to coordinator-local decisions. The loop halts loudly: log error, suppress further `HealthReport` emissions, surface the failure on `_status`. Operator restarts the consumer module; the loop resumes on next tick.
- **Metric-poll timeout.** A `_status` read that exceeds the poll interval is treated as a tick failure; the loop drops the tick and continues. Persistent timeouts (≥ 3 consecutive) are a halt-loud condition.
- **Scale during active task.** Scale-down with non-empty active task set is not allowed; the consumer defers until the worker drains. Scale-up never blocks.
- **Topology switch during active task.** Switch is deferred (not abandoned) until all workers report empty active task sets. Defer is bounded by 3 dampening windows; if a switch is deferred past the bound, the consumer **abandons the switch attempt loudly** — emits a fault on `_status`, increments a `topology_switch_abandoned` counter, and does NOT silently no-op. The next breach starts the dampening counter from scratch. Per `feedback-no-fallbacks.md`, silent abandonment would be a contract violation.
- **Flip-rate ceiling exceeded.** Sustained mutation at maxFlipsPerWindow (preliminary 4/hour per axis) → loop halts, surfaces fault, requires operator acknowledgement to resume. The fault carries the recent action history so the operator can diagnose the threshold misconfiguration.
- **Thresholds NEVER met.** Steady-state load that never crosses any threshold produces zero actions and zero `HealthReport`s with `breachedThreshold != none`. The loop ticks idly. This is the expected default behaviour and is not an error.
- **Topology mutation before T10 lands.** As noted in §Cross-task dependency posture, `swarm.mutateTopology()` returns a not-implemented marker until T10. The consumer's topology decision still emits a `HealthReport` with `breachedThreshold ∈ {cov-high, cov-low}`, but the mutation call throws loud. Tests assert the throw at this stage; once T10 lands, tests assert the actual switch.

### Error paths

No fallbacks. Every error path halts the loop loudly and surfaces the failure. Specifically:

- Queen-side consumer unreachable for one full dampening window → halt loop, surface error
- `_status` read fails 3 consecutive ticks → halt loop, surface error
- Mutation call (`swarm.scale` / `swarm.mutateTopology`) returns error → halt loop, surface error, do NOT retry
- Threshold math produces NaN / out-of-bound (corrupt metrics) → halt loop, surface error
- Flip-rate ceiling exceeded on any axis → halt loop, surface error, require operator acknowledgement
- Topology switch deferred past the deferral bound → emit fault, do NOT silently abandon
- `swarm.mutateTopology()` returns the not-implemented marker (pre-T10) → not an error of the consumer; the consumer logs the marker as expected pre-T10 behaviour. Once T10 lands, the marker is removed and any return becomes a halt-loud condition.

### Test list

- **Unit (mocked deps, no I/O):** dampening predicate (threshold + duration → emit/suppress); threshold math edge cases (NaN, negative queue depth, CoV at exactly 0 or 1); `HealthReport` delta computation correctness on synthetic arrays; flip-rate counter sliding window (4 flips inside the window → halt; 4 flips spanning the window boundary → no halt); abandonment-of-deferred-switch surfaces a fault, not silence.
- **Integration (real I/O, simulated load):** **simulated-load oscillation test** (flap at threshold → zero actions); **sustained breach test** (threshold crossed for ≥ dampening → exactly one action); **deferred-switch test** (active-task non-empty during `cov-high` → switch deferred until drain); **adversarial flip-rate test** (load satisfying dampening on every flip → circuit-breaker halts after 4 flips); **partition-asymmetric test** (half workers unreachable → loop suspends scaling, emits partition fault).
- **Acceptance (init'd project, end-to-end):** **end-to-end scale event** (drive load via test harness against a published swarm; assert worker count adjusted in `_status`); **adaptive runtime presence** (acceptance check verifies the loop registered, `HealthReport` emitted, queen-side consumer module wired). Per ADR-0118 §T9, topology mutation cannot be exercised end-to-end until T10 lands; until then, the acceptance check asserts the consumer emits the `cov-high`/`cov-low` decision and that `swarm.mutateTopology()` throws the expected not-implemented marker. Per `feedback-all-test-levels.md`, all three levels ship in the same commit as the implementation.

## Completion

### Annotation lift criterion (two-phase)

The "Adaptive topology" row in ADR-0116's plugin README `## Known gaps vs. USERGUIDE` lifts in two phases:

- **Phase 1 (T9 complete, T10 still open)**: scaling component of the row lifts. The row text changes from "missing" to "scaling implemented; topology mutation pending T10". The materialise script reads ADR-0118's §Status table and rewrites the row when T9 status flips to `complete`.
- **Phase 2 (T10 also complete)**: full row drops from the table. T10's own annotation lift (per ADR-0128 §Completion) coincides with this phase.

If two-phase lift complicates the materialise script, an alternative is to keep the full row until T10 lands; T9's completion stays visible via ADR-0118 §Status. Choose during T9 implementation; either is acceptable as long as the ADR-0116 row never claims "auto-scaling delivered" while topology mutation is still type-level.

### Acceptance wire-in

A new acceptance check verifies adaptive topology runtime presence: `unified-coordinator.ts` runs a poll loop, the loop emits `HealthReport` events with the new fields, the `adaptive-loop.ts` consumer module subscribes to those events and routes scale decisions back. Topology decisions are emitted but the mutation call returns the not-implemented marker until T10 lands. The check does not exercise full simulated-load behaviour (that lives in integration tests); it confirms the runtime surface exists and is wired. Per `feedback-no-squelch-tests.md`, the check fails loudly if any wire is missing.

### ESCALATION RULE

**If, during implementation, the hysteresis policy, dampening parameters (poll interval, settle window, threshold gap, CoV bounds, per-type minimum), OR flip-rate circuit-breaker (max-flips-per-window) become contested — meaning more than one defensible default exists and the choice is not mechanical — halt implementation and write a design ADR before code lands.** This is the ADR-0118 §T9 escalation rule, restated here at the completion boundary so it is visible to anyone reading the ADR's tail end and extended with the flip-rate ceiling parameter introduced in §Specification. The implementation prompt's defaults are a starting point, not a settled decision; defaults that produce degenerate behaviour against the integration tests are themselves an automatic escalation trigger.

## Acceptance criteria

- [ ] `forks/ruflo/v3/@claude-flow/swarm/src/unified-coordinator.ts:585` carries a runtime poll loop, not just a boolean flag
- [ ] `HealthReport` at `queen-coordinator.ts:183` (interface declaration; JSDoc at 182) extended with queue-depth percentiles, idle-worker count, load CoV, `breachedThreshold`, `breachDurationMs`, `pollTimestamp`, `flipsInWindow` — type-level extension only; no consumer added to this file
- [ ] New module `forks/ruflo/v3/@claude-flow/swarm/src/adaptive-loop.ts` consumes `HealthReport` deltas and routes scale/topology decisions back to the coordinator
- [ ] Test: load-driven scale-up under simulated queue depth above the high-water threshold for ≥ dampening window
- [ ] Test: load-driven scale-down when a worker is idle for ≥ dampening window, but not below the configured minimum
- [ ] Test: topology switch decision emitted under sustained uneven load (CoV > high threshold) — mutation call returns not-implemented marker until T10 lands
- [ ] Test: topology switch decision emitted after load stabilises (CoV < low threshold for dampening window)
- [ ] Test: no oscillation under flapping load — load that crosses threshold without sustaining produces zero control actions
- [ ] Test: flip-rate circuit-breaker halts the loop on adversarial input that satisfies dampening on every flip
- [ ] Test: switch deferred past 3 dampening windows emits a fault on `_status`, not silent no-op
- [ ] Test: partition-asymmetric input suspends scaling decisions and surfaces a partition fault
- [ ] `npm run test:unit` green
- [ ] `npm run test:acceptance` green (acceptance check verifies adaptive topology runtime presence + scale event end-to-end; topology mutation deferred to T10)

## Risks

**This task is the highest-risk item in ADR-0118's tracker (risk: high).** Autonomous topology changes can oscillate, mask underlying bugs as load anomalies, or thrash workers under flapping load. The risks below are not exhaustive.

1. **Oscillation under flapping load.** If thresholds are set too close to typical load levels, the loop will toggle topology and worker count constantly, multiplying coordination overhead without benefit. **Mitigation**: hysteresis with a 2× threshold gap (high vs. low water marks), a 30s dampening / settle window, AND a flip-rate circuit-breaker (4 flips/hour per axis halts loud). The first two control steady-state oscillation; the circuit-breaker bounds adversarial input that satisfies dampening on every flip. **All three values are preliminary defaults.** They may need their own ADR if contested.

2. **Autonomous-control surface raises safety concerns.** The loop terminates workers and switches topologies without operator acknowledgement. A bug in the threshold logic could produce data loss (terminating a worker mid-task) or coordination collapse (mid-flight topology switch). **Mitigation**: route all decisions through the queen-side consumer, never let the coordinator self-mutate; preserve in-flight task state across topology switches; never terminate a worker with non-empty active task set; bound deferral attempts and surface (not silently abandon) on bound exceedance; halt loud on flip-rate ceiling.

3. **Per ADR-0118 §T9 escalation criterion: this Tn is the most likely candidate for ADR escalation.** If hysteresis policy / dampening parameters become contested OR if autonomous-control surface raises safety concerns during implementation, halt implementation and split into a design ADR before code lands. The default position above (2× threshold gap, 30s settle window, 4 flips/hour ceiling) is a starting point, not a settled decision. Threshold defaults that fail the adversarial-flip-rate or partition-asymmetric integration tests are an automatic escalation trigger.

4. **T7 dependency is structural, not just sequencing.** ADR-0125's adaptive queen-type is prompt-only — no programmatic decision plane. T9's "queen-side consumer" is therefore a NEW TS module (`adaptive-loop.ts`), not a method on T7's queen surface. If T7's shape changes during its own implementation to expose a programmatic surface, the consumer's home may move; until then, T9 ships independently of T7's prompt work and the two compose at the LLM-vs-code boundary rather than via shared object.

5. **T10 dependency provides the topology-mutation dispatch surface.** ADR-0128's `swarm.mutateTopology()` is what T9 mutates into. T10 lands AFTER T9 in the dependency graph. Until T10 is green, T9's topology-mutation responsibility is type-level only — the consumer emits the decision; the mutation call returns a not-implemented marker that throws loud per `feedback-no-fallbacks.md`. **This is an explicit acceptance of partial functionality at T9 land time.** The acceptance check (§Validation) reflects this. Scaling responsibility ships fully exercised; topology mutation closes once T10 lands.

6. **ADR-0105 layering.** ADR-0105 marks `swarm/src/queen-coordinator.ts` as `@internal — V2→V3 migration target, superseded by ADR-0104 prompt-driven Queen` and explicitly says "don't wire" it. T9 extends the `HealthReport` interface in that file (type-level only — the interface is already exported and consumed elsewhere) and adds the consumer **in a new module** (`adaptive-loop.ts`), not as a method on `QueenCoordinator`. The coordinator-side poll loop is the only behavioural change to `unified-coordinator.ts` itself; the producer (`monitorSwarmHealth()` at line 1415) is reused, not parallelised. Mitigation: §Architecture spells out the new module placement.

7. **ADR-0114 layering.** Topology mutation is a protocol-layer dispatch (per ADR-0128) that reads execution-layer health signals via the coordinator. Implementation must not collapse the layers (no direct coordinator → execution bypass that skips the consumer). The consumer-routed design above keeps the layering intact.

8. **Threshold defaults are placeholders, not measurements.** All eight values in §Specification are reasoned-from-first-principles guesses, not derived from load-test data. The implementation prompt is required to run integration tests with synthetic load profiles and record observed behaviour against each default; defaults that produce degenerate behaviour (constant flap, persistent under-reaction, scale storm) are escalation triggers.

## Review notes

Open questions and unresolved positions surfaced during ADR review. None blocks the chosen option (poll loop + queen-side consumer); each is a real concern the implementation prompt must address.

1. **Are the 8 PRELIMINARY threshold values defensible, or just placeholders?** (triage row 41 — DEFER-TO-IMPL: placeholders, integration tests measure) They are placeholders. The "basis" notes in §Specification are reasoning, not measurement. None has been validated against live workload telemetry; the integration tests must record `(threshold, dampening, settle, flip-rate) → (false-positive rate, false-negative rate, time-to-correct-action)` and feed back into these values before the loop ships at scale. Defaults that prove degenerate against the synthetic-load profiles are an automatic escalation trigger.

2. **T7 (ADR-0125) is prompt-only — does the "queen consumer" assumption hold?** — resolved-with-condition (triage row 42: consumer in NEW adaptive-loop.ts module; if T7 evolves to expose programmatic surface, re-validate). No, not as originally framed. ADR-0125 explicitly says "queen behaviour differentiation is mediated entirely through the LLM-facing prompt" and "Swarm coordinator: zero queenType branching added". There is no programmatic queen surface to consume `HealthReport`. This ADR resolves the gap by putting the consumer in a NEW module (`adaptive-loop.ts`), distinct from the LLM-driven adaptive queen prompt. The naming "queen-side consumer" reflects that decisions sit on the queen's side of the coordinator boundary (per ADR-0114), not that they live inside the LLM queen's prompt. If T7's shape changes during its own implementation to expose a programmatic surface, the consumer's home may move; until then, T9 ships independently of T7's prompt work.

3. **T10 (ADR-0128) lands AFTER T9 — chicken-and-egg?** — resolved (triage H6 / row 43: two-phase annotation lift inside T9 per ADR-0118 §Open questions item 3; T9 ships scaling end-to-end + topology mutation type-level only with throw-on-pre-T10 marker; full row drops only when T10 also lands). Partial. T9's scaling responsibility (worker count) ships fully exercised because `swarm.scale()` is a coordinator-level surface that already exists. T9's topology-mutation responsibility cannot be exercised end-to-end until T10 lands `swarm.mutateTopology()` as the per-topology dispatch site. Resolution: T9 ships topology mutation type-level only — the consumer emits the decision; the mutation call returns a not-implemented marker that throws loud per `feedback-no-fallbacks.md`. The acceptance check reflects this. Scaling responsibility closes the ADR-0116 row's scaling component; topology component closes once T10 is green. Two-phase annotation lift, not one.

4. **ADR-0105 marks `queen-coordinator.ts` `@internal — superseded`. Does extending `HealthReport` there violate the marker?** — resolved (triage row 44: type-level extension at queen-coordinator.ts:183 doesn't violate marker; consumer in new adaptive-loop.ts honors don't-wire directive). Type-level extension is fine (the interface is already exported and consumed elsewhere); adding a consumer method would not be. This ADR puts the consumer in a new module (`adaptive-loop.ts`) and limits `queen-coordinator.ts` changes to interface extension. Note the empirical line is 183 (interface declaration) with JSDoc starting at 182; both are referenced through the ADR.

5. **`monitorSwarmHealth()` already exists — does the loop duplicate it?** — resolved (triage row 45: existing monitorSwarmHealth at queen-coordinator.ts:1415 reused; loop does not parallelise; HealthReport interface extended at line 183). No. The loop reuses the existing report producer at line 1415; it does not parallelise it. The new fields in §Specification extend the existing `HealthReport` shape; the producer is augmented to populate them. No new health-report source is introduced.

6. **Partition-asymmetric handling assumes `_status.partitionDetected` exists.** — resolved-with-gap (triage row 46: field DOES NOT exist in fork; pre-implementation step required: either add field to _status/HealthReport, or follow-up ADR exposes it; partition-asymmetric integration test cannot pass without this). Empirically check before implementation — if it doesn't, the partition-asymmetric integration test cannot pass and either (a) the partition-detection work lands first or (b) a follow-up ADR exposes the field. The ADR depends on this; flag at implementation start.

7. **Flip-rate ceiling default (4 flips/hour) is order-of-magnitude.** (triage row 47 — DEFER-TO-IMPL: 4/hour is order-of-magnitude; integration tests close the value) No basis other than "≈ one mutation per dampening window". Treat as the most likely candidate to escalate among the 8 PRELIMINARY values; an alternative formulation might be "halt if action-rate over the trailing window exceeds 2× the steady-state action rate". Decide during integration tests.

8. **The Decision Outcome's 4th rationale point is forced by T7's shape.** — resolved-with-condition (triage row 48: post-hoc rationale acknowledged; re-validate if T7 evolves). The structure choice (Option A) wasn't made specifically to accommodate T7's prompt-only nature; rather, A's tolerance for the "queen-side consumer is a TS module, not a method on the queen" rewording made the T7 mismatch survivable. This is the kind of post-hoc rationale that warrants caution. If T7's shape evolves, re-validate the choice.

9. **Mid-task topology switch deferral to "next loop tick" plus "abandon after 3 dampening windows" is two parameters, not one.** (triage row 49 — DEFER-TO-IMPL: only confirmed switches count; abandonment is separate fault axis) Both are placeholders. The deferral bound interacts with the flip-rate ceiling: a switch deferred 3× then abandoned still counts toward the flip-rate ceiling? Or only confirmed switches? Pin down before implementation; the safe answer is "only confirmed switches", but this needs to be explicit.

## References

- ADR-0116 — hive-mind marketplace plugin (verification matrix; "Adaptive topology" gap row)
- ADR-0118 — hive-mind runtime gaps tracker (§T9 source bullets, escalation criterion)
- ADR-0125 — T7 adaptive queen-type (prompt-only; see §Cross-task dependency posture)
- ADR-0128 — T10 topology runtime (provides `swarm.mutateTopology()` dispatch surface)
- ADR-0105 — topology behavior differentiation (marks `queen-coordinator.ts` `@internal`; informs new-module placement of the consumer)
- ADR-0114 — 3-layer hive architecture (substrate/protocol/execution layering constraint)
- ADR-0104 — prompt-driven Queen architecture (Queen IS a `claude` subprocess; informs why `queen-coordinator.ts` is parked)
- `forks/ruflo/v3/@claude-flow/swarm/src/unified-coordinator.ts:585` — current `autoScaling` flag site
- `forks/ruflo/v3/@claude-flow/swarm/src/queen-coordinator.ts:183` — `HealthReport` interface declaration (JSDoc opens at 182)
- `forks/ruflo/v3/@claude-flow/swarm/src/queen-coordinator.ts:1415` — existing `monitorSwarmHealth()` report producer reused by the loop
- `feedback-no-fallbacks.md` — fail-loud requirement for queen-unreachable, flip-rate ceiling, deferred-switch abandonment, and pre-T10 mutation marker
- `feedback-all-test-levels.md` — unit + integration + acceptance ship in the same commit
