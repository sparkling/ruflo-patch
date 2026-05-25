// @tier pipeline
// ADR-0235 — Init helpers generator-vs-bundled parity invariant.
//
// Asserts the structural invariants that close F-12-001 / F-12-003:
//
//   (1) The bundled-static directory at
//       forks/ruflo/v3/@claude-flow/cli/.claude/helpers/ has been deleted
//       (Option B per ADR-0235). Any reintroduction trips the test.
//
//   (2) helpers-generator.ts:generateHookHandler() defines the 14 handler
//       keys expected post-ADR-0211 (the source-side fix that this ADR
//       makes visible to npx users). Drift in either direction trips it.
//
//   (3) IF a future commit DOES re-add v3/@claude-flow/cli/.claude/helpers/
//       (the conservative-fallback path of Option B), each generator-
//       overlapping bundled file (hook-handler.mjs, intelligence.cjs,
//       auto-memory-hook.mjs) must contain the same handler keys as the
//       generator (no silent dual-source drift).
//
// FAIL LOUD — there is NO UPDATE_GOLDEN-style escape hatch. If the test
// fails, the structural invariant is broken; the only remedy is to fix
// the bundled / source side.
//
// Pattern: node --test + literal-grep, per ADR-0215
// (skill-shell-integrity.test.mjs).

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

const upstream = JSON.parse(
  readFileSync(resolve(ROOT, 'config', 'upstream-branches.json'), 'utf8'),
);
const FORK_RUFLO = upstream.ruflo.dir;

const CLI_PKG = join(FORK_RUFLO, 'v3', '@claude-flow', 'cli');
const BUNDLED_HELPERS_DIR = join(CLI_PKG, '.claude', 'helpers');
const HELPERS_GENERATOR = join(CLI_PKG, 'src', 'init', 'helpers-generator.ts');

// 14 handler keys from helpers-generator.ts:generateHookHandler(), per
// ADR-0211 / ADR-0235 §Pre-flight Check 3. The bundled static carried
// 8 of these (route, pre-bash, post-edit, session-restore, session-end,
// pre-task, post-task, stats) — the other 6 (pre-edit, post-command,
// notify, compact-manual, compact-auto, status) were the F-12-001
// silent no-op symptoms.
const EXPECTED_HANDLER_KEYS = [
  'route',
  'pre-bash',
  'pre-edit',
  'pre-task',
  'post-edit',
  'post-task',
  'post-command',
  'session-restore',
  'session-end',
  'compact-manual',
  'compact-auto',
  'status',
  'notify',
  'stats',
];

const skip = !existsSync(CLI_PKG)
  ? `${CLI_PKG} not found — fork not checked out`
  : false;

