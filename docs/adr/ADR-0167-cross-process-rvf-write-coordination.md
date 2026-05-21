---
status: accepted
date: 2026-05-10
methodology: [comparative-analysis, council-dialectic, adversarial-review]
decision-makers: [Henrik Pettersen]
tags: [concurrency, rust, rvf, file-format, multi-writer, common-practice, redb-superblock-pattern]
related: [0095, 0154, 0163, 0164, 0165, 0168]
audience: ai-executor
---

# ADR-0167: Cross-process RVF write coordination — common-practice survey + decision

> **Status**: discussion. Records the problem, the prior council's diagnosis, the research question, and (when council completes) the decision and trade-offs. **Rust-first solution preferred** — keep the runtime authoritative; avoid building parallel coordination in JS that could be undermined by future native-side changes.

## Context and Problem Statement

After ADR-0163/0164/0165 landed and 674/674 acceptance was achieved at N=6 cross-process writers, an empirical test confirmed that **N=8 writers against a shared `.rvf` file fails under heavy load even with 30s × 37 retries**. The failing shape:

```
RvfCorruptError: native file has SFVR magic but RvfDatabase.open failed
after 37 attempt(s) over 30399ms (budget 30000ms):
  <ManifestNotFound | InvalidManifest | InvalidChecksum>
```

The fork shipped two retry-side improvements that reach production:
1. **JS retry-allowlist extension** (memory@patch.21+) — covers `ManifestNotFound` + `InvalidManifest` in addition to `LockHeld`
2. **JS retry budget** (memory@patch.24+) — `maxOpenWaitMs` lifted from 5000ms → 30000ms

Both help at N≤6. **Neither solves N=8 under macOS APFS + release-pipeline parallel load.** Empirical evidence: writer 0 fails after 37 attempts spanning 30s — the file is never quiet long enough for a peer's `boot()` to read a consistent manifest.

The contention is not a retry-tuning issue; it's structural. The first concurrency council (ADR-0167 Wave 1, 2026-05-10) reached convergent diagnoses across four independent angles — all four experts agree the retry approach cannot scale further; the architecture needs a different shape.

## Prior council positions (Wave 1, 2026-05-10)

Four experts in `/tmp/concurrency-council/`:

### Lock-free / optimistic concurrency expert

**Diagnosis**: `find_latest_manifest()` (`read_path.rs:76-149`) identifies the manifest by scanning the last 64KB of a concurrently-growing file for a magic-byte pattern. Flock serializes writers but does not block readers from observing torn tails. Under 8 steady-state writers, the file is **never quiet** regardless of retry budget.

**Top proposal (conf 0.85)**: **RootHeader at offset 0** with double-buffered `(offset, epoch, CRC)` slots. Writer fsyncs the manifest, then atomically flips an 8-byte slot pointer (single `pwrite` is POSIX-atomic for ≤PIPE_BUF). Reader jumps directly to the validated manifest — no tail scan. Eliminates the three race shapes (`ManifestNotFound`, `InvalidManifest`, `InvalidChecksum`) at the source. ~300 LoC Rust.

### Filesystem semantics expert

**Diagnosis**: The "two-fsync protocol" header comment at `write_path.rs:1-7` is misleading — there's **no fsync between segment-header and payload writes**. The `File::sync_all` at `store.rs:506-508` maps to plain `fsync(2)` on macOS, which only flushes the OS page cache to the drive's write cache — not the device. The atomic-rename pattern exists in `compact()` (`store.rs:1133`) but **isn't used on the per-write manifest path**.

**Top proposal (conf high)**: Split manifest to sidecar `.manifest` file, written via tmp+`rename(2)` for POSIX directory-entry atomicity, parent-dir `fsync`, and `fcntl(F_FULLFSYNC)` on Darwin for true device-level ordering. Eliminates tail-tearing race on the manifest entirely. Keeps `.rvf` single-file canonical (ADR-0154) for vector data; sidecar is metadata-only.

### Distributed systems expert

**Diagnosis**: Not a retry-budget shortfall — a **coordination gap**. The flock at `locking.rs:107-219` provides mutual exclusion, but the architecture has no leader, no agreement protocol, no fencing tokens, no commit ordering beyond FIFO. "Wait 30s × 37 retries" is failure-detection by timeout — the FLP impossibility's anti-pattern.

**Top proposal (conf 0.80)**: **Bully-style leader election** via `flock` on `<rvf>.leader`. The winner becomes sole writer for a generation; losers serialize their segments to `<rvf>.inbox/<pid>.seg` and wait on `<pid>.processed` markers. The leader drains the inbox in arrival order, batches into one `write_manifest` + `sync_all`, and signals followers. ~400 LoC Rust + ~100 LoC JS. Turns N-racers into 1-writer + N-1-stagers.

### Process-coordinator / IPC expert

**Diagnosis**: 8 short-lived Node processes each pay full `RvfStore` boot cost (~1–3s) holding the writer flock for their entire lifetime, exhausting both the Rust 8-attempt typed-retry (`store.rs:243-279`) and the JS 37-attempt cold-start retry.

**Critical finding**: **the daemon already exists.** `forks/ruflo/v3/@claude-flow/cli/src/services/daemon-ipc.ts:45-204` provides a working Unix-socket JSON-RPC server, currently with **zero registered methods** because ADR-0088 removed the memory client. Release 13 is exactly the workload that broke ADR-0088's premise.

**Top proposal (conf 0.85)**: Revive the JSON-RPC memory client, register `memory.*` handlers on the daemon, route writes from `rvf-backend.ts` through the socket with file-fallback. The daemon becomes sole writer; flock contention vanishes. Kernel auto-releases flock on daemon crash → fallback path works correctly. ~150 LoC.

## Decision Drivers

