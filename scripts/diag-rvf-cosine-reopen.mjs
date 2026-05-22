#!/usr/bin/env node
// Behavioral reproduction for the ADR-0073 amendment (2026-05-22): a reopened
// RVF store reports metric `l2` (the metric is not persisted — RuVector
// rvf-runtime `try_open_once` rebuilds RvfOptions with `..Default::default()`),
// so the native search path must score cosine DIRECTLY. If it converts
// `1 - r.distance` instead, the L2² distance (`2 - 2cos` for unit vectors)
// becomes `2cos - 1` (negative for merely-related content).
//
// We force the native (NOT pure-TS-fallback) path: create + close to lay down
// the file, then REOPEN (handle metric → l2) and store the probe doc on that
// handle so its numId is mapped in THIS process (no orphan-self-heal detour).
// Searching a related query then runs the native ANN scorer against the l2
// handle.
//
// PASS: the related doc is returned with score ≈ its TRUE cosine (computed
// independently here). FAIL (pre-fix): score is `2cos - 1` — far from true
// cosine, and negative for the related vector below.
//
// Run from the acceptance tier (consistent installed native+JS via
// loadRvfBackend). Narrow skip (ADR-0082) when no backend resolves.

import { loadRvfBackend, LOAD_RVF_SKIP_REASON_REGEX } from '../tests/helpers/load-rvf.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DIM = 8;
const unit = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n); };
const cosine = (a, b) => {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na) * Math.sqrt(nb));
};

// Related (not identical) query/doc — true cosine ≈ 0.45, so a `2cos-1`
// regression yields ≈ -0.10 (negative; clearly != true cosine).
const QUERY = unit([1, 0.5, 0, 0, 0, 0, 0, 0]);
const DOC = unit([0.5, 1, 0, 0, 0, 0, 0, 0]);
const TRUE_COS = cosine(QUERY, DOC);

function entry(key, embedding) {
  const now = Date.now();
  return {
    id: key, key, namespace: 'cos-reopen', content: `content for ${key}`,
    type: 'semantic', tags: [], metadata: {}, accessLevel: 'private',
    ownerId: 'diag', createdAt: now, updatedAt: now, accessCount: 0,
    lastAccessedAt: now, version: 1, embedding: new Float32Array(embedding),
  };
}

const { RvfBackend, source, error } = await loadRvfBackend();
if (!RvfBackend) {
  if (!LOAD_RVF_SKIP_REASON_REGEX.test(error || '')) {
    console.log(`FAIL: unexpected load error (not a narrow skip): ${error}`);
    process.exit(1);
  }
  console.log(`SKIP: ${error}`);
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), 'rvf-cos-reopen-'));
const dbPath = join(dir, 'mem.rvf');
let detail = '';
let ok = false;
try {
  // 1. Create the file (cosine handle), then close — lays down the store.
  const a = new RvfBackend({ databasePath: dbPath, dimensions: DIM, autoPersistInterval: 0 });
  await a.initialize();
  await a.shutdown();

  // 2. REOPEN (handle metric → l2). Store the probe doc on THIS handle so it is
  //    mapped in-process (forces the native scorer, not the orphan→pure-TS path).
  const b = new RvfBackend({ databasePath: dbPath, dimensions: DIM, autoPersistInterval: 0 });
  await b.initialize();
  await b.store(entry('doc', DOC));
  // threshold:-1 so a (buggy) negative score is still returned — we assert the
  // VALUE, not just presence.
  const results = await b.search(new Float32Array(QUERY), { k: 5, threshold: -1 });
  await b.shutdown();

  const hit = (results || []).find((r) => r?.entry?.key === 'doc');
  if (!hit) {
    detail = `doc not returned (results=${(results || []).length}); backend=${source}`;
  } else {
    detail = `score=${hit.score.toFixed(3)} trueCos=${TRUE_COS.toFixed(3)} backend=${source}`;
    ok = Math.abs(hit.score - TRUE_COS) < 0.05; // must equal true cosine, not 2cos-1
  }
} catch (e) {
  detail = `error: ${e?.message ?? String(e)}`;
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (ok) {
  console.log(`PASS: reopened (l2) native search scored true cosine — ${detail}`);
  process.exit(0);
}
console.log(`FAIL: reopened native search score is not true cosine (2cos-1 regression?) — ${detail}`);
process.exit(1);
