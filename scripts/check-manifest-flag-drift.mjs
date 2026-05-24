#!/usr/bin/env node
// scripts/check-manifest-flag-drift.mjs — ADR-0208 Option D′ Step 1.
//
// Manifest-vs-CLI parity lint. Catches the audit pattern: hook manifests
// passing flags or subcommands the CLI never declares (silently dropped
// today; this lint surfaces them at build time).
//
// Inputs:
//   1. Three hooks manifests in forks/ruflo:
//      - .claude-plugin/hooks/hooks.json  (invokes @sparkleideas/cli)
//      - plugin/hooks/hooks.json          (invokes upstream claude-flow@alpha)
//      - plugins/ruflo-core/hooks/hooks.json (also upstream)
//   2. Shipped docs: forks/ruflo/.claude/commands/hooks/*.md
//   3. Declared command tree extracted from
//      forks/ruflo/v3/@claude-flow/cli/src/commands/hooks.ts
//   4. Global flags from
//      forks/ruflo/v3/@claude-flow/cli/src/parser.ts:42-112
//
// Exit codes:
//   0 — every flag/subcommand in manifests/docs resolves to a declared
//       handler option or subcommand (or is a known global / globally
//       allowlisted token)
//   1 — at least one drift
//   2 — sources unavailable (the forks/ruflo paths above don't exist —
//       informational, not a failure of this script)
//
// Phase 1 (this session) limitations — documented up-front:
//
//   - Source-of-truth is extracted via targeted regex over hooks.ts, NOT
//     the resolved command tree. ADR-0208 calls out four alias commands at
//     hooks.ts:4497/4516/4548/4557 that build `options` by reference/spread
//     — those are NOT yet covered by this lint. Their declared options
//     resolve transitively at runtime but not statically here. This is a
//     known false-positive class: if the lint flags a flag that's
//     actually declared via spread, add it to the embedded allowlist
//     below until the AST/dist-resolution upgrade lands (Phase 2).
//   - Subcommand depth: walks `name: '<x>'` literals; does not follow
//     nested `subcommands:` arrays. Sufficient for the current hooks.ts
//     shape but limits transferability.
//
// No external deps; Node 20+ only.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_DIR = resolve(__dirname, '..');

const FORK_RUFLO = '/Users/henrik/source/forks/ruflo';
const MANIFESTS = [
  { label: '.claude-plugin/hooks/hooks.json (fork CLI)', path: join(FORK_RUFLO, '.claude-plugin/hooks/hooks.json') },
  { label: 'plugin/hooks/hooks.json (upstream)', path: join(FORK_RUFLO, 'plugin/hooks/hooks.json') },
  { label: 'plugins/ruflo-core/hooks/hooks.json (upstream)', path: join(FORK_RUFLO, 'plugins/ruflo-core/hooks/hooks.json') },
];
const SHIPPED_DOCS_DIR = join(FORK_RUFLO, '.claude/commands/hooks');
const HOOKS_TS = join(FORK_RUFLO, 'v3/@claude-flow/cli/src/commands/hooks.ts');
const PARSER_TS = join(FORK_RUFLO, 'v3/@claude-flow/cli/src/parser.ts');

// Tokens we never want this lint to flag (globals + intentional exceptions).
// Phase 2 should move these into the resolved command tree.
const KNOWN_GLOBALS = new Set([
  'help', 'h',
  'version', 'V',
  'verbose', 'v',
  'quiet', 'q',
  'config', 'c',
  'format', 'f',
  'no-color',
  'interactive', 'i',
  'non-interactive',
  'output', 'o',
  'debug',
]);

// Short flags that are bash predicates / file-test operators, never CLI args.
// Source: `man bash` § "CONDITIONAL EXPRESSIONS". Manifests use `[ -z "$X" ]`,
// `[ -e file ]` etc. — these are not CLI flags to validate.
const BASH_SHORT_PREDICATES = new Set([
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'k', 'n', 'o', 'p', 'r', 's', 't',
  'u', 'w', 'x', 'L', 'O', 'G', 'N', 'S', 'z',
]);

function loadJsonOrNull(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    console.error(`[lint] failed to parse ${path}: ${err.message}`);
    return null;
  }
}

// Walk a JSON value and extract every string-typed `command` field's value.
function extractCommandStrings(json, sink) {
  if (json == null) return;
  if (typeof json === 'object') {
    if (Array.isArray(json)) {
      for (const item of json) extractCommandStrings(item, sink);
    } else {
      for (const [k, v] of Object.entries(json)) {
        if (k === 'command' && typeof v === 'string') sink.push(v);
        else extractCommandStrings(v, sink);
      }
    }
  }
}

