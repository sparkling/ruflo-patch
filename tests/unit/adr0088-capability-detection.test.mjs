// @tier unit
// ADR-0088: capability detection — static source verification.
//
// Behavioral tests that invoke `cli daemon status` against a rebuilt binary
// live in lib/acceptance-adr0088-checks.sh. Here we verify the fork source
// contains the detection helper, the exact startup log strings, and the
// public getter that `daemon status` reads.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';

const FORK_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src';
const WORKER_DAEMON_PATH = `${FORK_SRC}/services/worker-daemon.ts`;
const CMD_DAEMON_PATH = `${FORK_SRC}/commands/daemon.ts`;

function read(path) {
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}

describe('ADR-0088: capability detection helper in worker-daemon.ts', () => {
  const source = read(WORKER_DAEMON_PATH);

  it('file readable', () => {
    assert.ok(source, `${WORKER_DAEMON_PATH} must exist`);
  });

  it('detectClaudeCapability method declared', () => {
    assert.ok(/detectClaudeCapability\(\)/.test(source),
      'worker-daemon must expose a detectClaudeCapability method');
  });

  it('detection uses which/execSync probe', () => {
    assert.ok(source.includes("execSync('which claude'"),
      'detection must use execSync on `which claude`');
  });

  it('returns "headless" when claude is found', () => {
    assert.ok(source.includes("return 'headless'"),
      "detection returns 'headless' on success");
  });

  it('returns "local" on catch', () => {
    assert.ok(source.includes("return 'local'"),
      "detection returns 'local' when claude is absent");
  });

  it('result stored on _aiMode private field', () => {
    assert.ok(/_aiMode/.test(source),
      '_aiMode field must cache the detection result');
  });

  it('public aiMode getter exposed for status readers', () => {
    assert.ok(/public get aiMode\(\)/.test(source) || /get aiMode\(\)/.test(source),
      'public aiMode getter must be exposed');
  });

  it('headless-mode startup log string matches ADR-0088', () => {
    assert.ok(source.includes('[Daemon] Starting in headless mode'),
      'headless startup log must match ADR-0088 §Decision item 7');
  });

  it('local-mode startup log string matches ADR-0088', () => {
    assert.ok(source.includes('[Daemon] Starting in local mode'),
      'local startup log must match ADR-0088 §Decision item 7');
  });

  it('local-mode log mentions placeholder metrics', () => {
    assert.ok(source.includes('placeholder metrics'),
      'local log must explain the degraded behavior honestly');
  });

  it('local-mode log tells user to install Claude Code CLI', () => {
    assert.ok(source.includes('Install Claude Code CLI'),
      'local log must point user to the remediation');
  });
});

describe('ADR-0088: daemon status reads aiMode', () => {
  const source = read(CMD_DAEMON_PATH);

  it('file readable', () => {
    assert.ok(source, `${CMD_DAEMON_PATH} must exist`);
  });

  it('status output contains AI Mode: line', () => {
    assert.ok(source.includes('AI Mode:'),
      'daemon status must print AI Mode line');
  });

  it('status uses aiMode from running daemon when available', () => {
    assert.ok(/aiMode/.test(source),
      'status handler reads aiMode property');
  });

  it('status falls back to execSync probe when no live daemon', () => {
    assert.ok(source.includes("execSync('which claude'"),
      'status fallback re-runs detection when no singleton');
  });
});
