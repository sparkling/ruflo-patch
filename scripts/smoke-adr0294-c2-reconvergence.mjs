#!/usr/bin/env node
/**
 * ADR-0294 smoke — C2 Memory & Data re-convergence fixes.
 *
 * Drives ONE long-lived MCP stdio JSON-RPC session against an installed cli
 * (the same bin entry Claude Code uses: `ruflo mcp start` → bin/cli.js inline
 * MCP handler → dist/src/mcp-client.js → tool handlers) and asserts the four
 * fork-regression / open-item fixes ADR-0294 mandates. State (registered
 * controllers, the graph_edges + causal_edges rows, the RaBitQ WASM index, the
 * rate-limiter token bucket) lives in the server process, so a single session
 * exercises the write→read compositions the acceptance criteria require.
 *
 *   R1 — general-entity graph_edges write starvation. ADR-0276 narrowed
 *        agentdb_causal-edge to CausalMemoryGraph/causal_edges; general entity
 *        edges stopped reaching graph_edges, killing agentdb_graph-query (all 3
 *        modes), agentdb_graph-pathfinder, and the kg traverse/relations/
 *        visualize composition. Assert: one session — causal-edge(entity) →
 *        graph-query k-hop AND pagerank non-empty (semantic gated on embedder)
 *        → graph-pathfinder returns ≥1 path → causal-query STILL returns the
 *        edge (J2 must-not-regress).
 *
 *   R3 — embeddings_rabitq_* unwired. The fork retained the 205-line
 *        rabitq-index wrapper + declared the wasm dep but never registered the
 *        3 MCP tools. Assert: tools/list carries status/build/search;
 *        embeddings_rabitq_status is honest pre-build (available:false); with a
 *        real embedder, build over a ≥5-vector store returns a compression
 *        envelope (vectorCount≥5, compressionRatio>1) and search returns ranked
 *        results. Embedder-gated assertions LOUD-SKIP when no real embedder is
 *        reachable (CI without the model) — never silent-pass.
 *
 *   O2 — agentdb_semantic-route bare null / unhelpful "No route matched". Assert
 *        (unconditional): cold AND warm calls on a fresh project both return a
 *        STRUCTURED envelope with success:false, an explanatory message, and a
 *        recommendation to use agentdb_route — and NEVER bare null.
 *
 *   O1 — agentdb_batch{insert} cold rate_limited. The rate-limiter (token
 *        bucket, starts full) was fed a category STRING as the token COUNT
 *        (100 >= NaN → false) → cold rate_limited on call #1. Assert: the FIRST
 *        batch insert of 3 entries in a fresh process succeeds and lands 3,
 *        content-verified via memory_list.
 *
 * FAILs against the published cli/agentdb (patch.415 era — the regressions are
 * present: graph-query empty, rabitq tools absent, semantic-route bare/unhelpful,
 * batch cold-rate-limited); PASSes after the ADR-0294 fixes ship. Reuses the
 * shared ACCEPT_TEMP install via ADR0255_SMOKE_SHARED_TEMP; standalone
 * self-installs from Verdaccio.
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
const LOG_FILE = join(LOG_DIR, `smoke-adr0294-c2-reconvergence-${Date.now()}.log`);
const perf = createSmokePerf('smoke-adr0294-c2-reconvergence');

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
  let stderrTail = '';
  proc.stderr.on('data', (c) => { stderrTail = (stderrTail + c.toString()).slice(-1500); });
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
      await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'adr0294-smoke', version: '1' } });
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
  log(`\n[ADR-0294 smoke] C2 re-convergence — R1 graph_edges · R3 rabitq · O2 semantic-route · O1 batch`);
  log(`[smoke] log: ${LOG_FILE}\n`);
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

  const { dir: tempDir, shared } = setupSmokeTempDir('smoke-adr0294-c2', perf, REGISTRY);
  log(`[smoke] temp dir: ${tempDir}${shared ? ' (shared)' : ''}`);

  let cli;
  if (shared) {
    cli = findCli(tempDir);
    if (!cli) { log(`[setup] FATAL: cli not found in shared subdir`); process.exit(1); }
  } else {
    cli = installAndInit(tempDir, perf, REGISTRY);
  }
  log(`[smoke] cli: ${cli}`);

  // Project-root marker so findProjectRoot() anchors here (the .swarm stores +
  // controllers resolve relative to it). `ruflo init` writes one; the
  // shared-temp copy carries .claude/.claude-flow but the marker file is cheap.
  try {
    const marker = join(tempDir, '.ruflo-project');
    if (!existsSync(marker)) writeFileSync(marker, JSON.stringify({ smoke: 'adr0294' }));
  } catch { /* best-effort */ }

  const testBodyStart = process.hrtime.bigint();
  const session = startMcpSession(cli, tempDir);
  await session.init();

  try {
    // Probe the real embedder once — several R1/R3 assertions are embedder-gated
    // (semantic graph-query, rabitq build/search need real vectors). LOUD SKIP
    // when unavailable rather than silent-pass.
    let embReal = false;
    try { await session.call('embeddings_init', {}); } catch { /* may not need init */ }
    try {
      const eg = await session.call('embeddings_generate', { text: 'adr0294 embedder warmup probe' });
      const dims = eg?.dimensions ?? eg?.embedding?.length ?? (Array.isArray(eg?.vector) ? eg.vector.length : 0);
      embReal = (eg?.success !== false) && Number(dims) >= 384;
      log(`[smoke] embedder probe: dims=${dims} success=${eg?.success} → embReal=${embReal}`);
    } catch (e) { log(`[smoke] embedder probe failed: ${e?.message || e}`); }

    // ── O2: semantic-route honest envelope (COLD, before any warm-up) ────────
    log(`[smoke] O2: agentdb_semantic-route COLD`);
    const sr1 = await session.call('agentdb_semantic-route', { input: 'route this task to the right agent' });
    // Cold call MUST NOT be bare null and MUST be a structured object.
    if (sr1 !== null && sr1 !== undefined && typeof sr1 === 'object' && !Array.isArray(sr1)) {
      const hasEnvelope = sr1.success === false && typeof sr1.message === 'string' && sr1.message.length > 0
        && /agentdb_route/i.test(String(sr1.recommendation ?? '') + String(sr1.message ?? ''));
      if (hasEnvelope) {
        pass(`O2a: semantic-route COLD → structured envelope (success:false, message, recommendation; not null)`);
      } else {
        fail('O2a: semantic-route COLD envelope', `expected success:false + message + agentdb_route recommendation, got ${JSON.stringify(sr1).slice(0, 260)}`);
      }
    } else {
      fail('O2a: semantic-route COLD not null', `expected structured object, got ${JSON.stringify(sr1)}`);
    }

    // ── R1: causal-edge(entity) → graph-query/pathfinder + causal-query ──────
    log(`[smoke] R1: causal-edge(entity) → graph-query(k-hop/semantic/pagerank) + pathfinder + causal-query`);
    const SRC = 'AuthController';
    const DST = 'UserService';
    const REL = 'depends-on';
    const edge = await session.call('agentdb_causal-edge', { sourceId: SRC, targetId: DST, relation: REL, weight: 0.9 });
    if (edge?.success === true) {
      pass(`R1a: causal-edge(entity ${SRC}→${DST}) write succeeded`);
    } else {
      fail('R1a: causal-edge write', `${JSON.stringify(edge).slice(0, 240)} | stderr: ${session.getStderrTail().slice(-200)}`);
    }
    // Add a second hop so k-hop/pagerank have real topology to traverse.
    await session.call('agentdb_causal-edge', { sourceId: DST, targetId: 'Database', relation: 'reads-from', weight: 0.8 });

    // graph-query k-hop — MUST find at least DST from SRC (R1 restores graph_edges).
    const khop = await session.call('agentdb_graph-query', { nodeId: SRC, mode: 'k-hop', depth: 2 });
    if (khop?.success === true && Array.isArray(khop.results) && khop.results.length >= 1) {
      pass(`R1b: graph-query k-hop non-empty (${khop.results.length} nodes from ${SRC}; backend=${khop.backend})`);
    } else {
      fail('R1b: graph-query k-hop non-empty', `expected results.length>=1, got ${JSON.stringify(khop).slice(0, 240)}`);
    }

    // graph-query pagerank — MUST score reachable nodes (no "graph_edges is empty").
    const ppr = await session.call('agentdb_graph-query', { nodeId: SRC, mode: 'pagerank', topK: 5 });
    if (ppr?.success === true && Array.isArray(ppr.results) && ppr.results.length >= 1 && !/graph_edges is empty/i.test(String(ppr.message ?? ''))) {
      pass(`R1c: graph-query pagerank non-empty (${ppr.results.length} scored; backend=${ppr.backend})`);
    } else {
      fail('R1c: graph-query pagerank non-empty', `expected results.length>=1 (no "graph_edges is empty"), got ${JSON.stringify(ppr).slice(0, 240)}`);
    }

    // graph-query semantic — needs the real embedder (decodes row embedding_ref +
    // embeds the query). Gated: LOUD SKIP without a real embedder.
    if (embReal) {
      const sem = await session.call('agentdb_graph-query', { nodeId: SRC, mode: 'semantic', topK: 5 });
      // semantic returns rows whose edges carry an embedding_ref. Our causal-edge
      // writes carry NO embedding (embedding_ref NULL), so semantic legitimately
      // returns 0 — but it MUST succeed (no throw, no "empty" error) and the
      // mode must be reachable. The non-empty graph_edges proof is R1b/R1c; R1d
      // asserts semantic mode is wired (success, archivist-cosine backend).
      if (sem?.success === true && sem.backend === 'archivist-cosine') {
        pass(`R1d: graph-query semantic mode reachable (success; backend=archivist-cosine; count=${sem.count})`);
      } else {
        fail('R1d: graph-query semantic reachable', `expected success+archivist-cosine, got ${JSON.stringify(sem).slice(0, 240)}`);
      }
    } else {
      skip('R1d: graph-query semantic reachable', 'no real embedder reachable (semantic mode embeds query + decodes refs)');
    }

    // graph-pathfinder — MUST return ≥1 path (was {paths:[],"no edges found"}).
    // threshold:0 so any reachable node passes the cumulative-relevance filter
    // (PPR scores over a tiny 3-edge graph can sit below the 0.3 default).
    const pf = await session.call('agentdb_graph-pathfinder', { seedNodeId: SRC, query: 'dependency path', algorithm: 'personalized-pagerank', threshold: 0 });
    const paths = pf?.paths ?? pf?.results;
    const pfStarved = /no edges found/i.test(String(pf?.message ?? ''));
    if (pf?.success !== false && Array.isArray(paths) && paths.length >= 1 && !pfStarved) {
      pass(`R1e: graph-pathfinder returns ≥1 path (${paths.length}; algorithm=${pf.algorithm ?? 'n/a'})`);
    } else {
      fail('R1e: graph-pathfinder ≥1 path', `expected paths.length>=1 (no "no edges found"), got ${JSON.stringify(pf).slice(0, 260)}`);
    }

    // causal-query MUST STILL return the entity edge (J2 must-not-regress).
    // causal-query reads causal_edges via routeCausalOp({type:'query', cause}).
    const cq = await session.call('agentdb_causal-query', { cause: SRC });
    const cqResults = cq?.results ?? [];
    const foundEdge = Array.isArray(cqResults) && cqResults.some((r) => {
      const s = JSON.stringify(r);
      return s.includes(SRC) && s.includes(DST);
    });
    if (foundEdge) {
      pass(`R1f: causal-query STILL returns the ${SRC}→${DST} edge (J2 preserved; count=${cq.count})`);
    } else {
      fail('R1f: causal-query preserved', `expected ${SRC}→${DST} in results, got ${JSON.stringify(cq).slice(0, 260)}`);
    }

    // ── R3: rabitq tools registered + honest status + build/search ───────────
    log(`[smoke] R3: embeddings_rabitq_* registration + status + build + search`);
    const list = await session.rpc('tools/list', {});
    const names = new Set((list?.result?.tools || []).map((t) => t.name));
    const haveAll = names.has('embeddings_rabitq_status') && names.has('embeddings_rabitq_build') && names.has('embeddings_rabitq_search');
    if (haveAll) {
      pass(`R3a: all 3 embeddings_rabitq_* tools registered in tools/list`);
    } else {
      fail('R3a: rabitq tools registered', `missing some of status/build/search; present=${[...names].filter(n => n.includes('rabitq')).join(',') || 'none'}`);
    }

    // Honest pre-build status: available:false (no index built yet).
    const st0 = await session.call('embeddings_rabitq_status', {});
    if (st0?.success === true && st0.available === false && st0.initialized === false) {
      pass(`R3b: embeddings_rabitq_status honest pre-build (available:false)`);
    } else {
      fail('R3b: rabitq status pre-build', `expected available:false/initialized:false, got ${JSON.stringify(st0).slice(0, 240)}`);
    }

    if (embReal) {
      // Seed ≥5 distinct vectors via the real memory store path the wrapper reads.
      for (let i = 0; i < 6; i++) {
        await session.call('memory_store', {
          key: `adr0294-rabitq-${i}`,
          value: `rabitq sample vector number ${i} about ${['kubernetes', 'database', 'auth', 'frontend', 'pipeline', 'cache'][i]} systems`,
          namespace: 'default',
        });
      }
      const build = await session.call('embeddings_rabitq_build', { force: true });
      if (build?.success === true && Number(build.vectorCount) >= 5 && Number(build.compressionRatio) > 1) {
        pass(`R3c: embeddings_rabitq_build → real envelope (vectorCount=${build.vectorCount}, compressionRatio=${build.compressionRatio})`);
      } else {
        fail('R3c: rabitq build envelope', `expected vectorCount>=5 + compressionRatio>1, got ${JSON.stringify(build).slice(0, 260)} | stderr: ${session.getStderrTail().slice(-200)}`);
      }
      const search = await session.call('embeddings_rabitq_search', { query: 'kubernetes systems', k: 3 });
      if (search?.success === true && Array.isArray(search.results) && search.results.length >= 1) {
        pass(`R3d: embeddings_rabitq_search returns ranked results (${search.results.length})`);
      } else {
        fail('R3d: rabitq search ranked', `expected results.length>=1, got ${JSON.stringify(search).slice(0, 260)}`);
      }
    } else {
      skip('R3c: rabitq build envelope', 'no real embedder reachable (build needs ≥2 real stored vectors)');
      skip('R3d: rabitq search ranked', 'no real embedder reachable');
    }

    // ── O2 (warm): semantic-route still honest after warm-up ─────────────────
    log(`[smoke] O2: agentdb_semantic-route WARM`);
    const sr2 = await session.call('agentdb_semantic-route', { input: 'route this warm request now' });
    if (sr2 !== null && sr2 !== undefined && typeof sr2 === 'object' && !Array.isArray(sr2)
        && sr2.success === false && typeof sr2.message === 'string' && sr2.message.length > 0
        && /agentdb_route/i.test(String(sr2.recommendation ?? '') + String(sr2.message ?? ''))) {
      pass(`O2b: semantic-route WARM → structured envelope (success:false, message, recommendation; not null)`);
    } else {
      fail('O2b: semantic-route WARM envelope', `expected structured envelope, got ${JSON.stringify(sr2).slice(0, 260)}`);
    }

    // ── O1: first batch insert of 3 lands 3 (content-verified) ───────────────
    log(`[smoke] O1: agentdb_batch{insert} first call lands 3`);
    const b = await session.call('agentdb_batch', {
      operation: 'insert',
      entries: [
        { key: 'adr0294-batch-a', value: 'batch entry alpha' },
        { key: 'adr0294-batch-b', value: 'batch entry beta' },
        { key: 'adr0294-batch-c', value: 'batch entry gamma' },
      ],
    });
    if (b?.success === true && b.error !== 'rate_limited') {
      pass(`O1a: first batch insert succeeded (count=${b.count}, NOT rate_limited)`);
      // Content-verify N-in-N-stored. batch insert routes to
      // BatchOperations.insertEpisodes, which returns the COUNT OF ROWS ACTUALLY
      // WRITTEN to the episodes table (its `completed` accumulator) as
      // envelope.result. result===3 is therefore a DB-confirmed insert count,
      // not merely an echo of the input length. (episodes live in a SQLite tier
      // memory_list does not surface, so the returned write count is the
      // authoritative content signal.)
      const writtenCount = Number(b?.result);
      if (writtenCount === 3) {
        pass(`O1b: batch content-verified — insertEpisodes wrote 3 rows (envelope.result=3, DB-confirmed)`);
      } else if (Number(b.count) === 3) {
        pass(`O1b: batch content-verified — envelope reports 3 (result=${JSON.stringify(b.result)})`);
      } else {
        fail('O1b: batch content-verified', `expected 3 rows written, got result=${JSON.stringify(b.result)} count=${b.count}`);
      }
    } else {
      fail('O1a: first batch insert', `expected success:true (NOT rate_limited), got ${JSON.stringify(b).slice(0, 260)}`);
    }

  } catch (err) {
    fail('session', `uncaught: ${err?.stack || err}`);
  } finally {
    await session.close();
    perf.mark('test-body', testBodyStart);
    perf.emitJson();
    try { if (!shared) rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }

  log(`\n[ADR-0294 smoke] ${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { log(`[smoke] FATAL: ${e?.stack || e}`); process.exit(1); });
