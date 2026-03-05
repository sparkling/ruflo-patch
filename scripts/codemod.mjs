#!/usr/bin/env node
/**
 * Scope-rename codemod for the ruflo build pipeline.
 *
 * Transforms a cloned upstream source tree, renaming all @claude-flow/*
 * references to @sparkleideas/* and handling unscoped package mappings.
 *
 * See ADR-0013 (codemod-implementation) and ADR-0006 (npm-scope-naming).
 *
 * Usage:
 *   node scripts/codemod.mjs /path/to/temp-dir
 *
 * Or import as a module:
 *   import { transform } from './scripts/codemod.mjs';
 *   const stats = await transform('/path/to/temp-dir');
 */

import { readdir, readFile, writeFile, stat, unlink } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';

// -- Package mapping (inline; switchable to config/package-map.json) ----------

const SCOPED_PREFIX_FROM = '@claude-flow/';
const SCOPED_PREFIX_TO = '@sparkleideas/';

/** Unscoped exact-name mappings (used in package.json name/dep key transforms). */
const UNSCOPED_MAP = {
  'claude-flow': '@sparkleideas/claude-flow',
  'ruflo': '@sparkleideas/ruflo',
  'agentdb': '@sparkleideas/agentdb',
  'agentic-flow': '@sparkleideas/agentic-flow',
  'ruv-swarm': '@sparkleideas/ruv-swarm',
};

// -- File filters -------------------------------------------------------------

const ALLOWED_EXTENSIONS = new Set([
  '.js', '.ts', '.mjs', '.cjs', '.json', '.d.ts', '.d.mts',
]);

const SKIP_DIRS = new Set(['.git', 'node_modules']);
const SKIP_FILE_PREFIXES = ['LICENSE'];
const DELETE_FILES = new Set(['pnpm-lock.yaml']);

/** Returns true if `name` starts with any skip prefix. */
function isSkippedFile(name) {
  return SKIP_FILE_PREFIXES.some((p) => name.startsWith(p));
}

/** Returns the effective extension, handling compound extensions like .d.ts. */
function effectiveExt(filename) {
  if (filename.endsWith('.d.ts')) return '.d.ts';
  if (filename.endsWith('.d.mts')) return '.d.mts';
  return extname(filename);
}

// -- Name mapping (for package.json keys) ------------------------------------

/**
 * Apply the name mapping to a single package name string.
 * Returns the mapped name, or the original if no mapping applies.
 */
function applyNameMapping(name) {
  if (name.startsWith('@sparkleideas/')) return name; // already transformed
  if (name.startsWith(SCOPED_PREFIX_FROM)) {
    return SCOPED_PREFIX_TO + name.slice(SCOPED_PREFIX_FROM.length);
  }
  return UNSCOPED_MAP[name] ?? name;
}

// -- Phase 1: package.json transform ------------------------------------------

const DEP_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'];
const KEY_RENAME_FIELDS = ['bin', 'exports'];

/**
 * Transform a package.json object in place.
 * Returns true if any change was made.
 */
function transformPackageJsonObject(json) {
  let changed = false;

  // Transform "name"
  if (typeof json.name === 'string') {
    const mapped = applyNameMapping(json.name);
    if (mapped !== json.name) {
      json.name = mapped;
      changed = true;
    }
  }

  // Transform dependency maps (rename keys)
  for (const field of DEP_FIELDS) {
    if (json[field] && typeof json[field] === 'object') {
      changed = renameDependencyKeys(json[field]) || changed;
    }
  }

  // Transform bin and exports (rename keys that are package names)
  for (const field of KEY_RENAME_FIELDS) {
    if (json[field] && typeof json[field] === 'object') {
      changed = renameObjectKeys(json[field]) || changed;
    }
  }

  return changed;
}

/** Rename keys in a dependency-style object ({ "pkg-name": "^1.0" }). */
function renameDependencyKeys(obj) {
  let changed = false;
  for (const key of Object.keys(obj)) {
    const mapped = applyNameMapping(key);
    if (mapped !== key) {
      obj[mapped] = obj[key];
      delete obj[key];
      changed = true;
    }
  }
  return changed;
}

/** Rename keys in bin/exports objects where the key itself is a package name. */
function renameObjectKeys(obj) {
  let changed = false;
  for (const key of Object.keys(obj)) {
    const mapped = applyNameMapping(key);
    if (mapped !== key) {
      obj[mapped] = obj[key];
      delete obj[key];
      changed = true;
    }
    // Recurse into nested objects (exports can be deeply nested)
    if (obj[mapped ?? key] && typeof obj[mapped ?? key] === 'object') {
      changed = renameObjectKeys(obj[mapped ?? key]) || changed;
    }
  }
  return changed;
}

