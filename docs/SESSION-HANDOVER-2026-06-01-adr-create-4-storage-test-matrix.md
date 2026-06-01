# Handover — Test `adr-create` + the 4 ADR storage mechanisms (full op matrix)

**Goal:** comprehensively test the `/adr-create` skill and the ADR index across **all 4
storage mechanisms**, exercising every operation — create / retrieve / get / search /
query / update / upsert / delete — on each, with regression coverage for the ADR-0285
fixes. Build it as a **dedicated harness wired into acceptance**, not a one-off manual run.

> Context: a 2026-06-01 op-matrix probe found 6 defects here (recall "Internal error",
> causal-edge SAVEPOINT, node-delete undefined-bind, `/`-key rejection, causal-query
> phantom-node 0, purge non-idempotency). All fixed + shipped in ADR-0285
> (`docs/adr/ADR-0285-*.md`, cli@patch.402 / agentdb@patch.414). This plan locks that in.

---

## The 4 storage mechanisms (2 engines)

| # | Surface | Engine | Written by | Live count (291 ADRs) |
|---|---|---|---|---|
| 1 | `hierarchical_memory` (`adr/<id>` keys) | **SQLite** (`.swarm/memory.db`, WAL) | `adr-create` step 4 + `adr-index` | 291 records |
| 2 | `adr-patterns` namespace | **RVF + HNSW** (`.swarm/memory.rvf`) | `adr-create` step 6 + `adr-index` | 291 vectors |
| 3 | `causal_edges` (+ `adr_node_ids` map) | **SQLite** | `adr-index` only (`recordCausalEdge`) | 910 edges (455 fwd + 455 inv) |
| 4 | `causal-edges` namespace | **RVF + HNSW** | `adr-index` only (D9 edge-vector mirror) | ~910 edge vectors |

Source of truth (not a write target): `docs/adr/ADR-*.md` on disk.

**Division of labour:** `/adr-create` writes surfaces **1 + 2** (the record + its pattern
vector). `/adr-index` (`agentdb index`) writes **all 4** (records, patterns, edges, edge
vectors). So "test adr-create" = surfaces 1+2 end-to-end; "test all 4" additionally needs
an `adr-index` run for surfaces 3+4.

---

## ⚠️ Test on BOTH backends — this is the load-bearing subtlety

The long-running MCP daemon runs the **sql.js (WASM)** SQLite backend; a fresh `cli mcp
exec` / acceptance install runs **native better-sqlite3**. Several ADR-0285 bugs (recall
`Internal error`, node-delete undefined-bind) reproduced ONLY on sql.js. So every op below
must be exercised on BOTH:

- **(a) live daemon** — `mcp__ruflo__*` tools (sql.js path) against the real `.swarm`.
- **(b) fresh install** — `cli mcp exec --tool <T> --params <json>` from a Verdaccio
  install (better-sqlite3 path). This is what acceptance uses.

A green fresh-install smoke does NOT prove the sql.js path; cover it with agentdb fork unit
tests (`tests/regression/db-fallback-named-params.test.ts`) that force the sql.js wrapper.
See [[project-mcp-daemon-runs-sqljs-fallback]].

**Probe discipline:** use throwaway keys (`adr/ZZTEST-*`, `ADR-95xx` synthetic) and CLEAN
UP after (the run that mutates the real `.swarm` must reconcile — see Cleanup). Never leave
probe rows in `adr_node_ids` / `causal_edges` / `hierarchical_memory`.

---

## Op matrix — exact tool + expected result per surface

### Surface 1 — `hierarchical_memory` (SQLite)
| Op | Tool / call | Expected | Regression guard |
|---|---|---|---|
| create | `agentdb_hierarchical-store {key:'adr/ZZTEST-1', value, tier:'semantic'}` | `success:true` | |
| upsert | re-`store` SAME key, new value | query → exactly **1** row, latest value wins | ADR-0281 keyed upsert |
| get/query | `agentdb_hierarchical-query {pathPattern:'adr/ZZTEST-*'}` | 1 result, `metadata.key` set | |
| search/recall | `agentdb_hierarchical-recall {query, tier:'semantic'}` | `success:true`, ranked-or-empty — **NOT `Internal error`** | **ADR-0285 P6** (sql.js bind) |
| delete | `agentdb_hierarchical-delete {key:'adr/ZZTEST-1'}` | `deleted:true`, accepts `/` in key | ADR-0281 delete-by-key |
| (post-delete) | query again | **0** results | |

