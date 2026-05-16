---
status: proposed
date: 2026-05-16
tags: [pipeline, performance, ssd-wear, fseventsd, acceptance, build]
supersedes: []
depends-on: [ADR-0025, ADR-0038, ADR-0039, ADR-0048, ADR-0150]
implements: []
---

# Minimise file-copy churn across the release pipeline

## Context and Problem Statement

`npm run release` performs ~192k–260k file write events per release on a no-source-change rerun. On an M5 Max MacBook Pro (36 GB, APFS) this is load-bearing on two axes the user cares about more than wall time:

1. **SSD endurance.** Repeated release cycles during a heavy ADR-0181 wire-up loop (~25 releases/day across a multi-day council session) accumulate hundreds of millions of NAND-cell write events against finite flash lifespan. The user has explicitly flagged this as the primary perf concern; wall-time wins are secondary.
2. **`fseventsd` kernel buffer accumulation.** `fseventsd` records every file event in its in-memory ring; observed RSS reached 10.7 GB before manual flush on this machine. Spotlight was excluded for `/tmp/ruflo-*` via the marker landed in commit `36b1b55`, but a marker only suppresses Spotlight indexing — it does not suppress `fseventsd` event-record creation. Every file under `/tmp` still generates an event entry.

The 2026-05-16 analyst pass quantified the per-release write surface:

| Phase | Files written / read | Persistence |
|---|---|---|
| copy-source rsync (5 forks, `-a --delete` with PROTECT filters) | ~105k stats, mtime-syncs delta only | `/tmp/ruflo-build` persistent (16 GB) |
| codemod (32,592 files scanned, 4,782 writes; 0 cache hits last release) | ~4.8k writes | in `/tmp/ruflo-build` |
| build (tsc emit, ~7–10k dist files; incremental works) | ~7–10k writes | in `/tmp/ruflo-build` |
| publish-verdaccio (~40 `npm publish`, ~80 tarballs, ~160 MB) | ~80 tarballs/release | `~/.local/share/verdaccio/storage` (19 GB, no GC) |
| acceptance: main install (`/tmp/ruflo-accept-XXXX`, fresh `mktemp -d`) | ~58k files / ~2.0 GB | per-release, in cleanup trap |
| acceptance: wrapper-solo install (`/tmp/ruflo-wrapper-solo-XXXX`, fresh `mktemp -d` + isolated `--cache`) | ~59k files / ~1.7 GB | per-release, **not in cleanup trap** — orphans on interrupt |
| acceptance: P5 background init (`/tmp/ruflo-p5-XXXX`) | ~338 files | per-release, **not in cleanup trap** — orphans every run |
| acceptance: e2e snapshot (`cp -r "$ACCEPT_TEMP/." "$E2E_DIR/"`) | ~58k file copies | per-release, in cleanup trap |
| acceptance: `_e2e_isolate` (173 call-sites, ~15 file copies each) | ~3k file copies | inside E2E_DIR |
| acceptance: per-check `mktemp -d /tmp/...` (91 patterns, ~40 do their own `init --full`) | ~13.5k files | per-check, individual `rm -rf` — leaks on bash error |
| acceptance: persistent npx cache | +1–2k files | `/tmp/ruflo-accept-npxcache` (37 GB, no LRU prune) |
| **Per-release total (acceptance + pipeline)** | **~192k–260k file writes** | mixed |

The dominant *re-execution* contributors are the two npm installs (~117k files combined) and the e2e snapshot duplication (~58k file copies). The dominant *orphan* contributors are wrapper-solo dirs (4 of the 5 largest leftovers on `/tmp` today are 2.6 GB wrapper-solo orphans), per-check `mktemp -d /tmp/...` dirs (11 leftover `ruflo-adr0100-*`, 5 leftover `ruflo-adr0177-*`), and the unbounded npx cache (37 GB).

Recent perf work landed (build phase already largely optimised):

- `36b1b55` — Spotlight marker on `/tmp/ruflo-*`
- `3db6ea463` (forks/ruflo) — `onnx-warmer` kills `npx @latest` in `init.ts`
- `d86bea2` — `_HEAVY_CHECK_IDS` skip set
- `20730d2` — node_modules cache reverted (reconciliation cost > fresh install at the main-install layer)
- `212d67c` — reverted `--ignore-scripts` on cache-restored install (proves at least one `@sparkleideas/*` package has a non-idempotent postinstall — load-bearing for L3 below)
- `b3d556f → bd5d878` — "share wrapper-solo install across 3 wrapper-install checks" landed 2026-05-07 02:21, reverted 2026-05-07 02:24 with no recorded reason. Load-bearing prior-art for L1 below; bisecting the revert trigger is a hard prerequisite to re-attempting
- `6e4da40` — incremental tsc (rsync excludes stale `.tsbuildinfo`)
- `aa1de25` — test pinning the new contract