// -- Phase 2: Source file regex transform --------------------------------------

// Step 1: Scoped replacement -- @claude-flow/ -> @sparkleideas/
// Only match @claude-flow/ that is NOT already part of @sparkleideas/
const SCOPED_RE = /@claude-flow\//g;

// Step 2: Unscoped replacements with word-boundary guards.
// Negative lookbehind prevents matching inside scoped names or hyphenated words.
// Negative lookahead prevents matching already-transformed or hyphenated continuations.
const UNSCOPED_RES = [
  { re: /(?<![@/\w-])claude-flow(?![\w-])/g, to: '@sparkleideas/claude-flow' },
  { re: /(?<![@/\w-])agentdb(?![\w-])/g, to: '@sparkleideas/agentdb' },
  { re: /(?<![@/\w-])agentic-flow(?![\w-])/g, to: '@sparkleideas/agentic-flow' },
  { re: /(?<![@/\w-])ruv-swarm(?![\w-])/g, to: '@sparkleideas/ruv-swarm' },
  { re: /(?<![@/\w-])ruflo(?![\w-])/g, to: '@sparkleideas/ruflo' },
];

/**
 * Apply all regex replacements to source file content.
 * Returns the transformed content (may be identical if no matches).
 */
function transformSource(content) {
  // Phase 1: scoped
  let result = content.replace(SCOPED_RE, SCOPED_PREFIX_TO);
  // Phase 2: unscoped (order matters less here since they are disjoint,
  // but we process them in the declared order for determinism)
  for (const { re, to } of UNSCOPED_RES) {
    re.lastIndex = 0; // reset stateful regex
    result = result.replace(re, to);
  }
  return result;
}

// -- File walker --------------------------------------------------------------

/** Recursively walk `dir`, yielding absolute file paths that pass the filter. */
async function* walkFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

// -- Main transform -----------------------------------------------------------

/** Transform an entire directory tree in place. */
export async function transform(tempDir) {
  // Validate tempDir exists
  const dirStat = await stat(tempDir);
  if (!dirStat.isDirectory()) {
    throw new Error(`Not a directory: ${tempDir}`);
  }

  const stats = {
    filesScanned: 0,
    filesTransformed: 0,
    packageJsonProcessed: 0,
    deletedFiles: [],
  };

  for await (const filePath of walkFiles(tempDir)) {
    const name = basename(filePath);

    // Delete lockfiles
    if (DELETE_FILES.has(name)) {
      await unlink(filePath);
      stats.deletedFiles.push(filePath);
      continue;
    }

    // Skip LICENSE files
    if (isSkippedFile(name)) continue;

    // Check extension allowlist
    const ext = effectiveExt(name);
    if (!ALLOWED_EXTENSIONS.has(ext)) continue;

    stats.filesScanned++;

    const isPackageJson = name === 'package.json';

    if (isPackageJson) {
      stats.packageJsonProcessed++;
      const raw = await readFile(filePath, 'utf8');
      let json;
      try {
        json = JSON.parse(raw);
      } catch {
        // Malformed JSON -- skip, do not corrupt
        continue;
      }
      const changed = transformPackageJsonObject(json);
      if (changed) {
        // Preserve trailing newline if original had one
        const trailing = raw.endsWith('\n') ? '\n' : '';
        await writeFile(filePath, JSON.stringify(json, null, 2) + trailing, 'utf8');
        stats.filesTransformed++;
      }
    } else {
      const content = await readFile(filePath, 'utf8');
      const transformed = transformSource(content);
      if (transformed !== content) {
        await writeFile(filePath, transformed, 'utf8');
        stats.filesTransformed++;
      }
    }
  }

  return stats;
}

// -- CLI entry point ----------------------------------------------------------

const isMainModule = process.argv[1] &&
  (process.argv[1].endsWith('codemod.mjs') || process.argv[1].endsWith('codemod.js'));

if (isMainModule) {
  const tempDir = process.argv[2];
  if (!tempDir) {
    console.error('Usage: node scripts/codemod.mjs <directory>');
    process.exit(1);
  }

  transform(tempDir)
    .then((stats) => {
      console.log('Codemod complete.');
      console.log(`  Files scanned:          ${stats.filesScanned}`);
      console.log(`  Files transformed:      ${stats.filesTransformed}`);
      console.log(`  package.json processed: ${stats.packageJsonProcessed}`);
      if (stats.deletedFiles.length > 0) {
        console.log(`  Deleted files:          ${stats.deletedFiles.length}`);
        for (const f of stats.deletedFiles) {
          console.log(`    - ${f}`);
        }
      }
    })
    .catch((err) => {
      console.error('Codemod failed:', err.message);
      process.exit(1);
    });
}
