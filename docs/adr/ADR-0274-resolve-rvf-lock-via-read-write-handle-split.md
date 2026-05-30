---
status: accepted
date: 2026-05-30
tags: [rvf, ruvector, mcp, memory, lock, concurrency, architecture]
supersedes: []
depends-on: [ADR-0267, ADR-0202, ADR-0207, ADR-0167, ADR-0095]
implements: []
---

# Resolve the RVF writer-lock lifetime hold via a read/write handle split + per-transaction write release

## Context and Problem Statement

ADR-0267 (re-opened 2026-05-30) is the live regression: the MCP server (`bin/cli.js` MCP-mode) holds the RVF exclusive `flock(LOCK_EX)` for its whole lifetime after its first `tools/call`, so any concurrent CLI memory write — including the ADR-0273 `agentdb index` — blocks ~30 s then fails `LockHeld`. "Stop the server" is not an acceptable standing requirement. The fork is committed to RVF + upstream's Cognitive-Container vision (ADR-0177), so the question is purely *how* to make concurrent RVF writes work, not *whether* to leave RVF.

Why the lock exists at all (so any fix composes with it, not against it): RVF is a **verifiable container** whose integrity rests on a linear append-only Merkle witness chain — `append_witness` (`store.rs:2174`) chains each entry from `last_witness_hash` then advances it. Two writers appending at once fork the chain and break attestation. The kernel flock (which replaced a broken `O_EXCL`/PID scheme under ADR-0095) enforces that linearity; readers take **no** lock (`open_readonly`, `store.rs:386`, `writer_lock: None`). So single-writer is intrinsic, not incidental — and ADR-0167 explicitly ruled "replace the flock" out of scope.

A 3-agent file:line investigation (2026-05-30) settled the three open questions that gated the fix.

## Decision Drivers

* Must compose with the flock (ADR-0167 mandate) and the linear witness chain — concurrent multi-writer RVF is off the table.
* Must not reintroduce a daemon IPC broker — ADR-0207 deleted it, on the explicit grounds that upstream "chose files and in-process concurrency over a daemon broker."
* Must not regress `memory_store` / `memory_search` latency past the ADR-0267 >10% bar.
* Must satisfy ADR-0267 Rev 2's objection that a naive `setRouterPersistent(false)` is insufficient because the archivist pins `_storage` directly, bypassing `withRouter`.
* Must unblock ADR-0273 (the index must write alongside a running MCP server).

## Considered Options

* **Option 1 — read/write handle split + per-transaction write release (chosen).** Hold a persistent **lock-free** `open_readonly` handle for `memory_search`; do writes through a **transient** `open → ingest_batch → close` handle that holds the flock only for the write transaction. The archivist pins the *read* handle (holds no flock → safe to pin forever); the *write* handle is flock-bounded, matching the per-op release the daemon already does (`setRouterPersistent(false)`, `worker-daemon.ts:960-963`).
* **Option 2 — daemon / single-writer-process write-routing (rejected).** Route all RVF writes through one lock-holding process via IPC. Rejected: ADR-0207 (accepted) removed the Unix-domain-socket layer precisely because upstream rejected the broker; rebuilding a request/response channel reverses that decision and is a pure fork divergence. The investigation confirmed no socket exists today (`worker-daemon.ts:25-27`) and the standalone-fallback half is ~80 % scaffolded but the write-routing half is net-new.
* **Option 3 — cross-process-concurrent / lock-free RVF (rejected).** Architecturally impossible without abandoning the verifiable linear witness chain — two concurrent appenders fork the chain. Would require redesigning RVF's core integrity guarantee.

## Decision Outcome

Chosen option: **"Option 1 — read/write handle split + per-transaction write release"**, because it is the only option that composes with the flock + witness chain (Option 3 is impossible), does not reintroduce the broker ADR-0207 deleted (Option 2 reverses an accepted, upstream-aligned decision), and is confirmed feasible and within the cost bar by the investigation. It is also exactly the mechanism ADR-0202/0207 already named ("per-op lock release") — generalised from the daemon (which already releases per tick) to the MCP server's archivist write path.

### Investigation findings (2026-05-30, 3-agent swarm, file:line-verified)

**Q1 — handle split is feasible; it sidesteps Rev 2's objection.** Today one object serves both paths (archivist's single `rvfSubstrate` → one `MemoryRvfAdapter` → one cli `_storage` → one native `RvfStore` holding the flock). The native layer already provides the split primitive: `open_readonly` sets `writer_lock: None` (`store.rs:386`) and `boot()` loads a fully-queryable in-memory `VectorData`, so the searchable state is **not** bolted to the write fd. Rev 2's objection (per-op `_storage.shutdown()` closes the backend under the archivist's pinned reference) *still holds and is the reason the split is right*: the persistent reader holds no flock, so pinning it forever is harmless; only the transient writer is opened/closed per transaction. Change surface: cli `@claude-flow/memory/src/rvf-backend.ts` (add a read-only handle — the largest piece), `memory-router.ts` (separate read substrate from transient write path; reuse the dormant `withRouter` per-op release), agentdb `memory-rvf-adapter.ts` + `archivist/index.ts` (two substrates, not one idempotent `rvfSubstrate`). **`forks/ruvector` needs no change.**

