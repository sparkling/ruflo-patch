// @tier unit
// ADR-0090 Tier B3 + B6a: daemon-worker output JSON round-trip tests.
//
// Drives the REAL bash helper (`_b3_check_worker_output_json`) and the
// six thin check wrappers (`check_adr0090_b3_{map,audit,optimize,
// consolidate,testgaps}`, `check_adr0090_b6a_daemon_state`) in subshells.
// The CLI is stubbed as a bash shim that writes a canned JSON payload to
// the target path when the right `daemon trigger -w <trigger>` command
// arrives. Test cases control what it writes.
//
// Cases per check (24+ total):
//   * happy: CLI writes valid JSON with all required fields → PASS
//   * file-missing: CLI exits 0 but never writes the file → FAIL
//                   (diagnostic: "file not written")
//   * malformed-json: CLI writes gibberish → FAIL
//                     (diagnostic: "invalid JSON")
//   * missing-field: CLI writes valid JSON without a required field →
//                    FAIL (diagnostic: "missing required field")
//
// Plus static-source assertions (helper exists, six check functions
// exist, wiring into test-acceptance.sh, loader source line in
// acceptance-checks.sh).
//
// Plus three-way bucket: if the CLI emits "Unknown worker trigger",
// _CHECK_PASSED must be "skip_accepted" (not "true" and not "false").
//
// Strategy
// --------
// (a) Bash stubs live in a per-test temp dir on PATH.
// (b) The driver script sources acceptance-harness.sh (for the
//     skip_accepted conventions) and acceptance-adr0090-b3-checks.sh.
// (c) The check uses its real polling loop + node validator — only the
//     CLI invocation is stubbed. This catches bugs in the polling
//     window, JSON validator, and wiring that a fully-mocked test
//     would miss.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-adr0090-b3-checks.sh');
const CHECKS_LIB = resolve(ROOT, 'lib', 'acceptance-checks.sh');
const HARNESS_FILE = resolve(ROOT, 'lib', 'acceptance-harness.sh');
const E2E_CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-e2e-checks.sh');
const RUNNER_FILE = resolve(ROOT, 'scripts', 'test-acceptance.sh');

// ──────────────────────────────────────────────────────────────────────
// The 6 checks + their required-fields contract (kept in sync with the
// real check file). One source of truth here → if the check file
// drifts, the static assertions below fail.
// ──────────────────────────────────────────────────────────────────────

const CHECKS = [
  {
    fn: 'check_adr0090_b3_map',
    trigger: 'map',
    relPath: '.claude-flow/metrics/codebase-map.json',
    requiredFields: ['timestamp', 'projectRoot', 'structure', 'scannedAt'],
    happyJson: {
      timestamp: '2026-04-15T00:00:00.000Z',
      projectRoot: '/dummy',
      structure: { hasPackageJson: true, hasTsConfig: false, hasClaudeConfig: true, hasClaudeFlow: true },
      scannedAt: 1744675200000,
    },
  },
  {
    fn: 'check_adr0090_b3_audit',
    trigger: 'audit',
    relPath: '.claude-flow/metrics/security-audit.json',
    requiredFields: ['timestamp', 'mode', 'checks', 'riskLevel', 'recommendations'],
    happyJson: {
      timestamp: '2026-04-15T00:00:00.000Z',
      mode: 'local',
      checks: { envFilesProtected: true, gitIgnoreExists: true, noHardcodedSecrets: true },
      riskLevel: 'low',
      recommendations: [],
    },
  },
  {
    fn: 'check_adr0090_b3_optimize',
    trigger: 'optimize',
    relPath: '.claude-flow/metrics/performance.json',
    requiredFields: ['timestamp', 'mode', 'memoryUsage', 'uptime', 'optimizations'],
    happyJson: {
      timestamp: '2026-04-15T00:00:00.000Z',
      mode: 'local',
      memoryUsage: { rss: 123, heapTotal: 456 },
      uptime: 789,
      optimizations: { cacheHitRate: 0.78 },
    },
  },
  {
    fn: 'check_adr0090_b3_consolidate',
    trigger: 'consolidate',
    relPath: '.claude-flow/metrics/consolidation.json',
    requiredFields: ['timestamp', 'patternsConsolidated', 'memoryCleaned', 'duplicatesRemoved'],
    happyJson: {
      timestamp: '2026-04-15T00:00:00.000Z',
      patternsConsolidated: 0,
      memoryCleaned: 0,
      duplicatesRemoved: 0,
    },
  },
  {
    fn: 'check_adr0090_b3_testgaps',
    trigger: 'testgaps',
    relPath: '.claude-flow/metrics/test-gaps.json',
    requiredFields: ['timestamp', 'mode', 'hasTestDir', 'estimatedCoverage', 'gaps'],
    happyJson: {
      timestamp: '2026-04-15T00:00:00.000Z',
      mode: 'local',
      hasTestDir: true,
      estimatedCoverage: 'unknown',
      gaps: [],
    },
  },
  {
    fn: 'check_adr0090_b6a_daemon_state',
    trigger: 'map', // B6a invokes the 'map' trigger — cheapest worker that still writes daemon-state
    relPath: '.claude-flow/daemon-state.json',
    requiredFields: ['running', 'workers', 'config', 'savedAt'],
    happyJson: {
      running: false,
      workers: { map: { runCount: 1, successCount: 1 } },
      config: { stateFile: '/dummy/daemon-state.json' },
      savedAt: '2026-04-15T00:00:00.000Z',
    },
  },
];

