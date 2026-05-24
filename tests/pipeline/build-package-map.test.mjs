// @tier pipeline
// Tests for scripts/publish.mjs::buildPackageMap — duplicate-name resolution.
//
// Coverage:
//   1. Single package — discovered + indexed by name
//   2. Two packages, same name, one private + one not — non-private wins
//   3. Two packages, same name, canonical (non-subdir) + stale (in /pkg/) —
//      non-subdir wins (regression test for the old SUBDIR_BLACKLIST behavior)
//   4. Two packages, same name, BOTH in subdir blacklist (e.g. /npm/ + /pkg/)
//      — fail loud with both paths in the error (ADR-0231 wave A9: this is
//      the silent-pick bug where wasm-pack's stale `crates/*/pkg/` collided
//      with `npm/packages/*`, causing the wrong version to publish).
//   5. Two packages, same name, BOTH non-subdir — fail loud (operator must
//      remove one).

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const { buildPackageMap } = await import(
  resolve(ROOT, 'scripts', 'publish.mjs')
);

/** Helper: write a package.json at a given path under a temp tree. */
function writePkg(tmpRoot, relPath, name, extra = {}) {
  const absDir = join(tmpRoot, relPath);
  mkdirSync(absDir, { recursive: true });
  writeFileSync(
    join(absDir, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', ...extra }, null, 2),
  );
  return absDir;
}

describe('buildPackageMap — duplicate-name resolution', () => {
  it('indexes a single package by name', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'bpm-single-'));
    try {
      const dir = writePkg(tmp, 'pkgs/foo', '@scope/foo');
      const map = buildPackageMap(tmp);
      assert.equal(map.get('@scope/foo'), dir);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('non-private wins over private when both share a name', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'bpm-private-'));
    try {
      const privDir = writePkg(tmp, 'root', '@scope/foo', { private: true });
      const pubDir = writePkg(tmp, 'npm/packages/foo', '@scope/foo');
      const map = buildPackageMap(tmp);
      assert.equal(map.get('@scope/foo'), pubDir, 'non-private should win');
      assert.notEqual(map.get('@scope/foo'), privDir);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('non-subdir wins over /pkg/ subdir when both are non-private', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'bpm-subdir-'));
    try {
      // Canonical at workspace root, stale wasm-pack output under /pkg
      // (terminal directory — regression coverage: the old impl used
      // trailing-slash substring match which silently missed terminal
      // /pkg directories).
      const canonicalDir = writePkg(tmp, 'root', '@scope/foo');
      writePkg(tmp, 'root/pkg', '@scope/foo');
      const map = buildPackageMap(tmp);
      assert.equal(map.get('@scope/foo'), canonicalDir, 'non-subdir should win');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('detects terminal /pkg directory as subdir (regression: old impl missed this)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'bpm-terminal-pkg-'));
    try {
      // Pre-fix: the old code used `/pkg/` (with trailing slash) as
      // a substring check, so `/some/path/pkg` (no trailing slash)
      // was classified as non-subdir. After the fix the matcher
      // uses `\/(npm|pkg|examples)(\/|$)/` which matches both forms.
      // Verify: when canonical is missing, only the terminal-/pkg
      // entry exists — it should still be discoverable so the
      // package isn't silently dropped from publication.
      const onlyDir = writePkg(tmp, 'standalone/pkg', '@scope/only-here');
      const map = buildPackageMap(tmp);
      assert.equal(map.get('@scope/only-here'), onlyDir);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('fails loud when both candidates are in subdir blacklist (the ADR-0231 wave A9 bug)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'bpm-both-subdir-'));
    try {
      // The exact shape that broke ADR-0231 wave 4:
      //   npm/packages/ruvllm-wasm/package.json   (matches /npm/)
      //   crates/ruvllm-wasm/pkg/package.json     (matches /pkg$)
      // Both in SUBDIR_BLACKLIST_RE, both non-private. Walk order
      // silently picked one over the other in the old logic; new
      // behavior fails loud so the operator removes the duplicate.
      writePkg(tmp, 'crates/ruvllm-wasm/pkg', '@scope/ruvllm-wasm');
      writePkg(tmp, 'npm/packages/ruvllm-wasm', '@scope/ruvllm-wasm');

      assert.throws(
        () => buildPackageMap(tmp),
        (err) => {
          assert.match(err.message, /duplicate publishable package name '@scope\/ruvllm-wasm'/);
          assert.match(err.message, /crates\/ruvllm-wasm\/pkg/);
          assert.match(err.message, /npm\/packages\/ruvllm-wasm/);
          return true;
        },
        'expected throw with both paths cited',
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('fails loud when both candidates are outside the subdir blacklist', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'bpm-both-canonical-'));
    try {
      // Two non-subdir, non-private declarations with the same name.
      // No tie-breaker can pick — operator decides.
      writePkg(tmp, 'packageA', '@scope/foo');
      writePkg(tmp, 'packageB', '@scope/foo');
      assert.throws(
        () => buildPackageMap(tmp),
        /duplicate publishable package name '@scope\/foo'/,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
