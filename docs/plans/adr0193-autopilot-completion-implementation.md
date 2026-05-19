# ADR-0193 Implementation Plan — Autopilot completion + ADR-0191/0192 follow-up gap closure

**Status**: plan (companion to ADR-0193, status: proposed)
**Owner**: Henrik Pettersen
**Closes**: ADR-0193 items A–F (item G spawns sub-ADRs 0194/0195/0196)
**Companion to**: `docs/plans/adr0192-autopilot-learning-implementation.md`

## How to read this plan

Each item below is a stand-alone work chain: one commit chain in
`forks/agentic-flow` (or, for Item F, in `ruflo-patch`) per item, one
acceptance probe per item, then a release. Items are independent; ship in
priority order. **Do not bundle items into one release** — each one moves a
different verification dial.

The priority order matches ADR-0193 §Implementation Plan; the rationale is
captured there and not re-litigated here.

---

## Item B — Real `recordIterationStep` + `endSwarmTrajectory`

**Why first**: smallest change with the highest dishonesty-reduction value.
Phase 1 left these as no-ops; consumers calling them assume state IS
recorded somewhere. Wiring them eliminates the "polite lie."

### Files

| File | Change |
|---|---|
| `forks/agentic-flow/agentic-flow/src/coordination/autopilot-learning.ts` | Replace no-op bodies of `recordIterationStep` / `endSwarmTrajectory` with SonaRvfService trajectory writes. Maintain trajectory id in private state across the swarm lifetime. |
| `forks/agentic-flow/agentic-flow/src/services/agentdb-service.ts` | Expose getter for the internal `sonaService` instance so `AutopilotLearning` can call `beginTrajectory / addStep / endTrajectory` directly. (Or: add `agentdb.recordTrajectoryStep(...)` thin proxy — pick the less leaky surface.) |
| `forks/agentic-flow/tests/integration/autopilot-learning.test.ts` | Add a `'trajectory recording'` describe block: `beginSwarm → recordIterationStep ×3 → endSwarmTrajectory`, then assert `getMetrics().trajectories === 1`. |

### Wiring contract

```ts
// AutopilotLearning private state additions
private _activeTrajectoryId: string | null = null;
private _sona: SonaLike | null = null;   // captured during initialize()

// recordIterationStep(progress, drift): if no trajectory open, open one;
// always addStep with {progress, drift, ts}.
// endSwarmTrajectory(summary): endTrajectory + reset _activeTrajectoryId.
// getMetrics(): trajectories = the persisted count via the sona/trajectory API.
```

Use the existing API surface (`sona-rvf-service.ts:94-109`). Do NOT introduce a
new persistence path. RVF-primary still holds (memory: `project-rvf-primary`).

### Acceptance probe

New check `ctrl-autopilot-trajectories` in `scripts/test-acceptance.sh`:
1. Init project, populate autopilot via `autopilot_learn` MCP with a
   simulated multi-iteration swarm (`beginSwarm / recordIterationStep ×3 /
   endSwarmTrajectory`).
2. Call `autopilot_status` (or the metrics surface) and assert
   `trajectories ≥ 1`.

### Closure

`getMetrics().trajectories` returns the actual recorded count (was always 0).
Unit + integration + new acceptance check all green.

### Fail-loudly check

If `SonaRvfService.beginTrajectory` throws or returns falsy, the methods
must surface a `console.error` and leave `_activeTrajectoryId` null —
**not** silently swallow (memory: `feedback-no-fallbacks`).

---

## Item C — Stop-hook re-engagement-context consumer wiring

**Why second**: proves the producer is actually consumed; high user-facing
value the moment Phase 1 ships.

### Audit result (confirmed during planning)

`forks/agentic-flow/.claude/helpers/autopilot-hook.mjs` does **NOT** call
`learning.getReEngagementContext` anywhere. Lines 224-247 build the
re-engagement prompt purely from raw task counts (`completed/total`,
`remainingList`). This is a real wiring gap, not just an audit.

### Files