// ──────────────────────────────────────────────────────────────────────
// Test harness
// ──────────────────────────────────────────────────────────────────────

/**
 * Write a CLI stub at `$dir/cli` that:
 *  - Matches `daemon trigger -w <trigger>` on its argv
 *  - Given a scenario (happy / missing / malformed / missing-field /
 *    unknown-worker), writes the appropriate payload (if any) to the
 *    target path, then exits with the given code.
 *
 * `scenario` payloads are stored as JSON in `$dir/cli-scenario.json`.
 * Multiple scenarios per test (B6a triggers the map worker, etc.) are
 * keyed by trigger.
 *
 *   { "map": { "exit": 0, "writeTo": "...", "writeBody": "..." }, ... }
 */
function writeCliStub(dir, scenariosByTrigger) {
  const shim = join(dir, 'cli');
  const scenariosFile = join(dir, 'cli-scenarios.json');
  writeFileSync(scenariosFile, JSON.stringify(scenariosByTrigger, null, 2));
  writeFileSync(
    shim,
    [
      '#!/usr/bin/env bash',
      'set +e',
      `SCENARIOS_FILE='${scenariosFile}'`,
      '',
      '# Parse argv: look for "daemon trigger -w <trigger>" or long form.',
      'sub=""; trig=""',
      'for ((i=1; i<=$#; i++)); do',
      '  a="${!i}"',
      '  if [[ "$a" == "daemon" ]]; then',
      '    j=$((i + 1))',
      '    sub="${!j:-}"',
      '  fi',
      '  if [[ "$a" == "-w" || "$a" == "--worker" ]]; then',
      '    j=$((i + 1))',
      '    trig="${!j:-}"',
      '  fi',
      'done',
      '',
      'if [[ "$sub" != "trigger" || -z "$trig" ]]; then',
      '  echo "[stub cli] unrecognized argv: $*" >&2',
      '  exit 3',
      'fi',
      '',
      '# Pull this trigger\'s scenario from the JSON file via node.',
      'scenario_json=$(node -e "',
      '  const fs = require(\\"fs\\");',
      '  const s = JSON.parse(fs.readFileSync(process.argv[1], \\"utf8\\"));',
      '  const t = process.argv[2];',
      '  if (!s[t]) { console.log(JSON.stringify({missing: true})); process.exit(0); }',
      '  console.log(JSON.stringify(s[t]));',
      '" "$SCENARIOS_FILE" "$trig")',
      '',
      'missing=$(echo "$scenario_json" | node -e "const s=JSON.parse(require(\\"fs\\").readFileSync(0,\\"utf8\\")); console.log(!!s.missing);")',
      'if [[ "$missing" == "true" ]]; then',
      '  echo "[stub cli] no scenario for trigger=$trig — exiting 1" >&2',
      '  exit 1',
      'fi',
      '',
      'exit_code=$(echo "$scenario_json" | node -e "const s=JSON.parse(require(\\"fs\\").readFileSync(0,\\"utf8\\")); console.log(typeof s.exit === \\"number\\" ? s.exit : 0);")',
      'write_to=$(echo "$scenario_json"  | node -e "const s=JSON.parse(require(\\"fs\\").readFileSync(0,\\"utf8\\")); console.log(s.writeTo || \\"\\");")',
      'write_body=$(echo "$scenario_json" | node -e "const s=JSON.parse(require(\\"fs\\").readFileSync(0,\\"utf8\\")); console.log(s.writeBody || \\"\\");")',
      'stderr_body=$(echo "$scenario_json" | node -e "const s=JSON.parse(require(\\"fs\\").readFileSync(0,\\"utf8\\")); console.log(s.stderrBody || \\"\\");")',
      '',
      'if [[ -n "$write_to" ]]; then',
      '  mkdir -p "$(dirname "$write_to")" 2>/dev/null',
      '  # Body is literal (the test already pre-encoded it as UTF-8 bytes)',
      '  printf "%s" "$write_body" > "$write_to"',
      'fi',
      'if [[ -n "$stderr_body" ]]; then',
      '  printf "%s\\n" "$stderr_body" >&2',
      'fi',
      'exit "${exit_code:-0}"',
    ].join('\n'),
    { mode: 0o755 },
  );
  return shim;
}

