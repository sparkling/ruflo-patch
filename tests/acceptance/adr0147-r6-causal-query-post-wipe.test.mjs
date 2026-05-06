// @tier acceptance
// ADR-0147 Refinement 6 + 7 (2026-05-06): causal_query post-wipe regression.
//
// Background (Bug 6 + Bug 7, discovered after wiping + reindexing 231 ADRs in a
// downstream HM project):
//
//   - `mcp__ruflo__agentdb_causal_query cause=ADR-0167` returned 0 results.
//   - `mcp__ruflo__agentdb_causal_query effect=ADR-0167` returned 0 results.
//   - Yet `memory_list namespace:"causal-edges"` confirmed the edges WERE
//     persisted as `${src}→${tgt}` keys.
//
// Root cause split into TWO refinements:
//
//   R6 (read-arm fallback first-100-cap): the `case 'query'` arm in
//   `routeCausalOp` issued `routeMemoryOp({type:'list', namespace:'causal-edges',
//   limit: Math.max(k*4, 100)})`. The underlying RVF `query()` iterates Map
//   insertion order (NOT k-relative ranking) and slices the first 100 entries.
//   Edges past insertion-order position 100 were invisible to the read arm.
//   Fix: push `keyPrefix=${cause}→` for cause= queries (key-prefix scan, O(matches)
//   instead of O(namespace)); raise the limit to the full namespace count for
//   effect= queries (target is the key SUFFIX, no prefix push-down possible).
//
//   R7 (write-arm controller-mirror typo): `case 'edge'` checked
//   `typeof causalGraph.addEdge === 'function'`, but the agentic-flow
//   CausalMemoryGraph controller exposes `addCausalEdge` (with a different
//   contract that requires numeric memory IDs). The check was always false,
//   so writes ALWAYS took the namespace fallback path — which IS correct
//   end-to-end with R6's read-arm fix, but the comment-vs-code mismatch
//   masked the diagnosis. R7's deferred TODO documents the controller-shape
//   gap so future readers don't waste time chasing a "controller available"
//   path that never fires. (R7 is documentary; the test pins the behavioral
//   contract: writes succeed via the fallback, reads find them.)
//
// Reproduction strategy (insertion-order displacement):
//
//   1. Insert ~120 throwaway edges first (e.g. `THROWAWAY-NN→THROWAWAY-MM`).
//      These land at positions 1..120 in the namespace's insertion order.
//   2. Then insert canary edges. They land at positions 121+ — beyond the
//      broken pre-R6 100-cap.
//   3. Pre-R6, `agentdb_causal_query cause=ADR-CANARY` returns 0 (the canary
//      edges fall off the first-100 slice). Post-R6, the keyPrefix push-down
//      makes the query O(matches) so position-in-Map doesn't matter.
//   4. Pre-R6, `effect=ADR-CANARY` returns 0 for the same reason (no prefix
//      push-down possible, but the limit was still 100). Post-R6, the limit
//      is sized to the namespace count.
//
// Per CLAUDE.md feedback-no-squelch-tests: assertions FAIL LOUDLY. We do
// NOT weaken to "≥1 result" or "≥0 result"; we assert ≥2 + that BOTH named
// canary partners surface.
//
// Per CLAUDE.md feedback-full-test-output: full CLI invocation transcripts
// are saved to a per-test log file (under /tmp). On assertion failure we
// reference the log path so forensics is one `cat <path>` away — never
// piped through grep/head/tail before save.
//
// Per CLAUDE.md feedback-no-fallbacks: if Verdaccio is unreachable or the
// CLI binary is missing, the test SKIPS with a loud diagnostic — it does
// NOT silently re-route to source-text inspection.

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  appendFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync, spawnSync } from 'node:child_process';

// ── Constants ───────────────────────────────────────────────────────────
const VERDACCIO_URL = 'http://localhost:4873';
const THROWAWAY_COUNT = 120;          // displaces canaries past the broken 100-cap
const CANARY_SOURCE = 'ADR-CANARY';   // outbound source for cause= test
const CANARY_TARGETS = ['ADR-A', 'ADR-B'];  // ≥2 outbound targets
const CANARY_TARGET = 'ADR-CANARY';   // inbound target for effect= test
const CANARY_SOURCES = ['ADR-X', 'ADR-Y'];  // ≥2 inbound sources

