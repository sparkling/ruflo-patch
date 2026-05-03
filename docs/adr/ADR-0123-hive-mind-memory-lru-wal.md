# ADR-0123: Hive-mind collective memory — RVF-backed storage with LRU cache and SQLite WAL

- **Status**: **Implemented (2026-05-03)** per ADR-0118 §Status (T5 complete; fork 8d423a346 + ruflo-patch b61811f). Cites: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:180` (`loadHiveState` — RVF read + LRU front), `:201` (`saveHiveState` — RVF write-through), `:181-189` (silent `catch {}` removed); `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts` (`appendToWal:1917`, tmp-fsync-rename:2513, dir-fsync:2538 — durability primitive inherited); `forks/ruflo/v3/@claude-flow/memory/src/sqlite-backend.ts:121` (defensive `PRAGMA journal_mode = WAL` assertion target); `tests/unit/adr0123-lru-cache.test.mjs`, `tests/unit/adr0123-rvf-backend.test.mjs`, `tests/unit/adr0123-sigkill-durability.test.mjs`; `lib/acceptance-adr0123-hive-memory-checks.sh` (concurrent-write 100% durability, SIGKILL crash-durability, no-silent-catch — wired in `scripts/test-acceptance.sh`).
- **Date**: 2026-05-02
- **Deciders**: Henrik Pettersen
- **Depends on**: ADR-0116 (hive-mind marketplace plugin), ADR-0118 (hive-mind runtime gaps tracker, §T5), ADR-0122 (T4 typed memory shape — LRU caches the typed entries, not legacy flat dict)
- **Related**: ADR-0086 Debt 7 (better-sqlite3 / sql.js placement history), ADR-0114 (hive-mind 3-layer architecture)
- **Scope**: Fork-side change to `forks/ruflo` collective-memory backend. Per `feedback-no-upstream-donate-backs.md`, this stays on `sparkling/main`.

## Context

ADR-0118 §T5 identifies the collective-memory backend as a partial-coverage row in the hive-mind runtime matrix. Current persistence is a single JSON file with no read cache, no RVF integration, and a silent error-swallowing read path:

| Surface | Path | Current behaviour | Gap |
|---|---|---|---|
| Read entry | `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:180` (`loadHiveState`) | `readFileSync` + `JSON.parse`; `try { … } catch { } ` at lines 181-189 returns default state on any error (parse failure, EIO, permission, partial read) | Silent `catch {}` masks every failure mode — ADR-0082 / `feedback-no-fallbacks.md` violation; no read cache; not RVF-backed |
| Write entry | `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:201` (`saveHiveState`) | Already does atomic write per ADR-0104 §5: `writeFileSync(${path}.tmp.${pid}) → renameSync(tmp, path)`. Cross-process serialised by `withHiveStoreLock` (lines 212+, ADR-0098-style O_EXCL sentinel) | Single full-state rewrite per mutation; no incremental WAL; not RVF-backed; no per-entry granularity for T4's typed shape |
| Backend choice | n/a | JSON file in `.claude-flow/hive-mind/state.json` | Violates `project-rvf-primary` — RVF should be primary storage, not JSON files |

The `project-rvf-primary` memory entry is explicit: *"Always use RVF where possible; SQLite is fallback only; never add new SQLite-first code paths."* The current implementation is JSON-first, predating that rule.

The actual durability primitive lives in `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts` (verified: 2616 lines; exports `RvfBackend implements IMemoryBackend`). RVF is **not** a SQLite-backed module — it has its own JS-level WAL: a `.wal` sidecar file appended on every store (line 1917 `appendToWal`), compacted into a `.rvf` main file under a JS-side lock, and the persist path explicitly fsyncs the tmp file before atomic rename per ADR-0095 d11 (line 2513). Directory entry fsync is best-effort for power-crash durability (line 2538). Routing hive state through RVF inherits this stack — the durability mechanism already exists; we wire onto it.

The SQLite fallback path lives in `forks/ruflo/v3/@claude-flow/memory/src/sqlite-backend.ts`, which `import Database from 'better-sqlite3'` and already issues `PRAGMA journal_mode = WAL` at line 121 (default). No sql.js path exists in either backend in the memory package — `grep` for `from 'sql.js'` in `v3/@claude-flow/memory/src/` returns nothing. (sql.js does appear elsewhere in the v3 tree — `shared/src/events/event-store.ts`, `mcp/.claude/helpers/metrics-db.mjs` — but those are unrelated subsystems and never carry hive memory.)

`project-adr0086-debt7-stale.md` records that better-sqlite3 placement has shifted three times. The current state (commit `c7439f345`) places it under `optionalDependencies` with `open-database.ts` deleted; the runtime invariant is *"no dist file imports both better-sqlite3 and sql.js."* This ADR's change is invariant-neutral: RVF imports neither binding, and `sqlite-backend.ts` already imports only better-sqlite3.

ADR-0122 (T4) introduces the typed memory shape `{ value, type, ttlMs, expiresAt, createdAt, updatedAt }`. T5 caches *that* shape; caching the legacy flat dict would invalidate as soon as T4 lands.

## Decision Drivers

- **`project-rvf-primary` memory rule**: *"Always use RVF where possible; SQLite is fallback only; never add new SQLite-first code paths."* JSON-file primary storage already violates this; any new path must route through RVF first. This rule is the dominant driver — every option below is graded against it before anything else.
- **`feedback-no-fallbacks`**: the silent `catch {}` at `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:181-189` masks every read failure (parse error, EIO, permission, partial read). Removal is mandatory, not optional.
- **`feedback-data-loss-zero-tolerance`**: 99%, 99.9%, 99.99% pass on a concurrent-write probe is not shippable. The bar is 100% durability or the implementation is not done. The mechanism that delivers this must be a real durability primitive (fsync + atomic rename), not a SQL pragma whose semantics depend on the SQLite binding behind it.
- **ADR-0086 Debt 7 invariant**: *"no dist file imports both better-sqlite3 and sql.js."* This ADR is invariant-neutral — RVF imports neither, and `sqlite-backend.ts` already imports only better-sqlite3.
- **ADR-0122 (T4) typed shape**: cache values are typed records (`{ value, type, ttlMs, expiresAt, createdAt, updatedAt }`), not flat strings. Caching the legacy shape would force a rewrite on T4 landing.

## Considered Options

- **(a) RVF + process-local LRU, inheriting RVF's existing JS-level WAL (`.wal` sidecar + fsync + atomic rename per ADR-0095 d11)** — chosen.
- **(b) JSON-file with fsync barriers** — keep JSON storage but add explicit `fsync` after every write before the existing rename, relying on the host filesystem to durably commit.
- **(c) SQLite-first with RVF as a cache layer in front** — promote SQLite to primary store, treat RVF as a hot-path cache.

## Pros and Cons of the Options

### (a) RVF + LRU, inheriting RVF's WAL

- Pros: honours `project-rvf-primary`; the durability primitive is real (RVF appends every store to a `.wal` sidecar, then compacts under a JS lock, then writes the main `.rvf` via tmp + fsync + rename per ADR-0095 d11); LRU bounds read latency without blocking writes; corrupt-state errors propagate naturally once the silent `catch {}` is removed; T4 typed shape lives at the cache boundary; no new SQLite co-import (Debt 7 invariant intact).
- Cons:
  - Cross-process cache coherency is punted: daemon and CLI hold independent process-local LRUs. Documented as "RVF is source of truth; stale caches resolve on next `loadHiveState`" — not enforced. If a real coherency bug surfaces under load, a future ADR adds explicit invalidation messaging.
  - LRU `maxEntries` is operator-tunable (`RUFLO_HIVE_CACHE_MAX`, default 1024). A queen with 10K+ hot entries thrashes the default; eviction-rate metric makes this observable.
  - SQLite fallback path (`sqlite-backend.ts`) is not exercised by hive memory in the happy path; its WAL behaviour matters only if RVF init fails and the hybrid backend selector falls back. Verified that `sqlite-backend.ts` already issues `PRAGMA journal_mode = WAL` at line 121, so the fallback inherits real WAL via better-sqlite3 — no additional pragma work needed.
  - sql.js compatibility is **not in scope**: no path in `v3/@claude-flow/memory/src/` imports sql.js. If a future variant of RVF or the hybrid selector adds a sql.js path, durability cannot be assumed under SIGKILL there (sql.js operates against an in-memory virtual filesystem; `db.export()` is the only persistence primitive — see §Risks #6 (sql.js out-of-scope)).

### (b) JSON-file with fsync barriers

- Pros: smallest diff; no new dependency surface; transparent to existing readers; preserves ADR-0104 §5 atomic rename + ADR-0098-style cross-process lock that already protect against torn JSON.
- Cons: violates `project-rvf-primary` (JSON-first); single full-state rewrite per mutation does not scale with T4's per-entry typed shape (every `set` rewrites the whole `sharedMemory` map); no read cache; fsync alone is not a write-ahead log — a crash between two related entry writes still produces "either old state or new state, not both" only because the rename is atomic, not because there is incremental durability of partial mutations; preserves the silent `catch {}` unless we also restructure error handling. Net effect: incrementally safer than today but architecturally pinned to JSON, blocking T6 (session lifecycle) and T4's per-entry RVF row mapping.

### (c) SQLite-first with RVF as cache

- Pros: WAL is native via better-sqlite3; mature concurrent-write story; `sqlite-backend.ts` already exists and is wired.
- Cons: directly violates `project-rvf-primary` (SQLite-first); inverts the primary/fallback ordering the project memory codified; reintroduces the better-sqlite3-vs-sql.js placement question that ADR-0086 Debt 7 already settled three times (any future "make SQLite work in browser/wasm contexts" pressure would push toward the sql.js co-import this rule forbids); reframes RVF as a cache, which is exactly the architectural inversion the rule was written to prevent.

## Decision Outcome

Chosen option: **(a) RVF + process-local LRU, inheriting RVF's existing WAL stack**. Trace to drivers:

| Driver | How (a) satisfies it |
|---|---|
| `project-rvf-primary` | RVF becomes the source of truth for hive memory; JSON is demoted to `state.json.legacy` post-migration. |
| `feedback-no-fallbacks` | The silent `catch {}` at `hive-mind-tools.ts:181-189` is removed; corrupt-state errors propagate. |
| `feedback-data-loss-zero-tolerance` | 100% durability is delivered by RVF's existing primitives — `appendToWal` per store (line 1917), explicit fsync of the tmp file before rename (line 2513, ADR-0095 d11), best-effort directory entry fsync for power-crash durability (line 2538). The mechanism predates this ADR; we wire onto it rather than invent it. The SQLite fallback inherits real WAL via better-sqlite3's existing `PRAGMA journal_mode = WAL` (`sqlite-backend.ts:121`). |
| ADR-0086 Debt 7 invariant | RVF imports neither binding; `sqlite-backend.ts` imports only better-sqlite3. No co-import is introduced. |
| T4 typed shape (ADR-0122) | Cache values mirror `MemoryEntry` from ADR-0122; no schema flip on T4 landing. |

Options (b) and (c) each fail the `project-rvf-primary` gate; (b) additionally gives no incremental durability beyond what ADR-0104's atomic rename already provides.

## Consequences

### Positive

- `project-rvf-primary` honoured: RVF is the source of truth; JSON file is migrated and demoted to `state.json.legacy` (preserved, not deleted, per `feedback-data-loss-zero-tolerance`).
- Corrupt-state errors surface loudly per `feedback-no-fallbacks`; the silent `catch {}` is removed.
- Concurrent durability inherits RVF's existing JS WAL + fsync + atomic rename. The 100% bar in `feedback-data-loss-zero-tolerance` is delivered by an existing, exercised primitive — not invented here.
- Cache layer is small, observable (hit/miss counters, eviction-rate metric), and tunable (`RUFLO_HIVE_CACHE_MAX`).
- T5 caches the T4 typed shape directly — no rewrite on T4 landing.

### Negative

- Cross-process cache coherency is punted to the backend: if the daemon and a CLI process both hold caches, RVF remains the source of truth but stale caches are possible until next `loadHiveState`. Documented, not enforced.
- Cache eviction policy needs tuning. Default `maxEntries = 1024` is a guess; an operator with a large hive may need to bump `RUFLO_HIVE_CACHE_MAX`. Eviction-rate metric makes the under-sizing case observable.
- The SQLite fallback path is invoked only on RVF init failure; its durability behaviour is verified at acceptance time (asserting `journal_mode=wal` on the better-sqlite3 connection) but is not on the happy path. If RVF init fails routinely, that is a separate bug to investigate, not a hidden durability degradation here.
- This ADR does **not** address sql.js durability — no memory-package code path uses sql.js (excepting the read-only one-way migration tool at `rvf-migration.ts:128`), and sql.js does not provide a real WAL (its only persistence primitive is `db.export()` of the full virtual-filesystem blob). If a future change introduces a sql.js memory path, that change must justify its own durability story; this ADR's 100% claim is scoped to RVF-primary + better-sqlite3-fallback only. See §Risks #6.
- Power-loss durability (fsync) not addressed here either; deferred to ADR-0130 (RVF WAL fsync durability). RVF's `.wal` sidecar uses `appendFile` (`rvf-backend.ts:488-491`), which does not fsync the WAL append before the JS lock is released. SIGKILL-with-intact-page-cache is covered by this ADR; true power-loss durability requires an RVF-side change owned by ADR-0130.

## Validation

- **Acceptance — `check_adr0123_concurrent_write_durability`** in `lib/acceptance-adr0123-hive-memory-checks.sh`: spawn N concurrent writers each calling `hive-mind_memory set` with distinct keys; after all complete, every key is readable. **100% — any data loss fails the check**, per `feedback-data-loss-zero-tolerance`. Wired into `scripts/test-acceptance.sh` post-init parallel wave.
- **Acceptance — `check_adr0123_sigkill_crash_durability`** (same file; canonical durability gate, also covered at the unit/integration layer in `tests/unit/adr0123-sigkill-durability.test.mjs`): kill the writer mid-batch via `SIGKILL`; on restart, every committed entry survives and no half-written entry exists. This is the **SIGKILL-without-power-loss** case — page cache remains intact, which is what RVF's existing `appendToWal` + tmp-fsync-rename stack guarantees. Runs sequentially after the parallel wave joins (kills processes — must not race other parallel checks). **True power-loss durability (fsync drops) is OUT OF SCOPE for T5 — see ADR-0130 (RVF WAL fsync durability).**
- **Acceptance — `check_adr0123_loadstate_no_silent_catch`** (same file): pre-place a `state.rvf` containing a deliberately corrupt entry; `hive-mind_memory get` MUST throw, not return default state. Asserts `feedback-no-fallbacks` removal of the silent `catch {}`.
- **Integration — `tests/unit/adr0123-rvf-backend.test.mjs`**: RVF round-trip; legacy JSON migration to `state.json.legacy` (non-destructive); SQLite-fallback path asserts `journal_mode=wal` on the better-sqlite3 connection (defensive — already the default since better-sqlite3 v8.x).
- **Unit — `tests/unit/adr0123-lru-cache.test.mjs`**: LRU eviction order, cache hit/miss counters, typed-entry (`MemoryEntry` shape from ADR-0122) round-trip through cache.
- **ADR-0086 Debt 7 invariant** (existing acceptance, runs as precondition): no dist file co-imports better-sqlite3 + sql.js. Verified again post-implementation.

## Decision

**Replace JSON-file persistence in `loadHiveState`/`saveHiveState` with RVF-backed storage fronted by a process-local LRU cache. Inherit RVF's existing JS WAL + fsync + atomic rename for durability. Verify (defensively) that the SQLite fallback path's `PRAGMA journal_mode = WAL` is engaged.** The cache key space is the typed-shape entry map from ADR-0122; cache values are the typed records (`MemoryEntry`), not flat strings.

After this ADR lands:
- `saveHiveState` writes to RVF via `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts` (the existing RVF entry point — `RvfBackend` class, line 76); JSON-file writes are removed from the happy path. Durability is the existing `appendToWal` (line 1917) + `compactWal` + tmp-fsync-rename (line 2513) sequence; no new durability code is introduced here.
- `loadHiveState` consults a process-local LRU before hitting RVF; cache misses load from RVF and populate the cache.
- The silent `catch {}` at `hive-mind-tools.ts:181-189` is removed. Corrupted state surfaces as a thrown error, per `feedback-no-fallbacks.md`.
- The SQLite fallback path (`sqlite-backend.ts`, only invoked if RVF init fails) is asserted in tests to have `journal_mode = wal`. better-sqlite3 sets this by default since v8.x; the assertion is defensive against accidental future regressions, not new work.
- Concurrent-write durability is **100%**, not 99.9% — per `feedback-data-loss-zero-tolerance.md`. A 99.x rate-of-loss is treated as not fixed.

The LRU layer is process-local (one cache per CLI invocation; daemon has its own). Cross-process coherency is the storage backend's responsibility, not the cache's — when the daemon and an interactive CLI both hold caches, RVF is the source of truth and either reader re-reads on next `loadHiveState`. This keeps the cache layer simple; cross-process invalidation is out of scope for T5.

## Implementation plan

### Phase 1 — RVF-backed storage in `loadHiveState` / `saveHiveState`

`forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:180-210` (verified line refs):

- `saveHiveState(state)` writes to RVF via `RvfBackend` (`v3/@claude-flow/memory/src/rvf-backend.ts`). Key namespace: `hive-mind/state` (single-row state document) plus per-entry rows for `state.sharedMemory` (T4's typed `MemoryEntry`) so individual entries can be read without rehydrating the whole state.
- `loadHiveState()` reads from RVF; on RVF miss, returns the documented default state. On RVF read error (not miss — actual error including `RvfCorruptError` / `RvfNotInitializedError`), throws. No silent `catch {}`.
- The existing ADR-0104 §5 atomic-write path (tmp + rename, `withHiveStoreLock`) is preserved as the JSON-migration writer for the legacy file rename only; the happy-path RVF write inherits RVF's own atomicity (tmp-fsync-rename per ADR-0095 d11).
- The legacy JSON file `.claude-flow/hive-mind/state.json` is migrated on first load: if it exists and RVF has no entry, copy contents into RVF and rename the file to `state.json.legacy` (don't delete — preserves recovery path per `feedback-data-loss-zero-tolerance`). Subsequent loads ignore the legacy file.

### Phase 2 — LRU cache layer

A `Map`-backed LRU keyed by the `state.sharedMemory` map key (per ADR-0122 §312-314, the per-entry key IS the map key — `MemoryEntry` has no `id` field):

- Default `maxEntries = 1024`, configurable via `RUFLO_HIVE_CACHE_MAX` env var.
- Eviction policy: classic LRU (move-to-front on `get`/`set`, evict oldest when size exceeds max).
- Cache-aware paths: `hive-mind_memory get` / `list` / `set` / `delete` MCP tool actions all route through the cache. `set` and `delete` write through to RVF; `get` and `list` read-through.
- Cache is invalidated wholesale on `hive-mind init` (fresh hive replaces prior state).

### Phase 3 — Defensive WAL assertion on the SQLite fallback path

This phase is **assertion-only**, not new pragma work. Verified state of the codebase:

- `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts` does not import `better-sqlite3` or `sql.js`. RVF's WAL is JS-level (`.wal` sidecar file, `appendToWal` at line 1917, `compactWal`, fsync at line 2513). No SQL pragma applies.
- `forks/ruflo/v3/@claude-flow/memory/src/sqlite-backend.ts` (the SQLite fallback used only if RVF init fails) imports `better-sqlite3` and already issues `this.db.pragma(`journal_mode = ${pragmas?.journalMode ?? 'WAL'}`)` at line 121. No code change needed.
- No code path in `v3/@claude-flow/memory/src/` imports `sql.js`. sql.js is used elsewhere in the v3 tree (`shared/src/events/event-store.ts`, `mcp/.claude/helpers/`) for unrelated subsystems — never for hive memory.

Work for this phase:
- Add an integration test that opens the SQLite fallback explicitly and reads back `PRAGMA journal_mode` to assert `wal`. If it ever returns anything else (e.g. a future pragma override misconfigures the fallback), the test fails loudly. `feedback-no-fallbacks.md` — no silent downgrade.
- Do **not** introduce a sql.js path. If a future ADR introduces one, that ADR owns its durability story; sql.js operates against an in-memory virtual filesystem and provides no real WAL (its only persistence primitive is `db.export()` of the entire blob — see §Risks #6 (sql.js out-of-scope)).

### Phase 4 — Tests (unit + integration + acceptance, per `feedback-all-test-levels.md`)

| Level | Test | Asserts |
|---|---|---|
| Unit (`tests/unit/adr0123-lru-cache.test.mjs`) | LRU eviction order | After `maxEntries + 5` inserts, the 5 oldest are evicted; the most-recently-`get`'d entries survive |
| Unit | Cache hit ratio measurement | Instrument the cache with hit/miss counters; assert `get` after `set` is a hit; `get` after eviction is a miss |
| Integration (`tests/unit/adr0123-rvf-backend.test.mjs`) | RVF round-trip | `saveHiveState({...typed entries...})` then fresh `loadHiveState()` returns deep-equal state |
| Integration | Legacy JSON migration | Pre-place `state.json` with legacy flat-dict contents; first `loadHiveState` migrates to RVF, renames to `state.json.legacy`, second load reads from RVF |
| Integration | SQLite-fallback WAL pragma | When `sqlite-backend.ts` is the active backend (RVF init failed), `PRAGMA journal_mode` reports `wal`; assertion fails loudly if it doesn't |
| Acceptance (`lib/acceptance-adr0123-hive-memory-checks.sh`) | Concurrent-write probe | Spawn N concurrent writers each calling `hive-mind_memory set` with distinct keys; after all complete, every key is readable. **100% durability — any data loss fails the check.** Wired into `scripts/test-acceptance.sh` post-init phase |
| Acceptance | Crash-durability | Kill the writer process mid-batch via `SIGKILL`; on restart, assert no partial writes corrupt state (entries are either fully present or fully absent — never half-written) |

### Phase 5 — Remove silent fallback in `loadHiveState`

`hive-mind-tools.ts:181-189` (verified):

```diff
 function loadHiveState(): HiveState {
-  try {
-    const path = getHivePath();
-    if (existsSync(path)) {
-      const data = readFileSync(path, 'utf-8');
-      return JSON.parse(data);
-    }
-  } catch {
-    // Return default state on error
-  }
+  // [Phase 1 replaces this with RVF read; corrupted-state errors propagate]
   return { /* default state */ };
 }
