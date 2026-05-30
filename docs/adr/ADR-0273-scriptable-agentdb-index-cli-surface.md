---
status: accepted
date: 2026-05-30
tags: [agentdb, cli, adr-index, mcp, rvf, tooling]
supersedes: []
depends-on: [ADR-0176, ADR-0267, ADR-0147]
implements: []
---

# Scriptable `agentdb index` CLI surface for the ADR index

## Context and Problem Statement

The `/adr-index` skill defines the canonical ADR index over three write surfaces per record:

| Skill step | Tool | Target store | Scriptable today? |
|---|---|---|---|
| 3 — record metadata | `agentdb_hierarchical-store` | `adr/<id>` hierarchical store (SQLite `hierarchical_memory`) | ❌ MCP-only |
| 4–5 — typed edges + inverses | `agentdb_causal-edge` | causal graph | ❌ MCP-only |
| 6 — search excerpt | `memory_store` (`adr-patterns`) | RVF + HNSW memory | ✅ CLI (`ruflo memory store`) |

There is **no `agentdb` CLI subcommand** (`npx @sparkleideas/cli agentdb` → "Unknown command"). Steps 3 and 4–5 — the canonical heart of the index (the `adr/*` records that `agentdb_hierarchical-query` reads, plus the dependency graph) — can only be written through MCP tool calls. For the 278-ADR corpus that is ~278 record writes + ~250 forward edges + ~250 derived inverse edges ≈ **780 MCP round-trips**, one tool-invocation each. That is the practical wall that blocked Phase 3 of ADR-0271.

The pre-existing importer `forks/ruflo/plugins/ruflo-adr/scripts/import.mjs` "solved" the scale problem by shelling out to `ruflo memory store`, but it only populates the `adr-patterns` / `adr-edges` *memory* namespaces — **not** the hierarchical `adr/*` store or the causal graph the strict skill specifies. So it built a parallel, now-divergent index (the source of the stale double-entry keys purged 2026-05-30). It is also format-stale (reads `## Context` not `## Context and Problem Statement`; reads dropped `related`/`amends`/`superseded-by`; never reads `implements`; collapses sub-letter IDs `ADR-0039a → ADR-0039`).

The question: how do we make the canonical `/adr-index` build (all three surfaces) runnable as one scriptable command, so re-indexing 278 ADRs does not require ~780 hand-driven MCP calls and cannot silently diverge into the wrong store?

## Decision Drivers

* The index must build all three skill surfaces (hierarchical `adr/<id>`, causal edges + inverses, `adr-patterns`), not a scriptable subset.
* It must be runnable in one pass at corpus scale (278 records) without per-record MCP round-trips.
* It must not deadlock or block against a running MCP server (the ADR-0267 RVF-lock hazard).
* It must honour the strict skill contract (sub-letter IDs, frontmatter whitelist, referential integrity, derived-not-authored inverses).
* It must be a fork-side change (per fork-only-patches discipline), reusable for every future re-index, not a one-off script.

## Considered Options

* **A — Add an `agentdb index` CLI command (chosen, pending investigation).** A fork CLI subcommand that parses `docs/adr/` strictly and writes all three surfaces by calling the controllers directly in-process (HierarchicalMemory for `adr/<id>`, CausalMemoryGraph for edges, the RVF/HNSW path for `adr-patterns`) — one process, one pass, no MCP round-trips.
* **B — Drive MCP at scale.** Make the ~780 MCP calls from the agent. Faithful to the skill's exact tool surface, but slow, fragile, and not reusable.
* **C — Fix + canonicalize `import.mjs`.** Repair the stale importer to the strict contract and extend it to write the hierarchical + causal surfaces. Reuses existing code but inherits its shell-out-per-record architecture.
* **D — Scriptable subset only.** Populate `adr-patterns` via CLI now; defer hierarchical + causal indefinitely. Rejected as incomplete — it recreates the divergent-index problem this ADR exists to end.

