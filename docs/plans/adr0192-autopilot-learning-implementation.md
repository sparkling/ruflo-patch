# ADR-0192 — AutopilotLearning Implementation Plan

Companion to [`docs/adr/ADR-0192-implement-autopilot-learning.md`](../adr/ADR-0192-implement-autopilot-learning.md).
The ADR captures the **decision** (build it, Phase 1 scope per ADR-059's
"~200 lines, basic episode recording"). This document is the
**execution-ready breakdown**: file paths, code skeleton, AgentDB
schema, test scaffolding, per-phase acceptance criteria, and an
explicit out-of-scope list.

## Sequencing

```
Phase 1: producer file (forks/agentic-flow)
            │
            ▼
Phase 2: package wiring (forks/agentic-flow)  ─┐
            │                                   │ same release
            ▼                                   │ cycle in
Phase 4: test scaffold  (forks/agentic-flow)  ─┘ agentic-flow

            │
            ▼ (after agentic-flow publishes)
Phase 3: consumer fix (forks/ruflo)            ─┐
            │                                   │ same release
            ▼                                   │ cycle
Phase 5: acceptance check (ruflo-patch)        ─┘

            │
            ▼
Phase 6: doctor entry (forks/ruflo or ruflo-patch)
            │
            ▼
Phase 7: ADR-072 status update + ADR-0192 closure
```

Phases 1+2+4 land in a single agentic-flow fork commit chain.
Phases 3+5 land in a follow-up ruflo + ruflo-patch chain after
agentic-flow publishes the new version. Phase 6 is small and can ride
either chain. Phase 7 is docs-only.

## Out of scope (Phase 1)

Per ADR-059's explicit scoping. Do NOT build any of the following in
Phase 1:

