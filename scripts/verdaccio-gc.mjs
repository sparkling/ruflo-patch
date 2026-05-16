#!/usr/bin/env node
/**
 * Verdaccio storage GC — ADR-0182 lever L8.
 *
 * Caps unbounded growth of ~/.local/share/verdaccio/storage by applying a
 * keep-last-N policy per @sparkleideas/* package while protecting any
 * tarball still pinned from any of the enumerated pin sources.
 *
 * Enumeration sources (per ADR-0182 prompt for L8):
 *   (a) forks/{ruflo,agentic-flow,ruv-FANN,ruvector,agentdb}/**\/package.json
 *       — own `version` field + dependency-map entries pinning `-patch.N`
 *   (b) scripts/codemod.mjs — does NOT carry version rewrite tables (versions
 *       come from forks/*\/package.json), but UNSCOPED_MAP defines the set of
 *       package names whose `-patch.N` refs are valid; we consult it as a
 *       sanity check (unmatched packages stay protected via safety floor).
 *   (c) scripts/.last-build-state — only stores fork HEAD SHAs (no version
 *       refs); kept in the enumeration list so any future addition of
 *       version refs is automatically respected.
 *   (d) .release-epoch — explicitly deferred to lever L3; not consulted here.
 *
 * Atomic checkpoint: if ANY enumeration source fails (read error, malformed
 * JSON, unreadable directory), the script aborts BEFORE any delete operation
 * runs (no silent fallback — feedback-no-fallbacks + zero-tolerance-data-loss).
 *
 * Keep-last-N is a SAFETY FLOOR, not a ceiling: never drop below N regardless
 * of pin-refs. Pin-refs only RAISE the floor (never drop a pinned tarball
 * even if older than N).
 *
 * Usage:
 *   node scripts/verdaccio-gc.mjs                       # full run
 *   node scripts/verdaccio-gc.mjs --dry-run             # enumerate, don't delete
 *   node scripts/verdaccio-gc.mjs --dry-run --print-pins # also dump pin-ref set
 *   RUFLO_VERDACCIO_GC_KEEP_LAST=20 node scripts/verdaccio-gc.mjs
 *   RUFLO_VERDACCIO_STORAGE=/custom/path node scripts/verdaccio-gc.mjs
 */

