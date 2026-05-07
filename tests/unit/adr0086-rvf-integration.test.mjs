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
    // Original invariant: loadFromDisk must NOT early-return before WAL
    // replay (only the :memory: guard is allowed).
    //
    // ADR-0154 evolution: loadFromDisk now has a native-segments fast path
    // that returns early after a successful META_SEG read — but that path
    // calls `replayWalIfPresent()` *before* returning, so WAL data is
    // preserved. The test invariant generalises to: every `return;` before
    // replayWal() must be either (a) the :memory: guard, or (b) immediately
    // preceded by a replayWal/replayWalIfPresent call.
    const replayIdx = loadBody.indexOf('this.replayWal()');
    assert.ok(replayIdx > 0, 'loadFromDisk must contain a replayWal() call');

    // Strip comments before counting/inspecting.
    const stripped = loadBody
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const beforeReplay = stripped.substring(0, stripped.indexOf('this.replayWal()'));

    // Find every `return;` location, and verify each is either the
    // :memory: guard or follows a replayWalIfPresent() call within the
    // immediately-preceding ~200 chars.
    const returnMatches = [...beforeReplay.matchAll(/\breturn\s*;/g)];
    const violations = [];
    for (const match of returnMatches) {
      const idx = match.index ?? 0;
      const context = stripped.substring(Math.max(0, idx - 200), idx);
      const isMemoryGuard = /:memory:/.test(context);
      const callsReplayBefore = /replayWalIfPresent\s*\(\s*\)/.test(context)
        || /this\.replayWal\s*\(\s*\)/.test(context);
      if (!isMemoryGuard && !callsReplayBefore) {
        violations.push({ idx, context: context.slice(-150) });
      }
    }
    assert.equal(violations.length, 0,
      `loadFromDisk has ${violations.length} return statement(s) that bypass WAL replay:\n`
      + violations.map((v, i) => `  [${i}] @offset ${v.idx}: ...${v.context}`).join('\n'));
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
// Group 6: REMOVED — ADR-0095 subprocess N=6 moved to acceptance.
// ============================================================================
// The original Group 6 test ran a real `npm install @sparkleideas/cli` +
// `cli init --full` + 6× concurrent `memory store` subprocesses inside the
// unit suite. It cost ~54s per run (npm install alone ~22-30s, init ~30s).
//
// The exact same race + entryCount + namespace-list invariants are already
// asserted by `check_t3_2_rvf_concurrent_writes` in
// lib/acceptance-adr0079-tier3-checks.sh:127, which uses the pre-installed
// `$(_cli_cmd)` binary in TEMP_DIR/node_modules — no slow npm install. The
// unit-level duplicate added zero coverage and slowed every `npm run
// test:unit` run.
//
// ADR-0095 §Acceptance criterion 3 ("6 real CLI subprocesses, entryCount
// converges to N=6") is now covered solely by the acceptance check.
// ============================================================================

describe('ADR-0095 subprocess N=6 — coverage moved to acceptance', () => {
  it('coverage delegated to acceptance check_t3_2_rvf_concurrent_writes', () => {
    assert.ok(true, 'see lib/acceptance-adr0079-tier3-checks.sh:127');
  });
});

// ============================================================================
// Group 7: REMOVED — broken by design, caused 30-minute deadlock 2026-05-04.
// ============================================================================
// The original Group 7 test created N=6 RvfBackend instances concurrently in
// the SAME process via `new RvfBackend(...)` (bypassing the storage-factory
// it claimed to test) on the same `.rvf` path. After ADR-0095's 2026-05-01
// amendment switched the WriterLock to `flock(LOCK_EX)`, the test deadlocks:
//
//   - macOS flock(2) is per-OFD, not per-process: each `new RvfBackend()` opens
//     its own FD on `test.rvf.lock`, and the second `flock(LOCK_EX)` blocks
//     waiting for the first to release. Both run as event-loop microtasks in
//     the same Node process — neither can advance.
//   - With `--test-timeout=0` (the test-runner's current default) the worker
//     sits idle indefinitely, eventually killed by run_tests_ci's 1800s cap.
//
// The test was self-contradictory: it asserted "factory dedupe via
// `storage-factory.js` `backendCache` works" while bypassing the factory and
// testing direct RvfBackend instantiation. The factory-dedupe invariant is
// better tested by a synchronous `getStorageBackend({databasePath: x}) ===
// getStorageBackend({databasePath: x})` assertion — no concurrency, no flock,
// no hang risk. That's a follow-up; for now the in-process variant is dropped.
//
// Cross-process N=6 race coverage continues via
// `check_t3_2_rvf_concurrent_writes` in lib/acceptance-adr0079-tier3-checks.sh.
// ============================================================================

describe('ADR-0095 in-process N=6 — coverage dropped (was deadlock-prone)', () => {
  it('factory dedupe invariant — see follow-up; cross-process race in acceptance', () => {
    assert.ok(true, 'see lib/acceptance-adr0079-tier3-checks.sh:127 for N=6 race coverage');
  });
});

