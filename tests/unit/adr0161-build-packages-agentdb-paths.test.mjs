import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT_ROOT = '/Users/henrik/source/ruflo-patch';
const BUILD_PACKAGES_SH = join(PROJECT_ROOT, 'scripts/build-packages.sh');

test('ADR-0161: build-packages.sh references new agentdb paths (post-extraction)', () => {
  const src = readFileSync(BUILD_PACKAGES_SH, 'utf-8');
  assert.match(src, /\$\{TEMP_DIR\}\/cross-repo\/agentdb"/, 'build must reference cross-repo/agentdb (the 5th fork)');
  assert.match(src, /\$\{TEMP_DIR\}\/cross-repo\/agentdb\/packages\/agentdb-onnx"/, 'build must reference cross-repo/agentdb/packages/agentdb-onnx');
});

test('ADR-0161: build-packages.sh has NO references to deleted vendored paths', () => {
  const src = readFileSync(BUILD_PACKAGES_SH, 'utf-8');
  assert.doesNotMatch(src, /cross-repo\/agentic-flow\/packages\/agentdb["\s]/, 'must NOT reference deleted cross-repo/agentic-flow/packages/agentdb');
  assert.doesNotMatch(src, /cross-repo\/agentic-flow\/packages\/agentdb-onnx/, 'must NOT reference deleted cross-repo/agentic-flow/packages/agentdb-onnx');
});

test('ADR-0161: source AgentDB.ts has full controller switch (input to publish pipeline)', () => {
  const src = readFileSync('/Users/henrik/source/forks/agentdb/src/core/AgentDB.ts', 'utf-8');
  const cases = ['memory', 'reflexion', 'skills', 'reasoning', 'causal', 'causalGraph', 'causalRecall', 'learningSystem', 'explainableRecall', 'nightlyLearner', 'hierarchicalMemory', 'memoryConsolidation'];
  for (const c of cases) {
    assert.match(src, new RegExp(`case ['"]${c}['"]`), `forks/agentdb source must include case '${c}' in getController switch — without these, MCP tools resolve to null and acceptance B5 round-trips fail with 'Controller not available'`);
  }
});
