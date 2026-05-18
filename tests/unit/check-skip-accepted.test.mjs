// @tier unit
// scripts/check-skip-accepted.mjs — skip_accepted invariant gate.
//
// Reads the most recent test-results/accept-*/acceptance-results.json,
// finds skip_accepted entries, and verifies each carries a recognized
// rationale marker (HEAVY_SKIP, tool not in published build, etc.) or
// is in the allowlist.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const SCRIPT = '/Users/henrik/source/ruflo-patch/scripts/check-skip-accepted.mjs';

// Sandbox: copy the script into a project tree that has its own
// test-results/ + lib/skip-accepted-allowlist.txt fixture, then run it.
function buildSandbox({ results, allowlist }) {
  const sandbox = mkdtempSync(join(tmpdir(), 'skip-accept-'));
  mkdirSync(join(sandbox, 'scripts'), { recursive: true });
  mkdirSync(join(sandbox, 'lib'), { recursive: true });
  copyFileSync(SCRIPT, join(sandbox, 'scripts', 'check-skip-accepted.mjs'));

  const allowlistContent = (allowlist || []).map(id => id).join('\n') + '\n';
  writeFileSync(join(sandbox, 'lib', 'skip-accepted-allowlist.txt'), allowlistContent);

  if (results) {
    const resultsDir = join(sandbox, 'test-results', 'accept-2026-01-01T000000Z');
    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(join(resultsDir, 'acceptance-results.json'), JSON.stringify(results));
  }
  return sandbox;
}

function runCheck(sandbox) {
  const script = join(sandbox, 'scripts', 'check-skip-accepted.mjs');
  const res = spawnSync('node', [script], { encoding: 'utf8' });
  return { exit: res.status, stdout: res.stdout, stderr: res.stderr };
}

describe('check-skip-accepted — passes when every skip is documented', () => {
  it('exits 0 when all skip_accepted have HEAVY_SKIP marker', () => {
    const sandbox = buildSandbox({
      results: {
        tests: [
          { id: 'a', status: 'passed' },
          { id: 'b', status: 'skip_accepted', output: 'HEAVY_SKIP: b skipped' },
          { id: 'c', status: 'skip_accepted', output: 'HEAVY_SKIP: c skipped' },
        ],
      },
      allowlist: [],
    });
    try {
      const res = runCheck(sandbox);
      assert.equal(res.exit, 0, `expected 0, got ${res.exit}; stderr=${res.stderr}`);
      assert.match(res.stdout, /OK: 2 skip_accepted/);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('exits 0 with mixed marker variants', () => {
    const sandbox = buildSandbox({
      results: {
        tests: [
          { id: 'a', status: 'skip_accepted', output: 'tool not in published build' },
          { id: 'b', status: 'skip_accepted', output: 'upstream truncation' },
          { id: 'c', status: 'skip_accepted', output: 'prereq_absent: foo' },
        ],
      },
      allowlist: [],
    });
    try {
      const res = runCheck(sandbox);
      assert.equal(res.exit, 0);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('exits 0 when undocumented skip is in allowlist', () => {
    const sandbox = buildSandbox({
      results: {
        tests: [
          { id: 'legacy-skip', status: 'skip_accepted', output: 'no marker here' },
        ],
      },
      allowlist: ['legacy-skip'],
    });
    try {
      const res = runCheck(sandbox);
      assert.equal(res.exit, 0);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});

describe('check-skip-accepted — flags undocumented skips', () => {
  it('exits 1 when a skip has no marker and is not in allowlist', () => {
    const sandbox = buildSandbox({
      results: {
        tests: [
          { id: 'a', status: 'passed' },
          { id: 'silent-skip', status: 'skip_accepted', output: 'no rationale' },
        ],
      },
      allowlist: [],
    });
    try {
      const res = runCheck(sandbox);
      assert.equal(res.exit, 1);
      assert.match(res.stderr, /silent-skip/);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('reports the test name + headline for each undocumented skip', () => {
    const sandbox = buildSandbox({
      results: {
        tests: [
          { id: 'foo', name: 'Foo Test', status: 'skip_accepted', output: 'mystery reason here' },
        ],
      },
    });
    try {
      const res = runCheck(sandbox);
      assert.equal(res.exit, 1);
      assert.match(res.stderr, /foo: Foo Test/);
      assert.match(res.stderr, /mystery reason here/);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});

describe('check-skip-accepted — boundary cases', () => {
  it('exits 0 when no acceptance-results.json exists yet (first run)', () => {
    const sandbox = buildSandbox({ results: null });
    try {
      const res = runCheck(sandbox);
      assert.equal(res.exit, 0);
      assert.match(res.stdout, /no acceptance-results\.json found/);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('exits 0 when results have no skip_accepted entries', () => {
    const sandbox = buildSandbox({
      results: { tests: [{ id: 'a', status: 'passed' }, { id: 'b', status: 'passed' }] },
    });
    try {
      const res = runCheck(sandbox);
      assert.equal(res.exit, 0);
      assert.match(res.stdout, /OK: 0 skip_accepted/);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  it('exits 1 with FATAL when acceptance-results.json is malformed JSON', () => {
    const sandbox = buildSandbox({ results: null });
    const resultsDir = join(sandbox, 'test-results', 'accept-2026-01-01T000000Z');
    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(join(resultsDir, 'acceptance-results.json'), '{"tests":[{"id":"a","output":BAD_JSON}]}');
    try {
      const res = runCheck(sandbox);
      assert.equal(res.exit, 1);
      assert.match(res.stderr, /FATAL.*could not parse/);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});

describe('check-skip-accepted — script file is present', () => {
  it('the detector script exists', () => {
    assert.ok(existsSync(SCRIPT));
  });
});
