#!/usr/bin/env node
/**
 * Smoke: three agentdb-CLI-surface honesty fixes found during the ADR-0281
 * index remediation, exercised end-to-end via `cli mcp exec` / `agentdb index`
 * against the shared ACCEPT_TEMP install:
 *
 *   G1 (ADR-0282) — `agentdb_hierarchical-query` honors an explicit `limit`.
 *       Store 101 records, query with limit:200 → expect 101. PRE-FIX the
 *       handler clamped any limit>100 to MAX_TOP_K=100 (a path-enumeration tool
 *       whose schema says "default: unlimited" silently capped to 100).
 *
 *   G2 (ADR-0276) — `agentdb_causal-edge-delete` clears the KV dual-write copy.
 *       Store edge → query 1 → delete (controller "causalGraph+kv", kvDeleted≥1)
 *       → query 0. PRE-FIX the SQLite row was deleted but the KV copy survived,
 *       so causal-query resurrected the edge via "router-fallback".
 *
 *   G3 (ADR-0273) — `agentdb index --dry-run` does not mutate.
 *       Index a synthetic ADR with --dry-run → the record is NOT written. PRE-FIX
 *       `--dry-run` (kebab key never read; parser stores camelCase `dryRun`)
 *       performed the full write.
 *
 * FAIL pre-impl, PASS post-impl. Reuses ACCEPT_TEMP via ADR0255_SMOKE_SHARED_TEMP;
 * standalone self-installs from Verdaccio.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSmokePerf,
  setupSmokeTempDir,
  installAndInit,
  findCli,
} from './lib/smoke-adr0255-shared.mjs';

const REGISTRY = process.env.REGISTRY || 'http://localhost:4873';
const LOG_DIR = process.env.SMOKE_LOG_DIR || '/tmp';
const LOG_FILE = join(LOG_DIR, `smoke-adr0282-agentdb-surface-fixes-${process.pid}.log`);
const perf = createSmokePerf('smoke-adr0282-agentdb-surface-fixes');

let passed = 0, failed = 0;
function log(m) { process.stderr.write(`${m}\n`); try { appendFileSync(LOG_FILE, `${m}\n`); } catch {} }
function pass(l) { passed++; log(`  PASS  ${l}`); }
function fail(l, r) { failed++; log(`  FAIL  ${l}: ${r}`); }

function extractBalanced(s, from = 0) {
  const start = s.indexOf('{', from); if (start < 0) return null;
  let d = 0, q = false, e = false;
  for (let i = start; i < s.length; i++) { const c = s[i];
    if (q) { if (e) e = false; else if (c === '\\') e = true; else if (c === '"') q = false; }
    else if (c === '"') q = true; else if (c === '{') d++; else if (c === '}') { d--; if (d === 0) return s.slice(start, i + 1); } }
  return null;
}
function parse(raw) {
  if (/tool.+not found|not registered|unknown tool|no such tool|method .* not found|invalid tool/i.test(raw)) return { __toolNotFound: true };
  let body = raw; const idx = raw.search(/^Result:/m); if (idx >= 0) body = body.slice(idx).replace(/^Result:/m, '');
  const j = extractBalanced(body, 0); if (!j) return null;
  try { let o = JSON.parse(j); if (o && Array.isArray(o.content) && o.content[0]?.text) { try { o = JSON.parse(o.content[0].text); } catch {} } return o; } catch { return null; }
}
function mcpExec(cli, dir, tool, params) {
  const r = spawnSync(cli, ['mcp', 'exec', '--tool', tool, '--params', JSON.stringify(params)],
    { cwd: dir, encoding: 'utf8', timeout: 45000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY } });
  return `${r.stdout || ''}\n${r.stderr || ''}`;
}
const count = (o) => (o && Array.isArray(o.results)) ? o.results.length : null;

// ADR-0282 perf: store/delete the 101 limit-probe records via ONE in-process
// helper run (boots agentdb controllers once) instead of 101 cold `cli mcp exec`
// spawns per phase. The helper uses the SAME callMCPTool('agentdb_hierarchical-
// store'/'-delete') entry point + cwd, so the writes land in the SAME
// `.swarm/memory.db` store the G1 query (still a `cli mcp exec`) reads. Returns
// the number actually written/deleted (parsed from `BULK-<MODE> <ok>/<count>`)
// so a partial store still fails G1-store loud (no silent fallback).
const BULK_HELPER = join(fileURLToPath(new URL('.', import.meta.url)), 'lib', 'adr0282-hierarchical-bulk.mjs');
function bulkHierarchical(dir, mode, prefix, n) {
  const r = spawnSync(process.execPath, [BULK_HELPER, mode, prefix, String(n)],
    { cwd: dir, encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY } });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const m = out.match(new RegExp(`BULK-${mode.toUpperCase()}\\s+(\\d+)/(\\d+)`));
  return m ? Number(m[1]) : 0;
}

async function main() {
  log(`\n[ADR-0282/0276/0273 smoke] agentdb CLI surface fixes — limit, causal-edge KV, dry-run`);
  log(`[smoke] log: ${LOG_FILE}\n`);

  const { dir } = setupSmokeTempDir('adr0282-agentdb-fixes', perf, REGISTRY);
  let cli = findCli(dir);
  if (!cli) cli = installAndInit(dir, perf, REGISTRY);
  if (!cli) { fail('setup', 'cli not found'); return finish(); }

  const ts = Date.now();

  // ── G1 (ADR-0282): hierarchical-query honors an explicit limit > 100 ──
  const lp = `limitprobe-${ts}`;
  const stored = bulkHierarchical(dir, 'store', lp, 101);
  log(`[smoke] G1 stored ${stored}/101 limit-probe records`);
  if (stored < 101) { fail('G1-store', `only ${stored}/101 stored`); }
  else {
    const q = parse(mcpExec(cli, dir, 'agentdb_hierarchical-query', { pathPattern: `${lp}/*`, limit: 200 }));
    if (q?.__toolNotFound) { fail('G1', 'hierarchical-query not registered'); }
    else {
      const n = count(q);
      if (n === 101) pass(`G1 (ADR-0282) limit honored: query limit:200 over 101 records → 101 (pre-fix clamped to 100)`);
      else if (n === 100) fail('G1', `query returned 100 — limit still clamped to MAX_TOP_K (ADR-0282 not effective)`);
      else fail('G1', `expected 101, got ${n}`);
    }
  }
  // cleanup G1 probes (single in-process bulk delete; teardown is best-effort)
  bulkHierarchical(dir, 'delete', lp, 101);

  // ── G2 (ADR-0276): causal-edge-delete clears the KV copy ──
  const cA = `ADR-92X-${ts}`, cB = `ADR-92Y-${ts}`;
  const ce = parse(mcpExec(cli, dir, 'agentdb_causal-edge', { sourceId: cA, targetId: cB, relation: 'supersedes', weight: 1 }));
  if (ce?.__toolNotFound) { fail('G2', 'causal-edge not registered'); }
  else if (ce?.success === false) { fail('G2-store', JSON.stringify(ce).slice(0, 160)); }
  else {
    const before = parse(mcpExec(cli, dir, 'agentdb_causal-query', { cause: cA, k: 10 }));
    const nb = (Array.isArray(before?.results) ? before.results : Array.isArray(before?.edges) ? before.edges : []).length;
    const del = parse(mcpExec(cli, dir, 'agentdb_causal-edge-delete', { sourceId: cA, targetId: cB, relation: 'supersedes' }));
    if (del?.controller === 'native-unsupported') { fail('G2', 'causal-edge-delete native-unsupported'); }
    else if (del?.deleted !== true) { fail('G2-delete', `expected deleted:true, got ${JSON.stringify(del).slice(0, 160)}`); }
    else {
      const after = parse(mcpExec(cli, dir, 'agentdb_causal-query', { cause: cA, k: 10 }));
      const na = (Array.isArray(after?.results) ? after.results : Array.isArray(after?.edges) ? after.edges : []).length;
      if (nb >= 1 && na === 0) pass(`G2 (ADR-0276) causal-edge KV cleared: query ${nb}→0 after delete (controller=${del.controller}, kvDeleted=${del.kvDeleted}); no router-fallback resurrection`);
      else fail('G2', `before=${nb} after=${na} (expected ≥1 → 0; nonzero after = KV residual resurrection)`);
    }
  }

  // ── G3 (ADR-0273): agentdb index --dry-run does not mutate ──
  // The indexer derives the ID from the filename ADR-NNNN-<slug>.md → ADR-NNNN,
  // so the stored hierarchical key is `adr/ADR-9273` (the <ts> is slug only).
  const adrDir = join(dir, `dryrun-adr-${ts}`);
  const synthId = 'ADR-9273';
  const probeKey = `adr/${synthId}`;
  mkdirSync(adrDir, { recursive: true });
  writeFileSync(join(adrDir, `${synthId}-dryrun-probe-${ts}.md`),
    `---\nstatus: accepted\ndate: 2026-05-31\ntags: [smoke]\nsupersedes: []\ndepends-on: []\nimplements: []\n---\n# Dry-run probe ${synthId}\n\n## Context and Problem Statement\n\nSynthetic ADR for the ADR-0273 dry-run smoke; --dry-run must not write it.\n`);
  const idx = (extra) => spawnSync(cli, ['agentdb', 'index', '--dir', adrDir, ...extra],
    { cwd: dir, encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY } });
  const qn = () => count(parse(mcpExec(cli, dir, 'agentdb_hierarchical-query', { pathPattern: probeKey })));
  const base = qn();
  const rDry = idx(['--dry-run']);
  const dryOut = `${rDry.stdout || ''}\n${rDry.stderr || ''}`;
  if (/Unknown command|not found/i.test(dryOut) && /agentdb/i.test(dryOut) && !/index complete|dry-run/i.test(dryOut)) {
    fail('G3', 'agentdb index not registered');
  } else if (base !== 0) {
    fail('G3-baseline', `probe key ${probeKey} already present (${base}) before dry-run — contaminated temp`);
  } else {
    const afterDry = qn();
    idx([]);                 // positive control: a real index DOES write the record
    const afterReal = qn();
    if (afterDry === 0 && afterReal >= 1) pass(`G3 (ADR-0273) --dry-run inert: ${synthId} NOT written by --dry-run (query 0), real index DOES write it (query ${afterReal})`);
    else if (afterDry > 0) fail('G3', `--dry-run wrote ${synthId} (query → ${afterDry}; expected 0)`);
    else fail('G3-control', `real index did not write ${synthId} (afterReal=${afterReal}) — setup issue, dry-run "0" is not a valid pass`);
    mcpExec(cli, dir, 'agentdb_hierarchical-delete', { key: probeKey }); // cleanup
  }
  try { rmSync(adrDir, { recursive: true, force: true }); } catch {}

  finish();
}

function finish() {
  perf.emitJson();
  log(`\n[ADR-0282/0276/0273 smoke] ${passed} passed, ${failed} failed`);
  if (failed > 0) { log(`\nSmoke FAILED — one or more agentdb surface fixes not effective.\n`); process.exit(1); }
  log(`\nSmoke PASSED — limit honored (ADR-0282), causal-edge KV cleared (ADR-0276), dry-run inert (ADR-0273).\n`);
  process.exit(0);
}

main().catch((e) => { fail('uncaught', e?.stack || String(e)); finish(); });
