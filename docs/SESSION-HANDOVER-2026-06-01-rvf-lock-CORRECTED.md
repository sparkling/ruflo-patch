# Session Handover — 2026-06-01 (later) — RVF lock: corrected diagnosis + verification

**Supersedes the diagnosis in `SESSION-HANDOVER-2026-06-01-rvf-concurrent-write-regression.md`.**
That handover's prescribed fix (blocking `flock` + per-path mutex) was implemented,
tested at the CLI level under load, and **proven wrong (it deadlocks)**. This doc
records what was verified, the real root cause, the hard constraints, and the
repo state. Read this before touching the lock.

---

## TL;DR

1. **The original problem is FIXED and verified.** ADR-0267 (a long-running MCP
   daemon held the RVF `flock` for its whole lifetime → every CLI `memory store`
   got `LockHeld` after ~30s) was resolved by ADR-0274's per-transaction release.
   Live test (clean `patch.394`): daemon running, holds **no** write flock; **8/8
   concurrent CLI writes succeed, 0 LockHeld**. Done.
2. **The handover's blocking-flock fix is WRONG — do not ship it.** It deadlocks
   the real CLI path (AB-BA between the JS `.jslock` and the native `.lock`).
   **Reverted** to NB-poll in ruvector `adab9fc36`.
3. **The t3-2 flake's real root cause is the JS `.jslock`, not the native lock** —
   it fails to serialize concurrent writers at high concurrency (6–10 overlapping
   store critical sections at N=16 → silent clobber). This is a SEPARATE, lower-
   priority issue from ADR-0267, and it lives in fork-invented code (upstream has
   none of this machinery).
4. ⚠️ **Published regression:** `@sparkleideas/cli@…patch.395` on Verdaccio is the
   blocking-flock build → it DEADLOCKS under load. A clean release (now NB-poll)
   must overwrite it.

---

## Part A — VERIFIED: the origin (ADR-0267) and that it's fixed (ADR-0274)

**Origin — ADR-0267 (2026-05-27)** `docs/adr/ADR-0267-rvf-lock-regression-blocks-cli-memory-ops.md`:
> CLI `memory store` blocks indefinitely when the MCP daemon is running. The
> exclusive `flock` on the RVF backend file is held across the **lifetime of the
> daemon process**, not released per-op.

Holders identified: the MCP server's `routeMemoryOp`/`ensureRvfWired` path + 2
unmigrated daemon workers (`map`, `audit`). Probes even caught a *stale* hold (a
dead daemon still pinning the lock via `daemon-state.json: running:true`).

**Fix — ADR-0274 (2026-05-30)** `docs/adr/ADR-0274-resolve-rvf-lock-via-read-write-handle-split.md`:
read/write handle split + per-transaction write release. Persistent **lock-free**
read handle (pinned forever, safe — `open_readonly` takes no flock); **transient**
write handle holding the flock only per `open→ingest→close`. The daemon sets
`setRouterPersistent(false)` so each op releases the RVF flock between ticks
(`@claude-flow/cli/src/memory/memory-router.ts:201-203`). The park/unpark in
`rvf-backend.ts` (`parkNativeWriter`/`unparkNativeWriter`) is the in-process half.

**Live verification (this session)** — clean `@sparkleideas/cli@3.7.0-alpha.10-patch.394`
(NB-poll native lock, ADR-0274 as shipped), fresh `init --full` + `memory init`:
- `daemon start` → RUNNING, 7 workers; `lsof memory.rvf.lock` = **empty**,
  `lsof memory.rvf` = **empty** → the daemon does NOT hold the write flock.
- 8 CLI `memory store` (4 sequential + 4 concurrent) while the daemon ran →
  **8/8 succeeded, 0 LockHeld, 8/8 persisted**; daemon survived.

⇒ ADR-0267 is genuinely fixed. The real-world scenario works.

---

## Part B — WHY the handover's blocking-flock fix is wrong (deadlock)

There are **two cross-process locks** on the `.rvf`:
- the JS **`.jslock`** (PID-file advisory lock, `@claude-flow/memory/src/rvf-backend.ts`), and
- the native **`.lock`** kernel flock (`forks/ruvector/.../rvf-runtime/src/locking.rs`).

