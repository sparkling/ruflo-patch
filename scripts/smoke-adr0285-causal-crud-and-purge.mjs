#!/usr/bin/env node
/**
 * ADR-0285 smoke — repair the ADR-index causal + recall surfaces and complete
 * `--purge`. Drives everything through `cli mcp exec` / `agentdb index` against
 * the shared ACCEPT_TEMP install (an init'd ruflo project — the SQLite causal
 * carve-out refuses a markerless cwd, ADR-0069 Bug #3). Four assertion blocks,
 * one per `### Confirmation` item:
 *
 *   A1 — Causal CRUD round-trip (P3/P7/P5/P4):
 *        • create an edge between two '/'-bearing ids (adr/SMOKE-… → adr/SMOKE-…)
 *          → success:true   (P3: today regresses to `no such savepoint:
 *          staging_agentdb_causal_edge_N`)
 *        • causal-query that cause → count >= 1   (P7: today 0 via router-fallback)
 *        • causal-edge-delete the SAME '/'-bearing ids → deleted/success
 *          (P5: today rejects '/' with "sourceId contains invalid characters" —
 *          asymmetric with create, which ACCEPTS '/')
 *        • causal-node-delete a '/'-bearing nodeId → success
 *          (P4: today rejects '/' the same way; the deeper form is
 *          `sql-error: tried to bind a value of an unknown type (undefined)`)
 *
 *   A2 — Recall is non-erroring (P6): after storing a probe record,
 *        agentdb_hierarchical-recall AND agentdb_causal-recall return
 *        success:true with a results[] array — NOT {success:false,
 *        error:"Internal error"}.
 *
 *   A3 — Purge idempotency on edges (P1/P2): a small synthetic ADR corpus
 *        (high ADR-95xx ids → no collision with the real 0001-0284 corpus that
 *        references each other) is indexed with `--purge` TWICE; the reported
 *        edge count must be IDENTICAL across both runs (not growing — the SQLite
 *        `causal_edges` duplication P1 manifests as a climbing edge total) and
 *        the hierarchical record count must stay constant (no record dup).
 *
 *   A4 — Reindex completion + reconciliation (P8): the `--purge` run exits 0 and
 *        its summary line — `… complete: N/N hierarchical records, M adr-patterns,
 *        E edges + E inverses` — reconciles: hierarchical == adr-patterns ==
 *        the synthetic ADR count, and edges == inverses.
 *
 * WHY THIS FAILS PRE-FIX:
 *   The two causal DELETE handlers gate ids through `validateIdentifier`'s charset
 *   (no '/') while the CREATE handler accepts '/', so A1c + A1d reject the same
 *   '/'-bearing ids create just accepted — a deterministic asymmetry that holds at
 *   the published baseline. After ADR-0285 drops that charset gate on the delete
 *   handlers (mirroring ADR-0281 R3) and fixes the causal write/recall/purge
 *   surfaces, all four blocks pass. The smoke is reachable alongside a LIVE MCP
 *   server (re-validates the ADR-0274/0284 concurrent-index promise).
 *
 * Reuses the ACCEPT_TEMP install via ADR0255_SMOKE_SHARED_TEMP; standalone
 * self-installs from Verdaccio. FAIL pre-impl, PASS post-impl.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  createSmokePerf,
  setupSmokeTempDir,
  installAndInit,
  findCli,
} from './lib/smoke-adr0255-shared.mjs';

const REGISTRY = process.env.REGISTRY || 'http://localhost:4873';
const LOG_DIR = process.env.SMOKE_LOG_DIR || '/tmp';
const LOG_FILE = join(LOG_DIR, `smoke-adr0285-causal-crud-and-purge-${process.pid}.log`);
const perf = createSmokePerf('smoke-adr0285-causal-crud-and-purge');

let passed = 0;
let failed = 0;
function log(msg) {
  process.stderr.write(`${msg}\n`);
  try { appendFileSync(LOG_FILE, `${msg}\n`); } catch {}
}
function pass(label) { passed++; log(`  PASS  ${label}`); }
function fail(label, reason) { failed++; log(`  FAIL  ${label}: ${reason}`); }

/** Extract the first balanced {...} object from `s` (ignores braces inside
 *  strings). Robust to pretty-printed multi-line JSON AND any trailing
 *  daemon/stderr output after the object. */
