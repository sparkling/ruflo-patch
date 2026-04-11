#!/usr/bin/env bash
# lib/acceptance-adr0074-checks.sh — ADR-0074 CJS/ESM Dual Silo Fix
#
# Phase 1a: loadMemoryPackage() checks both @sparkleideas/memory and @claude-flow/memory
# Phase 2:  doSync() intelligence drain wired (ranked-context.json -> backend)
# Phase 3:  consolidate() eviction cap at 2000 entries
#
# Requires: E2E_DIR set by caller (init'd project with .claude/helpers/)

# ════════════════════════════════════════════════════════════════════
# ADR-0074-1: Strategy 4 scope fix in auto-memory-hook.mjs
# ════════════════════════════════════════════════════════════════════

check_adr0074_scope_fix() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local hook="$E2E_DIR/.claude/helpers/auto-memory-hook.mjs"
  if [[ ! -f "$hook" ]]; then
    _CHECK_OUTPUT="ADR-0074: auto-memory-hook.mjs not found in init'd project"
    return
  fi

  # Strategy 4 must check @sparkleideas/memory in the walk-up path
  if ! grep -q '@sparkleideas/memory' "$hook"; then
    _CHECK_OUTPUT="ADR-0074: auto-memory-hook.mjs missing @sparkleideas/memory in Strategy 4 walk-up"
    return
  fi

  # loadMemoryPackage must have the walk-up Strategy 4 (node_modules traversal)
  if ! grep -q 'node_modules' "$hook"; then
    _CHECK_OUTPUT="ADR-0074: auto-memory-hook.mjs missing node_modules walk-up in Strategy 4"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0074: Strategy 4 walk-up resolves @sparkleideas/memory via node_modules"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0074-2: Intelligence drain wired in doSync()
# ════════════════════════════════════════════════════════════════════

check_adr0074_drain_wired() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local hook="$E2E_DIR/.claude/helpers/auto-memory-hook.mjs"
  if [[ ! -f "$hook" ]]; then
    _CHECK_OUTPUT="ADR-0074: auto-memory-hook.mjs not found in init'd project"
    return
  fi

  # doSync() must read ranked-context.json
  if ! grep -q 'ranked-context.json' "$hook"; then
    _CHECK_OUTPUT="ADR-0074: doSync() missing ranked-context.json read"
    return
  fi

  # Must tag entries with cjs-intelligence-drain
  if ! grep -q 'cjs-intelligence-drain' "$hook"; then
    _CHECK_OUTPUT="ADR-0074: doSync() missing cjs-intelligence-drain metadata tag"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0074: intelligence drain wired (ranked-context.json + cjs-intelligence-drain)"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0074-3: Eviction cap in intelligence.cjs consolidate()
# ════════════════════════════════════════════════════════════════════

check_adr0074_eviction_cap() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local intel="$E2E_DIR/.claude/helpers/intelligence.cjs"
  if [[ ! -f "$intel" ]]; then
    _CHECK_OUTPUT="ADR-0074: intelligence.cjs not found in init'd project"
    return
  fi

  # MAX_STORE_ENTRIES must be 2000
  if ! grep -q 'MAX_STORE_ENTRIES.*=.*2000' "$intel"; then
    _CHECK_OUTPUT="ADR-0074: intelligence.cjs missing MAX_STORE_ENTRIES = 2000"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0074: consolidate() has MAX_STORE_ENTRIES = 2000 cap"
}

# ════════════════════════════════════════════════════════════════════
# ADR-0074-4: consolidate() returns eviction count
# ════════════════════════════════════════════════════════════════════

check_adr0074_consolidate_evicts() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local intel="$E2E_DIR/.claude/helpers/intelligence.cjs"
  if [[ ! -f "$intel" ]]; then
    _CHECK_OUTPUT="ADR-0074: intelligence.cjs not found in init'd project"
    return
  fi

  # The return block must include 'evicted' key
  if ! grep -q 'evicted' "$intel"; then
    _CHECK_OUTPUT="ADR-0074: intelligence.cjs consolidate() missing evicted in return"
    return
  fi

  # Double-check: EVICTION_AGE_MS for 30 days must be present
  if ! grep -q 'EVICTION_AGE_MS' "$intel"; then
    _CHECK_OUTPUT="ADR-0074: intelligence.cjs missing EVICTION_AGE_MS constant"
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0074: consolidate() returns eviction count + has EVICTION_AGE_MS"
}
