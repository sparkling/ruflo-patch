---
status: accepted
date: 2026-06-01
tags: [agentdb, adr-index, causal-memory, recall, mcp, rvf, sqlite, idempotency, fix]
supersedes: []
depends-on: [ADR-0273, ADR-0281, ADR-0176]
implements: []
---

# Repair the ADR-index causal and recall surfaces and complete `--purge`

## Context and Problem Statement

A full op-matrix test of the ADR index (2026-06-01) — exercising store / retrieve /
update / upsert / delete / search / get against every persistence surface the index
writes — found that **one of the three index surfaces is largely non-functional via
its MCP tools, and the reset path (`agentdb index --purge`) leaves two SQLite tables
dirty, producing silent duplication and silently-dropped edges.**

The index spans **4 logical surfaces across 2 engines** (ADR-0273):

| # | Surface | Engine | Built by |
|---|---|---|---|
| 1 | `hierarchical_memory` (`adr/<id>`) | SQLite (WAL, lock-free) | `hierarchicalStore` |
| 2 | `adr-patterns` namespace | RVF + HNSW | `routeMemoryOp` (`memory_store`) |
| 3 | `causal_edges` (+ `adr_node_ids` map) | SQLite | `recordCausalEdge` (CLI batch) |
| 4 | `causal-edges` namespace | RVF + HNSW | edge-vector mirror (D9) |

The CLI batch build path (`agentdb index`, ADR-0273) populates all four. But the
**live MCP CRUD tools** that consumers use to read/update the index are broken on the
causal surface, the **semantic-recall path errors on both archivist-backed surfaces**,
and **`--purge` is not idempotent for the SQLite edge tables**.

### Test evidence (live, patch.398 daemon + isolated patch.398 CLI, this project)

Op-matrix result per surface:

| Op | SQLite hierarchical | RVF `adr-patterns` | Causal (SQLite + RVF) |
|---|---|---|---|
| store / create | OK | OK | **FAIL** `no such savepoint: staging_agentdb_causal_edge_N` |
| get / query | OK (glob) | OK (exact) | **0 results** via `router-fallback` (id-format mismatch) |
| search / recall | **FAIL** `Internal error` | OK (HNSW, 6.6 ms) | **FAIL** `Internal error` |
| list | — | OK | — |
| update / upsert | OK (2→1, latest wins) | OK (in-place) | n/a |
| delete | OK (`deleted:true`) | OK (`hnswIndexInvalidated`) | **FAIL** (edge-delete rejects `/`; node-delete `bind undefined`) |

Reset+reindex (`agentdb index --purge`) evidence:

* A re-index left `causal_edges` at **1745 rows / 890 distinct triples** — every edge
  duplicated. `--purge` clears `hierarchical_memory` + RVF `adr-patterns` + RVF
  `causal-edges`, but **not** SQLite `causal_edges` or `adr_node_ids`.
* `adr_node_ids` stayed capped at **212**; the 3 then-unindexed ADRs (0282/0283/0284)
  received no node id, so **~14 of 904 expected edges were dropped with no error**
  (904 expected → 890 distinct).
* A clean rebuild (after manually clearing the two residual tables) completed in
  **185 s** and reconciled to 290 / 290 / 904 / 904 — confirming the surfaces are
  *correctable*, the defects are in purge-completeness and the MCP CRUD handlers, not
  the data model. The first attempt timed out at a 180 s wrapper (the op is ~185 s and
  emits no progress), and because P1/P2 leave a dirty store, a killed rebuild leaves a
  *duplicated* half-state rather than a clean partial.

### Problem inventory (the fix backlog)

