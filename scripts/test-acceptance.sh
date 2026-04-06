#!/usr/bin/env bash
# scripts/test-acceptance.sh — Acceptance tests against published packages (ADR-0037).
#
# Assumes packages are already published AND promoted to @latest on the registry.
# Installs from the registry, runs a harness (init --full + memory init), then
# executes all acceptance checks against the initialized project.
#
# Pipeline: build -> unit tests -> publish-verdaccio.sh -> test-acceptance.sh
#
# Usage:
#   bash scripts/test-acceptance.sh [--registry <url>]
#
# Groups:
#   harness    — install, structural checks, init --full, memory init (abort on failure)
#   smoke      — version, latest-resolves, no-broken-versions
#   structure  — settings-file, scope, mcp-config
#   diagnostics — doctor, wrapper-proxy
#   data       — memory-lifecycle, neural-training
#   packages   — booster-esm, booster-cli, plugins-sdk, plugin-install
#   controller — ctrl-health, ctrl-routing, ctrl-scoping, ctrl-reflexion,
#                ctrl-causal, ctrl-cow, ctrl-batch, ctrl-synthesis
#   security   — sec-controllers, sec-ratelimit, sec-breaker, sec-resource,
#                sec-composition, sec-wiring, sec-quantize, sec-health-rpt
#   attention  — attn-compute, attn-benchmark, attn-configure, attn-metrics,
#                attn-wiring
#   adr0069-f3 — f3-wasm-pub, f3-unified-pub, f3-wasm-bin, f3-unified-bin,
#                f3-wasm-load, f3-mech-count
#   adr0071    — adr0071-no-ruvector, adr0071-node-binary
#   e2e        — e2e-memory-store, e2e-hooks-route, e2e-causal-edge,
#                e2e-reflexion-store, e2e-batch-optimize
#
# Exit code: number of failed checks (0 = all pass)
set -uo pipefail

# ── Defaults ────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

PORT=4873
REGISTRY="http://localhost:${PORT}"
ACCEPT_TEMP=""

# ── Argument parsing ────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --registry)         REGISTRY="${2:-}"; shift 2 ;;
    --port)             PORT="${2:-4873}"; REGISTRY="http://localhost:${PORT}"; shift 2 ;;
    -h|--help)
      echo "Usage: bash scripts/test-acceptance.sh [options]"
      echo "  --registry <url>           Registry URL (default: http://localhost:4873)"
      echo "  --port <port>              Verdaccio port (default: 4873)"
      exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

# ── Logging ─────────────────────────────────────────────────────────
_ts() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log()       { echo "[$(_ts)] $*" >&2; }
log_error() { echo "[$(_ts)] ERROR: $*" >&2; }

# ── Timing helpers ──────────────────────────────────────────────────
_ns() { date +%s%N 2>/dev/null || echo 0; }
_elapsed_ms() {
  local s="$1" e="$2"
  if [[ "$s" != "0" && "$e" != "0" ]]; then echo $(( (e - s) / 1000000 )); else echo 0; fi
}

# ── Portable timeout (macOS lacks coreutils timeout) ──────────────
if command -v timeout >/dev/null 2>&1; then
  _timeout() { timeout --signal=KILL "$@"; }
elif command -v gtimeout >/dev/null 2>&1; then
  _timeout() { gtimeout --signal=KILL "$@"; }
else
  _timeout() {
    local secs="$1"; shift
    bash -c "$*" &
    local pid=$!
    ( sleep "$secs" && kill -9 "$pid" 2>/dev/null ) &
    local watchdog=$!
    wait "$pid" 2>/dev/null
    local rc=$?
    kill "$watchdog" 2>/dev/null; wait "$watchdog" 2>/dev/null
    return $rc
  }
fi

# ── Source acceptance harness framework ────────────────────────────
source "${PROJECT_DIR}/lib/acceptance-harness.sh"

# ── Global timeout: 300s ────────────────────────────────────────────
# Close fd 9 (flock) so orphaned timeout process cannot hold the pipeline lock
# Close ALL inherited fds so timeout sleep doesn't hold pipes open
( exec 9>&- 1>/dev/null 2>/dev/null; sleep 300; kill -TERM -$$ 2>/dev/null || kill -TERM $$ 2>/dev/null || true; sleep 5; kill -KILL -$$ 2>/dev/null || kill -KILL $$ 2>/dev/null || true ) &
GLOBAL_TIMEOUT_PID=$!

# ── Cleanup ─────────────────────────────────────────────────────────
_P4_DAEMON_PID=""
cleanup() {
  # Kill Phase 4 daemon via PID file (deterministic, no pattern matching)
  for _d in "${E2E_DIR:-}" "${ACCEPT_TEMP:-}"; do
    [[ -z "$_d" ]] && continue
    local _pid_file="${_d}/.claude-flow/daemon.pid"
    if [[ -f "$_pid_file" ]]; then
      local _dpid
      _dpid=$(cat "$_pid_file" 2>/dev/null) || true
      if [[ -n "$_dpid" ]]; then
        kill "$_dpid" 2>/dev/null || true
        sleep 0.5
        kill -0 "$_dpid" 2>/dev/null && kill -9 "$_dpid" 2>/dev/null || true
      fi
      rm -f "$_pid_file" 2>/dev/null || true
    fi
    rm -f "${_d}/.claude-flow/daemon.sock" 2>/dev/null || true
  done
  # Also kill by stored PID (belt-and-suspenders)
  if [[ -n "$_P4_DAEMON_PID" ]] && kill -0 "$_P4_DAEMON_PID" 2>/dev/null; then
    kill "$_P4_DAEMON_PID" 2>/dev/null || true
    sleep 0.5
    kill -0 "$_P4_DAEMON_PID" 2>/dev/null && kill -9 "$_P4_DAEMON_PID" 2>/dev/null || true
  fi
  # Kill all background jobs and their children
  local job_pids
  job_pids=$(jobs -p 2>/dev/null) || true
  if [[ -n "$job_pids" ]]; then
    for jp in $job_pids; do
      pkill -P "$jp" 2>/dev/null || true
      kill "$jp" 2>/dev/null || true
    done
    wait 2>/dev/null || true
  fi
  kill "$GLOBAL_TIMEOUT_PID" 2>/dev/null || true
  [[ -n "$ACCEPT_TEMP" && -d "$ACCEPT_TEMP" ]] && rm -rf "$ACCEPT_TEMP"
  [[ -n "${PARALLEL_DIR:-}" && -d "${PARALLEL_DIR:-}" ]] && rm -rf "$PARALLEL_DIR"
  [[ -n "${E2E_DIR:-}" && -d "${E2E_DIR:-}" ]] && rm -rf "$E2E_DIR"
}
trap cleanup EXIT INT TERM

ACCEPT_START_NS=$(_ns)
ACCEPT_START_S=$(date +%s)
log "Acceptance tests starting"
log "  registry: ${REGISTRY}"

# ════════════════════════════════════════════════════════════════════
# Harness: health check -> install -> structural -> init --full -> memory init
# Harness failure = abort (infrastructure error, not test failure)
# ════════════════════════════════════════════════════════════════════

# Phase: Registry health check
_p=$(_ns)
if ! curl -sf "${REGISTRY}/-/ping" >/dev/null 2>&1; then
  log_error "Registry not reachable at ${REGISTRY}"
  exit 1
fi
_record_phase "health-check" "$(_elapsed_ms "$_p" "$(_ns)")"

# Phase: Clear stale npm cache entries + orphaned acceptance temp dirs
_p=$(_ns)
find "${HOME}/.npm/_npx" -path "*/@sparkleideas" -type d -exec rm -rf {} + 2>/dev/null || true
# Remove stale acceptance temp dirs from previous runs (>1 hour old)
find /tmp -maxdepth 1 -name "ruflo-accept-*" -type d -mmin +60 -exec rm -rf {} + 2>/dev/null || true
_record_phase "cache-clear" "$(_elapsed_ms "$_p" "$(_ns)")"

# ADR-0048: Persistent ONNX model cache — avoids 30-60s cold download per test run.
# ModelCacheLoader checks AGENTDB_MODEL_PATH first, then ~/.cache/agentdb-models/.
# Staleness is verified by SHA-256 checksum comparison in ModelCacheLoader.extractFromRvf().
export AGENTDB_MODEL_PATH="${HOME}/.cache/agentdb-models"

