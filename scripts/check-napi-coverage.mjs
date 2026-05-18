#!/usr/bin/env node
// scripts/check-napi-coverage.mjs — ADR-0189 fail-loud NAPI coverage gate.
//
// Walks every Cargo.toml under each fork in config/upstream-branches.json,
// flags crates that depend on `napi-derive` (i.e. emit a .node binary), and
// cross-checks them against the allowlist in lib/napi-config.sh
// (NAPI_PACKAGES). Any consumer crate missing from the allowlist is a silent
// drop hazard per ADR-0082 — the build won't ship its .node binary and only
// surfaces as a runtime "module not found" downstream.
//
// Exit codes:
//   0  — all NAPI-consumer crates appear in NAPI_PACKAGES (clean)
//   1  — at least one unlisted NAPI-consumer crate found, OR config error
//
// No external deps; uses Node 20+ fs/path only. No real TOML parser — regex
// is sufficient for the section-detection we need (and dodges adding a
// runtime dep to the pipeline).

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_DIR = resolve(__dirname, '..');
const NAPI_CONFIG = join(PROJECT_DIR, 'lib', 'napi-config.sh');
const UPSTREAM_JSON = join(PROJECT_DIR, 'config', 'upstream-branches.json');

// ─── Parse NAPI_PACKAGES allowlist ────────────────────────────────────────
//
// lib/napi-config.sh format:
//   NAPI_PACKAGES=(
//     "FORK_DIR_RUVECTOR:crates/ruvector-graph-node:npm/packages/graph-node"
//     ...
//   )
// We extract <crate_path> (middle field) per fork, keyed by FORK_DIR_* var.
function loadAllowlist() {
  if (!existsSync(NAPI_CONFIG)) {
    console.error(`[NAPI-COVERAGE] FATAL: ${NAPI_CONFIG} not found`);
    process.exit(1);
  }
  const src = readFileSync(NAPI_CONFIG, 'utf8');
  const m = src.match(/NAPI_PACKAGES=\(([\s\S]*?)\n\)/);
  if (!m) {
    console.error(`[NAPI-COVERAGE] FATAL: NAPI_PACKAGES=( ... ) array not found in ${NAPI_CONFIG}`);
    process.exit(1);
  }
  const body = m[1];
  // Each entry is a quoted "<fork_var>:<crate>:<dest>" string.
  const entryRe = /"([^"]+)"/g;
  // Map: forkVar → Set<normalized crate paths>
  const allowed = new Map();
  let match;
  while ((match = entryRe.exec(body)) !== null) {
    const parts = match[1].split(':');
    if (parts.length !== 3) continue;
    const [forkVar, cratePath] = parts;
    if (!allowed.has(forkVar)) allowed.set(forkVar, new Set());
    allowed.get(forkVar).add(cratePath.replace(/\\/g, '/'));
  }
  return allowed;
}

// ─── Map fork names to FORK_DIR_* vars (mirrors lib/fork-paths.sh) ────────
const FORK_VAR = {
  'ruflo': 'FORK_DIR_RUFLO',
  'agentic-flow': 'FORK_DIR_AGENTIC',
  'ruv-FANN': 'FORK_DIR_FANN',
  'ruvector': 'FORK_DIR_RUVECTOR',
  'agentdb': 'FORK_DIR_AGENTDB',
};

function loadForks() {
  if (!existsSync(UPSTREAM_JSON)) {
    console.error(`[NAPI-COVERAGE] FATAL: ${UPSTREAM_JSON} not found`);
    process.exit(1);
  }
  const cfg = JSON.parse(readFileSync(UPSTREAM_JSON, 'utf8'));
  const forks = [];
  for (const [name, entry] of Object.entries(cfg)) {
    const forkVar = FORK_VAR[name];
    if (!forkVar) continue;
    forks.push({ name, dir: entry.dir, forkVar });
  }
  return forks;
}

