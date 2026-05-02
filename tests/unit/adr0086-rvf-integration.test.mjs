// @tier unit
// ADR-0086: RVF integration — real .rvf file round-trip
//
// No compiled dist is available, so these are source-level structural tests
// that verify the persistence format, WAL protocol, and data flow patterns
// mandated by ADR-0086: "Real .rvf file. Store, search, persist, reopen."
//
// Tests verify:
//   Group 1: Basic store and retrieve — store() writes to entries Map + keyIndex,
//            getByKey() looks up via compositeKey
//   Group 2: Persistence round-trip — persistToDisk writes RVF binary
//            (magic + header + entries), loadFromDisk reads it back,
//            WAL is replayed after load
//   Group 3: Search with embeddings — HNSW add/search wiring, brute-force
//            fallback, cosine similarity distance
//   Group 4: Namespace isolation — count() filters by namespace,
//            listNamespaces() returns distinct set

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

// ============================================================================
// Source paths
// ============================================================================

const MEM = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/src';
const RVF_PATH  = `${MEM}/rvf-backend.ts`;
const HNSW_PATH = `${MEM}/hnsw-lite.ts`;

const rvfSrc  = readFileSync(RVF_PATH, 'utf-8');
const hnswSrc = readFileSync(HNSW_PATH, 'utf-8');

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract a method body by finding its definition line (not a call site).
 * Definition lines look like:
 *   async store(entry: MemoryEntry): Promise<void> {
 *   private async persistToDisk(): Promise<void> {
 *   private compositeKey(namespace: string, key: string): string {
 *   constructor(config: RvfBackendConfig) {
 *
 * We match lines at class-member indentation (2 or more leading spaces)
 * where the method name appears right before `(`.
 */
function extractMethod(source, methodName) {
  // Build a regex that matches a class method definition.
  // Handles: constructor, async/private/private async, and get accessor.
  const defRe = new RegExp(
    `^  (?:private\\s+)?(?:async\\s+)?(?:get\\s+)?${methodName}\\s*\\(`,
    'm'
  );
  const match = defRe.exec(source);
  assert.ok(match, `Method definition for ${methodName} not found in source`);
  const start = match.index;

  // Walk braces to find the method body end
  let braceDepth = 0;
  let bodyStart = -1;
  let bodyEnd = -1;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') {
      if (braceDepth === 0) bodyStart = i;
      braceDepth++;
    } else if (source[i] === '}') {
      braceDepth--;
      if (braceDepth === 0) {
        bodyEnd = i;
        break;
      }
    }
  }
  assert.ok(bodyStart !== -1 && bodyEnd !== -1, `Could not delimit ${methodName} body`);
  return source.slice(start, bodyEnd + 1);
}

// ============================================================================
// Group 1: Basic store and retrieve
// ============================================================================

describe('ADR-0086 RVF integration: Group 1 — basic store and retrieve', () => {
  const storeBody = extractMethod(rvfSrc, 'store');
  const getByKeyBody = extractMethod(rvfSrc, 'getByKey');
  const constructorBody = extractMethod(rvfSrc, 'constructor');

  it('store() writes entry to in-memory Map via entries.set()', () => {
    assert.ok(storeBody.includes('this.entries.set('),
      'store() must persist entry in the entries Map');
  });

  it('store() indexes by compositeKey for key-based lookup', () => {
    assert.ok(storeBody.includes('this.keyIndex.set(this.compositeKey('),
      'store() must index via compositeKey into keyIndex');
  });

  it('store() adds embedding to HNSW index when present', () => {
    assert.ok(storeBody.includes('this.hnswIndex') && storeBody.includes('.add('),
      'store() must call hnswIndex.add() when entry has embedding');
  });

  it('store() marks backend as dirty after write', () => {
    assert.ok(storeBody.includes('this.dirty = true'),
      'store() must set dirty flag to trigger persistence');
  });

  it('store() appends to WAL for crash safety', () => {
    assert.ok(storeBody.includes('this.appendToWal('),
      'store() must call appendToWal() for crash-safe persistence');
  });

  it('getByKey() resolves via compositeKey then delegates to get()', () => {
    assert.ok(getByKeyBody.includes('this.compositeKey(namespace, key)'),
      'getByKey() must compose the lookup key from namespace + key');
    assert.ok(getByKeyBody.includes('this.get('),
      'getByKey() must delegate to get() for the actual retrieval');
  });

  it('compositeKey uses null byte separator for collision resistance', () => {
    const compositeBody = extractMethod(rvfSrc, 'compositeKey');
    // The source uses a template literal: `${namespace}\0${key}`
    // In the raw file the \0 is the two-char escape sequence backslash-zero
    assert.ok(
      compositeBody.includes('\\0') || compositeBody.includes('\x00'),
      'compositeKey must use null-byte separator between namespace and key'
    );
  });

  it('constructor validates dimensions (integer, 1-10000)', () => {
    assert.ok(constructorBody.includes('Number.isInteger(dimensions)'),
      'constructor must validate dimensions is an integer');
    assert.ok(constructorBody.includes('dimensions < 1') || constructorBody.includes('dimensions > 10000'),
      'constructor must reject dimensions outside 1-10000');
  });

  it('constructor derives HNSW params from dimensions', () => {
    assert.ok(constructorBody.includes('deriveHNSWParams(dimensions)'),
      'constructor must call deriveHNSWParams to set M and efConstruction');
  });

  it('constructor sets WAL path from databasePath', () => {
    assert.ok(constructorBody.includes('.wal'),
      'constructor must derive WAL path with .wal extension');
  });
});

// ============================================================================
// Group 2: Persistence round-trip
// ============================================================================

describe('ADR-0086 RVF integration: Group 2 — persistence round-trip', () => {
  const persistBody = extractMethod(rvfSrc, 'persistToDiskInner') || extractMethod(rvfSrc, 'persistToDisk');
  const loadBody = extractMethod(rvfSrc, 'loadFromDisk');
  const shutdownBody = extractMethod(rvfSrc, 'shutdown');
  const walAppendBody = extractMethod(rvfSrc, 'appendToWal');
  const walReplayBody = extractMethod(rvfSrc, 'replayWal');
  const compactBody = extractMethod(rvfSrc, 'compactWal');

  // --- persistToDisk: RVF binary format ---

  it('persistToDisk writes RVF magic bytes (0x52 0x56 0x46 0x00)', () => {
    assert.ok(persistBody.includes('0x52, 0x56, 0x46, 0x00'),
      'persistToDisk must write the RVF\\0 magic bytes');
  });

  it('persistToDisk writes header length as LE uint32', () => {
    assert.ok(persistBody.includes('writeUInt32LE(headerBuf.length'),
      'persistToDisk must write header length in LE uint32 format');
  });

  it('persistToDisk serializes header as JSON with required fields', () => {
    assert.ok(persistBody.includes('magic: MAGIC'),
      'header must include magic field');
    assert.ok(persistBody.includes('version: VERSION'),
      'header must include version field');
    assert.ok(persistBody.includes('dimensions:'),
      'header must include dimensions field');
    assert.ok(persistBody.includes('entryCount:'),
      'header must include entryCount');
  });

  it('persistToDisk serializes each entry with length-prefixed JSON', () => {
    assert.ok(persistBody.includes('writeUInt32LE(buf.length'),
      'each entry must be prefixed with its length as LE uint32');
    assert.ok(persistBody.includes('JSON.stringify(serialized)'),
      'entries must be serialized as JSON');
  });

  it('persistToDisk converts Float32Array embeddings to plain arrays', () => {
    assert.ok(persistBody.includes('Array.from(entry.embedding)'),
      'Float32Array embeddings must be converted to arrays for JSON serialization');
  });

  it('persistToDisk uses atomic write (tmp + rename) for crash safety', () => {
    assert.ok(persistBody.includes('.tmp'),
      'persistToDisk must use a .tmp file for atomic writes');
    assert.ok(persistBody.includes('rename(tmpPath, target)'),
      'persistToDisk must rename tmp file to target (atomic swap)');
  });

  it('persistToDisk clears dirty flag after successful write', () => {
    assert.ok(persistBody.includes('this.dirty = false'),
      'persistToDisk must clear the dirty flag');
  });

  it('persistToDisk guards against concurrent calls', () => {
    assert.ok(persistBody.includes('this.persisting'),
      'persistToDisk must check the persisting flag to prevent concurrent writes');
  });

  // --- loadFromDisk: RVF binary parsing ---

  it('loadFromDisk validates RVF magic bytes before parsing', () => {
    assert.ok(loadBody.includes('magic !== MAGIC') || loadBody.includes('magic === MAGIC'),
      'loadFromDisk must validate magic bytes match RVF\\0');
  });

  it('loadFromDisk reads header length and parses JSON header', () => {
    assert.ok(loadBody.includes('readUInt32LE(4)'),
      'loadFromDisk must read header length from bytes 4-7');
    assert.ok(loadBody.includes('JSON.parse('),
      'loadFromDisk must parse the header as JSON');
  });

  it('loadFromDisk reads entries using length-prefixed framing', () => {
    assert.ok(loadBody.includes('readUInt32LE(offset)'),
      'loadFromDisk must read each entry length as LE uint32');
    assert.ok(loadBody.includes('header.entryCount'),
      'loadFromDisk must iterate up to header.entryCount entries');
  });

  it('loadFromDisk restores Float32Array embeddings from plain arrays', () => {
    assert.ok(loadBody.includes('new Float32Array(parsed.embedding)'),
      'loadFromDisk must reconstruct Float32Array from serialized arrays');
  });

  it('loadFromDisk populates entries Map and keyIndex', () => {
    assert.ok(loadBody.includes('this.entries.set(entry.id, entry)'),
      'loadFromDisk must restore entries into the Map');
    assert.ok(loadBody.includes('this.keyIndex.set(this.compositeKey('),
      'loadFromDisk must restore the keyIndex');
  });

  it('loadFromDisk re-indexes embeddings into HNSW', () => {
    assert.ok(loadBody.includes('this.hnswIndex') && loadBody.includes('.add('),
      'loadFromDisk must re-add embeddings to the HNSW index');
  });

  it('loadFromDisk replays WAL after loading main file', () => {
    assert.ok(loadBody.includes('this.replayWal()'),
      'loadFromDisk must call replayWal() to apply pending WAL entries');
  });

  it('loadFromDisk tries .meta sidecar before main path', () => {
    assert.ok(loadBody.includes('.meta'),
      'loadFromDisk must check for .meta sidecar (native DB mode)');
  });

  it('loadFromDisk guards against oversized headers (10MB max)', () => {
    assert.ok(loadBody.includes('10 * 1024 * 1024') || loadBody.includes('MAX_HEADER_SIZE'),
      'loadFromDisk must reject headers exceeding MAX_HEADER_SIZE');
  });

  it('loadFromDisk replays WAL even when main RVF file does not exist', () => {
    // The WAL may contain entries from a prior short-lived CLI process that
    // stored data (appended to WAL) but exited before compaction.  The old
    // code had an early `return` when neither .rvf nor .meta existed, which
    // skipped replayWal() entirely — causing list/search to see empty state.
    //
    // After the fix, loadFromDisk must NOT early-return before replayWal().
    // Verify: the only early return before replayWal is the :memory: guard.
    const replayIdx = loadBody.indexOf('this.replayWal()');
    assert.ok(replayIdx > 0, 'loadFromDisk must contain a replayWal() call');

    // Count `return;` code statements (not comments) before replayWal.
    // Strip single-line comments and block comments before counting.
    const beforeReplay = loadBody.substring(0, replayIdx);
    const stripped = beforeReplay
      .replace(/\/\/[^\n]*/g, '')      // strip single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, ''); // strip block comments
    const returnMatches = [...stripped.matchAll(/\breturn\b\s*;/g)];
    // Allow exactly 1 return (the :memory: guard).  More would mean an
    // early exit that skips WAL replay.
    assert.ok(returnMatches.length <= 1,
      `loadFromDisk has ${returnMatches.length} return statements before replayWal() ` +
      '— only the :memory: guard is allowed (otherwise WAL-only data is lost)');
  });

  // --- WAL protocol ---

  it('appendToWal writes length-prefixed JSON to WAL file', () => {
    assert.ok(walAppendBody.includes('writeUInt32LE(json.length'),
      'WAL entry must be prefixed with its length as LE uint32');
    assert.ok(walAppendBody.includes('appendFile(this.walPath'),
      'WAL entry must be appended to the WAL file');
  });

  it('appendToWal increments walEntryCount', () => {
    assert.ok(walAppendBody.includes('this.walEntryCount++'),
      'appendToWal must track the number of WAL entries');
  });

  it('appendToWal is no-op for :memory: mode', () => {
    assert.ok(walAppendBody.includes('!this.walPath'),
      'appendToWal must skip I/O for in-memory backends');
  });

  it('replayWal parses length-prefixed JSON entries', () => {
    assert.ok(walReplayBody.includes('readUInt32LE(offset)'),
      'replayWal must read each WAL entry length');
    assert.ok(walReplayBody.includes('JSON.parse(entryJson)'),
      'replayWal must parse each WAL entry as JSON');
  });

  it('replayWal restores Float32Array embeddings', () => {
    assert.ok(walReplayBody.includes('new Float32Array(parsed.embedding)'),
      'replayWal must reconstruct Float32Array from serialized arrays');
  });

  it('replayWal preserves HNSW graph integrity for already-loaded entries', () => {
    // Two valid strategies to prevent graph corruption when the entry is already
    // in the index (from loadFromDisk OR from our own store() call this session):
    //   (a) remove-then-readd: `this.hnswIndex.remove(entry.id)` before re-add, OR
    //   (b) skip-if-loaded: `if (alreadyLoaded) ... continue` — no re-add needed.
    // Strategy (b) was adopted in commit 2f3a832d6 (single-writer durability fix
    // for native @ruvector/rvf-node backend). Either satisfies the invariant.
    const hasRemove = walReplayBody.includes('this.hnswIndex.remove(entry.id)');
    const hasSkip = /alreadyLoaded\s*\)\s*\{[\s\S]*?continue\s*;/.test(walReplayBody);
    assert.ok(hasRemove || hasSkip,
      'replayWal must either remove stale edges OR skip already-loaded entries to prevent graph corruption');
  });

  it('replayWal handles truncated entries gracefully', () => {
    assert.ok(walReplayBody.includes('offset + entryLen > raw.length'),
      'replayWal must detect and skip truncated entries');
  });

  it('compactWal calls persistToDisk then deletes WAL', () => {
    assert.ok(compactBody.includes('persistToDisk') || compactBody.includes('persistToDiskInner'),
      'compactWal must rewrite the main RVF file');
    assert.ok(compactBody.includes('unlink(this.walPath)'),
      'compactWal must delete the WAL after successful persist');
  });

  it('compactWal resets walEntryCount to zero', () => {
    assert.ok(compactBody.includes('walEntryCount = 0'),
      'compactWal must reset the WAL entry counter');
  });

  // --- shutdown triggers persist ---

  it('shutdown persists dirty data before clearing state', () => {
    assert.ok(shutdownBody.includes('this.dirty'),
      'shutdown must check the dirty flag');
    assert.ok(shutdownBody.includes('persistToDisk') || shutdownBody.includes('compactWal'),
      'shutdown must persist data when dirty');
  });

  it('shutdown clears entries, keyIndex, and hnswIndex', () => {
    assert.ok(shutdownBody.includes('this.entries.clear()'),
      'shutdown must clear the entries Map');
    assert.ok(shutdownBody.includes('this.keyIndex.clear()'),
      'shutdown must clear the keyIndex');
    assert.ok(shutdownBody.includes('this.hnswIndex = null'),
      'shutdown must null the HNSW index');
  });

  it('shutdown cancels the auto-persist timer', () => {
    assert.ok(shutdownBody.includes('clearInterval(this.persistTimer)'),
      'shutdown must cancel the periodic persist timer');
  });
});

// ============================================================================
// Group 3: Search with embeddings
// ============================================================================

describe('ADR-0086 RVF integration: Group 3 — search with embeddings', () => {
  const searchBody = extractMethod(rvfSrc, 'search');
  const pureTsBody = extractMethod(rvfSrc, 'pureTsSearch');
  const bruteBody = extractMethod(rvfSrc, 'bruteForceSearch');

  it('search() delegates to pureTsSearch when no native DB', () => {
    assert.ok(searchBody.includes('pureTsSearch(embedding, options)'),
      'search() must call pureTsSearch as fallback path');
  });

  it('search() tries native NAPI first when nativeDb is available', () => {
    assert.ok(searchBody.includes('this.nativeDb'),
      'search() must check for native DB availability');
    assert.ok(searchBody.includes('.query('),
      'search() must call nativeDb.query() when available');
  });

  it('pureTsSearch uses HNSW index when available', () => {
    assert.ok(pureTsBody.includes('this.hnswIndex'),
      'pureTsSearch must check hnswIndex');
    assert.ok(pureTsBody.includes('.search('),
      'pureTsSearch must call hnswIndex.search()');
  });

  it('pureTsSearch falls back to bruteForceSearch without HNSW', () => {
    assert.ok(pureTsBody.includes('bruteForceSearch('),
      'pureTsSearch must fall back to bruteForceSearch when no HNSW index');
  });

  it('bruteForceSearch uses cosineSimilarity for scoring', () => {
    assert.ok(bruteBody.includes('cosineSimilarity('),
      'bruteForceSearch must compute cosine similarity between vectors');
  });

  it('bruteForceSearch sorts by descending score and slices to k', () => {
    assert.ok(bruteBody.includes('.sort('),
      'bruteForceSearch must sort results');
    assert.ok(bruteBody.includes('b.score - a.score'),
      'bruteForceSearch must sort by descending score');
    assert.ok(bruteBody.includes('.slice(0, options.k)'),
      'bruteForceSearch must limit results to k');
  });

  it('bruteForceSearch respects threshold filter', () => {
    assert.ok(bruteBody.includes('options.threshold'),
      'bruteForceSearch must check threshold');
    assert.ok(bruteBody.includes('score < options.threshold'),
      'bruteForceSearch must filter out results below the threshold');
  });

  it('bruteForceSearch respects namespace filter', () => {
    assert.ok(bruteBody.includes('namespace'),
      'bruteForceSearch must filter by namespace when specified');
  });

  it('bruteForceSearch respects tags filter', () => {
    assert.ok(bruteBody.includes('tags'),
      'bruteForceSearch must filter by tags when specified');
  });

  it('search result shape includes entry, score, and distance', () => {
    // The push call uses shorthand object { entry, score, distance: ... }
    assert.ok(bruteBody.includes('entry, score, distance'),
      'search results must include entry, score, and distance fields');
  });

  it('HnswLite exports cosineSimilarity for vector comparison', () => {
    assert.ok(hnswSrc.includes('export function cosineSimilarity'),
      'hnsw-lite must export cosineSimilarity function');
  });

  it('HnswLite class has add, search, and remove methods', () => {
    const addMatch = hnswSrc.match(/\badd\s*\(/);
    const searchMatch = hnswSrc.match(/\bsearch\s*\(/);
    const removeMatch = hnswSrc.match(/\bremove\s*\(/);
    assert.ok(addMatch, 'HnswLite must have an add() method');
    assert.ok(searchMatch, 'HnswLite must have a search() method');
    assert.ok(removeMatch, 'HnswLite must have a remove() method');
  });
});

// ============================================================================
// Group 4: Namespace isolation
// ============================================================================

describe('ADR-0086 RVF integration: Group 4 — namespace isolation', () => {
  const countBody = extractMethod(rvfSrc, 'count');
  const listNsBody = extractMethod(rvfSrc, 'listNamespaces');
  const clearNsBody = extractMethod(rvfSrc, 'clearNamespace');

  it('count() returns total entries.size when no namespace specified', () => {
    assert.ok(countBody.includes('this.entries.size'),
      'count() without namespace must return total entry count');
  });

  it('count() filters by namespace when specified', () => {
    assert.ok(countBody.includes('entry.namespace === namespace'),
      'count() must compare entry.namespace to the given namespace');
  });

  it('listNamespaces() returns distinct set of namespaces', () => {
    assert.ok(listNsBody.includes('new Set'),
      'listNamespaces() must use a Set for deduplication');
    assert.ok(listNsBody.includes('entry.namespace'),
      'listNamespaces() must collect from entry.namespace');
    assert.ok(listNsBody.includes('Array.from(ns)'),
      'listNamespaces() must convert Set to Array');
  });

  it('clearNamespace deletes only entries matching the namespace', () => {
    assert.ok(clearNsBody.includes('entry.namespace === namespace'),
      'clearNamespace must filter entries by namespace');
  });

  it('clearNamespace removes affected entries from keyIndex', () => {
    assert.ok(clearNsBody.includes('this.keyIndex.delete('),
      'clearNamespace must clean up the keyIndex');
  });

  it('clearNamespace removes affected entries from HNSW index', () => {
    assert.ok(clearNsBody.includes('this.hnswIndex') && clearNsBody.includes('.remove('),
      'clearNamespace must remove vectors from HNSW index');
  });

  it('clearNamespace persists after deletion (truncate WAL + persist)', () => {
    assert.ok(clearNsBody.includes('this.persistToDisk'),
      'clearNamespace must persist the deletion to disk');
  });

  it('clearNamespace truncates WAL before persist to prevent resurrection', () => {
    // ADR-0086 requirement: truncate WAL BEFORE full rewrite to prevent
    // deleted entries from resurrecting if process crashes mid-persist.
    const walTruncateIdx = clearNsBody.indexOf('writeFile(this.walPath');
    const persistIdx = clearNsBody.indexOf('this.persistToDisk');
    assert.ok(walTruncateIdx !== -1,
      'clearNamespace must truncate the WAL file');
    assert.ok(walTruncateIdx < persistIdx,
      'WAL truncation must happen BEFORE persistToDisk (anti-resurrection)');
  });
});

// ============================================================================
// Group 5: RVF file format constants and invariants
// ============================================================================

describe('ADR-0086 RVF integration: Group 5 — file format constants', () => {
  it('MAGIC constant is RVF followed by null byte', () => {
    // Source has: const MAGIC = 'RVF\0';
    // readFileSync gives us the raw escape, so we check for the literal chars
    const magicLine = rvfSrc.split('\n').find(l => l.startsWith('const MAGIC'));
    assert.ok(magicLine, 'MAGIC constant must be defined');
    assert.ok(magicLine.includes('RVF'),
      'MAGIC must contain RVF');
  });

  it('VERSION constant is 1', () => {
    assert.ok(rvfSrc.includes('const VERSION = 1'),
      'VERSION must be 1 for the current format');
  });

  it('default dimensions is 768 (all-mpnet-base-v2)', () => {
    assert.ok(rvfSrc.includes('const DEFAULT_DIMENSIONS = 768'),
      'DEFAULT_DIMENSIONS must be 768 to match all-mpnet-base-v2');
  });

  it('RvfBackend implements IMemoryBackend (Debt 1: IStorageContract is type alias)', () => {
    assert.ok(rvfSrc.includes('implements IMemoryBackend'),
      'RvfBackend must implement IMemoryBackend');
    // After Debt 1, IStorageContract is a type alias — cannot appear in implements clause
    const classLine = rvfSrc.match(/export\s+class\s+RvfBackend\s+implements\s+([^{]+)\{/);
    assert.ok(classLine, 'RvfBackend class declaration not found');
    assert.ok(
      !classLine[1].includes('IStorageContract'),
      'RvfBackend must NOT implement IStorageContract (it is a type alias after Debt 1)',
    );
  });

  it('validatePath rejects null bytes in paths', () => {
    const validateBody = rvfSrc.slice(
      rvfSrc.indexOf('function validatePath'),
      rvfSrc.indexOf('\n\nconst DEFAULT_WAL')
    );
    assert.ok(validateBody.includes('null bytes'),
      'validatePath must throw on null bytes');
  });

  it('validatePath allows :memory: as a special path', () => {
    const validateBody = rvfSrc.slice(
      rvfSrc.indexOf('function validatePath'),
      rvfSrc.indexOf('\n\nconst DEFAULT_WAL')
    );
    assert.ok(validateBody.includes(':memory:'),
      'validatePath must accept :memory: as valid');
  });

  it('WAL compaction threshold defaults to 100', () => {
    assert.ok(rvfSrc.includes('DEFAULT_WAL_COMPACTION_THRESHOLD = 100'),
      'default WAL compaction threshold must be 100 entries');
  });

  it('auto-persist timer is unref()d to avoid keeping process alive', () => {
    const initBody = extractMethod(rvfSrc, 'initialize');
    assert.ok(initBody.includes('.unref()'),
      'auto-persist timer must be unref()d');
  });

  it('delete() truncates WAL before persist (anti-resurrection)', () => {
    const deleteBody = extractMethod(rvfSrc, 'delete');
    const walTruncateIdx = deleteBody.indexOf('writeFile(this.walPath');
    const persistIdx = deleteBody.indexOf('this.persistToDisk');
    assert.ok(walTruncateIdx !== -1 && persistIdx !== -1,
      'delete() must truncate WAL and persist');
    assert.ok(walTruncateIdx < persistIdx,
      'WAL truncation must happen BEFORE persistToDisk in delete()');
  });

  it('bulkDelete() truncates WAL before persist (anti-resurrection)', () => {
    const bulkDeleteBody = extractMethod(rvfSrc, 'bulkDelete');
    const walTruncateIdx = bulkDeleteBody.indexOf('writeFile(this.walPath');
    const persistIdx = bulkDeleteBody.indexOf('this.persistToDisk');
    assert.ok(walTruncateIdx !== -1 && persistIdx !== -1,
      'bulkDelete() must truncate WAL and persist');
    assert.ok(walTruncateIdx < persistIdx,
      'WAL truncation must happen BEFORE persistToDisk in bulkDelete()');
  });
});

// ============================================================================
// Group 6: ADR-0095 subprocess N=6 — FAILS until fix lands, see commit 2d12bb1
// ============================================================================
//
// Per ADR-0095 §Acceptance criterion 3: spawn 6 real CLI subprocesses (not
// mocked, not in-process) with unique keys and assert entryCount === 6 plus
// all 6 embeddings round-trip retrievable via `cli memory retrieve`.
//
// This case is deliberately failing against current (pre-fix, commit 2d12bb1)
// state of the fork. Per ADR-0082 no-silent-pass rule AND the probe-writer
// task mandate ("never silent-skip"), the test:
//   - SKIP_ACCEPTED only when Verdaccio/CLI infra is unavailable (explicit
//     `t.skip` with unreachable-registry message, not a silent pass)
//   - FAILS LOUDLY with entryCount diagnostic when infra is available but the
//     RVF inter-process convergence bug manifests
//
// When the fix lands (three-item program in ADR-0095 §Amended Decision), this
// test will transition to green naturally. The failure diagnostic MUST include
// the observed entryCount, subprocess exit codes, and meta file path so that
// future regressions are immediately attributable.
// ============================================================================

describe('ADR-0095 subprocess N=6 — FAILS until fix lands, see commit 2d12bb1', () => {
  // This block imports child_process synchronously at the top of the suite so
  // we can fail loud if it's missing (it shouldn't be).
  it('spawns 6 real cli memory store subprocesses and asserts entryCount === 6', async (t) => {
    const { spawnSync, spawn } = await import('node:child_process');
    const { mkdtempSync, existsSync, readFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    // ── Infra gate (ADR-0082: explicit skip, not silent pass) ──────────────
    const REGISTRY = process.env.VERDACCIO_URL || 'http://localhost:4873';
    const verdaccio = spawnSync('curl', ['-sf', '--max-time', '2', `${REGISTRY}/-/ping`]);
    if (verdaccio.status !== 0) {
      t.skip(`SKIP_ACCEPTED: Verdaccio unreachable at ${REGISTRY}/-/ping — subprocess N=6 probe requires published CLI`);
      return;
    }

    // ── Sandbox setup: prefer cached harness (fast), fall back to fresh init ─
    // Even when we reuse a cached CLI binary, we ALWAYS create a fresh .swarm
    // dir inside a fresh sandbox for the write test itself — we cannot let
    // previous trial state leak into the invariant check.
    const CLI_VERSION = process.env.CLI_VERSION || 'latest';

    // ── ADR-0113 perf fix: marker pre-flight via tarball, NOT npm install ──
    // Original code did `npm install @sparkleideas/cli@latest` (22-30s) just
    // to read `node_modules/@sparkleideas/memory/dist/rvf-backend.js` and
    // check for the ADR-0095 markers. The npm install held the npm cache
    // lock, serializing parallel test files.
    //
    // Fast path: query Verdaccio for @sparkleideas/memory's tarball URL,
    // download the 200-300KB tarball directly, extract just dist/rvf-backend.js
    // via `tar -xzO`, run the same marker check. ~22ms vs 22-30s — 1000x.
    //
    // The full-install path runs ONLY when markers are present (the fix is
    // in Verdaccio). When markers are absent, SKIP_ACCEPTED replaces the
    // wasted install setup with a fast probe.
    const _markerCheck = (() => {
      const tarUrlRes = spawnSync('npm', [
        'view', `@sparkleideas/memory@${CLI_VERSION}`, 'dist.tarball',
        `--registry=${REGISTRY}`,
      ], { encoding: 'utf-8', timeout: 5_000 });
      const tarballUrl = (tarUrlRes.stdout || '').trim();
      if (tarUrlRes.status !== 0 || !tarballUrl) {
        return { ok: false, reason: 'preflight: npm view did not return tarball URL — fall through to full install' };
      }
      const probeDir = mkdtempSync(join(tmpdir(), 'adr0095-preflight-'));
      try {
        const tarPath = join(probeDir, 'memory.tgz');
        const dl = spawnSync('curl', ['-sf', '--max-time', '10', '-o', tarPath, tarballUrl]);
        if (dl.status !== 0) {
          return { ok: false, reason: `preflight: curl ${tarballUrl} failed (status=${dl.status}) — fall through to full install` };
        }
        const ext = spawnSync('tar', ['-xzOf', tarPath, 'package/dist/rvf-backend.js'], { encoding: 'utf-8', timeout: 5_000 });
        if (ext.status !== 0 || !ext.stdout) {
          return { ok: false, reason: 'preflight: tar extraction of package/dist/rvf-backend.js failed — fall through to full install' };
        }
        return { ok: true, memSrc: ext.stdout, tarballUrl };
      } finally {
        rmSync(probeDir, { recursive: true, force: true });
      }
    })();

    if (_markerCheck.ok) {
      const memSrc = _markerCheck.memSrc;
      // ADR-0095 Pass 1 markers (items a, b, c): reapStaleTmpFiles + _tmpCounter.
      // These are general fix-presence indicators carried forward by both the
      // initial d1 design AND the post-2026-05-01 swarm-2 amendment. Either
      // design is acceptable for this test — the contract is "6 concurrent
      // writers converge to entryCount === 6", not "design X is in dist".
      if (!memSrc.includes('reapStaleTmpFiles') || !memSrc.includes('_tmpCounter')) {
        t.skip(`SKIP_ACCEPTED: published @sparkleideas/memory@${CLI_VERSION} lacks ADR-0095 Pass 1 markers (reapStaleTmpFiles/_tmpCounter) [tarball pre-flight: ${_markerCheck.tarballUrl}]. Publish the fix: npm run publish:verdaccio, then set CLI_VERSION to new patch.`);
        return;
      }
      // NOTE: previous "Pass 2 marker" check (acquireLock < reap order) was
      // testing for the OLD d1 design. The current swarm-2 amendment puts
      // acquireLock AFTER reap (only around loadFromDisk) — see fork
      // rvf-backend.ts comment "scope the JS init lock down". Both designs
      // satisfy the entryCount === 6 invariant; gate dropped.
    }
    // Markers present (or pre-flight failed and we couldn't tell) — proceed
    // with the full install path that exercises the actual subprocess race.

    let workDir;
    try {
      workDir = mkdtempSync(join(tmpdir(), 'adr0095-sub-'));
      // npm init + install
      const pkgJson = { name: 'adr0095-sub', version: '1.0.0', private: true };
      const { writeFileSync } = await import('node:fs');
      writeFileSync(join(workDir, 'package.json'), JSON.stringify(pkgJson));
      writeFileSync(join(workDir, '.npmrc'), `registry=${REGISTRY}\n`);
      const install = spawnSync('npm', [
        'install', `@sparkleideas/cli@${CLI_VERSION}`,
        '--no-audit', '--silent', `--registry=${REGISTRY}`,
      ], { cwd: workDir, encoding: 'utf-8', timeout: 45_000 });
      if (install.status !== 0) {
        t.skip(`SKIP_ACCEPTED: npm install failed (infra, not product): ${install.stderr.slice(0, 300)}`);
        return;
      }
      const cliBin = join(workDir, 'node_modules', '.bin', 'cli');
      if (!existsSync(cliBin)) {
        t.skip(`SKIP_ACCEPTED: CLI binary missing at ${cliBin} (infra, not product)`);
        return;
      }
      // Defense in depth: re-verify markers post-install. The pre-flight
      // tarball check above is the fast path, but a divergent install
      // (registry redirect, lockfile staleness) could land different bytes.
      // Cheap to re-check Pass 1; expensive to debug a silent miss.
      const memDist = join(workDir, 'node_modules', '@sparkleideas', 'memory', 'dist', 'rvf-backend.js');
      const { readFileSync } = await import('node:fs');
      let memSrc = '';
      try { memSrc = readFileSync(memDist, 'utf8'); } catch {}
      if (!memSrc.includes('reapStaleTmpFiles') || !memSrc.includes('_tmpCounter')) {
        t.skip(`SKIP_ACCEPTED: installed @sparkleideas/memory@${CLI_VERSION} lacks ADR-0095 Pass 1 markers post-install (divergence from tarball pre-flight). Publish the fix: npm run publish:verdaccio.`);
        return;
      }
      // NOTE: obsolete Pass 2 (acquireLock < reap) check dropped — see
      // pre-flight comment above for the swarm-2 amendment rationale.

      // cli init --full
      const initRes = spawnSync(cliBin, ['init', '--full'], { cwd: workDir, encoding: 'utf-8', timeout: 30_000 });
      if (initRes.status !== 0) {
        t.skip(`SKIP_ACCEPTED: cli init --full failed (infra, not product): ${initRes.stderr.slice(0, 300)}`);
        return;
      }

      // ── Fire 6 concurrent subprocesses with unique keys ──────────────────
      const N = 6;
      const keys = Array.from({ length: N }, (_, i) => `adr0095-sub-${i + 1}`);
      const subprocs = keys.map((key) => {
        return new Promise((resolve) => {
          const child = spawn(cliBin, [
            'memory', 'store',
            '--key', key,
            '--value', `value-${key}`,
            '--namespace', 'adr0095-sub',
          ], { cwd: workDir, stdio: ['ignore', 'pipe', 'pipe'] });
          let stdout = '';
          let stderr = '';
          child.stdout.on('data', d => stdout += d);
          child.stderr.on('data', d => stderr += d);
          child.on('close', code => resolve({ code, stdout, stderr, key }));
        });
      });
      const results = await Promise.all(subprocs);
      const failed = results.filter(r => r.code !== 0);

      // ── Primary invariant: entryCount === 6 ─────────────────────────────
      const metaPath = join(workDir, '.swarm', 'memory.rvf.meta');
      let entryCount = null;
      let metaFound = false;
      let metaRaw = null;
      if (existsSync(metaPath)) {
        metaFound = true;
        const buf = readFileSync(metaPath);
        if (buf.length >= 8) {
          const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
          if (magic === 'RVF\x00') {
            const headerLen = buf.readUInt32LE(4);
            if (8 + headerLen <= buf.length) {
              try {
                const header = JSON.parse(buf.subarray(8, 8 + headerLen).toString('utf-8'));
                entryCount = header.entryCount;
              } catch (e) { metaRaw = `bad JSON: ${e.message}`; }
            } else { metaRaw = 'truncated header'; }
          } else { metaRaw = `bad magic: ${magic}`; }
        } else { metaRaw = 'too short'; }
      }

      const diagnostic = [
        `ADR-0095 subprocess N=${N} failed — DELIBERATELY FAILING UNTIL FIX LANDS (commit 2d12bb1)`,
        `  metaPath: ${metaPath}`,
        `  metaFound: ${metaFound}`,
        `  entryCount: ${entryCount} (expected ${N})`,
        `  metaRaw: ${metaRaw ?? 'n/a'}`,
        `  subproc-failures: ${failed.length}/${N}`,
      ];
      for (const f of failed.slice(0, 3)) {
        diagnostic.push(`    failed key=${f.key} code=${f.code} stderr=${f.stderr.slice(0, 200).replace(/\n/g, ' ')}`);
      }
      diagnostic.push('  Fix tracked in ADR-0095 §Amended Decision (items a, b, c).');

      // ── Assertion 1: meta file exists ───────────────────────────────────
      assert.ok(metaFound,
        `.swarm/memory.rvf.meta not produced by any writer\n${diagnostic.join('\n')}`);

      // ── Assertion 2: entryCount === N ───────────────────────────────────
      assert.equal(entryCount, N,
        `entryCount mismatch\n${diagnostic.join('\n')}`);

      // ── Assertion 3: all keys retrievable via cli memory retrieve ───────
      const retrieveFailures = [];
      for (const key of keys) {
        const ret = spawnSync(cliBin, [
          'memory', 'retrieve',
          '--key', key,
          '--namespace', 'adr0095-sub',
        ], { cwd: workDir, encoding: 'utf-8', timeout: 10_000 });
        if (ret.status !== 0) {
          retrieveFailures.push({ key, code: ret.status, stderr: ret.stderr.slice(0, 200) });
        }
      }
      assert.equal(retrieveFailures.length, 0,
        `${retrieveFailures.length}/${N} keys failed to round-trip via cli memory retrieve:\n` +
        retrieveFailures.map(f => `  key=${f.key} code=${f.code} stderr=${f.stderr.replace(/\n/g, ' ')}`).join('\n') +
        `\n${diagnostic.join('\n')}`);
    } finally {
      if (workDir) {
        try { rmSync(workDir, { recursive: true, force: true }); } catch {}
      }
    }
  });
});

// ============================================================================
// Group 7: ADR-0095 in-process N=6 variant — backend cache / dedupe invariant
// ============================================================================
//
// Per task point (2): "Add a separate in-process variant test ... that asserts
// the same invariant for the case where backend caching/dedupe matters."
//
// ADR-0090 B7 already covers the simpler in-process concurrency path via
// scripts/diag-rvf-inproc-race.mjs (passes 10/10). This case extends that
// check to N=6 instances of RvfBackend constructed in one process, verifying
// that the backend-dedupe invariant (ADR-0095 §Amended Decision item c) holds:
//   - Multiple RvfBackend instances on the same resolved databasePath should
//     converge the same way as 6 subprocesses would.
//   - This isolates the intra-process compounding that makes item (c) necessary.
//
// Unlike Group 6, this case does NOT require Verdaccio — it imports RvfBackend
// directly from the fork dist. Infrastructure skip only when the dist is
// missing (implies fork hasn't been built).
// ============================================================================

describe('ADR-0095 in-process N=6 — backend dedupe / cache invariant', () => {
  it('6 RvfBackend instances on same path converge to entryCount === 6', async (t) => {
    const { existsSync, mkdirSync, rmSync, readdirSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    // Load order (freshest first):
    //   1. ruflo-patch's copy+build output at /tmp/ruflo-build — always
    //      fresh after `npm run build` on ruflo-patch; the canonical build
    //      path per reference-fork-workflow (fork workspace tsc requires
    //      node_modules which may be absent).
    //   2. Fork's own dist — only fresh if fork workspace was built
    //      separately; usually stale.
    //   3. Any /tmp/ruflo-fast-* / ruflo-accept-* sandboxes from prior
    //      cascade runs — can be stale. Ordered by directory mtime DESC.
    const { statSync } = await import('node:fs');
    let RvfBackend = null;
    let loadSource = null;
    const candidates = [];
    const BUILD_DIST = '/tmp/ruflo-build/v3/@claude-flow/memory/dist/rvf-backend.js';
    const FORK_DIST  = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/dist/rvf-backend.js';
    if (existsSync(BUILD_DIST)) candidates.push(BUILD_DIST);
    if (existsSync(FORK_DIST))  candidates.push(FORK_DIST);
    try {
      const sandboxes = readdirSync('/tmp')
        .filter(d => d.startsWith('ruflo-fast-') || d.startsWith('ruflo-accept-'))
        .map(d => {
          const p = `/tmp/${d}/node_modules/@sparkleideas/memory/dist/rvf-backend.js`;
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
        if (mod.RvfBackend) { RvfBackend = mod.RvfBackend; loadSource = path; break; }
      } catch { /* try next */ }
    }
    if (!RvfBackend) {
      t.skip('SKIP_ACCEPTED: RvfBackend unavailable (fork dist incomplete AND no /tmp/ruflo-{fast,accept}-* harness with @sparkleideas/memory installed) — infra, not product');
      return;
    }

    // Fix-marker gate (ADR-0082): check rvf-backend.js for the distinctive
    // reapStaleTmpFiles marker (items a/b are IN this file). backendCache
    // lives in storage-factory.js so we check it there if available.
    // Missing → skip_accepted; present → assert the invariant.
    {
      const { readFileSync } = await import('node:fs');
      let src = '';
      try { src = readFileSync(loadSource, 'utf8'); } catch {}
      if (!src.includes('reapStaleTmpFiles')) {
        t.skip(`SKIP_ACCEPTED: RvfBackend at ${loadSource} lacks ADR-0095 fix marker (reapStaleTmpFiles). Rebuild fork dist: cd /Users/henrik/source/ruflo-patch && npm run build`);
        return;
      }
      // Best-effort check of factory cache (item c). Not fatal if not found —
      // rvf-backend itself is the invariant surface for this test.
      const factoryPath = loadSource.replace('rvf-backend.js', 'storage-factory.js');
      try {
        const factorySrc = readFileSync(factoryPath, 'utf8');
        if (!factorySrc.includes('backendCache')) {
          console.warn(`[ADR-0095 Group 7] storage-factory.js at ${factoryPath} lacks backendCache marker — factory dedupe may be stale`);
        }
      } catch {}
    }

    const N = 6;
    const workDir = join(tmpdir(), `adr0095-inproc-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(workDir, { recursive: true });
    const dbPath = join(workDir, 'test.rvf');

    try {
      // Fire N RvfBackend instances concurrently on the same resolved path.
      // Each stores one unique entry and shuts down. If the backend dedupe
      // (item c) is missing, the two-instance-per-process race (observed in
      // the investigator trace) compounds to data loss.
      const keys = Array.from({ length: N }, (_, i) => `inproc-${i + 1}`);
      const writers = keys.map(async (key) => {
        const backend = new RvfBackend({
          databasePath: dbPath,
          dimensions: 4,
          autoPersistInterval: 0,
        });
        await backend.initialize();
        await backend.store({
          id: key, key, namespace: 'adr0095-inproc',
          content: `value-${key}`,
          type: 'semantic', tags: [], metadata: {},
          accessLevel: 'private', ownerId: 'test',
          createdAt: Date.now(), updatedAt: Date.now(),
          accessCount: 0, lastAccessedAt: Date.now(), version: 1,
        });
        await backend.shutdown();
        return key;
      });
      const settled = await Promise.allSettled(writers);
      const rejected = settled.filter(s => s.status === 'rejected');

      // Retrieve via a fresh verifier instance.
      const verifier = new RvfBackend({
        databasePath: dbPath,
        dimensions: 4,
        autoPersistInterval: 0,
      });
      await verifier.initialize();
      const foundKeys = [];
      for (const key of keys) {
        const entry = await verifier.get(key);
        if (entry) foundKeys.push(key);
      }
      await verifier.shutdown();

      const diagnostic = [
        `ADR-0095 in-process N=${N} — backend dedupe invariant`,
        `  workDir: ${workDir}`,
        `  dbPath: ${dbPath}`,
        `  writers resolved: ${settled.length - rejected.length}/${N}`,
        `  foundKeys: ${foundKeys.length}/${N} (${foundKeys.join(',')})`,
      ];
      for (const r of rejected.slice(0, 3)) {
        diagnostic.push(`    rejected: ${String(r.reason).slice(0, 200)}`);
      }

      // Primary invariant: all N keys retrievable. Even if individual writers
      // rejected, the surviving writers' entries must be intact AND any writer
      // that exited clean must have its key retrievable.
      assert.equal(foundKeys.length, N,
        `in-process dedupe failure\n${diagnostic.join('\n')}`);
    } finally {
      try { rmSync(workDir, { recursive: true, force: true }); } catch {}
    }
  });
});
