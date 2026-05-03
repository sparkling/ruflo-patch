// @tier unit
// ADR-0108 (T13) — Mixed-type worker spawn mechanism.
//
// Sibling: lib/acceptance-adr0108-checks.sh
//
// Three layers per ADR-0097 / ADR-0108 §Test plan:
//
//  1. Static lib + runner-wiring assertions (Tier-Y rule).
//  2. Source-level structure checks against the live fork:
//       - `--worker-types` CLI flag declaration is present
//       - `agentTypes` MCP schema entry is present with array+enum shape
//       - `validateWorkerType` is wired (not dead code)
//  3. Behavioural unit tests calling the codemodded MCP handler:
//       - round-robin distribution across `agentTypes`
//       - mutex between scalar `agentType` and array `agentTypes`
//       - unknown values rejected loudly per `feedback-no-fallbacks.md`
//
// Behavioural tests import the codemodded build at
// /tmp/ruflo-build/v3/@claude-flow/cli/dist/src/mcp-tools/hive-mind-tools.js
// (produced by `npm run build`). When that build is absent, behavioural
// tests skip with a clear reason — the static + source-level checks still
// run so a fresh checkout exercises the static surface.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-adr0108-checks.sh');
const RUNNER_FILE = resolve(ROOT, 'scripts', 'test-acceptance.sh');

const FORK_CLI_SRC_HM = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts';
const FORK_MCP_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/hive-mind-tools.ts';
const FORK_VALIDATE_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/validate-input.ts';

const CODEMOD_MCP_DIST = '/tmp/ruflo-build/v3/@claude-flow/cli/dist/src/mcp-tools/hive-mind-tools.js';
const FORK_MCP_DIST = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/dist/src/mcp-tools/hive-mind-tools.js';

