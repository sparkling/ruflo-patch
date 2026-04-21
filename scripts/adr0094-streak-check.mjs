#!/usr/bin/env node
// scripts/adr0094-streak-check.mjs — ADR-0094 close-criterion tracker.
//
// Reads test-results/cascade-streak.jsonl (one line per full cascade run),
// computes the current streak of consecutive GREEN runs across distinct
// calendar days (UTC YYYY-MM-DD), and prints a status block used both by
// humans reading cascade output and by the cascade itself (scripts/
// test-acceptance.sh appends an entry near the Results summary, then
// invokes this reader for the status tail).
//
// Criterion (per docs/adr/ADR-0094-100-percent-acceptance-coverage-plan.md
// lines 128–138):
//
//   fail_count == 0
//   AND invoked_coverage == 100%
//   AND verified_coverage >= 80%
//   AND [repeated across 3 consecutive days]
//
// This reader enforces only the day-count side of the criterion (fail==0
// and pass>0 ⇒ `green`). invoked/verified coverage live in the ADR-0094
// catalog (scripts/catalog-rebuild.mjs) and are attached to each jsonl
// entry when available, but are NOT required for a row to count as green —
// that's the ADR-0094 snapshot gate, not the per-run gate.
//
// Rules:
//   • Calendar day = UTC YYYY-MM-DD portion of the run's ISO timestamp.
//     DST / local TZ never enters the picture.
//   • Multiple runs per day collapse to ONE day. The day is GREEN iff at
//     least one green run exists AND no non-green run exists on that day.
//     (A single failing cascade on day D resets the streak — we don't let
//     a later green run on the same day paper over it.)
//   • The streak is counted back from the most recent green day, walking
//     backward one calendar day at a time; any gap (no run) or non-green
//     day ends the streak.
//
// Exit codes:
//   0 — criterion met (≥3 consecutive green days).
//   1 — not yet met; diagnostic line explains what's missing.
//   2 — the streak file is missing or unreadable (cold start / broken path).

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, '..');
const STREAK_FILE = resolve(PROJECT_DIR, 'test-results', 'cascade-streak.jsonl');
const REQUIRED_GREEN_DAYS = 3;

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
 * Collapse per-run entries into per-day verdicts.
 * A day is green iff ≥1 green run AND 0 non-green runs that day.
 * Returns a Map<YYYY-MM-DD, { green: boolean, latestRun: entry }>.
 */
function collapseByDay(entries) {
  const byDay = new Map();
  for (const e of entries) {
    if (!e || typeof e.date !== 'string') continue;
    const day = e.date;
    const prior = byDay.get(day);
    if (!prior) {
      byDay.set(day, { green: !!e.green, latestRun: e });
      continue;
    }
    // Non-green runs poison the day permanently.
    const green = prior.green && !!e.green;
    // "Latest run" = highest ISO timestamp on this day (canonical for display).
    const latestRun =
      (e.iso || '') > (prior.latestRun.iso || '') ? e : prior.latestRun;
    byDay.set(day, { green, latestRun });
  }
  return byDay;
}

/**
 * Walk backward from the most recent green day, counting consecutive
 * calendar-adjacent green days. Returns { streak, days[], latestGreenDay,
 * latestOverallRun }.
 */
function computeStreak(byDay) {
  const sortedDays = [...byDay.keys()].sort(); // ISO dates sort lexically.
  if (sortedDays.length === 0) {
    return { streak: 0, days: [], latestGreenDay: null, latestOverallRun: null };
  }
  const mostRecentDay = sortedDays[sortedDays.length - 1];
  const latestOverallRun = byDay.get(mostRecentDay).latestRun;

  // Find newest green day (may be older than mostRecentDay if today failed).
  let latestGreenDay = null;
  for (let i = sortedDays.length - 1; i >= 0; i--) {
    if (byDay.get(sortedDays[i]).green) {
      latestGreenDay = sortedDays[i];
      break;
    }
  }
  if (!latestGreenDay) {
    return { streak: 0, days: [], latestGreenDay: null, latestOverallRun };
  }

  // Walk backward by one calendar day at a time.
  const streakDays = [];
  let cursor = latestGreenDay;
  while (true) {
    const v = byDay.get(cursor);
    if (!v || !v.green) break;
    streakDays.unshift(cursor);
    const prev = previousDay(cursor);
    if (!byDay.has(prev)) break;
    cursor = prev;
  }
  return {
    streak: streakDays.length,
    days: streakDays,
    latestGreenDay,
    latestOverallRun,
  };
}

function previousDay(ymd) {
  // YYYY-MM-DD → previous YYYY-MM-DD in UTC. Date.UTC handles month rollover.
  const [y, m, d] = ymd.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) - 86_400_000;
  const dt = new Date(t);
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

function main() {
  const { entries, missing } = parseJsonl(STREAK_FILE);
  if (missing) {
    process.stdout.write(
      'ADR-0094 close criterion:\n' +
        '  Streak file missing: no cascade runs recorded yet.\n' +
        `  Expected: ${STREAK_FILE}\n` +
        '  Status: NOT YET (0/3 green days recorded)\n',
    );
    process.exit(2);
  }
  if (entries.length === 0) {
    process.stdout.write(
      'ADR-0094 close criterion:\n' +
        '  Streak file empty.\n' +
        '  Status: NOT YET (0/3 green days recorded)\n',
    );
    process.exit(1);
  }

  const byDay = collapseByDay(entries);
  const { streak, days, latestGreenDay, latestOverallRun } = computeStreak(byDay);
  const met = streak >= REQUIRED_GREEN_DAYS;

  const lines = [];
  lines.push('ADR-0094 close criterion:');
  if (streak > 0) {
    lines.push(
      `  Current streak: ${streak} consecutive green day(s): ${days.join(', ')}`,
    );
  } else {
    lines.push('  Current streak: 0 consecutive green day(s)');
  }
  if (met) {
    lines.push(`  Status: MET (criterion reached on ${latestGreenDay})`);
  } else {
    const remaining = REQUIRED_GREEN_DAYS - streak;
    lines.push(
      `  Status: NOT YET (need ${remaining} more green day${remaining === 1 ? '' : 's'})`,
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
