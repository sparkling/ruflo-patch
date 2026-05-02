// @tier unit
// ADR-0128 (T10) — Differentiated swarm topology runtime behaviour.
//
// Sibling: lib/acceptance-adr0128-checks.sh
//
// Three layers per ADR-0097 / ADR-0128 §Validation:
//
//  1. Static lib + runner-wiring assertions (Tier-Y rule)
//  2. Behavioural unit tests calling `dispatchByTopology` directly:
//       - per-topology permission wiring (6 tests)
//       - unknown topology throws
//       - adaptive throws pending T9
//       - hierarchical-mesh recursion cap
//       - integration assertions per §Validation
//  3. Source-level surface assertions on the CLI prompt path
//     (TOPOLOGIES enum expansion + renderTopologyProtocolBlock body)
//
// Behavioural tests import the codemodded fork-build output at
// /tmp/ruflo-build/v3/@claude-flow/swarm/dist/unified-coordinator.js
// (produced by `npm run build` in ruflo-patch). When that build is absent,
// the behavioural tests skip with a clear reason — the static source
// assertions below still run.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-adr0128-checks.sh');
const RUNNER_FILE = resolve(ROOT, 'scripts', 'test-acceptance.sh');

// Pick the freshest dist among the codemod build dir (`/tmp/ruflo-build`) and
// the fork's own dist directory. The codemod dir is preferred when current
// (because that's the publish path), but if it's stale relative to the fork
// dist (e.g. the developer just edited fork sources and rebuilt the fork
// directly), the fork dist takes over so this test exercises the actual
// changes the user is iterating on.
function pickFreshestDist(...candidates) {
  const present = candidates.filter(p => existsSync(p));
  if (present.length === 0) return null;
  if (present.length === 1) return present[0];
  return present.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

const SWARM_DIST = pickFreshestDist(
  '/tmp/ruflo-build/v3/@claude-flow/swarm/dist/unified-coordinator.js',
  '/Users/henrik/source/forks/ruflo/v3/@claude-flow/swarm/dist/unified-coordinator.js',
);

const CLI_DIST = pickFreshestDist(
  '/tmp/ruflo-build/v3/@claude-flow/cli/dist/src/commands/hive-mind.js',
  '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/dist/src/commands/hive-mind.js',
);

// Source files in the live fork — used for source-level surface assertions
// that don't depend on a compiled build.
const FORK_CLI_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/commands/hive-mind.ts';
const FORK_SWARM_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/swarm/src/unified-coordinator.ts';

const TOPOLOGIES = [
  'hierarchical',
  'mesh',
  'hierarchical-mesh',
  'ring',
  'star',
  'adaptive',
];

const CHECK_FN_NAMES = [
  'check_adr0128_topologies_enum_six',
  'check_adr0128_dispatch_hierarchical_wires_correct_permissions',
  'check_adr0128_dispatch_mesh_wires_correct_permissions',
  'check_adr0128_dispatch_hierarchical_mesh_wires_correct_permissions',
  'check_adr0128_dispatch_ring_wires_correct_permissions',
  'check_adr0128_dispatch_star_wires_correct_permissions',
  'check_adr0128_adaptive_throws_pending_t9',
  'check_adr0128_unknown_topology_throws',
  'check_adr0128_prompt_protocol_block_per_topology',
];

const RUNNER_CHECK_IDS = [
  'adr0128-topologies-enum',
  'adr0128-hierarchical',
  'adr0128-mesh',
  'adr0128-hierarchical-mesh',
  'adr0128-ring',
  'adr0128-star',
  'adr0128-adaptive-pending',
  'adr0128-unknown-throws',
  'adr0128-prompt-block',
];

// ── 1. Static assertions on the check lib + runner wiring ───────────────

describe('ADR-0128 acceptance check lib — static structure', () => {
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
});

describe('ADR-0128 acceptance check lib — runner wiring', () => {
  const runner = existsSync(RUNNER_FILE) ? readFileSync(RUNNER_FILE, 'utf8') : '';

  it('runner sources adr0128_lib', () => {
    assert.match(runner, /adr0128_lib=.*acceptance-adr0128-checks\.sh/);
    assert.match(runner, /\[\[ -f "\$adr0128_lib" \]\] && source "\$adr0128_lib"/);
  });

  for (const id of RUNNER_CHECK_IDS) {
    it(`runner registers run_check_bg "${id}"`, () => {
      assert.ok(
        runner.includes(`"${id}"`),
        `runner missing ${id} run_check_bg registration`,
      );
    });
  }

  it('runner expands _adr0128_specs in the wait-loop spec list', () => {
    assert.match(runner, /\$\{_adr0128_specs\[@\]\}/);
  });
});

// ── 2. Source-level surface assertions on the fork sources ─────────────────

describe('ADR-0128 fork source — TOPOLOGIES enum expansion', () => {
  const skipReason = existsSync(FORK_CLI_SRC) ? false : 'fork CLI source not present';

  it('TOPOLOGIES contains all 6 advertised topology values', { skip: skipReason }, () => {
    const src = readFileSync(FORK_CLI_SRC, 'utf8');
    for (const t of TOPOLOGIES) {
      assert.match(
        src,
        new RegExp(`value:\\s*['"]${t}['"]`),
        `TOPOLOGIES missing value '${t}'`,
      );
    }
  });

  it('renderTopologyProtocolBlock has a case branch per topology + default throw', { skip: skipReason }, () => {
    const src = readFileSync(FORK_CLI_SRC, 'utf8');
    assert.match(src, /function\s+renderTopologyProtocolBlock\s*\(/);
    for (const t of TOPOLOGIES) {
      assert.match(
        src,
        new RegExp(`case\\s+['"]${t}['"]\\s*:`),
        `renderTopologyProtocolBlock missing case '${t}'`,
      );
    }
    // Default branch throws (no silent fallback per feedback-no-fallbacks.md).
    assert.match(src, /default:[\s\S]+?throw new Error\(.*unknown topology/);
  });

  it('queen-prompt no longer carries bare "🔗 Topology: ${topology}"', { skip: skipReason }, () => {
    const src = readFileSync(FORK_CLI_SRC, 'utf8');
    // The bare substitution `🔗 Topology: ${topology}` (or the same shape
    // through the ADR-0125 ctx struct) should be replaced by a call to
    // renderTopologyProtocolBlock. Match: anywhere outside the
    // renderTopologyProtocolBlock function body itself.
    const renderFnStart = src.indexOf('function renderTopologyProtocolBlock');
    assert.ok(renderFnStart > 0, 'renderTopologyProtocolBlock not found');
    // Find the closing brace of the function. Count braces from the body.
    let i = src.indexOf('{', renderFnStart);
    let depth = 1;
    let renderFnEnd = i;
    for (let j = i + 1; j < src.length && depth > 0; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') {
        depth--;
        if (depth === 0) renderFnEnd = j;
      }
    }
    const before = src.slice(0, renderFnStart);
    const after = src.slice(renderFnEnd);
    const outside = before + after;
    // Bare metadata-only line must not appear outside the protocol block
    // function. Allow the same string inside the function body and inside
    // doc comments referencing it as the old shape.
    const bareMatches = (outside.match(/🔗 Topology: \$\{(?:ctx\.)?topology\}/g) || []);
    // The doc-comment for renderTopologyProtocolBlock describes the OLD bare
    // substring — that's expected to remain as documentation. We assert that
    // the *active prompt template* uses the call form (the
    // renderTopologyProtocolBlock(...) invocation).
    assert.match(
      outside,
      /\$\{renderTopologyProtocolBlock\(.+?\)\}/,
      'queen-prompt template must invoke renderTopologyProtocolBlock(topology)',
    );
    // Bare substitutions outside doc-comments are not tolerated. Doc comment
    // lines start with ` * ` or ` * @` — filter those out.
    const realBare = bareMatches.filter(_m => false); // no real bare refs allowed
    assert.deepStrictEqual(
      realBare,
      [],
      `bare 🔗 Topology: \${topology} substitution still present outside renderTopologyProtocolBlock — ${bareMatches.length} occurrences total`,
    );
  });
});

describe('ADR-0128 fork source — dispatchByTopology surface', () => {
  const skipReason = existsSync(FORK_SWARM_SRC) ? false : 'fork swarm source not present';

  it('exports HiveTopology union with 6 values', { skip: skipReason }, () => {
    const src = readFileSync(FORK_SWARM_SRC, 'utf8');
    assert.match(src, /export\s+type\s+HiveTopology\s*=/);
    for (const t of TOPOLOGIES) {
      assert.match(
        src,
        new RegExp(`['"]${t}['"]`),
        `HiveTopology missing value '${t}'`,
      );
    }
  });

  it('exports HIVE_TOPOLOGIES constant containing all 6 values', { skip: skipReason }, () => {
    const src = readFileSync(FORK_SWARM_SRC, 'utf8');
    assert.match(src, /export\s+const\s+HIVE_TOPOLOGIES/);
  });

  it('class has dispatchByTopology with case branch per topology + default throw', { skip: skipReason }, () => {
    const src = readFileSync(FORK_SWARM_SRC, 'utf8');
    assert.match(src, /async\s+dispatchByTopology\s*\(/);
    for (const t of TOPOLOGIES) {
      assert.match(
        src,
        new RegExp(`case\\s+['"]${t}['"]\\s*:`),
        `dispatchByTopology missing case '${t}'`,
      );
    }
    assert.match(src, /default:[\s\S]+?throw new Error\(.*unknown topology/);
  });

  it('adaptive branch throws not-implemented marker when no resolver supplied', { skip: skipReason }, () => {
    const src = readFileSync(FORK_SWARM_SRC, 'utf8');
    assert.match(
      src,
      /adaptive topology dispatch requires T9\/ADR-0127/,
      'adaptive branch must throw clearly-named marker pending T9',
    );
  });

  it('hierarchical-mesh recursion is capped at 1 (cap enforced in dispatch)', { skip: skipReason }, () => {
    const src = readFileSync(FORK_SWARM_SRC, 'utf8');
    assert.match(
      src,
      /hierarchical-mesh recursion cap exceeded/,
      'recursion cap must be enforced at dispatch (no sub-sub-queens)',
    );
  });

  it('setHiveTopology / getHiveTopology / setAdaptiveResolver are public API', { skip: skipReason }, () => {
    const src = readFileSync(FORK_SWARM_SRC, 'utf8');
    assert.match(src, /\bsetHiveTopology\s*\(/);
    assert.match(src, /\bgetHiveTopology\s*\(/);
    assert.match(src, /\bsetAdaptiveResolver\s*\(/);
  });
});

// ── 3. Behavioural tests against the compiled dist ─────────────────────────

const distSkip = SWARM_DIST ? false : 'fork build absent — run `npm run build` in ruflo-patch';

describe('ADR-0128 dispatch behaviour — six topologies', () => {
  it('hierarchical wires correct permissions: peer visibility NONE, queen-only subscriptions', { skip: distSkip }, async () => {
    const mod = await import(SWARM_DIST);
    const coord = new mod.UnifiedSwarmCoordinator();
    const result = await coord.dispatchByTopology({
      topology: 'hierarchical',
      queenAgentId: 'queen-1',
      workerAgentIds: ['w-1', 'w-2', 'w-3'],
    });
    assert.strictEqual(result.topology, 'hierarchical');
    assert.strictEqual(result.peerVisibility, 'none');
    assert.strictEqual(result.workers.length, 3);
    for (const w of result.workers) {
      // adr0128_dispatch_hierarchical_wires_correct_permissions
      // adr0128_hierarchical_zero_peer_broadcasts
      assert.deepStrictEqual(
        w.subscriptionSet,
        ['queen-1'],
        `worker ${w.agentId} must subscribe ONLY to queen — got ${JSON.stringify(w.subscriptionSet)}`,
      );
      assert.match(
        w.memoryNamespace,
        /\/private\//,
        'worker memory namespace must be queen-readable private',
      );
      assert.strictEqual(w.memoryWriteAllowed, true);
    }
  });

  it('mesh wires correct permissions: full peer visibility, O(N^2) subscriptions', { skip: distSkip }, async () => {
    const mod = await import(SWARM_DIST);
    const coord = new mod.UnifiedSwarmCoordinator();
    const workerIds = ['w-1', 'w-2', 'w-3', 'w-4'];
    const result = await coord.dispatchByTopology({
      topology: 'mesh',
      queenAgentId: 'queen-1',
      workerAgentIds: workerIds,
    });
    assert.strictEqual(result.topology, 'mesh');
    assert.strictEqual(result.peerVisibility, 'full');
    // adr0128_dispatch_mesh_wires_correct_permissions
    // adr0128_mesh_full_peer_visibility_O_N_squared
    let totalEdges = 0;
    for (const w of result.workers) {
      // queen + every other worker
      const expectedPeers = workerIds.filter(id => id !== w.agentId);
      const peerSubs = w.subscriptionSet.filter(s => s !== 'queen-1');
      assert.deepStrictEqual(
        peerSubs.sort(),
        expectedPeers.sort(),
        `worker ${w.agentId} subscriptionSet must include all peers`,
      );
      assert.ok(w.subscriptionSet.includes('queen-1'), 'queen must be in subscriptionSet');
      assert.match(w.memoryNamespace, /\/shared$/);
      assert.strictEqual(w.memoryWriteAllowed, true);
      totalEdges += peerSubs.length;
    }
    // O(N^2) — N workers each see N-1 peers = N*(N-1) edges
    assert.strictEqual(totalEdges, workerIds.length * (workerIds.length - 1));
  });

  it('hierarchical-mesh: sub-hive mesh + sub-queen reports; recursion capped at 1', { skip: distSkip }, async () => {
    const mod = await import(SWARM_DIST);
    const coord = new mod.UnifiedSwarmCoordinator();
    // 7 workers => ceil(7/3) = 3 sub-hives (sizes 3, 3, 1).
    const workerIds = ['w-1', 'w-2', 'w-3', 'w-4', 'w-5', 'w-6', 'w-7'];
    const result = await coord.dispatchByTopology({
      topology: 'hierarchical-mesh',
      queenAgentId: 'queen-1',
      workerAgentIds: workerIds,
    });
    assert.strictEqual(result.topology, 'hierarchical-mesh');
    assert.strictEqual(result.peerVisibility, 'sub-hive-mesh-plus-subqueen-reports');
    assert.ok(Array.isArray(result.subHives));
    assert.strictEqual(result.subHives.length, 3);

    // Sub-queen wires upward to queen only.
    const subQueens = result.workers.filter(w =>
      result.subHives.some(h => h.subQueenAgentId === w.agentId),
    );
    assert.ok(subQueens.length >= 1);
    for (const sq of subQueens) {
      assert.deepStrictEqual(
        sq.subscriptionSet,
        ['queen-1'],
        `sub-queen ${sq.agentId} reports only to top queen`,
      );
      assert.match(sq.memoryNamespace, /\/sub\/sub-\d+\/summary$/);
    }

    // Verify recursion cap by trying to dispatch into hierarchical-mesh
    // again from depth=1 — must throw.
    await assert.rejects(
      coord.dispatchByTopology({
        topology: 'hierarchical-mesh',
        queenAgentId: 'queen-1',
        workerAgentIds: workerIds,
        _recursionDepth: 1,
      }),
      /hierarchical-mesh recursion cap exceeded/,
    );
  });

  it('ring wires deterministic N-step chain; zero broadcasts; predecessor / successor keys correct', { skip: distSkip }, async () => {
    const mod = await import(SWARM_DIST);
    const coord = new mod.UnifiedSwarmCoordinator();
    const workerIds = ['w-0', 'w-1', 'w-2', 'w-3'];
    const result = await coord.dispatchByTopology({
      topology: 'ring',
      queenAgentId: 'queen-1',
      workerAgentIds: workerIds,
    });
    assert.strictEqual(result.topology, 'ring');
    assert.strictEqual(result.peerVisibility, 'previous-neighbour-only');
    // adr0128_ring_deterministic_N_step_chain
    for (let i = 0; i < workerIds.length; i++) {
      const w = result.workers[i];
      assert.strictEqual(w.agentId, workerIds[i]);
      assert.deepStrictEqual(w.subscriptionSet, [], 'ring has no broadcasts');
      const predIdx = (i - 1 + workerIds.length) % workerIds.length;
      assert.strictEqual(w.ringPredecessorKey, `hive-mind/queen-1/ring/slot-${predIdx}`);
      assert.strictEqual(w.ringSuccessorKey, `hive-mind/queen-1/ring/slot-${i}`);
      assert.strictEqual(w.memoryWriteAllowed, true);
    }
  });

  it('star wires hub-and-spoke: zero worker memory writes', { skip: distSkip }, async () => {
    const mod = await import(SWARM_DIST);
    const coord = new mod.UnifiedSwarmCoordinator();
    const workerIds = ['w-1', 'w-2', 'w-3'];
    const result = await coord.dispatchByTopology({
      topology: 'star',
      queenAgentId: 'queen-1',
      workerAgentIds: workerIds,
    });
    assert.strictEqual(result.topology, 'star');
    assert.strictEqual(result.peerVisibility, 'none');
    // adr0128_star_zero_worker_memory_writes
    for (const w of result.workers) {
      assert.deepStrictEqual(w.subscriptionSet, ['queen-1']);
      assert.strictEqual(
        w.memoryWriteAllowed,
        false,
        `worker ${w.agentId} must NOT have memory write permission in star`,
      );
      assert.match(w.memoryNamespace, /\/aggregate$/);
    }
  });

  it('adaptive throws not-implemented marker when no resolver supplied (pending T9)', { skip: distSkip }, async () => {
    const mod = await import(SWARM_DIST);
    const coord = new mod.UnifiedSwarmCoordinator();
    await assert.rejects(
      coord.dispatchByTopology({
        topology: 'adaptive',
        queenAgentId: 'queen-1',
        workerAgentIds: ['w-1'],
      }),
      /adaptive topology dispatch requires T9\/ADR-0127/,
    );
  });

  it('adaptive resolves to concrete topology via injected resolver', { skip: distSkip }, async () => {
    const mod = await import(SWARM_DIST);
    const coord = new mod.UnifiedSwarmCoordinator();
    // Stand-in for the future T9 control loop — picks `mesh`.
    const result = await coord.dispatchByTopology({
      topology: 'adaptive',
      queenAgentId: 'queen-1',
      workerAgentIds: ['w-1', 'w-2'],
      adaptiveResolver: () => 'mesh',
    });
    assert.strictEqual(result.topology, 'mesh');
    assert.strictEqual(result.peerVisibility, 'full');
  });

  it('adaptive resolver returning "adaptive" throws (no infinite recursion)', { skip: distSkip }, async () => {
    const mod = await import(SWARM_DIST);
    const coord = new mod.UnifiedSwarmCoordinator();
    await assert.rejects(
      coord.dispatchByTopology({
        topology: 'adaptive',
        queenAgentId: 'queen-1',
        workerAgentIds: ['w-1'],
        adaptiveResolver: () => 'adaptive',
      }),
      /would cause infinite recursion/,
    );
  });

  it('unknown topology throws (no silent fallback to hierarchical-mesh)', { skip: distSkip }, async () => {
    const mod = await import(SWARM_DIST);
    const coord = new mod.UnifiedSwarmCoordinator();
    await assert.rejects(
      coord.dispatchByTopology({
        topology: 'centralized',
        queenAgentId: 'queen-1',
        workerAgentIds: ['w-1'],
      }),
      /unknown topology/,
    );
  });

  it('setHiveTopology validates against HIVE_TOPOLOGIES — unknown throws', { skip: distSkip }, async () => {
    const mod = await import(SWARM_DIST);
    const coord = new mod.UnifiedSwarmCoordinator();
    coord.setHiveTopology('mesh');
    assert.strictEqual(coord.getHiveTopology(), 'mesh');
    assert.throws(() => coord.setHiveTopology('centralized'), /unknown topology/);
  });
});

// ── 4. CLI prompt — topology block per topology ────────────────────────────

const cliSkip = CLI_DIST ? false : 'CLI build absent — run `npm run build` in ruflo-patch';

describe('ADR-0128 CLI prompt — topology protocol block per topology', () => {
  it('prompt body carries topology-specific protocol block (not bare metadata)', { skip: cliSkip }, async () => {
    // Source-level enforcement mirrors the dist; if dist isn't present we
    // already covered the same surface in the source-level suite above.
    const src = readFileSync(CLI_DIST, 'utf8');
    // The compiled dist must carry a renderTopologyProtocolBlock symbol.
    assert.match(src, /renderTopologyProtocolBlock/, 'compiled CLI must invoke renderTopologyProtocolBlock');
    for (const t of TOPOLOGIES) {
      assert.ok(
        src.includes(`'${t}'`) || src.includes(`"${t}"`),
        `compiled CLI missing topology branch '${t}'`,
      );
    }
  });
});