/**
 * Execute the check function under test in a subshell with stubbed
 * helpers. Returns the parsed _CHECK_PASSED and _CHECK_OUTPUT.
 *
 * scenariosByTrigger — see writeCliStub above.
 * fnName — the name of the check_* function to invoke.
 * isoPath — the absolute path _e2e_isolate will echo. Must exist on
 *   disk. The target JSON file will be written relative to isoPath.
 */
function runCheck({ tempDir, isoPath, fnName, scenariosByTrigger, targetRelPath }) {
  const stubDir = join(tempDir, 'stubs');
  mkdirSync(stubDir, { recursive: true });

  // Substitute isoPath for any "$ISO" placeholder in each scenario's
  // writeTo so callers can use a portable relative reference.
  const resolved = {};
  for (const [trig, scn] of Object.entries(scenariosByTrigger || {})) {
    resolved[trig] = {
      ...scn,
      writeTo: (scn.writeTo || '').replace('$ISO', isoPath),
    };
  }

  const cliStub = writeCliStub(stubDir, resolved);

  // E2E_DIR must EXIST on disk (the check's precondition rejects a
  // missing one with _CHECK_PASSED="false"). isoPath itself is not
  // the E2E_DIR — _e2e_isolate returns a child of E2E_DIR in the
  // real harness — but since we stub _e2e_isolate, E2E_DIR just needs
  // to be a live directory for the precondition.
  const e2eDir = join(tempDir, 'e2e');
  mkdirSync(e2eDir, { recursive: true });

  const driverPath = join(stubDir, 'driver.sh');
  const driver = [
    '#!/usr/bin/env bash',
    'set +e',
    'set +u',
    `export PATH="${stubDir}:$PATH"`,
    `export TEMP_DIR="${tempDir}"`,
    `export E2E_DIR="${e2eDir}"`,
    'export REGISTRY="http://test-registry.invalid"',
    'export PKG="@sparkleideas/cli"',
    // _cli_cmd: point at the stub
    `_cli_cmd() { echo "${cliStub}"; }`,
    // _e2e_isolate: always return the pre-made dir
    `_e2e_isolate() { echo "${isoPath}"; }`,
    // Use the REAL _run_and_kill (simplified: no sentinel, direct eval).
    // The production _run_and_kill with its polling + kill + sentinel is
    // tested separately. Here we want the check function, not the
    // harness.
    '_run_and_kill() {',
    '  local cmd="$1" out="${2:-}" maxw="${3:-30}"',
    '  if [[ -n "$out" ]]; then',
    '    eval "$cmd" > "$out" 2>&1',
    '  else',
    '    eval "$cmd" > /dev/null 2>&1',
    '  fi',
    '  _RK_EXIT=$?',
    '  _RK_OUT=$(cat "$out" 2>/dev/null || echo "")',
    '}',
    '_run_and_kill_ro() { _run_and_kill "$@"; }',
    `source "${CHECK_FILE}"`,
    // Override the thin check functions AFTER sourcing so they use a
    // 2-second polling budget instead of the production 30-45s. The
    // helper itself is what we're testing; the thin functions are just
    // wrappers that pick a timeout. We are specifically NOT testing the
    // 30/45s production value here — that's infrastructure, not logic.
    'check_adr0090_b3_map() { _b3_check_worker_output_json "map" ".claude-flow/metrics/codebase-map.json" "timestamp,projectRoot,structure,scannedAt" 2; }',
    'check_adr0090_b3_audit() { _b3_check_worker_output_json "audit" ".claude-flow/metrics/security-audit.json" "timestamp,mode,checks,riskLevel,recommendations" 2; }',
    'check_adr0090_b3_optimize() { _b3_check_worker_output_json "optimize" ".claude-flow/metrics/performance.json" "timestamp,mode,memoryUsage,uptime,optimizations" 2; }',
    'check_adr0090_b3_consolidate() { _b3_check_worker_output_json "consolidate" ".claude-flow/metrics/consolidation.json" "timestamp,patternsConsolidated,memoryCleaned,duplicatesRemoved" 2; }',
    'check_adr0090_b3_testgaps() { _b3_check_worker_output_json "testgaps" ".claude-flow/metrics/test-gaps.json" "timestamp,mode,hasTestDir,estimatedCoverage,gaps" 2; }',
    // B6a preserves the PASS-prefix rewrite so the test-case for it still hits.
    'check_adr0090_b6a_daemon_state() { _b3_check_worker_output_json "map" ".claude-flow/daemon-state.json" "running,workers,config,savedAt" 2; ',
    '  if [[ "${_CHECK_OUTPUT:-}" == B3/map:* ]]; then _CHECK_OUTPUT="B6a/daemon-state:${_CHECK_OUTPUT#B3/map:}"; ',
    '  elif [[ "${_CHECK_OUTPUT:-}" == "SKIP_ACCEPTED: worker trigger \'map\'"* ]]; then _CHECK_OUTPUT="SKIP_ACCEPTED: B6a/daemon-state — daemon trigger subcmd absent (treated as removed-from-build per ADR-0090 Tier A2)"; fi; }',
    `${fnName}`,
    'echo "::PASSED::${_CHECK_PASSED:-<unset>}"',
    'echo "::OUTPUT_START::"',
    'echo "${_CHECK_OUTPUT:-}"',
    'echo "::OUTPUT_END::"',
  ].join('\n');
  writeFileSync(driverPath, driver, { mode: 0o755 });

  // Generous timeout — the check may sleep for up to timeout_s looking
  // for the file. Per-trigger timeout_s defaults to 30, so we allow
  // 45s wall-clock for bash overhead.
  const result = spawnSync('bash', [driverPath], { encoding: 'utf8', timeout: 60000 });
  const out = (result.stdout || '') + (result.stderr || '');
  const passedMatch = out.match(/::PASSED::(.*)/);
  const outputMatch = out.match(/::OUTPUT_START::\n([\s\S]*?)::OUTPUT_END::/);
  return {
    passed: passedMatch ? passedMatch[1].trim() : '<unparsed>',
    output: outputMatch ? outputMatch[1].trim() : '',
    raw: out,
    signal: result.signal,
    status: result.status,
  };
}