```

## Specification

- **`loadHiveState` post-conditions**:
  - **Cache hit** (`HIVE_STATE_DOC_KEY` present in LRU and not evicted): returns the cached typed record; LRU move-to-front side-effect applied.
  - **Cache miss, RVF hit**: returns the value read from RVF; cache populated; no fallback path.
  - **Cache miss, RVF miss** (entry genuinely not present): if `state.json.legacy` does not exist, returns the documented default state; if a non-renamed legacy `state.json` exists, runs migration (see Phase 1), then returns the migrated value. No silent fallback either way.
  - **Cache miss, RVF read error** (any error from `RvfBackend` other than miss — `RvfCorruptError`, `RvfNotInitializedError`, IO error): throws. Cache is not populated. Caller surfaces the error.
  - **Cache miss, RVF entry corrupt** (decode/typecheck failure on a present entry): throws. Cache is not populated. `feedback-no-fallbacks` applies.
  - After Phase 5, no `catch {}` exists in the function body.
- **`saveHiveState` post-conditions**:
  - **Backend success**: every entry in `state.sharedMemory` is durably present in RVF before the function returns. Durability is provided by RVF's existing `appendToWal` + compaction + tmp-fsync-rename sequence; not invented here.
  - **Backend failure**: the call throws; the LRU cache is **not** updated for any of the affected keys (avoids the inverse of cache stampede — stale cache after failed write); caller surfaces the error.
  - **Partial application**: impossible at the API boundary. RVF's lock holds across mutate + WAL append + compact as one atomic region (see lines 438-490 in `rvf-backend.ts`). If a crash occurs mid-batch, the WAL replay on restart either yields all entries or none for that batch.
- **LRU shape**: process-local `Map`-backed LRU. Key = the `state.sharedMemory` map key per ADR-0122 §312-314 (`MemoryEntry` has no `id` field — the map key IS the per-entry key). Value = the typed record `{ value, type, ttlMs, expiresAt, createdAt, updatedAt }` from ADR-0122 — never a flat string. Capacity = `RUFLO_HIVE_CACHE_MAX` (default 1024). Eviction = move-to-front on `get`/`set`, evict oldest at capacity overflow. Eviction never deletes from RVF — it only drops the in-memory copy.
- **Durability invariant**: 100% concurrent-write durability under the acceptance probe `check_adr0123_concurrent_write_durability`. 99.x is treated as not-fixed per `feedback-data-loss-zero-tolerance`. Mechanism: RVF JS WAL + fsync + atomic rename (existing). SQLite fallback path inherits better-sqlite3's `PRAGMA journal_mode = WAL` (already on by default at `sqlite-backend.ts:121`).
- **No new SQL pragma**: this ADR introduces zero new `PRAGMA` calls. The SQLite fallback's WAL is asserted defensively in tests but the pragma itself is pre-existing. The ADR-0086 Debt 7 invariant is preserved (no co-import).
- **sql.js carve-out — read-only migration tooling**: the lone exception to "no sql.js in memory package" is `rvf-migration.ts:128` which dynamically imports sql.js for ONE-WAY legacy SQLite-to-RVF migration. This is read-only migration tooling, never an active store; the durability argument is unchanged.

## Pseudocode

```text
loadHiveState():                                        # branches: cache-hit, cache-miss-rvf-hit,
                                                        # cache-miss-rvf-miss-legacy, cache-miss-rvf-miss-default,
                                                        # cache-miss-rvf-error, cache-miss-rvf-corrupt
    cacheKey = HIVE_STATE_DOC_KEY
    if cache.has(cacheKey):
        return cache.get(cacheKey)                      # move-to-front side-effect (cache-hit)

    try:
        record = rvfBackend.read(cacheKey)              # throws on IO/corruption/not-initialized
    catch RvfReadError as e:
        throw e                                         # cache-miss-rvf-error: surface, no catch {}

    if record is RVF_MISS:
        if legacyJsonExists():
            migrated = readLegacyJson()                 # cache-miss-rvf-miss-legacy
                                                        # parse error -> throw, no catch
            rvfBackend.write(cacheKey, migrated)        # inherits RVF's WAL+fsync+rename
            renameLegacyJson("state.json.legacy")       # preserve, not delete
            cache.set(cacheKey, migrated)
            return migrated
        return defaultState()                           # cache-miss-rvf-miss-default

    if not isWellFormedHiveState(record):
        throw RvfCorruptError(cacheKey)                 # cache-miss-rvf-corrupt: feedback-no-fallbacks

    cache.set(cacheKey, record)                         # cache-miss-rvf-hit
    return record

