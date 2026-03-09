#!/usr/bin/env bash
# scripts/test-rq.sh — Layer 3: Standalone Release Qualification runner (ADR-0023)
#
# Publishes built packages to Verdaccio, installs them, and runs RQ-1..RQ-12
# to verify packages actually work before publishing to real npm.
#
# Usage:
#   bash scripts/test-rq.sh --build-dir <path> [--port 4873] [--changed-packages <json|"all">]
#
# Exit code: number of failed RQ checks (0 = all pass)
set -uo pipefail

# ── Defaults ────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

BUILD_DIR=""
RQ_PORT=4873
CHANGED_PACKAGES="all"
RQ_TEMP=""

# ── Argument parsing ────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --build-dir)
      BUILD_DIR="${2:-}"
      [[ -z "$BUILD_DIR" ]] && { echo "Error: --build-dir requires a path"; exit 1; }
      shift 2
      ;;
    --port)
      RQ_PORT="${2:-4873}"
      shift 2
      ;;
    --changed-packages)
      CHANGED_PACKAGES="${2:-all}"
      shift 2
      ;;
    -h|--help)
      echo "Usage: bash scripts/test-rq.sh --build-dir <path> [--port 4873] [--changed-packages <json|\"all\">]"
      echo ""
      echo "Options:"
      echo "  --build-dir <path>         Built package directory (default: /tmp/ruflo-build)"
      echo "  --port <port>              Verdaccio port (default: 4873)"
      echo "  --changed-packages <json>  JSON array of changed packages, or \"all\" (default: all)"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$BUILD_DIR" ]]; then
  BUILD_DIR="/tmp/ruflo-build"
  if [[ ! -f "${BUILD_DIR}/.build-manifest.json" ]]; then
    echo "Error: no build artifacts at ${BUILD_DIR}" >&2
    echo "Run 'npm run build' first, or pass --build-dir <path>" >&2
    exit 1
  fi
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] Using cached build at ${BUILD_DIR}" >&2
fi

# ── Logging ─────────────────────────────────────────────────────────
log() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*" >&2
}

log_error() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] ERROR: $*" >&2
}

# ── Global timeout: 180s with SIGTERM→5s→SIGKILL escalation ────────
( sleep 180; log_error "[TIMEOUT] test-rq.sh exceeded 180s — sending SIGTERM"; kill -TERM -$$ 2>/dev/null || kill -TERM $$ 2>/dev/null || true; sleep 5; kill -KILL -$$ 2>/dev/null || kill -KILL $$ 2>/dev/null || true ) &
GLOBAL_TIMEOUT_PID=$!

# ── Cleanup trap ────────────────────────────────────────────────────
cleanup() {
  kill "$GLOBAL_TIMEOUT_PID" 2>/dev/null || true
  if [[ -n "$RQ_TEMP" && -d "$RQ_TEMP" ]]; then
    rm -rf "$RQ_TEMP"
  fi
}
trap cleanup EXIT INT TERM

# ── Verdaccio health check ──────────────────────────────────────────
if ! curl -sf "http://localhost:${RQ_PORT}/-/ping" >/dev/null 2>&1; then
  log_error "Verdaccio not running on port ${RQ_PORT}"
  log_error "Start it: systemctl --user start verdaccio"
  exit 1
fi
log "Verdaccio healthy on port ${RQ_PORT}"

# ── Selective cache clear ───────────────────────────────────────────
RQ_STORAGE="/home/claude/.verdaccio/storage"
if [[ "$CHANGED_PACKAGES" == "all" || "$CHANGED_PACKAGES" == "[]" ]]; then
  log "Full mode: clearing all @sparkleideas/* from Verdaccio"
  rm -rf "${RQ_STORAGE}/@sparkleideas" 2>/dev/null || true
