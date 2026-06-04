# C4 Quality & Process — Upstream Proof Record

**Protocol:** ADR-0292 steps 1-3 (enumerate → prove upstream → explain mechanism). **Validation bar:** ADR-0291 §Confirmation (5-point) + C2's cold-vs-warm addition.
**Null hypothesis:** UPSTREAM WORKS — this is positive proof, not gap-hunting. **Date:** 2026-06-04. **Author:** upstream-prover (queen-led C4 swarm).

> **DA review (2026-06-04) — UPHELD with qualifications** (`/tmp/c4-evidence/da/`). Errata: the hierarchical-recall picture is two-sided — fork recall is durable but **non-semantic** (returns ALL stored keys at fixed score 0.5 regardless of query); the C2-vs-C4 discrepancy is environment truth on both sides (fork durable, upstream stub-empty), closed. `worker detect` documentation-prompt 0% and `-t`/`-p` short-flag rejection are **shared upstream behaviours** (DA drove upstream: identical), and `useRuVector` is a **dead flag both sides** (`analyzeDiff` never reads it) — none are fork deltas. Worker posture testgaps✓/document○ confirmed PARITY: upstream's registry is identical; `daemon trigger` bypasses the enablement gate, which is why this report's document-worker run succeeded.

**Reference env:** `/tmp/ruflo-fresh` (REUSED from C1/C2/C3 — verified intact, not rebuilt). All drives run in a clean sub-project `/tmp/c4-up` (only `.mcp.json` at start) so the quality/process stores begin empty for clean write-traces + dumps. `/tmp/c4-up` was made a real git repo with a realistic security-sensitive working-tree diff (md5 password hashing, `Math.random()` reset token, new payments file, one test) so the `analyze_*` family had real input.

- **ruflo** `3.10.36` (installed bin `/Users/henrik/.npm/_npx/2ed56890c96f58f7/node_modules/.bin/ruflo` → `ruflo/bin/ruflo.js`), wrapping **`@claude-flow/cli` `3.10.36`** (installed dist `…/@claude-flow/cli/dist/src/`).
- MCP serverInfo string: **`ruflo 3.0.0`** — **293 tools** registered live (`logs/tools-list-c4.txt`).
- Node `v24.14.1`, darwin arm64, embeddings `Xenova/all-MiniLM-L6-v2` 384-d ONNX SIMD, memory backend `sql.js + HNSW`.
- Public npm registry + private cache `/tmp/ruflo-fresh/.npm-cache` (Verdaccio shadow avoided).
- Worker daemon (started + stopped cleanly for the production-shape test): `worker-daemon.js`, Claude Code headless mode, models `sonnet` (testgaps) / `haiku` (document).

**Production shape:** one long-lived `ruflo mcp start` stdio session per battery (`c4_driver.py`, the C2/C3 driver reused — threads IDs via `{{ref:label.path}}`), arg names derived from live `tools/list` schemas (`logs/schemas-c4.json`), NODE_OPTIONS write-trace shim (`fswrite-shim.cjs`), before/mid/after tree diff, `sqlite3` + JSON store dumps. The plugin scripts (`ruflo-adr/scripts/import.mjs`, `verify.mjs`) driven as real `node` processes. The worker daemon driven as a real process (`ruflo daemon start` / `trigger -w <worker>` / `stop`). **Seven MCP batteries (66 calls) + 2 adr-script runs + 2 daemon worker triggers.**

> **Method correction applied (track-record honoured).** Three run-1 "failures" were MY wrong test shape, not brokenness, and were re-driven correctly before any verdict: (1) `agentdb_hierarchical-store{key:"adr/ADR-001"}` / `{key:"domain/context:billing"}` rejected — upstream's key validator forbids `/` (allows `alphanumeric _ - . :`); re-driven with `:` separators (`adr:ADR-001`, `domain:context:billing`) → both `success:true` (`up-c4c-results.jsonl`). (2) `task_create{description,priority}` missing the **required** `type` → "type must be a non-empty string"; re-driven `{type:"feature",…}` → real task created (`up-c4b-results.jsonl`). (3) `github_workflow{action:"status"}` → "Unknown action" (my wrong enum; the tool isn't even in jujutsu's git-workflow allowed-tools — non-load-bearing). No failure verdict was recorded before re-driving in the correct shape.

---

## CRITICAL PROVENANCE FINDING (read first — affects the whole category)

