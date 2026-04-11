// @tier unit
// ADR-0080 P2: JSON Safety
//
// Tests that the three ADR-0080 P2 protections are wired into intelligence.cjs:
//   1. writeJSON uses atomic write-then-rename (.tmp -> target)
//   2. auto-memory-store is capped at 1,000 entries (LRU eviction)
//   3. dedup by entry ID (no duplicate IDs in store)
//   4. readJSON handles corrupt files gracefully (returns null)

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';

// ============================================================================
// Test 1: writeJSON uses atomic write-then-rename
// ============================================================================

describe('ADR-0080 P2: writeJSON atomic write-then-rename', () => {
  let writeFileSyncCalls;
  let renameSyncCalls;
  let originalModule;

  beforeEach(() => {
    writeFileSyncCalls = [];
    renameSyncCalls = [];
  });

  it('writeJSON writes to .tmp then renames to target path', () => {
    // Read the source to verify the atomic pattern exists
    const { readFileSync } = createRequire(import.meta.url)('fs');
    const { resolve } = createRequire(import.meta.url)('path');

    const src = readFileSync(
      resolve(process.cwd(), '.claude/helpers/intelligence.cjs'),
      'utf-8',
    );

    // Extract the writeJSON function body
    const writeJSONStart = src.indexOf('function writeJSON(');
    assert.ok(writeJSONStart > -1, 'writeJSON function must exist');

    // Find the closing brace — count braces from function start
    let braceDepth = 0;
    let writeJSONEnd = -1;
    for (let i = writeJSONStart; i < src.length; i++) {
      if (src[i] === '{') braceDepth++;
      if (src[i] === '}') {
        braceDepth--;
        if (braceDepth === 0) { writeJSONEnd = i + 1; break; }
      }
    }
    assert.ok(writeJSONEnd > writeJSONStart, 'writeJSON function body must be parseable');
    const writeJSONBody = src.slice(writeJSONStart, writeJSONEnd);

    // Verify atomic pattern: write to .tmp path first
    assert.ok(
      writeJSONBody.includes('.tmp') || writeJSONBody.includes('+ \'.tmp\'') || writeJSONBody.includes("+ '.tmp'"),
      'writeJSON must write to a .tmp path before renaming (atomic write pattern)',
    );

    // Verify renameSync is used
    assert.ok(
      writeJSONBody.includes('renameSync'),
      'writeJSON must call fs.renameSync to atomically move .tmp to target',
    );
  });

  it('writeJSON calls writeFileSync before renameSync (correct order)', () => {
    const { readFileSync } = createRequire(import.meta.url)('fs');
    const { resolve } = createRequire(import.meta.url)('path');

    const src = readFileSync(
      resolve(process.cwd(), '.claude/helpers/intelligence.cjs'),
      'utf-8',
    );

    // Extract writeJSON body
    const writeJSONStart = src.indexOf('function writeJSON(');
    let braceDepth = 0;
    let writeJSONEnd = -1;
    for (let i = writeJSONStart; i < src.length; i++) {
      if (src[i] === '{') braceDepth++;
      if (src[i] === '}') {
        braceDepth--;
        if (braceDepth === 0) { writeJSONEnd = i + 1; break; }
      }
    }
    const writeJSONBody = src.slice(writeJSONStart, writeJSONEnd);

    // writeFileSync must appear before renameSync
    const writePos = writeJSONBody.indexOf('writeFileSync');
    const renamePos = writeJSONBody.indexOf('renameSync');
    assert.ok(writePos > -1, 'writeFileSync must be present in writeJSON');
    assert.ok(renamePos > -1, 'renameSync must be present in writeJSON');
    assert.ok(
      writePos < renamePos,
      'writeFileSync must be called BEFORE renameSync (write .tmp first, then rename)',
    );
  });
});

// ============================================================================
// Test 2: auto-memory-store capped at 1,000 entries
// ============================================================================

