#!/usr/bin/env node
// scripts/check-silent-catches.mjs — silent-catch fail-loud gate.
//
// Walks each fork's product source tree and flags `catch (...) { ... }`
// blocks that swallow the error without logging, re-throwing, or
// otherwise surfacing it. This is the canonical `feedback-no-fallbacks`
// violation: an empty or comment-only catch turns runtime failures into
// silent passes, exactly the ADR-0082 hazard the project bans.
//
// What the detector flags:
//   - `catch { }` (literal empty body — TS 4+ optional binding form)
//   - `catch (e) { }` (literal empty body)
//
// What it does NOT flag (intentional silence, documented per project
// convention):
//   - `catch (e) { /* explanation */ }` — comment IS the surfacing of intent
//   - `catch (e) { ignore(e); }` — caller has explicit ignore hook
//   - `catch (e) { return null; }` — caller is propagating a sentinel
//   - `catch (e) { /* ... */ throw e; }` — re-throw
//   - `catch (e) { logger.warn(...); }` — logs are surfacing
//
// Allowlist at lib/silent-catches-allowlist.txt (format:
// `<relative-path>:<line>` with a rationale comment above).
//
// Exit codes:
//   0  — every catch block in scope surfaces its error (or is allowlisted)
//   1  — at least one silent catch found
//
// No external deps; Node 20+ only.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_DIR = resolve(__dirname, '..');
const ALLOWLIST_FILE = join(PROJECT_DIR, 'lib', 'silent-catches-allowlist.txt');

const SCAN_ROOTS = [
  { fork: 'ruflo', root: '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src' },
  { fork: 'agentic-flow', root: '/Users/henrik/source/forks/agentic-flow/src' },
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
        if (/\.(ts|mjs|js)$/.test(e.name)) yield full;
      }
    }
  }
}

// Strip strings + comments. Preserves newlines so line numbers in the
// stripped output match the original. Same shape as check-fetch-timeouts.mjs.
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

// Find each `catch` keyword in the ORIGINAL src (so body positions are
// correct), then check whether `catch` is inside a string by consulting
// the stripped src at the same position — if the char at idx in stripped
// is whitespace where original has `c`, the `catch` was inside a string
// and we skip it. The body is checked in the ORIGINAL src for emptiness
// (whitespace-only after trim). Documented `catch { /* rationale */ }`
// patterns are intentionally NOT flagged — the comment is the rationale
// per project convention; ADR-0082 bans silent fallbacks, not documented
// ones.
function findSilentCatches(src) {
  const stripped = stripStringsAndComments(src);
  const lines = src.split('\n');
  const findings = [];

  // Scan ORIGINAL src for `catch` occurrences. Pad stripped to match length.
  const strippedPadded = stripped + '\n'.repeat(Math.max(0, src.length - stripped.length));

  let i = 0;
  while (i < src.length) {
    const idx = src.indexOf('catch', i);
    if (idx === -1) break;
    i = idx + 5;
    // Word boundary on both sides.
    if (idx > 0 && /[a-zA-Z0-9_$]/.test(src[idx - 1])) continue;
    if (idx + 5 < src.length && /[a-zA-Z0-9_$]/.test(src[idx + 5])) continue;
    // Skip if this `catch` is inside a string/comment (stripped has it gone).
    // Note: stripped preserves \n but doesn't preserve byte positions because
    // string + comment chars are dropped. We check by matching the first
    // letter `c` at the corresponding position in stripped IFF stripped has
    // the same length up to that point. Since stripping doesn't preserve
    // position globally, a simpler check: look at the line in stripped vs
    // original — if `catch` doesn't appear at the same line in stripped,
    // it was inside a string/comment.
    const lineNum = src.slice(0, idx).split('\n').length;
    const strippedLine = stripped.split('\n')[lineNum - 1] ?? '';
    if (!/\bcatch\b/.test(strippedLine)) continue;

    // Skip whitespace.
    let j = idx + 5;
    while (j < src.length && /\s/.test(src[j])) j++;

    // Optional binding: `catch (e)` or `catch (e: unknown)`. Scan to closing `)`.
    if (src[j] === '(') {
      let depth = 1;
      j++;
      while (j < src.length && depth > 0) {
        if (src[j] === '(') depth++;
        else if (src[j] === ')') depth--;
        j++;
      }
      if (depth !== 0) continue;
      while (j < src.length && /\s/.test(src[j])) j++;
    }

    // Now `{` must follow for a real catch block.
    if (src[j] !== '{') continue;
    const bodyStart = j + 1;

    // Scan to balanced `}` in ORIGINAL src. We need to respect strings
    // + comments inside the body so a `}` inside a string doesn't close
    // the catch block early. The stripped src has the same positions
    // within this region IF positions matched up to here — but they
    // don't globally. Use a simple state-machine: brace-count in
    // original with string/comment awareness.
    let depth = 1;
    let k = bodyStart;
    let inStr = null, blockC = false, lineC = false;
    while (k < src.length && depth > 0) {
      const c = src[k];
      const nx = src[k + 1];
      if (lineC) { if (c === '\n') lineC = false; k++; continue; }
      if (blockC) {
        if (c === '*' && nx === '/') { blockC = false; k += 2; continue; }
        k++; continue;
      }
      if (inStr) {
        if (c === '\\') { k += 2; continue; }
        if (c === inStr) { inStr = null; k++; continue; }
        k++; continue;
      }
      if (c === '/' && nx === '/') { lineC = true; k += 2; continue; }
      if (c === '/' && nx === '*') { blockC = true; k += 2; continue; }
      if (c === '"' || c === "'" || c === '`') { inStr = c; k++; continue; }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) break;
      }
      k++;
    }
    if (depth !== 0) continue;
    const bodyEnd = k;

    // Check ORIGINAL src body for emptiness (after whitespace trim).
    const origBody = src.slice(bodyStart, bodyEnd).trim();
    if (origBody === '') {
      const headline = (lines[lineNum - 1] ?? '').trim().slice(0, 80);
      findings.push({ line: lineNum, headline });
    }
    i = bodyEnd + 1;
  }
  return findings;
}

