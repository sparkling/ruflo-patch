# ADR-0130: RVF WAL fsync durability — true power-loss durability for the RVF write-ahead log

- **Status**: Implemented (2026-05-03) per ADR-0118 §Status (T11 complete)
- **Date**: 2026-05-02
- **Deciders**: Henrik Pettersen
- **Depends on**: ADR-0123 (T5 RVF-backed memory backend — explicitly deferred true power-loss durability to this ADR; see ADR-0123 §Risks item 7 and §Validation `check_adr0123_sigkill_crash_durability` callout)
- **Related**: ADR-0086 Debt 7 (better-sqlite3 / sql.js placement history — durability primitive is an RVF-internal concern, not a SQL pragma question), ADR-0118 review-notes-triage row H3 (the triage row that escalated this), ADR-0095 d11 (existing tmp-file fsync-before-rename pattern in RVF persist path — model for the WAL-append fsync introduced here)
- **Scope**: Fork-side change to `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts` WAL append path. Per `feedback-no-upstream-donate-backs.md`, this stays on `sparkling/main`.

## Context

ADR-0123 (T5) chose **SIGKILL-without-power-loss** as its durability gate. The triage trail is explicit:

- ADR-0118 review-notes-triage row H3 documented the gap: *"RVF's WAL uses `appendFile` without explicit fsync (`rvf-backend.ts:488-491`)"* and recommended *"adopt (i) for T5, defer (ii) to a separate ADR (e.g. 'RVF WAL fsync durability')"*.
- ADR-0123 §Risks item 7 names this ADR as the owner: *"RVF appendFile-based WAL does not fsync (`rvf-backend.ts:488-491`) — survives process-kill on intact page cache, NOT power loss. … ADR-0130 (RVF WAL fsync durability) escalates and owns the fsync-the-WAL-append change required for true power-loss durability. Not in T5 scope."*
- ADR-0123 §Validation `check_adr0123_sigkill_crash_durability` carries the same carve-out: *"True power-loss durability (fsync drops) is OUT OF SCOPE for T5 — see ADR-0130 (RVF WAL fsync durability)."*

The remaining gap is concrete. RVF's WAL append at `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts:488-491` (the `appendToWal` call site invoked under the JS lock during `store`) uses Node's `appendFile` without an explicit `fsync` on the WAL file descriptor. Surviving SIGKILL on an intact page cache is **not** the same as surviving power loss / kernel panic / unexpected reboot. Between an `appendFile` resolution and the next `compactWal` tmp-fsync-rename (line 2513, ADR-0095 d11), the WAL append lives only in the kernel page cache — a power loss inside that window drops the just-appended entry.

The `feedback-data-loss-zero-tolerance.md` memory rule is explicit: 99%, 99.9%, 99.99% pass on a durability probe is **not** shippable. The gap from "SIGKILL durable" to "power-loss durable" is real, even if narrow under typical operator profiles. This ADR addresses that gap as the H3 follow-up.

## Decision Drivers

- **`feedback-data-loss-zero-tolerance.md`** — 100% durability or not fixed. ADR-0123 satisfies this for SIGKILL-without-power-loss; this ADR closes the residual fsync-drop window for true power-loss durability. Either the WAL append is durable through power loss or the implementation is not done — there is no "acceptable rate of loss".
- **ADR-0123 carve-out is explicit, not implicit** — ADR-0123 §Risks item 7 + §Validation both name ADR-0130 as the owner of this concern. Inheriting that escalation, not relitigating it, is the job of this ADR.
- **`feedback-no-fallbacks.md`** — fsync syscall failure must surface, not be swallowed. A `try { await fsync(fd) } catch {}` would replicate the silent-catch pattern this rule forbids.
- **Performance budget is real** — fsync after every WAL append is a real syscall against a real disk. On commodity SSDs the cost is sub-millisecond per call but non-zero; on rotational disks or fsync-throttled cloud volumes it can be 10ms+ per call. The chosen option must either accept the cost or design around it without compromising the 100% durability bar.
- **Cross-platform Linux/macOS semantics** — Linux `fsync(2)` flushes data and metadata; Darwin `fsync(2)` flushes only to the disk cache, not through it (true durability on macOS requires `fcntl(F_FULLFSYNC)`, exposed in Node only via low-level FFI). The decision must name which semantic is in scope.
- **No new dependency surface** — the fsync primitive must be reachable from Node's stdlib (`fs.promises.fsync` / `fs.fsyncSync`); no new native binding allowed (would brush ADR-0086 Debt 7).
- **Touch site is single-file** — the change is bounded to `rvf-backend.ts` WAL append path. No CLI-side or hive-mind-side change. This keeps blast radius small and the acceptance check focused.