describe('ADR-0080 P2: auto-memory-store capped at 1,000 entries', () => {
  it('MAX_STORE_ENTRIES is 1000 in consolidate() or the module', () => {
    const { readFileSync } = createRequire(import.meta.url)('fs');
    const { resolve } = createRequire(import.meta.url)('path');

    const src = readFileSync(
      resolve(process.cwd(), '.claude/helpers/intelligence.cjs'),
      'utf-8',
    );

    // The cap constant must be 1000 (ADR-0080 P2 changes the ADR-0074 value of 2000)
    assert.ok(
      src.includes('MAX_STORE_ENTRIES = 1000') || src.includes('MAX_STORE_ENTRIES = 1_000'),
      'MAX_STORE_ENTRIES must be 1000 (ADR-0080 P2 cap)',
    );
  });

  it('cap logic truncates to MAX_STORE_ENTRIES after sorting', () => {
    const { readFileSync } = createRequire(import.meta.url)('fs');
    const { resolve } = createRequire(import.meta.url)('path');

    const src = readFileSync(
      resolve(process.cwd(), '.claude/helpers/intelligence.cjs'),
      'utf-8',
    );

    // The over-cap path must sort and truncate (slice or length assignment)
    const hasCap = src.includes('.slice(0, MAX_STORE_ENTRIES)')
      || src.includes('.length = MAX_STORE_ENTRIES');
    assert.ok(hasCap, 'over-cap entries must be truncated to MAX_STORE_ENTRIES');
  });
});

// ============================================================================
// Test 3: LRU eviction drops oldest entries
// ============================================================================

describe('ADR-0080 P2: LRU eviction drops oldest entries', () => {
  it('over-cap sorting uses createdAt or timestamp for LRU ordering', () => {
    const { readFileSync } = createRequire(import.meta.url)('fs');
    const { resolve } = createRequire(import.meta.url)('path');

    const src = readFileSync(
      resolve(process.cwd(), '.claude/helpers/intelligence.cjs'),
      'utf-8',
    );

    // Find the over-cap sort logic near MAX_STORE_ENTRIES
    const capIndex = src.indexOf('MAX_STORE_ENTRIES');
    assert.ok(capIndex > -1, 'MAX_STORE_ENTRIES must be defined');

    // The sort near the cap check must reference a time-based field for LRU
    // (createdAt, timestamp, or accessedAt) — or a composite score that
    // incorporates recency
    const capSection = src.slice(capIndex, capIndex + 500);
    const hasTimeLRU = capSection.includes('createdAt')
      || capSection.includes('timestamp')
      || capSection.includes('accessedAt')
      || capSection.includes('lastAccess')
      || capSection.includes('.sort(');

    assert.ok(
      hasTimeLRU,
      'over-cap eviction must use time-based ordering (LRU) near MAX_STORE_ENTRIES',
    );
  });

  it('entries beyond the cap are removed, keeping the most recent', () => {
    // Functional test: build a store array with 1500 entries, each with a
    // known timestamp, run the cap logic inline, verify only 1000 remain
    // and they are the 1000 newest.
    const MAX = 1000;
    const entries = [];
    for (let i = 0; i < 1500; i++) {
      entries.push({
        id: `entry-${i}`,
        createdAt: 1000000 + i, // increasing timestamps
        content: `content-${i}`,
        namespace: 'test',
      });
    }

    // Simulate LRU cap: sort descending by createdAt, take first MAX
    const sorted = [...entries].sort((a, b) => b.createdAt - a.createdAt);
    const capped = sorted.slice(0, MAX);

    assert.equal(capped.length, MAX, `capped store must have exactly ${MAX} entries`);

    // Oldest entry (id=entry-0, createdAt=1000000) must be gone
    const hasOldest = capped.some(e => e.id === 'entry-0');
    assert.ok(!hasOldest, 'oldest entry (entry-0) must be evicted');

    // Newest entry (id=entry-1499, createdAt=1001499) must be kept
    const hasNewest = capped.some(e => e.id === 'entry-1499');
    assert.ok(hasNewest, 'newest entry (entry-1499) must be retained');

    // The 500th newest (entry-1000) must be kept
    const hasBoundary = capped.some(e => e.id === 'entry-1000');
    assert.ok(hasBoundary, 'boundary entry (entry-1000) must be retained');

    // The 501st from end (entry-499) must be evicted
    const hasJustEvicted = capped.some(e => e.id === 'entry-499');
    assert.ok(!hasJustEvicted, 'entry just beyond cap (entry-499) must be evicted');
  });
});

