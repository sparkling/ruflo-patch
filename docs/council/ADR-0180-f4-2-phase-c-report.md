# ADR-0180 F4-2 Phase C — Substrate Infrastructure

**Phase:** F4-2 Phase C (build the substrate infrastructure Phase D needs to un-stub the design-blocked handlers)
**Status:** COMPLETE. All three deliverables on disk, structural acceptance green. Workers single-attempt each; team shut down by team-lead at user request after delivery.
**Date:** 2026-05-14
**Coordinator:** queen-sparc (SPARC orchestrator; coordination + on-disk verification only — no source code authored)
**Workers:** 3, single-attempt each, dispatched in one wave by team-lead alongside the queen (same crossed-message pattern as Phases 8/10/F4-2A/B — the queen verified deliverables on disk as reports landed rather than re-requesting dispatch).

## TL;DR

Phase B proved the bottleneck: 88 of 118 handler files still throw `pending`, and the ranked-read handlers were *design-blocked* because (a) `routingReadOnlySubstrate()` blanket-threw on `query`/`vectorSearch`, (b) several handlers need backend handles / `projectRoot` that `ArchivistInitConfig` didn't thread, and (c) `consolidate`/`auto-memory-bridge` need a multi-file atomic-write primitive that didn't exist. Phase C built all three:

