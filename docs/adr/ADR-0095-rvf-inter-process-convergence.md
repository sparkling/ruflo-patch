# ADR-0095: RVF Inter-Process Write Convergence

- **Status**: **Implemented** (2026-04-20) — all of items a+b+c+d1+d2+d3+d4+d5+d6+d8+d10+d11 landed; t3-2-concurrent passes deterministically in full acceptance across three consecutive runs (2026-04-19 10:45Z, 2026-04-19 12:46Z, 2026-04-20 10:43Z). BUG-0008 closed.
- **Date**: 2026-04-17 (authored), 2026-04-17 (amended after Sprint-1 investigation), 2026-04-18 (amended after Sprint-1.2 Pass-2 investigation — items d1+d2 appended), **2026-04-20 (Implemented — d11 fsync-before-rename closed the mega-parallel silent-loss tail)**
- **Scope**: `v3/@claude-flow/memory/src/rvf-backend.ts` — `tryNativeInit` (line 605), `persistToDiskInner` (line 1384 — specifically the shared-tmp-path at line 1450), backend construction call sites (MemoryManager + controller registry). `mergePeerStateBeforePersist` is explicitly **out of scope** for this ADR — the shipped implementation (lines 1298–1382) already does what the original §Decision proposed.
- **Forked from**: ADR-0094 Open Item #1
- **Related**: ADR-0086 (Storage Layer), ADR-0090 B7 (in-process multi-writer fix), ADR-0092 (native/pure-TS coexistence), ADR-0082 (no silent fallbacks), ADR-0088 (no daemon in CLI hot path), BUG-0008 (ledger)

## Changelog

