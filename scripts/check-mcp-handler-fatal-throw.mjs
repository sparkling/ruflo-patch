#!/usr/bin/env node
// scripts/check-mcp-handler-fatal-throw.mjs — advisory-first MCP-envelope
// honesty lint per ADR-0242 §Decision scope #4.
//
// Targets `forks/ruflo/v3/@claude-flow/cli/src/mcp-tools/*.ts` handlers
// that catch-and-return `{success: false, error: ...}` or `{available:
// false, error: ...}` envelopes for FATAL errors instead of throwing.
// Per ADR-0242 §"MCP-handler arch-test: fatals must throw", the rule
// fires on the narrow shape:
//
//   try { ... } catch (e) { return { success: false, ... }; }
//                              // no `instanceof X` discriminator
//                              // no `if (e.code === ...)` discriminator
//                              // no rethrow path
//
// What it flags (per-file count, not per-handler — handler discovery
// would require AST parsing; this is the file-level signal):
//   - `catch (...) { return { success: false, ... }; }`
//   - `catch (...) { return { available: false, ... }; }`
//   - (without an `instanceof` / `.code ===` / `.name ===` discriminator
//      in the same catch block)
//
// What it does NOT flag:
//   - Discriminated catches (e.g.
//     `catch (e) { if (e instanceof OptionalModuleNotFound) return {…}; throw e; }`)
//   - Rethrows
//   - Successful returns
//
// Per ADR-0242 §Decision scope: this is the CULTURAL signal, not a
// blocking gate. Exits 0 advisory-first; the existing ~56 sites are
// grandfathered; new handlers must throw on fatal by default.
//
// Allowlist content-keyed per ADR-0242 §Improvements #2: keyed on
// `<relpath> :: <whitespace-collapsed catch-block signature>` so the
// entry survives line shifts.
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
const ALLOWLIST_FILE = join(PROJECT_DIR, 'lib', 'mcp-handler-fatal-throw-allowlist.txt');

// Scope: ONLY mcp-tools/*.ts in the cli package. Per ADR-0242 §Decision
// scope #4, the rule is decidable only at the MCP handler boundary.
const SCAN_ROOTS = [
  { fork: 'ruflo', root: '/Users/henrik/source/forks/ruflo/v3/@claude-flow/cli/src/mcp-tools' },
];

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

function* walkFiles(rootDir) {
  if (!existsSync(rootDir)) return;
  const entries = readdirSync(rootDir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (SKIP_FILE_RE.test(e.name)) continue;
    if (!/\.ts$/.test(e.name)) continue;
    yield join(rootDir, e.name);
  }
}

// Strip strings + comments preserving newlines (same shape as siblings).
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

