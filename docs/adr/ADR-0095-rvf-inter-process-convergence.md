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

## Investigation Findings (2026-04-17)

Ran Sprint-1 root-cause investigation against `@sparkleideas/cli@3.5.58-patch.136` in a fresh `/tmp/ruflo-s1-probe-*` init'd project with a traced copy of the published `@sparkleideas/memory/dist/rvf-backend.js`. The findings below are append-only and supersede the ADR's original failure-mode narrative (which was authored before the fork's current source was inspected).

### Reproduction

At N=6 parallel `cli memory store` subprocesses with unique keys, observed final state:

- `.swarm/memory.rvf` — magic `RVF\0` (pure-TS format), ~33 KB
- `.swarm/memory.rvf.meta` — magic `RVF\0`, header `entryCount=1` (5 entries lost)
- 5 of 6 CLI subprocesses exit 0 reporting "Data stored successfully"; 1 subprocess crashes fail-loud with `RVF storage at .swarm/memory.rvf is corrupt: bad magic bytes (expected 'RVF\0', got "SFVR")` in one run, or `ENOENT ... rename '.swarm/memory.rvf.tmp' -> '.swarm/memory.rvf'` in another. **Both secondary failure modes appear non-deterministically** alongside the entryCount=1 primary loss. N=1 serial always succeeds. The in-process B7 diag passes 10/10 (already noted in B7). The CLI path is `.swarm/memory.rvf*`, not `.claude-flow/data/memory/.rvf*` as the ADR context paragraph claimed.

### Source state — stated fix already shipped

`forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts` HEAD (`196100171`):

- `mergePeerStateBeforePersist()` (lines 1298–1382) **already re-reads `.meta` or main RVF before replaying WAL**, under the advisory lock, with `seenIds`-gated set-if-absent semantics (line 1354). The ADR §Decision "Re-read `.meta` + merge WAL" protocol is implemented verbatim.
- `persistToDiskInner` (line 1404) calls `mergePeerStateBeforePersist()` before every write.
- `compactWal` (line 1040) serializes persists under the advisory lock.
- `store()` (line 236) invokes `compactWal()` after every entry (always-compact, ADR-0090 B7 followup).

Quoted call-graph: `store → appendToWal → compactWal → acquireLock → persistToDiskInner → mergePeerStateBeforePersist → readFile(.meta|main) + replayWal → writeFile(tmp) → rename(tmp, target) → unlink(wal) → releaseLock`.

### Real root cause — backend-identity flip + shared tmp path

Trace of 6 concurrent subprocesses (each instruments `tryNativeInit`, `persistToDiskInner`, `rename`) yields the dispositive timeline:

1. **Two RvfBackend instances per CLI invocation.** Each `cli memory store` runs `tryNativeInit` twice — once with `dbPath=.swarm/memory.rvf` (relative), once with the absolute resolved path. Two independent `RvfDatabase.open`/`.create` calls race inside one process before the first persist. Likely two call sites (one via MemoryManager, one via controller registry); not decomposed here.
2. **Backend identity flips per process.** At persist time, only **1 of 6** subprocesses has `nativeDb=true`; the other 5 have `nativeDb=false`. The native open silently failed for them — swallowed by `tryNativeInit`'s `catch {}` at line 635. Hypothesis: when pid A's `RvfDatabase.create` writes SFVR bytes mid-flight and pid B's `RvfDatabase.open` races, the open sees a half-written header and throws, which tryNativeInit swallows (ADR-0082 violation — silent fallback to pure-TS when native was expected).
3. **Mixed-backend writes on the same physical file.** The 1 native writer writes pure-TS metadata to `memory.rvf.meta` (via `metadataPath` → sidecar). The 5 pure-TS writers write `RVF\0` bytes to `memory.rvf` **directly** (their `metadataPath` returns the main path). The two writer classes are on disjoint paths and `mergePeerStateBeforePersist` reads only the one it owns. They never see each other's writes.
4. **Shared tmp path.** Line 1450: `const tmpPath = target + '.tmp'`. All writers targeting the same `target` race on the same `.tmp` file. When writer A's `rename(tmp, target)` wins, writer B's subsequent `rename(tmp, target)` fails with `ENOENT` because B's tmp file was never its own. Observed as the `ENOENT ... rename` error above.
5. **Fail-loud corruption path fires on SFVR reader racing SFVR writer.** `loadFromDisk`'s NATIVE_MAGIC peek (line 1099) sees SFVR, switches to sidecar-only, but a peer writer's in-flight SFVR file can appear valid-magic-but-short, tripping the "bad magic" path. Observed in the N=6 crash log.

**The ADR's narrative ("WAL-only merge, miss compacted .meta") is obsolete.** The shipped merge code already does what the ADR recommends. The actual bug is two layers above: (a) native initialization is not inter-process safe and silently falls back, (b) pure-TS and native writers use divergent paths, so the merge closes the in-process hole but not the cross-backend one.

### Ruling on D1–D6

- **D1 (rename/fsync gap)** — **NOT the primary bug.** APFS rename is atomic per the atomicity probe spec; the shipped `datasync` on parent dir (line 1458) covers power-loss durability. Tmp-path collision (point 4 above) is the real rename-path concern. **Defer D1 as an amendment; replace with "unique tmp path per process"** (e.g. `target + '.tmp.' + process.pid + '.' + Date.now()`).
- **D2 (seenIds poisoning)** — **No evidence.** All observed failures are upstream of `seenIds`; the merge path isn't even reached for the lost entries because they were written to a different on-disk path. **Accept as written (no change).**
- **D3 (WAL after .meta double-count)** — **Safe as written.** replayWal's id gate protects. **Accept.**
- **D4 (native sidecar interplay)** — **This IS the primary bug, worse than ADR described.** The ADR assumed "one backend wins per persist." In practice the backend flips per-process-per-invocation based on `tryNativeInit` success/failure. **Amend: native must either succeed everywhere or nowhere; pure-TS and native cannot coexist on the same `.rvf` path set concurrently.** Recommend forcing the backend choice at process start and failing loud if native unavailable (remove line-635 silent-catch).
- **D5 (atomicity scope single-phase)** — **Accept as written** but force unique tmp path.
- **D6 (fsync strategy)** — **Not the bug.** `datasync` already present; no evidence durability is the loss mode. **Accept as written, keep.**

### Architect recommendation

**Amendment needed.** The current ADR §Decision is correct but insufficient; it fixes a bug that is already fixed and does not close the real hole. The amendment must add:

1. **Fail-loud on native init failure after first success.** Remove the silent `catch {}` at `tryNativeInit` line 635 once a first process has written SFVR. Define an invariant: if the main `.rvf` file exists with `SFVR` magic, every subsequent process MUST either load native or refuse to write. Pure-TS fallback on SFVR-present is silent data loss (ADR-0082 violation).
2. **Unique tmp paths.** `target + '.tmp.' + process.pid + '.' + counter` to eliminate cross-process tmp collisions.
3. **De-duplicate RvfBackend instances per process.** The 2× `tryNativeInit` trace indicates double-init. Fix at call sites (likely registry + MemoryManager both instantiate).
4. **Out-of-scope probe** `scripts/diag-rvf-interproc-race.mjs` (delivered, see below) already detects the loss non-deterministically via subprocess sampling. The rename-atomicity probe and fsync-durability probe from §Out-of-Scope Probe remain valuable as pure disproofs but are lower-priority given the real bug isn't rename atomicity.

The implementer blocked on this ADR should NOT touch `mergePeerStateBeforePersist`. They must touch `tryNativeInit` (fail-loud), the persist path (unique tmp), and the backend construction call sites (de-dupe). Sprint scope should expand accordingly.

### Probe delivered

`scripts/diag-rvf-interproc-race.mjs` — spawns N unique-key `cli memory store` subprocesses, inspects `.swarm/memory.rvf.meta` for `entryCount === N`, exits 1 on loss. Uses the installed CLI (`node_modules/.bin/cli`) against Verdaccio. Correct meta path hard-coded at line 91 (empirically validated). Usable from cascade as `node scripts/diag-rvf-interproc-race.mjs 6 3` (N=6, 3 iterations). The B2 acceptance-bar target is 40/40 at N=2/4/8 across 3 days.
