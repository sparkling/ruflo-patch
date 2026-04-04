#!/usr/bin/env bash
# scripts/test-acceptance-fast.sh — Fast acceptance test runner for specific groups.
#
# Skips rebuild/republish. Reuses existing temp dirs. Runs checks SEQUENTIALLY
# (no subshell — variables propagate correctly). ~15-30s instead of ~300s.
#
# Usage:
#   bash scripts/test-acceptance-fast.sh [--group GROUP] [--registry URL]
#
# Groups: all, p3, p4, adr0059, e2e-core
# Default: p3,p4 (the Phase 3+4 checks)
set -o pipefail

_FAST_GROUPS="${1:-p3,p4}"  # capture before source clobbers $1

REGISTRY="${REGISTRY:-http://localhost:4873}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
_FAST_RUN_GROUPS="$_FAST_GROUPS"

# ── Find or create harness ──────────────────────────────────────────
ACCEPT_TEMP=""
for d in /tmp/ruflo-accept-* /tmp/ruflo-fast-*; do
  [[ -x "$d/node_modules/.bin/cli" ]] && { ACCEPT_TEMP="$d"; break; }
done

if [[ -z "$ACCEPT_TEMP" ]]; then
  ACCEPT_TEMP=$(mktemp -d /tmp/ruflo-fast-XXXXX)
  echo "[fast] Installing packages to $ACCEPT_TEMP (~15s)..."
  (cd "$ACCEPT_TEMP" \
    && echo '{"name":"fast-test","version":"1.0.0","private":true}' > package.json \
    && echo "registry=${REGISTRY}" > .npmrc \
    && npm install @sparkleideas/cli --registry "$REGISTRY" --no-audit --no-fund --prefer-offline 2>&1 | tail -1)
fi

TEMP_DIR="$ACCEPT_TEMP"
PKG="@sparkleideas/cli"
CLI_BIN="${ACCEPT_TEMP}/node_modules/.bin/cli"

if [[ ! -x "$CLI_BIN" ]]; then
  echo "[fast] FATAL: CLI not found at $CLI_BIN"; exit 1
fi

# ── Find or create E2E project ──────────────────────────────────────
E2E_DIR=""
for d in /tmp/ruflo-e2e-*; do
  [[ -f "$d/.claude/settings.json" ]] && { E2E_DIR="$d"; break; }
done

if [[ -z "$E2E_DIR" ]]; then
  E2E_DIR=$(mktemp -d /tmp/ruflo-e2e-XXXXX)
  echo "[fast] Creating E2E project at $E2E_DIR (~60s)..."
  (cd "$E2E_DIR" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 120 "$CLI_BIN" init --full --force >/dev/null 2>&1) || true
  (cd "$E2E_DIR" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 15 "$CLI_BIN" memory init >/dev/null 2>&1) || true
fi

echo "[fast] harness=$ACCEPT_TEMP  e2e=$E2E_DIR"
echo ""

# ── Source libraries ────────────────────────────────────────────────
source "$PROJECT_DIR/lib/acceptance-harness.sh"
source "$PROJECT_DIR/lib/acceptance-checks.sh"

pass_count=0 fail_count=0 total_count=0
results_json="[]"
PARALLEL_DIR=$(mktemp -d /tmp/ruflo-accept-par-XXXXX)

_fast_run() {
  local name="$1" fn="$2"
  total_count=$((total_count + 1))
  _CHECK_PASSED="false"; _CHECK_OUTPUT=""
  local t0; t0=$(date +%s%N 2>/dev/null || echo 0)
  "$fn" 2>&1
  local t1; t1=$(date +%s%N 2>/dev/null || echo 0)
  local ms=$(( (t1 - t0) / 1000000 ))
  if [[ "$_CHECK_PASSED" == "true" ]]; then
    pass_count=$((pass_count + 1))
    printf "  \033[32mPASS\033[0m  %s (%sms): %s\n" "$name" "$ms" "${_CHECK_OUTPUT:-ok}"
  else
    fail_count=$((fail_count + 1))
    printf "  \033[31mFAIL\033[0m  %s (%sms): %s\n" "$name" "$ms" "${_CHECK_OUTPUT:-no output}"
  fi
}

# ── Run selected groups ─────────────────────────────────────────────
[[ -f "$PROJECT_DIR/lib/acceptance-adr0059-checks.sh" ]] && source "$PROJECT_DIR/lib/acceptance-adr0059-checks.sh"

if [[ "$_FAST_RUN_GROUPS" == *"p3"* || "$_FAST_RUN_GROUPS" == "all" ]]; then
  if [[ -f "$PROJECT_DIR/lib/acceptance-adr0059-phase3-checks.sh" ]]; then
    source "$PROJECT_DIR/lib/acceptance-adr0059-phase3-checks.sh"
    echo "── Phase 3 (unified search) ──"
    _fast_run "unified-both"  check_adr0059_unified_search_both_stores
    _fast_run "dedup"         check_adr0059_unified_search_dedup
    _fast_run "no-crash"      check_adr0059_unified_search_no_crash
  fi
fi

if [[ "$_FAST_RUN_GROUPS" == *"p4"* || "$_FAST_RUN_GROUPS" == "all" ]]; then
  if [[ -f "$PROJECT_DIR/lib/acceptance-adr0059-phase4-checks.sh" ]]; then
    source "$PROJECT_DIR/lib/acceptance-adr0059-phase4-checks.sh"
    echo "── Phase 4 (daemon IPC) ──"
    _fast_run "socket-exists"  check_adr0059_daemon_ipc_socket_exists
    _fast_run "ipc-probe"      check_adr0059_daemon_ipc_probe
    _fast_run "ipc-fallback"   check_adr0059_daemon_ipc_fallback
  fi
fi

if [[ "$_FAST_RUN_GROUPS" == *"adr0059"* || "$_FAST_RUN_GROUPS" == "all" ]]; then
  echo "── ADR-0059 (Phase 1+2) ──"
  _fast_run "mem-roundtrip"  check_adr0059_memory_store_retrieve
  _fast_run "mem-search"     check_adr0059_memory_search
  _fast_run "persistence"    check_adr0059_storage_persistence
  _fast_run "storage-files"  check_adr0059_storage_files
  _fast_run "intel-graph"    check_adr0059_intelligence_graph
  _fast_run "retrieval"      check_adr0059_retrieval_relevance
  _fast_run "insight"        check_adr0059_learning_insight_generation
  _fast_run "feedback"       check_adr0059_learning_feedback
  _fast_run "hook-import"    check_adr0059_hook_import_populates
  _fast_run "hook-edit"      check_adr0059_hook_edit_records_file
  _fast_run "hook-lifecycle" check_adr0059_hook_full_lifecycle
  _fast_run "no-collisions"  check_adr0059_no_id_collisions
fi

rm -rf "$PARALLEL_DIR"

echo ""
echo "════════════════════════════════════════════"
echo "Fast Results: $pass_count/$total_count passed, $fail_count failed"
echo "════════════════════════════════════════════"
exit $fail_count
