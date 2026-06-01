#!/usr/bin/env node
/**
 * adr-create + the 4 ADR storage mechanisms — full op-matrix smoke.
 *
 * Exercises every operation (create / retrieve / get / search / query / update /
 * upsert / delete) on each of the 4 surfaces the `/adr-create` skill and the ADR
 * index write, end-to-end via `cli mcp exec` / `agentdb index` against the shared
 * ACCEPT_TEMP install (a Verdaccio better-sqlite3 path — the SQLite causal
 * carve-out refuses a markerless cwd, ADR-0069 Bug #3). Synthetic ADR-95xx /
 * ZZTEST ids never collide with the real 0001-029x corpus.
 *
 * The 4 surfaces (2 engines):
 *   1. hierarchical_memory  (SQLite)     — adr/<id> records   (adr-create + index)
 *   2. adr-patterns ns      (RVF + HNSW) — the pattern vector (adr-create + index)
 *   3. causal_edges         (SQLite)     — typed-relation edges (index only)
 *   4. causal-edges ns      (RVF + HNSW) — the edge-vector mirror (index only)
 *
 * Assertion blocks:
 *   E2E  — adr-create equivalent (surfaces 1+2 write + read-back + idempotency):
 *          replicate the skill's tool sequence for one synthetic ADR — write the
 *          .md, hierarchical-store adr/ADR-9510, memory_search adr-patterns,
 *          memory_store adr-patterns ADR-9510 — then assert surface 1 has exactly
 *          1 record, surface 2 retrieves the embedded value, and re-running both
 *          writes is idempotent (keyed upsert → no dupes; ADR-0281).
 *   S1   — hierarchical_memory (SQLite) full op matrix: create / upsert (1 row,
 *          latest wins) / query / recall (P6 — NON-erroring, not "Internal error")
 *          / delete (accepts '/') / post-delete query → 0.
 *   S2   — adr-patterns (RVF+HNSW) full op matrix: create (hasEmbedding) /
 *          retrieve (exact) / search (ranked) / list (enumerate) / upsert
 *          (in-place) / delete (hnswIndexInvalidated) / post-delete retrieve →
 *          found:false.
 *   S3   — causal_edges (SQLite) full op matrix on '/'-bearing ids: create (P3 —
 *          no SAVEPOINT desync) / query (P7 — >0, not a router-fallback 0) /
 *          update (re-edge same triple → 1 row, no duplication) / recall (P6 —
 *          non-erroring) / edge-delete (P5 — accepts '/') / node-delete (P4 — no
 *          'bind undefined' sql-error, accepts '/').
 *   S4   — causal-edges (RVF+HNSW) mirror + cross-surface reconciliation: index a
 *          4-ADR cross-referencing corpus with `--purge` TWICE, then assert
 *            A4 (reconcile): hierarchical == adr-patterns == ADR count; edges ==
 *               inverses (the index summary line);
 *            A3 (idempotent P1/P2): edge + record counts IDENTICAL across both
 *               --purge runs (SQLite causal_edges duplication would climb);
 *            S4a: memory_search causal-edges returns edge vectors;
 *            S4b: memory_stats namespaces['causal-edges'] == total causal_edges
 *               (mirror parity) and ['adr-patterns'] == ADR count.
 *
 * REGRESSION GUARDS (must FAIL if any ADR-0285 fix is reverted): S1 recall (P6),
 * S3 create (P3) / query (P7) / recall (P6) / edge-delete (P5) / node-delete
 * (P4), and S4 purge idempotency (P1/P2) + reconciliation (P8). Distinct from
 * scripts/smoke-adr0285-causal-crud-and-purge.mjs (the narrow '/'-id-asymmetry
 * regression) — this is the systematic op matrix across all 4 surfaces.
 *
 * Reuses the ACCEPT_TEMP install via ADR0255_SMOKE_SHARED_TEMP; standalone
 * self-installs from Verdaccio. Server-less (every op is a fresh `cli mcp exec`
 * process → authoritative durable reads, no RVF snapshot isolation). The
 * concurrent-index promise (live server alongside) is covered by smoke-adr0285.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  createSmokePerf,
  setupSmokeTempDir,
  installAndInit,
  findCli,
} from './lib/smoke-adr0255-shared.mjs';

const REGISTRY = process.env.REGISTRY || 'http://localhost:4873';
const LOG_DIR = process.env.SMOKE_LOG_DIR || '/tmp';
const LOG_FILE = join(LOG_DIR, `smoke-adr-create-storage-matrix-${process.pid}.log`);
const perf = createSmokePerf('smoke-adr-create-storage-matrix');

let passed = 0;
let failed = 0;
function log(msg) {
  process.stderr.write(`${msg}\n`);
  try { appendFileSync(LOG_FILE, `${msg}\n`); } catch {}
}
function pass(label) { passed++; log(`  PASS  ${label}`); }
function fail(label, reason) { failed++; log(`  FAIL  ${label}: ${reason}`); }

/** Extract the first balanced {...} object from `s` (ignores braces inside
 *  strings). Robust to pretty-printed multi-line JSON AND trailing daemon/stderr
 *  noise after the object. */
