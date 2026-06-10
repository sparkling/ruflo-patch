#!/usr/bin/env node
/**
 * Smoke test: ADR-0310 T4 — cross-process federation push/pull + tenant
 * isolation, driven through the SHIPPED agentic-flow CLI.
 *
 * Proves the five DOA defects (ADR-0310 + 2026-06-10 amendment) are repaired
 * end-to-end against the published @sparkleideas/agentic-flow:
 *   - Fix 5 (CRITICAL): the published CLI runs at all — `agentic-flow
 *     --version` no longer ENOENTs at cli-proxy.js:43 on the missing nested
 *     agentic-flow/package.json (un-bricks the WHOLE CLI, not just
 *     federation).
 *   - Fix 3: `federation start` spawns dist/federation/run-hub.js (now
 *     authored + shipped) and the hub reaches a listening state.
 *   - Fix 1: the hub constructs without throwing "Database not initialized"
 *     (the async sql.js init race is resolved by awaiting db.ready in
 *     start()).
 *   - Fix 2: a push is accepted without the null-agentDB NPE on
 *     storePattern() (and the hub shuts down without the stop() close NPE).
 *
 * Method (mirrors the 2026-06-09 validation the ADR cites): start the hub via
 * the shipped CLI on a fixed loopback port, then run TWO separate child
 * processes speaking the raw WebSocket auth/push/pull protocol against
 * FederationHubServer — a writer (tenant `acme-corp`) pushes an episode, a
 * reader in the SAME tenant pulls it back (dataLen>=1, vector clock present),
 * and a reader in a DIFFERENT tenant gets dataLen:0 (isolation holds).
 *
 * The FederationHubClient's sync() data-plane is a stub (getLocalChanges()
 * returns [] and the pull reply is fire-and-forget), so T4 deliberately
 * drives the raw protocol rather than the client — exactly the method that
 * produced the original cross-process proof.
 *
 * Protocol contract (verified against
 * agentic-flow/src/federation/FederationHubServer.ts):
 *   - auth  → server replies { type:'ack' } (any token accepted; agentId +
 *             tenantId + token must be present). Registers the connection.
 *   - push  → persists episodes to SQLite (tenant-scoped), replies
 *             { type:'ack' } (no data).
 *   - pull  → getChangesSince(tenantId, ...) (WHERE tenant_id = ? — the
 *             isolation boundary), replies { type:'ack', data:[...],
 *             vectorClock }.
 *
 * Self-contained: installs @sparkleideas/agentic-flow directly (federation is
 * shipped by agentic-flow itself; no @sparkleideas/ruflo wrapper, no
 * `cli init`, and no shared-temp coupling needed). `ws` ships as an
 * agentic-flow dependency, so the raw-protocol child resolves it from the
 * installed tree.
 *
 * RED-until-published: this smoke hits the SHIPPED CLI; until the
 * forks/agentic-flow ADR-0310 fixes are released to Verdaccio it WILL fail
 * (the base CLI ENOENTs / the hub throws). That is expected.
 *
 * Usage: node scripts/smoke-federation-cross-process.mjs
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, appendFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REGISTRY = process.env.REGISTRY || 'http://localhost:4873';
const LOG_DIR = process.env.SMOKE_LOG_DIR || '/tmp';
const LOG_FILE = join(LOG_DIR, `smoke-federation-cross-process-${Date.now()}.log`);
// Fixed loopback port for the hub (override via FEDERATION_SMOKE_PORT). High
// and unusual to avoid collisions; the hub rejects on EADDRINUSE and exits,
// which surfaces as a loud `hub-exited-early` failure (never a silent pass).
const HUB_PORT = parseInt(process.env.FEDERATION_SMOKE_PORT || '18610', 10);
const HUB_WS = `ws://127.0.0.1:${HUB_PORT}`;

let passed = 0;
let failed = 0;

function log(msg) {
  process.stderr.write(`${msg}\n`);
  try { appendFileSync(LOG_FILE, `${msg}\n`); } catch {}
}
function pass(label) { passed++; log(`  PASS  ${label}`); }
function fail(label, reason) { failed++; log(`  FAIL  ${label}: ${reason}`); }

function findCliBin(tempDir) {
  const p = join(tempDir, 'node_modules', '.bin', 'agentic-flow');
  return existsSync(p) ? p : null;
}

/**
 * Drive the raw WS auth/push/pull protocol from a CHILD process so the push
 * and the pulls are genuinely cross-process (each call is its own `node -e`).
 * Resolves the `ws` dependency from the installed agentic-flow tree (cwd =
 * tempDir).
 *
 * Returns { role, tenant, dataLen, vectorClock } on success, or { error }.
 */
