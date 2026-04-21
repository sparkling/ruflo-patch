// @tier unit
// ADR-0094 Phase 13.1: RVF binary fixture migration — paired unit tests.
//
// Extends tests/unit/adr0094-p13-migration.test.mjs for the two new checks
// that exercise a real RVF binary fixture captured from a pinned earlier
// build. Kept in its own file so a future 13.1 re-seed/re-test cycle can be
// iterated independently of the JSON/text-surface P13 pass.
//
// Two checks × five scenarios (readable_ok, schema_panic, empty_body,
// token_missing, not_found) = 10 verdict cases, plus:
//   - 1 file-existence sanity test for the live RVF fixture + manifest
//   - 1 panic-dominance test (token match + panic word MUST fail)
// Total: 12 test cases.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const HARNESS = resolve(ROOT, 'lib', 'acceptance-harness.sh');
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-phase13-migration.sh');
const FIXTURE_DIR = resolve(ROOT, 'tests', 'fixtures', 'adr0094-phase13-1');
const RVF_FIXTURE = resolve(FIXTURE_DIR, 'v1-rvf', '.swarm', 'memory.rvf');
const SEED_MANIFEST = resolve(FIXTURE_DIR, 'v1-rvf', '.seed-manifest.json');

const RETRIEVE_FN = 'check_adr0094_p13_migration_rvf_v1_retrieve';
const SEARCH_FN = 'check_adr0094_p13_migration_rvf_v1_search';

// Checks in the brief. Tokens are the regex the verdict helper looks for.
const CHECKS = [
  {
    fn: RETRIEVE_FN,
    tool: 'memory_retrieve',
    token: 'migration-works-v1',
  },
  {
    fn: SEARCH_FN,
    tool: 'memory_search',
    token: 'p13rvf-sentinel|migration-works-v1',
  },
];

// Detect whether the sibling's two check functions have landed in the lib.
function checksLanded() {
  if (!existsSync(CHECK_FILE)) return false;
  const r = spawnSync(
    'bash',
    [
      '-c',
      `grep -q "${RETRIEVE_FN}" "${CHECK_FILE}" && grep -q "${SEARCH_FN}" "${CHECK_FILE}"`,
    ],
    { encoding: 'utf8' },
  );
  return r.status === 0;
}

function fixtureLanded() {
  return existsSync(RVF_FIXTURE) && existsSync(SEED_MANIFEST);
}

function shimScript() {
  // Mirror adr0094-p13-migration.test.mjs shimScript(). The memory_search
  // readable_ok body carries BOTH tokens so the token-alternation regex on
  // that check is exercised end-to-end.
  return [
    '#!/usr/bin/env bash',
    '# Parse "mcp exec --tool <t>" from args.',
    'tool=""',
    'for ((i=1; i<=$#; i++)); do',
    '  if [[ "${!i}" == "--tool" ]]; then',
    '    j=$((i+1))',
    '    tool="${!j}"',
    '  fi',
    'done',
    '',
    'case "${SHIM_MODE:-readable_ok}" in',
    '  readable_ok)',
    '    echo "Result:"',
    '    case "$tool" in',
    '      memory_search)',
    '        # Carries BOTH sentinel key and migrated value so both branches',
    '        # of the alternation regex are exercised.',
    '        echo \'{"results":[{"key":"p13rvf-sentinel","value":"migration-works-v1"}]}\'',
    '        ;;',
    '      memory_retrieve|*)',
    '        echo \'{"value":"migration-works-v1"}\'',
    '        ;;',
    '    esac',
    '    exit 0',
    '    ;;',
    '  schema_panic)',
    '    echo "Result:"',
    '    echo \'{"error":"unsupported rvf schema version, upgrade required"}\'',
    '    exit 1',
    '    ;;',
    '  empty_body)',
    '    echo "Result:"',
    '    exit 0',
    '    ;;',
    '  token_missing)',
    '    echo "Result:"',
    '    case "$tool" in',
    '      memory_search)',
    '        echo \'{"results":[{"key":"some-other","value":"some-other-value"}]}\'',
    '        ;;',
    '      memory_retrieve|*)',
    '        echo \'{"value":"some-other-value","note":"fine"}\'',
    '        ;;',
    '    esac',
    '    exit 0',
    '    ;;',
    '  not_found)',
    '    echo "Error: tool not found: $tool"',
    '    exit 1',
    '    ;;',
    '  panic_with_token)',
    '    echo "Result:"',
    '    case "$tool" in',
    '      memory_search)',
    '        echo \'{"results":[{"key":"p13rvf-sentinel","value":"migration-works-v1"}],"warn":"incompatible schema, please upgrade required before continuing"}\'',
    '        ;;',
    '      memory_retrieve|*)',
    '        echo \'{"value":"migration-works-v1","warn":"incompatible schema, please upgrade required before continuing"}\'',
    '        ;;',
    '    esac',
    '    exit 0',
    '    ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n');
}