import { readdir, readFile, writeFile, stat, unlink, appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = dirname(__filename);
const PROJECT_DIR = dirname(SCRIPT_DIR);

const ARGS = new Set(process.argv.slice(2));
const DRY_RUN = ARGS.has('--dry-run');
const PRINT_PINS = ARGS.has('--print-pins');

const DEFAULT_STORAGE = join(homedir(), '.local', 'share', 'verdaccio', 'storage');
const STORAGE_ROOT = process.env.RUFLO_VERDACCIO_STORAGE || DEFAULT_STORAGE;
const SCOPE = '@sparkleideas';
const KEEP_LAST = Number(process.env.RUFLO_VERDACCIO_GC_KEEP_LAST || 10);

if (!Number.isInteger(KEEP_LAST) || KEEP_LAST < 1) {
  console.error(`[L8][fatal] RUFLO_VERDACCIO_GC_KEEP_LAST must be a positive integer (got ${process.env.RUFLO_VERDACCIO_GC_KEEP_LAST})`);
  process.exit(1);
}

const FORKS_ROOT = process.env.RUFLO_FORKS_ROOT || join(homedir(), 'source', 'forks');
const FORK_NAMES = ['ruflo', 'agentic-flow', 'ruv-FANN', 'ruvector', 'agentdb'];
const LOGS_DIR = join(PROJECT_DIR, 'logs');
const LOG_JSONL = join(LOGS_DIR, 'verdaccio-gc.jsonl');

// Categorical skips. These trees never participate in publishing and cannot
// pin a `-patch.N` ref that affects what we MUST keep in Verdaccio:
//   - node_modules/.git/dist/build/target/.next/coverage — generated/installed
//   - archive/  — forks/ruflo/archive/v2/** holds upstream's frozen v2 demo
//     tree (some files are prose labelled package.json, not JSON). The v3
//     pipeline ignores it; we ignore it too.
const SKIP_DIRS_IN_FORKS = new Set(['node_modules', '.git', 'dist', 'build', 'target', '.next', 'coverage', 'archive']);

// ──────────────────────────────────────────────────────────────────────────────
// Pin-ref enumeration
// ──────────────────────────────────────────────────────────────────────────────

/** Pin tuple: { pkg: '@sparkleideas/cli', version: '3.5.51-patch.42', source: 'forks/...' } */

const PATCH_SUFFIX_RE = /-patch\.\d+$/;
const SPARKLE_PREFIX = '@sparkleideas/';
const CLAUDE_FLOW_PREFIX = '@claude-flow/';
const RUVECTOR_PREFIX = '@ruvector/';

/** Map raw dep name → @sparkleideas/* canonical name used by codemod. */
function normalizePkgName(name, unscopedMap) {
  if (name.startsWith(SPARKLE_PREFIX)) return name;
  if (name.startsWith(CLAUDE_FLOW_PREFIX)) {
    return SPARKLE_PREFIX + name.slice(CLAUDE_FLOW_PREFIX.length);
  }
  if (name.startsWith(RUVECTOR_PREFIX)) {
    return SPARKLE_PREFIX + 'ruvector-' + name.slice(RUVECTOR_PREFIX.length);
  }
  return unscopedMap[name] ?? null;
}

async function loadUnscopedMap() {
  const codemodPath = join(SCRIPT_DIR, 'codemod.mjs');
  if (!existsSync(codemodPath)) {
    throw new Error(`scripts/codemod.mjs missing at ${codemodPath} — cannot enumerate package-name mappings`);
  }
  const mod = await import(codemodPath);
  if (!mod.UNSCOPED_MAP || typeof mod.UNSCOPED_MAP !== 'object') {
    throw new Error(`scripts/codemod.mjs does not export UNSCOPED_MAP`);
  }
  return mod.UNSCOPED_MAP;
}

async function* walkPackageJsons(rootDir) {
  let entries;
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  for (const entry of entries) {
    const full = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS_IN_FORKS.has(entry.name)) continue;
      yield* walkPackageJsons(full);
    } else if (entry.isFile() && entry.name === 'package.json') {
      yield full;
    }
  }
}

/**
 * Read a fork's package.json (any depth) and extract every -patch.N pin:
 *   - own `name`+`version` if `version` ends with -patch.N
 *   - every key in {dependencies, devDependencies, peerDependencies,
 *     optionalDependencies} whose value ends with -patch.N
 *
 * The pkg name is normalized to its @sparkleideas/* canonical form via the
 * codemod's UNSCOPED_MAP. Any unmapped name is recorded with `source` marked
 * `unmapped:<name>` so it shows up in --print-pins but is treated as
 * protective (cannot match a published @sparkleideas/* tarball).
 */
