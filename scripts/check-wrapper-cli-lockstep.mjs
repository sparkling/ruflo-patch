#!/usr/bin/env node
/**
 * scripts/check-wrapper-cli-lockstep.mjs — ADR-0142 Guard G1
 *
 * Verifies the published wrapper (@sparkleideas/ruflo) pins an
 * @sparkleideas/cli version that is in lockstep with what's published
 * on Verdaccio. Three modes:
 *
 *   1. No pin yet (wrapper has no @sparkleideas/cli dep):
 *      → exit 0, log Phase 1 transitional state. Allows Phase 1 commits
 *        to land before Phase 2 (commit 4) adds the dependency.
 *
 *   2. --check-registry (strict, used by publish-verdaccio.sh inline):
 *      → query Verdaccio for @sparkleideas/cli@latest, assert pin matches.
 *      → loud diff + exit 1 on mismatch.
 *
 *   3. Default (no flag, used by prepublishOnly defence-in-depth):
 *      → assert pin is a well-formed exact -patch.N version (no `*`/`^`/`~`)
 *      → exit 0 if shape OK, exit 1 with reason if malformed.
 *
 * Why two modes: --check-registry needs Verdaccio reachability and is
 * appropriate inside the pipeline (where Verdaccio is by definition up).
 * The default mode runs inside `npm run test:unit` (via prepublishOnly)
 * and must not depend on a running registry.
 *
 * Usage:
 *   node scripts/check-wrapper-cli-lockstep.mjs                                # default mode
 *   node scripts/check-wrapper-cli-lockstep.mjs --check-registry               # strict (needs Verdaccio)
 *   node scripts/check-wrapper-cli-lockstep.mjs --check-registry --registry http://localhost:4873
 */

import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, '..');
const PKG_PATH = resolve(PROJECT_DIR, 'package.json');

// Exact -patch.N shape. No ^/~/*/x/X allowed.
const EXACT_PIN_RE = /^\d+\.\d+\.\d+(?:-[a-z0-9.]+)?-patch\.\d+$/;

function log(msg) { console.log(`[lockstep] ${msg}`); }
function logError(msg) { console.error(`[lockstep] ERROR: ${msg}`); }

/**
 * Parse CLI args into { checkRegistry, registry }.
 * Exported for tests.
 */
export function parseArgs(argv) {
  const checkRegistry = argv.includes('--check-registry');
  const regIdx = argv.indexOf('--registry');
  const registry = regIdx !== -1 && argv[regIdx + 1]
    ? argv[regIdx + 1]
    : 'http://localhost:4873';
  return { checkRegistry, registry };
}

/**
 * Read the wrapper's pinned @sparkleideas/cli version, or null if no pin.
 * Exported for tests.
 */
export async function readWrapperPin(pkgPath = PKG_PATH) {
  const raw = await readFile(pkgPath, 'utf8');
  const pkg = JSON.parse(raw);
  return pkg.dependencies?.['@sparkleideas/cli'] ?? null;
}

/**
 * Validate the pin string against EXACT_PIN_RE.
 * Returns { ok: boolean, reason?: string }.
 * Exported for tests.
 */
export function validatePinShape(pin) {
  if (typeof pin !== 'string' || pin.length === 0) {
    return { ok: false, reason: 'pin is empty or non-string' };
  }
  if (pin.startsWith('^') || pin.startsWith('~')) {
    return { ok: false, reason: `pin starts with '${pin[0]}' — must be exact (no ranges)` };
  }
  if (pin === '*' || pin.includes('x') || pin.includes('X')) {
    return { ok: false, reason: `pin contains wildcard ('${pin}') — must be exact -patch.N (ADR-0027)` };
  }
  if (!EXACT_PIN_RE.test(pin)) {
    return { ok: false, reason: `pin '${pin}' does not match exact -patch.N shape (e.g. 3.5.58-patch.342)` };
  }
  return { ok: true };
}

/**
 * Query a registry for @sparkleideas/cli@latest version.
 * Returns the version string. Throws on registry failure.
 * Exported for tests (mockable).
 */
export async function queryRegistryLatest(registry) {
  const { stdout } = await execFileAsync(
    'npm',
    ['view', '@sparkleideas/cli@latest', 'version', '--registry', registry],
    { encoding: 'utf8' },
  );
  return stdout.trim();
}

/**
 * Main entry. Returns exit code (0 success, 1 failure).
 * Exported for tests.
 */
export async function main(argv = process.argv.slice(2), pkgPath = PKG_PATH) {
  const { checkRegistry, registry } = parseArgs(argv);

  const pin = await readWrapperPin(pkgPath);

  // Mode 1: no pin — Phase 1 transitional state
  if (pin === null) {
    log('wrapper has no @sparkleideas/cli pin yet; skipping (Phase 1 transitional state)');
    return 0;
  }

  // Default mode: shape validation only
  const shape = validatePinShape(pin);
  if (!shape.ok) {
    logError(`malformed pin: ${shape.reason}`);
    logError(`  read from: ${pkgPath}`);
    logError(`  pin value: ${pin}`);
    return 1;
  }
  log(`pin shape OK: @sparkleideas/cli = ${pin}`);

  if (!checkRegistry) {
    return 0;
  }

  // Strict mode: registry comparison
  let registryVersion;
  try {
    registryVersion = await queryRegistryLatest(registry);
  } catch (e) {
    logError(`failed to query ${registry} for @sparkleideas/cli@latest: ${e?.message ?? e}`);
    return 1;
  }

  if (pin !== registryVersion) {
    logError('LOCKSTEP MISMATCH — refusing to publish stale wrapper');
    logError(`  wrapper pins:        ${pin}`);
    logError(`  registry @latest is: ${registryVersion}`);
    logError(`  registry: ${registry}`);
    logError('  fix: re-run npm run release so fork-version.mjs bumps the wrapper pin');
    return 1;
  }

  log(`lockstep OK: pin == registry @latest (${pin})`);
  return 0;
}

// Run when invoked directly (not when imported by tests)
const isMainModule = process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const code = await main();
  process.exit(code);
}
