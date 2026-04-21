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
#   attention  — (ADR-0082: deferred — attention tools absent from published package)
#   adr0069-f3 — (ADR-0082: deferred — attention tools absent from published package)
#   adr0071    — adr0071-no-ruvector, adr0071-node-binary
#   e2e        — e2e-memory-store, e2e-hooks-route, e2e-causal-edge,
#                e2e-reflexion-store, e2e-batch-optimize
#   e2e-storage — e2e-store-rvf, e2e-semantic, e2e-list-store,
#                e2e-dual-write, e2e-dim768, e2e-no-dead-files,
#                e2e-cfg-roundtrip
#   adr0084    — adr0084-no-sqljs-desc, adr0084-p2-exports,
#                adr0084-p2-bridge, e2e-0084-no-sqljs,
#                adr0084-p3-worker, adr0084-p3-hooks,
#                adr0084-p3-shadows, adr0084-p3-fallback,
#                adr0084-p4-nobridge, adr0084-p4-shutdown,
#                adr0084-p4-zero-ext, adr0084-p4-export
#   adr0085    — adr0085-no-bridge, adr0085-init-zero, adr0085-router-reg
#   adr0086    — adr0086-init-shim, adr0086-router-api, adr0086-roundtrip,
#                adr0086-no-imports, adr0086-no-quant, adr0086-no-attn,
#                adr0086-adapter, adr0086-bulkdel, adr0086-b1-decay,
#                adr0086-b3-health, adr0086-t33-track, adr0086-debt15
#   adr0088    — adr0088-no-ipc, adr0088-status, adr0088-init-no,
#                adr0088-init-yes, adr0088-daemon-ok
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

# ── Global timeout: 600s ────────────────────────────────────────────
# Close fd 9 (flock) so orphaned timeout process cannot hold the pipeline lock
# Close ALL inherited fds so timeout sleep doesn't hold pipes open
( exec 9>&- 1>/dev/null 2>/dev/null; sleep 600; kill -TERM -$$ 2>/dev/null || kill -TERM $$ 2>/dev/null || true; sleep 5; kill -KILL -$$ 2>/dev/null || kill -KILL $$ 2>/dev/null || true ) &
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
trap cleanup EXIT
trap 'cleanup; exit 143' INT TERM

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
  && npm install @sparkleideas/cli @sparkleideas/agent-booster @sparkleideas/plugins @sparkleideas/memory \
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

# ADR-0082: removed embeddings.json stamping — init must write correct values

log "Running harness: memory init --force"
# Sentinel-based completion detection (ADR-0039 T1) — CLI hangs after
# completion (open SQLite handles). Run command, append sentinel when done,
# poll for sentinel or timeout.
_harness_mem_out=""
_harness_mem_tmpfile=$(mktemp /tmp/rk-harness-XXXXX)
> "$_harness_mem_tmpfile"
( cd "$ACCEPT_TEMP" && NPM_CONFIG_REGISTRY="$REGISTRY" "$CLI_BIN" memory init --force >> "$_harness_mem_tmpfile" 2>&1; echo "__RUFLO_DONE__" >> "$_harness_mem_tmpfile" ) &
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

# ADR-0082: removed manual DDL — product must create memory_entries or fail
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

# ────────────────────────────────────────────────────────────────────
# Daemon lifecycle: start the background worker daemon that the
# SessionStart hook would normally start (but bash acceptance never
# fires SessionStart). Lets `socket-exists` / `ipc-probe` checks run
# against a live socket instead of skip_accepted.
#
# Layer 1 (shutdown): cleanup() at line ~113 already kills the
# daemon via PID file on any exit path — EXIT / INT / TERM.
# Layer 2 (pre-start reap): kill any stale PID from a prior run that
# used the same E2E_DIR (shouldn't happen with mktemp -d, but safe
# if the harness is re-entered with REUSE_E2E=1 etc.).
# ────────────────────────────────────────────────────────────────────
_reap_stale_daemon() {
  local _d="$1"
  local _pid_file="${_d}/.claude-flow/daemon.pid"
  [[ ! -f "$_pid_file" ]] && return
  local _stale_pid
  _stale_pid=$(cat "$_pid_file" 2>/dev/null) || return
  if [[ -n "$_stale_pid" ]] && kill -0 "$_stale_pid" 2>/dev/null; then
    # PID-recycle protection: only kill if args match 'cli ... daemon'
    if ps -p "$_stale_pid" -o args= 2>/dev/null | grep -q 'cli.*daemon'; then
      log "  reaping stale daemon PID $_stale_pid in $_d"
      kill -TERM "$_stale_pid" 2>/dev/null || true
      sleep 0.5
      kill -0 "$_stale_pid" 2>/dev/null && kill -KILL "$_stale_pid" 2>/dev/null || true
    fi
  fi
  rm -f "$_pid_file" "${_d}/.claude-flow/daemon.sock" 2>/dev/null || true
}

_start_harness_daemon() {
  local _d="$1"
  _reap_stale_daemon "$_d"
  # Fire in background — daemon start --foreground blocks; --quiet suppresses banner.
  (cd "$_d" && NPM_CONFIG_REGISTRY="$REGISTRY" "$CLI_BIN" daemon start --quiet >/dev/null 2>&1) &
  # Wait up to 5s for the socket to appear. If it never does, checks will
  # skip_accepted — harmless; doesn't block the harness.
  local _deadline=$(( $(date +%s) + 5 ))
  while [[ $(date +%s) -lt $_deadline ]]; do
    [[ -S "${_d}/.claude-flow/daemon.sock" ]] && break
    sleep 0.1
  done
}

_start_harness_daemon "$E2E_DIR"
log "  daemon started for E2E_DIR (socket: $([[ -S "$E2E_DIR/.claude-flow/daemon.sock" ]] && echo live || echo absent))"

# ════════════════════════════════════════════════════════════════════
# Source shared check library BEFORE e2e subshell (needs _run_and_kill)
# ════════════════════════════════════════════════════════════════════
checks_lib="${PROJECT_DIR}/lib/acceptance-checks.sh"
[[ -f "$checks_lib" ]] || { log_error "Missing: $checks_lib"; exit 1; }
source "$checks_lib"

# Start e2e memory init + health check in background (15s timeout for cold start)
_E2E_READY_FILE=$(mktemp /tmp/ruflo-e2e-ready-XXXXX)
rm -f "$_E2E_READY_FILE"  # remove so _wait_e2e_ready blocks until prep writes it
_E2E_HEALTH_FILE=$(mktemp /tmp/ruflo-e2e-health-XXXXX)
(
  if [[ -f "$E2E_DIR/.claude/settings.json" ]]; then
    _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $CLI_BIN memory init --force" "" 30
    # ADR-0082: removed manual DDL — product must create memory_entries or fail
    _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $CLI_BIN mcp exec --tool agentdb_health" "" 15
    echo "$_RK_OUT" > "$_E2E_HEALTH_FILE"

    # ADR-0083: Pre-seed JSON sidecar for intelligence checks.
    # Under parallel contention, individual checks' CLI store calls can time out
    # before writeJsonSidecar() completes. Seeding here (single process, no contention)
    # ensures auto-memory-store.json has data for intelligence.cjs graph checks.
    _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $CLI_BIN memory store --key 'e2e-seed-intel' --value 'memory storage patterns and database optimization' --namespace e2e-seed" "" 20
    _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $CLI_BIN memory store --key 'e2e-seed-config' --value 'project configuration and settings management' --namespace e2e-seed" "" 15
    _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $CLI_BIN memory store --key 'e2e-seed-sidecar' --value 'phase5 single data flow sidecar seed' --namespace e2e-seed" "" 15
  fi
  echo "ready" > "$_E2E_READY_FILE"
) &
_E2E_PREP_PID=$!
_record_phase "e2e-snapshot" "$(_elapsed_ms "$_p" "$(_ns)")"

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

# ADR-0073: RVF Storage Backend Upgrade (WAL + native activation)
adr0073_lib="${PROJECT_DIR}/lib/acceptance-adr0073-checks.sh"
[[ -f "$adr0073_lib" ]] && source "$adr0073_lib"

# ADR-0079: Acceptance test completeness (Tier 1)
adr0079_t1_lib="${PROJECT_DIR}/lib/acceptance-adr0079-tier1-checks.sh"
[[ -f "$adr0079_t1_lib" ]] && source "$adr0079_t1_lib"

# ADR-0079: Acceptance test completeness (Tier 2)
adr0079_t2_lib="${PROJECT_DIR}/lib/acceptance-adr0079-tier2-checks.sh"
[[ -f "$adr0079_t2_lib" ]] && source "$adr0079_t2_lib"

# ADR-0079: Acceptance test completeness (Tier 3)
adr0079_t3_lib="${PROJECT_DIR}/lib/acceptance-adr0079-tier3-checks.sh"
[[ -f "$adr0079_t3_lib" ]] && source "$adr0079_t3_lib"

# ADR-0080: Storage consolidation verdict
adr0080_lib="${PROJECT_DIR}/lib/acceptance-adr0080-checks.sh"
[[ -f "$adr0080_lib" ]] && source "$adr0080_lib"

# ADR-0083: Phase 5 — Single Data Flow Path
adr0083_lib="${PROJECT_DIR}/lib/acceptance-adr0083-checks.sh"
[[ -f "$adr0083_lib" ]] && source "$adr0083_lib"

# ADR-0084: Dead Code Cleanup — sql.js ghost refs
adr0084_lib="${PROJECT_DIR}/lib/acceptance-adr0084-checks.sh"
[[ -f "$adr0084_lib" ]] && source "$adr0084_lib"

# ADR-0085: Bridge Deletion & Ideal State Gap Closure
adr0085_lib="${PROJECT_DIR}/lib/acceptance-adr0085-checks.sh"
[[ -f "$adr0085_lib" ]] && source "$adr0085_lib"

# ADR-0086: Layer 1 Storage Abstraction
adr0086_lib="${PROJECT_DIR}/lib/acceptance-adr0086-checks.sh"
[[ -f "$adr0086_lib" ]] && source "$adr0086_lib"

# ADR-0088: Daemon Scope Alignment — scheduler only, never hot path
adr0088_lib="${PROJECT_DIR}/lib/acceptance-adr0088-checks.sh"
[[ -f "$adr0088_lib" ]] && source "$adr0088_lib"

# ADR-0089: Controller Intercept Pattern Permanent
adr0089_lib="${PROJECT_DIR}/lib/acceptance-adr0089-checks.sh"
[[ -f "$adr0089_lib" ]] && source "$adr0089_lib"

# ADR-0094 Phase 8: Cross-tool invariants (store→search, claim→board, etc.)
phase8_lib="${PROJECT_DIR}/lib/acceptance-phase8-invariants.sh"
[[ -f "$phase8_lib" ]] && source "$phase8_lib"

# ADR-0094 Phase 9: Concurrency matrix (claims/session/workflow races; RVF delegated to t3-2)
phase9_lib="${PROJECT_DIR}/lib/acceptance-phase9-concurrency.sh"
[[ -f "$phase9_lib" ]] && source "$phase9_lib"

# ADR-0094 Phase 10: Idempotency (memory/session/config/init, 4 checks, ≤10s)
phase10_lib="${PROJECT_DIR}/lib/acceptance-phase10-idempotency.sh"
[[ -f "$phase10_lib" ]] && source "$phase10_lib"

# ADR-0094 Phase 11: Input fuzzing (8 classes × 2 reps, sampled)
phase11_lib="${PROJECT_DIR}/lib/acceptance-phase11-fuzzing.sh"
[[ -f "$phase11_lib" ]] && source "$phase11_lib"

# ADR-0094 Phase 12: Error message quality (8 classes × 2 reps)
phase12_lib="${PROJECT_DIR}/lib/acceptance-phase12-error-quality.sh"
[[ -f "$phase12_lib" ]] && source "$phase12_lib"

# ADR-0094 Phase 13: Migration backstop (vN fixture → vN+1 read, 6 checks)
phase13_lib="${PROJECT_DIR}/lib/acceptance-phase13-migration.sh"
[[ -f "$phase13_lib" ]] && source "$phase13_lib"

# ADR-0094 Phase 14: Performance SLO per tool class (8 checks, budget-bound wall-clock)
phase14_lib="${PROJECT_DIR}/lib/acceptance-phase14-slo.sh"
[[ -f "$phase14_lib" ]] && source "$phase14_lib"

# ADR-0094 Phase 15: Flakiness characterization (6 checks, serial-repetition determinism)
phase15_lib="${PROJECT_DIR}/lib/acceptance-phase15-flakiness.sh"
[[ -f "$phase15_lib" ]] && source "$phase15_lib"

# ADR-0094 Phase 16: PII detection inverse (7 inverse + 1 positive guard)
phase16_lib="${PROJECT_DIR}/lib/acceptance-phase16-pii-inverse.sh"
[[ -f "$phase16_lib" ]] && source "$phase16_lib"

# ADR-0094 Phase 17: Validator property fuzzing (15 checks, no CLI/MCP)
phase17_lib="${PROJECT_DIR}/lib/acceptance-phase17-validator-fuzzing.sh"
[[ -f "$phase17_lib" ]] && source "$phase17_lib"

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
run_check_bg "adr0090-b4-bsqlite3" "better-sqlite3 required (B4)" check_adr0090_b4_better_sqlite3_required "packages"
run_check_bg "adr0090-b1-dim-fatal" "Dim-mismatch fail-loud (B1)" check_adr0090_b1_dimension_mismatch_fatal "storage"
run_check_bg "adr0090-b2-trunc"     "Truncated .rvf fail-loud (B2)" check_adr0090_b2_rvf_truncated "storage"
run_check_bg "adr0090-b2-magic"     "Bad-magic .rvf fail-loud (B2)" check_adr0090_b2_rvf_bad_magic "storage"
run_check_bg "adr0090-b2-wal"       "Partial-WAL recovery (B2)"     check_adr0090_b2_rvf_partial_wal "storage"
run_check_bg "adr0090-b3-map"         "Worker map metrics (B3)"         check_adr0090_b3_map         "data"
run_check_bg "adr0090-b3-audit"       "Worker audit metrics (B3)"       check_adr0090_b3_audit       "data"
run_check_bg "adr0090-b3-optimize"    "Worker optimize metrics (B3)"    check_adr0090_b3_optimize    "data"
run_check_bg "adr0090-b3-consolidate" "Worker consolidate metrics (B3)" check_adr0090_b3_consolidate "data"
run_check_bg "adr0090-b3-testgaps"    "Worker testgaps metrics (B3)"    check_adr0090_b3_testgaps    "data"
run_check_bg "adr0090-b6a-daemon"     "Daemon-state round-trip (B6a)"   check_adr0090_b6a_daemon_state "daemon"