describe('ADR-0235 — init helpers generator-vs-bundled parity', { skip }, () => {
  it('bundled-static .claude/helpers/ directory is deleted (ADR-0235 Option B)', () => {
    assert.equal(
      existsSync(BUNDLED_HELPERS_DIR),
      false,
      `Bundled-static helpers directory should be deleted per ADR-0235 ` +
        `(Option B unconditional path). Found: ${BUNDLED_HELPERS_DIR}\n\n` +
        `If a future commit needs to re-add bundled-static helpers, the ` +
        `per-file parity assertion (next test) must hold AND the package's ` +
        `files: array trim must be re-evaluated.`,
    );
  });

  it('helpers-generator.ts defines all 14 expected handler keys (ADR-0211)', () => {
    assert.ok(
      existsSync(HELPERS_GENERATOR),
      `Generator source file not found: ${HELPERS_GENERATOR}`,
    );
    const content = readFileSync(HELPERS_GENERATOR, 'utf8');
    const missing = [];
    for (const key of EXPECTED_HANDLER_KEYS) {
      // Match `'<key>':` inside the generated handler dispatch.
      // The actual literal in source is e.g. `'pre-edit': () => {...},`
      const pattern = new RegExp(`'${key.replace(/[.*+?^${}()|[\\\]\\\\]/g, '\\\\$&')}':`);
      if (!pattern.test(content)) missing.push(key);
    }
    assert.equal(
      missing.length,
      0,
      `helpers-generator.ts is missing ${missing.length} expected handler key(s): ` +
        `${missing.join(', ')}\n\nADR-0211 source-side fix defines 14 keys; ` +
        `if any are removed, the wired settings.json hooks lose their handler.`,
    );
  });

  it('if bundled-static directory exists, generator-overlapping files match generator keys', () => {
    if (!existsSync(BUNDLED_HELPERS_DIR)) {
      // Expected post-ADR-0235 Option B. Skip per-file parity (no bundled
      // tree to compare); the first assertion already locks the invariant.
      return;
    }
    // Conservative-fallback path: bundled directory retained. Each overlap
    // file MUST have generator-equivalent handler key coverage. The check
    // is structural (key presence) — byte equality is impractical because
    // the generator emits template literals with build-time interpolations.
    const overlaps = ['hook-handler.mjs'];
    const missing = [];
    for (const file of overlaps) {
      const bundled = join(BUNDLED_HELPERS_DIR, file);
      if (!existsSync(bundled)) continue;
      const content = readFileSync(bundled, 'utf8');
      for (const key of EXPECTED_HANDLER_KEYS) {
        const pattern = new RegExp(`'${key.replace(/[.*+?^${}()|[\\\]\\\\]/g, '\\\\$&')}':`);
        if (!pattern.test(content)) missing.push({ file, key });
      }
    }
    assert.equal(
      missing.length,
      0,
      `Bundled-static helpers diverge from generator. Missing keys:\n` +
        missing.map((m) => `  ${m.file}: ${m.key}`).join('\n') +
        `\n\nIf the bundled-static layer is retained (conservative-fallback ` +
        `per ADR-0235 §Decision item 2), each overlap file MUST be regenerated ` +
        `from helpers-generator.ts in the same commit.`,
    );
  });

  // ────────────────────────────────────────────────────────────────────────
  // Post-Batch-5 second-pass remediation: the 4 grep invariants that the
  // release-pipeline acceptance checks enforce on init'd projects. The
  // checks live in:
  //   - lib/acceptance-init-checks.sh:check_init_helper_syntax (literal
  //     `grep -qE 'import|export'` against .mjs helpers)
  //   - lib/acceptance-adr0074-checks.sh:check_adr0074_eviction_cap
  //     (`grep -q 'MAX_STORE_ENTRIES.*=.*1000'`)
  //   - lib/acceptance-adr0074-checks.sh:check_adr0074_consolidate_evicts
  //     (`grep -q 'evicted'` AND `grep -q 'EVICTION_AGE_MS'`)
  //   - lib/acceptance-adr0080-checks.sh:check_adr0080_store_cap (matches
  //     MAX_STORE_ENTRIES = 1000 in init'd intelligence.cjs)
  //
  // These four assertions promote those runtime greps to build-time
  // assertions against the generator source — drift fails the test, not
  // the slow release pipeline. ADR-0235 §Confirmation #1 was about
  // handler-key parity; this block is the analogous gate for the four
  // ADR-0074 / ADR-0080 invariants that have to ship through the same
  // generator-as-sole-source-of-truth path.
  it('generator emits hook-handler.mjs as ESM (top-level import or export)', () => {
    assert.ok(
      existsSync(HELPERS_GENERATOR),
      `Generator source file not found: ${HELPERS_GENERATOR}`,
    );
    const content = readFileSync(HELPERS_GENERATOR, 'utf8');
    // Locate the generateHookHandler() body — bounded by its opening line
    // and the next exported function declaration so the assertion does not
    // leak across into adjacent generators.
    const hookHandlerStart = content.indexOf('export function generateHookHandler()');
    assert.ok(
      hookHandlerStart > -1,
      'generateHookHandler() function not found in helpers-generator.ts',
    );
    const nextExportStart = content.indexOf('export function ', hookHandlerStart + 1);
    const hookHandlerBody = content.slice(
      hookHandlerStart,
      nextExportStart > -1 ? nextExportStart : content.length,
    );
    // The emitted file content lives inside an array of string lines that
    // gets joined with '\n'. Search for the literal ESM tokens in the
    // emitted code (the string literals can be either double- or single-
    // quoted in the TS source).
    const hasImportLiteral = /["']\s*import\s/m.test(hookHandlerBody);
    assert.ok(
      hasImportLiteral,
      'generateHookHandler() must emit at least one top-level `import` statement ' +
        '(check_init_helper_syntax greps `import|export` in .mjs helpers; require() ' +
        'in a .mjs file is a runtime error under Node ESM)',
    );
    // Stricter: no top-level bare `require()` calls emitted at module
    // scope (those would crash at runtime under Node ESM). Each string
    // literal in this generator holds one emitted file line, with leading
    // whitespace inside the quote when the emitted code is nested in a
    // function body. Top-level lines have NO leading whitespace inside
    // the quotes (e.g. `'const path = ...'`). Match only those — nested
    // `require(modulePath)` inside the safeRequire() helper is legal
    // because it binds to createRequire(import.meta.url).
    const hasTopLevelRequire = /["']const\s+\w+\s*=\s*require\(/.test(hookHandlerBody);
    assert.ok(
      !hasTopLevelRequire,
      'generateHookHandler() emits a top-level `const X = require(...)` line. ' +
        'That is a runtime `ReferenceError: require is not defined` in an ESM ' +
        '(.mjs) module — use createRequire(import.meta.url) inside a helper ' +
        'function or convert to a top-level import.',
    );
  });

  it('generator emits intelligence.cjs with MAX_STORE_ENTRIES = 1000 (ADR-0080 P2 cap)', () => {
    const content = readFileSync(HELPERS_GENERATOR, 'utf8');
    const intelStart = content.indexOf('export function generateIntelligenceStub()');
    assert.ok(
      intelStart > -1,
      'generateIntelligenceStub() function not found in helpers-generator.ts',
    );
    const nextExportStart = content.indexOf('export function ', intelStart + 1);
    const intelBody = content.slice(
      intelStart,
      nextExportStart > -1 ? nextExportStart : content.length,
    );
    assert.ok(
      intelBody.includes('MAX_STORE_ENTRIES = 1000'),
      'generateIntelligenceStub() must emit `MAX_STORE_ENTRIES = 1000` ' +
        '(ADR-0080 P2 cap; check_adr0074_eviction_cap + check_adr0080_store_cap ' +
        'grep this literal in the init\'d intelligence.cjs)',
    );
  });

  it('generator emits intelligence.cjs with EVICTION_AGE_MS constant (30-day predicate)', () => {
    const content = readFileSync(HELPERS_GENERATOR, 'utf8');
    const intelStart = content.indexOf('export function generateIntelligenceStub()');
    const nextExportStart = content.indexOf('export function ', intelStart + 1);
    const intelBody = content.slice(
      intelStart,
      nextExportStart > -1 ? nextExportStart : content.length,
    );
    assert.ok(
      intelBody.includes('EVICTION_AGE_MS'),
      'generateIntelligenceStub() must emit `EVICTION_AGE_MS` constant ' +
        '(ADR-0074 Phase 3 age-based eviction predicate; ' +
        'check_adr0074_consolidate_evicts greps this literal)',
    );
  });

  it('generator emits intelligence.cjs consolidate() with evicted in return', () => {
    const content = readFileSync(HELPERS_GENERATOR, 'utf8');
    const intelStart = content.indexOf('export function generateIntelligenceStub()');
    const nextExportStart = content.indexOf('export function ', intelStart + 1);
    const intelBody = content.slice(
      intelStart,
      nextExportStart > -1 ? nextExportStart : content.length,
    );
    // Locate the consolidate function's emitted body (string-literal array
    // entries between "consolidate: function()" and the next member key).
    // The actual return statement contains `evicted` as a tracked key.
    const consolidateStart = intelBody.indexOf("'  consolidate: function()");
    assert.ok(
      consolidateStart > -1,
      'consolidate: function() not found in generateIntelligenceStub() body',
    );
    // The return ships at the end of consolidate before the closing brace.
    // The grep contract is: `evicted` must appear in the emitted
    // intelligence.cjs. The cleanest place is the return object — that's
    // what check_adr0074_consolidate_evicts ultimately reads. Confirm both
    // the substring is present AND it's wired into a return statement.
    const consolidateEnd = intelBody.indexOf("'  },'", consolidateStart);
    const consolidateBody = intelBody.slice(
      consolidateStart,
      consolidateEnd > -1 ? consolidateEnd : intelBody.length,
    );
    assert.ok(
      consolidateBody.includes('evicted'),
      'consolidate() must reference `evicted` (ADR-0074 Phase 3 eviction count; ' +
        'check_adr0074_consolidate_evicts greps this literal in init\'d intelligence.cjs)',
    );
    // Stricter check: it should be in the return statement (so the value
    // is observable to callers), not just a stray comment.
    assert.ok(
      /return\s+\{[^}]*evicted/s.test(consolidateBody),
      'consolidate() must return `evicted` count in its result object ' +
        '(callers including the hook handler read the result; if `evicted` is ' +
        'only commented, callers cannot observe eviction)',
    );
  });
});
