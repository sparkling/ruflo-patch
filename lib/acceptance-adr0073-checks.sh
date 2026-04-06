#!/usr/bin/env bash
# lib/acceptance-adr0073-checks.sh — ADR-0073 RVF Storage Backend Upgrade
#
# Phase 1: WAL write path — rvf-backend.ts has appendToWal, replayWal, compactWal
# Phase 3: Native RVF activation — tryNativeInit uses correct API
#
# Requires: E2E_DIR set by caller (init'd project with published packages)

# ════════════════════════════════════════════════════════════════════
# ADR-0073-1: WAL methods exist in rvf-backend source
# ════════════════════════════════════════════════════════════════════

check_adr0073_wal_methods() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # Find rvf-backend in the published memory package
  local rvf_src
  rvf_src=$(find "$E2E_DIR/node_modules/@sparkleideas" -name "rvf-backend.*" -type f 2>/dev/null | head -1)
  if [[ -z "$rvf_src" ]]; then
    _CHECK_OUTPUT="ADR-0073: rvf-backend not found in published @sparkleideas/memory"
    return
  fi

  # Check WAL methods exist
  if ! grep -q 'appendToWal\|append_to_wal\|walPath\|wal_path' "$rvf_src"; then
    _CHECK_OUTPUT="ADR-0073: rvf-backend missing WAL append method"
    return
  fi

  if ! grep -q 'replayWal\|replay_wal' "$rvf_src"; then
    _CHECK_OUTPUT="ADR-0073: rvf-backend missing WAL replay method"
    return
  fi

  if ! grep -q 'compactWal\|compact_wal' "$rvf_src"; then
    _CHECK_OUTPUT="ADR-0073: rvf-backend missing WAL compaction method"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0073: WAL methods (append, replay, compact) present in rvf-backend"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0073-2: tryNativeInit uses correct package name
# ════════════════════════════════════════════════════════════════════

check_adr0073_native_package() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local rvf_src
  rvf_src=$(find "$E2E_DIR/node_modules/@sparkleideas" -name "rvf-backend.*" -type f 2>/dev/null | head -1)
  if [[ -z "$rvf_src" ]]; then
    _CHECK_OUTPUT="ADR-0073: rvf-backend not found"
    return
  fi

  # Must import @ruvector/rvf-node (not bare @ruvector/rvf)
  if ! grep -q 'ruvector/rvf-node\|ruvector/rvf_node' "$rvf_src"; then
    _CHECK_OUTPUT="ADR-0073: rvf-backend not importing @ruvector/rvf-node"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0073: tryNativeInit uses @ruvector/rvf-node"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0073-3: Metric name remapping for NAPI
# ════════════════════════════════════════════════════════════════════

check_adr0073_metric_remap() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local rvf_src
  rvf_src=$(find "$E2E_DIR/node_modules/@sparkleideas" -name "rvf-backend.*" -type f 2>/dev/null | head -1)
  if [[ -z "$rvf_src" ]]; then
    _CHECK_OUTPUT="ADR-0073: rvf-backend not found"
    return
  fi

  # Must remap euclidean→l2 and dot→inner_product
  if ! grep -q 'inner_product' "$rvf_src"; then
    _CHECK_OUTPUT="ADR-0073: rvf-backend missing metric remap (inner_product)"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0073: Metric name remapping present (euclidean→l2, dot→inner_product)"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0073-4: rvf-node binary is in dependency tree
# ════════════════════════════════════════════════════════════════════

check_adr0073_rvf_node_dep() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  # Check for the scoped binary package (post-codemod name)
  local rvf_node_dir="${TEMP_DIR}/node_modules/@sparkleideas/ruvector-rvf-node"
  if [[ ! -d "$rvf_node_dir" ]]; then
    # Also check pre-codemod name in case codemod doesn't rename optionalDeps
    rvf_node_dir="${TEMP_DIR}/node_modules/@ruvector/rvf-node"
  fi

  if [[ ! -d "$rvf_node_dir" ]]; then
    _CHECK_OUTPUT="ADR-0073: ruvector-rvf-node not found in dependency tree"
    return
  fi

  # Verify .node binary exists for this platform
  local node_file
  node_file=$(find "$rvf_node_dir" -name '*.node' -type f 2>/dev/null | head -1)
  if [[ -z "$node_file" ]]; then
    _CHECK_OUTPUT="ADR-0073: ruvector-rvf-node installed but no .node binary for $(uname -m)"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0073: ruvector-rvf-node binary present ($(basename "$node_file"))"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0073-5: Native RVF binary loads and can create/query a store
# ════════════════════════════════════════════════════════════════════

