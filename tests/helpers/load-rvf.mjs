// @tier helper (used by integration-tier test files)
// Shared RVF backend resolver — ADR-0094 eleventh-pass-correction follow-up.
//
// Before this helper, each RVF-consumer test file duplicated its own resolver:
//   - adr0086-rvf-real-integration.test.mjs (A1's resolver, cache-first + install)
//   - adr0086-rvf-load-invariant.test.mjs   (A5's parity resolver)
//   - adr0090-a4-rvf-concurrent.integration.test.mjs (own resolver, @claude-flow
//     + fork-dist only — this is why skips #2/#3 persisted)
//   - adr0086-rvf-integration.test.mjs (per-test resolver)
//   - adr0090-b2-corruption.test.mjs  (per-test resolver)
//   - rvf-backend-wal.test.mjs        (per-test resolver)
//
// Consolidating here:
//   1. Eliminates the copy-paste drift that left `adr0090-a4-rvf-concurrent`
//      skipping when caches existed.
//   2. Gives every RVF consumer the same cache-first resolution order, so a
//      single npm publish primes every file on the next run.
//   3. Lets A7's skip-count guard stay tight — any new RVF consumer that uses
//      this helper automatically inherits the non-skip loading behavior.
//
// Resolution order (first hit wins, newest mtime breaks ties within a bucket):
//
//   (a) /tmp/ruflo-accept-*/node_modules/@sparkleideas/memory/dist/rvf-backend.js
//       Acceptance-suite installs; rotate by run.
//   (b) /tmp/ruflo-accept-npxcache/_npx/<hash>/node_modules/@sparkleideas/memory/...
//       npx cache inside acceptance tmp.
//   (c) $HOME/.npm/_npx/<hash>/node_modules/@sparkleideas/memory/...
//       User-level npx cache (persistent across acceptance runs).
//   (d) /tmp/ruflo-unit-rvf-install/node_modules/@sparkleideas/memory/...
//       Our own on-demand unit-tier install dir.
//   (e) $HOME/source/forks/ruflo/v3/@claude-flow/memory/dist/rvf-backend.js
//       Fork build output (pre-codemod @claude-flow scope). Only usable from
//       a dev box that has the fork checked out.
//   (f) Dynamic import of '@claude-flow/memory' package (resolves from
//       the test runner's node_modules if the fork is linked).
//   (g) On-demand `npm install --registry=http://localhost:4873 @sparkleideas/memory@latest`
//       into (d)'s prefix. Loud skip with a specific reason if Verdaccio is
//       unreachable (ADR-0082: skip reasons are narrow, not catch-all).
//
// Return shape:
//   { RvfBackend: class|null, path: string|null, source: string, error: string|null }
//
// `source` is one of:
//   'acceptance', 'npx-cache-tmp', 'npx-cache-home', 'unit-install',
//   'fork-dist', 'package-@claude-flow', 'verdaccio-fresh-install', 'none'

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const VERDACCIO_URL = 'http://localhost:4873';
const UNIT_INSTALL_DIR = '/tmp/ruflo-unit-rvf-install';
const UNIT_INSTALL_PATH = join(
  UNIT_INSTALL_DIR,
  'node_modules',
  '@sparkleideas',
  'memory',
  'dist',
  'rvf-backend.js',
);
const FORK_MEMORY_DIST = process.env.HOME
  ? join(process.env.HOME, 'source/forks/ruflo/v3/@claude-flow/memory/dist/rvf-backend.js')
  : null;

const ACCEPT_ROOTS = ['/tmp'];
const NPX_CACHE_ROOTS = [
  '/tmp/ruflo-accept-npxcache/_npx',
  process.env.HOME ? join(process.env.HOME, '.npm/_npx') : null,
].filter(Boolean);

// Narrow skip-reason regex — ADR-0082. Every not-found branch of this
// resolver emits a reason matching this pattern. Callers that gate on the
// resolver's `error` field can assert against this to verify no catch-all
// slipped in.
export const LOAD_RVF_SKIP_REASON_REGEX =
  /^(Verdaccio unreachable|no install dir available|on-demand install failed|export missing|import failed)/;

function _collectFromAcceptanceRoots(candidates) {
  for (const root of ACCEPT_ROOTS) {
    let entries;
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.startsWith('ruflo-accept-')) continue;
      const p = join(
        root,
        name,
        'node_modules',
        '@sparkleideas',
        'memory',
        'dist',
        'rvf-backend.js',
      );
      if (existsSync(p)) {
        try {
          candidates.push({ path: p, mtime: statSync(p).mtimeMs, source: 'acceptance' });
        } catch { /* unreadable — skip */ }
      }
    }
  }
}

function _collectFromNpxCaches(candidates) {
  for (const root of NPX_CACHE_ROOTS) {
    let hashDirs;
    try {
      hashDirs = readdirSync(root);
    } catch {
      continue;
    }
    const sourceTag = root.startsWith('/tmp/') ? 'npx-cache-tmp' : 'npx-cache-home';
    for (const hash of hashDirs) {
      const p = join(
        root,
        hash,
        'node_modules',
        '@sparkleideas',
        'memory',
        'dist',
        'rvf-backend.js',
      );
      if (existsSync(p)) {
        try {
          candidates.push({ path: p, mtime: statSync(p).mtimeMs, source: sourceTag });
        } catch { /* unreadable — skip */ }
      }
    }
  }
}

