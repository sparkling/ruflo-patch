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
    assert.doesNotMatch(
      svc,
      /catch\s*\([^)]*\)\s*\{\s*\/\/[^}]*silent[^}]*\}/i,
      'silent catch around INSERT detected — feedback-no-fallbacks violation',
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
    assert.match(
      sonaBlock[0],
      /if \(action === 'stats'\)[\s\S]*?dispatchRead\('agentdb_sona_trajectory_store'/,
      'stats action does not route through dispatchRead',
    );
    assert.match(
      sonaBlock[0],
      /archivist\.dispatch\('agentdb_sona_trajectory_store'/,
      'record action does not route through dispatch',
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