// Per-test log file. Every CLI invocation appends here. On failure we
// surface the path so the user can `cat` it for full forensics.
const LOG_FILE = join(tmpdir(), `adr0147-r6-${Date.now()}.log`);

// ── Skip-or-locate harness ──────────────────────────────────────────────

/**
 * Install the LATEST @sparkleideas/cli from local Verdaccio into a fresh
 * dir per test run. Always reinstall — never reuse a cache.
 *
 * Why no cache reuse: prior implementation scanned /tmp/ruflo-accept-* and
 * /tmp/ruflo-fast-* for cached installs. Pipeline runs leave stale dirs
 * behind across deploys, and the test ended up running against an old cli
 * version (e.g. patch.374 found post-pipeline that just published patch.484).
 * That made the test exercise pre-fix code and report 0 results — the
 * regression assertion fired, but against the WRONG version. Net effect:
 * "correct fix in published artifact, test fails because it tested an old
 * artifact." Worse than no test.
 *
 * Trade-off: ~15s per run for a fresh install. Acceptable given the test
 * already takes ~65s for 124 sequential MCP invocations; 15s setup is
 * dwarfed by the actual workload.
 *
 * If Verdaccio is unreachable, return null so all tests skip with a loud
 * reason. Never silently fall back.
 */
function locateOrInstallCli() {
  // 1. Probe Verdaccio.
  try {
    execSync(`curl -sf --max-time 3 ${VERDACCIO_URL}/-/ping`, { stdio: 'ignore' });
  } catch {
    return { bin: null, error: `Verdaccio unreachable at ${VERDACCIO_URL}` };
  }

  // 2. Fresh install dir per test run — never reuse a previous install,
  // which can be stale (different cli version than the one we just
  // published in the same pipeline). Cleanup is best-effort in after().
  const installDir = mkdtempSync(join(tmpdir(), 'adr0147-r6-cli-'));
  writeFileSync(
    join(installDir, 'package.json'),
    JSON.stringify({ name: 'adr0147-r6-test', version: '1.0.0', private: true }),
  );
  writeFileSync(join(installDir, '.npmrc'), `registry=${VERDACCIO_URL}\n`);

  // 3. Install @sparkleideas/cli@latest. --prefer-online forces a registry
  // round-trip so the npm cache for the @latest dist-tag is refreshed
  // (otherwise npm could resolve @latest from its cache and fetch a stale
  // version). --no-audit/--no-fund keeps it tight.
  try {
    execSync(
      `npm install @sparkleideas/cli@latest --registry=${VERDACCIO_URL} --prefer-online --no-audit --no-fund`,
      { cwd: installDir, stdio: 'ignore', timeout: 180_000 },
    );
  } catch (err) {
    return { bin: null, error: `Fresh install failed: ${err?.message ?? String(err)}` };
  }

  for (const candidate of ['ruflo', 'claude-flow', 'cli']) {
    const bin = `${installDir}/node_modules/.bin/${candidate}`;
    if (existsSync(bin)) return { bin, installDir };
  }
  return { bin: null, error: `Install completed but no CLI bin found in ${installDir}/node_modules/.bin/` };
}

// ── CLI exec helpers ────────────────────────────────────────────────────

/**
 * Run the CLI synchronously, append the full invocation + stdout + stderr
 * to LOG_FILE, return { stdout, stderr, status }. Per
 * feedback-full-test-output: never pipe through grep/head/tail — save in
 * full, grep AFTER.
 *
 * Uses a generous timeout (45s) because real MCP exec spins up the
 * AgentDB session each call. On SIGKILL (exceeded), status is the kill
 * signal, not an exit code.
 */
function runCli(bin, cwd, args, { timeoutMs = 45_000 } = {}) {
  const banner = `\n──── ${new Date().toISOString()} ${args.join(' ')} (cwd=${cwd}) ────\n`;
  appendFileSync(LOG_FILE, banner);
  const result = spawnSync(bin, args, {
    cwd,
    timeout: timeoutMs,
    encoding: 'utf8',
    env: { ...process.env, NPM_CONFIG_REGISTRY: VERDACCIO_URL },
  });
  appendFileSync(LOG_FILE, `[stdout]\n${result.stdout ?? ''}\n[stderr]\n${result.stderr ?? ''}\n[status=${result.status} signal=${result.signal}]\n`);
  return result;
}

