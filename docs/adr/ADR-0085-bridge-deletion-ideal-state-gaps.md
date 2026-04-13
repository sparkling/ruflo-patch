# ADR-0085: Bridge Deletion & Ideal State Gap Closure

- **Status**: Accepted
- **Date**: 2026-04-13
- **Deciders**: Henrik Pettersen
- **Methodology**: 8-agent hive (queen architect, devil's advocate, registry bootstrap expert, initializer cleanup expert, dead code analyst, test strategy expert, merge conflict analyst, performance impact analyst)
- **Depends on**: ADR-0084 (Phase 4 single controller), ADR-0075 (ideal state definition)
- **Closes**: ADR-0075 Layers 2 and 5 residual gaps

## Context

ADR-0084 Phase 4 achieved **85% of the ADR-0075 ideal state** (excluding Layer 1 RVF
storage, which is a separate effort). Six gaps remain between the current architecture
and the ideal:

| # | Gap | Ideal (ADR-0075) | Actual | Impact |
|---|-----|-------------------|--------|--------|
| 1 | `memory-bridge.ts` exists | Deleted | 3,650 lines, internal detail | Dead code; upstream changes are never picked up — file exists in tree but external callers are gone |
| 2 | `memory-initializer.ts` bridge dependency | No bridge dependency | 11 `getBridge()` calls | Redundant "try AgentDB first" paths — all have working local fallbacks |
| 3 | AgentDBService wrapped not deleted | Deleted | Wrapped via controller-intercept getOrCreate | Upstream merge compatibility — political, not technical |
| 4 | Two registry bootstrap paths | One | bridge `getRegistry()` + controller-intercept | Initializer uses bridge for bootstrap; router uses intercept for access |
| 5 | 11 internal bridge fallbacks | Zero | memory-initializer "try AgentDB first" | Each has a working local fallback; the bridge try-paths are redundant indirection |
| 6 | Extra data flow layer | Tool → Controller → IStorage | Tool → router → initializer → SQLite | The bridge adds one unnecessary hop between initializer and controllers |

### Why the bridge is truly dead

After ADR-0084 Phase 4:
- **Zero external callers** — hooks-tools, worker-daemon, agentdb-orchestration all use the router
- **Router uses controller-direct** — `getController()` via controller-intercept, not `loadBridge()`
- **Upstream changes to the bridge are never executed** — the file sits in the tree, gets
  recompiled, but no code path reaches it except memory-initializer's 11 try-first calls
- Keeping it doesn't preserve upstream compatibility — it just avoids a git conflict on a
  file whose changes we'd ignore anyway

### What the bridge still provides

One critical function: `getRegistry()` (162 lines, bridge lines 167–328) **plus 8
helper functions it depends on** (~64 additional lines):

- `readProjectConfig()` (9 lines) — reads `.claude-flow/config.json`
- `getProjectConfig()` (7 lines) — reads config.json + embeddings.json
- `findProjectRoot()` (7 lines) — walks up directory tree for `.claude-flow`
- `readJsonFile()` (11 lines) — JSON parse with warn-once for embeddings.json
- `getDbPath()` (13 lines) — resolves SQLite database path
- `getConfigSwarmDir()` (6 lines) — resolves `.swarm` directory
- `ensureExitHook()` (8 lines) — registers process beforeExit handler
- Module-level state: `registryInstance`, `registryPromise`, `bridgeAvailable`, `_exitHookRegistered`, `_embeddingsJsonWarned` (3 lines)

**Total extraction: ~226 lines** (not 162 as originally scoped).

This is the **ControllerRegistry bootstrap** — it creates the singleton, calls
`registry.initialize()` with 40+ config params, suppresses console during init,
registers WASMVectorSearch, and sets up the exit hook. Without it, no AgentDB v3
controllers are instantiated.

Memory-initializer's `activateControllerRegistry()` (line 1227) is the sole caller.
The router accesses controllers via controller-intercept, which reads from the registry
that the bridge created.

### Upstream creator warning — rebuttal

ADR-0075 Upstream Creator Corrections states: "memory-bridge.ts encapsulates edge-case
handling — wholesale deletion risks regression; upstream recommends extracting specific
functions, not deleting."

**ADR-0085 follows this recommendation exactly.** We extract `getRegistry()` + helpers
(the one function with value) into the router, then delete the remainder. The 64
exported bridge functions have zero external callers (verified by hive dead code
analyst — 10 initializer-only, 54 fully unreferenced). The "edge-case handling" the
upstream creator refers to is encapsulated in the 11 try-bridge patterns in
memory-initializer.ts — each has a complete local fallback. One (listEntries at line
2620) actually contains a latent bug where the bridge suppresses empty-result
fallthrough; removing it fixes the bug.

### Merge risk — assessed as negligible

The merge conflict analyst found that memory-bridge.ts **may be fork-only code** (not
present in upstream main). Even if upstream does have it, our fork is 57 commits ahead
on this file. Upstream changes to it are never executed in our build — keeping the
file avoids a one-time git conflict but provides zero runtime value.

### Performance impact — net positive

| Dimension | Impact |
|-----------|--------|
| Cold start | POSITIVE — eliminates 11 lazy `import('./memory-bridge.js')` calls (one module parse saved) |
| Runtime | POSITIVE — one fewer async indirection per CRUD operation |
| Memory | POSITIVE — 3,650-line module dropped from heap |
| Startup | NEUTRAL — ControllerRegistry init timing unchanged |

### Dead code verification (hive finding)

All 64 memory-bridge.ts exports verified dead:
- 10 functions called only by memory-initializer (removed in Phase 2)
- 54 functions with zero external references
- 0 still-alive exports that would block deletion

### Scope classification

| Gap | Achievable now | Blocked by |
|-----|---------------|------------|
| 1. Delete memory-bridge.ts | **Yes** — move getRegistry() to router | — |
| 2. Remove initializer bridge dep | **Yes** — delete 11 getBridge() calls (~136 lines) | — |
| 3. Delete AgentDBService | **Deferred** | Upstream merge policy (separate decision) |
| 4. Single bootstrap path | **Yes** — getRegistry() in router replaces bridge bootstrap | — |
| 5. Zero bridge fallbacks | **Yes** — remove try-first blocks, fallbacks already work | — |
| 6. Reduce data flow layers | **Partial** — removing bridge eliminates one hop; full L1 ideal (Controller → IStorage) requires RVF storage work | L1 (ADR-0075) |

## Decision

Close gaps 1, 2, 4, and 5 by deleting memory-bridge.ts and removing all bridge
dependencies from memory-initializer.ts. Defer gap 3 (AgentDBService) as an upstream
merge policy decision. Accept gap 6 partially — the bridge hop is eliminated but the
initializer hop remains until L1 storage work.

## Tasks

### Phase 1: Move ControllerRegistry bootstrap to router

- [ ] **T1.1** Extract `getRegistry()` (~226 lines including 8 helper functions) from
  memory-bridge.ts into memory-router.ts as `initControllerRegistry()`. Includes:
  `readProjectConfig`, `getProjectConfig`, `findProjectRoot`, `readJsonFile`,
  `getDbPath`, `getConfigSwarmDir`, `ensureExitHook`, and 5 module-level variables.
- [ ] **T1.2** Wire `initControllerRegistry()` into `ensureRouter()` — call after
  storage init, before route methods become available. Handle console suppression
  carefully: the 120s timeout must not silence unrelated CLI output.
- [ ] **T1.3** Resolve dual-registry conflict: ensure the router's `registryInstance`
  is the SAME instance that controller-intercept uses. Options: (a) router exports
  the registry and intercept reads it, (b) intercept initializes via router instead
  of bridge, (c) router calls intercept's init with its own registry. Must be exactly
  one ControllerRegistry instance per process.
- [ ] **T1.4** Update `getController()` to use the router-local registry instead of
  controller-intercept if the registry is available (controller-intercept becomes
  the fallback, not the primary).
- [ ] **T1.5** Unit + integration tests: registry bootstrap in router, getController
  resolves from local registry, no dual-instance creation.

### Phase 2: Remove memory-initializer bridge dependency

Remove all 11 `getBridge()` calls. Each follows the same pattern: try bridge function,
fall back to local code. Removing the try-bridge block leaves only the local code.

- [ ] **T2.1** Delete `getBridge()` helper and `_bridge` variable from memory-initializer.ts
- [ ] **T2.2** Remove 11 try-bridge blocks:

| Line | Bridge function | Try-block size |
|------|-----------------|----------------|
| 629 | bridgeAddToHNSW | 7 lines |
| 666 | bridgeSearchHNSW | 7 lines |
| 1227 | getControllerRegistry | 19 lines |
| 1722 | bridgeLoadEmbeddingModel | 14 lines |
| 1956 | bridgeGenerateEmbedding | 32 lines |
| 2328 | bridgeStoreEntry | 8 lines |
| 2457 | bridgeSearchEntries | 11 lines |
| 2620 | bridgeListEntries | 8 lines |
| 2721 | bridgeGetEntry | 8 lines |
| 2821 | bridgeDeleteEntry | 22 lines |

- [ ] **T2.3** Remove `activateControllerRegistry()` from memory-initializer.ts —
  the router now handles registry bootstrap (Phase 1).
- [ ] **T2.4** Unit + integration tests: all CRUD operations work without bridge.

### Phase 3: Delete memory-bridge.ts

- [ ] **T3.1** Delete `memory-bridge.ts` (3,650 lines)
- [ ] **T3.2** Remove any remaining `memory-bridge` comment references from:
  memory-router.ts, memory-initializer.ts, ewc-consolidation.ts, intelligence.ts,
  agentdb-orchestration.ts
- [ ] **T3.3** Update acceptance checks: ADR-0084-4 (bridge loader) and ADR-0084-8
  (controller fallback) to reflect bridge absence
- [ ] **T3.4** Final acceptance: `grep -r "memory-bridge" cli/src/ --include="*.ts"`
  returns zero hits in production code

### Phase 3.5: Test cleanup (14 files affected)

The bridge deletion breaks 14 test files. Categorized by action:

**Delete entirely (3 files):**
- [ ] **T3.5.1** `memory-bridge-activation.test.mjs` — tests bridge activation directly
- [ ] **T3.5.2** `adr0084-router-phase2.test.mjs` — Phase 2 bridge loader tests (superseded by Phase 4)
- [ ] **T3.5.3** `tests/fork/cli/memory-bridge-activation.test.ts` — fork-level bridge tests

**Remove describe blocks (5 files):**
- [ ] **T3.5.4** `adr0076-phase3-wiring` — bridge-specific wiring checks
- [ ] **T3.5.5** `adr0080-maxelements` — 3 bridge-dependent describe blocks
- [ ] **T3.5.6** `sqlite-pragma-adr0069` — bridge pragma checks
- [ ] **T3.5.7** `config-centralization-adr0065` — bridge config reads
- [ ] **T3.5.8** `memory-router-adr0077` — bridge import pattern checks

**Rewrite mocks (4 files):**
- [ ] **T3.5.9** `hooks-tools-activation.test.mjs` — 30+ bridge references → router mocks
- [ ] **T3.5.10** `controller-chaos.test.mjs` — bridge chaos injection → router
- [ ] **T3.5.11** `tests/fork/cli/agentdb-tools-activation.test.ts` — bridge mocks
- [ ] **T3.5.12** `tests/fork/cli/hooks-tools-activation.test.ts` — bridge mocks

**Keep as negative tests (2 files):**
- `adr0083-migrations.test.mjs` — assertions that files do NOT import deleted module (still valid)
- `adr0084-router-phase4.test.mjs` — Phase 4 tests remain valid (they test router, not bridge)

### Phase 4: Tests and verification

- [ ] **T4.1** Full unit suite passes (adjusted count after test file deletions)
- [ ] **T4.2** Build produces zero new errors
- [ ] **T4.3** Acceptance checks pass (all ADR-0084 + new ADR-0085 checks)
- [ ] **T4.4** New acceptance checks: ADR-0085-1 (bridge absent from dist),
  ADR-0085-2 (initializer zero bridge imports), ADR-0085-3 (router has initControllerRegistry)
- [ ] **T4.5** Update ADR-0076 and ADR-0084 completion notes

## Lines eliminated

| Source | Lines |
|--------|-------|
| memory-bridge.ts (deleted) | 3,650 |
| memory-initializer.ts getBridge + 11 try-blocks | ~136 |
| activateControllerRegistry | ~30 |
| writeJsonSidecar + call sites (sidecar elimination) | ~46 |
| **Total deleted** | **~3,862** |
| getRegistry() + helpers moved to router (relocated, not deleted) | ~272 |
| **Net production reduction** | **~3,590** |
| Test lines removed (sidecar tests + bridge tests) | ~2,280 |

## Swarm implementation plan

### Topology: Hierarchical (7 agents)

```
                    coordinator
                        │
          ┌─────────────┼─────────────┐
          │             │             │
   registry-mover  test-writer  acceptance-updater
     (Phase 1)    (Phases 1-3)   (Phases 3-4)
          │
   init-cleaner
     (Phase 2)
          │
   bridge-deleter
     (Phase 3)
          │
   test-cleaner
    (Phase 3.5)
          │
   build-verifier
     (Phase 4)
```

### Execution sequence

| Step | Parallel agents | Tasks |
|------|----------------|-------|
| 1 | registry-mover | T1.1-T1.4 (extract getRegistry + helpers, wire into router) |
| 1 | test-writer (stub) | Begin writing Phase 1 test factories |
| 2 | init-cleaner | T2.1-T2.4 (remove 11 getBridge calls) — blocked on Step 1 |
| 2 | test-writer | Write Phase 2 integration tests |
| 3 | bridge-deleter | T3.1-T3.4 (delete file, clean comments) — blocked on Step 2 |
| 3 | acceptance-updater | T3.3, T4.4 (update acceptance checks) |
| 4 | test-cleaner | T3.5.1-T3.5.12 (fix 14 broken test files) — blocked on Step 3 |
| 5 | build-verifier | T4.1-T4.5 (build, test, verify) — blocked on Step 4 |

## What this does NOT address

- **Layer 1 (RVF primary storage)** — memory-initializer.ts remains as the SQLite CRUD
  layer. Replacing it with IStorage + NativeStorage(RVF+HNSW) is a separate, larger effort
  (~2,600 lines to rewrite). That is the remaining gap to ADR-0075's full ideal.

## Resolved post-proposal

- **AgentDBService deletion** — RESOLVED. Investigation revealed no concrete
  `AgentDBService` class exists in the codebase. The term referred to a conceptual
  role that was never implemented. The only reference was a 2-line comment in
  `controller-intercept.ts`, which has been updated. The `IAgentDBService` interface
  in gastown-bridge is a separate, live plugin contract — unrelated.
- **JSON sidecar elimination** — RESOLVED (Path A). Converted `hook-handler.cjs` to
  ESM (`.mjs`) with `await import()`, added `readStoreFromDb()` to `intelligence.cjs`
  for direct SQLite reads via better-sqlite3, deleted `writeJsonSidecar()` from the
  router (46 lines), updated `statusline.cjs` to use SQLite `COUNT(*)`, and updated
  all 3 init generators. The `auto-memory-store.json` file is no longer written or read.
  Note: `pending-insights.jsonl` is NOT a sidecar — it is a write-ahead event journal
  (primary store for pending edit events, truncated on consolidation). No action needed.

## Consequences

- **~3,588 net production lines eliminated** from the codebase
- **Single registry bootstrap** — router owns it, no dual-path confusion
- **Zero bridge code executed** at runtime (11 try-first paths eliminated)
- **Cleaner initializer** — memory-initializer is pure SQLite CRUD, no AgentDB coupling
- **No JSON sidecar** — intelligence reads SQLite directly, no redundant file-based IPC
- **ESM hook handler** — unblocks future async hook improvements
- **ADR-0075 gap closure**: L2 100%, L5 ~95% (initializer hop remains until L1)
- **Merge risk**: upstream changes to memory-bridge.ts will cause git conflicts on the
  deletion. This is a one-time cost — once merged, the file stays deleted and future
  upstream changes to it are irrelevant (we never executed them anyway).

## Architecture after ADR-0085

```
ALL callers ──→ memory-router.ts ──→ initControllerRegistry() ──→ ControllerRegistry (sole bootstrap)
                    │                         │
                    │                         └── getController() ──→ controllers
                    │
                    ├── routeMemoryOp()       → storeEntry() → SQLite
                    ├── routeEmbeddingOp()    → EmbeddingPipeline → HNSW
                    ├── routePatternOp()      → reasoningBank (controller-direct)
                    ├── routeFeedbackOp()     → learningSystem + reasoningBank
                    └── routeSessionOp()      → reflexion + nightlyLearner

hook-handler.mjs ──→ import() ──→ intelligence.cjs ──→ better-sqlite3 ──→ memory.db (direct read)

memory-bridge.ts:       DELETED
memory-initializer.ts:  Pure SQLite CRUD (zero bridge dependency)
writeJsonSidecar:       DELETED (sidecar file no longer written)
AgentDBService:         Never existed as a class (comment reference removed)
```