### Surface 2 — `adr-patterns` namespace (RVF + HNSW)
| Op | Tool / call | Expected |
|---|---|---|
| create | `memory_store {key:'ADR-ZZTEST', value, namespace:'adr-patterns'}` | `success:true`, `hasEmbedding:true` |
| retrieve/get | `memory_retrieve {key:'ADR-ZZTEST', namespace:'adr-patterns'}` | `found:true`, exact value |
| search | `memory_search {query, namespace:'adr-patterns'}` | ranked HNSW results, scores |
| list | `memory_list {namespace:'adr-patterns'}` | enumerates, paginates |
| update/upsert | `memory_store {... upsert:true}` | value replaced in place |
| delete | `memory_delete {key:'ADR-ZZTEST', namespace:'adr-patterns'}` | `deleted:true`, `hnswIndexInvalidated:true`; retrieve → `found:false` |

### Surface 3 — `causal_edges` (SQLite, + `adr_node_ids`)
| Op | Tool / call | Expected | Regression guard |
|---|---|---|---|
| create | `agentdb_causal-edge {sourceId:'adr/ZZTEST-A', targetId:'adr/ZZTEST-B', relation:'depends-on'}` | `success:true` — **no `no such savepoint`** | **ADR-0285 P3** (sql.js-stateful) |
| query/get | `agentdb_causal-query {cause:'adr/ADR-0274'}` | edges of the cause (>0 for a real cause) — **not 0 via `router-fallback`** | **ADR-0285 P7** (id-normalize + 15s timeout) |
| search/recall | `agentdb_causal-recall {query}` | `success:true` (uplift-ranked) — **not `Internal error`** | **ADR-0285 P6** |
| update | re-`causal-edge` same (from,to,relation) | one row per triple, weight/confidence updated | |
| delete edge | `agentdb_causal-edge-delete {sourceId, targetId, relation}` | `deleted:true` — **accepts `/`** | **ADR-0285 P5** |
| delete node | `agentdb_causal-node-delete {nodeId}` | cascades incident edges — **no `bind undefined`** | **ADR-0285 P4** (sql.js) |

### Surface 4 — `causal-edges` namespace (RVF + HNSW)
| Op | Tool / call | Expected |
|---|---|---|
| search | `memory_search {query, namespace:'causal-edges'}` | edge vectors returned |
| count | `memory_stats` → `namespaces['causal-edges']` | ≈ `causal_edges` SQLite count (mirror parity) |

---

## adr-create end-to-end (the skill under test)

`/adr-create "<title>"` must, in order (skill at `~/.claude/skills/adr-create`):
1. Find next `ADR-NNNN`, slugify, **write `docs/adr/ADR-NNNN-<slug>.md`** (canonical MADR
   frontmatter: `status/date/tags/supersedes/depends-on/implements`).
2. **hierarchical-store** `adr/ADR-NNNN` (surface 1) with the JSON metadata value.
3. **memory_search** `adr-patterns` for related ADRs (surface 2 read).
4. **memory_store** `adr-patterns` key `ADR-NNNN` (surface 2 write).
5. Report file path + number + related.

**Assertions:** after `/adr-create`, surface 1 has `adr/ADR-NNNN` (1 row), surface 2 has
`ADR-NNNN` (embedded); the file exists with valid frontmatter; idempotent if re-run (keyed
upsert → no dupes). Then `/adr-index` adds the new ADR's `depends-on/supersedes/implements`
edges to surfaces 3+4.

---

## Reconciliation invariants (the cross-surface gate)

