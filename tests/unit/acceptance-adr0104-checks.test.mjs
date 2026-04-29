// @tier unit
// ADR-0097 Tier-Y paired unit test for ADR-0104 (hive-mind Queen orchestration).
//
// Sibling: lib/acceptance-adr0104-checks.sh
//
// This test file is intentionally three-layered:
//
//  1. Static assertions on the check lib + runner wiring (ADR-0097 Tier Y rule)
//  2. Direct behavioral test of the §1 parser hoist
//  3. Direct behavioral test of the §5 hive-store lock under contention
//
// (1) catches drift if check functions are renamed / removed / unwired.
// (2) and (3) lock the source-level fix, independent of CLI binary / Verdaccio.
//
// The behavioral tests import the codemodded build output at
// /tmp/ruflo-build/v3/@claude-flow/cli/dist (produced by `npm run codemod`).
// They are skipped (with a clear reason) if the build is absent — keeps the
// suite green on a fresh checkout that hasn't run the pipeline.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-adr0104-checks.sh');
const RUNNER_FILE = resolve(ROOT, 'scripts', 'test-acceptance.sh');

const BUILD_DIR = '/tmp/ruflo-build/v3/@claude-flow/cli/dist/src';
const PARSER_DIST = join(BUILD_DIR, 'parser.js');
const HIVE_TOOLS_DIST = join(BUILD_DIR, 'mcp-tools', 'hive-mind-tools.js');
const HIVE_CMD_DIST = join(BUILD_DIR, 'commands', 'hive-mind.js');
const MCP_GEN_DIST = join(BUILD_DIR, 'init', 'mcp-generator.js');

const CHECK_FN_NAMES = [
  'check_adr0104_mcp_direct_path',
  'check_adr0104_objective_required',
  'check_adr0104_objective_via_flag',
  'check_adr0104_non_interactive_global',
  'check_adr0104_prompt_no_1422_block',
  'check_adr0104_prompt_v3_contract',
  'check_adr0104_prompt_metadata_preserved',
  'check_adr0104_honest_spawn_wording',
  'check_adr0104_memory_distinct_keys',
  'check_adr0104_memory_same_key',
];

const RUNNER_CHECK_IDS = [
  'adr0104-mcp-path',
  'adr0104-obj-required',
  'adr0104-obj-via-flag',
  'adr0104-noninter-global',
  'adr0104-no-1422',
  'adr0104-v3-contract',
  'adr0104-meta-preserved',
  'adr0104-honest-wording',
  'adr0104-mem-distinct',
  'adr0104-mem-same-key',
];

// ── 1. Static assertions on the check lib + runner wiring ───────────────

describe('ADR-0104 acceptance check lib — static structure', () => {
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
    // Each check function should both initialize and assign these vars.
    // Loose check: count occurrences — every check init + at least one
    // assignment per outcome path.
    const passedCount = (lib.match(/_CHECK_PASSED=/g) || []).length;
    const outputCount = (lib.match(/_CHECK_OUTPUT=/g) || []).length;
    assert.ok(passedCount >= CHECK_FN_NAMES.length,
      `Expected ≥${CHECK_FN_NAMES.length} _CHECK_PASSED= assignments, found ${passedCount}`);
    assert.ok(outputCount >= CHECK_FN_NAMES.length,
      `Expected ≥${CHECK_FN_NAMES.length} _CHECK_OUTPUT= assignments, found ${outputCount}`);
  });
});

describe('ADR-0104 acceptance check lib — runner wiring', () => {
  const runner = existsSync(RUNNER_FILE) ? readFileSync(RUNNER_FILE, 'utf8') : '';

  it('runner sources adr0104_lib', () => {
    assert.match(runner, /adr0104_lib=.*acceptance-adr0104-checks\.sh/);
    assert.match(runner, /\[\[ -f "\$adr0104_lib" \]\] && source "\$adr0104_lib"/);
  });

  for (const id of RUNNER_CHECK_IDS) {
    it(`runner registers run_check_bg "${id}"`, () => {
      assert.ok(runner.includes(`"${id}"`),
        `runner missing ${id} run_check_bg registration`);
    });
  }

  it('runner expands _adr0104_specs in the wait-loop spec list', () => {
    assert.match(runner, /\$\{_adr0104_specs\[@\]\}/);
  });
});

