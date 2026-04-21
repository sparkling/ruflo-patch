// @tier unit
// ADR-0094 Phase 13.2: AgentDB SQLite fixture migration — paired unit tests.
//
// Mirrors tests/unit/adr0094-p13-1-rvf-migration.test.mjs. Where 13.1
// exercises the two RVF check functions against a real .swarm/memory.rvf
// fixture, 13.2 exercises the two AgentDB check functions against a real
// .swarm/memory.db SQLite fixture seeded with non-zero rows.
//
// Two checks × five scenarios (readable_ok, schema_panic, empty_body,
// token_missing, not_found) = 10 verdict cases, plus:
//   - 1 file-existence sanity test for the live SQLite fixture + manifest
//   - 1 panic-dominance test (token match + panic word MUST fail)
// Total: 12 test cases.
//
// Only the shim bodies differ from the 13.1 version — the verdict logic
// (_p13_expect_readable) is shared across both, so this file is a
// near-carbon-copy of its sibling.

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
const FIXTURE_DIR = resolve(ROOT, 'tests', 'fixtures', 'adr0094-phase13-2');
const DB_FIXTURE = resolve(FIXTURE_DIR, 'v1-agentdb', '.swarm', 'memory.db');
const SEED_MANIFEST = resolve(FIXTURE_DIR, 'v1-agentdb', '.seed-manifest.json');

const SKILL_FN = 'check_adr0094_p13_migration_agentdb_v1_skill_search';
const REFLEX_FN = 'check_adr0094_p13_migration_agentdb_v1_reflexion_retrieve';

// Checks in the brief. Tokens are the regex the verdict helper looks for.
const CHECKS = [
  {
    fn: SKILL_FN,
    tool: 'agentdb_skill_search',
    token: 'p13-2-skill|p13-2 migration sentinel',
  },
  {
    fn: REFLEX_FN,
    tool: 'agentdb_reflexion_retrieve',
    token: 'migration-survived|p13-2 reflexion sentinel',
  },
];

function checksLanded() {
  if (!existsSync(CHECK_FILE)) return false;
  const r = spawnSync(
    'bash',
    [
      '-c',
      `grep -q "${SKILL_FN}" "${CHECK_FILE}" && grep -q "${REFLEX_FN}" "${CHECK_FILE}"`,
    ],
    { encoding: 'utf8' },
  );
  return r.status === 0;
}

function fixtureLanded() {
  return existsSync(DB_FIXTURE) && existsSync(SEED_MANIFEST);
}

function shimScript() {
  // Parse `--tool <t>` out of the args so the same shim can respond
  // differently for skill_search vs reflexion_retrieve. Both readable_ok
  // bodies carry BOTH tokens of the alternation regex so the match is
  // exercised end-to-end.
  return [
    '#!/usr/bin/env bash',
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
    '      agentdb_skill_search)',
    '        echo \'{"skills":[{"name":"p13-2-skill","description":"p13-2 migration sentinel skill"}]}\'',
    '        ;;',
    '      agentdb_reflexion_retrieve|*)',
    '        echo \'{"results":[{"task":"p13-2 reflexion sentinel","note":"migration-survived"}]}\'',
    '        ;;',
    '    esac',
    '    exit 0',
    '    ;;',
    '  schema_panic)',
    '    echo "Result:"',
    '    echo \'{"error":"unsupported sqlite schema version, upgrade required"}\'',
    '    exit 1',
    '    ;;',
    '  empty_body)',
    '    echo "Result:"',
    '    exit 0',
    '    ;;',
    '  token_missing)',
    '    echo "Result:"',
    '    case "$tool" in',
    '      agentdb_skill_search)',
    '        echo \'{"skills":[{"name":"some-other-skill","description":"unrelated"}]}\'',
    '        ;;',
    '      agentdb_reflexion_retrieve|*)',
    '        echo \'{"results":[{"task":"some-other-task","note":"fine"}]}\'',
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
    '      agentdb_skill_search)',
    '        echo \'{"skills":[{"name":"p13-2-skill"}],"warn":"incompatible schema, please upgrade required before continuing"}\'',
    '        ;;',
    '      agentdb_reflexion_retrieve|*)',
    '        echo \'{"results":[{"task":"p13-2 reflexion sentinel","note":"migration-survived"}],"warn":"incompatible schema, please upgrade required before continuing"}\'',
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
  const root = mkdtempSync(resolve(tmpdir(), 'p13-2-agentdb-unit-'));
  const e2e = resolve(root, 'e2e');
  mkdirSync(resolve(e2e, '.claude-flow'), { recursive: true });
  mkdirSync(resolve(e2e, '.swarm'), { recursive: true });
  writeFileSync(resolve(e2e, 'package.json'), '{"name":"p13-2-unit"}');

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

const siblingReady = checksLanded() && fixtureLanded();

if (!siblingReady) {
  describe('ADR-0094 Phase 13.2 — AgentDB migration verdict', () => {
    // Runtime-conditional gate (not a permanent tombstone): flips off when
    // `bash scripts/seed-phase13-2-fixtures.sh` has been run and the lib
    // functions land. The static-scan skip-count guard deliberately ignores
    // `{ skip: ... }` runtime gates for this reason.
    it('BLOCKED: sibling seed + checks not landed — run scripts/seed-phase13-2-fixtures.sh', { skip: 'P13.2 fixture not seeded' }, () => {});
  });
} else {
  describe('ADR-0094 Phase 13.2 — AgentDB migration verdict', () => {
    it('AgentDB SQLite fixture + seed manifest exist (loud diagnostic if missing)', () => {
      assert.ok(
        existsSync(DB_FIXTURE),
        `MISSING AgentDB fixture at ${DB_FIXTURE}. The Phase 13.2 seed script did not run. ` +
          `Re-run scripts/seed-phase13-2-fixtures.sh before trusting any Phase 13.2 acceptance result.`,
      );
      assert.ok(
        existsSync(SEED_MANIFEST),
        `MISSING seed manifest at ${SEED_MANIFEST}. ` +
          `The fixture cannot be provenance-tracked without the manifest — re-run the seeder.`,
      );
      const dbSize = statSync(DB_FIXTURE).size;
      assert.ok(
        dbSize >= 50 * 1024,
        `AgentDB fixture at ${DB_FIXTURE} is ${dbSize} bytes (expected ≥ 50 KB) — seed produced a truncated DB.`,
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

    // Panic dominance: a panic word in the body MUST force FAIL even when
    // the expected token matches. Exercise on the reflexion retrieve check
    // since its alternation regex is the broader of the two.
    describe('panic canary dominates expected-token match (AgentDB surface)', () => {
      it('FAIL when body contains expected token AND panic word on reflexion_retrieve', () => {
        const r = runCheck({
          fn: REFLEX_FN,
          mode: 'panic_with_token',
          token: 'migration-survived|p13-2 reflexion sentinel',
        });
        assert.notEqual(
          r.passed,
          'true',
          `panic alongside token must NOT pass on the AgentDB reflexion check. ` +
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
