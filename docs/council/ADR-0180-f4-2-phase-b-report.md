# ADR-0180 F4-2 Phase B — Handler-Body Activation (and a Scope Correction)

**Phase:** F4-2 Phase B (un-stub handler bodies now that Phase A made the substrate seam live)
**Status:** Delivered as a *trimmed* slice. The brief's "14 TODO(F4-2) files" roster was a stale curated list — see the Scope Discovery section. The genuinely-doable handlers got real bodies; the design-blocked ones carry documented narrow gaps. **F4-2 is not a wrap-up phase** — it is the front of a substrate-infrastructure-dependent program.
**Date:** 2026-05-14
**Coordinator:** queen-sparc (SPARC orchestrator; coordination + review only — no source code authored)
**Workers:** 4, single-attempt each, dispatched in one wave by team-lead. One worker (`agentdb-handler-unstub`) took one queen-issued correction mid-flight.

## TL;DR

- The Phase B brief named **14 `TODO(F4-2)` handler files**. On-disk, `grep -rl "TODO(F4-2)"` returns **6**, and the broader stub landscape is **88 of 118 handler files** throwing `pending` sentinels. The 14 was a curated slice built from a stale Phase A report.
- Of the 14: **1 was already done** (`agents/pool.ts`), **3 already had real bodies** (`hooks/{post-edit,pre-task,session-end}` — though un-finished), **4 were design-blocked** by Phase A's own deferral (`agentdb/{filtered-search,pattern-search,reflexion-retrieve,skill-search}` need read-optimized substrates / controller registry / wired backends that F4-2 does not thread), and the rest were genuinely un-stubbable now.
- Phase B **delivered real, runnable bodies** for the handlers the current substrate API supports, and **documented narrow `TODO(F4-2-config)` gaps** for the ones blocked on F4-3 config-wiring. **No speculative substrate infrastructure was built** (team-lead ruling: that scoping decision belongs to the user, not a swarm dispatch).
- `archivist-tsconfig-wirer` found its task was **already done by design** — the tsconfig is a deliberate standalone `--noEmit` gate, 0 errors, correctly *not* a project reference.
- **Structural acceptance: `tsc --noEmit` for `src/archivist/**` = 0 errors; charter check exit 0 (166 files).** The 21 remaining fork-wide tsc errors are entirely the pre-existing `LearningSystem.ts` / `AgentDB.ts` unmerged-conflict files Phase A already flagged — outside `src/archivist/**`, not touched by Phase B.

## Scope Discovery — the brief's roster was stale

The Phase B brief inherited two stale inputs from the Phase A report:

### 1. The "14 TODO(F4-2) files" roster does not match disk

`grep -rl "TODO(F4-2)"` over `src/archivist/handlers/` returns **6** files, not 14. The brief's other 8 carried different markers (`TODO(ADR-0180 Phase 6 wire-up...)`, `TODO(ADR-0180 F4-2 wire-up)`, `TODO(ADR-0180 Phase 5...)`). More importantly, the **real stub landscape is 88 of 118 handler files** throwing a `pending` sentinel — the "14" was a curated slice, not the actual F4-2 surface.

### 2. Three "stub" files were already done or already had bodies

- **`agents/pool.ts`** — already had a **complete real body**: reads the `agent_spawn` store, applies scale/drain transforms, writes back. The only throws are legitimate guards (`fill` unimplemented; `status` is read-only). Not a stub. (The Phase B worker only polished a stale comment.)
- **`hooks/{post-edit,pre-task,session-end}`** — already called `ctx.substrate.withWrite` + `handle.write` with real FS-JSON operations. They did not throw. Their `TODO(F4-2)` markers were *narrow refinement notes*, not throw-stubs. The hot-path queue routing the brief described for post-edit/pre-task was already wired by Phase A's `makeAuditSink(hotPath)` — not handler-body work.

### 3. Four `agentdb/*` handlers are design-blocked by Phase A's own deferral

`agentdb/{filtered-search,pattern-search,reflexion-retrieve,skill-search}` are ranked **reads**. Phase A's `routingReadOnlySubstrate()` **throws a documented Phase-B error** on `query` / `vectorSearch` — read-optimized substrate siblings are **Phase A's deferred scope item #4**, which the Phase B-handlers brief did not include. Layered on top: the substrate-registry classification (`substrate-registry.ts` `classifyStore`) routes `agentdb_pattern_search` to the **SQLite carve-out** and `agentdb_route` to **RVF** — and `ArchivistInitConfig` threads neither a `sqliteDb` read-handle, an `rvfBackend`, nor a controller registry in F4-2 (that is F4-3 call-site wiring). A handler cannot have a real, runnable body when every input it needs is behind an unfinished config seam.