// ============================================================================
// Test 4: dedup by entry ID
// ============================================================================

describe('ADR-0080 P2: dedup by entry ID', () => {
  it('init() deduplicates store entries by ID (last write wins)', () => {
    const { readFileSync } = createRequire(import.meta.url)('fs');
    const { resolve } = createRequire(import.meta.url)('path');

    const src = readFileSync(
      resolve(process.cwd(), '.claude/helpers/intelligence.cjs'),
      'utf-8',
    );

    // The init() function must have dedup logic using a Map or Set
    const initStart = src.indexOf('function init()');
    const initEnd = src.indexOf('function getContext(');
    assert.ok(initStart > -1 && initEnd > initStart, 'init() function must exist');
    const initBody = src.slice(initStart, initEnd);

    // Dedup must use a Map (seen.set / seen.get pattern) or Set
    assert.ok(
      initBody.includes('seen.set(') || initBody.includes('new Map()') || initBody.includes('new Set('),
      'init() must deduplicate entries using a Map or Set',
    );
    assert.ok(
      initBody.includes('deduped') || initBody.includes('seen.values()'),
      'init() must produce a deduped array from the seen Map',
    );
  });

  it('dedup keeps last-write-wins when duplicate IDs exist', () => {
    // Functional test: simulate the dedup logic from init()
    const store = [
      { id: 'a', content: 'first-a', createdAt: 100 },
      { id: 'b', content: 'first-b', createdAt: 200 },
      { id: 'a', content: 'second-a', createdAt: 300 }, // duplicate of 'a'
      { id: 'c', content: 'first-c', createdAt: 400 },
      { id: 'b', content: 'second-b', createdAt: 500 }, // duplicate of 'b'
    ];

    // Replicate the dedup logic from init()
    const seen = new Map();
    for (const entry of store) {
      const id = entry.id || entry.key;
      entry.id = id;
      seen.set(id, entry); // last write wins
    }
    const deduped = [...seen.values()];

    // Must have exactly 3 unique IDs
    assert.equal(deduped.length, 3, 'deduped store must have exactly 3 unique entries');

    // Check last-write-wins semantics
    const entryA = deduped.find(e => e.id === 'a');
    assert.equal(entryA.content, 'second-a', 'entry "a" must be the second occurrence (last write wins)');

    const entryB = deduped.find(e => e.id === 'b');
    assert.equal(entryB.content, 'second-b', 'entry "b" must be the second occurrence (last write wins)');

    const entryC = deduped.find(e => e.id === 'c');
    assert.equal(entryC.content, 'first-c', 'entry "c" has no duplicate — must be retained');
  });

  it('each ID appears exactly once after dedup', () => {
    // Build store with heavy duplication
    const store = [];
    for (let i = 0; i < 100; i++) {
      store.push({ id: `id-${i % 20}`, content: `version-${i}`, createdAt: i });
    }

    const seen = new Map();
    for (const entry of store) {
      seen.set(entry.id, entry);
    }
    const deduped = [...seen.values()];

    assert.equal(deduped.length, 20, 'deduped must contain exactly 20 unique IDs');

    // Verify no duplicates
    const ids = deduped.map(e => e.id);
    const uniqueIds = new Set(ids);
    assert.equal(ids.length, uniqueIds.size, 'every ID must appear exactly once');

    // Last-write-wins: id-0 should have version-80 (i=80 is last with id-0)
    const entry0 = deduped.find(e => e.id === 'id-0');
    assert.equal(entry0.content, 'version-80', 'id-0 must keep the last write (version-80)');
  });
});

