// @tier unit
// ADR-0097 Tier Z — paired unit test for
// lib/acceptance-adr0059-checks.sh :: check_adr0059_no_id_collisions.
//
// This is the ADR-0082 loud-fail variant of the old "fresh project silent
// pass" check. It exercises the full consolidate→init pipeline in
// intelligence.cjs via a synthetic RVF\0 seed. The check's own docstring
// explains why the seed is written directly instead of via `$cli memory
// store` (BUG-ADR0059-RVF-FORMAT-MISMATCH: native SFVR format is incompatible
// with intelligence.cjs's pure-TS RVF\0 reader).
//
// Scenarios covered:
//   - happy             → all ranked IDs unique → PASS
//   - intelligence-missing → loud FAIL with explicit diag
//   - consolidate-empty (intelligence.cjs returns no ranked file) → FAIL
//   - collision         → intelligence.cjs emits a duplicate ID → FAIL
//   - zero-entries      → ranked-context.json has entries:[] → FAIL
//
// Paired with: lib/acceptance-adr0059-checks.sh
// Closes:      docs/bugs/coverage-ledger.md :: BUG-ADR0059-NO-COLLISIONS-SILENT-PASS

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const HARNESS = resolve(ROOT, 'lib', 'acceptance-harness.sh');
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-adr0059-checks.sh');

// Four shim variants of intelligence.cjs. Each exposes the same surface
// (recordEdit/consolidate/init) but routes the final ranked-context.json
// shape through a different failure / success path.
function intelligenceShim(mode) {
  const common = [
    "const fs = require('fs');",
    "const path = require('path');",
    "function rankedPath() { return path.join(process.cwd(), '.claude-flow', 'data', 'ranked-context.json'); }",
    "function ensureDir() { fs.mkdirSync(path.join(process.cwd(), '.claude-flow', 'data'), { recursive: true }); }",
    "function recordEdit(_f) { /* no-op: collision shape is driven by init */ }",
    "function consolidate() { return { entries: 7, edges: 0, newEntries: 5, message: 'Consolidated' }; }",
  ];
  switch (mode) {
    case 'happy':
      return [
        ...common,
        "function init() {",
        "  ensureDir();",
        "  const entries = Array.from({ length: 7 }, (_, i) => ({ id: 'u-' + i }));",
        "  fs.writeFileSync(rankedPath(), JSON.stringify({ version: 1, entries }));",
        "  return { nodes: entries.length, edges: 0, message: 'ok' };",
        "}",
        "module.exports = { recordEdit, consolidate, init };",
      ].join('\n');

    case 'consolidate-empty':
      // init reports no nodes and does NOT produce ranked-context.json.
      return [
        ...common,
        "function init() { return { nodes: 0, edges: 0, message: 'No memory entries to index' }; }",
        "module.exports = { recordEdit, consolidate, init };",
      ].join('\n');

    case 'collision':
      return [
        ...common,
        "function init() {",
        "  ensureDir();",
        "  const entries = [{ id: 'dup' }, { id: 'dup' }, { id: 'ok' }];",
        "  fs.writeFileSync(rankedPath(), JSON.stringify({ version: 1, entries }));",
        "  return { nodes: entries.length, edges: 0, message: 'ok' };",
        "}",
        "module.exports = { recordEdit, consolidate, init };",
      ].join('\n');

    case 'zero-entries':
      return [
        ...common,
        "function init() {",
        "  ensureDir();",
        "  fs.writeFileSync(rankedPath(), JSON.stringify({ version: 1, entries: [] }));",
        "  return { nodes: 0, edges: 0, message: 'ok' };",
        "}",
        "module.exports = { recordEdit, consolidate, init };",
      ].join('\n');

    default:
      throw new Error('unknown intelligence shim mode: ' + mode);
  }
}

