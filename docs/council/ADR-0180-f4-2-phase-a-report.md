# ADR-0180 F4-2 Phase A — Substrate-Seam Runtime Activation

**Phase:** F4-2 Phase A (the substrate-seam keystone — flips the archivist from scaffolded to a live, substrate-resolving dispatch path)
**Status:** Structural acceptance PASS. One pre-existing Phase-2 scaffolding gap surfaced (not introduced) — `tsconfig.archivist.json` project-reference rootDir wiring — carried as the first item of Phase B scope.
**Date:** 2026-05-14
**Coordinator:** queen-sparc (SPARC orchestrator; coordination only — no source code authored)
**Workers:** 5, single-attempt each, dispatched in one wave by team-lead

## Summary

Before Phase A the archivist was **scaffolded, not live**: `Archivist.initialize()` was a 3-line stub, `dispatchMutationInternal` minted `makeSubstrateAccess(placeholderSubstrate())` whose methods threw, and the read path did the same. Phase A wires the substrate seam so dispatch resolves a real RVF / SQLite / FS-JSON backend per call.

All 5 workers delivered single-attempt. Deliverables verified on disk by the queen. The substrate seam is now live on the dispatch path; the 13 `TODO(F4-2)` handler bodies and the cli `archivist.dispatch()` delegation remain — those are **Phase B**.

## Worker deliverables (verified on disk)

