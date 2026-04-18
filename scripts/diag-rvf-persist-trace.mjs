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

const CLI_VERSION = process.env.CLI_VERSION || '3.5.58-patch.139';
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

  // PASS-3: Instrument the three return-false branches inside tryNativeInit so
  // we know WHY writer 6 fell to pure-TS. Patterns we inject on:
  //   (a) module-resolution catch's `return false`
  //   (b) pure-TS-owned-file `return false`
  //   (c) create ENOENT `return false`
  // In the compiled JS the shape is:  if (code === 'MODULE_NOT_FOUND' ...) { ... return false; }
  patched = patched.replace(
    /if \(code === 'MODULE_NOT_FOUND' \|\| code === 'ERR_MODULE_NOT_FOUND'\) \{[\s\S]*?return false;\s*\}/,
    (m) => m.replace(
      /return false;/,
      `_s12_trace("tryNativeInit-return-false", { reason: "MODULE_NOT_FOUND", code });
                return false;`,
    ),
  );
  // Pure-TS-owned fallback (SFVR not detected, file exists, return false before create)
  patched = patched.replace(
    /if \(this\.config\.verbose\) \{\s*console\.log\(\s*`\[RvfBackend\] Main path \$\{this\.config\.databasePath\} exists without SFVR[\s\S]*?\);\s*\}\s*return false;/,
    (m) => m.replace(/return false;/, `_s12_trace("tryNativeInit-return-false", { reason: "pure-TS-owned-file" });
            return false;`),
  );
  // create ENOENT cold-start fallback
  patched = patched.replace(
    /if \(code === 'ENOENT'\) \{[\s\S]*?return false;\s*\}/,
    (m) => m.replace(/return false;/, `_s12_trace("tryNativeInit-return-false", { reason: "create-ENOENT", code });
                return false;`),
  );
  // Also: instrument the module-import itself with full error detail (fallback-path
  // probe for writer 6's symptom)
  patched = patched.replace(
    /rvf = await import\('@ruvector\/rvf-node'\);/,
    `rvf = await import('@ruvector/rvf-node');
            _s12_trace("native-import-ok", { hasDefault: !!(rvf && rvf.default) });`,
  );
  patched = patched.replace(
    /} catch \(err\) \{\s*\/\/ Benign: module not installed/,
    `} catch (err) {
            try {
              _s12_trace("native-import-error", {
                code: err && err.code,
                causeCode: err && err.cause && err.cause.code,
                name: err && err.name,
                message: String(err && err.message || err).slice(0, 300),
              });
            } catch {}
            // Benign: module not installed`,
  );

  // Instrument SFVR peek result
  patched = patched.replace(
    /if \(hasNativeMagic\) \{/,
    'if (hasNativeMagic) { _s12_trace("tryNativeInit-sfvr-detected", { dbPath: this.config.databasePath });',
  );

  // PASS-3: after the openSync + readSync peek, log the actual bytes read so we
  // can confirm the empty/partial-file hypothesis for writers that go pure-TS.
  // Compiled JS shape:
  //   if (bytesRead === 4) {
  //     const peek = String.fromCharCode(...);
  //     if (peek === NATIVE_MAGIC) hasNativeMagic = true;
  //   }
  // Add trace BEFORE the inner if so bytesRead/peek/hasNativeMagic are visible.
  patched = patched.replace(
    /if \(bytesRead === 4\) \{\s*const peek = String\.fromCharCode/,
    `try {
                        _s12_trace("tryNativeInit-peek-result", {
                          dbPath: this.config.databasePath,
                          bytesRead,
                          byte0: head[0], byte1: head[1], byte2: head[2], byte3: head[3],
                          peekStr: bytesRead >= 4 ? String.fromCharCode(head[0],head[1],head[2],head[3]) : '(short)',
                          fileSize: (function(){ try { return require('node:fs').statSync(this.config.databasePath).size; } catch { return -1; } }).call(this),
                        });
                      } catch {}
                      if (bytesRead === 4) {
                        const peek = String.fromCharCode`,
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

  // ──────────────────────────────────────────────────────────────────────
  // PASS-3 additions — unwrap the error path, capture Pass-2's masked cause
  // ──────────────────────────────────────────────────────────────────────

  // Instrument initialize entry with dbPath + walPath + lockPath + parent-dir-exists flag.
  // The question H8 asks is: does the parent dir exist when acquireLock() is first called?
  patched = patched.replace(
    /async initialize\(\) \{[\s\S]*?if \(this\.initialized\) return;/,
    (m) => m + `
    try {
      const _nodeFs = require('node:fs');
      const _nodePath = require('node:path');
      const _parent = this.config.databasePath === ':memory:' ? '' : _nodePath.dirname(this.config.databasePath);
      _s12_trace("initialize-enter", {
        dbPath: this.config.databasePath,
        walPath: this.walPath,
        lockPath: this.lockPath,
        parentDir: _parent,
        parentExists: _parent ? _nodeFs.existsSync(_parent) : null,
        dbExists: this.config.databasePath === ':memory:' ? false : _nodeFs.existsSync(this.config.databasePath),
      });
    } catch (__e) { _s12_trace("initialize-trace-error", { msg: String(__e && __e.message || __e) }); }`,
  );

  // Instrument acquireLock catch path: capture err.code + lockPath context.
  // Current code at the catch:
  //   } catch (e) {
  //     if (e.code !== 'EEXIST') throw e;
  // We want to emit a trace line before both branches (EEXIST retry + fatal throw).
  patched = patched.replace(
    /} catch \(e\) \{\s*if \(e\.code !== 'EEXIST'\) throw e;/,
    `} catch (e) {
        try {
          const _nodeFs2 = require('node:fs');
          const _nodePath2 = require('node:path');
          const _parent2 = _nodePath2.dirname(this.lockPath);
          _s12_trace("acquireLock-wx-error", {
            code: e && e.code,
            errno: e && e.errno,
            syscall: e && e.syscall,
            lockPath: this.lockPath,
            parentDir: _parent2,
            parentExists: _parent2 ? _nodeFs2.existsSync(_parent2) : null,
            msg: String(e && e.message || e).slice(0, 200),
            fatal: e && e.code !== 'EEXIST',
          });
        } catch {}
        if (e.code !== 'EEXIST') throw e;`,
  );

  // Also instrument the acquireLock 5s-budget-exhaustion throw.
  patched = patched.replace(
    /throw new Error\(\s*`Failed to acquire advisory lock after/,
    `_s12_trace("acquireLock-budget-exhausted", { attempts: attempt, elapsed: Date.now() - startTime });
      throw new Error(\`Failed to acquire advisory lock after`,
  );

  // Instrument reapStaleTmpFiles entry
  patched = patched.replace(
    /async reapStaleTmpFiles\(\) \{/,
    `async reapStaleTmpFiles() {
        try {
          const _nodeFs3 = require('node:fs');
          const _nodePath3 = require('node:path');
          const _parent3 = this.config.databasePath === ':memory:' ? '' : _nodePath3.dirname(this.config.databasePath);
          _s12_trace("reapStaleTmpFiles-enter", {
            dbPath: this.config.databasePath,
            parentDir: _parent3,
            parentExists: _parent3 ? _nodeFs3.existsSync(_parent3) : null,
          });
        } catch {}`,
  );

  // Instrument the atomic rename in persistToDiskInner — for the N6t6 silent-loss case.
  // Pattern in current source:  await rename(tmpPath, target);
  patched = patched.replace(
    /await rename\(tmpPath, target\);/,
    `_s12_trace("persistToDisk-rename", { tmpPath, target, entriesSize: this.entries.size });
      await rename(tmpPath, target);`,
  );

  // PASS-3: also instrument the SILENT CATCH inside mergePeerStateBeforePersist.
  // This catches BOTH readFile-ENOENT AND JSON.parse failures. If the N6t6
  // silent-loss case is caused by a transient .meta read/parse failure, this
  // will fire and we'll see it in the trace.
  // Pattern:   } catch {\n        // Read error — fall back
  patched = patched.replace(
    /} catch \{\s*\/\/ Read error — fall back/,
    `} catch (__mergeErr) {
        try {
          _s12_trace("mergePeer-silent-catch", {
            code: __mergeErr && __mergeErr.code,
            name: __mergeErr && __mergeErr.name,
            message: String(__mergeErr && __mergeErr.message || __mergeErr).slice(0, 300),
          });
        } catch {}
        // Read error — fall back`,
  );

  // PASS-3: also log the outcome of the merge — how many entries we merged in.
  // Instrument right before the outer "if (this.walPath && existsSync(this.walPath))"
  // which is at the END of mergePeerStateBeforePersist.
  // Simpler: instrument AFTER the outer catch closes.
  patched = patched.replace(
    /if \(this\.walPath && existsSync\(this\.walPath\)\) \{\s*await this\.replayWal\(\);/,
    `_s12_trace("mergePeer-pre-wal-replay", { entriesAfterMetaMerge: this.entries.size, walExists: !!(this.walPath && existsSync(this.walPath)) });
    if (this.walPath && existsSync(this.walPath)) {
      await this.replayWal();`,
  );

  writeFileSync(rvfPath, patched, 'utf-8');
  log(`instrumented ${rvfPath} (${patched.length - original.length} bytes added)`);
}

/**
 * PASS-3: also instrument storage-factory.js to unwrap the error cause that
 * gets lost when [StorageFactory] re-wraps the RvfBackend init failure.
 * The catch at around line 151 captures primaryError but the emitted message
 * only uses `.message` — err.stack + err.code are dropped. We insert a trace
 * line that emits the full chain BEFORE the rethrow, so the underlying
 * error's code and stack reach the logs.
 */
function instrumentStorageFactory(memoryDistPath) {
  const factoryPath = join(memoryDistPath, 'dist', 'storage-factory.js');
  if (!existsSync(factoryPath)) {
    log(`storage-factory.js not found at ${factoryPath} — skipping`);
    return;
  }
  const original = readFileSync(factoryPath, 'utf-8');
  // Use same _s12_trace helper — patch prepends a self-contained header so the
  // factory module can emit traces even if rvf-backend hasn't loaded yet.
  const header = `
// [S1.2-TRACE] INSTRUMENTED BY diag-rvf-persist-trace.mjs (storage-factory)
const _S12_factory_pid = process.pid;
function _s12_factory_trace(tag, data) {
  try {
    const d = data ? ' ' + JSON.stringify(data) : '';
    process.stderr.write('[S1.2-TRACE pid=' + _S12_factory_pid + ' factory-' + tag + d + ']\\n');
  } catch {}
}
`;
  let patched = original.replace(/^(import |"use strict";)/m, (m) => header + '\n' + m);
  if (patched === original) patched = header + '\n' + original;

  // Instrument the catch block. In the compiled JS the shape is roughly:
  //   catch (primaryError) {
  //     const msg = primaryError instanceof Error ? primaryError.message : String(primaryError);
  //     throw new Error(`[StorageFactory] ...`);
  //   }
  // We insert a trace line that preserves primaryError.code + .stack BEFORE the rethrow.
  patched = patched.replace(
    /catch \(primaryError\) \{[\s\S]*?const msg = /,
    (m) => `catch (primaryError) {
    try {
      _s12_factory_trace("createStorage-catch", {
        code: primaryError && primaryError.code,
        errno: primaryError && primaryError.errno,
        syscall: primaryError && primaryError.syscall,
        name: primaryError && primaryError.name,
        message: String(primaryError && primaryError.message || primaryError).slice(0, 400),
        causeCode: primaryError && primaryError.cause && primaryError.cause.code,
        causeMsg: primaryError && primaryError.cause && String(primaryError.cause.message || '').slice(0, 200),
        stack: String(primaryError && primaryError.stack || '').split('\\n').slice(0, 6).join(' || '),
      });
    } catch {}
    const msg = `,
  );

  writeFileSync(factoryPath, patched, 'utf-8');
  log(`instrumented ${factoryPath} (${patched.length - original.length} bytes added)`);
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
  instrumentStorageFactory(memoryDist);

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
    // Emit ALL trace lines for this writer so acquireLock-wx-error + factory-createStorage-catch land
    for (const l of traceLines) {
      process.stderr.write(`  ${l}\n`);
    }
    if (r.code !== 0) {
      // Emit all ERROR-tagged lines (not just first). Include full length for
      // the [StorageFactory] message so the unwrap is visible.
      const errLines = (r.stderr || '').split('\n').filter(l => /ERROR|Failed|error/i.test(l));
      for (const l of errLines.slice(0, 8)) {
        process.stderr.write(`  STDERR: ${l.slice(0, 600)}\n`);
      }
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
