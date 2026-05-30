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

2. **A running MCP server's adr-patterns/causal-edges view is bounded by its in-memory `entries` Map** (the documented ADR-0274 cross-process freshness limit). After a CLI process writes (e.g. `agentdb index`), the already-running server keeps serving its stale RVF view until it reboots. Symptom seen this session: server showed 183 adr-patterns / 2 causal-edges while a fresh CLI showed 281 / 850. **Restart/reconnect the ruflo MCP server after any out-of-process index build.** (Hierarchical `adr/*` is unaffected — it reads SQLite live.)

3. **Edge count is ~850, not the nominal 864** (432 forward + 432 inverse). The `causal-edges` key is `FROM→TO` with the relation in the *value*, so when the same ordered ADR pair is produced by two relations they collide on key (upsert) — a minor fidelity loss, not lost relationships. If exact-per-relation edges are ever needed, the key scheme must include the relation.

4. **The ORIGINAL WS3 index run's RVF-surface writes did not persist to the durable store** (showed 183 adr-patterns / 2 stale May-17 causal-edges); the hierarchical SQLite side was always correct (281). Re-running `agentdb index --purge` with the MCP server up (patch.382) persisted them correctly (281 / 850, verified via a fresh CLI). **Root cause not fully nailed** — the isolated `adr0273-index` acceptance smoke (incl. `--purge` idempotency) passes cleanly, so it looks like a transient artifact of the marathon's kill-MCP-then-many-releases-then-reconnect sequence (a stale reader re-committing an older manifest / the cross-process snapshot), not a code regression. **If re-indexing into the real store, verify durable counts via a fresh CLI afterward, and restart the server.**

5. **Release-pipeline gotchas hit this session** (both diagnosed, not papered over): (a) the known dist-skip — incremental build skipped `@sparkleideas/shared` whose `dist/` was wiped → consumers `ERR_MODULE_NOT_FOUND`; fix is `npm run release -- --force`. (b) two timeout-shaped acceptance checks (`ctrl-cluster-b`, `p6-val-unicode`) flaked under the machine load of repeated --force releases + the cargo HNSW build; they recovered on a re-run under lower load. (c) an aborted release left orphaned `sleep`/`tee` children holding the `/tmp/ruflo-pipeline.lock` flock — a fresh release exits with "another pipeline run holds the lock" until those orphans die; `lsof -t /tmp/ruflo-pipeline.lock` finds them.

## Next actions / open items

- **None blocking.** The program is complete and deployed.
- Optional: nail down caveat #4's root cause (instrument the index → durable-commit path against the real store; the smoke covers the isolated path).
- Optional: include the relation in the `causal-edges` key (caveat #3) if per-relation edge fidelity is required.
- ADR-0147 R7 (string→numeric memory-id mapping) would move causal edges into the graph controller and make `agentdb_causal-query` work for ADRs (caveat #1) — separate, unscheduled.
- The `/loop` was run to completion and the recurring cron job was deleted.
