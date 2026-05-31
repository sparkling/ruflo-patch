# Session Handover — 2026-06-01 — RVF concurrent-write regression (+ what shipped)

This session started as "implement ADR-0281" and expanded. **Two things in here:**
1. **OPEN / unfinished:** a real **RVF concurrent-write regression** (the `t3-2-concurrent`
   acceptance flake). Root-caused with a **reliable reproduction** + actual errors. NOT fixed.
2. **DONE / shipped:** ADR-0281 + index remediation, three agentdb-CLI fixes
   (ADR-0273/0276/0282), and two determinism fixes (ADR-0283). All committed; most released.

---

## PART 1 — THE OPEN PROBLEM: RVF concurrent-write regression

### Symptom
The acceptance check **`t3-2-concurrent` (ADR-0079, `lib/acceptance-adr0079-tier3-checks.sh`)**
intermittently fails: "only 1/6 RVF concurrent writers persisted ... cli_ok=1, cli_err=5".
It PASSES in 3 of 4 release runs and in isolation — it only fires under the full acceptance
suite's peak load. The check deletes its per-writer logs on every branch, so the real error
was never captured in the failing runs (fix that too — see Next steps).

### Reliable reproduction (OUTSIDE the harness) — THE KEY ARTIFACT
The t3-2 check **removes the `.rvf` before racing**, so all N writers hit a **cold-start
create** concurrently. Earlier attempts that reused an existing `.rvf` could NOT reproduce.
The trigger is **cold-start + N writers + extreme CPU+IO load** (M5 Max has many cores, so it
must be oversaturated; the RVF write pays `F_FULLFSYNC`, so fsync contention is the real lever).

Recipe (reproduces within a few iterations, every time):
```bash
# A throwaway published-build install at $D (e.g. a fresh `npm i @sparkleideas/ruflo` + init).
# Per iteration: rm the .rvf (cold-start), fire N concurrent `cli memory store` to a fresh
# namespace, then `cli memory list` to count persisted. Under 24 CPU hogs + 6 IO/fsync hogs:
D=<install>; CLI="$D/node_modules/.bin/ruflo"; N=16
for c in $(seq 1 24); do ( sh -c 'while :; do :; done' ) & done            # CPU hogs
IODIR=$(mktemp -d); for c in $(seq 1 6); do ( sh -c "while :; do dd if=/dev/zero of=$IODIR/io-$c bs=1m count=8 2>/dev/null; sync; done" ) & done  # IO/fsync hogs
for iter in $(seq 1 30); do
  rm -f "$D/.swarm/memory.rvf"* 2>/dev/null                                 # cold-start
  NS="loop-$iter"
  for i in $(seq 1 $N); do ( cd "$D" && "$CLI" memory store --key k-$i --value v$i --namespace "$NS" >"/tmp/s-$i.log" 2>&1 ) & done
  wait
  hits=$( (cd "$D" && "$CLI" memory list --namespace "$NS" --limit 40 2>/dev/null) | grep -cE 'k-[0-9]+\b')
  echo "iter $iter persisted=$hits/$N"; [ "$hits" -lt "$N" ] && { echo FAIL; cat /tmp/s-*.log; break; }
done
# kill hogs: pkill -f 'while :; do :; done'; pkill -f "dd if=/dev/zero"
```
(The session's working copies were `/tmp/adr0281/rvf-loop2.sh` + `/tmp/adr0281/rvf-loop2.log`;
those are throwaway. Re-create from the recipe above.)

### Evidence — TWO coupled failure modes (this is the crux)

**Mode A — `LockHeld` starvation (default `RVF_LOCK_ACQUIRE_TIMEOUT_MS=30000`).**
Actual error captured (was previously only inferred):
```
[ERROR] store failed: RVF error 0x0300: LockHeld
RvfDatabase.open failed after 1 attempt(s) over 30124ms (budget 30000ms): RVF error 0x0300: LockHeld
```
`1 attempt over ~30s` ⇒ a single `open()` blocked the whole budget. Result: 1–3/16 persist,
12–15/16 **error** with LockHeld.

**Mode B — silent lost writes (raise `RVF_LOCK_ACQUIRE_TIMEOUT_MS=120000`).**
The loud errors mostly vanish (writers wait longer and DO acquire) but **persisted = 1/16 with
~0 errors** — the writes are accepted then **lost**. So *the timeout is not the real fix*:
making the lock wait longer/fairer converts loud `LockHeld` into **silent data loss**, which is
worse. (Caveat: Mode B's "lost" count uses `memory list`, which has an RVF read-after-write
freshness window — D6/§Amendment in ADR-0274 — so part of Mode B could be *read-lag* rather than
*write-loss*. Disambiguate by reading the `.rvf.meta` header entryCount directly, not just `list`.)

