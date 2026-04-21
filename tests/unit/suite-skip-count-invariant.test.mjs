// @tier unit
// Skip-count regression guard — ADR-0082 defense-in-depth.
//
// This file asserts that the total count of EXPLICIT TOMBSTONE skips
// (`it.skip(...)`, `describe.skip(...)`, `test.skip(...)`) across
// tests/unit/ does not silently creep upward. Explicit tombstones are
// permanent skips with no runtime gating — they exist because a test
// author actively decided "don't run this". They rot quickly and are
// exactly what ADR-0094 skip hygiene targets.
//
// Runtime-conditional gates like `it('name', { skip: !HAS_SQLITE3 })` or
// `it('name', { skip })` (where `skip` is a module-level boolean set by
// loader probes) are INTENTIONALLY NOT COUNTED. These are legitimate
// integration-test gates that go from "skip" to "run" when a prereq
// lands (e.g. A1's Verdaccio install fallback flipped 29 `{ skip }` gates
// from skip to run without changing a single test body). Counting them as
// permanent would misrepresent the health signal — a prereq-gated test
// that runs green when the prereq exists is not a skip, it's a
// conditional assertion. node's test reporter's `ℹ skipped N` line is
// the runtime-accurate number; this guard is the compile-time-tombstone
// ceiling.
//
// NOTE: this file deliberately does NOT run the full unit suite (that would
// recurse). It performs a static scan of sibling *.test.mjs files for skip
// markers. Patterns are written so this file's own source does not match
// them — we use word-boundary anchors and explicit exclusion of self.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF_FILENAME = 'suite-skip-count-invariant.test.mjs';
const UNIT_DIR = resolve(dirname(fileURLToPath(import.meta.url)));

// Pattern enumeration — count ONLY explicit tombstones (`it.skip(`,
// `describe.skip(`, `test.skip(`). Runtime-conditional gates like
// `{ skip }` / `{ skip: <bool> }` / `{ skip: 'reason' }` are excluded
// because they represent conditional execution, not permanent skip.
// See file header for the full rationale.
//
// \b word boundaries ensure this file's own pattern literals don't
// self-match (the literal tokens contain backslash-b escapes, not literal
// word characters).
const SKIP_PATTERNS = [
  /\bit\b\.skip\s*\(/g,
  /\bdescribe\b\.skip\s*\(/g,
  /\btest\b\.skip\s*\(/g,
];

// Populate if/when sibling agents identify skips they cannot eliminate.
// Shape: { 'filename.test.mjs': { count: N, reason: 'justification' } }
// Start empty — after A1/A2/A3 land, the ceiling is zero.
const KNOWN_LEGITIMATE_SKIPS = {};

function countSkipsInFile(filePath) {
  const src = readFileSync(filePath, 'utf8');
  // Strip /* */ block comments and // line comments so commented-out skip
  // calls do not count toward the ceiling.
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  let total = 0;
  for (const p of SKIP_PATTERNS) {
    // Reset lastIndex: regex has /g flag, reused across files.
    p.lastIndex = 0;
    const m = stripped.match(p);
    if (m) total += m.length;
  }
  return total;
}

describe('Unit test suite skip-count regression guard', () => {
  it('total skip count matches documented allowlist', () => {
    const files = readdirSync(UNIT_DIR).filter(f => f.endsWith('.test.mjs'));
    const offenders = [];
    const perFile = {};
    let grandTotal = 0;

    for (const f of files) {
      // Self-exclusion: this guard file contains pattern literals and
      // allowlist keys that can superficially resemble skip markers.
      if (f === SELF_FILENAME) continue;

      const count = countSkipsInFile(join(UNIT_DIR, f));
      perFile[f] = count;
      grandTotal += count;

      const allowed = KNOWN_LEGITIMATE_SKIPS[f]?.count ?? 0;
      if (count > allowed) {
        const reason = KNOWN_LEGITIMATE_SKIPS[f]?.reason ?? 'no allowlist entry';
        offenders.push(`${f}: ${count} skip(s) (allowed: ${allowed}) — ${reason}`);
      }
    }

    assert.equal(
      offenders.length,
      0,
      `Skip-count regression detected (grand total=${grandTotal}):\n  ` +
        offenders.join('\n  ') +
        '\n\nFix the skip (preferred — ADR-0094) or add an entry to ' +
        'KNOWN_LEGITIMATE_SKIPS in ' + SELF_FILENAME + ' with a reason.'
    );
  });

  it('self-exclusion is wired correctly', () => {
    // Sanity: make sure the guard file itself is present in the directory
    // listing AND that it is skipped by the scan. If someone renames this
    // file without updating SELF_FILENAME, this test will fail and prompt
    // a fix before the primary assertion silently breaks.
    const files = readdirSync(UNIT_DIR).filter(f => f.endsWith('.test.mjs'));
    assert.ok(
      files.includes(SELF_FILENAME),
      `SELF_FILENAME (${SELF_FILENAME}) not found in ${UNIT_DIR}. ` +
        'Rename? Update the SELF_FILENAME constant.'
    );
    // Also confirm basename of this module matches SELF_FILENAME so the
    // constant cannot silently drift away from the real filename.
    const thisFile = basename(fileURLToPath(import.meta.url));
    assert.equal(thisFile, SELF_FILENAME, 'SELF_FILENAME constant is stale');
  });
});
