# Task #99 — collapse `memory_search_index` → `memory_store` (substrate-seam expansion)

**Author**: system-architect agent under /loop self-pacing (2026-05-17)
**Status**: PLAN ONLY — awaiting green-light before any commits land
**Estimated total**: ~250 LoC (was estimated 200 in DA memo; +50 for `IMemoryRvfBackend` interface extension)
**Blocker history**: Phase 5 DA-memo CF#4. Phase 4 plan §250 marked deletion of `memory_search_index` but never landed.

## Constraint recap (verified, not hypothetical)

- **4 handlers (not 5)** read `STORE_ID = 'memory_search_index'`: `search.ts`, `retrieve.ts`, `list.ts`, `search-unified.ts`. `bridge-status.ts` is FS-scan + degraded stubs — no substrate read.
- `memory_search_index` is **populated by nothing today**. Cli's TODO comments at `memory-tools.ts:384/500/750/1179` say "PHASE 6+: route through archivist when memory_search_index→memory_store collapse lands". All 4 handlers return `[]` in production.
- `memory_store` is **RVF-classified** (`substrate-registry.ts:77`, `RVF_STORE_IDS`).
- `RvfBackend` already exposes `getByKey(ns, key)`, `query(MemoryQuery)`, `listNamespaces()` (rvf-backend.ts:526/623/896). `MemoryRvfAdapter` already plumbs `getByKeyAsync`; `query`/`listNamespaces` are NOT yet plumbed through the adapter.
- `ReadOnlySubstrateHandle` today: `read`, `query`, `vectorSearch` (types.ts:58-66). The RVF substrate's `query` already throws ("vectorless predicate scan not available") — so adding `getByKey`/`list` lets the RVF side honor key/list semantics that `query` cannot.

## Decision corrections vs the Phase 5 DA memo