// ─── Recursive Cargo.toml walker ──────────────────────────────────────────
// Skip target/, node_modules/, .git/ — pure waste, can be huge.
const SKIP_DIRS = new Set(['target', 'node_modules', '.git', 'dist', 'build', '.next']);

function* walkCargoTomls(rootDir) {
  if (!existsSync(rootDir)) return;
  const stack = [rootDir];
  while (stack.length > 0) {
    const cur = stack.pop();
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(cur, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        if (e.name.startsWith('.')) continue;
        stack.push(full);
      } else if (e.isFile() && e.name === 'Cargo.toml') {
        yield full;
      }
    }
  }
}

// ─── NAPI-consumer detection ──────────────────────────────────────────────
//
// A crate is a NAPI consumer if `napi-derive` appears as a runtime dependency
// (in any `[dependencies]`, `[build-dependencies]`, or `[target.*.dependencies]`
// table). The workspace root's `[workspace.dependencies]` only DEFINES the
// version — it doesn't make the workspace itself a consumer — so we exclude
// `[workspace.dependencies]` / `[workspace.build-dependencies]` from the check.
function isNapiConsumer(cargoTomlPath) {
  let src;
  try {
    src = readFileSync(cargoTomlPath, 'utf8');
  } catch {
    return false;
  }

  // Split into sections by [section.name] headers, preserving the header for each block.
  const sections = [];
  const lines = src.split('\n');
  let currentHeader = '';
  let currentBody = [];
  for (const line of lines) {
    const headerMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (headerMatch) {
      if (currentHeader || currentBody.length > 0) {
        sections.push({ header: currentHeader, body: currentBody.join('\n') });
      }
      currentHeader = headerMatch[1].trim();
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }
  sections.push({ header: currentHeader, body: currentBody.join('\n') });

  for (const { header, body } of sections) {
    // Skip workspace-level dep declarations (just version pins, not consumers).
    if (header.startsWith('workspace.')) continue;
    // Match dependency tables: [dependencies], [build-dependencies],
    // [target.'cfg(...)'.dependencies], [target.'cfg(...)'.build-dependencies],
    // [dependencies.napi-derive], [build-dependencies.napi-build].
    const isDepTable =
      header === 'dependencies' ||
      header === 'build-dependencies' ||
      header === 'dev-dependencies' ||
      /^target\.[^.]+\.(build-)?dependencies$/.test(header) ||
      /^target\.'.+'\.(build-)?dependencies$/.test(header) ||
      /^target\.".+"\.(build-)?dependencies$/.test(header);
    const isNapiDepSubtable =
      /^(dependencies|build-dependencies)\.napi-derive$/.test(header) ||
      /^(dependencies|build-dependencies)\.napi-build$/.test(header);

    if (isNapiDepSubtable) return true;
    if (!isDepTable) continue;

    // dev-dependencies on napi-derive doesn't mean it ships .node binaries,
    // but it's vanishingly rare and worth flagging anyway. Stay strict.
    if (/^\s*napi-derive\s*=/m.test(body)) return true;
    if (/^\s*napi-build\s*=/m.test(body)) return true;
  }

  return false;
}

// ─── Path 2 coverage: republish via codemod rename ─────────────────────────
//
// A crate is covered by the republish path if it has its own `package.json`
// AND ships pre-built `.node` binaries in `npm/<platform>/` subdirs. Our
// pipeline `copy-source.sh` + `scripts/codemod.mjs` rename `@ruvector/*` →
// `@sparkleideas/ruvector-*` in every package.json and `publish-verdaccio.sh`
// ships them. So a republish-eligible crate doesn't need to be in
// `NAPI_PACKAGES` (the build-from-source allowlist) — it's already covered.
function isCoveredByRepublish(crateDir) {
  if (!existsSync(join(crateDir, 'package.json'))) return false;
  const npmDir = join(crateDir, 'npm');
  if (!existsSync(npmDir)) return false;
  let platforms;
  try {
    platforms = readdirSync(npmDir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const p of platforms) {
    if (!p.isDirectory()) continue;
    let files;
    try {
      files = readdirSync(join(npmDir, p.name));
    } catch {
      continue;
    }
    if (files.some(f => f.endsWith('.node'))) return true;
  }
  return false;
}

// ─── Main ─────────────────────────────────────────────────────────────────
function main() {
  const allowed = loadAllowlist();
  const forks = loadForks();

  const consumers = []; // { forkName, forkVar, forkDir, relCratePath, cargoToml }
  for (const fork of forks) {
    if (!existsSync(fork.dir)) {
      console.error(`[NAPI-COVERAGE] WARN: fork dir missing: ${fork.dir} (${fork.name}) — skipping`);
      continue;
    }
    for (const cargoToml of walkCargoTomls(fork.dir)) {
      if (!isNapiConsumer(cargoToml)) continue;
      // Crate dir = parent of Cargo.toml, relative to fork root, with forward slashes.
      const crateDir = dirname(cargoToml);
      const relCratePath = relative(fork.dir, crateDir).replace(/\\/g, '/');
      // Skip the fork root itself (workspace-only Cargo.toml — covered by the
      // workspace.dependencies filter, but defensive double-check).
      if (relCratePath === '' || relCratePath === '.') continue;
      consumers.push({
        forkName: fork.name,
        forkVar: fork.forkVar,
        forkDir: fork.dir,
        relCratePath,
        cargoToml,
        crateDir,
      });
    }
  }

  // Cross-check against both publish paths.
  const unlisted = [];
  for (const c of consumers) {
    // Path 1: explicit NAPI_PACKAGES allowlist (build-from-source).
    const allowedForFork = allowed.get(c.forkVar) || new Set();
    if (allowedForFork.has(c.relCratePath)) continue;

    // No package.json → Rust-only library (workspace member, internal dep).
    // Not an npm consumer; cannot be silently-dropped at publish time
    // because it never had a publish path to begin with.
    if (!existsSync(join(c.crateDir, 'package.json'))) continue;

    // Path 2: republish via codemod rename. Crate has package.json AND
    // pre-built `.node` binaries in `npm/<platform>/` — codemod renames
    // `@ruvector/*` → `@sparkleideas/ruvector-*` and `publish-verdaccio.sh`
    // ships them. No build-from-source needed.
    if (isCoveredByRepublish(c.crateDir)) continue;

    unlisted.push(c);
  }

  if (unlisted.length > 0) {
    console.error('');
    console.error(`[NAPI-COVERAGE] Found ${unlisted.length} unlisted NAPI consumer crate(s):`);
    for (const u of unlisted) {
      console.error(`[NAPI-COVERAGE] Unlisted NAPI crate found: forks/${u.forkName}/${u.relCratePath}`);
    }
    console.error('');
    console.error('[NAPI-COVERAGE] These crates declare a dependency on `napi-derive` but are not');
    console.error('[NAPI-COVERAGE] in lib/napi-config.sh NAPI_PACKAGES. The pipeline will NOT build');
    console.error('[NAPI-COVERAGE] or ship their .node binaries — a silent-drop hazard (ADR-0082).');
    console.error('');
    console.error('[NAPI-COVERAGE] Either:');
    console.error('[NAPI-COVERAGE]   1. Add the crate to NAPI_PACKAGES with its <fork_var>:<crate>:<dest> entry, or');
    console.error('[NAPI-COVERAGE]   2. Document why it is excluded (Rust-only lib, example, WASM-only, etc.)');
    console.error('[NAPI-COVERAGE]      and update this script / ADR-0189 with the exclusion rationale.');
    process.exit(1);
  }

  console.log(`[NAPI-COVERAGE] OK: ${consumers.length} NAPI crates, all listed in NAPI_PACKAGES`);
  process.exit(0);
}

main();