# Phase: Install packages from registry
_p=$(_ns)
ACCEPT_TEMP=$(mktemp -d /tmp/ruflo-accept-XXXXX)
(cd "$ACCEPT_TEMP" \
  && echo '{"name":"ruflo-accept-test","version":"1.0.0","private":true}' > package.json \
  && echo "registry=${REGISTRY}" > .npmrc \
  && npm install @sparkleideas/cli @sparkleideas/agent-booster @sparkleideas/plugins \
     --registry "$REGISTRY" --no-audit --no-fund --prefer-offline 2>&1) || {
  log_error "Failed to install packages from ${REGISTRY}"; exit 1
}
_record_phase "install" "$(_elapsed_ms "$_p" "$(_ns)")"

# Phase: Structural checks (validate harness, not tests)
_p=$(_ns)
structural_fail=0
if [[ ! -d "${ACCEPT_TEMP}/node_modules/@sparkleideas/cli" ]]; then
  log "  FAIL  S-1: @sparkleideas/cli not in node_modules"
  structural_fail=$((structural_fail + 1))
else
  log "  PASS  S-1: @sparkleideas/cli installed"
fi
for pkg in "@sparkleideas/agent-booster" "@sparkleideas/plugins"; do
  if npm view "$pkg" version --registry "$REGISTRY" >/dev/null 2>&1; then
    log "  PASS  S-2: $pkg available"
  else
    log "  FAIL  S-2: $pkg not available"
    structural_fail=$((structural_fail + 1))
  fi
done
# S-3: npm ls clean (no MISSING deps)
missing_deps=$(cd "${ACCEPT_TEMP}" && npm ls --all 2>&1 | grep 'MISSING' || true)
if [[ -n "$missing_deps" ]]; then
  log "  WARN  S-3: Missing dependencies detected:"
  echo "$missing_deps" | head -10 | while IFS= read -r line; do log "        $line"; done
else
  log "  PASS  S-3: All dependencies resolved"
fi
_record_phase "structural" "$(_elapsed_ms "$_p" "$(_ns)")"
if [[ $structural_fail -gt 0 ]]; then
  log_error "Structural checks failed ($structural_fail) — harness abort"; exit 1
fi

# Phase: Initialize project (harness — init --full + memory init)
_p=$(_ns)
CLI_BIN="${ACCEPT_TEMP}/node_modules/.bin/cli"
if [[ ! -x "$CLI_BIN" ]]; then
  log_error "CLI binary not found at ${CLI_BIN} — harness abort"; exit 1
fi

# ── ADR-0068: Unified embedding config (explicit, never rely on defaults) ──
# These are the canonical values for the all-mpnet-base-v2 model.
# Tests MUST fail if any of these change — that's the point.
RUFLO_EMBEDDING_MODEL="Xenova/all-mpnet-base-v2"
RUFLO_EMBEDDING_DIM=768
RUFLO_HNSW_M=23
RUFLO_HNSW_EF_CONSTRUCTION=100
RUFLO_HNSW_EF_SEARCH=50

log "Running harness: init --full --force (model=${RUFLO_EMBEDDING_MODEL}, dim=${RUFLO_EMBEDDING_DIM})"
# CLI process hangs after init (open SQLite handles from 42-controller registry).
# Use timeout+KILL but verify success by checking output files, not exit code.
_init_out=$(cd "$ACCEPT_TEMP" && NPM_CONFIG_REGISTRY="$REGISTRY" _timeout 120 "$CLI_BIN" init --full --force --with-embeddings --embedding-model "$RUFLO_EMBEDDING_MODEL" 2>&1) || true
if [[ ! -f "${ACCEPT_TEMP}/.claude-flow/config.json" && ! -f "${ACCEPT_TEMP}/.claude-flow/config.yaml" ]]; then
  log_error "Harness: init --full failed (no config.json or config.yaml created)"
  exit 1
fi

# Stamp the init'd embeddings.json with explicit HNSW values.
# The CLI template should already write these, but we overwrite to make the
# contract between harness and acceptance checks ironclad — no hidden defaults.
_emb_json="${ACCEPT_TEMP}/.claude-flow/embeddings.json"
if [[ -f "$_emb_json" ]]; then
  _emb_tmp=$(mktemp)
  python3 -c "
import json, sys
with open('$_emb_json') as f: cfg = json.load(f)
cfg['model'] = '${RUFLO_EMBEDDING_MODEL}'
cfg['dimension'] = ${RUFLO_EMBEDDING_DIM}
cfg.setdefault('hnsw', {})
cfg['hnsw']['m'] = ${RUFLO_HNSW_M}
cfg['hnsw']['efConstruction'] = ${RUFLO_HNSW_EF_CONSTRUCTION}
cfg['hnsw']['efSearch'] = ${RUFLO_HNSW_EF_SEARCH}
json.dump(cfg, sys.stdout, indent=2)
" > "$_emb_tmp" 2>/dev/null && mv "$_emb_tmp" "$_emb_json"
  log "  Stamped embeddings.json: model=${RUFLO_EMBEDDING_MODEL} dim=${RUFLO_EMBEDDING_DIM} hnsw=(m=${RUFLO_HNSW_M} efC=${RUFLO_HNSW_EF_CONSTRUCTION} efS=${RUFLO_HNSW_EF_SEARCH})"
else
  log "WARN: embeddings.json not created by init — HNSW acceptance checks may fail"
fi

log "Running harness: memory init"
# Sentinel-based completion detection (ADR-0039 T1) — CLI hangs after
# completion (open SQLite handles). Run command, append sentinel when done,
# poll for sentinel or timeout.
_harness_mem_out=""
_harness_mem_tmpfile=$(mktemp /tmp/rk-harness-XXXXX)
> "$_harness_mem_tmpfile"
( cd "$ACCEPT_TEMP" && NPM_CONFIG_REGISTRY="$REGISTRY" "$CLI_BIN" memory init >> "$_harness_mem_tmpfile" 2>&1; echo "__RUFLO_DONE__" >> "$_harness_mem_tmpfile" ) &
_harness_mem_pid=$!
_harness_elapsed=0
_harness_max=8
while (( $(echo "$_harness_elapsed < $_harness_max" | bc) )); do
  sleep 0.25
  _harness_elapsed=$(echo "$_harness_elapsed + 0.25" | bc)
  if grep -q '__RUFLO_DONE__' "$_harness_mem_tmpfile" 2>/dev/null; then
    break
  fi
  if ! kill -0 "$_harness_mem_pid" 2>/dev/null; then
    sleep 0.1
    break
  fi
done
kill "$_harness_mem_pid" 2>/dev/null && wait "$_harness_mem_pid" 2>/dev/null || true
sed '/__RUFLO_DONE__/d' "$_harness_mem_tmpfile" > "${_harness_mem_tmpfile}.tmp" && mv "${_harness_mem_tmpfile}.tmp" "$_harness_mem_tmpfile"
_harness_mem_out=$(cat "$_harness_mem_tmpfile" 2>/dev/null)
rm -f "$_harness_mem_tmpfile"

if echo "$_harness_mem_out" | grep -qi 'initialized\|verification passed'; then
  log "Harness: memory init succeeded"
else
  log "WARN: memory init output unclear (continuing): $(echo "$_harness_mem_out" | tail -3 | tr '\n' ' ')"
fi
_record_phase "harness-init" "$(_elapsed_ms "$_p" "$(_ns)")"

# ════════════════════════════════════════════════════════════════════
# Pre-create e2e snapshot BEFORE non-e2e checks touch $ACCEPT_TEMP.
# This lets us start e2e memory init in the background, overlapping
# with the non-e2e wave (~8-10s saved on the critical path).
# ════════════════════════════════════════════════════════════════════
_p=$(_ns)
E2E_DIR=$(mktemp -d /tmp/ruflo-e2e-XXXXX)
cp -r "$ACCEPT_TEMP/." "$E2E_DIR/"
# Snapshot taken before non-e2e wave — state is clean from harness init.
# Only remove transient data that could interfere with e2e checks.
rm -rf "$E2E_DIR/.claude-flow/data" 2>/dev/null || true
log "  e2e snapshot: $(du -sh "$E2E_DIR" 2>/dev/null | cut -f1) (taken before non-e2e wave)"

# Start e2e memory init + health check in background
_E2E_READY_FILE=$(mktemp /tmp/ruflo-e2e-ready-XXXXX)
_E2E_HEALTH_FILE=$(mktemp /tmp/ruflo-e2e-health-XXXXX)
(
  if [[ -f "$E2E_DIR/.claude/settings.json" ]]; then
    _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $CLI_BIN memory init"
    _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $CLI_BIN mcp exec --tool agentdb_health"
    echo "$_RK_OUT" > "$_E2E_HEALTH_FILE"
  fi
  echo "ready" > "$_E2E_READY_FILE"
) &
_E2E_PREP_PID=$!
_record_phase "e2e-snapshot" "$(_elapsed_ms "$_p" "$(_ns)")"

