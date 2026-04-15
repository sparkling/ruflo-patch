// @tier unit
// ADR-0090 Tier A1: upgrade Debt 15 guard from facade to controller persistence.
//
// Context
// -------
// The previous `check_adr0086_debt15_sqlite_path` (lib/acceptance-adr0086-checks.sh)
// claimed to guard ADR-0086's Debt 15 trade-off (neural controllers persist via
// SQLite-backed agentdb, not RVF) but was a facade:
//
//   1. File exists after `agentdb_health` — agentdb auto-creates at cold start
//   2. SQLite magic header — trivially present after agentdb init
//   3. Size >= 4096 bytes — an empty agentdb schema is already 20-40KB
//   4. `memory-router.js` grep for "sqlite" — source-level, not runtime
//
// None of those guards verify that a controller actually persisted anything.
// If all 15 neural controllers silently fell back to in-memory state after an
// upstream merge, the old check would still report green.
//
// The Tier A1 upgrade layers runtime proof on top of the facade guards:
//
//   Step 1 (prereq): `sqlite3` CLI binary must be present, else SKIP_ACCEPTED
//     (ADR-0082: no silent passes — a missing prereq is a visible warning,
//      not a pass, and uses the three-way harness bucket from Tier A2).
//   Step 2 (facade guards — kept intact): file exists + magic + size +
//     memory-router.js grep. Four distinct properties, all still checked.
//   Step 3 (runtime write): MCP call to `agentdb_reflexion_store` routes via
//     getController('reflexion') → ControllerRegistry → agentdb.database →
//     SQLite `episodes` table. Query row count for our unique marker task.
//   Step 4 (persistence proof): kill CLI, reopen via agentdb_health, re-query.
//     Row count must still be >= 1 — proves the row survived process restart
//     (i.e. was not just in-memory state that shared address space with the CLI).
//
// Test design
// -----------
// London School mocks: we source the REAL bash check function in a subshell
// and replace its collaborators with stubs:
//   - `_cli_cmd` → path to a stub cli binary (no npx, no real CLI)
//   - `_run_and_kill`, `_run_and_kill_ro` → synchronous `eval` with _RK_OUT capture
//   - `sqlite3` → a PATH shim script that prints rehearsed outputs from a sidecar
//                 state file (so each query returns exactly what the test wants)
//   - `_CHECK_PASSED`/`_CHECK_OUTPUT` → harvested after the function returns
//
// This lets us deterministically exercise every branch of the upgraded check
// without needing a real init'd project, a real Verdaccio, or a real agentdb.
// The REAL `_debt15_count_reflexion_rows` helper runs inside the subshell and
// shells out to our shimmed `sqlite3`, so we're testing the real path logic —
// not a parallel reimplementation.
//
// Integration test
// ----------------
// A small end-to-end suite that builds a real SQLite file with the `episodes`
// schema and a real seed row, then invokes the check function against the real
// `sqlite3` binary (skipped gracefully if sqlite3 isn't installed — using the
// SAME SKIP_ACCEPTED path the check itself takes).
//
// Cases (from ADR-0090 A1 spec)
// -----
//   Case 1: sqlite3 returns >= 1 both pre- and post-restart   → PASS
//   Case 2: sqlite3 returns 0 on first query                  → FAIL (not pass)
//   Case 3: sqlite3 binary missing                            → SKIP_ACCEPTED
//   Case 4: first query returns 1, post-restart returns 0     → FAIL (persistence)
//   Case 5: episodes table does not exist                     → FAIL (in-memory fallback)
//   Case 6: facade guards still defend their properties       → FAIL on bad magic

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { execSync, spawnSync } from 'node:child_process';
import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-adr0086-checks.sh');
const HARNESS_FILE = resolve(ROOT, 'lib', 'acceptance-harness.sh');

// ────────────────────────────────────────────────────────────────────────
// Shared test plumbing
// ────────────────────────────────────────────────────────────────────────

/**
 * SQLite format 3 magic header — valid 4096-byte file starts with
 * "SQLite format 3\0" + zero-filled page. This is enough to pass the
 * facade magic + size guards without building a real SQLite file.
 * (We still shim sqlite3, so the bytes after the header don't matter.)
 */
function writeFakeSqliteFile(path, sizeBytes = 8192) {
  const header = Buffer.from('SQLite format 3\x00', 'binary');
  const body = Buffer.alloc(Math.max(0, sizeBytes - header.length), 0);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.concat([header, body]));
}