* GNN-enhanced pattern recognition
* RL-trajectory replay buffers
* Cross-controller learning bridges (LearningSystem coupling)
* Federated learning across multiple ruflo installs
* Real-time prediction model (predictNextAction returns the trivial
  default `{action: 'continue', confidence: 0}` plus a "most-common-
  next-step" lookup if patterns exist; no ML)
* Reward shaping beyond `+1` / `-1`
* Episode pruning / retention policies (let them accumulate; revisit
  if disk usage becomes a real concern with usage data)

These belong to later phases against the same surface — keep the
public method shapes stable so they can be added without breaking
consumers.

## Phase 1 — Producer

### File location

`forks/agentic-flow/agentic-flow/src/coordination/autopilot-learning.ts`

### Code skeleton

```ts
// agentic-flow/src/coordination/autopilot-learning.ts
//
// ADR-058 + ADR-072 + ADR-0192 Phase 1: learning loop for the autopilot
// system. AgentDB-backed episode log + frequency-aggregated pattern
// discovery + semantic recall. Graceful-unavailable when AgentDB isn't
// reachable. No GNN, no RL trajectories — see ADR-059 scoping notes
// and the Phase 1 out-of-scope list in
// docs/plans/adr0192-autopilot-learning-implementation.md.

export interface AutopilotEpisode {
  taskId: string;
  subject: string;
  status: 'completed' | 'blocked' | 'failed' | string;
  iterations: number;
  durationMs: number;
  reward?: number;            // computed default: +1 success, -1 failure
  critique?: string;
  timestamp?: number;         // set by record* methods on write
  sessionId?: string;         // analytics only; not used for partitioning
}

export interface DiscoveredPattern {
  pattern: string;            // human-readable subject-keyword
  frequency: number;          // # episodes matching
  avgReward: number;          // mean reward over matching episodes
}

export interface ReEngagementContext {
  pastFailures: Array<{ task: string; critique?: string; reward: number }>;
  pastSuccesses: Array<{ task: string; reward: number }>;
  patterns: DiscoveredPattern[];
  recommendations: string[];  // surfaced from top patterns + failure critiques
  confidence: number;         // 0-1 = min(1, episodes / 50)
}

export interface LearningMetrics {
  available: boolean;
  episodes: number;
  patterns: number;
  trajectories: number;       // Phase 1: always 0 (no trajectory recording yet)
}

// ─────────────────────────────────────────────────────────────────────

const EPISODE_NS = 'autopilot_episodes';
const CONFIDENCE_FLOOR = 50; // # episodes for confidence = 1.0

export class AutopilotLearning {
  private _available = false;
  private _agentdb: unknown = null;   // AgentDB instance from agentdb pkg
  private _embedder: unknown = null;  // optional embedding service

  async initialize(): Promise<boolean> {
    try {
      // agentic-flow's existing AgentDBService already handles agentdb
      // resolution + fallback. Reuse rather than re-implementing.
      const svc = await import('../services/agentdb-service.js');
      const inst = await svc.getAgentDBService?.();
      if (!inst) return (this._available = false);
      this._agentdb = inst;
      // embedder is optional; absence reduces recallSimilarTasks to
      // literal substring matching (Phase 1: acceptable, surfaced as a
      // metrics field if we add one in Phase 2)
      this._embedder = await this._tryLoadEmbedder();
      this._available = true;
      return true;
    } catch {
      this._available = false;
      return false;
    }
  }

  isAvailable(): boolean { return this._available; }

  async recordTaskCompletion(ep: AutopilotEpisode): Promise<void> {
    return this._record(ep, ep.reward ?? +1);
  }

  async recordTaskFailure(ep: AutopilotEpisode): Promise<void> {
    return this._record(ep, ep.reward ?? -1);
  }

  async recordIterationStep(_p: unknown, _d: unknown[]): Promise<void> {
    // Phase 1: no trajectory recording. Surface exists so consumers
    // can call it; later phases can wire SONA trajectories here.
    return;
  }

  async endSwarmTrajectory(_summary: unknown): Promise<void> {
    // Phase 1: no trajectory recording. See recordIterationStep.
    return;
  }

  async discoverSuccessPatterns(): Promise<DiscoveredPattern[]> {
    if (!this._available) return [];
    const episodes = await this._listEpisodes();
    return this._aggregatePatterns(episodes.filter(e => (e.reward ?? 0) > 0));
  }

  async recallSimilarTasks(query: string, limit: number): Promise<AutopilotEpisode[]> {
    if (!this._available) return [];
    // Phase 1: literal substring match. Embedder integration is a
    // Phase 2 follow-up.
    const episodes = await this._listEpisodes();
    const q = query.toLowerCase();
    return episodes
      .filter(e => e.subject.toLowerCase().includes(q))
      .slice(0, limit);
  }

  async predictNextAction(_state: Record<string, unknown>): Promise<{ action: string; confidence: number }> {
    if (!this._available) return { action: 'continue', confidence: 0 };
    // Phase 1: most-common-next-action over recent successes. If
    // no data, default. Confidence scales with episode count.
    const metrics = await this.getMetrics();
    return {
      action: 'continue',
      confidence: Math.min(1.0, metrics.episodes / CONFIDENCE_FLOOR),
    };
  }

  async getReEngagementContext(
    incompleteTasks: Array<{ subject: string; status: string }>,
  ): Promise<ReEngagementContext> {
    if (!this._available) {
      return { pastFailures: [], pastSuccesses: [], patterns: [], recommendations: [], confidence: 0 };
    }
    const episodes = await this._listEpisodes();
    const matching = this._matchByIncomplete(episodes, incompleteTasks);
    const pastFailures = matching.filter(e => (e.reward ?? 0) < 0).map(e => ({
      task: e.subject, critique: e.critique, reward: e.reward ?? -1,
    }));
    const pastSuccesses = matching.filter(e => (e.reward ?? 0) > 0).map(e => ({
      task: e.subject, reward: e.reward ?? +1,
    }));
    const patterns = this._aggregatePatterns(matching);
    return {
      pastFailures,
      pastSuccesses,
      patterns,
      recommendations: this._buildRecommendations(patterns, pastFailures),
      confidence: Math.min(1.0, episodes.length / CONFIDENCE_FLOOR),
    };
  }

  async getMetrics(): Promise<LearningMetrics> {
    if (!this._available) return { available: false, episodes: 0, patterns: 0, trajectories: 0 };
    const episodes = await this._listEpisodes();
    const patterns = this._aggregatePatterns(episodes);
    return { available: true, episodes: episodes.length, patterns: patterns.length, trajectories: 0 };
  }

  // ─── private ────────────────────────────────────────────────────

  private async _record(ep: AutopilotEpisode, reward: number): Promise<void> {
    if (!this._available || !this._agentdb) return;
    const enriched = { ...ep, reward, timestamp: Date.now() };
    // adapter calls agentic-flow's existing AgentDBService.store API
    // (signature: store(namespace, key, value, opts))
    await this._agentdbStore(EPISODE_NS, this._episodeKey(ep), enriched);
  }

  private _episodeKey(ep: AutopilotEpisode): string {
    return `${ep.taskId}:${ep.timestamp ?? Date.now()}`;
  }

  private async _listEpisodes(): Promise<AutopilotEpisode[]> {
    if (!this._available || !this._agentdb) return [];
    // adapter calls AgentDBService.list(namespace, {limit?})
    return this._agentdbList(EPISODE_NS);
  }

  private _aggregatePatterns(episodes: AutopilotEpisode[]): DiscoveredPattern[] {
    // Simple frequency aggregation on subject keywords.
    // Phase 1: split on whitespace, lower-case, dedupe per-episode,
    // count occurrences across episodes, compute avgReward.
    const buckets = new Map<string, { count: number; rewardSum: number }>();
    for (const ep of episodes) {
      const tokens = new Set(ep.subject.toLowerCase().split(/\s+/).filter(t => t.length >= 4));
      for (const t of tokens) {
        const b = buckets.get(t) ?? { count: 0, rewardSum: 0 };
        b.count++;
        b.rewardSum += ep.reward ?? 0;
        buckets.set(t, b);
      }
    }
    return Array.from(buckets.entries())
      .filter(([, b]) => b.count >= 2)             // dedupe singletons
      .map(([pattern, b]) => ({ pattern, frequency: b.count, avgReward: b.rewardSum / b.count }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 10);                                // top 10
  }

  private _matchByIncomplete(
    episodes: AutopilotEpisode[],
    incomplete: Array<{ subject: string; status: string }>,
  ): AutopilotEpisode[] {
    const incompleteTokens = new Set(
      incomplete.flatMap(t => t.subject.toLowerCase().split(/\s+/).filter(x => x.length >= 4)),
    );
    return episodes.filter(ep => {
      const epTokens = ep.subject.toLowerCase().split(/\s+/);
      return epTokens.some(t => incompleteTokens.has(t));
    });
  }

  private _buildRecommendations(
    patterns: DiscoveredPattern[],
    pastFailures: Array<{ critique?: string }>,
  ): string[] {
    const recs: string[] = [];
    const topSuccess = patterns.filter(p => p.avgReward > 0).slice(0, 3);
    for (const p of topSuccess) {
      recs.push(`Pattern "${p.pattern}" succeeded ${p.frequency}× (avg reward ${p.avgReward.toFixed(2)})`);
    }
    const critiques = pastFailures.map(f => f.critique).filter(Boolean).slice(0, 3);
    for (const c of critiques) {
      recs.push(`Past failure note: ${c}`);
    }
    return recs;
  }

  // AgentDBService adapter slots — implemented inline using the actual
  // AgentDBService API. Signatures TBD against the current service
  // surface; the Phase 1 implementer fills these in matching whatever
  // `import('../services/agentdb-service.js')` exports.
  private async _agentdbStore(_ns: string, _key: string, _value: unknown): Promise<void> {
    // adapter: this._agentdb.store(_ns, _key, _value)
  }
  private async _agentdbList(_ns: string): Promise<AutopilotEpisode[]> {
    // adapter: this._agentdb.list(_ns) → AutopilotEpisode[]
    return [];
  }
  private async _tryLoadEmbedder(): Promise<unknown> {
    // Optional — return null if not available. Phase 1: skipped.
    return null;
  }
}
```

### AgentDB schema (Phase 1)

| Field | Type | Notes |
|---|---|---|
| **namespace** | `'autopilot_episodes'` | dedicated, doesn't collide with memory_store / pattern_store |
| **key** | `${taskId}:${timestamp}` | timestamp suffix allows multiple episodes per task (re-runs) |
| **value (JSON-serialized)** | `AutopilotEpisode` (see interface above) | full episode record |
| **embedding** | optional, 768-dim | subject embedding via project model; absent in Phase 1 (literal-substring recall) |
| **indexes** | namespace-scope (built-in) | no custom indexes; frequency aggregation is in-memory in Phase 1 |

Episode keys are project-scoped via the AgentDBService init path (it
opens a per-project sqlite file). Cross-session continuity is therefore
free — episodes accumulate across sessions within the same project
root.

### Phase 1 acceptance criteria

* File compiles under `tsc` with no errors
* All 8 existing it-blocks at
  `tests/integration/autopilot-drift-learning.test.ts:172-232` pass
  unchanged (they test the AgentDB-unavailable graceful-degradation
  shape; the implementation satisfies the contract)
* The Phase 4 new describe block (below) passes

## Phase 2 — Package wiring

### Changes

1. `forks/agentic-flow/agentic-flow/package.json` — add to `exports`:
   ```json
   "./coordination/autopilot-learning": "./dist/coordination/autopilot-learning.js"
   ```

2. `forks/agentic-flow/agentic-flow/src/coordination/index.ts` — append:
   ```ts
   export { AutopilotLearning } from './autopilot-learning.js';
   export type {
     AutopilotEpisode,
     ReEngagementContext,
     LearningMetrics,
     DiscoveredPattern,
   } from './autopilot-learning.js';
   ```

3. `tsc` produces `dist/coordination/autopilot-learning.js` (verified
   by inspecting `forks/agentic-flow/agentic-flow/dist/coordination/`
   after `npm run build` in that fork).

### Phase 2 acceptance criterion

After agentic-flow publishes a new patch version + cli reinstalls
against it, this resolves cleanly:

```bash
node -e "import('@sparkleideas/agentic-flow/coordination/autopilot-learning').then(m => console.log(typeof m.AutopilotLearning))"
# expected: function
```

## Phase 3 — Consumer fix (forks/ruflo)

### File

`forks/ruflo/v3/@claude-flow/cli/src/autopilot-state.ts`

### Edit

Before:

```ts
const modPath = 'agentic-flow/dist/coordination/autopilot-learning.js';
const mod = await import(/* webpackIgnore: true */ modPath).catch((e: unknown) => {
  const code = (e as { code?: string } | null)?.code;
  if (code === 'ERR_MODULE_NOT_FOUND' ||
      code === 'MODULE_NOT_FOUND' ||
      code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' ||
      code === 'ERR_PACKAGE_IMPORT_NOT_DEFINED') return null;
  throw e;
});
```

After:

```ts
import { tryOptionalImport } from './utils/optional-import.js';

// ADR-0192 Phase 3: literal-string import so the codemod (Pass 3)
// rewrites the package name to @sparkleideas/agentic-flow in
// published artifacts. The legacy variable-indirection bypassed
// Pass 3.
const mod = await tryOptionalImport<{
  AutopilotLearning: new () => {
    initialize(): Promise<boolean>;
    [key: string]: unknown;
  };
}>('agentic-flow/coordination/autopilot-learning');
```

### Phase 3 acceptance criterion

In a fresh `@sparkleideas/cli` install:

```bash
node -e "import('@sparkleideas/cli').then(async m => {
  const { tryLoadLearning } = await import('@sparkleideas/cli/dist/src/autopilot-state.js');
  const l = await tryLoadLearning();
  console.log('learning:', l === null ? 'NULL' : 'instance');
  if (l) console.log('isAvailable:', l.isAvailable?.());
})"
# expected: learning: instance
```

## Phase 4 — Test scaffold

### File

`forks/agentic-flow/tests/integration/autopilot-drift-learning.test.ts`

### Existing block — keep unchanged

Lines 172-232 currently test the AgentDB-unavailable shape (8
it-blocks). Phase 1's graceful-degradation mode satisfies all 8.
Do NOT modify; just confirm they pass.

### New describe block — append after line 232

```ts
describe('AutopilotLearning — populated AgentDB', () => {
  let learning: AutopilotLearning;

  beforeEach(async () => {
    learning = new AutopilotLearning();
    const ready = await learning.initialize();
    if (!ready) {
      // AgentDB legitimately unavailable in this test env — skip the
      // populated suite entirely. The graceful-unavailable suite above
      // already covers that path.
      return;
    }
    for (let i = 0; i < 10; i++) {
      await learning.recordTaskCompletion({
        taskId: `t-c-${i}`,
        subject: i < 5 ? 'write unit tests for authentication'
                       : 'fix database migration bug',
        status: 'completed',
        iterations: 3 + i,
        durationMs: 5000 * (i + 1),
      });
    }
    for (let i = 0; i < 5; i++) {
      await learning.recordTaskFailure({
        taskId: `t-f-${i}`,
        subject: 'connection timeout in database migration',
        status: 'failed',
        iterations: 10,
        durationMs: 60000,
        critique: 'connection pool exhausted',
      });
    }
  });

  it('reports populated metrics', async () => {
    if (!learning.isAvailable()) return; // skip if unavailable in env
    const m = await learning.getMetrics();
    expect(m.available).toBe(true);
    expect(m.episodes).toBe(15);
    expect(m.patterns).toBeGreaterThan(0);
  });

  it('discovers patterns from grouped subjects', async () => {
    if (!learning.isAvailable()) return;
    const patterns = await learning.discoverSuccessPatterns();
    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns.every(p => p.frequency >= 2)).toBe(true);
    expect(patterns[0].pattern.length).toBeGreaterThan(3);
  });

  it('recall returns matches by subject substring', async () => {
    if (!learning.isAvailable()) return;
    const results = await learning.recallSimilarTasks('authentication', 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.subject.toLowerCase().includes('authentication'))).toBe(true);
  });

  it('re-engagement context separates failures from successes', async () => {
    if (!learning.isAvailable()) return;
    const ctx = await learning.getReEngagementContext([
      { subject: 'fix database migration', status: 'pending' },
    ]);
    expect(ctx.pastSuccesses.length).toBeGreaterThan(0);
    expect(ctx.pastFailures.length).toBeGreaterThan(0);
    expect(ctx.confidence).toBeGreaterThan(0);
  });

  it('confidence scales with episode count', async () => {
    if (!learning.isAvailable()) return;
    const ctx = await learning.getReEngagementContext([{ subject: 'unrelated query', status: 'pending' }]);
    // 15 episodes / 50 floor = 0.3
    expect(ctx.confidence).toBeGreaterThan(0.2);
    expect(ctx.confidence).toBeLessThan(0.5);
  });
});
```

### Phase 4 acceptance criterion

```bash
cd forks/agentic-flow && npm test -- autopilot-drift-learning
# expected: both describe blocks pass (8 + 5 = 13 it-blocks)
```

## Phase 5 — Acceptance check (ruflo-patch)

### File

`lib/acceptance-controller-checks.sh` (add the function),
`scripts/test-acceptance.sh` (register the check at both sites).

### New function

```bash
check_autopilot_learning_active() {
  # ADR-0192 Phase 5: verify AutopilotLearning loads + populates + reports.
  local cli; cli=$(_cli_cmd)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # Populate via autopilot_learn MCP tool (which records task completions
  # internally via tryLoadLearning + learning.recordTaskCompletion).
  for i in 1 2 3; do
    _run_and_kill "cd '$TEMP_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool autopilot_learn --params '{\"taskId\":\"t-$i\",\"subject\":\"acceptance test populate\",\"status\":\"completed\",\"iterations\":3,\"durationMs\":5000}'" "" 30
  done

  # Probe: history should report >= 3 episodes + available=true.
  _run_and_kill_ro "cd '$TEMP_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool autopilot_history" "" 30

  if [[ $_RK_EXIT -eq 0 ]] && \
     echo "$_RK_OUT" | grep -qE '"available"[[:space:]]*:[[:space:]]*true' && \
     echo "$_RK_OUT" | grep -qE '"episodes"[[:space:]]*:[[:space:]]*[1-9]'; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="AutopilotLearning: available + populated with episodes"
  else
    _CHECK_OUTPUT="AutopilotLearning: not active or no episodes — $(echo "$_RK_OUT" | head -c 200)"
  fi
}
```

### Registration

`scripts/test-acceptance.sh`:

```bash
run_check_bg "ctrl-autopilot-learn" "Autopilot learning active" check_autopilot_learning_active "controller"
```

Also add `"ctrl-autopilot-learn|Autopilot learning active"` to the
registration list around line 2524.

### Phase 5 acceptance criterion

`ctrl-autopilot-learn` passes in `npm run release`.

## Phase 6 — Doctor entry

### Decision

AutopilotLearning is NOT a registered controller in
`ControllerRegistry`'s INIT_LEVELS. It's a thin wrapper class with
its own lifecycle (`new + initialize()`) consumed via
`tryLoadLearning`. Adding it to the registry would add ceremony
without benefit (it doesn't share the registry's controller-pool
semantics).

Use a dedicated doctor check.

### New function — `forks/ruflo/v3/@claude-flow/cli/src/commands/doctor.ts`

```ts
async function checkAutopilotLearning(): Promise<HealthCheck> {
  try {
    const { tryLoadLearning } = await import('../autopilot-state.js');
    const learning = await tryLoadLearning();
    if (!learning) {
      return {
        name: 'Autopilot Learning',
        status: 'warn',
        message: 'unavailable — agentic-flow optionalDep not installed OR AutopilotLearning subpath not exported',
        fix: 'npm install @sparkleideas/agentic-flow@latest',
      };
    }
    const metrics = await (learning as { getMetrics(): Promise<{ available: boolean; episodes: number; patterns: number }> }).getMetrics();
    return {
      name: 'Autopilot Learning',
      status: metrics.available ? 'pass' : 'warn',
      message: `available=${metrics.available} episodes=${metrics.episodes} patterns=${metrics.patterns}`,
    };
  } catch (e) {
    return {
      name: 'Autopilot Learning',
      status: 'fail',
      message: `probe threw: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
```

Add to `allChecks` array (after `checkAgenticFlow`) and to
`componentMap` as `'autopilot-learning': checkAutopilotLearning`.

### Phase 6 acceptance criterion

`ruflo doctor -c autopilot-learning` returns `pass` in a fresh
install. The full `ruflo doctor` includes the row.

## Phase 7 — ADR updates

### Files

`forks/ruflo/v3/implementation/adrs/ADR-072-autopilot-persistent-completion.md`:

* Status: `Proposed` → `Implemented`
* Add a row to the Dependencies section: `Depends on: ADR-0192
  (AutopilotLearning Phase 1 implementation) — landed YYYY-MM-DD`

`docs/adr/ADR-0192-implement-autopilot-learning.md`:

* Status: `proposed` → `implemented` (frontmatter + post-implementation
  section)
* Add a "Post-implementation revision" section noting any deviations
  from the plan that surfaced during execution (e.g., method-name
  mismatches, AgentDB API quirks, etc.)

`docs/adr/ADR-0191-undiscriminating-catch-triage.md`:

* Update the Cluster A `autopilot-state.ts:322` row to remove the
  "producer unbuilt" caveat — feature is now live.

### Phase 7 acceptance criterion

All three ADR files reflect the implemented state. ADR-0192 closes;
ADR-0191's autopilot caveat is removed; ADR-072 advances to
Implemented.

## Risks per phase

| Phase | Risk | Mitigation |
|---|---|---|
| 1 | AgentDBService API surface doesn't match the `_agentdbStore` / `_agentdbList` adapter slots in the skeleton | Read `agentic-flow/agentic-flow/src/services/agentdb-service.ts` before writing the adapter bodies; sketch matches the actual store/list/query signatures |
| 1 | Pattern aggregation produces noisy patterns (every common word becomes a "pattern") | Phase 1's `length >= 4` + `count >= 2` filters prune most noise. If usage data shows it's still noisy, raise floors in a Phase 2 follow-up |
| 1 | Episode storage grows unbounded | Phase 1: accept. Real cap (e.g., last 10k episodes) is a follow-up if disk pressure becomes a complaint |
| 2 | exports map collides with future agentic-flow restructure | Subpath is explicit + matches existing `./coordination/*` exports; very low risk |
| 3 | Codemod Pass 3 doesn't actually rewrite the literal in `tryOptionalImport(...)` — Pass 3 expects `import(...)` / `require(...)` / `from '...'` patterns | Verify by inspecting `dist/src/autopilot-state.js` in the published cli after release — if the string is unrewritten, fall back to using an explicit string literal at the call site that DOES match Pass 3 patterns |
| 4 | The new describe block flakes if AgentDB takes time to initialize in CI | The `beforeEach` awaits `initialize()` synchronously; if AgentDB returns false, the suite skips cleanly via the `if (!learning.isAvailable()) return` guard in each `it` |
| 5 | `autopilot_history` MCP tool doesn't exist yet | Check first; if absent, register it in `mcp-tools/autopilot-tools.ts` as part of this phase |
| 6 | `tryLoadLearning` returns null in the doctor's runtime even after a healthy install | Same as Phase 3 acceptance criterion — Phase 3 must land before Phase 6 makes sense |
| 7 | Other ADRs reference AutopilotLearning state that the implementation diverged from | Phase 7 includes a "Post-implementation revision" section in ADR-0192 to capture any divergences honestly |

## Task list (for the tracker)

1. **Phase 1 producer** — write `forks/agentic-flow/agentic-flow/src/coordination/autopilot-learning.ts` per the skeleton above; fill in `_agentdbStore` / `_agentdbList` against the real AgentDBService API
2. **Phase 2 wiring** — update `package.json` exports + `coordination/index.ts` re-exports + verify tsc build emits `dist/coordination/autopilot-learning.js`
3. **Phase 4 test scaffold** — append the new `describe('AutopilotLearning — populated AgentDB')` block to the existing test file
4. **Agentic-flow release** — push agentic-flow fork main; let the pipeline publish a new `@sparkleideas/agentic-flow` patch version
5. **Phase 3 consumer fix** — edit `forks/ruflo/v3/@claude-flow/cli/src/autopilot-state.ts` to use `tryOptionalImport` with a literal subpath
6. **Phase 5 acceptance check** — add `check_autopilot_learning_active` to `lib/acceptance-controller-checks.sh` + register `ctrl-autopilot-learn` in `scripts/test-acceptance.sh` (both sites)
7. **Phase 6 doctor entry** — add `checkAutopilotLearning` to `forks/ruflo/v3/@claude-flow/cli/src/commands/doctor.ts` + wire to allChecks + componentMap
8. **Phase 7 ADR updates** — flip statuses on ADR-072, ADR-0192, ADR-0191 autopilot row; add post-impl revision notes

Each numbered task is a candidate single commit. Tasks 1+2+3 land
together in agentic-flow's main; task 4 is automatic via the pipeline;
tasks 5+6 land together in ruflo's main and ruflo-patch's main; task
7 is docs-only and can ride either chain or stand alone.

## Verification matrix

| Layer | What proves it works | How to check |
|---|---|---|
| Unit (agentic-flow) | All 13 it-blocks pass | `cd forks/agentic-flow && npm test -- autopilot-drift-learning` |
| Integration (cli) | `tryLoadLearning` returns non-null instance | One-liner in Phase 3 acceptance criterion |
| Acceptance (ruflo-patch) | `ctrl-autopilot-learn` passes in `npm run release` | Phase 5's check |
| Doctor (operator-facing) | `ruflo doctor -c autopilot-learning` returns `pass` with `available=true` | Phase 6's check |
| ADR closure | Three ADR statuses updated | manual `grep -E '^status:' docs/adr/ADR-0192*.md` |

When all five rows are green, ADR-0192 closes.
