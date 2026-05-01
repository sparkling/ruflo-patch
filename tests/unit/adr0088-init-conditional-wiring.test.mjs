// @tier unit
// ADR-0088 (Amendment 2026-04-20): SessionStart auto-start wiring —
// static source verification. The original capability gate via
// `claudeCliAvailable()` was removed; init now wires daemon-start
// unconditionally and relies on the command's `|| true` trailer as
// the runtime capability gate.
//
// Runtime tests that invoke `cli init --full` with a stripped PATH
// and parse the generated settings.json live in
// lib/acceptance-adr0088-checks.sh (check_adr0088_conditional_init_no_claude).

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';

const SETTINGS_GENERATOR_PATH =
  '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/init/settings-generator.ts';

function read(path) {
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}

describe('ADR-0088 Amendment 2026-04-20: claudeCliAvailable helper removed', () => {
  const source = read(SETTINGS_GENERATOR_PATH);

  it('file readable', () => {
    assert.ok(source, `${SETTINGS_GENERATOR_PATH} must exist`);
  });

  it('claudeCliAvailable function is GONE', () => {
    assert.ok(!/function claudeCliAvailable\b/.test(source),
      'amendment removed the capability-gate helper; must not reappear');
  });

  it('which claude / where claude probes removed', () => {
    assert.ok(!source.includes("'which claude'"),
      'POSIX probe string must be gone');
    assert.ok(!source.includes("'where claude'"),
      'Windows probe string must be gone');
  });

  it('no residual execSync import from node:child_process', () => {
    assert.ok(!/import\s*\{[^}]*execSync[^}]*\}\s*from\s*['"]node:child_process['"]/.test(source),
      'execSync import must be removed along with the helper');
  });
});

describe('ADR-0088 Amendment 2026-04-20: SessionStart wiring is unconditional', () => {
  const source = read(SETTINGS_GENERATOR_PATH);

  it('no if (claudeCliAvailable()) guard remains', () => {
    assert.ok(!/if\s*\(\s*claudeCliAvailable\s*\(\)\s*\)/.test(source),
      'the conditional guard must be gone');
  });

  it('daemon start --quiet command string still present', () => {
    assert.ok(source.includes('daemon start --quiet'),
      'daemon start command must remain in the SessionStart block');
  });

  it('daemon start uses npx @sparkleideas/cli (ADR-0113 Fix 6.1)', () => {
    // ADR-0113 Fix 6.1 baked the @sparkleideas/cli@latest rebrand directly
    // into fork source rather than relying on codemod to rewrite at build
    // time. Test expects the post-rebrand state in fork source.
    assert.ok(source.includes('@sparkleideas/cli@latest daemon start'),
      'must match @sparkleideas/cli@latest daemon-start pattern (ADR-0113 Fix 6.1)');
    assert.ok(!source.includes('@claude-flow/cli@latest daemon start'),
      'pre-ADR-0113 @claude-flow/cli@latest pattern must be gone from fork source');
  });

  it('daemon start hook has || true trailer (runtime capability gate)', () => {
    assert.ok(/daemon start --quiet 2>\/dev\/null \|\| true/.test(source),
      'the hook command must neutralize failures via || true');
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
