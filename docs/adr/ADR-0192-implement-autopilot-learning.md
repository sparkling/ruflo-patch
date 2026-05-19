---
status: implemented
date: 2026-05-19
implemented: 2026-05-19
methodology: [MADR]
decision-makers: [Henrik Pettersen]
tags: [autopilot, learning, agentdb, sona, agentic-flow, ADR-058, ADR-072, ADR-0191]
related: [0072, 0082, 0191]
upstream-related: [agentic-flow/ADR-058, agentic-flow/ADR-059]
audience: ai-executor
---

# ADR-0192: Implement `AutopilotLearning` — the speced-but-never-built core of the autopilot system

## Context and Problem Statement

The **autopilot system** (`Stop`-hook-driven persistent swarm completion;
ADR-058 in agentic-flow, ADR-072 in ruflo) was designed in two layers:

1. **Mechanism** — Stop hook reads the task list, decides "re-engage or
   let stop." Today: **implemented** in
   `agentic-flow/.claude/helpers/autopilot-hook.mjs` +
   `agentic-flow/src/coordination/swarm-completion.ts`. 45 tests pass.
2. **Learning** — record episodes, mine patterns, supply a
   `ReEngagementContext` (past failures/successes/patterns/
   recommendations/confidence) that the re-engagement prompt uses.
   Today: **never written**. The class `AutopilotLearning` is referenced
   by 7 source files (3 in agentic-flow consumers, 4 in ruflo cli), one
   integration test instantiates it, two ADRs (058/072) and one
   dead-code-report describe it as integrated — but no commit in any
   repo ever added `agentic-flow/src/coordination/autopilot-learning.ts`.

`git log --all -- '**/autopilot-learning*'` returns empty in both
`ruvnet/agentic-flow` and `forks/agentic-flow`. The file has never
existed.

Consequence (surfaced during ADR-0191 follow-up): the cli's
`tryLoadLearning()` (`autopilot-state.ts:314`) returns `null` on every
call because the dynamic `import('agentic-flow/dist/coordination/
autopilot-learning.js')` cannot resolve. Three acceptance checks
(`p2-ap-lifecycle`, `p2-ap-predict`, `p8-inv10-autopilot`) currently
pass only because they accept the graceful-unavailable shape — they do
not verify learning actually works.

Per ADR-0191's **absence-not-accepted rule**, "feature off because
nothing was built" is not a legitimate steady state for a documented
feature with ADR coverage, test coverage, consumer coverage, and an
explicit place in the architecture diagram. Either build it, or
formally retire the feature surface.

## Decision Drivers

* **ADR-0191 absence-not-accepted rule** — reason #5 (genuine
  conditional) requires the absent shape to be typed, logged, and
  integration-tested. `AutopilotLearning` is none of those — the
  consumer surface exists, but the producer is missing.
* **ADR-072 dependency** — its Proposed status is blocked on
  `AutopilotLearning` existing. The cli autopilot subcommand surface
  + 10 MCP tools cannot advance past `available: false` without it.
* **Test contract already specified** — the test file
  `forks/agentic-flow/tests/integration/autopilot-drift-learning.test.ts`
  (`describe('AutopilotLearning')`, 8 it-blocks) is the binding spec.
  Writing the producer is "make these existing tests pass" — not
  green-field design.
* **Scope per ADR-059** — explicitly noted as "~200 lines, only basic
  episode recording, no GNN, no trajectory RL." Phase 1 is not a
  large ML build; it's a structured episode log with frequency-based
  pattern surfacing and AgentDB-backed similarity recall.
* **Patch-repo culture** — per memory `feedback-patches-in-fork`, we
  patch upstream bugs in the fork. Implementing a speced-but-unbuilt
  upstream feature is the same shape of work.

## Considered Options

### Option 1: Implement `AutopilotLearning` per the spec (chosen)

