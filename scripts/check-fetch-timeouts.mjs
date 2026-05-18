#!/usr/bin/env node
// scripts/check-fetch-timeouts.mjs — fetch-timeout coverage gate.
//
// Walks every .ts/.mjs/.js file under each fork's product source tree and
// flags `fetch(...)` calls that have no `signal:` option (i.e. no
// `AbortSignal.timeout(N)`, no controller-driven abort signal). An
// untimeout'd fetch is a silent-hang hazard — when the remote stalls, the
// pipeline blocks indefinitely. This class is the same family ADR-0189
// addresses for NAPI silent-drops: an invariant that should be code-enforced,
// not ADR-tracked.
//
// Exit codes:
//   0  — every fetch() in scope passes a signal option (or is on the allowlist)
//   1  — at least one unguarded fetch() found
//
// No external deps; Node 20+ only.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_DIR = resolve(__dirname, '..');
const ALLOWLIST_FILE = join(PROJECT_DIR, 'lib', 'fetch-timeout-allowlist.txt');

// Forks + product source roots to scan. We only check product code under
// each fork's `src/` (or equivalent) — vendored deps, tests, and docs are
// excluded.
const SCAN_ROOTS = [
  // ruflo cli — the largest fetch consumer (CDN, IPFS, Anthropic, neural artifacts).
  { fork: 'ruflo', root: '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src' },
  // agentic-flow runtime source.
  { fork: 'agentic-flow', root: '/Users/henrik/source/forks/agentic-flow/src' },
];

// Skip these directories anywhere under a scan root.
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__tests__', 'tests']);
// Skip these file patterns.
const SKIP_FILE_RE = /\.test\.(ts|mjs|js)$|\.spec\.(ts|mjs|js)$|\.d\.ts$/;

function loadAllowlist() {
  if (!existsSync(ALLOWLIST_FILE)) return new Set();
  const src = readFileSync(ALLOWLIST_FILE, 'utf8');
  const out = new Set();
  for (const line of src.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    // Format: <relative-path>:<line-number>
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
      } else if (e.isFile()) {
        if (SKIP_FILE_RE.test(e.name)) continue;
        if (/\.(ts|mjs|js)$/.test(e.name)) yield full;
      }
    }
  }
}

// Find each `fetch(` call expression, capture the call's argument block
// (balanced parens), and check whether the block contains a `signal:`
// option. Comments + strings are NOT stripped — false-positive risk is
// low because real code has `signal:` outside of strings ~always.
function findUnguardedFetches(src) {
  const findings = [];
  const lines = src.split('\n');

  // Pre-strip strings + comments so the outer `fetch(` scan can't be tricked
  // by example code embedded in docstrings or commented-out blocks. Newlines
  // are preserved, so line numbers in `stripped` still match `src`.
  const stripped = stripStringsAndComments(src);

  // Walk char-by-char to find `fetch(` then scan to balanced `)`.
  let i = 0;
  while (i < stripped.length) {
    const idx = stripped.indexOf('fetch(', i);
    if (idx === -1) break;
    i = idx + 6;

    // Must be a word boundary before "fetch" (skip `prefetch`, `someFetch`).
    if (idx > 0) {
      const prev = stripped[idx - 1];
      if (/[a-zA-Z0-9_$.]/.test(prev)) continue;
    }
    // Skip method/function declarations: `async fetch(`, `function fetch(`,
    // `static fetch(`, etc. — these are definitions, not calls.
    const preceding = stripped.slice(Math.max(0, idx - 32), idx);
    if (/\b(async|function|static|public|private|protected|get|set)\s+$/.test(preceding)) continue;

    // Scan to matching `)`. The stripped src already has no strings/comments,
    // so we just count parens.
    let depth = 1;
    let j = idx + 6;
    while (j < stripped.length && depth > 0) {
      const c = stripped[j];
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) break;
      }
      j++;
    }

    if (depth !== 0) {
      // Unclosed (parse error / EOF) — skip.
      continue;
    }

    const block = stripped.slice(idx, j + 1);
    // Look for `signal:` in the stripped block (strings/comments already gone).
    const hasSignal = /(^|[\s,{(])signal\s*:/m.test(block);
    if (!hasSignal) {
      // Line number: count newlines up to idx (works on stripped, since
      // stripping preserves \n).
      const lineNum = stripped.slice(0, idx).split('\n').length;
      const headline = (lines[lineNum - 1] ?? '').trim().slice(0, 80);
      findings.push({ line: lineNum, headline });
    }
    i = j + 1;
  }
  return findings;
}