# ADR-0090 Tier B5: 15-controller SQLite row-count round-trips (controller group)
run_check_bg "adr0090-b5-reflexion"           "B5 reflexion roundtrip"           check_adr0090_b5_reflexion           "controller"
run_check_bg "adr0090-b5-skillLibrary"        "B5 skillLibrary roundtrip"        check_adr0090_b5_skillLibrary        "controller"
run_check_bg "adr0090-b5-reasoningBank"       "B5 reasoningBank roundtrip"       check_adr0090_b5_reasoningBank       "controller"
run_check_bg "adr0090-b5-causalGraph"         "B5 causalGraph roundtrip"         check_adr0090_b5_causalGraph         "controller"
run_check_bg "adr0090-b5-causalRecall"        "B5 causalRecall roundtrip"        check_adr0090_b5_causalRecall        "controller"
run_check_bg "adr0090-b5-learningSystem"      "B5 learningSystem roundtrip"      check_adr0090_b5_learningSystem      "controller"
run_check_bg "adr0090-b5-hierarchicalMemory"  "B5 hierarchicalMemory roundtrip"  check_adr0090_b5_hierarchicalMemory  "controller"
run_check_bg "adr0090-b5-memoryConsolidation" "B5 memoryConsolidation roundtrip" check_adr0090_b5_memoryConsolidation "controller"
run_check_bg "adr0090-b5-attentionService"    "B5 attentionService roundtrip"    check_adr0090_b5_attentionService    "controller"
run_check_bg "adr0090-b5-gnnService"          "B5 gnnService roundtrip"          check_adr0090_b5_gnnService          "controller"
run_check_bg "adr0090-b5-semanticRouter"      "B5 semanticRouter roundtrip"      check_adr0090_b5_semanticRouter      "controller"
run_check_bg "adr0090-b5-graphAdapter"        "B5 graphAdapter roundtrip"        check_adr0090_b5_graphAdapter        "controller"
run_check_bg "adr0090-b5-sonaTrajectory"      "B5 sonaTrajectory roundtrip"      check_adr0090_b5_sonaTrajectory      "controller"
run_check_bg "adr0090-b5-nightlyLearner"      "B5 nightlyLearner roundtrip"      check_adr0090_b5_nightlyLearner      "controller"
run_check_bg "adr0090-b5-explainableRecall"   "B5 explainableRecall roundtrip"   check_adr0090_b5_explainableRecall   "controller"

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
# ADR-0082: sarsa config-chain not in published CLI build — deferred
# run_check_bg "adr0069-sarsa-key" "SARSA key path (ADR-0069 A8)"           check_adr0069_sarsa_key_path             "adr0069"
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

# ADR-0082: attention tools absent from published package — deferred
# attention suite (ADR-0044)
# run_check_bg "attn-compute"     "Attention compute"        check_attention_compute          "attention"
# run_check_bg "attn-benchmark"   "Attention benchmark"      check_attention_benchmark         "attention"
# run_check_bg "attn-configure"   "Attention configure"      check_attention_configure         "attention"
# run_check_bg "attn-metrics"     "Attention metrics (D2)"   check_attention_metrics           "attention"
# run_check_bg "attn-wiring"      "Attention controllers"    check_attention_controllers_wired "attention"

# ADR-0082: attention tools absent from published package — deferred
# ADR-0069 F3: WASM attention packages
# run_check_bg "f3-wasm-pub"      "Attention WASM published (F3)"         check_attention_wasm_published          "adr0069-f3"
# run_check_bg "f3-unified-pub"   "Attention unified WASM published (F3)" check_attention_unified_wasm_published  "adr0069-f3"
# run_check_bg "f3-wasm-bin"      "Attention WASM has binary (F3)"        check_attention_wasm_has_binary         "adr0069-f3"
# run_check_bg "f3-unified-bin"   "Attention unified WASM binary (F3)"    check_attention_unified_wasm_has_binary "adr0069-f3"
# run_check_bg "f3-wasm-load"     "Attention WASM loadable (F3)"          check_attention_wasm_loadable           "adr0069-f3"
# run_check_bg "f3-mech-count"    "Attention mechanisms >= 18 (F3)"       check_attention_mechanisms_count        "adr0069-f3"

# ADR-0071/0072: scope cleanup + native binary bundling
run_check_bg "adr0071-no-ruvector"  "No @ruvector/ import refs (ADR-0071)"  check_adr0071_no_ruvector_refs     "adr0071"
run_check_bg "adr0071-node-binary"  ".node binary bundled (ADR-0071)"       check_adr0071_node_binary_exists   "adr0071"

# ADR-0074: CJS/ESM Dual Silo Fix
run_check_bg "adr0074-scope"        "Scope fix (ADR-0074)"                  check_adr0074_scope_fix            "adr0074"
run_check_bg "adr0074-drain"        "Drain wired (ADR-0074)"                check_adr0074_drain_wired          "adr0074"
run_check_bg "adr0074-evict-cap"    "Eviction cap (ADR-0074)"               check_adr0074_eviction_cap         "adr0074"
run_check_bg "adr0074-consolidate"  "Consolidate evicts (ADR-0074)"         check_adr0074_consolidate_evicts   "adr0074"

# ADR-0073: RVF Storage Backend Upgrade
run_check_bg "adr0073-wal"         "WAL methods (ADR-0073)"                check_adr0073_wal_methods          "adr0073"
run_check_bg "adr0073-native"      "Native package (ADR-0073)"             check_adr0073_native_package       "adr0073"
run_check_bg "adr0073-metric"      "Metric remap (ADR-0073)"               check_adr0073_metric_remap         "adr0073"
run_check_bg "adr0073-rvf-dep"     "rvf-node in dep tree (ADR-0073)"       check_adr0073_rvf_node_dep         "adr0073"
run_check_bg "adr0073-native-rt"   "Native store+query (ADR-0073)"         check_adr0073_native_runtime       "adr0073"
run_check_bg "adr0073-wal-rt"      "WAL round-trip (ADR-0073)"             check_adr0073_wal_roundtrip        "adr0073"

# ADR-0079: Test completeness (Tier 1 + Tier 2)
run_check_bg "t1-1-semantic"        "Semantic ranking (ADR-0079)"          check_t1_1_semantic_ranking            "adr0079"
run_check_bg "t1-2-learning"        "Learning feedback (ADR-0079)"         check_t1_2_learning_feedback_improves  "adr0079"
run_check_bg "t1-3-config-prop"     "Config propagation (ADR-0079)"        check_t1_3_config_propagation          "adr0079"
run_check_bg "t1-4-sqlite"          "SQLite verify (ADR-0079)"             check_t1_4_sqlite_verify               "adr0079"
run_check_bg "t1-5-mcp-stdio"       "MCP stdio (ADR-0079)"                check_t1_5_mcp_stdio                   "adr0079"
run_check_bg "t1-6-empty-search"    "Empty search (ADR-0079)"              check_t1_6_empty_search                "adr0079"
run_check_bg "t1-7-invalid-input"   "Invalid input (ADR-0079)"             check_t1_7_invalid_input               "adr0079"
run_check_bg "t1-8-codemod"         "Codemod scan (ADR-0079)"              check_t1_8_codemod_scan                "adr0079"
run_check_bg "t1-9-version-pins"    "Version pins (ADR-0079)"              check_t1_9_version_pins                "adr0079"
run_check_bg "t2-1-swarm"           "Swarm init (ADR-0079)"                check_t2_1_swarm_init                  "adr0079"
run_check_bg "t2-2-session"         "Session lifecycle (ADR-0079)"         check_t2_2_session_lifecycle            "adr0079"
run_check_bg "t2-4-embed-dim"       "Embedding dimension (ADR-0079)"       check_t2_4_embedding_dimension         "adr0079"
run_check_bg "t2-5-embed-stored"    "Embedding stored (ADR-0079)"          check_t2_5_embedding_stored            "adr0079"
run_check_bg "t2-6-claudemd"        "CLAUDE.md structure (ADR-0079)"       check_t2_6_claudemd_structure          "adr0079"

# ADR-0079 Tier 3: nice-to-have checks (wired if tier3 lib is present)
if [[ -f "$adr0079_t3_lib" ]]; then
  run_check_bg "t3-1-bulk-corpus"     "Bulk corpus ranking (ADR-0079)"       check_t3_1_bulk_corpus_ranking         "adr0079"
  run_check_bg "t3-2-concurrent"      "RVF concurrent writes (ADR-0079)"     check_t3_2_rvf_concurrent_writes       "adr0079"
  run_check_bg "t3-3-plugin"          "Plugin load/execute (ADR-0079)"       check_t3_3_plugin_load_execute         "adr0079"
  run_check_bg "t3-4-reasoningbank"   "ReasoningBank cycle (ADR-0079)"       check_t3_4_reasoningbank_cycle         "adr0079"
  run_check_bg "t3-5-consolidation"   "Nightly consolidation (ADR-0079)"     check_t3_5_nightly_consolidation       "adr0079"
  run_check_bg "t3-6-esm-import"      "ESM import (ADR-0079)"                check_t3_6_esm_import                  "adr0079"
  run_check_bg "t3-7-publish-compl"   "Publish completeness (ADR-0079)"      check_t3_7_publish_completeness        "adr0079"
fi

# ADR-0080: Storage consolidation verdict
run_check_bg "adr0080-no-1m"       "No 1M maxEntries (ADR-0080)"          check_adr0080_no_1m_maxentries         "adr0080"
run_check_bg "adr0080-100k"        "100K maxElements (ADR-0080)"          check_adr0080_maxelements_100k         "adr0080"
run_check_bg "adr0080-atomic"      "Atomic writes (ADR-0080)"             check_adr0080_atomic_writes            "adr0080"
run_check_bg "adr0080-cap"         "Store entry cap (ADR-0080)"           check_adr0080_store_cap                "adr0080"
run_check_bg "adr0080-factory"     "Factory convergence (ADR-0080)"       check_adr0080_factory_convergence      "adr0080"
run_check_bg "adr0080-provider"   "Provider transformers.js (ADR-0080)"  check_adr0080_provider_transformers_js  "adr0080"
run_check_bg "adr0080-embjson"    "Embeddings.json complete (ADR-0080)"  check_adr0080_embeddings_json_complete  "adr0080"
run_check_bg "adr0080-wizard"     "Wizard canonical model (ADR-0080)"    check_adr0080_wizard_canonical_model    "adr0080"
run_check_bg "adr0080-bridge"     "Memory-bridge 100K (ADR-0080)"        check_adr0080_memory_bridge_100k        "adr0080"
run_check_bg "adr0080-store-init" "Memory store after init (ADR-0080)"   check_adr0080_store_after_init         "adr0080"
run_check_bg "adr0080-rvf"        "RVF primary storage (ADR-0080)"       check_adr0080_rvf_primary              "adr0080"
run_check_bg "adr0080-no-copy"    "No dead .claude/memory.db (ADR-0080)" check_adr0080_no_dead_copy             "adr0080"
run_check_bg "adr0080-rvf-size"  "RVF has entries (ADR-0080)"           check_adr0080_rvf_has_entries          "adr0080"
run_check_bg "adr0080-no-graph"  "No .graph file (ADR-0080)"            check_adr0080_no_graph_file            "adr0080"
run_check_bg "adr0080-emb-dflt"  "Embeddings default on (ADR-0080)"     check_adr0080_embeddings_default_on    "adr0080"
run_check_bg "adr0080-sona"      "sonaMode balanced (ADR-0080)"         check_adr0080_sona_balanced            "adr0080"
run_check_bg "adr0080-decay"     "Decay rate aligned (ADR-0080)"        check_adr0080_decay_rate_aligned       "adr0080"
run_check_bg "adr0080-no-sqljs" "No raw sql.js imports (ADR-0080)"     check_adr0080_no_raw_sqljs             "adr0080"

# ADR-0083: Phase 5 — Single Data Flow Path
run_check_bg "adr0083-no-rvf"     "No rvf-shim (ADR-0083)"               check_adr0083_no_rvf_shim              "adr0083"
run_check_bg "adr0083-no-opendb"  "No open-database (ADR-0083)"          check_adr0083_no_open_database         "adr0083"
run_check_bg "adr0083-router"     "Router exports (ADR-0083)"            check_adr0083_router_exports           "adr0083"
run_check_bg "adr0083-no-bridge"  "No bridge in migrated (ADR-0083)"     check_adr0083_no_bridge_in_migrated    "adr0083"
run_check_bg "adr0083-no-append"  "No appendToAutoMemory (ADR-0083)"     check_adr0083_no_append_fn_in_initializer "adr0083"
run_check_bg "adr0083-no-dosync" "No doSync drain (ADR-0083)"          check_adr0083_no_dosync_drain            "adr0083"

# ADR-0084: Dead Code Cleanup — sql.js ghost refs + Phase 2 router methods
run_check_bg "adr0084-no-sqljs-desc" "No sql.js in tool descs (ADR-0084)" check_no_sqljs_in_tool_descriptions     "adr0084"
run_check_bg "adr0084-p2-exports"    "Phase 2 router exports (ADR-0084)"   check_phase2_router_exports              "adr0084"
run_check_bg "adr0084-p2-bridge"     "Phase 2 bridge loader (ADR-0084)"    check_phase2_bridge_loader               "adr0084"

# ADR-0084 Phase 3: Bridge caller migration
run_check_bg "adr0084-p3-worker"   "Worker-daemon router-only (ADR-0084)" check_phase3_worker_daemon_no_bridge   "adr0084"
run_check_bg "adr0084-p3-hooks"    "Hooks-tools router-only (ADR-0084)"   check_phase3_hooks_tools_no_bridge     "adr0084"
run_check_bg "adr0084-p3-shadows"  "No shadow replicates (ADR-0084)"      check_phase3_no_shadow_replicates      "adr0084"
run_check_bg "adr0084-p3-fallback" "Router no ctrl fallback (ADR-0084)"   check_phase3_router_no_controller_fallback "adr0084"

# ADR-0084 Phase 4: Single controller — bridge removal from route layer
run_check_bg "adr0084-p4-nobridge"  "Route methods no loadBridge (ADR-0084)"  check_phase4_router_no_loadbridge_in_routes   "adr0084"
run_check_bg "adr0084-p4-shutdown"  "Worker shutdown via router (ADR-0084)"   check_phase4_worker_daemon_shutdown_router    "adr0084"
run_check_bg "adr0084-p4-zero-ext"  "Zero external bridge imports (ADR-0084)" check_phase4_zero_external_bridge_imports     "adr0084"
run_check_bg "adr0084-p4-export"    "Router exports shutdown (ADR-0084)"      check_phase4_router_exports_shutdown          "adr0084"

# ADR-0085: Bridge Deletion & Ideal State Gap Closure
if [[ -f "$adr0085_lib" ]]; then
  run_check_bg "adr0085-no-bridge"  "Bridge absent from dist (ADR-0085)"        check_no_bridge_in_dist                  "adr0085"
  run_check_bg "adr0085-init-zero"  "Initializer zero bridge refs (ADR-0085)"   check_initializer_zero_bridge_imports     "adr0085"
  run_check_bg "adr0085-router-reg" "Router has initCtrlRegistry (ADR-0085)"    check_router_has_init_controller_registry "adr0085"
fi

# ADR-0086: Layer 1 Storage Abstraction
if [[ -f "$adr0086_lib" ]]; then
  run_check_bg "adr0086-init-shim"  "Initializer is thin shim (ADR-0086)"       check_no_initializer_in_dist             "adr0086"
  run_check_bg "adr0086-router-api" "Router exports API (ADR-0086)"             check_storage_contract_exports           "adr0086"
  run_check_bg "adr0086-roundtrip"  "Memory store+search (ADR-0086)"            check_memory_search_works                "adr0086"
  run_check_bg "adr0086-no-imports" "No initializer imports in dist (ADR-0086)" check_no_initializer_imports_in_dist     "adr0086"
  run_check_bg "adr0086-no-quant"   "No quantization exports (ADR-0086)"        check_quantization_not_exported          "adr0086"
  run_check_bg "adr0086-no-attn"    "No attention exports (ADR-0086)"            check_attention_not_exported             "adr0086"
  run_check_bg "adr0086-adapter"    "Embedding adapter present (ADR-0086)"       check_embedding_adapter_present          "adr0086"
  run_check_bg "adr0086-bulkdel"    "bulkDelete+clearNamespace (ADR-0086)"       check_bulkdelete_clearnamespace          "adr0086"
  run_check_bg "adr0086-b1-decay"   "Temporal decay stub (ADR-0086)"             check_temporal_decay_stub                "adr0086"
  run_check_bg "adr0086-b3-health"  "healthCheck not checkInit (ADR-0086)"       check_healthcheck_not_check_init         "adr0086"
  run_check_bg "adr0086-t33-track"  "T3.3 sqlite3 blockers (ADR-0086)"          check_real_sqlite3_blockers              "adr0086"
  run_check_bg "adr0086-debt15"     "Debt 15 SQLite neural path (ADR-0086)"     check_adr0086_debt15_sqlite_path         "adr0086"
