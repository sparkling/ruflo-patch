#!/usr/bin/env node
/**
 * diag-rvf-read-matrix.mjs
 *
 * S1.4B empirical read-side probe (ADR-0094 Sprint 1.4).
 *
 * The write side converges (entryCount=N in meta header, all CLIs exit 0,
 * fork commit e6901f397). This probe characterizes what the *read* primitives
 * see AFTER convergent writes.
 *
 * Experiments:
 *   1  concurrent writes → every read primitive matrix
 *   2  scale N across {2,4,6,8}
 *   3  sequential writes (baseline — is it concurrency, or multi-invocation?)
 *   4  read variants: fresh process vs reinit vs MCP tool
 *   5  intermediate-state sampling (after writes 1..N, list count?)
 *   6  file byte snapshot delta across a read (does read mutate state?)
 *
 * Usage:
 *   node scripts/diag-rvf-read-matrix.mjs --exp 1 --N 6
 *   node scripts/diag-rvf-read-matrix.mjs --exp 2                  # runs N=2,4,6,8
 *   node scripts/diag-rvf-read-matrix.mjs --exp 3 --N 6
 *   node scripts/diag-rvf-read-matrix.mjs --exp 4 --N 6
 *   node scripts/diag-rvf-read-matrix.mjs --exp 5 --N 6
 *   node scripts/diag-rvf-read-matrix.mjs --exp 6 --N 6
 *   node scripts/diag-rvf-read-matrix.mjs --exp all --N 6 --repeats 3
 *
 * Emits JSON to stdout at end: { experiment, N, reps, results: [...], summary }
 *
 * Exit codes:
 *   0 — probe ran cleanly (observations only — divergence does NOT fail)
 *   1 — probe infra failure (CLI install, init, etc.)
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { createHash as cryptoHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI_VERSION = process.env.CLI_VERSION || '3.5.58-patch.144';
const REGISTRY = process.env.VERDACCIO_URL || 'http://localhost:4873';

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = { exp: '1', N: 6, repeats: 1, json: true };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--exp') { opts.exp = args[++i]; continue; }
    if (a === '--N') { opts.N = Number(args[++i]); continue; }
    if (a === '--repeats') { opts.repeats = Number(args[++i]); continue; }
    if (a === '--no-json') { opts.json = false; continue; }
    if (a === '--help' || a === '-h') {
      process.stdout.write('Usage: diag-rvf-read-matrix.mjs --exp {1..6|all} [--N 6] [--repeats 1]\n');
      process.exit(0);
    }
  }
  return opts;
}

function log(msg) { process.stderr.write(`[diag-read-matrix] ${msg}\n`); }

async function exec(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', (e) => resolve({ code: -1, stdout, stderr: String(e), pid: null }));
    proc.on('close', (code) => resolve({ code, stdout, stderr, pid: proc.pid }));
  });
}

let _harnessDir = null;
async function setupHarness() {
  if (_harnessDir && existsSync(join(_harnessDir, 'node_modules', '.bin', 'cli'))) return _harnessDir;
  const dir = mkdtempSync(join(tmpdir(), 's1.4b-harness-'));
  log(`harness: ${dir}`);
  await exec('npm', ['init', '-y'], { cwd: dir });
  const r = await exec('npm', ['install', `@sparkleideas/cli@${CLI_VERSION}`, '--no-audit', '--silent', `--registry=${REGISTRY}`], { cwd: dir });
  if (r.code !== 0) { log(`npm install failed: ${r.stderr.slice(0, 400)}`); return null; }
  _harnessDir = dir;
  return dir;
}

async function setupTrialDir(harness, label) {
  const cliBin = join(harness, 'node_modules', '.bin', 'cli');
  const dir = mkdtempSync(join(tmpdir(), `s1.4b-${label}-`));
  const init = await exec(cliBin, ['init', '--full'], { cwd: dir });
  if (init.code !== 0) { log(`cli init ${label} failed: ${init.stderr.slice(0, 200)}`); return null; }
  return { trialDir: dir, cliBin };
}

// --- Write primitives ---
async function concurrentStores(trialDir, cliBin, namespace, N, keyPrefix = 'k') {
  const procs = [];
  const keys = [];
  for (let i = 1; i <= N; i++) {
    const key = `${keyPrefix}-${i}`;
    keys.push(key);
    procs.push(exec(cliBin, ['memory', 'store', '--key', key, '--value', `v-${i}`, '--namespace', namespace], { cwd: trialDir }));
  }
  const results = await Promise.all(procs);
  return { results, keys, writesOk: results.filter(r => r.code === 0).length };
}

async function sequentialStores(trialDir, cliBin, namespace, N, keyPrefix = 'seq') {
  const results = [];
  const keys = [];
  for (let i = 1; i <= N; i++) {
    const key = `${keyPrefix}-${i}`;
    keys.push(key);
    const r = await exec(cliBin, ['memory', 'store', '--key', key, '--value', `v-${i}`, '--namespace', namespace], { cwd: trialDir });
    results.push(r);
  }
  return { results, keys, writesOk: results.filter(r => r.code === 0).length };
}

// --- Read primitives ---
async function readList(trialDir, cliBin, namespace) {
  const r = await exec(cliBin, ['memory', 'list', '--namespace', namespace, '--limit', '100'], { cwd: trialDir });
  return { ...r, parse: parseListOutput(r.stdout) };
}

async function readRetrieve(trialDir, cliBin, key, namespace) {
  const r = await exec(cliBin, ['memory', 'retrieve', '--key', key, '--namespace', namespace], { cwd: trialDir });
  // retrieve exit=0 and value in stdout means hit
  return { ...r, hit: r.code === 0 && /v-\d+/.test(r.stdout) };
}

async function readSearch(trialDir, cliBin, query, namespace) {
  const r = await exec(cliBin, ['memory', 'search', '--query', query, '--namespace', namespace, '--limit', '50'], { cwd: trialDir });
  return { ...r, parse: parseSearchOutput(r.stdout) };
}

async function mcpExec(trialDir, cliBin, tool, params) {
  const r = await exec(cliBin, ['mcp', 'exec', '--tool', tool, '--params', JSON.stringify(params)], { cwd: trialDir });
  return { ...r, parse: parseMcpOutput(r.stdout) };
}

// --- Output parsers ---
function parseListOutput(stdout) {
  // CLI list output is typically human formatted; count lines with key markers.
  // Accept lines containing "k-" or "seq-" as hits. Also try JSON parse.
  try {
    const j = JSON.parse(stdout);
    if (Array.isArray(j)) return { keys: j.map(e => e.key || e).filter(Boolean), rawCount: j.length };
    if (j && Array.isArray(j.entries)) return { keys: j.entries.map(e => e.key).filter(Boolean), rawCount: j.entries.length };
  } catch { /* not JSON */ }
  // Human format: `| key | namespace | size | ...` table rows from `memory list`
  // and `| key | score | namespace | preview |` rows from `memory search`.
  // Parse table rows: a line starting with `|` and containing a short alnum/dash key cell.
  const keys = new Set();
  const lines = stdout.split('\n');
  for (const line of lines) {
    // Skip header / separator rows
    if (!line.startsWith('|')) continue;
    if (/^\|[\s-+]+\|?$/.test(line)) continue;
    if (/\|\s*Key\s*\|/.test(line)) continue;
    // Extract first cell (trimmed) — the key
    const m = line.match(/^\|\s*([A-Za-z0-9][A-Za-z0-9._-]{0,63})\s*\|/);
    if (m) {
      const k = m[1];
      // Exclude table decoration artifacts
      if (k === 'Key' || k === 'Property' || k === 'Value' || k === 'Namespace') continue;
      keys.add(k);
    }
  }
  // Also look for explicit "X entries"/"Showing X of Y" total
  let totalReported = null;
  const showM = stdout.match(/Showing\s+(\d+)\s+of\s+(\d+)/i);
  if (showM) totalReported = Number(showM[2]);
  else {
    const totalM = stdout.match(/(\d+)\s+(entries|results|items|keys|records)/i);
    if (totalM) totalReported = Number(totalM[1]);
  }
  return { keys: [...keys], rawCount: keys.size, totalReported };
}

