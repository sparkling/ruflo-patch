# ADR-0095: RVF Inter-Process Write Convergence

- **Status**: Accepted — Amended 2026-04-18
- **Date**: 2026-04-17 (authored), 2026-04-17 (amended after Sprint-1 investigation), 2026-04-18 (amended after Sprint-1.2 Pass-2 investigation — items d1+d2 appended)
- **Scope**: `v3/@claude-flow/memory/src/rvf-backend.ts` — `tryNativeInit` (line 605), `persistToDiskInner` (line 1384 — specifically the shared-tmp-path at line 1450), backend construction call sites (MemoryManager + controller registry). `mergePeerStateBeforePersist` is explicitly **out of scope** for this ADR — the shipped implementation (lines 1298–1382) already does what the original §Decision proposed.
- **Forked from**: ADR-0094 Open Item #1
- **Related**: ADR-0086 (Storage Layer), ADR-0090 B7 (in-process multi-writer fix), ADR-0092 (native/pure-TS coexistence), ADR-0082 (no silent fallbacks), ADR-0088 (no daemon in CLI hot path), BUG-0008 (ledger)

## Changelog

- **2026-04-17 (authored)** — Proposed "read-meta-under-lock + merge + write" protocol.
- **2026-04-17 (amended, same day)** — Sprint-1 investigator (`f4dd1ec`) established that the proposed protocol is already implemented at lines 1298–1382 and does not close the observed inter-process data-loss bug. Real root cause is a **3-layer backend flip race**: (1) silent catch in `tryNativeInit` (line 635) masks native-init races so 5 of 6 concurrent writers silently fall back to pure-TS (ADR-0082 violation); (2) native writers target the `.meta` sidecar while pure-TS writers target the main `.rvf` path — disjoint write targets mean the peer-merge never sees peer writes; (3) shared `.rvf.tmp` path at line 1450 causes cross-process `rename()` ENOENT collisions and transient SFVR-corruption reads. Amended §Decision replaces the merge-protocol proposal with a three-item program: fail-loud on native init once SFVR bytes exist, per-writer unique tmp paths, and dedupe RvfBackend construction per process. See §Investigation Findings (appended below) for the dispositive trace.
- **2026-04-18 (amended, Sprint-1.2 Pass-2)** — Pass-2 investigator (`ef5d357`) validated items (a)+(b)+(c) landed in `@sparkleideas/cli@3.5.58-patch.137` (fork `9c5809324`), confirmed in-process N=6 now PASSES, but subprocess N=6 still fails with `entryCount=1/6`. Root cause of the residual loss is **H7**: the native `RvfDatabase` holds an exclusive OS-level lock on the SFVR file during `open`/`create`. At N=6 only one writer acquires the native lock; the other 5 fail LOUDLY (item a working as designed) with `RVF error 0x0300: LockHeld` or `0x0303: FsyncFailed` inside `initialize()` — **before** any `store()` call, so the merge protocol is never reached. Item (c)'s factory cache does NOT fire on the CLI hot path because `cli/memory-router.ts:435-443`'s private `createStorage` bypasses `@sparkleideas/memory/storage-factory`. Amendment appends items **d1** (serialize `tryNativeInit` through the advisory lock) and **d2** (route the CLI's private `createStorage` through the shared factory). Items (a)/(b)/(c) stand unchanged.

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

## Decision

> **~~Struck 2026-04-17 — original proposal obsolete.~~** The original §Decision below proposed a "read-meta-under-lock + merge + write" protocol in `persistToDiskInner`. Sprint-1 investigation (see §Investigation Findings below) confirmed that `mergePeerStateBeforePersist` at `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts:1298-1382` **already implements exactly this protocol**, including `.meta`/main-path fallback (lines 1309–1317), header validation (lines 1322–1331), entry replay (lines 1332–1343), and `seenIds`-gated set-if-absent merge (lines 1354–1361). Shipping the original proposal would be a no-op. Per ADR-0094 Maintenance Manifesto rule 1, the superseded text is preserved verbatim below.
>
> <details>
> <summary>Original §Decision (superseded)</summary>
>
> > Adopt a **read-meta-under-lock + merge + write** protocol in `persistToDiskInner`. Under the advisory lock:
> > 1. Re-read `.meta` (or `.meta` sidecar under native coexistence).
> > 2. Replay WAL.
> > 3. Merge both sources into `this.entries` using `seenIds`-gated set-if-absent (inherits ADR-0090 B7 tombstone semantics).
> > 4. Write `.meta.tmp`, atomic rename.
> > 5. Unlink WAL.
>
> </details>

### Amended Decision (2026-04-17) — three-item program

The real bug is a 3-layer backend-identity race occurring **before** the merge path is reached. The amended decision is a three-item program targeting the three distinct failure modes identified in §Investigation Findings. Each item is paired with the exact source location to edit and the invariant it enforces.

#### a. Remove silent catch in `tryNativeInit`; enforce "once SFVR, always native-or-refuse"

**Target**: `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts:605-641` — specifically the bare `catch {}` at line 635.

**Current code** (quoted for the implementer):

```ts
// line 619
if (fileExists(this.config.databasePath)) {
  this.nativeDb = rvf.RvfDatabase.open(this.config.databasePath);
} else {
  this.nativeDb = rvf.RvfDatabase.create(this.config.databasePath, { ... });
}
...
return true;
} catch {                                               // line 635 — silent
  if (this.config.verbose) {
    console.log('[RvfBackend] @ruvector/rvf-node not available, using pure-TS fallback');
  }
  return false;
}
```

**Problem**: at N=6 the investigator observed 5 of 6 processes returning `false` from this method because `RvfDatabase.open` races with a peer's in-flight `RvfDatabase.create` write and throws. The catch-all swallows every error shape — `MODULE_NOT_FOUND` (legitimate, falls back to pure-TS) is indistinguishable from `SFVR partial write` / `EBUSY` / `EAGAIN` (transient, should retry-or-refuse) or from the catastrophic "file has SFVR magic but open errored for some other reason" (fatal, must not fall back). This is the ADR-0082 violation called out in BUG-0008.

**Expected behavior** after amendment:
1. Detect whether `@ruvector/rvf-node` is installed **before** the `RvfDatabase.open/create` call (a module-resolution probe). If not installed → pure-TS fallback is legitimate, return `false` with no log suppression.
2. If the module is installed **and** `this.config.databasePath` exists with the native SFVR magic at offset 0 (peek the first 4 bytes), enforce the **"once SFVR, always native-or-refuse"** invariant: retry `RvfDatabase.open` with bounded backoff (e.g. 3 tries × 50ms), and on final failure **throw** rather than return `false`. Pure-TS fallback in this state is silent data loss — it would write `RVF\0` bytes to a file that native readers will reject.
3. If the module is installed and the file does not exist (or exists without SFVR magic), legitimate `RvfDatabase.create` path; on failure distinguish ENOENT-on-cold-start (benign — pure-TS is fine for fresh repo) from other I/O errors (fatal).
4. Emit a single structured log line on any non-module-resolution failure (`[RvfBackend] native init failed: <code>` — never silent), even in non-verbose mode.

**Why this closes the bug**: the 3-layer race exists because `tryNativeInit` returns `false` for transient cross-process races, flipping the backend identity. Once fail-loud, a peer's mid-write state either resolves (retry succeeds) or halts the caller (no pure-TS fallback writing to the main path). The "disjoint write targets" layer (item a's root cause) cannot form.