fi

# ADR-0088: Daemon Scope Alignment
if [[ -f "$adr0088_lib" ]]; then
  run_check_bg "adr0088-no-ipc"      "No DaemonIPCClient (ADR-0088)"            check_adr0088_no_ipc_client             "adr0088"
  run_check_bg "adr0088-status"      "daemon status AI Mode (ADR-0088)"         check_adr0088_status_output             "adr0088"
  run_check_bg "adr0088-init-no"     "Init no-claude STILL wires daemon (ADR-0088 A2026-04-20)" check_adr0088_conditional_init_no_claude "adr0088"
  run_check_bg "adr0088-init-yes"    "Init with-claude wires daemon (ADR-0088)"               check_adr0088_conditional_init_with_claude "adr0088"
  run_check_bg "adr0088-daemon-ok"   "Daemon still works local (ADR-0088)"      check_adr0088_daemon_still_works        "adr0088"
fi

# ADR-0089: Controller Intercept Pattern Permanent
if [[ -f "$adr0089_lib" ]]; then
  run_check_bg "adr0089-shipped"    "Intercept pool shipped (ADR-0089)"        check_adr0089_intercept_shipped         "adr0089"
  run_check_bg "adr0089-svc"        "AgentDBService wraps (ADR-0089)"          check_adr0089_agentdb_service_wraps     "adr0089"
  run_check_bg "adr0089-reg"        "ControllerRegistry wraps (ADR-0089)"      check_adr0089_controller_registry_wraps "adr0089"
  run_check_bg "adr0089-live"       "Pool deterministic (ADR-0089)"            check_adr0089_pool_live                 "adr0089"
fi

# ADR-0081: M5 Max Configuration Profile
run_check_bg "adr0081-neural"   "Neural optional dep (ADR-0081)"       check_adr0081_neural_optional_dep      "adr0081"
run_check_bg "adr0081-learning" "Unified learning config (ADR-0081)"   check_adr0081_unified_learning_config  "adr0081"
run_check_bg "adr0081-balanced" "Config template balanced (ADR-0081)"  check_adr0081_config_template_balanced "adr0081"

# ADR-0094 Phase 1: Security & Safety
run_check_bg "p1-ai-scan"        "AI Defence scan (P1)"              check_adr0094_p1_aidefence_scan        "adr0094-p1"
run_check_bg "p1-ai-analyze"     "AI Defence analyze (P1)"           check_adr0094_p1_aidefence_analyze     "adr0094-p1"
run_check_bg "p1-ai-pii"         "AI Defence has_pii (P1)"           check_adr0094_p1_aidefence_has_pii     "adr0094-p1"
run_check_bg "p1-ai-safe"        "AI Defence is_safe (P1)"           check_adr0094_p1_aidefence_is_safe     "adr0094-p1"
run_check_bg "p1-ai-learn"       "AI Defence learn (P1)"             check_adr0094_p1_aidefence_learn       "adr0094-p1"
run_check_bg "p1-ai-stats"       "AI Defence stats (P1)"             check_adr0094_p1_aidefence_stats       "adr0094-p1"
run_check_bg "p1-cl-lifecycle"   "Claims lifecycle (P1)"             check_adr0094_p1_claims_lifecycle      "adr0094-p1"
run_check_bg "p1-cl-claim"       "Claims claim (P1)"                 check_adr0094_p1_claims_claim          "adr0094-p1"
run_check_bg "p1-cl-status"      "Claims status (P1)"                check_adr0094_p1_claims_status         "adr0094-p1"
run_check_bg "p1-cl-list"        "Claims list (P1)"                  check_adr0094_p1_claims_list           "adr0094-p1"
run_check_bg "p1-cl-board"       "Claims board (P1)"                 check_adr0094_p1_claims_board          "adr0094-p1"
run_check_bg "p1-cl-load"        "Claims load (P1)"                  check_adr0094_p1_claims_load           "adr0094-p1"
run_check_bg "p1-cl-handoff"     "Claims handoff (P1)"               check_adr0094_p1_claims_handoff        "adr0094-p1"
run_check_bg "p1-cl-accept"      "Claims accept-handoff (P1)"        check_adr0094_p1_claims_accept_handoff "adr0094-p1"
run_check_bg "p1-cl-steal"       "Claims steal (P1)"                 check_adr0094_p1_claims_steal          "adr0094-p1"
run_check_bg "p1-cl-stealable"   "Claims mark-stealable (P1)"        check_adr0094_p1_claims_mark_stealable "adr0094-p1"
run_check_bg "p1-cl-rebalance"   "Claims rebalance (P1)"             check_adr0094_p1_claims_rebalance      "adr0094-p1"
run_check_bg "p1-cl-release"     "Claims release (P1)"               check_adr0094_p1_claims_release        "adr0094-p1"

# ADR-0094 Phase 2: Core Runtime
run_check_bg "p2-ag-lifecycle"   "Agent lifecycle (P2)"              check_adr0094_p2_agent_lifecycle       "adr0094-p2"
run_check_bg "p2-ag-spawn"       "Agent spawn (P2)"                  check_adr0094_p2_agent_spawn           "adr0094-p2"
run_check_bg "p2-ag-list"        "Agent list (P2)"                   check_adr0094_p2_agent_list            "adr0094-p2"
run_check_bg "p2-ag-status"      "Agent status (P2)"                 check_adr0094_p2_agent_status          "adr0094-p2"
run_check_bg "p2-ag-health"      "Agent health (P2)"                 check_adr0094_p2_agent_health          "adr0094-p2"
run_check_bg "p2-ag-terminate"   "Agent terminate (P2)"              check_adr0094_p2_agent_terminate       "adr0094-p2"
run_check_bg "p2-ag-update"      "Agent update (P2)"                 check_adr0094_p2_agent_update          "adr0094-p2"
run_check_bg "p2-ag-pool"        "Agent pool (P2)"                   check_adr0094_p2_agent_pool            "adr0094-p2"
run_check_bg "p2-ap-lifecycle"   "Autopilot lifecycle (P2)"          check_adr0094_p2_autopilot_lifecycle   "adr0094-p2"
run_check_bg "p2-ap-enable"      "Autopilot enable (P2)"             check_adr0094_p2_autopilot_enable      "adr0094-p2"
run_check_bg "p2-ap-disable"     "Autopilot disable (P2)"            check_adr0094_p2_autopilot_disable     "adr0094-p2"
run_check_bg "p2-ap-status"      "Autopilot status (P2)"             check_adr0094_p2_autopilot_status      "adr0094-p2"
run_check_bg "p2-ap-config"      "Autopilot config (P2)"             check_adr0094_p2_autopilot_config      "adr0094-p2"
run_check_bg "p2-ap-predict"     "Autopilot predict (P2)"            check_adr0094_p2_autopilot_predict     "adr0094-p2"
run_check_bg "p2-ap-history"     "Autopilot history (P2)"            check_adr0094_p2_autopilot_history     "adr0094-p2"
run_check_bg "p2-ap-learn"       "Autopilot learn (P2)"              check_adr0094_p2_autopilot_learn       "adr0094-p2"
run_check_bg "p2-ap-log"         "Autopilot log (P2)"                check_adr0094_p2_autopilot_log         "adr0094-p2"
run_check_bg "p2-ap-reset"       "Autopilot reset (P2)"              check_adr0094_p2_autopilot_reset       "adr0094-p2"
run_check_bg "p2-wf-lifecycle"   "Workflow lifecycle (P2)"            check_adr0094_p2_workflow_lifecycle     "adr0094-p2"
run_check_bg "p2-wf-run"         "Workflow run (P2)"                  check_adr0094_p2_workflow_run           "adr0094-p2"
run_check_bg "p2-wf-pause"       "Workflow pause (P2)"                check_adr0094_p2_workflow_pause         "adr0094-p2"
run_check_bg "p2-wf-resume"      "Workflow resume (P2)"               check_adr0094_p2_workflow_resume        "adr0094-p2"
run_check_bg "p2-wf-template"    "Workflow template (P2)"             check_adr0094_p2_workflow_template      "adr0094-p2"
run_check_bg "p2-gu-capabilities" "Guidance capabilities (P2)"        check_adr0094_p2_guidance_capabilities  "adr0094-p2"
run_check_bg "p2-gu-discover"    "Guidance discover (P2)"             check_adr0094_p2_guidance_discover      "adr0094-p2"
run_check_bg "p2-gu-recommend"   "Guidance recommend (P2)"            check_adr0094_p2_guidance_recommend     "adr0094-p2"
run_check_bg "p2-gu-workflow"    "Guidance workflow (P2)"              check_adr0094_p2_guidance_workflow      "adr0094-p2"
run_check_bg "p2-gu-quickref"    "Guidance quickref (P2)"              check_adr0094_p2_guidance_quickref      "adr0094-p2"

# ADR-0094 Phase 3: Distributed Systems
run_check_bg "p3-hm-init"        "Hive-mind init (P3)"               check_adr0094_p3_hivemind_init          "adr0094-p3"
run_check_bg "p3-hm-join"        "Hive-mind join (P3)"               check_adr0094_p3_hivemind_join          "adr0094-p3"
run_check_bg "p3-hm-leave"       "Hive-mind leave (P3)"              check_adr0094_p3_hivemind_leave         "adr0094-p3"
run_check_bg "p3-hm-status"      "Hive-mind status (P3)"             check_adr0094_p3_hivemind_status        "adr0094-p3"
run_check_bg "p3-hm-spawn"       "Hive-mind spawn (P3)"              check_adr0094_p3_hivemind_spawn         "adr0094-p3"
run_check_bg "p3-hm-broadcast"   "Hive-mind broadcast (P3)"          check_adr0094_p3_hivemind_broadcast     "adr0094-p3"
run_check_bg "p3-hm-consensus"   "Hive-mind consensus (P3)"          check_adr0094_p3_hivemind_consensus     "adr0094-p3"
run_check_bg "p3-hm-memory"      "Hive-mind memory (P3)"             check_adr0094_p3_hivemind_memory        "adr0094-p3"
run_check_bg "p3-hm-shutdown"    "Hive-mind shutdown (P3)"            check_adr0094_p3_hivemind_shutdown      "adr0094-p3"
run_check_bg "p3-hm-lifecycle"   "Hive-mind lifecycle (P3)"           check_adr0094_p3_hivemind_lifecycle     "adr0094-p3"
run_check_bg "p3-co-consensus"   "Coordination consensus (P3)"       check_adr0094_p3_coordination_consensus "adr0094-p3"
run_check_bg "p3-co-loadbal"     "Coordination load_balance (P3)"    check_adr0094_p3_coordination_load_balance "adr0094-p3"
run_check_bg "p3-co-node"        "Coordination node (P3)"            check_adr0094_p3_coordination_node      "adr0094-p3"
run_check_bg "p3-co-orchestrate" "Coordination orchestrate (P3)"     check_adr0094_p3_coordination_orchestrate "adr0094-p3"
run_check_bg "p3-co-sync"        "Coordination sync (P3)"            check_adr0094_p3_coordination_sync      "adr0094-p3"
run_check_bg "p3-co-topology"    "Coordination topology (P3)"        check_adr0094_p3_coordination_topology  "adr0094-p3"
run_check_bg "p3-co-metrics"     "Coordination metrics (P3)"         check_adr0094_p3_coordination_metrics   "adr0094-p3"
run_check_bg "p3-da-create"      "DAA agent create (P3)"             check_adr0094_p3_daa_agent_create       "adr0094-p3"
run_check_bg "p3-da-adapt"       "DAA agent adapt (P3)"              check_adr0094_p3_daa_agent_adapt        "adr0094-p3"
run_check_bg "p3-da-cognitive"   "DAA cognitive pattern (P3)"        check_adr0094_p3_daa_cognitive_pattern  "adr0094-p3"
run_check_bg "p3-da-knowledge"   "DAA knowledge share (P3)"          check_adr0094_p3_daa_knowledge_share    "adr0094-p3"
run_check_bg "p3-da-learning"    "DAA learning status (P3)"          check_adr0094_p3_daa_learning_status    "adr0094-p3"
run_check_bg "p3-da-perf"        "DAA performance metrics (P3)"      check_adr0094_p3_daa_performance_metrics "adr0094-p3"
run_check_bg "p3-da-wf-create"   "DAA workflow create (P3)"          check_adr0094_p3_daa_workflow_create    "adr0094-p3"
run_check_bg "p3-da-wf-exec"     "DAA workflow execute (P3)"         check_adr0094_p3_daa_workflow_execute   "adr0094-p3"
run_check_bg "p3-se-lifecycle"   "Session lifecycle (P3)"            check_adr0094_p3_session_lifecycle      "adr0094-p3"
run_check_bg "p3-se-save"        "Session save (P3)"                 check_adr0094_p3_session_save           "adr0094-p3"
run_check_bg "p3-se-restore"     "Session restore (P3)"              check_adr0094_p3_session_restore        "adr0094-p3"
run_check_bg "p3-se-list"        "Session list (P3)"                 check_adr0094_p3_session_list           "adr0094-p3"
run_check_bg "p3-se-delete"      "Session delete (P3)"               check_adr0094_p3_session_delete         "adr0094-p3"
run_check_bg "p3-se-info"        "Session info (P3)"                 check_adr0094_p3_session_info           "adr0094-p3"
run_check_bg "p3-ta-lifecycle"   "Task lifecycle (P3)"               check_adr0094_p3_task_lifecycle         "adr0094-p3"
run_check_bg "p3-ta-create"      "Task create (P3)"                  check_adr0094_p3_task_create            "adr0094-p3"
run_check_bg "p3-ta-assign"      "Task assign (P3)"                  check_adr0094_p3_task_assign            "adr0094-p3"
run_check_bg "p3-ta-update"      "Task update (P3)"                  check_adr0094_p3_task_update            "adr0094-p3"
run_check_bg "p3-ta-cancel"      "Task cancel (P3)"                  check_adr0094_p3_task_cancel            "adr0094-p3"
run_check_bg "p3-ta-complete"    "Task complete (P3)"                check_adr0094_p3_task_complete          "adr0094-p3"
run_check_bg "p3-ta-list"        "Task list (P3)"                    check_adr0094_p3_task_list              "adr0094-p3"
run_check_bg "p3-ta-status"      "Task status (P3)"                  check_adr0094_p3_task_status            "adr0094-p3"
run_check_bg "p3-ta-summary"     "Task summary (P3)"                 check_adr0094_p3_task_summary           "adr0094-p3"

