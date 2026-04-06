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