#### b. Unique tmp path per writer

**Target**: `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts:1449-1452` — specifically the shared `target + '.tmp'` literal.

**Current code**:

```ts
// line 1449-1452
// Atomic write: write to temp file then rename (crash-safe)
const tmpPath = target + '.tmp';
await writeFile(tmpPath, output);
await rename(tmpPath, target);
```

**Problem**: all concurrent writers targeting the same `target` share a single `.tmp` file. When writer A's `rename(tmp, target)` wins, writer B's next `writeFile(tmpPath, ...)` is immediately followed by an `fs.rename(tmpPath, target)`, but B's tmp inode was replaced by A's (or already unlinked), producing either ENOENT or a corrupted-partial-write rename. Observed as the `ENOENT ... rename '.swarm/memory.rvf.tmp' -> '.swarm/memory.rvf'` crash.

**Expected behavior** after amendment:

```ts
const tmpCounter = RvfBackend.nextTmpCounter();  // module-level atomic u32
const tmpPath = `${target}.tmp.${process.pid}.${tmpCounter}`;
await writeFile(tmpPath, output);
await rename(tmpPath, target);
```

The atomic rename-to-final-target semantic is preserved (POSIX `rename(2)` is atomic whether source and destination have the same basename or not). Each writer owns its tmp inode until the rename instant. On process crash, a `reaper` at `initialize()` scans `dirname(target)` for `*.tmp.PID.*` files with stat `mtime` older than 10 minutes and unlinks them.

**Why this closes the bug**: eliminates the cross-process rename race entirely. No two writers can observe each other's tmp path. This layer is independent of the native/pure-TS fix — it must land even if item (a) succeeds, because in-process concurrent writers (ADR-0090 B7's regime) share the same issue at a smaller blast radius.

#### c. Dedupe RvfBackend construction per process

**Target**: backend construction call sites — `v3/@claude-flow/memory/src/*.ts` (MemoryManager) and the controller registry path in agentdb-service.ts. Investigator traced **two** `tryNativeInit` invocations per `cli memory store` run (once with relative dbPath, once with resolved absolute path) indicating two RvfBackend instances race inside one process before any persist.

**Expected behavior** after amendment:
1. Normalize `this.config.databasePath` via `path.resolve()` at construction.
2. Cache RvfBackend instances in a module-scope `Map<resolvedPath, RvfBackend>`. On repeat construction with the same resolved path, return the existing instance.
3. Invalidate the cache entry if a subsequent operation throws ENOENT on the resolved path (foreign process deleted the file — treat as fresh-start and re-initialize).

**Why this closes the bug**: eliminates the intra-process compounding of the inter-process race. Two instances in one process racing on `RvfDatabase.create`/`RvfDatabase.open` is a strict superset of what (a) guards against; deduping means only one native-init attempt per process per path, so (a)'s invariant is enforced without flapping.

#### d1. Serialize `tryNativeInit` through the advisory lock

**Target**: `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts:132-170` — specifically the `initialize()` method. Current code at lines 139-154 runs `reapStaleTmpFiles` → `tryNativeInit` → `loadFromDisk` without holding the advisory lock. The native `RvfDatabase.open`/`.create` call at line 141 (inside `tryNativeInit`) hits an **exclusive OS-level lock** owned by `@sparkleideas/ruvector-rvf-node`, which returns `RVF error 0x0300: LockHeld` to every concurrent peer at N=6 (Pass-2 §H7, trial t1 — 5 of 6 writers rejected; trial t2 — all 6 hit `0x0303: FsyncFailed` on `create`). Items (a)/(b)/(c) make these failures fail LOUD (per ADR-0082), but "fail loud" is not "converge" — the 5 losers never reach `store()`, so the merge protocol at line 1583 is never exercised for their entries.