### 4. The `archivist-tsconfig-wirer` task was already resolved by design

Phase A's report claimed `tsconfig.archivist.json` produced "10 TS6059/TS6307 errors." On-disk, `npx tsc -p src/archivist/tsconfig.archivist.json --noEmit` produces **0 errors**. The file had been rewritten: its header documents that it is a **deliberate standalone `--noEmit` path-restriction gate**, with `rootDir: ".."` to cover the `../backends/` substrate-factory imports, and is **intentionally not a `references` project** (`composite` would re-raise TS6307 for the backend files). The brief's "wire it into `tsconfig.json` references" task would have *contradicted the file's own design*. The only residual — keep `substrate-internal.ts` off the published `exports` — was already satisfied (it is not in the `exports` map; Node subpath exports are deny-by-default).

### Coordination note — workers crossed the scope escalation

The team-lead dispatched queen + all 4 workers in one wave (same crossed-messages pattern as Phases 5/6/10). The queen's scope-contradiction escalation to team-lead and the workers' execution crossed — the workers were already running against the brief's roster. Rather than re-dispatch, the queen reviewed worker output as it landed and sent targeted, line-anchored guidance: a substrate-registry-classification heads-up to `agentdb-handler-unstub` before it touched `route.ts` / `pattern-search.ts`, and one fail-loud correction (below). Net effect: the workers' output converged on the trimmed-(B) shape the team-lead's ruling later confirmed.

## Worker deliverables (verified on disk by the queen)

### `daemon-handler-unstub` (backend-dev) — 5 daemon handlers, all real bodies

All five adopt the `performance/benchmark.ts` precedent consistently: **the caller runs the work; the handler owns persistence; the composed result/summary arrives in the payload.** Process probes / controller invocations / in-process objects stay caller-side (they are not substrate concerns).

| File | Body | Narrow gap |
|---|---|---|
| `daemons/optimize.ts` | Real — `withWrite` → `handle.write` of the `OptimizeWorkerPayload` snapshot to `metrics/performance.json` | none |
| `daemons/benchmark.ts` | Real — same shape, `metrics/benchmark.json` | none |
| `daemons/consolidate.ts` | Real for the **one** file it has a registry route for (`metrics/consolidation.json`) | `TODO(F4-2-config)` — OF#11's other 3 sibling artifacts (`graph-state.json`, `ranked-context.json`, `intelligence-snapshot.json`) have no `FS_JSON_PATH_OVERRIDES` storeId; wiring them is `initialize(config)`-adjacent registry work |
| `daemons/auto-memory-bridge.ts` | Real — uses `withBulkWrite` (correct: genuine multi-target intent) to persist the backend-sync record | `TODO(F4-2-config)` — the topic-markdown + `MEMORY.md` targets need a *markdown-capable* substrate primitive; the FS-JSON substrate is JSON-only (`saveJsonAtomic` does `JSON.stringify`) |
| `daemons/hooks-learning.ts` | Real — `withWrite` → `handle.write` of the `HooksLearningResult` to `data/hooks-learning.json`; correctly preserves the fail-loud-at-daemon-startup discipline (does not re-check `enableLearning` in the handler) | `TODO(F4-2-config)` — the `reasoningBank.consolidate()` invocation needs the in-process `reasoningBank` object the daemon owns; `ArchivistInitConfig` threads it nowhere |

### `hook-and-agents-unstub` (backend-dev) — 3 hooks + `agents/pool.ts`

