#!/usr/bin/env bash
# lib/acceptance-adr0287r2-checks.sh — ADR-0287 R2: discriminated re-throw of
# FATAL storage errors in AgentDBBackend.storeInAgentDB (benign stays swallowed).
#
# Runs scripts/smoke-adr0287r2-storeindb-rethrow.mjs, which imports the SHIPPED
# `@sparkleideas/memory/dist/agentdb-backend.js`, instantiates AgentDBBackend,
# runs the real initialize() (populating the module-level HNSWIndex so the HNSW
# block is reached), then injects a fake `agentdb` whose SQLite (`db.run`) and
# HNSW (`addVector`) write paths throw on demand. Asserts:
#   1. SQLite path, FATAL  (RvfCorruptError / EmbeddingDimensionError) ⇒ store() THROWS
#   2. SQLite path, BENIGN (plain Error / SQLITE_BUSY)                 ⇒ store() SWALLOWS
#   3. HNSW path,   FATAL  (EmbeddingDimensionError)                   ⇒ THROWS  (if reachable)
#   4. HNSW path,   BENIGN ("Index not built")                        ⇒ SWALLOWS (if reachable)
# mirroring the exact `_isFatalStorageError` discrimination in the committed
# fork source (RvfCorruptError · RvfNotInitializedError · EmbeddingDimensionError
# · DimensionMismatchError · AgentDBInitError · ControllerInitError).
#
# FAILs pre-fix (the bare `catch {}` ate the fatal → store() resolved), PASSes
# after the R2 fix ships to the registry — RED until the release by design (it
# validates the PUBLISHED dist, not the working tree). Reuses ACCEPT_TEMP via
# ADR0255_SMOKE_SHARED_TEMP (the smoke self-installs from Verdaccio standalone).

if ! declare -f _ns >/dev/null 2>&1; then
  _ns() { date +%s%N 2>/dev/null || echo $(( $(date +%s) * 1000000000 )); }
fi
if ! declare -f _elapsed_ms >/dev/null 2>&1; then
  _elapsed_ms() { echo $(( ( ${2:-0} - ${1:-0} ) / 1000000 )); }
fi

check_adr0287r2_storeindb_rethrow() {
  local start_ns end_ns log_path rc
  start_ns=$(_ns)
  _CHECK_PASSED="false"
  _CHECK_OUTPUT=""
  log_path=$(mktemp -t "adr0287r2-storeindb-rethrow-XXXXXX.log")

  if [[ ! -f "${PROJECT_DIR}/scripts/smoke-adr0287r2-storeindb-rethrow.mjs" ]]; then
    _CHECK_OUTPUT="missing: scripts/smoke-adr0287r2-storeindb-rethrow.mjs"
    end_ns=$(_ns); _EXIT=2; _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns"); _OUT="$_CHECK_OUTPUT"
    return
  fi

  node "${PROJECT_DIR}/scripts/smoke-adr0287r2-storeindb-rethrow.mjs" > "${log_path}" 2>&1
  rc=$?

  end_ns=$(_ns)
  _DURATION_MS=$(_elapsed_ms "$start_ns" "$end_ns")
  _EXIT=$rc
  _OUT="exit=${rc} log=${log_path} (tail -40: $(tail -40 "${log_path}" 2>/dev/null | tr '\n' ' ' | head -c 400))"
  _CHECK_OUTPUT="$_OUT"

  if [[ $rc -eq 0 ]]; then
    _CHECK_PASSED="true"
  fi
}