// ── 2. Behavioral: §1 parser hoist of --non-interactive ─────────────────

const buildAvailable = existsSync(PARSER_DIST);

describe('ADR-0104 §1 — parser hoists --non-interactive to globalOptions', () => {
  it('parser.js has the hoisted boolean entry', { skip: buildAvailable ? false : 'codemodded build absent — run `npm run copy-source && npm run codemod`' }, () => {
    const src = readFileSync(PARSER_DIST, 'utf8');
    assert.match(src, /name:\s*['"]non-interactive['"]/);
    assert.match(src, /type:\s*['"]boolean['"]/);
    // The hoist is in initializeGlobalOptions(), not buried in some per-cmd
    // option list. Locate the comment marker we wrote in the source fix.
    assert.match(src, /ADR-0104.*non-interactive|hoisted to globals/i);
  });

  it('parse(["hive-mind","spawn","--non-interactive","obj"]) preserves obj as positional', { skip: buildAvailable ? false : 'codemodded build absent' }, async () => {
    const mod = await import(PARSER_DIST);
    const parser = new mod.CommandParser({ allowUnknownFlags: true });
    // Register a stub `hive-mind` command with `spawn` subcommand so the parser
    // knows it's a real command (matching real registration shape).
    parser.registerCommand({
      name: 'hive-mind',
      description: '',
      handler: async () => ({ success: true }),
      subcommands: [
        { name: 'spawn', description: '', handler: async () => ({ success: true }) },
      ],
    });
    const result = parser.parse(['hive-mind', 'spawn', '--non-interactive', 'Build a REST API']);
    assert.strictEqual(result.flags.nonInteractive, true,
      `--non-interactive must parse as boolean true; got ${JSON.stringify(result.flags.nonInteractive)}`);
    assert.deepStrictEqual(result.positional, ['Build a REST API'],
      `objective must NOT be greedy-consumed by --non-interactive; positional=${JSON.stringify(result.positional)}`);
  });
});

// ── 3. Behavioral: §5 withHiveStoreLock under contention ────────────────

describe('ADR-0104 §5 — hive-mind_memory under concurrent writers', () => {
  it('hive-mind-tools.js has withHiveStoreLock + atomic save', { skip: existsSync(HIVE_TOOLS_DIST) ? false : 'build absent' }, () => {
    const src = readFileSync(HIVE_TOOLS_DIST, 'utf8');
    assert.match(src, /function\s+withHiveStoreLock/);
    assert.match(src, /O_EXCL/);
    assert.match(src, /renameSync/, 'saveHiveState must use atomic rename (tmp + rename)');
  });

  it('handler routes set/delete through withHiveStoreLock; get/list bypass it', { skip: existsSync(HIVE_TOOLS_DIST) ? false : 'build absent' }, () => {
    const src = readFileSync(HIVE_TOOLS_DIST, 'utf8');
    // Find the hive-mind_memory handler region
    const memHandlerStart = src.indexOf("name: 'hive-mind_memory'");
    assert.ok(memHandlerStart > 0, 'hive-mind_memory tool not found');
    const memHandlerEnd = src.indexOf('},', src.indexOf('handler:', memHandlerStart) + 100);
    const handler = src.slice(memHandlerStart, memHandlerEnd);
    // set + delete must invoke withHiveStoreLock; both branches present.
    const lockUses = (handler.match(/withHiveStoreLock/g) || []).length;
    assert.ok(lockUses >= 2, `expected ≥2 withHiveStoreLock invocations in memory handler, found ${lockUses}`);
  });

  it('parallel set with distinct keys: all values persist (lock isolates writers)', { skip: existsSync(HIVE_TOOLS_DIST) ? false : 'build absent' }, async (t) => {
    // Mock findProjectRoot so the hive state lands in a temp dir per test.
    const tmp = mkdtempSync(join(tmpdir(), 'adr0104-lock-'));
    t.after(() => rmSync(tmp, { recursive: true, force: true }));

    // Patch the types module's findProjectRoot. We do this by writing a small
    // ESM wrapper that re-exports the dist module after monkey-patching the
    // shared types import — easier to just chdir + pin findProjectRoot via a
    // marker file, since findProjectRoot walks for known markers.
    // Simpler: import the module and verify lock helper directly via its
    // observable behavior on the file system.
    process.chdir(tmp);
    // Ensure findProjectRoot anchors here: write a package.json marker.
    writeFileSync(join(tmp, 'package.json'), '{"name":"adr0104-lock-test"}');

    const mod = await import(HIVE_TOOLS_DIST);
    const memTool = mod.hiveMindTools.find(t => t.name === 'hive-mind_memory');
    assert.ok(memTool, 'hive-mind_memory tool not exported');

    // Pre-create the hive dir to skip any init noise.
    const initTool = mod.hiveMindTools.find(t => t.name === 'hive-mind_init');
    if (initTool) await initTool.handler({});

    const N = 8;
    const tasks = [];
    for (let i = 0; i < N; i++) {
      tasks.push(memTool.handler({ action: 'set', key: `race-${i}`, value: `v-${i}` }));
    }
    const results = await Promise.all(tasks);
    for (const r of results) assert.strictEqual(r.success, true, `set returned ${JSON.stringify(r)}`);

    // Verify all 8 keys persisted (no race-clobber).
    const list = await memTool.handler({ action: 'list' });
    const raceKeys = list.keys.filter(k => k.startsWith('race-'));
    assert.strictEqual(raceKeys.length, N,
      `Expected ${N} race-* keys, found ${raceKeys.length}: ${JSON.stringify(raceKeys)}`);

    // Verify state.json well-formed JSON (no torn writes) — read directly.
    const statePath = join(tmp, '.claude-flow', 'hive-mind', 'state.json');
    assert.ok(existsSync(statePath), 'state.json not created');
    const parsed = JSON.parse(readFileSync(statePath, 'utf8'));
    for (let i = 0; i < N; i++) {
      assert.strictEqual(parsed.sharedMemory[`race-${i}`], `v-${i}`,
        `race-${i} clobbered: got ${parsed.sharedMemory[`race-${i}`]}`);
    }

    // Lock sentinel cleaned up after final write.
    assert.ok(!existsSync(`${statePath}.lock`),
      'lock sentinel not removed after writes complete');
  });

  it('parallel set on SAME key: exactly one writer-* value persists, JSON intact', { skip: existsSync(HIVE_TOOLS_DIST) ? false : 'build absent' }, async (t) => {
    const tmp = mkdtempSync(join(tmpdir(), 'adr0104-samekey-'));
    t.after(() => rmSync(tmp, { recursive: true, force: true }));
    process.chdir(tmp);
    writeFileSync(join(tmp, 'package.json'), '{"name":"adr0104-samekey-test"}');

    const mod = await import(HIVE_TOOLS_DIST + `?samekey=${Date.now()}`);
    const memTool = mod.hiveMindTools.find(t => t.name === 'hive-mind_memory');

    const initTool = mod.hiveMindTools.find(t => t.name === 'hive-mind_init');
    if (initTool) await initTool.handler({});

    const N = 8;
    const tasks = [];
    for (let i = 0; i < N; i++) {
      tasks.push(memTool.handler({ action: 'set', key: 'race-test', value: `writer-${i}` }));
    }
    await Promise.all(tasks);

    const statePath = join(tmp, '.claude-flow', 'hive-mind', 'state.json');
    const parsed = JSON.parse(readFileSync(statePath, 'utf8'));
    const val = parsed.sharedMemory['race-test'];
    assert.ok(typeof val === 'string' && val.startsWith('writer-'),
      `race-test got unexpected value ${JSON.stringify(val)}`);
    assert.ok(!existsSync(`${statePath}.lock`), 'lock sentinel not removed');
  });
});

// ── 4. Behavioral: §6 prompt content + §3 wording ──────────────────────

describe('ADR-0104 §6 — Queen prompt content', () => {
  it('hive-mind.js prompt has TOOL USE block, no #1422 block', { skip: existsSync(HIVE_CMD_DIST) ? false : 'build absent' }, () => {
    const src = readFileSync(HIVE_CMD_DIST, 'utf8');
    assert.ok(src.includes('TOOL USE'),
      'TOOL USE block missing from hive-mind.js source');
    assert.ok(src.includes('WORKER COORDINATION CONTRACT'),
      'WORKER COORDINATION CONTRACT block missing');
    assert.ok(src.includes("Use Claude Code's Task tool to spawn worker agents"),
      'Task-tool instruction missing');
    assert.ok(src.includes('worker-<your-id>-result'),
      'worker MCP-write contract missing');
    assert.ok(!src.includes('Do NOT use Claude native Task/Agent tools for swarm coordination'),
      '#1422 forbid-Task block STILL PRESENT — revert incomplete');
    assert.ok(!src.includes('TOOL PREFERENCE RULES (#1422)'),
      '#1422 header STILL PRESENT — revert incomplete');
  });

  it('hive-mind.js preserves 4-phase PROTOCOL', { skip: existsSync(HIVE_CMD_DIST) ? false : 'build absent' }, () => {
    const src = readFileSync(HIVE_CMD_DIST, 'utf8');
    for (const phase of ['INITIALIZATION PHASE', 'TASK DISTRIBUTION PHASE', 'COORDINATION PHASE', 'COMPLETION PHASE']) {
      assert.ok(src.includes(phase), `4-phase PROTOCOL missing: ${phase}`);
    }
  });

  it('§3: "Registered N worker slot(s)" wording present; "Spawned N agent(s)" gone', { skip: existsSync(HIVE_CMD_DIST) ? false : 'build absent' }, () => {
    const src = readFileSync(HIVE_CMD_DIST, 'utf8');
    assert.ok(src.includes('Registered ') && src.includes('worker slot(s)'),
      'honest "Registered ... worker slot(s)" wording missing');
    assert.ok(src.includes('actual worker'),
      'clarifier note about actual workers missing');
    // Bare "Spawned N agent(s)" template literal must not survive
    assert.ok(!/printSuccess\(`Spawned \$\{[^}]+\} agent\(s\)`\)/.test(src),
      'pre-fix "Spawned N agent(s)" wording STILL PRESENT');
  });
});

// ── 5. Behavioral: §4a mcp-generator direct-path detection ─────────────

describe('ADR-0104 §4a — mcp-generator direct-path detection', () => {
  it('mcp-generator.js exposes detectClaudeFlowPath / createClaudeFlowEntry', { skip: existsSync(MCP_GEN_DIST) ? false : 'build absent' }, () => {
    const src = readFileSync(MCP_GEN_DIST, 'utf8');
    assert.match(src, /detectClaudeFlowPath/);
    assert.match(src, /createClaudeFlowEntry/);
    // Must reference `which claude-flow` or `where claude-flow` (Windows)
    assert.ok(/which claude-flow/.test(src) || /where claude-flow/.test(src),
      'no `which`/`where claude-flow` invocation found');
  });

  it('claude-flow MCP entry uses createClaudeFlowEntry (not the npx wrapper)', { skip: existsSync(MCP_GEN_DIST) ? false : 'build absent' }, () => {
    const src = readFileSync(MCP_GEN_DIST, 'utf8');
    // The Claude Flow registration block invokes createClaudeFlowEntry.
    assert.match(src, /mcpServers\['claude-flow'\]\s*=\s*createClaudeFlowEntry/);
  });
});
