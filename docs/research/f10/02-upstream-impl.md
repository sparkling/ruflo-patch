# F10 facet — Current UPSTREAM implementation: does upstream auto-capture learning today?

**Verdict (one line):** **NO — upstream is ALSO dormant-by-design on the auto-fired hook path; fork and upstream are at PARITY on the seam that matters (auto-fired hooks never reach a learning-capture write). The fork is actually AHEAD on the *manually-invoked* `hooks_post-task` MCP handler.**

## Freshness (origin/main HEAD at investigation time, 2026-06-03)

| repo | path | origin/main HEAD |
|---|---|---|
| ruflo (claude-flow) | /Users/henrik/source/forks/ruflo | `844f68dbe` 2026-06-02 06:22 -0400 |
| agentdb | /Users/henrik/source/forks/agentdb | `648e502` 2026-05-29 20:10 -0400 |
| agentic-flow | /Users/henrik/source/forks/agentic-flow | `6a068546` 2026-05-23 05:35 -0400 |

Upstream `claude-flow` is **v3.10.33**, a v3 monorepo. `package.json:bin` = `./bin/cli.js` → proxies to `v3/@claude-flow/cli/bin/cli.js`. The real CLI lives in the `v3/@claude-flow/*` workspaces; there is no top-level `src/cli` hooks command (confirmed: `git show origin/main:package.json`; `bin/cli.js` is a 11-line umbrella proxy).

> **Premise-correction up front.** The F10 brief's "`cli/src/memory/intelligence.ts`" and the dev-helper "`.claude/helpers/intelligence.cjs`" are TWO DIFFERENT modules. The MCP capture handlers import the persistence-backed `v3/@claude-flow/cli/src/memory/intelligence.ts` (`recordTrajectory` → `stats.json` + SONA). The **fired Claude Code hooks** invoke the lightweight dev-helper `intelligence.cjs` (`feedback`/`recordEdit` → a local JSON; **no** trajectory/episode/SONA write). The whole verdict turns on this split (cf. fork memory `project-two-hook-paths-cli-vs-handler`).

---

## 1+2. The hook chain: what fires during normal operation, and where it terminates

### What `ruflo/claude-flow init` writes (the fired hooks)

`git show origin/main:v3/@claude-flow/cli/src/init/settings-generator.ts`, `generateHooksConfig()`:

- `PreToolUse`: Bash→`pre-bash`/modify-bash, Write|Edit|MultiEdit→`pre-edit`, Task→`pre-task`
- **`PostToolUse`: Write|Edit|MultiEdit→`post-edit` (line 374-379), Bash→`post-command` (383-388)** — fires on every edit/command
- `SubagentStart`→`status`
- **`SubagentStop`→`post-task` (line ~452-465)** — fires on every sub-agent completion
- `UserPromptSubmit`→`route`, `SessionStart`→`session-restore`, `SessionEnd`/`Stop`/`PreCompact`→`session-end`

Every one of these is `hookHandlerCmd('<sub>')` = run `.claude/helpers/**hook-handler.cjs**` `<sub>` (`git show origin/main:.../settings-generator.ts`: `function hookHandlerCmd → hookCmd('.claude/helpers/hook-handler.cjs', subcommand)`).

> Note: the plugin variant `plugins/ruflo-core/hooks/hooks.json` (POSIX) wires only `modify-bash/modify-file/post-command/post-edit/session-end` via `ruflo-hook.sh` (→ `ruflo hooks <sub>` CLI). It does **not** wire `post-task` at all. The `post-task` wire exists only in the `init`-generated `settings.json` path, on `SubagentStop`. (`plugin/hooks/hooks.json` — an OLDER alternate template — does have `PostToolUse(Task)→post-task`, but it is not what `init` writes today.)

### Where the fired hooks TERMINATE — `hook-handler.cjs` (upstream)

`git show origin/main:.claude/helpers/hook-handler.cjs` — the dispatcher loads ONE learning module: `const intelligence = safeRequire('.../intelligence.cjs')` (line 36). The capture-relevant cases:

- `'post-edit'` → `intelligence.recordEdit(file)` (line 152-156)
- **`'post-task'` → `intelligence.feedback(true)` (line 210-213)** ← the SubagentStop terminus
- `'session-end'` → `intelligence.consolidate()` (line 182-183)

`git show origin/main:.claude/helpers/intelligence.cjs` (230 lines) exports `{ init, getContext, recordEdit, feedback, consolidate, stats }`. **Grep for `recordTrajectory|trajectory|reflexion|episode|sona|lastAdaptation` → ZERO hits.** `feedback`/`recordEdit`/`consolidate` mutate a local pattern JSON (short/long-term patterns, a feedback counter). **No episode, no trajectory, no SONA adaptation is written by any fired hook.**

**⇒ Upstream's auto-fired hooks DO NOT terminate in a learning-capture write (no `reflexion-store`, no `recordTrajectory`, no SONA `lastAdaptation`). They terminate in `intelligence.feedback()`/`recordEdit()` on a local JSON. This is the dormancy.**

### The RICH handler exists — but is NOT on the fired-hook path (upstream)

`git show origin/main:v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts` (4599 lines):

- **`hooks_post-task` MCP handler** (`hooksPostTask`, line 1359) DOES capture heavily: `bridgeRecordFeedback` (→ LearningSystem + ReasoningBank, "Phase 3"), `bridgeRecordCausalEdge` (task→outcome), **`intelligence.recordTrajectory(...)`** (the persistence-backed `memory/intelligence.ts` — SONA + ReasoningBank), `insertGraphEdge` (ADR-130 `reinforced-by`), `saveRoutingOutcomes`.
- **`hooks_post-edit` / `hooks_post-command`** (`#2245 Round B`, commit `2b9e2de89` "feat(intelligence): Round B (post-edit/-command + trajectory-end → globalStats)") ALSO call `intel.recordTrajectory(...)` — synthesising a one-step trajectory from the edit/command outcome and persisting to `stats.json` (`memory/intelligence.ts:recordTrajectory → savePersistedStats()`, debounced every 16 signals; PatternStore persists patterns to disk).

**BUT** these are MCP-tool entry points. The fired Claude Code hook runs `hook-handler.cjs` → `intelligence.cjs.feedback()`, which is a *different code path* that never imports `memory/intelligence.ts` and never calls these MCP handlers. The MCP `hooks_post-task`/`hooks_post-edit` handlers are reached ONLY when a model/agent explicitly invokes the MCP tool (`mcp__…__hooks_post-task`), i.e. **a human/model explicitly invoking a tool** — exactly the case F10 excludes.

**The tool's own description is the confession** (`hooks_post-task`, hooks-defs.ts:55): *"…feeds the SONA neural router so subsequent similar tasks pick a better tier next time. **No native equivalent — Claude Code does not have a learning loop.**"* Upstream ships the capability and tells you it only runs when you call the tool.

---

## 3. Autopilot event bus (`_attachLearningSubscriber`)

`git -C agentic-flow log origin/main -S '_attachLearningSubscriber'` → **EMPTY**. The symbol is **not in agentic-flow `origin/main` history at all.** It exists only in the **fork** working tree at `agentic-flow/src/services/agentdb-service.ts` (nested fork path; ADR-0195, tests `adr0195-step-level-feedback`, `autopilot-phase4-step-feedback`). It is fork-authored, fires only during **autopilot runs** (step-level feedback), not during normal Claude Code operation. So this seam is a *fork addition ahead of upstream*, not an upstream auto-capture path. Upstream has no autopilot→LearningSystem persistence subscriber.

## 4. NightlyLearner / ReasoningBank / RvfLearningStore (upstream)

`git show origin/main` (agentdb) ships `src/controllers/NightlyLearner.ts`, `ReflexionMemory.ts`, `LearningSystem.ts` — same dormant trio as the fork. They are *consumers/aggregators*; nothing in upstream's hooks/daemon/session lifecycle *feeds* them automatically. Population is via the same explicit MCP tools/CLI the fork uses (`agentdb_reflexion-store`, `agentdb_sona_trajectory_store`, `ruflo neural`). No automatic feeder was found on upstream's fired-hook path (the only fired terminus is `intelligence.cjs`, which writes none of these stores).