// Run check_adr0059_no_id_collisions under a synthetic E2E dir.
//   mode === 'missing-intelligence' → do not write intelligence.cjs.
//   otherwise                       → write an intelligence.cjs shim.
function runCheck(mode) {
  const root = mkdtempSync(resolve(tmpdir(), 'adr0059-nocol-unit-'));
  const e2e = resolve(root, 'e2e');
  mkdirSync(resolve(e2e, '.claude-flow', 'data'), { recursive: true });
  mkdirSync(resolve(e2e, '.swarm'), { recursive: true });
  mkdirSync(resolve(e2e, '.claude', 'helpers'), { recursive: true });
  writeFileSync(resolve(e2e, 'package.json'), '{"name":"adr0059-nocol-unit"}');

  if (mode !== 'missing-intelligence') {
    writeFileSync(
      resolve(e2e, '.claude', 'helpers', 'intelligence.cjs'),
      intelligenceShim(mode),
    );
  }

  // The check calls _e2e_isolate which expects .claude-flow/.swarm to exist
  // and does `cp -r` on them. We stub _e2e_isolate to a minimal, race-safe
  // variant that mirrors the real one's contract (isolated dir, stripped
  // of any pre-existing RVF files).
  const driver = [
    'set -u',
    `cd "${ROOT}"`,
    `export TEMP_DIR="${root}"`,
    `export E2E_DIR="${e2e}"`,
    'export REGISTRY="http://shim.invalid"',
    'export PKG="@shim/cli"',
    '',
    `source "${HARNESS}"`,
    `source "${CHECK_FILE}"`,
    '',
    // Stub _e2e_isolate — copy .claude/ (needed: helpers/intelligence.cjs
    // is referenced via $E2E_DIR/.claude/helpers) and a fresh .claude-flow
    // working dir. Stripping pre-existing RVF matches the real helper.
    '_e2e_isolate() {',
    '  local id="$1"',
    `  local iso="${root}/iso-$id-$$-$RANDOM"`,
    '  rm -rf "$iso"; mkdir -p "$iso/.claude-flow" "$iso/.swarm"',
    '  # copy intelligence.cjs so `require($h/intelligence.cjs)` resolves',
    `  mkdir -p "$iso/.claude/helpers"`,
    `  if [[ -f "${e2e}/.claude/helpers/intelligence.cjs" ]]; then`,
    `    cp "${e2e}/.claude/helpers/intelligence.cjs" "$iso/.claude/helpers/intelligence.cjs"`,
    '  fi',
    '  # Point $h at the iso copy so the check node invocation resolves it',
    `  h="$iso/.claude/helpers"`,
    '  echo "$iso"',
    '}',
    '',
    'check_adr0059_no_id_collisions',
    'echo "RESULT_PASSED=$_CHECK_PASSED"',
    'echo "RESULT_OUTPUT<<<$_CHECK_OUTPUT>>>END"',
  ].join('\n');

  const result = spawnSync('bash', ['-c', driver], { encoding: 'utf8', timeout: 45_000 });
  rmSync(root, { recursive: true, force: true });
  const stdout = result.stdout || '';
  return {
    stdout,
    stderr: result.stderr || '',
    passed: (stdout.match(/RESULT_PASSED=(\S+)/) || [])[1],
    output: (stdout.match(/RESULT_OUTPUT<<<([\s\S]*?)>>>END/) || [])[1] || '',
  };
}

describe('check_adr0059_no_id_collisions (ADR-0082 loud-fail)', () => {
  it('lib and harness files exist', () => {
    assert.ok(existsSync(HARNESS), `missing harness: ${HARNESS}`);
    assert.ok(existsSync(CHECK_FILE), `missing lib: ${CHECK_FILE}`);
  });

  it('PASS when all ranked IDs are unique', () => {
    const r = runCheck('happy');
    assert.equal(r.passed, 'true', `expected PASS, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
    assert.match(r.output, /No collisions:\s*\d+\s*entries, all unique/,
      `PASS output should name the count: ${r.output}`);
  });

  it('FAIL-loud when intelligence.cjs is missing (ADR-0082)', () => {
    const r = runCheck('missing-intelligence');
    assert.equal(r.passed, 'false',
      `missing intelligence.cjs must FAIL, got ${r.passed} / ${r.output}`);
    assert.match(r.output, /intelligence\.cjs missing from build/,
      `output must name the missing file: ${r.output}`);
    assert.match(r.output, /ADR-0082 loud-fail/,
      `output must cite ADR-0082: ${r.output}`);
  });

  it('FAIL when consolidate+init do not produce ranked-context.json', () => {
    const r = runCheck('consolidate-empty');
    assert.equal(r.passed, 'false',
      `no-ranked must FAIL, got ${r.passed} / ${r.output}`);
    assert.match(r.output, /ranked-context\.json was not produced|NO_RANKED/,
      `output must name the missing ranked file: ${r.output}`);
  });

  it('FAIL when ranked-context.json contains duplicate IDs (the canary)', () => {
    const r = runCheck('collision');
    assert.equal(r.passed, 'false',
      `collision must FAIL, got ${r.passed} / ${r.output}`);
    assert.match(r.output, /ID collisions:\s*\d+\s*entries,\s*\d+\s*unique/,
      `output must report total and unique counts: ${r.output}`);
  });

  it('FAIL when ranked-context.json has zero entries (not silent-pass)', () => {
    const r = runCheck('zero-entries');
    assert.equal(r.passed, 'false',
      `zero-entries must FAIL (ADR-0082), got ${r.passed} / ${r.output}`);
    assert.match(r.output, /zero entries after seeding|RVF\\0 seed did not survive/,
      `output must explain the zero-entries branch: ${r.output}`);
  });
});
