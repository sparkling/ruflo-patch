# ADR-0122: Hive-mind T4 — 8 memory types with TTL

- **Status**: **Implemented (2026-05-03)** per ADR-0118 §Status (T4 complete; fork ca9e29e2c + ruflo-patch 74f29e7). Cites: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts:966-1039` (`hive-mind_memory` tool — typed `MemoryEntry` shape, lazy + periodic eviction, `withHiveStoreLock` on all four actions); `forks/ruflo/v3/@claude-flow/cli/__tests__/mcp-tools-deep.test.ts` (unit + integration matrix); `lib/acceptance-hive-memory-types.sh` (8-type matrix, TTL expiry, type filter, legacy migration, error rejection — wired in `scripts/test-acceptance.sh`).
- **Date**: 2026-05-02
- **Deciders**: Henrik Pettersen
- **Depends on**: ADR-0116 (hive-mind marketplace plugin — verification matrix), ADR-0118 (hive-mind runtime gaps tracker — task definition)
- **Related**: ADR-0114 (substrate/protocol/execution layering)
- **Scope**: Fork-side runtime work in `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts`. Per `feedback-patches-in-fork.md`, USERGUIDE-promised features that don't work are bugs and bugs are fixed in fork.

## Context

ADR-0116's verification matrix flagged the row "8 memory types with TTL" as ⚠ partial. The USERGUIDE block `**Collective Memory Types:**` advertises 8 distinct types, each with a documented TTL semantic:

| Type | TTL |
|---|---|
| `knowledge` | permanent |
| `context` | 1 hour |
| `task` | 30 minutes |
| `result` | permanent |
| `error` | 24 hours |
| `metric` | 1 hour |
| `consensus` | permanent |
| `system` | permanent |

The runtime in `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts` (the `hive-mind_memory` MCP tool, currently at `:966-1039`) implements `get`/`set`/`delete`/`list` against a flat `state.sharedMemory[key] = value` dict. The tool already wraps `set`/`delete` in `withHiveStoreLock` (cross-process lock) but `get`/`list` are intentionally lock-free read paths. There is **no type discriminator, no TTL field, no eviction logic**. Every entry is permanent and untyped — the 8-type contract is documentation-only.

ADR-0118 §T4 owns this gap as task T4 with no Tn dependencies. This ADR closes T4.

## Decision drivers

- USERGUIDE 8 distinct types each with a documented TTL — runtime currently honours none of them, so the entry shape itself must change (type discriminator + TTL fields), not just the handler logic
- Per-type defaults from the USERGUIDE table must be encoded in code, not just docs, so a `set` without explicit `ttl` resolves to the documented value for its type rather than "permanent"
- Per `project-rvf-primary`, the entry shape must map 1:1 onto RVF row columns so T5 (ADR-0123) can swap JSON-file persistence for RVF without re-deriving fields
- ADR-0123 (T5 — LRU cache + RVF + SQLite WAL) caches THIS shape and removes JSON-file persistence; T4's serialized format must therefore be valid for both the pre-T5 JSON-on-disk era AND the post-T5 RVF row mapping
- Eviction must be observable to T5's cache layer — T5 invalidates on entry expiry, so T4 needs an explicit deletion surface (not just lazy-on-read)
- `feedback-no-fallbacks.md`: a missing `type` argument, an unknown `type` value, or unparseable `ttlMs` must throw — silently defaulting omitted `type` to `system` (giving a caller who forgot `type: 'task'` permanent retention instead of 30-min) is a soft fallback and is rejected here
- Single touch site (`hive-mind-tools.ts` `hive-mind_memory` tool) keeps blast radius small relative to splitting into 8 top-level dicts which would ripple through every existing call site

## Considered options

- **Option A — Inline typed entry shape** (CHOSEN): each value becomes `{ value, type, ttlMs, expiresAt, createdAt, updatedAt }` keyed in a single `state.sharedMemory` map
- **Option B — Split top-level dicts**: separate maps per type (`state.knowledge`, `state.context`, `state.task`, …) with TTL fields on each entry
- **Option C — Typed-adapter layer**: keep flat dict; introduce an adapter module that wraps reads/writes with type+TTL metadata stored sidecar in `state.sharedMemoryMeta`

## Pros and cons of the options

**Option A — Inline typed entry shape (CHOSEN)**
- Pros: single index keeps T5 cache key space simple; one persistence path in `saveHiveState`/`loadHiveState`; type filtering on `list` is a single predicate on iteration; matches RVF row mapping directly; minimal touch surface (single file)
- Cons: every per-type query (`list({type: 'task'})`) is a full-scan filter — O(N) over all entries regardless of how many match; eviction is not free per-key — needs a periodic sweep AND lazy-on-read to bound memory growth; legacy flat-dict entries on disk must be migrated on load (non-destructive default to `type: 'system'`, but every old write becomes one schema-bridge operation); lazy eviction does a `delete` on `state.sharedMemory`, so the read path must enter the cross-process lock or race writers — eliminating the existing lock-free `get`/`list` fast path; existing `hive-mind_memory.set` call sites that omit `type` must be migrated to pass an explicit `type` in the same commit (no graceful default)

**Option B — Split top-level dicts (`state.knowledge`, `state.context`, …)**
- Pros: per-type list is O(N_type) instead of O(N_total); type-specific eviction strategies could diverge cleanly later; legacy migration is a one-shot bucket-and-distribute
- Cons: every existing call site that reads `state.sharedMemory` (and there are several outside this tool) must now know which of 8 dicts to consult, OR we keep `sharedMemory` as a virtual merged view — adding a layer; `get(key)` without a type hint becomes O(8) lookups across the dicts; T5 cache key space fragments across 8 namespaces; persistence path in `saveHiveState` multiplies into 8 serialization sites; cross-type `list({})` requires merging 8 sources

**Option C — Typed-adapter layer (`state.sharedMemory` flat + sidecar `state.sharedMemoryMeta`)**
- Pros: existing flat dict stays untouched; type+TTL is purely additive; legacy entries need no migration (a missing meta entry just means "no TTL")
- Cons: two parallel persistence paths (value dict + metadata dict) double the failure surface — a `saveHiveState` that lands the value but not the meta produces an orphaned untyped entry; T5 must reach into both stores; the "missing meta means permanent system" branch is itself a silent fallback per `feedback-no-fallbacks.md` — recovery from partial writes becomes indistinguishable from legacy

## Decision outcome

Chosen option: **Option A — inline typed entry shape**. Each entry becomes:

```typescript
state.sharedMemory[key] = {
  value: unknown,
  type: 'knowledge' | 'context' | 'task' | 'result' | 'error' | 'metric' | 'consensus' | 'system',
  ttlMs: number | null,        // null = permanent
  expiresAt: number | null,    // null = permanent; epoch ms otherwise
  createdAt: number,           // epoch ms (set on first write)
  updatedAt: number,           // epoch ms (refreshed on every write)
}
```

The `set` action accepts `type` (one of the 8) and optional `ttlMs`; defaults derive from the USERGUIDE table. Eviction is **lazy on `get`/`list` AND a periodic sweep**, with both paths sharing the same predicate and both running inside `withHiveStoreLock` because they mutate `state.sharedMemory`. `expiresAt` is persisted so TTLs survive process restart.

This option is chosen because it is the only one that simultaneously (1) presents a single index for T5's cache key space, (2) maps directly onto the RVF row shape T5 will use, (3) keeps all eight type-defaulting and eviction logic on one touch site, and (4) avoids the orphaning failure mode of Option C's sidecar. The honest trade-off accepted: per-type `list` becomes O(N_total) full-scan filtering rather than O(N_type), and the existing lock-free `get`/`list` fast path collapses because lazy eviction must take the write lock. Both are bounded and acceptable for hive-mind workloads (entry counts in the thousands, not millions).

## Consequences

**Positive**
- Single index keeps T5's LRU cache key space simple — one cache namespace, no per-type fragmentation
- Single persistence path in `saveHiveState`/`loadHiveState` — one round-trip test covers all 8 types
- RVF mapping is direct — typed entry fields become RVF row columns (T5 lands without re-deriving)
- Lazy-on-read eviction means callers never see expired data even between sweeps
- Default-TTL table is a single `const` adjacent to the handler; updating one type updates docs + code together

**Negative**
- Existing flat-dict entries require migration on first read after T4 lands — `loadHiveState` detects the legacy shape (raw value where a `MemoryEntry` is expected) and rewrites it as `{ value, type: 'system', ttlMs: null, expiresAt: null, createdAt: now, updatedAt: now }`. Non-destructive (no value mutated, no entry dropped) but every legacy write incurs a one-time schema-bridge cost
- Per-type `list` is a full scan — O(N_total) filter rather than O(N_type). Acceptable at hive-mind scale; documented so a future ADR can revisit if entry counts cross 10K
- Lazy eviction in `get`/`list` mutates `state.sharedMemory`, so both paths must take `withHiveStoreLock` — losing the existing lock-free read fast path
- Periodic sweep timer must be lifecycle-managed (registered at hive init, cleared in `hive-mind_shutdown`) — orphaned timers leak across hive sessions if missed
- Daemon and CLI processes both running lazy/scheduled eviction can race on a `delete state.sharedMemory[key]` for the same expired key — resolved by the `withHiveStoreLock` cross-process lock; the second deleter is a no-op
- Adds 4 extra fields and one `Date.now()` per write — negligible at hive-mind scale

## Validation

**Unit tests** (`forks/ruflo/v3/@claude-flow/cli/__tests__/mcp-tools-deep.test.ts`):
- `t4_set_produces_typed_entry_shape` — `set` writes a `MemoryEntry` with all six fields populated
- `t4_eviction_predicate_truth_table` — predicate returns true for `expiresAt = now - 1`, false for `expiresAt = now + 1000`, false for `expiresAt = null`, true for `expiresAt = now` (boundary), true for `expiresAt = 0` (epoch)
- `t4_per_type_defaults_table` — one assertion per type: `knowledge`→null, `context`→3_600_000, `task`→1_800_000, `result`→null, `error`→86_400_000, `metric`→3_600_000, `consensus`→null, `system`→null
- `t4_unknown_type_throws` — `set` with `type: 'invalid'` throws `InvalidMemoryTypeError`; no partial write to `state.sharedMemory`
- `t4_non_numeric_ttl_throws` — `set` with `ttlMs: 'abc'` throws `InvalidTTLError`; no partial write
- `t4_ttl_zero_accepted` — `set` with `ttlMs: 0` produces `expiresAt = now`; subsequent `get` (with any clock advance) returns null and evicts
- `t4_negative_ttl_accepted_and_evicted` — `set` with `ttlMs: -1000` produces `expiresAt` in the past; immediate `get` returns null and evicts
- `t4_missing_type_throws` — `set` with `type` undefined throws `MissingMemoryTypeError`; no partial write to `state.sharedMemory`
- `t4_createdAt_preserved_on_update` — second `set` for the same key preserves `createdAt` and refreshes `updatedAt`

**Integration tests** (same file, with real `state.sharedMemory`):
- `t4_round_trip_within_ttl` — `set` with `ttlMs: 5000` → `get` returns value
- `t4_lazy_eviction_on_get` — `set` with `ttlMs: 100` → wait 150ms → `get` returns null AND the entry key is absent from `state.sharedMemory`
- `t4_lazy_eviction_on_list` — set 3 entries, two with short TTL; wait past TTL; `list` returns only the long-lived one and the two short-lived keys are absent from `state.sharedMemory`
- `t4_persistence_preserves_expiresAt` — `set` with absolute `expiresAt = T` → `saveHiveState` → `loadHiveState` → `get` evicts at T regardless of restart wall-clock
- `t4_legacy_migration_non_destructive` — pre-place `state.sharedMemory[key] = "raw"`, `loadHiveState` rewrites to `{ value: "raw", type: 'system', ttlMs: null, expiresAt: null, createdAt: <load-time>, updatedAt: <load-time> }`; `get` returns `"raw"`
- `t4_periodic_sweep_removes_untouched_expired` — register hive, `set` with `ttlMs: 100`, advance fake timers by sweep interval (60s default), assert key absent from `state.sharedMemory` with no intervening `get`/`list`
- `t4_sweep_handle_cleared_on_shutdown` — register hive, capture `setInterval` handle, call `hive-mind_shutdown`, assert handle cleared (no orphaned timer fires after shutdown)
- `t4_concurrent_eviction_no_data_loss` — two processes each call `get` on the same expired key under `withHiveStoreLock`; the second sees the entry absent and returns null without throwing

**Acceptance tests** (`lib/acceptance-hive-memory-types.sh` wired via `scripts/test-acceptance.sh` in init'd project):
- `acc_t4_8_type_matrix` — for each of the 8 types: `hive-mind_memory set --type=<T>` then `get`; round-trips successfully and persisted state shows the documented default `ttlMs`
- `acc_t4_ttl_expiry_short` — `set --ttlMs=200`, `sleep 0.5`, `get` returns null
- `acc_t4_type_filter_list` — set 3 entries (two `task`, one `knowledge`), `list --type=task` returns exactly the two task entries
- `acc_t4_unknown_type_rejected` — `set --type=invalid` exits non-zero with `InvalidMemoryTypeError`
- `acc_t4_missing_type_rejected` — `set` with no `--type` flag exits non-zero with `MissingMemoryTypeError`; no entry written to `state.sharedMemory`
- `acc_t4_legacy_dict_migration` — pre-place a legacy untyped entry in `state.json`, run a `get` through the CLI, assert success and migrated shape on disk

## Implementation plan

Single file: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts`. The `hive-mind_memory` tool currently spans `:966-1039`; the change touches that handler plus `loadHiveState` (legacy migration on read) and `saveHiveState` (typed serialization). T5 (ADR-0123) replaces JSON-file persistence with RVF; T4's serialized format must be valid for both eras (JSON object vs RVF row columns) — same field names map either way.