## Considered Options

- **(a) fsync after every `appendFile` call in `appendToWal`** — synchronous fsync of the WAL fd before the JS lock is released. Strongest durability guarantee; highest per-write cost. **Preliminary recommendation; pending Henrik review.**
- **(b) Periodic batched fsync (every N WAL appends or T milliseconds)** — fsync amortised across multiple appends; bounded loss window of N writes or T ms on power loss.
- **(c) Opt-in fsync via env var (e.g. `RUFLO_RVF_WAL_FSYNC=1`)** — default off (today's behaviour), operators opt in for power-loss durability.
- **(d) Defer further until a real durability incident surfaces** — accept the SIGKILL-without-power-loss gate as sufficient until empirical evidence shows the gap matters in practice.

## Pros and Cons of the Options

### (a) fsync after every appendFile call

- Pros:
  - 100% durability under power loss for any acked `store` call — the durability bar `feedback-data-loss-zero-tolerance` codifies.
  - Mirrors ADR-0095 d11's existing tmp-file fsync-before-rename pattern; the change is shape-consistent with what RVF already does for the main `.rvf` file.
  - Single touch site; no batching state machine; no env-var branch to maintain; no operator-facing tuning surface to document.
  - Failure of `fsync` surfaces via thrown error — `feedback-no-fallbacks` is satisfied by default if the syscall is `await`ed, not wrapped in `try/catch`.
- Cons:
  - Real per-write latency cost. On commodity SSDs typically <1ms, but the cost compounds: a hot writer doing 1000 stores/sec adds 1000 fsyncs/sec. On rotational disks or cloud volumes with fsync throttling (some EBS gp2/gp3 profiles, container-level fsync throttling) the cost can be 10ms+ per call.
  - On macOS, `fsync` does not provide true durability through the disk write cache — only `fcntl(F_FULLFSYNC)` does. Node's `fs.fsync` maps to `fsync(2)`, not `F_FULLFSYNC`. So the option-(a) guarantee is "Linux: durable through power loss; macOS: durable through process-kill and OS-crash, but not necessarily through power loss with disk cache enabled". Honest framing requires documenting this rather than claiming uniform 100% across platforms.
  - The latency cost is unconditional — operators with no power-loss exposure (e.g. local development on UPS-backed workstations) pay it without benefit.

### (b) Periodic batched fsync (every N writes or T ms)

- Pros:
  - Per-write latency cost amortised. A timer-driven fsync every 100ms means at most 100ms of writes lost on power loss, with negligible per-write overhead.
  - Operator-tunable N and T expose the durability/throughput trade-off explicitly.
- Cons:
  - **Violates `feedback-data-loss-zero-tolerance`** — by construction, up to N writes or T ms of writes are lost on power loss. Reframing "100ms of loss" as acceptable is exactly the rate-of-loss reframing the rule forbids. Acked stores within the unfsynced window are advertised durable but are not.
  - State machine complexity: timer + counter + lock interaction with the existing JS lock at `appendToWal`; a fsync timer firing during `store` must coordinate with the in-flight WAL append.
  - Failure mode is subtle: an operator sees `store` resolve, infers durability, then loses N entries on power loss. The bug surface is exactly the silent-loss pattern the project memory codifies as not shippable.

### (c) Opt-in fsync via env var

- Pros:
  - Zero behaviour change by default — no perf regression for existing operators.
  - Operators with power-loss exposure can opt in.
- Cons:
  - **Default-off violates `feedback-data-loss-zero-tolerance` for the unopted population** — the rule does not have an opt-in clause; either the implementation is durable or it is not. Shipping a default-off durability primitive is "99.x% durable on average" framing in disguise.
  - Two code paths to test (env on, env off); two acceptance gates to maintain.
  - Adds a tuning surface (`RUFLO_RVF_WAL_FSYNC`) where the project memory rule says there should be no surface — the answer is just "yes, durable".

### (d) Defer until incident

- Pros:
  - Zero work today. Zero perf cost. ADR-0123's SIGKILL gate is sufficient for the typical operator profile (developer workstation, CI runner, server with battery-backed RAID).
  - Avoids speculative implementation against a low-probability scenario for the current operator base.
- Cons:
  - **Memory rule `feedback-data-loss-zero-tolerance` is not gated on incident frequency.** The rule says 99.x is not shippable; "we haven't seen the loss yet" is not a satisfaction argument.
  - Defers the architectural decision indefinitely. The longer the gap remains, the more callers depend on the implicit guarantee that `await rvf.store(...)` is durable, which today it is not under power loss.
  - The H3 review-notes triage already escalated this to a separate ADR (this one). Defer-until-incident is a third escalation back to "do nothing" — not a substantive option.

## Decision Outcome

**Preliminary recommendation pending Henrik review: option (a) — fsync after every `appendFile` call in `appendToWal`.** Trace to drivers:

| Driver | How (a) satisfies it |
|---|---|
| `feedback-data-loss-zero-tolerance` | 100% Linux power-loss durability for acked stores. macOS bound is documented honestly (fsync ≠ F_FULLFSYNC); the test gate uses Linux semantics. |
| ADR-0123 carve-out | This ADR closes the explicit ADR-0123 §Risks item 7 / §Validation deferral. |
| `feedback-no-fallbacks` | Awaited fsync; no `try/catch` swallowing. Failure throws. |
| ADR-0086 Debt 7 invariant | No new dependency surface. `fs.promises.fsync` is stdlib. |

**Pending-review caveat — explicitly:** the perf cost of unconditional fsync on every WAL append is real, and the macOS `fsync` vs `F_FULLFSYNC` semantic gap means platform-uniform 100% durability is not achievable without an FFI binding. Henrik should confirm:

1. Whether the perf cost is acceptable for the existing operator profile, or whether option (b) — re-cast as a fallback **only if benchmarking shows option (a) degrades typical workloads beyond a defined threshold** — is preferable. Re-cast option (b) is **not** the bare-batched-fsync described above (which violates the durability rule); it is "option (a) by default, with a documented degradation path if measured perf is unworkable".
2. Whether macOS power-loss durability is in scope. If yes, the implementation must reach `F_FULLFSYNC` via `fcntl` (no clean Node stdlib path; would require a small native binding — brushes ADR-0086 Debt 7). If no, the `fsync` call is sufficient and the macOS gap is documented.
3. Whether the FUSE/eatmydata acceptance harness from ADR-0118 H3 row (ii) is the correct test vehicle, or whether a simpler simulation suffices.

This ADR is a **placeholder design**: the recommendation is option (a), the structure of the change is documented below, but the decision is not final until Henrik acks the three pending items above.

Options (b) bare, (c), and (d) each fail the `feedback-data-loss-zero-tolerance` gate at the framing layer and are rejected.

## Consequences

### Positive

- True power-loss durability for any acked `store` call on Linux. macOS bound documented (process-kill + OS-crash durable; power-loss durable iff disk write cache disabled or filesystem-level F_FULLFSYNC equivalent in effect).
- ADR-0123's SIGKILL gate becomes a strict subset of this ADR's gate; no regression.
- Single touch site; the diff is small and reviewable.
- Failure mode is loud — fsync syscall errors throw, not silently degrade. `feedback-no-fallbacks` satisfied.
- Closes the explicit ADR-0123 carve-out — H3 row in the review-notes triage moves to resolved.

### Negative

- Per-`store` latency cost. Concrete bound depends on the host:
  - Commodity NVMe SSD on Linux: typically 100µs–1ms per fsync.
  - SATA SSD on Linux: typically 1–5ms per fsync.
  - Rotational disk or fsync-throttled cloud volume: 10ms+ per fsync.
  - macOS APFS: fsync is fast (sub-ms) but not durable through disk write cache; F_FULLFSYNC is 10ms+.
- A hot writer profile (1000+ stores/sec) sees throughput cap shift from CPU-bound to IO-bound. The acceptance gate must benchmark this; if the cost exceeds a documented threshold (TBD by Henrik), option (b) re-cast is the fallback path.
- macOS power-loss durability is not delivered without an FFI binding for `F_FULLFSYNC`. This ADR ships honest documentation of that gap rather than a misleading uniform claim.
- Adds one syscall per WAL append; observability needs a counter (fsync count, fsync latency p50/p99) so the cost is measurable in the eviction-rate-style metrics ADR-0123 introduced.

### Neutral

- No CLI-side change; no hive-mind-tools change; no marketplace plugin matrix row affected. The change is RVF-internal.
- ADR-0086 Debt 7 invariant is unaffected (no new SQLite or sql.js binding); `fs.promises.fsync` is stdlib.

## Validation

- **Acceptance — `check_adr0129_wal_fsync_power_loss_durability`** in `lib/acceptance-adr0129-rvf-fsync-checks.sh` (proposed location): drive a writer through a FUSE filesystem (or LD_PRELOAD `eatmydata`-style shim) that drops un-fsynced writes at a synthetic "power loss" event; assert that every entry whose `store` call resolved before the event is readable after the event. **100% — any data loss fails the check**, per `feedback-data-loss-zero-tolerance`. Wired into `scripts/test-acceptance.sh` sequentially after the parallel wave joins (FUSE mount + harness setup is heavy; cannot race other parallel checks).
- **Integration — `tests/unit/adr0129-rvf-wal-fsync.test.mjs`**: stub `fs.promises.fsync` to record call sites; assert that every `appendToWal` call results in exactly one `fsync` of the WAL file descriptor before the JS lock is released. Defensive against future regressions where `fsync` gets dropped or moved out of the lock region.
- **Integration — same file**: stub `fs.promises.fsync` to throw `EIO`; assert that the originating `store` call throws the same error (no swallow, no fallback).
- **Performance — `tests/perf/adr0129-fsync-overhead.bench.mjs`** (or wired into existing perf harness): benchmark `store` throughput with and without the fsync call; report p50/p99 latency delta. If the delta exceeds the threshold Henrik defines (TBD on review), the result triggers the option (b) re-cast fallback path.
- **ADR-0123 acceptance** (existing): `check_adr0123_sigkill_crash_durability` continues to pass — this ADR's change is strictly stronger, no regression.

## Decision

**Placeholder (pending Henrik review).** The intended Decision section once acked:

*"Add an `await fdatasync(walFd)` (preferred) or `await fsync(walFd)` call at the end of `appendToWal` in `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts` (within the WAL append region currently at lines 488-491), before the JS lock is released. The fsync is awaited inside the lock so a concurrent `compactWal` cannot observe an un-fsynced WAL state. Failure of the fsync syscall throws and propagates out of `store`. macOS uses Node's `fs.promises.fsync` (which maps to `fsync(2)`, not `F_FULLFSYNC`); the platform-specific durability bound is documented in the function's JSDoc and in the operator-facing durability guarantees section of the memory package README."*

Final wording is held until Henrik acks the three pending items in §Decision Outcome.

## Implementation plan

### Phase 1 — single-line fsync addition at touch site

`forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts:488-491` (the `appendToWal` invocation region inside `store`):

- After `appendFile(this.walPath, line, 'utf8')` resolves (the existing call inside `appendToWal`), open or reuse the WAL file descriptor and call `await fdatasync(walFd)` (preferred over `fsync` — avoids the metadata flush cost where filesystem semantics permit; falls back to `fsync` if `fdatasync` is unavailable on the platform).
- The fsync happens **inside** the existing JS lock region (the lock that already wraps the `await this.appendToWal(e)` call at line 487). This guarantees no concurrent `compactWal` can run between the WAL append and its fsync.
- File descriptor management: today `appendFile` opens and closes the fd per call. Two sub-options:
  - (i) Switch to a persistent `fs.promises.open(walPath, 'a')` handle on RVF init; reuse for each `appendFile` + `fdatasync`. Cleaner, faster (no per-call open).
  - (ii) Keep per-call open via `appendFile`, then reopen for the fsync. Simpler diff, double the syscall cost. Reject this sub-option unless the persistent-handle path has a complication.

### Phase 2 — observability

Add fsync call count and latency to RVF's existing metrics surface (mirrors ADR-0123's eviction-rate metric pattern):