- **`readonly-substrate-impl`** — `query` + `vectorSearch` implemented on all 3 substrate factories; `routingReadOnlySubstrate()` no longer blanket-throws — it forwards per-call through `getSubstrate()`, with fail-loud living in `getSubstrate()` (unregistered store / unwired backend) and the factories themselves (operation a family can't honor).
- **`init-config-extender`** — new `capabilities.ts` module with narrow `TaskRouter` / `EmbeddingScorer` / `PatternReader` surfaces; `ArchivistInitConfig` extended with `projectRoot` threading + three lazy capability factories; both contexts (`MutationContext` / `ReadContext`) now carry `projectRoot` + a `capabilities` bundle with fail-loud `require*` accessors. Type-enforcement boundary intact — handlers get narrow capability handles, never raw controllers.
- **`multifile-substrate-primitive`** — `writeMultiFileAtomic(lockPath, files)` on the FS-JSON substrate: two-phase stage+commit under one O_EXCL lock, honest-partial contract per ADR-0180 §Confirmation. Discriminated `payload: string | { json }` serves both consolidate's JSON artifacts and auto-memory-bridge's markdown without a second substrate family.

**Structural acceptance: all gates green.** `npx tsc -p src/archivist/tsconfig.archivist.json --noEmit` = **0 errors** (all three workers' edits compose clean, including two concurrent edits to `fs-json-store.ts` and three concurrent edits to `index.ts`). `check-archivist-charter.sh` = **OK, 167 files** (capabilities.ts brought it 166→167). The 21 remaining fork-wide tsc errors are entirely the pre-existing `src/controllers/LearningSystem.ts` + `src/core/AgentDB.ts` unmerged-conflict files — outside `src/archivist/**`, not touched by Phase C, flagged again below.

## Worker deliverables (verified on disk by the queen)

### `readonly-substrate-impl` (backend-dev) — read-only substrate surface

`ReadOnlySubstrateHandle` (`types.ts:58-66`) already *declared* `query` + `vectorSearch`; Phase A left them unimplemented and `routingReadOnlySubstrate()` blanket-threw a "Phase B scope" error. This worker implemented the surface:

| File | Change |
|---|---|
| `substrates/fs-json-store.ts` | Handle type widened to `ReadCapableSubstrate` (`SubstrateHandle` + `query` + `vectorSearch`). `query` = predicate scan over the document's records (unlocked — reads carry no audit ceremony and a single `loadJson` is a consistent point-in-time snapshot). `vectorSearch` = **documented fail-loud throw**: the FS-JSON substrate is a whole-document JSON store with no vector index — a `vectorSearch` routed here is a routing bug (the store should classify RVF-family). |
| `substrates/sqlite-store.ts` | `query` = real SQL via the db handle. `vectorSearch` = documented unsupported throw (relational carve-out, ADR-0166). |
| `substrates/rvf-store.ts` | `vectorSearch` = HNSW via the `RvfBackend`. `query` = RVF filtered scan. |
| `index.ts` `routingReadOnlySubstrate()` | No longer blanket-throws. All three operations (`read` / `query` / `vectorSearch`) resolve `scope.storeId` per-call through `getSubstrate()`, then narrow the resolved handle to `ReadCapableSubstrate` (the `SubstrateAccess` brand is type-level only — runtime is the raw handle, per `substrate-internal.ts`). Fail-loud lives in two documented places, not the router: `getSubstrate()` throws for a genuinely-unregistered store or an unwired backend; the substrate factory throws for an operation its family can't honor. The router forwards every call so the substrate's own documented throw is the signal. |

### `init-config-extender` (backend-dev) — config threading + capability seam

The 4 `TODO(F4-2-config)` gaps named exactly what handlers needed beyond substrate backends. This worker built the seam:

| File | Change |
|---|---|
| `capabilities.ts` (**new**, `// charter: type-enforcement`) | Narrow capability surfaces — `TaskRouter` (route decision computation, backed by the cli `routeTask(...)` path), `EmbeddingScorer` (`embed` + `cosineSimilarity`, backed by `controllers/EmbeddingService`), `PatternReader` (read-only ReasoningBank BM25+semantic+RRF fusion read). Plus `MutationCapabilities` / `ReadCapabilities` bundles with fail-loud `require*` accessors, and `makeMutationCapabilities` / `makeReadCapabilities` builders. **Axis separation enforced by construction**: no `taskRouter` on the read bundle (routing is MUTATING), no `patternReader` on the mutation bundle (it's a read-only capability — ADR-0166). Handlers reach these via `ctx.capabilities`, never as a raw controller — same type-enforcement boundary the substrate brand protects. |
| `index.ts` `ArchivistInitConfig` | Added `taskRouterFactory` / `embeddingScorerFactory` / `patternReaderFactory` (lazy — invoked at most once on first `initialize()`, only if supplied). `projectRoot` doc updated to note it now threads onto contexts, not just substrate paths. |
| `index.ts` `Archivist` class | `taskRouter` / `embeddingScorer` / `patternReader` private holders; `initialize()` invokes the factories; both `dispatchMutationInternal` / `dispatchReadInternal` thread `projectRoot` + the capability bundle onto the minted context. |
| `mutation-context.ts` / `read-context.ts` | Interfaces, `Create*Input`, and constructors all carry `projectRoot` + `capabilities`. `MutationContext.projectRoot` closes `handlers/hooks/session-end.ts`'s `TODO(F4-2-config)` (daemon-socket path) fully. |
| `types.ts` | Structural shadows `MutationContextLike` / `ReadContextLike` updated with `projectRoot` + `capabilities` so the `GuardedWrite` / `GuardedRead` brands still match. |

**Remaining narrow gap (documented, by design):** where a backing controller is constructed in the cli process rather than the archivist's, the factory is simply left unsupplied and the handler's gap re-tags `TODO(F4-3-callsite)` — the cli-delegation phase's job. `route.ts` `TODO(F4-2-config) #1` (SemanticRouter) and `pattern-search.ts` `TODO(F4-2-config)` (ReasoningBank read path) are in this bucket: the *seam* exists, the cli-side wiring is F4-3.

### `multifile-substrate-primitive` (coder) — multi-file atomic-write primitive

`makeFsJsonSubstrate`'s `withBulkWrite` collapses to a single-file `withWrite`; `consolidate` needs 3 OF#11 artifacts written as one intent and `auto-memory-bridge` needs `MEMORY.md` + per-topic markdown. This worker built the primitive:

| File | Change |
|---|---|
| `substrates/fs-json-store.ts` | `writeMultiFileAtomic(lockPath, files: ReadonlyArray<MultiFileTarget>): Promise<MultiFileWriteResult>` — extended in place (`// charter: substrate-seam` preserved). `MultiFileTarget = { path, payload: string \| { json: unknown } }` — `{json}` → 2-space `JSON.stringify`, bare `string` → verbatim bytes. **One discriminator, no second substrate family for markdown.** |
| `substrates/index.ts` | Barrel: `writeMultiFileAtomic` + the two types. |
| `index.ts` | Handler-facing re-export (alongside `registerMutationHandler` — *not* the brand-mint seam, so Phase D handlers import it from `../../index` like everything else). |

**Atomicity contract — honest-partial (NOT true N-file atomic).** True N-file POSIX atomicity needs a single-directory staging swap; the OF#11 targets span directories (`.claude-flow/metrics/` + `.claude-flow/data/`, or `<memoryDir>/`), so a dir-swap is unavailable. Two-phase instead:

1. **Stage** — every target → tmp + fsync (reuses `saveJsonAtomic`'s durability stack). Any stage failure → nothing renamed → **throws** (clean `failed` intent, tmp files best-effort unlinked).
2. **Commit** — `renameSync(tmp, target)` per target in `files` order. Mid-sequence rename failure → the already-renamed prefix IS committed → **returns** `{ state: 'partial', committedPaths: <prefix>, failedPath, error }` (NOT thrown — the caller finalizes its audit entry with the right state + committed prefix). No compensating rollback of the prefix (ADR-0180 §Transactions and partial failure).

Whole stage+commit runs under one O_EXCL sentinel lock via the existing `withFileLock` (same stale-lock recovery as the single-doc substrate).

**Ordering note for Phase D:** renames commit in array order, so the caller puts the "this intent ran" signal file LAST (consolidation → `intelligence-snapshot.json` last) so a `partial` never advertises a completed intent. Documented in the primitive's doc-block + both `@example`s.

## Coordination — three concurrent edits to `index.ts`, two to `fs-json-store.ts`

All three workers' briefs flagged `index.ts` / `types.ts` as shared. The workers coordinated edit regions via SendMessage and used narrow Read-then-Edit. Net result, verified on disk:

- `index.ts` — `init-config-extender` owns the imports block + `ArchivistInitConfig` + the class holders + the dispatch-internal context-minting; `readonly-substrate-impl` owns `routingReadOnlySubstrate()`; `multifile-substrate-primitive` owns the ~14-line handler-facing re-export block. Three disjoint regions, no collision, compiles clean.
- `fs-json-store.ts` — `readonly-substrate-impl` widened the handle to `ReadCapableSubstrate` + added `query`/`vectorSearch` inside `makeFsJsonSubstrate`; `multifile-substrate-primitive` appended the ~210-line `writeMultiFileAtomic` block at end-of-file. Disjoint, both compile clean together.

## Structural acceptance

No `npm run release` — structural gates only, per the brief.

| Gate | Result |
|---|---|
| `query`/`vectorSearch` implemented on all 3 factories | ✅ `fs-json-store.ts`, `sqlite-store.ts`, `rvf-store.ts` all carry `async query` + `async vectorSearch`. |
| `routingReadOnlySubstrate()` no longer blanket-throws | ✅ Forwards per-call through `getSubstrate()` → `ReadCapableSubstrate`; fail-loud relocated to `getSubstrate()` + the factories. |
| `ArchivistInitConfig` threads named backend handles + `projectRoot` | ✅ `projectRoot` threads onto both contexts; `taskRouterFactory` / `embeddingScorerFactory` / `patternReaderFactory` added; capability bundle wired onto `MutationContext` / `ReadContext`. |
| multi-file write primitive exists on the FS-JSON substrate | ✅ `writeMultiFileAtomic` exported from `fs-json-store.ts` + barrel + public `index.ts`. |
| `npx tsc -p src/archivist/tsconfig.archivist.json --noEmit` shows no new errors | ✅ **`src/archivist/**` = 0 errors.** Fork-wide total 21, all in the pre-existing unmerged-conflict files. |
| `check-archivist-charter.sh` exits 0 | ✅ `OK: 167 file(s) match charter (10 responsibilities enumerated)` — capabilities.ts (`// charter: type-enforcement`) brought it 166→167. |

## Phase D scope — the honest picture

Phase C built the infrastructure; Phase D consumes it. The 88-of-118 stub landscape is **structurally unblocked now** but **un-stubbing is Phase D's work**, not done here:

1. **The now-unblocked design-blocked handlers** — `agentdb/{filtered-search,reflexion-retrieve,skill-search}` can move from their reduced whole-document-read bodies to full ranked reads using `ctx.substrate.query` / `vectorSearch` + `ctx.capabilities.embeddingScorer`. `agentdb/pattern-search` can un-throw using `ctx.capabilities.patternReader` *if the cli process supplies `patternReaderFactory`* — otherwise it re-tags `TODO(F4-3-callsite)`. `agentdb/route` likewise via `ctx.capabilities.taskRouter` + `embeddingScorer`, same F4-3-callsite caveat. `hooks/session-end` can drop its `process.cwd()` fallback and use `ctx.projectRoot` directly. `daemons/consolidate` + `daemons/auto-memory-bridge` can write their multi-file artifact sets via `writeMultiFileAtomic` — though consolidate still needs the 3 sibling `StoreId` routes added to `FS_JSON_PATH_OVERRIDES` (or it builds paths from `ctx.projectRoot` directly — the primitive takes explicit paths, so that works too), and the audit-entry `partial`-state plumbing needs to consume `MultiFileWriteResult.committedPaths`.
2. **The remaining ~80 throw-stub handlers** outside the design-blocked set — `coordination/*`, `workflow/*`, `hive-mind/*`, `wasm/*`, `daa/*`, `ruvllm/*`, `neural/*`, `system/*`, `github/*`, `config/*`, `autopilot/*`, `memory/*`, and the other `agentdb/*` / `agents/*` / `daemons/*` files. Each needs a real body where the (now-richer) substrate + capability API supports it.
3. **`initialize(config)` call-site wiring (F4-3).** `ArchivistInitConfig` now *accepts* `sqliteDb` / `rvfBackend` / `projectRoot` / the three capability factories, but **nothing wires real instances in yet.** Until the cli / daemon / hook processes pass real backends + factories, every RVF-family / SQLite-carve-out handler `throw`s at `getSubstrate()` and every capability-needing handler `throw`s at the `require*` accessor.
4. **cli `archivist.dispatch()` delegation (F4-3).** The ~118 registration shapes exist; the cli MCP-tool handlers + controller call sites still stay authoritative. Re-pointing them at `archivist.dispatch()` / `dispatchRead()` is the bulk-migration step.

## Flagged again (NOT fixed — outside Phase C scope)

**Pre-existing unmerged-conflict files.** `src/controllers/LearningSystem.ts` + `src/core/AgentDB.ts` carry git conflict markers (21 tsc errors fork-wide). This fork is mid-merge (`b7-followup-pre-pull` stash). **Not Phase C's to fix** — outside `src/archivist/**`, no Phase C worker touched them — but they **will block `npm run release`**. The user must resolve the merge before the pipeline runs. Consistent with the Phase A and Phase B flags.

## Relevant file paths

All under `/Users/henrik/source/forks/agentdb/` (archivist tree is untracked except `index.ts` which is staged-new):

Phase C deliverable files:

- `src/archivist/index.ts` — `ArchivistInitConfig` + capability holders + `initialize()` factory invocation + `routingReadOnlySubstrate()` un-throw + dispatch-internal context-minting + `writeMultiFileAtomic` re-export
- `src/archivist/capabilities.ts` — **new** — narrow capability surfaces + bundles + builders
- `src/archivist/mutation-context.ts` / `src/archivist/read-context.ts` — `projectRoot` + `capabilities` on the interfaces + constructors
- `src/archivist/types.ts` — structural shadows updated
- `src/archivist/substrates/fs-json-store.ts` — `ReadCapableSubstrate` handle + `query`/`vectorSearch` + `writeMultiFileAtomic`
- `src/archivist/substrates/sqlite-store.ts` — `query` (SQL) + `vectorSearch` (unsupported throw)
- `src/archivist/substrates/rvf-store.ts` — `vectorSearch` (HNSW) + `query` (filtered scan)
- `src/archivist/substrates/index.ts` — barrel re-export

Gate + prior reports:

- `/Users/henrik/source/ruflo-patch/scripts/check-archivist-charter.sh` — charter gate, PASS at 167 files
- `/Users/henrik/source/ruflo-patch/docs/council/ADR-0180-f4-2-phase-b-report.md` — Phase B report (the scope-discovery report this phase builds on)
- `/Users/henrik/source/ruflo-patch/docs/council/ADR-0180-f4-2-phase-a-report.md` — Phase A report
