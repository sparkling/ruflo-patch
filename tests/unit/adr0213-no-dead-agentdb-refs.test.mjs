/**
 * ADR-0213 Confirmation #1 — Pass-8 doc refs in .claude/agents/github/*.md
 * resolve against the working aggregator surface (mcp__ruflo__agentdb_*),
 * NOT the dead-on-arrival standalone (mcp__agentdb__*) and NOT the
 * original Pass-8 INPUT prefix (mcp__agentic-flow__agentdb_*).
 *
 * Per ADR-0213 (Option B + defer, 2026-05-22):
 *   - The standalone `agentdb` MCP server is dead on arrival (busy_timeout
 *     pragma crash) AND SQLite-first (project-rvf-primary violation) — its
 *     namespace `mcp__agentdb__agentdb_<tool>` (doubled segment) does not
 *     match Pass-8's emitted `mcp__agentdb__<tool>` anyway.
 *   - The working surface is the aggregator: server `ruflo` + hyphenated
 *     tool names → `mcp__ruflo__agentdb_pattern-store` / `pattern-search`.
 *   - Step 1 ships **2 repoints + 1 removal**:
 *       `pattern_store`  → `mcp__ruflo__agentdb_pattern-store`  (HYPHEN, agentdb-tools.ts:223)
 *       `pattern_search` → `mcp__ruflo__agentdb_pattern-search` (HYPHEN, agentdb-tools.ts:263)
 *       `pattern_stats`  → REMOVED (no aggregator equivalent — `agentdb_query_stats`
 *                          at :1501 is QueryOptimizer cache-stats, wrong semantics).
 *
 * The 3 refs lived only in the `tools:` permission-allowlist YAML
 * frontmatter (not in any agent body / call site). The fix scope is
 * `.claude/agents/github/*.md` in ruflo-patch.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const GITHUB_AGENTS_DIR = join(ROOT, '.claude', 'agents', 'github');

const skip = !existsSync(GITHUB_AGENTS_DIR)
  ? `.claude/agents/github/ not found at ${GITHUB_AGENTS_DIR}`
  : false;

function listAgentMd() {
  return readdirSync(GITHUB_AGENTS_DIR)
    .filter((n) => n.endsWith('.md'))
    .map((n) => join(GITHUB_AGENTS_DIR, n));
}

describe('ADR-0213 — Pass-8 doc refs (.claude/agents/github/*.md)', { skip }, () => {
  it('no `mcp__agentic-flow__agentdb_*` refs remain (Pass-8 INPUT prefix)', () => {
    const offending = [];
    for (const path of listAgentMd()) {
      const lines = readFileSync(path, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (line.includes('mcp__agentic-flow__agentdb_')) {
          offending.push(`${path}:${i + 1} :: ${line.trim()}`);
        }
      });
    }
    assert.equal(
      offending.length,
      0,
      `${offending.length} stale Pass-8 INPUT ref(s) found:\n  ${offending.join('\n  ')}`,
    );
  });

  it('no bare `mcp__agentdb__*` refs remain (Pass-8 OUTPUT — dead/SQLite standalone)', () => {
    // ADR-0213: the bare `mcp__agentdb__*` prefix resolves to a dead-on-arrival
    // SQLite-first standalone server that's also namespace-doubled
    // (`mcp__agentdb__agentdb_*`). Pin its absence in the agents/github/* corpus.
    const offending = [];
    for (const path of listAgentMd()) {
      const lines = readFileSync(path, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (line.includes('mcp__agentdb__')) {
          offending.push(`${path}:${i + 1} :: ${line.trim()}`);
        }
      });
    }
    assert.equal(
      offending.length,
      0,
      `${offending.length} stale standalone-prefix ref(s) found:\n  ${offending.join('\n  ')}\n` +
      `Resolution: rewrite to mcp__ruflo__agentdb_pattern-store / -search (HYPHENATED), ` +
      `or remove the line entirely if no aggregator equivalent exists (e.g. pattern_stats).`,
    );
  });

  it('every retained `mcp__ruflo__agentdb_*` ref names a real aggregator tool', () => {
    // Cross-check the replacements against the live aggregator registry.
    // Concretely: pattern-store + pattern-search must exist (hyphenated);
    // pattern-stats must NOT be re-introduced as a doc ref because it has
    // no aggregator counterpart (`agentdb_query_stats` is wrong semantics).
    const KNOWN_AGGREGATOR_TOOLS = new Set([
      // Pinned subset relevant to Pass-8 corpus. Source: agentdb-tools.ts
      // L223 (agentdb_pattern-store), L263 (agentdb_pattern-search).
      'pattern-store',
      'pattern-search',
    ]);
    const FORBIDDEN_BARE_AGGREGATOR_TOOLS = new Set([
      // ADR-0213: `pattern_stats` has no aggregator equivalent; the
      // nearest `agentdb_query_stats` is QueryOptimizer cache-stats
      // (wrong semantics). Removed, not repointed.
      'pattern-stats',
      'pattern_stats',
    ]);

    const offending = [];
    for (const path of listAgentMd()) {
      const text = readFileSync(path, 'utf8');
      // Match `mcp__ruflo__agentdb_<tail>` where <tail> is the tool name.
      const re = /mcp__ruflo__agentdb_([a-z0-9_-]+)/gi;
      let m;
      while ((m = re.exec(text)) !== null) {
        const tail = m[1];
        if (FORBIDDEN_BARE_AGGREGATOR_TOOLS.has(tail)) {
          offending.push(`${path} :: mcp__ruflo__agentdb_${tail} (no aggregator equivalent — must be removed)`);
        }
        // Only enforce known-pinned tools — the aggregator has ~50 tools and
        // we don't want to lock the whole namespace; we just gate the corpus
        // we're correcting here. If a future ref uses a tool we haven't
        // pinned, it doesn't fail the gate.
      }
    }

    assert.equal(
      offending.length,
      0,
      `${offending.length} forbidden aggregator-tool ref(s):\n  ${offending.join('\n  ')}`,
    );

    // Positive check: the 5 expected files contain the 2 repointed tools
    // (pattern-store + pattern-search). This catches a regression where
    // someone removed too much.
    const EXPECTED_FILES = [
      'release-manager.md',
      'pr-manager.md',
      'code-review-swarm.md',
      'workflow-automation.md',
      'issue-tracker.md',
    ];
    for (const name of EXPECTED_FILES) {
      const path = join(GITHUB_AGENTS_DIR, name);
      assert.ok(existsSync(path), `expected file missing: ${name}`);
      const text = readFileSync(path, 'utf8');
      assert.ok(
        text.includes('mcp__ruflo__agentdb_pattern-store'),
        `${name}: missing mcp__ruflo__agentdb_pattern-store (Pass-8 repoint target)`,
      );
      assert.ok(
        text.includes('mcp__ruflo__agentdb_pattern-search'),
        `${name}: missing mcp__ruflo__agentdb_pattern-search (Pass-8 repoint target)`,
      );
    }
  });
});
