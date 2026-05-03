// @tier unit
// ADR-0123 (T5) — Hive-mind LRU cache + RVF-compatible WAL stack.
//
// Sibling: lib/acceptance-adr0123-checks.sh
//
// Two layers per ADR-0097 / ADR-0123 §Validation:
//
//  1. Static lib + runner-wiring assertions (Tier-Y rule)
//  2. Source-level surface assertions on the fork's hive-mind-tools.ts:
//       - HIVE_STATE_DOC_KEY constant exists
//       - HiveLRU class with get/set/delete/clear/stats methods
//       - getCacheCapacity reads CLAUDE_FLOW_HIVE_CACHE_MAX env var
//       - saveHiveState uses fsyncSync (ADR-0095 d11 / RVF-compatible)
//       - loadHiveState has no silent `catch {}` returning default state
//       - migrateSharedMemoryShape helper exists
//       - getHiveCacheStats / invalidateHiveCache / _resetHiveCacheForTest exports
//
// Behavioural tests live IN-FORK at
// /Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/__tests__/mcp-tools-deep.test.ts
// (the test file imports the source directly and exercises the cache).

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-adr0123-checks.sh');
const RUNNER_FILE = resolve(ROOT, 'scripts', 'test-acceptance.sh');

// Source files in the live fork — used for source-level surface assertions
// that don't depend on a compiled build.
const FORK_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts';

const CHECK_FN_NAMES = [
  'check_adr0123_concurrent_write_durability',
  'check_adr0123_sigkill_crash_durability',
  'check_adr0123_loadstate_no_silent_catch',
  'check_adr0123_lru_cache_observable',
];

const RUNNER_PARALLEL_CHECK_IDS = [
  'adr0123-conc-write',
  'adr0123-no-silent-catch',
  'adr0123-cache-observable',
];

const RUNNER_SEQUENTIAL_CHECK_ID = 'adr0123-sigkill';

// ── 1. Static assertions on the check lib + runner wiring ───────────────

describe('ADR-0123 acceptance check lib — static structure', () => {
  const lib = existsSync(CHECK_FILE) ? readFileSync(CHECK_FILE, 'utf8') : '';

  it('lib file exists', () => {
    assert.ok(existsSync(CHECK_FILE), `Expected ${CHECK_FILE} to exist`);
  });

  for (const fn of CHECK_FN_NAMES) {
    it(`defines ${fn}()`, () => {
      assert.match(
        lib,
        new RegExp(`^${fn}\\s*\\(\\)\\s*\\{`, 'm'),
        `${fn}() not found in ${CHECK_FILE}`,
      );
    });
  }

  it('every check sets _CHECK_PASSED and _CHECK_OUTPUT', () => {
    const passedCount = (lib.match(/_CHECK_PASSED=/g) || []).length;
    const outputCount = (lib.match(/_CHECK_OUTPUT=/g) || []).length;
    assert.ok(
      passedCount >= CHECK_FN_NAMES.length,
      `Expected >=${CHECK_FN_NAMES.length} _CHECK_PASSED= assignments, found ${passedCount}`,
    );
    assert.ok(
      outputCount >= CHECK_FN_NAMES.length,
      `Expected >=${CHECK_FN_NAMES.length} _CHECK_OUTPUT= assignments, found ${outputCount}`,
    );
  });

  it('concurrent-write check enforces 100% bar (no 99% acceptable)', () => {
    // The check explicitly invokes feedback-data-loss-zero-tolerance language
    // when reporting failure. Future regressions weakening to "99% pass"
    // would remove this language.
    assert.match(
      lib,
      /feedback-data-loss-zero-tolerance/,
      'check_adr0123_concurrent_write_durability must reference feedback-data-loss-zero-tolerance bar',
    );
    assert.match(
      lib,
      /100%/,
      'check_adr0123_concurrent_write_durability must enforce a 100% bar in messages',
    );
  });

  it('SIGKILL check is scoped to without-power-loss (H3 triage row 23)', () => {
    // Per ADR-0118 review-notes-triage 2026-05-02, H3 chose option (i):
    // SIGKILL-only for T5; true power-loss durability is split into ADR-0130.
    // The acceptance check messages must reflect this scope.
    assert.match(
      lib,
      /SIGKILL/,
      'check_adr0123_sigkill_crash_durability must explicitly cover SIGKILL',
    );
    assert.match(
      lib,
      /without[- ]power[- ]loss|page cache/i,
      'SIGKILL check must describe without-power-loss / page-cache scope',
    );
  });

  it('no-silent-catch check forbids exit=0 with no error in output', () => {
    // The check guards against a regression where the silent `catch {}`
    // is reintroduced. The assertion here is on the negative branch
    // language ("silent fallback").
    assert.match(
      lib,
      /silent fallback/,
      'check_adr0123_loadstate_no_silent_catch must explicitly reject silent fallback',
    );
  });
});