They are acquired in **inconsistent orders**: `store()` takes `.jslock`→native;
`init/tryNativeInit` takes native→`.jslock` (init was deliberately scoped OUT of
the `.jslock` by the 2026-05-01 ADR-0095 amendment, rvf-backend.ts:353-372). With a
**no-timeout blocking flock** that inversion is a hard AB-BA deadlock:

```
RvfDatabase::reacquire_lock → unpark_writer → WriterLock::acquire → flock  [blocks forever]
... peer holds .jslock, waits native flock; this proc holds native flock, its next op waits .jslock
→ all peers exhaust the .jslock 60s budget: "Failed to acquire advisory lock after 100 attempts"
```

The old NB-poll's 30s timeout was *masking* this (turning the wedge into the
original LockHeld/loss). Sync-park + init-wrap (see Part D) make the ordering
consistent but the `.jslock` *still* doesn't serialize (Part C), so blocking flock
remained wedged in testing. **Conclusion: a no-timeout blocking flock is
incompatible with the two-lock design.** Reverted to NB-poll (`adab9fc36`).

---

## Part C — REAL root cause of the t3-2 silent loss: the JS `.jslock`

Measured directly (warm-start `.rvf`, no daemon, `RVF_DIAG=1` trace + overlap
detection on the store critical sections):

| Scenario | Result |
|---|---|
| 16 stores **sequential** (one at a time) | **16/16** — native write path is fine |
| 16 stores **concurrent** | **7–10/16** — silent loss, **zero errors** |
| Same + overlap detection | **6–10 OVERLAPPING store critical sections** |
| N=4 concurrent | 4/4, perfect serialization (no overlaps) |
| Concurrent, steal disabled | still **10/16** (6 overlaps) — steal is only part of it |
| Re-list over 15s | stable — **genuine loss, not read-after-write lag** |

So the `.jslock` (a `writeFile(…, {flag:'wx'})` + PID-liveness *steal*) **fails to
serialize concurrent writers at high concurrency**, letting concurrent native
ingests clobber each other. Two defects: (a) the dead-holder steal (`if
(parseSuccessful && !holderAlive) unlink+continue`, ~rvf-backend.ts:2103) steals
from live holders; (b) a deeper wx-create/unlink race remains even with the steal
disabled. **This is fork-invented code with no upstream equivalent (see Part E).**
Note: native RVFROOT files have **no `.rvf.meta` sidecar**, so `memory list` is the
authoritative count (matching how the t3-2 check treats native).

**Priority note:** this is a real data-loss bug but it only bites at high
concurrency (N≈8+). At the realistic levels that matter — the daemon scenario
(Part A, 4 concurrent = clean) and the check's N=6 (the original flake passed 3/4)
— it's a tail risk, NOT the motivating ADR-0267 problem (which is fixed).

---

## Part D — Partial improvements found (reduce loss, do NOT fully fix) — NOT shipped

Both reverted to leave a clean tree; re-apply as part of a real fix:
- **SYNC-PARK:** in `releaseLock()`, replace the debounced `_scheduleNativePark()`
  with a synchronous `parkNativeWriter()` (native flock released BEFORE `.jslock`;
  invariant "native flock ⊂ `.jslock`"). Correct + beneficial standalone — the
  debounce's `setTimeout` is starved under load, leaving the flock held across the
  `.jslock` boundary.
- **INIT-WRAP:** wrap `tryNativeInit` + `loadFromDisk` under one `acquireLock(180s)`
  (reverts the 353-372 scope-down) so init keeps the same `.jslock`⊃native order.
- Combined (NB-poll + both): N=16 cold-start went 3/16 → 11/16. Still lossy because
  the `.jslock` itself doesn't serialize (Part C).

---

## Part E — How UPSTREAM avoids this (the complexity is fork-invented)

`ruvnet/ruflo:v3/@claude-flow/memory/src/rvf-backend.ts` is **683 lines with ZERO
lock machinery** (no `.jslock`, `acquireLock`, `parkNativeWriter`, advisory lock —
0 hits). The fork's is **3648 lines, 83 fork-only commits** on this one file. The
entire cross-process write-coordination layer is fork-invented.

Upstream's model:
- `store()` is **in-memory only** (`entries.set`, `hnswIndex.add`, `dirty=true`) —
  no native write, no lock, no WAL.
- durability = batched `persistToDisk()` (full-file rewrite) serialized by an
  **in-process promise queue** — assumes a **single long-lived owner process**;
  cross-process concurrent writers are simply unsupported.