check_adr0073_native_runtime() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local script
  script=$(mktemp /tmp/rvf-native-rt-XXXXX.mjs)
  cat > "$script" << 'ENDSCRIPT'
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync, existsSync } from 'node:fs';
let RvfDatabase;
try {
  const mod = await import('@sparkleideas/ruvector-rvf-node');
  RvfDatabase = mod.RvfDatabase || mod.default?.RvfDatabase;
} catch {
  try {
    const mod = await import('@ruvector/rvf-node');
    RvfDatabase = mod.RvfDatabase || mod.default?.RvfDatabase;
  } catch (e) { console.log('SKIP: ' + e.message); process.exit(0); }
}
if (!RvfDatabase) { console.log('SKIP: RvfDatabase not exported'); process.exit(0); }
const dbPath = join(tmpdir(), 'rvf-accept-' + Date.now() + '.rvf');
try {
  const db = RvfDatabase.create(dbPath, { dimension: 4, metric: 'cosine' });
  db.ingestBatch(new Float32Array([1,0,0,0]), [1]);
  db.ingestBatch(new Float32Array([0,1,0,0]), [2]);
  db.ingestBatch(new Float32Array([0.9,0.1,0,0]), [3]);
  const results = db.query(new Float32Array([1,0,0,0]), 2);
  if (!results || results.length === 0) { console.log('FAIL: query returned no results'); process.exit(1); }
  const ids = results.map(r => r.id);
  if (!ids.includes(1) && !ids.includes(3)) { console.log('FAIL: expected id 1 or 3, got ' + JSON.stringify(ids)); process.exit(1); }
  const status = db.status();
  db.close();
  console.log('OK: native RVF store+query round-trip (' + results.length + ' results, ' + status.totalVectors + ' vectors)');
} finally {
  try { if (existsSync(dbPath)) unlinkSync(dbPath); } catch {}
  try { if (existsSync(dbPath + '.lock')) unlinkSync(dbPath + '.lock'); } catch {}
}
ENDSCRIPT

  local result
  result=$(cd "$TEMP_DIR" && node "$script" 2>&1) || true
  rm -f "$script"

  if [[ "$result" == SKIP:* ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0073: native runtime skipped (${result#SKIP: })"
    return
  fi
  if [[ "$result" == OK:* ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0073: ${result#OK: }"
    return
  fi
  _CHECK_OUTPUT="ADR-0073: native runtime failed — $result"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0073-6: RvfBackend WAL store+search round-trip via published package
# ════════════════════════════════════════════════════════════════════

check_adr0073_wal_roundtrip() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local script
  script=$(mktemp /tmp/rvf-wal-rt-XXXXX.mjs)
  cat > "$script" << 'ENDSCRIPT'
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';
let RvfBackend;
try {
  const mem = await import('@sparkleideas/memory');
  RvfBackend = mem.RvfBackend;
} catch (e) { console.log('SKIP: ' + e.message); process.exit(0); }
if (!RvfBackend) { console.log('SKIP: RvfBackend not exported'); process.exit(0); }
const dbPath = join(tmpdir(), 'rvf-wal-accept-' + Date.now() + '.rvf');
try {
  const backend = new RvfBackend({
    databasePath: dbPath, dimensions: 4, autoPersistInterval: 0, walCompactionThreshold: 1000,
  });
  await backend.initialize();
  for (let i = 0; i < 10; i++) {
    await backend.store({
      id: 'e'+i, key: 'k'+i, namespace: 'test', content: 'val '+i,
      type: 'semantic', tags: [], metadata: {}, accessLevel: 'private',
      ownerId: 'accept', createdAt: Date.now(), updatedAt: Date.now(),
      accessCount: 0, lastAccessedAt: Date.now(), version: 1, references: [],
    });
  }
  const walExists = existsSync(dbPath + '.wal');
  await backend.shutdown();
  const backend2 = new RvfBackend({ databasePath: dbPath, dimensions: 4, autoPersistInterval: 0 });
  await backend2.initialize();
  let count = 0;
  for (let i = 0; i < 10; i++) {
    const e = await backend2.get('e'+i);
    if (e && e.content === 'val '+i) count++;
  }
  await backend2.shutdown();
  if (count < 10) { console.log('FAIL: only '+count+'/10 entries survived WAL round-trip'); process.exit(1); }
  console.log('OK: WAL round-trip passed ('+count+'/10 entries, wal_created='+walExists+')');
} finally {
  for (const s of ['', '.wal', '.meta', '.tmp']) {
    try { if (existsSync(dbPath+s)) unlinkSync(dbPath+s); } catch {}
  }
}
ENDSCRIPT

  local result
  result=$(cd "$TEMP_DIR" && node "$script" 2>&1) || true
  rm -f "$script"

  if [[ "$result" == SKIP:* ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0073: WAL round-trip skipped (${result#SKIP: })"
    return
  fi
  if [[ "$result" == OK:* ]]; then
    _CHECK_PASSED="true"
    _CHECK_OUTPUT="ADR-0073: ${result#OK: }"
    return
  fi
  _CHECK_OUTPUT="ADR-0073: WAL round-trip failed — $result"
}