// From a `command` string, tokenize:
//   - hooks <subcommand>             → subcommand
//   - --<long-flag>[=value]          → flag
//   - -<x>                           → short flag (single char)
// Skip values (anything that doesn't start with `-`) after the first
// non-hooks-subcommand token has been consumed.
function tokenizeCommand(cmd) {
  const tokens = { subcommands: [], flags: [], shortFlags: [] };
  const parts = cmd.split(/\s+/).filter(Boolean);
  let i = 0;
  // Strip an initial `bash -c '<cmd>'` wrapper if present.
  if (parts[0] === 'bash' && parts[1] === '-c') i = 2;
  // Strip leading interpreter / package invocations.
  const SKIP = new Set(['npx', 'node', 'npm', 'pnpm', 'bun', '--yes', '-y']);
  const PKG_SKIP_RE = /^(@?[^/-][^@]*?)(?:@[^/]+)?$/;
  // Skip until we see `hooks` or fall off the end.
  let sawHooks = false;
  for (; i < parts.length; i++) {
    const p = parts[i];
    if (SKIP.has(p)) continue;
    if (p.startsWith('@')) continue; // scoped pkg refs like @sparkleideas/cli
    if (p === 'claude-flow@alpha' || p === '@sparkleideas/cli' || p === 'ruflo') continue;
    if (p === 'hooks') { sawHooks = true; i++; break; }
    // Bash subshell artefacts
    if (p === '||' || p === '&&' || p === ';' || p === '|') continue;
  }
  if (!sawHooks) return tokens;
  // First non-flag token after `hooks` is the subcommand.
  let subcommandConsumed = false;
  let prevTokenWasFlag = false;
  for (; i < parts.length; i++) {
    const p = parts[i];
    // Bash subshell artefacts terminate the command.
    if (p === '||' || p === '&&' || p === ';' || p === '|') break;
    if (p.startsWith('--')) {
      const flagName = p.slice(2).split('=')[0];
      tokens.flags.push(flagName);
      prevTokenWasFlag = !p.includes('=');
      continue;
    }
    if (p.startsWith('-') && p.length === 2) {
      tokens.shortFlags.push(p.slice(1));
      prevTokenWasFlag = true;
      continue;
    }
    // Non-flag token.
    if (!subcommandConsumed) {
      tokens.subcommands.push(p);
      subcommandConsumed = true;
      prevTokenWasFlag = false;
      continue;
    }
    // Otherwise it's a value (e.g. the value of the previous flag); skip.
    prevTokenWasFlag = false;
  }
  return tokens;
}

// Phase 2: dynamic-import the published @sparkleideas/cli/dist/src/commands/hooks.js
// and walk the resolved hooksCommand tree to depth 2. This is the canonical
// source-of-truth: it captures alias/spread options (hooks.ts:4497/4516/4548/4557)
// and nested subcommands (transfer[store,from-project], worker[list,dispatch,...])
// that the Phase 1 regex cannot see.
async function extractDeclaredFromCompiledTree() {
  let mod;
  try {
    mod = await import('@sparkleideas/cli/dist/src/commands/hooks.js');
  } catch (err) {
    return null; // fall through to Phase 1
  }
  const root = mod.hooksCommand || mod.default?.hooksCommand;
  if (!root || !Array.isArray(root.subcommands)) return null;

  const declared = new Set();
  declared.add(root.name); // 'hooks'
  // Walk to depth 2: each subcommand + any nested subcommands + options of each.
  function visit(node, depth) {
    if (!node || typeof node !== 'object') return;
    if (typeof node.name === 'string') declared.add(node.name);
    if (Array.isArray(node.options)) {
      for (const opt of node.options) {
        if (opt && typeof opt.name === 'string') declared.add(opt.name);
        // Short aliases (e.g. -f) — capture too.
        if (opt && typeof opt.alias === 'string') declared.add(opt.alias);
      }
    }
    if (depth > 0 && Array.isArray(node.subcommands)) {
      for (const sub of node.subcommands) visit(sub, depth - 1);
    }
  }
  // Depth 2 from the root: visit each top-level hooks subcommand AND walk its
  // own nested subcommands (transfer/worker etc.) one level deeper.
  for (const sub of root.subcommands) visit(sub, 2);
  return declared;
}

// Phase 1 fallback: targeted regex extraction of declared subcommand + option
// names from hooks.ts. Each subcommand is an object literal: `{ name: '<n>',
// options: [...] }`. Used when @sparkleideas/cli is not installed.
function extractDeclaredFromHooksTs() {
  if (!existsSync(HOOKS_TS)) return null;
  const src = readFileSync(HOOKS_TS, 'utf8');
  const declared = new Set();
  for (const m of src.matchAll(/\bname:\s*'([a-z][a-z0-9-]*)'/g)) {
    declared.add(m[1]);
  }
  // Also collect `name: "<n>"` (double-quoted variant).
  for (const m of src.matchAll(/\bname:\s*"([a-z][a-z0-9-]*)"/g)) {
    declared.add(m[1]);
  }
  return declared;
}

