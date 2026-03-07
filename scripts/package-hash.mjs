#!/usr/bin/env node
// scripts/package-hash.mjs — SHA-256 content hashes for incremental build detection.
//
// Usage:
//   node scripts/package-hash.mjs --build-dir <dir> [--stored-hashes <path>] [--levels]
//
// Exported API:
//   import { computePackageHash, computeAllHashes, diffHashes, propagateChanges,
//            loadChecksums, saveChecksums } from './package-hash.mjs';

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, realpathSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { LEVELS } from './publish.mjs';

const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'dist']);

const DEFAULT_CHECKSUMS_PATH = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..', 'config', 'package-checksums.json'
);

// ── File walking ──

function walkFiles(dir, base) {
  const files = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return files; }
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      files.push(...walkFiles(full, base));
    } else {
      files.push(relative(base, full));
    }
  }
  return files;
}

// ── Package discovery (mirrors publish.mjs buildPackageMap) ──

function buildPackageMap(buildDir) {
  const map = new Map();
  function walk(dir) {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (entry === 'node_modules') continue;
      const full = resolve(dir, entry);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        walk(full);
      } else if (entry === 'package.json') {
        try {
          const pkg = JSON.parse(readFileSync(full, 'utf-8'));
          if (pkg.name) map.set(pkg.name, dir);
        } catch { /* skip malformed */ }
      }
    }
  }
  walk(buildDir);
  return map;
}

// ── Core functions ──

export function computePackageHash(pkgDir) {
  const files = walkFiles(pkgDir, pkgDir).sort();
  const hash = createHash('sha256');
  for (const rel of files) {
    const content = readFileSync(join(pkgDir, rel));
    hash.update(rel + '\0');
    hash.update(content);
  }
  return hash.digest('hex');
}

export function computeAllHashes(buildDir, packageMap) {
  const result = {};
  for (const [name, dir] of packageMap) {
    result[name] = 'sha256:' + computePackageHash(dir);
  }
  return result;
}

export function diffHashes(current, stored) {
  const changed = [];
  const unchanged = [];
  for (const pkg of Object.keys(current)) {
    if (stored[pkg] && stored[pkg] === current[pkg]) {
      unchanged.push(pkg);
    } else {
      changed.push(pkg);
    }
  }
  return { changed, unchanged };
}

export function propagateChanges(changed, levels) {
  const changedSet = new Set(changed);
  // Find the lowest level index containing any changed package
  let lowestChangedLevel = levels.length;
  for (let i = 0; i < levels.length; i++) {
    for (const pkg of levels[i]) {
      if (changedSet.has(pkg)) {
        lowestChangedLevel = Math.min(lowestChangedLevel, i);
        break;
      }
    }
  }
  // Everything at lowestChangedLevel+1 through end must also rebuild
  for (let i = lowestChangedLevel + 1; i < levels.length; i++) {
    for (const pkg of levels[i]) {
      changedSet.add(pkg);
    }
  }
  return [...changedSet];
}

export function loadChecksums(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return {};
  }
}

export function saveChecksums(filePath, checksums, meta) {
  const data = { ...meta, checksums };
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

// ── CLI entry point ──

async function main() {
  const { values } = parseArgs({
    options: {
      'build-dir':     { type: 'string' },
      'stored-hashes': { type: 'string' },
      'save':          { type: 'boolean', default: false },
      'levels':        { type: 'boolean', default: false },
    },
    strict: true,
  });

  const buildDir = values['build-dir'];
  if (!buildDir) {
    console.error('Usage: package-hash.mjs --build-dir <dir> [--stored-hashes <path>] [--save] [--levels]');
    process.exit(1);
  }

  const resolvedBuildDir = resolve(buildDir);
  const packageMap = buildPackageMap(resolvedBuildDir);
  const current = computeAllHashes(resolvedBuildDir, packageMap);

  if (values['save']) {
    saveChecksums(DEFAULT_CHECKSUMS_PATH, current, {
      generated: new Date().toISOString(),
      source: 'package-hash.mjs --save',
      buildDir: resolvedBuildDir,
    });
    console.log(`Saved checksums for ${Object.keys(current).length} packages to ${DEFAULT_CHECKSUMS_PATH}`);
    if (!values['stored-hashes']) {
      process.exit(0);
    }
  }

  const output = { changed: [], unchanged: [], all_rebuild: [] };

  if (values['stored-hashes']) {
    const stored = loadChecksums(resolve(values['stored-hashes']));
    const storedChecksums = stored.checksums || stored;
    const diff = diffHashes(current, storedChecksums);
    output.changed = diff.changed;
    output.unchanged = diff.unchanged;

    if (values['levels']) {
      output.all_rebuild = propagateChanges(diff.changed, LEVELS);
    } else {
      output.all_rebuild = diff.changed;
    }
  } else {
    // No stored hashes — everything is changed
    output.changed = Object.keys(current);
    output.all_rebuild = Object.keys(current);
  }

  console.log(JSON.stringify(output, null, 2));
}

const __filename = fileURLToPath(import.meta.url);
const isMainModule = process.argv[1] &&
  realpathSync(resolve(process.argv[1])) === realpathSync(__filename);

if (isMainModule) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
