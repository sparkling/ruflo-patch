# C3 Orchestration & Agents — Upstream Proof Record

**Protocol:** ADR-0292 steps 1-3 (enumerate → prove upstream → explain mechanism). **Validation bar:** ADR-0291 §Confirmation (5-point) + C2's cold-vs-warm addition.
**Null hypothesis:** UPSTREAM WORKS — this is positive proof, not gap-hunting. **Date:** 2026-06-04. **Author:** upstream-prover (queen-led C3 swarm).

> **DA review (2026-06-04) — UPHELD with errata** (`/tmp/c3-evidence/da/logs/`). Errata: mechanism finding #3 (`hooks_task-completed` MCP entry to the durable loop) describes **upstream only** — the fork does not register that tool; its deliberate entry is `hooks_intelligence_trajectory-*` (see 02 §surface-delta + the DA's reclassification). Path note: upstream cli source paths cited here and in 02/03 live under `v3/@claude-flow/cli/src/` — bare paths omit the `v3/` prefix.

**Reference env:** `/tmp/ruflo-fresh` (REUSED from C1/C2 — verified intact, not rebuilt). All drives run in a clean sub-project `/tmp/c3-up` (only `.mcp.json` at start) so the orchestration stores begin empty for clean write-traces + dumps.

- **ruflo** `3.10.36` (installed bin `/Users/henrik/.npm/_npx/2ed56890c96f58f7/node_modules/.bin/ruflo` → `ruflo/bin/ruflo.js`), wrapping **`@claude-flow/cli` `3.10.36`** (installed dist `…/@claude-flow/cli/dist/src/`).
- MCP serverInfo string: **`ruflo 3.0.0`** (protocol server version) — **293 tools** registered live (`logs/tools-list-c3.txt`, `logs/all-tool-names.txt`).
- Node `v24.14.1`, darwin arm64, embeddings `Xenova/all-MiniLM-L6-v2` 384-d ONNX SIMD, memory backend `sql.js + HNSW`.
- Public npm registry + private cache `/tmp/ruflo-fresh/.npm-cache` (Verdaccio shadow avoided).
- WASM deps used by the cli: `@ruvector/rvagent-wasm@0.1.0` (single published version), `@ruvector/ruvllm-wasm@2.0.2`, `@ruvector/core@0.1.31`, `@noble/ed25519@2.3.0` (cli-bundled).

**Production shape:** one long-lived `ruflo mcp start` stdio session per battery (`c3_driver.py`, the C2 driver reused — threads IDs returned by create/spawn/init via `{{ref:label.path}}`), arg names derived from live `tools/list` schemas (`logs/all-schemas.json`), NODE_OPTIONS write-trace shim (`fswrite-shim.cjs`), before/after tree diff, `sqlite3` + JSON store dumps. CLI commands (`ruflo status/doctor`, witness scripts, `ruflo agent/swarm/hive-mind`) driven as real processes. **Ten batteries, 173 calls** (tally below).

> **Method correction applied (track-record honoured).** Three "failures" were MY wrong shape, not brokenness, and were re-driven in the correct shape before any verdict: `guidance_quickref{task}`/`guidance_workflow{task}` (tools require `domain`/`type`; re-driven → both DEMONSTRATED with valid enums), and the witness `fixes` file used `{files,title}` (template requires `{id,desc,file,marker}`; corrected → full signing proven). Two genuine upstream defects (`wasm_agent_create`, `swarm_scale`) were each re-driven ≥3× deterministically and traced to installed-dist code before recording.

---

## CRITICAL PROVENANCE FINDING (read first — affects two of the eight plugins)

**The marketplace gap ADR-0292 predicted is REAL: `ruflo-hive-mind` and `ruflo-wasm` are ABSENT from the upstream marketplace clone.**

| Plugin | Upstream marketplace clone? | Spec flavor enumerated | Runtime surface source |
|---|---|---|---|
| ruflo-core, ruflo-swarm, ruflo-agent, ruflo-daa, ruflo-workflows, ruflo-goals | **YES** (`~/.claude/plugins/marketplaces/ruflo/plugins/`) | **UPSTREAM marketplace clone** (`mcp__claude-flow__`, `@claude-flow/cli`) | live `@claude-flow/cli` 3.10.36 dist |
| **ruflo-hive-mind** | **NO** — not in the 33-plugin `marketplace.json` | **FORK cache only** (`cache/ruflo/ruflo-hive-mind/0.1.18`, `mcp__ruflo__hive-mind_*`) | live `@claude-flow/cli` dist (`hive-mind-tools.js` — ships the tools regardless of plugin) |
| **ruflo-wasm** | **NO** — not in `marketplace.json` | **FORK cache only** (`cache/ruflo/ruflo-wasm/0.2.17`) | live `@claude-flow/cli` dist (`wasm-agent-tools.js`) |

`marketplace.json` carries **33** plugins; `hive-mind`/`wasm` present = **False** for both (verified). Their MCP tool families (`hive-mind_*`, `wasm_agent_*`, `wasm_gallery_*`) live in the **upstream `@claude-flow/cli` dist** (`dist/src/mcp-tools/hive-mind-tools.js`, `wasm-agent-tools.js`) — so the runtime ships independent of plugin presence, and **behaviour was driven against the upstream dist directly** (bare tool names == `mcp__claude-flow__*`). The fork-cache skills target `mcp__ruflo__hive-mind_*`/`mcp__ruflo__wasm_*` — **same tool names, fork-branded namespace** (the C2 overlay pattern). Note the upstream marketplace's `ruflo-agent` plugin ALSO carries `wasm-agent`/`wasm-gallery` skills, so the wasm surface is upstream-enumerable from there too.