**Expected behavior** after amendment: wrap lines 139-154 of `initialize()` inside the existing advisory-lock span:

```ts
await this.acquireLock();
try {
  await this.reapStaleTmpFiles().catch(() => {});
  const hasNative = await this.tryNativeInit();
  if (!hasNative) {
    this.hnswIndex = new HnswLite(/* ... */);
  }
  await this.loadFromDisk();
} finally {
  await this.releaseLock();
}
```

Only one process at a time attempts `RvfDatabase.open`/`create`; subsequent writers block on the advisory lock (5s acquire budget, PID-liveness stale-holder detection per ADR-0090), then open after the first writer's `initialize()` releases. The native library's internal exclusive lock is released when each process closes its handle — so serialized init means serial `open` succeeds across all N writers.

**Why this closes the residual bug**: H7 (confirmed in Pass-2) established that the native backend's exclusive lock denies 5 of 6 concurrent opens. Item (a) correctly throws, but this converts data-loss into CLI-exit-failure. Serializing through the advisory lock means every writer eventually gets its turn at native `open`, reaches `store()`, and participates in the merge protocol already validated by items (a)/(b)/(c). This is the one change that restores convergence at N≥2 without weakening any ADR-0082 invariant.

#### d2. Route CLI's private `createStorage` through the shared factory

**Target**: `forks/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts:435-443` — the private `createStorage(config)` function. Current code does `new memMod.RvfBackend({...})` directly, bypassing `@sparkleideas/memory/storage-factory`'s `backendCache`. Pass-2 trace confirmed: call site 1 (`memory-router.js:290` → private `createStorage`) uses a relative path and skips the cache entirely, while call site 2 (controller-registry path) uses the absolute path and hits the cache — resulting in **2× `tryNativeInit`** per CLI invocation.

**Current code**:

```ts
// line 435-443
async function createStorage(config: { databasePath: string; dimensions?: number }): Promise<IStorageContract> {
  const memMod = await import('@claude-flow/memory/rvf-backend' as string);
  const backend = new memMod.RvfBackend({
    databasePath: config.databasePath,
    dimensions: config.dimensions,
  });
  await backend.initialize();
  return backend;
}
```

**Expected behavior** after amendment: one-line swap to route through item (c)'s existing factory cache, with explicit `path.resolve()` at the call boundary so call site 1's relative path and call site 2's absolute path share a cache key:

```ts
async function createStorage(config: { databasePath: string; dimensions?: number }): Promise<IStorageContract> {
  const memMod = await import('@claude-flow/memory/storage-factory' as string);
  const backend = await memMod.createStorage({
    databasePath: path.resolve(config.databasePath),
    dimensions: config.dimensions,
  });
  return backend;
}
```

**Why this closes the residual bug**: item (c) already shipped a module-scope `Map<resolvedPath, RvfBackend>` in `storage-factory.ts:34`, but the CLI hot path never consumed it — so the 2×-init pattern the investigator found at commit `f4dd1ec` is still present at `ef5d357`. d2 makes call site 1 go through the factory; combined with path normalization, call site 2's registry-init finds the cached instance and skips its own `tryNativeInit`. Each process now performs exactly one native-init attempt per resolved path, which shrinks the d1 lock-queue depth from 2N to N and eliminates intra-process `LockHeld` collisions. d2 is independently valuable (halves native-init count even without d1) and strictly amplifies d1's effectiveness.

### Why these five items, together

Items (a)+(b)+(c)+(d1)+(d2) form a closed set targeting five distinct failure layers:
- (a) prevents silent identity flip on transient native-init error (ADR-0082 compliance).
- (b) eliminates the shared-tmp-path rename race (file-system-level, orthogonal to backend choice).
- (c) provides in-process backend-instance dedup (module-scope `Map` in the factory).
- (d1) serializes inter-process native-init through the advisory lock, closing H7's exclusive-OS-lock race.
- (d2) wires the CLI's private `createStorage` into (c)'s cache, halving native-init invocations per process.

Removing any one item leaves a non-deterministic leak path visible in `scripts/diag-rvf-interproc-race.mjs`. Specifically: without d1, N=6 shows `LockHeld`/`FsyncFailed` cascades (Pass-2 trials t1-t3); without d2, the 2×-init amplifies d1's lock-queue depth and can trip the 5s acquire budget at higher N.

## Alternatives

The alternatives below (A/B/C/D) were authored against the wrong problem — they assumed the merge protocol was missing, which the shipped code contradicts. They are preserved as historical record and a lens on the design space; none of them close the 3-layer backend-identity race identified in §Investigation Findings.

### A. Read-meta-under-lock + merge + write (original recommended — **wrong problem**)

Every persist under the lock does a `loadFromDisk(mergeOnly=true)` before writing. Closes the inter-process hole deterministically.

**Pros**: simple conceptual model ("lock + read-merge-write"); no new file artifacts; preserves WAL compaction semantics.
**Cons**: double-read cost per persist (but we already hold the lock, so serialized writes amortize it).

**Amendment verdict**: already shipped at lines 1298–1382. Re-proposing it is a no-op.

### B. WAL-tailing: don't unlink WAL, use offset watermarks — **wrong problem**

Each writer tracks a WAL read offset. Subsequent writers read WAL from their watermark, merge peer entries, advance watermark. WAL never unlinks; compaction rewrites with offset 0.

**Pros**: no extra disk reads during persist.
**Cons**: WAL grows unbounded between full compactions; new "safe compaction" rule required; complicated cross-process offset state.

**Amendment verdict**: doesn't address backend identity flips. If 5 of 6 writers target the main path while 1 targets the sidecar, WAL tailing sees the same mis-partitioned writes.