# ADR-0094 Phase 4: Integration & I/O
run_check_bg "p4-br-session"     "Browser session (P4)"              check_adr0094_p4_browser_session        "adr0094-p4"
run_check_bg "p4-br-eval"        "Browser eval (P4)"                 check_adr0094_p4_browser_eval           "adr0094-p4"
run_check_bg "p4-br-navigation"  "Browser navigation (P4)"           check_adr0094_p4_browser_navigation     "adr0094-p4"
run_check_bg "p4-br-interaction" "Browser interaction (P4)"          check_adr0094_p4_browser_interaction    "adr0094-p4"
run_check_bg "p4-br-snapshot"    "Browser snapshot (P4)"             check_adr0094_p4_browser_snapshot       "adr0094-p4"
run_check_bg "p4-te-create"      "Terminal create (P4)"              check_adr0094_p4_terminal_create        "adr0094-p4"
run_check_bg "p4-te-execute"     "Terminal execute (P4)"             check_adr0094_p4_terminal_execute       "adr0094-p4"
run_check_bg "p4-te-list"        "Terminal list (P4)"                check_adr0094_p4_terminal_list          "adr0094-p4"
run_check_bg "p4-te-history"     "Terminal history (P4)"             check_adr0094_p4_terminal_history       "adr0094-p4"
run_check_bg "p4-te-close"       "Terminal close (P4)"               check_adr0094_p4_terminal_close         "adr0094-p4"
run_check_bg "p4-em-init"        "Embeddings init (P4)"              check_adr0094_p4_embeddings_init        "adr0094-p4"
run_check_bg "p4-em-generate"    "Embeddings generate (P4)"          check_adr0094_p4_embeddings_generate    "adr0094-p4"
run_check_bg "p4-em-compare"     "Embeddings compare (P4)"           check_adr0094_p4_embeddings_compare     "adr0094-p4"
run_check_bg "p4-em-search"      "Embeddings search (P4)"            check_adr0094_p4_embeddings_search      "adr0094-p4"
run_check_bg "p4-em-hyperbolic"  "Embeddings hyperbolic (P4)"        check_adr0094_p4_embeddings_hyperbolic  "adr0094-p4"
run_check_bg "p4-em-neural"      "Embeddings neural (P4)"            check_adr0094_p4_embeddings_neural      "adr0094-p4"
run_check_bg "p4-em-status"      "Embeddings status (P4)"            check_adr0094_p4_embeddings_status      "adr0094-p4"
run_check_bg "p4-tr-store-srch"  "Transfer store-search (P4)"        check_adr0094_p4_transfer_store_search  "adr0094-p4"
run_check_bg "p4-tr-store-info"  "Transfer store-info (P4)"          check_adr0094_p4_transfer_store_info    "adr0094-p4"
run_check_bg "p4-tr-store-feat"  "Transfer store-featured (P4)"      check_adr0094_p4_transfer_store_featured "adr0094-p4"
run_check_bg "p4-tr-store-trend" "Transfer store-trending (P4)"      check_adr0094_p4_transfer_store_trending "adr0094-p4"
run_check_bg "p4-tr-plug-srch"   "Transfer plugin-search (P4)"       check_adr0094_p4_transfer_plugin_search "adr0094-p4"
run_check_bg "p4-tr-plug-info"   "Transfer plugin-info (P4)"         check_adr0094_p4_transfer_plugin_info   "adr0094-p4"
run_check_bg "p4-tr-plug-feat"   "Transfer plugin-featured (P4)"     check_adr0094_p4_transfer_plugin_featured "adr0094-p4"
run_check_bg "p4-tr-plug-off"    "Transfer plugin-official (P4)"     check_adr0094_p4_transfer_plugin_official "adr0094-p4"
run_check_bg "p4-tr-pii"         "Transfer detect-pii (P4)"          check_adr0094_p4_transfer_detect_pii    "adr0094-p4"
run_check_bg "p4-gh-issue"       "GitHub issue track (P4)"           check_adr0094_p4_github_issue_track     "adr0094-p4"
run_check_bg "p4-gh-pr"          "GitHub PR manage (P4)"             check_adr0094_p4_github_pr_manage       "adr0094-p4"
run_check_bg "p4-gh-metrics"     "GitHub metrics (P4)"               check_adr0094_p4_github_metrics         "adr0094-p4"
run_check_bg "p4-gh-repo"        "GitHub repo analyze (P4)"          check_adr0094_p4_github_repo_analyze    "adr0094-p4"
run_check_bg "p4-gh-workflow"    "GitHub workflow (P4)"              check_adr0094_p4_github_workflow        "adr0094-p4"
run_check_bg "p4-wa-create"      "WASM agent create (P4)"            check_adr0094_p4_wasm_agent_create      "adr0094-p4"
run_check_bg "p4-wa-list"        "WASM agent list (P4)"              check_adr0094_p4_wasm_agent_list        "adr0094-p4"
run_check_bg "p4-wa-prompt"      "WASM agent prompt (P4)"            check_adr0094_p4_wasm_agent_prompt      "adr0094-p4"
run_check_bg "p4-wa-tool"        "WASM agent tool (P4)"              check_adr0094_p4_wasm_agent_tool        "adr0094-p4"
run_check_bg "p4-wa-export"      "WASM agent export (P4)"            check_adr0094_p4_wasm_agent_export      "adr0094-p4"
run_check_bg "p4-wa-files"       "WASM agent files (P4)"             check_adr0094_p4_wasm_agent_files       "adr0094-p4"
run_check_bg "p4-wa-terminate"   "WASM agent terminate (P4)"         check_adr0094_p4_wasm_agent_terminate   "adr0094-p4"
run_check_bg "p4-wa-gal-list"    "WASM gallery list (P4)"            check_adr0094_p4_wasm_gallery_list      "adr0094-p4"
run_check_bg "p4-wa-gal-search"  "WASM gallery search (P4)"          check_adr0094_p4_wasm_gallery_search    "adr0094-p4"
run_check_bg "p4-wa-gal-create"  "WASM gallery create (P4)"          check_adr0094_p4_wasm_gallery_create    "adr0094-p4"

# ADR-0094 Phase 5: ML & Advanced
run_check_bg "p5-ne-train"       "Neural train (P5)"                 check_adr0094_p5_neural_train           "adr0094-p5"
run_check_bg "p5-ne-optimize"    "Neural optimize (P5)"              check_adr0094_p5_neural_optimize        "adr0094-p5"
run_check_bg "p5-ne-compress"    "Neural compress (P5)"              check_adr0094_p5_neural_compress        "adr0094-p5"
run_check_bg "p5-ne-predict"     "Neural predict (P5)"               check_adr0094_p5_neural_predict         "adr0094-p5"
run_check_bg "p5-ne-patterns"    "Neural patterns (P5)"              check_adr0094_p5_neural_patterns        "adr0094-p5"
run_check_bg "p5-ne-status"      "Neural status (P5)"                check_adr0094_p5_neural_status          "adr0094-p5"
run_check_bg "p5-rv-status"      "RuVLLM status (P5)"                check_adr0094_p5_ruvllm_status          "adr0094-p5"
run_check_bg "p5-rv-hnsw-create" "RuVLLM HNSW create (P5)"           check_adr0094_p5_ruvllm_hnsw_create     "adr0094-p5"
run_check_bg "p5-rv-hnsw-add"    "RuVLLM HNSW add (P5)"              check_adr0094_p5_ruvllm_hnsw_add        "adr0094-p5"
run_check_bg "p5-rv-hnsw-route"  "RuVLLM HNSW route (P5)"            check_adr0094_p5_ruvllm_hnsw_route      "adr0094-p5"
run_check_bg "p5-rv-sona-create" "RuVLLM SONA create (P5)"           check_adr0094_p5_ruvllm_sona_create     "adr0094-p5"
run_check_bg "p5-rv-sona-adapt"  "RuVLLM SONA adapt (P5)"            check_adr0094_p5_ruvllm_sona_adapt      "adr0094-p5"
run_check_bg "p5-rv-lora-create" "RuVLLM MicroLoRA create (P5)"      check_adr0094_p5_ruvllm_microlora_create "adr0094-p5"
run_check_bg "p5-rv-lora-adapt"  "RuVLLM MicroLoRA adapt (P5)"       check_adr0094_p5_ruvllm_microlora_adapt "adr0094-p5"
run_check_bg "p5-rv-gen-config"  "RuVLLM generate config (P5)"       check_adr0094_p5_ruvllm_generate_config "adr0094-p5"
run_check_bg "p5-rv-chat-fmt"    "RuVLLM chat format (P5)"           check_adr0094_p5_ruvllm_chat_format     "adr0094-p5"
run_check_bg "p5-pf-benchmark"   "Performance benchmark (P5)"        check_adr0094_p5_performance_benchmark  "adr0094-p5"
run_check_bg "p5-pf-bottleneck"  "Performance bottleneck (P5)"       check_adr0094_p5_performance_bottleneck "adr0094-p5"
run_check_bg "p5-pf-profile"     "Performance profile (P5)"          check_adr0094_p5_performance_profile    "adr0094-p5"
run_check_bg "p5-pf-optimize"    "Performance optimize (P5)"         check_adr0094_p5_performance_optimize   "adr0094-p5"
run_check_bg "p5-pf-metrics"     "Performance metrics (P5)"          check_adr0094_p5_performance_metrics    "adr0094-p5"
run_check_bg "p5-pf-report"      "Performance report (P5)"           check_adr0094_p5_performance_report     "adr0094-p5"
run_check_bg "p5-pr-check"       "Progress check (P5)"               check_adr0094_p5_progress_check         "adr0094-p5"
run_check_bg "p5-pr-summary"     "Progress summary (P5)"             check_adr0094_p5_progress_summary       "adr0094-p5"
run_check_bg "p5-pr-sync"        "Progress sync (P5)"                check_adr0094_p5_progress_sync          "adr0094-p5"
run_check_bg "p5-pr-watch"       "Progress watch (P5)"               check_adr0094_p5_progress_watch         "adr0094-p5"

# ADR-0094 Phase 6: Hooks, Error Paths & Validation
run_check_bg "p6-hk-pre-task"    "Hooks pre-task (P6)"               check_adr0094_p6_hooks_pre_task         "adr0094-p6"
run_check_bg "p6-hk-post-task"   "Hooks post-task (P6)"              check_adr0094_p6_hooks_post_task        "adr0094-p6"
run_check_bg "p6-hk-pre-edit"    "Hooks pre-edit (P6)"               check_adr0094_p6_hooks_pre_edit         "adr0094-p6"
run_check_bg "p6-hk-post-edit"   "Hooks post-edit (P6)"              check_adr0094_p6_hooks_post_edit        "adr0094-p6"
run_check_bg "p6-hk-pre-cmd"     "Hooks pre-command (P6)"            check_adr0094_p6_hooks_pre_command      "adr0094-p6"
run_check_bg "p6-hk-post-cmd"    "Hooks post-command (P6)"           check_adr0094_p6_hooks_post_command     "adr0094-p6"
run_check_bg "p6-hk-sess-start"  "Hooks session-start (P6)"          check_adr0094_p6_hooks_session_start    "adr0094-p6"
run_check_bg "p6-hk-sess-end"    "Hooks session-end (P6)"            check_adr0094_p6_hooks_session_end      "adr0094-p6"
run_check_bg "p6-err-badconfig"  "Error: invalid config (P6)"        check_adr0094_p6_invalid_config         "adr0094-p6"
run_check_bg "p6-err-noconfig"   "Error: missing config (P6)"        check_adr0094_p6_missing_config         "adr0094-p6"
run_check_bg "p6-err-corrupt"    "Error: corrupted state (P6)"       check_adr0094_p6_corrupted_state        "adr0094-p6"
run_check_bg "p6-err-perms"      "Error: permission denied (P6)"     check_adr0094_p6_permission_denied      "adr0094-p6"
run_check_bg "p6-val-traversal"  "Input: path traversal (P6)"        check_adr0094_p6_path_traversal         "adr0094-p6"
run_check_bg "p6-val-unicode"    "Input: unicode (P6)"               check_adr0094_p6_unicode_input          "adr0094-p6"
run_check_bg "p6-val-empty"      "Input: empty (P6)"                 check_adr0094_p6_empty_input            "adr0094-p6"
run_check_bg "p6-val-oversize"   "Input: oversized (P6)"             check_adr0094_p6_oversized_input        "adr0094-p6"
run_check_bg "p6-mr-route"       "Model route (P6)"                  check_adr0094_p6_model_route            "adr0094-p6"
run_check_bg "p6-mr-outcome"     "Model outcome (P6)"                check_adr0094_p6_model_outcome          "adr0094-p6"
run_check_bg "p6-mr-stats"       "Model stats (P6)"                  check_adr0094_p6_model_stats            "adr0094-p6"

# ADR-0094 Phase 7: File Output & CLI Commands
run_check_bg "p7-fo-agents"      "File: agents store.json (P7)"      check_adr0094_p7_agents_store           "adr0094-p7"
run_check_bg "p7-fo-swarm-ag"    "File: swarm agents.json (P7)"      check_adr0094_p7_swarm_agents           "adr0094-p7"
run_check_bg "p7-fo-swarm-st"    "File: swarm state.json (P7)"       check_adr0094_p7_swarm_state            "adr0094-p7"
run_check_bg "p7-fo-statusline"  "File: statusline.cjs (P7)"         check_adr0094_p7_statusline_cjs         "adr0094-p7"
run_check_bg "p7-fo-neural"      "File: neural dir (P7)"             check_adr0094_p7_neural_dir             "adr0094-p7"
run_check_bg "p7-fo-hooks"       "File: hooks dir (P7)"              check_adr0094_p7_hooks_dir              "adr0094-p7"
run_check_bg "p7-fo-config"      "File: config.json (P7)"            check_adr0094_p7_config_json            "adr0094-p7"
run_check_bg "p7-fo-settings"    "File: settings.json (P7)"          check_adr0094_p7_settings_json          "adr0094-p7"
run_check_bg "p7-cli-version"    "CLI --version (P7)"                check_adr0094_p7_cli_version            "adr0094-p7"
run_check_bg "p7-cli-doctor"     "CLI doctor (P7)"                   check_adr0094_p7_cli_doctor             "adr0094-p7"
run_check_bg "p7-cli-init"       "CLI init --help (P7)"              check_adr0094_p7_cli_init_help          "adr0094-p7"
run_check_bg "p7-cli-agent"      "CLI agent --help (P7)"             check_adr0094_p7_cli_agent_help         "adr0094-p7"
run_check_bg "p7-cli-swarm"      "CLI swarm --help (P7)"             check_adr0094_p7_cli_swarm_help         "adr0094-p7"
run_check_bg "p7-cli-memory"     "CLI memory --help (P7)"            check_adr0094_p7_cli_memory_help        "adr0094-p7"
run_check_bg "p7-cli-session"    "CLI session --help (P7)"           check_adr0094_p7_cli_session_help       "adr0094-p7"
run_check_bg "p7-cli-hooks"      "CLI hooks --help (P7)"             check_adr0094_p7_cli_hooks_help         "adr0094-p7"
run_check_bg "p7-cli-mcp"        "CLI mcp status (P7)"               check_adr0094_p7_cli_mcp_status         "adr0094-p7"
run_check_bg "p7-cli-system"     "CLI system info (P7)"              check_adr0094_p7_cli_system_info        "adr0094-p7"
run_check_bg "p7-cli-doctor-npm" "W4-A3: doctor npm no-false-fail"   check_adr0094_p7_cli_doctor_npm_no_false_fail "adr0094-p7"