- `rvf.wal.fsync.count` — total fsync calls since RVF init.
- `rvf.wal.fsync.latency_ms_p50`, `_p99` — latency distribution. Operator-visible via the same channel ADR-0123 uses for cache hit/miss.

### Phase 3 — tests (unit + integration + acceptance, per `feedback-all-test-levels.md`)

| Level | Test | Asserts |
|---|---|---|
| Unit (`tests/unit/adr0129-rvf-wal-fsync.test.mjs`) | fsync call site | Stubbed `fs.promises.fsync` records exactly one call per `appendToWal`, before lock release |
| Unit | fsync error propagation | Stubbed fsync throws `EIO`; originating `store` throws the same error; no swallow |
| Unit | fdatasync / fsync fallback | On a platform without `fdatasync`, the code falls back to `fsync` cleanly |
| Integration (`tests/unit/adr0129-rvf-wal-fsync.test.mjs` — separate suite) | RVF round-trip with real fsync | `store` then `get` returns the entry; fsync metric increments |
| Acceptance (`lib/acceptance-adr0129-rvf-fsync-checks.sh`) | Power-loss simulation | FUSE or eatmydata shim drops un-fsynced writes; all acked `store` calls survive. **100% — any loss fails.** |
| Performance | fsync overhead benchmark | p50/p99 latency delta with vs without fsync; reported, not gated (gating threshold TBD by Henrik) |

