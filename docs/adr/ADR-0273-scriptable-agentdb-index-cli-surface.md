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

### Decision: operational shape

The command runs as a **standalone one-shot process** that itself acquires the RVF flock, writes, and exits (releasing it). Its **precondition: no MCP server may be actively holding the RVF lock** — i.e. stop the MCP server, or run before it has served any `tools/call`. The hierarchical SQLite surface (a) is unaffected and can write concurrently; only surfaces (b)+(c) require the precondition (narrowing to just (c) once ADR-0147 R7 moves causal edges to a real SQLite INSERT). Namespace convention: reuse the skill's `adr-patterns` + `adr-edges`; since `recordCausalEdge` hardcodes `causal-edges`, the command calls `routeMemoryOp({namespace:'adr-edges', …})` directly for edges to stay skill-canonical (or the skill is amended to `causal-edges` — a one-line reconciliation to settle at implementation).

### Consequences

* Good, because one scriptable command builds the full canonical index (all 3 surfaces) — re-indexing stops requiring ~780 MCP calls or silently diverging into the wrong store.
* Good, because in-process controller calls amortize cold-start once (~12–18 s) instead of paying `npx` per record like `import.mjs`.
* Good, because a single canonical entry point ends the `import.mjs`-vs-skill divergence that produced the stale double entries (purged 2026-05-30).
* Bad, because it is fork code + a release, not a quick script.
* Bad, because the RVF flock forces a "stop/idle the MCP server before indexing" precondition for surfaces (b)+(c); the command must detect a held lock and fail loud with that guidance rather than hang 30 s.
* Neutral, because derived-inverse logic must be carried caller-side (ported from `import.mjs`), since neither controller nor router synthesizes inverses.
* Neutral, because surface (b)'s RVF contention is an ADR-0147-R7 artifact — when R7 lands, causal edges move to SQLite and the precondition narrows to surface (c) only.

### Confirmation

* A `scripts/smoke-adr0273-*.mjs` acceptance check builds the index for the 278-ADR corpus and asserts: 278 `adr/<id>` records present (SQLite), edge count + inverses match frontmatter, `adr-patterns` populated (RVF), and `agentdb_hierarchical-query adr/*` returns all records (exercising the ADR-0176 fix).
* The command fails loud (not a 30 s hang) when the RVF lock is held by a running MCP server, printing the stop-server precondition.
* Wired into the canonical acceptance harness (`run_check_bg` + `collect_parallel`), green in a release.

## More Information

- Depends on ADR-0176 (the `hierarchical-query` key-glob fix — the `adr/*` query this index feeds must read the stored key), ADR-0267 (the RVF-lock regression — Q1 found its Revision 3 lock-release claim inaccurate; a correcting amendment is filed there), and ADR-0147 (R7 string→numeric memory-ID mapping — its non-implementation is why causal edges write to RVF today instead of SQLite).
- Surfaced during ADR-0271 Phase 3 (the ADR-corpus MADR migration), when the 278-record index rebuild hit the MCP-only scale wall.
- Investigation conducted by a 3-agent swarm (2026-05-30); all findings file:line-verified and folded into §Pre-flight above. Status flipped `proposed → accepted` on completion of that gate.
- Implementation (the `agentdb index` command + smoke + harness wiring) is separate follow-up work in `forks/ruflo`.
