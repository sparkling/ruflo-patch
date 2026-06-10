#!/usr/bin/env node
/**
 * Smoke: ADR-0305 — the `adr-index` SKILL drives the in-process `agentdb index`
 * builder (not the per-record `import.mjs` npx loop), and that path produces
 * record + forward-edge counts that MATCH the legacy `import.mjs` path on the
 * same corpus (no records/edges lost in the migration).
 *
 * This is the SKILL-PATH regression (not the builder in isolation — that is
 * smoke-adr0273-index.mjs). It asserts THREE things:
 *
 *   (S) Skill contract: the shipped adr-index SKILL.md instructs running
 *       `agentdb index` (the in-process builder) and no longer instructs running
 *       `node …/import.mjs`. A migration that updates the runtime but leaves the
 *       skill pointing at the old script would pass a builder-only smoke; this
 *       guards the actual behavioral surface.
 *
 *   (P) Parity: run BOTH paths over one identical synthetic corpus.
 *       - import.mjs (IMPORT_DRY_RUN=1, JSON) reports R records + E forward edges.
 *       - `agentdb index --dir <corpus>` writes R hierarchical records + the same
 *         E forward edges (+ E inverses, the ADR-0273 D10 enhancement import.mjs
 *         never wrote). Assert builder.records == import.records and
 *         builder.edges (forward) == import.edges → no record/forward-edge lost.
 *
 *   (V) Visibility: the builder's records are queryable via the live MCP server
 *       (agentdb_hierarchical-query adr/ADR-930*), proving the migrated path
 *       populated the canonical hierarchical store the index is read from.
 *
 * Synthetic corpus (ADR-930x ids — no collision with the real 0001-03xx corpus):
 *   ADR-9301  supersedes ADR-9302, depends-on ADR-9303, implements ADR-9304
 *   ADR-9302/9303/9304  leaves
 * Expect: import.mjs → 4 records, 3 forward edges (1 supersedes/1 depends-on/1 implements).
 *         builder    → 4 records, 3 forward edges + 3 inverses.
 *
 * FAILs if: the skill still points at import.mjs (S); the builder drops a record
 * or forward edge vs import.mjs (P); writes hit LockHeld (ADR-0274 ineffective);
 * or the records aren't visible via the live server (V).
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  createSmokePerf,
  setupSmokeTempDir,
  installAndInit,
  findCli,
} from './lib/smoke-adr0255-shared.mjs';

const REGISTRY = process.env.REGISTRY || 'http://localhost:4873';
const LOG_DIR = process.env.SMOKE_LOG_DIR || '/tmp';
const LOG_FILE = join(LOG_DIR, `smoke-adr0305-${process.pid}.log`);
const perf = createSmokePerf('smoke-adr0305-index-skill-migration');

// The legacy importer ships inside the ruflo-adr plugin. Locate it relative to
// the fork checkout so the parity baseline is computed from the SAME script the
// skill is migrating away from.
const FORK_ROOT = process.env.FORK_RUFLO_ROOT || '/Users/henrik/source/forks/ruflo';
const IMPORT_MJS = join(FORK_ROOT, 'plugins/ruflo-adr/scripts/import.mjs');
const SKILL_MD = join(FORK_ROOT, 'plugins/ruflo-adr/skills/adr-index/SKILL.md');

let passed = 0, failed = 0;
function log(m) { process.stderr.write(`${m}\n`); try { appendFileSync(LOG_FILE, `${m}\n`); } catch {} }
function pass(l) { passed++; log(`  PASS  ${l}`); }
function fail(l, r) { failed++; log(`  FAIL  ${l}: ${r}`); }

function adrDoc(id, fm, title) {
  return `---\n${fm}\n---\n# ${title}\n\n## Context and Problem Statement\n\nSynthetic ADR ${id} for the ADR-0305 skill-migration parity smoke.\n`;
}

function parseResult(raw) {
  let body = raw;
  const idx = raw.search(/^Result:/m);
  if (idx >= 0) body = raw.slice(idx).replace(/^Result:/m, '');
  const start = body.indexOf('{');
  if (start < 0) return null;
  let obj;
  try { obj = JSON.parse(body.slice(start)); } catch {
    for (const line of body.split(/\n/)) { const s = line.indexOf('{'); if (s < 0) continue; try { obj = JSON.parse(line.slice(s)); break; } catch {} }
  }
  if (obj && Array.isArray(obj.content) && obj.content[0]?.text) { try { obj = JSON.parse(obj.content[0].text); } catch {} }
  return obj;
}

// Parse "agentdb index complete: R/N hierarchical records, P adr-patterns, E edges + I inverses"
function parseBuilderCounts(combined) {
  const m = /complete:\s*(\d+)\/(\d+)\s+hierarchical records,\s*(\d+)\s+adr-patterns,\s*(\d+)\s+edges\s*\+\s*(\d+)\s+inverses/i.exec(combined);
  if (!m) return null;
  return { records: +m[1], parsed: +m[2], patterns: +m[3], edges: +m[4], inverses: +m[5] };
}

async function main() {
  log(`\n[ADR-0305 smoke] adr-index SKILL drives agentdb index — parity with import.mjs`);
  log(`[smoke] log: ${LOG_FILE}\n`);

  // ── (S) Skill contract: the canonical skill must instruct `agentdb index`,
  // not `node …/import.mjs`. This guards the behavioral surface itself.
  if (!existsSync(SKILL_MD)) {
    fail('skill-present', `adr-index SKILL.md not found at ${SKILL_MD} (set FORK_RUFLO_ROOT)`);
  } else {
    const skill = readFileSync(SKILL_MD, 'utf8');
    if (/\bagentdb\s+index\b/.test(skill)) pass('skill instructs `agentdb index` (in-process builder)');
    else fail('skill-builder', 'adr-index SKILL.md does not instruct `agentdb index`');
    // The Steps section must not tell the agent to RUN import.mjs. A passing
    // reference in "Parity"/"fallback" prose is fine; an executable
    // `node …/import.mjs` Step is the migration not being done.
    if (/`?node\s+\S*import\.mjs/.test(skill)) {
      fail('skill-legacy-run', 'adr-index SKILL.md still shows `node …/import.mjs` as a run step (migration incomplete)');
    } else {
      pass('skill no longer runs import.mjs as a step');
    }
  }

  // ── (P) baseline: import.mjs forward-edge + record counts on the corpus.
  const { dir, shared } = setupSmokeTempDir('smoke-adr0305', perf, REGISTRY);
  let mcpProc = null;
  try {
    const cli = shared ? findCli(dir) : installAndInit(dir, perf, REGISTRY);
    if (!cli) { fail('setup', 'cli not found'); return finish(dir, shared, mcpProc); }

    // Synthetic corpus under <root>/docs/adr — both paths must see the SAME
    // files. import.mjs only collects files whose path .includes('/docs/adr/')
    // (its findAdrs filter) and is scoped via ADR_ROOT=<root>; the builder scans
    // its --dir directly, so it gets --dir <root>/docs/adr. Isolated id range
    // (ADR-930x) avoids collision with the real corpus.
    const corpusRoot = join(dir, 'adr0305-root');
    const adrDir = join(corpusRoot, 'docs', 'adr');
    mkdirSync(adrDir, { recursive: true });
    writeFileSync(join(adrDir, 'ADR-9301-root.md'),
      adrDoc('ADR-9301', 'status: accepted\ndate: 2026-05-30\ntags: [smoke0305]\nsupersedes: [ADR-9302]\ndepends-on: [ADR-9303]\nimplements: [ADR-9304]', 'ADR0305 Root 9301'));
    for (const [id, t] of [['9302', 'Superseded'], ['9303', 'Dep'], ['9304', 'Impl']]) {
      writeFileSync(join(adrDir, `ADR-${id}-leaf.md`),
        adrDoc(`ADR-${id}`, `status: accepted\ndate: 2026-05-30\ntags: [smoke0305]\nsupersedes: []\ndepends-on: []\nimplements: []`, `ADR0305 ${t} ${id}`));
    }

    // import.mjs baseline (dry-run JSON — parse-only, no writes). ADR_ROOT is the
    // corpus ROOT (not the adr dir): import.mjs walks it and filters to /docs/adr/.
    let importRecords = null, importEdges = null;
    if (existsSync(IMPORT_MJS)) {
      const ir = spawnSync('node', [IMPORT_MJS], {
        cwd: dir, encoding: 'utf8', timeout: 30000,
        env: { ...process.env, IMPORT_DRY_RUN: '1', IMPORT_FORMAT: 'json', ADR_ROOT: corpusRoot },
      });
      const obj = (() => { try { return JSON.parse(ir.stdout || ''); } catch { return null; } })();
      if (obj) { importRecords = obj.total; importEdges = obj.edges; }
      log(`[smoke] import.mjs baseline: records=${importRecords} forwardEdges=${importEdges} byRelation=${JSON.stringify(obj?.byRelation)}`);
    }
    if (importRecords == null || importEdges == null) {
      fail('import-baseline', `could not compute import.mjs baseline at ${IMPORT_MJS}`);
    } else {
      // Self-check the corpus is the one we authored (4 records, 3 forward edges).
      if (importRecords === 4 && importEdges === 3) pass('import.mjs baseline: 4 records, 3 forward edges (corpus as authored)');
      else fail('import-shape', `unexpected import.mjs baseline: records=${importRecords} edges=${importEdges} (expected 4/3)`);
    }

    // Start a live MCP server + warm it so it holds-then-parks the RVF flock
    // (ADR-0274) — proves the migrated path runs alongside it (no stop step).
    mcpProc = spawn(cli, ['mcp', 'start'], { cwd: dir, env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY }, stdio: ['pipe', 'pipe', 'pipe'] });
    let sb = '';
    mcpProc.stdout.on('data', (c) => { sb += c.toString(); });
    mcpProc.stderr.on('data', (c) => log(`  [mcp.stderr] ${c.toString().replace(/\n/g, ' | ').slice(0, 200)}`));
    mcpProc.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'adr0305', version: '0' } } }) + '\n' +
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'memory_search', arguments: { query: 'adr0305-warmup', limit: 1 } } }) + '\n');
    { const t = Date.now(); while (Date.now() - t < 15000) { await new Promise(r => setTimeout(r, 250)); if (/"id":\s*2[,}]/.test(sb)) break; if (mcpProc.exitCode !== null) break; } }
    log(`[smoke] MCP warmed (or settled); running the skill's command alongside it`);

    // ── The SKILL PATH: run exactly what the skill instructs — `agentdb index --dir <corpus>`.
    const t0 = Date.now();
    const r = spawnSync(cli, ['agentdb', 'index', '--dir', adrDir], { cwd: dir, encoding: 'utf8', timeout: 60000, env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY } });
    const ms = Date.now() - t0;
    const combined = `${r.stdout || ''}\n${r.stderr || ''}`;
    log(`[smoke] agentdb index status=${r.status} duration=${ms}ms`);
    log(combined.slice(0, 800));

    if (/Unknown command/i.test(combined) && /agentdb/i.test(combined)) {
      fail('command-missing', 'agentdb index not registered — published build predates ADR-0273');
      return finish(dir, shared, mcpProc);
    }
    if (r.signal === 'SIGTERM' || ms >= 59000 || /LockHeld|0x0300/i.test(combined)) {
      fail('index-blocked', `agentdb index hit LockHeld / hang alongside the live MCP server (ADR-0274 ineffective): ${combined.slice(0, 200)}`);
      return finish(dir, shared, mcpProc);
    }
    if (r.status === 0) pass(`skill command \`agentdb index --dir\` ran alongside live MCP in ${ms}ms (no stop, no LockHeld)`);
    else fail('index-exit', `agentdb index exit=${r.status}: ${combined.slice(0, 200)}`);

    // ── (P) parity assertions: builder.records == import.records;
    //                            builder.edges (forward) == import.edges.
    const bc = parseBuilderCounts(combined);
    if (!bc) {
      fail('builder-counts', `could not parse builder completion line: ${combined.slice(0, 200)}`);
    } else {
      log(`[smoke] builder counts: ${JSON.stringify(bc)}`);
      if (importRecords != null && bc.records === importRecords)
        pass(`record parity: builder ${bc.records} == import.mjs ${importRecords} (no record lost)`);
      else
        fail('record-parity', `builder records=${bc.records} != import.mjs ${importRecords}`);

      if (importEdges != null && bc.edges === importEdges)
        pass(`forward-edge parity: builder ${bc.edges} == import.mjs ${importEdges} (no forward edge lost)`);
      else
        fail('edge-parity', `builder forward edges=${bc.edges} != import.mjs ${importEdges}`);

      // The migration enhancement: inverses import.mjs never wrote.
      if (bc.inverses === importEdges)
        pass(`builder additionally wrote ${bc.inverses} derived inverses (ADR-0273 D10 — enhancement, not a regression)`);
      else
        fail('inverse-count', `expected ${importEdges} derived inverses, got ${bc.inverses}`);
    }

    // ── (V) visibility via the live MCP server: adr/ADR-930* → 4.
    const q = spawnSync(cli, ['mcp', 'exec', '--tool', 'agentdb_hierarchical-query', '--params', JSON.stringify({ pathPattern: 'adr/ADR-930*' })],
      { cwd: dir, encoding: 'utf8', timeout: 30000, env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY } });
    const qobj = parseResult(`${q.stdout || ''}\n${q.stderr || ''}`);
    const n = qobj && Array.isArray(qobj.results) ? qobj.results.length : null;
    if (n === 4) pass('agentdb_hierarchical-query adr/ADR-930* → 4 records (migrated path populated the canonical store)');
    else fail('hquery', `expected 4 from adr/ADR-930*, got ${n}: ${JSON.stringify(qobj).slice(0, 200)}`);

  } catch (e) {
    fail('main', e?.stack || String(e));
  } finally {
    if (mcpProc && mcpProc.exitCode === null) { try { mcpProc.kill('SIGTERM'); } catch {} await new Promise(r => setTimeout(r, 400)); if (mcpProc.exitCode === null) try { mcpProc.kill('SIGKILL'); } catch {} }
    try { if (!shared) rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  finish();
}

function finish() {
  log(`\nResults: ${passed} passed, ${failed} failed`);
  perf.emitJson();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { fail('uncaught', e?.message || String(e)); finish(); });