### Root cause #1 (confirmed by reading source) — unfair lock, not a stuck holder
`forks/ruvector/crates/rvf/rvf-runtime/src/locking.rs`. The **top docstring (lines ~21-43)
describes "FIFO blocking — `LOCK_EX` queues writers in the kernel; no userspace retry budget."**
But the **actual `WriterLock::acquire` (lines ~164-209), changed in a "2026-05-04 deadlock
postmortem fix", does the OPPOSITE:**
```rust
let rc = unsafe { libc::flock(fd, libc::LOCK_EX | libc::LOCK_NB) };  // NON-blocking poll
... std::thread::sleep(100ms) ... until RVF_LOCK_ACQUIRE_TIMEOUT_MS (default 30000), else TimedOut
```
`LOCK_EX|LOCK_NB` does **not** join the kernel FIFO queue — so under N-way contention it's an
**unfair lottery**: each waiter polls every 100ms and most miss the brief free window. So the
lock is **not "held 30s by one holder"** — the *losing* writers spend 30s polling-and-missing,
then time out → `LockHeld`. The 2026-05-04 change traded a *rare same-process self-deadlock*
(two in-process `RvfStore` on one path racing the `process_local_holders` insert window) for
*common cross-process starvation*, and left the docstring describing the old design.

### Root cause #2 (needs confirmation) — concurrent cold-start clobber
Mode B (lost writes once they DO acquire) points at the write path, not the lock: N writers
cold-start-creating the SAME `.rvf` + the ADR-0274 park/unpark + `resync_for_write` manifest
re-validation. ADR-0274's amendment explicitly flagged "a parked writer clobbering a peer's
manifest with a stale segment directory, closed by `unpark_writer`'s O(1) txnid re-validation."
Under high contention that mitigation appears insufficient. Files: `rvf-backend.ts`
(`@claude-flow/memory`), `store.rs` / `park_writer`/`unpark_writer`/`resync_for_write` in
`forks/ruvector/crates/rvf/rvf-runtime/`.

### Fix direction (BOTH parts required — do not ship one without the other)
1. **Fair lock:** restore a true **blocking `flock(LOCK_EX)`** (kernel FIFO, no starvation, no
   30s give-up) for the cross-process path, while keeping same-process re-entrancy safe. The
   2026-05-04 self-deadlock was a NARROW window between `flock` success (line ~186) and the
   `process_local_holders` insert (line ~216); close it with a **per-path in-process mutex**
   guarding check→acquire→insert (so a concurrent in-process acquirer blocks on the mutex, not
   its own fd), rather than abandoning kernel FIFO. Blocking flock auto-releases on process
   death (fd close), so no hang from a dead holder.