function pickDist() {
  for (const candidate of [CODEMOD_MCP_DIST, FORK_MCP_DIST]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
const MCP_DIST = pickDist();
const SKIP_REASON = MCP_DIST
  ? false
  : 'no codemod or fork dist for hive-mind-tools — run `npm run build` first';

const CHECK_FN_NAMES = [
  'check_adr0108_cli_flag_present',
  'check_adr0108_mcp_schema_array_enum',
  'check_adr0108_round_robin_distribution',
  'check_adr0108_mutex_type_worker_types',
];

const RUNNER_CHECK_IDS = [
  'adr0108-cli-flag',
  'adr0108-mcp-schema',
  'adr0108-round-robin',
  'adr0108-mutex',
];

// ── 1. Static check-lib + runner-wiring assertions ─────────────────────

describe('ADR-0108 acceptance check lib — static structure', () => {
  const lib = existsSync(CHECK_FILE) ? readFileSync(CHECK_FILE, 'utf8') : '';

  it('lib file exists', () => {
    assert.ok(existsSync(CHECK_FILE), `Expected ${CHECK_FILE} to exist`);
  });

  for (const fn of CHECK_FN_NAMES) {
    it(`defines ${fn}()`, () => {
      assert.match(lib, new RegExp(`^${fn}\\s*\\(\\)\\s*\\{`, 'm'),
        `${fn}() not found in ${CHECK_FILE}`);
    });
  }

  it('every check sets _CHECK_PASSED and _CHECK_OUTPUT', () => {
    const passedCount = (lib.match(/_CHECK_PASSED=/g) || []).length;
    const outputCount = (lib.match(/_CHECK_OUTPUT=/g) || []).length;
    assert.ok(passedCount >= CHECK_FN_NAMES.length,
      `Expected ≥${CHECK_FN_NAMES.length} _CHECK_PASSED= assignments, found ${passedCount}`);
    assert.ok(outputCount >= CHECK_FN_NAMES.length,
      `Expected ≥${CHECK_FN_NAMES.length} _CHECK_OUTPUT= assignments, found ${outputCount}`);
  });

  it('lib uses $(_cli_cmd), never raw npx @latest (per reference-cli-cmd-helper.md)', () => {
    if (!lib) return;
    const violations = lib.match(/npx\s+@sparkleideas\/cli@latest/g) || [];
    assert.equal(violations.length, 0,
      `acceptance script must use $(_cli_cmd), not raw npx — found ${violations.length} violation(s)`);
  });
});

// ── 2. Source-level structure assertions on the live fork source ──────

describe('ADR-0108 §Implementation — fork source carries the touched surfaces', () => {
  it('CLI carries --worker-types option declaration', () => {
    if (!existsSync(FORK_CLI_SRC_HM)) return; // ruflo-patch-only checkout
    const src = readFileSync(FORK_CLI_SRC_HM, 'utf8');
    assert.match(src, /name:\s*['"]worker-types['"]/, 'CLI hive-mind.ts must declare --worker-types option');
  });

  it('CLI parses comma-separated --worker-types into array', () => {
    if (!existsSync(FORK_CLI_SRC_HM)) return;
    const src = readFileSync(FORK_CLI_SRC_HM, 'utf8');
    assert.match(src, /\.split\(','\)/, 'CLI must split --worker-types on commas');
    assert.match(src, /validateWorkerType/, 'CLI must validate each --worker-types entry');
  });

  it('CLI carries mutex error string for --type / --worker-types', () => {
    if (!existsSync(FORK_CLI_SRC_HM)) return;
    const src = readFileSync(FORK_CLI_SRC_HM, 'utf8');
    assert.match(src, /--type and --worker-types are mutually exclusive/,
      'CLI must surface a mutex error when both flags set with non-default --type');
  });

  it('MCP tool schema declares agentTypes as array<enum>', () => {
    if (!existsSync(FORK_MCP_SRC)) return;
    const src = readFileSync(FORK_MCP_SRC, 'utf8');
    assert.match(src, /agentTypes:\s*\{/, 'MCP schema must declare agentTypes property');
    assert.match(src, /type:\s*['"]array['"]/, 'MCP schema must include type: "array"');
    assert.match(src, /items:\s*\{[^}]*type:\s*['"]string['"][^}]*enum/s,
      'MCP agentTypes.items must carry { type: "string", enum: [...] }');
  });

  it('MCP handler enforces mutex between agentType and agentTypes', () => {
    if (!existsSync(FORK_MCP_SRC)) return;
    const src = readFileSync(FORK_MCP_SRC, 'utf8');
    assert.match(src, /agentType and agentTypes are mutually exclusive/,
      'MCP handler must surface a mutex error');
  });

  it('MCP handler round-robins via agentTypes[i % agentTypes.length]', () => {
    if (!existsSync(FORK_MCP_SRC)) return;
    const src = readFileSync(FORK_MCP_SRC, 'utf8');
    assert.match(src, /agentTypesArr\[i\s*%\s*agentTypesArr\.length\]/,
      'MCP handler must implement modulo round-robin');
  });

  it('validateWorkerType is wired (not dead code) — at least one caller in fork sources', () => {
    // ADR-0108 §R1: pre-T13 the validator at validate-input.ts:49-65 had no
    // callers (verified 2026-05-02). T13 must add at least one caller.
    if (!existsSync(FORK_VALIDATE_SRC)) return;
    const validateSrc = readFileSync(FORK_VALIDATE_SRC, 'utf8');
    assert.match(validateSrc, /export\s+function\s+validateWorkerType/,
      'validateWorkerType must remain exported');

    let callerCount = 0;
    for (const path of [FORK_CLI_SRC_HM, FORK_MCP_SRC]) {
      if (!existsSync(path)) continue;
      const src = readFileSync(path, 'utf8');
      // Match `validateWorkerType(...)` — invocation, not just import.
      callerCount += (src.match(/validateWorkerType\s*\(/g) || []).length;
    }
    assert.ok(callerCount >= 2,
      `validateWorkerType must have at least 2 invocation sites (CLI + MCP). Found ${callerCount}`);
  });
});

// ── 3. Behavioural assertions against the codemodded build ────────────

describe('ADR-0108 §Test plan — MCP handler round-robin', () => {
  // The handler reads/writes hive state at .claude-flow/hive-mind/state.json
  // off `findProjectRoot()`. We sandbox each test in a tmp dir and chdir into
  // it so the handler's filesystem touches the sandbox.
  let sandbox = null;
  let originalCwd = null;
  let mcpTools = null;

  async function setup() {
    if (SKIP_REASON) return;
    if (mcpTools === null) {
      const mod = await import(MCP_DIST);
      mcpTools = mod.hiveMindTools;
    }
    sandbox = mkdtempSync(join(tmpdir(), 'adr0108-t13-'));
    originalCwd = process.cwd();
    process.chdir(sandbox);
    // Init the hive in the sandbox so spawn handlers don't reject with
    // "Hive-mind not initialized".
    const initTool = mcpTools.find(t => t.name === 'hive-mind_init');
    await initTool.handler({ topology: 'mesh' });
  }

  function teardown() {
    if (originalCwd) {
      process.chdir(originalCwd);
      originalCwd = null;
    }
    if (sandbox) {
      rmSync(sandbox, { recursive: true, force: true });
      sandbox = null;
    }
  }

  it('round-robins agentTypes across count (N=3, 3 types → distinct)', { skip: SKIP_REASON }, async () => {
    await setup();
    try {
      const spawnTool = mcpTools.find(t => t.name === 'hive-mind_spawn');
      const result = await spawnTool.handler({
        count: 3,
        agentTypes: ['researcher', 'coder', 'tester'],
      });
      assert.equal(result.success, true, `spawn failed: ${result.error}`);
      assert.equal(result.spawned, 3);
      const types = result.workers.map(w => w.agentType);
      assert.deepEqual(types, ['researcher', 'coder', 'tester']);
    } finally {
      teardown();
    }
  });

  it('round-robin wraps with modulo (N=6, 3 types → 2× each)', { skip: SKIP_REASON }, async () => {
    await setup();
    try {
      const spawnTool = mcpTools.find(t => t.name === 'hive-mind_spawn');
      const result = await spawnTool.handler({
        count: 6,
        agentTypes: ['researcher', 'coder', 'tester'],
      });
      assert.equal(result.success, true);
      const types = result.workers.map(w => w.agentType);
      assert.deepEqual(types, [
        'researcher', 'coder', 'tester',
        'researcher', 'coder', 'tester',
      ]);
    } finally {
      teardown();
    }
  });

  it('rejects agentType + agentTypes together (mutex)', { skip: SKIP_REASON }, async () => {
    await setup();
    try {
      const spawnTool = mcpTools.find(t => t.name === 'hive-mind_spawn');
      const result = await spawnTool.handler({
        count: 2,
        agentType: 'coder',
        agentTypes: ['researcher', 'tester'],
      });
      assert.equal(result.success, false);
      assert.match(result.error, /mutually exclusive/);
    } finally {
      teardown();
    }
  });

  it('rejects unknown agentTypes value loudly (no silent skip per feedback-no-fallbacks.md)', { skip: SKIP_REASON }, async () => {
    await setup();
    try {
      const spawnTool = mcpTools.find(t => t.name === 'hive-mind_spawn');
      const result = await spawnTool.handler({
        count: 2,
        agentTypes: ['researcher', 'fizzbuzz'],
      });
      assert.equal(result.success, false);
      assert.match(result.error, /fizzbuzz/);
    } finally {
      teardown();
    }
  });

  it('rejects empty agentTypes array', { skip: SKIP_REASON }, async () => {
    await setup();
    try {
      const spawnTool = mcpTools.find(t => t.name === 'hive-mind_spawn');
      const result = await spawnTool.handler({
        count: 1,
        agentTypes: [],
      });
      assert.equal(result.success, false);
      assert.match(result.error, /at least one/);
    } finally {
      teardown();
    }
  });

  it('preserves degenerate single-element case as N identical workers', { skip: SKIP_REASON }, async () => {
    await setup();
    try {
      const spawnTool = mcpTools.find(t => t.name === 'hive-mind_spawn');
      const result = await spawnTool.handler({
        count: 4,
        agentTypes: ['researcher'],
      });
      assert.equal(result.success, true);
      const types = result.workers.map(w => w.agentType);
      assert.deepEqual(types, ['researcher', 'researcher', 'researcher', 'researcher']);
    } finally {
      teardown();
    }
  });

  it('scalar agentType still works (back-compat with pre-T13 callers)', { skip: SKIP_REASON }, async () => {
    await setup();
    try {
      const spawnTool = mcpTools.find(t => t.name === 'hive-mind_spawn');
      const result = await spawnTool.handler({ count: 3, agentType: 'coder' });
      assert.equal(result.success, true);
      const types = result.workers.map(w => w.agentType);
      assert.deepEqual(types, ['coder', 'coder', 'coder']);
    } finally {
      teardown();
    }
  });
});
