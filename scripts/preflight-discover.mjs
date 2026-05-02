#!/usr/bin/env node
// scripts/preflight-discover.mjs — ADR-0113 Fix 3 (Phase B):
// auto-discover publishable fork packages by walking FORK_DIRS[].
//
// Walks each entry in config/upstream-branches.json (the canonical fork-list
// per ADR-0039 + lib/fork-paths.sh), finds every `package.json`, filters to
// what the publish pipeline considers in-scope, and emits the discovered
// set. Used by:
//
//   - `npm run preflight -- --discover-dry-run` (review tool — prints to stdout)
//   - tests/pipeline/preflight-package-coverage.test.mjs (asserts the
//     discovered set ⊆ scripts/publish.mjs LEVELS, ⊆ KNOWN_DEPS, ⊆ UNSCOPED_MAP)
//
// Exclusions (per ADR-0113 §"Filtering 'is this published?'"):
//   - private:true in package.json
//   - any path containing /node_modules/, /__tests__/, /test/fixtures/, /scratch/
//   - forks/ruflo/v2/examples/*/ (sample-apps, ~24 dirs)
//   - depth cap 5 from fork root (Devil's Advocate gap-catch:
//     prevents experimental WIP directories silently shipping)
//
// "In-scope" signal — name MUST match one of:
//   - starts with `@claude-flow/`
//   - starts with `@ruvector/`
//   - is a key in UNSCOPED_MAP
//
// WONT_PUBLISH set — explicit skips for known-discoverable but-not-published
// fork packages. Each entry needs a reason. If a discovered pkg is not in
// LEVELS and not here, the coverage test fails loud (per
// `feedback-no-fallbacks` — auto-discovery must surface gaps, not paper
// over them).

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Single source of truth for the non-scoped name mappings is
// codemod.mjs's UNSCOPED_MAP (now exported).
const { UNSCOPED_MAP } = await import(resolve(ROOT, 'scripts', 'codemod.mjs'));

// ── WONT_PUBLISH ─────────────────────────────────────────────────────
// Pre-existing gaps the discoverer surfaces but are intentionally NOT
// in the publish pipeline. Reason MUST be inline; if the reason no
// longer applies, either add to LEVELS or remove from this entry.
//
// Two forms:
//   exact-name map: { '@claude-flow/migration': 'reason …' }
//   pattern array:  [{ pattern: /^@sparkleideas\/ruvector-.*-(darwin|linux|win32)-/, reason: '…' }]
//
// ADR-0113 surfaced these via Phase B initial dry-run (2026-05-02 pass).
export const WONT_PUBLISH = new Map([
  // v2 = upstream's legacy codebase. Only the v2 root (`claude-flow`
  // proxy) is published; v2/src/migration is internal tooling, not
  // user-facing. The v3 cli has migration helpers built-in.
  ['@claude-flow/migration', 'v2 legacy — superseded by v3 cli built-in migration helpers'],

  // forks/ruflo/ruflo/package.json — upstream's standalone `ruflo` bin
  // wrapper. Distribution publishes `@sparkleideas/cli` as the user-
  // facing CLI (per ADR-0113 Fix 6.1 revised target). The standalone
  // `ruflo` bin is not in our pipeline. Reconsider if/when we publish
  // a `ruflo` bin alias to Verdaccio (decision deferred per ADR-0113).
  ['ruflo', 'standalone bin wrapper — distribution uses @sparkleideas/cli (Fix 6.1)'],

  // wasm-pack build often fails (per existing comment in
  // tests/pipeline/publish-order.test.mjs:85). Stays out of LEVELS until
  // upstream stabilizes the build.
  ['cuda-wasm', 'wasm-pack build often fails — removed from LEVELS by prior decision'],
]);

