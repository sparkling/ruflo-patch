// @tier unit
// ADR-0126 — Worker-type runtime differentiation (T8): per-worker-type prose
// blocks, typeMatches coverage, capability-score nudges, and empty-pool throw.
//
// Sibling: lib/acceptance-adr0126-worker-types.sh
//
// Three layers per ADR-0097 / ADR-0126 §Validation:
//
//  1. Static lib + runner-wiring assertions (Tier-Y rule)
//  2. Behavioural unit tests calling generateHiveMindPrompt directly:
//       - 8 pairwise-distinct prose blocks for the 8 USERGUIDE types
//       - structural-contract sections present in fixed order
//       - active queen-type sentinel embedded in each block
//       - non-USERGUIDE types tolerated in count summary, no prose block
//       - unknown worker-type at prompt site throws
//  3. Static source-side assertion that calculateCapabilityScore in
//     queen-coordinator.ts throws on empty-pool (per
//     `feedback-no-fallbacks.md`) — the dist-side behaviour is exercised
//     by the swarm package's own queen-coordinator.test.ts; this assertion
//     is a fork-source contract check.
//
// Behavioural tests import the codemodded fork-build output at
// /tmp/ruflo-build/v3/@claude-flow/cli/dist/src/commands/hive-mind.js
// when present; otherwise fall back to the fork's own dist. If neither
// exposes a build that emits the per-type prose blocks, the behavioural
// tests skip with a clear reason.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-adr0126-worker-types.sh');
const RUNNER_FILE = resolve(ROOT, 'scripts', 'test-acceptance.sh');

const CODEMOD_DIST = '/tmp/ruflo-build/v3/@claude-flow/cli/dist/src/commands/hive-mind.js';
const FORK_DIST = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/dist/src/commands/hive-mind.js';

// Prefer whichever dist exposes the T8-extended `generateHiveMindPrompt` —
// pre-T8 builds emit only the count-summary `WORKER DISTRIBUTION` line and
// no `## Worker role:` headings. Skip with a clear reason if neither dist
// shows the per-type prose blocks.
function pickDist() {
  for (const candidate of [CODEMOD_DIST, FORK_DIST]) {
    if (!existsSync(candidate)) continue;
    const src = readFileSync(candidate, 'utf8');
    if (
      src.includes('export function generateHiveMindPrompt') &&
      src.includes('Worker role: researcher')
    ) {
      return candidate;
    }
  }
  return null;
}
const HIVE_CMD_DIST = pickDist();
const SKIP_REASON = HIVE_CMD_DIST
  ? false
  : 'no fork build with T8 worker-type prose blocks — run `npm run build` in forks/ruflo (T8 export expected to include "Worker role: researcher")';

const USERGUIDE_WORKER_TYPES = [
  'researcher', 'coder', 'analyst', 'architect',
  'tester', 'reviewer', 'optimizer', 'documenter',
];

const QUEEN_SENTINELS = {
  strategic: 'written plan',
  tactical: 'spawned workers within',
  adaptive: 'named your chosen mode',
};

const STRUCTURAL_HEADINGS = [
  '## Worker role:',
  '### Tools you should reach for first',
  '### Working with the active queen',
];

const CHECK_FN_NAMES = [
  'check_adr0126_all_8_blocks_present',
  'check_adr0126_structural_contract',
  'check_adr0126_queen_cross_reference',
  'check_adr0126_unknown_type_throws',
  'check_adr0126_empty_pool_rejected',
];

const RUNNER_CHECK_IDS = [
  'adr0126-all-8-blocks',
  'adr0126-structural-contract',
  'adr0126-queen-xref',
  'adr0126-unknown-type-throws',
  'adr0126-empty-pool-rejected',
];

// Build a worker pool covering all 8 USERGUIDE types.
function buildAllTypePool() {
  const workers = USERGUIDE_WORKER_TYPES.map((type, i) => ({
    agentId: `agent_${i}`,
    role: type,
    type,
  }));
  const workerGroups = {};
  for (const w of workers) {
    if (!workerGroups[w.type]) workerGroups[w.type] = [];
    workerGroups[w.type].push(w);
  }
  return { workers, workerGroups };
}

// ── 1. Static check-lib + runner-wiring assertions ─────────────────────

