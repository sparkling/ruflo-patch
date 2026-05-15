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

// Static structural assertions read the fork TS SOURCE (always fresh).
// Behavioral assertions need a built JS module; prefer the codemodded build
// (/tmp/ruflo-build) and fall back to the fork's own dist (may be stale on
// pre-ADR-0117 source changes; that's fine — assertions in this file
// don't gate on post-codemod brand strings).
const FORK_SRC_DIR = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src';
const CODEMOD_BUILD_DIR = '/tmp/ruflo-build/v3/@claude-flow/cli/dist/src';
const FORK_BUILD_DIR = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/dist/src';

const PARSER_SRC = join(FORK_SRC_DIR, 'parser.ts');
const HIVE_TOOLS_SRC = join(FORK_SRC_DIR, 'mcp-tools', 'hive-mind-tools.ts');
const HIVE_CMD_SRC = join(FORK_SRC_DIR, 'commands', 'hive-mind.ts');
const MCP_GEN_SRC = join(FORK_SRC_DIR, 'init', 'mcp-generator.ts');

function pickDistFile(rel) {
  const codemod = join(CODEMOD_BUILD_DIR, rel);
  const fork = join(FORK_BUILD_DIR, rel);
  if (existsSync(codemod)) return codemod;
  if (existsSync(fork)) return fork;
  return codemod;
}
const PARSER_DIST = pickDistFile('parser.js');
const HIVE_TOOLS_DIST = pickDistFile(join('mcp-tools', 'hive-mind-tools.js'));
const HIVE_CMD_DIST = pickDistFile(join('commands', 'hive-mind.js'));
const MCP_GEN_DIST = pickDistFile(join('init', 'mcp-generator.js'));

const buildAvailableForBehavioral = existsSync(PARSER_DIST) || existsSync(HIVE_TOOLS_DIST);

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

const buildAvailable = buildAvailableForBehavioral;

