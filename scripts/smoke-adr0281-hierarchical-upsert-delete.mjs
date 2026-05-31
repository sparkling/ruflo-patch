#!/usr/bin/env node
/**
 * ADR-0281 smoke — the hierarchical-* keyed contract, end-to-end via `cli mcp
 * exec` against the shared ACCEPT_TEMP install:
 *
 *   1. agentdb_hierarchical-store  key=adr/SMOKE-0281-<ts>-001  (TWICE, distinct values)
 *   2. agentdb_hierarchical-query  adr/SMOKE-0281-<ts>-*        → exactly 1 (keyed UPSERT)
 *   3. agentdb_hierarchical-delete adr/SMOKE-0281-<ts>-001      → deleted:true (real delete, '/' accepted)
 *   4. agentdb_hierarchical-query  adr/SMOKE-0281-<ts>-*        → 0           (delete-by-key works)
 *
 * WHY THIS FAILS PRE-IMPL:
 *   • store() was append-only → step 2 returns 2 (a re-store duplicated the key).
 *   • delete had no controller method → controller:"native-unsupported", deleted:false,
 *     and the MCP handler rejected '/' via validateIdentifier before reaching the backend.
 *   After ADR-0281 (keyed upsert + delete(key) + relaxed key validation): 1 / deleted / 0.
 *
 * The hierarchical store is SQLite (WAL, lock-free, persisted to .swarm/memory.db),
 * so the cross-process store→query→delete chain is independent of the RVF flock
 * (ADR-0267/0274). Reuses the ACCEPT_TEMP install via ADR0255_SMOKE_SHARED_TEMP;
 * standalone self-installs from Verdaccio. FAIL pre-impl, PASS post-impl.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createSmokePerf,
  setupSmokeTempDir,
  installAndInit,
  findCli,
} from './lib/smoke-adr0255-shared.mjs';

const REGISTRY = process.env.REGISTRY || 'http://localhost:4873';
const LOG_DIR = process.env.SMOKE_LOG_DIR || '/tmp';
const LOG_FILE = join(LOG_DIR, `smoke-adr0281-hierarchical-upsert-delete-${process.pid}.log`);
const perf = createSmokePerf('smoke-adr0281-hierarchical-upsert-delete');

let passed = 0;
let failed = 0;
function log(msg) {
  process.stderr.write(`${msg}\n`);
  try { appendFileSync(LOG_FILE, `${msg}\n`); } catch {}
}
function pass(label) { passed++; log(`  PASS  ${label}`); }
function fail(label, reason) { failed++; log(`  FAIL  ${label}: ${reason}`); }

function mcpExec(cli, dir, tool, params) {
  const r = spawnSync(cli, ['mcp', 'exec', '--tool', tool, '--params', JSON.stringify(params)], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 45000,
    env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY },
  });
  return `${r.stdout || ''}\n${r.stderr || ''}`;
}

/** Parse a `cli mcp exec` response: take the body after `Result:`, unwrap a
 *  {content:[{text}]} envelope if present, return the parsed object or null. */
function parseResult(raw) {
  if (/tool.+not found|not registered|unknown tool|no such tool|method .* not found|invalid tool/i.test(raw)) {
    return { __toolNotFound: true };
  }
  let body = raw;
  const idx = raw.search(/^Result:/m);
  if (idx >= 0) body = raw.slice(idx).replace(/^Result:/m, '');
  const start = body.indexOf('{');
  if (start < 0) return null;
  let obj;
  try {
    obj = JSON.parse(body.slice(start));
  } catch {
    for (const line of body.split(/\n/)) {
      const s = line.indexOf('{');
      if (s < 0) continue;
      try { obj = JSON.parse(line.slice(s)); break; } catch { /* keep trying */ }
    }
    if (!obj) return null;
  }
  if (obj && Array.isArray(obj.content) && obj.content[0] && typeof obj.content[0].text === 'string') {
    try { obj = JSON.parse(obj.content[0].text); } catch { /* leave as-is */ }
  }
  return obj;
}

function countResults(obj) {
  if (!obj || obj.__toolNotFound) return null;
  if (Array.isArray(obj.results)) return obj.results.length;
  return null;
}

