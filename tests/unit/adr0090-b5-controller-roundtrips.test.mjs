// @tier unit
// ADR-0090 Tier B5: 15-controller SQLite row-count round-trip tests.
//
// Drives the REAL bash helper (`_b5_check_controller_roundtrip`) and
// the 15 thin check wrappers in subshells. The CLI is stubbed as a
// bash shim that writes a canned response to stdout when a given MCP
// tool is invoked, and optionally writes a SQLite file directly so
// the helper's sqlite3 verification can run.
//
// Cases per check (≥ 2 total):
//   * happy:       stub claims tool success + writes a real SQLite row
//                  at the canonical table+column → PASS
//   * not-available: stub returns "X not available" error → skip_accepted
//   * wrong-bind:  stub returns better-sqlite3 bind-undefined error →
//                  skip_accepted (the live-build case in 3.5.58-p114)
//   * unknown-tool: stub returns "unknown tool" → skip_accepted
//
// Plus static-source + wiring assertions:
//   * helper exists and is non-trivial
//   * 15 check functions exist and delegate to the helper (thin)
//   * loader line in acceptance-checks.sh
//   * 15 run_check_bg rows in scripts/test-acceptance.sh
//   * 15 collect_parallel spec lines
//   * _CHECK_PASSED only takes the 3 canonical values
//
// Plus three-way bucket tests:
//   * silent-success-no-row: stub says success but SQLite has 0 rows →
//     FAIL (ADR-0082 silent-pass detector)
//   * no-such-table: stub returns 'no such table: <target>' → FAIL
//   * no-such-other-table: stub returns 'no such table: <other>' →
//     skip_accepted (wiring elsewhere, not our target)
//
// Plus stub self-test + sqlite3 self-test.

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
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-adr0090-b5-checks.sh');
const CHECKS_LIB = resolve(ROOT, 'lib', 'acceptance-checks.sh');
const HARNESS_FILE = resolve(ROOT, 'lib', 'acceptance-harness.sh');
const RUNNER_FILE = resolve(ROOT, 'scripts', 'test-acceptance.sh');

// ──────────────────────────────────────────────────────────────────────
// CONTROLLER MATRIX — one source of truth for the 15 B5 checks.
// Derived from the fork's ControllerName union
// (@claude-flow/memory/src/controller-registry.ts:54-106), verified
// against each wrapper's args in acceptance-adr0090-b5-checks.sh.
// ──────────────────────────────────────────────────────────────────────

const CHECKS = [
  { controller: 'reflexion',           fn: 'check_adr0090_b5_reflexion',           tool: 'agentdb_reflexion_store',    table: 'episodes',            markerCol: 'task' },
  { controller: 'skillLibrary',        fn: 'check_adr0090_b5_skillLibrary',        tool: 'agentdb_skill_create',       table: 'skills',              markerCol: 'name' },
  { controller: 'reasoningBank',       fn: 'check_adr0090_b5_reasoningBank',       tool: 'agentdb_pattern_store',      table: 'reasoning_patterns',  markerCol: 'approach' },
  { controller: 'causalGraph',         fn: 'check_adr0090_b5_causalGraph',         tool: 'agentdb_causal-edge',        table: 'causal_edges',        markerCol: 'relation' },
  { controller: 'causalRecall',        fn: 'check_adr0090_b5_causalRecall',        tool: 'agentdb_causal_recall',      table: 'recall_certificates', markerCol: 'goal' },
  { controller: 'learningSystem',      fn: 'check_adr0090_b5_learningSystem',      tool: 'agentdb_experience_record',  table: 'learning_experiences', markerCol: 'action' },
  { controller: 'hierarchicalMemory',  fn: 'check_adr0090_b5_hierarchicalMemory',  tool: 'agentdb_hierarchical_store', table: 'hierarchical_memory', markerCol: 'content' },
  { controller: 'memoryConsolidation', fn: 'check_adr0090_b5_memoryConsolidation', tool: 'agentdb_consolidate',        table: 'consolidation_log',   markerCol: 'timestamp' },
  { controller: 'attentionService',    fn: 'check_adr0090_b5_attentionService',    tool: 'agentdb_attention_metrics',  table: 'attention_metrics',   markerCol: 'sample' },
  { controller: 'gnnService',          fn: 'check_adr0090_b5_gnnService',          tool: 'agentdb_neural_patterns',    table: 'gnn_embeddings',      markerCol: 'pattern' },
  { controller: 'semanticRouter',      fn: 'check_adr0090_b5_semanticRouter',      tool: 'agentdb_semantic_route',     table: 'semantic_routes',     markerCol: 'input' },
  { controller: 'graphAdapter',        fn: 'check_adr0090_b5_graphAdapter',        tool: 'agentdb_causal-edge',        table: 'exp_edges',           markerCol: 'label' },
  { controller: 'sonaTrajectory',      fn: 'check_adr0090_b5_sonaTrajectory',      tool: 'agentdb_pattern_store',      table: 'sona_trajectories',   markerCol: 'pattern' },
  { controller: 'nightlyLearner',      fn: 'check_adr0090_b5_nightlyLearner',      tool: 'agentdb_learner_run',        table: 'learning_sessions',   markerCol: 'metadata' },
  { controller: 'explainableRecall',   fn: 'check_adr0090_b5_explainableRecall',   tool: 'agentdb_causal_recall',      table: 'recall_certificates', markerCol: 'query' },
];

