# Session Handover — 2026-05-31 — Fix hierarchical delete + keyed upsert (ADR-0281)

**Decision:** `docs/adr/ADR-0281-hierarchical-memory-keyed-upsert-delete-by-key.md` (status `proposed`).
**Completes:** ADR-0178 (the `hierarchical-*` MCP surface). **Upstream contract:** `ruvnet/agentdb/README.md:185-187`.

> Status: PLANNED, not implemented. The store region of `HierarchicalMemory.ts` is clean. Implement the three changes below, test, build, release, then run the index remediation.

## Why (the gap, in one paragraph)

`HierarchicalMemory.store()` is append-only (fresh `mem-*` row id per call; the caller's key lives only in `metadata.key`, no upsert) and `agentdb_hierarchical-delete` is a no-op (`controller: "native-unsupported"` — the controller has no `delete` method) whose MCP handler also rejects `/` in keys. Upstream documents the opposite: store = "Tier-aware memory store", delete = "Remove hierarchical entry **by key**" (one entry per key). So `/adr-index`'s "idempotent upsert (no duplicates)" claim is false — a re-index would duplicate all ~281 indexed ADR records, un-removably. Verified live this session (store-twice → 2 rows; delete → native-unsupported; `/` rejected).

## The implementation — 3 changes, no bridge change

### 1. `forks/agentdb/src/controllers/HierarchicalMemory.ts` — add public `delete(key)`

Place a public method (e.g. just before `private async forget(memoryId)` ~L696). Reuse `forget()` so SQL + caches + `vectorBackend` + the ADR-0166 `hmem_vec` mirror all stay in sync:

```ts
/**
 * ADR-0281: delete hierarchical entries by key — the upstream-documented
 * `agentdb_hierarchical_delete` contract ("Remove hierarchical entry by key").
 * Matches the raw row id OR the logical key (metadata.key, set by the MCP store
 * path). Optional tier filter. Reuses forget() per match. Returns count deleted.
 */
async delete(key: string, opts?: { tier?: MemoryTier }): Promise<number> {
  if (!key || typeof key !== 'string') return 0;
  const tierClause = opts?.tier ? ' AND tier = ?' : '';
  const params = opts?.tier ? [key, key, opts.tier] : [key, key];
  const rows = this.db.prepare(
    `SELECT id FROM hierarchical_memory
     WHERE (id = ? OR json_extract(metadata, '$.key') = ?)${tierClause}`
  ).all(...params) as Array<{ id: string }>;
  for (const r of rows) await this.forget(r.id);
  return rows.length;
}
```

### 2. `HierarchicalMemory.store()` — keyed upsert (same file)

Inject right **before** the `// Store in database` INSERT (~L264):

```ts
// ADR-0281: keyed upsert — the upstream contract is one entry PER logical key.
// A re-store of the same key REPLACES its entry rather than appending a dup
// (the mem-* row id is internal; metadata.key is the identity). Keyless stores
// (no metadata.key — e.g. episodic experience writes) keep append semantics.
const logicalKey = options?.metadata?.key;
if (typeof logicalKey === 'string' && logicalKey) {
  await this.delete(logicalKey);
}
```

(`delete` is defined later in the class — fine, method hoisting. No tier filter on the upsert delete → one entry per key regardless of tier.)

### 3. `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts` — relax delete-key validation

The `agentdb_hierarchical-delete` handler (~L2262) calls `validateIdentifier(params.key, 'key')` (L2264) which rejects `/`. The **store** handler (~L555) only uses `validateString(params.key, 'key', 1000)` (no charset gate, allows `/`). Make delete symmetric — drop the `validateIdentifier` guard, keep the `validateString` length check already at L2267. Keys go into parameterized SQL → no injection surface. (The PATH_TRAVERSAL/SHELL_META checks `validateIdentifier` did are irrelevant for an SQL memory key.)

**No bridge change:** `bridgeDeleteHierarchical` (agentdb-tools.ts ~L88) already does `getCallableMethod(hm,'delete','remove','deleteEpisode')` and calls `fn.call(hm, key, {tier})`. Once the controller has `delete(key, {tier})`, it dispatches automatically and stops returning `native-unsupported`.

## Tests

**agentdb `tests/unit/controllers/HierarchicalMemory.test.ts`** (add a describe block):
- store key `adr/X` twice (via `store(content, imp, 'semantic', {metadata:{key:'adr/X'}})`) → exactly **1** row for that key.
- `delete('adr/X')` → returns 1, query for the key → 0 rows; vector/`hmem_vec` cleared (assert via `recall`/count).
- `delete('<mem-id>')` (raw id) works.
- a key containing `/` round-trips store→delete.
- keyless `store(...)` (no metadata.key) still appends (2 calls → 2 rows).

**Live smoke (post-release, via MCP):** `agentdb_hierarchical-store key=adr/PROBE` twice → `agentdb_hierarchical-query adr/PROBE*` returns 1 → `agentdb_hierarchical-delete adr/PROBE` → query returns 0. Wire as a small acceptance check if desired (mirror the adr0278-0280 pattern).

## Build + release

1. `cd forks/agentdb && npm run build` (exit 0; the `src/`-scoped tsconfig from this session).
2. `cd forks/ruflo/v3/@claude-flow/cli && npm run build` (exit 0).
3. Commit each fork (no trailer on forks): agentdb (`HierarchicalMemory.ts` + test), ruflo (`agentdb-tools.ts`). Commit ADR-0281 + this handover in ruflo-patch.
4. `npm run release -- --force` (the `--noCheck` situation + the ADR-0180 undiscriminating-catches gate still apply — no comment-only `catch {}`).

## Index remediation (the payoff — do AFTER the fix ships)

Once store is keyed-upsert + delete works, **run `/adr-index` once**. It is now genuinely idempotent:
- upserts all 286 ADRs (no dupes — the whole reason for this fix),
- syncs the **281 (hierarchical) vs 283 (`adr-patterns`) vs 286 (disk)** drift,
- registers the 5–6 missing: **ADR-0276, 0277, 0278, 0279, 0280, 0281**,
- and the **2 `zzprobe/dup-check` records** this audit left in the hierarchical store can be removed with `agentdb_hierarchical-delete zzprobe/dup-check` (now that delete works).

Verify after: `agentdb_hierarchical-query adr/*` distinct count == `adr-patterns` count == 286 (or 287 with 0281), and `memory_search` in `adr-patterns` returns 0276-0281.

## Honest notes / gotchas

- **The whole point is dedup safety.** Do NOT run `/adr-index` before this fix lands — it appends, doubling the hierarchical store un-removably.
- `adr-patterns` (`memory_store`) was already safe (keyed; `upsert` param). Only the **hierarchical** store + its delete need fixing. Causal-edge delete is already real (ADR-0276 R5).
- The `mem-*` id changes on each upsert; consumers key by path (`adr/<id>`), so this is invisible to them.
- ADR-0281 is `proposed`; flip to `accepted` + add an amendment when implemented + released (mirror the 0276/0277 pattern). It (and 0276-0280) only land in the index after the post-fix reindex.
- This session's broader work (ADR-0278/0279/0280 causal follow-ons) is already released (patch.390, acceptance-green) and is unrelated to this fix.
