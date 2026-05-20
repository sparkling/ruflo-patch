#!/usr/bin/env node
// scripts/lint-no-daemon-lock-cache.mjs — ADR-0202 structural lint rule.
//
// Asserts that `worker-daemon.ts` does NOT hold a module-scoped
// memory-router backend across worker ticks. Specifically: every
// import of `memory-router.js` inside `worker-daemon.ts` must occur
// inside an `async` function body (not at module scope), and no
// module-scoped `let`/`const`/`var` captures a value from
// `memory-router`'s exports.
//
// This prevents accidental re-introduction of the ADR-0202 anti-pattern:
// a module-level `_storage` assignment from a memory-router import that
// holds the RVF flock for the daemon's entire lifetime instead of
// releasing it per-tick.
//
// The rule is intentionally conservative — it flags any module-scoped
// variable whose initialiser contains a memory-router import. False
// positives are allowed list-able (see ALLOWLIST below).
//
// Exit codes:
//   0  — no violations found
//   1  — at least one violation found
//
// No external deps; Node 20+ only.

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Forks live at /Users/henrik/source/forks/ (sibling of ruflo-patch).
// Fall back to a relative path so CI can override via FORK_ROOT env var.
const FORK_ROOT = process.env['FORK_ROOT'] || resolve(__dirname, '../../forks/ruflo');
const TARGET_FILE = resolve(
  FORK_ROOT,
  'v3/@claude-flow/cli/src/services/worker-daemon.ts',
);

// Allowlist entries: `<relative-path>:<line>` — add only with a rationale.
const ALLOWLIST = new Set([
  // None at ADR-0202 acceptance time.
]);

function fail(msg) {
  process.stderr.write(`[FAIL] lint-no-daemon-lock-cache: ${msg}\n`);
  process.exitCode = 1;
}

function info(msg) {
  process.stdout.write(`[INFO] lint-no-daemon-lock-cache: ${msg}\n`);
}

if (!existsSync(TARGET_FILE)) {
  fail(`Target file not found: ${TARGET_FILE}`);
  process.exit(1);
}

const src = readFileSync(TARGET_FILE, 'utf8');
const lines = src.split('\n');

let violations = 0;

// Rule 1: memory-router must NOT be imported at module scope.
// A module-scope import is one that appears BEFORE any `class` or
// `function` keyword at column 0 (i.e. outside any function body).
// Heuristic: we scan for lines matching the import pattern and check
// whether they are inside a function/class by counting brace depth.
let braceDepth = 0;
let inClass = false;
let inFunction = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const lineNum = i + 1;
  const rel = `v3/@claude-flow/cli/src/services/worker-daemon.ts:${lineNum}`;

  // Track brace depth to determine scope.
  const opens = (line.match(/\{/g) || []).length;
  const closes = (line.match(/\}/g) || []).length;

  const isModuleScope = braceDepth === 0;

  // Check for module-scope memory-router references.
  if (isModuleScope && line.includes('memory-router')) {
    // Dynamic imports inside async functions are fine — but at depth 0
    // there IS no enclosing function, so this is a real violation.
    if (!ALLOWLIST.has(rel)) {
      fail(`Module-scope memory-router reference at ${rel}: ${line.trim()}`);
      violations++;
    }
  }

  // Check for module-scope variable declarations that might capture
  // memory-router exports (e.g. `const mi = import('...memory-router...')`).
  if (isModuleScope) {
    const varDecl = /^(?:let|const|var)\s+\w+\s*=/.test(line.trim());
    if (varDecl && line.includes('memory-router')) {
      if (!ALLOWLIST.has(rel)) {
        fail(`Module-scope variable capturing memory-router at ${rel}: ${line.trim()}`);
        violations++;
      }
    }
  }

  braceDepth += opens - closes;
  if (braceDepth < 0) braceDepth = 0; // guard against template literals
}

// Rule 2: Confirm the ADR-0202 guard call is present.
// The daemon's start() must call setRouterPersistent(false) to arm the
// per-op release. If this call disappears, the daemon silently reverts
// to the lifetime-hold anti-pattern.
if (!src.includes('setRouterPersistent')) {
  fail(
    `worker-daemon.ts does not call setRouterPersistent — ADR-0202 ` +
    `per-op release guard is missing. Add setRouterPersistent(false) ` +
    `in the daemon start() method.`,
  );
  violations++;
} else {
  // Verify it's called with false (not true, which would be a no-op).
  if (!src.includes('setRouterPersistent(false)')) {
    fail(
      `worker-daemon.ts calls setRouterPersistent but not with false — ` +
      `check the argument; the daemon requires setRouterPersistent(false).`,
    );
    violations++;
  }
}

if (violations === 0) {
  info(`OK — worker-daemon.ts holds no module-scoped memory-router backend (ADR-0202).`);
  process.exit(0);
} else {
  process.exit(1);
}
