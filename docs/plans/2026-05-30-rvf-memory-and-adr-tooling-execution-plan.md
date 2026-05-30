# Execution Plan — RVF memory concurrency + ADR tooling (2026-05-30)

Implements the decisions recorded this session: ADR-0176 (amendment), ADR-0271 Phase 3, ADR-0272, ADR-0273, ADR-0274, ADR-0275. Trunk-based; commit fork changes before `npm run release`; wire every smoke into the canonical acceptance harness (`run_check_bg` + `collect_parallel`).

## Execution status (2026-05-30, COMPLETE)

**All six workstreams implemented, acceptance-green (724/733, 0 failed, 9 skip_accepted), and deployed** (`@sparkleideas/*` patch.382; fork bumps pushed to sparkling). All five ADRs (0271/0272/0273/0274/0275) carry implementation amendments; ADR-0267 resolved by 0274; ADR-0176 key-glob fix shipped + verified.


| WS | ADR | Status |
|---|---|---|
| WS5 | 0272 typecheck gate | ✅ DONE + deployed (agentdb `a864a1c`; `tsconfig.build.json` + `adr0272-typecheck` acceptance check green) |
| WS0 | 0176 release | ✅ DONE + deployed (agentdb fix live; `adr0176-query-key` discriminating smoke green) |
| WS1 | 0274 RVF handle split | ✅ DONE + deployed (ruvector `8fb99c02b` peekTxnid + park/unpark; ruflo park/unpark + idle-timer + light-resync; `adr0274-rvf-rw-split` smoke green) |
| WS2 | 0273 `agentdb index` | ✅ DONE + deployed (ruflo command + `--purge`; `adr0273-index` smoke incl. idempotency green) |
| WS3 | 0271 Phase 3 corpus index | ✅ DONE — built via `agentdb index --purge` alongside live MCP (no LockHeld): **281 unique adr/* records (0 dups, SQLite-verified), 281 adr-patterns, 432 edges + 432 inverses** |
| WS4 | 0275 HNSW Layer B | ✅ DONE + deployed (ruvector `9e4c157f9` HNSW via rvf-index, witnessed INDEX_SEG, recall@10=1.0, crash-safe; napi `queryWithEnvelope`; ruflo Phase 1 envelope wiring; `adr0275-hnsw` smoke green — `layerB=true`) |

**Key implementation deviations (recorded for the ADRs):**
- **WS1 chose the single-handle park/unpark model (D5)** over the literal two-object read/write split (D1): every native write funnels through `acquireLock`/`releaseLock`, queries don't, so parking the flock when idle resolves ADR-0267 while queries stay lock-free; same-process read-your-own-writes is automatic.
- **Witness chain is session-local** (`boot()` never restores `last_witness_hash`) → no global chain to fork; the only integrity hazard is stale-manifest clobber, closed by `unpark_writer`'s O(1) txnid re-validation + a lightweight manifest-only `resync_for_write` (not a full `boot()` reload — avoids O(N²) under N-writer contention).
- **Park is debounced on a 50ms idle timer** so a write burst holds the flock across the burst (no per-op churn); only true idle releases. This passed the N=6 cross-process stress that per-op cycling failed.
- **Cross-process content freshness is bounded by the in-memory `entries` Map** (pre-existing architecture limit), documented as the consistency window.
- **`agentdb index --purge`** added as the canonical deterministic re-index (purge-then-rebuild via the command, not ad-hoc).
- **WS4 reused the existing `rvf-index` HNSW kit** (HnswGraph + a new faithful `serialize_graph` — the legacy codec assumed contiguous ids); persisted as a **witnessed `Index` segment** written before the RootHeader commit (crash-safe), loaded on `boot()` (no rebuild); recall@10=1.0; the bare `query()` also traverses HNSW so the fork search path gets O(log N) transparently.

Released through `@sparkleideas/*` patch.382; final acceptance 724/733 passed, 0 failed, 9 skip_accepted; fork bumps pushed to sparkling.

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

---

## Swarm execution (per workstream)

Coordination model for every workstream: **`swarm_init`** (persistent topology state, via the `/ruflo-swarm:swarm` skill) + **`Agent`-tool fan-out** (`run_in_background: true`), synthesis by the orchestrator. **No hive-mind / consensus** (2026-05-30 directive). Each workstream's full roster + intra-swarm waves live in its driving ADR's `## Swarm Execution Plan` section — this table is the index + the cross-cutting rules.

| WS | ADR | topology | strategy | maxAgents | forks touched | notes |
|---|---|---|---|---|---|---|
| **WS0** | 0176 | — (no swarm) | — | — | `forks/agentdb` | Single release + MCP restart + 1 smoke. Optionally 1 `tester` to author `smoke-adr0176-query-key.mjs` while the release runs. |
| **WS1** | 0274 | `hierarchical-mesh` | specialized | 5 | `ruvector` + `ruflo` | **Critical path.** Witness-chain stress gate (P3) = highest risk in the program. |
| **WS2** | 0273 | `hierarchical` | specialized | 3 | `ruflo` | Depends WS1 (batch-write primitive). |
| **WS3** | 0271 P3 | `star` | specialized | 2 | — (index build) | **No writer fan-out** — single serial indexer + 1 read-only validator. Depends WS0 + WS2. |
| **WS4** | 0275 | `hierarchical-mesh` | specialized | 4 | `ruvector` + `ruflo`/`agentdb` | Depends WS1. Deep Rust + crash-safety gate. |
| **WS5** | 0272 | `hierarchical` | specialized | 3 | `forks/agentdb` | Small; swarm at the floor of useful (concern-separation, not throughput). Independent — start now. |

**Cross-workstream concurrency rules**

- **`forks/ruvector` is touched by both WS1 and WS4** — their swarms must not run concurrently on the same tree (WS4 depends on WS1 landing anyway). Sequence, or worktree-isolate.
- **Same-fork parallel writers conflict** — within a swarm, at most **one writer per fork tree** (serialize) unless worktree-isolated. Cross-fork agents are naturally isolated (different repos).
- **WS3 is single-writer by mandate** — never spawn concurrent RVF writers (the 2026-05-30 hand-index failure mode); parallelism there is verification-only.
- **Smoke/acceptance scripts land in `ruflo-patch/scripts`** + the canonical harness, never the fork trees — so tester agents never conflict with fork coders.
- **No hives anywhere** — every config is `swarm_init` + `Agent` fan-out with orchestrator synthesis; no `hive-mind_spawn`, no queen/consensus.