function parseSearchOutput(stdout) {
  return parseListOutput(stdout);
}

function parseMcpOutput(stdout) {
  // MCP tool output embeds JSON after `Result:\n`. Parse greedy from first `{`
  // to last `}` (multiline).
  const marker = 'Result:';
  const idx = stdout.indexOf(marker);
  const jsonStart = idx === -1 ? stdout.indexOf('{') : stdout.indexOf('{', idx);
  if (jsonStart === -1) return { keys: [], rawCount: 0, parseErr: 'no json' };
  const jsonEnd = stdout.lastIndexOf('}');
  if (jsonEnd <= jsonStart) return { keys: [], rawCount: 0, parseErr: 'unbalanced' };
  const raw = stdout.slice(jsonStart, jsonEnd + 1);
  try {
    const j = JSON.parse(raw);
    // Common shapes: {entries:[...]}, {results:[...]}, {content:[{text:...}]}
    if (Array.isArray(j.entries)) return { keys: j.entries.map(e => e.key).filter(Boolean), rawCount: j.entries.length, total: j.total };
    if (Array.isArray(j.results)) return { keys: j.results.map(e => e.key || e.id).filter(Boolean), rawCount: j.results.length, total: j.total };
    if (Array.isArray(j.content)) {
      const txt = j.content.map(c => c.text || '').join('\n');
      return parseListOutput(txt);
    }
    if (Array.isArray(j)) return { keys: j.map(e => e.key).filter(Boolean), rawCount: j.length };
    return { keys: [], rawCount: 0, shape: Object.keys(j).join(',') };
  } catch (e) {
    return { keys: [], rawCount: 0, parseErr: e.message };
  }
}

