# ADR-0104: Hive-Mind Queen Orchestration

- **Status**: Implemented (2026-04-28); Q1 + §4a-empirical resolved positive by live smoke (2026-04-29); **Q4 resolved positive by upstream `e50df6722` HIGH-02** (2026-04-29 redundancy audit — adopt on next upstream merge). All three open questions closed. Smoke-script authoring remains deferred.
- **Date**: 2026-04-28
- **Scope**:
  - Fork (`forks/ruflo`):
    - `v3/@claude-flow/cli/src/parser.ts`
    - `v3/@claude-flow/cli/src/commands/hive-mind.ts`
    - `v3/@claude-flow/cli/src/init/mcp-generator.ts`
    - `v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts`
  - ruflo-patch:
    - `lib/acceptance-adr0104-checks.sh`
    - `tests/unit/acceptance-adr0104-checks.test.mjs`
    - `scripts/test-acceptance.sh` (wiring)

## Context

`hive-mind spawn --claude` was broken end-to-end. Architecturally, the Queen
prompt forbade Task tool while pointing at a JSON-stub MCP path that couldn't
spawn real workers. Operationally, four CLI defects prevented the Queen
session from getting off the ground at all (parser greedy-consumed the
objective; missing-objective silently substituted vague defaults; output
falsely claimed to spawn agents; MCP attach failed in `-p` mode). Concurrent
writes to hive state had no locking.

This ADR makes the hive actually orchestrate as documented: Queen launches
via `child_process.spawn('claude', ...)` against the developer's
subscription, spawns workers via Task tool inside its session, workers
coordinate via the existing functional `mcp__ruflo__hive-mind_*` MCP tools.

## Decision

Six source-level fixes:

1. **Parser flag scoping** — hoist `--non-interactive` to `globalOptions` in
   `parser.ts` so the lazy-loaded `hive-mind` command's boolean flag is
   recognized pre-load. Without this, `spawn --non-interactive "obj"`
   greedy-consumed `"obj"` as the flag's value.

2. **Hard-error on missing objective** — when `--claude` is set and no
   objective is provided, exit 1 with a clear message + positional-ordering
   hint. Was silently substituting a vague placeholder the LLM rejected.

3. **Honest output wording** — "Spawned N agents" → "Registered N worker
   slot(s) in hive state" + clarifier that real workers come from Task tool
   inside the Queen session. Slots are state-record writes, not running
   agents.

4. **`.mcp.json` direct path** — `mcp-generator.ts` detects locally-installed
   `claude-flow` on `$PATH` and emits a direct-path entry; falls back to
   `npx -y @claude-flow/cli@latest mcp start`. The `npx` cold start (~5–8s)
   exceeded claude-code's MCP handshake budget.

5. **Hive state file lock** — `hive-mind_memory` `set`/`delete` wrap
   `loadHiveState → mutate → saveHiveState` under `withHiveStoreLock`
   (O_EXCL sentinel + stale-recovery, lifted from ADR-0098's swarm pattern).
   `saveHiveState` does atomic tmp + rename. Eliminates race-clobber when
   parallel Task workers write coordination state.

6. **Queen prompt — revert + worker coordination contract**:
   - Remove the `Do NOT use Claude native Task/Agent tools` block.
   - Add `🛠️ TOOL USE` block: Queen uses Claude Code's Task tool to spawn
     workers; uses `mcp__ruflo__hive-mind_*` MCP tools for shared memory,
     consensus, broadcasts, status; native Read/Write/Edit/Bash/Grep/Glob
     for orchestration logic.
   - Add `📝 WORKER COORDINATION CONTRACT (v3)`: when spawning a worker via
     Task tool, include verbatim contract instructing the worker to write
     its structured output to
     `mcp__ruflo__hive-mind_memory({action:'set', key:'worker-<id>-result', value:<output>})`
     before returning.
   - Preserve unchanged: 4-phase protocol, parameterization headers
     (queenType / topology / consensusAlgorithm / workerCount / workerTypes),
     queen leadership patterns, MCP tools list, memory namespace conventions.

## Verification

**Regression** — `lib/acceptance-adr0104-checks.sh` (10 scenarios) wired into
`scripts/test-acceptance.sh`; paired `tests/unit/acceptance-adr0104-checks.test.mjs`
(35 tests, 0 failures). Covers: §1 parser hoist, §2 hard-error, §3 wording,
§4a direct-path detection, §5 lock under N=8 distinct-key + N=8 same-key
contention, §6 prompt content, parameterization preservation. Runs every
`test:acceptance`.

**Live smoke** — in a fresh `ruflo init --full` project, run
`npx ruflo hive-mind spawn "<objective>"`. Workers and the Queen execute as
`claude` CLI processes against the developer's Claude subscription (no API
key, no per-token billing — the same subscription powers `claude` interactive
sessions). Verify after the run:

