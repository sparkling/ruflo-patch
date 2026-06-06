#!/usr/bin/env node
// scripts/lint-scope-registries.mjs — ADR-0236 (CT-C close-out)
//
// Pipeline-start cross-registry lint. Reads 5 hand-aligned scope/package
// registries scattered across the publish pipeline and asserts pairwise
// consistency. Fail-loud on any drift, with both registries cited.
//
// Registries cross-checked:
//   1. scripts/fork-version.mjs::SCOPES          (exported set of valid scope prefixes)
//   2. scripts/fork-version.mjs::UNSCOPED_PUBLISHABLE  (exported set of unscoped names)
//   3. scripts/codemod.mjs::UNSCOPED_MAP                (exported name→@sparkleideas/* map)
//   4. scripts/build-packages.sh::_v3_packages   (bash assoc-array literal at :187-191)
//   5. scripts/build-packages.sh::v3set inline    (inline JS Set at :200-205)
//   6. config/publish-levels.json::levels[*].packages (existing v3-source-of-truth)
//
// Pairwise checks (per ADR-0236 §Sites table + swarm-review R1):
//   A. Every UNSCOPED_MAP key NOT classified as a platform-binary MUST be
//      in UNSCOPED_PUBLISHABLE. Catches today's agentic-jujutsu drift.
//   B. Every UNSCOPED_PUBLISHABLE entry MUST be in UNSCOPED_MAP (reverse).
//   C. SCOPES non-empty + every entry ends in '/' (structural invariant).
//   D. _v3_packages bash literal MUST equal v3set inline JS (intra-file).
//   E. Every _v3_packages entry MUST appear in publish-levels.json (drift).
//
// Error message contract (swarm-review R5):
//   Every fail-loud message cites (a) offending registry file:line + symbol,
//   (b) registry it should agree with (file:line + symbol), (c) suggested
//   fix, (d) corpus rule citation.
//
// Exits 0 on full pass, 1 on any drift.
//
// Usage:
//   node scripts/lint-scope-registries.mjs
//
// Invoked from scripts/ruflo-publish.sh as gate-0 (first executable line
// after `set -euo pipefail` + `lib/*` sourcing).

import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

// Platform-binary names embedded in UNSCOPED_MAP that are NOT in
// UNSCOPED_PUBLISHABLE by design — they ship via the NAPI/wasm-pack
// platform-publish workflow (preflight-discover.mjs's
// WONT_PUBLISH_PATTERNS captures the same set with a regex). Listing
// the matching set here keeps check-A's "every UNSCOPED_MAP entry must
// be publishable" semantics tight without false-positives. Kept in sync
// with preflight-discover.mjs::WONT_PUBLISH_PATTERNS by design — both
// are explicit allow-lists for upstream-tooling-generated unscoped
// names that ship via separate workflows (NAPI/wasm-pack), not via
// fork-version's `-patch.N` bookkeeping.
const PLATFORM_BINARY_NAMES = new Set([
  'ruvector-core-darwin-arm64',
  'ruvector-core-darwin-x64',
  'ruvector-core-linux-x64-gnu',
  'ruvector-core-linux-arm64-gnu',
  'ruvector-core-win32-x64-msvc',
  'ruvector-attention-wasm',
  'ruvector-attention-unified-wasm',
  'ruvllm-wasm', // wasm-pack output; published as @sparkleideas/ruvector-ruvllm-wasm
  'ruvector-rabitq-wasm', // ADR-0294 R3: wasm-pack output; published as @sparkleideas/ruvector-rabitq-wasm (same exemption as ruvllm-wasm — ships via the wasm-pack workflow, not fork-version's -patch.N bookkeeping)
  // ADR-0265 Phase 2 — agentic-flow-quic-node per-platform binaries shipped via
  // napi-rs prepublish. Parent `agentic-flow-quic-native` IS in UNSCOPED_PUBLISHABLE.
  // darwin-arm64 (Phase 2a, shipped) is ALSO in UNSCOPED_PUBLISHABLE for lockstep
  // version bumping with the parent's optionalDependencies pin. The remaining 4
  // platforms stay here (lint allow-list) until Phase 2b cross-compile CI matrix
  // lands them.
]);