## Decision Outcome

Chosen option: **"A — Add an `agentdb index` CLI command"**, because the investigation (below) confirmed all three canonical surfaces are reachable in a single in-process CLI command via the memory-router facade, with no MCP round-trips and no need to stand up the MCP server. The command cold-starts the in-process `ControllerRegistry` + `Archivist` once (~12–18 s for HNSW build + ONNX embedder load) then writes all 278 records + edges in-memory — replacing the ~780 MCP calls / N×`npx`-spawn model. It carries one operational precondition (RVF lock; see below) that is a documented constraint, not a blocker.

### Pre-flight (investigation findings, 2026-05-30, 3-agent swarm — all file:line-verified)

**Q1 — RVF lock is held for the MCP server's lifetime (not per-op).** ADR-0267's Revision 3 claim ("`withRouter`'s `_isPersistent` semantics handle release/re-acquire for ongoing tool traffic") is **inaccurate**. `_isPersistent` defaults `true` (`memory-router.ts:199`) and is set `false` **only** in the daemon (`worker-daemon.ts:961-962`), never in the MCP path; the archivist write path bypasses `withRouter` and pins `_storage` directly (`archivist-init.ts:1483-1523`); the native `WriterLock` lives in `RvfStore` (`store.rs:105`), acquired once on open and released only on `Drop`/close (`locking.rs:78-84`). So once the MCP server serves its first `tools/call` (lazy `ensureRvfWarmedUp`, `cli.js:113-117`), it holds `flock(LOCK_EX)` on `<path>.rvf.lock` for its whole lifetime. A separate CLI process writing RVF then blocks up to 30 s (`RVF_LOCK_ACQUIRE_TIMEOUT_MS`, `locking.rs:173-180`) and fails `LockHeld`. ADR-0267's smoke passes only because it writes *before* the server's first tool call. → **A correcting amendment is filed against ADR-0267.**

**Q2 — all three surfaces reachable in one in-process command (use the router facade, not raw controllers).**
- (a) hierarchical `adr/<id>`: `hierarchicalStore({key:'adr/<id>', value, tier:'semantic'})` (`agentdb-orchestration.ts:300-326`) → `HierarchicalMemory.store(content, importance, tier, {metadata:{key}, tags:[key]})` (`HierarchicalMemory.ts:234`). The wrapper encodes the ADR-0176 `metadata.key`+`tags` mapping that `query()` globs — use it, not a raw content-only write.
- (b) causal edges: `recordCausalEdge({sourceId,targetId,relation,weight})` (`agentdb-orchestration.ts:150-174`) → `routeCausalOp` (`memory-router.ts:2441-2499`). The agentdb controller path is intentionally dead (`CausalMemoryGraph.addCausalEdge` requires numeric memory IDs; ADR-0147 R7 unimplemented), so edges land via `routeMemoryOp({namespace:'causal-edges'})`. **Derived inverses are caller-side** — port the logic at `import.mjs:129-164` (the controller/router does not synthesize them).
- (c) `adr-patterns`: `routeMemoryOp({type:'store', namespace:'adr-patterns', key, value, generateEmbedding:true})` (`memory-router.ts:1126-1200`) → archivist `memory_store` dispatch.
- Reachability: `getController` / `ensureRegistry` / `getProcessArchivist` / `ensureRvfWired` all self-bootstrap in-process, no MCP listener (`memory-router.ts:1663-1708,1029-1039`; `archivist-init.ts:1204-1320`).

**Q3 — substrate per surface; 2 of 3 surfaces hit the RVF flock today (1 of 3 after ADR-0147 R7).**

