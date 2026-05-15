// @tier unit
// ADR-0181 §C: memory_store handler full semantics — source-level smoke test.
//
// The authoritative handler test lives in
// `forks/agentdb/test/archivist/handlers/memory/store.test.ts` (vitest, runs
// against the in-process handler with capability stubs). This .mjs test is a
// belt-and-suspenders pipeline check: it loads the FORK SOURCE file directly
// and asserts that the four ADR-0181 §C semantics are present, so a future
// silent regression (e.g. a refactor that drops the RC-2 branch but keeps
// passing vitest because the fork test was deleted in the same commit) is
// caught by the ruflo-patch test gate too.
//
// What this test does NOT do: it does not execute the handler. The vitest
// suite in forks/agentdb does that. This test asserts shape only.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const STORE_HANDLER = join(
  '/Users/henrik/source/forks/agentdb',
  'src/archivist/handlers/memory/store.ts',
);

describe('ADR-0181 §C memory_store handler — source-level semantic invariants', () => {
  const src = readFileSync(STORE_HANDLER, 'utf8');

  it('has RC-2 idempotency: probes existing entry via getByKeyAsync', () => {
    assert.match(
      src,
      /getByKeyAsync\(namespace,\s*payload\.key\)/,
      'handler must call rvf.getByKeyAsync(namespace, payload.key) before insert',
    );
  });

  it('has RC-2 same-content no-op branch', () => {
    // The handler computes sameContent and returns early without write
    // when true. Spot-check the branch shape.
    assert.match(src, /sameContent\s*=\s*existingContent\s*===\s*payload\.content/);
    assert.ok(
      /if\s*\(sameContent\)\s*\{[\s\S]*?return;/.test(src),
      'handler must return early when (key, content) match (idempotent no-op)',
    );
  });

  it('has RC-2 duplicate-key throw with "duplicate key" + upsert hint', () => {
    assert.match(
      src,
      /throw new Error\(\s*[`'"]archivist: memory_store — duplicate key/,
      'handler must throw a fail-loud "duplicate key" error when upsert:false and content differs',
    );
    assert.match(src, /upsert:true.*to replace/);
  });

  it('has RC-2 upsert:true path via updateAsync', () => {
    assert.match(
      src,
      /rvf\.updateAsync\(\s*existing\.id\b/,
      'upsert:true must call updateAsync on the EXISTING id (HNSW label stability)',
    );
  });

  it('emits TTL → expiresAt in metadata', () => {
    assert.match(
      src,
      /expiresAt:[^=]*= [\s\S]*?ttl > 0 \? now \+ ttl : null/,
      'TTL semantics: positive ttl yields now+ttl; otherwise null',
    );
    assert.match(src, /expiresAt,/, 'expiresAt must be threaded into the baseMetadata literal');
  });

  it('uses EmbeddingScorer capability via requireEmbeddingScorer', () => {
    assert.match(src, /ctx\.capabilities\.requireEmbeddingScorer\(\)/);
  });

  it('writes under STORE_ID=memory_store via substrate.withWrite', () => {
    assert.match(src, /STORE_ID\s*=\s*['"]memory_store['"]/);
    assert.match(src, /ctx\.substrate\.withWrite\(\{\s*storeId:\s*STORE_ID\s*\}/);
  });

  it('throws fail-loud when upsert:true is requested but updateAsync is unwired', () => {
    assert.match(
      src,
      /upsert:true.*requested.*does not expose `updateAsync`/s,
      'fail-loud guard for missing updateAsync on upsert',
    );
  });

  it('documents scope handling as cli-side (no in-handler capability)', () => {
    // No new AgentMemoryScopeResolver capability — the handler relies on the
    // cli's `memory-tools.ts` wrapper to pre-scope the key.
    assert.match(
      src,
      /scope[\s\S]*cli wrapper[\s\S]*memory-tools\.ts/i,
      'handler must document that scope prefixing lives cli-side',
    );
    assert.doesNotMatch(
      src,
      /requireAgentMemoryScope/,
      'handler must NOT add an AgentMemoryScopeResolver capability — duplication risk',
    );
  });
});