// --- Meta file inspection (for Exp 6) ---
function inspectRvfFiles(trialDir) {
  const swarmDir = join(trialDir, '.swarm');
  if (!existsSync(swarmDir)) return { exists: false };
  const files = {};
  for (const name of readdirSync(swarmDir)) {
    if (!name.startsWith('memory.rvf')) continue;
    const p = join(swarmDir, name);
    const stat = statSync(p);
    const buf = readFileSync(p);
    const sha = cryptoHash('sha256').update(buf).digest('hex').slice(0, 16);
    files[name] = { size: stat.size, sha, mtimeMs: stat.mtimeMs };
    if (name === 'memory.rvf.meta' && buf.length >= 8) {
      const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
      if (magic === 'RVF\x00') {
        const headerLen = buf.readUInt32LE(4);
        if (8 + headerLen <= buf.length) {
          try {
            const hdr = JSON.parse(buf.subarray(8, 8 + headerLen).toString('utf-8'));
            files[name].entryCount = hdr.entryCount;
          } catch { /* */ }
        }
      }
    }
  }
  return { exists: true, files };
}

// --- Experiments ---
async function expReadMatrix(harness, N, repI, mode = 'concurrent') {
  // mode = 'concurrent' | 'sequential'
  const setup = await setupTrialDir(harness, `e1-${mode}-${repI}`);
  if (!setup) return null;
  const { trialDir, cliBin } = setup;
  const ns = `probe-ns-${mode}-${repI}`;
  const keyPrefix = mode === 'sequential' ? 'seq' : 'k';

  const writes = mode === 'sequential'
    ? await sequentialStores(trialDir, cliBin, ns, N, keyPrefix)
    : await concurrentStores(trialDir, cliBin, ns, N, keyPrefix);

  const meta = inspectRvfFiles(trialDir);
  const metaEntryCount = meta.exists && meta.files['memory.rvf.meta']
    ? meta.files['memory.rvf.meta'].entryCount : null;

  // reads (each is a fresh CLI process)
  const listR = await readList(trialDir, cliBin, ns);
  const retrieves = [];
  for (const key of writes.keys) {
    const r = await readRetrieve(trialDir, cliBin, key, ns);
    retrieves.push({ key, hit: r.hit, code: r.code });
  }
  const searchR = await readSearch(trialDir, cliBin, 'v-', ns);
  const mcpList = await mcpExec(trialDir, cliBin, 'memory_list', { namespace: ns });
  const mcpSearch = await mcpExec(trialDir, cliBin, 'memory_search', { query: 'v-', namespace: ns, limit: 50 });

  // cleanup
  try { rmSync(trialDir, { recursive: true, force: true }); } catch { /* */ }

  return {
    N, rep: repI, mode,
    writesOk: writes.writesOk,
    metaEntryCount,
    listHits: listR.parse.rawCount,
    listKeys: listR.parse.keys,
    listStderr: listR.stderr.slice(0, 200),
    retrieveHits: retrieves.filter(r => r.hit).length,
    retrieveDetail: retrieves,
    searchHits: searchR.parse.rawCount,
    mcpListHits: mcpList.parse.rawCount,
    mcpListStderr: mcpList.stderr.slice(0, 200),
    mcpSearchHits: mcpSearch.parse.rawCount,
    mcpSearchStderr: mcpSearch.stderr.slice(0, 200),
  };
}