---

## 5. VERDICT — auto-capture + behind-vs-parity

**Does upstream auto-capture during normal operation? NO.**
Proof of absence (the single load-bearing fact): the only Claude Code hook that fires on task completion is `SubagentStop → hook-handler.cjs post-task`, whose `'post-task'` case is **`intelligence.feedback(true)`** (`origin/main:.claude/helpers/hook-handler.cjs:210-213`) into the dev-helper `intelligence.cjs`, which has **zero** trajectory/episode/SONA writes (`origin/main:.claude/helpers/intelligence.cjs`, grep clean). The rich `hooks_post-task`/`hooks_post-edit` MCP handlers (which *do* call `recordTrajectory` + `bridgeRecordFeedback`) are reachable only by explicit MCP tool invocation. **Upstream is dormant-by-design on the hook path, exactly like the fork.**

**Behind vs parity — PARITY on the dormant seam; FORK AHEAD on the rich handler:**

| capture site | UPSTREAM (origin/main) | FORK (working tree) | who's ahead |
|---|---|---|---|
| Fired hook terminus (`SubagentStop`/`PostToolUse` → handler) | `hook-handler.cjs` → `intelligence.cjs.feedback()` — **no learning write** | generated `hook-handler.mjs` → `intelligence.cjs.feedback(outcome)` — **no learning write** (and *hardened*: refuses to fabricate `feedback(true)` when outcome missing — helpers-generator.ts:566-585) | **PARITY** (both dormant) |
| `hooks_post-edit` / `hooks_post-command` MCP (explicit call) | calls `recordTrajectory` (`#2245 Round B`, `2b9e2de89`) | **does NOT** call `recordTrajectory` — post-edit routes `routeFeedbackOp` only (hooks-tools.ts:850-903); post-command stores to `commands` ns only (942-986) | **UPSTREAM ahead** (trajectory-from-edit) |
| `hooks_post-task` MCP (explicit call) | `bridgeRecordFeedback` + causal-edge + `recordTrajectory` + `insertGraphEdge` | RICHER: ADR-0268 `agentdb_reflexion_store` **episode** write + ADR-0261/130 `reinforced-by` archivist edge + ADR-0279 action-for-NightlyLearner + routing-outcome (hooks-tools.ts:1634-1799) | **FORK ahead** (episode + reward integrity) |
| Autopilot → LearningSystem subscriber | none in `origin/main` | `_attachLearningSubscriber` (agentdb-service.ts, ADR-0195) — fires only in autopilot runs | **FORK ahead** (but not normal-op) |

**Net:** the F10 premise's core claim holds for upstream too — **nothing in upstream's normal Claude-Code operation auto-captures learning; the fired hook terminates in `intelligence.cjs`, not in any episode/trajectory/SONA writer.** The fork is **NOT behind** on the decision-relevant seam (auto-capture). Where the two differ on the *manually-invoked* MCP handlers, the fork is mostly **ahead** (richer `hooks_post-task` via ADR-0268/0261/0279, plus the fork-only autopilot subscriber); the one place upstream is ahead is the narrow `#2245 Round B` "synthesise a trajectory from each post-edit/post-command MCP call" — but that too only runs on explicit MCP invocation, so it does **not** constitute upstream auto-capture and does not change the dormant-by-design verdict.

## Caveats / indeterminate

- I did not execute a fresh `init` to materialise the generated `hook-handler.mjs`; I read its generator (`helpers-generator.ts:373-692`). The generated post-task case (562-585) provably calls only `intelligence.feedback(outcome)`. If a future generator change routed the fired hook through the MCP layer, this verdict would flip — re-check `helpers-generator.ts` post-task case before relying on parity.
- "PARITY" is on the *fired-hook auto-capture* seam only. The handlers reachable by explicit MCP call differ (table above); that is a feature-richness comparison, not an auto-capture one.
- agentdb origin/main (2026-05-29) and agentic-flow origin/main (2026-05-23) lag ruflo origin/main (2026-06-02); no auto-capture feeder was found in any of the three regardless.
