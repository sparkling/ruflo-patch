---
status: proposed
date: 2026-05-19
tags: [audit, soundness, completeness, hooks, controllers, mcp, daemon, skills, runtime-validation]
supersedes: []
depends-on: []
implements: []
---

# Codebase soundness and completeness audit with runtime validation

## Context and Problem Statement

ruflo-patch builds upstream `ruvnet/*` HEAD and republishes as `@sparkleideas/*`. Surface area spans 5 forks (ruflo, agentdb, agentic-flow, ruv-FANN, ruvector), 200+ MCP tools, ~30 controllers across memory/learning/graph/federation, multi-stage hook lifecycle (pre/post task/edit/command + intelligence + routing + workers), a daemon (start/stop/status/restart + IPC), a skill library, and an `init` command that generates `.mcp.json` and registers a plugin/MCP server.

A prior dispatch in this session was killed mid-recon. Intermediate findings that leaked through kill notifications — to be verified by the new sweep:

* HookExecutor architecture appears dead: CLI bypasses it via `callMCPTool` → in-process `hooks-tools.ts`.
* `hooks/src/index.ts:233` calls `require('./registry/index.js')` under `"type": "module"` ESM — throws at `addHook` call time.
* Diverged plugin hook configs: `plugin/hooks/hooks.json` wires Stop → prompt-eval; `.claude-plugin/hooks/hooks.json` wires Stop → `hooks session-end`.
* `notify` hook passes `--swarm-status`, but `notifyCommand` does not declare that flag — silently dropped.
* `graphAdapter` init catch swallowed by `console.warn` → silent fallback to `graphEnabled=false` → SQLite. Violates [[feedback-no-fallbacks]] and ADR-0082.
* `DaemonIPCServer` instantiated; zero IPC handlers registered.

That signal indicates the audit will find substantive issues. The new sweep must cover (a) the 6 explicit surfaces named by the user, (b) gaps not named, and (c) **runtime validation against a real init'd test project — code in action, not code in the abstract**.

The previous dispatch's failure mode was skipping the planning step. This ADR is that step.

## Decision Drivers

* Coverage breadth — 6 explicit surfaces + identified gaps; nothing dropped.
* Non-overlap — 15 parallel agent slices must not race or duplicate work.
* Read-only safety for static audits — agents do not modify source.
* Runtime isolation — runtime agents work inside `/tmp/ruflo-audit-*/` sandboxes only.
* Installed-not-dev semantics — runtime agents install `@sparkleideas/*` from Verdaccio per [[feedback-inspect-installed-not-dev-nodemodules]]; never read `./node_modules/@sparkleideas/*`.
* Loud-not-silent — per [[feedback-no-fallbacks]], audit and validation harnesses must surface failures, never swallow.
* Trace before hypothesis — per [[feedback-trace-before-hypothesis]], each agent reads at least one full handler / controller before generalising.
* Cleanup contract — runtime agents `trap` cleanup; no orphan daemons / temp dirs / sockets.
* No time anchoring — per [[feedback-no-time-estimates]].

## Considered Options

* **Option A — Pure static audit (15 read-only agents)** — Surface inventory + reference-soundness only. No runtime.
* **Option B — Pure runtime validation (15 testing agents)** — Each agent exercises a surface live. No static roll-up.
* **Option C — Sequenced hybrid: static first, runtime after** — Runtime agents start after static completes.
* **Option D — Parallel hybrid: 12 static + 3 runtime + 1 synthesis pass** — All run in parallel; runtime agents own their own `/tmp` sandboxes so no shared-state race.

## Decision Outcome

**Chosen: Option D — parallel hybrid with 12 static + 3 runtime agents, followed by a synthesis pass that produces a 16th cross-cutting findings + gap document.**

Rationale:

* Option A misses the user's explicit "validate in action" directive.
* Option B cannot sample 200+ MCP tools meaningfully — static roll-ups win for stub clusters across categories.
* Option C wastes wall time: runtime agents idle while static completes, despite scopes not conflicting.
* Option D preserves parallelism. Runtime agents each create their own `/tmp/ruflo-audit-<agent>-<pid>/` sandbox; no cross-agent race on shared state.