| File | Change |
|---|---|
| `forks/agentic-flow/.claude/helpers/autopilot-hook.mjs` | (1) Import `AutopilotLearning` (lazy, via dynamic import to keep the hook fast when learning is unavailable). (2) After computing `analysis.remaining`, call `learning.getReEngagementContext(remaining)`. (3) Append `recommendations` + `pastFailures` + top-3 `patterns` to the console output, after the `Remaining tasks:` block. (4) On AgentDB-unavailable, skip the augmentation silently (graceful-unavailable is correct here, not in the producer). |
| `forks/agentic-flow/.claude/helpers/autopilot-hook.test.mjs` | New test (use `node --test`): mock `AutopilotLearning` to return a fixed context; assert the stdout contains the `pattern` and `past failure` markers. |

### Output contract additions

After the existing `Please continue working on the remaining tasks…`
line, the hook prints:

```
Learning context (N episodes, confidence X.XX):
  Top patterns:
    - "<pattern>" succeeded Y× (avg reward Z.ZZ)
    - …
  Past failures to avoid:
    - <subject>: <critique>
    - …
  Recommendations:
    - <rec text>
    - …
```

When `learning.isAvailable() === false` or `context.confidence === 0`,
print nothing in this block (no "Learning unavailable" stub — silence is
fine; the rest of the hook continues unchanged).

### Acceptance probe

New check `ctrl-autopilot-stop-hook` in `scripts/test-acceptance.sh`:
1. Init project, populate autopilot with ≥10 episodes including ≥1 explicit
   failure with a `critique` field.
2. Write a synthetic `swarm-tasks.json` with one `pending` task whose
   subject overlaps the populated episode subjects.
3. Invoke `node .claude/helpers/autopilot-hook.mjs` directly, capture
   stdout.
4. Assert the output contains `pattern` AND (`past success` OR
   `past failure`) AND the populated episode's subject substring.

### Closure

Acceptance check passes; the hook visibly augments the re-engagement
prompt with learning-derived text once episodes exist.

### Risk discharge (ADR-0193 §Risks, Item C)

The audit found the producer was NOT being called. The closure here is
"wire + probe" not "verify pre-existing wiring."

---

## Item A.2 — Embedding-based `recallSimilarTasks`

**Why third**: small change, big quality uplift, feeds Item C's prompt
relevance directly. Uses an embedder that already exists.

### Files

| File | Change |
|---|---|
| `forks/agentic-flow/agentic-flow/src/coordination/autopilot-learning.ts` | Replace `recallSimilarTasks` substring filter with embedding-based cosine similarity. Use the existing AgentDBService embedder (the same one `recallEpisodes` uses internally). **Fall back to substring ONLY** when the embedder genuinely returns null/undefined — `try/catch` is a squelch and forbidden (memory: `feedback-no-fallbacks`). If the embedder throws, surface the error and refuse to mask it. |
| `forks/agentic-flow/tests/integration/autopilot-learning.test.ts` | Add a `'embedding recall'` block: populate episodes about "react bug fix" / "vue refactor" / "css color tweak"; query `"react"`; assert react-related episodes rank above vue/css; assert vue/css are NOT returned (or return with lower position) — concrete top-K ordering, not just "result count > 0". |

### Embedder discovery

The episode storage path (`AgentDBService.storeEpisode → recallEpisodes`)
already runs against the ReflexionMemory layer which holds embeddings.
The recall surface is `recallEpisodes(query, limit, filters)` —
**use this directly** instead of plumbing a separate embedder reference
through `AutopilotLearning`. Phase 1 deliberately avoided it for
determinism; with the test populated, embedding ordering becomes
testable.

```ts
async recallSimilarTasks(query: string, limit: number): Promise<AutopilotEpisode[]> {
  if (!this._available || !this._agentdb) return [];
  const rows = await this._agentdb.recallEpisodes(query, limit, {
    sessionId: EPISODE_SESSION_ID,
  });
  return rows.map(this._rowToEpisode.bind(this));  // extract _listEpisodes mapper
}
```

This eliminates the in-memory `.filter(...includes(q))` pass entirely.

### Acceptance probe

Extend `ctrl-autopilot-learn` rather than adding a new check: populate
episodes with three distinct subject clusters; assert
`recallSimilarTasks("X")` returns cluster-X episodes ranked first.

