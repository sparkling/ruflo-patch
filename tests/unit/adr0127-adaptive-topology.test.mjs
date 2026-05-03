// @tier unit
// ADR-0127 (T9) — Hive-mind adaptive topology autoscaling.
//
// Sibling: lib/acceptance-adr0127-adaptive.sh (NOT wired into
// scripts/test-acceptance.sh per ADR-0118 task-T9 handoff prompt — the
// orchestrator decides if/when to wire it in).
//
// Three layers per ADR-0097 / ADR-0127 §Validation:
//
//  1. Source-level surface assertions on the fork sources:
//     - HealthReport interface carries the new T9 fields
//     - monitorSwarmHealth populates partitionDetected from heartbeat
//       asymmetry (NOT the Wave 1 stub default `false`)
//     - adaptive-loop.ts module exists with the expected exports
//
//  2. Behavioural unit tests calling AdaptiveLoop directly via the
//     codemodded fork-build output. When the build is absent the
//     behavioural tests skip with a clear reason — the source-level
//     assertions still run.
//
//  3. Integration assertions for the dampening/settle/flip-rate
//     invariants — exactly one action on sustained breach, zero actions
//     on flap, halt-loud on adversarial input, suspended on partition.
//
// Per CLAUDE.md "feedback-no-fallbacks.md": every assertion must FAIL
// when the feature is broken. No "loop runs OK" passes that fall through
// when the loop never ticks.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const CHECK_FILE = resolve(ROOT, 'lib', 'acceptance-adr0127-adaptive.sh');