// Light-weight string/comment stripper: replace string contents with empty,
// drop // and /* */ comments. Preserves \n in all cases so line numbers in
// the stripped output match the original source.
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
      // else drop char (but a line comment ends at newline, never spans lines)
      i++;
    } else if (blockComment) {
      if (c === '*' && nx === '/') { blockComment = false; out += '  '; i += 2; }
      else if (c === '\n') { out += '\n'; i++; }
      else i++;
    } else if (inString) {
      if (c === '\\') {
        // Preserve newline if escape spans EOL ('\<newline>' line continuation)
        if (nx === '\n') { out += '\n'; i += 2; }
        else i += 2;
      } else if (c === inString) {
        inString = null;
        out += c; // keep closing quote
        i++;
      } else if (c === '\n') {
        // Template literals + multi-line strings can contain real newlines.
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
      out += c; // keep opening quote
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function main() {
  const allowlist = loadAllowlist();
  let totalUnguarded = 0;
  let totalCovered = 0;
  const unguarded = []; // { file, line, headline }

  for (const { fork, root } of SCAN_ROOTS) {
    if (!existsSync(root)) {
      console.error(`[FETCH-TIMEOUT] WARN: scan root missing: ${root} (${fork}) — skipping`);
      continue;
    }
    for (const f of walk(root)) {
      const src = readFileSync(f, 'utf8');
      if (!src.includes('fetch(')) continue;
      const findings = findUnguardedFetches(src);
      // Count covered fetches too (for the summary line).
      const fetchCount = (src.match(/(?<![a-zA-Z0-9_$.])fetch\(/g) || []).length;
      totalCovered += fetchCount - findings.length;
      for (const finding of findings) {
        const rel = relative(PROJECT_DIR, f);
        const key = `${rel}:${finding.line}`;
        if (allowlist.has(key)) continue;
        unguarded.push({ file: rel, line: finding.line, headline: finding.headline });
        totalUnguarded++;
      }
    }
  }

  if (unguarded.length > 0) {
    console.error('');
    console.error(`[FETCH-TIMEOUT] Found ${unguarded.length} unguarded fetch() call(s):`);
    for (const u of unguarded) {
      console.error(`[FETCH-TIMEOUT] ${u.file}:${u.line}  ${u.headline}`);
    }
    console.error('');
    console.error('[FETCH-TIMEOUT] These fetch() calls have no `signal:` option (e.g. no');
    console.error('[FETCH-TIMEOUT] AbortSignal.timeout(N)). An untimeout\'d fetch hangs the');
    console.error('[FETCH-TIMEOUT] pipeline indefinitely if the remote stalls.');
    console.error('');
    console.error('[FETCH-TIMEOUT] Either:');
    console.error('[FETCH-TIMEOUT]   1. Add `signal: AbortSignal.timeout(<ms>)` to the fetch options, or');
    console.error('[FETCH-TIMEOUT]   2. Add `<relative-path>:<line>` to lib/fetch-timeout-allowlist.txt');
    console.error('[FETCH-TIMEOUT]      with a comment justifying the exemption.');
    process.exit(1);
  }

  console.log(`[FETCH-TIMEOUT] OK: ${totalCovered} fetch() call(s), all carry a signal option`);
  process.exit(0);
}

main();