2. **No-clobber concurrent write:** confirm Mode B is real write-loss (read `.rvf.meta`
   entryCount, not `list`), then fix the cold-start create + manifest/segment-dir race so N
   serialized writers each append durably (the FIFO lock makes them serialize; the write path
   must not lose the prior writer's manifest).
- **Verify with the reproduction above** — it is reliable. A fix must take 16/16 persisted at
  N=16 + 24 CPU + 6 IO hogs across many iterations, by `.rvf.meta` entryCount.
- This is **ruvector (Rust) + a native rebuild (NAPI)** — the 4th fork. Stress-test with the
  ADR-0167 cross-process harness (ADR-0274 D5 named this prerequisite).

---

## PART 2 — WHAT SHIPPED THIS SESSION (committed; don't redo)

### ADR-0281 — hierarchical keyed upsert + delete-by-key (the original task) — DONE
- agentdb `forks/agentdb` commit `75b5def`: `HierarchicalMemory.delete(key,{tier?})` + keyed
  upsert in `store()`. ruflo `2214d0217`: relaxed `agentdb_hierarchical-delete` key validation.
- Smoke `scripts/smoke-adr0281-*.mjs` + wiring (ruflo-patch `5486461`, parser fix `6730b25`).
- ADR flipped accepted + amendment (`44b665c`).
- **Index remediated:** reset (sqlite is the reliable oracle; the MCP `hierarchical-query`
  truncates large results — see ADR-0282) → verified empty → `agentdb index --purge` → **287
  hierarchical / 287 adr-patterns / 890 causal, 0 dupes**, the un-removable ADR-0276 duplicate
  gone, 0278-0281 present. NOTE: disk is now **288** ADRs (ADR-0282 added) and will be **289**
  with this handover's eventual ADR — a reindex is due to pick those up (idempotent now).

### ADR-0273 / 0276 / 0282 — three agentdb-CLI surface fixes — DONE
Found during the 0281 index work; fixed by background agents + integration. ruflo commits
`1fa072665` + `e5dfdac50` (ADR-0180 catch-gate follow-up). All three have fork unit tests +
the combined `adr0282-agentdb-surface-fixes` acceptance smoke (ruflo-patch `38eb50b`):
- **ADR-0273** — `agentdb index --dry-run` was NOT dry (kebab→camel flag bug: handler read
  `ctx.flags['dry-run']`, parser stores `ctx.flags.dryRun`). It performed the full write.
- **ADR-0276** — `agentdb_causal-edge-delete` left a KV residual (cleared SQLite, not the KV
  `causal-edges` dual-write copy) → `causal-query` resurrected deleted edges. Added
  `clearCausalEdgeKv`.
- **ADR-0282** — `agentdb_hierarchical-query` silently clamped an explicit `limit` to
  `MAX_TOP_K=100` despite advertising "unlimited". Added `MAX_QUERY_LIMIT`.

### ADR-0283 — two acceptance-determinism fixes — DONE
Both flaky checks root-caused + fixed (proven, not re-run). ruflo `27d1fdbfb`, ruflo-patch
`fb62234` + `5559f23`:
- **intel-graph** — generated `intelligence.cjs` `writeJSON` used a fixed temp name
  (`p+".tmp"`) → `fs.renameSync` ENOENT race when parallel writers share a data dir. Fixed:
  per-process temp (`p+"."+process.pid+".tmp"`) in `init/helpers-generator.ts` + the patch
  repo's `.claude/helpers/intelligence.cjs`. Proven by deterministic two-writer interleaving.
- **browser_eval** — `agent-browser` runs a **persistent per-session browser daemon**
  (`~/.agent-browser/<session>.sock`); a STALE `default` session (was from May 29) made
  `agent-browser eval` HANG → `spawnSync npx ETIMEDOUT`. Fixed: the acceptance setup clears the
  stale session + pre-warms the agent-browser npx cache (`scripts/test-acceptance.sh`). Verified
  `{result:2}` in 1s vs 90s hang.

### Released / version state
Last full release published **`@sparkleideas/cli@3.7.0-alpha.10-patch.394`**, agentdb
`patch.406`, wrapper `@sparkleideas/ruflo@patch.368`. The agentdb fixes + both determinism
fixes are in patch.394; `adr0281` + `adr0282` + `e2e-0059-intel-graph` + `p4-br-eval`
acceptance checks all PASS in the latest release. **The patch.368 version bump is UNCOMMITTED
in `ruflo-patch/package.json`** (each release's acceptance aborted before the pipeline's commit
step — first on `t3-2`). Commit it (`git add package.json`) to align HEAD with Verdaccio, OR a
clean green release will absorb it. The t3-2 RVF flake is the only thing standing between the
current state and a green release.

---

## Next steps (in order)
1. **Make `t3-2-concurrent` preserve its per-writer logs on failure** (it `rm -rf`'s them on
   every branch — that's why the real error was invisible). Surface a sample error in
   `_CHECK_OUTPUT`. Low-risk; do this first so the next CI failure is self-diagnosing.
2. **Fix the RVF lock (Part 1)** — fair blocking flock + no-clobber concurrent write, verified
   against the reproduction by `.rvf.meta` entryCount. Ruvector Rust + NAPI rebuild.
3. Reindex the ADR corpus (now 288-289 on disk vs 287 indexed) — idempotent post-ADR-0281.
4. Commit the orphaned patch.368 bump (or fold into the next green release).

## Gotchas
- The lock docstring **lies** (says FIFO-blocking; the impl is unfair LOCK_NB polling). Trust
  the code (lines ~164-209), not the header.
- Reproduction needs **extreme** load (the M5 Max shrugs off mild contention). 24 CPU + 6 IO
  hogs at N=16 cold-start is the floor that triggers it here.
- `memory list` has an RVF read-after-write freshness lag — use `.rvf.meta` entryCount as the
  authoritative persisted count when disambiguating Mode B.
- `RVF_LOCK_ACQUIRE_TIMEOUT_MS` env tunes the (current, wrong) poll timeout — useful for
  Mode A vs Mode B bisection, NOT a fix.
