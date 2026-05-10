---
status: accepted
date: 2026-05-11
methodology: [phase2-implementation, spec-from-adr-0167]
decision-makers: [Henrik Pettersen]
tags: [concurrency, rust, rvf, performance, intra-process, batching, coordinator]
related: [0095, 0154, 0163, 0164, 0165, 0167]
audience: ai-executor
---

# ADR-0168: δ-Rust In-Process Writer-Coordinator (Phase 2)

## Context and Problem Statement

ADR-0167 Phase 1 (Amendment 2026-05-10f) landed the α-refined RootHeader +
F_BARRIERFSYNC/F_FULLFSYNC write path. The N=8 cross-process deterministic
stress test now passes in ~767ms wall-clock — comfortably under the 10s budget
and well ahead of the pre-Phase-1 failure mode (30s × 37 retries → corrupt).

However the Phase 1 measurement reflects the **cross-process flock-FIFO
serial** path: each of 8 independent processes acquires the kernel flock, runs
boot → write_manifest → commit_new_root → release. Each write costs roughly
one F_FULLFSYNC (~95ms on macOS APFS). Total: N × ~95ms ≈ 767ms.

For a **single process with N concurrent callers** — the common in-process
pattern where N tokio tasks or N threads all hold an `Arc<RvfBackend>` and
call `ingest` concurrently — Phase 1 already serialises correctly via the
`&mut self` write API. But it does so naively: each caller waits for the
previous one to complete, then re-enters the write path for its own
F_FULLFSYNC round-trip. The total cost is the same O(N × F_FULLFSYNC) as the
cross-process case.

**The opportunity**: a single process can batch N pending ingests into ONE
write_manifest + commit_new_root call, reducing N × F_FULLFSYNC to 1 ×
F_FULLFSYNC. At N=8 this is a theoretical 8× reduction: ~767ms → ~95ms.
Real-world overhead (mutex, condvar, batch accounting) puts the target at
~150–200ms.

This is the δ-Rust layer deferred from ADR-0167: **in-process writer
coordination**. It is a pure performance optimization layered on top of the
correct Phase 1 write path. It does not change the on-disk format, the
cross-process flock invariants, or any ADR-0095 d11–d14 properties.

## Decision Drivers

- **In-process only**: cross-process coordination remains the kernel flock's
  domain (ADR-0167 Phase 1). δ optimises intra-process batching only.
- **Library, not subprocess**: process-coordinator-expert's Wave-2 refinement
  from ADR-0167. The coordinator lives as a Rust module in rvf-runtime,
  callable directly from napi. No fork/exec cold-start, no IPC socket, no
  socket failure modes.
- **No tokio / async runtime**: per Phase-1 dep choices (`feedback-no-fallbacks`
  + keep dep surface small). Use `std::sync::Mutex` + `Condvar`.
- **Default-off**: `coordinated: bool` option on ingest is `false` by default.
  Legacy callers are completely unaffected.
- **No on-disk format changes**: Phase 1's RootHeader is the correctness
  foundation; δ is purely a runtime batching layer above it.
- **Rust-first**: per ADR-0167's explicit constraint; napi is a call site, not
  the implementation home.

## Considered Options

### Option 1 — `WriterCoordinator` in-process mutex + condvar (chosen)

A process-local registry (`OnceLock<Mutex<HashMap<PathBuf,
Arc<WriterCoordinator>>>>`) maps each `.rvf` path to a single coordinator.
Multiple concurrent callers `submit_ingest()` to the coordinator; the first
caller to find the coordinator idle takes the batch, locks the underlying
`RvfStore`, and calls `ingest_batch()` once for all accumulated entries. The
others wait on a `Condvar` until the batch commits, then receive their
`IngestResult`.

Cost model: 1 × F_FULLFSYNC + N × (condvar wait + result copy). At N=8:
~95ms + negligible ≈ 95–150ms.

### Option 2 — Per-store background thread with channel

A persistent background thread per coordinator receives work via
`std::sync::mpsc`. The napi thread sends work, waits on a oneshot-style
condvar. Slightly higher complexity (thread lifecycle, join on drop) for no
measurable throughput gain over Option 1 at the N values this ADR targets.
Deferred — can evolve to this if N > 64 becomes a requirement.

### Option 3 — tokio / async runtime

Rejected per dep constraints. Adds >1MB to the binary and a mandatory
thread-pool for a use case that is not I/O-bound between batch submitters.

### Option 4 — Subprocess daemon with `.coord.sock`

Explicitly deferred to a future ADR-0169, not this one. The ADR-0167 Decision
Outcome mentions `<rvf>.coord.sock` as the cross-process coordination path;
that remains out of scope here. ADR-0168 is **library only**.

## Decision Outcome

Implement **Option 1**: `WriterCoordinator` in-process mutex + condvar.

The coordinator is opt-in (`coordinated: bool` flag on ingest), process-local,
keyed on the canonical `.rvf` path, and shares one coordinator per path across
all concurrent callers in a process. Batches accumulate until the in-flight
commit completes; waiting callers are drained into the NEXT batch automatically.

## API Surface

