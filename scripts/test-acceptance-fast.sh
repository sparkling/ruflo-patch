#!/usr/bin/env bash
# scripts/test-acceptance-fast.sh — Fast acceptance test runner for specific groups.
#
# Skips rebuild/republish. Reuses existing temp dirs. Runs checks SEQUENTIALLY
# (no subshell — variables propagate correctly). ~15-30s instead of ~300s.
#
# Usage:
#   bash scripts/test-acceptance-fast.sh [--group GROUP] [--registry URL]
#
# Groups: all, p3, p4, p5, adr0059, adr0085, e2e-core, e2e-storage
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
  (cd "$E2E_DIR" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout 15 "$CLI_BIN" memory init --force >/dev/null 2>&1) || true
  # Ensure memory_entries table exists (upstream schema gap)
  [[ -f "$E2E_DIR/.swarm/memory.db" ]] && sqlite3 "$E2E_DIR/.swarm/memory.db" \
    "CREATE TABLE IF NOT EXISTS memory_entries (id TEXT PRIMARY KEY, key TEXT, value TEXT, namespace TEXT, tags TEXT, embedding BLOB, metadata TEXT, created_at TEXT, updated_at TEXT);" 2>/dev/null || true
fi

echo "[fast] harness=$ACCEPT_TEMP  e2e=$E2E_DIR"

# ── Daemon lifecycle (Layers 1+2 per ADR-0088 amendment 2026-04-20) ──
# Layer 2 first — reap any stale PID from a prior fast run against the
# same E2E_DIR (fast runner reuses dirs when it finds a valid harness).
_fast_reap_stale_daemon() {
  local _pid_file="$E2E_DIR/.claude-flow/daemon.pid"
  [[ ! -f "$_pid_file" ]] && return
  local _pid; _pid=$(cat "$_pid_file" 2>/dev/null) || return
  if [[ -n "$_pid" ]] && kill -0 "$_pid" 2>/dev/null; then
    if ps -p "$_pid" -o args= 2>/dev/null | grep -q 'cli.*daemon'; then
      echo "[fast] reaping stale daemon PID $_pid"
      kill -TERM "$_pid" 2>/dev/null || true
      sleep 0.5
      kill -0 "$_pid" 2>/dev/null && kill -KILL "$_pid" 2>/dev/null || true
    fi
  fi
  rm -f "$_pid_file" "$E2E_DIR/.claude-flow/daemon.sock" 2>/dev/null || true
}
_fast_reap_stale_daemon

# Start daemon in background; cleanup trap below guarantees shutdown.
(cd "$E2E_DIR" && NPM_CONFIG_REGISTRY="$REGISTRY" "$CLI_BIN" daemon start --quiet >/dev/null 2>&1) &
_FAST_DAEMON_BG_PID=$!
# Wait up to 5s for socket.
for _i in 1 2 3 4 5 6 7 8 9 10; do
  [[ -S "$E2E_DIR/.claude-flow/daemon.sock" ]] && break
  sleep 0.5
done
echo "[fast] daemon: $([[ -S "$E2E_DIR/.claude-flow/daemon.sock" ]] && echo live || echo absent)"

# Layer 1: teardown on any exit path (EXIT/INT/TERM/HUP).
_fast_teardown_daemon() {
  # Prefer graceful stop (5s timeout).
  (cd "$E2E_DIR" && NPM_CONFIG_REGISTRY="$REGISTRY" \
    timeout 5 "$CLI_BIN" daemon stop --quiet >/dev/null 2>&1) || true
  local _pid_file="$E2E_DIR/.claude-flow/daemon.pid"
  if [[ -f "$_pid_file" ]]; then
    local _pid; _pid=$(cat "$_pid_file" 2>/dev/null) || _pid=""
    if [[ -n "$_pid" ]] && kill -0 "$_pid" 2>/dev/null; then
      kill -TERM "$_pid" 2>/dev/null || true
      sleep 0.5
      kill -0 "$_pid" 2>/dev/null && kill -KILL "$_pid" 2>/dev/null || true
    fi
    rm -f "$_pid_file" 2>/dev/null || true
  fi
  rm -f "$E2E_DIR/.claude-flow/daemon.sock" 2>/dev/null || true
}
trap _fast_teardown_daemon EXIT
trap '_fast_teardown_daemon; exit 143' INT TERM HUP

