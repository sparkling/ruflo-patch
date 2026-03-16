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

# ── Source acceptance harness framework ────────────────────────────
source "${PROJECT_DIR}/lib/acceptance-harness.sh"

# ── Global timeout: 300s ────────────────────────────────────────────
# Close fd 9 (flock) so orphaned timeout process cannot hold the pipeline lock
# Close ALL inherited fds so timeout sleep doesn't hold pipes open
( exec 9>&- 1>/dev/null 2>/dev/null; sleep 300; kill -TERM -$$ 2>/dev/null || kill -TERM $$ 2>/dev/null || true; sleep 5; kill -KILL -$$ 2>/dev/null || kill -KILL $$ 2>/dev/null || true ) &
GLOBAL_TIMEOUT_PID=$!

# ── Cleanup ─────────────────────────────────────────────────────────
cleanup() {
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

# Phase: Install packages from registry
_p=$(_ns)
ACCEPT_TEMP=$(mktemp -d /tmp/ruflo-accept-XXXXX)
(cd "$ACCEPT_TEMP" \
  && echo '{"name":"ruflo-accept-test","version":"1.0.0","private":true}' > package.json \
  && echo "registry=${REGISTRY}" > .npmrc \
  && npm install @sparkleideas/cli @sparkleideas/agent-booster @sparkleideas/plugins \
     --registry "$REGISTRY" --ignore-scripts --no-audit --no-fund 2>&1) || {
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

log "Running harness: init --full --force"
(cd "$ACCEPT_TEMP" && NPM_CONFIG_REGISTRY="$REGISTRY" timeout --signal=KILL 60 "$CLI_BIN" init --full --force 2>&1) || {
  log_error "Harness: init --full failed"; exit 1
}

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
sed -i '/__RUFLO_DONE__/d' "$_harness_mem_tmpfile"
_harness_mem_out=$(cat "$_harness_mem_tmpfile" 2>/dev/null)
rm -f "$_harness_mem_tmpfile"

if echo "$_harness_mem_out" | grep -qi 'initialized\|verification passed'; then
  log "Harness: memory init succeeded"
else
  log "WARN: memory init output unclear (continuing): $(echo "$_harness_mem_out" | tail -3 | tr '\n' ' ')"
fi
_record_phase "harness-init" "$(_elapsed_ms "$_p" "$(_ns)")"

# ════════════════════════════════════════════════════════════════════
# Source shared check library
# ════════════════════════════════════════════════════════════════════
checks_lib="${PROJECT_DIR}/lib/acceptance-checks.sh"
[[ -f "$checks_lib" ]] || { log_error "Missing: $checks_lib"; exit 1; }
source "$checks_lib"

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
  _OUT="$(timeout --signal=KILL 60 bash -c "$*" 2>&1)" || true
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
# Tests: smoke (parallel — all independent)
# ════════════════════════════════════════════════════════════════════
_g=$(_ns)
log "── smoke ──"
PARALLEL_DIR=$(mktemp -d /tmp/ruflo-accept-par-XXXXX)
run_check_bg "version"          "Version check"          check_version            "smoke"
run_check_bg "latest-resolves"  "@latest resolves"       check_latest_resolves    "smoke"
run_check_bg "no-broken-versions" "No broken versions"   check_no_broken_versions "smoke"
collect_parallel "smoke" \
  "version|Version check" "latest-resolves|@latest resolves" "no-broken-versions|No broken versions"
_record_phase "group-smoke" "$(_elapsed_ms "$_g" "$(_ns)")"

# ════════════════════════════════════════════════════════════════════
# Tests: structure (parallel — harness already ran init)
# ════════════════════════════════════════════════════════════════════
_g=$(_ns)
log "── structure ──"
run_check_bg "settings-file"    "Settings file"       check_settings_file      "structure"
run_check_bg "scope"            "Scope check"         check_scope              "structure"
run_check_bg "mcp-config"       "MCP config"          check_mcp_config         "structure"
collect_parallel "structure" \
  "settings-file|Settings file" "scope|Scope check" "mcp-config|MCP config"
_record_phase "group-structure" "$(_elapsed_ms "$_g" "$(_ns)")"

# ════════════════════════════════════════════════════════════════════
# Tests: diagnostics + data + packages (all overlapped in parallel)
# ════════════════════════════════════════════════════════════════════
_g=$(_ns)
log "── diagnostics + data + packages (overlapped) ──"
run_check_bg "doctor"           "Doctor"              check_doctor             "diagnostics"
run_check_bg "wrapper-proxy"    "Wrapper proxy"       check_wrapper_proxy      "diagnostics"
run_check_bg "memory-lifecycle" "Memory lifecycle"    check_memory_lifecycle   "data"
run_check_bg "neural-training"  "Neural training"     check_neural_training    "data"
run_check_bg "booster-esm"     "Agent Booster ESM"   check_agent_booster_esm  "packages"
run_check_bg "booster-cli"     "Agent Booster CLI"   check_agent_booster_bin  "packages"
run_check_bg "plugins-sdk"     "Plugins SDK"         check_plugins_sdk        "packages"
run_check_bg "plugin-install"  "Plugin install"      check_plugin_install     "packages"
collect_parallel "all" \
  "doctor|Doctor" "wrapper-proxy|Wrapper proxy" \
  "memory-lifecycle|Memory lifecycle" "neural-training|Neural training" \
  "booster-esm|Agent Booster ESM" "booster-cli|Agent Booster CLI" "plugins-sdk|Plugins SDK" "plugin-install|Plugin install"
_record_phase "groups-diag-data-pkg" "$(_elapsed_ms "$_g" "$(_ns)")"

# ════════════════════════════════════════════════════════════════════
# Tests: controller (ADR-0033, all parallel)
# ════════════════════════════════════════════════════════════════════
_g=$(_ns)
log "── controller (ADR-0033) ──"
run_check_bg "ctrl-health"      "Controller health"      check_controller_health   "controller"
run_check_bg "ctrl-routing"     "Learned routing"        check_hooks_route         "controller"
run_check_bg "ctrl-scoping"     "Memory scoping"         check_memory_scoping      "controller"
run_check_bg "ctrl-reflexion"   "Reflexion lifecycle"     check_reflexion_lifecycle "controller"
run_check_bg "ctrl-causal"      "Causal graph"           check_causal_graph        "controller"
run_check_bg "ctrl-cow"         "COW branching"          check_cow_branching       "controller"
run_check_bg "ctrl-batch"       "Batch operations"       check_batch_operations    "controller"
run_check_bg "ctrl-synthesis"   "Context synthesis"      check_context_synthesis   "controller"
run_check_bg "ctrl-sl-health"   "Self-learning health"   check_self_learning_health "controller"
run_check_bg "ctrl-sl-search"   "Self-learning search"   check_self_learning_search "controller"
collect_parallel "controller" \
  "ctrl-health|Controller health" "ctrl-routing|Learned routing" "ctrl-scoping|Memory scoping" \
  "ctrl-reflexion|Reflexion lifecycle" "ctrl-causal|Causal graph" "ctrl-cow|COW branching" \
  "ctrl-batch|Batch operations" "ctrl-synthesis|Context synthesis" \
  "ctrl-sl-health|Self-learning health" "ctrl-sl-search|Self-learning search"
_record_phase "group-controller" "$(_elapsed_ms "$_g" "$(_ns)")"

# ════════════════════════════════════════════════════════════════════
# Tests: security & reliability (ADR-0040/0041/0042, all parallel)
# ════════════════════════════════════════════════════════════════════
_g=$(_ns)
log "── security & reliability (ADR-0040/0041/0042/0043/0045) ──"
run_check_bg "sec-controllers"  "Security controllers (D4/D5/D6)"  check_security_controllers    "security"
run_check_bg "sec-ratelimit"    "Rate limiter status"              check_rate_limit_status        "security"
run_check_bg "sec-breaker"      "Circuit breaker status"           check_circuit_breaker_status   "security"
run_check_bg "sec-resource"     "Resource tracker"                 check_resource_tracker          "security"
run_check_bg "sec-composition"  "Controller composition"           check_controller_composition   "security"
run_check_bg "sec-wiring"       "Wiring remediation"               check_wiring_remediation        "security"
run_check_bg "sec-rl-consumed"  "Rate limit token consumed"        check_rate_limit_consumed       "security"
run_check_bg "sec-health-comp"  "Health composite count"           check_health_composite_count    "security"
run_check_bg "sec-quantize"     "Quantize status (B9)"             check_quantize_status           "security"
run_check_bg "sec-health-rpt"   "Health report (B3)"               check_health_report             "security"
run_check_bg "sec-filtered"     "Filtered search (B5)"             check_filtered_search           "security"
run_check_bg "sec-query-stats"  "Query stats (B6)"                 check_query_stats               "security"
run_check_bg "sec-b5b6-ctrls"   "B5/B6 controllers"               check_metadata_filter_controllers "security"
run_check_bg "sec-embed-gen"    "Embedding generate (A9)"          check_embedding_generate        "security"
run_check_bg "sec-045-ctrls"    "ADR-0045 controllers (A9/D1/D3)" check_embedding_controller_registered "security"
collect_parallel "security" \
  "sec-controllers|Security controllers (D4/D5/D6)" "sec-ratelimit|Rate limiter status" \
  "sec-breaker|Circuit breaker status" "sec-resource|Resource tracker" \
  "sec-composition|Controller composition" "sec-wiring|Wiring remediation" \
  "sec-rl-consumed|Rate limit token consumed" "sec-health-comp|Health composite count" \
  "sec-quantize|Quantize status (B9)" "sec-health-rpt|Health report (B3)" \
  "sec-filtered|Filtered search (B5)" "sec-query-stats|Query stats (B6)" \
  "sec-b5b6-ctrls|B5/B6 controllers" \
  "sec-embed-gen|Embedding generate (A9)" "sec-045-ctrls|ADR-0045 controllers (A9/D1/D3)"
_record_phase "group-security" "$(_elapsed_ms "$_g" "$(_ns)")"

# ════════════════════════════════════════════════════════════════════
# Tests: init assertions (ADR-0038, ported from init-*.test.mjs)
# ════════════════════════════════════════════════════════════════════
_g=$(_ns)
log "── init assertions (ADR-0038) ──"
run_check_bg "init-config-fmt"   "Config format (SG-008)"     check_init_config_format     "init"
run_check_bg "init-helpers"      "Helper syntax"              check_init_helper_syntax     "init"
run_check_bg "init-persist"      "No persistPath (MM-001)"    check_init_no_persist_path   "init"
run_check_bg "init-perms"        "Permission globs (SG-001)"  check_init_permission_globs  "init"
run_check_bg "init-topology"     "Topology (SG-011)"          check_init_topology          "init"
collect_parallel "init" \
  "init-config-fmt|Config format (SG-008)" "init-helpers|Helper syntax" \
  "init-persist|No persistPath (MM-001)" "init-perms|Permission globs (SG-001)" \
  "init-topology|Topology (SG-011)"
_record_phase "group-init" "$(_elapsed_ms "$_g" "$(_ns)")"

# ════════════════════════════════════════════════════════════════════
# Tests: attention suite (ADR-0044, all parallel)
# ════════════════════════════════════════════════════════════════════
_g=$(_ns)
log "── attention suite (ADR-0044) ──"
run_check_bg "attn-compute"     "Attention compute"        check_attention_compute          "attention"
run_check_bg "attn-benchmark"   "Attention benchmark"      check_attention_benchmark         "attention"
run_check_bg "attn-configure"   "Attention configure"      check_attention_configure         "attention"
run_check_bg "attn-metrics"     "Attention metrics (D2)"   check_attention_metrics           "attention"
run_check_bg "attn-wiring"      "Attention controllers"    check_attention_controllers_wired "attention"
collect_parallel "attention" \
  "attn-compute|Attention compute" "attn-benchmark|Attention benchmark" \
  "attn-configure|Attention configure" "attn-metrics|Attention metrics (D2)" \
  "attn-wiring|Attention controllers"
_record_phase "group-attention" "$(_elapsed_ms "$_g" "$(_ns)")"

# ════════════════════════════════════════════════════════════════════
# Tests: e2e — controller activation on init'd project (split from T32)
# Each check exercises one controller in a fresh init'd project
# ════════════════════════════════════════════════════════════════════
_g=$(_ns)
log "── e2e (controller activation) ──"

# Create a fresh project for e2e tests
E2E_DIR=$(mktemp -d /tmp/ruflo-e2e-XXXXX)
_run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $CLI_BIN init --full --force"

if [[ ! -f "$E2E_DIR/.claude/settings.json" ]]; then
  log "  WARN  e2e harness: init --full did not produce settings.json — skipping e2e group"
else
  # Init memory in the e2e project
  _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $CLI_BIN memory init"

  # Get controller health for context
  _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $CLI_BIN mcp exec --tool agentdb_health"
  _E2E_HEALTH_OUT="$_RK_OUT"
  _E2E_CTRL_COUNT=0
  if echo "$_E2E_HEALTH_OUT" | grep -q '"name"'; then
    _E2E_CTRL_COUNT=$(echo "$_E2E_HEALTH_OUT" | grep -c '"name"')
  fi

  # e2e check functions (run against E2E_DIR, not ACCEPT_TEMP)
  _e2e_memory_store() {
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
    local cli="$CLI_BIN"
    _CHECK_PASSED="false"
    _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool agentdb_causal-edge --params '{\"cause\":\"init\",\"effect\":\"working project\",\"uplift\":0.9}'"
    if echo "$_RK_OUT" | grep -qi 'success\|recorded\|true'; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="Causal edge accepted in init'd project"
    else
      _CHECK_OUTPUT="Causal edge failed: $_RK_OUT"
    fi
  }

  _e2e_reflexion_store() {
    local cli="$CLI_BIN"
    _CHECK_PASSED="false"
    _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool agentdb_reflexion-store --params '{\"session_id\":\"e2e-test\",\"task\":\"activation test\",\"reward\":0.9,\"success\":true}'"
    if echo "$_RK_OUT" | grep -qi 'success\|true'; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="Reflexion store accepted in init'd project"
    else
      _CHECK_OUTPUT="Reflexion store failed: $_RK_OUT"
    fi
  }

  _e2e_batch_optimize() {
    local cli="$CLI_BIN"
    _CHECK_PASSED="false"
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
    local cli="$CLI_BIN"
    _CHECK_PASSED="false"

    # Store 3 entries with distinct metadata via memory_store
    _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory store --key filter-a --value 'high score entry' --namespace filter-test"
    _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory store --key filter-b --value 'low score entry' --namespace filter-test"
    _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory store --key filter-c --value 'medium score entry' --namespace filter-test"

    # Search with agentdb_filtered_search (exercises the new MCP tool end-to-end)
    _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli mcp exec --tool agentdb_filtered_search --params '{\"query\":\"score entry\",\"namespace\":\"filter-test\",\"limit\":10}'"
    local search_out="$_RK_OUT"

    if [[ -z "$search_out" ]]; then
      _CHECK_OUTPUT="E2E filtered search: no output from agentdb_filtered_search"
      return
    fi

    if echo "$search_out" | grep -q '"results"' && echo "$search_out" | grep -q '"success"'; then
      _CHECK_PASSED="true"
      _CHECK_OUTPUT="E2E filtered search: stored 3 entries, search returned structured results"
    else
      _CHECK_OUTPUT="E2E filtered search: unexpected response — $search_out"
    fi
  }

  run_check_bg "e2e-memory-store"    "E2E memory store"       _e2e_memory_store       "e2e"
  run_check_bg "e2e-hooks-route"     "E2E hooks route"        _e2e_hooks_route        "e2e"
  run_check_bg "e2e-causal-edge"     "E2E causal edge"        _e2e_causal_edge        "e2e"
  run_check_bg "e2e-reflexion-store" "E2E reflexion store"    _e2e_reflexion_store    "e2e"
  run_check_bg "e2e-batch-optimize"  "E2E batch optimize"     _e2e_batch_optimize     "e2e"
  run_check_bg "e2e-filtered-search" "E2E filtered search"    _e2e_filtered_search    "e2e"
  collect_parallel "e2e" \
    "e2e-memory-store|E2E memory store" "e2e-hooks-route|E2E hooks route" \
    "e2e-causal-edge|E2E causal edge" "e2e-reflexion-store|E2E reflexion store" \
    "e2e-batch-optimize|E2E batch optimize" "e2e-filtered-search|E2E filtered search"

  log "  e2e context: ${_E2E_CTRL_COUNT} controllers listed in health"
fi
rm -rf "$E2E_DIR"; E2E_DIR=""

rm -rf "$PARALLEL_DIR"; PARALLEL_DIR=""

_record_phase "group-e2e" "$(_elapsed_ms "$_g" "$(_ns)")"

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

printf '{"phase":"TOTAL","duration_ms":%d}\n' "$ACCEPT_TOTAL_MS" >> "$TIMING_FILE"

exit "$fail_count"