### Agent assignments

Static audit (12):

| # | Output file | Slice |
|---|-------------|-------|
| 1 | `01-hooks-pre-lifecycle.md` | pre-task, pre-edit, pre-command, pretrain, session-start, session-restore |
| 2 | `02-hooks-post-lifecycle.md` | post-task, post-edit, post-command, session-end, notify, transfer |
| 3 | `03-hooks-intelligence-routing.md` | intelligence_*, model-route, route, worker-*, hooks_explain, init, list, build-agents |
| 4 | `04-controllers-memory.md` | HierarchicalMemory, MemoryConsolidation, RVF, Reflexion, ReasoningBank, Attention, ContextSynthesizer, CausalRecall, StreamingEmbedding |
| 5 | `05-controllers-learning.md` | LearningSystem, NightlyLearner, SONA, MicroLoRA, EWC++, SARSA, LearningBridge |
| 6 | `06-controllers-graph-federation.md` | CausalMemoryGraph, SyncCoordinator (per ADR-0200), graphAdapter, federatedSession, federatedLearningManager, QUIC*, CRDT, Mincut, Sparsification |
| 7 | `07-skills.md` | All skills: project, fork, plugins; SKILL.md soundness; script references |
| 8 | `08-mcp-tool-implementations.md` | Handler quality + stub roll-up across ~30 categories |
| 9 | `09-mcp-server-wiring.md` | Startup, transport, tool registry, dual `ruflo` / `claude-flow` namespace (per ADR-0117) |
| 10 | `10-daemon.md` | `ruflo daemon` command, IPC, lifecycle, status, restart |
| 11 | `11-init-mcp-installation.md` | `ruflo init` outputs: `.mcp.json` generation, plugin install, env-var contract |
| 12 | `14-config-soundness.md` | Config keys, defaults, init-template emission, dead-key verification (per [[project-config-gaps]]) |

Runtime validation (3) — each owns a private `/tmp/ruflo-audit-*` sandbox:

| # | Output file | Slice |
|---|-------------|-------|
| 13 | `12-runtime-init-and-mcp-server.md` | Create sandbox; `ruflo init` non-interactive; assert generated `.mcp.json` matches canonical shape; boot MCP server via stdio; count exposed tools; sample a real tool call (e.g. `agentdb_health`); capture stdout/stderr/exit |
| 14 | `13-runtime-hooks-and-daemon.md` | Sandbox; `daemon start`; `daemon status`; `daemon stop`; if hooks expose a CLI trigger, fire a `pre-task` and verify side-effects (memory write, pattern store); else invoke MCP tool handler directly via CLI |
| 15 | `15-runtime-skills-and-test-coverage.md` | Sandbox: enumerate skills via CLI; attempt to invoke one; orthogonally inventory unit / integration / acceptance test files referencing audited surfaces; report coverage matrix |

Synthesis pass (16) — runs after all 15 complete:

* `00-README.md` — executive summary, severity-ranked findings, cross-surface patterns.
* `16-gap-analysis.md` — cross-cutting analysis: what was missed by the 6 named surfaces, what was missed by the audit methodology itself, recommended next-pass scope.

### Output structure

All outputs land under `/Users/henrik/source/ruflo-patch/docs/audits/2026-05-19-soundness-audit/`. Per-agent files are dedicated; no two agents write to the same path. Cleanup of `/tmp/ruflo-audit-*` is the runtime agent's responsibility.

### Soundness vs Completeness

* **Sound**: function / method references resolve; types match across callers; error handling correct; no silent fallbacks that mask failures (per [[feedback-no-fallbacks]]); docstring claims match behaviour.
* **Complete**: feature is fully implemented; no `throw new Error('not implemented')`, no `return {} as any`, no `// TODO`, no mock returns where real work is advertised; documented capability is wired end-to-end.

