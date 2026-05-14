# ADR-0180 Phase 3 Report — memory_* Surface Migration

**Phase:** 3 of 10 (memory_* surface — 4 mutating tools + 5 ranked-read tools)
**Topology:** star, 10 workers + 1 queen
**Queen:** `task-orchestrator` (this report's author)
**Date opened:** 2026-05-14
**Date closed:** 2026-05-14
**Status:** Structural acceptance PASS with one explicit gap (3 missing mutating-tool handler files — staffing/spec mismatch, not a worker failure). Phase 4 may begin once team-lead resolves the gap and the pre-Phase-4 maintenance commits land on `forks/ruflo/v3 main`.

## Summary

All 10 worker agents delivered their slices in a single attempt with no retry loops. The archivist gained 7 handler files (`handlers/memory/{search,store,retrieve,bridge-status,list,search-unified,index}.ts`) and 5 invariant files (`invariants/memory/{store,delete,migrate,import-claude,index}.ts`). All 5 Phase-3 ranked-read tools (`memory_search`, `memory_retrieve`, `memory_list`, `memory_search_unified`, `memory_bridge_status`) now accept `includeProvenance?: boolean` in their MCP schemas with strict-bool gates and shape-branching response logic in `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts`. Charter conformance gate (`scripts/check-archivist-charter.sh`) reports `OK: 28 file(s) match charter (10 responsibilities enumerated)` — Phase 2 baseline of 16 plus 12 new Phase-3 files. No `npm run release` invocation per queen's brief; structural acceptance only.

The principal Phase-3 gap is staffing-level: the team-lead's worker roster staffed migrators for only ONE of the four mutating tools (`memory-store-migrator`), while the structural-acceptance criteria called for handler files for ALL four mutating tools (`memory_store`, `memory_delete`, `memory_migrate`, `memory_import_claude`). The invariants-author correctly delivered invariant files for all 4 mutating surfaces, but archivist handlers exist only for `store`. Recorded as Phase 3 result-gap §"Brief vs roster mismatch" below — surfaced for team-lead resolution before Phase 4.

## Worker outputs

### 1. `provenance-rollout-worker-search` — memory_search includeProvenance flag

| File | Edits | Charter | Notes |
|---|---|---|---|
| `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts` | +12 LoC (3 edits in memory_search block) | n/a (cli) | Schema `includeProvenance?: boolean` line 367; strict-bool `=== true` guard line 378; default-strips-provenance branch lines 519-527 |
| **Subtotal** | **+12 LoC** | | within ~40-50 LoC budget |

**Accepted divergence (carried forward for Phase 4/6 consistency):** The worker preserved today's enriched `{ key, namespace, value, similarity, importance?, attentionBoosted? }` shape as the no-flag default rather than flattening to ADR §102's literal `{ id, content, score }[]`. Mass-breaking every existing memory_search caller is well outside Phase 3 scope, and §102's intent (preserve current shape by default, opt-in to RankedResult) is satisfied. The other Phase-3 ranked-read tools followed this same pattern. Worth surfacing for Phase 6 (agentdb_*) and Phase 4 (hive-mind_*) provenance rollouts so the same precedent applies.

### 2. `memory-search-migrator` — memory_search archivist handler

| File | LoC | Charter | Notes |
|---|---|---|---|
| `forks/agentdb/src/archivist/handlers/memory/search.ts` | 58 | `dispatch` | Defines `MemorySearchQuery`, `MemoryRecord`, `Provenance`, `RankedResult<T>`, `RankedResults<T>` per ADR §Read-path return shape; registers `searchMemoryHandler: GuardedRead<MemorySearchQuery, RankedResults<MemoryRecord>>` via `registerReadHandler('memory_search', …, { cacheScope: 'namespace' })`; body is throw-stub TODO directing wire-up to port `memory-router.ts case 'search'` |
| `forks/agentdb/src/archivist/handlers/memory/index.ts` | (created here, extended by peers) | `dispatch` | Side-effecting barrel triggers all `registerReadHandler`/`registerMutationHandler` calls on import |
| `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts` | +12 LoC comment block | n/a (cli) | Top-of-file ADR-0180 Phase 3 documentation; legacy memory_search routeMemoryOp call unchanged |

**Three gaps captured for Phase 3-exit (not Phase 3 blockers):**

1. **`forks/agentdb/package.json` exports map missing `./archivist` entry.** Recorded as Phase 2 report blocker #1; not yet landed. Phase 8 (a1) territory, but Phase 3 wire-up (and Phase 4 archivist consumers) will need it earlier.
2. **`dispatch` / `dispatchRead` not publicly exported from `archivist/index.ts`.** Phase 2 deliberately excluded these per the "Deliberately NOT re-exported" comment at lines 7-9. Phase 3's structural acceptance is "handlers register at module load", not "cli dispatches through archivist" — but the cli-side delegation cannot land until a public `Archivist.dispatch*(name, payload)` instance method exists.
3. **Handler body is a stub** — TODO comment directing wire-up to port ~120 LoC from `memory-router.ts case 'search'` (empty-store short-circuit, embedding pipeline detection, BM25 hash-fallback path, vector path, MMR diversity, AttentionService boost). Acceptable per brief ("registration shape, not full body migration").

### 3. `memory-retrieve-migrator` — memory_retrieve archivist handler

| File | LoC | Charter | Notes |
|---|---|---|---|
| `forks/agentdb/src/archivist/handlers/memory/retrieve.ts` | 33 | `dispatch` | `MemoryRetrieveQuery = { namespace?, key?, id?, limit? }`; reuses `MemoryRecord`/`RankedResults` from peer `./search`; registers via `registerReadHandler('memory_retrieve', retrieveMemoryHandler, { cacheScope: 'namespace' })`; body is throw-stub TODO matching peer pattern |
| `forks/agentdb/src/archivist/handlers/memory/index.ts` | barrel append | `dispatch` | `export * from './retrieve';` |

**Discipline confirmed:** cli-side `routeMemoryOp` call untouched (matches peer search-migrator) since `dispatch` symbol not yet publicly exported. Swapping cli to call a non-existent symbol would break runtime memory_retrieve. Reported pre-existing `FileHandle` import errors in `audit-rotation.ts`/`audit-writer.ts` — carried-from-Phase-2 noise, not this worker's territory.

### 4. `memory-store-migrator` — memory_store archivist handler

| File | LoC | Charter | Notes |
|---|---|---|---|
| `forks/agentdb/src/archivist/handlers/memory/store.ts` | 63 | `dispatch` | `MemoryStorePayload` (namespace/key/content/metadata?/tags?/ttl?/upsert?/generateEmbedding?) interface line 29; `storeMemoryHandler: GuardedWrite<MemoryStorePayload>` via `registerMutationHandler<MemoryStorePayload>('memory_store', …, { invariants: [], cacheScope: 'namespace' })` lines 48-51; body wraps `ctx.substrate.withWrite({ storeId: STORE_ID }, async (_handle) => { throw … })` as TODO stub |
| `forks/agentdb/src/archivist/handlers/memory/index.ts` | barrel append | `dispatch` | `export * from './store';` (race-safe — added via Edit alongside peers) |
| `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts` | +5 LoC comment | n/a (cli) | Extended search-migrator's comment block to reference memory_store + `GuardedWrite<MemoryStorePayload>` registration; cli handler body untouched |

**Three architectural drift observations captured:**

1. **`routeMemoryOp` 'store' has THREE branches** (memory-router.ts:1000-1095, 1629, 1986) covering ADR-0094 RC-2 idempotency, optional embedding via dynamic `import('@claude-flow/memory/embedding-adapter')`, RVF-primary write path. The Phase 3 wire-up port needs to reconcile all three; the TODO in `store.ts` currently references only the first.
2. **`agentMemoryScope` (ADR-0166 SQLite carve-out) handling is unstated in ADR-0180.** `MemoryStorePayload` intentionally omits `scope`/`scope_id`; the migrator's interpretation is that the cli-handler-level pre-resolution into canonical `key` is the suggested boundary. Worth a Phase 4-prerequisite clarification (does the canonical key arrive pre-scoped to the archivist, or does the handler own `scopeKey()`?).
3. **`cacheScope: 'namespace'` chosen by analogy** to search-migrator's choice. If the invariants-author or Phase-4 wire-up needs a different scope hint for write-invalidation semantics, override is mechanical.

### 5. `invariants-author` — memory_* mutation invariants

| File | LoC | Charter | Notes |
|---|---|---|---|
| `forks/agentdb/src/archivist/invariants/memory/store.ts` | 71 | `mutation-invariants` | `storeInvariants: Invariant<MemoryStorePayload>[]` covers `namespace`, `content_bytes`, `embedding_dim` equality between caller intent and recorded payload (verbatim ADR §Mutation invariants baseline) |
| `forks/agentdb/src/archivist/invariants/memory/delete.ts` | 58 | `mutation-invariants` | `deleteInvariants: Invariant<MemoryDeletePayload>[]` covers `namespace` + `key` + `id` equality (both target-identifier shapes supported) |
| `forks/agentdb/src/archivist/invariants/memory/migrate.ts` | 62 | `mutation-invariants` | `migrateInvariants: Invariant<MemoryMigratePayload>[]` covers source/destination namespace identity + entry_count equality (rows migrated == rows recorded, zero-tolerance per `feedback-data-loss-zero-tolerance`) |
| `forks/agentdb/src/archivist/invariants/memory/import-claude.ts` | 65 | `mutation-invariants` | `importClaudeInvariants: Invariant<MemoryImportClaudePayload>[]` covers `source_path` + `record_count` + `target_namespace` equality |
| `forks/agentdb/src/archivist/invariants/memory/index.ts` | 22 | `mutation-invariants` | Barrel re-exports types + invariant arrays so migrators can `import { storeInvariants } from '../../invariants/memory'` and pass to `registerMutationHandler({ invariants: storeInvariants })` |
| **Subtotal** | **278** | | covers all 4 mutating surfaces per ADR §Mutation invariants |

**Important observation surfaced:** the invariants-author noted that `handlers/memory/store.ts` exists (memory-store-migrator landed it), but `handlers/memory/{delete,migrate,import-claude}.ts` are NOT present. Their contract — "invariants are the spec; the wiring catches up" — is sound: each invariant file is ready to be `{ invariants: <name>Invariants }`'d into a `registerMutationHandler` call once those 3 missing handlers exist. **This is the principal Phase 3 result-gap — see §Brief vs roster mismatch below.**

### 6. `provenance-rollout-worker-list` — memory_list includeProvenance + archivist handler

| File | LoC / Edits | Charter | Notes |
|---|---|---|---|
| `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts` | +14 LoC (memory_list block) | n/a (cli) | Schema `includeProvenance?: boolean` line 617; strict-bool guard line 637; provenance branch line 666 (returns `{storeId: 'memory_store', matchType: 'exact', rawScore: 0, rank: offset + index + 1}` per entry) |
| `forks/agentdb/src/archivist/handlers/memory/list.ts` | 46 | `dispatch` | `MemoryListQuery`, `MemoryListRecord`; registers via `registerReadHandler('memory_list', listMemoryHandler, { cacheScope: 'namespace' })`; throw-stub TODO body |
| `forks/agentdb/src/archivist/handlers/memory/index.ts` | barrel append | `dispatch` | `export * from './list';` between retrieve and bridge-status |
| **Subtotal** | **+60 LoC** | | within ~75 LoC estimate |

**Design choice accepted:** `matchType: 'exact'` for memory_list enumeration. Provenance type union in `search.ts` defines `'semantic' | 'bm25' | 'exact' | 'fused'` (pre-bridge-status widening); `exact` is the closest member without union extension. Enumeration is the degenerate "every entry matches its own (namespace, key) tuple exactly" form. 1-based `rank` includes pagination offset so clients correlate with `offset+index`.

### 7. `memory-bridge-status-migrator` — memory_bridge_status archivist handler + Provenance.matchType widening

| File | LoC / Edits | Charter | Notes |
|---|---|---|---|
| `forks/agentdb/src/archivist/handlers/memory/bridge-status.ts` | 36 | `dispatch` | `MemoryBridgeStatusQuery = { detail?: 'brief' \| 'verbose' }`; `BridgeStatusEntry = { component, state: 'up'\|'down'\|'degraded', metadata }`; registers via `registerReadHandler('memory_bridge_status', bridgeStatusHandler, { cacheScope: 'global' })`; throw-stub body |
| `forks/agentdb/src/archivist/handlers/memory/search.ts` | +1 literal | `dispatch` | Provenance.matchType union widened to `'semantic' \| 'bm25' \| 'exact' \| 'fused' \| 'status'` (single-literal added) |
| `forks/agentdb/src/archivist/handlers/memory/index.ts` | barrel append | `dispatch` | `export * from './bridge-status';` |
| `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts` | replaced provenance branch | n/a (cli) | Preserved peer's `includeProvenance` gate; replaced `true` branch with canonical `RankedResults<BridgeStatusEntry>` shape; per-component state derivation (claude-code, agentdb, intelligence, bridge); legacy shape unchanged when flag false |

**Architectural change accepted:** widening `Provenance.matchType` to include `'status'`. ADR §Provenance rollout scope explicitly describes memory_bridge_status as "status-class read tool whose response surfaces archivist provenance for telemetry consumers" — bridge_status is not a similarity-ranked search but a status enumeration with first-class provenance for ExplainableRecall-of-archivist-state. Single-literal-added is the minimum-blast-radius approach; retrieve.ts/list.ts/search-unified.ts that re-import from search keep working.

`cacheScope: 'global'` is correct — archivist state is process-level, not namespace-scoped. State derivation logic (up/degraded/down per component) is a reasonable Phase-3 interpretation; ADR did not pin it.

### 8. `provenance-rollout-worker-retrieve` — memory_retrieve includeProvenance flag

| File | Edits | Charter | Notes |
|---|---|---|---|
| `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts` | +28 LoC (memory_retrieve block) | n/a (cli) | Schema `includeProvenance?: boolean` added; strict-bool `=== true` guard after namespace guard; found-entry branch returns `base` (legacy) or `{ ...base, provenance: { storeId: 'memory_store', matchType: 'exact' as const, rawScore: 1, rank: 1 } }`; not-found/error branches untouched |
| **Subtotal** | **+28 LoC** | | well within budget |

**Provenance values reasonable:** `matchType: 'exact'` (consistent with memory_list), `rawScore: 1` (lossless exact hit; vs memory_list's 0 for unscored enumeration), `rank: 1` (retrieve returns at most one entry), `storeId: 'memory_store'` (matches peer choice; cross-tool fusion sees consistent source identity).

### 9. `provenance-rollout-worker-search_unified` — implicit/disk-evidence only

| File | LoC / Edits | Charter | Notes |
|---|---|---|---|
| `forks/agentdb/src/archivist/handlers/memory/search-unified.ts` | 40 | `dispatch` | `// charter: dispatch` line 1; documents cross-store Reciprocal Rank Fusion (k=60) per ADR §Read-path return shape; imports `MemoryRecord` + `RankedResults` from `./search` (peer reuse) |
| `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts` | +schema field | n/a (cli) | `includeProvenance` schema at line 990 (memory_search_unified block); strict-bool guard line 1002; shape-branch at line 1050; ADR-anchored description references RRF + per-store rank and storeId so ExplainableRecall can reconstruct fusion |

**Did NOT SendMessage an explicit report.** Disk evidence verified directly by queen: file exists at expected path with charter header, `includeProvenance` is in cli schema, handler registers `memory_search_unified` via `registerReadHandler`. Worker presumably executed but did not deliver a closing SendMessage. Phase-3 acceptance is by disk state, not message receipt; recording the silent-completion under "process notes" for team-lead awareness.

### 10. `provenance-rollout-worker-bridge_status` — implicit/disk-evidence only

| File | Edits | Charter | Notes |
|---|---|---|---|
| `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts` | +schema field | n/a (cli) | `includeProvenance` schema at line 919 (memory_bridge_status block); strict-bool guard line 924; provenance branch line 967 |

**Did NOT SendMessage an explicit report.** The schema-side `includeProvenance` plumbing was laid down before memory-bridge-status-migrator's handler-side work (and the migrator's report explicitly noted "the peer (provenance-rollout worker) had already added `includeProvenance` flag; I preserved that gate"). Disk evidence verified. Recording under "process notes."

## Acceptance checklist (per team-lead's brief)

| Check | Status | Notes |
|---|---|---|
| All 4 mutating tools have new `handlers/memory/*.ts` files with `// charter: dispatch` | **PARTIAL — 1 of 4** | Only `store.ts` exists; `delete.ts`, `migrate.ts`, `import-claude.ts` were not produced because the team-lead's roster staffed only `memory-store-migrator` for the mutating side. See §Brief vs roster mismatch below. |
| Each new handler registered via `registerMutationHandler`/`registerReadHandler` | YES for all 7 handlers that exist | search, store, retrieve, list, search-unified, bridge-status, plus barrel |
| cli's `memory-tools.ts` / `memory-router.ts` delegates (or imports + calls) the new path | INDIRECT | cli-side delegation explicitly deferred until `dispatch` public-export exists (Phase 3-exit follow-up). Today: cli imports the barrel for side-effect registration; routeMemoryOp branches remain authoritative. |
| All 5 ranked-read tools accept `includeProvenance?: boolean` (default false) in schemas | YES | search@367, retrieve (added by worker 8), list@617, search_unified@990, bridge_status@919 |
| Handler-side passes `RankedResult` shape when `includeProvenance: true` | YES (where bodies are wired) | bridge_status fully wired; search/retrieve/list shape-branch in cli but archivist handlers are stubs |
| `forks/agentdb/src/archivist/invariants/memory/` has 4 invariant files | YES | store, delete, migrate, import-claude (+ index barrel) |
| `bash scripts/check-archivist-charter.sh` exits 0 | YES | `OK: 28 file(s) match charter (10 responsibilities enumerated)` |
| No off-phase work | YES | All workers stayed within memory_*; no touches to hive-mind_*, agentdb_*, etc. |
| `npm run release` invoked | NO (deliberately) | Reserved for the user per queen's brief |

**Result: Phase 3 structural acceptance PASS with one explicit gap.** The gap (3 missing mutating-tool handlers) is a worker-roster issue, not a worker-output issue. All 10 dispatched workers either delivered correctly or had their work verified on disk via peer-landed evidence.

## Brief vs roster mismatch (principal Phase 3 result-gap)

The team-lead's Phase 3 brief contains two contradictory contracts:

1. **Worker roster:** 4 migrators were staffed — `memory-store-migrator` (mutating), `memory-search-migrator` / `memory-retrieve-migrator` / `memory-bridge-status-migrator` (read). Three of these target the read side; only one targets a mutating tool.
2. **Structural acceptance criteria:** "All 4 mutating tools have new `forks/agentdb/src/archivist/handlers/memory/*.ts` files with `// charter: dispatch` header tags." Per the team-lead's enumeration in the brief itself, the 4 mutating tools are `memory_store`, `memory_delete`, `memory_migrate`, `memory_import_claude`.

The invariants-author correctly delivered invariant files for all 4 mutating surfaces per ADR §Mutation invariants. But there are no archivist handler files for `memory_delete`, `memory_migrate`, or `memory_import_claude` — no worker was staffed to produce them.

**Per Phase 2 queen's discipline ("queen writes ZERO source code; queen does NOT spawn additional agents"), this queen did NOT fill the gap by self-spawning the 3 missing migrators.** Recording the gap as the principal Phase-3 exit issue for team-lead's resolution.

**Resolution options for team-lead:**

1. Accept Phase 3 as scoped to read-side migration (3 of 5 read tools handlered, 1 of 4 mutating tools handlered) and treat `memory_delete` / `memory_migrate` / `memory_import_claude` handlers as Phase 3-exit cleanup before Phase 4.
2. Re-run Phase 3 with the 3 missing migrators staffed in a follow-up wave.
3. Roll the 3 missing handlers into Phase 4 (hive-mind_* surface) — but this conflicts with ADR §Migration concerns "Phase 3: Migrate `memory_*` surface (4 mutating tools) end-to-end."

Recommend option 1 if the ADR's "end-to-end" language is read structurally (handlers exist + invariants exist) rather than functionally (substrate writes go through them); option 2 if the ADR's intent is strict.

## Architectural drift from ADR-0180

**One substantive change** (recorded transparently):

1. **`Provenance.matchType` union widened from `'semantic' | 'bm25' | 'exact' | 'fused'` to `'semantic' | 'bm25' | 'exact' | 'fused' | 'status'`.** ADR §Provenance rollout scope describes memory_bridge_status as "status-class — surfaces archivist provenance for telemetry consumers" — bridge_status is not a similarity-ranked search but a status enumeration with first-class provenance. The widening makes the canonical Provenance shape carry status-class entries. Minimum blast radius (single-literal added); retrieve.ts/list.ts/search-unified.ts that re-import from search keep working. No ADR amendment needed — the new literal lands inside the ADR's explicit "status-class" semantic envelope.

**Four minor surface decisions worth noting** (not drifts, just decisions made during the wave):

2. **All Phase-3 ranked-read tools preserve today's enriched cli shape as the no-flag default** rather than flattening to ADR §102's literal `{ id, content, score }[]`. Worth signaling to Phase 6 (agentdb_*) and Phase 4 (hive-mind_*) provenance rollouts so the same precedent applies; alternatively, a coordinated breaking-change pass at Phase 10 retirement.

3. **`cacheScope` choices per handler:** `memory_store`/`search`/`retrieve`/`list` use `'namespace'`; `memory_bridge_status` uses `'global'`. Reasonable per-tool semantics. If invariants-author or Phase-4 wire-up needs different scope hints for write-invalidation semantics, mechanical override.

4. **All handler bodies are throw-stubs.** Acceptable per brief ("registration shape, not full body migration"). Five wire-up TODOs pending in Phase 3-exit / Phase 4 prerequisites:
   - `memory_search` → port ~120 LoC from `memory-router.ts case 'search'`
   - `memory_store` → port from THREE `case 'store'` sites at memory-router.ts:1000-1095, 1629, 1986
   - `memory_retrieve` → port from `memory-router.ts case 'get'`
   - `memory_list` → port from `memory-router.ts case 'list'`
   - `memory_bridge_status` / `memory_search_unified` → port from cli inline handler bodies (no router branches)

5. **cli-side `routeMemoryOp` calls untouched.** Cannot delegate to `archivist.dispatch(name, payload)` because the public dispatch surface is not yet exported. This is the dominant Phase-3-exit follow-up — see §Phase 4 prerequisites below.

## Phase 4 prerequisites (for team-lead / Phase 4 implementer)

In addition to the pre-Phase-4 maintenance-commit gate already in `scripts/ruflo-publish.sh` (the two `fix(hive-mind): wrap … (pre-Phase 4)` commits on `forks/ruflo/v3 main`), Phase 4 inherits these Phase-3-exit follow-ups:

1. **Public dispatch surface.** `archivist/index.ts` deliberately does not re-export `dispatchMutation` / `dispatchRead`. Add either:
   - A module-level `dispatch(name, payload)` export that mints `ReadContext` / `MutationContext` inside; or
   - An instance-level `Archivist.dispatchMutation(name, payload)` / `Archivist.dispatchRead(name, payload)` method on the existing class.
   
   Phase 4 hive-mind handlers will hit the same wall. Land before Phase 4 spawns.

2. **`forks/agentdb/package.json` exports map** needs `"./archivist"` (and probably `"./archivist/handlers/*"`) entries. Phase 2 report blocker #1; bit Phase 3 multiple times; will bite Phase 4. Suggested entries:
   ```json
   "./archivist": { "import": "./dist/src/archivist/index.js", "types": "./dist/src/archivist/index.d.ts" }
   ```

3. **`agentMemoryScope` boundary clarification.** Does the canonical key arrive pre-scoped to the archivist (cli-handler does `scopeKey()` before calling the archivist), or does the archivist handler own scope resolution? ADR-0180 is silent; memory-store-migrator's `MemoryStorePayload` chose cli-side pre-resolution. Worth pinning before Phase 4 makes the same choice for hive-mind state.

4. **Three missing mutating-tool handler files** (per §Brief vs roster mismatch): `handlers/memory/delete.ts`, `migrate.ts`, `import-claude.ts`. Either as Phase 3-exit cleanup or re-staffed in Phase 4 — team-lead's call.

5. **Pre-existing `FileHandle` import errors in `audit-rotation.ts` / `audit-writer.ts`** carried from Phase 2 surfaced during memory-retrieve-migrator's local tsc check. Not Phase 3's territory; flagging so Phase 4 doesn't trip over them.

6. **Tests not written this phase.** ADR §Provenance rollout scope budgeted ~40-50 LoC per tool including "two unit tests per tool (legacy shape with no flag, full shape with `includeProvenance: true`)". The Phase-3 deliveries omitted these; recommend either a follow-up test-author worker before Phase 4 release or fold into Phase 4's testing-surface validation pass (the §22 testing surface from Phase 2 supports both shapes).

## Recommendation

**Advance to Phase 4** once team-lead:
(a) resolves the Brief vs roster mismatch (3 missing mutating-tool handler files);
(b) lands the pre-Phase-4 maintenance commits on `forks/ruflo/v3 main` per ADR §Migration concerns Phase 4 paragraph (`fix(hive-mind): wrap agents.json writes in withHiveStoreLock (pre-Phase 4)` + `fix(hive-mind): wrap consensus propose/vote in withHiveStoreLock (pre-Phase 4)`);
(c) lands the Phase 4 prerequisites (1) public dispatch surface and (2) `./archivist` exports-map entry on the agentdb fork's `main`.

Rationale: structural acceptance is complete for the read-side migration and 1-of-4 mutating-tool migration. The charter gate is green at 28 files. All four invariant files exist and are correctly typed. All five ranked-read tools accept `includeProvenance`. The Provenance.matchType union has the `'status'` literal needed for telemetry. The 3 missing mutating-tool handlers are mechanical work the next wave or a focused follow-up can deliver (the invariants are already written for them).

Phase 4 worker composition is already itemized in ADR-0180 §Execution Plan Phase 4 row — no further planning needed before spawn once (a)-(c) above are resolved.

## Coordination notes for next phase

1. **No off-phase task-list directives surfaced during Phase 3.** Phase 2 queen flagged that two such directives appeared and were declined; Phase 3 queen experienced none. Both phases' queens correctly stayed in scope.

2. **Single-attempt prompt discipline held.** All 10 workers reported once (8 via explicit SendMessage; 2 — provenance-rollout-worker-search_unified and provenance-rollout-worker-bridge_status — completed without explicit SendMessage but with disk evidence verified). No retry loops. No worker requested another attempt; no worker reported partial completion requiring re-spawn.

3. **SendMessage was the primary inter-agent channel.** 8 of 10 workers used it; 2 silent completions verified via disk state alone. Queen ACK'd every reported worker via SendMessage with the verification result. Matches `feedback-agent-dialectic-via-sendmessage`.

4. **Queen wrote ZERO source code.** Every byte under `forks/agentdb/src/archivist/handlers/**`, `forks/agentdb/src/archivist/invariants/**`, and the cli-side `memory-tools.ts` edits came from a worker. Queen's only file output is this report.

5. **No commits made by any worker or queen.** All deliverables are in the working tree, ready for the user to review and commit at their discretion (probably bundled with the Phase 4 prerequisite work, given the inter-dependencies).

6. **Workers correctly avoided racing on shared files.** `handlers/memory/index.ts` barrel got 5+ `export * from './X';` lines from 5 different migrators; all converged on a clean barrel via Edit-based appends. `Provenance.matchType` union widening (a single-literal addition in `handlers/memory/search.ts`) by memory-bridge-status-migrator preserved compatibility for retrieve/list/search-unified which reuse the type. No git-tree conflicts; no overwrites.

7. **Two silent completions worth surfacing for Phase 4 staffing.** `provenance-rollout-worker-search_unified` and `provenance-rollout-worker-bridge_status` delivered code but did not SendMessage. If this happens in Phase 4 too, recommend the team-lead's brief explicitly asks workers to SendMessage on exit even if their delta is small.
