#!/usr/bin/env node
// scripts/adr0094-streak-check.mjs — ADR-0094 close-criterion tracker.
//
// Reads test-results/cascade-streak.jsonl (one line per full cascade run),
// computes the current streak of consecutive GREEN runs that are spaced at
// least GAP_HOURS apart, and prints a status block.
//
// ADR-0094's Acceptance criteria (paraphrased) require:
//   fail_count == 0
//   AND invoked_coverage == 100%
//   AND verified_coverage >= 80%
//   AND [repeated across 3 consecutive runs with ≥ GAP_HOURS gaps]
//
// This reader enforces only the run-count + gap-spacing side of the
// criterion (fail==0 on three independent runs). The coverage thresholds
// are still snapshot-gated by `scripts/catalog-rebuild.mjs --verify`.
//
// Semantics (amended 2026-04-21 — was "3 consecutive calendar days"):
//   • "Green run" = the cascade summary line reported fail == 0 AND pass > 0.
//   • A non-green run between any two greens resets the streak entirely.
//   • From the most recent run (sorted ascending by ISO), we walk backward
//     picking green anchors greedily: the newest green is anchor #1, the
//     next older green whose timestamp is ≥ GAP_HOURS older than anchor #1
//     is anchor #2, etc. Greens that fall inside a prior anchor's
//     GAP_HOURS window are "too-close" and don't advance the count, but
//     they also don't reset it — we keep walking.
//   • A non-green run encountered during the walk terminates the streak.
//   • Streak = number of anchors selected.
//
//   The previous rule ("3 consecutive calendar days") was dropped because
//   it conflated clock-time flakiness with day-boundary semantics and
//   forced a 2-day minimum wait even after catching three independent
//   successes. The gap-based rule catches the same signal (different
//   environmental conditions, different caches, different process state)
//   without the calendar tax.
//
// Configuration:
//   env ADR0094_STREAK_GAP_HOURS (default 2) — minimum gap between anchors.
//     2 is enough to cover daemon restart, Verdaccio cache turnover, and
//     JIT warm-up variance. Set higher (e.g. 6) if you want wider spread.
//   env ADR0094_STREAK_REQUIRED (default 3) — number of anchors needed.
//
// Exit codes:
//   0 — criterion met (≥ REQUIRED anchors with required spacing).
//   1 — criterion not met (streak < REQUIRED).
//   2 — the streak file is missing or unreadable (cold start / broken path).

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, '..');
const STREAK_FILE = resolve(PROJECT_DIR, 'test-results', 'cascade-streak.jsonl');

const REQUIRED_ANCHORS = parseInt(process.env.ADR0094_STREAK_REQUIRED || '3', 10);
const GAP_HOURS = parseFloat(process.env.ADR0094_STREAK_GAP_HOURS || '2');
const GAP_MS = GAP_HOURS * 3600 * 1000;

function parseJsonl(path) {
  if (!existsSync(path)) return { entries: [], missing: true };
  const raw = readFileSync(path, 'utf8');
  const entries = [];
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      entries.push(JSON.parse(line));
    } catch (err) {
      // Skip malformed lines but don't crash — the tracker must never
      // brick the cascade. Report to stderr for visibility.
      process.stderr.write(
        `[adr0094-streak] WARN: malformed jsonl at line ${i + 1}: ${err.message}\n`,
      );
    }
  }
  return { entries, missing: false };
}

/**
 * Walk backward from the newest run picking green anchors greedily.
 * Returns { streak, anchors[], latestOverallRun }.
 *   anchors[] = array of entries (newest first) that count toward the streak.
 *   Each adjacent pair in anchors[] has gap ≥ GAP_MS.
 */