function extractBalanced(s, from = 0) {
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

/** Parse a `cli mcp exec` response: take the body after `Result:`, extract the
 *  balanced JSON object, unwrap a {content:[{text}]} envelope if present. */
function parseResult(raw) {
  if (/tool.+not found|not registered|unknown tool|no such tool|method .* not found|invalid tool/i.test(raw)) {
    return { __toolNotFound: true };
  }
  let body = raw;
  const idx = raw.search(/^Result:/m);
  if (idx >= 0) body = raw.slice(idx).replace(/^Result:/m, '');
  const json = extractBalanced(body, 0);
  if (json === null) return null;
  let obj;
  try { obj = JSON.parse(json); } catch { return null; }
  if (obj && Array.isArray(obj.content) && obj.content[0] && typeof obj.content[0].text === 'string') {
    try { obj = JSON.parse(obj.content[0].text); } catch { /* leave as-is */ }
  }
  return obj;
}

function mcpExec(cli, dir, tool, params) {
  const r = spawnSync(cli, ['mcp', 'exec', '--tool', tool, '--params', JSON.stringify(params)], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 45000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY },
  });
  return parseResult(`${r.stdout || ''}\n${r.stderr || ''}`);
}

/** Count results[] in a tool response (causal-query/recall use results[]). */
function countResults(obj) {
  if (!obj || obj.__toolNotFound) return null;
  if (Array.isArray(obj.results)) return obj.results.length;
  if (Array.isArray(obj.edges)) return obj.edges.length;
  return null;
}

function adrDoc(id, fm, title) {
  return `---\n${fm}\n---\n# ${title}\n\n## Context and Problem Statement\n\nSynthetic ADR ${id} for the ADR-0285 purge/reconciliation smoke. It validates that --purge is idempotent on the causal edge surface and the reindex reconciles all surfaces.\n`;
}

/** Parse the `agentdb index complete:` summary line into counts. Matches
 *  "… complete: 3/3 hierarchical records, 3 adr-patterns, 2 edges + 2 inverses". */
function parseIndexSummary(combined) {
  const line = (combined.split(/\n/).find((l) => /agentdb index complete:/i.test(l)) || '');
  const m = line.match(/complete:\s*(\d+)\s*\/\s*(\d+)\s*hierarchical records,\s*(\d+)\s*adr-patterns,\s*(\d+)\s*edges\s*\+\s*(\d+)\s*inverses/i);
  if (!m) return null;
  return {
    line: line.trim(),
    hierarchical: Number(m[1]),         // N of N/N (written)
    hierarchicalTotal: Number(m[2]),
    adrPatterns: Number(m[3]),
    edges: Number(m[4]),
    inverses: Number(m[5]),
  };
}