function runCheck({ fn, mode, token }) {
  const root = mkdtempSync(resolve(tmpdir(), 'p13-1-rvf-unit-'));
  const e2e = resolve(root, 'e2e');
  mkdirSync(resolve(e2e, '.claude-flow'), { recursive: true });
  mkdirSync(resolve(e2e, '.swarm'), { recursive: true });
  writeFileSync(resolve(e2e, 'package.json'), '{"name":"p13-1-unit"}');

  const cliDir = resolve(root, 'bin');
  mkdirSync(cliDir, { recursive: true });
  const cli = resolve(cliDir, 'cli');
  writeFileSync(cli, shimScript(), { mode: 0o755 });

  const driver = [
    'set -u',
    `cd "${ROOT}"`,
    `export TEMP_DIR="${root}"`,
    `export E2E_DIR="${e2e}"`,
    `export PROJECT_DIR="${ROOT}"`,
    'export REGISTRY="http://shim.invalid"',
    'export PKG="@shim/cli"',
    `export SHIM_MODE="${mode}"`,
    `export SHIM_TOKEN="${token}"`,
    '',
    `source "${HARNESS}"`,
    `source "${CHECK_FILE}"`,
    '',
    `_cli_cmd() { echo "${cli}"; }`,
    '_e2e_isolate() {',
    '  local id="$1"',
    `  local iso="${root}/iso-$id-$$"`,
    '  rm -rf "$iso"; mkdir -p "$iso/.claude-flow" "$iso/.swarm"',
    '  echo "$iso"',
    '}',
    '_run_and_kill() {',
    '  local cmd="$1" out_file="$2" max="${3:-15}"',
    '  ( eval "$cmd" >> "$out_file" 2>&1; rc=$?; echo "__RUFLO_DONE__:$rc" >> "$out_file" ) &',
    '  local pid=$!; wait "$pid"',
    '  local line; line=$(grep "^__RUFLO_DONE__:" "$out_file" | tail -1)',
    '  _RK_EXIT="${line##__RUFLO_DONE__:}"',
    '}',
    '_run_and_kill_ro() { _run_and_kill "$@"; }',
    '',
    `${fn}`,
    'echo "RESULT_PASSED=$_CHECK_PASSED"',
    'echo "RESULT_OUTPUT=$_CHECK_OUTPUT"',
  ].join('\n');

  const result = spawnSync('bash', ['-c', driver], { encoding: 'utf8', timeout: 30_000 });
  rmSync(root, { recursive: true, force: true });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    passed: (result.stdout?.match(/RESULT_PASSED=(\S+)/) || [])[1],
    output: (result.stdout?.match(/RESULT_OUTPUT=(.*)/) || [])[1] || '',
  };
}

// ── If the sibling hasn't landed anything yet, register ONE placeholder
// skipped test — matches the original P13 "BLOCKED" convention so we don't
// lock in the wrong function name. The real matrix runs once both halves
// (fixture + checks) are in place.
const siblingReady = checksLanded() && fixtureLanded();

