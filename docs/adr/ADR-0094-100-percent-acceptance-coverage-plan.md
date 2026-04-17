# ADR-0094: 100% Acceptance Test Coverage Plan

- **Status**: Proposed — 2026-04-17
- **Date**: 2026-04-17
- **Scope**: `ruflo-patch/lib/acceptance-*.sh`, `scripts/test-acceptance.sh`, `tests/unit/`
- **Related**: ADR-0090 (Tier A+B — the foundation this plan extends), ADR-0093 (controller wiring gaps), ADR-0082 (no silent fallbacks)
- **Surfaced by**: Coverage gap audit (`/tmp/coverage-gap-audit.md`, 2026-04-16) — found 26/239 MCP tools exercised (11%)

## Context

ADR-0090 Tier A+B brought coverage from ~23% (the original audit finding) to ~40% by adding checks for storage (B1/B2), daemon workers (B3/B6a), package deps (B4), and controller persistence (B5). But a full audit of the published `@sparkleideas/cli@3.5.58-patch.121` MCP surface shows **213 of 239 tools still have zero acceptance coverage**. The CLI also exposes 13+ CLI subcommands, 30+ generated files, and numerous error paths that are entirely untested.

This ADR proposes a phased plan to reach 100% tool-level acceptance coverage. "100%" means: every published MCP tool and CLI subcommand has at least one acceptance check that invokes it with valid input and asserts a meaningful response — not just "exits 0" but "returns expected shape / writes expected artifact / fails loudly on bad input."

## Principles

1. **One shared helper per tool category** (learned from B3/B5). Never 20 copy-pasted functions. Generic helper + thin tuple-wrapper per tool.
2. **Three-way bucket** (ADR-0090 Tier A2). Every check emits `pass`, `fail`, or `skip_accepted` with a narrow regex. Skips auto-flip to fail when the feature ships.
3. **No silent passes** (ADR-0082). `{success:true}` with zero side-effects is a FAIL, not a PASS. Every check must verify a POST-CONDITION (file exists, row inserted, response shape matches, state changed).
4. **Backend-appropriate verification** (learned from B5). Not everything persists to SQLite. Use file probes for RVF/redb/JSON, runtime API checks for pure-compute controllers, and state-diff checks for in-memory services.
5. **Swarm-buildable** (learned from B3/B5). Each phase should be decomposable into 3-8 parallel agents: researcher + adversarial-reviewer + builder minimum.
6. **Commit per phase** (user rule: "commit often"). Each phase produces one commit with check file + unit tests + wiring + ADR update.

## Phased Plan

### Phase 1: Security & Safety (HIGH — 17 tools, ~50 LOC checks + 40 LOC tests)

**Why first**: Security-critical features must be verified before any release claim.

| Check file | Tools | Check shape |
|---|---|---|
| `acceptance-aidefence-checks.sh` | `aidefence_scan`, `aidefence_analyze`, `aidefence_has_pii`, `aidefence_is_safe`, `aidefence_learn`, `aidefence_stats` | Invoke each with known-benign + known-malicious input. Assert: benign → `is_safe:true`, malicious → `is_safe:false` + threat classification. `has_pii` with an email → `hasPii:true`. `stats` returns `totalScans > 0` after the scan checks. |
| `acceptance-claims-checks.sh` | `claims_claim`, `claims_release`, `claims_handoff`, `claims_accept-handoff`, `claims_steal`, `claims_mark-stealable`, `claims_rebalance`, `claims_board`, `claims_load`, `claims_status`, `claims_list` | Create a task → claim it → verify board shows it claimed → handoff → verify new owner → release. Round-trip lifecycle. |

**Estimated effort**: 2 check files, ~20 thin wrappers, 1 shared helper per file. 1 swarm (3 agents).

### Phase 2: Core Runtime (HIGH — 33 tools, ~80 LOC)

| Check file | Tools | Check shape |
|---|---|---|
| `acceptance-agent-lifecycle-checks.sh` | `agent_spawn`, `agent_list`, `agent_status`, `agent_health`, `agent_terminate`, `agent_update`, `agent_pool` | Spawn agent → list shows it → status reports healthy → terminate → list no longer shows it. Pool scaling: spawn 3 → pool size = 3. |
| `acceptance-autopilot-checks.sh` | `autopilot_enable`, `autopilot_config`, `autopilot_predict`, `autopilot_history`, `autopilot_learn`, `autopilot_log`, `autopilot_reset`, `autopilot_status`, `autopilot_disable` | Enable → status shows enabled → predict returns a task shape → disable → status shows disabled. Config round-trip. History after a learn cycle. |
| `acceptance-workflow-checks.sh` | `workflow_create`, `workflow_execute`, `workflow_run`, `workflow_pause`, `workflow_resume`, `workflow_cancel`, `workflow_status`, `workflow_list`, `workflow_delete`, `workflow_template` | Create → list shows it → execute → status shows running → cancel → status shows cancelled. Template listing. |
| `acceptance-guidance-checks.sh` | `guidance_capabilities`, `guidance_discover`, `guidance_recommend`, `guidance_workflow`, `guidance_quickref` | Each returns a non-empty response with expected shape (capabilities list, recommendation object, workflow template, quickref text). |

