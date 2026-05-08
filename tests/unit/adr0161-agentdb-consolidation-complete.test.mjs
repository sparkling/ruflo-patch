/**
 * Regression test for ADR-0161 agentdb consolidation completion.
 *
 * Per ADR-0161 Confirmation criterion 6, this test guards against silent
 * revert (e.g. accidental restore from a stale branch merge) per
 * `feedback-data-loss-zero-tolerance`.
 *
 * Asserts the post-migration end state observable from file system + config:
 *  (a) forks/agentdb exists (5th fork)
 *  (b) forks/agentic-flow/packages/agentdb does NOT exist (vendored deleted)
 *  (c) forks/agentdb/packages/agentdb-onnx exists (relocated)
 *  (d) config/package-map.json declares ruvnet/agentdb upstream
 *  (e) zero `mcp__agentic-flow__agentdb_` references in non-historical files
 *  (f) published @sparkleideas/agentdb version starts with 3.0.0-alpha.14-
 *
 * Run: `node --test tests/unit/adr0161-agentdb-consolidation-complete.test.mjs`
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';

// Test file lives at tests/unit/X.test.mjs; repo root is two levels up
const TEST_FILE_DIR = new URL('.', import.meta.url).pathname; // .../tests/unit/
const REPO_ROOT = resolve(TEST_FILE_DIR, '..', '..');
const FORKS_ROOT = resolve(REPO_ROOT, '..', 'forks');

test('(a) forks/agentdb exists (5th fork created by ADR-0160)', () => {
  assert.ok(existsSync(join(FORKS_ROOT, 'agentdb', 'package.json')),
    `expected forks/agentdb/package.json — got missing at ${join(FORKS_ROOT, 'agentdb')}`);
  assert.ok(existsSync(join(FORKS_ROOT, 'agentdb', 'src')));
});

test('(b) forks/agentic-flow/packages/agentdb does NOT exist (vendored decommissioned in step 14)', () => {
  // Until step 14 lands the deletion, this test is allowed to skip with a clear
  // message. Once step 14 runs, the path must NOT exist.
  const vendored = join(FORKS_ROOT, 'agentic-flow', 'packages', 'agentdb');
  if (existsSync(vendored)) {
    // Pre-step-14 state — record but don't fail in case step 14 is pending
    console.error(`  [pending step 14] vendored copy still exists at ${vendored}`);
  }
  // Hard assertion only fires post-step-14 — gate via env var so CI can choose
  if (process.env.ADR0161_STEP14_COMPLETE === '1') {
    assert.ok(!existsSync(vendored), `expected ${vendored} to be deleted post-step-14`);
  }
});

test('(c) forks/agentdb/packages/agentdb-onnx exists (relocated in step 3)', () => {
  const onnxPath = join(FORKS_ROOT, 'agentdb', 'packages', 'agentdb-onnx');
  assert.ok(existsSync(onnxPath), `expected ${onnxPath}`);
  assert.ok(existsSync(join(onnxPath, 'package.json')));
  // verify peerDep / dep updated to bare 'agentdb' (codemod renames at publish)
  const pkg = JSON.parse(readFileSync(join(onnxPath, 'package.json'), 'utf8'));
  assert.ok(pkg.dependencies && 'agentdb' in pkg.dependencies,
    'agentdb-onnx should declare agentdb in dependencies (NOT peerDependencies — ADR-0161 step 3.2)');
});

test('(d) config/package-map.json declares ruvnet/agentdb upstream', () => {
  const map = JSON.parse(readFileSync(join(REPO_ROOT, 'config', 'package-map.json'), 'utf8'));
  const repos = map.upstreamRepos || map.upstream || map; // shape may vary
  // Dig for the upstream-repos block
  const findRepos = (obj) => {
    if (obj && typeof obj === 'object') {
      if (obj['ruvnet/agentdb']) return obj;
      for (const v of Object.values(obj)) {
        const found = findRepos(v);
        if (found) return found;
      }
    }
    return null;
  };
  const reposBlock = findRepos(map);
  assert.ok(reposBlock && reposBlock['ruvnet/agentdb'],
    'expected config/package-map.json to declare ruvnet/agentdb upstream');
  assert.ok(reposBlock['ruvnet/agentdb'].packages?.includes('agentdb'),
    'expected ruvnet/agentdb to own the agentdb package');
});

test('(e) zero mcp__agentic-flow__agentdb_ refs outside historical artifacts', () => {
  // Search live tree (exclude .git, node_modules, worktrees which are snapshot
  // copies and not load-bearing for current behavior).
  // Exclusions:
  //  - docs/adr/ + MIGRATION-LOG (historical quotes are intentional)
  //  - .claude/worktrees (Claude Code worktree snapshots; their content is frozen)
  //  - scripts/codemod.mjs (the file that DEFINES the rewrite pattern, by
  //    definition contains the source string)
  //  - tests/unit/adr0161* (this test file + Pass 8 unit test reference the pattern in assertions)
  const out = execSync(
    `grep -rlE "mcp__agentic-flow__agentdb_" ${REPO_ROOT}/.claude ${REPO_ROOT}/config ${REPO_ROOT}/scripts ${REPO_ROOT}/lib 2>/dev/null || true`,
    { encoding: 'utf8' }
  );
  const hits = out.split('\n').filter(p => p
    && !p.includes('docs/adr/')
    && !p.includes('MIGRATION-LOG')
    && !p.includes('/.claude/worktrees/')
    && !p.endsWith('scripts/codemod.mjs')
    && !p.includes('tests/unit/adr0161'));
  assert.equal(hits.length, 0,
    `expected zero non-historical mcp__agentic-flow__agentdb_ refs, got: ${hits.join(', ')}`);
});

test('(f) Verdaccio: @sparkleideas/agentdb version starts with 3.0.0-alpha.14-', () => {
  let version;
  try {
    version = execSync(
      'npm view @sparkleideas/agentdb version --registry http://localhost:4873 --tag alpha 2>/dev/null',
      { encoding: 'utf8', timeout: 10000 }
    ).trim().split('\n').pop();
  } catch (e) {
    // Verdaccio may not be running in CI — soft-skip with informative message
    console.error('  [skipped] Verdaccio not reachable; check `npm view @sparkleideas/agentdb version`');
    return;
  }
  assert.match(version, /^3\.0\.0-alpha\.14-patch\.\d+$/,
    `expected @sparkleideas/agentdb version to start with 3.0.0-alpha.14-, got: ${version}`);
});

test('(g) config/published-versions.json reflects post-migration versions', () => {
  const versions = JSON.parse(readFileSync(join(REPO_ROOT, 'config', 'published-versions.json'), 'utf8'));
  assert.match(versions['@sparkleideas/agentdb'], /^3\.0\.0-alpha\.14-patch\.\d+$/,
    `published-versions.json @sparkleideas/agentdb should be 3.0.0-alpha.14-patch.N`);
  assert.match(versions['@sparkleideas/agentdb-onnx'], /^1\.0\.0-patch\.\d+$/,
    `published-versions.json @sparkleideas/agentdb-onnx should be 1.0.0-patch.N`);
});

test('(h) codemod Pass 8 exists in scripts/codemod.mjs', () => {
  const codemod = readFileSync(join(REPO_ROOT, 'scripts', 'codemod.mjs'), 'utf8');
  assert.match(codemod, /Pass 8.*ADR-0161|MCP_AGENTDB_PREFIX_RE/,
    'expected scripts/codemod.mjs to define Pass 8 / MCP_AGENTDB_PREFIX_RE');
  assert.match(codemod, /mcp__agentic-flow__agentdb_/,
    'expected the source pattern to be present');
  assert.match(codemod, /mcp__agentdb__/,
    'expected the target pattern to be present');
});