| Surface | Substrate (durable) | RVF flock? |
|---|---|---|
| (a) hierarchical `adr/<id>` | SQLite `hierarchical_memory`, WAL (`substrate-registry.ts:164`; `HierarchicalMemory.ts:209,266`) | **No** — lock-free |
| (b) causal edge | SQLite-*classified* (`substrate-registry.ts:135`) but **RVF-written** via router fallback today, because ADR-0147 R7 is unimplemented (`causal-edge.ts:22-53`; `memory-router.ts:2486-2492`) | **Yes (today)** |
| (c) `adr-patterns` | RVF + HNSW (`substrate-registry.ts:77`; `memory-tools.ts:295-305`) | **Yes** |

### Decision: operational shape — blocked on a genuine ADR-0267 resolution

A standalone CLI process writing RVF **cannot** coexist with the running MCP server, and "stop the MCP server before indexing" is **rejected as an operational requirement** — the MCP server is the always-on surface the user interacts with through Claude Code; requiring it to be stopped to rebuild an index is unacceptable. Q1 proved the server holds the exclusive RVF flock for its whole lifetime after its first `tools/call`, so a second writer process is structurally impossible while the server runs.

Therefore the RVF surfaces (b causal-edges, c adr-patterns) require **single-writer coordination**, of which there are two sound forms — and ADR-0273 is **blocked on one of them landing**:

1. **Genuine ADR-0267 resolution (preferred dependency).** Make the MCP server not hold the RVF flock for its lifetime — i.e. release per-op, or make RVF cross-process concurrent. Then a standalone `agentdb index` process writes alongside the running server with no contention and no precondition. This is the real fix ADR-0267 still owes (its current fix covers only the idle server — see the 2026-05-30 amendment there).
2. **In-lock-holder batch (sidesteps the lock).** Expose the index build as a single server-side batch operation (one `agentdb_index` MCP tool, or a CLI command that delegates to the running server) that loops over all 278 ADRs and writes every surface **inside the process that already holds the lock**. One round-trip, zero contention — it eliminates both the ~780-round-trip problem and the lock problem at once. The standalone (no-server-running) path acquires the lock cleanly for the duration.

The hierarchical SQLite surface (a) is concurrency-safe (WAL) under either form and is never the blocker. Namespace convention: reuse the skill's `adr-patterns` + `adr-edges`; since `recordCausalEdge` hardcodes `causal-edges`, the command calls `routeMemoryOp({namespace:'adr-edges', …})` directly for edges to stay skill-canonical (or the skill is amended to `causal-edges` — a one-line reconciliation to settle at implementation).

**This ADR does not ship until form 1 or form 2 exists.** The dependency on a real ADR-0267 fix is hard, not advisory.

**Unblocked by ADR-0274 (2026-05-30):** ADR-0274 resolves ADR-0267 via form 1 (read/write handle split + per-transaction write release), so a standalone `agentdb index` process can write RVF alongside a running MCP server with no stop-server precondition. This ADR's implementation proceeds once ADR-0274 lands.

### Consequences

* Good, because one scriptable command builds the full canonical index (all 3 surfaces) — re-indexing stops requiring ~780 MCP calls or silently diverging into the wrong store.
* Good, because in-process controller calls amortize cold-start once (~12–18 s) instead of paying `npx` per record like `import.mjs`.
* Good, because a single canonical entry point ends the `import.mjs`-vs-skill divergence that produced the stale double entries (purged 2026-05-30).
* Bad, because it is fork code + a release, not a quick script.
* Bad, because it is **hard-blocked on a genuine ADR-0267 RVF-concurrency fix (or the in-server-batch design)** — it cannot ship while the MCP server holds the flock for its lifetime and stopping the server is off the table.
* Neutral, because derived-inverse logic must be carried caller-side (ported from `import.mjs`), since neither controller nor router synthesizes inverses.
* Neutral, because surface (b)'s RVF contention is an ADR-0147-R7 artifact — when R7 lands, causal edges move to SQLite and only surface (c) remains RVF-bound.

### Confirmation

