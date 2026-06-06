# C6 Operations — Upstream Proof Record

**Protocol:** ADR-0292 steps 1-3 (enumerate → prove upstream → explain mechanism). **Validation bar:** ADR-0291 §Confirmation (5-point) + C2's cold-vs-warm + dump-timing (end-state claims dumped after the drive's LAST write) + the self-disclosure lens (honest degradation self-discloses via note/warn fields; real defects fail loudly OR silently).
**Null hypothesis:** UPSTREAM WORKS — this is positive proof, not gap-hunting. **Date:** 2026-06-04. **Author:** upstream-prover (queen-led C6 swarm; steps 1-3 only — fork-auditor + DA run separately).

> **DA review (2026-06-04) — UPHELD** (`/tmp/c6-evidence/da/`). The `browser_session_record` UPSTREAM-BROKEN verdict re-driven and confirmed (upstream step-1 `rvf create --dimension 384` succeeds, real `.rvf` written; dies at trajectory-begin arg-skew); cost USD math independently recomputed exact ($0.350685 — note F3: the PRICING table carries stale Haiku-3 rates under a `haiku-4-5` label, internally consistent); observability content-not-counter re-confirmed. Cross-side note: the fork's shelled `memory` CLI is ~26-31× slower than this env's upstream CLI (34.7-41s vs 1.31s — DA finding F1, a fork perf regression masquerading as harness timeouts in the fork audit).