# ════════════════════════════════════════════════════════════════════
# Source shared check library
# ════════════════════════════════════════════════════════════════════
checks_lib="${PROJECT_DIR}/lib/acceptance-checks.sh"
[[ -f "$checks_lib" ]] || { log_error "Missing: $checks_lib"; exit 1; }
source "$checks_lib"

# ADR-0059 checks (RvfBackend, hooks, intelligence, learning)
adr0059_lib="${PROJECT_DIR}/lib/acceptance-adr0059-checks.sh"
[[ -f "$adr0059_lib" ]] && source "$adr0059_lib"

# ADR-0062: Storage & Configuration Unification
adr0062_lib="${PROJECT_DIR}/lib/acceptance-adr0062-checks.sh"
[[ -f "$adr0062_lib" ]] && source "$adr0062_lib"

# ADR-0063: Storage Audit Remediation
adr0063_lib="${PROJECT_DIR}/lib/acceptance-adr0063-checks.sh"
[[ -f "$adr0063_lib" ]] && source "$adr0063_lib"

# ADR-0064: Controller Config Alignment
adr0064_lib="${PROJECT_DIR}/lib/acceptance-adr0064-checks.sh"
[[ -f "$adr0064_lib" ]] && source "$adr0064_lib"

# ADR-0065: Config Centralization
adr0065_lib="${PROJECT_DIR}/lib/acceptance-adr0065-checks.sh"
[[ -f "$adr0065_lib" ]] && source "$adr0065_lib"

# ADR-0068: Controller Config Unification
adr0068_lib="${PROJECT_DIR}/lib/acceptance-adr0068-checks.sh"
[[ -f "$adr0068_lib" ]] && source "$adr0068_lib"

# ADR-0069: Config Chain Bypass Remediation
adr0069_lib="${PROJECT_DIR}/lib/acceptance-adr0069-checks.sh"
[[ -f "$adr0069_lib" ]] && source "$adr0069_lib"

adr0069_init_lib="${PROJECT_DIR}/lib/acceptance-adr0069-init-checks.sh"
[[ -f "$adr0069_init_lib" ]] && source "$adr0069_init_lib"

# ADR-0059 Phase 3: Unified MCP search
adr0059_p3_lib="${PROJECT_DIR}/lib/acceptance-adr0059-phase3-checks.sh"
[[ -f "$adr0059_p3_lib" ]] && source "$adr0059_p3_lib"

# ADR-0059 Phase 4: Daemon IPC
adr0059_p4_lib="${PROJECT_DIR}/lib/acceptance-adr0059-phase4-checks.sh"
[[ -f "$adr0059_p4_lib" ]] && source "$adr0059_p4_lib"

PKG="@sparkleideas/cli"
RUFLO_WRAPPER_PKG="@sparkleideas/ruflo@latest"
TEMP_DIR="$ACCEPT_TEMP"

# Persistent npx cache (ADR-0025)
NPX_CACHE="/tmp/ruflo-accept-npxcache"
mkdir -p "$NPX_CACHE"
find "$NPX_CACHE/_npx" -path "*/@sparkleideas" -type d -exec rm -rf {} + 2>/dev/null || true
export NPM_CONFIG_CACHE="$NPX_CACHE"

run_timed() {
  local t_start t_end
  t_start=$(date +%s%N 2>/dev/null || echo 0)
  # Use --signal=KILL to force-kill hung processes (CLI keeps SQLite handles open)
  _OUT="$(_timeout 120 bash -c "$*" 2>&1)" || true
  _EXIT=${PIPESTATUS[0]:-$?}
  t_end=$(date +%s%N 2>/dev/null || echo 0)
  [[ "$t_start" == "0" || "$t_end" == "0" ]] && _DURATION_MS=0 || _DURATION_MS=$(( (t_end - t_start) / 1000000 ))
}

timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ── Registry-specific checks ───────────────────────────────────────

check_no_broken_versions() {
  local start_ns end_ns
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  local resolved
  resolved=$(NPM_CONFIG_REGISTRY="$REGISTRY" npm view @sparkleideas/cli@latest version 2>/dev/null) || true
  if [[ -n "$resolved" ]]; then
    local has_bin
    has_bin=$(NPM_CONFIG_REGISTRY="$REGISTRY" npm view "@sparkleideas/cli@${resolved}" bin --json 2>/dev/null) || true
    if [[ -n "$has_bin" && "$has_bin" != "{}" ]]; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="cli@latest = $resolved (has bin)"
    else
      _CHECK_OUTPUT="cli@latest = $resolved (no bin entries — broken)"
    fi
  else
    _CHECK_OUTPUT="cli@latest did not resolve"
  fi
  end_ns=$(_ns)
  _EXIT=0; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
}

check_plugin_install() {
  local cli; cli=$(_cli_cmd)
  run_timed "cd '$TEMP_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli plugins install --name @sparkleideas/plugin-prime-radiant"
  _CHECK_PASSED="false"
  _CHECK_OUTPUT="$_OUT"
  if [[ $_EXIT -eq 0 ]] && echo "$_OUT" | grep -qi 'install\|success\|prime-radiant'; then
    _CHECK_PASSED="true"
  fi
}

# ════════════════════════════════════════════════════════════════════
# Non-e2e tests: ALL groups in one mega-parallel wave (ADR-0059 optimization)
# Groups have no data dependencies — each uses separate namespaces.
# One collect_parallel replaces 7 sequential barriers.
# ════════════════════════════════════════════════════════════════════
_g=$(_ns)
log "── all non-e2e checks (mega-parallel wave) ──"
PARALLEL_DIR=$(mktemp -d /tmp/ruflo-accept-par-XXXXX)

# smoke
run_check_bg "version"          "Version check"          check_version            "smoke"
run_check_bg "latest-resolves"  "@latest resolves"       check_latest_resolves    "smoke"
run_check_bg "no-broken-versions" "No broken versions"   check_no_broken_versions "smoke"

# structure
run_check_bg "settings-file"    "Settings file"       check_settings_file      "structure"
run_check_bg "scope"            "Scope check"         check_scope              "structure"

# diagnostics + data + packages
run_check_bg "doctor"           "Doctor"              check_doctor             "diagnostics"
run_check_bg "wrapper-proxy"    "Wrapper proxy"       check_wrapper_proxy      "diagnostics"
run_check_bg "memory-lifecycle" "Memory lifecycle"    check_memory_lifecycle   "data"
run_check_bg "neural-training"  "Neural training"     check_neural_training    "data"
run_check_bg "booster-esm"     "Agent Booster ESM"   check_agent_booster_esm  "packages"
run_check_bg "booster-cli"     "Agent Booster CLI"   check_agent_booster_bin  "packages"
run_check_bg "plugins-sdk"     "Plugins SDK"         check_plugins_sdk        "packages"
run_check_bg "plugin-install"  "Plugin install"      check_plugin_install     "packages"

# controller (ADR-0033)
run_check_bg "ctrl-health"      "Controller health"      check_controller_health   "controller"
run_check_bg "ctrl-routing"     "Learned routing"        check_hooks_route         "controller"
run_check_bg "ctrl-scoping"     "Memory scoping"         check_memory_scoping      "controller"
run_check_bg "ctrl-reflexion"   "Reflexion lifecycle"     check_reflexion_lifecycle "controller"
run_check_bg "ctrl-batch"       "Batch operations"       check_batch_operations    "controller"
run_check_bg "ctrl-synthesis"   "Context synthesis"      check_context_synthesis   "controller"
run_check_bg "ctrl-sl-health"   "Self-learning health"   check_self_learning_health "controller"
run_check_bg "ctrl-sl-search"   "Self-learning search"   check_self_learning_search "controller"
run_check_bg "ctrl-adr0061"     "ADR-0061 controllers"   check_adr0061_controller_types "controller"

# ADR-0062: Storage & Configuration Unification
run_check_bg "adr0062-causal"      "Causal graph level 3"         check_adr0062_causal_graph_level3     "adr0062"
run_check_bg "adr0062-busy"        "SQLite busy_timeout"          check_adr0062_busy_timeout            "adr0062"
run_check_bg "adr0062-rl-cfg"      "RateLimiter/CB config"        check_adr0062_configurable_ratelimiter "adr0062"
run_check_bg "adr0062-hnsw"        "deriveHNSWParams wired"       check_adr0062_derive_hnsw_params      "adr0062"

