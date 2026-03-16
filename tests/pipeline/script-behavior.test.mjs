// tests/pipeline/script-behavior.test.mjs — Pipeline script edge-case tests (T3)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const projectRoot = resolve(import.meta.dirname, '../..');

function run(cmd, opts = {}) {
  return execSync(cmd, {
    cwd: projectRoot,
    encoding: 'utf-8',
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'pipe'],
    ...opts,
  });
}

describe('build-wasm.sh', () => {
  it('exits 0 when build dir missing', () => {
    const pid = process.pid;
    const result = execSync(
      `bash scripts/build-wasm.sh --build-dir /tmp/nonexistent-dir-${pid}; echo "EXIT:$?"`,
      { cwd: projectRoot, encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    assert.match(result, /EXIT:0/);
  });

  it('exits 0 when wasm-pack not installed', () => {
    const result = execSync(
      'env PATH=/usr/bin:/bin bash scripts/build-wasm.sh --build-dir /tmp/ruflo-build; echo "EXIT:$?"',
      { cwd: projectRoot, encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    assert.match(result, /EXIT:0/);
  });
});

describe('cleanup-tmp.sh', () => {
  it('runs without errors on empty /tmp patterns', () => {
    // MAX_AGE_HOURS=0 means "remove anything" but patterns may not match — still exit 0
    const result = execSync(
      'bash scripts/cleanup-tmp.sh 0; echo "EXIT:$?"',
      { cwd: projectRoot, encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    assert.match(result, /EXIT:0/);
  });
});

describe('fork-paths.sh', () => {
  it('is sourceable and defines required arrays', () => {
    const output = run(
      "bash -c 'source lib/fork-paths.sh && echo ${#FORK_NAMES[@]} && echo ${#FORK_DIRS[@]} && echo ${#UPSTREAM_URLS[@]}'",
    );
    const lines = output.trim().split('\n');
    assert.equal(lines[0], '4', 'FORK_NAMES should have 4 entries');
    assert.equal(lines[1], '4', 'FORK_DIRS should have 4 entries');
    assert.equal(lines[2], '4', 'UPSTREAM_URLS should have 4 entries');
  });
});
