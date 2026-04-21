// @tier unit
// Hash-fallback BM25 ranking — replaces cosine-on-hash-vectors in the
// memory-router search path when the embedder is running in hash-fallback
// mode (ADR-0082: no more silent-pass branches in acceptance checks).
//
// The production path lives at:
//   forks/ruflo/v3/@claude-flow/memory/src/bm25.ts  -> bm25Rank(query, entries, opts)
// and is wired into memory-router.ts:
//   pipeline.getProvider() === 'hash-fallback'  ->  bm25Rank over storage.query
//
// This is a London-school unit test:
//   - no real CLI spawn, no router, no embedding pipeline
//   - we construct synthetic MemoryEntry[] and assert the ranking
//
// Goal asserted here: for a hash-fallback run, searching "authentication JWT"
// must rank `jwt-auth` (key: "jwt-auth", content: "authentication with JWT
// refresh tokens") ABOVE noise entries. This is exactly the example from the
// failure mode that was previously masked.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';

// ============================================================================
// Resolve bm25.js — same candidate pattern adr0086-rvf-integration uses.
// Primary: fork dist. Secondary: /tmp/ruflo-build. Tertiary: harness sandboxes.
// ============================================================================

const FORK_SRC  = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/bm25.ts';
const FORK_DIST = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/dist/bm25.js';
const BUILD_DIST = '/tmp/ruflo-build/v3/@claude-flow/memory/dist/bm25.js';

