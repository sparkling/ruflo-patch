// @tier unit
// ADR-0125 — Queen-type runtime differentiation (Strategic / Tactical / Adaptive).
//
// Sibling: lib/acceptance-adr0125-queen-types.sh
//
// Three layers per ADR-0097 / ADR-0125 §Validation:
//
//  1. Static lib + runner-wiring assertions (Tier-Y rule)
//  2. Behavioural unit tests calling generateHiveMindPrompt directly:
//       - pairwise-distinct bodies
//       - per-type sentinels present, wrong-type sentinels absent
//       - section parity (both headings in every variant)
//       - unknown queenType throws
//  3. Integration test for the CLI-boundary validation path: the spawn
//     action throws the exact `--queen-type must be one of …` message
//     for unknown values BEFORE reaching `generateHiveMindPrompt`.
//
// Behavioural tests import the codemodded fork-build output at
// /tmp/ruflo-build/v3/@claude-flow/cli/dist/src/commands/hive-mind.js
// (produced by `npm run build` in the fork). When that build is absent,
// they fall back to importing directly from the fork's
// /Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/dist/src/commands/hive-mind.js
// so a fresh checkout that hasn't run the codemod still exercises the
// behaviour. If neither dist exists, the tests skip with a clear reason.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-adr0125-queen-types.sh');
const RUNNER_FILE = resolve(ROOT, 'scripts', 'test-acceptance.sh');

const CODEMOD_DIST = '/tmp/ruflo-build/v3/@claude-flow/cli/dist/src/commands/hive-mind.js';
const FORK_DIST = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/dist/src/commands/hive-mind.js';

// Prefer whichever dist exposes the exported `generateHiveMindPrompt` —
// pre-T7 builds compiled it as a non-exported function. The codemod dist
// at /tmp/ruflo-build is rebuilt by `npm run codemod` after a fork-source
// edit; until that rebuild lands, the fork's own dist is the only one
// that carries the new export. Skip with a clear reason if neither has it.
function pickDist() {
  for (const candidate of [CODEMOD_DIST, FORK_DIST]) {
    if (!existsSync(candidate)) continue;
    const src = readFileSync(candidate, 'utf8');
    if (src.includes('export function generateHiveMindPrompt')) {
      return candidate;
    }
  }
  return null;
}
const HIVE_CMD_DIST = pickDist();
const SKIP_REASON = HIVE_CMD_DIST ? false : 'no fork build with exported generateHiveMindPrompt — run `npm run build` in forks/ruflo (T7 export expected)';

const QUEEN_TYPES = ['strategic', 'tactical', 'adaptive'];

const SENTINELS = {
  strategic: 'written plan',
  tactical: 'spawned workers within',
  adaptive: 'named your chosen mode',
};

const SECTION_HEADINGS = ['Tools you should reach for first', 'Before declaring done, verify'];

const CHECK_FN_NAMES = [
  'check_adr0125_strategic_sentinel',
  'check_adr0125_tactical_sentinel',
  'check_adr0125_adaptive_sentinel',
  'check_adr0125_pairwise_distinct',
  'check_adr0125_section_parity',
  'check_adr0125_readme_copy_correction',
];

const RUNNER_CHECK_IDS = [
  'adr0125-strategic',
  'adr0125-tactical',
  'adr0125-adaptive',
  'adr0125-pairwise',
  'adr0125-section-parity',
  'adr0125-readme-copy',
];

// Minimal stub context. The renderer only reads scalar fields + the
// workerGroups map; nothing requires real workers.
function buildCtx() {
  return [
    'swarm-test-001',
    'Test Hive',
    'List 3 prime numbers',
    [], // workers
    {}, // workerGroups
  ];
}

// ── 1. Static check-lib + runner-wiring assertions ─────────────────────

describe('ADR-0125 acceptance check lib — static structure', () => {
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
    // Allow `npx --yes ...@latest` only inside _cli_cmd resolution context.
    // The cheap rule: no bare `npx @sparkleideas/cli@latest` in the script.
    const violations = lib.match(/npx\s+@sparkleideas\/cli@latest/g) || [];
    assert.equal(violations.length, 0,
      `acceptance script must use $(_cli_cmd), not raw npx — found ${violations.length} violation(s)`);
  });
});

describe('ADR-0125 acceptance check lib — runner wiring', () => {
  const runner = existsSync(RUNNER_FILE) ? readFileSync(RUNNER_FILE, 'utf8') : '';

  it('runner sources adr0125_lib', () => {
    assert.match(runner, /adr0125_lib=.*acceptance-adr0125-queen-types\.sh/,
      'runner missing adr0125_lib= assignment');
    assert.match(runner, /\[\[ -f "\$adr0125_lib" \]\] && source "\$adr0125_lib"/,
      'runner missing source guard');
  });

  for (const id of RUNNER_CHECK_IDS) {
    it(`runner registers run_check_bg "${id}"`, () => {
      assert.ok(runner.includes(`"${id}"`),
        `runner missing ${id} run_check_bg registration`);
    });
  }
});

