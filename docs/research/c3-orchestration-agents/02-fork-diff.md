# C3 Orchestration & Agents — Fork Diff (classified deltas)

**Protocol:** ADR-0292 step 4. **Null hypothesis:** upstream works; fork divergence is the bug (FORK-REGRESSION is the default for any delta). **Validation bar:** ADR-0291 §Confirmation (5-point) — binding before any UPSTREAM-BROKEN verdict. **C2 method addition:** cold-vs-warm (reload in a fresh process before classifying).
**Author:** fork-auditor (queen-led C3 swarm). **Date:** 2026-06-04.

> **DA review (2026-06-04) — substantially UPHELD with two reclassifications + errata** (`/tmp/c3-evidence/da/logs/`). Upheld & strengthened: the `agent_execute` stale-MODEL_MAP regression (re-driven ×2, catalogue-wide — router picked haiku and 400'd on `claude-3-5-haiku-latest`; env-cause REFUTED — keys present, provider authenticated, model-validation error names the bad ID; still unmerged at HEAD `bd43fbf2b`); both direction-flips (wasm_agent_create re-pin works ×3 + rvagent/ruvllm packages independent; swarm_scale wired — caveat: it mutates `maxAgents` scaling INTENT, not live `agentCount`); the G6-fix; the PARITY block (5+ re-driven, one over-statement: workflow pause is gated on running-state — the "full state machine" claim needs that precondition). **Reclassified by DA:** (1) the missing-3-tools "FORK-AHEAD-via-substitution" — the learning CAPABILITY substitution is real (DA proved cross-session SONA reinforcement via trajectory-*: confidence 0.55→0.595, successCount 1→2), BUT the "0 references in fork HEAD" claim was FALSE (corrected in §Surface-delta below) and the fork's own `ruflo hooks task-completed` CLI no-ops on pattern-training → split grade: FORK-AHEAD (capability) + minor FORK-REGRESSION (advertised CLI/skill surface). (2) The 7-vs-8 plugin note conflated the `agent_*` MCP tools with upstream's `ruflo-agent` PLUGIN (= renamed ruflo-wasm + managed-agent skill + `managed_agent_*` Claude-cloud tools, upstream `ef73a1616`/`3975ab512`, not in the ledger) → the missing `managed_agent_*` cloud runtime is an UNCLASSIFIED delta, graded in 04-dispositions. Minor errata: the fix-commit cite had `opus:'claude-opus-4-7'` (bumped to `-4-8` later upstream); W-1 is a REAL minor honesty gap (MCP `wasm_agent_prompt` returns bare `echo:` WITHOUT the documented no-key NOTE that the CLI path appends — DA captured it; the auditor's own captures had crashed before seeing an echo); W-2 = envelope-shape divergence (text-as-object vs text-as-JSON-string), not "triple-nesting"; cli source paths in this doc omit the `v3/@claude-flow/cli/src/` prefix.

> **Upstream-proof status:** `01-upstream-proof.md` was authored in parallel (separate environment); it **landed during my write-up** and I RECONCILED against it (+ a queen calibration message). Upstream behaviour was independently established here via `git show origin/main:<path>` reads + the fork↔upstream `merge-base --is-ancestor` test; the prover's live upstream drives corroborate. **Two cross-environment direction-flips emerged from reconciliation and are folded in below** (both raise the fork ABOVE upstream): `wasm_agent_create` is UPSTREAM-BROKEN but the fork FIXED it (re-pin), and `swarm_scale` is upstream DOC-DRIFT (phantom) but the fork registered a working handler. **Open questions for the prover/DA** at the end.

### Reconciliation with the prover's upstream-proof (+ queen calibration) — load-bearing