| File | Body |
|---|---|
| `hooks/post-edit.ts` | De-stubbed — `TODO(F4-2)` removed, header rewritten to document that `handle.write` *is* the journal-append (the FS-JSON substrate's atomic tmp+fsync+rename is the durability the cli's bare `appendFileSync` lacked). Hot-path contract preserved. |
| `hooks/pre-task.ts` | De-stubbed — same shape; `handle.write` is the counter-bump entry. |
| `hooks/session-end.ts` | **Real F4-2 IPC wire-up** — a minimal inline newline-delimited JSON-RPC 2.0 UDS client (`sendConsolidateNudge`). Correctly ordered (substrate write *first*, then nudge, so a crash between leaves a recoverable record); `feedback-no-fallbacks`-honoring (WARN on socket-absent, never silent). One narrow `TODO(F4-2-config)`: `MutationContext` carries no `projectRoot`, so the socket path defaults to `process.cwd()` until the cli integration threads it. |
| `agents/pool.ts` | Was already a complete real body — worker only replaced a stale `TODO(ADR-0180 Phase 5 wire-up)` comment with descriptive prose. |

### `agentdb-handler-unstub` (backend-dev) — 5 `agentdb/*` handlers, split outcome

The queen sent this worker a line-anchored heads-up after verifying `substrate-registry.ts` `classifyStore`: of the 5, three classify FS-JSON (whole-document `ctx.substrate.read` works) and two do not.

| File | Family | Body |
|---|---|---|
| `agentdb/filtered-search.ts` | FS-JSON | **Real body** — reads the persisted candidate corpus via `ctx.substrate.read`, applies the full B5 MongoDB-style metadata filter (`$and`/`$or`/`$not` + the operator atoms, unknown-operator throws), threshold + limit, ranks by precomputed `score`, emits `RankedResult[]` with provenance. `TODO(F4-2-config)` sub-gap: the BM25 leg + RRF fusion needs the controller registry. |
| `agentdb/reflexion-retrieve.ts` | FS-JSON | **Real body** — reads the persisted episode corpus, applies `onlyFailures` / `onlySuccesses` / `minReward` filter knobs, ranks by precomputed `similarity`, caps at `k`. `TODO(F4-2-config)` sub-gap: the cli's live re-embed of the query task needs the embedding service. |
| `agentdb/skill-search.ts` | FS-JSON | **Real body** — reads the persisted skill corpus, ranks by a **deterministic lexical-overlap scorer** (`tokenize` + name/description-weighted overlap) honestly tagged `matchType: 'bm25'`. `TODO(F4-2-config)` sub-gap: the cli's embedding-cosine score needs the SkillLibrary controller. |
| `agentdb/route.ts` | **RVF** | **Documented fail-loud throw.** Classifies RVF; `ctx.substrate.withWrite` yields an RVF handle whose k/v `write` throws by design, and `initialize(config)` threads no `rvfBackend` until F4-3. **Queen correction applied:** the worker's first pass made the body a *no-op that records `applied`* — a silent-success anti-pattern (`feedback-data-loss-zero-tolerance` / `feedback-no-fallbacks`); it now `throw`s with a documented F4-3-config message. Narrow `TODO(F4-2-config)` comments explain the SemanticRouter + embedding-service gap. |
| `agentdb/pattern-search.ts` | **SQLite carve-out** | **Documented fail-loud throw.** Classifies SQLite carve-out (the ReasoningBank GROUP-BY *read*, per ADR-0166 axis-separation — `agentdb_pattern_store` is RVF, `agentdb_pattern_search` is SQLite); `makeSqliteSubstrate`'s `read` throws by design, the SQL `handle.db` is only inside `withWrite` (not exposed to a `ReadContext`), and `initialize(config)` threads no read-side SQL handle. **Queen correction applied:** changed from `return []` (silent degrade) to a documented fail-loud throw, consistent with its `agentdb/route.ts` peer. |

### `archivist-tsconfig-wirer` (coder) — no work needed, correctly reported

Verified `tsconfig.archivist.json` is clean-by-design (0 errors, deliberate standalone `--noEmit` gate, correctly not a `references` project). The `exports`-exclusion residual was already satisfied. The file is **untracked** (`?? src/archivist/tsconfig.archivist.json`) — Phase 2 created it but never committed it; whoever commits Phase B must `git add` it alongside the Phase A archivist files.

## Structural acceptance

No `npm run release` — structural gates only, per the brief.

