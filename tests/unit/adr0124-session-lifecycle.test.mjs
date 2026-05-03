// @tier unit
// ADR-0124 (T6) — Hive-mind session lifecycle (checkpoint / resume /
// export / import). Static-surface assertions on the fork source +
// acceptance lib + runner wiring. Behavioural tests live in-fork at
// /Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/__tests__/hive-mind-session.test.ts
// and mcp-tools-deep.test.ts (T6 block).
//
// Sibling: lib/acceptance-adr0124-sessions.sh

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-adr0124-sessions.sh');
const RUNNER_FILE = resolve(ROOT, 'scripts', 'test-acceptance.sh');

const FORK_ROOT = '/Users/henrik/source/forks/ruflo';
const FORK_SESSION_SRC = `${FORK_ROOT}/v3/@claude-flow/cli/src/commands/hive-mind-session.ts`;
const FORK_HIVE_CMD = `${FORK_ROOT}/v3/@claude-flow/cli/src/commands/hive-mind.ts`;
const FORK_HIVE_TOOLS = `${FORK_ROOT}/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts`;
const FORK_DEEP_TEST = `${FORK_ROOT}/v3/@claude-flow/cli/__tests__/mcp-tools-deep.test.ts`;
const FORK_SESSION_TEST = `${FORK_ROOT}/v3/@claude-flow/cli/__tests__/hive-mind-session.test.ts`;

const CHECK_FN_NAMES = [
  'check_adr0124_sessions_list',
  'check_adr0124_sessions_checkpoint',
  'check_adr0124_sessions_export_import_roundtrip',
  'check_adr0124_resume',
  'check_adr0124_queen_type_persistence',
  'check_adr0124_status_surfaces_queen_type',
];

// ── 1. Acceptance lib structure ─────────────────────────────────────────────

describe('ADR-0124 acceptance check lib — static structure', () => {
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

  it('uses _cli_cmd helper (per reference-cli-cmd-helper)', () => {
    assert.match(
      lib,
      /_cli_cmd/,
      'lib must use $(_cli_cmd) helper, not raw `npx @sparkleideas/cli@latest`',
    );
  });

  it('uses _e2e_isolate for per-check isolation', () => {
    assert.match(lib, /_e2e_isolate/, 'lib must use _e2e_isolate for parallel safety');
  });
});

// ── 2. Source-level surface assertions on the fork ──────────────────────────