### Phase 4 — documentation

- Update RVF's JSDoc on `store` to document: "On Linux, the call is durable through power loss once it resolves. On macOS, the call is durable through process-kill and OS-crash; power-loss durability through the disk write cache requires `F_FULLFSYNC`, which is not used by Node's `fs.fsync`. Operators on macOS with power-loss exposure should disable disk write caching at the filesystem level or accept the residual window."
- Update ADR-0123 §Risks item 7 and §Validation: drop the "deferred to ADR-0130" annotations, mark the ADR-0130 surface as resolved (this happens in a separate commit, not from this ADR's agent).

## Specification

- **Durability invariant**: for every `await rvfBackend.store(entry)` call that resolves successfully on Linux, the WAL append for `entry` is durable through subsequent power loss. The mechanism is: WAL line written via `appendFile`; WAL fd `fdatasync`'d before lock release; `compactWal` (if triggered) inherits ADR-0095 d11's existing tmp-fsync-rename for the main `.rvf` file. On macOS, the same invariant holds for process-kill and OS-crash; power-loss durability is bounded by the disk write cache (Node's `fs.fsync` does not issue `F_FULLFSYNC`).
- **Failure semantics**: any error from `fdatasync` or `fsync` propagates as a thrown error from `store`. No `try/catch` wraps the syscall. `feedback-no-fallbacks` is satisfied by the absence of error swallowing.
- **Lock region**: the fsync call lives inside the same JS lock region as the WAL append and the conditional compact. A concurrent `store` cannot observe an un-fsynced WAL line.
- **No new dependency**: `fs.promises.fdatasync` (Node 14+) and `fs.promises.fsync` are stdlib. No native binding introduced.

## Pseudocode

```text
appendToWal(entry):                                   # called inside store(), under JS lock
    line = serialize(entry) + "\n"
    await appendFile(this.walPath, line, "utf8")      # existing line — kernel page cache write

    walFd = await this.getOrOpenWalFd("a")            # persistent fd, opened once on init (preferred)
    try:
        await fdatasync(walFd)                        # NEW — flush data through page cache
                                                      # Linux: durable through power loss
                                                      # macOS: durable through process-kill / OS-crash;
                                                      #        power-loss bound by disk write cache
                                                      # No catch — failure propagates out of store()
    catch ENOSYS:                                     # fdatasync not on platform — fall back
        await fsync(walFd)

    this.metrics.wal.fsync.count += 1
    this.metrics.wal.fsync.latency_ms.observe(elapsed)

    # Existing flow continues:
    this.walEntryCount += 1
    # store() then conditionally calls compactWal() under the same lock per current code

# No change to compactWal — its tmp-fsync-rename per ADR-0095 d11 is unchanged.
# The new invariant is: every WAL append is fsynced before the next operation can observe it.
```

## Architecture

- **Touch site**: `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts`, the `appendToWal` method (called from `store` at lines 488-491 per the trail in ADR-0118 H3 / ADR-0123 §Risks 7). Single function modification.
- **Lock interaction**: the existing JS lock at `store` already wraps `appendToWal`. The fsync call lives inside `appendToWal`'s body, so it is implicitly inside the same lock. No new lock primitives.
- **fd lifecycle**: preferred — RVF opens a single WAL fd in `init` (append mode), closes it in `shutdown`/`flush`. Fallback if persistent fd has a complication: reopen per call, accept the doubled syscall cost.
- **`compactWal` interaction**: unchanged. The compact path's tmp-fsync-rename (ADR-0095 d11, line 2513) is already durable; it consumes the WAL and replaces the main `.rvf` atomically. With this ADR, the WAL itself is also durable line-by-line, so the compaction window no longer hides un-fsynced state.
- **Cross-platform branch**: `fdatasync` is preferred (Linux supports; macOS does not on all node versions/filesystems). Code tries `fdatasync` first, falls back to `fsync` on `ENOSYS`. The fallback is shape-equivalent on Linux ext4/xfs (where `fdatasync` is the correct primitive) and on macOS APFS (where `fsync` is what Node provides).

## Refinement

### Edge cases

- **fsync syscall fails (`EIO`, `ENOSPC`, `EDQUOT`)**: the error propagates out of `appendToWal`, then out of `store`. The lock is released by the caller's `finally` block. The cache layer in ADR-0123 does not update for this key (matches ADR-0123's "RVF write throws → cache not updated" contract).
- **Persistent fd is invalidated** (e.g. WAL file deleted out from under the process): `fdatasync` returns `EBADF` or similar; treated as a fatal RVF error; the next `store` attempt either reinitialises the fd or throws. No silent recovery — `feedback-no-fallbacks`.
- **`fdatasync` not on the platform**: `ENOSYS` triggers fallback to `fsync`. Fallback is one-time on first call; subsequent calls go directly to `fsync`. No env var, no opt-in — automatic platform detection.
- **macOS disk write cache enabled**: documented honestly. Power-loss durability is not delivered by `fsync` alone on macOS; operators with power-loss exposure should either disable the disk cache (filesystem-level `noatime,sync` or hardware-level), accept the residual loss window, or wait for a follow-up ADR that adds an `F_FULLFSYNC` FFI binding. This ADR does not silently degrade — the gap is named.
- **Batched fsync semantics if the option (b) re-cast lands**: if benchmarking proves option (a) is unworkable, the re-cast option (b) is not bare-batched-fsync (which violates the durability rule); it is per-write `fsync` by default with an opt-in **operator-acknowledged** trade-off (e.g. `RUFLO_RVF_WAL_FSYNC_BATCH=ms` with a startup warning that durability is reduced). This is documented but not implemented unless Henrik acks the perf trade-off.
- **`compactWal` triggered immediately after `appendToWal`**: the compact's tmp-fsync-rename is already durable. The compact reads from the WAL file (which is now fsynced), so the durability chain is continuous: WAL append → WAL fsync → compact reads WAL → compact writes tmp → compact fsyncs tmp → compact renames tmp to main. No window where un-fsynced state is observable.

### Cross-platform Linux/macOS differences

- **Linux**: `fdatasync(2)` flushes file data and minimum metadata required to retrieve it; durable through power loss on filesystems that honour fsync semantics (ext4 default, xfs default, btrfs default). `fsync(2)` flushes data and all metadata; same durability bound. `fdatasync` is the correct primitive for WAL append (we don't need atime/mtime metadata flushed).
- **macOS / Darwin**: `fsync(2)` flushes the application-visible write to the disk's onboard cache, but does not flush the disk cache itself. True power-loss durability requires `fcntl(fd, F_FULLFSYNC)` (issues a SCSI SYNCHRONIZE CACHE / NVMe Flush command). Node's `fs.fsync` does **not** call `F_FULLFSYNC`. APFS itself can be configured with disk-cache-aware checkpoints, but the application-level call available from Node is bounded.
- **Implication for this ADR**: the Linux invariant is strict 100% power-loss durability. The macOS invariant is 100% process-kill + OS-crash durability, with a residual disk-cache window for power-loss. Documenting this is part of the deliverable; pretending otherwise would be the kind of silent rate-of-loss the project memory rule forbids.
- **Open question for Henrik**: does macOS power-loss durability matter for the operator profile? If yes, an FFI binding for `F_FULLFSYNC` is required (small native module — brushes ADR-0086 Debt 7 but does not violate it; the Debt 7 invariant is about better-sqlite3 + sql.js co-import, not native modules in general). If no, the `fsync` call is sufficient and the macOS gap is documented in JSDoc.

### Test list

- **Unit** (`tests/unit/adr0129-rvf-wal-fsync.test.mjs`): fsync called exactly once per `appendToWal`; called before lock release; called inside the lock region; fdatasync preferred over fsync where available; fsync error throws and propagates.
- **Integration** (same file, separate suite): real fsync against a tmpdir; fsync metric increments; persistent fd lifecycle (init opens, shutdown closes).
- **Acceptance** (`lib/acceptance-adr0129-rvf-fsync-checks.sh`): FUSE / eatmydata simulated power loss; 100% acked stores survive.
- **Performance** (`tests/perf/adr0129-fsync-overhead.bench.mjs` or wired into existing perf harness): p50/p99 latency delta with vs without fsync.
- **Cross-platform** (CI matrix): Linux runner asserts fdatasync used; macOS runner asserts fsync used; both runners pass acceptance.

## Completion

**Annotation lift criterion**: ADR-0123 §Risks item 7 and the §Validation `check_adr0123_sigkill_crash_durability` carve-out are updated to drop the "deferred to ADR-0130" annotations and mark this surface as resolved. This update happens in a separate commit by a separate agent (not from this ADR's agent — per the user's explicit constraint). Annotation lift fires only after acceptance + integration tests are green on `main` and Henrik acks the three pending items in §Decision Outcome.

The H3 row in `ADR-0118-review-notes-triage.md` is also updated by that same separate commit to mark H3 as resolved with this ADR's commit hash.

## Acceptance criteria

- [ ] Phase 1: `appendToWal` issues `fdatasync` (or `fsync` fallback) on the WAL fd before lock release; failure propagates without swallow
- [ ] Phase 2: fsync count + p50/p99 latency metrics exposed via RVF's existing metrics surface
- [ ] Phase 3: `tests/unit/adr0129-rvf-wal-fsync.test.mjs` green — fsync call site, error propagation, fdatasync/fsync fallback all asserted
- [ ] Phase 3: `lib/acceptance-adr0129-rvf-fsync-checks.sh` green — `check_adr0129_wal_fsync_power_loss_durability` passes with 100% durability under FUSE / eatmydata simulated power loss (any data loss fails the check, per `feedback-data-loss-zero-tolerance`)
- [ ] Phase 3: `tests/perf/adr0129-fsync-overhead.bench.mjs` reports p50/p99 latency delta — gating threshold TBD by Henrik
- [ ] Phase 4: RVF `store` JSDoc documents Linux power-loss durability and the macOS disk-cache bound honestly; no uniform-100%-cross-platform claim
- [ ] ADR-0123's existing `check_adr0123_sigkill_crash_durability` continues to pass (no regression — this ADR is strictly stronger)
- [ ] `npm run test:unit` green
- [ ] `npm run test:acceptance` green (Verdaccio up)
- [ ] Henrik ack on the three pending items: perf trade-off threshold, macOS F_FULLFSYNC scope, FUSE/eatmydata test vehicle choice

## Risks

1. **Perf cost exceeds the operator-acceptable threshold.** If benchmarking shows option (a) degrades typical workloads beyond what Henrik defines as acceptable, the option (b) re-cast fallback (per-write fsync by default + opt-in operator-acknowledged batch mode) becomes the implementation. This is named in §Decision Outcome as a contingency, not an inline default.
2. **macOS power-loss durability gap.** Node's `fs.fsync` does not issue `F_FULLFSYNC`; macOS power-loss durability is bounded by the disk write cache. Mitigation: document the gap honestly in JSDoc and in this ADR's §Refinement; do not claim uniform cross-platform 100%. If the operator profile demands macOS power-loss durability, an FFI binding is a follow-up ADR.
3. **Persistent fd lifecycle bugs.** If RVF holds a persistent WAL fd across init/shutdown, fd leakage or double-close are new failure modes. Mitigation: tests cover init opens, shutdown closes, error paths close. The fallback (reopen per call) is available if the persistent fd path proves unstable.
4. **fsync call inside lock blocks all other writers.** The fsync call adds 100µs–10ms to the lock-held window per write. A high-concurrency writer profile sees throughput drop proportionally. Mitigation: benchmark first; the acceptance gate measures p99 latency. If unacceptable, the option (b) re-cast is the documented escape hatch.
5. **FUSE / eatmydata harness flakiness.** Power-loss simulation harnesses are notoriously flaky in CI. Mitigation: gate the FUSE-driven acceptance check on a `RUFLO_FSYNC_TESTS=1` flag (similar to the existing ruvector-heavy tier carve-out); run sequentially after the parallel wave; document the harness setup in `lib/acceptance-adr0129-rvf-fsync-checks.sh` header. If FUSE proves too flaky, switch to eatmydata or a simpler `LD_PRELOAD` shim that drops un-fsynced writes on synthetic kill.
6. **Decision is placeholder, not final.** Henrik has not yet acked the three pending items in §Decision Outcome. Implementation of this ADR is gated on that ack. Until then, this ADR is design-only; no code changes against `rvf-backend.ts` are merged from it.
7. **ADR-0086 Debt 7 invariant.** The `fs.promises.fsync` / `fdatasync` path is stdlib — no native binding, no co-import risk. If macOS `F_FULLFSYNC` becomes in scope, the FFI binding required is a single-purpose native module that imports neither better-sqlite3 nor sql.js; the invariant is preserved. Mitigation: invariant-check (`grep -l "from 'better-sqlite3'" dist/` ∩ `grep -l "from 'sql.js'" dist/` = ∅) runs as precondition to merge.

## References

- ADR-0123 — T5 RVF-backed memory backend; explicitly defers true power-loss durability to this ADR (§Risks item 7, §Validation `check_adr0123_sigkill_crash_durability` callout)
- ADR-0118 review-notes-triage row H3 — escalation row that named this ADR as the owner of the fsync gap
- ADR-0095 d11 — RVF tmp-file fsync-before-rename pattern; model for the WAL-append fsync introduced here
- ADR-0086 Debt 7 — better-sqlite3 / sql.js placement history (invariant unaffected; durability is an RVF-internal concern)
- Memory: `feedback-data-loss-zero-tolerance` — 100% durability or not fixed; rule that drives every option above
- Memory: `feedback-no-fallbacks` — no silent catch on fsync errors
- Memory: `feedback-all-test-levels` — unit + integration + acceptance + perf in this pass
- Source: `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts:488-491` — touch site (the `appendToWal` invocation region inside `store`, identified in ADR-0123 §Risks item 7)
- Source: `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts:2513` — existing tmp-file fsync per ADR-0095 d11; durability pattern model
