#!/usr/bin/env node
/**
 * ADR-0176 smoke — `agentdb_hierarchical-query` globs the stored KEY, not the
 * value/content blob (the 2026-05-30 amendment fix).
 *
 * WHY a dedicated smoke when adr0178-hquery-e2e already exists:
 *   adr0178's store helper writes `value == path` (key == content), so its
 *   `adr/*` queries pass EVEN against the pre-fix code that globbed the
 *   `content` column. It cannot discriminate the bug. This smoke stores a
 *   record whose KEY is `adr/...` but whose VALUE/content is a distinct blob
 *   that does NOT start with `adr/`, so:
 *     • pre-fix  (WHERE content LIKE 'adr/%')                 → 0 results  (FAIL)
 *     • post-fix (WHERE json_extract(metadata,'$.key') LIKE…) → 1 result  (PASS)
 *   plus a negative control proving it does NOT match on content.
 *
 * Surfaces: agentdb_hierarchical-store + agentdb_hierarchical-query via
 * `cli mcp exec`. The hierarchical store is SQLite (WAL, lock-free) so this
 * smoke is independent of the RVF flock (ADR-0267/0274).
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
const LOG_FILE = join(LOG_DIR, `smoke-adr0176-query-key-${process.pid}.log`);
const perf = createSmokePerf('smoke-adr0176-query-key');

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
  // Find the first {...} JSON object in the body.
  const start = body.indexOf('{');
  if (start < 0) return null;
  let obj;
  try {
    obj = JSON.parse(body.slice(start));
  } catch {
    // tolerate trailing noise — try line-by-line
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
  log(`\n[ADR-0176 smoke] hierarchical-query globs stored key, not content blob`);
  log(`[smoke] log: ${LOG_FILE}\n`);

  const { dir } = setupSmokeTempDir('adr0176-query-key', perf, REGISTRY);
  let cli = findCli(dir);
  if (!cli) {
    // No shared install — provision our own (slow path).
    cli = installAndInit(dir, perf, REGISTRY);
  }
  if (!cli) { fail('setup', 'cli not found'); return finish(); }

  const ts = Date.now();
  const key = `adr/SMOKE-0176-${ts}-001`;
  const valueBlob = `zzz-value-blob-${ts}`;            // distinct; does NOT start with 'adr/'
  const keyGlob = `adr/SMOKE-0176-${ts}-*`;            // matches the KEY only
  const contentGlob = `zzz-value-blob-${ts}*`;         // matches the VALUE/content only

  // ── Store: key is a path, value/content is a distinct non-path blob ──
  const storeRaw = mcpExec(cli, dir, 'agentdb_hierarchical-store', { key, value: valueBlob, tier: 'working' });
  const storeObj = parseResult(storeRaw);
  if (storeObj && storeObj.__toolNotFound) {
    fail('store', `agentdb_hierarchical-store not registered — published build predates ADR-0176. Raw: ${storeRaw.slice(0, 200)}`);
    return finish();
  }
  pass('store: agentdb_hierarchical-store accepted key≠content record');

  // ── Positive: query by KEY glob → the FIX returns 1; pre-fix returns 0 ──
  const qKeyObj = parseResult(mcpExec(cli, dir, 'agentdb_hierarchical-query', { pathPattern: keyGlob }));
  const nKey = countResults(qKeyObj);
  if (qKeyObj && qKeyObj.__toolNotFound) {
    fail('query-key', 'agentdb_hierarchical-query not registered — published build predates ADR-0176 Phase 3');
    return finish();
  }
  if (nKey === null) {
    fail('query-key', `no results[] array in response: ${JSON.stringify(qKeyObj).slice(0, 300)}`);
  } else if (nKey >= 1) {
    pass(`query-key: glob '${keyGlob}' → ${nKey} result(s) (globs metadata.key — the ADR-0176 fix)`);
  } else {
    fail('query-key', `glob '${keyGlob}' returned 0 — query is NOT globbing the stored key (pre-fix content-glob behaviour). This is the ADR-0176 regression.`);
  }

  // ── Negative control: query by CONTENT-blob glob → must be 0 under the fix
  //    (key, not content, is what's globbed). Pre-fix would return 1 here. ──
  const qContentObj = parseResult(mcpExec(cli, dir, 'agentdb_hierarchical-query', { pathPattern: contentGlob }));
  const nContent = countResults(qContentObj);
  if (nContent === null) {
    fail('query-content-negative', `no results[] array: ${JSON.stringify(qContentObj).slice(0, 300)}`);
  } else if (nContent === 0) {
    pass(`query-content-negative: glob '${contentGlob}' → 0 (does NOT match on content blob — confirms key-glob, not content-glob)`);
  } else {
    fail('query-content-negative', `glob '${contentGlob}' returned ${nContent} — query is matching the CONTENT column (pre-fix behaviour), not the key.`);
  }

  finish();
}

function finish() {
  perf.emitJson();
  log(`\n[ADR-0176 smoke] ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { fail('main', e?.stack || String(e)); finish(); });