- **2026-04-17 (authored)** — Proposed "read-meta-under-lock + merge + write" protocol.
- **2026-04-17 (amended, same day)** — Sprint-1 investigator (`f4dd1ec`) established that the proposed protocol is already implemented at lines 1298–1382 and does not close the observed inter-process data-loss bug. Real root cause is a **3-layer backend flip race**: (1) silent catch in `tryNativeInit` (line 635) masks native-init races so 5 of 6 concurrent writers silently fall back to pure-TS (ADR-0082 violation); (2) native writers target the `.meta` sidecar while pure-TS writers target the main `.rvf` path — disjoint write targets mean the peer-merge never sees peer writes; (3) shared `.rvf.tmp` path at line 1450 causes cross-process `rename()` ENOENT collisions and transient SFVR-corruption reads. Amended §Decision replaces the merge-protocol proposal with a three-item program: fail-loud on native init once SFVR bytes exist, per-writer unique tmp paths, and dedupe RvfBackend construction per process. See §Investigation Findings (appended below) for the dispositive trace.
- **2026-04-18 (amended, Sprint-1.2 Pass-2)** — Pass-2 investigator (`ef5d357`) validated items (a)+(b)+(c) landed in `@sparkleideas/cli@3.5.58-patch.137` (fork `9c5809324`), confirmed in-process N=6 now PASSES, but subprocess N=6 still fails with `entryCount=1/6`. Root cause of the residual loss is **H7**: the native `RvfDatabase` holds an exclusive OS-level lock on the SFVR file during `open`/`create`. At N=6 only one writer acquires the native lock; the other 5 fail LOUDLY (item a working as designed) with `RVF error 0x0300: LockHeld` or `0x0303: FsyncFailed` inside `initialize()` — **before** any `store()` call, so the merge protocol is never reached. Item (c)'s factory cache does NOT fire on the CLI hot path because `cli/memory-router.ts:435-443`'s private `createStorage` bypasses `@sparkleideas/memory/storage-factory`. Amendment appends items **d1** (serialize `tryNativeInit` through the advisory lock) and **d2** (route the CLI's private `createStorage` through the shared factory). Items (a)/(b)/(c) stand unchanged.
- **2026-04-18 (amended, Sprint-1.3 Pass-3)** — Pass-3 investigator (`b16efcc`) validated items (a)+(b)+(c)+(d1)+(d2) landed in `@sparkleideas/cli@3.5.58-patch.139` (fork `3fe71b9c7`). 40-trial matrix now shows 23/40 PASS (up from 0/3 at Pass-2 baseline) — substantial progress, but 17/40 FAIL survive as two distinct residual modes. Error-unwrap instrumentation on `storage-factory.ts` dispositively identifies **H8** (17/17 cold-start failures are `ENOENT` on `.swarm/memory.rvf.lock` because `acquireLock` at `rvf-backend.ts:882` does `writeFile(…, {flag:'wx'})` without first `mkdir(dirname(lockPath),{recursive:true})`) and **H14** (rare silent mixed-backend loss at `entryCount=3..5/6`: `tryNativeInit`'s "pure-TS-owned-file" branch at `rvf-backend.ts:753-764` silently accepts zero-byte files and already-clobbered `RVF\0` files as legitimate pure-TS targets, then pure-TS writes land on `.rvf` while native writes land on `.meta` — disjoint-target merge sees only one population). Amendment appends items **d3** (acquireLock mkdirs dirname before wx-open) and **d4** (tighten tryNativeInit invariant so only genuine `RVF\0` qualifies as pure-TS-owned; short reads and unknown magic throw). Secondary fix bundled with d3/d4: `storage-factory.ts:154` rewrap preserves `err.cause` so the opaque `[StorageFactory] Failed to create storage backend` message stops masking the real ENOENT. Items (a)/(b)/(c)/(d1)/(d2) stand unchanged.

- **2026-05-01 (amended, Swarm-2 final fix — d12+d13+d14)** — Despite the 2026-04-20 "Implemented" status, latent contention reappeared after the 2026-04-29 upstream-merge cycle: cli@patch.282 baseline produced **0/40** on `scripts/diag-rvf-interproc-race.mjs --trials 40` (covering N=2,4,6,8 × 10). Two independent 10-agent swarms (one per round) and two cycles of fix-and-verify converged on the actual root cause: **the native `RvfStore::create` path opens `path` with `OpenOptions::create_new(true)` BEFORE acquiring `WriterLock::acquire(path)`** (`forks/ruvector/crates/rvf/rvf-runtime/src/store.rs:83-90`). Two cold-start peers race the bare-file create unsynchronised; the loser gets EEXIST mapped to `FsyncFailed (0x0303)` and dies fatally at attempts=1 (the JS-side retry budget only handles `LockHeld 0x0300`). Empirically confirmed by instrumented `RVF_DIAG=1` capture of failed trial t4 at N=4 showing writer-3 stderr `RVF error 0x0303: FsyncFailed` at `attempts=1, elapsed=0ms` while writer-1 wrote `.meta` cleanly — exactly the asymmetry that produced "fast 1.5s failures" vs "slow 3.5s passes" and "N=8 perfect / N≤6 leaks" pattern. Items: **d12** (replace native `WriterLock` O_CREAT|O_EXCL PID-file design with kernel `flock(LOCK_EX)` on a never-unlinked sibling + process-local refcount map; `forks/ruvector/crates/rvf/rvf-runtime/src/locking.rs` rewritten); **d13** (JS `.jslock` made re-entrant via `_lockHeldDepth` counter so `store()` holds the lock across in-mem mutate + WAL append + WAL compact in one atomic critical section); **d14** (native `RvfStore::create` reordered to take flock BEFORE `OpenOptions::create_new`; if file exists post-flock, return `LockHeld` so JS dispatcher in `tryNativeInit` retries as `RvfDatabase.open()` which goes through the same flock queue). Result: cli@patch.302 produces **40/40 PASS** on the diag matrix at all N=2,4,6,8 with no silent loss. Items (a)/(b)/(c)/(d1)/(d2)/(d3)/(d4)/(d5)/(d6)/(d8)/(d10)/(d11) stand unchanged. Status returns to **Implemented** (2026-05-01).

- **2026-05-02 (test marker amendment, ADR-0113 unskip program)** — The "subprocess N=6" test (`tests/unit/adr0086-rvf-integration.test.mjs:632`) carried a Pass 2 marker check asserting that `this.acquireLock(` appears BEFORE `this.reapStaleTmpFiles(` within the published dist's `initialize()` body. That ordering was the **d1 design** (lock the entire init sequence). The 2026-05-01 swarm-2 amendment INVERTED that ordering — the new design runs `reapStaleTmpFiles` FIRST (no JS lock; idempotent + race-tolerant) and `tryNativeInit` SECOND (uses the new kernel-flock-based native lock from d12), with `acquireLock` scoped THIRD around `loadFromDisk` only. The d1-style "lock everything around the native flock acquire" pattern was itself the t3-2 silent-loss vector ("writer A holds JS lock while waiting for native flock, blocking all peers' JS lock acquisitions"). Since `cli@patch.302` (and the currently-published `@sparkleideas/memory@3.0.0-alpha.13-patch.317`) ships the swarm-2 ordering, the d1-ordering marker check returns FALSE and the test silently skipped via `SKIP_T3_2_BOOTSTRAP=1`. **Resolution:** marker check dropped (commit `3f74b37`); only the Pass 1 markers (`reapStaleTmpFiles` + `_tmpCounter`, present in both d1 and swarm-2 dists) remain. The test now runs end-to-end against the swarm-2 dist and PASSES (entryCount === 6 in 38s standalone). Both designs satisfy the entryCount invariant; gating on a particular design's source-text ordering was wrong. The Pass 2 marker check was an artifact of the d1 era and should not have survived the swarm-2 amendment.

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

#### d3. `acquireLock` mkdirs `dirname(lockPath)` before the wx-open

**Target**: `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts:872-912` — specifically BEFORE the `writeFile(this.lockPath, …, {flag:'wx'})` at line 882. `acquireLock()` is the first filesystem syscall of `initialize()`; the `wx` flag opens with `O_CREAT | O_EXCL` and returns `ENOENT` (not `EEXIST`) when the lockfile's **parent directory** (`.swarm/`) does not exist. The catch at line 885 only retries on `EEXIST`; ENOENT rethrows fatal. Pass-3 error-unwrap confirmed this is the mechanism behind all 17/17 cold-start failures. No existing code path in `initialize` / `acquireLock` / `reapStaleTmpFiles` / `tryNativeInit` mkdirs the parent before this first write. `appendToWal` does mkdir-before-acquire (lines 1150-1151), but it runs only after `store()`, which runs only after `initialize()` succeeds — by then the cold-start ENOENT has already thrown.

**Current code** (quoted for the implementer):

```ts
// line 872
private async acquireLock(): Promise<void> {
  if (!this.lockPath) return; // :memory: mode
  const { writeFile: wf, readFile: rf, unlink: ul } = await import('node:fs/promises');
  const maxWaitMs = 5000; // total budget for lock acquisition
  // ...
  while (Date.now() - startTime < maxWaitMs) {
    try {
      await wf(this.lockPath, JSON.stringify({ pid: process.pid, ts: Date.now() }), { flag: 'wx' }); // line 882
      return; // Lock acquired
    } catch (e: any) {
      if (e.code !== 'EEXIST') throw e;   // line 885 — rethrows ENOENT fatal
      // ...
```

**Expected behavior** after amendment: one-line idempotent `mkdir(dirname(lockPath), {recursive:true})` before the retry loop begins, with a swallowed catch (the mkdir can only fail for reasons that the subsequent `wx`-open would also surface, and `{recursive:true}` already swallows `EEXIST` internally):

```ts
private async acquireLock(): Promise<void> {
  if (!this.lockPath) return; // :memory: mode
  const { writeFile: wf, readFile: rf, unlink: ul, mkdir: mk } = await import('node:fs/promises');
  // ADR-0095 d3: ensure parent dir exists before the wx-open. Cold-start race
  // where N writers hit initialize() before `.swarm/` has been mkdired by any
  // prior process. `{recursive:true}` is racy-safe — concurrent mkdirs either
  // succeed or silently no-op on EEXIST, handled inside Node's fs layer.
  const lockDir = dirname(this.lockPath);
  try { await mk(lockDir, { recursive: true }); } catch {}
  const maxWaitMs = 5000;
  // ... rest unchanged
```

**Why this closes the bug**: `{recursive:true}` mkdir is idempotent and concurrent-safe on POSIX/APFS; whichever writer wins the mkdir race, every peer's next `wx` `writeFile` either succeeds (first lockfile creator) or `EEXIST`s into the existing retry-after-stale-check loop. The ENOENT failure path is removed entirely. Closes H8 / 17/17 cold-start ENOENT failures.

#### d4. Tighten `tryNativeInit` invariant: only genuine `RVF\0` qualifies as pure-TS-owned

**Target**: `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts:753-764` — the "Cold start: no file yet, or file without SFVR magic (pure-TS-owned)" fallback. Item (a)'s "once SFVR, always native-or-refuse" invariant is enforced only when `bytesRead === 4 && peek === 'SFVR'`. Pass-3 per-writer byte-level peek traces show two other states silently fall through to pure-TS and clobber a peer's native-init:

1. **Valid `RVF\0` content** (`bytesRead === 4 && peek === 'RVF\0'`) — legitimate pure-TS file. **Safe.**
2. **Zero-byte file** (`fileExists && bytesRead < 4`) — mid-write transient between `creat()` and SFVR header emit by a peer's `RvfDatabase.create`. Pure-TS writes `RVF\0` on top, corrupting the peer's native init. **Unsafe.**
3. **Previously-SFVR file now holding `RVF\0`** (`bytesRead === 4 && peek !== 'RVF\0' && peek !== 'SFVR'`, OR `RVF\0` when a prior peer race already clobbered it) — a prior race corrupted SFVR with a pure-TS write; this writer then propagates the corruption. **Unsafe.**

States (2) and (3) silently exit via the current pure-TS fallback — `mergePeerStateBeforePersist` then reads EITHER `.meta` (native) OR `.rvf` (pure-TS) but never both, because the two populations wrote to disjoint targets. Observed in Pass-3 trials with `entryCount=3..5/6` where all N subprocs exit 0 but half the entries are invisible to any single read path.

**Expected behavior** after amendment: classify the file's exact state under the advisory lock (which item d1 already guarantees is held here) and throw on the non-RVF\0-non-SFVR states rather than silently falling back:

```ts
// ADR-0095 d4: empty files / partial-SFVR writes / unknown magic are a
// peer's mid-write race — pure-TS fallback would corrupt native state.
// Only genuine RVF\0 content qualifies as "pure-TS owns this".
if (fileExists(this.config.databasePath)) {
  if (!hasNativeMagic) {
    const fd = openSync(this.config.databasePath, 'r');
    let magicBytes = Buffer.alloc(4);
    let br = 0;
    try { br = readSync(fd, magicBytes, 0, 4, 0); } finally { closeSync(fd); }
    if (br < 4) {
      throw new Error(
        `[RvfBackend] ${this.config.databasePath} exists but has only ${br} bytes ` +
        `(peer's native init mid-write). Refusing pure-TS fallback to avoid ` +
        `clobbering SFVR file. Advisory lock should have serialized — ` +
        `this indicates a lock-ordering bug.`,
      );
    }
    const peek = String.fromCharCode(magicBytes[0], magicBytes[1], magicBytes[2], magicBytes[3]);
    const expectedPureTS = String.fromCharCode(0x52, 0x56, 0x46, 0x00); // 'RVF\0'
    if (peek !== expectedPureTS) {
      throw new Error(
        `[RvfBackend] ${this.config.databasePath} has unknown magic ${JSON.stringify(peek)} ` +
        `(not RVF\\0, not SFVR). Refusing to overwrite — likely foreign/corrupt file.`,
      );
    }
    // Genuine pure-TS RVF\0 — fall through to return false.
  }
  return false;
}
```

**Bundled secondary fix (same commit) — preserve `err.cause` in the StorageFactory rewrap**: `forks/ruflo/v3/@claude-flow/memory/src/storage-factory.ts:154` currently serializes `primaryError.message` only and discards `.code`, `.stack`, `.cause`. The visible message is the generic `[StorageFactory] Failed to create storage backend … Verify the database path is writable and dependencies are installed.` — which is literally false when the failure is ENOENT on the `.swarm/` parent dir (path IS writable; dir just didn't exist). Pass-3 H9 confirmed this rewrap meaningfully impeded debugging. Expected change: attach `primaryError` as `cause` on the new `Error` (and include the `code` in the top-line message so users never need to inspect `err.cause` to know what broke):

```ts
  } catch (primaryError: unknown) {
    const msg = primaryError instanceof Error ? primaryError.message : String(primaryError);
    const code = (primaryError as any)?.code;
    const wrapped = new Error(
      `[StorageFactory] Failed to create storage backend.\n` +
      `  Path: ${rvfPath}\n` +
      `  Dimensions: ${dimensions}\n` +
      `  Cause${code ? ` (${code})` : ''}: ${msg}\n…`,
    );
    (wrapped as any).cause = primaryError;
    throw wrapped;
  }
