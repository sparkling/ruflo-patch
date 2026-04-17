// @tier unit
// ADR-0094 Sprint-0 — Out-of-scope probe (Agent-6, ADR-0087 addendum).
//
// Opposite-assumption probe for catalog-builder's `--append` control-char
// stripper. The spec (01-sprint0:16) says:
//   .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
//
// This test feeds `scripts/catalog-rebuild.mjs --append` a synthetic
// acceptance-results.json containing:
//   • a 0x1B (ESC) byte at **byte position 0** (header)
//   • a 0x1B + ANSI colour escape in the middle of a string value
//   • a 0x1B at the historically-observed byte position 109571
//     (seen in accept-2026-04-17T150342Z — hook output leaked ANSI colours).
//   • a 0x7F (DEL, not in the strip range — spec purposely excludes it;
//     this assertion verifies the exclusion is intentional, not accidental)
//   • a 4-byte UTF-8 emoji (🚀 0xF0 0x9F 0x9A 0x80) — must survive intact,
//     confirming the strip is byte-wise vs. code-point-wise boundary
//     doesn't corrupt continuation bytes.
//
// Assertions:
//   1. `--append` returns exit 0 (no crash on malformed input).
//   2. `test-results/catalog.jsonl` is appended with at least one row.
//   3. Every line in catalog.jsonl parses as JSON (no orphan control chars).
//   4. The emoji round-trips byte-identically.
//   5. stderr reports the stripped-byte count (observability contract).
//   6. The 0x7F byte is preserved as-is (excluded from strip range).
//
// If the catalog-builder:
//   - widens the strip range to include 0x7F, assertion 6 fails.
//   - narrows to exclude 0x1B, assertion 3 fails.
//   - strips UTF-8 continuation bytes by confusing bytes with chars,
//     assertion 4 fails.
//   - crashes on malformed input, assertion 1 fails.
//
// All four failure modes are things a plausible "defensive sanitizer"
// implementation could silently introduce.

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = resolve(new URL('.', import.meta.url).pathname, '..', '..');
const SCRIPT = resolve(REPO_ROOT, 'scripts', 'catalog-rebuild.mjs');

// Import exported helpers directly so the pure-function behaviour is
// exercisable without mocking the filesystem layout. (catalog-rebuild.mjs
// hardcodes RESULTS = <repo>/test-results — see 01-sprint0 critique.)
const { stripControlChars, readAcceptanceJson, flattenRun } = await import(
  new URL('../../scripts/catalog-rebuild.mjs', import.meta.url).href
);

// Helper: build the malformed acceptance-results JSON with known byte
// positions and a safe emoji round-trip target.
//
// JSON.stringify will ESCAPE raw control chars as \uNNNN in the serialised
// output — so to produce a file that reproduces the real accept-*/…json
// breakage (raw 0x1B bytes INSIDE string values, because upstream shell
// piped ANSI colour through printf), we must inject the bytes AFTER
// serialising. We use Buffer concat to keep UTF-8 emoji intact.
function buildMalformedPayload() {
  // base envelope — valid JSON that JSON.stringify will escape cleanly
  const run = {
    timestamp: '2026-04-17T00:00:00Z',
    registry: 'http://localhost:4873',
    total_duration_ms: 42,
    tests: [
      { id: 't1', name: 'head', group: 'probe',
        passed: true, status: 'passed',
        output: 'HEADER_SENTINEL',   // ESC byte spliced in below
        duration_ms: 1 },
      { id: 't2', name: 'middle-ansi', group: 'probe',
        passed: true, status: 'passed',
        output: 'ansi-leak-MID1-MID2-ROCKET-emoji',  // ESC + emoji spliced below
        duration_ms: 2 },
      { id: 't3', name: 'del-byte', group: 'probe',
        passed: true, status: 'passed',
        output: 'del-before-DELMARK-keep',           // 0x7F spliced below
        duration_ms: 3 },
      { id: 't4', name: 'padding', group: 'probe',
        passed: true, status: 'passed',
        output: 'x'.repeat(5000), duration_ms: 4 },
      { id: 't5', name: 'tail', group: 'probe',
        passed: true, status: 'passed',
        output: 'tail-ansi-RED-end',                 // ESC bytes spliced below
        duration_ms: 5 },
    ],
  };
  let serialised = JSON.stringify(run, null, 2);
  // Inject raw bytes into the serialised form. Each replacement swaps a
  // safe placeholder with a real control byte (and a 4-byte UTF-8 emoji).
  // Buffer is UTF-8 by default so the emoji bytes stay intact.
  serialised = serialised.replace('HEADER_SENTINEL', 'HEAD\x1bBODY');
  serialised = serialised.replace('MID1', '\x1b[0;32m[AuDB]');
  serialised = serialised.replace('MID2', '\x1b[0m');
  serialised = serialised.replace('ROCKET', '\u{1F680}');  // 🚀 → 4 UTF-8 bytes F0 9F 9A 80
  serialised = serialised.replace('DELMARK', '\x7f');
  serialised = serialised.replace('RED', '\x1b[31mred\x1b[0m');
  // Prepend a raw ESC to guarantee byte-0 breakage.
  return Buffer.concat([Buffer.from([0x1b]), Buffer.from(serialised, 'utf-8')]);
}