| Gate | Result |
|---|---|
| `npx tsc --noEmit` — `src/archivist/**` shows no new errors | ✅ **`src/archivist/**` = 0 errors.** Fork-wide total 21, **all** in `src/controllers/LearningSystem.ts` + `src/core/AgentDB.ts` — the pre-existing unmerged-conflict files Phase A flagged. Zero in the archivist tree; no Phase B file introduced an error. |
| `tsconfig.archivist.json` project-ref errors resolved | ✅ 0 errors. Resolved by design (standalone `--noEmit` gate) — not by wiring it into `references` (which would have re-introduced TS6307). |
| charter check exits 0 | ✅ `check-archivist-charter.sh`: `OK: 166 file(s) match charter (10 responsibilities enumerated)`. All `// charter:` headers preserved. |
| `grep -rl "TODO(F4-2)"` returns 0 | ⚠️ **Returns 1** (`daemons/consolidate.ts`) — and that single hit is a *prose cross-reference* on line 79 ("see `TODO(F4-2)` below") pointing forward to the file's line-155 `TODO(F4-2-config:...)` documented gap. **No handler body among the 14 targets is a bare unaddressed throw-stub.** The 7 files carrying `TODO(F4-2-config)` use the contract-permitted *narrow documented config-gap* form. A one-word edit to `consolidate.ts:79` ("see `TODO(F4-2-config)` below") would zero the literal grep; flagged as a cosmetic follow-up, not a body defect. |

### The 14 brief targets — final state