function extractBalanced(s, from = 0) {
  const start = s.indexOf('{', from);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}

/** Parse a `cli mcp exec` response: take the body after `Result:`, extract the
 *  balanced JSON object, unwrap a {content:[{text}]} envelope if present. */
function parseResult(raw) {
  if (/tool.+not found|not registered|unknown tool|no such tool|method .* not found|invalid tool/i.test(raw)) {
    return { __toolNotFound: true };
  }
  let body = raw;
  const idx = raw.search(/^Result:/m);
  if (idx >= 0) body = raw.slice(idx).replace(/^Result:/m, '');
  const json = extractBalanced(body, 0);
  if (json === null) return null;
  let obj;
  try { obj = JSON.parse(json); } catch { return null; }
  if (obj && Array.isArray(obj.content) && obj.content[0] && typeof obj.content[0].text === 'string') {
    try { obj = JSON.parse(obj.content[0].text); } catch { /* leave as-is */ }
  }
  return obj;
}

function mcpExec(cli, dir, tool, params) {
  const r = spawnSync(cli, ['mcp', 'exec', '--tool', tool, '--params', JSON.stringify(params)], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY },
  });
  return parseResult(`${r.stdout || ''}\n${r.stderr || ''}`);
}

/** Count results[] (or edges[]) in a tool response. */
function countResults(obj) {
  if (!obj || obj.__toolNotFound) return null;
  if (Array.isArray(obj.results)) return obj.results.length;
  if (Array.isArray(obj.edges)) return obj.edges.length;
  return null;
}
/** Count entries[] in a memory_list response. */
function countEntries(obj) {
  if (!obj || obj.__toolNotFound) return null;
  if (Array.isArray(obj.entries)) return obj.entries.length;
  return null;
}
/** Does any returned row reference `key` (top-level key/path, metadata.key, or
 *  content substring)? Defensive against result-item shape drift. */
function rowReferencesKey(obj, key) {
  const rows = Array.isArray(obj?.results) ? obj.results
    : Array.isArray(obj?.entries) ? obj.entries : [];
  return rows.some((r) =>
    r?.key === key || r?.path === key || r?.metadata?.key === key ||
    (typeof r?.content === 'string' && r.content.includes(key)));
}

function adrDoc(id, fm, title) {
  return `---\n${fm}\n---\n# ${title}\n\n## Context and Problem Statement\n\nSynthetic ADR ${id} for the adr-create storage op-matrix smoke. It exercises the 4 ADR storage surfaces (hierarchical records, adr-patterns vectors, causal edges, edge-vector mirror) and the idempotent reconciliation gate.\n`;
}

/** Parse the `agentdb index complete:` summary line into counts. Matches
 *  "… complete: 4/4 hierarchical records, 4 adr-patterns, 2 edges + 2 inverses". */
function parseIndexSummary(combined) {
  const line = (combined.split(/\n/).find((l) => /agentdb index complete:/i.test(l)) || '');
  const m = line.match(/complete:\s*(\d+)\s*\/\s*(\d+)\s*hierarchical records,\s*(\d+)\s*adr-patterns,\s*(\d+)\s*edges\s*\+\s*(\d+)\s*inverses/i);
  if (!m) return null;
  return {
    line: line.trim(),
    hierarchical: Number(m[1]),
    hierarchicalTotal: Number(m[2]),
    adrPatterns: Number(m[3]),
    edges: Number(m[4]),
    inverses: Number(m[5]),
  };
}