Write `agentic-flow/src/coordination/autopilot-learning.ts` in the
`forks/agentic-flow` fork. Surface matches what the existing test +
consumer call sites expect. AgentDB-backed; falls back gracefully when
AgentDB isn't available. Scope: Phase 1 implementation per ADR-059's
"~200 lines, basic episode recording" target.

Add it to the package's `exports` map so the cli can resolve the
subpath via the codemod-rewritten scoped name. Update the cli's
`autopilot-state.ts` to use a literal `import('agentic-flow/...')`
that the codemod can rewrite (current `const modPath = '...'`
indirection bypasses Pass 3, surviving as-is in published builds).

### Option 2: Formally retire `AutopilotLearning` surface

Delete `tryLoadLearning()`, the autopilot adapter in
`archivist-init.ts`, the autopilot subcommands that depend on
learning, and the integration test. Move ADR-072 to **Withdrawn**.
Document that the autopilot system has the mechanism layer but no
learning layer, and won't get one.

*Tradeoff:* lowest cost; honest about what's built. But contradicts
ADR-072's intent (it explicitly depends on AutopilotLearning being
present) and removes a feature that has measurable value (long-running
swarms benefit from "what worked last time" context).

### Option 3: Stub-with-loud-reporting (minimal)

Keep the current `tryLoadLearning` returning null, but make the
absence loud: surface "Autopilot learning: not implemented" in
`ruflo doctor` and in every autopilot MCP tool response. Add an
acceptance check that asserts the explicit "unimplemented" status
rather than the current "feature off without explanation."

*Tradeoff:* satisfies the absence-not-accepted rule's observability
clauses (typed/logged) without doing the build. But the feature still
doesn't work — the underlying problem (no learning loop) stays.
Equivalent to Option 2 plus better signage; both leave the value on
the table.

### Option 4: Implement a richer AutopilotLearning (full GNN+RL)

Go beyond ADR-059's "Phase 1" scope and build the GNN-enhanced
pattern recognition + RL-trajectory variant described in ADR-072.

*Tradeoff:* matches the maximalist architecture diagram. Significant
effort (likely several iterations); high risk of over-engineering
before the basic shape has any usage data to optimize against. ADR-059
explicitly scopes the first version to be modest for good reasons.

## Decision Outcome

**Option 1 — implement AutopilotLearning per the spec.**

Reasoning:
* The producer surface is already locked by the test file and the
  consumer call sites; this is "fill in the missing class" not "design
  a new feature."
* ADR-059's stated scope (~200 lines, basic episode recording) is
  modest and achievable in a single sitting.
* The test file is the contract. Make those 8 it-blocks pass, ship
  the file, then iterate as real usage data emerges.
* Option 4's richer features (GNN, RL trajectories) can be later
  phases against the same surface — exactly how ADR-059 framed it.

## Implementation Plan

The execution-ready breakdown (code skeleton, AgentDB schema, test
scaffolding, per-phase acceptance criteria, risk table, and numbered
task list) lives in
[`docs/plans/adr0192-autopilot-learning-implementation.md`](../plans/adr0192-autopilot-learning-implementation.md).

The summary below names the phases and their deliverables; the plan
doc has the actual code.

### Phase 1 — Producer (forks/agentic-flow)

**File**: `forks/agentic-flow/agentic-flow/src/coordination/autopilot-learning.ts`

**Surface to implement** (verbatim from the test + consumer sites):

