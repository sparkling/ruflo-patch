#!/usr/bin/env node
// scripts/sanitize-internal-optional-deps.mjs
//
// Strip unresolvable @sparkleideas/* optionalDependencies from publishable
// manifests before publish; fail loud on an unresolvable @sparkleideas/* HARD
// dependency (a real publish gap, not a dangling optional).
//
// ── Why this exists (root cause, 2026-06-06) ──────────────────────────────
// The codemod rewrites @ruvector/* → @sparkleideas/ruvector-* in every dep
// field, INCLUDING (a) napi platform sub-packages (ruvector-attention-darwin-
// arm64, -win32-x64-msvc, …) which ADR-0071 deliberately ELIMINATED by
// bundling the .node into the parent tarball, and (b) pure sub-packages
// (ruvector-rvf-solver, -rvf-wasm, -diskann) we do not publish. The rewritten
// @sparkleideas/* names 404 — we never publish them.
//
// Those dangling optionals were harmless ONLY while EVERY such optional 404'd:
// npm skips a lone unresolvable optional. The moment one peer optional became
// resolvable (ADR-0294 R3 published @sparkleideas/ruvector-rabitq-wasm on
// 2026-06-04), npm placed it, ran arborist `pruneDedupable`, and walked into
// the empty-version placeholder nodes left by the 404'd platform optionals →
// `new SemVer('')` → `TypeError: Invalid Version` → the ENTIRE `npm install`
// aborts. Downstream: `npx @sparkleideas/ruflo@latest mcp start` can't install
// → Claude Code reports `Failed to reconnect to ruflo: -32000`.
//
// Fix (this script): the published invariant is "a manifest must not reference
// an @sparkleideas/* package that does not resolve." Enforce it at the last
// transform before publish. Stripping an unresolvable OPTIONAL ref is provably
// zero-runtime-impact: it 404s today (never installs) and "optional" means the
// runtime already tolerates its absence. An unresolvable HARD ref is a real
// gap (the package should be published) — fail loud per feedback-no-fallbacks.
//
// ── Modes ─────────────────────────────────────────────────────────────────
//   fix   <buildDir>          (default) strip unresolvable optionals in the
//                             build tree's publishable manifests; exit 1 if any
//                             unresolvable HARD dep is found.
//   check-published <ref>     walk the published dependency graph from <ref>
//                             (e.g. @sparkleideas/ruflo@latest) and exit 1 if
//                             any manifest references an unresolvable
//                             @sparkleideas/* optional. Read-only regression gate.
//
// Resolvable ⇔ name is in the publish set (fix mode: buildPackageMap names) OR
// the registry returns anything other than a definitive 404. A network/5xx is
// treated as "unknown → do NOT strip" so a transient blip never drops a real dep.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPackageMap } from './publish.mjs';

const INTERNAL_PREFIX = '@sparkleideas/';
const DEFAULT_REGISTRY = process.env.RUFLO_REGISTRY || 'http://localhost:4873';

function encodeName(name) {
  return name.replace('/', '%2f');
}

// Returns the HTTP status for the package root, or 0 on network error.
// Cached per process run.
async function registryStatus(registry, name, cache) {
  if (cache.has(name)) return cache.get(name);
  let status = 0;
  try {
    const res = await fetch(`${registry}/${encodeName(name)}`, { method: 'GET' });
    status = res.status;
  } catch {
    status = 0; // network error — unknown, not a definitive 404
  }
  cache.set(name, status);
  return status;
}

// Resolvable unless we have POSITIVE evidence of non-existence (a clean 404).
async function isResolvable(name, { publishSet, registry, cache }) {
  if (publishSet && publishSet.has(name)) return true;
  const status = await registryStatus(registry, name, cache);
  return status !== 404;
}

