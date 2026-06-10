#!/usr/bin/env node
/**
 * Smoke: ADR-0287 F2 — the MCP server must answer `resources/list`.
 *
 * The `initialize` reply advertises `capabilities.resources` (cli.js:204-207:
 * `resources: { subscribe: true, listChanged: true }`), but the JSON-RPC
 * dispatch `switch` had no `resources/list` case, so the advertised method fell
 * through to the `-32601` "Method not found" default — the server contradicted
 * its own advert. ADR-0287 F2 fix: add a `case 'resources/list'` returning
 * `{ resources: [] }` (an empty list is the correct answer — there are no
 * resources to enumerate), mirroring upstream's class-server handler.
 *
 * The fix lives on the LIVE BIN entries, NOT src/mcp-server.ts (the dead-code
 * trap ADR-0267 burned 5 cycles on — see feedback-trace-bin-entry-before-patching):
 *   - v3/@claude-flow/cli/bin/cli.js        (the live `ruflo mcp start` path)
 *   - v3/@claude-flow/cli/bin/mcp-server.js (the alternate server entry)
 * Installed as @sparkleideas/cli/bin/{cli.js,mcp-server.js}.
 *
 * Two assertions:
 *   F2-FUNC  — spin the live server (`cli mcp start`, which routes through
 *              bin/cli.js per ADR-0267; `ruflo mcp start` → bin/ruflo.mjs →
 *              bin/cli.js inline MCP), send `initialize` then `resources/list`
 *              over stdin, and assert the reply is `result.resources === []`
 *              (NOT an `error.code === -32601`).
 *   F2-ARCH  — ARCH-GUARD: the `resources/list` handler returning an empty
 *              `resources` array must exist in BOTH shipped bin entries
 *              (cli.js AND mcp-server.js). Catches a future edit that fixes one
 *              entry and silently regresses the other (the bins drifted apart
 *              before — bin/mcp-server.js is gated-KEEP, not dead).
 *
 * FAIL pre-impl (server returns -32601; the handler is absent from the bins),
 * PASS post-impl. Validates the INSTALLED/PUBLISHED package, so it goes GREEN
 * only AFTER the fork fix ships to the registry — RED until the release (by
 * design; it hits the shipped bin, not the working tree). Reuses ACCEPT_TEMP
 * via ADR0255_SMOKE_SHARED_TEMP; standalone self-installs from Verdaccio.
 */

import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import {
  createSmokePerf,
  setupSmokeTempDir,
  installAndInit,
  findCli,
} from './lib/smoke-adr0255-shared.mjs';

const REGISTRY = process.env.REGISTRY || 'http://localhost:4873';
const LOG_DIR = process.env.SMOKE_LOG_DIR || '/tmp';
const LOG_FILE = join(LOG_DIR, `smoke-adr0287-resources-list-${process.pid}.log`);
const perf = createSmokePerf('smoke-adr0287-resources-list');

