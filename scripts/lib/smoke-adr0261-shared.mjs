/**
 * Shared helpers for ADR-0261 smokes (P1-P6).
 *
 * Provides:
 *   - Sub-check phase timing (`[perf] phase: Xms` + final `[perf-json]`)
 *   - Shared-temp reuse (ADR0261_SMOKE_SHARED_TEMP) per task spec
 *
 * Per `feedback-no-fallbacks`: if ADR0261_SMOKE_SHARED_TEMP is set but the
 * shared install is incomplete, FAIL loudly — never silently fall back to a
 * fresh install.
 *
 * Per `project-rvf-test-artifact-resolution`: all perf log lines go to
 * stderr (stdout is reserved for the MCP JSON-RPC channel).
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, symlinkSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function createSmokePerf(smokeName) {
  const phases = {};
  const totalStart = process.hrtime.bigint();
  return {
    mark(name, startBig) {
      const ms = Math.round(Number(process.hrtime.bigint() - startBig) / 1_000_000);
      phases[name] = ms;
      process.stderr.write(`[perf] ${name}: ${ms}ms\n`);
    },
    set(name, ms, suffix = '') {
      phases[name] = ms;
      process.stderr.write(`[perf] ${name}: ${ms}ms${suffix ? ` ${suffix}` : ''}\n`);
    },
    emitJson() {
      phases.total = Math.round(Number(process.hrtime.bigint() - totalStart) / 1_000_000);
      process.stderr.write(`[perf-json] ${JSON.stringify({ smoke: smokeName, phases })}\n`);
    },
    getPhases() { return phases; },
  };
}

/**
 * Returns the per-smoke working directory.
 *
 * If ADR0261_SMOKE_SHARED_TEMP is set, creates a sibling subdir under it
 * with the shared node_modules symlinked + the .claude / .claude-flow /
 * .swarm / CLAUDE.md tree copied for isolation. Returns `{ dir, shared: true }`.
 *
 * Otherwise creates a fresh `mkdtemp` under `os.tmpdir()` and returns
 * `{ dir, shared: false }`. The caller is responsible for `npm install` +
 * `init --full --force` + `memory init --force` in that case.
 *
 * Records `setup-mkdtemp` timing on `perf`.
 */
export function setupSmokeTempDir(prefix, perf, registry) {
  const mkStart = process.hrtime.bigint();
  const shared = process.env.ADR0261_SMOKE_SHARED_TEMP;
  if (shared) {
    const cliPath = join(shared, 'node_modules', '@sparkleideas', 'cli');
    if (!existsSync(cliPath)) {
      process.stderr.write(`[setup] FATAL: ADR0261_SMOKE_SHARED_TEMP=${shared} but ${cliPath} missing\n`);
      process.exit(1);
    }
    const sub = mkdtempSync(join(shared, `${prefix}-`));
    symlinkSync(join(shared, 'node_modules'), join(sub, 'node_modules'));
    writeFileSync(join(sub, 'package.json'),
      JSON.stringify({ name: prefix, version: '1.0.0', private: true }));
    writeFileSync(join(sub, '.npmrc'), `registry=${registry}\n`);
    // Copy init artifacts so the per-smoke subdir is a self-contained,
    // isolated cli project (each smoke writes its own .swarm/memory.db).
    for (const rel of ['.claude', '.claude-flow', '.swarm', 'CLAUDE.md']) {
      const src = join(shared, rel);
      if (existsSync(src)) cpSync(src, join(sub, rel), { recursive: true });
    }
    perf.mark('setup-mkdtemp', mkStart);
    perf.set('setup-npm-install', 0, '(shared)');
    perf.set('init-cli-full', 0, '(shared)');
    perf.set('init-memory', 0, '(shared)');
    process.stderr.write(`[setup] shared-temp reuse: subdir=${sub} (skipped install+init)\n`);
    return { dir: sub, shared: true };
  }
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  perf.mark('setup-mkdtemp', mkStart);
  return { dir, shared: false };
}

export function findCli(tempDir) {
  for (const name of ['ruflo', 'claude-flow', 'cli']) {
    const p = join(tempDir, 'node_modules', '.bin', name);
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Non-shared path: `npm install @sparkleideas/cli` + `cli init --full --force`
 * + `cli memory init --force`. Records `setup-npm-install`, `init-cli-full`,
 * `init-memory` timings on `perf`. Returns the resolved cli binary path.
 */
export function installAndInit(tempDir, perf, registry, cliPkg = '@sparkleideas/cli') {
  writeFileSync(join(tempDir, 'package.json'),
    JSON.stringify({ name: 'smoke-adr0261', version: '1.0.0', private: true }));
  writeFileSync(join(tempDir, '.npmrc'), `registry=${registry}\n`);
  const installStart = process.hrtime.bigint();
  const r1 = spawnSync('npm', [
    'install', cliPkg,
    '--registry', registry,
    '--no-audit', '--no-fund', '--prefer-offline',
  ], { cwd: tempDir, encoding: 'utf8' });
  perf.mark('setup-npm-install', installStart);
  if (r1.status !== 0) {
    process.stderr.write(`[setup] FATAL: npm install failed (status=${r1.status}): ${r1.stderr}\n`);
    process.exit(1);
  }
  const cli = findCli(tempDir);
  if (!cli) {
    process.stderr.write(`[setup] FATAL: cli binary not found after install\n`);
    process.exit(1);
  }
  const initStart = process.hrtime.bigint();
  const r2 = spawnSync(cli, ['init', '--full', '--force'], {
    cwd: tempDir, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, NPM_CONFIG_REGISTRY: registry },
  });
  perf.mark('init-cli-full', initStart);
  if (r2.status !== 0) {
    process.stderr.write(`[setup] init failed (status=${r2.status}): ${r2.stderr?.slice(0, 2000)}\n`);
    process.exit(1);
  }
  const memStart = process.hrtime.bigint();
  spawnSync(cli, ['memory', 'init', '--force'], {
    cwd: tempDir, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, NPM_CONFIG_REGISTRY: registry },
  });
  perf.mark('init-memory', memStart);
  return cli;
}