async function runFix(buildDir, registry) {
  const map = buildPackageMap(buildDir); // Map<name, dir>
  const publishSet = new Set(map.keys());
  const cache = new Map();
  const ctx = { publishSet, registry, cache };

  const stripped = []; // { pkg, dep }
  const hardGaps = []; // { pkg, dep }

  for (const [name, dir] of map) {
    const pkgPath = join(dir, 'package.json');
    let json;
    try {
      json = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    } catch {
      continue; // unreadable/malformed — publish.mjs handles those separately
    }
    let changed = false;

    for (const field of ['optionalDependencies', 'dependencies']) {
      const deps = json[field];
      if (!deps || typeof deps !== 'object') continue;
      for (const dep of Object.keys(deps)) {
        if (!dep.startsWith(INTERNAL_PREFIX)) continue;
        if (await isResolvable(dep, ctx)) continue;
        if (field === 'optionalDependencies') {
          delete deps[dep];
          changed = true;
          stripped.push({ pkg: name, dep });
        } else {
          hardGaps.push({ pkg: name, dep });
        }
      }
      if (Object.keys(deps).length === 0) {
        delete json[field];
        changed = true;
      }
    }

    if (changed) {
      writeFileSync(pkgPath, JSON.stringify(json, null, 2) + '\n');
    }
  }

  // Fail loud on real (hard-dependency) gaps — never mask these.
  if (hardGaps.length > 0) {
    console.error(
      `[sanitize-deps] FATAL: ${hardGaps.length} unresolvable @sparkleideas/* HARD ` +
      `dependenc${hardGaps.length === 1 ? 'y' : 'ies'} (publish gap — publish the ` +
      `package or correct the ref; do NOT strip a hard dep):`
    );
    for (const g of hardGaps) console.error(`  ${g.pkg}  →  ${g.dep}`);
    process.exit(1);
  }

  if (stripped.length === 0) {
    console.log('[sanitize-deps] PASS — no unresolvable @sparkleideas/* optional deps');
  } else {
    // Group by package for a readable, greppable summary.
    const byPkg = new Map();
    for (const s of stripped) {
      if (!byPkg.has(s.pkg)) byPkg.set(s.pkg, []);
      byPkg.get(s.pkg).push(s.dep);
    }
    console.log(
      `[sanitize-deps] stripped ${stripped.length} unresolvable @sparkleideas/* ` +
      `optional dep(s) from ${byPkg.size} package(s):`
    );
    for (const [pkg, deps] of byPkg) {
      console.log(`  ${pkg}:`);
      for (const d of deps) console.log(`    - ${d}`);
    }
  }
}

async function runCheckPublished(rootRef, registry) {
  const cache = new Map();
  const ctx = { publishSet: null, registry, cache };
  const manifestCache = new Map();

  async function manifest(name, spec) {
    const key = `${name}@${spec}`;
    if (manifestCache.has(key)) return manifestCache.get(key);
    let m = null;
    try {
      const res = await fetch(`${registry}/${encodeName(name)}`, { method: 'GET' });
      if (res.ok) {
        const pack = await res.json();
        let version = spec;
        if (pack['dist-tags'] && pack['dist-tags'][spec]) version = pack['dist-tags'][spec];
        m = (pack.versions && pack.versions[version]) || null;
      }
    } catch {
      m = null;
    }
    manifestCache.set(key, m);
    return m;
  }

  // Parse "@scope/name@spec" → { name, spec }
  function parseRef(ref) {
    const at = ref.lastIndexOf('@');
    if (at <= 0) return { name: ref, spec: 'latest' };
    return { name: ref.slice(0, at), spec: ref.slice(at + 1) };
  }

  const violations = []; // { pkg, dep }
  const visited = new Set();
  const queue = [parseRef(rootRef)];

  while (queue.length > 0) {
    const { name, spec } = queue.shift();
    const visitKey = `${name}@${spec}`;
    if (visited.has(visitKey)) continue;
    visited.add(visitKey);

    const m = await manifest(name, spec);
    if (!m) continue;

    for (const field of ['optionalDependencies', 'dependencies']) {
      const deps = m[field] || {};
      for (const [dep, depSpec] of Object.entries(deps)) {
        if (!dep.startsWith(INTERNAL_PREFIX)) continue;
        const resolvable = await isResolvable(dep, ctx);
        if (!resolvable) {
          if (field === 'optionalDependencies') violations.push({ pkg: `${name}@${m.version}`, dep });
          // hard-dep gaps would already break install; surface them too
          else violations.push({ pkg: `${name}@${m.version}`, dep, hard: true });
          continue; // don't recurse into an unresolvable node
        }
        // recurse into resolvable internal deps
        if (!visited.has(`${dep}@${depSpec}`)) queue.push({ name: dep, spec: depSpec });
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      `[sanitize-deps:check] FAIL — ${violations.length} unresolvable @sparkleideas/* ` +
      `ref(s) in the published graph rooted at ${rootRef}:`
    );
    for (const v of violations) {
      console.error(`  ${v.pkg}  →  ${v.dep}${v.hard ? '  [HARD DEP]' : '  [optional]'}`);
    }
    process.exit(1);
  }
  console.log(`[sanitize-deps:check] PASS — ${rootRef} graph has no unresolvable @sparkleideas/* refs`);
}

async function main() {
  const argv = process.argv.slice(2);
  let mode = 'fix';
  let registry = DEFAULT_REGISTRY;
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode') mode = argv[++i];
    else if (a === '--registry') registry = argv[++i];
    else if (a === 'fix' || a === 'check-published') mode = a;
    else positional.push(a);
  }

  if (mode === 'fix') {
    const buildDir = positional[0] || '/tmp/ruflo-build';
    await runFix(buildDir, registry);
  } else if (mode === 'check-published') {
    const rootRef = positional[0] || '@sparkleideas/ruflo@latest';
    await runCheckPublished(rootRef, registry);
  } else {
    console.error(`[sanitize-deps] unknown mode: ${mode}`);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('[sanitize-deps] error:', err);
  process.exit(1);
});