function computeStreak(entries) {
  if (entries.length === 0) {
    return { streak: 0, anchors: [], latestOverallRun: null };
  }

  // Sort ascending by ISO (lexical sort works for valid ISO-8601 UTC).
  const sorted = [...entries].sort((a, b) =>
    (a.iso || '').localeCompare(b.iso || ''),
  );
  const latestOverallRun = sorted[sorted.length - 1];

  // Walk backward.
  const anchors = [];
  let lastAnchorTs = null;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const e = sorted[i];
    if (!e || typeof e.iso !== 'string') continue;

    if (!e.green) {
      // Terminate on any non-green encountered during the walk (even if
      // we haven't picked any anchors yet — a freshly-failed cascade
      // means streak = 0).
      break;
    }

    const ts = Date.parse(e.iso);
    if (!Number.isFinite(ts)) continue;

    if (lastAnchorTs === null) {
      // Newest green — always pick as anchor #1.
      anchors.push(e);
      lastAnchorTs = ts;
      if (anchors.length >= REQUIRED_ANCHORS) break;
      continue;
    }

    // Candidate must be ≥ GAP_MS OLDER than the last picked anchor.
    if (lastAnchorTs - ts >= GAP_MS) {
      anchors.push(e);
      lastAnchorTs = ts;
      if (anchors.length >= REQUIRED_ANCHORS) break;
    }
    // else: green but too close to prior anchor — skip without resetting.
  }

  return { streak: anchors.length, anchors, latestOverallRun };
}

function formatIsoShort(iso) {
  // YYYY-MM-DDTHH:MMZ for compact display.
  return (iso || '').replace(/:\d{2}\.\d+Z$/, 'Z').replace(/:\d{2}Z$/, 'Z');
}

function main() {
  const { entries, missing } = parseJsonl(STREAK_FILE);
  if (missing) {
    process.stdout.write(
      'ADR-0094 close criterion:\n' +
        '  Streak file missing: no cascade runs recorded yet.\n' +
        `  Expected: ${STREAK_FILE}\n` +
        `  Status: NOT YET (0/${REQUIRED_ANCHORS} green runs recorded)\n`,
    );
    process.exit(2);
  }
  if (entries.length === 0) {
    process.stdout.write(
      'ADR-0094 close criterion:\n' +
        '  Streak file empty.\n' +
        `  Status: NOT YET (0/${REQUIRED_ANCHORS} green runs recorded)\n`,
    );
    process.exit(1);
  }

  const { streak, anchors, latestOverallRun } = computeStreak(entries);
  const met = streak >= REQUIRED_ANCHORS;

  const lines = [];
  lines.push('ADR-0094 close criterion:');
  lines.push(
    `  Rule: ${REQUIRED_ANCHORS} consecutive green runs with ≥${GAP_HOURS}h gaps (configurable via ADR0094_STREAK_REQUIRED / ADR0094_STREAK_GAP_HOURS).`,
  );
  if (streak > 0) {
    const anchorList = anchors
      .slice() // newest-first → show oldest-first for readability
      .reverse()
      .map((e) => formatIsoShort(e.iso))
      .join(' → ');
    lines.push(`  Current streak: ${streak} anchor(s): ${anchorList}`);
  } else {
    lines.push('  Current streak: 0 green anchors');
  }
  if (met) {
    lines.push(
      `  Status: MET (${streak} green runs with required spacing, newest ${formatIsoShort(anchors[0].iso)})`,
    );
  } else {
    const remaining = REQUIRED_ANCHORS - streak;
    lines.push(
      `  Status: NOT YET (need ${remaining} more green run${remaining === 1 ? '' : 's'} with ≥${GAP_HOURS}h gap${remaining === 1 ? '' : 's each'})`,
    );
  }
  if (latestOverallRun) {
    const r = latestOverallRun;
    const pass = typeof r.pass === 'number' ? r.pass : '?';
    const fail = typeof r.fail === 'number' ? r.fail : '?';
    const skip = typeof r.skip_accepted === 'number' ? r.skip_accepted : 0;
    const skipTail = skip > 0 ? ` / ${skip} skip_accepted` : '';
    lines.push(
      `  Most recent run: ${r.runId || '(unknown)'} (${pass} pass / ${fail} fail${skipTail})`,
    );
  }
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(met ? 0 : 1);
}

main();
