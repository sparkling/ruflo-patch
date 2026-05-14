# ADR-0180 Swarm Session: Caller Catalog Audit

**Date:** 2026-05-13
**Team:** `adr-0180-callers`
**Coordinator:** team-lead (Claude Code)
**Agents:** 4 (mcp-surface-auditor, cli-command-auditor, hooks-daemons-auditor, inter-controller-auditor)
**Outcome:** ADR-0180 Architecture §Caller surfaces + §Migration concerns + Open follow-ups #7-#14 updated.

## Purpose

The original ADR-0180 framing said the archivist "sits above MCP tool dispatch." A reviewer asked: *do components other than MCP need to use the archivist?* This swarm enumerated every in-process consumer of memory/substrate writes to answer concretely.

## Scope

Four parallel audits:

1. **MCP surface auditor** — every MCP tool that mutates substrate, grouped by surface.
2. **CLI command auditor** — every CLI command that mutates substrate directly (not via MCP).
3. **Hooks + daemons auditor** — lifecycle hooks and daemon/background workers that mutate substrate.
4. **Inter-controller writes auditor** — re-entrancy patterns where one controller writes to another.

Each agent received a self-contained prompt (no prior conversation context), tight scope, predefined report format, and a single-attempt discipline (no retry loops).

## Headline finding

The archivist surface is **~200+ call sites across 5 caller surfaces**, an order of magnitude beyond the "13 mutation paths" estimate earlier drafts of ADR-0180 used. The "above MCP-dispatch boundary" framing in the original ADR significantly understated the migration scope.

## Findings by agent

### MCP surface auditor (mcp-surface-auditor)

**Total mutating MCP tools: ~110 across 24 surfaces in the published cli surface, plus ~15 in the standalone agentdb MCP server.**

Surfaces by mutating-tool count:
- memory_*: 4
- agentdb_* (cli): ~20
- agentdb_* (standalone server): ~15 (separate entrypoint)
- hive-mind_*: 6
- hooks_*: ~18
- autopilot_*: 6
- claims_*: 8
- task_*: 5
- agent_*: 4
- swarm_*: 2
- session_*: 3
- coordination_*: 5
- workflow_*: 8
- daa_*: 6
- wasm_*: 6
- neural_*: 3
- github_*: 3
- embeddings_*: 4
- performance_*: 4
- system_*: 1
- config_*: 3
- progress_*: 1
- ruvllm_*: 6
- browser_*: 4
- aidefence_*: 5

**Notable findings:**

1. **No existing wrapper above the surface.** The ADR's reference to `bridgeStoreEntry (memory-bridge.ts:518)` is stale — those functions were deleted under ADR-0085. Closest existing chokepoint is `routeMemoryOp` in `cli/src/memory/memory-router.ts:991`, covering ~30% of writes. Half the `agentdb_*` handlers bypass it.

2. **Three parallel store-of-stores patterns:**
   - SQLite via `routeMemoryOp` (~30%): memory_*, half of agentdb_*, parts of hooks_*/daa_*/embeddings_*.
   - File-system JSON via `writeFileSync(getXxxPath(), JSON.stringify(...))`: claims/tasks/agents/swarm/coordination/workflow/neural/github/perf/system/config/progress/ruvllm/daa/wasm. Uniform shape, no shared write primitive.
   - File-system + lock variants: hive-mind WAL stack, workflow pid lock, wasm pid lock, swarm tmp+rename.

3. **`withHiveStoreLock` + `saveHiveState` (hive-mind-tools.ts:1173)** is the most mature in-tree precedent — ordered cross-process locking + tmp+fsync+rename + cache-after-rename invariant (ADR-0095). Recommended as the archivist's reference substrate primitive.

4. **Cross-surface side-writes** that the archivist must serialize correctly:
   - `memory_store` writes `memory_entries` AND triggers `memoryGraph.addNode` (a second substrate).
   - `hive-mind_spawn` writes BOTH `hive-state.json` AND `agents.json` non-atomically.
   - `agentdb_pattern-store` writes `reasoning_patterns` AND falls through to `memory_entries` on failure — the ADR-0179 amplification pattern in miniature.
   - `agentdb_experience_record` writes FK-coupled `learning_sessions` AND `learning_experiences`; orphan sessions possible on partial failure.
   - `agentdb_semantic_add_route` writes both in-memory Map AND `.claude-flow/semantic-routes.json` with explicit fatal-throw on persist failure (hand-rolled correct shape).
   - `agentdb_session-end` cascades into NightlyLearner consolidation across `skills/causal_edges/reasoning_patterns`.

