#!/usr/bin/env node
// scripts/lint-no-daemon-lock-cache.mjs — ADR-0202 structural lint rule.
//
// Two-part rule (ADR-0257 item #14 extended the original scope):
//
//   PART 1 — `worker-daemon.ts` specifically:
//     a. No module-scope `memory-router` reference (import or variable).
//     b. The daemon must call `setRouterPersistent(false)` so the per-op
//        release guard is armed.
//
//   PART 2 — Module-scope substrate-handle cache ban across
//     `v3/@claude-flow/cli/src/services/` and `v3/@claude-flow/cli/src/mcp-tools/`:
//     No `let|const|var _<handle> = ...` at module scope where `<handle>`
//     names a substrate handle (`_db`, `_dbPath`, `_database`, `_storage`,
//     `_backend`, `_native`, `_sql`, `_sqlite`, `_rvf`, `_handle`).
//     This catches the ADR-130 `graph-edge-writer.ts:28-29` shape Devil's
//     Advocate flagged in ADR-0254 Revision 2 — a long-lived module-level
//     SQL.js handle that would hold a substrate lock for the host process's
//     lifetime instead of releasing per-op.
//
// Allowlist (content-keyed) at `lib/no-daemon-lock-cache-allowlist.txt` for
// rare legitimate cases. Add entries only with a rationale comment.
//
// Exit codes:
//   0  — no violations found
//   1  — at least one violation found
//
// No external deps; Node 20+ only.

import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve, dirname, relative, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, '..');
const ALLOWLIST_FILE = join(PROJECT_DIR, 'lib', 'no-daemon-lock-cache-allowlist.txt');

// Forks live at /Users/henrik/source/forks/ (sibling of ruflo-patch).
// Fall back to a relative path so CI can override via FORK_ROOT env var.
const FORK_ROOT = process.env['FORK_ROOT'] || resolve(__dirname, '../../forks/ruflo');
const AGENTDB_FORK_ROOT = process.env['AGENTDB_FORK_ROOT'] || resolve(__dirname, '../../forks/agentdb');

// ADR-0261 extension (2026-05-27): Part-1 scope was worker-daemon.ts only;
// now also covers the new graph-edge handler + sweep worker landed by
// ADR-0261, both of which the ratified design forbids from caching a
// module-scope substrate handle (criterion #1 / ADR-0202).
//
// Each entry is checked for module-scope `_db`/`_storage`/`_handle`/etc.
// declarations matching the SUBSTRATE_HANDLE_NAMES set. worker-daemon.ts
// alone retains the two-rule check (memory-router import + setRouterPersistent
// call); the other targets only get the substrate-cache scan.
const TARGET_FILES = [
  {
    path: resolve(FORK_ROOT, 'v3/@claude-flow/cli/src/services/worker-daemon.ts'),
    fullChecks: true,  // memory-router + setRouterPersistent rules
    relLabel: 'v3/@claude-flow/cli/src/services/worker-daemon.ts',
  },
  {
    path: resolve(AGENTDB_FORK_ROOT, 'src/archivist/handlers/agentdb/graph-edge.ts'),
    fullChecks: false, // substrate-cache scan only
    relLabel: 'agentdb/src/archivist/handlers/agentdb/graph-edge.ts',
  },
  {
    path: resolve(AGENTDB_FORK_ROOT, 'src/workers/graph-edge-sweep.ts'),
    fullChecks: false, // substrate-cache scan only
    relLabel: 'agentdb/src/workers/graph-edge-sweep.ts',
  },
];

// Back-compat alias: the worker-daemon.ts path is still expected by some
// callers that read TARGET_FILE directly. Keep it pointing at the first
// entry so existing imports keep working.
const TARGET_FILE = TARGET_FILES[0].path;

// PART 2 scan roots — directories that may NOT hold module-scope substrate
// handle caches. The `memory/` directory is intentionally excluded because
// `memory-router.ts:191 let _storage = null` is the ADR-0202-sanctioned CLI
// hook cache (per-process, kernel-auto-released on exit).
const PART2_SCAN_DIRS = [
  resolve(FORK_ROOT, 'v3/@claude-flow/cli/src/services'),
  resolve(FORK_ROOT, 'v3/@claude-flow/cli/src/mcp-tools'),
];

// FIXTURE_FILE: optional extra single file to scan (used by the self-test
// to confirm a synthetic violation in a non-fork file is still caught).
const FIXTURE_FILE = process.env['LINT_FIXTURE_FILE'] || null;