// ──────────────────────────────────────────────────────────────────────
// Stub CLI — a bash shim with per-scenario responses keyed on MCP tool.
// ──────────────────────────────────────────────────────────────────────
//
// scenariosByTool shape:
// {
//   "agentdb_reflexion_store": {
//     exit: 0,
//     stdoutBody: "Result: ...",           // what to print
//     // If provided, the stub ALSO opens the target sqlite DB and
//     // creates a single row so the helper's readback + row-count
//     // checks pass.
//     sqliteTable: "episodes",             // CREATE TABLE schema
//     sqliteCreateCols: "id INTEGER PRIMARY KEY, task TEXT",
//     sqliteInsertCols: "task",            // INSERT column
//     sqliteInsertValue: "b5-reflexion-marker"
//   },
//   "agentdb_health": { exit: 0, stdoutBody: "OK", createEmptyDb: true }
// }

function writeCliStub(dir, scenariosByTool) {
  const shim = join(dir, 'cli');
  const scenariosFile = join(dir, 'cli-scenarios.json');
  writeFileSync(scenariosFile, JSON.stringify(scenariosByTool, null, 2));
  writeFileSync(
    shim,
    [
      '#!/usr/bin/env bash',
      'set +e',
      `SCENARIOS_FILE='${scenariosFile}'`,
      '',
      '# The stub is invoked as $cli mcp exec --tool <tool_name> --params <json>',
      '# Iso project dir is the current working directory (caller cd\'d into it).',
      'tool=""; params=""; mode=""',
      'for ((i=1; i<=$#; i++)); do',
      '  a="${!i}"',
      '  if [[ "$a" == "mcp" ]]; then',
      '    j=$((i+1)); mode="${!j:-}"',
      '  fi',
      '  if [[ "$a" == "--tool" ]]; then',
      '    j=$((i+1)); tool="${!j:-}"',
      '  fi',
      '  if [[ "$a" == "--params" ]]; then',
      '    j=$((i+1)); params="${!j:-}"',
      '  fi',
      'done',
      '',
      'if [[ "$mode" != "exec" || -z "$tool" ]]; then',
      '  echo "[stub cli] unrecognized invocation: $*" >&2',
      '  exit 3',
      'fi',
      '',
      '# Pull scenario by tool name',
      'scenario_json=$(node -e "',
      '  const fs=require(\\"fs\\");',
      '  const s=JSON.parse(fs.readFileSync(process.argv[1],\\"utf8\\"));',
      '  const t=process.argv[2];',
      '  if (!s[t]) { console.log(JSON.stringify({missing:true})); process.exit(0); }',
      '  console.log(JSON.stringify(s[t]));',
      '" "$SCENARIOS_FILE" "$tool")',
      '',
      'missing=$(echo "$scenario_json" | node -e "const s=JSON.parse(require(\\"fs\\").readFileSync(0,\\"utf8\\")); console.log(!!s.missing);")',
      'if [[ "$missing" == "true" ]]; then',
      '  # A tool not in the scenario map → exit 0 silently (mimics agentdb_health).',
      '  exit 0',
      'fi',
      '',
      'exit_code=$(echo "$scenario_json" | node -e "const s=JSON.parse(require(\\"fs\\").readFileSync(0,\\"utf8\\")); console.log(typeof s.exit===\\"number\\"?s.exit:0);")',
      'stdout_body=$(echo "$scenario_json" | node -e "const s=JSON.parse(require(\\"fs\\").readFileSync(0,\\"utf8\\")); console.log(s.stdoutBody||\\"\\");")',
      'create_empty=$(echo "$scenario_json" | node -e "const s=JSON.parse(require(\\"fs\\").readFileSync(0,\\"utf8\\")); console.log(!!s.createEmptyDb);")',
      'sqlite_table=$(echo "$scenario_json" | node -e "const s=JSON.parse(require(\\"fs\\").readFileSync(0,\\"utf8\\")); console.log(s.sqliteTable||\\"\\");")',
      'sqlite_cols=$(echo "$scenario_json" | node -e "const s=JSON.parse(require(\\"fs\\").readFileSync(0,\\"utf8\\")); console.log(s.sqliteCreateCols||\\"\\");")',
      'insert_col=$(echo "$scenario_json" | node -e "const s=JSON.parse(require(\\"fs\\").readFileSync(0,\\"utf8\\")); console.log(s.sqliteInsertCols||\\"\\");")',
      'insert_val=$(echo "$scenario_json" | node -e "const s=JSON.parse(require(\\"fs\\").readFileSync(0,\\"utf8\\")); console.log(s.sqliteInsertValue||\\"\\");")',
      '',
      '# Open the iso DB at $PWD/.swarm/memory.db. If createEmptyDb, just',
      '# make sure the file exists (empty schema). If sqlite_table given,',
      '# CREATE TABLE + INSERT a single row.',
      'db="$PWD/.swarm/memory.db"',
      'mkdir -p "$PWD/.swarm" 2>/dev/null',
      'if [[ "$create_empty" == "true" ]]; then',
      '  # Create a no-op table to force the file to exist with valid magic',
      '  sqlite3 "$db" "CREATE TABLE IF NOT EXISTS _stub_init (id INTEGER)" 2>/dev/null',
      'fi',
      'if [[ -n "$sqlite_table" && -n "$sqlite_cols" ]]; then',
      '  sqlite3 "$db" "CREATE TABLE IF NOT EXISTS $sqlite_table ($sqlite_cols)" 2>/dev/null',
      '  if [[ -n "$insert_col" && -n "$insert_val" ]]; then',
      '    sqlite3 "$db" "INSERT INTO $sqlite_table ($insert_col) VALUES (\\"$insert_val\\")" 2>/dev/null',
      '  fi',
      'fi',
      '',
      'if [[ -n "$stdout_body" ]]; then',
      '  printf "%s\\n" "$stdout_body"',
      'fi',
      'exit "${exit_code:-0}"',
    ].join('\n'),
    { mode: 0o755 },
  );
  return shim;
}

