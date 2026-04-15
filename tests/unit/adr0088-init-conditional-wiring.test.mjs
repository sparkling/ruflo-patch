// @tier unit
// ADR-0088: SessionStart auto-start wiring — static source verification.
//
// Runtime tests that invoke `cli init --full` with controlled PATH and parse
// the generated settings.json live in lib/acceptance-adr0088-checks.sh. Here
// we grep the fork source for the helper function, the conditional block,
// and the daemon-start command string.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';

const SETTINGS_GENERATOR_PATH =
  '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/init/settings-generator.ts';

function read(path) {
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}

describe('ADR-0088: settings-generator.ts has claudeCliAvailable helper', () => {
  const source = read(SETTINGS_GENERATOR_PATH);

  it('file readable', () => {
    assert.ok(source, `${SETTINGS_GENERATOR_PATH} must exist`);
  });

  it('imports execSync from node:child_process', () => {
    assert.ok(/from ['"]node:child_process['"]/.test(source),
      'execSync import must come from node:child_process (ESM module)');
  });

  it('claudeCliAvailable function declared', () => {
    assert.ok(/function claudeCliAvailable\(\)/.test(source),
      'claudeCliAvailable helper must be declared');
  });

  it('helper uses which claude on POSIX', () => {
    assert.ok(source.includes("'which claude'"),
      'POSIX probe must use `which claude`');
  });

  it('helper uses where claude on Windows', () => {
    assert.ok(source.includes("'where claude'"),
      'Windows probe must use `where claude`');
  });

  it('returns true on successful probe', () => {
    assert.ok(/claudeCliAvailable[\s\S]{0,400}return true/.test(source),
      'helper must return true when probe succeeds');
  });

  it('catch branch returns false', () => {
    assert.ok(/claudeCliAvailable[\s\S]{0,400}catch[\s\S]{0,40}return false/.test(source),
      'helper must return false in catch branch');
  });

  it('ADR-0088 reference present in helper comment', () => {
    assert.ok(source.includes('ADR-0088'),
      'helper must cite ADR-0088 for traceability');
  });
});

describe('ADR-0088: conditional SessionStart wiring', () => {
  const source = read(SETTINGS_GENERATOR_PATH);

  it('conditional push guarded by claudeCliAvailable()', () => {
    assert.ok(/if \(claudeCliAvailable\(\)\)/.test(source),
      'conditional block must be guarded by claudeCliAvailable()');
  });

  it('daemon start --quiet command string present inside the conditional', () => {
    assert.ok(source.includes('daemon start --quiet'),
      'daemon start command must be in the SessionStart block');
  });

  it('daemon start uses npx @claude-flow/cli (codemod-renamed at build)', () => {
    assert.ok(source.includes('@claude-flow/cli@latest daemon start'),
      'must match existing npx pattern in the file');
  });

  it('timeout is 5000ms (non-blocking)', () => {
    assert.ok(/daemon start[\s\S]{0,200}timeout:\s*5000/.test(source),
      'daemon start hook must have a 5000ms timeout');
  });

  it('continueOnError true (non-blocking)', () => {
    assert.ok(/daemon start[\s\S]{0,200}continueOnError:\s*true/.test(source),
      'daemon start hook must have continueOnError: true');
  });

  it('existing SessionStart hooks (session-restore, auto-memory) not removed', () => {
    assert.ok(source.includes('session-restore'),
      'session-restore hook must remain');
    assert.ok(source.includes('auto-memory-hook'),
      'auto-memory-hook wiring must remain');
  });
});