describe('ADR-0124 fork source — hive-mind-session.ts surface', () => {
  const src = existsSync(FORK_SESSION_SRC) ? readFileSync(FORK_SESSION_SRC, 'utf8') : '';

  it('hive-mind-session.ts exists in fork', () => {
    assert.ok(existsSync(FORK_SESSION_SRC), `Expected ${FORK_SESSION_SRC} to exist`);
  });

  it('exports SESSION_ARCHIVE_SCHEMA_VERSION constant pinned to 1', () => {
    assert.match(src, /export const SESSION_ARCHIVE_SCHEMA_VERSION\s*=\s*1\b/);
  });

  it('exports the four error classes for distinct failure modes', () => {
    for (const cls of [
      'SessionArchiveSchemaMismatchError',
      'SessionArchiveCorruptError',
      'SessionArchiveMissingError',
      'QueenSpawnabilityProbeError',
    ]) {
      assert.match(src, new RegExp(`export class ${cls}`), `${cls} must be exported`);
    }
  });

  for (const fn of [
    'encodeArchive',
    'decodeArchive',
    'buildArchiveFilename',
    'parseArchiveFilename',
    'listSessionArchives',
    'locateLatestArchive',
    'collectHiveStateSnapshot',
    'writeArchiveAtomic',
    'checkpointSession',
    'exportSessionToPath',
    'importSessionFromPath',
    'readArchiveFromPath',
    'probeQueenSpawnability',
    'resumeSession',
  ]) {
    it(`exports ${fn}()`, () => {
      assert.match(
        src,
        new RegExp(`export (?:async )?function ${fn}\\b`),
        `${fn} must be exported as a function`,
      );
    });
  }

  it('exports sessionsCommand and resumeCommand for CLI dispatch', () => {
    assert.match(src, /export const sessionsCommand\s*:/);
    assert.match(src, /export const resumeCommand\s*:/);
  });

  it('schemaVersion mismatch error carries the §Consequences exact-string contract', () => {
    // The §Consequences error MUST mention "schemaVersion" + "not supported"
    // + "expected 1" + suggest export/import workflow.
    assert.match(src, /schemaVersion.*not supported by this build/);
    assert.match(src, /expected.*SESSION_ARCHIVE_SCHEMA_VERSION/);
    assert.match(src, /sessions export/);
    assert.match(src, /sessions import/);
  });

  it('queenPrompt absence throws (no silent default per feedback-no-fallbacks)', () => {
    assert.match(src, /queenPrompt absent/);
  });

  it('probeQueenSpawnability uses execSync(which claude) — same as spawn flow', () => {
    assert.match(src, /execSync\(\s*['"`]which claude['"`]/);
  });

  it('resume re-spawns via child_process.spawn (claude CLI, not API key)', () => {
    // Per `feedback-no-api-keys.md` and `reference-ruflo-architecture`.
    assert.match(src, /childSpawn\s*\(\s*['"`]claude['"`]/);
    assert.match(src, /--continuation/);
  });

  it('resume restores queenType onto state.queen.queenType (H6 row 32 fold-in)', () => {
    assert.match(src, /restored\.queen\.queenType\s*=\s*archive\.queenType/);
  });

  it('checkpoint sequence is atomic via tmp-then-rename', () => {
    assert.match(src, /\.tmp\./);
    assert.match(src, /renameSync/);
  });

  it('archives use gzip compression (not raw JSON)', () => {
    assert.match(src, /gzipSync/);
    assert.match(src, /gunzipSync/);
  });
});

// ── 3. Source-level assertions on hive-mind.ts wiring ───────────────────────

describe('ADR-0124 fork source — hive-mind.ts subcommand wiring', () => {
  const src = existsSync(FORK_HIVE_CMD) ? readFileSync(FORK_HIVE_CMD, 'utf8') : '';

  it('hive-mind.ts imports sessionsCommand + resumeCommand', () => {
    assert.match(src, /import\s*\{[\s\S]*?sessionsCommand[\s\S]*?resumeCommand[\s\S]*?\}\s*from\s*['"]\.\/hive-mind-session/);
  });

  it('hive-mind.ts wires sessionsCommand + resumeCommand into subcommands array', () => {
    // The subcommands array must include both. They live in a multiline
    // array literal so we just look for the entries themselves.
    assert.match(src, /sessionsCommand,?/);
    assert.match(src, /resumeCommand,?/);
  });

  it('hive-mind.ts persists queenPrompt + workerManifest into typed memory at spawn', () => {
    assert.match(src, /SESSION_QUEEN_PROMPT_MEMORY_KEY/);
    assert.match(src, /SESSION_WORKER_MANIFEST_MEMORY_KEY/);
  });

  it('hive-mind init forwards --queen-type to hive-mind_init MCP tool (H6 row 32)', () => {
    // The init action wraps validateQueenType + forwards as part of the
    // config object passed to hive-mind_init.
    assert.match(src, /validateQueenType/);
    assert.match(src, /config\.queenType\s*=\s*initQueenType/);
  });
});

// ── 4. Source-level assertions on hive-mind-tools.ts (queenType persistence) ─

describe('ADR-0124 fork source — hive-mind-tools.ts queenType persistence', () => {
  const src = existsSync(FORK_HIVE_TOOLS) ? readFileSync(FORK_HIVE_TOOLS, 'utf8') : '';

  it('HiveQueenRecord interface has queenType field', () => {
    assert.match(src, /export interface HiveQueenRecord/);
    assert.match(src, /queenType\?\s*:\s*HiveQueenType/);
  });

  it('hive-mind_init schema declares queenType as enum with three values', () => {
    assert.match(
      src,
      /queenType\s*:\s*\{\s*type:\s*['"]string['"]\s*,\s*enum:\s*\[\s*['"]strategic['"]\s*,\s*['"]tactical['"]\s*,\s*['"]adaptive['"]/,
    );
  });

  it('hive-mind_init throws on unknown queenType (no silent default)', () => {
    assert.match(src, /isHiveQueenType\(rawQueenType\)/);
    assert.match(src, /queenType must be one of/);
  });

  it('hive-mind_status surfaces state.queen.queenType in response', () => {
    assert.match(src, /state\.queen\.queenType/);
    // Spread-conditional inclusion ensures undefined queenType is omitted.
    assert.match(
      src,
      /\.\.\.\s*\(\s*state\.queen\.queenType\s*!==\s*undefined/,
    );
  });

  it('exports getHiveSessionsDir + ensureHiveSessionsDir for the session module', () => {
    assert.match(src, /export function getHiveSessionsDir/);
    assert.match(src, /export function ensureHiveSessionsDir/);
  });

  it('exports loadHiveState/saveHiveState/withHiveStoreLock for the session module', () => {
    assert.match(src, /export function loadHiveState/);
    assert.match(src, /export function saveHiveState/);
    assert.match(src, /export async function withHiveStoreLock/);
  });
});

// ── 5. Test wiring (in-fork test files exist + carry T6 cases) ──────────────

describe('ADR-0124 in-fork test coverage', () => {
  it('mcp-tools-deep.test.ts carries an ADR-0124 (T6) describe block', () => {
    const src = existsSync(FORK_DEEP_TEST) ? readFileSync(FORK_DEEP_TEST, 'utf8') : '';
    assert.match(src, /describe\(['"`]ADR-0124 \(T6\)/);
  });

  it('hive-mind-session.test.ts exists in fork __tests__', () => {
    assert.ok(
      existsSync(FORK_SESSION_TEST),
      `Expected ${FORK_SESSION_TEST} to exist`,
    );
  });

  it('hive-mind-session.test.ts exercises round-trip checkpoint/resume', () => {
    const src = existsSync(FORK_SESSION_TEST) ? readFileSync(FORK_SESSION_TEST, 'utf8') : '';
    assert.match(src, /resumeSession/);
    assert.match(src, /checkpointSession/);
    assert.match(src, /exportSessionToPath/);
    assert.match(src, /importSessionFromPath/);
  });

  it('hive-mind-session.test.ts asserts queenType round-trip (H6 row 32)', () => {
    const src = existsSync(FORK_SESSION_TEST) ? readFileSync(FORK_SESSION_TEST, 'utf8') : '';
    assert.match(src, /queenType.*tactical/);
    assert.match(src, /queenType.*adaptive/);
  });

  it('hive-mind-session.test.ts covers spawnability-probe-before-mutation (ADR-0124 §Refinement)', () => {
    const src = existsSync(FORK_SESSION_TEST) ? readFileSync(FORK_SESSION_TEST, 'utf8') : '';
    assert.match(src, /QueenSpawnabilityProbeError/);
    assert.match(src, /BEFORE state mutation/);
  });

  it('hive-mind-session.test.ts asserts resume idempotence (§Refinement edge case)', () => {
    const src = existsSync(FORK_SESSION_TEST) ? readFileSync(FORK_SESSION_TEST, 'utf8') : '';
    assert.match(src, /idempoten/);
    assert.match(src, /fixed point/);
  });
});

// ── 6. Schema-version contract is internal-only (no external commitment) ────

describe('ADR-0124 schema-version contract', () => {
  const src = existsSync(FORK_SESSION_SRC) ? readFileSync(FORK_SESSION_SRC, 'utf8') : '';

  it('schemaVersion is pinned to 1 (no v2 yet — Row 28 deferred)', () => {
    // Per ADR-0124 §Specification: `schemaVersion` MUST be 1 for current
    // fork build. Per Row 28 (DEFER-TO-FOLLOWUP-ADR), no migration tool
    // ships until v2 is introduced.
    assert.match(src, /SESSION_ARCHIVE_SCHEMA_VERSION\s*=\s*1\b/);
    // Negative assertion: no v2-migration logic exists yet.
    assert.doesNotMatch(src, /schemaVersion === 2/);
    assert.doesNotMatch(src, /migrateV1ToV2/);
  });
});