```ts
export interface AutopilotEpisode {
  taskId: string;
  subject: string;
  status: 'completed' | 'blocked' | 'failed' | string;
  iterations: number;
  durationMs: number;
  reward?: number;        // computed if absent: +1 success, -1 failure
  critique?: string;
}

export interface DiscoveredPattern {
  pattern: string;
  frequency: number;
  avgReward: number;
}

export interface ReEngagementContext {
  pastFailures: Array<{ task: string; critique?: string; reward: number }>;
  pastSuccesses: Array<{ task: string; reward: number }>;
  patterns: DiscoveredPattern[];
  recommendations: string[];
  confidence: number;     // 0-1, derived from episode count
}

export interface LearningMetrics {
  available: boolean;
  episodes: number;
  patterns: number;
  trajectories: number;
}

export class AutopilotLearning {
  constructor();
  initialize(): Promise<boolean>;
  isAvailable(): boolean;

  recordTaskCompletion(ep: AutopilotEpisode): Promise<void>;
  recordTaskFailure(ep: AutopilotEpisode): Promise<void>;
  recordIterationStep(progress: ProgressSignal, drift: DriftSignal[]): Promise<void>;
  endSwarmTrajectory(summary: { completed: number; total: number }): Promise<void>;

  discoverSuccessPatterns(): Promise<DiscoveredPattern[]>;
  recallSimilarTasks(query: string, limit: number): Promise<AutopilotEpisode[]>;
  predictNextAction(state: Record<string, unknown>): Promise<{ action: string; confidence: number }>;

  getReEngagementContext(
    incompleteTasks: Array<{ subject: string; status: string }>,
  ): Promise<ReEngagementContext>;

  getMetrics(): Promise<LearningMetrics>;
}
```

**Implementation strategy**:

1. **AgentDB backing** — episodes stored in a dedicated namespace
   (`autopilot_episodes`), one entry per `recordTaskCompletion` /
   `recordTaskFailure` call. Entry key: `${sessionId}:${taskId}`.
   Value: serialized AutopilotEpisode. Optional embedding on the
   `subject` for similarity recall.
2. **Graceful-unavailable mode** — when AgentDB isn't reachable
   (e.g., not installed in the consumer's runtime), `initialize()`
   returns `false`; all record methods become no-ops; getters return
   empty arrays / zero counts. This matches the test's "should
   gracefully handle when AgentDB is unavailable" expectations.
3. **Pattern discovery** — frequency aggregation over the episode
   table. Group by subject-keyword n-grams or by task-shape tags;
   compute frequency + avgReward. Phase 1: no ML, just SQL.
4. **Re-engagement context assembly** — query last N episodes
   matching the incompleteTasks' subjects (semantic recall via
   embedding similarity if available, else literal substring),
   bucket by reward sign, compute confidence as
   `min(1.0, totalEpisodeCount / 50)`, surface top patterns +
   actionable recommendations.
5. **Trajectory integration** — `recordIterationStep` and
   `endSwarmTrajectory` write to SONA's trajectory bank when
   available (via `agentic-flow`'s existing
   `SonaRvfService.recordTrajectory`); silent no-op when not.
   Phase 1: optional; trajectory data isn't consumed by the
   pattern discovery yet.

**Reference for adjacent shape**:
`agentic-flow/src/coordination/self-improvement-pipeline.ts` is a
working sibling component (160 lines, AgentDB-backed pattern
extraction). Mirror its style; do NOT just alias it — the method
surfaces differ enough that consumers would break.

### Phase 2 — Package wiring (forks/agentic-flow)

* Update `forks/agentic-flow/agentic-flow/package.json` `exports` to
  add:
  ```json
  "./coordination/autopilot-learning": "./dist/coordination/autopilot-learning.js"
  ```
  (matching the existing `./coordination/*` exports for
  `attention-coordinator`, etc.)
* Update `agentic-flow/src/coordination/index.ts` to re-export
  `AutopilotLearning`, `AutopilotEpisode`, `ReEngagementContext`,
  `LearningMetrics`, `DiscoveredPattern` (per ADR-072's snippet at
  line 293-294).
* `tsc` build confirms `dist/coordination/autopilot-learning.js`
  ships.

### Phase 3 — Consumer fix (forks/ruflo)

* `forks/ruflo/v3/@claude-flow/cli/src/autopilot-state.ts`:
  - Replace the variable-indirected dynamic import with a literal
    one so the codemod can rewrite it. Before:
    ```ts
    const modPath = 'agentic-flow/dist/coordination/autopilot-learning.js';
    const mod = await import(modPath).catch(...);
    ```
    After:
    ```ts
    const mod = await import('agentic-flow/coordination/autopilot-learning')
      .catch((e: unknown) => {
        const code = (e as { code?: string } | null)?.code;
        if (code && ABSENT_CODES.has(code)) return null;
        throw e;
      });
    ```
  - The codemod (Pass 3) rewrites this to
    `@sparkleideas/agentic-flow/coordination/autopilot-learning` in
    the published cli.
