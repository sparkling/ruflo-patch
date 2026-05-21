// @tier unit
// Bug-6 (2026-05-06, fix revised 2026-05-16): tsc incremental cache
// (.tsbuildinfo / tsconfig.tsbuildinfo) was preserved across release runs
// and reported "everything up to date" even when source had changed.
// Symptom: a Bug-1 HNSW orphan-self-heal fix in rvf-backend.ts (forks/ruflo
// commit 71b2ad33e) shipped to source but NOT to the published
// @sparkleideas/memory dist — tsc fast-pathed off the stale cache.
//
// Root cause: developer-machine `tsc --build` runs in fork source dirs
// generate `tsconfig.tsbuildinfo` files that get rsync-copied into
// /tmp/ruflo-build. The fork-side stale buildinfo then makes tsc skip
// emit.
//
// Original fix (commit at 2026-05-06): unconditionally wipe ALL
// *.tsbuildinfo + tsconfig.tsbuildinfo files in TEMP_DIR before tsc runs.
// Cost: ~10-30s wall time + ~6,000 file-emit FSEvents per release.
//
// Revised fix (commit 6e4da40, 2026-05-16): close the leak at the rsync
// boundary instead of the build boundary. scripts/copy-source.sh now
// passes `--exclude='*.tsbuildinfo' --exclude='tsconfig.tsbuildinfo'` to
// all 5 fork rsyncs, so fork-side stale cache files never reach
// /tmp/ruflo-build. The destination `.tsbuildinfo` (written by THIS
// pipeline's tsc) persists via the existing `--filter='P .tsbuildinfo'`
// PROTECT directive. scripts/build-packages.sh's per-package smart
// invalidation (line ~138, `find ... -newer $_buildinfo`) is the sole
// correctness gate — it only invalidates when src/ .ts files are
// genuinely newer than the cached buildinfo, which is the right
// semantic (the unconditional wipe was a sledgehammer).
//
// This test pins the new dual-layer contract: rsync exclusion +
// per-package smart invalidation.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const COPY_SCRIPT = '/Users/henrik/source/ruflo-patch/scripts/copy-source.sh';
const BUILD_SCRIPT = '/Users/henrik/source/ruflo-patch/scripts/build-packages.sh';

describe('tsc incremental cache leak closed at rsync boundary', () => {
  it('copy-source.sh excludes *.tsbuildinfo from all fork rsyncs', () => {
    const src = readFileSync(COPY_SCRIPT, 'utf8');
    // Count rsync invocations in the copy_source function.
    const fnStart = src.indexOf('copy_source() {');
    assert.ok(fnStart > 0, 'copy_source function must exist');
    const fnSlice = src.slice(fnStart, fnStart + 6000);
    const rsyncMatches = fnSlice.match(/rsync -a /g);
    assert.ok(rsyncMatches && rsyncMatches.length >= 5,
      `expected ≥5 rsync invocations (one per fork), found ${rsyncMatches?.length ?? 0}`);
    // Every rsync invocation must exclude `*.tsbuildinfo`.
    const excludeMatches = fnSlice.match(/--exclude=['"]?\*\.tsbuildinfo['"]?/g);
    assert.ok(excludeMatches && excludeMatches.length >= 5,
      `every rsync must --exclude='*.tsbuildinfo' to keep fork-side stale cache files out of /tmp/ruflo-build, found ${excludeMatches?.length ?? 0} excludes for ${rsyncMatches.length} rsyncs`);
  });

  it('copy-source.sh excludes tsconfig.tsbuildinfo (tsc --build variant) from rsync', () => {
    const src = readFileSync(COPY_SCRIPT, 'utf8');
    const fnStart = src.indexOf('copy_source() {');
    const fnSlice = src.slice(fnStart, fnStart + 6000);
    const matches = fnSlice.match(/--exclude=['"]?tsconfig\.tsbuildinfo['"]?/g);
    assert.ok(matches && matches.length >= 5,
      `every rsync must --exclude='tsconfig.tsbuildinfo' (the literal filename tsc --build emits), found ${matches?.length ?? 0}`);
  });

  it('copy-source.sh PROTECTs destination .tsbuildinfo from --delete', () => {
    const src = readFileSync(COPY_SCRIPT, 'utf8');
    const fnStart = src.indexOf('copy_source() {');
    const fnSlice = src.slice(fnStart, fnStart + 6000);
    // The P filter preserves destination-side .tsbuildinfo across releases —
    // critical so incremental tsc has its cache available.
    const matches = fnSlice.match(/--filter=['"]?P \.tsbuildinfo['"]?/g);
    assert.ok(matches && matches.length >= 5,
      `every rsync must --filter='P .tsbuildinfo' to preserve destination-side cache across releases, found ${matches?.length ?? 0}`);
  });

  it('build-packages.sh has per-package smart invalidation (find -newer .tsbuildinfo)', () => {
    const src = readFileSync(BUILD_SCRIPT, 'utf8');
    // The build_one_pkg helper checks `find $pkg_dir/src -name '*.ts' -newer $_buildinfo`
    // and rm -f's the buildinfo when source is genuinely newer. This is the
    // sole correctness gate now that the unconditional wipe is gone.
    assert.match(src,
      /find\s+["']?\$\{?pkg_dir\}?\/src["']?\s+-name\s+['"]?\*\.ts['"]?\s+-newer\s+["']?\$_buildinfo["']?/,
      'build-packages.sh must have a per-package `find $pkg_dir/src -name "*.ts" -newer $_buildinfo` check',
    );
    assert.match(src,
      /rm\s+-f\s+["']?\$_buildinfo["']?/,
      'when source is newer, build-packages.sh must `rm -f $_buildinfo` to force tsc to recompile that one package',
    );
  });

  it('build-packages.sh no longer unconditionally wipes ALL tsbuildinfo (the regressive sledgehammer)', () => {
    const src = readFileSync(BUILD_SCRIPT, 'utf8');
    const fnStart = src.indexOf('run_build() {');
    assert.ok(fnStart > 0, 'run_build function must exist');
    // Take the first 50 lines of run_build — the unconditional wipe used to
    // sit here. It must NOT contain a TEMP_DIR-wide find-and-delete of all
    // tsbuildinfo files, which would defeat incremental tsc and re-emit
    // ~6k FSEvents per release.
    const lines = src.slice(fnStart).split('\n').slice(0, 50).join('\n');
    assert.doesNotMatch(lines,
      /find\s+"?\$\{TEMP_DIR\}"?\s+[\s\S]{0,400}?\*?\.tsbuildinfo[\s\S]{0,400}?-delete/,
      'run_build() must NOT contain an unconditional TEMP_DIR-wide tsbuildinfo wipe (defeats incremental tsc; ~6k spurious FSEvents/release)',
    );
  });

  it('build-packages.sh tsc invocation uses --incremental + --tsBuildInfoFile (so the persistent cache matters)', () => {
    const src = readFileSync(BUILD_SCRIPT, 'utf8');
    assert.match(src,
      /--incremental\s+--tsBuildInfoFile\s+["']?\$\{?_buildinfo\}?["']?/,
      'tsc invocation must pass --incremental + --tsBuildInfoFile so the preserved cache is actually used',
    );
  });
});
