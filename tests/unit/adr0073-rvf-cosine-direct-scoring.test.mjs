// @tier unit
// ADR-0073 amendment regression pin (2026-05-22): memory_search native scoring
// must compute cosine DIRECTLY from the stored + query vectors, NOT convert
// `1 - nativeDistance` under the (config) metric assumption.
//
// Root cause: RVF's native `open()` does not persist the distance metric —
// RuVector rvf-runtime `try_open_once` rebuilds `RvfOptions { ..Default::default() }`
// (metric -> L2). So a store CREATED with metric:'cosine' REOPENS as L2, its
// query returns an L2^2 distance (= 2 - 2cos for the unit-normalized mpnet
// embeddings), and the old `this.config.metric === 'cosine' ? 1 - r.distance`
// formula yielded `2cos - 1` (negative for merely-related content). The 0.3
// threshold gate then dropped everything -> memory_search returned total:0.
//
// Fix: score via cosineSimilarity(query, stored) — metric-independent, matches
// pureTsSearch/bruteForceSearch and upstream agentic-flow's ruvector-backend.
//
// This unit test pins the fix in SOURCE (deterministic). The behavioural
// cross-process validation (store -> close -> reopen -> search -> assert the
// score ~= true cosine, not 2cos-1) lives in the acceptance tier, where the
// installed CLI provides a consistent native+JS pair — the unit tier cannot
// (its JS resolves a version-mismatched native; same constraint documented in
// rvf-search-orphan-numid.test.mjs).

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const RVF_BACKEND_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts';

describe('ADR-0073 amendment: memory_search scores cosine directly (not 1 - metric-distance)', () => {
  it('native search computes cosine directly from query + stored vectors', () => {
    const src = readFileSync(RVF_BACKEND_SRC, 'utf8');
    assert.match(
      src,
      /const score = cosineSimilarity\(embedding, entry\.embedding\)/,
      'native search must score via cosineSimilarity(query, stored) — metric-independent',
    );
  });

  it('the metric-assuming `1 - r.distance` cosine conversion is gone (the 2cos-1 regression)', () => {
    const src = readFileSync(RVF_BACKEND_SRC, 'utf8');
    // This exact conversion produced 2cos-1 on a reopened (L2) store. If it ever
    // returns, the regression is back. r.distance must not be converted to a
    // cosine score anywhere.
    assert.doesNotMatch(
      src,
      /metric === 'cosine'\s*\?\s*1 - r\.distance/,
      'native search must NOT convert `1 - r.distance` under config.metric (RVF open() does not persist the metric -> L2 -> 2cos-1)',
    );
    // Strip line/block comments so the explanatory comment that *names* the old
    // formula (to document why it was removed) doesn't trip this guard — we only
    // forbid `1 - r.distance` in actual CODE.
    const codeOnly = src
      .split('\n')
      .filter((l) => { const t = l.trim(); return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*'); })
      .join('\n');
    assert.doesNotMatch(
      codeOnly,
      /1 - r\.distance/,
      '`1 - r.distance` must not appear in code — score comes from cosineSimilarity, distance from `1 - score`',
    );
  });

  it('documents the non-persisted-metric root cause at the fix site', () => {
    const src = readFileSync(RVF_BACKEND_SRC, 'utf8');
    assert.match(
      src,
      /does NOT persist the distance metric/,
      'the fix must document WHY (RVF open() metric non-persistence) so it is not "simplified" back',
    );
  });
});