### Closure

The substring-only Phase 1 fallback is gone; populated-suite assertion
locks in the ordering behavior.

### Risk discharge (ADR-0193 §Negative)

Behavior change in `recallSimilarTasks` may break a populated assertion
that relied on substring matching. Re-calibrate the existing populated-
suite block — it's the right time to do it (Item A.2 is the only Phase 2
change that affects pure-recall behavior).

---

## Item D — queryOptimizer active-use verification

**Why fourth**: closes ADR-0191 §B7 ("feature works" gap) and is purely
verification work (no production code change expected).

### Files

| File | Change |
|---|---|
| `scripts/test-acceptance.sh` | New check `ctrl-query-optimizer-cache`: run `memory_search` twice with identical inputs; assert second call response carries `cached: true` OR is materially faster (e.g., `< 50%` of first call's duration). Both signals captured for diagnosis. |

### Probe shape

```bash
check_query_optimizer_cache() {
  local out1 out2 t1 t2
  t1_start=$(_now_ms)
  out1=$(_cli_cmd memory search --query "test cache hit" --json)
  t1=$(($(_now_ms) - t1_start))
  t2_start=$(_now_ms)
  out2=$(_cli_cmd memory search --query "test cache hit" --json)
  t2=$(($(_now_ms) - t2_start))
  if echo "$out2" | grep -q '"cached":[[:space:]]*true'; then
    return 0
  fi
  # Time-based fallback signal (still a real proof — cache means faster)
  if [ "$t2" -lt $((t1 / 2)) ]; then
    return 0
  fi
  echo "queryOptimizer cache miss: t1=${t1}ms t2=${t2}ms cached=false"
  return 1
}
```

Use `$(_cli_cmd ...)` per memory `reference-cli-cmd-helper`. Both probes
together discriminate "registered but not wired" from "wired but cache
disabled" from "working" — exactly the three states ADR-0193 §D names.

### Closure

`ctrl-query-optimizer-cache` is green; cache observably hits on repeated
identical queries.

### If the probe fails

Don't squelch (memory: `feedback-no-squelch-tests`). Root-cause first:
- Is `queryOptimizer` actually called in `memory_search`'s MCP handler?
  Grep `forks/agentic-flow/agentic-flow/src/mcp/.../memory*.ts`.
- Is the cache disabled by an env var or config flag in the init
  template?
- Is the try/catch from ADR-0191 Cluster B silently catching a cache
  error?

---

## Item E — `drift-detector.ts` + `swarm-completion.ts` orphan-spec sibling files

**Why fifth**: largest scope; needs both files designed AND the orphan
test file repaired.

### Pre-work: repair the malformed test file

Inspection found `tests/integration/autopilot-drift-learning.test.ts`
contains a **dangling object literal at lines 178-186** (orphaned fragment
from a deleted describe block):

```ts
      { subject: 'unrelated query', status: 'pending' },
    ]);
    expect(ctx.confidence).toBeGreaterThan(0.2);
    expect(ctx.confidence).toBeLessThanOrEqual(1.0);
  });
});
```

This will trip vitest's parser even after the imports resolve. **First
commit in the chain**: clean up the stray fragment so the file parses,
THEN start building.

### Files (production)

| File | Change |
|---|---|
| `forks/agentic-flow/agentic-flow/src/coordination/drift-detector.ts` | New file. Exports `DriftDetector`, `DriftSignal`, `DriftConfig`, `DriftMetrics`. Contract from the test file's 8 it-blocks: stall/cycling/thrashing/decay detection + mitigation suggestions + metrics/state. Default config: `stallThreshold = 5`, cycling/thrashing thresholds inferred from `recordTaskFailure ×3` / `recordAgentReassignment ×3`. |
| `forks/agentic-flow/agentic-flow/src/coordination/swarm-completion.ts` | New file. Exports `SwarmCompletionCoordinator`. Contract: `addTasks / updateTask / tick / getDriftMetrics / generateReEngagementPrompt / initializeLearning / reset`. Composes a `DriftDetector` internally; tick records iterations; updateTask records failures + reassignments. |

### Contract details (from test file, line numbers)

**DriftDetector** (lines 29-177):

| Method | Behavior |
|---|---|
| `recordIteration({ completed: N })` | Push to `completionRateHistory`; if N === 0, increment `iterationsSinceLastCompletion`, else reset to 0. |
| `recordTaskFailure(taskId)` | Track per-task failure count; ≥3 triggers `cycling` signal with `affectedTaskIds: [taskId]`. |
| `recordAgentReassignment(taskId, from, to)` | Track per-task reassignment count; ≥3 triggers `thrashing` signal. |
| `detectDrift()` | Returns `DriftSignal[]` of currently-active signals. Stall: `iterationsSinceLastCompletion ≥ 5` with severity `high`. Decay: first-half sum vs. second-half sum on `completionRateHistory` (≥10 samples) drops below 50%; severity `low`. |
| `suggestMitigation(signal)` | Stall→`escalate`, Cycling→`reprioritize` (with `taskIds`), Thrashing→`reassign`, Decay→`skip`. |
| `getMetrics()` | `{iterationsSinceLastCompletion, completionRateHistory, totalSignals, signalsByType, activeSignals}`. |
| `reset()` | Zero all state. |
| `getConfig() / setConfig({...})` | Default config readable + mutable; `stallThreshold` default 5. |

**SwarmCompletionCoordinator** (lines 190-265):

| Method | Behavior |
|---|---|
| `constructor({maxIterations, timeoutMinutes})` | Stores limits; instantiates an internal `DriftDetector`. |
| `addTasks([{id, subject, status, owner?}])` | Tracks tasks. |
| `updateTask(id, status, newOwner?)` | If `status` ∈ `{blocked, failed}` → `drift.recordTaskFailure(id)`. If `newOwner !== currentOwner` → `drift.recordAgentReassignment(id, old, new)`. |
| `tick()` | Compute completion delta vs. previous tick; `drift.recordIteration({completed: delta})`. |
| `getDriftMetrics()` | Pass-through to `drift.getMetrics()`. |
| `generateReEngagementPrompt()` | Returns string containing `Progress:`; appends drift warnings when `detectDrift()` is non-empty. |
| `initializeLearning()` | Returns `Promise<boolean>`; safe-no-op when AgentDB unavailable. |
| `reset()` | Calls `drift.reset()` + clears task state. |

### Acceptance probe

The vitest run is the probe — the existing 16-block test file passes
once both source files exist and parse. No new acceptance harness check
is needed; this is fork-internal verification.

### Closure

- Stray fragment removed.
- Both source files exist + compile.
- `npm run test:integration` (inside `forks/agentic-flow`) passes
  `autopilot-drift-learning.test.ts` 16/16.
- `npm run release` from `ruflo-patch` still green (no regression on
  `ctrl-autopilot-*` checks).

### Risk discharge (ADR-0193 §Risks, Item E)

The orphan test is the binding spec. If a test asserts behavior that
turns out to be wrong, the right move is to **fix the test then re-run
the suite** — but only after the implementation matches the literal
contract. Don't pre-emptively soften assertions.

---

## Item F — Acceptance harness `--prefer-offline` cache hardening

**Why sixth**: process improvement; prevents the next stale-cache
misdiagnosis. Lives entirely in `ruflo-patch`.

### Files

| File | Change |
|---|---|
| `scripts/test-acceptance.sh` (lines 290, 320) | Before each install line, run `_cache_bust_bumped_packages` that reads the bumped-package list from `scripts/.last-build-state` (already maintained by `ruflo-publish.sh:24`) and runs `npm cache clean <pkg>` for each. |
| `scripts/test-acceptance.sh` (new helper) | `_cache_bust_bumped_packages()`: parses `.last-build-state` (already written by publish step); iterates bumped packages; `npm cache clean @sparkleideas/<name>` per item; logs each clean for traceability. |

### Implementation contract

```bash
_cache_bust_bumped_packages() {
  local state_file="${SCRIPT_DIR}/.last-build-state"
  [ -f "$state_file" ] || { log "No .last-build-state — skipping cache bust"; return 0; }
  local bumped
  bumped=$(jq -r '.bumped[]?' "$state_file" 2>/dev/null) || return 0
  [ -z "$bumped" ] && return 0
  while IFS= read -r pkg; do
    log "Cache bust: $pkg"
    npm cache clean "$pkg" --registry "$REGISTRY" 2>&1 | tail -1 || true
  done <<< "$bumped"
}
```

Decide JSON shape based on whatever `.last-build-state` already contains
(it's written by `ruflo-publish.sh`; read its actual schema before
adding `jq` calls).

### Acceptance probe

Manually verify with a contrived "freshly bumped, contract changed" case:
1. Commit a fork change that bumps a package's export signature.
2. `npm run release` — must pass **without** `--force`.

No automated check is added (would require synthesizing a contract-break
scenario, which is itself a publishing operation; that's circular).

### Closure

A release that bumps a fork in a way that would have previously triggered
the cache-pin trap succeeds without `--force`. Document the closure
condition in the commit message; re-test on the next contract-change
release.

### Out of scope (per ADR-0193 §Out of scope)

Do **not** drop `--prefer-offline` globally. The bumped-package targeted
clean preserves install-speed for un-bumped packages.

---

## Items A.1, A.3, A.4 — predict / reward shaping / retention

**Why seventh**: quality uplifts on top of Item B's trajectory recording.
Bundled per the ADR.

### A.1 — Real `predictNextAction(state)`

| File | Change |
|---|---|
| `forks/agentic-flow/agentic-flow/src/coordination/autopilot-learning.ts` | `predictNextAction(state)`: take `state.subject` (or hash `state.taskShape`); call `recallSimilarTasks(subject, 10)`; tally next-action distribution from matched episodes; return most-frequent action + `confidence = unanimity × log(matchCount+1)/log(11)`. |

State assumption: `state` already carries `subject` (the consumer's
responsibility). If not, return `{action: 'continue', confidence: 0}` —
deterministic baseline rather than throwing.

### A.3 — Reward shaping in `_record`

| File | Change |
|---|---|
| `forks/agentic-flow/agentic-flow/src/coordination/autopilot-learning.ts` | Replace `±1` with a shaped reward: `base = success ? 1 : -1`; `efficiency = clamp(median(iterations_for_subject) / iterations, 0, 2)`; `time_penalty = clamp(durationMs / median(durationMs_for_subject), 0, 2)`; `critique_penalty = critique ? -0.5 : 0`. Final = `base × efficiency / time_penalty + critique_penalty`, clamped to `[-2, 2]`. |

Document the formula at the call site (one short comment — it's the kind
of WHY that's load-bearing because the populated tests will need to
match it).

### A.4 — Episode retention/pruning

| File | Change |
|---|---|
| `forks/agentic-flow/agentic-flow/src/coordination/autopilot-learning.ts` | Add `EPISODE_CAP` const (default 10000, env-overridable via `AUTOPILOT_EPISODE_CAP`). After every `_record` that crosses the cap, `_listEpisodes()`, sort by timestamp ascending, delete oldest until under cap. |
| same | `_listEpisodes` already uses `MAX_LIST = 1000` for in-memory aggregation; that's separate from the persistence cap and stays. |

Eviction needs a delete API on AgentDBService. If `recallEpisodes`-style
list-and-delete is the only path, accept the O(N) cost — episode count
is capped so it's bounded.

### Acceptance probe (combined)

Extend `ctrl-autopilot-learn` populated suite:
- Assert `predictNextAction({subject: <known-subject>})` returns the
  most-common next action from the populated set with
  `confidence > 0`.
- Assert reward of a 3-iteration completion > reward of a 15-iteration
  completion (efficiency signal).
- Populate cap+10 episodes; assert `getMetrics().episodes ≤ EPISODE_CAP`.
- **Re-tighten** the loose `toBeGreaterThanOrEqual(15)` populated
  assertions (commit `1800e40`) back to `toBe(15)` now that A.4 caps
  growth.

### Closure

All three quality uplifts in place; populated test suite re-tightened
to exact-equality assertions where Phase 1's accumulation forced
inequality looseness.

---

## Item G — Phase 3-5 (deferred to sub-ADRs)

**This plan does NOT implement Item G.** Per ADR-0193 §G, each phase
gets its own sub-ADR when prioritised:

- **ADR-0194** — Phase 3: GNN-enhanced patterns
- **ADR-0195** — Phase 4: cross-controller bridges
- **ADR-0196** — Phase 5: federated learning (interface only — runtime
  deferred further to a federation-infrastructure ADR)

Open these three sub-ADRs as **proposed** at the end of this plan's
execution so ADR-0193 can close per its §Closing condition. They sit
as proposed indefinitely until prioritised.

---

## Execution order (commit chain)

One commit chain per item; **one release per item** (per the ADR's
"each item lands in its own commit chain"):

1. **Item B chain**:
   - `forks/agentic-flow`: implement trajectory wiring + unit tests +
     integration test additions
   - `ruflo-patch`: add `ctrl-autopilot-trajectories` acceptance check
   - `npm run release` → expect green

2. **Item C chain**:
   - `forks/agentic-flow`: wire `autopilot-hook.mjs` + add `.test.mjs`
   - `ruflo-patch`: add `ctrl-autopilot-stop-hook` acceptance check
   - `npm run release`

3. **Item A.2 chain**:
   - `forks/agentic-flow`: switch `recallSimilarTasks` to embedding path +
     update populated test for ordering
   - `ruflo-patch`: extend `ctrl-autopilot-learn` ordering assertions
   - `npm run release`

4. **Item D chain**:
   - `ruflo-patch` only: add `ctrl-query-optimizer-cache`
   - `npm run release`

5. **Item E chain**:
   - `forks/agentic-flow` commit 1: clean malformed fragment in
     `autopilot-drift-learning.test.ts` (lines 178-186 dangling literal)
   - `forks/agentic-flow` commit 2: implement `drift-detector.ts`
   - `forks/agentic-flow` commit 3: implement `swarm-completion.ts`
   - `npm run release`

6. **Item F chain**:
   - `ruflo-patch` only: `_cache_bust_bumped_packages` helper +
     install-call wiring
   - `npm run release` (validates the harness itself)

7. **Item A.1 / A.3 / A.4 chain**:
   - `forks/agentic-flow`: predict + reward + retention bundle (all
     three; they share calibration of the populated test suite)
   - `ruflo-patch`: extend `ctrl-autopilot-learn` for prediction +
     efficiency + cap assertions
   - `npm run release`

8. **Item G**:
   - `ruflo-patch`: create ADRs 0194 / 0195 / 0196 (proposed) via the
     `/adr-create` skill
   - Update ADR-0193 status to **accepted** (all closure conditions
     met).

## Verification gates

After each chain:

- `npm run test:unit` — must pass before `npm run release`
- `npm run release` — must pass without `--force`
- Inspect `test-results/` for the new check; assert green
- Update ADR-0193's verification matrix row for the closed item

## Pre-flight reminders

- Commit fork changes on `main` with descriptive messages BEFORE release
  (per `feedback-fork-commit-attribution.md` — no `Co-Authored-By`
  trailer on fork commits).
- Verdaccio always up at `localhost:4873` (memory: `reference-verdaccio`).
- Use `bash scripts/test-acceptance-fast.sh --group adr0192` between
  release runs to iterate on just the autopilot checks when source is
  unchanged.
- Update `docs/upstream/INTEGRATION-LEDGER.md` if any of these items
  inadvertently picks up an upstream commit (unlikely for this work).

## Out of scope for this plan

- Phase 3-5 implementation (deferred to ADR-0194/0195/0196).
- Removing `--prefer-offline` globally (per ADR-0193 §Out of scope).
- Renaming `autopilot_learn` MCP tool (per ADR-0193 §Out of scope).
- Replacing vitest (per ADR-0193 §Out of scope).

## Closure of this plan

This plan is complete when ADR-0193's `## Closing condition` is met:

- Items A–F: all have green acceptance checks AND landed commits.
- Item G: sub-ADRs 0194 / 0195 / 0196 written (status: proposed).
- ADR-0193 status flipped from `proposed` to `accepted` (or
  `implemented`).
- ADR-0192's `## Where honest "still degraded" remains` inventory
  removed (content has moved here and been resolved).