After a full `agentdb index --purge --dir docs/adr` (the idempotent rebuild):
- `hierarchical adr/*` distinct == `adr-patterns` count == disk `ADR-*.md` count (291).
- `causal_edges` **total == distinct** (no duplication) == 2 × forward (fwd == inv).
- `adr_node_ids` covers every ADR that has ≥1 typed relation; **0 silently-dropped edges**
  (the command fail-loud-reconciles — `reconcileAdrCausalEdges`, exitCode:1 on a gap).
- Re-running `--purge` a second time → identical counts (true idempotency; **ADR-0285 P1/P2**).

Ground-truth (authoritative, backend-independent) via direct SQLite:
```bash
sqlite3 .swarm/memory.db "SELECT count(*),count(DISTINCT json_extract(metadata,'\$.key')) \
  FROM hierarchical_memory WHERE json_extract(metadata,'\$.key') LIKE 'adr/%';"
sqlite3 .swarm/memory.db "SELECT count(*), (SELECT count(*) FROM (SELECT DISTINCT \
  from_memory_id,to_memory_id,json_extract(metadata,'\$.relation') FROM causal_edges)) FROM causal_edges;"
```
RVF namespaces via `memory_stats` (note: the LIVE daemon's view can be stale after an
out-of-band CLI write — read counts from a FRESH process for authority).

---

## How to build it (deliverables)

1. **`scripts/smoke-adr-create-storage-matrix.mjs`** — drives `/adr-create`-equivalent
   tool calls + the full op matrix above via `cli mcp exec` against a Verdaccio install
   (model on `scripts/smoke-adr0285-causal-crud-and-purge.mjs` — reuse
   `lib/smoke-adr0255-shared.mjs`). Synthetic `ADR-95xx` corpus that cross-references
   itself; assert each op's expected result; assert the reconciliation invariants after a
   2× `--purge`. Must FAIL if any ADR-0285 regression returns.
2. **agentdb fork unit coverage** for the sql.js-only paths (extend
   `tests/regression/db-fallback-named-params.test.ts` + `CausalMemoryGraph.test.ts`) —
   the fresh-install smoke runs better-sqlite3 and can't catch P4/P6 regressions.
3. **Harness wiring (BOTH surfaces or it's silently un-counted):**
   `lib/acceptance-adr-create-checks.sh` + `run_check_bg` + the `collect_parallel` spec in
   `scripts/test-acceptance.sh`, a group in `test-acceptance-fast.sh`, and the
   `.github/workflows/v3-ci-agentdb-surface.yml` job. See [[feedback-always-wire-tests-into-cicd]].
4. **Live-daemon pass (manual or scripted):** run the Surface 1/3 ops via `mcp__ruflo__*`
   against the real `.swarm` (sql.js path) — recall non-error + causal CRUD — then reconcile.

## Cleanup (mandatory)

Any run that mutates the real `.swarm`:
- delete probe rows: `agentdb_hierarchical-delete adr/ZZTEST-*`, `memory_delete` adr-patterns,
  `causal-edge-delete` / `causal-node-delete`, and `DELETE FROM adr_node_ids WHERE adr_id
  LIKE '%ZZTEST%'`.
- then `agentdb index --purge --dir docs/adr` to restore the canonical 291/291/910 state.

## Gotchas (learned this session)

- **adr0084 forbidden-substring gate**: never put the literal `sql.js` in a comment that
  compiles into the published CLI dist (`dist/src/mcp-tools/*.js`) — it greps for it
  (excluding `import`/`from` lines). Burned 2 release cycles. Use "WASM SQLite fallback".
- **`causal-query` 2s→15s timeout**: a cold process loads the 72MB RVF before the always-run
  namespace merge; the guard is `RUFLO_CAUSAL_READ_TIMEOUT_MS` (default 15s). The SQLite leg
  is ~5ms (indexed). A warm daemon is fast.
- **`memory_stats` is not authoritative cross-process** (RVF snapshot isolation) — verify
  durable counts from SQLite or a fresh process.
- **Heavy tests** (`p4-br-*`, `p7-fo-neural`, bulk-corpus) are `HEAVY_SKIP` by default —
  run with `ACCEPTANCE_HEAVY=1` to leave nothing skipped.