// Fix-marker gate (ADR-0082): the source must declare the BM25 activation
// intent. Missing marker -> implementation was reverted -> assert fails.
assert.ok(existsSync(FORK_SRC), `bm25.ts not found at ${FORK_SRC}`);
const bm25Src = readFileSync(FORK_SRC, 'utf8');
assert.ok(
  /export\s+function\s+bm25Rank\s*\(/.test(bm25Src),
  'bm25.ts must export bm25Rank() — BM25 ranking entry point',
);
assert.ok(
  /export\s+function\s+tokenize\s*\(/.test(bm25Src),
  'bm25.ts must export tokenize() — reusable for other callers',
);

// Also assert the router wired it in.
const ROUTER_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts';
const routerSrc = readFileSync(ROUTER_SRC, 'utf8');
assert.ok(
  routerSrc.includes("'hash-fallback'"),
  'memory-router.ts must branch on pipeline.getProvider() === hash-fallback',
);
assert.ok(
  routerSrc.includes('@claude-flow/memory/bm25'),
  'memory-router.ts must dynamically import @claude-flow/memory/bm25 on the lexical path',
);
assert.ok(
  routerSrc.includes('bm25Rank'),
  'memory-router.ts must call bm25Rank() on the hash-fallback path',
);

async function loadBm25Module() {
  const candidates = [];
  if (existsSync(FORK_DIST))  candidates.push(FORK_DIST);
  if (existsSync(BUILD_DIST)) candidates.push(BUILD_DIST);
  try {
    const sandboxes = readdirSync('/tmp')
      .filter(d => d.startsWith('ruflo-fast-') || d.startsWith('ruflo-accept-'))
      .map(d => {
        const p = `/tmp/${d}/node_modules/@sparkleideas/memory/dist/bm25.js`;
        try { return existsSync(p) ? { p, mt: statSync(p).mtimeMs } : null; } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.mt - a.mt)
      .map(x => x.p);
    candidates.push(...sandboxes);
  } catch { /* no /tmp listing */ }

  for (const path of candidates) {
    try {
      const mod = await import(path);
      if (mod.bm25Rank && mod.tokenize) return { mod, loadedFrom: path };
    } catch { /* try next */ }
  }
  return null;
}

// Build a minimal MemoryEntry-shaped object. We only rely on the fields BM25
// consumes: key, content, tags. id/namespace are carried through for the
// ranking output shape only, not the scoring.
function makeEntry(key, content, tags = []) {
  return {
    id: key,
    key,
    content,
    namespace: 'default',
    type: 'general',
    tags,
    metadata: {},
    ownerId: 'test',
    accessLevel: 'private',
  };
}

// ============================================================================
// Group 1: tokenizer contract (primitives are small; test them directly)
// ============================================================================

describe('bm25 tokenize — lexical splitting', async () => {
  const loaded = await loadBm25Module();

  it('loads bm25 module from a built dist', (t) => {
    if (!loaded) {
      t.skip('SKIP_ACCEPTED: bm25.js not yet built — run `npm run build` in forks/ruflo or wait for ruflo-patch build step');
      return;
    }
    assert.ok(loaded.mod.tokenize, `tokenize() must be exported (loaded from ${loaded.loadedFrom})`);
    assert.ok(loaded.mod.bm25Rank, `bm25Rank() must be exported (loaded from ${loaded.loadedFrom})`);
  });

  it('splits hyphenated keys into components (jwt-auth -> [jwt, auth])', (t) => {
    if (!loaded) { t.skip('SKIP_ACCEPTED: bm25.js unavailable'); return; }
    const toks = loaded.mod.tokenize('jwt-auth');
    assert.deepEqual(toks, ['jwt', 'auth']);
  });

  it('lowercases and drops 1-char tokens', (t) => {
    if (!loaded) { t.skip('SKIP_ACCEPTED: bm25.js unavailable'); return; }
    const toks = loaded.mod.tokenize('JWT a Authentication');
    assert.deepEqual(toks, ['jwt', 'authentication']);
  });

  it('returns empty array on empty or punctuation-only input', (t) => {
    if (!loaded) { t.skip('SKIP_ACCEPTED: bm25.js unavailable'); return; }
    assert.deepEqual(loaded.mod.tokenize(''), []);
    assert.deepEqual(loaded.mod.tokenize('   '), []);
    assert.deepEqual(loaded.mod.tokenize('---!!!'), []);
  });
});

// ============================================================================
// Group 2: BM25 ranking contract — the actual failure mode from the task
// ============================================================================

describe('bm25Rank — ranks keys by lexical overlap on hash-fallback', async () => {
  const loaded = await loadBm25Module();

  it('ranks jwt-auth above noise for query "authentication JWT"', (t) => {
    if (!loaded) { t.skip('SKIP_ACCEPTED: bm25.js unavailable'); return; }
    const { bm25Rank } = loaded.mod;

    // This is the exact example from the task spec. In hash-fallback mode
    // the previous vector path could NOT find `jwt-auth` for this query
    // because hashed vectors have no lexical signal. BM25 must.
    const corpus = [
      makeEntry('jwt-auth',        'authentication with JWT refresh tokens'),
      makeEntry('cooking-pasta',   'how to boil pasta al dente'),
      makeEntry('random-note',     'some random thoughts about the weather'),
      makeEntry('api-gateway',     'kong and nginx reverse proxy comparison'),
      makeEntry('git-rebase',      'interactive rebase workflow tips'),
    ];

    const ranked = bm25Rank('authentication JWT', corpus, { limit: 10 });

    assert.ok(ranked.length >= 1, 'must return at least one result');
    assert.equal(ranked[0].entry.key, 'jwt-auth',
      `expected jwt-auth at top, got ${ranked.map(r => r.entry.key).join(', ')}`);
    assert.ok(ranked[0].score > 0, 'top score must be positive');
  });

  it('ranks cooking-pasta above jwt-auth for query "cooking pasta"', (t) => {
    if (!loaded) { t.skip('SKIP_ACCEPTED: bm25.js unavailable'); return; }
    const { bm25Rank } = loaded.mod;

    const corpus = [
      makeEntry('jwt-auth',        'authentication with JWT refresh tokens'),
      makeEntry('cooking-pasta',   'how to boil pasta al dente'),
      makeEntry('random-note',     'some random thoughts about the weather'),
    ];

    const ranked = bm25Rank('cooking pasta', corpus, { limit: 10 });
    assert.equal(ranked[0].entry.key, 'cooking-pasta');
  });

  it('excludes entries with zero query-term matches (no noise in output)', (t) => {
    if (!loaded) { t.skip('SKIP_ACCEPTED: bm25.js unavailable'); return; }
    const { bm25Rank } = loaded.mod;

    const corpus = [
      makeEntry('jwt-auth',      'authentication with JWT refresh tokens'),
      makeEntry('cooking-pasta', 'how to boil pasta al dente'),
    ];

    const ranked = bm25Rank('authentication JWT', corpus, { limit: 10 });
    // cooking-pasta has no overlap with {authentication, jwt} — must not appear
    for (const r of ranked) {
      assert.notEqual(r.entry.key, 'cooking-pasta',
        'entries with zero query-term matches must be filtered out');
    }
  });

  it('T1-1 corpus: ranks cooking-pasta top and excludes zero-overlap distractors', (t) => {
    // Paired with lib/acceptance-adr0079-tier1-checks.sh:check_t1_1_semantic_ranking.
    // This test encodes the acceptance corpus and query verbatim so a regression
    // in either (stored value text, query text, BM25 tokenizer) fails at the
    // unit layer instead of burning 47s of acceptance time.
    if (!loaded) { t.skip('SKIP_ACCEPTED: bm25.js unavailable'); return; }
    const { bm25Rank } = loaded.mod;

    const corpus = [
      makeEntry('cooking-pasta',   'Italian pasta recipe: cook al dente spaghetti for a weeknight dinner'),
      makeEntry('quantum-physics', 'Quantum entanglement and superposition experiments'),
      makeEntry('dog-training',    'Teaching your puppy to sit using positive reinforcement'),
    ];

    const ranked = bm25Rank('Italian pasta recipe for dinner', corpus, { limit: 10 });

    assert.ok(ranked.length >= 1,
      'T1-1 corpus: must return cooking-pasta, not empty — this is the exact failure mode of the original acceptance check');
    assert.equal(ranked[0].entry.key, 'cooking-pasta',
      `T1-1 corpus: cooking-pasta must rank first, got ${ranked.map(r => r.entry.key).join(', ')}`);
    for (const r of ranked) {
      assert.notEqual(r.entry.key, 'quantum-physics',
        'T1-1 corpus: quantum-physics shares zero tokens with query, must be excluded');
      assert.notEqual(r.entry.key, 'dog-training',
        'T1-1 corpus: dog-training shares zero tokens with query, must be excluded');
    }
  });

  it('respects limit parameter (top-N by score)', (t) => {
    if (!loaded) { t.skip('SKIP_ACCEPTED: bm25.js unavailable'); return; }
    const { bm25Rank } = loaded.mod;

    // 5 entries all matching "test"
    const corpus = Array.from({ length: 5 }, (_, i) =>
      makeEntry(`key-${i}`, `test entry number ${i} with test content`));

    const top3 = bm25Rank('test', corpus, { limit: 3 });
    assert.equal(top3.length, 3, 'limit=3 must return at most 3 results');
  });

  it('scores are sorted descending', (t) => {
    if (!loaded) { t.skip('SKIP_ACCEPTED: bm25.js unavailable'); return; }
    const { bm25Rank } = loaded.mod;

    const corpus = [
      makeEntry('high',   'jwt jwt jwt authentication authentication'),
      makeEntry('medium', 'jwt authentication once'),
      makeEntry('low',    'a single authentication mention here'),
    ];

    const ranked = bm25Rank('authentication JWT', corpus, { limit: 10 });
    for (let i = 1; i < ranked.length; i++) {
      assert.ok(ranked[i - 1].score >= ranked[i].score,
        `ranking must be score-descending at index ${i}: ${ranked[i-1].score} >= ${ranked[i].score}`);
    }
  });

  it('throws loudly on empty query (ADR-0082 no-silent-fail)', (t) => {
    if (!loaded) { t.skip('SKIP_ACCEPTED: bm25.js unavailable'); return; }
    const { bm25Rank } = loaded.mod;

    const corpus = [makeEntry('k', 'some content')];
    assert.throws(
      () => bm25Rank('', corpus, { limit: 10 }),
      /zero tokens/i,
      'empty query must throw — silent [] return would mask CLI flag parser bugs',
    );
    assert.throws(
      () => bm25Rank('!!!', corpus, { limit: 10 }),
      /zero tokens/i,
      'punctuation-only query must throw',
    );
  });

  it('returns [] on empty corpus without throwing (valid empty store)', (t) => {
    if (!loaded) { t.skip('SKIP_ACCEPTED: bm25.js unavailable'); return; }
    const { bm25Rank } = loaded.mod;

    // Empty corpus with a real query is a valid "nothing stored yet" state —
    // the router's empty-store short-circuit should have caught it before
    // bm25Rank runs, but the function must not throw in that case.
    const ranked = bm25Rank('authentication', [], { limit: 10 });
    assert.deepEqual(ranked, []);
  });
});

// ============================================================================
// Group 3: wiring guards — make sure the router branch can't be deleted
// without a test failing (ADR-0082 regression prevention).
// ============================================================================

describe('memory-router.ts: hash-fallback branch wiring', () => {
  it('search case checks pipeline.getProvider() before calling generateEmbedding', () => {
    // The provider probe must come BEFORE the embedding generation call so
    // we can skip the cost entirely on the lexical path. If someone moves
    // the probe after generateEmbedding, this assertion fails.
    const searchCaseStart = routerSrc.indexOf("case 'search'");
    assert.ok(searchCaseStart > 0, "search case must exist in memory-router.ts");
    const searchBlock = routerSrc.slice(searchCaseStart, searchCaseStart + 6000);

    const providerIdx = searchBlock.indexOf('getProvider');
    const genEmbedIdx = searchBlock.indexOf('generateEmbedding(op.query');
    assert.ok(providerIdx > 0, 'search case must probe pipeline.getProvider()');
    assert.ok(genEmbedIdx > 0, 'search case must still support real embedder via generateEmbedding()');
    assert.ok(providerIdx < genEmbedIdx,
      'provider probe must come BEFORE generateEmbedding(op.query) so the lexical path can short-circuit');
  });

  it('hash-fallback branch imports bm25 via @claude-flow/memory/bm25 subpath', () => {
    assert.ok(
      routerSrc.includes("'@claude-flow/memory/bm25'"),
      'router must use the scoped subpath import so the codemod rewrites to @sparkleideas/memory/bm25',
    );
  });

  it('hash-fallback branch does NOT wrap bm25Rank in a silent try/catch that returns success on failure', () => {
    // Find the bm25 branch and verify its catch returns { success: false, ... }
    // (ADR-0082). A `success: true, results: []` catch would be a regression.
    const bm25BranchStart = routerSrc.indexOf("pipelineProvider === 'hash-fallback'");
    assert.ok(bm25BranchStart > 0, 'hash-fallback branch must exist');
    // Look ahead to the next matching closing `}` block — roughly 3000 chars
    // is enough to cover the branch.
    const branchBody = routerSrc.slice(bm25BranchStart, bm25BranchStart + 3000);
    assert.ok(
      /bm25 search failed/.test(branchBody),
      'bm25 catch must surface the error, not return success:true with empty results',
    );
    // Explicit anti-pattern guard: no `results: []` literal inside a catch
    // on this branch. (Router-wide empty-store short-circuit is elsewhere.)
    const catchIdx = branchBody.indexOf('} catch');
    if (catchIdx > 0) {
      const catchBody = branchBody.slice(catchIdx, catchIdx + 400);
      assert.ok(
        !/results:\s*\[\s*\]/.test(catchBody),
        'bm25 catch must not silently return `results: []`',
      );
    }
  });
});