async function main() {
  log(`\n[ADR-0281 smoke] hierarchical keyed upsert + delete-by-key`);
  log(`[smoke] log: ${LOG_FILE}\n`);

  const { dir } = setupSmokeTempDir('adr0281-hierarchical-upsert-delete', perf, REGISTRY);
  let cli = findCli(dir);
  if (!cli) cli = installAndInit(dir, perf, REGISTRY); // no shared install — slow path
  if (!cli) { fail('setup', 'cli not found'); return finish(); }

  const ts = Date.now();
  const key = `adr/SMOKE-0281-${ts}-001`;       // contains '/' — exercises R3 (key validation)
  const glob = `adr/SMOKE-0281-${ts}-*`;
  const v1 = `zz-first-${ts}`;
  const v2 = `zz-second-${ts}`;                  // latest write — should win the upsert

  // ── Step 1: store the SAME key twice with distinct values. ──
  const s1 = parseResult(mcpExec(cli, dir, 'agentdb_hierarchical-store', { key, value: v1, tier: 'semantic' }));
  if (s1 && s1.__toolNotFound) {
    fail('store', 'agentdb_hierarchical-store not registered — published build predates the hierarchical-* surface');
    return finish();
  }
  const s2 = parseResult(mcpExec(cli, dir, 'agentdb_hierarchical-store', { key, value: v2, tier: 'semantic' }));
  if (!s1?.success || !s2?.success) {
    fail('store', `both stores must succeed; got s1=${JSON.stringify(s1).slice(0, 150)} s2=${JSON.stringify(s2).slice(0, 150)}`);
    return finish();
  }
  pass('store: agentdb_hierarchical-store accepted the same key twice');

  // ── Step 2: query the key glob → keyed UPSERT means exactly 1 (not 2). ──
  const q1 = parseResult(mcpExec(cli, dir, 'agentdb_hierarchical-query', { pathPattern: glob }));
  const n1 = countResults(q1);
  if (q1 && q1.__toolNotFound) {
    fail('query-upsert', 'agentdb_hierarchical-query not registered');
    return finish();
  }
  if (n1 === null) {
    fail('query-upsert', `no results[] array: ${JSON.stringify(q1).slice(0, 300)}`);
    return finish();
  } else if (n1 === 1) {
    pass(`upsert: re-storing key '${key}' kept exactly 1 entry (append-only would be 2) — /adr-index is now idempotent`);
    // Secondary guarantee: latest write wins (content == v2). Only checked when
    // the query result carries content; never a false-negative on shape drift.
    const content = q1.results?.[0]?.content;
    if (typeof content === 'string') {
      if (content === v2) pass(`upsert: latest write wins (surviving content == "${v2}")`);
      else fail('upsert-latest', `expected surviving content "${v2}", got "${content}"`);
    }
  } else {
    fail('query-upsert', `key glob '${glob}' returned ${n1} entries — store is appending, not upserting (the ADR-0281 dedup gap). un-removable duplicates.`);
    return finish();
  }

  // ── Step 3: delete by key → real delete (not native-unsupported), '/' accepted. ──
  const d = parseResult(mcpExec(cli, dir, 'agentdb_hierarchical-delete', { key }));
  if (d && d.__toolNotFound) {
    fail('delete', 'agentdb_hierarchical-delete not registered');
    return finish();
  }
  if (d?.controller === 'native-unsupported') {
    fail('delete', `controller=native-unsupported — HierarchicalMemory has no delete() method (the ADR-0281 R1 gap)`);
    return finish();
  }
  if (d?.success === false) {
    fail('delete', `delete rejected the '/' key (R3 validation gap) or errored: ${JSON.stringify(d).slice(0, 200)}`);
    return finish();
  }
  if (d?.deleted === true) {
    pass(`delete: agentdb_hierarchical-delete '${key}' removed the entry (controller=${d.controller}, '/' accepted)`);
  } else {
    fail('delete', `expected deleted:true; got ${JSON.stringify(d).slice(0, 200)}`);
    return finish();
  }

  // ── Step 4: query again → 0 (delete-by-key actually removed it). ──
  const q2 = parseResult(mcpExec(cli, dir, 'agentdb_hierarchical-query', { pathPattern: glob }));
  const n2 = countResults(q2);
  if (n2 === 0) {
    pass(`delete: key glob '${glob}' → 0 after delete (delete-by-key works end-to-end)`);
  } else {
    fail('query-post-delete', `expected 0 after delete; got ${n2 === null ? JSON.stringify(q2).slice(0, 200) : n2}`);
  }

  finish();
}

function finish() {
  perf.emitJson();
  log(`\n[ADR-0281 smoke] ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    log(`\nSmoke FAILED — the hierarchical-* keyed contract is incomplete (append-only store, no delete-by-key, or '/'-rejecting validation).\n`);
    process.exit(1);
  }
  log(`\nSmoke PASSED — ADR-0281 WIRED: store is keyed-upsert (one entry per key), delete-by-key works (incl. '/' keys), /adr-index is safe to re-run.\n`);
  process.exit(0);
}

main().catch((e) => { fail('main', e?.stack || String(e)); finish(); });
