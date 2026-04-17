// @tier unit
// ADR-0094 Sprint 0 WI-3: _expect_mcp_body / _mcp_invoke_tool tests.
//
// Covers ADR-0097's 5 required paths:
//   1. Happy path — mock CLI returns expected body; assert pass.
//   2. Tool-not-found — "Tool not found"; assert skip_accepted.
//   3. Empty body — nothing; assert fail with diagnostic.
//   4. Crash — non-zero exit; assert fail.
//   5. Pattern mismatch — valid JSON body, mismatching regex; assert fail.
//
// Plus defensive tests for the envelope:
//   - Real CLI shape ([AgentDB]…\n[INFO]…\n[OK]…\nResult:\n<body>) unwraps
//     correctly via awk.
//   - Forward-compat {content:[{type:"text",text:"..."}]} wrapper is
//     transparently unwrapped.
//
// Strategy: stub `_cli_cmd` to point at a bash shim. The shim emits canned
// output based on a SCENARIO env var. We never touch a real CLI or
// registry — this is fast and hermetic.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const HARNESS_FILE = resolve(ROOT, 'lib', 'acceptance-harness.sh');

// Build a bash stub that fakes `cli mcp exec --tool X --params Y`. The stub
// reads $SCENARIO and emits the matching canned output. Each scenario is
// keyed by name; the harness driver sets SCENARIO per-test.
function writeCliStub(dir) {
  const shim = join(dir, 'cli');
  writeFileSync(
    shim,
    [
      '#!/usr/bin/env bash',
      // Scenarios write to stdout and exit with configured code.
      'case "$SCENARIO" in',
      '  happy-raw-json)',
      '    echo "[AgentDB] Telemetry disabled"',
      '    echo "[INFO] Executing tool: test_tool"',
      '    echo "[OK] Tool executed in 12ms"',
      '    echo "Result:"',
      '    echo \'{"status":"success","count":42}\'',
      '    exit 0',
      '    ;;',
      '  tool-not-found)',
      '    echo "[AgentDB] Telemetry disabled"',
      '    echo "[INFO] Executing tool: nonexistent_tool"',
      '    echo "[ERROR] Tool not found: nonexistent_tool"',
      '    exit 1',
      '    ;;',
      '  empty-body)',
      '    echo "[AgentDB] Telemetry disabled"',
      '    echo "[INFO] Executing tool: empty_tool"',
      '    echo "[OK] Tool executed in 3ms"',
      '    echo "Result:"',
      '    # Nothing after Result: — body is empty',
      '    exit 0',
      '    ;;',
      '  crash)',
      '    echo "[AgentDB] Telemetry disabled"',
      '    echo "[INFO] Executing tool: crash_tool"',
      '    echo "TypeError: Cannot read property foo of undefined" >&2',
      '    exit 2',
      '    ;;',
      '  mismatch)',
      '    echo "[AgentDB] Telemetry disabled"',
      '    echo "[INFO] Executing tool: mismatch_tool"',
      '    echo "[OK] Tool executed in 5ms"',
      '    echo "Result:"',
      '    echo \'{"totally":"different"}\'',
      '    exit 0',
      '    ;;',
      '  content-wrapped)',
      '    # Defensive upstream-drift case: {content:[{type:"text",text:"..."}]}',
      '    echo "[AgentDB] Telemetry disabled"',
      '    echo "[INFO] Executing tool: wrapped_tool"',
      '    echo "[OK] Tool executed in 7ms"',
      '    echo "Result:"',
      '    echo \'{"content":[{"type":"text","text":"{\\"status\\":\\"success\\"}"}]}\'',
      '    exit 0',
      '    ;;',
      '  multi-line-body)',
      '    echo "[AgentDB] Telemetry disabled"',
      '    echo "[INFO] Executing tool: multi_tool"',
      '    echo "[OK] Tool executed in 2ms"',
      '    echo "Result:"',
      '    echo "line 1 of body"',
      '    echo "line 2 with success marker"',
      '    echo "line 3 trailing"',
      '    exit 0',
      '    ;;',
      '  *)',
      '    echo "[stub cli] unknown scenario: $SCENARIO" >&2',
      '    exit 99',
      '    ;;',
      'esac',
    ].join('\n'),
    { mode: 0o755 },
  );
  return shim;
}

/**
 * Run _expect_mcp_body / _mcp_invoke_tool under the stubbed CLI.
 * Returns { passed, output, body, exit, raw }.
 */
