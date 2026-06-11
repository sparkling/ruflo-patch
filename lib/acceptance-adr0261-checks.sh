#!/usr/bin/env bash
# lib/acceptance-adr0261-checks.sh — ADR-0261 fork-native graph-edges (ADR-130 re-impl) acceptance checks
#
# Each check shells out to the corresponding smoke / benchmark .mjs in scripts/
# and reports pass/fail based on the script's exit code + captured output.
#
# Requires: PROJECT_DIR, _ns, _elapsed_ms from acceptance-harness.sh
#
# The smokes can run in two modes:
#   1) Standalone (each smoke does its own mkdtemp + npm install + cli init).
#      This is the path for `node scripts/smoke-X.mjs` invocations.
#   2) Shared-temp (env var ADR0261_SMOKE_SHARED_TEMP points at a pre-built
#      install + init). Saves ~30-45s per smoke (~6 × ~46s = ~280s CPU per
#      release). Activated by calling `_adr0261_setup_shared_temp` before the
#      `run_check_bg` calls; teardown via `_adr0261_cleanup_shared_temp`.

# ── Shared-temp setup (perf optimisation, ADR-0261 acceleration) ──────────
# Creates ONE temp dir, runs ONE `npm install @sparkleideas/cli` + ONE
# `cli init --full --force` + ONE `cli memory init --force`, exports
# ADR0261_SMOKE_SHARED_TEMP for the smokes to reuse. Per `feedback-no-fallbacks`,
# any failure here is fatal and returns non-zero; the caller must NOT proceed
# to the smokes without the shared install.
_adr0261_setup_shared_temp() {
  local td registry log
  registry="${REGISTRY:-http://localhost:4873}"
  td=$(mktemp -d /tmp/adr0261-shared-XXXXX) || return 1
  log="${td}/_setup.log"

  echo '{"name":"adr0261-shared","version":"1.0.0","private":true}' > "${td}/package.json"
  echo "registry=${registry}" > "${td}/.npmrc"

  if ! (cd "$td" && npm install @sparkleideas/cli \
      --registry "$registry" --no-audit --no-fund --prefer-offline \
      > "$log" 2>&1); then
    echo "[adr0261-shared-setup] FATAL: npm install failed (see $log)" >&2
    return 1
  fi

  local cli="${td}/node_modules/.bin/claude-flow"
  if [[ ! -x "$cli" ]]; then
    # Fall back to other name variants the cli might publish under.
    for name in ruflo cli; do
      [[ -x "${td}/node_modules/.bin/${name}" ]] && cli="${td}/node_modules/.bin/${name}" && break
    done
  fi
  if [[ ! -x "$cli" ]]; then
    echo "[adr0261-shared-setup] FATAL: cli binary not found after install" >&2
    return 1
  fi

  if ! (cd "$td" && NPM_CONFIG_REGISTRY="$registry" \
      "$cli" init --full --force >> "$log" 2>&1); then
    echo "[adr0261-shared-setup] FATAL: cli init --full --force failed (see $log)" >&2
    return 1
  fi

  if ! (cd "$td" && NPM_CONFIG_REGISTRY="$registry" \
      "$cli" memory init --force >> "$log" 2>&1); then
    echo "[adr0261-shared-setup] FATAL: cli memory init --force failed (see $log)" >&2
    return 1
  fi

  export ADR0261_SMOKE_SHARED_TEMP="$td"
  echo "[adr0261-shared-setup] shared temp ready: $td" >&2
  return 0
}

_adr0261_cleanup_shared_temp() {
  if [[ -n "${ADR0261_SMOKE_SHARED_TEMP:-}" && -d "${ADR0261_SMOKE_SHARED_TEMP}" ]]; then
    rm -rf "${ADR0261_SMOKE_SHARED_TEMP}" 2>/dev/null || true
  fi
  unset ADR0261_SMOKE_SHARED_TEMP
}

# Defensive fallbacks — when invoked via the fast-runner's `_fast_run` shim
# the surrounding context doesn't always re-source `acceptance-harness.sh`,
# so `_ns` / `_elapsed_ms` may be absent. Define local fallbacks that match
# the harness's behavior (nanosecond timestamp; ms delta).
if ! declare -f _ns >/dev/null 2>&1; then
  _ns() { date +%s%N 2>/dev/null || echo $(( $(date +%s) * 1000000000 )); }
fi
if ! declare -f _elapsed_ms >/dev/null 2>&1; then
  _elapsed_ms() { echo $(( ( ${2:-0} - ${1:-0} ) / 1000000 )); }
fi

_check_adr0261_smoke() {
  local script_name="$1"
  local start_ns end_ns log_path
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  log_path=$(mktemp -t "adr0261-${script_name}-XXXXXX.log")

  if [[ ! -f "${PROJECT_DIR}/scripts/${script_name}" ]]; then
    _CHECK_OUTPUT="missing: scripts/${script_name}"
    end_ns=$(_ns); _EXIT=2; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  # Full tee per feedback-no-tail-tests + feedback-full-test-output — never
  # pipe through tail/head; the log lives on disk for post-hoc inspection.
  # ADR-0321: retry once on failure — the P6 benchmark is perf-sensitive and the
  # uncapped acceptance wave self-loads, so a transient target-miss can fail; a
  # genuine perf regression / broken smoke fails BOTH attempts (non-weakening).
  local rc _adr0261_attempt
  for _adr0261_attempt in 1 2; do
    node "${PROJECT_DIR}/scripts/${script_name}" > "${log_path}" 2>&1
    rc=$?
    [[ $rc -eq 0 ]] && break
    [[ $_adr0261_attempt -eq 1 ]] && sleep 2
  done

  end_ns=$(_ns)
  _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns")
  _EXIT=$rc
  _OUT="exit=${rc} log=${log_path} (tail -50: $(tail -50 "${log_path}" 2>/dev/null | tr '\n' ' ' | head -c 400))"
  _CHECK_OUTPUT="$_OUT"

  if [[ $rc -eq 0 ]]; then
    _CHECK_PASSED="true"
  fi
}

# P1: graph_edges schema migration (table + 12 columns + 5 indexes after init)
check_adr0261_schema_migration() {
  _check_adr0261_smoke "smoke-graph-schema-migration.mjs"
}

# P2: agentdb_graph-query in 3 modes (k-hop, pagerank, semantic)
check_adr0261_query_dispatch() {
  _check_adr0261_smoke "smoke-graph-query-dispatch.mjs"
}

# P3: trajectory + post-task hooks write trajectory-caused / reinforced-by edges
check_adr0261_trajectory_edges() {
  _check_adr0261_smoke "smoke-trajectory-graph-edges.mjs"
}

# P4: ruflo-knowledge-graph plugin's GraphEdgesSource adapter sees graph_edges
check_adr0261_plugin_adapter() {
  _check_adr0261_smoke "smoke-graph-plugin-adapter.mjs"
}

# P5: agentdb_graph-pathfinder — all 6 algorithms return expected shape
check_adr0261_pathfinder() {
  _check_adr0261_smoke "smoke-graph-pathfinder.mjs"
}

# P6: benchmark — 3 targets (≥2345 writes/sec, ≤780B/edge, k-hop d=1 p99 ≤5ms)
check_adr0261_benchmark() {
  _check_adr0261_smoke "benchmark-graph.mjs"
}
