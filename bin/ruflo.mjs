#!/usr/bin/env node
// bin/ruflo.mjs — CLI entry point for @sparkleideas/ruflo
//
// Thin proxy: dynamic-imports @sparkleideas/cli's bin/cli.js in-process.
// Modeled on upstream's ruflo/bin/ruflo.js (ruvnet/ruflo). Modifications:
//   - @sparkleideas scope (vs upstream @claude-flow)
//   - NO dev-tree fallback — upstream's wrapper falls back to a
//     monorepo-relative dev path when the node_modules walk-up fails.
//     That fallback silently targets a non-existent directory in
//     published installs, violating memory `feedback-no-fallbacks.md`.
//     Instead, this wrapper fails loud with a reinstall hint when cli
//     is unreachable. Guard G2 (tests/unit/wrapper-no-fallback.test.mjs)
//     enforces the absence of any monorepo-relative dev path here.
//   - try/catch around the dynamic import so cli init errors produce a
//     clean exit code instead of an unhandled promise rejection.
//
// History: this file replaces an earlier npx-redirect approach (commit
// c76a727, 2026-03-06 — "Eliminate staleness: zero-dependency wrapper
// invokes CLI at runtime"). c76a727 fixed three bugs the redirect
// pattern was the wrong tool to fix:
//   1. npx cache staleness        — now mitigated by pipeline-bumped
//                                    wrapper versions in lockstep with cli
//   2. semver `*` range mismatch  — now mitigated by ADR-0027 exact
//                                    -patch.N pins (Guard G1 enforces)
//   3. ESM exports-map resolution — now mitigated by importing
//                                    @sparkleideas/cli/bin/cli.js by
//                                    file path, bypassing exports map
//
// Decision rationale + the four guards (G1 lockstep, G2 no-fallback,
// G3 bin-path, G4 this header) are documented in ADR-0142.

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Walk up from the wrapper's bin/ directory looking for an installed
 * @sparkleideas/cli with bin/cli.js. Returns the directory containing
 * node_modules/@sparkleideas/cli, or null if not found within 10 levels.
 */
function findCliPath() {
  let dir = resolve(__dirname, '..');
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'node_modules', '@sparkleideas', 'cli', 'bin', 'cli.js');
    if (existsSync(candidate)) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const pkgDir = findCliPath();

if (!pkgDir) {
  // FAIL LOUD per feedback-no-fallbacks.md — no dev-tree fallback in
  // the published wrapper. A walk-up miss means the install is broken,
  // not that we should silently target a path that may or may not exist.
  console.error('[ruflo] FATAL: cannot locate @sparkleideas/cli in node_modules.');
  console.error('[ruflo] Searched up from:', __dirname);
  console.error('[ruflo] Reinstall with: npm install -g @sparkleideas/ruflo@latest');
  console.error('[ruflo] Or via npx: npx --yes @sparkleideas/ruflo@latest <command>');
  process.exit(1);
}

const cliBin = join(pkgDir, 'node_modules', '@sparkleideas', 'cli', 'bin', 'cli.js');

try {
  await import(pathToFileURL(cliBin).href);
} catch (e) {
  console.error('[ruflo] FATAL: failed to import @sparkleideas/cli at', cliBin);
  console.error('[ruflo]', e?.stack ?? e?.message ?? String(e));
  process.exit(1);
}
