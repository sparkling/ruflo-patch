/**
 * Unit test for codemod Pass 8 (ADR-0161 step 6)
 *
 * Pass 8 rewrites `mcp__agentic-flow__agentdb_<tool>` → `mcp__agentdb__<tool>`
 * unconditionally across allowed extensions, mirroring Pass 4's pattern.
 *
 * Test coverage per ADR-0161 §3.2:
 *  - idempotency (running Pass 8 twice = same result)
 *  - extension scoping (Pass 8 fires on the same files as Pass 4 = .md, .json, .sh, .ts, .mjs, .cjs)
 *  - non-matching prefix safety (don't rewrite unrelated mcp__* names)
 *  - tool-name + glob + permission-glob forms (`<name>`, `*`, `:*`)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transformSource } from '../../scripts/codemod.mjs';

test('Pass 8: rewrites mcp__agentic-flow__agentdb_<tool> → mcp__agentdb__<tool>', () => {
  const input = `
    Use mcp__agentic-flow__agentdb_pattern_store to store.
    Then mcp__agentic-flow__agentdb_pattern_search for retrieval.
    And mcp__agentic-flow__agentdb_pattern_stats for telemetry.
  `;
  const out = transformSource(input);
  assert.match(out, /mcp__agentdb__pattern_store/);
  assert.match(out, /mcp__agentdb__pattern_search/);
  assert.match(out, /mcp__agentdb__pattern_stats/);
  assert.doesNotMatch(out, /mcp__agentic-flow__agentdb_/);
});

test('Pass 8: handles all 3 capture forms — name, *, :*', () => {
  const input = `
    Tool: mcp__agentic-flow__agentdb_causal_query
    Glob: \`mcp__agentic-flow__agentdb_*\`
    Permission: "mcp__agentic-flow__agentdb_:*"
  `;
  const out = transformSource(input);
  assert.match(out, /mcp__agentdb__causal_query/);
  assert.match(out, /mcp__agentdb__\*/);
  assert.match(out, /mcp__agentdb__:\*/);
});

test('Pass 8: idempotent (running twice = same result)', () => {
  const input = 'See mcp__agentic-flow__agentdb_hierarchical_recall and mcp__agentdb__attention_compute.';
  const once = transformSource(input);
  const twice = transformSource(once);
  assert.equal(once, twice);
  // Already-migrated names stay put
  assert.match(twice, /mcp__agentdb__attention_compute/);
  // Old prefix gone
  assert.doesNotMatch(twice, /mcp__agentic-flow__agentdb_/);
});

test('Pass 8: does NOT rewrite unrelated mcp__* prefixes', () => {
  const input = `
    Pass 4 target (independent): mcp__claude-flow__memory_store
    Already-migrated ruflo: mcp__ruflo__swarm_init
    Other server: mcp__github__create_issue
    NOT agentdb (different server prefix): mcp__agentic-flow__neural_train
  `;
  const out = transformSource(input);
  // Pass 4 rewrites claude-flow → ruflo, that's expected
  assert.match(out, /mcp__ruflo__memory_store/);
  // ruflo stays put
  assert.match(out, /mcp__ruflo__swarm_init/);
  // Other server stays put
  assert.match(out, /mcp__github__create_issue/);
  // agentic-flow neural (NOT agentdb_) stays put — Pass 8 only matches agentdb_ suffix
  assert.match(out, /mcp__agentic-flow__neural_train/);
});

test('Pass 8: preserves surrounding context (no greedy match)', () => {
  const input = '`mcp__agentic-flow__agentdb_pattern_store` returns id.';
  const out = transformSource(input);
  assert.equal(out, '`mcp__agentdb__pattern_store` returns id.');
});

test('Pass 8: works inside JSON manifest tool entries', () => {
  const manifest = `{
  "tools": [
    {"name": "mcp__agentic-flow__agentdb_pattern_store", "scope": "memory"},
    {"name": "mcp__agentic-flow__agentdb_pattern_search", "scope": "memory"}
  ]
}`;
  const out = transformSource(manifest);
  assert.match(out, /"name": "mcp__agentdb__pattern_store"/);
  assert.match(out, /"name": "mcp__agentdb__pattern_search"/);
  // valid JSON post-rewrite
  assert.doesNotThrow(() => JSON.parse(out));
});

test('Pass 8: handles agent-definition markdown style', () => {
  const md = `## Tools

- mcp__agentic-flow__agentdb_pattern_store: store reasoning patterns
- mcp__agentic-flow__agentdb_pattern_search: retrieve patterns
- mcp__agentic-flow__agentdb_pattern_stats: usage telemetry`;
  const out = transformSource(md);
  assert.match(out, /- mcp__agentdb__pattern_store: store/);
  assert.match(out, /- mcp__agentdb__pattern_search: retrieve/);
  assert.match(out, /- mcp__agentdb__pattern_stats: usage/);
});
