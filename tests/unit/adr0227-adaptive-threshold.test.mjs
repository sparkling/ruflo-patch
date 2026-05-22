// @tier unit
// ADR-0227 source guard (2026-05-22): the adaptive similarity floor for real
// ONNX (mpnet, ADR-0069) is 0.15, not 0.3 — measured related content scores
// ~0.25-0.65 cosine and the old 0.3 floor cut into recall. And the MCP
// memory_search tool must route through getAdaptiveThreshold (pass the caller's
// threshold through, possibly undefined) instead of hardcoding `?? 0.3`, which
// defeated the adaptive layer for the MCP path.
//
// Source-shape contract (deterministic). Behavioural validation lives in the
// acceptance tier (rvf-orphan-numid passes at the default floor; rvf-cosine-reopen).

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const ADAPTER = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/embedding-adapter.ts';
const MEM_TOOLS = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/memory-tools.ts';

describe('ADR-0227: adaptive similarity floor recalibrated to 0.15 for mpnet', () => {
  it('getAdaptiveThreshold floors real ONNX at 0.15 (not 0.3)', () => {
    const src = readFileSync(ADAPTER, 'utf8');
    assert.match(
      src,
      /getProvider\(\) === 'hash-fallback' \? 0\.05 : 0\.15/,
      'ONNX floor must be 0.15 (mpnet related content scores ~0.25-0.65; 0.3 cut into recall)',
    );
    // The non-adaptive hardcoded fallback stays 0.05; the old ONNX 0.3 must be gone.
    assert.doesNotMatch(
      src,
      /'hash-fallback' \? 0\.05 : 0\.3\b/,
      'the old ONNX 0.3 floor must be gone',
    );
  });

  it('MCP memory_search routes threshold through getAdaptiveThreshold (no hardcoded ?? 0.3)', () => {
    const src = readFileSync(MEM_TOOLS, 'utf8');
    assert.match(
      src,
      /const threshold = input\.threshold as number \| undefined;/,
      'memory_search must pass the caller threshold through (undefined → router/getAdaptiveThreshold), not hardcode a default',
    );
    assert.doesNotMatch(
      src,
      /const threshold = \(input\.threshold as number\) \?\? 0\.3;/,
      'the hardcoded `?? 0.3` (which defeated the adaptive layer for the MCP path) must be gone',
    );
  });
});
