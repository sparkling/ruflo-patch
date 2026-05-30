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

## Amendments

### Amendment: design decisions resolved (2026-05-30, analysis swarm + include-out-of-scope rule)

A 3-agent file:line analysis resolved the open implementation decisions. The project rule applied throughout: a thing is "out of scope" only with a *real* reason — neither "nobody uses it now" nor "it would take too long" qualifies; default is to include.

**D1 — Change surface (refines the "two substrates" framing).** Full encapsulation in the cli backend is **not** sufficient: `withRouter` nulls the whole `_storage` object (`memory-router.ts:1076-1099`) and the archivist pins *that same object* by reference (`archivist-init.ts:1500-1523`). So the split touches **two files**: cli `@claude-flow/memory/src/rvf-backend.ts` (add a persistent `nativeReadDb` via `open_readonly`; `search`/`query` read it; writes use a transient writer) **and** `memory-router.ts` (keep `_storage` persistent/read-bearing — it holds no flock, safe to pin — and release only the *transient writer* per transaction, not the whole backend). The agentdb adapter + archivist need **no change**: one pinned lock-free substrate suffices because its search path never depends on the writer fd. (Supersedes this ADR's earlier "two archivist substrates" wording.)

**D2 — Writer transaction granularity: per logical transaction, batch-aware.** One open `RvfStore`/`RvfDatabase` supports N sequential `ingest_batch` calls then one `close` (`store.rs:410` `&mut self`; `lib.rs:521`). An MCP `memory_store` = one transaction; the ADR-0273 index = one transaction across all records (one flock hold, not N). Requires a public batch-write method on the cli backend (`nativeDb` is private, no getter today).

**D3 — Read-after-write freshness: same-process AND cross-process (cross-process pulled INTO scope).** A read handle's `status().current_epoch` is its *boot-time snapshot* epoch (`store.rs:1007/2293`) — it cannot self-detect new writes. Same-process: the writer hands its post-write `epoch` (already in every ingest return, `lib.rs:574`) to the reader, which reopens — **zero Rust change**. Cross-process freshness was previously parked as "optional, same-process is the dominant case" — that is the disallowed "nobody uses it" reason, and the peek it needs is an **O(1) fixed-offset RootHeader read** (`root_header.rs:196/306`), not the O(vectors) `boot()`. Because it is cheap *and* a real correctness property (a CLI/index write must become visible to the server's reads), it is **in scope**: add an additive napi `peekTxnid(path)`; the read handle peeks before each query and reopens only if the on-disk txnid advanced. (This is the first of two ruvector changes that flip the earlier "ruvector: no change.")

**D4 — Reopen trigger: lazy-on-read.** Single choke point at the top of `search()`/`query()` semantic arm (`rvf-backend.ts:700/660`). Eager-after-write is rejected — it would pay the O(vectors) reload on *every* write even when no read follows; there is no correctness reason for it.

**D5 — Writer handle lifecycle: persistent handle + cycle the flock per transaction (NOT reopen-per-transaction).** The O(vectors) `boot()` reload (`store.rs:2311-2323`) is paid per *reopen*, not per *write*. Reopen-per-transaction (the no-Rust MVP) re-pays that reload every transaction — accepting it permanently rests on "the corpus is small now," a disallowed reason. So the target is: the writer **keeps its handle open** and releases/re-acquires only the **flock** per transaction, with an O(1) txnid re-validation on re-acquire (re-sync only if another writer advanced the file). This avoids the per-write reload in the common (uncontended) case and dominates reopen-per-transaction. Requires the **second ruvector change**: expose flock acquire/release independently of `open`/`close` (today the lock lifecycle is bound to open/close, `store.rs:164/1253`). **Real-reason caveat (the one allowed):** flock-cycling on a live writer must preserve witness-chain integrity (re-read the chain tip on re-acquire) — stress-test via ADR-0167's cross-process harness before shipping. Reopen-per-transaction remains the documented fallback *only if* that integrity risk proves unmanageable (a real reason, not effort).

**D6 — Consistency guarantee (recorded verbatim):** *"RVF provides same-process read-your-own-writes (strong, via the writer handing its post-write epoch to the reader which then reopens) and cross-process near-strong consistency bounded by each read's O(1) txnid peek; reads are lock-free and never observe a torn or half-committed write, because the atomic double-buffered RootHeader (ADR-0167) flips to a new manifest only after that manifest's segment bytes are durably synced (`store.rs:2432-2453`)."*

### Revised scope (re-justified against the include-out-of-scope rule)