// ── parseRegistry: single helper for all 5 registries ─────────────────
//
// Returns { value, file, line } where value is a Set<string> for set-shaped
// registries or an Array<string> for ordered registries; file and line
// pinpoint the symbol's declaration in source for error messages.
//
// Discriminates by the symbol name. Reads source files lazily; never
// imports them (would couple the lint to runtime side-effects). Bash
// literals and inline JS Sets get regex parsers; the .mjs registries get
// dynamic ESM import for correctness.

const FILES = {
  forkVersion: resolve(ROOT, 'scripts', 'fork-version.mjs'),
  codemod: resolve(ROOT, 'scripts', 'codemod.mjs'),
  buildPackages: resolve(ROOT, 'scripts', 'build-packages.sh'),
  publishLevels: resolve(ROOT, 'config', 'publish-levels.json'),
};

/**
 * Parse one of the 5 cross-registry sources.
 *
 * @param {keyof typeof FILES} file
 * @param {'SCOPES'|'UNSCOPED_PUBLISHABLE'|'UNSCOPED_MAP'|'_v3_packages'|'v3set_inline'|'publish_levels_v3'} symbol
 * @returns {Promise<{ value: Set<string>|Array<string>|Object, file: string, line: number, symbol: string }>}
 */
export async function parseRegistry(file, symbol) {
  if (file === 'forkVersion' && (symbol === 'SCOPES' || symbol === 'UNSCOPED_PUBLISHABLE')) {
    const mod = await import(FILES.forkVersion);
    const value = mod[symbol];
    if (value === undefined) {
      throw new Error(`parseRegistry: ${symbol} not exported from ${FILES.forkVersion}`);
    }
    const line = findLineForSymbol(FILES.forkVersion, symbol);
    return { value, file: FILES.forkVersion, line, symbol };
  }
  if (file === 'codemod' && symbol === 'UNSCOPED_MAP') {
    const mod = await import(FILES.codemod);
    const value = mod.UNSCOPED_MAP;
    if (value === undefined) {
      throw new Error(`parseRegistry: UNSCOPED_MAP not exported from ${FILES.codemod}`);
    }
    const line = findLineForSymbol(FILES.codemod, 'UNSCOPED_MAP');
    return { value, file: FILES.codemod, line, symbol: 'UNSCOPED_MAP' };
  }
  if (file === 'buildPackages' && symbol === '_v3_packages') {
    const { names, line } = parseBashAssocArrayLiteral(FILES.buildPackages, '_v3_packages');
    return { value: new Set(names), file: FILES.buildPackages, line, symbol: '_v3_packages' };
  }
  if (file === 'buildPackages' && symbol === 'v3set_inline') {
    const { names, line } = parseInlineJsSet(FILES.buildPackages, 'v3set');
    return { value: new Set(names), file: FILES.buildPackages, line, symbol: 'v3set (inline JS)' };
  }
  if (file === 'publishLevels' && symbol === 'publish_levels_v3') {
    // Extract the set of v3 package short-names from publish-levels.json
    // by stripping the `@sparkleideas/` scope. publish-levels.json is the
    // canonical source for what packages ship; check E asserts the bash
    // _v3_packages literal is a subset.
    const raw = JSON.parse(readFileSync(FILES.publishLevels, 'utf-8'));
    const names = new Set();
    for (const level of raw.levels || []) {
      for (const pkg of level.packages || []) {
        names.add(pkg.replace(/^@sparkleideas\//, ''));
      }
    }
    return { value: names, file: FILES.publishLevels, line: 1, symbol: 'levels[*].packages' };
  }
  throw new Error(`parseRegistry: no handler for ${file}::${symbol}`);
}

/** Find 1-based line number where `export const SYMBOL` or `const SYMBOL` appears. */
function findLineForSymbol(filePath, symbol) {
  const src = readFileSync(filePath, 'utf-8');
  const lines = src.split('\n');
  const re = new RegExp(`^\\s*(export\\s+)?const\\s+${escapeRe(symbol)}\\b`);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return i + 1;
  }
  return 0; // unknown — caller still shows file
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parse a bash associative-array literal of the form:
 *   local -A NAME=([key1]=1 [key2]=1
 *     [key3]=1 [key4]=1)
 *
 * Returns { names: string[], line: number } where line is the 1-based line
 * of the `local -A NAME=` opener.
 */
function parseBashAssocArrayLiteral(filePath, name) {
  const src = readFileSync(filePath, 'utf-8');
  const lines = src.split('\n');
  const opener = new RegExp(`local\\s+-A\\s+${escapeRe(name)}\\s*=\\s*\\(`);
  let startLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (opener.test(lines[i])) {
      startLine = i;
      break;
    }
  }
  if (startLine < 0) {
    throw new Error(`parseBashAssocArrayLiteral: '${name}' not found in ${filePath}`);
  }
  // Concatenate from the opener until we hit the matching closing ')'.
  let buf = '';
  for (let i = startLine; i < lines.length; i++) {
    buf += lines[i] + '\n';
    if (lines[i].includes(')')) break;
  }
  // Extract all [name]=value tokens; we only care about the key.
  const keyRe = /\[([a-zA-Z0-9._-]+)\]=/g;
  const names = [];
  let m;
  while ((m = keyRe.exec(buf)) !== null) {
    names.push(m[1]);
  }
  return { names, line: startLine + 1 };
}

/**
 * Parse an inline-JS `new Set([...])` literal embedded in a bash heredoc-ish
 * block. Specifically the block at build-packages.sh:200-205 that declares
 *   const v3set = new Set(['name1','name2', ...]);
 *
 * Returns { names: string[], line: number } where line is the 1-based line
 * of the `const v3set` opener.
 */
function parseInlineJsSet(filePath, name) {
  const src = readFileSync(filePath, 'utf-8');
  const lines = src.split('\n');
  const opener = new RegExp(`const\\s+${escapeRe(name)}\\s*=\\s*new\\s+Set\\s*\\(\\s*\\[`);
  let startLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (opener.test(lines[i])) {
      startLine = i;
      break;
    }
  }
  if (startLine < 0) {
    throw new Error(`parseInlineJsSet: '${name}' not found in ${filePath}`);
  }
  // Concatenate from opener until matching `])`.
  let buf = '';
  for (let i = startLine; i < lines.length; i++) {
    buf += lines[i] + '\n';
    if (/\]\s*\)/.test(lines[i])) break;
  }
  // Strip line-comments so // ADR-XXXX notes don't get picked up as strings.
  buf = buf.replace(/\/\/.*$/gm, '');
  // Match single- or double-quoted string literals.
  const strRe = /['"]([a-zA-Z0-9._-]+)['"]/g;
  const names = [];
  let m;
  while ((m = strRe.exec(buf)) !== null) {
    names.push(m[1]);
  }
  return { names, line: startLine + 1 };
}