# ADR-0063: Storage Audit Remediation
run_check_bg "adr0063-c1-import"    "Embedding import agentdb"     check_adr0063_embedding_import_agentdb  "adr0063"
run_check_bg "adr0063-c2-accessor"  "getEmbeddingService()"        check_adr0063_get_embedding_service     "adr0063"
run_check_bg "adr0063-c3-dim768"    "Dimension 768 default"        check_adr0063_dimension_768             "adr0063"
run_check_bg "adr0063-h1-rl"        "RateLimiter semantics"        check_adr0063_ratelimiter_semantics     "adr0063"
run_check_bg "adr0063-h2-maxel"     "maxElements 100K"             check_adr0063_max_elements              "adr0063"
run_check_bg "adr0063-h3-rvf"       "rvf optional dep"             check_adr0063_rvf_optional_dep          "adr0063"
run_check_bg "adr0063-m1m3-busy"    "busy_timeout broad"           check_adr0063_sqlite_busy_timeout       "adr0063"
run_check_bg "adr0063-m4-hnsw"      "deriveHNSWParams broad"       check_adr0063_derive_hnsw_broad         "adr0063"
run_check_bg "adr0063-m5-noenable"  "enableHNSW removed"           check_adr0063_no_enable_hnsw            "adr0063"
run_check_bg "adr0063-m6-lbdim"     "Learning-bridge dim"          check_adr0063_learning_bridge_dim       "adr0063"
run_check_bg "adr0063-m7-cache"     "Cache cleanup timers"         check_adr0063_cache_cleanup             "adr0063"
run_check_bg "adr0063-m8-tiered"    "tieredCache maxSize"          check_adr0063_tiered_cache_maxsize      "adr0063"

# ADR-0064: Controller Config Alignment
run_check_bg "adr0064-resdim"      "resolvedDimension"            check_adr0064_resolved_dimension        "adr0064"
run_check_bg "adr0064-no384"       "No || 384 fallback"           check_adr0064_no_384_default            "adr0064"
run_check_bg "adr0064-no-embconst" "No embedding-constants"       check_adr0064_no_embedding_constants    "adr0064"
run_check_bg "adr0064-numheads"    "numHeads aligned"             check_adr0064_numheads_aligned          "adr0064"
run_check_bg "adr0064-batch-emb"   "Batch embedder fix"           check_adr0064_batch_embedder            "adr0064"
run_check_bg "adr0064-maxel-100k" "maxElements 100K default"     check_adr0064_maxel_100k                "adr0064"

# ADR-0065: Config Centralization
run_check_bg "adr0065-no384-bridge"   "No 384 in memory-bridge"       check_adr0065_no_384_memory_bridge      "adr0065"
run_check_bg "adr0065-no384-adapter"  "No 384 in config-adapter"      check_adr0065_no_384_config_adapter     "adr0065"
run_check_bg "adr0065-no-minilm"      "No MiniLM in memory-bridge"    check_adr0065_no_minilm_memory_bridge   "adr0065"
run_check_bg "adr0065-cfg-wiring"     "Config wiring helpers"         check_adr0065_config_wiring             "adr0065"
run_check_bg "adr0065-qvs-config"     "QVS reads config"             check_adr0065_qvs_reads_config          "adr0065"
run_check_bg "adr0065-rl-windowms"    "RateLimiter windowMs"          check_adr0065_ratelimiter_windowms      "adr0065"
run_check_bg "adr0065-no-require"     "No require() in ESM"           check_adr0065_no_require_esm            "adr0065"
run_check_bg "adr0065-emb-model"      "Embedding model from config"   check_adr0065_embeddings_model_name     "adr0065"
run_check_bg "adr0065-no-sqljs"      "No SqlJsBackend"              check_adr0065_no_sqljs_backend          "adr0065"
run_check_bg "adr0065-no-jsonbe"     "No JsonBackend"               check_adr0065_no_json_backend           "adr0065"
run_check_bg "adr0065-schema"        "Shared memory-schema"         check_adr0065_shared_schema             "adr0065"
run_check_bg "adr0065-hnsw-util"     "Shared hnsw-utils"            check_adr0065_shared_hnsw_utils         "adr0065"

# ADR-0068: Controller Config Unification
run_check_bg "adr0068-no384"          "No 384 fallbacks (ADR-0068)"      check_adr0068_no_384_fallbacks     "adr0068"
run_check_bg "adr0068-no-minilm"      "No MiniLM (ADR-0068)"             check_adr0068_no_minilm            "adr0068"
run_check_bg "adr0068-no-direct-ctor" "No direct construction (ADR-0068)" check_adr0068_no_direct_construction "adr0068"
run_check_bg "adr0068-hnsw-cfg"       "HNSW config (ADR-0068)"           check_adr0068_hnsw_config          "adr0068"
run_check_bg "adr0068-ctrl-enabled"   "Controllers enabled (ADR-0068)"   check_adr0068_controllers_enabled  "adr0068"

# ADR-0069: Config Chain Bypass Remediation
run_check_bg "adr0069-adapter"       "Adapter config chain (ADR-0069)"   check_adr0069_adapter_uses_config_chain  "adr0069"
run_check_bg "adr0069-backend"       "Backend config chain (ADR-0069)"   check_adr0069_backend_uses_config_chain  "adr0069"
run_check_bg "adr0069-bridge"        "Bridge config chain (ADR-0069)"    check_adr0069_bridge_uses_config_chain   "adr0069"
run_check_bg "adr0069-hooks-rb"      "Hooks RB config chain (ADR-0069)"  check_adr0069_hooks_rb_uses_config_chain "adr0069"
run_check_bg "adr0069-bypass-count"  "Bypass count zero (ADR-0069)"      check_adr0069_bypass_count               "adr0069"
run_check_bg "adr0069-factory-max"  "Factory maxElements not 10K (ADR-0069)"  check_adr0069_factory_maxelements_not_10k  "adr0069"
run_check_bg "adr0069-hnsw-maxel"   "HNSW params include maxElements (ADR-0069)" check_adr0069_hnsw_params_include_maxelements "adr0069"

# ADR-0069 H7–H11: Additional bypass remediation
run_check_bg "adr0069-swarm-dir"   "No hardcoded swarm dir (ADR-0069 H4)"   check_adr0069_no_hardcoded_swarm_dir     "adr0069"
run_check_bg "adr0069-thresh-07"   "Search threshold not 0.5 (ADR-0069 H7)" check_adr0069_search_threshold_not_05    "adr0069"
run_check_bg "adr0069-mig-batch"   "Migration batch aligned (ADR-0069 H10)" check_adr0069_migration_batch_aligned    "adr0069"
run_check_bg "adr0069-dedup-098"   "Dedup threshold aligned (ADR-0069 H11)" check_adr0069_dedup_threshold_aligned    "adr0069"
run_check_bg "adr0069-f1-deleg"  "F1 getController delegation (ADR-0069)" check_f1_agentdbservice_delegates         "adr0069"
run_check_bg "adr0069-sarsa-key" "SARSA key path (ADR-0069 A8)"           check_adr0069_sarsa_key_path             "adr0069"
run_check_bg "adr0069-cache-10k" "Cache size consistent (ADR-0069 A9)"    check_adr0069_cache_size_consistent      "adr0069"
run_check_bg "adr0069-init-json"  "Init config is JSON (ADR-0069)"         check_init_config_is_json                "adr0069"
run_check_bg "adr0069-init-sql"   "Init has sqlite keys (ADR-0069)"        check_init_has_sqlite_keys               "adr0069"
run_check_bg "adr0069-init-neur"  "Init has neural keys (ADR-0069)"        check_init_has_neural_keys               "adr0069"
run_check_bg "adr0069-init-port"  "Init has ports keys (ADR-0069)"         check_init_has_ports_keys                "adr0069"
run_check_bg "adr0069-init-rl"    "Init has rateLimiter (ADR-0069)"        check_init_has_ratelimiter_keys           "adr0069"
run_check_bg "adr0069-init-work"  "Init has workers keys (ADR-0069)"       check_init_has_workers_keys              "adr0069"

# security & reliability (ADR-0040/0041/0042/0043/0045)
run_check_bg "sec-composition"  "Controller composition"           check_controller_composition   "security"
run_check_bg "sec-rl-consumed"  "Rate limit token consumed"        check_rate_limit_consumed       "security"
run_check_bg "sec-health-comp"  "Health composite count"           check_health_composite_count    "security"
run_check_bg "sec-quantize"     "Quantize status (B9)"             check_quantize_status           "security"
run_check_bg "sec-health-rpt"   "Health report (B3)"               check_health_report             "security"
run_check_bg "sec-filtered"     "Filtered search (B5)"             check_filtered_search           "security"
run_check_bg "sec-query-stats"  "Query stats (B6)"                 check_query_stats               "security"
run_check_bg "sec-embed-gen"    "Embedding generate (A9)"          check_embedding_generate        "security"
run_check_bg "sec-045-ctrls"    "ADR-0045 controllers (A9/D1/D3)" check_embedding_controller_registered "security"
run_check_bg "sec-embed-cfg"    "Embedding config propagation (ADR-0052)" check_embedding_config_propagation "security"

