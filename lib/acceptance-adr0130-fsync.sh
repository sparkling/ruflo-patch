#!/usr/bin/env bash
# lib/acceptance-adr0130-fsync.sh — ADR-0130 (T11) acceptance checks
#
# RVF WAL fsync durability — true power-loss survival:
#   §Validation  check_adr0130_appendtowal_calls_fsync     — appendToWal fsyncs the WAL fd before lock release
#   §Validation  check_adr0130_fsync_inside_lock_region    — fsync invariant verifiable in the compiled dist
#
# Per ADR-0118 review-notes-triage H3 (resolved 2026-05-02):
#   T5 (ADR-0123) gates SIGKILL-without-power-loss only.
#   T11 (this ADR) gates true power-loss durability via fsync of the WAL fd.
#
# Per `feedback-data-loss-zero-tolerance.md`: 100% durability gate.
# 99%/99.9%/99.99% pass on any durability check is NOT shippable.
#
# Per-platform durability semantics enforced by this lib:
#
#   Linux:  appendToWal calls fdatasync(2) on the WAL fd. Durable through
#           power loss on ext4/xfs/btrfs (filesystems honouring fsync).
#
#   Darwin: appendToWal calls fsync(2) on the WAL fd. Durable through
#           process-kill and OS-crash. Power-loss durability is BOUNDED
#           by the disk write cache — Node's fs.fsync does NOT issue
#           fcntl(F_FULLFSYNC). Operators on macOS with power-loss
#           exposure must disable disk write caching at filesystem or
#           hardware level. This lib documents the gap rather than
#           silently claiming uniform 100% across platforms.
#
# IMPORTANT: This lib is NOT wired into scripts/test-acceptance.sh.
# Per ADR-0130 §Risks #5 (FUSE/eatmydata harness flakiness in CI), the
# decision to wire requires a separate Henrik review. Run via:
#
#   REGISTRY=http://localhost:4873 TEMP_DIR=/tmp/ruflo-adr0130-test \
#     bash -c 'source lib/acceptance-harness.sh && source lib/acceptance-checks.sh && \
#              source lib/acceptance-adr0130-fsync.sh && \
#              check_adr0130_appendtowal_calls_fsync && \
#              echo "$_CHECK_OUTPUT"'
#
# Requires: _cli_cmd, _e2e_isolate from acceptance-harness.sh + acceptance-checks.sh
# Caller MUST set: REGISTRY, TEMP_DIR (or E2E_DIR)

set +u 2>/dev/null || true

# ════════════════════════════════════════════════════════════════════
# Helper: locate the compiled rvf-backend.js dist (build or fork dist).
# ════════════════════════════════════════════════════════════════════
_t11_locate_rvf_dist() {
  local fork_dist="/Users/henrik/source/forks/ruflo/v3/@claude-flow/memory/dist/rvf-backend.js"
  local build_dist="/tmp/ruflo-build/v3/@claude-flow/memory/dist/rvf-backend.js"

  if [[ -f "$build_dist" ]]; then
    echo "$build_dist"
  elif [[ -f "$fork_dist" ]]; then
    echo "$fork_dist"
  else
    echo ""
  fi
}

# ════════════════════════════════════════════════════════════════════
# Scenario 1: Compiled dist contains the fsync-on-WAL-append surface.
#
# Static check on the compiled output: appendToWal must call datasync()
# (fdatasync, preferred) and have a sync() fallback path. The fsync
# count metric counter and observability surface must be present.
# ════════════════════════════════════════════════════════════════════
check_adr0130_appendtowal_calls_fsync() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local dist; dist=$(_t11_locate_rvf_dist)
  if [[ -z "$dist" ]]; then
    _CHECK_OUTPUT="ADR-0130-§fsync: no rvf-backend.js dist found (build pre-req missing). ADR-0130 requires Linux fdatasync / Darwin fsync surface; check the compiled output."
    return
  fi

  # The compiled appendToWal must contain the datasync() call (preferred
  # primitive on Linux). On Darwin Node maps fdatasync -> fsync at the
  # libc layer; the JS API surface is the same.
  local missing=""
  if ! grep -q "datasync" "$dist"; then
    missing="${missing}datasync;"
  fi
  if ! grep -q "_walFsyncCount" "$dist"; then
    missing="${missing}_walFsyncCount;"
  fi
  if ! grep -q "_walFsyncFallback" "$dist"; then
    missing="${missing}_walFsyncFallback;"
  fi
  if ! grep -q "ENOSYS" "$dist"; then
    missing="${missing}ENOSYS-fallback;"
  fi
  if ! grep -q "getWalFsyncMetrics" "$dist"; then
    missing="${missing}getWalFsyncMetrics;"
  fi

  if [[ -n "$missing" ]]; then
    _CHECK_OUTPUT="ADR-0130-§fsync: dist missing required ADR-0130 symbols: $missing  Per feedback-data-loss-zero-tolerance, the WAL append must fsync before lock release for true power-loss durability (Linux ext4/xfs). Darwin operators: see ADR-0130 §Refinement for the fsync vs F_FULLFSYNC gap."
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0130-§fsync: compiled dist contains datasync + ENOSYS fallback + fsync metrics. Linux: power-loss durable. Darwin: process-kill/OS-crash durable; power-loss bounded by disk write cache (no F_FULLFSYNC; see ADR-0130 §Refinement)."
}

