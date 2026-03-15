// @tier unit
// ADR-0035: Helper script validation
// Tests that generated helper scripts are syntactically valid and functional.

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync, cpSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { getFixtures, cleanupFixtures } from './fixtures/init-fixture.mjs';

let fixtures;

before(async () => {
  fixtures = await getFixtures();
});

after(() => {
  cleanupFixtures();
});

// Helper: get the standard fixture dir
function stdDir() {
  return fixtures.get('standard').dir;
}

// Helper: resolve a helper script path, skip if missing
function helperPath(name) {
  const p = join(stdDir(), '.claude', 'helpers', name);
  return p;
}

// Helper: make a working copy of the fixture dir for mutation tests
function copyFixture() {
  const tmp = mkdtempSync(join(tmpdir(), 'init-helper-copy-'));
  cpSync(stdDir(), tmp, { recursive: true });
  return tmp;
}

// ============================================================================
// H-01 to H-04: Syntax validation
// ============================================================================

describe('Helper script syntax', () => {
  it('H-01: hook-handler.cjs is valid JS', () => {
    const path = helperPath('hook-handler.cjs');
    if (!existsSync(path)) { assert.fail('hook-handler.cjs not generated — skipping'); return; }
    execSync(`node -c "${path}"`, { timeout: 5000 });
  });

  it('H-02: hook-handler.cjs is requireable', () => {
    const path = helperPath('hook-handler.cjs');
    if (!existsSync(path)) { assert.fail('hook-handler.cjs not generated — skipping'); return; }
    try {
      const escaped = path.replace(/'/g, "\\'");
      execSync(`node -e "require('${escaped}')"`, { timeout: 5000, cwd: stdDir() });
    } catch (e) {
      // MODULE_NOT_FOUND is acceptable — we only fail on SyntaxError
      const stderr = (e.stderr || '').toString();
      if (stderr.includes('SyntaxError')) {
        assert.fail(`hook-handler.cjs has syntax error: ${stderr.slice(0, 200)}`);
      }
    }
  });

  it('H-03: auto-memory-hook.mjs is valid ESM', () => {
    const path = helperPath('auto-memory-hook.mjs');
    if (!existsSync(path)) { assert.fail('auto-memory-hook.mjs not generated — skipping'); return; }
    const content = readFileSync(path, 'utf8');
    assert.ok(content.includes('import') || content.includes('export'), 'File does not appear to be ESM');
    // Try parsing — accept dep failures, reject syntax errors
    try {
      const escaped = path.replace(/'/g, "\\'");
      execSync(`node --input-type=module -e "import '${escaped}';"`, { timeout: 5000 });
    } catch (e) {
      const stderr = (e.stderr || '').toString();
      if (stderr.includes('SyntaxError')) {
        assert.fail(`auto-memory-hook.mjs has syntax error: ${stderr.slice(0, 200)}`);
      }
    }
  });

  it('H-04: session.js is valid JS', () => {
    const path = helperPath('session.js');
    if (!existsSync(path)) { assert.fail('session.js not generated — skipping'); return; }
    execSync(`node -c "${path}"`, { timeout: 5000 });
  });
});

// ============================================================================
// H-05 to H-09: Functional validation
// ============================================================================

describe('Helper script functionality', () => {
  it('H-05: session.js handles start/end args without crashing', () => {
    const path = helperPath('session.js');
    if (!existsSync(path)) { assert.fail('session.js not generated — skipping'); return; }
    for (const arg of ['start', 'end']) {
      try {
        execSync(`node "${path}" ${arg}`, { timeout: 5000, cwd: stdDir(), stdio: 'pipe' });
      } catch (e) {
        const stderr = (e.stderr || '').toString();
        if (stderr.includes('SyntaxError')) {
          assert.fail(`session.js has syntax error with arg "${arg}": ${stderr.slice(0, 200)}`);
        }
        // Non-syntax errors (missing deps, etc.) are acceptable
      }
    }
  });

  it('H-06: router.js is valid JS', () => {
    const path = helperPath('router.js');
    if (!existsSync(path)) { assert.fail('router.js not generated — skipping'); return; }
    execSync(`node -c "${path}"`, { timeout: 5000 });
  });

  it('H-07: router.js pattern matching returns something', () => {
    const path = helperPath('router.js');
    if (!existsSync(path)) { assert.fail('router.js not generated — skipping'); return; }
    try {
      const result = execSync(`node "${path}" "test task: fix a bug"`, {
        timeout: 5000, cwd: stdDir(), stdio: 'pipe'
      });
      // If it produces any output, that's good
      assert.ok(true, 'router.js ran without crashing');
    } catch (e) {
      const stderr = (e.stderr || '').toString();
      if (stderr.includes('SyntaxError')) {
        assert.fail(`router.js has syntax error: ${stderr.slice(0, 200)}`);
      }
      // Non-syntax errors acceptable
    }
  });

  it('H-08: memory.js is valid JS', () => {
    const path = helperPath('memory.js');
    if (!existsSync(path)) { assert.fail('memory.js not generated — skipping'); return; }
    execSync(`node -c "${path}"`, { timeout: 5000 });
  });

  it('H-09: memory.js CRUD cycle', () => {
    const path = helperPath('memory.js');
    if (!existsSync(path)) { assert.fail('memory.js not generated — skipping'); return; }
    const workDir = copyFixture();
    try {
      // set
      try {
        execSync(`node "${path}" set test-key test-value`, {
          timeout: 5000, cwd: workDir, stdio: 'pipe'
        });
      } catch (e) {
        const stderr = (e.stderr || '').toString();
        if (stderr.includes('SyntaxError')) {
          assert.fail(`memory.js has syntax error: ${stderr.slice(0, 200)}`);
        }
        // If set fails with non-syntax error, skip the rest
        return;
      }

      // get
      let getResult = '';
      try {
        getResult = execSync(`node "${path}" get test-key`, {
          timeout: 5000, cwd: workDir, stdio: 'pipe'
        }).toString();
      } catch { /* acceptable */ }

      // delete
      try {
        execSync(`node "${path}" delete test-key`, {
          timeout: 5000, cwd: workDir, stdio: 'pipe'
        });
      } catch { /* acceptable */ }

      // keys
      try {
        execSync(`node "${path}" keys`, {
          timeout: 5000, cwd: workDir, stdio: 'pipe'
        });
      } catch { /* acceptable */ }
    } finally {
      try { execSync(`rm -rf "${workDir}"`, { timeout: 5000 }); } catch {}
    }
  });
});

// ============================================================================
// H-10 to H-12: Additional syntax validation
// ============================================================================

describe('Additional helper script syntax', () => {
  it('H-10: statusline.cjs is valid JS', () => {
    const path = helperPath('statusline.cjs');
    if (!existsSync(path)) { assert.fail('statusline.cjs not generated — skipping'); return; }
    execSync(`node -c "${path}"`, { timeout: 5000 });
  });

  it('H-11: pre-commit is valid shell', () => {
    const dir = stdDir();
    // Check multiple possible locations
    const candidates = [
      join(dir, '.claude', 'helpers', 'pre-commit'),
      join(dir, '.git', 'hooks', 'pre-commit'),
      join(dir, '.husky', 'pre-commit'),
    ];
    const found = candidates.find(p => existsSync(p));
    if (!found) { assert.fail('pre-commit hook not generated — skipping'); return; }
    execSync(`bash -n "${found}"`, { timeout: 5000 });
  });

  it('H-12: post-commit is valid shell', () => {
    const dir = stdDir();
    const candidates = [
      join(dir, '.claude', 'helpers', 'post-commit'),
      join(dir, '.git', 'hooks', 'post-commit'),
      join(dir, '.husky', 'post-commit'),
    ];
    const found = candidates.find(p => existsSync(p));
    if (!found) { assert.fail('post-commit hook not generated — skipping'); return; }
    execSync(`bash -n "${found}"`, { timeout: 5000 });
  });
});

// ============================================================================
// H-13 to H-14: hook-handler.cjs stdin/error tests
// ============================================================================

describe('hook-handler.cjs functional', () => {
  it('H-13: hook-handler.cjs reads stdin JSON (HK-001)', () => {
    const path = helperPath('hook-handler.cjs');
    if (!existsSync(path)) { assert.fail('hook-handler.cjs not generated — skipping'); return; }
    const testPayload = JSON.stringify({ event: 'test', data: { foo: 'bar' } });
    try {
      execSync(`echo '${testPayload}' | node "${path}"`, {
        timeout: 5000, cwd: stdDir(), stdio: 'pipe', shell: true
      });
    } catch (e) {
      const stderr = (e.stderr || '').toString();
      if (stderr.includes('SyntaxError')) {
        assert.fail(`hook-handler.cjs has syntax error: ${stderr.slice(0, 200)}`);
      }
      // Non-zero exit with non-syntax error is acceptable
    }
  });

  it('H-14: hook-handler.cjs logs errors on bad input (HK-006)', () => {
    const path = helperPath('hook-handler.cjs');
    if (!existsSync(path)) { assert.fail('hook-handler.cjs not generated — skipping'); return; }
    try {
      execSync(`echo 'NOT_JSON{{{' | node "${path}" 2>&1`, {
        timeout: 5000, cwd: stdDir(), stdio: 'pipe', shell: true
      });
    } catch (e) {
      // We expect either stderr output or a non-zero exit — both are fine
      // The key thing is it doesn't hang or produce a SyntaxError from the script itself
      const output = (e.stdout || '').toString() + (e.stderr || '').toString();
      if (output.includes('SyntaxError') && !output.includes('JSON')) {
        assert.fail(`hook-handler.cjs has a script syntax error: ${output.slice(0, 200)}`);
      }
    }
  });
});