# ADR-0094 Phase 8: Cross-tool invariants (11 checks, ≤20s wall-clock).
# Each uses _with_iso_cleanup for per-check isolation — no shared-state
# contention with other phases. Requires E2E_DIR initialized.
if [[ -f "$E2E_DIR/.claude/settings.json" && -f "$phase8_lib" ]]; then
  run_check_bg "p8-inv1-memory"      "INV-1 memory store→search (P8)"       check_adr0094_p8_inv1_memory_roundtrip       "adr0094-p8"
  run_check_bg "p8-inv2-session"     "INV-2 session save→list (P8)"         check_adr0094_p8_inv2_session_roundtrip      "adr0094-p8"
  run_check_bg "p8-inv3-agent"       "INV-3 agent spawn→list→terminate (P8)" check_adr0094_p8_inv3_agent_roundtrip        "adr0094-p8"
  run_check_bg "p8-inv4-claims"      "INV-4 claim→board→release (P8)"       check_adr0094_p8_inv4_claims_roundtrip       "adr0094-p8"
  run_check_bg "p8-inv5-workflow"    "INV-5 workflow create→list→delete (P8)" check_adr0094_p8_inv5_workflow_roundtrip     "adr0094-p8"
  run_check_bg "p8-inv6-config"      "INV-6 config set→get (P8)"            check_adr0094_p8_inv6_config_roundtrip       "adr0094-p8"
  run_check_bg "p8-inv7-task"        "INV-7 task create→list→complete (P8)" check_adr0094_p8_inv7_task_lifecycle         "adr0094-p8"
  run_check_bg "p8-inv8-sess-mem"    "INV-8 session save/restore preserves memory (P8)" check_adr0094_p8_inv8_session_memory_roundtrip "adr0094-p8"
  run_check_bg "p8-inv9-neural"      "INV-9 neural_patterns(store) raises patterns.total (P8)" check_adr0094_p8_inv9_neural_delta           "adr0094-p8"
  run_check_bg "p8-inv10-autopilot"  "INV-10 autopilot enable→status→predict (P8)" check_adr0094_p8_inv10_autopilot_shape       "adr0094-p8"
  run_check_bg "p8-inv11-delta"      "INV-11 delta-sentinel meta-probe (P8)" check_adr0094_p8_inv11_delta_sentinel        "adr0094-p8"
  run_check_bg "p8-inv12-mem-full"  "INV-12 memory full round-trip (P8)"    check_adr0094_p8_inv12_memory_full_roundtrip "adr0094-p8"
fi

# ADR-0094 Phase 9: Concurrency matrix (4 checks, ≤30s wall-clock).
# Each uses _with_iso_cleanup. RVF row is delegated to t3-2 (ADR-0095).
if [[ -f "$E2E_DIR/.claude/settings.json" && -f "$phase9_lib" ]]; then
  run_check_bg "p9-rvf-delegated" "P9 RVF concurrency delegated to t3-2" check_adr0094_p9_rvf_concurrent_writes_delegated "adr0094-p9"
  run_check_bg "p9-claims-winner" "P9 claims exactly-one-winner (6 racers)" check_adr0094_p9_claims_single_winner "adr0094-p9"
  run_check_bg "p9-session-noint" "P9 session no interleave (2 writers)" check_adr0094_p9_session_no_interleave "adr0094-p9"
  run_check_bg "p9-workflow-one" "P9 workflow exactly-one-created (4 racers)" check_adr0094_p9_workflow_concurrent_start "adr0094-p9"
fi

# ADR-0094 Phase 10: Idempotency (4 checks, ≤10s wall-clock).
# Each uses _with_iso_cleanup. f(x); f(x) ≡ f(x) — no dup rows, no drift,
# no silent overwrite on re-init.
if [[ -f "$E2E_DIR/.claude/settings.json" && -f "$phase10_lib" ]]; then
  run_check_bg "p10-mem-same-key"      "P10 memory_store same key idempotent"  check_adr0094_p10_memory_store_same_key    "adr0094-p10"
  run_check_bg "p10-sess-same-name"    "P10 session_save same name idempotent" check_adr0094_p10_session_save_same_name   "adr0094-p10"
  run_check_bg "p10-cfg-same-key"      "P10 config_set same key idempotent"    check_adr0094_p10_config_set_same_key      "adr0094-p10"
  run_check_bg "p10-init-reinvoke"     "P10 init --full reinvoke idempotent"   check_adr0094_p10_init_full_reinvoke       "adr0094-p10"
fi

# ADR-0094 Phase 11: Input fuzzing (16 checks = 8 classes × 2 reps, ≤30s wall-clock).
# Each uses _with_iso_cleanup for per-check isolation. Verifies malformed inputs
# produce a loud rejection (ADR-0082) — not error-message quality (that is P12).
if [[ -f "$E2E_DIR/.claude/settings.json" && -f "$phase11_lib" ]]; then
  run_check_bg "p11-fuzz-memory-type"      "P11 memory_store type-mismatch"       check_adr0094_p11_fuzz_memory_type_mismatch    "adr0094-p11"
  run_check_bg "p11-fuzz-memory-bdy"       "P11 memory_store boundary"            check_adr0094_p11_fuzz_memory_boundary         "adr0094-p11"
  run_check_bg "p11-fuzz-session-type"     "P11 session_save type-mismatch"       check_adr0094_p11_fuzz_session_type_mismatch   "adr0094-p11"
  run_check_bg "p11-fuzz-session-bdy"      "P11 session_save boundary"            check_adr0094_p11_fuzz_session_boundary        "adr0094-p11"
  run_check_bg "p11-fuzz-agent-type"       "P11 agent_spawn type-mismatch"        check_adr0094_p11_fuzz_agent_type_mismatch     "adr0094-p11"
  run_check_bg "p11-fuzz-agent-bdy"        "P11 agent_spawn boundary"             check_adr0094_p11_fuzz_agent_boundary          "adr0094-p11"
  run_check_bg "p11-fuzz-claims-type"      "P11 claims_claim type-mismatch"       check_adr0094_p11_fuzz_claims_type_mismatch    "adr0094-p11"
  run_check_bg "p11-fuzz-claims-bdy"       "P11 claims_claim boundary(10KB)"      check_adr0094_p11_fuzz_claims_boundary         "adr0094-p11"
  run_check_bg "p11-fuzz-workflow-type"    "P11 workflow_create type-mismatch"    check_adr0094_p11_fuzz_workflow_type_mismatch  "adr0094-p11"
  run_check_bg "p11-fuzz-workflow-bdy"     "P11 workflow_create boundary"         check_adr0094_p11_fuzz_workflow_boundary       "adr0094-p11"
  run_check_bg "p11-fuzz-config-type"      "P11 config_set type-mismatch"         check_adr0094_p11_fuzz_config_type_mismatch    "adr0094-p11"
  run_check_bg "p11-fuzz-config-bdy"       "P11 config_set boundary"              check_adr0094_p11_fuzz_config_boundary         "adr0094-p11"
  run_check_bg "p11-fuzz-neural-type"      "P11 neural_train type-mismatch"       check_adr0094_p11_fuzz_neural_type_mismatch    "adr0094-p11"
  run_check_bg "p11-fuzz-neural-bdy"       "P11 neural_train boundary"            check_adr0094_p11_fuzz_neural_boundary         "adr0094-p11"
  run_check_bg "p11-fuzz-autopilot-type"   "P11 autopilot_enable type-mismatch"   check_adr0094_p11_fuzz_autopilot_type_mismatch "adr0094-p11"
  run_check_bg "p11-fuzz-autopilot-bdy"    "P11 autopilot_enable boundary"        check_adr0094_p11_fuzz_autopilot_boundary      "adr0094-p11"
fi

# ADR-0094 Phase 12: Error message quality (14 checks = 7 classes × 2 reps).
# Each uses _with_iso_cleanup for per-check isolation. Stricter than P11:
# errors must name the offending field AND carry a structural hint word.
# autopilot_enable was the 8th class but has no required fields — its
# missing/wrong-type probes are inapplicable and were dropped (matrix 16→14).
if [[ -f "$E2E_DIR/.claude/settings.json" && -f "$phase12_lib" ]]; then
  run_check_bg "p12-qual-memory-missing"    "P12 memory_store missing field"        check_adr0094_p12_quality_memory_missing       "adr0094-p12"
  run_check_bg "p12-qual-memory-wtype"      "P12 memory_store wrong type"           check_adr0094_p12_quality_memory_wrong_type    "adr0094-p12"
  run_check_bg "p12-qual-session-missing"   "P12 session_save missing field"        check_adr0094_p12_quality_session_missing      "adr0094-p12"
  run_check_bg "p12-qual-session-wtype"     "P12 session_save wrong type"           check_adr0094_p12_quality_session_wrong_type   "adr0094-p12"
  run_check_bg "p12-qual-agent-missing"     "P12 agent_spawn missing field"         check_adr0094_p12_quality_agent_missing        "adr0094-p12"
  run_check_bg "p12-qual-agent-wtype"       "P12 agent_spawn wrong type"            check_adr0094_p12_quality_agent_wrong_type     "adr0094-p12"
  run_check_bg "p12-qual-claims-missing"    "P12 claims_claim missing field"        check_adr0094_p12_quality_claims_missing       "adr0094-p12"
  run_check_bg "p12-qual-claims-wtype"      "P12 claims_claim wrong type"           check_adr0094_p12_quality_claims_wrong_type    "adr0094-p12"
  run_check_bg "p12-qual-workflow-missing"  "P12 workflow_create missing field"     check_adr0094_p12_quality_workflow_missing     "adr0094-p12"
  run_check_bg "p12-qual-workflow-wtype"    "P12 workflow_create wrong type"        check_adr0094_p12_quality_workflow_wrong_type  "adr0094-p12"
  run_check_bg "p12-qual-config-missing"    "P12 config_set missing field"          check_adr0094_p12_quality_config_missing       "adr0094-p12"
  run_check_bg "p12-qual-config-wtype"      "P12 config_set wrong type"             check_adr0094_p12_quality_config_wrong_type    "adr0094-p12"
  run_check_bg "p12-qual-neural-missing"    "P12 neural_train missing field"        check_adr0094_p12_quality_neural_missing       "adr0094-p12"
  run_check_bg "p12-qual-neural-wtype"      "P12 neural_train wrong type"           check_adr0094_p12_quality_neural_wrong_type    "adr0094-p12"
  # autopilot_enable rows dropped: tool has no required fields, missing/wtype
  # probes are inapplicable. Matrix: 8 classes × 2 = 16 → 7 classes × 2 = 14.
fi

# ADR-0094 Phase 13: Migration backstop (6 checks — vN fixture → vN+1 read).
# Each uses _with_iso_cleanup + loads a hand-crafted text fixture from
# tests/fixtures/adr0094-phase13/ and asserts the current reader neither
# panics on schema drift nor silently resets. First-pass scope: forward-
# compat + backward-compat on JSON surfaces only (no RVF/SQLite fixtures).
if [[ -f "$E2E_DIR/.claude/settings.json" && -f "$phase13_lib" ]]; then
  run_check_bg "p13-mig-cfg-v1-read"     "P13 migration v1-config read"                   check_adr0094_p13_migration_config_v1_read                   "adr0094-p13"
  run_check_bg "p13-mig-cfg-v1-tele"     "P13 migration v1-config telemetry"              check_adr0094_p13_migration_config_v1_telemetry              "adr0094-p13"
  run_check_bg "p13-mig-store-v1-list"   "P13 migration v1-store session_list"            check_adr0094_p13_migration_store_v1_session_list            "adr0094-p13"
  run_check_bg "p13-mig-fwd-unknown"     "P13 migration forward-compat unknown key"       check_adr0094_p13_migration_forward_compat_unknown_key       "adr0094-p13"
  run_check_bg "p13-mig-bwd-missing"     "P13 migration backward-compat missing optional" check_adr0094_p13_migration_backward_compat_missing_optional "adr0094-p13"
  run_check_bg "p13-mig-no-panic"        "P13 migration no schema panic (4 fixtures)"     check_adr0094_p13_migration_no_schema_panic                  "adr0094-p13"
  # Phase 13.1 — real RVF binary fixtures seeded via scripts/seed-phase13-1-fixtures.sh
  run_check_bg "p13-rvf-retrieve"        "P13.1 migration v1-rvf retrieve"                check_adr0094_p13_migration_rvf_v1_retrieve                  "adr0094-p13"
  run_check_bg "p13-rvf-search"          "P13.1 migration v1-rvf search"                  check_adr0094_p13_migration_rvf_v1_search                    "adr0094-p13"
  # Phase 13.2 — real AgentDB SQLite fixture seeded via scripts/seed-phase13-2-fixtures.sh
  run_check_bg "p13-agentdb-skill"       "P13.2 migration v1-agentdb skill_search"         check_adr0094_p13_migration_agentdb_v1_skill_search          "adr0094-p13"
  run_check_bg "p13-agentdb-reflexion"   "P13.2 migration v1-agentdb reflexion_retrieve"   check_adr0094_p13_migration_agentdb_v1_reflexion_retrieve    "adr0094-p13"
fi

# ADR-0094 Phase 14 SLO probes intentionally NOT spawned in this parallel wave.
# Running 8 latency probes alongside ~570 other run_check_bg spawns produces
# 30x measurement skew (memory_store 4.5s cold baseline → 28s observed under
# self-contention; workflow_list 0.33s → 11s). SLO budgets are correct — only
# the scheduling was wrong. Phase 14 now runs sequentially AFTER the parallel
# wave joins, just before Phase 4's sequential daemon block, so each probe
# measures single-process latency against the hot E2E_DIR. See diagnosis in
# tmp/phase-fixes/p14-diagnosis.md and ADR-0094 Phase 14 log.

# ADR-0094 Phase 15: Flakiness characterization. Each check invokes one MCP
# tool three times serially with identical input and asserts all three
# responses map to the same coarse shape class. FAIL on divergence (truly
# flaky), FAIL on all-empty (ADR-0082 canary), FAIL on all-error,
# SKIP_ACCEPTED on tool-not-found, PASS on deterministic success OR
# deterministic failure.
if [[ -f "$E2E_DIR/.claude/settings.json" && -f "$phase15_lib" ]]; then
  run_check_bg "p15-flaky-memory-search"   "P15 memory_search determinism (3x)"   check_adr0094_p15_flaky_memory_search   "adr0094-p15"
  run_check_bg "p15-flaky-agent-list"      "P15 agent_list determinism (3x)"      check_adr0094_p15_flaky_agent_list      "adr0094-p15"
  run_check_bg "p15-flaky-config-get"      "P15 config_get determinism (3x)"      check_adr0094_p15_flaky_config_get      "adr0094-p15"
  run_check_bg "p15-flaky-claims-board"    "P15 claims_board determinism (3x)"    check_adr0094_p15_flaky_claims_board    "adr0094-p15"
  run_check_bg "p15-flaky-workflow-list"   "P15 workflow_list determinism (3x)"   check_adr0094_p15_flaky_workflow_list   "adr0094-p15"
  run_check_bg "p15-flaky-session-list"    "P15 session_list determinism (3x)"    check_adr0094_p15_flaky_session_list    "adr0094-p15"
fi

# ADR-0094 Phase 16: PII detection inverse. 7 inverse checks assert the
# aidefence PII detector does NOT false-positive on benign inputs (plain
# prose, code, versions, UUIDs, URLs, markdown, scan-clean). Check 8 is a
# POSITIVE control — an obvious email input MUST produce "hasPII":true —
# which catches a detector regressed to a stub-returning-false (ADR-0082
# silent-pass trap; without the guard every inverse check passes trivially).
if [[ -f "$E2E_DIR/.claude/settings.json" && -f "$phase16_lib" ]]; then
  run_check_bg "p16-nopii-plain-prose"    "P16 plain-prose no-PII"         check_adr0094_p16_nopii_plain_prose    "adr0094-p16"
  run_check_bg "p16-nopii-code-snippet"   "P16 code-snippet no-PII"        check_adr0094_p16_nopii_code_snippet   "adr0094-p16"
  run_check_bg "p16-nopii-version-string" "P16 version-string no-PII"      check_adr0094_p16_nopii_version_string "adr0094-p16"
  run_check_bg "p16-nopii-uuid"           "P16 uuid no-PII"                check_adr0094_p16_nopii_uuid           "adr0094-p16"
  run_check_bg "p16-nopii-url"            "P16 url no-PII"                 check_adr0094_p16_nopii_url            "adr0094-p16"
  run_check_bg "p16-nopii-markdown"       "P16 markdown no-PII"            check_adr0094_p16_nopii_markdown       "adr0094-p16"
  run_check_bg "p16-nopii-scan-clean"     "P16 scan benign clean"          check_adr0094_p16_nopii_scan_clean     "adr0094-p16"
  run_check_bg "p16-guard-detects-email"  "P16 guard: email IS PII"        check_adr0094_p16_guard_detects_email  "adr0094-p16"