- result artifact for the objective was written by the Queen
- `.claude-flow/hive-mind/state.json` `sharedMemory` has at least one
  `worker-<id>-result` key
- spawned Queen session's init JSON shows `"claude-flow":"connected"`
- Queen used Task tool at least once

Not wired into automated acceptance because it requires the developer's
interactive `claude` auth context.

## Open Questions

All three open questions are now **resolved positive**:

- Q1 and §4a-empirical by the 2026-04-29 live smoke run
- Q4 by upstream `e50df6722` HIGH-02 (strict `=== true` check on `--dangerously-skip-permissions` propagation), confirmed during the 2026-04-29 redundancy audit

| # | Question | Status |
|---|---|---|
| Q1 | Do Task sub-agents in claude `-p` mode have access to the parent's MCP servers (`mcp__ruflo__*`)? | **Resolved positive.** Live smoke (2026-04-29): three Task workers spawned by the Queen successfully wrote `worker-<id>-result` keys to `mcp__ruflo__hive-mind_memory`; Queen read them back and produced an aggregate verdict. §6's worker contract works as designed; no Queen-side aggregation fall-back needed. |
| §4a-empirical | Does the `npx → direct-path` switch in `mcp-generator.ts` actually fix MCP attach in `-p` mode? | **Resolved positive.** Same smoke run: spawned Queen session's init JSON listed `mcp__claude-flow__*` tools (`agent_health`, `agent_list`, `agent_pool`, …) — proving the MCP server attached during handshake. `.mcp.json` `claude-flow` entry was the direct-path form (`/.../node_modules/.bin/claude-flow`). |
| Q4 | Why does `--dangerously-skip-permissions` not propagate in `-p` mode? | **Resolved positive (closed by upstream).** Upstream `e50df6722` HIGH-02 changed the propagation logic from `!== false` to a strict `=== true` check. Under the new semantics, an absent flag now correctly means "don't skip permissions"; child Queen invocations only get `--dangerously-skip-permissions` if the parent actually passed it. This is the **hypothesis-C path** (argv-ordering / propagation bug) among the three Q4 hypotheses; A (claude-code policy filters) and B (needs `--permission-mode=acceptEdits`) become moot. **Adopt `e50df6722` on next upstream merge** (per ADR-0111 §"Recommended merge order" group E). Original-3-hypothesis text retained in commit history if needed for archaeology. |

## Deferred

| Item | What's needed | Notes |
|---|---|---|
| Smoke script | Author `scripts/manual-hive-smoke.sh`. Wraps the §Verification "Live smoke" steps + the 2026-04-29 reproduction recipe into a runnable script. | Lower priority now: the recipe is captured in §Verification + Implementation Log, and the smoke has been successfully run once. |

## Out of scope

These are explicit non-goals so future drafts don't drift back into them:

- Headless / out-of-process workers for hive roles (`HeadlessWorkerExecutor`
  is for maintenance workers per ADR-014/020).
- Permission pre-grants in `.claude/settings.json` (upstream init doesn't
  write `permissions.allow` rules).
- Round-based protocol reframing (upstream uses 4 phases).
- Topology behavior differentiation (upstream uses topology as metadata
  string; per-topology cross-worker visibility / ring-pass / etc. are not
  implemented anywhere).
- Consensus algorithm behavioral differentiation (`${consensusAlgorithm}`
  is prompt-string interpolation; Byzantine f<n/3 / Raft / Gossip are not
  enforced at runtime).
- Mixed-type worker spawns (CLI takes a single `--type`; heterogeneous
  workers in one spawn would require a CLI flag change).
