# Session Handover — 2026-05-30 (RVF + ADR tooling EXECUTION)

Execution of `docs/plans/2026-05-30-rvf-memory-and-adr-tooling-execution-plan.md`. The prior handover (`SESSION-HANDOVER-2026-05-30.md`) recorded the *decisions* (5 ADRs, none implemented). This session *implemented and deployed* all of them.

## Outcome — all 6 workstreams done, acceptance-green, deployed

Released through `@sparkleideas/*` **patch.382**; final acceptance **724/733 passed, 0 failed, 9 skip_accepted**; fork version bumps pushed to `sparkling`. All trees clean.

| WS | ADR | Result | Key commits |
|---|---|---|---|
| WS5 | 0272 typecheck gate | shipped src/ type-clean + `tsconfig.build.json` gate; `adr0272-typecheck` green | agentdb `a864a1c` |
| WS0 | 0176 release | key-glob fix live; `adr0176-query-key` discriminating smoke green | (2be4aba + a864a1c) |
| WS1 | 0274 RVF handle split | **critical path** — single-handle park/unpark + idle-timer + light-resync; `adr0274-rvf-rw-split` green; **resolves ADR-0267** | ruvector `8fb99c02b`, ruflo `3060828d8`/`8084a5b84` |
| WS2 | 0273 `agentdb index` | new CLI command + `--purge`; `adr0273-index` green (3 surfaces alongside live MCP, idempotent) | ruflo `fb87d6a89`/`c232a4528` |
| WS3 | 0271 Phase 3 | corpus index built via the command; 281 hierarchical + 281 adr-patterns + ~850 causal-edges | (ran `agentdb index --purge`) |
| WS4 | 0275 HNSW Layer B | rvf-index HNSW + witnessed `Index` segment (crash-safe), recall@10=1.0; napi `queryWithEnvelope`; Phase-1 envelope wiring; `adr0275-hnsw` green (`layerB=true`) | ruvector `9e4c157f9`, ruflo `1f5055a31` |

ADRs 0271/0272/0273/0274/0275 carry implementation amendments; ADR-0267 has a resolution amendment; ADR-0176's amendment notes shipped+verified (ruflo-patch commits `83ed618` + the plan finalize `78f8e06`). Memory entry written: `project-adr0267-0274-rvf-lock-resolution`.

## Key engineering decisions / deviations (recorded in the ADRs)

- **WS1 chose the single-handle park/unpark model (D5)** over the literal two-object read/write split (D1): every native write funnels through `acquireLock`/`releaseLock`, queries don't, so parking the flock when idle resolves ADR-0267 while queries stay lock-free.
- **The RVF witness chain is session-local** — `boot()` never restores `last_witness_hash` (re-anchors at genesis per open) → no global chain to fork; the only integrity hazard is a parked writer clobbering a peer's manifest with a stale segment dir, closed by `unpark_writer`'s O(1) txnid re-validation.
- **`unpark` uses a lightweight manifest-only `resync_for_write`, not a full `boot()`** — full reload per reacquire is O(vectors) and under N=6 interleaving becomes O(N²) → lock-timeout cascade. Resync re-reads only the segment dir/epoch/seg id.
- **Park is debounced on a 50 ms idle timer** so a write burst holds the flock across the burst; only true idle releases. Passed the N=6 cross-process stress that per-op cycling failed.
- **WS4 reused the existing `rvf-index` HNSW kit** (added a faithful `serialize_graph` — the legacy codec assumed contiguous ids); the bare `query()` also traverses HNSW, so the fork search path gets O(log N) transparently.

## Post-deploy index verification (live test)

Verified against the live store after deploy:
- **Hierarchical** `agentdb_hierarchical-query adr/*` enumerates; `adr/ADR-0274` returns the exact record (ADR-0176 key-glob fix live). 281 records.
- **Semantic search** (HNSW): "RVF writer lock read/write handle split" → ADR-0274 (0.71, top), ADR-0267 (0.53), + the RVF concurrent-write lineage (0133/0167/0095/0163).
- **Durable counts** (fresh server after restart): adr-patterns **281**, causal-edges **850**, 1,166 total, 100% embedding coverage.

## ⚠️ Honest caveats (carry these forward)