describe('ADR-0126 acceptance check lib — static structure', () => {
  const lib = existsSync(CHECK_FILE) ? readFileSync(CHECK_FILE, 'utf8') : '';

  it('lib file exists', () => {
    assert.ok(existsSync(CHECK_FILE), `Expected ${CHECK_FILE} to exist`);
  });

  for (const fn of CHECK_FN_NAMES) {
    it(`defines ${fn}()`, () => {
      assert.match(
        lib,
        new RegExp(`^${fn}\\s*\\(\\)\\s*\\{`, 'm'),
        `${fn}() not found in ${CHECK_FILE}`,
      );
    });
  }

  it('every check sets _CHECK_PASSED and _CHECK_OUTPUT', () => {
    const passedCount = (lib.match(/_CHECK_PASSED=/g) || []).length;
    const outputCount = (lib.match(/_CHECK_OUTPUT=/g) || []).length;
    assert.ok(
      passedCount >= CHECK_FN_NAMES.length,
      `Expected ≥${CHECK_FN_NAMES.length} _CHECK_PASSED= assignments, found ${passedCount}`,
    );
    assert.ok(
      outputCount >= CHECK_FN_NAMES.length,
      `Expected ≥${CHECK_FN_NAMES.length} _CHECK_OUTPUT= assignments, found ${outputCount}`,
    );
  });

  it('lib uses $(_cli_cmd), never raw npx @latest (per reference-cli-cmd-helper.md)', () => {
    if (!lib) return;
    const violations = lib.match(/npx\s+@sparkleideas\/cli@latest/g) || [];
    assert.equal(
      violations.length,
      0,
      `acceptance script must use $(_cli_cmd), not raw npx — found ${violations.length} violation(s)`,
    );
  });
});

// Runner wiring is appended by the orchestrator — this assertion checks
// that THE LIB IS WIRED but tolerates the orchestrator running with
// adr0126 wiring still pending.
describe('ADR-0126 acceptance check lib — runner wiring (when wired)', () => {
  const runner = existsSync(RUNNER_FILE) ? readFileSync(RUNNER_FILE, 'utf8') : '';
  const wired = /adr0126_lib=.*acceptance-adr0126-worker-types\.sh/.test(runner);

  it('runner sources adr0126_lib (when orchestrator has wired the lib)', { skip: !wired }, () => {
    assert.match(
      runner,
      /adr0126_lib=.*acceptance-adr0126-worker-types\.sh/,
      'runner missing adr0126_lib= assignment',
    );
    assert.match(
      runner,
      /\[\[ -f "\$adr0126_lib" \]\] && source "\$adr0126_lib"/,
      'runner missing source guard',
    );
  });

  for (const id of RUNNER_CHECK_IDS) {
    it(`runner registers run_check_bg "${id}" (when wired)`, { skip: !wired }, () => {
      assert.ok(
        runner.includes(`"${id}"`),
        `runner missing ${id} run_check_bg registration`,
      );
    });
  }
});

// ── 2. Behavioural: generateHiveMindPrompt direct calls ────────────────