describe('ADR-0123 acceptance check lib — runner wiring', () => {
  const runner = existsSync(RUNNER_FILE) ? readFileSync(RUNNER_FILE, 'utf8') : '';

  it('runner sources adr0123 lib', () => {
    assert.match(
      runner,
      /adr0123_lib=.*acceptance-adr0123-checks\.sh/,
      `${RUNNER_FILE} must source acceptance-adr0123-checks.sh`,
    );
    assert.match(
      runner,
      /\[\[\s*-f\s+"\$adr0123_lib"\s*\]\]\s*&&\s*source\s+"\$adr0123_lib"/,
      'runner must conditionally source adr0123_lib',
    );
  });

  for (const id of RUNNER_PARALLEL_CHECK_IDS) {
    it(`runner registers parallel check ${id} via run_check_bg`, () => {
      assert.match(
        runner,
        new RegExp(`run_check_bg\\s+"${id.replace(/[-]/g, '\\-')}"`, 'm'),
        `${id} must be wired into the parallel wave via run_check_bg`,
      );
    });
  }

  it(`runner registers sequential SIGKILL check ${RUNNER_SEQUENTIAL_CHECK_ID} via run_check`, () => {
    // SIGKILL must be sequential (post-parallel) — kills processes, must not
    // race other checks. The ADR-0123 §Validation section explicitly requires
    // this scheduling.
    assert.match(
      runner,
      new RegExp(`run_check\\s+"${RUNNER_SEQUENTIAL_CHECK_ID}"`, 'm'),
      `${RUNNER_SEQUENTIAL_CHECK_ID} must be wired sequentially via run_check (not run_check_bg)`,
    );
  });

  it('runner builds _adr0123_specs array for collect_parallel', () => {
    assert.match(
      runner,
      /_adr0123_specs=\(\)/,
      'runner must declare _adr0123_specs array',
    );
    assert.match(
      runner,
      /"\$\{_adr0123_specs\[@\]\}"/,
      'runner must include _adr0123_specs[@] in collect_parallel "all" call',
    );
  });
});

// ── 2. Source-level surface assertions on the fork ──────────────────────