* No changes needed in `archivist-init.ts` or
  `mcp-tools/autopilot-tools.ts` — they consume via
  `tryLoadLearning` which now returns a real instance.

### Phase 4 — Test surface (forks/agentic-flow)

* The existing integration test `autopilot-drift-learning.test.ts`
  already specifies the expected behavior in the
  AgentDB-unavailable mode (8 it-blocks). Verify those pass.
* Add a second describe block covering the
  AgentDB-available + populated case:
  - Record N completions + M failures.
  - `getReEngagementContext` returns non-empty
    `pastSuccesses` / `pastFailures` / `patterns` arrays.
  - `confidence` rises with episode count.
  - `recallSimilarTasks` returns top-K by similarity.

### Phase 5 — Acceptance coverage (ruflo-patch)

Add an acceptance check to `scripts/test-acceptance.sh` that closes
ADR-0191's "happy-path" gap (Task #21):

* In a fresh init project, run several `memory_store` +
  `autopilot_learn` operations to populate episodes.
* Call `mcp exec --tool autopilot_predict`. Assert the response
  carries `available: true` AND `metrics.episodes > 0` AND a
  non-default `prediction` object.

This is the integration-test layer that the absence-not-accepted
rule requires (the "tested by an integration check that runs in the
populated configuration" clause).

### Phase 6 — Doctor + observability (ruflo-patch / forks/ruflo)

Per Task #22: add a `ruflo doctor` section that emits per-controller
+ per-optional-integration state, including AutopilotLearning's
`available` field. Operators see the feature-on state explicitly,
not by inference.

### Phase 7 — ADR-072 advancement

Once Phase 1-5 land, ADR-072 (still **Proposed**) can move to
**Implemented**. Update its status block and add a back-pointer to
this ADR (ADR-0192) in its dependency chain.

## Consequences

### Positive

* The 7 references to `AutopilotLearning` across the codebase
  resolve to real code instead of silent null returns.
* ADR-072's autopilot integration unblocks: 9 CLI subcommands + 10
  MCP tools become functionally complete.
* The Stop-hook re-engagement prompt gains learned context, which
  ADR-072 frames as the primary value-add of the autopilot system
  (the mechanism alone doesn't improve completion quality; the
  learning loop does).
* The 8-it-block integration test in
  `autopilot-drift-learning.test.ts` actually runs (today it imports
  a non-existent module and presumably skips or errors out at
  module-load).
* ADR-0191 follow-up A4 closes: optional dependency is no longer
  silently returning null; the integration is real.

### Negative

* New code surface to maintain. Phase 1 is ~200 lines of producer +
  tests; subsequent phases may grow it.
* AgentDB schema gains a new namespace (`autopilot_episodes`).
  Minor — AgentDB is built for this — but a schema-migration story
  for existing installs needs a thought.
* The cli's autopilot subcommands' behavior changes: today they
  uniformly return `{ available: false }`. After Phase 3 they return
  real data, which means any test or consumer that asserted
  `available: false` as a stable shape needs an update.

### Risks

* **Implementation diverges from consumer expectations** — mitigated
  by writing against the existing test file as the binding spec, then
  adding consumer-side integration tests in Phase 5.
* **SONA trajectory integration is brittle** — Phase 1 makes it
  optional; if SONA isn't available, no-op silently. Tracked
  separately as a follow-up if real usage data shows the
  trajectories matter.
* **Pattern discovery over-fits or under-fits** — Phase 1 uses
  trivial frequency aggregation, easy to tune. The richer GNN+RL
  approach (Option 4) is deferred until Phase 1 has usage data.
* **ADR-0191 absence-not-accepted compliance** — after Phase 1,
  AutopilotLearning is reason #5 only when AgentDB isn't installed.
  That branch must be typed + logged + integration-tested per the
  rule. Phase 1's graceful-unavailable mode + Phase 5/6 observability
  satisfy this.

## Open Questions

1. **Episode embedding source** — should `subject` be embedded via
   the existing project embedding model (Xenova/all-mpnet-base-v2,
   per memory `reference-embedding-model`) or via a smaller faster
   model? Phase 1 default: use the project's standard embedding
   service. Open to revision after benchmark.
2. **Cross-session continuity** — should episodes from past sessions
   carry forward, or are they session-scoped? ADR-072's
   `ReEngagementContext` shape suggests cross-session. Implementation
   detail: namespace by project root, not session ID. Confirm before
   shipping.
3. **Reward signal** — for `recordTaskCompletion`, reward defaults to
   `+1`. For `recordTaskFailure`, `-1`. ADR-072 suggests the autopilot
   hook might compute a richer reward based on iterations / duration
   / drift signals. Phase 1: use the simple +1/-1. Capture richer
   signal in Phase 2 if usage data justifies.
4. **Retire-vs-keep autopilot subcommands that don't depend on
   learning** — `autopilot_status`, `autopilot_enable`,
   `autopilot_disable`, `autopilot_config`, `autopilot_log`,
   `autopilot_reset` work today without AutopilotLearning. Only
   `autopilot_predict`, `autopilot_learn`, `autopilot_history`
   need it. Phase 1 lights up the learning-dependent three; the rest
   are unaffected.

## Close Criteria

This ADR closes when all five rows of the verification matrix in the
plan doc pass:

| Layer | Pass condition |
|---|---|
| Unit (agentic-flow) | 13 it-blocks pass — the 8 existing absent-shape tests + 5 new populated-AgentDB tests |
| Integration (cli) | `tryLoadLearning()` returns a non-null instance in a fresh `@sparkleideas/cli` install |
| Acceptance (ruflo-patch) | `ctrl-autopilot-learn` check passes in `npm run release` |
| Doctor (operator-facing) | `ruflo doctor -c autopilot-learning` reports `available=true` with non-zero episodes after population |
| ADR closure | ADR-072 advances from **Proposed** → **Implemented**; ADR-0191's `autopilot-state.ts:322` "producer unbuilt" caveat removed; this ADR's frontmatter status flips to **implemented** with a Post-implementation revision section noting any deviations |

If any of these proves unbuildable within the Phase 1 scope, fall
back to Option 2 (formal retirement) and document the gap in a
Post-implementation revision.

## Post-implementation revision (2026-05-19)

ADR-0192 landed across 4 release cycles. Final commits:

* `forks/agentic-flow`:
  - `5cb4e8c` Phase 1+2+4 — producer file + inner package.json exports + new describe block
  - `e7d65b8` exports map fix — added the entry to the OUTER package.json (the published one)
  - `5f4c0ff` follow-ups — degraded-mode guard in `initialize()` + collapsed 23 multi-line `import('agentdb')` to single-line so the codemod's Pass 3 catches them
  - `1800e40` swarm-review fixes — producer-side logging + test skip semantics + double-cast cleanup
* `forks/ruflo`:
  - `6d7cae2a0` Phase 3+6 — cli's `tryLoadLearning` uses literal `tryOptionalImport('agentic-flow/coordination/autopilot-learning')` (codemod-rewritable) + `checkAutopilotLearning` doctor health check
* `ruflo-patch`:
  - `c9a8bb4` Phase 5 — `ctrl-autopilot-learn` acceptance check
  - `39d972d` follow-up — tolerate escaped JSON in autopilot_learn MCP envelope
  - `065e6d3` plan doc gotcha note (inner vs outer package.json)

### Deviations from the plan

1. **Both inner and outer agentic-flow package.json need the
   exports entry.** The plan said "update agentic-flow/package.json
   exports" without specifying the fork has two — the implementer
   added the entry only to the inner package.json (which doesn't
   ship as the publish artifact). Surfaced by `ctrl-autopilot-learn`
   failing with `ERR_PACKAGE_PATH_NOT_EXPORTED` in release-1+2.
   Plan doc updated in commit `065e6d3` to call this out for future
   executors.

2. **Codemod gap on multi-line dynamic imports.** The agentic-flow
   service file had 23 sites formatted as
   `await import(\n /* webpackIgnore: true */\n 'agentdb'\n)`. The
   codemod's `UNSCOPED_IMPORT_RE` requires `(import|require)\s*\(\s*['"]<name>` contiguously and skipped these. Resolution chose
   source-side rewrite (collapse to single line) rather than widening
   the regex — narrower scope, lower risk, fixed in `5f4c0ff`.

3. **Assertion loosening in populated suite.** Phase 1 has no
   episode-purge API (out-of-scope per ADR-059 retention-policies
   line). Episodes accumulate across test runs in the same
   `EPISODE_SESSION_ID` namespace. Assertions use `toBeGreaterThanOrEqual(15)` instead of `toBe(15)` to tolerate
   accumulation. Tightening back is a Phase-7+ follow-up gated on
   adding a purge API.

4. **Test skip path now visible.** Reviewer flag: the
   `if (!isAvailable) return` early-skip pattern made silent skips
   look like passes. Replaced with a `_skippedReason` sentinel +
   `console.warn` in `beforeEach`. CI logs now show
   `[autopilot-learning populated suite] SKIP: ...` when AgentDB is
   unavailable in the test env.

5. **Producer-side logging added at every `_available=false` branch.**
   ADR-0191's absence-not-accepted rule requires Reason #5 absences
   to be logged at startup. The original Phase 1 satisfied this by
   composition through the doctor's `checkAutopilotLearning` row,
   but Critic + Reviewer agreed direct producer-boundary logging is
   stronger. Each branch (null service / missing methods / DEGRADED
   / status threw / init threw) now emits a discriminating
   `console.error` line.

### Verification matrix outcome (release-4, 2026-05-19T12:44Z)

| Layer | Outcome | Evidence |
|---|---|---|
| Unit | PASS (with caveat) | The 8 existing absent-shape it-blocks pass; the 5 new populated-suite blocks pass when AgentDB is available, otherwise emit visible SKIP warnings |
| Integration | PASS | Manual probe in `/tmp/adr0192-repro`: `learning.isAvailable() === true`; `recordTaskCompletion` succeeds |
| Acceptance | PASS | `ctrl-autopilot-learn: PASS` in 1419ms |
| Doctor | PASS | `doctor -c autopilot-learning` reports `available=true` |
| ADR closure | PASS | This ADR's status flipped to `implemented`; ADR-0191's autopilot row updated (separate commit); ADR-072 already `Implemented` (pre-existing) |

Release-4 totals: **675/684 passed, 0 failed, 9 skip_accepted** (heavy-skip opt-outs).

### Lessons captured for future ADRs

* When patching upstream-aligned forks, always check for **both**
  inner and outer `package.json` if the package layout is a
  monorepo with an inner project directory. The published artifact
  uses the outer one; tests against the inner one give false
  confidence.
* The codemod's Pass 3 `UNSCOPED_IMPORT_RE` doesn't handle
  whitespace-or-comments between `(` and the literal. Either
  source-side (collapse to single line) or codemod-side (widen
  regex) fixes work; source-side is narrower and lower-risk.
* The npm `--prefer-offline` flag in the acceptance harness can
  cache-pin to a pre-publish version. Releases that depend on a
  bumped fork artifact may need a `--force` run to invalidate the
  cache, OR the harness's pre-install step needs explicit cache
  busting for the specific bumped packages. Worth a follow-up
  ticket.
* Building-and-testing-incremental works only if each release is a
  self-contained probe. Release-3 looked broken (DEGRADED) but the
  artifacts were correct — the failure was stale-cache resolution,
  not actual code. `--force` invalidates and reveals the real state.
