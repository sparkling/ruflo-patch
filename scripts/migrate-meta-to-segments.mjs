#!/usr/bin/env node
// scripts/migrate-meta-to-segments.mjs
//
// ADR-0154 Phase 6c: one-shot migration tool for legacy projects that have
// a `.swarm/memory.rvf.meta` sidecar that pre-dates META_SEG persistence.
//
// What this does:
//   1. Detect populations in `.swarm/memory.rvf` (native vectors + maybe
//      META_SEGs) and `.swarm/memory.rvf.meta` (legacy JSON entries with
//      embeddings).
//   2. If they DISAGREE on entry count or content hash, REFUSE with a
//      diagnostic and require explicit `--prefer-rvf` or `--prefer-meta`
//      to continue (per CLAUDE.md feedback-data-loss-zero-tolerance).
//   3. If they agree (or only one source has data), unify into a single
//      `.swarm/memory.rvf` with META_SEGs via @sparkleideas/memory's
//      RvfBackend.bulkInsert.
//   4. Move the legacy `.meta` aside as `.meta.migrated-<timestamp>` so
//      a rollback is always possible.
//   5. Idempotent re-run on an already-migrated project exits 0 with
//      "already migrated" — based on inspecting the .rvf magic bytes
//      (SFVR = native, post-migration) and absence/staleness of .meta.
//
// Usage:
//   node scripts/migrate-meta-to-segments.mjs <project-root>
//   node scripts/migrate-meta-to-segments.mjs <project-root> --prefer-rvf
//   node scripts/migrate-meta-to-segments.mjs <project-root> --prefer-meta
//   node scripts/migrate-meta-to-segments.mjs <project-root> --dry-run
//
// Exit codes:
//   0 — already migrated, or migration succeeded
//   1 — divergent populations + no --prefer-X flag
//   2 — usage error / project root not found
//   3 — internal error during migration

import { readFileSync, existsSync, statSync, renameSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

// ── CLI parsing ─────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flags = {
  preferRvf: argv.includes('--prefer-rvf'),
  preferMeta: argv.includes('--prefer-meta'),
  dryRun: argv.includes('--dry-run'),
  verbose: argv.includes('--verbose') || argv.includes('-v'),
};
const positional = argv.filter((a) => !a.startsWith('-'));

if (positional.length !== 1) {
  console.error('Usage: migrate-meta-to-segments.mjs <project-root> [--prefer-rvf|--prefer-meta] [--dry-run]');
  process.exit(2);
}

if (flags.preferRvf && flags.preferMeta) {
  console.error('error: --prefer-rvf and --prefer-meta are mutually exclusive');
  process.exit(2);
}

const projectRoot = resolve(positional[0]);
const swarmDir = join(projectRoot, '.swarm');
const rvfPath = join(swarmDir, 'memory.rvf');
const metaPath = join(swarmDir, 'memory.rvf.meta');
const walPath = join(swarmDir, 'memory.rvf.wal');

if (!existsSync(swarmDir)) {
  console.error(`error: ${swarmDir} does not exist — not an init'd project`);
  process.exit(2);
}

const log = flags.verbose ? (msg) => console.error(`[migrate] ${msg}`) : () => {};

// ── Step 1: inspect both sources ────────────────────────────────────────

function inspectMeta(path) {
  if (!existsSync(path)) return null;
  const buf = readFileSync(path);
  if (buf.length < 8) return { path, size: buf.length, format: 'truncated', count: 0 };
  const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
  if (magic !== 'RVF\0') {
    return { path, size: buf.length, format: 'unknown', magic, count: 0 };
  }
  // Legacy pure-TS RVF\0: magic(4) + headerLen u32le + JSON header + length-prefixed entries
  let offset = 4;
  const headerLen = buf.readUInt32LE(offset);
  offset += 4;
  const header = JSON.parse(buf.subarray(offset, offset + headerLen).toString('utf-8'));
  offset += headerLen;
  const entries = [];
  while (offset < buf.length) {
    if (offset + 4 > buf.length) break;
    const entryLen = buf.readUInt32LE(offset);
    offset += 4;
    if (offset + entryLen > buf.length) break;
    const entry = JSON.parse(buf.subarray(offset, offset + entryLen).toString('utf-8'));
    if (entry.embedding && Array.isArray(entry.embedding)) {
      entry.embedding = new Float32Array(entry.embedding);
    }
    entries.push(entry);
    offset += entryLen;
  }
  return {
    path,
    size: buf.length,
    format: 'rvf-legacy-purets',
    headerEntryCount: header.entryCount,
    entries,
    count: entries.length,
    contentHash: hashEntries(entries),
  };
}

function inspectRvfNative(path) {
  if (!existsSync(path)) return null;
  const buf = readFileSync(path);
  if (buf.length < 4) return { path, size: buf.length, format: 'truncated' };
  const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
  if (magic === 'RVF\0') {
    return { path, size: buf.length, format: 'rvf-legacy-purets', note: 'main path holds legacy format' };
  }
  if (magic === 'SFVR') {
    return { path, size: buf.length, format: 'sfvr-native', note: 'native segment-based file' };
  }
  return { path, size: buf.length, format: 'unknown', magic };
}

