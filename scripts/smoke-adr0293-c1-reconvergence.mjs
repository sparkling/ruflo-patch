#!/usr/bin/env node
/**
 * ADR-0293 smoke — C1 Learning & Intelligence re-convergence fixes.
 *
 * Drives ONE long-lived MCP stdio JSON-RPC session against an installed cli
 * (the same bin entry Claude Code uses: `ruflo mcp start` → bin/cli.js inline
 * MCP handler → dist/src/mcp-client.js → tool handlers) and asserts the four
 * fork-regression fixes the ADR mandates. State (ruvllm _wasmReady, neural
 * store, persisted routers) lives in the server process, so a single session
 * exercises the create→operate lifecycle the acceptance criteria require.
 *
 *   D1 — RuVLLM WASM init skew. The vendored ruvllm-wasm 2.0.2-patch.93 build
 *        auto-instantiates + exposes init() (no initSync); the wrapper called
 *        mod.initSync(...) and every ruvllm_* create/config tool died with
 *        "mod.initSync is not a function". Assert: one session
 *        ruvllm_hnsw_create → add → route returns a REAL score (1.0 for a
 *        query == the stored pattern), and ruvllm_status reports
 *        wasm.available:true + initialized:true after the create.
 *
 *   D2 — hooks_transfer demo-data fabrication. On an empty/nonexistent source
 *        the fork fabricated total:40 patterns tagged dataSource:"demo-data".
 *        Assert: hooks_transfer{sourcePath:<nonexistent>} → success:false,
 *        transferred:0, and NO "demo-data" marker anywhere in the response;
 *        a source WITH real patterns → success:true with real counts.
 *
 *   D3 — neural_* hash-fallback + confidence@similarity:0.
 *        (a) The neural store didn't wire to the real mpnet embedder the
 *            embeddings_* tools use. Assert (gated on the real embedder being
 *            reachable in this env — embeddings_status warmup): when a real
 *            embedder is available, neural_status._realEmbeddings:true with
 *            768-dim patterns. (If no real embedder is reachable at all — e.g.
 *            CI without the model — the wiring assertion is skipped LOUDLY, not
 *            silently passed: the regression is the GAP between embeddings_*
 *            working and neural not.)
 *        (b) A temperature-softmax over a single/dominant candidate returned
 *            confidence 1.0 regardless of match. Assert (unconditional — works
 *            on the hash path too): a predict on disjoint text does NOT return
 *            confidence:1 (gated by match strength → ~0 for a non-match), while
 *            an exact-match predict stays high.
 *
 *   D4 — neural_compress advertised no-op. The tool advertised generic
 *        "compression" but quantize returns "not available" (ADR-0086 removed
 *        it). Assert: the tools/list description DOCUMENTS that quantize is not
 *        supported in this build, the quantize call returns the documented
 *        not-available error (success:false), and the supported methods
 *        (prune/distill) work — response matches documented capability.
 *
 * FAILs against the published cli/agentdb (patch.415 era — the regressions are
 * present); PASSes after the ADR-0293 fixes ship. Reuses the shared
 * ACCEPT_TEMP install via ADR0255_SMOKE_SHARED_TEMP; standalone self-installs
 * from Verdaccio.
 */
import { existsSync, mkdirSync, appendFileSync, writeFileSync, rmSync } from 'node:fs';
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
const LOG_FILE = join(LOG_DIR, `smoke-adr0293-c1-reconvergence-${Date.now()}.log`);
const perf = createSmokePerf('smoke-adr0293-c1-reconvergence');