/**
 * Stub the @sparkleideas/cli package directory so `_adr0086_find_cli_pkg`
 * succeeds. The grep for "sqlite" in memory-router.js must also succeed,
 * so we drop a minimal memory-router.js with the word in it.
 */
function writeFakeCliPkg(tempDir) {
  const pkgDir = join(tempDir, 'node_modules', '@sparkleideas', 'cli');
  mkdirSync(pkgDir, { recursive: true });
  // Minimal memory-router.js — must contain "sqlite" for the grep guard
  writeFileSync(
    join(pkgDir, 'memory-router.js'),
    "// stub memory-router.js for ADR-0090 A1 test\n// routeMemoryOp uses sqlite config block\n",
  );
}

/**
 * Write a bash shim at `$dir/sqlite3` that prints rehearsed outputs based
 * on a state file. Each line of the state file is one "response", consumed
 * in order. A state file entry of "__SKIP_TABLE__" means "print nothing"
 * (simulates `episodes` table missing). Anything else is printed as-is.
 *
 * The shim distinguishes the two query types by argv-scanning:
 *   - Table-existence probe (first arg contains `sqlite_master`) → first state
 *     line
 *   - COUNT(*) query (arg contains `COUNT(*)` or `SELECT COUNT`) → second state
 *     line for the first call, third for the second call (restart)
 */
function writeSqlite3Shim(dir, stateFile) {
  const shimPath = join(dir, 'sqlite3');
  // The shim records which query it's seeing into a counter file to handle
  // multiple COUNT queries in order (pre-restart vs post-restart).
  const counterFile = join(dir, '.sqlite3-counter');
  writeFileSync(counterFile, '0');
  const body = [
    '#!/usr/bin/env bash',
    '# ADR-0090 A1 test shim for sqlite3. Reads responses from a state file',
    '# to deterministically serve each query in the check function.',
    'set -u',
    `STATE_FILE='${stateFile}'`,
    `COUNTER_FILE='${counterFile}'`,
    '# Query arrives as: sqlite3 <db> "<SQL>"',
    'sql="${*: -1}"  # last arg is the SQL string',
    'if [[ "$sql" == *sqlite_master* ]]; then',
    '  # Table-existence probe — always served from state line index "table"',
    `  awk '/^table:/{ sub(/^table: */, ""); print; exit }' "$STATE_FILE"`,
    '  exit 0',
    'fi',
    'if [[ "$sql" == *"COUNT"* ]]; then',
    '  # Nth COUNT query — consume a counter-indexed state line',
    '  n=$(cat "$COUNTER_FILE")',
    '  n=$((n + 1))',
    '  echo "$n" > "$COUNTER_FILE"',
    `  awk -v n="$n" '/^count:/{ i++; if (i==n) { sub(/^count: */, ""); print; exit } }' "$STATE_FILE"`,
    '  exit 0',
    'fi',
    '# Unknown query — print nothing, exit 0 (benign default)',
    'exit 0',
  ].join('\n');
  writeFileSync(shimPath, body, { mode: 0o755 });
  return shimPath;
}

/**
 * Build a sqlite3 state file from structured test intent.
 * @param {object} spec
 * @param {string|null} spec.table   — 'episodes' (present) | null (absent)
 * @param {number[]} spec.counts      — ordered list of COUNT(*) responses
 */
function writeSqlite3State(stateFile, spec) {
  const lines = [];
  lines.push(`table: ${spec.table ?? ''}`);
  for (const c of spec.counts || []) {
    lines.push(`count: ${c}`);
  }
  writeFileSync(stateFile, lines.join('\n') + '\n');
}

/**
 * Stub `_cli_cmd` by writing a tiny "cli" binary that just echoes "ok"
 * and exits 0. The check function does not inspect its stdout — it uses
 * `_run_and_kill` to exec it and then immediately queries sqlite3.
 */
function writeCliStub(dir) {
  const cliPath = join(dir, 'cli');
  writeFileSync(
    cliPath,
    '#!/usr/bin/env bash\necho "stub cli ok"\nexit 0\n',
    { mode: 0o755 },
  );
  return cliPath;
}

/**
 * Run `check_adr0086_debt15_sqlite_path` in an isolated bash subshell
 * with mocked collaborators. Returns parsed { passed, output }.
 */