| Worker | Deliverable | Verified |
|---|---|---|
| `sqlite-substrate-factory` | `src/archivist/substrates/sqlite-store.ts` (142 LoC, `// charter: substrate-seam`) — `makeSqliteSubstrate(db: BetterSqlite3.Database): SubstrateAccess`. `withWrite` wraps `db.transaction(fn)` (BEGIN IMMEDIATE / COMMIT / ROLLBACK); **no O_EXCL sentinel above it** (the ADR disposition #10 compose-deadlock). `withBulkWrite` delegates to `withWrite`. `SqliteSubstrateHandle` extends `SubstrateHandle` with a live `.db`. Base k/v `read`/`write` throw fail-loud (SQLite handlers address rows via SQL, not the FS-JSON k/v shape). Barrel updated. | ✅ file + signature + `db.transaction` wrap + no-O_EXCL confirmed |
| `rvf-substrate-factory` | `src/archivist/substrates/rvf-store.ts` (96 LoC, `// charter: substrate-seam`) — `makeRvfSubstrate(backend: RvfBackend): SubstrateAccess`. `withWrite` is a **thin pass-through** (`return await fn(handle)`, handle exposes `{ rvf: backend }`); **no JS-side lock, no tmp+rename** (the Rust crate owns durability at the N-API boundary). `withBulkWrite` delegates to `withWrite`. Base k/v `read`/`write` throw fail-loud (RVF is vector-addressed). Barrel updated. | ✅ file + signature + pass-through (no JS lock) confirmed |
| `substrate-registry-builder` | `src/archivist/substrate-registry.ts` (259 LoC, `// charter: substrate-seam`) — `SubstrateFamily` (`rvf`/`sqlite`/`fs-json`), `classifyStore(storeId)` with explicit RVF + SQLite-carve-out rosters and a structural FS-JSON default, `fsJsonPathFor()`, `SubstrateRegistry<T>` Map wrapper. `index.ts`: `ArchivistInitConfig` (`{ sqliteDb?, sqliteDbFactory?, rvfBackend?, rvfBackendFactory?, projectRoot? }`), real 26-line `initialize(config)` building shared RVF + SQLite substrates (FS-JSON deferred to lazy mint), `getSubstrate(storeId)` with fail-loud throw when a family's backend was not supplied. | ✅ registry file + `initialize()` (26 lines, not the 3-line stub) + `getSubstrate()` confirmed |
| `dispatch-substrate-router` | `index.ts`: `routingSubstrate()` — composite `SubstrateHandle` whose `read`/`write`/`withWrite` resolve `scope.storeId` per-call via `getSubstrate()`, `withBulkWrite` via `intent.tableName`. `routingReadOnlySubstrate()` — `read` delegates the same way; `query`/`vectorSearch` throw a documented Phase-B fail-loud error. `dispatchMutationInternal` now mints `makeSubstrateAccess(this.routingSubstrate())`; `dispatchReadInternal` the read-only equivalent. `placeholderSubstrate()` + `placeholderReadOnlySubstrate()` **fully deleted** — `classifyStore` covers every storeId. | ✅ both routers + dispatch swaps + placeholder deletion confirmed (grep: zero `placeholder*` refs left) |
| `audit-writer-integrator` | `index.ts`: `dispatch()` threads `lookup.entry.hotPath` into `dispatchMutationInternal`; the method gained a `hotPath: boolean` param; `makeAuditSink(hotPath)` factory routes **hot-path → `getSharedHotPathQueue().enqueue`** (sync return, drains write-through on microtask) and **cold-path → `await writeThroughEntry`** (full ceremony). §Audit chain ordering preserved: `intent` opens before the handler/substrate write, finalizes (`applied`/`rejected`/`failed`) after. | ✅ `makeAuditSink` + hotPath threading + ordering confirmed |

## Structural acceptance

All gates per the Phase A brief, no `npm run release`:

| Gate | Result |
|---|---|
| `substrates/{sqlite-store,rvf-store}.ts` exist with the factory exports | ✅ both present, `// charter: substrate-seam` |
| `Archivist.initialize()` builds a real substrate registry | ✅ 26-line method building RVF + SQLite substrates from `ArchivistInitConfig`; FS-JSON lazy-minted; idempotent guard kept |
| `dispatchMutationInternal` / `dispatchReadInternal` resolve real substrate by storeId | ✅ both mint a routing `SubstrateAccess` over `getSubstrate()`; `placeholderSubstrate()` / `placeholderReadOnlySubstrate()` **deleted** (not demoted — fully removed; `classifyStore` covers all cases) |
| audit-writer integrated into dispatch | ✅ `makeAuditSink(hotPath)` — hot-path queue / cold-path write-through, `intent`-before-write preserved |
| `npx tsc --noEmit` for `src/archivist/**` — no NEW errors vs pre-Phase-A baseline | ✅ **package build (`tsconfig.json`): `src/archivist/**` = 0 errors** (baseline was 0). Total fork errors 118 → 21 (other agents' unrelated fixes, not Phase A). |
| charter check exits 0 | ✅ `scripts/check-archivist-charter.sh` (in ruflo-patch): `OK: 166 file(s) match charter (10 responsibilities enumerated)` — baseline was 165; Phase A added `substrate-registry.ts` as a charter-tagged file |

### One caveat — `tsconfig.archivist.json` project-reference rootDir (pre-existing Phase-2 gap, NOT a Phase A regression)

Running the **archivist project-reference tsconfig** (`src/archivist/tsconfig.archivist.json`, the ADR §Type-enforcement path-restriction config) produces **10 errors — all `TS6059`/`TS6307` `rootDir` config errors, zero real type errors**. They fire because `rvf-store.ts` / `sqlite-store.ts` import the real backends from `../backends/`, which is outside that tsconfig's `rootDir: "."` (= `src/archivist`).

This is **not introduced by Phase A** — it is a latent Phase-2 scaffolding gap that Phase A *surfaced*:

- The substrate factories *must* import the real `RvfBackend` / `better-sqlite3` — that is the entire point of OF#10 ("thin pass-throughs to the layer that already owns durability"). The moment any factory imports a real backend, a `rootDir: "."` scoped to `src/archivist` rejects it.
- `tsconfig.archivist.json`'s own header says so verbatim: `"TODO(queen): wire this project reference into forks/agentdb/tsconfig.json ... main tsconfig wiring lands as a separate queen-integration commit"` and `"Phase 2 deliverable: this file exists; main tsconfig wiring lands as a separate queen-integration commit"`.
- The **package build** (`tsconfig.json` — the build that produces the published `@sparkleideas/agentdb`) is clean for `src/archivist/**`. The project-reference config is not yet wired into the main tsconfig's `references`, so it does not gate the package build today.

Resolution belongs to the queen-integration commit the tsconfig header already names — it needs to either add `src/backends` to the project-reference file list or relax `rootDir`. Carried as **Phase B scope item #1** below. It does not block Phase A: the binding gate is "no NEW `src/archivist/**` errors in the package build," which holds.

## Architectural finding — storeId is not in registration metadata

The Phase A brief framed substrate resolution as "look up the substrate by the registered handler's storeId." Investigation (queen + `dispatch-substrate-router`) found the code does not work that way, and the design was adjusted mid-wave:

- Handlers **self-declare** their storeId at module scope (`const STORE_ID = 'memory_store' as StoreId`) and pass it **per-call** to `ctx.substrate.withWrite({ storeId }, ...)`. The registration API (`RegisterMutationOpts` / `RegisterReadOpts`) carries only `cacheScope` + `invariants` — **not** storeId.
- One handler can touch **multiple** stores (`handlers/tasks/assign.ts` writes both `TASKS_STORE_ID` and `hive-mind_agents`).

Consequence: dispatch cannot resolve a single backend up front — it does not know the storeId. The adopted design (queen binding decision, 2026-05-14):

- `substrate-registry-builder` owns `getSubstrate(storeId): SubstrateAccess` — structural family classification via `classifyStore`, fail-loud when a family's backend was not supplied.
- `dispatch-substrate-router` builds a **routing `SubstrateAccess` composite** (`routingSubstrate()` / `routingReadOnlySubstrate()`) whose methods take the `storeId` from their **argument** and delegate to `getSubstrate(storeId)` per-call. This composite is what `ctx.substrate` carries.

This is cleaner than the original brief framing and required no change to the handler contract or the `SubstrateHandle` shape.

## Coordination notes

- **Crossed messages (same pattern as Phases 5/6/10).** The team-lead spawns queen + all workers in one wave; the queen's tool surface does not include the native Agent tool. The queen's worker briefs and the team-lead's dispatch affirmation crossed — the workers were already running. No re-dispatch occurred.
- **A binding decision crossed a worker's completion.** Mid-wave, the queen issued a binding decision asking `substrate-registry-builder` to also build the routing composite. That message arrived after the worker had finished and marked task #3 complete (single-attempt contract). The queen reassigned the thin routing-composite wrapper to `dispatch-substrate-router` — the natural owner, since it edits `dispatchMutationInternal`/`dispatchReadInternal` anyway and `getSubstrate()` already existed for it to wrap. Net effect: the design landed intact, just authored by the worker downstream of where it was first specified.
- **A worker escalated on stale state — resolved with line-anchored facts.** `dispatch-substrate-router` escalated twice claiming the registry was not landed (`initialize()` "still a 3-line stub", "no `SubstrateRegistry` anywhere"). It had not re-read `index.ts` after `substrate-registry-builder`'s edit landed. The queen verified the registry on disk (file size, line numbers, `git status`) and sent a definitive line-anchored unblock; the worker then completed its slice. **Lesson for Phase B:** workers editing a shared file must re-read it immediately before editing and before escalating — a stale read is not a blocker.
- **Stale duplicate task re-deliveries.** `rvf-substrate-factory` and `audit-writer-integrator` each received a re-delivery of an already-completed task; both correctly took no action and re-confirmed prior state. No wasted file work.
- **Out-of-scope merge conflicts flagged to team-lead.** `git diff --stat` shows `src/controllers/LearningSystem.ts` and `src/core/AgentDB.ts` as `Unmerged` — unresolved git conflict markers from an earlier merge/restore series. They are **outside `src/archivist/**`** (zero conflict markers in the archivist tree, verified), no Phase A worker touched them. They will block `npm run release` when the user runs end-to-end verification — flagged to team-lead as a separate concern.

## F4-2 Phase B scope

Phase A wired the substrate seam onto the dispatch path. Phase B activates the handlers and the cli surface:

1. **`tsconfig.archivist.json` project-reference wiring (the queen-integration commit).** Wire `src/archivist/tsconfig.archivist.json` into `forks/agentdb/tsconfig.json`'s `references`, and either add `src/backends` to its file list or relax `rootDir` so the substrate factories' backend imports type-check under the project-reference config. The tsconfig header already names this as a deferred queen-integration commit. Also add the `substrate-internal.ts` exclusion to `package.json` `exports` per the same header TODO.
2. **Un-stub the 13 `TODO(F4-2)` handler bodies.** `src/archivist/handlers/agentdb/{skill-search,route,filtered-search,reflexion-retrieve,pattern-search}.ts`, `handlers/daemons/{auto-memory-bridge,consolidate,optimize,hooks-learning,benchmark}.ts`, `handlers/hooks/{post-edit,session-end,pre-task}.ts` — each currently throws a `pending wire-up` error. Port the real bodies from the authoritative cli call sites, using `ctx.substrate` (now a live routing `SubstrateAccess`) instead of direct controller / `this.db` access.
3. **cli `archivist.dispatch()` delegation (F4-3).** Re-point cli MCP tool handlers + controller call sites at `archivist.dispatch()` / `archivist.dispatchRead()`. The cli currently stays authoritative during the migration window.
4. **Read-only substrate factory siblings.** `routingReadOnlySubstrate()`'s `query` / `vectorSearch` throw a documented Phase-B error today — the registry builds only the write-side `SubstrateAccess`. Phase B adds read-optimized substrate siblings (BM25 / HNSW query surfaces) so ranked-read handlers can use `query` / `vectorSearch`.
5. **ADR-0112 enforcement-code retirement.** Rides with F4-2 per the Phase 10 report: once the archivist init-completion guarantee is live and exercised, `RvfNotInitializedError` + `requireAgentDB()` + the `controller-registry.ts` markers in `forks/ruflo/v3/@claude-flow/memory/` retire.
6. **`initialize(config)` call-site wiring.** `ArchivistInitConfig` accepts `sqliteDb` / `rvfBackend` (+ lazy factory forms) + `projectRoot`. Phase B wires the actual cli / daemon / hook processes to pass real backend instances and the resolved project root, so daemon / CLI / hook processes agree on FS-JSON paths.

## Relevant file paths

- `/Users/henrik/source/forks/agentdb/src/archivist/substrates/sqlite-store.ts` — new, `makeSqliteSubstrate`
- `/Users/henrik/source/forks/agentdb/src/archivist/substrates/rvf-store.ts` — new, `makeRvfSubstrate`
- `/Users/henrik/source/forks/agentdb/src/archivist/substrates/index.ts` — barrel, exports all three factories
- `/Users/henrik/source/forks/agentdb/src/archivist/substrate-registry.ts` — new, `SubstrateRegistry` + `classifyStore` + `SubstrateFamily` + `fsJsonPathFor`
- `/Users/henrik/source/forks/agentdb/src/archivist/index.ts` — `ArchivistInitConfig`, real `initialize(config)`, `getSubstrate()`, `routingSubstrate()`, `routingReadOnlySubstrate()`, `makeAuditSink()`; `placeholderSubstrate()` / `placeholderReadOnlySubstrate()` deleted
- `/Users/henrik/source/forks/agentdb/src/archivist/tsconfig.archivist.json` — pre-existing; project-reference wiring is Phase B scope item #1
- `/Users/henrik/source/ruflo-patch/scripts/check-archivist-charter.sh` — charter gate (runs from ruflo-patch repo root); PASS at 166 files