saveHiveState(state):
    rvfBackend.write(HIVE_STATE_DOC_KEY, state)         # RVF: appendToWal -> compactWal -> tmp+fsync+rename
                                                        # one atomic region under JS lock; throws on backend failure
    for (key, entry) in state.sharedMemory:             # per ADR-0122 §312-314: the per-entry key
        rvfBackend.write(entryKey(key), entry)          # IS the state.sharedMemory map key.
                                                        # MemoryEntry has no `id` field — typed shape from ADR-0122.
    cache.set(HIVE_STATE_DOC_KEY, state)                # update cache only after RVF acks every write

# No backend selector pseudocode is required by this ADR.
# - rvf-backend.ts has no SQLite path; its WAL is the .wal sidecar (line 1917 appendToWal).
# - sqlite-backend.ts (fallback only on RVF init failure) already issues PRAGMA journal_mode = WAL
#   at line 121. Defensive integration test asserts the readout. No new pragma is introduced here.
# - sql.js is not in the memory-package import graph and is out of scope for this ADR.
```

## Architecture

- **Entry point** (verified line refs): `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:180` (`loadHiveState`) and `:201` (`saveHiveState`) become thin wrappers over the RVF backend with the cache layer in front. The silent `catch {}` at lines 181-189 is removed.
- **LRU layer placement**: in-process module-scope cache inside `hive-mind-tools.ts`, or extracted to `v3/@claude-flow/cli/src/mcp-tools/hive-mind-cache.ts` if the file would otherwise exceed the 500-line CLAUDE.md limit. One cache per CLI invocation; daemon has its own.
- **Backend boundary**: `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts` (verified: 2616 lines; exports `RvfBackend`, `RvfCorruptError`, `RvfNotInitializedError`). RVF owns its own JS-level WAL stack: `appendToWal` (line 1917), `compactWal`, atomic persist with explicit fsync (line 2513) and best-effort directory entry fsync (line 2538). The hive-mind tools file never imports better-sqlite3 or sql.js directly — only the RVF facade. This keeps the ADR-0086 Debt 7 invariant testable: `grep -l "from 'better-sqlite3'" dist/` and `grep -l "from 'sql.js'" dist/` must not both return the same file. (Verified pre-implementation: RVF's `dist/` imports neither; only `dist/v3/@claude-flow/memory/src/sqlite-backend.js` imports better-sqlite3.)
- **SQLite fallback boundary**: `sqlite-backend.ts` (line 121: `this.db.pragma('journal_mode = WAL')`) is invoked only if RVF init fails. The integration test asserts the pragma readout but introduces no pragma code.
- **Cross-process invalidation**: explicitly out of scope. Contract: RVF is source of truth; any caller getting a fresh `loadHiveState` re-reads from RVF and overwrites its cache entry. Daemon + CLI co-existence works because both call `loadHiveState` per-operation, not at startup-only.

## Refinement

### Edge cases

- **Cache eviction during a long-running queen session**: a queen holding 10K+ entries hot thrashes the default 1024 capacity. Operator bumps `RUFLO_HIVE_CACHE_MAX`; eviction-rate metric makes the under-sizing observable.
- **Concurrent writes during eviction**: LRU eviction is a `Map` operation, not an RVF operation. Eviction never drops durable state — only the in-memory copy. RVF write happens **before** cache update; if cache eviction races a concurrent write, the post-eviction `get` re-fetches from RVF (cache lag is bounded to one round-trip; durability is unaffected).
- **Daemon and CLI both holding caches**: documented as RVF-is-source-of-truth. Both processes call `loadHiveState` per-operation, not at startup-only, so stale-cache windows are bounded by call cadence. TTL-based invalidation is **not** introduced here — the typed `MemoryEntry` already carries `expiresAt` from ADR-0122 and lazy eviction at the cache boundary uses that. Push-based invalidation (one process notifying another's cache to drop a key) is out of scope; if a real coherency bug surfaces, a future ADR adds a process-bus invalidation channel.
- **Corrupt RVF entry surfaced loudly**: per `feedback-no-fallbacks`, the silent `catch {}` removal is part of this ADR. `loadHiveState`'s post-condition table (Specification §) covers each branch — no path returns `defaultState()` after a backend error.
- **sql.js path**: not introduced here, intentionally. sql.js does not provide a real WAL — `PRAGMA journal_mode = WAL` against an in-memory virtual filesystem cannot survive `SIGKILL`; the only persistence primitive is `db.export()` of the entire blob. If a future ADR adds a sql.js-backed memory path, it owns its own durability story; this ADR's 100% claim is scoped to RVF-primary + better-sqlite3-fallback (see §Risks #6 (sql.js out-of-scope)).
- **`saveHiveState` partial failure**: RVF writes are atomic per the WAL+lock region (`rvf-backend.ts:438-490`). On failure, the call throws and the cache is **not** updated for any of the affected keys. No half-applied state is observable from outside the function.

### Error paths

- **Corrupt RVF entry on read**: throws (`RvfCorruptError`), propagates out of `loadHiveState`; cache untouched. `feedback-no-fallbacks`.
- **RVF init failure**: throws (`RvfNotInitializedError`); the SQLite fallback path is the documented recovery (selected by the hybrid backend selector, not by this ADR's code). The fallback's WAL is asserted in tests.
- **Legacy JSON parse error during migration**: throws. Operator must intervene (rename `state.json` aside, retry init). We do not silently default.
- **SQLite-fallback WAL not engaged**: integration test fails loudly; not a runtime fallback.

### Test list

- **Unit** (`tests/unit/adr0123-lru-cache.test.mjs`): cache hit on second `get`; cache miss after eviction; eviction order with `maxEntries + 5` inserts; typed-shape round-trip (cache returns `{ value, type, ttlMs, ... }`, not a flat string).
- **Integration** (`tests/unit/adr0123-rvf-backend.test.mjs`): RVF round-trip via `RvfBackend`; legacy `state.json` migration to `state.json.legacy` (non-destructive); SQLite-fallback path asserts `journal_mode = wal` on the better-sqlite3 connection; concurrent-write 100%-durability probe at the integration layer (gating measurement — fail the run on any loss).
- **Acceptance** (`lib/acceptance-adr0123-hive-memory-checks.sh` — wired in `scripts/test-acceptance.sh`):
  - `check_adr0123_concurrent_write_durability` — N concurrent writers, 100% read-back, parallel wave.
  - `check_adr0123_sigkill_crash_durability` — SIGKILL mid-batch, sequential post-join.
  - `check_adr0123_loadstate_no_silent_catch` — corrupt RVF entry forces `loadHiveState` to throw, not return default.
  - ADR-0086 Debt 7 invariant check (no dist file co-imports better-sqlite3 + sql.js) runs as precondition.

## Completion

- **Annotation lift criterion**: T5 marked `complete` in ADR-0118 §Status, with Owner/Commit columns naming a green-CI commit. Annotation lift fires on the next materialise run after that flip. (Per ADR-0118 §Annotation lifecycle.)
- **Acceptance wire-in**: `lib/acceptance-adr0123-hive-memory-checks.sh` is added to `scripts/test-acceptance.sh` in the post-init parallel wave. Concurrent-write probe runs in the parallel wave; SIGKILL crash-durability runs sequentially after the wave joins (it kills processes — must not race other parallel checks).
- **Validates `feedback-data-loss-zero-tolerance` bound**: completion is conditional on the concurrent-write probe reporting exactly 100% durability. Anything less and T5 stays `in-progress`.

## Acceptance criteria

- [ ] Phase 1: `loadHiveState` / `saveHiveState` route through `rvf-backend.ts` (`RvfBackend`); JSON file no longer on the happy path
- [ ] Phase 1: Legacy `state.json` migrates to RVF on first load, gets renamed to `state.json.legacy` (preserved, not deleted)
- [ ] Phase 2: LRU cache with `RUFLO_HIVE_CACHE_MAX` env var; eviction correctness verified; eviction-rate metric exposed
- [ ] Phase 3: SQLite-fallback path's pre-existing `PRAGMA journal_mode = WAL` (`sqlite-backend.ts:121`) is asserted in integration test (no silent regression). No new pragma is introduced.
- [ ] Phase 4: **`check_adr0123_concurrent_write_durability` achieves 100% durability — not 99%, not 99.9%, not 99.99%**, per `feedback-data-loss-zero-tolerance.md`
- [ ] Phase 4: `check_adr0123_sigkill_crash_durability` passes (SIGKILL-without-power-loss; page cache intact); no half-written entries observable post-restart. Companion test file: `tests/unit/adr0123-sigkill-durability.test.mjs`. Fsync-drop / power-loss durability is NOT a gate for this ADR — that is ADR-0130's surface.
- [ ] Phase 4: `check_adr0123_loadstate_no_silent_catch` passes; corrupt entries throw, do not return default state
- [ ] Phase 4: Cache hit ratio is measurable and non-zero in steady-state read workloads
- [ ] Phase 5: Silent `catch {}` at `hive-mind-tools.ts:181-189` removed; corrupted-state errors propagate
- [ ] `npm run test:unit` green
- [ ] `npm run test:acceptance` green (Verdaccio up)
- [ ] ADR-0086 Debt 7 invariant check still green (no dist file co-imports better-sqlite3 + sql.js)
- [ ] ADR-0118 §T5 status row updated to ✓ with this ADR's commit hash

## Risks

1. **Backend choice contention.** Per ADR-0118 §T5 escalation criterion: *"Promote to own ADR if backend choice (RVF vs. AgentDB-direct vs. SQLite-only) becomes contested — this brushes against ADR-0086 Debt 7 history."* This ADR is that promotion. The chosen direction (RVF as primary; better-sqlite3 as the only SQLite fallback) follows `project-rvf-primary` and respects the no-co-import invariant. If a future ADR proposes AgentDB-direct as primary, or introduces a sql.js-backed memory path, it must explain how it doesn't reintroduce the better-sqlite3 + sql.js co-import problem and how it provides a real durability primitive (sql.js's `db.export()` is not one — see §Risks #6 (sql.js out-of-scope)).
2. **Concurrent-write probe failure.** The 100% durability bar is delivered by RVF's existing JS WAL + fsync + atomic rename. A failing probe means RVF's primitive is being misused (cache update before backend ack, missed `await`, lock not held across mutate+WAL+compact, or a regression in `appendToWal`/`compactWal`). The bar is non-negotiable — 99.9% pass is a fail.
3. **Migration data loss.** Phase 1's legacy-JSON migration must not delete `state.json`; it renames to `state.json.legacy` so recovery is possible if RVF write succeeds but later state becomes unreadable. Tests cover the migration path.
4. **Cache coherency across processes.** Process-local cache is intentional; cross-process invalidation is out of scope. If daemon + CLI hold stale caches simultaneously, RVF is the source of truth — both clear cache on next `loadHiveState`. This is documented but not enforced; if it becomes a real problem, a future ADR can add explicit invalidation messages.
5. **SQLite fallback regression.** `sqlite-backend.ts:121` already issues `PRAGMA journal_mode = WAL` by default. The integration test asserts the readout and fails loudly on any future regression (e.g. someone overrides `pragmas.journalMode` to `'DELETE'`). This risk is bounded; the assertion is the mitigation.
6. **sql.js durability is out of scope, not solved.** sql.js operates against an in-memory virtual filesystem; setting `PRAGMA journal_mode = WAL` on it is a no-op for crash recovery (no `.wal` file exists in any persistent location, and the only persistence primitive is `db.export()` of the entire blob). This ADR avoids the problem by not introducing a sql.js memory path and asserting (via the Debt 7 invariant test) that none exists. If a future change introduces one, that change must justify a separate durability story or accept that it cannot meet `feedback-data-loss-zero-tolerance` for hive memory.
7. **RVF appendFile-based WAL does not fsync** (`rvf-backend.ts:488-491`) — survives process-kill on intact page cache, NOT power loss. The acceptance gate for this ADR is SIGKILL-without-power-loss, which RVF's existing stack guarantees. Mitigation: ADR-0130 (RVF WAL fsync durability) escalates and owns the fsync-the-WAL-append change required for true power-loss durability. Not in T5 scope.

## References

- ADR-0095 d11 — RVF tmp-fsync-rename durability (mechanism inherited here, not invented)
- ADR-0098 — swarm-state O_EXCL lock pattern (model for the existing `withHiveStoreLock` at `hive-mind-tools.ts:212+`)
- ADR-0104 §5 — atomic write (tmp + rename) in current `saveHiveState` (preserved for legacy-file rename only)
- ADR-0116 — hive-mind marketplace plugin
- ADR-0118 — hive-mind runtime gaps tracker (§T5 source material)
- ADR-0122 — T4 typed memory shape (LRU caches the `MemoryEntry` shape defined there)
- ADR-0086 Debt 7 — better-sqlite3 / sql.js placement history (stable state: optionalDependencies + open-database.ts deleted; invariant: no co-import in any dist file)
- ADR-0114 — hive-mind 3-layer architecture (substrate / protocol / execution)
- ADR-0130 — RVF WAL fsync durability (follow-up; closes the residual fsync-drop window for true power-loss durability that this ADR scoped out as H3 deferral)
- Memory: `project-rvf-primary` — RVF is primary storage; SQLite is fallback only
- Memory: `feedback-data-loss-zero-tolerance` — 100% durability or not fixed
- Memory: `feedback-no-fallbacks` — silent catch / fallback branches violate the no-fallbacks rule
- Memory: `feedback-all-test-levels` — unit + integration + acceptance every pass
- Source: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:180` (`loadHiveState`), `:201` (`saveHiveState`), `:181-189` (silent `catch {}` removed by Phase 5), `:212+` (`withHiveStoreLock` retained for legacy migration)
- Source: `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts` (verified 2616 lines; `RvfBackend` line 76; `appendToWal` line 1917; tmp-fsync-rename line 2513; dir-fsync line 2538; `RvfCorruptError` line 2573; `RvfNotInitializedError` line 2606)
- Source: `forks/ruflo/v3/@claude-flow/memory/src/sqlite-backend.ts:121` (`PRAGMA journal_mode = WAL`, default — pre-existing)

