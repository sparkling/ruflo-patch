#!/usr/bin/env node
/**
 * ADR-0298 smoke — C6 Operations re-convergence fixes.
 *
 * Drives the installed cli (MCP stdio + memory round-trip) and asserts the C6
 * fork-regression / fork-ahead-broken / perf fixes ADR-0298 mandates. LOCAL
 * targets only (a file:// page created in /tmp) — no external sites, no paid
 * LLM calls.
 *
 *   R1 — browser_session_record's 4 ruvector calls re-shaped to ruvector@0.2.25.
 *        The fork hand-ported (Batch S, ADR-122 #2041) a pre-Issue-#2015 form:
 *        `rvf create … --kind browser-session` (no `--kind`; `-d` required) +
 *        the 3 trajectory calls passing `--session-id`/`--task`/`--verdict`
 *        (ruvector@0.2.25 needs `-c/--context`, `-a/-r`, `--success/--quality`).
 *        ruvector rejects the stale shapes with exit 1, killing the flagship
 *        session-as-skill flow at step-1. Fix: `rvf create <path> --dimension
 *        768` + the 3 trajectory calls re-targeted. Assert: record → end →
 *        replay completes against a LOCAL file:// page and replay surfaces the
 *        RVF container (status/segments). LOUD-SKIPs when ruvector or
 *        agent-browser is absent (per the ADR-0104b/0297 runtime-absent
 *        pattern — never silent-pass).
 *
 *   R2 — agentdb_circuit_status + agentdb_rate_limit_status repair. The handlers
 *        were wired to a controller contract never probed live:
 *        circuit_status used the wrong registry key (circuitBreakerController →
 *        circuitBreaker) AND wrong method (getStats() → the controller exposes
 *        getStatus()); rate_limit_status returned a hollow {success:true} (the
 *        rateLimiter controller has neither getStats nor getStatus). Fix:
 *        circuit prefers getStatus()/falls back to getStats(); rate surfaces the
 *        real token-bucket state (getTokens + maxTokens/refillRate/tokens/
 *        lastRefill) OR an honest capability-absent envelope — never hollow.
 *        Assert: circuit_status returns non-empty real breaker state; the rate
 *        envelope is non-hollow (real fields) OR an honest absence (success:false
 *        + error).
 *
 *   R3a — browser-session memory ops go in-process, not via per-call CLI shell.
 *         The five browser_session_* tools shelled `npx @claude-flow/cli@latest
 *         memory store|retrieve` per call — a ~26-31× cold-boot penalty
 *         (34.7-41s warm vs upstream 1.31s, C6 DA F1). Fix routes through the
 *         in-process memory-router (the same path memory_* uses). Assert: a
 *         memory_store(browser-templates) → browser_template_apply round-trip
 *         is content-verified and completes in single-digit seconds (not 30s+).
 *
 * BOTH-WAYS: against the PUBLISHED/current Verdaccio cli, browser_session_record
 * fails at step-1 (`--kind` invalid / `-d` missing), circuit_status is "not
 * available" or hollow, rate_limit_status is hollow {success:true}, and the
 * template round-trip pays the 30s+ shell tax; against the FIXED cli all PASS.
 * Reuses the shared ACCEPT_TEMP install via ADR0255_SMOKE_SHARED_TEMP;
 * standalone self-installs from Verdaccio.
 */
import { existsSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import {
  createSmokePerf,
  setupSmokeTempDir,
  installAndInit,
  findCli,
} from './lib/smoke-adr0255-shared.mjs';

const REGISTRY = process.env.REGISTRY || 'http://localhost:4873';
const LOG_DIR = process.env.SMOKE_LOG_DIR || '/tmp';
const LOG_FILE = join(LOG_DIR, `smoke-adr0298-c6-reconvergence-${Date.now()}.log`);
const perf = createSmokePerf('smoke-adr0298-c6-reconvergence');

let passed = 0;
let failed = 0;
let skipped = 0;
function log(msg) { process.stderr.write(`${msg}\n`); try { appendFileSync(LOG_FILE, `${msg}\n`); } catch {} }
function pass(label) { passed++; log(`  PASS  ${label}`); }
function fail(label, reason) { failed++; log(`  FAIL  ${label}: ${reason}`); }
function skip(label, reason) { skipped++; log(`  SKIP  ${label}: ${reason}`); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A minimal MCP stdio JSON-RPC client over a long-lived `cli mcp start`. */
function startMcpSession(cli, cwd) {
  const env = { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY };
  delete env.ANTHROPIC_API_KEY;
  delete env.OPENROUTER_API_KEY;
  delete env.OLLAMA_API_KEY;
  const proc = spawn(cli, ['mcp', 'start'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  const pending = new Map();
  proc.stdout.on('data', (c) => {
    buf += c.toString();
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id != null && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      } catch { /* non-frame line on stdout — ignore */ }
    }
  });
  let stderrTail = '';
  proc.stderr.on('data', (c) => { stderrTail = (stderrTail + c.toString()).slice(-1500); });
  let nextId = 1;
  function rpc(method, params) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, resolve);
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout on ${method}`)); } }, 120000);
    });
  }
  function unwrap(resp) {
    if (resp?.error) return { __rpcError: resp.error.message };
    let txt = resp?.result?.content?.[0]?.text;
    for (let i = 0; i < 5 && typeof txt === 'string'; i++) {
      try {
        const o = JSON.parse(txt);
        if (o && o.content && o.content[0] && typeof o.content[0].text === 'string') { txt = o.content[0].text; continue; }
        return o;
      } catch { return txt; }
    }
    return txt;
  }
  return {
    proc,
    rpc,
    async call(name, args) { return unwrap(await rpc('tools/call', { name, arguments: args || {} })); },
    getStderrTail: () => stderrTail,
    async init() {
      await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'adr0298-smoke', version: '1' } });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    },
    async close() {
      try { proc.stdin.end(); } catch {}
      await sleep(400);
      if (proc.exitCode === null) try { proc.kill('SIGKILL'); } catch {}
    },
  };
}

/** True when an envelope looks like a hollow `{ success: true }` (no real payload). */
function isHollowSuccess(env) {
  if (env == null || typeof env !== 'object') return false;
  if (env.success !== true) return false;
  const keys = Object.keys(env).filter((k) => k !== 'success');
  return keys.length === 0;
}

/**
 * R2 registry-surface fallback (the C6 DA's verification path): the Level-0
 * circuitBreaker/rateLimiter controllers only resolve through the MCP tools when
 * a full agentdb registry is initialized. When the bare MCP session can't (so
 * the tool returns "not available"), construct the INSTALLED memory pkg's
 * ControllerRegistry directly and assert the FIXED behavior — circuit exposes
 * getStatus()/getStats() (real state, not hollow); rate exposes a real
 * token-bucket surface (getTokens + bucket fields) or no surface. Returns
 * {available:boolean, circuitOk?, rateOk?, detail} — available=false LOUD-SKIPs.
 */
async function verifyR2ViaRegistry(cli) {
  // Derive the install's node_modules root from the cli bin path.
  const { dirname, join: pjoin } = await import('node:path');
  const { existsSync } = await import('node:fs');
  const nmRoot = dirname(dirname(cli)); // <root>/node_modules/.bin/<name> → <root>/node_modules
  const regPath = pjoin(nmRoot, '@sparkleideas', 'memory', 'dist', 'controller-registry.js');
  if (!existsSync(regPath)) return { available: false, detail: `controller-registry not found at ${regPath}` };
  let Reg;
  try {
    const mod = await import(`file://${regPath}`);
    Reg = mod.ControllerRegistry;
    if (typeof Reg !== 'function') return { available: false, detail: 'ControllerRegistry export missing' };
  } catch (e) {
    return { available: false, detail: `registry import failed: ${String(e).slice(0, 120)}` };
  }
  let reg;
  try { reg = new Reg({}); } catch (e) { return { available: false, detail: `registry ctor failed: ${String(e).slice(0, 120)}` }; }
  // circuit: real state via getStatus() (real CB) or getStats() (inline fallback).
  let circuitOk, rateOk, cDetail = '', rDetail = '';
  try {
    const cb = await reg.createController('circuitBreaker');
    const cstat = cb && typeof cb.getStatus === 'function' ? cb.getStatus()
      : cb && typeof cb.getStats === 'function' ? cb.getStats() : undefined;
    circuitOk = !!cstat && (typeof cstat.state === 'string' || typeof cstat.failures === 'number');
    cDetail = JSON.stringify(cstat ?? null).slice(0, 100);
  } catch (e) { return { available: false, detail: `circuit createController failed (agentdb unresolved?): ${String(e).slice(0, 100)}` }; }
  try {
    const rl = await reg.createController('rateLimiter');
    const realFields = ['maxTokens', 'refillRate', 'tokens', 'lastRefill'].filter((k) => rl && typeof rl[k] === 'number');
    const hasTokens = rl && typeof rl.getTokens === 'function';
    // Fixed behavior: a real token-bucket surface OR an honest no-surface (the
    // handler returns success:false in that case) — never a hollow success.
    rateOk = hasTokens || realFields.length > 0 || (rl && (typeof rl.getStats === 'function' || typeof rl.getStatus === 'function'));
    rDetail = `getTokens=${hasTokens} fields=[${realFields.join(',')}]`;
  } catch (e) { return { available: false, detail: `rate createController failed: ${String(e).slice(0, 100)}` }; }
  return { available: true, circuitOk, rateOk, detail: `circuit=${cDetail} rate=${rDetail}` };
}