* A `scripts/smoke-adr0273-*.mjs` acceptance check builds the index for the 278-ADR corpus and asserts: 278 `adr/<id>` records present (SQLite), edge count + inverses match frontmatter, `adr-patterns` populated (RVF), and `agentdb_hierarchical-query adr/*` returns all records (exercising the ADR-0176 fix).
* The smoke runs **with the MCP server running** (no stop-server step) and passes — proving the chosen single-writer form (real ADR-0267 fix, or in-server batch) actually removed the contention.
* Wired into the canonical acceptance harness (`run_check_bg` + `collect_parallel`), green in a release.

## Rules

### Design decisions resolved (2026-05-30, analysis swarm)

**D7 — Operational form: standalone CLI, one writer transaction, alongside a live MCP server.** Confirmed by ADR-0274's handle split — the index acquires the write flock for its batch and releases it, coexisting with the MCP server's persistent lock-free read handle. No reason to embed in MCP (that re-introduces the round-trips this ADR eliminates). All three surfaces reach in-process via the memory-router facade with no MCP listener. To get the literal "one flock for the whole index," the RVF-bound writes (b + c) must be issued as one batch transaction (ADR-0274 D2/D5), not a per-record `routeMemoryOp` loop.

**D8 — Edge namespace: `causal-edges` (runtime-canonical), and amend the skill.** The runtime hardcodes `namespace: 'causal-edges'` in the `recordCausalEdge` → `routeCausalOp` fallback (`memory-router.ts:2485-2492`); the legacy `adr-edges` came only from the stale `import.mjs` shelling out directly. Use the canonical `recordCausalEdge` path (it enrols the ADR-0181 audit chain via the causal-edge mutation handler), **not** a `routeMemoryOp({namespace:'adr-edges'})` bypass — bypassing recreates the divergent index this ADR exists to end. One-line skill reconciliation: drop the lingering `adr-edges` reference; edges live in `causal-edges`.

**D9 — Write edges to RVF now; do not wait for ADR-0147 R7.** Edges persist to RVF today (the controller arm is dead — `CausalMemoryGraph.addCausalEdge` needs numeric IDs the string-keyed surface lacks; R7 unimplemented). ADR-0274 removes the only obstacle (the lifetime flock), so the index writes edges to RVF contention-free now. R7 will later move them to SQLite transparently; gating the index on R7 would block it on unrelated cross-package infrastructure.

**D10 — Derive exactly the 3 skill inverses, caller-side.** `supersedes→superseded-by`, `depends-on→depended-on-by`, `implements→implemented-by` (skill §2.3c). Port the *mechanism* from `import.mjs:129-164` but not its dropped `related`/`amends` edges (Council 411/414). Corpus audit confirms every record uses exactly those three frontmatter slots and zero authored inverses, so the derivation is clean.

**D11 — Index all records including companions; size to the live glob (now 280, not 278).** The record-metadata contract keys off frontmatter (`status`/`date`/`tags`) + the first paragraph of `## Context and Problem Statement` only — it does not require Options/Outcome/Consequences. So the ~26 companion docs (audits/logs/trackers) each get a full record with empty option/consequence fields. All 280 `ADR-*.md` files carry the required fields (verified via `grep -L`). The index must size to `glob(docs/adr/ADR-*.md)`, not a frozen count.

### Amendment: implemented + deployed (2026-05-30)

Shipped the `agentdb index` CLI command in `forks/ruflo` (`commands/agentdb.ts`, registered in `commands/index.ts`) and released. Builds all 3 surfaces in one in-process pass via the memory-router facade: `hierarchicalStore({key:'adr/<id>'})`, `recordCausalEdge`→`causal-edges` (D8), `adr-patterns` via `routeMemoryOp`; derives the 3 inverses caller-side (D10); indexes all `ADR-*.md` incl. companions sized to the live glob (D11). Added a **`--purge`** flag (clears the 3 surfaces first — hierarchical via `getController('hierarchicalMemory').query/forget`, adr-patterns + causal-edges via `routeMemoryOp clearNamespace`) for deterministic, idempotent re-index. The `adr0273-index` acceptance smoke (3 surfaces + `--purge` idempotency, alongside a live MCP server with no stop) is green. The `/adr-index` skill was reconciled (edges live in `causal-edges`, not `adr-edges`). Unblocked once ADR-0274 landed; WS3 (ADR-0271 Phase 3) built the real 281-ADR corpus with it.

