// @tier unit
// Tests for lib/common.py — patch()/patch_all() behavior.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { writeFileSync, readFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const COMMON_PY = resolve(ROOT, 'lib', 'common.py');

function runPython(script, base = '/dev/null') {
  const commonPy = readFileSync(COMMON_PY, 'utf-8');
  const full = commonPy + '\n' + script;
  const result = spawnSync('python3', ['-c', full], {
    env: { ...process.env, BASE: base },
    encoding: 'utf-8',
  });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

describe('common.py', () => {
  it('patch() applies when old string is found', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cfp-test-'));
    const file = join(tmp, 'test.js');
    writeFileSync(file, 'const x = "old_value";');

    const script = `
patch("test: replace old", "${file}", "old_value", "new_value")
print(f"applied={applied}, skipped={skipped}")
`;
    const r = runPython(script);
    assert.match(r.stdout, /Applied: test/);
    assert.equal(readFileSync(file, 'utf-8'), 'const x = "new_value";');
    rmSync(tmp, { recursive: true, force: true });
  });

  it('patch() skips when new string already present', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cfp-test-'));
    const file = join(tmp, 'test.js');
    writeFileSync(file, 'const x = "new_value";');

    const script = `
patch("test: skip", "${file}", "old_value", "new_value")
print(f"applied={applied}, skipped={skipped}")
`;
    const r = runPython(script);
    assert.match(r.stdout, /skipped=1/);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('patch() warns when old string not found', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cfp-test-'));
    const file = join(tmp, 'test.js');
    writeFileSync(file, 'const x = "something_else";');

    const script = `
patch("test: warn", "${file}", "old_value", "new_value")
print(f"applied={applied}, skipped={skipped}")
`;
    const r = runPython(script);
    assert.match(r.stdout, /WARN/);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('patch() is idempotent (double apply)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cfp-test-'));
    const file = join(tmp, 'test.js');
    writeFileSync(file, 'const x = "old_value";');

    const script = `
patch("test: apply", "${file}", "old_value", "new_value")
patch("test: apply again", "${file}", "old_value", "new_value")
print(f"applied={applied}, skipped={skipped}")
`;
    const r = runPython(script);
    assert.match(r.stdout, /applied=1, skipped=1/);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('patch_all() replaces all occurrences', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cfp-test-'));
    const file = join(tmp, 'test.js');
    writeFileSync(file, 'aaa bbb aaa bbb aaa');

    const script = `
patch_all("test: all", "${file}", "aaa", "zzz")
print(f"applied={applied}, skipped={skipped}")
`;
    const r = runPython(script);
    assert.match(r.stdout, /Applied/);
    assert.equal(readFileSync(file, 'utf-8'), 'zzz bbb zzz bbb zzz');
    rmSync(tmp, { recursive: true, force: true });
  });

  it('patch() silently skips missing file', () => {
    const script = `
patch("test: missing", "/nonexistent/path/file.js", "old", "new")
print(f"applied={applied}, skipped={skipped}")
`;
    const r = runPython(script);
    assert.match(r.stdout, /applied=0, skipped=0/);
  });

  it('patch() skips when filepath is empty string', () => {
    const script = `
patch("test: empty path", "", "old", "new")
print(f"applied={applied}, skipped={skipped}")
`;
    const r = runPython(script);
    assert.match(r.stdout, /applied=0, skipped=0/);
  });
});