// ── Set utilities ──────────────────────────────────────────────────────

/** Returns elements in `a` not in `b`. */
function difference(a, b) {
  const out = new Set();
  for (const x of a) {
    if (!b.has(x)) out.add(x);
  }
  return out;
}

// ── Lint runner ────────────────────────────────────────────────────────

/**
 * Run all 5 pairwise checks. Returns array of error objects; empty array
 * means PASS. Each error has: { check, severity, message }.
 */
export async function lintScopeRegistries() {
  const errors = [];

  const scopesReg = await parseRegistry('forkVersion', 'SCOPES');
  const publishableReg = await parseRegistry('forkVersion', 'UNSCOPED_PUBLISHABLE');
  const unscopedMapReg = await parseRegistry('codemod', 'UNSCOPED_MAP');
  const v3BashReg = await parseRegistry('buildPackages', '_v3_packages');
  const v3InlineReg = await parseRegistry('buildPackages', 'v3set_inline');
  const publishLevelsReg = await parseRegistry('publishLevels', 'publish_levels_v3');

  // WONT_PUBLISH comes from preflight-discover.mjs and lists discoverable
  // fork packages that are intentionally NOT in the publish pipeline (with
  // a documented reason inline). The lint respects this set: a name in
  // WONT_PUBLISH does not need to appear in UNSCOPED_PUBLISHABLE.
  const { WONT_PUBLISH } = await import(resolve(ROOT, 'scripts', 'preflight-discover.mjs'));
  const wontPublishUnscoped = new Set();
  for (const k of WONT_PUBLISH.keys()) {
    if (!k.startsWith('@')) wontPublishUnscoped.add(k);
  }

  const unscopedMapKeys = new Set(Object.keys(unscopedMapReg.value));

  // Strip the known-scoped names from UNSCOPED_MAP keys before checking
  // against UNSCOPED_PUBLISHABLE. UNSCOPED_MAP contains both unscoped fork
  // sources (the lint subject) AND a few scoped @claude-flow/* keys? No —
  // verified all UNSCOPED_MAP keys are unscoped today. But filter:
  //   (1) platform binaries (publishable via NAPI workflow, not -patch.N);
  //   (2) WONT_PUBLISH entries (intentionally not in publish pipeline).
  const expectedPublishable = new Set();
  for (const k of unscopedMapKeys) {
    if (PLATFORM_BINARY_NAMES.has(k)) continue;
    if (wontPublishUnscoped.has(k)) continue;
    expectedPublishable.add(k);
  }

  // Check A: every non-platform-binary UNSCOPED_MAP key must be in UNSCOPED_PUBLISHABLE.
  const missingInPublishable = difference(expectedPublishable, publishableReg.value);
  if (missingInPublishable.size > 0) {
    for (const name of missingInPublishable) {
      errors.push({
        check: 'A',
        severity: 'error',
        message: formatDriftError({
          offender: { file: unscopedMapReg.file, line: unscopedMapReg.line, symbol: 'UNSCOPED_MAP' },
          partner: { file: publishableReg.file, line: publishableReg.line, symbol: 'UNSCOPED_PUBLISHABLE' },
          name,
          fix: `Add '${name}' to UNSCOPED_PUBLISHABLE in ${publishableReg.file}:${publishableReg.line} (or remove from UNSCOPED_MAP if not publishable).`,
        }),
      });
    }
  }

  // Check B: every UNSCOPED_PUBLISHABLE entry must be in UNSCOPED_MAP.
  const missingInMap = difference(publishableReg.value, unscopedMapKeys);
  if (missingInMap.size > 0) {
    for (const name of missingInMap) {
      errors.push({
        check: 'B',
        severity: 'error',
        message: formatDriftError({
          offender: { file: publishableReg.file, line: publishableReg.line, symbol: 'UNSCOPED_PUBLISHABLE' },
          partner: { file: unscopedMapReg.file, line: unscopedMapReg.line, symbol: 'UNSCOPED_MAP' },
          name,
          fix: `Add '${name}: '@sparkleideas/${name}'' to UNSCOPED_MAP in ${unscopedMapReg.file}:${unscopedMapReg.line} (or remove from UNSCOPED_PUBLISHABLE).`,
        }),
      });
    }
  }

  // Check C: SCOPES non-empty + every entry ends in '/'.
  if (!Array.isArray(scopesReg.value) || scopesReg.value.length === 0) {
    errors.push({
      check: 'C',
      severity: 'error',
      message: `[ADR-0236] SCOPES is empty or not an array at ${scopesReg.file}:${scopesReg.line}.\n` +
               `  Fix: declare at least one scope prefix.`,
    });
  } else {
    for (const s of scopesReg.value) {
      if (typeof s !== 'string' || !s.endsWith('/')) {
        errors.push({
          check: 'C',
          severity: 'error',
          message: `[ADR-0236] SCOPES entry '${s}' at ${scopesReg.file}:${scopesReg.line} does not end in '/'.\n` +
                   `  Fix: scope prefixes must include trailing '/' (matches startsWith() usage at fork-version.mjs:112).`,
        });
      }
    }
  }

  // Check D: _v3_packages bash literal MUST equal v3set inline JS (intra-file drift).
  const bashOnly = difference(v3BashReg.value, v3InlineReg.value);
  const inlineOnly = difference(v3InlineReg.value, v3BashReg.value);
  if (bashOnly.size > 0 || inlineOnly.size > 0) {
    errors.push({
      check: 'D',
      severity: 'error',
      message: formatIntraFileDriftError({
        bashReg: v3BashReg,
        inlineReg: v3InlineReg,
        bashOnly: [...bashOnly],
        inlineOnly: [...inlineOnly],
      }),
    });
  }

  // Check E: every _v3_packages entry MUST appear in publish-levels.json v3 names.
  const missingFromLevels = difference(v3BashReg.value, publishLevelsReg.value);
  if (missingFromLevels.size > 0) {
    for (const name of missingFromLevels) {
      errors.push({
        check: 'E',
        severity: 'error',
        message: formatDriftError({
          offender: { file: v3BashReg.file, line: v3BashReg.line, symbol: '_v3_packages' },
          partner: { file: publishLevelsReg.file, line: publishLevelsReg.line, symbol: 'levels[*].packages' },
          name,
          fix: `Add '@sparkleideas/${name}' to a level in ${publishLevelsReg.file} (or remove '${name}' from _v3_packages).`,
        }),
      });
    }
  }

  return errors;
}

