// @tier unit
// ADR-0094 Phase 16: PII inverse / false-positive regression — paired unit tests.
//
// Sibling lib `lib/acceptance-phase16-pii-inverse.sh` defines 8 checks:
//   1-6. `check_adr0094_p16_nopii_*`     — INVERSE checks on `aidefence_has_pii`
//                                          (non-PII inputs must NOT be flagged)
//     7. `check_adr0094_p16_nopii_scan_clean` — cross-tool scan on clean input
//                                          (`{piiFound:false, safe:true}`)
//     8. `check_adr0094_p16_guard_detects_email` — POSITIVE control
//                                          (detector must still flag real PII)
//
// The phase exists to catch two failure modes:
//   a) Detector over-eager → false positives on benign prose, code, URLs, UUIDs
//      (checks 1-7 FAIL when shim returns `hasPII:true` / `piiFound:true`)
//   b) Detector regressed to stub returning `false` unconditionally — then the
//      inverse checks 1-6 all "pass" silently. Check 8 is the guard: it feeds
//      a real email and expects `hasPII:true`. If the detector silently stubs
//      out to `false`, check 8 FAILS and the whole phase flags the regression.
//
// Shim uses plain string join to dodge template-literal ${...} collisions
// with bash parameter expansion.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const HARNESS = resolve(ROOT, 'lib', 'acceptance-harness.sh');
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-phase16-pii-inverse.sh');

// ── Matrix: inverse checks on aidefence_has_pii (checks 1-6). ──
// Each feeds a DIFFERENT benign input but shares the same contract:
//   `no_pii` → PASS, `has_pii` → FAIL (false-positive), `empty_body` → FAIL,
//   `not_found` → SKIP_ACCEPTED.
const INVERSE_CHECKS = [
  { fn: 'check_adr0094_p16_nopii_plain_prose',    kind: 'prose' },
  { fn: 'check_adr0094_p16_nopii_code_snippet',   kind: 'code' },
  { fn: 'check_adr0094_p16_nopii_version_string', kind: 'version' },
  { fn: 'check_adr0094_p16_nopii_uuid',            kind: 'uuid' },
  { fn: 'check_adr0094_p16_nopii_url',             kind: 'url' },
  { fn: 'check_adr0094_p16_nopii_markdown',        kind: 'markdown' },
];

// Shim: branches on SHIM_MODE. Phase 16 doesn't need a counter — each
// invocation is independent (no flaky bucket). Argv is still parsed so the
// `not_found` diagnostic can name the right tool (`aidefence_has_pii` or
// `aidefence_scan` depending on which check calls in).
function shimScript() {
  return [
    '#!/usr/bin/env bash',
    '# Parse "mcp exec --tool <t>" from args (for not_found diagnostic).',
    'tool=""',
    'for ((i=1; i<=$#; i++)); do',
    '  if [[ "${!i}" == "--tool" ]]; then',
    '    j=$((i+1))',
    '    tool="${!j}"',
    '  fi',
    'done',
    '',
    'case "${SHIM_MODE:-no_pii}" in',
    '  no_pii)',
    '    echo "Result:"',
    '    echo \'{"hasPII":false}\'',
    '    exit 0',
    '    ;;',
    '  has_pii)',
    '    echo "Result:"',
    '    echo \'{"hasPII":true}\'',
    '    exit 0',
    '    ;;',
    '  scan_clean)',
    '    echo "Result:"',
    '    echo \'{"safe":true,"threats":[],"piiFound":false,"detectionTimeMs":1.2}\'',
    '    exit 0',
    '    ;;',
    '  scan_has_pii)',
    '    # Scan says safe but piiFound:true → false-positive at the scan layer.',
    '    echo "Result:"',
    '    echo \'{"safe":true,"threats":[],"piiFound":true,"detectionTimeMs":1.2}\'',
    '    exit 0',
    '    ;;',
    '  scan_unsafe)',
    '    # piiFound:false but safe:false — scan_clean check must still FAIL',
    '    # because the shape violates the clean-scan contract.',
    '    echo "Result:"',
    '    echo \'{"safe":false,"threats":[{"type":"injection"}],"piiFound":false,"detectionTimeMs":1.2}\'',
    '    exit 0',
    '    ;;',
    '  empty_body)',
    '    echo "Result:"',
    '    exit 0',
    '    ;;',
    '  not_found)',
    '    echo "Error: tool not found: $tool"',
    '    exit 1',
    '    ;;',
    '  backend_error)',
    '    # Generic diagnostic — must NOT contain "tool not found" or the',
    '    # _expect_mcp_body layer short-circuits to SKIP_ACCEPTED.',
    '    echo "Error: backend unavailable"',
    '    exit 1',
    '    ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n');
}