// Substrate-handle names. A module-scope `let|const|var _NAME = ...`
// matching this list is presumed to be a substrate cache (sqlite/sql.js
// handle, RVF backend, native store handle, path-pair, etc.).
//
// NOT covered (intentionally): promise caches like `_routerP` /
// `_reasoningBankP` — these are dynamic-import memoisation, not substrate
// handles, and don't hold locks.
const SUBSTRATE_HANDLE_NAMES = new Set([
  '_db',
  '_dbPath',
  '_database',
  '_storage',
  '_backend',
  '_native',
  '_sql',
  '_sqlite',
  '_rvf',
  '_handle',
]);

const SKIP_FILE_RE = /\.test\.(ts|mjs|js)$|\.spec\.(ts|mjs|js)$|\.d\.ts$/;

function fail(msg) {
  process.stderr.write(`[FAIL] lint-no-daemon-lock-cache: ${msg}\n`);
  process.exitCode = 1;
}

function info(msg) {
  process.stdout.write(`[INFO] lint-no-daemon-lock-cache: ${msg}\n`);
}

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

function* walkDir(rootDir) {
  if (!existsSync(rootDir)) return;
  const entries = readdirSync(rootDir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(rootDir, e.name);
    if (e.isDirectory()) {
      // Don't recurse into subdirs by default — scope is the directory's
      // own .ts files, not a recursive tree walk. (services/ and mcp-tools/
      // are flat directories in the fork.)
      continue;
    }
    if (e.isFile()) {
      if (SKIP_FILE_RE.test(e.name)) continue;
      if (/\.(ts|mjs|js)$/.test(e.name)) yield full;
    }
  }
}

// PART 1: worker-daemon.ts-specific checks.
function lintWorkerDaemon() {
  if (!existsSync(TARGET_FILE)) {
    fail(`Target file not found: ${TARGET_FILE}`);
    return 1;
  }

  const src = readFileSync(TARGET_FILE, 'utf8');
  const lines = src.split('\n');

  let violations = 0;

  // Rule 1: memory-router must NOT be imported at module scope.
  // Heuristic: track brace depth, flag any line containing `memory-router`
  // while at depth 0, except dynamic-import expressions that are already
  // covered by the function-body scope (they'd be inside a function).
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const rel = `v3/@claude-flow/cli/src/services/worker-daemon.ts:${lineNum}`;

    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;

    const isModuleScope = braceDepth === 0;

    if (isModuleScope && line.includes('memory-router')) {
      fail(`Module-scope memory-router reference at ${rel}: ${line.trim()}`);
      violations++;
    }

    if (isModuleScope) {
      const varDecl = /^(?:let|const|var)\s+\w+\s*=/.test(line.trim());
      if (varDecl && line.includes('memory-router')) {
        fail(`Module-scope variable capturing memory-router at ${rel}: ${line.trim()}`);
        violations++;
      }
    }

    braceDepth += opens - closes;
    if (braceDepth < 0) braceDepth = 0;
  }

  // Rule 2: ADR-0202 guard call must be present.
  if (!src.includes('setRouterPersistent')) {
    fail(
      `worker-daemon.ts does not call setRouterPersistent — ADR-0202 ` +
        `per-op release guard is missing. Add setRouterPersistent(false) ` +
        `in the daemon start() method.`,
    );
    violations++;
  } else if (!src.includes('setRouterPersistent(false)')) {
    fail(
      `worker-daemon.ts calls setRouterPersistent but not with false — ` +
        `check the argument; the daemon requires setRouterPersistent(false).`,
    );
    violations++;
  }

  return violations;
}

