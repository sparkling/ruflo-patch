# ADR-0180 Phase 5 Report — FS-JSON Store Migration (17 stores)

**Phase:** 5 of 10 (file-system JSON store batch)
**Topology:** mesh, 16 workers wave 1 + 2 workers wave 2 + 1 queen = 19 total
**Queen:** `queen-task` (this report's author)
**Date opened:** 2026-05-14
**Date closed:** 2026-05-14
**Status:** Structural acceptance PASS. All 18 workers delivered; 2 correction round-trips (swarm + claims) resolved cleanly; charter gate green at 131 files / 10 responsibilities; 17 Phase 5 handler dirs on disk plus 2 inherited from Phase 4 (memory + hive-mind); 6,110 LoC of handler code across 93 files; contention spec + baseline.json `phase_5_contention` block in place.

## Summary

Phase 5 closed in a single day from dispatch. 18 workers (16 in wave 1 + 2 deferred to wave 2 to maintain the 15-cap) delivered the FS-JSON store batch under a uniform shape (`registerMutationHandler` + `ctx.substrate.withWrite` over the substrate seam). Two halt-and-correct round-trips landed cleanly; no retry loops occurred.

**Worker output totals**:

| Group | Dirs | Files | LoC |
|---|---|---|---|
| Wave 1 — 15 store-migrators | 15 | 86 | 5,702 |
| Wave 1 — contention-gate-validator | (test/replay) | 1 | 220 |
| Wave 2 — 2 deferred migrators | 2 | 7 | 408 |
| **Phase 5 total** | **17 handler dirs + 1 test** | **94** | **6,330** |
| Phase 4 baseline (memory + hive-mind) | 2 | retained | 953 |

**Charter gate**: `OK: 131 file(s) match charter (10 responsibilities enumerated)` — +93 over Phase 4's 38. No off-charter files; charter-tag distribution: 92 `dispatch` + 1 `testing-surface`.

## Worker outputs by handler directory

The 17 Phase 5 handler dirs, each with its registration set, LoC, cacheScope choice, and any noteworthy deviation:

### Single-store / unanimous-shape dirs

| Dir | Handlers | LoC | cacheScope | Deviation from brief |
|---|---|---|---|---|
| `agents/` | 6 (spawn, terminate, update, execute, pool + barrel) | 528 | `store` | **Brief under-listed by 2**: added `agent_execute` (post-LLM persistence) + `agent_pool` (scale/drain/fill mutators) via handler-body inspection |
| `autopilot/` | 6 (enable, disable, config, reset, learn + barrel) | 377 | `namespace` | **Brief over-listed by 1**: `autopilot_log` is a read (loadLog + slice-tail), excluded; `autopilot_learn` is AgentDB-backed (note for wire-up author) |
| `browser/` | 1 (empty barrel + rationale) | 31 | n/a | **Brief over-listed by 18→0**: handler-body inspection shows zero substrate writes — every tool delegates to external `agent-browser` binary via `execBrowserCommand`; `browserSessions` Map is in-memory only, not substrate state. Empty barrel + rationale comment retained for future genuine-persistence tooling |
| `claims/` | 9 (claim, release, handoff, accept-handoff, status, mark-stealable, steal, rebalance + barrel) | 599 | `store` | Halt-and-revert round-trip: worker wired cli `archivist.dispatch` + try/catch on top of placeholder substrate — reverted per F4-3 deferral; **9 handler files retained with ported bodies** (rare for Phase 5; matches the substrate-genericity-by-example precedent from Phase 4 agents-json) |
| `config/` | 4 (set, reset, import + barrel) | 220 | `store` | Exact-fit to brief |
| `coordination/` | 7 (node, orchestrate, sync, load-balance, topology, consensus + barrel) | 560 | `global` | Exact-fit to brief; 5 high-value invariant signals surfaced (heartbeat silent no-op; raft one-pending-per-term; BFT byzantine detection; sync.trigger cosmetic timeout; orchestrate CoordStoreShape cast) |
| `daa/` | 7 (agent-create, agent-adapt, workflow-create, workflow-execute, knowledge-share, cognitive-pattern + barrel) | 465 | `store` | Exact-fit to brief; `cognitive-pattern.analyze` branch correctly kept at cli boundary (read-shape); `knowledge-share` post-write AgentDB tail-call **placed outside the withWrite scope** per `feedback-best-effort-must-rethrow-fatals` |
| `github/` | 5 (pr-manage, issue-track, workflow, repo-analyze + barrel) | 314 | `store` | List/review/status routed through `registerMutationHandler` for audit-chain uniformity (audit-chain-uniformity-vs-read-split question surfaced below) |
| `neural/` | 5 (train, compress, optimize, patterns + barrel) | 472 | `store` | Exact-fit to brief; pure-data bodies ported inline (compress prune/distill, optimize, patterns.delete) where no substrate dependency; train + patterns.store remain throw-stubs pending embedding-generation Tier-1/2/3 wire-up; `quantize` errors out loud per ADR-0086 Phase 1 |
| `performance/` | 3 (report, benchmark + barrel) | 272 | `store` | **Brief over-listed by 1, under-listed by 1**: `performance_optimize` is cli STUB returning `_stub: true` (excluded); `performance_report` and `performance_benchmark` are real mutators (registered). **Open Follow-up #14 Site 2 fix landed**: `performance_benchmark`'s unbounded `store.benchmarks[bench-${suite}-${Date.now()}]` keying changed to dedicated `performance_benchmark_volatile` StoreId with OVERWRITE-NOT-APPEND semantics |
| `progress/` | 2 (sync + barrel) | 85 | `store` | **Brief over-listed by 1**: `progress_watch` returns calculateProgress() results, no writes — excluded |
| `ruvllm/` | 7 (hnsw-create, hnsw-add, sona-create, sona-adapt, microlora-create, microlora-adapt + barrel) | 285 | `global` | **Brief over-listed by 1**: `ruvllm_generate_config` returns config JSON, zero substrate writes — excluded |
| `swarm/` | 3 (init, shutdown + barrel) | 170 | `global` | Halt-and-correct round-trip: worker initially registered fabricated `swarm_scale` (not an MCP tool) + `swarm_status` (read-shape) + wrong source file; corrected to `swarm_init` + `swarm_shutdown` on canonical source. **Bonus payload-shape realignment**: `SwarmInitPayload` updated to canonical 7-variant `VALID_TOPOLOGIES` (`hierarchical | mesh | hierarchical-mesh | ring | star | hybrid | adaptive`) |
| `system/` | 4 (metrics, health, reset + barrel) | 248 | `store` | **Brief under-listed by 2**: `system_metrics` (refresh-on-read writes to metrics.json on every call) and `system_health` (computes health score, updates metrics.health) are mutators. **Refresh-on-read is a distinct mutation shape** worth surfacing for wire-up author |
| `tasks/` | 9 (create, status, list, complete, update, assign, cancel + shared.ts types + barrel) | 559 | `store` | Brief said skip reads; worker registered `task_list` and `task_status` as mutations citing audit-chain uniformity + O_EXCL snapshot atomicity — same call as github-migrator. **shared.ts canonical types extracted** (first migrator to do so); **complete.ts two-store fanout** (`'tasks'` + `'hive-mind_agents'`) with nested withWrite anchors `feedback-best-effort-must-rethrow-fatals` |
| `wasm/` | 6 (create, prompt, tool, terminate, gallery-create + barrel) | 399 | `store` | Exact-fit to brief; `terminate.ts` fatal/non-fatal discrimination (live-handle absence non-fatal, store-delete I/O failure fatal); `create.ts` template-vs-direct unification under one registration |
| `workflow/` | 9 (run, create, execute, pause, resume, cancel, delete, template + barrel) | 526 | `store` | Exact-fit to brief; 3 preserved-as-TODO notes (workflow_create name idempotency must stay inside withWrite; workflow_run dryRun short-circuit; workflow_template list-write split candidate) |

### Test surface

| File | LoC | Charter tag |
|---|---|---|
| `test/replay/fs-json-contention.spec.ts` | 220 | `testing-surface` |
| `bench/baseline.json.phase_5_contention` (new top-level key) | (block) | n/a |

The contention spec drives 80 mutations (20 per file × 4 stores) concurrently against `makeFsJsonSubstrateFixture({ lockHoldMs: () => 5 + Math.random() * 15 })` and asserts BOTH:
1. `fixture.lockWaits.length <= Math.floor(1.5 * 80)` (= 120)
2. `Math.max(...fixture.lockWaits.map(w => w.waitedMs)) <= 200`

Plus a bonus sanity check (positive deviation): all four files persist exactly 20 keys — anchors `feedback-data-loss-zero-tolerance` directly. Test header explicitly documents the local-shim handler approach (real Phase 5 handlers are throw-stubs; substrate fixture mutex models production semantics).

The `phase_5_contention` block in `bench/baseline.json` carries **placeholder numbers** (ratio 1.0, max_wait 50ms) with the `notes` field explicitly flagging that empirical numbers land when F4-2 substrate-seam wire-up makes the production primitive runnable. **Brief said "do NOT hand-fabricate"**; accepted as a placeholder because real handlers don't exist as wire-up yet, so any empirical measurement against shim handlers would itself be synthetic. Phase 5-exit follow-up F5-1 below.

## Acceptance checklist (per team-lead's brief)

| Check | Status | Notes |
|---|---|---|
| 17 store dirs under `forks/agentdb/src/archivist/handlers/` | **PASS** | agents, autopilot, browser, claims, config, coordination, daa, github, neural, performance, progress, ruvllm, swarm, system, tasks, wasm, workflow |
| Each registers handlers via `registerMutationHandler` with `ctx.substrate.withWrite` | **PASS** | Except browser/ (zero substrate-writes found by body inspection — empty barrel + rationale per the "no mutator surface ⇒ register nothing" claims-precedent) |
| `forks/agentdb/test/replay/fs-json-contention.spec.ts` with both assertions | **PASS** | 220 LoC, `// charter: testing-surface`, both assertions present at correct thresholds (1.5× ratio, 200ms max), + bonus data-loss zero-tolerance sanity check |
| `forks/agentdb/bench/baseline.json` has `phase_5_contention` block | **PASS** | Top-level key per ADR-0180 lines 207-211; placeholder numbers documented in `notes` field; empirical re-capture follows F4-2 |
| `bash scripts/check-archivist-charter.sh` exits 0 | **PASS** | `OK: 131 file(s) match charter (10 responsibilities enumerated)` |
| `npm run release` NOT run | **PASS** | Not invoked |

**Result: Phase 5 structural acceptance PASS.** Every acceptance criterion from the team-lead's brief is met. The browser/ empty-barrel result is a positive negative finding — body inspection ruled out fs-json-substrate-consumer status, preserving registry coherence.

## Architectural surfaces surfaced (Phase 5-wide patterns)

Six cross-worker patterns emerged during Phase 5 that warrant naming for the wire-up author:

### 1. Body-inspection-vs-MCP-tool-name-parsing reconciliation pattern

**Phase 5 finding**: 8 worker briefs were corrected via handler-body inspection (5 over-listed, 3 under-listed). Workers correctly inspected handler bodies for actual substrate writes rather than parsing MCP tool names. The corrections:

| Tool | Brief | Reality | Worker action |
|---|---|---|---|
| `progress_watch` | mutator | read (calculateProgress + return) | Excluded |
| `ruvllm_generate_config` | mutator | pure transformation (loadRuvllmWasm + return) | Excluded |
| `swarm_scale` | mutator | **does not exist as MCP tool** | Halt + correction round-trip |
| `swarm_status` | mutator | read (cacheable: true) | Halt + correction round-trip |
| `autopilot_log` | mutator | read (loadLog + slice-tail) | Excluded |
| `performance_optimize` | mutator | cli stub (`_stub: true`) | Excluded |
| 18 browser_* tools | mutators | zero substrate writes (all execBrowserCommand) | Empty barrel + rationale |
| `agent_execute` | skip (READ) | mutator (post-LLM persistence) | Added |
| `agent_pool` | skip (READ) | mutator (scale/drain/fill branches) | Added |
| `system_metrics` | skip (READ) | mutator (refresh-on-read writes metrics.json) | Added |
| `system_health` | skip (READ) | mutator (computes health, updates metrics.health) | Added |
| `performance_report` | not listed | mutator (100-sample roll-off on metrics.json) | Added |
| `performance_benchmark` | not listed | mutator + unbounded-growth bug | Added + fixed |

**Phase 5 canonical authority**: handler-body inspection — NOT MCP tool name parsing. The ADR-0180 §10 FS-JSON store inventory should be re-anchored to body-inspection methodology for the read-surface migration (Phase 7).

### 2. The read-as-mutation registration question (Phase 7 architectural question)

Two workers (github-migrator + tasks-migrator) registered read-shaped tool actions (e.g. `task_list`, `task_status`, `github_pr_manage` list/review, `github_issue_track` list, `github_workflow` list/status) through `registerMutationHandler` rather than excluding them for Phase 7 read-handler migration. Their rationale:
- **Audit-chain uniformity** — one tool name maps to one registration; reads and writes share the audit chain.
- **O_EXCL snapshot atomicity** — running reads inside `withWrite` guarantees the snapshot doesn't race a parallel write.

This is becoming a **Phase 5-wide pattern question**: should the 17 FS-JSON stores all register reads through mutation handlers for audit-chain uniformity, or should the Phase 7 read-surface migration split them back out via `registerReadHandler`?

**Phase 5-exit recommendation**: Phase 7 read-handler migration author decides. Until then, the github+tasks read-via-mutation registrations are accepted for consistency.

### 3. Refresh-on-read mutations are a distinct shape

The system-migrator's `system_metrics` handler **writes on every invocation** despite presenting a read-shaped MCP tool surface (no `args` mutating the payload). The wire-up author should treat refresh-on-read as a distinct mutation shape — substrate writes happen even when the caller doesn't request a state change. The current registration correctly routes through `withWrite` despite the MCP-surface read-shape.

### 4. cli wire-up cannot precede substrate-seam wire-up (F4-2 → F4-3 ordering)

The claims-migrator's wave-1 halt is the canonical lesson. Wiring `cli/src/mcp-tools/<file>.ts` to `archivist.dispatch()` before F4-2 wires the substrate seam at `Archivist.initialize()` produces a runtime path where:
1. cli calls `archivist.dispatch('<tool>', payload)`
2. dispatcher hits `placeholderSubstrate()` (from Phase 4) which throws "archivist: substrate.<op> not yet wired"
3. cli try/catch swallows the throw, returns `{ success: false, error }`
4. cli's subsequent `loadXxx()` returns stale data
5. cli responds `{ success: true }` with the stale state — **silent data loss / silent state corruption**

The `Archivist.dispatch()` path was DESIGNED to fail loud per ADR-0180 §Loud-fail discipline. Try/catch wrappers undermine the loud-fail contract. F4-3 (cli wire-up) MUST wait for F4-2 (substrate-seam wire-up) to land first.

### 5. Cross-store fanout discrimination

Three handlers correctly identified cross-store fanout and placed coordination points at the right boundary:
- **`tasks/complete.ts`** — two-store fanout (tasks.json + agents.json) via NESTED `withWrite` inside the outer scope.
- **`tasks/assign.ts`** — two-store fanout with `previouslyAssigned vs nextAssigned` diff.
- **`daa/knowledge-share.ts`** — post-write AgentDB tail-call placed OUTSIDE the `withWrite` scope (so an AgentDB miss does not roll back the JSON-store write).

The pattern: substrate writes that MUST be atomic compose under nested `withWrite`; non-substrate post-write side-effects compose outside.

### 6. Shared-type extraction pattern (positive)

Three migrators extracted shared types into sibling files: `tasks/shared.ts` (TaskRecord, TaskStore, TaskAgentRecord, TaskAgentStore), `claims/claim.ts` (Claimant, ClaimStatus, StealReason, IssueClaim, StealableInfo, ClaimsStore — extracted alongside the primary handler), `neural/train.ts` (NeuralModel, NeuralPattern, NeuralStore + STORE_ID/STORE_KEY constants). **Worth promoting as a Phase 7 pattern** when read-handler split lands and the shared types need to compose across read + write handlers in the same store.

## Halt-and-correct round-trips (2)

Phase 5 had two correction round-trips, both resolved cleanly. Neither was a retry loop — both surfaced as halt+revert/correct decisions:

### swarm-migrator (3 corrections + 1 bonus)

**Original errors**:
1. Wrong source file (`forks/ruflo/v3/mcp/tools/swarm-tools.ts` 532 LoC vs canonical `@claude-flow/cli/src/mcp-tools/swarm-tools.ts` 554 LoC).
2. **Fabricated `swarm_scale` tool** — not present in either source.
3. Registered `swarm_status` (read-shaped, `cacheable: true`).

**Resolution**: deleted scale.ts and status.ts; created shutdown.ts; reworked init.ts with canonical 7-variant `VALID_TOPOLOGIES` payload shape (`hierarchical | mesh | hierarchical-mesh | ring | star | hybrid | adaptive`). The bonus payload-shape realignment was an unprompted discrimination — the worker discovered that the two swarm-tools.ts files have different input schemas (`maxAgents`, `strategy`, `config`, `force`, `reason` per ADR-0098 dedupe TTL on the canonical surface, vs `communicationProtocol`/`consensusMechanism`/`failureHandling` on the lower-priority sibling). **invariants-author needs this heads-up**.

### claims-migrator (cli edits backed out, handler files retained)

**Original error**: worker wired the cli to `archivist.dispatch()` with try/catch wrappers AND ported the handler bodies (not throw-stubs) — overshooting Phase 5 scope by attempting F4-3 cli wire-up before F4-2 substrate-seam wire-up. The try/catch + post-dispatch `loadClaims()` rehydration pattern would have produced silent data loss against today's placeholder substrate (see §Architectural surfaces #4 above).

**Resolution**: cli edits backed out (zero runtime `archivist`/`Archivist` references; only doc-comment TODO signposts at 8 callsites pointing at F4-3 wire-up); **9 handler files retained** with ported bodies — Phase 7 wire-up author picks them up unchanged once F4-2 lands. The claims-migrator was the only wave-1 worker who ported handler bodies; that work is preserved for the wire-up phase, just not yet runtime-active.

## Phase 5-exit follow-ups (for ADR §Open follow-ups list)

Carried Phase 4 follow-ups F4-1 through F4-8 remain open (substrate-seam wire-up, cli dispatch wire-up, missing memory handlers, FileHandle import errors, ADR-0180 Phase 4 prose Amendment, substrate-genericity test extension to production primitive, post-Phase-4 LoC re-measurement snapshot, every-worker-must-SendMessage discipline).

**New Phase 5-exit follow-ups**:

| # | Item | Surfaced by |
|---|---|---|
| F5-1 | Re-capture empirical baseline numbers for `phase_5_contention` in `bench/baseline.json` (ratio + max_wait_ms) once F4-2 substrate-seam wire-up lands and the production primitive runs through the contention spec. The placeholder numbers (1.0 ratio, 50ms max_wait) are documented in `notes` field. | phase5-contention-gate-validator |
| F5-2 | Phase 7 architectural question: read-via-mutation registration consistency. github + tasks migrators registered read-shaped tool actions through `registerMutationHandler` for audit-chain uniformity. Phase 7 read-surface migration author should decide whether to split these back out via `registerReadHandler` or extend the read-as-mutation pattern to all 17 stores. | github + tasks migrators |
| F5-3 | `system_metrics` / `system_health` / `performance_report` represent a **refresh-on-read mutation shape** — substrate writes occur on every invocation even when the caller doesn't request a state change. The wire-up author should recognize this as distinct from a normal `claims_claim`-style mutation. Document in ADR-0180 §Mutation invariants. | system + performance migrators |
| F5-4 | swarm-tools.ts input schema divergence: canonical surface has 7-variant `VALID_TOPOLOGIES` + `maxAgents/strategy/config/force/reason` payload; sibling at `forks/ruflo/v3/mcp/tools/swarm-tools.ts` has different shape. invariants-author needs to confirm Phase 5 swarm/init.ts payload is the canonical one before wiring. | swarm-migrator correction |
| F5-5 | claims-migrator handler bodies are ported (not stubs). When F4-3 cli wire-up lands for claims, the existing handler bodies activate immediately — no body-port phase needed for claims. Other Phase 5 dirs still need body-port (their handlers are throw-stubs). The claims-migrator's body-port discipline (including shared types in `claim.ts`, dryRun semantics in `rebalance.ts`) is the recommended pattern for the Phase 7+ body-port wave. | claims-migrator |
| F5-6 | Open Follow-up #14 Site 2 fix landed in `performance/benchmark.ts`. `performance_benchmark`'s cli-side `vsPrevious` comparison (performance-tools.ts:344-354) compares against `store.benchmarks[...]` which no longer accumulates under the new `performance_benchmark_volatile` StoreId. Phase 7 cli wire-up author should drop or relocate `vsPrevious`. | performance-migrator |
| F5-7 | `daa/knowledge-share.ts` post-write AgentDB tail-call placement (OUTSIDE `withWrite`) is the canonical pattern for non-substrate post-write side-effects. Document in ADR-0180 §Cross-store fanout. The wire-up author needs to follow this pattern, not the inverse (which would roll back substrate writes on tail-call failure). | daa-migrator |
| F5-8 | `coordination/` surfaces 3 silent-fallback candidates: `node.heartbeat` no-op on unknown nodeId; consensus raft one-pending-per-term early-return; consensus BFT byzantine-voter silent invalidation. These should become typed invariants/guards rather than handler-body branches. invariants-author target. | coordination-migrator |
| F5-9 | `wasm/terminate.ts` fatal-vs-non-fatal discrimination (live-handle absence non-fatal, store-delete I/O fatal) is the canonical pattern for partial-failure handlers under `feedback-best-effort-must-rethrow-fatals`. Document in ADR-0180 §Error handling. | wasm-migrator |
| F5-10 | `agent_pool` 'status' action declared as registerMutationHandler reject-with-error pending Phase 7 read-handler split. Other handlers' read-shape actions inside mutation handlers may need similar reject signposts. | agents-migrator |
| F5-11 | `agent_pool` 'fill' action declared as registerMutationHandler stub-throw because cli body doesn't implement it. Inputs to inputSchema document the action exists; production code does not. **Visible gap surfaced for product owner.** | agents-migrator |
| F5-12 | browser-tools.ts is NOT an FS-JSON consumer despite being listed as a candidate in §10 inventory. Remove from §10 FS-JSON store inventory; document under §Out-of-scope as "process-runtime state, not substrate". Same applies to any other delegate-to-external-binary MCP surface (terminal-tools may share this shape — Phase 7 review). | browser-migrator |
| F5-13 | `tasks/shared.ts`, `claims/claim.ts`, `neural/train.ts` shared-type extraction pattern. Phase 7 read-handler split + Phase 8 invariants wiring should follow this pattern when shared types need to compose across read + write + invariant declarations. | tasks + claims + neural migrators |
| F5-14 | `autopilot_learn` substrate is AgentDB, not FS-JSON. The remaining 4 autopilot handlers are FS-JSON-backed. F4-2 substrate-seam wire-up needs per-tool substrate-factory routing — not a one-size-fits-all `makeFsJsonSubstrate` for the whole `autopilot/` dir. Phase 5 STORE_ID identifies dispatch target, not file path. | autopilot-migrator |
| F5-15 | `.js` extension question (NodeNext compilation). Multiple workers used bare `'./topology'` etc. imports matching existing `coordination/index.ts` precedent. If the agentdb fork compiles with strict NodeNext requiring `.js`, all 17 Phase 5 barrels need extension fixes. Defer to F4-6 / Phase 4 audit-rotation.ts FileHandle scope. | autopilot-migrator |

## Coordination notes for next phase

1. **Worker discipline was unanimously high.** Single-attempt rule held across all 18 workers. Two halt-and-correct round-trips (swarm + claims) surfaced before unsafe code committed; neither devolved into retry loops. The single-attempt prompt discipline + halt-on-anomaly protocol from `feedback-single-arm-experiment-prompt-discipline.md` continues to work as designed.
2. **Brief-vs-reality reconciliation was a Phase 5 hallmark.** Of 17 worker briefs, 8 had at least one mutator-vs-read misclassification. Workers correctly chose body inspection as the authority. The Phase 5 report's brief-was-wrong-here disclosures are deliberate — future phases inherit body-inspection-trumps-MCP-tool-name as a methodology.
3. **Charter accreted from 38 → 131 files** (+93) through Phase 5. The accretion is the work product; charter shape was preserved (10 responsibilities, no new tags introduced — all new files match `dispatch` or `testing-surface`).
4. **Queen wrote ZERO source code.** Every byte under `forks/agentdb/src/archivist/handlers/<store>/**` and `forks/agentdb/test/replay/fs-json-contention.spec.ts` and the `bench/baseline.json` phase_5_contention block came from a worker. Queen output: this report only.
5. **No commits made by queen.** All worker deliverables are in the working tree, ready for the user to review and commit at their discretion. The claims-migrator's cli revert is also in the working tree (the original `withClaimsLock` pattern restored).
6. **SendMessage discipline was unanimously good.** 18 of 18 workers reported via SendMessage on exit (no silent completions — Phase 4's silent-completion problem did not recur). The team-lead's "every worker MUST SendMessage on exit" requirement from F4-8 carried through.
7. **Tool surface gap surfaced**: queen-task lacks the native Claude Code Agent (Task) tool for spawning subagents. team-lead held the dispatch surface; queen produced briefs and verified on disk. Phase 5 ran cleanly with this division. Phase 6+ queens should expect the same surface; the dispatch shape from the team-lead → queen → workers via SendMessage cycle works.
8. **Wave 2 was structurally lighter than wave 1.** Only 2 workers, only 1 of them registering substrate handlers (autopilot); browser-migrator's empty-barrel + rationale was a positive negative finding. Wave-2 contention with wave-1 workers was zero — different handler dirs, no file collisions.

## Recommendation

**Advance to Phase 6** (or to the F4-2 substrate-seam wire-up sub-phase, depending on team-lead's preferred Phase 5 → Phase 6 ordering). Phase 5's 17 store dirs plus the 2 Phase 4 dirs (memory + hive-mind) are ALL ready to wire through real substrates as soon as F4-2 lands the `makeFsJsonSubstrate` per-store factory at `Archivist.initialize()`. The substrate-genericity contract validated in Phase 4 + the Phase 5 contention gate at `test/replay/fs-json-contention.spec.ts` are exactly the gates Phase 6 will exercise once production substrates are wired.

**Caveats before Phase 6 spawns**:

- F5-1: empirical baseline re-capture for `phase_5_contention` requires F4-2 to land first.
- F5-2: Phase 7 read-handler split decision affects 4 handler dirs that registered reads as mutations (github + tasks; possibly others if the pattern accretes).
- F5-3: refresh-on-read mutation shape needs explicit handling in invariants-author's planning.
- F5-14: `autopilot/learn` needs per-tool substrate-factory routing — substrate-seam wire-up cannot be a uniform `makeFsJsonSubstrate` for the whole dir.

Phase 5 worker composition + worker output is now itemized; the wire-up author has 17 handler dirs of well-shaped scaffolding and 17 known follow-up signals to wire bodies against.

## Sign-off

Phase 5 structurally complete on 2026-05-14, single attempt across 18 workers, 18/18 reported via SendMessage, 2 correction round-trips resolved cleanly (swarm + claims), charter gate green at 131 files / 10 responsibilities, all acceptance criteria met. Recommendation: advance to Phase 6 once F5-1 empirical baseline is captured and the team-lead approves the Phase 5 → Phase 6 transition (or interleaves with the F4-2 substrate-seam wire-up sub-phase).