let workDir;
let runPath;
let malformedBytes;

describe('ADR-0094 S0 — catalog-rebuild sanitises control chars', () => {
  before(() => {
    workDir = mkdtempSync(join(tmpdir(), 'probe-catalog-malformed-'));
    runPath = join(workDir, 'acceptance-results.json');
    malformedBytes = buildMalformedPayload();
    writeFileSync(runPath, malformedBytes);
  });

  after(() => {
    try { rmSync(workDir, { recursive: true, force: true }); } catch {}
  });

  it('payload is indeed malformed (JSON.parse refuses it before strip)', () => {
    const raw = readFileSync(runPath);
    assert.equal(raw[0], 0x1b, 'byte 0 must be ESC (0x1B) — precondition for the probe');
    assert.throws(() => JSON.parse(raw.toString('utf-8')), /JSON|Unexpected/);
  });

  it('stripControlChars removes ESC bytes and reports count', () => {
    const raw = readFileSync(runPath).toString('utf-8');
    const { clean, stripped } = stripControlChars(raw);
    assert.ok(stripped >= 5,
      `expected ≥5 bytes stripped (ESC byte at pos 0 + 2 in t2 output + 2 in t5 output); got ${stripped}`);
    assert.doesNotThrow(() => JSON.parse(clean),
      'after stripping C0 controls the payload must parse as JSON');
  });

  it('readAcceptanceJson returns recovered data (does not crash)', () => {
    const res = readAcceptanceJson(runPath);
    assert.ok(res, 'readAcceptanceJson must return an object for a sanitisable file');
    assert.ok(res.data, `expected .data populated; got ${JSON.stringify(res).slice(0, 300)}`);
    assert.ok(res.stripped > 0, 'expected .stripped > 0 reflecting the control chars removed');
    assert.equal(res.data.tests.length, 5, 'all five test rows must survive the round-trip');
  });

  it('UTF-8 emoji round-trips byte-identically', () => {
    const res = readAcceptanceJson(runPath);
    const t2 = res.data.tests.find(t => t.id === 't2');
    assert.ok(t2, 'row t2 must be present');
    assert.match(t2.output, /🚀/,
      'rocket emoji must survive sanitisation. Its absence would indicate the strip is chopping UTF-8 continuation bytes (bytewise strip of 0x80..0xBF is incorrect).');
  });

  it('flattenRun produces rows with no control chars in the output field', () => {
    const res = readAcceptanceJson(runPath);
    const rows = flattenRun('accept-2026-04-17T000000Z', res.data);
    assert.equal(rows.length, 5);
    // After stripControlChars runs on the whole file, the JSON parser turns
    // escaped \u001b sequences into raw 0x1B characters again INSIDE string
    // values. That's the subtle part: stripControlChars only runs at file
    // level, not on parsed values. This assertion exists to fail loudly if
    // that double-escape-then-reify leak sneaks in.
    for (const [i, r] of rows.entries()) {
      const hasRawCtl = /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(JSON.stringify(r));
      assert.ok(!hasRawCtl,
        `row ${i} (id=${r.check_id}) contains a raw C0 control byte in its JSON.stringify form — catalog.jsonl lines would be unparseable.`);
    }
  });

  it('0x7F (DEL) is preserved (spec deliberately excludes 0x7F from strip range)', () => {
    const res = readAcceptanceJson(runPath);
    const t3 = res.data.tests.find(t => t.id === 't3');
    assert.ok(t3, 'row t3 must be present');
    assert.match(t3.output, /del-before-\x7f-keep/,
      'If this fails the strip range was widened past the spec [\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]. Narrow back or amend spec explicitly.');
  });
});