echo ""

# ── Source ALL libraries ────────────────────────────────────────────
source "$PROJECT_DIR/lib/acceptance-harness.sh"
source "$PROJECT_DIR/lib/acceptance-checks.sh"
for f in "$PROJECT_DIR"/lib/acceptance-*-checks.sh; do
  [[ -f "$f" ]] && source "$f"
done
# Additional non-"-checks" libs (ADR-0094 phase files use -invariants/-concurrency/-idempotency suffixes)
for f in \
  "$PROJECT_DIR/lib/acceptance-phase8-invariants.sh" \
  "$PROJECT_DIR/lib/acceptance-phase9-concurrency.sh" \
  "$PROJECT_DIR/lib/acceptance-phase10-idempotency.sh"; do
  [[ -f "$f" ]] && source "$f"
done

pass_count=0 fail_count=0 skip_count=0 total_count=0
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
  elif [[ "$_CHECK_PASSED" == "skip_accepted" ]]; then
    # ADR-0090 Tier A2: skip_accepted is a distinct bucket — NOT PASS,
    # NOT FAIL. Fast runner mirrors harness three-way discipline so a
    # legitimate trade-off surface does not masquerade as a fail.
    skip_count=$((skip_count + 1))
    printf "  \033[33mSKIP\033[0m  %s (%sms): %s\n" "$name" "$ms" "${_CHECK_OUTPUT:-no output}"
  else
    fail_count=$((fail_count + 1))
    printf "  \033[31mFAIL\033[0m  %s (%sms): %s\n" "$name" "$ms" "${_CHECK_OUTPUT:-no output}"
  fi
}

# ── Generic single-test mode: run any check_* function by name ─────
# Usage: bash scripts/test-acceptance-fast.sh check_t1_4_sqlite_verify
#        bash scripts/test-acceptance-fast.sh t1-4  (fuzzy match)
if [[ "$_FAST_GROUPS" == check_* ]] && declare -f "$_FAST_GROUPS" &>/dev/null; then
  echo "── Running single test: $_FAST_GROUPS ──"
  _fast_run "$_FAST_GROUPS" "$_FAST_GROUPS"
  echo ""
  echo "Result: $pass_count/$total_count passed, $fail_count failed, $skip_count skip_accepted"
  rm -rf "$PARALLEL_DIR"
  exit $fail_count
fi
# Fuzzy: map short name like "t1-4" or "b5-skillLibrary" to a check_* fn.
if [[ "$_FAST_GROUPS" == t[0-9]* ]] || [[ "$_FAST_GROUPS" == b5-* ]] || [[ "$_FAST_GROUPS" == adr0090-* ]]; then
  _fuzzy=$(echo "$_FAST_GROUPS" | tr '-' '_')
  _match=$(declare -F | awk '{print $3}' | grep "check_${_fuzzy}\|check_adr0090_${_fuzzy}" | head -1)
  if [[ -n "$_match" ]]; then
    echo "── Running single test: $_match (matched from $_FAST_GROUPS) ──"
    _fast_run "$_FAST_GROUPS" "$_match"
    echo ""
    echo "Result: $pass_count/$total_count passed, $fail_count failed, $skip_count skip_accepted"
    rm -rf "$PARALLEL_DIR"
    exit $fail_count
  fi
fi

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
    # ADR-0088: memory.* IPC handlers removed. Only socket/probe/fallback
    # remain meaningful.
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