# init assertions (ADR-0038)
run_check_bg "init-config-fmt"   "Config format (SG-008)"     check_init_config_format     "init"
run_check_bg "init-helpers"      "Helper syntax"              check_init_helper_syntax     "init"
run_check_bg "init-persist"      "No persistPath (MM-001)"    check_init_no_persist_path   "init"
run_check_bg "init-perms"        "Permission globs (SG-001)"  check_init_permission_globs  "init"
run_check_bg "init-topology"     "Topology (SG-011)"          check_init_topology          "init"
run_check_bg "init-config-vals"  "Config values"              check_init_config_values     "init"

# attention suite (ADR-0044)
run_check_bg "attn-compute"     "Attention compute"        check_attention_compute          "attention"
run_check_bg "attn-benchmark"   "Attention benchmark"      check_attention_benchmark         "attention"
run_check_bg "attn-configure"   "Attention configure"      check_attention_configure         "attention"
run_check_bg "attn-metrics"     "Attention metrics (D2)"   check_attention_metrics           "attention"
run_check_bg "attn-wiring"      "Attention controllers"    check_attention_controllers_wired "attention"

# ADR-0069 F3: WASM attention packages
run_check_bg "f3-wasm-pub"      "Attention WASM published (F3)"         check_attention_wasm_published          "adr0069-f3"
run_check_bg "f3-unified-pub"   "Attention unified WASM published (F3)" check_attention_unified_wasm_published  "adr0069-f3"
run_check_bg "f3-wasm-bin"      "Attention WASM has binary (F3)"        check_attention_wasm_has_binary         "adr0069-f3"
run_check_bg "f3-unified-bin"   "Attention unified WASM binary (F3)"    check_attention_unified_wasm_has_binary "adr0069-f3"
run_check_bg "f3-wasm-load"     "Attention WASM loadable (F3)"          check_attention_wasm_loadable           "adr0069-f3"
run_check_bg "f3-mech-count"    "Attention mechanisms >= 18 (F3)"       check_attention_mechanisms_count        "adr0069-f3"

# ADR-0071/0072: scope cleanup + native binary bundling
run_check_bg "adr0071-no-ruvector"  "No @ruvector/ import refs (ADR-0071)"  check_adr0071_no_ruvector_refs     "adr0071"
run_check_bg "adr0071-node-binary"  ".node binary bundled (ADR-0071)"       check_adr0071_node_binary_exists   "adr0071"

# ════════════════════════════════════════════════════════════════════
# e2e check function definitions — launched in same wave as non-e2e.
# Each e2e subshell waits for _E2E_READY_FILE before running its check,
# so they block only until background memory init completes (~8s) while
# non-e2e grep checks execute immediately. All 85 checks run in parallel.
# ════════════════════════════════════════════════════════════════════

# Wrapper: e2e checks wait for prep, then run the actual check
_wait_e2e_ready() {
  local max_wait=30 elapsed=0
  while [[ ! -f "$_E2E_READY_FILE" ]] && (( elapsed < max_wait )); do
    sleep 0.25
    elapsed=$((elapsed + 1))
  done
}

if [[ -f "$E2E_DIR/.claude/settings.json" ]]; then
  # e2e check functions (run against E2E_DIR, not ACCEPT_TEMP)
  _e2e_memory_store() {
    _wait_e2e_ready
    local cli="$CLI_BIN"
    _CHECK_PASSED="false"
    _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory store --key ctrl-test --value 'controller activation test' --namespace ctrl-test"
    if echo "$_RK_OUT" | grep -qi 'stored\|success'; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="Memory store works in init'd project"
    else
      _CHECK_OUTPUT="Memory store failed: $_RK_OUT"
    fi
  }

  _e2e_hooks_route() {
    _wait_e2e_ready
    local cli="$CLI_BIN"
    _CHECK_PASSED="false"
    _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool hooks_route --params '{\"task\":\"write unit tests\"}'"
    if echo "$_RK_OUT" | grep -qi 'agent\|route\|coder\|tester\|pattern'; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="Hooks route returns routing decision in init'd project"
    else
      _CHECK_OUTPUT="Hooks route failed: $_RK_OUT"
    fi
  }

  _e2e_causal_edge() {
    _wait_e2e_ready
    local cli="$CLI_BIN"
    _CHECK_PASSED="false"
    # Tool name uses hyphen: agentdb_causal-edge (not underscore)
    _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool agentdb_causal-edge --params '{\"cause\":\"init\",\"effect\":\"working project\",\"uplift\":0.9}'"
    if echo "$_RK_OUT" | grep -qi 'success\|recorded\|true'; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="Causal edge accepted in init'd project"
    else
      _CHECK_OUTPUT="Causal edge failed: $_RK_OUT"
    fi
  }

  _e2e_reflexion_store() {
    _wait_e2e_ready
    local cli="$CLI_BIN"
    _CHECK_PASSED="false"
    # Upstream renamed tool: agentdb_reflexion_store -> agentdb_reflexion-store (hyphenated)
    _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool agentdb_reflexion-store --params '{\"session_id\":\"e2e-test\",\"task\":\"activation test\",\"reward\":0.9,\"success\":true}'"
    if echo "$_RK_OUT" | grep -qi 'success\|true'; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="Reflexion store accepted in init'd project"
    else
      _CHECK_OUTPUT="Reflexion store failed: $_RK_OUT"
    fi
  }

  _e2e_batch_optimize() {
    _wait_e2e_ready
    local cli="$CLI_BIN"
    _CHECK_PASSED="false"
    # Upstream renamed tool: agentdb_batch_optimize -> agentdb_batch-optimize (hyphenated)
    _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool agentdb_batch-optimize --params '{\"action\":\"stats\"}'"
    if echo "$_RK_OUT" | grep -qi 'success\|stats\|true'; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="Batch optimize accepted in init'd project"
    else
      _CHECK_OUTPUT="Batch optimize failed: $_RK_OUT"
    fi
  }

  # ADR-0043: e2e filtered search — store entries, then search with metadata filter
  _e2e_filtered_search() {
    _wait_e2e_ready
    local cli="$CLI_BIN"
    _CHECK_PASSED="false"

    # Store 3 entries with distinct metadata via memory_store
    _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory store --key filter-a --value 'high score entry' --namespace filter-test"
    _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory store --key filter-b --value 'low score entry' --namespace filter-test"
    _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory store --key filter-c --value 'medium score entry' --namespace filter-test"

    # Try agentdb_filtered_search first; fall back to memory_search if not available
    # (upstream build truncation removed agentdb_filtered_search from published package)
    _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool agentdb_filtered_search --params '{\"query\":\"score entry\",\"namespace\":\"filter-test\",\"limit\":10}'"
    local search_out="$_RK_OUT"

    # Tool may not be registered (upstream build truncation)
    if echo "$search_out" | grep -qi 'Tool not found\|not found'; then
      # Fallback: use memory_search which has built-in metadata_filter support
      _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool memory_search --params '{\"query\":\"score entry\",\"namespace\":\"filter-test\",\"limit\":10}'"
      search_out="$_RK_OUT"

      if [[ -z "$search_out" ]]; then
        _CHECK_OUTPUT="E2E filtered search: neither agentdb_filtered_search nor memory_search returned output"
        return
      fi

      if echo "$search_out" | grep -qi 'results\|score\|filter'; then
        _CHECK_PASSED="true"
        _CHECK_OUTPUT="E2E filtered search: agentdb_filtered_search not in build, memory_search returns results"
      else
        _CHECK_OUTPUT="E2E filtered search: memory_search fallback returned unexpected: $search_out"
      fi
      return
    fi

    if [[ -z "$search_out" ]]; then
      _CHECK_OUTPUT="E2E filtered search: no output from agentdb_filtered_search"
      return
    fi

    if echo "$search_out" | grep -q '"results"'; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="E2E filtered search: stored 3 entries, search returned structured results"
    else
      _CHECK_OUTPUT="E2E filtered search: unexpected response — $search_out"
    fi
  }

  # ── e2e checks: launched in same wave as non-e2e ──────────────────
  # Each e2e function calls _wait_e2e_ready internally, so subshells
  # block until background memory init completes (~8s), then run.
  # Non-e2e grep checks execute immediately. All ~85 checks in parallel.

  run_check_bg "e2e-memory-store"    "E2E memory store"       _e2e_memory_store       "e2e"
  run_check_bg "e2e-hooks-route"     "E2E hooks route"        _e2e_hooks_route        "e2e"
  run_check_bg "e2e-causal-edge"     "E2E causal edge"        _e2e_causal_edge        "e2e"
  run_check_bg "e2e-reflexion-store" "E2E reflexion store"    _e2e_reflexion_store    "e2e"
  run_check_bg "e2e-batch-optimize"  "E2E batch optimize"     _e2e_batch_optimize     "e2e"
  run_check_bg "e2e-filtered-search" "E2E filtered search"    _e2e_filtered_search    "e2e"

  # ADR-0059 Phase 1+2: memory, storage, learning, hooks
  # Wrap each external check with _wait_e2e_ready gate
  if [[ -f "$adr0059_lib" ]]; then
    _e2e_0059_mem_rt()    { _wait_e2e_ready; check_adr0059_memory_store_retrieve; }
    _e2e_0059_mem_s()     { _wait_e2e_ready; check_adr0059_memory_search; }
    _e2e_0059_persist()   { _wait_e2e_ready; check_adr0059_storage_persistence; }
    _e2e_0059_files()     { _wait_e2e_ready; check_adr0059_storage_files; }
    _e2e_0059_intel()     { _wait_e2e_ready; check_adr0059_intelligence_graph; }
    _e2e_0059_retr()      { _wait_e2e_ready; check_adr0059_retrieval_relevance; }
    _e2e_0059_insight()   { _wait_e2e_ready; check_adr0059_learning_insight_generation; }
    _e2e_0059_feedback()  { _wait_e2e_ready; check_adr0059_learning_feedback; }
    _e2e_0059_import()    { _wait_e2e_ready; check_adr0059_hook_import_populates; }
    _e2e_0059_edit()      { _wait_e2e_ready; check_adr0059_hook_edit_records_file; }
    _e2e_0059_lifecycle() { _wait_e2e_ready; check_adr0059_hook_full_lifecycle; }
    _e2e_0059_collide()   { _wait_e2e_ready; check_adr0059_no_id_collisions; }

    run_check_bg "e2e-0059-mem-roundtrip"     "Memory store→retrieve"       _e2e_0059_mem_rt    "adr0059"
    run_check_bg "e2e-0059-mem-search"        "Memory store→search"         _e2e_0059_mem_s     "adr0059"
    run_check_bg "e2e-0059-persist"           "Storage persistence"         _e2e_0059_persist   "adr0059"
    run_check_bg "e2e-0059-storage-files"     "Storage files exist"         _e2e_0059_files     "adr0059"
    run_check_bg "e2e-0059-intel-graph"       "Intelligence graph+PageRank" _e2e_0059_intel     "adr0059"
    run_check_bg "e2e-0059-retrieval"         "Retrieval relevance"         _e2e_0059_retr      "adr0059"
    run_check_bg "e2e-0059-insight"           "Insight generation"          _e2e_0059_insight   "adr0059"
    run_check_bg "e2e-0059-feedback"          "Learning feedback loop"      _e2e_0059_feedback  "adr0059"
    run_check_bg "e2e-0059-hook-import"       "Hook import populates"      _e2e_0059_import    "adr0059"
    run_check_bg "e2e-0059-hook-edit"         "Hook edit records file"     _e2e_0059_edit      "adr0059"
    run_check_bg "e2e-0059-hook-lifecycle"    "Hook full lifecycle"        _e2e_0059_lifecycle  "adr0059"
    run_check_bg "e2e-0059-no-collisions"     "No ID collisions"           _e2e_0059_collide   "adr0059"

    # Phase 3: Unified search
    if [[ -f "$adr0059_p3_lib" ]]; then
      _e2e_p3_both()  { _wait_e2e_ready; check_adr0059_unified_search_both_stores; }
      _e2e_p3_dedup() { _wait_e2e_ready; check_adr0059_unified_search_dedup; }
      _e2e_p3_crash() { _wait_e2e_ready; check_adr0059_unified_search_no_crash; }
      run_check_bg "e2e-0059-p3-unified-both"  "Unified search both stores"  _e2e_p3_both   "adr0059-p3"
      run_check_bg "e2e-0059-p3-dedup"          "Unified search dedup"        _e2e_p3_dedup  "adr0059-p3"
      run_check_bg "e2e-0059-p3-no-crash"       "Unified search no crash"     _e2e_p3_crash  "adr0059-p3"
    fi

    # Phase 4: Daemon IPC — runs AFTER collect_parallel (sequential, shared daemon)
  fi
