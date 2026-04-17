#!/usr/bin/env node
/**
 * diag-rvf-persist-trace.mjs
 *
 * ADR-0095 Sprint-1 Pass-2 instrumentation probe.
 *
 * Spawns N parallel `cli memory store` subprocesses like diag-rvf-interproc-race.mjs,
 * but patches the shipped @sparkleideas/memory/dist/rvf-backend.js in the harness
 * (non-destructive — copies to a scratch dir) to emit [S1.2-TRACE] lines on:
 *   - tryNativeInit entry/exit (hasNativeMagic, nativeDb assigned?, return value)
 *   - persistToDiskInner entry (whether nativeDb is set, target path, entries.size)
 *   - mergePeerStateBeforePersist entry (loadPath, nativeDb flag)
 *   - acquireLock / releaseLock (duration the lock was held)
 *   - appendToWal (before/after)
 *   - RvfDatabase.open / RvfDatabase.create error codes
 *
 * Output on stderr so it can be captured by the probe orchestrator.
 *
 * Usage:
 *   node scripts/diag-rvf-persist-trace.mjs              # defaults: N=6, 1 trial
 *   node scripts/diag-rvf-persist-trace.mjs 6 3          # N=6, 3 trials
 *   node scripts/diag-rvf-persist-trace.mjs --help
 *
 * Exit codes:
 *   0 — probe ran to completion (even if trials failed — this is a diagnostic)
 *   1 — harness setup failed (CLI install / init failed)
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI_VERSION = process.env.CLI_VERSION || '3.5.58-patch.137';
const REGISTRY = process.env.VERDACCIO_URL || 'http://localhost:4873';

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = { N: 6, trials: 1, help: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') { opts.help = true; continue; }
    if (!a.startsWith('--') && /^\d+$/.test(a)) {
      if (opts.N === 6 && i === 0) { opts.N = Number(a); continue; }
      if (i === 1) { opts.trials = Number(a); continue; }
    }
  }
  return opts;
}

function log(msg) { process.stderr.write(`[diag-persist-trace] ${msg}\n`); }

async function exec(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());
    proc.on('error', reject);
    proc.on('close', code => resolve({ code, stdout, stderr, pid: proc.pid }));
  });
}

/**
 * Patch the shipped dist/rvf-backend.js with [S1.2-TRACE] instrumentation.
 * Uses text replacement — brittle but scoped to a scratch copy of the CLI install.
 */
