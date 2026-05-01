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
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFileCb);

const __filename = fileURLToPath(import.meta.url);

const SKIP_DIRS = new Set(['node_modules', '.git', '.tsc-toolchain']);
// ADR-0095 amendment (2026-05-01): @ruvector/* added so the cascade picks
// up forks/ruvector/{crates,npm/packages}/<pkg>/package.json. Without this,
// findPackages walked past `@ruvector/rvf-node` and the cascade silently
// no-op'd `npm publish` for the renamed `@sparkleideas/ruvector-rvf-node`
// because the version wasn't bumped. The codemod step renames the scope at
// build time (see scripts/codemod.mjs RUVECTOR_PREFIX_FROM/TO); fork-
// version is the bookkeeping side that needs to know about the same
// mapping — `toNpmName` below adds the @ruvector → @sparkleideas/ruvector-
// translation.
const SCOPES = ['@sparkleideas/', '@claude-flow/', '@ruvector/'];

// Unscoped packages that are published as @sparkleideas/* (via codemod rename).
// These need -patch.N versions too.
const UNSCOPED_PUBLISHABLE = new Set([
  'agentdb',
  'agentic-flow',
  'claude-flow',
  'ruv-swarm',
  'ruvector',
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

// ── npm registry queries ──

/**
 * Get the published npm name for a fork package.
 * Unscoped names and @claude-flow/* both map to @sparkleideas/*.
 * @ruvector/* maps to @sparkleideas/ruvector-* (mirrors codemod.mjs
 * RUVECTOR_PREFIX_FROM/TO at line ~30).
 */
function toNpmName(forkName) {
  if (forkName.startsWith('@sparkleideas/')) return forkName;
  if (forkName.startsWith('@claude-flow/')) {
    return '@sparkleideas/' + forkName.replace('@claude-flow/', '');
  }
  if (forkName.startsWith('@ruvector/')) {
    return '@sparkleideas/ruvector-' + forkName.replace('@ruvector/', '');
  }
  if (UNSCOPED_PUBLISHABLE.has(forkName)) {
    return '@sparkleideas/' + forkName;
  }
  return forkName;
}

/**
 * Extract the base version (without -patch.N suffix).
 */
function getBaseVersion(version) {
  const match = version.match(/^(.*)-patch\.\d+$/);
  return match ? match[1] : version;
}

/**
 * Query npm registry for all versions of a package, then find the highest
 * -patch.N for a given base version. Returns 0 if no -patch.N exists.
 *
 * @param {string} npmName - The @sparkleideas/* package name
 * @param {string} baseVersion - e.g. "3.0.0-alpha.6"
 * @returns {Promise<number>} highest N from -patch.N, or 0
 */
async function queryNpmMaxPatch(npmName, baseVersion) {
  try {
    const { stdout } = await execFileAsync('npm', ['view', npmName, 'versions', '--json'], {
      timeout: 15_000,
    });
    const versions = JSON.parse(stdout);
    const arr = Array.isArray(versions) ? versions : [versions];
    let maxN = 0;
    const prefix = baseVersion + '-patch.';
    for (const v of arr) {
      if (v.startsWith(prefix)) {
        const n = parseInt(v.slice(prefix.length), 10);
        if (n > maxN) maxN = n;
      }
    }
    return maxN;
  } catch (err) {
    const stderr = err.stderr || err.message || '';
    const isNotFound =
      stderr.includes('E404') ||
      stderr.includes('is not in this registry') ||
      stderr.includes('Not Found') ||
      stderr.includes('code E404') ||
      err.code === 1;

    if (isNotFound) {
      // Package not on npm yet — safe to start at 0
      return 0;
    }

    // Network error, auth failure, or other unexpected error
    // Log warning but return 0 to avoid blocking the pipeline
    // The publish step will catch actual collisions
    console.warn(`  Warning: npm query failed for ${npmName}: ${stderr.substring(0, 200)}`);
    console.warn(`  Proceeding with patch count 0 — publish.mjs ghost-retry will handle collisions`);
    return 0;
  }
}

/**
 * Check if a specific version exists on npm.
 *
 * @param {string} npmName - The @sparkleideas/* package name
 * @param {string} version - exact version string to check
 * @returns {Promise<boolean>}
 */
async function versionExistsOnNpm(npmName, version) {
  try {
    const { stdout } = await execFileAsync('npm', ['view', `${npmName}@${version}`, 'version', '--json'], {
      timeout: 15_000,
    });
    const result = JSON.parse(stdout);
    return result === version;
  } catch (err) {
    const stderr = err.stderr || err.message || '';
    const isNotFound =
      stderr.includes('E404') ||
      stderr.includes('is not in this registry') ||
      stderr.includes('Not Found') ||
      err.code === 1;

    if (isNotFound) {
      return false;
    }

    console.warn(`  Warning: npm version check failed for ${npmName}@${version}: ${stderr.substring(0, 200)}`);
    return false;
  }
}

/**
 * Compute the next safe version for a package, avoiding npm collisions.
 *
 * IDEMPOTENT: If the current version isn't published on npm yet, returns it
 * unchanged (it was bumped in a previous run that failed before publishing).
 * Only bumps if the current version already exists on npm.
 *
 * @param {string} currentVersion - current version in fork package.json
 * @param {string} forkName - the package name in the fork
 * @returns {Promise<string>} safe next version
 */
async function safeNextVersion(currentVersion, forkName) {
  const base = getBaseVersion(currentVersion);
  const localMatch = currentVersion.match(/^.*-patch\.(\d+)$/);
  const localN = localMatch ? parseInt(localMatch[1], 10) : 0;

  const npmName = toNpmName(forkName);

  // If current version has a -patch.N suffix, check if it's already on npm.
  // Always bump past the current version — never reuse. A version that returns
  // 404 on npm view might be a "ghost" (write side accepted the publish but
  // read side never propagated), blocking re-publish with E400.
  if (localN > 0) {
    const exists = await versionExistsOnNpm(npmName, currentVersion);
    if (exists) {
      // Version confirmed on npm — bump past it
    } else {
      // Version not on npm — could be unpublished OR a ghost. Bump past it
      // to avoid E400 "cannot publish over previously published version".
    }
  }

  const npmN = await queryNpmMaxPatch(npmName, base);
  const nextN = Math.max(localN, npmN) + 1;
  return `${base}-patch.${nextN}`;
}

// ── Change detection ──

/**
 * Detect which packages have changed files between oldSha and HEAD.
 *
 * @param {Array<{path: string, pkg: object}>} allPackages - from findPackages()
 * @param {Map<string, string>} changedShas - map of forkDir -> oldSha
 * @returns {Promise<Set<string>>} set of package names with changed files
 */
export async function detectChangedPackages(allPackages, changedShas) {
  const changed = new Set();

  for (const [forkDir, oldSha] of changedShas) {
    // Get packages in this fork dir
    const forkPackages = allPackages.filter(({ path: p }) => p.startsWith(forkDir + '/'));
    if (forkPackages.length === 0) continue;

    // Empty SHA = first run, treat all packages as changed
    if (!oldSha) {
      for (const { pkg } of forkPackages) changed.add(pkg.name);
      continue;
    }

    // Get changed files via git diff
    let changedFiles;
    try {
      const { stdout } = await execFileAsync(
        'git', ['diff', '--name-only', `${oldSha}..HEAD`],
        { cwd: forkDir, timeout: 15_000 }
      );
      changedFiles = stdout.trim().split('\n').filter(Boolean);
    } catch {
      // git diff failed (e.g. shallow clone) — treat all as changed
      for (const { pkg } of forkPackages) changed.add(pkg.name);
      continue;
    }

    if (changedFiles.length === 0) continue;

    // Map each changed file to its containing package
    // Sort packages by path depth (deepest first) for nearest-ancestor matching
    const sortedPkgs = [...forkPackages].sort((a, b) => b.path.length - a.path.length);

    for (const file of changedFiles) {
      const absFile = join(forkDir, file);
      for (const { path: pkgJsonPath, pkg } of sortedPkgs) {
        // pkgJsonPath = /path/to/package.json, get its directory
        const pkgDir = pkgJsonPath.replace(/\/package\.json$/, '');
        if (absFile.startsWith(pkgDir + '/') || absFile === pkgDir) {
          changed.add(pkg.name);
          break;
        }
      }
    }
  }

  return changed;
}

/**
 * Compute the full bump set: changed packages + all transitive dependents.
 * Uses BFS through a reverse dependency graph.
 *
 * @param {Set<string>} changedPackages - directly changed package names
 * @param {Array<{path: string, pkg: object}>} allPackages - all discovered packages
 * @returns {Set<string>} packages to bump (changed + transitive dependents)
 */
export function computeBumpSet(changedPackages, allPackages) {
  // Build reverse dependency graph: depName -> Set<dependentName>
  const reverseDeps = new Map();

  for (const { pkg } of allPackages) {
    for (const depField of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      const deps = pkg[depField];
      if (!deps || typeof deps !== 'object') continue;

      for (const depName of Object.keys(deps)) {
        if (!reverseDeps.has(depName)) {
          reverseDeps.set(depName, new Set());
        }
        reverseDeps.get(depName).add(pkg.name);
      }
    }
  }

  // BFS from changed packages through reverse deps
  const bumpSet = new Set(changedPackages);
  const queue = [...changedPackages];

  while (queue.length > 0) {
    const current = queue.shift();
    const dependents = reverseDeps.get(current);
    if (!dependents) continue;

    // Also check cross-scope aliases
    const aliases = [current];
    if (UNSCOPED_PUBLISHABLE.has(current)) {
      aliases.push(`@claude-flow/${current}`, `@sparkleideas/${current}`);
    }
    if (current.startsWith('@claude-flow/')) {
      aliases.push(`@sparkleideas/${current.replace('@claude-flow/', '')}`);
    }
    if (current.startsWith('@sparkleideas/')) {
      aliases.push(`@claude-flow/${current.replace('@sparkleideas/', '')}`);
    }

    for (const alias of aliases) {
      const aliasDeps = reverseDeps.get(alias);
      if (!aliasDeps) continue;
      for (const dep of aliasDeps) {
        if (!bumpSet.has(dep)) {
          bumpSet.add(dep);
          queue.push(dep);
        }
      }
    }

    for (const dep of dependents) {
      if (!bumpSet.has(dep)) {
        bumpSet.add(dep);
        queue.push(dep);
      }
    }
  }

  return bumpSet;
}

// ── Bump all packages ──

/**
 * Bump all @sparkleideas/*, @claude-flow/*, and unscoped publishable packages
 * in one or more fork directories. Updates versions and internal dependency
 * references across all forks (ADR-0027: exact pinned versions, no wildcards).
 *
 * Queries npm registry to avoid version collisions. Idempotent: if a version
 * was bumped but never published, it is reused instead of bumping again.
 *
 * @param {string|string[]} dirs - fork root directory or array of directories
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun=false] - if true, don't write files
 * @param {boolean} [opts.skipNpmCheck=false] - if true, skip npm query (faster, for tests)
 * @param {Set<string>|null} [opts.onlyPackages=null] - if set, only bump these packages
 * @returns {Promise<{changes: Array<{name: string, from: string, to: string, path: string}>}>}
 */
export async function bumpAll(dirs, opts = {}) {
  const { dryRun = false, skipNpmCheck = false, onlyPackages = null } = opts;
  const dirList = Array.isArray(dirs) ? dirs : [dirs];

  // Discover packages across all forks
  const allPackages = [];
  for (const dir of dirList) {
    allPackages.push(...findPackages(dir));
  }

  // Build version map: packageName -> newVersion
  // Query npm in parallel for packages that need bumping
  const versionMap = new Map();
  const changes = [];

  if (!skipNpmCheck && (!onlyPackages || onlyPackages.size > 0)) {
    const count = onlyPackages ? onlyPackages.size : allPackages.length;
    console.log(`Querying npm registry for ${count} package version(s)...`);
  }

  // Compute safe versions (parallel npm queries)
  // Only query npm for packages in the bump set (or all if onlyPackages is null)
  const versionPromises = allPackages.map(async ({ path: pkgPath, pkg }) => {
    const oldVersion = pkg.version;
    const shouldBump = onlyPackages === null || onlyPackages.has(pkg.name);

    if (!shouldBump) {
      // Unchanged package — keep current version, no npm query
      return { pkgPath, pkg, oldVersion, newVersion: oldVersion, bumped: false };
    }

    let newVersion;
    if (skipNpmCheck) {
      newVersion = bumpPatchVersion(oldVersion);
    } else {
      newVersion = await safeNextVersion(oldVersion, pkg.name);
    }
    return { pkgPath, pkg, oldVersion, newVersion, bumped: true };
  });

  const versionResults = await Promise.all(versionPromises);

  for (const { pkgPath, pkg, oldVersion, newVersion, bumped } of versionResults) {
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

    if (bumped) {
      changes.push({
        name: pkg.name,
        from: oldVersion,
        to: newVersion,
        path: pkgPath,
      });
    }
  }

  // Apply version bumps and update internal dep references
  for (const { path: pkgPath, pkg } of allPackages) {
    const newVersion = versionMap.get(pkg.name);
    let modified = false;

    if (pkg.version !== newVersion) {
      pkg.version = newVersion;
      modified = true;
    }

    // Update internal dependency references in all dep fields
    // (even unchanged packages need updated dep refs if a dep was bumped)
    for (const depField of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      const deps = pkg[depField];
      if (!deps || typeof deps !== 'object') continue;

      for (const depName of Object.keys(deps)) {
        if (versionMap.has(depName) && deps[depName] !== versionMap.get(depName)) {
          deps[depName] = versionMap.get(depName);
          modified = true;
        }
      }
    }

    if (!dryRun && modified) {
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

// ── Reconcile with npm ──

/**
 * Query npm for the latest version of each @sparkleideas/* package
 * and rebuild config/published-versions.json from registry truth.
 * This recovers state after manual resets or failed publishes.
 */
async function reconcileWithNpm() {
  const { LEVELS } = await import('./publish.mjs');
  const allPackages = LEVELS.flat();

  console.log(`Reconciling ${allPackages.length} packages with npm registry...\n`);

  const stateFile = resolve(
    new URL('.', import.meta.url).pathname,
    '..', 'config', 'published-versions.json'
  );

  const versions = {};
  const results = await Promise.all(
    allPackages.map(async (name) => {
      try {
        const { stdout } = await execFileAsync('npm', ['view', name, 'dist-tags', '--json'], {
          timeout: 15_000,
        });
        const tags = JSON.parse(stdout);
        // Prefer prerelease tag (active publish), fall back to latest
        const version = tags.prerelease || tags.latest || null;
        return { name, version, error: null };
      } catch {
        return { name, version: null, error: 'not found' };
      }
    })
  );

  for (const { name, version, error } of results) {
    if (version) {
      versions[name] = version;
      console.log(`  ${name}: ${version}`);
    } else {
      console.log(`  ${name}: (not on npm)`);
    }
  }

  writeFileSync(stateFile, JSON.stringify(versions, null, 2) + '\n');
  console.log(`\nWrote ${Object.keys(versions).length} versions to config/published-versions.json`);
}

// ── CLI entry point ──

const isMainModule = process.argv[1] &&
  realpathSync(resolve(process.argv[1])) === realpathSync(__filename);

if (isMainModule) {
  try {
    const { positionals } = parseArgs({
      allowPositionals: true,
      strict: false,
    });

    const command = positionals[0];
    const dirs = positionals.slice(1);

    if (!command || (command !== 'reconcile' && dirs.length === 0)) {
      console.error('Usage: node scripts/fork-version.mjs <bump|show|reconcile> <fork-dir> [fork-dir2] ...');
      console.error('  bump [--skip-npm-check] [--changed-shas dir1:sha1,dir2:sha2]');
      console.error('       Bump -patch.N (queries npm to avoid collisions)');
      console.error('       --changed-shas: only bump packages changed since the given SHAs');
      console.error('  show                     Show current versions');
      console.error('  reconcile                Rebuild published-versions.json from npm');
      process.exit(1);
    }

    const resolvedDirs = dirs.map(d => resolve(d));

    if (command === 'show') {
      for (const dir of resolvedDirs) {
        showAll(dir);
      }
    } else if (command === 'bump') {
      const skipNpmCheck = process.argv.includes('--skip-npm-check');

      // Parse --changed-shas flag
      const changedShasIdx = process.argv.indexOf('--changed-shas');
      let onlyPackages = null;

      if (changedShasIdx !== -1 && process.argv[changedShasIdx + 1]) {
        const raw = process.argv[changedShasIdx + 1];
        const changedShas = new Map();
        for (const entry of raw.split(',')) {
          const colonIdx = entry.lastIndexOf(':');
          if (colonIdx === -1) continue;
          const dir = resolve(entry.slice(0, colonIdx));
          const sha = entry.slice(colonIdx + 1);
          changedShas.set(dir, sha || '');
        }

        if (changedShas.size > 0) {
          // Discover all packages first for change detection
          const allPackages = [];
          for (const dir of resolvedDirs) {
            allPackages.push(...findPackages(dir));
          }

          const directlyChanged = await detectChangedPackages(allPackages, changedShas);
          if (directlyChanged.size === 0) {
            console.log('No packages changed — skipping bump');
            console.log('BUMPED_PACKAGES:[]');
            process.exit(0);
          }

          onlyPackages = computeBumpSet(directlyChanged, allPackages);
          console.log(`Change detection: ${directlyChanged.size} changed, ${onlyPackages.size} in bump set (incl. dependents)`);

          // Emit directly-changed set (source files changed — need rebuild).
          // Distinct from BUMPED_PACKAGES (includes transitive deps that only need version bump).
          const directNames = [...new Set([...directlyChanged].map(n => toNpmName(n)))];
          console.log(`DIRECTLY_CHANGED:${JSON.stringify(directNames)}`);
        }
      }

      const { changes } = await bumpAll(resolvedDirs, { skipNpmCheck, onlyPackages });
      if (changes.length === 0) {
        console.log('No @sparkleideas/* or @claude-flow/* packages found.');
        console.log('BUMPED_PACKAGES:[]');
      } else {
        console.log(`Bumped ${changes.length} package(s):\n`);
        for (const c of changes) {
          console.log(`  ${c.name}: ${c.from} -> ${c.to}`);
        }

        // Output bumped packages as JSON for downstream consumers (deduplicated)
        const bumpedNames = [...new Set(changes.map(c => toNpmName(c.name)))];
        console.log(`BUMPED_PACKAGES:${JSON.stringify(bumpedNames)}`);
      }
    } else if (command === 'reconcile') {
      await reconcileWithNpm();
    } else {
      console.error(`Unknown command: ${command}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
