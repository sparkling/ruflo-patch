// @tier unit
// ADR-0181 Item 6 — source-level wiring gate for SonaTrajectoryService
// SQLite persistence + sibling read handler.
//
// The behavioural tests for this wiring live in the agentdb fork's vitest
// suite (`forks/agentdb/test/archivist/handlers/agentdb/sona-trajectory-store.test.ts`
// — 13 tests covering dual-write durability, getStats merge, getPatterns
// merge, fail-loud SQL errors, capability throws, the cli adapter
// payload-shape round-trip). This `.mjs` test is a pipeline gate that
// survives a tsc refactor: it loads the FORK SOURCE files and asserts the
// wiring shape + critical comments are intact.
//
// Each assertion below ties to a b5-da revision verdict (a/b/c/d) so a
// future hand-edit that strips a load-bearing line surfaces as a named
// regression instead of a silent drift.

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const AGENTDB_FORK = '/Users/henrik/source/forks/agentdb';
const RUFLO_FORK = '/Users/henrik/source/forks/ruflo';

function read(p) {
  return readFileSync(p, 'utf8');
}

describe('ADR-0181 Item 6 — Sona persistence wiring (source-level)', () => {
  // ── Schema ───────────────────────────────────────────────────────────────

  it('schema.sql declares sona_trajectories table with expected columns', () => {
    const schema = read(`${AGENTDB_FORK}/src/schemas/schema.sql`);
    assert.match(schema, /CREATE TABLE IF NOT EXISTS sona_trajectories/, 'sona_trajectories table missing');
    assert.match(schema, /agent_type TEXT NOT NULL/, 'agent_type column missing');
    assert.match(schema, /steps JSON NOT NULL/, 'steps column missing');
    assert.match(schema, /reward REAL NOT NULL/, 'reward column missing');
    assert.match(schema, /idx_sona_traj_agent/, 'idx_sona_traj_agent index missing');
    assert.match(schema, /idx_sona_traj_created/, 'idx_sona_traj_created index missing');
    assert.match(schema, /idx_sona_traj_reward/, 'idx_sona_traj_reward index missing');
  });

  // ── SonaTrajectoryService — lazy resolver constructor ────────────────────

  it('SonaTrajectoryService accepts the {getDb} lazy resolver option', () => {
    const svc = read(`${AGENTDB_FORK}/src/services/SonaTrajectoryService.ts`);
    assert.match(svc, /export interface SonaTrajectoryServiceOptions/, 'options interface missing');
    assert.match(svc, /getDb\?:\s*\(\)\s*=>\s*any/, 'getDb resolver signature missing');
    assert.match(
      svc,
      /constructor\(opts:\s*SonaTrajectoryServiceOptions\s*=\s*\{\}\)/,
      'constructor signature with default {} missing — backward compat broken',
    );
    assert.match(svc, /private resolveDb\(\)/, 'resolveDb private helper missing');
  });

  it('SonaTrajectoryService.recordTrajectory dual-writes to SQLite when handle is present', () => {
    const svc = read(`${AGENTDB_FORK}/src/services/SonaTrajectoryService.ts`);
    assert.match(
      svc,
      /INSERT INTO sona_trajectories.+VALUES \(\?,\s*\?,\s*\?\)/,
      'INSERT statement missing from recordTrajectory',
    );
    // No silent fallback per `feedback-no-fallbacks` — INSERT errors propagate.
    // Match the actual bad shape (catch body is JUST a 'silent' comment, no
    // executable code) rather than ANY catch whose body documentation mentions
    // 'silently' in an explanatory comment alongside real handling — A2's
    // F-05-005 catch logs to console.error AND contains "must not be silently
    // swallowed" in its comment block, which is correct behaviour, not theatre.
    // The bad shape we want to detect is a single-line comment-only catch body.
    assert.doesNotMatch(
      svc,
      /catch\s*\([^)]*\)\s*\{\s*\/\/[^\n}]*silent[^\n}]*\s*\}/i,
      'silent catch (comment-only body) detected — feedback-no-fallbacks violation',
    );
  });

  it('SonaTrajectoryService.getStats and getPatterns merge in-memory + SQLite', () => {
    const svc = read(`${AGENTDB_FORK}/src/services/SonaTrajectoryService.ts`);
    assert.match(svc, /SELECT COUNT\(\*\)/, 'getStats SELECT COUNT missing');
    assert.match(svc, /SELECT DISTINCT agent_type FROM sona_trajectories/, 'getStats DISTINCT SELECT missing');
    assert.match(svc, /SELECT steps, reward FROM sona_trajectories/, 'getPatterns SELECT missing');
    assert.match(svc, /LIMIT 1000/, 'getPatterns LIMIT cap missing — unbounded read risk');
  });

  // ── Capabilities ─────────────────────────────────────────────────────────

  it('SonaTrajectoryReader capability is declared in capabilities.ts', () => {
    const caps = read(`${AGENTDB_FORK}/src/archivist/capabilities.ts`);
    assert.match(caps, /export interface SonaTrajectoryReader/, 'SonaTrajectoryReader interface missing');
    assert.match(caps, /sonaTrajectoryReader\?:\s*SonaTrajectoryReader/, 'ReadCapabilities field missing');
    assert.match(
      caps,
      /requireSonaTrajectoryReader\(\):\s*SonaTrajectoryReader/,
      'requireSonaTrajectoryReader accessor missing',
    );
    assert.match(
      caps,
      /sonaTrajectoryReaderFactory\?:\s*\(\)\s*=>\s*SonaTrajectoryReader/,
      'CapabilityFactories factory field missing',
    );
  });

  it('archivist Archivist class threads SonaTrajectoryReader through dispatchRead', () => {
    const idx = read(`${AGENTDB_FORK}/src/archivist/index.ts`);
    assert.match(idx, /sonaTrajectoryReaderFactory\?:\s*\(\)\s*=>\s*SonaTrajectoryReader/, 'init config field missing');
    assert.match(idx, /private sonaTrajectoryReader\?:\s*SonaTrajectoryReader/, 'instance field missing');
    assert.match(
      idx,
      /this\.sonaTrajectoryReader\s*=\s*config\.sonaTrajectoryReaderFactory\?\.\(\)/,
      'factory invocation in initialize() missing',
    );
    assert.match(
      idx,
      /sonaTrajectoryReader:\s*this\.sonaTrajectoryReader/,
      'makeReadCapabilities wiring missing',
    );
  });

  // ── Handler — both registrations + body ──────────────────────────────────

  it('sona-trajectory-store handler exports BOTH mutation and read registrations', () => {
    const h = read(`${AGENTDB_FORK}/src/archivist/handlers/agentdb/sona-trajectory-store.ts`);
    assert.match(
      h,
      /export const storeSonaTrajectoryHandler.*registerMutationHandler/s,
      'mutation handler export missing',
    );
    assert.match(
      h,
      /export const readSonaTrajectoryStatsHandler.*registerReadHandler/s,
      'sibling read handler export missing',
    );
    assert.match(h, /requireSonaTrajectoryReader\(\)/, 'read handler does not consume the reader capability');
    assert.match(h, /requireSonaTrajectoryWriter\(\)/, 'mutation handler does not consume the writer capability');
  });

  // ── r2 (2026-05-16): split-storeId discriminator gate ────────────────────
  // The dispatcher's getRegistration() (registration.ts:150-156) checks the
  // mutation registry FIRST and returns it when found, so co-registering the
  // read handler under the same storeId as the mutation handler made
  // dispatchRead resolve the mutation entry and throw "targets a mutation
  // handler" (empirical r1 acceptance failure). Distinct storeIds are
  // load-bearing.

  it('r2: read handler registers under DISTINCT storeId agentdb_sona_trajectory_stats', () => {
    const h = read(`${AGENTDB_FORK}/src/archivist/handlers/agentdb/sona-trajectory-store.ts`);
    // Mutation handler keeps the original storeId.
    assert.match(
      h,
      /registerMutationHandler<AgentdbSonaTrajectoryStorePayload>\(\s*'agentdb_sona_trajectory_store'/,
      'mutation handler must register under agentdb_sona_trajectory_store',
    );
    // Read handler must use the new _stats storeId.
    assert.match(
      h,
      /registerReadHandler<[^>]+>\(\s*'agentdb_sona_trajectory_stats'/,
      'read handler must register under agentdb_sona_trajectory_stats (r2 split-storeId fix)',
    );
    // Negative gate: the OLD shared-storeId registration would re-introduce r1.
    assert.doesNotMatch(
      h,
      /registerReadHandler<[^>]+>\(\s*'agentdb_sona_trajectory_store'/,
      'read handler must NOT register under agentdb_sona_trajectory_store — r1 regression class',
    );
  });

  it('r2: dispatch-types.ts declares both _store and _stats storeIds', () => {
    const dt = read(`${AGENTDB_FORK}/src/archivist/dispatch-types.ts`);
    assert.match(dt, /agentdb_sona_trajectory_store:\s*AgentdbSonaTrajectoryStorePayload/, '_store storeId missing from ToolPayloadMap');
    assert.match(dt, /agentdb_sona_trajectory_stats:\s*AgentdbSonaTrajectoryStorePayload/, '_stats storeId missing from ToolPayloadMap (r2)');
  });

  it('r2: cli wrapper dispatchRead uses _stats storeId, NOT _store', () => {
    const tools = read(`${RUFLO_FORK}/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`);
    const sonaBlock = tools.match(/agentdb_sona_trajectory_store[\s\S]*?===== #1784/);
    assert.ok(sonaBlock, 'sona wrapper block not parseable');
    // BOTH dispatchRead calls in the wrapper (stats action AND post-record
    // projection) must target the _stats storeId.
    const dispatchReadCalls = sonaBlock[0].match(/archivist\.dispatchRead\([^)]+\)/g) ?? [];
    for (const call of dispatchReadCalls) {
      assert.match(
        call,
        /agentdb_sona_trajectory_stats/,
        `cli dispatchRead call must target _stats storeId; got: ${call}`,
      );
      assert.doesNotMatch(
        call,
        /agentdb_sona_trajectory_store/,
        `cli dispatchRead call must NOT target _store (mutation) storeId; got: ${call}`,
      );
    }
    assert.ok(dispatchReadCalls.length >= 2, `expected at least 2 dispatchRead calls in sona wrapper, got ${dispatchReadCalls.length}`);
    // The mutation dispatch (action='record') still uses _store.
    assert.match(
      sonaBlock[0],
      /archivist\.dispatch\(\s*'agentdb_sona_trajectory_store'/,
      'cli mutation dispatch must use _store storeId',
    );
  });

  it('handler header documents the cli adapter trace (b5-da revision a)', () => {
    const h = read(`${AGENTDB_FORK}/src/archivist/handlers/agentdb/sona-trajectory-store.ts`);
    assert.match(h, /CLI ADAPTER TRACE/, 'cli adapter trace header missing — b5-da revision a documentation');
    assert.match(h, /makeCliSonaTrajectoryWriter/, 'reference to cli writer adapter missing');
    assert.match(h, /agent_type[\s\S]*?b5-sona/i, 'agent_type column trace claim missing');
  });

  it('handler body fail-loud on stats action reaching mutation path (and vice versa)', () => {
    const h = read(`${AGENTDB_FORK}/src/archivist/handlers/agentdb/sona-trajectory-store.ts`);
    assert.match(h, /stats[\\']* action is read-only[\s\S]*?dispatchRead/, 'mutation handler missing stats-routing throw');
    assert.match(h, /only [\\']*stats[\\']* action is read-side/, 'read handler missing record-routing throw');
  });

  // ── Substrate-registry ──────────────────────────────────────────────────

  it('substrate-registry moved agentdb_sona_trajectory_store from RVF to SQLite carve-out', () => {
    const sr = read(`${AGENTDB_FORK}/src/archivist/substrate-registry.ts`);
    // Find the RVF set
    const rvfMatch = sr.match(/RVF_STORE_IDS:[^=]+=\s*new Set\(\[([\s\S]*?)\]\);/);
    assert.ok(rvfMatch, 'RVF_STORE_IDS not found');
    assert.doesNotMatch(rvfMatch[1], /'agentdb_sona_trajectory_store'/, 'agentdb_sona_trajectory_store still in RVF set');

    const carveMatch = sr.match(/SQLITE_CARVE_OUT_STORE_IDS:[^=]+=\s*new Set\(\[([\s\S]*?)\]\);/);
    assert.ok(carveMatch, 'SQLITE_CARVE_OUT_STORE_IDS not found');
    assert.match(
      carveMatch[1],
      /'agentdb_sona_trajectory_store'/,
      'agentdb_sona_trajectory_store missing from SQLite carve-out set',
    );
  });

  // ── Barrel ──────────────────────────────────────────────────────────────

  it('handlers/agentdb/index.ts barrel re-exports sona-trajectory-store (uncommented)', () => {
    const barrel = read(`${AGENTDB_FORK}/src/archivist/handlers/agentdb/index.ts`);
    // Live export (not a leading `// `).
    assert.match(barrel, /^export \* from '\.\/sona-trajectory-store\.js';/m, 'barrel export missing or commented out');
    // Old "PERMANENTLY CLI-ONLY" sentence should be gone.
    assert.doesNotMatch(barrel, /PERMANENTLY CLI-ONLY/, 'stale "permanently cli-only" deferral comment still present');
  });

  // ── Cli wiring (revisions b + c) ─────────────────────────────────────────

  it('cli archivist-init.ts wires SonaTrajectoryReader factory in BOTH initialize call sites', () => {
    const init = read(`${RUFLO_FORK}/v3/@claude-flow/cli/src/memory/archivist-init.ts`);
    assert.match(init, /function makeCliSonaTrajectoryReader\(\): SonaTrajectoryReader/, 'reader factory function missing');
    // Per-call resolution discipline — getController inside getStats, no closure cache.
    const factoryBody = init.match(/function makeCliSonaTrajectoryReader\([\s\S]*?^}/m);
    assert.ok(factoryBody, 'factory body not parseable');
    assert.match(factoryBody[0], /async getStats\(\)/, 'getStats method missing');
    assert.match(factoryBody[0], /await import\('\.\/memory-router\.js'\)/, 'per-call dynamic import missing');
    // Both initialize() call sites should reference the new factory.
    const factoryUses = init.match(/sonaTrajectoryReaderFactory:\s*makeCliSonaTrajectoryReader/g) ?? [];
    assert.equal(factoryUses.length, 2, `expected 2 sonaTrajectoryReaderFactory wirings, got ${factoryUses.length}`);
  });

  it('controller-registry.ts passes lazy {getDb} resolver to STS constructor (revision c)', () => {
    const cr = read(`${RUFLO_FORK}/v3/@claude-flow/memory/src/controller-registry.ts`);
    assert.match(
      cr,
      /new STS\(\s*\{\s*getDb:\s*\(\)\s*=>\s*this\.agentdb\?\.database\s*\?\?\s*null\s*\}\s*\)/,
      'STS constructor not passing lazy {getDb} resolver — revision c violation',
    );
    assert.match(cr, /INTENTIONAL SPLIT/, 'split documentation missing in controller-registry');
  });

  it('LearningSystem.ts retains zero-arg construction with intentional-split annotation', () => {
    const ls = read(`${AGENTDB_FORK}/src/controllers/LearningSystem.ts`);
    assert.match(ls, /this\.sonaService = new SonaTrajectoryService\(\);/, 'LearningSystem zero-arg construction missing');
    assert.match(ls, /INTENTIONAL SPLIT/, 'intentional-split annotation missing in LearningSystem');
  });

  // ── Cli wrapper (revision b — ensureRvfWired → ensureSqliteWired flip) ──

  it('agentdb-tools.ts uses ensureSqliteWired (NOT ensureRvfWired) for sona dispatch', () => {
    const tools = read(`${RUFLO_FORK}/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`);
    // Locate the agentdb_sona_trajectory_store wrapper handler block
    const sonaBlock = tools.match(/agentdb_sona_trajectory_store[\s\S]*?===== #1784/);
    assert.ok(sonaBlock, 'sona wrapper block not parseable');
    // Must call ensureSqliteWired in the sona block (revision b).
    assert.match(
      sonaBlock[0],
      /await ensureSqliteWired\(\)/,
      'ensureSqliteWired call missing — revision b RVF→SQLite flip not applied',
    );
    // Must NOT call ensureRvfWired in the sona block — that was the off-by-one.
    assert.doesNotMatch(
      sonaBlock[0].replace(/\/\/[^\n]*/g, ''), // strip comments first; references in headers are OK
      /await ensureRvfWired\(\)/,
      'ensureRvfWired still called in sona block — revision b incomplete',
    );
  });

  it('agentdb-tools.ts splits dispatch by action (record→dispatch, stats→dispatchRead)', () => {
    const tools = read(`${RUFLO_FORK}/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`);
    const sonaBlock = tools.match(/agentdb_sona_trajectory_store[\s\S]*?===== #1784/);
    assert.ok(sonaBlock, 'sona wrapper block not parseable');
    // r2: stats targets the split _stats storeId; record targets the
    // original _store storeId. The dedicated 'r2' assertions above have
    // tighter coverage; this is the high-level smoke.
    assert.match(
      sonaBlock[0],
      /if \(action === 'stats'\)[\s\S]*?dispatchRead\('agentdb_sona_trajectory_stats'/,
      'stats action does not route through dispatchRead on _stats storeId',
    );
    assert.match(
      sonaBlock[0],
      /archivist\.dispatch\('agentdb_sona_trajectory_store'/,
      'record action does not route through dispatch on _store storeId',
    );
  });

  it('agentdb-tools.ts response envelope uses controller=sonaTrajectory (b5 probe contract)', () => {
    const tools = read(`${RUFLO_FORK}/v3/@claude-flow/cli/src/mcp-tools/agentdb-tools.ts`);
    const sonaBlock = tools.match(/agentdb_sona_trajectory_store[\s\S]*?===== #1784/);
    assert.ok(sonaBlock, 'sona wrapper block not parseable');
    assert.match(
      sonaBlock[0],
      /controller:\s*'sonaTrajectory'/,
      "response envelope missing controller:'sonaTrajectory' — b5 probe L1834 will fail",
    );
    // Must NOT return controller:'archivist' in the record path.
    const records = sonaBlock[0].match(/return\s*\{[^}]*controller:\s*'archivist'/g) ?? [];
    assert.equal(records.length, 0, 'response envelope still returns controller:\'archivist\' — b5 mismatch');
    // trajectoryCount + agentTypes projected for the probe envelope.
    assert.match(sonaBlock[0], /trajectoryCount:\s*after\.trajectoryCount/, 'trajectoryCount projection missing');
    assert.match(sonaBlock[0], /agentTypes:\s*after\.agentTypes/, 'agentTypes projection missing');
  });
});