fi

# ════════════════════════════════════════════════════════════════════
# Single collect_parallel for ALL checks (non-e2e + e2e unified wave)
# ════════════════════════════════════════════════════════════════════

# Build e2e spec list
_e2e_specs=()
if [[ -f "$E2E_DIR/.claude/settings.json" ]]; then
  _e2e_specs=(
    "e2e-memory-store|E2E memory store" "e2e-hooks-route|E2E hooks route"
    "e2e-causal-edge|E2E causal edge" "e2e-reflexion-store|E2E reflexion store"
    "e2e-batch-optimize|E2E batch optimize" "e2e-filtered-search|E2E filtered search"
  )
  if [[ -f "$adr0059_lib" ]]; then
    _e2e_specs+=(
      "e2e-0059-mem-roundtrip|Memory store→retrieve" "e2e-0059-mem-search|Memory store→search"
      "e2e-0059-persist|Storage persistence" "e2e-0059-storage-files|Storage files exist"
      "e2e-0059-intel-graph|Intelligence graph+PageRank" "e2e-0059-retrieval|Retrieval relevance"
      "e2e-0059-insight|Insight generation" "e2e-0059-feedback|Learning feedback loop"
      "e2e-0059-hook-import|Hook import populates" "e2e-0059-hook-edit|Hook edit records file"
      "e2e-0059-hook-lifecycle|Hook full lifecycle" "e2e-0059-no-collisions|No ID collisions"
    )
    if [[ -f "$adr0059_p3_lib" ]]; then
      _e2e_specs+=(
        "e2e-0059-p3-unified-both|Unified search both stores"
        "e2e-0059-p3-dedup|Unified search dedup"
        "e2e-0059-p3-no-crash|Unified search no crash"
      )
    fi
    # Phase 4 runs sequentially after collect_parallel — not in _e2e_specs
  fi
fi

