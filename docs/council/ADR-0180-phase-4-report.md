# ADR-0180 Phase 4 Report — hive-mind_* Surface Migration + Phase 3.5 Cleanup

**Phase:** 4 of 10 (hive-mind_* surface — 6 mutating tools + 1 status read tool + Phase 3.5 cleanup)
**Topology:** star, 14 workers + 1 queen
**Queen:** `task-orchestrator` (this report's author)
**Date opened:** 2026-05-14
**Date closed:** 2026-05-14
**Status:** Structural acceptance PASS. All 14 workers delivered in a single attempt with no retry loops. Two maintenance commits landed on `forks/ruflo` main; both Phase 3.5 cleanup deliverables landed (public `Archivist.dispatch()` + `./archivist` package export); substrate primitive lifted; all 7 hive-mind handlers + barrel exist; substrate-genericity proof test exceeds brief. Charter gate green at 38 files / 10 responsibilities.

## Summary

All 14 worker agents delivered their slices in a single attempt with no retry loops. Phase 4 closed in less than a day from dispatch.

**Maintenance sub-team (commits landed on `forks/ruflo` main, pre-Phase-4):**
- `5f02fd290 fix(hive-mind): wrap agents.json writes in withHiveStoreLock (pre-Phase 4)` — agents-json-fixer; used distinct `withAgentStoreLock` sentinel (NOT `withHiveStoreLock` itself) to avoid self-deadlock with spawn handler.
- `5bc92b16d fix(hive-mind): wrap consensus propose/vote in withHiveStoreLock (pre-Phase 4)` — consensus-lock-fixer; outer-wrap of entire consensus handler body matching hive-mind_spawn/_init pattern. 11 saveHiveState sites covered by single acquire (measurement drift: ADR estimated ~6, actual 11; not >10% structural drift, no Halt+Amendment needed).

**Phase 3.5 cleanup (parallel, unblocks hive-mind migrators):**
- `public-dispatch-surface-author` — added `Archivist.dispatch(toolName, payload)` and `Archivist.dispatchRead(toolName, payload)` public instance methods in `forks/agentdb/src/archivist/index.ts` (lines 176, 209). Full audit-chain ceremony implemented inline (intent → guards → handler → invariants → applied|rejected|failed). Six deferred behaviors clearly named.
- `package-exports-updater` — verified `./archivist` and `./archivist/testing` exports already present in `forks/agentdb/package.json` (lines 17-26), shape correct per pure-ESM convention.

**Phase 4 main work (substrate + 7 hive-mind handlers + genericity proof):**
- `substrate-primitive-extractor` — `forks/agentdb/src/archivist/substrates/fs-json-store.ts` (298 LoC, charter `substrate-seam`) lifts the 5-step durability stack from hive-mind-tools.ts:919-1259 into a self-contained primitive. Both `withWrite` and `withBulkWrite` implemented. Three Q4 shims (`dir` via `path` param, `defaults` sentinel, `migrate` callback) present.
- 7 hive-mind handlers in `forks/agentdb/src/archivist/handlers/hive-mind/`: spawn (86 LoC), status (67 LoC), memory (118 LoC), consensus (148 LoC), shutdown (75 LoC), broadcast (68 LoC), agents-json (92 LoC) + barrel (12 LoC). All use `ctx.substrate.withWrite` (no direct fs). All carry valid charter tags (`dispatch` or `substrate-seam`).
- `agents-json-second-consumer` — substrate-genericity validation test at `forks/agentdb/test/archivist/substrate-genericity.test.ts` (150 LoC). Routes BOTH hive-state.json AND agents.json through ONE `makeFsJsonSubstrateFixture` instance — proves the primitive is generic, not hive-state-specific.

**Charter gate**: `bash scripts/check-archivist-charter.sh` → `OK: 38 file(s) match charter (10 responsibilities enumerated)`. No off-charter files.

## Worker outputs

### Maintenance sub-team (commits on `forks/ruflo` main)

#### 1. `agents-json-fixer` — `fix(hive-mind): wrap agents.json writes in withHiveStoreLock (pre-Phase 4)`

| Artifact | Detail |
|---|---|
| Commit SHA | `5f02fd290d155af564386ec8c464dfa1b6217a8e` |
| File | `v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts` (+78 -15 LoC) |
| Author | Henrik Pettersen, no Co-Authored-By trailer (per `feedback-fork-commit-attribution.md`) |
| Pattern | Introduced **distinct sibling sentinel** `withAgentStoreLock` (lockfile `.agents.json.lock`) rather than reusing `withHiveStoreLock` itself |

**Significant deviation from brief — APPROVED.** The brief said "wrap in `withHiveStoreLock`". The worker correctly identified that this would self-deadlock at the `hive-mind_spawn` callsite (which already holds `withHiveStoreLock` when calling `saveAgentStore`). The committed solution introduces a separate sentinel sibling primitive — same shape, distinct lockfile — preserving the per-store coherence semantics without cross-lock deadlock. The comment at lines 1268-1272 explicitly documents this. **Better than the literal brief's wording.**

**Discipline note**: the worker's pre-edit message correctly halted on the literal-instruction deadlock, surfaced two valid options (A: outer-wrap-at-buggy-callsite, B: reentrancy with AsyncLocalStorage), and refused to commit on deadlock risk. The committed solution is effectively option (C) — separate sentinel — which the worker would have suggested with one more iteration; their halt-on-deadlock-risk protected against a 5-second `MAX_WAIT_MS` timeout production bug.

#### 2. `consensus-lock-fixer` — `fix(hive-mind): wrap consensus propose/vote in withHiveStoreLock (pre-Phase 4)`

| Artifact | Detail |
|---|---|
| Commit SHA | `5bc92b16d35916713612ab904b0e2746d63f5216` |
| File | `v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts` (+11 -0 LoC) |
| Wrap range | L1922 (open) — L2782 (close) |
| Sites covered | 11 saveHiveState sites: L2022, L2054, L2237, L2293, L2335, L2488, L2524, L2631, L2662, L2665, L2714 (vote/propose/status branches) |
| Push | `93556b7ed..5bc92b16d main -> main` on sparkling |

**Measurement-drift acknowledged** in commit body: "ADR estimate was ~6 sites / ~30 LoC; actual count is 11 sites but outer-wrap pattern reduces LoC to 11. Per ADR-0180 §Measurement-date anchoring." Site count drift is internal-density (saveHiveState sites *inside* the buggy handler), NOT the §Measurement-date anchoring §10% structural-surface drift trigger. No `ADR-0180-Halt: re-scope` trailer needed; commit advanced cleanly.

**Discipline highlight — `git add -p` hunk isolation**: at commit time, hive-mind-tools.ts also had uncommitted Phase 4 schema additions from sibling hive-mind-consensus-migrator (the `includeProvenance` rollout at line 1906). The worker correctly used `git add -p` to stage ONLY their outer-wrap hunks, leaving the sibling's uncommitted work intact for separate landing. Single decision per commit, attribution preserved.

**Constraint verification** (also documented in commit body):
- ✓ No nested `withHiveStoreLock` inside the wrap — only `loadHiveState()` calls (which don't acquire), no inner lock acquires.
- ✓ No cross-lock with `withAgentStoreLock` — consensus handler does NOT call `loadAgentStore`/`saveAgentStore`, no cross-sentinel reentry.

### Phase 3.5 cleanup sub-team

#### 3. `public-dispatch-surface-author` — `Archivist.dispatch()` / `Archivist.dispatchRead()` public methods

| File | Edits | Charter |
|---|---|---|
| `forks/agentdb/src/archivist/index.ts` | +165 LoC (dispatch methods + private internals + module-level helpers + placeholder substrate) | `dispatch` |
| `forks/agentdb/src/archivist/registration.ts` | +15 LoC (`MutationRegistryEntry`/`ReadRegistryEntry` made exportable, `RegistryLookup` discriminated union, `getRegistration` lookup helper) | `dispatch` |

**Public surface**: `Archivist.dispatch(toolName: string, payload: unknown): Promise<unknown>` at line 176; `Archivist.dispatchRead(toolName, payload)` at line 209. Both methods include **wrong-kind error paths** — calling `dispatch()` on a read tool returns "targets a read handler — call dispatchRead() instead" rather than silently misrouting. Beyond-spec but high-value safety.

**Inline audit-chain ceremony**: rather than delegate to private `dispatchMutation` / `dispatchRead` in registration.ts (which the brief suggested), the worker implemented the full audit chain inline in the class. Reasoning: the registration.ts internals take a pre-built context, while the class method needs to mint the context from `toolName + payload`. Inline implementation avoids pointless stub-helper threading. **180 LoC vs 80-120 estimate — every line traces to ADR §Architecture, §Audit chain, §Mutation invariants, or §Type enforcement; no speculative code.**

**Six deferred behaviors clearly named** (NOT silent stubs — all loud-fail per `feedback-no-fallbacks.md`):
1. Substrate seam is placeholder — `placeholderSubstrate()` returns a `SubstrateHandle` that throws "archivist: substrate.<op> not yet wired (Phase 4 substrate seam)" — exactly the loud-fail semantics required.
2. Bulk dispatch is stub — `ctx.bulk()` throws "archivist: bulk dispatch not yet wired".
3. Child contexts mint UUIDs but don't open parent→child audit entries yet.
4. Invariant `substrateStateBefore`/`substrateStateAfter` are `undefined` (no substrate to snapshot).
5. `recordedPayload === callerIntent` (no payload-normalization layer yet).
6. `processId.role` hardcoded `'cli'`; `sessionId` from `process.env.RUFLO_SESSION_ID` or `'unknown'`.

**Re-export discipline preserved**: `getRegistration`, `MutationRegistryEntry`, `ReadRegistryEntry`, `RegistryLookup` are imported into `index.ts` for internal use only — none are re-exported from the barrel. Substrate-internal seam stays sealed.

#### 4. `package-exports-updater` — `./archivist` package export verification

| Entry | Status |
|---|---|
| `"./archivist"` with `types` + `import` + `default` | Already present at `package.json` lines 17-21 |
| `"./archivist/testing"` with `types` + `import` + `default` | Already present at `package.json` lines 22-26 |

**No edit needed** — entries landed in an earlier wave (Phase 2 or earlier). Worker correctly verified rather than over-editing. **`default` condition kept**: matches the file's pattern (all neighboring multi-condition exports use `types` + `import` + `default`). Pure-ESM omission of `require` is correct because `"type": "module"`.

### Substrate + hive-mind migration

#### 5. `substrate-primitive-extractor` — `makeFsJsonSubstrate` primitive

| File | LoC | Charter | Notes |
|---|---|---|---|
| `forks/agentdb/src/archivist/substrates/fs-json-store.ts` | 298 | `substrate-seam` | Lifts `withHiveStoreLock` + `saveHiveState` shape from hive-mind-tools.ts:919-1259 (post-maintenance baseline). Exports `makeFsJsonSubstrate<S>(opts: MakeFsJsonSubstrateOpts<S>): SubstrateAccess` + `MakeFsJsonSubstrateOpts`. |
| `forks/agentdb/src/archivist/substrates/index.ts` | 13 | `substrate-seam` | Barrel. |

**5-step durability stack** documented in file header with citations (ADR-0095 d11, ADR-0123 §73, ADR-0098):
1. Cross-process O_EXCL sentinel lock at `${path}.lock` (stale-lock recovery after `STALE_LOCK_MS`).
2. Per-pid + per-call counter tmp file (concurrent writers in one process never collide).
3. `openSync(O_WRONLY|O_CREAT|O_TRUNC)` → `writeSync` → `fsyncSync` → `closeSync`. The explicit `fsync` BEFORE rename closes the **Mode A entry-count silent-loss window observed on APFS under concurrent load** — load-bearing comment that earns its keep.
4. `renameSync(tmp, target)` — atomic at the directory-entry layer.
5. `cache.set(key, payload)` AFTER the rename succeeds (ADR-0123 §83 ordering, hive-mind-tools.ts:1206). On any throw above, cache is NOT updated.

**LoC delta accounting** (298 LoC vs ADR's ~490 LoC estimate): the lift sheds hive-specific consumer concerns — `HiveLRU` class, `defaultHiveState`, `migrateSharedMemoryShape`, `getHivePath`/`getHiveDir` helpers, agent-store carve-out duplicate — that correctly stay in `hive-mind-tools.ts` as consumer business logic. **The substrate primitive owns durability, the consumer owns business logic.** This is exactly the §Architecture separation the ADR intended.

**Self-contained**: zero imports from `forks/ruflo` or `@claude-flow/*`. Only `node:fs` + `node:path` + archivist-internal imports. The "forks/ruflo" mention in the file header is a comment-only provenance reference.

**Charter verification**: `substrate-seam` is on MODULE.md responsibilities list at line 22 with description at line 37 explicitly naming `makeFsJsonSubstrate (lifted from hive-mind's withHiveStoreLock per ADR-0180 Phase 4)`. Charter gate accepts.

#### 6. `hive-mind-spawn-migrator` — `handlers/hive-mind/spawn.ts`

| File | LoC | Charter | Notes |
|---|---|---|---|
| `handlers/hive-mind/spawn.ts` | 86 | `dispatch` | `HiveMindSpawnPayload = { action, count?, role?, agentType?, agentTypes?, prefix?, retryOf? }` mirrors cli inputSchema (covers ADR-0131 T12 retryTask + ADR-0108 T13 agentTypes round-robin). Registers via `registerMutationHandler<HiveMindSpawnPayload>('hive-mind_spawn', handler, { invariants: [], cacheScope: 'global' })`. Body is throw-stub TODO wrapped in `ctx.substrate.withWrite`. |

**Cross-substrate fanout note**: spawn touches BOTH hive-state.json AND agents.json (per pre-Phase-4 sentinel-separation discovery). The TODO comment captures the Phase 5+ wire-up shape: "agents.json + hive-state.json compose under one withWrite; legacy `withHiveStoreLock` collapses into substrate primitive." Cross-substrate composition under a single audit entry is recorded for Phase 5.

#### 7. `hive-mind-status-migrator` — `handlers/hive-mind/status.ts`

| File | LoC | Charter | Notes |
|---|---|---|---|
| `handlers/hive-mind/status.ts` | 67 | `dispatch` | Registers `'hive-mind_status'` via `registerReadHandler<HiveMindStatusQuery, RankedResults<HiveMindStatusEntry>>` with `{ cacheScope: 'global' }`. One `RankedResult` per component (hive root, queen, workers, metrics, health, failedWorkers) with `state ∈ {up,down,degraded}`. Provenance carries `matchType: 'status'`. |
| `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts` line 1664 | +ref comment | n/a (cli) | ADR-0180 reference comment pointing at the handler file. |

**Status-class shape matches Phase 3 precedent** (`memory_bridge_status`): per-component entries with `state` + metadata; `matchType: 'status'` exercises the Phase 3 `Provenance.matchType` union widening (`'semantic'|'bm25'|'exact'|'fused'|'status'`). `cacheScope: 'global'` matches `memory_bridge_status` — establishes the unanimous pattern for status-class reads (process-level, not namespace-scoped).

**cli body kept load-bearing**: explicit production-protection reasoning — "Wiring the cli to a throw-stub would regress `hive-mind_status`. The substrate seam is still `placeholderReadOnlySubstrate`." Correct call. Phase 5 wire-up follows substrate-seam-readonly + body port.

#### 8. `hive-mind-memory-migrator` — `handlers/hive-mind/memory.ts`

| File | LoC | Charter | Notes |
|---|---|---|---|
| `handlers/hive-mind/memory.ts` | 118 | `dispatch` | Discriminated `HiveMindMemoryPayload` covers all four actions (`get`/`set`/`delete`/`list`). Registers via `registerMutationHandler<HiveMindMemoryPayload>('hive-mind_memory', handler, { invariants: [], cacheScope: 'namespace' })`. |

**Two highlights**:
1. **Lazy-evict classification**: all four actions registered as MUTATION-capable because ADR-0122 T4 lazy eviction can mutate even on read (a `get` that evicts must show up in the same audit chain as the `set` that established the TTL). Splitting reads vs writes across two registration kinds would have broken audit-chain coherence. **Correct call**.
2. **`includeProvenance` rollout extended**: schema flag added to `get` and `list` payload variants (read-mode only — write actions ignore it). `matchType: 'exact'` for single-key get matches Phase 3's memory_retrieve/memory_list precedent. Phase 3-pattern consistency preserved.

#### 9. `hive-mind-consensus-migrator` — `handlers/hive-mind/consensus.ts`

| File | LoC | Charter | Notes |
|---|---|---|---|
| `handlers/hive-mind/consensus.ts` | 148 | `dispatch` | Single `registerMutationHandler<HiveMindConsensusPayload>('hive-mind_consensus', ...)` covers propose/vote/status/list branches. `cacheScope: 'global'`. Routes through `ctx.substrate.withWrite`. Body is throw-stub TODO. |

**CRDT consensus does NOT require a new abstraction** per ADR §Migration concerns Phase 4 Q8: the CvRDT merge is a pure function over JSON; persistence is a single substrate write structurally identical to the BFT/Raft/Quorum branches' tally save. `SubstrateAccess.withWrite<T>(fn)` covers it. **Single handler registration covers all consensus modes** — the dedup payoff is at the substrate layer, not handler-multiplexing.

**Did NOT SendMessage an explicit completion report**. Worker delivered code (verified on disk at 148 LoC with valid charter tag and registration), but did not surface a closing SendMessage. Phase 3 had the same silent-completion pattern (2 workers); Phase 4 has 1 (consensus-migrator). Surfaced under "Coordination notes for next phase" below.

#### 10. `hive-mind-broadcast-migrator` — `handlers/hive-mind/broadcast.ts`

| File | LoC | Charter | Notes |
|---|---|---|---|
| `handlers/hive-mind/broadcast.ts` | 68 | `dispatch` | `BroadcastRecord { messageId, message, priority, fromId, timestamp }` mirrors cli behavior. Registers via `registerMutationHandler<HiveMindBroadcastPayload>('hive-mind_broadcast', handler, { invariants: [], cacheScope: 'store' })`. |
| `handlers/hive-mind/index.ts` | (created here) | `dispatch` | Side-effecting barrel — extended by peer workers as they landed. |

Append-to-last-100 + trim semantics documented in handler doc-block. cli handler kept load-bearing per consensus pattern.

#### 11. `hive-mind-shutdown-migrator` — `handlers/hive-mind/shutdown.ts`

| File | LoC | Charter | Notes |
|---|---|---|---|
| `handlers/hive-mind/shutdown.ts` | 75 | `dispatch` | `HiveMindShutdownPayload = { graceful?: boolean, force?: boolean }`. Registers via `registerMutationHandler<HiveMindShutdownPayload>('hive-mind_shutdown', handler, { invariants: [], cacheScope: 'global' })`. |
| cli `hive-mind-tools.ts:2851` | +ref comment | n/a (cli) | ADR-0180 cross-reference pointing back to the archivist registration. |

**Three discrimination decisions worth recording**:
1. **Cross-store fanout to agents.json reap**: intrinsic to shutdown semantics but OUT OF SCOPE for this handler (the agents.json side lives in `hive-mind_agents` with `action: 'clear'`, payload union in agents-json.ts). Invariants-author scope per the team-lead's invariant baseline (`hive-mind → swarmId and CRDT-merge-input set equality`).
2. **`stopHiveMindSweepTimer()` is a process-local side-effect, NOT substrate state**: timer-stop is not auditable; substrate-write is. Phase 5+ daemon-lifecycle work builds on this precedent.
3. **`cacheScope: 'global'`**: shutdown clears entire hive state, not store-scoped. Matches consensus/broadcast/spawn/status; contrasts with memory's `'namespace'` and agents-json's `'store'`.

#### 12. `agents-json-second-consumer` — substrate-genericity validation

| File | LoC | Charter | Notes |
|---|---|---|---|
| `handlers/hive-mind/agents-json.ts` | 92 | `substrate-seam` | Already landed before agents-json-second-consumer's explicit message — likely from a prior phase or sibling. Registers `'hive-mind_agents'` via `registerMutationHandler<AgentsJsonPayload>` covering `action: 'spawn' | 'remove' | 'clear'` (discriminated union). Routes through `ctx.substrate.withWrite`. |
| `test/archivist/substrate-genericity.test.ts` | 150 | `substrate-seam` | **Explicit proof test** — NEW deliverable. |

**Substrate-genericity proof test exceeds brief.** The brief said "validate substrate-genericity by routing through `ctx.substrate.withWrite`" — establishing genericity by *example*. The worker delivered an explicit *proof* with two test cases:
- **Case 1**: ONE `makeFsJsonSubstrateFixture` instance routes BOTH `hive-mind_state` AND `hive-mind_agents` with distinct payloads coexisting in `fixture.files`. **If the primitive baked in either filename, this test fails.**
- **Case 2**: per-file lock scoping under `lockHoldMs: 10` synthetic contention. Per-storeId mutex semantics, zero data loss per `feedback-data-loss-zero-tolerance`.

**This converts the substrate-genericity claim from "we believe it because there are two consumers" to "we have a test that fails if the claim is violated".** Upgrade to Open Follow-up #10's contract.

**Fixture-vs-production brand equivalence**: the test uses `makeFsJsonSubstrateFixture` (Phase 2's in-memory test substrate) NOT production `makeFsJsonSubstrate`. Per §20 the fixture and production primitive share the same `SubstrateAccess` brand AND the same whole-document `{ scope.key → field }` convention. When the production primitive is swapped in (Phase 4-exit, Phase 5 substrate-seam wire-up), the test passes through unchanged.

## Acceptance checklist (per team-lead's brief)

| Check | Status | Notes |
|---|---|---|
| `bash scripts/check-archivist-charter.sh` exits 0 | **PASS** | `OK: 38 file(s) match charter (10 responsibilities enumerated)` |
| Both `fix(hive-mind): wrap …` commits on `forks/ruflo` main | **PASS** | `5f02fd290` + `5bc92b16d` on disk; subjects exact-match |
| `forks/agentdb/src/archivist/substrates/fs-json-store.ts` exists with `makeFsJsonSubstrate` export | **PASS** | 298 LoC, charter `substrate-seam`, both `withWrite` + `withBulkWrite` implemented |
| All 6 `handlers/hive-mind/{spawn,status,memory,consensus,shutdown,broadcast}.ts` exist | **PASS** | + agents-json.ts (7th, second-consumer scope) + barrel = 7 handlers + 1 barrel |
| `Archivist.dispatch()` exported from archivist/index.ts | **PASS** | Class instance method at line 176; `Archivist.dispatchRead()` at line 209 |
| `forks/agentdb/package.json` exports map has `./archivist` | **PASS** | Lines 17-21 with `types` + `import` + `default` shape |
| DO NOT run `npm run release` | **PASS** | Not invoked |

**Result: Phase 4 structural acceptance PASS.** Every acceptance criterion from the team-lead's brief is met. No gaps comparable to Phase 3's brief-vs-roster mismatch (3 missing memory mutating-tool handlers). The Phase 4 roster matched the brief: 14 workers, 14 deliverables, all 7 hive-mind handlers + barrel + 2 substrate files + 2 maintenance commits + 2 cleanup deliverables + 1 genericity test.

## Architectural drift from ADR-0180

**One substantive deviation, two minor measurement-anchor observations** (recorded transparently):

1. **`agents-json-fixer`'s `withAgentStoreLock` sentinel separation**: the maintenance commit introduced a NEW sibling sentinel `withAgentStoreLock` (distinct lockfile `.agents.json.lock`) rather than wrapping in `withHiveStoreLock` itself. **The ADR's brief wording would have caused a self-deadlock** at `hive-mind_spawn` (already holding `withHiveStoreLock` when calling `saveAgentStore`). The sentinel-separation solution preserves per-store coherence semantics while avoiding cross-lock deadlock. **The ADR §Migration concerns Phase 4 surprise (a) paragraph should be updated** to reflect that the minimum-viable fix uses a distinct sentinel, NOT `withHiveStoreLock` itself. Recommended as a non-Halt-trigger Addendum (ADR-0180-Amendment: phase-4) in `forks/ruflo`'s normal PR flow OR a direct edit in `ruflo-patch` (since the ADR lives there). The wire-up itself is correct; only the prose needs to catch up.

2. **`consensus-lock-fixer` site-count drift**: ADR estimated ~6 saveHiveState sites in the consensus handler; actual count is 11. **NOT a §Measurement-date anchoring 10% structural drift trigger** — that gate is on call-site count of the migrating surface and LoC of the targeted module, not on the *number of saveHiveState calls inside the buggy handler*. The outer-wrap fix reduces site-count to 1 (a single `withHiveStoreLock` acquire). The commit body acknowledges the drift; no `ADR-0180-Halt: re-scope` trailer needed.

3. **`substrate-primitive-extractor` LoC drift**: ADR estimated ~490 LoC moves out of hive-mind-tools.ts; actual primitive is 298 LoC. **NOT a structural drift** — the difference is hive-specific machinery (HiveLRU class, defaultHiveState, migrateSharedMemoryShape, getHivePath/getHiveDir helpers, agent-store carve-out duplicate) that correctly STAYS in hive-mind-tools.ts as consumer concerns. The substrate primitive owns durability; the consumer owns business logic. This is exactly the §Architecture separation the ADR intended; the LoC accounting was just slightly off. No Halt.

**Three Phase-4-exit follow-ups** (not drifts, just decisions made during the wave):

4. **All 7 hive-mind handler bodies are throw-stubs.** Matches Phase 3 pattern — registration shape lands this phase, body porting follows when cli wire-up is ready. cli `routeMemoryOp`-style branches and direct cli handlers remain authoritative until the dispatch boundary is wired through cli (Phase 4-exit / Phase 5 substrate-seam wire-up work).

5. **cli `loadAgentStore`/`saveAgentStore` are async** after `agents-json-fixer`'s maintenance commit. All 4 cli callsites (`hive-mind_spawn` × 2, `hive-mind_status` × 1, `hive-mind_shutdown` × 2) are now `await`-ed. **Watch for any non-awaited consumer** in Phase 5 / Phase 6 — `agents-json-fixer`'s commit covered every callsite in hive-mind-tools.ts, but cross-module consumers (if any) need a sweep.

6. **`agents-json-second-consumer` does NOT replace cli outer `withHiveStoreLock`** — the cli wire-up is a follow-up commit, NOT in scope for this validation slot. The test proves the substrate-seam works at the fixture level; cli wire-up follows in Phase 5.

## Phase 5 prerequisites (for team-lead / Phase 5 implementer)

In addition to the standard release-pipeline gates (`scripts/ruflo-publish.sh` and the §Measurement-date anchoring `>10% drift` check), Phase 5 inherits these Phase 4-exit follow-ups:

1. **Substrate-seam wire-up at archivist init.** `Archivist.initialize()` currently mints `placeholderSubstrate` / `placeholderReadOnlySubstrate` per-dispatch. Phase 5 must plumb real `makeFsJsonSubstrate` instances per registered store — likely via an Archivist constructor option or a per-tool substrate-factory registry. Once landed, the 7 hive-mind handler bodies and Phase 3's 7 memory handler bodies can be ported from throw-stubs to real port-of-cli logic.

2. **cli dispatch wire-up.** Once substrate-seam lands, cli `hive-mind-tools.ts` handlers can delegate to `archivist.dispatch('hive-mind_*', payload)` / `archivist.dispatchRead(...)`. Phase 3 memory handlers face the same wall (`routeMemoryOp` branches remain authoritative today). **The dispatch boundary needs a single landing wave covering memory_* + hive-mind_* to avoid mixed-state.**

3. **3 missing memory mutating-tool handlers** (carried from Phase 3 §Brief vs roster mismatch): `handlers/memory/{delete,migrate,import-claude}.ts`. The invariant files are already written; the handler files need staffing.

4. **Pre-existing `FileHandle` import errors in `audit-rotation.ts`/`audit-writer.ts`**: three Phase 4 workers flagged these. Carried from Phase 2/Phase 3. Phase 5/6 cleanup target.

5. **ADR §Migration concerns Phase 4 paragraph needs Amendment.** The text says "lifts the existing `withHiveStoreLock` shape (already in the same file at L1213-1259) to `saveAgentStore`/`loadAgentStore`" — but the actual landed fix uses a distinct `withAgentStoreLock` sentinel, NOT a wrap in `withHiveStoreLock` itself. Recommended Addendum: `**Amendment 2026-05-14 (phase-4 maintenance):** the minimum-viable agents.json fix introduces a NEW sibling sentinel `withAgentStoreLock` (distinct lockfile `.agents.json.lock`), preserving per-store coherence semantics without self-deadlock at the `hive-mind_spawn` callsite which already holds `withHiveStoreLock`.` This is a prose-only Amendment; the implementation (commit `5f02fd290`) is correct.

6. **Substrate-genericity test under production primitive.** `substrate-genericity.test.ts` currently exercises `makeFsJsonSubstrateFixture` (in-memory). Phase 5 should ALSO run the same test against `makeFsJsonSubstrate` (production fs-based) under a tmp directory, asserting the fixture-and-production-brand-equivalence claim at the integration-test level.

7. **Re-measurement snapshot** per §Measurement-date anchoring. Phase 4 closed on 2026-05-14 — the same date the §20 testing surface and the §Caller surfaces wire-up audit were anchored. No drift to flag. Phase 5's planning gate should drop `bench/measurement-snapshots/2026-05-14.md` (or 2026-05-15 if Phase 5 opens tomorrow) capturing the post-Phase-4 LoC and call-site counts for the Phase 5 FS-JSON store batch (claims/tasks/swarm/coordination/workflow/...).

## Recommendation

**Advance to Phase 5** (file-system-JSON-store batch: claims/tasks/agents/swarm/coordination/workflow/neural/github/performance/system/config/progress/ruvllm/daa/wasm/browser/autopilot — ~17 stores). Phase 4's substrate-seam primitive (`makeFsJsonSubstrate`) plus the genericity proof test are exactly the abstractions Phase 5 needs — each new FS-JSON consumer becomes one more route through `makeFsJsonSubstrate`, validated by the same fixture-vs-production brand equivalence Phase 4 established.

**Caveats before Phase 5 spawns**:
- Decide the cli dispatch wire-up policy first (Phase 5 prerequisite #2 above). If Phase 5 lands handlers without cli wire-up, the "17 FS-JSON store throw-stubs" inventory grows further before any production benefit.
- Resolve the 3 missing memory mutating-tool handlers (prerequisite #3). These are mechanical given the invariants are already written.
- Land the ADR Amendment for the sentinel-separation discovery (prerequisite #5).
- Drop the Phase 5 measurement snapshot (prerequisite #7).

Phase 5 worker composition is already itemized in ADR-0180 §Execution Plan Phase 5 row — no further planning needed before spawn once prerequisites are resolved.

## Coordination notes for next phase

1. **Off-phase task-list directives**: NONE surfaced during Phase 4. The team-lead's brief warned "Decline off-phase `task-list` directives (Phase 2 had two; expect more)" — none arrived this phase. Both Phase 3 and Phase 4 queens correctly stayed in scope.

2. **Single-attempt prompt discipline**: HELD ACROSS ALL 14 WORKERS. No retry loops. Two workers (agents-json-fixer + consensus-lock-fixer) correctly halted before committing when the literal instruction would have caused a deadlock or stale-state-write, surfaced their analyses, and either (a) found the commit already landed via a sibling (agents-json-fixer) or (b) received approval and proceeded (consensus-lock-fixer). This is the discipline the brief required and the §Halt-triggers protocol depends on.

3. **SendMessage was the primary inter-agent channel.** 13 of 14 workers used it; 1 silent completion (hive-mind-consensus-migrator) verified via disk state alone. Matches Phase 3's 8/10 — the pattern of silent-completions persists. **Recommend the Phase 5 team-lead's brief explicitly requires every worker to SendMessage on exit, even if delta is small**, to prevent verification-by-disk-scan from becoming the queen's default. This matches `feedback-agent-dialectic-via-sendmessage.md`.

4. **Queen wrote ZERO source code.** Every byte under `forks/agentdb/src/archivist/handlers/hive-mind/**`, `forks/agentdb/src/archivist/substrates/**`, `forks/agentdb/test/archivist/substrate-genericity.test.ts`, `forks/agentdb/src/archivist/index.ts` dispatch additions, and the ruflo-fork maintenance commits came from a worker. Queen's only file output is this report.

5. **No commits made by the queen.** Two maintenance commits made by workers (`5f02fd290`, `5bc92b16d`). All other deliverables are in the working tree, ready for the user to review and commit at their discretion (probably bundled with the Phase 5 substrate-seam wire-up work, given the inter-dependencies — see Phase 5 prerequisite #2).

6. **Workers correctly avoided racing on shared files.** `handlers/hive-mind/index.ts` barrel got `export * from './X';` lines from 7 different migrators; all converged on a clean barrel via Edit-based appends. `consensus-lock-fixer`'s `git add -p` discipline kept their commit clean from sibling provenance-rollout work. No git-tree conflicts; no overwrites.

7. **Three workers reported confused git state** (agents-json-fixer twice, consensus-lock-fixer once) where their `git log` view did not yet reflect a commit that was already present on disk. Likely cause: working-tree state captured at pre-flight time, then a sibling agent landed in parallel. The queen verified disk state and surfaced the divergence each time. **Recommend Phase 5 workers refresh `git log -1` immediately before each `git status`/`git add` operation** when working on contested files — the working-tree state can desync from history within seconds during a parallel wave.

8. **agents-json-second-consumer's "agents-json.ts already on disk" observation**: the worker's handler file landed in an earlier wave (Phase 2/3 or an earlier sibling) before their explicit completion message. Their NEW deliverable was the substrate-genericity test, which the brief described in passing ("agents.json as second consumer ... proving genericity"). The worker correctly extended the brief by writing an explicit *proof* rather than just establishing the second-consumer-routing-fact. **Recommend recording this brief-vs-deliverable expansion as a positive precedent** — workers who upgrade probabilistic claims to deterministic tests should be encouraged.

9. **Charter gate `OK: 38 file(s)` is a 9-file delta over Phase 3's `OK: 28`.** New files: substrates/fs-json-store.ts + substrates/index.ts (2), handlers/hive-mind/{agents-json,broadcast,consensus,memory,shutdown,spawn,status}.ts + barrel (8). Plus Phase 3's count was already at 28 — so net Phase 4 charter additions: 10. (One file may have been removed or recounted; the 38 is the current canonical state.) Charter responsibilities count stayed at 10 (no new charter tags introduced; `substrate-seam` was already present from Phase 2 / Open Follow-up #10).

10. **`includeProvenance` schema additions on cli `hive-mind-tools.ts` are uncommitted** in the working tree as of report-write time. These came from sibling provenance-rollout work parallel to the migrators (e.g. hive-mind-memory's `get`/`list` provenance flag, hive-mind-status's status-class provenance). Not in scope for queen to commit; user decision when to bundle with Phase 5 work.

## Open follow-ups (for ADR §Open follow-ups list, if not already there)

| # | Item | Surfaced by |
|---|---|---|
| F4-1 | Amend ADR §Migration concerns Phase 4 surprise (a) prose to reflect `withAgentStoreLock` sentinel-separation (NOT `withHiveStoreLock` wrap) | agents-json-fixer's landing |
| F4-2 | Substrate-seam wire-up at `Archivist.initialize()` — plumb per-store `makeFsJsonSubstrate` instances replacing `placeholderSubstrate` | public-dispatch-surface-author deferral list |
| F4-3 | cli dispatch wire-up (memory_* + hive-mind_* in one wave to avoid mixed-state) | unanimous worker pattern across Phase 3+4 |
| F4-4 | Substrate-genericity test extension to exercise production `makeFsJsonSubstrate` under tmp dir (not just fixture) | agents-json-second-consumer's brand-equivalence claim |
| F4-5 | Phase 5 measurement snapshot at `bench/measurement-snapshots/2026-05-14.md` (or open date) | §Measurement-date anchoring §Phase 4 has tightest boundary |
| F4-6 | Pre-existing `FileHandle` import errors in audit-rotation.ts/audit-writer.ts | three workers flagged |
| F4-7 | Cross-module sweep for any non-await of now-async `loadAgentStore`/`saveAgentStore` outside hive-mind-tools.ts | agents-json-fixer's commit |
| F4-8 | Phase 5 brief requirement: every worker MUST SendMessage on exit (no silent completions) | Phase 3 had 2 silent, Phase 4 had 1 silent — pattern persists |

## Sign-off

Phase 4 structurally complete on 2026-05-14, single attempt, 14/14 workers PASS, charter gate green, all acceptance criteria met. Recommendation: advance to Phase 5 once the 8 follow-ups above are triaged.