async function expScaleN(harness, repI) {
  const results = [];
  for (const N of [2, 4, 6, 8]) {
    const r = await expReadMatrix(harness, N, `${repI}-N${N}`, 'concurrent');
    if (r) results.push(r);
  }
  return results;
}

async function expSequential(harness, N, repI) {
  return expReadMatrix(harness, N, repI, 'sequential');
}

async function expReadVariants(harness, N, repI) {
  // After 6 parallel writes, try: same-dir fresh read / reinit-dir / mcp
  const setup = await setupTrialDir(harness, `e4-${repI}`);
  if (!setup) return null;
  const { trialDir, cliBin } = setup;
  const ns = `probe-variant-${repI}`;
  const writes = await concurrentStores(trialDir, cliBin, ns, N, 'k');

  const metaBefore = inspectRvfFiles(trialDir);

  // Read A: fresh CLI in same dir
  const readA = await readList(trialDir, cliBin, ns);

  // Read B: cli init --full AGAIN in same dir; then read
  const reinit = await exec(cliBin, ['init', '--full'], { cwd: trialDir });
  const readB = await readList(trialDir, cliBin, ns);

  // Read C: MCP tool
  const readC = await mcpExec(trialDir, cliBin, 'memory_list', { namespace: ns });

  const metaAfter = inspectRvfFiles(trialDir);

  try { rmSync(trialDir, { recursive: true, force: true }); } catch { /* */ }
  return {
    N, rep: repI, mode: 'variants',
    writesOk: writes.writesOk,
    metaBeforeEntryCount: metaBefore.files?.['memory.rvf.meta']?.entryCount ?? null,
    metaAfterEntryCount: metaAfter.files?.['memory.rvf.meta']?.entryCount ?? null,
    readA_listHits: readA.parse.rawCount,
    reinitCode: reinit.code,
    readB_listHitsAfterReinit: readB.parse.rawCount,
    readC_mcpListHits: readC.parse.rawCount,
  };
}

async function expIntermediate(harness, N, repI) {
  // After each sequential write 1..N, do a list and capture count
  const setup = await setupTrialDir(harness, `e5-${repI}`);
  if (!setup) return null;
  const { trialDir, cliBin } = setup;
  const ns = `probe-intermediate-${repI}`;
  const samples = [];
  for (let i = 1; i <= N; i++) {
    const key = `inc-${i}`;
    const w = await exec(cliBin, ['memory', 'store', '--key', key, '--value', `v-${i}`, '--namespace', ns], { cwd: trialDir });
    const meta = inspectRvfFiles(trialDir);
    const listR = await readList(trialDir, cliBin, ns);
    samples.push({
      afterWrite: i,
      writeCode: w.code,
      metaEntryCount: meta.files?.['memory.rvf.meta']?.entryCount ?? null,
      listHits: listR.parse.rawCount,
      listKeys: listR.parse.keys,
    });
  }
  try { rmSync(trialDir, { recursive: true, force: true }); } catch { /* */ }
  return { N, rep: repI, mode: 'intermediate', samples };
}