function _collectFromUnitInstall(candidates) {
  if (existsSync(UNIT_INSTALL_PATH)) {
    try {
      candidates.push({
        path: UNIT_INSTALL_PATH,
        mtime: statSync(UNIT_INSTALL_PATH).mtimeMs,
        source: 'unit-install',
      });
    } catch { /* unreadable — skip */ }
  }
}

function _collectFromForkDist(candidates) {
  if (FORK_MEMORY_DIST && existsSync(FORK_MEMORY_DIST)) {
    try {
      candidates.push({
        path: FORK_MEMORY_DIST,
        mtime: statSync(FORK_MEMORY_DIST).mtimeMs,
        source: 'fork-dist',
      });
    } catch { /* unreadable — skip */ }
  }
}

function _findCached() {
  const candidates = [];
  _collectFromAcceptanceRoots(candidates);
  _collectFromNpxCaches(candidates);
  _collectFromUnitInstall(candidates);
  _collectFromForkDist(candidates);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0];
}

function _verdaccioUp() {
  try {
    execSync(`curl -sf --max-time 3 ${VERDACCIO_URL}/-/ping`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function _installFromVerdaccio() {
  if (!_verdaccioUp()) {
    return { path: null, source: 'none', error: `Verdaccio unreachable at ${VERDACCIO_URL}` };
  }
  try {
    execSync(
      `npm install --prefix ${UNIT_INSTALL_DIR} --registry=${VERDACCIO_URL} --no-save --no-audit --no-fund @sparkleideas/memory@latest`,
      { stdio: 'ignore', timeout: 120_000 },
    );
  } catch (err) {
    return {
      path: null,
      source: 'none',
      error: `on-demand install failed: ${err?.message ?? String(err)}`,
    };
  }
  if (!existsSync(UNIT_INSTALL_PATH)) {
    return {
      path: null,
      source: 'none',
      error: `on-demand install failed: ${UNIT_INSTALL_PATH} missing after npm install`,
    };
  }
  return { path: UNIT_INSTALL_PATH, source: 'verdaccio-fresh-install', error: null };
}

/**
 * Resolve a loadable `RvfBackend` class, trying cached paths first and
 * falling back to an on-demand Verdaccio install only if nothing is cached.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.allowClaudeFlowPackage=true]
 *   If true, try `import('@claude-flow/memory')` after cache probes and
 *   before the Verdaccio fallback. Some consumer files live in a dev
 *   environment where the fork is npm-linked into the repo's node_modules;
 *   this path only succeeds there.
 * @param {boolean} [opts.allowOnDemandInstall=true]
 *   If true, run `npm install --registry=Verdaccio` when no cached copy is
 *   found. Set false for tests that explicitly want to verify "cache-only"
 *   behavior.
 * @returns {Promise<{ RvfBackend: Function|null, path: string|null, source: string, error: string|null }>}
 */
export async function loadRvfBackend(opts = {}) {
  const allowClaudeFlowPackage = opts.allowClaudeFlowPackage !== false;
  const allowOnDemandInstall = opts.allowOnDemandInstall !== false;

  // 1. Cached path (a..e).
  const cached = _findCached();
  if (cached) {
    try {
      const mod = await import(cached.path);
      if (mod?.RvfBackend) {
        return {
          RvfBackend: mod.RvfBackend,
          path: cached.path,
          source: cached.source,
          error: null,
        };
      }
      return {
        RvfBackend: null,
        path: cached.path,
        source: cached.source,
        error: `export missing from ${cached.path}`,
      };
    } catch (err) {
      // Fall through — try the next strategy.
      // Record the error so callers can see why the cache hit failed.
      var cachedImportError = `import failed for ${cached.path}: ${err?.message ?? String(err)}`;
    }
  }

  // 2. @claude-flow/memory package resolution (f).
  if (allowClaudeFlowPackage) {
    try {
      const mod = await import('@claude-flow/memory');
      if (mod?.RvfBackend) {
        return {
          RvfBackend: mod.RvfBackend,
          path: '@claude-flow/memory',
          source: 'package-@claude-flow',
          error: null,
        };
      }
    } catch {
      // Fall through. Not installed in this env — expected on most hosts.
    }
  }

  // 3. On-demand Verdaccio install (g).
  if (allowOnDemandInstall) {
    const installed = _installFromVerdaccio();
    if (installed.path) {
      try {
        const mod = await import(installed.path);
        if (mod?.RvfBackend) {
          return {
            RvfBackend: mod.RvfBackend,
            path: installed.path,
            source: installed.source,
            error: null,
          };
        }
        return {
          RvfBackend: null,
          path: installed.path,
          source: installed.source,
          error: `export missing from ${installed.path}`,
        };
      } catch (err) {
        return {
          RvfBackend: null,
          path: installed.path,
          source: installed.source,
          error: `import failed after install: ${err?.message ?? String(err)}`,
        };
      }
    }
    return {
      RvfBackend: null,
      path: null,
      source: 'none',
      error: installed.error,
    };
  }

  // 4. No cached path, caller disabled install fallback.
  return {
    RvfBackend: null,
    path: null,
    source: 'none',
    error: typeof cachedImportError === 'string'
      ? cachedImportError
      : 'no install dir available (on-demand install disabled by caller)',
  };
}
