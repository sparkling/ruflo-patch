// @tier unit
// ADR-0074: CJS/ESM Dual Silo Fix
//
// Tests that the three ADR-0074 phases are wired correctly in the fork source:
//   Phase 1a: loadMemoryPackage() Strategy 4 checks both @sparkleideas/memory and @claude-flow/memory
//   Phase 2:  doSync() removed by ADR-0083 (drain centralized in memory-router.ts)
//   Phase 3:  consolidate() evicts stale entries + caps at 2000

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FORK_ROOT = '/Users/henrik/source/forks/ruflo/v3';
const HELPERS_DIR = resolve(FORK_ROOT, '@claude-flow/cli/.claude/helpers');

// Read source files once — all tests assert against the actual fork source
const autoMemoryHook = readFileSync(resolve(HELPERS_DIR, 'auto-memory-hook.mjs'), 'utf-8');
const intelligenceCjs = readFileSync(resolve(HELPERS_DIR, 'intelligence.cjs'), 'utf-8');

// ============================================================================
// Phase 1a: loadMemoryPackage() scope fix
// ============================================================================

describe('ADR-0074 Phase 1a: loadMemoryPackage() Strategy 4 scope walk-up', () => {
  it('Strategy 4 checks @sparkleideas/memory in the walk-up path', () => {
    // The for-of loop in Strategy 4 must include the published scope
    assert.ok(
      autoMemoryHook.includes("'@sparkleideas/memory'"),
      'Strategy 4 must check @sparkleideas/memory in the node_modules walk-up',
    );
  });

  it('Strategy 4 also checks @claude-flow/memory for backward compat', () => {
    // Both scopes must be present for the walk-up to work in dev and published contexts
    assert.ok(
      autoMemoryHook.includes("'@claude-flow/memory'"),
      'Strategy 4 must check @claude-flow/memory for backward compatibility',
    );
  });

  it('Strategy 4 iterates both scopes in a single array literal', () => {
    // The loop should have both scopes in one array, not two separate blocks
    // Pattern: for (const pkg of ['@sparkleideas/memory', '@claude-flow/memory'])
    const arrayPattern = /for\s*\(\s*const\s+\w+\s+of\s+\[.*'@sparkleideas\/memory'.*'@claude-flow\/memory'.*\]/s;
    assert.ok(
      arrayPattern.test(autoMemoryHook),
      'Strategy 4 must iterate both scopes via a single array literal in for-of',
    );
  });

  it('Strategy 4 walks up with dirname() until reaching root', () => {
    // Verify the walk-up pattern: searchDir = dirname(searchDir) + root check
    assert.ok(
      autoMemoryHook.includes('parse(searchDir).root'),
      'Strategy 4 must compare against filesystem root to stop walk-up',
    );
  });
});

// ============================================================================
// Phase 2: Intelligence drain in doSync()
// ============================================================================

// ADR-0083 supersedes Phase 2: doSync() removed — router centralizes JSON
// sidecar writes, eliminating the separate CJS→RVF drain path.
describe('ADR-0074 Phase 2: doSync() removed by ADR-0083', () => {
  it('doSync() function no longer exists', () => {
    assert.ok(
      !autoMemoryHook.includes('async function doSync()'),
      'doSync() must be removed — ADR-0083 centralizes the drain in memory-router',
    );
  });

  it('sync case handler no longer exists', () => {
    assert.ok(
      !autoMemoryHook.includes("case 'sync'"),
      "case 'sync' must be removed from the switch — doSync is gone",
    );
  });

  it('ADR-0083 removal comment exists', () => {
    assert.ok(
      autoMemoryHook.includes('ADR-0083'),
      'ADR-0083 removal comment must exist where doSync was',
    );
  });
});

// ============================================================================
// Phase 3: Store eviction + cap in consolidate()
// ============================================================================

describe('ADR-0074 Phase 3: consolidate() eviction + cap', () => {
  // Extract the consolidate function body for focused assertions
  const consolidateStart = intelligenceCjs.indexOf('function consolidate()');
  const consolidateEnd = intelligenceCjs.indexOf('module.exports');
  const consolidateBody = intelligenceCjs.slice(consolidateStart, consolidateEnd);

  it('MAX_STORE_ENTRIES = 1000', () => {
    assert.ok(
      consolidateBody.includes('MAX_STORE_ENTRIES = 1000'),
      'consolidate() must define MAX_STORE_ENTRIES = 1000 (ADR-0080)',
    );
  });

  it('EVICTION_AGE_MS = 30 days in milliseconds', () => {
    assert.ok(
      consolidateBody.includes('EVICTION_AGE_MS = 30 * 24 * 60 * 60 * 1000'),
      'EVICTION_AGE_MS must equal 30 * 24 * 60 * 60 * 1000 (30 days)',
    );
  });

  it('eviction criteria: confidence <= 0.05 AND age > 30 days AND accessCount === 0', () => {
    // All three conditions must appear in the filter predicate
    assert.ok(
      consolidateBody.includes('confidence <= 0.05'),
      'eviction must check confidence <= 0.05',
    );
    assert.ok(
      consolidateBody.includes('age > EVICTION_AGE_MS'),
      'eviction must check age > EVICTION_AGE_MS',
    );
    assert.ok(
      consolidateBody.includes('accessCount === 0'),
      'eviction must check accessCount === 0',
    );
    // They must be ANDed together (&&), not ORed
    const filterLine = consolidateBody
      .split('\n')
      .find(l => l.includes('confidence <= 0.05') && l.includes('accessCount === 0'));
    assert.ok(filterLine, 'all three eviction criteria must be on the same filter line');
    assert.ok(
      filterLine.includes('&&'),
      'eviction criteria must be ANDed (&&), not ORed',
    );
  });

  it('entries meeting only 1 or 2 criteria are NOT evicted (AND semantics)', () => {
    // The filter uses return false only when ALL three conditions are true.
    // Verify the line uses && between all three — partial matches must not evict.
    const filterLines = consolidateBody
      .split('\n')
      .filter(l => l.includes('confidence <= 0.05') || l.includes('accessCount === 0'));
    // Find the line that has the full eviction predicate
    const evictionLine = filterLines.find(l =>
      l.includes('confidence <= 0.05') && l.includes('accessCount === 0'),
    );
    assert.ok(evictionLine, 'must have a single eviction predicate line');
    // Count && occurrences — need at least 2 for three conditions
    const andCount = (evictionLine.match(/&&/g) || []).length;
    assert.ok(andCount >= 2,
      `eviction predicate must have >= 2 && operators (found ${andCount}) — ensures AND semantics`,
    );
  });

  it('over-cap entries are dropped by lowest rank (score-based sort)', () => {
    assert.ok(
      consolidateBody.includes('store.length > MAX_STORE_ENTRIES'),
      'consolidate() must check if store exceeds MAX_STORE_ENTRIES after eviction',
    );
    // The cap logic must sort by score and slice
    assert.ok(
      consolidateBody.includes('.sort('),
      'over-cap logic must sort entries by score',
    );
    assert.ok(
      consolidateBody.includes('.slice(0, MAX_STORE_ENTRIES)'),
      'over-cap logic must slice to MAX_STORE_ENTRIES',
    );
  });

  it('evicted count is returned in result', () => {
    // The return statement must include 'evicted' key
    const returnBlock = consolidateBody.slice(consolidateBody.lastIndexOf('return {'));
    assert.ok(
      returnBlock.includes('evicted'),
      'consolidate() return value must include evicted count',
    );
  });

  it('store is persisted when eviction occurs', () => {
    // writeJSON(STORE_PATH, store) must be called when evicted > 0
    const persistLine = consolidateBody
      .split('\n')
      .find(l => l.includes('writeJSON(STORE_PATH, store)'));
    assert.ok(persistLine, 'consolidate() must call writeJSON(STORE_PATH, store)');
    assert.ok(
      persistLine.includes('evicted > 0'),
      'persist condition must include evicted > 0',
    );
  });

  it('eviction uses preEvictCount to compute evicted count', () => {
    assert.ok(
      consolidateBody.includes('preEvictCount = store.length'),
      'must capture preEvictCount before filtering',
    );
    assert.ok(
      consolidateBody.includes('evicted = preEvictCount - store.length'),
      'evicted must be computed as preEvictCount - store.length',
    );
  });
});