## Review notes

Open questions raised during review. None block the chosen option, but each should be confirmed before implementation merges.

**Q1. Atomic-rename assumption in current `saveHiveState`.** The current code (lines 201-210) already does atomic write per ADR-0104 §5 (tmp + rename), and cross-process serialisation via `withHiveStoreLock` (line 212+, ADR-0098-style O_EXCL sentinel). The original Context section described this as "non-atomic, full rewrite, no WAL" — that was wrong on the atomic dimension and right on the no-WAL/no-RVF dimension. This revision corrects the framing. Confirm the existing atomic+lock infrastructure is preserved for the legacy-file rename path (it is no longer load-bearing for the happy path once Phase 1 lands, but the legacy migration uses it for the `state.json` → `state.json.legacy` rename). — resolved (triage row 21: atomic write infra preserved)

**Q2. Cache update ordering and the cache-set-on-failure trap.** Specification says cache is updated "only after RVF acks every write". The pseudocode reflects this: `rvfBackend.write(...)` for the doc and every entry, then `cache.set(...)`. Confirm the Phase 2 implementation does not interleave `cache.set` between per-entry writes — a partial RVF batch followed by `cache.set` of the in-flight `state` would advertise unflushed state to subsequent `get` callers in this process. The integration test should explicitly cover "RVF write throws halfway through; subsequent `loadHiveState` returns the pre-call state, not the in-flight state". (triage row 22 — DEFER-TO-IMPL: cache.set only after RVF acks all writes; integration test asserts post-SIGKILL pre-call state)

**Q3. Cross-process cache coherency in practice.** Daemon and CLI both call `loadHiveState` per-operation, which re-reads from RVF and overwrites the cache entry. This bounds stale-cache windows to one operation cadence. Confirm at implementation time that no caller path uses a long-lived in-memory copy (e.g. caching `state` in module scope and mutating it across calls without re-reading) — that pattern would break the "RVF is source of truth" contract. The risk is that an existing caller in `hive-mind-tools.ts` outside the audited 180-210 range may be doing exactly this. Audit the file before Phase 2 lands. — resolved (triage row 24: hive-mind-tools.ts has no module-scope state; per-operation reload pattern audit clean)

(Resolved questions removed: original Q1 "sql.js WAL feasibility" — sql.js is out-of-scope, confirmed at §Specification carve-out and §Risks #6; original Q4 "RVF JS WAL vs SIGKILL granularity (fsync)" — fsync deferred to ADR-0130 per §Validation, §Consequences Negative, §Risks #7.)
