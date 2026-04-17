# ADR-0095: RVF Inter-Process Write Convergence

- **Status**: Proposed — 2026-04-17
- **Date**: 2026-04-17
- **Scope**: `v3/@claude-flow/memory/src/rvf-backend.ts` — `persistToDisk`, `persistToDiskInner`, `mergePeerStateBeforePersist`, `compactWal`, `acquireLock`
- **Forked from**: ADR-0094 Open Item #1
- **Related**: ADR-0086 (Storage Layer), ADR-0090 B7 (in-process multi-writer fix), ADR-0092 (native/pure-TS coexistence), ADR-0082 (no silent fallbacks), BUG-0008 (ledger)

## Context

The 15-agent remediation swarm's `fix-t3-2-rvf-concurrent` agent made RVF concurrent writes pass an in-process simulation (10/10 trials) by calling `compactWal()` after every `store()`. The real CLI test (`t3-2-concurrent`, 6 parallel `cli memory store` subprocesses) still fails: final `.rvf.meta` has `entryCount=1` (5 entries lost) despite all 6 CLIs exiting 0.

ADR-0090 B7's regression guard (`scripts/diag-rvf-inproc-race.mjs`) also passes because it is an **in-process** race — 4 RvfBackend instances in a single node process sharing module state. The real failure mode is **inter-process**: 6 independent node processes, no shared memory, racing on the file system.

### Why the current fix is incomplete

`compactWal()` acquires the advisory lock and calls `persistToDiskInner` → `mergePeerStateBeforePersist`. `mergePeerStateBeforePersist` reads only the WAL. The first writer to win the lock:
1. Reads WAL, merges into `this.entries`,
2. Writes `.meta.tmp` → atomic rename to `.meta`,
3. **Unlinks the WAL** (compaction semantic).

Subsequent writers arriving at `compactWal()` see an empty WAL — no peer state. Their `this.entries` still holds only their own entry (loaded from the empty-at-the-time `.meta`). They write their single-entry snapshot, **overwriting** the first writer's multi-entry `.meta`.

This is not an in-process race the B7 fix was designed for. It's a missing read-merge-write step: we merge WAL-only, not `.meta`-and-WAL.

### Reproducibility

- `t3-2-concurrent` — the primary acceptance check. 6 parallel `cli memory store` with unique keys; expect `.meta.entryCount=6`, observe `1`.
- `scripts/diag-rvf-interproc-race.mjs` — to be written as the regression guard for this ADR (the in-process diag cannot detect this).

## Decision (Proposed)

Adopt a **read-meta-under-lock + merge + write** protocol in `persistToDiskInner`. Under the advisory lock:
1. Re-read `.meta` (or `.meta` sidecar under native coexistence).
2. Replay WAL.
3. Merge both sources into `this.entries` using `seenIds`-gated set-if-absent (inherits ADR-0090 B7 tombstone semantics).
4. Write `.meta.tmp`, atomic rename.
5. Unlink WAL.

## Alternatives

### A. Read-meta-under-lock + merge + write (recommended)

Every persist under the lock does a `loadFromDisk(mergeOnly=true)` before writing. Closes the inter-process hole deterministically.

**Pros**: simple conceptual model ("lock + read-merge-write"); no new file artifacts; preserves WAL compaction semantics.
**Cons**: double-read cost per persist (but we already hold the lock, so serialized writes amortize it).

### B. WAL-tailing: don't unlink WAL, use offset watermarks

Each writer tracks a WAL read offset. Subsequent writers read WAL from their watermark, merge peer entries, advance watermark. WAL never unlinks; compaction rewrites with offset 0.

**Pros**: no extra disk reads during persist.
**Cons**: WAL grows unbounded between full compactions; new "safe compaction" rule required; complicated cross-process offset state.

### C. OS-level file-lock primitive (flock / fcntl) + single-writer serialization

Use `flock` instead of the current PID-based `.rvf.lock`. Writers queue; when it's your turn, you re-read everything fresh.

**Pros**: OS guarantees; no application-level protocol risk.
**Cons**: `flock` semantics differ across POSIX/macOS/NFS; Node.js has no built-in binding (needs native addon or external process); breaks the "simple advisory lock file" model ADR-0090 adopted deliberately.

### D. Central writer process (daemon)

One writer process owns `.rvf`; CLI processes send entries via IPC. Eliminates the race by eliminating concurrency.

**Pros**: perfect correctness.
**Cons**: contradicts ADR-0088 ("daemon in CLI hot path was eliminated in favor of file-based simplicity"); huge scope growth.

## Recommendation

Option **A**. Smallest diff, inherits existing lock + seenIds + tombstone infrastructure, closes the hole without new architectural debt.

## Acceptance criteria

This ADR is Implemented when:
1. `t3-2-concurrent` acceptance check passes green for 3 consecutive cascade runs across 3 days.
2. A new `scripts/diag-rvf-interproc-race.mjs` (out-of-process N-subprocess race) passes 40/40 at N=2/4/8 (matches the B7 in-process diagnostic bar).
3. `adr0086-rvf-integration.test.mjs` adds a case that spawns 6 subprocesses and verifies `entryCount=6` + all 6 embeddings retrievable.
4. BUG-0008 transitions from `regressed` → `verified-green` → `closed` per the bug ledger state machine.
5. ADR-0094 Open Item #1 strikes through with a link back to this ADR.

## Risks

- **Double-read cost** — mitigated by the amortization note above; measure with a micro-benchmark and fail CI if persist time exceeds 50ms under N=8.
- **Cross-ADR coupling** — ADR-0086 ("Layer 1 Storage") implicitly assumes one writer-per-process. If this ADR changes the invariants, ADR-0086 needs a cross-link note.
- **Native coexistence (ADR-0092)** — the re-read must use the `.meta` sidecar when native owns the main file. The current NATIVE_MAGIC peek logic already handles this; verify integration.

## References

- ADR-0094 Open Item #1 (the parent)
- ADR-0090 B7 (the adjacent in-process fix and its regression guard)
- BUG-0008 in `docs/bugs/coverage-ledger.md`
- Queen synthesis `/tmp/hive/queen-synthesis.md` §F row 1 (the fork decision)
- Fork commit `196100171` (partial always-compact fix; establishes the baseline this ADR supersedes)