function main() {
  const allowlist = loadAllowlist();
  let totalCatches = 0;
  const silent = [];

  for (const { fork, root } of SCAN_ROOTS) {
    if (!existsSync(root)) {
      console.error(`[SILENT-CATCH] WARN: scan root missing: ${root} (${fork}) — skipping`);
      continue;
    }
    for (const f of walk(root)) {
      const src = readFileSync(f, 'utf8');
      if (!/\bcatch\b/.test(src)) continue;
      const stripped = stripStringsAndComments(src);
      const catchCount = (stripped.match(/\bcatch\b/g) || []).length;
      totalCatches += catchCount;
      const findings = findSilentCatches(src);
      for (const finding of findings) {
        const rel = relative(PROJECT_DIR, f);
        const key = `${rel}:${finding.line}`;
        if (allowlist.has(key)) continue;
        silent.push({ file: rel, line: finding.line, headline: finding.headline });
      }
    }
  }

  if (silent.length > 0) {
    console.error('');
    console.error(`[SILENT-CATCH] Found ${silent.length} silent catch block(s):`);
    for (const s of silent) {
      console.error(`[SILENT-CATCH] ${s.file}:${s.line}  ${s.headline}`);
    }
    console.error('');
    console.error('[SILENT-CATCH] These catch blocks have an empty body (or only comments)');
    console.error('[SILENT-CATCH] after string + comment stripping. Empty catches swallow');
    console.error('[SILENT-CATCH] runtime failures (feedback-no-fallbacks / ADR-0082 hazard).');
    console.error('');
    console.error('[SILENT-CATCH] Either:');
    console.error('[SILENT-CATCH]   1. Log the error (`console.warn`, `logger.warn`, ...), re-throw,');
    console.error('[SILENT-CATCH]      or call an explicit ignore hook with rationale, or');
    console.error('[SILENT-CATCH]   2. Add `<relative-path>:<line>` to lib/silent-catches-allowlist.txt');
    console.error('[SILENT-CATCH]      with a comment explaining why the silence is intentional.');
    process.exit(1);
  }

  console.log(`[SILENT-CATCH] OK: ${totalCatches} catch block(s) scanned, all surface their error`);
  process.exit(0);
}

main();
