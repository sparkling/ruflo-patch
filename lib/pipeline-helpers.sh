# lib/pipeline-helpers.sh — Shared build/test wrapper functions (ADR-0039)
#
# Sourceable library — no `set -euo pipefail` (caller provides).
# Centralizes build/test wrappers used by ruflo-publish.sh,
# ruflo-sync.sh, and the dispatcher's --build-only path.
#
# Required variables from caller:
#   SCRIPT_DIR, PROJECT_DIR, TEMP_DIR, CHANGED_PACKAGES_JSON,
#   NEW_RUFLO_HEAD, NEW_AGENTIC_HEAD, NEW_FANN_HEAD, NEW_RUVECTOR_HEAD,
#   BUILD_COMPILED_COUNT, BUILD_TOTAL_COUNT

# ---------------------------------------------------------------------------
# Build wrappers — delegate to standalone scripts
# ---------------------------------------------------------------------------

copy_source() {
  bash "${SCRIPT_DIR}/copy-source.sh"
}

run_codemod() {
  node "${SCRIPT_DIR}/codemod.mjs" "${TEMP_DIR}"
}

run_build() {
  TEMP_DIR="${TEMP_DIR}" CHANGED_PACKAGES_JSON="${CHANGED_PACKAGES_JSON:-all}" \
    bash "${SCRIPT_DIR}/build-packages.sh"
  bash "${SCRIPT_DIR}/build-wasm.sh" --build-dir "${TEMP_DIR}"
}

write_build_manifest() {
  local manifest="${TEMP_DIR}/.build-manifest.json"
  local codemod_hash
  codemod_hash=$(sha256sum "${SCRIPT_DIR}/codemod.mjs" 2>/dev/null | cut -d' ' -f1) || codemod_hash=""
  local compiled_count="${BUILD_COMPILED_COUNT:-}"
  local total_count="${BUILD_TOTAL_COUNT:-}"
  [[ -z "$compiled_count" ]] && compiled_count=$(find "${TEMP_DIR}" -name "dist" -type d 2>/dev/null | wc -l)
  [[ -z "$total_count" ]] && total_count=$(find "${TEMP_DIR}" -name "package.json" -not -path "*/node_modules/*" -not -path "*/.tsc-toolchain/*" -exec grep -l '"@sparkleideas/' {} + 2>/dev/null | wc -l)
  cat > "$manifest" <<MANIFESTEOF
{
  "version": 2,
  "built_at": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "ruflo_head": "${NEW_RUFLO_HEAD:-}",
  "agentic_head": "${NEW_AGENTIC_HEAD:-}",
  "fann_head": "${NEW_FANN_HEAD:-}",
  "ruvector_head": "${NEW_RUVECTOR_HEAD:-}",
  "codemod_hash": "${codemod_hash}",
  "packages_compiled": ${compiled_count},
  "packages_total": ${total_count}
}
MANIFESTEOF
}

# ---------------------------------------------------------------------------
# Test wrappers
# ---------------------------------------------------------------------------

run_tests_ci() {
  # preflight + unit only — no Verdaccio
  log "Running preflight + unit tests"
  local _pf_start _pf_end _ut_start _ut_end
  _pf_start=$(date +%s%N 2>/dev/null || echo 0)
  npm run preflight --prefix "${PROJECT_DIR}" || {
    log_error "Preflight failed"
    return 1
  }
  _pf_end=$(date +%s%N 2>/dev/null || echo 0)
  if [[ "$_pf_start" != "0" && "$_pf_end" != "0" ]]; then
    local _pf_ms=$(( (_pf_end - _pf_start) / 1000000 ))
    log "  Preflight: ${_pf_ms}ms"
    add_cmd_timing "test-ci" "npm run preflight" "${_pf_ms}"
  fi

  _ut_start=$(date +%s%N 2>/dev/null || echo 0)
  node "${PROJECT_DIR}/scripts/test-runner.mjs" || {
    log_error "Unit tests failed"
    return 1
  }
  _ut_end=$(date +%s%N 2>/dev/null || echo 0)
  if [[ "$_ut_start" != "0" && "$_ut_end" != "0" ]]; then
    local _ut_ms=$(( (_ut_end - _ut_start) / 1000000 ))
    log "  Unit tests: ${_ut_ms}ms"
    add_cmd_timing "test-ci" "node test-runner.mjs" "${_ut_ms}"
  fi
}

run_publish_verdaccio() {
  local -a args=(--build-dir "${TEMP_DIR}")
  [[ -n "${CHANGED_PACKAGES_JSON:-}" && "${CHANGED_PACKAGES_JSON}" != "all" ]] && \
    args+=(--changed-packages "${CHANGED_PACKAGES_JSON}")
  bash "${SCRIPT_DIR}/publish-verdaccio.sh" "${args[@]}"
}

run_acceptance() {
  bash "${SCRIPT_DIR}/test-acceptance.sh" --registry "http://localhost:4873"
}

run_tests() {
  run_tests_ci
  run_publish_verdaccio
  run_acceptance
}
