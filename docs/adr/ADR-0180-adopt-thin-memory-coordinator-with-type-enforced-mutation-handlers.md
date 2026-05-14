---
status: accepted
date: 2026-05-13
accepted: 2026-05-14
tags: [memory, architecture, mcp, governance, substrate]
supersedes: [ADR-0112]
depends-on: [ADR-0177]
implements: []
---

# Adopt the Memory Archivist: a Type-Enforced Authority for Reads and Writes

## Context and Problem Statement

The fork has lived under three contradicting rules at once:

* **ADR-0085** deleted the upstream bridge, treating it as a temporary chokepoint that had been only half-wired (5 of 13 mutation paths guarded) and observed to amplify writes 3-4× silently.
* **ADR-0112** forbade cross-store coordination in response to that amplification, prescribing direct store→substrate writes with no archivist above.
* **ADR-0177** pivoted to "RVF-primary substrate" with per-store carve-outs to SQLite, retaining both `memory_*` and `agentdb_*` MCP surfaces.

The contradiction surfaces every time we need a cross-cutting concern (mutation guard, attestation log, tiered cache, BM25+semantic fusion, explainable recall provenance, skill auto-promotion — the six features ADR-0179 catalogs). ADR-0085 dropped the place where these used to live; ADR-0112 forbids re-introducing it at substrate; ADR-0177 doesn't say where they go. Each of the six is currently either orphaned, stub-only, or scattered across stores with no single audit chain.

A three-round council (ADR-0179 r1/r2/r3) converged on a single answer: re-introduce an archivist, but place it **above** the MCP surfaces (not at substrate, where it amplified writes upstream) and **enforce it at the type system** (not at runtime convention, where upstream forgot to wire it).

## Decision Drivers

* The six lost features each need a single chokepoint above substrate — scattering them across 13 stores re-creates the audit-chain gap ADR-0179 documents.
* Upstream's bridge failed for two distinct reasons: (a) it sat too low, fanning out to four downstream writers with no dedup; (b) it relied on convention to be called. The fix must address both, not just one.
* RVF-primary is operationally impossible as RVF-only (memory `project-rvf-primary` + ADR-0166 amendment): graph projections, claim boards, session stores, and telemetry spans need relational queries RVF cannot serve. Coordination must accept multi-substrate as permanent.
* ADR-0112's "no coordinator" rule has produced 3 months of governance gridlock (six features stranded; ADR-006 upstream stuck in "Proposed"). The fork needs to ship an archivist that doesn't replay the upstream failure mode.
* `feedback-data-loss-zero-tolerance`: an archivist that silently amplifies writes is a hard fail. Type-enforcement is the only mechanism that prevents convention-based bypass.

## Considered Options