function instrumentRvfBackend(memoryDistPath) {
  const rvfPath = join(memoryDistPath, 'dist', 'rvf-backend.js');
  const original = readFileSync(rvfPath, 'utf-8');

  // Emit a trace header marker so we can confirm the patched file was used
  const header = `
// [S1.2-TRACE] INSTRUMENTED BY diag-rvf-persist-trace.mjs
const _S12_trace_pid = process.pid;
function _s12_trace(tag, data) {
  try {
    const d = data ? ' ' + JSON.stringify(data) : '';
    process.stderr.write('[S1.2-TRACE pid=' + _S12_trace_pid + ' ' + tag + d + ']\\n');
  } catch {}
}
_s12_trace('module-loaded');
`;

  let patched = original.replace(
    /^import /,
    () => header + '\nimport ',
  );

  // Only the first replace matters — the header sits at top of the file now.
  if (patched === original) {
    // No 'import' at start of line — fallback: just prepend
    patched = header + '\n' + original;
  }

  // Instrument tryNativeInit entry
  patched = patched.replace(
    /async tryNativeInit\(\) \{/,
    'async tryNativeInit() {\n        _s12_trace("tryNativeInit-entry", { dbPath: this.config.databasePath });',
  );

  // Instrument SFVR peek result
  patched = patched.replace(
    /if \(hasNativeMagic\) \{/,
    'if (hasNativeMagic) { _s12_trace("tryNativeInit-sfvr-detected", { dbPath: this.config.databasePath });',
  );

  // Instrument RvfDatabase.open call
  patched = patched.replace(
    /this\.nativeDb = rvf\.RvfDatabase\.open\(/g,
    '_s12_trace("rvfdb-open-attempt", { dbPath: this.config.databasePath }); this.nativeDb = rvf.RvfDatabase.open(',
  );

  // Instrument RvfDatabase.create call
  patched = patched.replace(
    /this\.nativeDb = rvf\.RvfDatabase\.create\(/g,
    '_s12_trace("rvfdb-create-attempt", { dbPath: this.config.databasePath }); this.nativeDb = rvf.RvfDatabase.create(',
  );

  // Instrument persistToDiskInner entry
  patched = patched.replace(
    /async persistToDiskInner\(\) \{/,
    'async persistToDiskInner() { _s12_trace("persistToDiskInner-entry", { hasNative: !!this.nativeDb, entriesSize: this.entries.size, seenIdsSize: this.seenIds.size });',
  );

  // Instrument mergePeerStateBeforePersist entry
  patched = patched.replace(
    /async mergePeerStateBeforePersist\(\) \{/,
    'async mergePeerStateBeforePersist() { _s12_trace("mergePeerStateBeforePersist-entry", { hasNative: !!this.nativeDb, entriesBefore: this.entries.size });',
  );

  // Instrument acquireLock entry/exit
  patched = patched.replace(
    /async acquireLock\(\) \{/,
    'async acquireLock() { const _s12_lock_t0 = Date.now(); _s12_trace("acquireLock-enter");',
  );
  patched = patched.replace(
    /return; \/\/ Lock acquired/,
    '_s12_trace("acquireLock-granted", { waitMs: Date.now() - _s12_lock_t0 }); return; // Lock acquired',
  );

  // Instrument releaseLock
  patched = patched.replace(
    /async releaseLock\(\) \{/,
    'async releaseLock() { _s12_trace("releaseLock");',
  );

  // Instrument compactWal entry
  patched = patched.replace(
    /async compactWal\(\) \{/,
    'async compactWal() { _s12_trace("compactWal-entry", { hasNative: !!this.nativeDb, walEntryCount: this.walEntryCount });',
  );

  // Instrument store entry
  patched = patched.replace(
    /async store\(entry\) \{/,
    'async store(entry) { _s12_trace("store-entry", { id: entry.id, key: entry.key });',
  );

  // Instrument appendToWal
  patched = patched.replace(
    /async appendToWal\(entry\) \{/,
    'async appendToWal(entry) { _s12_trace("appendToWal-entry", { id: entry.id });',
  );

  writeFileSync(rvfPath, patched, 'utf-8');
  log(`instrumented ${rvfPath} (${patched.length - original.length} bytes added)`);
}

async function setupHarness() {
  const dir = mkdtempSync(join(tmpdir(), 'rvf-persist-trace-harness-'));
  log(`harness setup: ${dir}`);
  await exec('npm', ['init', '-y'], { cwd: dir });
  const install = await exec(
    'npm',
    ['install', `@sparkleideas/cli@${CLI_VERSION}`, '--no-audit', '--silent', `--registry=${REGISTRY}`],
    { cwd: dir },
  );
  if (install.code !== 0) {
    log(`npm install FAILED (code=${install.code})`);
    log(install.stderr.slice(0, 600));
    return null;
  }

  // Patch the shipped rvf-backend.js
  const memoryDist = join(dir, 'node_modules', '@sparkleideas', 'memory');
  if (!existsSync(join(memoryDist, 'dist', 'rvf-backend.js'))) {
    log('rvf-backend.js not found in harness memory dist');
    return null;
  }
  instrumentRvfBackend(memoryDist);

  return dir;
}

async function setupTrialDir(harnessDir, label) {
  const cliBin = join(harnessDir, 'node_modules', '.bin', 'cli');
  const trialDir = mkdtempSync(join(tmpdir(), `rvf-persist-trace-${label}-`));
  const init = await exec(cliBin, ['init', '--full'], { cwd: trialDir });
  if (init.code !== 0) {
    log(`cli init FAILED for ${label} (code=${init.code})`);
    log(init.stderr.slice(0, 400));
    return null;
  }
  return { trialDir, cliBin };
}

async function fireSubprocesses(trialDir, cliBin, trialLabel, n) {
  const procs = [];
  for (let i = 1; i <= n; i++) {
    const key = `trace-${trialLabel}-${i}`;
    const value = `v-${trialLabel}-${i}`;
    procs.push(exec(cliBin, [
      'memory', 'store',
      '--key', key,
      '--value', value,
      '--namespace', `trace-${trialLabel}`,
    ], { cwd: trialDir, env: process.env }));
  }
  return await Promise.all(procs);
}

function inspectMeta(dir) {
  const metaPath = join(dir, '.swarm', 'memory.rvf.meta');
  if (!existsSync(metaPath)) return { found: false, entryCount: null };
  const buf = readFileSync(metaPath);
  if (buf.length < 8) return { found: true, entryCount: null };
  const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
  if (magic !== 'RVF\x00') return { found: true, entryCount: null, magic };
  const headerLen = buf.readUInt32LE(4);
  if (8 + headerLen > buf.length) return { found: true, entryCount: null };
  try {
    const header = JSON.parse(buf.subarray(8, 8 + headerLen).toString('utf-8'));
    return { found: true, entryCount: header.entryCount, header };
  } catch (e) { return { found: true, entryCount: null, err: e.message }; }
}

function emitTraceLines(trialLabel, N, results) {
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const traceLines = (r.stderr || '').split('\n').filter(l => l.includes('[S1.2-TRACE'));
    process.stderr.write(
      `[diag-persist-trace] trial=${trialLabel} N=${N} writer=${i + 1} pid=${r.pid} exit=${r.code} ` +
      `traceLines=${traceLines.length}\n`,
    );
    // Emit first 8 trace lines for this writer
    for (const l of traceLines.slice(0, 8)) {
      process.stderr.write(`  ${l}\n`);
    }
    if (r.code !== 0) {
      const errLine = (r.stderr || '').split('\n').find(l => l.includes('ERROR')) || '';
      process.stderr.write(`  STDERR-ERROR: ${errLine.slice(0, 200)}\n`);
    }
  }
}

async function runTrial(harnessDir, N, trialLabel) {
  const setup = await setupTrialDir(harnessDir, trialLabel);
  if (!setup) return null;
  const { trialDir, cliBin } = setup;
  const t0 = Date.now();
  const results = await fireSubprocesses(trialDir, cliBin, trialLabel, N);
  const elapsed = Date.now() - t0;
  const meta = inspectMeta(trialDir);
  log(`trial=${trialLabel} N=${N} entryCount=${meta.entryCount} elapsed=${elapsed}ms`);
  emitTraceLines(trialLabel, N, results);
  try { rmSync(trialDir, { recursive: true, force: true }); } catch {}
  return { N, trialLabel, entryCount: meta.entryCount, elapsed, results };
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    process.stdout.write([
      'diag-rvf-persist-trace.mjs — [S1.2-TRACE] instrumented RVF persist-path probe',
      '',
      'Usage: node scripts/diag-rvf-persist-trace.mjs [N] [trials]',
      '  N         writers per trial (default 6)',
      '  trials    number of trials (default 1)',
      '',
      'Emits [S1.2-TRACE] lines to stderr for each internal RvfBackend step.',
      'Complements diag-rvf-interproc-race.mjs by showing WHERE each writer stops.',
      '',
    ].join('\n') + '\n');
    process.exit(0);
  }
  log(`cli=${CLI_VERSION} registry=${REGISTRY} N=${opts.N} trials=${opts.trials}`);
  const harness = await setupHarness();
  if (!harness) { log('harness setup failed'); process.exit(1); }
  try {
    for (let t = 1; t <= opts.trials; t++) {
      await runTrial(harness, opts.N, `t${t}`);
    }
  } finally {
    try { rmSync(harness, { recursive: true, force: true }); } catch {}
  }
  process.exit(0);
}

main().catch(e => { log(`fatal: ${e.stack || e.message}`); process.exit(1); });