### C. OS-level file-lock primitive (flock / fcntl) + single-writer serialization — **wrong problem**

Use `flock` instead of the current PID-based `.rvf.lock`. Writers queue; when it's your turn, you re-read everything fresh.

**Pros**: OS guarantees; no application-level protocol risk.
**Cons**: `flock` semantics differ across POSIX/macOS/NFS; Node.js has no built-in binding (needs native addon or external process); breaks the "simple advisory lock file" model ADR-0090 adopted deliberately.

**Amendment verdict**: stronger lock does not repair a backend that silently swallows init errors. A properly-queued pure-TS writer still writes to the wrong path.

### D. Central writer process (daemon) — **wrong problem**

One writer process owns `.rvf`; CLI processes send entries via IPC. Eliminates the race by eliminating concurrency.

**Pros**: perfect correctness.
**Cons**: contradicts ADR-0088 ("daemon in CLI hot path was eliminated in favor of file-based simplicity"); huge scope growth.

**Amendment verdict**: architectural U-turn relative to ADR-0088. Not proportionate given items (a)+(b)+(c) fix the root cause in <200 LOC.

## Recommendation (amended)

Adopt items (a), (b), (c) above as the chosen path — fail-loud native init, unique tmp paths per writer, dedupe RvfBackend per process. Explicit rejections:

- **"Keep silent catch + migrate pure-TS to `.meta` sidecar."** Rejected: makes the two backends co-write to the same file, which accelerates rather than cures the race. Also masks the ADR-0082 violation in `tryNativeInit` — the silent catch would still be a latent silent-fallback hazard for future bugs.
- **"Switch to Linux/macOS flock() or fcntl()."** Rejected: contradicts ADR-0090's deliberate simple-advisory-lock choice; introduces OS-binding complexity (Node has no stdlib `flock`, requires native addon or external binary); does not fix backend identity flips.
- **"Single-writer daemon."** Rejected: contradicts ADR-0088 ("daemon in CLI hot path eliminated in favor of file-based simplicity"); huge scope growth for a bug that has a surgical fix.

## Acceptance criteria

This ADR is Implemented when:

1. **Subprocess race diag.** `scripts/diag-rvf-interproc-race.mjs` exits 0 at N=2, N=4, N=6, N=8 — **40 trials total** (10 per N) across a single cascade run, and 0 trials loud-failed with ENOENT or SFVR-corruption reads. Invocation: `node scripts/diag-rvf-interproc-race.mjs <N> 10`.
2. **Acceptance stability bar (Queen Decision 5).** `t3-2-concurrent` acceptance check passes green for **3 runs per day × 3 consecutive days** against published `@sparkleideas/*` packages. Failure or SKIP on any run resets the counter.
3. **Integration-level subprocess case.** `tests/unit/adr0086-rvf-integration.test.mjs` adds a new case that **spawns 6 subprocesses** (not mocked — real `child_process.spawn` of the installed CLI) with unique keys, and asserts `entryCount === 6` plus all 6 embeddings round-trip retrievable via `cli memory retrieve`. Existing in-process cases must continue to pass unchanged.
4. **Ledger transition.** `BUG-0008` in `docs/bugs/coverage-ledger.md` transitions `regressed` → `verified-green` → `closed` per the ledger state machine, with references to this ADR's amended §Decision and the diag-script run that closed it.
5. **No-pure-TS-on-SFVR invariant (grep/AST guard).** An acceptance guard in `lib/acceptance-adr0095-checks.sh` asserts: if `RvfBackend.metadataPath` resolution traced over a run shows any writer selecting the main `.rvf` path while SFVR bytes exist at that path, the check fails. Implementable as: after the diag run, inspect any `memory.rvf` + `memory.rvf.meta` residue — if the main file contains `SFVR` magic **and** the pure-TS `RVF\0` header coexists, that is a mixed-backend write pattern and the check fails.
6. **No-shared-tmp invariant.** Running `scripts/diag-rvf-interproc-race.mjs --trace` (new flag) emits per-writer tmp-path samples; no two concurrent writers emit the same `.tmp` path. Enforced by inspecting the trace log after each N=8 run.
7. **ADR-0094 Open Item #1** strikes through in `docs/adr/ADR-0094-100-percent-acceptance-coverage-plan.md` with a link to this ADR's amended §Decision.
8. **Subprocess N=6 convergence (new — Pass-2).** All 6 of N=6 `cli memory store` subprocesses exit 0 and the final `.swarm/memory.rvf.meta` has `entryCount === 6`. No writer dies in `initialize()` with `LockHeld`/`FsyncFailed`.
9. **40-trial stability across concurrency matrix (new — Pass-2).** `node scripts/diag-rvf-interproc-race.mjs --trials 40` reaches 40/40 PASS at each of N=2, N=4, N=6, N=8 in a single cascade run.
10. **Clean stderr on parallel writers (new — Pass-2).** No occurrences of `RVF error 0x0300: LockHeld` or `RVF error 0x0303: FsyncFailed` in stderr of 6 parallel `cli memory store` subprocesses. (These were the two dominant fail-loud shapes at Pass-2 Trial t1/t2.)
11. **Integration test greens (new — Pass-2).** `tests/unit/adr0086-rvf-integration.test.mjs` Group 6 (subprocess N=6 test) passes. Currently red at HEAD.
12. **Stability bar on `t3-2-concurrent` (new — Pass-2).** Once Group 6 greens, the existing 3×/day × 3-day stability rule (AC #2) applies specifically to `t3-2-concurrent` before BUG-0008 can transition to `closed`.
13. **Factory cache fires for both call sites (new — Pass-2).** Two guards: (a) grep assertion — `memory-router.ts` contains no `new memMod.RvfBackend` after d2 (only `storage-factory.createStorage` wiring); (b) runtime probe — with d1+d2 landed, `diag-rvf-persist-trace.mjs 6 1` shows exactly ONE `tryNativeInit-entry` per PID (not two as observed pre-d2).

## Risks

- **Fail-loud in `tryNativeInit` may turn transient startup errors into fatal CLI exits.** An `open()` failure due to a peer's in-flight write is a real event. Mitigation: bounded retry (e.g. 3× 50ms) on transient error codes (EBUSY, EAGAIN, short-read / partial-magic detected); typed error check that distinguishes (i) `MODULE_NOT_FOUND` — pure-TS OK; (ii) ENOENT on cold start — pure-TS OK; (iii) transient retryable — bounded retry; (iv) file-present-with-SFVR-magic open-failure after retry — throw. The throw path must include the peer PID list read from `.rvf.lock` to aid diagnosis.
- **Unique tmp path leaks on crash → tmp-dir cleanup drift.** Leftover `*.tmp.PID.N` files accumulate if a writer crashes between `writeFile` and `rename`. Mitigation: reaper at `initialize()` scans `dirname(target)` for `*.tmp.*` files older than 10 minutes and unlinks them. The mtime threshold is conservative — much longer than any legitimate persist — so a running peer's in-flight tmp is never reaped.
- **Per-process RvfBackend cache staleness when a foreign process deletes the file.** Once the cache holds an instance tied to a now-deleted inode, subsequent operations fail with ENOENT. Mitigation: cache-invalidate on ENOENT; re-construct on next call (the cache is a keyed memoization, not ownership). Covered by AC #1 (N=2 with delete-racer is a trivial follow-on probe).
- **Cross-ADR coupling (ADR-0082, ADR-0086, ADR-0088, ADR-0090, ADR-0092).** The amendment makes `tryNativeInit` a new ADR-0082 regression surface (silent-fallback elimination); ADR-0086 Layer-1-storage invariant gains an "SFVR owner" constraint; ADR-0088's "no daemon" guideline is re-affirmed (option D rejected); ADR-0090's advisory-lock choice is re-affirmed (option C rejected); ADR-0092's native/pure-TS coexistence model is tightened from "either backend is fine per call" to "once SFVR, always native-or-refuse." Cross-link notes must be added to each referenced ADR after this amendment ships.
- **d1 cold-start wall-clock grows linearly with N concurrent writers.** Serializing `tryNativeInit` through the advisory lock means only one process runs `reapStaleTmpFiles` → `tryNativeInit` → `loadFromDisk` at a time. Expected hold-time per process is ~10-50ms (native `open` + small meta-read); at N=8 the tail-writer therefore waits ~80-400ms before its own init begins. The existing 5s `acquireLock()` budget absorbs this comfortably up to roughly N=50 serial writers, but the wall-clock penalty is real and user-visible on cold start. **Mitigation**: measure cold-start penalty at N=8 during AC #9 validation and assert `< 5s` total per subprocess. If the budget is exceeded, design review is required — candidates include shortening `loadFromDisk` under lock (move disk IO outside the lock after the native-open phase completes) or introducing a shared-lock/exclusive-lock two-phase acquire. Do NOT raise the 5s budget without re-evaluating stale-holder semantics.
- **Factory cache is per-process; d1 is what closes the inter-process race.** Item (c)'s module-scope `Map<resolvedPath, RvfBackend>` in `storage-factory.ts` lives in each process's own heap — it provides **zero** inter-process coordination. d2 activates this cache on the CLI hot path (reducing 2×-init → 1×-init per process), but the N-process race is closed by d1's advisory-lock serialization, not by any cache. Architects reviewing future ADRs must not conflate "backend-instance dedup" (c/d2, in-process) with "backend-init serialization" (d1, inter-process) — they address orthogonal failure modes. Documented explicitly to prevent future regressions where the cache is assumed to cover inter-process scenarios.

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

## Meta-Regression Probe (2026-04-17 — Sprint-1 probe-writer)

**Append-only. Do not rewrite §Decision.**

Per Queen §E rule 3 + the ADR-0090 lesson that every "accepted trade-off" needs a regression check that fails if the fix stops working, this section documents how to verify each of the three §Amended Decision items (a, b, c) is actually exercised by the probes. Running these rollback experiments should cause the probes to fail loud — confirming the probes are real and not just surface-green.

**Invocation for all rollback experiments**: `node scripts/diag-rvf-interproc-race.mjs --trials 40 --trace`. Expected outputs described below.

### Item (a) rollback — restore silent catch in `tryNativeInit`

**Revert** `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts:635` from the fix to:
```ts
} catch {
  if (this.config.verbose) console.log('[RvfBackend] pure-TS fallback');
  return false;
}
```

**Expected probe output**:
- `diag-rvf-interproc-race.mjs --trials 40`: **FAIL**, `byN[6].passed < 10`. Matrix row `N=6: <10/10 FAIL`. Loss trials show `expected=6 observed=1` with `subproc-fail>0` (some writers crash on SFVR-magic races).
- `tests/unit/adr0086-rvf-integration.test.mjs` Group 6: **FAIL** with `entryCount: 1 (expected 6)` in the diagnostic block. Subproc-failures typically 1-2.
- `--trace` output: multiple TRACE lines with `signals=sawFallback` or `sawSfvrMagic`.

### Item (b) rollback — restore shared tmp path

**Revert** `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts:1450` from the fix to:
```ts
const tmpPath = target + '.tmp';
```

**Expected probe output**:
- `diag-rvf-interproc-race.mjs --trials 40`: **FAIL non-deterministically**; loss trials show `ENOENT ... rename ... .rvf.tmp -> .rvf` in subproc stderr, captured by trace signal `sawRenameErr`. Some trials still pass (race-window dependent).
- Group 6 test: **FAIL** with `metaRaw: n/a` or `metaFound: false` when no writer completed its rename.
- `--trace` leftover-tmp lines may appear after race trials.

### Item (c) rollback — restore double RvfBackend construction

**Revert** the construction-dedupe cache in backend call sites (MemoryManager + controller registry in `agentdb-service.ts`); allow `tryNativeInit` to be invoked twice per `cli memory store` invocation as the investigator trace observed.

**Expected probe output**:
- `diag-rvf-interproc-race.mjs --trials 40`: **FAIL** even at N=2 because intra-process compounding makes the inter-process race detectable at lower concurrency. Matrix `N=2: <10/10 FAIL`.
- `tests/unit/adr0086-rvf-integration.test.mjs` Group 7 (in-process variant): **FAIL** with `foundKeys: <6/6` in the diagnostic — the backend-dedupe invariant is exactly what this test targets.
- `--trace` output: writer stderr may contain `tryNativeInit` doubled per PID.

### Acceptance gate for "fix lands green"

A single probe run where ALL three items are in place should produce:
```
SUMMARY: 40/40 passed, wallclock=<180s
  N=2: 10/10 PASS
  N=4: 10/10 PASS
  N=6: 10/10 PASS
  N=8: 10/10 PASS
OVERALL: PASS
```
AND `tests/unit/adr0086-rvf-integration.test.mjs` Groups 6+7 both green. Any one of the three items reverted should cause at least one of these to fail, per the matrix above. This is the probe-regression invariant for ADR-0095.

### Scope note

The fully-mechanized reverter script (`scripts/verify-rvf-meta-regression.sh --experimental`) was **descoped from Sprint 1** by the probe-writer per the ADR-0098 §E scope discipline: rollback experiments belong to Sprint-2 tooling, not S1 probe delivery. Implementers verifying items (a)/(b)/(c) during their own development loop should perform these rollbacks manually as documented above; the diag script's `--help` text points here for the canonical regression-verification procedure.

## Investigation Findings (2026-04-17/18, Pass 2)

**Append-only per ADR-0094 Maintenance Manifesto rule 1. Do not rewrite §Decision.**

Pass-2 investigator ran against `@sparkleideas/cli@3.5.58-patch.137` — the first version with the full 3-item fix shipped (fork commit `9c5809324`). Empirical result post-publish: `node scripts/diag-rvf-interproc-race.mjs 6 3` → 0/3 pass. The shipped dist contains every amendment (verified: `_tmpCounter`, `reapStaleTmpFiles`, ADR-0095 banner comments, retry-or-throw in `tryNativeInit`, fail-loud corruption in `loadFromDisk`). Yet losses are NOT converging — they are loud-failing. The amendment's §Decision is achieving "fail loud" (ADR-0082 compliance) but not "data converges".

### Enumerated persist paths from `store()` to disk

`routeMemoryOp('store')` (`cli/memory-router.ts:590`) → `_storage.store(entry)` (line 641) → `RvfBackend.store` (`rvf-backend.ts:206`) which does:

1. `this.entries.set()` + `seenIds.add()` + `keyIndex.set()` — in-memory only (line 210-212).
2. `this.nativeDb.ingestBatch()` OR `this.hnswIndex.add()` — index write (line 215-224).
3. `await this.appendToWal(entry)` (line 229) → acquires advisory lock (line 1130), `appendFile(walPath, ...)`, releases.
4. `await this.compactWal()` (line 248) → acquires advisory lock (line 1221), calls `this.persistToDiskInner()`, unlinks WAL, releases.

The autoPersistInterval timer path (line 159) and shutdown path (line 183-186) both funnel into the same `compactWal` / `persistToDisk` entry points. All disk-facing persists reach `persistToDiskInner` under the advisory lock.

### `mergePeerStateBeforePersist` call sites

Exactly **one** call site: `persistToDiskInner` at `rvf-backend.ts:1583` (`await this.mergePeerStateBeforePersist();`). Every `persist()` path (immediate, WAL-compaction, shutdown, auto-interval) goes through `persistToDiskInner`, so the merge runs on every disk write. **H1 is ruled out** — the merge is NOT gated on WAL threshold.

### Native backend path through `persistToDiskInner`

The native backend does NOT bypass `persistToDiskInner`. The native `.rvf` file is managed by `RvfDatabase.ingestBatch()` / `.delete()` / `.query()` (native-internal persistence of vectors). The pure-TS `persistToDiskInner` writes a SEPARATE `.meta` sidecar (line 1214: `metadataPath = nativeDb ? dbPath + '.meta' : dbPath`) containing all entry metadata. So native writers DO go through the merge path for metadata. **H2 is partially ruled out** — native writers reach persist, but only for `.meta`, not the SFVR vector file.

### Lock span

`compactWal` (line 1221) acquires lock → `persistToDiskInner` (line 1223) which calls `mergePeerStateBeforePersist` (line 1583) → reads `.meta` → replays WAL → writes tmp → rename tmp → unlink WAL → returns → `releaseLock` (line 1229). **The lock covers READ + MERGE + WRITE.** H3 is ruled out.

### H1–H6 verdicts (with evidence)

- **H1** (merge only on compactWal, not every persist) — **RULED OUT**. `mergePeerStateBeforePersist` is called unconditionally at the top of `persistToDiskInner` (line 1583). Both `compactWal` and `persistToDisk` route through it. See enumerated paths above.
- **H2** (native backend doesn't use `persistToDiskInner`) — **RULED OUT** for metadata; **IRRELEVANT** for vectors. Native `.rvf` persistence is managed by the `@sparkleideas/ruvector-rvf-node` library's own internal locking; the pure-TS persist path targets `.meta`. The loss observed is not a missed write — it's a failed `tryNativeInit` BEFORE any write starts.
- **H3** (lock spans only WRITE, not READ+MERGE+WRITE) — **RULED OUT**. Code inspection (line 1221-1230 + 1583) + the persist trace show all three phases under one lock span.
- **H4** (merge reads wrong file) — **RULED OUT**. Native-branch reads `.meta` (line 1491); pure-TS branch prefers `.meta` over main (line 1493). Both cases consistent with the write target at line 1214.
- **H5** (persist overwrites by not re-populating from disk) — **RULED OUT**. The merge IS re-populating from disk at lines 1500-1550 (re-reads main/meta raw bytes, parses header, iterates entries, `set-if-not-seen` merge).
- **H6** (lock ordering inverted: read before lock acquire) — **RULED OUT**. Code reads disk only inside `persistToDiskInner → mergePeerStateBeforePersist`, which is invoked AFTER `acquireLock()` in both `compactWal` (line 1221→1223) and `persistToDisk` (line 1454→1456).

### Real root cause (dispositive, with trace)

Under `scripts/diag-rvf-persist-trace.mjs 6 1` (Pass-2 probe, instrumented fork of the published dist), the per-writer trace at N=6 shows every process makes **2 `tryNativeInit-entry` calls** — once with relative `.swarm/memory.rvf`, once with the absolute resolved path (same as the original investigator's trace). Sample for pid 66508:

```
[S1.2-TRACE pid=66508 tryNativeInit-entry {"dbPath":".swarm/memory.rvf"}]
[S1.2-TRACE pid=66508 rvfdb-create-attempt {"dbPath":".swarm/memory.rvf"}]
[S1.2-TRACE pid=66508 tryNativeInit-entry {"dbPath":"/private/var/.../memory.rvf"}]
[S1.2-TRACE pid=66508 tryNativeInit-sfvr-detected ...]
[S1.2-TRACE pid=66508 rvfdb-open-attempt ...]
[S1.2-TRACE pid=66508 rvfdb-open-attempt ...]
[S1.2-TRACE pid=66508 rvfdb-open-attempt ...]
```

**This invalidates the prior claim that ADR-0095 item (c) fixes the 2×-init pattern.** Item (c) added a dedup cache to `forks/ruflo/v3/@claude-flow/memory/src/storage-factory.ts:34`. But the CLI `memory store` path does NOT route through the factory:

- `cli/memory-router.ts:283-292` has its OWN private `createStorage(config)` function that directly does `new memMod.RvfBackend({...})`. It calls `import('@sparkleideas/memory/rvf-backend')` — the class — NOT `import('@sparkleideas/memory/storage-factory')` / `createStorage`.
- Grep verification: `grep -rn "new RvfBackend\|createStorage" v3/@claude-flow/cli/src/memory/` on the fork shows exactly one production `new RvfBackend({...})` at `memory-router.ts:437`, zero imports from `storage-factory.js`.
- Verified in shipped dist: `/tmp/rvf-s1-pass2/node_modules/@sparkleideas/cli/dist/src/memory/memory-router.js:286` instantiates `new memMod.RvfBackend({...})` with no factory involvement.

So **item (c)'s factory cache never fires in the CLI hot path**. The 2×-init is caused by two `RvfBackend` instances being constructed within one CLI process, each independently racing `RvfDatabase.open`/`create`. Call-stack dump (Pass-2 probe with stack-trace patch) identifies both call sites unambiguously:

1. **Call site 1** (relative path `.swarm/memory.rvf`): `cli/memory-router.js:290` in `createStorage` → `_doInit:367` → `routeMemoryOp:428`. This is the private router factory.
2. **Call site 2** (absolute path `/private/tmp/.../.swarm/memory.rvf`): `memory/storage-factory.js:87` in `createStorage` → `controller-registry.js:201` in `ControllerRegistry.initialize` → `memory-router.js:173` (registry-init wrapper) → `_doInit:397`. This is the registry initialization path triggered by `initControllerRegistry()`.

Call site 2 DOES go through the factory cache — but call site 1 does not, and call site 1 uses a relative path while call site 2 uses the absolute one. Even if call site 1 were routed through the factory, the cache key mismatch (relative vs absolute) would require call site 1 to pre-resolve before cache lookup for the dedup to land.

### Observed failure modes at N=6, all three trials

Actual run of `diag-rvf-interproc-race.mjs 6 3 --trace`:

| Trial | pass | fail | entryCount | Error shape |
|-------|-----:|-----:|-----------:|-------------|
| t1 | 1 | 5 | 1 | 5× `RVF error 0x0300: LockHeld` during `RvfDatabase.open` 3×50ms retry |
| t2 | 0 | 6 | null | 6× `RVF error 0x0303: FsyncFailed` during `RvfDatabase.create` |
| t3 | 1 | 5 | 1 | 5× `LockHeld` on open retry; one writer additionally got `bad magic bytes (expected 'RVF\0', got "SFVR")` from `loadFromDisk` pure-TS fallback |

**The one surviving writer per trial writes `.meta` with `entryCount=1` because it's the only process that reached `store()` — the other 5 died in `initialize()` before any data was attempted.**

**The merge protocol is never exercised for the "lost" entries** — they were never written at all. This is fundamentally different from the data-loss model the ADR's original §Decision and its §Amended Decision both presumed. The amendment's item (a) (retry-or-throw) is doing exactly what was specified: the native library's internal lock rejects 5 of 6 concurrent opens with `LockHeld`, the 3×50ms retry gives up, and we throw per the ADR invariant. But "fail loud" is NOT the same as "converge".

### Additional race observed — `FsyncFailed` on cold-start create

Trial t2 showed all 6 writers simultaneously hitting the `create` branch (no pre-existing `.rvf` file) and all 6 getting `RVF error 0x0303: FsyncFailed`. This suggests `RvfDatabase.create` does a directory-level operation (parent dir fsync, maybe lock-file creation in the same dir) that itself races. Even the "cold start" path is not N-safe for native.

### H7 (new) — native RvfDatabase holds an exclusive OS-level lock on the SFVR file

Evidence:
1. `RVF error 0x0300: LockHeld` returned by `@sparkleideas/ruvector-rvf-node`'s `RvfDatabase.open` call when another process has the file open. Not our advisory `.rvf.lock` (that's PID-based and distinct) — this is a native-internal flock/fcntl or similar.
2. Single-writer test (one sequential `cli memory store`): native `create` succeeds cleanly, `.rvf` ends up with SFVR magic (verified: `head -c 4 memory.rvf | xxd` → `5346 5652`). Native owns the file exclusively while the process runs.
3. The advisory `.rvf.lock` from lines 836-890 is orthogonal — it only serializes pure-TS `.meta` writes. It does not gate `tryNativeInit`.

**H7 verdict: CONFIRMED. This is the primary convergence bug.** The native library's exclusive-open lock is incompatible with the "N independent CLI processes each init then write" workflow the CLI assumes. No amount of merge protocol, tmp-path uniqueness, or factory dedup changes this — the 5 losers never reach the merge.

### Proposed minimum-scope fix (next implementer pass)

The amendment's three items are correct but incomplete. The next implementer pass should add **Item (d)** — serialize `tryNativeInit` through the advisory lock, OR fall back to single-writer-at-a-time native init. Concrete options in increasing order of cost:

**Option d1 (minimum scope, ~40 LOC):** Acquire the advisory lock BEFORE `tryNativeInit` inside `initialize()`. Move line 141 (`const hasNative = await this.tryNativeInit();`) under an `await this.acquireLock() / releaseLock()` wrapper. The advisory lock already tolerates stale holders (5s ts threshold, PID liveness check). Serializing native init through it means only ONE writer opens the SFVR file at a time; subsequent writers wait for the lock, THEN attempt `open`. Once the first writer closes (process exit / shutdown), subsequent writers find the lock released and succeed.

- **Target**: `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts:132-170` (the `initialize()` method).
- **Change**: wrap lines 139-154 (from `reapStaleTmpFiles` through `loadFromDisk`) in `acquireLock() / releaseLock()`.
- **Risk**: extends lock hold-time from ~microseconds (WAL append) to ~milliseconds (native-init + loadFromDisk). With 5s acquire budget, this is acceptable up to maybe N=20 serial writers. Not a scalability silver bullet but resolves N=6.

**Option d2 (scope: ~20 LOC beyond d1):** Also wire the CLI's private `createStorage` in `cli/memory-router.ts:283-292` through `storage-factory.createStorage()` — a one-line `await import('@sparkleideas/memory/storage-factory').then(m => m.createStorage({...}))` swap. This activates item (c)'s existing factory cache so the 2×-init becomes 1×-init per process. Complements (d1) — fewer native-init collisions because fewer invocations.

**Option d3 (scope: rewrite):** Teach the RvfBackend to run without native when another process holds the native lock. Requires dual-mode metadata writes, which violates the ADR invariant "once SFVR, always native-or-refuse". Not recommended.

**Minimum recommendation for next pass**: d1 + d2 together. Both are small (<100 LOC total), deterministically close the race at N=6, and don't introduce new invariants. Test with `diag-rvf-interproc-race.mjs --trials 40` — should show 40/40 PASS.

### Instrumentation delivered

- `scripts/diag-rvf-persist-trace.mjs` — instruments the shipped `@sparkleideas/memory/dist/rvf-backend.js` in a throwaway harness via text-replacement, emits `[S1.2-TRACE pid=<pid> <tag> <json>]` lines to stderr for every RvfBackend internal step (module load, `tryNativeInit-entry`, SFVR peek result, `rvfdb-open-attempt`, `rvfdb-create-attempt`, `store-entry`, `appendToWal-entry`, `compactWal-entry`, `persistToDiskInner-entry`, `mergePeerStateBeforePersist-entry`, `acquireLock-enter/-granted`, `releaseLock`).
- **Usage**: `node scripts/diag-rvf-persist-trace.mjs [N] [trials]` — default N=6, trials=1.
- **Non-destructive**: patches a scratch copy of the CLI install in `/tmp/rvf-persist-trace-harness-*`; never touches fork source.
- **Output**: traces to stderr, 8 lines per writer in summary. Count is reported (`traceLines=N`); first 8 lines plus last error line shown.
- **Runtime**: ~5-10s for N=6 × 1 trial. Harness reuse omitted — each run rebuilds to ensure clean instrumentation state.

Verified captures in `/tmp/probe-persist-trace-t1.log` show the 2× `tryNativeInit` pattern, the `rvfdb-open-attempt` retry triplet, the `LockHeld`/`FsyncFailed` error shapes, and the single-surviving-writer signature. These samples are ≥ sufficient for Sprint-2 implementer to validate d1/d2 against.