// Globals from parser.ts (the `:42-112` global flag block per ADR-0208).
function extractGlobalsFromParserTs() {
  if (!existsSync(PARSER_TS)) return KNOWN_GLOBALS;
  const src = readFileSync(PARSER_TS, 'utf8');
  const globals = new Set(KNOWN_GLOBALS);
  // Globals are declared in CommandParser's knownFlags init block.
  // Pattern: `'<flag-name>'` inside the globals array.
  // Conservative: union our hard-coded KNOWN_GLOBALS with anything else
  // that looks like a flag declaration in parser.ts.
  for (const m of src.matchAll(/['"`](--?[a-z][a-z0-9-]*)['"`]/g)) {
    const tok = m[1].replace(/^-+/, '');
    if (tok.length === 1 || tok.length > 1) globals.add(tok);
  }
  return globals;
}

function extractDocFlagTokens() {
  if (!existsSync(SHIPPED_DOCS_DIR)) return [];
  const docs = [];
  for (const file of readdirSync(SHIPPED_DOCS_DIR)) {
    if (!file.endsWith('.md')) continue;
    const path = join(SHIPPED_DOCS_DIR, file);
    const src = readFileSync(path, 'utf8');
    // Find every `--<flag>` token in fenced code blocks (where commands live).
    // Naive: match anywhere; this over-collects, but for a drift lint
    // over-collection is the safe direction.
    const flags = new Set();
    for (const m of src.matchAll(/--([a-z][a-z0-9-]+)/g)) {
      flags.add(m[1]);
    }
    docs.push({ file, flags });
  }
  return docs;
}

async function main() {
  if (!existsSync(FORK_RUFLO)) {
    console.error(`[lint] fork path missing: ${FORK_RUFLO} — exiting 2 (informational)`);
    process.exit(2);
  }

  // Phase 2: try dynamic-import of the published cli's compiled command tree.
  // Phase 1 fallback: regex over hooks.ts source.
  let declared = await extractDeclaredFromCompiledTree();
  let mode = 'phase2-compiled-tree';
  if (declared == null) {
    declared = extractDeclaredFromHooksTs();
    mode = 'phase1-regex-fallback';
  }
  if (declared == null) {
    console.error(`[lint] no source available: @sparkleideas/cli not installed AND hooks.ts not found at ${HOOKS_TS} — exiting 2 (informational)`);
    process.exit(2);
  }
  if (process.env.LINT_DEBUG) {
    console.error(`[lint] mode=${mode}, declared set size=${declared.size}`);
  }
  const globals = extractGlobalsFromParserTs();

  const drifts = [];

  // Manifest token check.
  for (const { label, path } of MANIFESTS) {
    const json = loadJsonOrNull(path);
    if (json == null) {
      console.error(`[lint] manifest missing or unreadable: ${label}`);
      continue;
    }
    const commands = [];
    extractCommandStrings(json, commands);
    for (const cmd of commands) {
      const tokens = tokenizeCommand(cmd);
      for (const sub of tokens.subcommands) {
        if (!declared.has(sub)) {
          drifts.push({ kind: 'undefined-subcommand', source: label, token: sub, context: cmd });
        }
      }
      for (const f of tokens.flags) {
        if (!declared.has(f) && !globals.has(f)) {
          drifts.push({ kind: 'undeclared-flag', source: label, token: f, context: cmd });
        }
      }
      for (const sf of tokens.shortFlags) {
        // Skip bash predicate shorts (they appear in [ -z $X ] style tests).
        if (BASH_SHORT_PREDICATES.has(sf)) continue;
        if (!globals.has(sf)) {
          drifts.push({ kind: 'undeclared-short-flag', source: label, token: sf, context: cmd });
        }
      }
    }
  }

  // Shipped doc flag check.
  const docs = extractDocFlagTokens();
  for (const { file, flags } of docs) {
    for (const f of flags) {
      // Skip flags that look like CLI examples for non-hooks tools.
      // The lint is hooks-scoped per ADR-0208.
      if (!declared.has(f) && !globals.has(f)) {
        drifts.push({ kind: 'undeclared-flag-in-doc', source: `.claude/commands/hooks/${file}`, token: f, context: '' });
      }
    }
  }

  // Report.
  if (drifts.length === 0) {
    console.log('[lint] OK — every manifest/doc flag and subcommand resolves to a declaration');
    process.exit(0);
  }

  console.error(`[lint] FAIL — ${drifts.length} drift(s) found:\n`);
  const byKind = new Map();
  for (const d of drifts) {
    if (!byKind.has(d.kind)) byKind.set(d.kind, []);
    byKind.get(d.kind).push(d);
  }
  for (const [kind, items] of byKind) {
    console.error(`  ${kind} (${items.length}):`);
    for (const d of items) {
      const prefix = kind === 'undefined-subcommand' ? '' : (kind === 'undeclared-short-flag' ? '-' : '--');
      console.error(`    ${prefix}${d.token}    in: ${d.source}`);
      if (d.context) console.error(`        context: ${d.context.slice(0, 120)}${d.context.length > 120 ? '...' : ''}`);
    }
    console.error('');
  }
  console.error(`[lint] Phase 1 limitations: declared-set extracted via regex from hooks.ts;`);
  console.error(`[lint] false positives from spread/reference alias options may occur (ADR-0208`);
  console.error(`[lint] step 1 known-limitation). Add real declarations to hooks.ts to fix.`);
  process.exit(1);
}

main();