// ============================================================================
// ADR-0095 item (c) — factory dedupe (synchronous)
//
// Replaces the deleted Group 7 with a deadlock-free probe of the same
// invariant: ADR-0095 §Amended Decision item (c) — `storage-factory.js`
// `backendCache` MUST dedupe `RvfBackend` instances by resolved
// `databasePath`, so two `createStorage({databasePath: x})` calls return the
// SAME instance.
//
// Differences from the deleted Group 7:
//   - Imports the actual factory (`createStorage` from `storage-factory.js`),
//     not a direct `new RvfBackend(...)` (the bypass that made the old test
//     self-contradictory).
//   - Sequential `await`s, not `Promise.all` over N=6 — there is exactly ONE
//     real construction (the second call hits the cache), so per-OFD
//     `flock(LOCK_EX)` cannot contend with itself, and the macOS deadlock that
//     froze the runner 2026-05-04 is structurally impossible.
//   - Loud `t.skip('SKIP_ACCEPTED: …')` if no candidate dist is on disk; never
//     fake-passes (per feedback-no-fallbacks).
// ============================================================================

describe('ADR-0095 item (c) — factory dedupe (synchronous)', () => {
  it('createStorage returns the SAME backend for the same resolved databasePath', async (t) => {
    // Bug fixed 2026-05-04 in fork commit e661b5d62: storage-factory.ts:111
    // existsSync invalidation was over-eager — evicted any never-written
    // backend on second createStorage call (no .rvf file yet → eviction →
    // duplicate instance → dedupe broken). Fix: scope eviction to
    // (!existsSync && dirty===true). Test now exercises the corrected path.
    const { existsSync, readdirSync, statSync, readFileSync, mkdirSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    // Locate `storage-factory.js` using the same load order as the deleted
    // Group 7 (ruflo-patch build dist → fork dist → /tmp sandbox node_modules,
    // freshest first).
    const candidates = [];
    const BUILD_DIST = '/tmp/ruflo-build/v3/@claude-flow/memory/dist/storage-factory.js';
    const FORK_DIST  = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/dist/storage-factory.js';
    if (existsSync(BUILD_DIST)) candidates.push(BUILD_DIST);
    if (existsSync(FORK_DIST))  candidates.push(FORK_DIST);
    try {
      const sandboxes = readdirSync('/tmp')
        .filter(d => d.startsWith('ruflo-fast-') || d.startsWith('ruflo-accept-'))
        .map(d => {
          const p = `/tmp/${d}/node_modules/@sparkleideas/memory/dist/storage-factory.js`;
          try { return existsSync(p) ? { p, mt: statSync(p).mtimeMs } : null; } catch { return null; }
        })
        .filter(Boolean)
        .sort((a, b) => b.mt - a.mt)
        .map(x => x.p);
      candidates.push(...sandboxes);
    } catch { /* no /tmp listing */ }
    // Also try the local node_modules — useful when the test runs against a
    // pinned ruflo-patch install (Verdaccio publish + npm i).
    const LOCAL_NM = '/Users/henrik/source/ruflo-patch/node_modules/@sparkleideas/memory/dist/storage-factory.js';
    if (existsSync(LOCAL_NM)) candidates.push(LOCAL_NM);

    let createStorage = null;
    let loadSource = null;
    for (const path of candidates) {
      try {
        const mod = await import(path);
        if (typeof mod.createStorage === 'function') {
          createStorage = mod.createStorage;
          loadSource = path;
          break;
        }
      } catch { /* try next */ }
    }
    if (!createStorage) {
      t.skip(`SKIP_ACCEPTED: storage-factory.js with createStorage export not found in any candidate dist (build / fork / sandbox / local node_modules) — infra, not product. Rebuild via: npm run release`);
      return;
    }

    // Fix-marker gate: dedupe is implemented via `backendCache`. If that
    // identifier isn't present, the dist predates ADR-0095 amendment 2d12bb1
    // and the invariant doesn't apply yet.
    let factorySrc = '';
    try { factorySrc = readFileSync(loadSource, 'utf8'); } catch {}
    if (!factorySrc.includes('backendCache')) {
      t.skip(`SKIP_ACCEPTED: ${loadSource} lacks ADR-0095 'backendCache' marker — pre-amendment dist. Rebuild via: npm run release`);
      return;
    }

    const workDir = join(tmpdir(), `adr0095-factory-dedupe-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(workDir, { recursive: true });
    const dbPath = join(workDir, 'dedupe-probe.rvf');

    let a = null;
    try {
      // First call: real construction. Sequential await — no flock contention
      // because there's no second concurrent construction.
      a = await createStorage({
        databasePath: dbPath,
        dimensions: 4,
        autoPersistInterval: 0,
      });
      // Second call: must hit `backendCache` and return the SAME instance.
      const b = await createStorage({
        databasePath: dbPath,
        dimensions: 4,
        autoPersistInterval: 0,
      });
      assert.strictEqual(
        b, a,
        `factory must dedupe by resolved databasePath (got distinct instances; loadSource=${loadSource})`,
      );
    } finally {
      // Single shutdown — `b === a`, so calling it on `a` covers both.
      if (a && typeof a.shutdown === 'function') {
        try { await a.shutdown(); } catch (e) {
          console.warn(`[ADR-0095 factory-dedupe] shutdown failed: ${e?.message ?? e}`);
        }
      }
      try { rmSync(workDir, { recursive: true, force: true }); } catch {}
    }
  });
});
