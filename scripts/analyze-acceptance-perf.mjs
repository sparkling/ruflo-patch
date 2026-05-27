#!/usr/bin/env node
/**
 * Acceptance-test performance analyzer.
 *
 * Ingests the latest `test-results/<TS>/pipeline-timing.json` and
 * `test-results/accept-<TS>/acceptance-results.json` and produces a
 * structured bottleneck report:
 *   1. Total release time + acceptance % of total
 *   2. Top 20 slowest checks (id, group, duration, status)
 *   3. Per-group total CPU time (sorted desc; flags parallelism waste)
 *   4. SLOW count (>15s per harness threshold)
 *   5. Bottleneck flag: group CPU > 50% of wall-clock acceptance time
 *   6. Comparison vs previous run (delta on top-5 phases)
 *
 * Usage:
 *   node scripts/analyze-acceptance-perf.mjs           # human-readable
 *   node scripts/analyze-acceptance-perf.mjs --json    # machine-readable
 *
 * Per `feedback-no-tail-tests`: writes nothing through tail/head; full
 * structured output goes to stdout.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT_DIR = process.env.PROJECT_DIR ||
  new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const RESULTS_DIR = join(PROJECT_DIR, 'test-results');
const SLOW_THRESHOLD_MS = 15_000;
const PARALLELISM_WASTE_FACTOR = 2.0;
const BOTTLENECK_PCT = 0.5; // group CPU > 50% of acceptance wall-clock

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');

function latestDir(prefix) {
  if (!existsSync(RESULTS_DIR)) return null;
  const dirs = readdirSync(RESULTS_DIR).filter(d => d.startsWith(prefix));
  if (dirs.length === 0) return null;
  dirs.sort((a, b) => {
    const sa = statSync(join(RESULTS_DIR, a)).mtimeMs;
    const sb = statSync(join(RESULTS_DIR, b)).mtimeMs;
    return sb - sa;
  });
  return join(RESULTS_DIR, dirs[0]);
}

function nthLatestDir(prefix, n) {
  if (!existsSync(RESULTS_DIR)) return null;
  const dirs = readdirSync(RESULTS_DIR).filter(d => d.startsWith(prefix));
  if (dirs.length <= n) return null;
  dirs.sort((a, b) => {
    const sa = statSync(join(RESULTS_DIR, a)).mtimeMs;
    const sb = statSync(join(RESULTS_DIR, b)).mtimeMs;
    return sb - sa;
  });
  return join(RESULTS_DIR, dirs[n]);
}

function loadJson(path) {
  if (!path || !existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { return null; }
}

function fmtMs(ms) {
  if (ms == null) return '?';
  if (ms >= 60_000) return `${(ms / 1000).toFixed(1)}s (${(ms / 60_000).toFixed(2)}m)`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms}ms`;
}

function pct(num, denom) {
  if (!denom) return '0.0%';
  return `${((num / denom) * 100).toFixed(1)}%`;
}

function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function padR(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }

function analyze() {
  // ── Discover artifacts ──────────────────────────────────────────────
  const pipelineDir = latestDir('20'); // 20XX-YY... timestamp prefix
  const acceptDir = latestDir('accept-');
  const prevAcceptDir = nthLatestDir('accept-', 1);

  const pipelineJson = pipelineDir
    ? loadJson(join(pipelineDir, 'pipeline-timing.json'))
    : null;
  const acceptJson = acceptDir
    ? loadJson(join(acceptDir, 'acceptance-results.json'))
    : null;
  const prevAcceptJson = prevAcceptDir
    ? loadJson(join(prevAcceptDir, 'acceptance-results.json'))
    : null;

  if (!pipelineJson && !acceptJson) {
    const msg = `No pipeline or acceptance results found under ${RESULTS_DIR}`;
    if (JSON_OUT) { console.log(JSON.stringify({ error: msg })); process.exit(1); }
    console.error(msg);
    process.exit(1);
  }

  // ── (1) Total release time + acceptance % ───────────────────────────
  const totalReleaseMs = pipelineJson?.total_duration_ms || 0;
  const acceptancePhase = pipelineJson?.phases?.find(p => p.name === 'acceptance');
  const acceptanceMs = acceptancePhase?.duration_ms || acceptJson?.total_duration_ms || 0;

  // ── (2) Top 20 slowest checks ───────────────────────────────────────
  const allTests = acceptJson?.tests || [];
  const byDur = [...allTests].sort((a, b) => (b.duration_ms || 0) - (a.duration_ms || 0));
  const top20 = byDur.slice(0, 20).map(t => ({
    id: t.id,
    group: t.group || '?',
    duration_ms: t.duration_ms || 0,
    status: t.status || (t.passed ? 'passed' : 'failed'),
  }));

  // ── (3) Per-group total CPU + parallelism flag ──────────────────────
  const groupCpu = new Map();
  const groupCount = new Map();
  const groupMax = new Map();
  for (const t of allTests) {
    const g = t.group || '?';
    const d = t.duration_ms || 0;
    groupCpu.set(g, (groupCpu.get(g) || 0) + d);
    groupCount.set(g, (groupCount.get(g) || 0) + 1);
    if (d > (groupMax.get(g) || 0)) groupMax.set(g, d);
  }
  // wall-clock estimate per group = max test duration (lower bound for fully-parallel groups)
  const groupRows = [...groupCpu.entries()].map(([g, cpu]) => {
    const max = groupMax.get(g) || 0;
    const count = groupCount.get(g) || 0;
    const wasteFactor = max > 0 ? cpu / max : 0;
    return {
      group: g,
      cpu_ms: cpu,
      count,
      max_test_ms: max,
      avg_ms: count > 0 ? Math.round(cpu / count) : 0,
      parallel_waste: wasteFactor >= PARALLELISM_WASTE_FACTOR,
      waste_factor: wasteFactor,
    };
  }).sort((a, b) => b.cpu_ms - a.cpu_ms);

  // ── (4) SLOW count (>15s) + breakdown by group ──────────────────────
  const slow = allTests.filter(t => (t.duration_ms || 0) > SLOW_THRESHOLD_MS);
  const slowByGroup = new Map();
  for (const t of slow) {
    const g = t.group || '?';
    slowByGroup.set(g, (slowByGroup.get(g) || 0) + 1);
  }

  // ── (5) Bottleneck flag ─────────────────────────────────────────────
  const bottlenecks = groupRows.filter(g =>
    acceptanceMs > 0 && (g.cpu_ms / acceptanceMs) > BOTTLENECK_PCT
  );

  // ── (6) Comparison vs previous run ──────────────────────────────────
  let phaseDeltas = [];
  if (prevAcceptJson && pipelineJson) {
    const prevPhases = new Map();
    for (const p of prevAcceptJson?.verify_phases || pipelineJson?.verify_phases || []) {
      prevPhases.set(p.phase, p.duration_ms);
    }
    const curPhases = (pipelineJson?.verify_phases || []).slice(0, 5);
    phaseDeltas = curPhases.map(p => ({
      phase: p.phase,
      current_ms: p.duration_ms,
      previous_ms: prevPhases.get(p.phase) ?? null,
      delta_ms: prevPhases.has(p.phase)
        ? p.duration_ms - prevPhases.get(p.phase)
        : null,
    }));
  }

  return {
    sources: {
      pipeline_dir: pipelineDir,
      accept_dir: acceptDir,
      previous_accept_dir: prevAcceptDir,
    },
    totals: {
      release_ms: totalReleaseMs,
      acceptance_ms: acceptanceMs,
      acceptance_pct_of_release: totalReleaseMs > 0
        ? (acceptanceMs / totalReleaseMs)
        : null,
      total_tests: allTests.length,
    },
    top_slow_checks: top20,
    group_cpu_breakdown: groupRows,
    slow_threshold_ms: SLOW_THRESHOLD_MS,
    slow_total: slow.length,
    slow_by_group: [...slowByGroup.entries()]
      .map(([g, n]) => ({ group: g, count: n }))
      .sort((a, b) => b.count - a.count),
    bottleneck_groups: bottlenecks.map(b => ({
      group: b.group,
      cpu_ms: b.cpu_ms,
      pct_of_acceptance: b.cpu_ms / acceptanceMs,
      n_checks: b.count,
    })),
    phase_deltas: phaseDeltas,
  };
}

function renderHuman(r) {
  const out = [];
  const hr = '━'.repeat(78);
  out.push(hr);
  out.push('  Acceptance-test performance analyzer');
  out.push(hr);
  out.push('');
  out.push(`Sources:`);
  out.push(`  pipeline:        ${r.sources.pipeline_dir || '(none)'}`);
  out.push(`  acceptance:      ${r.sources.accept_dir || '(none)'}`);
  out.push(`  previous accept: ${r.sources.previous_accept_dir || '(none)'}`);
  out.push('');

  // (1) Totals
  out.push('┌── (1) Release totals ' + '─'.repeat(56) + '┐');
  out.push(`  Total release:    ${fmtMs(r.totals.release_ms)}`);
  out.push(`  Acceptance phase: ${fmtMs(r.totals.acceptance_ms)} ` +
    `(${pct(r.totals.acceptance_ms, r.totals.release_ms)} of release)`);
  out.push(`  Total tests:      ${r.totals.total_tests}`);
  out.push('');

  // (2) Top 20 slowest
  out.push('┌── (2) Top 20 slowest checks ' + '─'.repeat(49) + '┐');
  out.push(`  ${pad('#', 3)} ${pad('id', 36)} ${pad('group', 18)} ${padR('duration', 10)} status`);
  out.push(`  ${'-'.repeat(3)} ${'-'.repeat(36)} ${'-'.repeat(18)} ${'-'.repeat(10)} ${'-'.repeat(8)}`);
  r.top_slow_checks.forEach((t, i) => {
    out.push(`  ${padR(i + 1, 3)} ${pad(t.id.slice(0, 36), 36)} ${pad(t.group.slice(0, 18), 18)} ` +
      `${padR(fmtMs(t.duration_ms), 10)} ${t.status}`);
  });
  out.push('');

  // (3) Per-group CPU
  out.push('┌── (3) Per-group total CPU (sorted desc) ' + '─'.repeat(37) + '┐');
  out.push(`  ${pad('group', 28)} ${padR('cpu', 12)} ${padR('count', 6)} ${padR('max', 10)} ${padR('avg', 8)}  flags`);
  out.push(`  ${'-'.repeat(28)} ${'-'.repeat(12)} ${'-'.repeat(6)} ${'-'.repeat(10)} ${'-'.repeat(8)}  -----`);
  for (const g of r.group_cpu_breakdown) {
    const flags = [];
    if (g.parallel_waste) flags.push(`PARALLEL-WASTE x${g.waste_factor.toFixed(1)}`);
    out.push(`  ${pad(g.group.slice(0, 28), 28)} ${padR(fmtMs(g.cpu_ms), 12)} ${padR(g.count, 6)} ${padR(fmtMs(g.max_test_ms), 10)} ${padR(fmtMs(g.avg_ms), 8)}  ${flags.join(', ')}`);
  }
  out.push('');

  // (4) SLOW count
  out.push('┌── (4) SLOW checks (>15s harness threshold) ' + '─'.repeat(34) + '┐');
  out.push(`  Total SLOW checks: ${r.slow_total}`);
  if (r.slow_by_group.length > 0) {
    out.push(`  Breakdown by group:`);
    for (const sb of r.slow_by_group) {
      out.push(`    ${pad(sb.group, 28)}  ${sb.count} check${sb.count !== 1 ? 's' : ''}`);
    }
  }
  out.push('');

  // (5) Bottleneck flag
  out.push('┌── (5) Bottleneck flag ' + '─'.repeat(55) + '┐');
  if (r.bottleneck_groups.length === 0) {
    out.push(`  No group exceeds 50% of acceptance wall-clock.`);
  } else {
    out.push(`  ${r.bottleneck_groups.length} group(s) exceed 50% of acceptance wall-clock:`);
    for (const b of r.bottleneck_groups) {
      out.push(`    [BOTTLENECK] ${b.group}: ${fmtMs(b.cpu_ms)} CPU ` +
        `(${(b.pct_of_acceptance * 100).toFixed(1)}% of acceptance) ` +
        `across ${b.n_checks} checks — likely duplicated setup work in parallel checks`);
    }
  }
  out.push('');

  // (6) Phase deltas
  out.push('┌── (6) Phase deltas vs previous run ' + '─'.repeat(42) + '┐');
  if (r.phase_deltas.length === 0) {
    out.push(`  No previous run found for comparison.`);
  } else {
    out.push(`  ${pad('phase', 28)} ${padR('current', 10)} ${padR('previous', 10)} ${padR('delta', 12)}`);
    out.push(`  ${'-'.repeat(28)} ${'-'.repeat(10)} ${'-'.repeat(10)} ${'-'.repeat(12)}`);
    for (const d of r.phase_deltas) {
      const deltaStr = d.delta_ms == null ? '(new)' :
        (d.delta_ms > 0 ? `+${fmtMs(d.delta_ms)}` : fmtMs(d.delta_ms));
      out.push(`  ${pad(d.phase.slice(0, 28), 28)} ${padR(fmtMs(d.current_ms), 10)} ` +
        `${padR(d.previous_ms != null ? fmtMs(d.previous_ms) : '?', 10)} ${padR(deltaStr, 12)}`);
    }
  }
  out.push('');
  out.push(hr);

  return out.join('\n');
}

const report = analyze();
if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(renderHuman(report));
}