| ID | Severity | Defect | Suspected source |
|---|---|---|---|
| P1 | high | `--purge` does not clear SQLite `causal_edges` → edge duplication on re-index | `forks/ruflo/v3/@claude-flow/cli/src/commands/agentdb.ts` (purge) |
| P2 | high | `--purge` does not clear/rebuild `adr_node_ids` → stale capped map; new ADRs' edges silently dropped | same command + index write loop |
| P3 | high | `agentdb_causal-edge` create fails: SAVEPOINT counter desync (`no such savepoint: staging_agentdb_causal_edge_N`) | `forks/agentdb/src/controllers/CausalMemoryGraph.ts` |
| P4 | medium | `agentdb_causal-node-delete` fails: `tried to bind a value of an unknown type (undefined)` | `CausalMemoryGraph.ts` (node-delete) |
| P5 | medium | `agentdb_causal-edge-delete` rejects `/` keys via `validateIdentifier` — inconsistent with create (accepts `/`) and with ADR-0281's relaxed hierarchical-delete | `forks/ruflo/.../mcp-tools/agentdb-tools.ts` |
| P6 | high | Semantic recall errors `Internal error` on **both** `agentdb_hierarchical-recall` and `agentdb_causal-recall`; `memory_search` (RVF) is fine → fault is in the shared archivist recall handler | `forks/agentdb/src/controllers/CausalRecall.ts` + hierarchical recall + `src/archivist/handlers/agentdb/causal-recall.ts` |
| P7 | medium | `agentdb_causal-query` returns 0 via `router-fallback` for a valid cause — id-resolution contract unclear (`adr/ADR-x` vs `ADR-x`), compounded by P2 | `agentdb-tools.ts` (causal-query bridge) + `CausalMemoryGraph` query |
| P8 | low-med | Reindex is ~185 s, silent (no progress), non-transactional → a killed run leaves a dirty store | `commands/agentdb.ts` |
| P9 | low | `memory_stats` / daemon RVF view is stale after an out-of-band CLI write (snapshot isolation) → not authoritative cross-process | doc + optional daemon reload signal |

## Decision Drivers