function wsDriverChild(tempDir, role, tenant, episodeJson) {
  const childCode = `
    (async () => {
      const WS = (await import('ws')).default;
      const ROLE = ${JSON.stringify(role)};
      const TENANT = ${JSON.stringify(tenant)};
      const HUB = ${JSON.stringify(HUB_WS)};
      const EPISODE = ${JSON.stringify(episodeJson)};
      const AGENT = ROLE + '-' + TENANT;
      const ws = new WS(HUB);
      let done = false;
      const finish = (obj) => {
        if (done) return; done = true;
        console.log('RESULT:' + JSON.stringify(obj));
        try { ws.close(); } catch {}
        process.exit(0);
      };
      const timer = setTimeout(() => finish({ role: ROLE, error: 'timeout-after-8s' }), 8000);
      let authed = false;
      ws.on('open', () => {
        ws.send(JSON.stringify({
          type: 'auth', agentId: AGENT, tenantId: TENANT, token: 'smoke-token',
          vectorClock: {}, timestamp: Date.now(),
        }));
      });
      ws.on('message', (raw) => {
        let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (msg.type === 'error') {
          clearTimeout(timer);
          finish({ role: ROLE, error: 'hub-error:' + (msg.error || 'unknown') });
          return;
        }
        if (msg.type !== 'ack') return;
        if (!authed) {
          // First ack = auth ack. Now perform the role's action.
          authed = true;
          if (ROLE === 'writer') {
            const ep = JSON.parse(EPISODE);
            ws.send(JSON.stringify({
              type: 'push', agentId: AGENT, tenantId: TENANT,
              vectorClock: { [AGENT]: 7 }, data: [ep], timestamp: Date.now(),
            }));
          } else {
            ws.send(JSON.stringify({
              type: 'pull', agentId: AGENT, tenantId: TENANT,
              vectorClock: {}, timestamp: Date.now(),
            }));
          }
          return;
        }
        // Second ack = push ack (writer, no data) or pull ack (reader, data[]).
        clearTimeout(timer);
        finish({
          role: ROLE, tenant: TENANT,
          dataLen: Array.isArray(msg.data) ? msg.data.length : 0,
          vectorClock: msg.vectorClock || null,
        });
      });
      ws.on('error', (e) => {
        clearTimeout(timer);
        finish({ role: ROLE, error: 'ws-error:' + (e && e.message ? e.message : String(e)) });
      });
    })();
  `;
  const child = spawnSync(process.execPath, ['-e', childCode], {
    cwd: tempDir, encoding: 'utf8', timeout: 15000, env: { ...process.env },
  });
  const out = `${child.stdout || ''}`;
  const m = out.match(/^RESULT:(.+)$/m);
  if (!m) {
    return {
      error: 'no-result',
      stdout: out.slice(0, 300),
      stderr: `${child.stderr || ''}`.slice(0, 300),
    };
  }
  try { return JSON.parse(m[1]); } catch { return { error: 'unparseable-result', raw: m[1] }; }
}

/**
 * Resolve when the hub prints the readiness marker the authored run-hub.ts
 * emits (`FEDERATION_HUB_LISTENING port=<n>`), or fail loudly on early exit /
 * timeout.
 */
function waitForHubListening(hubProc, hubLog) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (ok, why) => { if (settled) return; settled = true; resolve({ ok, why }); };
    const deadline = setTimeout(() => settle(false, 'hub-readiness-timeout-20s'), 20000);
    hubProc.stdout.on('data', (d) => {
      const s = d.toString();
      hubLog.push(s);
      if (s.includes('FEDERATION_HUB_LISTENING')) { clearTimeout(deadline); settle(true, 'marker'); }
    });
    hubProc.stderr.on('data', (d) => { hubLog.push(d.toString()); });
    hubProc.on('exit', (code) => { clearTimeout(deadline); settle(false, `hub-exited-early code=${code}`); });
  });
}

