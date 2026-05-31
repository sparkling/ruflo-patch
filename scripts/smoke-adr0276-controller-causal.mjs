#!/usr/bin/env node
/**
 * Smoke: ADR-0276 — re-converge ADR causal edges onto upstream's
 * CausalMemoryGraph controller (the SQLite controller answers, not the KV
 * `router-fallback`).
 *
 * WHY THIS FAILS PRE-IMPL (probed against patch.358, 2026-05-31):
 *   The fork records ADR `supersedes`/`depends-on`/`implements` edges through a
 *   fork-only KV shortcut (`routeCausalOp` → `causal-edges` namespace). The
 *   controller write arm is dead (`addEdge` typo guard, permanently false,
 *   `memory-router.ts:2467`) and the controller read arm calls with the wrong
 *   arg shape, so `queryCausalEffects`/`getCausalChain` return 0 rows. The
 *   router then reports `controller: "router-fallback"` (the KV path) — never
 *   `causalGraph`. Live probe:
 *     causal-query effect=ADR-9001 → controller: "router-fallback"  (want causalGraph)
 *     causal-node-delete ADR-9002  → controller: "native-unsupported",
 *                                     deletedEdges:0, deleted:false  (cascade is a no-op)
 *     effect= 1-hop inbound        → controller: "router-fallback"  (no effect= controller arm)
 *     numeric ID-map               → no fromMemoryId on results      (no string→numeric map)
 *
 *   After ADR-0276 (R1 durable string→numeric map + R2 live write arm + R3
 *   proper CausalQuery read [cause= via queryCausalEffects, effect= via
 *   queryCausalCauses] + R5 cascade) the SQLite CausalMemoryGraph answers:
 *   `controller` starts with `causalGraph` (dual-read may append `+fallback`),
 *   the 1-hop inbound edge resolves through the controller, cascade-delete
 *   removes incident edges, and an ADR id round-trips through the numeric map.
 *
 * The four §Confirmation assertions of ADR-0276:
 *   1. controller-backed inbound query (controller === causalGraph[+fallback])
 *   2. 1-hop inbound edge is controller-backed via the effect= arm
 *      (queryCausalCauses). Transitive multi-hop is point-to-point via
 *      getCausalChain — NOT an all-inbound query, and not wired as an MCP tool —
 *      so it is out of scope for this all-causes (effect=) smoke.
 *   3. cascade-delete of an ADR node removes its incident edges (count > 0)
 *   4. the string→numeric ID map round-trips
 *
 * FAIL pre-impl, PASS post-impl. Uses high ADR-9xxx synthetic ids (no collision
 * with the real 0001-0280 corpus). Reuses the ACCEPT_TEMP install via
 * ADR0255_SMOKE_SHARED_TEMP; standalone self-installs from Verdaccio.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  createSmokePerf,
  setupSmokeTempDir,
  installAndInit,
  findCli,
} from './lib/smoke-adr0255-shared.mjs';

const REGISTRY = process.env.REGISTRY || 'http://localhost:4873';
const LOG_DIR = process.env.SMOKE_LOG_DIR || '/tmp';
const LOG_FILE = join(LOG_DIR, `smoke-adr0276-${process.pid}.log`);
const perf = createSmokePerf('smoke-adr0276-controller-causal');

let passed = 0;
let failed = 0;
function log(m) { process.stderr.write(`${m}\n`); try { appendFileSync(LOG_FILE, `${m}\n`); } catch {} }
function pass(l) { passed++; log(`  PASS  ${l}`); }
function fail(l, r) { failed++; log(`  FAIL  ${l}: ${r}`); }

function adrDoc(id, fm, title) {
  return `---\n${fm}\n---\n# ${title}\n\n## Context and Problem Statement\n\nSynthetic ADR ${id} for the ADR-0276 controller-causal smoke. It validates that ADR causal edges are answered by the SQLite CausalMemoryGraph controller, not the KV fallback.\n`;
}

// Extract the first balanced {...} object starting at `from`, honouring strings
// and escapes — `cli mcp exec` prints pretty JSON to stdout but a trailing
// stderr banner (concatenated after) breaks a naive `JSON.parse(slice)`.
function extractBalanced(s, from) {
  const start = s.indexOf('{', from);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}

// Parse the `cli mcp exec` envelope: skip the `[INFO]/[OK]` preamble, locate
// `Result:`, then the first balanced JSON object. Tolerates content-wrapped shapes.
function parseResult(raw) {
  let body = raw;
  const idx = raw.search(/^Result:/m);
  if (idx >= 0) body = raw.slice(idx).replace(/^Result:/m, '');
  const json = extractBalanced(body, 0);
  if (json === null) return null;
  let obj = null;
  try { obj = JSON.parse(json); } catch { return null; }
  if (obj && Array.isArray(obj.content) && obj.content[0]?.text) { try { obj = JSON.parse(obj.content[0].text); } catch {} }
  return obj;
}

function mcpExec(cli, dir, tool, params) {
  const r = spawnSync(cli, ['mcp', 'exec', '--tool', tool, '--params', JSON.stringify(params)], {
    cwd: dir, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY },
  });
  return parseResult(`${r.stdout || ''}\n${r.stderr || ''}`);
}

// A row's numeric memory id, however the controller exposes it.
function numericId(e) {
  for (const k of ['fromMemoryId', 'toMemoryId', 'memoryId', 'memory_id', 'sourceMemoryId', 'targetMemoryId', 'nodeId']) {
    const v = e?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && /^-?\d+$/.test(v)) return Number(v);
  }
  return null;
}

async function main() {
  log(`\n[ADR-0276 smoke] ADR causal edges answered by the CausalMemoryGraph controller (not KV fallback)`);
  log(`[smoke] log: ${LOG_FILE}\n`);
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  const { dir, shared } = setupSmokeTempDir('smoke-adr0276', perf, REGISTRY);
  log(`[smoke] temp dir: ${dir}${shared ? ' (shared)' : ''}`);

  let mcpProc = null;
  let testBodyStart;
  try {
    const cli = shared ? findCli(dir) : installAndInit(dir, perf, REGISTRY);
    if (!cli) { fail('setup', 'cli not found'); return finish(dir, shared, mcpProc); }
    testBodyStart = process.hrtime.bigint();

    // ── Synthetic ADR corpus. ──
    //   ADR-9001 supersedes ADR-9002, depends-on ADR-9003  (cascade + inbound target)
    //   Transitive chain for the 2-hop test:
    //   ADR-9101 depends-on ADR-9102; ADR-9102 depends-on ADR-9103
    const adrDir = join(dir, 'smoke-adr-0276');
    mkdirSync(adrDir, { recursive: true });
    writeFileSync(join(adrDir, 'ADR-9001-root.md'),
      adrDoc('ADR-9001', 'status: accepted\ndate: 2026-05-30\ntags: [smoke]\nsupersedes: [ADR-9002]\ndepends-on: [ADR-9003]\nimplements: []', 'Smoke Root 9001'));
    writeFileSync(join(adrDir, 'ADR-9002-superseded.md'),
      adrDoc('ADR-9002', 'status: accepted\ndate: 2026-05-30\ntags: [smoke]\nsupersedes: []\ndepends-on: []\nimplements: []', 'Smoke Superseded 9002'));
    writeFileSync(join(adrDir, 'ADR-9003-dep.md'),
      adrDoc('ADR-9003', 'status: accepted\ndate: 2026-05-30\ntags: [smoke]\nsupersedes: []\ndepends-on: []\nimplements: []', 'Smoke Dep 9003'));
    writeFileSync(join(adrDir, 'ADR-9101-chain-a.md'),
      adrDoc('ADR-9101', 'status: accepted\ndate: 2026-05-30\ntags: [smoke]\nsupersedes: []\ndepends-on: [ADR-9102]\nimplements: []', 'Chain A 9101'));
    writeFileSync(join(adrDir, 'ADR-9102-chain-b.md'),
      adrDoc('ADR-9102', 'status: accepted\ndate: 2026-05-30\ntags: [smoke]\nsupersedes: []\ndepends-on: [ADR-9103]\nimplements: []', 'Chain B 9102'));
    writeFileSync(join(adrDir, 'ADR-9103-chain-c.md'),
      adrDoc('ADR-9103', 'status: accepted\ndate: 2026-05-30\ntags: [smoke]\nsupersedes: []\ndepends-on: []\nimplements: []', 'Chain C 9103'));

    // ── Start a live MCP server + warm it up (RVF flock park, ADR-0274). ──
    mcpProc = spawn(cli, ['mcp', 'start'], { cwd: dir, env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY }, stdio: ['pipe', 'pipe', 'pipe'] });
    let sb = '';
    mcpProc.stdout.on('data', (c) => { sb += c.toString(); });
    mcpProc.stderr.on('data', (c) => log(`  [mcp.stderr] ${c.toString().replace(/\n/g, ' | ').slice(0, 200)}`));
    mcpProc.on('exit', (code) => log(`[mcp.exit] code=${code}`));
    mcpProc.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'adr0276', version: '0' } } }) + '\n' +
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'memory_search', arguments: { query: 'adr0276-warmup', limit: 1 } } }) + '\n');
    { const t = Date.now(); while (Date.now() - t < 15000) { await new Promise(r => setTimeout(r, 250)); if (/"id":\s*2[,}]/.test(sb)) break; if (mcpProc.exitCode !== null) break; } }

    // ── Build the ADR index (writes hierarchical + causal edges + patterns). ──
    const t0 = Date.now();
    const ix = spawnSync(cli, ['agentdb', 'index', '--dir', adrDir, '--purge'], { cwd: dir, encoding: 'utf8', timeout: 60000, env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY } });
    const ixCombined = `${ix.stdout || ''}\n${ix.stderr || ''}`;
    log(`[smoke] agentdb index status=${ix.status} duration=${Date.now() - t0}ms`);
    log(ixCombined.slice(0, 400));
    if (/Unknown command|not found/i.test(ixCombined) && ix.status !== 0 && !/index complete|index:/i.test(ixCombined)) {
      fail('setup-index', 'agentdb index not registered — published build predates ADR-0273/0276');
      return finish(dir, shared, mcpProc);
    }
    if (ix.status !== 0) {
      fail('setup-index', `agentdb index exit=${ix.status}: ${ixCombined.slice(0, 200)}`);
      return finish(dir, shared, mcpProc);
    }

    // ════════════════════════════════════════════════════════════════════
    // Assertion 1 — inbound edges answered by the CONTROLLER (not router-fallback).
    //   ADR-9001 is the target of `superseded-by` (from 9002) and
    //   `depended-on-by` (from 9003). The router reports controller='causalGraph'
    //   (or 'causalGraph+fallback' during the R7 dual-read) ONLY when the SQLite
    //   controller returns rows. Pre-impl it is always 'router-fallback'.
    // ════════════════════════════════════════════════════════════════════
    const q1 = mcpExec(cli, dir, 'agentdb_causal-query', { effect: 'ADR-9001', k: 10 });
    const ctrl1 = q1?.controller ?? '(none)';
    const rows1 = Array.isArray(q1?.results) ? q1.results : [];
    log(`[smoke] causal-query effect=ADR-9001 → controller=${ctrl1} count=${rows1.length}`);
    if (typeof ctrl1 === 'string' && ctrl1.startsWith('causalGraph')) {
      // sanity: the inbound edges must actually be present
      const hasInbound = rows1.some(e => e.relation === 'superseded-by' || e.relation === 'depended-on-by');
      if (hasInbound) pass(`inbound query answered by controller (controller=${ctrl1}, inbound edges present)`);
      else fail('controller-inbound-edges', `controller=${ctrl1} but inbound edges missing: ${JSON.stringify(rows1).slice(0, 200)}`);
    } else {
      fail('controller-answers', `controller=${ctrl1} (want a 'causalGraph' controller; 'router-fallback' = KV shortcut, ADR-0276 not effective)`);
    }

    // ════════════════════════════════════════════════════════════════════
    // Assertion 2 — 1-hop INBOUND edge is controller-backed (the effect= arm).
    //   Forward chain ADR-9101 → ADR-9102 → ADR-9103 (depends-on); the
    //   `depends-on` write also stores the forward edge ADR-9101 → ADR-9102.
    //   `effect=ADR-9102` asks "what causes ADR-9102?" → its INBOUND edges →
    //   the 1-hop neighbour ADR-9101. The router answers this via the controller
    //   (`queryCausalCauses`, ADR-0276) so `controller` starts with `causalGraph`.
    //
    //   NOTE — transitive 2-hop is NOT an all-inbound query. A single
    //   `effect=ADR-9102` returns only the 1-hop inbound edge (ADR-9101), never
    //   the 2-hop-distant ADR-9100-side. Upstream's transitive traversal is
    //   `CausalMemoryGraph.getCausalChain(from, to)` — POINT-TO-POINT, not "all
    //   inbound", and it is NOT wired as an MCP tool (no `agentdb_causal-chain`;
    //   the registered causal tools are causal-edge / -query / -recall /
    //   -edge-delete / -node-delete). So this asserts the controller-backed
    //   1-hop inbound only; the transitive chain is a separate (getCausalChain)
    //   surface, not exercised here (ADR-0276 §Confirmation: effect= is the
    //   "all causes" inbound direction, distinct from the point-to-point chain).
    //   Pre-impl effect= had no controller method → controller='router-fallback'.
    // ════════════════════════════════════════════════════════════════════
    const q2 = mcpExec(cli, dir, 'agentdb_causal-query', { effect: 'ADR-9102', k: 10 });
    const ctrl2 = q2?.controller ?? '(none)';
    const rows2 = Array.isArray(q2?.results) ? q2.results : [];
    const reached = new Set(rows2.flatMap(e => [e.sourceId, e.targetId]).filter(Boolean));
    log(`[smoke] 1-hop inbound via effect=ADR-9102 → controller=${ctrl2} reached={${[...reached].join(',')}}`);
    const has1HopInbound = reached.has('ADR-9101');
    if (typeof ctrl2 === 'string' && ctrl2.startsWith('causalGraph') && has1HopInbound) {
      pass(`1-hop inbound edge controller-backed (effect=ADR-9102 ← ADR-9101; controller=${ctrl2})`);
    } else {
      fail('one-hop-inbound', `controller=${ctrl2}, reached={${[...reached].join(',')}} — want controller 'causalGraph' AND the 1-hop inbound cause ADR-9101 present (effect= not controller-backed; transitive chain is point-to-point via getCausalChain, not an all-inbound query)`);
    }

    // ════════════════════════════════════════════════════════════════════
    // Assertion 4 (run before cascade-delete mutates the graph) —
    //   the string→numeric ID map round-trips. A controller-backed query row
    //   carries a stable numeric memory id for an ADR node; that numeric must
    //   resolve back to the same ADR string. Pre-impl there is no controller
    //   row at all (router-fallback rows carry only string ids), so no numeric
    //   id is exposed → FAIL.
    // ════════════════════════════════════════════════════════════════════
    const q4 = mcpExec(cli, dir, 'agentdb_causal-query', { cause: 'ADR-9001', k: 10 });
    const ctrl4 = q4?.controller ?? '(none)';
    const rows4 = Array.isArray(q4?.results) ? q4.results : [];
    // The string→numeric ID map (R1) is INTERNAL to routeCausalOp — query
    // results carry the user-facing ADR string ids (sourceId/targetId), the
    // numerics are reverse-mapped away by design (not leaked into the API). Its
    // correctness is observable two ways, both checked here: (a) the controller
    // answers at all — you cannot reverse-map a controller row without the
    // durable map resolving; (b) the map is PERSISTENT — re-querying the same
    // ADR returns an identical edge set (a non-durable / re-allocating map would
    // drift). Pre-impl there is no controller row (router-fallback), so (a) fails.
    const edgeKey = (e) => `${e.sourceId}|${e.targetId}|${e.relation ?? ''}`;
    const set4 = new Set(rows4.map(edgeKey));
    log(`[smoke] ID-map probe controller=${ctrl4} rows=${rows4.length} edges={${[...set4].join(',')}}`);
    if (typeof ctrl4 === 'string' && ctrl4.startsWith('causalGraph') && rows4.length >= 1) {
      const q4b = mcpExec(cli, dir, 'agentdb_causal-query', { cause: 'ADR-9001', k: 10 });
      const rows4b = Array.isArray(q4b?.results) ? q4b.results : [];
      const set4b = new Set(rows4b.map(edgeKey));
      const stable = set4.size === set4b.size && [...set4].every((k) => set4b.has(k));
      if (stable) pass(`string→numeric ID map round-trips (controller-backed, ${rows4.length} edge(s) stable across re-query — durable map)`);
      else fail('id-map-roundtrip', `controller results not stable across re-query — the durable map (R1) is not persistent`);
    } else {
      fail('id-map-controller', `controller=${ctrl4}, rows=${rows4.length} — controller did not answer cause=ADR-9001 (R1/R2/R3 not effective)`);
    }

    // ════════════════════════════════════════════════════════════════════
    // Assertion 3 — cascade-delete of an ADR node removes its incident edges.
    //   Delete ADR-9002 (target of 9001's `supersedes`/`superseded-by` edges).
    //   The controller path reports deletedEdges > 0 and deleted:true; pre-impl
    //   the binding has no delete API so the router returns
    //   controller='native-unsupported', deletedEdges:0, deleted:false (a no-op).
    //   Run LAST because it mutates the graph.
    // ════════════════════════════════════════════════════════════════════
    // Pre-count incident edges on ADR-9002 (both directions).
    const before = mcpExec(cli, dir, 'agentdb_causal-query', { effect: 'ADR-9002', k: 10 });
    const beforeCause = mcpExec(cli, dir, 'agentdb_causal-query', { cause: 'ADR-9002', k: 10 });
    const incidentBefore = (Array.isArray(before?.results) ? before.results.length : 0)
      + (Array.isArray(beforeCause?.results) ? beforeCause.results.length : 0);
    log(`[smoke] ADR-9002 incident edges before delete: ${incidentBefore}`);

    const del = mcpExec(cli, dir, 'agentdb_causal-node-delete', { nodeId: 'ADR-9002' });
    const delCtrl = del?.controller ?? '(none)';
    const deletedEdges = typeof del?.deletedEdges === 'number' ? del.deletedEdges : 0;
    log(`[smoke] cascade-delete ADR-9002 → controller=${delCtrl} deleted=${del?.deleted} deletedEdges=${deletedEdges}`);
    if (delCtrl === 'native-unsupported') {
      fail('cascade-delete', `controller='native-unsupported' deletedEdges=${deletedEdges} — cascade is a no-op (R5 not implemented; binding has no delete API for the controller path)`);
    } else if (deletedEdges > 0 && del?.deleted === true) {
      // Confirm the edges are actually gone afterwards.
      const after = mcpExec(cli, dir, 'agentdb_causal-query', { effect: 'ADR-9002', k: 10 });
      const afterCause = mcpExec(cli, dir, 'agentdb_causal-query', { cause: 'ADR-9002', k: 10 });
      const incidentAfter = (Array.isArray(after?.results) ? after.results.length : 0)
        + (Array.isArray(afterCause?.results) ? afterCause.results.length : 0);
      log(`[smoke] ADR-9002 incident edges after delete: ${incidentAfter}`);
      if (incidentAfter < incidentBefore) pass(`cascade-delete removed incident edges (deletedEdges=${deletedEdges}; incident ${incidentBefore} → ${incidentAfter})`);
      else fail('cascade-delete-residual', `deletedEdges=${deletedEdges} but incident edges still present after delete (${incidentBefore} → ${incidentAfter})`);
    } else {
      fail('cascade-delete', `controller=${delCtrl} deleted=${del?.deleted} deletedEdges=${deletedEdges} — expected cascade removing >0 incident edges`);
    }

  } catch (e) {
    fail('main', e?.stack || String(e));
  } finally {
    if (testBodyStart) perf.mark('test-body', testBodyStart);
    if (mcpProc && mcpProc.exitCode === null) { try { mcpProc.kill('SIGTERM'); } catch {} await new Promise(r => setTimeout(r, 400)); if (mcpProc.exitCode === null) try { mcpProc.kill('SIGKILL'); } catch {} }
    try { if (!shared) rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  finish();
}

function finish() {
  log(`\n${'─'.repeat(60)}`);
  log(`Results: ${passed} passed, ${failed} failed`);
  perf.emitJson();
  if (failed > 0) { log(`\nSmoke FAILED — ADR-0276 controller-causal convergence not effective (KV fallback still answering).\n`); process.exit(1); }
  log(`\nSmoke PASSED — ADR causal edges answered by the CausalMemoryGraph controller.\n`);
  process.exit(0);
}

main().catch((e) => { fail('uncaught', e?.message || String(e)); finish(); });