The fork re-architected to **per-store immediate durable native ingest** because
its CLI spawns a **fresh short-lived process per `memory store`** (it exits, so it
can't batch-persist later). That turned "one owner" into "N concurrent processes"
and forced the cross-process lock machinery — where the bug lives.

---

## Part F — Hard constraints on any fix (from ADR-0167 / 0207 / 0274)

- **The native flock is load-bearing, not incidental.** RVF integrity is a linear
  append-only Merkle witness chain; two concurrent appenders fork the chain and
  break attestation. Single-writer is **by design**. **"Replace the flock" is out
  of scope (ADR-0167).**
- **Routing writes through a daemon/broker is REJECTED** (ADR-0207 deleted the
  Unix-socket broker; ADR-0274 Option 2 rejected re-adding it — "upstream chose
  files + in-process concurrency over a daemon broker"). It would also reintroduce
  the ADR-0267 lifetime-hold. **Do not propose daemon write-routing.**
- **Cross-process-concurrent / lock-free RVF is impossible** without abandoning the
  witness chain (ADR-0274 Option 3).

⇒ A t3-2 fix must work WITHIN: native per-transaction flock + the fork's
multi-process model. The cleanest direction: make the **single native flock** the
clean cross-process serializer and **stop the JS `.jslock` from competing with it**
(subordinate or eliminate the `.jslock` by holding the native flock across the
JS-side WAL/.meta writes). With one lock, a fair blocking flock would no longer
AB-BA. This overrides ADR-0274's debounce + the `.jslock` design + ADR-0095
§353-372 → should be ratified, not hacked in.

---

## Part G — Repo state at handover

| Repo | Commit | What |
|---|---|---|
| forks/ruvector (main) | `adab9fc36` | **revert** blocking flock → NB-poll (deadlock-safe). `rvf_test_writer` cold-start mode + `tests/adr0095_coldstart_race.rs` kept as guards. |
| forks/ruflo (main) | (clean) | rvf-backend.ts sync-park + init-wrap were **reverted** (clean tree). |
| ruflo-patch (main) | `53e9d3c` | **KEPT (real fixes):** `napi-rebuild.sh` now rebuilds `rvf-node` when a SIBLING lib crate (`rvf-runtime`) changes — the pathspec only watched the napi crate's own dir, so a `locking.rs` fix shipped a STALE `.node`. + t3-2 preserves the first failing writer's error in `_CHECK_OUTPUT`. |
| ruflo-patch (main) | `7df46ae` | corrected analysis prepended to the original handover. |

⚠️ **Verdaccio `@latest` = `@sparkleideas/cli@3.7.0-alpha.10-patch.395`** was built
from the blocking-flock state (a release ran far enough to publish before being
interrupted) → it **DEADLOCKS under load**. A clean release (HEAD is now NB-poll)
overwrites it. `package.json` carries an orphaned `patch.368→369` bump.

---

## Part H — Recommended next steps (in order)

1. **Un-regress Verdaccio:** clean release from current HEAD (NB-poll) to overwrite
   the deadlocking `patch.395`. Restores the pre-session safe state (original
   intermittent flake, no deadlock). The napi-rebuild fix (`53e9d3c`) makes this
   ship correctly.
2. **Decide the t3-2 fix as a design task** (it is NOT the ADR-0267 problem, which
   is fixed; it's the high-concurrency `.jslock` race). Recommended direction:
   single native flock as the sole serializer, `.jslock` subordinated/removed (see
   Part F). Likely an ADR given it overrides ADR-0274/0095.
3. Until then, the t3-2 check can flake at its N=6 tail; do NOT mask it (no
   skip_accepted). The preserved writer logs (`53e9d3c`) make a CI failure
   self-diagnosing.

## Artifacts

- Reliable CLI repro: `/tmp/rvf-fix/repro2.sh` (bash; find-delete cold-start; counts
  via `memory list`). Knobs: `N`, `ITERS`, `CPU`, `IO`.
- Daemon-hold verification recipe (Part A): clean install `@sparkleideas/cli@…394`,
  `init --full` + `memory init`, `daemon start`, `lsof memory.rvf.lock` (empty),
  burst CLI stores (8/8, 0 LockHeld), `daemon stop`.
- Overlap detector: `RVF_DIAG=1` per-process logs → pair `store.start` with the next
  `releaseLock.unlinking` per pid, check interval overlaps.