* **Re-introduce bridge at substrate (upstream's pattern)** — Place the coordination layer below MCP surfaces, between stores and substrate. Rejected upstream by ADR-0112; rejected here for the same write-amplification reason.
* **No archivist, store convention (ADR-0112 status quo)** — Each store calls audit/cache/guard primitives directly. Status quo; produces the six-feature scatter and the audit-chain gap ADR-0179 catalogs. Three months of evidence this doesn't work.
* **Thin archivist at MCP-dispatch boundary, runtime-enforced** — Archivist above both `memory_*` and `agentdb_*` MCP surfaces; stores call into substrate normally; convention requires routing mutations through the archivist. Same failure mode as upstream's bridge — relies on every caller remembering.
* **Thin archivist at MCP-dispatch boundary, type-enforced (chosen)** — Archivist above both MCP surfaces; stores expose substrate access only as branded types: writes as `GuardedWrite<T>` returned by `registerMutationHandler<T>`, reads as `GuardedRead<T, R>` returned by `registerReadHandler<T, R>`. The substrate handle (`better-sqlite3`/RVF) lives in an `archivist/`-path-restricted module and is delivered to handlers only via `MutationContext.substrate`. Under the project's tsconfig, no first-party store-tree code can *accidentally* obtain a substrate handle outside this channel — `import { db } from '../substrate-internal'` fails at type-check. The claim is "no accidental bypass", not "no determined bypass": a hostile contributor can defeat the channel in <30 LoC via `as any` + module-singleton retention of a fixture handle from `test-utils/` (see Follow-up #20 for the `test-utils/` allowlist closure). Runtime `MutationContext`/`ReadContext` assertions + ESLint `no-restricted-imports`/`no-restricted-syntax` catch residual accidental escapes; review remains the backstop for hostile escapes.

## Decision Outcome

Chosen option: **"Thin archivist at MCP-dispatch boundary, type-enforced"** — a single decision composed of two separable claims:

1. **Placement: above MCP dispatch, not at substrate.** The archivist orchestrates per-store writes serially with audit between steps, eliminating upstream's 3-4× silent fanout amplification (the failure mode ADR-0085 deleted the bridge to escape). Placement reconciles ADR-0177's dual-substrate reality with ADR-0179's audit-chain requirement.

2. **Enforcement: type system, not runtime convention.** Stores expose substrate access only through branded `GuardedWrite<T>` / `GuardedRead<T, R>` types reachable only from `MutationContext` / `ReadContext`. The substrate handle itself is path-restricted to the archivist tree (see Architecture §Type enforcement), so intra-store substrate-direct calls fail at type-check. Eliminates upstream's "forgot to wire it" failure mode (the reason ADR-006 upstream is stuck in "Proposed"). Satisfies `feedback-data-loss-zero-tolerance` without relying on every future contributor remembering a rule.

These two claims are bound together: runtime-enforced placement (rejected option #3) re-introduces the upstream failure this ADR was written to prevent. Council ADR-0179 r3 settled the type-vs-runtime distinction; this ADR ratifies it.

### Consequences

*Placement:*

* Good, because the archivist orchestrates per-store writes serially rather than in fanout — the 3-4× silent amplification cannot recur.
* Good, because all six lost features land in one auditable location, not scattered across 13 stores.
* Good, because ADR-0112's three-month governance gridlock ends — the "no coordinator" rule is retired with an explicit alternative addressing its motivating concern (write amplification at substrate).
* Good, because RVF-primary with permanent SQLite carve-outs is the documented substrate posture — ADR-0177 stays unchanged; the archivist works regardless of which substrate a store targets.
* Good, because both MCP surfaces are preserved unchanged — no consumer migration required.
* Bad, because the archivist becomes a single point of failure for all mutations — if it has a bug, every write is affected. Mitigated by audit-chain replay (verification, not recovery), mutation invariants (the second correctness gate per §Architecture), and the `MODULE.md` charter (see Architecture §Governance).

*Enforcement:*

* Good, because no store-tree code can obtain a substrate handle except through `MutationContext` — the "import db directly" bypass is unreachable at type-check.
* Good, because branded types make the rule self-enforcing — no review-time governance to ensure new stores route through the archivist.
* Bad, because every existing mutation method on every store needs refactoring to accept `MutationContext` and register via `registerMutationHandler<T>` — and the ADR-0112-era code that explicitly assumes "no coordination above" needs migration too (see Architecture §Migration concerns).
* Bad, because branded types + path-restricted substrate module add type-system complexity that contributors must understand before writing new stores.
* Bad, because defeats via `as any`, `eval`, or runtime module loading remain — caught by ESLint or review, not by the compiler.

*Other:*

* Neutral, because RVF-primary direction was already in motion (ADR-0177); this ADR codifies the coordination layer above it without changing the substrate decision.

### Confirmation

* No store-tree file can import the substrate module under the project's tsconfig (path-restricted to `archivist/**`). Verified by a deliberate-failure test: a store that attempts `import { __db__ } from '../substrate-internal'` MUST fail compilation.
* Every MCP tool (read or write) routes through the archivist boundary. Verified by an archivist-isolation unit test: the boundary is mockable; the test fails if any tool dispatches without hitting the mock.
* Audit-entry count equals mutation count across a representative mutation suite. No missed writes, no double-writes from amplification.
* Audit-chain replay test: replaying the audit log against a freshly-initialized substrate MUST yield a state where, for every recorded mutation entry, the addressable post-state (rows by primary key, vectors by ID, graph edges by endpoint-pair) equals the post-mutation live state. Read-order, HNSW graph topology, and timing-derived fields (`Date.now`-at-replay) are explicitly excluded from the equality comparison — replay is a verification tool, not a recovery tool.

* **Replay-equality scope, beyond the topology/read-order/`Date.now` exclusions above** (per F2). The replay harness applies per-class equality, NOT bit-equality, to the following: **(1) Embeddings** — same `{name, version, dimension}` triple recorded in the audit entry; same dimension; `cosine(live, replayed) >= 0.9999` over L2-normalized vectors. Patch-version mismatch fails the test (replay env broken); ULP-level float drift within version passes. **(2) Telemetry counters and read-side cache hints** — excluded entirely, in-memory by §Read-path cache writes' persistence-boundary rule. If a counter becomes disk-backed it reclassifies MUTATING and falls under rows-by-PK equality. **(3) Partial/failed mutations** — audit entries with `state in {'failed','partial'}` are counted in audit-entry equality and replayed structurally (entry exists in replayed log), but NOT re-applied to substrate. `partial` entries assert only their declared `committed-prefix` subset. **(4) Bulk manifests** — per `(storeId, namespace)` exactly one audit entry; equality on `{count, checksum, tableName, columnSet}`. Checksum is SHA-256 over canonical JSON of rows sorted by PK, with non-deterministic columns excluded. Three-way agreement required: live-manifest = replayed-manifest = recomputed-from-replayed-substrate. **(5) Pre-floor opaque entries** — decisions whose `audit_ref` predates the surviving chain floor (per §Audit chain retention) surface as `{state: 'pre-floor', opaque: true}` and are EXCLUDED from value equality. Their PKs must be structurally present on both sides; values are not compared. **(6) CRDT state** — consensus-record `crdtState` payload compared via semantic equivalence (`{voteSet, tombstoneSet, tally}` as unordered sets), NOT byte-equality. CvRDT merge is commutative per Q8; arrival-order metadata excluded. The substrate write envelope around the merge IS byte-equal. **(7) Audit tree** — structural match on `(parentAuditId, originatingTool, child.mode)` edges. Sequential children: ordered equality. Parallel children (`ctx.child({mode: 'parallel'})`): unordered multiset equality. Depth ≤ 3 invariant from Phase 9 Scenario A enforced. Freshly-minted `auditId` UUIDs at replay are not compared; parent-child relationships are.
* `MODULE.md` charter (Architecture §Governance) enumerates in-scope responsibilities; features outside the charter require an ADR amendment to add. No LoC ceiling — earlier drafts gated on a 2500-LoC budget that itemized accounting showed unrealistic; the charter is the structural scope gate.

## Architecture

* **Archivist placement.** A module scope-gated by the `MODULE.md` charter (see §Governance) sits between **any in-process caller** and substrate. It is not specific to MCP dispatch — the type-enforcement mechanism (§Type enforcement) is universal: no store-tree code can obtain a substrate handle without going through `MutationContext` / `ReadContext`. The MCP boundary is one entry point (the most prominent), but CLI commands, hooks, daemons, and inter-controller writes all route through the same archivist. **Both reads and writes route through it**, with different ceremony — writes carry guard + audit + `MutationContext` + post-write triggers; reads carry only `ReadContext` (no audit, no guard) and most read paths are passthroughs. Read-side features (cache lookup, BM25+semantic fusion, ExplainableRecall provenance) compose at the same boundary when their tool is invoked.

* **Caller surfaces.** The archivist is consumed by ~5 distinct caller surfaces. Estimated counts from the wire-up audit (see Migration concerns):
  * **MCP tools — published cli surface (~110 mutating tools across 16 surfaces):** `memory_*` (4), `agentdb_*` (~20, cli-mediated), `hive-mind_*` (6), `hooks_*` (~18), `autopilot_*` (6), `claims_*` (8), `task_*` (5), `agent_*` (4), `swarm_*` (2), `session_*` (3), `coordination_*` (5), `workflow_*` (8), `daa_*` (6), `wasm_*` (6), `neural_*` (3), `github_*` (3), `embeddings_*` (4), `performance_*` (4), `system_*` (1), `config_*` (3), `progress_*` (1), `ruvllm_*` (6), `browser_*` (4), `aidefence_*` (5).
  * **MCP tools — standalone agentdb server (~15 additional):** `agentdb_insert(_batch)`, `agentdb_delete`, `reflexion_store(_batch)`, `skill_create(_batch)`, `agentdb_pattern_store(_batch)`, etc. at `forks/agentdb/src/mcp/agentdb-mcp-server.ts`. Separate MCP entrypoint; consumers may connect to it directly. Either the archivist contract covers it OR the standalone surface is retired pre-archivist (see Open follow-ups).
  * **CLI commands — direct-write (not MCP-mediated):** `ruflo memory store/delete/init/migrate` (memory.ts:73-1469, via `routeMemoryOp`), `ruflo embeddings cache clear`, `ruflo hooks notify`, `ruflo performance benchmark` (writes 20 entries to substrate as a side-effect), `agentdb causal/learner/reflexion/skill/sync` subcommands (~15 direct controller invocations), `agentdb init/migrate` (raw SQL).
  * **CLI parallel surface:** `@claude-flow/cli-core/commands/memory.ts` writes via a separate `JsonMemoryBackend` (memory/json-backend.js) — a SECOND, distinct, file-based CLI surface that bypasses `routeMemoryOp` entirely. Plugin scripts depend on it. Either route through the archivist or document as an explicit non-archivist surface.
  * **Hooks (lifecycle):** `post-edit` (HOT, every Edit/Write/MultiEdit) appends to `pending-insights.jsonl`; `pre-task` (HOT, every Agent invocation) increments session metrics; `post-task` (MODERATE) rewrites confidence patterns + `ranked-context.json`; `session-end` (COLD but heavy) consolidates + writes `graph-state.json`/`ranked-context.json`/`intelligence-snapshot.json`/`consolidation.json` + evicts old entries. Emitted handler `~/.claude/helpers/hook-handler.cjs` dispatches to `intelligence.cjs`.
  * **Daemons / background workers:** `ruflo daemon` (worker-daemon out-of-process) schedules `map`/`audit`/`optimize`/`consolidate`/`testgaps`/`benchmark` workers writing to `.claude-flow/metrics/*.json` at 10-60min intervals; `AutoMemoryBridge` periodic sync (60s `setInterval`) writes backend + topic markdown + MEMORY.md index; `HooksLearningDaemon` (60s) calls `reasoningBank.consolidate()`; `MemoryConsolidation` controller runs heavy multi-table writes when invoked.
  * **Inter-controller writes (re-entrancy):** `NightlyLearner.run()` orchestrates writes across Causal + Reflexion + SkillLibrary in one logical pass (NightlyLearner.ts:204-310, 411, 501, 576); `MemoryConsolidation.createSemanticMemory` cascades store→markConsolidated→applyForgettingCurve→vectorBackend.remove (MemoryConsolidation.ts:347-452); `SkillLibrary.consolidateEpisodesIntoSkills` fans out to skills + embeddings + graph + vector substrate (SkillLibrary.ts:462-585); `SyncCoordinator.applyChanges` writes 4 distinct tables in one method (SyncCoordinator.ts:509-650).

  Total surface is **~200+ call sites**, an order of magnitude beyond the "13 mutation paths" estimate that earlier drafts of this ADR used. See Migration concerns for revised strategy.

* **Type enforcement — substrate-handle pattern.** The substrate handle (`better-sqlite3`/RVF) lives in `archivist/substrate-internal.ts`, which is path-restricted by tsconfig to `archivist/**` and is NOT in the package's `exports` field. Stores cannot import it under any name. The handle is delivered to handlers exclusively via `MutationContext.substrate` (a branded `SubstrateAccess` type whose constructor is reachable only inside the archivist runtime). Stores register handlers via `registerMutationHandler<T>` and `registerReadHandler<T, R>`; the HOFs return branded `GuardedWrite<T>` / `GuardedRead<T, R>`. A store's barrel is typed `Record<string, GuardedWrite<any> | GuardedRead<any, any>>` so non-branded exports fail at the boundary. ESLint adds `no-restricted-imports` for `better-sqlite3` outside `archivist/**`, and `no-restricted-syntax` for `as unknown as SubstrateAccess` casts. **Test-utility allowlist closure** (per audit 2026-05-14, FATAL → resolved): the `no-restricted-imports` rule covers `test-utils/**`, `__fixtures__/**`, `**/*.fixture.ts`, and `**/*.test-helpers.ts` glob patterns — the same directories that can import `archivist/testing` (per #20) are explicitly forbidden from re-exporting or stashing the substrate handle returned by `withTestContext`. ESLint rule `no-substrate-singleton`: flag any module-scope assignment of the result of `withTestContext()`, `makeFsJsonSubstrateFixture()`, or any binding whose static type resolves to `SubstrateAccess` — must be function-local. Without this, a fixture handle could be hoisted to module-scope and reused across test files as a de-facto substrate channel.

* **Runtime backstop.** Each registered handler receives a `MutationContext` (writes) or `ReadContext` (reads) argument. Handlers assert `ctx` is present; absence raises immediately. The runtime backstop catches residual escapes from the type system (`as any`, `eval`, dynamic imports). Module-scope stashing of `ctx.substrate` or fixture handles is closed by the `no-substrate-singleton` ESLint rule (above) plus the test-utility allowlist closure. The overall claim is "no first-party code can accidentally bypass the channel"; the determined-bypass case (hostile contributor combining `as any` + module retention + ESLint disable comments) requires review.

* **Read-path return shape.** Stores expose reads as `GuardedRead<Q, RankedResults<T>>`, where each `RankedResult<T>` carries `{ item, score, provenance: { storeId, matchType, rawScore, rank, matchedField?, explanation? } }`. Provenance enables ExplainableRecall without a second query. Cross-store fusion uses Reciprocal Rank Fusion (`k=60`, per-store weights from archivist config) — chosen because it operates on ranks rather than raw scores, making BM25 and semantic stores composable without score normalization. The archivist performs dedup and RRF combination; stores contribute ordered candidates with raw scores only. MCP read tools preserve their current `{ id, content, score }[]` shape by default; an `includeProvenance: true` parameter returns the full `RankedResult` shape for clients that need it.

* **Provenance rollout scope** (per T3, 2026-05-14 audit; Phase-3 count reconciled per audit Pass 3, MEDIUM → resolved). The `includeProvenance: true` parameter must be wired across **15 ranked-read tools** spanning three migration phases. Per-phase rollout: **Phase 3 (memory_* surface, 5 ranked-read tools, ~210 LoC):** `memory_search`, `memory_retrieve`, `memory_list`, `memory_search_unified` (the four read siblings of the four mutating `memory_*` tools) PLUS `memory_bridge_status` (status-class read tool whose response surfaces archivist provenance for telemetry consumers). All five return ranked or provenance-bearing candidates and must propagate provenance verbatim. (Earlier draft said "four read siblings"; both numbers were partially right — there are four read siblings of mutators, and a fifth standalone read tool, for a total of five Phase-3 provenance targets.) **Phase 6 (agentdb_* surface, ~315 LoC):** `agentdb_filtered_search` (BM25+semantic fusion site — provenance is mandatory here per ADR-0179), `agentdb_pattern_search`, `agentdb_reflexion_retrieve`, `agentdb_skill_search`, `agentdb_causal_recall`, `agentdb_hierarchical_recall`, `agentdb_neural_patterns` (verified read-only per 2026-05-14 audit — `action: 'similar'` returns ranked similarity matches that benefit from provenance; `action: 'stats'` returns telemetry and is exempt), `agentdb_semantic_route`. **Phase 4 (hive-mind_* surface, ~140 LoC):** `hive-mind_memory` (read mode), `hive-mind_consensus` (read mode). Per-tool cost: ~40-50 LoC each — schema addition (`includeProvenance?: boolean` parameter, default `false`), handler-side passthrough of `RankedResult` shape vs flattened legacy shape, two unit tests per tool (legacy shape with no flag, full shape with `includeProvenance: true`). Total estimate: **~665 LoC across phases 3/4/6**, validated by spot-counting 3 representative tools (`memory_search` ~45 LoC, `agentdb_filtered_search` ~50 LoC, `hive-mind_memory` ~42 LoC). The legacy `{ id, content, score }[]` shape stays the default to preserve back-compat for existing scripts.

* **Read-path cache writes — persistence-boundary rule** (per Q3). A READ-classified tool MAY mutate in-memory caches (QueryOptimizer, LRU embedding cache, telemetry counters, MMR/attention re-rank buffers) without invoking MutationGuard or AttestationLog. The classification test is **persistence**: if the write survives `process.kill()`, it is a mutation and goes through the full audit ceremony; if it dies with the process, it is a cache and is exempt. The Archivist's AttestationLog records one event per persistent mutation; cache populations during reads are reflected in `ReadContext.cacheHints: { wrote_cache: boolean, cache_keys: string[] }` as advisory observability only. Edge case explicitly flagged: if any future controller adds disk-backed cache (e.g., `~/.cache/ruflo/embed.sqlite`), that controller MUST be re-classified MUTATING regardless of the tool's surface name. Three currently audited tools (`memory_search` QueryOptimizer, `agentdb_embed` LRU, `agentdb_filtered_search`) are correctly classified READ today — no ADR amendment of their classification needed; this bullet codifies the *why* and gates future additions.

* **Substrate.** RVF-primary per ADR-0177 for vector + content stores. The permanent SQLite carve-out roster is canonical in **ADR-0166** as `PERMANENT_SQLITE_CARVE_OUT`: **CausalMemoryGraph, CausalRecall, NightlyLearner, LearningSystem aggregations, and ReasoningBank GROUP-BY** — five **controllers**, not five stores. These run on **SQLite (better-sqlite3) and sql.js as fallback** per ADR-0177's substrate table ("SQLite/sql.js retained ONLY as fallback for relational metadata when explicitly needed"). Note: ADR-0170 had moved agentdb_* to postgres + ruvector-postgres; **ADR-0177 superseded ADR-0170 and went back to SQLite** — pglite/postgres is off the table per ADR-0177 + upstream ADR-006's no-pgvector mandate. Earlier drafts of this ADR named "claims board, session store, telemetry spans, hierarchical-path projection" as carve-outs; per the Q1+Q2 audit, that list was hand-rolled and wrong — `claims` is FS-JSON (one store at `claims-tools.ts:46-78` → `.claude-flow/claims/claims.json`), `session_*` is FS-JSON-canonical (Q2; `routeMemoryOp` calls inside save/restore snapshot/hydrate memory state, not dual-write the session record), and `telemetry-spans` + `hierarchical-path projection` are not separate substrate stores. The canonical 5-controller carve-out is per ADR-0166. Per-store System-of-Record assignment; materialized views are best-effort and re-derivable. The HNSW index is internal to the RVF store (atomic with the main record via the `@ruvector/rvf` N-API call), not a separate store — confirmed by inspection of `forks/agentdb/src/backends/rvf/RvfBackend.ts`.

* **Transactions and partial failure.** Stores own their multi-table transactions internally. The archivist orchestrates per-store writes serially with audit between steps. No distributed transaction across stores; the audit entry for each intent transitions through `intent → applied | partial | failed` states. **Partial or failed entries surface via operator-visible alarm and remain in the audit chain as evidence; the archivist does not attempt automatic compensating writes**, because counter updates (running averages in `SkillLibrary.updateSkillStats`), autoincrement IDs, and downstream auto-promotion triggers cannot be cleanly inverted. Replay is a verification tool (audit-log → fresh substrate equality check), not a recovery tool.

* **MCP surfaces.** Both `memory_*` (16 tools) and `agentdb_*` (18 tools) preserved. Archivist is invisible to MCP clients — they call the same tool names with the same parameters.

* **Audit chain.** Single audit log above substrate. Every mutation gets one audit entry written before substrate write, completed after. The audit entry MUST record: the generated ID (random or `lastInsertRowid`), the timestamp captured at intent-open (passed via `MutationContext.timestamp`, not derived in the handler), the embedding model identity (`{ name, version, dimension }`) when applicable, the resolved substrate (RVF vs SQLite) at write-time, and the caller payload post-normalization. Without these, replay is not deterministic. No per-store audit fragmentation. AttestationLog (one of the six lost features) is this audit log.

* **Audit chain retention** (per Q9). Per-file rotation at 100 MiB to `archivist-audit.<n>.jsonl`. Combined size budget `archivist.audit.maxTotalBytes = 1 GiB` (configurable); time budget `archivist.audit.maxAgeDays = 90` (configurable). Eviction runs on rotation ticks: time-expired files first, then oldest-rotated until under the 95% high-water mark. **The active file is never auto-evicted.** Each rotated file carries a `floor.marker` naming its evicted predecessor; replay starts from the oldest surviving rotated file forward, and decisions whose `audit_ref` predates the floor surface as `pre-floor: opaque` in replay reports rather than disappearing silently. Operators use `ruflo archivist purge [--older-than <dur>] [--keep-last <n>] [--dry-run]` (refuses the active file; self-audits the purge event) and `ruflo archivist export --since <ts>` to snapshot before destructive ops. Failure modes: **disk-full** triggers force-eviction (ignoring age budget) and, if necessary, `degraded.audit` mode that stamps decisions `audit-deferred: true` rather than blocking the decision path — never silently drops. **Chain breaks** (manual deletion, corruption) block daemon startup unless `--allow-broken-audit-chain` is passed, which writes a `recovery.marker` for post-incident review. Audit files are not backed up by default; operators target `$RUFLO_HOME/audit/` with their own backup tooling.

* **Re-entrancy: nested MutationContext.** Some mutations fan out to additional mutations (e.g., `NightlyLearner.run()` writes to causal_edges + experiments + skill consolidation in one logical pass; `SkillLibrary.consolidateEpisodesIntoSkills` writes skills + embeddings + graph + vector substrate; `MemoryConsolidation.createSemanticMemory` cascades through three controllers). `MutationContext` exposes a `child(reason)` method that produces a nested context whose `auditId` is a child of the parent's, recorded as a parent-child relationship in the audit chain. The chain reconstructs as a tree, not a flat list — replaying a parent re-applies its children in recorded order. Same-controller cross-substrate writes (e.g., `ReflexionMemory.recordEpisode` writing SQL + vector + graph as one atomic intent) are NOT re-entrancy — they get one audit entry covering N substrate touches.

* **Bulk-write mode.** `SyncCoordinator.applyChanges` (QUIC pull, ~hundreds of rows across 4 tables) and `agentdb migrate` (bulk SQLite-to-SQLite copy) cannot afford per-row audit ceremony. The archivist exposes a `MutationContext.bulk(intent, payload)` mode that records ONE summary audit entry with a diff manifest (count + checksum + table list), not N per-row entries. Replay equivalence is checked against the manifest, not row-by-row. Bulk mode is opt-in by the handler — most mutations should NOT use it.

* **Init.** Lazy-per-tool. Archivist initializes substrate connections on first invocation per tool. Cold-start cost is amortized; idle tools never load substrate. The archivist guarantees `initialize()` completes before any registered handler is invoked — replacing the per-store `requireAgentDB()` / `RvfNotInitializedError` "fail loud" pattern that ADR-0112-era code depends on (see §Migration concerns).

* **Performance and hot paths.** The caller catalog identifies two HOT-path writers that fire on every Claude Code lifecycle event: `post-edit` hook (every Edit/Write/MultiEdit, currently `fs.appendFileSync` to `pending-insights.jsonl` with a <2ms budget) and `pre-task` hook (every Agent invocation, currently a cheap counter increment). Full archivist ceremony per call (guard + audit + post-write triggers) is incompatible with these budgets. The archivist exposes a **fast-path** for registered hot writers:
  * Audit entries flow through a bounded 256-entry single-producer in-flight queue (latency-smoothing only, NOT a durability buffer) drained on immediate microtask into a write-through journal (`write()` to the audit fd synchronously) with batched fsync at most every 100ms. Process-level crashes (SIGKILL/OOM/normal exit) lose at most one in-flight `write()`; the kernel page cache survives. Kernel-level events (panic, power loss) lose up to ~100ms of uncommitted fsync — explicitly out of scope per user. See Follow-up #17 (queue shape) and Follow-up #18 (write-through + signal handling) for the full reconciled spec — this bullet supersedes earlier "in-memory ring buffer" framing per audit Pass 3, HIGH → resolved.
  * MutationGuard is skipped for hot-path registrations (caller asserts no guard required at registration time via `registerMutationHandler(..., { hotPath: true })`).
  * Post-write triggers run asynchronously off the hot path; failure does not block the write.

  Cold-path writers (consolidation, sync, batch operations) get full ceremony. The fast-path is opt-in per handler registration; defaults to OFF. The 250ms worker-daemon queue poll is NOT a hot writer (each tick only inspects the queue; actual writes happen at 10-60min intervals).

* **Six lost features** (ADR-0179) land at the archivist: MutationGuard (pre-write), AttestationLog (audit chain), TieredCache (post-read), BM25+semantic fusion (read-path), ExplainableRecall provenance (read-path metadata), SkillLibrary auto-promotion (post-write trigger).

* **Mutation invariants — second correctness gate.** Audit-log replay alone is tautological: the audit entry and the substrate mutation derive from the same handler/payload, so a handler that records `foo` but writes `bar` would replay identically and remain invisible. Replay verifies "same audit log → same substrate"; it does NOT verify "audit log captured caller intent correctly". The second gate closes this. Each `registerMutationHandler<T>` MAY accept an `invariants: Invariant<T>[]` array — per-handler declared predicates over `(callerIntent, recordedPayload, substrateStateBefore, substrateStateAfter)` returning `'pass' | { violated: true, detail }`. The archivist evaluates every invariant at write-time BEFORE the audit entry transitions to `applied`; a violation aborts the write, records `state: 'rejected', reason: 'invariant_violation', invariant: <name>`, and surfaces to the caller per `feedback-data-loss-zero-tolerance` (no silent fallthrough). Replay re-evaluates invariants against the recorded pair; mismatches between live and replayed verdicts fail the §Confirmation gate. Invariants are NOT guards (guards are policy: PII, size limits; invariants are correctness: "namespace_in equals namespace_recorded"). Suggested baseline invariants per surface: `memory_store` → `{namespace, content_bytes, embedding_dim}` equality between intent and recorded; `agentdb_route` → `query_text` and `topK` equality; `hive-mind` → `swarmId` and CRDT-merge-input set equality. Invariants are best-effort, not exhaustive — they catch handler regression and contract drift, NOT bugs present in the handler at registration time (those require differential testing against a reference impl, deferred to per-surface judgement; see #25). Invariants live in `archivist/invariants/<surface>/<handler>.ts`, declared at registration, NOT in the audit log itself (the audit log records `invariantVerdicts: InvariantVerdict[]` per entry, similar to `guardVerdicts`).

* **Governance.** The archivist module enforces its "thin" property via a co-located `MODULE.md` charter enumerating in-scope responsibilities (the six features above, dispatch, type machinery, lazy init, audit-chain replay, mutation invariants). Any feature not enumerated in `MODULE.md` requires an ADR amendment before landing. No LoC ceiling — earlier drafts gated on a 2500-LoC budget that itemized accounting showed unrealistic for the six-feature surface; scope is policed by the charter (what may land), not size (how much it weighs). The charter is the structural gate; the substrate seam is the type-enforcement gate. **Mechanical charter-conformance check** (per audit Pass 2, HIGH → resolved): `scripts/check-archivist-charter.sh` parses `MODULE.md`'s enumerated-responsibilities list (machine-readable: bullet items inside a fenced section), enumerates source files under `forks/agentdb/src/archivist/**`, and asserts each file maps to at least one charter responsibility via a header tag (`// charter: <responsibility-name>`). Files without a tag, or with a tag not in the charter, fail the check. Wired into `npm run test:unit` (cheap — a grep + Set diff). Trunk-only solo committer pattern (per `feedback-trunk-only-fork-development`) means there's no separate reviewer to enforce the charter at commit time; the mechanical check is the only enforcement. The committer can still bypass with `--no-verify` per CLAUDE.md (forbidden absent explicit reason), but otherwise the check fails before publish.

* **Escape hatch.** Migrations, bulk imports, and repair scripts that legitimately need raw substrate access import from a separate `@pkg/substrate-admin` entrypoint that is unresolvable under the main tsconfig (allowlisted to `scripts/`, `migrations/`, `cli/admin/` via a separate `tsconfig.admin.json` project reference). Each admin invocation writes a synthetic audit entry `{ tool: 'admin:<script>', operator, sha }` so privileged actions remain on the chain.

* **Migration concerns.** The wire-up audit (see §Caller surfaces) found ~200+ call sites that must route through the archivist — an order of magnitude beyond the "13 mutation paths" estimate earlier drafts of this ADR used. The full migration surface:
  * **MCP cli surface (~110 mutating tools across 24 surfaces).** Each registers a handler via `registerMutationHandler<T>` or `registerReadHandler<T, R>`. The cli already has `routeMemoryOp` covering ~30% — the rest bypass it.
  * **Standalone agentdb MCP server (~15 tools).** Separate entry point at `forks/agentdb/src/mcp/agentdb-mcp-server.ts`. Either covered by archivist contract OR retired.
  * **CLI direct-write commands (~25 sites across `ruflo memory/embeddings/hooks/performance` and `agentdb causal/learner/reflexion/skill/sync/init/migrate`).** Many bypass `routeMemoryOp` and call controllers directly or issue raw SQL.
  * **CLI parallel surface (`@claude-flow/cli-core/commands/memory.ts`).** Uses a separate `JsonMemoryBackend`. Either routed or formally exempted.
  * **Hooks (4 mutating handlers: post-edit, pre-task, post-task, session-end).** Hot-path concerns — see §Performance.
  * **Daemons (worker-daemon's 6 scheduled workers + AutoMemoryBridge periodic sync + HooksLearningDaemon).** Some autonomous, some triggered.
  * **Inter-controller writes (4 major orchestrators: NightlyLearner, MemoryConsolidation, SkillLibrary, SyncCoordinator).** Re-entrancy via `MutationContext.child()` (§Re-entrancy).
  * **ADR-0112-pattern legacy code.** ~14 sites in `controller-registry.ts` ("Phase 2: strict-mode discrimination" comments), 6 sites in `agentdb-backend.ts` (`requireAgentDB()` guards), and `rvf-backend-errors.ts:RvfNotInitializedError` pattern. These actively encode the "no coordinator above" rule and must be re-classified or removed.

  **Three pre-existing parallel store-of-stores patterns** the archivist must converge:
  1. SQLite via `routeMemoryOp` (the de-facto router, but only ~30% of writes go through it).
  2. File-system JSON stores via `writeFileSync(getXxxPath(), JSON.stringify(...))` — uniform shape across the ~18 stores (claims/tasks/agents/swarm/coordination/workflow/neural/github/performance/system/config/progress/ruvllm/daa/wasm/browser/autopilot + hive-mind itself) but no shared write primitive.
  3. File-system + lock variants (`hive-mind` WAL stack, `workflow` pid lock, `wasm` pid lock, `swarm` tmp+rename). The fork-authored `hive-mind` `withHiveStoreLock` + `saveHiveState` (`hive-mind-tools.ts:1173`, per ADR-0095) is the most mature substrate code in-tree — but it currently lives inside hive-mind's MCP-tool handler because it was needed before the archivist abstraction existed. The migration **extracts** it to `makeFsJsonSubstrate`; hive-mind becomes a consumer of `SubstrateAccess` like every other FS-JSON store.

  **Revised migration strategy.** Parallel per-store migration (the prior Phase 4 plan) is infeasible at this scope — merge conflicts on shared archivist code dominate. Replace with **surface-by-surface migration**:
  * Phase 2: Implement archivist scaffolding + audit-chain + type machinery (no callers wired). Lift `withHiveStoreLock` shape as substrate primitive.
  * Phase 3: Migrate `memory_*` surface (4 mutating tools) end-to-end; validate against existing acceptance tests. This proves both type machinery and `routeMemoryOp`-via-archivist.
  * Phase 4: Migrate `hive-mind_*` surface (6 tools). **Extract** the fork-authored `withHiveStoreLock` + `saveHiveState` primitive from `hive-mind-tools.ts` into the archivist's `makeFsJsonSubstrate`. Per Q7 measurement: ~490 LoC moves (substrate machinery at L919-1259 + sweep timer + cache helpers L3026-3137), not the rough "~2400" earlier drafts named. The remaining ~2647 LoC in hive-mind-tools.ts is consensus/queen/worker/MCP-handler business logic and stays. Three shims needed (Q4): `dir` provider, `defaults` sentinel, optional `migrate` callback. **Phase 4 surprises and pre-existing bugs (separate concerns):** (a) `agents.json` writes in hive-mind-tools.ts:1264-1280 don't currently use any substrate primitive — a latent ADR-0085 violation that is a **live data-loss bug today**, NOT a Phase 4 deliverable. **Tracked in this ADR §Migration concerns Phase 4 paragraph** (forks have no separate issue tracker — trunk-only fork per `feedback-trunk-only-fork-development`; `feedback-no-upstream-donate-backs` precludes filing on ruvnet/* repos; the ADR text is the canonical work item until the maintenance commit lands); minimum-viable fix lifts the existing `withHiveStoreLock` shape (already in the same file at L1213-1259) to `saveAgentStore`/`loadAgentStore` (~30 LoC), lands as a fork-side maintenance commit on `forks/ruflo/v3 main` with commit subject `fix(hive-mind): wrap agents.json writes in withHiveStoreLock (pre-Phase 4)` BEFORE Phase 4 starts (release-pipeline prerequisite). Phase 4 then migrates the already-locked store as a *second* consumer of `makeFsJsonSubstrate` to validate genericity — mechanical because the lock semantics already match. (b) The consensus handler at `hive-mind-tools.ts:1849` doesn't hold the lock today (propose/vote branches call `saveHiveState` without `withHiveStoreLock` wrapping) — also a **live concurrency bug today**, NOT a Phase 4 deliverable. **Tracked in this ADR + memory `project-fork-only-controllers.md`**; minimum-viable fix wraps ~6 propose/vote/status sites in `withHiveStoreLock` (~30 LoC), lands as a sibling maintenance commit with subject `fix(hive-mind): wrap consensus propose/vote in withHiveStoreLock (pre-Phase 4)` before Phase 4 starts. Phase 4 then routes through `ctx.withWrite` mechanically. (c) `performSweep` is hive-specific (knows about `state.sharedMemory` + `isExpired`); either keep in hive-mind-tools and have it use the substrate's `withWrite`, or generalize as `sweep?: (state:T)=>boolean` substrate option. **Both pre-existing bugs (agents.json substrate bypass, consensus handler lock omission) land as fork-side maintenance commits ahead of Phase 4 per `feedback-data-loss-zero-tolerance` — Phase 4 inherits the fixed state, not the broken state. The Phase 4 release-pipeline preflight (`scripts/ruflo-publish.sh`) refuses to advance past the pre-Phase-4 baseline tag if the maintenance commits are not present on `main`.** **CRDT consensus (ADR-0121) does NOT require a new abstraction (Q8):** the CvRDT merge is a pure function over JSON; persistence is a single substrate write structurally identical to the BFT/Raft/Quorum branches' tally save. `SubstrateAccess.withWrite<T>(fn)` covers it. The dedup payoff from Phase 4 is across N tool families (hive, claims, tasks, agents, sessions, …), not from hive-mind's LoC shrink alone.
  * Phase 5: Migrate the file-system-JSON-store group (claims/tasks/agents/swarm/coordination/workflow/...) as a single batch — uniform shape, single write primitive.
  * Phase 6: Migrate `agentdb_*` cli surface (~20 tools). Triggers the ADR-0112 legacy refactor (`controller-registry.ts` strict-mode, `agentdb-backend.ts` requireAgentDB sites).
  * Phase 7: Migrate hooks (4 handlers, fast-path enabled) and daemons.
  * Phase 8: Decide standalone agentdb MCP server fate; migrate or retire. Decide cli-core JsonMemoryBackend fate; migrate or document non-archivist exception.
  * Phase 9: Inter-controller writes (NightlyLearner, MemoryConsolidation, SkillLibrary, SyncCoordinator). Validates `MutationContext.child()` and `bulk()` semantics under load.
  * Phase 10: Remove the ADR-0112 legacy markers; retire `RvfNotInitializedError` "fail loud" pattern in favor of archivist init-completion guarantee.

  Each phase ships independently and is acceptance-testable. The ESLint counter from the prior plan still applies — count of un-migrated mutation sites trends down per phase. **Phase-revisit protocol allows in-place dated Addenda for retroactive flaws, with `ADR-0180-Halt:` (escalation) and `ADR-0180-Amendment:` (resolution) commit trailers.** Forks are trunk-only (per `feedback-trunk-only-fork-development`); all gating runs through the existing two commands — `npm run test:unit` (fast feedback, preflight subset) and `npm run release` (full pipeline: preflight + build + publish + acceptance per `reference-pipeline-publish-paths`). No new CI/CD frameworks, no nightly tier, no soak time — every gate is a synchronous check inside one of those two commands.

  **Measurement-date anchoring** (per T3, 2026-05-14). Every quantitative claim in this ADR — LoC counts, call-site counts, test-file inventories, per-phase bench bands, surface-coverage percentages — is anchored to the **2026-05-13 wire-up audit** + the **2026-05-14 provenance audit** (the two dates captured in §Caller surfaces and §Provenance rollout scope respectively). The anchor dates are load-bearing: a phase that opens against a stale anchor is operating on numbers that may no longer reflect the codebase. **Re-measurement gate (mandatory per phase):** at each phase's planning gate, the implementing commit batch on `main` includes a `bench/measurement-snapshot-<YYYY-MM-DD>.md` capturing the current counts for that phase's surface (LoC of the targeted module, call-site count via the §Caller surfaces grep recipe, test-file count, hive-mind-tools.ts line count if Phase 4). **>10% drift threshold:** if any anchor number drifts by >10% (the call-site count, the LoC count, or the test-file count for the targeted surface), the phase enters re-scope: the implementing commit carries the `ADR-0180-Halt: re-scope` trailer; `npm run release` refuses to advance the fork's version while any unresolved `ADR-0180-Halt:` trailer sits between the last release tag and `HEAD`. An Addendum commit (also on `main`) dated `**Amendment YYYY-MM-DD (phase-N re-scope):**` revises the phase bullet with updated numbers and carries the matching `ADR-0180-Amendment: phase-N` trailer; release resumes once Halt↔Amendment pair both land. The 10% threshold is conservative — smaller drifts are noted in the snapshot without halting. **Phase 4 has the tightest measurement boundary** (hive-mind-tools.ts is fork-authored and under active iteration); Phases 5-9 measure against the slower-moving surfaces and rarely hit the threshold. The snapshot file lives at `forks/<archivist-package>/bench/measurement-snapshots/` and is checked into `main` per phase for retrospective audit.

  **Phase-revisit protocol** (per T1). Phases 2-10 are linear, but later phases may surface latent flaws in earlier scaffolding (the Phase 4 surprises below — `performSweep` hive-specificity, etc. — are the precedent). **Halt triggers (any one):** (a) retroactive §Confirmation invariant violation (audit-tree depth ≤3, addressable-key set-equality, no fanout amplification); (b) perf-band breach against the W1-W5 baseline; (c) substrate-genericity assumption violated (a §20 fixture extension needed mid-phase); (d) `MutationContext` / `SubstrateAccess` shape change. **Any contributor** may invoke a halt by landing a commit on `main` with trailer `ADR-0180-Halt: <reason>`. The release pipeline (`scripts/ruflo-publish.sh`) scans `git log <last-tag>..HEAD --grep='ADR-0180-Halt:'` and refuses to advance the fork's version while any Halt trailer lacks a matching `ADR-0180-Amendment: phase-N` resolution commit in the same range. **Resolution** lands as a dated **Addendum** amending the offending phase bullet in-place (not a new ADR — net-new decisions still get their own ADR per Open Follow-up #6 precedent). Addendum prefix: `**Amendment YYYY-MM-DD (phase-N retrofit):**`; the original bullet gains a `(amended YYYY-MM-DD)` marker. **Commit-trailer convention:** Halt and Amendment commits are paired by phase number — `git log --grep='ADR-0180-\(Halt\|Amendment\)'` reconstructs the loop-back history. Halt resolves when the Addendum commit lands on `main`; the next `npm run release` then succeeds. (The ADR document itself lives in ruflo-patch where PRs DO apply — amendments to this ADR's text follow ruflo-patch's normal PR flow; the trunk-only mechanics described here govern the *implementation* in `forks/<archivist-package>`.)

  **§20 testing surface lands in Phase 2** (per Q6 + T1). Phase 2 implements `@pkg/archivist/testing` exports verbatim from §20: `withTestContext`, `withTestReadContext`, `makeFsJsonSubstrateFixture`, full `WithTestContextOpts`, four-view `TestResult`. The §20 sketches are contractually binding code, not pseudocode — Phase 2 imports the production branded types into the helper. **Phase 3 cannot release** until: (a) `@pkg/archivist/testing` resolves under `tsconfig.test.json` and is unresolvable under main `tsconfig.json` (ESLint `no-restricted-imports` defense-in-depth verified); (b) at least one Phase 3 handler test exercises each of the four `TestResult` views (`audit`, `auditTree`, `bulkManifests`, `hotPath`); (c) `makeFsJsonSubstrateFixture` is import-resolved from at least one test file (Phase 4 prerequisite). This prevents Phase 3 from shipping handler tests that have to be retrofitted when Phase 4 surfaces require the extensions. **Release-pipeline gate:** `tsc -p tsconfig.test.json` passes AND `tsc -p tsconfig.json` errors on `@pkg/archivist/testing` import AND grep of `forks/<archivist-package>/test/**` finds ≥1 use of each extension hook — wired into `npm run release`'s preflight so a Phase 3 release fails fast.

  **§20 testing surface exemption clarification.** Earlier drafts referenced a "§20 size-budget exemption" — vestigial language from the dropped LoC budget. Now obsolete; §20 imports the production branded types and is path-restricted to `test/**` consumers via tsconfig, not exempted from a size gate.

  **Phase 2's first deliverable is the performance baseline harness, BEFORE any handler wiring** (per Q5). Path: `forks/<archivist-package>/bench/{cold-single,cold-bulk,hot-path,read-cache,cascade}.bench.ts` using Node built-in test runner + `performance.now()` histograms (no third-party perf dep). Five workloads with explicit regression bands gate later phases: W1 cold single write (p50 ≤ 1.3×, p99 ≤ 1.5×, hard-fail at p99 >2×), W2 cold bulk write (p50 ≤ 1.2×, p99 ≤ 1.5×), W3 hot loop (W3 reuses Follow-up #13's microbench; absolute <2ms p99 ceiling), W4 read cache hit + miss (cache-hit p50 must beat the same-tool substrate-miss measurement by ≥10× — W4 records both numbers so the ratio is local to the run), W5 inter-store cascade (audit-tree depth ≤3 invariant + p99 ≤ 1.5×). Captures wall-clock + syscall count + allocations + fsync count + audit-tree depth where relevant. Cadence: all five workloads run inside `npm run release`'s preflight stage (W1, W2, W4, W5) or acceptance stage (W3, since the 30s 10K-iteration run is too slow for preflight); failure of any band blocks the release. W1+W3 also run in `npm run test:unit` as fast feedback during phase work. Baseline JSON committed to `forks/<archivist-package>/bench/baseline.json` — **Phase 3 cannot release** until W1 + W3 post-archivist measurements land within their bands.

  **`bench/baseline.json` schema** (per audit Pass 3, MEDIUM → resolved — multiple phases write to this file without a shared shape; defining it pre-Phase-2 prevents per-phase divergence). The file is a single JSON object keyed by stable measurement ID, NOT an append log:

  ```jsonc
  {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "schemaVersion": 1,                                // bump when shape changes; CI validates
    "env": {                                           // single env block applies to all measurements in the file
      "platform": "darwin" | "linux",
      "arch": "arm64" | "x64",
      "cpuModel": "Apple M5 Max" | "...",             // free-form, captured via os.cpus()[0].model
      "nodeVersion": "v22.x.x",
      "rvfNativeVersion": "x.y.z",                    // @ruvector/rvf-wasm or rvf native binding
      "sqliteVersion": "3.x.x",                       // better-sqlite3 reported version
      "capturedAtIso": "2026-05-DD..."                // when Phase 2 first established baseline
    },
    "workloads": {
      "W1_cold_single": {                              // one key per W1-W5
        "iterations": 1000,
        "baseline_us": { "p50": <n>, "p99": <n>, "p999": <n> },
        "archivist_us": { "p50": <n>, "p99": <n>, "p999": <n> },
        "ratio": { "p50": <n>, "p99": <n> },         // archivist / baseline
        "band": { "p50_max": 1.3, "p99_max": 1.5, "p99_hard_fail": 2.0 },
        "passed": true
      },
      "W2_cold_bulk": { /* same shape */ },
      "W3_hot_loop": { /* p99_max overridden — absolute <2ms ceiling, not ratio */ },
      "W3_contended": { /* extends W3 with multi-process p99 ≤ 5ms ceiling per #13 */ },
      "W4_read_cache": { /* hit_us + miss_us separately; ratio = miss/hit */ },
      "W5_inter_store_cascade": { /* + audit_tree_depth_max */ }
    },
    "phase_5_contention": {                            // Phase 5 adds this top-level key, not new W-keys
      "lockWaits_per_mutation_ratio": <n>,             // empirical baseline for the 1.5× gate
      "max_lock_wait_ms": <n>,                         // empirical baseline for the 200ms gate
      "capturedAtIso": "2026-..."                     // Phase 5 update timestamp
    }
  }
  ```

  Rules: (a) Phase 2 writes `env` + `workloads.W1-W5` (W3_contended added in Phase 2 alongside W3; both share the contended-mode harness). (b) Phase 5 adds the `phase_5_contention` block — separate key, not under `workloads`, because it measures a derived gate rather than a runtime workload. (c) Subsequent phases re-run all workloads pre-release and write back; `passed: false` blocks release. (d) `schemaVersion` bumps invalidate the file and require a re-baseline (rare; gated by ADR amendment). (e) `env` mismatch between baseline capture and current run produces a WARN-level log but does not fail; the dev machine + CI machine differ deliberately. (f) The baseline file lives under `bench/`, not `bench/measurement-snapshots/` — the snapshot directory is for §Measurement-date anchoring numeric drift snapshots, a separate concern.

  **Documentation sweep per phase** (per Q10). Every migration phase ends with a mandatory doc-sweep sub-task covering the surface it touches: USERGUIDE.md sections describing that surface's storage; plugin READMEs that name file paths or substrate concepts in the migrated surface; SKILL.md files documenting MCP tool semantics for the surface; CLAUDE.md / STATUS.md status snapshots. ~40 documentation references identified pre-Phase-2 across 5 surfaces (USERGUIDE ~25, plugin docs ~6, top-level project docs ~6, ADR siblings ~3, MCP tool descriptions zero — already storage-agnostic). **Wording posture:** user-facing docs (USERGUIDE, doctor output) preserve user-visible paths and offer "managed by archivist" framing; internal docs (CLAUDE.md, architecture doc, plugin-author SKILLs) use full archivist vocabulary (`MutationContext`/`GuardedWrite`/path-restricted substrate). The validation harness's `better-sqlite3` references are install-smoke fixtures and stay verbatim.

  **Test migration cost** (per Q6, revised 2026-05-13 audit). The 110-mutating-tool figure overstates per-tool test surface — actual unit-test coverage concentrates in two megafiles (`mcp-tools-deep.test.ts` at 3,840 LoC and `forks/agentdb/tests/mcp-tools.test.ts` at 814 LoC), plus ~10 plugin `mcp-tools.test.ts` files that already test through public tool handlers and migrate trivially. Categorization across phases 3-9: **~14 trivial** (swap mock for `withTestContext`, ~30min each), **~9 moderate** (refactor substrate mock to `withTestContext`'s in-memory `SubstrateAccess`, ~2-4h each), **~1 full rewrite** (`forks/agentdb/tests/mcp-tools.test.ts` uses real `better-sqlite3` — port assertions to in-memory substrate). ~5 integration tests survive unchanged. Per-phase: P3 (2 trivial + 1 moderate), P4 (1 trivial + 2 moderate), P5 (8 trivial — but many FS-JSON surfaces lack unit tests today; coverage-add opportunity, not migration cost), P6 (1 trivial + 1 moderate + 1 rewrite + 1 integration), P7 (3 moderate + 4 net-new hot-path tests). Net-new test creation in P5 + P7 is a **coverage-add** opportunity, not a migration cost — these surfaces lack unit tests today.

  **withTestContext surface — Phase 4 prerequisites** (per Q6 audit + F1 design, now resolved in §20). The §20 helper's surface was extended to cover four patterns Phase 4-9 depend on: (a) **hot-path fast-path mode** via `withTestContext({ hotPath: true })` mirroring production `registerMutationHandler(..., { hotPath: true })` — `TestResult.hotPath.{guardsInvoked, ringBuffer, postWriteTriggers}` lets Phase 7 hook tests assert guards bypassed, audit-to-ring-buffer, async post-write triggers; (b) **bulk-mode manifest assertions** via `TestResult.bulkManifests[]` — one entry per `ctx.substrate.withBulkWrite` call carrying `{intent, count, checksum, tableList}`; Phase 6 `agentdb migrate` and Phase 9 SyncCoordinator (Scenario B) assert manifest equality not row-by-row; (c) **re-entrancy via `TestResult.auditTree`** — root `AuditNode` with `children[]` matching `ctx.child(reason)` order, depth-≤3 enforced; Phase 9 Scenarios A and C use this for tree-shape equality; (d) **`makeFsJsonSubstrateFixture`** modeling lock contention + multi-file shape (`hive-state.json` + `agents.json` co-resident) — Phase 4's "agents.json as second consumer" validation and Phase 5's 17 FS-JSON stores depend on it. Cross-mode constraints (compile-time enforced): `bulk × hotPath` forbidden, `child × hotPath` forbidden, `bulk × re-entrancy` legal. See §20 for the extended surface; Phase 4 unblocked.

* **+36% wrapper fix (status correction).** Commit `511b7d3` modified `forks/agentdb/src/backends/factory.ts` to return `SelfLearningRvfBackend.create(...)` instead of bare `RvfBackend`. This is a **substrate-level** wrapper inside agentdb's RVF backend factory — NOT at the archivist boundary as a prior draft of this ADR claimed. The wrapper composes SonaLearningBackend, SemanticQueryRouter, RvfSolver, etc. and adds `recordMutationWitness()` per write. To realize the archivist architecture, this logic either lifts to the archivist (preferred — single chokepoint) or remains at substrate and the archivist duplicates the witness-chain hook. The work to relocate (or formally accept the duplication) is unaccounted-for migration cost.

## Pros and Cons of the Options

### Re-introduce bridge at substrate (upstream's pattern)

* Bad, because it re-creates the 3-4× write amplification ADR-0085 deleted the bridge to escape. The amplification was structural (fanout to four downstream writers); placing coordination at substrate makes fanout the natural shape.
* Bad, because it places coordination below MCP dispatch, so the archivist has to know which MCP surface called it — the cross-cutting concerns leak the MCP-surface concept into substrate.
* Neutral, because it does provide a chokepoint for cross-cutting concerns — just at the wrong layer.

### No archivist, store convention (ADR-0112 status quo)

* Good, because zero new code; ADR-0112 is in effect today.
* Bad, because three months of evidence: the six lost features are still scattered/stub/orphaned; the audit chain is fragmented; ADR-006 upstream remains "Proposed" for the same reason.
* Bad, because the "no coordinator" rule has produced governance gridlock — every new cross-cutting concern requires re-deliberating where it lives.
* Bad, because `feedback-data-loss-zero-tolerance` cannot be honored without a single audit chain.

### Thin archivist at MCP-dispatch boundary, runtime-enforced

* Good, because placement above MCP dispatch avoids the substrate-fanout amplification.
* Bad, because runtime enforcement is exactly the upstream failure mode — "everyone agrees to call the bridge" works until the first contributor forgets. ADR-006 upstream is stuck in "Proposed" precisely because no one was confident every caller would route correctly.
* Bad, because `feedback-data-loss-zero-tolerance` cannot be satisfied by convention alone.

### Thin archivist at MCP-dispatch boundary, type-enforced

* Good, because both upstream failure modes (placement amplifying writes, convention bypassing archivist) are eliminated structurally.
* Good, because the path-restricted substrate module + branded handle make the rule self-enforcing — no review-time governance to ensure new stores route through the archivist.
* Good, because RVF/SQLite substrate split (ADR-0177) is orthogonal — archivist works regardless.
* Bad, because the wire-up audit found ~200+ call sites across 5 caller surfaces (~110 MCP cli tools across 24 surfaces, ~15 standalone agentdb MCP tools, ~25 CLI direct-writes, 4 hook handlers, 6+ daemon writers, 4 inter-controller orchestrators, plus ADR-0112 legacy markers). An order of magnitude beyond the "13 paths" estimate earlier drafts of this ADR used. See §Migration concerns for the surface-by-surface phased strategy.
* Bad, because branded types + path-restricted module + escape-hatch tsconfig add type-system complexity contributors must understand.
* Bad, because runtime defeats remain (`as any`, `eval`, runtime imports) — caught by ESLint or review, not by the compiler. The claim is "no store-tree code can obtain substrate except via context", not "no code path bypasses the archivist."

## More Information

* [ADR-0179](ADR-0179-restore-controller-instrumentation-lost-in-adr0085-bridge-deletion.md) — restores the six lost features. ADR-0180 codifies *where* they land (the archivist) and *how* their invocation is enforced (the type system). ADR-0179 and ADR-0180 are peer decisions: 0179 catalogs the features and motivates restoration; 0180 establishes the architecture under which they're restored.
* [ADR-0177](ADR-0177-adopt-upstream-agentdb-rvf-vision.md) — RVF-primary substrate. ADR-0180 sits above the substrate and is substrate-agnostic; works equally for RVF and SQLite stores.
* [ADR-0112](ADR-0112-forbid-cross-store-coordination.md) — superseded. The "no coordinator" rule is retired because its motivating concern (write amplification at substrate) is addressed by placing the archivist above MCP dispatch rather than below it.
* [ADR-0085](ADR-0085-delete-self-learning-bridge-wrapper.md) — original bridge deletion. Was correct about the wrong placement; this ADR re-introduces coordination at the right placement.
* [docs/architecture/memory-storage-upstream-vs-fork.md](../architecture/memory-storage-upstream-vs-fork.md) §5 — the 10-point council convergence this ADR codifies.
* [docs/council/ADR-0179-council-r3-bridge-coordination.md](../council/ADR-0179-council-r3-bridge-coordination.md) — Round 3 transcript where the type-enforcement vs runtime-convention distinction was settled.
* [docs/council/ADR-0180-swarm-callers-audit.md](../council/ADR-0180-swarm-callers-audit.md) — 4-agent swarm session enumerating all ~200+ in-process callers (MCP, CLI, hooks, daemons, inter-controller writes) that must route through the archivist. Drove §Caller surfaces, §Re-entrancy, §Bulk-write mode, §Performance and hot paths, and the revised §Migration concerns.
* [docs/council/ADR-0180-pass-3-audit.md](../council/ADR-0180-pass-3-audit.md) — Pass 3 pre-acceptance cross-reference & coherence sweep (2026-05-14). Surfaced 9 findings (A-J) — all mechanical / terminology / schema-gap class, no architectural reopen — landed inline with `(per audit Pass 3, <severity> → resolved)` attribution. Phase 0 gate clear; recommends acceptance.

### Q/T/F/R/W label provenance (per audit Pass 3, MEDIUM → resolved)

Inline parenthetical attributions of the form `(per Qn)` / `(per Tn)` / `(per Fn)` / `(per Rn)` / `(per Wn)` reference research findings from this ADR's audit passes (swarm-callers 2026-05-13; Pass 1 + Pass 2 inline-resolved 2026-05-13/14; Pass 3 2026-05-14). Each label resolves to a single substantive location in this document — they are NOT external references and do not require a separate research-collection artifact. Provenance index:

* **Q1-Q2** — SQLite carve-out roster correction (§Architecture · Substrate).
* **Q3** — Read-path cache writes persistence-boundary rule (§Architecture · Read-path cache writes).
* **Q4** — `makeFsJsonSubstrate` shim list — `dir` / `defaults` / `migrate` (§Migration concerns · Phase 4).
* **Q5** — Phase 2 first deliverable = baseline harness (§Migration concerns · Phase 2's first deliverable).
* **Q6** — Test migration cost categorisation + `withTestContext` Phase 4 prerequisites (§Migration concerns · Test migration cost + §Open Follow-up #20).
* **Q7** — `hive-mind-tools.ts` LoC measurement (§Migration concerns · Phase 4).
* **Q8** — CRDT consensus subsumed by `SubstrateAccess.withWrite` (§Migration concerns · Phase 4 CRDT clause).
* **Q9** — Audit-chain retention policy (§Architecture · Audit chain retention).
* **Q10** — Per-phase documentation sweep (§Migration concerns · Documentation sweep per phase).
* **T1** — Phase-revisit / Halt-Amendment protocol (§Migration concerns · Phase-revisit protocol).
* **T2** — Cross-process `MutationContext.child()` revisit triggers (§Open Follow-up #15 · Cross-process MCC across cli→daemon).
* **T3** — Measurement-date anchoring + Provenance rollout scope (§Migration concerns · Measurement-date anchoring + §Architecture · Provenance rollout scope).
* **F1** — Extended §20 testing surface design (§Migration concerns · withTestContext surface — Phase 4 prerequisites).
* **F2** — Replay-equality scope per-class rules (§Confirmation · Replay-equality scope).
* **R1-R4** — Cross-process MCC re-open triggers (§Open Follow-up #15 · Cross-process MCC triggers).
* **W1-W5** — Phase-2 baseline-harness performance workloads (§Migration concerns · Phase 2's first deliverable).
* **WD1-WD2** — Cross-process MCC deferral watchdog mechanisms (§Open Follow-up #15 · Watchdog mechanisms). Renamed from W1/W2 in Pass 3 to avoid namespace collision with the perf workloads above.

`grep -n "(per QN)\|(per TN)\|(per FN)\|(per RN)\|(per WN)"` (substituting the specific label) recovers every callsite for traceability.

## Execution Plan

§Migration concerns establishes the 10 phases in dependency order. The Execution Plan adds the *how*: each phase is executed via `/swarm-advanced` (per `swarm-advanced` skill) with a per-phase team — a phase queen coordinates worker agents that run in parallel where the phase's work decomposes cleanly. Phases stay sequential — Phase N+1 cannot start until Phase N's release-pipeline gate (`npm run release`) passes. Within a phase, workers run in parallel via the Agent tool with `run_in_background: true` and `team_name: "adr-0180-phase-N"`; results flow to the queen via SendMessage per `feedback-agent-dialectic-via-sendmessage`.

**Universal pattern per phase:**

1. **TeamCreate** `adr-0180-phase-N` with phase description.
2. **Spawn** workers + 1 queen in a single message (all `run_in_background: true`, all bound to the team). Per `feedback-council-queen-da-alongside-experts`, queen spawns alongside workers, not after.
3. **Workers** execute their slice — single attempt, no retry loops (per `feedback-single-arm-experiment-prompt-discipline`); each worker SendMessages the queen when done.
4. **Queen** waits for all workers, runs the phase's acceptance test (`npm run release` preflight + acceptance for that surface), produces a phase report.
5. **TeamDelete** after all workers and queen acknowledge shutdown.
6. **Halt protocol.** Any worker may invoke `ADR-0180-Halt:<reason>` if it surfaces a retroactive flaw in earlier scaffolding; the release pipeline blocks until a paired `ADR-0180-Amendment: phase-N` commit lands amending the prior phase's bullet.

**Per-phase team composition:**

| Phase | Surface | Topology | Workers | Queen | Parallelism | Phase exit gate |
|---|---|---|---|---|---|---|
| 2 | Scaffolding (no callers wired) | mesh | bench-harness-builder (analyst); audit-writer-builder (coder); type-machinery-builder (coder); testing-surface-builder (coder); module-charter-author (api-docs); charter-gate-implementer (coder); single-fd-invariant-builder (coder) | sparc-orchestrator | 7 + 1 | `npm run release` preflight passes; `bench/baseline.json` committed; `scripts/check-archivist-charter.sh` exits 0 |
| 3 | `memory_*` (4 mutating tools) | star | memory-store-migrator, memory-search-migrator, memory-retrieve-migrator, memory-bridge-status-migrator (4× backend-dev); plus 5× provenance-rollout-worker (1 per ranked-read tool: search/retrieve/list/search_unified/bridge_status — ~210 LoC total per §Provenance rollout scope); invariants-author for the 4 surfaces (backend-dev) | task-orchestrator | 10 + 1 | Tier 1 replay (`memory_*`) passes; provenance flag works on all 5 ranked-read tools; mutation invariants on each handler |
| 4 | `hive-mind_*` (6 tools) | hierarchical | pre-Phase-4 maintenance commits land FIRST as a 2-agent sub-team (agents-json-fixer + consensus-lock-fixer, both backend-dev); then substrate-primitive-extractor (coder, lifts `withHiveStoreLock`/`saveHiveState` → `makeFsJsonSubstrate`); 6× hive-mind-tool-migrator (spawn/status/memory/consensus/shutdown/broadcast); agents-json-second-consumer (validates substrate-genericity) | task-orchestrator | 10 + 1 | `scripts/ruflo-publish.sh` confirms maintenance commits on `forks/ruflo/v3 main`; Tier 1 replay; Phase 4 surprises a/b/c resolved |
| 5 | FS-JSON group (~17 stores) | mesh | one fs-json-store-migrator (backend-dev) per store; cap at 15 in the first wave (claims, tasks, agents, swarm, coordination, workflow, neural, github, performance, system, config, progress, ruvllm, daa, wasm); browser + autopilot queued for a second 2-agent wave | task-orchestrator | 15 + 2 (queued) + 1 | Phase 5 contention-threshold gate, both assertions per disposition #10 (`lockWaits.length <= 1.5 * mutationCount` AND `max(waitedMs) <= 200`); `bench/baseline.json.phase_5_contention` block written; all 17 stores route through `ctx.substrate.withWrite` |
| 6 | `agentdb_*` (~20 tools) + ADR-0112 cleanup | hierarchical | 8× agentdb-tool-migrator (filtered_search/pattern_search/reflexion_retrieve/skill_search/causal_recall/hierarchical_recall/neural_patterns/semantic_route — covers the 8 ranked-read tools + provenance); 4× agentdb-mutator-migrator (route/store/embed/feedback covering the mutating side); adr0112-marker-cleanup (analyst); adr0112-requireAgentDB-cleanup (analyst); rvf-error-retirement-prep (analyst) | sparc-orchestrator | 15 + 1 | `grep -RE 'ADR-0112 Phase 2\|requireAgentDB(' forks/agentdb/src/` returns zero; Tier 1 replay for agentdb; provenance rollout ~315 LoC |
| 7 | Hooks + daemons | star | post-edit-migrator (hotPath:true, backend-dev); pre-task-migrator (hotPath); post-task-migrator; session-end-migrator (includes consolidation-nudge wiring + recovery-scan bounds per #11); 6× worker-daemon-migrator (one per worker-daemon scheduled worker per §Caller surfaces — map / audit / optimize / consolidate / testgaps / benchmark; benchmark is disabled today but registers a handler for parity, all backend-dev); 2× standalone-daemon-migrator (AutoMemoryBridge periodic sync; HooksLearningDaemon; both backend-dev); fail-loud-fixer (analyst, #14 sites); hot-path-bench-validator (tester, W3 + W3-contended real-pipeline fixture) | task-orchestrator | 14 + 1 | W3 microbench (single-process) passes; W3-contended real-pipeline (cli + daemon + Edit storm) passes; consolidation-nudge acceptance test passes; recovery-scan cap test passes; ranked-context.json + graph-state.json + intelligence-snapshot.json writers relocated under consolidate-worker per #11 disposition (verified by grep — no `intelligence.cjs:consolidate()` callers remain in `session-end`) |
| 8 | (a1) Lift archivist into `@sparkleideas/agentdb` + cli-core decision | hierarchical | archivist-source-mover (coder, relocates archivist to `forks/agentdb/src/archivist/**`); package-exports-updater (coder, adds `@sparkleideas/agentdb/archivist` to exports); cli-import-rewriter (coder, points cli at agentdb-hosted archivist); standalone-server-handler-binder (backend-dev, registers handlers); cli-core-jsonmemory-decider (analyst, picks per #9 disposition) | sparc-orchestrator | 5 + 1 | archivist resolvable from both cli and agentdb-mcp-server; both surfaces share one archivist instance; Tier 1 replay across both passes; cli-core decision documented |
| 9 | Inter-controller orchestrators | star | scenario-a-runner (NightlyLearner re-entrancy depth ≤3, tester); scenario-b-runner (SyncCoordinator bulk mode, tester); scenario-c-runner (MemoryConsolidation cascade, tester); NightlyLearner-migrator (coder); MemoryConsolidation-migrator (coder); SkillLibrary-migrator (coder); SyncCoordinator-migrator (coder); reference-impl-decider (analyst, #25 triggers) | task-orchestrator | 8 + 1 | Phase 9 load scenarios A/B/C pass; audit-tree depth ≤3 invariant; bulk-manifest equality; #25 triggers re-evaluated |
| 10 | ADR-0112 retirement | mesh | rvf-error-retirement (coder, deletes `RvfNotInitializedError`); drift-guard-verifier (tester, confirms preflight scans return zero); adr0112-status-flipper (api-docs, marks ADR-0112 superseded + appends `superseded-by: ADR-0180` per ADR convention); marker-cleanup-final-sweep (analyst) | task-orchestrator | 4 + 1 | Zero matches for ADR-0112 patterns; ADR-0112 status = `superseded by ADR-0180`; release succeeds |

**Cross-phase coordination:**

* **Phase queen reports** land in `docs/council/ADR-0180-phase-<N>-report.md` after the phase completes — a phase audit trail similar to the `ADR-0180-swarm-callers-audit.md` precedent. Reports document worker outputs, acceptance-test results, and any `ADR-0180-Halt:` commits that fired during the phase.
* **The §22 `withTestContext` Phase 2 ordering gate** (§Migration concerns) is enforced in Phase 2 by the testing-surface-builder + queen verifying all four `TestResult` views are exercised before Phase 3 spawns.
* **The §Provenance rollout scope** is split across phases 3 (memory_*), 4 (hive-mind_*), and 6 (agentdb_*) — each phase's queen verifies its share against the spot-counted ~45-50 LoC per tool budget; the total drift gate (>10% per §Measurement-date anchoring) fires if the per-phase numbers exceed estimate.

**Up to 15 agents per phase** — the table above shows where the parallelism actually fits. Phases 5, 6, 7 hit the 15-agent ceiling (Phase 7 sized 14 + 1 after Pass 3 worker-list correction: 4 hooks + 6 worker-daemon scheduled-worker migrators + 2 standalone-daemon migrators + fail-loud-fixer + hot-path-bench-validator = 14 workers); Phase 2 sits at 7 + 1; phases 3, 4, 8, 9, 10 sit at 4-10. Single-agent phases were ruled out — every phase has at least 4 workers + 1 queen because the queen-alongside-workers pattern (per `feedback-council-queen-da-alongside-experts`) requires concurrent spawn.

**Pre-Phase-2 prerequisite (no swarm needed).** The `scripts/ruflo-publish.sh` pipeline gains, in a single sole-committer scripting batch, the gates each downstream phase will rely on (per audit Pass 3, MEDIUM → resolved — previously the ADR named only the first two and left Phase 4's gate implicit): (1) `ADR-0180-Halt:` / `ADR-0180-Amendment:` trailer scan for phase-revisit protocol (§Migration concerns · Phase-revisit protocol); (2) charter conformance hook invoking `scripts/check-archivist-charter.sh` (§Governance); (3) pre-Phase-4 maintenance-commit gate — refuses to advance past the pre-Phase-4 baseline tag if the two `fix(hive-mind): wrap … (pre-Phase 4)` commits are absent from `forks/ruflo/v3 main` (§Migration concerns · Phase 4). These three additions land before Phase 2 spawns. This is a one-shot scripting task (sole-committer ruflo-patch repo), not a swarm phase. Without (1) the halt protocol doesn't bite; without (2) Phase 2's charter exit gate is unenforceable; without (3) Phase 4 cannot honor its exit-gate contract.

**Phase 0 (audit gates, prior to execution) — CLEARED 2026-05-14.** This ADR's acceptance status flip (`proposed` → `accepted`) is itself the Phase 0 gate — until accepted, no implementation phase runs. Three audit passes have landed: **Pass 1** + **Pass 2** documented inline via `(per audit Pass 1/2, <severity> → resolved)` markers; **Pass 3** documented inline via `(per audit Pass 3, <severity> → resolved)` markers and externally at [docs/council/ADR-0180-pass-3-audit.md](../council/ADR-0180-pass-3-audit.md) — surfaced 9 mechanical/terminology/schema-gap findings (A-J), all resolved, no architectural reopen. Frontmatter `status: accepted` reflects Phase 0 completion. Phase 2 may begin once the Pre-Phase-2 scripting prerequisite (Halt/Amendment trailer scan + charter conformance hook + pre-Phase-4 maintenance-commit gate per Pass 3 Finding G) lands on `main`.

## Implementation Status (2026-05-14)

**Execution Plan Phases 0–10: structurally complete.** All ten phases ran as per-phase `/swarm-advanced` teams; each produced a council report ([docs/council/ADR-0180-phase-2-report.md](../council/ADR-0180-phase-2-report.md) … [phase-10](../council/ADR-0180-phase-10-report.md)). The archivist tree (`forks/agentdb/src/archivist/**`) holds 163 `.ts` files across 22 handler surfaces + 12 core modules + the substrate/invariant/testing-surface files; the `MODULE.md` charter check passes (`OK: 167 files`); the four release-pipeline gates (`run_adr0180_gates()`) are wired into `scripts/ruflo-publish.sh`. ADR-0112 is flipped to `Superseded by ADR-0180` (its *rule* retired; its *enforcement code* in `@claude-flow/memory` retires with F4-2 — see below).

**F4-2 Phases A–C: substrate seam is live.** The deferred runtime-activation work began under the "F4-2" banner: Phase A landed the `makeSqliteSubstrate`/`makeRvfSubstrate`/`makeFsJsonSubstrate` factories + `Archivist.initialize()` substrate registry + `getSubstrate()` resolver + audit-writer integration; Phase B un-stubbed ~12 genuinely-doable handler bodies; Phase C added read-optimized `query`/`vectorSearch` substrate methods, `ArchivistInitConfig` capability-handle threading, and the multi-file atomic-write primitive. Council reports: [f4-2-phase-a](../council/ADR-0180-f4-2-phase-a-report.md), [-b](../council/ADR-0180-f4-2-phase-b-report.md), [-c](../council/ADR-0180-f4-2-phase-c-report.md).

**Honest state — what "structurally complete" does and does not mean.** The archivist is fully *scaffolded* — type machinery, audit chain, hot-path queue, substrate factories, 22 handler surfaces, governance charter, bench harness, load scenarios, drift guards — but it is **not yet live on the write path**. F4-2 Phase B's scope audit found the "14 `TODO(F4-2)` handlers" estimate was a stale slice: **~88 of 118 handler files still throw `pending` stubs.** The cli/daemon/hook call sites still run their original authoritative paths; `archivist.dispatch()` is reachable but not yet wired in as the live surface. **No phase has been `npm run release`-verified** — the orphaned `git stash pop` conflict that blocked it (`AgentDB.ts` + `LearningSystem.ts`) was resolved 2026-05-14 ([merge-conflict report](../council/agentdb-merge-conflict-resolution.md)), which removes the *blocker* to verification but does not constitute verification.

**Commits.** `forks/agentdb` `75c2c7e` (archivist tree + controller migrations + merge resolution), `forks/ruflo` `8e236890b` (cli MCP-tool-surface edits) + the pre-Phase-4 maintenance commits + #14 fail-loud fixes landed earlier, `ruflo-patch` `5b9e076` (pipeline gates + council reports + this ADR).

**The remaining work is its own program, not a wrap-up — see [ADR-0181](ADR-0181-archivist-runtime-activation.md).** F4-2's true depth (un-stub the ~88 remaining handlers, F4-3 cli `archivist.dispatch()` delegation across ~110 MCP tools, `initialize(config)` call-site wiring, read-optimized substrate completion, ADR-0112 enforcement-code retirement) is scoped there as a distinct execution plan rather than an open-ended tail of this ADR.

## Open follow-ups

1. **Naming.** `Archivist` (class) + `Store` (per-substrate handler) is the chosen vocabulary. Rejected during deliberation: `Bridge` (upstream baggage), `Middleware` (too generic), `Coordinator` (abstract — understates what the type system enforces), `Store` for the central role (collides with the per-substrate stores below; too overloaded). The thematic family is available downstream if useful: `Archive` (substrate as a whole), `Acquisition` (a write), `Reference` (a read), `Provenance` (source metadata).

2. **ADR-0179 supersession scope.** Once ADR-0180 is accepted, ADR-0179's "where do features land" question is answered. ADR-0179 should be updated to `depends-on: [ADR-0180]`; consider whether parts of ADR-0179 are subsumed.

    **Disposition (2026-05-13).** Pick **partial supersession via `depends-on`, not full supersession**. ADR-0179 stays standalone — both ADRs remain peers.

    *Subsumed by ADR-0180 §Architecture:* the *placement* question. ADR-0179 §"What ADR-0179 corrects" enumerates the six behaviours (MutationGuard, AttestationLog, TieredCache, BM25+semantic fusion, ExplainableRecall, SkillLibrary auto-promotion) and §"Implementation phases" Phase 3 specifies "call sites in router methods or MCP tool handlers" as their home. ADR-0180 §Architecture overrides that placement: the six features land at the archivist's MCP-dispatch boundary, not scattered across router call sites. ADR-0179 Phase 3's `routeMemoryOp 'store'` recipe is architecturally obsolete and must re-point at archivist handler registration.

    *NOT subsumed (ADR-0179's surviving contribution):* the *audit-gap methodology* — (a) the 34-row body-diff table as a durable artifact preventing recurrence of ADR-0085's structural-only audit, (b) the ADR-0053 inheritance-debt analysis showing four controllers regressed against named Phase 2/4/5 deliverables, (c) the controller-coverage acceptance check that converts ADR-0053's manual vigilance into structural enforcement. These are orthogonal to where features land.

    *Frontmatter change for ADR-0179.* Append `ADR-0180` to `depends-on`. Status stays `proposed`. No `superseded-by` field — the audit-methodology contribution survives ADR-0180.

    *Body amendment for ADR-0179.* Append a one-paragraph note to §"Implementation phases" Phase 3: "Per ADR-0180, restoration call sites land at archivist handler registrations (`registerMutationHandler<T>` / `registerReadHandler<T, R>`) rather than directly in router methods. The behaviours and tests in this ADR are unchanged; only the placement of the calls shifts from router method bodies to handler bodies invoked via archivist dispatch." Phase ordering: ADR-0179 Phase 1 + Phase 2 run before ADR-0180 Migration Phase 2 (archivist scaffolding); ADR-0179 Phase 3 folds into ADR-0180 Migration Phase 3 (memory_* surface).

3. **Context schemas — decided shape.** Decided in Architecture §Audit chain and §Type enforcement:
   * `MutationContext`: `{ auditId, originatingTool, guardVerdicts, timestamp, substrate }`. `timestamp` is REQUIRED (captured at intent-open, recorded in the audit entry — needed for replay). `substrate` is the branded `SubstrateAccess` capability handle. Downstream stores must NOT call `Date.now()` themselves.
   * `ReadContext`: `{ originatingTool, requestId, intent?, cacheHints? }`. `intent` is opt-in but recommended for read-side features (cache, fusion routing). No `substrate` field on read paths — reads use a read-only handle delivered the same way but typed `ReadOnlySubstrateAccess`.
   * Upstream evidence behind these choices: upstream has no structured context type (`bridgeStoreEntry` in `memory-bridge.ts:518` takes a flat options bag); their attestation record is `{ operation, entryId, timestamp, ...metadata }` (memory-bridge.ts:459); tracing lives in OpenTelemetry (`agentdb/src/observability/telemetry.ts`), not handler signatures. Our `guardVerdicts` field is an intentional fork delta — upstream consumes-and-discards verdicts; we propagate so downstream features can branch on them.

4. **Commit 511b7d3 disposition.** The "+36% wrapper fix" lives at substrate (inside `forks/agentdb/src/backends/factory.ts`), not at the archivist boundary. Decide before Phase 2: (a) lift the SelfLearningRvfBackend composition logic to the archivist (preferred — single chokepoint, matches the placement claim), or (b) keep at substrate and have the archivist call into it post-write (acceptable but couples the archivist to one substrate library). Estimate the lift cost before committing to (a).

   **Disposition (2026-05-13): keep at substrate; archivist calls in post-write (option b).** Sizing:

       - *What 511b7d3 changed.* 6 lines in `forks/agentdb/src/backends/factory.ts:166-170` swapping `new RvfBackend(config)` for `SelfLearningRvfBackend.create(config)`. The 491-LoC wrapper was already in-tree, orphaned.
       - *Dependency LoC* (`forks/agentdb/src/backends/rvf/`, 4083 LoC total): `SonaLearningBackend` 357 (agnostic), `SemanticQueryRouter` 456 (agnostic), `RvfSolver` 312 (agnostic), `ContrastiveTrainer` 559 (agnostic), `FederatedSessionManager` 526 (agnostic), `AdaptiveIndexTuner` 631 (**RVF-coupled** via `backend.indexStats()`), `NativeAccelerator` 489 (partial — `@ruvector/rvf-wasm` binding), `RvfBackend` 753 (the wrap target).
       - *RVF coupling inside the wrapper.* `this.backend.indexStats()` at line 303 (HNSW-specific), `selectEf()` returns HNSW `ef_search` arms 50/100/200/400, `verifyWitnessChain()` binds to `@ruvector/rvf-wasm`. The other ~440 LoC operate on Float32Array embeddings + opaque trajectory IDs.
       - *Consumer surface.* Zero — `grep` finds no fork caller of `getLearningStats()`/`recordFeedback()`/`getWitnessChain()`/`persistRouter()`/`forceLearn()`/`beginSession()` on the wrapper. The wrapper's specialized API is unused outside the wrapper itself.
       - *Lift cost (option a).* ~491 LoC wrapper + 2210 LoC substrate-agnostic deps (357+456+312+559+526) + ~200 LoC splitting `AdaptiveIndexTuner`'s HNSW-specific portion into a substrate-extension callback = ~2900 LoC of relocation. This would require rewriting `ReflexionMemory`'s `learningBackend` interface and crossing the package boundary between `forks/agentdb` and the archivist's parent package. Benefit: zero — the 5 SQLite carve-out controllers (CausalMemoryGraph, CausalRecall, NightlyLearner, LearningSystem aggregations, ReasoningBank GROUP BY per ADR-0166) have no embeddings/HNSW/`ef_search`, so the relocation doesn't unify substrate behavior. Cost without benefit; reject option (a).
       - *Keep-at-substrate cost (option b).* ~5 LoC. The archivist's `MutationContext.substrate` for the RVF store delivers a `SubstrateAccess` handle whose underlying backend is already a `SelfLearningRvfBackend` (per factory at 511b7d3). The store's `GuardedWrite` handler calls into the wrapper exactly as today; `recordMutationWitness` fires post-write automatically because the wrapper IS the substrate. The wrapper's witness chain is a substrate-specific SHAKE-256 chain orthogonal to the archivist's audit chain, not a competitor.
       - *Decision.* Option (b). Phase 2 proceeds without relocating the wrapper.

5. **ADR-0112 dependent-code migration.** ~14 sites in `controller-registry.ts` carry "ADR-0112 Phase 2: strict-mode discrimination" comments; 6 sites in `agentdb-backend.ts` use `requireAgentDB()` guards; `rvf-backend-errors.ts` defines `RvfNotInitializedError` as ADR-0112's "fail loud" pattern. Migration must re-classify Tier 1 controllers as guarded handlers and replace the per-store init guards with the archivist's init-completion guarantee. This is not optional — leaving these in place creates a coordination layer above stores that *also* expect to be the coordination layer.

   **Disposition (2026-05-14).** Split across **Phase 6** (mechanical re-wiring) and **Phase 10** (legacy retirement) per §Migration concerns; both phases enumerate the work but #5 explicitly closes the "where does this land" question.

   *Phase 6 deliverable.* Migrate `agentdb_*` cli surface (~20 tools) end-to-end via `registerMutationHandler` / `registerReadHandler`. In the same phase: (a) re-classify the ~14 controller-registry.ts "Phase 2: strict-mode discrimination" call sites as guarded handlers — each gets a `registerMutationHandler<T>` registration in `archivist/handlers/<surface>/<controller>.ts` and the controller's direct substrate access is removed; (b) delete the 6 `requireAgentDB()` guards in agentdb-backend.ts — they encode the per-store init contract that the archivist's init-completion guarantee now provides at higher confidence (lazy-per-tool init, gated by registration). Acceptance: `grep -RE 'ADR-0112 Phase 2|requireAgentDB\(' forks/agentdb/src/` returns zero matches; `archivist/handlers/agentdb/**` covers all 20 tool surfaces; Tier 1 replay tests (per Follow-up #19) pass for the agentdb surface.

   *Phase 10 deliverable.* Retire `RvfNotInitializedError` in `rvf-backend-errors.ts` (and its companion `MemoryNotInitializedError` if present). The pattern's intent ("fail loud when controller called pre-init") is preserved by the archivist's init-completion guarantee — handlers are invoked only after `Archivist.initialize()` resolves, and the registration boundary won't pass `MutationContext`/`ReadContext` if substrate is not ready. The legacy error classes are imported in ~3-5 sites (audit via `grep -RE 'RvfNotInitializedError|MemoryNotInitializedError' forks/`); each callsite drops the catch+rethrow wrapper and trusts the archivist contract. Acceptance: error classes deleted from `rvf-backend-errors.ts`; no remaining imports anywhere in the tree; release-pipeline preflight scans for both patterns and fails the build if either reappears (drift guard).

   *Why not earlier.* Phase 6 is the natural touch-point because that's when agentdb_* surfaces migrate; doing the controller-registry refactor before Phase 6 would touch handlers that don't yet have an archivist registration to flip to. Phase 10 is the natural touch-point for the error-class retirement because the init-completion guarantee can only be relied on once every surface (phases 2-9) has crossed the archivist boundary; retiring `RvfNotInitializedError` before Phase 10 would leave unmigrated surfaces relying on it.

   *Out of scope for #5 (separately tracked).* The pre-existing "Two of the call-site patterns audited" bugs in §Migration concerns Phase 4 (agents.json substrate bypass, consensus lock omission) are separate fork bugs — tracked in §Migration concerns Phase 4 paragraph, landed as pre-Phase-4 maintenance commits on `forks/ruflo/v3 main`, NOT as part of the ADR-0112 cleanup work scoped here.

6. **MutationGuard verdict semantics.** What kinds of guards run? Size limit? Quality threshold? PII filter? Schema validation? The branded `GuardVerdict[]` array lets stores branch on outcomes (e.g., "skip semantic indexing if quality-guard rated this low"), but the verdict types are undefined here. Define in a follow-up ADR or in `MODULE.md` before Phase 4.

   **Disposition (2026-05-13).** Guards live in `archivist/guards/` as pluggable modules; the archivist ships a default set; plugins can register additional guards via `archivist.registerGuard(name, fn)`. Each guard returns a `GuardVerdict` discriminated by `guard` name. Verdicts are collected into `MutationContext.guardVerdicts: readonly GuardVerdict[]` before the handler runs, so downstream stores can branch on outcomes without re-evaluating policy.

   *Algebra.* Each verdict carries `outcome: 'pass' | 'warn' | 'veto'`. The archivist composes verdicts with two rules: (a) **ANY veto rejects the mutation** — the handler is never invoked, the audit entry is written with `state: 'rejected'`, the rejection surfaces to the caller per `feedback-data-loss-zero-tolerance` (no silent fall-through); (b) **`warn` lets the write through** but is recorded in the audit entry and surfaced via observability (#21). Guards run independently — no short-circuit on first veto — so the audit entry captures all relevant policy signals for a single mutation, not just the first failing one. Guard failures (exceptions inside guard code) materialize as synthetic `{ outcome: 'veto', reason: 'guard error: ...' }` verdicts per `feedback-best-effort-must-rethrow-fatals` (upstream's `try { ... } catch { return allowed: true }` degraded-mode fallback is **not** adopted — fail-closed).

   *Default guards shipped with archivist (5):* `size` (per-store byte-limit on payload), `quality` (embedding-confidence threshold; `score` carries the value so handlers can branch on quality < threshold without re-scoring), `pii` (regex + named-entity scan; vetoes by default but can be configured to `warn`), `schema` (Zod/JSON-Schema validation against the registered handler's payload type), `rate-limit` (per-tool token bucket; vetoes when exhausted).

   *Discriminated union (TypeScript sketch).*

   ```ts
   export type GuardName = 'size' | 'quality' | 'pii' | 'schema' | 'rate-limit';
   export type GuardOutcome = 'pass' | 'warn' | 'veto';

   interface GuardVerdictBase {
     readonly guard: GuardName | string;        // plugin guards use string brand
     readonly outcome: GuardOutcome;
     readonly reason?: string;                  // required when outcome !== 'pass'
   }
   export interface SizeVerdict      extends GuardVerdictBase { guard: 'size';       bytes: number; limit: number; }
   export interface QualityVerdict   extends GuardVerdictBase { guard: 'quality';    score: number; threshold: number; }
   export interface PiiVerdict       extends GuardVerdictBase { guard: 'pii';        matches: ReadonlyArray<{ kind: string; offset: number }>; }
   export interface SchemaVerdict    extends GuardVerdictBase { guard: 'schema';     errors?: ReadonlyArray<{ path: string; message: string }>; }
   export interface RateLimitVerdict extends GuardVerdictBase { guard: 'rate-limit'; tokensRemaining: number; resetAtMs: number; }
   export interface PluginVerdict    extends GuardVerdictBase { guard: string;       metadata?: Readonly<Record<string, unknown>>; }

   export type GuardVerdict =
     | SizeVerdict | QualityVerdict | PiiVerdict | SchemaVerdict | RateLimitVerdict | PluginVerdict;

   // Handler-side use:
   function reflexionStore(ctx: MutationContext, payload: ReflexionPayload) {
     const quality = ctx.guardVerdicts.find((v): v is QualityVerdict => v.guard === 'quality');
     const skipSemantic = quality?.outcome === 'warn' && quality.score < 0.5;
     // ... store; conditionally skip vector index
   }
   ```

   *Plugin contract.* Plugins call `archivist.registerGuard(name, async (intent, payload, ctx) => GuardVerdict)` from their init hook. The archivist reserves the five default names; plugin names must be namespaced (`plugin-name/guard-name`) and produce `PluginVerdict`. Plugin guards participate in the same `veto > warn > pass` algebra; the archivist does not differentiate built-in vs plugin verdicts at compose time. Guards have no access to `SubstrateAccess` — they receive intent, payload, and a read-only subset of `MutationContext` (`originatingTool`, `timestamp`).

   *Why this shape vs upstream's `{ allowed, reason }`.* Upstream consumes-and-discards (binary allow/deny). We propagate verdicts as `MutationContext.guardVerdicts` so handlers can branch (skip-semantic-on-low-quality is the canonical case from ADR-0179 §6). The `warn` outcome closes the upstream gap where a borderline write either passed silently or was rejected outright — neither captures "store but mark for follow-up review."

7. **Migration order — see §Migration concerns.** Per-store parallel migration (earlier plan) is infeasible given the ~200+ call site scope from the caller audit. Phases 2-10 in §Migration concerns walk the surfaces in dependency order: scaffolding → memory_* → hive-mind_* → file-system JSON group → agentdb_* + ADR-0112 cleanup → hooks/daemons → standalone-server + cli-core decisions → inter-controller orchestrators → ADR-0112 legacy retirement.

8. **Standalone agentdb MCP server disposition** (`forks/agentdb/src/mcp/agentdb-mcp-server.ts`). 33 tools (~15 mutating) exposed as a separate MCP entrypoint — distinct from the cli's MCP server. Consumers can connect to it directly, bypassing the archivist. Two options: (a) cover it with the same archivist contract (requires the archivist or an equivalent surface to be reachable from agentdb-package code, which currently has no dependency on the cli package), or (b) retire it pre-archivist and direct consumers to the cli's MCP entrypoint. Decide before Phase 8.

   **Disposition (audited 2026-05-13):**

   *Confirmed consumers (live):*
   * `forks/agentdb/src/cli/agentdb-cli.ts:2134` — `handleMcpCommand` resolves `path.join(__dirname, '../mcp/agentdb-mcp-server.js')` and `spawn('node', [mcpServerPath], { stdio: 'inherit' })`. This is the published `agentdb mcp start` invocation path (the package's only `bin`: `agentdb` → `dist/src/cli/agentdb-cli.js`). The CLI help string at line 2120 advertises it as the supported entrypoint.
   * `.claude/skills/reasoningbank-agentdb/SKILL.md:32`, `.claude/skills/agentdb-memory-patterns/SKILL.md:45`, `.claude/skills/agentdb-vector-search/SKILL.md:189` (3 ruflo-patch skills, plus 3 mirrored copies in `forks/ruflo/.claude/skills/**` and 3 in `forks/ruflo/.agents/skills/**`) — each documents `claude mcp add agentdb npx agentdb@latest mcp` as the user-facing setup step. These are shipped under the `@sparkleideas/ruflo` skill surface that users invoke today.
   * `forks/agentdb/tests/cli-mcp-integration.test.ts:314,326,337` and `forks/agentdb/tests/validation/comprehensive-validation.js:110` — import `storePattern/searchPattern/getStats` from the server module and spawn `node dist/mcp/agentdb-mcp-server.js`. Validates the published surface; runs in CI on every agentdb release.
   * `forks/agentic-flow/docs/guides/getting-started/quick-start.md:315,327`, `MCP-AUTHENTICATION.md:92,835,1955,2003`, and `ISSUE-48-AGENTDB-PERSISTENCE-ANALYSIS.md:11` — published documentation directs users to `claude mcp add agentdb npx agentdb mcp` / `agentdb@latest mcp start`. External consumers may already have this in their `~/.claude/mcp.json` per these guides.
   * `forks/agentdb/package.json` — `bin: { "agentdb": "dist/src/cli/agentdb-cli.js" }` makes `npx agentdb mcp start` resolve for every install of the published `@sparkleideas/agentdb` package (currently `3.0.0-alpha.14-patch.1` on Verdaccio per `project-agentdb-parallel-extraction`).

   *Recommendation: cover under archivist contract (option a), do NOT retire.* The standalone server is a published, documented, currently-recommended surface with both internal (3 skills) and external (quick-start docs) consumers. Retiring it would (i) break every existing user setup that followed the documented `claude mcp add agentdb …` instructions, (ii) require deprecation notice + migration window across the published package's existing alpha line, and (iii) contradict `feedback-no-value-judgements-on-features` (default to wire, don't curate).

   *Architectural cost of covering it:* the agentdb package currently has no dependency on the cli package (verified via `forks/agentdb/package.json` exports + dependencies). Two options to bridge:
   * **(a1) Lift the archivist into the agentdb package.** The substrate-internal module already lives inside agentdb (the RVF backend factory at `forks/agentdb/src/backends/factory.ts` is the +36% wrapper site per follow-up #4). Placing the archivist in the agentdb package keeps the type-enforcement boundary co-located with substrate. Cli imports archivist from agentdb. Adds zero new package deps.
   * **(a2) Move standalone server tools into the cli package.** Retain the `agentdb mcp` CLI command as a thin shim that spawns the cli's MCP entrypoint. Keeps archivist in cli, retires the agentdb-package server module, but preserves the user-facing `npx agentdb mcp` contract. Requires deprecation of the agentdb package's `mcp/` directory but not the bin invocation.

   *Rationale:* (a1) preserves the existing cli→agentdb dependency direction (cli already consumes agentdb; reversing would make agentdb's standalone server depend on cli internals). It also co-locates the archivist with the +36% wrapper's current home — both substrate-adjacent concerns live in one package. (a2) would invert the dependency direction with no offsetting benefit.

   **Decision (2026-05-14): (a1) — lift archivist into the agentdb package.** Not a recommendation pending Phase 8 confirmation — this is the binding choice. Implementation: the archivist source moves to `forks/agentdb/src/archivist/**`, exported via the package's `exports` field as `@sparkleideas/agentdb/archivist`; the cli package imports archivist from agentdb. The standalone agentdb-mcp-server registers handlers against the same archivist instance as the cli's MCP server. Both surfaces enforce mutation invariants identically. Phase 8's work is the mechanical implementation, not the architectural decision.

   *Package-label update (per audit 2026-05-14, Pass 2 FATAL → resolved).* With (a1) in place, the prior framing "agentdb = SDK + MCP surface; cli = orchestration" no longer fits the structure. Restated: **`@sparkleideas/agentdb` hosts substrate + thin coordination (the archivist) — substrate primitives, controllers, the standalone MCP server, AND the archivist that mediates writes/reads above all of them.** **`@sparkleideas/cli` is the published cli + the cli-side MCP server surface — it registers handlers against the agentdb-hosted archivist and provides the user-facing `ruflo` binary.** This labeling shift is descriptive (matches the post-a1 reality), not architectural — the decision is unchanged. The "thin archivist" property is preserved within agentdb via the `MODULE.md` charter and the type-enforced substrate seam; calling agentdb's contents "coordination + substrate" rather than "just SDK" doesn't make the archivist fatter.

9. **cli-core JsonMemoryBackend disposition.** `@claude-flow/cli-core/commands/memory.ts` uses a separate file-based `JsonMemoryBackend` (memory/json-backend.js), entirely bypassing the main `routeMemoryOp` router. Plugin scripts depend on it. Decide: (a) route through archivist (requires cli-core to import the archivist), or (b) document as an explicit non-archivist surface with no audit chain. Affects what "the audit chain is complete" means.

    **Disposition (audited 2026-05-13, researcher).**

    *Callers found.* In-tree grep across all 5 forks (`ruflo`, `agentic-flow`, `agentdb`, `ruvector`, `ruv-FANN`) and `ruflo-patch` for `JsonMemoryBackend` and `@claude-flow/cli-core` imports turned up **zero source-code consumers outside the package itself**:
    * `forks/ruflo/v3/@claude-flow/cli-core/src/{index.ts:55, memory/json-backend.ts, memory/backend.ts, commands/memory.ts:17, mcp-tools/memory-defs.ts}` — the package's own surface.
    * `forks/ruflo/v3/@claude-flow/cli/src/output.ts:9` and `types.ts:13` — re-exports of cli-core's `output` and `types` subpaths only (NOT memory). Foundation-module re-exports per cli-core `MIGRATION.md` §"Imminent next step (alpha.5+)".
    * `forks/ruflo/v3/@claude-flow/cli/package.json:100` — `@claude-flow/cli-core: 3.7.0-alpha.5-patch.25` runtime dep, used only for the foundation re-exports above. cli does NOT import `./commands/memory` or `./memory/json-backend`.
    * 20 plugins under `forks/ruflo/plugins/` and 30+ under `forks/ruflo/v3/@claude-flow/plugins/` and `forks/ruflo/v3/plugins/` — **zero hits** for `cli-core` or `JsonMemoryBackend` in non-dist source.

    The intended consumer model is **out-of-tree shell-out**, not in-tree import. Published `package.json` `exports` (`./commands/memory`, `./memory/json-backend`) target external plugin scripts that `spawnSync('npx', ['@claude-flow/cli-core@alpha', 'memory', 'store', ...])` per `cli-core/MIGRATION.md`. The migrator script `cli-core/scripts/migrate-plugin-call-sites.mjs` rewrites `npx @claude-flow/cli@latest memory ...` invocations in external plugin directories to opt into cli-core via a `CLI_CORE=1` env flag. **No such migrated call sites exist in this repo's fork tree.**

    *Recommendation.* **Option (b) — explicit non-archivist surface with no audit chain**, with three caveats:
    1. cli-core is purposefully decoupled from the heavy cli/agentdb dependency tree (per ADR-0162 §Batch F-2 — cli-core split `ba92c5612` measured 22.9× cold-cache speedup; cli-core targets ~5s vs cli's ~25s cold start; reference corrected per audit Pass 3, LOW → resolved — earlier draft cited "ADR-100" which both used a non-canonical numbering and pointed at the wrong ADR — ADR-0100 is the project-root-resolution ADR). Importing the archivist module (which depends on `better-sqlite3`/RVF, OTEL, the controller registry, etc.) would defeat the entire point of cli-core. Option (a) is architecturally incoherent.
    2. The `JsonMemoryBackend` storage file (`.swarm/memory.json`) is documented as **deliberately distinct** from the heavy `SqliteHnswMemoryBackend` (`.swarm/memory.db`) — `MIGRATION.md` §"Storage file changes" warns "they DON'T share data". This is a separate trust boundary by design, not an oversight.
    3. The package `README.md` and the archivist `MODULE.md` (per §Governance) must declare cli-core as a **NON-ARCHIVIST published surface**, alongside three operational rules: (i) no claim of audit-chain completeness for `.swarm/memory.json` writes; (ii) plugin authors who need audit chain MUST use the heavy `@claude-flow/cli` path (or `routeMemoryOp` directly), not cli-core; (iii) any future cli-core surface expansion that touches substrate beyond local JSON (e.g., the `MIGRATION.md` "alpha.4 opt-in HNSW build" idea) **re-opens this disposition**.

    *Audit-chain semantics.* "The audit chain is complete" means: every mutation routed through the **archivist** is on-chain. cli-core's `JsonMemoryBackend` writes are off-chain by construction and by published contract. This is acceptable because cli-core writes never touch the substrate(s) the archivist coordinates (RVF + SQLite carve-outs) — they only ever touch `.swarm/memory.json`, a file the heavy stack does not read. The two surfaces are storage-disjoint; cross-substrate consistency is not at stake.

10. **Three parallel store-of-stores patterns to converge.** §Migration concerns enumerates: SQLite via `routeMemoryOp` (~30%), file-system JSON `writeFileSync` of full store (claims/tasks/agents/swarm/...), and file-system + lock variants (hive-mind/workflow/wasm/swarm). The hive-mind primitive (`withHiveStoreLock` + `saveHiveState`) is the most mature precedent and should be lifted as the archivist's reference substrate primitive — confirm or replace with a different design.

    **Disposition (2026-05-13).** The fork-authored hive-mind primitive does NOT generalize as a single universal substrate primitive. **Extract** it from `hive-mind-tools.ts:1173-1259` into one of three substrate-specific implementations behind a shared `SubstrateAccess.withWrite<T>(fn)` capability — the seam is the abstraction, the implementations are substrate-shaped. Hive-mind itself becomes a consumer of `SubstrateAccess` post-migration, just like every other FS-JSON store.

    *Per-substrate suitability* (sources: `hive-mind-tools.ts:1173-1259`, `claims-tools.ts:75-112`, `swarm-tools.ts:146-153`, `sqlite-backend.ts:430,449`, `RvfBackend.ts:8,263-310`):

    | Substrate | hive-mind primitive components present | Generalizes? |
    |---|---|---|
    | File-system JSON (~18 stores: claims, tasks, agents, swarm, coordination, workflow, neural, github, performance, system, config, progress, ruvllm, daa, wasm, browser, autopilot, **plus hive-mind itself**) | One mature implementation in-place: hive-mind's `withHiveStoreLock` + `saveHiveState` at `hive-mind-tools.ts:1173-1259` (~94 KB fork-authored, ADR-0095). The other ~17 split into naive `writeFileSync` (~12) and partial implementations (~4 with tmp+rename-without-fsync or pid-lock-without-rename); autopilot has an append-log variant. | **Yes — extract, then share.** Move the fork's hive-mind primitive out of `hive-mind-tools.ts` into `makeFsJsonSubstrate`. All ~18 stores (including hive-mind) consume `SubstrateAccess.withWrite` post-migration. Hive-mind's tool file loses ~2400 LoC of substrate machinery; the ~12 naive stores get their latent silent-loss bugs fixed. |
    | SQLite (memory-router via `agentdb-backend` / `sqlite-backend`) | NONE useful: `better-sqlite3` `db.transaction(fn)` provides atomicity + isolation + WAL durability in-process; SQLite's own file lock handles cross-process; no tmp+rename; no consumer cache (the DB *is* the cache). | **No — substitute `db.transaction(fn)` and drop the lock/WAL/rename ceremony.** Forcing an O_EXCL sentinel above `db.transaction` deadlocks the moment two SQLite-backed stores compose (each acquires its own lock, then waits on the other). |
    | RVF native (`RvfBackend.ts:263` `save()` → `flush()` + `db.compact()`; ingest via `db.ingestBatch()`) | atomic + fsync + crash-safe `.rvf` are handled inside the Rust crate at the N-API boundary; no JS-side lock or rename. | **No — JS layer must NOT add tmp+rename or its own lock.** Would duplicate crate-internal serialization and race against `pending` queue flushes (`RvfBackend.ts:255`). Cache-after-success is already wired (`cachedCount++` at line 310). |

    *Generalized primitive — the seam is `SubstrateAccess`, implementations differ:*

    ```ts
    // archivist/substrate-internal.ts (path-restricted per §Type enforcement)
    export interface SubstrateAccess {
      /** Atomic, isolated, durable mutation. Substrate-appropriate exclusion;
       *  commits on `fn` return; leaves prior state intact on throw.
       *  Cache invalidation runs only after commit. */
      withWrite<T>(fn: (handle: SubstrateHandle) => Promise<T>): Promise<T>;
      /** Bulk variant — see §Bulk-write mode. One audit summary, not N. */
      withBulkWrite<T>(intent: BulkIntent, fn: (h: SubstrateHandle) => Promise<T>): Promise<T>;
    }

    // archivist/substrates/fs-json-store.ts — primitive extracted from hive-mind-tools.ts:1173 (ADR-0095)
    export function makeFsJsonSubstrate<S>(path: string, cache: Map<string, S>): SubstrateAccess {
      return {
        async withWrite(fn) {
          return withFileLock(`${path}.lock`, async () => {
            const handle = { read: () => loadJson(path), write: (s: S) => saveJsonAtomic(path, s, cache) };
            return await fn(handle);   // saveJsonAtomic = openSync+writeSync+fsyncSync+closeSync+rename; cache.set ONLY after rename
          });
        },
        withBulkWrite(_intent, fn) { return this.withWrite(fn); /* archivist emits manifest */ },
      };
    }

    // archivist/substrates/sqlite-store.ts
    export function makeSqliteSubstrate(db: BetterSqlite3.Database): SubstrateAccess {
      return {
        async withWrite(fn) {
          // db.transaction wraps BEGIN IMMEDIATE / COMMIT / ROLLBACK; SQLite's
          // own file lock handles cross-process. No O_EXCL above it.
          let result: unknown; db.transaction(() => { result = await fn({ db }); })();
          return result as T;
        },
        withBulkWrite(_intent, fn) { return this.withWrite(fn); },
      };
    }

    // archivist/substrates/rvf-store.ts
    export function makeRvfSubstrate(backend: RvfBackend): SubstrateAccess {
      return {
        async withWrite(fn) { return await fn({ rvf: backend }); /* ingestBatch internally serialized */ },
        withBulkWrite(_intent, fn) { return this.withWrite(fn); },
      };
    }
    ```

    *Why not a single universal implementation.* The three substrates already provide isolation + durability at different layers (Rust crate for RVF, SQLite itself for `agentdb-backend`, the manually-built lock+WAL stack only for FS-JSON). A universal lock above all three serializes traffic the lower layer would have parallelized (SQLite-WAL readers, RVF concurrent `ingestBatch`); a universal "no lock" rule reintroduces the entry-count silent-loss mode `saveHiveState` (line 1191 comment) was added to close. The shared abstraction is `SubstrateAccess.withWrite`, not the implementation under it.

    *Recommendation.* Adopt `SubstrateAccess` as the archivist's substrate seam. **Extract** `withHiveStoreLock` + `saveHiveState` from `hive-mind-tools.ts:1173-1259` (where it lives today inside an MCP-tool handler, per ADR-0095) into `makeFsJsonSubstrate` (Phase 2 of the migration). The primitive is the right shape for the file-system JSON family (~18 stores: claims, tasks, agents, swarm, coordination, workflow, neural, github, performance, system, config, progress, ruvllm, daa, wasm, browser, autopilot, **plus hive-mind itself** post-migration). The ~12 naive `writeFileSync` stores and ~4 partial implementations all gain proper durability; hive-mind's MCP-tool file loses ~2400 LoC of substrate machinery and becomes a normal `SubstrateAccess` consumer. Implement `makeSqliteSubstrate` and `makeRvfSubstrate` as thin pass-throughs to the layer that already owns durability. The TieredCache invalidation contract (#24) wires to the post-commit cache hook present in `makeFsJsonSubstrate` and absent (intentionally) in the other two — that asymmetry is real and must be documented in `MODULE.md`, not papered over.

11. **Two parallel consolidation systems.** `intelligence.cjs:consolidate()` invoked from the `session-end` hook (writes `.claude-flow/data/*.json` — graph-state, ranked-context, snapshot) and the worker-daemon's `runConsolidateWorker` (writes `.claude-flow/metrics/consolidation.json`) are uncoordinated, overlap in concern, and will both route through the archivist after migration. Decide whether one supersedes the other before Phase 7.

    **Disposition (2026-05-13).** Pick **worker-daemon `runConsolidateWorker` as the winner**; retire `intelligence.cjs:consolidate()` as a session-end caller and move its lifecycle-tied artifacts (graph-state, ranked-context, snapshot) onto the daemon's schedule.

    *Scope comparison.* `intelligence.cjs:consolidate()` (intelligence.cjs:717-891) is in-process, lifecycle-tied to `session-end`, and writes `.claude-flow/data/{graph-state,ranked-context,intelligence-snapshot}.json` with locally-implemented dedup + PageRank + eviction + 30-day decay. ~175 LoC of bespoke graph maintenance. `runConsolidateWorker` (worker-daemon.ts:1403-1450) is out-of-process, daemon-scheduled (10–60 min intervals per ADR-0180 §Architecture Daemons), and delegates to `routeLearningOp 'consolidate'` via the memory-router — the supported ADR-0084 Phase 3 path. Writes a single summary file (`metrics/consolidation.json`) but the *real* state changes happen inside `routeLearningOp` (which is the surface the archivist will dispatch to in Phase 7).

    *Why daemon wins.* (1) `runConsolidateWorker` already routes through `routeLearningOp` — the archivist boundary will sit above it without further refactor; `intelligence.cjs:consolidate()` is a parallel implementation that re-derives the same node/edge graph from `.claude-flow/data/store.json` and would need to either route through the archivist (re-implementing in TypeScript) or be retained as a non-archivist surface (violating the single-chain claim). (2) Lifecycle-tied + in-process is the wrong shape for COLD-but-heavy work — `session-end` is listed that way in ADR-0180 §Performance, and the user can run multiple parallel sessions where each independently rewrites `graph-state.json`, racing with the daemon's writes. (3) Writes-overlap analysis: both write under `.claude-flow/` but to different files (`data/*.json` vs `metrics/consolidation.json`); the conflict is conceptual (both maintain consolidated knowledge graphs), not on-disk. The daemon path is the one the archivist's audit chain can guarantee single-writer semantics for.

    *Migration.* Move the `intelligence.cjs:consolidate()` body (dedup + PageRank + eviction logic) into a TypeScript module the daemon's `runConsolidateWorker` invokes after `routeLearningOp 'consolidate'`. The session-end hook becomes a no-op pointer that nudges the daemon to schedule a consolidation pass. `.claude-flow/data/{graph-state,ranked-context,snapshot}.json` writers move under the daemon's archivist handler. The `intelligence.cjs` helper stays alive for read-side helpers (`pre-task` confidence boost, etc.) — only `consolidate()` is hoisted out.

    *Nudge mechanism — concrete spec* (per audit 2026-05-14, HIGH → resolved). The session-end hook's "nudge the daemon" step uses the existing daemon Unix-domain-socket IPC (`daemon-ipc.ts` + `.claude-flow/daemon.sock` per disposition #21 + `reference-pipeline-publish-paths`). The hook sends a one-line JSON request `{op: "consolidate.schedule", reason: "session-end", sessionId, ts}` over the socket; the daemon ACKs by enqueueing a consolidation pass at the next worker tick (≤250ms). If the daemon socket is absent (daemon not running), the hook logs WARN `"daemon socket unreachable; consolidation will run at next daemon start"` and returns success — the consolidation is recovered on the next `ruflo daemon start` because it scans the audit log for `session-end` events without a paired `consolidation.applied` and re-enqueues. **No silent loss** per `feedback-no-fallbacks.md`. Hook never blocks on consolidation completion.

    *Recovery-scan bounds — concrete spec* (per audit Pass 2, MEDIUM → resolved). The "scan the audit log for `session-end` events without a paired `consolidation.applied`" step needs explicit bounds to prevent pile-up at scale: (a) **Scan window:** last 7 days of audit entries (sufficient for laptop-sleep + weekend gaps; longer windows are not load-bearing because stale session-end events have low marginal value); audit-log entries older than 7 days are skipped silently in this scan even if unpaired. (b) **Dedup:** the daemon's in-memory consolidation-pending set is keyed by `sessionId`; if a sessionId is already enqueued OR has a `consolidation.applied` entry within the scan window, the recovery pass skips re-enqueueing it (idempotent). (c) **Queue-depth cap:** the daemon's pending consolidation queue has a hard cap of 50 entries; if 50 unpaired session-end events are found in one recovery scan (likely indicates the daemon was offline for an extended period), the daemon enqueues the 50 most-recent and logs WARN `"recovery scan capped at 50; older unpaired session-end events skipped"` for the rest. The cap prevents a startup queue blowup. (d) **Scan cost:** O(N) where N = audit entries in the 7-day window; on the dev machine's expected workload (~10-50 session-ends/week + a few hundred mutation entries) this is sub-second. (e) **Test gate:** `test/acceptance/consolidation-recovery.test.ts` (added to the existing test in `npm run release` acceptance stage) seeds an audit log with 60 unpaired session-end events, starts the daemon, asserts the daemon enqueues exactly 50, applies them, and logs the cap-WARN.

    *Test gate* (per audit, HIGH → resolved). Acceptance test `test/acceptance/consolidation-nudge.test.ts` (runs in `npm run release` acceptance stage): seeds substrate, fires `session-end` hook against a running daemon, asserts (a) daemon receives the IPC request within 50ms, (b) `runConsolidateWorker` invocation observed within 500ms, (c) audit log contains a `consolidation.applied` entry whose `parentAuditId` references the `session-end` hook entry, (d) `.claude-flow/metrics/consolidation.json` updated. Second test variant: kill daemon mid-test, fire `session-end`, restart daemon, assert recovery path enqueues the missed consolidation. Both variants gate the Phase 7 release.

    *Caveat.* `intelligence.cjs` runs in the `hook-handler.cjs` CommonJS shim (no TypeScript runtime, no archivist library access). After this disposition, `session-end` no longer writes `data/*.json` directly — operator-visible if they were monitoring those files. Document in CHANGELOG when Phase 7 lands.

12. **Re-entrancy + bulk-mode semantics under load.** §Re-entrancy specifies `MutationContext.child(reason)` for nested writes (NightlyLearner, MemoryConsolidation, SkillLibrary cascades) and §Bulk-write mode specifies `MutationContext.bulk(intent, payload)` for SyncCoordinator/migrate paths. Both are designed but not yet exercised. Phase 9 is the load test.

    **Disposition (2026-05-13).** Three load-test scenarios cover the contract. Each runs against a freshly-initialized substrate and asserts pass/fail criteria below; scenarios live at `forks/<archivist-package>/test/load/` and run as part of Phase 9 acceptance.

    *Scenario A — `NightlyLearner.run()` re-entrancy depth.* Drive 1 invocation that cascades into Causal + Reflexion + SkillLibrary child contexts (NightlyLearner.ts:101-310, 411, 501, 576). Measure: parent audit entry has children for each downstream controller; audit tree depth ≤ 3 levels (parent → controller-child → store-child); total entries equals sum of mutations actually performed. Pass: depth ≤ 3, audit-tree mutation count equals observed substrate mutation count, p99 wall-clock latency ≤ 1.5× the pre-archivist baseline measured on the same fixture. Fail on any mismatch or p99 regression > 50%.

    *Scenario B — `SyncCoordinator.applyChanges` bulk mode at 1000 rows × 4 tables.* Drive applyChanges with a synthetic pull payload of 1000 rows across the 4 tables at SyncCoordinator.ts:509, 548, 572, 648. Measure: exactly 1 bulk audit entry per table (4 total, not 4000); each entry carries `{ count, checksum, tableName }` manifest; replay against fresh substrate produces row-count + checksum equality per table. Pass: ≤ 4 audit entries, replay manifest-equality holds, total time ≤ 2× the unguarded baseline (bulk overhead sublinear in row count). Fail if per-row entries appear, replay diverges, or overhead is super-linear.

    *Scenario C — `MemoryConsolidation.createSemanticMemory` cascading 100 episodes.* Drive consolidation across 100 episode rows clustering into ~10 semantic memories (MemoryConsolidation.ts:347-452). Each cluster triggers store → markConsolidated → applyForgettingCurve → vectorBackend.remove. Measure: audit tree shape matches operation tree exactly (10 parents, each with 4 children in recorded order); replay re-applies children in order; final state equals live state on `(id, embedding_id, consolidated_flag)` by primary key. Pass: tree-shape equality, replay set-equality, no orphaned entries, no double-writes. Fail on any mismatch.

    *Cross-scenario invariant.* `audit-entry count = mutation count + bulk-entries`. Same invariant §Confirmation asserts on the representative mutation suite; the load tests exercise it under re-entrancy and bulk pressure the suite doesn't cover.

    *Fixture management.* Each scenario seeds substrate via the admin escape hatch (§Escape hatch) and tears down by re-initializing. No shared state between scenarios. Baselines captured pre-archivist on the same fixture and committed to `test/load/baselines.json` — regression bands relative to these, not absolute targets.

13. **Hot-path fast-path concrete budget.** §Performance lists `post-edit` and `pre-task` as the two HOT hook writers. The fast-path budget (256-entry in-flight queue + write-through journal + batched fsync ≤100ms, guard skipped, async post-write triggers — per #17/#18 reconciliation; earlier framing said "in-memory ring buffer", retired) needs a concrete latency target (per-call median + p99) before Phase 7. Current `pending-insights.jsonl` `appendFileSync` is <2ms; the archivist fast-path must stay under that ceiling.

    **Disposition (2026-05-13).** Targets measure the synchronous call returning to the caller — buffer enqueue + audit-entry construction. Async fsync drain and post-write triggers run off-path and have a separate freshness SLO, not a latency budget.

    *Latency targets (synchronous return to caller):*
    * **p50 ≤ 300μs** — covers in-flight queue enqueue, `MutationContext` allocation, audit-entry shape (`{ auditId, originatingTool, processId, parentAuditId?, timestamp, payloadHash }`), and JSON serialization of a typical hook payload (≤2KB). No I/O on the synchronous return path; `write()` happens during microtask drain.
    * **p99 ≤ 2ms** — matches the existing `pending-insights.jsonl` `appendFileSync` LATENCY ceiling, not its durability semantics. The archivist's batched fsync is faster than sync-per-entry on the same ceiling; durability differs (process-crash safe; power-loss ≤100ms window — out of scope per user). Headroom absorbs: a coincident fsync drain holding the buffer's write lock briefly (~500μs on local SSD), V8 GC pauses, and audit-log rotation crossover.
    * **p99.9 ≤ 5ms** — soft alert ceiling. Above this, the hot-path is regressed; investigate before the next release tag.

    *Async drain SLO (separate from latency budget):* `write()` drain from the in-flight queue runs on microtask (~µs); the `fsync()` drain runs on the ≤100ms timer (per #18 write-through journal). After `write()` returns the entry is in the kernel page cache and survives process crashes; only the kernel-fsync window (≤100ms uncommitted) is at risk under kernel/hardware events, which is explicitly out of scope per user. Signal handlers (SIGTERM/SIGINT/SIGHUP/SIGUSR1/SIGUSR2/beforeExit/exit) trigger immediate `fsyncSync()` of the open audit fd. Drain latency is NOT charged to the hot-path budget — both drains are off-path by construction.

    *Hot-path registration contract (`registerMutationHandler(..., { hotPath: true })`):* By opting in, the handler asserts:
    1. **No MutationGuard.** Caller has structurally validated payload shape (hook payloads are constructed in-process from typed sources); no PII/size/quality guard runs. Skipping guards is the largest single budget contributor — guards typically cost 200μs-1ms each.
    2. **No synchronous fsync.** Audit entry enqueues to the 256-entry in-flight queue; `write()` happens on microtask drain (page-cache only); fsync coalesces in the ≤100ms timer.
    3. **No synchronous post-write triggers.** SkillLibrary auto-promotion, BM25 reindex, cache-warmup, and any other post-write hook runs on a microtask/`setImmediate` queue. Trigger failure is logged but does NOT propagate to the caller.
    4. **No nested `MutationContext.child()`.** Hot-path writes are leaf intents. Re-entrancy is disallowed because child-context bookkeeping doubles allocation cost and breaks the audit-tree assumption that hot writes are single-row.
    5. **Bounded payload size.** Payloads >4KB fall back to cold-path automatically (runtime check at in-flight queue enqueue diverts oversized intents). Hook writers expecting larger payloads (e.g., session-end's consolidation outputs) must register WITHOUT `hotPath: true`.

    Violations fail at registration time (compile-time for #4 — `hotPath: true` handlers receive a `MutationContext` whose `child` method is typed `never`) or runtime (size diversion for #5).

    *Microbenchmark requirement (gates Phase 7 release):* `forks/<archivist-package>/bench/hot-path.bench.ts` runs a hot-path handler 10,000 times against an initialized archivist with the 256-entry in-flight queue + write-through journal active (per #17/#18 reconciliation). Asserts p50 < 300μs, p99 < 2ms, p99.9 < 5ms. Comparison baseline is `fs.appendFileSync` to a discarded tempfile (current `pending-insights.jsonl` shape) — archivist p50 MUST be ≤ baseline p50, p99 MUST be ≤ baseline p99. Wired into `npm run release`'s acceptance stage (the 30s wall-clock cost fits the existing acceptance budget but is too slow for `npm run test:unit`). Regressions block release. Bench framework: Node's built-in test runner with `performance.now()` timings collected into a histogram — no third-party perf dep.

    *Cross-process variant — real workload, not synthetic* (per audit 2026-05-14 Pass 1 + 2, HIGH → resolved): `forks/<archivist-package>/bench/hot-path-contended.bench.ts` drives a REAL multi-process workload rather than a synthetic simulator (Pass 2 DA flagged: 50ms-cadence fixture cannot represent real OS-scheduler effects, real Edit storms, or `flock`-vs-`F_OFD_SETLK` semantics — see Follow-up #15 amendment). Setup: (a) one terminal runs `npm run release` end-to-end (real preflight + build + publish + acceptance against Verdaccio); (b) a second process drives a real Edit storm — fork the bench harness as a child process that opens 10 files via the cli's `claude-code edit` path and rewrites each 100 times across the bench window, triggering real `post-edit` hooks against the real audit log; (c) the cli + daemon are both running their normal lifecycle (daemon performs real scheduled writes). The contended bench measures the hot-path handler's p99 latency while all three contenders compete for the `archivist-audit.jsonl` advisory write-lock. Asserts p99 ≤ 5ms (relaxed from <2ms — explicit contention budget) AND that the single-process baseline measured in the same run remains within its <2ms p99 band. Wall-clock cost ~3 minutes; fits the existing acceptance budget. Captures: lock-acquisition wait histogram, fsync-batch-coalesce ratio, page-cache pressure (via `/proc/meminfo` deltas where available). If single-process p99 stays in band but contended p99 exceeds 5ms, the gate fails with "lock contention exceeds budget" — Phase 7 release blocked until either (i) lock-acquisition path optimized or (ii) the contended ceiling is renegotiated by ADR amendment. The synthetic-fixture predecessor is rejected because it cannot reproduce real-world bursty Edit storms or the OS-scheduler pre-emption that production sees under cli + daemon + Verdaccio install concurrent load.

    *Out of scope.* Cold-path budgets (consolidation, session-end, sync — full ceremony acceptable at any latency under ~50ms p99 per write). Read-path budgets (reads have no audit; most are passthroughs). Backpressure when the 256-entry in-flight queue saturates faster than the microtask drain releases capacity — see follow-up #17 (bounded µs-scale producer block; backpressure is unreachable in practice given the 50× burst-envelope margin).

14. **Pre-existing best-effort failures unrelated to archivist.** Independent of archivist migration, the audit surfaced: `ruflo hooks notify` silently swallows `routeMemoryOp` failures (an ADR-0082 violation per `feedback-best-effort-must-rethrow-fatals.md`); `ruflo performance benchmark` permanently writes 20 entries to the "benchmark" namespace; `HooksLearningDaemon` silently no-ops if reasoningbank isn't loaded (per `feedback-no-fallbacks.md`). Fix during migration of each touched surface, not as a separate ADR.

    **Disposition (2026-05-13).** Three sites confirmed; in-place fixes specified below; each assigned to the migration phase where its surface gets touched.

    *Site 1 — `ruflo hooks notify` (`forks/ruflo/v3/@claude-flow/cli/src/commands/hooks.ts`).* Today: wraps the `routeMemoryOp` call in `try { ... } catch { /* swallow */ }` so notifications appear to succeed when the storage write silently fails. **Fix:** discriminate per `feedback-best-effort-must-rethrow-fatals.md` — catch and log only `MemoryNotInitializedError` (best-effort case, expected when daemon hasn't started); rethrow every other error so a corrupted substrate, locked DB, or schema mismatch surfaces to the CLI exit code instead of being hidden. **Phase:** **ADR-0180 Migration Phase 7** (hooks + daemons surface migration). The fix lands as part of registering the `hooks` write path as a `registerMutationHandler` — the handler signature requires throwing on non-best-effort errors anyway, so the try/catch becomes structurally impossible.

    *Site 2 — `ruflo performance benchmark` (`forks/ruflo/v3/@claude-flow/cli/src/commands/performance.ts`, lines ~56-225).* Today: every invocation writes 20 entries to the "benchmark" namespace permanently, polluting substrate with throwaway test data that never gets evicted. **Fix:** route benchmark writes through a dedicated `benchmark-volatile` namespace marked `ephemeral: true` in the archivist's namespace config; namespace auto-clears on every benchmark run (overwrite-not-append semantics) and is excluded from `memory_search` by default. The 20-entry write becomes scratch space, not persistent state. **Phase:** **ADR-0180 Migration Phase 3** (memory_* surface migration). The benchmark command writes via `routeMemoryOp 'store'`, so the namespace-config change rides on the same Phase 3 work that introduces archivist's namespace-aware handler dispatch.

    *Site 3 — `HooksLearningDaemon` (`forks/ruflo/v3/@claude-flow/cli/src/services/hooks-learning-daemon.ts` or equivalent — referenced in ADR-0180 §Caller surfaces "Daemons / background workers").* Today: silently no-ops if `reasoningBank` is not loaded, hiding the fact that the consolidation-driven learning pipeline isn't running. Violates `feedback-no-fallbacks.md` (silent fallback masks broken feature). **Fix:** raise a startup-time fatal if `reasoningBank` is configured-but-unloadable (`config.memory.agentdb.enableLearning: true` AND import fails); log-and-skip only if explicitly disabled in config. Daemon startup must fail loud when its consolidation contract can't be honored. **Phase:** **ADR-0180 Migration Phase 7** (hooks + daemons surface migration). The fix lands alongside the daemon's archivist-handler registration — the daemon explicitly declares its consolidation dependency, and the archivist refuses to start the daemon if the dependency is configured-on-but-missing.

15. **Multi-process audit semantics.** The cli runs in one process; `ruflo daemon` runs in another; both write to the same substrate. The archivist is per-process — how do their audit chains compose? Options: (a) shared append-only audit-log file with file-locking ordering; (b) per-process audit logs that merge by timestamp at replay time; (c) audit chains are per-process and replay is per-process too (the user picks which to replay). Load-bearing for Phase 2 because the daemon's scheduled writers will write through *some* archivist instance; the ADR doesn't say which.

    **Disposition (2026-05-13).** Pick **(a) shared append-only audit-log file with cross-process advisory file-locking**. Per-process logs (b) make replay's "audit-entry count equals mutation count" §Confirmation invariant unverifiable without an out-of-band merge step that itself must be audited — recursion. Per-process replay (c) gives up the cross-substrate invariant that motivated the single chain. (a) is the only option that keeps the §Confirmation test as written.

    *Format.* JSONL at `.claude-flow/data/archivist-audit.jsonl`. One entry per line. Each entry carries `{ auditId, processId: { pid, role, sessionId }, parentAuditId?, timestamp, ... }`. `processId.role ∈ {'cli', 'daemon', 'hook', 'admin'}`. Rotation: size-based at 100MB to `archivist-audit.<n>.jsonl`, kept until size-budget eviction. Same shape as `pending-insights.jsonl`.

    *Locking.* `fcntl` advisory write lock (`F_SETLK`/`F_OFD_SETLK` on Linux, `flock`-emulated on macOS) acquired around the `write()+fsync()` pair, NOT held for the full intent. Lock window is microseconds. Intent ordering across processes is established by lock-acquisition order (the OS serializes). Replay reads file sequentially — append-only + lock-ordered writes mean the file IS the merge order.

    *macOS vs Linux semantics — explicit disposition* (per audit Pass 2, HIGH → resolved). The two platforms have non-identical advisory-locking semantics, and the project runs on both (dev machine is macOS M5 Max per `user_machine`; published packages must work on Linux too). Key differences:
    * **Linux `F_OFD_SETLK`** is per-open-file-description (not per-process), so two opens of the same file in the same process get distinct locks. Inheritable across `fork()` correctly. The semantics we want.
    * **macOS** lacks `F_OFD_SETLK`. Falls back to either: (a) `F_SETLK` (per-process; two opens in one process share one lock — dropping one drops both), or (b) `flock()` (advisory file lock; per-open-fd; doesn't compose with `F_SETLK`; doesn't `EWOULDBLOCK` reliably under contention).
    * **What this means for the archivist:** on Linux, multi-fd patterns inside one process (cli holds one fd, daemon-via-IPC briefly holds another) are safe; on macOS, the same pattern collapses to one lock and the second open silently succeeds without acquiring exclusivity — a real correctness bug, not just performance.
    * **Disposition.** Single-fd-per-process invariant: each archivist instance owns exactly ONE open fd against `archivist-audit.jsonl` for its process lifetime. `acquireWriteLock(fd)` uses `F_OFD_SETLKW` on Linux and `flock(LOCK_EX)` on macOS. The cli process and the daemon process each hold their own fd; cross-process serialization is `flock`/`fcntl` advisory and works on both platforms. The single-fd-per-process rule is enforced by the archivist's audit-writer module (the `auditFd` singleton in §Performance hot-path code sketch) — no path opens a second fd. This sidesteps the macOS `F_SETLK` vs `F_OFD_SETLK` divergence.
    * **Gate.** `npm run test:unit` includes `test/archivist/single-fd-invariant.test.ts` which asserts the archivist module exposes only one fd per process. The test uses platform-conditional introspection — `lsof -p $$` on the macOS dev machine, `/proc/self/fd/` if running on Linux. No new CI/CD; both platforms exercise the same code path because the single-fd rule makes `F_OFD_SETLKW` on Linux and `flock(LOCK_EX)` on macOS functionally equivalent (both block on contention, both release on close, neither has the second-open-in-same-process trap). The project's dev machine is macOS (per `user_machine`); deployment targets include Linux, and the invariant means the same archivist code works correctly on both without per-platform branches.

    *Replay scope.* Whole-file. No per-process replay. The §Confirmation harness reads the file front-to-back, dispatches each entry to its handler by `originatingTool`, and asserts post-state equality on the merged substrate.

    ```ts
    // archivist/audit-writer.ts
    async function appendEntry(entry: AuditEntry): Promise<void> {
      const line = JSON.stringify(entry) + '\n';
      const fd = await fs.promises.open(AUDIT_LOG, 'a');
      try {
        await acquireWriteLock(fd);          // fcntl F_OFD_SETLKW
        await fd.write(line);
        await fd.sync();                      // fsync before unlock
      } finally {
        await releaseLock(fd);
        await fd.close();
      }
    }
    ```

    *Out of scope for this disposition.* Cross-process cache invalidation (#24).

    *Cross-process `MutationContext.child()` across the cli→daemon boundary — explicit revisit triggers* (per T2, 2026-05-14). Deferred today because no current call site crosses processes mid-intent; daemon writes originate in the daemon and cli writes originate in the cli — re-entrancy via `child()` stays inside a single process. The deferral is **trigger-bound, not unconditional**. Any one of the following re-opens the disposition:
    * **(R1)** A call site enqueues work onto the daemon mid-intent AND expects the daemon's write to be attested as a child of the cli's intent (e.g., a cli MCP tool calls `daemon.enqueue(...)` while holding an open `MutationContext`). The cli's intent currently closes before enqueue; if any future feature crosses processes inside a single open intent, the cli-side `auditId` must propagate via the RPC payload, and the daemon must accept a `parentAuditId` arg on its archivist entry point.
    * **(R2)** Inter-controller writes in §Re-entrancy (NightlyLearner, MemoryConsolidation, SkillLibrary, SyncCoordinator) move from the cli process into the daemon while a cli-initiated MCP tool still holds the root `MutationContext`. Phase 9 validates this for the single-process case; the trigger fires if Phase 9 finds a hot orchestrator that splits across processes.
    * **(R3)** The `hooks` surface (Phase 7) gains a hook that runs in the daemon (`HooksLearningDaemon` extensions) but writes attribute to a cli session. Today hooks run in-cli; if any hook handler relocates to the daemon, the cross-process audit tree becomes load-bearing.
    * **(R4)** Multi-host operation: the SyncCoordinator's QUIC pull (Phase 9 Scenario B) currently treats each host as an independent process boundary; if a future feature wants per-host writes attested as children of a coordinator's intent on a remote host, that's an explicit cross-process tree.

    *Watchdog mechanisms (defense-in-depth)* (label renamed from W1/W2 to WD1/WD2 per audit Pass 3, MEDIUM → resolved — W1/W2 reserved for the perf-workload labels at §Migration concerns, lines 174/246/511): **(WD1) Grep gate** runs `grep -RE 'MutationContext.*child\(.*\bRPC\b|enqueueWith.*auditId|parentAuditId\s*:' forks/<archivist-package>/src/` in `npm run release`'s preflight stage (`scripts/ruflo-publish.sh`). Any match blocks release unless the head commit carries an `ADR-0180-Halt: cross-process-mcc` trailer with a paired Addendum commit. The same grep also runs in `npm run test:unit` for fast feedback during phase work. **(WD2) Runtime warning:** `archivist/mutation-context.ts` emits a one-shot WARN-level log `"cross-process MutationContext.child() invocation — revisit ADR-0180 #15"` if any `child()` call site is detected as serializing the context (heuristic: presence of a `serialize()`/`toJSON()` invocation on a `MutationContext` instance). Operational visibility for cases the grep misses.

    The intent of (R1-R4) + (WD1) + (WD2) is not to block the deferral — it is to ensure deferral never silently lapses into "we forgot to revisit". WD1 is automated gating in the existing release pipeline; WD2 is runtime evidence; the Halt-trailer is the deliberate-escalation path.

16. **Schema evolution.** The `MutationContext` shape will change over time (e.g., adding fields, retiring `guardVerdicts` when guards stabilize). Replaying an audit entry written under MutationContext v1 against handlers expecting v2 will fail. Need either: (a) versioned audit entries with per-version replay paths; (b) a forward-compatibility rule that `MutationContext` fields are only ever added, never renamed/removed; (c) a separate migration step that rewrites old audit entries to the current shape. Decide before audit-replay test infrastructure is built.

    **Disposition (2026-05-13).** Hybrid of (b) and (c), biased toward (b). Replay is verification, not recovery (§Confirmation), which constrains the answer: the audit log is append-only evidence and must not be rewritten as a side effect of schema changes.

    *Rule.* Audit entries carry an explicit `contextVersion: number` field at the top level of the entry (not inside `MutationContext` — the wrapper records the version of the payload it contains). Current version is `1`. The `MutationContext` schema follows a **forward-compat-only rule within a major version**: fields may be added; existing fields may not be renamed, removed, or have their semantic meaning changed. New fields MUST have a documented default for entries that lack them. Pure-add changes do NOT bump `contextVersion`; the version bumps only when (b) is no longer sufficient (a rename, a retired field, a semantic change to an existing field).

    *Bumping the version.* A bump is a deliberate ADR amendment. The amendment ships with an upgrade function `upgradeAuditEntry(entry, fromVersion) -> entry` registered in `archivist/audit-migrations.ts`. Migration is **lazy at replay time**: the audit log on disk is never rewritten (option c rejected as the default — conflicts with append-only / `feedback-data-loss-zero-tolerance`). Replay reads `contextVersion`, threads the entry through the registered upgrade chain (`upgrade1to2 ∘ upgrade2to3 …`), then dispatches to the current handler.

    *Replay semantics for added fields.* If v2 adds a field (e.g., a derived `traceparent`) and a v1 audit entry is replayed, the upgrade function supplies the documented default (e.g., `traceparent: null`). The `timestamp` example in the original question doesn't arise — `timestamp` is required in v1 (§Audit chain) — but the analog applies: if v2 adds `replicaId`, v1 entries get `replicaId: 'unknown'` from `upgrade1to2`, and handlers MUST treat that sentinel as "pre-v2 entry" rather than as a real value. Handlers that cannot tolerate a missing-field sentinel declare a `minContextVersion` at registration; replaying a too-old entry against such a handler records `{ state: 'failed', reason: 'context_version_below_handler_minimum' }` in the verification report and continues — replay does not abort.

    *Removed-field migrations.* Retiring a field (e.g., `guardVerdicts` once guards stabilize) requires version bump + upgrade function that drops it. Handlers registered after the bump never see the retired field; pre-bump audit entries lose it on replay. The verification report flags this as "lossy upgrade" so operators confirm intent.

    *Confirmation hook.* The §Confirmation audit-replay test runs against the **upgraded** entry stream. A separate "no upgrade panics" gate verifies every recorded `contextVersion` in the live audit log has a registered upgrade path to current. `npm run release` preflight fails if a version is present in the audit log but missing from the migration registry.

17. **Ring-buffer backpressure.** The hot-path fast-path uses an in-memory ring buffer + batched fsync ≤100ms (§Performance). What happens if post-edit fires faster than fsync drains? Options: (a) drop oldest entries (data loss — violates `feedback-data-loss-zero-tolerance`); (b) block the writer (defeats the fast-path purpose); (c) spill to a separate disk file and reconcile asynchronously. Buffer size, drain policy, and backpressure rule must be specified before Phase 7 implements hot-path writers.

    **Disposition (2026-05-13).** §Performance and Follow-up #18 jointly retire the in-memory durability ring buffer in favor of **write-through to the audit fd + batched fsync ≤100ms**. The original "ring overflow" failure mode therefore cannot occur — disk IS the buffer. This follow-up's remaining question is the residual backpressure case: what if `write()` or the per-entry `fcntl` advisory lock (Follow-up #15) is slow because the disk or the file lock is contended? Reconciled answer:

    *Reconciled hot-path shape (canonical, supersedes the original ring-buffer framing).*

    * **In-flight queue:** a bounded **256-entry single-producer queue** sits between the hot-path caller and #18's write-through journal. Sized at ~64 KB (256 entries × ~256 B); fits L2. NOT a durability buffer — exists only to absorb the µs-scale jitter from the lock-acquisition path so the caller returns deterministically. Power-of-two so `idx & (CAP-1)` replaces modulo.
    * **Drain trigger:** **immediate microtask** — the queue is drained as soon as #18's `write()` releases the advisory lock. The 100ms cadence from §Performance is on `fsync`, not on `write`. Drain runs off the caller's stack so the producer never awaits I/O.
    * **Backpressure rule (queue at capacity, lock not yet released):** **(b), but at µs scale, not the original "blocking defeats the fast-path" timescale.** Lock window per #15 is microseconds (`fcntl` held only around `write()+fsync()`); a 256-entry cap means worst-case producer wait is bounded at ~256 × lock-hold-time ≈ low single-digit milliseconds at p99 — under the <2ms §Performance ceiling for p50 and acceptable for the rare contention burst. Option (a) drop oldest is rejected per `feedback-data-loss-zero-tolerance`. Option (c) spill-to-separate-file is rejected: the main audit log is already the "spill destination" under #18, so adding a second file resurrects the multi-process composition problem #15 just resolved.
    * **Burst envelope.** Worst-case observed post-edit burst: ~100 Edits/sec during a multi-file refactor. At write-through cost ~50µs/entry the queue never exceeds ~5 entries. 256-cap gives ~50× margin; backpressure is unreachable in practice.

    *Sketch (~20 lines TS):*

    ```ts
    const CAP = 256;
    class HotPathQueue {
      private buf = new Array<AuditEntry | undefined>(CAP);
      private head = 0; private tail = 0; private count = 0;
      private draining = false;

      // Producer (hot path). Returns synchronously; never drops.
      enqueue(entry: AuditEntry): void {
        while (this.count >= CAP) this.drainOne();         // bounded µs-scale block
        this.buf[this.head] = entry;
        this.head = (this.head + 1) & (CAP - 1);
        this.count++;
        if (!this.draining) queueMicrotask(() => this.drain());
      }

      private drainOne(): void {
        const e = this.buf[this.tail]!; this.buf[this.tail] = undefined;
        this.tail = (this.tail + 1) & (CAP - 1); this.count--;
        writeThroughEntry(e);                              // #18: lock + write, fsync deferred
      }

      private async drain(): Promise<void> {
        if (this.draining) return; this.draining = true;
        while (this.count > 0) this.drainOne();
        this.draining = false;
      }
    }
    ```

    *Why this is a real disposition rather than "Follow-up #18 ate this":* #18 specifies the write-through mechanism but leaves the producer's queueing shape unstated — it implies an unbounded pending-writes queue (every async `enqueue` accumulates a `Promise` chain). Under burst that leaks memory and reorders entries if microtasks interleave. The 256-entry bound + immediate-microtask drain + bounded-µs producer block is the explicit producer-side contract. Phase 7 implementers ship this queue alongside #18's `writeThroughEntry`; removing either reintroduces the failure mode the other was written to prevent.

18. **Hard-shutdown durability.** `process.on('beforeExit')` flushes the buffer on clean exit. SIGKILL, OOM kill, hung-process kill, and laptop-lid-close don't get a flush hook. Audit entries in the ring buffer at that moment are lost. Acceptable loss window? Documented MTBF target? Or stronger durability (write-through to journal on every entry, batching only the fsync)?

    **Disposition (2026-05-13, scope-clarified 2026-05-14).** Pick **write-through journal, batched fsync**. Loss target: **zero audit entries lost on process-level events (SIGKILL/OOM/lid-close-without-power-loss, normal-operation race conditions, application bugs).** Power loss, kernel panic, and hard hardware failure are **explicitly out of scope** per user (2026-05-14) and the clarified scope of `feedback-data-loss-zero-tolerance.md` — that rule covers normal-operation silent loss, not catastrophic hardware events. The cost of the design is one `write()` syscall per hot-path entry; fsync batches at ≤100ms intervals.

    *Mechanism.* The hot-path ring buffer (§Performance) becomes a **two-stage journal**: every entry `write()`s to the audit-log file immediately (no fsync); a background timer fsync's at most every 100ms. `write()` enters the kernel page cache synchronously, so a process-level crash (SIGKILL, OOM, normal Ctrl-C, beforeExit) does NOT lose entries — page cache survives the process. A kernel-level event (kernel panic, power loss, lid-close with uncached-write) loses up to ~100ms of hot-path entries. That window is the deliberate trade-off for hot-path latency.

    *Comparison with `pending-insights.jsonl` baseline.* The current `appendFileSync` is sync-per-entry: power-loss-safe but ~1-10ms latency. The archivist's batched fsync is faster (~10-100µs per `write()`) and weaker on power loss (≤100ms window). This is a deliberate divergence, not a regression — power loss is out of scope per the user; latency under the post-edit hook's <2ms budget is in scope.

    *Signals.* Hookable: `SIGTERM`, `SIGINT`, `SIGHUP`, `SIGUSR1/2`, `beforeExit`, `exit` — all trigger an immediate `fsyncSync()` of the open audit fd. NOT hookable: `SIGKILL`, OOM-kill, hard power-loss, kernel panic. The write-through design makes the *process-crash* unhookable set safe because entries are already in the page cache when the signal fires; only the in-flight `write()` itself can be lost (single entry, currently being serialized). The *hardware-level* unhookable set (power loss, kernel panic) loses the ≤100ms uncommitted-fsync window — out of scope.

    *Latency.* Hot-path budget §Performance specifies <2ms ceiling. `write()` without fsync is ~10-100µs on SSD — well under ceiling. fsync moves off the hot path entirely.

    *Backpressure (#17).* No ring buffer to overflow; backpressure becomes a `write()`-blocking concern, which is `O(µs)` and acceptable. #17's spill-to-disk option becomes unnecessary — disk IS the buffer.

    ```ts
    // archivist/hot-path-writer.ts
    let auditFd: FileHandle | null = null;
    let fsyncTimer: NodeJS.Timeout | null = null;
    let dirty = false;

    async function writeThroughEntry(entry: AuditEntry): Promise<void> {
      if (!auditFd) auditFd = await fs.promises.open(AUDIT_LOG, 'a');
      await acquireWriteLock(auditFd);
      try {
        await auditFd.write(JSON.stringify(entry) + '\n');
        dirty = true;
      } finally {
        await releaseLock(auditFd);
      }
      if (!fsyncTimer) {
        fsyncTimer = setTimeout(flushFsync, 100);
      }
    }

    function flushFsync(): void {
      if (!auditFd || !dirty) return;
      auditFd.sync().catch(/* logged, not thrown */);
      dirty = false;
      fsyncTimer = null;
    }

    for (const sig of ['SIGTERM','SIGINT','SIGHUP','SIGUSR1','SIGUSR2'] as const) {
      process.on(sig, () => { fsyncSyncIfOpen(); process.exit(0); });
    }
    process.on('beforeExit', flushFsync);
    ```

    *Confirmed loss windows.*
    * **Process-level crash (SIGKILL, OOM, normal exit):** at most one in-flight `write()` (~100µs) — the entry being serialized at the instant of kill. All earlier entries are in the page cache and survive. This window matches `pending-insights.jsonl` `appendFileSync` baseline at the per-entry level.
    * **Kernel/hardware-level crash (panic, power loss, lid-close without power):** up to ~100ms of hot-path entries (the uncommitted-fsync window). The baseline `appendFileSync` is sync-per-entry and would lose only the in-flight entry; the archivist loses more. **Deliberate divergence** — out of scope per user (2026-05-14, ADR-0180 audit). Power-loss durability is not a project goal; hot-path latency under <2ms is.

19. **Replay test harness — who, where, how often.** §Confirmation says "replay the audit log against a freshly-initialized substrate MUST yield ... addressable-key set-equality." But: who writes this test (per-handler? per-surface? top-level acceptance?)? Where does it live (`forks/<archivist-package>/test/`?)? How does it map onto the existing two-command gate surface (`npm run test:unit` for fast feedback vs `npm run release` for full pipeline) — given replay against 200+ call sites' worth of audit entries may be slow? Decide before §Confirmation is shippable as an acceptance gate.

    **Disposition (2026-05-13, revised 2026-05-14).** Three-tier harness mapped onto the existing two commands — `npm run test:unit` runs the fast tiers (T1 + T3); `npm run release` runs all three plus load scenarios. No new CI/CD framework, no nightly soak tier.

    *Tier 1 — per-surface integration replay (`forks/<archivist-package>/test/replay/<surface>.spec.ts`).* One spec per migrated MCP surface (`memory_*`, `hive-mind_*`, `agentdb_*`, the file-system JSON group, hooks, daemons). Each spec: (a) seeds substrate, (b) runs a representative mutation set through the surface, (c) snapshots the audit-log subset filtered by `originatingTool` matching the surface, (d) replays that subset against a fresh substrate, (e) asserts addressable-key set-equality (rows by PK, vectors by ID, graph edges by endpoint-pair). Per-handler unit tests use #20's `withTestContext` helper instead — they assert handler logic, not replay equivalence.

    *Tier 2 — top-level acceptance replay (`forks/<archivist-package>/test/replay/acceptance.spec.ts`).* Drives a representative cross-surface mutation suite (Phase 9 load scenarios A/B/C plus the §Confirmation suite), captures the full audit log, replays whole-file against a freshly-initialized substrate (matches §15 cross-process replay scope), asserts the cross-scenario invariant `audit-entry count = mutation count + bulk-entries`. This is the §Confirmation gate.

    *Tier 3 — fast-mode subset replay (`forks/<archivist-package>/test/replay/fast.spec.ts`).* Replays only the last 100 audit entries against a substrate snapshot, used for fast feedback during phase work. Trades full coverage for runtime: catches handler/replay regressions cheaply.

    *Cadences (mapped onto the existing two commands).*
    * **`npm run test:unit`**: Tier 1 (per-surface, diff-scoped via test-impact analysis) + Tier 3 (fast subset). Target: ≤ 90 seconds total — matches `reference-fast-test-runner` budget. No archivist diff means Tier 3 only. Fast loop during phase work.
    * **`npm run release` — preflight stage**: Tier 1 (all surfaces). Failures block release before publish.
    * **`npm run release` — acceptance stage** (`scripts/test-acceptance.sh`): Tier 2 (full top-level) + load scenarios A/B/C from §12. Hard gate before tag creation — `safeNextVersion` refuses to advance the version if replay fails. Matches existing acceptance-gates-in-release pattern.

    *Success definition.* For every replay: (1) audit-entry count equals mutation count (or bulk-manifest equivalents); (2) addressable-key set-equality on rows-by-PK, vectors-by-ID, graph-edges-by-endpoint-pair; (3) cross-process invariant holds (audit log is the merge order per §15). Excluded from equality (per §Confirmation): read-order, HNSW graph topology, and timing-derived fields (`Date.now`-at-replay, `lastInsertRowid` resolved at replay vs original). Wall-clock equality is excluded; the original-time `timestamp` field (required in `MutationContext` per #3) is the equality anchor for time-derived state. Failures produce a diff manifest (live vs replayed addressable-key sets) attached to test output for triage.

    *Out of scope.* Per-handler replay-equivalence assertions (handlers tested via #20's `withTestContext`); cross-process MutationContext.child() replay across cli→daemon boundary (deferred per §15 — trigger-bound; re-opens when R1-R4 fire; WD1 + WD2 watchdogs prevent silent lapse); HNSW-topology equivalence (excluded by §Confirmation).

20. **Mock-context factory for unit tests.** Branded `MutationContext` and `SubstrateAccess` types deliberately have no public constructor — that's the type-enforcement claim. But writing a unit test for a `GuardedWrite<T>` handler requires constructing a `MutationContext`. Solution patterns: (a) a `test-only` package entrypoint exposing an unbranded constructor (compromises the claim slightly); (b) the archivist itself ships a `withTestContext()` helper that's no-op-audited and only callable from test files (file-naming-restricted via tsconfig, similar to the admin escape hatch); (c) handlers are tested through their MCP/CLI entry points, not in isolation. Pick (b) probably; specify before Phase 2.

    **Disposition (2026-05-13).** Option **(b)** — `withTestContext()` helper, file-naming-restricted via a second tsconfig project reference, extending the §Escape hatch precedent. (a) compromises the claim across the entire dependency graph; (c) makes handler unit testing impossibly coarse-grained for ~110 MCP tools.

    *Mechanism.* A `tsconfig.test.json` project reference allowlists `**/*.test.ts` and `**/*.spec.ts` files, adding `@pkg/archivist/testing` to module resolution. That entrypoint is unresolvable under the main `tsconfig.json` — production code cannot import it. ESLint adds `no-restricted-imports` for `@pkg/archivist/testing` outside test files as a defense-in-depth backstop against tsconfig misconfiguration.

    *Surface (extended per F1 design).* `@pkg/archivist/testing` exports:

    ```ts
    withTestContext<T>(handler: GuardedWrite<T>, payload: T, opts?: WithTestContextOpts): Promise<TestResult<T>>
    withTestReadContext<T, R>(handler: GuardedRead<T, R>, payload: T, opts?): Promise<ReadTestResult<T, R>>
    makeFsJsonSubstrateFixture(opts: { files, lockHoldMs? }): SubstrateAccess & { lockWaits, files }
    ```

    `WithTestContextOpts` supports `{ hotPath?: boolean; substrate?: SubstrateAccess; guards?: 'permissive' | 'production' | GuardVerdict[] }`. The default substrate is an in-memory `Map<string, unknown>` keyed by store name; pass `substrate: makeFsJsonSubstrateFixture(...)` for FS-JSON consumers (Phase 4-5). Audit defaults to in-memory capture; `MutationGuard` defaults permissive.

    *TestResult exposes four views over the same captured intent* (each addresses one of the Phase-4 blocker gaps Q6 surfaced):

    - **`audit: AuditEntry[]`** — flat, chronological; back-compat with simple handler tests.
    - **`auditTree: AuditNode`** — root node with `children[]` matching `ctx.child(reason)` order. Required by Phase 9 Scenarios A and C (re-entrancy tree-shape assertions). Same entries as `audit`, two views.
    - **`bulkManifests: { intent, count, checksum, tableList }[]`** — one per `ctx.substrate.withBulkWrite` call. The single emitted audit entry carries `manifestRef: number` indexing into this array. Required by Scenario B (`SyncCoordinator` 1000-row pull → exactly 1 manifest entry, not 1000) and Phase 6 `agentdb migrate`.
    - **`hotPath?: { guardsInvoked: false, ringBuffer, postWriteTriggers }`** — present iff `opts.hotPath: true`. Guards bypassed; audit routes to `ringBuffer` (NOT `audit`); post-write triggers wrapped in `setImmediate` and recorded with `ranAt` timestamps. `ctx.child` typed `never` (matches §Performance contract #4). Payloads >4KB divert to cold path with `divertedFromHotPath: true` marker. Required by Phase 7 hot-path handler tests.

    *In-memory substrate.* The fake `SubstrateAccess` implements `insert | update | delete | query | vectorSearch | withWrite | withBulkWrite` over a per-test `Map`. `vectorSearch` returns insertion-order identity (score `1.0`) — handler logic only; ranking is integration-tested. Re-entrancy: `ctx.child(reason)` returns a child whose entries attach to the parent `AuditNode`. Bulk: `withBulkWrite(intent, fn)` computes manifest from rows touched within `fn`.

    *FS-JSON fixture.* `makeFsJsonSubstrateFixture` models lock contention and multi-file shape (`hive-state.json` + `agents.json` co-resident — the Phase 4 "agents.json as second consumer" validation case from §Migration concerns). Per-filename async mutex; `lockHoldMs` (constant or generator) simulates contention; `lockWaits: { file, waitedMs, acquiredAt }[]` records every contention event. Required by Phase 5 (~17 FS-JSON stores) and Phase 4's substrate-genericity validation.

    *Phase 5 contention-threshold gate* (per audit 2026-05-14, MEDIUM → resolved). The 17 FS-JSON stores share one `makeFsJsonSubstrate` primitive; without a contention gate, regressions in lock-handling slip through silently. Phase 5 acceptance test `test/replay/fs-json-contention.spec.ts` (runs in `npm run release` acceptance stage): drive the standard Phase 5 mutation suite against `makeFsJsonSubstrateFixture` with `lockHoldMs: () => 5 + Math.random() * 15` (5-20ms contention simulation), assert `result.lockWaits.length <= 1.5 * mutationCount` (each mutation waits at most ~1.5 lock acquisitions on average — empirical baseline measured during Phase 5 implementation, committed to `bench/baseline.json`) AND `max(result.lockWaits.map(w => w.waitedMs)) <= 200` (no single mutation blocks >200ms). Threshold failure indicates either lock fairness regression or fixture-vs-production divergence; either way, Phase 5 release blocks until the gap is identified.

    *Cross-mode constraints* (compile-time enforced):

    - `bulk × hotPath`: forbidden — `withBulkWrite` typed `never` on hot-path substrate.
    - `child × hotPath`: forbidden — `ctx.child` typed `never` on hot-path context (matches §Performance contract #4).
    - `bulk × re-entrancy`: legal — `withBulkWrite` inside a child context attaches its manifest entry to the child's `AuditNode`. Future-proofing; no current call site exercises it.

    *Sketch (~15 lines).*

    ```ts
    // memoryStore.test.ts
    import { withTestContext } from '@pkg/archivist/testing';
    import { storeMemory } from './memoryStore'; // GuardedWrite<MemoryPayload>

    test('storeMemory writes one audit entry with normalized payload', async () => {
      const result = await withTestContext(storeMemory, {
        namespace: 'session',
        content: '  hello  ',          // expect trim normalization
        tags: ['a', 'b'],
      });

      expect(result.audit).toHaveLength(1);
      expect(result.audit[0]).toMatchObject({
        tool: 'memory_store',
        state: 'applied',
        payload: { content: 'hello', tags: ['a', 'b'] },
      });
      expect(result.substrate.get('memory_entries')).toHaveProperty(result.audit[0].id);
    });
    ```

    *Constraint.* The `withTestContext` helper lives in `archivist/testing/**`, path-restricted from production via tsconfig — production code cannot import it. It is NOT exempt from the type-enforcement audit: the helper must use the same branded-type machinery the production runtime does, so a refactor that breaks branding breaks the helper. This keeps the test infrastructure honest: if the type claim weakens, tests fail to compile alongside production code.

21. **Observability beyond OTEL.** OTEL covers spans + traces + metrics for an observability backend, but operators looking at "how's the archivist doing right now" need something local. Options: (a) `ruflo archivist status` CLI command (audit-chain depth, fast-path buffer occupancy, recent errors); (b) live audit-chain tail (`ruflo archivist tail`); (c) HTTP metrics endpoint on the daemon (`localhost:<port>/metrics`); (d) all of the above. The hive-mind already has `ruflo hive-mind status` as a precedent for operator-facing introspection.

    **Disposition (2026-05-13).** Ship **(a) + (b)**; reject (c) in favor of reusing the existing daemon Unix-domain-socket IPC. Rationale: `daemon-ipc.ts` already exposes `.claude-flow/daemon.sock` (constant `DAEMON_SOCKET_FILENAME = 'daemon.sock'`) — opening a new HTTP listener on localhost just for metrics adds a second network surface, port-collision risk, and authn questions where the existing socket already enforces filesystem permissions. CLI commands talk to the daemon via the socket when the daemon is running and read the audit log directly when it isn't. OTEL handles remote/aggregated views; local operator introspection stays CLI-only.

    **Surfaces.**
    * **`ruflo archivist status [--json] [--verbose]`** — one-shot snapshot, human-readable by default, mirroring the `hive-mind_status` precedent (`hive-mind-tools.ts:1599-1746`). `--json` for scripting; `--verbose` adds per-handler init state and last 10 audit entries.
    * **`ruflo archivist tail [--filter <regex>] [--since <iso8601>] [--follow] [-n <count>]`** — line-delimited JSON stream of audit entries. Reads from the **committed** log only, never the ring buffer pre-flush — surfacing entries that may be lost on crash would mislead operators (see follow-up #18's durability target). `--follow` keeps the stream open like `tail -f`; without it, prints recent `-n` entries (default 50) then exits.

    **Exposed fields (status payload).**
    * `archivist.version`, `archivist.uptimeMs`, `archivist.process` (`cli` | `daemon`).
    * `auditChain.depth` (total committed entries), `auditChain.lastEntryAt` (ISO8601), `auditChain.lastReplayAt`, `auditChain.lastReplayResult` (`pass` | `fail` | `null`).
    * `fastPath.bufferOccupancy` (entries written, fsync pending), `fastPath.lastFsyncAt`, `fastPath.batchedFlushesLast60s`, `fastPath.medianLatencyMs`, `fastPath.p99LatencyMs`. (Feeds follow-up #13 budget verification.)
    * `errors.recent` — last 10 `{ at, tool, kind, message }` where `kind` ∈ `guard_rejected | substrate_error | partial_failure | quota_exhausted` (follow-up #22).
    * `writeRates.perStore` — `{ storeId: { writesLast60s, writesLastHour, bytesLastHour } }` for each registered store.
    * `init.perTool` — `{ toolName: { initialized: boolean, initializedAt?: ISO8601, lastError?: string } }` covering all registered handlers. Surfaces lazy-per-tool init progress (Architecture §Init).
    * `phase` — current migration phase per §Migration concerns (`2..10`), so operators see which surfaces have crossed the archivist boundary.

    **Output sketch (status, human-readable):**

    ```
    Archivist v0.1.0  (process: daemon, uptime 4h12m)
    Audit chain: 18,432 entries; last write 2026-05-13T15:42:11Z
    Last replay: 2026-05-13T03:00:00Z PASS
    Fast-path:  buffer 12 pending; flushed 156x last 60s; p50 0.8ms p99 1.7ms
    Errors:     3 last hour (1 guard_rejected, 2 partial_failure)
    Stores:     memory_store (412/min), agentdb_insert (89/min), hive_state (12/min)
    Init:       14/18 tools initialized; pending: agentdb_attention, neural_train, ruvllm_chat
    Phase:      4 (hive-mind_* migrated; file-system JSON group in progress)
    ```

    **Output sketch (tail, one JSON object per line):**

    ```json
    {"at":"2026-05-13T15:42:11.832Z","auditId":"a-9f8e","tool":"memory_store","store":"rvf","state":"applied","durationMs":1.4,"parentAuditId":null,"bytes":342}
    ```

    **CLI command names.** `ruflo archivist status` and `ruflo archivist tail`. Both are read-only — neither mutates substrate, neither requires the archivist to be writable. They share the daemon socket protocol when the daemon is up and fall back to direct audit-log reads when it isn't, the same approach `ruflo daemon status` uses today.

22. **Quota / capacity exhaustion semantics.** If substrate is full (disk full, SQLite max page count, RVF segment limit), what does a guarded write return to the handler / caller? Error type? Hint to backoff or shed load? The audit entry — does it record the attempt with `state: failed { reason: 'quota_exhausted' }`, or is the entry never opened? Affects MCP client error contracts.

    **Disposition (2026-05-13).** Single error type, audit entry opened-and-failed, structured backoff hint.

    *Error type.* `QuotaExhaustedError extends ArchivistError extends Error` in `forks/agentdb/src/errors/`, alongside `RvfNotInitializedError`. Shape: `{ substrate: 'sqlite' | 'rvf' | 'fs-json', reason: 'disk_full' | 'sqlite_max_page' | 'rvf_segment_limit' | 'fs_quota', hint: BackoffHint, attemptedAuditId: string }`. The three substrate-level signals (ENOSPC from `fs`/SQLite SQLITE_FULL, RVF segment-cap from the writer, EDQUOT from filesystem quotas) all map to this one type. Fail-loud per ADR-0112 and `feedback-data-loss-zero-tolerance` — never silently converted to success-with-fallback.

    *Audit entry — opened with `state: 'failed'`.* The entry IS opened before the substrate write (§Audit chain). On `QuotaExhaustedError` the handler completes it with `state: 'failed', reason: 'quota_exhausted', substrate, hint`. The chain records the *attempt*, not just successes. "Never opened" is rejected: a write call that vanishes from the audit chain is undetectable from replay and breaks the §Confirmation invariant "audit-entry count equals mutation-call count". The replay test harness (#19) treats failed entries as no-ops on substrate but asserts the entry exists.

    *Backoff hint protocol.* `BackoffHint = { retryAfterMs?: number; sheddable: boolean; suggestion: 'evict' | 'compact' | 'rotate' | 'fail' }`. Hot-path writers (`post-edit`, `pre-task`) check `sheddable: true` and skip retry to preserve hot-path budget (§Performance, #13). Non-hot callers MAY retry once after `retryAfterMs` (default 1000ms for `sqlite_max_page` / `rvf_segment_limit`; never set for `disk_full` — operator action required). `suggestion: 'evict'` is informational for the operator surface (#21) — the archivist does NOT auto-evict to satisfy a quota (eviction is policy, archivist is plumbing).

    *MCP client error shape.* `{ isError: true, content: [{ type: 'text', text: 'Substrate <X> exhausted: <reason>. Retry after <Ms>ms.' }], _meta: { errorCode: 'QUOTA_EXHAUSTED', substrate, reason, retryAfterMs, sheddable } }`. The `_meta` channel carries the structured hint for tool clients that act on it; the `text` channel carries operator-readable diagnosis. Existing MCP callers already handle `isError: true` — no migration cost.

    ```ts
    // archivist/errors.ts
    export class QuotaExhaustedError extends ArchivistError {
      constructor(
        public readonly substrate: 'sqlite' | 'rvf' | 'fs-json',
        public readonly reason: QuotaReason,
        public readonly hint: BackoffHint,
        public readonly attemptedAuditId: string,
      ) {
        super(`Substrate ${substrate} exhausted: ${reason}`);
      }
    }
    ```

    *Out of scope.* Quota *prediction* (pre-write capacity probe) — every substrate's "is there room" check is racy and substrate-specific; defer to a future quota-aware guard verdict (#6).

23. **Plugin-defined store registration.** Third-party plugins may add controllers (the marketplace pattern). How do plugin-defined stores register handlers with the archivist? Public extension API (`archivist.registerStore(name, handlers)`)? Or only first-party stores can register, with plugins limited to read tools? Affects the public surface area of the archivist module.

    **Disposition (2026-05-13).** Pick **(b) first-party-only handler registration; plugins persist via MCP-as-a-client or their own out-of-archivist storage**. No public `archivist.registerStore()` extension API.

    *Reasoning.* The type-enforcement claim (§Type enforcement) is "no store-tree code can obtain a substrate handle except through `MutationContext`". A public `registerStore(name, handlers)` would have to deliver `MutationContext.substrate` to plugin-supplied handlers — extending the trust boundary to arbitrary third-party code that ruflo neither vendors nor reviews. The ratified marketplace pattern ([[project-adr0117-rebrand]], ADR-0117) is documentation-and-manifest-only: skills, agents, commands, MCP-server registration via `plugin.json`. Plugins do NOT load and execute fork-internal TypeScript. Cracking the substrate-handle boundary just to enable runtime store registration trades the architectural property the ADR exists to enforce.

    *What plugins CAN do.*
    1. Register their own MCP servers via `.claude-plugin/plugin.json` (ADR-0117). Plugin tools run in the plugin's own process and MAY call back into ruflo's MCP server as a normal MCP client — those calls route through the archivist with `originatingTool` = the plugin tool name.
    2. Read from any archivist-managed namespace via the public `memory_*` / `agentdb_*` MCP surface.
    3. Persist plugin-private state in their own files / databases outside the archivist. The archivist enforces "all writes go through me" across the *fork's in-process call sites*, not across separate processes.

    *What plugins CANNOT do.*
    1. Register a typed `GuardedWrite<T>` handler at the archivist's mutation-dispatch boundary.
    2. Define a new MCP tool *on the ruflo MCP server* that performs a guarded write — those tools are first-party only, shipped in `forks/agentdb/src/mcp/`.
    3. Receive a `SubstrateAccess` handle by any means.

    *Sketch — how a plugin persists today.*

    ```ts
    // example-plugin/.claude-plugin/plugin.json registers:
    //   mcpServers.example-plugin = {
    //     command: 'npx',
    //     args: ['-y', '@vendor/example-plugin', 'mcp', 'start']
    //   }
    // The plugin's MCP server, when it needs ruflo memory, calls back as a client:

    import { MCPClient } from '@modelcontextprotocol/sdk/client';

    const ruflo = new MCPClient({ name: 'example-plugin', version: '0.1.0' });
    await ruflo.connect('stdio', {
      command: 'npx',
      args: ['-y', '@sparkleideas/ruflo', 'mcp', 'start'],
    });

    export async function recordExampleEvent(event: ExampleEvent) {
      await ruflo.callTool('memory_store', {                    // routes through archivist
        key: `example-plugin/${event.id}`,
        value: JSON.stringify(event),
        namespace: 'example-plugin',
      });
    }
    ```

    *Revisit trigger.* If a future plugin needs persistence the `memory_*` / `agentdb_*` MCP surface cannot serve (e.g., a new substrate kind beyond RVF/SQLite/fs-JSON), open a separate ADR to extend the first-party substrate set rather than open a runtime registration API. Default answer to "can I add a new substrate kind": no. Default answer to "can I write through an existing one": yes, via MCP.

24. **Read-side cache invalidation across the substrate primitive.** The `withHiveStoreLock` precedent is write-focused (lock + WAL + tmp+fsync+rename + cache-after-success). When the archivist generalizes this as the substrate primitive (#10), the read-side cache invalidation rule must generalize too — e.g., a `memory_search` cached result should be invalidated by a `memory_store` mutation to the same namespace. Specify the invalidation contract before TieredCache integrates with the archivist boundary.

    *Disposition.* TieredCache is a **single process-wide cache owned by the archivist**, not per-store. Per-store caches would force fan-out invalidation through every store on every mutation (the upstream failure mode). One cache keyed by `(storeId, namespace, queryFingerprint)` lets the archivist scope invalidation to the smallest correct slice without store cooperation.

    * **Cache key shape.** `{ storeId: StoreId; namespace: Namespace; queryFingerprint: string }` where `queryFingerprint` is a stable hash (xxhash64) of the canonicalized read intent — text + filters + limit + ranking knobs. `storeId` discriminates stores that share namespace strings (e.g., `memory_*` and `agentdb_*` may both use `"hive-default"`). `Namespace` is a branded string matching the store's mutation namespace (the same one declared on `MutationIntent.namespace`); a store with no namespace concept uses the literal `Namespace.GLOBAL`.
    * **Invalidation triggers.** Every `applied` write (and every `partial` write — partial is still a substrate mutation) emits one invalidation event keyed by `{ storeId, namespace }`. `intent` and `failed` audit states do NOT invalidate (no substrate effect). The archivist's post-write hook fires the event AFTER `state` transitions to `applied|partial`, BEFORE post-write triggers (SkillLibrary auto-promotion, etc.) so cascaded reads inside the same intent see a clean cache. `bulk()` mutations emit ONE coarse event per `(storeId, namespace)` touched by the manifest, not N row-events. Stores declare `cacheScope: 'namespace' | 'store' | 'global'` on `registerMutationHandler` — default `namespace`; `store` widens to all namespaces in the store (counter-style writes that affect rankings cross-namespace); `global` is the escape hatch (schema migrations).
    * **TTL policy.** Soft 5-min TTL as a safety net for residual cases mutation-driven invalidation doesn't cover (clock skew under multi-process audit composition per #15, unguarded reads from the admin escape hatch). TTL is NOT the primary correctness mechanism — invalidation events are. Hot-path `agentdb_route` reads opt out of caching entirely (no entry written) since route latency budgets are tighter than cache-lookup overhead.
    * **API sketch.**

        ```ts
        // archivist/cache/tiered-cache.ts
        type StoreId = Brand<string, 'StoreId'>;
        type Namespace = Brand<string, 'Namespace'>;
        type CacheKey = { storeId: StoreId; namespace: Namespace; queryFingerprint: string };

        interface TieredCache {
          get<R>(key: CacheKey): R | undefined;
          set<R>(key: CacheKey, value: R, ttlMs?: number): void;
          invalidate(scope: { storeId: StoreId; namespace: Namespace | '*' }): void;
          // Called by the archivist's post-write hook only — not exposed to handlers.
          onMutation(audit: AuditEntry & { state: 'applied' | 'partial' }): void;
        }
        ```

        Stores never call `invalidate` directly — the archivist's post-write hook is the only invalidation source. Read handlers receive a `ReadContext.cache: ReadOnlyCache` projection (get-only) so they can short-circuit before substrate touch but cannot mutate cache state.
    * **Re-entrancy.** `MutationContext.child(reason)` invalidates at the child's `applied|partial` transition just like a top-level intent — children invalidate independently. Reads in the parent intent's continuation see the child's invalidations because invalidation is synchronous within the archivist's per-intent serial orchestration (§Re-entrancy: no concurrent siblings; child completes before parent's next step). This matches `feedback-data-loss-zero-tolerance`: a cached result returned to a caller after a known-invalidating mutation in the same logical operation is a correctness bug, not just staleness.
    * **Out of scope.** Cross-process invalidation (cli + daemon both holding caches) — daemon's archivist instance carries its own TieredCache; the cli's cache is not invalidated by a daemon write. Documented as a known limitation paired with #15; revisit if a multi-process workload shows stale-read symptoms. The 5-min TTL bounds the staleness window for now.

25. **Reference-impl differential testing (deferred).** Mutation invariants (per the second-correctness-gate §Architecture bullet) catch handler regression and contract drift but do NOT catch bugs present in the handler at registration time — both live and replayed runs produce identically-wrong outputs. The fully non-tautological defense is to ship a *reference implementation* of each high-risk handler in `archivist/reference-impls/<surface>/<handler>.ts` (path-restricted to `test/**` consumers; not in the package's `exports`), against which the production handler's outputs are differential-tested at the §Confirmation gate.

    *Why deferred (not part of Phase 2-10).* Doubles per-handler implementation cost; only worth it for the highest-risk surfaces where invariants are demonstrably insufficient. The candidate set: `agentdb_filtered_search` (BM25+semantic fusion — most complex read-path logic per ADR-0179), `SkillLibrary.consolidateEpisodesIntoSkills` (running-average updates that can't be cleanly inverted, per §Transactions), and `NightlyLearner.run()` (re-entrant cascade per Phase 9 Scenario A). Implementing reference impls for the remaining ~110 handlers is over-engineering.

    *Trigger to revisit.* (a) An invariant-passing handler regression slips to production and corrupts substrate state in a way replay didn't catch — invariants demonstrably insufficient at that surface, escalate to reference impl. (b) Phase 9 load tests reveal divergence between expected and observed mutation patterns for one of the three candidate surfaces. (c) ADR-0179 Phase 3's restoration work (which depends on ADR-0180) surfaces correctness bugs in the six lost features post-restoration — reference impls become the validation surface.

    *Open today.* Pick whether to ship reference impls for the three candidate surfaces in Phase 6 (agentdb_*) and Phase 9 (inter-controller orchestrators), or defer all three until a trigger fires. Default: defer. The mutation-invariants gate is the primary second gate; reference impls are escalation, not baseline.

26. **`dispatch()` is `unknown`-typed at the call site.** `Archivist.dispatch(toolName: string, payload: unknown): Promise<unknown>` carries no compile-time check on the *caller* — `toolName` is a bare `string` (a typo resolves to a runtime "no handler registered" throw, not a `tsc` error), `payload` is `unknown` (a mismatched payload reaches the handler via an unchecked `as MutationHandlerFn<unknown>` cast), and the result is `unknown`. This is deliberate-by-omission: ADR-0180's type-enforcement claim constrains the *handler* (branded `GuardedWrite<T>`, no context minting, path-restricted `SubstrateAccess`) — it never extended to the dispatch entry point. The branded `GuardedWrite<T>` *is* a callable function type, but it is not a usable typed call surface for consumers because `createMutationContext` is not re-exported, so the only reachable call path is the `unknown`-typed `dispatch()`. The fix is a `ToolPayloadMap` interface keying every registered tool name to its payload type plus generic overloads (`dispatch<K extends keyof ToolPayloadMap>(tool: K, payload: ToolPayloadMap[K])`, and the read equivalent). Low-value while nothing dispatches; load-bearing the moment call sites are wired — so it is scoped as a hard prerequisite of [ADR-0181](ADR-0181-archivist-runtime-activation.md) Phase 5 (F4-3 cli delegation), where ~110 call sites with literal tool names are created in one phase.