describe('ADR-0123 fork source — LRU cache + WAL stack', () => {
  const src = existsSync(FORK_SRC) ? readFileSync(FORK_SRC, 'utf8') : '';

  it('fork source file exists', () => {
    assert.ok(existsSync(FORK_SRC), `Expected ${FORK_SRC} to exist`);
  });

  it('declares HIVE_STATE_DOC_KEY constant', () => {
    assert.match(
      src,
      /const\s+HIVE_STATE_DOC_KEY\s*=/,
      'HIVE_STATE_DOC_KEY constant must be declared',
    );
  });

  it('declares HiveLRU class with get/set/delete/stats methods', () => {
    assert.match(src, /class\s+HiveLRU/, 'HiveLRU class must exist');
    assert.match(src, /HiveLRU[\s\S]+?get\(/, 'HiveLRU.get method must exist');
    assert.match(src, /HiveLRU[\s\S]+?set\(/, 'HiveLRU.set method must exist');
    assert.match(src, /HiveLRU[\s\S]+?delete\(/, 'HiveLRU.delete method must exist');
    assert.match(src, /HiveLRU[\s\S]+?stats\(/, 'HiveLRU.stats method must exist');
  });

  it('reads CLAUDE_FLOW_HIVE_CACHE_MAX env var (NOT RUFLO_*)', () => {
    // Per ADR-0118 review-notes-triage row 19: CLAUDE_FLOW_* is the runtime
    // convention; RUFLO_* is appliance-only.
    assert.match(
      src,
      /process\.env\.CLAUDE_FLOW_HIVE_CACHE_MAX/,
      'cache capacity must read process.env.CLAUDE_FLOW_HIVE_CACHE_MAX',
    );
    assert.doesNotMatch(
      src,
      /RUFLO_HIVE_CACHE_MAX/,
      'must NOT use RUFLO_ prefix per ADR-0118 row 19',
    );
  });

  it('saveHiveState uses fsyncSync (ADR-0095 d11 / RVF-compatible WAL)', () => {
    // Per ADR-0123 §73 (Decision Outcome): "100% durability is delivered by
    // RVF's existing primitives — explicit fsync of the tmp file before
    // rename (line 2513, ADR-0095 d11)". The hive store must adopt the
    // same primitive: fsync the tmp BEFORE rename.
    assert.match(src, /fsyncSync/, 'must call fsyncSync to flush page cache before rename');
    // Surface check that the fsync is in the saveHiveState region.
    const saveBlock = src.match(/function\s+saveHiveState[^]*?\n}/);
    assert.ok(saveBlock, 'saveHiveState function must be findable');
    assert.match(
      saveBlock[0],
      /fsyncSync/,
      'saveHiveState body must contain fsyncSync (ADR-0095 d11 pattern)',
    );
    assert.match(
      saveBlock[0],
      /renameSync/,
      'saveHiveState body must contain renameSync (atomic rename)',
    );
  });

  it('loadHiveState has NO silent catch returning default state (Phase 5)', () => {
    // The pre-T5 silent-catch pattern was:
    //   try { ... return parsed; } catch { /* return default */ }
    // Phase 5 removed this. The function may still contain `try`/`catch`
    // for legitimate uses, but MUST NOT swallow the error and return the
    // default state.
    const loadBlock = src.match(/function\s+loadHiveState[^]*?\nfunction\s/);
    assert.ok(loadBlock, 'loadHiveState function must be findable');
    // The pre-T5 comment was "// Return default state on error" inside catch.
    assert.doesNotMatch(
      loadBlock[0],
      /catch\s*\{\s*\/\/\s*Return default state on error/,
      'loadHiveState must NOT contain the pre-T5 silent catch returning default',
    );
    assert.doesNotMatch(
      loadBlock[0],
      /catch\s*\{\s*\}/,
      'loadHiveState must NOT contain bare `catch {}` blocks (feedback-no-fallbacks)',
    );
  });

  it('exports getHiveCacheStats / invalidateHiveCache / _resetHiveCacheForTest', () => {
    assert.match(src, /export\s+function\s+getHiveCacheStats/, 'getHiveCacheStats export missing');
    assert.match(src, /export\s+function\s+invalidateHiveCache/, 'invalidateHiveCache export missing');
    assert.match(src, /export\s+function\s+_resetHiveCacheForTest/, '_resetHiveCacheForTest export missing');
  });

  it('migrates legacy raw values to typed system/permanent shape (Row 17 / T4 contract)', () => {
    // Per ADR-0118 review-notes-triage row 17: T5's pseudocode was corrected
    // to use the map-iteration tuple, NOT entry.id. T4's MemoryEntry has no
    // `id` field. The migration helper must iterate via Object.entries.
    assert.match(
      src,
      /Object\.entries\(parsed\.sharedMemory\)/,
      'migration must iterate via Object.entries (Row 17 fix — no entry.id)',
    );
    // Migrated legacy entries default to type='system', ttlMs=null.
    assert.match(
      src,
      /type:\s*['"]system['"]/,
      'legacy migration must wrap raw values as type=system',
    );
    assert.match(
      src,
      /ttlMs:\s*null/,
      'legacy migration must default ttlMs=null (permanent)',
    );
  });

  it('cache update ordering documented (Row 22 — DEFER-TO-IMPL choice)', () => {
    // Per ADR-0118 review-notes-triage row 22: cache.set ONLY after RVF
    // (or backing-store) write acknowledges. The current implementation
    // documents this as "Update cache only after the rename succeeds."
    assert.match(
      src,
      /Update cache only after the rename succeeds|cache is updated ONLY after the rename/i,
      'cache update ordering (Row 22) must be documented in code',
    );
  });

  it('references RVF / ADR-0095 d11 durability primitive', () => {
    // The ADR-0123 §73 framing: "we wire onto" RVF's existing primitive
    // rather than invent it. The code must reference ADR-0095 d11 (the
    // canonical fsync-before-rename ADR).
    assert.match(
      src,
      /ADR-0095\s+d11|ADR-0123/,
      'durability comments must trace back to ADR-0095 d11 / ADR-0123',
    );
  });

  it('legacy state.json.legacy migration path exists', () => {
    // Per ADR-0123 §Phase 1: legacy file is renamed (not deleted) for recovery.
    assert.match(
      src,
      /state\.json\.legacy|getLegacyHivePath/,
      'must reference state.json.legacy or a getLegacyHivePath helper',
    );
  });
});