function formatDriftError({ offender, partner, name, fix }) {
  return (
    `[ADR-0236] Cross-registry drift: '${name}'\n` +
    `  Offending registry: ${offender.symbol} at ${offender.file}:${offender.line}\n` +
    `  Should agree with : ${partner.symbol} at ${partner.file}:${partner.line}\n` +
    `  Fix               : ${fix}\n` +
    `  Corpus rule       : feedback-no-fallbacks + ADR-0231 wave-A9 §Lesson #2`
  );
}

function formatIntraFileDriftError({ bashReg, inlineReg, bashOnly, inlineOnly }) {
  const parts = [
    `[ADR-0236] Intra-file drift in build-packages.sh between bash literal and inline JS:`,
    `  Bash literal      : ${bashReg.symbol} at ${bashReg.file}:${bashReg.line}`,
    `  Inline JS         : ${inlineReg.symbol} at ${inlineReg.file}:${inlineReg.line}`,
  ];
  if (bashOnly.length > 0) {
    parts.push(`  Only in bash      : ${bashOnly.join(', ')}`);
  }
  if (inlineOnly.length > 0) {
    parts.push(`  Only in inline JS : ${inlineOnly.join(', ')}`);
  }
  parts.push(
    `  Fix               : Add missing entries to whichever side is short so both lists match.`,
    `  Corpus rule       : feedback-no-fallbacks + ADR-0231 wave-A9 §Lesson #2`,
  );
  return parts.join('\n');
}