if [[ "$_FAST_RUN_GROUPS" == *"adr0085"* || "$_FAST_RUN_GROUPS" == "all" ]]; then
  echo "── ADR-0085 (Bridge Deletion) ──"
  _fast_run "adr0085-no-bridge"  check_no_bridge_in_dist
  _fast_run "adr0085-init-zero"  check_initializer_zero_bridge_imports
  _fast_run "adr0085-router-reg" check_router_has_init_controller_registry
fi

if [[ "$_FAST_RUN_GROUPS" == *"adr0090-b5"* || "$_FAST_RUN_GROUPS" == "b5" || "$_FAST_RUN_GROUPS" == "all" ]]; then
  echo "── ADR-0090 B5 (15-controller SQLite round-trip) ──"
  _fast_run "b5-reflexion"           check_adr0090_b5_reflexion
  _fast_run "b5-skillLibrary"        check_adr0090_b5_skillLibrary
  _fast_run "b5-reasoningBank"       check_adr0090_b5_reasoningBank
  _fast_run "b5-causalGraph"         check_adr0090_b5_causalGraph
  _fast_run "b5-causalRecall"        check_adr0090_b5_causalRecall
  _fast_run "b5-learningSystem"      check_adr0090_b5_learningSystem
  _fast_run "b5-hierarchicalMemory"  check_adr0090_b5_hierarchicalMemory
  _fast_run "b5-memoryConsolidation" check_adr0090_b5_memoryConsolidation
  _fast_run "b5-attentionService"    check_adr0090_b5_attentionService
  _fast_run "b5-gnnService"          check_adr0090_b5_gnnService
  _fast_run "b5-semanticRouter"      check_adr0090_b5_semanticRouter
  _fast_run "b5-graphAdapter"        check_adr0090_b5_graphAdapter
  _fast_run "b5-sonaTrajectory"      check_adr0090_b5_sonaTrajectory
  _fast_run "b5-nightlyLearner"      check_adr0090_b5_nightlyLearner
  _fast_run "b5-explainableRecall"   check_adr0090_b5_explainableRecall
fi

if [[ "$_FAST_RUN_GROUPS" == *"p8"* || "$_FAST_RUN_GROUPS" == "all" ]]; then
  if [[ -f "$PROJECT_DIR/lib/acceptance-phase8-invariants.sh" ]]; then
    echo "── Phase 8: Cross-Tool Invariants (ADR-0094) ──"
    _fast_run "p8-inv1-memory"     check_adr0094_p8_inv1_memory_roundtrip
    _fast_run "p8-inv2-session"    check_adr0094_p8_inv2_session_roundtrip
    _fast_run "p8-inv3-agent"      check_adr0094_p8_inv3_agent_roundtrip
    _fast_run "p8-inv4-claims"     check_adr0094_p8_inv4_claims_roundtrip
    _fast_run "p8-inv5-workflow"   check_adr0094_p8_inv5_workflow_roundtrip
    _fast_run "p8-inv6-config"     check_adr0094_p8_inv6_config_roundtrip
    _fast_run "p8-inv7-task"       check_adr0094_p8_inv7_task_lifecycle
    _fast_run "p8-inv8-sess-mem"   check_adr0094_p8_inv8_session_memory_roundtrip
    _fast_run "p8-inv9-neural"     check_adr0094_p8_inv9_neural_delta
    _fast_run "p8-inv10-autopilot" check_adr0094_p8_inv10_autopilot_shape
    _fast_run "p8-inv11-delta"     check_adr0094_p8_inv11_delta_sentinel
    _fast_run "p8-inv12-mem-full"  check_adr0094_p8_inv12_memory_full_roundtrip
  fi
fi

