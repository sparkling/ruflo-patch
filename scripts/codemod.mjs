#!/usr/bin/env node
/**
 * Scope-rename codemod for the ruflo build pipeline.
 *
 * Transforms a cloned upstream source tree, renaming all @claude-flow/*
 * references to @sparkleideas/* and handling unscoped package mappings.
 *
 * See ADR-0013 (codemod-implementation), ADR-0006 (npm-scope-naming),
 * and ADR-0027 (fork migration — wildcard replacement removed).
 *
 * Usage:
 *   node scripts/codemod.mjs /path/to/temp-dir
 *
 * Or import as a module:
 *   import { transform } from './scripts/codemod.mjs';
 *   const stats = await transform('/path/to/temp-dir');
 */

import { readdir, readFile, writeFile, stat, unlink } from 'node:fs/promises';
import { join, extname, basename, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// -- Package mapping (inline; switchable to config/package-map.json) ----------

const SCOPED_PREFIX_FROM = '@claude-flow/';
const SCOPED_PREFIX_TO = '@sparkleideas/';

// RuVector scope: @ruvector/foo -> @sparkleideas/ruvector-foo
const RUVECTOR_PREFIX_FROM = '@ruvector/';
const RUVECTOR_PREFIX_TO = '@sparkleideas/ruvector-';

/** Unscoped exact-name mappings (used in package.json name/dep key transforms).
 *
 * Exported for ADR-0113 Fix 3 (preflight-discover.mjs) so the auto-discovery
 * walker can use the same single source of truth for "is this name in scope?".
 */
export const UNSCOPED_MAP = {
  'claude-flow': '@sparkleideas/claude-flow',
  'ruflo': '@sparkleideas/ruflo',
  'agentdb': '@sparkleideas/agentdb',
  'agentic-flow': '@sparkleideas/agentic-flow',
  'ruv-swarm': '@sparkleideas/ruv-swarm',
  // ADR-0022: new unscoped packages
  'agent-booster': '@sparkleideas/agent-booster',
  'agentdb-onnx': '@sparkleideas/agentdb-onnx',
  'cuda-wasm': '@sparkleideas/cuda-wasm',
  'ruvector': '@sparkleideas/ruvector',
  // ADR-0150 follow-up: agentic-jujutsu (AI-native VCS) — pipeline now builds
  // + bundles its darwin-arm64 .node binary via napi-rebuild.sh +
  // bundle-native-binaries.sh multi-fork support. Codemod renames the package
  // so it publishes to Verdaccio as @sparkleideas/agentic-jujutsu.
  'agentic-jujutsu': '@sparkleideas/agentic-jujutsu',
  // RuVector unscoped platform packages
  'ruvector-core-darwin-arm64': '@sparkleideas/ruvector-core-darwin-arm64',
  'ruvector-core-darwin-x64': '@sparkleideas/ruvector-core-darwin-x64',
  'ruvector-core-linux-x64-gnu': '@sparkleideas/ruvector-core-linux-x64-gnu',
  'ruvector-core-linux-arm64-gnu': '@sparkleideas/ruvector-core-linux-arm64-gnu',
  'ruvector-core-win32-x64-msvc': '@sparkleideas/ruvector-core-win32-x64-msvc',
  // RuVector WASM packages (wasm-pack generates unscoped names)
  'ruvector-attention-wasm': '@sparkleideas/ruvector-attention-wasm',
  'ruvector-attention-unified-wasm': '@sparkleideas/ruvector-attention-unified-wasm',
  // wasm-pack output for `forks/ruvector/{crates,npm/packages}/ruvllm-wasm/`
  // — name field is unscoped `ruvllm-wasm`. LEVELS lists this under the
  // ruvector- prefix; preflight-discover reads UNSCOPED_MAP as the in-scope
  // signal, so register the mapping here.
  'ruvllm-wasm': '@sparkleideas/ruvector-ruvllm-wasm',
};

// -- File filters -------------------------------------------------------------

const ALLOWED_EXTENSIONS = new Set([
  '.js', '.ts', '.mjs', '.cjs', '.json', '.d.ts', '.d.mts',
  // ADR-0113 Fix 2: process .md so plugin install instructions and
  // marketplace docs in `forks/ruflo/plugins/**/*.md` and
  // `forks/ruflo/.claude-plugin/**/*.md` get @claude-flow/ → @sparkleideas/
  // and mcp__claude-flow__* → mcp__ruflo__* rewrites.
  //
  // Drift-prevention follow-up (2026-05-04): Pass 4 (MCP_PREFIX_RE) also
  // covers init-bundled content under `forks/ruflo/.claude/**` — settings
  // (.json), agents/skills/commands docs (.md), and helper shell scripts
  // (.sh) — so upstream merges that re-introduce `mcp__claude-flow__*`
  // identifiers in those trees are corrected at codemod time. Locked in
  // by the `.claude/** drift-prevention` test cases in
  // tests/pipeline/codemod.test.mjs.
  '.md',
  // ADR-0117 follow-up (2026-05-04): process .sh so install.sh and
  // similar shell scripts get Pass 6 (npx ruflo@... → @sparkleideas/ruflo@...)
  // plus the existing scoped-rename passes. Passes 1/2/4 are no-ops on
  // typical shell content; Pass 3 (import-context) never matches there.
  // Also covers `.claude/helpers/*.sh` (e.g. setup-mcp.sh) so any
  // `mcp__claude-flow__*` references in shell helpers get Pass 4 rewrite.
  '.sh',
]);

const SKIP_DIRS = new Set(['.git', 'node_modules']);
const SKIP_FILE_PREFIXES = ['LICENSE'];
const DELETE_FILES = new Set(['pnpm-lock.yaml']);

/** Returns true if `name` starts with any skip prefix. */
function isSkippedFile(name) {
  return SKIP_FILE_PREFIXES.some((p) => name.startsWith(p));
}

/** Returns the effective extension, handling compound extensions like .d.ts. */
function effectiveExt(filename) {
  if (filename.endsWith('.d.ts')) return '.d.ts';
  if (filename.endsWith('.d.mts')) return '.d.mts';
  return extname(filename);
}

// -- Name mapping (for package.json keys) ------------------------------------

/**
 * Apply the name mapping to a single package name string.
 * Returns the mapped name, or the original if no mapping applies.
 */
function applyNameMapping(name) {
  if (name.startsWith('@sparkleideas/')) return name; // already transformed
  if (name.startsWith(SCOPED_PREFIX_FROM)) {
    return SCOPED_PREFIX_TO + name.slice(SCOPED_PREFIX_FROM.length);
  }
  if (name.startsWith(RUVECTOR_PREFIX_FROM)) {
    return RUVECTOR_PREFIX_TO + name.slice(RUVECTOR_PREFIX_FROM.length);
  }
  return UNSCOPED_MAP[name] ?? name;
}

// -- Phase 1: package.json transform ------------------------------------------

const DEP_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies', 'peerDependenciesMeta'];
// NOTE: `bin` is intentionally excluded. Bin keys are POSIX executable names
// (e.g., "ruflo", "claude-flow") — npm rejects `/` in them, so the UNSCOPED_MAP
// rewrite (`ruflo` → `@sparkleideas/ruflo`) produces an invalid bin entry.
// `exports` keys are subpath specifiers (".", "./services/*"), not package
// names, and do not intersect UNSCOPED_MAP; mapping them is a no-op, but we
// keep the pathway for future-proofing conditional exports that might match.
const KEY_RENAME_FIELDS = ['exports'];

/**
 * Transform a package.json object in place.
 * Returns true if any change was made.
 */
function transformPackageJsonObject(json) {
  let changed = false;

  // Transform "name"
  if (typeof json.name === 'string') {
    const mapped = applyNameMapping(json.name);
    if (mapped !== json.name) {
      json.name = mapped;
      changed = true;
    }
  }

  // Transform dependency maps (rename keys)
  for (const field of DEP_FIELDS) {
    if (json[field] && typeof json[field] === 'object') {
      changed = renameDependencyKeys(json[field]) || changed;
    }
  }

  // Transform bin and exports (rename keys that are package names)
  for (const field of KEY_RENAME_FIELDS) {
    if (json[field] && typeof json[field] === 'object') {
      changed = renameObjectKeys(json[field]) || changed;
    }
  }

  // ADR-0027: No wildcard replacement. Internal deps use exact -patch.N
  // versions set by fork-version.mjs in the fork package.json files.

  return changed;
}

/** Rename keys in a dependency-style object ({ "pkg-name": "^1.0" }). */
function renameDependencyKeys(obj) {
  let changed = false;
  for (const key of Object.keys(obj)) {
    const mapped = applyNameMapping(key);
    if (mapped !== key) {
      obj[mapped] = obj[key];
      delete obj[key];
      changed = true;
    }
  }
  return changed;
}

/** Rename keys in bin/exports objects where the key itself is a package name. */
function renameObjectKeys(obj) {
  let changed = false;
  for (const key of Object.keys(obj)) {
    const mapped = applyNameMapping(key);
    if (mapped !== key) {
      obj[mapped] = obj[key];
      delete obj[key];
      changed = true;
    }
    // Recurse into nested objects (exports can be deeply nested)
    if (obj[mapped ?? key] && typeof obj[mapped ?? key] === 'object') {
      changed = renameObjectKeys(obj[mapped ?? key]) || changed;
    }
  }
  return changed;
}

// -- Phase 2: Source file regex transform --------------------------------------

// Step 1: Scoped replacement -- @claude-flow/ -> @sparkleideas/
// Only match @claude-flow/ that is NOT already part of @sparkleideas/
const SCOPED_RE = /@claude-flow\//g;

// ADR-0113 Fix 2: MCP tool prefix rewrite. Plugin docs reference
// `mcp__claude-flow__*` tool names, but our MCP server registers as
// `name: 'ruflo'` so Claude Code namespaces tools as `mcp__ruflo__*`.
// The pattern's flanking `__` separators ensure we don't false-hit on log
// tags like `[claude-flow-mcp]` (no `mcp__` prefix) or scoped names like
// `@claude-flow/cli` (no trailing `__`).
//
// Phase C addendum: also match the literal-asterisk glob form
// `mcp__claude-flow__*` used in plugin docs ("valid `mcp__claude-flow__*`
// identifiers").
//
// Drift-prevention 2026-05-04: also match the permission-glob form
// `mcp__claude-flow__:*` used in `.claude/settings.json` permission
// allow/deny lists (Claude Code's "all tools from this server"
// shorthand). The capture group is `[a-zA-Z0-9_]+|\*|:\*` so all three
// forms (tool-name suffix, doc glob, permission glob) get rewritten.
const MCP_PREFIX_RE = /mcp__claude-flow__([a-zA-Z0-9_]+|\*|:\*)/g;

// ADR-0161 step 6: Pass 8 — MCP tool prefix migration for agentdb.
// Rewrites `mcp__agentic-flow__agentdb_<tool>` → `mcp__agentdb__<tool>`.
// New ruvnet/agentdb (post-extraction) registers its MCP server as
// `name: 'agentdb'` (verified at forks/agentdb/src/mcp/agentdb-mcp-server.ts:282)
// so Claude Code namespaces tools as `mcp__agentdb__*` rather than the
// previous `mcp__agentic-flow__agentdb_*` (when agentdb was vendored
// inside agentic-flow's MCP server).
//
// Pass numbering: this is Pass 8, NOT Pass 7 — Pass 7 is already taken by
// ADR-0143's `@sparkleideas/cli → @sparkleideas/ruflo` flip (line ~321).
//
// Coverage per Agent 06's audit (during the 15-agent council review):
// 23 references in *.md documentation across ruflo-patch + forks/agentic-flow;
// ZERO in production code. So this is essentially a documentation rewrite —
// zero runtime regression risk. Pass 8 also covers `:*` (permission glob) +
// `*` (doc glob) forms by capturing `[a-zA-Z0-9_]+|\*|:\*`.
//
// Order: Pass 8 runs AFTER Pass 4 in transformSource() — the prefixes don't
// overlap (`mcp__claude-flow__` vs `mcp__agentic-flow__agentdb_`) so order
// is for determinism, not correctness.
const MCP_AGENTDB_PREFIX_RE = /mcp__agentic-flow__agentdb_([a-zA-Z0-9_]+|\*|:\*)/g;

// Step 1b: RuVector scoped replacement -- @ruvector/ -> @sparkleideas/ruvector-
// Transforms @ruvector/core -> @sparkleideas/ruvector-core, etc.
const RUVECTOR_SCOPED_RE = /@ruvector\//g;

// Step 2: Unscoped import replacements -- rename bare unscoped package names
// ONLY inside import/require contexts (string literals following import/from/require).
// Bare names as variables, property keys, or object shorthand are NOT renamed.
//
// Matches these patterns (single or double quotes):
//   import('agentdb')          -> import('@sparkleideas/agentdb')
//   require('agentdb')         -> require('@sparkleideas/agentdb')
//   from 'agentdb'             -> from '@sparkleideas/agentdb'
//   import 'agentdb'           -> import '@sparkleideas/agentdb'
//   from "agentdb/embeddings"  -> from "@sparkleideas/agentdb/embeddings"

const UNSCOPED_IMPORT_NAMES = Object.keys(UNSCOPED_MAP);

// Build a single regex that matches unscoped names in import contexts.
// Lookbehind: import(, require(, from , import  — followed by quote + name
// The name must be at the start of the string literal (right after the quote).
const UNSCOPED_NAMES_RE = UNSCOPED_IMPORT_NAMES.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const UNSCOPED_IMPORT_RE = new RegExp(
  `((?:import|require)\\s*\\(\\s*['"]|(?:from|import)\\s+['"])(${UNSCOPED_NAMES_RE})(\\/|['"])`,
  'g'
);

// Pass 6 (ADR-0117 follow-up, 2026-05-04): rewrite unscoped `ruflo`
// references inside `npx`-style invocations to `@sparkleideas/ruflo`.
// Two surface forms are covered:
//
//   (a) Shell tokens — `npx [-y|--yes] ruflo[@<ver>] …`
//       Sites: scripts/install.sh, USERGUIDE.md/README.md/CLAUDE.md
//       prose, fork mcp-bridge JS args used as shell strings.
//
//   (b) JS args arrays — `command: "npx", args: [["-y"|"--yes",] "ruflo", …]`
//       Sites: forks/ruflo/ruflo/src/{,ruvocal/}mcp-bridge/index.js
//
// Why not path-scoped (unlike Pass 5): both regexes anchor on `npx` (or
// `command:"npx", args:[`), so false-hits in prose are effectively
// impossible — a literal `npx ruflo` in commentary IS a broken command
// that should be rewritten everywhere it ships.
//
// Why this matters: Verdaccio (and public npm) only host
// `@sparkleideas/ruflo`; bare `ruflo` 404s. The earlier ADR-0117 fix
// patched 6 TS files in fork source; this pass closes the long tail
// (legacy v2 mcp-bridge files, install.sh, all docs) durably so future
// upstream merges can't reintroduce the regression.
const NPX_RUFLO_RE = /(\bnpx(?:\s+(?:-y|--yes))*\s+)ruflo(?=[@\s])/g;
const NPX_ARGS_RUFLO_RE = /(command:\s*['"]npx['"],\s*args:\s*\[\s*(?:['"](?:-y|--yes)['"],\s*)*['"])ruflo(['"])/g;

// Pass 5 (ADR-0117 + ADR-0141 generalization 2026-05-04):
// rewrite unscoped `claude-flow@<ver>` references to the fork's
// `@sparkleideas/cli@latest`. Path-scoped to shipped/init-bundled
// trees so we don't false-hit upstream source comments or
// docs/adr/** prose.
//
// ADR-0141 broadened both axes:
//
//   Tag whitelist — was /claude-flow@alpha/g, now matches:
//     - dist-tags: alpha|latest|beta|next (whitelist; not [a-z]+ to
//       avoid false-hits on `claude-flow@example` in prose)
//     - numeric semver: [\d][\w.\-+]* (catches 1.5.13, 2.0.0-rc.1,
//       0.1.0+build, etc — leading-digit forbids @-namespaces)
//     - \b word boundaries — avoid mid-word like subclaude-flow@alpha
//
//   Path scope — adds **/.claude/{skills,agents,commands}/** which
//   covers fork-root .claude/ duplicates AND sister mcp workspace
//   v3/@claude-flow/mcp/.claude/...
//
// Scope (post-ADR-0141):
//   Includes:
//     - .claude-plugin/**, plugins/**
//     - v3/@claude-flow/cli/.claude/{agents,commands,skills}/** (init-bundled)
//     - **/.claude/{skills,agents,commands}/** (fork-root + mcp sister + future ws)
//   Hard excludes (apply first):
//     - docs/adr/** (historical accuracy — ADR-0117 negative test)
//     - v3/implementation/adrs/**
//
// Applied separately from transformSource because path scoping requires
// the file's relative path.
//
// Chained interaction with Pass 7 (ADR-0143): on user-facing surfaces
// (which are subset of Pass 5 scope), Pass 5 produces
// `@sparkleideas/cli@latest`, then Pass 7 promotes that to
// `@sparkleideas/ruflo@latest`. Final user-facing form is wrapper brand.
const CLAUDE_FLOW_VERSIONED_RE = /\bclaude-flow@(?:alpha|latest|beta|next|[\d][\w.\-+]*)\b/g;
const PASS5_REPLACEMENT = '@sparkleideas/cli@latest';

const PASS5_INIT_BUNDLED_PREFIX = 'v3/@claude-flow/cli/.claude/';
const PASS5_INIT_BUNDLED_SUBDIRS = ['agents/', 'commands/', 'skills/'];
// ADR-0141: any path containing /.claude/{skills,agents,commands}/
// regardless of which workspace it lives in.
const PASS5_CLAUDE_DOT_SUBDIRS = ['.claude/skills/', '.claude/agents/', '.claude/commands/'];

// Pass 7 (ADR-0143, 2026-05-04): user-facing brand flip
//   @sparkleideas/cli → @sparkleideas/ruflo
//
// Path-scoped — only fires in user-facing scopes:
//   - README.md, USERGUIDE.md, CHANGELOG.md (anywhere)
//   - scripts/install.sh
//   - .claude/{skills,agents,commands}/** (templates copied to user .claude/)
//   - .claude-plugin/** (umbrella manifest)
//   - plugins/** (marketplace plugin docs)
//   - v3/@claude-flow/cli/src/init/** (init-time strings emitted to user)
//
// Explicitly NOT in scope:
//   - docs/adr/** + v3/implementation/adrs/** (historical accuracy)
//   - **/__tests__/** (cli's own tests probe internals)
//   - v3/@claude-flow/<workspace>/src/** EXCEPT cli/src/init/ (internal
//     cross-package code; the cli package itself isn't being renamed)
//
// Lookbehind/lookahead protect against false-hits on @sparkleideas/cli-foo
// or @sparkleideas/clinical (different packages — must not flip).
//
// MCP B2 decision: init's mcp-generator.ts emits `args: [..., "@sparkleideas/cli", ...]`
// for the .mcp.json server registration; Pass 7 flips that to "@sparkleideas/ruflo"
// so all invocations route through the wrapper (single canonical entry point).
// See ADR-0143 §Decision §"MCP config decision: B2".
const SPARKLEIDEAS_CLI_RE = /(?<![\w-])@sparkleideas\/cli(?![\w-])/g;
const PASS7_REPLACEMENT = '@sparkleideas/ruflo';

const PASS7_USER_FACING_SUBDIRS = [
  '.claude/skills/', '.claude/agents/', '.claude/commands/',
  '.claude-plugin/', 'plugins/',
];
const PASS7_INIT_EMITTING_PREFIX = 'v3/@claude-flow/cli/src/init/';
const PASS7_USER_DOC_FILES = new Set(['README.md', 'CHANGELOG.md', 'USERGUIDE.md']);

/**
 * Returns true if the file is in Pass-7 scope (user-facing surfaces).
 * Out-of-scope dirs (docs/adr/, internal cross-package src, __tests__/)
 * checked BEFORE in-scope dirs so explicit excludes win over generic includes.
 *
 * Exported for tests.
 */
export function isPlugin7Scope(filePath, tempDir) {
  const rel = relative(tempDir, filePath).replace(/\\/g, '/');
  if (rel.startsWith('..') || rel === '') return false;
  // Hard excludes (apply first so they win over generic includes)
  if (rel.startsWith('docs/adr/') || rel.includes('/docs/adr/')) return false;
  if (rel.startsWith('v3/implementation/adrs/')) return false;
  if (rel.includes('__tests__/')) return false;
  // Internal cross-package code: any v3/@claude-flow/<ws>/src/ EXCEPT cli/src/init/
  if (rel.startsWith('v3/@claude-flow/') && rel.includes('/src/') &&
      !rel.startsWith(PASS7_INIT_EMITTING_PREFIX)) return false;

  // Includes
  const base = basename(filePath);
  if (PASS7_USER_DOC_FILES.has(base)) return true;
  if (rel === 'scripts/install.sh') return true;
  if (rel.startsWith(PASS7_INIT_EMITTING_PREFIX)) return true;
  for (const sub of PASS7_USER_FACING_SUBDIRS) {
    if (rel.includes('/' + sub) || rel.startsWith(sub)) return true;
  }
  return false;
}

/** Apply Pass 7 — caller must scope-check via isPlugin7Scope first. */
export function applyPass7(content) {
  return content.replace(SPARKLEIDEAS_CLI_RE, PASS7_REPLACEMENT);
}

/**
 * Returns true if the file is in the Pass-5 scope.
 *
 * Includes (post-ADR-0141):
 *   - `.claude-plugin/...`, `plugins/...`
 *   - `v3/@claude-flow/cli/.claude/{agents,commands,skills}/...` (init-bundled)
 *   - any path containing `.claude/{skills,agents,commands}/...`
 *     (fork-root + sister mcp workspace + future workspace duplicates)
 *
 * Hard excludes (apply first so they win over generic includes):
 *   - `docs/adr/...` + `v3/implementation/adrs/...` (historical accuracy)
 *
 * Restricted to .json or .md extensions.
 *
 * Exported for tests.
 */
export function isPlugin5Scope(filePath, tempDir) {
  const rel = relative(tempDir, filePath).replace(/\\/g, '/');
  if (rel.startsWith('..') || rel === '') return false;
  const ext = effectiveExt(basename(filePath));
  if (ext !== '.json' && ext !== '.md') return false;
  // Hard excludes (ADR-0141): apply BEFORE any include check so a
  // hypothetical docs/adr/.claude/agents/foo.md doesn't sneak in.
  if (rel.startsWith('docs/adr/') || rel.includes('/docs/adr/')) return false;
  if (rel.startsWith('v3/implementation/adrs/')) return false;
  // Includes
  if (rel.startsWith('.claude-plugin/') || rel.startsWith('plugins/')) return true;
  if (rel.startsWith(PASS5_INIT_BUNDLED_PREFIX)) {
    const sub = rel.slice(PASS5_INIT_BUNDLED_PREFIX.length);
    if (PASS5_INIT_BUNDLED_SUBDIRS.some((d) => sub.startsWith(d))) return true;
  }
  // ADR-0141: any path containing /.claude/{skills,agents,commands}/
  for (const sub of PASS5_CLAUDE_DOT_SUBDIRS) {
    if (rel.includes('/' + sub) || rel.startsWith(sub)) return true;
  }
  return false;
}

/**
 * Apply scope renaming to source file content.
 *
 * Six passes (numbering reflects historical introduction order):
 *  1. @claude-flow/* -> @sparkleideas/* (all occurrences)
 *  2. @ruvector/* -> @sparkleideas/ruvector-* (all occurrences)
 *  3. Bare unscoped names in import/require/from contexts only
 *  4. mcp__claude-flow__* -> mcp__ruflo__* (ADR-0113 Fix 2)
 *  6. npx-context `ruflo` -> `@sparkleideas/ruflo` (shell + JS args forms)
 *
 * Pass 5 (claude-flow@alpha rewrite, ADR-0117) and Pass 7
 * (@sparkleideas/cli -> @sparkleideas/ruflo for user-facing surfaces,
 * ADR-0143) are path-scoped and live outside transformSource — applied
 * in processOneFile when isPlugin5Scope / isPlugin7Scope match.
 *
 * Exported for ADR-0113 Phase C (Fix 4) — applying codemod directly
 * to fork .md files (under forks/ruflo/plugins/ and
 * forks/ruflo/.claude-plugin/) without rerunning the full pipeline
 * copy-source step.
 */
export function transformSource(content) {
  // Pass 1: scoped prefix (@claude-flow/ -> @sparkleideas/)
  let result = content.replace(SCOPED_RE, SCOPED_PREFIX_TO);

  // Pass 2: ruvector scoped prefix (@ruvector/ -> @sparkleideas/ruvector-)
  result = result.replace(RUVECTOR_SCOPED_RE, RUVECTOR_PREFIX_TO);

  // Pass 3: unscoped names in import contexts
  result = result.replace(UNSCOPED_IMPORT_RE, (match, prefix, name, suffix) => {
    const mapped = UNSCOPED_MAP[name];
    if (!mapped) return match;
    return prefix + mapped + suffix;
  });

  // Pass 4 (ADR-0113 Fix 2): MCP tool prefix (mcp__claude-flow__* -> mcp__ruflo__*)
  //
  // Runs unconditionally on every allowed-extension file in the build tree
  // (.json/.md/.sh — see ALLOWED_EXTENSIONS). Coverage therefore includes
  // marketplace docs (`plugins/**`, `.claude-plugin/**`) AND the init-
  // bundled `.claude/**` tree (settings.json, agents/skills/commands .md,
  // helper .sh scripts). Drift-prevention contract: any future narrowing
  // of this scope must NOT exclude `.claude/**` — the
  // ".claude/** drift-prevention" tests in
  // tests/pipeline/codemod.test.mjs lock that in.
  result = result.replace(MCP_PREFIX_RE, 'mcp__ruflo__$1');

  // Pass 8 (ADR-0161 step 6): MCP tool prefix for agentdb after extraction
  //   mcp__agentic-flow__agentdb_<tool> -> mcp__agentdb__<tool>
  // Runs unconditionally on every allowed-extension file (same scope as Pass 4).
  // Order: AFTER Pass 4 to ensure determinism (no prefix overlap).
  result = result.replace(MCP_AGENTDB_PREFIX_RE, 'mcp__agentdb__$1');

  // Pass 6 (ADR-0117 follow-up): npx-context unscoped `ruflo` -> `@sparkleideas/ruflo`
  result = result.replace(NPX_RUFLO_RE, '$1@sparkleideas/ruflo');
  result = result.replace(NPX_ARGS_RUFLO_RE, '$1@sparkleideas/ruflo$2');

  return result;
}

/** Apply Pass 5 only — assumes the caller has already scope-checked. */
export function applyPass5(content) {
  return content.replace(CLAUDE_FLOW_VERSIONED_RE, PASS5_REPLACEMENT);
}

// -- File walker --------------------------------------------------------------

/** Recursively walk `dir`, yielding absolute file paths that pass the filter. */
async function* walkFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkFiles(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

// -- Main transform -----------------------------------------------------------

/** Compute SHA-256 of a string. */
function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

/** Process a single file. Returns { scanned, transformed, packageJson, deleted }. */
async function processOneFile(filePath, fileCache, tempDir) {
  const name = basename(filePath);
  const result = { scanned: 0, transformed: 0, packageJson: 0, deleted: null };

  if (DELETE_FILES.has(name)) {
    await unlink(filePath);
    result.deleted = filePath;
    return result;
  }

  if (isSkippedFile(name)) return result;

  const ext = effectiveExt(name);
  if (!ALLOWED_EXTENSIONS.has(ext)) return result;

  result.scanned = 1;
  const isPackageJson = name === 'package.json';

  if (isPackageJson) {
    result.packageJson = 1;
    const raw = await readFile(filePath, 'utf8');

    // ADR-0040: check per-file hash cache
    if (fileCache) {
      const contentHash = sha256(raw);
      if (fileCache.get(filePath) === contentHash) {
        result.cacheHit = true;
        fileCache.touch(filePath);
        return result;
      }
    }

    let json;
    try { json = JSON.parse(raw); } catch { return result; }
    const changed = transformPackageJsonObject(json);
    if (changed) {
      const trailing = raw.endsWith('\n') ? '\n' : '';
      const output = JSON.stringify(json, null, 2) + trailing;
      await writeFile(filePath, output, 'utf8');
      result.transformed = 1;
      if (fileCache) fileCache.set(filePath, sha256(output));
    } else {
      if (fileCache) fileCache.set(filePath, sha256(raw));
    }
  } else {
    const content = await readFile(filePath, 'utf8');

    // ADR-0040: check per-file hash cache
    if (fileCache) {
      const contentHash = sha256(content);
      if (fileCache.get(filePath) === contentHash) {
        result.cacheHit = true;
        fileCache.touch(filePath);
        return result;
      }
    }

    let transformed = transformSource(content);
    // Pass 5 (ADR-0117): scope-limited claude-flow@alpha rewrite
    if (tempDir && isPlugin5Scope(filePath, tempDir)) {
      transformed = applyPass5(transformed);
    }
    // Pass 7 (ADR-0143): scope-limited @sparkleideas/cli → @sparkleideas/ruflo
    // for user-facing surfaces (README/USERGUIDE/install.sh/init/.claude/etc)
    if (tempDir && isPlugin7Scope(filePath, tempDir)) {
      transformed = applyPass7(transformed);
    }
    if (transformed !== content) {
      await writeFile(filePath, transformed, 'utf8');
      result.transformed = 1;
      if (fileCache) fileCache.set(filePath, sha256(transformed));
    } else {
      if (fileCache) fileCache.set(filePath, sha256(content));
    }
  }

  return result;
}

// Batch size for parallel file I/O (saturate disk without fd exhaustion)
const BATCH_SIZE = 50;

// -- ADR-0040: Per-file hash cache --------------------------------------------

/** Simple file cache wrapper with self-invalidation. */
class FileCache {
  constructor(data) {
    this._entries = data?.entries ?? {};
    this._selfHash = data?._selfHash ?? '';
    this._touched = new Set();
  }

  get(path) { return this._entries[path]; }

  set(path, hash) {
    this._entries[path] = hash;
    this._touched.add(path);
  }

  touch(path) { this._touched.add(path); }

  /** Prune to only files seen this run and return serializable object. */
  serialize(selfHash) {
    const pruned = {};
    for (const path of this._touched) {
      if (this._entries[path]) pruned[path] = this._entries[path];
    }
    return { _selfHash: selfHash, entries: pruned };
  }
}

/** Load file cache, invalidating if codemod source has changed. */
async function loadFileCache(tempDir) {
  const cachePath = join(tempDir, '.codemod-file-cache.json');

  // Compute hash of codemod.mjs itself for self-invalidation
  const selfPath = fileURLToPath(import.meta.url);
  let selfHash = '';
  try {
    const selfSource = await readFile(selfPath, 'utf8');
    selfHash = sha256(selfSource);
  } catch { /* ignore — will invalidate cache */ }

  let data = null;
  try {
    const raw = await readFile(cachePath, 'utf8');
    data = JSON.parse(raw);
  } catch { /* no cache or corrupt — start fresh */ }

  // Invalidate if codemod source changed
  if (data && data._selfHash !== selfHash) {
    data = null;
  }

  return { cache: new FileCache(data), selfHash, cachePath };
}

/** Transform an entire directory tree in place. */
export async function transform(tempDir) {
  const dirStat = await stat(tempDir);
  if (!dirStat.isDirectory()) {
    throw new Error(`Not a directory: ${tempDir}`);
  }

  // ADR-0040: load per-file hash cache
  const { cache: fileCache, selfHash, cachePath } = await loadFileCache(tempDir);

  const stats = {
    filesScanned: 0,
    filesTransformed: 0,
    packageJsonProcessed: 0,
    cacheHits: 0,
    deletedFiles: [],
  };

  // Collect all file paths first (fast directory walk)
  const allFiles = [];
  for await (const filePath of walkFiles(tempDir)) {
    allFiles.push(filePath);
  }

  // Process files in parallel batches
  for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
    const batch = allFiles.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(f => processOneFile(f, fileCache, tempDir)));
    for (const r of results) {
      stats.filesScanned += r.scanned;
      stats.filesTransformed += r.transformed;
      stats.packageJsonProcessed += r.packageJson;
      if (r.cacheHit) stats.cacheHits += 1;
      if (r.deleted) stats.deletedFiles.push(r.deleted);
    }
  }

  // Save cache (pruned to only files scanned this run)
  try {
    await writeFile(cachePath, JSON.stringify(fileCache.serialize(selfHash)), 'utf8');
  } catch { /* non-fatal — cache miss next run */ }

  return stats;
}

// -- CLI entry point ----------------------------------------------------------

const isMainModule = process.argv[1] &&
  (process.argv[1].endsWith('codemod.mjs') || process.argv[1].endsWith('codemod.js'));

if (isMainModule) {
  const tempDir = process.argv[2];
  if (!tempDir) {
    console.error('Usage: node scripts/codemod.mjs <directory>');
    process.exit(1);
  }

  transform(tempDir)
    .then((stats) => {
      console.log('Codemod complete.');
      console.log(`  Files scanned:          ${stats.filesScanned}`);
      console.log(`  Files transformed:      ${stats.filesTransformed}`);
      console.log(`  Cache hits (skipped):   ${stats.cacheHits}`);
      console.log(`  package.json processed: ${stats.packageJsonProcessed}`);
      if (stats.deletedFiles.length > 0) {
        console.log(`  Deleted files:          ${stats.deletedFiles.length}`);
        for (const f of stats.deletedFiles) {
          console.log(`    - ${f}`);
        }
      }
    })
    .catch((err) => {
      console.error('Codemod failed:', err.message);
      process.exit(1);
    });
}
