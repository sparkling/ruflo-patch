# ADR-0133: RVF concurrent-write convergence regression — investigation + bisect

- **Status**: **Proposed (2026-05-03)** — P0 regression. Investigation pending. Blocks ADR-0094 close-criterion (3 consecutive green acceptance runs).
- **Date**: 2026-05-03
- **Deciders**: Henrik Pettersen
- **Depends on**: ADR-0095 (RVF inter-process write convergence — original Implemented 2026-04-20; **task #12 flock refcount in `crates/rvf/rvf-runtime/src/locking.rs` was a known open closure dependency per ADR-0111 §Status**), ADR-0079 (acceptance test completeness — owns `t3-2-concurrent`), ADR-0086 (Layer 1 storage abstraction RVF-first)
- **Related**: ADR-0130 (T11 RVF WAL fsync — prime suspect commit `4bc336ad5`), ADR-0127 (T9 adaptive topology — bundled in same commit), ADR-0094 (acceptance coverage living tracker — gates close on 3 consecutive green runs)
- **Scope**: Fork-side runtime in `forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts` and `forks/ruvector/crates/rvf/`. Closes the regression introduced after ADR-0095 originally landed. Does NOT redesign the dual-backend architecture — minimum-change to restore 6/6 convergence.

## Context

`t3-2-concurrent` (canonical RVF inter-process write probe per ADR-0079, anchored by ADR-0095 Sprint 1) is failing on the published `@sparkleideas/cli@3.5.58-patch.334`. The failure surfaced in the post-ADR-cleanup release run on 2026-05-03 (acceptance run `accept-2026-05-03T172507Z`).

ADR-0095 Sprint 1 originally closed BUG-0008 (Implemented 2026-04-20) with 6/6 concurrent writers converging at `entryCount === N`. This regression is post-2026-04-20 and likely introduced by the ADR-0130 T11 fsync ordering change (commit `4bc336ad5`) or the open ADR-0095 task #12 (flock refcount) never landing.

### Diagnostic evidence — 2026-05-03

Run: `node scripts/diag-rvf-interproc-race.mjs 6 --trials 5 --trace` against published `@sparkleideas/cli@3.5.58-patch.136`. Result: **0/5 trials passed.**

| Trial | Writers exit=0 | Writers exit=1 (sawSfvrMagic) | entryCount | Loss |
|---|---|---|---|---|
| t1 | 4 | 2 | 2 | 4/6 dropped |
| t2 | 5 | 1 | 1 | 5/6 dropped |
| **t3** | **6** | **0** | **null** | **6/6 silent loss — total** |
| t4 | 4 | 2 | 1 | 5/6 dropped |
| t5 | 5 | 1 | 1 | 5/6 dropped |

**Critical finding — Trial t3 silent total loss:** all 6 writers reported `exit=0 backend=converged`, yet the file ended unreadable (`entryCount=null`). Per memory `feedback-data-loss-zero-tolerance.md`: **5/6 is not shippable, 0/6 with no error signal is catastrophic.**

### Root-cause area — dual-backend magic-byte collision

Two backends coexist on the same `.rvf` path:

- **Pure-TS backend** writes magic `RVF\0` (`rvf-backend.ts:54 const MAGIC = 'RVF\0'`)
- **Native Rust backend** writes magic `RVFS` ASCII LE (`crates/rvf/rvf-types/src/constants.rs:3 pub const SEGMENT_HEADER_MAGIC: u32 = 0x52465653` — reads as `"SFVR"` from a byte-stream)

Pure-TS reader inspects the file's first 4 bytes:
- `RVF\0` → proceed as pure-TS file ✓
- `SFVR` → "native-owned, retry/dispatch" branch (already in code at `rvf-backend.ts:1064-1067`)
- partial / unknown → unsafe, refuse with `bad magic bytes` error (`rvf-backend.ts:218-223`)

The diag artifact at `/var/folders/mc/.../rvf-interproc-t5-ccyEjs.diag` reveals **two physical files coexist post-trial:**
- `.swarm/memory.rvf` (66KB, magic `RVF\0`, pure-TS format)
- `.claude-flow/memory.rvf` (162B, magic `SFVR`, native format)

This is a **path-resolution split** in addition to the magic race. `DEFAULT_DATABASE_PATH = '.claude-flow/memory.rvf'` per `resolve-config.ts:90`, but `t3-2-concurrent` and the diag harness target `.swarm/memory.rvf`. Some writers landed at one path, some at the other.

### Failure signature

Failing writer's stderr (verbatim from `writer-5.stderr`):
```
[ERROR] Failed to store: RVF storage at .swarm/memory.rvf is corrupt: bad magic bytes
(expected 'RVF\0', got "SFVR"). No WAL recovery data available. Refusing to start with
empty state to prevent silent overwrite of the corrupt file on next persist. Move or
delete the file to start fresh, or restore from a backup.
```

Successful writer's stderr (verbatim from `writer-1.stderr`): empty (clean exit). The race window is small enough that not every writer hits it.

## Suspect commits (since ADR-0095 Sprint 1 closed 2026-04-20)

| Commit | Subject | Why suspect |
|---|---|---|
| `4bc336ad5` | feat(adr-0127,adr-0130): T9 adaptive topology + T11 RVF WAL fsync | **Prime suspect.** T11 fsync ordering may release the inter-process lock before the meta-rename, widening the race window. |
| `a88487f08` | fix(rvf-backend): catch AlreadyExists from race-safe RvfStore::create | Touches the create path; could have changed retry semantics. |
| `571388979` | fix(rvf-backend): ADR-0095 d11 — fsync tmp file before rename | Earlier fsync change. |
| `06d7bf83f` | fix: 3 acceptance-triage follow-ups — LockHeld retry on create | Retry semantics on create. |
| `552f45c4c` | fix: ADR-0094 Sprint 1.4 — d8+d10 RVF write-amplification + LockHeld retry | Touches lock-retry path. |

Plus the **open ADR-0095 task #12** (flock refcount in `forks/ruvector/crates/rvf/rvf-runtime/src/locking.rs`) — never landed per ADR-0111 §Status closure dependencies. May be the actual root.

## Decision

**Bisect-driven investigation, no architectural change.** Steps:

### Phase 1 — Bisect to identify regression-introducing commit

1. Snapshot current state of `forks/ruflo` and `forks/ruvector`.
2. Revert `4bc336ad5` on `forks/ruflo` build branch (T11 fsync change). Re-run diag probe. If 6/6 passes → confirmed T11 is the regression; preserve revert and design a fixed T11 in Phase 2. If still 0/6 → revert next suspect.
3. Continue reverting suspect commits until `node scripts/diag-rvf-interproc-race.mjs 6 --trials 10` produces 10/10 (require full trial run, not just 5).
4. Document the exact regression-introducing commit in this ADR's §Bisect log.

**Pass condition:** 10 consecutive trials × 6 writers each = 60/60 entries persisted, 0 sawSfvrMagic signals.

### Phase 2 — Targeted fix at the regression-introducing commit

Once Phase 1 identifies the offending commit, the fix path branches:

- **If T11 fsync ordering is the cause**: redesign T11 to fsync BEFORE releasing the inter-process write lock. Verify durability invariant (ADR-0130 §Decision) still holds.
- **If ADR-0095 task #12 (flock refcount) is the cause**: implement the refcount per ADR-0095 spec in `crates/rvf/rvf-runtime/src/locking.rs`. This requires Rust changes + ruvector republish.
- **If path-resolution split is the cause**: align `DEFAULT_DATABASE_PATH` and the t3-2 harness target. Decide canonical: `.swarm/memory.rvf` (matches ADR-0086) vs `.claude-flow/memory.rvf` (current default).

### Phase 3 — Verify + close

1. Re-run `npm run release` end-to-end. `t3-2-concurrent` must pass.
2. Diag probe at higher concurrency: `node scripts/diag-rvf-interproc-race.mjs --trials 40` (full matrix N=2,4,6,8 × 10) — all combinations 100% convergence.
3. Three consecutive green acceptance runs with ≥2h gaps for ADR-0094 close-criterion.

## Out of scope

- Removing the dual-backend architecture (pure-TS + native Rust). The split exists for a reason (native binary not always available on user platforms); this ADR doesn't reopen the architecture decision.
- Reverting ADR-0117 R1 (`mcpServers.ruflo` key flip) — unrelated.
- Generalising RVF to multi-host distributed writes — out of scope for inter-process work on a single host.

## Acceptance criteria

- [ ] Phase 1: regression-introducing commit identified by bisect; recorded in §Bisect log with reproduction command + diag output before/after revert
- [ ] Phase 2: targeted fix lands on appropriate fork (`forks/ruflo` and/or `forks/ruvector`) preserving the original ADR's durability/correctness invariants
- [ ] Phase 3: `node scripts/diag-rvf-interproc-race.mjs --trials 40` reports 0 losses across all N values
- [ ] Phase 3: `t3-2-concurrent` PASS in 3 consecutive `npm run release` runs with ≥2h gaps (ADR-0094 close-criterion)
- [ ] No silent-loss path (trial t3 mode) ever observed again — every failure has explicit error signal to caller

## Bisect log

(To be filled in during Phase 1.)

| Date | Commit reverted | Diag result (N=6, trials=10) | Decision |
|---|---|---|---|
| 2026-05-03 | (baseline, no revert) | 0/5 FAIL — 4 sawSfvrMagic + 1 silent total loss (t3) | Confirmed regression on `@sparkleideas/cli@3.5.58-patch.136` |
| | | | |

## Why a separate ADR (vs amending ADR-0095)

Per memory `feedback-no-history-squash.md`: clean history is not a project goal — preserve the original ADR-0095 decision record. A regression after the original work landed is a new finding warranting its own decision record. ADR-0095 marks "Implemented 2026-04-20"; this ADR captures that the implementation regressed and how it's being recovered, without rewriting the original.

## References

- Diag probe: `/Users/henrik/source/ruflo-patch/scripts/diag-rvf-interproc-race.mjs`
- Diag artifact (t5 trial): `/var/folders/mc/84_j0pt91wg9c1yrc9b9sjtr0000gn/T/rvf-interproc-t5-ccyEjs.diag/`
- Acceptance check: `/Users/henrik/source/ruflo-patch/lib/acceptance-adr0079-tier3-checks.sh:127`
- Failed run: `/Users/henrik/source/ruflo-patch/test-results/accept-2026-05-03T172507Z/acceptance-results.json` (no per-test stderr captured — gap to address)
- ADR-0095 (parent): `/Users/henrik/source/ruflo-patch/docs/adr/ADR-0095-rvf-inter-process-convergence.md`
- ADR-0111 §Status (closure-dependency reference): `/Users/henrik/source/ruflo-patch/docs/adr/ADR-0111-upstream-merge-program.md`