1. **Typed shape** — replace `state.sharedMemory[key] = value` with the `MemoryEntry` record below.
2. **`set` action** — `type` is required (no default); a missing `type` argument throws `MissingMemoryTypeError` synchronously, an unknown `type` throws `InvalidMemoryTypeError`. `ttlMs` defaults from the USERGUIDE table when `type` is provided without `ttlMs`. No partial write on either throw.
3. **Audit existing call sites** — grep `forks/ruflo/v3/@claude-flow/cli/src` for `hive-mind_memory` `set` invocations that omit `type`; update each to pass an explicit `type`. Single-file scope (the tool itself plus its direct CLI callers); landed in the same commit so no caller is left calling the throwing API.
4. **Lazy eviction** — on `get` and `list`, check the eviction predicate; if expired, `delete` the entry and exclude from results. **Both paths now run inside `withHiveStoreLock`** because they mutate state — the existing lock-free fast path on read is forfeit.
5. **Periodic sweep** — register `setInterval` (default 60s, env-overridable via `CLAUDE_FLOW_HIVE_SWEEP_MS`) at hive init; sweep takes `withHiveStoreLock`, scans `state.sharedMemory`, deletes expired. Handle stored on hive instance, cleared in `hive-mind_shutdown`.
6. **Persisted `expiresAt`** — include in `saveHiveState`'s output. `loadHiveState` detects legacy raw values and rewrites them on read (one-time, non-destructive; legacy entries default to `type: 'system'` because the runtime API throw doesn't apply to a one-shot disk-format upgrade per `feedback-data-loss-zero-tolerance.md`).
7. **Type filter on `list`** — extend `inputSchema` with optional `type` parameter; full-scan filter on iteration.
8. **Tests** — full Validation matrix above (unit + integration + acceptance) added in the same commit per `feedback-all-test-levels.md` and `feedback-no-squelch-tests.md`.

