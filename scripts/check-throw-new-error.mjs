#!/usr/bin/env node
// scripts/check-throw-new-error.mjs — advisory-first cultural lint per
// ADR-0242 §Decision scope #3.
//
// Counts `throw new Error("...")` (literal-string constructor argument)
// across forks/ruflo/v3/**/*.ts (excluding dist/, node_modules/, tests).
// Existing sites are grandfathered into a content-keyed allowlist
// (lib/throw-new-error-allowlist.txt); only NEW sites in changed files
// surface as a delta in the advisory output.
//
// Per ADR-0242 §Decision scope:
//   - This is the cultural-shift instrument, not a blocking gate.
//   - Exits 0 advisory-first; promotion to exit 1 requires baseline=0 +
//     empirical FP=0 verification (mitigation invariant: cycle N+3 check).
//   - The grandfather allowlist marks ~1,994 existing throws as
//     "known-debt, don't touch unless refactoring."
//
// What it flags:
//   - `throw new Error("literal string")` — naked throw, no code, no cause
//   - `throw new Error('literal string')` — single-quote variant
//   - `throw new Error(\`template literal\`)` — backtick variant
//
// What it does NOT flag:
//   - `throw new Error(varName)` — already typed through a variable
//   - `throw new RufloError(...)` — uses the canonical hierarchy
//   - `throw new <SubclassError>(...)` — any typed subclass
//   - `throw e` — rethrow
//   - `throw wrapError(...)` — uses the canonical adapter
//
// Allowlist content-keyed per ADR-0242 §Improvements #2: keyed on
// `<relpath> :: <whitespace-collapsed throw clause>` so the entry
// survives line shifts. Re-run with --update to regenerate baseline.
//
// Exit codes:
//   0 — always (advisory-first per ADR-0242)
//
// No external deps; Node 20+ only.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_DIR = resolve(__dirname, '..');
const ALLOWLIST_FILE = join(PROJECT_DIR, 'lib', 'throw-new-error-allowlist.txt');

const SCAN_ROOTS = [
  { fork: 'ruflo', root: '/Users/henrik/source/forks/ruflo/v3/@claude-flow' },
  { fork: 'ruflo-plugins', root: '/Users/henrik/source/forks/ruflo/v3/plugins' },
];

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__tests__', 'tests']);
const SKIP_FILE_RE = /\.test\.(ts|mjs|js)$|\.spec\.(ts|mjs|js)$|\.d\.ts$/;

function loadAllowlist() {
  if (!existsSync(ALLOWLIST_FILE)) return new Set();
  const src = readFileSync(ALLOWLIST_FILE, 'utf8');
  const out = new Set();
  for (const line of src.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    out.add(trimmed);
  }
  return out;
}

function* walk(rootDir) {
  if (!existsSync(rootDir)) return;
  const stack = [rootDir];
  while (stack.length > 0) {
    const cur = stack.pop();
    let entries;
    try { entries = readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = join(cur, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        if (e.name.startsWith('.')) continue;
        stack.push(full);
      } else if (e.isFile()) {
        if (SKIP_FILE_RE.test(e.name)) continue;
        if (/\.ts$/.test(e.name)) yield full;
      }
    }
  }
}