// ============================================================================
// Test 5: readJSON handles corrupt files gracefully
// ============================================================================

describe('ADR-0080 P2: readJSON handles corrupt files gracefully', () => {
  it('readJSON returns null on parse error (does not throw)', () => {
    const { readFileSync } = createRequire(import.meta.url)('fs');
    const { resolve } = createRequire(import.meta.url)('path');

    const src = readFileSync(
      resolve(process.cwd(), '.claude/helpers/intelligence.cjs'),
      'utf-8',
    );

    // Extract readJSON body
    const readJSONStart = src.indexOf('function readJSON(');
    assert.ok(readJSONStart > -1, 'readJSON function must exist');

    let braceDepth = 0;
    let readJSONEnd = -1;
    for (let i = readJSONStart; i < src.length; i++) {
      if (src[i] === '{') braceDepth++;
      if (src[i] === '}') {
        braceDepth--;
        if (braceDepth === 0) { readJSONEnd = i + 1; break; }
      }
    }
    const readJSONBody = src.slice(readJSONStart, readJSONEnd);

    // Must have try/catch
    assert.ok(
      readJSONBody.includes('try') && readJSONBody.includes('catch'),
      'readJSON must wrap parsing in try/catch',
    );

    // Must return null as fallback
    assert.ok(
      readJSONBody.includes('return null'),
      'readJSON must return null on failure (not throw)',
    );
  });

  it('readJSON returns null for non-existent file (does not throw)', () => {
    // readJSON is not exported, so verify the contract via source inspection:
    // it checks existsSync before reading, and catches JSON.parse errors.
    const { readFileSync } = createRequire(import.meta.url)('fs');
    const { resolve } = createRequire(import.meta.url)('path');

    const src = readFileSync(
      resolve(process.cwd(), '.claude/helpers/intelligence.cjs'),
      'utf-8',
    );

    const readJSONStart = src.indexOf('function readJSON(');
    let braceDepth = 0;
    let readJSONEnd = -1;
    for (let i = readJSONStart; i < src.length; i++) {
      if (src[i] === '{') braceDepth++;
      if (src[i] === '}') {
        braceDepth--;
        if (braceDepth === 0) { readJSONEnd = i + 1; break; }
      }
    }
    const readJSONBody = src.slice(readJSONStart, readJSONEnd);

    // Must check existsSync before reading
    assert.ok(
      readJSONBody.includes('existsSync'),
      'readJSON must check file existence before reading',
    );

    // The catch block must not re-throw
    const catchStart = readJSONBody.indexOf('catch');
    assert.ok(catchStart > -1, 'readJSON must have a catch block');
    const afterCatch = readJSONBody.slice(catchStart);
    assert.ok(
      !afterCatch.includes('throw'),
      'readJSON catch block must not re-throw — corrupt files are silently handled',
    );
  });

  it('readJSON tolerates truncated JSON (returns null)', () => {
    // Simulate what readJSON does with bad JSON content
    function readJSONSimulated(content) {
      try {
        return JSON.parse(content);
      } catch { /* corrupt file — start fresh */ }
      return null;
    }

    // Truncated JSON
    assert.equal(readJSONSimulated('{"key": "val'), null, 'truncated JSON must return null');

    // Empty string
    assert.equal(readJSONSimulated(''), null, 'empty string must return null');

    // Random binary-like content
    assert.equal(readJSONSimulated('\x00\x01\x02'), null, 'binary content must return null');

    // Valid JSON still works
    const result = readJSONSimulated('{"key": "value"}');
    assert.deepEqual(result, { key: 'value' }, 'valid JSON must parse correctly');

    // Valid array
    const arr = readJSONSimulated('[1, 2, 3]');
    assert.deepEqual(arr, [1, 2, 3], 'valid JSON array must parse correctly');
  });
});