// ── CLI entry point ────────────────────────────────────────────────────

// Normalize both sides through realpathSync because macOS symlinks `/tmp`
// to `/private/tmp`; fileURLToPath returns the realpath form while
// `process.argv[1]` keeps the original form when the script is invoked
// via `/tmp/...`. Without realpathSync the CLI block silently no-ops
// when run from a temp tree (caught by tests/pipeline/lint-scope-registries.test.mjs).
const isMainModule = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(__filename);
  } catch {
    return resolve(process.argv[1]) === __filename;
  }
})();

if (isMainModule) {
  try {
    const errors = await lintScopeRegistries();
    if (errors.length === 0) {
      console.log('lint-scope-registries: PASS (0 drift entries across 5 registries, 5 pairwise checks)');
      process.exit(0);
    }
    console.error(`lint-scope-registries: FAIL (${errors.length} drift entries)`);
    for (const e of errors) {
      console.error('');
      console.error(e.message);
    }
    console.error('');
    console.error('See ADR-0236 (docs/adr/ADR-0236-cross-registry-scope-package-lint.md).');
    process.exit(1);
  } catch (err) {
    console.error(`lint-scope-registries: ERROR — ${err.message}`);
    if (err.stack) console.error(err.stack);
    process.exit(2);
  }
}
