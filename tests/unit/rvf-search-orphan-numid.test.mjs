// @tier unit
// RVF search orphan-numId self-heal — SOURCE-SHAPE contract (unit-tier).
//
// Symptom: memory_search returns 0 results despite stored embeddings, while
// memory_retrieve works. Cause: orphan numIds in the persisted SFVR file from
// prior processes — the current process's nativeReverseMap is empty at open,
// so native query() returns hits whose r.id maps to nothing and they're
// dropped. Fix at RvfBackend.search(): detect 100%-orphan native results and
// fall through to pureTsSearch over `this.entries` (loud-warn per ADR-0082).
//
// This unit test pins the fix is PRESENT in source (deterministic). The
// BEHAVIOURAL cross-process validation lives in the acceptance tier
// (`check_rvf_orphan_numid_selfheal`, lib/acceptance-rvf-checks.sh), where the
// installed CLI provides a consistent native+JS pair — the unit tier cannot
// (the build tree's JS resolves a stray, version-mismatched native, which is
// precisely what produces a spurious orphan-query failure). Originally "Bug-1".

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const RVF_BACKEND_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts';

describe('RVF search: orphan-numId self-heal branch is present (regression pin)', () => {
  it('source tracks orphan vs mapped native hits', () => {
    const src = readFileSync(RVF_BACKEND_SRC, 'utf8');
    assert.match(src, /orphanHits|mappedHits/, 'orphan-numId tracking must be present in rvf-backend.ts');
  });

  it('source provides a pure-TS search fallback for the all-orphan case', () => {
    const src = readFileSync(RVF_BACKEND_SRC, 'utf8');
    assert.match(src, /pureTsSearch/, 'pure-TS search fallback must exist for the orphan-self-heal path');
  });
});