async function main() {
  log(`\n[adr-create storage-matrix smoke] 4-surface op matrix + reconciliation`);
  log(`[smoke] log: ${LOG_FILE}\n`);

  const { dir, shared } = setupSmokeTempDir('adr-create-storage-matrix', perf, REGISTRY);
  log(`[smoke] temp dir: ${dir}${shared ? ' (shared)' : ''}`);

  let testBodyStart;
  try {
    let cli = findCli(dir);
    if (!cli) cli = installAndInit(dir, perf, REGISTRY); // no shared install — slow path
    if (!cli) { fail('setup', 'cli not found'); return finish(dir, shared); }
    testBodyStart = process.hrtime.bigint();

    const ts = Date.now();

    // ════════════════════════════════════════════════════════════════════
    // E2E — adr-create equivalent (surfaces 1 + 2 write, read-back, idempotency)
    //   The /adr-create skill (steps 2-6): write the .md, hierarchical-store
    //   adr/ADR-NNNN, memory_search adr-patterns (related), memory_store
    //   adr-patterns ADR-NNNN. We replicate that tool sequence and assert both
    //   write surfaces landed + are idempotent on a re-run.
    // ════════════════════════════════════════════════════════════════════
    const e2eId = 'ADR-9510';
    const e2eKey = `adr/${e2eId}`;                       // surface 1 key (skill step 4)
    const e2eGlob = 'adr/ADR-9510*';
    const e2eTitle = `Adopt the adr-create storage op-matrix harness ${ts}`;
    const e2eMeta = JSON.stringify({ id: e2eId, title: e2eTitle, status: 'proposed', file: `docs/adr/${e2eId}-harness.md` });
    const e2ePattern = `${e2eTitle} — context: validate the four ADR storage surfaces end-to-end through the skill's own tool sequence.`;

    // skill step 4: hierarchical-store the record (surface 1 create)
    const e1 = mcpExec(cli, dir, 'agentdb_hierarchical-store', { key: e2eKey, value: e2eMeta, tier: 'semantic' });
    if (e1?.__toolNotFound) { fail('E2E-store', 'agentdb_hierarchical-store not registered — published build predates the hierarchical-* surface'); return finish(dir, shared); }
    if (e1?.success === true) pass(`E2E surface-1 create: hierarchical-store ${e2eKey} (adr-create step 4)`);
    else { fail('E2E-store', `hierarchical-store failed: ${JSON.stringify(e1).slice(0, 200)}`); }

    // skill step 5: memory_search adr-patterns for related (surface 2 read; empty OK)
    const e2search = mcpExec(cli, dir, 'memory_search', { query: e2eTitle, namespace: 'adr-patterns', limit: 5 });
    if (e2search?.__toolNotFound) { fail('E2E-search', 'memory_search not registered'); }
    else if (Array.isArray(e2search?.results)) pass(`E2E surface-2 read: memory_search adr-patterns returned a results[] (${e2search.results.length}; adr-create step 5 "find related")`);
    else fail('E2E-search', `memory_search did not return results[]: ${JSON.stringify(e2search).slice(0, 200)}`);

    // skill step 6: memory_store adr-patterns key=ADR-NNNN (surface 2 create)
    const e2store = mcpExec(cli, dir, 'memory_store', { key: e2eId, value: e2ePattern, namespace: 'adr-patterns' });
    if (e2store?.__toolNotFound) { fail('E2E-pattern-store', 'memory_store not registered'); }
    else if (e2store?.success === true && e2store?.stored === true) {
      pass(`E2E surface-2 create: memory_store adr-patterns ${e2eId} (stored=true, hasEmbedding=${e2store.hasEmbedding}, dim=${e2store.embeddingDimensions}; adr-create step 6)`);
      if (e2store.hasEmbedding !== true) fail('E2E-pattern-embedding', `adr-patterns write reported hasEmbedding=${e2store.hasEmbedding} — the pattern vector is the whole point of surface 2 (embedding pipeline did not run)`);
    } else fail('E2E-pattern-store', `memory_store adr-patterns failed: ${JSON.stringify(e2store).slice(0, 200)}`);

    // Verify surface 1: hierarchical-query → exactly 1, references our key.
    const e1q = mcpExec(cli, dir, 'agentdb_hierarchical-query', { pathPattern: e2eGlob });
    const e1n = countResults(e1q);
    if (e1n === 1) {
      pass(`E2E surface-1 read-back: hierarchical-query ${e2eGlob} → 1${rowReferencesKey(e1q, e2eKey) ? ` (references ${e2eKey})` : ''}`);
      if (!rowReferencesKey(e1q, e2eKey)) log(`  note  E2E hierarchical-query row did not surface key '${e2eKey}' in key/metadata.key/content (shape: ${JSON.stringify(e1q.results?.[0] ?? {}).slice(0, 160)})`);
    } else fail('E2E-query', `hierarchical-query ${e2eGlob} → ${e1n} (expected 1)`);

    // Verify surface 2: memory_retrieve → found, exact value.
    const e2r = mcpExec(cli, dir, 'memory_retrieve', { key: e2eId, namespace: 'adr-patterns' });
    if (e2r?.found === true && e2r?.value === e2ePattern) pass(`E2E surface-2 read-back: memory_retrieve ${e2eId} found, value exact (lossless)`);
    else if (e2r?.found === true) fail('E2E-retrieve-value', `retrieve found but value mismatch: got "${String(e2r.value).slice(0, 80)}…"`);
    else fail('E2E-retrieve', `memory_retrieve ${e2eId} not found: ${JSON.stringify(e2r).slice(0, 200)}`);

    // Idempotency: re-run BOTH writes (skill re-run / adr-index overlap), then
    // assert no duplication (keyed upsert — ADR-0281).
    mcpExec(cli, dir, 'agentdb_hierarchical-store', { key: e2eKey, value: e2eMeta, tier: 'semantic' });
    mcpExec(cli, dir, 'memory_store', { key: e2eId, value: e2ePattern, namespace: 'adr-patterns', upsert: true });
    const e1q2 = mcpExec(cli, dir, 'agentdb_hierarchical-query', { pathPattern: e2eGlob });
    if (countResults(e1q2) === 1) pass(`E2E idempotency: re-running adr-create writes kept surface 1 at exactly 1 record (keyed upsert, ADR-0281 — adr-create safe to re-run)`);
    else fail('E2E-idempotency', `surface 1 grew to ${countResults(e1q2)} after re-running adr-create writes (append, not upsert)`);

    // ════════════════════════════════════════════════════════════════════
    // S1 — hierarchical_memory (SQLite) full op matrix
    // ════════════════════════════════════════════════════════════════════
    const s1Key = `adr/ZZTEST-S1-${ts}`;                  // '/'-bearing (ADR-0281 R3)
    const s1Glob = `adr/ZZTEST-S1-${ts}*`;
    const s1v1 = `s1-first-${ts}`;
    const s1v2 = `s1-second-${ts}`;

    const s1c = mcpExec(cli, dir, 'agentdb_hierarchical-store', { key: s1Key, value: s1v1, tier: 'semantic' });
    if (s1c?.success === true) pass(`S1 create: hierarchical-store ${s1Key}`);
    else fail('S1-create', `hierarchical-store failed: ${JSON.stringify(s1c).slice(0, 200)}`);

    // upsert: re-store same key, new value → exactly 1, latest wins.
    mcpExec(cli, dir, 'agentdb_hierarchical-store', { key: s1Key, value: s1v2, tier: 'semantic' });
    const s1q = mcpExec(cli, dir, 'agentdb_hierarchical-query', { pathPattern: s1Glob });
    if (countResults(s1q) === 1) {
      pass(`S1 upsert: re-store same key kept exactly 1 row (ADR-0281 keyed upsert)`);
      const content = s1q.results?.[0]?.content;
      if (typeof content === 'string' && content !== s1v2) fail('S1-upsert-latest', `latest write did not win: surviving content "${content}" != "${s1v2}"`);
    } else fail('S1-upsert', `key glob ${s1Glob} → ${countResults(s1q)} (expected 1; store is appending)`);

    // query/get: already exercised above — assert the row references the key.
    if (countResults(s1q) === 1) {
      if (rowReferencesKey(s1q, s1Key)) pass(`S1 query: hierarchical-query ${s1Glob} surfaced the key`);
      else log(`  note  S1 query row did not surface key '${s1Key}' (shape: ${JSON.stringify(s1q.results?.[0] ?? {}).slice(0, 160)})`);
    }

    // search/recall: NON-erroring (P6 — not {success:false, error:"Internal error"}).
    const s1recall = mcpExec(cli, dir, 'agentdb_hierarchical-recall', { query: s1v2, k: 5 });
    if (s1recall?.__toolNotFound) fail('S1-recall', 'agentdb_hierarchical-recall not registered');
    else if (s1recall?.success === true && Array.isArray(s1recall.results)) pass(`S1 recall (P6): hierarchical-recall non-error (success:true, ${s1recall.results.length} result(s)) — not "Internal error"`);
    else fail('S1-recall', `hierarchical-recall did not return success+results (P6 sql.js NAMED-bind regression): ${typeof s1recall?.error === 'string' ? s1recall.error : JSON.stringify(s1recall).slice(0, 200)}`);

    // delete: accepts '/' (ADR-0281 R3), real delete.
    const s1d = mcpExec(cli, dir, 'agentdb_hierarchical-delete', { key: s1Key });
    if (s1d?.deleted === true) pass(`S1 delete: hierarchical-delete ${s1Key} removed the entry ('/' accepted, controller=${s1d.controller})`);
    else fail('S1-delete', `delete failed / rejected '/': ${JSON.stringify(s1d).slice(0, 200)}`);

    // post-delete: query → 0.
    const s1q2 = mcpExec(cli, dir, 'agentdb_hierarchical-query', { pathPattern: s1Glob });
    if (countResults(s1q2) === 0) pass(`S1 post-delete: hierarchical-query ${s1Glob} → 0 (delete-by-key works end-to-end)`);
    else fail('S1-post-delete', `expected 0 after delete; got ${countResults(s1q2)}`);

    // ════════════════════════════════════════════════════════════════════
    // S2 — adr-patterns (RVF + HNSW) full op matrix
    // ════════════════════════════════════════════════════════════════════
    const s2Key = `ADR-ZZTEST-S2-${ts}`;
    const s2v1 = `s2 first value — distinctive token zzs2alpha ${ts}`;
    const s2v2 = `s2 second value — distinctive token zzs2bravo ${ts}`;

    const s2c = mcpExec(cli, dir, 'memory_store', { key: s2Key, value: s2v1, namespace: 'adr-patterns' });
    if (s2c?.success === true && s2c?.stored === true) {
      pass(`S2 create: memory_store adr-patterns ${s2Key} (hasEmbedding=${s2c.hasEmbedding}, dim=${s2c.embeddingDimensions})`);
      if (s2c.hasEmbedding !== true) fail('S2-create-embedding', `hasEmbedding=${s2c.hasEmbedding} — surface-2 create must embed the value (HNSW vector)`);
    } else fail('S2-create', `memory_store adr-patterns failed: ${JSON.stringify(s2c).slice(0, 200)}`);

    // retrieve/get: exact (namespace,key) → found, lossless value.
    const s2r = mcpExec(cli, dir, 'memory_retrieve', { key: s2Key, namespace: 'adr-patterns' });
    if (s2r?.found === true && s2r?.value === s2v1) pass(`S2 retrieve: memory_retrieve ${s2Key} found, value exact (hasEmbedding=${s2r.hasEmbedding})`);
    else fail('S2-retrieve', `retrieve mismatch: found=${s2r?.found} value="${String(s2r?.value).slice(0, 60)}"`);

    // search: semantic HNSW ranked results carrying similarity scores.
    const s2search = mcpExec(cli, dir, 'memory_search', { query: `distinctive token zzs2alpha ${ts}`, namespace: 'adr-patterns', limit: 10 });
    const s2sn = countResults(s2search);
    if (s2sn === null) fail('S2-search', `no results[]: ${JSON.stringify(s2search).slice(0, 200)}`);
    else if (s2sn >= 1 && typeof s2search.results[0]?.similarity === 'number') pass(`S2 search: memory_search adr-patterns → ${s2sn} ranked result(s) with similarity scores${rowReferencesKey(s2search, s2Key) ? ` (incl. ${s2Key})` : ''}`);
    else fail('S2-search', `expected ≥1 ranked result with a similarity score; got ${s2sn} (first: ${JSON.stringify(s2search.results?.[0] ?? {}).slice(0, 120)})`);

    // list: enumerate the namespace (no semantic search).
    const s2list = mcpExec(cli, dir, 'memory_list', { namespace: 'adr-patterns', limit: 100 });
    const s2ln = countEntries(s2list);
    if (s2ln === null) fail('S2-list', `no entries[]: ${JSON.stringify(s2list).slice(0, 200)}`);
    else if (s2ln >= 1 && rowReferencesKey(s2list, s2Key)) pass(`S2 list: memory_list adr-patterns enumerated ${s2ln} entr(ies) (total=${s2list.total}), incl. ${s2Key}`);
    else if (s2ln >= 1) { pass(`S2 list: memory_list adr-patterns enumerated ${s2ln} entr(ies) (total=${s2list.total})`); log(`  note  S2 list did not surface ${s2Key} in the first page`); }
    else fail('S2-list', `expected ≥1 entry; got ${s2ln}`);

    // update/upsert: store same key, new value → replaced in place (retrieve new).
    const s2u = mcpExec(cli, dir, 'memory_store', { key: s2Key, value: s2v2, namespace: 'adr-patterns', upsert: true });
    const s2r2 = mcpExec(cli, dir, 'memory_retrieve', { key: s2Key, namespace: 'adr-patterns' });
    if (s2u?.success === true && s2r2?.value === s2v2) pass(`S2 upsert: memory_store upsert:true replaced the value in place (retrieve → new value)`);
    else fail('S2-upsert', `upsert did not replace in place: store=${JSON.stringify(s2u).slice(0, 120)} retrieve.value="${String(s2r2?.value).slice(0, 60)}"`);

    // delete: deleted + hnswIndexInvalidated; post-delete retrieve → found:false.
    const s2d = mcpExec(cli, dir, 'memory_delete', { key: s2Key, namespace: 'adr-patterns' });
    if (s2d?.deleted === true && s2d?.hnswIndexInvalidated === true) {
      pass(`S2 delete: memory_delete ${s2Key} (deleted=true, hnswIndexInvalidated=true)`);
      const s2r3 = mcpExec(cli, dir, 'memory_retrieve', { key: s2Key, namespace: 'adr-patterns' });
      if (s2r3?.found === false) pass(`S2 post-delete: memory_retrieve ${s2Key} → found:false`);
      else fail('S2-post-delete', `expected found:false after delete; got found=${s2r3?.found}`);
    } else fail('S2-delete', `expected deleted:true + hnswIndexInvalidated:true; got ${JSON.stringify(s2d).slice(0, 200)}`);

    // ════════════════════════════════════════════════════════════════════
    // S3 — causal_edges (SQLite) full op matrix on '/'-bearing ids
    // ════════════════════════════════════════════════════════════════════
    const s3A = `adr/ZZTEST-S3-${ts}-A`;
    const s3B = `adr/ZZTEST-S3-${ts}-B`;

    // create (P3): edge between '/'-bearing ids — no SAVEPOINT desync.
    const s3c = mcpExec(cli, dir, 'agentdb_causal-edge', { sourceId: s3A, targetId: s3B, relation: 'depends-on', weight: 1 });
    if (s3c?.__toolNotFound) { fail('S3-create', 'agentdb_causal-edge not registered — published build predates the causal-* surface'); }
    else if (s3c?.success === true) pass(`S3 create (P3): causal-edge ${s3A} → ${s3B} accepted '/'-bearing ids (no SAVEPOINT desync, controller=${s3c.controller})`);
    else fail('S3-create', `causal-edge create failed (P3 SAVEPOINT/bind desync): ${JSON.stringify(s3c).slice(0, 200)}`);

    // query (P7): the cause → ≥1 edge (not a router-fallback 0).
    const s3q = mcpExec(cli, dir, 'agentdb_causal-query', { cause: s3A, k: 10 });
    const s3qn = countResults(s3q);
    if (s3qn === null) fail('S3-query', `no results[]/edges[]: ${JSON.stringify(s3q).slice(0, 200)}`);
    else if (s3qn >= 1) pass(`S3 query (P7): causal-query cause='${s3A}' → ${s3qn} edge(s) (controller=${s3q.controller ?? '(none)'}; not a router-fallback 0)`);
    else fail('S3-query', `causal-query returned 0 for a valid cause (P7 id-resolution regression)`);

    // update: re-create the SAME triple (new weight) → one row per triple (no dup).
    mcpExec(cli, dir, 'agentdb_causal-edge', { sourceId: s3A, targetId: s3B, relation: 'depends-on', weight: 5 });
    const s3q2 = mcpExec(cli, dir, 'agentdb_causal-query', { cause: s3A, k: 10 });
    if (countResults(s3q2) === s3qn) pass(`S3 update: re-creating the same (from,to,relation) triple kept ${s3qn} row(s) — one row per triple, no duplication`);
    else fail('S3-update', `re-creating the same triple changed the edge count ${s3qn} → ${countResults(s3q2)} (should upsert, not append)`);

    // recall (P6): causal-recall NON-erroring.
    const s3recall = mcpExec(cli, dir, 'agentdb_causal-recall', { query: 'storage op matrix dependency', k: 5 });
    if (s3recall?.__toolNotFound) fail('S3-recall', 'agentdb_causal-recall not registered');
    else if (s3recall?.success === true && Array.isArray(s3recall.results)) pass(`S3 recall (P6): causal-recall non-error (success:true, ${s3recall.results.length} result(s)) — not "Internal error"`);
    else fail('S3-recall', `causal-recall did not return success+results (P6): ${typeof s3recall?.error === 'string' ? s3recall.error : JSON.stringify(s3recall).slice(0, 200)}`);

    // edge-delete (P5): accepts the SAME '/'-bearing ids create accepted.
    const s3ed = mcpExec(cli, dir, 'agentdb_causal-edge-delete', { sourceId: s3A, targetId: s3B, relation: 'depends-on' });
    if (s3ed?.success === true || s3ed?.deleted === true) pass(`S3 edge-delete (P5): causal-edge-delete accepted '/'-bearing ids (deleted=${s3ed.deleted}, controller=${s3ed.controller ?? '(none)'})`);
    else fail('S3-edge-delete', `causal-edge-delete rejected '/'-bearing ids create accepted (P5 asymmetric charset gate): ${typeof s3ed?.error === 'string' ? s3ed.error : JSON.stringify(s3ed).slice(0, 200)}`);

    // node-delete (P4): accepts '/'-bearing nodeId; no 'bind undefined' sql-error.
    const s3nd = mcpExec(cli, dir, 'agentdb_causal-node-delete', { nodeId: s3B });
    if (s3nd?.success === true || s3nd?.deletedNode === true || s3nd?.deleted === true) pass(`S3 node-delete (P4): causal-node-delete '${s3B}' (deletedNode=${s3nd.deletedNode ?? s3nd.deleted}, deletedEdges=${s3nd.deletedEdges ?? 0}; no 'bind undefined' sql-error)`);
    else fail('S3-node-delete', `causal-node-delete rejected '/'-bearing nodeId (P4 charset gate / 'bind undefined'): ${typeof s3nd?.error === 'string' ? s3nd.error : JSON.stringify(s3nd).slice(0, 200)}`);

    // ════════════════════════════════════════════════════════════════════
    // S4 — causal-edges (RVF+HNSW) mirror + cross-surface reconciliation.
    //   Index a 4-ADR cross-referencing corpus with --purge TWICE.
    //   ADR-9510 standalone (E2E subject); ADR-9501 supersedes 9502, depends-on
    //   9503 → 2 forward edges + 2 inverses.
    // ════════════════════════════════════════════════════════════════════
    const adrDir = join(dir, `adr-matrix-corpus-${ts}`);
    mkdirSync(adrDir, { recursive: true });
    const ADR_COUNT = 4;
    writeFileSync(join(adrDir, 'ADR-9510-harness.md'),
      adrDoc('ADR-9510', 'status: accepted\ndate: 2026-06-01\ntags: [smoke]\nsupersedes: []\ndepends-on: []\nimplements: []', 'Storage Matrix Harness 9510'));
    writeFileSync(join(adrDir, 'ADR-9501-root.md'),
      adrDoc('ADR-9501', 'status: accepted\ndate: 2026-06-01\ntags: [smoke]\nsupersedes: [ADR-9502]\ndepends-on: [ADR-9503]\nimplements: []', 'Storage Matrix Root 9501'));
    writeFileSync(join(adrDir, 'ADR-9502-superseded.md'),
      adrDoc('ADR-9502', 'status: accepted\ndate: 2026-06-01\ntags: [smoke]\nsupersedes: []\ndepends-on: []\nimplements: []', 'Storage Matrix Superseded 9502'));
    writeFileSync(join(adrDir, 'ADR-9503-dep.md'),
      adrDoc('ADR-9503', 'status: accepted\ndate: 2026-06-01\ntags: [smoke]\nsupersedes: []\ndepends-on: []\nimplements: []', 'Storage Matrix Dep 9503'));

    const runIndex = (label) => {
      const t0 = Date.now();
      const r = spawnSync(cli, ['agentdb', 'index', '--dir', adrDir, '--purge'],
        { cwd: dir, encoding: 'utf8', timeout: 240000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NPM_CONFIG_REGISTRY: REGISTRY } });
      const combined = `${r.stdout || ''}\n${r.stderr || ''}`;
      const summary = parseIndexSummary(combined);
      log(`[smoke] index --purge (${label}): status=${r.status} ${Date.now() - t0}ms → ${summary ? summary.line : '(no summary line)'}`);
      return { r, combined, summary };
    };

    const run1 = runIndex('run1');
    if (/Unknown command|not found/i.test(run1.combined) && /agentdb/i.test(run1.combined) && run1.r.status !== 0 && !/index complete|index:/i.test(run1.combined)) {
      fail('S4-command-missing', 'agentdb index not registered — published build predates ADR-0273');
      return finish(dir, shared);
    }

    // A4 (P8): run1 reconciles (exit 0; hierarchical==adr-patterns==count; edges==inverses).
    if (run1.r.status !== 0) fail('S4-reindex-exit', `index --purge exit=${run1.r.status}: ${run1.combined.slice(0, 200)}`);
    else if (!run1.summary) fail('S4-reindex-summary', `no parseable "complete:" summary line: ${run1.combined.slice(-300)}`);
    else {
      const s = run1.summary;
      const reconHier = s.hierarchical === ADR_COUNT && s.hierarchicalTotal === ADR_COUNT && s.adrPatterns === ADR_COUNT;
      const reconEdges = s.edges === s.inverses && s.edges > 0;
      if (reconHier && reconEdges) pass(`S4/A4 reconcile (P8): ${s.hierarchical}/${s.hierarchicalTotal} hierarchical == ${s.adrPatterns} adr-patterns == ${ADR_COUNT} ADRs; ${s.edges} edges == ${s.inverses} inverses (exit 0)`);
      else {
        if (!reconHier) fail('S4-recon-hierarchical', `hierarchical(${s.hierarchical}/${s.hierarchicalTotal}) / adr-patterns(${s.adrPatterns}) != ADR count(${ADR_COUNT}) — surfaces not reconciled`);
        if (!reconEdges) fail('S4-recon-edges', `edges(${s.edges}) != inverses(${s.inverses}) or 0 — forward/inverse mirror not reconciled`);
      }
    }

    // A3 (P1/P2): second --purge → identical edge + record counts.
    const run2 = runIndex('run2');
    if (run2.r.status !== 0) fail('S4-reindex2-exit', `second index --purge exit=${run2.r.status}: ${run2.combined.slice(0, 200)}`);
    else if (!run1.summary || !run2.summary) fail('S4-purge-idempotency', `cannot compare runs — missing summary (run1=${!!run1.summary}, run2=${!!run2.summary})`);
    else {
      const edgesStable = run2.summary.edges === run1.summary.edges && run2.summary.inverses === run1.summary.inverses;
      const recordsStable = run2.summary.hierarchical === run1.summary.hierarchical && run2.summary.adrPatterns === run1.summary.adrPatterns;
      if (edgesStable && recordsStable) pass(`S4/A3 idempotent (P1/P2): two --purge runs identical — edges ${run1.summary.edges}→${run2.summary.edges}, inverses ${run1.summary.inverses}→${run2.summary.inverses}, records ${run1.summary.hierarchical}→${run2.summary.hierarchical} (no growth)`);
      else {
        if (!edgesStable) fail('S4-edge-growth', `edge count changed across --purge runs (${run1.summary.edges}+${run1.summary.inverses} → ${run2.summary.edges}+${run2.summary.inverses}) — P1: SQLite causal_edges not cleared by --purge`);
        if (!recordsStable) fail('S4-record-growth', `record count changed across --purge runs (${run1.summary.hierarchical}/${run1.summary.adrPatterns} → ${run2.summary.hierarchical}/${run2.summary.adrPatterns})`);
      }
    }

    // S4a: causal-edges namespace search returns edge vectors (the RVF mirror).
    const s4search = mcpExec(cli, dir, 'memory_search', { query: 'supersedes depends-on storage matrix', namespace: 'causal-edges', limit: 10 });
    const s4sn = countResults(s4search);
    if (s4sn === null) fail('S4a-search', `memory_search causal-edges returned no results[]: ${JSON.stringify(s4search).slice(0, 200)}`);
    else if (s4sn >= 1) pass(`S4a search: memory_search causal-edges → ${s4sn} edge vector(s) (the D9 RVF+HNSW mirror is populated + queryable)`);
    else fail('S4a-search', `memory_search causal-edges → 0 — the edge-vector mirror (surface 4) is empty after index (D9 mirror not written)`);

    // S4b: memory_stats namespace parity (fresh process → authoritative durable count).
    const stats = mcpExec(cli, dir, 'memory_stats', {});
    const ns = stats?.namespaces && typeof stats.namespaces === 'object' ? stats.namespaces : null;
    if (!ns) fail('S4b-stats', `memory_stats returned no namespaces map: ${JSON.stringify(stats).slice(0, 200)}`);
    else {
      const patternsCount = ns['adr-patterns'];
      const edgeMirror = ns['causal-edges'];
      const expectedEdges = run1.summary ? run1.summary.edges + run1.summary.inverses : null; // total causal_edges
      if (patternsCount === ADR_COUNT) pass(`S4b parity: memory_stats namespaces['adr-patterns'] == ${ADR_COUNT} (== ADR count)`);
      else fail('S4b-patterns-parity', `namespaces['adr-patterns'] == ${patternsCount} (expected ${ADR_COUNT})`);
      if (expectedEdges !== null && edgeMirror === expectedEdges) pass(`S4b parity: memory_stats namespaces['causal-edges'] == ${edgeMirror} (== ${run1.summary.edges} edges + ${run1.summary.inverses} inverses — RVF mirror matches SQLite causal_edges)`);
      else fail('S4b-edge-parity', `namespaces['causal-edges'] == ${edgeMirror} (expected ${expectedEdges} = edges+inverses; surface-4 RVF mirror not at parity with surface-3 SQLite causal_edges)`);
    }

    try { rmSync(adrDir, { recursive: true, force: true }); } catch {}

  } catch (e) {
    fail('main', e?.stack || String(e));
  } finally {
    if (testBodyStart) perf.mark('test-body', testBodyStart);
    try { if (!shared) rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  finish(dir, shared);
}

function finish(dir, shared) {
  try { if (dir && shared === false) rmSync(dir, { recursive: true, force: true }); } catch {}
  perf.emitJson();
  log(`\n[adr-create storage-matrix smoke] ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    log(`\nSmoke FAILED — the adr-create 4-surface storage contract is incomplete (a surface op, an ADR-0285 regression guard, or the reconciliation invariant broke).\n`);
    process.exit(1);
  }
  log(`\nSmoke PASSED — adr-create + the 4 ADR storage mechanisms hold: every op (create/retrieve/get/search/query/update/upsert/delete) round-trips on all 4 surfaces, the ADR-0285 fixes are locked in, and --purge is idempotent + reconciles every surface.\n`);
  process.exit(0);
}

main().catch((e) => { fail('main', e?.stack || String(e)); finish(); });