```

**Why this closes the bug**: with d3 ensuring the parent dir exists and d1 serializing init through the advisory lock, a peer should never be mid-native-write at peek time. Under d1's invariant, every state observed by `tryNativeInit` under the lock is a completed state — so `bytesRead < 4` or an unknown-magic peek is evidence of either a prior uncaught race (genuine bug surface) or a foreign/corrupted file (refuse-to-touch is the correct semantic per ADR-0082). Closes H14 / silent mixed-backend loss. The `err.cause` preservation closes H9's partial-confirmation by making the real root cause visible to callers without re-instrumenting the backend.

### Why these seven items, together

Items (a)+(b)+(c)+(d1)+(d2)+(d3)+(d4) form a closed set targeting seven distinct failure layers:
- (a) prevents silent identity flip on transient native-init error (ADR-0082 compliance).
- (b) eliminates the shared-tmp-path rename race (file-system-level, orthogonal to backend choice).
- (c) provides in-process backend-instance dedup (module-scope `Map` in the factory).
- (d1) serializes inter-process native-init through the advisory lock, closing H7's exclusive-OS-lock race.
- (d2) wires the CLI's private `createStorage` into (c)'s cache, halving native-init invocations per process.
- (d3) mkdirs the lockfile's parent before the wx-open, closing H8's cold-start ENOENT (17/17 failures at Pass-3 baseline).
- (d4) tightens the `tryNativeInit` pure-TS-owned branch to accept only genuine `RVF\0` content, closing H14's silent mixed-backend loss where zero-byte and previously-clobbered files were being silently overwritten.

Removing any one item leaves a non-deterministic leak path visible in `scripts/diag-rvf-interproc-race.mjs`. Specifically: without d1, N=6 shows `LockHeld`/`FsyncFailed` cascades (Pass-2 trials t1-t3); without d2, the 2×-init amplifies d1's lock-queue depth and can trip the 5s acquire budget at higher N; without d3, cold-start trials ENOENT on `.swarm/memory.rvf.lock` with zero writers able to acquire (Pass-3 matrix 17/40 FAIL); without d4, ~3/40 trials silently end with `entryCount<N` because pure-TS writers clobber SFVR state or write to a disjoint target undetected.

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
14. **No `ENOENT` in subprocess stderr at cold start (new — Pass-3).** At N=2, N=4, N=6, N=8 starting from a fresh directory with no prior `cli init` and no pre-existing `.swarm/`, zero subprocesses emit `ENOENT` (any path) to stderr during `initialize()`. Invocation: `rm -rf .swarm && node scripts/diag-rvf-interproc-race.mjs <N> 10 --trace | grep -c 'ENOENT'` returns 0 for each N. Verifies d3 landed on the cold-start `.swarm/memory.rvf.lock` ENOENT path; regression-guards against any future code path reintroducing a filesystem syscall before a mkdir.
15. **No silent loss — `entryCount===N` AND zero subproc failures on every trial (new — Pass-3).** Across 40 trials per N (matrix N=2/4/6/8), every trial records BOTH `entryCount===N` in the final `.meta` AND `subproc-failures===0` in the trial summary. Zero trials may have `entryCount<N` paired with zero subproc failures (the silent-mixed-backend signature). Closes H14. Implemented as an assertion in `scripts/diag-rvf-interproc-race.mjs`'s trial-accumulator: if any trial shows `entryCount<N && subprocFailures===0`, exit non-zero with a dedicated `SILENT_LOSS` signal.
16. **Error cause preserved through StorageFactory rewrap (new — Pass-3).** Any `[StorageFactory] Failed to create storage backend` thrown by `storage-factory.ts:155` carries `err.cause` set to the underlying primary error, and the top-line message includes the cause's `code` when present. Verifiable two ways: (a) unit test — force-failure with a stubbed `RvfBackend.initialize` that throws `{code:'ENOENT'}` and assert the outer error's `.cause.code === 'ENOENT'`; (b) runtime probe — `diag-rvf-persist-trace.mjs` with d3 reverted shows `factory-createStorage-catch` traces where the outer wrapped error's message contains the literal string `ENOENT` (not just the generic "verify the database path is writable" text). Closes H9.

## Risks

- **Fail-loud in `tryNativeInit` may turn transient startup errors into fatal CLI exits.** An `open()` failure due to a peer's in-flight write is a real event. Mitigation: bounded retry (e.g. 3× 50ms) on transient error codes (EBUSY, EAGAIN, short-read / partial-magic detected); typed error check that distinguishes (i) `MODULE_NOT_FOUND` — pure-TS OK; (ii) ENOENT on cold start — pure-TS OK; (iii) transient retryable — bounded retry; (iv) file-present-with-SFVR-magic open-failure after retry — throw. The throw path must include the peer PID list read from `.rvf.lock` to aid diagnosis.
- **Unique tmp path leaks on crash → tmp-dir cleanup drift.** Leftover `*.tmp.PID.N` files accumulate if a writer crashes between `writeFile` and `rename`. Mitigation: reaper at `initialize()` scans `dirname(target)` for `*.tmp.*` files older than 10 minutes and unlinks them. The mtime threshold is conservative — much longer than any legitimate persist — so a running peer's in-flight tmp is never reaped.
- **Per-process RvfBackend cache staleness when a foreign process deletes the file.** Once the cache holds an instance tied to a now-deleted inode, subsequent operations fail with ENOENT. Mitigation: cache-invalidate on ENOENT; re-construct on next call (the cache is a keyed memoization, not ownership). Covered by AC #1 (N=2 with delete-racer is a trivial follow-on probe).
- **Cross-ADR coupling (ADR-0082, ADR-0086, ADR-0088, ADR-0090, ADR-0092).** The amendment makes `tryNativeInit` a new ADR-0082 regression surface (silent-fallback elimination); ADR-0086 Layer-1-storage invariant gains an "SFVR owner" constraint; ADR-0088's "no daemon" guideline is re-affirmed (option D rejected); ADR-0090's advisory-lock choice is re-affirmed (option C rejected); ADR-0092's native/pure-TS coexistence model is tightened from "either backend is fine per call" to "once SFVR, always native-or-refuse." Cross-link notes must be added to each referenced ADR after this amendment ships.
- **d1 cold-start wall-clock grows linearly with N concurrent writers.** Serializing `tryNativeInit` through the advisory lock means only one process runs `reapStaleTmpFiles` → `tryNativeInit` → `loadFromDisk` at a time. Expected hold-time per process is ~10-50ms (native `open` + small meta-read); at N=8 the tail-writer therefore waits ~80-400ms before its own init begins. The existing 5s `acquireLock()` budget absorbs this comfortably up to roughly N=50 serial writers, but the wall-clock penalty is real and user-visible on cold start. **Mitigation**: measure cold-start penalty at N=8 during AC #9 validation and assert `< 5s` total per subprocess. If the budget is exceeded, design review is required — candidates include shortening `loadFromDisk` under lock (move disk IO outside the lock after the native-open phase completes) or introducing a shared-lock/exclusive-lock two-phase acquire. Do NOT raise the 5s budget without re-evaluating stale-holder semantics.
- **Factory cache is per-process; d1 is what closes the inter-process race.** Item (c)'s module-scope `Map<resolvedPath, RvfBackend>` in `storage-factory.ts` lives in each process's own heap — it provides **zero** inter-process coordination. d2 activates this cache on the CLI hot path (reducing 2×-init → 1×-init per process), but the N-process race is closed by d1's advisory-lock serialization, not by any cache. Architects reviewing future ADRs must not conflate "backend-instance dedup" (c/d2, in-process) with "backend-init serialization" (d1, inter-process) — they address orthogonal failure modes. Documented explicitly to prevent future regressions where the cache is assumed to cover inter-process scenarios.
- **d3 adds an extra mkdir syscall per cold-start `acquireLock`.** `mkdir(dirname(lockPath), {recursive:true})` silently succeeds (no-ops internally) when the directory already exists — this is the correct behavior, but it adds one extra filesystem syscall per lock acquire. Measured cost: <1ms on APFS (cache-warm) and ~1-3ms on first-ever invocation (cache-cold directory). This is well under the d1 risk bullet's 10-50ms budget and several orders of magnitude under the 5s `acquireLock` wall-clock budget. Acceptable. Mitigation not required; if future profiling ever surfaces this as a hot-path cost, the mkdir can be gated behind a "has-run-once-in-this-process" flag — but the current price is too small to justify the complexity.
- **d4's stricter invariant converts silent losses into loud cold-start retries.** The pre-d4 behavior accepted zero-byte and unknown-magic states as "pure-TS owns this" and silently fell through; now those states throw. For the primary happy path (d1 serializes init, so no peer is ever mid-write at peek time), this throw never fires — d4 is a defense-in-depth invariant. For the edge case where d1 somehow fails to fully serialize (lock stolen by a stale-PID detection that mis-fires, for example), d4's throw surfaces the bug as a noisy `cli memory store` exit=1 rather than a silent `entryCount<N`. The net is **fewer silent corruptions at the cost of more loud cold-start retries** (the CLI caller should retry the full `cli memory store` on such a throw; acceptance-check harnesses already tolerate this via their subprocess-failure counting). **Mitigation**: d3 + d4 land together in the same commit — d3 prevents the vast majority of zero-byte files d4 rejects, so the practical throw rate is negligible. If d4 throws are observed above 1% of trials at N=8 in AC #15 validation, re-open the lock-ordering question before adopting d4 in production.

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

## Investigation Findings (2026-04-17/18, Pass 3)

**Append-only per ADR-0094 Maintenance Manifesto rule 1. Do not rewrite §Decision.**

Pass-3 investigator ran against `@sparkleideas/cli@3.5.58-patch.139` (Pass-2 target with items a/b/c/d1/d2 shipped, fork `3fe71b9c7`). 40-trial matrix (Pass-2 harness) showed 23/40 PASS, 17/40 FAIL split into two distinct failure modes. Pass-3 extended `scripts/diag-rvf-persist-trace.mjs` with error-unwrap instrumentation on `storage-factory.js` + byte-level peek logging in `tryNativeInit`, then reproduced both failure modes deterministically.

### Error unwrap — the real cause behind `[StorageFactory] Failed to create storage backend`

Pass-3 added a `factory-createStorage-catch` trace immediately before the re-wrap at `forks/ruflo/v3/@claude-flow/memory/src/storage-factory.ts:151-164`. This surfaces the `primaryError.code` + `.stack` that the shipped wrapper's `.message`-only serialization discards.

Every cold-start failure (17/17 across the matrix) unwraps to the **same** error:

```
Error: ENOENT: no such file or directory, open '.../.swarm/memory.rvf.lock'
  at async open (node:internal/fs/promises:640:25)
  at async writeFile (node:internal/fs/promises:1253:14)
  at async RvfBackend.acquireLock (rvf-backend.js:884:17)
  at async RvfBackend.initialize (rvf-backend.js:122:9)
  at async Module.createStorage (storage-factory.js:97:9)
