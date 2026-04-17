# ADR-0095: RVF Inter-Process Write Convergence

- **Status**: Accepted — Amended 2026-04-17
- **Date**: 2026-04-17 (authored), 2026-04-17 (amended after Sprint-1 investigation)
- **Scope**: `v3/@claude-flow/memory/src/rvf-backend.ts` — `tryNativeInit` (line 605), `persistToDiskInner` (line 1384 — specifically the shared-tmp-path at line 1450), backend construction call sites (MemoryManager + controller registry). `mergePeerStateBeforePersist` is explicitly **out of scope** for this ADR — the shipped implementation (lines 1298–1382) already does what the original §Decision proposed.
- **Forked from**: ADR-0094 Open Item #1
- **Related**: ADR-0086 (Storage Layer), ADR-0090 B7 (in-process multi-writer fix), ADR-0092 (native/pure-TS coexistence), ADR-0082 (no silent fallbacks), ADR-0088 (no daemon in CLI hot path), BUG-0008 (ledger)

## Changelog

- **2026-04-17 (authored)** — Proposed "read-meta-under-lock + merge + write" protocol.
- **2026-04-17 (amended, same day)** — Sprint-1 investigator (`f4dd1ec`) established that the proposed protocol is already implemented at lines 1298–1382 and does not close the observed inter-process data-loss bug. Real root cause is a **3-layer backend flip race**: (1) silent catch in `tryNativeInit` (line 635) masks native-init races so 5 of 6 concurrent writers silently fall back to pure-TS (ADR-0082 violation); (2) native writers target the `.meta` sidecar while pure-TS writers target the main `.rvf` path — disjoint write targets mean the peer-merge never sees peer writes; (3) shared `.rvf.tmp` path at line 1450 causes cross-process `rename()` ENOENT collisions and transient SFVR-corruption reads. Amended §Decision replaces the merge-protocol proposal with a three-item program: fail-loud on native init once SFVR bytes exist, per-writer unique tmp paths, and dedupe RvfBackend construction per process. See §Investigation Findings (appended below) for the dispositive trace.

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

### Why these three items, together

Items (a)+(b)+(c) form a closed set: (a) prevents silent identity flip, (c) prevents intra-process identity flapping, (b) handles the residual file-system-level race that exists even when backend identity is coherent. Removing any one item leaves a non-deterministic leak path visible in `scripts/diag-rvf-interproc-race.mjs`.

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

## Risks

- **Fail-loud in `tryNativeInit` may turn transient startup errors into fatal CLI exits.** An `open()` failure due to a peer's in-flight write is a real event. Mitigation: bounded retry (e.g. 3× 50ms) on transient error codes (EBUSY, EAGAIN, short-read / partial-magic detected); typed error check that distinguishes (i) `MODULE_NOT_FOUND` — pure-TS OK; (ii) ENOENT on cold start — pure-TS OK; (iii) transient retryable — bounded retry; (iv) file-present-with-SFVR-magic open-failure after retry — throw. The throw path must include the peer PID list read from `.rvf.lock` to aid diagnosis.
- **Unique tmp path leaks on crash → tmp-dir cleanup drift.** Leftover `*.tmp.PID.N` files accumulate if a writer crashes between `writeFile` and `rename`. Mitigation: reaper at `initialize()` scans `dirname(target)` for `*.tmp.*` files older than 10 minutes and unlinks them. The mtime threshold is conservative — much longer than any legitimate persist — so a running peer's in-flight tmp is never reaped.
- **Per-process RvfBackend cache staleness when a foreign process deletes the file.** Once the cache holds an instance tied to a now-deleted inode, subsequent operations fail with ENOENT. Mitigation: cache-invalidate on ENOENT; re-construct on next call (the cache is a keyed memoization, not ownership). Covered by AC #1 (N=2 with delete-racer is a trivial follow-on probe).
- **Cross-ADR coupling (ADR-0082, ADR-0086, ADR-0088, ADR-0090, ADR-0092).** The amendment makes `tryNativeInit` a new ADR-0082 regression surface (silent-fallback elimination); ADR-0086 Layer-1-storage invariant gains an "SFVR owner" constraint; ADR-0088's "no daemon" guideline is re-affirmed (option D rejected); ADR-0090's advisory-lock choice is re-affirmed (option C rejected); ADR-0092's native/pure-TS coexistence model is tightened from "either backend is fine per call" to "once SFVR, always native-or-refuse." Cross-link notes must be added to each referenced ADR after this amendment ships.

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