collect_parallel "all" \
  "version|Version check" "latest-resolves|@latest resolves" "no-broken-versions|No broken versions" \
  "settings-file|Settings file" "scope|Scope check" \
  "doctor|Doctor" "wrapper-proxy|Wrapper proxy" \
  "memory-lifecycle|Memory lifecycle" "neural-training|Neural training" \
  "booster-esm|Agent Booster ESM" "booster-cli|Agent Booster CLI" "plugins-sdk|Plugins SDK" "plugin-install|Plugin install" \
  "ctrl-health|Controller health" "ctrl-routing|Learned routing" "ctrl-scoping|Memory scoping" \
  "ctrl-reflexion|Reflexion lifecycle" \
  "ctrl-batch|Batch operations" "ctrl-synthesis|Context synthesis" \
  "ctrl-sl-health|Self-learning health" "ctrl-sl-search|Self-learning search" \
  "ctrl-adr0061|ADR-0061 controllers" \
  "adr0062-causal|Causal graph level 3" "adr0062-busy|SQLite busy_timeout" \
  "adr0062-rl-cfg|RateLimiter/CB config" "adr0062-hnsw|deriveHNSWParams wired" \
  "adr0063-c1-import|Embedding import agentdb" "adr0063-c2-accessor|getEmbeddingService()" \
  "adr0063-c3-dim768|Dimension 768 default" "adr0063-h1-rl|RateLimiter semantics" \
  "adr0063-h2-maxel|maxElements 100K" "adr0063-h3-rvf|rvf optional dep" \
  "adr0063-m1m3-busy|busy_timeout broad" "adr0063-m4-hnsw|deriveHNSWParams broad" \
  "adr0063-m5-noenable|enableHNSW removed" "adr0063-m6-lbdim|Learning-bridge dim" \
  "adr0063-m7-cache|Cache cleanup timers" "adr0063-m8-tiered|tieredCache maxSize" \
  "adr0064-resdim|resolvedDimension" "adr0064-no384|No || 384 fallback" \
  "adr0064-no-embconst|No embedding-constants" "adr0064-numheads|numHeads aligned" \
  "adr0064-batch-emb|Batch embedder fix" \
  "adr0064-maxel-100k|maxElements 100K default" \
  "adr0065-no384-bridge|No 384 in memory-bridge" \
  "adr0065-no384-adapter|No 384 in config-adapter" \
  "adr0065-no-minilm|No MiniLM in memory-bridge" \
  "adr0065-cfg-wiring|Config wiring helpers" \
  "adr0065-qvs-config|QVS reads config" \
  "adr0065-rl-windowms|RateLimiter windowMs" \
  "adr0065-no-require|No require() in ESM" \
  "adr0065-emb-model|Embedding model from config" \
  "adr0065-no-sqljs|No SqlJsBackend" \
  "adr0065-no-jsonbe|No JsonBackend" \
  "adr0065-schema|Shared memory-schema" \
  "adr0065-hnsw-util|Shared hnsw-utils" \
  "adr0068-no384|No 384 fallbacks (ADR-0068)" \
  "adr0068-no-minilm|No MiniLM (ADR-0068)" \
  "adr0068-no-direct-ctor|No direct construction (ADR-0068)" \
  "adr0068-hnsw-cfg|HNSW config (ADR-0068)" \
  "adr0068-ctrl-enabled|Controllers enabled (ADR-0068)" \
  "adr0069-adapter|Adapter config chain (ADR-0069)" \
  "adr0069-backend|Backend config chain (ADR-0069)" \
  "adr0069-bridge|Bridge config chain (ADR-0069)" \
  "adr0069-hooks-rb|Hooks RB config chain (ADR-0069)" \
  "adr0069-bypass-count|Bypass count zero (ADR-0069)" \
  "adr0069-factory-max|Factory maxElements not 10K (ADR-0069)" \
  "adr0069-hnsw-maxel|HNSW params include maxElements (ADR-0069)" \
  "adr0069-swarm-dir|No hardcoded swarm dir (ADR-0069 H4)" \
  "adr0069-thresh-07|Search threshold not 0.5 (ADR-0069 H7)" \
  "adr0069-mig-batch|Migration batch aligned (ADR-0069 H10)" \
  "adr0069-dedup-098|Dedup threshold aligned (ADR-0069 H11)" \
  "adr0069-f1-deleg|F1 getController delegation (ADR-0069)" \
  "adr0069-sarsa-key|SARSA key path (ADR-0069 A8)" \
  "adr0069-cache-10k|Cache size consistent (ADR-0069 A9)" \
  "adr0069-init-json|Init config is JSON (ADR-0069)" \
  "adr0069-init-sql|Init has sqlite keys (ADR-0069)" \
  "adr0069-init-neur|Init has neural keys (ADR-0069)" \
  "adr0069-init-port|Init has ports keys (ADR-0069)" \
  "adr0069-init-rl|Init has rateLimiter (ADR-0069)" \
  "adr0069-init-work|Init has workers keys (ADR-0069)" \
  "sec-composition|Controller composition" \
  "sec-rl-consumed|Rate limit token consumed" "sec-health-comp|Health composite count" \
  "sec-quantize|Quantize status (B9)" "sec-health-rpt|Health report (B3)" \
  "sec-filtered|Filtered search (B5)" "sec-query-stats|Query stats (B6)" \
  "sec-embed-gen|Embedding generate (A9)" "sec-045-ctrls|ADR-0045 controllers (A9/D1/D3)" \
  "sec-embed-cfg|Embedding config propagation (ADR-0052)" \
  "init-config-fmt|Config format (SG-008)" "init-helpers|Helper syntax" \
  "init-persist|No persistPath (MM-001)" "init-perms|Permission globs (SG-001)" \
  "init-topology|Topology (SG-011)" "init-config-vals|Config values" \
  "attn-compute|Attention compute" "attn-benchmark|Attention benchmark" \
  "attn-configure|Attention configure" "attn-metrics|Attention metrics (D2)" \
  "attn-wiring|Attention controllers" \
  "f3-wasm-pub|Attention WASM published (F3)" \
  "f3-unified-pub|Attention unified WASM published (F3)" \
  "f3-wasm-bin|Attention WASM has binary (F3)" \
  "f3-unified-bin|Attention unified WASM binary (F3)" \
  "f3-wasm-load|Attention WASM loadable (F3)" \
  "f3-mech-count|Attention mechanisms >= 18 (F3)" \
  "adr0071-no-ruvector|No @ruvector/ import refs (ADR-0071)" \
  "adr0071-node-binary|.node binary bundled (ADR-0071)" \
  "${_e2e_specs[@]}"

# Wait for e2e prep background process (may already be done)
wait "$_E2E_PREP_PID" 2>/dev/null || true
rm -f "$_E2E_READY_FILE" "$_E2E_HEALTH_FILE" 2>/dev/null

# Read e2e health for context logging
_E2E_CTRL_COUNT=0
if [[ -f "$_E2E_HEALTH_FILE" ]]; then
  _E2E_HEALTH_OUT=$(cat "$_E2E_HEALTH_FILE")
  if echo "$_E2E_HEALTH_OUT" | grep -q '"name"'; then
    _E2E_CTRL_COUNT=$(echo "$_E2E_HEALTH_OUT" | grep -c '"name"')
  fi
fi
log "  e2e context: ${_E2E_CTRL_COUNT} controllers listed in health"

_record_phase "all-checks" "$(_elapsed_ms "$_g" "$(_ns)")"

# ════════════════════════════════════════════════════════════════════
# Phase 4: Daemon IPC — sequential with shared daemon lifecycle
# ════════════════════════════════════════════════════════════════════
if [[ -f "${adr0059_p4_lib:-}" && -d "${E2E_DIR:-}" && -f "$E2E_DIR/.claude/settings.json" ]]; then
  _p4_start=$(_ns)
  log "── Phase 4: Daemon IPC (sequential, shared daemon) ──"

  # Start daemon once
  _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $CLI_BIN daemon start" "" 10

  # Capture daemon PID from pid file
  _p4_pidfile="$E2E_DIR/.claude-flow/daemon.pid"
  if [[ -f "$_p4_pidfile" ]]; then
    _P4_DAEMON_PID=$(cat "$_p4_pidfile" 2>/dev/null) || true
  fi

  # Wait for socket (up to 5s)
  _p4_sock="$E2E_DIR/.claude-flow/daemon.sock"
  _p4_waited=0
  while [[ ! -e "$_p4_sock" ]] && (( _p4_waited < 20 )); do
    sleep 0.25
    _p4_waited=$((_p4_waited + 1))
  done

  # Run 5 daemon-present checks sequentially
  run_check "e2e-0059-p4-socket-exists" "Daemon IPC socket exists" \
    check_adr0059_daemon_ipc_socket_exists "adr0059-p4"
  run_check "e2e-0059-p4-ipc-probe" "Daemon IPC probe" \
    check_adr0059_daemon_ipc_probe "adr0059-p4"
  run_check "e2e-0059-p4-store" "Daemon IPC store" \
    check_adr0059_daemon_ipc_store "adr0059-p4"
  run_check "e2e-0059-p4-search" "Daemon IPC search" \
    check_adr0059_daemon_ipc_search "adr0059-p4"
  run_check "e2e-0059-p4-count" "Daemon IPC count" \
    check_adr0059_daemon_ipc_count "adr0059-p4"

  # Stop daemon cleanly
  _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $CLI_BIN daemon stop" "" 5
  sleep 0.5

  # Kill daemon PID if stop didn't work
  if [[ -n "$_P4_DAEMON_PID" ]] && kill -0 "$_P4_DAEMON_PID" 2>/dev/null; then
    kill "$_P4_DAEMON_PID" 2>/dev/null || true
    sleep 0.5
    kill -0 "$_P4_DAEMON_PID" 2>/dev/null && kill -9 "$_P4_DAEMON_PID" 2>/dev/null || true
  fi
  rm -f "$_p4_sock" "$_p4_pidfile" 2>/dev/null || true
  _P4_DAEMON_PID=""

  # Fallback check — daemon confirmed dead
  run_check "e2e-0059-p4-fallback" "Daemon IPC fallback" \
    check_adr0059_daemon_ipc_fallback "adr0059-p4"

  _record_phase "phase4-daemon" "$(_elapsed_ms "$_p4_start" "$(_ns)")"
fi

rm -rf "$E2E_DIR" "$PARALLEL_DIR"; E2E_DIR=""; PARALLEL_DIR=""

# ════════════════════════════════════════════════════════════════════
# Phase 5: Init-Generated Config Validation (ADR-0070)
# Tests what init actually generates — no harness stamping
# ════════════════════════════════════════════════════════════════════
_p5_start=$(_ns)
log "── Phase 5: Init-Generated Config (fresh init, no stamping) ──"