* **Rust-first preference** (this ADR's explicit constraint): the runtime is the authoritative durability layer. Coordination implemented in JS can be undermined by future native-side changes or bypassed by direct rvf-runtime consumers. Rust-side solutions are portable across all language bindings (napi-node, future Python, etc.).
* **`feedback-no-fallbacks`**: silent fallback paths under contention are banned. Solutions must surface real failures loud.
* **ADR-0095 d11–d14 invariants are load-bearing**: kernel `flock(LOCK_EX)`, JS advisory `.jslock`, per-PID tmp+fsync, `flock`-before-`create_new`. Solutions must preserve or strengthen these, not replace them.
* **ADR-0154 single-file architecture**: the `.rvf` is the canonical store. Sidecar files are accepted only where the architectural promise explicitly allows (e.g., `.wal`, the just-removed `.meta`). New sidecars need explicit justification.
* **Cross-platform support**: the fork ships on macOS (arm64/x64), Linux (arm64/x64, gnu + musl), Windows (x64/arm64). Solutions must work on all five napi prebuild targets.
* **Test surface**: the N=8 cross-process test was the canary; the solution must make N=8 pass deterministically, and ideally N=16+ for headroom.

## Research question (this ADR's Wave 2)

The prior council surveyed solution space from internal angles. **This ADR's Wave 2 surveys common practice in mature systems** to inform the decision. Each expert is reissued with a research mandate to find how real-world systems solve cross-process multi-writer coordination for shared file-backed stores:

| Expert | Common-practice domain |
|---|---|
| Lock-free | How LMDB, BoltDB, RocksDB, BadgerDB, SQLite handle multi-writer scenarios (atomic root pointers, COW, MVCC, append-only) |
| Filesystem semantics | How Git pack files, SQLite WAL, Postgres durability, lock files in cargo/npm/pip handle atomic visibility |
| Distributed systems | How ZooKeeper, etcd, Kafka partitions, single-writer event-sourcing, Raft over local files coordinate writers |
| Process coordinator | How cargo build, npm install, redis-cli, postgres postmaster, Erlang/OTP, launchd/systemd handle multi-invocation shared state |

Each expert returns:
1. **3–5 real-world examples** with citations to upstream design docs.
2. **Trade-offs** of each approach.
3. **Applicability to RVF** — what would porting this to our runtime look like in Rust.
4. **Specific recommendation** with file:line implementation pointers.

Queen then synthesizes a recommended approach; Devil's Advocate stress-tests for edge cases.

## Considered options (Wave 1 framing — to be refined post-Wave 2)

* **Option α — Rust RootHeader + double-buffered slot pointer** (Lock-free expert): atomic 8-byte pwrite of manifest offset; readers jump directly. ~300 LoC, in-place format extension.
* **Option β — `.manifest` sidecar via atomic rename + F_FULLFSYNC** (Filesystem expert): POSIX directory-entry atomicity for manifest commits; macOS F_FULLFSYNC for ordering. Introduces a new sidecar.
* **Option γ — Bully leader election via `.leader` flock + `<inbox>` queue** (Distributed-systems expert): 1 writer per generation; followers serialize work to disk and wait. ~500 LoC across Rust + JS.
* **Option δ — Daemon-mediated single-writer** (Process-coordinator expert): revive existing `daemon-ipc.ts`; route memory writes through socket. ~150 LoC JS.

Rust-first preference (this ADR's constraint) favors **α, β, or a Rust port of γ**. **δ is JS-only** and contradicts the constraint — though it has architectural merit if the runtime gap is large.

## Decision Outcome

**Pending Wave 2 + Queen synthesis.** This ADR will be amended with the final decision once the council completes.

## Out of scope (deliberate)

1. **Moving the test to acceptance phase** — sidesteps the problem instead of solving it.
2. **Tuning retry budget further** — empirically insufficient; FLP-anti-pattern.
3. **Reducing concurrency at the application layer** (e.g., serialize the test's 8 writers) — N=8 is a real production scenario per hierarchical-mesh topology (max 15 agents).
4. **Replacing the kernel flock** — load-bearing for ADR-0095; solutions must compose with it.
5. **Replacing the `.rvf` SFVR format** — too large; sidecars OK, format-version bump OK, but the canonical store stays.

## Open questions for Wave 2

1. **What is the empirical failure rate of LMDB / BoltDB / SQLite at N=8+ concurrent writers under similar contention?** If they have similar pathologies, the bar for "common practice" is different than if they're rock-solid.
2. **Is the "single-writer" pattern (LMDB, RocksDB) idiomatic in practice, or is it a workaround for the same race we're hitting?** If idiomatic, that informs δ's architectural validity.
3. **Does any common-practice solution work WITHOUT extending the on-disk format?** If yes, prefer it for backward-compat with existing `.rvf` files.
4. **What's the failure-recovery story across solutions?** A daemon crash, a leader-election split-brain, a flipped root-header pointer pointing at corrupt data — how does each option recover?
5. **Cross-platform parity**: does the solution work identically on Linux ext4, Windows NTFS, macOS APFS? Or does it require per-platform code?
6. **What's the perf delta?** A single-writer pattern serializes writes — does it hit our throughput targets?

## More information

* Test that exposed the issue: `tests/unit/adr0154-cross-process-concurrent.test.mjs`
* Failing release log: `/tmp/adr-final-release13.log` (37 attempts over 30399ms)
* Prior council artifacts: `/tmp/concurrency-council/{lock-free,filesystem,distsys,process-coordinator}-expert.md`
* Existing daemon: `forks/ruflo/v3/@claude-flow/cli/src/services/daemon-ipc.ts:45-204`
* Existing runtime: `forks/ruvector/crates/rvf/rvf-runtime/src/` (`store.rs`, `read_path.rs`, `write_path.rs`, `locking.rs`)
* Related ADRs: ADR-0095 (RVF concurrency baseline), ADR-0154 (storage unification), ADR-0163 (read-side regression closure), ADR-0164 (vectorless ingest + Phase B1), ADR-0165 (cluster fixes)

## Amendments

### Amendment 2026-05-10 — Wave 2 partial (3 of 5 reports in)

A 5-expert council on team `adr-0167-council` is researching common-practice solutions with Rust-first preference. Three of five experts have reported; convergence is strong. Recording partial findings here; will amend further when remaining 2 reports + Queen + Devil's Advocate complete.

#### Converged finding: industry consensus is single-writer + atomic root pointer

All three reporting experts independently arrive at the same conclusion:

> **No mature embedded DB scans the tail of a concurrently-growing file.** Every CP local-file store (LMDB, BoltDB, RocksDB, SQLite, redb, sled, fjall) uses single-writer-per-aggregate with an atomic root-pointer commit. The current RVF "8-peers-each-holding-writer-flock + tail-scan-on-open" architecture is unidiomatic.

#### Expert positions (Wave 2)

**Lock-free expert** (`/tmp/concurrency-council/wave2-lockfree-research.md`) — conf 0.92

Surveyed LMDB, BoltDB, SQLite (rollback journal + WAL), RocksDB MANIFEST, BadgerDB, redb, sled, fjall. Industry-dominant pattern: **fixed-offset double-buffered root pointer**. The Rust-native exemplar is **`redb`'s "god byte" + dual-slot meta page** — that's literally the Wave 1 RootHeader proposal in production for years.

Refinement to Wave 1: drop the explicit `active_slot` byte; instead use **LMDB/redb's txnid-comparison rule** — both slots have a transaction ID; readers select the slot with the higher valid txnid. A torn slot is silently rejected by checksum without needing an active-pointer write. Eliminates one fsync from the commit path.

Composes orthogonally with filesystem-expert's sidecar proposal and any process-coordinator daemon. **"Pattern A (atomic root pointer) is necessary regardless of which writer-coordination strategy wins."**

**Filesystem expert** (`/tmp/concurrency-council/wave2-filesystem-research.md`) — conf high

Surveyed Git pack files, SQLite WAL, Postgres durability, Cargo/npm/pip lockfiles, Lucene segments, atomic-rename idiom, `F_FULLFSYNC`. Recommendation:

- **Lucene-style versioned manifest sidecar** at `<rvf>.manifest.<epoch>`, written via `tmp+rename(2)` for POSIX directory-entry atomicity.
- **`F_FULLFSYNC` on Darwin** for true device-level ordering (vs plain `fsync(2)` which only flushes page-cache → drive write-cache).
- **Parent-dir `fsync`** for durability of the rename itself.

Cross-platform parity: `tmp+rename` is identical on ext4 / APFS / NTFS-via-`MoveFileEx(MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH)`. `F_FULLFSYNC` is Darwin-only, conditionally compiled (fallback `fdatasync` on Linux, `FlushFileBuffers` on Windows).

Rust crates: `rustix::fs` for `fsync` + `rename`; direct `libc::fcntl(fd, F_FULLFSYNC)` via `unsafe` on Darwin (no safe wrapper in rustix 0.38; nix has one but is a heavier dep — recommend 6-line internal helper).

Open Q#3 answered: **achievable with no on-disk SFVR format change** (sidecar is purely additive). Existing `.rvf` files keep tail-scan as fallback for one release cycle.

**Distributed-systems expert** (`/tmp/concurrency-council/wave2-distsys-research.md`) — Wave 1 self-downgrade 0.80 → 0.55

Surveyed ZooKeeper/etcd, Kafka partitions, Raft/Paxos, single-writer event-sourcing (Akka/Eventuate/Axon), Couchbase/FoundationDB, fencing tokens, lease-based exclusion, BookKeeper/Pulsar.

**Self-downgraded the Wave-1 Bully-election proposal**: *"My Bully-election proposal was solving the wrong layer — it elects WHO writes, but the release-13 race is about WHAT readers observe DURING a write. Pattern 2 (atomic root pointer) fixes the latter without electing anything."*

Endorses lock-free expert's RootHeader (Pattern 2) + fencing token (Pattern 1) as primary recommendation (joint conf 0.85).

Key cross-cutting finding: messaged `process-coordinator-expert` that **the daemon approach (Wave 1) is complementary, not competing** — a daemon = "permanent leader" optimization on top of any correct write path. The strongest combined recommendation is **lockfree's RootHeader + process-coordinator's daemon** layered (correctness first, perf second).

Open Q#2 answered: **single-writer IS idiomatic.** Every CP store does it. Open Q#4 answered: RootHeader has cleanest recovery (zero action, zero new state); Bully + Daemon both introduce coordination state requiring its own recovery.

#### Emerging consensus (subject to remaining 2 reports + Queen)

**Primary fix**: Lock-free expert's Pattern α-refined (LMDB-style atomic root pointer in `.rvf` header with txnid comparison). Eliminates the three race shapes at the source. ~250 LoC Rust delta. **No format change** can probably be achieved by reserving header-space currently unused.

**Complementary fix** (filesystem expert): sidecar manifest with `F_FULLFSYNC` on Darwin. Useful as a defense-in-depth or as a faster path while the on-disk format change is being designed.

**Daemon as optimization layer** (process-coordinator, pending): if a Rust writer-coordinator daemon is built, it sits ON TOP of the corrected write path — it eliminates the per-process boot cost but doesn't substitute for the atomic root pointer.

#### Pending (Wave 2 remaining + Wave 3)

- **`process-coordinator-expert`** — running. Will report on daemon vs daemon-less + Rust daemon viability.
- **`rust-concurrency-expert`** — running. Will produce ranked Rust crate survey (`redb`, `fjall`, `fs2`, `fd-lock`, `arc-swap`, `rustix`, etc.) + concrete Cargo.toml diff sketch + concrete `rvf-runtime/src/` patch outline.
- **`queen`** — to be spawned after Wave 2 completes. Synthesizes recommended option(s) and trade-offs.
- **`devils-advocate`** — to be spawned after Queen. Stress-tests for edge cases: torn-slot reads, dirty-shutdown recovery, mid-rename crashes, txnid wraparound, cross-platform parity (Windows NTFS quirks), backwards-compatibility with existing `.rvf` files.

Final decision will be amended into this ADR once Wave 3 completes.

### Amendment 2026-05-10b — Wave 2 complete (5 of 5 reports + cross-expert convergence)

All 5 experts reported. Rich peer SendMessage exchanges produced cross-expert refinements visible in the team idle-notification summaries. The synthesis bridges via `rust-concurrency-expert`.

#### Process-coordinator expert (Wave 2)

Report: `/tmp/concurrency-council/wave2-process-coordinator-research.md`. Surveyed Postgres postmaster, Redis, systemd/launchd socket activation, rust-analyzer LSP, cargo build, sccache, rsync server-mode, Rust RPC crates (`tonic`, `tarpc`).

**Refined Wave-1 proposal to "δ-Rust"**: a Rust `rvf-writerd` binary, **on-demand spawned from the napi binding using the sccache pattern**. Reuses existing `daemon-ipc.ts` JSON-RPC wire format. Cold-start ~100ms first invocation / <2ms thereafter (sccache UX precedent). N=8 perf: 30s timeout → ~50ms (600× faster).

Crate stack: `tokio`, `interprocess` (xplat unix-socket / Windows named-pipe), `fs4`, `tracing` — same stack sccache / rust-analyzer / bazel use today. ~400 LoC Rust + ~50 napi glue + ~30 JS fallback.

**Critical refinement during peer chat**: messaged `distsys-expert`, both agreed γ (Bully) is subsumed by δ-Rust. Then process-coordinator-expert followed up: **"link as library, not subprocess"** — the writer-coordination logic should live in the Rust runtime as a library called directly via napi, NOT a separate daemon process. Eliminates fork/exec cold-start, IPC overhead, socket failure modes entirely. The Rust runtime owns the writer-coordination state machine.

#### Rust-concurrency expert (Wave 2 synthesis bridge)

Report: `/tmp/concurrency-council/wave2-rust-concurrency-research.md`. Surveyed Rust crate landscape per the user's directive for explicit library recommendations.

**Final recommendation**: ship lock-free-expert's **α (Rust RootHeader, ~600 LoC) as Phase 1** — it's a near-direct port of **redb's superblock pattern** (production-tested, MPL-2.0, same shape as LMDB meta pages, SQLite WAL header, btrfs superblock). Pair with process-coordinator's **δ (~150 LoC) as Phase 2** for operational efficiency. **Reject distsys-expert's Bully election** (re-implements a daemon worse). **Pull filesystem-expert's F_FULLFSYNC unconditionally** — load-bearing for Darwin correctness regardless of which high-level design wins.

**Cargo.toml additions for `forks/ruvector/crates/rvf/rvf-runtime/`**:

```toml
zerocopy = "0.7"      # zero-copy header serialization
crc32fast = "1.4"     # checksum
nix = { version = "0.29", features = ["fs"] }  # pwrite + fsync + F_FULLFSYNC
fs2 = "0.4"           # kept; cross-platform flock with future Windows parity
```

All mature, production-grade. **No tokio/interprocess yet** — daemon deferred to Phase 2.

**Performance model at N=8**:
- Current state: 91s flaky (release 13 evidence)
- α alone: **~4.8s deterministic**
- α + δ: **~100-200ms**
- N=16 headroom: α alone ~9.6s, α+δ sub-second

**Cross-platform parity**:
- macOS/Linux clean via `nix` + `zerocopy` + `crc32fast`
- **Windows wrinkle**: `WriteFile` at offset is not atomic like POSIX `pwrite`. Two mitigations:
  - `LockFile` on the slot byte during flip
  - Or fall back to filesystem-expert's β sidecar on Windows only (conditional compile)

#### Wave 2 final consensus

| Phase | Layer | Pattern | Cost | Origin |
|---|---|---|---|---|
| **Phase 1 (correctness — mandatory)** | Read-side | **α: Rust RootHeader + txnid-comparison** (direct port of redb superblock) | ~600 LoC Rust, MPL-2.0-compatible | lockfree-expert ✓ rust-concurrency-expert |
| **Phase 1 (correctness — mandatory)** | Write-side durability | **F_FULLFSYNC on Darwin unconditionally** | 6-line helper | filesystem-expert ✓ all |
| **Phase 1 (Windows parity)** | Write-side | **β sidecar fallback on Windows only** (conditional compile) | minimal | filesystem-expert + rust-concurrency-expert |
| **Phase 2 (operational — optional)** | Coordination | **δ-Rust: in-process Rust library** (NOT subprocess daemon) callable from napi | ~150 LoC Rust + glue | process-coordinator-expert ✓ all |
| **REJECTED** | — | γ Bully election | — | distsys-expert self-downgraded; "Concede on γ retirement; batching inside daemon is the right home" |

**Convergence verdict** (all 5 experts agree): the fix is α + F_FULLFSYNC as the correctness baseline; δ-Rust (as a library, not daemon) is the performance optimization layer ON TOP. β provides Windows-platform compatibility. γ is rejected.

#### Cross-expert peer exchanges (visible in team transcript)

- `lockfree-expert` → `filesystem-expert`: Lucene `segments_N` parallels RootHeader; "agreed, with one nuance" — both folded into filesystem-expert's §7a.
- `distsys-expert` → `process-coordinator-expert`: "Read your δ-Rust — converge on α+β+δ-Rust bundle, not γ vs δ" — both agreed, distsys conceded γ retirement.
- `process-coordinator-expert` → `rust-concurrency-expert`: "Need your input on daemon in-process serialization" — rust-concurrency answered with mutex/RwLock + panic safety.
- `rust-concurrency-expert` → all four: composition messages with concrete refinement questions.
- `lockfree-expert` → `rust-concurrency-expert`: "Strong agreement on 3/4; pushback on Windows fallback" — addressed via the Windows-only β-sidecar conditional.

The team's inter-expert dialogue refined positions in real time. No expert's final position is identical to their Wave 1 position — every angle improved.

#### Pending: Wave 3 (Queen + Devil's Advocate)

Spawning next:
- **Queen** — synthesizes the canonical Phase-1 + Phase-2 plan; produces concrete implementation order, file:line targets, acceptance criteria, perf benchmarks.
- **Devil's Advocate** — stress-tests: torn-slot reads under power-loss, dirty-shutdown recovery from each persistent state, mid-rename crashes, txnid wraparound, Windows NTFS `WriteFile` non-atomicity edge cases, backwards-compatibility with existing `.rvf` files (no format change is a hard requirement per Open Q#3).

Final decision will land here after Wave 3 completes.

### Amendment 2026-05-10c — Wave 3 (Queen + Devil's Advocate) complete; canonical plan + 9 corrections

Queen produced the canonical implementation plan; Devil's Advocate stress-tested and surfaced 2 blocking defects + 7 refinements. The architecture is **accepted** with corrections applied.

#### Queen's canonical pick

- **Phase 1 (correctness — mandatory)**: α-refined RootHeader (port redb's `tree_store/page_store/header.rs` superblock with LMDB/bbolt txnid-comparison rule) + unconditional `F_FULLFSYNC` on Darwin + Windows-only β sidecar fallback.
- **Phase 2 (operational — optional, deferred to ADR-0168)**: δ-Rust as in-process napi library (~150 LoC; pure perf optimization, 4.8s deterministic → ~150ms at N=8).
- **Rejected**: γ Bully election (subsumed; distsys-expert self-downgraded).

Queen produced 6 implementation steps with file:line targets and ~1280 LoC total, sample Rust for `select_active` txnid-compare, and 8 open issues for DA. Full text at `/tmp/concurrency-council/queen-final.md`.

#### Devil's Advocate verdict — PARTIAL CONCURRENCE

Architecture sound (redb superblock pattern, 4+ years production exposure across embedded DB ecosystem; 5-expert convergence is genuine, not party-line). Ship it. **But** Queen's plan has corrections to fold before Phase 1 starts.

##### Blocking (must fix before Phase 1 ships)

**AM-1 — Compact violates RootHeader stability invariant**: `compact()` at `forks/ruvector/crates/rvf/rvf-runtime/src/store.rs:1133` does `fs::rename(temp_path, &self.path)` — replaces the entire inode. Queen's O7 answer relied on "old manifest bytes are immutable, no overwrite" which is TRUE for the per-write path at `store.rs:2257` but FALSE for compact. A reader with a cached pre-compact RootSlot can silently read post-compact garbage at the same offset.

**Fix**: add `RootSlot.file_identity: [u8; 16]` field validated in `RootHeader::read`; compact writes a fresh file_identity on the new inode; readers comparing identities catch the substitution loud rather than silent. DA confidence 0.95.

**AM-8 — Test coverage gap**: add a cargo acceptance test that interleaves `compact()` with N writers, asserting loud failure (not silent corruption) on stale-reader-vs-compact race. Closes O7 empirically, not just by argument.

##### Refinements (fold same patch)

**AM-2 (DA-B) — Drop newly-introduced `fs2` dep**: Queen's plan introduces `fs2 = "0.4"` in Cargo.toml. Per rust-concurrency-expert §1.1 the package is 8 years stagnant; the live answer is `fd-lock 4.0.4` (used by rustup/cargo/wasmtime). Verified: current `forks/ruvector/crates/rvf/rvf-runtime/Cargo.toml` has zero fs2 today. **Pick**: drop fs2; either keep current `libc::flock` for Phase 1 or adopt `fd-lock 4.0.4` from start.

**AM-3 (DA-Magic) — Magic-byte inconsistency in Queen's plan**: `queen-final.md:91` says `0x5246_5230` ("RFR0", 4 bytes); `queen-final.md:134` says `*b"RVFROOT\0"` (8 bytes). Two different magics in the same plan. Reconcile to **one** value; recommend `*b"RVFROOT\0"` for self-describing 8-byte clarity (matches SFVR's pattern).

**AM-4 (DA-A) — F_BARRIERFSYNC perf optimization dropped on the floor**: filesystem-expert §7c addendum proposed `F_BARRIERFSYNC` (Darwin 12+) for the first 2 syncs in slot-flip protocol with `F_FULLFSYNC` only for the final active-slot flip. Cuts 3× F_FULLFSYNC budget from ~480ms to ~200ms at N=8 serialized writers (~58% perf win). Queen didn't incorporate. **Fold**: conditional `fcntl(F_BARRIERFSYNC)` for ordering syncs in `RootHeader::write_slot`, full `F_FULLFSYNC` only at commit point.

**AM-5 (DA-G) — Manifest CRC failure path**: on active-slot manifest CRC fail, current plan falls back to `select_fallback` at slot selection. LMDB canonical recovery does fallback at manifest-read failure (one level deeper). **Refine**: if active slot's manifest CRC fails, attempt fallback slot's manifest before throwing `RvfCorruptError`.

**AM-6 (DA-Windows) — Clarify Windows β sidecar contents**: Queen's Step 3 ambiguous about whether the Windows sidecar holds slot bytes (just the `[active_txnid, offset]` tuple) or the full manifest payload. Recommend: sidecar holds slot bytes only (smaller, atomically renameable); manifest remains in-file.

**AM-7 (DA-O8) — Cross-platform test substrate**: Queen's plan adds tests but only mentions macOS dev box. **Add**: cargo integration test runs CI matrix on Linux ext4 + macOS APFS + Windows NTFS; the test for AM-8 (compact-vs-writers) MUST run on all three.

**AM-9 (DA-O6/F) — Legacy `.rvf` upgrade strategy**: Queen picked "tail-scan forever for legacy files". DA-F observed: the fork is Verdaccio-only / trunk-based; existing `.rvf` files have a lifespan in days, not years. **Refine**: opportunistic upgrade — first write-intent open on a legacy file triggers a one-shot RootHeader bootstrap (a `compact()` equivalent). Legacy read-only opens still tail-scan. Eliminates the "race window forever" for any user running active code.

#### δ-Rust deferral to ADR-0168 — defensible per DA

DA confirmed: α alone makes the direct-write path safe (rust-concurrency-expert §10 OQ#5). δ is pure perf optimization (4.8s → 150ms). Queen's "strict superset" framing — α is the correctness foundation, δ adds throughput on top — is structurally correct. **Ship α first, file ADR-0168 for δ.**

#### Council process check — DA's last finding

Five experts engaged dialectically with real-time self-corrections:
- distsys-expert self-downgraded Bully proposal 0.80 → 0.55 mid-Wave 2
- process-coordinator-expert refined δ-subprocess → δ-as-library after peer chat with rust-concurrency-expert
- filesystem-expert demoted sidecar to Windows-fallback role after lockfree-expert citation of redb's `tree_store/page_store/header.rs`
- rust-concurrency-expert produced library-survey synthesis bridging all four other angles

No party-line; positions refined under cross-examination. Queen's synthesis is faithful to the corpus. DA's stress-test produced 2 blocking + 7 refinement findings — exactly the dialectical purpose of having an adversarial reviewer.

## Decision Outcome — FINAL

**Status moved from "discussion" to "accepted".**

Implement **Phase 1 = α-refined RootHeader + F_BARRIERFSYNC ordering syncs + F_FULLFSYNC commit + AM-1 file_identity validation + Windows-β-fallback for slot bytes + opportunistic legacy upgrade on first write-intent open**. Fold all 9 corrections (2 blocking + 7 refinements) into the same patch.

**Phase 2 = δ-Rust as in-process napi library**: deferred to ADR-0168 with `<rvf>.coord.sock` IPC. Pure perf optimization layered on the correct Phase 1 write path.

**Rejected and documented**: γ Bully election (self-retired by distsys-expert), subprocess daemon (refined to library by process-coordinator-expert), pure JS coordination (contradicts ADR-0167's Rust-first constraint).

### Implementation order (final, with AM corrections folded)

1. **Pre-work**: drop the planned `fs2 = "0.4"` Cargo.toml addition (AM-2); keep `libc::flock` for Phase 1, defer `fd-lock` decision to ADR-0168. Add `zerocopy = "0.7"`, `crc32fast = "1.4"`, `nix = "0.29" (features=["fs"])` per rust-concurrency-expert §3. Total: 3 new direct deps.
2. **RootHeader module** (new file `forks/ruvector/crates/rvf/rvf-runtime/src/root_header.rs`, ~400 LoC): `RootSlot` struct with `magic: [u8;8] = *b"RVFROOT\0"` (AM-3) + `txnid: u64` + `manifest_offset: u64` + `manifest_len: u32` + `file_identity: [u8;16]` (AM-1) + `crc32: u32`. `RootHeader::read` validates magic + identity + CRC; `select_active` uses txnid-comparison with LMDB-style fallback (AM-5). `write_slot` uses `F_BARRIERFSYNC` for ordering syncs (AM-4) and final `F_FULLFSYNC` only at commit. `pwrite` via `nix::sys::uio::pwrite` for POSIX-atomic slot writes.
3. **F_FULLFSYNC / F_BARRIERFSYNC helper** (`forks/ruvector/crates/rvf/rvf-runtime/src/fsync_helper.rs`, ~30 LoC): conditional-compile per-OS. Darwin: `libc::fcntl(fd, F_BARRIERFSYNC)` and `libc::fcntl(fd, F_FULLFSYNC)` via `unsafe`. Linux: `fdatasync(fd)`. Windows: `FlushFileBuffers(handle)`.
4. **Windows β sidecar fallback** (AM-6): `<rvf>.slot` file holds the 32-byte slot tuple, written via `tempfile::NamedTempFile::persist` (atomicwrites equivalent). Conditional-compiled for `target_os = "windows"`.
5. **`boot()` rewrite** (`store.rs` ~`:131-211`): replace `find_latest_manifest` tail-scan with `RootHeader::read → select_active → read_manifest_at_offset`. Legacy fallback: if `RootHeader::read` returns `Err(NoHeader)`, run tail-scan ONCE and trigger opportunistic upgrade (AM-9) when caller has write-intent.
6. **`compact()` rewrite** (`store.rs:1133`): on rename to new inode, generate fresh `file_identity` and write new RootHeader at offset 0 BEFORE the rename. Readers detecting identity mismatch in their cached RootSlot throw `RvfStaleHandle` loud. AM-1 closure.
7. **Test surface (AM-7, AM-8)**:
   - New cargo test: N writers + interleaved compact, assert no silent corruption.
   - Test matrix on Linux ext4 + macOS APFS + Windows NTFS (CI matrix update).
   - Existing `tests/unit/adr0154-cross-process-concurrent.test.mjs` at N=8 must pass deterministically.
   - Existing 674/674 acceptance must hold.

### Acceptance (Phase 1)

- N=8 cross-process test: deterministic PASS in < 10s wall-clock (target: 4.8s per Queen's perf model with F_FULLFSYNC; ~200ms with F_BARRIERFSYNC optimization per AM-4).
- N=16 headroom test: PASS in < 20s.
- 674/674 acceptance preserved.
- compact + N writers test (AM-8): PASS — loud failure not silent corruption.
- All 5 napi targets build clean.
- No SFVR format change for legacy files (Open Q#3 preserved).
- Existing `.rvf` files boot cleanly + opportunistically upgrade on first write-intent open (AM-9).

### Council artifacts

- `/tmp/concurrency-council/queen-final.md` — canonical plan + 8 open issues
- `/tmp/concurrency-council/devils-advocate-position.md` — 2 blocking + 7 refinements with file:line citations
- `/tmp/concurrency-council/wave2-lockfree-research.md` — α detail + redb reference
- `/tmp/concurrency-council/wave2-filesystem-research.md` — F_FULLFSYNC + sidecar + F_BARRIERFSYNC perf
- `/tmp/concurrency-council/wave2-distsys-research.md` — γ self-retirement
- `/tmp/concurrency-council/wave2-process-coordinator-research.md` — δ-as-library refinement
- `/tmp/concurrency-council/wave2-rust-concurrency-research.md` — crate survey + Cargo.toml diff

### Follow-up ADRs

- **ADR-0168 — δ-Rust napi-library coordinator**: Phase 2 perf optimization. ~150 LoC Rust + ~50 napi glue. Pure-perf layer on top of α.
- **ADR-0164 Phase B2/B3/B4 + Phase C** (existing): orthogonal; can land in parallel.

### Amendment 2026-05-10d — Round-2 dialectic close-out (Queen + DA reconcile)

After Wave 3 reports landed, Queen amended `queen-final.md` in place to fold all 5 DA round-1 holes. DA then reviewed Queen's amended plan and conceded one severity claim.

#### Queen's round-2 fold

Queen addressed all 5 DA round-1 findings:
- **DA-1 (drop `fs2`)** — folded; pre-work step now uses `libc::flock` for Phase 1.
- **DA-2 (F_BARRIERFSYNC)** — folded as two-tier `barrier_sync()` + `durable_sync()` helper. New acceptance gate AC6b telemetry checks p95 latency. ~40% perf win on Darwin (480ms → 200ms at N=8).
- **DA-3 (magic-byte reconciliation)** — folded; canonical magic is `*b"RVFROOT\0"`.
- **DA-4 (compact race)** — folded as AC9 audit gate over 12 `sync_all` call sites in `store.rs`, plus an integration test interleaving `compact()` with `open()`+`boot()` on readers.
- **DA-5 (δ deferral rationale)** — Queen quoted DA's "α makes direct-write path safe; δ is pure perf optimization" verbatim as the deferral justification.

Plan totals ~1320 LoC across 6 steps + 9 acceptance criteria. **Acceptance target tightened**: AC6 = ~2.8–3.2s deterministic at N=8 on Darwin (was 4.8s; the F_BARRIERFSYNC two-tier sync delivers the gain).

#### DA's round-2 reply — concedes AM-1 severity

After reading Queen's amended plan, DA reframed AM-1 (the compact-vs-reader race):

> *"My original 'blocking' framing was too broad. The N=8 stress is writer-FIFO (each writer's lifecycle is flock-acquire → boot → write → close → release); readers don't read from outside the flock window. The cross-inode race I described requires a concurrent reader outside the writer flock — which N=8 doesn't produce. Conceded to Queen; downgraded AM-1 from BLOCKING to refinement. AC9 audit gate stays — it's the right preservation without the overstated framing."*

This is a **structural correction**: the N=8 test scenario is writer-against-writer under flock serialization, not reader-against-compact. The reader-vs-compact race exists architecturally but isn't load-bearing for what ADR-0167 is fixing. AC9 audit gate (12 `sync_all` sites) preserves the concern as defense-in-depth.

#### Round-2 final verdict

DA's amended verdict: **CONCURRENCE WITH MINOR REFINEMENTS. Phase 1 ships as amended in `queen-final.md`. Zero blockers remain.**

Three non-blocking refinements remain open (can land same-PR or as small follow-ups):
- **AM-2** — manifest CRC fallback on active-slot read (LMDB canonical recovery, was DA-G in earlier amendment)
- **AM-6** — Windows β sidecar slot-bytes vs manifest-payload semantics clarification
- **AM-7** — cross-platform CI substrate (Linux + macOS + Windows for the new tests)

#### Council process quality note (DA's closing observation)

> *"Five experts engaged dialectically; distsys self-downgraded γ 0.80→0.55; process-coordinator self-refined δ-subprocess→δ-library; queen synthesized faithfully; DA pushed five concrete holes, queen folded all five, DA conceded on framing where evidence didn't support the blocking severity. Both directions of pushback honest. This is what the working-council pattern looks like."*

#### Corrections to this ADR's prior amendments

Amendment 2026-05-10c labeled AM-1 (compact race) as a "blocking" defect. Per round-2 outcome, that severity claim was overstated. **Corrected**: AM-1 is a refinement that lands as AC9 audit gate; not a blocker. The cross-inode race is real architecturally but doesn't fire under writer-FIFO N=8 contention.

The "2 blocking + 7 refinements" framing in Amendment 2026-05-10c is superseded by this amendment's **"0 blocking + 9 refinements"** (the original 2 blocking — AM-1 + AM-8 test — both downgraded; AM-8 is now part of AC9's audit gate).

### Final acceptance criteria (round-2)

Per the latest `queen-final.md`:

- **AC1**: N=8 cross-process test passes deterministically.
- **AC2**: existing 674/674 acceptance preserved.
- **AC3**: all 5 napi targets build clean (macOS arm64+x64, Linux arm64+x64 gnu+musl, Windows x64+arm64).
- **AC4**: no SFVR format change for legacy files (Open Q#3 preserved).
- **AC5**: existing `.rvf` files boot cleanly (tail-scan + opportunistic upgrade on first write-intent open per AM-9).
- **AC6**: N=8 wall-time **~2.8–3.2s deterministic** on Darwin (F_BARRIERFSYNC two-tier sync).
- **AC6b (NEW)**: p95 latency telemetry gate on the two-tier sync helper.
- **AC7**: N=16 wall-time < 20s.
- **AC8**: typed-retry retirement — no JS-side cold-start retry budget after Phase 1 lands; retries are pure-LockHeld at the JS layer.
- **AC9 (NEW)**: audit gate over 12 `sync_all` call sites in `store.rs` + integration test interleaving `compact()` with `open()`+`boot()` on readers. Defense-in-depth for the cross-inode race DA-4 flagged.

### Amendment 2026-05-10e — Dev-loop directive: cargo test, not release pipeline

**User directive during implementation kickoff:** for Phase 1 the diff is confined to `forks/ruvector/crates/rvf/rvf-runtime/`. Iterate via `cargo build` + `cargo test` inside the crate; write the N=8 / N=16 cross-process stress tests as **Rust integration tests** that spawn child processes via `std::process::Command` using `env!("CARGO_BIN_EXE_<helper>")` for the worker binary. Reserve `npm run release` for the final end-to-end acceptance gate only.

**Why:** the release pipeline (build → codemod → publish → acceptance) takes minutes per cycle. Using it as the inner dev loop on Rust changes wastes hours. `cargo test` is seconds-per-iteration and can express the same N-writer concurrency scenarios in-tree without the JS/napi/Verdaccio round-trip.

**How implemented:** Phase 1 ships with a `src/bin/rvf_test_writer.rs` helper bin (single-vid ingest worker, exits clean) referenced from `tests/adr0167_n8_stress.rs` via `CARGO_BIN_EXE_rvf_test_writer`. The stress test spawns N=8 (and N=16) workers concurrently against a shared `.rvf` path, then asserts the expected count under `RvfStore::open_readonly`. Test must pass deterministically in <10s wall-clock on Darwin (AC6). After the stress test goes green, ONE `npm run release` cycle verifies the JS-layer cold-start retry budget can be retired (AC8) and 674/674 acceptance preserves (AC2).

### Amendment 2026-05-10f — Phase 1 implementation outcome

**Fork commit (forks/ruvector @ sparkling/main `f4cbbf45e`)** lands the canonical plan:

| Component | LoC | Origin |
|---|---|---|
| `src/root_header.rs` | 558 | LMDB/redb-style atomic root pointer; 8 unit tests green |
| `src/fsync_helper.rs` | 142 | F_BARRIERFSYNC + F_FULLFSYNC on Darwin, fdatasync on Linux, FlushFileBuffers on Windows; 3 unit tests green |
| `src/bin/rvf_test_writer.rs` | 100 | Cross-process worker bin for the stress test |
| `tests/adr0167_n8_stress.rs` | 228 | N=8 deterministic canary + N=16 + 5x stability |
| `src/store.rs` (delta) | ~150 | boot() RootHeader fast path + AM-5 cross-slot fallback; write_manifest commit_new_root; create/derive prefix reservation; compact AM-1 fresh identity + AM-9 opportunistic legacy upgrade |
| `src/read_path.rs` (delta) | ~25 | `read_manifest_at(offset)` helper for the fast path |
| **Total** | **~1203 LoC** | Within the ~1320 LoC budget per Queen's round-2 plan |

**Acceptance — Rust layer:**

| Criterion | Target | Actual |
|---|---|---|
| AC1 — N=8 deterministic | PASS | PASS (767ms wall-time) |
| AC6 — N=8 wall-time | 2.8–3.2s on Darwin | **767ms** (~4× headroom) |
| AC7 — N=16 wall-time | <20s | **1443ms** |
| AC1 stability — N=8 × 5 rounds | no flakes | 894 / 555 / 546 / 557 / 548 ms — no flakes |
| All rvf-runtime tests | preserved | 324 / 324 pass across 20 test buckets |

**Deviations from final plan, all minimal:**

- `fs2` dep was already absent in the baseline Cargo.toml — no deletion needed. Pre-work step "drop fs2" reduced to a no-op + comment in Cargo.toml documenting why we don't add it.
- `nix` dep was rejected in favor of direct `libc::pwrite` / `libc::fcntl` on Unix and `std::os::windows::fs::FileExt::seek_write` on Windows — keeps the dep surface smaller and avoids an additional non-trivial crate compile.
- Test fix: `lock_prevents_two_writers` (pre-existing baseline failure since the ADR-0095 amendment introduced the in-process refcount short-circuit) was renamed to `lock_allows_in_process_repeat_acquire` with the assertion inverted to match documented behavior. Cross-process exclusivity is now exclusively covered by `tests/adr0167_n8_stress.rs`.

**Open follow-ups for ADR-0168 (Phase 2 — δ-Rust):**

- Retire the JS-side `initWithRetry` cold-start retry budget for the three race shapes (`ManifestNotFound`, `InvalidManifest`, `InvalidChecksum`) — they can no longer fire after Phase 1. `LockHeld` retry stays. (AC8)
- Build the in-process Rust napi-library coordinator (~150 LoC) for the perf optimization layer that brings N=8 from ~767ms down to ~100-200ms.

### Amendment 2026-05-21 — JS preflight RVFR-prefix gap (incomplete Phase-1 rollout)

**Symptom.** `bug4-storage-init-concurrent` (8 concurrent `RvfBackend.initialize()` on one `.rvf`) regressed: 7/8 inits failed with `RvfCorruptError: bad magic bytes (expected 'RVF\0', got "RVFR")` thrown from the pure-TS `loadFromDisk` corruption check (`@claude-flow/memory/src/rvf-backend.ts` ~`:2768`). `"RVFR"` is the first 4 bytes of the Phase-1 RootHeader magic `RVFROOT\0`.

**Root cause — this ADR's own Phase-1 rollout was incomplete.** Phase-1 taught **three** JS read sites to recognise native magic and NOT pure-TS-corrupt-fail it: the native-open preflight (`:1145`), `tryNativeInit`'s partial-RootHeader deferral (`:1362-1377`, which DOES treat a 4-7 byte `RVFR` peer-mid-creating file as native), and the `loadFromDisk` native preflight (`:2696-2711`). But the `loadFromDisk` preflight latched `isNativeFile` for the `RVFR` prefix **only when the full 8 bytes `RVFROOT\0` were present** (`bytesRead >= 8 && full8 === RVFROOT\0`). Under concurrent native init, a peer that exhausts the native-open retry budget falls over to `loadFromDisk` (a sanctioned degradation path, `:1320-1324` "caller will build HnswLite and loadFromDisk picks .meta"); if the preflight peeked a **partial `RVFR`** (peer mid-creating) or hit a **TOCTOU** between peek and `readFile`, `isNativeFile` stayed false → `loadPath` was set to the native file → `:2768` read `"RVFR"` and declared the valid native file corrupt.

**Decision.** Recognise the 4-byte `RVFR` prefix as native in the `loadFromDisk` preflight regardless of whether all 8 bytes are present yet — mirroring `tryNativeInit`'s partial-RootHeader deferral. This is provably safe: a pure-TS file's magic is `RVF\0` (byte[3] = `0x00`), so `"RVFR"` (byte[3] = `'R'`) can **never** be pure-TS; it is always a complete-or-mid-creation native RootHeader. Full 8-byte RootHeader validation stays the native open path's job (`RvfDatabase.open`). Fix: `rvf-backend.ts` preflight `if (peek4 === NATIVE_MAGIC || peek4 === NATIVE_ROOT_HEADER_MAGIC_PREFIX) isNativeFile = true;`.

**Evidence grounding (3-corpus research, 2026-05-21).**
- **Upstream (ruvnet) is no authority here.** `RVFROOT\0`/RootHeader is **fork-only** — ruvnet's native RVF uses u32 magics (`RVFS` `0x5256_4653`, `RVM0`), and ruvnet's TS uses `RVF\0`. Upstream's pure-TS `loadFromDisk` **silently returns** (loads zero) on any non-`RVF\0` magic — it never throws. The fork deliberately replaced that with **fail-loud** corruption detection (ADR-0090, `feedback-no-fallbacks`) and added RootHeader (this ADR).
- **Fork intent is unambiguous from its own code:** two of three read sites already recognise native magic specifically so pure-TS does NOT corrupt-fail native files. The `:2768`/preflight gap was a missed site, not a design choice. The `feedback-no-fallbacks` fail-loud path (ADR-0090) is for genuinely-unparseable **pure-TS** files only.

**Test contract (was unpinned — how the gap shipped).** The regression guard is the end-to-end concurrent-init convergence test `tests/unit/rvf-concurrent-init.test.mjs` ("N=8 parallel initialize() on a shared .rvf all succeed"): under concurrent native init, a peer fails the native open and fails over to pure-TS `loadFromDisk`, which must recognise the native RootHeader (`RVFROOT\0` / its `RVFR` prefix) and not mislabel the valid native file as corrupt — without the fix, N-1 of N inits fail with `bad magic bytes (got "RVFR")`. This is the deterministic guard in the native-present environment. (A focused pure-TS-only unit test was attempted but discarded: there is no clean way to force pure-TS mode when the native binding is installed, so feeding fake native-magic files merely trips the native-open path's own correct corruption check — it does not exercise the loadFromDisk failover. The convergence test reproduces the real scenario.) The test resolves the freshly-built backend via the shared `loadRvfBackend()` helper (the canonical this-release artifact), never a stale aggregate build (see ADR-0225).

**CI/CD coupling (see ADR-0225).** This fix surfaced a pipeline race: `test-ci` ran *in parallel with* `build`, so the ~15 unit tests that load the built `/tmp/ruflo-build` dist (incl. `bug4-storage-init-concurrent`) validated a stale/mid-build artifact — and a fix whose regression test needs the NEW build could never go green (chicken-and-egg). Resolved by sequencing `build → test-ci` (ADR-0225).