Latest run (r11): 669/0/9, acceptance total 308s (−18.6s vs baseline). Wall-time progress is real; the SSD/fseventsd surface has barely been addressed.

## Decision Drivers

* **SSD wear is the primary cost.** Reducing file *events*, not wall time, is the success metric.
* **`fseventsd` accumulation scales with event count regardless of Spotlight markers.** Every file write under `/tmp` generates an event record; the marker only suppresses Spotlight content-indexing, not the kernel event ring.
* **`feedback-no-fallbacks` / `feedback-data-loss-zero-tolerance`.** Any cross-release reuse must fail loudly when stale state corrupts a check. Better to invalidate-and-reinstall than to silently produce false-pass results.
* **CLAUDE.md "THREE COMMANDS" boundary stays inviolate.** Changes here must not change the user-facing entry points (`npm run test:unit`, `bash scripts/test-acceptance-fast.sh --group <group>`, `npm run release`).
* **Recent revert (`20730d2`, node_modules cache) is informative, not blocking.** The revert proved that caching only the main install breaks even on wall time. This ADR proposes broader cache surface (main + wrapper-solo + e2e snapshot) so the freed time pays for the reconciliation cost.
* **Build-phase optimisations already landed.** `copy-source` rsync, codemod hash cache, and `--incremental` tsc cover the build half adequately. This ADR's primary scope is the acceptance half (which writes ~3× as many files per release as the build half).
* **No `forks/` changes.** Per the task scope, fork code is out of scope. All changes land in `ruflo-patch` (`scripts/`, `lib/`).

## Considered Options

* **Option A — Status quo + Spotlight marker only.** Continue with `mktemp -d` per phase, rely on cleanup traps, accept the 192k–260k event surface. Rejected: doesn't address the primary cost.
* **Option B — Reduce file-copy churn end-to-end (chosen).** Persistent install dirs (main + wrapper-solo merged or shared), copy-on-write e2e snapshot, per-check workdirs reparented under `$ACCEPT_TEMP`, npx cache LRU pruning, Verdaccio storage GC, stale-dir startup sweep widened, cleanup-trap coverage extended. Each lever is independent and ship-able in isolation.
* **Option C — Move the whole pipeline onto a RAM disk (`hdiutil attach -nomount ram://`).** Eliminates SSD wear entirely for `/tmp` writes. Rejected: 36 GB host RAM is tight for a ~25 GB working set (build + accept + e2e + npx cache); RAM disk eviction breaks the persistent ONNX cache + npx cache contracts (ADR-0048, ADR-0025); the marker-style mitigation is per-process and per-release while a RAM disk is per-host and survives across user sessions.
* **Option D — Run the pipeline in a Docker / Lima VM with its own filesystem.** Same goal as C with isolation. Rejected: doubles the trust surface (VM filesystem + macOS host filesystem still both see file events at the host layer); `napi build` cross-compilation matrix becomes brittle; out of scope as a release-time concern.
* **Option E — Switch `/tmp` → tmpfs-style mount.** macOS doesn't ship a real tmpfs; `/tmp` is already on APFS. Rejected as not architecturally available.
* **Option F — Replace remaining `cp` sites with `rsync` instead of `cp -cR` (L2).** Rejected. `rsync`'s strength is incremental delta-update against an existing baseline, but every remaining `cp` site in the pipeline operates on a FRESH destination (mktemp'd per release). With no baseline to diff against, `rsync` reads + writes every file in user space — same I/O profile as `cp -r`, plus per-file compare overhead. Critically, `rsync` does not support reflink / `clonefile(2)`, so it bypasses APFS's CoW semantics entirely. Concrete e2e-snapshot comparison: `cp -r` reads 58k files × ~35 KB = ~2 GB read + ~2 GB written to flash, ~6-10s wall. `cp -cR` reads 58k inodes only + writes ~3 MB inode-table updates, ~200 ms wall. `rsync` would compare 58k file sizes/mtimes against an empty dest (every file flagged "new") then read + write ~2 GB, ~5-8s wall — strictly worse than `cp -cR` and matches `cp -r` on bytes-on-flash. The intuition "rsync to avoid copying" only holds when there is a stable destination baseline to diff against; that condition does not exist at any remaining `cp` site in this pipeline. (Where rsync DOES help — `scripts/copy-source.sh`'s 5 parallel fork→`/tmp/ruflo-build` syncs — it is already in use; see ADR-0038.)