// Pattern-based skips: any @sparkleideas/* mapped name matching one of
// these is treated as a known gap. Used for whole categories of
// ruvector experimental work in `forks/ruvector/` that we do not ship.
//
// Rationale: ruvector is upstream-WIP at much higher churn than ruflo.
// Listing every platform binary or example wasm package as an exact
// WONT_PUBLISH entry would be 100+ lines of bookkeeping. A pattern says
// "this whole category is upstream-experimental — not promoted to publish."
//
// New @sparkleideas/ruvector-X packages that DO NOT match a pattern
// will fail-loud — that's the desired behavior, since it forces a
// decision on the new package.
export const WONT_PUBLISH_PATTERNS = [
  {
    // Platform-specific NAPI binaries (darwin-arm64, linux-x64-gnu, etc.).
    // Many of these exist in upstream as build artifacts; they're
    // published by upstream's own NAPI workflow, not by us.
    pattern: /^@sparkleideas\/ruvector-.*-(darwin|linux|win32)-(arm64|x64)(-gnu|-musl|-msvc)?$/,
    reason: 'NAPI platform binary — upstream-published, not in our pipeline',
  },
  {
    // Experimental wasm-pack outputs and example apps under
    // forks/ruvector/{examples,crates}/ that aren't in LEVELS. Includes
    // edge-net, delta-behavior, exotic-wasm, nervous-system-wasm,
    // economy-wasm, ios-wasm-types, etc.
    pattern: /^@sparkleideas\/ruvector-(edge|edge-full|edge-net|edge-net-relay|edge-net-tests|delta-behavior|exotic-wasm|nervous-system-wasm|economy-wasm|ios-wasm-types|graph-wasm|gnn-wasm|router-wasm|ruqu-wasm|tiny-dancer-wasm|rvf-wasm|wasm|wasm-unified)$/,
    reason: 'ruvector experimental wasm — not promoted to publish',
  },
  {
    // ruvector toolchain CLIs / servers / extras not in LEVELS:
    // benchmarks, cli, ruvllm-cli, postgres-cli, server, scipix, etc.
    pattern: /^@sparkleideas\/ruvector-(agentic-integration|agentic-synth|agentic-synth-examples|benchmarks|burst-scaling|cli|cluster|cnn|diskann|graph-data-generator|node|ospipe|ospipe-wasm|pi-brain|postgres-cli|raft|replication|rudag|ruvllm-cli|rvdna|rvf-mcp-server|rvf-solver|scipix|server|solver|spiking-neural)$/,
    reason: 'ruvector tooling/experiments — not promoted to publish',
  },
];

// Returns true if `name` is in WONT_PUBLISH or matches a WONT_PUBLISH_PATTERN.
// Caller passes the @sparkleideas-mapped name.
export function isWontPublish(mappedName) {
  // Exact-name check via reverseMapName.
  for (const orig of WONT_PUBLISH.keys()) {
    if (mapName(orig) === mappedName) return true;
  }
  // Pattern check.
  for (const { pattern } of WONT_PUBLISH_PATTERNS) {
    if (pattern.test(mappedName)) return true;
  }
  return false;
}

// ── Walk config ──────────────────────────────────────────────────────
const DEPTH_CAP = 5;

const SKIP_PATH_FRAGMENTS = [
  '/node_modules/',
  '/__tests__/',
  '/test/fixtures/',
  '/scratch/',
  '/.git/',
  '/dist/',
  // v2 sample-apps (24 dirs)
  '/v2/examples/',
];

function isSkippedPath(p) {
  return SKIP_PATH_FRAGMENTS.some((frag) => p.includes(frag));
}

// ── Fork list ────────────────────────────────────────────────────────
function loadForkDirs() {
  const cfg = JSON.parse(
    readFileSync(resolve(ROOT, 'config', 'upstream-branches.json'), 'utf8'),
  );
  return Object.entries(cfg).map(([name, info]) => ({
    name,
    dir: info.dir,
  }));
}

// ── Walker ───────────────────────────────────────────────────────────
function walkPackageJsons(rootDir) {
  const found = [];
  if (!existsSync(rootDir)) return found;

  const queue = [{ dir: rootDir, depth: 0 }];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift();
    if (depth > DEPTH_CAP) continue;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (isSkippedPath(p + '/')) continue;
      if (e.isDirectory()) {
        queue.push({ dir: p, depth: depth + 1 });
      } else if (e.isFile() && e.name === 'package.json') {
        found.push(p);
      }
    }
  }
  return found;
}

