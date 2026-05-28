/**
 * Shared helpers for ADR-0255 memory_export + value-only smokes.
 * Mirrors smoke-adr0266-shared.mjs in shape; targets ADR0255_SMOKE_SHARED_TEMP.
 */

import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  existsSync,
  symlinkSync,
  cpSync,
} from 'node:fs';
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
  };
}

export function setupSmokeTempDir(prefix, perf, registry) {
  const mkStart = process.hrtime.bigint();
  const shared = process.env.ADR0255_SMOKE_SHARED_TEMP;
  if (shared) {
    const cliPath = join(shared, 'node_modules', '@sparkleideas', 'ruflo');
    if (!existsSync(cliPath)) {
      process.stderr.write(`[setup] FATAL: ADR0255_SMOKE_SHARED_TEMP=${shared} but ${cliPath} missing\n`);
      process.exit(1);
    }
    const sub = mkdtempSync(join(shared, `${prefix}-`));
    symlinkSync(join(shared, 'node_modules'), join(sub, 'node_modules'));
    writeFileSync(join(sub, 'package.json'),
      JSON.stringify({ name: prefix, version: '1.0.0', private: true }));
    writeFileSync(join(sub, '.npmrc'), `registry=${registry}\n`);
    for (const rel of ['.claude', '.claude-flow', '.swarm', 'CLAUDE.md']) {
      const src = join(shared, rel);
      if (existsSync(src)) cpSync(src, join(sub, rel), { recursive: true });
    }
    perf.mark('setup-mkdtemp', mkStart);
    perf.set('setup-npm-install', 0, '(shared)');
    perf.set('init-cli-full', 0, '(shared)');
    perf.set('init-memory', 0, '(shared)');
    return { dir: sub, shared: true };
  }
  const dir = mkdtempSync(join(tmpdir(), `ruflo-adr0255-smoke-${prefix}-`));
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

export function installAndInit(tempDir, perf, registry, cliPkg = '@sparkleideas/ruflo') {
  writeFileSync(join(tempDir, 'package.json'),
    JSON.stringify({ name: 'smoke-adr0255', version: '1.0.0', private: true }));
  writeFileSync(join(tempDir, '.npmrc'), `registry=${registry}\n`);
  const installStart = process.hrtime.bigint();
  const r1 = spawnSync('npm', [
    'install', `${cliPkg}@latest`,
    '--registry', registry,
    '--no-audit', '--no-fund',
  ], { cwd: tempDir, encoding: 'utf8' });
  perf.mark('setup-npm-install', installStart);
  if (r1.status !== 0) {
    process.stderr.write(`[setup] FATAL: npm install failed: ${r1.stderr}\n`);
    process.exit(1);
  }
  const cli = findCli(tempDir);
  if (!cli) { process.stderr.write(`[setup] FATAL: cli not found\n`); process.exit(1); }
  const initStart = process.hrtime.bigint();
  spawnSync(cli, ['init', '--full', '--force'], {
    cwd: tempDir, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, NPM_CONFIG_REGISTRY: registry },
  });
  perf.mark('init-cli-full', initStart);
  const memStart = process.hrtime.bigint();
  spawnSync(cli, ['memory', 'init', '--force'], {
    cwd: tempDir, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, NPM_CONFIG_REGISTRY: registry },
  });
  perf.mark('init-memory', memStart);
  return cli;
}