- **In scope — two additive ruvector changes** (revises the original "ruvector: no change"): (1) `peekTxnid(path)` O(1) RootHeader accessor for cross-process read freshness (D3); (2) flock acquire/release decoupled from open/close + O(1) re-validation, so the writer avoids the per-write O(vectors) reload (D5). Both justified by correctness/scaling, not effort.
- **Out of scope — daemon broker / IPC write-routing.** Real reason: ADR-0207 (accepted) removed the socket on upstream-alignment grounds; reinstating it reverses a standing decision. (Not an effort/usage call.)
- **Out of scope of *this* ADR but a flagged real gap — RVF has no ANN; `memory_search` is a brute-force O(N) linear scan (`store.rs:683`).** Real reason for separating: it is a different subsystem (the search algorithm, not write coordination) and does not affect this fix's correctness. It is **not** dropped for usage/effort — it is surfaced as a genuine scalability gap, and is now **addressed by ADR-0275** (adopt upstream's ADR-033 progressive-indexing vision, including RVF-native HNSW Layer B, now). A 2026-05-30 upstream review found this is a *shared* upstream+fork current state (`layer_b: false` in both), not a fork regression.
- **Separate, sequenced — the ADR-0273 `agentdb index` command.** Its own decision/ADR; lands after ADR-0274.

### Amendment: implemented + deployed (2026-05-30)

Implemented and released (`@sparkleideas/*` patch.376+); the `adr0274-rvf-rw-split` acceptance smoke is green (concurrent CLI `memory store` past MCP warmup: no `LockHeld`, no 30 s hang). Implementation notes + deviations from the design above:

- **Chose the single-handle park/unpark model (D5), NOT the literal two-object read/write split (D1).** Every native RVF write funnels through the cli backend's `acquireLock`/`releaseLock` critical section; queries do not. So `releaseLock`→`parkNativeWriter` (native `RvfDatabase.releaseLock()`) and `acquireLock`→`unparkNativeWriter` (`reacquireLock()`). Queries serve lock-free from the parked handle's in-memory vectors; same-process read-your-own-writes is automatic. This is simpler than two handles and gave RYOW for free. ruvector primitives committed `8fb99c02b` (`peek_txnid`/napi `peekTxnid`, `park_writer`/`unpark_writer`/napi `releaseLock`/`reacquireLock`, `last_committed_txnid`).
- **The witness chain is session-local** — `boot()` never restores `last_witness_hash` (re-anchors at genesis on each open), so there is **no single global chain to fork** (this ADR's Context overstated the hazard). The only real integrity risk under flock-cycling is a parked writer clobbering a peer's manifest with a stale segment directory, closed by `unpark_writer`'s O(1) txnid re-validation.
- **`unpark` does a lightweight manifest-only `resync_for_write`, NOT a full `boot()`** — a full reload per reacquire is O(vectors) and, under N=6 cross-process interleaving (peers constantly advance the txnid), became O(N²) → lock-timeout cascade. `resync_for_write` re-reads only `segment_dir`/`epoch`/`seg_writer` (no payload reads, no vector wipe). Two cargo D5 tests cover the no-clobber property.
- **Park is debounced on a 50 ms idle timer** (`_NATIVE_PARK_IDLE_MS`) — per-op park/unpark added ~95 ms/write of syscall+resync churn that serialised a 100-write burst to 63 s. The timer holds the flock across a burst (each write cancels the pending park) and only true idle releases; it also fires while a write is blocked on the advisory lock, so it can't wedge a cross-process wait. This passed the `adr0154-cross-process-concurrent` N=6 stress that per-op cycling failed.
- **Cross-process *content* freshness is bounded by the in-memory `entries` Map** (search maps native-ANN candidate ids back through it) — a pre-existing architecture limit the read-handle reopen alone can't fix. Recorded as the consistency window (D6), not solved here.

Resolves the re-opened ADR-0267. WS3 (the 281-ADR corpus index) was built via `agentdb index` alongside a live MCP server with **no `LockHeld`**, demonstrating the fix in production.

## Swarm Execution Plan

> **Critical path.** Coordination model: `swarm_init` (persistent topology state) + `Agent`-tool fan-out (`run_in_background: true`), synthesis by the orchestrator. **No hive-mind / consensus** (2026-05-30 directive). Two forks, two languages; the witness-chain stress gate (P3) is the highest-risk item in the whole program.

**Configuration** — `swarm_init { topology: 'hierarchical-mesh', maxAgents: 5, strategy: 'specialized' }` (via the `/ruflo-swarm:swarm` skill).

| Param | Value |
|---|---|
| topology | `hierarchical-mesh` |
| strategy | `specialized` |
| maxAgents | `5` |
| isolation | cross-fork is naturally isolated (`forks/ruvector` ≠ `forks/ruflo`); within `forks/ruvector` the Rust coder and the stress engineer are **sequenced** (impl → cargo stress test) or worktree-isolated |

**Why `hierarchical-mesh`.** A real critical path exists (the ruvector napi contract must exist before the cli backend can consume it), but the Rust coder, the TS coder, and the stress engineer must **mesh on the shared contract** — the `txnid`/`epoch` semantics (D3/D6), the flock acquire/release lifecycle (D5), and the witness-chain re-validation on re-acquire. Hierarchy sequences the waves; mesh keeps the contract coherent across the three implementers.

**Agent roster**

| Agent | Type | Fork/area | Task | Wave |
|---|---|---|---|---|
| rust-napi | `coder` (Rust) | `forks/ruvector` | Two additive napi changes: (1) `peekTxnid(path)` — O(1) RootHeader read (`root_header.rs`); (2) flock acquire/release decoupled from `open`/`close` + O(1) txnid re-validation on re-acquire (`store.rs`, `locking.rs`), preserving witness-chain integrity. **No multi-writer.** | 1 |
| cli-ts | `backend-dev` (TS) | `forks/ruflo` | `@claude-flow/memory/src/rvf-backend.ts`: persistent `nativeReadDb` via `open_readonly`; `search`/`query` read it; transient writer (`open→ingest_batch→close`); `shutdownWriter()` closes only the writer fd; public batch-write method (D2); lazy reopen-on-read via `peekTxnid` (D3/D4). `memory-router.ts`: keep `_storage` persistent/read-bearing; per-op release closes only the transient writer (D1). | 1→2 |
| stress-eng | `tester` | `forks/ruvector` | Witness-chain integrity stress test via the ADR-0167 cross-process harness — concurrent writer flock-cycling must not fork or tear the Merkle chain (**the P3 gate**); documents the reopen-per-transaction fallback if integrity proves unmanageable (D5). | 3 |
| smoke-eng | `tester` | `ruflo-patch/scripts` | `smoke-adr0274-rvf-rw-split.mjs` (TDD; must FAIL pre-fix): start MCP, `tools/call` past warmup, then from a separate process `cli memory store` + the index path — assert no `LockHeld`, no 30 s hang, both succeed, `memory_search` works, read-after-write within the consistency window; harness-wire it. | 1 (author) → 4 (pass) |
| reviewer | `code-analyzer` | read-only | Witness-chain correctness: flock-cycling on a live writer re-reads the chain tip on re-acquire (D5 caveat); the read handle never observes torn writes (D6); confirm the agentdb adapter/archivist truly need **no change** (D1). | 2→3 |

**Waves (intra-swarm sequencing)**
1. rust-napi builds the two napi primitives ‖ cli-ts scaffolds the dual-handle parts that don't yet need the new napi ‖ smoke-eng authors the failing smoke.
2. cli-ts wires `peekTxnid` + the per-transaction flock cycle (consumes Wave-1 napi) ‖ reviewer audits the contract.
3. **Stress gate** — stress-eng runs the witness-chain integrity harness; reviewer signs off. Fallback (reopen-per-transaction) only if integrity is unmanageable.
4. smoke-eng: smoke flips FAIL→PASS; harness-wire; release (forks committed before `npm run release`).

**Gate**: the existing `### Confirmation` smoke (FAIL pre-fix → PASS post-fix) **and** the Wave-3 witness-chain stress test.

## More Information

- Resolves the re-opened ADR-0267 (this ADR is the chosen fix mechanism; ADR-0267 stays the regression tracker and flips to resolved when this lands + the smoke is green).
- Unblocks ADR-0273 (scriptable `agentdb index`) — its "stop/idle the server" non-option is removed once writes are per-transaction.
- Composes with ADR-0167 (RootHeader, cheap manifest locate), ADR-0202 (per-op release design + `LockHeld` exit-code), ADR-0095 (the flock itself). Honours ADR-0207 (no daemon IPC broker) and ADR-0177 (stay RVF-first).
- The deferred daemon-socket coordination (never-created "ADR-0169") stays declined — ADR-0207 removed the socket and Option 2 here re-confirms that.
- Investigation conducted by a 3-agent read-only swarm (2026-05-30); all findings file:line-verified. Implementation is separate follow-up work across the three forks.