## Specification

**Typed-entry shape** at the `hive-mind_memory` tool handler (currently `hive-mind-tools.ts:966-1039`):

```typescript
type MemoryType = 'knowledge' | 'context' | 'task' | 'result' | 'error' | 'metric' | 'consensus' | 'system';

interface MemoryEntry {
  value: unknown;
  type: MemoryType;
  ttlMs: number | null;        // null = permanent
  expiresAt: number | null;    // null = permanent; epoch ms otherwise
  createdAt: number;           // epoch ms (set on first write)
  updatedAt: number;           // epoch ms (refreshed on every write)
}
```

**Schema evolution**: this shape has no explicit `typeVersion` field. The migration story relies on shape-detection (presence of `type` and `ttlMs` keys) — adequate for the legacy→T4 transition. If a future ADR changes the entry shape (e.g. adding fields, narrowing `value`), it MUST add a `schemaVersion: number` field at that time and define the migration path. T4 deliberately does not pre-add a version field to avoid speculative complexity.

**Default TTLs per type** (derived from USERGUIDE `**Collective Memory Types:**`):

| Type | Default `ttlMs` |
|---|---|
| `knowledge` | `null` (permanent) |
| `context` | `3_600_000` (1 hour) |
| `task` | `1_800_000` (30 minutes) |
| `result` | `null` (permanent) |
| `error` | `86_400_000` (24 hours) |
| `metric` | `3_600_000` (1 hour) |
| `consensus` | `null` (permanent) |
| `system` | `null` (permanent) |