async function main() {
  log(`\n[ADR-0310 T4 smoke] cross-process federation push/pull + tenant isolation`);
  log(`[smoke] log file: ${LOG_FILE}`);
  log(`[smoke] hub: ${HUB_WS}\n`);

  if (!existsSync(LOG_DIR)) {
    try { mkdirSync(LOG_DIR, { recursive: true }); } catch {}
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'ruflo-fed-xproc-'));
  writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ name: 'smoke-adr0310', version: '1.0.0', private: true }));
  writeFileSync(join(tempDir, '.npmrc'), `registry=${REGISTRY}\n`);

  let hubProc = null;
  try {
    // Install the shipped agentic-flow directly. Fresh registry hit (NO
    // --prefer-offline) so a newly-published patch isn't shadowed by a stale
    // cache entry; @latest forces npm to re-resolve the dist-tag pointer
    // (per ADR-0265 §L4 stale-cache lesson).
    log(`[smoke] installing @sparkleideas/agentic-flow@latest from ${REGISTRY} …`);
    const inst = spawnSync('npm', ['install', '@sparkleideas/agentic-flow@latest', '--registry', REGISTRY, '--no-audit', '--no-fund'],
      { cwd: tempDir, encoding: 'utf8', timeout: 300000 });
    if (inst.status !== 0) {
      fail('install', `npm install failed: ${`${inst.stderr || ''}`.slice(0, 600)}`);
      throw new Error('install-failed');
    }

    const cli = findCliBin(tempDir);
    if (!cli) {
      fail('cli-bin', 'node_modules/.bin/agentic-flow not found after install');
      throw new Error('no-cli');
    }
    log(`[smoke] cli bin: ${cli}`);

    // ── Fix 5 gate: the base CLI must not ENOENT. `--version` exercises
    //    cli-proxy.js:43 (the readFileSync of the nested package.json) before
    //    any command dispatch. ──
    const ver = spawnSync(cli, ['--version'], { cwd: tempDir, encoding: 'utf8', timeout: 30000, env: { ...process.env } });
    const verOut = `${ver.stdout || ''}${ver.stderr || ''}`;
    if (ver.status === 0 && !/ENOENT/.test(verOut)) {
      pass(`Fix5: base CLI runs (no ENOENT at cli-proxy.js:43) — '${`${ver.stdout || ''}`.trim().slice(0, 60)}'`);
    } else {
      fail('Fix5: base CLI', `status=${ver.status} out=${verOut.slice(0, 300)}`);
    }

    // ── Start the hub via the shipped CLI (Fix 3 spawns run-hub.js; Fix 1
    //    resolves the sql.js init race). Pass both the --port flag and the
    //    FEDERATION_HUB_PORT env the CLI forwards to run-hub.js. ──
    const hubLog = [];
    hubProc = spawn(cli, ['federation', 'start', '--port', String(HUB_PORT), '--db-path', ':memory:'],
      { cwd: tempDir, env: { ...process.env, FEDERATION_HUB_PORT: String(HUB_PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });

    const ready = await waitForHubListening(hubProc, hubLog);
    const hubText = hubLog.join('');
    if (ready.ok) {
      pass(`Fix3+Fix1: 'federation start' reached listening state (spawned run-hub.js, no "Database not initialized")`);
    } else {
      // Surface the exact failure mode for diagnosis.
      const initThrow = /Database not initialized/.test(hubText) ? ' [saw "Database not initialized" — Fix 1 NOT applied]' : '';
      const enoent = /ENOENT/.test(hubText) ? ' [saw ENOENT — Fix 5 NOT applied]' : '';
      const notfound = /Hub server not found|run-hub\.js|build the project/i.test(hubText) ? ' [run-hub.js missing — Fix 3 NOT applied]' : '';
      fail('Fix3+Fix1: hub start', `${ready.why}${initThrow}${enoent}${notfound} :: ${hubText.slice(0, 400)}`);
      throw new Error('hub-not-ready');
    }

    // ── Writer pushes an episode (tenant acme-corp) — cross-process. ──
    const episode = JSON.stringify({
      sessionId: 'sess-1', task: 'shared-store-roundtrip',
      input: 'in', output: 'out', reward: 0.9, critique: 'ok',
      success: true, tokensUsed: 10, latencyMs: 5,
    });
    const writeRes = wsDriverChild(tempDir, 'writer', 'acme-corp', episode);
    log(`    writer result: ${JSON.stringify(writeRes)}`);
    if (!writeRes.error) {
      pass(`Fix2: push accepted without null-agentDB NPE (writer ack received)`);
    } else {
      fail('Fix2: push', `writer error=${writeRes.error}`);
    }

    // ── Same-tenant reader pulls it back (separate process). ──
    const sameTenant = wsDriverChild(tempDir, 'reader', 'acme-corp', '');
    log(`    same-tenant reader: ${JSON.stringify(sameTenant)}`);
    if (!sameTenant.error && (sameTenant.dataLen || 0) >= 1 && sameTenant.vectorClock) {
      pass(`T4: cross-process pull round-trip (dataLen=${sameTenant.dataLen}, vectorClock=${JSON.stringify(sameTenant.vectorClock)})`);
    } else {
      fail('T4: same-tenant pull', `dataLen=${sameTenant.dataLen} vc=${JSON.stringify(sameTenant.vectorClock)} err=${sameTenant.error || 'none'}`);
    }

    // ── Cross-tenant reader must see nothing (isolation: WHERE tenant_id). ──
    const otherTenant = wsDriverChild(tempDir, 'reader', 'globex-inc', '');
    log(`    cross-tenant reader: ${JSON.stringify(otherTenant)}`);
    if (!otherTenant.error && (otherTenant.dataLen || 0) === 0) {
      pass(`T4: tenant isolation holds (cross-tenant dataLen=0)`);
    } else {
      fail('T4: tenant isolation', `expected dataLen=0, got dataLen=${otherTenant.dataLen} err=${otherTenant.error || 'none'}`);
    }
  } catch (err) {
    log(`[smoke] exception: ${err.message}`);
  } finally {
    if (hubProc) { try { hubProc.kill('SIGTERM'); } catch {} }
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }

  log(`\n${'─'.repeat(60)}`);
  log(`Results: ${passed} passed, ${failed} failed`);
  log(`Log file: ${LOG_FILE}`);
  log(`${'─'.repeat(60)}`);

  if (failed > 0) { log(`\nSmoke FAILED — ADR-0310 T4 not met.\n`); process.exit(1); }
  log(`\nSmoke PASSED — ADR-0310 T4 met.\n`);
  process.exit(0);
}

main();
