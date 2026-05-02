#!/usr/bin/env node
// scripts/apply-codemod-to-fork-md.mjs — ADR-0113 Phase C (Fix 4):
// apply ONLY the markdown rewrites of scripts/codemod.mjs's
// `transformSource()` to a focused subset of fork files.
//
// Targets (per ADR-0113 §step 29):
//   forks/ruflo/plugins/**/*.md
//   forks/ruflo/.claude-plugin/**/*.md
//   forks/ruflo/.claude-plugin/marketplace.json (the JSON manifest —
//     scope refs in `source: ./plugins/<name>` style strings are
//     irrelevant; we only need the codemod for any @claude-flow/ refs
//     inside it, but we'll handle owner.name separately in step 30)
//
// NOT targeted: package.json, .ts, .js, .mjs, .json (other than
// marketplace.json) — those are processed at build time by the
// pipeline's normal copy-source → codemod flow.
//
// Why standalone: the fork tree at HEAD has dirty package.json files
// from prior pipeline runs. Running full codemod over the fork tree
// would re-touch those, causing churn. Markdown is the only file type
// the build pipeline DOESN'T persist back to the fork — applying
// codemod here is a deliberate, one-time fork divergence (per ADR-0113
// §Caveat).
//
// Idempotent: re-running on already-rewritten files is a no-op
// (regex matches no longer fire).

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSource } from './codemod.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Targets ──────────────────────────────────────────────────────────
const FORK_RUFLO = process.env.FORK_RUFLO_DIR || '/Users/henrik/source/forks/ruflo';

const TARGET_DIRS = [
  join(FORK_RUFLO, 'plugins'),
  join(FORK_RUFLO, '.claude-plugin'),
];

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '.tsbuildinfo']);

// ── Walker ───────────────────────────────────────────────────────────
async function* walkMd(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      yield* walkMd(full);
    } else if (e.isFile() && extname(e.name) === '.md') {
      yield full;
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  const dryRun = process.argv.includes('--dry-run');
  let scanned = 0;
  let changed = 0;
  let totalChars = 0;

  for (const dir of TARGET_DIRS) {
    for await (const path of walkMd(dir)) {
      scanned++;
      const before = await readFile(path, 'utf8');
      const after = transformSource(before);
      if (before !== after) {
        changed++;
        totalChars += Math.abs(after.length - before.length);
        if (!dryRun) {
          await writeFile(path, after, 'utf8');
        }
        const rel = path.startsWith(FORK_RUFLO) ? path.slice(FORK_RUFLO.length + 1) : path;
        console.log(`  ${dryRun ? '[dry] ' : ''}rewrote: ${rel}`);
      }
    }
  }

  console.log('');
  console.log(`Scanned: ${scanned} .md files`);
  console.log(`Changed: ${changed}`);
  if (dryRun) console.log('(dry-run — no files written)');
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
