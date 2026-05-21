#!/usr/bin/env node
// scripts/check-undiscriminating-catches.mjs — stricter sibling to
// check-silent-catches.mjs. Flags `catch` blocks whose body, after
// stripping comments AND whitespace, contains nothing executable —
// i.e. the catch "discriminates" the error only by writing a comment,
// not by any runtime action.
//
// This catches the failure mode the AttentionService / TrainingPipeline
// regressions hit (2026-05-19): a `try { ... } catch { /* not available
// */ }` pattern that silently swallowed a real ESM-vs-CJS error because
// the body had no rethrow, no log, no conditional discrimination. The
// project's existing `check-silent-catches.mjs` ALLOWS this pattern as
// "documented intentional silence" — this stricter detector calls it
// out as ADR-0082-class silent-fallback.
//
// What counts as "discrimination":
//   - rethrow:  `throw e`, `throw new <Type>(...)`, conditional throw
//   - log:      `console.*`, `logger.*`, `output.*`, `log(...)`
//   - sentinel: `return ...` (caller branches on the sentinel)
//   - typed:    `if (e instanceof X)` / `if (e.code === '...')` patterns
//   - delegate: any function call (could be `ignoreError(e)` etc.)
//
// What this detector flags:
//   - `catch { /* anything */ }` — comment-only body (no actions)
//   - `catch (e) { /* anything */ }` — same, even with binding
//
// Allowlist at lib/undiscriminating-catches-allowlist.txt with format
// `<relative-path>:<line>` + a rationale comment above.
//
// Exit codes:
//   0  — every catch in scope either takes an action or is allowlisted
//   1  — at least one comment-only catch found that isn't allowlisted

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_DIR = resolve(__dirname, '..');
const ALLOWLIST_FILE = join(PROJECT_DIR, 'lib', 'undiscriminating-catches-allowlist.txt');

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

// Strip strings + comments; preserve newlines so line numbers stay accurate.
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

// Scan ORIGINAL src for `catch` keywords, find body in original, check
// the STRIPPED body for actionable content. The stripping removes
// comments — so a body that's only `/* explanation */` has stripped =
// empty, which we flag.
function findUndiscriminatingCatches(src) {
  const stripped = stripStringsAndComments(src);
  const lines = src.split('\n');
  const findings = [];

  let i = 0;
  while (i < src.length) {
    const idx = src.indexOf('catch', i);
    if (idx === -1) break;
    i = idx + 5;
    if (idx > 0 && /[a-zA-Z0-9_$]/.test(src[idx - 1])) continue;
    if (idx + 5 < src.length && /[a-zA-Z0-9_$]/.test(src[idx + 5])) continue;
    // Skip catches inside strings/comments (stripped src has them gone).
    const lineNum = src.slice(0, idx).split('\n').length;
    const strippedLine = stripped.split('\n')[lineNum - 1] ?? '';
    if (!/\bcatch\b/.test(strippedLine)) continue;

    let j = idx + 5;
    while (j < src.length && /\s/.test(src[j])) j++;

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

    if (src[j] !== '{') continue;
    const bodyStart = j + 1;

    // Scan to balanced `}` in ORIGINAL src (need to respect strings inside body).
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

    // STRIPPED body check: after removing comments + whitespace, is there
    // any actionable content? If body is empty OR only whitespace after
    // stripping, the catch swallows without discriminating.
    const origBody = src.slice(bodyStart, bodyEnd);
    const strippedBody = stripStringsAndComments(origBody).trim();
    if (strippedBody === '') {
      const headline = (lines[lineNum - 1] ?? '').trim().slice(0, 80);
      // Content key: the catch clause text (incl. its comment), whitespace-
      // collapsed. Stable across line shifts — only changes when the catch's
      // own code/comment changes. Replaces the old `<path>:<line>` key, which
      // went stale on ANY edit above the catch and forced full regeneration.
      const signature = src.slice(idx, bodyEnd + 1).replace(/\s+/g, ' ').trim();
      findings.push({ line: lineNum, headline, signature });
    }
    i = bodyEnd + 1;
  }
  return findings;
}