let passed = 0, failed = 0;
function log(m) { process.stderr.write(`${m}\n`); try { appendFileSync(LOG_FILE, `${m}\n`); } catch {} }
function pass(l) { passed++; log(`  PASS  ${l}`); }
function fail(l, r) { failed++; log(`  FAIL  ${l}: ${r}`); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── F2-ARCH: the handler must exist in BOTH shipped bin entries ──────────
// Resolve the @sparkleideas/cli package (hoisted top-level or nested) from the
// temp project, then read bin/cli.js + bin/mcp-server.js. Assert each declares
// a `resources/list` case that returns an (empty) `resources` array. We match
// the case label AND a `resources:` result key in the same file rather than the
// whole literal, so trivial whitespace/comment edits don't false-fail while a
// missing handler or a non-empty-list regression still fails.
function archGuard(dir) {
  const req = createRequire(join(dir, 'package.json'));
  // Resolve the package ROOT. We cannot req.resolve('@sparkleideas/cli/package.json')
  // — the package's `exports` map does not expose `./package.json` (Node throws
  // ERR_PACKAGE_PATH_NOT_EXPORTED). Resolve the `.` main entry (which IS exported)
  // and slice back to the package root under node_modules/@sparkleideas/cli;
  // bin/*.js are then read via fs, bypassing the exports gate entirely.
  let pkgRoot;
  try {
    const mainEntry = req.resolve('@sparkleideas/cli');
    const marker = '/node_modules/@sparkleideas/cli';
    const idx = mainEntry.lastIndexOf(marker);
    if (idx === -1) throw new Error(`resolved main '${mainEntry}' not under ${marker}`);
    pkgRoot = mainEntry.slice(0, idx + marker.length);
  } catch (e) {
    fail('F2-ARCH', `cannot resolve @sparkleideas/cli from ${dir}: ${e.message}`);
    return;
  }
  const binDir = join(pkgRoot, 'bin');

  for (const entry of ['cli.js', 'mcp-server.js']) {
    const p = join(binDir, entry);
    if (!existsSync(p)) { fail('F2-ARCH', `shipped bin entry missing: ${p}`); continue; }
    let src;
    try { src = readFileSync(p, 'utf8'); }
    catch (e) { fail('F2-ARCH', `cannot read ${p}: ${e.message}`); continue; }

    const hasCase = /case\s*['"]resources\/list['"]\s*:/.test(src);
    // The result must carry a `resources` array. `resources: []` (the empty
    // list) is the correct answer; we accept any `resources:` array literal but
    // assert it is empty (an enumerated resource would be a different bug).
    const resKey = src.match(/resources\s*:\s*\[([^\]]*)\]/);

    if (!hasCase) {
      fail('F2-ARCH', `${entry}: no \`case 'resources/list'\` handler — the bin still falls through to -32601 (advertises resources, never answers)`);
    } else if (!resKey) {
      fail('F2-ARCH', `${entry}: \`resources/list\` case present but no \`resources: [...]\` result literal found`);
    } else if (resKey[1].trim() !== '') {
      fail('F2-ARCH', `${entry}: \`resources/list\` returns a NON-empty list (\`resources: [${resKey[1].trim()}]\`) — expected empty \`[]\``);
    } else {
      pass(`F2-ARCH ${entry}: \`case 'resources/list'\` returns \`{ resources: [] }\` (handler present in this bin)`);
    }
  }
}

// ── F2-FUNC: the live server answers resources/list with {resources:[]} ──
// Spin `cli mcp start`. Per ADR-0267, `ruflo mcp start` routes through
// bin/cli.js's inline MCP dispatch (NOT bin/mcp-server.js). The server reads
// newline-delimited JSON-RPC on stdin and writes newline-delimited replies on
// stdout (writeFrame: `process.stdout.write(JSON.stringify(obj) + '\n')`).
async function funcTest(cli, dir) {
  log(`[smoke] spawning MCP server (cli mcp start)…`);
  const proc = spawn(cli, ['mcp', 'start'], {
    cwd: dir,
    env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  const frames = [];
  let stdoutBuf = '';
  proc.stdout.on('data', (chunk) => {
    const s = chunk.toString();
    stdout += s;
    stdoutBuf += s;
    let lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop() || '';
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try { frames.push(JSON.parse(t)); } catch { /* non-JSON banner line — ignore */ }
    }
  });
  proc.stderr.on('data', (chunk) => {
    const s = chunk.toString();
    stderr += s;
    log(`  [mcp.stderr] ${s.replace(/\n/g, ' | ').slice(0, 400)}`);
  });
  proc.on('error', (err) => log(`[mcp.error] ${err.message}`));
  proc.on('exit', (code) => log(`[mcp.exit] code=${code}`));

  const send = (obj) => proc.stdin.write(JSON.stringify(obj) + '\n');
  const waitForId = async (id, budgetMs) => {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
      const f = frames.find((m) => m && m.id === id);
      if (f) return f;
      if (proc.exitCode !== null) break;
      await sleep(100);
    }
    return null;
  };

  try {
    // 1) initialize — also proves the server is up and confirms the resources
    //    capability is advertised (the premise of F2: advert without handler).
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'adr0287-smoke', version: '1.0.0' } } });
    const initReply = await waitForId(1, 30000);
    if (!initReply) {
      fail('F2-FUNC', `no 'initialize' reply within 30s (server did not come up). stderr tail: ${stderr.slice(-400)}`);
      return;
    }
    const advertisesResources = !!initReply?.result?.capabilities?.resources;
    log(`[smoke] initialize OK; advertises capabilities.resources=${advertisesResources}`);

    // 2) resources/list — the method under test.
    send({ jsonrpc: '2.0', id: 2, method: 'resources/list', params: {} });
    const reply = await waitForId(2, 15000);
    if (!reply) {
      fail('F2-FUNC', `no 'resources/list' reply within 15s. stdout tail: ${stdout.slice(-400)} | stderr tail: ${stderr.slice(-400)}`);
      return;
    }
    log(`[smoke] resources/list reply: ${JSON.stringify(reply).slice(0, 300)}`);

    // NEGATIVE: must NOT be the pre-fix -32601 "Method not found".
    if (reply.error) {
      if (reply.error.code === -32601) {
        fail('F2-FUNC', `resources/list returned -32601 (Method not found) though the server advertises capabilities.resources — F2 NOT fixed`);
      } else {
        fail('F2-FUNC', `resources/list returned an error: ${JSON.stringify(reply.error)}`);
      }
      return;
    }

    // POSITIVE: result.resources is an empty array.
    const res = reply?.result?.resources;
    if (Array.isArray(res) && res.length === 0) {
      pass(`F2-FUNC: resources/list → { resources: [] } (no -32601; advert honored${advertisesResources ? '' : ' [warn: initialize did not advertise resources]'})`);
    } else if (Array.isArray(res)) {
      fail('F2-FUNC', `resources/list returned a NON-empty resources array (len=${res.length}): ${JSON.stringify(res).slice(0, 200)} — expected []`);
    } else {
      fail('F2-FUNC', `resources/list result lacked a resources array: ${JSON.stringify(reply.result).slice(0, 200)}`);
    }
  } finally {
    try { proc.stdin.end(); } catch {}
    await sleep(300);
    if (proc.exitCode === null) { try { proc.kill('SIGTERM'); } catch {} await sleep(300); }
    if (proc.exitCode === null) { try { proc.kill('SIGKILL'); } catch {} }
  }
}