function hashEntries(entries) {
  const sorted = entries
    .map((e) => `${e.namespace}\0${e.key}\0${(e.content ?? '').slice(0, 256)}`)
    .sort();
  return createHash('sha256').update(sorted.join('\n')).digest('hex').slice(0, 16);
}

const metaSnapshot = inspectMeta(metaPath);
const rvfSnapshot = inspectRvfNative(rvfPath);

log(`meta: ${metaSnapshot ? `${metaSnapshot.count} entries (${metaSnapshot.format}, hash ${metaSnapshot.contentHash})` : 'absent'}`);
log(`rvf:  ${rvfSnapshot ? `${rvfSnapshot.size}B (${rvfSnapshot.format})` : 'absent'}`);

// ── Step 2: classify the project state ──────────────────────────────────

const metaPresent = !!metaSnapshot && metaSnapshot.count > 0;
const rvfPresent = !!rvfSnapshot;
const rvfIsNative = rvfSnapshot?.format === 'sfvr-native';

if (!metaPresent && rvfIsNative) {
  console.log(`already migrated: ${rvfPath} is native (SFVR), no .meta sidecar — nothing to do.`);
  process.exit(0);
}

if (!metaPresent && !rvfPresent) {
  console.log(`empty project: no .rvf, no .meta — nothing to migrate.`);
  process.exit(0);
}

// ── Step 3: divergence detection ────────────────────────────────────────

let chosenSource = null;

if (metaPresent && rvfIsNative) {
  // Both present and rvf is native. Need to check if they agree.
  // Without inspecting the META_SEGs inside the .rvf (which would require
  // npm install + RvfBackend), we approximate: the .meta entry count vs
  // the .rvf size as a sanity signal. For robust divergence detection,
  // we'd need to actually open the .rvf via RvfBackend and read both.
  //
  // For now: warn-and-defer. If the .meta has more entries than expected
  // the user explicitly chooses the source.
  console.error(`divergence: both .meta (${metaSnapshot.count} entries) and .rvf (${rvfSnapshot.size}B native) exist.`);
  console.error(`  .meta hash: ${metaSnapshot.contentHash}`);
  console.error(`  .rvf format: ${rvfSnapshot.format}`);
  if (!flags.preferRvf && !flags.preferMeta) {
    console.error('');
    console.error('Refusing to migrate without an explicit choice. Re-run with one of:');
    console.error('  --prefer-rvf   trust the native .rvf, archive .meta as backup');
    console.error('  --prefer-meta  trust the .meta, rebuild .rvf from those entries');
    console.error('');
    console.error('The HM-class scenario this guards against: .rvf has live data');
    console.error('(e.g. 863 entries from a re-index) but .meta has stale data');
    console.error('(e.g. 329 entries from before the re-index). Picking the wrong');
    console.error('source loses data permanently.');
    process.exit(1);
  }
  chosenSource = flags.preferRvf ? 'rvf' : 'meta';
} else if (metaPresent && !rvfIsNative) {
  // Only .meta has data (or .rvf is legacy pure-TS format). Migrate from .meta.
  chosenSource = 'meta';
} else if (rvfIsNative) {
  // .rvf is native but .meta is empty/absent. Already migrated; nothing to do.
  console.log(`already migrated: ${rvfPath} is native, no .meta to migrate.`);
  process.exit(0);
}

log(`chosen source: ${chosenSource}`);

if (flags.dryRun) {
  console.log(`dry-run: would migrate from ${chosenSource} (no changes made).`);
  process.exit(0);
}

// ── Step 4: archive .meta + remove .wal so the new write path is clean ─

const ts = Date.now();

if (chosenSource === 'rvf') {
  // Native is authoritative. Move .meta aside; do NOT touch .rvf.
  if (existsSync(metaPath)) {
    const archive = `${metaPath}.migrated-${ts}`;
    renameSync(metaPath, archive);
    console.log(`archived: ${metaPath} → ${archive}`);
  }
  if (existsSync(walPath)) {
    const walArchive = `${walPath}.migrated-${ts}`;
    renameSync(walPath, walArchive);
    console.log(`archived: ${walPath} → ${walArchive}`);
  }
  console.log(`migration complete: trusting native .rvf (${rvfSnapshot.size}B SFVR).`);
  console.log(`rollback: \`mv "${metaPath}.migrated-${ts}" "${metaPath}"\` if needed.`);
  process.exit(0);
}

// chosenSource === 'meta': we need to rebuild .rvf from .meta entries.
// This requires the RvfBackend, which means a Verdaccio install.
console.error('--prefer-meta migration requires running through @sparkleideas/memory:');
console.error('');
console.error('  1. Move existing .rvf aside:');
console.error(`     mv "${rvfPath}" "${rvfPath}.pre-migration-${ts}"`);
console.error('  2. Open a fresh RvfBackend on the project; for each entry in');
console.error(`     ${metaPath}, call backend.store(entry).`);
console.error('  3. Archive the source .meta:');
console.error(`     mv "${metaPath}" "${metaPath}.migrated-${ts}"`);
console.error('');
console.error('A scripted version is tracked as ADR-0154 follow-up; this stub');
console.error('refuses rather than implement an automated rebuild that could');
console.error('lose data on edge cases (per feedback-data-loss-zero-tolerance).');
process.exit(3);
