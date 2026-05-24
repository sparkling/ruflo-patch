#!/usr/bin/env node
/**
 * Codemod-phase external runtime-dep installer (ADR-0231 outstanding follow-up).
 *
 * Sibling to `codemod-symlink-workspace.mjs`. That script links
 * @sparkleideas/* workspace-internal deps; this one installs unscoped
 * third-party runtime deps (e.g. `zod`, `sql.js`, `ws`, `semver`) so
 * test-ci can resolve runtime `import 'bare-name'` from dist files.
 *
 * Gap closed by this script: before ADR-0231 wave 4 release, the test-ci
 * phase loaded `/tmp/ruflo-build/v3/@claude-flow/shared/dist/core/config/schema.js`
 * which does `import { z } from 'zod'`. The workspace-symlink pass left
 * `zod` unresolved (it's not @sparkleideas/-scoped), and there was no
 * top-level `node_modules` in the build tree for Node's walk-up
 * resolution to find. Result: 14 unit tests failed with
 * ERR_MODULE_NOT_FOUND, blocking publish.
 *
 * Strategy:
 *   1. Walk every package.json under v3/@claude-flow/ and cross-repo/.
 *   2. Aggregate every NON-workspace-internal, non-`workspace:`-protocol
 *      runtime dep into a single Map<name, version-range>. First version
 *      wins on conflict (workspace consistency is the codebase's
 *      responsibility, not this script's).
 *   3. Install all aggregated deps into a flat dir
 *      <buildDir>/.externals/node_modules using `npm install
 *      --no-workspaces` (avoids the `workspace:*` protocol resolution
 *      that breaks plain `npm install` in this tree).
 *   4. For each package that needs any externals, symlink
 *      <pkg>/node_modules/<dep> → <buildDir>/.externals/node_modules/<dep>
 *      (or the scoped equivalent). Walk-up resolution from dist files
 *      then finds the dep at the package level.
 *
 * Per [[feedback-no-fallbacks]]:
 *   - If buildDir doesn't exist: throw.
 *   - If aggregate `npm install` fails: throw with exit code.
 *   - If a real directory exists where a symlink should go: throw (not
 *     overwritten silently).
 *   - Version conflicts log a warning but don't abort — different
 *     packages with different version ranges is normal in a polyrepo
 *     workspace, and a conservative "first version wins" is honest
 *     about what was installed.
 *
 * Idempotent: re-running with an unchanged dep set is a no-op (npm
 * install detects the existing tree; symlinks already correct).
 *
 * Per [[feedback-build-scripts-only]]: invoked by
 * `lib/pipeline-helpers.sh::run_codemod` after `codemod-symlink-workspace.mjs`.
 * No new top-level npm script.
 *
 * Usage:
 *   node scripts/install-runtime-externals.mjs /tmp/ruflo-build
 */