async function main() {
  log(`\n[ADR-0287 F2 smoke] MCP server must answer resources/list with { resources: [] }`);
  log(`[smoke] log: ${LOG_FILE}\n`);
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  const { dir, shared } = setupSmokeTempDir('adr0287-resources-list', perf, REGISTRY);
  log(`[smoke] temp dir: ${dir}${shared ? ' (shared)' : ''}`);

  let cli = findCli(dir);
  if (!cli) cli = installAndInit(dir, perf, REGISTRY);
  if (!cli) { fail('setup', 'cli not found'); return finish(shared, dir); }

  // ARCH-GUARD first — cheap, source-level, no process spin; pins the contract
  // on BOTH bins even if the live spin is flaky in a constrained CI runner.
  archGuard(dir);

  // FUNCTIONAL — drive the live server end-to-end.
  await funcTest(cli, dir);

  finish(shared, dir);
}

function finish(shared, dir) {
  perf.emitJson();
  log(`\n${'─'.repeat(60)}`);
  log(`[ADR-0287 F2 smoke] ${passed} passed, ${failed} failed`);
  log(`${'─'.repeat(60)}`);
  try { if (!shared && dir) rmSync(dir, { recursive: true, force: true }); } catch {}
  if (failed > 0) { log(`\nSmoke FAILED — ADR-0287 F2 not effective (resources/list -32601 or handler missing from a bin).\n`); process.exit(1); }
  log(`\nSmoke PASSED — resources/list returns { resources: [] } on the live server; handler present in both shipped bins.\n`);
  process.exit(0);
}

main().catch((e) => { fail('uncaught', e?.stack || String(e)); finish(false, null); });