async function main() {
  log(`\n[ADR-0285 smoke] causal CRUD round-trip + non-erroring recall + idempotent purge`);
  log(`[smoke] log: ${LOG_FILE}\n`);

  const { dir, shared } = setupSmokeTempDir('adr0285-causal-crud-and-purge', perf, REGISTRY);
  log(`[smoke] temp dir: ${dir}${shared ? ' (shared)' : ''}`);

  let mcpProc = null;
  let testBodyStart;
  try {
    let cli = findCli(dir);
    if (!cli) cli = installAndInit(dir, perf, REGISTRY); // no shared install — slow path
    if (!cli) { fail('setup', 'cli not found'); return finish(dir, shared, mcpProc); }
    testBodyStart = process.hrtime.bigint();

    const ts = Date.now();

    // ── Start a live MCP server + warm it (RVF flock park, ADR-0274) so the
    //    causal writes + reindex run ALONGSIDE a running server (ADR-0274/0284). ──
    mcpProc = spawn(cli, ['mcp', 'start'], { cwd: dir, env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY }, stdio: ['pipe', 'pipe', 'pipe'] });
    let sb = '';
    mcpProc.stdout.on('data', (c) => { sb += c.toString(); });
    mcpProc.stderr.on('data', (c) => log(`  [mcp.stderr] ${c.toString().replace(/\n/g, ' | ').slice(0, 200)}`));
    mcpProc.on('exit', (code) => log(`[mcp.exit] code=${code}`));
    mcpProc.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'adr0285', version: '0' } } }) + '\n' +
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'memory_search', arguments: { query: 'adr0285-warmup', limit: 1 } } }) + '\n');
    { const t = Date.now(); while (Date.now() - t < 15000) { await new Promise(r => setTimeout(r, 250)); if (/"id":\s*2[,}]/.test(sb)) break; if (mcpProc.exitCode !== null) break; } }
    log(`[smoke] MCP warmed (or settled); running causal CRUD + reindex alongside it\n`);

    // ════════════════════════════════════════════════════════════════════
    // A1 — Causal CRUD round-trip (P3 create / P7 query / P5 edge-delete /
    //      P4 node-delete), all with '/'-bearing ids so the delete handlers'
    //      charset gate (the defect) is exercised symmetrically with create.
    // ════════════════════════════════════════════════════════════════════
    const sA = `adr/SMOKE-0285-${ts}-A`;
    const sB = `adr/SMOKE-0285-${ts}-B`;

    // A1a (P3): create the edge. Today the savepoint counter desyncs →
    // `no such savepoint: staging_agentdb_causal_edge_N`.
    const ce = mcpExec(cli, dir, 'agentdb_causal-edge', { sourceId: sA, targetId: sB, relation: 'depends-on', weight: 1 });
    if (ce?.__toolNotFound) {
      fail('A1a-create', 'agentdb_causal-edge not registered — published build predates the causal-* surface');
      return finish(dir, shared, mcpProc);
    }
    if (ce?.success === true) {
      pass(`A1a (P3) causal-edge create accepted '/'-bearing ids (${sA} → ${sB}; no SAVEPOINT desync; controller=${ce.controller})`);
    } else {
      fail('A1a-create', `causal-edge create failed for '/'-bearing ids (P3 SAVEPOINT/bind desync): ${JSON.stringify(ce).slice(0, 220)}`);
      // continue — A1b/c still inform the failure surface, but query/delete need the edge
    }

    // A1b (P7): query the cause → the edge must come back (count >= 1). Today a
    // valid cause returns 0 via router-fallback (id-resolution mismatch).
    const q = mcpExec(cli, dir, 'agentdb_causal-query', { cause: sA, k: 10 });
    const nq = countResults(q);
    if (q?.__toolNotFound) {
      fail('A1b-query', 'agentdb_causal-query not registered');
    } else if (nq === null) {
      fail('A1b-query', `no results[]/edges[] array: ${JSON.stringify(q).slice(0, 220)}`);
    } else if (nq >= 1) {
      pass(`A1b (P7) causal-query cause='${sA}' returned ${nq} edge(s) (controller=${q.controller ?? '(none)'}; not a router-fallback 0)`);
    } else {
      fail('A1b-query', `causal-query cause='${sA}' returned 0 (P7: id-resolution returns router-fallback 0 for a valid cause), controller=${q.controller ?? '(none)'}`);
    }

    // A1c (P5): delete the edge with the SAME '/'-bearing ids. Today rejected
    // with "sourceId contains invalid characters" — asymmetric with create.
    const ed = mcpExec(cli, dir, 'agentdb_causal-edge-delete', { sourceId: sA, targetId: sB, relation: 'depends-on' });
    if (ed?.__toolNotFound) {
      fail('A1c-edge-delete', 'agentdb_causal-edge-delete not registered');
    } else if (ed?.controller === 'native-unsupported') {
      fail('A1c-edge-delete', `controller=native-unsupported — no delete path`);
    } else if (ed?.success === true || ed?.deleted === true) {
      pass(`A1c (P5) causal-edge-delete accepted the SAME '/'-bearing ids create accepted (deleted=${ed.deleted}, controller=${ed.controller ?? '(none)'}; symmetric key validation, ADR-0281 R3)`);
    } else {
      const why = typeof ed?.error === 'string' ? ed.error : JSON.stringify(ed).slice(0, 220);
      fail('A1c-edge-delete', `causal-edge-delete rejected '/'-bearing ids that create accepted (P5 asymmetric validateIdentifier charset gate): ${why}`);
    }

    // A1d (P4): node-delete a '/'-bearing node id. Today rejected with
    // "nodeId contains invalid characters"; deeper form is the `bind undefined`
    // sql-error. Symmetric-key contract: a node create accepts '/', so delete must.
    const nd = mcpExec(cli, dir, 'agentdb_causal-node-delete', { nodeId: sB });
    if (nd?.__toolNotFound) {
      fail('A1d-node-delete', 'agentdb_causal-node-delete not registered');
    } else if (nd?.success === true || nd?.deletedNode === true || nd?.deleted === true) {
      pass(`A1d (P4) causal-node-delete accepted '/'-bearing nodeId '${sB}' (deletedNode=${nd.deletedNode ?? nd.deleted}, deletedEdges=${nd.deletedEdges ?? 0}; no 'bind undefined' sql-error)`);
    } else {
      const why = typeof nd?.error === 'string' ? nd.error : JSON.stringify(nd).slice(0, 220);
      fail('A1d-node-delete', `causal-node-delete rejected '/'-bearing nodeId (P4: charset gate / 'tried to bind a value of an unknown type (undefined)'): ${why}`);
    }

    // ════════════════════════════════════════════════════════════════════
    // A2 — Recall is non-erroring (P6). Store a probe so recall has something to
    //      find, then BOTH archivist-backed recall surfaces must return
    //      success:true with a results[] array, NOT {success:false,
    //      error:"Internal error"} (memory_search/RVF is fine → the fault is the
    //      shared archivist recall handler common to both).
    // ════════════════════════════════════════════════════════════════════
    const probeKey = `adr/SMOKE-0285-RECALL-${ts}`;
    const probeVal = `deploy the payment service to production safely ${ts}`;
    const sp = mcpExec(cli, dir, 'agentdb_hierarchical-store', { key: probeKey, value: probeVal, tier: 'semantic' });
    if (!sp?.success) {
      fail('A2-probe-store', `could not store recall probe: ${JSON.stringify(sp).slice(0, 200)}`);
    } else {
      const hr = mcpExec(cli, dir, 'agentdb_hierarchical-recall', { query: 'deploy payment service production', k: 5 });
      if (hr?.__toolNotFound) {
        fail('A2-hierarchical-recall', 'agentdb_hierarchical-recall not registered');
      } else if (hr?.success === true && Array.isArray(hr.results)) {
        pass(`A2 (P6) hierarchical-recall non-error (success:true, ${hr.results.length} result(s), controller=${hr.controller ?? '(none)'}) — not "Internal error"`);
      } else {
        const why = typeof hr?.error === 'string' ? hr.error : JSON.stringify(hr).slice(0, 220);
        fail('A2-hierarchical-recall', `hierarchical-recall did not return success+results (P6 shared archivist recall handler errors): ${why}`);
      }

      const cr = mcpExec(cli, dir, 'agentdb_causal-recall', { query: 'deploy payment service production', k: 5 });
      if (cr?.__toolNotFound) {
        fail('A2-causal-recall', 'agentdb_causal-recall not registered');
      } else if (cr?.success === true && Array.isArray(cr.results)) {
        pass(`A2 (P6) causal-recall non-error (success:true, ${cr.results.length} result(s), controller=${cr.controller ?? '(none)'}) — not "Internal error" (un-breaks ADR-0277's recall endpoint)`);
      } else {
        const why = typeof cr?.error === 'string' ? cr.error : JSON.stringify(cr).slice(0, 220);
        fail('A2-causal-recall', `causal-recall did not return success+results (P6 shared archivist recall handler errors): ${why}`);
      }
    }
    // cleanup the probe (best-effort; if delete still rejects '/' that's A1c/d's job)
    mcpExec(cli, dir, 'agentdb_hierarchical-delete', { key: probeKey });

    // ════════════════════════════════════════════════════════════════════
    // A3 + A4 — Purge idempotency on edges (P1/P2) and reindex reconciliation
    //      (P8). Build a small synthetic corpus where ADRs reference each other,
    //      index it with `--purge` TWICE, and assert:
    //        A4: each run exits 0, reconciles hierarchical==adr-patterns==count
    //            and edges==inverses (the summary line);
    //        A3: the edge count is IDENTICAL across both runs (P1 SQLite
    //            causal_edges duplication would climb run-over-run), and the
    //            hierarchical record count is stable (no record dup).
    //   Synthetic ids ADR-95xx avoid collision with the real 0001-0284 corpus.
    //   3 ADRs; ADR-9501 supersedes 9502, depends-on 9503 → 2 fwd edges + 2 inv.
    // ════════════════════════════════════════════════════════════════════
    const adrDir = join(dir, `adr0285-purge-${ts}`);
    mkdirSync(adrDir, { recursive: true });
    const ADR_COUNT = 3;
    writeFileSync(join(adrDir, 'ADR-9501-root.md'),
      adrDoc('ADR-9501', 'status: accepted\ndate: 2026-05-30\ntags: [smoke]\nsupersedes: [ADR-9502]\ndepends-on: [ADR-9503]\nimplements: []', 'Smoke Root 9501'));
    writeFileSync(join(adrDir, 'ADR-9502-superseded.md'),
      adrDoc('ADR-9502', 'status: accepted\ndate: 2026-05-30\ntags: [smoke]\nsupersedes: []\ndepends-on: []\nimplements: []', 'Smoke Superseded 9502'));
    writeFileSync(join(adrDir, 'ADR-9503-dep.md'),
      adrDoc('ADR-9503', 'status: accepted\ndate: 2026-05-30\ntags: [smoke]\nsupersedes: []\ndepends-on: []\nimplements: []', 'Smoke Dep 9503'));

    const runIndex = (label) => {
      const t0 = Date.now();
      const r = spawnSync(cli, ['agentdb', 'index', '--dir', adrDir, '--purge'],
        { cwd: dir, encoding: 'utf8', timeout: 240000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY } });
      const combined = `${r.stdout || ''}\n${r.stderr || ''}`;
      const ms = Date.now() - t0;
      const summary = parseIndexSummary(combined);
      log(`[smoke] index --purge (${label}): status=${r.status} ${ms}ms → ${summary ? summary.line : '(no summary line)'}`);
      return { r, combined, ms, summary };
    };

    const run1 = runIndex('run1');
    if (/Unknown command|not found/i.test(run1.combined) && /agentdb/i.test(run1.combined) && run1.r.status !== 0 && !/index complete|index:/i.test(run1.combined)) {
      fail('A3-command-missing', 'agentdb index not registered — published build predates ADR-0273');
      return finish(dir, shared, mcpProc);
    }
    if (run1.r.signal === 'SIGTERM' || run1.ms >= 239000 || /LockHeld|0x0300/i.test(run1.combined)) {
      fail('A3-index-blocked', `agentdb index --purge hit LockHeld / hang alongside the live MCP server (ADR-0274/0284 not effective): ${run1.combined.slice(0, 200)}`);
      return finish(dir, shared, mcpProc);
    }

    // A4: run1 reconciles (exit 0; hierarchical==adr-patterns==count; edges==inverses).
    if (run1.r.status !== 0) {
      fail('A4-reindex-exit', `index --purge exit=${run1.r.status}: ${run1.combined.slice(0, 200)}`);
    } else if (!run1.summary) {
      fail('A4-reindex-summary', `no parseable "complete:" summary line: ${run1.combined.slice(-300)}`);
    } else {
      const s = run1.summary;
      const reconHier = s.hierarchical === ADR_COUNT && s.hierarchicalTotal === ADR_COUNT && s.adrPatterns === ADR_COUNT;
      const reconEdges = s.edges === s.inverses && s.edges > 0;
      if (reconHier && reconEdges) {
        pass(`A4 (P8) reindex reconciled: ${s.hierarchical}/${s.hierarchicalTotal} hierarchical == ${s.adrPatterns} adr-patterns == ${ADR_COUNT} ADRs; ${s.edges} edges == ${s.inverses} inverses (exit 0)`);
      } else {
        if (!reconHier) fail('A4-recon-hierarchical', `hierarchical(${s.hierarchical}/${s.hierarchicalTotal}) / adr-patterns(${s.adrPatterns}) != ADR count(${ADR_COUNT}) — surfaces not reconciled (P2 strand / silent drop)`);
        if (!reconEdges) fail('A4-recon-edges', `edges(${s.edges}) != inverses(${s.inverses}) or 0 — forward/inverse mirror not reconciled`);
      }
    }

    // Second --purge run for the idempotency comparison.
    const run2 = runIndex('run2');
    if (run2.r.status !== 0) {
      fail('A3-reindex2-exit', `second index --purge exit=${run2.r.status}: ${run2.combined.slice(0, 200)}`);
    } else if (!run1.summary || !run2.summary) {
      fail('A3-purge-idempotency', `cannot compare runs — missing summary (run1=${!!run1.summary}, run2=${!!run2.summary})`);
    } else {
      // A3: the edge count must NOT grow across --purge runs (P1: SQLite
      // causal_edges left dirty → duplicate edges → climbing total). Record
      // count must also stay constant (no record duplication).
      const edgesStable = run2.summary.edges === run1.summary.edges && run2.summary.inverses === run1.summary.inverses;
      const recordsStable = run2.summary.hierarchical === run1.summary.hierarchical && run2.summary.adrPatterns === run1.summary.adrPatterns;
      if (edgesStable && recordsStable) {
        pass(`A3 (P1/P2) --purge idempotent: edges ${run1.summary.edges}→${run2.summary.edges}, inverses ${run1.summary.inverses}→${run2.summary.inverses}, records ${run1.summary.hierarchical}→${run2.summary.hierarchical} (no growth across two --purge runs)`);
      } else {
        if (!edgesStable) fail('A3-edge-growth', `edge count changed across --purge runs (${run1.summary.edges}+${run1.summary.inverses} → ${run2.summary.edges}+${run2.summary.inverses}) — P1: SQLite causal_edges not cleared by --purge → duplication`);
        if (!recordsStable) fail('A3-record-growth', `record count changed across --purge runs (${run1.summary.hierarchical}/${run1.summary.adrPatterns} → ${run2.summary.hierarchical}/${run2.summary.adrPatterns}) — purge not clearing all surfaces`);
      }

      // Cross-check via the live MCP server: hierarchical-query returns exactly
      // ADR_COUNT after two purges (record dedup observable through the API).
      const hq = mcpExec(cli, dir, 'agentdb_hierarchical-query', { pathPattern: 'adr/ADR-950*' });
      const nh = countResults(hq);
      if (nh === ADR_COUNT) {
        pass(`A3 (P1/P2) hierarchical-query adr/ADR-950* → ${nh} after two --purge runs (no record duplication via the live server)`);
      } else {
        fail('A3-query-dedup', `hierarchical-query adr/ADR-950* returned ${nh} after two --purge runs (expected ${ADR_COUNT}; != ADR_COUNT = record duplication or stranded entries)`);
      }
    }

    try { rmSync(adrDir, { recursive: true, force: true }); } catch {}

  } catch (e) {
    fail('main', e?.stack || String(e));
  } finally {
    if (testBodyStart) perf.mark('test-body', testBodyStart);
    if (mcpProc && mcpProc.exitCode === null) { try { mcpProc.kill('SIGTERM'); } catch {} await new Promise(r => setTimeout(r, 400)); if (mcpProc.exitCode === null) try { mcpProc.kill('SIGKILL'); } catch {} }
    try { if (!shared) rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  finish(dir, shared, mcpProc);
}

function finish(dir, shared, mcpProc) {
  if (mcpProc && mcpProc.exitCode === null) { try { mcpProc.kill('SIGKILL'); } catch {} }
  try { if (dir && shared === false) rmSync(dir, { recursive: true, force: true }); } catch {}
  perf.emitJson();
  log(`\n[ADR-0285 smoke] ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    log(`\nSmoke FAILED — the ADR-0285 causal/recall/purge contract is incomplete (causal CRUD on '/'-bearing ids, erroring recall, or non-idempotent --purge).\n`);
    process.exit(1);
  }
  log(`\nSmoke PASSED — ADR-0285 WIRED: causal CRUD round-trips on '/'-bearing ids (create/query/edge-delete/node-delete), recall is non-erroring, and --purge is idempotent + reconciles all surfaces.\n`);
  process.exit(0);
}

main().catch((e) => { fail('main', e?.stack || String(e)); finish(); });