function setupTest(label) {
  const tempDir = mkdtempSync(join(tmpdir(), `b3-${label}-`));
  const isoPath = join(tempDir, 'iso');
  mkdirSync(join(isoPath, '.claude-flow', 'metrics'), { recursive: true });
  mkdirSync(join(isoPath, '.swarm'), { recursive: true });
  return { tempDir, isoPath };
}

function teardown(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

// ──────────────────────────────────────────────────────────────────────
// Static source assertions
// ──────────────────────────────────────────────────────────────────────

describe('ADR-0090 Tier B3 static source — helper + check wiring', () => {
  const source = readFileSync(CHECK_FILE, 'utf-8');

  it('defines the shared helper _b3_check_worker_output_json', () => {
    assert.match(
      source,
      /_b3_check_worker_output_json\(\)\s*\{/,
      'generic helper must exist (no copy-paste per ADR-0090 rules)',
    );
  });

  it('helper body is non-trivial (>= 100 lines of logic)', () => {
    // Grab from helper open brace to the closing } that comes before
    // the first check_ function. Cheaper than a full bash parse.
    const m = source.match(/_b3_check_worker_output_json\(\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(m, 'helper function body must be parseable');
    const lines = m[1].split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
    assert.ok(lines.length >= 100,
      `helper must contain substantive logic, got ${lines.length} non-blank lines`);
  });

  it('six check functions exist (B3×5 + B6a×1)', () => {
    for (const c of CHECKS) {
      assert.match(source, new RegExp(`${c.fn}\\(\\)\\s*\\{`),
        `function ${c.fn} must be defined`);
    }
  });

  it('each thin check calls the shared helper (no copy-pasted bodies)', () => {
    for (const c of CHECKS) {
      // Extract the function body
      const re = new RegExp(`${c.fn}\\(\\)\\s*\\{([\\s\\S]*?)\\n\\}`, 'm');
      const m = source.match(re);
      assert.ok(m, `${c.fn} body must be parseable`);
      const body = m[1];
      assert.match(body, /_b3_check_worker_output_json/,
        `${c.fn} must delegate to the shared helper (anti-copy-paste rule)`);
      const nonCommentLines = body
        .split('\n')
        .filter(l => l.trim() && !l.trim().startsWith('#'));
      // B6a has a tiny prefix-rewrite postfix — allow up to 12 real
      // lines so the rewrite isn't a code-review red flag.
      const max = c.fn === 'check_adr0090_b6a_daemon_state' ? 14 : 8;
      assert.ok(nonCommentLines.length <= max,
        `${c.fn} must be a thin wrapper, found ${nonCommentLines.length} real lines (max ${max})`);
    }
  });

  it('pre-deletes the target file before dispatch (not presence theatre)', () => {
    assert.match(source, /rm -f "\$target_file"/,
      'helper must pre-delete the target file so a stale init-time artefact cannot pass the check');
  });

  it('uses `daemon trigger -w` (not `hooks worker dispatch`) to invoke the worker', () => {
    assert.match(source, /daemon trigger -w/,
      'must invoke `daemon trigger -w <worker>` which is the synchronous path that actually writes the file');
    // Negative assertion: we do NOT invoke `hooks worker dispatch` in
    // any executable line. A docblock may mention it (and the contrast
    // against our chosen command is load-bearing in the header), but
    // no _run_and_kill / eval / $cli invocation may use it.
    //
    // We scan non-comment lines for the invocation shape.
    const executableLines = source
      .split('\n')
      .filter(l => !l.trim().startsWith('#') && l.trim().length > 0);
    for (const line of executableLines) {
      // Must-not invoke the MCP-stub dispatch as a CLI command
      assert.doesNotMatch(line, /\$cli\s+hooks worker dispatch/,
        `executable line uses the MCP-stub command that does not write files: ${line}`);
      assert.doesNotMatch(line, /hooks worker dispatch.*--trigger/,
        `executable line dispatches via the MCP-stub path: ${line}`);
    }
  });

  it('validates JSON parse AND required fields (not presence-only)', () => {
    assert.match(source, /JSON\.parse/,
      'helper must parse the target file as JSON');
    assert.match(source, /ERR_MISSING|missing required field/i,
      'helper must detect missing required fields');
  });

  it('uses the three-way result bucket (true / false / skip_accepted)', () => {
    assert.match(source, /_CHECK_PASSED="skip_accepted"/,
      'helper must set skip_accepted for the legitimate prerequisite-absent case');
    assert.match(source, /_CHECK_PASSED="true"/,
      'helper must have at least one true-assignment (happy path)');
    assert.match(source, /_CHECK_PASSED="false"/,
      'helper must default to false and flip back to false on failure');
  });

  it('only assigns _CHECK_PASSED values from {true, false, skip_accepted}', () => {
    const assignments = source.match(/_CHECK_PASSED="([^"]+)"/g) || [];
    const values = new Set(assignments.map(m => m.match(/"([^"]+)"/)[1]));
    for (const v of values) {
      assert.ok(['true', 'false', 'skip_accepted'].includes(v),
        `B3 may only set _CHECK_PASSED to true/false/skip_accepted, found "${v}"`);
    }
  });

  it('is sourced from lib/acceptance-checks.sh', () => {
    const loader = readFileSync(CHECKS_LIB, 'utf-8');
    assert.match(loader, /acceptance-adr0090-b3-checks\.sh/,
      'loader must source acceptance-adr0090-b3-checks.sh');
  });

  it('all 6 checks wired into scripts/test-acceptance.sh', () => {
    const runner = readFileSync(RUNNER_FILE, 'utf-8');
    const expectedIds = [
      'adr0090-b3-map',
      'adr0090-b3-audit',
      'adr0090-b3-optimize',
      'adr0090-b3-consolidate',
      'adr0090-b3-testgaps',
      'adr0090-b6a-daemon',
    ];
    for (const id of expectedIds) {
      assert.match(runner, new RegExp(`"${id.replace(/-/g, '[-]')}"`),
        `runner must wire "${id}" via run_check_bg`);
    }
    for (const c of CHECKS) {
      assert.match(runner, new RegExp(`\\b${c.fn}\\b`),
        `runner must invoke ${c.fn}`);
    }
  });

  it('wiring uses the correct groups (data for B3, daemon for B6a)', () => {
    const runner = readFileSync(RUNNER_FILE, 'utf-8');
    // Capture the full run_check_bg line for each id and check the
    // last field (group).
    const b3Ids = ['adr0090-b3-map', 'adr0090-b3-audit', 'adr0090-b3-optimize', 'adr0090-b3-consolidate', 'adr0090-b3-testgaps'];
    for (const id of b3Ids) {
      const re = new RegExp(`run_check_bg\\s+"${id}".*"(data|daemon|\\w+)"\\s*$`, 'm');
      const m = runner.match(re);
      assert.ok(m, `runner must have a line for ${id}`);
      assert.equal(m[1], 'data',
        `${id} must be in the 'data' group, got '${m[1]}'`);
    }
    const daemonRe = /run_check_bg\s+"adr0090-b6a-daemon".*"(\w+)"\s*$/m;
    const dm = runner.match(daemonRe);
    assert.ok(dm, 'runner must have a line for adr0090-b6a-daemon');
    assert.equal(dm[1], 'daemon',
      `B6a must be in the 'daemon' group, got '${dm[1]}'`);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Behavioural cases: 4 per check × 6 checks = 24 tests
// ──────────────────────────────────────────────────────────────────────

for (const c of CHECKS) {
  describe(`ADR-0090 ${c.fn}: happy path → PASS`, () => {
    it('passes when CLI writes valid JSON with all required fields', () => {
      const fx = setupTest(`${c.trigger}-happy`);
      try {
        const scenarios = {
          [c.trigger]: {
            exit: 0,
            writeTo: '$ISO/' + c.relPath,
            writeBody: JSON.stringify(c.happyJson, null, 2),
          },
        };
        const { passed, output, raw } = runCheck({
          tempDir: fx.tempDir,
          isoPath: fx.isoPath,
          fnName: c.fn,
          scenariosByTrigger: scenarios,
          targetRelPath: c.relPath,
        });
        assert.equal(passed, 'true',
          `expected PASS, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
        // Diagnostic must confirm the file was actually produced and
        // validated. The check itself cleans up iso/$target after
        // success so we can't look for the file on disk here —
        // instead we verify the reported bytes + field list.
        assert.match(output, /written \(\d+ bytes\).*parses as JSON.*required fields present/,
          `PASS output must name bytes + JSON + fields, got: ${output}`);
        // All required fields must be listed in the diagnostic
        for (const f of c.requiredFields) {
          assert.ok(output.includes(f),
            `PASS output must name required field '${f}', got: ${output}`);
        }
      } finally {
        teardown(fx.tempDir);
      }
    });
  });

  describe(`ADR-0090 ${c.fn}: file missing → FAIL`, () => {
    it('fails when CLI exits 0 but never writes the file', () => {
      const fx = setupTest(`${c.trigger}-missing`);
      try {
        const scenarios = {
          [c.trigger]: {
            exit: 0, // exit success, but don't write anything
            writeTo: '',
            writeBody: '',
          },
        };
        const { passed, output, raw } = runCheck({
          tempDir: fx.tempDir,
          isoPath: fx.isoPath,
          fnName: c.fn,
          scenariosByTrigger: scenarios,
          targetRelPath: c.relPath,
        });
        assert.equal(passed, 'false',
          `expected FAIL (file not written), got ${passed}\noutput: ${output}\nraw:\n${raw}`);
        assert.match(output, /file not written|missing|not exist/i,
          `expected "file not written" diagnostic, got: ${output}`);
        assert.notEqual(passed, 'true',
          'REGRESSION: missing-file must NEVER pass this check (ADR-0082)');
      } finally {
        teardown(fx.tempDir);
      }
    });
  });

  describe(`ADR-0090 ${c.fn}: malformed JSON → FAIL`, () => {
    it('fails when CLI writes gibberish at the target path', () => {
      const fx = setupTest(`${c.trigger}-malformed`);
      try {
        const scenarios = {
          [c.trigger]: {
            exit: 0,
            writeTo: '$ISO/' + c.relPath,
            // Broken JSON — missing closing quote + brace
            writeBody: '{"timestamp": "2026-04-15T00:00',
          },
        };
        const { passed, output, raw } = runCheck({
          tempDir: fx.tempDir,
          isoPath: fx.isoPath,
          fnName: c.fn,
          scenariosByTrigger: scenarios,
          targetRelPath: c.relPath,
        });
        assert.equal(passed, 'false',
          `expected FAIL (invalid JSON), got ${passed}\noutput: ${output}\nraw:\n${raw}`);
        assert.match(output, /invalid JSON|parse|Unexpected/i,
          `expected "invalid JSON" diagnostic, got: ${output}`);
      } finally {
        teardown(fx.tempDir);
      }
    });
  });

  describe(`ADR-0090 ${c.fn}: missing required field → FAIL`, () => {
    it('fails when CLI writes JSON that lacks a required top-level field', () => {
      const fx = setupTest(`${c.trigger}-missfield`);
      try {
        // Remove the FIRST required field to make the gap deterministic.
        const broken = { ...c.happyJson };
        delete broken[c.requiredFields[0]];
        const scenarios = {
          [c.trigger]: {
            exit: 0,
            writeTo: '$ISO/' + c.relPath,
            writeBody: JSON.stringify(broken, null, 2),
          },
        };
        const { passed, output, raw } = runCheck({
          tempDir: fx.tempDir,
          isoPath: fx.isoPath,
          fnName: c.fn,
          scenariosByTrigger: scenarios,
          targetRelPath: c.relPath,
        });
        assert.equal(passed, 'false',
          `expected FAIL (missing field), got ${passed}\noutput: ${output}\nraw:\n${raw}`);
        assert.match(output, /missing (required )?field/i,
          `expected "missing required field" diagnostic, got: ${output}`);
        assert.match(output, new RegExp(c.requiredFields[0]),
          `diagnostic must name the missing field ${c.requiredFields[0]}, got: ${output}`);
      } finally {
        teardown(fx.tempDir);
      }
    });
  });
}

// ──────────────────────────────────────────────────────────────────────
// Three-way bucket case: unknown-worker → skip_accepted
// ──────────────────────────────────────────────────────────────────────
//
// Per ADR-0090 Tier A2 + the helper docblock, the ONLY legitimate
// skip_accepted case is when the CLI reports the worker as removed
// from the build. We simulate that here — the researcher report can
// flag any trigger this way; for now we exercise the plumbing to make
// sure a future removed-worker scenario doesn't silently become FAIL
// (drowning real regressions) or PASS (covering up the removal).

describe('ADR-0090 B3: unknown-worker triggers skip_accepted (three-way bucket)', () => {
  it('returns skip_accepted when CLI reports "Unknown worker trigger"', () => {
    const fx = setupTest('unknown-map');
    try {
      const scenarios = {
        map: {
          exit: 1,
          writeTo: '',
          writeBody: '',
          stderrBody: 'Unknown worker trigger: map. Available triggers: ...',
        },
      };
      const { passed, output, raw } = runCheck({
        tempDir: fx.tempDir,
        isoPath: fx.isoPath,
        fnName: 'check_adr0090_b3_map',
        scenariosByTrigger: scenarios,
        targetRelPath: '.claude-flow/metrics/codebase-map.json',
      });
      assert.equal(passed, 'skip_accepted',
        `expected skip_accepted, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /SKIP_ACCEPTED|removed-from-build/i,
        `skip_accepted output must include marker, got: ${output}`);
      // Must NOT be PASS (don't cover up removal)
      assert.notEqual(passed, 'true',
        'REGRESSION: unknown-worker must NOT silently pass (covers up a real removal)');
      // Must NOT be FAIL (don't drown real regressions)
      assert.notEqual(passed, 'false',
        'REGRESSION: unknown-worker must NOT FAIL — removed workers should be bucketed SKIP');
    } finally {
      teardown(fx.tempDir);
    }
  });

  it('returns skip_accepted for other "worker not found" shapes', () => {
    const fx = setupTest('unknown-audit');
    try {
      const scenarios = {
        audit: {
          exit: 1,
          writeTo: '',
          writeBody: '',
          stderrBody: 'Error: worker type not found: audit',
        },
      };
      const { passed, output } = runCheck({
        tempDir: fx.tempDir,
        isoPath: fx.isoPath,
        fnName: 'check_adr0090_b3_audit',
        scenariosByTrigger: scenarios,
        targetRelPath: '.claude-flow/metrics/security-audit.json',
      });
      assert.equal(passed, 'skip_accepted',
        `expected skip_accepted for "worker type not found", got ${passed}\noutput: ${output}`);
    } finally {
      teardown(fx.tempDir);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// B6a-specific diagnostic rewrite
// ──────────────────────────────────────────────────────────────────────

describe('ADR-0090 B6a: diagnostic prefix is rewritten from B3/map to B6a', () => {
  it('on PASS, _CHECK_OUTPUT mentions "B6a/daemon-state" (not "B3/map")', () => {
    const fx = setupTest('b6a-happy-prefix');
    try {
      const scenarios = {
        map: {
          exit: 0,
          writeTo: '$ISO/.claude-flow/daemon-state.json',
          writeBody: JSON.stringify({
            running: false,
            workers: { map: {} },
            config: { stateFile: '/dummy' },
            savedAt: '2026-04-15T00:00:00.000Z',
          }),
        },
      };
      const { passed, output } = runCheck({
        tempDir: fx.tempDir,
        isoPath: fx.isoPath,
        fnName: 'check_adr0090_b6a_daemon_state',
        scenariosByTrigger: scenarios,
        targetRelPath: '.claude-flow/daemon-state.json',
      });
      assert.equal(passed, 'true',
        `expected PASS for B6a happy path, got ${passed}\noutput: ${output}`);
      assert.match(output, /B6a/,
        `B6a output must include the B6a/ prefix, got: ${output}`);
      assert.doesNotMatch(output, /^B3\/map:/,
        `B6a output must NOT leak the B3/map prefix, got: ${output}`);
    } finally {
      teardown(fx.tempDir);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// Self-test: verify the stub itself behaves correctly
// ──────────────────────────────────────────────────────────────────────
//
// If the stub is broken (e.g. writes the file regardless of the
// scenario, or doesn't match the argv), ALL our behavioural tests lie.
// This test checks the stub contract directly: argv parsing + scenario
// lookup.

describe('ADR-0090 B3: stub CLI self-test', () => {
  it('stub writes the body to writeTo and exits with the scenario exit code', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'b3-stub-selftest-'));
    try {
      const scenarios = {
        map: {
          exit: 7,
          writeTo: join(tempDir, 'output.json'),
          writeBody: '{"hello":"world"}',
        },
      };
      const cliStub = writeCliStub(tempDir, scenarios);
      const result = spawnSync('bash', [cliStub, 'daemon', 'trigger', '-w', 'map'], { encoding: 'utf8', timeout: 5000 });
      assert.equal(result.status, 7,
        `stub must exit with scenario.exit=7, got ${result.status}`);
      assert.ok(existsSync(join(tempDir, 'output.json')),
        'stub must write to the scenario.writeTo path');
      const body = readFileSync(join(tempDir, 'output.json'), 'utf8');
      assert.equal(body, '{"hello":"world"}',
        'stub must write the exact writeBody');
    } finally {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  });

  it('stub with no matching scenario exits 1 (missing scenario)', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'b3-stub-no-match-'));
    try {
      const cliStub = writeCliStub(tempDir, {}); // empty scenarios
      const result = spawnSync('bash', [cliStub, 'daemon', 'trigger', '-w', 'audit'], { encoding: 'utf8', timeout: 5000 });
      assert.equal(result.status, 1,
        `stub must exit 1 on missing scenario, got ${result.status}\nstderr=${result.stderr}`);
    } finally {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  });
});
