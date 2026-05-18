#!/usr/bin/env node
// scripts/check-skip-accepted.mjs — verify every skip_accepted acceptance
// test has a documented rationale (HEAVY_SKIP marker or allowlist entry).
//
// Background: the acceptance harness allows tests to mark themselves as
// `skip_accepted` when a runtime dependency isn't available (e.g.
// `ACCEPTANCE_HEAVY=0` skips ~9 heavy tests including Playwright). Without
// a check, a skip can become permanent silently — a "skip rot" hazard.
//
// This detector reads the most recent `test-results/accept-*/acceptance-results.json`,
// enumerates all `status: "skip_accepted"` entries, and verifies each is
// either:
//   1. In `lib/skip-accepted-allowlist.txt` with a rationale comment, OR
//   2. Has a recognized marker substring in its output (HEAVY_SKIP,
//      tool not in published build, prereq_absent, ...).
//
// Exit codes:
//   0  — every skip_accepted is documented (or no results found)
//   1  — at least one skip_accepted lacks documentation

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_DIR = resolve(__dirname, '..');
const TEST_RESULTS_DIR = join(PROJECT_DIR, 'test-results');
const ALLOWLIST_FILE = join(PROJECT_DIR, 'lib', 'skip-accepted-allowlist.txt');

// Substrings in the test output that count as documented rationale.
const RECOGNIZED_MARKERS = [
  'HEAVY_SKIP',
  'tool not in published build',
  'upstream truncation',
  'prereq_absent',
  'runtime_unavailable',
  'tool_not_in_build',
  'skip_streak',
];

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

function findLatestResults() {
  if (!existsSync(TEST_RESULTS_DIR)) return null;
  const dirs = readdirSync(TEST_RESULTS_DIR)
    .filter(d => d.startsWith('accept-'))
    .sort()
    .reverse();
  for (const d of dirs) {
    const file = join(TEST_RESULTS_DIR, d, 'acceptance-results.json');
    if (existsSync(file)) return file;
  }
  return null;
}

function hasRecognizedMarker(output) {
  if (!output) return false;
  return RECOGNIZED_MARKERS.some(m => output.includes(m));
}

function main() {
  const resultsFile = findLatestResults();
  if (!resultsFile) {
    console.log('[SKIP-ACCEPTED] OK: no acceptance-results.json found yet (first run?)');
    process.exit(0);
  }

  let results;
  try {
    results = JSON.parse(readFileSync(resultsFile, 'utf8'));
  } catch (e) {
    console.error(`[SKIP-ACCEPTED] FATAL: could not parse ${resultsFile}: ${e.message}`);
    process.exit(1);
  }

  const allowlist = loadAllowlist();
  const skips = (results.tests || []).filter(t => t.status === 'skip_accepted');
  const undocumented = [];

  for (const t of skips) {
    if (allowlist.has(t.id)) continue;
    if (hasRecognizedMarker(t.output)) continue;
    undocumented.push({
      id: t.id,
      name: t.name,
      headline: (t.output || '').split('\n')[0].slice(0, 100),
    });
  }

  if (undocumented.length > 0) {
    console.error('');
    console.error(`[SKIP-ACCEPTED] Found ${undocumented.length} undocumented skip_accepted entrie(s):`);
    for (const u of undocumented) {
      console.error(`[SKIP-ACCEPTED] ${u.id}: ${u.name}`);
      console.error(`[SKIP-ACCEPTED]   output: ${u.headline}`);
    }
    console.error('');
    console.error(`[SKIP-ACCEPTED] Source: ${resultsFile}`);
    console.error('');
    console.error('[SKIP-ACCEPTED] Each skip_accepted must either:');
    console.error('[SKIP-ACCEPTED]   1. Carry a recognized marker in its output');
    console.error(`[SKIP-ACCEPTED]      (${RECOGNIZED_MARKERS.join(', ')}), or`);
    console.error('[SKIP-ACCEPTED]   2. Be listed in lib/skip-accepted-allowlist.txt by `id` with a');
    console.error('[SKIP-ACCEPTED]      rationale comment above the entry.');
    console.error('');
    console.error('[SKIP-ACCEPTED] Skip rot is a silent-drop class: a test that "always skips" gives');
    console.error('[SKIP-ACCEPTED] zero coverage but produces a green release line.');
    process.exit(1);
  }

  console.log(`[SKIP-ACCEPTED] OK: ${skips.length} skip_accepted entrie(s), all documented`);
  process.exit(0);
}

main();
