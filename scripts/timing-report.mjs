#!/usr/bin/env node
// scripts/timing-report.mjs — Timing regression report for pipeline builds (O3)
//
// Usage: node scripts/timing-report.mjs [--last N]
//   Reads the last N pipeline-timing.json files (default 10) and reports
//   per-phase timing trends plus the 5 slowest packages.

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, basename, resolve } from 'path';

const projectRoot = resolve(import.meta.dirname, '..');
const resultsRoot = join(projectRoot, 'test-results');

// Parse --last N from argv (default 10)
let lastN = 10;
const lastIdx = process.argv.indexOf('--last');
if (lastIdx !== -1 && process.argv[lastIdx + 1]) {
  lastN = parseInt(process.argv[lastIdx + 1], 10) || 10;
}

// Discover timing files sorted lexicographically (timestamps = chronological)
let timingDirs;
try {
  timingDirs = readdirSync(resultsRoot)
    .filter(d => {
      try {
        return statSync(join(resultsRoot, d)).isDirectory();
      } catch { return false; }
    })
    .sort();
} catch {
  console.log('No test-results/ directory found.');
  process.exit(0);
}

// Load last N timing files
const timingFiles = [];
for (const dir of timingDirs.slice(-lastN)) {
  const fp = join(resultsRoot, dir, 'pipeline-timing.json');
  try {
    const data = JSON.parse(readFileSync(fp, 'utf-8'));
    timingFiles.push({ dir, data });
  } catch { /* skip unreadable */ }
}

if (timingFiles.length === 0) {
  console.log('No pipeline-timing.json files found.');
  process.exit(0);
}

console.log(`Timing report (last ${timingFiles.length} builds)\n`);

// Aggregate per-phase durations from the commands array
// Each command has { phase, command, duration_ms }
// We sum duration_ms per phase per build
const phaseBuilds = new Map(); // phase -> [sum_per_build]

for (const { data } of timingFiles) {
  const buildPhases = new Map();
  for (const cmd of (data.commands || [])) {
    const cur = buildPhases.get(cmd.phase) || 0;
    buildPhases.set(cmd.phase, cur + cmd.duration_ms);
  }
  // Also include verify_phases
  for (const vp of (data.verify_phases || [])) {
    if (vp.phase === 'TOTAL') continue;
    const cur = buildPhases.get(vp.phase) || 0;
    buildPhases.set(vp.phase, cur + vp.duration_ms);
  }
  for (const [phase, total] of buildPhases) {
    if (!phaseBuilds.has(phase)) phaseBuilds.set(phase, []);
    phaseBuilds.get(phase).push(total);
  }
}

// Compute stats and detect regressions
const rows = [];
for (const [phase, durations] of phaseBuilds) {
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
  const latest = durations[durations.length - 1];
  let trend = 'stable';
  if (latest > avg * 1.5) trend = 'UP (regressed >50%)';
  else if (latest > avg * 1.1) trend = 'up';
  else if (latest < avg * 0.9) trend = 'down';
  rows.push({ phase, latest, avg: Math.round(avg), trend });
}

// Print phase table
const hdr = ['Phase', 'Latest (ms)', 'Avg (ms)', 'Trend'];
const colWidths = [
  Math.max(hdr[0].length, ...rows.map(r => r.phase.length)),
  Math.max(hdr[1].length, ...rows.map(r => String(r.latest).length)),
  Math.max(hdr[2].length, ...rows.map(r => String(r.avg).length)),
  Math.max(hdr[3].length, ...rows.map(r => r.trend.length)),
];

function pad(s, w) { return String(s).padEnd(w); }
function padR(s, w) { return String(s).padStart(w); }

console.log(
  `${pad(hdr[0], colWidths[0])}  ${padR(hdr[1], colWidths[1])}  ${padR(hdr[2], colWidths[2])}  ${pad(hdr[3], colWidths[3])}`
);
console.log(
  `${'-'.repeat(colWidths[0])}  ${'-'.repeat(colWidths[1])}  ${'-'.repeat(colWidths[2])}  ${'-'.repeat(colWidths[3])}`
);
for (const r of rows) {
  const flag = r.trend.startsWith('UP') ? ' ***' : '';
  console.log(
    `${pad(r.phase, colWidths[0])}  ${padR(r.latest, colWidths[1])}  ${padR(r.avg, colWidths[2])}  ${pad(r.trend, colWidths[3])}${flag}`
  );
}

// 5 slowest packages across all builds
const pkgDurations = new Map(); // name -> [durations]
for (const { data } of timingFiles) {
  if (!data.packages?.build) continue;
  for (const pkg of data.packages.build) {
    if (!pkgDurations.has(pkg.name)) pkgDurations.set(pkg.name, []);
    pkgDurations.get(pkg.name).push(pkg.duration_ms);
  }
}

const pkgAvgs = [];
for (const [name, durations] of pkgDurations) {
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
  pkgAvgs.push({ name, avg: Math.round(avg) });
}
pkgAvgs.sort((a, b) => b.avg - a.avg);

console.log('\n5 slowest packages (avg build ms):');
for (const pkg of pkgAvgs.slice(0, 5)) {
  console.log(`  ${pkg.name.padEnd(30)} ${pkg.avg}ms`);
}

// Flag regressions in summary
const regressions = rows.filter(r => r.trend.startsWith('UP'));
if (regressions.length > 0) {
  console.log(`\nWARNING: ${regressions.length} phase(s) regressed >50% vs average:`);
  for (const r of regressions) {
    console.log(`  ${r.phase}: ${r.latest}ms (avg ${r.avg}ms)`);
  }
}

process.exit(0);
