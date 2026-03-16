// tests/pipeline/promote-rollback.test.mjs — Promote & rollback script tests
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

describe('promote-packages.sh', () => {
  it('is sourceable and defines promote_packages function', () => {
    const output = run(
      "bash -c 'source lib/promote-packages.sh && type promote_packages'",
    );
    assert.match(output, /function/, 'promote_packages should be a function');
  });
});

describe('rollback.sh', () => {
  it('--help exits 0', () => {
    const output = run('bash scripts/rollback.sh --help');
    assert.match(output, /Usage/, 'should print usage information');
  });

  it('--dry-run with mock version exits 0', () => {
    const output = run('bash scripts/rollback.sh --dry-run --yes 0.0.0-test');
    assert.match(output, /dry.run/i, 'should indicate dry-run mode');
  });
});

describe('promote.sh', () => {
  it('--help exits 0', () => {
    const output = run('bash scripts/promote.sh --help');
    assert.match(output, /Usage/, 'should print usage information');
  });
});