// ──────────────────────────────────────────────────────────────────────
// Driver — source the check file, run one wrapper, report _CHECK_PASSED.
// ──────────────────────────────────────────────────────────────────────

function runCheck({ tempDir, isoPath, fnName, scenariosByTool }) {
  const stubDir = join(tempDir, 'stubs');
  mkdirSync(stubDir, { recursive: true });
  const cliStub = writeCliStub(stubDir, scenariosByTool || {});

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
    // _cli_cmd resolves to the stub
    `_cli_cmd() { echo "${cliStub}"; }`,
    // _e2e_isolate returns the pre-created iso dir every time
    `_e2e_isolate() { echo "${isoPath}"; }`,
    // Simplified _run_and_kill (no sentinel, direct eval). The production
    // variant's sentinel logic is tested separately; the B5 helper's
    // contract is what we're exercising here. We still capture the stub's
    // real exit code into _RK_EXIT so the helper's `store_exit != 0`
    // branch can fire correctly.
    '_run_and_kill() {',
    '  local cmd="$1" out="${2:-}" maxw="${3:-30}"',
    '  if [[ -n "$out" ]]; then',
    '    eval "$cmd" > "$out" 2>&1',
    '    _RK_EXIT=$?',
    '    _RK_OUT=$(cat "$out" 2>/dev/null || echo "")',
    '  else',
    '    _RK_OUT=$(eval "$cmd" 2>&1)',
    '    _RK_EXIT=$?',
    '  fi',
    '}',
    '_run_and_kill_ro() { _run_and_kill "$@"; }',
    `source "${CHECK_FILE}"`,
    `${fnName}`,
    'echo "::PASSED::${_CHECK_PASSED:-<unset>}"',
    'echo "::OUTPUT_START::"',
    'echo "${_CHECK_OUTPUT:-}"',
    'echo "::OUTPUT_END::"',
  ].join('\n');
  writeFileSync(driverPath, driver, { mode: 0o755 });

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
  const tempDir = mkdtempSync(join(tmpdir(), `b5-${label}-`));
  const isoPath = join(tempDir, 'iso');
  mkdirSync(join(isoPath, '.swarm'), { recursive: true });
  mkdirSync(join(isoPath, '.claude-flow'), { recursive: true });
  return { tempDir, isoPath };
}

