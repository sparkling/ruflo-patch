#!/usr/bin/env node
/**
 * Codemod-phase intra-workspace symlink pass (ADR-0162 follow-up).
 *
 * After codemod renames `@claude-flow/*` → `@sparkleideas/*` in
 * `/tmp/ruflo-build/v3/@claude-flow/<pkg>/package.json`, workspace-internal
 * runtime bare specifiers in published dist files (e.g.
 * `cli/dist/src/output.js: import * from '@sparkleideas/cli-core/output'`)
 * cannot be resolved by `node` because no `node_modules/@sparkleideas/<dep>`
 * link exists in the build tree. Pre-Batch-F-2 the cli was self-contained
 * via relative paths; F-2 introduced the first re-export shim and surfaced
 * the gap.
 *
 * This pass walks every package.json under `<buildDir>/v3/@claude-flow/`,
 * builds a name→directory map of all in-tree workspace packages (after
 * codemod, the directory is still `@claude-flow/<short>` but the package
 * `name:` field is `@sparkleideas/<short>`), and creates a relative
 * symlink at `<pkg>/node_modules/@sparkleideas/<dep>` → `../../../<dep>`
 * for every dependency / optionalDependency / peerDependency whose name
 * matches an in-tree package.
 *
 * Externals (e.g. `@sparkleideas/ruvector-rabitq-wasm` — no source in the
 * build tree) are deliberately left for Verdaccio resolution at the
 * acceptance phase. Per feedback-no-fallbacks: this is NOT a silent skip;
 * it's correct routing. The workspace map IS the predicate.
 *
 * Per feedback-build-scripts-only: this module is invoked by
 * `lib/pipeline-helpers.sh::run_codemod` immediately after
 * `codemod.mjs`. No new top-level npm script.
 *
 * Per feedback-no-fallbacks:
 *   - If buildDir doesn't exist: throw.
 *   - If a workspace package.json is invalid JSON: throw.
 *   - If a symlink target dir vanishes between map-build and link: throw.
 *   - If symlink creation fails (permission, EEXIST on a real dir): throw.
 *   - The "skip externals" case is NOT a fallback: those deps have no
 *     in-tree source and ARE expected to resolve from Verdaccio.
 *
 * Idempotent: if a symlink with the correct target already exists at the
 * link path, it's left in place; if a different target exists, it's
 * replaced. Real directories at the link path are never overwritten —
 * that's a fatal misconfiguration.
 *
 * Usage:
 *   node scripts/codemod-symlink-workspace.mjs /tmp/ruflo-build
 *
 * Or import:
 *   import { linkWorkspace } from './scripts/codemod-symlink-workspace.mjs';
 *   const stats = await linkWorkspace('/tmp/ruflo-build');
 */