function runCheck({ fn, mode }) {
  const root = mkdtempSync(resolve(tmpdir(), 'p16-pii-unit-'));
  const e2e = resolve(root, 'e2e');
  mkdirSync(resolve(e2e, '.claude-flow'), { recursive: true });
  mkdirSync(resolve(e2e, '.swarm'), { recursive: true });
  writeFileSync(resolve(e2e, 'package.json'), '{"name":"p16-unit"}');

  const cliDir = resolve(root, 'bin');
  mkdirSync(cliDir, { recursive: true });
  const cli = resolve(cliDir, 'cli');
  writeFileSync(cli, shimScript(), { mode: 0o755 });

  // Driver sources harness + phase16 lib, stubs _cli_cmd/_e2e_isolate/
  // _run_and_kill[_ro], invokes ONE check function, prints the verdict.
  const driver = [
    'set -u',
    `cd "${ROOT}"`,
    `export TEMP_DIR="${root}"`,
    `export E2E_DIR="${e2e}"`,
    'export REGISTRY="http://shim.invalid"',
    'export PKG="@shim/cli"',
    `export SHIM_MODE="${mode}"`,
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
    // eval-based runner so the shim runs in-process and we get its real exit.
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

describe('ADR-0094 Phase 16 — PII inverse / false-positive regression', () => {
  it('lib and harness files exist', () => {
    assert.ok(existsSync(HARNESS), `missing harness: ${HARNESS}`);
    assert.ok(existsSync(CHECK_FILE), `missing lib: ${CHECK_FILE}`);
  });

  // ── Inverse matrix: checks 1-6 (aidefence_has_pii on benign input). ──
  for (const { fn, kind } of INVERSE_CHECKS) {
    describe(`${fn} (${kind})`, () => {
      it('PASS on no_pii (detector correctly reports hasPII:false)', () => {
        const r = runCheck({ fn, mode: 'no_pii' });
        assert.equal(r.passed, 'true',
          `expected PASS on benign ${kind} input, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
        assert.match(r.output, /hasPII:\s*false|no PII|pass|OK|clean/i,
          `PASS output should confirm the no-PII verdict: ${r.output}`);
      });

      it('FAIL on has_pii (headline false-positive defect)', () => {
        const r = runCheck({ fn, mode: 'has_pii' });
        assert.notEqual(r.passed, 'true',
          `false positive on benign ${kind} must NOT pass — this is the exact defect P16 exists to catch. Got: ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
        assert.notEqual(r.passed, 'skip_accepted',
          `false positive must NOT skip_accepted — the tool is in the build, it is just wrong. Got: ${r.output}`);
        assert.match(r.output, /false[-\s]?positive|PII|hasPII:\s*true/i,
          `FAIL output should name the false-positive verdict: ${r.output}`);
      });

      it('FAIL on empty_body (ADR-0082 silent-pass canary)', () => {
        const r = runCheck({ fn, mode: 'empty_body' });
        assert.notEqual(r.passed, 'true',
          `empty body must NOT pass — ADR-0082 silent-pass canary. Got: ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
        assert.notEqual(r.passed, 'skip_accepted',
          `empty body must NOT skip_accepted — neutral body is suspect, not accepted. Got: ${r.output}`);
      });

      it('SKIP_ACCEPTED when tool not in build', () => {
        const r = runCheck({ fn, mode: 'not_found' });
        assert.equal(r.passed, 'skip_accepted',
          `expected skip_accepted, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
        assert.match(r.output, /not in build|tool not found/i,
          `skip output should explain: ${r.output}`);
      });
    });
  }

  // ── Check 7: cross-tool scan on clean input (aidefence_scan). ──
  describe('check_adr0094_p16_nopii_scan_clean (aidefence_scan)', () => {
    const fn = 'check_adr0094_p16_nopii_scan_clean';

    it('PASS on scan_clean (piiFound:false AND safe:true)', () => {
      const r = runCheck({ fn, mode: 'scan_clean' });
      assert.equal(r.passed, 'true',
        `expected PASS on clean scan, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.match(r.output, /piiFound|safe|clean|OK|pass/i,
        `PASS output should confirm the clean-scan verdict: ${r.output}`);
    });

    it('FAIL on scan_has_pii (piiFound:true — scan-layer false positive)', () => {
      const r = runCheck({ fn, mode: 'scan_has_pii' });
      assert.notEqual(r.passed, 'true',
        `scan flagging piiFound:true on benign input must NOT pass. Got: ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.notEqual(r.passed, 'skip_accepted',
        `piiFound false positive must NOT skip_accepted — tool responded, it was just wrong. Got: ${r.output}`);
      assert.match(r.output, /piiFound/i,
        `FAIL output should name piiFound in the verdict: ${r.output}`);
    });

    it('FAIL on scan_unsafe (safe:false — contract violation even with piiFound:false)', () => {
      const r = runCheck({ fn, mode: 'scan_unsafe' });
      assert.notEqual(r.passed, 'true',
        `scan reporting safe:false on benign input must NOT pass even if piiFound:false. Got: ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.notEqual(r.passed, 'skip_accepted',
        `safe:false must NOT skip_accepted — tool responded, it was just wrong. Got: ${r.output}`);
      assert.match(r.output, /safe/i,
        `FAIL output should name the safe:false violation: ${r.output}`);
    });

    it('SKIP_ACCEPTED when tool not in build', () => {
      const r = runCheck({ fn, mode: 'not_found' });
      assert.equal(r.passed, 'skip_accepted',
        `expected skip_accepted, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.match(r.output, /not in build|tool not found/i,
        `skip output should explain: ${r.output}`);
    });
  });

  // ── Check 8: POSITIVE control — detector must still flag real PII. ──
  // This is the silent-pass trap. If the detector regressed to a stub that
  // returns `hasPII:false` unconditionally, checks 1-6 all "pass" vacuously.
  // Check 8 feeds a real email and REQUIRES `hasPII:true`, so the stub
  // regression is exposed as a FAIL here and the whole phase lights up red.
  describe('check_adr0094_p16_guard_detects_email (positive control)', () => {
    const fn = 'check_adr0094_p16_guard_detects_email';

    it('PASS on has_pii (detector correctly flags email as PII)', () => {
      const r = runCheck({ fn, mode: 'has_pii' });
      assert.equal(r.passed, 'true',
        `expected PASS — email IS PII and detector should flag it. Got: ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.match(r.output, /hasPII:\s*true|PII|detect|pass|OK/i,
        `PASS output should confirm detection: ${r.output}`);
    });

    it('FAIL on no_pii (stub regression — detector missed real PII)', () => {
      const r = runCheck({ fn, mode: 'no_pii' });
      assert.notEqual(r.passed, 'true',
        `detector missing real email PII must NOT pass — this is the silent-pass trap P16 guards against. Got: ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.notEqual(r.passed, 'skip_accepted',
        `missed PII must NOT skip_accepted — the tool is in the build, it regressed. Got: ${r.output}`);
      assert.match(r.output, /regress|stub|guard|detector/i,
        `FAIL output must name the regression so the dashboard signal is unambiguous: ${r.output}`);
    });

    it('SKIP_ACCEPTED when tool not in build', () => {
      const r = runCheck({ fn, mode: 'not_found' });
      assert.equal(r.passed, 'skip_accepted',
        `expected skip_accepted, got ${r.passed} / ${r.output}\nstderr: ${r.stderr}`);
      assert.match(r.output, /not in build|tool not found/i,
        `skip output should explain: ${r.output}`);
    });
  });
});
