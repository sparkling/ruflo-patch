#!/usr/bin/env node
// scripts/check-tier-y-gate.mjs — ADR-0097 Tier Y: block new acceptance
// check libs that lack a paired unit test.
//
// Rule: any `lib/acceptance-*-checks.sh` that is either
//   (a) newly staged/committed in the current push range, or
//   (b) currently untracked in the working tree
// MUST have a paired `tests/unit/acceptance-<slug>.test.mjs` OR
// `tests/unit/adr0094-p*-<slug>.test.mjs`.
//
// Pair lookup: strip leading `acceptance-` and trailing `-checks` from the
// basename to get <slug>. Accept any test file whose basename contains
// <slug> under `tests/unit/`.
//
// Usage:
//   node scripts/check-tier-y-gate.mjs
//   node scripts/check-tier-y-gate.mjs --against <ref>   # diff vs git ref
//
// Exit 0 on success; exit 1 on violations. Reports to stderr.

import { execSync } from 'node:child_process';
import { readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LIB_DIR = resolve(ROOT, 'lib');
const TEST_DIR = resolve(ROOT, 'tests', 'unit');

const args = process.argv.slice(2);
const againstIdx = args.indexOf('--against');
const against = againstIdx >= 0 ? args[againstIdx + 1] : null;

function sh(cmd) {
  try { return execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim(); }
  catch (e) { return ''; }
}

function slugFor(fileBase) {
  // acceptance-phase13-migration.sh → phase13-migration
  // acceptance-adr0094-p10-idempotency.sh → adr0094-p10-idempotency  (not used; kept generic)
  // acceptance-foo-checks.sh → foo
  let s = fileBase.replace(/\.sh$/, '');
  s = s.replace(/^acceptance-/, '');
  s = s.replace(/-checks$/, '');
  return s;
}

function hasPairedTest(slug) {
  if (!existsSync(TEST_DIR)) return false;
  const files = readdirSync(TEST_DIR).filter(f => f.endsWith('.test.mjs'));
  return files.some(f => f.includes(slug));
}

// Gather candidate lib files that this gate must enforce.
function gatherCandidates() {
  const out = new Set();

  // (a) New files in commit range. For pre-push hook we diff HEAD against
  // the configured upstream (`@{u}` falls back to `origin/HEAD` then
  // `origin/main`).
  let range = against;
  if (!range) {
    range = sh('git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null');
    if (!range) range = sh('git rev-parse --verify origin/main 2>/dev/null') ? 'origin/main' : '';
  }
  if (range) {
    const diff = sh(`git diff --name-only --diff-filter=A ${range}...HEAD -- 'lib/acceptance-*-checks.sh' 2>/dev/null`);
    if (diff) diff.split('\n').forEach(p => { if (p) out.add(resolve(ROOT, p)); });
  }

  // (b) Untracked files in working tree.
  const untracked = sh(`git ls-files --others --exclude-standard -- 'lib/acceptance-*-checks.sh'`);
  if (untracked) untracked.split('\n').forEach(p => { if (p) out.add(resolve(ROOT, p)); });

  // (c) Also consider staged new files (for pre-commit use).
  const staged = sh(`git diff --cached --name-only --diff-filter=A -- 'lib/acceptance-*-checks.sh'`);
  if (staged) staged.split('\n').forEach(p => { if (p) out.add(resolve(ROOT, p)); });

  return [...out].filter(p => existsSync(p));
}

const candidates = gatherCandidates();
const violations = [];

for (const abs of candidates) {
  const base = basename(abs);
  const slug = slugFor(base);
  if (!hasPairedTest(slug)) {
    violations.push({ file: abs, slug, expected: `tests/unit/acceptance-${slug}.test.mjs or tests/unit/adr0094-p*-${slug}.test.mjs` });
  }
}

if (violations.length === 0) {
  process.stderr.write(`ADR-0097 Tier Y gate: OK — ${candidates.length} candidate lib file(s) examined\n`);
  process.exit(0);
}

process.stderr.write(`ADR-0097 Tier Y gate: ${violations.length} violation(s)\n`);
for (const v of violations) {
  const rel = v.file.startsWith(ROOT) ? v.file.slice(ROOT.length + 1) : v.file;
  process.stderr.write(`  ${rel}  →  missing paired test (expected ${v.expected})\n`);
}
process.stderr.write(`\nADR-0097 §Tier Y: new lib/acceptance-*-checks.sh must ship with a paired tests/unit/ file.\n`);
process.exit(1);