## Swarm Execution Plan

> Coordination model: `swarm_init` + `Agent`-tool fan-out (`run_in_background: true`), orchestrator synthesis. **No hive-mind / consensus.** Depends on ADR-0274 landing (the batch-write primitive + read/write handle split this command writes through).

**Configuration** — `swarm_init { topology: 'hierarchical', maxAgents: 3, strategy: 'specialized' }` (via `/ruflo-swarm:swarm`).

| Param | Value |
|---|---|
| topology | `hierarchical` |
| strategy | `specialized` |
| maxAgents | `3` |
| isolation | builder writes `forks/ruflo`; tester writes `ruflo-patch/scripts` → separate repos, no conflict; reviewer is read-only |

**Agent roster**

| Agent | Type | Fork/area | Task | Wave |
|---|---|---|---|---|
| builder | `backend-dev` | `forks/ruflo` | `agentdb index` CLI command: strict `docs/adr/` parser; 3 surfaces via the memory-router facade — `hierarchicalStore({key:'adr/<id>'})` (ADR-0176 `metadata.key`+`tags` mapping), `recordCausalEdge`→`causal-edges` (D8), `adr-patterns` via `routeMemoryOp`; one batch RVF transaction (D7 / ADR-0274 D2); public batch-write method on the cli backend; caller-side derivation of the 3 inverses (D10, ported from `import.mjs:129-164`); index all records incl. companions, sized to `glob(docs/adr/ADR-*.md)` (D11); one-line skill reconciliation (drop `adr-edges`). | 1 |
| tester | `tester` | `ruflo-patch/scripts` | `smoke-adr0273-index.mjs` (TDD: author first; runs alongside a live MCP server — no stop; asserts N records + edges + 3 inverses + `agentdb_hierarchical-query adr/*` returns all) + harness wiring (`run_check_bg` + `collect_parallel`). | 1 |
| reviewer | `reviewer` | read-only | Skill-canonical conformance: `causal-edges` (not `adr-edges`) via `recordCausalEdge` (not a `routeMemoryOp` bypass), exactly the 3 inverses (no dropped `related`/`amends`), sub-letter IDs not collapsed (`ADR-0039a` ≠ `ADR-0039`), `metadata.key` mapping intact. | 2 |

**Waves**
1. tester authors the failing smoke (no command yet) ‖ builder implements the command against it.
2. reviewer audits skill-canonical conformance once the command compiles and the smoke is reachable.

**Gate**: the existing `### Confirmation` — smoke green with the MCP server **running** (no stop step), wired into the canonical harness.

## More Information

- Depends on ADR-0176 (the `hierarchical-query` key-glob fix — the `adr/*` query this index feeds must read the stored key), ADR-0267 (the RVF-lock regression — Q1 found its Revision 3 lock-release claim inaccurate; a correcting amendment is filed there), and ADR-0147 (R7 string→numeric memory-ID mapping — its non-implementation is why causal edges write to RVF today instead of SQLite).
- Surfaced during ADR-0271 Phase 3 (the ADR-corpus MADR migration), when the 278-record index rebuild hit the MCP-only scale wall.
- Investigation conducted by a 3-agent swarm (2026-05-30); all findings file:line-verified and folded into §Pre-flight above. Status flipped `proposed → accepted` on completion of that gate.
- Implementation (the `agentdb index` command + smoke + harness wiring) is separate follow-up work in `forks/ruflo`.