fi

# ADR-0094 Phase 17: Validator property fuzzing. Meta-tests the bash
# validators the earlier phases rely on (`_p11_expect_fuzz_rejection`,
# `_p12_expect_named_error`, `_p15_classify`, `_p15_expect_deterministic`,
# `_p16_assert_*`). Each check seeds _MCP_BODY/_MCP_EXIT/_CHECK_PASSED
# directly (no CLI, no MCP) and asserts the validator's post-state matches
# expectations. Covers 8 ADR-0082 silent-pass trap axes across 15 checks.
# Gate on settings.json for consistency — Phase 17 doesn't need init'd
# project state, but if acceptance is disabled Phase 17 shouldn't run.
if [[ -f "$E2E_DIR/.claude/settings.json" && -f "$phase17_lib" ]]; then
  run_check_bg "p17-p11-nonzero-exit"      "P17 p11 nonzero-exit → PASS"            check_adr0094_p17_p11_nonzero_exit_passes        "adr0094-p17"
  run_check_bg "p17-p11-success-false"     "P17 p11 success:false → PASS"           check_adr0094_p17_p11_success_false_passes       "adr0094-p17"
  run_check_bg "p17-p11-error-word"        "P17 p11 error-word → PASS"              check_adr0094_p17_p11_error_word_passes          "adr0094-p17"
  run_check_bg "p17-p11-silent-success"    "P17 p11 silent-success → FAIL"          check_adr0094_p17_p11_silent_success_fails       "adr0094-p17"
  run_check_bg "p17-p11-empty-body"        "P17 p11 empty-body → FAIL"              check_adr0094_p17_p11_empty_body_fails           "adr0094-p17"
  run_check_bg "p17-p11-skip-propagates"   "P17 p11 skip_accepted preserved"        check_adr0094_p17_p11_skip_propagates            "adr0094-p17"
  run_check_bg "p17-p11-ambig-error-wins"  "P17 p11 ambiguity: error wins"          check_adr0094_p17_p11_ambiguity_error_wins       "adr0094-p17"
  run_check_bg "p17-p12-named-with-hint"   "P17 p12 named+hint → PASS"              check_adr0094_p17_p12_named_with_hint_passes     "adr0094-p17"
  run_check_bg "p17-p12-no-token"          "P17 p12 rejected, field unnamed → FAIL" check_adr0094_p17_p12_rejected_without_token_fails "adr0094-p17"
  run_check_bg "p17-p12-no-hint"           "P17 p12 named, no hint → FAIL"          check_adr0094_p17_p12_named_but_no_hint_fails    "adr0094-p17"
  run_check_bg "p17-p12-skip-propagates"   "P17 p12 skip_accepted preserved"        check_adr0094_p17_p12_skip_propagates            "adr0094-p17"
  run_check_bg "p17-p15-classify-shapes"   "P17 p15 classifier (4 shapes)"          check_adr0094_p17_p15_classify_four_shapes       "adr0094-p17"
  run_check_bg "p17-p15-flaky-detected"    "P17 p15 flaky/canaries"                 check_adr0094_p17_p15_flaky_detected             "adr0094-p17"
  run_check_bg "p17-p16-ambig-body"        "P17 p16 ambiguous body force-FAIL"      check_adr0094_p17_p16_no_pii_ambiguous_body_fails "adr0094-p17"
  run_check_bg "p17-p16-guard-regress"     "P17 p16 guard regression FAIL + diag"   check_adr0094_p17_p16_guard_regression_fails     "adr0094-p17"
fi

# ════════════════════════════════════════════════════════════════════
# e2e check function definitions — launched in same wave as non-e2e.
# Each e2e subshell waits for _E2E_READY_FILE before running its check,
# so they block until background memory init + seed completes (~15-30s)
# while non-e2e grep checks execute immediately. All checks run in parallel.
# ════════════════════════════════════════════════════════════════════

# Wrapper: e2e checks wait for prep, then run the actual check
# Bug fix: elapsed was counting iterations (0.25s each), not seconds.
# 30 iterations * 0.25s = 7.5s actual wait, but prep can take 20-40s.
# Fix: max_iters = max_wait_secs / poll_interval = 30 / 0.25 = 120.
_wait_e2e_ready() {
  local max_iters=120 i=0
  while [[ ! -f "$_E2E_READY_FILE" ]] && (( i < max_iters )); do
    sleep 0.25
    i=$((i + 1))
  done
}