**Reference env:** `/tmp/ruflo-fresh` (REUSED from C1–C5 — verified intact, not rebuilt). All drives run in a clean sub-project `/tmp/c6-up` (only `.mcp.json` at start) so the operations stores begin empty for clean write-traces + dumps. `/tmp/c6-up` was planted with **synthetic** material ONLY: a fabricated Claude Code session jsonl (fake sonnet/haiku/opus `usage` blocks — no real tokens/PII), a span/metric/log tree authored as memory records, and two **local `file://` HTML pages** I created (`pages/login.html`, `pages/page2.html`). **No external network targets. No paid LLM worker runs** (C4's recorded evidence covers real worker EXECUTION — testgaps/sonnet, document/haiku; C6 drove dispatch/detect/status/cancel + scheduling mechanics only). All daemons started were stopped; all browser drives used `file://` only.

- **ruflo** `3.10.36` (installed bin `/Users/henrik/.npm/_npx/2ed56890c96f58f7/node_modules/.bin/ruflo` → `ruflo/bin/ruflo.js`), wrapping **`@claude-flow/cli` `3.10.36`** (installed dist `…/@claude-flow/cli/dist/src/`).
- MCP serverInfo string: **`ruflo 3.0.0`** — **293 tools** registered live (`logs/tools-list-all.txt`).
- Node `v24.14.1`, darwin arm64, embeddings `Xenova/all-MiniLM-L6-v2` 384-d ONNX SIMD, memory backend `sql.js + HNSW`.
- Worker daemon: `worker-daemon.js` (Node, NOT headless — no E2B; interval scheduler + run-accounting drove without paid LLM runs). Browser substrate: `agent-browser 0.27.1` (via `npx`; NOT on PATH as a bare binary), `ruvector@0.2.25` (pinned trajectory/RVF CLI), `ms-playwright` chromium cache present.
- Public npm registry + private cache `/tmp/ruflo-fresh/.npm-cache`.

**Production shape:** one long-lived `ruflo mcp start` stdio session per battery (`up-*.jsonl` drivers, threaded IDs), arg names derived from live `tools/list` schemas (`logs/schemas-c6.json`). The `daemon`/`hooks worker` CLI driven as real `node` processes (the upstream `ruflo` bin). The cost-tracker `scripts/*.mjs` driven as real `node` processes (these ARE the plugin's runtime — there is no `ruflo cost` CLI). Worker/cron framework: `daemon start`/`status`/`stop`/`enable -w`/`enable -w --disable`, with `daemon-state.json` dumped while RUNNING. **Three MCP batteries (19 calls: workers 8, observability 9 incl. store+readback, router 6) + 1 browser lifecycle battery (5 calls, local file://) + 12 CLI/script runs (daemon lifecycle 6 + cost scripts 7) + 4 smoke contracts.**

> **Method correction applied (track-record honoured).** Two run-1 "absences" were MY wrong test shape, re-driven correctly BEFORE any verdict: (1) `cost-track`'s `TRACK_SESSION=<file>` env did NOT pin my synthetic jsonl — the script resolves the session by scanning `~/.claude/projects/<encoded-cwd>/` (dist line 150: `TRACK_SESSION || findActiveSession(projectDir)`, but `findActiveSession` needs the project dir to exist first); re-driven with `TRACK_CWD=/tmp/c6-costproj` + the jsonl planted under the encoded projects dir → full per-model/per-tier USD report (`cost-track2.txt`). (2) `daemon enable document` first failed `Required option missing: --worker` (my wrong positional) — the flag is `-w <worker>` + `-d/--disable`; re-driven `daemon enable -w document` → enabled, then `--disable` → reverted (registry write proven both ways). No failure verdict was recorded before re-driving (bar points 1, 2).

> **Cold-vs-warm note (C6-specific).** The daemon interval scheduler is the C6 cold-vs-warm surface: a fresh `daemon start` immediately fires the 5-min-interval `map` worker (cold run on startup), then stages staggered `nextRun` times for the rest. I dumped `daemon-state.json` **while RUNNING** (dump-timing) to capture the live schedule, not after stop. The `daemon-state.json running:true` flag is stale-on-disk after `daemon stop` (status reads the PROCESS via `ps`, which is correctly STOPPED; the flag is a cosmetic non-fatal artifact, not a live daemon).

---

## CRITICAL PROVENANCE FINDING (read first — affects the whole category)

**All 4 C6 plugins ARE in the upstream marketplace clone.** `marketplace.json` carries 33 plugins; all four C6 names present = **True** (verified). The C6 surface is the most heterogeneous category yet — four distinct substrate classes:

| Plugin | Upstream marketplace clone? | Spec flavor enumerated | Substrate type | Manifest version |
|---|---|---|---|---|
| ruflo-loop-workers | **YES** | UPSTREAM clone (`mcp__claude-flow__`, `@claude-flow/cli`) | **tool-backed** (5 `hooks_worker-*` MCP) + **CLI-backed daemon** (worker/cron framework) | 0.2.0 |
| ruflo-observability | **YES** | UPSTREAM clone | **template-over-substrate** (NO `observe` CLI, NO `observe_*` MCP — agent reasoning over `memory_*` `observability` namespace) | 0.2.0 |
| ruflo-cost-tracker | **YES** | UPSTREAM clone | **script-backed** (`scripts/*.mjs`; NO `ruflo cost` CLI) + `memory_*` `cost-tracking`/`cost-patterns` namespaces + `hooks_model-*` consumers | **0.16.1** |
| ruflo-browser | **YES** | UPSTREAM clone | **tool-backed lifecycle (5 `browser_session_*`) + conditionally-registered interaction (23 `browser_*`, gated on `agent-browser`)**, handlers shell `ruvector@0.2.25` + `agent-browser` + bridged `memory` | 0.2.0 |

All four upstream plugins are markdown-only EXCEPT cost-tracker (ships real `scripts/*.mjs`) and the plugins' `scripts/smoke.sh`/`replay-spike.sh`. Provenance discipline honoured: **behaviour driven against the upstream `@claude-flow/cli` 3.10.36 dist directly** (bare MCP names == `mcp__claude-flow__*`; daemon/hooks CLI is the upstream `ruflo` bin; cost scripts are the plugin's own `.mjs`). The activated cache may be fork-overlaid (`mcp__ruflo__` namespace — my deferred-tool list shows e.g. 23 `mcp__ruflo__browser_*` interaction tools that are FORK/cache surface, not the upstream main server); the upstream marketplace clone is the spec for enumeration. Evidence: `logs/tools-list-all.txt`, plugin.json/SKILL.md/README enumerated inline below.

### Live MCP registry: C6 tool surface (what the main upstream server exposes)

`tools/list` on the live upstream server (293 tools) — C6 families:

- **loop-workers (5 MCP, EXACT):** `hooks_worker-cancel`, `hooks_worker-detect`, `hooks_worker-dispatch`, `hooks_worker-list`, `hooks_worker-status` — **exact match** to the manifest's "5 hooks_worker-* tools". (The worker/cron FRAMEWORK is additionally `daemon` CLI-backed.)
- **observability (0 MCP tools):** there is **NO `observe`/`observ*` MCP tool AND NO `observe` CLI subcommand** (`[ERROR] Unknown command: observe`). By design: the `observe` command + `observe-trace`/`observe-metrics` skills are agent reasoning that store/recall spans/metrics/logs via `memory_* --namespace observability`.
- **cost-tracker (0 MCP tools):** **NO `cost`/`cost*` MCP tool AND NO `ruflo cost` CLI subcommand** (`[ERROR] Unknown command: cost`). By design: script-backed (`scripts/*.mjs`). Its router/feedback consumers ARE present: `hooks_model-route`, `hooks_model-outcome`, `hooks_model-stats`, `hooks_coverage-gaps/-route/-suggest`.
- **browser (5 MCP live):** `browser_session_record`, `browser_session_end`, `browser_session_replay`, `browser_template_apply`, `browser_cookie_use` — the **5 `browser_session_*` lifecycle tools** the README claims as "implemented in v0.2.0". The **23 `browser_*` interaction primitives** (`browser_click/open/screenshot/fill/navigate…`) the README also claims are **conditionally registered** and were **ABSENT from this fresh registry** (see browser mechanism — `_browserAvailable` gate).

---

## Per-plugin feature inventory + proof status

Legend: **DEMONSTRATED** (drove it; content/behaviour verified) · **DEMONSTRATED-HONEST** (returns a documented graceful-degradation / capability-absent envelope that self-discloses — NOT a failure) · **NOT-DEMONSTRATED** (with 5-point bar shown) · **DOC-DRIFT** (skill/command/README references a surface the live runtime doesn't expose) · **UPSTREAM-BROKEN** (full 5-point bar + named root-cause mechanism).

### ruflo-loop-workers (tool-backed 5 `hooks_worker-*` + CLI-backed daemon/cron framework)

**Enumerated:** commands `/ruflo-loop` (dispatch a worker + `ScheduleWakeup` 270s), `/ruflo-schedule` (`CronCreate`); skills `loop-worker` (`Bash(npx*) hooks_worker-dispatch hooks_worker-status ScheduleWakeup`), `cron-schedule` (`CronCreate CronList CronDelete hooks_worker-dispatch`); agent `loop-worker-coordinator` (model haiku). Manifest: "5 hooks_worker-* MCP tools (list/dispatch/status/detect/cancel) + 12 background worker triggers". Owns the `worker-history` AgentDB namespace. **Live registry has exactly the 5 tools. Manifest is exact.**

| Feature | Drive | Result envelope (truncated) | Verdict |
|---|---|---|---|
| **worker-list** | `hooks_worker-list{includeActive:true}` | 12 workers w/ trigger, description, priority, estimatedDuration, capabilities, `patterns:N` (ultralearn 6, optimize 6, consolidate 5…) | **DEMONSTRATED** (real registry) |
| **worker-detect (positive)** | `hooks_worker-detect{prompt:"the test coverage is low, we need more unit tests"}` | `{detected:true, triggers:["testgaps"], confidence:0.5, triggerDetails:[{capabilities:["testing","coverage","analysis"]}]}` | **DEMONSTRATED** |
| worker-detect (positive 2) | `{prompt:"please run a security audit and check for vulnerabilities"}` | `{triggers:["audit"], priority:"critical"}` | DEMONSTRATED |
| worker-detect (positive 3) | `{prompt:"optimize performance and reduce latency in the hot path"}` | `{triggers:["optimize"], priority:"high"}` | DEMONSTRATED |
| **worker-detect (NEGATIVE)** | `{prompt:"let's grab a coffee and chat about the weather"}` | `{detected:false, triggers:[], confidence:0, triggersFound:0}` — **does NOT over-trigger** | **DEMONSTRATED (discriminates)** |
| worker-detect (multi) | `{prompt:"consolidate memory and refactor the messy module"}` | `{triggers:["consolidate","refactor"], triggersFound:2}` | DEMONSTRATED |
| worker-detect (keyword limit) | `{prompt:"the code needs documentation for the public API"}` | `{detected:false}` — "documentation" did NOT match the `document` trigger (needs `document`/`docs` token) | DEMONSTRATED (characterized keyword scope, not a failure) |
| **worker-dispatch (no daemon)** | `hooks_worker-dispatch{trigger:"audit",context:"src/"}` | `{success:true, workerId:"worker_audit_1_…", status:"no-daemon", daemonAlive:false, note:"No worker daemon detected… dispatch recorded in-process but no actual work will run"}` | **DEMONSTRATED-HONEST** (self-discloses; same pattern as C4) |
| **worker-status** | `hooks_worker-status{includeCompleted:true}` | `{workers:[{id:"worker_audit_1_…", status:"pending", progress:0, phase:"initializing"}], summary:{total:1,running:0,completed:0,failed:0}}` — **tracks the dispatched worker** | DEMONSTRATED |
| **worker-cancel (negative)** | `hooks_worker-cancel{workerId:"worker_nonexistent_123"}` | `{success:false, error:"Worker not found: worker_nonexistent_123"}` — **honest fail-loud** | DEMONSTRATED |
| **daemon status (registry)** | `ruflo daemon status` | 7-worker table: 5 enabled (map/audit/optimize/consolidate/testgaps ✓), 2 disabled (predict/document ○); Max Concurrent 2, Max CPU Load 14.4, Min Free Memory 5% | **DEMONSTRATED** |
| **daemon enable/disable** | `daemon enable -w document` → `daemon enable -w document --disable` | enable→"Workers Enabled: 6", document ✓ idle; disable→"Workers Enabled: 5", document ○ — **stateful registry write both ways** | **DEMONSTRATED** |
| **daemon start (scheduler)** | `ruflo daemon start` | `● RUNNING (background) PID 65406`; **`map` worker auto-ran on startup (runCount:1, success:100%, "11s ago")** | **DEMONSTRATED (interval scheduler fires)** |
| **interval scheduling** | `daemon-state.json` (dumped while RUNNING) | per-worker staggered `nextRun`: audit 19:44, optimize 19:46, consolidate 19:48, testgaps 19:50 (+2min stagger); disabled workers have no nextRun | **DEMONSTRATED (real cron/interval framework)** |
| **map scheduled-run output** | `.claude-flow/metrics/codebase-map.json` | `{projectRoot:"/private/tmp/c6-up", structure:{hasPackageJson:false, hasClaudeFlow:true}, scannedAt:…}` — **real codebase introspection, not echo** | DEMONSTRATED |
| **daemon stop** | `ruflo daemon stop` | "Worker daemon stopped"; status → ○ STOPPED; `ps` → no c6 daemon process | **DEMONSTRATED (clean teardown)** |
| `CronCreate` / `ScheduleWakeup` (loop/cron skills) | not driven | Claude Code **harness** tools (not ruflo runtime); would persist a cron past the proof window | NOT-DEMONSTRATED (scope; harness surface — see ledger) |

**loop-workers is the C6 backbone and is fully functional upstream.** The 5 `hooks_worker-*` MCP tools match the manifest exactly: `worker-list` returns the real 12-worker registry; `worker-detect` does genuine keyword→trigger classification and **discriminates both directions** (4/4 task-prompts detected the right trigger; the benign "coffee/weather" prompt correctly returned `detected:false`); `worker-dispatch` without a daemon honestly self-discloses `no-daemon`; `worker-status` tracks the dispatched record; `worker-cancel` fails loud on a bogus id. The **daemon CLI is the worker/cron FRAMEWORK**: `start` launches a background scheduler that immediately fires the `map` interval worker (real run, real `codebase-map.json` artifact) and stages staggered `nextRun` times for every enabled worker; `enable -w`/`--disable` is a stateful registry write; `stop` tears down cleanly. (Real LLM worker EXECUTION = C4's recorded evidence; C6 drove the mechanics.)

### ruflo-observability (template-over-substrate: NO MCP tool, NO `observe` CLI — agent reasoning over `memory_* observability` namespace)

**Enumerated:** command `/observe` (5 subcommands `trace`/`metrics`/`logs`/`dashboard`/`correlate`); skills `observe-trace` (`memory_search memory_list agentdb_semantic-route agentdb_context-synthesize agentdb_pattern-search Bash`), `observe-metrics` (`memory_search memory_list memory_store agentdb_pattern-search agentdb_pattern-store agentdb_semantic-route Bash`); agent `observability-engineer` (model sonnet). README claims OpenTelemetry-compatible structured logging, distributed tracing with parent-child spans, a 6-metric catalog (`agent_task_duration_seconds` histogram, `agent_token_usage` counter…), a trace-tree shape, and a CLI block (`observe trace/metrics/logs/dashboard/correlate`). Owns the `observability` namespace via `memory_*`.

| Feature | Drive | Result | Verdict |
|---|---|---|---|
| **span store (root)** | `memory_store{key:"span-T1-root", value:<span json>, namespace:"observability"}` | `{success:true, stored:true, hasEmbedding:true, embeddingDimensions:384, backend:"sql.js + HNSW"}` | **DEMONSTRATED** |
| span store (child + error) | `memory_store` span-T1-coder (parentSpanId:span-root), span-T1-test (status:ERROR, error:"AssertionError…") | both `stored:true` 384-d | DEMONSTRATED |
| metric snapshot store | `memory_store{key:"metric-T1-duration", value:{type:"histogram",p50:2.8,p95:3.2,p99:3.2,count:3}}` | `stored:true` | DEMONSTRATED |
| log entry store | `memory_store{key:"log-T1-error", value:{level:"error",correlationId,spanId,traceId}}` | `stored:true` | DEMONSTRATED |
| **consumer: list (observe trace)** | `memory_list{namespace:"observability"}` | all 5 entries w/ `hasEmbedding:true` + sizes (span 264B, log 201B, metric 138B) | **DEMONSTRATED** |
| **consumer: search (observe correlate, content not echo)** | `memory_search{query:"error auth test tester-1", namespace:"observability"}` | `{results:[{key:"span-T1-test", value:"{spanId:span-test, traceId:trace-T1, parentSpanId…", similarity:0.384}, {key:"log-T1-error", value:"{level:error…", similarity:0.380}], total:2}` — **surfaces the error span + error log by content** | **DEMONSTRATED** |
| consumer: search (negative) | `memory_search{query:"completely unrelated quantum widget"}` | `{results:[], total:0}` — **discriminates** | DEMONSTRATED |
| search (threshold caveat) | `memory_search{query:"trace spans for task T1"}` | `{results:[], total:0}` — generic phrase fell below the 0.7 default threshold; records ARE durable (list + keyword search reach them) | DEMONSTRATED-HONEST (threshold caveat, C4/C5 W4) |
| **content dump (NOT counter-echo)** | SQLite `content` column, observability ns | `span-T1-test => {…"status":"ERROR","error":"AssertionError: expected 200 got 500"}`; `metric-T1-duration => {…p50,p95,p99,count:3}`; spans carry `parentSpanId`/`duration_ms`/`status` | **DEMONSTRATED (real fields, not a single telemetry counter)** |
| `observe` CLI subcommands (trace/metrics/logs/dashboard/correlate) | `ruflo observe --help` | `[ERROR] Unknown command: observe` — **NO `observe` CLI exists** | **DOC-DRIFT** (README CLI block is agent-prompt, not a runtime CLI; substrate proven via memory_*) |
| auto-instrumentation / live exporter (the 6-metric catalog as emitted telemetry) | not present | there is no runtime that auto-emits spans/metrics; the agent AUTHORS them as memory records | DOC-DRIFT (the catalog is a schema/model, not a live exporter — see mechanism) |

**observability's SUBSTRATE is real; its surface is a template over `memory_*` with no runtime of its own.** The `observability` namespace stores full structured span/metric/log content (parent-child span refs, histogram percentiles, error strings) with 384-d embeddings, and `memory_list`/`memory_search` read them back as **real content** — the error-span and error-log surface for a content query (sim ~0.38) while an unrelated query returns 0. This is **content, not counter-echo** (the spans carry the parentSpanId/duration_ms/status fields the agent needs to build the trace tree, NOT a single echoed counter). BUT: there is **no `observe` CLI** (`Unknown command`) and **no auto-instrumentation runtime** — the README's CLI block and 6-metric catalog describe what the `observe-trace`/`observe-metrics` SKILLS instruct the agent to produce and consume; the agent authors spans as memory records and reasons over them (trace-tree building, percentile aggregation, Z-score anomaly flags are all agent logic). This is the same template-over-proven-substrate shape as C4's SPARC, with the addition that the README's CLI examples are doc-drift (they read like a real CLI but aren't).

### ruflo-cost-tracker (script-backed: `scripts/*.mjs`; NO `ruflo cost` CLI) + `memory_* cost-tracking` + `hooks_model-*` consumers

**Enumerated:** command `/ruflo-cost` (15 `cost …` subcommands documented); skills (14): `cost-track` (`scripts/track.mjs` + `memory_store`), `cost-report`, `cost-optimize` (`scripts/outcome.mjs` + `hooks_model-outcome`), `cost-budget-check` (`scripts/budget.mjs`), `cost-booster-route` (`hooks_route`), `cost-booster-edit` (`scripts/bench.mjs`), `cost-benchmark` (`scripts/bench.mjs`), `cost-trend` (`scripts/trend.mjs`), `cost-conversation` (`scripts/conversation.mjs`), `cost-export` (`scripts/export.mjs`), `cost-federation` (`scripts/federation.mjs`), `cost-summary` (`scripts/summary.mjs`), `cost-compact-context` (`scripts/compact.mjs`); agent `cost-analyst` (model haiku). Owns `cost-tracking` + `cost-patterns` namespaces. **NO `ruflo cost` CLI (`Unknown command: cost`)** — the "15 subcommands" are skill prompts that shell `node scripts/X.mjs`.

| Feature | Drive | Result | Verdict |
|---|---|---|---|
| **cost-track (producer)** | `node scripts/track.mjs` (TRACK_CWD → synthetic session jsonl) | per-model table: opus 1msg $0.315000, sonnet $0.035100, haiku $0.000585; **Total $0.350685**; per-tier breakdown; `Persisted: cost-tracking:session-synthetic-1` — **math correct vs REFERENCE.md pricing** | **DEMONSTRATED (real parse + USD attribution + store)** |
| **budget set** | `node scripts/budget.mjs set 5.00` | `✓ Budget set: $5.00 (key: budget-config)` + alert ladder 50/75/90/100% | **DEMONSTRATED (persists)** |
| **budget get** | `node scripts/budget.mjs get` | `Budget: $5.00 (set …)` — **read back** | DEMONSTRATED |
| **budget check (consumer of track)** | `node scripts/budget.mjs check` | `{Budget:$5.00, Spent:$0.35, Remaining:$4.65, Utilization:7.0%, Sessions counted:1, Alert:🟢 OK}` — **reads the tracked $0.35 + the $5 config; cross-script state flow** | **DEMONSTRATED (real producer→consumer)** |
| **summary (json contract)** | `node scripts/summary.mjs --format json` | full contract: byModel (opus cost_usd:0.315…), topSession ($0.350685), budget {utilization:0.070137, level:"OK"}, federation {eventCount:0, peerCount:0} | **DEMONSTRATED** |
| **export (prometheus)** | `node scripts/export.mjs --prometheus cost-metrics.prom` | real exposition: `cost_tracker_total_usd 0.350685`, per-tier gauges, `cost_tracker_budget_usd 5.00`, `cost_tracker_budget_utilization 0.070137` | **DEMONSTRATED (external observability output)** |
| **trend (drift curve)** | `node scripts/trend.mjs` | parsed all 8 bundled bench runs: win rate 100%, avg latency 0.58→0.36ms, Sonnet/Opus baseline latencies 1072–1563ms in LLM runs — **real curve, not gate-binary** | **DEMONSTRATED** |
| **federation (Phase 3 consumer)** | `node scripts/federation.mjs` | `Events:0 · Peers:0` + "Phase 3 of ADR-097 is not yet emitting… will activate the moment upstream publishes events" | **DEMONSTRATED-HONEST** (consumer wired; upstream emits nothing yet) |
| **hooks_model-route (router)** | `hooks_model-route{task:"fix a one-line typo in a comment"}` | `{model:"sonnet", complexity:0.128, costMultiplier:0.2, implementation:"tiny-dancer-neural", alternatives:[haiku 0.743, opus 0.193]}` | **DEMONSTRATED** |
| hooks_model-route (hard) | `{task:"design a distributed consensus protocol with Byzantine fault tolerance…"}` | `{model:"opus", complexity:0.428, reasoning:"High-complexity indicators: design, distributed", costMultiplier:1}` — **discriminates by complexity** | DEMONSTRATED |
| **hooks_model-outcome (feedback)** | `hooks_model-outcome{task:"fix typo",model:"haiku",outcome:"success"}` | `{recorded:true, …}` → persisted to `.swarm/model-router-state.json` (`learningHistory:[{task,model,complexity,outcome}]`, Beta priors per bucket, version:2) | **DEMONSTRATED (real learning persistence)** |
| **hooks_model-stats** | `hooks_model-stats{}` | `{totalDecisions:2, modelDistribution:{sonnet:1,opus:1}, avgComplexity:0.278, circuitBreakerTrips:0}` — **content-accurate per-decision accounting** | DEMONSTRATED |
| `ruflo cost …` CLI (15 subcommands per README) | `ruflo cost --help` | `[ERROR] Unknown command: cost` — **NO `ruflo cost` CLI** | **DOC-DRIFT** (the subcommands are skill prompts shelling `scripts/*.mjs`; the scripts ARE real) |
| `cost-benchmark --llm`/`--anthropic` (paid baselines) | not driven | costs real money per invocation (Gemini/Sonnet/Opus baselines); booster-only path is the CI gate | NOT-DEMONSTRATED (cost-safety; the script + booster path exist — see ledger) |

**cost-tracker is genuinely script-backed and the full producer→consumer→export chain is real.** `track.mjs` parses a Claude Code session jsonl, computes correct per-model/per-tier USD (verified: opus 2000in×$15/M + 1200out×$75/M + 8000cw×$18.75/M + 30000cr×$1.50/M = $0.315 ✓), and persists to `cost-tracking`. `budget.mjs check` then reads BOTH the tracked spend AND the budget-config back and computes 7.0% utilization / OK alert — a true cross-script state flow. `summary.mjs` emits the stable JSON contract; `export.mjs` emits real Prometheus exposition; `trend.mjs` computes a drift curve over the 8 bundled bench runs. The router consumers (`hooks_model-route`/`-outcome`/`-stats`) are the real `tiny-dancer-neural` complexity classifier with durable Bayesian learning (`model-router-state.json`). The only gaps are doc-drift (no `ruflo cost` CLI — the "15 subcommands" are skill prompts) and honest-deferral (`federation` Phase 3 emits nothing upstream; `--llm`/`--anthropic` baselines are cost-gated). **Manifest version is 0.16.1, not 0.2.0** — the cost-tracker is materially more built-out than its sibling C6 plugins.

### ruflo-browser (tool-backed lifecycle 5 `browser_session_*` + conditionally-registered 23 `browser_*`; handlers shell ruvector@0.2.25 + agent-browser)

**Enumerated:** command `/ruflo-browser` (verb dispatcher: ls/show/replay/export/fork/purge/doctor); skills (9): `browser-record`, `browser-replay`, `browser-extract`, `browser-login`, `browser-form-fill`, `browser-screenshot-diff`, `browser-auth-flow`, `browser-test`, `browser-scrape` (deprecation shim); agent `browser-agent`. README claims **23 `mcp__claude-flow__browser_*` interaction tools + 5 new `browser_session_*` lifecycle tools**, 4 AgentDB namespaces (`browser-sessions`/`-selectors`/`-templates`/`-cookies`), AIDefence 3-gate pattern, RVF cognitive containers (manifest+trajectory+screenshots+cookies+findings), Ed25519-signed trajectories. **Live registry has the 5 `browser_session_*` lifecycle tools; the 23 interaction tools are conditionally registered (gated on `agent-browser` — ABSENT from this registry).**

| Feature | Drive | Result | Verdict |
|---|---|---|---|
| **lifecycle tools present** | `tools/list` | `browser_session_record`, `browser_session_end`, `browser_session_replay`, `browser_template_apply`, `browser_cookie_use` — **exact 5** | DEMONSTRATED (registry) |
| **23 interaction tools** | `tools/list` (no `agent-browser` on PATH) | **ABSENT** — `getBrowserTools()` returns `[]` when `agent-browser --version` exec fails (`#1605` gate) | DEMONSTRATED-HONEST (conditional registration, self-disclosed in code) |
| **browser_session_record — step 1 (rvf create)** | `browser_session_record{url:"file:///tmp/c6-up/pages/login.html", task:"…", session:"c6sess1"}` | **rvf container CREATED** (`.ruflo/browser-sessions/c6sess1.rvf`, 162B, `SFVR` magic header) — step 1 succeeds | DEMONSTRATED (RVF allocate works) |
| **browser_session_record — step 2 (trajectory-begin)** | (same call) | **`{success:false, error:"trajectory-begin failed", detail:"…ruvector@0.2.25 hooks trajectory-begin --session-id c6sess1 --task …\nerror: required option '-c, --context <context>' not specified"}`** | **UPSTREAM-BROKEN** (full bar below) |
| browser_session_end | (unreachable — record failed, no sessionId/rvfPath produced) | not invoked | NOT-REACHED (downstream of the broken record) |
| browser_session_replay | (unreachable) | not invoked | NOT-REACHED |
| **browser_template_apply (negative)** | `browser_template_apply{name:"nonexistent-template"}` | `{success:false, error:"template fetch failed"}` (memory retrieve of an absent key) | DEMONSTRATED-HONEST (correct miss) |
| **browser_cookie_use (negative)** | `browser_cookie_use{host:"localhost"}` | `{success:false, error:"cookie lookup failed"}` (absent key) | DEMONSTRATED-HONEST (correct miss) |
| 4 AgentDB namespaces (`browser-sessions`/`-selectors`/`-templates`/`-cookies`) | (substrate is `memory_*`, proven in C2/C4/C5) | namespace routing proven generically; no browser rows because record never completed | DEMONSTRATED (substrate) / NOT-POPULATED (record broken) |
| replay-spike (≥80% replay-fidelity, the pre-Accept gate) | not driven | requires record→replay which is broken upstream; ADR-0001 is `Proposed` not `Accepted` | NOT-DEMONSTRATED (blocked by the record defect; see ledger) |

**browser's lifecycle layer is registered and partially functional, but `browser_session_record` is UPSTREAM-BROKEN by a ruvector argument-contract skew — and it blocks the entire record→end→replay flow.** The 5 `browser_session_*` tools register unconditionally (correct); the 23 interaction tools register only when `agent-browser` is present (the `#1605` `_browserAvailable` gate — honest conditional registration, NOT a defect; absent here because `agent-browser` is not a bare-PATH binary). Inside `browser_session_record`, step 1 (`ruvector rvf create --dimension 384`) **succeeds** (real 162-byte `.rvf` container written), but step 2 (`ruvector hooks trajectory-begin --session-id <id> --task <task>`) **fails immediately** — and the failure is a **stale CLI contract**: ruvector@0.2.25's `trajectory-begin` requires `-c/--context` AND rejects `--session-id`/`--task` (`error: unknown option '--session-id'`). The SAME skew affects `trajectory-step` (handler passes `--session-id/--action/--args/--result`; ruvector accepts only `-a/--action`, `-r/--result`, `--reward`) and `trajectory-end` (handler passes `--session-id/--verdict`; ruvector accepts only `--success`, `--quality`). So **all three ruvector trajectory calls in the browser handlers use an argument shape that ruvector@0.2.25 does not expose** — the dist handler was written against a different ruvector trajectory CLI than the pinned version ships. This is the **same mistake CLASS as C1's ruvllm WASM `initSync` version-skew and the Issue #2015 `rvf create --kind` bug** (the code comment shows `rvf create` was already patched for this; the trajectory calls were not).

---

## Mechanism map (process → trigger → store → consumer)

C6 surfaces span FOUR substrate classes. Write artifacts observed across batteries (final tree `treediffs/c6-tree-final.txt`):

```
# loop-workers (CLI daemon framework):
.claude-flow/daemon-state.json        <- worker run-accounting + per-worker nextRun schedule
.claude-flow/metrics/codebase-map.json <- map worker scheduled-run output (real introspection)
# observability (template over memory_*):
.swarm/memory.db (ns=observability)   <- spans/metrics/logs as memory records (384-d), agent authors + reads
# cost-tracker (scripts + memory_*):
.swarm/memory.db (ns=cost-tracking)   <- session records + budget-config (track→budget producer/consumer)
.swarm/model-router-state.json        <- hooks_model-* Bayesian learning (learningHistory + Beta priors)
cost-metrics.prom                     <- export.mjs Prometheus textfile
# browser (lifecycle tools shell ruvector + agent-browser + bridged memory):
.ruflo/browser-sessions/<id>.rvf      <- rvf create (step 1) — SUCCEEDS; trajectory-begin (step 2) FAILS
```

| Surface | Process | Trigger | Store | Consumer (read-back) |
|---|---|---|---|---|
| `hooks_worker-list`/`-detect`/`-status`/`-cancel` | MCP server (in-process worker registry) | MCP call | in-process registry (dispatch records) | the registry/detection envelope |
| `hooks_worker-dispatch` (no daemon) | MCP server | MCP call | in-process record only (`status:"no-daemon"`) | `worker-status` (same process); real run needs the daemon |
| **worker/cron framework** | **`worker-daemon.js`** (background Node scheduler) | `daemon start` | `.claude-flow/daemon-state.json` (runCount/successCount/nextRun) + `.claude-flow/metrics/*.json` | `daemon status`; the metrics artifacts; the interval scheduler re-fires |
| `daemon enable -w` / `--disable` | one-shot `node` (config write) | `daemon enable` | daemon config (enabled-worker set) | `daemon status` (Workers Enabled count) |
| observability spans/metrics/logs | MCP server (`memory_*`); **agent authors the records** (no runtime emitter) | `memory_store --namespace observability` (per observe-trace/metrics skills) | `.swarm/memory.db memory_entries` (ns=observability, 384-d) | `memory_list`/`memory_search`; the agent builds the trace tree + percentiles |
| `observe trace/metrics/…` (CLI per README) | **does not exist** | `ruflo observe` → `Unknown command` | n/a | n/a (DOC-DRIFT; the skills are the real surface) |
| cost `track.mjs` (producer) | one-shot `node` | `/cost-track` (shells the script) | `.swarm/memory.db` (ns=cost-tracking, key=`session-<id>`) via bridged `memory store` | `budget.mjs`/`summary.mjs`/`export.mjs`/`conversation.mjs` |
| cost `budget.mjs` | one-shot `node` | `/cost-budget-check` | `cost-tracking:budget-config` | `budget get/check`, `summary.mjs` |
| cost `summary`/`export`/`trend`/`federation` | one-shot `node` | the respective skill | reads cost-tracking ns + bundled bench runs; export writes `.prom`/webhook | external (Prometheus/webhook) or stdout JSON |
| `hooks_model-route`/`-outcome`/`-stats` | MCP server (`tiny-dancer-neural`) | MCP call | `.swarm/model-router-state.json` (Beta priors, learningHistory) | `model-stats`; the router's next decision |
| browser `browser_session_*` | MCP server handlers → shell `ruvector@0.2.25` + `agent-browser` + bridged `memory` | MCP call | `.ruflo/browser-sessions/<id>.rvf` (step 1 OK) + `browser-sessions` ns (only if end succeeds) | `browser_session_replay`/`/ruflo-browser ls` — **blocked: trajectory-begin arg-skew** |
| browser 23 interaction tools | MCP server, registered **only if `agent-browser` present** (`#1605` `_browserAvailable`) | MCP call | per-tool (DOM/screenshot) | the caller; absent on this env |

### Five most important mechanism findings (worker/cron framework + observability content-vs-counters focus)

1. **The worker/cron FRAMEWORK (loop-workers) is genuinely real and is the C6 backbone — the daemon's interval scheduler fires on startup and stages a staggered cron.** `daemon start` launches a background Node scheduler that **immediately ran the `map` worker** (`daemon-state.json runCount:1, successCount:1`, producing a real `codebase-map.json` that introspected the project) and staged staggered `nextRun` times for every enabled worker (audit +2min, optimize +4min, consolidate +6min, testgaps +8min). The 5 `hooks_worker-*` MCP tools match the manifest exactly and `worker-detect` **discriminates both directions** (right trigger for 4/4 task prompts; `detected:false` for benign chatter). `worker-dispatch` without a daemon honestly self-discloses `no-daemon`; `worker-cancel` fails loud on a bad id. (Real LLM worker EXECUTION is C4's recorded evidence — C6 owns and proved the dispatch/detect/status/cancel + scheduling/registry mechanics.)

2. **observability carries REAL CONTENT (not counter-echo) — but it is a template over `memory_*` with NO runtime of its own.** The `observability` namespace stores full span/metric/log records — `parentSpanId`, `duration_ms`, `status:"ERROR"`, `error:"AssertionError…"`, histogram `p50/p95/p99/count` — with 384-d embeddings, and a content query (`"error auth test tester-1"`) surfaces the error span + error log (sim ~0.38) while an unrelated query returns 0. This is the **opposite of the G5-class counter-echo the bar warns against**: the spans bind to real per-event fields the agent uses to build the trace tree, not a single echoed telemetry number. The crucial mechanism caveat: there is **NO `observe` CLI** (`Unknown command: observe`) and **NO auto-instrumentation/exporter** — the agent (per the `observe-trace`/`observe-metrics` skills) AUTHORS spans as memory records and reasons over them; the README's CLI block and 6-metric catalog are the schema/instructions, not a live runtime (DOC-DRIFT on the CLI examples).

3. **cost-tracker's producer→consumer→export chain is real and stateful end-to-end — and it is script-backed, NOT CLI-backed.** `track.mjs` parses a session jsonl into correct per-model/per-tier USD ($0.350685 total, math verified against REFERENCE.md pricing) and persists it; `budget.mjs check` then reads BOTH that spend AND the persisted budget-config back to compute 7.0% utilization / OK — a true cross-script state flow. `summary.mjs` (JSON contract), `export.mjs` (real Prometheus exposition), and `trend.mjs` (drift curve over 8 bundled runs) all consume the same store. There is **NO `ruflo cost` CLI** (`Unknown command: cost`) — the README's "15 subcommands" are skill prompts that shell `node scripts/*.mjs`; the scripts are the runtime. The router consumers (`hooks_model-route/-outcome/-stats`) are the `tiny-dancer-neural` complexity classifier with durable Bayesian learning. (Manifest version 0.16.1 — materially more built-out than its C6 siblings.)

4. **browser `browser_session_record` is UPSTREAM-BROKEN by a ruvector trajectory argument-contract skew that blocks the whole record→end→replay flow — same mistake class as C1's ruvllm WASM skew.** Step 1 (`ruvector rvf create --dimension 384`) succeeds (real `.rvf` container written), but step 2 (`ruvector hooks trajectory-begin --session-id <id> --task <task>`) fails: ruvector@0.2.25's `trajectory-begin` **requires `-c/--context`** and **rejects `--session-id`/`--task`** (`unknown option '--session-id'`). The same skew hits `trajectory-step` and `trajectory-end` (the handler's `--session-id/--action/--args/--result` and `--session-id/--verdict` shapes don't match ruvector@0.2.25's `-a/-r/--reward` and `--success/--quality`). The dist handler was written against a different ruvector trajectory CLI than the pinned version exposes — and the in-code Issue #2015 comment proves the `rvf create` call was already patched for exactly this class while the three trajectory calls were missed. This is a real defect (full 5-point bar + named root cause), distinct from the honest `_browserAvailable` gate.

5. **Browser interaction tools (23) are honestly CONDITIONALLY registered — absence on this env is by-design, not a defect.** `mcp-client.js` `getBrowserTools()` execs `agent-browser --version` (3s timeout) and returns `browserTools` only if it succeeds (`#1605` comment: "Only register browser tools if agent-browser is available"); otherwise `[]`. The 5 `browser_session_*` lifecycle tools always register and degrade gracefully (structured `success:false`, as the README promises). On the fresh env `agent-browser` is not a bare-PATH binary (it resolves only via `npx`, v0.27.1), so the gate returns `[]` and only the 5 lifecycle tools showed — exactly the observed registry. This is the SAME honest-conditional-registration pattern as C3's hive-mind/wasm marketplace-absence — a deployment/availability gate, NOT a runtime defect (and distinct from finding 4, which IS a defect).

---

## NOT-DEMONSTRATED / DOC-DRIFT / UPSTREAM-BROKEN ledger (with bar points)

One feature met the `UPSTREAM-BROKEN` threshold (full 5-point bar AND named root-cause mechanism). The rest are scope/safety judgment calls, honest capability-absence, conditional-registration, or upstream-plugin doc-vs-runtime drift.

| Item | Status | Why | Bar points satisfied |
|---|---|---|---|
| **browser `browser_session_record` (and the record→end→replay flow it gates)** | **UPSTREAM-BROKEN** | step-1 `rvf create` succeeds, but step-2 `ruvector hooks trajectory-begin --session-id … --task …` fails: ruvector@0.2.25 **requires `-c/--context`** and **rejects `--session-id`/`--task`**. Same skew on `trajectory-step` (`-a/-r/--reward`) + `trajectory-end` (`--success/--quality`). Handler written against a stale ruvector trajectory CLI | (1) driven in prod MCP shape (file:// local) · (2) `ruvector … trajectory-begin --help` checked · (3) complete structured `success:false` envelope w/ the exact failing command + stderr · (4) installed-dist `ruvector@0.2.25 --help` confirms the required `-c/--context` + rejects `--session-id`; CLI dist `browser-session-tools.js` shows the handler's stale arg shape (and the Issue #2015 comment proving the same class was patched for `rvf create`) · (5) the `.rvf` container WAS created (step-1 isolates the failure to trajectory-begin) — root cause NAMED |
| browser 23 `browser_*` interaction tools (absent from live registry) | **DEMONSTRATED-HONEST** (conditional registration) | `getBrowserTools()` returns `[]` unless `agent-browser --version` execs OK (`#1605` gate); `agent-browser` is not a bare-PATH binary here (resolves via npx only). The 5 lifecycle tools always register | (1) live `tools/list` enumerated · (2) gate logic read · (4) `mcp-client.js:54-65` shows the `_browserAvailable` gate; `browser-tools.js` defines all 23 (registered only when available) — by-design, NOT a defect |
| browser `replay-spike` (≥80% replay-fidelity, ADR-0001 pre-Accept gate) | NOT-DEMONSTRATED | requires a working record→replay, which is blocked by the trajectory-begin defect above; ADR-0001 is explicitly `Proposed`, the spike is the gate to flip it to `Accepted` | (1) record driven (failed at step 2) · the spike is downstream of the record defect; not separately driveable upstream |
| `observe` CLI subcommands (trace/metrics/logs/dashboard/correlate — README CLI block) | **DOC-DRIFT** | `ruflo observe --help` → `Unknown command: observe`. The `observe-trace`/`observe-metrics` SKILLS (agent reasoning over `memory_* observability`) are the real surface; the substrate is proven | (1) `observe --help` driven · (2) the skills' `memory_*` path IS the documented alternative · (4) no `observe` command in the CLI dist; the namespace store/recall works |
| observability auto-instrumentation / live metric exporter (the 6-metric catalog as emitted telemetry) | **DOC-DRIFT** | no runtime emits spans/metrics; the agent authors them as memory records per the skills. The catalog is a schema/model | (2) the memory_* substrate the skills use is proven · (4) no exporter/instrumentation in the CLI dist; the README catalog describes intended record shapes |
| `ruflo cost …` CLI (15 subcommands per README) | **DOC-DRIFT** | `ruflo cost --help` → `Unknown command: cost`. The subcommands are skill prompts that shell `node scripts/*.mjs`; the scripts ARE real and proven | (1) `cost --help` driven · (2) the scripts are the documented mechanism (skills reference `scripts/X.mjs`) · (4) no `cost` command in the CLI dist; the `.mjs` scripts work |
| cost `--llm`/`--anthropic` benchmark baselines (Gemini/Sonnet/Opus) | NOT-DEMONSTRATED | each invocation costs real money (per README + CI note); the booster-only path is the CI gate. The script + booster path exist | (1) the booster-only `trend.mjs` over bundled runs is proven · cost-safety opt-out (legit skip per the heavy-test-opt-out precedent) |
| cost `federation` Phase 3 (per-peer rolling windows) | DEMONSTRATED-HONEST | `federation.mjs` reads the `federation-spend` ns (empty) and self-discloses "Phase 3 not yet emitting"; consumer wiring present, upstream emits nothing | (1) driven in prod shape · (2) the empty-graceful path IS the documented behaviour · (4) upstream ADR-097 Phase 3 unlanded (cross-ref C5 federation) |
| loop-workers `CronCreate`/`ScheduleWakeup` (loop/cron skills) | NOT-DEMONSTRATED | Claude Code **harness** tools, not ruflo runtime; would persist a cron past the proof window (forbidden by C6 safety rules). The worker the cron would dispatch IS proven (daemon framework) | (1) skill `allowed-tools` lists them; the dispatch target proven via daemon · (4) `CronCreate` is a harness surface, not a ruflo CLI/MCP tool |

These satisfy "production shape + documented behaviour + installed-dist presence." Only `browser_session_record` met the `UPSTREAM-BROKEN` threshold (full bar + named root cause); the rest are honest conditional-registration, honest-deferral, cost/scope safety opt-outs, or upstream-plugin doc-vs-runtime drift.

---

## Environment record (exact)

| Component | Version / path |
|---|---|
| ruflo | 3.10.36 — `/Users/henrik/.npm/_npx/2ed56890c96f58f7/node_modules/ruflo` (bin `ruflo/bin/ruflo.js`) |
| @claude-flow/cli | 3.10.36 — `…/2ed56890c96f58f7/node_modules/@claude-flow/cli/dist/src/` |
| MCP serverInfo | `ruflo 3.0.0`; 293 tools live |
| Node | v24.14.1, darwin arm64 |
| Embedding model | `Xenova/all-MiniLM-L6-v2`, 384-d, ONNX SIMD |
| Memory backend (live) | `sql.js + HNSW` (WASM SQLite); `.swarm/memory.db` |
| Worker daemon | `worker-daemon.js` (Node, non-headless); interval scheduler + run-accounting; clean start→stop |
| Browser substrate | `agent-browser 0.27.1` (npx-only, not bare PATH → `_browserAvailable` gate `[]`); `ruvector@0.2.25` (trajectory/RVF — **trajectory CLI arg-skew vs handler**); `ms-playwright` chromium cache present |
| Upstream plugin spec (4) | `~/.claude/plugins/marketplaces/ruflo/plugins/` — loop-workers 0.2.0, observability 0.2.0, **cost-tracker 0.16.1**, browser 0.2.0 (all 4 in marketplace.json) |
| Smoke contracts (structural) | loop-workers 12/0, observability 10/0, **cost-tracker 49/0** (README says 44; the dist smoke is 49), browser 13/0 — all green (structural; runtime proven separately) |
| Reference root | `/tmp/ruflo-fresh` (REUSED, intact) |
| Clean drive sub-project | `/tmp/c6-up` (synthetic session jsonl + span/metric/log records + 2 local file:// pages + 1 rvf container) |
| Registry / cache | public npm + `/tmp/ruflo-fresh/.npm-cache` |
| Process cleanup | c6 daemon started+STOPPED (verified ○ STOPPED + `ps` clean); all MCP `mcp start` drivers terminated; planted `~/.claude/projects/-tmp-c6-costproj` REMOVED; **zero browser/chromium processes spawned by me** (record failed at step-2 trajectory-begin BEFORE the agent-browser step — verified all live Chrome/agent-browser procs predate my session by hours/days → sibling/harness, untouched); live patch daemon + sibling `/tmp` envs untouched |

## Evidence index (`/tmp/c6-evidence/upstream/`)

| File | Contents |
|---|---|
| `logs/tools-list-all.txt` | live 293-tool list + C6 families (worker 5, browser_session_* 5, observe 0, cost 0, model/coverage present) + serverInfo |
| `logs/schemas-c6.json` | live `inputSchema` for worker/browser_session/model/coverage families (arg names used in drives) |
| `up-workers.jsonl` | loop-workers MCP battery (list, detect ×4 incl. negative, dispatch no-daemon, status, cancel-negative) |
| `logs/cli-worker-list.txt`, `cli-worker-detect.txt` | `hooks worker` CLI form |
| `logs/daemon-help.txt`, `daemon-enable-help.txt` | daemon CLI subcommand + flag surface |
| `logs/daemon-status-before.txt` | daemon STOPPED, 7-worker registry (5 enabled / 2 disabled) |
| `logs/daemon-enable-document.txt`, `daemon-disable-document.txt` | worker enable→disable registry write (Workers Enabled 5→6→5) |
| `logs/daemon-start.txt`, `daemon-status-running.txt` | daemon START (RUNNING, PID, map auto-ran 11s ago) |
| `logs/daemon-stop.txt` | daemon STOP (clean teardown → ○ STOPPED) |
| `up-observability.jsonl` | observability substrate (5 stores: spans+metric+log; list + 3 searches incl. negative + threshold-caveat) |
| `dumps/observability-content.txt` | SQLite content dump — real span fields (parentSpanId/duration_ms/status:ERROR/error string), histogram p50/p95/p99 (NOT counter-echo) |
| `logs/observe-help.txt` | `ruflo observe --help` → `Unknown command: observe` (DOC-DRIFT proof) |
| `logs/cost-track2.txt` | `track.mjs` real per-model/per-tier USD ($0.350685) + persist |
| `logs/cost-budget-set.txt`, `cost-budget-get.txt`, `cost-budget-check.txt` | budget set→get→check (7.0% util, OK; cross-script state) |
| `logs/cost-summary.txt`, `cost-export.txt`, `cost-trend.txt`, `cost-federation.txt` | summary JSON contract; Prometheus exposition; 8-run drift curve; federation honest-empty |
| `dumps/cost-tracking-content.txt` | SQLite — session record + budget-config |
| `logs/cost-help.txt` | `ruflo cost --help` → `Unknown command: cost` (DOC-DRIFT proof) |
| `up-router.jsonl` | `hooks_model-route` (simple→sonnet, hard→opus), `model-outcome`, `model-stats`; `worker-detect` autoDispatch |
| `up-browser.jsonl` | browser lifecycle battery (session_record FAIL@trajectory-begin, template_apply/cookie_use honest-miss) |
| `logs/browser-stderr.txt` | npx/agent-browser noise from the browser drive |
| `treediffs/c6-tree-final.txt` | final c6-up tree (daemon-state, codebase-map, memory.db, model-router-state, .prom, c6sess1.rvf, local pages) |
| `logs/smoke-ruflo-{loop-workers,observability,cost-tracker,browser}.txt` | the 4 plugin smoke contracts (12/10/49/13 passed, 0 failed) |

## Open questions for fork-auditor / devil's advocate

1. **[TOP] browser `browser_session_record` ruvector trajectory arg-skew — does the fork fix it, and is the fork's ruvector pin different?** Upstream's `browser-session-tools.js` calls `ruvector@0.2.25 hooks trajectory-begin --session-id … --task …` but ruvector@0.2.25 requires `-c/--context` and rejects `--session-id`/`--task` (same skew on `trajectory-step` `-a/-r/--reward` and `trajectory-end` `--success/--quality`). This is the **same CLASS as ADR-0293 D1 (ruvllm WASM initSync skew)** and the Issue #2015 `rvf create --kind` bug. Does the fork (a) pin a different ruvector (`@sparkleideas/ruvector` / a newer version whose trajectory CLI matches the handler), (b) fix the three trajectory calls to ruvector@0.2.25's actual signature, or (c) carry the identical broken handler? If the fork fixed the handler args → FORK-AHEAD that closes a real upstream defect (direction-flip, like C3's wasm_agent_create re-pin). If the fork pinned a matching ruvector → re-justify the pin. Drive `browser_session_record` against the fork with a local file:// page and a present `agent-browser`.

2. **browser 23 interaction tools — does the fork register them unconditionally (and are they in the fork's main server)?** Upstream gates the 23 `browser_*` interaction tools on `agent-browser --version` succeeding (`#1605` `_browserAvailable`). My deferred-tool list shows 23 `mcp__ruflo__browser_*` interaction tools — i.e., the FORK/cache surface DOES expose them. Does the fork remove the `_browserAvailable` gate (always-register), and if so do the handlers still degrade gracefully when `agent-browser` is genuinely absent, or do they crash? An always-registered-but-broken-when-absent surface would be a regression vs upstream's honest conditional registration.

3. **observability — does the fork add a real `observe` CLI / `observe_*` MCP tool, or an auto-instrumentation emitter?** Upstream has NO `observe` CLI (`Unknown command`) and NO runtime exporter — observability is agent reasoning over `memory_* observability`. The README's CLI block + 6-metric catalog are doc-drift/schema. Does the fork (a) wire a real `observe` CLI or `observe_*` MCP tool, (b) add an instrumentation runtime that auto-emits the catalog metrics (FORK-AHEAD), or (c) keep the agent-authored-records template (PARITY)? If the fork claims a metric exporter, verify it carries real per-event content, not a counter-echo (the C6 content-vs-counter axis).

4. **cost-tracker — is there a fork `ruflo cost` CLI, and is the version skew material?** Upstream cost-tracker is 0.16.1 and script-backed (NO `ruflo cost` CLI; the 15 subcommands are skill prompts shelling `scripts/*.mjs`). Does the fork wire a real `ruflo cost` CLI subcommand (closing the doc-drift), ship a different cost-tracker version, or keep the scripts? The `hooks_model-*` router learning persists to `model-router-state.json` — confirm the fork keeps the same `tiny-dancer-neural` classifier + Beta-prior learning, not a parallel ADR-0290 episode path. (cost-tracker is the most built-out C6 plugin — divergences here carry the most merge-tax.)

5. **worker/cron framework parity (the C1 overlap).** Upstream's daemon interval scheduler fires the `map` worker on startup and stages staggered `nextRun` times; the 5 `hooks_worker-*` tools + `daemon enable/start/stop` are the framework. C6 owns the dispatch/registry/scheduling mechanics (C4 owns real testgaps/document EXECUTION). Does the fork keep the 7-worker default-enabled set (map/audit/optimize/consolidate/testgaps on; predict/document off), the same `worker-detect` keyword classifier, and the same `no-daemon`/`synthetic-completed` honest stubs on `worker-dispatch`? The fork's loop-workers also intersects C1's scheduled-learning workers (ADR-0291/ADR-0293) — confirm the worker FRAMEWORK is PARITY and any divergence is on the learning-worker payload side (C1's scope), not the framework.

6. **cost `federation` Phase 3 + `--llm` baselines (NOT exercised here).** Upstream `federation.mjs` honestly self-discloses Phase 3 emits nothing (cross-ref C5 federation `federation_spend`); the `--llm`/`--anthropic` benchmark baselines were cost-safety-skipped. If a verdict on the cost-federation data-plane or the LLM-baseline benchmark accuracy is needed, it requires (a) a federation transport + remote peer emitting `federation_spend` (C5's out-of-scope data-plane), or (b) a budgeted paid-LLM benchmark run — both out of scope for this proof. Neither side likely drove these; note as a shared coverage gap.
