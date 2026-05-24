// @tier pipeline
// Tests for scripts/lint-set-e-discipline.mjs — ADR-0245 gate-0 lint.
//
// Three tests:
//   1. Asserts lint passes against current scripts/ tree state (post-
//      Phase A migration: all 5 missing-set-e scripts have DELIBERATE
//      headers OR strict openings).
//   2. Asserts lint FAILS RED on a synthetic .sh file with no `set -*`
//      directive (validates the "missing set -*" branch).
//   3. Asserts lint FAILS RED on a synthetic .sh file with `set -uo
//      pipefail` but no `# DELIBERATE-<id>:` header (validates the
//      tolerant-without-rationale branch).

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const LINT_SCRIPT = resolve(ROOT, 'scripts', 'lint-set-e-discipline.mjs');

/** Run the lint script as a subprocess. Returns { code, stdout, stderr }. */
function runLint(scriptPath) {
  // spawnSync preserves stderr regardless of exitCode (execFileSync drops it
  // when the child exits 0).
  const r = spawnSync('node', [scriptPath], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    code: r.status ?? 99,
    stdout: (r.stdout ?? '').toString(),
    stderr: (r.stderr ?? '').toString(),
  };
}

/** Build a minimal repo-shaped temp dir with a copy of the lint script,
 *  so SCAN_DIRS (scripts/) resolves relative to the temp tree. The lint
 *  walks scripts/ next to its own location. */
function makeRepoFixture() {
  const tmp = mkdtempSync(join(tmpdir(), 'lint-set-e-'));
  mkdirSync(join(tmp, 'scripts'), { recursive: true });
  copyFileSync(LINT_SCRIPT, join(tmp, 'scripts', 'lint-set-e-discipline.mjs'));
  return tmp;
}

describe('scripts/lint-set-e-discipline.mjs (ADR-0245)', () => {
  it('passes against current repo state (all scripts/ either strict or DELIBERATE)', () => {
    const r = runLint(LINT_SCRIPT);
    assert.equal(
      r.code,
      0,
      `lint should pass on current state, but exited ${r.code}\n` +
        `stderr:\n${r.stderr}\n` +
        `stdout:\n${r.stdout}`
    );
    assert.match(r.stderr, /\[lint-set-e-discipline\] OK/);
  });

  it('FAILS RED on synthetic .sh with no set -* directive', () => {
    const tmp = makeRepoFixture();
    try {
      writeFileSync(
        join(tmp, 'scripts', 'no-set-flag.sh'),
        '#!/usr/bin/env bash\n# Test script — no set -*\necho hi\n',
        'utf-8'
      );
      const r = runLint(join(tmp, 'scripts', 'lint-set-e-discipline.mjs'));
      assert.equal(r.code, 1, `expected exit 1 on missing set -*, got ${r.code}`);
      assert.match(r.stderr, /no `set -euo pipefail`/);
      assert.match(r.stderr, /no-set-flag\.sh/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('FAILS RED on synthetic .sh with tolerant set -uo but no DELIBERATE header', () => {
    const tmp = makeRepoFixture();
    try {
      writeFileSync(
        join(tmp, 'scripts', 'tolerant-no-deliberate.sh'),
        '#!/usr/bin/env bash\n# Test script — tolerant without rationale\nset -uo pipefail\necho hi\n',
        'utf-8'
      );
      const r = runLint(join(tmp, 'scripts', 'lint-set-e-discipline.mjs'));
      assert.equal(r.code, 1, `expected exit 1 on tolerant-without-DELIBERATE, got ${r.code}`);
      assert.match(r.stderr, /lacks .*DELIBERATE/);
      assert.match(r.stderr, /tolerant-no-deliberate\.sh/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('PASSES on synthetic .sh with tolerant set -uo AND DELIBERATE header', () => {
    const tmp = makeRepoFixture();
    try {
      writeFileSync(
        join(tmp, 'scripts', 'tolerant-with-deliberate.sh'),
        '#!/usr/bin/env bash\n' +
          '# Test script — tolerant WITH explicit rationale\n' +
          '# DELIBERATE-ADR0245: per-phase tolerant handling for unit-test\n' +
          'set -uo pipefail\n' +
          'echo hi\n',
        'utf-8'
      );
      const r = runLint(join(tmp, 'scripts', 'lint-set-e-discipline.mjs'));
      assert.equal(r.code, 0, `expected exit 0 on tolerant-with-DELIBERATE, got ${r.code}\nstderr:\n${r.stderr}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