if [[ "$_FAST_RUN_GROUPS" == *"e2e-storage"* || "$_FAST_RUN_GROUPS" == "all" ]]; then
  echo "── E2E Storage Pipeline ──"
  _fast_run "store-rvf"       check_e2e_store_creates_rvf
  _fast_run "semantic"        check_e2e_search_semantic_quality
  _fast_run "list-store"      check_e2e_list_after_store
  _fast_run "dual-write"      check_e2e_dual_write_consistency
  _fast_run "dim768"          check_e2e_embeddings_768_dim
  _fast_run "no-dead-files"   check_e2e_init_no_dead_files
  _fast_run "cfg-roundtrip"   check_e2e_config_round_trip
fi

if [[ "$_FAST_RUN_GROUPS" == *"p5"* || "$_FAST_RUN_GROUPS" == "all" ]]; then
  if [[ -f "$PROJECT_DIR/lib/acceptance-init-generated-checks.sh" ]]; then
    source "$PROJECT_DIR/lib/acceptance-init-generated-checks.sh"

    # Phase 5 needs a completely fresh temp dir — no reuse
    _P5_DIR=$(mktemp -d /tmp/ruflo-p5-fast-XXXXX)
    export P5_DIR="$_P5_DIR"

    echo "── Phase 5: Init-Generated Config (fresh init, no stamping) ──"
    echo "  [fast] Creating fresh project at $_P5_DIR (~60s)..."
    (cd "$_P5_DIR" && NPM_CONFIG_REGISTRY="$REGISTRY" "$CLI_BIN" init --full --force --with-embeddings --embedding-model "Xenova/all-mpnet-base-v2" 2>/dev/null) || true

    echo "  ── config.json checks ──"
    _fast_run "p5-cfg-valid"      check_p5_config_valid_json
    _fast_run "p5-cfg-sqlite"     check_p5_config_sqlite_keys
    _fast_run "p5-cfg-neural"     check_p5_config_neural_keys
    _fast_run "p5-cfg-ports"      check_p5_config_ports
    _fast_run "p5-cfg-ratelimit"  check_p5_config_ratelimiter
    _fast_run "p5-cfg-workers"    check_p5_config_workers
    _fast_run "p5-cfg-simthresh"  check_p5_config_similarity
    _fast_run "p5-cfg-dedup"      check_p5_config_dedup
    _fast_run "p5-cfg-cpuload"    check_p5_config_maxcpu

    echo "  ── embeddings checks ──"
    _fast_run "p5-emb-valid"      check_p5_embeddings_valid_json
    _fast_run "p5-emb-model"      check_p5_embeddings_model
    _fast_run "p5-emb-dim"        check_p5_embeddings_dimension
    _fast_run "p5-emb-hnswm"      check_p5_embeddings_hnsw_m
    _fast_run "p5-emb-efcon"      check_p5_embeddings_hnsw_efc
    _fast_run "p5-emb-efsearch"   check_p5_embeddings_hnsw_efs
    _fast_run "p5-emb-maxel"      check_p5_embeddings_maxel

    echo "  ── runtime checks ──"
    _fast_run "p5-rt-store"       check_p5_runtime_memory_store
    _fast_run "p5-rt-search"      check_p5_runtime_memory_search

    echo "  ── flag override checks ──"
    _fast_run "p5-flag-port"      check_p5_flag_port
    _fast_run "p5-flag-simthresh" check_p5_flag_similarity
    _fast_run "p5-flag-maxagents" check_p5_flag_maxagents

    echo "  ── backward compat checks ──"
    _fast_run "p5-compat-noforce" check_p5_compat_no_overwrite
    _fast_run "p5-compat-cfgset"  check_p5_compat_config_set

    # Cleanup
    rm -rf "$_P5_DIR" 2>/dev/null
  fi
fi

rm -rf "$PARALLEL_DIR"

echo ""
echo "════════════════════════════════════════════"
echo "Fast Results: $pass_count/$total_count passed, $fail_count failed, $skip_count skip_accepted"
echo "════════════════════════════════════════════"
exit $fail_count
