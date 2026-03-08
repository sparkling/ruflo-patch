#!/usr/bin/env node
// scripts/preflight.mjs — Pre-commit/pre-publish consistency checker.
// Verifies essential files and config exist before proceeding.
//
// Usage: node scripts/preflight.mjs [--check]
//   --check  Exit 1 if anything is missing (for hooks/CI).

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const checkOnly = process.argv.includes('--check');

const TIMEOUT_MS = 10_000;
const timer = setTimeout(() => {
  console.error('[TIMEOUT] preflight.mjs exceeded 10s — aborting');
  process.exit(1);
}, TIMEOUT_MS);
timer.unref();

const t0 = Date.now();
console.log(`[${new Date().toISOString()}] Preflight starting`);

let errors = 0;
let warnings = 0;

function check(label, fn) {
  const s0 = Date.now();
  const result = fn();
  const elapsed = Date.now() - s0;
  const status = result === true ? 'OK' : result === 'warn' ? 'WARN' : 'FAIL';
  console.log(`[${new Date().toISOString()}] Check: ${label} — ${status} (${elapsed}ms)`);
  if (result === false) errors++;
  if (result === 'warn') warnings++;
}

// ── Required files ──

check('config/published-versions.json is valid JSON', () => {
  const path = resolve(ROOT, 'config', 'published-versions.json');
  if (!existsSync(path)) {
    console.error('  Missing: config/published-versions.json');
    return false;
  }
  try {
    JSON.parse(readFileSync(path, 'utf-8'));
    return true;
  } catch (e) {
    console.error(`  Invalid JSON: ${e.message}`);
    return false;
  }
});

check('scripts/codemod.mjs exists', () => {
  return existsSync(resolve(ROOT, 'scripts', 'codemod.mjs'));
});

check('scripts/publish.mjs exists', () => {
  return existsSync(resolve(ROOT, 'scripts', 'publish.mjs'));
});

check('scripts/fork-version.mjs exists', () => {
  return existsSync(resolve(ROOT, 'scripts', 'fork-version.mjs'));
});

// ── Fork directories (advisory) ──

const forkBase = resolve(homedir(), 'src', 'forks');
const forkNames = ['ruflo', 'agentic-flow', 'ruv-FANN'];

for (const name of forkNames) {
  check(`fork dir ~/src/forks/${name}`, () => {
    if (existsSync(resolve(forkBase, name))) return true;
    console.warn(`  Warning: fork directory not found — ~/src/forks/${name}`);
    return 'warn';
  });
}

// ── Summary ──

const elapsed = Date.now() - t0;
console.log(`[${new Date().toISOString()}] Preflight complete (${elapsed}ms)`);
clearTimeout(timer);

if (errors === 0 && warnings === 0) {
  console.log('All checks passed.');
} else if (errors === 0) {
  console.log(`All required checks passed (${warnings} warning(s)).`);
} else {
  console.log(`\n${errors} check(s) failed.`);
  if (checkOnly) {
    process.exit(1);
  }
}