- Worker failure handling, contract-violation triage, quorum checks
  (upstream prompt doesn't specify them).
- Formal `WorkerOutput` / `RoundState` schemas (worker prompts are
  free-form; no schema today).
- Stale-state cleanup at spawn-time (`hive-mind_leave` exists but no
  upstream code uses it for orphan cleanup; separate ADR if needed).
- Wiring hooks to `hive-mind/state.json` (hooks are for trajectory learning,
  not coordination — intentional separation).
- Round caps / per-objective limits (no concept in ruflo: hive workers are
  local `claude` CLI invocations against the developer's subscription;
  there's nothing to gate at runtime).
- Session resume/pause edge cases.
- `hive-mind_shutdown` behavior under in-flight workers.

## Implementation Log

### 2026-04-28 — Operational fixes shipped, deferred items remain

| File | Change |
|---|---|
| `v3/@claude-flow/cli/src/parser.ts` | §1 — hoist `non-interactive` to `globalOptions`. |
| `v3/@claude-flow/cli/src/commands/hive-mind.ts` | §2 / §3 / §6 — hard-error on missing objective; honest "Registered worker slot(s)" wording; replace `#1422 TOOL PREFERENCE RULES` block with `🛠️ TOOL USE` + `📝 WORKER COORDINATION CONTRACT`. 4-phase PROTOCOL + parameterization headers preserved. |
| `v3/@claude-flow/cli/src/init/mcp-generator.ts` | §4a — add `detectClaudeFlowPath()` + `createClaudeFlowEntry()`; route `mcpServers['claude-flow']` through them. (ADR originally pointed at `claudemd-generator.ts`; Q3 verification redirected to the actual `.mcp.json` generator.) |
| `v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts` | §5 — `withHiveStoreLock` (O_EXCL + stale recovery) + atomic `saveHiveState` (tmp + rename); `hive-mind_memory` `set`/`delete` wrapped. |

Fork commit `fe18fddb7` on `sparkling/ruflo`. Built into
`@sparkleideas/cli@3.5.58-patch.245` on Verdaccio; markers verified in the
published tarball (`'TOOL USE'`, no `'Do NOT use'` block, `'WORKER
COORDINATION CONTRACT'`, `'Registered'`, parser `'non-interactive'` ×2,
`'withHiveStoreLock'` ×4).

ruflo-patch commit `e8c7bad` ships the ADR + acceptance lib + paired test.
`npm run test:unit`: 3669 pass / 0 fail / 1 allowlisted skip. ADR-0097 lint:
clean.

Three live-smoke items (Q1, §4a empirical, smoke script) remain — listed
above under §Deferred. They require interactive `claude` CLI auth context;
not blockers for the implementation since regression coverage is automated.

### 2026-04-29 — Live smoke run resolves Q1 and §4a-empirical

Ran the canonical smoke against `@sparkleideas/cli@3.5.58-patch.245`
(installed from local Verdaccio). All structural checks AND end-to-end
orchestration verified.

**Setup**:
- Fresh `/tmp/hive-test-1777478083`
- `npm install @sparkleideas/cli@latest` (Verdaccio registry)
- `ruflo init --full`  →  `.mcp.json` `claude-flow` entry: direct-path
  (`/.../node_modules/.bin/claude-flow`, args `['mcp', 'start']`) — §4a
- `ruflo daemon start --quiet`  →  `ruflo memory init`  →
  `ruflo hive-mind init --topology hierarchical-mesh --consensus raft`

**Structural checks** (dry-run path):
- §1 parser: `ruflo hive-mind spawn --claude --dry-run --non-interactive 'Build REST API'` — `'Build REST API'` preserved (appears 2× in generated prompt; not greedy-consumed).
- §2 hard-error: `ruflo hive-mind spawn --claude --dry-run` (no `-o`) — exits with `[ERROR] Objective is required when using --claude.` plus positional-ordering hint and example.
- §3 wording: spawn output reads `Note: slots are state records — actual worker processes are launched by the Queen via --claude` (no "Spawned N agents" framing).
- §6 prompt: `🛠️ TOOL USE` block present (1×), `WORKER COORDINATION CONTRACT` present (1×), legacy `Do NOT use Claude native` block absent (0×). Parameterization preserved (`Queen Type`, `Topology`, `Consensus`, `Worker Count` — all present).

**Live orchestration** (real Queen launch via `claude --claude --non-interactive --dangerously-skip-permissions`):

```bash
ruflo hive-mind spawn \
  -o "Pick the best primary color out of red, blue, green. Spawn 3 workers (one per color) — each argues for their color in 1 sentence to mcp__ruflo__hive-mind_memory. Queen reads shared memory and writes the verdict (winner + 1-line reasoning) to verdict.txt" \
  -n 3 --type researcher \
  --queen-type strategic --consensus majority \
  --claude --non-interactive --dangerously-skip-permissions
```

Run completed cleanly. Receipts:

- **Spawned `claude` session init JSON** included `Task` in tools list AND `mcp__claude-flow__agent_health`, `_agent_list`, `_agent_pool`, `_agent_spawn`, … — proving Task tool available + MCP server attached during handshake (§4a positive).
- **`.claude-flow/hive-mind/state.json` sharedMemory** had three keys after the run:
  - `worker-red-result`: `{"color": "red", "argument": "Red is the best primary color because it commands instant attention as the most viscerally powerful wavelength humans perceive..."}`
  - `worker-blue-result`: `{"color": "blue", "argument": "Blue is the best primary color because it evokes the vastness of sky and ocean, calms the human mind..."}`
  - `worker-green-result`: `{"color": "green", "argument": "Green is the best primary color because it sits at the peak of human visual sensitivity..."}`
  - All three written by Task sub-agents via `mcp__ruflo__hive-mind_memory({action:'set'})` — proves Q1 positive (sub-agents inherit parent's MCP servers) and §6's worker contract executes as designed.
- **`verdict.txt` produced by the Queen**:
  ```
  Winner: Green
  Reasoning: Green sits at the peak of human photopic visual sensitivity (~555nm),
  making it the most perceptually efficient and universally restful primary color.
  ```
  Queen's reasoning quotes the specific concept from `worker-green-result` ("peak of human visual sensitivity") — proving it actually read shared memory and aggregated, not improvised.

The README claim "Queen-led hierarchy with shared memory and consensus" is
empirically true under this smoke. The remaining out-of-scope items
(topology / consensus / queen-type *behavioral* differentiation, fault
tolerance) are unchanged — they're prompt-string interpolation per the
out-of-scope list, not addressed by ADR-0104.

### 2026-04-29 — Upstream redundancy audit closes Q4

The 15-agent redundancy-audit swarm (per ADR-0111 §"15-agent redundancy-audit swarm: hypothesis decisively refuted") confirmed two findings about ADR-0104 against upstream's 67-commit window:

**1. None of the 6 source fixes are made redundant by upstream.** §1, §2, §3, §4a, §5, §6 all survive merge (some with mechanical hand-resolution per ADR-0111 §Conflict zones). Specifically:
- §1 parser hoist: upstream `01070ede8` fixes a *different* lazy-command bug (`lazyCommandNames` registry); doesn't make `--non-interactive` a global boolean
- §2 hard-error on missing objective: no upstream equivalent
- §3 honest output wording: no upstream equivalent
- §4a `.mcp.json` direct-path: `init/mcp-generator.ts` had **zero upstream commits** in the 67-commit window
- §5 `withHiveStoreLock`: upstream modified the handlers we wrap (`a101c2a08` validation, `04d6a9a0a` AgentDB sidecar, `6992d5f67` real consensus) but lock semantics still apply — mechanical re-wrap on merge (heaviest hand-merge per ADR-0111 §Conflict zones)
- §6 `#1422` revert + WORKER COORDINATION CONTRACT: **directly contradicts** upstream `8c4cecfb1` (the commit that introduced the `#1422` block); acceptance check `check_adr0104_section_6` enforces "Do NOT use" block is absent on every test run

**2. Q4 closes via upstream `e50df6722` HIGH-02.** The strict `=== true` check on `--dangerously-skip-permissions` propagation is the **hypothesis-C path** among the three Q4 hypotheses (claude-code policy filters / `--permission-mode=acceptEdits` / argv-ordering bug). A and B become moot — the propagation logic was indeed bugged on the upstream side, not a claude-code policy issue. Adopt `e50df6722` on next upstream merge (per ADR-0111 §"Recommended merge order" group E "Hive-mind cluster"). After adoption, ADR-0104 §Decision-4b ("This ADR does not patch permissions") becomes obsolete and CLAUDE.md's "hive-mind in `-p` mode may have permission prompts" caveat can be removed.

**Net status**: ADR-0104's three deferred items reduce to one (smoke-script authoring). All three open questions answered positive. Implementation is structurally complete; merge-time work is mechanical hand-resolution of the 5 conflict-zone hunks documented in ADR-0111 §Conflict zones.