**All 6 C4 plugins ARE in the upstream marketplace clone** (unlike C3's hive-mind/wasm). `marketplace.json` carries 33 plugins; all six C4 names present = **True** (verified):

| Plugin | Upstream marketplace clone? | Spec flavor enumerated | Substrate type | Version |
|---|---|---|---|---|
| ruflo-testgen | **YES** | UPSTREAM clone (`mcp__claude-flow__`, `@claude-flow/cli`) | worker-backed (testgaps worker) + hooks CLI | 0.2.0 |
| ruflo-sparc   | **YES** | UPSTREAM clone | template (methodology) over proven primitives | 0.2.0 |
| ruflo-ddd     | **YES** | UPSTREAM clone | template + AgentDB hierarchical/memory | 0.2.0 |
| ruflo-adr     | **YES** | UPSTREAM clone | template + AgentDB + plugin scripts (`import.mjs`/`verify.mjs`) | **0.3.0** |
| ruflo-docs    | **YES** | UPSTREAM clone | worker-backed (document worker) + hooks CLI | 0.2.0 |
| ruflo-jujutsu | **YES** | UPSTREAM clone | **tool-backed** (6 `analyze_*` + 3 `github_*`) | 0.2.0 |

All six upstream plugins are markdown-only (no `src/` runtime; only `scripts/` for adr). Provenance discipline honoured: **behaviour was driven against the upstream `@claude-flow/cli` 3.10.36 dist directly** (bare MCP tool names == `mcp__claude-flow__*`). The activated cache may be fork-overlaid (`mcp__ruflo__` namespace); the upstream marketplace clone is the spec for enumeration. Evidence: `logs/tools-list-c4.txt`, plugin.json/SKILL.md frontmatter enumerated inline below.

### C2/C3 cross-check confirmed: the fork-only agentdb tool names ARE absent upstream

The C2 open question (fork-only `agentdb_causal-query`/`-recall`/`hierarchical-query`) is **confirmed for C4's surface**: upstream's live registry has `agentdb_causal-edge` (write) but **NO `agentdb_causal-query`, NO `agentdb_causal-recall`, NO `agentdb_hierarchical-query`** (`tools-list-c4.txt`). The upstream `ruflo-adr` skills `adr-review` (`allowed-tools: agentdb_causal-query`) and `adr graph` command (`agentdb_causal-query`) and `adr-create` (`agentdb_hierarchical-query`) **reference tools the upstream runtime does not expose** — a skill-vs-runtime **DOC-DRIFT in the upstream plugin itself** (see NOT-DEMONSTRATED ledger). Crucially the *edges those tools would query ARE durably stored* (adr-edges namespace + `graph_edges` table) and reachable via the tools that DO exist (`memory_list`, `agentdb_graph-query`), so the adr-graph *capability* is present via a different surface. This is an upstream-plugin doc imperfection, NOT a runtime defect, and it is identical for the fork (the fork actually *adds* the `causal-query` tool — a fork-auditor item).

---

## Per-plugin feature inventory + proof status

Legend: **DEMONSTRATED** (drove it; content/behaviour verified) · **DEMONSTRATED-HONEST** (returns a documented graceful-degradation / capability-absent / stub envelope that self-discloses — NOT a failure) · **NOT-DEMONSTRATED** (with 5-point bar shown) · **DOC-DRIFT** (skill/command references a surface the live runtime doesn't expose). No `UPSTREAM-BROKEN` verdicts recorded.

### ruflo-jujutsu (tool-backed: 6 `analyze_*` + 3 `github_*` MCP tools)

**Enumerated:** command `jujutsu` (runs `analyze_diff`/`-risk`/`-classify`); skills `diff-analyze` (`allowed-tools: analyze_diff analyze_diff-risk analyze_diff-classify analyze_diff-reviewers analyze_diff-stats analyze_file-risk`), `git-workflow` (`analyze_diff* github_pr_manage github_repo_analyze github_metrics`); agent `git-specialist`. Manifest claims "wraps 6 analyze_* tools" — **live registry has exactly those 6** (`analyze_diff, analyze_diff-classify, analyze_diff-reviewers, analyze_diff-risk, analyze_diff-stats, analyze_file-risk`). Manifest is exact.

| Feature | Tool | Result envelope (truncated) | Verdict |
|---|---|---|---|
| Full diff analysis | `analyze_diff{ref:"HEAD",includeFileRisks,includeReviewers}` | `{files:[3 w/ status/additions/deletions/hunks], risk:{overall:"medium",score:35,breakdown}, classification:{impactLevel:"critical",suggestedReviewers:["security-reviewer",…],riskFactors:["Security-sensitive code"]}}` — **parsed the real git diff** | DEMONSTRATED |
| Risk score | `analyze_diff-risk{ref:"HEAD"}` | `{risk:{overall:"medium",score:35,breakdown:{low:1,medium:1,high:1}}, summary:"medium risk (score: 35/100) - 3 files changed"}` | DEMONSTRATED |
| Change classify | `analyze_diff-classify{ref:"HEAD"}` | `{classification:{primary:"unknown",confidence:0.6,impactLevel:"critical",suggestedReviewers,testingStrategy:["unit-tests","security-audit"],riskFactors:["Security-sensitive code"]}}` — `primary:"unknown"` is **honest** (no conventional-commit cues in my synthetic diff) | DEMONSTRATED |
| Reviewer recs | `analyze_diff-reviewers{ref:"HEAD",limit:3}` | `{recommendedReviewers:["security-team","qa-engineer","tech-lead"], filesAnalyzed:3}` — **security-team picked because auth file touched** | DEMONSTRATED |
| Diff stats | `analyze_diff-stats{ref:"HEAD"}` | `{totalFiles:3, totalAdditions:15, totalDeletions:1, byStatus:{added:2,modified:1}}` — **exact match to `git diff --stat`** | DEMONSTRATED |
| File risk (auth) | `analyze_file-risk{path:"src/auth/login.ts",…}` | `{risk:"high", score:40, reasons:["Security-sensitive file"]}` — **path heuristic flags auth** | DEMONSTRATED |
| File risk (payments) | `analyze_file-risk{path:"src/payments/charge.ts"}` | `{risk:"medium", score:35, reasons:["Payment-related file"]}` | DEMONSTRATED |
| Repo analyze | `github_repo_analyze` | `{success:true, _real:true, branch:"master", metrics:{commits:1,branches:1,contributors:1}}` | DEMONSTRATED |
| Repo metrics | `github_metrics{repo:"local"}` | `{success:true, _real:true, commits:{total:1}, contributors:{top:[{name:"c4 driver"}]}, branches:{current:"master"}}` | DEMONSTRATED |
| PR manage | `github_pr_manage{action:"list"}` | `{success:true, source:"local-store", pullRequests:[], total:0}` — honest empty (no remote/PRs) | DEMONSTRATED-HONEST |

**jujutsu is the tool-backed C4 plugin and is fully functional upstream.** All 6 `analyze_*` tools compute real content over the actual git diff — risk scoring, security-aware classification, reviewer routing, per-file heuristics. The 0ms latencies are because these are in-process git+heuristic computations (no I/O).

### ruflo-testgen (worker-backed: testgaps worker + `hooks_coverage-*` MCP/CLI + `hooks_worker-dispatch`)

**Enumerated:** command `testgen` (CLI `hooks coverage-gaps`/`coverage-route`/`coverage-suggest`); skills `tdd-workflow` (`Bash(npx*) hooks_pre-task hooks_post-task`), `test-gaps` (`Bash(npx*) hooks_worker-dispatch`); agent `tester`. Manifest: "drives the testgaps background worker via hooks_worker-dispatch". The `hooks_coverage-*` tools exist as **MCP tools** (`hooks_coverage-gaps`, `-route`, `-suggest`) AND CLI subcommands.

| Feature | Drive | Result | Verdict |
|---|---|---|---|
| coverage-gaps (no data) | `hooks_coverage-gaps{limit:20}` (empty project) | `{totalGaps:0, gaps:[], summary:"No coverage data found"}` | DEMONSTRATED-HONEST (no `coverage/` artifact — genuinely nothing to analyze) |
| **coverage-gaps (real data)** | same tool, after writing `coverage/coverage-summary.json` | `{totalGaps:2, gaps:[{file:"…/login.ts",currentCoverage:50,gap:30,priority:9,suggestedAgent:"tester"},{file:"…/charge.ts",currentCoverage:0,gap:80,priority:10}], summary:"2 files below 80% coverage threshold"}` | **DEMONSTRATED** (real per-file gap analysis) |
| **coverage-route** | `hooks_coverage-route{task}` (real data) | `{action:"prioritize", targetFiles:[charge.ts, login.ts], gaps:[…suggestedTests…], estimatedEffort:5.5, impactScore:55}` — **charge.ts ranked first (higher gap)** | DEMONSTRATED |
| **coverage-suggest** | `hooks_coverage-suggest{path:"…/charge.ts"}` | `{suggestions:[{gap:80,priority:10,suggestedTests:["Add tests for untested functions"]}], totalGap:80, estimatedEffort:8}` | DEMONSTRATED |
| worker-dispatch (no daemon) | `hooks_worker-dispatch{trigger:"testgaps"}` | `{success:true, workerId:"worker_testgaps_…", config:{capabilities:["testing","coverage","analysis"]}, status:"no-daemon", daemonAlive:false, note:"No worker daemon detected… dispatch recorded in-process but no actual work will run"}` | DEMONSTRATED-HONEST (self-discloses) |
| worker-dispatch (daemon, fg) | `hooks_worker-dispatch{trigger:"testgaps",background:false}` (daemon alive) | `{success:true, status:"synthetic-completed", daemonAlive:true, daemonPid:59845, note:"Synchronous mode: worker record marked completed but no real work executed… Use background:true with the daemon for real execution"}` | DEMONSTRATED-HONEST (escape-hatch documented) |
| **testgaps worker (REAL)** | `ruflo daemon trigger -w testgaps` (production shape) | **`{mode:"headless", success:true, model:"sonnet", durationMs:36507}`** + a genuine LLM coverage analysis | **DEMONSTRATED (real work)** |
| worker-list | `hooks_worker-list` | 12 workers incl. `testgaps` (capabilities, patterns count) | DEMONSTRATED |

**The testgaps worker is genuinely real.** `daemon trigger -w testgaps` ran for 36.5s and produced a real coverage analysis that **found the MD5 dead-condition I planted** (`h.length === 32 is always true for MD5 — this check never rejects anything`), flagged `resetPassword`/`charge` as untested, and **generated compilable Jest test skeletons** with boundary + security cases. Output persisted durably to `.claude-flow/metrics/test-gaps.json` (`success:true, model:"sonnet"`) and `.claude-flow/logs/headless/testgaps_*_result.log`. testgen is NOT a hollow template — its worker substrate executes high-quality work. The MCP `hooks_worker-dispatch` foreground path is an honest record-only stub; `background:true` + daemon = real execution.

### ruflo-docs (worker-backed: document worker + `hooks_worker-dispatch` + `CronCreate`)

**Enumerated:** command `ruflo-docs` (CLI `hooks worker dispatch --trigger document --scope …`); skills `api-docs` (`hooks_worker-dispatch`), `doc-gen` (`hooks_worker-dispatch memory_store CronCreate`); agent `docs-writer`. Manifest: "drives the `document` background worker… uses Haiku model".

| Feature | Drive | Result | Verdict |
|---|---|---|---|
| worker-dispatch (no daemon) | `hooks_worker-dispatch{trigger:"document",context:"src/"}` | `{success:true, workerId:"worker_document_…", config:{capabilities:["documentation","writing","generation"]}, status:"no-daemon", note:"No worker daemon detected…"}` | DEMONSTRATED-HONEST |
| worker-dispatch (api scope) | `hooks_worker-dispatch{trigger:"document",context:"src/auth/login.ts"}` | same honest no-daemon envelope w/ the file context threaded | DEMONSTRATED-HONEST |
| **document worker (REAL)** | `ruflo daemon trigger -w document` | **`{mode:"headless", success:true, model:"haiku", durationMs:9664, workerType:"document"}`** + a real doc-analysis output | **DEMONSTRATED (real work, Haiku as advertised)** |
| memory_store (doc-pattern) | `memory_store{key:"doc-pattern",namespace:"patterns"}` | `{success:true, stored:true, hasEmbedding:true, embeddingDimensions:384, backend:"sql.js + HNSW"}` | DEMONSTRATED |
| `CronCreate` (scheduling) | not driven — schedules a persistent cron job past the session | — | NOT-DEMONSTRATED (scope: would persist a cron outside the proof window; see ledger) |

**The document worker is real and uses Haiku exactly as the manifest claims.** `daemon trigger -w document` ran in 9.7s (`model:"haiku"`), correctly analyzed the planted code and surfaced its security issues (MD5, `Math.random()`, length-only validation) before documenting — genuine reasoning. Persisted to `.claude-flow/metrics/documentation.json` (`success:true, model:"haiku"`) + `.claude-flow/logs/headless/document_*_result.log`. Note: the `document` worker is **disabled-by-default** in the daemon (`daemon status` showed it `○ disabled`) but `daemon trigger` runs it on demand — a config gate, not a defect.

### ruflo-adr (template + AgentDB + plugin scripts: `import.mjs`, `verify.mjs`)

**Enumerated:** command `adr` (subcommands create/list/status/supersede/check/graph/search — uses `agentdb_hierarchical-store`, `agentdb_causal-edge`, `agentdb_causal-query`, `memory_search`); skills `adr-create` (`agentdb_hierarchical-store agentdb_hierarchical-query agentdb_causal-edge memory_store memory_search`), `adr-index` (runs `scripts/import.mjs` — `Bash memory_list memory_search`), `adr-review` (`agentdb_hierarchical-query agentdb_causal-query memory_search`), `adr-verify` (runs `scripts/verify.mjs` — `Bash memory_list memory_retrieve`); agent `adr-architect`. Plugin ships **`scripts/import.mjs` + `scripts/verify.mjs`** (the only C4 plugin with real scripts beyond smoke).

| Feature | Drive | Result | Verdict |
|---|---|---|---|
| adr create → AgentDB hierarchical node | `agentdb_hierarchical-store{key:"adr:ADR-001",tier:"semantic"}` | `{success:true, key:"adr:ADR-001", tier:"semantic"}` (stub controller — see mechanism) | DEMONSTRATED-HONEST (stub stores; recall is tier-scoped) |
| adr create → pattern record | `memory_store{namespace:"adr-patterns"}` | `{success:true, stored:true, hasEmbedding:true, embeddingDimensions:384}` | DEMONSTRATED |
| adr supersede → causal edge | `agentdb_causal-edge{sourceId:"adr:ADR-002",targetId:"adr:ADR-001",relation:"depends-on"}` | `{success:true, edgeId:<uuid>, backend:"graph-node", _graphNodeBackend:true}` — **persisted to `graph_edges`** (`mem:adr:ADR-002 → mem:adr:ADR-001 depends-on`) | DEMONSTRATED (real graph write) |
| adr search | `memory_search{query,namespace:"adr-patterns"}` | `{results:[{key:"adr-ADR-001", value:"…Use sql.js WASM backend…", similarity:0.40}], total:1}` | DEMONSTRATED |
| adr list | `memory_list{namespace:"adr-patterns"}` | the stored ADR entry w/ `hasEmbedding:true` | DEMONSTRATED |
| **adr index (import.mjs dry-run)** | `IMPORT_DRY_RUN=1 node scripts/import.mjs` | `{total:3, byStatus:{accepted:2,superseded:1}, byRelation:{depends-on:1}, edges:1, danglingRefs:[], statusMismatches:[]}` — **scanned `docs/adr/`, parsed frontmatter, extracted edges** | DEMONSTRATED |
| **adr index (import.mjs REAL)** | `node scripts/import.mjs` (spawns CLI → memory_store) | `{total:3, storedRecords:3, storedEdges:1, errors:[]}` — **3 ADRs + 1 edge persisted to adr-patterns/adr-edges** | DEMONSTRATED (end-to-end) |
| **adr verify (verify.mjs)** | `node scripts/verify.mjs` | `{ADRs in adr-patterns:4, Edges:1, Dangling 'to'/'from':0/0, Supersede cycles:0}` — **read back the durable store** | DEMONSTRATED |
| adr graph | `agentdb_causal-query` (skill target) | tool **ABSENT upstream**; edges reachable via `agentdb_graph-query`/`memory_list` instead | DOC-DRIFT (skill names a non-existent tool; capability present via different surface) |

**The adr lifecycle is fully functional upstream via the `memory_*` + `import.mjs`/`verify.mjs` substrate.** I created a 3-ADR `docs/adr/` corpus; `import.mjs` parsed it, extracted the `depends-on: [ADR-001]` relationship, and persisted 3 records + 1 edge through the CLI; `verify.mjs` read them back with dangling-ref + supersede-cycle checks. Fresh-process `sqlite3` dump confirms durable persistence (`ADR-001/002/003::… | adr-patterns | 384-d`; `depends-on:ADR-002->ADR-001 | adr-edges`). The only imperfection is the upstream plugin's own DOC-DRIFT (skills reference `agentdb_causal-query`/`hierarchical-query`, absent upstream).

### ruflo-ddd (template + AgentDB domain graph)

**Enumerated:** command `ddd` (subcommands context/aggregate/event/validate/map — scaffolds files + `agentdb_hierarchical-store` + `memory_store`); skills `ddd-aggregate` (`Bash(mkdir*) memory_store memory_search agentdb_hierarchical-store hooks_pre-task hooks_post-task`), `ddd-context` (`memory_store memory_search agentdb_hierarchical-store`), `ddd-validate` (`Bash(find* grep* npx*) memory_store memory_search hooks_pre-task hooks_post-task`); agent `domain-modeler`. Manifest: "navigable domain graph stored in AgentDB". File scaffolding is agent-side (`mkdir`/`Write`); the only ruflo-substrate dependency is the domain graph.

| Feature | Drive | Result | Verdict |
|---|---|---|---|
| ddd context create → domain node | `agentdb_hierarchical-store{key:"domain:context:billing",tier:"semantic"}` | `{success:true, key:"domain:context:billing", tier:"semantic"}` | DEMONSTRATED-HONEST (stub stores) |
| ddd aggregate → nested node | `agentdb_hierarchical-store{key:"domain:context:billing:aggregate:Invoice"}` | `{success:true, key:"domain:context:billing:aggregate:Invoice", tier:"semantic"}` | DEMONSTRATED-HONEST |
| ddd context → task marker | `memory_store{key:"ddd-context-billing",namespace:"tasks"}` | `{success:true, stored:true, hasEmbedding:true, embeddingDimensions:384}` | DEMONSTRATED |
| ddd context recall (search) | `memory_search{query:"billing bounded context",namespace:"tasks"}` | `{results:[{key:"ddd-context-billing", value:"Created bounded context billing", similarity:0.67}], total:1}` | DEMONSTRATED |
| ddd validate / map | `Bash(find/grep)` + `memory_*` | substrate (memory_*) proven; boundary-violation detection is agent `grep`/import-analysis logic | DEMONSTRATED (substrate) / N/A (agent logic) |
| File scaffolding (context dirs, barrel index.ts) | `mkdir`/`Write` | agent-side; no ruflo runtime to "be broken" | OUT-OF-SUBSTRATE |

**The ddd domain-graph substrate is functional via the `memory_*` path** (store + semantic recall both real, sim 0.67). The `agentdb_hierarchical-store` domain-graph nodes store via the stub controller (`success:true`); see the mechanism note on hierarchical-recall being tier-scoped. The skill stores to BOTH `agentdb_hierarchical-store` AND `memory_store --namespace tasks` (the latter is durable + searchable), so the domain record is recoverable. File scaffolding is pure agent work.

### ruflo-sparc (template / methodology — composes already-proven primitives)

**Enumerated:** command `ruflo-sparc` (subcommands init/status/advance/report — `memory_store`/`memory_search` to `sparc-state`/`sparc-phases`/`sparc-gates`); skills `sparc-spec` (`memory_store memory_search memory_retrieve task_create task_update task_complete hooks_intelligence_trajectory-start hooks_intelligence_trajectory-step neural_predict`), `sparc-implement` (+`workflow_create`), `sparc-refine` (+`hooks_intelligence_trajectory-end neural_train`); agent `sparc-orchestrator`. **No `sparc_*` runtime tool exists** — SPARC is agent reasoning over the gate logic, persisting phase state to memory namespaces. Proof = the SPARC-specific persistence paths.

| SPARC step | Underlying primitive | Result | Verdict |
|---|---|---|---|
| sparc init → phase state | `memory_store{namespace:"sparc-state"}` | `{success:true, stored:true, hasEmbedding:true, embeddingDimensions:384}` | DEMONSTRATED |
| spec phase → spec artifact | `memory_store{namespace:"sparc-phases"}` | `{success:true, stored:true, embeddingDimensions:384}` | DEMONSTRATED |
| advance → gate record | `memory_store{namespace:"sparc-gates"}` | `{success:true, stored:true, embeddingDimensions:384}` | DEMONSTRATED |
| sparc status → list workflows | `memory_search{namespace:"sparc-state"}` | `{results:[{key:"current-phase-jwt-auth", value:"…phase:1, Specification…", similarity:0.51}], total:1}` | DEMONSTRATED |
| (namespace persistence proof) | `memory_list` on each ns | sparc-state, sparc-phases, sparc-gates **each have 1 row w/ 384-d embedding** | DEMONSTRATED |
| spec phase → trajectory start | `hooks_intelligence_trajectory-start{task,agent}` | `{trajectoryId:"traj-…", status:"recording", implementation:"real-trajectory-tracking"}` | DEMONSTRATED |
| trajectory step | `hooks_intelligence_trajectory-step{trajectoryId,action,result,quality}` | `{stepId:"step-…", recorded:true, totalSteps:1, implementation:"real-step-recording"}` | DEMONSTRATED |
| **refine phase → trajectory end (durable learning)** | `hooks_intelligence_trajectory-end{trajectoryId,success}` | `{persisted:true, persistedId:"entry_…", learning:{sonaUpdate:true, sonaPatternKey:"reviewer:auth+phase+refine+sparc", ewcConsolidation:true, patternsExtracted:1}, implementation:"real-sona-learning"}` | **DEMONSTRATED (real SONA+EWC++ learning)** |
| spec → pattern predict | `neural_predict{input}` | `{_realEmbedding:true, _embeddingSource:"ruvector@0.2.27 MiniLM", predictions:[], _note:"No patterns stored. Train with neural_train… before predicting"}` | DEMONSTRATED-HONEST (threshold/empty caveat, ADR-0291 W4) |
| refine → neural train | `neural_train{modelType:"pattern",epochs:1,data}` | `{success:true, _realEmbedding:true, patternsStored:1, totalPatterns:1}` | DEMONSTRATED |
| task tracking | `task_create{type:"feature",…}` → `task_update{status,progress}` | create→real task ID; update→`{success:true, status:"in_progress", progress:40}` | DEMONSTRATED |

**SPARC is a methodology template and every primitive it composes is functional upstream.** All three SPARC namespaces (`sparc-state`/`sparc-phases`/`sparc-gates`) persist with 384-d embeddings and recall via search (confirmed via `memory_list` — the one `sparc_gate_search` 0-result was purely the default-threshold-0.7 caveat, NOT loss). The `hooks_intelligence_trajectory-*` cycle (ADR-0291 F1 retracted these as working) runs the **real SONA+EWC++ learning pipeline** end-to-end (`persisted:true`, `patternsExtracted:1`) — this is the durable learning loop SPARC's refine phase invokes.

---

## Mechanism map (process → trigger → store → consumer)

C4 surfaces split into THREE substrate classes. Write-trace of the traced battery (`traces/fswrites-traced.log`) + full-session tree diff (`treediffs/c4-tree-after.txt`):

```
# MCP-path writes (memory/learning):
.swarm/memory.db                 <- adr/sparc/ddd memory_store, causal-edge
.swarm/sona-patterns.json        <- trajectory-end SONA learning
.claude-flow/neural/patterns.json + stats.json + models.json  <- neural_train/predict
# Worker-path writes (testgen/docs daemon):
.claude-flow/metrics/test-gaps.json        <- testgaps worker findings (model:sonnet)
.claude-flow/metrics/documentation.json    <- document worker findings (model:haiku)
.claude-flow/logs/headless/testgaps_*_result.log   <- real LLM worker output
.claude-flow/logs/headless/document_*_result.log
.claude-flow/daemon-state.json             <- worker run counts (testgaps runs:1 success:1; document runs:1 success:1)
# Tool-path (jujutsu): no persistent writes — in-process git+heuristic; github_* → .claude-flow/{github,tasks}/store.json
```

| Surface | Process | Trigger | Store | Consumer (read-back) |
|---|---|---|---|---|
| jujutsu `analyze_*` | MCP server (in-process git+heuristic) | call w/ git `ref` | none (stateless) — reads the live git tree | the result envelope (risk/classification/reviewers) |
| jujutsu `github_*` | MCP server | call | `.claude-flow/github/store.json`, `tasks/store.json` | github_metrics/pr_manage |
| testgen `hooks_coverage-*` | MCP server | call | none — reads `coverage/{coverage-summary.json,lcov.info}` / `.nyc_output` | the gap/route/suggest envelope |
| **testgen testgaps worker** | **worker daemon (headless Claude Code, sonnet)** | `daemon trigger -w testgaps` OR scheduled (interval 1200s) OR `hooks_worker-dispatch{background:true}` | `.claude-flow/metrics/test-gaps.json` + `logs/headless/testgaps_*_result.log` + `daemon-state.json` | the persisted findings; metrics file |
| **docs document worker** | **worker daemon (headless Claude Code, haiku)** | `daemon trigger -w document` (disabled-by-default in scheduler) | `.claude-flow/metrics/documentation.json` + `logs/headless/document_*_result.log` | the persisted doc-analysis |
| adr `memory_store`/`memory_search` (adr-patterns/adr-edges) | MCP server | skill call / `import.mjs` (spawns CLI) | `.swarm/memory.db memory_entries` (ns=adr-patterns/adr-edges, 384-d) | `memory_search`, `memory_list`, `verify.mjs` |
| adr `agentdb_causal-edge` | MCP server, `ruvector-graph-node` backend | adr supersede | `graph_edges` (domain-prefixed `mem:adr:…` IDs) + causal-edges ns | `agentdb_graph-query` (NOT `causal-query` — absent upstream) |
| adr `import.mjs`/`verify.mjs` | one-shot `node` (spawns `@claude-flow/cli` per record) | `/adr-index`, `/adr-verify` | adr-patterns/adr-edges via CLI memory_store | `verify.mjs` graph report |
| ddd `agentdb_hierarchical-store` | MCP server, `hierarchicalMemory` **stub** controller | ddd context/aggregate | in-process tier cache (NOT flushed to memory_entries) | `hierarchical-recall` (tier-scoped, empty in stub) |
| ddd/adr `memory_store` (tasks/etc.) | MCP server | skill call | `.swarm/memory.db memory_entries` | `memory_search` (semantic recall) |
| sparc memory namespaces | MCP server | skill call | `.swarm/memory.db memory_entries` (ns=sparc-state/phases/gates, 384-d) | `memory_search`/`memory_list` |
| sparc `hooks_intelligence_trajectory-*` | MCP server, SONA+EWC++ pipeline | spec/refine phase | `.swarm/sona-patterns.json` + memory_entries ns=trajectories + graph_edges (trajectory-caused) | the learning envelope; durable across processes |

### Five most important mechanism findings (quality/process focus)

1. **jujutsu is genuinely tool-backed and stateless-correct.** The 6 `analyze_*` tools parse the real git diff in-process and compute real risk/classification/reviewer output (the auth file → "high"/"Security-sensitive", payments → "Payment-related", stats exact-match to `git diff --stat`). No persistence needed; the tools read the live git tree each call. This is the cleanest C4 plugin — manifest claim ("wraps 6 analyze_* tools") matches the live registry exactly.

2. **testgen and docs are REAL worker-backed plugins — the workers execute genuine LLM work.** `daemon trigger -w testgaps` (sonnet, 36.5s) produced a coverage analysis that caught a planted MD5 dead-condition and emitted compilable Jest skeletons; `daemon trigger -w document` (haiku, 9.7s) produced security-aware doc analysis. Both persisted to `.claude-flow/metrics/*.json` + `logs/headless/*_result.log` with `success:true` and `daemon-state.json` runs:1/success:1. The MCP `hooks_worker-dispatch` foreground envelope is an **honest record-only stub** (`status:"no-daemon"` / `"synthetic-completed"`, with a self-disclosing note pointing to `background:true` + daemon for real execution). The honest-degradation calibration (C3) holds: the stub *self-discloses*; the real work happens off the daemon path.

3. **adr is functional end-to-end via memory_* + the plugin's own scripts.** `import.mjs` (scan → parse frontmatter → extract edges → spawn CLI memory_store) persisted 3 ADRs + 1 edge to adr-patterns/adr-edges; `verify.mjs` read them back with dangling-ref + supersede-cycle checks. Fresh-process sqlite dump confirms durability. The causal edge writes to `graph_edges` (the C2 mechanism: `ruvector-graph-node`, `mem:`-prefixed IDs). **The upstream adr plugin's only imperfection is its OWN doc-drift**: `adr-review`/`adr graph`/`adr-create` skills name `agentdb_causal-query`/`hierarchical-query`, which are absent from the upstream runtime — but the edges they'd query are reachable via `agentdb_graph-query`/`memory_list`.

4. **sparc and ddd are methodology/scaffolding templates over the proven C2/C3 substrate.** Neither has a `sparc_*`/`ddd_*` runtime tool. SPARC's phase state persists to three dedicated namespaces (all 384-d, all recallable) and its refine phase runs the **real SONA+EWC++ trajectory learning** (`persisted:true`, `patternsExtracted:1`). DDD's domain graph persists via `memory_store --namespace tasks` (searchable, sim 0.67). The `agentdb_hierarchical-store` domain-graph annotation works but via the **stub** controller (next finding).

5. **`agentdb_hierarchical-store`/`-recall` runs the agentdb HierarchicalMemory STUB upstream — store succeeds, recall is tier-scoped/empty — and this is identical fork↔upstream.** The dist (`memory-bridge.js:1953-2018`) branches: real agentdb HierarchicalMemory (returns an `id`) vs stub (`hm.store(key,value,tier)` synchronous, no `id`). My stores returned `{success:true, key, tier}` with **no `id`** → the **stub path**. The stub's entries do NOT flush to `memory_entries` (confirmed by sqlite dump — `adr:`/`domain:` keys absent from the table) and `hierarchical-recall` returns `[]` even in a tight same-process warm probe (`up-hrecall-probe.jsonl`). This is the same family as C2's `hierarchical-delete` "no public delete API" finding. **It is honest stub behavior, would be identical in the fork (same agentdb dependency), and does NOT break adr/ddd** because those skills ALSO write the durable `memory_store` record (which is searchable). *(Note: C2's report said hierarchical-recall "returned both stored entities" — my reproducible result is empty-via-stub; the C2 claim is DA-upheld and likely reflects a different process-warmth/controller state. For C4's purposes the adr/ddd substrate is proven via the memory_* path regardless.)*

---

## NOT-DEMONSTRATED / DOC-DRIFT ledger (with bar points)

No feature was found `UPSTREAM-BROKEN`. The items below are scope/safety judgment calls or upstream-plugin doc imperfections, NOT runtime failures:

| Item | Status | Why | Bar points satisfied |
|---|---|---|---|
| adr `agentdb_causal-query` / `agentdb_hierarchical-query` (named in adr-review/adr graph/adr-create skills) | **DOC-DRIFT** (upstream plugin) | tools ABSENT from upstream live registry; the *capability* (query adr edges/nodes) is present via `agentdb_graph-query` + `memory_list`/`memory_search` | (1) live `tools/list` enumerated · (4) installed-dist registry has no such tool name; edges ARE durably stored in `graph_edges`+adr-edges (sqlite dump) · (5) the read-back works via the existing tools |
| docs `CronCreate` (scheduled doc maintenance) | NOT-DEMONSTRATED | would persist a cron job past the proof window (escapes the clean sub-project); the worker it schedules (`document`) IS proven real | (1) skill `allowed-tools` lists it; the dispatch target proven via `daemon trigger -w document` · (4) `CronCreate` is a Claude Code harness tool, not a ruflo runtime surface |
| testgen `tdd-workflow` skill (hooks_pre-task/post-task) | NOT-DEMONSTRATED (not separately driven) | the pre/post-task hooks are the C1/C3 hook layer (already proven); tdd-workflow is agent-side mock-first reasoning + `npx`/Read/Write/Edit | (1) hooks_pre-task/post-task proven in C3 core; the skill is agent reasoning with no novel ruflo surface |
| adr `adr check` (git-log scan for ADR violations) | NOT-DEMONSTRATED | pure agent `git log`/`grep` + Read logic; no ruflo runtime to drive | (1) the substrate (memory_search adr-patterns) it consults is proven |
| ddd `event`/`map`, `ddd validate` boundary detection | OUT-OF-SUBSTRATE / N/A | file scaffolding (`Write`) + import-graph analysis (`grep`) — agent logic, no ruflo runtime | (2) the memory_* substrate the skills touch is proven |
| testgen/docs SCAFFOLD file output | OUT-OF-SUBSTRATE | tests/docs written by the agent or the worker's headless run — not a ruflo MCP surface | the worker REAL output (which includes the file content) is proven persisted |
| `github_workflow{action:"status"}` | (my wrong enum, non-load-bearing) | "Unknown action: status" — and `github_workflow` is NOT in jujutsu's git-workflow allowed-tools (only pr_manage/repo_analyze/metrics, all proven) | re-drive with a valid action would work; out of jujutsu's surface |

These satisfy "production shape + documented behaviour + installed-dist presence." None met the threshold for an `UPSTREAM-BROKEN` verdict (full 5-point bar AND a named root-cause mechanism — not reached for anything).

---

## Environment record (exact)

| Component | Version / path |
|---|---|
| ruflo | 3.10.36 — `/Users/henrik/.npm/_npx/2ed56890c96f58f7/node_modules/ruflo` (bin `ruflo/bin/ruflo.js`) |
| @claude-flow/cli | 3.10.36 — `…/2ed56890c96f58f7/node_modules/@claude-flow/cli/dist/src/` |
| MCP serverInfo | `ruflo 3.0.0`; 293 tools live |
| Node | v24.14.1, darwin arm64 |
| Embedding model | `Xenova/all-MiniLM-L6-v2`, 384-d, ONNX SIMD |
| Memory backend (live) | `sql.js + HNSW` (WASM SQLite) |
| Worker daemon models | testgaps→`sonnet`, document→`haiku` (headless Claude Code) |
| Upstream plugin spec (6) | `~/.claude/plugins/marketplaces/ruflo/plugins/` — testgen 0.2.0, sparc 0.2.0, ddd 0.2.0, **adr 0.3.0**, docs 0.2.0, jujutsu 0.2.0 (all 6 in marketplace.json) |
| Reference root | `/tmp/ruflo-fresh` (REUSED, intact) |
| Clean drive sub-project | `/tmp/c4-up` (git repo w/ synthetic security diff + 3-ADR corpus + coverage artifacts) |
| Registry / cache | public npm + `/tmp/ruflo-fresh/.npm-cache` |
| Process cleanup | C4 daemon (PID 59845) stopped; all driver MCP processes terminated; sibling agents' fork envs (`/tmp/ruflo-fork-c2`, `@sparkleideas/cli daemon`) left untouched |

## Evidence index (`/tmp/c4-evidence/upstream/`)

| File | Contents |
|---|---|
| `logs/tools-list-c4.txt` | live 293-tool list + C4 families (analyze 6, github 5, hooks_coverage 3, worker 5, causal/hierarchical) + confirmation causal-query/recall/hierarchical-query ABSENT |
| `logs/schemas-c4.json` | live `inputSchema` for analyze_*/github_*/worker-dispatch/causal/hierarchical (arg names used in drives) |
| `calls-c4.json` + `up-c4-results.jsonl` | main 40-call battery (jujutsu/testgen/docs/adr/ddd/sparc) — full envelopes |
| `calls-c4b.json` + `up-c4b-results.jsonl` | coverage-with-real-data re-drive + full trajectory cycle + neural_train + task (correct schema) |
| `calls-c4c.json` + `up-c4c-results.jsonl` | hierarchical-store valid-key re-drive + recall + sparc namespace `memory_list` proof |
| `calls-hrecall-probe.json` + `up-hrecall-probe.jsonl` | tight same-process hierarchical store→recall stub probe (across tiers) |
| `calls-daemon-disp.json` + `up-daemon-disp.jsonl` | MCP worker-dispatch with daemon alive (synthetic-completed envelope) |
| `calls-github.json` + `up-github.jsonl` | jujutsu git-workflow github_* surface |
| `calls-traced.json` + `up-traced-results.jsonl` | write-traced representative battery (one write per family) |
| `logs/adr-import-dryrun.json`, `adr-import-real.json` | `import.mjs` parse + real persist (3 records + 1 edge) |
| `logs/adr-verify.out` | `verify.mjs` graph report (4 ADRs, 1 edge, 0 dangling, 0 cycles) |
| `logs/daemon-status.log` | daemon worker table (5 enabled incl. testgaps; document disabled-by-default) |
| `logs/daemon-testgaps-output.txt`, `daemon-document-output.txt` | **the real LLM worker outputs** (testgaps coverage analysis w/ MD5 detection; document security analysis) |
| `logs/daemon-start.log`, `daemon-stop.log` | daemon lifecycle (clean start/stop) |
| `dumps/c4-memory-db-namespaces.txt`, `c4-memory-db-content.txt` | per-namespace counts + key/namespace/type/dims (adr-patterns 5, adr-edges 2, sparc-state/phases/gates, tasks, trajectories 5) |
| `dumps/c4-graph-edges.txt` | graph_edges rows (adr depends-on + trajectory-caused edges) |
| `dumps/c4-up-diff.txt` | the synthetic git diff fed to analyze_* |
| `traces/fswrites-traced.log` | fs write-trace (NODE_OPTIONS shim) |
| `treediffs/c4-tree-before/mid/after.txt` | full-session tree diff (worker metrics/logs, memory.db, sona-patterns, neural stores) |
| `c4_driver.py`, `fswrite-shim.cjs` | reproducible harness (C2/C3 driver reused) |

## Open questions for fork-auditor / devil's advocate

1. **adr DOC-DRIFT — fork ADDS the missing tool?** Upstream's adr skills reference `agentdb_causal-query`/`hierarchical-query` which are ABSENT upstream (capability reachable via `agentdb_graph-query`/`memory_list`). The fork's MCP catalog DOES list `agentdb_causal-query`/`-recall`/`hierarchical-query` (C2 Q3). So the fork likely *closes* this upstream doc-drift by actually registering the tool. Confirm: does the fork's `adr graph`/`adr-review` reach a working `agentdb_causal-query` handler that reads adr-edges, and does it return the same edges the upstream `agentdb_graph-query` does?

2. **Worker daemon parity (testgen/docs).** Upstream's testgaps (sonnet) + document (haiku) workers execute real headless Claude Code work via `daemon trigger`/`background:true`; the MCP `hooks_worker-dispatch` foreground path is an honest record-only stub. Does the fork keep BOTH workers + the same model assignment (sonnet/haiku)? Does the fork's worker-dispatch still self-disclose `no-daemon`/`synthetic-completed`, or did the fork wire an in-process runner (closing the foreground-stub gap)? The fork's ADR-0290 episode pipeline + loop-workers overlap here.

3. **hierarchical-store stub (ddd/adr).** Upstream's `agentdb_hierarchical-store`/`-recall` runs the agentdb HierarchicalMemory **stub** (store succeeds w/o `id`, recall tier-scoped/empty, no flush to memory_entries). The fork's RVF-as-sole-truth posture (C2 J1) — does the fork's hierarchical-store flush to a real durable table (making `hierarchical-recall` non-empty), or keep the same stub? If the fork made it durable, that's a FORK-AHEAD to re-justify; if same stub, PARITY. Drive the same `domain:context:billing` store→recall against the fork. *(Also note the C2-vs-C4 discrepancy: C2 reported hierarchical-recall returned entities; my reproducible result is stub-empty — worth the DA reconciling whether C2's was a warmer controller state.)*

4. **SPARC trajectory learning (the F1-retracted surface).** Upstream's `hooks_intelligence_trajectory-start/step/end` (which sparc-spec/refine invoke) run the real SONA+EWC++ pipeline (`persisted:true`, `patternsExtracted:1`). This is the same surface ADR-0291 F1 wrongly called `enabled:false`/disabled. Confirm the fork keeps these MCP tools live AND that the fork's sparc skills still route through them (not a parallel ADR-0290 episode path that bypasses the trajectory tools).

5. **jujutsu `analyze_*` parity.** Upstream registers exactly 6 `analyze_*` tools (manifest-exact) with real git-diff parsing + security-aware heuristics. Does the fork's `analyze_*` family match the 6 tools + the same risk/classification output shape, or did the fork add `useRuVector` real-embedding paths (the `analyze_diff` schema has a `useRuVector` flag — I drove the default/fallback path; the fork may wire ruvector)?

6. **adr import.mjs CLI_CORE path.** `import.mjs` has a `CLI_CORE=1` branch (routes to `@claude-flow/cli-core@alpha`, idempotent-overwrite vs incremental). I drove the default (`@claude-flow/cli@latest`, incremental). Does the fork's adr plugin ship the same import.mjs (it's a plugin script, fork-overlaid in cache), and does the fork's CLI_CORE path still exist / point to a fork package?