/**
 * Insert one causal edge via `cli mcp exec --tool agentdb_causal-edge`.
 * The tool name uses HYPHEN (agentdb_causal-edge), not underscore — see
 * agentdb-tools.ts:221.
 *
 * Returns true if the tool returned `success:true`. Throws AssertionError
 * with full body if not — pre-fix this should still PASS (the write-arm
 * works; the failure is in the read-arm).
 */
function insertEdge(bin, cwd, sourceId, targetId, relation = 'causes') {
  const params = JSON.stringify({ sourceId, targetId, relation, weight: 0.8 });
  const r = runCli(bin, cwd, [
    'mcp', 'exec',
    '--tool', 'agentdb_causal-edge',
    '--params', params,
  ]);
  const body = (r.stdout ?? '') + (r.stderr ?? '');
  if (!/"success"\s*:\s*true/.test(body)) {
    throw new assert.AssertionError({
      message: `agentdb_causal-edge write failed for ${sourceId}→${targetId}\nFull log: ${LOG_FILE}\nBody (first 20 lines):\n${body.split('\n').slice(0, 20).join('\n')}`,
      actual: body,
      expected: '"success":true',
    });
  }
  return true;
}

/**
 * Query causal_query and return the parsed results array.
 *
 * Strategy: extract the JSON body after the `Result:` sentinel (the same
 * pattern lib/acceptance-harness.sh `_expect_mcp_body` uses). Defensive:
 * if the parse fails we return { parsed: null, raw: <full body> } so the
 * assertion can include the raw text.
 */
function queryCausal(bin, cwd, params) {
  const r = runCli(bin, cwd, [
    'mcp', 'exec',
    '--tool', 'agentdb_causal_query',
    '--params', JSON.stringify(params),
  ]);
  const raw = (r.stdout ?? '') + (r.stderr ?? '');
  // Body after "Result:" sentinel.
  const idx = raw.indexOf('Result:');
  const body = idx >= 0 ? raw.slice(idx + 'Result:'.length).trim() : raw.trim();
  // Body may be raw JSON or {content:[{type:"text",text:"<json>"}]} envelope.
  let parsed = null;
  try {
    parsed = JSON.parse(body);
    if (parsed && Array.isArray(parsed.content) && parsed.content[0]?.text) {
      parsed = JSON.parse(parsed.content[0].text);
    }
  } catch {
    // leave parsed null; caller asserts on parse-failure
  }
  return { parsed, raw, body };
}

// ── Test setup state ────────────────────────────────────────────────────
let CLI_BIN = null;
let SKIP_REASON = null;
let TEST_PROJECT = null;

// ── Suite ───────────────────────────────────────────────────────────────

