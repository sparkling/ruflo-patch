#!/usr/bin/env node
// scripts/check-cross-repo-builds.mjs — ADR-0190 fail-loud cross-repo TS build gate.
//
// Walks every `forks/*/npm/packages/*/package.json`, checks whether the
// `main` and `exports` entries reference files that actually exist in the
// source tree. A missing entry-point file is a silent-drop hazard per
// ADR-0082 — the published package would look correct (npm publish exits 0,
// Verdaccio reports the version) but `require()` fails at consume time with
// MODULE_NOT_FOUND because the tarball doesn't contain dist/.
//
// Per ADR-0190 §Decision Outcome Option 1 (recommended starting point):
// cross-repo TS packages MUST ship a pre-built `dist/` in their source tree
// on `forks/*/main`. This detector enforces the contract.
//
// Exit codes:
//   0 — every cross-repo TS package's declared entry points exist on disk
//   1 — at least one package declares an entry point that's missing
//
// Advisory mode (CROSS_REPO_BUILDS_ADVISORY=1): always exit 0 but log the
// count + the first 10 violators. Use this for the initial corpus pass —
// the existing corpus has ~30 pre-existing violations from packages that
// were imported with broken main declarations from upstream. Treat as
// inventory now; promote to fail-loud when the inventory is cleaned.
//
// No external deps; uses Node 20+ fs/path only.
//
// ## Allowlist
//
// Some packages are KNOWN to be platform-specific binary stubs (e.g.
// `ruvllm-linux-arm64-gnu/package.json`) whose `main` is a `.node` binary
// produced by napi-rebuild on the matching host. Those are covered by
// check-napi-coverage.mjs and the napi-rebuild pipeline phase — they're
// EXEMPT from this detector.
//
// Allowlist patterns are applied as substring matches on the package
// directory path. Add an entry here when a package is legitimately
// out-of-scope (with a one-line justification per
// `feedback-skip-accepted-as-squelch`).

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_DIR = resolve(__dirname, '..');
const FORKS_DIR = resolve(PROJECT_DIR, '..', 'forks');

// Forks that ship cross-repo packages under npm/packages/.
const FORK_DIRS = ['ruvector', 'agentic-flow', 'ruv-FANN', 'agentdb', 'ruflo'];

// Substring matches against the package directory path. Entries here are
// platform-specific NAPI binary stubs or other legitimately-out-of-scope
// shapes per the contract.
const ALLOWLIST_SUBSTRINGS = [
  // Per-platform NAPI sub-packages — covered by check-napi-coverage.mjs +
  // napi-rebuild pipeline; their `main` is a `.node` binary built per host,
  // not a TS dist/ artifact. Match the standard napi-rs platform suffixes.
  '-darwin-arm64', '-darwin-x64',
  '-linux-x64-gnu', '-linux-arm64-gnu', '-linux-x64-musl', '-linux-arm64-musl',
  '-win32-x64-msvc', '-win32-ia32-msvc', '-win32-arm64-msvc',
  '-freebsd-x64',
  '-android-arm64', '-android-arm-eabi',
];

function isAllowlisted(pkgDir) {
  return ALLOWLIST_SUBSTRINGS.some((s) => pkgDir.includes(s));
}

function walkPackages() {
  const out = [];
  for (const fork of FORK_DIRS) {
    const npmPackagesDir = join(FORKS_DIR, fork, 'npm', 'packages');
    if (!existsSync(npmPackagesDir)) continue;
    let entries;
    try {
      entries = readdirSync(npmPackagesDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const pkgDir = join(npmPackagesDir, e.name);
      const pkgJsonPath = join(pkgDir, 'package.json');
      if (!existsSync(pkgJsonPath)) continue;
      out.push({ pkgJsonPath, pkgDir, fork, name: e.name });
    }
  }
  return out;
}

/**
 * Collect every relative entry-point path declared by a package.json.
 * Sources scanned: `main`, `module`, `types`, `typings`, and every leaf
 * of `exports` (which may be a string or a conditional-export object).
 */
function collectEntryPoints(pkg) {
  const paths = new Set();
  if (typeof pkg.main === 'string') paths.add(pkg.main);
  if (typeof pkg.module === 'string') paths.add(pkg.module);
  if (typeof pkg.types === 'string') paths.add(pkg.types);
  if (typeof pkg.typings === 'string') paths.add(pkg.typings);
  if (pkg.exports && typeof pkg.exports === 'object') {
    const walk = (node) => {
      if (typeof node === 'string') {
        paths.add(node);
      } else if (node && typeof node === 'object') {
        for (const v of Object.values(node)) walk(v);
      }
    };
    walk(pkg.exports);
  }
  // bin: skip — bin paths are usually source .js files, not dist artifacts;
  // and bin handling has its own publish-time contract per package.json bin
  // key (see scripts/codemod.mjs Pass 1 bin-exclusion note).
  return [...paths].filter(
    (p) => typeof p === 'string' && p.length > 0 && !p.startsWith('http'),
  );
}

function main() {
  const packages = walkPackages();
  if (packages.length === 0) {
    console.log('[CROSS-REPO-BUILD] no cross-repo packages found (forks/*/npm/packages/* empty)');
    process.exit(0);
  }

  const violations = [];
  let scanned = 0;
  let allowed = 0;

  for (const { pkgJsonPath, pkgDir, fork, name } of packages) {
    if (isAllowlisted(pkgDir)) {
      allowed++;
      continue;
    }
    scanned++;
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
    } catch (e) {
      violations.push({
        kind: 'malformed-package-json',
        pkgJsonPath,
        detail: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    const entries = collectEntryPoints(pkg);
    for (const ep of entries) {
      const epPath = join(pkgDir, ep);
      if (!existsSync(epPath)) {
        violations.push({
          kind: 'missing-entry',
          pkgJsonPath,
          fork,
          name,
          entry: ep,
          expected: epPath,
        });
      }
    }
  }

  // Report.
  console.log(`[CROSS-REPO-BUILD] scanned ${scanned} package(s); ${allowed} allowlisted; ${violations.length} violation(s)`);

  if (violations.length === 0) {
    console.log('[CROSS-REPO-BUILD] PASS — every declared entry point resolves to a file on disk');
    process.exit(0);
  }

  const advisory = process.env.CROSS_REPO_BUILDS_ADVISORY === '1';
  const limit = advisory ? 10 : violations.length;
  console.error(`[CROSS-REPO-BUILD] ${advisory ? 'ADVISORY' : 'FAIL'} — ${violations.length} entry point(s) missing${advisory ? ' (showing first ' + Math.min(limit, violations.length) + ')' : ''}:`);
  for (const v of violations.slice(0, limit)) {
    if (v.kind === 'malformed-package-json') {
      console.error(`  - ${v.pkgJsonPath} — malformed JSON: ${v.detail}`);
    } else {
      console.error(`  - ${v.fork}/${v.name}: ${v.entry} → ${v.expected} (does not exist)`);
    }
  }
  console.error('');
  console.error('Per ADR-0190 §Decision Outcome Option 1: every cross-repo TS package');
  console.error('MUST ship a pre-built dist/ in its source tree on forks/*/main.');
  console.error('Either build + commit the dist/ artifacts, or add the package to the');
  console.error('allowlist in scripts/check-cross-repo-builds.mjs with a justification.');
  if (advisory) {
    console.error('');
    console.error('[CROSS-REPO-BUILD] advisory mode — exiting 0 despite violations.');
    process.exit(0);
  }
  process.exit(1);
}

main();