// Pick the freshest dist among the codemod build dir (`/tmp/ruflo-build`) and
// the fork's own dist directory.
function pickFreshestDist(...candidates) {
  const present = candidates.filter(p => existsSync(p));
  if (present.length === 0) return null;
  if (present.length === 1) return present[0];
  return present.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

const ADAPTIVE_LOOP_DIST = pickFreshestDist(
  '/tmp/ruflo-build/v3/@claude-flow/swarm/dist/adaptive-loop.js',
  '/Users/henrik/source/forks/ruflo/v3/@claude-flow/swarm/dist/adaptive-loop.js',
);

const QUEEN_COORD_DIST = pickFreshestDist(
  '/tmp/ruflo-build/v3/@claude-flow/swarm/dist/queen-coordinator.js',
  '/Users/henrik/source/forks/ruflo/v3/@claude-flow/swarm/dist/queen-coordinator.js',
);

// Source files in the live fork.
const FORK_QUEEN_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/swarm/src/queen-coordinator.ts';
const FORK_LOOP_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/swarm/src/adaptive-loop.ts';
const FORK_UNIFIED_SRC = '/Users/henrik/source/forks/ruflo/v3/@claude-flow/swarm/src/unified-coordinator.ts';

const NEW_HEALTH_FIELDS = [
  'queueDepthP50',
  'queueDepthP90',
  'queueDepthP99',
  'idleWorkerCount',
  'loadCoV',
  'breachedThreshold',
  'breachDurationMs',
  'pollTimestamp',
  'flipsInWindow',
];

const ADAPTIVE_LOOP_EXPORTS = [
  'AdaptiveLoop',
  'createAdaptiveLoop',
  'computeQueuePercentiles',
  'computeLoadCoV',
  'computeIdleWorkerCount',
  'detectPartitionFromHeartbeats',
  'pickMostBackloggedDomain',
  'pickLongestIdleWorker',
  'ADAPTIVE_LOOP_DEFAULTS',
];

// ── 1. Source-level assertions ─────────────────────────────────────────────

describe('ADR-0127 fork source — HealthReport extension', () => {
  const skipReason = existsSync(FORK_QUEEN_SRC) ? false : 'fork queen-coordinator source not present';

  it('HealthReport interface carries all 9 new T9 fields', { skip: skipReason }, () => {
    const src = readFileSync(FORK_QUEEN_SRC, 'utf8');
    const ifaceStart = src.indexOf('export interface HealthReport {');
    assert.ok(ifaceStart >= 0, 'expected `export interface HealthReport {`');
    const ifaceEnd = src.indexOf('\n}', ifaceStart);
    const body = src.slice(ifaceStart, ifaceEnd);
    for (const field of NEW_HEALTH_FIELDS) {
      assert.match(
        body,
        new RegExp(`\\b${field}\\s*:`),
        `HealthReport missing T9 field '${field}'`,
      );
    }
  });

  it('partitionDetected remains required (not optional)', { skip: skipReason }, () => {
    const src = readFileSync(FORK_QUEEN_SRC, 'utf8');
    const ifaceStart = src.indexOf('export interface HealthReport {');
    const ifaceEnd = src.indexOf('\n}', ifaceStart);
    const body = src.slice(ifaceStart, ifaceEnd);
    assert.match(body, /\bpartitionDetected\s*:\s*boolean\s*;/);
    assert.doesNotMatch(body, /\bpartitionDetected\?\s*:/);
  });

  it('monitorSwarmHealth populates partitionDetected via detectPartitionFromHeartbeats (NOT the Wave 1 `false` stub)', { skip: skipReason }, () => {
    const src = readFileSync(FORK_QUEEN_SRC, 'utf8');
    // The Wave 1 stub assigned `partitionDetected: false` literally; we
    // want the production path to call detectPartitionFromHeartbeats.
    assert.match(
      src,
      /detectPartitionFromHeartbeats\s*\(/,
      'monitorSwarmHealth must call detectPartitionFromHeartbeats from adaptive-loop.ts',
    );
    // The literal `partitionDetected: false` may still appear in fault
    // paths (e.g. when corrupt heartbeats throw); that's acceptable per
    // the implementation. What MUST be absent is the unconditional
    // `partitionDetected: false` in the main HealthReport ctor — verify
    // by checking the ctor uses the variable, not the literal.
    const ctorIdx = src.indexOf('const report: HealthReport = {');
    assert.ok(ctorIdx >= 0);
    const ctorEnd = src.indexOf('};', ctorIdx);
    const ctor = src.slice(ctorIdx, ctorEnd);
    assert.match(
      ctor,
      /partitionDetected,/,
      'HealthReport ctor must reference the computed `partitionDetected` variable, not a literal',
    );
  });

  it('monitorSwarmHealth populates new T9 fields in the HealthReport ctor', { skip: skipReason }, () => {
    const src = readFileSync(FORK_QUEEN_SRC, 'utf8');
    const ctorIdx = src.indexOf('const report: HealthReport = {');
    assert.ok(ctorIdx >= 0);
    const ctorEnd = src.indexOf('};', ctorIdx);
    const ctor = src.slice(ctorIdx, ctorEnd);
    for (const field of NEW_HEALTH_FIELDS) {
      assert.match(
        ctor,
        new RegExp(`\\b${field}\\b`),
        `HealthReport ctor missing T9 field '${field}'`,
      );
    }
  });
});

describe('ADR-0127 fork source — adaptive-loop.ts module', () => {
  const skipReason = existsSync(FORK_LOOP_SRC) ? false : 'fork adaptive-loop.ts source not present';

  it('module file exists', () => {
    assert.ok(existsSync(FORK_LOOP_SRC), `expected ${FORK_LOOP_SRC}`);
  });

  it('exports the documented surface', { skip: skipReason }, () => {
    const src = readFileSync(FORK_LOOP_SRC, 'utf8');
    for (const sym of ADAPTIVE_LOOP_EXPORTS) {
      assert.match(
        src,
        new RegExp(`export\\s+(?:class|function|const)\\s+${sym}\\b`),
        `adaptive-loop.ts missing export '${sym}'`,
      );
    }
  });

  it('declares the three preliminary safety controls', { skip: skipReason }, () => {
    const src = readFileSync(FORK_LOOP_SRC, 'utf8');
    // Dampening
    assert.match(src, /dampeningWindowMs/);
    // Settle window
    assert.match(src, /settleWindowMs/);
    // Flip-rate ceiling
    assert.match(src, /maxFlipsPerWindow/);
  });

  it('preliminary defaults match ADR-0127 §Specification', { skip: skipReason }, () => {
    const src = readFileSync(FORK_LOOP_SRC, 'utf8');
    // Pull the ADAPTIVE_LOOP_DEFAULTS object literal.
    const idx = src.indexOf('export const ADAPTIVE_LOOP_DEFAULTS');
    assert.ok(idx >= 0);
    const blockEnd = src.indexOf('} as const', idx);
    const block = src.slice(idx, blockEnd);
    assert.match(block, /pollIntervalMs:\s*5000\b/, 'preliminary poll = 5s');
    assert.match(block, /settleWindowMs:\s*30000\b/, 'preliminary settle = 30s');
    assert.match(block, /dampeningWindowMs:\s*30000\b/, 'preliminary dampening = 30s');
    assert.match(block, /highWaterQueueDepth:\s*3\b/);
    assert.match(block, /lowWaterQueueDepth:\s*0\b/);
    assert.match(block, /highCoV:\s*0\.6\b/);
    assert.match(block, /lowCoV:\s*0\.3\b/);
    assert.match(block, /perTypeMin:\s*1\b/);
    assert.match(block, /maxFlipsPerWindow:\s*4\b/);
  });

  it('AdaptiveLoop has resolveAdaptiveTopology exposed for T10 hand-off', { skip: skipReason }, () => {
    const src = readFileSync(FORK_LOOP_SRC, 'utf8');
    assert.match(src, /resolveAdaptiveTopology/);
  });

  it('halt-loud on every fault path — no silent fallback', { skip: skipReason }, () => {
    const src = readFileSync(FORK_LOOP_SRC, 'utf8');
    // Each FaultReason must surface via haltLoud or 'fault' emit.
    const reasons = [
      'queen-unreachable',
      'metric-poll-failure',
      'flip-rate-ceiling',
      'mutation-error',
      'topology-switch-abandoned',
      'partition-detected',
      'corrupt-metrics',
    ];
    for (const r of reasons) {
      assert.match(
        src,
        new RegExp(`['\"]${r}['\"]`),
        `fault reason '${r}' not represented in adaptive-loop.ts`,
      );
    }
  });
});

describe('ADR-0127 fork source — unified-coordinator setAdaptiveResolver hand-off', () => {
  const skipReason = existsSync(FORK_UNIFIED_SRC) ? false : 'fork unified-coordinator source not present';

  it('exports setAdaptiveResolver (the wire-in surface from ADR-0128 T10)', { skip: skipReason }, () => {
    const src = readFileSync(FORK_UNIFIED_SRC, 'utf8');
    assert.match(src, /\bsetAdaptiveResolver\s*\(/);
  });

  it('setHiveTopology rejects unknown values (T9 mutation surface)', { skip: skipReason }, () => {
    const src = readFileSync(FORK_UNIFIED_SRC, 'utf8');
    assert.match(src, /setHiveTopology\s*\(/);
    assert.match(src, /unknown topology:/);
  });

  it('adaptive branch in dispatch throws clearly when resolver absent (no silent fallback)', { skip: skipReason }, () => {
    const src = readFileSync(FORK_UNIFIED_SRC, 'utf8');
    assert.match(src, /adaptive topology dispatch requires T9\/ADR-0127/);
  });
});

// ── 2. Behavioural assertions against the compiled dist ───────────────────

const distSkip = ADAPTIVE_LOOP_DIST
  ? false
  : 'adaptive-loop dist absent — run `npm run build` in ruflo-patch';

describe('ADR-0127 behavioural — dampening predicate via real loop', () => {
  it('threshold crossing under dampening produces zero actions', { skip: distSkip }, async () => {
    const mod = await import(ADAPTIVE_LOOP_DIST);
    let now = 0;
    const calls = [];
    const swarm = mkSwarm([], [mkDomain('core', 5, 0, 10)]);
    const loop = mod.createAdaptiveLoop(
      swarm,
      {
        scaleUp: async (d) => calls.push({ kind: 'scaleUp', d }),
        scaleDown: async (a, d) => calls.push({ kind: 'scaleDown', a, d }),
        switchTopology: async (t) => { calls.push({ kind: 'switch', t }); return 'OK'; },
      },
      {
        pollIntervalMs: 1000,
        dampeningWindowMs: 5000,
        settleWindowMs: 5000,
        now: () => now,
      },
    );
    loop.start();
    for (let i = 0; i < 4; i++) {
      now += 1000;
      await loop.tickOnce();
    }
    assert.deepStrictEqual(calls, [], `expected 0 actions, got ${JSON.stringify(calls)}`);
    loop.stop();
  });

  it('sustained crossing produces exactly one action', { skip: distSkip }, async () => {
    const mod = await import(ADAPTIVE_LOOP_DIST);
    let now = 0;
    const calls = [];
    const swarm = mkSwarm([], [mkDomain('core', 5, 0, 10)]);
    const loop = mod.createAdaptiveLoop(
      swarm,
      {
        scaleUp: async (d) => calls.push({ kind: 'scaleUp', d }),
        scaleDown: async () => {},
        switchTopology: async () => 'OK',
      },
      {
        pollIntervalMs: 1000, dampeningWindowMs: 2000, settleWindowMs: 100000,
        now: () => now,
      },
    );
    loop.start();
    for (let i = 0; i < 6; i++) {
      now += 1000;
      await loop.tickOnce();
    }
    const upCount = calls.filter(c => c.kind === 'scaleUp').length;
    assert.strictEqual(upCount, 1, `expected exactly 1 scale-up, got ${upCount}`);
    loop.stop();
  });
});

describe('ADR-0127 behavioural — flip-rate circuit-breaker', () => {
  it('halts on adversarial flip-rate', { skip: distSkip }, async () => {
    const mod = await import(ADAPTIVE_LOOP_DIST);
    let now = 0;
    let queue = 10;
    const swarm = mkSwarm();
    swarm.getStatus = () => ({
      domains: [mkDomain('core', 5, 0, queue)],
      metrics: {},
    });
    const faults = [];
    const loop = mod.createAdaptiveLoop(
      swarm,
      {
        scaleUp: async () => {},
        scaleDown: async () => {},
        switchTopology: async () => 'OK',
      },
      {
        pollIntervalMs: 1000, dampeningWindowMs: 1000, settleWindowMs: 1000,
        maxFlipsPerWindow: 3, flipWindowMs: 60_000,
        now: () => now,
      },
    );
    loop.on('fault', f => faults.push(f));
    loop.start();
    for (let i = 0; i < 30; i++) {
      now += 1000;
      const phase = Math.floor(i / 4) % 2;
      queue = phase === 0 ? 10 : 0;
      await loop.tickOnce();
      if (loop.getState().status === 'halted') break;
    }
    assert.strictEqual(loop.getState().status, 'halted');
    assert.ok(
      faults.some(f => f.reason === 'flip-rate-ceiling'),
      `expected flip-rate-ceiling fault, got ${JSON.stringify(faults.map(f => f.reason))}`,
    );
    loop.stop();
  });
});

describe('ADR-0127 behavioural — partition asymmetric handling', () => {
  it('suspends scaling and emits partition fault when partitionDetected = true', { skip: distSkip }, async () => {
    const mod = await import(ADAPTIVE_LOOP_DIST);
    let now = 0;
    const calls = [];
    const swarm = mkSwarm(
      [mkAgent('a1', 'coder', 'idle')],
      [mkDomain('core', 5, 0, 10)],
    );
    swarm.getLastHealthReport = () => ({
      reportId: 'r1',
      timestamp: new Date(),
      overallHealth: 0,
      domainHealth: new Map(),
      agentHealth: [],
      bottlenecks: [],
      alerts: [],
      metrics: {},
      recommendations: [],
      partitionDetected: true,
      queueDepthP50: 0, queueDepthP90: 10, queueDepthP99: 10,
      idleWorkerCount: 1, loadCoV: 0, breachedThreshold: 'none',
      breachDurationMs: 0, pollTimestamp: now,
      flipsInWindow: { scale: 0, topology: 0 },
    });
    const faults = [];
    const loop = mod.createAdaptiveLoop(
      swarm,
      {
        scaleUp: async (d) => calls.push({ kind: 'scaleUp', d }),
        scaleDown: async () => {},
        switchTopology: async () => 'OK',
      },
      {
        pollIntervalMs: 1000, dampeningWindowMs: 1000, settleWindowMs: 1000,
        now: () => now,
      },
    );
    loop.on('fault', f => faults.push(f));
    loop.start();
    now += 1000;
    await loop.tickOnce();
    assert.strictEqual(loop.getState().status, 'suspended');
    assert.deepStrictEqual(calls, [], `expected zero scale calls during partition, got ${JSON.stringify(calls)}`);
    assert.ok(faults.some(f => f.reason === 'partition-detected'));
    loop.stop();
  });
});

describe('ADR-0127 behavioural — topology switch deferral surfaces fault, not silence', () => {
  it('switch deferred past bound emits topology-switch-abandoned fault', { skip: distSkip }, async () => {
    const mod = await import(ADAPTIVE_LOOP_DIST);
    let now = 0;
    const busy = mkAgent('a1', 'coder', 'busy', new Date(), true);
    const swarm = mkSwarm(
      [busy],
      [mkDomain('queen', 1, 1, 0), mkDomain('core', 5, 0, 0)],
    );
    const faults = [];
    const loop = mod.createAdaptiveLoop(
      swarm,
      {
        scaleUp: async () => {},
        scaleDown: async () => {},
        switchTopology: async () => 'OK',
      },
      {
        pollIntervalMs: 1000, dampeningWindowMs: 2000, settleWindowMs: 10000,
        topologyDeferralBoundWindows: 2,
        now: () => now,
      },
    );
    loop.on('fault', f => faults.push(f));
    loop.start();
    for (let i = 0; i < 8; i++) {
      now += 1000;
      await loop.tickOnce();
    }
    assert.ok(
      faults.some(f => f.reason === 'topology-switch-abandoned'),
      `expected topology-switch-abandoned fault, got ${JSON.stringify(faults.map(f => f.reason))}`,
    );
    loop.stop();
  });
});

describe('ADR-0127 behavioural — pre-T10 NOT_IMPLEMENTED contract honoured', () => {
  it('NOT_IMPLEMENTED return logs and continues, no halt', { skip: distSkip }, async () => {
    const mod = await import(ADAPTIVE_LOOP_DIST);
    let now = 0;
    const swarm = mkSwarm(
      [],
      [mkDomain('queen', 1, 1, 0), mkDomain('core', 5, 0, 0)],
    );
    const applied = [];
    const loop = mod.createAdaptiveLoop(
      swarm,
      {
        scaleUp: async () => {},
        scaleDown: async () => {},
        switchTopology: async () => 'NOT_IMPLEMENTED',
      },
      {
        pollIntervalMs: 1000, dampeningWindowMs: 2000, settleWindowMs: 10000,
        now: () => now,
      },
    );
    loop.on('action.applied', a => applied.push(a));
    loop.start();
    for (let i = 0; i < 4; i++) {
      now += 1000;
      await loop.tickOnce();
    }
    assert.ok(
      applied.some(a => a.result === 'NOT_IMPLEMENTED'),
      'pre-T10 NOT_IMPLEMENTED return must surface as action.applied with result',
    );
    assert.notStrictEqual(loop.getState().status, 'halted');
    loop.stop();
  });
});

// ── Behavioural assertion helpers (mirror the swarm-side test factories) ──

function mkAgent(id, type, status = 'idle', lastHeartbeat = new Date(), hasCurrentTask = false) {
  return {
    id: { id, swarmId: 'swarm', type, instance: 1 },
    name: `agent-${id}`,
    type,
    status,
    capabilities: {},
    metrics: {},
    workload: status === 'busy' ? 0.8 : 0,
    health: 1,
    lastHeartbeat,
    topologyRole: 'worker',
    connections: [],
    currentTask: hasCurrentTask
      ? { id: 't', swarmId: 'swarm', sequence: 1, priority: 'normal' }
      : undefined,
  };
}

function mkDomain(name, agentCount, busyAgents = 0, tasksQueued = 0) {
  return {
    name,
    agentCount,
    availableAgents: agentCount - busyAgents,
    busyAgents,
    tasksQueued,
    tasksCompleted: 0,
  };
}

function mkSwarm(agents = [], domains = []) {
  return {
    getAgentsByDomain: () => [],
    getAllAgents: () => agents,
    getAvailableAgents: () => agents.filter(a => a.status === 'idle'),
    getMetrics: () => ({}),
    getDomainConfigs: () => new Map(),
    getStatus: () => ({ domains, metrics: {} }),
    assignTaskToDomain: async () => 'a1',
    proposeConsensus: async () => ({}),
    broadcastMessage: async () => {},
  };
}

// ── 3. Acceptance script lib presence (sanity) ─────────────────────────────

describe('ADR-0127 acceptance script — lib presence (T9 sibling check)', () => {
  it('lib file exists at expected path', () => {
    assert.ok(
      existsSync(CHECK_FILE),
      `expected ${CHECK_FILE} (per ADR-0118 task-T9 prompt: NEW lib/acceptance-adr0127-adaptive.sh, NOT wired into scripts/test-acceptance.sh)`,
    );
  });
});