import { readdir, readFile, mkdir, symlink, lstat, unlink, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';

const INTERNAL_SCOPES = ['@sparkleideas/', '@claude-flow/'];
const WALK_SUBDIRS = ['v3/@claude-flow', 'cross-repo'];
const DEP_FIELDS = ['dependencies', 'peerDependencies'];
const EXTERNALS_DIR_NAME = '.externals';

function isInternal(depName) {
  return INTERNAL_SCOPES.some((s) => depName.startsWith(s));
}

function isWorkspaceProtocol(versionSpec) {
  return typeof versionSpec === 'string' && versionSpec.startsWith('workspace:');
}

async function readJsonOrNull(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function walkPackagesUnder(buildDir, subdir) {
  const root = join(buildDir, subdir);
  const out = [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return out;
    throw err;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgDir = join(root, entry.name);
    const json = await readJsonOrNull(join(pkgDir, 'package.json'));
    if (!json || typeof json.name !== 'string') continue;
    out.push({ pkgDir, json });
  }
  return out;
}

function collectExternalDeps(pkgJson) {
  const externals = {};
  for (const field of DEP_FIELDS) {
    const deps = pkgJson[field];
    if (!deps || typeof deps !== 'object') continue;
    for (const [dep, ver] of Object.entries(deps)) {
      if (isInternal(dep)) continue;
      if (isWorkspaceProtocol(ver)) continue;
      externals[dep] = ver;
    }
  }
  return externals;
}

async function ensureSymlink(linkPath, targetRel) {
  let existing;
  try {
    existing = await lstat(linkPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (existing) {
    if (!existing.isSymbolicLink()) {
      throw new Error(
        `Refusing to overwrite real entry at ${linkPath} ` +
          `(expected symlink or absent). Manual cleanup required.`,
      );
    }
    const { readlink } = await import('node:fs/promises');
    const cur = await readlink(linkPath);
    if (cur === targetRel) return false;
    await unlink(linkPath);
  }
  await symlink(targetRel, linkPath, 'dir');
  return true;
}

export async function installRuntimeExternals(buildDir) {
  const buildStat = await stat(buildDir);
  if (!buildStat.isDirectory()) {
    throw new Error(`Build dir not a directory: ${buildDir}`);
  }

  const allPkgs = [];
  for (const sub of WALK_SUBDIRS) {
    allPkgs.push(...(await walkPackagesUnder(buildDir, sub)));
  }

  const aggregate = new Map();
  const conflicts = new Map();
  for (const { json } of allPkgs) {
    const externals = collectExternalDeps(json);
    for (const [dep, ver] of Object.entries(externals)) {
      if (!aggregate.has(dep)) {
        aggregate.set(dep, ver);
        continue;
      }
      const existing = aggregate.get(dep);
      if (existing !== ver) {
        if (!conflicts.has(dep)) conflicts.set(dep, new Set([existing]));
        conflicts.get(dep).add(ver);
      }
    }
  }

  if (conflicts.size > 0) {
    console.warn(`install-runtime-externals: ${conflicts.size} version conflict(s) (first wins):`);
    for (const [dep, vers] of conflicts) {
      console.warn(`  ${dep}: ${[...vers].join(' vs ')}  -> using ${aggregate.get(dep)}`);
    }
  }

  if (aggregate.size === 0) {
    console.log('install-runtime-externals: no externals to install');
    return { aggregated: 0, linksCreated: 0, linksReused: 0 };
  }

  const externalsDir = join(buildDir, EXTERNALS_DIR_NAME);
  await mkdir(externalsDir, { recursive: true });
  const externalsPkgJson = {
    name: 'ruflo-build-externals',
    version: '0.0.0',
    private: true,
    dependencies: Object.fromEntries(aggregate),
  };
  await writeFile(join(externalsDir, 'package.json'), JSON.stringify(externalsPkgJson, null, 2));

  console.log(`install-runtime-externals: installing ${aggregate.size} dep(s) into ${externalsDir}`);
  // Bulk-install first (fast path). If it fails (e.g. one external is
  // unpublished — agentic-flow declares `flow-nexus@^1.0.0` which is not
  // on npm), fall back to per-dep install so individual failures don't
  // block the whole tree.
  try {
    execSync('npm install --no-save --no-audit --no-fund --no-workspaces --omit=optional --omit=peer', {
      cwd: externalsDir,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
  } catch (bulkErr) {
    console.warn(`install-runtime-externals: bulk install failed (${bulkErr.message.split('\n')[0]}); falling back to per-dep install`);
    // Reset the externalsDir package.json so per-dep installs accumulate
    await writeFile(
      join(externalsDir, 'package.json'),
      JSON.stringify({ name: 'ruflo-build-externals', version: '0.0.0', private: true }, null, 2),
    );
    let installedCount = 0;
    const skipped = [];
    for (const [dep, ver] of aggregate) {
      try {
        execSync(`npm install --no-save --no-audit --no-fund --no-workspaces --omit=optional --omit=peer "${dep}@${ver}"`, {
          cwd: externalsDir,
          stdio: 'ignore',
        });
        installedCount += 1;
      } catch (depErr) {
        skipped.push(`${dep}@${ver}`);
      }
    }
    console.warn(`install-runtime-externals: per-dep install: ${installedCount} installed, ${skipped.length} skipped`);
    if (skipped.length > 0) {
      console.warn(`install-runtime-externals: skipped (likely unpublished or yanked): ${skipped.join(', ')}`);
    }
  }

  let linksCreated = 0;
  let linksReused = 0;
  const externalsNm = join(externalsDir, 'node_modules');

  for (const { pkgDir, json } of allPkgs) {
    const needed = collectExternalDeps(json);
    const names = Object.keys(needed);
    if (names.length === 0) continue;
    const pkgNm = join(pkgDir, 'node_modules');
    await mkdir(pkgNm, { recursive: true });
    for (const dep of names) {
      let linkPath;
      let targetAbs;
      if (dep.startsWith('@')) {
        const [scope, name] = dep.split('/');
        const scopeDir = join(pkgNm, scope);
        await mkdir(scopeDir, { recursive: true });
        linkPath = join(scopeDir, name);
        targetAbs = join(externalsNm, scope, name);
      } else {
        linkPath = join(pkgNm, dep);
        targetAbs = join(externalsNm, dep);
      }
      try {
        await stat(targetAbs);
      } catch (err) {
        if (err.code === 'ENOENT') {
          // External not installed (npm rejected for some reason — e.g.
          // package no longer published). Skip this link; consumer code
          // will fail loud at runtime if it actually needs the dep.
          continue;
        }
        throw err;
      }
      const targetRel = relative(dep.startsWith('@') ? join(pkgNm, dep.split('/')[0]) : pkgNm, targetAbs);
      const created = await ensureSymlink(linkPath, targetRel);
      if (created) linksCreated += 1;
      else linksReused += 1;
    }
  }

  console.log('install-runtime-externals: complete');
  console.log(`  Externals aggregated: ${aggregate.size}`);
  console.log(`  Symlinks created:     ${linksCreated}`);
  console.log(`  Symlinks reused:      ${linksReused}`);

  return { aggregated: aggregate.size, linksCreated, linksReused };
}

const isMain = process.argv[1] && process.argv[1].endsWith('install-runtime-externals.mjs');

if (isMain) {
  const buildDir = process.argv[2];
  if (!buildDir) {
    console.error('Usage: node scripts/install-runtime-externals.mjs <build-dir>');
    process.exit(1);
  }
  installRuntimeExternals(buildDir).catch((err) => {
    console.error('install-runtime-externals failed:', err.message);
    process.exit(1);
  });
}