5. **Standalone agentdb MCP server** (`forks/agentdb/src/mcp/agentdb-mcp-server.ts`) is a separate entrypoint with 33 tools (~15 mutating). Either covered by archivist contract OR retired pre-archivist.

6. **Tools that mutate caches on read paths** (memory_search, agentdb_embed, agentdb_filtered_search) classified as READ, not MUTATING — handled by `ReadContext` channel.

### CLI command auditor (cli-command-auditor)

**Direct-write commands (not MCP-mediated, need archivist routing):**

`ruflo memory` family (`cli/src/commands/memory.ts`):
- `ruflo memory store` (:73, routeMemoryOp 'store' :120)
- `ruflo memory delete` (:550, routeMemoryOp 'delete' :576)
- `ruflo memory init` (:1347) — `fs.unlinkSync` of RVF canonical siblings + sidecars (:1453-1469) + `resetRouter()`
- `ruflo memory migrate` (:1864) — paginates list + re-stores each entry; `--from-sqlite` calls `RvfMigrator.fromSqlite()`

`ruflo embeddings cache clear` (embeddings.ts:1386) — routeMemoryOp 'clearNamespace' + fs.unlinkSync on cache db.

`ruflo hooks notify` (hooks.ts:5202) — direct routeMemoryOp 'store' into 'notifications' namespace; **silently swallows failures** (ADR-0082 violation candidate).

`ruflo performance benchmark` (performance.ts:244) — writes 20 entries to 'benchmark' namespace, never cleans up (substrate pollution).

`@claude-flow/cli-core/commands/memory.ts` — SECOND CLI surface via `JsonMemoryBackend` (memory/json-backend.js). Plugin scripts depend on it. Bypasses the main router entirely.

`agentdb` CLI (`forks/agentdb/src/cli/agentdb-cli.ts` + `commands/`):
- `agentdb init` (commands/init.ts:115) — `db.exec(schema)` + writes to `config_settings`
- `agentdb migrate` (commands/migrate.ts:191) — batched insert.run per row across tables
- `agentdb migrate --from sqlite --to pglite` (commands/migrate-sqlite-to-pglite.ts:317) — raw INSERT per row into PGLite
- `agentdb causal add-edge` (agentdb-cli.ts:230) — controller call
- `agentdb causal experiment create` (:260) — BOTH raw INSERT INTO episodes AND `causalGraph.createExperiment` AND `db.save()` (triple-write inconsistency)
- `agentdb learner run` (:2227), `agentdb learner prune` (:2234)
- `agentdb reflexion store/prune` (:2247/2319)
- `agentdb skill create/consolidate/prune` (:2331/2342/2349)
- `agentdb sync push/pull/start-server` (:2371/2420/2451) — QUIC sync mutates substrate on both peers

**Mixed-mode commands** (raw SQL + controller call + manual db.save) — `agentdb causal experiment create` is the worst offender. Exactly the inconsistency the archivist is meant to fix.

**Notable findings:**

1. Two divergent CLI memory backends (cli's router vs cli-core's JsonMemoryBackend) — separate audit-chain implications.
2. `hive-mind spawn` writes via the MCP `hive-mind_memory action:set` tool with an explicit single-writer policy ("the MCP tool's `set` action is the only legal write site"). Precedent the archivist generalizes.
3. `memory init --force` destroys RVF files via `fs.unlinkSync` — below substrate boundary. Either out-of-band admin op or archivist `destroyStore` operation.
4. agentdb CLI is the largest body of direct-controller / raw-SQL work — every controller method needs a wrapper.

### Hooks + daemons auditor (hooks-daemons-auditor)

**Hot-path hook writers:**

- `post-edit` → `intelligence.recordEdit(file)` → **`fs.appendFileSync` to `.claude-flow/data/pending-insights.jsonl`** (intelligence.cjs:662-671). **HOT** — fires on every Edit/Write/MultiEdit. Current budget: <2ms.
- `pre-task` → `session.metric('tasks')` + `router.routeTask()` (read-only routing) — **HOT** (every Agent invocation).

**Moderate-frequency hooks:**

- `post-task` → `intelligence.feedback(success)` → boost/decay confidence, **rewrites `ranked-context.json` and `graph-state.json`** (intelligence.cjs:677-711). **MODERATE** (1/task).

**Cold but heavy:**

- `session-restore` → `intelligence.init()` → may rewrite legacy `auto-memory-store.json` sidecar (intelligence.cjs:467-471). **COLD** (1/session).
- `session-end` → `intelligence.consolidate()` → **inserts new entries, rebuilds edges + PageRank**, writes `graph-state.json`/`ranked-context.json`/`intelligence-snapshot.json`/`consolidation.json`, evicts old entries (intelligence.cjs:717-870). **COLD** but heavy.

