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

// ADR-0113 Fix 3 (Phase B): when invoked with --discover-dry-run, hand
// off to preflight-discover.mjs which walks FORK_DIRS[] and reports
// discovered packages vs. publish.mjs LEVELS coverage. Exits this
// script — does not run the rest of preflight.
if (process.argv.includes('--discover-dry-run')) {
  const mod = await import(resolve(__dirname, 'preflight-discover.mjs'));
  const { discover, uniqueMappedNames, WONT_PUBLISH, WONT_PUBLISH_PATTERNS, isWontPublish } = mod;
  const { discovered, skipped } = discover();
  const unique = uniqueMappedNames(discovered);
  const { LEVELS } = await import(resolve(__dirname, 'publish.mjs'));
  const levelsSet = new Set(LEVELS.flat());

  const inLevels = [];
  const missingFromLevels = [];
  const wontPublishHits = [];
  for (const name of [...unique].sort()) {
    if (levelsSet.has(name)) {
      inLevels.push(name);
    } else if (isWontPublish(name)) {
      wontPublishHits.push(name);
    } else {
      missingFromLevels.push(name);
    }
  }
  const inLevelsButNotDiscovered = [...levelsSet]
    .filter((n) => !unique.has(n))
    .sort();

  console.log('═══ ADR-0113 Phase B — preflight package discovery ═══');
  console.log(`Forks scanned: ${[...new Set(discovered.map((d) => d.fork))].sort().join(', ')}`);
  console.log(`Discovered: ${unique.size} unique mapped names from ${discovered.length} package.json files`);
  console.log(`Skipped: ${skipped.length} (private/out-of-scope/unparseable)`);
  console.log('');

  console.log(`── Discovered & in LEVELS (${inLevels.length}) ──`);
  for (const n of inLevels) console.log(`  ✓ ${n}`);
  console.log('');

  if (missingFromLevels.length > 0) {
    console.log(`── DISCOVERED but MISSING from LEVELS (${missingFromLevels.length}) ──`);
    console.log('   ↑ Real gaps. Add to scripts/publish.mjs LEVELS, or to');
    console.log('     WONT_PUBLISH in scripts/preflight-discover.mjs.');
    for (const n of missingFromLevels) {
      const sources = discovered
        .filter((d) => d.mappedName === n)
        .map((d) => `${d.fork}:${d.path}`);
      console.log(`  ✗ ${n}`);
      for (const s of sources) console.log(`      ${s}`);
    }
    console.log('');
  }

  if (inLevelsButNotDiscovered.length > 0) {
    console.log(`── In LEVELS but NOT DISCOVERED (${inLevelsButNotDiscovered.length}) ──`);
    for (const n of inLevelsButNotDiscovered) {
      console.log(`  ⚠ ${n}`);
    }
    console.log('');
  }

  if (wontPublishHits.length > 0) {
    console.log(`── WONT_PUBLISH (${wontPublishHits.length}) — discovered but intentionally skipped ──`);
    for (const name of wontPublishHits) console.log(`  • ${name}`);
    console.log('   (rules in scripts/preflight-discover.mjs WONT_PUBLISH + WONT_PUBLISH_PATTERNS)');
    console.log('');
  }

  if (missingFromLevels.length > 0) {
    console.error(
      `FAIL: ${missingFromLevels.length} discovered package(s) missing from LEVELS.`,
    );
    process.exit(1);
  }
  process.exit(0);
}

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

// ── Fork directories (advisory — reads paths from config/upstream-branches.json) ──

const upstreamConfig = JSON.parse(readFileSync(resolve(ROOT, 'config', 'upstream-branches.json'), 'utf8'));
const forkEntries = Object.entries(upstreamConfig).filter(([n]) => n !== 'ruvector');

for (const [name, cfg] of forkEntries) {
  check(`fork dir ${cfg.dir}`, () => {
    if (existsSync(cfg.dir)) return true;
    console.warn(`  Warning: fork directory not found — ${cfg.dir}`);
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
