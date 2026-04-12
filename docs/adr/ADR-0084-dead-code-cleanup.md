# ADR-0084: Dead Code Cleanup — sql.js Ghost References + Bridge Caller Migration

- **Status**: Accepted
- **Date**: 2026-04-12
- **Deciders**: Henrik Pettersen
- **Methodology**: 8-agent hive (storage architect, CJS analyst, performance engineer, merge-conflict strategist, user-impact analyst, 2 devil's advocates, queen synthesis)
- **Depends on**: ADR-0083 (Phase 5 single data flow path)
- **Supersedes**: None

## Context

### Post-Phase 5 state

ADR-0083 Phase 5 centralized all memory operations through `memory-router.ts` and
deleted 3 bridge/shim files (~825 lines). A hive council of ruflo experts audited the
post-Phase 5 codebase and found:

1. **sql.js is structurally dead** — not in package.json, zero imports — but 21 files
   still contain stale string references (user-facing output, comments, descriptions)
2. **4 dead `.save()` guards** in memory-bridge.ts that test for sql.js's `.save()` method,
   which always evaluates false with better-sqlite3
3. **memory-bridge.ts is still required** — 45+ direct callers, 5 router fallback paths
4. **agentdb-orchestration.ts shadows memory-bridge.ts** — 15 functions explicitly labeled
   "Replicates: memory-bridge.ts"
5. **User-facing output is misleading** — `backend: 'sql.js + HNSW'` shown to users when
   the actual backend is better-sqlite3

### Hive findings: what is truly needed

| Component | Verdict | Rationale |
|-----------|---------|-----------|
| **SQLite (better-sqlite3)** | KEEP | Primary store; 2600-line initializer + ControllerRegistry depend on it |
| **sql.js** | ALREADY REMOVED | Not in deps, not imported; only stale strings remain |
| **RVF** | KEEP | Clean role post-Phase 5: hook import writes, bridge search reads |
| **JSON sidecar** | KEEP | Hard CJS boundary; intelligence.cjs cannot use SQLite or RVF |
| **Dual-write (SQLite + JSON)** | KEEP | Necessary while intelligence.cjs is CJS |
| **memory-bridge.ts** | KEEP (defer removal) | 45+ callers; router falls back to it for 5 controller ops |

### Why sql.js references persist

sql.js was the original SQLite implementation (WASM-based). ADR-0080 Phase 4 migrated to
better-sqlite3 via open-database.ts. ADR-0083 Phase 5 deleted open-database.ts entirely.
But neither ADR cleaned up string literals, comments, or user-facing output that still
say "sql.js".

### Specific dead code inventory

**Dead `.save()` guards in memory-bridge.ts** (4 sites):
These check `typeof ctx.db.save === 'function'` — a method that exists on sql.js's
`Database` but not on better-sqlite3's. With sql.js removed, these always evaluate false.

**Stale "sql.js" strings** (21 files):
- `memory-tools.ts` — `backend: 'sql.js + HNSW'` in 6 tool responses
- `guidance-tools.ts` — tool descriptions mentioning sql.js
- `migration-legacy.ts` — user-visible log messages
- `memory-bridge.ts` — comments referencing sql.js flush, WASM db
- Various other files — ADR-era comments

**agentdb-orchestration.ts shadow functions** (15):
Each function header says `// Replicates: memory-bridge.ts bridgeXxx (lines N-M)`.
These are not dead code — they are actively used — but they are a parallel path that
duplicates memory-bridge logic through the router, creating maintenance burden.

## Decision

### Phase 1: Immediate cleanup (zero risk)

Remove dead code and fix misleading output. No behavioral changes.

1. **Remove 4 dead `.save()` guards** in memory-bridge.ts
   - These are `if (typeof ctx.db.save === 'function') ctx.db.save()` blocks
   - Always false with better-sqlite3; removing them has zero runtime effect

2. **Update all "sql.js" strings** to "better-sqlite3" or "SQLite"
   - `backend: 'sql.js + HNSW'` → `backend: 'SQLite + HNSW'` in memory-tools.ts
   - Tool descriptions in guidance-tools.ts
   - Log messages in migration-legacy.ts
   - Comments in memory-bridge.ts and other files

3. **Update user-facing diagnostics**
   - `doctor` command output
   - `memory stats` output
   - MCP tool descriptions that mention sql.js

### Phase 2: Bridge caller migration (medium-term, ADR-0083 Wave 3 scope)

Migrate remaining direct memory-bridge.ts callers to memory-router.ts.

| File | Call sites | Risk | Upstream commits (6 weeks) |
|------|-----------|------|---------------------------|
| `worker-daemon.ts` | 6 | MEDIUM | — |
| `hooks-tools.ts` | 20+ | HIGH | 20 |

This requires adding bridge-equivalent methods to memory-router.ts:
- `bridgeStorePattern` → `routeMemoryOp` (may need pattern metadata support)
- `bridgeRecordFeedback` → new router method
- `bridgeSessionStart/End` → new router method
- `bridgeSelfLearningSearch` → new router method
- `bridgeConsolidate` → new router method

Once all external callers route through memory-router.ts, the router's 5 bridge
fallback paths become the only remaining dependency on memory-bridge.ts.

### Phase 3: Deferred evaluation

- **agentdb-orchestration.ts consolidation**: Evaluate whether the 15 shadow functions
  should be merged back into memory-bridge or replaced by router methods
- **intelligence.cjs ESM migration**: Evaluate whether the CJS hook runner contract
  allows ESM (depends on Claude Code hook runner constraints)
- **memory-bridge.ts removal**: Only possible after Phases 2 and 3 complete

## Implementation Notes

### Phase 1 file inventory

Files requiring "sql.js" string updates (from hive audit):

| File | Type of reference | Change needed |
|------|------------------|---------------|
| `memory-tools.ts` | `backend: 'sql.js + HNSW'` in 6 tool responses | → `'SQLite + HNSW'` |
| `guidance-tools.ts` | Tool descriptions | Update descriptions |
| `migration-legacy.ts` | Log messages | Update messages |
| `memory-bridge.ts` | 4 `.save()` guards + comments | Remove guards, update comments |
| ~17 other files | Comments only | Update or remove |

### Phase 1 estimated effort

- 21 files to update
- ~50 lines of dead code to remove
- ~30 string literal changes
- Zero behavioral impact
- 30 minutes estimated

## Tasks: Path to a Single Controller

### Phase 1: Dead code cleanup (immediate)

- [ ] **T1.1** Remove 4 dead `.save()` guards in `memory-bridge.ts`
- [ ] **T1.2** Update `memory-tools.ts` — change 6 `'sql.js + HNSW'` → `'SQLite + HNSW'`
- [ ] **T1.3** Update `guidance-tools.ts` — fix tool descriptions mentioning sql.js
- [ ] **T1.4** Update `migration-legacy.ts` — fix user-visible log messages
- [ ] **T1.5** Sweep remaining ~17 files for stale sql.js comments
- [ ] **T1.6** Unit tests: verify all 1738 still pass after string changes
- [ ] **T1.7** Acceptance: verify `backend:` output no longer says sql.js

### Phase 2: Router methods for bridge-only functions

Add missing methods to `memory-router.ts` so all callers can use the router:

- [ ] **T2.1** Add `routePatternOp()` — wraps `bridgeStorePattern` / `bridgeSearchPatterns`
- [ ] **T2.2** Add `routeFeedbackOp()` — wraps `bridgeRecordFeedback`
- [ ] **T2.3** Add `routeSessionOp()` — wraps `bridgeSessionStart` / `bridgeSessionEnd`
- [ ] **T2.4** Add `routeLearningOp()` — wraps `bridgeSelfLearningSearch` / `bridgeConsolidate`
- [ ] **T2.5** Add `routeReflexionOp()` — wraps `bridgeReflexionStore` / `bridgeReflexionRetrieve`
- [ ] **T2.6** Add `routeCausalOp()` — wraps `bridgeCausalEdge` / `bridgeCausalRecall`
- [ ] **T2.7** Unit tests for each new router method (London School TDD)
- [ ] **T2.8** Integration tests: verify router methods produce same results as bridge

### Phase 3: Migrate callers to router (Wave 3 scope)

- [ ] **T3.1** Migrate `worker-daemon.ts` — 6 bridge call sites → router
- [ ] **T3.2** Migrate `hooks-tools.ts` — 20+ bridge call sites → router (HIGH risk, defer until upstream stabilizes)
- [ ] **T3.3** Merge or remove `agentdb-orchestration.ts` 15 shadow functions
- [ ] **T3.4** Remove router's 5 bridge fallback paths (once no external callers remain)
- [ ] **T3.5** Unit + integration + acceptance tests for all migrated files

### Phase 4: Single controller (bridge removal)

- [ ] **T4.1** Verify zero external imports of `memory-bridge.ts` (only router uses it internally)
- [ ] **T4.2** Inline remaining bridge logic into router or delete entirely
- [ ] **T4.3** Remove `memory-bridge.ts` from the codebase
- [ ] **T4.4** Final acceptance: single controller path, zero bridge references in dist

### Completion criteria

- All memory operations route through `memory-router.ts` exclusively
- `memory-bridge.ts` deleted or reduced to internal router implementation detail
- Zero direct bridge imports outside of `memory-router.ts`
- All user-facing output says "SQLite" not "sql.js"
- No shadow/duplicate function paths (agentdb-orchestration consolidated)

## Consequences

- Users see accurate backend information ("SQLite + HNSW" not "sql.js + HNSW")
- 50 lines of dead `.save()` code removed
- Clearer codebase — no false signals about sql.js being in use
- Phase 2 migration path documented for hooks-tools.ts (Wave 3)
- No runtime behavioral changes in Phase 1
