// @tier unit
// ADR-0086: Debt fixes verification — WAL locking, HNSW dedup, query optimization, stats
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const RVF = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/rvf-backend.ts';
const TYPES = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src/types.ts';
const ROUTER = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/memory/memory-router.ts';

const rvfSrc = readFileSync(RVF, 'utf-8');
const typesSrc = readFileSync(TYPES, 'utf-8');
const routerSrc = readFileSync(ROUTER, 'utf-8');

// ---------------------------------------------------------------------------
// Helper: extract a method body from source. Uses a regex to find the method
// definition (not a call site), then brace-counts to the matching close.
// ---------------------------------------------------------------------------
function extractMethod(src, signature) {
  // Try to find the method definition by looking for the signature preceded
  // by typical TS method markers (private/public/async/etc. or start-of-line).
  // We search for all occurrences and pick the one that looks like a definition
  // (has an opening brace on the same or next line, not a call site).
  let idx = -1;
  let searchFrom = 0;
  while (searchFrom < src.length) {
    const pos = src.indexOf(signature, searchFrom);
    if (pos === -1) break;
    // Check if this looks like a definition (has '(' and '{' nearby, not just a call)
    const lineStart = src.lastIndexOf('\n', pos) + 1;
    const linePrefix = src.slice(lineStart, pos).trim();
    const afterSig = src.slice(pos, pos + 300);
    // A definition has parentheses for params and a brace for the body
    const isDefinition = (
      (afterSig.includes('(') && afterSig.includes('{')) &&
      (linePrefix === '' || linePrefix.startsWith('private') || linePrefix.startsWith('public') ||
       linePrefix.startsWith('protected') || linePrefix.startsWith('async') ||
       linePrefix.startsWith('static') || linePrefix.startsWith('/**') ||
       linePrefix.startsWith('//') || linePrefix.startsWith('*'))
    );
    if (isDefinition) { idx = pos; break; }
    searchFrom = pos + 1;
  }
  if (idx === -1) {
    // Fallback: use first occurrence
    idx = src.indexOf(signature);
    if (idx === -1) return null;
  }
  // Walk forward counting braces to find the matching closing brace
  let depth = 0;
  let started = false;
  let start = idx;
  for (let i = idx; i < src.length; i++) {
    if (src[i] === '{') { depth++; started = true; }
    if (src[i] === '}') { depth--; }
    if (started && depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

// ---------------------------------------------------------------------------
// Group 1: H1/H3 — Advisory WAL locking (Debt 9 + Debt 12)
// ---------------------------------------------------------------------------
describe('ADR-0086 debt: H1/H3 — advisory WAL locking', () => {

  it('acquireLock method exists in rvf-backend.ts', () => {
    assert.ok(rvfSrc.includes('acquireLock'),
      'rvf-backend.ts must define an acquireLock method');
  });

  it('releaseLock method exists in rvf-backend.ts', () => {
    assert.ok(rvfSrc.includes('releaseLock'),
      'rvf-backend.ts must define a releaseLock method');
  });

  it('lockPath field is declared (derived from databasePath + .lock)', () => {
    assert.ok(rvfSrc.includes('lockPath'),
      'rvf-backend.ts must declare a lockPath field');
    assert.ok(rvfSrc.includes(".lock'") || rvfSrc.includes('.lock"') || rvfSrc.includes('.lock`'),
      'lockPath must be derived from databasePath with .lock extension');
  });

  it('appendToWal calls acquireLock and releaseLock (or uses try/finally)', () => {
    const body = extractMethod(rvfSrc, 'appendToWal');
    assert.ok(body, 'appendToWal method must exist');
    assert.ok(body.includes('acquireLock') || body.includes('this.acquireLock'),
      'appendToWal must call acquireLock');
    assert.ok(body.includes('releaseLock') || body.includes('this.releaseLock'),
      'appendToWal must call releaseLock');
  });

  it('compactWal calls acquireLock and releaseLock', () => {
    const body = extractMethod(rvfSrc, 'compactWal');
    assert.ok(body, 'compactWal method must exist');
    // compactWal calls persistToDisk which should also lock, or compactWal locks directly
    const usesLock = body.includes('acquireLock') || body.includes('this.acquireLock');
    const delegatesToPersist = body.includes('persistToDisk');
    assert.ok(usesLock || delegatesToPersist,
      'compactWal must call acquireLock or delegate to persistToDisk (which locks)');
  });

  it('persistToDisk calls acquireLock and releaseLock', () => {
    const body = extractMethod(rvfSrc, 'persistToDisk');
    assert.ok(body, 'persistToDisk method must exist');
    assert.ok(body.includes('acquireLock') || body.includes('this.acquireLock'),
      'persistToDisk must call acquireLock');
    assert.ok(body.includes('releaseLock') || body.includes('this.releaseLock'),
      'persistToDisk must call releaseLock');
  });

  it('shutdown cleans up the lock file (contains unlink with lockPath)', () => {
    const body = extractMethod(rvfSrc, 'async shutdown');
    assert.ok(body, 'shutdown method must exist');
    assert.ok(body.includes('lockPath') || body.includes('lock'),
      'shutdown must reference lockPath for cleanup');
    assert.ok(body.includes('unlink'),
      'shutdown must unlink the lock file');
  });

  it('lock uses { flag: "wx" } for atomic create (O_CREAT | O_EXCL)', () => {
    assert.ok(rvfSrc.includes("'wx'") || rvfSrc.includes('"wx"'),
      'lock acquisition must use flag "wx" for atomic create');
  });

  it('lock contains PID for stale detection (process.pid)', () => {
    // The lock file content should include process.pid for stale lock detection
    const acquireBody = extractMethod(rvfSrc, 'acquireLock');
    if (acquireBody) {
      assert.ok(acquireBody.includes('process.pid'),
        'acquireLock must write process.pid for stale detection');
    } else {
      // Check globally — acquireLock might be inlined or named differently
      assert.ok(rvfSrc.includes('process.pid'),
        'rvf-backend.ts must reference process.pid for stale lock detection');
    }
  });

  it('fdatasync or datasync present in persist path (debt 12 fix)', () => {
    // persistToDisk may delegate to persistToDiskInner — check both
    const persistBody = extractMethod(rvfSrc, 'persistToDisk');
    const innerBody = extractMethod(rvfSrc, 'persistToDiskInner');
    const combined = (persistBody || '') + (innerBody || '');
    assert.ok(persistBody || innerBody, 'persistToDisk or persistToDiskInner method must exist');
    assert.ok(
      combined.includes('fdatasync') || combined.includes('datasync') ||
      combined.includes('fsync'),
      'persist path must call fdatasync/fsync after atomic rename for true durability');
  });
});

// ---------------------------------------------------------------------------
// Group 2: Debt 8 — No double HNSW indexing
// ---------------------------------------------------------------------------
describe('ADR-0086 debt: Debt 8 — no double HNSW indexing', () => {

  it('tryNativeInit returns true on success path (not false)', () => {
    const body = extractMethod(rvfSrc, 'tryNativeInit');
    assert.ok(body, 'tryNativeInit method must exist');
    // When native is successfully loaded (nativeDb is set), it should return true
    // so initialize() knows native is available and skips HnswLite creation.
    // The success path (where nativeDb is assigned) must return true.
    const lines = body.split('\n');
    // Find the line with nativeDb assignment then look for return true after it
    const nativeDbAssignIdx = lines.findIndex(l => l.includes('this.nativeDb =') && !l.includes('null'));
    assert.ok(nativeDbAssignIdx >= 0, 'tryNativeInit must assign this.nativeDb');
    // After assignment, before the catch, there should be a return true
    const afterAssign = lines.slice(nativeDbAssignIdx).join('\n');
    assert.ok(afterAssign.includes('return true'),
      'tryNativeInit must return true after successful native init (not false)');
  });

  it('initialize() only creates HnswLite when native is NOT available', () => {
    const body = extractMethod(rvfSrc, 'async initialize');
    assert.ok(body, 'initialize method must exist');
    // HnswLite creation should be guarded by !useNative or !this.nativeDb
    assert.ok(
      body.includes('if (!useNative)') || body.includes('if(!useNative)') ||
      body.includes('if (!hasNative)') || body.includes('if (!this.nativeDb)'),
      'HnswLite creation must be guarded by native unavailability check');
  });

  it('initialize() always calls loadFromDisk() (critical invariant)', () => {
    const body = extractMethod(rvfSrc, 'async initialize');
    assert.ok(body, 'initialize method must exist');
    assert.ok(body.includes('loadFromDisk'),
      'initialize must always call loadFromDisk regardless of native availability');
  });

  it('store() uses exclusive indexing (if/else if, not if/if)', () => {
    const body = extractMethod(rvfSrc, 'async store');
    assert.ok(body, 'store method must exist');
    // nativeDb and hnswIndex branches should be mutually exclusive
    // Look for "else if" pattern between the two indexing branches
    const nativeIdx = body.indexOf('this.nativeDb');
    const hnswIdx = body.indexOf('this.hnswIndex');
    assert.ok(nativeIdx >= 0 && hnswIdx >= 0,
      'store must reference both nativeDb and hnswIndex');
    // The two embedding-indexing blocks should use else if (exclusive)
    const embeddingBlocks = body.match(/if\s*\(.*?embedding.*?(?:nativeDb|hnswIndex).*?\)/g) || [];
    // Check there's an else between them
    const hasElse = body.includes('} else if') || body.includes('else if (');
    // At minimum, verify no double-indexing pattern (if+if with no else)
    const nativeIngestIdx = body.indexOf('nativeDb');
    const hnswAddIdx = body.indexOf('hnswIndex');
    if (nativeIngestIdx >= 0 && hnswAddIdx >= 0) {
      const between = body.slice(
        Math.min(nativeIngestIdx, hnswAddIdx),
        Math.max(nativeIngestIdx, hnswAddIdx)
      );
      assert.ok(between.includes('else'),
        'store() nativeDb and hnswIndex branches must be exclusive (connected by else)');
    }
  });

  it('update() uses exclusive indexing (if/else if, not if/if)', () => {
    const body = extractMethod(rvfSrc, 'async update');
    assert.ok(body, 'update method must exist');
    const nativeIdx = body.indexOf('nativeDb');
    const hnswIdx = body.indexOf('hnswIndex');
    if (nativeIdx >= 0 && hnswIdx >= 0) {
      const between = body.slice(
        Math.min(nativeIdx, hnswIdx),
        Math.max(nativeIdx, hnswIdx)
      );
      assert.ok(between.includes('else'),
        'update() nativeDb and hnswIndex branches must be exclusive (connected by else)');
    }
  });

  it('bulkInsert() uses exclusive indexing', () => {
    const body = extractMethod(rvfSrc, 'async bulkInsert');
    assert.ok(body, 'bulkInsert method must exist');
    const nativeIdx = body.indexOf('nativeDb');
    const hnswIdx = body.indexOf('hnswIndex');
    if (nativeIdx >= 0 && hnswIdx >= 0) {
      const between = body.slice(
        Math.min(nativeIdx, hnswIdx),
        Math.max(nativeIdx, hnswIdx)
      );
      assert.ok(between.includes('else'),
        'bulkInsert() nativeDb and hnswIndex branches must be exclusive (connected by else)');
    }
  });

  it('query() supports native HNSW search (contains nativeDb in semantic search block)', () => {
    const body = extractMethod(rvfSrc, 'async query');
    assert.ok(body, 'query method must exist');
    // The semantic search section should check nativeDb, not just hnswIndex
    const semanticIdx = body.indexOf('semantic');
    assert.ok(semanticIdx >= 0, 'query must handle semantic search type');
    assert.ok(body.includes('nativeDb'),
      'query semantic search block must reference nativeDb for native HNSW search');
  });
});

// ---------------------------------------------------------------------------
// Group 3: Debt 13 — Single-pass query filter
// ---------------------------------------------------------------------------
describe('ADR-0086 debt: Debt 13 — single-pass query filter', () => {

  it('query() has at most 2 .filter() calls (metadata + semantic, not 12)', () => {
    const body = extractMethod(rvfSrc, 'async query');
    assert.ok(body, 'query method must exist');
    const filterCount = (body.match(/results\s*=\s*results\.filter\(/g) || []).length;
    assert.ok(filterCount <= 2,
      `query() should have at most 2 results.filter() calls, found ${filterCount}. ` +
      'The 12 sequential filter passes should be replaced with a single-pass filter.');
  });

  it('single filter checks all metadata fields', () => {
    const body = extractMethod(rvfSrc, 'async query');
    assert.ok(body, 'query method must exist');
    // All these fields should be checked in the query method
    const requiredFields = [
      'namespace', 'key', 'keyPrefix', 'tags', 'memoryType',
      'accessLevel', 'ownerId', 'createdAfter', 'createdBefore',
      'updatedAfter', 'updatedBefore', 'expiresAt',
    ];
    for (const field of requiredFields) {
      assert.ok(body.includes(field),
        `query filter must check ${field}`);
    }
  });

  it('count of results.filter( in query method is at most 2', () => {
    const body = extractMethod(rvfSrc, 'async query');
    assert.ok(body, 'query method must exist');
    // Count all occurrences of results.filter( or results = results.filter(
    const matches = body.match(/results\.filter\(/g) || [];
    assert.ok(matches.length <= 2,
      `query() should have at most 2 .filter() calls total (one for metadata, one for semantic), ` +
      `found ${matches.length}`);
  });
});

// ---------------------------------------------------------------------------
// Group 4: Debt 5 — entriesWithEmbeddings accurate count
// ---------------------------------------------------------------------------
describe('ADR-0086 debt: Debt 5 — entriesWithEmbeddings accurate count', () => {

  it('BackendStats in types.ts has entriesWithEmbeddings field', () => {
    const statsStart = typesSrc.indexOf('interface BackendStats');
    assert.ok(statsStart >= 0, 'BackendStats interface must exist in types.ts');
    const statsEnd = typesSrc.indexOf('}', statsStart);
    const statsBlock = typesSrc.slice(statsStart, statsEnd + 1);
    assert.ok(statsBlock.includes('entriesWithEmbeddings'),
      'BackendStats must have entriesWithEmbeddings field');
  });

  it('getStats() counts entries with embeddings (contains entry.embedding check)', () => {
    const body = extractMethod(rvfSrc, 'async getStats');
    assert.ok(body, 'getStats method must exist');
    // The stats computation loop should check for entry.embedding
    assert.ok(
      body.includes('entry.embedding') || body.includes('e.embedding'),
      'getStats must check entry.embedding to count entries with embeddings');
    assert.ok(body.includes('entriesWithEmbeddings'),
      'getStats must populate the entriesWithEmbeddings field');
  });

  it('router stats case uses stats.entriesWithEmbeddings (not just totalEntries)', () => {
    const statsIdx = routerSrc.indexOf("case 'stats':");
    const nextCase = routerSrc.indexOf("case 'count':", statsIdx);
    const statsBlock = routerSrc.slice(statsIdx, nextCase);
    assert.ok(statsBlock.includes('stats.entriesWithEmbeddings'),
      'router stats case must use stats.entriesWithEmbeddings');
  });

  it('router stats case does NOT have the old TODO comment about using totalEntries as proxy', () => {
    const statsIdx = routerSrc.indexOf("case 'stats':");
    const nextCase = routerSrc.indexOf("case 'count':", statsIdx);
    const statsBlock = routerSrc.slice(statsIdx, nextCase);
    assert.ok(!statsBlock.includes('TODO'),
      'router stats case should not have a TODO about totalEntries proxy');
    // Verify the primary source is stats.entriesWithEmbeddings (fallback
    // to totalEntries is acceptable for backwards compatibility)
    assert.ok(statsBlock.includes('stats.entriesWithEmbeddings'),
      'router stats case should use stats.entriesWithEmbeddings as primary source');
  });
});