```

The `acquireLock()` at `rvf-backend.ts:872-912` does `writeFile(this.lockPath, ..., { flag: 'wx' })` as its very first filesystem operation (line 882). The `wx` flag opens with `O_CREAT | O_EXCL` — on macOS APFS this `open(2)` call ENOENTs when the **parent directory** (`.swarm/`) does not exist. The catch block at line 884-886 discriminates on `e.code !== 'EEXIST'` and rethrows ENOENT as fatal. The throw propagates up through `initialize()` → `createStorage()` → re-wrapped into the opaque `[StorageFactory] Failed to create storage backend` message.

**Why the dir sometimes doesn't exist**: `cli init --full` is non-deterministic about creating `.swarm/` — in a 5-run verification only 1 of 5 invocations produced `.swarm/memory.db`; the other 4 produced no `.swarm/` directory at all. No code path in `initialize()` / `acquireLock()` / `reapStaleTmpFiles()` / `tryNativeInit()` does `mkdir(dirname(lockPath), {recursive:true})` before the lockfile `writeFile`. `appendToWal` DOES mkdir-before-acquireLock (lines 1150-1151), but it only runs AFTER `store()`, which runs AFTER `initialize()` succeeds. By then the cold-start ENOENT already threw.

**Passing trials survived by luck**: one of the N writers (whoever reaches `acquireLock` after controller-registry's `cli init --full` happened to create `.swarm/memory.db` a millisecond ago, or because a prior writer's `appendToWal` raced a mkdir in) successfully creates the lockfile; peers then retry EEXIST → wait → succeed. Failing trials have `.swarm/` never created by anyone and all N peers simultaneously ENOENT.

### H8–H13 verdicts (with evidence)

- **H8** — Lock-file `writeFile(.rvf.lock, {wx:true})` ENOENTs when parent dir doesn't exist. **CONFIRMED + DISPOSITIVE**. Error unwrap above shows ENOENT on the lockfile's `open()` syscall in all 17 cold-start failures. Root cause is `acquireLock` lacks `mkdir(dirname(lockPath), {recursive:true})` before `writeFile`.
- **H9** — StorageFactory catch strips underlying error. **PARTIALLY CONFIRMED**. The catch at `storage-factory.ts:151` preserves `primaryError.message` but discards `.code`, `.stack`, `.cause.code`. The user-visible error is the generic `[StorageFactory] Failed to create storage backend` followed by `Both native Rust HNSW and pure-TS fallback failed. Verify the database path is writable and dependencies are installed.` — which is literally false (the path IS writable; the dir just doesn't exist). This is a secondary diagnostic bug: the wrapper should preserve `err.cause = primaryError` so callers can inspect the code. Not the root cause but meaningfully impedes debugging.
- **H10** — `acquireLock` 5s budget too tight under cold-start contention. **RULED OUT**. Zero `acquireLock-budget-exhausted` traces fired across 40 trials (288 `acquireLock-granted` observations, max `waitMs=187`). The ENOENT path fires BEFORE the retry loop is even entered — the very first `writeFile` call throws.
- **H11** — `path.resolve()` in d2 produces different resolutions than controller-registry. **RULED OUT**. Every trace shows both CLI call sites now emit the same absolute `/private/var/folders/.../memory.rvf` path (d2 shipped correctly). Factory-cache-key mismatch from Pass-2 is resolved.
- **H12** — `reapStaleTmpFiles` ENOENTs on non-existent dir. **RULED OUT**. The source code at `rvf-backend.ts:809-842` wraps `readdir(dir)` in a try/catch that returns early on failure (lines 820-824: `try { entries = await readdir(dir); } catch { return; }`). No throw reaches the outer lock span. Pass-3 grep for `reapStaleTmpFiles-enter` traces confirms this is reached only after `acquireLock` succeeds — irrelevant to the ENOENT failure path.
- **H13** — separate race at WAL layer. **RULED OUT**. WAL's `appendToWal` (lines 1141-1159) does mkdir-before-acquireLock (line 1151). Zero WAL-related errors across 40 trials.

### Root cause of cold-start race (definitive)

**File**: `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts`
**Line**: 882 (`writeFile(this.lockPath, ..., { flag: 'wx' })`)

The advisory lock's first write is the first filesystem syscall of `initialize()`. When `dirname(this.lockPath)` (i.e. `.swarm/`) doesn't exist, `wx`-mode open returns ENOENT, and the catch discriminator at line 885 (`if (e.code !== 'EEXIST') throw e;`) rethrows it. The ENOENT propagates through `initialize` → `createStorage` into the opaque factory wrapper. All N writers fail simultaneously because none of them mkdir the parent.

### Root cause of silent 4/6 (and 3/6, 5/6) loss case — separate hypothesis H14

Pass-3 hit the rare silent-loss case in 3 of 35 trials (entryCount=4, 5, 3 respectively). Per-writer trace from trial t9 (`N=6, entryCount=3`, all 6 subprocs exit≥0) reveals the mechanism. Byte-level `tryNativeInit-peek-result` instrumentation gives each writer's observed first 4 bytes of `memory.rvf`:

| Writer | Peek bytes | peekStr | Path taken | Final write target |
|---|---|---|---|---|
| 1 | `53 46 56 52` | `SFVR` | open-native (success) | `.meta` |
| 2 | `52 56 46 00` | `RVF\0` | `return false` ("pure-TS-owned-file") | **`.rvf` (!!)** |
| 3 | 0 bytes read | `(short)` | `return false` ("pure-TS-owned-file") | **`.rvf` (!!)** |
| 4 | `SFVR` | `SFVR` | open-native | `.meta` |
| 5 | `SFVR` | `SFVR` | open-native, retry 3×, **LockHeld throw**, exit=1 | — |
| 6 | file absent | — | `rvfdb-create-attempt` | `.rvf` (new SFVR) |

Writers 2 and 3 fall to pure-TS because the file either holds `RVF\0` (a previous pure-TS writer clobbered SFVR) or is zero-byte (mid-write transient). They write `RVF\0` bytes to the `.rvf` path. Writer 6 then finds the file absent (mid-rename gap) and creates a fresh SFVR. Net result: `.meta` holds entries from the native-path writers, `.rvf` holds entries from the pure-TS writers, and the two populations never merge because `mergePeerStateBeforePersist` reads EITHER `.meta` (if native) OR `.rvf` (if pure-TS) — never both. `memory list` reports whichever subset the reading process happens to open.

**File**: `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts`
**Lines**: 753-764 — the "Cold start: no file yet, or file without SFVR magic (pure-TS-owned)" branch.

The current code silently accepts THREE distinct non-SFVR states as "pure-TS owns this file":
1. **Valid `RVF\0` content** — legitimate pure-TS file. Safe.
2. **Zero-byte file** — mid-write transient between `creat()` and SFVR header emit by a peer's `RvfDatabase.create`. **UNSAFE** — this writer then writes `RVF\0` on top, corrupting the peer's native init.
3. **Previously-SFVR file now holding `RVF\0`** — someone in THIS SAME process group clobbered SFVR with a pure-TS write in a prior race. **UNSAFE** — propagates the corruption forward.

States 2 and 3 both violate the ADR-0095 §Decision item (a) invariant "once SFVR, always native-or-refuse". The invariant is only checked for state `bytesRead === 4 && peek === SFVR`. Any `bytesRead < 4` or `peek !== SFVR` silently exits via the pure-TS fallback.

### Proposed minimum fix

**d3 — `acquireLock` mkdirs the lock's parent before the `writeFile` wx-open** (~5 LOC)

Target: `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts:872-883`, specifically BEFORE line 882's `writeFile`.

```ts
private async acquireLock(): Promise<void> {
  if (!this.lockPath) return;
  const { writeFile: wf, readFile: rf, unlink: ul, mkdir: mk } = await import('node:fs/promises');
  // ADR-0095 d3: ensure parent dir exists before wx-open. Cold-start race
  // where N writers hit initialize() before `.swarm/` has been mkdired by
  // any prior process. mkdir is idempotent with {recursive:true} so no
  // serialization needed — whichever writer wins the mkdir race, the
  // subsequent wx-opens either succeed (first) or get EEXIST (peers,
  // handled as normal lock contention).
  const lockDir = dirname(this.lockPath);
  try { await mk(lockDir, { recursive: true }); } catch {}
  const maxWaitMs = 5000;
  // ... rest unchanged
```

This is a SINGLE-line idempotent `mkdir(dirname, {recursive:true})` before the retry loop. On macOS/Linux, `mkdir -p` is racy-safe: concurrent mkdirs either succeed or ENOTDIR/EEXIST, and `{recursive:true}` swallows EEXIST internally. No additional lock scope needed.

**Expected effect**: converts all 17 ENOENT failures to EEXIST retries → success. Empirical prediction: 40/40 pass on `diag-rvf-interproc-race.mjs 6 --trials 40`.

**d4 — tighten `tryNativeInit` invariant to `bytesRead === 4 && peek === NATIVE_MAGIC || file-does-not-exist`** (~15 LOC)

Target: `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts:753-764` — the "pure-TS-owned-file" fallback.

Current code accepts any `fileExists && !hasNativeMagic` as "pure-TS owns this". This must be tightened to:
- `fileExists && bytesRead < 4` → **throw** (file is mid-write by a peer native init; pure-TS fallback would corrupt it)
- `fileExists && bytesRead === 4 && peek !== 'RVF\0' && peek !== NATIVE_MAGIC` → **throw** (unknown format)
- `fileExists && bytesRead === 4 && peek === 'RVF\0'` → return false (legitimate pure-TS)
- `!fileExists` → existing cold-create branch

Concrete change:

```ts
// Cold start: no file yet, or file with pure-TS RVF\0 magic.
// ADR-0095 d4: empty files / partial-SFVR writes / unknown magic are a
// peer's mid-write race — pure-TS fallback would corrupt native state.
// Only genuine RVF\0 content qualifies as "pure-TS owns this".
if (fileExists(this.config.databasePath)) {
  if (!hasNativeMagic) {
    // Peek again under the lock (already held) to classify the file.
    const fd = openSync(this.config.databasePath, 'r');
    let magicBytes = Buffer.alloc(4);
    let br = 0;
    try { br = readSync(fd, magicBytes, 0, 4, 0); } finally { closeSync(fd); }
    if (br !== 4) {
      throw new Error(
        `[RvfBackend] ${this.config.databasePath} exists but has only ${br} bytes ` +
        `(peer's native init mid-write). Refusing pure-TS fallback to avoid ` +
        `clobbering SFVR file. Advisory lock should have serialized — ` +
        `this indicates a lock-ordering bug.`,
      );
    }
    const peek = String.fromCharCode(magicBytes[0], magicBytes[1], magicBytes[2], magicBytes[3]);
    const expectedPureTS = String.fromCharCode(0x52, 0x56, 0x46, 0x00); // 'RVF\0'
    if (peek !== expectedPureTS) {
      throw new Error(
        `[RvfBackend] ${this.config.databasePath} has unknown magic ${JSON.stringify(peek)} ` +
        `(not RVF\\0, not SFVR). Refusing to overwrite — likely foreign/corrupt file.`,
      );
    }
    // Genuine pure-TS RVF\0 — fall through to return false.
  }
  return false;
}
```

**Expected effect**: pure-TS writers that were silently clobbering SFVR now THROW LOUDLY. d1's advisory-lock serialization (already shipped) means the mid-write gap is minimal, so throws should be rare in practice. Under properly-serialized init, no peer should be mid-write at peek time. If this throws, it surfaces a genuine lock-ordering bug (not a tolerable race).

**Risk**: d4 may cause some CLI invocations to fail where they previously silently lost data. That is the correct semantic per ADR-0082 ("fail loud over silent data loss"). If a peer's mid-write really is happening, either the lock is broken or the native library isn't fsync-complete at return. Either is a bug that needs visibility, not a tolerated race.

**Joint d3 + d4 expectation**: `diag-rvf-interproc-race.mjs 6 --trials 40` → 40/40 PASS, `entryCount=6` for every trial, zero silent-loss cases, zero `exit=1` (because d3 fixes the ENOENT AND the d1 serialization prevents mid-write races that would trigger d4's throws).

### Instrumentation updates delivered

- **File**: `scripts/diag-rvf-persist-trace.mjs`
- **Changes from Pass-2**:
  - CLI version bump: `3.5.58-patch.137` → `3.5.58-patch.139`.
  - Patched `storage-factory.js` with `factory-createStorage-catch` trace that preserves `primaryError.code`, `.stack`, `.cause.code` before the re-wrap. This is what unwrapped H8.
  - Patched `rvf-backend.js` with `tryNativeInit-peek-result` trace that logs `bytesRead`, each of the 4 head bytes, and the `peekStr` string. This is what exposed H14.
  - Added `tryNativeInit-return-false` traces on all three pure-TS-fallback branches (`MODULE_NOT_FOUND`, `pure-TS-owned-file`, `create-ENOENT`) to attribute every fallback.
  - Added `native-import-error` + `native-import-ok` traces on the `@ruvector/rvf-node` import.
  - Added `mergePeer-silent-catch` trace on `mergePeerStateBeforePersist`'s silent catch (fired 0 times in 35 trials — ruled out as the silent-loss mechanism).
  - Added `mergePeer-pre-wal-replay` trace showing `entriesAfterMetaMerge` (lets us distinguish merge failures from disjoint-target writes).
  - Added `persistToDisk-rename` trace showing the exact tmpPath + target for every rename (this revealed native writers renaming to `.meta` while pure-TS writers renamed to `.rvf` — the disjoint-target signature).
  - Added `initialize-enter` + `acquireLock-wx-error` + `acquireLock-budget-exhausted` traces (first two regex-matched partially; the budget one fired 0 times across 40 trials — ruled out H10).
- **Usage** (unchanged): `node scripts/diag-rvf-persist-trace.mjs [N] [trials]`.
- **Reproducing the two failure modes**:
  - Cold-start ENOENT: `node scripts/diag-rvf-persist-trace.mjs 6 20` typically shows 3-6 failures with `entryCount=null`, stderr containing `factory-createStorage-catch {"code":"ENOENT"..."memory.rvf.lock"}`.
  - Silent mixed-backend loss: same command. Look for trials with `entryCount=3..5` and grep those writer traces for `tryNativeInit-return-false {"reason":"pure-TS-owned-file"}`. Expect the peek-result trace on that writer to show `bytesRead<4` or `peekStr: "RVF\u0000"`.
- **Runtime**: ~6-10s per trial at N=6. 20 trials ≈ 2-3 minutes wall.
- **Log samples**: `/tmp/pass3-probe-n6-15v3.log` (15 trials including t9's silent 3/6 loss), `/tmp/pass3-probe-n6-20v2.log` (20 trials including t6's 4/6 loss). Extracted t10 mixed-backend detail at `/tmp/t10-trace.log`.

## Investigation Findings (2026-04-18, Pass 4 — H15 read-side)

After Pass-3 (d3+d4, fork `e6901f397`, `@sparkleideas/cli@3.5.58-patch.141`) write-side probe hit 40/40 at N=2/4/6/8. Full acceptance cascade still shows 3 related failures: `t3-2-concurrent` (flaky 1-pass-2-fail across 3 runs), `e2e-semantic`, `e2e-0083-roundtrip`. Three parallel investigators (A code / B empirical / C disk) characterized the residual bug class.

### Summary of findings

**Code (A)**: No read-path bug in source. `list()`/`query()` read `this.entries`; `store()` writes `this.entries`; `loadFromDisk` populates from `.meta` when native active. All the same Map. `persistToDiskInner` writes `entryCount` + entries in a single synchronous block so header/body can't diverge in source. **One code-level risk**: `loadFromDisk` at lines 1443-1495 silently `break`s on body parse fail — header=N, body=M<N would surface as "M/N visible".

**Empirical (B)**: Cannot reproduce "1/6" at N=6 on patch.141+. Every read primitive returns N/N deterministically at N≤8. Surfaced 3 adjacent issues:
- `memory list` unbounded amplification — appends ~24 KB to `.rvf` per invocation (access-audit / HNSW state write-back)
- `mcp exec --tool memory_list` unscoped (`params:{}`) returns `{entries:[], total:6}` — payload empty, total correct. Scoped works.
- Write-side loss reproduces above N=8 under CPU contention: 7/8 (with concurrent work), 11/12, 18/20. d1-d4 closed N≤8; higher-N still has an open race.

**Disk (C)**: `.meta` is always consistent (60+ trials, zero lies). Native `.rvf` has an **unlocked multi-writer race** — `RvfDatabase.ingestBatch` with no exclusive lock produces `InvalidChecksum` corruption ~5-10% of trials. Read path trusts the broken native file rather than falling back to the valid `.meta` sidecar. C never reproduced "1/6" either — outcomes were "all N/N" or "loud fail".

### Hypotheses ruled on

| Hypothesis | Verdict | Evidence |
|---|---|---|
| H15-code-1 (loadFromDisk skips .meta) | RULED OUT | Source reads `.meta` when native active |
| H15-code-2 (list via native) | RULED OUT | `query()` reads `this.entries` only |
| H15-code-3 (separator mismatch) | RULED OUT | Same `\0` separator on write + read |
| H15-code-4 (list is different method) | RULED OUT | Same `routeMemoryOp({type:'list'})` path |
| H15-code-5 (early-return on nativeDb.entryCount) | RULED OUT | Not present in source |
| H15-code-6 (header lies) | RULED OUT by code, CONFIRMED by disk | Header+body co-derived; but partial-body-parse could produce it |
| H15-native-race | **CONFIRMED** | Native `ingestBatch` corrupts `.rvf` ~5-10% of trials |
| H15-fallback-missing | **CONFIRMED** | Read path doesn't try `.meta` when native fails |
| H15-process-exit | **CONFIRMED** | `shutdownRouter` registered only on `beforeExit`; `process.exit()` skips it → lock leak |
| H15-list-amplification | **CONFIRMED** | List appends to `.rvf` monotonically |
| H15-mcp-unscoped | **CONFIRMED** | `mcp exec --tool memory_list --params '{}'` empty payload |
| H15-scaling-write | **CONFIRMED** | N≥8 CPU-contended + N=12/20 lose entries |

### Proposed items (for a later Pass-4 amendment, not this investigation)

- **d5** — Read-path `.meta` fallback. When native `RvfDatabase.open` / read throws or returns `InvalidChecksum`, fall back to the pure-TS `.meta` sidecar rather than failing both layers. Honors ADR-0082 (don't silent-swallow) but adds a loud fallback path instead of loud total failure.
- **d6** — Process-exit shutdown. Register `process.on('exit', syncShutdown)` in addition to `beforeExit`, or ensure every CLI command path reaches `beforeExit` (no `process.exit()` shortcuts when storage is initialized). Needs a sync `close()` in `@ruvector/rvf-node` or a two-phase scheme.
- **d7** — Upstream: `@ruvector/rvf-node` needs an exclusive lock on `RvfDatabase.ingestBatch` to prevent the `InvalidChecksum` race. This is upstream-scope (not ruflo).
- **d8** — `memory list` write amplification: audit whether access-logging should write HNSW state every read. If accidental, stop. If intentional, cap at bounded history.
- **d9** — `mcp exec --tool memory_list` unscoped path: trace why `total` is correct but `entries[]` empty. Likely a serialization/pagination bug in the MCP tool handler.
- **d10** — Write-side scaling above N=8: separate investigation. Current probes only exercise N=2/4/6/8 via 40-trial harness.

### Probes / artifacts delivered

- `scripts/diag-rvf-read-matrix.mjs` (new) — parametrized CLI experiment runner. Takes `--N`, `--exp 1..6`. Emits structured JSON.
- `/tmp/s1.4b-results.md` + `/tmp/s1.4b-e{1..6}v3.json` — B's tabulated empirical findings.
- `/tmp/r{1,2,3}-*.bin` + `/tmp/race*.sh` — C's disk snapshots and repro scripts.

### Status

- **Write convergence at N=2..8**: SOLVED by d1-d4 (confirmed 40/40 × multiple runs).
- **Read-side**: MULTIPLE distinct bugs (d5-d10 above), none reproduce as "1/6" on current builds — the original T3-2 "1/6" observation is suspected to be either a transient pre-patch state or a check-code artifact (B had a similar parser issue in E5).
- **Next**: user choice between continuing with d5-d10 fork work vs closing S1 at "write-side solved" and moving to S3.

---

## Swarm-2 amendment (2026-05-01) — items d12, d13, d14 — final fix detail

### Recurrence

After the 2026-04-29 upstream-merge program (ADR-0111) the contention reappeared: cli@patch.282 against `diag-rvf-interproc-race.mjs --trials 40` (N=2,4,6,8 × 10) produced **0/40 PASS**. Initial inspection blamed the JS-side `.lock` path collision with the native FLVR-format binary lock; renaming the JS lock to `.jslock` (memory-router.ts:707 + rvf-backend.ts) and tightening the JS lock's PID-stale handling moved diag to **36/40 (90%)** but left a residual silent-loss tail.

The asymmetric pattern was the diagnostic signal:

| N | Pass | Loss shape |
|---|------|------------|
| 2 | 9/10 | observed=1, subproc-fail=0 |
| 4 | 9/10 | observed=3, subproc-fail=0..1 |
| 6 | 8/10 | observed=1..5, subproc-fail=0..1 |
| 8 | **10/10** | — |

In every conventional storage race, *more contention = more loss*. The inverted asymmetry (low-N leaks, high-N perfect) indicated something **timing-sensitive that a fully-saturated kernel queue masks**.

### Two 10-agent swarms

**Swarm 1 (2026-05-01 morning)** correctly identified the architectural root: replace the native `WriterLock` (O_CREAT|O_EXCL with PID-stale-detection) with kernel `flock(LOCK_EX)`. The fix was load-bearing: 0/40 → 36/40. But it didn't explain the residual 10%, and the `feedback-data-loss-zero-tolerance.md` rule made 90% non-shippable.

**Swarm 2 (2026-05-01 afternoon)** queried the residual. 4 of 10 experts (Rust, Init-race, Theory/TLA+, Pattern) independently converged on the same finding:

> `RvfStore::create` at `forks/ruvector/crates/rvf/rvf-runtime/src/store.rs:83-90` does `OpenOptions::create_new(true).open(path)` BEFORE `WriterLock::acquire(path)`. Two cold-start peers race the bare-file `O_EXCL` create; the loser gets EEXIST mapped to `FsyncFailed (0x0303)` (misleading error code) and is treated as fatal by JS `tryNativeInit` at attempts=1. The 5s LockHeld retry budget never fires because the error is the wrong shape.

Devil's-advocate countered with "ship at 90%, the asymmetry is a microscope artifact" — rejected on `feedback-data-loss-zero-tolerance.md` grounds: 10% silent loss in a memory store is a contract violation, not noise.

Empirical confirmation (vs trace-only) was the load-bearing step that distinguished swarm 2 from a previous swarm-2-style deferred-corrupt fix that happened to make things WORSE (33/40). Per `feedback-no-fallbacks.md`, the team instrumented before iterating: `RVF_DIAG=1` env var added log lines at every state-mutation site in `rvf-backend.ts`, and the diag harness was modified to preserve trial dirs + dump per-writer stdout/stderr on failure (so failed trials could be post-mortem'd offline).

The first `RVF_DIAG=1` failure capture (trial t4 at N=4) produced:

```
writer-1: pid 59116 — initialize.start → tryNativeInit hasNative=true → store probe-t4-1 → persistToDiskInner.renamed → exit 0
writer-3: pid 59118 — initialize.start → initialize.reapDone → [ERROR] Failed to store: RVF error 0x0303: FsyncFailed at attempts=1, elapsed=0ms
```

The 0ms elapsed at attempts=1 is dispositive. The native call returned EEXIST-mapped-to-FsyncFailed before any retry budget could fire. This is exactly the shape the four experts predicted but had not yet been reproduced under instrumentation.

### d12 — flock-based WriterLock

**File**: `forks/ruvector/crates/rvf/rvf-runtime/src/locking.rs` (rewritten).

The original `WriterLock` used:
- `O_CREAT|O_EXCL` to atomically create a sibling `.lock` file with PID + hostname + timestamp + UUID
- Userspace stale-detection: `kill(pid, 0)` + 30s age threshold to break dead-holder locks
- Drop impl removes the lock file on natural Rust drop

Failure modes the design carried:
1. **Non-blocking** — caller had to retry from userspace, with a 5s budget that was empirically too short under N≥6 contention because each holder kept the lock for its entire RvfStore lifetime (= entire CLI process lifetime).
2. **N-API process.exit(0) skips Drop** — when the JS `process.exit(0)` short-circuits V8 GC, the Rust struct is never dropped, so the lock file leaks to disk with a now-dead PID. The next contender's stale-detection works most of the time but has races.
3. **PID reuse** — between OS PID-recycle and the next contender's `kill(pid, 0)` check, dead-holder detection can mis-fire.

Replacement design uses `flock(LOCK_EX)` on a never-unlinked `.lock` sibling:
- **Blocking** — kernel queues writers FIFO; no userspace retry budget needed
- **Auto-release on process death** — kernel reaps fd state when process exits, including `process.exit(0)`. The flock is dropped with the fd; no leak possible
- **Same-inode flock queue** — because the lock file is never unlinked, all peers `open` the same inode and join the same kernel queue
- **Process-local refcount** — `Mutex<HashMap<PathBuf, usize>>` short-circuits same-process repeat acquisitions (BSD flock is per-fd; without the refcount, one process taking the same flock twice via different fds would deadlock against itself)

The same pattern was already used by `IngestLockGuard` in `rvf-node/src/lib.rs:45-114` (the `.ingestlock` flock around `RvfStore::ingest_batch`); d12 extends it to cover `RvfStore::create`/`open`/`derive`.

Public API of `WriterLock` is preserved: `acquire`, `release`, `Drop`, `is_valid`, and `lock_path_for` all keep their signatures so `store.rs` does not need changes for the API itself (only the call-site reorder in d14).

### d13 — JS `.jslock` re-entrant via `_lockHeldDepth`

**File**: `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts` — field declaration ~line 105, `acquireLock`/`releaseLock` ~line 1498/1620, `store()` ~line 410-475.

Pre-d13 `store()` released the JS lock 3 times: once after the in-memory mutation + native ingest, then `appendToWal` took it on its own, then `compactWal` took it on its own. Peer writers could interleave at either release point.

d13 makes `acquireLock`/`releaseLock` re-entrant via a `_lockHeldDepth` counter. Same-process repeat acquisitions bump the counter and return without taking a new physical lock; only the outermost release physically unlinks the `.jslock` file. `store()` now acquires once, holds across the WHOLE in-mem-mutate + native-ingest + WAL-append + WAL-compact + WAL-unlink sequence, and releases once.

**Caveat (out-of-scope for d13)**: the depth counter is unsafe under JS async semantics for SAME-process `Promise.all` over `store()` (Task1 holds depth=1 across an await; Task2 sees depth=1 and bumps to 2 thinking it owns the lock — both tasks then race in-mem state). The diag is multi-process so this doesn't fire there, but in-process callers with `Promise.all` over a single backend instance would corrupt. The correct primitive is a Promise-chained mutex with a caller token; tracked separately, not gating this ADR.

### d14 — flock-before-create in `RvfStore::create`

**File**: `forks/ruvector/crates/rvf/rvf-runtime/src/store.rs:78-100`.

```rust
pub fn create(path: &Path, options: RvfOptions) -> Result<Self, RvfError> {
    if options.dimension == 0 {
        return Err(err(ErrorCode::InvalidManifest));
    }

    // Take flock FIRST; cold-start peers serialize at the kernel queue.
    let writer_lock = WriterLock::acquire(path).map_err(|_| err(ErrorCode::LockHeld))?;

    // Now under the flock: if the file appeared, a peer raced and won.
    // Return LockHeld (transient) so the JS-side dispatcher retries as open().
    if path.exists() {
        drop(writer_lock);
        return Err(err(ErrorCode::LockHeld));
    }

    let file = OpenOptions::new()
        .read(true).write(true).create_new(true)
        .open(path)
        .map_err(|_| err(ErrorCode::FsyncFailed))?;
    // ... rest of create unchanged ...
}
```

JS-side companion change at `rvf-backend.ts:1296-1312`: when `RvfDatabase.create` returns `LockHeld` AND the file now exists on disk, switch to `RvfDatabase.open` (which goes through the same flock queue). This replaces the previous behavior where create-race losers crashed at `attempts=1`.

The combination of d12 + d14 makes the create-vs-open decision atomic under the kernel flock — exactly the linearizability obligation the TLA+ expert flagged: `(native_rvf_content = ⊥) ∨ (P.nativeFallbackMode = false)` is now lock-invariant.

### Validation

- **Cascade**: `bash scripts/ruflo-publish.sh` published `cli@3.5.58-patch.302` + `ruvector-rvf-node@0.1.9-patch.5+`. t3-2 acceptance check passes 4.97s.
- **Diag matrix**: `CLI_VERSION=3.5.58-patch.302 node scripts/diag-rvf-interproc-race.mjs --trials 40` → **40/40 PASS, wallclock 372s** (N=2: 10/10, N=4: 10/10, N=6: 10/10, N=8: 10/10).

The 40/40 result satisfies `feedback-data-loss-zero-tolerance.md` for the diag layer (which is more thorough than the t3-2 acceptance check). Status returns to **Implemented**.

### Process notes

- The first 24h of the swarm-2 cycle confirmed two anti-patterns from `feedback-no-fallbacks.md` and the new `feedback-data-loss-zero-tolerance.md`:
  1. "Experts converged on a fix" is not the same as "fix is empirically validated". Swarm-2's first converged hypothesis (set `nativeFallbackMode=true` in deferred-corrupt branches) was internally consistent but EMPIRICALLY made things WORSE (33/40 vs 36/40 baseline). It was reverted within minutes of the diag result.
  2. "Ship at 90%" was floated by devil's advocate and explicitly rejected on data-integrity grounds. The same argument was tempting after the swarm-1 fix; resisting it surfaced the actual create-vs-flock race that swarm-2 closed.
- `RVF_DIAG=1` instrumentation + diag-harness preservation of failed trials is now load-bearing infra. Future contention regressions should reach for it FIRST before spawning more agents.