describe('ADR-0126 §Decision — per-worker-type prose blocks', () => {
  it('emits a pairwise-distinct prose block for every USERGUIDE worker type', { skip: SKIP_REASON }, async () => {
    const mod = await import(HIVE_CMD_DIST);
    const { workers, workerGroups } = buildAllTypePool();

    const prompt = mod.generateHiveMindPrompt(
      'swarm-t8',
      'T8 Probe',
      'Cover all 8 USERGUIDE types',
      workers,
      workerGroups,
      { queenType: 'strategic' },
    );

    for (const t of USERGUIDE_WORKER_TYPES) {
      assert.ok(
        prompt.includes(`## Worker role: ${t}`),
        `prompt missing "## Worker role: ${t}" heading — type not differentiated`,
      );
    }

    // Pairwise distinctness: 8 unique role headings.
    const roleHeadings = prompt.match(/## Worker role: \w+/g) || [];
    const uniq = new Set(roleHeadings);
    assert.equal(uniq.size, 8, `expected 8 unique role headings, found ${uniq.size}`);
  });

  it('every prose block carries the three structural-contract sections in fixed order', { skip: SKIP_REASON }, async () => {
    const mod = await import(HIVE_CMD_DIST);
    const { workers, workerGroups } = buildAllTypePool();
    const prompt = mod.generateHiveMindPrompt(
      'swarm-t8',
      'T8 Probe',
      'All 8 types',
      workers,
      workerGroups,
      { queenType: 'tactical' },
    );

    for (const t of USERGUIDE_WORKER_TYPES) {
      const roleIdx = prompt.indexOf(`## Worker role: ${t}`);
      assert.ok(roleIdx >= 0, `${t} role heading missing`);
      const nextRoleIdx = prompt.indexOf('## Worker role:', roleIdx + 1);
      const blockEnd = nextRoleIdx === -1 ? prompt.length : nextRoleIdx;
      const block = prompt.slice(roleIdx, blockEnd);

      // Order: role -> tools -> queen
      const toolsIdx = block.indexOf(STRUCTURAL_HEADINGS[1]);
      const queenIdx = block.indexOf(STRUCTURAL_HEADINGS[2]);
      assert.ok(toolsIdx > 0, `${t} block missing "${STRUCTURAL_HEADINGS[1]}"`);
      assert.ok(queenIdx > toolsIdx, `${t} block has queen-section before tools-section (order broken)`);
    }
  });

  it('each prose block embeds the active queen-type sentinel (cross-reference contract)', { skip: SKIP_REASON }, async () => {
    const mod = await import(HIVE_CMD_DIST);
    const { workers, workerGroups } = buildAllTypePool();

    for (const queenType of Object.keys(QUEEN_SENTINELS)) {
      const prompt = mod.generateHiveMindPrompt(
        'swarm-t8',
        'T8 Probe',
        'Cross-ref',
        workers,
        workerGroups,
        { queenType },
      );

      const sentinel = QUEEN_SENTINELS[queenType];
      // Must appear at least 8 times (once per per-type prose block).
      const occurrences = prompt.split(sentinel).length - 1;
      assert.ok(
        occurrences >= 8,
        `${queenType} prompt must embed sentinel "${sentinel}" in each of 8 blocks; found ${occurrences} occurrences`,
      );

      // Wrong-type sentinels must NOT appear inside any prose block — the
      // queen's own self-check section already carries them in only one
      // variant per spawn. We test the per-block prohibition by scanning
      // each ## Worker role block.
      const wrongSentinels = Object.entries(QUEEN_SENTINELS)
        .filter(([k]) => k !== queenType)
        .map(([, v]) => v);

      for (const t of USERGUIDE_WORKER_TYPES) {
        const roleIdx = prompt.indexOf(`## Worker role: ${t}`);
        const nextRoleIdx = prompt.indexOf('## Worker role:', roleIdx + 1);
        const blockEnd = nextRoleIdx === -1 ? prompt.length : nextRoleIdx;
        const block = prompt.slice(roleIdx, blockEnd);
        for (const ws of wrongSentinels) {
          assert.ok(
            !block.includes(ws),
            `${queenType} ${t} block leaked wrong-type sentinel "${ws}"`,
          );
        }
      }
    }
  });

  it('non-USERGUIDE types in the pool surface in count summary but emit no prose block', { skip: SKIP_REASON }, async () => {
    const mod = await import(HIVE_CMD_DIST);
    // Pool: 1 researcher (USERGUIDE) + 1 specialist (non-USERGUIDE).
    const workers = [
      { agentId: 'a1', role: 'specialist', type: 'specialist' },
      { agentId: 'a2', role: 'researcher', type: 'researcher' },
    ];
    const workerGroups = {
      specialist: [workers[0]],
      researcher: [workers[1]],
    };
    const prompt = mod.generateHiveMindPrompt(
      'swarm-t8',
      'T8 Mixed',
      'Mixed pool',
      workers,
      workerGroups,
      { queenType: 'strategic' },
    );

    assert.ok(
      prompt.includes('## Worker role: researcher'),
      'researcher should get a prose block',
    );
    // specialist appears in the WORKER DISTRIBUTION count summary…
    assert.ok(
      prompt.includes('• specialist: 1 agents'),
      'specialist should appear in the WORKER DISTRIBUTION count summary',
    );
    // …but NOT as a prose role block.
    assert.ok(
      !prompt.includes('## Worker role: specialist'),
      'specialist must NOT receive a prose block (non-USERGUIDE type)',
    );
  });

  it('worker types absent from the pool emit no block', { skip: SKIP_REASON }, async () => {
    const mod = await import(HIVE_CMD_DIST);
    const workers = [{ agentId: 'a1', role: 'researcher', type: 'researcher' }];
    const workerGroups = { researcher: [workers[0]] };
    const prompt = mod.generateHiveMindPrompt(
      'swarm-t8',
      'T8 Tiny',
      'Tiny pool',
      workers,
      workerGroups,
      { queenType: 'strategic' },
    );

    assert.ok(prompt.includes('## Worker role: researcher'), 'researcher block missing');
    for (const t of USERGUIDE_WORKER_TYPES) {
      if (t === 'researcher') continue;
      assert.ok(
        !prompt.includes(`## Worker role: ${t}`),
        `${t} block leaked into a pool that does not contain ${t}`,
      );
    }
  });
});

// ── 3. Static contract: queen-coordinator.ts source-side empty-pool throw ──

describe('ADR-0126 §Specification — calculateCapabilityScore empty-pool throw (source-side contract)', () => {
  const QC_SOURCE = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/swarm/src/queen-coordinator.ts';

  it('source carries the exact "No agent of matching type" error string', () => {
    if (!existsSync(QC_SOURCE)) {
      // Skip when running outside a checkout that includes the fork.
      return;
    }
    const src = readFileSync(QC_SOURCE, 'utf8');
    assert.match(
      src,
      /No agent of matching type for task\.type=/,
      'queen-coordinator.ts must throw on empty-pool per ADR-0126 §Specification',
    );
  });

  it('source no longer carries the silent `score = 0.5` baseline as the FIRST statement of calculateCapabilityScore', () => {
    if (!existsSync(QC_SOURCE)) return;
    const src = readFileSync(QC_SOURCE, 'utf8');
    // The empty-pool guard must be reached BEFORE `let score = 0.5`. Find
    // the function declaration and confirm the throw appears before the
    // baseline assignment.
    const fnIdx = src.indexOf('private calculateCapabilityScore(');
    assert.ok(fnIdx > 0, 'calculateCapabilityScore function declaration not found');
    // Find the next `}` at the function's closing brace — bounded scan.
    // Cheap heuristic: grab 3000 chars after the function start; the
    // function body fits within that.
    const fnBody = src.slice(fnIdx, fnIdx + 5000);
    const throwIdx = fnBody.indexOf('No agent of matching type');
    const baselineIdx = fnBody.indexOf('let score = 0.5');
    assert.ok(throwIdx > 0, 'empty-pool throw missing from calculateCapabilityScore body');
    assert.ok(baselineIdx > 0, 'baseline `let score = 0.5` missing — test stale?');
    assert.ok(
      throwIdx < baselineIdx,
      `empty-pool throw must precede baseline (per ADR-0126 §Pseudocode); throw at ${throwIdx}, baseline at ${baselineIdx}`,
    );
  });

  it('typeMatches covers all 8 USERGUIDE worker types', () => {
    if (!existsSync(QC_SOURCE)) return;
    const src = readFileSync(QC_SOURCE, 'utf8');
    // Locate the typeMatches table and slice to the closing brace.
    const tmIdx = src.indexOf('const typeMatches: Record<TaskType, AgentType[]>');
    assert.ok(tmIdx > 0, 'typeMatches table not found in calculateCapabilityScore');
    const tmEnd = src.indexOf('};', tmIdx);
    const table = src.slice(tmIdx, tmEnd);
    for (const t of USERGUIDE_WORKER_TYPES) {
      assert.ok(
        table.includes(`'${t}'`),
        `typeMatches missing '${t}' on right-hand side — ${t} unreachable per ADR-0126 §Specification`,
      );
    }
  });

  it('capability-score nudges cover all 8 USERGUIDE worker types', () => {
    if (!existsSync(QC_SOURCE)) return;
    const src = readFileSync(QC_SOURCE, 'utf8');
    const fnIdx = src.indexOf('private calculateCapabilityScore(');
    const fnBody = src.slice(fnIdx, fnIdx + 5000);

    // Each USERGUIDE worker type must have at least one nudge that fires
    // on its matching task.type literal. The pre-T8 4 nudges
    // (coding/review/testing/coordination) cover coder/reviewer/tester
    // (+ coordinator). T8 adds 4 more covering the remaining types.
    //
    // We assert:
    //   - existing 4: caps.codeGeneration, caps.codeReview, caps.testing, caps.coordination
    //   - T8 4: caps.research, caps.analysis, caps.documentation, agent.type === 'architect',
    //           agent.type === 'optimizer'
    const requiredNudges = [
      'caps.codeGeneration', // coder
      'caps.codeReview',     // reviewer
      'caps.testing',        // tester
      'caps.research',       // researcher (T8)
      'caps.analysis',       // analyst (T8)
      'caps.documentation',  // documenter (T8)
      "agent.type === 'architect'", // architect via co-placement (T8)
      "agent.type === 'optimizer'", // optimizer via co-placement (T8)
    ];
    for (const nudge of requiredNudges) {
      assert.ok(
        fnBody.includes(nudge),
        `calculateCapabilityScore missing nudge "${nudge}" — coverage hole for ADR-0126`,
      );
    }
  });
});