import { readdir, readFile, mkdir, symlink, lstat, unlink, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

const WORKSPACE_SUBDIR = 'v3/@claude-flow';
const SCOPE = '@sparkleideas';
const DEP_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'];

/**
 * Build a name→directory map of all in-tree workspace packages.
 *
 * After codemod, package directories under `v3/@claude-flow/<short>/`
 * still use the upstream layout name, but their `package.json` declares
 * `name: '@sparkleideas/<short>'`. This map keys by the published name so
 * dependency lookups match dependency declarations.
 */
async function buildWorkspaceMap(buildDir) {
  const wsRoot = join(buildDir, WORKSPACE_SUBDIR);
  const wsStat = await stat(wsRoot);
  if (!wsStat.isDirectory()) {
    throw new Error(`Workspace root not a directory: ${wsRoot}`);
  }

  const entries = await readdir(wsRoot, { withFileTypes: true });
  const map = new Map(); // name → absolute pkg dir

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgDir = join(wsRoot, entry.name);
    const pkgJson = join(pkgDir, 'package.json');
    let raw;
    try {
      raw = await readFile(pkgJson, 'utf8');
    } catch (err) {
      // Missing package.json in a subdir is fine (e.g. shared agents/) —
      // it's NOT a workspace package, so it's not a fallback to skip it.
      if (err.code === 'ENOENT') continue;
      throw err;
    }
    let json;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Invalid package.json at ${pkgJson}: ${err.message}`);
    }
    if (typeof json.name !== 'string' || !json.name.startsWith(`${SCOPE}/`)) continue;
    map.set(json.name, pkgDir);
  }

  return map;
}

/**
 * Replace a stale symlink or create a new one. Refuses to overwrite a real
 * directory — that's a misconfiguration the pipeline must surface.
 */
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
        `(expected symlink or absent). Manual cleanup required.`
      );
    }
    // Read the existing link target via fs.readlink for comparison.
    const { readlink } = await import('node:fs/promises');
    const currentTarget = await readlink(linkPath);
    if (currentTarget === targetRel) return false; // already correct
    await unlink(linkPath);
  }

  await symlink(targetRel, linkPath, 'dir');
  return true;
}

/**
 * Walk every workspace package.json and link its in-tree workspace deps
 * into its `node_modules/<scope>/<name>` directory.
 *
 * Returns { packages, linksCreated, linksSkipped, externalsSkipped }.
 */
export async function linkWorkspace(buildDir) {
  const buildStat = await stat(buildDir);
  if (!buildStat.isDirectory()) {
    throw new Error(`Build dir not a directory: ${buildDir}`);
  }

  const map = await buildWorkspaceMap(buildDir);
  const stats = { packages: 0, linksCreated: 0, linksReused: 0, externalsSkipped: 0 };

  for (const [pkgName, pkgDir] of map) {
    stats.packages += 1;
    const pkgJson = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8'));

    // Collect every dep name we need to consider linking.
    const seen = new Set();
    for (const field of DEP_FIELDS) {
      const obj = pkgJson[field];
      if (!obj || typeof obj !== 'object') continue;
      for (const dep of Object.keys(obj)) {
        if (!dep.startsWith(`${SCOPE}/`)) continue; // unscoped third-party
        seen.add(dep);
      }
    }

    if (seen.size === 0) continue;

    // Make sure the @sparkleideas dir under node_modules exists once,
    // before per-dep symlinks.
    const scopeDir = join(pkgDir, 'node_modules', SCOPE);
    await mkdir(scopeDir, { recursive: true });

    for (const dep of seen) {
      const targetDir = map.get(dep);
      if (!targetDir) {
        // External — resolved from Verdaccio at acceptance, or from public
        // npm at user install. Not a silent fallback: external deps by
        // definition have no in-tree source, and the workspace map IS the
        // authoritative predicate.
        stats.externalsSkipped += 1;
        continue;
      }

      const linkName = dep.slice(SCOPE.length + 1); // strip "@sparkleideas/"
      const linkPath = join(scopeDir, linkName);
      const targetRel = relative(scopeDir, targetDir);

      const created = await ensureSymlink(linkPath, targetRel);
      if (created) {
        stats.linksCreated += 1;
        console.log(`  link  ${pkgName} → ${dep}  (${targetRel})`);
      } else {
        stats.linksReused += 1;
      }
    }
  }

  return stats;
}

// -- CLI entry point ----------------------------------------------------------

const isMain = process.argv[1] && process.argv[1].endsWith('codemod-symlink-workspace.mjs');

if (isMain) {
  const buildDir = process.argv[2];
  if (!buildDir) {
    console.error('Usage: node scripts/codemod-symlink-workspace.mjs <build-dir>');
    process.exit(1);
  }
  linkWorkspace(buildDir)
    .then((stats) => {
      console.log('Workspace symlink pass complete.');
      console.log(`  Packages scanned:    ${stats.packages}`);
      console.log(`  Symlinks created:    ${stats.linksCreated}`);
      console.log(`  Symlinks reused:     ${stats.linksReused}`);
      console.log(`  Externals skipped:   ${stats.externalsSkipped}`);
    })
    .catch((err) => {
      console.error('Symlink pass failed:', err.message);
      process.exit(1);
    });
}
