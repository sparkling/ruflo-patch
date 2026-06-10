// @tier pipeline
// ADR-0235 — Init helpers generator-vs-bundled parity invariant.
// ADR-0312 — Hook-side CJS helpers MUST be emitted as .cjs (not .js), and the
//            hook-handler loader MUST resolve them by .cjs with a legacy .js
//            fallback. Under a "type":"module" project a .js name is parsed as
//            ESM and the module.exports CJS helper loads as an empty namespace
//            (or throws), nulling the router → the hook prints "Router not
//            available". The .cjs extension states the module system explicitly,
//            immune to package.json "type" at any directory depth.
//
// Asserts the structural invariants that close F-12-001 / F-12-003 (ADR-0235)
// AND the ADR-0312 .cjs emission/resolution:
//
//   (1) The bundled-static directory at
//       forks/ruflo/v3/@claude-flow/cli/.claude/helpers/ has been deleted
//       (Option B per ADR-0235). Any reintroduction trips the test.
//   (2) helpers-generator.ts:generateHookHandler() defines the 14 handler
//       keys expected post-ADR-0211. Drift in either direction trips it.
//   (3) IF a future commit DOES re-add the bundled dir, each generator-
//       overlapping bundled file must match the generator's handler keys.
//   (4) ADR-0312: BOTH emission maps (executor.writeHelpers + generator
//       generateHelpers) emit router/session/memory as `.cjs`, NOT `.js`;
//       the generateHookHandler() loader resolves them via the .cjs-first
//       resolveHelper() and emits NO `'router.js'`/`'session.js'`/`'memory.js'`
//       literal (the pre-ADR-0312 createRequire-blessed shape).
//
// FAIL LOUD — there is NO UPDATE_GOLDEN-style escape hatch.
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
const EXECUTOR = join(CLI_PKG, 'src', 'init', 'executor.ts');

// 14 handler keys from helpers-generator.ts:generateHookHandler(), per
// ADR-0211 / ADR-0235 §Pre-flight Check 3.
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
      const pattern = new RegExp(`'${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}':`);
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
      return;
    }
    const overlaps = ['hook-handler.mjs'];
    const missing = [];
    for (const file of overlaps) {
      const bundled = join(BUNDLED_HELPERS_DIR, file);
      if (!existsSync(bundled)) continue;
      const content = readFileSync(bundled, 'utf8');
      for (const key of EXPECTED_HANDLER_KEYS) {
        const pattern = new RegExp(`'${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}':`);
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

  it('generator emits hook-handler.mjs as ESM (top-level import or export)', () => {
    const content = readFileSync(HELPERS_GENERATOR, 'utf8');
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
    const hasImportLiteral = /["']\s*import\s/m.test(hookHandlerBody);
    assert.ok(
      hasImportLiteral,
      'generateHookHandler() must emit at least one top-level `import` statement ' +
        '(check_init_helper_syntax greps `import|export` in .mjs helpers; require() ' +
        'in a .mjs file is a runtime error under Node ESM)',
    );
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
    const consolidateStart = intelBody.indexOf("'  consolidate: function()");
    assert.ok(
      consolidateStart > -1,
      'consolidate: function() not found in generateIntelligenceStub() body',
    );
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
    assert.ok(
      /return\s+\{[^}]*evicted/s.test(consolidateBody),
      'consolidate() must return `evicted` count in its result object ' +
        '(callers including the hook handler read the result; if `evicted` is ' +
        'only commented, callers cannot observe eviction)',
    );
  });
});

// ──────────────────────────────────────────────────────────────────────────
// ADR-0312 — CJS helpers emitted as .cjs; loader resolves .cjs-first.
// Replaces the pre-ADR-0312 assertion family that blessed createRequire as the
// fix: under "type":"module" Node resolves a .js file by the nearest
// package.json "type" regardless of the requiring module's scope, so neither
// createRequire nor a .cjs *dispatcher* rescues a .js *helper* — only the .cjs
// extension on the helper itself does. (See ADR-0312 §Decision Outcome /
// Amendment 2026-06-10; the throw is real on Node 24 in FILE-based ESM.)
// ──────────────────────────────────────────────────────────────────────────
describe('ADR-0312 — hook-side CJS helpers emit as .cjs, loader resolves .cjs-first', { skip }, () => {
  const HELPER_BASES = ['router', 'session', 'memory'];

  it('executor.writeHelpers emits router/session/memory as .cjs (not .js)', () => {
    const content = readFileSync(EXECUTOR, 'utf8');
    for (const base of HELPER_BASES) {
      assert.ok(
        new RegExp(`'${base}\\.cjs':`).test(content),
        `executor.ts writeHelpers must emit '${base}.cjs' (ADR-0312). ` +
          `A '.js' key is parsed as ESM under "type":"module" and the ` +
          `module.exports CJS helper fails to load → "Router not available".`,
      );
      assert.ok(
        !new RegExp(`'${base}\\.js':`).test(content),
        `executor.ts still emits the legacy '${base}.js' key — ADR-0312 renames ` +
          `it to '${base}.cjs'. Leaving the .js key re-introduces the bug.`,
      );
    }
  });

  it('generator.generateHelpers emits router/session/memory as .cjs (not .js)', () => {
    const content = readFileSync(HELPERS_GENERATOR, 'utf8');
    for (const base of HELPER_BASES) {
      assert.ok(
        new RegExp(`helpers\\['${base}\\.cjs'\\]`).test(content),
        `helpers-generator.ts generateHelpers must set helpers['${base}.cjs'] (ADR-0312).`,
      );
      assert.ok(
        !new RegExp(`helpers\\['${base}\\.js'\\]`).test(content),
        `helpers-generator.ts still sets helpers['${base}.js'] — ADR-0312 renames ` +
          `it to '${base}.cjs'.`,
      );
    }
  });

  it('generateHookHandler() loader resolves helpers .cjs-first and emits no bare .js helper literal', () => {
    const content = readFileSync(HELPERS_GENERATOR, 'utf8');
    const start = content.indexOf('export function generateHookHandler()');
    assert.ok(start > -1, 'generateHookHandler() not found');
    const next = content.indexOf('export function ', start + 1);
    const body = content.slice(start, next > -1 ? next : content.length);

    // The loader must use a .cjs-preferring resolver for the three CJS helpers.
    assert.ok(
      /resolveHelper\(/.test(body) && /\+\s*'\.cjs'/.test(body),
      'generateHookHandler() must emit a resolveHelper() that prefers `.cjs` ' +
        "(then falls back to legacy `.js`) for router/session/memory (ADR-0312).",
    );
    // It must NOT load any of the three by a hard-coded `.js` name — that is the
    // pre-ADR-0312 shape the createRequire-blessing test wrongly endorsed.
    for (const base of HELPER_BASES) {
      assert.ok(
        !new RegExp(`'${base}\\.js'`).test(body),
        `generateHookHandler() still references '${base}.js' literally — must go ` +
          `through resolveHelper('${base}') so .cjs is preferred (ADR-0312). ` +
          `createRequire/.js does NOT cure "type":"module" (Node resolves by the ` +
          `nearest package.json type, not the requiring module's scope).`,
      );
    }
    // intelligence.cjs stays a direct .cjs path (already correct) — sanity.
    assert.ok(
      /'intelligence\.cjs'/.test(body),
      'generateHookHandler() must still load intelligence.cjs directly (.cjs).',
    );
  });
});
