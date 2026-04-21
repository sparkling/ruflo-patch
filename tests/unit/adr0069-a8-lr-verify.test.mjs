/**
 * ADR-0069 A8 residual closure: verify config-chain learning rate helpers
 * are wired at every site in `sona-adapter.ts` and `self-learning.ts`.
 *
 * Historical note: ADR-0069:489 claims "sona-adapter.ts per-mode LR uses
 * multipliers; self-learning.ts 5 sites use readLearningRate()". During
 * this audit we found a 6th site in self-learning.ts
 * (HIGH_ACCURACY_LEARNING_CONFIG) that hardcoded 0.05 — now remediated.
 * This test prevents regression for all sites.
 *
 * Level: unit (grep-based static assertion against fork source files).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const FORKS_ROOT = '/Users/henrik/source/forks/ruflo/v3';
const SONA = `${FORKS_ROOT}/@claude-flow/integration/src/sona-adapter.ts`;
const SELF = `${FORKS_ROOT}/@claude-flow/plugins/src/integrations/ruvector/self-learning.ts`;

function countMatches(src, regex) {
  const m = src.match(regex);
  return m ? m.length : 0;
}

test('ADR-0069 A8 — sona-adapter.ts defines readBaseLearningRate helper', () => {
  if (!existsSync(SONA)) {
    assert.fail(`Fork file missing: ${SONA} — did the ruflo fork move?`);
  }
  const src = readFileSync(SONA, 'utf8');
  assert.match(src, /function readBaseLearningRate\(/, 'helper not defined');
  assert.match(src, /neural\?\.defaultLearningRate/, 'helper does not read neural.defaultLearningRate');
});

test('ADR-0069 A8 — sona-adapter.ts has zero hardcoded learningRate literals', () => {
  const src = readFileSync(SONA, 'utf8');
  // Any `learningRate: <digit>` is a regression (helper-derived baseLR * N is fine).
  const hardcoded = countMatches(src, /learningRate:\s*[0-9]/g);
  assert.equal(hardcoded, 0, 'sona-adapter.ts has hardcoded learningRate literals; all must use baseLR multipliers');
});

test('ADR-0069 A8 — sona-adapter.ts per-mode LR uses baseLR multipliers', () => {
  const src = readFileSync(SONA, 'utf8');
  // Each of the 5 MODE_CONFIGS must derive learningRate from baseLR.
  const multiplierSites = countMatches(src, /learningRate:\s*baseLR\s*\*/g);
  assert.ok(multiplierSites >= 5,
    `expected >=5 baseLR-multiplier sites (MODE_CONFIGS real-time/balanced/research/edge/batch), found ${multiplierSites}`);
  // mergeConfig fallback uses baseLR directly.
  assert.match(src, /learningRate:\s*config\.learningRate\s*\?\?\s*baseLR/, 'mergeConfig fallback must use baseLR');
});

test('ADR-0069 A8 — self-learning.ts defines readLearningRate helper', () => {
  if (!existsSync(SELF)) {
    assert.fail(`Fork file missing: ${SELF} — did the ruflo fork move?`);
  }
  const src = readFileSync(SELF, 'utf8');
  assert.match(src, /function readLearningRate\(/, 'helper not defined');
  assert.match(src, /neural\?\.defaultLearningRate/, 'helper does not read neural.defaultLearningRate');
});

test('ADR-0069 A8 — self-learning.ts has zero hardcoded learningRate literals', () => {
  const src = readFileSync(SELF, 'utf8');
  const hardcoded = countMatches(src, /learningRate:\s*[0-9]/g);
  assert.equal(hardcoded, 0,
    'self-learning.ts has hardcoded learningRate literals; all assignments must go through readLearningRate()');
});

test('ADR-0069 A8 — self-learning.ts wires readLearningRate at every assignment site', () => {
  const src = readFileSync(SELF, 'utf8');
  const helperSites = countMatches(src, /learningRate:\s*readLearningRate\(/g);
  // Original ADR claim was 5; with HIGH_ACCURACY_LEARNING_CONFIG remediation this is now 6.
  assert.ok(helperSites >= 6,
    `expected >=6 readLearningRate() call sites (incl. HIGH_ACCURACY_LEARNING_CONFIG); found ${helperSites}`);
});