let passed = 0;
let failed = 0;
let skipped = 0;
function log(msg) { process.stderr.write(`${msg}\n`); try { appendFileSync(LOG_FILE, `${msg}\n`); } catch {} }
function pass(label) { passed++; log(`  PASS  ${label}`); }
function fail(label, reason) { failed++; log(`  FAIL  ${label}: ${reason}`); }
function skip(label, reason) { skipped++; log(`  SKIP  ${label}: ${reason}`); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A minimal MCP stdio JSON-RPC client over a long-lived `cli mcp start` child.
 * Frames are newline-delimited JSON on stdout; stderr is server log noise.
 */
function startMcpSession(cli, cwd) {
  const proc = spawn(cli, ['mcp', 'start'], {
    cwd,
    env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buf = '';
  const pending = new Map();
  proc.stdout.on('data', (c) => {
    buf += c.toString();
    let lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id != null && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      } catch { /* non-frame line on stdout — ignore */ }
    }
  });
  // Capture a tail of stderr for diagnostics on failure.
  let stderrTail = '';
  proc.stderr.on('data', (c) => { stderrTail = (stderrTail + c.toString()).slice(-1200); });
  let nextId = 1;
  function rpc(method, params) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, resolve);
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout on ${method}`)); } }, 90000);
    });
  }
  /** Unwrap the (possibly multiply) JSON-stringified tool payload to its object. */
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
  async function call(name, args) { return unwrap(await rpc('tools/call', { name, arguments: args || {} })); }
  return {
    proc,
    rpc,
    call,
    getStderrTail: () => stderrTail,
    async init() {
      await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'adr0293-smoke', version: '1' } });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    },
    async close() {
      try { proc.stdin.end(); } catch {}
      await sleep(400);
      if (proc.exitCode === null) try { proc.kill('SIGKILL'); } catch {}
    },
  };
}

async function main() {
  log(`\n[ADR-0293 smoke] C1 re-convergence — D1 ruvllm wasm · D2 hooks_transfer · D3 neural embedder/confidence · D4 neural_compress`);
  log(`[smoke] log: ${LOG_FILE}\n`);
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  const { dir: tempDir, shared } = setupSmokeTempDir('smoke-adr0293-c1', perf, REGISTRY);
  log(`[smoke] temp dir: ${tempDir}${shared ? ' (shared)' : ''}`);

  let cli;
  if (shared) {
    cli = findCli(tempDir);
    if (!cli) { log(`[setup] FATAL: cli not found in shared subdir`); process.exit(1); }
  } else {
    cli = installAndInit(tempDir, perf, REGISTRY);
  }
  log(`[smoke] cli: ${cli}`);

  // Ensure a project-root marker so findProjectRoot() anchors here (the neural
  // store + ruvllm persistence resolve relative to it). `ruflo init` writes
  // one; the shared-temp copy carries .claude/.claude-flow but the marker
  // file is cheap to (re)assert.
  try {
    const marker = join(tempDir, '.ruflo-project');
    if (!existsSync(marker)) writeFileSync(marker, JSON.stringify({ smoke: 'adr0293' }));
  } catch { /* best-effort */ }

  const testBodyStart = process.hrtime.bigint();
  const session = startMcpSession(cli, tempDir);
  await session.init();

  try {
    // ── D1: RuVLLM WASM create → add → route → status ────────────────────
    log(`[smoke] D1: ruvllm_hnsw_create → add → route → status`);
    const vec = [1, 0, 0, 0, 0, 0, 0, 0];
    const create = await session.call('ruvllm_hnsw_create', { dimensions: 8, maxPatterns: 16 });
    if (create?.success === true && typeof create.routerId === 'string') {
      pass(`D1a: ruvllm_hnsw_create succeeded (routerId=${create.routerId})`);
    } else {
      fail('D1a: ruvllm_hnsw_create', `expected success:true+routerId, got ${JSON.stringify(create).slice(0, 220)} | stderr: ${session.getStderrTail().slice(-200)}`);
    }
    const routerId = create?.routerId;
    if (routerId) {
      const add = await session.call('ruvllm_hnsw_add', { routerId, name: 'p1', embedding: vec });
      if (add?.success === true) pass(`D1b: ruvllm_hnsw_add succeeded (patternCount=${add.patternCount})`);
      else fail('D1b: ruvllm_hnsw_add', JSON.stringify(add).slice(0, 220));

      const route = await session.call('ruvllm_hnsw_route', { routerId, query: vec, k: 1 });
      const top = route?.results?.[0];
      // Query == stored pattern → a real cosine score of ~1 (not 0/undefined).
      if (top && typeof top.score === 'number' && top.score > 0.9) {
        pass(`D1c: ruvllm_hnsw_route returns a real score (${top.score} for query==pattern)`);
      } else {
        fail('D1c: ruvllm_hnsw_route real score', `expected top.score>0.9, got ${JSON.stringify(route).slice(0, 220)}`);
      }
    }
    const rstatus = await session.call('ruvllm_status', {});
    if (rstatus?.wasm?.available === true && rstatus?.wasm?.initialized === true) {
      pass(`D1d: ruvllm_status reports wasm loaded (available+initialized; version=${rstatus.wasm.version})`);
    } else {
      fail('D1d: ruvllm_status wasm loaded', `expected wasm.available+initialized true, got ${JSON.stringify(rstatus?.wasm)}`);
    }

    // ── D2: hooks_transfer honest empty (no demo-data fabrication) ───────
    log(`[smoke] D2: hooks_transfer nonexistent + real source`);
    const nonexistent = join(tempDir, '_adr0293_nonexistent_source_xyz');
    const t1 = await session.call('hooks_transfer', { sourcePath: nonexistent });
    const t1str = JSON.stringify(t1);
    const transferred0 = t1?.transferred === 0 || t1?.transferred?.total === 0;
    if (t1?.success === false && transferred0 && !/demo-data/.test(t1str)) {
      pass(`D2a: hooks_transfer(nonexistent) → success:false, transferred:0, no demo-data marker`);
    } else {
      fail('D2a: hooks_transfer honest empty', `success=${t1?.success} transferred=${JSON.stringify(t1?.transferred)} demoData=${/demo-data/.test(t1str)} | ${t1str.slice(0, 220)}`);
    }
    // A source WITH real patterns → honest success (happy path not broken).
    const realSource = join(tempDir, '_adr0293_real_source');
    try {
      mkdirSync(join(realSource, '.claude-flow', 'memory'), { recursive: true });
      writeFileSync(join(realSource, '.claude-flow', 'memory', 'store.json'), JSON.stringify({
        version: '3.0.0',
        entries: {
          k1: { key: 'task-routing-coder', value: 'x', metadata: { type: 'routing' } },
          k2: { key: 'agent-success-tester', value: 'y', metadata: { type: 'agent-success' } },
        },
      }));
    } catch (e) { log(`  [D2] could not write real source: ${e?.message || e}`); }
    const t2 = await session.call('hooks_transfer', { sourcePath: realSource });
    if (t2?.success === true && t2?.transferred?.total === 2 && t2?.dataSource === 'source-project') {
      pass(`D2b: hooks_transfer(real source) → success:true, total:2, dataSource:source-project`);
    } else {
      fail('D2b: hooks_transfer real source', JSON.stringify(t2).slice(0, 260));
    }

    // ── D3: neural embedder wiring + confidence@similarity:0 ─────────────
    log(`[smoke] D3: neural embedder + confidence`);
    // Warm up the real embedder the embeddings_* tools use (idempotent; model
    // cached or fetched). This is the SAME embedder D3 wires neural into.
    try { await session.call('embeddings_init', {}); } catch { /* tool may not need explicit init */ }
    let embReal = false;
    try {
      const eg = await session.call('embeddings_generate', { text: 'warmup probe for adr0293 neural embedder wiring' });
      // A real embedder yields a 768-d (mpnet) vector; a hash fallback warns.
      const dims = eg?.dimensions ?? eg?.embedding?.length ?? (Array.isArray(eg?.vector) ? eg.vector.length : 0);
      embReal = (eg?.success !== false) && Number(dims) >= 384;
      log(`  [D3] embeddings_generate dims=${dims} success=${eg?.success}`);
    } catch (e) { log(`  [D3] embeddings_generate probe failed: ${e?.message || e}`); }

    // Seed a known pattern via the real (or fallback) embedder path.
    const seedText = 'deploy kubernetes cluster to production with rolling updates';
    await session.call('neural_patterns', { action: 'store', name: seedText, type: 'devops' });

    const nstatus = await session.call('neural_status', {});
    // D3a: wiring — gated on a real embedder actually being reachable.
    if (embReal) {
      if (nstatus?._realEmbeddings === true) {
        pass(`D3a: neural_status._realEmbeddings:true (provider=${nstatus.embeddingProvider})`);
      } else {
        fail('D3a: neural wired to real embedder', `embeddings_* has a real embedder but neural reports _realEmbeddings=${nstatus?._realEmbeddings} (provider=${nstatus?.embeddingProvider}) — the D3 wiring gap`);
      }
    } else {
      skip('D3a: neural wired to real embedder', 'no real embedder reachable in this env (embeddings_* not real) — wiring assertion inapplicable');
    }

    // D3b: confidence — a disjoint-text predict must NOT return confidence:1
    // (works on the hash path too; gated by match strength). Exact-match stays high.
    const pDisjoint = await session.call('neural_predict', { input: 'a quiet sleepy cat naps on a warm soft windowsill', topK: 3 });
    const topConf = pDisjoint?.topConfidence ?? pDisjoint?.predictions?.[0]?.confidence;
    if (typeof topConf === 'number' && topConf < 0.99) {
      pass(`D3b: disjoint-text predict confidence is NOT 1 (topConfidence=${topConf}, topSimilarity=${pDisjoint?.topSimilarity})`);
    } else {
      fail('D3b: confidence not 1 on disjoint text', `topConfidence=${topConf} (expected <0.99) | ${JSON.stringify(pDisjoint).slice(0, 240)}`);
    }
    const pExact = await session.call('neural_predict', { input: seedText, topK: 3 });
    const exactConf = pExact?.topConfidence ?? pExact?.predictions?.[0]?.confidence;
    // Only assert the exact-match is confident when the real embedder is in
    // play (hash embeddings have no semantic meaning, so an "exact" string
    // match isn't guaranteed a high cosine).
    if (embReal) {
      if (typeof exactConf === 'number' && exactConf > 0.5) {
        pass(`D3c: exact-match predict stays confident (topConfidence=${exactConf}, topSimilarity=${pExact?.topSimilarity})`);
      } else {
        fail('D3c: exact-match confident', `topConfidence=${exactConf} (expected >0.5) | ${JSON.stringify(pExact).slice(0, 240)}`);
      }
    } else {
      skip('D3c: exact-match confident', 'no real embedder — exact-string cosine not guaranteed high on hash path');
    }

    // ── D4: neural_compress documented capability boundary ───────────────
    log(`[smoke] D4: neural_compress documented boundary`);
    const list = await session.rpc('tools/list', {});
    const nc = (list?.result?.tools || []).find((t) => t.name === 'neural_compress');
    const desc = (nc?.description || '') + ' ' + (nc?.inputSchema?.properties?.method?.description || '');
    const documentsBoundary = /not supported in this build/i.test(desc) && /quantize/i.test(desc);
    if (documentsBoundary) {
      pass(`D4a: neural_compress documents the quantize capability boundary`);
    } else {
      fail('D4a: neural_compress documents boundary', `description does not document quantize-unsupported: "${desc.slice(0, 200)}"`);
    }
    // Seed two near-identical patterns so distill has something to merge.
    await session.call('neural_patterns', { action: 'store', name: 'alpha beta gamma adr0293 marker pattern', type: 'demo' });
    await session.call('neural_patterns', { action: 'store', name: 'alpha beta gamma adr0293 marker pattern', type: 'demo' });
    const cq = await session.call('neural_compress', { method: 'quantize' });
    if (cq?.success === false && /not available|not supported/i.test(String(cq?.error || ''))) {
      pass(`D4b: neural_compress quantize returns the documented not-available error`);
    } else {
      fail('D4b: quantize documented error', JSON.stringify(cq).slice(0, 220));
    }
    const cd = await session.call('neural_compress', { method: 'distill' });
    if (cd?.success === true) pass(`D4c: neural_compress distill works (patternsMerged=${cd.patternsMerged})`);
    else fail('D4c: distill supported', JSON.stringify(cd).slice(0, 220));

  } catch (err) {
    fail('session', `uncaught: ${err?.stack || err}`);
  } finally {
    await session.close();
    perf.mark('test-body', testBodyStart);
    perf.emitJson();
    try { if (!shared) rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }

  log(`\n[ADR-0293 smoke] ${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { log(`[smoke] FATAL: ${e?.stack || e}`); process.exit(1); });