async function main() {
  log(`\n[ADR-0298 smoke] C6 re-convergence — R1 browser record chain · R2 stat tools · R3a in-process memory`);
  log(`[smoke] log: ${LOG_FILE}\n`);
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  const { dir: tempDir, shared } = setupSmokeTempDir('smoke-adr0298-c6', perf, REGISTRY);
  log(`[smoke] temp dir: ${tempDir}${shared ? ' (shared)' : ''}`);

  let cli;
  if (shared) {
    cli = findCli(tempDir);
    if (!cli) { log(`[setup] FATAL: cli not found in shared subdir`); process.exit(1); }
  } else {
    cli = installAndInit(tempDir, perf, REGISTRY);
  }
  log(`[smoke] cli: ${cli}`);

  // Project marker + a LOCAL file:// page for R1 (no external sites).
  try {
    const marker = join(tempDir, '.ruflo-project');
    if (!existsSync(marker)) writeFileSync(marker, JSON.stringify({ smoke: 'adr0298' }));
  } catch { /* best-effort */ }
  const localPage = join(tempDir, 'adr0298-local.html');
  writeFileSync(localPage, '<!doctype html><html><head><title>ADR-0298 local</title></head><body><h1 id="h">adr0298</h1></body></html>');
  const localUrl = `file://${localPage}`;

  const testBodyStart = process.hrtime.bigint();
  const session = startMcpSession(cli, tempDir);
  await session.init();

  try {
    // ── R2: stat tools — circuit_status real state; rate_limit_status real
    //        fields OR honest absence; NEVER hollow. ──────────────────────────
    log(`[smoke] R2: agentdb_circuit_status + agentdb_rate_limit_status (real state / honest, never hollow)`);
    {
      // The Level-0 circuitBreaker/rateLimiter controllers only RESOLVE through
      // the MCP tools when the agentdb controller registry is initialized.
      // agentdb_resource_usage is the SENTINEL: it reads the resourceTracker
      // Level-0 controller via the same getController path. If it returns real
      // fields, the registry IS initialized — so a circuit "not available" then
      // is the published WRONG-KEY bug (circuitBreakerController), a FAIL; if the
      // sentinel is itself "not available", the registry is uninitialized in this
      // env → the tool path can't observe the fix, so fall back to constructing
      // the registry directly (the C6 DA's verification path) or LOUD-SKIP.
      const sentinel = await session.call('agentdb_resource_usage', {});
      const registryInitialized = !!(sentinel && sentinel.success === true
        && ['memoryUsageMB', 'memoryLimitMB', 'queryCount', 'uptimeSeconds'].some((k) => sentinel[k] !== undefined));
      log(`[smoke] R2: registry sentinel (resource_usage) initialized=${registryInitialized}`);

      let circuitUnresolvedUninit = false;
      let rateUnresolvedUninit = false;

      const circuit = await session.call('agentdb_circuit_status', {});
      if (circuit && circuit.__rpcError) {
        fail('R2.circuit_status', `rpc error: ${circuit.__rpcError}`);
      } else if (circuit && circuit.success === true && (typeof circuit.state === 'string' || typeof circuit.failures === 'number')) {
        pass(`R2.circuit_status (MCP tool): real breaker state (state=${circuit.state}, failures=${circuit.failures})`);
      } else if (isHollowSuccess(circuit)) {
        fail('R2.circuit_status HOLLOW', `{success:true} with no breaker fields — the key/method bug is NOT fixed: ${JSON.stringify(circuit).slice(0, 200)}`);
      } else if (circuit && circuit.success === false && /not available|no status surface/i.test(String(circuit.error || ''))) {
        if (registryInitialized) {
          fail('R2.circuit_status', `"${circuit.error}" while the registry IS initialized (resource_usage works) — the wrong key (circuitBreakerController) never resolves the controller; the key fix is NOT present`);
        } else {
          circuitUnresolvedUninit = true; // registry uninitialized — try the DA-path fallback
        }
      } else {
        fail('R2.circuit_status shape', `unexpected envelope: ${JSON.stringify(circuit).slice(0, 220)}`);
      }

      const rate = await session.call('agentdb_rate_limit_status', {});
      if (rate && rate.__rpcError) {
        fail('R2.rate_limit_status', `rpc error: ${rate.__rpcError}`);
      } else if (rate && rate.success === true && isHollowSuccess(rate)) {
        fail('R2.rate_limit_status HOLLOW', `{success:true} with zero fields — the hollow-success bug is NOT fixed: ${JSON.stringify(rate).slice(0, 200)}`);
      } else if (rate && rate.success === true) {
        const realFields = ['availableTokens', 'maxTokens', 'tokens', 'refillRate', 'lastRefill'].filter((k) => rate[k] !== undefined);
        if (realFields.length > 0) pass(`R2.rate_limit_status (MCP tool): real token-bucket fields [${realFields.join(',')}]`);
        else fail('R2.rate_limit_status', `success:true but no recognized rate-limiter fields: ${JSON.stringify(rate).slice(0, 200)}`);
      } else if (rate && rate.success === false && /no readable state surface/i.test(String(rate.error || ''))) {
        // The FIXED honest-absence envelope (controller resolved, no surface).
        pass(`R2.rate_limit_status (MCP tool): honest capability-absent envelope (no hollow success): "${rate.error.slice(0, 80)}"`);
      } else if (rate && rate.success === false && /not available/i.test(String(rate.error || ''))) {
        // "not available" = controller did not register (vs the fix's "no readable
        // state surface" which means it DID resolve). When the registry is up,
        // the published hollow path would have hit {success:true} above, so a
        // "not available" here is an uninitialized-registry condition → fallback.
        rateUnresolvedUninit = true;
      } else {
        fail('R2.rate_limit_status shape', `unexpected envelope: ${JSON.stringify(rate).slice(0, 220)}`);
      }

      // DA-path fallback — ONLY when the registry was uninitialized in this env
      // (so the MCP tools couldn't exercise the handler). Construct the installed
      // ControllerRegistry directly and assert the controller surface supports
      // the fix (getStatus()/getStats() on circuit; getTokens/bucket fields on
      // rate). This is a fix-logic-soundness check against the REAL controller,
      // not an install gate — it LOUD-SKIPs if the registry can't be constructed.
      if (circuitUnresolvedUninit || rateUnresolvedUninit) {
        log(`[smoke] R2: registry uninitialized in this env — verifying the fix against the controller surface directly (DA path)`);
        let reg;
        try { reg = await verifyR2ViaRegistry(cli); }
        catch (e) { reg = { available: false, detail: `fallback threw: ${String(e).slice(0, 120)}` }; }
        if (!reg.available) {
          if (circuitUnresolvedUninit) skip('R2.circuit_status', `registry uninitialized via MCP and direct registry construction unavailable: ${reg.detail}`);
          if (rateUnresolvedUninit) skip('R2.rate_limit_status', `registry uninitialized via MCP and direct registry construction unavailable: ${reg.detail}`);
        } else {
          if (circuitUnresolvedUninit) {
            if (reg.circuitOk) pass(`R2.circuit_status (controller surface): circuitBreaker resolves and exposes real getStatus()/getStats() state (${reg.detail})`);
            else fail('R2.circuit_status (controller surface)', `circuitBreaker exposes no real status surface: ${reg.detail}`);
          }
          if (rateUnresolvedUninit) {
            if (reg.rateOk) pass(`R2.rate_limit_status (controller surface): rateLimiter exposes a real token-bucket surface (getTokens/bucket fields), not hollow (${reg.detail})`);
            else fail('R2.rate_limit_status (controller surface)', `rateLimiter exposes no readable state surface: ${reg.detail}`);
          }
        }
      }
    }

    // ── R3a: in-process memory round-trip latency + content ──────────────────
    log(`[smoke] R3a: memory_store(browser-templates) → browser_template_apply round-trip (in-process, single-digit s)`);
    {
      const key = `adr0298-tmpl-${Date.now()}`;
      const recipe = JSON.stringify({ steps: ['open', 'click #h'], marker: key });
      const t0 = Date.now();
      const store = await session.call('memory_store', { key, value: recipe, namespace: 'browser-templates' });
      const tStore = Date.now();
      if (store && store.__rpcError) {
        fail('R3a.store', `rpc error: ${store.__rpcError}`);
      } else if (!store || store.stored !== true) {
        fail('R3a.store', `memory_store did not persist: ${JSON.stringify(store).slice(0, 200)}`);
      } else {
        // Measure the template_apply step IN ISOLATION — that is the call the
        // fix moves in-process (browser_session_end's index write + the two
        // reads). memory_store is in-process on BOTH published and fixed, so the
        // discriminating signal is the apply-step latency, not the total.
        const tApplyStart = Date.now();
        const apply = await session.call('browser_template_apply', { name: key });
        const applyMs = Date.now() - tApplyStart;
        const roundTripMs = Date.now() - t0;
        if (apply && apply.__rpcError) {
          fail('R3a.template_apply', `rpc error: ${apply.__rpcError}`);
        } else {
          // Content-verify: the recipe blob round-trips (string or parsed).
          const recRaw = apply && (apply.recipe ?? null);
          const recStr = typeof recRaw === 'string' ? recRaw : (recRaw == null ? '' : JSON.stringify(recRaw));
          const contentOk = recStr.includes(key);
          if (apply && apply.success === true && contentOk) {
            pass(`R3a.template_apply: content-verified round-trip (store ${tStore - t0}ms, apply ${applyMs}ms, total ${roundTripMs}ms)`);
          } else if (apply && apply.found === false) {
            fail('R3a.template_apply', `template not found after store — in-process read did not see the in-process write: ${JSON.stringify(apply).slice(0, 200)}`);
          } else {
            fail('R3a.template_apply content', `recipe did not round-trip the marker: ${JSON.stringify(apply).slice(0, 220)}`);
          }
          // Latency gate (both-ways discriminator): the FIXED browser_template_apply
          // reads in-process (an exact-key routeMemoryOp get) — single-digit to
          // low-tens of ms. The PUBLISHED tool shells `npx @claude-flow/cli@latest
          // memory retrieve`, a whole fresh CLI process whose boot alone is
          // hundreds of ms to tens of seconds (the C6 DA measured 34-41s under
          // load; even a fully warm npx is ≫ 400ms). 400ms cleanly separates the
          // in-process path from ANY per-call CLI shell-out.
          if (applyMs < 400) {
            pass(`R3a.latency: template_apply ${applyMs}ms < 400ms — in-process read, not a per-call CLI shell-out`);
          } else {
            fail('R3a.latency', `template_apply ${applyMs}ms ≥ 400ms — looks like the per-call CLI shell-out (the fix moves this in-process)`);
          }
        }
      }
    }

    // ── R1: browser_session_record → end → replay (LOCAL page) ────────────────
    //        ruvector + agent-browser dependent — LOUD-SKIP when absent.
    log(`[smoke] R1: browser_session_record → end → replay against a LOCAL file:// page`);
    {
      const task = 'adr0298 local record chain';
      const rec = await session.call('browser_session_record', { url: localUrl, task });
      if (rec && rec.__rpcError) {
        fail('R1.record', `rpc error: ${rec.__rpcError}`);
      } else if (rec && rec.success === false) {
        const detail = `${rec.error || ''} ${rec.detail || ''} ${rec.stderr || ''}`.toLowerCase();
        // Distinguish a genuine runtime-absent (ruvector/agent-browser missing)
        // from a real failure. The PUBLISHED baseline fails specifically at the
        // rvf-create `--kind`/`-d` arg error — that is the bug we are fixing, so
        // it must be a FAIL (both-ways), not a skip.
        if (/required option '-d|--dimension|--kind|unknown option|required option '-c|--context/.test(detail)) {
          fail('R1.record', `ruvector arg-skew NOT fixed (published-baseline signature): ${detail.slice(0, 200)}`);
        } else if (/command not found|enoent|not installed|cannot find|no such file|browser open failed|agent-browser/.test(detail)) {
          skip('R1.record→end→replay', `ruvector/agent-browser runtime absent (cannot drive the local chain here): ${detail.slice(0, 160)}`);
        } else {
          fail('R1.record', `record failed: ${JSON.stringify(rec).slice(0, 240)}`);
        }
      } else if (rec && rec.success === true && rec.rvfPath && rec.sessionId) {
        pass(`R1.record: session opened (id=${rec.sessionId}, rvf=${String(rec.rvfPath).split('/').pop()})`);
        // end
        const end = await session.call('browser_session_end', { session: rec.sessionId, rvf_path: rec.rvfPath, verdict: 'pass', task });
        if (end && end.success === true) {
          pass(`R1.end: trajectory-end + rvf compact completed (verdict=pass)`);
        } else {
          const ed = `${end?.error || ''} ${end?.detail || ''} ${end?.stderr || ''}`.toLowerCase();
          if (/required option|--verdict|--session-id|--quality|--success/.test(ed)) {
            fail('R1.end', `trajectory-end arg-skew NOT fixed: ${ed.slice(0, 200)}`);
          } else {
            fail('R1.end', `end failed: ${JSON.stringify(end).slice(0, 220)}`);
          }
        }
        // replay
        const replay = await session.call('browser_session_replay', { session: rec.sessionId, rvf_path: rec.rvfPath });
        if (replay && replay.success === true && (replay.rvfStatus != null || replay.rvfSegments != null)) {
          pass(`R1.replay: returned the session (rvf status/segments surfaced)`);
        } else {
          fail('R1.replay', `replay did not surface the container: ${JSON.stringify(replay).slice(0, 220)}`);
        }
      } else {
        fail('R1.record shape', `unexpected record envelope: ${JSON.stringify(rec).slice(0, 240)}`);
      }
    }

  } catch (err) {
    fail('mcp-session', `uncaught: ${err?.stack || err}`);
  } finally {
    await session.close();
  }

  perf.mark('test-body', testBodyStart);
  perf.emitJson();
  try { if (!shared) rmSync(tempDir, { recursive: true, force: true }); } catch {}

  log(`\n[ADR-0298 smoke] ${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { log(`[smoke] FATAL: ${e?.stack || e}`); process.exit(1); });