### Runtime validation contract

Each runtime agent MUST:

1. Verify Verdaccio is up: `curl -sf http://localhost:4873/-/ping` (fail loud if not).
2. Create OWN sandbox: `/tmp/ruflo-audit-<slice>-$$/`.
3. Install `@sparkleideas/ruflo@latest` via `npm install` inside the sandbox, registry pointed at Verdaccio.
4. Run `ruflo init` non-interactively in the sandbox.
5. Exercise the slice with real commands (no mocks).
6. Capture actual stdout / stderr / exit codes; fail loud on unexpected results.
7. NEVER touch `/Users/henrik/source/ruflo-patch/` outside the audit output dir.
8. NEVER touch `~/.claude/` or the user's home config.
9. Trap cleanup: kill spawned processes (daemon, MCP server, hook handlers), remove sandbox, on success AND failure.
10. Write findings to the dedicated output markdown file only.

### Test-project provenance

Runtime validation uses Verdaccio-published packages, i.e. the most recent `npm run release` output. It does NOT read `./node_modules/@sparkleideas/*` (per [[feedback-inspect-installed-not-dev-nodemodules]]).

If a runtime agent observes a critical issue but dev-source already fixes it, the agent reports both states (installed vs source) so synthesis can distinguish "needs new release" from "needs new patch".

### Consequences

* Good, because the audit covers every named surface AND identifies unnamed gaps in one sweep.
* Good, because runtime validation catches behavioural failures static analysis misses — e.g. ESM `require` only throws at call time; static type-check passes.
* Good, because per-agent scope fencing eliminates race and write contention.
* Good, because pre-organised 16-file output makes synthesis a reading task, not an investigation task.
* Bad, because 15 parallel agents consume substantial token budget. Cost is real.
* Bad, because runtime validation depends on Verdaccio reflecting the dev source — if no recent release covers a dev-only fix, runtime agents may surface false-positive findings against stale published packages. Mitigation: report installed-vs-source distinction.
* Bad, because the killed prior attempt's intermediate findings are NOT seeded into the new agents — they rediscover independently. This is good for verification but pays the discovery cost twice.
* Neutral, because runtime cleanup is the agent's responsibility — orphaned processes / temp dirs possible if a runtime agent crashes mid-execution. Mitigation: `trap` in shell commands.
* Neutral, because runtime agents discover issues independently of static — possible duplicate findings. Synthesis deduplicates.

### Confirmation

The audit is confirmed complete when:

* All 16 markdown files exist under `/Users/henrik/source/ruflo-patch/docs/audits/2026-05-19-soundness-audit/`.
* `git status` shows no modifications outside that directory + `docs/adr/ADR-0201-*.md`.
* `ps aux | grep -E '(ruflo|claude-flow).*(daemon|mcp start)' | grep -v grep` shows no orphan processes from this session.
* `ls /tmp/ruflo-audit-*` returns empty.
* `00-README.md` lists, per surface, critical / warning / note counts and a cross-cutting gap section.

## Pros and Cons of the Options

### Option A — Pure static
* Good, because cheapest; pure read-only.
* Bad, because misses runtime-only failure modes (ESM-throws-at-call-time, IPC-server-binds-with-zero-handlers, daemon-status-lies).
* Bad, because user explicitly asked for code-in-action validation.

### Option B — Pure runtime
* Good, because surfaces behavioural truth on every probed surface.
* Bad, because 15 agents cannot meaningfully sample 200+ MCP tools — static roll-up wins for stub clusters.
* Bad, because all-runtime adds operational fragility (process leaks, port collisions, Verdaccio dependency).

### Option C — Sequenced hybrid
* Good, because runtime can use static findings as a checklist.
* Bad, because runtime idles until static completes — wasted wall time when scopes don't conflict.

### Option D — Parallel hybrid (chosen)
* Good, because parallelism preserved end-to-end.
* Good, because static + runtime are complementary, not redundant.
* Good, because synthesis pass reconciles both into one executive view.
* Bad, because synthesis has 16 inputs to digest.
* Bad, because possible duplicate findings — synthesis deduplicates.

