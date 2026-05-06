// @tier unit
// Bug-6 (2026-05-06): tsc incremental cache (.tsbuildinfo /
// tsconfig.tsbuildinfo) was preserved across release runs and reported
// "everything up to date" even when source had changed. Symptom: my
// Bug-1 HNSW orphan-self-heal fix in rvf-backend.ts (forks/ruflo commit
// 71b2ad33e) shipped to source but NOT to the published
// @sparkleideas/memory dist — tsc fast-pathed off the stale cache.
//
// The per-package mtime-invalidation at build-packages.sh:121 only
// checks `${pkg_dir}/.tsbuildinfo` literally; the actual cache file
// written by `tsc --build` is `tsconfig.tsbuildinfo` (different name).
// rsync's `P .tsbuildinfo` filter pattern doesn't match that file
// either, but it gets copied from the fork tree as a regular file.
//
// Fix: scripts/build-packages.sh now unconditionally wipes ALL
// *.tsbuildinfo cache files in TEMP_DIR before tsc runs. This test
// pins that contract so it can't regress.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const BUILD_SCRIPT = '/Users/henrik/source/ruflo-patch/scripts/build-packages.sh';

describe('Bug-6: tsc incremental cache wipe at start of run_build()', () => {
  it('build-packages.sh wipes all *.tsbuildinfo files before tsc runs', () => {
    const src = readFileSync(BUILD_SCRIPT, 'utf8');
    // Find run_build() body — between `run_build() {` and the next top-level `}`.
    const fnStart = src.indexOf('run_build() {');
    assert.ok(fnStart > 0, 'run_build function must exist');
    // Search the first 100 lines after the function open for the wipe.
    const lines = src.slice(fnStart).split('\n').slice(0, 100).join('\n');
    assert.match(
      lines,
      /find\s+"?\$\{TEMP_DIR\}"?\s+.*tsbuildinfo.*-delete/s,
      'run_build() must contain a `find ... tsbuildinfo -delete` invocation early in the function body',
    );
    assert.match(
      lines,
      /tsconfig\.tsbuildinfo/,
      'wipe must match BOTH `*.tsbuildinfo` AND the literal `tsconfig.tsbuildinfo` (tsc --build default output name)',
    );
  });

  it('wipe runs BEFORE any tsc invocation', () => {
    const src = readFileSync(BUILD_SCRIPT, 'utf8');
    const fnStart = src.indexOf('run_build() {');
    const fnSlice = src.slice(fnStart);
    const wipeIdx = fnSlice.search(/find.*tsbuildinfo.*-delete/);
    const tscIdx = fnSlice.search(/"\$tsc_bin"\s+-p/);
    assert.ok(wipeIdx > 0, 'wipe must exist');
    assert.ok(tscIdx > 0, 'tsc invocation must exist');
    assert.ok(
      wipeIdx < tscIdx,
      `wipe (idx=${wipeIdx}) must occur before tsc (idx=${tscIdx}) — otherwise tsc fast-paths off stale cache`,
    );
  });

  it('wipe excludes node_modules (don\'t nuke transitive deps caches)', () => {
    const src = readFileSync(BUILD_SCRIPT, 'utf8');
    const fnStart = src.indexOf('run_build() {');
    const fnSlice = src.slice(fnStart, fnStart + 4000);
    // The wipe must include `-not -path "*/node_modules/*"` so dep package caches survive.
    const wipeMatch = fnSlice.match(/find\s+"?\$\{TEMP_DIR\}"?\s+[\s\S]{0,400}?-delete/);
    assert.ok(wipeMatch, 'wipe match must be findable');
    assert.match(
      wipeMatch[0],
      /-not\s+-path\s+["']?\*?\/node_modules\/\*?["']?/,
      'wipe must exclude node_modules paths',
    );
  });
});
