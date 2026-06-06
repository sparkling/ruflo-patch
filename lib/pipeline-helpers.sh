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
  # ADR-0162 follow-up: after rename, link workspace-internal @sparkleideas/*
  # deps so test-ci can resolve runtime bare specifiers (e.g.
  # cli/dist/src/output.js → @sparkleideas/cli-core/output) without
  # needing pnpm install. @sparkleideas/* externals (rabitq-wasm, agentdb,
  # etc.) resolve from Verdaccio at acceptance.
  node "${SCRIPT_DIR}/codemod-symlink-workspace.mjs" "${TEMP_DIR}"
  # ADR-0231 outstanding follow-up: install third-party (unscoped + non-
  # @sparkleideas/, non-@claude-flow/) runtime deps so test-ci can resolve
  # `import 'zod'`/`import 'sql.js'`/etc. from compiled dist files. Without
  # this step, test-ci fails with ERR_MODULE_NOT_FOUND on any dist file
  # that imports a third-party bare specifier.
  node "${SCRIPT_DIR}/install-runtime-externals.mjs" "${TEMP_DIR}"
}

run_build() {
  TEMP_DIR="${TEMP_DIR}" CHANGED_PACKAGES_JSON="${CHANGED_PACKAGES_JSON:-all}" \
    bash "${SCRIPT_DIR}/build-packages.sh"
  bash "${SCRIPT_DIR}/build-wasm.sh" --build-dir "${TEMP_DIR}"
  # Read build counts exported by build-packages.sh (subprocess can't set parent vars)
  if [[ -f "${TEMP_DIR}/.build-counts" ]]; then
    read -r BUILD_COMPILED_COUNT BUILD_TOTAL_COUNT < "${TEMP_DIR}/.build-counts"
    export BUILD_COMPILED_COUNT BUILD_TOTAL_COUNT
  fi
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
  "agentdb_head": "${NEW_AGENTDB_HEAD:-}",
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

run_sanitize_optional_deps() {
  # Strip unresolvable @sparkleideas/* OPTIONAL deps from publishable manifests
  # before publish; fail loud on an unresolvable @sparkleideas/* HARD dep.
  #
  # The codemod rewrites @ruvector/* → @sparkleideas/ruvector-* in every dep
  # field, including napi platform sub-packages (…-darwin-arm64, …-win32-x64-msvc)
  # that ADR-0071 ELIMINATED (bundled the .node into the parent) and pure
  # sub-packages (rvf-solver, rvf-wasm, diskann) we never publish. Those names
  # 404. A lone 404 optional is harmless (npm skips it), but once a peer optional
  # resolves (e.g. ADR-0294 R3's rabitq-wasm stub) npm places it, runs arborist
  # pruneDedupable, and trips over the empty-version placeholder nodes →
  # `Invalid Version` → the whole `npx @sparkleideas/ruflo` install aborts →
  # MCP fails with -32000. See ADR-0295. Conservative: strips ONLY on a
  # definitive registry 404 (network/5xx → keep).
  node "${SCRIPT_DIR}/sanitize-internal-optional-deps.mjs" fix "${TEMP_DIR}" \
    --registry "http://localhost:4873"
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

# ---------------------------------------------------------------------------
# run_phase_norevert — tolerant-phase helper (ADR-0245)
# ---------------------------------------------------------------------------
#
# Use when a phase is expected to be tolerant-of-known-soft-failures
# (e.g. "version already exists" on republish), where the caller has
# decided in advance which non-zero exit-shapes are recoverable.
#
# Re-raises any UNEXPECTED non-zero exit as fatal (logs, then `return $rc`
# so caller's `set -euo pipefail` fires).
#
# Pattern: caller sets `set -euo pipefail` (or sources this helper from
# a `set -uo pipefail` script that delegates per-phase manual handling).
# Phases that are NOT tolerant just run inline; phases that ARE tolerant
# wrap in this helper and pass an explicit per-call allowlist of
# recoverable error strings.
#
# Per ADR-0245 §Optimise-as-you-go: allowlist is **per-call explicit**
# (3rd argument as space-separated string), NOT a global lookup table —
# prevents allowlist drift becoming a new registry-drift class.
#
# Usage:
#   run_phase_norevert <phase-name> <command...> [--recoverable "pat1|pat2"]
#
# Simpler form (allowlist via RECOVERABLE_PATTERNS env var):
#   RECOVERABLE_PATTERNS="cannot publish over|already exists" \
#     run_phase_norevert publish-wrapper npm publish ...
#
run_phase_norevert() {
  local phase="$1"; shift
  local recoverable="${RECOVERABLE_PATTERNS:-}"
  local _out _rc=0
  _out="$("$@" 2>&1)" || _rc=$?
  printf '%s\n' "$_out"
  if (( _rc != 0 )); then
    if [[ -n "$recoverable" ]] && printf '%s' "$_out" | grep -qE "$recoverable"; then
      # Recoverable per per-call allowlist — log and continue.
      # Use `declare -F` (not `command -v`) so we resolve a SHELL FUNCTION
      # named `log` rather than the macOS system `log(1)` command.
      if declare -F log >/dev/null 2>&1; then
        log "  phase '${phase}' soft-failed (rc=${_rc}, matched recoverable allowlist) — continuing"
      else
        echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] phase '${phase}' soft-failed (rc=${_rc}, recoverable) — continuing" >&2
      fi
      return 0
    fi
    # Non-recoverable — re-raise.
    if declare -F log_error >/dev/null 2>&1; then
      log_error "phase '${phase}' failed with non-recoverable error (rc=${_rc})"
    else
      echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] ERROR: phase '${phase}' failed with non-recoverable error (rc=${_rc})" >&2
    fi
    return "$_rc"
  fi
  return 0
}