## More Information

Memory references shaping the plan:

* [[feedback-no-fallbacks]] — fail loud; no silent fallback branches.
* [[feedback-inspect-installed-not-dev-nodemodules]] — audit installed packages, not dev node_modules.
* [[feedback-test-in-init-projects]] — test against init'd projects; never modify user home dir; never use this repo as a test target.
* [[reference-verdaccio]] — Verdaccio at `localhost:4873` always running.
* [[feedback-trace-before-hypothesis]] — read at least one handler before generalising.
* [[feedback-no-time-estimates]] — no duration anchoring.
* [[feedback-skip-accepted-as-squelch]] — legit skips are tool-not-found / heavy-test-opt-out / env-disabled; anything else flagged.
* [[project-rvf-primary]] — RVF is primary; SQLite is fallback only.
* [[feedback-all-test-levels]] — unit + integration + acceptance.
* [[reference-cli-cmd-helper]] — use `_cli_cmd` helper for parallel CLI calls.

Audit deliverables (this dispatch):

* [Gap analysis — what this audit did NOT cover](../audits/2026-05-19-soundness-audit/16-gap-analysis.md)
* [Executive summary — severity-ranked findings + per-surface verdicts](../audits/2026-05-19-soundness-audit/00-README.md)

Related ADRs:

* ADR-0094 — living test-coverage tracker; agent 15 references it.
* ADR-0117 — marketplace MCP server registration; agents 9 + 11 reference it.
* ADR-0143 — `@sparkleideas/ruflo` user-facing brand; agent 11 references it.
* ADR-0161 — agentdb extraction; controllers now live in `forks/agentdb/`; agents 4 / 5 / 6 reference it.
* ADR-0178 — fork-only controllers restoration; agents 4 / 5 / 6 reference it.
* ADR-0200 — SyncCoordinator `pushOnly()` / `pullOnly()` public surface; agent 6 references it.

## Remediation-ADR pre-flight checklist (added 2026-05-20)

This audit produced a batch of remediation ADRs (0202–0218). A 6-expert swarm review of 0207/0208/0209/0210 found that each, drafted the same day from the *static* slices below, reached for a label / gate / wire remedy that the runtime, upstream, or true inventory did not support. Lesson learned: **a static audit finding says a surface looks wrong; it does not validate the remedy.** Any ADR that remediates a finding here MUST, before writing its Decision Outcome, clear four checks (see memory `feedback-remediation-adr-preflight`):

1. **Signal reaches its audience** — trace the propagation path end-to-end to the real consumer. (0207: socket had zero clients; 0208: exit code swallowed by `continueOnError` + `ruflo-hook.sh exit 0`; 0210: `_stub` JSON-stringified into `content[0].text`, and tools selected by `description` before any runtime envelope.)
2. **Upstream hasn't already decided it** — `diff` against `ruvnet/ruflo` + check upstream ADRs/issues. A fork-only gate on upstream-by-design behaviour is a perpetual merge tax. (0208/0209 upstream-permissive-by-design; 0210 upstream ADR-073 chose implement/delete and the fork had regressed away from real code.)
3. **Premise/inventory is true at runtime** — re-derive counts by reading the live code, not the audit table. (0208: 9→30+ flags, no trip-wire; 0209: "29 new"→pre-existing, "14 lacking existsSync"→0; 0210: 3/7 were recoverable regressions.)
4. **No sibling-ADR overlap** — check the rest of this batch for the same surface/mechanism. (0210's arch-test = 0209's rejected detector; 0207's driver already owned by 0202; 0210's `hooks_notify` owned by 0211.)

Default to **implement / delete / behaviour-verify at the seam that matters**, and re-converge with upstream, over label / gate / wire. The runtime-validation agents this ADR already dispatched (slices 12/13/15) are the model — remediation ADRs must apply that same runtime lens, not stop at the static slice.