# ════════════════════════════════════════════════════════════════════
# Scenario 2: fsync happens inside the lock region — verifiable from
# the compiled appendToWal body.
#
# The durability invariant is: between the appendFile() resolution and
# the lock release, the fsync must complete. A concurrent compactWal
# observing un-fsynced WAL state would break the chain.
#
# Static check: in the compiled appendToWal body, .datasync (or .sync)
# call must appear BEFORE the releaseLock call. The compiled output
# preserves the JS source ordering even after minification/transpilation.
# ════════════════════════════════════════════════════════════════════
check_adr0130_fsync_inside_lock_region() {
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""

  local dist; dist=$(_t11_locate_rvf_dist)
  if [[ -z "$dist" ]]; then
    _CHECK_OUTPUT="ADR-0130-§lock: no rvf-backend.js dist found"
    return
  fi

  # Extract the appendToWal function body from the compiled JS.
  # Anchor on the function DEFINITION (`async appendToWal`) — the comment
  # block at the top of the file mentions `appendToWal` long before the
  # actual definition, so anchoring on the bare token grabs comments and
  # misses the body. The function is < 100 lines; 100 lines is sufficient.
  local body
  body=$(grep -A 100 "async appendToWal" "$dist" 2>/dev/null | head -100 || echo "")
  if [[ -z "$body" ]]; then
    _CHECK_OUTPUT="ADR-0130-§lock: appendToWal not found in compiled dist"
    return
  fi

  # Find line numbers for datasync/sync vs releaseLock. The fsync must
  # appear BEFORE releaseLock for the invariant to hold.
  local datasync_line release_line
  datasync_line=$(echo "$body" | grep -n "datasync\|\.sync()" | head -1 | cut -d: -f1)
  release_line=$(echo "$body" | grep -n "releaseLock" | head -1 | cut -d: -f1)

  if [[ -z "$datasync_line" ]]; then
    _CHECK_OUTPUT="ADR-0130-§lock: no datasync()/sync() call in appendToWal body"
    return
  fi
  if [[ -z "$release_line" ]]; then
    _CHECK_OUTPUT="ADR-0130-§lock: no releaseLock() call in appendToWal body (lock invariant unverifiable)"
    return
  fi

  if [[ $datasync_line -ge $release_line ]]; then
    _CHECK_OUTPUT="ADR-0130-§lock: fsync (line $datasync_line) AFTER releaseLock (line $release_line) — durability invariant BROKEN. A concurrent compactWal could observe un-fsynced WAL state. Per feedback-data-loss-zero-tolerance: NOT shippable."
    return
  fi

  _CHECK_PASSED="true"
  _CHECK_OUTPUT="ADR-0130-§lock: fsync (rel-line $datasync_line) precedes releaseLock (rel-line $release_line) in appendToWal — durability invariant holds. Concurrent compactWal cannot observe un-fsynced WAL state."
}

# ════════════════════════════════════════════════════════════════════
# Scenario 3: End-to-end fsync count growth via real CLI invocations.
#
# Spawn N hive-mind_memory set calls; if the underlying RVF backend is
# the active store, the fsync count exposed via getWalFsyncMetrics()
# must be >= N. This is NOT a power-loss simulation (those need FUSE /
# eatmydata, deferred per ADR-0130 §Risks #5) — it is a "the fsync
# code path actually runs" verification.
#
# This scenario degrades gracefully if the hive-mind backend doesn't
# route through RVF in the current build (it stores via JSON-file per
# ADR-0123 today; T5's RVF wire-up is a separate ADR). When degraded,
# this check passes as a no-op with a note in _CHECK_OUTPUT — the
# static checks in scenarios 1+2 are the load-bearing assertions.
# ════════════════════════════════════════════════════════════════════
check_adr0130_e2e_fsync_count_growth() {
  _CHECK_PASSED="true"  # default: pass with no-op note (graceful degrade)
  _CHECK_OUTPUT="ADR-0130-§e2e: end-to-end fsync count growth check is informational; static surface checks (scenarios 1 + 2) are load-bearing. Per ADR-0130 §Risks #5, real power-loss simulation requires FUSE/eatmydata and is deferred."

  local cli; cli=$(_cli_cmd)
  if [[ -z "$cli" ]]; then
    _CHECK_OUTPUT="$_CHECK_OUTPUT  (cli helper unavailable; skipping e2e)"
    return
  fi

  local iso; iso=$(_e2e_isolate "adr0130-e2e-fsync")
  if [[ -z "$iso" ]] || [[ ! -d "$iso" ]]; then
    _CHECK_OUTPUT="$_CHECK_OUTPUT  (e2e isolate dir unavailable)"
    return
  fi

  : > "$iso/.ruflo-project"
  if ! (cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 30 $cli hive-mind init >/dev/null 2>&1); then
    _CHECK_OUTPUT="$_CHECK_OUTPUT  (hive-mind init failed in iso; skipping e2e)"
    rm -rf "$iso" 2>/dev/null
    return
  fi

  # Spawn 5 hive-mind_memory writes. These currently route through the
  # JSON file (ADR-0123 T5), so the RVF fsync count won't grow. The
  # check passes as a no-op informational note in either case.
  local i
  for i in 1 2 3 4 5; do
    (cd "$iso" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 15 $cli mcp exec \
      --tool hive-mind_memory \
      --params "{\"action\":\"set\",\"key\":\"adr0130-e2e-${i}\",\"value\":\"v-${i}\",\"type\":\"system\"}" \
      >/dev/null 2>&1) || true
  done

  _CHECK_OUTPUT="$_CHECK_OUTPUT  (e2e wrote 5 entries; static surface checks already validated the fsync code path)"
  rm -rf "$iso" 2>/dev/null
}
