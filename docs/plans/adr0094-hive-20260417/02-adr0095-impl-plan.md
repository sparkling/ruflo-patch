# ADR-0095 Implementation Sprint Plan

## Design Decisions (still open)

ADR-0095 narrative says "mergePeerStateBeforePersist reads WAL only." **Source says otherwise** (rvf-backend.ts:1298-1381, committed pre-196100171): it already re-reads `.meta` *then* replays WAL under the lock. So the first design decision is **disambiguation**: the failure mode in the ADR is partially obsolete. The real gap must be one of:

- **D1 — Read ordering vs. fsync gap.** `mergePeerStateBeforePersist` uses `readFile(metaPath)` but the atomic rename path in `persistToDiskInner` is `writeFile(tmp)` + `rename(tmp→meta)`. On macOS APFS, rename is atomic for content visibility, but `fsync` is not invoked on the parent directory. Decide: do we need `fsyncDirSync(dir)` after rename before releasing the lock?
- **D2 — `seenIds` poisoning across sessions.** `seenIds` is seeded from our own `this.entries` at init. If process A initialized when `.meta.entryCount=0`, then process B wrote an entry before A's first merge, A's `seenIds` **does not contain** B's id, so set-if-absent correctly picks it up. BUT: if A later `bulkDelete`s its own entry, `seenIds` retains the tombstone. What if two writers legitimately write the *same* id (unlikely but possible via nanoid collisions, or via the CLI `memory store --key` pattern where ids are derived from key)? Decide tie-breaking: last-mtime wins? reject duplicate?
- **D3 — WAL ordering vs. `.meta` ordering.** Step 1 reads `.meta` (snapshot up to writer-N's last compaction), step 2 replays WAL (entries from writer-N+1…). If writer-N is still inside its critical section between `writeFile(.meta.tmp)` and `unlink(wal)`, a concurrent writer B acquiring the lock next sees *both* the new `.meta` **and** the old WAL. Does replayWal double-count? Verify: the seenIds gate protects against that, but only if the WAL entries carry the same ids as the .meta entries (they do — ids are assigned pre-WAL-append). OK, likely safe; still document.
- **D4 — Native sidecar interplay (ADR-0092).** Current merge path at 1311-1317 only reads `.meta` when native is active. But after compaction, native writes to the main path while `.meta` remains. If process A is native and process B is pure-TS, B's compaction writes `.meta` only, A's compaction writes main+`.meta`. Decide: is `.meta` the canonical pure-TS source-of-truth always, regardless of which process compacted it? Yes — codify and add a comment.
- **D5 — Atomicity scope.** Keep the merge single-phase (current model) or split into (a) snapshot-under-lock, (b) compute, (c) rename-under-lock? Single-phase is simpler and already held by the lock for the whole persist. Keep single-phase.
- **D6 — Fsync strategy.** Add `await fsync(fd)` on the `.meta` write and `fsyncDir(dir)` before releasing lock? Or rely on POSIX rename atomicity? For the acceptance gate (`entryCount=6` after 6 subprocess exits), durability across process death matters. **Propose: fsync .meta + directory** before releasing lock; measure latency cost.

## Swarm

6 agents, **hierarchical**. Mesh is wrong here — there's a tight dependency chain (reproduce → probe → fix → verify).

- `coordinator` (1) — owns the ADR, sequences phases, calls the gate.
- `root-cause-investigator` (1, runs FIRST) — reproduces `t3-2-concurrent` at N=6, captures `.rvf` `.rvf.meta` `.rvf.wal` snapshots mid-race, proves *which* of D1/D2/D3/D4 is the actual failure. **Without this step the implementer is coding blind** — the ADR's stated failure mode contradicts current source.
- `architect` (1) — reviews the investigator's findings vs. D1–D6, rules the design, writes the amendment note on ADR-0095.
- `implementer` (1) — single coder edits `rvf-backend.ts`. One file, tight scope; splitting risks merge conflicts.
- `adversarial-reviewer` (1, runs parallel with implementer) — argues against the fix per ADR-0087: "what if rename is not atomic?", "what if `.meta` read is stale by one epoch?", "what if native sidecar diverges?"
- `probe-and-integration-tester` (1, runs parallel with implementer) — writes the out-of-scope probe + the 6-subprocess integration test. Drives CI gate.

## Out-of-Scope Probe

**Name:** `scripts/diag-rvf-interproc-rename-atomicity.mjs`

**Contract:** The ADR-0095 fix assumes POSIX-style atomic rename semantics across processes on the filesystem under the user's data dir (APFS/ext4/NFS). Probe fabricates 8 subprocesses, each writing a 100KB `.meta.tmp` with a unique marker byte at offset 0 and renaming to a shared `.meta` target under a shared advisory lock, 200 iterations. After each rename, a 9th "observer" subprocess concurrently `readFile`s the target and asserts the read is ALWAYS either "completely writer-i" OR "completely writer-j" — never a torn mix (prefix of i, suffix of j). On any torn read, probe exits 2 with the torn offset. Also asserts `fs.statSync(target).size` never appears as 0 mid-rename.

This disproves the **opposite** assumption ("rename is torn-observable"). If the probe fails, the fix must switch to a real file-lock + full-content-write-under-lock model (Alternative C).

Second probe: `scripts/diag-rvf-interproc-fsync-durability.mjs` — 6 subprocesses write + `SIGKILL`-self immediately after their `rename` returns. Assert the surviving `.meta` contains 6 entries when re-read from a fresh process. Disproves the "rename without fsync is durable across process death" assumption.

## Parallelism

Sequential: root-cause-investigator → architect ruling. Then parallel: implementer + adversarial-reviewer + probe-writer + integration-tester all in one Task batch. After results converge, coordinator runs full cascade.

## Gate

All of: (a) `t3-2-concurrent` green 3 consecutive cascade runs across 3 calendar days, (b) `diag-rvf-interproc-race.mjs` 40/40 at N=2/4/8, (c) `diag-rvf-interproc-rename-atomicity.mjs` 200 iterations 0 tears, (d) `diag-rvf-interproc-fsync-durability.mjs` 6/6 survivors, (e) `adr0086-rvf-integration.test.mjs` 6-subprocess case green, (f) BUG-0008 → `verified-green` then `closed`, (g) ADR-0094 Open Item #1 struck through, (h) latency microbench: persist P95 ≤ 50ms at N=8 (ADR-0095 §Risks line 85), (i) no new `catch {}` silent-swallow additions (ADR-0082 grep guard).

## Risks

- **ADR-0086 compatibility** — fork commit history shows 3 shifts in better-sqlite3 placement; ADR-0095 must not reintroduce SQLite-first assumptions. Verify by grepping for `bsqlite` imports in `rvf-backend.ts` after the fix (should be zero).
- **Latency regression** — double-read (meta + WAL) + new fsync calls cost ~5-15ms on APFS. Mitigation: fsync only on final persist (shutdown compact), not autoPersistInterval.
- **Native coexistence (ADR-0092)** — `.meta` sidecar is canonical source-of-truth for pure-TS metadata, even when native owns main. Adversarial reviewer must verify re-read path at 1311 doesn't regress BUG-0005 (SFVR magic misread).
- **seenIds tombstone erosion** — long-lived sessions accumulate unbounded seenIds. Existing debt; not ADR-0095's problem but flag for ADR-0096 candidate.
- **ADR-0082 pressure** — several `try/catch {}` blocks in `mergePeerStateBeforePersist` (lines 1362, 1368-1371). Each must be audited: silent skip of a single corrupt WAL entry is acceptable; silent skip of a whole `.meta` read is a data-loss vector. Tighten where needed.