// Locate `catch` clauses in real code, return their body span + body text.
// Same brace-counting state machine as check-undiscriminating-catches.mjs.
function findCatchBlocks(src) {
  const stripped = stripStringsAndComments(src);
  const out = [];
  let i = 0;
  while (i < src.length) {
    const idx = src.indexOf('catch', i);
    if (idx === -1) break;
    i = idx + 5;
    if (idx > 0 && /[a-zA-Z0-9_$]/.test(src[idx - 1])) continue;
    if (idx + 5 < src.length && /[a-zA-Z0-9_$]/.test(src[idx + 5])) continue;
    // Skip in-string/comment catches.
    const lineNum = src.slice(0, idx).split('\n').length;
    const strippedLine = stripped.split('\n')[lineNum - 1] ?? '';
    if (!/\bcatch\b/.test(strippedLine)) continue;

    let j = idx + 5;
    while (j < src.length && /\s/.test(src[j])) j++;
    if (src[j] === '(') {
      let depth = 1; j++;
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

    let depth = 1, k = bodyStart;
    let inStr = null, blockC = false, lineC = false;
    while (k < src.length && depth > 0) {
      const c = src[k], nx = src[k + 1];
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
      else if (c === '}') { depth--; if (depth === 0) break; }
      k++;
    }
    if (depth !== 0) continue;
    const bodyEnd = k;
    out.push({ line: lineNum, body: src.slice(bodyStart, bodyEnd), clauseStart: idx, bodyEnd });
    i = bodyEnd + 1;
  }
  return out;
}

// Decision predicate for "swallows fatal into envelope without
// discriminator". Conservative — only fires on the load-bearing
// narrow shape per ADR-0242 §Decision scope #4.
function isFatalSwallow(body) {
  const stripped = stripStringsAndComments(body);
  // Must return success:false or available:false
  const returnsEnvelope = /return\s*\{[^}]*\b(success|available)\s*:\s*false\b/.test(stripped);
  if (!returnsEnvelope) return false;
  // Must NOT have an instanceof / .code === / .name === discriminator
  const hasDiscriminator = /\binstanceof\b|\.code\s*===|\.name\s*===|\.code\s*==\s*['"]|\.name\s*==\s*['"]/.test(stripped);
  if (hasDiscriminator) return false;
  // Must NOT rethrow inside the same catch body
  const hasRethrow = /\bthrow\b/.test(stripped);
  if (hasRethrow) return false;
  return true;
}

function collectFindings() {
  const all = [];
  let totalCatches = 0;
  for (const { fork, root } of SCAN_ROOTS) {
    if (!existsSync(root)) {
      console.error(`[MCP-HANDLER-FATAL-THROW] WARN: scan root missing: ${root} (${fork}) — skipping`);
      continue;
    }
    for (const f of walkFiles(root)) {
      const src = readFileSync(f, 'utf8');
      if (!/\bcatch\b/.test(src)) continue;
      const rel = relative(PROJECT_DIR, f);
      const catches = findCatchBlocks(src);
      totalCatches += catches.length;
      for (const c of catches) {
        if (!isFatalSwallow(c.body)) continue;
        // Content key: file + whitespace-collapsed catch clause (incl. body).
        const clauseText = src.slice(c.clauseStart, c.bodyEnd + 1).replace(/\s+/g, ' ').trim();
        // Cap key length to keep allowlist readable.
        const sig = clauseText.length > 220 ? clauseText.slice(0, 220) + '…' : clauseText;
        all.push({
          file: rel,
          line: c.line,
          headline: src.split('\n')[c.line - 1].trim().slice(0, 100),
          key: `${rel} :: ${sig}`,
        });
      }
    }
  }
  return { all, totalCatches };
}

function writeAllowlist(findings) {
  const keys = [...new Set(findings.map((f) => f.key))].sort();
  const header =
    '# scripts/check-mcp-handler-fatal-throw.mjs allowlist (ADR-0242 §Decision scope #4)\n' +
    '#\n' +
    '# Format: `<relative-path> :: <whitespace-collapsed catch clause>` (one per line).\n' +
    '# CONTENT-KEYED (not line-keyed): an entry is matched by the catch clause text\n' +
    '# itself, so it survives line shifts. An entry goes stale only when THAT catch\n' +
    "# body's own code changes — re-review then.\n" +
    '#\n' +
    "# Grandfather baseline per ADR-0242: the ~56 existing MCP handlers that\n" +
    "# `catch (e) { return { success: false, error: sanitizeError(e) } }` for\n" +
    "# unfiltered errors are pre-existing cultural debt. New handlers should let\n" +
    "# fatals propagate (`throw wrapError(e, RufloErrorCode.X)`) so mcp-server.ts\n" +
    "# emits a proper JSON-RPC -32603 error frame instead of a flattened envelope.\n" +
    '#\n' +
    "# Discriminated catches are NOT flagged (e.g. `catch (e) { if (e instanceof\n" +
    "# OptionalModuleNotFound) return {…}; throw e; }`) — they correctly\n" +
    "# distinguish expected vs fatal.\n" +
    '#\n' +
    "# Regenerate after deliberate changes:\n" +
    '#   node scripts/check-mcp-handler-fatal-throw.mjs --update\n' +
    '#\n';
  writeFileSync(ALLOWLIST_FILE, header + keys.join('\n') + '\n');
}

function main() {
  const update = process.argv.includes('--update');
  const { all, totalCatches } = collectFindings();

  if (update) {
    writeAllowlist(all);
    const n = new Set(all.map((f) => f.key)).size;
    console.log(`[MCP-HANDLER-FATAL-THROW] --update: wrote ${n} content-keyed allowlist entries from ${all.length} findings`);
    process.exit(0);
  }

  const allowlist = loadAllowlist();
  const newSites = all.filter((f) => !allowlist.has(f.key));

  // ADVISORY-FIRST: exit 0 regardless. Baseline visibility only.
  console.log(`[MCP-HANDLER-FATAL-THROW] ADVISORY (ADR-0242 §Decision scope #4): scanned ${totalCatches} catch block(s) in cli/src/mcp-tools/`);
  console.log(`[MCP-HANDLER-FATAL-THROW]   ├ ${all.length} fatal-swallow handler(s) found (return {success:false} without discriminator)`);
  console.log(`[MCP-HANDLER-FATAL-THROW]   ├ ${allowlist.size} grandfathered (lib/mcp-handler-fatal-throw-allowlist.txt)`);
  console.log(`[MCP-HANDLER-FATAL-THROW]   └ ${newSites.length} not in allowlist (delta from baseline)`);
  if (newSites.length > 0 && newSites.length <= 20) {
    console.log(`[MCP-HANDLER-FATAL-THROW] New sites (preview):`);
    for (const s of newSites.slice(0, 20)) {
      console.log(`[MCP-HANDLER-FATAL-THROW]   ${s.file}:${s.line}  ${s.headline}`);
    }
  } else if (newSites.length > 20) {
    console.log(`[MCP-HANDLER-FATAL-THROW] ${newSites.length} new sites — run --update to refresh baseline (advisory phase).`);
  }
  console.log(`[MCP-HANDLER-FATAL-THROW] Prefer: throw wrapError(e, RufloErrorCode.X)  // mcp-server.ts emits JSON-RPC -32603`);
  console.log(`[MCP-HANDLER-FATAL-THROW]    or: catch (e) { if (e instanceof OptionalModuleNotFound) return {…}; throw e; }  // discriminate`);
  // Promotion to exit 1 deferred per ADR-0242 §Decision scope #4 — requires baseline=0 + empirical FP=0.
  process.exit(0);
}

main();