if [[ -f "$E2E_DIR/.claude/settings.json" ]]; then
  # e2e check functions (run against E2E_DIR, not ACCEPT_TEMP)
  _e2e_memory_store() {
    _wait_e2e_ready
    local cli="$CLI_BIN"
    _CHECK_PASSED="false"
    _run_and_kill "cd '$E2E_DIR' && NPM_CONFIG_REGISTRY='$REGISTRY' $cli memory store --key ctrl-test --value 'controller activation test' --namespace ctrl-test" "" 15
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

  # ── E2E storage pipeline checks (acceptance-e2e-checks.sh) ────────
  _e2e_store_rvf()    { _wait_e2e_ready; check_e2e_store_creates_rvf; }
  _e2e_semantic()     { _wait_e2e_ready; check_e2e_search_semantic_quality; }
  _e2e_list_store()   { _wait_e2e_ready; check_e2e_list_after_store; }
  _e2e_dual_write()   { _wait_e2e_ready; check_e2e_dual_write_consistency; }
  _e2e_dim768()       { _wait_e2e_ready; check_e2e_embeddings_768_dim; }
  _e2e_no_dead()      { _wait_e2e_ready; check_e2e_init_no_dead_files; }
  _e2e_cfg_rt()       { _wait_e2e_ready; check_e2e_config_round_trip; }

  run_check_bg "e2e-store-rvf"      "E2E store creates RVF"          _e2e_store_rvf    "e2e-storage"
  run_check_bg "e2e-semantic"       "E2E semantic search quality"    _e2e_semantic      "e2e-storage"
  run_check_bg "e2e-list-store"     "E2E list after store"           _e2e_list_store    "e2e-storage"
  run_check_bg "e2e-dual-write"     "E2E dual write consistency"     _e2e_dual_write    "e2e-storage"
  run_check_bg "e2e-dim768"         "E2E embeddings 768-dim"         _e2e_dim768        "e2e-storage"
  run_check_bg "e2e-no-dead-files"  "E2E init no dead files"         _e2e_no_dead       "e2e-storage"
  run_check_bg "e2e-cfg-roundtrip"  "E2E config round-trip"          _e2e_cfg_rt        "e2e-storage"

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

  # ADR-0083: Phase 5 e2e checks
  if [[ -f "$adr0083_lib" ]]; then
    _e2e_0083_sidecar()   { _wait_e2e_ready; check_adr0083_json_sidecar_contract; }
    _e2e_0083_roundtrip() { _wait_e2e_ready; check_adr0083_single_path_roundtrip; }
    run_check_bg "e2e-0083-sidecar"   "E2E JSON sidecar (ADR-0083)"    _e2e_0083_sidecar   "adr0083"
    run_check_bg "e2e-0083-roundtrip" "E2E single path (ADR-0083)"     _e2e_0083_roundtrip  "adr0083"
  fi

  # ADR-0084: Dead Code Cleanup — sql.js ghost refs (e2e: runtime output check)
  if [[ -f "$adr0084_lib" ]]; then
    _e2e_0084_backend() { _wait_e2e_ready; check_no_sqljs_in_backend_output; }
    run_check_bg "e2e-0084-no-sqljs" "E2E no sql.js in output (ADR-0084)" _e2e_0084_backend "adr0084"
  fi
fi

# ════════════════════════════════════════════════════════════════════
# Single collect_parallel for ALL checks (non-e2e + e2e unified wave)
# ════════════════════════════════════════════════════════════════════

# Build e2e spec list
_p8_specs=()
if [[ -f "$E2E_DIR/.claude/settings.json" && -f "$phase8_lib" ]]; then
  _p8_specs=(
    "p8-inv1-memory|INV-1 memory store→search (P8)"
    "p8-inv2-session|INV-2 session save→list (P8)"
    "p8-inv3-agent|INV-3 agent spawn→list→terminate (P8)"
    "p8-inv4-claims|INV-4 claim→board→release (P8)"
    "p8-inv5-workflow|INV-5 workflow create→list→delete (P8)"
    "p8-inv6-config|INV-6 config set→get (P8)"
    "p8-inv7-task|INV-7 task create→list→complete (P8)"
    "p8-inv8-sess-mem|INV-8 session save/restore preserves memory (P8)"
    "p8-inv9-neural|INV-9 neural_patterns(store) raises patterns.total (P8)"
    "p8-inv10-autopilot|INV-10 autopilot enable→status→predict (P8)"
    "p8-inv11-delta|INV-11 delta-sentinel meta-probe (P8)"
    "p8-inv12-mem-full|INV-12 memory full round-trip (P8)"
  )
fi

_p9_specs=()
if [[ -f "$E2E_DIR/.claude/settings.json" && -f "$phase9_lib" ]]; then
  _p9_specs=(
    "p9-rvf-delegated|P9 RVF concurrency delegated to t3-2"
    "p9-claims-winner|P9 claims exactly-one-winner (6 racers)"
    "p9-session-noint|P9 session no interleave (2 writers)"
    "p9-workflow-one|P9 workflow exactly-one-created (4 racers)"
  )
fi

_p10_specs=()
if [[ -f "$E2E_DIR/.claude/settings.json" && -f "$phase10_lib" ]]; then
  _p10_specs=(
    "p10-mem-same-key|P10 memory_store same key idempotent"
    "p10-sess-same-name|P10 session_save same name idempotent"
    "p10-cfg-same-key|P10 config_set same key idempotent"
    "p10-init-reinvoke|P10 init --full reinvoke idempotent"
  )
fi

_p11_specs=()
if [[ -f "$E2E_DIR/.claude/settings.json" && -f "$phase11_lib" ]]; then
  _p11_specs=(
    "p11-fuzz-memory-type|P11 memory_store type-mismatch"
    "p11-fuzz-memory-bdy|P11 memory_store boundary"
    "p11-fuzz-session-type|P11 session_save type-mismatch"
    "p11-fuzz-session-bdy|P11 session_save boundary"
    "p11-fuzz-agent-type|P11 agent_spawn type-mismatch"
    "p11-fuzz-agent-bdy|P11 agent_spawn boundary"
    "p11-fuzz-claims-type|P11 claims_claim type-mismatch"
    "p11-fuzz-claims-bdy|P11 claims_claim boundary(10KB)"
    "p11-fuzz-workflow-type|P11 workflow_create type-mismatch"
    "p11-fuzz-workflow-bdy|P11 workflow_create boundary"
    "p11-fuzz-config-type|P11 config_set type-mismatch"
    "p11-fuzz-config-bdy|P11 config_set boundary"
    "p11-fuzz-neural-type|P11 neural_train type-mismatch"
    "p11-fuzz-neural-bdy|P11 neural_train boundary"
    "p11-fuzz-autopilot-type|P11 autopilot_enable type-mismatch"
    "p11-fuzz-autopilot-bdy|P11 autopilot_enable boundary"
  )
fi

_p12_specs=()
if [[ -f "$E2E_DIR/.claude/settings.json" && -f "$phase12_lib" ]]; then
  _p12_specs=(
    "p12-qual-memory-missing|P12 memory_store missing field"
    "p12-qual-memory-wtype|P12 memory_store wrong type"
    "p12-qual-session-missing|P12 session_save missing field"
    "p12-qual-session-wtype|P12 session_save wrong type"
    "p12-qual-agent-missing|P12 agent_spawn missing field"
    "p12-qual-agent-wtype|P12 agent_spawn wrong type"
    "p12-qual-claims-missing|P12 claims_claim missing field"
    "p12-qual-claims-wtype|P12 claims_claim wrong type"
    "p12-qual-workflow-missing|P12 workflow_create missing field"
    "p12-qual-workflow-wtype|P12 workflow_create wrong type"
    "p12-qual-config-missing|P12 config_set missing field"
    "p12-qual-config-wtype|P12 config_set wrong type"
    "p12-qual-neural-missing|P12 neural_train missing field"
    "p12-qual-neural-wtype|P12 neural_train wrong type"
    # autopilot rows dropped — see run_check_bg block above for rationale.
  )
fi

_p13_specs=()
if [[ -f "$E2E_DIR/.claude/settings.json" && -f "$phase13_lib" ]]; then
  _p13_specs=(
    "p13-mig-cfg-v1-read|P13 migration v1-config read"
    "p13-mig-cfg-v1-tele|P13 migration v1-config telemetry"
    "p13-mig-store-v1-list|P13 migration v1-store session_list"
    "p13-mig-fwd-unknown|P13 migration forward-compat unknown key"
    "p13-mig-bwd-missing|P13 migration backward-compat missing optional"
    "p13-mig-no-panic|P13 migration no schema panic (4 fixtures)"
    "p13-rvf-retrieve|P13.1 migration v1-rvf retrieve"
    "p13-rvf-search|P13.1 migration v1-rvf search"
    "p13-agentdb-skill|P13.2 migration v1-agentdb skill_search"
    "p13-agentdb-reflexion|P13.2 migration v1-agentdb reflexion_retrieve"
  )
fi

# _p14_specs intentionally omitted — Phase 14 SLO probes run sequentially
# after the parallel wave joins (see comment at the run_check_bg skip block
# above). Keeping them out of collect_parallel "all" avoids harness
# self-contention skewing latency measurements.

_p15_specs=()
if [[ -f "$E2E_DIR/.claude/settings.json" && -f "$phase15_lib" ]]; then
  _p15_specs=(
    "p15-flaky-memory-search|P15 memory_search determinism (3x)"
    "p15-flaky-agent-list|P15 agent_list determinism (3x)"
    "p15-flaky-config-get|P15 config_get determinism (3x)"
    "p15-flaky-claims-board|P15 claims_board determinism (3x)"
    "p15-flaky-workflow-list|P15 workflow_list determinism (3x)"
    "p15-flaky-session-list|P15 session_list determinism (3x)"
  )
fi

_p16_specs=()
if [[ -f "$E2E_DIR/.claude/settings.json" && -f "$phase16_lib" ]]; then
  _p16_specs=(
    "p16-nopii-plain-prose|P16 plain-prose no-PII"
    "p16-nopii-code-snippet|P16 code-snippet no-PII"
    "p16-nopii-version-string|P16 version-string no-PII"
    "p16-nopii-uuid|P16 uuid no-PII"
    "p16-nopii-url|P16 url no-PII"
    "p16-nopii-markdown|P16 markdown no-PII"
    "p16-nopii-scan-clean|P16 scan benign clean"
    "p16-guard-detects-email|P16 guard: email IS PII"
  )
fi

_p17_specs=()
if [[ -f "$E2E_DIR/.claude/settings.json" && -f "$phase17_lib" ]]; then
  _p17_specs=(
    "p17-p11-nonzero-exit|P17 p11 nonzero-exit → PASS"
    "p17-p11-success-false|P17 p11 success:false → PASS"
    "p17-p11-error-word|P17 p11 error-word → PASS"
    "p17-p11-silent-success|P17 p11 silent-success → FAIL"
    "p17-p11-empty-body|P17 p11 empty-body → FAIL"
    "p17-p11-skip-propagates|P17 p11 skip_accepted preserved"
    "p17-p11-ambig-error-wins|P17 p11 ambiguity: error wins"
    "p17-p12-named-with-hint|P17 p12 named+hint → PASS"
    "p17-p12-no-token|P17 p12 rejected, field unnamed → FAIL"
    "p17-p12-no-hint|P17 p12 named, no hint → FAIL"
    "p17-p12-skip-propagates|P17 p12 skip_accepted preserved"
    "p17-p15-classify-shapes|P17 p15 classifier (4 shapes)"
    "p17-p15-flaky-detected|P17 p15 flaky/canaries"
    "p17-p16-ambig-body|P17 p16 ambiguous body force-FAIL"
    "p17-p16-guard-regress|P17 p16 guard regression FAIL + diag"
  )
fi

_e2e_specs=()
if [[ -f "$E2E_DIR/.claude/settings.json" ]]; then
  _e2e_specs=(
    "e2e-memory-store|E2E memory store" "e2e-hooks-route|E2E hooks route"
    "e2e-causal-edge|E2E causal edge" "e2e-reflexion-store|E2E reflexion store"
    "e2e-batch-optimize|E2E batch optimize" "e2e-filtered-search|E2E filtered search"
    "e2e-store-rvf|E2E store creates RVF" "e2e-semantic|E2E semantic search quality"
    "e2e-list-store|E2E list after store" "e2e-dual-write|E2E dual write consistency"
    "e2e-dim768|E2E embeddings 768-dim" "e2e-no-dead-files|E2E init no dead files"
    "e2e-cfg-roundtrip|E2E config round-trip"
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
  # ADR-0083 e2e specs
  if [[ -f "$adr0083_lib" ]]; then
    _e2e_specs+=(
      "e2e-0083-sidecar|E2E JSON sidecar (ADR-0083)"
      "e2e-0083-roundtrip|E2E single path (ADR-0083)"
    )
  fi
  # ADR-0084 e2e specs
  if [[ -f "$adr0084_lib" ]]; then
    _e2e_specs+=(
      "e2e-0084-no-sqljs|E2E no sql.js in output (ADR-0084)"
    )
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
  "adr0071-no-ruvector|No @ruvector/ import refs (ADR-0071)" \
  "adr0071-node-binary|.node binary bundled (ADR-0071)" \
  "adr0074-scope|Scope fix (ADR-0074)" \
  "adr0074-drain|Drain wired (ADR-0074)" \
  "adr0074-evict-cap|Eviction cap (ADR-0074)" \
  "adr0074-consolidate|Consolidate evicts (ADR-0074)" \
  "adr0073-wal|WAL methods (ADR-0073)" \
  "adr0073-native|Native package (ADR-0073)" \
  "adr0073-metric|Metric remap (ADR-0073)" \
  "adr0073-rvf-dep|rvf-node in dep tree (ADR-0073)" \
  "adr0073-native-rt|Native store+query (ADR-0073)" \
  "adr0073-wal-rt|WAL round-trip (ADR-0073)" \
  "t1-1-semantic|Semantic ranking (ADR-0079)" \
  "t1-2-learning|Learning feedback (ADR-0079)" \
  "t1-3-config-prop|Config propagation (ADR-0079)" \
  "t1-4-sqlite|SQLite verify (ADR-0079)" \
  "t1-5-mcp-stdio|MCP stdio (ADR-0079)" \
  "t1-6-empty-search|Empty search (ADR-0079)" \
  "t1-7-invalid-input|Invalid input (ADR-0079)" \
  "t1-8-codemod|Codemod scan (ADR-0079)" \
  "t1-9-version-pins|Version pins (ADR-0079)" \
  "t2-1-swarm|Swarm init (ADR-0079)" \
  "t2-2-session|Session lifecycle (ADR-0079)" \
  "t2-4-embed-dim|Embedding dimension (ADR-0079)" \
  "t2-5-embed-stored|Embedding stored (ADR-0079)" \
  "t2-6-claudemd|CLAUDE.md structure (ADR-0079)" \
  "t3-1-bulk-corpus|Bulk corpus ranking (ADR-0079)" \
  "t3-2-concurrent|Concurrent writes (ADR-0079)" \
  "t3-3-plugin|Plugin load/execute (ADR-0079)" \
  "t3-4-reasoningbank|ReasoningBank cycle (ADR-0079)" \
  "t3-5-consolidation|Nightly consolidation (ADR-0079)" \
  "t3-6-esm-import|ESM import (ADR-0079)" \
  "t3-7-publish-compl|Publish completeness (ADR-0079)" \
  "adr0080-no-1m|No 1M maxEntries (ADR-0080)" \
  "adr0080-100k|100K maxElements (ADR-0080)" \
  "adr0080-atomic|Atomic writes (ADR-0080)" \
  "adr0080-cap|Store entry cap (ADR-0080)" \
  "adr0080-factory|Factory convergence (ADR-0080)" \
  "adr0080-provider|Provider transformers.js (ADR-0080)" \
  "adr0080-embjson|Embeddings.json complete (ADR-0080)" \
  "adr0080-wizard|Wizard canonical model (ADR-0080)" \
  "adr0080-bridge|Memory-bridge 100K (ADR-0080)" \
  "adr0080-store-init|Memory store after init (ADR-0080)" \
  "adr0080-rvf|RVF primary storage (ADR-0080)" \
  "adr0080-no-copy|No dead .claude/memory.db (ADR-0080)" \
  "adr0080-rvf-size|RVF has entries (ADR-0080)" \
  "adr0080-no-graph|No .graph file (ADR-0080)" \
  "adr0080-emb-dflt|Embeddings default on (ADR-0080)" \
  "adr0080-sona|sonaMode balanced (ADR-0080)" \
  "adr0080-decay|Decay rate aligned (ADR-0080)" \
  "adr0080-no-sqljs|No raw sql.js imports (ADR-0080)" \
  "adr0083-no-rvf|No rvf-shim (ADR-0083)" \
  "adr0083-no-opendb|No open-database (ADR-0083)" \
  "adr0083-router|Router exports (ADR-0083)" \
  "adr0083-no-bridge|No bridge in migrated (ADR-0083)" \
  "adr0083-no-append|No appendToAutoMemory (ADR-0083)" \
  "adr0083-no-dosync|No doSync drain (ADR-0083)" \
  "adr0084-no-sqljs-desc|No sql.js in tool descs (ADR-0084)" \
  "adr0084-p2-exports|Phase 2 router exports (ADR-0084)" \
  "adr0084-p2-bridge|Phase 2 bridge loader (ADR-0084)" \
  "adr0084-p3-worker|Worker-daemon router-only (ADR-0084)" \
  "adr0084-p3-hooks|Hooks-tools router-only (ADR-0084)" \
  "adr0084-p3-shadows|No shadow replicates (ADR-0084)" \
  "adr0084-p3-fallback|Router no ctrl fallback (ADR-0084)" \
  "adr0084-p4-nobridge|Route methods no loadBridge (ADR-0084)" \
  "adr0084-p4-shutdown|Worker shutdown via router (ADR-0084)" \
  "adr0084-p4-zero-ext|Zero external bridge imports (ADR-0084)" \
  "adr0084-p4-export|Router exports shutdown (ADR-0084)" \
  "adr0085-no-bridge|Bridge absent from dist (ADR-0085)" \
  "adr0085-init-zero|Initializer zero bridge refs (ADR-0085)" \
  "adr0085-router-reg|Router has initCtrlRegistry (ADR-0085)" \
  "adr0086-init-shim|Initializer is thin shim (ADR-0086)" \
  "adr0086-router-api|Router exports API (ADR-0086)" \
  "adr0086-roundtrip|Memory store+search (ADR-0086)" \
  "adr0086-no-imports|No initializer imports in dist (ADR-0086)" \
  "adr0086-no-quant|No quantization exports (ADR-0086)" \
  "adr0086-no-attn|No attention exports (ADR-0086)" \
  "adr0086-adapter|Embedding adapter present (ADR-0086)" \
  "adr0086-bulkdel|bulkDelete+clearNamespace (ADR-0086)" \
  "adr0086-b1-decay|Temporal decay stub (ADR-0086)" \
  "adr0086-b3-health|healthCheck not checkInit (ADR-0086)" \
  "adr0086-t33-track|T3.3 sqlite3 blockers (ADR-0086)" \
  "adr0086-debt15|Debt 15 SQLite neural path (ADR-0086)" \
  "adr0088-no-ipc|No DaemonIPCClient (ADR-0088)" \
  "adr0088-status|daemon status AI Mode (ADR-0088)" \
  "adr0088-init-no|Init no-claude STILL wires daemon (ADR-0088 A2026-04-20)" \
  "adr0088-init-yes|Init with-claude wires daemon (ADR-0088)" \
  "adr0088-daemon-ok|Daemon still works local (ADR-0088)" \
  "adr0089-shipped|Intercept pool shipped (ADR-0089)" \
  "adr0089-svc|AgentDBService wraps (ADR-0089)" \
  "adr0089-reg|ControllerRegistry wraps (ADR-0089)" \
  "adr0089-live|Pool deterministic (ADR-0089)" \
  "adr0081-neural|Neural optional dep (ADR-0081)" \
  "adr0081-learning|Unified learning config (ADR-0081)" \
  "adr0081-balanced|Config template balanced (ADR-0081)" \
  "adr0090-b5-reflexion|B5 reflexion roundtrip" \
  "adr0090-b5-skillLibrary|B5 skillLibrary roundtrip" \
  "adr0090-b5-reasoningBank|B5 reasoningBank roundtrip" \
  "adr0090-b5-causalGraph|B5 causalGraph roundtrip" \
  "adr0090-b5-causalRecall|B5 causalRecall roundtrip" \
  "adr0090-b5-learningSystem|B5 learningSystem roundtrip" \
  "adr0090-b5-hierarchicalMemory|B5 hierarchicalMemory roundtrip" \
  "adr0090-b5-memoryConsolidation|B5 memoryConsolidation roundtrip" \
  "adr0090-b5-attentionService|B5 attentionService roundtrip" \
  "adr0090-b5-gnnService|B5 gnnService roundtrip" \
  "adr0090-b5-semanticRouter|B5 semanticRouter roundtrip" \
  "adr0090-b5-graphAdapter|B5 graphAdapter roundtrip" \
  "adr0090-b5-sonaTrajectory|B5 sonaTrajectory roundtrip" \
  "adr0090-b5-nightlyLearner|B5 nightlyLearner roundtrip" \
  "adr0090-b5-explainableRecall|B5 explainableRecall roundtrip" \
  "p1-ai-scan|AI Defence scan (P1)" "p1-ai-analyze|AI Defence analyze (P1)" \
  "p1-ai-pii|AI Defence has_pii (P1)" "p1-ai-safe|AI Defence is_safe (P1)" \
  "p1-ai-learn|AI Defence learn (P1)" "p1-ai-stats|AI Defence stats (P1)" \
  "p1-cl-lifecycle|Claims lifecycle (P1)" "p1-cl-claim|Claims claim (P1)" \
  "p1-cl-status|Claims status (P1)" "p1-cl-list|Claims list (P1)" \
  "p1-cl-board|Claims board (P1)" "p1-cl-load|Claims load (P1)" \
  "p1-cl-handoff|Claims handoff (P1)" "p1-cl-accept|Claims accept-handoff (P1)" \
  "p1-cl-steal|Claims steal (P1)" "p1-cl-stealable|Claims mark-stealable (P1)" \
  "p1-cl-rebalance|Claims rebalance (P1)" "p1-cl-release|Claims release (P1)" \
  "p2-ag-lifecycle|Agent lifecycle (P2)" "p2-ag-spawn|Agent spawn (P2)" \
  "p2-ag-list|Agent list (P2)" "p2-ag-status|Agent status (P2)" \
  "p2-ag-health|Agent health (P2)" "p2-ag-terminate|Agent terminate (P2)" \
  "p2-ag-update|Agent update (P2)" "p2-ag-pool|Agent pool (P2)" \
  "p2-ap-lifecycle|Autopilot lifecycle (P2)" "p2-ap-enable|Autopilot enable (P2)" \
  "p2-ap-disable|Autopilot disable (P2)" "p2-ap-status|Autopilot status (P2)" \
  "p2-ap-config|Autopilot config (P2)" "p2-ap-predict|Autopilot predict (P2)" \
  "p2-ap-history|Autopilot history (P2)" "p2-ap-learn|Autopilot learn (P2)" \
  "p2-ap-log|Autopilot log (P2)" "p2-ap-reset|Autopilot reset (P2)" \
  "p2-wf-lifecycle|Workflow lifecycle (P2)" "p2-wf-run|Workflow run (P2)" \
  "p2-wf-pause|Workflow pause (P2)" "p2-wf-resume|Workflow resume (P2)" \
  "p2-wf-template|Workflow template (P2)" \
  "p2-gu-capabilities|Guidance capabilities (P2)" "p2-gu-discover|Guidance discover (P2)" \
  "p2-gu-recommend|Guidance recommend (P2)" "p2-gu-workflow|Guidance workflow (P2)" \
  "p2-gu-quickref|Guidance quickref (P2)" \
  "p3-hm-init|Hive-mind init (P3)" "p3-hm-join|Hive-mind join (P3)" \
  "p3-hm-leave|Hive-mind leave (P3)" "p3-hm-status|Hive-mind status (P3)" \
  "p3-hm-spawn|Hive-mind spawn (P3)" "p3-hm-broadcast|Hive-mind broadcast (P3)" \
  "p3-hm-consensus|Hive-mind consensus (P3)" "p3-hm-memory|Hive-mind memory (P3)" \
  "p3-hm-shutdown|Hive-mind shutdown (P3)" "p3-hm-lifecycle|Hive-mind lifecycle (P3)" \
  "p3-co-consensus|Coordination consensus (P3)" "p3-co-loadbal|Coordination load_balance (P3)" \
  "p3-co-node|Coordination node (P3)" "p3-co-orchestrate|Coordination orchestrate (P3)" \
  "p3-co-sync|Coordination sync (P3)" "p3-co-topology|Coordination topology (P3)" \
  "p3-co-metrics|Coordination metrics (P3)" \
  "p3-da-create|DAA agent create (P3)" "p3-da-adapt|DAA agent adapt (P3)" \
  "p3-da-cognitive|DAA cognitive pattern (P3)" "p3-da-knowledge|DAA knowledge share (P3)" \
  "p3-da-learning|DAA learning status (P3)" "p3-da-perf|DAA performance metrics (P3)" \
  "p3-da-wf-create|DAA workflow create (P3)" "p3-da-wf-exec|DAA workflow execute (P3)" \
  "p3-se-lifecycle|Session lifecycle (P3)" "p3-se-save|Session save (P3)" \
  "p3-se-restore|Session restore (P3)" "p3-se-list|Session list (P3)" \
  "p3-se-delete|Session delete (P3)" "p3-se-info|Session info (P3)" \
  "p3-ta-lifecycle|Task lifecycle (P3)" "p3-ta-create|Task create (P3)" \
  "p3-ta-assign|Task assign (P3)" "p3-ta-update|Task update (P3)" \
  "p3-ta-cancel|Task cancel (P3)" "p3-ta-complete|Task complete (P3)" \
  "p3-ta-list|Task list (P3)" "p3-ta-status|Task status (P3)" \
  "p3-ta-summary|Task summary (P3)" \
  "p4-br-session|Browser session (P4)" "p4-br-eval|Browser eval (P4)" \
  "p4-br-navigation|Browser navigation (P4)" "p4-br-interaction|Browser interaction (P4)" \
  "p4-br-snapshot|Browser snapshot (P4)" \
  "p4-te-create|Terminal create (P4)" "p4-te-execute|Terminal execute (P4)" \
  "p4-te-list|Terminal list (P4)" "p4-te-history|Terminal history (P4)" \
  "p4-te-close|Terminal close (P4)" \
  "p4-em-init|Embeddings init (P4)" "p4-em-generate|Embeddings generate (P4)" \
  "p4-em-compare|Embeddings compare (P4)" "p4-em-search|Embeddings search (P4)" \
  "p4-em-hyperbolic|Embeddings hyperbolic (P4)" "p4-em-neural|Embeddings neural (P4)" \
  "p4-em-status|Embeddings status (P4)" \
  "p4-tr-store-srch|Transfer store-search (P4)" "p4-tr-store-info|Transfer store-info (P4)" \
  "p4-tr-store-feat|Transfer store-featured (P4)" "p4-tr-store-trend|Transfer store-trending (P4)" \
  "p4-tr-plug-srch|Transfer plugin-search (P4)" "p4-tr-plug-info|Transfer plugin-info (P4)" \
  "p4-tr-plug-feat|Transfer plugin-featured (P4)" "p4-tr-plug-off|Transfer plugin-official (P4)" \
  "p4-tr-pii|Transfer detect-pii (P4)" \
  "p4-gh-issue|GitHub issue track (P4)" "p4-gh-pr|GitHub PR manage (P4)" \
  "p4-gh-metrics|GitHub metrics (P4)" "p4-gh-repo|GitHub repo analyze (P4)" \
  "p4-gh-workflow|GitHub workflow (P4)" \
  "p4-wa-create|WASM agent create (P4)" "p4-wa-list|WASM agent list (P4)" \
  "p4-wa-prompt|WASM agent prompt (P4)" "p4-wa-tool|WASM agent tool (P4)" \
  "p4-wa-export|WASM agent export (P4)" "p4-wa-files|WASM agent files (P4)" \
  "p4-wa-terminate|WASM agent terminate (P4)" \
  "p4-wa-gal-list|WASM gallery list (P4)" "p4-wa-gal-search|WASM gallery search (P4)" \
  "p4-wa-gal-create|WASM gallery create (P4)" \
  "p5-ne-train|Neural train (P5)" "p5-ne-optimize|Neural optimize (P5)" \
  "p5-ne-compress|Neural compress (P5)" "p5-ne-predict|Neural predict (P5)" \
  "p5-ne-patterns|Neural patterns (P5)" "p5-ne-status|Neural status (P5)" \
  "p5-rv-status|RuVLLM status (P5)" "p5-rv-hnsw-create|RuVLLM HNSW create (P5)" \
  "p5-rv-hnsw-add|RuVLLM HNSW add (P5)" "p5-rv-hnsw-route|RuVLLM HNSW route (P5)" \
  "p5-rv-sona-create|RuVLLM SONA create (P5)" "p5-rv-sona-adapt|RuVLLM SONA adapt (P5)" \
  "p5-rv-lora-create|RuVLLM MicroLoRA create (P5)" "p5-rv-lora-adapt|RuVLLM MicroLoRA adapt (P5)" \
  "p5-rv-gen-config|RuVLLM generate config (P5)" "p5-rv-chat-fmt|RuVLLM chat format (P5)" \
  "p5-pf-benchmark|Performance benchmark (P5)" "p5-pf-bottleneck|Performance bottleneck (P5)" \
  "p5-pf-profile|Performance profile (P5)" "p5-pf-optimize|Performance optimize (P5)" \
  "p5-pf-metrics|Performance metrics (P5)" "p5-pf-report|Performance report (P5)" \
  "p5-pr-check|Progress check (P5)" "p5-pr-summary|Progress summary (P5)" \
  "p5-pr-sync|Progress sync (P5)" "p5-pr-watch|Progress watch (P5)" \
  "p6-hk-pre-task|Hooks pre-task (P6)" "p6-hk-post-task|Hooks post-task (P6)" \
  "p6-hk-pre-edit|Hooks pre-edit (P6)" "p6-hk-post-edit|Hooks post-edit (P6)" \
  "p6-hk-pre-cmd|Hooks pre-command (P6)" "p6-hk-post-cmd|Hooks post-command (P6)" \
  "p6-hk-sess-start|Hooks session-start (P6)" "p6-hk-sess-end|Hooks session-end (P6)" \
  "p6-err-badconfig|Error: invalid config (P6)" "p6-err-noconfig|Error: missing config (P6)" \
  "p6-err-corrupt|Error: corrupted state (P6)" "p6-err-perms|Error: permission denied (P6)" \
  "p6-val-traversal|Input: path traversal (P6)" "p6-val-unicode|Input: unicode (P6)" \
  "p6-val-empty|Input: empty (P6)" "p6-val-oversize|Input: oversized (P6)" \
  "p6-mr-route|Model route (P6)" "p6-mr-outcome|Model outcome (P6)" \
  "p6-mr-stats|Model stats (P6)" \
  "p7-fo-agents|File: agents store.json (P7)" "p7-fo-swarm-ag|File: swarm agents.json (P7)" \
  "p7-fo-swarm-st|File: swarm state.json (P7)" "p7-fo-statusline|File: statusline.cjs (P7)" \
  "p7-fo-neural|File: neural dir (P7)" "p7-fo-hooks|File: hooks dir (P7)" \
  "p7-fo-config|File: config.json (P7)" "p7-fo-settings|File: settings.json (P7)" \
  "p7-cli-version|CLI --version (P7)" "p7-cli-doctor|CLI doctor (P7)" \
  "p7-cli-init|CLI init --help (P7)" "p7-cli-agent|CLI agent --help (P7)" \
  "p7-cli-swarm|CLI swarm --help (P7)" "p7-cli-memory|CLI memory --help (P7)" \
  "p7-cli-session|CLI session --help (P7)" "p7-cli-hooks|CLI hooks --help (P7)" \
  "p7-cli-mcp|CLI mcp status (P7)" "p7-cli-system|CLI system info (P7)" \
  "p7-cli-doctor-npm|W4-A3: doctor npm no-false-fail" \
  "${_p8_specs[@]}" \
  "${_p9_specs[@]}" \
  "${_p10_specs[@]}" \
  "${_p11_specs[@]}" \
  "${_p12_specs[@]}" \
  "${_p13_specs[@]}" \
  "${_p15_specs[@]}" \
  "${_p16_specs[@]}" \
  "${_p17_specs[@]}" \
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
# ADR-0094 Phase 14: SLO probes — sequential, AFTER the parallel wave joins
# ════════════════════════════════════════════════════════════════════
# Diagnosis /tmp/phase-fixes/p14-diagnosis.md confirmed that spawning these
# 8 latency probes in the same `collect_parallel "all"` wave as ~570 other
# run_check_bg checks caused 30x measurement skew (memory_store 4.5s cold
# baseline → 28s observed; workflow_list 0.33s → 11s). The SLO budgets are
# correct — only the scheduling was wrong. Running them here, sequentially,
# after all other background jobs have joined, lets each probe see
# single-process latency against the still-hot E2E_DIR. Total added
# wall-clock < 30s serialized (8 probes × ~1-4s warm).
if [[ -d "${E2E_DIR:-}" && -f "$E2E_DIR/.claude/settings.json" && -f "$phase14_lib" ]]; then
  _p14_start=$(_ns)
  log "── ADR-0094 Phase 14: SLO probes (sequential, post-parallel) ──"
  run_check "p14-slo-memory-store"   "P14 memory_store SLO (10s)"      check_adr0094_p14_slo_memory_store      "adr0094-p14"
  run_check "p14-slo-session-save"   "P14 session_save SLO (10s)"      check_adr0094_p14_slo_session_save      "adr0094-p14"
  run_check "p14-slo-agent-list"     "P14 agent_list SLO (15s)"        check_adr0094_p14_slo_agent_list        "adr0094-p14"
  run_check "p14-slo-claims-board"   "P14 claims_board SLO (10s)"      check_adr0094_p14_slo_claims_board      "adr0094-p14"
  run_check "p14-slo-workflow-list"  "P14 workflow_list SLO (10s)"     check_adr0094_p14_slo_workflow_list     "adr0094-p14"
  run_check "p14-slo-config-get"     "P14 config_get SLO (10s)"        check_adr0094_p14_slo_config_get        "adr0094-p14"
  run_check "p14-slo-neural-status"  "P14 neural_status SLO (15s)"     check_adr0094_p14_slo_neural_status     "adr0094-p14"
  run_check "p14-slo-autopilot-stat" "P14 autopilot_status SLO (10s)"  check_adr0094_p14_slo_autopilot_status  "adr0094-p14"
  _record_phase "phase14-slo" "$(_elapsed_ms "$_p14_start" "$(_ns)")"
fi

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

  # ADR-0088 supersedes ADR-0059 Phase 4: memory.* IPC handlers removed.
  # The daemon socket and probe still work (server stays up for future
  # non-memory RPC methods), but memory.store/search/count handlers are
  # gone per ADR-0088 §Decision item 2. Only socket/probe/fallback
  # checks remain meaningful.
  run_check "e2e-0059-p4-socket-exists" "Daemon IPC socket exists" \
    check_adr0059_daemon_ipc_socket_exists "adr0059-p4"
  run_check "e2e-0059-p4-ipc-probe" "Daemon IPC probe" \
    check_adr0059_daemon_ipc_probe "adr0059-p4"

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
  if [[ ! -d "$ACCEPT_TEMP" ]]; then
    log_error "Phase 5: ACCEPT_TEMP torn down (global timeout fired?) — aborting"
    exit 1
  fi
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
# ADR-0096: Coverage catalog + skip hygiene (parallel group, <=10s budget)
# Runs the catalog-rebuild + skip-reverify pipeline against a sandboxed
# RUFLO_CATALOG_RESULTS_DIR so no real test-results state is mutated.
# Checks bucket as skip_accepted when sibling scripts aren't yet present.
# ════════════════════════════════════════════════════════════════════
_adr0096_start=$(_ns)
log "── ADR-0096: coverage catalog + skip hygiene ──"
PARALLEL_DIR=$(mktemp -d /tmp/ruflo-accept-par-XXXXX)

run_check_bg "adr0096-populated"   "ADR-0096 catalog populated"        check_adr0096_catalog_populated        "adr0096"
run_check_bg "adr0096-verify"      "ADR-0096 catalog --verify"         check_adr0096_catalog_verify           "adr0096"
run_check_bg "adr0096-fingerprint" "ADR-0096 fingerprint determinism"  check_adr0096_fingerprint_determinism  "adr0096"
run_check_bg "adr0096-skip-streak" "ADR-0096 skip_streak tracking"     check_adr0096_skip_streak_tracking     "adr0096"
run_check_bg "adr0096-reconcile"   "ADR-0096 JSONL↔SQLite reconcile"   check_adr0096_jsonl_sqlite_reconcile   "adr0096"
run_check_bg "adr0096-dry-run"     "ADR-0096 skip-reverify --dry-run"  check_adr0096_skip_reverify_dry_run    "adr0096"
run_check_bg "adr0096-skip-rot"    "ADR-0096 skip-rot gate"            check_adr0096_skip_rot_gate            "adr0096"

collect_parallel "adr0096" \
  "adr0096-populated|ADR-0096 catalog populated" \
  "adr0096-verify|ADR-0096 catalog --verify" \
  "adr0096-fingerprint|ADR-0096 fingerprint determinism" \
  "adr0096-skip-streak|ADR-0096 skip_streak tracking" \
  "adr0096-reconcile|ADR-0096 JSONL↔SQLite reconcile" \
  "adr0096-dry-run|ADR-0096 skip-reverify --dry-run" \
  "adr0096-skip-rot|ADR-0096 skip-rot gate"

rm -rf "$PARALLEL_DIR" 2>/dev/null
_record_phase "phase-adr0096-catalog" "$(_elapsed_ms "$_adr0096_start" "$(_ns)")"

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
    "failed": $fail_count,
    "skip_accepted": ${skip_count:-0}
  }
}
JSONEOF

