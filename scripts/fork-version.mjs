#!/usr/bin/env node
// scripts/fork-version.mjs — Bump -patch.N versions across fork package.json files.
// Implements ADR-0027 (fork migration) version scheme.
//
// Version scheme: {upstream}-patch.N
//   Upstream X.Y.Z        -> X.Y.Z-patch.1
//   Existing X.Y.Z-patch.1 -> X.Y.Z-patch.2
//   Upstream 3.0.0-alpha.6 -> 3.0.0-alpha.6-patch.1
//
// Usage:
//   node scripts/fork-version.mjs bump ~/src/forks/ruflo
//   node scripts/fork-version.mjs show ~/src/forks/ruflo
//
// Exported API:
//   import { bumpPatchVersion, findPackages, bumpAll } from './fork-version.mjs';

import { readFileSync, writeFileSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const __filename = fileURLToPath(import.meta.url);

const SKIP_DIRS = new Set(['node_modules', '.git', '.tsc-toolchain']);
const SCOPES = ['@sparkleideas/', '@claude-flow/'];

// Unscoped packages that are published as @sparkleideas/* (via codemod rename).
// These need -patch.N versions too.
const UNSCOPED_PUBLISHABLE = new Set([
  'agentdb',
  'agentic-flow',
  'ruv-swarm',
  'agent-booster',
  'agentdb-onnx',
  'cuda-wasm',
]);

// ── Version parsing ──

/**
 * Bump a version string's -patch.N suffix.
 * If version already ends with -patch.N, increment N.
 * Otherwise append -patch.1.
 *
 * @param {string} version
 * @returns {string} bumped version
 */
export function bumpPatchVersion(version) {
  const match = version.match(/^(.*)-patch\.(\d+)$/);
  if (match) {
    const base = match[1];
    const n = parseInt(match[2], 10);
    return `${base}-patch.${n + 1}`;
  }
  return `${version}-patch.1`;
}

// ── Package discovery ──

/**
 * Walk a directory tree and find all package.json files belonging to
 * @sparkleideas/* or @claude-flow/* packages.
 *
 * @param {string} dir - root directory to search
 * @returns {Array<{path: string, pkg: object}>} found packages
 */
export function findPackages(dir) {
  const results = [];
  walk(dir, results);
  return results;
}

function walk(dir, results) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }

    if (st.isDirectory()) {
      walk(full, results);
    } else if (entry === 'package.json') {
      try {
        const raw = readFileSync(full, 'utf8');
        const pkg = JSON.parse(raw);
        if (pkg.name && (
          SCOPES.some(s => pkg.name.startsWith(s)) ||
          UNSCOPED_PUBLISHABLE.has(pkg.name)
        )) {
          results.push({ path: full, pkg });
        }
      } catch {
        // skip malformed package.json
      }
    }
  }
}

// ── Bump all packages ──

/**
 * Bump all @sparkleideas/*, @claude-flow/*, and unscoped publishable packages
 * in one or more fork directories. Updates versions and internal dependency
 * references across all forks (ADR-0027: exact pinned versions, no wildcards).
 *
 * @param {string|string[]} dirs - fork root directory or array of directories
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun=false] - if true, don't write files
 * @returns {{changes: Array<{name: string, from: string, to: string, path: string}>}}
 */
export function bumpAll(dirs, opts = {}) {
  const { dryRun = false } = opts;
  const dirList = Array.isArray(dirs) ? dirs : [dirs];

  // Discover packages across all forks
  const allPackages = [];
  for (const dir of dirList) {
    allPackages.push(...findPackages(dir));
  }

  // Build version map: packageName -> newVersion
  // Also build alias map: @claude-flow/X -> version of X (for cross-scope dep refs)
  const versionMap = new Map();
  const changes = [];

  for (const { path: pkgPath, pkg } of allPackages) {
    const oldVersion = pkg.version;
    const newVersion = bumpPatchVersion(oldVersion);
    versionMap.set(pkg.name, newVersion);

    // Add aliases so cross-scope references resolve:
    // unscoped "agentdb" -> also register "@claude-flow/agentdb" and "@sparkleideas/agentdb"
    if (UNSCOPED_PUBLISHABLE.has(pkg.name)) {
      versionMap.set(`@claude-flow/${pkg.name}`, newVersion);
      versionMap.set(`@sparkleideas/${pkg.name}`, newVersion);
    }
    // scoped "@claude-flow/cli" -> also register "@sparkleideas/cli"
    if (pkg.name.startsWith('@claude-flow/')) {
      const short = pkg.name.replace('@claude-flow/', '');
      versionMap.set(`@sparkleideas/${short}`, newVersion);
    }

    changes.push({
      name: pkg.name,
      from: oldVersion,
      to: newVersion,
      path: pkgPath,
    });
  }

  // Apply version bumps and update internal dep references
  for (const { path: pkgPath, pkg } of allPackages) {
    const newVersion = versionMap.get(pkg.name);
    pkg.version = newVersion;

    // Update internal dependency references in all dep fields
    for (const depField of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      const deps = pkg[depField];
      if (!deps || typeof deps !== 'object') continue;

      for (const depName of Object.keys(deps)) {
        if (versionMap.has(depName)) {
          deps[depName] = versionMap.get(depName);
        }
      }
    }

    if (!dryRun) {
      // Preserve trailing newline if original had one
      const original = readFileSync(pkgPath, 'utf8');
      const trailing = original.endsWith('\n') ? '\n' : '';
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + trailing);
    }
  }

  return { changes };
}

// ── Show versions (no changes) ──

function showAll(dir) {
  const packages = findPackages(dir);
  if (packages.length === 0) {
    console.log('No @sparkleideas/* or @claude-flow/* packages found.');
    return;
  }

  console.log(`Found ${packages.length} package(s):\n`);
  for (const { path: pkgPath, pkg } of packages) {
    const rel = relative(dir, pkgPath);
    const hasPatch = /-patch\.\d+$/.test(pkg.version);
    const marker = hasPatch ? ' (patched)' : '';
    console.log(`  ${pkg.name}@${pkg.version}${marker}`);
    console.log(`    ${rel}`);
  }
}

// ── CLI entry point ──

const isMainModule = process.argv[1] &&
  realpathSync(resolve(process.argv[1])) === realpathSync(__filename);

if (isMainModule) {
  const { positionals } = parseArgs({
    allowPositionals: true,
    strict: false,
  });

  const command = positionals[0];
  const dirs = positionals.slice(1);

  if (!command || dirs.length === 0) {
    console.error('Usage: node scripts/fork-version.mjs <bump|show> <fork-dir> [fork-dir2] ...');
    process.exit(1);
  }

  const resolvedDirs = dirs.map(d => resolve(d));

  if (command === 'show') {
    for (const dir of resolvedDirs) {
      showAll(dir);
    }
  } else if (command === 'bump') {
    const { changes } = bumpAll(resolvedDirs);
    if (changes.length === 0) {
      console.log('No @sparkleideas/* or @claude-flow/* packages found.');
    } else {
      console.log(`Bumped ${changes.length} package(s):\n`);
      for (const c of changes) {
        console.log(`  ${c.name}: ${c.from} -> ${c.to}`);
      }
    }
  } else {
    console.error(`Unknown command: ${command}`);
    console.error('Usage: node scripts/fork-version.mjs <bump|show> <fork-dir> [fork-dir2] ...');
    process.exit(1);
  }
}