**Eviction predicate**: `entry.expiresAt !== null && Date.now() >= entry.expiresAt`. When true, the entry is dropped from `state.sharedMemory` and excluded from result sets. Same predicate is used by lazy eviction (`get`, `list`) and the periodic sweep — no behavioural divergence between paths.

**Eviction concurrency**: `get` and `list` invoke `delete state.sharedMemory[key]` when an entry is expired; the existing tool wraps `set` and `delete` in `withHiveStoreLock`. T4 extends this to ALL four actions — the lock-free `get`/`list` fast path is removed because mutation during eviction would race writers. The periodic sweep also takes the lock.

**Input validation** (per `feedback-no-fallbacks.md`):
- `set` with `type` undefined → throws `MissingMemoryTypeError()` synchronously, no partial write. Required argument; no silent default.
- `set` with `type` not in the 8-value enum → throws `InvalidMemoryTypeError(type)` synchronously, no partial write
- `set` with non-numeric or non-finite `ttlMs` (NaN, Infinity, string) → throws `InvalidTTLError(ttlMs)`, no partial write
- `set` with `ttlMs = 0` → accepted; `expiresAt = now`; entry is evicted on the next `get` if any clock tick has elapsed (treated as a deliberate near-instant TTL, not pathological)
- `set` with negative `ttlMs` → accepted; `expiresAt = now + negative` is in the past; entry is evicted on the next `get`. Treated as a no-op-style write rather than rejection (allows callers to express "evict if clock anomaly" without a special path)