| File | Outcome |
|---|---|
| `daemons/optimize.ts` | Real body |
| `daemons/benchmark.ts` | Real body |
| `daemons/consolidate.ts` | Real body + documented `TODO(F4-2-config)` (3 OF#11 sibling artifacts need registry routes) |
| `daemons/auto-memory-bridge.ts` | Real body + documented `TODO(F4-2-config)` (markdown-capable substrate primitive needed) |
| `daemons/hooks-learning.ts` | Real body + documented `TODO(F4-2-config)` (`reasoningBank` handle not threaded) |
| `hooks/post-edit.ts` | Real body (de-stubbed; was already writing) |
| `hooks/pre-task.ts` | Real body (de-stubbed; was already writing) |
| `hooks/session-end.ts` | Real body — real inline JSON-RPC 2.0 UDS nudge client + documented `TODO(F4-2-config)` (`projectRoot` not on `MutationContext`) |
| `agents/pool.ts` | Real body (was already complete pre-Phase-B) |
| `agentdb/filtered-search.ts` | Real FS-JSON body + documented `TODO(F4-2-config)` (BM25 leg / fusion) |
| `agentdb/reflexion-retrieve.ts` | Real FS-JSON body + documented `TODO(F4-2-config)` (live re-embed) |
| `agentdb/skill-search.ts` | Real FS-JSON body + documented `TODO(F4-2-config)` (embedding-cosine score) |
| `agentdb/route.ts` | Documented fail-loud throw — RVF family, backend not threaded until F4-3 |
| `agentdb/pattern-search.ts` | Documented fail-loud throw — SQLite carve-out, backend not threaded until F4-3 |

## What Phase B deliberately did NOT do (team-lead ruling)

The queen's scope escalation offered option (A): build Phase A's deferred item #4 (read-optimized substrate siblings) + the multi-file substrate primitive within Phase B, so the design-blocked handlers become un-stubbable. **The team-lead declined (A).** Speculatively building substrate infrastructure to unblock handlers is a real scoping decision that belongs to the user — not something to swarm-dispatch under a "Phase B" banner. The trimmed-(B) ruling: deliver the genuinely-doable handlers with real bodies, leave the rest honestly blocked with documented narrow gaps.

Consequently, **still blocked, by design, with documented gaps:**

- `agentdb/{route,pattern-search}` handler bodies — need F4-3 `initialize(config)` call-site wiring (RVF backend / read-side SQLite handle) + a controller registry on the context.
- `agentdb/{filtered-search,reflexion-retrieve,skill-search}` — have real *reduced* bodies (whole-document read + in-handler rank); the BM25/fusion/re-embed legs need the controller registry / read-optimized substrates.
- `daemons/consolidate.ts` — the 3 OF#11 sibling artifacts (`graph-state.json`, `ranked-context.json`, `intelligence-snapshot.json`) need new `FS_JSON_PATH_OVERRIDES` storeId routes.
- `daemons/auto-memory-bridge.ts` — the topic-markdown + `MEMORY.md` outputs need a markdown-capable substrate primitive (the FS-JSON substrate is JSON-only).

## F4-2 remaining scope — the honest picture

**F4-2 is not a wrap-up phase.** The substrate seam (Phase A) and the genuinely-doable handler bodies (Phase B) are done, but the bulk of the F4-2 → F4-3 program remains, and the **88-of-118 stub landscape is unchanged** outside the 14 brief targets:

1. **Read-optimized substrate siblings (Phase A deferred item #4).** The registry builds only the write-side `SubstrateAccess`. `routingReadOnlySubstrate().query` / `.vectorSearch` throw. Until BM25/HNSW query surfaces exist, every ranked-read handler is capped at the reduced whole-document-read body.
2. **A multi-file / markdown-capable substrate primitive.** `consolidate`'s 4-artifact atomic write and `auto-memory-bridge`'s topic-markdown + `MEMORY.md` outputs both need substrate primitives the FS-JSON whole-document-JSON store does not provide.
3. **`initialize(config)` call-site wiring (F4-3).** `ArchivistInitConfig` accepts `sqliteDb` / `rvfBackend` / `projectRoot` (+ lazy factories) but **nothing wires real instances in yet.** Until the cli / daemon / hook processes pass real backends, every RVF-family and SQLite-carve-out handler `throw`s at `getSubstrate()`. A controller registry on the context is also needed for the router / fusion / re-embed bodies.
4. **cli `archivist.dispatch()` delegation (F4-3).** The ~118 handler registration shapes exist; the cli MCP-tool handlers + controller call sites still stay authoritative. Re-pointing them at `archivist.dispatch()` / `dispatchRead()` is the bulk-migration step.
5. **The remaining ~80+ throw-stub handlers** outside the 14 brief targets — `coordination/*`, `workflow/*`, `hive-mind/*`, `wasm/*`, `daa/*`, `ruvllm/*`, `neural/*`, `system/*`, `github/*`, `config/*`, `autopilot/*`, `memory/*`, and the other `agentdb/*` / `agents/*` / `daemons/*` files — are untouched. Each needs the same treatment: a real body where the current substrate API supports it, a documented config-gap where it does not.
6. **Pre-existing unmerged-conflict files.** `src/controllers/LearningSystem.ts` + `src/core/AgentDB.ts` carry git conflict markers (21 tsc errors) — they will block `npm run release`. **Not Phase B's to fix** (outside `src/archivist/**`, no Phase B worker touched them) — flagged here as a release-blocker the user must resolve, consistent with Phase A's flag.

The user needs to make a real call on F4-2's actual scope before more swarms spin into the 88-file landscape.

## Relevant file paths

The 14 handler files (all under `/Users/henrik/source/forks/agentdb/src/archivist/handlers/`, untracked tree):

- `agentdb/{route,filtered-search,pattern-search,reflexion-retrieve,skill-search}.ts`
- `daemons/{optimize,benchmark,consolidate,auto-memory-bridge,hooks-learning}.ts`
- `hooks/{post-edit,pre-task,session-end}.ts`
- `agents/pool.ts`

Substrate-seam files consulted (Phase A deliverables, untracked):

- `/Users/henrik/source/forks/agentdb/src/archivist/index.ts` — `getSubstrate`, `routingSubstrate` / `routingReadOnlySubstrate`, `makeAuditSink`
- `/Users/henrik/source/forks/agentdb/src/archivist/substrate-registry.ts` — `classifyStore` (the RVF / SQLite-carve-out / FS-JSON rosters that determine which handlers can have real bodies in F4-2), `FS_JSON_PATH_OVERRIDES`
- `/Users/henrik/source/forks/agentdb/src/archivist/substrates/{fs-json-store,sqlite-store,rvf-store}.ts` — the `SubstrateAccess` primitives
- `/Users/henrik/source/forks/agentdb/src/archivist/tsconfig.archivist.json` — untracked; clean-by-design standalone `--noEmit` gate; **needs `git add` at Phase B commit time**

Reference real-bodied handlers (the pattern the workers matched — Phase 5 deliverables, untracked):

- `/Users/henrik/source/forks/agentdb/src/archivist/handlers/tasks/*.ts` (incl. `assign.ts` — the multi-store example) and `claims/*.ts`

Gate + prior report:

- `/Users/henrik/source/ruflo-patch/scripts/check-archivist-charter.sh` — charter gate, PASS at 166 files
- `/Users/henrik/source/ruflo-patch/docs/council/ADR-0180-f4-2-phase-a-report.md` — Phase A report (its "10 tsconfig errors" claim and "13 TODO(F4-2)" count are stale vs. disk — corrected here)