## Decision Outcome

Chosen option: **Option B — reduce file-copy churn end-to-end with four large levers + five hygiene levers**, prioritised by expected SSD-write-byte reduction per release. Each lever is implementable and verifiable in isolation; none of them requires touching the canonical user-facing entry points or `forks/`.

> **Reviewer note (DA round 1, 2026-05-16):** an earlier draft included an "L5 — codemod content-equality short-circuit" lever projecting ~1.5–3k saved writes/release. DA grepped `scripts/codemod.mjs` and found the short-circuit is already implemented (`if (transformed !== content) { writeFile(...) }` at line 609; the package.json branch at L562-585 likewise reads → parses → only writes on `changed`). The lever was dropped; total projected wins adjusted downward accordingly.

### Levers (prioritised by SSD-write-byte reduction)

| # | Lever | Writes / bytes reduced per release | Risk | Mitigation |
|---|---|---|---|---|
| L1 | **Drop wrapper-solo dedicated install; verify against main `$ACCEPT_TEMP`** | **~59k writes + ~1.7 GB + ~70s wall** | The same idea was tried as `b3d556f` (2026-05-07, "share wrapper-solo install across 3 wrapper-install checks") and reverted 2 hours later as `bd5d878` with no recorded reason. The original failure mode is unrecovered evidence — re-landing the lever without first reproducing the revert trigger is high-risk | (a) Before landing, bisect `b3d556f` vs `bd5d878` to identify the revert trigger (likely a failing wrapper-check that the shared install masked). (b) Land L1 only behind `RUFLO_SHARED_WRAPPER_INSTALL=1` first; require ≥3 consecutive green releases under the flag before promoting to default. (c) **Kill-switch:** if not promoted to default within 4 weeks of landing, the flag and shared-install code path are fully reverted — no orphan env var. (d) If the original revert trigger cannot be identified by the bisect, L1 is dropped entirely; the orphan-cleanup case (L6 registers WRAPPER_SOLO_TEMP in trap) covers the leftover-dir damage independently |
| L2 | **e2e snapshot via APFS clonefile (`cp -cR`) instead of `cp -r`** | **~2.0 GB byte-copies avoided** (event-count win is smaller than first claimed; see Confirmation §Metrics) | `cp -c` is APFS-only; macOS `cp -c` is documented as non-standard; clone breaks on cross-volume operations. Earlier "1 clone op" framing was wrong — `cp -cR` invokes `clonefile(2)` per regular file, so `fs_usage` still reports ~58k clonefile events (the win is in *bytes written*, not events) | Feature-probe with a **real regular file**, not `/dev/null` (which clonefile(2) refuses — see DA round 1 B2): `_cow_src=$(mktemp /tmp/.cow-src.XXXX); echo x > "$_cow_src"; _cow_dst=$(mktemp -u /tmp/.cow-dst.XXXX); cp -c "$_cow_src" "$_cow_dst" 2>/dev/null && HAS_COW=1; rm -f "$_cow_src" "$_cow_dst"`. Fall back to `cp -al` on Linux/foreign-FS; `cp -r` as last resort. Each branch logs which path fired. Pin macOS version ≥26 (current host) in the probe. **Primary metric for this lever is SSD-write-bytes, not events_write** |
| L3 | **Persistent ACCEPT_TEMP with per-release reconcile** (re-use `node_modules` across releases when CLI version + lockfile hash unchanged) | **~58k writes / ~2.0 GB when cache-hit** (most no-source-change reruns) | The `20730d2` revert + the earlier `212d67c` revert ("`--ignore-scripts` on cache-restored install") proved that the failure mode is **npm reconciliation cost + postinstall idempotency**, not cache-key breadth. Re-attempting this lever has to address the underlying disease, not the cache scope | Hard requirements: (i) On cache-hit, **skip `npm install` entirely** — don't re-run it against the pre-populated dir (that's the failed 436c76a model). (ii) Cache key = SHA-256 of (resolved `@sparkleideas/cli@latest` version + resolved `@sparkleideas/ruflo` version + `@sparkleideas/cli`'s shipped package-lock content). Any publish invalidates the cache by construction. (iii) Postinstall idempotency: integration test must prove that `node_modules/@sparkleideas/*/dist/` is byte-identical between a cache-hit path and a cache-miss path; if postinstall produces non-deterministic output, L3 is rejected. (iv) **Epoch guard:** ACCEPT_TEMP writes a `.release-epoch` file containing the cache-key hash; harness startup verifies the epoch matches the freshly-computed key and nukes-fresh on mismatch or missing file (covers crashed prior releases). (v) Lands behind `RUFLO_PERSISTENT_ACCEPT=1`. (vi) **Kill-switch:** if not promoted to default within 4 weeks of landing, the flag + cache-resolution code are fully reverted |
| L4 | **Reparent per-check `mktemp -d /tmp/...` patterns under `$ACCEPT_TEMP/_check_workdirs/${id}-XXXX`** | **~13.5k writes/release move from `/tmp` to ACCEPT_TEMP** (already covered by cleanup trap) + eliminates 91 distinct orphan sources | (a) Mechanical regex `s\|mktemp -d /tmp/<id>-XXXXX\|mktemp -d "${ACCEPT_TEMP:-/tmp}/_check_workdirs/<id>-XXXXX"\|g` covers ~85 of the 91 sites; the remaining 6–8 have hard-coded `/tmp/` paths and need by-hand fixes. (b) Ad-hoc invocations outside the harness must still work | Ship as a single mechanical sed/awk pass over `lib/acceptance-*.sh`; commit the by-hand fixes in a follow-up. Reparent template uses `${ACCEPT_TEMP:-/tmp}` so ad-hoc check invocations (no harness wrapper) fall back to `/tmp` — and ad-hoc invocations don't have the trap-coverage promise anyway. This is documented (not silenced) in the patch commit |

Five smaller levers (worthwhile but separately scoped):

| # | Lever | Files reduced | Notes |
|---|---|---|---|
| L6 | Register `WRAPPER_SOLO_TEMP` + `_P5_DIR` in cleanup trap | Eliminates ~2 orphan classes | 2-line patch in `test-acceptance.sh:119-172`. Ships *first* — provides orphan-cleanup safety even if L1 is dropped after the b3d556f bisect |
| L7 | Widen stale-sweep glob at startup (extend `find /tmp -maxdepth 1 -name "ruflo-accept-*"` to also match `ruflo-wrapper-solo-*`, `ruflo-p5-*`, `iso-*`, `ruflo-adr0*-*`, `t3-*-rvf-*`, `b2-*-work-*`, `p9-*-*`) | Eliminates leftover-dir accumulation across crashed releases | `test-acceptance.sh:198` |
| L8 | Verdaccio storage GC: keep last N tarballs per package | Caps `~/.local/share/verdaccio/storage` at ~700 MB (from 14 GB) | New script `scripts/verdaccio-gc.mjs`. Pre-GC check: enumerate all currently-pinned `-patch.N` refs in `forks/*/package.json` and the test corpus; refuse to drop a tarball that is still resolvable from any active source. Fires opportunistically at end of `ruflo-publish.sh` |
| L9 | npx `_cacache` LRU prune (current sweep only clears `_npx` aliases) | Caps `/tmp/ruflo-accept-npxcache` at ~5 GB (from 37 GB) | Extend `test-acceptance.sh:700` |
| L10 | Migrate remaining ~130 `_e2e_isolate` call-sites to `_with_iso_cleanup` RETURN-trap pattern + add fail-loud dangling-symlink guard | Eliminates leak surface on bash-error early-exit + closes the L3 cross-release symlink hazard | Mechanical refactor; 41 sites already use this. **Symlink fail-loud:** `_e2e_isolate` at `lib/acceptance-e2e-checks.sh:29` currently does `ln -sf "$E2E_DIR/node_modules" "$iso_dir/node_modules" 2>/dev/null \|\| true` — change to verify `realpath -e "$E2E_DIR/node_modules"` first and fail-loud (`echo "[error]" >&2; return 1`) if the target dangles. This catches the case where a crashed prior release left stale iso symlinks pointing into deleted space |

L1–L4 are the load-bearing wins (~190k file-events of the ~192k total per-release surface, ~5.7 GB of byte-copies/installs). L6–L10 are hygiene improvements: each is small, mechanical, and ships independently.

### Out of scope for this ADR

- **`cross-repo/ruvector/target/` rsync exclusion** (16 GB, 13 GB of which is Cargo `target/`). Pipeline-analyst flagged this as the largest single contributor on the build half. It's a build-half concern with its own risk profile (ruvector currently relies on `target/` cache survival for napi rebuild speed per ADR-0150) and is scoped to a separate follow-up.
- **`.tsconfig.build.json` generation cache** (40 node spawns/release). Build-half concern; see L5 of the codemod work for the precedent.
- **`.npmignore` / `.gitignore` unconditional `find … -delete` sweep** in `build-packages.sh:45`. Build-half concern; trivial cache gate worth a separate small commit.

### Consequences

* Good, because **SSD-write-bytes per no-source-change rerun drop by ~5.7 GB** (L1 1.7 GB install + L2 2.0 GB e2e snapshot bytes + L3 2.0 GB main install when cache-hit). This is the load-bearing win — file-event count and SSD-write-bytes are non-equivalent metrics (see Confirmation §Metrics).
* Good, because `fseventsd` event-record count drops from ~192k/release to ~70k/release (L1 saves ~59k events directly; L2 *retains* its ~58k clonefile events but those are metadata-only; L3 saves ~58k when cache-hit; L4 reparents ~13.5k events from `/tmp` into ACCEPT_TEMP — they still register with fseventsd but cluster under one trap-covered prefix).
* Good, because orphan-dir accumulation on `/tmp` (74 GB today) drops to near-zero via L6 + L7 + L10's symlink fail-loud.
* Good, because Verdaccio storage and npx cache stop growing unbounded (L8, L9).
* Good, because the 4 large + 5 hygiene levers are independently ship-able — partial landing still delivers proportional wins, and each can be rolled back if it surfaces a regression.
* Bad, because **L1 has unrecovered prior-art evidence**: `b3d556f → bd5d878` two-hour revert cycle on 2026-05-07 implemented essentially the same shared-wrapper-install idea and bounced. Re-landing without bisecting the revert trigger risks repeating the regression. The pre-flight bisect requirement in the L1 mitigation column is load-bearing, not optional.
* Bad, because **L3 has the heaviest correctness contract** — postinstall idempotency must be proven by integration test, not assumed. The `212d67c` revert ("revert `--ignore-scripts` on cache-restored install") proves at least one `@sparkleideas/*` package has a non-idempotent postinstall; that package must be identified and either fixed or excluded from L3's cache scope.
* Bad, because L2's APFS clonefile is platform-specific. On a foreign FS (NFS-mounted scratch dir, ZFS, ext4 in a Linux CI runner) the fallback to `cp -al` or `cp -r` kicks in. Each branch logs which path fired — silent regression is avoided. The fork's CI today runs only on the user's M5 Max so foreign-FS support is theoretical.
* Bad, because L4 reparents under `${ACCEPT_TEMP:-/tmp}` — when ACCEPT_TEMP is unset (ad-hoc check invocation outside the harness), the workdir lands at `/tmp/_check_workdirs/...` *which the trap doesn't cover*. Ad-hoc invocations were never trap-covered before either, but the patch must document this rather than imply universal coverage.
* Neutral, because the canonical entry points (`npm run release`, `bash scripts/test-acceptance-fast.sh --group <group>`, `npm run test:unit`) are unchanged. Users see no behaviour delta except faster runs.
* Neutral, because the `feedback-no-fallbacks` / `feedback-data-loss-zero-tolerance` rules are honoured: L1's bisect requirement names the failure mode before re-landing; L2's clonefile probe + branch-logging makes the fallback explicit; L3's epoch guard + integration test gate the cache; L10's symlink fail-loud replaces a silent `2>/dev/null || true`.

### Confirmation

* **Gate.** `npm run release` is the only release-time gate. Each lever lands behind a feature env-var first (`RUFLO_SHARED_WRAPPER_INSTALL=1`, `RUFLO_E2E_CLONEFILE=1`, `RUFLO_PERSISTENT_ACCEPT=1`) so it can be A/B-compared against the baseline before becoming default.
* **Metric — SSD-write-bytes (primary).** SSD-write-bytes per release is the SSD-wear proxy the user actually cares about. Capture via `ioreg` on macOS 26.x (`iostat -K` and `diskutil info WriteBytes` documented in earlier drafts do not exist on this host — DA round 2 R1):
  ```bash
  # pre-release
  ioreg -c IOBlockStorageDriver -r \
    | awk '/"Bytes \(Write\)"=/{gsub(/[^0-9]/,"",$0); print; exit}' \
    > /tmp/ioreg-pre

  npm run release

  # post-release; diff is the release's contribution to cumulative writes
  ioreg -c IOBlockStorageDriver -r \
    | awk '/"Bytes \(Write\)"=/{gsub(/[^0-9]/,"",$0); print; exit}' \
    > /tmp/ioreg-post
  echo $(( $(cat /tmp/ioreg-post) - $(cat /tmp/ioreg-pre) )) >> logs/release-disk-bytes.jsonl
  ```
  Append to `logs/release-disk-bytes.jsonl`. **Caveat:** `ioreg` cumulative counters include EVERY write to disk0 across all processes during the release window — concurrent browser/IDE/Spotlight writes land in the same bucket. The guard-band threshold below absorbs this. Optional higher-fidelity capture for forensic re-runs: `sudo fs_usage -w -f filesys ./scripts/ruflo-publish.sh` gives per-syscall byte accounting but requires sudo and is high-overhead — not the default gate. Hard gate: SSD-write-bytes per release must not exceed `max(baseline × 1.10, baseline + 100 MB)`. The `+ 100 MB` floor absorbs unrelated host activity below which the metric is too noisy to be meaningful.
* **Metric — fseventsd event count (secondary).** `scripts/measure-file-events.sh` uses `fs_usage -w -f filesys ... | awk` to count write/clonefile events during a release. Append to `logs/file-events.jsonl`. **Soft gate (target, not hard fail)**: event count should drop, but L2's clonefile count is by-design ~equal to the prior `cp -r` open/write count — the win is in *bytes* per event, not event count.
* **Metric — wall-time.** Existing `timing-report.mjs` already records per-phase wall. Each lever ships a net wall-time neutral-or-better delta in addition to the byte-reduction win.
* **Acceptance correctness invariant (hard gate).** `npm run release` must satisfy, vs the baseline measured at the lever's landing time:
  - Pass count must **not decrease**.
  - Fail count must remain **0**.
  - Skip count must **not increase**.
  Any lever that regresses any of those three is reverted. (Hard-coded "669/678" numbers drift; these three contracts don't.)
* **L1 pre-flight (hard requirement).** Before landing L1, bisect `b3d556f` vs `bd5d878` to identify which acceptance check failed and why. Cite the trigger in the L1 commit message. If the trigger cannot be identified, L1 is dropped.
* **L3 cross-release correctness (hard requirement).** Add `tests/integration/persistent-accept-cache.test.mjs` proving: (a) cache invalidates on `@sparkleideas/cli` version bump; (b) cache invalidates on `.release-epoch` mismatch; (c) `node_modules/@sparkleideas/*/dist/` is byte-identical between cache-hit and cache-miss paths (postinstall idempotency). Lever does not promote to default until all three pass.
* **Kill-switch (hard requirement for L1 and L3).** If `RUFLO_SHARED_WRAPPER_INSTALL=1` or `RUFLO_PERSISTENT_ACCEPT=1` is not promoted to default within 4 weeks of landing (commit date + 28 days), the env var, its code path, and the integration test are fully reverted. No orphan opt-in flags.

## Pros and Cons of the Options

### Option B (chosen) — four large + five hygiene levers

* Good, because each lever is ship-able in isolation; staged landing reduces blast radius.
* Good, because SSD-write-bytes is directly measurable via `ioreg -c IOBlockStorageDriver` deltas, so the load-bearing user-facing metric is not speculative.
* Good, because L1 and L3 carry explicit kill-switches (4-week promote-or-revert) so a stalled A/B experiment doesn't leave orphan opt-in flags.
* Bad, because L1's prior-art (`b3d556f → bd5d878`) is a documented failure of the exact same idea. The bisect requirement is a hard prerequisite, not a nice-to-have.
* Bad, because L3 reintroduces the cross-release state question that both `20730d2` and `212d67c` reverts opted out of. The reverted approach failed on npm reconciliation cost + postinstall non-idempotency, not cache-key breadth. L3's integration-test gate must prove postinstall idempotency before promotion.
* Bad, because L4's `${ACCEPT_TEMP:-/tmp}` fallback for ad-hoc invocations weakens the "trap-covered scope" invariant for one specific call path. Documented, not silenced.

### Option C — RAM disk

* Good, because eliminates SSD wear entirely for `/tmp` events.
* Bad, because 36 GB host RAM is tight; the ~25 GB working set leaves <11 GB for the rest of the system + browsers + dev tools.
* Bad, because the persistent ONNX cache (`~/.cache/agentdb-models`, ADR-0048) and npx cache (`/tmp/ruflo-accept-npxcache`, ADR-0025) both rely on cross-release survival. Putting them on a RAM disk breaks both contracts.
* Bad, because `fseventsd` still records events for `/tmp` regardless of backing store — the kernel doesn't know the FS is in-memory. So RAM disk solves SSD wear but not `fseventsd` accumulation.

### Option D — Docker / Lima VM

* Good, because full isolation.
* Bad, because doubles trust surface for `napi build` cross-compilation matrix.
* Bad, because host filesystem still sees mount events (does not fix `fseventsd`).

### Option F — rsync everywhere instead of `cp -cR` (L2)

* Good, because conceptually appealing — "incremental copy" feels like the right answer for "minimise file copying."
* Bad, because every remaining `cp` site operates on a fresh `mktemp` destination. No baseline → no delta → rsync degrades to `cp -r` with compare overhead.
* Bad, because rsync has no reflink / `clonefile(2)` support. On APFS it bypasses CoW entirely and writes full file bytes to flash. `cp -cR` writes only inode-table updates (~50 B/file) and defers data writes until a side mutates.
* Bad, because the architecturally-correct rsync site is `scripts/copy-source.sh` (5 parallel fork→build delta syncs), and that's already in production via ADR-0038.

## More Information

### Implementation roadmap

A future implementer reads this ADR and lands levers in this order, each as a separate commit on `main`:

1. **L6** (cleanup trap registration) — 2-line patch, lowest risk, ships immediately. Provides orphan-cleanup safety even if L1 is later dropped.
2. **L7** (widened stale-sweep glob) — one-line `find` extension; ships immediately.
3. **L10** (iso symlink fail-loud guard) — change `lib/acceptance-e2e-checks.sh:29` from `ln -sf … 2>/dev/null || true` to `realpath -e` check + fail-loud. Closes the cross-release symlink hazard before L3 lands.
4. **L4** (per-check workdir reparenting) — single mechanical regex pass `s|mktemp -d /tmp/<id>-XXXXX|mktemp -d "${ACCEPT_TEMP:-/tmp}/_check_workdirs/<id>-XXXXX"|g` over `lib/acceptance-*.sh`. The 6–8 hard-coded `/tmp/` paths are fixed by hand in a follow-up commit. No "audit" — just the sweep.
5. **L2** (e2e clonefile) — extract `_acceptance_snapshot()` helper that probes COW with a real regular file (NOT `/dev/null` — see DA round 1 B2), falls back to `cp -al`, then `cp -r`. Each branch logs which path fired. Lands in `test-acceptance.sh:385-387`.
6. **L1** (drop wrapper-solo install) — **prerequisite: bisect `b3d556f`/`bd5d878` to identify the 2026-05-07 revert trigger** before any code lands. With the trigger documented, replace `mktemp -d "/tmp/ruflo-wrapper-solo-XXXXX"` block in `test-acceptance.sh:235` and re-target the 3 wrapper checks (adr0142 bin-path, adr0142 MCP JSON-RPC, adr0143 init MCP) at `$ACCEPT_TEMP`. Lands behind `RUFLO_SHARED_WRAPPER_INSTALL=1`. 4-week kill-switch.
7. **L3** (persistent ACCEPT_TEMP with cache key) — new module `lib/accept-cache.sh` exporting `_resolve_accept_temp()`. Cache key SHA-256 over (resolved `@sparkleideas/cli` version + resolved `@sparkleideas/ruflo` version + `@sparkleideas/cli`'s shipped `package-lock.json` content). Writes `.release-epoch` to ACCEPT_TEMP. Startup verifies epoch matches; nukes-fresh on mismatch/missing. Integration test in `tests/integration/persistent-accept-cache.test.mjs` proves invalidation triggers + postinstall byte-identity. Lands behind `RUFLO_PERSISTENT_ACCEPT=1`. 4-week kill-switch.
8. **L8, L9** — hygiene levers; ship in any order after L1–L7.

### Open questions for implementer

* **Postinstall identity (L3).** Which `@sparkleideas/*` package was the trigger for `212d67c` (revert `--ignore-scripts` on cache-restored install)? Identifying it pre-implementation lets the L3 integration test target that package's postinstall specifically. If postinstall non-determinism cannot be characterised, L3's gate is unmeetable and the lever is rejected.

* **L1 revert trigger (`bd5d878`) — cold-trail policy.** The revert commit message says only "Revert b3d556f"; the original lasted ~2 hours on `main` before bouncing. `git reflog` may surface the trigger; failing that, the `081a8f5` ("background install, join before wave") commit hints — perhaps the install was not in fact "stateless wrt install dir" as the original commit claimed. **Policy if the trail goes cold (DA round 2 answer):**
  - **Default — drop L1 entirely.** The wrapper-solo install costs ~70s wall (already backgrounded; net wall ≈ 0) and ~59k file events. Orphan damage is covered by L6 cleanup-trap registration anyway. L1's headline win was the 1.7 GB SSD-write reduction — losing it isn't catastrophic.
  - **Override path — rare and explicit.** If the implementer can articulate a specific testable hypothesis for why bd5d878 reverted (e.g. "wrapper-check N depends on a postinstall script that didn't run because npm cache hit"), and the hypothesis is verified in isolation BEFORE landing, then ship L1 behind the opt-in with the kill-switch. The hypothesis goes in the commit message — no silent "we don't know, let's try anyway."
  - **Why not "best-effort + opt-in" as default:** that pattern is exactly the `feedback-no-fallbacks` shape DA explicitly named — un-named failure modes are the ones that catch you. Opt-in flags buy time but do not protect against unknown regressions; the 4-week kill-switch is the bisect's safety net, not its replacement.

* **L2 clonefile semantics under subsequent writes.** `cp -cR` on APFS produces a CoW clone — subsequent writes to the destination tree allocate new blocks lazily. Worth verifying that `_e2e_isolate`'s `rm -f "$iso_dir/.swarm/memory.rvf"*` (line 31) doesn't accidentally drag the underlying source blocks into the snapshot.

* **L8 (Verdaccio GC) pre-check correctness.** Enumerate every source of pinned `-patch.N` refs before deciding which tarballs to drop. If a tarball is referenced from any of the four sources below, NEVER drop it regardless of age. Keep-last-N (default `N=10`) is the floor; the enumeration is the ceiling.
  - (a) `forks/*/package.json` — internal cross-fork deps.
  - (b) `scripts/codemod.mjs`'s rewrite tables — every `-patch.N` ref the codemod generates is load-bearing for the codemod's expected output.
  - (c) `.last-build-state` — references the resolved versions at last successful release.
  - (d) `.release-epoch` (post-L3) — references the cached ACCEPT_TEMP's resolved versions. A cache-hit on L3 could attempt to resolve a tarball GC just dropped.

  Sources NOT to enumerate (DA round 2 answer): skill manifests under `~/.claude/skills/` (resolve via `npx`, different namespace), plugin lockfiles (IPFS, separate system), CLAUDE.md examples (illustrative, mostly `@latest` not pinned).

### Related ADRs

* **ADR-0025** — persistent npx cache contract; this ADR's L9 extends the existing sweep to also LRU-prune `_cacache`.
* **ADR-0038** — `/tmp/ruflo-build` persistent build-source dir; this ADR's build-half scope-exclusions reference it.
* **ADR-0039** — `_run_and_kill` sentinel pattern; this ADR's L4 reparent move keeps the existing sentinel-file paths working (they live in `/tmp` and exit cleanly per the pattern).
* **ADR-0048** — persistent ONNX model cache (`~/.cache/agentdb-models`); this ADR does NOT touch it; the cache survives across releases by design.
* **ADR-0150** — napi rebuild gate; this ADR's `cross-repo/ruvector/target/` exclusion is deferred as scope-out because of the napi-rebuild dependency.

### Measurement

Per-release measurement appends one JSON line each to two complementary logs:

`logs/release-disk-bytes.jsonl` (primary — SSD-wear proxy):
```json
{"release": "patch.143", "write_bytes": 6312455168, "read_bytes": 14882017280, "duration_s": 408, "levers_active": ["L1","L2","L3","L4"]}
```

`logs/file-events.jsonl` (secondary — fseventsd-buffer proxy):
```json
{"release": "patch.143", "events_write": 192340, "events_clonefile": 0, "events_read": 821100, "duration_s": 408, "levers_active": ["L1","L2","L3","L4"]}
```

Hard release-end gate (the only auto-fail criterion): **`write_bytes` must not exceed `max(baseline × 1.10, baseline + 100 MB)`** at the lever's landing time. The 10% multiplier handles noise on large baselines; the `+ 100 MB` floor absorbs unrelated host activity for small post-cache-hit releases where 10% drops below the noise floor of a single browser tab. Event-count is tracked but not gated — by-design ~unchanged by L2 since clonefile syscalls still register.

Baseline (2026-05-16, pre-lever): not yet measured. **Baseline capture is a hard prerequisite to L6** — the first roadmap commit ("baseline-capture") records `write_bytes` over ≥2 baseline `npm run release` invocations, takes the median, and writes the value to `logs/release-disk-bytes.jsonl`'s first entry with `levers_active: []`. L6 does not land until that entry exists. The principle scales to L1/L3 where the baseline is the hard-gate comparison point — a missing baseline silently invalidates the gate.