async function enumerateForkPins(unscopedMap) {
  const pins = []; // { pkg, version, source }
  const errors = [];

  if (!existsSync(FORKS_ROOT)) {
    errors.push(`forks root missing at ${FORKS_ROOT} (RUFLO_FORKS_ROOT override?)`);
    return { pins, errors };
  }

  for (const forkName of FORK_NAMES) {
    const forkDir = join(FORKS_ROOT, forkName);
    if (!existsSync(forkDir)) {
      // Missing fork is a hard error — we don't know what versions it pins
      errors.push(`fork dir missing: ${forkDir}`);
      continue;
    }
    try {
      for await (const pkgJsonPath of walkPackageJsons(forkDir)) {
        const relPath = pkgJsonPath.slice(FORKS_ROOT.length + 1);
        let raw;
        try {
          raw = await readFile(pkgJsonPath, 'utf8');
        } catch (err) {
          errors.push(`read failed: ${pkgJsonPath}: ${err.message}`);
          continue;
        }
        let json;
        try {
          json = JSON.parse(raw);
        } catch (err) {
          errors.push(`invalid JSON: ${pkgJsonPath}: ${err.message}`);
          continue;
        }

        // (1) Own name + version
        if (json.name && typeof json.version === 'string' && PATCH_SUFFIX_RE.test(json.version)) {
          const canonical = normalizePkgName(json.name, unscopedMap);
          if (canonical) {
            pins.push({ pkg: canonical, version: json.version, source: `self:${relPath}` });
          } else {
            pins.push({ pkg: `unmapped:${json.name}`, version: json.version, source: `self:${relPath}` });
          }
        }

        // (2) Dep maps
        const depFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
        for (const field of depFields) {
          const map = json[field];
          if (!map || typeof map !== 'object') continue;
          for (const [depName, depVer] of Object.entries(map)) {
            if (typeof depVer !== 'string') continue;
            // Strip range prefix (^ ~ >= etc) so "3.0.0-patch.5" and "^3.0.0-patch.5"
            // both match. Use simple lstrip; semver ranges with -patch.N are rare.
            const cleanVer = depVer.replace(/^[\^~>=<v\s]+/, '');
            if (!PATCH_SUFFIX_RE.test(cleanVer)) continue;
            const canonical = normalizePkgName(depName, unscopedMap);
            if (canonical) {
              pins.push({ pkg: canonical, version: cleanVer, source: `dep:${relPath}:${field}.${depName}` });
            } else {
              pins.push({ pkg: `unmapped:${depName}`, version: cleanVer, source: `dep:${relPath}:${field}.${depName}` });
            }
          }
        }
      }
    } catch (err) {
      errors.push(`walk failed under ${forkDir}: ${err.message}`);
    }
  }

  return { pins, errors };
}

async function enumerateLastBuildState() {
  const pins = [];
  const errors = [];
  const stateFile = join(SCRIPT_DIR, '.last-build-state');
  if (!existsSync(stateFile)) {
    // Not fatal if missing — fresh repo. Note in errors as soft-warn? No;
    // missing-state is a legitimate state. Return empty pins.
    return { pins, errors };
  }
  let raw;
  try {
    raw = await readFile(stateFile, 'utf8');
  } catch (err) {
    errors.push(`read failed: ${stateFile}: ${err.message}`);
    return { pins, errors };
  }
  // Today this file holds only fork HEAD SHAs, not -patch.N refs.
  // Future-proof: if any line matches `<NAME>_VERSION=<scoped>@<version>`
  // pattern with -patch.N suffix, treat it as a pin.
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^[A-Z_]+_VERSION\s*=\s*(@[^@\s]+)@(\S+-patch\.\d+)$/);
    if (m) {
      pins.push({ pkg: m[1], version: m[2], source: `last-build-state:${trimmed.split('=')[0]}` });
    }
  }
  return { pins, errors };
}