function runUnderHarness({
  scenario,
  tool = 'test_tool',
  params = '{}',
  regex = 'success',
  label = 'test/label',
  timeout = 5,
  mode = '--ro',
}) {
  const tempDir = mkdtempSync(join(tmpdir(), 'mcp-body-'));
  try {
    const stubDir = join(tempDir, 'stubs');
    mkdirSync(stubDir, { recursive: true });
    const cliStub = writeCliStub(stubDir);
    const e2eDir = join(tempDir, 'e2e');
    mkdirSync(e2eDir, { recursive: true });

    const driverPath = join(tempDir, 'driver.sh');
    const driver = [
      '#!/usr/bin/env bash',
      'set +e',
      'set +u',
      `export PATH="${stubDir}:$PATH"`,
      `export SCENARIO="${scenario}"`,
      `export E2E_DIR="${e2eDir}"`,
      'export REGISTRY="http://test-registry.invalid"',
      // Stubs that the harness expects from the caller.
      '_ns() { echo 0; }',
      '_elapsed_ms() { echo 0; }',
      'log() { :; }',
      // Point _cli_cmd at our stub.
      `_cli_cmd() { echo "${cliStub}"; }`,
      // Use a pared-down _run_and_kill{,_ro}. The production version
      // exercises process-group kill + sentinel polling; our tests are
      // deterministic (the stub exits immediately) so we can direct-eval.
      '_run_and_kill() {',
      '  local cmd="$1" out="${2:-}" maxw="${3:-5}"',
      '  if [[ -n "$out" ]]; then eval "$cmd" > "$out" 2>&1; else eval "$cmd" > /dev/null 2>&1; fi',
      '  _RK_EXIT=$?',
      '  _RK_OUT=$(cat "$out" 2>/dev/null || echo "")',
      '}',
      '_run_and_kill_ro() { _run_and_kill "$@"; }',
      // Source the helper under test AFTER stubs are in place.
      `source "${HARNESS_FILE}"`,
      // Invoke _expect_mcp_body via _mcp_invoke_tool (which is a thin
      // wrapper — testing both at once).
      `_mcp_invoke_tool "${tool}" '${params}' '${regex}' '${label}' ${timeout} ${mode}`,
      'echo "::PASSED::${_CHECK_PASSED:-<unset>}"',
      'echo "::EXIT::${_MCP_EXIT:-<unset>}"',
      'echo "::OUTPUT_START::"',
      'echo "${_CHECK_OUTPUT:-}"',
      'echo "::OUTPUT_END::"',
      'echo "::BODY_START::"',
      'echo "${_MCP_BODY:-}"',
      'echo "::BODY_END::"',
    ].join('\n');
    writeFileSync(driverPath, driver, { mode: 0o755 });

    const result = spawnSync('bash', [driverPath], { encoding: 'utf8', timeout: 15000 });
    const out = (result.stdout || '') + (result.stderr || '');
    const passedMatch = out.match(/::PASSED::(.*)/);
    const exitMatch = out.match(/::EXIT::(.*)/);
    const outputMatch = out.match(/::OUTPUT_START::\n([\s\S]*?)\n::OUTPUT_END::/);
    const bodyMatch = out.match(/::BODY_START::\n([\s\S]*?)\n::BODY_END::/);

    return {
      passed: passedMatch ? passedMatch[1].trim() : '<unparsed>',
      exit: exitMatch ? exitMatch[1].trim() : '<unparsed>',
      output: outputMatch ? outputMatch[1] : '',
      body: bodyMatch ? bodyMatch[1] : '',
      raw: out,
      status: result.status,
    };
  } finally {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
}

// ══════════════════════════════════════════════════════════════════════
// Static source assertions (contract + shape)
// ══════════════════════════════════════════════════════════════════════

describe('ADR-0094 Sprint 0 WI-3 — harness static contract', () => {
  const source = readFileSync(HARNESS_FILE, 'utf-8');

  it('defines _expect_mcp_body', () => {
    assert.match(source, /_expect_mcp_body\(\)\s*\{/);
  });

  it('defines _mcp_invoke_tool', () => {
    assert.match(source, /_mcp_invoke_tool\(\)\s*\{/);
  });

  it('defines _with_iso_cleanup', () => {
    assert.match(source, /_with_iso_cleanup\(\)\s*\{/);
  });

  it('extracts body via awk /^Result:/ sentinel (not node-based unwrap)', () => {
    assert.match(source, /awk '\/\^Result:\/\{f=1;next\}f'/,
      'Queen synthesis §A1: strike node-based unwrap; use awk sentinel');
  });

  it('has defensive JSON-unwrap branch for future {content:[{text}]} shape', () => {
    // We still tolerate an upstream-adopted content wrapper — the body
    // must be run through a node unwrap before regex-matching.
    assert.match(source, /j\.content\[0\]\.text/,
      'must unwrap {content:[{type:text,text:..}]} if body parses as JSON');
  });

  it('narrowly matches tool-not-found variants (ADR-0082 no-silent-pass)', () => {
    // ADR-0082: skip_accepted path must be narrow. Assert the exact set
    // of patterns documented in the plan.
    const expected = [
      'tool.+not found',
      'not registered',
      'unknown tool',
      'no such tool',
      'method .* not found',
      'invalid tool',
    ];
    for (const pat of expected) {
      assert.ok(source.includes(pat),
        `skip_accepted branch must recognise "${pat}"`);
    }
  });

  it('uses three-way bucket (true / false / skip_accepted only)', () => {
    const fnBody = source.match(/_expect_mcp_body\(\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(fnBody, '_expect_mcp_body body must be parseable');
    const assignments = fnBody[1].match(/_CHECK_PASSED="([^"]+)"/g) || [];
    const values = new Set(assignments.map(m => m.match(/"([^"]+)"/)[1]));
    for (const v of values) {
      assert.ok(['true', 'false', 'skip_accepted'].includes(v),
        `_CHECK_PASSED may only be true/false/skip_accepted, found "${v}"`);
    }
  });

  it('_mcp_invoke_tool is a thin delegator to _expect_mcp_body', () => {
    // Anti-copy-paste: the superset helper should be small and delegate.
    const m = source.match(/_mcp_invoke_tool\(\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(m, '_mcp_invoke_tool body must be parseable');
    const lines = m[1].split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
    assert.ok(lines.length <= 5,
      `_mcp_invoke_tool must be thin wrapper, found ${lines.length} real lines`);
    assert.match(m[1], /_expect_mcp_body/,
      '_mcp_invoke_tool must delegate to _expect_mcp_body');
  });
});

// ══════════════════════════════════════════════════════════════════════
// Behavioural tests — the 5 ADR-0097 paths plus envelope shapes
// ══════════════════════════════════════════════════════════════════════

describe('ADR-0094 Sprint 0 WI-3 — _expect_mcp_body behaviour', () => {
  it('Path 1: happy path — regex matches body → pass', () => {
    const r = runUnderHarness({ scenario: 'happy-raw-json', regex: 'success' });
    assert.equal(r.passed, 'true', `expected pass, got ${r.passed} — raw:\n${r.raw}`);
    assert.match(r.body, /"status":"success"/);
    assert.match(r.output, /returned expected pattern/);
  });

  it('Path 2: tool-not-found → skip_accepted', () => {
    const r = runUnderHarness({ scenario: 'tool-not-found', tool: 'nonexistent_tool' });
    assert.equal(r.passed, 'skip_accepted', `expected skip_accepted, got ${r.passed} — raw:\n${r.raw}`);
    assert.match(r.output, /SKIP_ACCEPTED/);
    assert.match(r.output, /not in build/);
  });

  it('Path 3: empty body → fail with diagnostic', () => {
    const r = runUnderHarness({ scenario: 'empty-body', tool: 'empty_tool' });
    assert.equal(r.passed, 'false', `expected fail, got ${r.passed} — raw:\n${r.raw}`);
    assert.match(r.output, /empty body/);
  });

  it('Path 4: crash (non-zero exit, no Result:) → fail', () => {
    const r = runUnderHarness({ scenario: 'crash', tool: 'crash_tool' });
    assert.equal(r.passed, 'false', `expected fail, got ${r.passed} — raw:\n${r.raw}`);
    // Diagnostic must surface the exit code path (either empty-body or
    // mismatch — stderr "TypeError" is not captured by stdout tee).
    assert.match(r.output, /did not match|empty body/);
  });

  it('Path 5: pattern mismatch → fail with body diagnostic', () => {
    const r = runUnderHarness({
      scenario: 'mismatch', tool: 'mismatch_tool',
      regex: 'success',  // body is {"totally":"different"}
    });
    assert.equal(r.passed, 'false', `expected fail, got ${r.passed} — raw:\n${r.raw}`);
    assert.match(r.output, /did not match/);
    // Diagnostic must include the body for forensics.
    assert.match(r.output, /"totally":"different"/);
  });

  it('Envelope: awk strips [AgentDB]/[INFO]/[OK] preamble before matching', () => {
    // Body regex matches only if awk unwrapped the Result: sentinel. If
    // we accidentally scanned raw output, the regex `executed in 12ms`
    // would match (but that's preamble, not body).
    const r = runUnderHarness({
      scenario: 'happy-raw-json', tool: 'test_tool',
      regex: 'executed in',
    });
    assert.equal(r.passed, 'false',
      `preamble must NOT satisfy body regex; got ${r.passed} — body:\n${r.body}`);
  });

  it('Envelope: multi-line body extracts every line after Result:', () => {
    const r = runUnderHarness({
      scenario: 'multi-line-body', tool: 'multi_tool',
      regex: 'line 3 trailing',
    });
    assert.equal(r.passed, 'true',
      `multi-line body must include all lines after Result:; got ${r.passed} — body:\n${r.body}`);
  });

  it('Envelope: defensive unwrap for {content:[{text}]} upstream shape', () => {
    // The stub emits a content-wrapped body; the inner text is
    // {"status":"success"}. Regex `success` must match only if the unwrap
    // descends one level (otherwise we'd match on "content" too — so we
    // use a strict-key regex that's only present in the INNER body).
    const r = runUnderHarness({
      scenario: 'content-wrapped', tool: 'wrapped_tool',
      regex: '"status":"success"',
    });
    assert.equal(r.passed, 'true',
      `content-wrapped envelope must be transparently unwrapped; got ${r.passed} — body:\n${r.body}`);
  });

  it('Sets _MCP_BODY for chained/lifecycle callers', () => {
    const r = runUnderHarness({ scenario: 'happy-raw-json', regex: 'success' });
    assert.match(r.body, /"status":"success"/,
      '_MCP_BODY must be exposed for lifecycle round-trip checks');
  });
});