**Q2 — within the >10% bar at realistic sizes, size-conditional beyond.** Two premise corrections: (a) `boot()` is **not** a cheap RootHeader jump — it reloads every vector into an in-memory HashMap, O(total vectors) (`store.rs:2311-2323`); (b) there is **no HNSW** on the live RVF path — `memory_search` is a brute-force linear scan (`store.rs:683`), so there is nothing to "delta-reconcile." The added per-op write cost is therefore `flock` (sub-ms uncontended) + a boot reload, set against the ~95 ms `F_FULLFSYNC` floor that *both* models already pay per write (`store.rs:2432`, `root_header.rs:274`). At current corpus sizes (kB-scale `.rvf`) the added cost is ≪ 10 %. The cost scales O(vectors) via boot, so the verdict is **size-conditional** — large corpora would need incremental re-attach (read only delta segments) rather than full reload. `memory_search` is unaffected (lock-free `open_readonly`).

**Q3 — Option 2 reverses ADR-0207; daemon ≠ MCP server.** The daemon socket the broker option assumed was deleted by ADR-0207 (`worker-daemon.ts:25-27`); control is now PID-file + `daemon-state.json` + a fire-and-forget file queue (12 fixed worker triggers, no result return). The daemon already releases the flock per tick (`setRouterPersistent(false)`) — the precedent for Option 1, not Option 2. The lifetime lock-holder is the **MCP server** (`bin/cli.js` MCP-mode), a *different* process from the daemon. The standalone-down detector (PID + `kill(0)`) is reusable, but the write-routing channel is net-new and re-introduces the IPC ADR-0207 removed.

### Key design points & caveats

* **Read-after-write freshness (the real new design question).** The persistent read handle is a point-in-time snapshot — `boot()` loads `self.vectors` once and `query()` reads that copy, so it will not see the transient writer's commits until reopened. Resolution: reopen/refresh the read handle when the store epoch advances (`RvfStore` carries `epoch: u32`) — eagerly after a local write, lazily on read when epoch changed. This bounds staleness to the chosen consistency window (the same window ADR-0267's Option C anticipated).
* **Boot reload is O(vectors).** Acceptable now; flagged as the scaling limit. If memory corpora grow large, add incremental re-attach (delta-segment read on re-acquire) before the per-op reload breaches the >10 % bar.
* **No HNSW today.** The live RVF memory path is a linear scan; this resolution neither adds nor needs an ANN index. (Orthogonal: whether RVF memory *should* grow ANN is a separate concern.)

### Consequences

* Good, because concurrent CLI memory writes (and the ADR-0273 index) work alongside a running MCP server with no stop-server precondition — resolving ADR-0267 generally, not just for indexing.
* Good, because it composes with the flock + witness chain and reuses the existing `withRouter`/`setRouterPersistent` per-op machinery — no new on-disk format, no IPC, no ADR-0207 reversal.
* Good, because `memory_search` stays lock-free and hot (persistent `open_readonly`), unaffected by the write-handle change.
* Bad, because it touches three forks (cli memory backend, memory-router, agentdb adapter/archivist) — real work, not a flag flip.
* Bad, because it introduces a read-after-write staleness window that must be managed (epoch-triggered reopen).
* Neutral, because the per-op boot reload is O(vectors): fine at current scale, a future incremental-re-attach task at large scale.

### Confirmation

* A `scripts/smoke-adr0274-*.mjs` acceptance check starts the MCP server, issues a `tools/call` (so the server is past its lazy warmup), then runs `cli memory store` AND the ADR-0273 index from a separate process and asserts: no `LockHeld`, no 30 s hang, both succeed; `memory_search` returns; and a read issued after a write reflects it within the chosen consistency window.
* Wired into the canonical acceptance harness (`run_check_bg` + `collect_parallel`); green in a release. The smoke must FAIL on pre-fix state (reproduce the lifetime-hold block) and PASS after.

## More Information

- Resolves the re-opened ADR-0267 (this ADR is the chosen fix mechanism; ADR-0267 stays the regression tracker and flips to resolved when this lands + the smoke is green).
- Unblocks ADR-0273 (scriptable `agentdb index`) — its "stop/idle the server" non-option is removed once writes are per-transaction.
- Composes with ADR-0167 (RootHeader, cheap manifest locate), ADR-0202 (per-op release design + `LockHeld` exit-code), ADR-0095 (the flock itself). Honours ADR-0207 (no daemon IPC broker) and ADR-0177 (stay RVF-first).
- The deferred daemon-socket coordination (never-created "ADR-0169") stays declined — ADR-0207 removed the socket and Option 2 here re-confirms that.
- Investigation conducted by a 3-agent read-only swarm (2026-05-30); all findings file:line-verified. Implementation is separate follow-up work across the three forks.