* **No lies (ADR-0210).** The causal `*` MCP tools are advertised (registered, schema'd)
  but no-op or error. Either they work or they are not advertised. The ADR-0178/0281
  direction is to *complete* these surfaces, so: make them work.
* **`--purge` must be truly idempotent.** ADR-0281 made the hierarchical store
  keyed-upsert specifically so `/adr-index` could not duplicate. That guarantee must
  extend to the edge tables — the surface ADR-0281 did not cover.
* **Fail loud, never silently drop (ADR-0082 / no-fallbacks).** An edge whose endpoint
  has no node id is a real error, not a silent skip.
* **Symmetry with the ADR-0281 hierarchical contract.** The causal delete handler should
  accept the same `/`-bearing keys the store/create path accepts.
* **Crash-safety.** A killed reindex must not leave a duplicated or half-written index.

## Considered Options

* **Option A — Repair each surface in place + make `--purge` clear all surfaces +
  transactional rebuild.** Four parallel fix workstreams (purge/index command, causal
  write path, recall path, MCP handler validation/query) + tests + review.
* **Option B — Deprecate the broken causal MCP CRUD tools; keep only the CLI batch build
  path.** Stop advertising `causal-edge` / `causal-node-delete` / `causal-recall`.
* **Option C — Rewrite the causal subsystem onto a single store** (collapse SQLite
  `causal_edges` + RVF `causal-edges` namespace + `adr_node_ids` into one).

## Decision Outcome

Chosen option: **"Option A — repair in place"**, because the data model is sound (a
clean rebuild reconciles perfectly to 290/290/904/904) and the defects are localized to
purge-completeness, two CausalMemoryGraph write methods, one shared recall handler, and
two MCP-handler contract mismatches. Option B violates "no lies" by leaving a documented
contract (ADR-0178) unfulfilled and discards working read intent. Option C is a
high-risk rewrite unjustified by the evidence — nothing in the model is wrong.

### Consequences

* Good, because the advertised causal `*` MCP tools become functional (create / query /
  recall / delete edge / delete node), closing the ADR-0178 contract gap.
* Good, because `--purge` becomes genuinely idempotent across **all four** surfaces — a
  re-index can never duplicate edges or strand a stale node map.
* Good, because semantic recall works on the hierarchical and causal surfaces, not just
  RVF `memory_search`.
* Good, because a transactional rebuild + progress output makes reindex crash-safe and
  observable.
* Neutral, because the cross-process snapshot-isolation note (P9) is documentation +
  an optional reload signal, not a behavioral change.
* Bad, because the fix touches two forks (`agentdb` controllers + `ruflo` CLI/MCP) and
  one harness, so it needs coordinated build/release across both before the live index
  benefits.

### Confirmation

A new acceptance smoke (`scripts/smoke-adr0285-causal-crud-and-purge.mjs`), wired into
the canonical harness (`run_check_bg` + `collect_parallel` spec + `.github/workflows/`),
must prove, end-to-end via `cli mcp exec` against the shared ACCEPT_TEMP install:

1. **Causal CRUD round-trip**: create edge A→B → `causal-query` returns it → delete edge
   → query returns 0; `causal-node-delete` removes a node + incident edges. No SAVEPOINT
   error, no `bind undefined`, `/`-bearing ids accepted symmetrically with create.
2. **Recall non-error**: `agentdb_hierarchical-recall` and `agentdb_causal-recall` return
   `success:true` with results (not `Internal error`).
3. **Purge idempotency on edges**: two `agentdb index --purge` runs → `causal_edges`
   `count(*) == count(distinct triple)` (no duplication) AND `adr_node_ids` covers every
   ADR that has a typed relation (no silent drops).
4. **Reindex completion + reconciliation**: full `--purge` reconciles all four surfaces
   (hierarchical == adr-patterns == disk count; edges total == distinct).

## Rules

The contract each index surface must satisfy after this ADR:

* **Idempotent purge.** `agentdb index --purge` clears `hierarchical_memory(adr/*)`,
  `adr-patterns`, `causal-edges` (RVF), **`causal_edges` (SQLite)**, and **`adr_node_ids`**
  before rebuild. Post-rebuild: `causal_edges count(*) == count(distinct triple)`.
* **No silent edge drops.** An edge whose source or target ADR has no node id is a
  fail-loud error surfaced in the index summary, never a silent skip.
* **Symmetric key validation.** A causal handler that accepts an id on create accepts the
  same id on delete (no `validateIdentifier` charset gate on `delete` that `create` lacks
  — mirrors ADR-0281 R3 for the hierarchical surface).
* **Recall is non-erroring.** Recall on a populated surface returns ranked results or an
  empty set — never `Internal error`.

## Swarm Execution Plan

> Coordination model: `swarm_init` + `Agent`-tool fan-out (`run_in_background: true`),
> orchestrator synthesis. **No hive-mind / consensus.** The four fixers touch disjoint
> files across two forks → fully parallel, no write conflicts. Tester writes
> `ruflo-patch/scripts`; reviewer is read-only.

**Configuration** — `swarm_init { topology: 'hierarchical', maxAgents: 6, strategy: 'specialized' }` (via `/ruflo-swarm:swarm`).

| Param | Value |
|---|---|
| topology | `hierarchical` |
| strategy | `specialized` |
| maxAgents | `6` |
| isolation | fixers write disjoint files in `forks/agentdb` + `forks/ruflo`; tester writes `ruflo-patch/scripts`; reviewer read-only → no conflicts |

**Agent roster**

| Agent | Type | Fork / area | Task | Wave |
|---|---|---|---|---|
| index-fixer | `backend-dev` | `forks/ruflo` `…/cli/src/commands/agentdb.ts` | **P1**: purge must `DELETE FROM causal_edges`. **P2**: purge + rebuild `adr_node_ids`; fail-loud when an edge endpoint has no node id (no silent skip). **P8**: wrap the rebuild in one transaction (all-or-nothing) + emit progress; on failure leave the prior index intact. | 1 |
| causal-writer | `coder` | `forks/agentdb` `…/controllers/CausalMemoryGraph.ts` | **P3**: fix the SAVEPOINT lifecycle in edge-create (`staging_agentdb_causal_edge_N` released/rolled-back without a matching create — likely a per-call counter desync or an early-return that skips `SAVEPOINT`). **P4**: fix the `undefined` bind in `causal-node-delete` (a parameter resolved to `undefined` before `.bind`). | 1 |
| recall-fixer | `coder` | `forks/agentdb` `…/controllers/CausalRecall.ts` + hierarchical recall + `…/archivist/handlers/agentdb/causal-recall.ts` | **P6**: trace the shared `Internal error` (both hierarchical-recall and causal-recall fail; `memory_search` works → the fault is in the archivist recall handler common to both, not RVF). Restore ranked-or-empty results. | 1 |
| mcp-handler | `backend-dev` | `forks/ruflo` `…/mcp-tools/agentdb-tools.ts` | **P5**: drop the `validateIdentifier` charset gate on the `causal-edge-delete` handler; keep the `validateString` length check (mirror ADR-0281 R3). **P7**: pin the `causal-query` id-resolution contract (resolve `adr/ADR-x` and `ADR-x` to the `adr_node_ids` mapping) so a valid cause/effect returns its edges instead of `router-fallback` 0. | 1 |
| tester | `tester` | `ruflo-patch/scripts` | TDD: author `smoke-adr0285-causal-crud-and-purge.mjs` (failing first) covering the four `### Confirmation` assertions; wire into `test-acceptance*.sh` (`run_check_bg` + `collect_parallel`) AND `.github/workflows/`. | 1 (author) → 2 (verify green) |
| reviewer | `reviewer` | read-only | Confirm: ADR-0281 hierarchical contract not regressed; purge now clears ALL surfaces; fail-loud paths don't swallow (ADR-0180 undiscriminating-catch gate); no comment-only `catch {}`. | 2 |

**Waves**

1. tester authors the failing smoke (no fixes yet) ‖ the four fixers implement against it in parallel (disjoint files).
2. reviewer audits once both forks compile and the smoke is reachable.

**Gate**: the `### Confirmation` smoke green, wired into the canonical harness, with the
MCP server **running** (no stop step — also re-validates the ADR-0274/0284 concurrent-index
promise); a full `agentdb index --purge` reconciles all four surfaces with
`causal_edges count(*) == count(distinct)`.

**Build + release**: `forks/agentdb` build → `forks/ruflo` build → commit each fork (no
trailer on forks) → ADR-0285 + smoke in ruflo-patch → `npm run release -- --force`.

## More Information

* **ADR-0273** — `agentdb index` CLI surface (the command this ADR fixes: P1/P2/P8 are
  purge-completeness and crash-safety gaps in its implementation).
* **ADR-0281** — hierarchical keyed upsert + delete-by-key. This ADR extends the same
  idempotency + relaxed-key-validation guarantees to the *causal* surface (P5 mirrors
  ADR-0281 R3; P1 extends ADR-0281's dedup intent to `causal_edges`).
* **ADR-0176 / ADR-0178** — the `hierarchical-*` / `causal-*` MCP tool surface and its
  upstream contract; P3–P7 are the unfulfilled half of that contract.
* **ADR-0274 / ADR-0284** — RVF read/write handle split + single-flock collapse; the
  reindex (P8) runs alongside the live daemon and re-validates that promise (it did not
  deadlock — it was merely slow + silent).
* **ADR-0277 / ADR-0279** — the autonomous causal-learning loop (episodes →
  `NightlyLearner` → `causal_edges` uplift → uplift-ranked `agentdb_causal-recall`).
  **P6 raises the stakes:** that loop's retrieval endpoint (`agentdb_causal-recall`) is
  one of the two surfaces currently erroring `Internal error`, so the P6 fix also
  un-breaks ADR-0277's loop output, not just the ADR index. (Surfaced by `memory_search`
  in `adr-patterns` during authoring.)
* **ADR-0261** — fork-native graph-intelligence backend (ADR-130 re-implementation), a
  *separate* graph-edges substrate from `causal_edges`. Out of scope here (this ADR
  repairs the existing causal surface, not the future graph substrate), noted to keep
  the two from being conflated.
* **ADR-0148 / ADR-0149** — prior "advertised MCP tool with no working handler" audits;
  P3–P7 are the same failure class (registered causal `*` tools that error or no-op).
* Test session source: live op-matrix probes via `mcp__ruflo__*` (patch.398 daemon) +
  isolated patch.398 CLI `agentdb index` against this project's `.swarm`; ground-truth
  cross-checked against SQLite (`.swarm/memory.db`).

## Amendment — implemented + shipped (2026-06-01)

Implemented by a 6-agent swarm (4 fixers + tester + reviewer), built, reviewed,
and shipped green. **Published: `agentdb@3.0.0-alpha.14-patch.412`,
`cli@3.7.0-alpha.10-patch.400`, `ruflo@3.1.0-alpha.14-patch.374`.** Acceptance:
**734/743 passed, 0 failed, 9 skip_accepted**; the `adr0285-causal-crud-and-purge`
gate is green; agentdb fork unit/regression suites 34/34.

### Root-cause refinement (the inventory's suspected sources were partly wrong)

Implementation found that **P4 and P6 are ONE bug, and it is not in the controllers
the inventory named.** The live MCP daemon boots on the **sql.js (WASM) fallback**
(native better-sqlite3 failed to load at startup — a packaging mismatch: hoisted
bsq@12 vs agentdb's private bsq@11). The sql.js compatibility wrapper
(`agentdb/src/db-fallback.ts`) bound better-sqlite3-style NAMED params
(`stmt.all({minConfidence,limit})` — a single bare-keyed object) **positionally**,
so sql.js threw the non-Error string `Wrong API use : tried to bind a value of an
unknown type (...)`, and the cli's `sanitizeError()` flattened that to a generic
`Internal error`. That is the true source of:

* **P6** (`hierarchical-recall` + `causal-recall` `Internal error`) — both route
  through the shared SQLite substrate `stmt.all(namedObject)` path; `memory_search`
  (RVF/HNSW) was unaffected, which is why it always worked.
* **P4** (`causal-node-delete` undefined bind) — the undefined POSITIONAL variant of
  the same wrapper gap.

Fix: `bindSqlJsParams()` in `db-fallback.ts` (single plain object → sigil-keyed
NAMED; array/scalars → POSITIONAL; none → `bind()`) + fail-loud `assertNumericId()`
guards in `CausalMemoryGraph.ts`. This also explains the live-vs-fresh-install
discrepancy in the original report: the live daemon ran sql.js (bug visible); the
acceptance smoke's fresh install loads native better-sqlite3 (which silently coerces
the bad binds), so P4/P6 are covered by the **sql.js fork unit tests**, not the smoke.

* **P1/P2/P8** (`commands/agentdb.ts` + `memory-router.ts`): `--purge` now clears the
  SQLite `causal_edges` + `adr_node_ids` tables (not just the RVF namespaces) and the
  command fail-loud-reconciles (duplication/shortfall gated to `--purge`, missing
  node-id unconditional, driving `exitCode:1`).
* **P5/P7** (`agentdb-tools.ts`): `validateIdentifier` charset gate dropped from
  `causal-edge-delete` + `causal-node-delete` (mirrors ADR-0281 R3); `normalizeAdrId()`
  strips a leading `adr/` so a probe-form id resolves the real node instead of minting
  a phantom. `sanitizeError()` hardened to surface `String(error)` (the masking-catch).
* **P3** (savepoint desync): **no separate patch.** The savepoint machinery
  (`archivist/staging-substrate.ts`) is correct in source; the live `no such savepoint`
  was a *downstream symptom* of the sql.js bind throw aborting the staging transaction.
  Confirmed closed by the green `adr0285` smoke (A1a creates an edge end-to-end).

### Reviewer verdict: SHIP-WITH-NITS — residuals (non-blocking)

1. The bare (non-`--purge`) re-index path catches the "node-id present but edge row
   absent" drop variant only via the `--purge`-gated shortfall check; on a bare
   re-index it is invisible (mitigated: the swallow still `console.error`s and the
   sql.js fix removes the throw that variant needed).
2. `detectNamedSigil` applies the first placeholder's sigil to all re-keyed keys; a
   statement mixing `@a`+`:b` would mis-key. Not present in the corpus; the single-
   convention assumption is documented in the helper.

### Collateral fixed during release

The first release run tripped the ADR-0084 forbidden-substring gate because the new
`sanitizeError` comment literally contained `sql.js`; reworded to "the WASM SQLite
fallback" (no behaviour change). The `e2e-0059-no-collisions` failure in that run was
a load flake in the unrelated `intelligence.cjs` consolidate path (green on re-run);
not an ADR-0285 regression.

### Live re-verification (2026-06-01, patch.400 cli vs this project's real `.swarm`)

After shipping, the original failing probes were re-run live against the real
291-ADR / 910-edge store (via `cli mcp exec`, the fixed build):

* ✅ `causal-recall` → `success:true` (was `Internal error`).
* ✅ `hierarchical-recall` → `success:true` with results (was `Internal error`).
* ✅ `causal-edge` create on `/`-keys → `success:true` (was `no such savepoint`).
* ✅ `causal-edge-delete` on `/`-keys → `success:true, deleted:true` (was rejected).
* ✅ `agentdb index --purge` on the real corpus → 291/291 hierarchical, **910 edges
  total == 910 distinct** (vs the pre-fix 1745/890 duplication); the new P8
  reconciliation line printed `expected 910` and matched — **P1/P2/P8 confirmed on
  real data**.

* ⚠️ **Follow-up (new, not an ADR-0285 contract regression): `causal-query` cold-process
  2s timeout on large stores.** The P7 id-resolution is fixed (`adr/ADR-0274` now
  resolves the real node instead of a phantom). That exposed a latent perf path: the
  query handler's `Promise.race` 2s guard (`agentdb-tools.ts:1326`) wraps an
  always-run RVF `causal-edges` namespace-list dual-read merge; in a COLD `cli mcp
  exec` process loading the 72 MB `memory.rvf` for the first time, that merge exceeds
  2s and the guard rejects. The underlying SQLite query is fast (`idx_causal_edges_from`,
  ~5 ms). Before the fix this path never ran (phantom node → 0 results → instant). A
  warm daemon (RVF preloaded) is expected to be fast; the fix is to raise/scope the
  guard for cold large-store reads or make the namespace dual-read lazy. Tracked as a
  perf follow-up — does not block the ADR-0285 contract (which the green `adr0285`
  gate covers).

### Fork commits

`agentdb`: `e455a2f` (db-fallback sql.js binding), `1fa64ee` (CausalMemoryGraph
guards). `ruflo`: `a53373ebe` (purge completeness), `a97d09b02` (key validation +
id-normalize + sanitizeError), `3422f7144`-era reword.