**MCP tool surface** on `hive-mind_memory`:
- `set(key, value, { type, ttlMs? })` — `type` is required (one of the 8); missing or unknown `type` throws synchronously. `ttlMs` defaults from the per-type table when omitted.
- `get(key)` — returns `value` or `null`; lazily evicts expired (under lock)
- `delete(key)` — removes entry unconditionally (under lock)
- `list({ type? })` — returns map of non-expired entries; filters by `type` when provided; lazy eviction during iteration (under lock)

## Pseudocode

All four actions wrap in `withHiveStoreLock` because all four mutate `state.sharedMemory` (write, or read-with-eviction). The existing lock-free read path on `get`/`list` is forfeit.

**`set` with type and TTL resolution:**

```
function set(key, value, opts):
  return withHiveStoreLock(async () => {
    if opts.type is undefined:
      throw MissingMemoryTypeError()                   # required arg, no silent default
    type = opts.type
    if type not in MemoryType enum:
      throw InvalidMemoryTypeError(type)               # no partial write
    if opts.ttlMs is not undefined && !Number.isFinite(opts.ttlMs):
      throw InvalidTTLError(opts.ttlMs)
    ttlMs = opts.ttlMs ?? defaultTtlForType(type)
    now = Date.now()
    expiresAt = ttlMs === null ? null : now + ttlMs    # negative ttlMs accepted -> past
    state = loadHiveState()
    prior = state.sharedMemory[key]
    state.sharedMemory[key] = {
      value,
      type,
      ttlMs,
      expiresAt,
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
    }
    saveHiveState(state)
  })
```

**`get` with lazy eviction (now under lock):**

```
function get(key):
  return withHiveStoreLock(async () => {
    state = loadHiveState()
    entry = state.sharedMemory[key]
    if entry is undefined: return null
    if isExpired(entry):
      delete state.sharedMemory[key]
      saveHiveState(state)                             # eviction is durable
      return null
    return entry.value
  })

function isExpired(entry):
  return entry.expiresAt !== null && Date.now() >= entry.expiresAt
```

**`list` with filter and lazy sweep:**

```
function list(opts):
  return withHiveStoreLock(async () => {
    state = loadHiveState()
    result = {}
    mutated = false
    for [key, entry] in state.sharedMemory:
      if isExpired(entry):
        delete state.sharedMemory[key]
        mutated = true
        continue
      if opts.type && entry.type !== opts.type:
        continue
      result[key] = entry.value
    if mutated: saveHiveState(state)
    return result
  })
```

**Periodic sweep** (registered at hive init, cleared in `hive-mind_shutdown`):

