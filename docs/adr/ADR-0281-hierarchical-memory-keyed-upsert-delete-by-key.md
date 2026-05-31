---
status: accepted
date: 2026-05-31
tags: [hierarchical-memory, mcp-tools, adr-index, idempotency, upstream-convergence, fix]
supersedes: []
depends-on: [ADR-0166, ADR-0176, ADR-0177]
implements: [ADR-0178]
---

# Complete the hierarchical-* contract: keyed upsert + delete-by-key

## Context and Problem Statement

ADR-0178 restored the fork-only `HierarchicalMemory` controller and re-aligned
the `hierarchical-*` MCP tool names to the upstream-documented surface. But two
pieces of the **upstream-documented contract it cited** were left unimplemented,
and an audit of the live ADR index (2026-05-31) surfaced both as real defects:

1. **`agentdb_hierarchical-delete` is a no-op.** `ruvnet/agentdb/README.md:187`
   documents it as *"Remove hierarchical entry by key"*. The fork's controller
   exposes no `delete`/`remove` method, so `bridgeDeleteHierarchical` falls
   through to `controller: "native-unsupported"` and deletes nothing. Worse, the
   MCP handler validates the key with `validateIdentifier`, which **rejects `/`**
   — so even the keys the store itself writes (`adr/ADR-0275`) are refused before
   reaching the backend.

2. **`HierarchicalMemory.store()` appends; it is not keyed.** `README.md:185`
   documents it as a *"Tier-aware memory **store**"* and delete as *"by key"* —
   i.e. one entry **per key**. The fork's `store()` mints a fresh
   `mem-${Date.now()}-${rand}` row id on every call and carries the caller's key
   only in `metadata.key`, with no upsert. So **re-storing the same key appends a
   duplicate** (verified: two writes to one key → two rows). This silently breaks
   every keyed consumer ADR-0178 enumerated (adr-index, knowledge-graph, goals,
   market-data).

The concrete failure: the `/adr-index` skill's text claims *"Idempotent on
subsequent runs (upsert; no duplicates)"*, but against this append-only store the
claim is **false** — a re-index would duplicate all ~281 already-indexed ADR
records, and (because delete is a no-op) the duplicates could not be removed. The
index is currently single-build-stale (watermark ADR-0275) precisely because it
is unsafe to re-run.

This is the keystone gap: the hierarchical store can neither be made current nor
de-duplicated until it honors the keyed contract.

## Decision Drivers

* **Honor the upstream-documented contract** (`README.md:181-187`) that ADR-0178
  already adopted: store *by key* (one entry per key), delete *by key*. The fork
  diverged from a contract it had cited — this is regression-repair, not a new
  feature.
* **Make the consumers' claims true.** The `/adr-index` skill (and the other 3
  surfaces) assume idempotent keyed writes; the code must satisfy that, per
  "if the skill text makes a claim, make it true."
* **Reuse, don't reinvent.** A private `forget(id)` already performs the complete
  delete (SQL row + `workingMemoryCache` + `episodicMemoryIndex` +
  `vectorBackend.remove` + the ADR-0166 `hmem_vec` mirror). Delete-by-key and
  upsert both build on it.
* **Don't distort the cognitive model.** Working/episodic experience writes are
  legitimately an append stream (Atkinson-Shiffrin); only *keyed* writes (caller
  supplied `metadata.key`) get upsert semantics. Keyless stores keep appending.

## Considered Options

* **A — leave it; change the skill text to drop the idempotency claim.**
  REJECTED: the upstream contract (and 4 fork consumers) genuinely need keyed
  upsert + delete; weakening the claim abandons ADR-0178's surface.
* **B — route the canonical keyed record only through `memory_store`
  (`adr-patterns`), which is already keyed; stop writing ADRs to the hierarchical
  store.** REJECTED: loses tier-aware `hierarchical-recall` over ADRs (a declared
  consumer surface), and doesn't fix delete/upsert for the other 3 consumers.
* **C — implement the upstream contract on the controller (chosen):** keyed
  upsert in `store()` + a real `delete(key)`, reusing `forget()`; relax the MCP
  delete-key validation to accept the same keys `store` accepts.

## Decision Outcome

Chosen option: **"C — implement the keyed contract"**, because it completes
ADR-0178 against the very `README.md` lines that ADR cited, makes the consumer
claims true, and reuses the existing `forget()` primitive — minimal, surgical,
upstream-aligned. Keyed writes become one-entry-per-key (idempotent); delete
removes by key; keyless experience writes are untouched.

### Rules (implementation — see the handover for file:line)

* **R1 — `HierarchicalMemory.delete(key, opts?)` (agentdb).** Public method:
  resolve rows where `id = key OR json_extract(metadata,'$.key') = key`
  (+ optional `tier`), and `forget(id)` each match (so SQL + caches + vector +
  `hmem_vec` stay in sync per ADR-0166). Returns the count deleted. This satisfies
  the bridge's existing `getCallableMethod(hm,'delete',…)` dispatch — no bridge
  change needed; it stops returning `native-unsupported`.
* **R2 — keyed upsert in `store()` (agentdb).** When `options.metadata.key` is a
  non-empty string, `await this.delete(logicalKey)` *before* the INSERT (replace
  any prior entry for that key, any tier → one entry per key). Absent a key,
  append (unchanged). This makes the adr-index "idempotent upsert" claim true.
* **R3 — relax the MCP delete-key validation (ruflo).** `agentdb_hierarchical-delete`
  must accept the same key charset `agentdb_hierarchical-store` accepts (it uses
  `validateString`, length-only, allowing `/`). Replace the `validateIdentifier`
  guard (which rejects `/`) so `adr/<id>` keys reach the backend. Keys flow into
  parameterized SQL — no injection surface.