Evidence: `logs/enum-upstream-6plugins.txt`, `logs/enum-fork-2plugins.txt`, `logs/tools-list-c3.txt`.

---

## Per-plugin feature inventory + proof status

Legend: **DEMONSTRATED** (drove it; content/behaviour verified) · **DEMONSTRATED-HONEST** (returns a documented graceful-degradation / capability-absent envelope, correctly — NOT a failure) · **UPSTREAM-BROKEN** (full 5-point bar satisfied AND root-cause mechanism named) · **DOC-DRIFT** (catalog/skill claims a surface the live runtime doesn't expose). 

### Battery tally (RPC-level)

| Battery | calls | ok | notes |
|---|---|---|---|
| spine (swarm+agent+task) | 27 | 27 | full lifecycle |
| spine cold-reload | 5 | 5 | state survives fresh process |
| hive-mind consensus | 22 | 22 | BFT vote-counting |
| hive cleanup (force-shutdown) | 2 | 2 | |
| wasm gallery | 7 | 7 | all read-only surfaces |
| wasm agent lifecycle | 11 | 11 RPC | **create returns the broken envelope** |
| wasm create re-drive ×4 | 4 | 4 RPC | deterministic break |
| daa | 11 | 11 | cognitive patterns + adaptation |
| workflow state machine | 16 | 16 | real executor |
| workflow execute (agent-bound) | 3 | 3 | executor reaches agent dispatch |
| goals namespaces | 8 | 8 | horizons/goap/research persist |
| core (system/session/guidance/hook-routing/coord) | 20 | 20 | |
| guidance re-drive (valid enums) | 2 | 2 | DEMONSTRATED |
| coordination + scale + cancel | 16 | 15 | `swarm_scale` -32601 (not in registry) |
| swarm_scale isolation | 5 | 2 | 3× -32601 deterministic |

---

### ruflo-swarm (4 `swarm_*` + 9 `agent_*` + 9 `task_*` MCP tools; CLI `ruflo swarm`, `ruflo agent`)

Plugin self-declares "4 swarm_* + 8 agent_* (12 total) + 6 topologies". Live registry: **swarm_(4)**: health/init/shutdown/status; **agent_(9)**: spawn/list/status/execute/terminate/update/pool/health/logs; **task_(9)**: create/assign/status/complete/list/update/summary/cancel/retry.

| Feature | Tool | Result envelope (truncated) | Verdict |
|---|---|---|---|
| swarm init | `swarm_init{topology,maxAgents,strategy}` | `{success, swarmId:"swarm-…", topology:"hierarchical-mesh", config{communicationProtocol:"message-bus", autoScaling:true, consensusMechanism:"majority"}}` | DEMONSTRATED |
| swarm status | `swarm_status` | `{swarmId, status:"running", agentCount:3, taskCount:0, config}` (no_swarm before init) | DEMONSTRATED |
| swarm health | `swarm_health` | `{healthy:true, checks:[{coordinator:ok}, {agents}, {persistence}]}` | DEMONSTRATED |
| agent spawn | `agent_spawn{agentType,task,model}` | `{agentId:"agent-…", model:"opus", **modelRoutedBy:"router"**, status:"registered"}` — **live model routing** (coder=inherit→explicit, tester→opus via router, reviewer→sonnet default) | DEMONSTRATED |
| agent list / status / pool / health | `agent_list/status/pool/health` | real per-agent records (status, health:1, taskCount, model); pool currentSize 3 | DEMONSTRATED |
| agent update | `agent_update{status,health}` | `{updated:true, agent{status:"busy", health:0.9}}` (persists) | DEMONSTRATED |
| agent terminate | `agent_terminate` | `{terminated:true, terminatedAt}` (status→terminated in store) | DEMONSTRATED |
| agent logs | `agent_logs{agentId}` | `{entries:[…], note:"per-agent activity logging is not yet wired; entries are synthetic (ruvnet/ruflo#1916)"}` | DEMONSTRATED-HONEST (upstream self-discloses synthetic stub) |
| task lifecycle | `task_create→assign→update→complete` | create→pending; assign flips `status:in_progress`+`startedAt`; complete→`progress:100`+`completedAt`+`result` captured | DEMONSTRATED (full state machine) |
| task summary / list / status | `task_summary/list/status` | `{total:2, pending:1, completed:1, failed:0}`; per-task records reload | DEMONSTRATED |
| task cancel | `task_cancel{reason}` | `{status:"cancelled", result{cancelReason}}` | DEMONSTRATED |
| swarm scale | `swarm_scale` | `-32601 Tool not found` — **NOT in the live tools/list (only 4 swarm tools); the `ruflo mcp tools` static catalog (mcp.js:392) lists it `enabled:true`** | DOC-DRIFT (see ledger; not a broken runtime tool — the live registry never advertised it) |

**Cold-reload (fresh MCP process, no shim):** `swarm_status`→`status:"terminated"` (owning PID gone), agents/tasks/summary all reload intact from disk. State is durable, not in-process-only.

### ruflo-hive-mind (10 `hive-mind_*` MCP tools; CLI `ruflo hive-mind`) — FORK-cache spec, upstream-dist runtime

| Feature | Tool | Result envelope (truncated) | Verdict |
|---|---|---|---|
| init | `hive-mind_init{topology,consensus:"byzantine"}` | `{hiveId:"hive-…", queenId:"queen-…", config{maxAgents:15, persist:true, memoryBackend:"hybrid"}}` | DEMONSTRATED |
| status | `hive-mind_status{verbose}` | `{status:"active", queen{electedAt, term:1}, workers:[…5…], metrics, health}` | DEMONSTRATED |
| spawn | `hive-mind_spawn{count,role,agentType}` | `{spawned:4, workers:[…], totalWorkers:5}` (worker + specialist roles) | DEMONSTRATED |
| **consensus propose** | `hive-mind_consensus{action:"propose",strategy:"bft"}` | `{proposalId, status:"pending", **required:4, totalNodes:5**}` — BFT quorum = ⌈(2·5)/3⌉+1 logic | DEMONSTRATED |
| **consensus vote** (×4) | `{action:"vote",vote,voterId}` | `votesFor` increments 1→2→3, `votesAgainst` 0→1; `resolved:false` (3 < required 4) | DEMONSTRATED (**real BFT arithmetic**) |
| consensus status / list | `{action:"status"/"list"}` | `{votesFor:3, votesAgainst:1, required:4, resolved:false, timedOut:false}`; pending list w/ history | DEMONSTRATED |
| broadcast | `hive-mind_broadcast{message,priority}` | `{messageId, recipients:5}` (persists to sharedMemory.broadcasts) | DEMONSTRATED |
| memory set/get/list | `hive-mind_memory{action,key,value}` | set→`success`; get→`{value:{…}, exists:true}` (round-trips); list→`{keys:["broadcasts","ratified-decision"], count:2}` | DEMONSTRATED |
| join / leave | `hive-mind_join/leave{agentId,role}` | join→`totalWorkers:6`; leave→`remainingWorkers:5` | DEMONSTRATED |
| optimize-memory | `hive-mind_optimize-memory` | `{optimized:false, note:"structural compaction only; pattern-quality consolidation is delegated to the intelligence pipeline (#1916)"}` | DEMONSTRATED-HONEST |
| **shutdown (graceful guard)** | `hive-mind_shutdown{graceful:true}` | `{success:false, error:"Cannot gracefully shutdown with 1 pending consensus items. Use force:true"}` | DEMONSTRATED (**real safety guard** — won't drop pending consensus) |
| shutdown (force) | `hive-mind_shutdown{force:true}` | `{workersTerminated:5, consensusCleared:1}`; status→offline | DEMONSTRATED |

### ruflo-agent + ruflo-wasm (14 `wasm_agent_*` + 13 `wasm_gallery_*` MCP tools; CLI `ruflo agent wasm-*`)

**Gallery surface — DEMONSTRATED in full:**

| Feature | Tool | Result | Verdict |
|---|---|---|---|
| gallery list | `wasm_gallery_list` | 6 built-in templates (coder/researcher/tester/reviewer/security/swarm-orchestrator) w/ category, tags, version | DEMONSTRATED |
| gallery categories | `wasm_gallery_categories` | `{orchestration:1, research:1, development:2, security:1, testing:1}` | DEMONSTRATED |
| gallery search | `wasm_gallery_search{query}` | ranked results w/ `relevance` scores | DEMONSTRATED |
| gallery list-by-category / active / config | `wasm_gallery_*` | development→[coder,reviewer]; active→`{activeId:null}`; config→`{}` | DEMONSTRATED |
| agent list (empty) | `wasm_agent_list` | `{agents:[], count:0}` | DEMONSTRATED |
| CLI `ruflo agent wasm-status` | — | `Available: yes, 6 gallery templates, sandbox tools` — **but emits `using deprecated parameters for initSync(); pass a single object instead`** | DEMONSTRATED (status reads work; note the initSync skew warning) |

**Agent runtime surface — UPSTREAM-BROKEN (the one C3 defect; full bar below):**

| Feature | Tool | Result | Verdict |
|---|---|---|---|
| **agent create** | `wasm_agent_create{template}` / `wasm_gallery_create` / CLI `ruflo agent wasm-create` | `{error:"JsModelProvider requires a function argument"}` — **4 MCP variants + CLI all fail identically, ms≤3, deterministic** | **UPSTREAM-BROKEN** |
| state/tools/todos/turn_count/is_stopped/reset/terminate | `wasm_agent_*{agentId}` | all `{error:"agentId must be a non-empty string"}` — **cascade from create failure** (no agent to address), NOT independent breaks | (blocked by create) |

**Root cause (installed-dist verified):** `agent-wasm.js:42` calls `mod.initSync(wasmBytes)` (deprecated bare-bytes form → warning, tolerated). Then `createWasmAgent` does `new mod.WasmAgent(configJson)` → `wasm.wasmagent_new(...)` in `@ruvector/rvagent-wasm@0.1.0`'s `rvagent_wasm_bg.wasm`. The WASM binary's string table carries `"JsModelProvider requires a function argument"` adjacent to `jsmodelprovider_new`/`wasmagent_set_model_provider` — the binary's `wasmagent_new` **requires** a model-provider function. But the JS glue documents the provider as **optional** (`WasmAgent.prompt` doc: "Otherwise, returns an echo response for testing") and `attachJsModelProvider` is `return false` without API keys (`agent-wasm.js:104`). **Glue-vs-binary contract skew** in the only-published `@ruvector/rvagent-wasm@0.1.0` (published 2026-03-17, no newer version). The wasm-agent SKILL's Step 1 is "Create agent" with no API-key precondition documented. This is the same family as C1's ruvllm `initSync` skew — and it would hit **both fork and upstream** (same single-version WASM dependency). Evidence: `up-wasm-agent.jsonl`, `up-wasm-redrive.jsonl`, `logs/wasm-agent-stderr.txt`, dist reads inline above.

### ruflo-daa (8 `daa_*` MCP tools; CLI `ruflo daa`)

| Feature | Tool | Result | Verdict |
|---|---|---|---|
| agent create | `daa_agent_create{id,cognitivePattern,learningRate,...}` | `{agent{id, status:"active", cognitivePattern:"convergent", capabilities}}` | DEMONSTRATED |
| cognitive pattern analyze | `daa_cognitive_pattern{action:"analyze"}` | `{currentPattern, metrics, _note:"Pattern analysis requires real cognitive modeling. Current pattern and metrics shown."}` | DEMONSTRATED-HONEST |
| cognitive pattern change | `{action:"change",pattern:"systems"}` | `{previousPattern:"convergent", newPattern:"systems"}` (persists) | DEMONSTRATED |
| **adapt** | `daa_agent_adapt{performanceScore:0.85}` | `{adaptation{adaptations:1, **newSuccessRate:0.925**}, _storedIn:"agentdb"}` — **real EMA blend** | DEMONSTRATED |
| learning status (one/all) | `daa_learning_status{detailed}` | reflects changed pattern (systems) + updated successRate; all→`{avgSuccessRate:0.9625, totalAdaptations:1}` | DEMONSTRATED |
| knowledge share | `daa_knowledge_share{source,targets,content}` | `{knowledgeId, _storedIn:"agentdb", _note:"vector-searchable + JSON store"}` | DEMONSTRATED |
| workflow create | `daa_workflow_create{steps,strategy}` | `{workflowId, steps:2, strategy:"sequential"}` | DEMONSTRATED |
| workflow execute | `daa_workflow_execute` | `{status:"running", steps:[…pending…], _note:"Steps tracked but not auto-executed. Use agent tools to execute each step."}` | DEMONSTRATED-HONEST (tracking scaffold) |
| performance metrics | `daa_performance_metrics{category:"all"}` | `{agents{total:2, avgSuccessRate:0.9625}, workflows{...}, learning{totalAdaptations:1, knowledgeItems:1}}` | DEMONSTRATED |

### ruflo-workflows (12 `workflow_*` MCP tools; CLI `ruflo workflow`)

| Feature | Tool | Result | Verdict |
|---|---|---|---|
| create / list / status | `workflow_create{steps,variables}` | `{workflowId, status:"ready", stepCount:3}`; status shows steps w/ progress/currentStep/totalSteps | DEMONSTRATED |
| **execute** | `workflow_execute` | `{status:"failed", error:"task step step-1 requires config.agentId or workflow.variables.defaultAgentId", failedStep, results:[{durationMs:58}]}` — **real executor ran** (durationMs proves dispatch attempt) | DEMONSTRATED (executor real; task steps need a bound agent) |
| execute (agent-bound) | `workflow_execute` (variables.defaultAgentId set) | `{status:"failed", error:"Agent not found"}` — **progressed past agentId gate to agent-registry lookup** | DEMONSTRATED (two distinct executor gates → genuine dispatch logic) |
| state-machine guards | `pause`/`resume`/`cancel` on a failed wf | `"Workflow not running"` / `"not paused"` / `"already finished"` | DEMONSTRATED (correct state-transition rejections) |
| template save/list | `workflow_template{action}` | save→`{templateId}`; list→the saved template w/ stepCount | DEMONSTRATED |
| run / delete / validate | `workflow_run/delete/validate` | run→new wf running; delete→`{deleted:true}`; validate→honest empty-file report | DEMONSTRATED |

### ruflo-goals (NO `goal_*` MCP tool — skill-orchestrated composition of `task_*`/`memory_*`/`neural_*`/`workflow_*`/`trajectory_*`)

The `/goals` command → `memory_search` on `horizons` + `research-synthesis`. The `goal-plan` skill (GOAP) composes `task_*` + `memory_store/search` + `neural_predict` + `workflow_*` + `hooks_intelligence_trajectory-*` (`allowed-tools` line). The GOAP "algorithm" is agent reasoning over these primitives — there is **no goal_* runtime to be broken**. Proof = the goals-specific persistence paths:

| Goals step | Underlying primitive | Result | Verdict |
|---|---|---|---|
| store horizon | `memory_store{namespace:"horizons"}` | `{stored:true, hasEmbedding:true, embeddingDimensions:384, backend:"sql.js + HNSW"}` | DEMONSTRATED |
| store goap-plan / research | `memory_store{namespace:"goap-plans"/"research-synthesis"}` | both persist w/ 384-d embeddings | DEMONSTRATED |
| `/goals` list horizons | `memory_search{namespace:"horizons"}` | recalled `horizon-q3-auth` @ sim 0.317 | DEMONSTRATED |
| search research | `memory_search{namespace:"research-synthesis"}` | recalled `research-jwt` @ sim 0.447 | DEMONSTRATED |
| search goap-plans | `memory_search{namespace:"goap-plans"}` | 0 results — **default threshold 0.7 hides the low-sim match** (ADR-0291 W4); `memory_list` confirms it IS stored | DEMONSTRATED (threshold caveat, not loss) |
| next-action predict | `neural_predict` | `{_realEmbedding:true, _embeddingSource:"ruvector@0.2.27 MiniLM"}` | DEMONSTRATED |

### ruflo-core (orchestration spine: init/doctor/status/witness + hook ROUTING/lifecycle — learning/trajectory surface already proven in ADR-0291/C1, NOT re-litigated)

**MCP-side orchestration tools:**

| Feature | Tool | Result | Verdict |
|---|---|---|---|
| system status / health / info / metrics | `system_*` | health score 80 (honest "Config file not found — run init" degraded check); info→node v24.14.1, feature flags; metrics `_real:true` w/ live CPU/memory/agents/tasks | DEMONSTRATED |
| session save / list / current / info | `session_*` | save captures `tasks:2, agents:3` from live stores → `.claude-flow/sessions/*.json`; all read back (`memoryEntries:0` — sessions index task/agent buffer not memory.db, same as C2) | DEMONSTRATED |
| guidance capabilities / recommend / discover | `guidance_*` | capabilities→areas w/ "use when native Bash is wrong" framing; **discover→71 real agents**; recommend→task-matched | DEMONSTRATED |
| guidance quickref / workflow | `guidance_quickref{domain}` / `guidance_workflow{type}` | `swarm-ops`→real command cheatsheet; `swarm`→structured workflow plan (steps/agents/topology) | DEMONSTRATED (after correct-enum re-drive) |
| **hooks_route** (the router) | `hooks_route{task,useSemanticRouter}` | `{method:"semantic-native", backend:"native VectorDb (HNSW)", 3695 routes/s, matchedPattern:"api-task"@0.56}` | DEMONSTRATED (live routing consumer) |
| **hooks_task-completed** | `hooks_task-completed{trainPatterns:true}` | `{patternsLearned:1, trajectoriesRecorded:1, learningPath:"trajectory-pipeline", note:"Trained via SONA + EWC++ trajectory pipeline"}` → writes `neural/patterns.json` | DEMONSTRATED (**MCP entry point to the durable W1 loop EXISTS** — ADR-0291 G7 removed it only as a *Claude-Code hook event*, not as an MCP tool) |
| hooks_teammate-idle | `hooks_teammate-idle{autoAssign}` | `{action:"waiting", note:"auto-assignment requires the task-queue consumer (#1916 follow-up)"}` | DEMONSTRATED-HONEST (matches ADR-0291 G7 "instructed self-reporting" reality) |
| hooks_worker-detect / -list | `hooks_worker-*` | detect→`{detected:false, confidence:0}` (honest, no trigger); list→6 worker templates w/ triggers (ultralearn/optimize/…) | DEMONSTRATED |
| coordination topology / node / sync / metrics / load_balance / consensus | `coordination_*` | topology raft+redundancy:2; node add/list real registry; consensus quorum (required:1 for 1 node); metrics honest "state-tracking only" nulls | DEMONSTRATED + DEMONSTRATED-HONEST |
| coordination orchestrate | `coordination_orchestrate` | `{status:"scheduled", executor:"none", _note:"records the orchestration request but does not execute it"}` | DEMONSTRATED-HONEST (request recorder) |

**CLI-side core surface:**

| Feature | Drive | Result | Verdict |
|---|---|---|---|
| `ruflo status` | real CLI | ONNX embedder loads; swarm/agents/tasks/memory tables render (RuFlo V3 [STOPPED]) | DEMONSTRATED |
| `ruflo doctor` | real CLI | **17 parallel checks: 10 pass, 7 honest warnings** (version-freshness 3.10.36 vs 3.10.37 stale, Node/npm/Claude/Git, config/daemon/memory-db, `API Keys: OPENAI_API_KEY (no Claude key)`, 16 MCP servers, AIDefence loadable, encryption-at-rest) | DEMONSTRATED |
| **witness** (ADR-0103) | standalone scripts `plugins/ruflo-core/scripts/witness/*.mjs` (NOT a `ruflo` subcommand — `ruflo witness`→"Unknown command", correct) | init→manifest+history; **regen→signed manifest** (ed25519 publicKey+signature, sha256 hash, `verified:2`); verify→`pass=2 drift=0` (signature valid); **TAMPER→`pass=1 drift=1`** (detects modified file); history→temporal summary | DEMONSTRATED (full cryptographic lifecycle + tamper detection) |

> Witness deps: needs `@noble/ed25519` (documented: init says "install @noble/ed25519"). Probe path is relative (`<root>/v3/@claude-flow/cli`), not the env var; v3.x of the lib breaks (`etc` frozen → "Cannot add property sha512Sync") because `lib.mjs` mutates `ed.etc.sha512Sync` (the v1/v2 API). Staging the cli-bundled **v2.3.0** at the probed path + a git repo → full signing works. This is a version-pin sensitivity in the witness signer (works with the cli-bundled v2.3.0; breaks against newly-installed v3.x). Recorded as a doc/dep note, not a defect — the cli ships the compatible v2.3.0.

**Hook two-path mechanism — BOTH paths driven (the orchestration-spine question):**

| Path | Trigger | Invocation | Write-trace | Reaches durable optimizer? |
|---|---|---|---|---|
| **A — file-based plugin hook** | `PostToolUse(Bash/Write)`, `Stop` (ruflo-core `hooks/hooks.json`) | `scripts/ruflo-hook.sh <sub>` → `ruflo hooks post-command/post-edit/session-end` (CLI; prefers local bin, npx fallback, **always exit 0**) | **ONLY `.claude-flow/neural/stats.json` (counters)** | **NO** |
| **B — MCP tool** | model/operator call | `hooks_route`, `hooks_task-completed`, `hooks_intelligence_trajectory-*` | `neural/patterns.json` + SONA/EWC++ pipeline | **YES** (`hooks_task-completed`→patternsLearned:1) |

Driven directly: `ruflo-hook.sh post-command -c "npm run build" -s true -e 0` → `[OK] Command outcome recorded`, write-trace = `neural/stats.json` only. This **re-confirms ADR-0291 G1/G2 in the orchestration context**: the auto-fire plugin path is counter-only; durable learning needs deliberate MCP calls. Evidence: `traces/fswrites-hookpath.log`, `traces/fswrites-core.log`.

---

## Mechanism map (process → trigger → store → consumer)

The orchestration spine persists to **per-family JSON stores under `.claude-flow/`** (NOT memory.db — that is the C2 substrate; hive memory is the exception, it uses the hybrid backend → memory.db). Write-trace of the spine drive (`traces/fswrites.log`, project-local):

```
6  writeFileSync  .claude-flow/agents/store.json        <- agent registry
5  writeFileSync  .claude-flow/tasks/store.json         <- task registry (SEPARATE from swarm)
4  writeFileSync  .claude-flow/swarm/swarm-state.json   <- swarm config + agent membership
1  writeFileSync  .swarm/model-router-state.json        <- model routing learning
```

| Surface | Process | Trigger | Store | Consumer (read-back) |
|---|---|---|---|---|
| swarm_init/status/health/shutdown | MCP server (single long-lived) | call | `.claude-flow/swarm/swarm-state.json` (`{swarms:{<id>:{agents:[…], tasks:[], config, pid}}}`) | swarm_status (status flips to `terminated` when owning pid gone), swarm_health |
| agent_spawn/list/status/update/terminate | MCP server | call | `.claude-flow/agents/store.json` (per-agent: status, health, taskCount, model, modelRoutedBy) | agent_list/status/pool/health; survives cold reload |
| task_create/assign/complete/cancel | MCP server | call | `.claude-flow/tasks/store.json` (full lifecycle: status, progress, startedAt/completedAt, result) | task_list/status/summary; **NOT registered into swarm.tasks[]** → swarm_status.taskCount stays 0 |
| agent_spawn model routing | MCP server, model-router | spawn w/ `task` | `.swarm/model-router-state.json` | the `modelRoutedBy` field per agent |
| hive-mind_* (init/spawn/consensus/memory) | MCP server | call | `.claude-flow/hive-mind/state.json` (workers[], consensus.pending[{votes:{voter:bool}, byzantineVoters}], sharedMemory, queen{term}) **+ `.swarm/memory.db`** (hybrid backend for memory set) | hive-mind_status/consensus/memory; force-shutdown clears |
| daa_* | MCP server, learningSystem/agentdb | call | `.claude-flow/daa/store.json` + agentdb (adapt/knowledge → `_storedIn:agentdb`) | daa_learning_status/performance_metrics |
| workflow_* | MCP server, workflow executor | call | `.claude-flow/workflows/store.json` | workflow_status (executor resolves+dispatches to agent registry) |
| goals (horizons/goap-plans/research) | MCP server (memory) | agent call via skill | `.swarm/memory.db memory_entries` (ns=horizons/goap-plans/research-synthesis, 384-d) | `/goals` memory_search, neural_predict |
| session_* | MCP server | call | `.claude-flow/sessions/*.json` (manifest: task/agent buffer, NOT memory.db) | session_list/info/current |
| coordination_* | MCP server | call | `.claude-flow/coordination/store.json` | coordination_node/sync/metrics |
| Hook Path A (auto-fire) | short-lived CLI (`ruflo hooks <sub>`) | PostToolUse/Stop via plugin hooks.json | `.claude-flow/neural/stats.json` (counters) | nothing durable (G1/G2) |
| Hook Path B (MCP) | MCP server | deliberate call | `.swarm/sona-patterns.json` + `neural/patterns.json` + memory.db (C1) | hooks_route reads patterns; hooks_task-completed feeds optimizer |

### Five most important mechanism findings (orchestration-spine focus)

1. **swarm_init creates a coordination shell; tasks live in a SEPARATE registry the swarm doesn't track.** `swarm-state.json` holds `{agents:[3 ids], tasks:[]}` — the swarm records agent *membership* but its `tasks[]` stays empty even after 2 tasks created + 1 completed. Tasks persist independently in `tasks/store.json` (with the assigned agent's `taskCount` bumped). So `swarm_status.taskCount:0` is **correct** (the swarm genuinely doesn't own tasks), not a counter bug. Agents/tasks/swarm are three loosely-coupled JSON stores under `.claude-flow/`, all durable across processes (cold-reload proven).

2. **hive-mind consensus is REAL Byzantine fault-tolerant vote-counting, not theater.** 5 nodes → BFT `required:4` (tolerates 1 faulty); votes increment per-ballot (`votesFor` 1→2→3, `votesAgainst` 0→1); 3-for+1-against correctly does NOT resolve (3 < 4). The full ballot record persists to `hive-mind/state.json` (`votes:{w-1:true,…,w-4:false}, byzantineVoters:[]`). Graceful shutdown **refuses** with pending consensus (won't lose votes). This is genuine quorum arithmetic with a real safety guard.

3. **The durable learning loop HAS an MCP entry point via `hooks_task-completed` — ADR-0291 G7 was about the *Claude-Code hook event*, not the MCP tool.** Upstream removed `TeammateIdle`/`TaskCompleted` as auto-fire hook events (invalid Claude Code events), but `hooks_task-completed` and `hooks_teammate-idle` survive as **working MCP tools**. `hooks_task-completed{trainPatterns:true}` runs the real SONA+EWC++ trajectory pipeline (`patternsLearned:1, trajectoriesRecorded:1`, writes `neural/patterns.json`). So an *orchestrator* (or fork's hook→CLI bridge) CAN reach the durable loop deliberately — the gap (G1) is that the *auto-fire plugin path* (Path A) writes only counters.

4. **The hook two-path split is confirmed by direct write-trace.** Path A (`PostToolUse`→`ruflo-hook.sh`→`ruflo hooks post-command`, CLI, exit-0-always) writes **only** `.claude-flow/neural/stats.json` (counters). Path B (MCP `hooks_*`) reaches the optimizer + patterns. This is the same architecture C1/ADR-0291 found, re-proven in the orchestration spine: the resilient shim is best-effort telemetry, durable learning is MCP-deliberate.

5. **"Honest degradation" is pervasive and correct across orchestration.** `agent_logs` (synthetic, #1916), `coordination_orchestrate` (records-not-executes), `coordination_metrics` (state-tracking-only nulls), `daa_workflow_execute` (tracked-not-auto-executed), `hive-mind_optimize-memory` (structural-only), `hooks_teammate-idle` (auto-assign needs queue consumer). Every one self-discloses the boundary in a `_note`/`note` field — none fabricate. These are NOT failures; they are the documented edges of what the orchestration layer does vs delegates to agent tools. The genuine break (`wasm_agent_create`) does NOT self-disclose — it throws a raw WASM error — which is exactly how a real defect distinguishes itself from honest degradation.

---

## NOT-DEMONSTRATED / partial ledger (with bar points)

| Item | Status | Why | Bar points |
|---|---|---|---|
| `wasm_agent_create` (+ all 13 downstream wasm_agent_* that need an agentId) | **UPSTREAM-BROKEN** | glue-vs-binary skew in `@ruvector/rvagent-wasm@0.1.0` | (1) prod-shape ✓ long-lived MCP + CLI, 4 MCP variants · (2) skill Step 1 "Create agent", no key precondition documented; `--help` wasm-create present · (3) write-trace: agents map stays empty, nothing persisted · (4) installed-dist: traced to `wasmagent_new`→WASM string table `"JsModelProvider requires a function argument"`; single published 0.1.0 · (5) `wasm_agent_list` count:0 confirms no agent (content) |
| `swarm_scale` | **DOC-DRIFT** (not broken runtime) | not in live tools/list (4 swarm tools); only in `mcp.js:392` static `ruflo mcp tools` catalog as `enabled:true` | (1) 3 arg shapes ✓ · (4) dist: `swarm-tools.js` registers 5 handlers (no scale); `mcp.js` catalog ≠ live registry · (5) -32601 = correct for an unadvertised name |
| witness regen against ed25519 **v3.x** | env-precondition | lib mutates `ed.etc.sha512Sync` (v1/v2 API); v3.x `etc` frozen | works with cli-bundled v2.3.0 (proven); v3.x is a fresh-install dep-pin issue, not a witness defect |
| `wasm_agent_prompt` / `wasm_agent_export` / `wasm_agent_compose` / `wasm_agent_files` | not driven | blocked by create; prompt would also be an echo-stub (no Claude key) + needs a live agent | (1) schemas captured · (4) tools registered; the create gate makes downstream undrivable upstream-as-shipped |
| `agent_execute` (real LLM dispatch) | not driven | makes a real Anthropic call (no Claude key in env — doctor confirms only OPENAI_API_KEY) | (1) registered w/ schema; the agent registry (spawn/list/status) proven; execution = paid LLM call out of substrate scope |
| `session_restore`/`_export`/`_import`/`_delete` | not driven | would mutate/destroy proof-state session | (1) schemas captured · (4) registered |
| `hive-mind_spawn --claude` (launch real Claude Code workers) | not driven | spawns real Claude Code processes (C3 caution) | (1) the non-Claude spawn path proven (5 workers); the `--claude` flag launches external processes |
| `daa_workflow` full step execution, `workflow_execute` full green run | partial | both need a bound *live* agent that executes work (LLM) | executor dispatch logic proven (reaches agent lookup); a green run needs `agent_execute` (paid) |

No `UPSTREAM-BROKEN` verdict beyond `wasm_agent_create` was reached. Everything else is DEMONSTRATED, DEMONSTRATED-HONEST, DOC-DRIFT, or a scope/safety judgment call.

---

## Environment record (exact)

| Component | Version / path |
|---|---|
| ruflo | 3.10.36 — `/Users/henrik/.npm/_npx/2ed56890c96f58f7/node_modules/ruflo` (bin `ruflo/bin/ruflo.js`) |
| @claude-flow/cli | 3.10.36 — `…/2ed56890c96f58f7/node_modules/@claude-flow/cli/dist/src/` |
| MCP serverInfo | `ruflo 3.0.0`; 293 tools live |
| Node | v24.14.1, darwin arm64 |
| @ruvector/rvagent-wasm | **0.1.0** (single published version, 2026-03-17) — the broken WASM |
| @ruvector/ruvllm-wasm | 2.0.2 |
| @noble/ed25519 (cli-bundled) | 2.3.0 (witness signer-compatible) |
| Upstream plugin spec (6) | `~/.claude/plugins/marketplaces/ruflo/plugins/` — core 0.2.2, swarm 0.2.0, agent 0.2.0, daa 0.2.0, workflows 0.4.0, goals 0.2.0 |
| Fork-cache-only spec (2) | hive-mind 0.1.18, wasm 0.2.17 (NOT in marketplace.json) — runtime from upstream cli dist |
| Reference root | `/tmp/ruflo-fresh` (REUSED, intact) |
| Clean drive sub-project | `/tmp/c3-up` |
| Registry / cache | public npm + `/tmp/ruflo-fresh/.npm-cache` |

## Evidence index (`/tmp/c3-evidence/upstream/`)

| File | Contents |
|---|---|
| `logs/tools-list-c3.txt`, `logs/all-tool-names.txt` | live 293-tool list + C3 family groupings (swarm 4, agent 9, hive-mind 10, wasm_agent 14, wasm_gallery 13, daa 8, workflow 12, task 9, coordination 7, hooks 43, system 5, session 8, guidance 5) |
| `logs/all-schemas.json` | live `inputSchema` for every tool (arg names used in drives) |
| `logs/enum-upstream-6plugins.txt`, `enum-fork-2plugins.txt` | plugin manifest/skill/command/agent/hook enumeration (spec flavor provenance) |
| `calls-*.json` + `up-*-results.jsonl` | 10 batteries (spine, spine-reload, hive, hive-cleanup, wasm-gallery, wasm-agent, wasm-redrive, daa, workflow, wf2, goals, core, guidance-fix2, coord, scale) — full result envelopes |
| `traces/fswrites.log` (spine), `-hive`, `-daa`, `-wf`, `-core`, `-hookpath`, `-wasm` | complete fs write-traces (NODE_OPTIONS shim) per battery |
| `treediffs/spine-before/after.txt`, `hive-before/after.txt` | full-tree diffs (files created per drive) |
| `dumps/stores/*.json` | persisted orchestration stores (swarm-state, agents, tasks, hive-state, daa, workflows, coordination) |
| `dumps/memory-db-tables.txt` | `.swarm/memory.db` 50+ tables (hive hybrid memory + goals namespaces, 11 memory_entries) |
| `logs/cli-status.txt`, `cli-doctor.txt`, `cli-witness-help.txt` | CLI command surface read-back |
| `c3_driver.py`, `fswrite-shim.cjs`, `list_all.py` | reproducible harness (C2 driver reused) |

## Open questions for fork-auditor / devil's advocate

1. **`wasm_agent_create` is UPSTREAM-BROKEN (glue-vs-binary skew in `@ruvector/rvagent-wasm@0.1.0`).** Does the FORK hit the identical break? Both depend on the same single-published WASM. If the fork "fixed" wasm-create, HOW (re-pinned WASM? patched glue to pass a stub provider? wired `set_model_provider` unconditionally?) — and does the fix survive without API keys (the echo-stub design)? This is the C1 ruvllm-WASM-skew sibling; cross-reference C1's D1.

2. **Hook Path A vs Path B in the fork.** Upstream's auto-fire plugin hook (`ruflo-hook.sh`→CLI) writes only counters (`neural/stats.json`); durable learning needs MCP `hooks_task-completed`. The fork's ADR-0290 episode pipeline (hook→metadata-episode→NightlyLearner) is the fork-ahead bridge. Confirm the fork's `ruflo-core` hooks.json still fires the SAME 5 subcommands, and whether the fork rerouted Path A to reach the optimizer (closing G1) or kept it counter-only + added the episode path alongside.

3. **`hooks_task-completed`/`hooks_teammate-idle` MCP tools work upstream** (real SONA pipeline / honest auto-assign-pending). Does the fork keep these, and does the fork's `hooks_task-completed` still hardcode `--success true` anywhere (ADR-0291 G6)? I drove it with explicit `success:true,quality:0.9` — confirm the fork's *auto-fire* path doesn't fabricate the success flag.

4. **`swarm_scale` DOC-DRIFT:** the live registry has 4 swarm tools (no scale); only the static `ruflo mcp tools` catalog (mcp.js:392) lists it `enabled:true`. The fork's MCP surface (deferred-tools list shows `mcp__ruflo__swarm_scale`) MAY actually register a handler. Confirm: does the fork's live `tools/list` advertise swarm_scale, and if so does it have a working handler (or the same -32601)?

5. **Provenance:** hive-mind + wasm are fork-cache-only (absent from upstream marketplace.json). The runtime is upstream-dist. Confirm the fork's *published* hive-mind/wasm plugins match the upstream tool *surface* (10 hive-mind_*, 14 wasm_agent_*, 13 wasm_gallery_*) — not just the `mcp__ruflo__` branding — and that the fork didn't add/remove tools in those families.

6. **Stores: JSON vs RVF.** Upstream's orchestration spine persists to plain `.claude-flow/<family>/store.json` (swarm/agents/tasks/hive/daa/workflows/coordination) + memory.db only for hive hybrid memory. The fork's RVF-as-sole-truth posture (C2 J1) — does it reroute these orchestration JSON stores into RVF, or leave them as JSON (they carry no embeddings, so RVF may be unnecessary)? Drive the SAME spine battery against the fork to see whether the store shape (3 loosely-coupled JSON registries) is preserved.

7. **witness ed25519 pin.** Upstream witness signer mutates `ed.etc.sha512Sync` (v1/v2 API) — works with cli-bundled v2.3.0, breaks against v3.x. If the fork bumped `@noble/ed25519` to v3.x anywhere in the witness probe path, witness signing would break. Confirm the fork's witness scripts + bundled ed25519 version.