// Strip strings + comments. Preserves newlines so line numbers match.
// Same shape as check-silent-catches.mjs.
function stripStringsAndComments(src) {
  let out = '';
  let i = 0;
  let inString = null;
  let blockComment = false;
  let lineComment = false;
  while (i < src.length) {
    const c = src[i];
    const nx = src[i + 1];
    if (lineComment) {
      if (c === '\n') { lineComment = false; out += c; }
      i++;
    } else if (blockComment) {
      if (c === '*' && nx === '/') { blockComment = false; out += '  '; i += 2; }
      else if (c === '\n') { out += '\n'; i++; }
      else i++;
    } else if (inString) {
      if (c === '\\') {
        if (nx === '\n') { out += '\n'; i += 2; }
        else i += 2;
      } else if (c === inString) {
        inString = null;
        out += c;
        i++;
      } else if (c === '\n') {
        out += '\n';
        i++;
      } else {
        i++;
      }
    } else if (c === '/' && nx === '/') {
      lineComment = true;
      i += 2;
    } else if (c === '/' && nx === '*') {
      blockComment = true;
      i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      inString = c;
      out += c;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// Match `throw new Error(<literal-string>)` on the ORIGINAL src,
// then verify the position is real code (not inside a string/comment)
// by checking the corresponding line in stripped src has `throw`.
//
// Literal strings supported: '...', "...", `...` (no template interp).
// We deliberately do NOT flag `throw new Error(varName)` or
// `throw new Error(\`${foo}\`)` — those are out-of-scope per
// ADR-0242 §Decision scope #3 (the lint targets the "naked" shape).
const THROW_NEW_ERROR_RE = /\bthrow\s+new\s+Error\s*\(\s*(['"`])/g;

function findNakedThrows(src) {
  const stripped = stripStringsAndComments(src);
  const lines = src.split('\n');
  const findings = [];

  let m;
  THROW_NEW_ERROR_RE.lastIndex = 0;
  while ((m = THROW_NEW_ERROR_RE.exec(src)) !== null) {
    const idx = m.index;
    const lineNum = src.slice(0, idx).split('\n').length;
    // Skip if this `throw` is inside a string/comment.
    const strippedLine = stripped.split('\n')[lineNum - 1] ?? '';
    if (!/\bthrow\s+new\s+Error\b/.test(strippedLine)) continue;

    // Find the closing `)` to capture the full throw expression.
    // Conservatively cap at 200 chars or end-of-line + 1.
    let endIdx = src.indexOf(')', idx);
    if (endIdx === -1 || endIdx - idx > 200) {
      endIdx = idx + 80;
    }
    const fullExpr = src.slice(idx, endIdx + 1).replace(/\s+/g, ' ').trim();

    const headline = (lines[lineNum - 1] ?? '').trim().slice(0, 100);
    findings.push({ line: lineNum, headline, signature: fullExpr });
  }
  return findings;
}

function collectFindings() {
  const all = [];
  let totalThrows = 0;
  for (const { fork, root } of SCAN_ROOTS) {
    if (!existsSync(root)) {
      console.error(`[THROW-NEW-ERROR] WARN: scan root missing: ${root} (${fork}) — skipping`);
      continue;
    }
    for (const f of walk(root)) {
      const src = readFileSync(f, 'utf8');
      if (!/throw\s+new\s+Error/.test(src)) continue;
      const rel = relative(PROJECT_DIR, f);
      for (const finding of findNakedThrows(src)) {
        totalThrows++;
        all.push({ file: rel, line: finding.line, headline: finding.headline, key: `${rel} :: ${finding.signature}` });
      }
    }
  }
  return { all, totalThrows };
}

function writeAllowlist(findings) {
  const keys = [...new Set(findings.map((f) => f.key))].sort();
  const header =
    '# scripts/check-throw-new-error.mjs allowlist (ADR-0242 §Decision scope #3)\n' +
    '#\n' +
    '# Format: `<relative-path> :: <whitespace-collapsed throw clause>` (one per line).\n' +
    '# CONTENT-KEYED (not line-keyed): an entry is matched by the throw clause text\n' +
    '# itself, so it survives line shifts from edits elsewhere in the file. An entry\n' +
    "# only goes stale when THAT throw's own string changes — re-review then.\n" +
    '# Identical clauses within one file collapse to a single entry.\n' +
    '#\n' +
    '# Grandfather baseline per ADR-0242: the ~1,994 existing naked\n' +
    "# `throw new Error('...')` sites are pre-existing cultural debt. New code\n" +
    '# should prefer `throw new RufloError(msg, RufloErrorCode.X, ctx, cause)` from\n' +
    "# @claude-flow/errors, or `throw wrapError(e, RufloErrorCode.X)` for rethrows.\n" +
    '#\n' +
    "# Regenerate after deliberate changes: node scripts/check-throw-new-error.mjs --update\n" +
    '#\n';
  writeFileSync(ALLOWLIST_FILE, header + keys.join('\n') + '\n');
}

function main() {
  const update = process.argv.includes('--update');
  const { all, totalThrows } = collectFindings();

  if (update) {
    writeAllowlist(all);
    const n = new Set(all.map((f) => f.key)).size;
    console.log(`[THROW-NEW-ERROR] --update: wrote ${n} content-keyed allowlist entries from ${all.length} findings`);
    process.exit(0);
  }

  const allowlist = loadAllowlist();
  const newSites = all.filter((f) => !allowlist.has(f.key));

  // ADVISORY-FIRST: exit 0 regardless. Baseline visibility only.
  console.log(`[THROW-NEW-ERROR] ADVISORY (ADR-0242 §Decision scope #3): ${totalThrows} naked throw new Error("…") site(s) scanned`);
  console.log(`[THROW-NEW-ERROR]   ├ ${allowlist.size} grandfathered (lib/throw-new-error-allowlist.txt)`);
  console.log(`[THROW-NEW-ERROR]   └ ${newSites.length} not in allowlist (delta from baseline)`);
  if (newSites.length > 0 && newSites.length <= 20) {
    console.log(`[THROW-NEW-ERROR] New sites (preview):`);
    for (const s of newSites.slice(0, 20)) {
      console.log(`[THROW-NEW-ERROR]   ${s.file}:${s.line}  ${s.headline}`);
    }
  } else if (newSites.length > 20) {
    console.log(`[THROW-NEW-ERROR] ${newSites.length} new sites — run --update to refresh baseline (advisory phase).`);
  }
  console.log(`[THROW-NEW-ERROR] Prefer: throw new RufloError(msg, RufloErrorCode.X, ctx, cause)`);
  console.log(`[THROW-NEW-ERROR]    or: throw wrapError(e, RufloErrorCode.X)  // from @claude-flow/errors`);
  // Promotion to exit 1 deferred to cycle N+3 per ADR-0242 §"Erosion-vs-rot disposition".
  process.exit(0);
}

main();