* **R4 — no schema migration.** Match by `json_extract(metadata,'$.key')` over the
  existing `metadata` column; works on the 281 live records. (A partial index on
  that expression is a later optimization, not required.)

### Consequences

* Good: the hierarchical-* surface finally matches its upstream-documented
  contract; `/adr-index` becomes safe to re-run (idempotent) and the index can be
  brought current + de-duplicated.
* Good: delete-by-key works (incl. the `adr/*` keys), so stray/test records are
  removable — including the 2 `zzprobe` records this audit left behind.
* Good: reuses `forget()` → no new SQL/vector/hmem_vec sync paths to get wrong.
* Neutral: keyed writes now do a delete-then-insert (one extra indexed lookup);
  negligible at ADR-corpus scale.
* Bad: keyed writes change the row `mem-*` id on each upsert (the logical key is
  the stable identity) — fine for all known consumers, which key by path.

### Confirmation

* **Unit (agentdb `HierarchicalMemory.test.ts`):** store key X twice → exactly 1
  row; `delete(X)` → 0 rows; delete by raw `mem-*` id works; a key containing `/`
  round-trips store→delete; a keyless store still appends.
* **Smoke / live:** `agentdb_hierarchical-store` adr/PROBE twice → `hierarchical-query adr/PROBE*` returns 1; `agentdb_hierarchical-delete adr/PROBE` → query returns 0.
* **Index remediation (post-ship):** a single `/adr-index` run upserts all 286
  (no dupes), syncs the 281-vs-283 store drift, registers 0276–0281, and the
  `zzprobe` records are deleted.

## More Information

- **Implements / completes ADR-0178** — same `hierarchical-*` surface and the
  same `ruvnet/agentdb/README.md:181-187` contract it cited; this closes the
  `delete` (native-unsupported) and `store` (append-only) gaps it left.
- **Depends on ADR-0166** — the `forget()` path + the Option-F `hmem_vec` mirror
  the new `delete`/upsert reuse to keep both storage axes in sync.
- **Depends on ADR-0176** — the dash-form `agentdb_hierarchical-*` tool-name
  contract the skills call.
- **Depends on ADR-0177** — adopt upstream's RVF cognitive-container vision; this
  aligns the controller to the upstream-documented keyed semantics.
- **Upstream contract:** `ruvnet/agentdb/README.md:185-187` — store = "Tier-aware
  memory store", delete = "Remove hierarchical entry by key". `HierarchicalMemory`
  is fork-only (no upstream class), so the upstream *intent* lives in the README +
  the cognitive-architecture lineage, not an upstream impl.
- Evidence: live ADR-index audit (2026-05-31) — append-on-rerun verified by
  probe; delete `native-unsupported` + `/`-rejection verified; 281 (hierarchical)
  vs 283 (`adr-patterns`) vs 286 (disk) drift measured.

## Amendment: implemented + shipped (2026-05-31, ruflo patch.365 / agentdb patch.403)

Implemented across both forks and shipped to Verdaccio:

- **agentdb** (`HierarchicalMemory.ts`, patch.403): public `delete(key, {tier?})`
  resolving by raw id OR `metadata.key`, reusing `forget()` (R1); keyed upsert in
  `store()` — a re-store of an existing `metadata.key` deletes the prior entry
  before INSERT (R2). Keyless stores keep append semantics.
- **ruflo cli** (`agentdb-tools.ts`, wrapper patch.365): dropped the
  `validateIdentifier` guard on `agentdb_hierarchical-delete` so `adr/<id>` keys
  with `/` reach the backend, symmetric with store (R3).

Verified end-to-end against the deployed artifact (not just unit tests):

- **Keyed upsert** — storing the same `adr/<id>` key twice yields exactly **1**
  entry, latest value wins; cross-tier re-store moves rather than duplicates.
- **Delete-by-key** — `agentdb_hierarchical-delete adr/<id>` returns
  `deleted:true` (controller `bridge-fallback`, no longer `native-unsupported`);
  delete by raw `mem-*` id, tier-filtered delete, and multi-segment `/` keys all
  work.
- **30/30 comprehensive validation** across store/upsert, path-glob query,
  semantic recall, `adr-patterns` search, causal edge/query/recall, every delete
  form, cross-surface integrity, and idempotency-at-scale.

**Index remediation (the payoff).** The live index carried an un-removable
`adr/ADR-0276` duplicate (284 rows / 283 distinct) and was missing
ADR-0278–0281. With the fix, a reindex on top of the existing store produced
exactly **287 distinct / 287 rows — zero duplicates** (pre-fix this would have
appended to 510+), then a `--purge` rebuild brought all three surfaces
(hierarchical + `adr-patterns` + causal) to the canonical 287, eliminating the
0276 dupe and the stale-value `adr-patterns` conflicts.

The acceptance check `adr0281-hierarchical-upsert-delete` is wired into the
standard runner (`run_check_bg` + `collect_parallel`), the fast runner, and a
dedicated CI workflow. The patch.365 acceptance run surfaced a parse bug in the
smoke's *own* harness (multi-line `Result:` JSON + trailing daemon output broke
`JSON.parse(body.slice(start))`); fixed by switching `parseResult` to
balanced-brace extraction (the adr0280 pattern) — green on re-run (5/5).

A separate **ADR-0276 follow-up** is noted: `agentdb_causal-edge-delete` clears
the SQLite `causal_edges` row but leaves the KV `causal-edges` dual-write copy
(`bridgeDeleteCausalNode` clears it; `bridgeDeleteCausalEdge` does not), so
`causal-query` can resurrect a deleted edge via `router-fallback`. Out of scope
here; tracked for ADR-0276.