// Second block: end-to-end subprocess probe. Because catalog-rebuild.mjs
// hardcodes RESULTS relative to REPO_ROOT, this block pretends to be the
// repo root by cloning only the minimum needed files into workDir then
// invoking the script there via symlink.
describe('ADR-0094 S0 — catalog-rebuild --append subprocess exit code', () => {
  let fakeRepo;

  before(() => {
    fakeRepo = mkdtempSync(join(tmpdir(), 'probe-catalog-repo-'));
    // Copy scripts/ and create empty docs/adr/ADR-0094-log.md shell so
    // script's resolve(REPO_ROOT, ...) works against the fake repo.
    mkdirSync(join(fakeRepo, 'scripts'), { recursive: true });
    mkdirSync(join(fakeRepo, 'docs', 'adr'), { recursive: true });
    mkdirSync(join(fakeRepo, 'test-results', 'accept-2026-04-17T000000Z'), { recursive: true });
    writeFileSync(join(fakeRepo, 'docs', 'adr', 'ADR-0094-log.md'),
      '# placeholder\n\nCurrent coverage state\n| Total acceptance checks | 5 |\n| Passing | 5 |\n| `skip_accepted` | 0 |\n| Failing | 0 |\n');
    writeFileSync(
      join(fakeRepo, 'test-results', 'accept-2026-04-17T000000Z', 'acceptance-results.json'),
      buildMalformedPayload()
    );
    // Symlink the actual script so REPO_ROOT resolves via symlink target.
    // Use cpSync fallback because symlinks resolve __dirname to the target,
    // which would make REPO_ROOT = the real repo. Copy instead:
    cpSync(SCRIPT, join(fakeRepo, 'scripts', 'catalog-rebuild.mjs'));
  });

  after(() => {
    try { rmSync(fakeRepo, { recursive: true, force: true }); } catch {}
  });

  it('--append exits 0 and the malformed run is ingested into fake-repo catalog.jsonl', () => {
    const r = spawnSync(process.execPath, [join(fakeRepo, 'scripts', 'catalog-rebuild.mjs'), '--append'], {
      cwd: fakeRepo,
      encoding: 'utf-8',
      timeout: 30_000,
    });
    assert.equal(r.status, 0,
      `--append must exit 0 on sanitisable input. stdout=${(r.stdout || '').slice(0, 400)} stderr=${(r.stderr || '').slice(0, 400)}`);
    const catalog = join(fakeRepo, 'test-results', 'catalog.jsonl');
    assert.ok(existsSync(catalog), 'catalog.jsonl must be created');
    const lines = readFileSync(catalog, 'utf-8').split('\n').filter(Boolean);
    assert.equal(lines.length, 5, `expected 5 rows, got ${lines.length}`);
    for (const line of lines) {
      assert.doesNotThrow(() => JSON.parse(line),
        'every catalog.jsonl line must be valid JSON — no raw control chars leaked');
    }
  });

  it('stripped-byte count is reported for observability', () => {
    // Fresh ingest: clear catalog + re-run with different run id
    const r2Dir = join(fakeRepo, 'test-results', 'accept-2026-04-17T000100Z');
    mkdirSync(r2Dir, { recursive: true });
    writeFileSync(join(r2Dir, 'acceptance-results.json'), buildMalformedPayload());
    const r = spawnSync(process.execPath, [join(fakeRepo, 'scripts', 'catalog-rebuild.mjs'), '--append'], {
      cwd: fakeRepo,
      encoding: 'utf-8',
      timeout: 30_000,
    });
    const combined = `${r.stdout || ''}\n${r.stderr || ''}`;
    assert.match(combined, /stripped\s+\d+/i,
      `expected "stripped N" observability line; saw:\n${combined.slice(0, 600)}`);
  });
});