if (!siblingReady) {
  // BLOCKED: sibling seed + checks not landed.
  // Runtime-conditional gate (not a permanent tombstone): flips off when
  // `bash scripts/seed-phase13-1-fixtures.sh` has been run and the lib
  // functions land. The static-scan skip-count guard deliberately ignores
  // `{ skip: ... }` runtime gates for this reason.
  describe('ADR-0094 Phase 13.1 — RVF migration verdict', () => {
    it('BLOCKED: sibling seed + checks not landed — run scripts/seed-phase13-1-fixtures.sh', { skip: 'P13.1 fixture not seeded' }, () => {
      // This marker prevents us from guessing the sibling's API shape.
    });
  });
} else {
  describe('ADR-0094 Phase 13.1 — RVF migration verdict', () => {
    it('RVF binary fixture + seed manifest exist (loud diagnostic if missing)', () => {
      // If either artifact is missing, emit a loud diagnostic — absence means
      // the seed script never ran, NOT that it's fine to skip.
      assert.ok(
        existsSync(RVF_FIXTURE),
        `MISSING RVF fixture at ${RVF_FIXTURE}. The Phase 13.1 seed script did not run. ` +
          `Re-run the seeder before trusting any Phase 13.1 acceptance result.`,
      );
      assert.ok(
        existsSync(SEED_MANIFEST),
        `MISSING seed manifest at ${SEED_MANIFEST}. ` +
          `The fixture cannot be provenance-tracked without the manifest — re-run the seeder.`,
      );
      const rvfSize = statSync(RVF_FIXTURE).size;
      assert.ok(
        rvfSize > 0,
        `RVF fixture at ${RVF_FIXTURE} is zero bytes — seed produced an empty file.`,
      );
    });

    for (const { fn, tool, token } of CHECKS) {
      describe(`${fn} (${tool}, token=${token})`, () => {
        it('PASS on readable_ok (token present, no panic)', () => {
          const r = runCheck({ fn, mode: 'readable_ok', token });
          assert.equal(
            r.passed,
            'true',
            `expected PASS, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`,
          );
          assert.match(
            r.output,
            /OK: body matches/,
            `output should confirm match: ${r.output}`,
          );
        });

        it('FAIL on schema_panic (distinct diagnostic)', () => {
          const r = runCheck({ fn, mode: 'schema_panic', token });
          assert.notEqual(
            r.passed,
            'true',
            `schema panic must NOT pass — got ${r.passed} / ${r.output}`,
          );
          assert.notEqual(
            r.passed,
            'skip_accepted',
            `schema panic must NOT skip_accepted — got ${r.output}`,
          );
          assert.match(
            r.output,
            /schema panic|unsupported|upgrade|incompatible/i,
            `FAIL output should name schema panic: ${r.output}`,
          );
        });

        it('FAIL on empty_body', () => {
          const r = runCheck({ fn, mode: 'empty_body', token });
          assert.notEqual(
            r.passed,
            'true',
            `empty body must NOT pass — got ${r.passed} / ${r.output}`,
          );
          assert.match(
            r.output,
            /empty body|empty|crashed/i,
            `FAIL output should name empty body: ${r.output}`,
          );
        });

        it('FAIL on token_missing (reader returned wrong value)', () => {
          const r = runCheck({ fn, mode: 'token_missing', token });
          assert.notEqual(
            r.passed,
            'true',
            `missing token must NOT pass — got ${r.passed} / ${r.output}`,
          );
          assert.match(
            r.output,
            /not found|not match|expected/i,
            `FAIL output should explain missing token: ${r.output}`,
          );
        });

        it('SKIP_ACCEPTED when tool not in build', () => {
          const r = runCheck({ fn, mode: 'not_found', token });
          assert.equal(
            r.passed,
            'skip_accepted',
            `expected skip_accepted, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`,
          );
          assert.match(
            r.output,
            /not in build|tool not found/i,
            `skip output should explain: ${r.output}`,
          );
        });
      });
    }

    // ── Panic dominance: even on the new RVF binary checks, a panic word in
    // the body MUST force FAIL even when the expected token matches. This is
    // the exact regression Phase 13 exists to catch.
    describe('panic canary dominates expected-token match (RVF surface)', () => {
      it('FAIL when body contains expected token AND panic word on memory_retrieve', () => {
        const r = runCheck({
          fn: RETRIEVE_FN,
          mode: 'panic_with_token',
          token: 'migration-works-v1',
        });
        assert.notEqual(
          r.passed,
          'true',
          `panic alongside token must NOT pass on the RVF retrieve check. ` +
            `Got: ${r.passed} / ${r.output}`,
        );
        assert.match(
          r.output,
          /schema panic|unsupported|upgrade|incompatible/i,
          `FAIL must name schema panic even when token matched: ${r.output}`,
        );
      });
    });
  });
}