1. **`agentdb_causal-query` (the graph tool) returns empty — by design.** Per ADR-0273 D8/D9 the index writes edges to the `causal-edges` *memory namespace* (via `recordCausalEdge` → `routeMemoryOp`), NOT the `CausalMemoryGraph` controller — that path is intentionally dead until **ADR-0147 R7** (it needs numeric memory ids the string-keyed ADR surface lacks). Find related ADRs via the `causal-edges` namespace (keyed `FROM→TO`, relation in the value) + semantic search, **not** `agentdb_causal-query`.
   - **CORRECTED (2026-05-31): this is wrong — the tool is NOT empty.** Live probe against the durable store: `agentdb_causal-query effect=ADR-0201` → all **39** inbound, `cause=ADR-0261` → all **11** outbound, `effect=ADR-0233` → **18** (17 + 1 derived inverse) — complete, corpus-accurate, via `controller: "router-fallback"`. The *controller arm* is dead (the always-false `addEdge` guard + wrong-shape read calls; R7 deferred), but the *tool overall* works because the ADR-0147 **R6 KV-namespace fallback** is the canonical read path and returns everything at full scale (past the old Bug-6 first-100 cap). **Use `agentdb_causal-query` normally — it works.** The forward-looking re-convergence onto the controller (to also unlock multi-hop traversal / `ExplainableRecall` / cascade-delete — upstream's documented vision) is **[[ADR-0276]]** (`proposed`); R7 stays deferred as that ADR's work.

2. **A running MCP server's adr-patterns/causal-edges view is bounded by its in-memory `entries` Map** (the documented ADR-0274 cross-process freshness limit). After a CLI process writes (e.g. `agentdb index`), the already-running server keeps serving its stale RVF view until it reboots. Symptom seen this session: server showed 183 adr-patterns / 2 causal-edges while a fresh CLI showed 281 / 850. **Restart/reconnect the ruflo MCP server after any out-of-process index build.** (Hierarchical `adr/*` is unaffected — it reads SQLite live.)
   - **RESOLVED-PENDING-RELEASE (2026-05-31).** This is now addressed by the ADR-0274 D3/D4 cross-process content-freshness wiring (fork commit `01d1feac7`): a lazy `peekTxnid`-guarded `_maybeReloadFromDisk()` on `query()` / `search()` / `count()` / `listNamespaces()` lock-free-reloads committed peer state within one debounce window — so the "restart the server" step is **auto-handled once the fix ships**. Read-path side of the D6 consistency window is closed. Status is **implemented + fork-verified; release verification pending** — the confirming smoke is fork-dist-pinned, and installed-artifact / shipped-binding (`peekTxnid`/`openReadonly`) verification is a tracked release gate. Until that gate clears, keep restarting the server as a precaution. See ADR-0274 → *Amendment: cross-process content-freshness wired (D3/D4) — 2026-05-31*.

3. **Edge count is ~850, not the nominal 864** (432 forward + 432 inverse). The `causal-edges` key is `FROM→TO` with the relation in the *value*, so when the same ordered ADR pair is produced by two relations they collide on key (upsert) — a minor fidelity loss, not lost relationships. If exact-per-relation edges are ever needed, the key scheme must include the relation.
   - **QUANTIFIED (2026-05-31): the exact loss is 10 edges / 5 ADR pairs (864 → 854), not ~14/~850.** The 5 colliding ordered pairs each declare two relations in the same direction: `ADR-0077→ADR-0076` {supersedes, depends-on}, `ADR-0083→ADR-0080` {supersedes, depends-on}, `ADR-0137→ADR-0100` {depends-on, implements}, `ADR-0178→ADR-0176` {depends-on, implements}, `ADR-0256→ADR-0254` {depends-on, implements} — 5 forward + 5 inverse-mirror = 10. **No node is disconnected and no `cause=`/`effect=` query loses a result** — only a secondary relation *label* on an edge that already exists is dropped (the triple-key dedupe at `memory-router.ts:2608` was meant to keep both, but `upsert:true` collapses them at write time first). **DOCUMENT-ONLY**: the fix is small (append `#${relation}` to the key) but reopens the fragile `effect=` suffix parser, so it's not worth a 1.2% fidelity gain. It dissolves entirely under **[[ADR-0276]]** (controller rows keyed `(from_memory_id, to_memory_id, relation)`).

4. **The ORIGINAL WS3 index run's RVF-surface writes did not persist to the durable store** (showed 183 adr-patterns / 2 stale May-17 causal-edges); the hierarchical SQLite side was always correct (281). Re-running `agentdb index --purge` with the MCP server up (patch.382) persisted them correctly (281 / 850, verified via a fresh CLI). **Root cause not fully nailed** — the isolated `adr0273-index` acceptance smoke (incl. `--purge` idempotency) passes cleanly, so it looks like a transient artifact of the marathon's kill-MCP-then-many-releases-then-reconnect sequence (a stale reader re-committing an older manifest / the cross-process snapshot), not a code regression. **If re-indexing into the real store, verify durable counts via a fresh CLI afterward, and restart the server.**
   - **RECLASSIFIED (2026-05-31): this is NOT a durability bug — the disk was never corrupted.** File:line code-trace + the cargo witness `park_unpark_absorbs_peer_write_no_clobber` prove the park/unpark/`resync_for_write`/`commit_new_root` path has **no stale-manifest clobber window**: segments are append-only (`SeekFrom::End`), `resync_for_write` rebuilds the *full* `segment_dir`/`epoch`/`file_identity` before any commit, txnids are monotonic, and `close()` writes no manifest. The observed 183/2-vs-281/850 was a **read-layer artifact, not a write loss** — two mechanisms: (i) the stale in-memory read view (= caveat #2, now fixed by the D3/D4 freshness wiring), and (ii) the stronger candidate — **singleton cwd-pinned `.rvf` path desync** (`memory-router.ts` pins `_databasePath` on first call from `process.cwd()`; the "2 stale **May-17** causal-edges" is the signature of a *separate, older* `.rvf`, i.e. server and CLI read different files — matches `feedback-singleton-frozen-state-desync`). The SQLite side stayed correct because it isn't cwd-pinned the same way. So: reclassify from "possible write-loss / unknown root cause" → **stale cross-process read view + path desync; durable store unaffected.** Optional hardening (not done): a cargo `debug_assert!(writer_lock.is_some())` on entry to `ingest_batch` — the one currently-unguarded Rust invariant — to statically catch any future JS-side park-discipline break.

5. **Release-pipeline gotchas hit this session** (both diagnosed, not papered over): (a) the known dist-skip — incremental build skipped `@sparkleideas/shared` whose `dist/` was wiped → consumers `ERR_MODULE_NOT_FOUND`; fix is `npm run release -- --force`. (b) two timeout-shaped acceptance checks (`ctrl-cluster-b`, `p6-val-unicode`) flaked under the machine load of repeated --force releases + the cargo HNSW build; they recovered on a re-run under lower load. (c) an aborted release left orphaned `sleep`/`tee` children holding the `/tmp/ruflo-pipeline.lock` flock — a fresh release exits with "another pipeline run holds the lock" until those orphans die; `lsof -t /tmp/ruflo-pipeline.lock` finds them.

## Next actions / open items

- **None blocking.** The program is complete and deployed.
- Optional: nail down caveat #4's root cause (instrument the index → durable-commit path against the real store; the smoke covers the isolated path).
- Optional: include the relation in the `causal-edges` key (caveat #3) if per-relation edge fidelity is required.
- ADR-0147 R7 (string→numeric memory-id mapping) would move causal edges into the graph controller and make `agentdb_causal-query` work for ADRs (caveat #1) — separate, unscheduled.
- The `/loop` was run to completion and the recurring cron job was deleted.

### 2026-05-31 follow-up (caveat investigation + fixes — supersedes the items above)

A "investigate, validate, and fix all the caveats" pass re-examined all five. Net result: **most caveats were not bugs** — #1 was a handover misstatement (the tool works), #4 was a misclassification (no data loss), #3 is a 1.2% cosmetic loss. The genuine work:

- **Caveat #1 — corrected.** `agentdb_causal-query` works (probe-verified). Forward re-convergence onto the controller (fulfill upstream's documented causal vision: traversal/explain/cascade) is **[[ADR-0276]]** (`proposed`, awaiting ratification + implementation). R7 deferral stays, now owned by ADR-0276.
- **Caveat #2 — fixed, awaiting release.** ADR-0274 D3/D4 cross-process freshness wired (fork `01d1feac7`); fork-verified; smoke + harness landed. Binding confirmed shipping-ready. **Needs a release to deploy** (the commit post-dates patch.382).
- **Caveat #3 — quantified, DOCUMENT-ONLY.** 10 edges / 5 pairs; dissolves under ADR-0276.
- **Caveat #4 — reclassified.** Not a durability bug; stale read-view + cwd-path desync. The read-view half is fixed by caveat #2.
- **Caveat #5 — FIX-NOW in progress.** dist-skip guard, parallelism cap + inner-timeout bumps, orphan-lock trap + liveness-guarded reaper (pipeline scripts). To land in the same release as caveat #2.
- **ADR-0276 (`proposed`)** — re-converge ADR causal edges onto upstream's `CausalMemoryGraph` controller; scope decision (layer-1 graph vs layer-2 inference) pending ratification.