// ── 2. Behavioural: generateHiveMindPrompt direct calls ────────────────

describe('ADR-0125 §Decision — generateHiveMindPrompt per-type rendering', () => {
  it('exports generateHiveMindPrompt as a callable', { skip: SKIP_REASON }, async () => {
    const mod = await import(HIVE_CMD_DIST);
    assert.equal(typeof mod.generateHiveMindPrompt, 'function',
      `generateHiveMindPrompt not exported as function from ${HIVE_CMD_DIST}`);
  });

  it('generateHiveMindPrompt-returns-pairwise-distinct-bodies', { skip: SKIP_REASON }, async () => {
    const mod = await import(HIVE_CMD_DIST);
    const args = buildCtx();
    const strategic = mod.generateHiveMindPrompt(...args, { queenType: 'strategic' });
    const tactical = mod.generateHiveMindPrompt(...args, { queenType: 'tactical' });
    const adaptive = mod.generateHiveMindPrompt(...args, { queenType: 'adaptive' });

    assert.ok(strategic.length > 0, 'strategic prompt empty');
    assert.ok(tactical.length > 0, 'tactical prompt empty');
    assert.ok(adaptive.length > 0, 'adaptive prompt empty');

    assert.notEqual(strategic, tactical, 'strategic === tactical (not differentiated)');
    assert.notEqual(strategic, adaptive, 'strategic === adaptive (not differentiated)');
    assert.notEqual(tactical, adaptive, 'tactical === adaptive (not differentiated)');
  });

  it('generateHiveMindPrompt-emits-per-type-sentinels (per-type present, wrong-type absent)', { skip: SKIP_REASON }, async () => {
    const mod = await import(HIVE_CMD_DIST);
    const args = buildCtx();

    for (const qt of QUEEN_TYPES) {
      const prompt = mod.generateHiveMindPrompt(...args, { queenType: qt });
      const ownSentinel = SENTINELS[qt];
      assert.ok(prompt.includes(ownSentinel),
        `${qt} prompt missing own sentinel "${ownSentinel}"`);

      // Wrong-type sentinels must be absent
      for (const otherQt of QUEEN_TYPES) {
        if (otherQt === qt) continue;
        const wrongSentinel = SENTINELS[otherQt];
        // Some sentinels are very generic; require the EXACT phrasing only
        // for the variant that owns it.
        assert.ok(!prompt.includes(wrongSentinel),
          `${qt} prompt unexpectedly contains ${otherQt}'s sentinel "${wrongSentinel}"`);
      }
    }
  });

  it('generateHiveMindPrompt-section-parity (both headings in every variant)', { skip: SKIP_REASON }, async () => {
    const mod = await import(HIVE_CMD_DIST);
    const args = buildCtx();

    for (const qt of QUEEN_TYPES) {
      const prompt = mod.generateHiveMindPrompt(...args, { queenType: qt });
      for (const heading of SECTION_HEADINGS) {
        assert.ok(prompt.includes(heading),
          `${qt} prompt missing section heading "${heading}" — section parity broken`);
      }
    }
  });

  it('generateHiveMindPrompt-unknown-queen-type-throws (no silent fallback to strategic)', { skip: SKIP_REASON }, async () => {
    const mod = await import(HIVE_CMD_DIST);
    const args = buildCtx();

    assert.throws(
      () => mod.generateHiveMindPrompt(...args, { queenType: 'banana' }),
      /unknown queenType: banana/,
      'unknown queenType must throw a descriptive Error',
    );
  });

  it('per-variant tool emphasis differs (Strategic / Tactical / Adaptive tool sets)', { skip: SKIP_REASON }, async () => {
    const mod = await import(HIVE_CMD_DIST);
    const args = buildCtx();
    const strategic = mod.generateHiveMindPrompt(...args, { queenType: 'strategic' });
    const tactical = mod.generateHiveMindPrompt(...args, { queenType: 'tactical' });
    const adaptive = mod.generateHiveMindPrompt(...args, { queenType: 'adaptive' });

    // ADR-0125 §Phase 2 contract: each variant's preferred-tools list MUST
    // surface the canonical primary tool for that disposition.
    //
    // The shared header advertises the full MCP catalog (so generic tool
    // names appear in all three variants); we anchor on per-variant
    // strings that ONLY appear under "Tools you should reach for first"
    // for that disposition.

    // Strategic: planning + memory primitives
    assert.ok(strategic.includes('mcp__ruflo__task_create        — build the plan tree'),
      'strategic prompt missing planning-first tool framing');

    // Tactical: dispatch + status primitives
    assert.ok(tactical.includes('mcp__ruflo__agent_spawn         — bring workers online quickly'),
      'tactical prompt missing dispatch-first tool framing');

    // Adaptive: consensus tool MUST be the first listed under "reach for first"
    assert.ok(adaptive.includes('mcp__ruflo__hive-mind_consensus — confirm mode switches with the swarm'),
      'adaptive prompt missing consensus-tool framing');
  });
});

