/**
 * ADR-0069 Appendix A1 — every WAL-enabling init site in agentic-flow
 * production code must set busy_timeout alongside journal_mode=WAL.
 *
 * Scope (matches ADR-0069:324 audit):
 *   - agentic-flow/src/**          (fork runtime sources, .ts / .js / .mjs)
 *   - packages/agentdb/src/**      (fork runtime sources)
 *   - examples/research-swarm/**   (shipped example scripts that open real WAL DBs)
 *
 * Excluded (intentionally):
 *   - tests/ — ephemeral per-test DBs, per ADR-0069 Appendix A1 scope
 *   - *.d.ts, *.js.map, docs/, dist/, node_modules/ — non-source
 *   - .claude/ — local dev hooks, outside product scope
 *
 * Failure mode: any production file that sets journal_mode=WAL without a
 * busy_timeout in the same file (ADR-0069 A1 says "required with WAL mode").
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const FORK_ROOT = '/Users/henrik/source/forks/agentic-flow';

function listTrackedFiles() {
  const out = execSync('git ls-files', { cwd: FORK_ROOT, encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

function inScope(rel) {
  // Production source roots
  const prodRoots = [
    'agentic-flow/src/',
    'packages/agentdb/src/',
    'packages/agentdb-onnx/src/',
    'packages/agent-booster/src/',
    'examples/research-swarm/lib/',
    'examples/research-swarm/scripts/',
  ];
  if (!prodRoots.some((r) => rel.startsWith(r))) return false;
  // Exclude test/spec files, declaration files, maps, docs, dist
  if (/\.(test|spec)\.(ts|js|mjs|cjs)$/.test(rel)) return false;
  if (rel.includes('/tests/') || rel.includes('/__tests__/') || rel.includes('/test/')) return false;
  if (rel.endsWith('.d.ts')) return false;
  if (rel.endsWith('.js.map') || rel.endsWith('.d.ts.map')) return false;
  if (rel.includes('/docs/') || rel.includes('/dist/')) return false;
  // Only source file extensions
  if (!/\.(ts|js|mjs|cjs)$/.test(rel)) return false;
  return true;
}

// Real WAL-enabling init patterns:
//   db.pragma('journal_mode = WAL') / db.pragma("journal_mode=WAL")
//   db.prepare('PRAGMA journal_mode=WAL').{run,get}
//   db.exec('PRAGMA journal_mode=WAL')
//   db.run('PRAGMA journal_mode=WAL')
// Excluded: comments that happen to contain the literal "journal_mode = WAL",
// and PRAGMA journal_mode=DELETE/MEMORY/TRUNCATE.
const WAL_INIT_RE =
  /(?:\.pragma\s*\(\s*['"`][^'"`]*journal_mode\s*=\s*WAL|\.(?:prepare|exec|run)\s*\(\s*['"`][^'"`]*PRAGMA[^'"`]*journal_mode\s*=\s*WAL)/i;

function findHits() {
  const files = listTrackedFiles();
  const hits = [];
  for (const rel of files) {
    if (!inScope(rel)) continue;
    const abs = path.join(FORK_ROOT, rel);
    let content;
    try {
      if (!statSync(abs).isFile()) continue;
      content = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    if (!WAL_INIT_RE.test(content)) continue;
    if (!/busy_timeout/i.test(content)) {
      hits.push(rel);
    }
  }
  return hits;
}

test('ADR-0069 A1: every production WAL-init file sets busy_timeout', () => {
  const hits = findHits();
  assert.equal(
    hits.length,
    0,
    `Found ${hits.length} production WAL-enabling file(s) without busy_timeout:\n` +
      hits.map((h) => `  - ${h}`).join('\n'),
  );
});

test('ADR-0069 A1: known-fixed sites still contain busy_timeout (regression guard)', () => {
  const expected = [
    // Originally fixed by 196d2b9 / a7d5b95
    'agentic-flow/src/agentdb/cli/agentdb-cli.ts',
    'agentic-flow/src/agentdb/benchmarks/frontier-benchmark.ts',
    'agentic-flow/src/agentdb/benchmarks/comprehensive-benchmark.ts',
    'agentic-flow/src/reasoningbank/db/queries.ts',
    'agentic-flow/src/intelligence/EmbeddingCache.ts',
    'agentic-flow/src/intelligence/IntelligenceStore.ts',
    'agentic-flow/src/workers/worker-registry.ts',
    'packages/agentdb/src/mcp/agentdb-mcp-server.ts',
    'packages/agentdb/src/db/migrations/apply-migration.ts',
    'packages/agentdb/src/cli/agentdb-cli.ts',
    'packages/agentdb/src/cli/commands/init.ts',
    // Added by this task (ADR-0069 A1 residual round 3)
    'agentic-flow/src/reasoningbank/db/queries.js',
    'examples/research-swarm/lib/db-utils.js',
    'examples/research-swarm/scripts/optimize-db.js',
  ];
  for (const rel of expected) {
    const abs = path.join(FORK_ROOT, rel);
    const content = readFileSync(abs, 'utf8');
    assert.match(
      content,
      /busy_timeout/i,
      `${rel} is expected to contain busy_timeout (ADR-0069 A1 fixed site)`,
    );
  }
});