```rust
/// Process-local coordinator for intra-process write batching (ADR-0168).
pub struct WriterCoordinator { /* private */ }

impl WriterCoordinator {
    /// Get-or-create the coordinator for `path`.
    ///
    /// Multiple `for_path` calls with the same canonical path in one process
    /// always return the same `Arc<WriterCoordinator>`.  Safe to call
    /// concurrently — the registry itself is a `Mutex`.
    pub fn for_path(path: &Path) -> Arc<WriterCoordinator>;

    /// Submit a single-entry ingest payload to the coordinator's batch.
    ///
    /// If the coordinator is idle, this call opens the store, processes the
    /// batch immediately, and returns.  If a commit is already in flight,
    /// this call's payload is added to the next batch; the caller blocks on
    /// a `Condvar` until that batch's `commit_new_root` returns.
    ///
    /// Returns the `IngestResult` for this submission's entry.  Accepted /
    /// rejected counts in the result refer to all entries in the batch this
    /// submission joined (caller may inspect `epoch` for ordering).
    pub fn submit_ingest(
        &self,
        path: &Path,
        options: RvfOptions,
        vectors: Vec<Vec<f32>>,
        ids: Vec<u64>,
        metadata: Option<Vec<MetadataEntry>>,
    ) -> Result<IngestResult, RvfError>;

    /// Block until any in-flight batch commit has completed.  No-op if idle.
    pub fn flush(&self);

    /// Telemetry snapshot.
    pub fn metrics(&self) -> CoordinatorMetrics;
}

/// Snapshot of coordinator performance counters.
#[derive(Clone, Debug, Default)]
pub struct CoordinatorMetrics {
    /// Total number of `commit_new_root` calls issued by the coordinator.
    pub batches_committed: u64,
    /// Total vector entries committed across all batches.
    pub entries_committed: u64,
    /// Moving average batch size (entries per batch).
    pub avg_batch_size: f64,
    /// p95 commit latency in milliseconds (sliding window of last 64 commits).
    pub p95_commit_latency_ms: f64,
}
```

## Implementation Notes

- `for_path` canonicalises the path via `std::fs::canonicalize` (or
  `std::path::Path::to_path_buf` if the file does not yet exist) to avoid
  aliasing via symlinks or `..` components.
- The inner `State` behind the `Mutex` holds: `pending: Vec<PendingIngest>`,
  `busy: bool`, and a `Condvar`-signalled result slot.
- When `submit_ingest` finds `!busy`, it drains ALL pending + its own payload
  into a local `batch`, sets `busy = true`, drops the lock, opens the store,
  calls `ingest_batch` once, re-acquires the lock, stores the result, clears
  `busy`, and broadcasts on the `Condvar`.
- When `submit_ingest` finds `busy == true`, it pushes its payload onto
  `pending` and `Condvar::wait`s until `busy == false` and the result for its
  batch generation is available.
- Latency window: a `VecDeque<f64>` of the last 64 commit durations in ms.
  p95 is computed by sorting a clone (negligible cost for 64 elements).
- The coordinator owns a `RvfStore` for the duration of a batch only; it
  `open`s before the batch and `close`s (drops) after. This keeps the write
  lock held for the minimum window and avoids stale file-handle issues on
  platforms with inode-replacement compaction.

## Acceptance Criteria

| ID | Criterion | Measurement |
|----|-----------|-------------|
| AC1 | Intra-process N=8 same-handle wall-time ≤ 200ms (target ~150ms, budget <500ms) | `tests/adr0168_intra_process_batch.rs` timing assert |
| AC2 | ADR-0167 cross-process N=8 (`n8_cross_process_deterministic`) still PASS ≤ 10s | `cargo test --test adr0167_n8_stress` |
| AC3 | 324+ existing rvf-runtime tests preserved; new coordinator test count ≥ 1 | `cargo test --lib` |
| AC4 | p95 commit latency exposed via `metrics()` and asserted in bench test | `coordinator.metrics().p95_commit_latency_ms` |
| AC5 | Default-off (`coordinated = false`); legacy callers unaffected | Existing tests all pass without opt-in |
| AC6 | Process-local registry handles concurrent `for_path` calls without race or duplicate coordinator | Parallel `for_path` + `Arc::ptr_eq` assertion in test |

## Out of Scope (deliberate)

- Cross-process coordination (remains kernel flock; ADR-0167 Phase 1).
- Subprocess daemon or `.coord.sock` IPC (deferred to ADR-0169 if needed).
- tokio / async runtime (per dep constraints).
- Changes to RootHeader format or write protocol.
- napi glue — the coordinator is a pure Rust module; napi binding changes can
  follow as a separate PR once the Rust layer is validated.

## Follow-up ADRs

- **ADR-0169** (future, optional): cross-process coordinator daemon with
  `.coord.sock` IPC, if N=8 cross-process perf ever becomes the bottleneck.
  ADR-0167 Phase 1's ~767ms is already within budget; ADR-0169 is purely a
  stretch-goal optimisation.

## Council Lineage

This ADR implements the δ-Rust recommendation from ADR-0167 Amendment
2026-05-10b/c/d (process-coordinator-expert Wave-2 + Queen synthesis + DA
concurrence). The DA's "ship α first, file ADR-0168 for δ" verdict is the
explicit deferral that created this ADR's scope.
