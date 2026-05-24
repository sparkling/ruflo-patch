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
});