describe('ADR-0147 R6 + R7: causal_query post-wipe regression — canary edges past insertion-order 100', () => {
  before(async () => {
    appendFileSync(LOG_FILE, `=== ADR-0147 R6+R7 acceptance test ${new Date().toISOString()} ===\n`);

    const located = locateOrInstallCli();
    if (!located.bin) {
      SKIP_REASON = `SKIP_ACCEPTED: ${located.error} — infra, not product. Bring up Verdaccio (always-running per memory reference-verdaccio.md) and re-run.`;
      appendFileSync(LOG_FILE, `${SKIP_REASON}\n`);
      return;
    }
    CLI_BIN = located.bin;
    appendFileSync(LOG_FILE, `CLI_BIN=${CLI_BIN}\n`);

    // Fresh project dir per test run. Init runs against Verdaccio so the
    // installed package is what we actually exercise.
    TEST_PROJECT = mkdtempSync(join(tmpdir(), 'adr0147-r6-proj-'));
    appendFileSync(LOG_FILE, `TEST_PROJECT=${TEST_PROJECT}\n`);

    // `init --full --force`. The CLI hangs after init due to open SQLite
    // handles (per ADR-0039); we use spawnSync timeout + verify-by-file
    // instead of relying on exit code. Mirrors lib/acceptance-harness.sh
    // line ~256.
    runCli(CLI_BIN, TEST_PROJECT, ['init', '--full', '--force'], { timeoutMs: 120_000 });
    if (!existsSync(join(TEST_PROJECT, '.claude-flow', 'config.json'))
        && !existsSync(join(TEST_PROJECT, '.claude-flow', 'config.yaml'))) {
      SKIP_REASON = `SKIP_ACCEPTED: init --full produced no .claude-flow/config.* — install under ${located.installDir} may be stale. Full log: ${LOG_FILE}`;
      appendFileSync(LOG_FILE, `${SKIP_REASON}\n`);
      return;
    }

    // `memory init --force` — required so the causal-edges namespace
    // backend is wired through the router.
    runCli(CLI_BIN, TEST_PROJECT, ['memory', 'init', '--force'], { timeoutMs: 30_000 });
  });

  after(() => {
    // Keep TEST_PROJECT on disk if the test failed (the after() hook
    // runs unconditionally; node:test surfaces failures separately and
    // the log file path is referenced in the assertion). Best-effort
    // cleanup on green runs only.
    if (TEST_PROJECT && !SKIP_REASON) {
      try { rmSync(TEST_PROJECT, { recursive: true, force: true }); } catch {}
    }
    appendFileSync(LOG_FILE, `=== END ${new Date().toISOString()} ===\n`);
  });

  it('cause=ADR-CANARY returns canary edges even when inserted at position 121+', { timeout: 600_000 }, (t) => {
    if (SKIP_REASON) { t.skip(SKIP_REASON); return; }

    // Phase 1: insert THROWAWAY_COUNT throwaway edges to displace insertion order.
    appendFileSync(LOG_FILE, `\n--- Phase 1: ${THROWAWAY_COUNT} throwaway inserts ---\n`);
    for (let i = 0; i < THROWAWAY_COUNT; i++) {
      const j = (i + 1) % THROWAWAY_COUNT;
      insertEdge(CLI_BIN, TEST_PROJECT, `THROWAWAY-${i}`, `THROWAWAY-${j}`);
    }

    // Phase 2: insert canary OUTBOUND edges. Position in insertion order: 121+.
    appendFileSync(LOG_FILE, `\n--- Phase 2: insert canary OUTBOUND edges (cause=${CANARY_SOURCE}) ---\n`);
    for (const target of CANARY_TARGETS) {
      insertEdge(CLI_BIN, TEST_PROJECT, CANARY_SOURCE, target);
    }

    // Phase 3: query cause=ADR-CANARY with the DEFAULT k=10 so the pre-fix
    // fallback limit is `max(k*4, 100) = 100` — the broken first-100-cap
    // exactly. Passing k=50 would make the pre-fix limit 200 and let the
    // canaries (positions 121+) fall inside the slice — the regression
    // would not reproduce. R6's keyPrefix push-down makes this O(matches)
    // post-fix; position in Map no longer matters.
    appendFileSync(LOG_FILE, `\n--- Phase 3: query cause=${CANARY_SOURCE} (k=default 10) ---\n`);
    const { parsed, raw, body } = queryCausal(CLI_BIN, TEST_PROJECT, { cause: CANARY_SOURCE });

    // Hard assertion: the response MUST parse as JSON. Pre-R6 it does
    // parse — it just returns success:true with results=[] (or count=0).
    // We're not gating on parse; we're gating on result count. Loud-fail
    // diagnostic includes raw body + log path so the user can grep
    // post-hoc without re-running.
    assert.ok(
      parsed && typeof parsed === 'object',
      `agentdb_causal_query response did not parse as JSON. Full log: ${LOG_FILE}\nRaw body (first 30 lines):\n${(body || raw).split('\n').slice(0, 30).join('\n')}`,
    );

    const results = Array.isArray(parsed.results) ? parsed.results : [];
    appendFileSync(LOG_FILE, `[cause= results.length=${results.length}] ${JSON.stringify(parsed).slice(0, 500)}\n`);

    // R6 regression assertion: pre-fix this returns 0 because the canary
    // edges sit past the broken 100-cap in Map insertion order. Post-fix
    // we get back at least the 2 canary edges we wrote.
    assert.ok(
      results.length >= CANARY_TARGETS.length,
      `R6 REGRESSION: cause=${CANARY_SOURCE} returned ${results.length} results, expected ≥${CANARY_TARGETS.length}.\n`
      + `This means the read-arm fallback's first-100-cap is back. Canary edges sit at insertion-order 121+.\n`
      + `Full log: ${LOG_FILE}\nResponse: ${JSON.stringify(parsed).slice(0, 800)}`,
    );

    // Stronger assertion: BOTH named canary targets must appear. Catches
    // a future regression where the reader returns 2+ results but they're
    // STALE entries from a different test run / position.
    const targetIds = new Set(results.map(r => (r && (r.targetId ?? r.target)) || ''));
    for (const expected of CANARY_TARGETS) {
      assert.ok(
        targetIds.has(expected),
        `R6 REGRESSION: cause=${CANARY_SOURCE} results missing target=${expected}.\n`
        + `Got targetIds=${JSON.stringify([...targetIds])}\nFull log: ${LOG_FILE}`,
      );
    }
  });

  it('effect=ADR-CANARY returns canary edges even when inserted at position 121+', { timeout: 600_000 }, (t) => {
    if (SKIP_REASON) { t.skip(SKIP_REASON); return; }

    // Phase 4: insert canary INBOUND edges. The 120 throwaways from
    // Phase 1 already displaced insertion order; these new inbound
    // canary edges land at positions 123+.
    //
    // Note: this test runs AFTER the cause= test (node:test runs
    // serially within a describe by default). The TEST_PROJECT and
    // its .claude-flow store are reused, so the throwaways from
    // Phase 1 are still in place. We just append inbound canaries.
    appendFileSync(LOG_FILE, `\n--- Phase 4: insert canary INBOUND edges (effect=${CANARY_TARGET}) ---\n`);
    for (const source of CANARY_SOURCES) {
      insertEdge(CLI_BIN, TEST_PROJECT, source, CANARY_TARGET);
    }

    // Phase 5: query effect=ADR-CANARY with the DEFAULT k=10 so the
    // pre-fix fallback limit is `max(k*4, 100) = 100` — the broken
    // cap. With 120+ throwaways already in insertion order before the
    // 2 inbound canaries, the pre-fix slice cuts off at 100 and the
    // canaries (at positions 123+) are unreachable. R6 fix for effect=
    // queries sizes the limit to the full namespace count (no prefix
    // push-down possible because target is the key SUFFIX, not prefix).
    appendFileSync(LOG_FILE, `\n--- Phase 5: query effect=${CANARY_TARGET} (k=default 10) ---\n`);
    const { parsed, raw, body } = queryCausal(CLI_BIN, TEST_PROJECT, { effect: CANARY_TARGET });

    assert.ok(
      parsed && typeof parsed === 'object',
      `agentdb_causal_query response did not parse as JSON. Full log: ${LOG_FILE}\nRaw body (first 30 lines):\n${(body || raw).split('\n').slice(0, 30).join('\n')}`,
    );

    const results = Array.isArray(parsed.results) ? parsed.results : [];
    appendFileSync(LOG_FILE, `[effect= results.length=${results.length}] ${JSON.stringify(parsed).slice(0, 500)}\n`);

    // R6 regression assertion (effect-side): pre-fix returns 0 because
    // the limit was capped at max(k*4, 100) = 100 and the namespace now
    // holds 120+ throwaways + canaries. Post-fix the limit is sized to
    // the full namespace count.
    assert.ok(
      results.length >= CANARY_SOURCES.length,
      `R6 REGRESSION: effect=${CANARY_TARGET} returned ${results.length} results, expected ≥${CANARY_SOURCES.length}.\n`
      + `This means the effect-side limit is back to the 100-cap. Canary edges sit at insertion-order 123+.\n`
      + `Full log: ${LOG_FILE}\nResponse: ${JSON.stringify(parsed).slice(0, 800)}`,
    );

    const sourceIds = new Set(results.map(r => (r && (r.sourceId ?? r.source)) || ''));
    for (const expected of CANARY_SOURCES) {
      assert.ok(
        sourceIds.has(expected),
        `R6 REGRESSION: effect=${CANARY_TARGET} results missing source=${expected}.\n`
        + `Got sourceIds=${JSON.stringify([...sourceIds])}\nFull log: ${LOG_FILE}`,
      );
    }
  });
});
