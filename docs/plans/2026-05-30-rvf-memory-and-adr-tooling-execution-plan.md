# Execution Plan — RVF memory concurrency + ADR tooling (2026-05-30)

Implements the decisions recorded this session: ADR-0176 (amendment), ADR-0271 Phase 3, ADR-0272, ADR-0273, ADR-0274, ADR-0275. Decisions are complete and committed; **none are implemented yet** — this plan sequences the build. Trunk-based; commit fork changes before `npm run release`; wire every smoke into the canonical acceptance harness (`run_check_bg` + `collect_parallel`).

## Dependency graph

```
WS0 (0176 fix release) ─┐
                        ├─> WS3 (0271 Phase 3 — corpus index)
WS1 (0274 lock fix) ──> WS2 (0273 index command) ─┘
       │
       └──────────────> WS4 (0275 HNSW Layer B)

WS5 (0272 typecheck) — independent, can start immediately
```

**Critical path: WS1 (ADR-0274).** Everything memory-write-related waits on the read/write handle split. WS0 and WS5 can run immediately in parallel.

---

## WS0 — Release the ADR-0176 `hierarchical-query` fix

**State:** fix committed in `forks/agentdb` (`2be4aba`, `HierarchicalMemory.query()` globs `json_extract(metadata,'$.key')` not `content`) but **not released** — the live MCP server still runs the old build.
**Do:** rebuild + republish `agentdb` to Verdaccio (`npm run release`), restart the MCP server so `agentdb_hierarchical-query adr/*` actually enumerates records.
**Verify:** `agentdb_hierarchical-query` with path `adr/*` returns records (the ADR-0176 Phase-3 acceptance). Add `scripts/smoke-adr0176-query-key.mjs`.

## WS1 — ADR-0274: RVF read/write handle split (CRITICAL PATH)

Resolves ADR-0267 (re-opened). Forks: `ruflo` (cli memory + router), `ruvector` (2 additive napi/runtime changes). agentdb adapter/archivist: **no change** (D1).

- **P1 — dual handle (cli).** `@claude-flow/memory/src/rvf-backend.ts`: add persistent `nativeReadDb` via `RvfDatabase.open_readonly`; route `search`/`query` to it; writes use a transient writer; `shutdownWriter()` closes only the writer fd. `memory-router.ts`: keep `_storage` persistent/read-bearing; per-op release closes **only** the transient writer (not the backend). (D1, D2)
- **P2 — ruvector change #1: cross-process freshness.** Additive napi `peekTxnid(path)` — O(1) RootHeader read (`root_header.rs`); read handle peeks before each query, reopens lazily if the on-disk txnid advanced. (D3, D4)
- **P3 — ruvector change #2: writer lock lifecycle.** Decouple flock acquire/release from `open`/`close` on `RvfStore`, with O(1) txnid re-validation on re-acquire, so the persistent writer cycles only the flock (no per-write O(vectors) `boot()` reload). **Witness-chain integrity stress-test** via the ADR-0167 cross-process harness before shipping; reopen-per-transaction is the documented fallback if integrity proves unmanageable. (D5)
- **Verify:** `scripts/smoke-adr0274-rvf-rw-split.mjs` — start MCP, issue a `tools/call` (past warmup), then from a separate process run `cli memory store` + the index path: assert no `LockHeld`, no 30 s hang, both succeed; `memory_search` works; read-after-write reflects within the consistency window. Must FAIL pre-fix, PASS post-fix.

## WS2 — ADR-0273: `agentdb index` CLI command (depends WS1)

In-process fork CLI command building all 3 `/adr-index` surfaces for the live glob (~280) in one batch transaction.
- Records → `hierarchicalStore({key:'adr/<id>'})` (SQLite); edges → `recordCausalEdge` → `causal-edges` (D8); write edges to RVF now (D9); derive the 3 skill inverses caller-side (D10); index all records incl. companions, size to `glob(docs/adr/ADR-*.md)` (D11). Add a public batch-write method on the cli backend (D2/D7).
- One-line skill reconciliation: drop legacy `adr-edges`, edges live in `causal-edges`.
- **Verify:** `scripts/smoke-adr0273-index.mjs` — runs alongside a live MCP server (no stop), asserts N records + edges + inverses, and `agentdb_hierarchical-query adr/*` returns all.

## WS3 — ADR-0271 Phase 3: build the corpus index (depends WS0 + WS2)

The payoff. **Only via the WS2 command — never ad-hoc** (the 2026-05-30 hand-index attempt showed why: ~780-round-trip wall, MCP/CLI snapshot split, double-entry risk).
- **Purge** stale `adr/*` hierarchical + `adr-patterns` + edge entries first.
- **Rebuild** all 280 via `agentdb index`.
- **Verify** strict `adr-index`: 280 unique IDs, zero orphan typed-relation targets, zero frontmatter/section violations.

## WS4 — ADR-0275: RVF-native HNSW Layer B (depends WS1)

- **P1 — envelope wiring.** Route fork RVF memory reads through `query_with_envelope` (upstream's safety net + quality reporting; no new algorithm). Runs on WS1's read handle.
- **P2 — Layer B.** `forks/ruvector/rvf-runtime`: HNSW via `hnsw_rs` (0.3.3, M reconciled with the project's mpnet m=23), persisted as a **witnessed HNSW segment** in the append-only `.rvf` (RootHeader-committed, crash-safe), loaded on `boot()`, `layer_b: true`, incremental insert on ingest; rebuild on compact.
- **Verify:** `cargo` recall + latency bench (HNSW vs brute-force exact; O(log N) scaling) + JS acceptance smoke; crash-safe round-trip (kill mid-ingest, reopen, witness chain validates).
- **Out of this WS:** RaBitQ/PQ quantization (Layer C, upstream ADR-154) → future ADR.

## WS5 — ADR-0272: typecheck hygiene (independent)

- Fix the 6 shipped-`src/` type errors — incl. the real latent bug `agentdb-mcp-server.ts:2266` (`.toFixed()` on a `Promise`, missing `await`), `AgentDB.ts:256/319` duplicate `database`, `SyncCoordinator.ts:962`, `HierarchicalMemory.ts:380` tier typing.
- Add `tsconfig.build.json` scoped to `src/` (excl. `src/examples/**`); CI runs `tsc --noEmit -p tsconfig.build.json` and **gates on exit 0**; `benchmarks/`/`examples/`/`tests/` stay advisory (solution-style config per ADR-0260 precedent).
- **Verify:** the gated `tsc --noEmit` exits 0; new acceptance check.

---

## Sequencing summary

1. **Immediately, parallel:** WS0 (0176 release), WS5 (typecheck), and WS1-P1 (cli dual handle).
2. **Then:** WS1-P2/P3 (ruvector changes + stress test) → land WS1, release.
3. **Then:** WS2 (index command) and WS4 (HNSW) in parallel (both on WS1).
4. **Finally:** WS3 (build the corpus index) once WS0 + WS2 are live.

Each workstream: commit fork(s) before release, wire the smoke into the harness, keep the green-bar gate. No time estimates — order by dependency and risk: WS1-P3 (lock lifecycle vs witness chain) is the highest-risk item and carries the stress-test gate.