async function enumerateAllPins() {
  const unscopedMap = await loadUnscopedMap();
  const [fork, state] = await Promise.all([
    enumerateForkPins(unscopedMap),
    enumerateLastBuildState(),
  ]);
  const allErrors = [...fork.errors, ...state.errors];
  if (allErrors.length > 0) {
    // ATOMIC CHECKPOINT — abort the whole GC. Never delete with partial enumeration.
    throw new Error(
      `pin-ref enumeration failed (${allErrors.length} error(s)) — aborting GC:\n` +
      allErrors.map((e) => `  - ${e}`).join('\n')
    );
  }
  // Dedup by pkg+version
  const set = new Map(); // key: `${pkg}@${version}` → first { pkg, version, source }
  for (const p of [...fork.pins, ...state.pins]) {
    const key = `${p.pkg}@${p.version}`;
    if (!set.has(key)) set.set(key, p);
  }
  return {
    pins: [...set.values()],
    sourceCounts: {
      forks_self: fork.pins.filter((p) => p.source.startsWith('self:')).length,
      forks_dep: fork.pins.filter((p) => p.source.startsWith('dep:')).length,
      last_build_state: state.pins.length,
      codemod_unscoped_map_size: Object.keys(unscopedMap).length,
      release_epoch: 'deferred to L3 — not consulted',
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Storage enumeration
// ──────────────────────────────────────────────────────────────────────────────

/** Semver-aware compare for `X.Y.Z[-pre]-patch.N` strings, newest first. */
function compareVersionsDesc(a, b) {
  // Split into [base, patchN]. Base is X.Y.Z[-pre]; patchN is integer after -patch.
  const parse = (v) => {
    const m = v.match(/^(.*)-patch\.(\d+)$/);
    if (!m) return { base: v, patch: -1 };
    return { base: m[1], patch: Number(m[2]) };
  };
  const pa = parse(a);
  const pb = parse(b);
  if (pa.base !== pb.base) {
    // Compare base parts numerically where possible (handles 3.5.51 vs 3.7.0)
    const partsA = pa.base.split(/[.-]/);
    const partsB = pb.base.split(/[.-]/);
    const len = Math.max(partsA.length, partsB.length);
    for (let i = 0; i < len; i++) {
      const xa = partsA[i] ?? '';
      const xb = partsB[i] ?? '';
      const na = Number(xa);
      const nb = Number(xb);
      if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return nb - na;
      if (xa !== xb) return xb.localeCompare(xa);
    }
  }
  return pb.patch - pa.patch;
}

async function enumeratePackageVersions(pkgDir) {
  // Read package.json metadata for the authoritative versions list + tarball
  // filenames. Fall back to globbing *.tgz if metadata is unreadable (so the
  // GC isn't paralyzed by a corrupt sidecar — but report it as an error).
  const metaPath = join(pkgDir, 'package.json');
  let versions = [];
  let metaErr = null;
  let meta = null;
  if (existsSync(metaPath)) {
    try {
      meta = JSON.parse(await readFile(metaPath, 'utf8'));
      versions = Object.keys(meta.versions || {});
    } catch (err) {
      metaErr = err.message;
    }
  }
  // Cross-check against tarball files on disk
  let entries = [];
  try {
    entries = await readdir(pkgDir, { withFileTypes: true });
  } catch (err) {
    return { versions: [], tarballs: new Map(), meta: null, metaErr: err.message };
  }
  const tarballs = new Map(); // version → { file, fullPath, size }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.tgz')) continue;
    // Filename format: <basename>-<version>.tgz where <basename> is the
    // unscoped package name (last segment of @scope/name).
    const m = entry.name.match(/^(.+?)-(\d.+?)\.tgz$/);
    if (!m) continue;
    const version = m[2];
    const fullPath = join(pkgDir, entry.name);
    let size = 0;
    try {
      const s = await stat(fullPath);
      size = s.size;
    } catch { /* ignore */ }
    tarballs.set(version, { file: entry.name, fullPath, size });
  }
  // Union: metadata versions + on-disk tarball versions
  const union = new Set([...versions, ...tarballs.keys()]);
  return { versions: [...union], tarballs, meta, metaErr };
}

async function enumerateStoragePackages() {
  const scopeDir = join(STORAGE_ROOT, SCOPE);
  if (!existsSync(scopeDir)) {
    throw new Error(`Verdaccio scope dir missing: ${scopeDir} (RUFLO_VERDACCIO_STORAGE override?)`);
  }
  const entries = await readdir(scopeDir, { withFileTypes: true });
  const packages = []; // { pkg: '@sparkleideas/xxx', dir, versions, tarballs, meta, metaErr }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgName = `${SCOPE}/${entry.name}`;
    const pkgDir = join(scopeDir, entry.name);
    const info = await enumeratePackageVersions(pkgDir);
    packages.push({ pkg: pkgName, dir: pkgDir, ...info });
  }
  return packages;
}

// ──────────────────────────────────────────────────────────────────────────────
// Policy + delete
// ──────────────────────────────────────────────────────────────────────────────

function classifyVersions(pkg, pinSet) {
  // Sort versions newest first
  const sorted = [...pkg.versions].sort(compareVersionsDesc);
  const keepByFloor = new Set(sorted.slice(0, KEEP_LAST));
  const keepByPin = new Set();
  const drop = [];
  const protectedByPin = []; // would have been dropped but pin protected them

  for (const v of sorted) {
    if (keepByFloor.has(v)) continue;
    const pinKey = `${pkg.pkg}@${v}`;
    if (pinSet.has(pinKey)) {
      keepByPin.add(v);
      protectedByPin.push(v);
    } else {
      drop.push(v);
    }
  }
  return {
    keepByFloor: [...keepByFloor],
    keepByPin: [...keepByPin],
    drop,
    protectedByPin,
  };
}

async function dropVersion(pkg, version) {
  let bytesFreed = 0;
  const tarball = pkg.tarballs.get(version);
  if (tarball) {
    try {
      bytesFreed += tarball.size;
      await unlink(tarball.fullPath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  // Update package.json metadata: remove from versions{}, time{}, dist-tags{}
  // (don't touch _attachments — Verdaccio reaps those itself; if it doesn't,
  // a future sweep can be added).
  if (pkg.meta && !pkg.metaErr) {
    if (pkg.meta.versions && pkg.meta.versions[version]) {
      delete pkg.meta.versions[version];
    }
    if (pkg.meta.time && pkg.meta.time[version]) {
      delete pkg.meta.time[version];
    }
    if (pkg.meta['dist-tags']) {
      for (const [tag, tagVersion] of Object.entries(pkg.meta['dist-tags'])) {
        if (tagVersion === version) {
          // Don't touch dist-tags pointing at the dropped version — that's
          // a sign someone tagged an old version. Refuse to drop in that case.
          // Reinstate the version: re-stat the tarball if still present, else
          // bail. Simplest safe behavior: keep the version (re-add it).
          // We handled this above by treating dist-tag targets as pinned
          // (see filterPinByDistTags). If we reach here, something's off —
          // log and skip the metadata mutation for this version.
          throw new Error(
            `refusing to drop ${pkg.pkg}@${version}: still referenced by dist-tag "${tag}"`
          );
        }
      }
    }
  }
  return bytesFreed;
}

async function writePackageMeta(pkg) {
  if (!pkg.meta || pkg.metaErr) return;
  const metaPath = join(pkg.dir, 'package.json');
  const tmp = `${metaPath}.gc-tmp`;
  await writeFile(tmp, JSON.stringify(pkg.meta, null, '\t'), 'utf8');
  // Atomic-ish replace
  const { rename } = await import('node:fs/promises');
  await rename(tmp, metaPath);
}

function collectDistTagPins(pkg) {
  // Any dist-tag target is implicitly pinned (latest, beta, etc.)
  const pins = [];
  const tags = pkg.meta?.['dist-tags'];
  if (!tags) return pins;
  for (const [tag, v] of Object.entries(tags)) {
    pins.push({ pkg: pkg.pkg, version: v, source: `dist-tag:${tag}` });
  }
  return pins;
}

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────

function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KiB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MiB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

async function appendJsonl(record) {
  try {
    await mkdir(LOGS_DIR, { recursive: true });
    await appendFile(LOG_JSONL, JSON.stringify(record) + '\n', 'utf8');
  } catch (err) {
    console.error(`[L8][warn] failed to append ${LOG_JSONL}: ${err.message}`);
  }
}

async function main() {
  const startedAt = new Date().toISOString();
  console.error(`[L8] verdaccio-gc start — storage=${STORAGE_ROOT} scope=${SCOPE} keep_last=${KEEP_LAST} dry_run=${DRY_RUN}`);

  // 1. Enumerate pins from all sources (atomic checkpoint).
  let pinReport;
  try {
    pinReport = await enumerateAllPins();
  } catch (err) {
    console.error(`[L8][fatal] ${err.message}`);
    process.exit(1);
  }
  const pinSet = new Set(pinReport.pins.map((p) => `${p.pkg}@${p.version}`));
  console.error(`[L8] enumerated ${pinReport.pins.length} pin-ref(s)`);
  console.error(`[L8]   forks self/version:    ${pinReport.sourceCounts.forks_self}`);
  console.error(`[L8]   forks dep-map:         ${pinReport.sourceCounts.forks_dep}`);
  console.error(`[L8]   last-build-state:      ${pinReport.sourceCounts.last_build_state}`);
  console.error(`[L8]   codemod UNSCOPED_MAP:  ${pinReport.sourceCounts.codemod_unscoped_map_size} names (used for normalization)`);
  console.error(`[L8]   .release-epoch:        ${pinReport.sourceCounts.release_epoch}`);

  if (PRINT_PINS) {
    console.error(`[L8] --print-pins — full pin set:`);
    const grouped = new Map();
    for (const p of pinReport.pins) {
      if (!grouped.has(p.pkg)) grouped.set(p.pkg, []);
      grouped.get(p.pkg).push(p);
    }
    for (const [pkg, ps] of [...grouped.entries()].sort()) {
      console.error(`  ${pkg}`);
      for (const p of ps.sort((a, b) => compareVersionsDesc(a.version, b.version))) {
        console.error(`    ${p.version}  ← ${p.source}`);
      }
    }
  }

  // 2. Enumerate storage.
  let storagePackages;
  try {
    storagePackages = await enumerateStoragePackages();
  } catch (err) {
    console.error(`[L8][fatal] storage enumeration failed: ${err.message}`);
    process.exit(1);
  }
  console.error(`[L8] storage: ${storagePackages.length} ${SCOPE}/* package(s)`);

  // 3. Add dist-tag pins per package (latest/beta/etc — never drop these).
  for (const pkg of storagePackages) {
    for (const dtPin of collectDistTagPins(pkg)) {
      pinSet.add(`${dtPin.pkg}@${dtPin.version}`);
    }
  }

  // 4. Classify + (optionally) drop.
  let totalDropped = 0;
  let totalProtected = 0;
  let totalKeptFloor = 0;
  let totalBytesFreed = 0;
  const perPkgSummary = [];

  for (const pkg of storagePackages) {
    const cls = classifyVersions(pkg, pinSet);
    totalKeptFloor += cls.keepByFloor.length;
    totalProtected += cls.keepByPin.length;
    totalDropped += cls.drop.length;
    let pkgBytes = 0;

    if (cls.drop.length > 0 && !DRY_RUN) {
      try {
        for (const v of cls.drop) {
          pkgBytes += await dropVersion(pkg, v);
        }
        await writePackageMeta(pkg);
      } catch (err) {
        console.error(`[L8][warn] ${pkg.pkg}: drop sequence failed mid-way — ${err.message}`);
      }
    } else if (cls.drop.length > 0 && DRY_RUN) {
      for (const v of cls.drop) {
        const t = pkg.tarballs.get(v);
        if (t) pkgBytes += t.size;
      }
    }
    totalBytesFreed += pkgBytes;

    if (cls.drop.length > 0 || cls.keepByPin.length > 0) {
      perPkgSummary.push({
        pkg: pkg.pkg,
        kept_floor: cls.keepByFloor.length,
        kept_pin: cls.keepByPin.length,
        dropped: cls.drop.length,
        bytes_freed: pkgBytes,
        metaErr: pkg.metaErr || null,
      });
    }
  }

  // 5. Report.
  const summary = {
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    dry_run: DRY_RUN,
    storage_root: STORAGE_ROOT,
    scope: SCOPE,
    keep_last: KEEP_LAST,
    pin_count: pinReport.pins.length,
    pin_source_counts: pinReport.sourceCounts,
    packages_total: storagePackages.length,
    versions_kept_floor: totalKeptFloor,
    versions_kept_pin: totalProtected,
    versions_dropped: totalDropped,
    bytes_freed: totalBytesFreed,
    bytes_freed_human: fmtBytes(totalBytesFreed),
    per_package: perPkgSummary.slice(0, 20),
    per_package_truncated: perPkgSummary.length > 20,
  };

  console.error(`[L8] ────────────────────────────────────────────────`);
  console.error(`[L8] SUMMARY  (${DRY_RUN ? 'DRY-RUN' : 'APPLIED'})`);
  console.error(`[L8]   packages scanned:    ${summary.packages_total}`);
  console.error(`[L8]   versions kept (floor): ${summary.versions_kept_floor}`);
  console.error(`[L8]   versions kept (pin):   ${summary.versions_kept_pin}`);
  console.error(`[L8]   versions dropped:    ${summary.versions_dropped}`);
  console.error(`[L8]   bytes ${DRY_RUN ? 'would free' : 'freed'}:    ${summary.bytes_freed_human}`);
  console.error(`[L8] ────────────────────────────────────────────────`);

  await appendJsonl(summary);
  process.exit(0);
}

main().catch((err) => {
  console.error(`[L8][fatal] uncaught: ${err.stack || err.message || err}`);
  process.exit(1);
});