async function expSnapshot(harness, N, repI) {
  // Write N concurrently. Snapshot files. Do a list. Snapshot again. Diff.
  const setup = await setupTrialDir(harness, `e6-${repI}`);
  if (!setup) return null;
  const { trialDir, cliBin } = setup;
  const ns = `probe-snapshot-${repI}`;
  const writes = await concurrentStores(trialDir, cliBin, ns, N, 'k');

  const snapshotBefore = inspectRvfFiles(trialDir);

  // Do ONE list read
  const listR = await readList(trialDir, cliBin, ns);

  const snapshotAfter = inspectRvfFiles(trialDir);

  // Diff the files
  const filesBefore = snapshotBefore.files || {};
  const filesAfter = snapshotAfter.files || {};
  const allNames = new Set([...Object.keys(filesBefore), ...Object.keys(filesAfter)]);
  const diffs = [];
  for (const name of allNames) {
    const before = filesBefore[name];
    const after = filesAfter[name];
    if (!before && after) diffs.push({ name, change: 'added', afterSize: after.size });
    else if (before && !after) diffs.push({ name, change: 'removed', beforeSize: before.size });
    else if (before && after) {
      if (before.sha !== after.sha || before.size !== after.size) {
        diffs.push({
          name,
          change: 'modified',
          beforeSize: before.size,
          afterSize: after.size,
          beforeSha: before.sha,
          afterSha: after.sha,
          beforeEntryCount: before.entryCount,
          afterEntryCount: after.entryCount,
        });
      }
    }
  }

  try { rmSync(trialDir, { recursive: true, force: true }); } catch { /* */ }
  return {
    N, rep: repI, mode: 'snapshot',
    writesOk: writes.writesOk,
    filesBefore: Object.fromEntries(Object.entries(filesBefore).map(([k, v]) => [k, { size: v.size, sha: v.sha, entryCount: v.entryCount }])),
    filesAfter: Object.fromEntries(Object.entries(filesAfter).map(([k, v]) => [k, { size: v.size, sha: v.sha, entryCount: v.entryCount }])),
    diffs,
    listHits: listR.parse.rawCount,
  };
}

async function main() {
  const opts = parseArgs(process.argv);
  const harness = await setupHarness();
  if (!harness) { log('harness setup failed'); process.exit(1); }

  const results = [];
  const which = opts.exp === 'all' ? ['1', '2', '3', '4', '5', '6'] : [opts.exp];
  for (const exp of which) {
    for (let rep = 1; rep <= opts.repeats; rep++) {
      log(`running exp=${exp} rep=${rep}/${opts.repeats} N=${opts.N}`);
      let r;
      switch (exp) {
        case '1': r = await expReadMatrix(harness, opts.N, rep, 'concurrent'); break;
        case '2': r = await expScaleN(harness, rep); break;
        case '3': r = await expSequential(harness, opts.N, rep); break;
        case '4': r = await expReadVariants(harness, opts.N, rep); break;
        case '5': r = await expIntermediate(harness, opts.N, rep); break;
        case '6': r = await expSnapshot(harness, opts.N, rep); break;
        default: log(`unknown exp: ${exp}`); continue;
      }
      if (r) results.push({ exp, rep, r });
    }
  }

  const payload = {
    cliVersion: CLI_VERSION,
    experiment: opts.exp,
    N: opts.N,
    repeats: opts.repeats,
    timestamp: new Date().toISOString(),
    results,
  };
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  process.exit(0);
}

main().catch(e => { log(`FATAL: ${e.message}`); console.error(e); process.exit(1); });