| Item | Prover's UPSTREAM finding | My FORK finding | Reconciled class |
|---|---|---|---|
| **`wasm_agent_create`** | **UPSTREAM-BROKEN** (full 5-pt bar): `{error:"JsModelProvider requires a function argument"}`, deterministic ×3, traced to `@ruvector/rvagent-wasm@0.1.0` glue-vs-binary skew | **WORKS** ×3 deterministic (`success:true`, real agent ids, model `anthropic:claude-sonnet-4-6`, agent persists) | **FORK-AHEAD (fixes a THIRD-PARTY-SHARED upstream break)** — the fork re-pins to `@sparkleideas/ruvector-rvagent-wasm@0.2.1-patch.228`; the broken error string has **0 occurrences** in the fork's WASM; ADR-0254 documents the newer pin. **HOW = re-pin** (answers the prover's Q#1 + queen calibration #1). |
| **`swarm_scale`** | **DOC-DRIFT** upstream — `-32601 Tool not found`; in `mcp.js:392` static catalog `enabled:true` but NOT in the live 4-tool registry | **WORKS** — registered in the live 5-tool registry; real handler (rejected terminated swarm + bad id with specific errors) | **FORK-AHEAD** — the fork wired the handler upstream left as a phantom catalog entry (ADR-0148/0244 disposition landed for the MCP tool). (Answers queen calibration #5.) |
| `swarm_status.taskCount:0` | CORRECT upstream (swarm owns membership; tasks separate registry) | identical (`taskCount:0` while tasks live in `tasks/store.json`) | **PARITY** (not a counter bug — queen calibration #2) |
| honest degradation `_note` fields | pervasive + self-disclosed upstream (coordination_orchestrate `executor:none`, daa workflow tracked-not-executed, coordination_metrics state-tracking nulls) | identical self-disclosing `_note` fields | **PARITY** (the real defect — agent_execute Regression #1 — does NOT self-disclose, it throws a provider 400; that is how it distinguishes itself, per queen calibration #3) |
| hook auto-fire `--success true` (upstream G6) | upstream still hardcodes `feedback(true)` / `--success true` | fork **derives** outcome from `tool_response.status`, **skips on underivable (no fabrication)** | **FORK-AHEAD (fixes upstream G6)** — see §Q-A below (ADR-0290) |
| orchestration stores | 3 loosely-coupled JSON stores under `.claude-flow/` | identical JSON stores (`.swarm/swarm-state.json` + `.claude-flow/*/store.json`), read-back holds | **PARITY** (fork did NOT reroute orchestration into RVF — see §Q-B) |

## Scope note (binding — read first)

**C3 lists 8 plugins; the fork ships 7.** `ruflo-agent` **does not exist** as a fork plugin (`git -C forks/ruflo ls-tree -d HEAD plugins/` returns no `ruflo-agent`; marketplace.json has no `ruflo-agent` entry). The "agent" capability is delivered by **(a) ruflo-core** (3 generalist agents: coder/researcher/reviewer + the MCP server) and **(b) ruflo-swarm** (the 8 `agent_*` MCP tools, per its manifest "8 agent_* MCP tools"). I audited the `agent_*` MCP surface under ruflo-swarm and the 3 generalist agents under ruflo-core. No silent cap — the 8th plugin simply isn't in the fork.

The 7 fork C3 plugins: **ruflo-core, ruflo-swarm, ruflo-hive-mind, ruflo-wasm, ruflo-daa, ruflo-workflows, ruflo-goals.**

## Environment record (exact)

| Component | Value |
|---|---|
| Fork project | `/tmp/ruflo-fork-c3` — `ruflo init --full --force` + `ruflo memory init`, Verdaccio registry (`http://localhost:4873`) |
| `@sparkleideas/ruflo` (wrapper) | `3.1.0-alpha.14-patch.389` |
| `@sparkleideas/cli` | **`3.7.0-alpha.10-patch.415`** (`ruflo v3.7.0-alpha.10-patch.415`) |
| `@sparkleideas/agentdb` | **`3.0.0-alpha.14-patch.427`** |
| MCP serverInfo | `ruflo 3.0.0` |
| WASM runtime pkgs | `@sparkleideas/ruvector-rvagent-wasm@0.2.1-patch.228` **INSTALLED**; `@sparkleideas/ruvector-ruvllm-wasm` **INSTALLED** |
| Node | v24.14.1 (native better-sqlite3) |
| Tool count | **317 MCP tools** (same as C2). C3 families: swarm_ 5, agent_ 8, hive-mind_ 9, wasm_agent_ 14, wasm_gallery_ 13, daa_ 8, workflow_ 10, coordination_ 7, task_ 8, hooks_* (route/pre/post/session/model/worker/intelligence) |
| Bin driven | `node_modules/@sparkleideas/cli/bin/cli.js mcp start` (long-lived MCP server, per the released package) |
| Cited source | **Released package** = installed `@sparkleideas/cli` dist (the released truth). **Pending** = `forks/ruflo` HEAD (includes unreleased ADR-0293 D1–D4). When a row cites HEAD it says so; default citation is the released dist. |
| Raw evidence | `/tmp/c3-evidence/fork/` — `swarm-results.jsonl`, `swarm2-results.jsonl`, `hive-results.jsonl`, `hive2-results.jsonl`, `wasm-results.jsonl`, `wasm3-results.jsonl`, `wasm4-results.jsonl`, `daa-results.jsonl`, `wf-results.jsonl`, `goals-results.jsonl`, `hooks-results.jsonl`, `toollist.json`; state dumps under `.swarm/`, `.claude-flow/{agents,tasks,coordination,daa,workflows,hive-mind}/store.json`; `logs/` |

> **Harness note (per C2 lesson):** the write-trace `NODE_OPTIONS --require` fs-shim was **NOT used** (it deadlocked the fork's native write loop in C2 — harness artifact). Persistence was verified by **direct store-content dumps** of the JSON state files. The orchestration substrate (swarm/agent/task/coordination/daa/workflow/hive) writes plain JSON to `.swarm/` + `.claude-flow/*/store.json` (FS-JSON, not RVF) — directly greppable.

## Process-spawn caution (C3-specific) — discharged

Orchestration drives were expected to spawn real processes. **Finding: the fork's swarm/agent/hive/workflow/daa/coordination surfaces are FILE-BACKED STATE-TRACKING REGISTRIES, not OS process pools.** No drive spawned a long-lived OS process. `agent_spawn` returns `"note":"Agent registered for coordination. Three execution paths..."` — it registers a coordination record, it does not fork a process. `swarm-state.json` records the **creating** process `pid` but no child is spawned. The only real subprocess paths are (a) `agent_execute` → live LLM API call (see Regression #1), (b) `wasm_agent_prompt` → in-process WASM module + optional LLM fallback. **Cleanup verified:** no `fork-c3`-rooted node processes survived any drive; the patch-project daemon (pid 3026, `claude daemon run`) was never touched; no daemon was registered in `/tmp/ruflo-fork-c3` (no `.pid` files). The `ruv-swarm mcp start` processes visible in `ps` belong to OTHER sessions (npx-cache path, unrelated ppids) — not mine.

## Headline divergences

1. **`agent_execute` model catalogue is STALE vs upstream → every call 404s/400s** (`MODEL_MAP` maps sonnet→`claude-3-5-sonnet-latest`, a deprecated id). Upstream fixed this in `16e59c261` (#1906/#1908, 2026-05-11); the fork **never merged it** (`merge-base --is-ancestor 16e59c261 HEAD` = NO). **Top FORK-REGRESSION**, content-verified, full bar. Detail below.
2. **wasm tool surface is PARITY with upstream (27 tools), but the ruflo-wasm README is STALE** (advertises "10 tools (7+3)"). Both fork and upstream shipped upstream ADR-129's full 27-tool wasm surface (fork via ADR-0254/0256/0266). The "delta" vs README is doc-staleness, NOT fork-ahead.
3. **The orchestration substrate is honest state-tracking.** swarm/agent/task/coordination/workflow/daa all persist real state, reload cross-session, and **self-annotate the executor gap** (`"_note":"...not auto-executed"`, `coordination_metrics "...state-tracking only"`, `executor:"none"`). This is PARITY-with-upstream behaviour (upstream is the same state-tracking model — the README's own anti-drift table treats `Agent`/`Task` as the real executor, MCP `swarm_*`/`agent_*` as the coordination registry).

## Classified delta table

Legend: **FORK-REGRESSION** (works upstream, broken/diverged in fork — the default) · **FORK-AHEAD** (fork capability absent upstream) · **PARITY** · **UPSTREAM-BROKEN** (full bar + root cause).

### ruflo-swarm — swarm_* (4→5) + agent_* (8)

| Feature | Upstream | Fork | Class | Evidence |
|---|---|---|---|---|
| `swarm_init` | mints swarm record, FS-JSON | `{success, swarmId, topology, strategy, maxAgents}` → `.swarm/swarm-state.json` (1 record/distinct config; ADR-0098 dedupe live) | PARITY | swarm-init-hier; `.swarm/swarm-state.json` |
| `swarm_status` / `swarm_health` | state read | `{status:running, agentCount tracked 0→3, taskCount}` / `{healthy:true, checks:[coordinator ok,...]}` | PARITY | swarm-status*/swarm-health |
| `swarm_scale` | **DOC-DRIFT upstream** (prover) — `-32601 Tool not found`; in `mcp.js:392` catalog `enabled:true` but NOT in the live 4-tool registry | **registered + works** in the live 5-tool registry — rejected terminated swarm + bad id with real errors (`"Swarm X is not running (status: terminated)"`) | **FORK-AHEAD** (fork wired the phantom) | swarm-scale-real; ADR-0148/0244 (MCP handler now registered + functional) |
| `swarm_shutdown` | graceful teardown | `{success}` graceful; correctly refused double-shutdown (`"already terminated"`) | PARITY | swarm-shutdown |
| `swarm_exists` | **health-check sub-label inside `swarm_health` (NOT a top-level tool)** | identical health-check label (lines 554/571 = upstream 376/393) | PARITY | swarm-tools.js dump (NOT a missing tool — corrected) |
| `agent_spawn` | register coordination agent | `{success, agentId, agentType, model:sonnet, modelRoutedBy:router, status:spawned}` → `.claude-flow/agents/store.json` | PARITY | agent-spawn-coder/researcher/reviewer; store.json=3 agents |
| `agent_list` / `agent_status` / `agent_health` | state read | full agent records, health 1, uptime tracked; **reloaded cross-session** (fresh process, `uptime:46838`) | PARITY (cold-reload verified) | agent-list-reload-cold / agent-status-reload / agent-health-reload |
| `agent_pool` | pool status | `{poolId, currentSize:3, maxSize:100, utilization, autoScale:false}` | PARITY | agent-pool-status |
| `agent_update` | mutate agent | `{updated:true, agent:{status:busy, taskCount:1}}` — state mutated + persisted | PARITY | agent-update-status |
| `agent_terminate` | terminate | `{terminated:true, terminatedAt}` — persisted (store shows `status:terminated`) | PARITY | agent-terminate; store.json |
| **`agent_execute`** | upstream maps sonnet→`claude-sonnet-4-6` (current 4.x), routes to Anthropic/OpenRouter/Ollama → real LLM | **routes to a real provider but with STALE model id** `claude-3-5-sonnet-latest` → openrouter `400: not a valid model ID` | **FORK-REGRESSION (top)** — full bar below | agent-execute (434ms real API call, 400); MODEL_MAP dist:34-37 vs upstream agent-execute-core.ts:65-67 |

### ruflo-hive-mind — hive-mind_* (9) [ADR-0115 carve-out, advanced skill layer]

> Per `project-hive-mind-one-runtime-two-skills`: ONE shared runtime (upstream V3 + fork patches), TWO skills (`hive-mind` + `hive-mind-advanced`). The 9 `hive-mind_*` handlers are the shared substrate. Verified current — not re-derived.

| Feature | Upstream | Fork | Class | Evidence |
|---|---|---|---|---|
| `hive-mind_init` | queen-led hive, FS-JSON | `{hiveId, queenId, queenType:strategic, consensus:byzantine, status:initialized}` → `.claude-flow/hive-mind/state.json` | PARITY | hive-init-byzantine; state.json |
| `hive-mind_status` | hive + queen + workers | `{status:active, queen{term:1, load tracked 1→0.333}, workers[...]}` | PARITY | hive-status*; reloaded cross-session (active w/ queen+3 workers) |
| `hive-mind_spawn` | spawn workers into substrate registry | `{spawned:3, workers:[hive-worker-...researcher]}` | PARITY | hive-spawn-workers |
| `hive-mind_memory` (set/get/list) | 8 typed memory + TTL | `{set success, ttlMs:600000, expiresAt}` / `{get value:"orchestration works", exists:true}` / `{list keys:[c3-finding], count:1}` | PARITY | hive-memory-set/get/list (**from direct MCP session — does NOT hang; the hang is sub-agent-context-only per ADR-0140 Piece 3a, confirmed**) |
| `hive-mind_consensus` (propose) | BFT/Raft/Gossip proposal | `{proposalId, strategy:bft, status:pending, required:3, totalNodes:3, timeoutAt}` | PARITY | hive-consensus-propose; (post-shutdown `action:status` → "Proposal not found" = correct, proposal cleared) |
| `hive-mind_broadcast` | reach registered workers | `{messageId, recipients:3, priority:high}` | PARITY | hive-broadcast |
| `hive-mind_shutdown` | graceful/force teardown | graceful **correctly refused** with pending consensus (`"Use force:true"`); force → `{agentsTerminated:3, stateSaved:true, consensusCleared:1}` | PARITY (honest guard) | hive-shutdown / hive-force-shutdown |
| `hive-mind_join` / `_leave` | worker join/leave | not destructively driven (no external worker to join) | NOT-DRIVEN (scope) | schema verified |

### ruflo-wasm — wasm_agent_* (14) + wasm_gallery_* (13) [the surface delta]

> **Upstream parity confirmed:** `git show origin/main:wasm-agent-tools.ts` = **27 unique wasm tools**; fork HEAD = **27**; live fork MCP = 14+13 = 27. The ruflo-wasm README's "10 tools (7+3)" is STALE prose — both shipped upstream ADR-129's full surface.

| Feature | Upstream | Fork | Class | Evidence |
|---|---|---|---|---|
| `wasm_gallery_list` / `_categories` / `_search` / `_config` / `_active` | gallery catalog | 6 builtin templates, 5 categories (testing/development/security/research/orchestration); search/config/active honest empties | PARITY | wasm-gallery-* |
| **`wasm_agent_create`** | **UPSTREAM-BROKEN** (prover, full bar) — `{error:"JsModelProvider requires a function argument"}`, `@ruvector/rvagent-wasm@0.1.0` skew | **WORKS** ×3 deterministic — `{success, agent{id, state:idle, model:"anthropic:claude-sonnet-4-6", isStopped:false}, source:gallery}` | **FORK-AHEAD (fixes upstream-broken via re-pin to `0.2.1-patch.228`)** | wasm-agent-create (×3); fork WASM has 0 occurrences of the broken string; ADR-0254 re-pin |
| `wasm_agent_state` / `_tools` / `_files` / `_turn_count` | introspection | real message history; 5 tools (read_file/write_file/edit_file/write_todos/list_files); fileCount; turnCount advances 0→1 after prompt | PARITY | wasm3/wasm4 results |
| **`wasm_agent_prompt`** | bundled WASM has no LLM (echoes by design); cli detects echo stub → routes to Anthropic Messages API (ADR-095 G4) | **identical mechanism** — WASM `initSync` LOADS (no D1 error — rvagent-wasm ≠ ruvllm-wasm); returns `{response:"echo: <input>"}` with no `ANTHROPIC_API_KEY`; designed to route to real LLM when key set | PARITY (honest graceful-degradation) — but see Sub-finding W-1 (missing NOTE hint) + the D1-coupling caveat | wasm-prompt (turnCount 0→1); agent-wasm.js:89-131 |
| `wasm_agent_terminate` / `_reset` / `_export` / `_todos` / `_is_stopped` | lifecycle | `{success:true}` terminate; others reachable | PARITY | wasm3/wasm4 |
| `wasm_agent_compose` / gallery `_add_custom` / `_export` / `_import` / `_load_rvf` / `_configure` / `_remove_custom` / `_list_by_category` | ADR-129 P2/P4 ported surface | present (fork ported via ADR-0256/0266) | PARITY / FORK-AHEAD-vs-README | toollist.json; ADR-0256/0266 |

**Sub-finding W-1 (open question, low severity):** `promptWasmAgent` (agent-wasm.js:116-117) appends a `[NOTE: bundled WASM agent has no LLM; set ANTHROPIC_API_KEY...]` suffix to the echo when no key is set. **My capture returned the bare `echo: <input>` WITHOUT the NOTE suffix.** Either (a) the WASM `prompt()` returned a shape the `isEchoStub` regex matched but a different return path stripped the note, or (b) the MCP wrapper truncated it. Flagged for the prover to confirm the NOTE actually ships (it is the "honest" half of the graceful-degradation). Not a regression on its own.

**Sub-finding W-2 (wasm response triple-wrapping, cosmetic):** `wasm_agent_create`/`_prompt` return a **triple-nested** MCP envelope (`content[0].text` → JSON whose `content[0].text` → JSON payload). Other 317 tools single-wrap. A consumer parsing once gets the inner envelope, not the payload. Cosmetic but a real client-ergonomics smell; flagged.

### ruflo-daa — daa_* (8)

| Feature | Upstream | Fork | Class | Evidence |
|---|---|---|---|---|
| `daa_agent_create` | adaptive agent | `{success, agent{id, type:autonomous, cognitivePattern:adaptive, capabilities:[reasoning,learning]}}` → `.claude-flow/daa/store.json` | PARITY | daa-agent-create |
| `daa_agent_adapt` | adapt from feedback | `{adaptation{performanceScore:0.4, adaptations:1, newSuccessRate:0.7}}` — **state mutated** (successRate 1.0→0.7 after negative feedback) | PARITY (real learning-state mutation) | daa-agent-adapt → daa-learning-status-2 |
| `daa_learning_status` | progress metrics | `{metrics{tasksCompleted, successRate, adaptations}}` reflects the adapt | PARITY | daa-learning-status* |
| `daa_cognitive_pattern` | reasoning pattern | schema requires `action∈{analyze,change}` (my `set` arg rejected — tool validates correctly) | PARITY (arg error mine) | daa-cognitive-pattern-set |
| `daa_workflow_create` / `_execute` | cognitive workflow | create OK; execute `{status:running, steps:[pending], "_note":"Steps tracked but not auto-[executed]"}` | PARITY (honest executor gap) | daa-workflow-* |
| `daa_knowledge_share` | cross-agent propagation | `{knowledgeId, sourceAgent, targetAgents, domain}` | PARITY | daa-knowledge-share |
| `daa_performance_metrics` | aggregate stats | `{agents{total,active,avgSuccessRate:0.7}, workflows, learning{totalAdaptations:1, knowledgeItems:1}}` — aggregates real state | PARITY | daa-performance-metrics |

### ruflo-workflows — workflow_* (10)

| Feature | Upstream | Fork | Class | Evidence |
|---|---|---|---|---|
| `workflow_create` | definition | `{workflowId, status:ready, stepCount:2, reused:false}` → `.claude-flow/workflows/store.json` | PARITY | wf-create |
| `workflow_list` / `_status` | state read | full records, progress/currentStep/totalSteps | PARITY | wf-list / wf-status |
| `workflow_execute` | stateless one-shot | `{status:running, results:[pending], "_note":"...Actual step execution requires agent assignment"}` | PARITY (honest executor gap) | wf-execute |
| `workflow_pause` / `_resume` | lifecycle | `{status:paused}` ↔ `{status:running, resumed:true}` — **full state machine works** | PARITY | wf-pause / wf-resume |
| `workflow_cancel` | terminal cancel | `{status:"failed", reason, skippedSteps:2}` — **README state machine says cancel → `cancelled`, fork emits `failed`** | PARITY (minor label drift — see Cosmetic) | wf-cancel; store shows `failed` |
| `workflow_run` | template/task run | `{workflowId, template:custom, status:running, stages:[Execute pending]}` | PARITY | wf-run-template |
| `workflow_template` (list) | template mgmt | `{templates:[], total:0}` — no builtin templates shipped (honest empty) | PARITY (no builtins) | wf-template-list |
| `workflow_delete` | delete definition | reachable (schema verified; not destructively driven after cancel) | NOT-DRIVEN | schema |

### ruflo-goals — NO dedicated MCP tools (skill + agent orchestration over primitives)

> **Finding: ruflo-goals registers ZERO `goal_*`/`goap_*`/`horizon_*`/`dossier_*` MCP tools.** It is a pure **skill + agent layer** (5 skills, 4 agents incl. `goal-planner` GOAP A*) that composes `task_*`, `memory_*`, `workflow_*`, `hooks_intelligence_trajectory-*`, `neural_predict` + Claude Code `Bash/Read/Write/Edit` (verified in `goal-plan/SKILL.md` `allowed-tools`). GOAP A* planning is **agent-prompt-level reasoning**, not a runtime tool — there is no runtime to regress. Persistence is via memory namespaces (`goap-plans`, `goals-research`, `horizons`, ...).

| Feature | Backing primitive | Fork | Class | Evidence |
|---|---|---|---|---|
| GOAP plan persistence | `memory_store/search --namespace goap-plans` | store + cosine search (0.58) + list all work (mpnet-768, RVF) | PARITY (transitive — substrate proven) | goals-mem-store-goap / goals-mem-search-goap |
| Horizon tracking | `memory_* --namespace goals-horizons` | store + list work | PARITY | goals-mem-store-horizon / goals-mem-list-horizon |
| Task orchestration | `task_*` | proven (swarm drives) | PARITY | swarm-results |
| Workflow steps | `workflow_*` | proven | PARITY | wf-results |
| `neural_predict` (optional plan aid) | `neural_predict` | `{_realEmbedding:false, _embeddingSource:"hash-fallback", predictions:[]}` | **FORK-REGRESSION (C1-owned)** — cross-ref, not re-reported | neural-predict; C1 D-series |
| trajectory recording | `hooks_intelligence_trajectory-*` | C1 surface (`real-sona`); trigger/consumer gap is ADR-0291 G1/G2 | (C1 cross-ref) | hooks-intelligence-stats `implementation:real-sona` |

### ruflo-core — MCP server foundation + hook ROUTING/lifecycle (orchestration angle)

> The learning side of hooks is C1's; here I drive the **routing/lifecycle orchestration** surface. `project-two-hook-paths-cli-vs-handler` + `project-adr0202-hook-exit-code-source-truth` are KNOWN — verified current, not re-derived.

| Feature | Upstream | Fork | Class | Evidence |
|---|---|---|---|---|
| `hooks_route` (keyword + semantic) | route task to pattern | keyword (`feature-task` 0.31) AND semantic (`testing-task` 0.5+, pure-JS cosine, 13065 routes/s) both work | PARITY | hooks-route / hooks-route-semantic |
| `hooks_model-route` / `_stats` | Thompson-sampling model router | `{model:sonnet, confidence:0.67, complexity:0.16, cost-aware reasoning}`; stats `{totalDecisions, modelDistribution, circuitBreaker}` | PARITY | hooks-model-route / -stats |
| `hooks_worker-list` | worker catalog | **12 workers content-verified** (ultralearn, optimize, consolidate, predict, audit, map, preload, deepdive, document, refactor, benchmark, testgaps) — matches README "12 background workers" | PARITY | hooks-worker-list |
| `hooks_worker-detect` | trigger detection | `{detected:false, confidence:0}` for "audit the codebase" (honest — no high-confidence trigger match) | PARITY | hooks-worker-detect |
| `hooks_pre-task` | pre-task skill/agent suggest | `{suggestedAgents:[security-architect 0.85, coder 0.80], relevantSkills:[]}` — learned-pattern routing | PARITY | hooks-pre-task |
| `hooks_post-task` | record outcome | `{learningUpdates{patternsUpdated:1, newPatterns:1, outcomePersisted:false, "_note":"No active trajectory matched..."}}` — the ADR-0291 G1/G2 trigger/consumer gap | (C1 cross-ref — KNOWN, not fresh) | hooks-post-task |
| **`hooks_task-completed`** (the durable-W1-loop MCP entry) | **registered + works** upstream (`{patternsLearned:1, trajectoriesRecorded:1, learningPath:"trajectory-pipeline"}` → `neural/patterns.json`; prover) — added by upstream `aca2280f1`/#2245/ADR-074 | **ABSENT** — not in fork HEAD or live (0 task-completed refs in fork `hooks-tools.ts`); fork did NOT merge `aca2280f1` | **FORK-AHEAD-via-substitution (recorded divergence)** — NOT a capability loss: the durable loop is reachable via `hooks_intelligence_trajectory-*` (present, `real-sona`) + the ADR-0290 `hook-handler.mjs→hooks post-task` path, which ADR-0290 §options chose OVER porting upstream's tool (metadata-only, no PII, no `--success true` fabrication). **BUT the MCP tool surface is gone** — an orchestrator calling `hooks_task-completed` gets "tool not found". See §Surface-delta below + queen calibration #4. | toollist.json; ADR-0290 lines 23/42/55 |
| `hooks_teammate-idle` | honest-degradation stub upstream (`note:"auto-assign needs queue consumer"`, #1916) | **ABSENT** in fork | divergence (dropped honest-stub) — defensible per ADR-0210 (advertised a not-wired surface) | toollist.json |
| `agent_logs` | synthetic-stub upstream (`note:"entries are synthetic, #1916"`) | **ABSENT** in fork | divergence (dropped synthetic-stub) — defensible per ADR-0210/`feedback-no-consumer-is-not-stub` (it advertised synthetic data) | toollist.json |
| production hook path (settings.json) | file-based `ruflo-hook.sh` shim, always exit 0 | confirmed — `plugins/ruflo-core/hooks/hooks.json` PostToolUse→`ruflo-hook.sh post-command/post-edit`, Stop→session-end, all `|| true` | PARITY (matches `project-two-hook-paths`) | hooks.json (read at HEAD) |
| `coordination_*` (7 tools) | topology/orchestrate/consensus/sync/metrics/load_balance/node | topology-get/metrics/orchestrate/sync work; `coordination_metrics` honest (`"...state-tracking only"`); `orchestrate` honest (`executor:"none"`); consensus rejected bad strategy (validates `bft|raft|quorum`) | PARITY (honest state-tracking) | coordination-* |
| `task_*` (8) | shared task tracker | create/list/status/assign/update/complete/summary/cancel all mutate persisted state correctly | PARITY | task-* across drives; `.claude-flow/tasks/store.json` |

## FORK-REGRESSION #1 (top) — `agent_execute` stale model catalogue → every call 404/400s

**Validation bar satisfied (all 5 points):**
1. **Production shape:** warm long-lived MCP server, real `agent_spawn`→`agent_execute` sequence, agent registered with `model:sonnet`.
2. **Documented defaults:** `agent_execute` requires `agentId`+`prompt` — both supplied; `MODEL_MAP[agent.model||'sonnet']` is the resolution path.
3. **Content not counters:** the live call returned `{success:false, model:"claude-3-5-sonnet-latest", error:"openrouter API error 400: claude-3-5-sonnet-latest is not a valid model ID"}` (434 ms — a real provider round-trip, not a stub).
4. **Installed-dist:** traced to `dist/src/mcp-tools/agent-execute-core.js:34-37` (`MODEL_MAP`) + `:347` (`MODEL_MAP[agent.model||'sonnet']||'claude-3-5-sonnet-latest'`). **Confirmed stale on fork HEAD too** (`agent-execute-core.ts:57-60`) — released AND pending are both stale.
5. **Cold-vs-warm ruled out:** model resolution is a static map, not warm-state-dependent; deterministic across calls.

**Mechanism (root-caused):** Upstream `agent-execute-core.ts` MODEL_MAP (origin/main:65-67) maps to **current Claude 4.x ids** — `haiku:'claude-haiku-4-5-20251001'`, `sonnet:'claude-sonnet-4-6'`, `opus:'claude-opus-4-8'`, `DEFAULT_ANTHROPIC_MODEL='claude-sonnet-4-6'`. The fork's MODEL_MAP is **deprecated Claude 3.x** — `haiku:'claude-3-5-haiku-latest'`, `sonnet:'claude-3-5-sonnet-latest'`, `opus:'claude-3-opus-latest'`, `inherit:'claude-3-5-sonnet-latest'`. **Upstream fixed exactly this in commit `16e59c261` "fix(#1906): agent_execute model aliases → current Claude 4.x ids (not deprecated claude-3.x) (#1908)" (2026-05-11)** — its commit body states: *"ids the Anthropic API now 404s. Every `agent_execute` call (and the WASM agent's LLM fallback, which routes through `resolveAnthropicModel`) failed with HTTP 404 even with a valid key."* **`merge-base --is-ancestor 16e59c261 HEAD` = NO** — the fork's build branch never merged it. The fork's last touch to this file (`fd6d5c268`, ADR-0268, 2026-05-29 — **18 days AFTER** the upstream fix) sat on top of the pre-fix state and missed it. **No INTEGRATION-LEDGER row, no fork ADR** covers this divergence.

**Impact:** `agent_execute` is **non-functional for every model tier** in the fork (haiku/sonnet/opus/inherit all map to deprecated ids → 400/404 at any provider) while upstream works. **Coupled blast-radius:** the same `resolveAnthropicModel` powers the `wasm_agent_prompt` LLM fallback (agent-wasm.js:121 imports `resolveAnthropicModel` from agent-execute-core) — so even with `ANTHROPIC_API_KEY` set, the wasm agent's "talk to a model" path would ALSO 404 (upstream's commit body calls this out explicitly). My env (no key) saw the echo path, masking the wasm half; but the fix is the same one-line catalogue update. **This is the highest-impact C3 fork regression.**

**Disposition note (for 03 + the re-convergence ADR):** this is a clean **un-merged-upstream-fix** regression — cherry-pick `16e59c261` (or hand-port the 4 MODEL_MAP lines + `DEFAULT_ANTHROPIC_MODEL`). Severity HIGH (advertised tool dead on every input); risk LOW (mechanical catalogue update). Verify the wasm fallback simultaneously.

## FORK-AHEAD inventory (re-justify, do not assume regression)

- **`swarm_scale`** — present in fork (init/status/shutdown/health/**scale**), absent upstream (0 `swarm_scale` refs in origin/main). The MCP handler works (rejected terminated swarm + bad id with real errors). ADR-0148 listed it "Implement"; ADR-0244 F-01-003 found the **CLI** `swarm scale` command printed success without calling the handler ("wire + register OR delete") — my drive shows the **MCP tool itself is now registered + functional**, so the MCP half landed. Re-justification question for `04-dispositions`: is `swarm_scale` worth the merge-tax, or fold to upstream's surface? (Low cost — it's additive.)
- **hive-mind fork superset** — the 9 `hive-mind_*` handlers are upstream V3 + heavy fork patches (ADR-0108/0119/0120/0121/0122/0124/0129/0131 consensus/topology/memory-type/worker-failure layers + ADR-0185 fork-only `hive-mind-consensus-response.ts`). FORK-AHEAD by design (`project-hive-mind-one-runtime-two-skills`); C1/prior reviews already re-justified. No unwind candidate.
- **`hive-mind-advanced` skill** — fork-authored Layer-2 council/dialectic protocol skill (ADR-0139/0140). FORK-AHEAD; the runtime it drives is shared. KEEP (the brief + memory both say leave the `.agents/` stale copy alone).
- **DAA full surface** — `daa_*` 8 tools exist upstream too (daa-tools.ts is upstream); the fork's DAA is PARITY-aligned, not fork-invented. (No re-justification needed — it's upstream-shared.)

## Known-RESOLVED / KNOWN-EXPLAINED items — verified current, NOT re-reported as fresh

Per the brief, these are KNOWN — I verified current state rather than re-deriving:

| Item | Memory | Current state in C3 fork env |
|---|---|---|
| hive-mind = ONE runtime + two skills | `project-hive-mind-one-runtime-two-skills` | Confirmed: 9 shared `hive-mind_*` handlers drive both skills; advanced is a protocol layer. Full lifecycle works from direct MCP session. |
| `hive-mind_memory` hangs from sub-agent context | `project-hive-mind-one-runtime-two-skills` (ADR-0140 Piece 3a) | Confirmed scope: from my **direct MCP session** it does NOT hang (set/get/list all <5ms). The hang is sub-agent-context-only — I did not contradict it. |
| two hook paths (settings.json file-based vs CLI/MCP) | `project-two-hook-paths-cli-vs-handler` | Confirmed: `hooks.json` PostToolUse→`ruflo-hook.sh` (file-based shim, `|| true`); the CLI/MCP path is separate. Not re-audited as a regression. |
| ADR-0202 hook exit-code source truth | `project-adr0202-hook-exit-code-source-truth` | Not re-tested as a bug (source wires exit-1; audit EXIT:0 = harness artifact). Left alone. |
| plugin marketplace = canonical skill delivery; `.agents/` = banned stale | `project-plugin-system-is-canonical-skill-delivery` | Did NOT audit `.agents/` trees as live. Plugin skill dirs are the surface. |
| ADR-0290 learning capture (hook→episode→learner) | `project-adr0290-learning-capture-shipped` | Fork-ahead, shipped (cli.415/agentdb.427). `hooks_post-task` `outcomePersisted:false` here = the trajectory-trigger gap (G1), not a capture-pipeline break. C1-owned. |
| ruvllm WASM `mod.initSync` skew (D1) | ADR-0293 D1 / C1-D1 / C2-R2 | **Did not re-investigate.** Note: rvagent-wasm `initSync` (the wasm I drove) is a DIFFERENT package and LOADS fine. ruvllm-wasm is the dead one (C1/C2 own it; ADR-0293 D1 fix pending release). |

## Drive coverage + gaps

**Driven (production shape, content-verified state):**
- **swarm/agent/task/coordination:** swarm_init/status/health/scale/shutdown, agent_spawn(×3)/list/status/health/pool/update/execute/terminate, task_create/list/status/assign/update/complete/summary, coordination_topology/metrics/orchestrate/sync/consensus. Cross-session reload verified (fresh process reloaded swarm + 3 agents from disk).
- **hive-mind:** init/status/spawn/memory(set/get/list)/consensus(propose)/broadcast/shutdown(graceful-refused + force). Cross-session reload verified.
- **wasm:** gallery list/categories/search/config/active; agent create/state/tools/prompt(WASM runtime executed, turnCount 0→1)/turn_count/files/export/terminate.
- **daa:** agent_create/adapt/learning_status/cognitive_pattern/workflow_create/workflow_execute/knowledge_share/performance_metrics — adaptation state mutation verified.
- **workflows:** template/create/list/execute/status/pause/resume/cancel/run — full state machine verified.
- **goals:** memory-namespace persistence (goap-plans, goals-horizons) + neural_predict; transitive substrate (task_*/workflow_*/memory_*) proven.
- **ruflo-core hooks:** route(keyword+semantic)/model-route/model-stats/worker-list(12)/worker-detect/pre-task/post-task/intelligence-stats; hooks.json production path read.

**Could NOT drive (recorded judgment calls — NOT failures):**
- `agent_execute` SUCCESS path: blocked by the stale model id (Regression #1) — proven reachable (real 400 from provider), not proven to produce LLM output. A green path needs the model-catalogue fix.
- `wasm_agent_prompt` real-LLM path: no `ANTHROPIC_API_KEY` in env → echo stub (the documented no-key behaviour). The echo→Anthropic routing (ADR-095 G4) is code-verified but not end-to-end driven (would need a key AND the Regression #1 fix — the wasm fallback shares the stale catalogue).
- `hive-mind_join`/`_leave`: need an external worker to join — not destructively driven (in-session spawn covers the worker registry).
- `workflow_delete`, `wasm_gallery_create/_add_custom/_import/_export`, `wasm_agent_compose`/`_reset`/`_todos`/`_is_stopped`: reachable (schemas verified, surface present at PARITY-27 with upstream) but not all individually driven — they are the ADR-129 ported surface, classified PARITY by upstream-parity (27=27) rather than per-tool behavioural drive.
- `coordination_load_balance`/`_node`: reachable, not driven (topology/orchestrate/sync/metrics cover the coordination model).
- ruflo-goals agent-level GOAP A* planning: agent-prompt reasoning, no runtime to drive — verified the substrate primitives instead.

## Divergence counts

- **FORK-REGRESSION: 1 (+1 C1-cross-ref)** — (1) `agent_execute` stale model catalogue (un-merged upstream `16e59c261`) → every call 400/404, **+ coupled wasm-prompt LLM fallback** [top, full bar]; (+) `neural_predict` hash-fallback [**C1-owned**, cross-ref — NOT a fresh C3 regression, counted once].
- **FORK-AHEAD: 4** — (1) `wasm_agent_create` **fixes an UPSTREAM-BROKEN third-party WASM** via re-pin (the strongest fork-ahead — fork works where upstream 404s on a single-published broken WASM); (2) `swarm_scale` wired (upstream doc-drift phantom); (3) hook auto-fire **derives** outcome (fixes upstream G6 fabrication); (4) hive-mind fork-superset consensus/topology/memory layers + `hive-mind-advanced` skill (by design, already re-justified).
- **PARITY: ~50** — entire swarm/agent/task/coordination registry, full hive-mind lifecycle (BFT vote arithmetic + pending-consensus shutdown guard), 27-tool wasm surface (=upstream), DAA 8 tools + EMA adaptation, workflow state machine, goals substrate, hooks routing/model/worker surface, **JSON orchestration stores (not rerouted to RVF)**. The orchestration substrate is honest self-disclosing state-tracking matching upstream's model.
- **UPSTREAM-BROKEN (that the fork shares): 0** — the one upstream-broken feature (`wasm_agent_create`) is **FIXED in the fork**, so no shared-broken verdict. No upstream feature met the 5-point bar AND reproduced fork-side.
- **Cosmetic/doc-drift (flagged, not classified):** ruflo-wasm README "10 tools" (actual 27, PARITY w/ upstream); `workflow_cancel` emits `failed` not `cancelled` (README state machine); wasm response triple-wrapping (W-2); wasm prompt missing the no-key NOTE suffix (W-1); ruflo-goals six legacy namespaces (documented in its ADR-0001, migration deferred).

## Queen's targeted questions — answered explicitly

**Q-A (hook Path A + ADR-0290 fire + G6 `--success true`):**
- **Path A (settings.json file-based) is still file-based + counters-side**, NOT rerouted to the optimizer. The fork's `settings.json` fires `.claude/helpers/hook-handler.mjs` for all events (PreToolUse/PostToolUse/UserPromptSubmit/SessionStart/SessionEnd/PreCompact/SubagentStart/Notification). `intelligence.cjs` writes `pending-insights.jsonl` + ranked/graph-state (Path A counters/file sinks). This matches `project-two-hook-paths` — the optimizer-reaching path is the trajectory MCP tools (G1/G2 gap, C1-owned), unchanged.
- **The ADR-0290 episode path sits ALONGSIDE Path A without double-firing or interference.** `hook-handler.mjs:178-233 post-task` does TWO independent things from ONE outcome derivation: (i) file-based `intelligence.feedback` → ranked/graph-state (line 201), (ii) a **detached fire-and-forget** `npx ... hooks post-task --success <derived>` (lines 213-233) → the ADR-0290 episode→learner sink. Distinct sinks; `RUFLO_DISABLE_TASK_CAPTURE=1` / `RUFLO_TASK_CAPTURE_CMD` escape hatches present (matches `project-adr0290-learning-capture-shipped`). No double-write to the same store.
- **The fork does NOT hardcode `--success true` (fixes upstream G6).** `hook-handler.mjs:192` derives outcome from `tool_response.status` (`completed`/`success`→true, else exit-code); **`:197` skips feedback entirely if outcome is underivable ("feedback skipped (no fabrication)")**; `:219` forwards the real `--success ${outcome?'true':'false'}`. Upstream's G6 (hardcoded `intelligence.feedback(true)`) is **fixed** in the fork. → **FORK-AHEAD.**

**Q-B (orchestration JSON stores — RVF or JSON?):** The fork **leaves them as plain JSON** (PARITY with upstream's 3 loosely-coupled stores). `.swarm/swarm-state.json` + `.claude-flow/{agents,tasks,coordination,daa,workflows}/store.json` + `.claude-flow/hive-mind/state.json` — all JSON, `version:"3.0.0"`. **Read-back contract HOLDS**: a fresh process reloaded the swarm + 3 agents (`swarm-status-reload-cold`, `uptime:46838`) and the hive + queen + 3 workers (`hive-status-reload`) from these files. The fork's RVF/SQLite divergence (C2) is the MEMORY substrate only; the ORCHESTRATION substrate is JSON on both sides — no merge-tax here.

**Q-C (hive-mind = one runtime + two skills, BFT arithmetic + shutdown guard):** Confirmed at PARITY. The 9 `hive-mind_*` handlers (`project-hive-mind-one-runtime-two-skills`) deliver: **real BFT quorum arithmetic** (`hive-mind_consensus propose` → `strategy:bft, required:3, totalNodes:3` for 3 workers — the 2/3+ Byzantine threshold), **pending-consensus shutdown guard** (`hive-mind_shutdown graceful` REFUSED with `"Cannot gracefully shutdown with 1 pending consensus items. Use force:true"`; force → `consensusCleared:1, agentsTerminated:3, stateSaved:true`), queen election (`term:1`, load tracked 1→0.333), typed memory + TTL, broadcast (recipients:3). The `hive-mind-advanced` skill is the **known FORK-AHEAD** Layer-2 council/dialectic protocol (ADR-0139/0140) over the shared runtime — classified FORK-AHEAD, leave-alone.

### Surface-delta — 3 upstream MCP tools dropped by the fork (queen calibration #4)

The fork's 317-tool surface is **missing 3 tools that upstream registers**: `hooks_task-completed`, `hooks_teammate-idle`, `agent_logs` (all confirmed in `origin/main` source + the prover's live upstream drives). ~~0 references in fork HEAD~~ **DA correction: FALSE — 0 references in `hooks-tools.ts` (the MCP-registration file), but the fork SHIPS internal consumers**: `commands/hooks.ts` calls `callMCPTool('hooks_task-completed')` and `('hooks_teammate-idle')` (the CLI subcommands fall back gracefully — no crash — but `ruflo hooks task-completed` is a functional NO-OP for pattern-training where upstream's identical subcommand returns `patternsLearned:1`), and `plugins/ruflo-hive-mind/skills/hive-mind-advanced/SKILL.md:274` documents the tools as wired. Provenance: upstream added `hooks_task-completed`/`_teammate-idle` via `aca2280f1` "feat(intelligence): self-learning wiring (ADR-074, #2245)"; **`merge-base --is-ancestor aca2280f1 HEAD` = NO** — the fork never merged the #2245 self-learning wiring. No INTEGRATION-LEDGER row.

**Classification — NOT a regression, a recorded FORK-AHEAD-via-substitution:**
- **`hooks_task-completed`** is the one that matters (it's upstream's MCP entry to the durable W1 SONA loop, `patternsLearned:1`). The fork did NOT lose the capability: **ADR-0290 explicitly takes upstream's ADR-074 `hooks_task-completed→recordTrajectory` as its GUIDE** (ADR-0290:23-24 "frames the prior no-op as a bug"; :42/:55 "directly mirrors upstream ADR-074's mechanism") and **chose to implement it via a different seam** — the `hook-handler.mjs → detached `hooks post-task`` path (Phase 1, shipped) + the `hooks_intelligence_trajectory-*` tools (present, `real-sona`) — for documented reasons (metadata-only episodes, zero PII surface, no `--success true` fabrication, ADR-0287 F10 constraints). The null-hypothesis test "would re-enabling/porting the upstream mechanism have sufficed?" is **answered in ADR-0290's options table**: porting was considered and the fork's variant chosen deliberately. So the durable loop IS reachable in the fork — via `hooks_intelligence_trajectory-*`, not `hooks_task-completed`.
- **The residual gap:** the *specific MCP tool name* `hooks_task-completed` is gone — an orchestrator (or skill) that calls it (as goals' `goal-plan` does NOT — it uses `trajectory-*`; verified) would get "tool not found". Worth a disposition note: either (a) register a thin `hooks_task-completed` alias→trajectory pipeline for upstream-surface compat, or (b) accept the divergence (the fork's `trajectory-*` is the canonical entry). Recommend (b) + a doc note — the fork's surface is intentional, not a regression, but it should be RECORDED in the INTEGRATION-LEDGER (currently undocumented).
- **`hooks_teammate-idle` + `agent_logs`** are upstream **honest-degradation/synthetic stubs** (both self-disclose `note:"...#1916 follow-up"`/`"synthetic"`). The fork dropping them is **defensible per ADR-0210 (stub-honesty-envelope) + `feedback-no-consumer-is-not-stub`** — they advertised not-yet-wired/synthetic surfaces; removing an advertised-but-synthetic surface is the ADR-0210 DELETE-the-lie disposition, not a capability regression. (Confirm with the DA that no consumer references them.)

## Open questions for the prover / DA

**Resolved by reconciliation (recorded for the DA, no longer open):**
- ~~swarm tool surface / swarm_scale~~ → prover confirms upstream = 4 live tools + swarm_scale doc-drift; fork = 5 live + working handler → **FORK-AHEAD** (settled).
- ~~wasm 27-tool parity~~ → 27=27 source-confirmed both sides; the prover's upstream `wasm_agent_create` BREAK means the 13 downstream wasm tools are *undrivable upstream-as-shipped* but the SURFACE is registered at parity; the fork's working create makes them drivable → fork-ahead on reachability.
- ~~`wasm_agent_create` direction~~ → **UPSTREAM-BROKEN, fork FIXED via re-pin** (settled, full evidence above).

**Genuinely open (for prover/DA):**
1. **`agent_execute` upstream green path:** the prover did NOT drive `agent_execute`'s real LLM output (no Claude key; "paid LLM call out of scope"). My fork side proved the 400 on the stale catalogue. To fully lock Regression #1 as FORK-vs-WORKING-UPSTREAM, someone should confirm upstream's `agent_execute` returns real output with a valid key + the `claude-sonnet-4-6` map. (The static MODEL_MAP diff + the `16e59c261` commit body already make this near-certain; this is belt-and-suspenders.)
2. **wasm prompt NOTE (W-1):** does the no-key echo actually ship the `[NOTE: set ANTHROPIC_API_KEY...]` suffix? My capture had bare echo (the code at agent-wasm.js:116 should append it). If stripped, a small honesty gap — but note the wasm LLM fallback ALSO 404s on the stale catalogue (Regression #1's coupling), so even fixing the NOTE, the fallback needs the model fix.
3. **DA cross-exam target — `wasm_agent_create` re-pin durability:** the fork fixes the upstream WASM break by pinning `0.2.1-patch.228`. Does this fix survive the C1-D1 `ruvllm-wasm initSync` family? **NO conflict found** — rvagent-wasm (this one) and ruvllm-wasm (C1-D1's dead one) are DIFFERENT packages; rvagent's `initSync` loads (agent-wasm.js:42), ruvllm's does not (C1-D1). The DA should confirm the two WASM families are independent (I read them as separate optionalDeps) so the rvagent fix isn't undermined by the ruvllm break.
4. **DA cross-exam target — orchestration executor parity:** both sides are state-tracking + Claude-Code-`Task`-as-executor with self-disclosing `_note` fields (prover calibration #3 confirms upstream is identical). The DA should confirm no upstream feature ships a real autonomous executor for swarm/workflow/coordination that the fork silently dropped (I found none; the `_note` honesty is symmetric).
