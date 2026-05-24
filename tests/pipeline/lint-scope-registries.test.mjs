// @tier pipeline
// Tests for scripts/lint-scope-registries.mjs — ADR-0236 cross-registry lint.
//
// Two tests:
//   1. Asserts lint passes against current tree state (post-GREEN-commit).
//      Initially fails RED on the live `agentic-jujutsu` drift; the
//      paired GREEN commit adds agentic-jujutsu to UNSCOPED_PUBLISHABLE.
//   2. Asserts lint fails when a synthetic UNSCOPED_MAP entry is added
//      without a paired UNSCOPED_PUBLISHABLE entry. Validates the lint
//      catches the defect class for future drift, not just today's.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, writeFileSync, readFileSync, rmSync, mkdirSync, cpSync, symlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const LINT_SCRIPT = resolve(ROOT, 'scripts', 'lint-scope-registries.mjs');

/** Run the lint script as a subprocess against a project root. Returns
 * { code, stdout, stderr }. The lint reads files relative to its own
 * location, so to test against modified registries we copy the script
 * into a temp tree and have it read modified siblings. */
function runLint(projectRoot) {
  try {
    const stdout = execFileSync('node', [join(projectRoot, 'scripts', 'lint-scope-registries.mjs')], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      code: err.status ?? 99,
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
    };
  }
}

/** Build a minimal project-shaped temp dir with copies of the 4 source
 * files the lint reads. Allows synthetic mutation for the second test. */
function makeProjectFixture() {
  const tmp = mkdtempSync(join(tmpdir(), 'lint-scope-'));
  mkdirSync(join(tmp, 'scripts'), { recursive: true });
  mkdirSync(join(tmp, 'config'), { recursive: true });

  for (const f of [
    'lint-scope-registries.mjs',
    'fork-version.mjs',
    'codemod.mjs',
    'preflight-discover.mjs',
    'build-packages.sh',
  ]) {
    copyFileSync(resolve(ROOT, 'scripts', f), join(tmp, 'scripts', f));
  }
  copyFileSync(
    resolve(ROOT, 'config', 'publish-levels.json'),
    join(tmp, 'config', 'publish-levels.json'),
  );

  return tmp;
}

describe('lint-scope-registries: PASS on current tree', () => {
  it('exits 0 with PASS message when no drift exists', () => {
    const { code, stdout } = runLint(ROOT);
    assert.equal(
      code,
      0,
      `Expected lint to PASS on current tree but exited with code ${code}.\n` +
      `If this test fails RED, either (a) a new fork package was added to ` +
      `UNSCOPED_MAP without a paired UNSCOPED_PUBLISHABLE entry, or (b) the ` +
      `inverse. Read the lint output above (stderr) for the specific drift ` +
      `and the suggested fix per ADR-0236.\nstdout: ${stdout}`,
    );
    assert.match(stdout, /lint-scope-registries: PASS/, 'expected PASS marker in stdout');
  });
});

describe('lint-scope-registries: FAIL on synthetic drift', () => {
  it('catches a synthetic UNSCOPED_MAP entry missing from UNSCOPED_PUBLISHABLE', () => {
    const tmp = makeProjectFixture();
    try {
      // Inject a fake unscoped entry into the codemod copy without
      // adding it to UNSCOPED_PUBLISHABLE. The lint must surface it.
      const codemodPath = join(tmp, 'scripts', 'codemod.mjs');
      const src = readFileSync(codemodPath, 'utf-8');
      const injected = src.replace(
        /export const UNSCOPED_MAP = \{/,
        `export const UNSCOPED_MAP = {\n  'lint-synthetic-drift-demo': '@sparkleideas/lint-synthetic-drift-demo',`,
      );
      assert.notEqual(src, injected, 'synthetic drift entry must be injected into UNSCOPED_MAP');
      writeFileSync(codemodPath, injected);

      const { code, stderr } = runLint(tmp);
      assert.equal(code, 1, `Expected lint to FAIL on synthetic drift but exited with code ${code}.`);
      assert.match(stderr, /lint-synthetic-drift-demo/, 'expected synthetic name in error message');
      assert.match(stderr, /UNSCOPED_PUBLISHABLE/, 'expected partner-registry citation');
      assert.match(stderr, /ADR-0236/, 'expected ADR citation in error message');
      assert.match(stderr, /Corpus rule/, 'expected corpus-rule citation per R5 contract');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('catches a synthetic UNSCOPED_PUBLISHABLE entry missing from UNSCOPED_MAP (reverse drift)', () => {
    const tmp = makeProjectFixture();
    try {
      const forkVersionPath = join(tmp, 'scripts', 'fork-version.mjs');
      const src = readFileSync(forkVersionPath, 'utf-8');
      const injected = src.replace(
        /export const UNSCOPED_PUBLISHABLE = new Set\(\[/,
        `export const UNSCOPED_PUBLISHABLE = new Set([\n  'reverse-drift-demo',`,
      );
      assert.notEqual(src, injected, 'synthetic reverse-drift entry must be injected into UNSCOPED_PUBLISHABLE');
      writeFileSync(forkVersionPath, injected);

      const { code, stderr } = runLint(tmp);
      assert.equal(code, 1, `Expected lint to FAIL on reverse drift but exited with code ${code}.`);
      assert.match(stderr, /reverse-drift-demo/, 'expected synthetic name in error message');
      assert.match(stderr, /UNSCOPED_MAP/, 'expected partner-registry citation');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