else
  log "Incremental mode: clearing only changed packages from Verdaccio"
  echo "$CHANGED_PACKAGES" | node -e "
    const fs = require('fs');
    const pkgs = JSON.parse(fs.readFileSync('/dev/stdin', 'utf8'));
    for (const pkg of pkgs) {
      const name = pkg.replace('@sparkleideas/', '');
      const dir = '${RQ_STORAGE}/@sparkleideas/' + name;
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  " 2>/dev/null || true
fi

# ── Publish built packages to Verdaccio ─────────────────────────────
log "Publishing built packages to Verdaccio..."
npm config set "//localhost:${RQ_PORT}/:_authToken" "test-token" 2>/dev/null || true

publish_args=(--no-rate-limit --no-save)
if [[ "$CHANGED_PACKAGES" != "all" && "$CHANGED_PACKAGES" != "[]" ]]; then
  publish_args+=(--packages "$CHANGED_PACKAGES")
fi
NPM_CONFIG_REGISTRY="http://localhost:${RQ_PORT}" \
  node "${SCRIPT_DIR}/publish.mjs" --build-dir "${BUILD_DIR}" "${publish_args[@]}" 2>&1 || {
  log_error "Failed to publish to Verdaccio"
  exit 1
}
log "Built packages published to Verdaccio"

# ── Publish local wrapper package (@sparkleideas/ruflo) to Verdaccio ──
# The wrapper lives in this repo, not the upstream build dir
if [[ -f "${PROJECT_DIR}/package.json" ]]; then
  log "Publishing local wrapper (@sparkleideas/ruflo) to Verdaccio..."
  NPM_CONFIG_REGISTRY="http://localhost:${RQ_PORT}" \
    npm publish "${PROJECT_DIR}" --access public --ignore-scripts --tag latest 2>&1 || log "  wrapper publish skipped (may already exist)"
fi

# ── Selective npm cache clear (ADR-0025) ──────────────────────────
# Two caches to clear — keep external deps (better-sqlite3, onnxruntime) cached:
#   _npx/     — npx resolution trees: always clear ALL @sparkleideas (cheap,
#               prevents 77s hangs from stale real-npm resolution entries)
#   _cacache/ — HTTP metadata + tarballs: clear only changed packages (expensive)
find "${HOME}/.npm/_npx" -path "*/@sparkleideas" -type d -exec rm -rf {} + 2>/dev/null || true
if [[ "$CHANGED_PACKAGES" == "all" || "$CHANGED_PACKAGES" == "[]" ]]; then
  grep -rl "sparkleideas" "${HOME}/.npm/_cacache/index-v5/" 2>/dev/null | xargs rm -f 2>/dev/null || true
else
  for pkg in $(echo "$CHANGED_PACKAGES" | node -e "
    JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'))
      .forEach(p => console.log(p.replace('@sparkleideas/','')))
  " 2>/dev/null); do
    grep -rl "\"@sparkleideas/${pkg}\"" "${HOME}/.npm/_cacache/index-v5/" 2>/dev/null \
      | xargs rm -f 2>/dev/null || true
  done
fi

# ── Install packages into temp dir ──────────────────────────────────
RQ_TEMP=$(mktemp -d /tmp/ruflo-rq-XXXXX)
(cd "$RQ_TEMP" && echo '{"name":"ruflo-rq-test","version":"1.0.0","private":true}' > package.json \
  && echo "registry=http://localhost:${RQ_PORT}" > .npmrc \
  && npm install @sparkleideas/cli @sparkleideas/agent-booster @sparkleideas/plugins \
     --registry "http://localhost:${RQ_PORT}" \
     --ignore-scripts --no-audit --no-fund 2>&1) || {
  log_error "Failed to install packages for RQ"
  exit 1
}

# ── Source shared test library and run checks ───────────────────────
checks_lib="${PROJECT_DIR}/lib/acceptance-checks.sh"
if [[ ! -f "$checks_lib" ]]; then
  log_error "Shared test library not found: $checks_lib"
  exit 1
fi
# shellcheck source=../lib/acceptance-checks.sh
source "$checks_lib"

# Set environment for shared checks
REGISTRY="http://localhost:${RQ_PORT}"
PKG="@sparkleideas/cli"
RUFLO_WRAPPER_PKG="@sparkleideas/ruflo@latest"
TEMP_DIR="$RQ_TEMP"

# Use a stable cache dir so external deps persist across runs (ADR-0025).
# Isolated from ~/.npm to avoid stale real-npm metadata, but NOT deleted on
# exit so external deps (better-sqlite3, onnxruntime) stay cached.
RQ_NPX_CACHE="/tmp/ruflo-rq-npxcache"
mkdir -p "$RQ_NPX_CACHE"
# Clear @sparkleideas entries from the persistent cache (same selective logic)
find "$RQ_NPX_CACHE/_npx" -path "*/@sparkleideas" -type d -exec rm -rf {} + 2>/dev/null || true
if [[ "$CHANGED_PACKAGES" == "all" || "$CHANGED_PACKAGES" == "[]" ]]; then
  grep -rl "sparkleideas" "$RQ_NPX_CACHE/_cacache/index-v5/" 2>/dev/null | xargs rm -f 2>/dev/null || true
else
  for pkg in $(echo "$CHANGED_PACKAGES" | node -e "
    JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'))
      .forEach(p => console.log(p.replace('@sparkleideas/','')))
  " 2>/dev/null); do
    grep -rl "\"@sparkleideas/${pkg}\"" "$RQ_NPX_CACHE/_cacache/index-v5/" 2>/dev/null \
      | xargs rm -f 2>/dev/null || true
  done
fi
export NPM_CONFIG_CACHE="$RQ_NPX_CACHE"

# Define run_timed for the shared library
run_timed() {
  local t_start t_end
  t_start=$(date +%s%N 2>/dev/null || echo 0)
  _OUT="$(eval "$@" 2>&1)" || true
  _EXIT=${PIPESTATUS[0]:-$?}
  t_end=$(date +%s%N 2>/dev/null || echo 0)
  if [[ "$t_start" == "0" || "$t_end" == "0" ]]; then
    _DURATION_MS=0
  else
    _DURATION_MS=$(( (t_end - t_start) / 1000000 ))
  fi
}

# ── Run RQ-1..RQ-12 ────────────────────────────────────────────────
rq_pass=0
rq_fail=0
rq_total=0
rq_results_json="[]"
rq_timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
rq_start_s=$(date +%s)

run_rq_check() {
  local id="$1" name="$2" fn="$3"
  rq_total=$((rq_total + 1))
  log "  RQ $id: $name..."
  local rq_start_ns rq_end_ns rq_dur_ms=0
  rq_start_ns=$(date +%s%N 2>/dev/null || echo 0)
  "$fn"
  rq_end_ns=$(date +%s%N 2>/dev/null || echo 0)
  if [[ "$rq_start_ns" != "0" && "$rq_end_ns" != "0" ]]; then
    rq_dur_ms=$(( (rq_end_ns - rq_start_ns) / 1000000 ))
  fi
  if [[ $rq_dur_ms -gt 15000 ]]; then
    log "  SLOW  $id: ${rq_dur_ms}ms (threshold: 15000ms)"
  fi
  local rq_passed_bool="false"
  if [[ "$_CHECK_PASSED" == "true" ]]; then
    rq_pass=$((rq_pass + 1))
    rq_passed_bool="true"
    log "  PASS  $id: $name"
  else
    rq_fail=$((rq_fail + 1))
    log "  FAIL  $id: $name"
    echo "${_CHECK_OUTPUT:-}" | head -3 | while IFS= read -r line; do
      log "        $line"
    done
  fi
  # Escape output for JSON (matches test-acceptance.sh format)
  local rq_escaped_output
  rq_escaped_output=$(printf '%s' "${_CHECK_OUTPUT:-${_OUT:-}}" | head -c 4096 | python3 -c '
import sys, json
data = sys.stdin.read()
print(json.dumps(data), end="")
' 2>/dev/null || echo '""')

  local rq_entry
  rq_entry=$(printf '{"id":"%s","name":"%s","passed":%s,"output":%s,"duration_ms":%d}' \
    "$id" "$name" "$rq_passed_bool" "$rq_escaped_output" "$rq_dur_ms")
  if [[ "$rq_results_json" == "[]" ]]; then
    rq_results_json="[$rq_entry]"
  else
    rq_results_json="${rq_results_json%]}, $rq_entry]"
  fi
}

run_rq_check "RQ-1"  "Version check"       check_version
run_rq_check "RQ-2"  "Init"                check_init
run_rq_check "RQ-3"  "Settings file"       check_settings_file
run_rq_check "RQ-4"  "Scope check"         check_scope
run_rq_check "RQ-5"  "Doctor"              check_doctor
run_rq_check "RQ-6"  "MCP config"          check_mcp_config
run_rq_check "RQ-7"  "Wrapper proxy"       check_wrapper_proxy
run_rq_check "RQ-8"  "Memory lifecycle"    check_memory_lifecycle
run_rq_check "RQ-9"  "Neural training"     check_neural_training
run_rq_check "RQ-10" "Agent Booster ESM"   check_agent_booster_esm
run_rq_check "RQ-11" "Agent Booster CLI"   check_agent_booster_bin
run_rq_check "RQ-12" "Plugins SDK"         check_plugins_sdk
run_rq_check "RQ-13" "@latest resolves"    check_latest_resolves
run_rq_check "RQ-14" "ruflo init --full"   check_ruflo_init_full

log "Release Qualification: ${rq_pass}/${rq_total} passed, ${rq_fail} failed"

# ── Write qualification-results.json ────────────────────────────────
rq_results_dir="${PROJECT_DIR}/test-results/rq-${rq_timestamp//:/}"
mkdir -p "$rq_results_dir"
cat > "$rq_results_dir/qualification-results.json" <<RQJSONEOF
{
  "timestamp": "$rq_timestamp",
  "layer": 3,
  "registry": "http://localhost:${RQ_PORT}",
  "total": $rq_total,
  "passed": $rq_pass,
  "failed": $rq_fail,
  "results": $rq_results_json
}
RQJSONEOF
log "RQ results written to ${rq_results_dir}/qualification-results.json"

rq_end_s=$(date +%s)
log "Release Qualification completed in $(( rq_end_s - rq_start_s ))s"

exit "$rq_fail"
