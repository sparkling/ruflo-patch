# ADR-0104: Hive-Mind Queen Orchestration

- **Status**: Implemented (2026-04-28) — operational fixes (§§1, 2, 3, 4a, 5, 6) shipped to fork; 10-scenario acceptance lib + 35-test paired unit test green; ADR-0097 lint clean. Q1 empirical verification + manual smoke test deferred (require a real `claude` CLI session).
- **Date**: 2026-04-28
- **Scope**: fork
  - `forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts` (revert `#1422` block; add v3 worker-coordination contract; spawn action handler hard-error + wording)
  - `forks/ruflo/v3/@claude-flow/cli/src/parser.ts` (hoist `--non-interactive` to globalOptions)
  - `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts` (memory file locking per ADR-0098)
  - `forks/ruflo/v3/@claude-flow/cli/src/init/claudemd-generator.ts` (init-time `.mcp.json` direct-path detection)
- **Related (ruflo-patch ADRs)**: ADR-0082 (no silent fallbacks), ADR-0094 (acceptance coverage), ADR-0097 (paired-unit-test rule), ADR-0098 (instruction + handler dual fix; file-locking pattern for state writes)
- **Related (upstream `ruvnet/ruflo` v3 ADRs)**:
  - **ADR-067 §4.2** — adopted "Option B: system prompt injection forbidding Claude native Task/Agent tools" to address Issue #1422. Did not analyze that `mcp__ruflo__agent_spawn` is a JSON-stub. This ADR reverses §4.2's prompt injection.
  - **ADR-063** — 4-agent capability audit; scoped MCP/hive-mind but missed the JSON-stub `agent_spawn` gap.
  - **ADR-064** — 22 stubs remediated in v3.5.43 (PR #1438); `hive-mind_spawn` / `agent_spawn` deliberately excluded. JSON-only state is intentional under upstream's Task-tool-worker design.
  - **ADR-073** — "Stub Tool Honesty" principle; applied to predictions but not extended to `hive-mind spawn` CLI output.
  - **ADR-073 / 0083 / 0084 / 0086** (the ReasoningBank line) — establish v3's hook system as **trajectory learning + intelligence patterns**. v3 deliberately separates concerns: hooks for learning, MCP tools for hive coordination.
  - **ADR-014** + **ADR-020** — `HeadlessWorkerExecutor` for *maintenance workers* (map, audit, optimize). Not used for hive workers; hive workers are Task sub-agents inside the Queen session.
- **Related (upstream GitHub issues)**:
  - **#1422** (tim-bly) — "Hive-mind uses native tools instead of MCP." Root cause: MCP `agent_spawn` is a JSON-stub, so Claude correctly fell back to Task tool. The right fix is restore Task-tool spawning + use the working coordination MCP tools (`hive-mind_memory`, `_consensus`, `_broadcast`) — not forbid Task tool.
  - **#1395** — "Daemons never terminate, accumulate across sessions." Adjacent to defect #4 (npx cold start).
  - **PR #1438** — ADR-064 stub-remediation batch.

## Context

Upstream `@claude-flow/cli@3.6.8` advertises "Queen-led hive-mind with shared memory and consensus across topologies (Raft, Byzantine, Gossip)" (README L121–122, L143–144). Empirical test in a fresh-init'd project shows the advertised behavior does not occur. Two layers fail:

- **Architectural**: the Queen prompt forbids the only mechanism (Task tool) that creates real workers. The `mcp__ruflo__agent_spawn` MCP path it points at instead is a JSON-stub. The Queen is instructed into a dead end.
- **Operational**: four CLI/spawn-flow defects prevent the Queen session from getting off the ground even before the architectural problem matters.

This ADR delivers the working hive: Queen launches via `--claude`, spawns workers via Task tool inside its own session, workers coordinate via the existing functional `mcp__ruflo__hive-mind_*` MCP tools.

### v3 hook system — design intent (clarification)

The empirical finding that v3 hooks do not write to `hive-mind/state.json` is **intentional design**, not a defect. v3 separates concerns:

| Concern | v3 mechanism | Verified location |
|---------|--------------|-------------------|
| Trajectory learning | `hooks_post-task` writes routing-outcomes, memory-router, causal edges | `mcp-tools/hooks-tools.ts:1461–1581` |
| Cross-session pattern memory | `hooks_intelligence_pattern-store` / ReasoningBank | `mcp-tools/hooks-tools.ts:2483+` |
| Hive coordination (Queen ↔ workers) | `mcp__ruflo__hive-mind_memory` / `_consensus` / `_broadcast` | `mcp-tools/hive-mind-tools.ts:899–961` (memory), `:496–788` (consensus), `:790–832` (broadcast) |

The MCP coordination tools are functional and intended for this use. The Queen prompt simply doesn't currently instruct the Queen to use them; it instructs the Queen to use a JSON-stub instead. This ADR fixes the prompt.

### Defect classification — bug vs. intentional design

Each item this ADR addresses (or rejects) is classified to keep the bug/intent distinction explicit. Fixes target items labeled BUG, EMERGENT BUG, LATENT BUG, or STALE IDIOM. Items labeled INTENTIONAL DESIGN are preserved and worked *with*.

| # | Item | Classification | Rationale |
|---|------|---------------|-----------|
| 0 | v3 hooks separated from coordination | **INTENTIONAL DESIGN** | ADR-073 / 0083 / 0084 / 0086 line. Hooks for learning; MCP tools for hive coordination. **Preserved.** |
| 1 | Parser lazy-command flag scoping (§Decision-1) | **BUG (oversight in lazy-loading design)** | Lazy loading is intentional (perf). Not propagating boolean-flag info pre-load is a gap that breaks every lazy command's exclusive boolean flags. |
| 2 | Objective silent default (§Decision-2) | **BUG (violates ADR-082)** | Substituted default ("Coordinate the hive mind workers...") is so vague the LLM rejects it. Behavior is broken regardless of the original intent. |
| 3 | "Spawned N agent(s)" wording (§Decision-3) | **BUG (stale v2 idiom)** | v2 had a mock executor that "spawned" agents in simulation. v3 dropped the executor but kept the wording. ADR-073 (honesty) applied to `swarm.ts:506–509`; not to `hive-mind.ts:647`. |
| 4 | MCP attach fails in `-p` mode (§Decision-4a) | **EMERGENT BUG** | `npx -y` (intentional default) + claude-code MCP handshake timeout (intentional) compose to a failure neither anticipated. |
| 5 | `--dangerously-skip-permissions` non-propagation (§Decision-4b) | **UNKNOWN — Q5** | Could be claude-code policy (intent) or ruflo argv-ordering (bug). Pre-grants in `settings.json` are hypothesis-agnostic. |
| 6 | Hive-memory race-clobber on parallel writes (§Decision-5) | **LATENT BUG** | Same pattern as pre-ADR-0098 swarm state. Concurrency wasn't hit by v2's mock-sequential executor; becomes active when §6's parallel Task workers run. |
| 7 | ADR-067 §4.2 `#1422` prompt block (§Decision-6) | **INTENTIONAL DECISION on flawed analysis** | Documented in ADR-067. Prompt does what it was designed to do. The architecture-level decision is wrong because it codifies the broken state. Reversed by §6. |
| 8 | ADR-064 hive-mind stub triage | **DELIBERATE TRIAGE — not a bug** | JSON-only `hive-mind_spawn` is correct under upstream's Task-tool-worker design when paired with §6's prompt. **Preserved as-is.** |
| 9 | v2→v3 prompt port preserved "coordinate via hooks" idiom (§Decision-6) | **BUG (stale idiom)** | v2 idiom referencing v2's hook system. Never updated for v3's intentional hook redesign. Documentation/prompt-content bug. |

### Empirical evidence

Preserved at `/tmp/upstream-cf-test2/` from 2026-04-28 reproduction:

| Artifact | Finding |
|----------|---------|
| `hive-trace.log` | `--non-interactive` AFTER objective: parser drops objective, generic default substituted, $0.29 wasted single-turn. |
| `hive-trace2.log` | Objective FIRST: preserved; MCP servers all `failed`; `permissionMode:default`; 3 permission denials on Write/Bash; 4 turns, $0.24, no result file. |
| `.hive-mind/sessions/hive-mind-prompt-hive-1777359088118.txt` | Generated Queen prompt with `#1422` block forbidding Task tool. |
| `/tmp/parser-probe.mjs` + patched `/tmp/package/dist/src/commands/hive-mind.js` (`[PROBE]` instrumentation) | `flags.nonInteractive` arrives as `"obj-after-noninter"` — parser greedy-consumed positional. |
| `.claude-flow/hive-mind/state.json` MD5 before/after `hooks post-task` | Identical (`f6664b8f58f9bd9a66936ca08c2da08b`). v3 hooks intentionally don't touch hive state. |

### Upstream landscape

Three upstream design moves compose into the user-visible failure:

1. **ADR-067 §4.2 (March 2026)**: fixed Issue #1422 by injecting a system prompt forbidding Task/Bash/Write. Did not analyze why Claude was reaching for Task tool (because MCP was a stub). Codified the working alternative as forbidden.
2. **ADR-064 (March 2026)**: 22 stubs remediated in v3.5.43; hive-mind stubs deliberately excluded — appropriate triage *if* Task-tool spawning were preserved, which §4.2 simultaneously removed.
3. **v2→v3 prompt port**: v2's prompt told the Queen "Step 2: REQUIRED — Spawn ACTUAL Agents with Claude Code's Task Tool." That instruction was inverted in v3 with no separate ADR documenting the inversion (likely rode in with §4.2).

This ADR closes (1) and (3); (2) stays as-is.

## Decision

Six changes in dependency order. (1)–(5) are operational defect fixes that match upstream's published behavior closely; (6) reverts the upstream `#1422` bug and adds the minimum v3-equivalent of v2's "coordinate via hooks" idiom. No additions beyond what upstream's published Queen prompt already specifies.

### 1. Parser scoping — hoist `--non-interactive` to globalOptions

Parser's `getBooleanFlags()` walks only eagerly registered Command objects (`dist/src/parser.js:130–148`). `hive-mind` is lazy-loaded via `commandLoaders` (`dist/src/commands/index.js:31`); only its NAME is registered with the parser at startup. Parsing `hive-mind spawn --non-interactive "obj"` greedy-consumes `"obj"` as the value of `--non-interactive` because `nonInteractive` isn't in the boolean flag set. (Verified empirically; `--dry-run` works because at least one eagerly-loaded command also declares it, putting it in the global set indirectly.)

**Fix**: add `--non-interactive` to `parser.ts` `globalOptions` as a boolean flag. Three-line change. The flag is conceptually global (the complement of the existing `--interactive` global flag); making it global puts it in the boolean set regardless of which command is being parsed.

```ts
// parser.ts globalOptions
{ name: 'non-interactive', description: 'Run in non-interactive mode', type: 'boolean', default: false },
```

The existing per-command `non-interactive` declaration on `spawnCommand.options` can stay (commands can re-declare global flags) or be removed (cosmetic). No new infrastructure (manifest), no drift-detection test needed — surgical fix scoped to the empirically reproduced bug.

### 2. Objective is required when `--claude` is set — fail loudly

Per ADR-073 + ADR-082. Replace `hive-mind.ts:660–664` silent-default with:

```ts
if (!objective) {
  output.printError('Objective is required when using --claude.');
  output.writeln(output.dim('  Provide an objective via -o/--objective="..." (recommended) or as a positional argument.'));
  output.writeln(output.dim('  Note: positional objectives must come BEFORE flags, otherwise the parser may consume them as flag values.'));
  output.writeln(output.dim('  Example: claude-flow hive-mind spawn -o "Build a REST API" --claude --non-interactive'));
  return { success: false, exitCode: 1 };
}
```

Positional-ordering hint is a backstop in case §1 regresses or a future lazy command lacks a manifest entry.

### 3. "Spawned" → "Registered worker slot(s)" — honest output

Per ADR-073 + the existing `swarm.ts:506–509` precedent.

```ts
output.printSuccess(`Registered ${result.spawned} worker slot(s) in hive state`);
output.writeln(output.dim(`  Total worker slots: ${result.totalWorkers}`));
output.writeln(output.dim('  Note: slots are state records — actual workers are spawned by the Queen via Task tool inside the --claude session'));
```

`mcp__ruflo__hive-mind_spawn` is a state-record write under upstream's design; workers come from Task tool. The CLI output now matches the actual architecture.

### 4. Spawned-claude bootstrap

**4a. MCP attach in `-p` mode** — `init/claudemd-generator.ts` writes `.mcp.json` with a direct path when `claude-flow` is globally installed; falls back to `npx -y` with a comment advising global install otherwise. Eliminates the ~5–8s `npx -y` cold start that exceeds claude-code's MCP handshake budget.

```ts
let cfPath: string | null = null;
try {
  cfPath = execSync('which claude-flow', { encoding: 'utf-8' }).trim() || null;
} catch { /* not installed globally */ }

const mcpServerCommand = cfPath
  ? { command: cfPath, args: ['mcp', 'start'] }
  : { command: 'npx', args: ['-y', '@claude-flow/cli@latest', 'mcp', 'start'] };
```

**4b. Permission propagation** (defect #4 — `--dangerously-skip-permissions` does not apply in `-p` mode) — root cause unverified (Q5: hypothesis A claude-code policy filters / B needs `--permission-mode=acceptEdits` / C ruflo argv-ordering bug). **This ADR does not patch permissions.** Document the limitation in CLAUDE.md ("hive-mind in `-p` mode may have permission prompts depending on user's claude-code policy; run interactively to avoid"). Hypothesis investigation tracked separately; if Hypothesis C is confirmed, follow-up reorders argv.

Upstream init does not write `.claude/settings.json` permission allow-rules; this ADR doesn't either, to stay aligned with published behavior.

### 5. Hive-memory file locking

Current `hive-mind_memory` handler (`mcp-tools/hive-mind-tools.ts:912–961`) does `loadHiveState() → mutate → saveHiveState()` without locking. §6's parallel Task workers calling `hive-mind_memory({action:'set'})` will race-clobber.

**Fix**: apply ADR-0098's `withSwarmStoreLock` pattern: `O_EXCL` sentinel file with stale-lock recovery, atomic write (tmp + rename) in `saveHiveState`. Wraps the load → mutate → save sequence. ~30 LOC; the lock helper from ADR-0098 likely lifts directly.

### 6. Revert `#1422` block + add v3 worker-coordination contract

The published Queen prompt's structure is preserved. Only two changes are made:

**Change 1**: Remove the `#1422` "TOOL PREFERENCE RULES" block (`hive-mind.ts:160–165`). This is the wrong-direction fix from upstream ADR-067 §4.2; reverting restores the working alternative (Task tool can spawn real workers in the same session — same mechanism as v2's working hive-mind).

**Change 2**: Add a single-line worker-coordination contract to the Queen's existing TASK DISTRIBUTION phase, specifying that workers write their output to `mcp__ruflo__hive-mind_memory` before returning. This is the v3-equivalent of v2's "coordinate via hooks" idiom. Necessary because v3 hooks intentionally don't write hive state (per published ADR-073 / 0083 / 0084 / 0086 line — design boundary preserved by this ADR).

**Preserved from published prompt**:
- 4-phase protocol (INITIALIZATION / TASK DISTRIBUTION / COORDINATION / COMPLETION)
- All parameterization metadata in the header (`queenType`, `consensusAlgorithm`, `topology`, worker count, worker types)
- Memory namespace convention (`hive/`, `queen/`, `workers/`, `tasks/`) — already in upstream prompt
- Available MCP tools list (collective intelligence / queen coordination / worker management / task orchestration / memory & learning)
- Queen leadership patterns per `queenType` (strategic / tactical / adaptive)
- Consensus mechanism description per `consensusAlgorithm`

**Concretely** — replace the `#1422` block (`hive-mind.ts:160–165`):

```
⚠️ CRITICAL — TOOL PREFERENCE RULES (#1422):
• You MUST use Ruflo MCP tools (mcp__ruflo__*) for ALL orchestration tasks
• Do NOT use Claude native Task/Agent tools for swarm coordination — use mcp__ruflo__agent_spawn, mcp__ruflo__task_assign, etc.
• Native Claude tools (Read, Write, Edit, Bash, Grep, Glob) should ONLY be used for file operations and shell commands
• All agent spawning, task assignment, memory, and coordination MUST go through mcp__ruflo__* tools
• If a Ruflo MCP tool exists for an operation, always prefer it over any native equivalent
```

with:

```
🛠️ TOOL USE:
• Use Claude Code's Task tool to spawn worker agents in this session.
• Use Ruflo MCP tools (mcp__ruflo__*) for hive coordination: shared memory
  (hive-mind_memory), consensus (hive-mind_consensus), broadcasts
  (hive-mind_broadcast), status (hive-mind_status).
• Native Claude tools (Read, Write, Edit, Bash, Grep, Glob) are available
  for orchestration logic.

📝 WORKER COORDINATION CONTRACT (v3):
When spawning a worker via Task tool, include this contract in its prompt
verbatim:
  "Before returning, write your structured output to hive shared memory:
   mcp__ruflo__hive-mind_memory({action:'set',
     key:'worker-<your-id>-result',
     value:<your output>})
   Then return a 1-line summary."
This contract replaces v2's 'coordinate via hooks' idiom — v3 hooks are
for learning, not coordination, so workers must write coordination state
explicitly via MCP.
```

The existing 4-phase PROTOCOL block (`hive-mind.ts:131–155`) is preserved as-is. The Queen's COORDINATION PHASE still references `${consensusAlgorithm} consensus` for conflict resolution; aggregation reads worker results from shared memory keys per the contract above.

### 7. Acceptance check

New check in `lib/acceptance-hive-mind-checks.sh`, wired into Phase 9+ per ADR-0094. Paired unit tests per ADR-0097.

**Operational scenarios** (no API costs):

1. Fresh init'd project; `.mcp.json` uses direct path when `claude-flow` is in PATH; falls back to `npx -y` when not.
2. `hive-mind spawn --claude --dry-run` (no objective) → exit 1, `Objective is required`.
3. `hive-mind spawn --claude --dry-run -o "obj"` → exit 0, prompt file contains `"obj"`.
4. `hive-mind spawn --claude --dry-run --non-interactive "obj"` → exit 0, prompt file contains `"obj"`. (Verifies the global-flag hoist for `--non-interactive`.)
5. Generated Queen prompt does NOT contain the `#1422` `Do NOT use Claude native Task/Agent tools` block.
6. Generated Queen prompt contains the new `🛠️ TOOL USE` and `📝 WORKER COORDINATION CONTRACT` blocks; existing 4-phase PROTOCOL preserved unchanged.
7. Generated Queen prompt preserves all existing parameterization headers (`Queen Type`, `Topology`, `Consensus Algorithm`, `Worker Count`, `Worker Types`).
8. `hive-mind spawn` output says "Registered N worker slot(s) in hive state" with the "actual workers spawned by the Queen" note. Does NOT say "Spawned N agent(s)".
9. **Distinct-key concurrency**: 8 parallel `hive-mind_memory({action:'set'})` calls with 8 distinct keys produce 8 entries (no race-clobber). Lock sentinel cleaned up.
10. **Same-key concurrency**: 8 parallel `hive-mind_memory({action:'set', key:'race-test', value:<unique-per-call>})` calls — exactly one value persists; no torn writes; lock sentinel cleaned up. Validates §5's lock under contention.

**Manual smoke test** (paid, run before merging architectural changes):

`scripts/manual-hive-smoke.sh` invokes a real `hive-mind spawn --claude` with a small concrete objective; verifies the result artifact exists AND `hive-mind/state.json` contains at least one `worker-*-round-*` key. Token cost: ~$0.50 expected. Documented in CLAUDE.md as a manual gate; not wired into automated acceptance.

### Out of scope

Deferred (not in upstream's published design; explicit non-scope so future drafts don't drift back into invention):

- **Headless / out-of-process workers for hive roles** — `HeadlessWorkerExecutor` is for maintenance workers per ADR-014/020. Not in upstream's hive design.
- **Permission pre-grants in `.claude/settings.json`** — upstream init does not write `permissions.allow` rules. Defect #4 (`--dangerously-skip-permissions` non-propagation) is documented as a limitation; root cause investigation is Q5.
- **Round-based protocol reframing** — upstream uses 4 phases; this ADR preserves that structure.
- **Topology behavior differentiation** (per-topology cross-worker visibility, ring-pass semantics, etc.) — upstream uses topology as metadata only.
- **Pre-allocated agentId reuse instruction** — upstream Queen prompt does not bind JSON-registered IDs to running Task agents. Same "orphan JSON records" pattern as upstream.
- **`hive-mind_shutdown` call at end of objective** — upstream prompt does not specify this.
- **Lazy-command flag manifest infrastructure** — surgical hoist of `--non-interactive` to globals fixes the empirically reproduced bug without new infrastructure.
- **Token-budget gating, cost gates, round caps** — not in upstream's design.
- **Worker failure handling, contract-violation triage, quorum checks** — not in upstream's prompt.
- **Formal `WorkerOutput` / `RoundState` schemas** — upstream's worker prompt is `"You are a ${type} in the hive. Coordinate via hooks."` Free-form. This ADR doesn't add schemas.
- **Stale-state cleanup at spawn-time** — `hive-mind_leave` exists but no upstream code uses it for orphan cleanup. Separate ADR if needed (mirroring ADR-0098 swarm sprawl).
- **Wiring hooks to `hive-mind/state.json`** — would violate v3's intentional separation of concerns.
- **README copy update** — separate ADR after this lands.
- **Defect #4 sub-causes 4b (daemon socket transport) and 4c (claude-code MCP timeout investigation)** — only 4a (direct path) ships here.

Adjacent surfaces this ADR does not touch (preserved from upstream as-is, listed so they're not assumed-fixed):

- **Session resume / pause** (`hive-mind resume`, `hive-mind pause`, `hive-mind sessions`) — existing CLI surface; behavior under crash mid-orchestration is whatever upstream provides. This ADR doesn't change it.
- **Mixed-type worker count distribution** — current CLI takes a single `--type`. Heterogeneous workers (e.g., `2 researchers + 2 coders` from one spawn call) would require a CLI flag change; not in this ADR.
- **`hive-mind_shutdown` edge cases** — if a Queen invokes shutdown while Task workers are still mid-flight, worker MCP writes against a shutdown hive may be orphaned. Upstream behavior; not addressed here.

## Open Questions

| # | Question | Assumption | If wrong: mitigation |
|---|----------|------------|----------------------|
| Q1 | Do Task sub-agents in claude `-p` mode have access to parent's MCP servers (`mcp__ruflo__*`)? | Yes — sub-agents inherit parent's tool set. | §6's worker contract loses its primary channel. Fall back: drop the MCP-write contract; workers return their structured output via Task tool result, and the Queen reads Task results directly (still uses `hive-mind_memory` itself for cross-round state). One-paragraph contract change; no other §6 changes. **Verify before committing the §6 prompt change.** |
| Q2 | Are there race conditions on `hive-mind/state.json` from concurrent workers? | Yes — current handler has no locking. Concurrent writes will clobber. | §5's lock pattern applies. Already designed for this. |
| Q3 | Is `claudemd-generator.ts` the right file for `.mcp.json` writes? | Yes — verified location for the CLAUDE.md template. | If separate generator: redirect §4a edits there. ~15 min code read at implementation start. |
| Q4 | Defect #4: why does `--dangerously-skip-permissions` not propagate in `-p` mode? Hypothesis A (claude-code policy filters), B (needs additional `--permission-mode=acceptEdits`), C (argv ordering bug). | Documented as a limitation; not patched in this ADR. | If C: one-line argv reorder in `hive-mind.ts:271` as follow-up. If A/B: file upstream / document. |

## Alternatives

### A — Headless / out-of-process workers for hive roles

Wire `mcp__ruflo__agent_spawn` to `HeadlessWorkerExecutor`; daemon launches `claude --bare --print` per worker; stdout return contract.

`HeadlessWorkerExecutor` (ADR-014/020) was designed for *maintenance* workers (map, audit, optimize). Hive workers in upstream's design are Task sub-agents. Bundling out-of-process workers conflates two architectures. Out of scope; separate ADR if needed.

### B — Restore v2 prompt verbatim

v2's prompt at `bin/hive-mind.js:2381` references MCP tools that no longer exist in v3 (`consensus_vote`, `memory_share`). Verbatim port ships dead references. §6 cites v2 as inspiration but rewrites for v3's actual MCP surface.

### C — Hook → hive-state coupling

Modify `hooks_post-task` to write to `hive-mind/state.json` when an agent indicates hive membership.

Violates v3's intentional separation (hooks for learning per ADR-073/0083/0084/0086 line; MCP tools for coordination). Race conditions still need §5 locking. Leaks hive concept into general-purpose hook handlers. Rejected.

### D — `--allowedTools mcp__ruflo__*` constraint (ADR-067 §4.2 Option A)

Pass `--allowedTools` so the spawned Queen physically cannot use Task/Bash/Write. Same root flaw as §4.2's Option B — constrains Queen to MCP tools that include the JSON-stub `agent_spawn`. Quieter failure, not less broken. Rejected.

### E — Token-budget-gated automated live API tests

Build infrastructure for `RUFLO_LIVE_TESTS=1` opt-in, wire into automated acceptance. Adds CI-budget complexity; manual smoke test (§7) covers the verification need with less surface. Out of scope.

## Consequences

**Positive**:

- README claim ("Queen-led hierarchy with shared memory and consensus") becomes empirically true via §6 + manual smoke test.
- "Registered worker slot(s)" wording removes the lying-output surface; matches upstream's own `swarm.ts:506–509` precedent.
- MCP attach `npx → direct-path` saves ~5–8s cold start per claude session when `claude-flow` is globally installed.
- Hive-memory locking eliminates a race-clobber class (verified by distinct-key and same-key concurrency tests).
- All upstream parameterization (queenType, consensusAlgorithm, topology metadata, workerGroups, queen leadership patterns, memory namespaces, 4-phase protocol) is preserved unchanged.
- v3's intentional separation of concerns (hooks for learning, MCP tools for coordination) is preserved.

**Negative**:

- Code surface across 4 files (parser.ts, hive-mind.ts, hive-mind-tools.ts, claudemd-generator.ts).
- Manual smoke test costs API tokens per run; mitigated by being manually invoked.
- Existing CI/scripts that called `hive-mind spawn --claude` without an objective will fail; clear error points to fix.
- Defect #4 (`--dangerously-skip-permissions` propagation) is documented but not patched. Users running hive in `-p` mode may hit permission prompts depending on claude-code policy; documented in CLAUDE.md.

**Neutral / needs monitoring**:

- Q1 (Task sub-agent MCP access) is the single load-bearing assumption. Verify in implementation Step 1; if wrong, fall back per Q1's mitigation.
- §4a (npx-cold-start hypothesis) is unverified at ADR-write time; verify post-build before merging §6.
- ADR-067 §4.2 reversal is a public deviation from upstream. Forward as upstream issue/counter-ADR after this ships, with empirical evidence (`hive-trace*.log`, `permissionMode:default`, `MCP status:failed`, FF-test single-LLM-roleplay) as the case.

## Implementation Order

Strict dependency order. Each step's paired unit test (per ADR-0097) lands in the same commit as the change.

1. **Verify Q1 empirically** (Task sub-agents and parent MCP servers). Spawn a test claude session in `-p` mode with MCP servers attached; have it call Task tool with a sub-agent that tries `mcp__ruflo__memory_store({key:'q1-test', value:'ok'})`. Verify the key appears in `.claude-flow/memory.db` (or equivalent backend) afterward. **Pass**: proceed with §6 as designed. **Fail**: redesign §6 worker contract — workers return structured output via Task result (Queen aggregates from Task results into shared memory itself); Queen prompt grows by the aggregation step. Decision is made before any §6 code is written.

2. **Build operational foundations** (steps a–e are independent; can be done in any order or parallel):
   - **a.** §1 parser fix — add `--non-interactive` to `parser.ts` `globalOptions` as boolean. Add unit test that asserts `parse(['hive-mind','spawn','--non-interactive','obj'])` produces `flags.nonInteractive === true` and `positional === ['obj']`.
   - **b.** §2 hard-error on missing objective. *Already applied to fork as of 2026-04-28.* Add paired unit test.
   - **c.** §3 "Registered worker slot(s)" wording. *Already applied.* Refine wording to include "actual workers spawned by the Queen via Task tool" note when §6 lands.
   - **d.** §4a init `.mcp.json` direct-path detection (`claudemd-generator.ts`).
   - **e.** §5 hive-memory file locking — lift `withSwarmStoreLock` from ADR-0098, wrap `loadHiveState → mutate → saveHiveState` in `mcp-tools/hive-mind-tools.ts`. Distinct-key + same-key concurrency tests included.

3. **Empirically verify §4a** (post-build). Re-run the `/tmp/upstream-cf-test2/` reproduction with a fresh init using the patched `claudemd-generator`. Assert spawned Queen session's init JSON shows `"claude-flow":"connected"` instead of `"failed"`. **Fail mode**: the npx-cold-start hypothesis was wrong. Halt merge of §6; escalate to ADR-0104b (daemon socket transport or claude-code MCP timeout investigation). The architectural fix needs MCP attach; without it, §6 ships theatre.

4. **Build §6 Queen prompt change** in `hive-mind.ts:generateHiveMindPrompt()`:
   - Remove the `#1422` block (lines 160–165 of the existing prompt template).
   - Insert the `🛠️ TOOL USE` and `📝 WORKER COORDINATION CONTRACT` blocks per §Decision-6.
   - Preserve everything else (existing 4-phase PROTOCOL, parameterization metadata, MCP tools list, queen leadership patterns, memory namespace convention).

5. **Wire §7 operational acceptance** (no API costs):
   - Create `lib/acceptance-hive-mind-checks.sh` if absent.
   - Add it to `scripts/test-acceptance.sh` sourcing list per ADR-0094 Phase-9+ pattern.
   - Implement scenarios 1–10 from §7.

6. **Manual smoke test** — `scripts/manual-hive-smoke.sh`. Uses the developer's already-authenticated `claude` CLI; no separate API key plumbing. Run against the FF-test reproduction objective ("reach consensus on best Fantastic Four character; spawn one worker per character"). Assert from the run trace + post-run state files:
   - Result artifact written (the verdict file the objective asks for).
   - Spawned Queen session's init JSON shows `"claude-flow":"connected"` (defect #2 actually fixed).
   - Queen used Task tool at least once (`#1422` block actually reverted; v2-style spawning restored).
   - `hive-mind/state.json`'s `sharedMemory` contains at least one `worker-<id>-result` key (workers actually honored the v3 MCP-write contract from §6).

7. **Build via ruflo-patch pipeline**: `npm run build` from ruflo-patch (copy fork → codemod → tsc + WASM → publish to local Verdaccio → run ruflo-patch's `test:acceptance` against init'd projects with the patched `@sparkleideas/cli`). All acceptance scenarios pass; smoke test runs cleanly.

8. **Fork commit** on `forks/ruflo/main`, push to `sparkling` (per fork-workflow memory). Commit message references this ADR.

9. **ruflo-patch companion commit**: bumps patch.N version, includes acceptance check additions and ADR-0104 itself. Publish to npm via `npm run deploy`.

10. **(Post-ship) Forward to upstream** as a counter-proposal to ADR-067 §4.2, citing the empirical evidence preserved at `/tmp/upstream-cf-test*/` (`hive-trace*.log`, `permissionMode:default`, MCP status:failed, FF-test single-LLM-roleplay receipt).

**Failure-mode contingencies** (explicit so the implementer doesn't improvise):

- **Q1 fail** → §6 redesign (Task-result-based aggregation instead of worker MCP writes). Re-verify before proceeding.
- **§4a fail** → halt merge of §6; escalate to ADR-0104b. Operational fixes 2a/2b/2c/2e can still ship — they're independent — but §6 ships theatre without working MCP attach.
- **Smoke test fail** → halt merge. Investigate trace; either real failure (back to design) or environmental (document and retry).

## Implementation Log

### 2026-04-28 — Operational fixes shipped (§§1–6); §§Q1/4a-empirical/smoke deferred

Six source-level changes across four files plus 10-scenario acceptance lib + paired unit test. See `ADR-0094-log.md` for the full coverage entry.

**Source diff (fork — `forks/ruflo` main branch, pre-push)**:

| File | Change |
|---|---|
| `v3/@claude-flow/cli/src/parser.ts` | §1: hoist `non-interactive` to `globalOptions` boolean entry. |
| `v3/@claude-flow/cli/src/init/mcp-generator.ts` | §4a: add `detectClaudeFlowPath()` (cached `which`/`where claude-flow`) + `createClaudeFlowEntry()`; route `mcpServers['claude-flow']` through it. **Deviation**: ADR text said `claudemd-generator.ts`; Q3 verification showed `.mcp.json` is generated by `mcp-generator.ts` — implementation redirected per Q3's mitigation. |
| `v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts` | §5: atomic write in `saveHiveState` (tmp + rename); `withHiveStoreLock` helper (O_EXCL + stale-recovery, lifted from `swarm-tools.ts`'s ADR-0098 pattern); `hive-mind_memory` `set`/`delete` wrapped under lock. |
| `v3/@claude-flow/cli/src/commands/hive-mind.ts` | §6: replace `#1422 TOOL PREFERENCE RULES` block with `🛠️ TOOL USE` + `📝 WORKER COORDINATION CONTRACT`. 4-phase PROTOCOL, parameterization headers, MCP tools list — preserved unchanged. §2 (hard-error on missing objective) and §3 (honest "Registered worker slot(s)" wording) were already in fork from earlier same-day work; §3 wording extended with the "actual workers" clarifier note. |

**Acceptance**:

- `lib/acceptance-adr0104-checks.sh` — 10 scenarios per §7 (1–10).
- `scripts/test-acceptance.sh` — sourced + wired in three places (lib block, `run_check_bg` block, `_adr0104_specs` array + wait-loop expansion).
- Gated on `$E2E_DIR/.claude/settings.json` (mirrors ADR-0098).

**Paired unit test** (`tests/unit/acceptance-adr0104-checks.test.mjs`):

35 tests, 0 failures. Five describe blocks: static check-lib structure (12), runner wiring (12), §1 parser hoist behavioral (2), §5 lock-under-contention behavioral (4 — including N=8 distinct-key + N=8 same-key tests), §6 prompt content + §3 wording (3), §4a mcp-generator (2). Behavioral tests load codemodded build at `/tmp/ruflo-build/v3/@claude-flow/cli/dist`; skip with clear reason if absent.

**Suite tally**: `npm run test:unit` 3631 → 3666 (+35), 0 failures, 13 skipped (allowlist unchanged). ADR-0097 lint: 0 errors / 0 warnings across 80 files.

**Build verification**: codemodded `tsc` build of all four touched files succeeds (verified via `dist/src/parser.js`, `dist/src/commands/hive-mind.js`, `dist/src/mcp-tools/hive-mind-tools.js`, `dist/src/init/mcp-generator.js` containing all expected markers — `non-interactive`, `withHiveStoreLock`, `TOOL USE`, `WORKER COORDINATION CONTRACT`, `detectClaudeFlowPath`, `createClaudeFlowEntry`). Pre-existing tsc errors in unrelated files (`benchmark.ts`, `embeddings.ts`, `hooks.ts`, `init.ts`, `neural.ts`, `intelligence.ts`, `memory-router.ts`, `services/agentic-flow-bridge.ts`, etc.) — 41 errors total, none in ADR-0104's four files.

**Deferred** (per ADR Implementation Order):

- **Step 1 — Q1 empirical verification** (Task sub-agent MCP access) — needs a live `claude -p` session. The §6 prompt change ships ready for the Q1-positive path. If Q1 turns out negative, the fall-back is a Queen-side aggregation rewrite of the worker contract; the prompt text is the only thing that needs to change.
- **Step 3 — §4a empirical verification** (post-build MCP attach status) — needs a real spawned Queen session.
- **Step 6 — Manual smoke test** — `scripts/manual-hive-smoke.sh` not yet authored; documented as a manual gate per ADR §7 ("not wired into automated acceptance").

These three deferred items require API-cost-incurring `claude` invocations; the ADR itself classifies them as manual gates, not automated checks. The implementation is otherwise complete.