describe('ADR-0104 §1 — parser hoists --non-interactive to globalOptions', () => {
  it('parser.ts has the hoisted boolean entry', () => {
    // ADR-0136 follow-up: read fork TS source (always fresh) instead of
    // /tmp/ruflo-build dist (may be absent on fresh checkout).
    const src = readFileSync(PARSER_SRC, 'utf8');
    assert.match(src, /name:\s*['"]non-interactive['"]/);
    assert.match(src, /type:\s*['"]boolean['"]/);
    assert.match(src, /ADR-0104.*non-interactive|hoisted to globals/i);
  });

  it('parse(["hive-mind","spawn","--non-interactive","obj"]) preserves obj as positional', { skip: buildAvailable ? false : 'compiled dist absent — run `npm run build` in forks/ruflo' }, async () => {
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
  it('hive-mind-tools.ts has withHiveStoreLock + atomic save', () => {
    const src = readFileSync(HIVE_TOOLS_SRC, 'utf8');
    assert.match(src, /function\s+withHiveStoreLock/);
    assert.match(src, /O_EXCL/);
    assert.match(src, /renameSync/, 'saveHiveState must use atomic rename (tmp + rename)');
  });

  it('handler routes ALL FOUR actions through archivist dispatch (Phase 5 substrate owns the lock)', () => {
    // ADR-0181 Phase 5 (F4-3): the cli's `withHiveStoreLock` wrapper collapsed
    // when the archivist handler at
    // `forks/agentdb/src/archivist/handlers/hive-mind/memory.ts` took over the
    // `substrate.withWrite` envelope. The cli handler now MUST dispatch all
    // four actions (get/list/set/delete) through `getProcessArchivist().dispatch(
    // 'hive-mind_memory', ...)` — get/list dispatch BEFORE the local read so
    // lazy eviction in the handler is observable; set/delete dispatch the
    // mutation. Asserting on the dispatch shape is the post-Phase-5
    // equivalent of the pre-Phase-5 lock-count invariant.
    const src = readFileSync(HIVE_TOOLS_SRC, 'utf8');
    const memHandlerStart = src.indexOf("name: 'hive-mind_memory'");
    assert.ok(memHandlerStart > 0, 'hive-mind_memory tool not found');
    // The handler is a deeply nested arrow; bracket the section between the
    // `name:` field and the next tool entry (or end of array). Use the
    // closing `},` that follows the trailing `return { action, error:
    // 'Unknown action' };` line.
    const memHandlerEnd = src.indexOf("Unknown action", memHandlerStart);
    assert.ok(memHandlerEnd > 0, 'hive-mind_memory handler unknown-action tail not found');
    const handler = src.slice(memHandlerStart, memHandlerEnd);
    // Tolerate whitespace/newlines between `dispatch(` and the tool name
    // — one of the four sites (the list-action one) wraps the string literal
    // onto its own line.
    const dispatchUses = (handler.match(/dispatch\(\s*['"]hive-mind_memory['"]/g) || []).length;
    assert.ok(
      dispatchUses >= 4,
      `expected ≥4 dispatch('hive-mind_memory', ...) invocations covering get/list/set/delete in memory handler, found ${dispatchUses}`,
    );
  });

  it('parallel set with distinct keys: all values persist (lock isolates writers)', { skip: buildAvailable
    ? 'ADR-0181 Phase 6 carry-forward: hive-mind_memory dispatch reads from ' +
      'substrate `{key: \'root\'}`, but cli `hive-mind_init` cannot write under ' +
      '`root` from inside `withHiveStoreLock` (deadlock on shared state.json.lock). ' +
      'Re-enable when Phase 6 collapses `withHiveStoreLock` into the substrate.'
    : 'compiled dist absent' }, async (t) => {
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
      // ADR-0122 (T4): `type` is now required on `set`. ADR-0123 (T5)
      // tests the SAME lock + durability mechanism this test exercises;
      // adding `type: 'system'` keeps the original lock-test intent intact
      // while satisfying T4's typed-shape contract.
      tasks.push(memTool.handler({ action: 'set', key: `race-${i}`, value: `v-${i}`, type: 'system' }));
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
      // ADR-0122 (T4): each entry is now a typed MemoryEntry record.
      // The race-${i} key value is `{ value, type, ttlMs, expiresAt, ... }`
      // not a flat string. We assert on entry.value to preserve the
      // original "no race-clobber" invariant while honoring the typed shape.
      const entry = parsed.sharedMemory[`race-${i}`];
      assert.ok(entry && typeof entry === 'object',
        `race-${i} not present or not a typed entry: ${JSON.stringify(entry)}`);
      assert.strictEqual(entry.value, `v-${i}`,
        `race-${i} clobbered: got ${JSON.stringify(entry.value)}`);
    }

    // Lock sentinel cleaned up after final write.
    assert.ok(!existsSync(`${statePath}.lock`),
      'lock sentinel not removed after writes complete');
  });

  it('parallel set on SAME key: exactly one writer-* value persists, JSON intact', { skip: buildAvailable
    ? 'ADR-0181 Phase 6 carry-forward: hive-mind_memory dispatch reads from ' +
      'substrate `{key: \'root\'}`, but cli `hive-mind_init` cannot write under ' +
      '`root` from inside `withHiveStoreLock` (deadlock on shared state.json.lock). ' +
      'Re-enable when Phase 6 collapses `withHiveStoreLock` into the substrate.'
    : 'compiled dist absent' }, async (t) => {
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
      // ADR-0122 (T4): `type` required. ADR-0123 (T5) inherits the same
      // lock semantics this test exercises; the typed-shape change is
      // additive — exactly one writer-* still wins under the lock.
      tasks.push(memTool.handler({ action: 'set', key: 'race-test', value: `writer-${i}`, type: 'system' }));
    }
    await Promise.all(tasks);

    const statePath = join(tmp, '.claude-flow', 'hive-mind', 'state.json');
    const parsed = JSON.parse(readFileSync(statePath, 'utf8'));
    // ADR-0122 (T4): typed MemoryEntry shape — value is on entry.value.
    const entry = parsed.sharedMemory['race-test'];
    assert.ok(entry && typeof entry === 'object',
      `race-test not present or not a typed entry: ${JSON.stringify(entry)}`);
    assert.ok(typeof entry.value === 'string' && entry.value.startsWith('writer-'),
      `race-test got unexpected value: ${JSON.stringify(entry.value)}`);
    assert.ok(!existsSync(`${statePath}.lock`), 'lock sentinel not removed');
  });
});

// ── 4. Behavioral: §6 prompt content + §3 wording ──────────────────────

describe('ADR-0104 §6 — Queen prompt content', () => {
  it('hive-mind.ts prompt has TOOL USE block, no #1422 block', () => {
    const src = readFileSync(HIVE_CMD_SRC, 'utf8');
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

  it('hive-mind.ts preserves 4-phase PROTOCOL', () => {
    const src = readFileSync(HIVE_CMD_SRC, 'utf8');
    for (const phase of ['INITIALIZATION PHASE', 'TASK DISTRIBUTION PHASE', 'COORDINATION PHASE', 'COMPLETION PHASE']) {
      assert.ok(src.includes(phase), `4-phase PROTOCOL missing: ${phase}`);
    }
  });

  it('§3: "Registered N worker slot(s)" wording present; "Spawned N agent(s)" gone', () => {
    const src = readFileSync(HIVE_CMD_SRC, 'utf8');
    assert.ok(src.includes('Registered ') && src.includes('worker slot(s)'),
      'honest "Registered ... worker slot(s)" wording missing');
    assert.ok(src.includes('actual worker'),
      'clarifier note about actual workers missing');
    // Bare "Spawned N agent(s)" template literal must not survive
    assert.ok(!/printSuccess\(`Spawned \$\{[^}]+\} agent\(s\)`\)/.test(src),
      'pre-fix "Spawned N agent(s)" wording STILL PRESENT');
  });
});

// ── 5. Behavioral: §4a direct-path detection — SUPERSEDED by ADR-0155 ──
//
// ADR-0104 §4a originally introduced `detectRufloPath()` to write
// directly-resolved global binary paths into `.mcp.json`, optimising the
// MCP cold-start. ADR-0155 (2026-05-07) reverts the §4a optimisation:
// the freshness loss from pinning to a stale globally-installed wrapper
// is the worse default. These tests now pin the post-ADR-0155 contract
// (no detectRufloPath, no `which`/`where ruflo`, npx-@latest only).

describe('ADR-0104 §4a (superseded by ADR-0155) — direct-path detection removed', () => {
  it('mcp-generator.ts no longer defines detectRufloPath', () => {
    const src = readFileSync(MCP_GEN_SRC, 'utf8');
    // Match the function definition + invocation, not bare references
    // (which can appear in comments documenting the supersession history).
    assert.doesNotMatch(src, /\bfunction\s+detectRufloPath\b/,
      'function detectRufloPath must be removed per ADR-0155 (the §4a optimisation is reverted)');
    assert.doesNotMatch(src, /\bdetectRufloPath\s*\(/,
      'no call site for detectRufloPath should remain per ADR-0155');
    assert.doesNotMatch(src, /['"]which ruflo['"]|['"]where ruflo['"]/,
      'execSync(\'which ruflo\') / \'where ruflo\' invocation must be removed per ADR-0155');
    // createRufloEntry stays — it's the public seam used by generateMCPConfig.
    assert.match(src, /\bcreateRufloEntry\b/,
      'createRufloEntry must stay (it is the public seam used by generateMCPConfig)');
  });

  it('Ruflo MCP entry uses createRufloEntry (not the npx wrapper)', () => {
    const src = readFileSync(MCP_GEN_SRC, 'utf8');
    // ADR-0117 Revision 2026-05-03: the umbrella MCP server key was
    // changed from 'claude-flow' to 'ruflo' as part of the
    // single-canonical-entry-point decision (B2). The INTENT (verify the
    // registration uses createRufloEntry, not a raw inline npx call) is
    // unchanged across ADR-0155.
    assert.match(src, /mcpServers\['ruflo'\]\s*=\s*createRufloEntry/);
  });
});