// ── Classification ───────────────────────────────────────────────────
function isInScope(name) {
  if (!name) return false;
  if (name.startsWith('@claude-flow/')) return true;
  if (name.startsWith('@ruvector/')) return true;
  if (Object.prototype.hasOwnProperty.call(UNSCOPED_MAP, name)) return true;
  return false;
}

// Map fork-source name → @sparkleideas/* target name (post-codemod).
// Mirrors codemod.mjs:applyNameMapping().
export function mapName(name) {
  if (!name) return name;
  if (name.startsWith('@sparkleideas/')) return name;
  if (name.startsWith('@claude-flow/')) {
    return '@sparkleideas/' + name.slice('@claude-flow/'.length);
  }
  if (name.startsWith('@ruvector/')) {
    return '@sparkleideas/ruvector-' + name.slice('@ruvector/'.length);
  }
  if (Object.prototype.hasOwnProperty.call(UNSCOPED_MAP, name)) {
    return UNSCOPED_MAP[name];
  }
  return name;
}

// ── Main discovery ───────────────────────────────────────────────────
export function discover() {
  const forks = loadForkDirs();
  const discovered = [];   // { fork, path, originalName, mappedName, version }
  const skipped = [];      // { fork, path, originalName, reason }

  for (const fork of forks) {
    const pkgs = walkPackageJsons(fork.dir);
    for (const p of pkgs) {
      let pkg;
      try {
        pkg = JSON.parse(readFileSync(p, 'utf8'));
      } catch (err) {
        skipped.push({ fork: fork.name, path: p, reason: `unparseable: ${err.message}` });
        continue;
      }
      const name = pkg.name;
      if (!name) {
        skipped.push({ fork: fork.name, path: p, reason: 'missing name field' });
        continue;
      }
      if (pkg.private === true) {
        skipped.push({ fork: fork.name, path: p, originalName: name, reason: 'private:true' });
        continue;
      }
      if (!isInScope(name)) {
        skipped.push({ fork: fork.name, path: p, originalName: name, reason: 'out-of-scope (not @claude-flow/, @ruvector/, or in UNSCOPED_MAP)' });
        continue;
      }
      const mapped = mapName(name);
      // Note: a single mapped name can have multiple source paths
      // (e.g. @ruvector/wasm exists in both forks/ruvector/crates/ and
      // forks/ruvector/npm/packages/). Keep both — the test treats them
      // as the same logical package.
      discovered.push({
        fork: fork.name,
        path: relative(ROOT, p),
        originalName: name,
        mappedName: mapped,
        version: pkg.version || null,
      });
    }
  }
  return { discovered, skipped };
}

// ── Coverage helpers (used by both dry-run printer and tests) ────────
export function uniqueMappedNames(discovered) {
  const set = new Set();
  for (const d of discovered) set.add(d.mappedName);
  return set;
}

// "Should publish" = discovered AND not in WONT_PUBLISH (exact OR pattern).
export function expectedPublishedSet(discovered) {
  const unique = uniqueMappedNames(discovered);
  return new Set([...unique].filter((n) => !isWontPublish(n)));
}

// ── Dry-run printer ──────────────────────────────────────────────────
// Dry-run is implemented in scripts/preflight.mjs (which wires the
// flag into the existing preflight CLI). This module exposes the
// primitives — discover(), isWontPublish(), uniqueMappedNames(),
// expectedPublishedSet() — that both the dry-run printer and the
// pipeline coverage test consume.

// CLI entry: only when run directly. The --discover-dry-run flag is
// handled in scripts/preflight.mjs; this entry only serves --json
// (machine-readable output for downstream tooling).
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args.includes('--json')) {
    const result = discover();
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.error('usage: preflight-discover.mjs --json');
    console.error('       (for human-readable dry-run, use: npm run preflight -- --discover-dry-run)');
    process.exit(2);
  }
}