// PART 2: module-scope substrate-handle cache scan across services + mcp-tools.
function lintModuleScopeSubstrateCache(allowlist) {
  let violations = 0;
  let filesScanned = 0;

  const files = [];
  for (const dir of PART2_SCAN_DIRS) {
    if (!existsSync(dir)) {
      info(`scan dir missing: ${dir} — skipping`);
      continue;
    }
    for (const f of walkDir(dir)) files.push(f);
  }
  if (FIXTURE_FILE && existsSync(FIXTURE_FILE)) {
    files.push(FIXTURE_FILE);
  }

  // Module-scope decl pattern: `let|const|var _NAME[: TYPE] = ...` at the
  // start of a line (allowing leading whitespace for indented re-exports,
  // though we expect column-0 for true module scope).
  //
  // We track brace depth to confirm the decl is at module scope (depth 0).
  // Multi-line declarations are handled by anchoring on the line containing
  // the `let|const|var _NAME` keyword.
  const DECL_RE = /^\s*(?:export\s+)?(?:let|const|var)\s+(_\w+)\s*(?::[^=]+)?=/;

  for (const file of files) {
    filesScanned++;
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');

    let braceDepth = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Strip line + block comments for the bracedepth count.
      // Brace count happens BEFORE the decl check so depth reflects the
      // depth AT the start of this line.
      const isModuleScope = braceDepth === 0;

      if (isModuleScope) {
        const m = DECL_RE.exec(line);
        if (m) {
          const name = m[1];
          if (SUBSTRATE_HANDLE_NAMES.has(name)) {
            const rel = relative(PROJECT_DIR, file);
            const signature = line.replace(/\s+/g, ' ').trim();
            const key = `${rel} :: ${signature}`;
            if (!allowlist.has(key)) {
              fail(
                `Module-scope substrate-handle cache at ${rel}:${lineNum}: ${signature}\n` +
                  `        Substrate handle '${name}' must NOT be cached at module scope ` +
                  `(ADR-0202). Move into per-op acquire/release inside the handler ` +
                  `function. If this is genuinely safe (e.g. non-substrate state), ` +
                  `add to lib/no-daemon-lock-cache-allowlist.txt with rationale.`,
              );
              violations++;
            }
          }
        }
      }

      // Update brace depth after the check (decl line may itself open a brace
      // for a function init — we want this line classified at the entry depth).
      const opens = (line.match(/\{/g) || []).length;
      const closes = (line.match(/\}/g) || []).length;
      braceDepth += opens - closes;
      if (braceDepth < 0) braceDepth = 0;
    }
  }

  return { violations, filesScanned };
}

// PART 3 (ADR-0261, 2026-05-27): substrate-cache scan on the new graph-edge
// handler + sweep worker. Same rule as PART 2 (no module-scope substrate
// handles named in SUBSTRATE_HANDLE_NAMES), but scoped to the explicit
// agentdb fork files added by ADR-0261's design.
//
// Files that don't exist yet (Agent A may not have published) are SKIPPED
// with an info log, not failed — the lint surface is forward-looking. Once
// Agent A publishes, the files become real and any violation will fail.
function lintAdr0261Targets(allowlist) {
  let violations = 0;
  let filesChecked = 0;
  let filesSkipped = 0;

  const DECL_RE = /^\s*(?:export\s+)?(?:let|const|var)\s+(_\w+)\s*(?::[^=]+)?=/;

  for (const target of TARGET_FILES) {
    if (target.fullChecks) continue; // handled by lintWorkerDaemon
    if (!existsSync(target.path)) {
      info(`ADR-0261 target not yet built: ${target.relLabel} — skipping (Agent A pending)`);
      filesSkipped++;
      continue;
    }
    filesChecked++;
    const src = readFileSync(target.path, 'utf8');
    const lines = src.split('\n');

    let braceDepth = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;
      const isModuleScope = braceDepth === 0;
      if (isModuleScope) {
        const m = DECL_RE.exec(line);
        if (m) {
          const name = m[1];
          if (SUBSTRATE_HANDLE_NAMES.has(name)) {
            const signature = line.replace(/\s+/g, ' ').trim();
            const key = `${target.relLabel} :: ${signature}`;
            if (!allowlist.has(key)) {
              fail(
                `ADR-0261 violation at ${target.relLabel}:${lineNum}: ${signature}\n` +
                  `        Substrate handle '${name}' must NOT be cached at module scope ` +
                  `(ADR-0261 criterion #1 + ADR-0202). Use ctx.substrate.withWrite ` +
                  `(handler) or per-tick acquisition (sweep worker) instead.`,
              );
              violations++;
            }
          }
        }
      }
      const opens = (line.match(/\{/g) || []).length;
      const closes = (line.match(/\}/g) || []).length;
      braceDepth += opens - closes;
      if (braceDepth < 0) braceDepth = 0;
    }
  }
  return { violations, filesChecked, filesSkipped };
}

function main() {
  const allowlist = loadAllowlist();

  const part1Violations = lintWorkerDaemon();
  const { violations: part2Violations, filesScanned } =
    lintModuleScopeSubstrateCache(allowlist);
  const {
    violations: part3Violations,
    filesChecked: part3Checked,
    filesSkipped: part3Skipped,
  } = lintAdr0261Targets(allowlist);

  const total = part1Violations + part2Violations + part3Violations;

  if (total === 0) {
    info(
      `OK — worker-daemon.ts holds no module-scoped memory-router backend (ADR-0202); ` +
        `${filesScanned} files scanned in services/ + mcp-tools/ for module-scope ` +
        `substrate-handle caches (none found); ` +
        `ADR-0261 targets: ${part3Checked} checked, ${part3Skipped} skipped (not built yet).`,
    );
    process.exit(0);
  } else {
    process.exit(1);
  }
}

main();
