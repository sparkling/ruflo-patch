/**
 * ADR-0069 A4 — shared `readEwcLambdaFromConfig` helper
 *
 * The review called out that ~5 files in the agentic-flow fork each carried
 * a copy of the same ~10-line `readEwcLambdaFromConfig(fallback)` helper.
 * The DRY fix: one exported helper in
 *   packages/agentdb/src/config/embedding-config.ts
 * and every caller imports from there — no in-file `function readEwcLambdaFromConfig`
 * definitions anywhere in the fork.
 *
 * This test is a grep-level invariant: it fails loudly if a duplicate crept
 * back in, and it fails loudly if a call site reverted to a local function.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const FORK_ROOT = '/Users/henrik/source/forks/agentic-flow';
const SHARED_MODULE = join(
  FORK_ROOT,
  'packages/agentdb/src/config/embedding-config.ts',
);

const KNOWN_CALLERS = [
  'agentic-flow/src/services/sona-agentdb-integration.ts',
  'agentic-flow/src/intelligence/RuVectorIntelligence.ts',
  'agentic-flow/src/mcp/fastmcp/tools/hooks/intelligence-tools.ts',
  'packages/agentdb/src/backends/rvf/SonaLearningBackend.ts',
];

function rgCount(pattern) {
  // Use grep (portable, available on macOS). -RIl lists files; we then count.
  // We exclude test/ and dist/ so compiled output or this very test file
  // don't skew the check.
  const cmd = [
    'grep',
    '-RIl',
    '--include=*.ts',
    '--exclude-dir=dist',
    '--exclude-dir=node_modules',
    '--exclude-dir=tests',
    '-e',
    JSON.stringify(pattern),
    FORK_ROOT,
  ].join(' ');
  try {
    const out = execSync(cmd, { encoding: 'utf-8' });
    return out.split('\n').filter(Boolean);
  } catch (err) {
    // grep exits 1 on zero matches — treat as empty
    if (err.status === 1) return [];
    throw err;
  }
}

test('ADR-0069 A4: fork is checked out at expected path', () => {
  assert.ok(existsSync(FORK_ROOT), `fork root missing: ${FORK_ROOT}`);
  assert.ok(
    existsSync(SHARED_MODULE),
    `shared config module missing: ${SHARED_MODULE}`,
  );
});

test('ADR-0069 A4: exactly one `export function readEwcLambdaFromConfig` in the fork', () => {
  const files = rgCount('export function readEwcLambdaFromConfig');
  assert.equal(
    files.length,
    1,
    `expected exactly one exported definition, got ${files.length}: ${files.join(', ')}`,
  );
  assert.equal(
    files[0],
    SHARED_MODULE,
    `exported definition must live in shared module, not ${files[0]}`,
  );
});

test('ADR-0069 A4: zero local `function readEwcLambdaFromConfig` definitions outside shared module', () => {
  // Note: we search for the un-exported form. The exported one in the shared
  // module contains the word "export " before "function", so this grep skips it.
  const files = rgCount('^function readEwcLambdaFromConfig');
  assert.equal(
    files.length,
    0,
    `no local function definitions permitted — found ${files.length}: ${files.join(', ')}`,
  );
});

test('ADR-0069 A4: shared helper is fault-tolerant on missing config', () => {
  const src = readFileSync(SHARED_MODULE, 'utf-8');
  // Must have a loud-log path (ADR-0082) on unexpected errors, not silent swallow.
  assert.match(
    src,
    /console\.warn\(\s*`?\[embedding-config\]\s+readEwcLambdaFromConfig failed/,
    'shared helper must loudly warn on parse/IO errors (ADR-0082)',
  );
  // Must still return fallback on missing file (expected case, no warn spam).
  assert.match(
    src,
    /if\s*\(!existsSync\(configPath\)\)\s*return\s+fallback;/,
    'shared helper must return fallback on missing config without logging',
  );
});

for (const rel of KNOWN_CALLERS) {
  const abs = join(FORK_ROOT, rel);
  test(`ADR-0069 A4: ${rel} imports readEwcLambdaFromConfig from shared module`, () => {
    assert.ok(existsSync(abs), `caller file missing: ${abs}`);
    const src = readFileSync(abs, 'utf-8');

    // Must import the helper
    assert.match(
      src,
      /import\s*\{[^}]*\breadEwcLambdaFromConfig\b[^}]*\}\s*from\s*['"][^'"]*embedding-config(?:\.js)?['"]/,
      `${rel} must import readEwcLambdaFromConfig from embedding-config`,
    );

    // Must NOT contain a local definition
    assert.doesNotMatch(
      src,
      /^function readEwcLambdaFromConfig\b/m,
      `${rel} must not define a local readEwcLambdaFromConfig`,
    );

    // Must still call the helper (no silent deletion of call site)
    assert.match(
      src,
      /\breadEwcLambdaFromConfig\s*\(\s*\d+/,
      `${rel} must still call readEwcLambdaFromConfig(...)`,
    );
  });
}