```
sweepHandle = setInterval(() => {
  withHiveStoreLock(async () => {
    state = loadHiveState()
    mutated = false
    for [key, entry] in state.sharedMemory:
      if isExpired(entry):
        delete state.sharedMemory[key]
        mutated = true
    if mutated: saveHiveState(state)
  })
}, CLAUDE_FLOW_HIVE_SWEEP_MS ?? 60_000)

# in hive-mind_shutdown handler:
clearInterval(sweepHandle)
```

**Legacy migration on read** (one-time, in `loadHiveState`):

```
function loadHiveState():
  raw = readPersistedState()                            # JSON pre-T5; RVF row post-T5
  for [key, entry] in raw.sharedMemory:
    if !isMemoryEntryShape(entry):                      # legacy raw value
      now = Date.now()
      raw.sharedMemory[key] = {
        value: entry,
        type: 'system',
        ttlMs: null,
        expiresAt: null,
        createdAt: now,
        updatedAt: now,
      }
  return raw

function isMemoryEntryShape(v):
  return v != null && typeof v === 'object'
    && 'type' in v && 'ttlMs' in v
    && 'expiresAt' in v && 'createdAt' in v
```

## Architecture

**`hive-mind_memory` tool surface** (single file `hive-mind-tools.ts`, `hive-mind_memory` entry currently `:966-1039`):
- `inputSchema` extends to declare `type` (enum of 8) and `ttlMs` (number) as optional on `set`; `type` optional on `list`. Schema validation is the first throw site for unknown types.
- Handler reads `state.sharedMemory` (now `Record<string, MemoryEntry>`); all four actions branch on `action` and ALL run inside `withHiveStoreLock`.
- Default-TTL table lives as a top-level `const DEFAULT_TTL_MS_BY_TYPE: Record<MemoryType, number | null>` adjacent to the handler so the 8-row table is one file edit away from the type enum.
- Sweep handle stored on the module-scope hive registration so `hive-mind_shutdown` can `clearInterval` it.

**Eviction surface**:
- **Lazy-on-read** (`get`, `list`): predicate runs inline; expired entries are deleted under lock and `saveHiveState` is called when any deletion occurred. Guarantees no caller observes expired data.
- **Scheduled sweep**: default 60s, env-overridable via `CLAUDE_FLOW_HIVE_SWEEP_MS`. Bounds memory growth for entries no caller touches. Registered at hive init, cleared in `hive-mind_shutdown`. Same predicate, same lock — no behavioural divergence.