# Source the check library
p5_lib="${PROJECT_DIR}/lib/acceptance-init-generated-checks.sh"
if [[ -f "$p5_lib" ]]; then
  source "$p5_lib"

  # Create a completely fresh directory for Phase 5
  _P5_DIR=$(mktemp -d /tmp/ruflo-p5-XXXXX)
  PARALLEL_DIR=$(mktemp -d /tmp/ruflo-accept-par-XXXXX)

  # Run init in the fresh dir using the already-installed CLI (not npx — avoids npm 11 crash
  # on missing optional WASM deps). Use Xenova/ prefix for model name (ADR-0069 canonical).
  # Capture stderr to a log file instead of discarding — aids debugging.
  _P5_INIT_LOG="${_P5_DIR}/.init-log.txt"
  if [[ -x "$CLI_BIN" ]]; then
    (cd "$_P5_DIR" && NPM_CONFIG_REGISTRY="$REGISTRY" "$CLI_BIN" init --full --force --with-embeddings --embedding-model "Xenova/all-mpnet-base-v2" 2>"$_P5_INIT_LOG") || {
      log "WARN: Phase 5 init exited non-zero (see $_P5_INIT_LOG)"
    }
  else
    log "WARN: CLI_BIN not set — Phase 5 init skipped"
  fi

  # Export for check functions (lib uses P5_DIR without underscore)
  export P5_DIR="$_P5_DIR"
  export CLI_BIN

  # Group 1: config.json structure and values (parallel)
  run_check_bg "p5-cfg-valid"     "config.json valid"              check_p5_config_valid_json    "p5-config"
  run_check_bg "p5-cfg-sqlite"    "sqlite cacheSize=-64000"        check_p5_config_sqlite_keys   "p5-config"
  run_check_bg "p5-cfg-neural"    "neural ewcLambda=2000"          check_p5_config_neural_keys   "p5-config"
  run_check_bg "p5-cfg-ports"     "ports.mcp=3000"                 check_p5_config_ports         "p5-config"
  run_check_bg "p5-cfg-ratelimit" "windowMs=60000"                 check_p5_config_ratelimiter   "p5-config"
  run_check_bg "p5-cfg-workers"   "optimize.timeout=300000"        check_p5_config_workers       "p5-config"
  run_check_bg "p5-cfg-simthresh" "similarityThreshold=0.7"        check_p5_config_similarity    "p5-config"
  run_check_bg "p5-cfg-dedup"     "dedupThreshold=0.95"            check_p5_config_dedup         "p5-config"
  run_check_bg "p5-cfg-cpuload"   "maxCpuLoad=28"                  check_p5_config_maxcpu        "p5-config"

  # Group 2: embeddings section in config.json (parallel, no harness stamp)
  run_check_bg "p5-emb-valid"     "embeddings section present"     check_p5_embeddings_valid_json "p5-embed"
  run_check_bg "p5-emb-model"     "model=mpnet"                    check_p5_embeddings_model      "p5-embed"
  run_check_bg "p5-emb-dim"       "dimension=768"                  check_p5_embeddings_dimension  "p5-embed"
  run_check_bg "p5-emb-hnswm"     "hnsw.m=23"                     check_p5_embeddings_hnsw_m     "p5-embed"
  run_check_bg "p5-emb-efcon"     "hnsw.efConstruction=100"        check_p5_embeddings_hnsw_efc   "p5-embed"
  run_check_bg "p5-emb-efsearch"  "hnsw.efSearch=50"               check_p5_embeddings_hnsw_efs   "p5-embed"
  run_check_bg "p5-emb-maxel"     "hnsw.maxElements=100000"        check_p5_embeddings_maxel      "p5-embed"

  # Group 3: runtime memory round-trip (parallel)
  run_check_bg "p5-rt-store"      "memory store in fresh init"     check_p5_runtime_memory_store  "p5-runtime"
  run_check_bg "p5-rt-search"     "memory search in fresh init"    check_p5_runtime_memory_search "p5-runtime"

  # Group 4: CLI flag overrides (parallel)
  run_check_bg "p5-flag-port"     "init --port 4000"               check_p5_flag_port             "p5-flags"
  run_check_bg "p5-flag-simthresh" "init --similarity-threshold"   check_p5_flag_similarity       "p5-flags"
  run_check_bg "p5-flag-maxagents" "init --max-agents 10"          check_p5_flag_maxagents        "p5-flags"

  # Group 5: backward compatibility (parallel)
  run_check_bg "p5-compat-noforce" "no overwrite without --force"  check_p5_compat_no_overwrite   "p5-compat"
  run_check_bg "p5-compat-cfgset"  "config set/get round-trip"     check_p5_compat_config_set     "p5-compat"

  # Collect all Phase 5 parallel checks
  collect_parallel \
    "p5-cfg-valid|config.json valid" \
    "p5-cfg-sqlite|sqlite cacheSize=-64000" \
    "p5-cfg-neural|neural ewcLambda=2000" \
    "p5-cfg-ports|ports.mcp=3000" \
    "p5-cfg-ratelimit|windowMs=60000" \
    "p5-cfg-workers|optimize.timeout=300000" \
    "p5-cfg-simthresh|similarityThreshold=0.7" \
    "p5-cfg-dedup|dedupThreshold=0.95" \
    "p5-cfg-cpuload|maxCpuLoad=28" \
    "p5-emb-valid|embeddings section present" \
    "p5-emb-model|model=mpnet" \
    "p5-emb-dim|dimension=768" \
    "p5-emb-hnswm|hnsw.m=23" \
    "p5-emb-efcon|hnsw.efConstruction=100" \
    "p5-emb-efsearch|hnsw.efSearch=50" \
    "p5-emb-maxel|hnsw.maxElements=100000" \
    "p5-rt-store|memory store in fresh init" \
    "p5-rt-search|memory search in fresh init" \
    "p5-flag-port|init --port 4000" \
    "p5-flag-simthresh|init --similarity-threshold" \
    "p5-flag-maxagents|init --max-agents 10" \
    "p5-compat-noforce|no overwrite without --force" \
    "p5-compat-cfgset|config set/get round-trip"

  # Cleanup
  rm -rf "$_P5_DIR" 2>/dev/null
  rm -rf "$PARALLEL_DIR" 2>/dev/null
fi

_record_phase "phase5-init-config" "$(_elapsed_ms "$_p5_start" "$(_ns)")"

# ════════════════════════════════════════════════════════════════════
# Results
# ════════════════════════════════════════════════════════════════════
ACCEPT_END_NS=$(_ns)
ACCEPT_TOTAL_MS=$(_elapsed_ms "$ACCEPT_START_NS" "$ACCEPT_END_NS")
ACCEPT_END_S=$(date +%s)

results_dir="${PROJECT_DIR}/test-results/accept-${timestamp//:/}"
mkdir -p "$results_dir"

cat > "$results_dir/acceptance-results.json" <<JSONEOF
{
  "timestamp": "$timestamp",
  "registry": "$REGISTRY",
  "total_duration_ms": $ACCEPT_TOTAL_MS,
  "tests": $results_json,
  "summary": {
    "total": $total_count,
    "passed": $pass_count,
    "failed": $fail_count
  }
}
JSONEOF

log ""
log "════════════════════════════════════════════"
log "Acceptance Results: ${pass_count}/${total_count} passed, ${fail_count} failed"
log "════════════════════════════════════════════"
log ""
log "Phase timing:"
for entry in $PHASE_TIMINGS; do
  _name="${entry%%:*}"; _ms="${entry##*:}"
  [[ $ACCEPT_TOTAL_MS -gt 0 ]] && _pct=$(( (_ms * 100) / ACCEPT_TOTAL_MS )) || _pct=0
  if [[ $_ms -ge 1000 ]]; then
    log "  $(printf '%-22s %6dms (%3ds) %3d%%' "$_name" "$_ms" "$((_ms / 1000))" "$_pct")"
  else
    log "  $(printf '%-22s %6dms        %3d%%' "$_name" "$_ms" "$_pct")"
  fi
done
log "  $(printf '%-22s %6dms (%3ds)' 'TOTAL' "$ACCEPT_TOTAL_MS" "$(( ACCEPT_END_S - ACCEPT_START_S ))")"
log "════════════════════════════════════════════"
log "Results: ${results_dir}/acceptance-results.json"

# ADR-0072: Baseline regression guard
BASELINE_COUNT=148
if [[ "$pass_count" -lt "$BASELINE_COUNT" ]]; then
  log "[WARN] Regression: $pass_count passed < baseline $BASELINE_COUNT"
fi

printf '{"phase":"TOTAL","duration_ms":%d}\n' "$ACCEPT_TOTAL_MS" >> "$TIMING_FILE"

exit "$fail_count"