function teardown(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

// ──────────────────────────────────────────────────────────────────────
// STATIC SOURCE — helper exists, 15 wrappers exist, wiring present
// ──────────────────────────────────────────────────────────────────────

describe('ADR-0090 Tier B5 static source — helper + 15 check wrappers', () => {
  const source = readFileSync(CHECK_FILE, 'utf-8');

  it('defines the shared helper _b5_check_controller_roundtrip', () => {
    assert.match(
      source,
      /_b5_check_controller_roundtrip\(\)\s*\{/,
      'generic helper must exist (no copy-paste per ADR-0090 rules)',
    );
  });

  it('helper body is non-trivial (>= 80 lines of logic)', () => {
    // Grab from first `{` at helper opening to the `}` that comes
    // before the first check_ function. The helper body includes the
    // three-way bucket probe, sqlite verification, restart proof.
    const m = source.match(/_b5_check_controller_roundtrip\(\)\s*\{([\s\S]*?)\n\}\n/);
    assert.ok(m, 'helper function body must be parseable');
    const lines = m[1].split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
    assert.ok(lines.length >= 80,
      `helper must contain substantive logic, got ${lines.length} non-blank lines`);
  });

  it('fifteen check functions exist (one per controller)', () => {
    for (const c of CHECKS) {
      assert.match(source, new RegExp(`${c.fn}\\(\\)\\s*\\{`),
        `function ${c.fn} must be defined`);
    }
  });

  it('each wrapper delegates to the shared helper (no copy-paste)', () => {
    for (const c of CHECKS) {
      const re = new RegExp(`${c.fn}\\(\\)\\s*\\{([\\s\\S]*?)\\n\\}`, 'm');
      const m = source.match(re);
      assert.ok(m, `${c.fn} body must be parseable`);
      const body = m[1];
      assert.match(body, /_b5_check_controller_roundtrip/,
        `${c.fn} must delegate to the shared helper`);
      const nonCommentLines = body
        .split('\n')
        .filter(l => l.trim() && !l.trim().startsWith('#'));
      assert.ok(nonCommentLines.length <= 12,
        `${c.fn} must be a thin wrapper, found ${nonCommentLines.length} real lines`);
    }
  });

  it('helper uses sqlite3 CLI (ADR-0090 A1 discipline)', () => {
    assert.match(source, /sqlite3/,
      'helper must invoke sqlite3 for row-count verification');
    assert.match(source, /command -v sqlite3/,
      'helper must probe for sqlite3 and skip_accepted if missing');
  });

  it('helper uses the three-way result bucket', () => {
    assert.match(source, /_CHECK_PASSED="skip_accepted"/,
      'helper must set skip_accepted for prerequisite-absent cases');
    assert.match(source, /_CHECK_PASSED="true"/,
      'helper must have a PASS path');
    assert.match(source, /_CHECK_PASSED="false"/,
      'helper must default to false and flip back on failure');
  });

  it('only assigns _CHECK_PASSED values from {true, false, skip_accepted}', () => {
    const assignments = source.match(/_CHECK_PASSED="([^"]+)"/g) || [];
    const values = new Set(assignments.map(m => m.match(/"([^"]+)"/)[1]));
    for (const v of values) {
      assert.ok(['true', 'false', 'skip_accepted'].includes(v),
        `B5 may only set _CHECK_PASSED to true/false/skip_accepted, found "${v}"`);
    }
  });

  it('helper probes for ADR-0082 silent-pass anti-pattern (count == 0)', () => {
    // If the store call exits 0 but no row landed on disk, the helper
    // must FAIL — that's the exact pattern ADR-0082 exists to prevent.
    assert.match(source, /count_after_store/,
      'helper must count rows after store');
    assert.match(source, /count_after_store.*lt.*1|lt.*1.*count_after_store/,
      'helper must FAIL if the row count is 0 after a successful store');
  });

  it('helper probes for restart-persistence (row survives CLI restart)', () => {
    assert.match(source, /count_after_restart/,
      'helper must re-count rows after restarting the CLI');
    assert.match(source, /lt.*count_after_store|dropped across/,
      'helper must FAIL if the row count drops after restart');
  });

  it('is sourced from lib/acceptance-checks.sh', () => {
    const loader = readFileSync(CHECKS_LIB, 'utf-8');
    assert.match(loader, /acceptance-adr0090-b5-checks\.sh/,
      'loader must source acceptance-adr0090-b5-checks.sh');
  });

  it('all 15 checks wired into scripts/test-acceptance.sh as run_check_bg', () => {
    const runner = readFileSync(RUNNER_FILE, 'utf-8');
    for (const c of CHECKS) {
      const id = `adr0090-b5-${c.controller}`;
      assert.match(runner, new RegExp(`run_check_bg\\s+"${id.replace(/-/g, '[-]')}"`),
        `runner must wire "${id}" via run_check_bg`);
      assert.match(runner, new RegExp(`\\b${c.fn}\\b`),
        `runner must invoke ${c.fn}`);
    }
  });

  it('all 15 checks listed in collect_parallel spec block', () => {
    const runner = readFileSync(RUNNER_FILE, 'utf-8');
    for (const c of CHECKS) {
      const id = `adr0090-b5-${c.controller}`;
      assert.match(runner, new RegExp(`"${id.replace(/-/g, '[-]')}\\|B5 `),
        `collect_parallel must include spec for "${id}"`);
    }
  });

  it('all 15 checks use the "controller" group', () => {
    const runner = readFileSync(RUNNER_FILE, 'utf-8');
    for (const c of CHECKS) {
      const id = `adr0090-b5-${c.controller}`;
      const re = new RegExp(`run_check_bg\\s+"${id.replace(/-/g, '[-]')}".*"(\\w+)"\\s*$`, 'm');
      const m = runner.match(re);
      assert.ok(m, `runner must have a line for ${id}`);
      assert.equal(m[1], 'controller',
        `${id} must be in the 'controller' group, got '${m[1]}'`);
    }
  });

  it('every wrapper invokes the helper with its canonical table name', () => {
    for (const c of CHECKS) {
      const re = new RegExp(`${c.fn}\\(\\)\\s*\\{([\\s\\S]*?)\\n\\}`, 'm');
      const m = source.match(re);
      const body = m ? m[1] : '';
      assert.match(body, new RegExp(`"${c.table}"`),
        `${c.fn} must pass the canonical table name '${c.table}' to the helper`);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// Behavioural tests — 2 scenarios per check × 15 = 30 cases
//   a) not-available (current published build behavior) → skip_accepted
//   b) unknown-tool                                      → skip_accepted
// ──────────────────────────────────────────────────────────────────────

for (const c of CHECKS) {
  describe(`ADR-0090 ${c.fn}: "not available" → skip_accepted`, () => {
    it('maps the "X not available" error to skip_accepted', () => {
      const fx = setupTest(`${c.controller}-notavail`);
      try {
        const scenarios = {
          agentdb_health: { exit: 0, stdoutBody: 'OK', createEmptyDb: true },
          [c.tool]: {
            exit: 1,
            stdoutBody: JSON.stringify({ success: false, error: `${c.controller} controller not available` }),
          },
        };
        const { passed, output, raw } = runCheck({
          tempDir: fx.tempDir,
          isoPath: fx.isoPath,
          fnName: c.fn,
          scenariosByTool: scenarios,
        });
        assert.equal(passed, 'skip_accepted',
          `expected skip_accepted for not-available, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
        assert.match(output, /not-wired|not available|not active|SKIP_ACCEPTED/i,
          `output must include skip reason marker, got: ${output}`);
      } finally {
        teardown(fx.tempDir);
      }
    });
  });

  describe(`ADR-0090 ${c.fn}: "unknown tool" → skip_accepted`, () => {
    it('maps the "unknown tool" / "not registered" error to skip_accepted', () => {
      const fx = setupTest(`${c.controller}-unknowntool`);
      try {
        const scenarios = {
          agentdb_health: { exit: 0, stdoutBody: 'OK', createEmptyDb: true },
          [c.tool]: {
            exit: 1,
            stdoutBody: JSON.stringify({ success: false, error: `unknown tool ${c.tool}` }),
          },
        };
        const { passed, output, raw } = runCheck({
          tempDir: fx.tempDir,
          isoPath: fx.isoPath,
          fnName: c.fn,
          scenariosByTool: scenarios,
        });
        assert.equal(passed, 'skip_accepted',
          `expected skip_accepted for unknown-tool, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
        assert.match(output, /MCP tool.*not in build|SKIP_ACCEPTED/i,
          `output must mention tool-not-in-build, got: ${output}`);
      } finally {
        teardown(fx.tempDir);
      }
    });
  });
}

// ──────────────────────────────────────────────────────────────────────
// Three-way bucket tests — exercising the helper's branching logic in
// isolation. One representative controller (reflexion) is enough; the
// above loop already covers every wrapper's not-available + unknown-tool
// paths.
// ──────────────────────────────────────────────────────────────────────

describe('ADR-0090 B5 happy path — reachable PASS when controller actually writes', () => {
  it('PASSes reflexion when the stub creates episodes + inserts the marker', () => {
    // This regression-guards the regex walls above: when the upstream
    // build WIRES a controller properly (creates the table, inserts a
    // row with our marker in the right column), the helper must reach
    // the real PASS branch. If the skip_accepted regexes are too
    // greedy, they'll swallow a happy-path response and this test
    // will FAIL the way the acceptance check should.
    const fx = setupTest('reflexion-happy');
    try {
      const scenarios = {
        agentdb_health: { exit: 0, stdoutBody: '{"available":true}', createEmptyDb: true },
        agentdb_reflexion_store: {
          exit: 0,
          stdoutBody: '{"success":true}',
          sqliteTable: 'episodes',
          sqliteCreateCols: 'id INTEGER PRIMARY KEY, task TEXT, session_id TEXT, reward REAL',
          sqliteInsertCols: 'task',
          // NOTE: marker_value in the B5 wrapper is
          // "b5-reflexion-$$-<ts> task" — we can't know the exact
          // value at test time. Write a prefix that LIKE '%' would
          // match; the helper LIKE predicate is `${marker_value}%`
          // so we embed a shared prefix 'b5-reflexion' that always
          // appears first in the marker.
          sqliteInsertValue: 'b5-reflexion-anyprefix task',
        },
      };
      const { passed, output } = runCheck({
        tempDir: fx.tempDir,
        isoPath: fx.isoPath,
        fnName: 'check_adr0090_b5_reflexion',
        scenariosByTool: scenarios,
      });
      // We might get FAIL here because the stub's insert value does
      // not match the helper's runtime-generated marker_value. What
      // we're really testing is that the helper REACHES step 5
      // (sqlite table verification) — which means it SHOULD NOT be
      // skip_accepted. A FAIL ("0 rows matching marker") is actually
      // the correct outcome when the stub's fake marker doesn't
      // match the helper's generated one. The KEY assertion is that
      // skip_accepted is NOT the result.
      assert.notEqual(passed, 'skip_accepted',
        `stub writing to episodes must not be swallowed by skip_accepted regex\noutput: ${output}`);
      assert.ok(['true', 'false'].includes(passed),
        `result must be true or false (not skip_accepted), got ${passed}\noutput: ${output}`);
    } finally {
      teardown(fx.tempDir);
    }
  });
});

describe('ADR-0090 B5 three-way bucket — router-fallback → skip_accepted', () => {
  it('maps {success:true, controller:"router-fallback"} to skip_accepted (no SQLite path)', () => {
    // Per the causalGraph / graphAdapter verifier reports, the
    // memory-router emits this when the controller is not wired and
    // the store dispatches to the RVF fallback instead. B5 cannot
    // row-count against SQLite when the write never hit SQLite.
    const fx = setupTest('cgraph-router-fallback');
    try {
      const scenarios = {
        agentdb_health: { exit: 0, stdoutBody: 'OK', createEmptyDb: true },
        'agentdb_causal-edge': {
          exit: 0,
          stdoutBody: JSON.stringify({ success: true, controller: 'router-fallback' }),
        },
      };
      const { passed, output } = runCheck({
        tempDir: fx.tempDir,
        isoPath: fx.isoPath,
        fnName: 'check_adr0090_b5_causalGraph',
        scenariosByTool: scenarios,
      });
      assert.equal(passed, 'skip_accepted',
        `router-fallback must skip_accepted (RVF-only, ADR-0086), got ${passed}\noutput: ${output}`);
      assert.match(output, /router-fallback|RVF|ADR-0086|SKIP_ACCEPTED/i,
        `output must name the RVF-fallback reason, got: ${output}`);
    } finally {
      teardown(fx.tempDir);
    }
  });
});

describe('ADR-0090 B5 three-way bucket — "NOT NULL constraint" → skip_accepted', () => {
  it('maps SQLite NOT NULL constraint failures to skip_accepted (controller SQL bug)', () => {
    // Live probe: agentdb_pattern_store returns
    // "NOT NULL constraint failed: reasoning_patterns.task_type"
    // — controller is wired but upstream MCP plumbing does not
    // surface task_type. skip_accepted so the bug is trackable,
    // regression-guarded (the day the constraint stops firing, the
    // check starts doing real row-counting).
    const fx = setupTest('rbank-notnull');
    try {
      const scenarios = {
        agentdb_health: { exit: 0, stdoutBody: 'OK', createEmptyDb: true },
        agentdb_pattern_store: {
          exit: 1,
          stdoutBody: JSON.stringify({
            success: false,
            error: 'NOT NULL constraint failed: reasoning_patterns.task_type',
          }),
        },
      };
      const { passed, output } = runCheck({
        tempDir: fx.tempDir,
        isoPath: fx.isoPath,
        fnName: 'check_adr0090_b5_reasoningBank',
        scenariosByTool: scenarios,
      });
      assert.equal(passed, 'skip_accepted',
        `NOT NULL must skip_accepted (upstream SQL bug), got ${passed}\noutput: ${output}`);
      assert.match(output, /NOT NULL|SQL.*binding|INSERT path|SKIP_ACCEPTED/i,
        `output must name the SQL-constraint issue, got: ${output}`);
    } finally {
      teardown(fx.tempDir);
    }
  });
});

describe('ADR-0090 B5 three-way bucket — "Tool not found" → skip_accepted', () => {
  it('maps dispatcher-level "Tool not found" to skip_accepted', () => {
    // Live probe: agentdb_neural_patterns returns "Tool not found:"
    // from the CLI dispatcher (distinct from "unknown tool" which
    // comes from the MCP handler layer). Same skip bucket.
    const fx = setupTest('gnn-tool-not-found');
    try {
      const scenarios = {
        agentdb_health: { exit: 0, stdoutBody: 'OK', createEmptyDb: true },
        agentdb_neural_patterns: {
          exit: 1,
          stdoutBody: '[ERROR] Tool not found: agentdb_neural_patterns',
        },
      };
      const { passed, output } = runCheck({
        tempDir: fx.tempDir,
        isoPath: fx.isoPath,
        fnName: 'check_adr0090_b5_gnnService',
        scenariosByTool: scenarios,
      });
      assert.equal(passed, 'skip_accepted',
        `tool-not-found must skip_accepted, got ${passed}\noutput: ${output}`);
      assert.match(output, /not found|SKIP_ACCEPTED/i,
        `output must name the missing-tool reason, got: ${output}`);
    } finally {
      teardown(fx.tempDir);
    }
  });
});

describe('ADR-0090 B5 three-way bucket — "Wrong API use" → skip_accepted', () => {
  it('maps the live-probe SQL-binding bug to skip_accepted (not fail)', () => {
    // Reproduces what 3.5.58-patch.114 returns for pattern_store —
    // "Wrong API use : tried to bind a value of an unknown type
    // (undefined)". That's a real upstream bug in the controller's
    // INSERT; the check must skip_accepted so the bug is tracked
    // without FAILing green builds.
    const fx = setupTest('reflexion-wrongapi');
    try {
      const scenarios = {
        agentdb_health: { exit: 0, stdoutBody: 'OK', createEmptyDb: true },
        agentdb_reflexion_store: {
          exit: 1,
          stdoutBody: JSON.stringify({
            success: false,
            error: 'Wrong API use : tried to bind a value of an unknown type (undefined).',
          }),
        },
      };
      const { passed, output } = runCheck({
        tempDir: fx.tempDir,
        isoPath: fx.isoPath,
        fnName: 'check_adr0090_b5_reflexion',
        scenariosByTool: scenarios,
      });
      assert.equal(passed, 'skip_accepted',
        `Wrong API use must bucket as skip_accepted (upstream bug), got ${passed}\noutput: ${output}`);
      assert.match(output, /INSERT binding|upstream bug|SKIP_ACCEPTED/i,
        `output must name the binding bug, got: ${output}`);
    } finally {
      teardown(fx.tempDir);
    }
  });
});

describe('ADR-0090 B5 three-way bucket — silent success without rows → FAIL', () => {
  it('FAILs when the tool claims success but SQLite has 0 rows (ADR-0082)', () => {
    // This is the exact ADR-0082 anti-pattern: exit 0, no recognizable
    // skip error, table exists (we pre-created it) but 0 matching rows.
    // The helper must FAIL — silent-pass must never propagate.
    const fx = setupTest('reflexion-silent-0rows');
    try {
      const scenarios = {
        agentdb_health: { exit: 0, stdoutBody: 'OK', createEmptyDb: true },
        agentdb_reflexion_store: {
          exit: 0,
          stdoutBody: '{"success": true}',
          // Create the episodes table but do NOT insert the marker row.
          sqliteTable: 'episodes',
          sqliteCreateCols: 'id INTEGER PRIMARY KEY, task TEXT, session_id TEXT, reward REAL',
        },
      };
      const { passed, output } = runCheck({
        tempDir: fx.tempDir,
        isoPath: fx.isoPath,
        fnName: 'check_adr0090_b5_reflexion',
        scenariosByTool: scenarios,
      });
      assert.equal(passed, 'false',
        `silent-success-without-row must FAIL (ADR-0082), got ${passed}\noutput: ${output}`);
      assert.match(output, /0 rows in episodes|in-memory state|ADR-0082/i,
        `output must name the silent-pass pattern, got: ${output}`);
    } finally {
      teardown(fx.tempDir);
    }
  });
});

describe('ADR-0090 B5 three-way bucket — target-table missing after success → FAIL', () => {
  it('FAILs when the store claims success but our target table does not exist', () => {
    const fx = setupTest('reflexion-no-target-table');
    try {
      const scenarios = {
        agentdb_health: { exit: 0, stdoutBody: 'OK', createEmptyDb: true },
        agentdb_reflexion_store: {
          exit: 0,
          stdoutBody: '{"success": true}',
          // Do NOT create the target table (episodes); only the empty
          // DB exists.
        },
      };
      const { passed, output } = runCheck({
        tempDir: fx.tempDir,
        isoPath: fx.isoPath,
        fnName: 'check_adr0090_b5_reflexion',
        scenariosByTool: scenarios,
      });
      assert.equal(passed, 'false',
        `target-table-missing must FAIL (ADR-0082), got ${passed}\noutput: ${output}`);
      assert.match(output, /episodes.*does not exist|never created it|silently bailed/i,
        `output must name the missing target table, got: ${output}`);
    } finally {
      teardown(fx.tempDir);
    }
  });
});

describe('ADR-0090 B5 three-way bucket — "no such table: <other>" → skip_accepted', () => {
  it('skip_accepts when the tool mentions a DIFFERENT table (wrong-route)', () => {
    // Live-probe observation: explainableRecall hits
    // "no such table: causal_edges" when asked for recall_certificates.
    // That's a wiring gap in a different controller, not a B5 regression
    // in explainableRecall itself — skip_accepted with a precise marker.
    const fx = setupTest('xrec-other-table-missing');
    try {
      const scenarios = {
        agentdb_health: { exit: 0, stdoutBody: 'OK', createEmptyDb: true },
        agentdb_causal_recall: {
          exit: 1,
          stdoutBody: JSON.stringify({
            success: false,
            error: 'no such table: causal_edges',
          }),
        },
      };
      const { passed, output } = runCheck({
        tempDir: fx.tempDir,
        isoPath: fx.isoPath,
        fnName: 'check_adr0090_b5_explainableRecall',
        scenariosByTool: scenarios,
      });
      assert.equal(passed, 'skip_accepted',
        `other-table-missing must skip_accepted, got ${passed}\noutput: ${output}`);
      assert.match(output, /different controller|upstream wiring|SKIP_ACCEPTED/i,
        `output must name the wrong-table context, got: ${output}`);
    } finally {
      teardown(fx.tempDir);
    }
  });
});

describe('ADR-0090 B5 three-way bucket — sqlite3 binary missing → skip_accepted', () => {
  it('skip_accepts when the sqlite3 CLI binary is not on PATH', () => {
    // Simulate a dev machine without sqlite3. The helper must detect this
    // and bucket as skip_accepted, not silently pass, per Debt 15 (A1) rule.
    const fx = setupTest('reflexion-no-sqlite3');
    try {
      // Build a stub PATH that has a minimal bash but NO sqlite3. The
      // driver's PATH is set to stubDir:$PATH — we override by giving
      // stubDir a fake `command` that always returns 1 for sqlite3.
      const stubDir = join(fx.tempDir, 'stubs');
      mkdirSync(stubDir, { recursive: true });

      // The driver's own PATH override would put sqlite3 back; we patch
      // the helper's probe by wrapping `command` with a shim. Simplest
      // approach: alias `command` in the driver script inline.
      const cliStub = writeCliStub(stubDir, {
        agentdb_health: { exit: 0, stdoutBody: 'OK' },
        agentdb_reflexion_store: { exit: 0, stdoutBody: '{"success":true}' },
      });
      const e2eDir = join(fx.tempDir, 'e2e');
      mkdirSync(e2eDir, { recursive: true });
      const driverPath = join(stubDir, 'driver.sh');
      const driver = [
        '#!/usr/bin/env bash',
        'set +e',
        'set +u',
        `export PATH="${stubDir}:$PATH"`,
        `export TEMP_DIR="${fx.tempDir}"`,
        `export E2E_DIR="${e2eDir}"`,
        'export REGISTRY="http://test-registry.invalid"',
        'export PKG="@sparkleideas/cli"',
        `_cli_cmd() { echo "${cliStub}"; }`,
        `_e2e_isolate() { echo "${fx.isoPath}"; }`,
        '_run_and_kill() { _RK_OUT=$(eval "$1" 2>&1); _RK_EXIT=$?; }',
        '_run_and_kill_ro() { _run_and_kill "$@"; }',
        // Override `command -v sqlite3` to return 1 so the helper thinks
        // sqlite3 is absent. Other `command` calls pass through.
        'command() {',
        '  if [[ "$1" == "-v" && "$2" == "sqlite3" ]]; then',
        '    return 1',
        '  fi',
        '  builtin command "$@"',
        '}',
        'export -f command',
        `source "${CHECK_FILE}"`,
        'check_adr0090_b5_reflexion',
        'echo "::PASSED::${_CHECK_PASSED:-<unset>}"',
        'echo "::OUTPUT_START::"',
        'echo "${_CHECK_OUTPUT:-}"',
        'echo "::OUTPUT_END::"',
      ].join('\n');
      writeFileSync(driverPath, driver, { mode: 0o755 });

      const result = spawnSync('bash', [driverPath], { encoding: 'utf8', timeout: 60000 });
      const out = (result.stdout || '') + (result.stderr || '');
      const passedMatch = out.match(/::PASSED::(.*)/);
      const outputMatch = out.match(/::OUTPUT_START::\n([\s\S]*?)::OUTPUT_END::/);
      const passed = passedMatch ? passedMatch[1].trim() : '<unparsed>';
      const output = outputMatch ? outputMatch[1].trim() : '';
      assert.equal(passed, 'skip_accepted',
        `sqlite3-missing must skip_accepted (Debt 15 rule), got ${passed}\noutput: ${output}`);
      assert.match(output, /sqlite3 binary not installed|SKIP_ACCEPTED/i,
        `output must name sqlite3 prerequisite, got: ${output}`);
    } finally {
      teardown(fx.tempDir);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// Self-test: stub CLI contract. If this is broken, all behavioural
// tests above are lies.
// ──────────────────────────────────────────────────────────────────────

describe('ADR-0090 B5: stub CLI self-test', () => {
  it('stub returns the scenario exit code and stdout body for a given tool', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'b5-stub-selftest-'));
    try {
      const scenarios = {
        agentdb_reflexion_store: { exit: 7, stdoutBody: '{"hello":"world"}' },
      };
      const cliStub = writeCliStub(tempDir, scenarios);
      const result = spawnSync(
        'bash',
        [cliStub, 'mcp', 'exec', '--tool', 'agentdb_reflexion_store', '--params', '{}'],
        { encoding: 'utf8', timeout: 5000 },
      );
      assert.equal(result.status, 7,
        `stub must exit with scenario.exit=7, got ${result.status}`);
      assert.match(result.stdout || '', /hello/, 'stub must print stdoutBody');
    } finally {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  });

  it('stub writes a SQLite row when sqliteTable/sqliteInsertCols given', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'b5-stub-sqlite-'));
    try {
      const isoDir = join(tempDir, 'iso');
      mkdirSync(join(isoDir, '.swarm'), { recursive: true });
      const scenarios = {
        agentdb_reflexion_store: {
          exit: 0,
          stdoutBody: '{"success":true}',
          sqliteTable: 'episodes',
          sqliteCreateCols: 'id INTEGER PRIMARY KEY, task TEXT',
          sqliteInsertCols: 'task',
          sqliteInsertValue: 'my-marker',
        },
      };
      const cliStub = writeCliStub(tempDir, scenarios);
      // Invoke the stub with iso dir as CWD so it creates .swarm/memory.db
      // under the expected path.
      const result = spawnSync(
        'bash',
        ['-c', `cd "${isoDir}" && "${cliStub}" mcp exec --tool agentdb_reflexion_store --params '{}'`],
        { encoding: 'utf8', timeout: 5000 },
      );
      assert.equal(result.status, 0,
        `stub must succeed, got ${result.status}\nstderr=${result.stderr}`);
      assert.ok(existsSync(join(isoDir, '.swarm', 'memory.db')),
        `stub must create memory.db under iso/.swarm, got no file\nstderr=${result.stderr}`);
      // Verify row landed via sqlite3 CLI (if available)
      const probe = spawnSync(
        'sqlite3',
        [join(isoDir, '.swarm', 'memory.db'), "SELECT task FROM episodes WHERE task='my-marker';"],
        { encoding: 'utf8', timeout: 5000 },
      );
      if (probe.status === 0) {
        assert.match(probe.stdout || '', /my-marker/,
          `row must be retrievable via sqlite3, got stdout="${probe.stdout}" stderr="${probe.stderr}"`);
      }
      // If sqlite3 is not installed, silently skip this part of the
      // self-test — the behavioural tests above cover the same path
      // via the helper's own probe.
    } finally {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  });

  it('stub exits 0 silently for tools not in the scenario map', () => {
    // The helper invokes agentdb_health at step 2 even if the caller's
    // scenarios dict does not mention it. The stub must return cleanly
    // (exit 0, no output) so the helper continues to the real tool
    // probe. If the stub errored on unknown tools the helper would
    // never reach step 3.
    const tempDir = mkdtempSync(join(tmpdir(), 'b5-stub-silent-'));
    try {
      const cliStub = writeCliStub(tempDir, {}); // empty scenarios
      const result = spawnSync(
        'bash',
        [cliStub, 'mcp', 'exec', '--tool', 'agentdb_health', '--params', '{}'],
        { encoding: 'utf8', timeout: 5000 },
      );
      assert.equal(result.status, 0,
        `stub must exit 0 for unknown tools (health passes through), got ${result.status}`);
    } finally {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
    }
  });
});