- DA memo said "RVF `list` semantics is probably the deciding constraint." **Refuted by recon** — `RvfBackend.query(MemoryQuery)` exists and cli's `routeMemoryOp case 'list'` already uses it in production. The gap is interface plumbing, not semantics.
- DA memo estimated "~200 LoC across 3 substrate factories + 5 handler rewrites." **Revised: ~250 LoC across 3 substrate factories + 4 handler rewrites + interface extension.** (5 handlers → 4 because `bridge-status.ts` doesn't read `memory_search_index`.)

## Plan

### 1. `ReadOnlySubstrateHandle` extension

Add two methods (types.ts:58):
```ts
getByKey<R>(scope: { storeId; namespace: string; key: string }): Promise<R | undefined>;
list<R>(scope: { storeId; namespace?: string; limit?: number; offset?: number }): Promise<ReadonlyArray<R>>;
```

**Return-shape choice: `Promise<Array>` over `AsyncIterable`.** Justification: existing handlers consume `filter/sort/slice` pipelines (search.ts:101-106, list.ts:77-78). AsyncIterable adds zero benefit at current corpus sizes (~hundreds of memory entries). The FS-JSON `query` precedent (types.ts:60) already uses `Promise<ReadonlyArray<R>>`. Consistency wins.

### 2. Per-substrate cost

| Substrate | `getByKey` | `list` | LoC |
|---|---|---|---:|
| **FS-JSON** | trivial — `loadJson` + `documentRecords` + `find` by `(namespace, key)` | trivial — `documentRecords` + namespace filter + page slice | ~40 |
| **SQLite** | `db.prepare('SELECT ... WHERE namespace=? AND key=?').get()` | `db.prepare('SELECT key, namespace, ... LIMIT ? OFFSET ?').all()` | ~30 |
| **RVF** | delegate to adapter's existing `getByKeyAsync(ns, key)` (already plumbed) | **structural plumbing**: extend `IMemoryRvfBackend` with `query` + `listNamespaces`, wire `MemoryRvfAdapter`, call from substrate | ~80 |

### 3. Handler rewrites (4 files, mechanical)

| Handler | Change | LoC |
|---|---|---:|
| `retrieve.ts` | `STORE_ID = 'memory_store'`; replace `read({key:'root'})` + linear `find` with `getByKey({namespace, key})`; map to 1-element `RankedResults` | ~15 |
| `list.ts` | `STORE_ID = 'memory_store'`; replace `read({key:'root'})` with `list({namespace, limit, offset})`; map records to `MemoryListRecord` | ~15 |
| `search.ts` | `STORE_ID = 'memory_store'`; replace `read({key:'root'})` with `vectorSearch({vector, topK})` — embedding generation moves into handler via `ctx.capabilities.requireEmbeddingScorer()` (mirrors `store.ts`) | ~25 |
| `search-unified.ts` | Same as `search.ts` but multi-namespace iteration (call `list({namespace})` per known namespace, then sort+dedup); keep the per-store rank stamp | ~30 |

### 4. Migration / back-compat

**Delete `memory_search_index` entirely.** Phase 4 plan (line 250) flagged this for deletion; cli's "PHASE 6+" comments confirm intent. Since NOTHING populates `memory_search_index` today, deletion is a no-op for storage state. Remove the FS-JSON path fallthrough comment in `substrate-registry.ts` (no override entry exists anyway). No data migration needed.

### 5. Test plan

- **Per-substrate unit tests** (3 files): `tests/unit/substrates/fs-json-store.test.ts` + `sqlite-store.test.ts` + `rvf-store.test.ts` — each gets `getByKey` (hit / miss) + `list` (no-filter / namespace-filter / pagination) cases. RVF test uses the in-tree `MemoryRvfAdapter` fixture.
- **Per-handler unit tests** (4 files in `test/archivist/handlers/memory/`): mock `ctx.substrate` with stub `getByKey`/`list`/`vectorSearch`; assert payload shapes + provenance fields stay identical to current cli envelope.
- **Acceptance**: extend the existing P5 memory tests in `tests/acceptance/p5-*` to exercise dispatched `memory_retrieve`/`memory_list`/`memory_search` (currently only `memory_store` is dispatch-tested per Phase 5 DA memo §26).

### 6. One decision point

**Does the substrate's `list` expose the full `MemoryQuery` discriminator, or a narrow `{namespace?, limit?, offset?}` projection?**

`MemoryQuery` (`memory/types.ts:149-217`) carries tags, memoryType, time ranges in addition to namespace/limit/offset. The 4 handlers only need namespace + pagination.

**Recommendation: narrow projection.** Widening would re-create the FS-JSON `query` predicate-as-unknown problem (the substrate handle becomes a leaky proxy for the underlying memory-model). If future use needs filter dimensions, extend the projection then.

### 7. Cli flip

Once the 4 handlers dispatch correctly, the 4 cli `routeMemoryOp` callsites (`memory-router.ts: get / list / search / search_unified`) can flip to `archivist.dispatchRead`. **Out of scope for this task** — it's task #100 (DA CF#8 "memory-read handler readiness for cli flip"). #100 unblocks the moment #99 lands.

## Decision point for green-light

The plan has no NACK signals from recon. Three landing shapes:

(a) **Land in 3 commits**: (1) `ReadOnlySubstrateHandle` extension + per-substrate impls + unit tests, (2) handler rewrites + handler unit tests, (3) `memory_search_index` deletion + acceptance. Each ~80-100 LoC, independently revertable.

(b) **Land as 1 commit** — clean atomic delivery; ~250 LoC but the changes are tightly coupled (interface, impl, callers, deletion all interlock). Easier to review as one diff.

(c) **Defer** — bank this plan; revisit when the cli flip (#100) is also planned, so both ship together.

**Recommendation: (a)** — three commits provides regression isolation if anything breaks in acceptance, matches the loop's "smaller blast radius" preference, and the substrate-seam extension (commit 1) is independently valuable as a substrate-layer improvement even if commits 2-3 NACK.