log ""
log "════════════════════════════════════════════"
# ADR-0090 Tier A2: show skip_accepted count as a separate bucket.
# skip_accepted is NOT pass — it is a warning that a prerequisite was
# legitimately absent (e.g. native binary not in build).
if [[ "${skip_count:-0}" -gt 0 ]]; then
  log "Acceptance Results: ${pass_count}/${total_count} passed, ${fail_count} failed, ${skip_count} skip_accepted"
else
  log "Acceptance Results: ${pass_count}/${total_count} passed, ${fail_count} failed"
fi
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

# ADR-0094 close-criterion tracker: append this run to the streak log and
# print current status. Mechanical only — does NOT affect cascade exit code.
# Uses node built-ins only. Idempotent per runId (re-run safe).
STREAK_FILE="${PROJECT_DIR}/test-results/cascade-streak.jsonl"
STREAK_RUN_ID="$(basename "${results_dir}")"
if [[ -x "$(command -v node)" ]] && [[ -f "${results_dir}/acceptance-results.json" ]]; then
  node -e '
    const fs = require("fs");
    const path = require("path");
    const [resultsPath, streakFile, runId] = process.argv.slice(1);
    const r = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
    const s = r.summary || {};
    const pass = Number(s.passed ?? 0);
    const fail = Number(s.failed ?? 0);
    const skipAccepted = Number(s.skip_accepted ?? 0);
    const iso = r.timestamp || new Date().toISOString();
    const date = iso.slice(0, 10);
    const entry = {
      date,
      iso,
      runId,
      pass,
      fail,
      skip_accepted: skipAccepted,
      verified_coverage: null,
      invoked_coverage: null,
      green: fail === 0 && pass > 0,
    };
    // Idempotent append: skip if runId already logged.
    let existing = "";
    try { existing = fs.readFileSync(streakFile, "utf8"); } catch (_) {}
    if (existing.split("\n").some(l => l.includes(`"runId":"${runId}"`))) {
      return;
    }
    fs.mkdirSync(path.dirname(streakFile), { recursive: true });
    fs.appendFileSync(streakFile, JSON.stringify(entry) + "\n");
  ' "${results_dir}/acceptance-results.json" "$STREAK_FILE" "$STREAK_RUN_ID" \
    2>/dev/null || log "[ADR-0094] streak append skipped (node error)"
  if [[ -f "${PROJECT_DIR}/scripts/adr0094-streak-check.mjs" ]]; then
    log ""
    # Pipe through log so the streak block lands in the cascade transcript.
    node "${PROJECT_DIR}/scripts/adr0094-streak-check.mjs" 2>&1 | while IFS= read -r streak_line; do
      log "$streak_line"
    done || true
  fi
fi

# ADR-0072: Baseline regression guard
BASELINE_COUNT=155
if [[ "$pass_count" -lt "$BASELINE_COUNT" ]]; then
  log "[WARN] Regression: $pass_count passed < baseline $BASELINE_COUNT"
fi

# ADR-0096 Sprint 2: re-probe every skip_accepted row after catalog append.
# Folded into the cascade (no separate cron per ADR-0088). Emits SKIP_ROT
# lines when a previously-honest skip flips to pass (prereq arrived =
# stale skip = coverage regression per ADR-0082). Runs silently on a clean
# suite. Does NOT alter the acceptance exit code — harness already exits
# on fail_count below.
if [[ -x "$(command -v node)" ]] && [[ -f "${PROJECT_DIR}/scripts/skip-reverify.mjs" ]]; then
  node "${PROJECT_DIR}/scripts/skip-reverify.mjs" --run --fail-on-flip || \
    log "[SKIP_ROT] skip-reverify flagged stale skips; see output above"
fi

printf '{"phase":"TOTAL","duration_ms":%d}\n' "$ACCEPT_TOTAL_MS" >> "$TIMING_FILE"

exit "$fail_count"