The emitted handler `~/.claude/helpers/hook-handler.cjs` (generated by `cli/src/init/helpers-generator.ts:440-578`) dispatches to `intelligence.cjs` and `session` helpers.

`hooks/src/reasoningbank/index.ts:1095-1149` exposes `onPostTask`/`onSessionEnd` calling `AutoMemoryBridge.recordInsight()` + `syncToAutoMemory()` + `curateIndex()` (write MEMORY.md index + topic files).

**Daemons:**

- **worker-daemon (out-of-process `ruflo daemon start`)** — `cli/src/services/worker-daemon.ts`:
  - Queue poll: `setInterval` ~250ms (line 883) — HOT in frequency but no writes per tick.
  - Scheduled workers: `map` 15min, `audit` 30min, `optimize` 60min, `consolidate` 10min, `testgaps` 60min, `benchmark` 2h (disabled). All write to `.claude-flow/metrics/{type}.json`. Aggregate ~5-6 substrate writes/hour.
- **v3-package in-process daemons** (`hooks/src/daemons/index.ts`):
  - MetricsDaemon (30s) — in-memory only.
  - SwarmMonitorDaemon (3s) — in-memory only.
  - HooksLearningDaemon (60s) — calls `reasoningBank.consolidate()`. **MODERATE** if active. **Silently no-ops** if reasoningbank isn't loaded (feedback-no-fallbacks violation).
- **ReasoningBank backing store** (hooks/src/reasoningbank/index.ts:792-841): `storeInAgentDB`/`updateInStorage`/`deleteFromStorage` — namespaces `patterns:short_term` and `patterns:long_term`. Triggered by `recordOutcome`/`storePattern`/`consolidate`. **MODERATE**.
- **AutoMemoryBridge periodic sync** (memory/src/auto-memory-bridge.ts): 60s `setInterval` (line 745). Writes backend + topic markdown + MEMORY.md index. **MODERATE**.
- **MemoryConsolidation controller**: invoked externally; heavy multi-table writes per invocation.

**Notable findings:**

1. **Two parallel consolidation systems write overlapping state**: in-process `intelligence.cjs:consolidate()` (session-end hook) vs worker-daemon's `runConsolidateWorker`. Uncoordinated.
2. `intelligence.cjs` still writes the deprecated `auto-memory-store.json` sidecar on first session of a fresh project despite the file header claiming the sidecar is eliminated.
3. `worker-daemon.crash.log` and `pids/*` are operational, not substrate — excluded from archivist scope.
4. No daemon writes embeddings autonomously; all embed/vector writes flow through explicit controllers via MCP or hook handlers.

### Inter-controller writes auditor (inter-controller-auditor)

**Re-entrancy patterns:**

1. **`NightlyLearner.run()`** (NightlyLearner.ts:204-310) — orchestrates writes across Causal, Reflexion, SkillLibrary:
   - `consolidateEpisodes` (:204-310): reads `episodes`, writes `causal_edges` via `causalGraph.addCausalEdge` (:293).
   - `discoverCausalEdges` (:411): reads episodes, writes `causal_edges`.
   - `pruneEdges` (:576): direct `DELETE FROM causal_edges` (bypasses CausalMemoryGraph).
   - `completeExperiments` (:501): updates `causal_experiments` via `calculateUplift` (CausalMemoryGraph.ts:355).
2. **`MemoryConsolidation.createSemanticMemory`** (MemoryConsolidation.ts:347-381) — cascade: store→markConsolidated (UPDATE rows :427-433)→applyForgettingCurve (DELETE + vectorBackend.remove :447-452). Multi-controller pass.
3. **`SkillLibrary.consolidateEpisodesIntoSkills`** (SkillLibrary.ts:462-585) — reads `episodes` (Reflexion-owned), writes `skills` (:112), writes `skill_embeddings` (:370), writes `vectorBackend.insert('skill:${id}')` (:144). Single call fans out to 3 substrates.
4. **`SyncCoordinator.applyChanges`** (SyncCoordinator.ts:509-650) — INSERT OR REPLACE into `episodes`, `skills`, `skill_edges`, `sync_state` (FOUR tables in one method). Bulk multi-store write.

**Read-then-write (cross-substrate within one controller, NOT re-entrancy):**