// Collect every comment-only catch across the scan roots, each with its
// content key (`<relpath> :: <whitespace-collapsed catch clause>`).
function collectFindings() {
  const all = [];
  let totalCatches = 0;
  for (const { fork, root } of SCAN_ROOTS) {
    if (!existsSync(root)) {
      console.error(`[UNDISCRIMINATING-CATCH] WARN: scan root missing: ${root} (${fork}) — skipping`);
      continue;
    }
    for (const f of walk(root)) {
      const src = readFileSync(f, 'utf8');
      if (!/\bcatch\b/.test(src)) continue;
      const stripped = stripStringsAndComments(src);
      totalCatches += (stripped.match(/\bcatch\b/g) || []).length;
      const rel = relative(PROJECT_DIR, f);
      for (const finding of findUndiscriminatingCatches(src)) {
        all.push({ file: rel, line: finding.line, headline: finding.headline, key: `${rel} :: ${finding.signature}` });
      }
    }
  }
  return { all, totalCatches };
}

function writeAllowlist(findings) {
  const keys = [...new Set(findings.map((f) => f.key))].sort();
  const header =
    '# scripts/check-undiscriminating-catches.mjs allowlist\n' +
    '#\n' +
    '# Format: `<relative-path> :: <whitespace-collapsed catch clause>` (one per line).\n' +
    '# CONTENT-KEYED (not line-keyed): an entry is matched by the catch clause text\n' +
    '# itself, so it survives line shifts from edits elsewhere in the file. An entry\n' +
    "# only goes stale when THAT catch's own code/comment changes — re-review then.\n" +
    '# Identical clauses within one file collapse to a single entry.\n' +
    '#\n' +
    '# Regenerate after deliberate changes:  node scripts/check-undiscriminating-catches.mjs --update\n' +
    '# Add an entry ONLY if the catch genuinely should swallow all error types without\n' +
    '# discrimination AND a code-level fix is not appropriate.\n' +
    '#\n';
  writeFileSync(ALLOWLIST_FILE, header + keys.join('\n') + '\n');
}

function main() {
  const update = process.argv.includes('--update');
  const { all, totalCatches } = collectFindings();

  if (update) {
    writeAllowlist(all);
    const n = new Set(all.map((f) => f.key)).size;
    console.log(`[UNDISCRIMINATING-CATCH] --update: wrote ${n} content-keyed allowlist entries from ${all.length} findings`);
    process.exit(0);
  }

  const allowlist = loadAllowlist();
  const undiscriminating = all.filter((f) => !allowlist.has(f.key));

  if (undiscriminating.length > 0) {
    console.error('');
    console.error(`[UNDISCRIMINATING-CATCH] Found ${undiscriminating.length} catch(s) that swallow without discriminating:`);
    for (const u of undiscriminating) {
      console.error(`[UNDISCRIMINATING-CATCH] ${u.file}:${u.line}  ${u.headline}`);
    }
    console.error('');
    console.error("[UNDISCRIMINATING-CATCH] These `catch` blocks have a comment-only body — no");
    console.error('[UNDISCRIMINATING-CATCH] rethrow, no log, no conditional discrimination, no');
    console.error('[UNDISCRIMINATING-CATCH] sentinel return. The comment documents intent but');
    console.error('[UNDISCRIMINATING-CATCH] does not surface or filter the runtime error — every');
    console.error('[UNDISCRIMINATING-CATCH] error type gets swallowed uniformly. This is the');
    console.error('[UNDISCRIMINATING-CATCH] failure mode that swallowed the ESM-vs-CJS error in');
    console.error("[UNDISCRIMINATING-CATCH] the 2026-05-19 TrainingPipeline regression.");
    console.error('');
    console.error('[UNDISCRIMINATING-CATCH] Either:');
    console.error('[UNDISCRIMINATING-CATCH]   1. Add a rethrow on unexpected error types:');
    console.error("[UNDISCRIMINATING-CATCH]      `} catch (e) { if (e.code !== 'EXPECTED') throw e; /* expected */ }`,");
    console.error('[UNDISCRIMINATING-CATCH]   2. Add a log: `} catch (e) { logger.warn(\'reason\', e); }`, or');
    console.error('[UNDISCRIMINATING-CATCH]   3. Allowlist the exact content key(s) below in');
    console.error('[UNDISCRIMINATING-CATCH]      lib/undiscriminating-catches-allowlist.txt (with rationale),');
    console.error('[UNDISCRIMINATING-CATCH]      or run `node scripts/check-undiscriminating-catches.mjs --update`:');
    for (const u of undiscriminating) {
      console.error(`[UNDISCRIMINATING-CATCH]      ${u.key}`);
    }
    process.exit(1);
  }

  console.log(`[UNDISCRIMINATING-CATCH] OK: ${totalCatches} catch block(s) scanned, all discriminate or are allowlisted`);
  process.exit(0);
}

main();