function runCheck({ tempDir, cliStubPath, pathShimDir, omitSqlite3 = false }) {
  // Build PATH that includes the shim dir first, or excludes sqlite3 entirely
  // if the test case is "sqlite3 missing".
  let pathPrefix;
  if (omitSqlite3) {
    // Use a minimal PATH with only `/usr/bin` sans-sqlite3 — easiest way
    // is to build a scratch bin dir containing only the commands the
    // check function needs (head, wc, grep, od, find, date, tr, mktemp,
    // bc, sleep, kill, pkill, cat, sed, echo, awk) but NOT sqlite3.
    const scratchBin = join(tmpdir(), `a1-nosqlite3-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(scratchBin, { recursive: true });
    for (const cmd of [
      'head', 'wc', 'grep', 'od', 'find', 'date', 'tr', 'mktemp',
      'bc', 'sleep', 'kill', 'pkill', 'cat', 'sed', 'echo', 'awk',
      'true', 'false', 'basename', 'dirname', 'rm', 'ls', 'touch',
      'id', 'uname',
    ]) {
      // Symlink the real binary from /bin or /usr/bin
      for (const p of ['/usr/bin', '/bin', '/opt/homebrew/bin']) {
        if (existsSync(join(p, cmd))) {
          try {
            execSync(`ln -sf "${join(p, cmd)}" "${join(scratchBin, cmd)}"`);
          } catch {}
          break;
        }
      }
    }
    pathPrefix = `export PATH="${scratchBin}"\n`;
  } else {
    pathPrefix = `export PATH="${pathShimDir}:$PATH"\n`;
  }

  const driverPath = join(tmpdir(), `a1-driver-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`);
  const driver = [
    '#!/usr/bin/env bash',
    'set +e',
    'set +u',
    pathPrefix,
    `export TEMP_DIR="${tempDir}"`,
    'export REGISTRY="http://test-registry.invalid"',
    'export PKG="@sparkleideas/cli"',
    // Override _cli_cmd before sourcing (the check defines `cli=$(_cli_cmd)`)
    `_cli_cmd() { echo "${cliStubPath}"; }`,
    // Replace _run_and_kill with a synchronous eval that sets _RK_OUT/_RK_EXIT.
    // The real helper uses sentinels + poll + bc — too flaky to exercise in
    // a unit test. We only care that the command gets evaluated (so side
    // effects like schema creation would happen if this were real).
    '_run_and_kill() {',
    '  local cmd="$1"',
    '  _RK_OUT=$(eval "$cmd" 2>&1)',
    '  _RK_EXIT=$?',
    '}',
    '_run_and_kill_ro() { _run_and_kill "$@"; }',
    // Source the real check file — it uses `_adr0086_find_cli_pkg` which
    // scans TEMP_DIR/node_modules, so our writeFakeCliPkg setup satisfies it.
    `source "${CHECK_FILE}"`,
    'check_adr0086_debt15_sqlite_path',
    'echo "::PASSED::$_CHECK_PASSED"',
    'echo "::OUTPUT::$_CHECK_OUTPUT"',
  ].join('\n');
  writeFileSync(driverPath, driver, { mode: 0o755 });

  try {
    const result = spawnSync('bash', [driverPath], {
      encoding: 'utf8',
      timeout: 15000,
    });
    const out = (result.stdout || '') + (result.stderr || '');
    const passedMatch = out.match(/::PASSED::(.*)/);
    const outputMatch = out.match(/::OUTPUT::(.*)/);
    return {
      passed: passedMatch ? passedMatch[1].trim() : '<unparsed>',
      output: outputMatch ? outputMatch[1].trim() : '',
      raw: out,
    };
  } finally {
    try { rmSync(driverPath, { force: true }); } catch {}
  }
}

function setupFakeProject(label) {
  const tempDir = mkdtempSync(join(tmpdir(), `a1-proj-${label}-`));
  mkdirSync(join(tempDir, '.swarm'), { recursive: true });
  // Valid-looking SQLite file (>4096B, valid magic)
  writeFakeSqliteFile(join(tempDir, '.swarm', 'memory.db'), 8192);
  writeFakeCliPkg(tempDir);
  const stubDir = join(tempDir, '.stubs');
  mkdirSync(stubDir, { recursive: true });
  const cliStubPath = writeCliStub(stubDir);
  const stateFile = join(stubDir, 'sqlite3-state.txt');
  writeSqlite3Shim(stubDir, stateFile);
  return { tempDir, cliStubPath, pathShimDir: stubDir, stateFile };
}

function teardown(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

// ────────────────────────────────────────────────────────────────────────
// Static source assertions — the upgrade is physically present in the file
// ────────────────────────────────────────────────────────────────────────

describe('ADR-0090 Tier A1: static source — upgrade landed', () => {
  const source = readFileSync(CHECK_FILE, 'utf-8');

  it('check_adr0086_debt15_sqlite_path still exists as a function', () => {
    assert.match(source, /check_adr0086_debt15_sqlite_path\(\)\s*\{/,
      'function definition must still be present');
  });

  it('introduces _debt15_count_reflexion_rows helper', () => {
    assert.match(source, /_debt15_count_reflexion_rows\(\)\s*\{/,
      'helper function must be defined');
  });

  it('helper queries sqlite_master for episodes table existence', () => {
    assert.match(source, /sqlite_master.*episodes/,
      'helper must probe sqlite_master for the episodes table');
  });

  it('helper queries episodes.task with the ADR-0090 A1 marker prefix', () => {
    assert.match(source, /task LIKE 'acceptance test reflexion adr0090/,
      'helper must filter episodes by the ADR-0090 A1 marker task');
  });

  it('uses the sqlite3 CLI binary, NOT better-sqlite3 (Tier B4 rule)', () => {
    // Scope to the NEW code only — _debt15_count_reflexion_rows helper
    // and check_adr0086_debt15_sqlite_path body. Other functions in this
    // file legitimately reference "better-sqlite3" (e.g. the T3.3 blocker
    // tracker at check_real_sqlite3_blockers), so a global grep is wrong.
    // Also, the function body intentionally mentions "better-sqlite3" in a
    // comment explaining WHY we use the CLI instead — that's correct
    // documentation, not a code dep. Only fail on *active* uses:
    // require()/import/exec/node process that actually loads better-sqlite3.
    const helper = extractFn(source, '_debt15_count_reflexion_rows');
    const mainFn = extractFn(source, 'check_adr0086_debt15_sqlite_path');
    assert.ok(helper, '_debt15_count_reflexion_rows body must extract');
    assert.ok(mainFn, 'check_adr0086_debt15_sqlite_path body must extract');
    const combined = helper + '\n' + mainFn;
    assert.match(combined, /sqlite3 "\$db_file"/,
      'Debt 15 code must shell out to the sqlite3 CLI binary');
    // Strip comment lines (leading whitespace + `#`) before checking for
    // active uses — comments documenting the rationale are allowed.
    const noComments = combined
      .split('\n')
      .filter(line => !/^\s*#/.test(line))
      .join('\n');
    assert.doesNotMatch(noComments, /require\(['"]better-sqlite3['"]\)/,
      'Debt 15 code must NOT require() better-sqlite3');
    assert.doesNotMatch(noComments, /import.*better-sqlite3/,
      'Debt 15 code must NOT import better-sqlite3');
    assert.doesNotMatch(noComments, /npm install.*better-sqlite3|npm i.*better-sqlite3/,
      'Debt 15 code must NOT install better-sqlite3');
    assert.doesNotMatch(noComments, /node -e.*better-sqlite3/,
      'Debt 15 code must NOT shell out to node -e with better-sqlite3');
  });

  it('emits SKIP_ACCEPTED with marker when sqlite3 is missing', () => {
    // Narrow to the function body
    const fn = extractFn(source, 'check_adr0086_debt15_sqlite_path');
    assert.ok(fn, 'function body must extract');
    assert.match(fn, /command -v sqlite3/,
      'function must probe sqlite3 via command -v');
    assert.match(fn, /_CHECK_PASSED="skip_accepted"/,
      'function must set _CHECK_PASSED="skip_accepted" when sqlite3 absent');
    assert.match(fn, /SKIP_ACCEPTED/,
      'function must emit SKIP_ACCEPTED marker in output');
  });

  it('invokes agentdb_reflexion_store via MCP with the marker task', () => {
    const fn = extractFn(source, 'check_adr0086_debt15_sqlite_path');
    assert.match(fn, /agentdb_reflexion_store/,
      'function must call the agentdb_reflexion_store MCP tool');
    assert.match(fn, /acceptance test reflexion adr0090/,
      'function must use the ADR-0090 A1 marker task string');
  });

  it('performs the kill-and-reopen persistence proof (two row-count queries)', () => {
    const fn = extractFn(source, 'check_adr0086_debt15_sqlite_path');
    // The check has two distinct calls to _debt15_count_reflexion_rows:
    // one after the store, one after the reopen.
    const matches = fn.match(/_debt15_count_reflexion_rows/g) || [];
    assert.ok(matches.length >= 2,
      `expected >= 2 calls to _debt15_count_reflexion_rows (one pre-restart, one post-restart), got ${matches.length}`);
  });

  it('retains the four original facade guards (file, magic, size, router grep)', () => {
    const fn = extractFn(source, 'check_adr0086_debt15_sqlite_path');
    assert.match(fn, /SQLite format 3/, 'magic-header guard kept');
    assert.match(fn, /size.*4096|4096/, 'size >= 4096 guard kept');
    assert.match(fn, /memory-router\.js/, 'memory-router.js grep guard kept');
    assert.match(fn, /_adr0086_find_cli_pkg/, 'CLI package locator kept');
  });

  it('uses $(_cli_cmd), never raw "npx --yes @sparkleideas/cli@latest"', () => {
    const fn = extractFn(source, 'check_adr0086_debt15_sqlite_path');
    assert.doesNotMatch(fn, /npx\s+--yes\s+@sparkleideas\/cli@latest/,
      'CLAUDE.md rule: never use raw npx @latest in acceptance (36x slowdown)');
    assert.match(fn, /\$\(_cli_cmd\)/, 'must use $(_cli_cmd) helper');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Unit — London School mocks, each branch of the upgraded check
// ────────────────────────────────────────────────────────────────────────

describe('ADR-0090 Tier A1 Case 1: sqlite3 returns >= 1 pre + post restart → PASS', () => {
  it('returns _CHECK_PASSED=true when the episodes row survives restart', () => {
    const fx = setupFakeProject('case1');
    try {
      writeSqlite3State(fx.stateFile, {
        table: 'episodes',
        // Order: first COUNT is pre-restart, second is post-restart
        counts: [1, 1],
      });
      const { passed, output, raw } = runCheck(fx);
      assert.equal(passed, 'true',
        `expected PASS, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /persisted across CLI restart/,
        'success message should highlight the persistence proof');
    } finally {
      teardown(fx.tempDir);
    }
  });
});

describe('ADR-0090 Tier A1 Case 2: first query returns 0 → FAIL', () => {
  it('returns _CHECK_PASSED=false with "0 rows" diagnostic', () => {
    const fx = setupFakeProject('case2');
    try {
      writeSqlite3State(fx.stateFile, {
        table: 'episodes',
        counts: [0, 0], // table exists, but zero marker rows
      });
      const { passed, output, raw } = runCheck(fx);
      assert.equal(passed, 'false',
        `expected FAIL on zero-rows, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /0 rows in episodes table|in-memory state/,
        `expected diagnostic naming "0 rows" or "in-memory state", got: ${output}`);
      assert.notEqual(passed, 'skip_accepted',
        'zero rows must FAIL, not skip — this is a regression signal');
    } finally {
      teardown(fx.tempDir);
    }
  });
});

describe('ADR-0090 Tier A1 Case 3: sqlite3 binary missing → SKIP_ACCEPTED', () => {
  it('returns _CHECK_PASSED=skip_accepted with SKIP_ACCEPTED marker', () => {
    const fx = setupFakeProject('case3');
    try {
      // Irrelevant — state file won't be read because sqlite3 is absent
      writeSqlite3State(fx.stateFile, { table: 'episodes', counts: [1, 1] });
      const { passed, output, raw } = runCheck({ ...fx, omitSqlite3: true });
      assert.equal(passed, 'skip_accepted',
        `expected skip_accepted when sqlite3 missing, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /SKIP_ACCEPTED/,
        `expected SKIP_ACCEPTED marker in output, got: ${output}`);
      assert.match(output, /sqlite3 binary not installed/,
        `expected human-readable reason, got: ${output}`);
      assert.notEqual(passed, 'true',
        'missing prereq must NEVER be reported as PASS (ADR-0082)');
    } finally {
      teardown(fx.tempDir);
    }
  });
});

describe('ADR-0090 Tier A1 Case 4: first query >= 1 but post-restart = 0 → FAIL', () => {
  it('returns _CHECK_PASSED=false with "persistence broken" diagnostic', () => {
    const fx = setupFakeProject('case4');
    try {
      writeSqlite3State(fx.stateFile, {
        table: 'episodes',
        counts: [1, 0], // row present before restart, gone after
      });
      const { passed, output, raw } = runCheck(fx);
      assert.equal(passed, 'false',
        `expected FAIL on persistence break, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /persistence broken|post.*restart|after CLI restart/,
        `expected persistence diagnostic, got: ${output}`);
      // Crucial: this case previously silent-passed in the facade check
      // because the facade never queried row counts at all.
      assert.notEqual(passed, 'true',
        'REGRESSION: persistence break must not silent-pass');
    } finally {
      teardown(fx.tempDir);
    }
  });
});

describe('ADR-0090 Tier A1 Case 5: episodes table does not exist → FAIL', () => {
  it('flags silent in-memory fallback when episodes table is absent', () => {
    const fx = setupFakeProject('case5');
    try {
      // table: empty → our shim prints nothing → helper returns empty
      writeSqlite3State(fx.stateFile, { table: '', counts: [] });
      const { passed, output, raw } = runCheck(fx);
      assert.equal(passed, 'false',
        `expected FAIL when episodes table missing, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /episodes table does not exist|silent in-memory fallback/,
        `expected "episodes table missing" diagnostic, got: ${output}`);
    } finally {
      teardown(fx.tempDir);
    }
  });
});

describe('ADR-0090 Tier A1 Case 6: facade guard — bad SQLite magic → FAIL', () => {
  it('fails on corrupt magic header even if sqlite3 works', () => {
    const fx = setupFakeProject('case6');
    try {
      // Overwrite the fake db with garbage so magic guard trips
      writeFileSync(
        join(fx.tempDir, '.swarm', 'memory.db'),
        Buffer.alloc(8192, 0xff),
      );
      // Stub sqlite3 to return happy numbers — the facade guard fires
      // first, so these never get consumed.
      writeSqlite3State(fx.stateFile, { table: 'episodes', counts: [5, 5] });
      const { passed, output, raw } = runCheck(fx);
      assert.equal(passed, 'false',
        `expected FAIL on bad magic, got ${passed}\noutput: ${output}\nraw:\n${raw}`);
      assert.match(output, /not a SQLite file|magic/,
        `expected magic diagnostic, got: ${output}`);
    } finally {
      teardown(fx.tempDir);
    }
  });
});

describe('ADR-0090 Tier A1 Case 7: facade guard — size < 4096 → FAIL', () => {
  it('fails on tiny db file (below SQLite page size)', () => {
    const fx = setupFakeProject('case7');
    try {
      // Valid magic, but only 1KB
      writeFakeSqliteFile(join(fx.tempDir, '.swarm', 'memory.db'), 1024);
      writeSqlite3State(fx.stateFile, { table: 'episodes', counts: [5, 5] });
      const { passed, output } = runCheck(fx);
      assert.equal(passed, 'false', `expected FAIL on tiny file, got ${passed}: ${output}`);
      assert.match(output, /suspiciously small|4096/,
        `expected size diagnostic, got: ${output}`);
    } finally {
      teardown(fx.tempDir);
    }
  });
});

describe('ADR-0090 Tier A1 Case 8: facade guard — memory-router.js missing sqlite → FAIL', () => {
  it('fails when router-js grep guard does not find "sqlite"', () => {
    const fx = setupFakeProject('case8');
    try {
      // Overwrite memory-router.js with content that lacks "sqlite"
      const routerPath = join(
        fx.tempDir, 'node_modules', '@sparkleideas', 'cli', 'memory-router.js',
      );
      writeFileSync(routerPath, '// no s-q-l-i-t-e here\nmodule.exports = {};\n');
      writeSqlite3State(fx.stateFile, { table: 'episodes', counts: [5, 5] });
      const { passed, output } = runCheck(fx);
      assert.equal(passed, 'false', `expected FAIL on missing sqlite wiring, got ${passed}`);
      assert.match(output, /no sqlite config pass-through|regression risk/,
        `expected router-js regression diagnostic, got: ${output}`);
    } finally {
      teardown(fx.tempDir);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Harness plumbing — the check returns a value the harness understands
// ────────────────────────────────────────────────────────────────────────

describe('ADR-0090 Tier A1: harness plumbing', () => {
  it('acceptance-harness.sh already supports skip_accepted bucket (from Tier A2)', () => {
    const harness = readFileSync(HARNESS_FILE, 'utf-8');
    assert.match(harness, /_CHECK_PASSED"\s*==\s*"skip_accepted"/,
      'harness must branch on "skip_accepted" (inherited from Tier A2)');
    assert.match(harness, /skip_count=\$\(\(skip_count\s*\+\s*1\)\)/,
      'harness must increment skip_count on skip_accepted');
  });

  it('scripts/test-acceptance.sh wires check_adr0086_debt15_sqlite_path', () => {
    const runner = readFileSync(
      resolve(ROOT, 'scripts', 'test-acceptance.sh'),
      'utf-8',
    );
    assert.match(runner, /check_adr0086_debt15_sqlite_path/,
      'runner must still invoke the upgraded check by its original name');
    assert.match(runner, /"adr0086-debt15"/,
      'runner must still use the adr0086-debt15 id');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Integration — real sqlite3, real bash check, real file (NO mocks)
// ────────────────────────────────────────────────────────────────────────
//
// This suite builds a REAL SQLite file with the `episodes` schema, seeds
// it with a real row whose task matches the ADR-0090 A1 marker, and
// invokes the check function against the real sqlite3 binary. The MCP
// call to agentdb_reflexion_store is still stubbed (we don't have a real
// init'd project in a unit test), but the end-to-end round-trip against
// the real sqlite3 helper is exercised.
//
// If sqlite3 isn't installed on the test machine, we SKIP the integration
// suite using the SAME SKIP_ACCEPTED path the check itself takes — this
// keeps CI green on minimal containers while still exercising the real
// path on developer machines where sqlite3 is ubiquitous.

const HAS_SQLITE3 = (() => {
  try {
    execSync('command -v sqlite3', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('ADR-0090 Tier A1 integration: real sqlite3, real episodes schema', () => {
  it('real episodes table with ADR-0090 A1 marker row → check PASSes', { skip: !HAS_SQLITE3 }, () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'a1-int-'));
    try {
      // 1. Build a real .swarm/memory.db with an episodes table + our marker row
      const dbPath = join(tempDir, '.swarm', 'memory.db');
      mkdirSync(dirname(dbPath), { recursive: true });
      // Use real sqlite3 to create the schema + seed it
      execSync(
        `sqlite3 "${dbPath}" "CREATE TABLE episodes (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, task TEXT, reward REAL, success INTEGER, created_at INTEGER DEFAULT (strftime('%s','now')));"`,
      );
      execSync(
        `sqlite3 "${dbPath}" "INSERT INTO episodes (session_id, task, reward, success) VALUES ('int-test', 'acceptance test reflexion adr0090 a1', 0.9, 1);"`,
      );
      // 2. Pad the file to >= 4096 bytes so the size facade guard passes
      const sz = execSync(`wc -c < "${dbPath}"`, { encoding: 'utf8' }).trim();
      if (parseInt(sz, 10) < 4096) {
        // `sqlite3 ANALYZE` won't always push us over 4KB; create extra tables
        execSync(`sqlite3 "${dbPath}" "CREATE TABLE _pad (id INTEGER PRIMARY KEY); INSERT INTO _pad (id) SELECT value FROM generate_series(1, 1000);"`, { stdio: 'ignore' });
      }
      // 3. Fake CLI pkg dir + memory-router.js with the sqlite wiring
      writeFakeCliPkg(tempDir);
      // 4. Stub CLI binary (we don't have a real init'd project here)
      const stubDir = join(tempDir, '.stubs');
      mkdirSync(stubDir, { recursive: true });
      const cliStubPath = writeCliStub(stubDir);
      // 5. Drive the check function — no sqlite3 shim, use the real binary
      const driverPath = join(tempDir, 'driver.sh');
      writeFileSync(driverPath, [
        '#!/usr/bin/env bash',
        'set +e',
        'set +u',
        `export TEMP_DIR="${tempDir}"`,
        'export REGISTRY="http://test-registry.invalid"',
        'export PKG="@sparkleideas/cli"',
        `_cli_cmd() { echo "${cliStubPath}"; }`,
        '_run_and_kill() {',
        '  local cmd="$1"',
        '  _RK_OUT=$(eval "$cmd" 2>&1)',
        '  _RK_EXIT=$?',
        '}',
        '_run_and_kill_ro() { _run_and_kill "$@"; }',
        `source "${CHECK_FILE}"`,
        'check_adr0086_debt15_sqlite_path',
        'echo "::PASSED::$_CHECK_PASSED"',
        'echo "::OUTPUT::$_CHECK_OUTPUT"',
      ].join('\n'), { mode: 0o755 });
      const result = spawnSync('bash', [driverPath], { encoding: 'utf8', timeout: 15000 });
      const out = (result.stdout || '') + (result.stderr || '');
      const passedMatch = out.match(/::PASSED::(.*)/);
      const outputMatch = out.match(/::OUTPUT::(.*)/);
      const passed = passedMatch ? passedMatch[1].trim() : '<unparsed>';
      const output = outputMatch ? outputMatch[1].trim() : '';
      assert.equal(passed, 'true',
        `integration expected PASS with real sqlite3, got ${passed}\noutput: ${output}\nraw:\n${out}`);
      assert.match(output, /persisted across CLI restart/,
        `integration should report persistence proof, got: ${output}`);
    } finally {
      teardown(tempDir);
    }
  });

  it('real sqlite3 but zero marker rows → check FAILs (not silent-passes)', { skip: !HAS_SQLITE3 }, () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'a1-int-zero-'));
    try {
      const dbPath = join(tempDir, '.swarm', 'memory.db');
      mkdirSync(dirname(dbPath), { recursive: true });
      // Create episodes table with NO marker rows — simulates controller fallback
      execSync(
        `sqlite3 "${dbPath}" "CREATE TABLE episodes (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, task TEXT, reward REAL, success INTEGER);"`,
      );
      // Pad to > 4096 bytes
      execSync(`sqlite3 "${dbPath}" "CREATE TABLE _pad (a TEXT); INSERT INTO _pad SELECT hex(randomblob(1024)) FROM generate_series(1, 10);"`, { stdio: 'ignore' });

      writeFakeCliPkg(tempDir);
      const stubDir = join(tempDir, '.stubs');
      mkdirSync(stubDir, { recursive: true });
      const cliStubPath = writeCliStub(stubDir);
      const driverPath = join(tempDir, 'driver.sh');
      writeFileSync(driverPath, [
        '#!/usr/bin/env bash',
        'set +e',
        'set +u',
        `export TEMP_DIR="${tempDir}"`,
        'export REGISTRY="http://test-registry.invalid"',
        'export PKG="@sparkleideas/cli"',
        `_cli_cmd() { echo "${cliStubPath}"; }`,
        '_run_and_kill() {',
        '  _RK_OUT=$(eval "$1" 2>&1)',
        '  _RK_EXIT=$?',
        '}',
        '_run_and_kill_ro() { _run_and_kill "$@"; }',
        `source "${CHECK_FILE}"`,
        'check_adr0086_debt15_sqlite_path',
        'echo "::PASSED::$_CHECK_PASSED"',
        'echo "::OUTPUT::$_CHECK_OUTPUT"',
      ].join('\n'), { mode: 0o755 });
      const result = spawnSync('bash', [driverPath], { encoding: 'utf8', timeout: 15000 });
      const out = (result.stdout || '') + (result.stderr || '');
      const passedMatch = out.match(/::PASSED::(.*)/);
      const outputMatch = out.match(/::OUTPUT::(.*)/);
      const passed = passedMatch ? passedMatch[1].trim() : '<unparsed>';
      const output = outputMatch ? outputMatch[1].trim() : '';
      assert.equal(passed, 'false',
        `integration expected FAIL on zero marker rows, got ${passed}\noutput: ${output}\nraw:\n${out}`);
      assert.notEqual(passed, 'true',
        'REGRESSION: zero marker rows must not silent-pass');
    } finally {
      teardown(tempDir);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// Helpers (for static source analysis)
// ────────────────────────────────────────────────────────────────────────

function extractFn(source, fnName) {
  const startRe = new RegExp(`${fnName}\\(\\)\\s*\\{`);
  const m = source.match(startRe);
  if (!m) return '';
  const start = m.index;
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return source.slice(start);
}