**Estimated effort**: 4 check files, ~33 thin wrappers. 1 swarm (5 agents).

### Phase 3: Distributed Systems (MEDIUM — 36 tools, ~90 LOC)

| Check file | Tools | Check shape |
|---|---|---|
| `acceptance-hivemind-checks.sh` | `hive-mind_init`, `hive-mind_join`, `hive-mind_leave`, `hive-mind_status`, `hive-mind_spawn`, `hive-mind_broadcast`, `hive-mind_consensus`, `hive-mind_memory`, `hive-mind_shutdown` | Init → status shows running → broadcast message → memory stores it → shutdown. Consensus: propose → vote → result. |
| `acceptance-coordination-checks.sh` | `coordination_consensus`, `coordination_load_balance`, `coordination_node`, `coordination_orchestrate`, `coordination_sync`, `coordination_topology`, `coordination_metrics` | Topology config → node registration → load-balance query → metrics non-empty. |
| `acceptance-daa-checks.sh` | `daa_agent_create`, `daa_agent_adapt`, `daa_cognitive_pattern`, `daa_knowledge_share`, `daa_learning_status`, `daa_performance_metrics`, `daa_workflow_create`, `daa_workflow_execute` | Create agent → cognitive pattern → adapt → share knowledge → learning status reports patterns. Workflow create + execute. |
| `acceptance-session-checks.sh` | `session_save`, `session_restore`, `session_list`, `session_delete`, `session_info` | Save → list shows it → info returns metadata → restore → state matches → delete → list no longer shows it. |
| `acceptance-task-checks.sh` | `task_create`, `task_assign`, `task_update`, `task_cancel`, `task_complete`, `task_list`, `task_status`, `task_summary` | Create → list shows it → assign → status shows assigned → complete → summary includes it. |

**Estimated effort**: 5 check files, ~36 thin wrappers. 1 swarm (6 agents).

### Phase 4: Integration & I/O (MEDIUM — 52 tools, ~120 LOC)

| Check file | Tools | Check shape |
|---|---|---|
| `acceptance-browser-checks.sh` | `browser_open`, `browser_click`, `browser_fill`, `browser_eval`, `browser_screenshot`, `browser_wait`, + 14 more | Open about:blank → eval "document.title" → returns string. Screenshot → file exists. Fill + click round-trip on a local HTML fixture. Session lifecycle. **Requires Playwright — SKIP_ACCEPTED if binary absent.** |
| `acceptance-terminal-checks.sh` | `terminal_create`, `terminal_execute`, `terminal_close`, `terminal_list`, `terminal_history` | Create → execute `echo hello` → history shows it → close → list empty. |
| `acceptance-embeddings-checks.sh` | `embeddings_generate`, `embeddings_compare`, `embeddings_search`, `embeddings_hyperbolic`, `embeddings_neural`, `embeddings_init`, `embeddings_status` | Generate embedding for "hello" → 768-dim array. Compare "hello" vs "world" → similarity score. Status reports model loaded. |
| `acceptance-transfer-checks.sh` | `transfer_store-search`, `transfer_store-info`, `transfer_store-featured`, `transfer_store-trending`, `transfer_plugin-search`, `transfer_plugin-info`, `transfer_plugin-featured`, `transfer_plugin-official`, `transfer_detect-pii` | Each returns a response shape (may be empty array on cold network, but must not error). PII detection round-trip. **Network-dependent — SKIP_ACCEPTED if offline.** |
| `acceptance-github-checks.sh` | `github_issue_track`, `github_pr_manage`, `github_metrics`, `github_repo_analyze`, `github_workflow` | Each returns a response shape. **Requires GitHub token — SKIP_ACCEPTED if `GITHUB_TOKEN` unset.** |
| `acceptance-wasm-checks.sh` | `wasm_agent_create`, `wasm_agent_prompt`, `wasm_agent_tool`, `wasm_agent_export`, `wasm_agent_terminate`, `wasm_agent_list`, `wasm_agent_files`, `wasm_gallery_list`, `wasm_gallery_search`, `wasm_gallery_create` | Create agent → list shows it → prompt returns response → terminate → list empty. Gallery search returns shape. |

**Estimated effort**: 6 check files, ~52 thin wrappers. 2 swarms (4 agents each).

### Phase 5: ML & Advanced (MEDIUM — 29 tools, ~70 LOC)