**Interaction with T5 LRU cache** (ADR-0123):
- T5 caches the typed `MemoryEntry` record directly (per ADR-0123 §Specification: *"Value = the typed record from ADR-0122 — never a flat string."*). Cache key is the entry key (the `state.sharedMemory` map key); the entry has no `id` field. (Note: ADR-0123 §Pseudocode references `entry.id` — that's a T5-side issue to reconcile when T5 lands; T4 makes no `id` promise.)
- When T4's `get`/`list`/sweep evicts an entry, T5's cache must invalidate. T5 owns the invalidation mechanism; T4's contract is that an evicted entry is absent from `state.sharedMemory` and a subsequent `loadHiveState` will not return it.
- T4 lands first; T5 wires its cache against the stable `MemoryEntry` shape. T5 also replaces the JSON-file persistence T4 uses, but the field set is unchanged.

**RVF backend mapping** (per `project-rvf-primary`, applied by T5):
- `MemoryEntry` fields map 1:1 to RVF row columns: `value` (blob/JSON), `type` (string), `ttl_ms` (int|null), `expires_at` (int|null), `created_at` (int), `updated_at` (int)
- Eviction predicate translates to a `WHERE expires_at IS NULL OR expires_at > ?` clause for read paths
- Forward-compatibility with T5's WAL-backed SQLite fallback — the same six columns serve both backends

## Refinement

**Edge cases** (Specification covers `ttlMs = 0` and negative `ttlMs`; the items below are not duplicated there):

- **Type migration shape detection**: `loadHiveState` distinguishes a `MemoryEntry` from a legacy raw value by the presence of all four required-presence keys (`type`, `ttlMs`, `expiresAt`, `createdAt`). A user-stored `value` that happens to be an object containing `type` is NOT misclassified because legacy storage stores the raw user value at `state.sharedMemory[key]` directly, not in a `.value` sub-key. False-positive risk: a legacy user-stored object with all four keys would be misread as a `MemoryEntry`. Documented limitation; tests assert the four-key shape boundary.
- **Migration of malformed legacy entry**: a legacy entry whose value is `undefined` or `null` is rewritten as `{ value: <that-value>, type: 'system', ttlMs: null, ... }` — preserved, not dropped. Per `feedback-data-loss-zero-tolerance.md`, no entry is ever silently dropped during migration.
- **Daemon + CLI concurrent eviction**: both processes hold the same predicate; the cross-process `withHiveStoreLock` serializes the `delete + saveHiveState` pair. The second deleter sees the entry already absent and is a no-op. No data-loss path.
- **Sweep timer leak across hives**: if `hive-mind_shutdown` skips `clearInterval`, the timer keeps firing in the background and re-registering hive init creates a second timer. The shutdown handler MUST clear the handle; the test `t4_sweep_handle_cleared_on_shutdown` is the gate.
- **Lock acquisition during sweep contention**: the periodic sweep takes the same lock as user `set`/`get`/`list`/`delete`. A long-running user operation can delay one sweep cycle. Acceptable: sweep is for memory hygiene, not correctness — lazy eviction handles correctness.

**Error paths**:
- `set` with `type` undefined → throws `MissingMemoryTypeError()` synchronously, no partial write, no `saveHiveState` call. `type` is a required argument; silently defaulting to `system` would mis-route a caller who forgot `type: 'task'` (30-min TTL) into permanent retention — rejected per `feedback-no-fallbacks.md`.
- `set` with `type` not in the enum → throws `InvalidMemoryTypeError(type)` synchronously, no partial write, no `saveHiveState` call
- `set` with `ttlMs` non-numeric or non-finite → throws `InvalidTTLError(ttlMs)`, no partial write
- `loadHiveState` malformed JSON at the file level → propagates the `JSON.parse` error per `feedback-no-fallbacks.md` (T5 will replace this site with RVF; same fail-loud contract)
- `loadHiveState` per-entry shape mismatch on a legacy entry → migrates it (NOT a fail-loud case — this is the documented migration path; legacy entries get `type: 'system'` because the runtime API throw applies to live `set` calls only, not to a one-shot disk-format upgrade). Distinct from "JSON malformed at file level," which throws.

**Test list**: see §Validation above for the full named matrix (unit, integration, acceptance). All three levels land in the same commit per `feedback-all-test-levels.md`.

## Completion

**Annotation lift criterion**: T4 marked `complete` in ADR-0118 §Status, with Owner/Commit columns naming a green-CI commit. Annotation lift fires on the next materialise run after that flip. (Per ADR-0118 §Annotation lifecycle.)

**Acceptance wire-in**: new acceptance helper `lib/acceptance-hive-memory-types.sh` registered in `scripts/test-acceptance.sh` under the hive-mind phase; covers the 8-type matrix, TTL expiry, and type filter checks listed in §Validation.

**T5 dependency satisfied**: T4's typed-entry shape is the cache value contract for ADR-0123. Once this lands and persists, T5 can wire its LRU cache against the stable `MemoryEntry` shape and register the eviction-event listener for cache invalidation.

## Acceptance criteria

- [ ] Each of the 8 types accepts a `set` call with no explicit `ttlMs` and persists with the USERGUIDE-documented default (`knowledge`/`result`/`consensus`/`system` → null/permanent; `context`/`metric` → 3_600_000 ms; `task` → 1_800_000 ms; `error` → 86_400_000 ms)
- [ ] An entry with `ttlMs: 100` is absent from `get` and `list` results after 150 ms wall-clock and the underlying `state.sharedMemory[key]` is gone (eviction is durable, not just filtered)
- [ ] `list({type: 'task'})` returns only task-typed entries; `list({})` returns all non-expired entries
- [ ] `saveHiveState` followed by `loadHiveState` preserves `expiresAt` such that an entry expiring at T continues to expire at T after restart
- [ ] Legacy untyped entries load as `{ value: <raw>, type: 'system', ttlMs: null, expiresAt: null, createdAt: <load-time>, updatedAt: <load-time> }` and remain accessible via `get`; no legacy entry is ever dropped (per `feedback-data-loss-zero-tolerance.md`)
- [ ] `set` with unknown `type` throws `InvalidMemoryTypeError`; `set` with non-numeric `ttlMs` throws `InvalidTTLError`; neither leaves a partial write
- [ ] Periodic sweep handle cleared in `hive-mind_shutdown`; no orphaned timer fires after shutdown
- [ ] `npm run test:unit` and `npm run test:acceptance` green
- [ ] ADR-0116 verification matrix row "8 memory types with TTL" lifts from ⚠ to ✓ on the next materialise run; ADR-0118 §Status row T4 flips to `complete` with `Owner` and `Commit` filled in

## Migration

Per ADR-0118: legacy untyped entries (`state.sharedMemory[key] = rawValue`) are read as `{ value: rawValue, type: 'system', ttlMs: null, expiresAt: null, createdAt: <load-time>, updatedAt: <load-time> }`. No data is dropped during the schema upgrade. New writes always emit the typed shape; subsequent loads see consistent typed records.

## Risks

- **Schema-change risk: medium.** Per ADR-0118 §T4 escalation criterion: **promote to its own design ADR if the migration strategy collides with `feedback-data-loss-zero-tolerance.md`.** The "treat legacy as `system`/permanent" path is non-destructive (no entry dropped, no value mutated), so the migration meets the zero-tolerance bar. A future iteration that considers a destructive upgrade path (e.g., assigning legacy entries a non-permanent default TTL) must escalate to a separate ADR before landing.
- **Lock contention regression.** Removing the lock-free `get`/`list` fast path means every read now serializes against writes. Acceptable at hive-mind scale (entry counts in the thousands); if a future workload turns this into a bottleneck, a read-side cache (T5 already plans this) absorbs it.
- **Periodic sweep correctness.** The sweep handle MUST be cleared in `hive-mind_shutdown` or it leaks across sessions. Test gate is non-optional.
- **Type-enum drift.** If USERGUIDE adds a 9th memory type, the enum, `DEFAULT_TTL_MS_BY_TYPE` table, validation matrix, and acceptance script all update together. Single-file scope keeps this tractable.
- **T5 cache-key contract.** ADR-0123 references `entry.id` in its pseudocode; T4's `MemoryEntry` shape has no `id` field — the entry key is the `state.sharedMemory` map key. T5 must be updated to use the map key, not a non-existent `id`. Captured in Review note 1.

## References

- ADR-0116 (hive-mind marketplace plugin — verification matrix audit)
- ADR-0118 §T4 (hive-mind runtime gaps tracker — task definition)
- ADR-0123 §Specification (T5 — caches the typed `MemoryEntry` shape this ADR introduces)
- `feedback-data-loss-zero-tolerance.md` memory (escalation criterion + non-destructive migration)
- `feedback-no-fallbacks.md` memory (fail-loud on bad input; no silent type defaulting on garbage)
- `feedback-all-test-levels.md` memory (unit + integration + acceptance in the same commit)
- USERGUIDE substring anchor `**Collective Memory Types:**` in `/Users/henrik/source/ruvnet/ruflo/docs/USERGUIDE.md`
- Touch site: `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts` — `hive-mind_memory` tool currently `:966-1039`; line numbers will drift as the file grows so the entry-name anchor is the stable reference

## Review notes

1. **T5 (ADR-0123) `entry.id` reference.** ADR-0123 §Pseudocode line for `saveHiveState` writes `rvfBackend.write(entryKey(entry.id), entry)`, but T4's `MemoryEntry` defines no `id` field — the per-entry key IS the `state.sharedMemory` map key. T5 needs an editorial fix: `entryKey(key)` where `key` comes from the map-iteration tuple, not from `entry.id`. Not a T4 blocker; flagging for the T5 commit. — resolved (triage row 17: ADR-0123 §Pseudocode now uses map-iteration tuple). See `/docs/adr/ADR-0118-review-notes-triage.md`.
2. **Migration false-positive bound.** A legacy user-stored object that happens to contain all four of `type`/`ttlMs`/`expiresAt`/`createdAt` keys at the top level would be misclassified as a `MemoryEntry` and skip migration. Probability is low (legacy storage is `state.sharedMemory[key] = userValue` directly, not wrapped) but non-zero. If this surfaces, the fix is to require a `MEMORY_ENTRY_MARKER: true` field on writes — strictly additive, no migration needed. (triage row 18 — DEFER-TO-IMPL: low non-zero false-positive; fix if surfaces by adding MEMORY_ENTRY_MARKER field). See `/docs/adr/ADR-0118-review-notes-triage.md`.