- `ReflexionMemory.recordEpisode` (ReflexionMemory.ts:173): INSERT episode + `vectorBackend.insert` (:204) + multi-call `graphBackend.createRelationship` (:913/:937/:953). Single intent = 1 SQL + 1 vector + 3 graph writes.
- `HierarchicalMemory.store` (:265): INSERT row + `hmem_vec` row (:300) + `vectorBackend.insert` (:287).
- `CausalMemoryGraph.addCausalEdge` (:204-232): INSERT `causal_edges` + `vectorBackend.insert('causal-edge:...')`.

**Re-entrancy implications for the Archivist:**

1. **Nested MutationContext required.** Multi-controller orchestrators need a parent `auditId` with child entries — otherwise pruneEdges + experiment completion + consolidation look like independent top-level writes that share a timestamp.
2. **Same-controller multi-substrate ≠ re-entrancy.** ReflexionMemory.recordEpisode writing SQL+vector+graph is one atomic intent, one audit entry covering N substrate touches.
3. **Bulk-import paths bypass per-row hooks.** SyncCoordinator.applyChanges writes hundreds of rows. Archivist needs a `bulk` mode emitting one summary audit entry + diff manifest.
4. **Direct SQL bypasses sibling controllers.** NightlyLearner.pruneEdges issues raw `DELETE FROM causal_edges` instead of CausalMemoryGraph methods. Archivist contract must require all writes through owning controllers or document the bypass.
5. **Promotion is synchronous re-entry, not async event.** MemoryConsolidation.createSemanticMemory calls hierarchicalMemory.store(...) inline during its own write. `MutationContext` needs a `child(reason)` method.

## Synthesis decisions (integrated into ADR-0180)

The audit drove ten ADR changes:

1. **§Archivist placement** reframed: "sits between any in-process caller and substrate", not just MCP dispatch.
2. **§Caller surfaces** added: enumerates all 5 caller types with concrete counts.
3. **§Re-entrancy** added: `MutationContext.child(reason)` for nested writes; same-controller multi-substrate explicitly NOT re-entrancy.
4. **§Bulk-write mode** added: `MutationContext.bulk(intent, payload)` for sync/migrate paths with a summary audit entry + diff manifest.
5. **§Performance and hot paths** added: fast-path opt-in for `post-edit`/`pre-task` (in-memory ring buffer, batched fsync ≤100ms, guard skipped, async post-write).
6. **§Migration concerns** rewritten: ~200+ call sites; revised surface-by-surface migration strategy (Phases 2-10).
7. **Pros and Cons §chosen option** "Bad" bullet updated: "200+ call sites across 5 caller surfaces" replaces "13 paths."
8. **Open follow-up #7** rewritten: replaces parallel migration with phased strategy.
9. **Open follow-ups #8-#14** added: standalone agentdb MCP server disposition; cli-core JsonMemoryBackend disposition; three parallel store-of-stores convergence; two parallel consolidation systems overlap; re-entrancy + bulk-mode load testing; hot-path concrete budget; pre-existing best-effort failures unrelated to archivist.
10. **`withHiveStoreLock` + `saveHiveState`** identified as the reference substrate primitive worth lifting.

## Process notes

- **Team:** `adr-0180-callers` created via TeamCreate; 4 agents spawned in parallel via Agent tool with `team_name` + `name` + `run_in_background: true`.
- **Discipline:** each agent prompted with a self-contained brief, single-attempt rule, no Monitor, no retries on tool failures. Per `feedback-single-arm-experiment-prompt-discipline.md`.
- **Reporting:** agents used SendMessage to deliver findings to team-lead; messages auto-rendered to user.
- **Tasks:** 5-task list (1 per agent + 1 synthesis) tracked via TaskCreate/TaskUpdate.
- **Outcome:** all 4 agents reported within ~25 minutes; synthesis + ADR update + HTML re-export completed by team-lead.
- **Cleanup:** agents shut down via SendMessage `shutdown_request`; team cleaned via TeamDelete.

## Related

- [ADR-0180](../adr/ADR-0180-adopt-thin-memory-coordinator-with-type-enforced-mutation-handlers.md) — the decision this audit informs
- [ADR-0179 council r1](ADR-0179-council-r1-bridge-deletion.md), [r2](ADR-0179-council-r2-axis-architecture.md), [r3](ADR-0179-council-r3-bridge-coordination.md) — the deliberation that motivated ADR-0180
- An earlier ADR-0180 research swarm (511b7d3 verification, type-enforcement substrate-handle pattern, replay determinism, read-side metadata channel, split/governance recommendation) ran in the same session but was not separately archived — its findings are integrated into ADR-0180's Architecture and Open follow-ups #4-#6 directly.