| Check file | Tools | Check shape |
|---|---|---|
| `acceptance-neural-checks.sh` | `neural_train`, `neural_optimize`, `neural_compress`, `neural_predict`, `neural_patterns`, `neural_status` | Status returns model info. Patterns store + retrieve round-trip. Train/optimize/compress may be long-running — assert starts successfully + returns a job ID or progress shape. |
| `acceptance-ruvllm-checks.sh` | `ruvllm_status`, `ruvllm_hnsw_create`, `ruvllm_hnsw_add`, `ruvllm_hnsw_route`, `ruvllm_sona_create`, `ruvllm_sona_adapt`, `ruvllm_microlora_create`, `ruvllm_microlora_adapt`, `ruvllm_generate_config`, `ruvllm_chat_format` | Status returns runtime info. HNSW create → add → route round-trip. Sona/MicroLoRA lifecycle. |
| `acceptance-performance-checks.sh` | `performance_benchmark`, `performance_bottleneck`, `performance_profile`, `performance_optimize`, `performance_metrics`, `performance_report` | Benchmark returns timing data. Metrics non-empty. Report generates readable output. |
| `acceptance-progress-checks.sh` | `progress_check`, `progress_summary`, `progress_sync`, `progress_watch` | Check returns implementation status. Summary returns % complete. |

**Estimated effort**: 4 check files, ~29 thin wrappers. 1 swarm (4 agents).

### Phase 6: Hooks, Error Paths & Input Validation (LOW-MEDIUM — ~30 scenarios, ~80 LOC)

| Check file | Tools/Scenarios | Check shape |
|---|---|---|
| `acceptance-hooks-lifecycle-checks.sh` | `hooks_pre-task`, `hooks_post-task`, `hooks_pre-edit`, `hooks_post-edit`, `hooks_pre-command`, `hooks_post-command`, `hooks_session-start`, `hooks_session-end` | Each hook fires and returns a non-error shape. Pre-task returns risk assessment. Post-task records learning. |
| `acceptance-error-paths-checks.sh` | Invalid config, missing deps, corrupted state, permission errors | Feed malformed config.json → assert CLI exits non-zero with diagnostic. Remove a required dep → assert graceful degradation message. |
| `acceptance-input-validation-checks.sh` | Path traversal, unicode injection, oversized input, negative numbers | Feed `--config ../../../etc/passwd` → assert rejection. Unicode in keys → assert round-trip or explicit rejection. |
| `acceptance-model-routing-checks.sh` | `hooks_model-route`, `hooks_model-outcome`, `hooks_model-stats` | Route a task → get a model recommendation. Record outcome → stats update. |

**Estimated effort**: 4 check files, ~30 scenarios. 1 swarm (4 agents).

### Phase 7: File Output Validation & CLI Commands (LOW — ~20 scenarios, ~50 LOC)

| Check file | Targets |
|---|---|
| `acceptance-file-output-checks.sh` | `.claude-flow/agents/store.json`, `.swarm/agents.json`, `.swarm/state.json`, `.claude/helpers/statusline.cjs`, `.claude-flow/neural/`, `.claude-flow/hooks/` — validate structure + schema after init. |
| `acceptance-cli-commands-checks.sh` | `security scan`, `deployment`, `update`, `appliance`, `analyze`, `performance` CLI commands — invoke each with `--help` or minimal args, assert non-error exit. |

**Estimated effort**: 2 check files. 1 swarm (3 agents).

## Scoring

| Phase | Tools/Scenarios | Cumulative coverage |
|---|---|---|
| Current (B1-B5) | 26/239 | 11% |
| Phase 1 | +17 | 18% |
| Phase 2 | +33 | 32% |
| Phase 3 | +36 | 47% |
| Phase 4 | +52 | 68% |
| Phase 5 | +29 | 80% |
| Phase 6 | +30 | 93% |
| Phase 7 | +20 | 100% |

## Acceptance criteria

This ADR is implemented when:
1. Every phase is committed with check file + unit tests + wiring.
2. `scripts/test-acceptance.sh` runs all checks — `pass_count + skip_count + fail_count == total_count` with `fail_count == 0`.
3. Every MCP tool name appears in at least one `run_check_bg` call.
4. Every CLI subcommand appears in at least one acceptance check invocation.
5. ADR-0090's layer scoring table is updated to reflect the new coverage levels.

## Alternatives considered

### A: Test only user-facing features, not internal MCP tools
Rejected. MCP tools ARE the user-facing API for Claude Code integration. Every tool a user can `mcp exec` must have verified behavior.

### B: Rely on unit tests instead of acceptance tests
Rejected. Unit tests mock dependencies; acceptance tests exercise the real published package. Both are needed. The unit test pyramid is healthy (2850+ tests); the acceptance pyramid has gaps.

### C: 80% coverage target instead of 100%
Rejected. The remaining 20% is where the silent-pass bugs hide (proven by B3's stub discovery, B5's method-name drift). ADR-0082's "no silent fallbacks" rule requires proving every tool path, not just most.

## References

- Coverage gap audit: `/tmp/coverage-gap-audit.md` (2026-04-16, 345 lines)
- ADR-0090: foundation acceptance suite (Tier A+B)
- ADR-0093: controller wiring gaps (Tier 1 patchable + Tier 2 verified-SKIP)
- ADR-0082: no silent fallbacks (test integrity rule)
- ADR-0087: adversarial prompting workflow (swarm methodology)