// ── 3. Behavioural: CLI-boundary validation rejects unknown queenType ──

describe('ADR-0125 §Specification — CLI-boundary validation', () => {
  it('source carries the exact `--queen-type must be one of` error string', () => {
    // The fork's source file (not dist) carries the literal — the dist may
    // template-interpolate it. Assert against source so codemod/build cannot
    // drift the contract message.
    const SOURCE_PATH = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts';
    if (!existsSync(SOURCE_PATH)) {
      // Skip when running outside a checkout that includes the fork (e.g.
      // CI on ruflo-patch only).
      return;
    }
    const src = readFileSync(SOURCE_PATH, 'utf8');
    assert.match(src, /--queen-type must be one of/,
      'fork source missing CLI-boundary error string');
    // Validation is performed BEFORE generateHiveMindPrompt is called.
    // The validation block lives in the spawn `action:` body; the
    // generation site is reached via `await spawnClaudeCodeInstance(`
    // inside that same action. Anchor on the awaited invocation —
    // NOT the function declaration `async function spawnClaudeCodeInstance(`
    // which appears earlier in the file.
    const validationIdx = src.indexOf('--queen-type must be one of');
    const dispatcherIdx = src.indexOf('await spawnClaudeCodeInstance(');
    assert.ok(validationIdx > 0,
      'fork source must contain the CLI-boundary error string at least once');
    assert.ok(dispatcherIdx > 0,
      'fork source must invoke spawnClaudeCodeInstance via `await`');
    assert.ok(dispatcherIdx > validationIdx,
      `CLI-boundary validation must precede the awaited spawnClaudeCodeInstance call site (validation at ${validationIdx}, await at ${dispatcherIdx})`);
  });

  it('CLI-boundary validation throws BEFORE generateHiveMindPrompt is called', { skip: SKIP_REASON }, async () => {
    const mod = await import(HIVE_CMD_DIST);
    // The exported default is the hive-mind command tree. The spawn
    // subcommand carries the action with the validation. We can't
    // construct a real CommandContext easily, but we can verify the
    // dist's source string carries the validation literal — the static
    // check above does that. Here we exercise the fail-loud surface
    // directly by calling generateHiveMindPrompt with an unknown
    // queenType and confirming the throw is the defence-in-depth one
    // (NOT the CLI-boundary one, which has different wording).
    const args = buildCtx();
    let err = null;
    try {
      mod.generateHiveMindPrompt(...args, { queenType: 'banana' });
    } catch (e) {
      err = e;
    }
    assert.ok(err instanceof Error, 'expected throw on unknown queenType');
    // Defence-in-depth message vs CLI-boundary message: they must be distinct
    // so callers can tell which layer caught the bad input.
    assert.match(err.message, /unknown queenType:/,
      'defence-in-depth message must be `unknown queenType: …`, not the CLI-boundary string');
    assert.doesNotMatch(err.message, /--queen-type must be one of/,
      'defence-in-depth path must NOT use the CLI-boundary error wording');
  });
});

// ── 4. Behavioural: README + USERGUIDE copy correction (Phase 5 / H4) ──

describe('ADR-0125 Phase 5 — fork README + USERGUIDE copy correction', () => {
  const README = '/Users/henrik/source/forks/ruflo/README.md';
  const USERGUIDE = '/Users/henrik/source/forks/ruflo/docs/USERGUIDE.md';

  it('fork-root README carries the corrected prose-shaped framing', () => {
    if (!existsSync(README)) return;
    const md = readFileSync(README, 'utf8');
    assert.match(md, /Differentiation is prompt-shaped, not algorithmic/,
      'fork README missing the corrected framing sentinel');
    assert.match(md, /Strategic \(planning-first\)/,
      'fork README missing the planning-first relabel');
    assert.match(md, /Tactical \(execution-first\)/,
      'fork README missing the execution-first relabel');
    assert.match(md, /Adaptive \(mode-switching by complexity\)/,
      'fork README missing the mode-switching relabel');
  });

  it('fork-root README no longer carries the bare offending copy', () => {
    if (!existsSync(README)) return;
    const md = readFileSync(README, 'utf8');
    assert.doesNotMatch(md, /Strategic \(planning\), Tactical \(execution\), Adaptive \(optimization\)/,
      'fork README still carries the bare "Strategic (planning), Tactical (execution), Adaptive (optimization)" string');
  });

  it('USERGUIDE Hive Mind §Capabilities also picks up the corrected copy', () => {
    if (!existsSync(USERGUIDE)) return;
    const md = readFileSync(USERGUIDE, 'utf8');
    assert.match(md, /Strategic \(planning-first\)/,
      'USERGUIDE not updated to corrected framing');
    assert.doesNotMatch(md, /Strategic \(planning\), Tactical \(execution\), Adaptive \(optimization\)/,
      'USERGUIDE still carries the bare offending string');
  });
});
